# AI Interview E2E Test Suite

Playwright end-to-end tests for the AI interview flows.

## Setup

Install dependencies:

```bash
npm install
```

Create a local `.env` from `.env.sample` and fill in the environment-specific values:

```bash
cp .env.sample .env
```

Required values depend on which tests you run, but the common ones are:

```env
BASE_URL='https://...'
ACCOUNTS_JSON='.accounts.dev.json'
REPORTING_API_BASIC_AUTH='Basic ...'
REPORTING_API_BASE_URL='https://api...'
LM_STUDIO_BASE_URL='http://localhost:1234/v1'
```

## Running Tests

Run all Chrome-backed tests with one worker:

```bash
npx playwright test --project="Chrome" --workers=1
```

Run a single file:

```bash
npx playwright test src/tests/Interview/non-interactive-flow.test.ts --project="Chrome" --workers=1
```

Run only organization tests:

```bash
npx playwright test --grep @org --project="Chrome" --workers=1
```

Run only interview tests:

```bash
npx playwright test --grep @interview --project="Chrome" --workers=1
```

Run organization or interview tests across all browser projects one by one, preserving HTML reports and a compressed archive:

```bash
scripts/run-tagged-browser-suite.sh org
scripts/run-tagged-browser-suite.sh interview
```

The runner writes uncompressed reports to `test-reports/runs/<suite>-<timestamp>/` and creates `test-reports/archives/<suite>-<timestamp>.tar.gz`.

You can override the browser list or worker count:

```bash
BROWSERS="Chrome Firefox Edge" WORKERS=1 scripts/run-tagged-browser-suite.sh interview
```

Available projects currently include:

- `Log in all accounts`
- `Chrome`
- `Firefox`
- `Edge`
- `Safari`

On Windows, use `Chrome`, `Firefox`, and `Edge`. The `Safari` project is WebKit-based and is not real Safari on Windows.

## Virtual Microphone

The interview tests do not rely on a physical camera or microphone. They use [src/utils/virtual-microphone.ts](src/utils/virtual-microphone.ts), which:

- grants camera and microphone permissions in the browser
- provides a synthetic camera stream when needed
- replaces the app's microphone input with a test-controlled audio stream
- injects applicant answers into that stream
- tracks interviewer audio playback so tests can wait before answering

There are two audio injection modes:

```ts
await virtualMicrophone.emitTone(3000)
```

Use this when the spoken content does not matter, such as media setup or timer tests.

```ts
await virtualMicrophone.speak('My answer text')
```

Use this when the backend STT must transcribe the applicant answer.

## Applicant Answer TTS

Applicant answers are generated at runtime. No pre-generated WAV files are required.

The TTS provider is controlled by:

```env
APPLICANT_ANSWER_TTS_PROVIDER='auto'
```

Supported values:

- `auto`: use the native provider for the current OS
- `macos`: force macOS `say` + `afconvert`
- `windows`: force Windows SAPI through PowerShell

With `auto`:

- macOS uses `say` and `afconvert`
- Windows uses `System.Speech.Synthesis.SpeechSynthesizer` through `powershell.exe`

## Voice Selection

Most interview tests pass a scenario voice directly:

```ts
new VirtualMicrophone(page, {
  voice: scenario.voice,
})
```

For example:

- Japanese scenario: `Kyoko`
- English scenario: `Samantha`

This means `APPLICANT_ANSWER_TTS_VOICE` is only the generic fallback voice. It is used when a test does not pass a `voice` option.

```env
# Fallback only. Scenario tests usually pass a voice explicitly.
APPLICANT_ANSWER_TTS_VOICE='Kyoko'
```

### macOS Voices

On macOS, the scenario voice is passed directly to `say`.

Examples:

```env
APPLICANT_ANSWER_TTS_PROVIDER='auto'
APPLICANT_ANSWER_TTS_VOICE='Kyoko'
```

The interactive tests can still dynamically use `Kyoko` for Japanese and `Samantha` for English because those voice names are passed per scenario.

You can list macOS voices with:

```bash
say -v '?'
```

### Windows Voices

Windows voice names are different from macOS voice names. To keep tests dynamic when English and Japanese run together, map each scenario voice to an installed Windows SAPI voice:

```env
APPLICANT_ANSWER_TTS_PROVIDER='auto'
APPLICANT_ANSWER_TTS_WINDOWS_VOICE_KYOKO='Microsoft Haruka Desktop'
APPLICANT_ANSWER_TTS_WINDOWS_VOICE_SAMANTHA='Microsoft Zira Desktop'
```

Resolution order on Windows:

1. `windowsVoice` passed directly in code
2. mapped scenario voice, such as `APPLICANT_ANSWER_TTS_WINDOWS_VOICE_KYOKO`
3. generic fallback `APPLICANT_ANSWER_TTS_WINDOWS_VOICE`
4. original scenario voice name
5. Windows SAPI default voice

The environment suffix is created from the scenario voice by uppercasing it and replacing non-alphanumeric characters with `_`.

Examples:

- `Kyoko` -> `APPLICANT_ANSWER_TTS_WINDOWS_VOICE_KYOKO`
- `Samantha` -> `APPLICANT_ANSWER_TTS_WINDOWS_VOICE_SAMANTHA`
- `Some Voice 1` -> `APPLICANT_ANSWER_TTS_WINDOWS_VOICE_SOME_VOICE_1`

List installed Windows SAPI voices:

```powershell
Add-Type -AssemblyName System.Speech
(New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() |
  ForEach-Object { $_.VoiceInfo.Name }
```

Japanese tests on Windows require an installed Japanese SAPI voice. A Japanese keyboard or display language alone is not enough.

If PowerShell is not available as `powershell.exe`, override it:

```env
APPLICANT_ANSWER_TTS_POWERSHELL_PATH='C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
```

## Sample `.env` TTS Blocks

macOS:

```env
APPLICANT_ANSWER_TTS_PROVIDER='auto'
APPLICANT_ANSWER_TTS_VOICE='Kyoko'
```

Windows:

```env
APPLICANT_ANSWER_TTS_PROVIDER='auto'
APPLICANT_ANSWER_TTS_VOICE='Kyoko'
APPLICANT_ANSWER_TTS_WINDOWS_VOICE_KYOKO='Microsoft Haruka Desktop'
APPLICANT_ANSWER_TTS_WINDOWS_VOICE_SAMANTHA='Microsoft Zira Desktop'
APPLICANT_ANSWER_TTS_POWERSHELL_PATH='powershell.exe'
```

## Verification Commands

Lint touched files:

```bash
npx eslint src/utils/virtual-microphone.ts src/tests/Interview/interactive-flow.test.ts
```

Type check:

```bash
npm run type:check
```

At the time of writing, project type-checking is known to fail on unrelated `timeout` metadata fields in `src/tests/Organization/csv-export.test.ts`.
