// Result returned from InterviewBuilder.build()
export interface InterviewBuildResult {
  interviewUrl: string; // "/interview/{uuid}"
  interviewLink: string; // raw UUID token
  interviewFlowId: number;
  interviewSessionId: number;
  candidateId: number;
  commonLinkId: number;
  questionIds: number[];
}

// Internal state for QuestionBuilder
export interface QuestionConfig {
  transcript: string;
  category: string;
  displayText?: string;
  subCategory?: string;
  language?: "ja" | "en";
  timeLimit?: number; // seconds
  maxDeepDives?: number;
  minDeepDives?: number;
  questionCustomSystemPromptId?: number | null;
}

// Text question configuration
export interface TextQuestionConfig {
  label: string;
  placeholder: string;
  inputType?: "text" | "number" | "email" | "tel" | "url";
  required?: boolean;
}
