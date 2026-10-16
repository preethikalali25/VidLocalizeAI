import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { CheckCircle, Clock, AlertCircle, XCircle, Download, LayoutDashboard, Loader2, Users, User } from "lucide-react";
import { toast } from "sonner";
import Navbar from "@/components/layout/Navbar";
import { PROCESSING_STEPS, MULTI_SPEAKER_PROCESSING_STEPS, AVATAR_CATEGORIES } from "@/constants";
import type { JobRecord, JobEventRecord, JobSpeakerRecord, JobSegmentRecord, AvatarPhotoRecord, AvatarCategory } from "@/types";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

function emptyAvatarPhotoMap(): Record<AvatarCategory, string | null> {
  return Object.fromEntries(AVATAR_CATEGORIES.map((c) => [c.value, null])) as Record<AvatarCategory, string | null>;
}

export default function ProcessingPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();

  const [job, setJob] = useState<JobRecord | null>(null);
  const [events, setEvents] = useState<JobEventRecord[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // multi_speaker pipeline only (see Phase 4 plan) -- populated once the
  // job reaches awaiting_speaker_review.
  const [speakers, setSpeakers] = useState<JobSpeakerRecord[]>([]);
  const [speakerPreviews, setSpeakerPreviews] = useState<Record<string, string>>({});
  const [assignments, setAssignments] = useState<Record<string, AvatarCategory | null>>({});
  const [reviewAvatarPhotos, setReviewAvatarPhotos] = useState<Record<AvatarCategory, string | null>>(emptyAvatarPhotoMap());
  const [speakersLoading, setSpeakersLoading] = useState(false);
  const [submittingAssignments, setSubmittingAssignments] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || !jobId) {
      setNotFound(true);
      return;
    }

    let cancelled = false;

    (async () => {
      const { data, error } = await supabase.from("jobs").select("*").eq("id", jobId).single();
      if (cancelled) return;
      if (error || !data) {
        setNotFound(true);
        return;
      }
      setJob(data as JobRecord);

      const { data: existingEvents } = await supabase
        .from("job_events")
        .select("*")
        .eq("job_id", jobId)
        .order("created_at", { ascending: true });
      if (!cancelled && existingEvents) setEvents(existingEvents as JobEventRecord[]);
    })();

    const channel = supabase
      .channel(`job-${jobId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "jobs", filter: `id=eq.${jobId}` },
        (payload) => setJob(payload.new as JobRecord)
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "job_events", filter: `job_id=eq.${jobId}` },
        (payload) => setEvents((prev) => [...prev, payload.new as JobEventRecord])
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [jobId]);

  // multi_speaker pipeline only. Fetch once, when the job first reaches
  // awaiting_speaker_review -- the speaker/segment list doesn't change
  // again until the assignments are submitted, which moves the job out of
  // this status entirely.
  useEffect(() => {
    if (!supabase || !jobId || job?.status !== "awaiting_speaker_review" || speakers.length > 0 || speakersLoading) return;

    (async () => {
      setSpeakersLoading(true);
      const [{ data: speakerRows, error: speakersError }, { data: segmentRows }, { data: photoRows }] = await Promise.all([
        supabase.from("job_speakers").select("*").eq("job_id", jobId).order("speaker_label", { ascending: true }),
        supabase.from("job_segments").select("id, speaker_id, sequence_index, source_text, status").eq("job_id", jobId),
        supabase.from("avatar_photos").select("*"),
      ]);
      if (speakersError) {
        toast.error(`Failed to load detected speakers: ${speakersError.message}`);
        setSpeakersLoading(false);
        return;
      }

      const previews: Record<string, string> = {};
      for (const seg of (segmentRows ?? []) as JobSegmentRecord[]) {
        if (!previews[seg.speaker_id] && seg.source_text) previews[seg.speaker_id] = seg.source_text;
      }
      setSpeakerPreviews(previews);

      const photoMap = emptyAvatarPhotoMap();
      await Promise.all(
        ((photoRows ?? []) as AvatarPhotoRecord[]).map(async (row) => {
          const { data: signed } = await supabase.storage.from("job-assets").createSignedUrl(row.storage_path, 3600);
          photoMap[row.category] = signed?.signedUrl ?? null;
        })
      );
      setReviewAvatarPhotos(photoMap);

      const rows = (speakerRows ?? []) as JobSpeakerRecord[];
      setSpeakers(rows);
      // Pre-select Gemini's voice-based suggestion as a starting point, but
      // only if there's actually an uploaded photo for that category --
      // otherwise the button would be disabled and "selected" would look
      // broken. Always fully overridable before submit either way.
      setAssignments(
        Object.fromEntries(
          rows.map((s) => [
            s.id,
            s.avatar_category ?? (s.suggested_avatar_category && photoMap[s.suggested_avatar_category] ? s.suggested_avatar_category : null),
          ])
        )
      );
      setSpeakersLoading(false);
    })();
  }, [job?.status, jobId, speakers.length, speakersLoading]);

  const handleSubmitAssignments = useCallback(async () => {
    if (!supabase || !jobId) return;
    const missing = speakers.filter((s) => !assignments[s.id]);
    if (missing.length > 0) {
      toast.error("Please choose an avatar for every detected speaker");
      return;
    }

    setSubmittingAssignments(true);
    try {
      const { error } = await supabase.functions.invoke("submit-speaker-assignments", {
        body: {
          job_id: jobId,
          assignments: speakers.map((s) => ({ speaker_id: s.id, avatar_category: assignments[s.id] })),
        },
      });
      if (error) throw new Error(error.message);
      toast.success("Avatars assigned — resuming processing.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to submit avatar assignments");
    } finally {
      setSubmittingAssignments(false);
    }
  }, [jobId, speakers, assignments]);

  const handleDownload = useCallback(async () => {
    if (!supabase || !job?.output_storage_path) return;
    setDownloading(true);
    try {
      const { data, error } = await supabase.storage
        .from("job-assets")
        .createSignedUrl(job.output_storage_path, 300);
      if (error || !data) throw new Error(error?.message ?? "Could not get download link");
      window.open(data.signedUrl, "_blank");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  }, [job]);

  if (notFound) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 text-center px-4">
        <AlertCircle size={32} className="text-muted-foreground" />
        <p className="text-muted-foreground max-w-sm">
          {isSupabaseConfigured
            ? "Job not found. It may have been deleted, or the link is invalid."
            : "Real processing isn't set up yet — this build has no Supabase project configured."}
        </p>
        <button
          onClick={() => navigate("/dashboard")}
          className="px-6 py-2.5 rounded-xl gradient-primary text-white font-semibold text-sm"
        >
          Back to Dashboard
        </button>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 size={32} className="text-primary animate-spin" />
      </div>
    );
  }

  const isComplete = job.status === "complete";
  const isError = job.status === "error";
  const isMultiSpeaker = job.pipeline_mode === "multi_speaker";
  const isAwaitingReview = job.status === "awaiting_speaker_review";
  const steps = isMultiSpeaker ? MULTI_SPEAKER_PROCESSING_STEPS : PROCESSING_STEPS;
  const currentStepIndex = steps.findIndex((s) => s.id === job.status);
  const avatarLabel = isMultiSpeaker
    ? "Multiple people"
    : AVATAR_CATEGORIES.find((c) => c.value === job.avatar_category)?.label ?? "—";

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="max-w-4xl mx-auto px-4 pt-24 pb-16">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            {isComplete ? (
              <CheckCircle size={22} className="text-green-400" />
            ) : isError ? (
              <XCircle size={22} className="text-red-400" />
            ) : isAwaitingReview ? (
              <Users size={22} className="text-primary" />
            ) : (
              <Loader2 size={22} className="text-primary animate-spin" />
            )}
            <span className={`text-sm font-medium px-2.5 py-1 rounded-full ${
              isComplete ? "bg-green-400/10 text-green-400" :
              isError ? "bg-red-400/10 text-red-400" :
              isAwaitingReview ? "bg-primary/10 text-primary" :
              "bg-primary/10 text-primary processing-pulse"
            }`}>
              {isComplete ? "Complete" : isError ? "Failed" : isAwaitingReview ? "Awaiting Your Input" : "Processing"}
            </span>
          </div>
          <h1 className="font-display text-2xl font-700 mb-1 line-clamp-2">{job.title}</h1>
          <p className="text-muted-foreground text-sm capitalize">
            {job.source_lang} → {job.target_language} · Avatar: {avatarLabel}
          </p>
        </div>

        {/* Overall progress */}
        <div className="glass-card rounded-2xl p-6 mb-6">
          <div className="flex items-center justify-between mb-3">
            <span className="font-display font-600 text-sm">Overall Progress</span>
            <span className="text-2xl font-display font-700 gradient-text">{job.progress}%</span>
          </div>
          <div className="w-full h-3 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${isError ? "bg-red-400" : "gradient-primary"}`}
              style={{ width: `${job.progress}%` }}
            />
          </div>
          {!isComplete && !isError && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground mt-3">
              <Clock size={12} />
              This may take a few minutes — you can leave and check back from the dashboard.
            </p>
          )}
        </div>

        <div className="grid lg:grid-cols-5 gap-6">
          {/* Steps */}
          <div className="lg:col-span-2 glass-card rounded-2xl p-6">
            <h3 className="font-display font-600 text-sm mb-4">Pipeline Steps</h3>
            <div className="space-y-3">
              {steps.map((step, i) => {
                const isDone = isComplete || (!isError && i < currentStepIndex);
                const isActive = !isComplete && !isError && i === currentStepIndex;
                const isFailedHere = isError && i === currentStepIndex;
                return (
                  <div key={step.id} className={`flex items-start gap-3 p-3 rounded-xl transition-all ${
                    isActive ? "bg-primary/10 border border-primary/20" :
                    isFailedHere ? "bg-red-400/10 border border-red-400/20" :
                    isDone ? "opacity-60" : "opacity-30"
                  }`}>
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                      isDone ? "gradient-primary text-white text-xs" :
                      isFailedHere ? "border-2 border-red-400" :
                      isActive ? "border-2 border-primary" :
                      "border-2 border-white/20"
                    }`}>
                      {isDone ? "✓" : isFailedHere ? (
                        <XCircle size={12} className="text-red-400" />
                      ) : isActive ? (
                        <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                      ) : null}
                    </div>
                    <div className="min-w-0">
                      <p className={`text-xs font-600 ${isActive ? "text-primary" : isFailedHere ? "text-red-400" : ""}`}>
                        {step.label}
                      </p>
                      {isActive && (
                        <p className="text-xs text-muted-foreground mt-0.5">{step.description}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Logs + Complete */}
          <div className="lg:col-span-3 space-y-4">
            {isAwaitingReview && (
              <div className="glass-card rounded-2xl p-6 border border-primary/20 bg-primary/5 slide-up">
                <div className="flex items-center gap-3 mb-2">
                  <Users size={22} className="text-primary" />
                  <h3 className="font-display font-700 text-lg">Assign Avatars</h3>
                </div>
                <p className="text-sm text-muted-foreground mb-6">
                  We detected {speakers.length} speaker{speakers.length === 1 ? "" : "s"} in your video. Choose an
                  avatar for each before we continue.
                </p>

                {speakersLoading ? (
                  <p className="text-sm text-muted-foreground">Loading detected speakers...</p>
                ) : (
                  <div className="space-y-5">
                    {speakers.map((speaker) => (
                      <div key={speaker.id} className="p-4 rounded-xl bg-muted/50 border border-white/5">
                        <div className="flex items-start gap-3 mb-3">
                          <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                            <User size={18} className="text-muted-foreground/50" />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-display font-600 text-sm">{speaker.speaker_label}</p>
                              {speaker.suggested_avatar_category && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
                                  Sounds like: {AVATAR_CATEGORIES.find((c) => c.value === speaker.suggested_avatar_category)?.label}
                                </span>
                              )}
                            </div>
                            {speakerPreviews[speaker.id] && (
                              <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                                "{speakerPreviews[speaker.id]}"
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                          {AVATAR_CATEGORIES.map((cat) => {
                            const photoUrl = reviewAvatarPhotos[cat.value];
                            const isSelected = assignments[speaker.id] === cat.value;
                            return (
                              <button
                                key={cat.value}
                                type="button"
                                disabled={!photoUrl}
                                onClick={() => setAssignments((prev) => ({ ...prev, [speaker.id]: cat.value }))}
                                title={photoUrl ? cat.label : `${cat.label} — not uploaded`}
                                className={`rounded-lg overflow-hidden border transition-all ${
                                  !photoUrl ? "opacity-30 cursor-not-allowed border-white/10" :
                                  isSelected ? "border-primary ring-2 ring-primary/30" :
                                  "border-white/10 hover:border-white/20"
                                }`}
                              >
                                <div className="aspect-square bg-muted flex items-center justify-center">
                                  {photoUrl ? (
                                    <img src={photoUrl} alt={cat.label} className="w-full h-full object-cover" />
                                  ) : (
                                    <User size={16} className="text-muted-foreground/30" />
                                  )}
                                </div>
                                <p className="text-[10px] text-center py-1 truncate px-1">{cat.label}</p>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}

                    <button
                      onClick={handleSubmitAssignments}
                      disabled={submittingAssignments || speakers.length === 0}
                      className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl gradient-primary text-white font-semibold hover:opacity-90 transition-all disabled:opacity-60"
                    >
                      {submittingAssignments ? "Submitting..." : "Continue Processing"}
                    </button>
                  </div>
                )}
              </div>
            )}

            {isComplete && (
              <div className="glass-card rounded-2xl p-6 border border-green-400/20 bg-green-400/5 slide-up">
                <div className="flex items-center gap-3 mb-4">
                  <CheckCircle size={24} className="text-green-400" />
                  <h3 className="font-display font-700 text-lg text-green-400">Video Ready!</h3>
                </div>
                <p className="text-sm text-muted-foreground mb-6">
                  Your AI-generated {job.target_language} video with {avatarLabel} avatar is ready. Download it below.
                </p>
                <div className="space-y-3">
                  <button
                    onClick={handleDownload}
                    disabled={downloading}
                    className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl gradient-primary text-white font-semibold hover:opacity-90 transition-all disabled:opacity-60"
                  >
                    <Download size={18} />
                    {downloading ? "Preparing download..." : "Download Video"}
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

            {isError && (
              <div className="glass-card rounded-2xl p-6 border border-red-400/20 bg-red-400/5 slide-up">
                <div className="flex items-center gap-3 mb-4">
                  <XCircle size={24} className="text-red-400" />
                  <h3 className="font-display font-700 text-lg text-red-400">Processing Failed</h3>
                </div>
                <p className="text-sm text-muted-foreground mb-6 break-words">
                  {job.error_message ?? "Something went wrong while processing this video."}
                </p>
                <button
                  onClick={() => navigate("/dashboard")}
                  className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl border border-white/10 text-muted-foreground hover:text-foreground hover:bg-white/5 transition-all text-sm font-medium"
                >
                  <LayoutDashboard size={16} />
                  View All Jobs
                </button>
              </div>
            )}

            {/* Live log */}
            <div className="glass-card rounded-2xl p-5">
              <h3 className="font-display font-600 text-sm mb-3 text-muted-foreground">AI Processing Log</h3>
              <div className="font-mono text-xs space-y-1.5 max-h-64 overflow-y-auto">
                {events.length === 0 && (
                  <div className="text-muted-foreground">Waiting for the pipeline to start...</div>
                )}
                {events.map((event) => (
                  <div
                    key={event.id}
                    className={event.level === "error" ? "text-red-400" : "text-muted-foreground"}
                  >
                    [{new Date(event.created_at).toLocaleTimeString()}] {event.message}
                  </div>
                ))}
                {!isComplete && !isError && (
                  <div className="text-primary flex items-center gap-2">
                    <span className="processing-pulse">▌</span>
                  </div>
                )}
              </div>
            </div>

            {!isComplete && !isError && (
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
