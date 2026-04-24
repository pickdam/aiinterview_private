import { setTimeout as wait } from 'node:timers/promises'

import type { Page } from '@playwright/test'
import { LmStudioApi } from '@src/api/lm-studio-api'
import type { InterviewLanguage } from '@src/api/types'
import { expect } from '@src/fixtures/fixtures'
import { refreshAdminBrowserAuth } from '@src/utils/api-auth'
import { InterviewQuestionPage } from '@src/pages/interview-question.page'
import { ReportPage } from '@src/pages/report.page'
import {
    formatTimer,
    InterviewFlowActions,
    timeToSeconds,
} from '@src/utils/interview-flow-actions'
import {
    calculateTranscriptionSimilarity,
    normalizeForTranscriptionComparison,
    reportGenerationErrorPattern,
    transcriptionErrorPattern,
} from '@src/utils/transcription-comparison'
import {
    VirtualMicrophone,
} from '@src/utils/virtual-microphone'

export type InteractiveFlowQuestion = {
    answer: string
    question: string
}

export type InteractiveFlowQuestionRecord = {
    answer: string | null
    isDeepDive: boolean
    question: string
}

export type InteractiveFlowAdvanceMethod = 'submit' | 'timeout'

type AnsweredQuestionRecord = InteractiveFlowQuestionRecord & {
    answer: string
}

type AnswerLeadUpQuestionOptions = {
    flow: InterviewFlowActions
    interviewerAudioAlreadyFinished?: boolean
    page: Page
    questionData: InteractiveFlowQuestion
    questionIndex: number
    totalLeadUpQuestions: number
    virtualMicrophone: VirtualMicrophone
}

type HandleDeepDiveLoopOptions = {
    closingRemark: string
    deepDiveAdvanceMethod:
        | InteractiveFlowAdvanceMethod
        | InteractiveFlowAdvanceMethod[]
    flow: InterviewFlowActions
    interviewLanguage: InterviewLanguage
    leadUpAdvanceMethod: InteractiveFlowAdvanceMethod
    leadUpQuestionIndex: number
    lmStudio: LmStudioApi
    page: Page
    questionRecords: InteractiveFlowQuestionRecord[]
    totalLeadUpQuestions: number
    virtualMicrophone: VirtualMicrophone
}

type VerifyReportOptions = {
    interviewSessionId: number
    pageAdmin: Page
    questionRecords: InteractiveFlowQuestionRecord[]
    scenarioLabel: string
}

export type DeepDiveLoopResult = {
    deepDiveCount: number
    sawClosingRemark: boolean
}

type AnswerDeepDiveQuestionOptions = {
    deepDiveAdvanceMethod: InteractiveFlowAdvanceMethod
    flow: InterviewFlowActions
    interviewLanguage: InterviewLanguage
    interviewQuestionPage: InterviewQuestionPage
    leadUpQuestionIndex: number
    lmStudio: LmStudioApi
    questionRecords: InteractiveFlowQuestionRecord[]
    questionText: string
    totalLeadUpQuestions: number
    virtualMicrophone: VirtualMicrophone
}

const questionTimeoutBufferSeconds = 45
const answerRecorderActivationToneMs = 1500
const answerRecorderActivationToneGain = 0.9
const answerRecorderSettleMs = 500
const answerRecordingFlushMs = 3000
const timeoutToneDurationMs = 3000
const timeoutToneIntervalMs = 1000
const closingRemarkSignals = [
    '次に進みます',
    "We'll move to the next question.",
]
const languageNameByCode = {
    en: 'English',
    ja: 'Japanese',
} satisfies Record<InterviewLanguage, string>

const normalizeVisibleText = (text: string): string =>
    text.replace(/\s+/g, ' ').trim()

const getQuestionText = async (
    interviewQuestionPage: InterviewQuestionPage,
): Promise<string> => {
    return (await interviewQuestionPage.questionText.innerText()).trim()
}

const isInterviewCompleteVisible = async (page: Page): Promise<boolean> => {
    return page
        .getByText(/The interview is now complete|面接が完了しました/i)
        .isVisible()
        .catch(() => false)
}

const isClosingRemarkText = (
    questionText: string,
    scenarioClosingRemark: string,
): boolean => {
    const normalizedQuestionText = normalizeVisibleText(questionText)
    const possibleClosingRemarks = [
        scenarioClosingRemark,
        ...closingRemarkSignals,
    ]

    return possibleClosingRemarks.some((closingRemark) =>
        normalizedQuestionText.includes(normalizeVisibleText(closingRemark)),
    )
}

const getLatestLeadUpAnswer = (
    questionRecords: InteractiveFlowQuestionRecord[],
): AnsweredQuestionRecord | undefined => {
    return questionRecords.findLast(
        (record): record is AnsweredQuestionRecord =>
            !record.isDeepDive && record.answer !== null,
    )
}

const buildDeepDiveAnswerPrompt = ({
    interviewLanguage,
    previousLeadUpAnswer,
    questionText,
}: {
    interviewLanguage: InterviewLanguage
    previousLeadUpAnswer: AnsweredQuestionRecord | undefined
    questionText: string
}): string => {
    const languageName = languageNameByCode[interviewLanguage]
    const previousContext = previousLeadUpAnswer
        ? [
              `Previous lead-up question: ${previousLeadUpAnswer.question}`,
              `Previous candidate answer: ${previousLeadUpAnswer.answer}`,
          ].join('\n')
        : 'No previous answer context is available.'

    return [
        'You are answering an interactive job interview as the candidate.',
        `The interview language is ${languageName}. Always answer in ${languageName}, even if the follow-up question is written in another language.`,
        'Use the previous candidate answer as context. Do not say that you have not answered yet if the previous answer already contains the relevant information.',
        previousContext,
        `Current follow-up question: ${questionText}`,
        `Answer naturally in ${languageName}. Keep the answer concise, direct, and consistent with the previous answer.`,
    ].join('\n\n')
}

const waitForQuestionTextToChange = async (
    interviewQuestionPage: InterviewQuestionPage,
    previousQuestionText: string,
): Promise<string> => {
    const normalizedPreviousQuestionText =
        normalizeVisibleText(previousQuestionText)

    await expect
        .poll(
            async () =>
                normalizeVisibleText(
                    await interviewQuestionPage.questionText.innerText(),
                ),
            {
                timeout: 20000,
            },
        )
        .not.toBe(normalizedPreviousQuestionText)

    return getQuestionText(interviewQuestionPage)
}

const waitForCurrentQuestionTimerToExpire = async (
    interviewQuestionPage: InterviewQuestionPage,
    virtualMicrophone: VirtualMicrophone,
): Promise<void> => {
    const initialQuestionText = normalizeVisibleText(
        await getQuestionText(interviewQuestionPage),
    )
    const remainingSeconds = timeToSeconds(
        await interviewQuestionPage.remainingTime.innerText(),
    )
    const timeoutMs = (remainingSeconds + questionTimeoutBufferSeconds) * 1000

    await expect
        .poll(
            async () => {
                await virtualMicrophone.emitTone(timeoutToneDurationMs)

                if (await isInterviewCompleteVisible(interviewQuestionPage.page)) {
                    return true
                }

                const currentQuestionText = normalizeVisibleText(
                    await getQuestionText(interviewQuestionPage).catch(() => ''),
                )

                if (
                    currentQuestionText &&
                    currentQuestionText !== initialQuestionText
                ) {
                    return true
                }

                const currentTimerSeconds = await interviewQuestionPage.remainingTime
                    .innerText()
                    .then(timeToSeconds)
                    .catch(() => 0)

                return currentTimerSeconds <= 1
            },
            {
                intervals: [timeoutToneIntervalMs],
                timeout: timeoutMs,
            },
        )
        .toBe(true)
}

const waitForCurrentQuestionTimerToStart = async (
    interviewQuestionPage: InterviewQuestionPage,
    initialTimerSeconds: number,
): Promise<void> => {
    await expect
        .poll(
            async () =>
                timeToSeconds(await interviewQuestionPage.remainingTime.innerText()),
            {
                intervals: [500],
                timeout: 30000,
            },
        )
        .toBeLessThan(initialTimerSeconds)
}

const prepareCurrentQuestionForApplicantAnswer = async (
    interviewQuestionPage: InterviewQuestionPage,
    virtualMicrophone: VirtualMicrophone,
): Promise<void> => {
    const initialTimerSeconds = timeToSeconds(
        await interviewQuestionPage.remainingTime.innerText(),
    )
    const toneStartedAt = Date.now()

    await virtualMicrophone.emitTone(
        answerRecorderActivationToneMs,
        answerRecorderActivationToneGain,
    )
    await waitForCurrentQuestionTimerToStart(
        interviewQuestionPage,
        initialTimerSeconds,
    )
    await expect(interviewQuestionPage.submitAnswerBtn).toBeEnabled({
        timeout: 30000,
    })

    const remainingToneMs = Math.max(
        answerRecorderActivationToneMs - (Date.now() - toneStartedAt),
        0,
    )

    await wait(remainingToneMs + answerRecorderSettleMs)
}

const waitForApplicantAnswerToFlush = async (): Promise<void> => {
    await wait(answerRecordingFlushMs)
}

const resolveDeepDiveAdvanceMethod = (
    advanceMethod:
        | InteractiveFlowAdvanceMethod
        | InteractiveFlowAdvanceMethod[],
    deepDiveIndex: number,
): InteractiveFlowAdvanceMethod => {
    if (Array.isArray(advanceMethod)) {
        return advanceMethod[deepDiveIndex] ?? advanceMethod.at(-1) ?? 'submit'
    }

    return advanceMethod
}

const answerDeepDiveQuestion = async ({
    deepDiveAdvanceMethod,
    flow,
    interviewLanguage,
    interviewQuestionPage,
    leadUpQuestionIndex,
    lmStudio,
    questionRecords,
    questionText,
    totalLeadUpQuestions,
    virtualMicrophone,
}: AnswerDeepDiveQuestionOptions): Promise<void> => {
    await expect(interviewQuestionPage.questionCount).toHaveText(
        `${leadUpQuestionIndex}/${totalLeadUpQuestions}`,
    )
    await expect(interviewQuestionPage.intervieweeVideoFeedback).toBeVisible()
    await expect
        .poll(() => interviewQuestionPage.isIntervieweeVideoPlaying(), {
            timeout: 10000,
        })
        .toBe(true)

    const answerPromise = lmStudio.ask(
        buildDeepDiveAnswerPrompt({
            interviewLanguage,
            previousLeadUpAnswer: getLatestLeadUpAnswer(questionRecords),
            questionText,
        }),
        {
            maxTokens: 150,
            systemPrompt:
                "You are the interview candidate. Answer only with the candidate's spoken response.",
        },
    )

    const answer = await answerPromise

    questionRecords.push({
        question: questionText,
        answer,
        isDeepDive: true,
    })

    const answerAudioBase64 =
        await virtualMicrophone.createSpeechAudioBase64(answer)

    await prepareCurrentQuestionForApplicantAnswer(
        interviewQuestionPage,
        virtualMicrophone,
    )
    await virtualMicrophone.playAudioBase64(answerAudioBase64, {
        startDelayMs: 0,
    })
    await waitForApplicantAnswerToFlush()

    await advanceCurrentQuestion({
        advanceMethod: deepDiveAdvanceMethod,
        flow,
        interviewQuestionPage,
        virtualMicrophone,
    })
}

const advanceCurrentQuestion = async ({
    advanceMethod,
    flow,
    interviewQuestionPage,
    virtualMicrophone,
}: {
    advanceMethod: InteractiveFlowAdvanceMethod
    flow: InterviewFlowActions
    interviewQuestionPage: InterviewQuestionPage
    virtualMicrophone: VirtualMicrophone
}): Promise<void> => {
    if (advanceMethod === 'submit') {
        await flow.submitCurrentQuestion()
        return
    }

    await waitForCurrentQuestionTimerToExpire(
        interviewQuestionPage,
        virtualMicrophone,
    )
}

const waitForInterviewerAudioToFinishOrCompletion = async (
    flow: InterviewFlowActions,
    page: Page,
): Promise<void> => {
    await flow.waitForInterviewerAudioToFinish().catch(async (error) => {
        if (!(await isInterviewCompleteVisible(page))) {
            throw error
        }
    })
}

const waitForNextLeadUpOrCompletion = async ({
    flow,
    interviewQuestionPage,
    leadUpQuestionIndex,
    page,
    totalLeadUpQuestions,
    virtualMicrophone,
}: {
    flow: InterviewFlowActions
    interviewQuestionPage: InterviewQuestionPage
    leadUpQuestionIndex: number
    page: Page
    totalLeadUpQuestions: number
    virtualMicrophone: VirtualMicrophone
}): Promise<void> => {
    const nextQuestionIndex = leadUpQuestionIndex + 1

    if (nextQuestionIndex < totalLeadUpQuestions) {
        await virtualMicrophone.resetObservedAudioPlayback()
        await expect(interviewQuestionPage.questionCount).toHaveText(
            `${nextQuestionIndex}/${totalLeadUpQuestions}`,
            { timeout: 30000 },
        )
        await flow.waitForInterviewerAudioToFinish()
        return
    }

    await expect(
        page.getByText(/The interview is now complete|面接が完了しました/i),
    ).toBeVisible({ timeout: 30000 })
}

const isAnsweredQuestionRecord = (
    record: InteractiveFlowQuestionRecord,
): record is AnsweredQuestionRecord => record.answer !== null

const questionTypeLabel = (isDeepDive: boolean): string =>
    isDeepDive ? 'Deep dive' : 'Lead-up'

export const answerLeadUpQuestion = async ({
    flow,
    interviewerAudioAlreadyFinished = false,
    page,
    questionData,
    questionIndex,
    totalLeadUpQuestions,
    virtualMicrophone,
}: AnswerLeadUpQuestionOptions): Promise<void> => {
    const interviewQuestionPage = new InterviewQuestionPage(page)

    await expect(interviewQuestionPage.interviewerPreview).toBeVisible()
    await expect(interviewQuestionPage.intervieweeVideoFeedback).toBeVisible()
    await expect
        .poll(() => interviewQuestionPage.isIntervieweeVideoPlaying(), {
            timeout: 10000,
        })
        .toBe(true)

    await expect(interviewQuestionPage.questionCount).toHaveText(
        `${questionIndex}/${totalLeadUpQuestions}`,
        { timeout: 15000 },
    )
    await expect(interviewQuestionPage.questionText).toContainText(
        questionData.question,
    )

    if (!interviewerAudioAlreadyFinished) {
        await flow.waitForInterviewerAudioToFinish()
    }

    await expect(interviewQuestionPage.remainingTime).toHaveText(formatTimer(60))

    const answerAudioBase64 =
        await virtualMicrophone.createSpeechAudioBase64(questionData.answer)

    await prepareCurrentQuestionForApplicantAnswer(
        interviewQuestionPage,
        virtualMicrophone,
    )
    await virtualMicrophone.playAudioBase64(answerAudioBase64, {
        startDelayMs: 0,
    })
    await waitForApplicantAnswerToFlush()
}

export const handleDeepDiveLoop = async ({
    closingRemark,
    flow,
    leadUpAdvanceMethod,
    page,
    questionRecords,
    totalLeadUpQuestions,
    virtualMicrophone,
    ...deepDiveOptions
}: HandleDeepDiveLoopOptions): Promise<DeepDiveLoopResult> => {
    const interviewQuestionPage = new InterviewQuestionPage(page)
    let deepDiveCount = 0
    let sawClosingRemark = false
    let previousQuestionText = await getQuestionText(interviewQuestionPage)

    await advanceCurrentQuestion({
        advanceMethod: leadUpAdvanceMethod,
        flow,
        interviewQuestionPage,
        virtualMicrophone,
    })

    let shouldContinueDeepDiveLoop = true
    while (shouldContinueDeepDiveLoop) {
        if (await isInterviewCompleteVisible(page)) {
            shouldContinueDeepDiveLoop = false
            continue
        }

        let questionText = await getQuestionText(interviewQuestionPage).catch(
            () => '',
        )

        if (
            normalizeVisibleText(questionText) ===
            normalizeVisibleText(previousQuestionText)
        ) {
            await virtualMicrophone.resetObservedAudioPlayback()
            await flow.waitForInterviewerAudioToStart()
            questionText = await waitForQuestionTextToChange(
                interviewQuestionPage,
                previousQuestionText,
            )
        }

        if (isClosingRemarkText(questionText, closingRemark)) {
            sawClosingRemark = true
            await waitForInterviewerAudioToFinishOrCompletion(flow, page)
            expect(deepDiveCount).toBeGreaterThanOrEqual(1)
            shouldContinueDeepDiveLoop = false
            continue
        }

        await waitForInterviewerAudioToFinishOrCompletion(flow, page)
        previousQuestionText = questionText

        await answerDeepDiveQuestion({
            ...deepDiveOptions,
            deepDiveAdvanceMethod: resolveDeepDiveAdvanceMethod(
                deepDiveOptions.deepDiveAdvanceMethod,
                deepDiveCount,
            ),
            flow,
            interviewQuestionPage,
            questionRecords,
            questionText,
            totalLeadUpQuestions,
            virtualMicrophone,
        })
        deepDiveCount++
    }

    await waitForNextLeadUpOrCompletion({
        flow,
        interviewQuestionPage,
        leadUpQuestionIndex: deepDiveOptions.leadUpQuestionIndex,
        page,
        totalLeadUpQuestions,
        virtualMicrophone,
    })

    return { deepDiveCount, sawClosingRemark }
}

export const verifyInteractiveFlowReport = async ({
    interviewSessionId,
    pageAdmin,
    questionRecords,
    scenarioLabel,
}: VerifyReportOptions): Promise<void> => {
    await refreshAdminBrowserAuth(pageAdmin)
    const reportTab = await pageAdmin.context().newPage()
    const reportPage = new ReportPage(reportTab)

    await reportPage.goto(interviewSessionId)

    await reportTab.waitForLoadState('domcontentloaded')
    await reportTab.bringToFront()

    await expect(async () => {
        await reportTab.reload({ waitUntil: 'domcontentloaded' })
        await expect(
            reportPage.page.locator('main').getByText(reportGenerationErrorPattern),
        ).toHaveCount(0)
        await expect(reportPage.examLogHeading).toBeVisible({
            timeout: 10000,
        })
        await expect(reportPage.recordingVideo).toBeVisible()
    }).toPass({
        intervals: [15000, 30000, 60000],
        timeout: 420000,
    })

    const totalQuestions = questionRecords.length
    await expect(reportPage.recordingQuestionButtons).toHaveCount(totalQuestions)

    await reportPage.openTranscript()
    await expect(reportPage.transcriptPanel).toBeVisible()
    await expect(
        reportPage.examLogSection.getByText(transcriptionErrorPattern),
    ).toHaveCount(0)

    const answeredQuestions = questionRecords.filter(isAnsweredQuestionRecord)
    await expect
        .poll(async () => (await reportPage.getCandidateTranscriptTexts()).length, {
            timeout: 60000,
        })
        .toBeGreaterThanOrEqual(answeredQuestions.length)

    const transcriptTexts = await reportPage.getCandidateTranscriptTexts()

    for (const transcriptText of transcriptTexts) {
        expect(
            normalizeForTranscriptionComparison(transcriptText).length,
        ).toBeGreaterThan(0)
        expect(transcriptText).not.toMatch(transcriptionErrorPattern)
    }

    for (const { question, answer, isDeepDive } of answeredQuestions) {
        const bestTranscriptSimilarity = Math.max(
            ...transcriptTexts.map((transcriptText) =>
                calculateTranscriptionSimilarity(answer, transcriptText),
            ),
        )

        expect(
            bestTranscriptSimilarity,
            `${scenarioLabel}: ${questionTypeLabel(
                isDeepDive,
            )} question "${question.substring(
                0,
                50,
            )}..." transcript should be at least 60% similar`,
        ).toBeGreaterThanOrEqual(0.6)
    }

    await reportPage.selectRecordingQuestion(1)
    await expect
        .poll(() => reportPage.isRecordingReady(), { timeout: 30000 })
        .toBe(true)

    const initialRecordingTime = await reportPage.getRecordingCurrentTime()

    await reportPage.playRecording()
    await expect
        .poll(() => reportPage.getRecordingCurrentTime(), {
            timeout: 15000,
        })
        .toBeGreaterThan(initialRecordingTime)
    await expect
        .poll(() => reportPage.isRecordingPlaying(), { timeout: 10000 })
        .toBe(true)
    await reportPage.pauseRecording()
}
