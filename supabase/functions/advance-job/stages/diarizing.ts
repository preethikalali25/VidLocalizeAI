import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { diarizeVideo, type DiarizedSpeaker } from "../../_shared/gemini.ts";
import type { JobRow, StageResult } from "../types.ts";

// KNOWN GAP: job_speakers.representative_frame_storage_path is never set
// here -- extracting a still frame at a given timestamp is a video
// operation Edge Functions can't do (same reason the compositing stage
// needs its own dedicated container, see the Phase 4 plan). The speaker
// review screen must work with representative_frame_storage_path == null
// (fall back to the speaker's label/transcript snippet only) until that
// container exists and a frame-extraction call is wired in here as a
// follow-up.
//
// v1 cap (see Phase 4 plan) -- extra detected speakers beyond this are
// simply never persisted as job_speakers/job_segments rows, so the
// compositing stage has nothing queued for their time ranges and those
// ranges keep the original, untouched footage. Graceful degrade, not a
// hard failure.
const MAX_SPEAKERS = 3;

export async function runDiarizing(admin: SupabaseClient, job: JobRow): Promise<StageResult> {
  if (!job.gemini_file_uri) throw new Error("Missing gemini_file_uri going into diarizing stage");

  // Idempotency guard: if a retry re-enters this stage after a prior
  // attempt already inserted rows (e.g. the Gemini call succeeded but a
  // later insert or the jobs update failed), don't call Gemini and insert
  // duplicates -- just resume from what's already there. Mirrors the same
  // pattern generating_avatar.ts uses for its Replicate prediction.
  const { data: existingSpeakers, error: existingError } = await admin
    .from("job_speakers")
    .select("id")
    .eq("job_id", job.id)
    .limit(1);
  if (existingError) throw new Error(`Failed to check for existing speakers: ${existingError.message}`);

  if (!existingSpeakers || existingSpeakers.length === 0) {
    const detected = await diarizeVideo(job.gemini_file_uri, job.source_mime_type ?? "video/mp4", job.source_lang);
    const kept = capToTopSpeakers(detected, MAX_SPEAKERS);
    const withoutOverlaps = dropOverlappingSegments(kept);

    // Auto-assign (skip the human review pause) only when EVERY kept
    // speaker has a confident suggestion with an uploaded photo for it --
    // a single unconfident/unmatched speaker still needs the pause, since
    // there's nothing sensible to auto-pick for that one. At the user's
    // explicit request: this trades away the safety net the pause exists
    // for (catching a wrong guess before paying for the rest of the
    // pipeline) in the case where Gemini's guess was actually usable.
    const { data: photoRows, error: photoError } = await admin
      .from("avatar_photos")
      .select("category")
      .eq("user_id", job.user_id);
    if (photoError) throw new Error(`Failed to check avatar photos: ${photoError.message}`);
    const uploadedCategories = new Set((photoRows ?? []).map((p: { category: string }) => p.category));
    const canAutoAssign =
      withoutOverlaps.length > 0 &&
      withoutOverlaps.every((s) => s.suggested_category && uploadedCategories.has(s.suggested_category));

    for (const speaker of withoutOverlaps) {
      const { data: speakerRow, error: speakerError } = await admin
        .from("job_speakers")
        .insert({
          job_id: job.id,
          speaker_label: speaker.speaker_label,
          suggested_avatar_category: speaker.suggested_category,
          avatar_category: canAutoAssign ? speaker.suggested_category : null,
        })
        .select("id")
        .single();
      if (speakerError || !speakerRow) {
        throw new Error(`Failed to save speaker "${speaker.speaker_label}": ${speakerError?.message ?? "no row returned"}`);
      }

      const segmentRows = speaker.segments.map((seg) => ({
        job_id: job.id,
        speaker_id: speakerRow.id,
        start_seconds: seg.start_seconds,
        end_seconds: seg.end_seconds,
        source_text: seg.text,
        // Backfilled below once every speaker's segments are known, so
        // sequence_index reflects chronological order across ALL speakers,
        // not just within one speaker.
        sequence_index: 0,
      }));
      if (segmentRows.length > 0) {
        const { error: segmentsError } = await admin.from("job_segments").insert(segmentRows);
        if (segmentsError) throw new Error(`Failed to save segments for "${speaker.speaker_label}": ${segmentsError.message}`);
      }
    }

    await assignChronologicalSequenceIndexes(admin, job.id);
  }

  // Re-derived fresh from the DB rather than the in-memory computation
  // above, so this is correct on an idempotent retry too (existingSpeakers
  // already non-empty, insert skipped entirely).
  const { data: allSpeakers, error: allSpeakersError } = await admin
    .from("job_speakers")
    .select("avatar_category")
    .eq("job_id", job.id);
  if (allSpeakersError) throw new Error(`Failed to check speaker assignments: ${allSpeakersError.message}`);
  const autoAssigned =
    (allSpeakers ?? []).length > 0 && (allSpeakers ?? []).every((s: { avatar_category: string | null }) => s.avatar_category);

  if (autoAssigned) {
    return {
      status: "translating",
      progress: 40,
      logMessage: "Detected speakers and auto-assigned avatars based on voice -- all suggestions were confident and matched an uploaded photo.",
    };
  }

  return {
    status: "awaiting_speaker_review",
    progress: 35,
    logMessage: "Detected speakers -- waiting for you to assign avatars.",
  };
}

function capToTopSpeakers(speakers: DiarizedSpeaker[], max: number): DiarizedSpeaker[] {
  if (speakers.length <= max) return speakers;
  const totalDuration = (s: DiarizedSpeaker) =>
    s.segments.reduce((sum, seg) => sum + (seg.end_seconds - seg.start_seconds), 0);
  return [...speakers].sort((a, b) => totalDuration(b) - totalDuration(a)).slice(0, max);
}

// v1 cut (see Phase 4 plan): "no overlapping-speech handling" -- real
// conversation regularly has moments where two people talk over each
// other, and Gemini's diarization reflects that honestly with genuinely
// overlapping segment ranges across different speakers. The compositing
// stage requires non-overlapping replacement ranges (confirmed live: a
// real 16-segment job failed there after already paying for TTS/face-
// swap/lip-sync on every segment, since nothing caught the overlap until
// the very last step). Catching it here instead, before any of that
// processing happens, both fixes the hard failure and avoids wasting
// real Replicate cost on segments that would've been discarded anyway.
// Both sides of a contested (overlapping) range are dropped entirely --
// that time range just keeps the original, untouched footage, same
// graceful-degrade philosophy as the speaker cap above.
function dropOverlappingSegments(speakers: DiarizedSpeaker[]): DiarizedSpeaker[] {
  type Tagged = { speakerIndex: number; segment: DiarizedSpeaker["segments"][number] };
  const flat: Tagged[] = speakers.flatMap((speaker, speakerIndex) =>
    speaker.segments.map((segment) => ({ speakerIndex, segment }))
  );
  flat.sort((a, b) => a.segment.start_seconds - b.segment.start_seconds);

  const toDrop = new Set<Tagged>();
  for (let i = 1; i < flat.length; i++) {
    if (flat[i].segment.start_seconds < flat[i - 1].segment.end_seconds) {
      toDrop.add(flat[i]);
      toDrop.add(flat[i - 1]);
    }
  }

  return speakers.map((speaker, speakerIndex) => ({
    ...speaker,
    segments: flat
      .filter((t) => t.speakerIndex === speakerIndex && !toDrop.has(t))
      .map((t) => t.segment),
  }));
}

async function assignChronologicalSequenceIndexes(admin: SupabaseClient, jobId: string): Promise<void> {
  const { data: segments, error } = await admin
    .from("job_segments")
    .select("id, start_seconds")
    .eq("job_id", jobId)
    .order("start_seconds", { ascending: true });
  if (error) throw new Error(`Failed to load segments for sequencing: ${error.message}`);

  await Promise.all(
    (segments ?? []).map((seg: { id: string }, index: number) =>
      admin.from("job_segments").update({ sequence_index: index }).eq("id", seg.id)
    )
  );
}
