/* eslint-disable no-undef */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Page } from "@playwright/test";

export type TextAudioInput = string | Iterable<string> | AsyncIterable<string>;

export interface TextToSpeechOptions {
  sampleRateHz?: number;
  voice?: string;
}

export interface VirtualMicrophonePlaybackOptions {
  startDelayMs?: number;
}

export interface VirtualMicrophoneOptions extends TextToSpeechOptions {
  speechStartDelayMs?: number;
  speechGain?: number;
  toneGain?: number;
}

type VirtualMicrophoneWindow = Window & {
  __activeAudioPlayCount?: number;
  __aiInterviewAudioContext?: AudioContext;
  __aiInterviewMicDestination?: MediaStreamAudioDestinationNode;
  __aiInterviewSyntheticVideoCanvas?: HTMLCanvasElement;
  __aiInterviewSyntheticVideoInterval?: number;
  __aiInterviewSyntheticVideoStream?: MediaStream;
  __audioPlayCallCount?: number;
  __emitApplicantMicTone?: (
    durationMs: number,
    gainValue?: number,
  ) => Promise<number>;
  __playApplicantAnswerAudio?: (
    audioBase64: string,
    playbackOptions?: VirtualMicrophonePlaybackOptions,
  ) => Promise<number>;
};

const textInputToString = async (input: TextAudioInput): Promise<string> => {
  if (typeof input === "string") {
    return input;
  }

  const chunks: string[] = [];

  for await (const chunk of input) {
    chunks.push(chunk);
  }

  return chunks.join("");
};

export const createSpeechAudioBase64 = (
  text: string,
  options: TextToSpeechOptions = {},
): string => {
  const tempDir = mkdtempSync(join(tmpdir(), "virtual-microphone-audio-"));
  const aiffPath = join(tempDir, "speech.aiff");
  const wavPath = join(tempDir, "speech.wav");

  try {
    execFileSync(
      "say",
      [
        "-v",
        options.voice ?? process.env.APPLICANT_ANSWER_TTS_VOICE ?? "Kyoko",
        "-o",
        aiffPath,
        text,
      ],
      { stdio: "ignore" },
    );
    execFileSync(
      "afconvert",
      [
        "-f",
        "WAVE",
        "-d",
        `LEI16@${options.sampleRateHz ?? 16000}`,
        aiffPath,
        wavPath,
      ],
      { stdio: "ignore" },
    );

    return readFileSync(wavPath).toString("base64");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
};

export const createSpeechAudioBase64FromTextInput = async (
  input: TextAudioInput,
  options: TextToSpeechOptions = {},
): Promise<string> => {
  return createSpeechAudioBase64(await textInputToString(input), options);
};

export class VirtualMicrophone {
  private readonly page: Page;
  private readonly options: Required<VirtualMicrophoneOptions>;

  constructor(page: Page, options: VirtualMicrophoneOptions = {}) {
    this.page = page;
    this.options = {
      sampleRateHz: options.sampleRateHz ?? 16000,
      speechStartDelayMs: options.speechStartDelayMs ?? 750,
      speechGain: options.speechGain ?? 4,
      toneGain: options.toneGain ?? 0.9,
      voice: options.voice ?? process.env.APPLICANT_ANSWER_TTS_VOICE ?? "Kyoko",
    };
  }

  async install(): Promise<void> {
    await this.page.addInitScript((options) => {
      const win = window as VirtualMicrophoneWindow;
      const originalEnumerateDevices =
        navigator.mediaDevices.enumerateDevices?.bind(navigator.mediaDevices);
      const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(
        navigator.mediaDevices,
      );
      const originalPermissionsQuery = navigator.permissions?.query?.bind(
        navigator.permissions,
      );
      const originalPlay = HTMLMediaElement.prototype.play;

      const removeDeviceIdConstraint = (
        trackConstraints: boolean | MediaTrackConstraints | undefined,
      ) => {
        if (!trackConstraints || typeof trackConstraints !== "object") {
          return trackConstraints;
        }

        const sanitizedConstraints = { ...trackConstraints };
        delete sanitizedConstraints.deviceId;

        return sanitizedConstraints;
      };

      const removeStaleDeviceIds = (
        constraints: MediaStreamConstraints | undefined,
      ) => {
        if (!constraints || typeof constraints !== "object") {
          return constraints;
        }

        return {
          ...constraints,
          audio: removeDeviceIdConstraint(constraints.audio),
          video: removeDeviceIdConstraint(constraints.video),
        };
      };

      const overrideMediaDeviceFunction = <
        MethodName extends "enumerateDevices" | "getUserMedia",
      >(
        methodName: MethodName,
        replacement: MediaDevices[MethodName],
      ) => {
        Object.defineProperty(navigator.mediaDevices, methodName, {
          configurable: true,
          value: replacement,
        });
      };

      const mediaPermissionNames = new Set(["camera", "microphone"]);
      const createGrantedPermissionStatus = (name: string) => {
        const status = new EventTarget() as PermissionStatus;

        Object.defineProperties(status, {
          name: {
            configurable: true,
            value: name,
          },
          onchange: {
            configurable: true,
            value: null,
            writable: true,
          },
          state: {
            configurable: true,
            value: "granted",
          },
        });

        return status;
      };

      const queryPermission: Permissions["query"] = async (descriptor) => {
        if (mediaPermissionNames.has(descriptor.name)) {
          return createGrantedPermissionStatus(descriptor.name);
        }

        if (originalPermissionsQuery) {
          return originalPermissionsQuery(descriptor);
        }

        return createGrantedPermissionStatus(descriptor.name);
      };

      if (navigator.permissions) {
        Object.defineProperty(navigator.permissions, "query", {
          configurable: true,
          value: queryPermission,
        });
      } else {
        Object.defineProperty(navigator, "permissions", {
          configurable: true,
          value: {
            query: queryPermission,
          },
        });
      }

      const ensureVirtualMicrophone = () => {
        const existingAudioTrack =
          win.__aiInterviewMicDestination?.stream.getAudioTracks()[0];

        if (
          win.__aiInterviewAudioContext &&
          win.__aiInterviewMicDestination &&
          existingAudioTrack?.readyState === "live"
        ) {
          return {
            audioContext: win.__aiInterviewAudioContext,
            destination: win.__aiInterviewMicDestination,
          };
        }

        const audioContext = new AudioContext();
        const destination = audioContext.createMediaStreamDestination();

        win.__aiInterviewAudioContext = audioContext;
        win.__aiInterviewMicDestination = destination;

        return { audioContext, destination };
      };

      const ensureSyntheticVideoStream = () => {
        const existingVideoTrack =
          win.__aiInterviewSyntheticVideoStream?.getVideoTracks()[0];

        if (existingVideoTrack?.readyState === "live") {
          return win.__aiInterviewSyntheticVideoStream as MediaStream;
        }

        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 480;

        const context = canvas.getContext("2d");
        let frame = 0;

        const paintFrame = () => {
          if (!context) {
            return;
          }

          const hue = frame % 360;

          context.fillStyle = `hsl(${hue}, 55%, 36%)`;
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.fillStyle = "rgba(255, 255, 255, 0.9)";
          context.fillRect(48, 48, canvas.width - 96, canvas.height - 96);
          context.fillStyle = `hsl(${(hue + 180) % 360}, 65%, 42%)`;
          context.beginPath();
          context.arc(
            canvas.width / 2,
            canvas.height / 2,
            72 + (frame % 30),
            0,
            Math.PI * 2,
          );
          context.fill();
          frame += 1;
        };

        paintFrame();
        win.__aiInterviewSyntheticVideoInterval = window.setInterval(
          paintFrame,
          100,
        );

        const stream = canvas.captureStream(30);

        win.__aiInterviewSyntheticVideoCanvas = canvas;
        win.__aiInterviewSyntheticVideoStream = stream;

        return stream;
      };

      const resumeVirtualMicrophone = () => {
        win.__aiInterviewAudioContext?.resume().catch(() => {});
      };
      const wait = (durationMs: number) =>
        new Promise<void>((resolve) => window.setTimeout(resolve, durationMs));
      const withTimeout = async <Value>(
        promise: Promise<Value>,
        timeoutMs: number,
      ): Promise<Value> => {
        return await Promise.race([
          promise,
          new Promise<Value>((_, reject) =>
            window.setTimeout(
              () => reject(new Error("Native media call timed out")),
              timeoutMs,
            ),
          ),
        ]);
      };

      win.__activeAudioPlayCount = 0;
      win.__audioPlayCallCount = 0;
      document.addEventListener("click", resumeVirtualMicrophone, true);
      document.addEventListener("keydown", resumeVirtualMicrophone, true);
      document.addEventListener("pointerdown", resumeVirtualMicrophone, true);

      win.__emitApplicantMicTone = async (
        durationMs: number,
        gainValue?: number,
      ) => {
        const { audioContext, destination } = ensureVirtualMicrophone();
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();

        if (audioContext.state !== "running") {
          await audioContext.resume();
        }

        oscillator.frequency.value = 440;
        gain.gain.value = gainValue ?? options.toneGain;
        oscillator.connect(gain);
        gain.connect(destination);
        oscillator.start();
        oscillator.stop(audioContext.currentTime + durationMs / 1000);

        return durationMs / 1000;
      };

      win.__playApplicantAnswerAudio = async (
        audioBase64: string,
        playbackOptions = {},
      ) => {
        const { audioContext, destination } = ensureVirtualMicrophone();
        const binaryString = atob(audioBase64);
        const audioBytes = Uint8Array.from(binaryString, (char) =>
          char.charCodeAt(0),
        );
        const audioBuffer = await audioContext.decodeAudioData(
          audioBytes.buffer.slice(
            audioBytes.byteOffset,
            audioBytes.byteOffset + audioBytes.byteLength,
          ),
        );
        const source = audioContext.createBufferSource();
        const gain = audioContext.createGain();

        if (audioContext.state !== "running") {
          await audioContext.resume();
        }

        const startDelayMs =
          playbackOptions.startDelayMs ?? options.speechStartDelayMs;

        if (startDelayMs > 0) {
          await wait(startDelayMs);
        }

        source.buffer = audioBuffer;
        gain.gain.value = options.speechGain;
        source.connect(gain);
        gain.connect(destination);

        return await new Promise<number>((resolve) => {
          source.onended = () => resolve(audioBuffer.duration);
          source.start();
        });
      };

      overrideMediaDeviceFunction("enumerateDevices", async () => {
        const nativeDevices = originalEnumerateDevices
          ? await withTimeout(originalEnumerateDevices(), 1000).catch(() => [])
          : [];
        const devices: MediaDeviceInfo[] = [...nativeDevices];

        if (!devices.some((device) => device.kind === "audioinput")) {
          devices.push({
            deviceId: "ai-interview-virtual-microphone",
            groupId: "ai-interview-virtual-media",
            kind: "audioinput",
            label: "AI Interview Virtual Microphone",
            toJSON: () => ({}),
          } as MediaDeviceInfo);
        }

        if (!devices.some((device) => device.kind === "videoinput")) {
          devices.push({
            deviceId: "ai-interview-virtual-camera",
            groupId: "ai-interview-virtual-media",
            kind: "videoinput",
            label: "AI Interview Virtual Camera",
            toJSON: () => ({}),
          } as MediaDeviceInfo);
        }

        return devices;
      });

      overrideMediaDeviceFunction("getUserMedia", async (constraints) => {
        const wantsAudio = Boolean(
          constraints &&
            typeof constraints === "object" &&
            "audio" in constraints &&
            constraints.audio,
        );
        const wantsVideo = Boolean(
          constraints &&
            typeof constraints === "object" &&
            "video" in constraints &&
            constraints.video,
        );
        let nativeStream: MediaStream;

        try {
          nativeStream = await withTimeout(
            originalGetUserMedia(removeStaleDeviceIds(constraints)),
            3000,
          );
        } catch (error) {
          if (!wantsAudio && !wantsVideo) {
            throw error;
          }

          nativeStream = new MediaStream();
        }

        if (!wantsAudio && !wantsVideo) {
          return nativeStream;
        }

        const stream = new MediaStream();

        for (const track of nativeStream.getVideoTracks()) {
          stream.addTrack(track);
        }

        if (wantsVideo && stream.getVideoTracks().length === 0) {
          for (const track of ensureSyntheticVideoStream().getVideoTracks()) {
            stream.addTrack(track);
          }
        }

        if (wantsAudio) {
          const { destination } = ensureVirtualMicrophone();

          for (const track of nativeStream.getAudioTracks()) {
            track.stop();
          }

          for (const track of destination.stream.getAudioTracks()) {
            stream.addTrack(track);
          }
        } else {
          for (const track of nativeStream.getAudioTracks()) {
            stream.addTrack(track);
          }
        }

        return stream;
      });

      HTMLMediaElement.prototype.play = function (...args) {
        if (this instanceof HTMLAudioElement) {
          win.__audioPlayCallCount = (win.__audioPlayCallCount ?? 0) + 1;
          win.__activeAudioPlayCount = (win.__activeAudioPlayCount ?? 0) + 1;
          let playbackMarkedFinished = false;

          const markPlaybackFinished = () => {
            if (playbackMarkedFinished) {
              return;
            }

            playbackMarkedFinished = true;
            win.__activeAudioPlayCount = Math.max(
              (win.__activeAudioPlayCount ?? 1) - 1,
              0,
            );
          };

          for (const eventName of [
            "abort",
            "emptied",
            "ended",
            "error",
            "pause",
          ]) {
            this.addEventListener(eventName, markPlaybackFinished, {
              once: true,
            });
          }
        }

        const playPromise = originalPlay.apply(this, args);

        if (this instanceof HTMLAudioElement) {
          playPromise.catch(() => {
            win.__activeAudioPlayCount = Math.max(
              (win.__activeAudioPlayCount ?? 1) - 1,
              0,
            );
          });
        }

        return playPromise;
      };
    }, this.options);
  }

  async emitTone(durationMs: number, gainValue?: number): Promise<number> {
    return this.page.evaluate(
      async ({ toneDurationMs, toneGainValue }) => {
        const emitTone = (window as VirtualMicrophoneWindow)
          .__emitApplicantMicTone;

        if (!emitTone) {
          throw new Error("Virtual microphone tone helper was not installed");
        }

        return emitTone(toneDurationMs, toneGainValue);
      },
      { toneDurationMs: durationMs, toneGainValue: gainValue },
    );
  }

  async playAudioBase64(
    audioBase64: string,
    options: VirtualMicrophonePlaybackOptions = {},
  ): Promise<number> {
    return this.page.evaluate(
      async ({ audio, playbackOptions }) => {
        const playAudio = (window as VirtualMicrophoneWindow)
          .__playApplicantAnswerAudio;

        if (!playAudio) {
          throw new Error("Virtual microphone audio helper was not installed");
        }

        return playAudio(audio, playbackOptions);
      },
      {
        audio: audioBase64,
        playbackOptions: options,
      },
    );
  }

  async speak(input: TextAudioInput): Promise<number> {
    return this.playAudioBase64(
      await createSpeechAudioBase64FromTextInput(input, this.options),
    );
  }

  async resetObservedAudioPlayback(): Promise<void> {
    await this.page.evaluate(() => {
      const win = window as VirtualMicrophoneWindow;

      win.__activeAudioPlayCount = 0;
      win.__audioPlayCallCount = 0;
    });
  }

  async getObservedAudioPlayCount(): Promise<number> {
    return this.page.evaluate(
      () => (window as VirtualMicrophoneWindow).__audioPlayCallCount ?? 0,
    );
  }

  async getActiveObservedAudioCount(): Promise<number> {
    return this.page.evaluate(() => {
      const win = window as VirtualMicrophoneWindow;
      const activeAudioElementCount = Array.from(
        document.querySelectorAll("audio"),
      ).filter((audio) => !audio.paused && !audio.ended).length;

      if (activeAudioElementCount === 0) {
        win.__activeAudioPlayCount = 0;
      }

      return win.__activeAudioPlayCount ?? 0;
    });
  }
}
