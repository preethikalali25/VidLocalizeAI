import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { CheckCircle, Clock, AlertCircle, Download, LayoutDashboard, Loader2 } from "lucide-react";
import { toast } from "sonner";
import Navbar from "@/components/layout/Navbar";
import { PROCESSING_STEPS } from "@/constants";
import type { ProcessingStatus } from "@/types";

interface JobData {
  id: string;
  title: string;
  sourceLang: string;
  targetLanguage: string;
  avatar: { name: string; style: string; gender: string };
  status: ProcessingStatus;
  progress: number;
  duration?: string;
}

const STATUS_ORDER: ProcessingStatus[] = [
  "validating", "extracting", "transcribing", "translating",
  "synthesizing_speech", "generating_avatar", "lip_syncing", "rendering", "complete"
];

export default function ProcessingPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();

  const [job, setJob] = useState<JobData | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [stepProgress, setStepProgress] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [isComplete, setIsComplete] = useState(false);

  const addLog = useCallback((msg: string) => {
    setLogs((prev) => [...prev.slice(-15), `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);

  useEffect(() => {
    const raw = localStorage.getItem(`job_${jobId}`);
    if (!raw) { navigate("/dashboard"); return; }
    const data = JSON.parse(raw) as JobData;
    setJob(data);
    addLog("Job received. Initializing AI pipeline...");
    addLog(`Source language detected: ${data.sourceLang}`);
    addLog(`Target: ${data.targetLanguage} — Avatar: ${data.avatar.name}`);
  }, [jobId, navigate, addLog]);

  useEffect(() => {
    if (!job || isComplete) return;

    const step = PROCESSING_STEPS[currentStepIndex];
    if (!step) return;

    addLog(`Starting: ${step.description}...`);

    const interval = setInterval(() => {
      setStepProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          return 100;
        }
        return prev + (100 / (step.duration / 100));
      });
    }, 100);

    const timer = setTimeout(() => {
      clearInterval(interval);
      setStepProgress(0);
      addLog(`✓ Completed: ${step.label}`);

      if (currentStepIndex >= PROCESSING_STEPS.length - 1) {
        setIsComplete(true);
        addLog("🎉 Video generation complete! Ready for download.");
        const raw = localStorage.getItem(`job_${jobId}`);
        if (raw) {
          const updated = { ...JSON.parse(raw), status: "complete", progress: 100, completedAt: new Date().toISOString() };
          localStorage.setItem(`job_${jobId}`, JSON.stringify(updated));
        }
      } else {
        setCurrentStepIndex((prev) => prev + 1);
      }
    }, step.duration);

    return () => { clearInterval(interval); clearTimeout(timer); };
  }, [currentStepIndex, job, isComplete, jobId, addLog]);

  const overallProgress = isComplete
    ? 100
    : Math.round(((currentStepIndex + stepProgress / 100) / PROCESSING_STEPS.length) * 100);

  if (!job) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 size={32} className="text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="max-w-4xl mx-auto px-4 pt-24 pb-16">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            {isComplete ? (
              <CheckCircle size={22} className="text-green-400" />
            ) : (
              <Loader2 size={22} className="text-primary animate-spin" />
            )}
            <span className={`text-sm font-medium px-2.5 py-1 rounded-full ${
              isComplete ? "bg-green-400/10 text-green-400" : "bg-primary/10 text-primary processing-pulse"
            }`}>
              {isComplete ? "Complete" : "Processing"}
            </span>
          </div>
          <h1 className="font-display text-2xl font-700 mb-1 line-clamp-2">{job.title}</h1>
          <p className="text-muted-foreground text-sm capitalize">
            {job.sourceLang} → {job.targetLanguage} · Avatar: {job.avatar.name}
          </p>
        </div>

        {/* Overall progress */}
        <div className="glass-card rounded-2xl p-6 mb-6">
          <div className="flex items-center justify-between mb-3">
            <span className="font-display font-600 text-sm">Overall Progress</span>
            <span className="text-2xl font-display font-700 gradient-text">{overallProgress}%</span>
          </div>
          <div className="w-full h-3 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full gradient-primary rounded-full transition-all duration-300"
              style={{ width: `${overallProgress}%` }}
            />
          </div>
          {!isComplete && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground mt-3">
              <Clock size={12} />
              Estimated remaining: ~{Math.max(1, Math.ceil(((PROCESSING_STEPS.length - currentStepIndex) * 5)))} minutes
            </p>
          )}
        </div>

        <div className="grid lg:grid-cols-5 gap-6">
          {/* Steps */}
          <div className="lg:col-span-2 glass-card rounded-2xl p-6">
            <h3 className="font-display font-600 text-sm mb-4">Pipeline Steps</h3>
            <div className="space-y-3">
              {PROCESSING_STEPS.map((step, i) => {
                const isDone = isComplete || i < currentStepIndex;
                const isActive = !isComplete && i === currentStepIndex;
                const isPending = !isComplete && i > currentStepIndex;
                return (
                  <div key={step.id} className={`flex items-start gap-3 p-3 rounded-xl transition-all ${
                    isActive ? "bg-primary/10 border border-primary/20" :
                    isDone ? "opacity-60" : "opacity-30"
                  }`}>
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                      isDone ? "gradient-primary text-white text-xs" :
                      isActive ? "border-2 border-primary" :
                      "border-2 border-white/20"
                    }`}>
                      {isDone ? "✓" : isActive ? (
                        <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                      ) : null}
                    </div>
                    <div className="min-w-0">
                      <p className={`text-xs font-600 ${isActive ? "text-primary" : ""}`}>{step.label}</p>
                      {isActive && (
                        <>
                          <p className="text-xs text-muted-foreground mt-0.5">{step.description}</p>
                          <div className="w-full h-1 bg-muted rounded-full mt-2 overflow-hidden">
                            <div
                              className="h-full gradient-primary rounded-full transition-all duration-200"
                              style={{ width: `${stepProgress}%` }}
                            />
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Logs + Complete */}
          <div className="lg:col-span-3 space-y-4">
            {isComplete && (
              <div className="glass-card rounded-2xl p-6 border border-green-400/20 bg-green-400/5 slide-up">
                <div className="flex items-center gap-3 mb-4">
                  <CheckCircle size={24} className="text-green-400" />
                  <h3 className="font-display font-700 text-lg text-green-400">Video Ready!</h3>
                </div>
                <p className="text-sm text-muted-foreground mb-6">
                  Your AI-generated {job.targetLanguage} video with {job.avatar.name} is ready. Download it below.
                </p>
                <div className="space-y-3">
                  <button
                    onClick={() => toast.info("This is a demo — no real video is generated yet. Real AI processing is coming soon.")}
                    className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl gradient-primary text-white font-semibold hover:opacity-90 transition-all"
                  >
                    <Download size={18} />
                    Download HD Video (1080p)
                  </button>
                  <button
                    onClick={() => navigate("/dashboard")}
                    className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl border border-white/10 text-muted-foreground hover:text-foreground hover:bg-white/5 transition-all text-sm font-medium"
                  >
                    <LayoutDashboard size={16} />
                    View All Jobs
                  </button>
                </div>
              </div>
            )}

            {/* Live log */}
            <div className="glass-card rounded-2xl p-5">
              <h3 className="font-display font-600 text-sm mb-3 text-muted-foreground">AI Processing Log</h3>
              <div className="font-mono text-xs space-y-1.5 max-h-64 overflow-y-auto">
                {logs.map((log, i) => (
                  <div key={i} className={`${
                    log.includes("✓") ? "text-green-400" :
                    log.includes("🎉") ? "text-yellow-400" :
                    "text-muted-foreground"
                  }`}>
                    {log}
                  </div>
                ))}
                {!isComplete && (
                  <div className="text-primary flex items-center gap-2">
                    <span className="processing-pulse">▌</span>
                  </div>
                )}
              </div>
            </div>

            {!isComplete && (
              <div className="flex items-start gap-3 p-4 rounded-xl bg-muted/50 border border-white/5">
                <AlertCircle size={16} className="text-muted-foreground mt-0.5 flex-shrink-0" />
                <p className="text-xs text-muted-foreground">
                  Do not close this tab to follow live progress. Your job will continue even if you leave — check the dashboard to track it.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
