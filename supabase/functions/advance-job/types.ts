export type JobStatus =
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

export interface JobRow {
  id: string;
  user_id: string;
  title: string;
  source_lang: string;
  target_language: string;
  avatar_category: "man" | "woman" | "boy_child" | "girl_child" | "old_man" | "old_woman";
  input_method: string;
  source_storage_path: string;
  source_file_name: string | null;
  source_mime_type: string | null;
  source_duration_seconds: number | null;
  source_size_bytes: number | null;
  status: JobStatus;
  progress: number;
  gemini_file_uri: string | null;
  transcript_text: string | null;
  translated_text: string | null;
  tts_storage_path: string | null;
  replicate_prediction_id: string | null;
  output_storage_path: string | null;
  retry_count: number;
  error_message: string | null;
}

// A stage handler does exactly one unit of work and describes how the job
// row should change. Returning the same `status` the job is already in
// (e.g. lip_syncing polling an in-flight Replicate prediction) is valid --
// it just means "not done yet, try again next tick."
export interface StageResult {
  status: JobStatus;
  progress: number;
  patch?: Partial<JobRow>;
  logMessage: string;
}
