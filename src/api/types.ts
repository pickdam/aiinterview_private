// ============================================================
// Enums (union types)
// ============================================================

export type InterviewStatusEnum =
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "PENDING_REVIEW"
  | "PASSED"
  | "FAILED"
  | "CLOSED";

export type SendStatus = "sent" | "failed" | "pending";

export type ChallengeName = "NEW_PASSWORD_REQUIRED" | "EMAIL_OTP";

export type SttProvider = "openai" | "elevenlabs";

export type TextInputType = "text" | "number" | "email" | "tel" | "url";

export type InterviewLanguage = "ja" | "en";

// ============================================================
// Shared / Nested Types
// ============================================================

export interface QuestionWithTimeLimit {
  question_id: number;
  answer_time_limit: number;
  max_deep_dives?: number;
  min_deep_dives?: number;
}

export interface TextQuestionWithSettings {
  text_question_id: number;
  is_required?: boolean;
}

export interface TextResponseItem {
  text_question_id: number;
  response_value: string;
}

export interface S3MultipartUploadPart {
  part_number: number;
  etag: string;
}

// ============================================================
// Request Types
// ============================================================

export interface RecruiterCreateRequest {
  email: string;
  company_id: number;
  name: string;
}

export interface LoginRequest {
  username: string;
  password: string;
  tenant?: string | null;
}

export interface LoginChallengeRequest {
  challenge_name: ChallengeName;
  challenge_session: string;
  new_password?: string | null;
  mfa_code?: string | null;
}

export interface TenantSsoConfigUpsertRequest {
  company_id: number;
  tenant_identifier: string;
  sso_enabled: boolean;
  cognito_idp_name: string;
  allowed_email_domains?: string[] | null;
}

export interface SsoAuthorizeUrlRequest {
  tenant: string;
  redirect_to?: string | null;
  redirect_uri: string;
  nonce: string;
  code_challenge: string;
}

export interface SsoCallbackRequest {
  code: string;
  state: string;
  redirect_uri: string;
  nonce: string;
  code_verifier: string;
}

export interface CreateCompanyRequest {
  company_name: string;
  stt_provider?: SttProvider;
}

export interface CompanyMfaPolicyUpdateRequest {
  require_mfa: boolean;
}

export interface CreateCandidateRequest {
  registering_company_id?: number | null;
  name: string;
  address: string;
  exam_title: string;
}

export interface CreateInterviewFlowRequest {
  registering_company_id?: number | null;
  interview_name: string;
  interview_description: string;
  is_interactive?: boolean | null;
  ui_version?: number;
  language?: InterviewLanguage;
  questions: QuestionWithTimeLimit[];
  text_questions?: TextQuestionWithSettings[] | null;
  name_label?: string | null;
  name_placeholder?: string | null;
  interview_instructions_page_url?: string | null;
}

export interface UpdateInterviewFlowFeedbackRequest {
  feedback_prompt_id?: number | null;
}

export interface UpdateInterviewFlowCustomSystemPromptRequest {
  interactive_interview_custom_system_prompt_id?: number | null;
}

export interface UpdateQuestionDeepDiveLimitsRequest {
  max_deep_dives: number;
  min_deep_dives: number;
}

export interface UpdateInterviewSessionProgress {
  question_progress: number;
}

export interface UpdateInterviewSessionStatus {
  new_status: InterviewStatusEnum;
}

export interface CreateInterviewTranscriptRequest {
  interview_session_id: number;
}

export interface SummaryPromptCreateRequest {
  prompt: string;
  description: string;
}

export interface ScoringPromptCreateRequest {
  prompt: string;
  description: string;
}

export interface CreateInterviewQuestionRequest {
  transcript: string;
  display_text?: string | null;
  question_category: string;
  question_sub_category?: string | null;
  company_id?: number | null;
  language?: InterviewLanguage;
}

export interface CompleteMultipartUploadRequest {
  upload_id: string;
  object_key: string;
  parts: S3MultipartUploadPart[];
}

export interface CreateInterviewCommonLinkRequest {
  interview_flow_id: number;
  registering_company_id?: number | null;
  max_uses?: number;
}

export interface SendUniqueInterviewLink {
  email_address: string;
}

export interface CreateTextQuestionRequest {
  question_label: string;
  placeholder: string;
  input_type?: TextInputType;
  company_id: number;
}

export interface SaveTextResponseRequest {
  name: string;
  responses: TextResponseItem[];
}

export interface FeedbackPromptCreateRequest {
  content: string;
  description?: string | null;
}

export interface FeedbackPromptUpdateRequest {
  content?: string | null;
  description?: string | null;
}

export interface InteractiveInterviewCustomSystemPromptCreateRequest {
  name: string;
  system_prompt: string;
  description?: string | null;
}

export interface InteractiveInterviewCustomSystemPromptUpdateRequest {
  name?: string | null;
  system_prompt?: string | null;
  description?: string | null;
}

export interface InterviewSessionMemoCreateUpdateRequest {
  content: string;
}

// ============================================================
// Response Types
// ============================================================

export interface CreateCandidateResponse {
  message: string;
  candidate_id: number;
}

export interface InterviewSessionDetails {
  interview_session_id: number;
  interview_flow_id: number;
  interview_status: string;
  created_at: string;
  updated_at?: string | null;
  completed_at?: string | null;
  interview_link: string;
  has_memo: boolean;
  memo_content?: string | null;
}

export interface CandidateWithInterviewSession {
  candidate_id: number;
  name: string;
  address: string;
  exam_title: string | null;
  registering_company_id: number;
  interview_session: InterviewSessionDetails | null;
}

export interface InterviewFlowListItem {
  interview_flow_id: number;
  interview_flow_name: string;
}

export interface InterviewCommonLink {
  created_at: string;
  updated_at: string;
  interview_common_link_id: number;
  interview_flow_id: number;
  registering_company_id: number;
  common_link: string;
  uses: number;
  max_uses: number;
}

export interface FeedbackEmail {
  feedback_email_id: number;
  interview_session_id: number;
  feedback_prompt_id?: number | null;
  recipient_email: string;
  email_subject: string;
  email_content: string;
  send_status: SendStatus;
  sent_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface FeedbackPrompt {
  feedback_prompt_id: number;
  content: string;
  description?: string | null;
  created_at: string;
  updated_at: string;
}

export interface InteractiveInterviewCustomSystemPrompt {
  interactive_interview_custom_system_prompt_id: number;
  name: string;
  system_prompt: string;
  description?: string | null;
  created_at: string;
  updated_at: string;
}

export interface InterviewSessionMemo {
  interview_session_memo_id: number;
  version: number;
  content: string;
  author_sub: string;
  author_name: string;
  created_at: string;
  updated_at: string;
}

export interface InterviewSessionMemoResponse {
  interview_session_id: number;
  latest_memo: InterviewSessionMemo;
}

export interface InterviewQuestionMetadataResponse {
  display_text: string;
  question_category: string;
}

export interface ValidationError {
  loc: (string | number)[];
  msg: string;
  type: string;
}

export interface HTTPValidationError {
  detail: ValidationError[];
}

// ============================================================
// LM Studio / OpenAI Chat Completion Types
// ============================================================

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionRequest {
  model?: string; // Optional, LM Studio uses loaded model
  messages: ChatMessage[];
  temperature?: number; // 0-2, default 0.7
  max_tokens?: number; // Max tokens to generate
  stream?: boolean; // Default false
}

export interface ChatCompletionChoice {
  index: number;
  message: ChatMessage;
  finish_reason: string; // "stop" | "length" | "content_filter"
}

export interface ChatCompletionResponse {
  id: string;
  object: string; // "chat.completion"
  created: number; // Unix timestamp
  model: string;
  choices: ChatCompletionChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface LmStudioModel {
  id: string;
  object: string; // "model"
  owned_by: string;
  permission: unknown[];
}

export interface LmStudioModelsResponse {
  data: LmStudioModel[];
  object: string; // "list"
}
