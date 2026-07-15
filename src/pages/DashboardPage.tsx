import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Clock, CheckCircle, XCircle, Loader2, Trash2, ExternalLink, Film, Download } from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import { LANGUAGES } from "@/constants";
import type { JobRecord, ProcessingStatus } from "@/types";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { toast } from "sonner";

const STATUS_CONFIG: Record<ProcessingStatus, { label: string; color: string; icon: React.FC<{ size: number }> }> = {
  idle: { label: "Pending", color: "text-muted-foreground", icon: Clock },
  validating: { label: "Validating", color: "text-yellow-400", icon: Loader2 },
  extracting: { label: "Extracting Audio", color: "text-yellow-400", icon: Loader2 },
  transcribing: { label: "Transcribing", color: "text-blue-400", icon: Loader2 },
  translating: { label: "Translating", color: "text-blue-400", icon: Loader2 },
  synthesizing_speech: { label: "Synthesizing Speech", color: "text-blue-400", icon: Loader2 },
  generating_avatar: { label: "Generating Avatar", color: "text-purple-400", icon: Loader2 },
  lip_syncing: { label: "Lip Syncing", color: "text-purple-400", icon: Loader2 },
  rendering: { label: "Rendering", color: "text-orange-400", icon: Loader2 },
  complete: { label: "Complete", color: "text-green-400", icon: CheckCircle },
  error: { label: "Failed", color: "text-red-400", icon: XCircle },
};

const TABS = ["all", "processing", "complete"] as const;
type Tab = (typeof TABS)[number];

function formatDuration(seconds: number | null): string {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("all");
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setLoading(false);
      return;
    }
    supabase
      .from("jobs")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) {
          toast.error(`Failed to load jobs: ${error.message}`);
        } else {
          setJobs((data ?? []) as JobRecord[]);
        }
        setLoading(false);
      });
  }, []);

  const filtered = jobs.filter((j) => {
    if (tab === "processing") return j.status !== "complete" && j.status !== "error";
    if (tab === "complete") return j.status === "complete";
    return true;
  });

  const handleDelete = async (id: string) => {
    if (!supabase) return;
    const { error } = await supabase.from("jobs").delete().eq("id", id);
    if (error) {
      toast.error(`Failed to remove job: ${error.message}`);
      return;
    }
    setJobs((prev) => prev.filter((j) => j.id !== id));
    toast.success("Job removed");
  };

  const handleDownload = useCallback(async (job: JobRecord) => {
    if (!supabase || !job.output_storage_path) return;
    const { data, error } = await supabase.storage
      .from("job-assets")
      .createSignedUrl(job.output_storage_path, 300);
    if (error || !data) {
      toast.error(error?.message ?? "Could not get download link");
      return;
    }
    window.open(data.signedUrl, "_blank");
  }, []);

  const counts = {
    all: jobs.length,
    processing: jobs.filter((j) => j.status !== "complete" && j.status !== "error").length,
    complete: jobs.filter((j) => j.status === "complete").length,
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="max-w-6xl mx-auto px-4 pt-24 pb-16">
        {/* Header */}
        <div className="flex items-start justify-between mb-8 flex-wrap gap-4">
          <div>
            <h1 className="font-display text-3xl font-700 mb-1">My Jobs</h1>
            <p className="text-muted-foreground">{jobs.length} total localization jobs</p>
          </div>
          <button
            onClick={() => navigate("/new")}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl gradient-primary text-white font-semibold text-sm hover:opacity-90 transition-all"
          >
            <Plus size={16} />
            New Job
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          {[
            { label: "Total Jobs", value: jobs.length, color: "text-foreground" },
            { label: "Processing", value: counts.processing, color: "text-yellow-400" },
            { label: "Completed", value: counts.complete, color: "text-green-400" },
          ].map((s) => (
            <div key={s.label} className="glass-card rounded-xl p-5">
              <p className="text-muted-foreground text-sm mb-1">{s.label}</p>
              <p className={`font-display text-3xl font-700 ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-muted/50 rounded-xl p-1 w-fit">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all capitalize ${
                tab === t ? "bg-card text-foreground shadow" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t} <span className="ml-1 text-xs opacity-60">{counts[t]}</span>
            </button>
          ))}
        </div>

        {/* Job list */}
        {loading ? (
          <div className="glass-card rounded-2xl p-16 text-center">
            <Loader2 size={28} className="text-primary animate-spin mx-auto" />
          </div>
        ) : !isSupabaseConfigured ? (
          <div className="glass-card rounded-2xl p-16 text-center">
            <Film size={40} className="text-muted-foreground/30 mx-auto mb-4" />
            <p className="font-display font-600 text-lg mb-2">Real processing isn't set up yet</p>
            <p className="text-muted-foreground text-sm">This build has no Supabase project configured.</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="glass-card rounded-2xl p-16 text-center">
            <Film size={40} className="text-muted-foreground/30 mx-auto mb-4" />
            <p className="font-display font-600 text-lg mb-2">No jobs yet</p>
            <p className="text-muted-foreground text-sm mb-6">Submit your first video to get started</p>
            <button
              onClick={() => navigate("/new")}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl gradient-primary text-white font-semibold text-sm hover:opacity-90 transition-all"
            >
              <Plus size={15} /> Create First Job
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((job) => {
              const sc = STATUS_CONFIG[job.status];
              const StatusIcon = sc.icon;
              const langInfo = LANGUAGES.find((l) => l.value === job.target_language);
              return (
                <div
                  key={job.id}
                  className="glass-card rounded-2xl p-5 hover:border-white/15 transition-all group"
                >
                  <div className="flex items-start gap-4">
                    {/* Thumbnail */}
                    <div className="w-28 h-16 rounded-lg overflow-hidden bg-muted flex-shrink-0 flex items-center justify-center">
                      <Film size={20} className="text-muted-foreground/40" />
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 flex-wrap">
                        <h3 className="font-display font-600 text-sm line-clamp-1 mr-2">{job.title}</h3>
                        <div className={`flex items-center gap-1.5 text-xs font-medium ${sc.color}`}>
                          <StatusIcon size={13} />
                          {sc.label}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 mt-2 flex-wrap">
                        <span className="text-xs text-muted-foreground capitalize">{job.source_lang} → {langInfo?.label || job.target_language}</span>
                        <span className="text-muted-foreground/30">·</span>
                        <span className="text-xs text-muted-foreground">Avatar: {job.avatar_name}</span>
                        <span className="text-muted-foreground/30">·</span>
                        <span className="text-xs text-muted-foreground">{formatDuration(job.source_duration_seconds)}</span>
                      </div>

                      {/* Progress bar if processing */}
                      {job.status !== "complete" && job.status !== "error" && (
                        <div className="mt-3 w-full h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full gradient-primary rounded-full processing-pulse"
                            style={{ width: `${job.progress}%` }}
                          />
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {job.status === "complete" ? (
                        <button
                          onClick={() => handleDownload(job)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-400/10 text-green-400 text-xs font-medium hover:bg-green-400/20 transition-all"
                        >
                          <Download size={11} /> Download
                        </button>
                      ) : (
                        <button
                          onClick={() => navigate(`/processing/${job.id}`)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-all"
                        >
                          <ExternalLink size={11} /> View
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(job.id)}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-400/10 transition-all opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
