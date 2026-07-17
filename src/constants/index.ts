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
