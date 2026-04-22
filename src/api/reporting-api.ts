import { APIRequestContext, APIResponse, Page } from "@playwright/test";
import type {
  CompanyMfaPolicyUpdateRequest,
  CompleteMultipartUploadRequest,
  CreateCandidateRequest,
  CreateCompanyRequest,
  CreateInterviewCommonLinkRequest,
  CreateInterviewFlowRequest,
  CreateInterviewQuestionRequest,
  CreateInterviewTranscriptRequest,
  CreateTextQuestionRequest,
  FeedbackPromptCreateRequest,
  FeedbackPromptUpdateRequest,
  InteractiveInterviewCustomSystemPromptCreateRequest,
  InteractiveInterviewCustomSystemPromptUpdateRequest,
  InteractiveInterviewQuestionCustomSystemPromptCreateRequest,
  InteractiveInterviewQuestionCustomSystemPromptUpdateRequest,
  InterviewSessionMemoCreateUpdateRequest,
  InterviewStatusEnum,
  LoginChallengeRequest,
  LoginRequest,
  RecruiterCreateRequest,
  SaveTextResponseRequest,
  ScoringPromptCreateRequest,
  SendUniqueInterviewLink,
  SsoAuthorizeUrlRequest,
  SsoCallbackRequest,
  SummaryPromptCreateRequest,
  TenantSsoConfigUpsertRequest,
  UpdateInteractiveInterviewQuestionCustomSystemPromptRequest,
  UpdateInterviewFlowCustomSystemPromptRequest,
  UpdateInterviewFlowFeedbackRequest,
  UpdateInterviewSessionProgress,
  UpdateInterviewSessionStatus,
  UpdateQuestionDeepDiveLimitsRequest,
} from "@src/api/types";

export class ReportingApi {
  private readonly request: APIRequestContext;
  private readonly BASE = "reporting";
  private readonly authToken?: string;

  constructor(pageOrRequest: Page | APIRequestContext, authToken?: string) {
    // Page has a .request property (APIRequestContext); APIRequestContext does not
    this.request = (pageOrRequest as Page).request
      ?? (pageOrRequest as APIRequestContext);
    this.authToken = authToken;
  }

  private url(path: string): string {
    return `${this.BASE}/${path}`;
  }

  private authHeaders(): Record<string, string> {
    if (!this.authToken) return {};
    return { Authorization: `Bearer ${this.authToken}` };
  }

  // ── Health ──────────────────────────────────────────────

  async getHealth(): Promise<APIResponse> {
    return this.request.get(this.url("health"), {
      headers: this.authHeaders(),
    });
  }

  // ── Recruiters ──────────────────────────────────────────

  async registerRecruiter(data: RecruiterCreateRequest): Promise<APIResponse> {
    return this.request.post(this.url("recruiters/register"), {
      data,
      headers: this.authHeaders(),
    });
  }

  async getRecruiter(email: string): Promise<APIResponse> {
    return this.request.get(
      this.url(`recruiters/${encodeURIComponent(email)}`),
      { headers: this.authHeaders() },
    );
  }

  async deleteRecruiter(email: string): Promise<APIResponse> {
    return this.request.delete(
      this.url(`recruiters/${encodeURIComponent(email)}`),
      { headers: this.authHeaders() },
    );
  }

  // ── Login ───────────────────────────────────────────────

  async login(data: LoginRequest): Promise<APIResponse> {
    return this.request.post(this.url("login"), {
      data,
      headers: this.authHeaders(),
    });
  }

  async loginChallenge(data: LoginChallengeRequest): Promise<APIResponse> {
    return this.request.post(this.url("login/challenge"), {
      data,
      headers: this.authHeaders(),
    });
  }

  // ── Auth / SSO ──────────────────────────────────────────

  async getTenantConfig(tenant: string): Promise<APIResponse> {
    const params = new URLSearchParams({ tenant });
    return this.request.get(this.url(`auth/tenant-config?${params}`), {
      headers: this.authHeaders(),
    });
  }

  async upsertTenantConfig(
    data: TenantSsoConfigUpsertRequest,
  ): Promise<APIResponse> {
    return this.request.put(this.url("auth/tenant-config"), {
      data,
      headers: this.authHeaders(),
    });
  }

  async createSsoAuthorizeUrl(
    data: SsoAuthorizeUrlRequest,
  ): Promise<APIResponse> {
    return this.request.post(this.url("auth/sso/authorize-url"), {
      data,
      headers: this.authHeaders(),
    });
  }

  async handleSsoCallback(data: SsoCallbackRequest): Promise<APIResponse> {
    return this.request.post(this.url("auth/callback"), {
      data,
      headers: this.authHeaders(),
    });
  }

  async getSsoLogoutUrl(
    tenant: string,
    logoutUri: string,
  ): Promise<APIResponse> {
    const params = new URLSearchParams({
      tenant,
      logout_uri: logoutUri,
    });
    return this.request.get(this.url(`auth/logout-url?${params}`), {
      headers: this.authHeaders(),
    });
  }

  async getPostLogoutContext(state: string): Promise<APIResponse> {
    const params = new URLSearchParams({ state });
    return this.request.get(this.url(`auth/post-logout-context?${params}`), {
      headers: this.authHeaders(),
    });
  }

  // ── Companies ───────────────────────────────────────────

  async createCompany(data: CreateCompanyRequest): Promise<APIResponse> {
    return this.request.post(this.url("companies"), {
      data,
      headers: this.authHeaders(),
    });
  }

  async getCompany(companyId: number): Promise<APIResponse> {
    return this.request.get(this.url(`companies/${companyId}`), {
      headers: this.authHeaders(),
    });
  }

  async deleteCompany(companyId: number): Promise<APIResponse> {
    return this.request.delete(this.url(`companies/${companyId}`), {
      headers: this.authHeaders(),
    });
  }

  async updateCompanyMfaPolicy(
    companyId: number,
    data: CompanyMfaPolicyUpdateRequest,
  ): Promise<APIResponse> {
    return this.request.patch(this.url(`companies/${companyId}/mfa-policy`), {
      data,
      headers: this.authHeaders(),
    });
  }

  async syncCompanyMfaPolicy(companyId: number): Promise<APIResponse> {
    return this.request.post(
      this.url(`companies/${companyId}/mfa-policy:sync`),
      { headers: this.authHeaders() },
    );
  }

  // ── Candidates ──────────────────────────────────────────

  async getCandidates(): Promise<APIResponse> {
    return this.request.get(this.url("candidates"), {
      headers: this.authHeaders(),
    });
  }

  async createCandidate(data: CreateCandidateRequest): Promise<APIResponse> {
    return this.request.post(this.url("candidates"), {
      data,
      headers: this.authHeaders(),
    });
  }

  async getCandidate(candidateId: number): Promise<APIResponse> {
    return this.request.get(this.url(`candidates/${candidateId}`), {
      headers: this.authHeaders(),
    });
  }

  async deleteCandidate(candidateId: number): Promise<APIResponse> {
    return this.request.delete(this.url(`candidates/${candidateId}`), {
      headers: this.authHeaders(),
    });
  }

  async exportCandidates(params?: {
    interview_flow_ids?: number[];
    interview_status?: InterviewStatusEnum;
    search_query?: string;
  }): Promise<APIResponse> {
    const searchParams = new URLSearchParams();
    if (params?.interview_flow_ids) {
      for (const id of params.interview_flow_ids) {
        searchParams.append("interview_flow_ids", id.toString());
      }
    }
    if (params?.interview_status) {
      searchParams.set("interview_status", params.interview_status);
    }
    if (params?.search_query) {
      searchParams.set("search_query", params.search_query);
    }
    const qs = searchParams.toString();
    return this.request.get(
      this.url(`candidates/export${qs ? `?${qs}` : ""}`),
      { headers: this.authHeaders() },
    );
  }

  // ── Interview Flows ─────────────────────────────────────

  async getInterviewFlows(): Promise<APIResponse> {
    return this.request.get(this.url("interview_flows"), {
      headers: this.authHeaders(),
    });
  }

  async createInterviewFlow(
    data: CreateInterviewFlowRequest,
  ): Promise<APIResponse> {
    return this.request.post(this.url("interview_flows"), {
      data,
      headers: this.authHeaders(),
    });
  }

  async getInterviewFlow(
    interviewFlowId: number,
    interviewLink?: string,
  ): Promise<APIResponse> {
    const base = `interview_flows/${interviewFlowId}`;
    if (interviewLink) {
      const params = new URLSearchParams({
        interview_link: interviewLink,
      });
      return this.request.get(this.url(`${base}?${params}`), {
        headers: this.authHeaders(),
      });
    }
    return this.request.get(this.url(base), {
      headers: this.authHeaders(),
    });
  }

  async deleteInterviewFlow(interviewFlowId: number): Promise<APIResponse> {
    return this.request.delete(
      this.url(`interview_flows/${interviewFlowId}`),
      { headers: this.authHeaders() },
    );
  }

  async updateInterviewFlowFeedback(
    interviewFlowId: number,
    data: UpdateInterviewFlowFeedbackRequest,
  ): Promise<APIResponse> {
    return this.request.patch(
      this.url(`interview_flows/${interviewFlowId}/feedback`),
      { data, headers: this.authHeaders() },
    );
  }

  async updateInterviewFlowCustomSystemPrompt(
    interviewFlowId: number,
    data: UpdateInterviewFlowCustomSystemPromptRequest,
  ): Promise<APIResponse> {
    const path =
      `interview_flows/${interviewFlowId}` +
      `/interactive_interview_custom_system_prompt`;
    return this.request.patch(this.url(path), {
      data,
      headers: this.authHeaders(),
    });
  }

  async updateQuestionDeepDiveLimits(
    interviewFlowId: number,
    questionId: number,
    data: UpdateQuestionDeepDiveLimitsRequest,
  ): Promise<APIResponse> {
    const path =
      `interview_flows/${interviewFlowId}` +
      `/questions/${questionId}/deep_dive_limits`;
    return this.request.patch(this.url(path), {
      data,
      headers: this.authHeaders(),
    });
  }

  async updateInteractiveInterviewQuestionCustomSystemPrompt(
    interviewFlowId: number,
    questionId: number,
    data: UpdateInteractiveInterviewQuestionCustomSystemPromptRequest,
  ): Promise<APIResponse> {
    const path =
      `interview_flows/${interviewFlowId}` +
      `/questions/${questionId}/custom_system_prompt`;
    return this.request.patch(this.url(path), {
      data,
      headers: this.authHeaders(),
    });
  }

  // ── Interview Sessions ──────────────────────────────────

  async getInterviewSession(interviewSessionId: number): Promise<APIResponse> {
    return this.request.get(
      this.url(`interview_sessions/${interviewSessionId}`),
      { headers: this.authHeaders() },
    );
  }

  async deleteInterviewSession(
    interviewSessionId: number,
  ): Promise<APIResponse> {
    return this.request.delete(
      this.url(`interview_sessions/${interviewSessionId}`),
      { headers: this.authHeaders() },
    );
  }

  async updateInterviewSessionProgress(
    interviewSessionId: number,
    data: UpdateInterviewSessionProgress,
  ): Promise<APIResponse> {
    return this.request.put(
      this.url(`interview_sessions/${interviewSessionId}/question_progress`),
      { data, headers: this.authHeaders() },
    );
  }

  async updateInterviewSessionStatus(
    interviewSessionId: number,
    data: UpdateInterviewSessionStatus,
  ): Promise<APIResponse> {
    return this.request.put(
      this.url(`interview_sessions/${interviewSessionId}/status`),
      { data, headers: this.authHeaders() },
    );
  }

  async getInterviewSessionsByCandidate(
    candidateId: number,
  ): Promise<APIResponse> {
    return this.request.get(
      this.url(`interview_sessions/candidate/${candidateId}`),
      { headers: this.authHeaders() },
    );
  }

  async getInterviewSessionByLink(interviewLink: string): Promise<APIResponse> {
    return this.request.get(
      this.url(
        `interview_sessions/interview_link/${encodeURIComponent(interviewLink)}`,
      ),
      { headers: this.authHeaders() },
    );
  }

  async startInterview(interviewSessionId: number): Promise<APIResponse> {
    return this.request.put(
      this.url(`interview_sessions/${interviewSessionId}/start_interview`),
      { headers: this.authHeaders() },
    );
  }

  async endInterview(interviewSessionId: number): Promise<APIResponse> {
    return this.request.put(
      this.url(`interview_sessions/${interviewSessionId}/end_interview`),
      { headers: this.authHeaders() },
    );
  }

  async getInterviewSessionByEmail(emailAddress: string): Promise<APIResponse> {
    return this.request.get(
      this.url(`interview_sessions/email/${encodeURIComponent(emailAddress)}`),
      { headers: this.authHeaders() },
    );
  }

  async getCandidateAddress(interviewLink: string): Promise<APIResponse> {
    const link = encodeURIComponent(interviewLink);
    return this.request.get(
      this.url(`interview_sessions/${link}/candidate/address`),
      { headers: this.authHeaders() },
    );
  }

  async getCandidateCompanyName(interviewLink: string): Promise<APIResponse> {
    const link = encodeURIComponent(interviewLink);
    return this.request.get(
      this.url(`interview_sessions/${link}/candidate/company/company_name`),
      { headers: this.authHeaders() },
    );
  }

  async getInterviewSessionReports(
    interviewSessionId: number,
  ): Promise<APIResponse> {
    return this.request.get(
      this.url(`interview_sessions/${interviewSessionId}/reports`),
      { headers: this.authHeaders() },
    );
  }

  async generateInterviewSessionReports(
    interviewSessionId: number,
  ): Promise<APIResponse> {
    return this.request.post(
      this.url(`interview_sessions/${interviewSessionId}/reports`),
      { headers: this.authHeaders() },
    );
  }

  async getInterviewSessionFeedbackEmails(
    interviewSessionId: number,
  ): Promise<APIResponse> {
    return this.request.get(
      this.url(`interview_sessions/${interviewSessionId}/feedback_emails`),
      { headers: this.authHeaders() },
    );
  }

  // ── Interview Transcripts ───────────────────────────────

  async createInterviewTranscript(
    data: CreateInterviewTranscriptRequest,
  ): Promise<APIResponse> {
    return this.request.post(this.url("interview_transcripts"), {
      data,
      headers: this.authHeaders(),
    });
  }

  async getInterviewTranscripts(
    interviewSessionId: number,
  ): Promise<APIResponse> {
    return this.request.get(
      this.url(`interview_transcripts/${interviewSessionId}`),
      { headers: this.authHeaders() },
    );
  }

  // ── System Prompts ──────────────────────────────────────

  async createSummaryPrompt(
    data: SummaryPromptCreateRequest,
  ): Promise<APIResponse> {
    return this.request.post(this.url("system_prompts/summary_prompts"), {
      data,
      headers: this.authHeaders(),
    });
  }

  async getSummaryPrompt(summaryPromptId: number): Promise<APIResponse> {
    return this.request.get(
      this.url(`system_prompts/summary_prompts/${summaryPromptId}`),
      { headers: this.authHeaders() },
    );
  }

  async deleteSummaryPrompt(summaryPromptId: number): Promise<APIResponse> {
    return this.request.delete(
      this.url(`system_prompts/summary_prompts/${summaryPromptId}`),
      { headers: this.authHeaders() },
    );
  }

  async createScoringPrompt(
    data: ScoringPromptCreateRequest,
  ): Promise<APIResponse> {
    return this.request.post(this.url("system_prompts/scoring_prompts"), {
      data,
      headers: this.authHeaders(),
    });
  }

  async getScoringPrompt(scoringPromptId: number): Promise<APIResponse> {
    return this.request.get(
      this.url(`system_prompts/scoring_prompts/${scoringPromptId}`),
      { headers: this.authHeaders() },
    );
  }

  async deleteScoringPrompt(scoringPromptId: number): Promise<APIResponse> {
    return this.request.delete(
      this.url(`system_prompts/scoring_prompts/${scoringPromptId}`),
      { headers: this.authHeaders() },
    );
  }

  // ── Interview Questions ─────────────────────────────────

  async createInterviewQuestion(
    data: CreateInterviewQuestionRequest,
  ): Promise<APIResponse> {
    return this.request.post(this.url("interview_questions"), {
      data,
      headers: this.authHeaders(),
    });
  }

  async getInterviewQuestionAudio(
    interviewQuestionId: number,
  ): Promise<APIResponse> {
    return this.request.get(
      this.url(`interview_questions/${interviewQuestionId}/audio`),
      { headers: this.authHeaders() },
    );
  }

  async getInterviewQuestionAudioByToken(
    interviewQuestionId: number,
    token: string,
  ): Promise<APIResponse> {
    const params = new URLSearchParams({ token });
    return this.request.get(
      this.url(
        `interview_questions/${interviewQuestionId}/audio/token?${params}`,
      ),
      { headers: this.authHeaders() },
    );
  }

  async getInterviewQuestionMetadata(
    interviewQuestionId: number,
  ): Promise<APIResponse> {
    return this.request.get(
      this.url(`interview_questions/${interviewQuestionId}/metadata`),
      { headers: this.authHeaders() },
    );
  }

  async getInterviewQuestionMetadataByToken(
    interviewQuestionId: number,
    token: string,
  ): Promise<APIResponse> {
    const params = new URLSearchParams({ token });
    return this.request.get(
      this.url(
        `interview_questions/${interviewQuestionId}/metadata/token?${params}`,
      ),
      { headers: this.authHeaders() },
    );
  }

  // ── Interview Question Responses ────────────────────────

  async getQuestionResponseRecording(responseId: number): Promise<APIResponse> {
    return this.request.get(
      this.url(`interview_question_responses/${responseId}/recording`),
      { headers: this.authHeaders() },
    );
  }

  async generateMultipartS3Url(params: {
    session_token: string;
    question_id: number;
    file_type: string;
    interactive_response_id?: number;
  }): Promise<APIResponse> {
    const searchParams = new URLSearchParams({
      session_token: params.session_token,
      question_id: params.question_id.toString(),
      file_type: params.file_type,
    });
    if (params.interactive_response_id !== undefined) {
      searchParams.set(
        "interactive_response_id",
        params.interactive_response_id.toString(),
      );
    }
    const path = "interview_question_responses/generate_multipart_s3_url";
    return this.request.post(this.url(`${path}?${searchParams}`), {
      headers: this.authHeaders(),
    });
  }

  async completeMultipartS3Upload(
    data: CompleteMultipartUploadRequest,
  ): Promise<APIResponse> {
    return this.request.post(
      this.url("interview_question_responses/complete_multipart_s3_upload"),
      { data, headers: this.authHeaders() },
    );
  }

  // ── Interactive Communication Candidate Responses ───────

  async getInteractiveCandidateResponseRecording(
    id: number,
  ): Promise<APIResponse> {
    const path = `interactive_communication_candidate_responses/${id}/recording`;
    return this.request.get(this.url(path), {
      headers: this.authHeaders(),
    });
  }

  // ── Interview Common Links ──────────────────────────────

  async createInterviewCommonLink(
    data: CreateInterviewCommonLinkRequest,
  ): Promise<APIResponse> {
    return this.request.post(this.url("interview_common_links"), {
      data,
      headers: this.authHeaders(),
    });
  }

  async deleteInterviewCommonLink(
    interviewCommonLinkId: number,
  ): Promise<APIResponse> {
    return this.request.delete(
      this.url(`interview_common_links/${interviewCommonLinkId}`),
      { headers: this.authHeaders() },
    );
  }

  // ── Interview Link (candidate-facing) ───────────────────

  async sendUniqueInterviewLink(
    commonInterviewLink: string,
    data: SendUniqueInterviewLink,
  ): Promise<APIResponse> {
    const link = encodeURIComponent(commonInterviewLink);
    return this.request.post(this.url(`interview/${link}`), {
      data,
      headers: this.authHeaders(),
    });
  }

  async getInterviewLinkCompany(
    commonInterviewLink: string,
  ): Promise<APIResponse> {
    const link = encodeURIComponent(commonInterviewLink);
    return this.request.get(this.url(`interview/${link}/company`), {
      headers: this.authHeaders(),
    });
  }

  // ── Text Questions ──────────────────────────────────────

  async createTextQuestion(
    data: CreateTextQuestionRequest,
  ): Promise<APIResponse> {
    return this.request.post(this.url("text_questions"), {
      data,
      headers: this.authHeaders(),
    });
  }

  async getTextQuestions(interviewLink: string): Promise<APIResponse> {
    return this.request.get(
      this.url(`text_questions/${encodeURIComponent(interviewLink)}`),
      { headers: this.authHeaders() },
    );
  }

  // ── Text Responses ──────────────────────────────────────

  async saveTextResponses(
    interviewLink: string,
    data: SaveTextResponseRequest,
  ): Promise<APIResponse> {
    return this.request.post(
      this.url(`text_responses/${encodeURIComponent(interviewLink)}`),
      { data, headers: this.authHeaders() },
    );
  }

  // ── Reports ─────────────────────────────────────────────

  async getReport(reportId: number): Promise<APIResponse> {
    return this.request.get(this.url(`reports/${reportId}`), {
      headers: this.authHeaders(),
    });
  }

  async getReports(): Promise<APIResponse> {
    return this.request.get(this.url("reports"), {
      headers: this.authHeaders(),
    });
  }

  // ── Feedback Prompts ────────────────────────────────────

  async createFeedbackPrompt(
    data: FeedbackPromptCreateRequest,
  ): Promise<APIResponse> {
    return this.request.post(this.url("feedback_prompts"), {
      data,
      headers: this.authHeaders(),
    });
  }

  async getFeedbackPrompt(feedbackPromptId: number): Promise<APIResponse> {
    return this.request.get(this.url(`feedback_prompts/${feedbackPromptId}`), {
      headers: this.authHeaders(),
    });
  }

  async updateFeedbackPrompt(
    feedbackPromptId: number,
    data: FeedbackPromptUpdateRequest,
  ): Promise<APIResponse> {
    return this.request.patch(
      this.url(`feedback_prompts/${feedbackPromptId}`),
      { data, headers: this.authHeaders() },
    );
  }

  async deleteFeedbackPrompt(feedbackPromptId: number): Promise<APIResponse> {
    return this.request.delete(
      this.url(`feedback_prompts/${feedbackPromptId}`),
      { headers: this.authHeaders() },
    );
  }

  // ── Interactive Interview Custom System Prompts ─────────

  async getCustomSystemPrompts(): Promise<APIResponse> {
    return this.request.get(
      this.url("interactive_interview_custom_system_prompts"),
      { headers: this.authHeaders() },
    );
  }

  async createCustomSystemPrompt(
    data: InteractiveInterviewCustomSystemPromptCreateRequest,
  ): Promise<APIResponse> {
    return this.request.post(
      this.url("interactive_interview_custom_system_prompts"),
      { data, headers: this.authHeaders() },
    );
  }

  async getCustomSystemPrompt(promptId: number): Promise<APIResponse> {
    return this.request.get(
      this.url(`interactive_interview_custom_system_prompts/${promptId}`),
      { headers: this.authHeaders() },
    );
  }

  async updateCustomSystemPrompt(
    promptId: number,
    data: InteractiveInterviewCustomSystemPromptUpdateRequest,
  ): Promise<APIResponse> {
    return this.request.patch(
      this.url(`interactive_interview_custom_system_prompts/${promptId}`),
      { data, headers: this.authHeaders() },
    );
  }

  async deleteCustomSystemPrompt(promptId: number): Promise<APIResponse> {
    return this.request.delete(
      this.url(`interactive_interview_custom_system_prompts/${promptId}`),
      { headers: this.authHeaders() },
    );
  }

  // ── Interactive Interview Question Custom System Prompts ─

  async getQuestionCustomSystemPrompts(): Promise<APIResponse> {
    return this.request.get(
      this.url("interactive_interview_question_custom_system_prompts"),
      { headers: this.authHeaders() },
    );
  }

  async createQuestionCustomSystemPrompt(
    data: InteractiveInterviewQuestionCustomSystemPromptCreateRequest,
  ): Promise<APIResponse> {
    return this.request.post(
      this.url("interactive_interview_question_custom_system_prompts"),
      { data, headers: this.authHeaders() },
    );
  }

  async getQuestionCustomSystemPrompt(promptId: number): Promise<APIResponse> {
    return this.request.get(
      this.url(`interactive_interview_question_custom_system_prompts/${promptId}`),
      { headers: this.authHeaders() },
    );
  }

  async updateQuestionCustomSystemPrompt(
    promptId: number,
    data: InteractiveInterviewQuestionCustomSystemPromptUpdateRequest,
  ): Promise<APIResponse> {
    return this.request.patch(
      this.url(`interactive_interview_question_custom_system_prompts/${promptId}`),
      { data, headers: this.authHeaders() },
    );
  }

  async deleteQuestionCustomSystemPrompt(
    promptId: number,
  ): Promise<APIResponse> {
    return this.request.delete(
      this.url(`interactive_interview_question_custom_system_prompts/${promptId}`),
      { headers: this.authHeaders() },
    );
  }

  // ── Session Memos ───────────────────────────────────────

  async getSessionMemo(
    interviewSessionId: number,
    ifNoneMatch?: string,
  ): Promise<APIResponse> {
    const headers: Record<string, string> = { ...this.authHeaders() };
    if (ifNoneMatch) {
      headers["if-none-match"] = ifNoneMatch;
    }
    return this.request.get(
      this.url(`interview-sessions/${interviewSessionId}/memo`),
      { headers },
    );
  }

  async putSessionMemo(
    interviewSessionId: number,
    data: InterviewSessionMemoCreateUpdateRequest,
    options?: { ifMatch?: string; ifNoneMatch?: string },
  ): Promise<APIResponse> {
    const headers: Record<string, string> = { ...this.authHeaders() };
    if (options?.ifMatch) {
      headers["if-match"] = options.ifMatch;
    }
    if (options?.ifNoneMatch) {
      headers["if-none-match"] = options.ifNoneMatch;
    }
    return this.request.put(
      this.url(`interview-sessions/${interviewSessionId}/memo`),
      { data, headers },
    );
  }
}
