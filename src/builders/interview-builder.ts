import type { Page } from "@playwright/test";
import { ReportingApi } from "@src/api/reporting-api";
import type {
  CreateInterviewQuestionRequest,
  CreateInterviewFlowRequest,
  InterviewLanguage,
} from "@src/api/types";
import { QuestionBuilder } from "./question-builder";
import type {
  InterviewBuildResult,
  QuestionConfig,
  TextQuestionConfig,
} from "./types";

export class InterviewBuilder {
  private readonly api: ReportingApi;

  // Required fields
  private _companyId?: number;
  private _applicantEmail?: string;

  // Question configs
  private questions: QuestionConfig[] = [];
  private textQuestions: TextQuestionConfig[] = [];

  // Optional flow config with defaults
  private flowName?: string;
  private flowDescription?: string;
  private isInteractive = false;
  private flowLanguage: InterviewLanguage = "ja";
  private nameLabel = "受験者名";
  private namePlaceholder = "山田太郎";
  private instructionsUrl =
    "https://givery.notion.site/AI-2146931cc44980e28f86f5aef23d9943";
  private uiVersion = 2;
  private customSystemPromptId?: number;

  // Common link config
  private maxUses = 1;

  constructor(apiOrPage: ReportingApi | Page, authToken?: string) {
    if (apiOrPage instanceof ReportingApi) {
      // It's already a ReportingApi
      this.api = apiOrPage;
    } else {
      // It's a Page
      this.api = new ReportingApi(apiOrPage, authToken);
    }
  }

  // ── Required Config ─────────────────────────────────────

  forCompany(id: number): this {
    this._companyId = id;
    return this;
  }

  sendTo(email: string): this {
    this._applicantEmail = email;
    return this;
  }

  // ── Questions ───────────────────────────────────────────

  withQuestion(configFn: (builder: QuestionBuilder) => QuestionBuilder): this {
    const qb = new QuestionBuilder();
    configFn(qb);
    this.questions.push(qb._toConfig());
    return this;
  }

  withTextQuestion(config: TextQuestionConfig): this {
    this.textQuestions.push(config);
    return this;
  }

  // ── Flow Config ─────────────────────────────────────────

  name(n: string): this {
    this.flowName = n;
    return this;
  }

  description(d: string): this {
    this.flowDescription = d;
    return this;
  }

  interactive(enabled = true): this {
    this.isInteractive = enabled;
    return this;
  }

  language(lang: InterviewLanguage): this {
    this.flowLanguage = lang;
    return this;
  }

  candidateName(label: string, placeholder: string): this {
    this.nameLabel = label;
    this.namePlaceholder = placeholder;
    return this;
  }

  instructions(url: string): this {
    this.instructionsUrl = url;
    return this;
  }

  version(v: number): this {
    this.uiVersion = v;
    return this;
  }

  customPrompt(promptId: number): this {
    this.customSystemPromptId = promptId;
    return this;
  }

  // ── Common Link Config ──────────────────────────────────

  linkMaxUses(uses: number): this {
    this.maxUses = uses;
    return this;
  }

  // ── Build (Execute) ─────────────────────────────────────

  async build(): Promise<InterviewBuildResult> {
    // Validate required fields
    if (!this._companyId) {
      throw new Error("Company ID is required (use .forCompany())");
    }
    if (!this._applicantEmail) {
      throw new Error("Applicant email is required (use .sendTo())");
    }
    if (this.questions.length === 0) {
      throw new Error(
        "At least one question is required (use .withQuestion())",
      );
    }

    const companyId = this._companyId;
    const applicantEmail = this._applicantEmail;

    // Step 1: Create questions
    const questionResponses = await Promise.all(
      this.questions.map((q) => {
        const req: CreateInterviewQuestionRequest = {
          transcript: q.transcript,
          question_category: q.category,
          display_text: q.displayText,
          question_sub_category: q.subCategory,
          company_id: companyId,
          language: q.language || this.flowLanguage,
        };
        return this.api.createInterviewQuestion(req);
      }),
    );

    const questionIds: number[] = [];
    for (const resp of questionResponses) {
      if (!resp.ok()) {
        throw new Error(
          `Failed to create question: ${resp.status()} ${await resp.text()}`,
        );
      }
      const body = await resp.json();
      questionIds.push(body.interview_question_id);
    }

    // Step 2: Create text questions (if any)
    const textQuestionIds: number[] = [];
    for (const tq of this.textQuestions) {
      const resp = await this.api.createTextQuestion({
        question_label: tq.label,
        placeholder: tq.placeholder,
        input_type: tq.inputType,
        company_id: companyId,
      });
      if (!resp.ok()) {
        throw new Error(`Failed to create text question: ${resp.status()}`);
      }
      const body = await resp.json();
      textQuestionIds.push(body.text_question_id);
    }

    // Step 3: Create interview flow
    const timestamp = Date.now();
    const flowReq: CreateInterviewFlowRequest = {
      registering_company_id: companyId,
      interview_name: this.flowName || `E2E Interview ${timestamp}`,
      interview_description: this.flowDescription || "E2E test interview",
      is_interactive: this.isInteractive,
      ui_version: this.uiVersion,
      language: this.flowLanguage,
      questions: this.questions.map((q, i) => ({
        question_id: questionIds[i],
        answer_time_limit: q.timeLimit || 60,
        max_deep_dives: q.maxDeepDives,
        min_deep_dives: q.minDeepDives,
        interactive_interview_question_custom_system_prompt_id:
          q.questionCustomSystemPromptId,
      })),
      text_questions:
        textQuestionIds.length > 0
          ? textQuestionIds.map((id, i) => ({
              text_question_id: id,
              is_required: this.textQuestions[i].required ?? true,
            }))
          : undefined,
      name_label: this.nameLabel,
      name_placeholder: this.namePlaceholder,
      interview_instructions_page_url: this.instructionsUrl,
    };

    const flowResp = await this.api.createInterviewFlow(flowReq);
    if (!flowResp.ok()) {
      throw new Error(`Failed to create interview flow: ${flowResp.status()}`);
    }
    const flowBody = await flowResp.json();
    const interviewFlowId = flowBody.interview_flow_id;

    // Step 4: If interactive + custom prompt, set it
    if (this.isInteractive && this.customSystemPromptId !== undefined) {
      const promptResp = await this.api.updateInterviewFlowCustomSystemPrompt(
        interviewFlowId,
        {
          interactive_interview_custom_system_prompt_id:
            this.customSystemPromptId,
        },
      );
      if (!promptResp.ok()) {
        throw new Error(
          `Failed to set custom system prompt: ${promptResp.status()}`,
        );
      }
    }

    // Step 5: Create common link
    const linkResp = await this.api.createInterviewCommonLink({
      interview_flow_id: interviewFlowId,
      registering_company_id: companyId,
      max_uses: this.maxUses,
    });
    if (!linkResp.ok()) {
      throw new Error(`Failed to create common link: ${linkResp.status()}`);
    }
    const linkBody = await linkResp.json();
    const commonLink = linkBody.common_link;
    const commonLinkId = linkBody.interview_common_link_id;

    // Step 6: Send interview to applicant
    const sendResp = await this.api.sendUniqueInterviewLink(commonLink, {
      email_address: applicantEmail,
    });
    if (!sendResp.ok()) {
      throw new Error(`Failed to send interview link: ${sendResp.status()}`);
    }

    // Step 7: Retrieve session by email
    const sessionResp =
      await this.api.getInterviewSessionByEmail(applicantEmail);
    if (!sessionResp.ok()) {
      throw new Error(
        `Failed to get interview session: ${sessionResp.status()}`,
      );
    }
    const sessionBody = await sessionResp.json();

    return {
      interviewUrl: `/interview/${sessionBody.interview_link}`,
      interviewLink: sessionBody.interview_link,
      interviewFlowId,
      interviewSessionId: sessionBody.interview_session_id,
      candidateId: sessionBody.candidate_id,
      commonLinkId,
      questionIds,
    };
  }
}
