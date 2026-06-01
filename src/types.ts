export type PromptStatus = "created" | "sent" | "answered" | "failed";

export interface BotSettings {
  newsChannelId?: string;
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
}

export interface ArticleRecord {
  id: string;
  dateKey: string;
  title: string;
  body: string;
  sourcePromptIds: string[];
  postedAt: string;
  messageIds: string[];
}

export interface LastRunState {
  askedDate?: string;
  publishedDate?: string;
}

export interface BotData {
  settings: BotSettings;
  gms: Record<string, GmRecord>;
  prompts: PromptRecord[];
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
