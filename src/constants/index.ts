import type { Language, AvatarCategory, ProcessingStep } from "@/types";

export const LANGUAGES: { value: Language; label: string; nativeLabel: string; flag: string }[] = [
  { value: "hindi", label: "Hindi", nativeLabel: "हिन्दी", flag: "🇮🇳" },
  { value: "telugu", label: "Telugu", nativeLabel: "తెలుగు", flag: "🇮🇳" },
  { value: "tamil", label: "Tamil", nativeLabel: "தமிழ்", flag: "🇮🇳" },
  { value: "kannada", label: "Kannada", nativeLabel: "ಕನ್ನಡ", flag: "🇮🇳" },
  { value: "bengali", label: "Bengali", nativeLabel: "বাংলা", flag: "🇮🇳" },
];

export const AVATAR_CATEGORIES: { value: AvatarCategory; label: string }[] = [
  { value: "man", label: "Man" },
  { value: "woman", label: "Woman" },
  { value: "boy_child", label: "Boy" },
  { value: "girl_child", label: "Girl" },
  { value: "old_man", label: "Old Man" },
  { value: "old_woman", label: "Old Woman" },
];

export const PROCESSING_STEPS: ProcessingStep[] = [
  { id: "validating", label: "Validating Source", description: "Checking video accessibility and format", duration: 2000 },
  { id: "extracting", label: "Extracting Audio", description: "Separating audio track from video", duration: 3000 },
  { id: "transcribing", label: "Transcribing", description: "Converting speech to text using AI", duration: 5000 },
  { id: "translating", label: "Translating", description: "Translating content to target language", duration: 4000 },
  { id: "synthesizing_speech", label: "Synthesizing Speech", description: "Generating translated voice audio", duration: 4000 },
  { id: "generating_avatar", label: "Generating Avatar", description: "Creating AI presenter visuals", duration: 6000 },
  { id: "lip_syncing", label: "Lip Syncing", description: "Synchronizing lips with translated audio", duration: 5000 },
  { id: "rendering", label: "Rendering", description: "Final render and quality check", duration: 4000 },
];

// multi_speaker pipeline only (see Phase 4 plan) -- diarizing/translating
// replace transcribing+translating's single-avatar meaning, and
// processing_segments covers TTS+face-swap+lip-sync for however many
// segments the job has, so it doesn't map to one fixed duration the way
// single_avatar's steps do.
export const MULTI_SPEAKER_PROCESSING_STEPS: ProcessingStep[] = [
  { id: "validating", label: "Validating Source", description: "Checking video accessibility and format", duration: 2000 },
  { id: "extracting", label: "Preparing Video", description: "Handing your video to the AI", duration: 3000 },
  { id: "diarizing", label: "Detecting Speakers", description: "Finding who speaks and when", duration: 6000 },
  { id: "awaiting_speaker_review", label: "Your Review", description: "Waiting for you to assign avatars", duration: 0 },
  { id: "translating", label: "Translating", description: "Translating each speaker's segments", duration: 4000 },
  { id: "processing_segments", label: "Processing Segments", description: "Voice, face swap, and lip sync per speaker", duration: 8000 },
  { id: "compositing", label: "Compositing", description: "Assembling the final video", duration: 5000 },
];

// script_drama pipeline only -- generates an original video from a
// script, no source video at all. parsing_script/generating_clips don't
// map to one fixed duration (they depend on how many lines the script
// has), same reasoning as MULTI_SPEAKER_PROCESSING_STEPS above.
export const SCRIPT_DRAMA_PROCESSING_STEPS: ProcessingStep[] = [
  { id: "parsing_script", label: "Reading Script", description: "Finding characters and their lines", duration: 4000 },
  { id: "generating_character_avatars", label: "Creating Cast", description: "Generating a unique AI avatar per character", duration: 6000 },
  { id: "awaiting_character_avatars", label: "Your Review", description: "Waiting for you to assign avatars", duration: 0 },
  { id: "translating_lines", label: "Translating", description: "Translating each character's lines", duration: 4000 },
  { id: "generating_clips", label: "Generating Clips", description: "Voice and video per line", duration: 8000 },
  { id: "assembling_video", label: "Assembling Video", description: "Stitching every clip together", duration: 5000 },
];

// v1 cap: keeps avatar/lip-sync render cost and turnaround low while the
// real pipeline is being validated. Raise once proven reliable.
export const MAX_UPLOAD_DURATION_SECONDS = 180;
export const MAX_UPLOAD_SIZE_MB = 300;
export const MAX_AVATAR_PHOTO_SIZE_MB = 5;

export const SOURCE_LANGUAGES = [
  { value: "chinese", label: "Chinese (Mandarin)", flag: "🇨🇳" },
  { value: "japanese", label: "Japanese", flag: "🇯🇵" },
  { value: "korean", label: "Korean", flag: "🇰🇷" },
  { value: "spanish", label: "Spanish", flag: "🇪🇸" },
  { value: "french", label: "French", flag: "🇫🇷" },
  { value: "german", label: "German", flag: "🇩🇪" },
  { value: "english", label: "English", flag: "🇬🇧" },
  { value: "arabic", label: "Arabic", flag: "🇸🇦" },
  { value: "russian", label: "Russian", flag: "🇷🇺" },
  { value: "portuguese", label: "Portuguese", flag: "🇧🇷" },
];
