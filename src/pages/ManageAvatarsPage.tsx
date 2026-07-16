import { useState, useEffect, useCallback, useRef } from "react";
import { Upload, Trash2, Loader2, User } from "lucide-react";
import { toast } from "sonner";
import Navbar from "@/components/layout/Navbar";
import { AVATAR_CATEGORIES, MAX_AVATAR_PHOTO_SIZE_MB } from "@/constants";
import type { AvatarCategory, AvatarPhotoRecord } from "@/types";
import { supabase, isSupabaseConfigured, ensureAnonymousSession } from "@/lib/supabase";

type SlotState = {
  storagePath: string | null;
  signedUrl: string | null;
  uploading: boolean;
};

function storagePathFor(userId: string, category: AvatarCategory): string {
  return `${userId}/avatars/${category}`;
}

export default function ManageAvatarsPage() {
  const [loading, setLoading] = useState(true);
  const [slots, setSlots] = useState<Record<AvatarCategory, SlotState>>({
    man: { storagePath: null, signedUrl: null, uploading: false },
    woman: { storagePath: null, signedUrl: null, uploading: false },
    boy_child: { storagePath: null, signedUrl: null, uploading: false },
    girl_child: { storagePath: null, signedUrl: null, uploading: false },
  });
  const fileInputs = useRef<Record<AvatarCategory, HTMLInputElement | null>>({
    man: null,
    woman: null,
    boy_child: null,
    girl_child: null,
  });

  const loadSlots = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    const { data, error } = await supabase.from("avatar_photos").select("*");
    if (error) {
      toast.error(`Failed to load avatars: ${error.message}`);
      setLoading(false);
      return;
    }

    const rows = (data ?? []) as AvatarPhotoRecord[];
    const next: Record<AvatarCategory, SlotState> = {
      man: { storagePath: null, signedUrl: null, uploading: false },
      woman: { storagePath: null, signedUrl: null, uploading: false },
      boy_child: { storagePath: null, signedUrl: null, uploading: false },
      girl_child: { storagePath: null, signedUrl: null, uploading: false },
    };

    await Promise.all(
      rows.map(async (row) => {
        const { data: signed } = await supabase.storage
          .from("job-assets")
          .createSignedUrl(row.storage_path, 3600);
        next[row.category] = {
          storagePath: row.storage_path,
          signedUrl: signed?.signedUrl ?? null,
          uploading: false,
        };
      })
    );

    setSlots(next);
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      if (!isSupabaseConfigured) {
        setLoading(false);
        return;
      }
      await ensureAnonymousSession();
      await loadSlots();
    })();
  }, [loadSlots]);

  const handleUpload = async (category: AvatarCategory, file: File) => {
    if (!supabase) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file");
      return;
    }
    if (file.size > MAX_AVATAR_PHOTO_SIZE_MB * 1024 * 1024) {
      toast.error(`Image is too large — max ${MAX_AVATAR_PHOTO_SIZE_MB}MB`);
      return;
    }

    setSlots((prev) => ({ ...prev, [category]: { ...prev[category], uploading: true } }));
    try {
      const session = await ensureAnonymousSession();
      if (!session) throw new Error("Couldn't start a session — check Supabase Anonymous sign-ins are enabled");

      const path = storagePathFor(session.user.id, category);
      // No file extension on the storage key, by design: it makes the key
      // stable across re-uploads of a different image format, so upsert is
      // always a true overwrite instead of accumulating orphaned objects.
      const { error: uploadError } = await supabase.storage
        .from("job-assets")
        .upload(path, file, { contentType: file.type, upsert: true });
      if (uploadError) throw new Error(uploadError.message);

      const { error: upsertError } = await supabase
        .from("avatar_photos")
        .upsert({ user_id: session.user.id, category, storage_path: path }, { onConflict: "user_id,category" });
      if (upsertError) throw new Error(upsertError.message);

      const { data: signed } = await supabase.storage.from("job-assets").createSignedUrl(path, 3600);
      setSlots((prev) => ({
        ...prev,
        [category]: { storagePath: path, signedUrl: signed?.signedUrl ?? null, uploading: false },
      }));
      toast.success(`${AVATAR_CATEGORIES.find((c) => c.value === category)?.label} photo saved`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
      setSlots((prev) => ({ ...prev, [category]: { ...prev[category], uploading: false } }));
    }
  };

  const handleRemove = async (category: AvatarCategory) => {
    if (!supabase) return;
    const slot = slots[category];
    if (!slot.storagePath) return;

    try {
      await supabase.storage.from("job-assets").remove([slot.storagePath]);
      const { error } = await supabase.from("avatar_photos").delete().eq("category", category);
      if (error) throw new Error(error.message);
      setSlots((prev) => ({ ...prev, [category]: { storagePath: null, signedUrl: null, uploading: false } }));
      toast.success("Photo removed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove photo");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="max-w-3xl mx-auto px-4 pt-24 pb-16">
        <div className="mb-10">
          <h1 className="font-display text-3xl font-700 mb-2">My Avatars</h1>
          <p className="text-muted-foreground">
            Upload one photo per category — these are reused as the AI presenter for every video you create.
          </p>
        </div>

        {!isSupabaseConfigured ? (
          <div className="glass-card rounded-2xl p-16 text-center">
            <p className="font-display font-600 text-lg mb-2">Real processing isn't set up yet</p>
            <p className="text-muted-foreground text-sm">This build has no Supabase project configured.</p>
          </div>
        ) : loading ? (
          <div className="glass-card rounded-2xl p-16 text-center">
            <Loader2 size={28} className="text-primary animate-spin mx-auto" />
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {AVATAR_CATEGORIES.map((cat) => {
              const slot = slots[cat.value];
              return (
                <div key={cat.value} className="glass-card rounded-xl overflow-hidden border border-white/10">
                  <div className="aspect-[3/4] bg-muted relative flex items-center justify-center">
                    {slot.uploading ? (
                      <Loader2 size={24} className="text-primary animate-spin" />
                    ) : slot.signedUrl ? (
                      <img src={slot.signedUrl} alt={cat.label} className="w-full h-full object-cover" />
                    ) : (
                      <User size={32} className="text-muted-foreground/30" />
                    )}
                  </div>
                  <div className="p-3">
                    <p className="font-display font-600 text-sm mb-2">{cat.label}</p>
                    <input
                      ref={(el) => { fileInputs.current[cat.value] = el; }}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleUpload(cat.value, file);
                        e.target.value = "";
                      }}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => fileInputs.current[cat.value]?.click()}
                        disabled={slot.uploading}
                        className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-all disabled:opacity-50"
                      >
                        <Upload size={12} />
                        {slot.signedUrl ? "Replace" : "Upload"}
                      </button>
                      {slot.signedUrl && (
                        <button
                          onClick={() => handleRemove(cat.value)}
                          disabled={slot.uploading}
                          className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-400/10 transition-all disabled:opacity-50"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
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
