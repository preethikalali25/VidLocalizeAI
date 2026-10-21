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
  | "error"
  // multi_speaker pipeline only (see Phase 4 plan)
  | "diarizing"
  | "awaiting_speaker_review"
  | "processing_segments"
  | "compositing"
  // script_drama pipeline only -- generates an original video from a
  // script, no source video at all.
  | "parsing_script"
  | "awaiting_character_avatars"
  | "translating_lines"
  | "generating_clips"
  | "assembling_video";

export type Language = "hindi" | "telugu" | "tamil" | "kannada" | "bengali";
export type AvatarCategory = "man" | "woman" | "boy_child" | "girl_child" | "old_man" | "old_woman";
export type InputMethod = "url" | "upload";

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
  avatar_category: AvatarCategory | null;
  pipeline_mode: "single_avatar" | "multi_speaker" | "script_drama";
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

// Shape of a row from the `avatar_photos` table.
export interface AvatarPhotoRecord {
  user_id: string;
  category: AvatarCategory;
  storage_path: string;
  updated_at: string;
}

// multi_speaker pipeline only (see Phase 4 plan). Shape of a row from the
// `job_speakers` table.
export interface JobSpeakerRecord {
  id: string;
  job_id: string;
  speaker_label: string;
  representative_frame_storage_path: string | null;
  avatar_category: AvatarCategory | null;
  suggested_avatar_category: AvatarCategory | null;
}

// multi_speaker pipeline only. Shape of a row from the `job_segments`
// table -- ProcessingPage only needs a few fields (a text preview per
// speaker for the review screen), not the full pipeline-internal shape.
export interface JobSegmentRecord {
  id: string;
  speaker_id: string;
  sequence_index: number;
  source_text: string | null;
  status: "pending_tts" | "awaiting_followers" | "merged" | "pending_faceswap" | "pending_lipsync" | "ready" | "failed";
}

// script_drama pipeline only. Shape of a row from the `drama_characters`
// table.
export interface DramaCharacterRecord {
  id: string;
  job_id: string;
  name: string;
  avatar_category: AvatarCategory | null;
  suggested_avatar_category: AvatarCategory | null;
}

// script_drama pipeline only. Shape of a row from the `drama_lines`
// table -- ProcessingPage only needs a preview per character, not the
// full pipeline-internal shape.
export interface DramaLineRecord {
  id: string;
  character_id: string;
  sequence_index: number;
  source_text: string;
  status: "pending_tts" | "pending_clip" | "ready" | "failed";
}
