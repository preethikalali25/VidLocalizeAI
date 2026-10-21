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
  | "compositing"
  // youtube input_method only
  | "fetching_source"
  // script_drama pipeline only -- generates an original video from a
  // script (character + dialogue line pairs) using fictional AI avatars,
  // no source video at all.
  | "parsing_script"
  | "generating_character_avatars"
  | "awaiting_character_avatars"
  | "translating_lines"
  | "generating_clips"
  | "assembling_video";

export type AvatarCategory = "man" | "woman" | "boy_child" | "girl_child" | "old_man" | "old_woman";

export interface JobRow {
  id: string;
  user_id: string;
  title: string;
  source_lang: string;
  target_language: string;
  avatar_category: AvatarCategory | null;
  pipeline_mode: "single_avatar" | "multi_speaker" | "script_drama";
  input_method: string;
  // script_drama only -- the raw script text submitted at job creation.
  script_text: string | null;
  // Null until fetching_source populates it (youtube jobs only) -- direct
  // uploads have this set at job-creation time already.
  source_storage_path: string | null;
  source_youtube_url: string | null;
  source_file_name: string | null;
  source_mime_type: string | null;
  source_duration_seconds: number | null;
  source_size_bytes: number | null;
  status: JobStatus;
  progress: number;
  last_advanced_at: string;
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
  suggested_avatar_category: AvatarCategory | null;
  created_at: string;
  updated_at: string;
}

export type SegmentStatus =
  | "pending_tts"
  | "awaiting_followers"
  | "merged"
  | "pending_faceswap"
  | "pending_lipsync"
  | "ready"
  | "failed";

// One row per speaking segment (multi_speaker jobs only). status tracks
// this segment's own per-stage progress independently of the parent job's
// status -- the segment-loop stages (TTS/face-swap/lip-sync) each process
// whichever of a job's segments are still pending_<that stage>.
//
// block_leader_id is null for a block "leader" (the first segment in a
// run of one speaker's own consecutive segments) and a solo segment
// alike; it points to the leader's id for a "follower". Only a leader
// ever reaches pending_faceswap/pending_lipsync/ready -- a follower stops
// at "merged" once its own TTS is done, see processing_segments.ts.
// block_start_seconds/block_end_seconds are the block's full extended
// range (equal to the segment's own start/end for a solo block) --
// that's what face-swap/lip-sync/compositing actually operate on, not
// the leader's own literal start_seconds/end_seconds.
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
  block_leader_id: string | null;
  block_start_seconds: number | null;
  block_end_seconds: number | null;
  stitched_audio_storage_path: string | null;
}

export type DramaLineStatus = "pending_tts" | "pending_clip" | "ready" | "failed";

// One row per distinct character name found in a script_drama job's
// script (script_drama only). avatar_category starts null and is filled
// in by the human during the awaiting_character_avatars pause -- same
// pattern as JobSpeakerRow.avatar_category for multi_speaker.
export interface DramaCharacterRow {
  id: string;
  job_id: string;
  name: string;
  avatar_category: AvatarCategory | null;
  suggested_avatar_category: AvatarCategory | null;
  // A unique AI-generated photo for this specific character -- separate
  // from the user's shared avatar_photos library, so two characters
  // assigned the same category (e.g. two "man" roles) don't end up
  // looking identical. Null until generating_character_avatars.ts fills
  // it in; generating_clips.ts falls back to the shared avatar_photos
  // category lookup if it's still null (e.g. generation failed and gave
  // up after retries).
  avatar_storage_path: string | null;
  avatar_prediction_id: string | null;
  avatar_retry_count: number;
  created_at: string;
  updated_at: string;
}

// One row per dialogue line, in script order (script_drama only). status
// tracks this line's own per-stage progress (pending_tts -> pending_clip
// -> ready/failed) independently of the parent job's status -- same
// "one tick = one unit of work" shape as JobSegmentRow, just simpler (no
// face-swap, no block-merging -- every line gets its own clip,
// concatenated back to back by assembling_video.ts).
export interface DramaLineRow {
  id: string;
  job_id: string;
  character_id: string;
  sequence_index: number;
  source_text: string;
  translated_text: string | null;
  tts_storage_path: string | null;
  replicate_prediction_id: string | null;
  clip_storage_path: string | null;
  status: DramaLineStatus;
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

