import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Link2, Upload, ChevronRight, Info, X, Film, Lock } from "lucide-react";
import { toast } from "sonner";
import Navbar from "@/components/layout/Navbar";
import { LANGUAGES, AVATARS, SOURCE_LANGUAGES, MAX_UPLOAD_DURATION_SECONDS, MAX_UPLOAD_SIZE_MB } from "@/constants";
import type { Language, InputMethod, AvatarConfig } from "@/types";
import { supabase, isSupabaseConfigured, ensureAnonymousSession } from "@/lib/supabase";

const avatarFemale = `${import.meta.env.BASE_URL}avatars/avatar-female.jpg`;
const avatarMale = `${import.meta.env.BASE_URL}avatars/avatar-male.jpg`;

const STEP_LABELS = ["Source Video", "Target Language", "Choose Avatar", "Confirm"];

function readVideoDurationSeconds(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(video.src);
      resolve(video.duration);
    };
    video.onerror = () => {
      URL.revokeObjectURL(video.src);
      reject(new Error("Could not read video metadata"));
    };
    video.src = URL.createObjectURL(file);
  });
}

export default function NewJobPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStage, setSubmitStage] = useState<"uploading" | "creating" | null>(null);

  // Step 1 -- YouTube URL ingestion isn't supported for real processing yet
  // (no way to fetch a YouTube video from inside a Supabase Edge Function),
  // so upload is the only working input method. The URL tab stays visible
  // but disabled rather than removed, so it's clear it's coming later.
  const [inputMethod, setInputMethod] = useState<InputMethod>("upload");
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [videoDurationSeconds, setVideoDurationSeconds] = useState<number | null>(null);
  const [sourceLang, setSourceLang] = useState("chinese");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Step 2
  const [targetLang, setTargetLang] = useState<Language>("hindi");

  // Step 3
  const [selectedAvatar, setSelectedAvatar] = useState<AvatarConfig>(AVATARS[0]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_UPLOAD_SIZE_MB * 1024 * 1024) {
      toast.error(`File is too large — max ${MAX_UPLOAD_SIZE_MB}MB for now`);
      return;
    }

    try {
      const duration = await readVideoDurationSeconds(file);
      if (duration > MAX_UPLOAD_DURATION_SECONDS) {
        toast.error(`Video is ${Math.round(duration)}s — max ${MAX_UPLOAD_DURATION_SECONDS}s for now`);
        return;
      }
      setVideoDurationSeconds(duration);
      setUploadedFile(file);
    } catch {
      toast.error("Couldn't read that video file — try a different one");
    }
  };

  const validateStep1 = () => {
    if (!uploadedFile) {
      toast.error("Please upload a video file");
      return false;
    }
    return true;
  };

  const handleNext = () => {
    if (step === 1 && !validateStep1()) return;
    if (step < 4) setStep(step + 1);
  };

  const handleSubmit = async () => {
    if (!isSupabaseConfigured || !supabase) {
      toast.error("Real processing isn't set up yet — this build has no Supabase project configured.");
      return;
    }
    if (!uploadedFile) {
      toast.error("Please upload a video file");
      return;
    }

    setIsSubmitting(true);
    try {
      const session = await ensureAnonymousSession();
      if (!session) throw new Error("Couldn't start a session — check Supabase Anonymous sign-ins are enabled");

      setSubmitStage("uploading");
      const uploadId = crypto.randomUUID();
      const storagePath = `${session.user.id}/${uploadId}/${uploadedFile.name}`;
      const { error: uploadError } = await supabase.storage
        .from("job-assets")
        .upload(storagePath, uploadedFile, { contentType: uploadedFile.type });
      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

      setSubmitStage("creating");
      const title = uploadedFile.name.replace(/\.[^.]+$/, "");
      const { data, error: fnError } = await supabase.functions.invoke("create-job", {
        body: {
          title,
          sourceLang,
          targetLanguage: targetLang,
          avatarGender: selectedAvatar.gender,
          avatarStyle: selectedAvatar.style,
          avatarName: selectedAvatar.name,
          sourceStoragePath: storagePath,
          sourceFileName: uploadedFile.name,
          sourceDurationSeconds: videoDurationSeconds,
          sourceSizeBytes: uploadedFile.size,
        },
      });
      if (fnError) throw new Error(fnError.message);
      if (!data?.id) throw new Error("create-job did not return a job id");

      toast.success("Job submitted! Starting AI processing...");
      navigate(`/processing/${data.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to submit job");
    } finally {
      setIsSubmitting(false);
      setSubmitStage(null);
    }
  };

  const avatarImg = (av: AvatarConfig) =>
    av.gender === "female" ? avatarFemale : avatarMale;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="max-w-3xl mx-auto px-4 pt-24 pb-16">
        {/* Header */}
        <div className="mb-10">
          <h1 className="font-display text-3xl font-700 mb-2">Create New Localization Job</h1>
          <p className="text-muted-foreground">Transform your video into an AI-generated Indian language presentation</p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-0 mb-10 overflow-x-auto pb-2">
          {STEP_LABELS.map((label, i) => {
            const n = i + 1;
            const isActive = step === n;
            const isDone = step > n;
            return (
              <div key={label} className="flex items-center flex-shrink-0">
                <div className="flex items-center gap-2">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-600 transition-all ${
                    isDone ? "gradient-primary text-white" :
                    isActive ? "border-2 border-primary text-primary" :
                    "border-2 border-white/10 text-muted-foreground"
                  }`}>
                    {isDone ? "✓" : n}
                  </div>
                  <span className={`text-sm font-medium ${isActive ? "text-foreground" : "text-muted-foreground"}`}>
                    {label}
                  </span>
                </div>
                {i < STEP_LABELS.length - 1 && (
                  <ChevronRight size={16} className="text-muted-foreground mx-3" />
                )}
              </div>
            );
          })}
        </div>

        {/* Step 1: Source Video */}
        {step === 1 && (
          <div className="glass-card rounded-2xl p-8 slide-up">
            <h2 className="font-display text-xl font-600 mb-6">Source Video</h2>

            {/* Input method toggle */}
            <div className="flex rounded-xl overflow-hidden border border-white/10 mb-8 w-fit">
              <button
                disabled
                title="Coming soon — upload a file for now"
                className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-muted-foreground/50 cursor-not-allowed"
              >
                <Link2 size={14} />
                YouTube URL
                <Lock size={11} />
              </button>
              <button
                onClick={() => setInputMethod("upload")}
                className={`flex items-center gap-2 px-5 py-2.5 text-sm font-medium transition-all ${
                  inputMethod === "upload" ? "gradient-primary text-white" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Upload size={14} />
                Upload File
              </button>
            </div>
            <p className="flex items-center gap-1 text-xs text-muted-foreground -mt-6 mb-6">
              <Info size={11} /> YouTube URL processing is coming soon — upload a short clip for now
            </p>

            <div className="mb-6">
              <label className="block text-sm font-medium mb-2 text-muted-foreground">Video File</label>
              <label className="flex flex-col items-center justify-center w-full h-40 border-2 border-dashed border-white/10 rounded-xl cursor-pointer hover:border-primary/40 hover:bg-primary/5 transition-all">
                {uploadedFile ? (
                  <div className="text-center">
                    <Film size={28} className="text-primary mx-auto mb-2" />
                    <p className="font-medium text-sm">{uploadedFile.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {(uploadedFile.size / 1024 / 1024).toFixed(1)} MB
                      {videoDurationSeconds ? ` · ${Math.round(videoDurationSeconds)}s` : ""}
                    </p>
                  </div>
                ) : (
                  <div className="text-center">
                    <Upload size={28} className="text-muted-foreground mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">Click to upload or drag & drop</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      MP4, MOV, WebM · Max {MAX_UPLOAD_SIZE_MB}MB · Max {MAX_UPLOAD_DURATION_SECONDS}s
                    </p>
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>
            </div>

            <div>
              <label className="block text-sm font-medium mb-3 text-muted-foreground">Source Language</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {SOURCE_LANGUAGES.map((lang) => (
                  <button
                    key={lang.value}
                    onClick={() => setSourceLang(lang.value)}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm transition-all ${
                      sourceLang === lang.value
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-white/10 text-muted-foreground hover:border-white/20 hover:text-foreground"
                    }`}
                  >
                    <span>{lang.flag}</span>
                    {lang.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Target Language */}
        {step === 2 && (
          <div className="glass-card rounded-2xl p-8 slide-up">
            <h2 className="font-display text-xl font-600 mb-2">Target Language</h2>
            <p className="text-muted-foreground text-sm mb-8">Choose the Indian language for your output video</p>
            <div className="space-y-3">
              {LANGUAGES.map((lang) => (
                <button
                  key={lang.value}
                  onClick={() => setTargetLang(lang.value)}
                  className={`w-full flex items-center gap-4 p-5 rounded-xl border transition-all ${
                    targetLang === lang.value
                      ? "border-primary bg-primary/10"
                      : "border-white/10 hover:border-white/20 hover:bg-white/5"
                  }`}
                >
                  <span className="text-3xl">{lang.flag}</span>
                  <div className="text-left">
                    <p className={`font-600 font-display ${targetLang === lang.value ? "text-primary" : ""}`}>
                      {lang.label}
                    </p>
                    <p className="text-lg text-muted-foreground">{lang.nativeLabel}</p>
                  </div>
                  {targetLang === lang.value && (
                    <div className="ml-auto w-5 h-5 rounded-full gradient-primary flex items-center justify-center text-xs text-white">✓</div>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 3: Avatar */}
        {step === 3 && (
          <div className="glass-card rounded-2xl p-8 slide-up">
            <h2 className="font-display text-xl font-600 mb-2">Choose AI Avatar</h2>
            <p className="text-muted-foreground text-sm mb-8">Select the Indian presenter for your localized video</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {AVATARS.map((av) => (
                <button
                  key={av.name}
                  onClick={() => setSelectedAvatar(av)}
                  className={`rounded-xl overflow-hidden border transition-all hover:scale-105 ${
                    selectedAvatar.name === av.name
                      ? "border-primary ring-2 ring-primary/30"
                      : "border-white/10 hover:border-white/20"
                  }`}
                >
                  <img
                    src={avatarImg(av)}
                    alt={av.name}
                    className="w-full aspect-[3/4] object-cover"
                  />
                  <div className="p-3 bg-card/80">
                    <p className="font-display font-600 text-sm">{av.name}</p>
                    <p className="text-xs text-muted-foreground capitalize">{av.style.replace("_", " ")}</p>
                    {selectedAvatar.name === av.name && (
                      <span className="text-xs text-primary font-medium">Selected</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 4: Confirm */}
        {step === 4 && (
          <div className="glass-card rounded-2xl p-8 slide-up">
            <h2 className="font-display text-xl font-600 mb-6">Confirm & Submit</h2>
            <div className="space-y-4 mb-8">
              {[
                {
                  label: "Source Video",
                  value: uploadedFile?.name || "",
                },
                {
                  label: "Source Language",
                  value: SOURCE_LANGUAGES.find((l) => l.value === sourceLang)?.label || sourceLang,
                },
                {
                  label: "Target Language",
                  value: `${LANGUAGES.find((l) => l.value === targetLang)?.label} (${LANGUAGES.find((l) => l.value === targetLang)?.nativeLabel})`,
                },
                {
                  label: "AI Avatar",
                  value: `${selectedAvatar.name} — ${selectedAvatar.style.replace("_", " ")} ${selectedAvatar.gender}`,
                },
              ].map((row) => (
                <div key={row.label} className="flex gap-4 p-4 rounded-xl bg-muted/50">
                  <span className="text-sm text-muted-foreground w-36 flex-shrink-0">{row.label}</span>
                  <span className="text-sm font-medium break-all">{row.value}</span>
                </div>
              ))}
            </div>
            <div className="flex items-start gap-3 p-4 rounded-xl bg-primary/5 border border-primary/20 mb-6">
              <Info size={16} className="text-primary mt-0.5 flex-shrink-0" />
              <p className="text-sm text-muted-foreground">
                Short clips (up to {MAX_UPLOAD_DURATION_SECONDS}s) for now while the real pipeline is being
                validated — typically a few minutes end to end. You can check status on your dashboard anytime.
              </p>
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="flex justify-between mt-6">
          <button
            onClick={() => step === 1 ? navigate("/") : setStep(step - 1)}
            disabled={isSubmitting}
            className="px-6 py-2.5 rounded-xl border border-white/10 text-muted-foreground hover:text-foreground hover:bg-white/5 transition-all text-sm font-medium disabled:opacity-50"
          >
            {step === 1 ? "Cancel" : "← Back"}
          </button>
          {step < 4 ? (
            <button
              onClick={handleNext}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl gradient-primary text-white font-semibold text-sm hover:opacity-90 transition-all"
            >
              Continue <ChevronRight size={16} />
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="flex items-center gap-2 px-8 py-2.5 rounded-xl gradient-primary text-white font-semibold text-sm hover:opacity-90 transition-all disabled:opacity-60"
            >
              {isSubmitting
                ? submitStage === "uploading" ? "Uploading..." : "Creating job..."
                : "Submit Job"}
              {!isSubmitting && <ChevronRight size={16} />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
