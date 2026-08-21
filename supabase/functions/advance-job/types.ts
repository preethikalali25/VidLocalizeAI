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
  | "error"
  // multi_speaker pipeline only (see Phase 4 plan)
  | "diarizing"
  | "awaiting_speaker_review"
  | "processing_segments"
  | "compositing";

export type AvatarCategory = "man" | "woman" | "boy_child" | "girl_child" | "old_man" | "old_woman";

export interface JobRow {
  id: string;
  user_id: string;
  title: string;
  source_lang: string;
  target_language: string;
  avatar_category: AvatarCategory | null;
  pipeline_mode: "single_avatar" | "multi_speaker";
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

// One row per speaker Gemini's diarization pass detects (multi_speaker jobs
// only). avatar_category starts null and is filled in by the human during
// the awaiting_speaker_review pause -- see submit-speaker-assignments.
export interface JobSpeakerRow {
  id: string;
  job_id: string;
  speaker_label: string;
  representative_frame_storage_path: string | null;
  avatar_category: AvatarCategory | null;
  created_at: string;
  updated_at: string;
}

export type SegmentStatus = "pending_tts" | "pending_faceswap" | "pending_lipsync" | "ready" | "failed";

// One row per speaking segment (multi_speaker jobs only). status tracks
// this segment's own per-stage progress independently of the parent job's
// status -- the segment-loop stages (TTS/face-swap/lip-sync) each process
// whichever of a job's segments are still pending_<that stage>.
export interface JobSegmentRow {
  id: string;
  job_id: string;
  speaker_id: string;
  sequence_index: number;
  start_seconds: number;
  end_seconds: number;
  source_text: string | null;
  translated_text: string | null;
  tts_storage_path: string | null;
  faceswap_prediction_id: string | null;
  faceswap_output_storage_path: string | null;
  lipsync_prediction_id: string | null;
  final_segment_storage_path: string | null;
  status: SegmentStatus;
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

