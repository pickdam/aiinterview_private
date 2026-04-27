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
    closingRemarkText: string | null
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
const answerRecorderSettleMs = 500
const answerRecordingFlushMs = 3000
const timeoutSilencePulseDurationMs = 3000
const timeoutSilencePulseIntervalMs = 1000
const closingRemarkSignals = [
    '次に進みます',
    "We'll move to the next question.",
    "Let's move on to the next question.",
    'Lets move on to the next question.',
    "Let's move on.",
    'Lets move on.',
]
const languageNameByCode = {
    en: 'English',
    ja: 'Japanese',
} satisfies Record<InterviewLanguage, string>

const isAnsweredQuestionRecord = (
    record: InteractiveFlowQuestionRecord,
): record is AnsweredQuestionRecord => record.answer !== null

const normalizeVisibleText = (text: string): string =>
    text.replace(/\s+/g, ' ').trim()

const normalizeClosingRemarkText = (text: string): string =>
    normalizeVisibleText(text)
        .toLowerCase()
        .replace(/[’']/g, '')
        .replace(/[.!?,]/g, '')
        .trim()

const normalizeCandidateAnswer = (text: string): string =>
    text
        .replace(/^(Candidate|Candidate answer|Interviewee|受験者|候補者)\s*[:：]\s*/i, '')
        .replace(/^[“"'「」]+|[“"'「」]+$/g, '')
        .replace(/\s+/g, ' ')
        .trim()

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
    const normalizedQuestionText = normalizeClosingRemarkText(questionText)
    const possibleClosingRemarks = [
        scenarioClosingRemark,
        ...closingRemarkSignals,
    ]

    return possibleClosingRemarks.some((closingRemark) =>
        normalizedQuestionText.includes(normalizeClosingRemarkText(closingRemark)),
    )
}

const formatAnsweredQuestionHistory = (
    questionRecords: AnsweredQuestionRecord[],
): string =>
    questionRecords
        .map((record, index) =>
            [
                `${index + 1}. ${record.isDeepDive ? 'Deep dive' : 'Lead-up'} question: ${record.question}`,
                `Candidate answer: ${record.answer}`,
            ].join('\n'),
        )
        .join('\n\n')

const getCurrentTopicHistory = (
    questionRecords: InteractiveFlowQuestionRecord[],
): AnsweredQuestionRecord[] => {
    const answeredRecords = questionRecords.filter(isAnsweredQuestionRecord)
    const lastLeadUpIndex = answeredRecords.findLastIndex(
        (record) => !record.isDeepDive,
    )

    return lastLeadUpIndex === -1
        ? answeredRecords
        : answeredRecords.slice(lastLeadUpIndex)
}

const needsCandidateAnswerRewrite = (answer: string): boolean => {
    const normalizedAnswer = normalizeVisibleText(answer)

    return (
        /[?？]/.test(normalizedAnswer) ||
        /^(can|could|would|will|what|how|why|when|where)\b/i.test(
            normalizedAnswer,
        ) ||
        /(教えていただけますか|いただけますか|でしょうか|ですか)[。.]?$/i.test(
            normalizedAnswer,
        )
    )
}

const buildDeepDiveAnswerPrompt = ({
    questionRecords,
    interviewLanguage,
    questionText,
}: {
    questionRecords: InteractiveFlowQuestionRecord[]
    interviewLanguage: InterviewLanguage
    questionText: string
}): string => {
    const languageName = languageNameByCode[interviewLanguage]
    const answeredRecords = questionRecords
        .filter(isAnsweredQuestionRecord)
        .slice(-6)
    const currentTopicHistory = getCurrentTopicHistory(questionRecords)
    const previousInterviewContext =
        answeredRecords.length > 0
            ? formatAnsweredQuestionHistory(answeredRecords)
            : 'No previous interview context is available.'
    const currentTopicContext =
        currentTopicHistory.length > 0
            ? formatAnsweredQuestionHistory(currentTopicHistory)
            : 'No current topic context is available.'

    return [
        'You are simulating a candidate taking a live job interview.',
        `The interview language is ${languageName}. Always answer only in ${languageName}, even if the interviewer question is written in another language.`,
        'Stay in role as the candidate at all times.',
        'Do not ask the interviewer any questions.',
        'Do not request clarification, do not offer to answer more, and do not switch roles.',
        'Do not use bullet points, labels, quotation marks, or stage directions.',
        'Keep the answer short, professional, and natural: 2 to 4 sentences.',
        'Be consistent with the facts already stated earlier in the interview. If the topic was already answered, expand on the same story instead of inventing a new one.',
        `Previous interview context:\n${previousInterviewContext}`,
        `Current topic context:\n${currentTopicContext}`,
        `Current follow-up question: ${questionText}`,
        'Answer directly as the candidate.',
    ].join('\n\n')
}

const buildCandidateAnswerRewritePrompt = ({
    questionRecords,
    draftAnswer,
    interviewLanguage,
    questionText,
}: {
    questionRecords: InteractiveFlowQuestionRecord[]
    draftAnswer: string
    interviewLanguage: InterviewLanguage
    questionText: string
}): string => {
    const languageName = languageNameByCode[interviewLanguage]
    const answeredRecords = questionRecords
        .filter(isAnsweredQuestionRecord)
        .slice(-6)
    const context =
        answeredRecords.length > 0
            ? formatAnsweredQuestionHistory(answeredRecords)
            : 'No previous interview context is available.'

    return [
        `Rewrite the draft into a final ${languageName} interview answer.`,
        'The speaker is the candidate, not the interviewer.',
        'Remove any follow-up questions, requests for clarification, or interviewer-style phrasing.',
        'Keep the meaning, keep it short and professional, and stay consistent with the existing interview context.',
        'Return only the rewritten candidate answer.',
        `Previous interview context:\n${context}`,
        `Current interviewer question: ${questionText}`,
        `Draft answer: ${draftAnswer}`,
    ].join('\n\n')
}

const rewriteCandidateAnswerIfNeeded = async ({
    answer,
    interviewLanguage,
    lmStudio,
    questionRecords,
    questionText,
}: {
    answer: string
    interviewLanguage: InterviewLanguage
    lmStudio: LmStudioApi
    questionRecords: InteractiveFlowQuestionRecord[]
    questionText: string
}): Promise<string> => {
    const normalizedAnswer = normalizeCandidateAnswer(answer)

    if (!needsCandidateAnswerRewrite(normalizedAnswer)) {
        return normalizedAnswer
    }

    const rewrittenAnswer = normalizeCandidateAnswer(
        await lmStudio.ask(
            buildCandidateAnswerRewritePrompt({
                questionRecords,
                draftAnswer: normalizedAnswer,
                interviewLanguage,
                questionText,
            }),
            {
                maxTokens: 120,
                systemPrompt:
                    'You rewrite job interview candidate answers. Return only the final candidate answer.',
                temperature: 0.1,
            },
        ),
    )

    return rewrittenAnswer || normalizedAnswer
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
                await virtualMicrophone.emitSilence(
                    timeoutSilencePulseDurationMs,
                )

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
                intervals: [timeoutSilencePulseIntervalMs],
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

    await virtualMicrophone.emitSilence(answerRecorderActivationToneMs)
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
            questionRecords,
            interviewLanguage,
            questionText,
        }),
        {
            maxTokens: 120,
            systemPrompt:
                "You are the interview candidate. Answer only with the candidate's spoken response. Never ask a question back.",
            temperature: 0.2,
        },
    )

    const answer = await rewriteCandidateAnswerIfNeeded({
        answer: await answerPromise,
        interviewLanguage,
        lmStudio,
        questionRecords,
        questionText,
    })

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
    let closingRemarkText: string | null = null
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
            closingRemarkText = questionText
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

    return { closingRemarkText, deepDiveCount, sawClosingRemark }
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
