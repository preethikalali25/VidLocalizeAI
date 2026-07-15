export type ProcessingStatus =
  | "idle"
  | "validating"
  | "extracting"
  | "transcribing"
  | "translating"
  | "synthesizing_speech"
  | "generating_avatar"
  | "lip_syncing"
  | "rendering"
  | "complete"
  | "error";

export type Language = "hindi" | "telugu" | "tamil" | "kannada" | "bengali";
export type AvatarGender = "male" | "female";
export type AvatarStyle = "professional" | "casual" | "news_anchor";
export type InputMethod = "url" | "upload";

export interface AvatarConfig {
  gender: AvatarGender;
  style: AvatarStyle;
  name: string;
}

export interface VideoJob {
  id: string;
  title: string;
  sourceUrl?: string;
  fileName?: string;
  duration: string;
  sourceLang: string;
  targetLanguage: Language;
  avatar: AvatarConfig;
  status: ProcessingStatus;
  progress: number;
  createdAt: Date;
  completedAt?: Date;
  thumbnailUrl?: string;
  outputUrl?: string;
  currentStep?: string;
  estimatedMinutes?: number;
  errorMessage?: string;
}

export interface ProcessingStep {
  id: ProcessingStatus;
  label: string;
  description: string;
  duration: number; // ms
}
