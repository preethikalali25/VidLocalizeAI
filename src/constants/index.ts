import type { Language, AvatarConfig, ProcessingStep } from "@/types";

export const LANGUAGES: { value: Language; label: string; nativeLabel: string; flag: string }[] = [
  { value: "hindi", label: "Hindi", nativeLabel: "हिन्दी", flag: "🇮🇳" },
  { value: "telugu", label: "Telugu", nativeLabel: "తెలుగు", flag: "🇮🇳" },
  { value: "tamil", label: "Tamil", nativeLabel: "தமிழ்", flag: "🇮🇳" },
  { value: "kannada", label: "Kannada", nativeLabel: "ಕನ್ನಡ", flag: "🇮🇳" },
  { value: "bengali", label: "Bengali", nativeLabel: "বাংলা", flag: "🇮🇳" },
];

export const AVATARS: AvatarConfig[] = [
  { gender: "female", style: "professional", name: "Priya" },
  { gender: "male", style: "professional", name: "Arjun" },
  { gender: "female", style: "casual", name: "Sneha" },
  { gender: "male", style: "casual", name: "Rahul" },
  { gender: "female", style: "news_anchor", name: "Kavitha" },
  { gender: "male", style: "news_anchor", name: "Vikram" },
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

export const MOCK_COMPLETED_JOBS = [
  {
    id: "job_001",
    title: "Machine Learning Tutorial — 完整课程",
    duration: "2h 15m",
    sourceLang: "chinese",
    targetLanguage: "hindi" as Language,
    avatar: { gender: "male" as const, style: "professional" as const, name: "Arjun" },
    status: "complete" as const,
    progress: 100,
    createdAt: new Date(Date.now() - 86400000 * 2),
    completedAt: new Date(Date.now() - 86400000 * 2 + 3600000),
    thumbnailUrl: "https://images.unsplash.com/photo-1515879218367-8466d910aaa4?w=400&h=225&fit=crop",
  },
  {
    id: "job_002",
    title: "Korean Investment Masterclass 주식 투자",
    duration: "1h 48m",
    sourceLang: "korean",
    targetLanguage: "telugu" as Language,
    avatar: { gender: "female" as const, style: "news_anchor" as const, name: "Kavitha" },
    status: "complete" as const,
    progress: 100,
    createdAt: new Date(Date.now() - 86400000),
    completedAt: new Date(Date.now() - 86400000 + 2700000),
    thumbnailUrl: "https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=400&h=225&fit=crop",
  },
];
