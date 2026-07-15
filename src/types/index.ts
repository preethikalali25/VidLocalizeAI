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

export interface ProcessingStep {
  id: ProcessingStatus;
  label: string;
  description: string;
  duration: number; // ms
}

// Shape of a row from the `jobs` table (Supabase), shared by DashboardPage
// and ProcessingPage rather than each defining their own copy.
export interface JobRecord {
  id: string;
  user_id: string;
  title: string;
  source_lang: string;
  target_language: Language;
  avatar_gender: AvatarGender;
  avatar_style: AvatarStyle;
  avatar_name: string;
  status: ProcessingStatus;
  progress: number;
  source_duration_seconds: number | null;
  output_storage_path: string | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

// Shape of a row from the `job_events` table.
export interface JobEventRecord {
  id: number;
  job_id: string;
  stage: string;
  level: "info" | "error";
  message: string;
  created_at: string;
}
