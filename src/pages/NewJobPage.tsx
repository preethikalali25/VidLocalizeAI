import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Link2, Upload, ChevronRight, Info, X, Film } from "lucide-react";
import { toast } from "sonner";
import Navbar from "@/components/layout/Navbar";
import { LANGUAGES, AVATARS, SOURCE_LANGUAGES } from "@/constants";
import type { Language, InputMethod, AvatarConfig } from "@/types";

const avatarFemale = `${import.meta.env.BASE_URL}avatars/avatar-female.jpg`;
const avatarMale = `${import.meta.env.BASE_URL}avatars/avatar-male.jpg`;

const STEP_LABELS = ["Source Video", "Target Language", "Choose Avatar", "Confirm"];

export default function NewJobPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);

  // Step 1
  const [inputMethod, setInputMethod] = useState<InputMethod>("url");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [sourceLang, setSourceLang] = useState("chinese");

  // Step 2
  const [targetLang, setTargetLang] = useState<Language>("hindi");

  // Step 3
  const [selectedAvatar, setSelectedAvatar] = useState<AvatarConfig>(AVATARS[0]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setUploadedFile(file);
  };

  const validateStep1 = () => {
    if (inputMethod === "url" && !youtubeUrl.trim()) {
      toast.error("Please enter a YouTube URL");
      return false;
    }
    if (inputMethod === "url" && !youtubeUrl.includes("youtube.com") && !youtubeUrl.includes("youtu.be")) {
      toast.error("Please enter a valid YouTube URL");
      return false;
    }
    if (inputMethod === "upload" && !uploadedFile) {
      toast.error("Please upload a video file");
      return false;
    }
    return true;
  };

  const handleNext = () => {
    if (step === 1 && !validateStep1()) return;
    if (step < 4) setStep(step + 1);
  };

  const handleSubmit = () => {
    const jobId = `job_${Date.now()}`;
    const jobData = {
      id: jobId,
      title: uploadedFile
        ? uploadedFile.name.replace(/\.[^.]+$/, "")
        : `YouTube Video — ${youtubeUrl.split("v=")[1]?.substring(0, 8) || "new"}`,
      sourceUrl: inputMethod === "url" ? youtubeUrl : undefined,
      fileName: uploadedFile?.name,
      sourceLang,
      targetLanguage: targetLang,
      avatar: selectedAvatar,
      status: "validating",
      progress: 0,
      createdAt: new Date().toISOString(),
      duration: "Processing...",
    };
    localStorage.setItem(`job_${jobId}`, JSON.stringify(jobData));
    toast.success("Job submitted! Starting AI processing...");
    navigate(`/processing/${jobId}`);
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
              {(["url", "upload"] as InputMethod[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setInputMethod(m)}
                  className={`flex items-center gap-2 px-5 py-2.5 text-sm font-medium transition-all ${
                    inputMethod === m ? "gradient-primary text-white" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {m === "url" ? <Link2 size={14} /> : <Upload size={14} />}
                  {m === "url" ? "YouTube URL" : "Upload File"}
                </button>
              ))}
            </div>

            {inputMethod === "url" ? (
              <div className="mb-6">
                <label className="block text-sm font-medium mb-2 text-muted-foreground">YouTube URL</label>
                <div className="relative">
                  <input
                    type="url"
                    value={youtubeUrl}
                    onChange={(e) => setYoutubeUrl(e.target.value)}
                    placeholder="https://www.youtube.com/watch?v=..."
                    className="w-full bg-muted border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 pr-10"
                  />
                  {youtubeUrl && (
                    <button onClick={() => setYoutubeUrl("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      <X size={14} />
                    </button>
                  )}
                </div>
                <p className="flex items-center gap-1 text-xs text-muted-foreground mt-2">
                  <Info size={11} /> Supports public YouTube videos, minimum 1 hour
                </p>
              </div>
            ) : (
              <div className="mb-6">
                <label className="block text-sm font-medium mb-2 text-muted-foreground">Video File</label>
                <label className="flex flex-col items-center justify-center w-full h-40 border-2 border-dashed border-white/10 rounded-xl cursor-pointer hover:border-primary/40 hover:bg-primary/5 transition-all">
                  {uploadedFile ? (
                    <div className="text-center">
                      <Film size={28} className="text-primary mx-auto mb-2" />
                      <p className="font-medium text-sm">{uploadedFile.name}</p>
                      <p className="text-xs text-muted-foreground">{(uploadedFile.size / 1024 / 1024).toFixed(1)} MB</p>
                    </div>
                  ) : (
                    <div className="text-center">
                      <Upload size={28} className="text-muted-foreground mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">Click to upload or drag & drop</p>
                      <p className="text-xs text-muted-foreground mt-1">MP4, MOV, AVI · Max 10GB</p>
                    </div>
                  )}
                  <input type="file" accept="video/*" onChange={handleFileChange} className="hidden" />
                </label>
              </div>
            )}

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
                  value: inputMethod === "url" ? youtubeUrl : uploadedFile?.name || "",
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
                Processing a 1+ hour video typically takes 45–90 minutes. You can check the status on your dashboard anytime.
              </p>
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="flex justify-between mt-6">
          <button
            onClick={() => step === 1 ? navigate("/") : setStep(step - 1)}
            className="px-6 py-2.5 rounded-xl border border-white/10 text-muted-foreground hover:text-foreground hover:bg-white/5 transition-all text-sm font-medium"
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
              className="flex items-center gap-2 px-8 py-2.5 rounded-xl gradient-primary text-white font-semibold text-sm hover:opacity-90 transition-all"
            >
              Submit Job <ChevronRight size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
