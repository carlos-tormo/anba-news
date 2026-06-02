export type PromptStatus = "created" | "sent" | "answered" | "failed";
export type ModerationStatus = "accepted" | "rejected";
export type SubmittedQuestionStatus = "accepted" | "rejected" | "used";

export interface BotSettings {
  newsChannelId?: string;
  contextChannelIds: string[];
  contextLookbackHours: number;
  timezone: string;
  dailyQuestionCount: number;
  askHour: number;
  publishHour: number;
}

export interface GmRecord {
  userId: string;
  team: string;
  displayName: string;
  active: boolean;
  addedAt: string;
}

export interface PromptRecord {
  id: string;
  userId: string;
  team: string;
  category: string;
  question: string;
  status: PromptStatus;
  sentAt: string;
  answeredAt?: string;
  answer?: string;
  error?: string;
  contextMessageUrls?: string[];
  submittedQuestionId?: string;
}

export interface ArticleRecord {
  id: string;
  dateKey: string;
  title: string;
  body: string;
  sourcePromptIds: string[];
  sourceRumorIds?: string[];
  postedAt: string;
  messageIds: string[];
}

export interface RumorRecord {
  id: string;
  userId: string;
  userDisplayName: string;
  team?: string;
  text: string;
  status: ModerationStatus;
  moderationReason?: string;
  dateKey: string;
  createdAt: string;
}

export interface SubmittedQuestionRecord {
  id: string;
  userId: string;
  userDisplayName: string;
  targetUserId: string;
  targetDisplayName: string;
  targetTeam: string;
  question: string;
  status: SubmittedQuestionStatus;
  moderationReason?: string;
  dateKey: string;
  createdAt: string;
  usedAt?: string;
  usedPromptId?: string;
}

export interface LastRunState {
  askedDate?: string;
  askedAt?: string;
  askedAttempted?: number;
  askedSent?: number;
  askedFailed?: number;
  publishedDate?: string;
  publishedAt?: string;
  publishedPosted?: boolean;
  publishedReason?: string;
}

export interface BotData {
  settings: BotSettings;
  gms: Record<string, GmRecord>;
  prompts: PromptRecord[];
  rumors: RumorRecord[];
  submittedQuestions: SubmittedQuestionRecord[];
  articles: ArticleRecord[];
  lastRun: LastRunState;
}

export interface QuestionTemplate {
  category: string;
  text: string;
}

export interface AnswerForArticle {
  promptId: string;
  team: string;
  question: string;
  answer: string;
}

export interface RumorForArticle {
  rumorId: string;
  team?: string;
  text: string;
}
