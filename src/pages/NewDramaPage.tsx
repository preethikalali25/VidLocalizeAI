import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import Navbar from "@/components/layout/Navbar";
import { LANGUAGES, SOURCE_LANGUAGES } from "@/constants";
import type { Language } from "@/types";
import { supabase, isSupabaseConfigured, ensureAnonymousSession } from "@/lib/supabase";

export default function NewDramaPage() {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [scriptText, setScriptText] = useState("");
  const [sourceLang, setSourceLang] = useState("english");
  const [targetLangs, setTargetLangs] = useState<Language[]>(["hindi"]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const toggleTargetLang = (lang: Language) => {
    setTargetLangs((prev) => (prev.includes(lang) ? prev.filter((l) => l !== lang) : [...prev, lang]));
  };

  const handleSubmit = async () => {
    if (!isSupabaseConfigured || !supabase) {
      toast.error("Real processing isn't set up yet — this build has no Supabase project configured.");
      return;
    }
    if (!title.trim()) {
      toast.error("Give this a title");
      return;
    }
    if (!scriptText.trim()) {
      toast.error("Paste or write a script first");
      return;
    }
    if (targetLangs.length === 0) {
      toast.error("Please choose at least one target language");
      return;
    }

    setIsSubmitting(true);
    try {
      const session = await ensureAnonymousSession();
      if (!session) throw new Error("Couldn't start a session — check Supabase Anonymous sign-ins are enabled");

      // Same "one job per selected language" pattern as NewJobPage, just
      // sharing a script instead of an uploaded video.
      const jobIds: string[] = [];
      for (const lang of targetLangs) {
        const { data, error: fnError } = await supabase.functions.invoke("create-job", {
          body: {
            title,
            sourceLang,
            targetLanguage: lang,
            pipelineMode: "script_drama",
            scriptText,
          },
        });
        if (fnError) throw new Error(`${LANGUAGES.find((l) => l.value === lang)?.label ?? lang}: ${fnError.message}`);
        if (!data?.id) throw new Error(`${LANGUAGES.find((l) => l.value === lang)?.label ?? lang}: create-job did not return a job id`);
        jobIds.push(data.id);
      }

      if (jobIds.length === 1) {
        toast.success("Script submitted! Starting AI processing...");
        navigate(`/processing/${jobIds[0]}`);
      } else {
        toast.success(`${jobIds.length} jobs submitted! Starting AI processing...`);
        navigate("/dashboard");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to submit script");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="max-w-2xl mx-auto px-4 pt-24 pb-16">
        <div className="mb-8">
          <h1 className="font-display text-3xl font-700 mb-2">New AI Drama</h1>
          <p className="text-muted-foreground">
            Write or paste a script with multiple characters — fictional AI avatars perform it. No source video,
            no real actors.
          </p>
        </div>

        <div className="glass-card rounded-2xl p-8 space-y-6">
          <div>
            <label className="block text-sm font-medium mb-2">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Crying Wolf"
              className="w-full rounded-xl bg-muted border border-white/10 p-3 focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Script language</label>
            <select
              value={sourceLang}
              onChange={(e) => setSourceLang(e.target.value)}
              className="w-full rounded-xl bg-muted border border-white/10 p-3 focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {SOURCE_LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.flag} {l.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Script</label>
            <textarea
              value={scriptText}
              onChange={(e) => setScriptText(e.target.value)}
              rows={14}
              placeholder={"MOM: What?! Where?!\nDAD: Stay back, I'll go look!"}
              className="w-full rounded-xl bg-muted border border-white/10 p-3 font-mono text-sm resize-y focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <p className="text-xs text-muted-foreground mt-1.5">
              Any format works — character name + their line, one per line. Stage directions/parentheticals are
              fine to include, they're automatically skipped and never voiced.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Target language(s)</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {LANGUAGES.map((lang) => {
                const isSelected = targetLangs.includes(lang.value);
                return (
                  <button
                    key={lang.value}
                    type="button"
                    onClick={() => toggleTargetLang(lang.value)}
                    className={`flex items-center gap-2 p-3 rounded-xl border transition-all ${
                      isSelected ? "border-primary bg-primary/10" : "border-white/10 hover:border-white/20"
                    }`}
                  >
                    <span>{lang.flag}</span>
                    <span className={`text-sm font-medium ${isSelected ? "text-primary" : ""}`}>{lang.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="w-full py-3 rounded-xl gradient-primary text-white font-medium disabled:opacity-50 transition-all"
          >
            {isSubmitting ? "Submitting..." : "Create AI Drama"}
          </button>
          <p className="text-xs text-muted-foreground text-center">
            Next step after this: you'll assign an AI avatar to each character detected in your script.
          </p>
        </div>
      </div>
    </div>
  );
}
