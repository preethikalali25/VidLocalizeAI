import { useNavigate } from "react-router-dom";
import { ArrowRight, Play, CheckCircle, Zap, Globe, Mic, Film, ChevronRight } from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import heroImage from "@/assets/hero-transform.jpg";
import avatarFemale from "@/assets/avatar-female.jpg";
import avatarMale from "@/assets/avatar-male.jpg";

const STEPS = [
  {
    num: "01",
    icon: Globe,
    title: "Paste YouTube URL or Upload",
    desc: "Support for any public YouTube video 1+ hours long, or upload your own file directly.",
  },
  {
    num: "02",
    icon: Mic,
    title: "Choose Language & Avatar",
    desc: "Select Hindi, Telugu, Tamil, Kannada, or Bengali. Pick from 6 professional AI avatars.",
  },
  {
    num: "03",
    icon: Film,
    title: "AI Generates Your Video",
    desc: "Our pipeline transcribes, translates, generates avatar visuals and syncs lips automatically.",
  },
];

const FEATURES = [
  "1+ hour video support",
  "Pixel-perfect lip sync AI",
  "6 Indian language avatars",
  "5 target languages",
  "Hindi, Telugu, Tamil and more",
  "Download in HD quality",
  "Preserve original pacing",
  "Auto chapter markers",
];

export default function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background overflow-x-hidden">
      <Navbar />

      {/* Hero */}
      <section className="relative min-h-screen flex items-center justify-center pt-16 overflow-hidden">
        {/* Background layers */}
        <div className="absolute inset-0 z-0">
          <img
            src={heroImage}
            alt="AI video transformation"
            className="w-full h-full object-cover opacity-25"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-background/60 via-background/80 to-background" />
        </div>
        {/* Glow orbs */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full bg-primary/10 blur-3xl z-0" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 rounded-full bg-accent/10 blur-3xl z-0" />

        <div className="relative z-10 max-w-5xl mx-auto px-4 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-primary/30 bg-primary/5 text-primary text-sm font-medium mb-8">
            <Zap size={14} />
            Powered by Next-Gen AI Models
          </div>

          <h1 className="font-display text-5xl sm:text-6xl lg:text-7xl font-800 leading-tight mb-6">
            Transform Any Video Into
            <br />
            <span className="gradient-text">Indian Language AI</span>
          </h1>

          <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
            Paste a YouTube link or upload your video. Our AI transcribes, translates,
            and generates a fully lip-synced Indian avatar presenter — in Hindi, Telugu & more.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
            <button
              onClick={() => navigate("/new")}
              className="flex items-center gap-2 px-8 py-4 rounded-xl gradient-primary text-white font-semibold text-lg transition-all hover:opacity-90 hover:scale-105 active:scale-95 glow-blue"
            >
              Start Transforming
              <ArrowRight size={18} />
            </button>
            <button
              onClick={() => navigate("/dashboard")}
              className="flex items-center gap-2 px-8 py-4 rounded-xl border border-white/10 text-foreground font-medium text-lg hover:bg-white/5 transition-all"
            >
              <Play size={16} />
              View Demo Jobs
            </button>
          </div>

          {/* Feature pills */}
          <div className="flex flex-wrap justify-center gap-3">
            {FEATURES.map((f) => (
              <span key={f} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-sm text-muted-foreground">
                <CheckCircle size={12} className="text-primary" />
                {f}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-24 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-primary font-medium text-sm uppercase tracking-widest mb-3">How It Works</p>
            <h2 className="font-display text-4xl lg:text-5xl font-700">Three Steps to Any Language</h2>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {STEPS.map((step) => (
              <div key={step.num} className="relative glass-card rounded-2xl p-8 hover:border-primary/30 transition-all duration-300 group">
                <div className="text-7xl font-display font-800 text-white/5 absolute top-4 right-6 select-none group-hover:text-primary/10 transition-colors">
                  {step.num}
                </div>
                <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-6">
                  <step.icon size={22} className="text-primary" />
                </div>
                <h3 className="font-display text-xl font-600 mb-3">{step.title}</h3>
                <p className="text-muted-foreground leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Avatars */}
      <section className="py-24 px-4 bg-gradient-to-b from-transparent via-card/30 to-transparent">
        <div className="max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <p className="text-accent font-medium text-sm uppercase tracking-widest mb-3">AI Avatars</p>
              <h2 className="font-display text-4xl font-700 mb-6">
                Professional Indian<br />Presenters, No Studio
              </h2>
              <p className="text-muted-foreground text-lg leading-relaxed mb-8">
                Choose from 6 photorealistic Indian AI avatars — male and female, in professional,
                casual, and news anchor styles. Lips sync perfectly to translated audio.
              </p>
              <ul className="space-y-3">
                {["Priya – Professional Female", "Arjun – Professional Male", "Kavitha – News Anchor Style", "Rahul – Casual Style", "Sneha – Casual Female", "Vikram – Anchor Male"].map((a) => (
                  <li key={a} className="flex items-center gap-3 text-sm text-muted-foreground">
                    <div className="w-1.5 h-1.5 rounded-full gradient-primary" />
                    {a}
                  </li>
                ))}
              </ul>
              <button
                onClick={() => navigate("/new")}
                className="mt-8 flex items-center gap-2 text-primary font-medium hover:gap-3 transition-all"
              >
                Choose your avatar <ChevronRight size={16} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-2xl overflow-hidden border border-white/10 glow-blue">
                <img src={avatarFemale} alt="Priya - AI Avatar" className="w-full object-cover aspect-[3/4]" />
                <div className="p-3 glass-card">
                  <p className="font-display font-600 text-sm">Priya</p>
                  <p className="text-xs text-muted-foreground">Professional · Hindi · Telugu</p>
                </div>
              </div>
              <div className="rounded-2xl overflow-hidden border border-white/10 glow-purple mt-8">
                <img src={avatarMale} alt="Arjun - AI Avatar" className="w-full object-cover aspect-[3/4]" />
                <div className="p-3 glass-card">
                  <p className="font-display font-600 text-sm">Arjun</p>
                  <p className="text-xs text-muted-foreground">Professional · All Languages</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Banner */}
      <section className="py-24 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <div className="glass-card rounded-3xl p-16 border border-primary/20 glow-blue relative overflow-hidden">
            <div className="absolute inset-0 gradient-primary opacity-5" />
            <h2 className="font-display text-4xl lg:text-5xl font-700 mb-6 relative z-10">
              Ready to Reach India's<br />
              <span className="gradient-text">1.4 Billion Viewers?</span>
            </h2>
            <p className="text-muted-foreground text-lg mb-10 relative z-10">
              Start with your first video — no studio, no translator, no limits.
            </p>
            <button
              onClick={() => navigate("/new")}
              className="relative z-10 flex items-center gap-2 mx-auto px-10 py-4 rounded-xl gradient-primary text-white font-semibold text-lg hover:opacity-90 hover:scale-105 active:scale-95 transition-all"
            >
              Transform Your First Video
              <ArrowRight size={18} />
            </button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5 py-8 px-4 text-center text-muted-foreground text-sm">
        <p>© 2026 VidLocalize AI — Built for creators who break language barriers.</p>
      </footer>
    </div>
  );
}
