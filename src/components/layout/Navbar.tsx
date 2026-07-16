import { useNavigate, useLocation } from "react-router-dom";
import { Zap, LayoutDashboard, Plus, Users } from "lucide-react";

export default function Navbar() {
  const navigate = useNavigate();
  const location = useLocation();

  const isActive = (path: string) => location.pathname === path;

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 glass-card">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-2 group"
          >
            <div className="w-8 h-8 rounded-lg gradient-primary flex items-center justify-center">
              <Zap size={16} className="text-white" />
            </div>
            <span className="font-display font-700 text-lg">
              Vid<span className="gradient-text">Localize</span>
            </span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium border border-primary/20">
              AI
            </span>
          </button>

          {/* Nav links */}
          <div className="hidden md:flex items-center gap-1">
            <button
              onClick={() => navigate("/dashboard")}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                isActive("/dashboard")
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/5"
              }`}
            >
              <LayoutDashboard size={15} />
              Dashboard
            </button>
            <button
              onClick={() => navigate("/avatars")}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                isActive("/avatars")
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/5"
              }`}
            >
              <Users size={15} />
              My Avatars
            </button>
          </div>

          {/* CTA */}
          <button
            onClick={() => navigate("/new")}
            className="flex items-center gap-2 px-4 py-2 rounded-lg gradient-primary text-white text-sm font-semibold transition-all hover:opacity-90 hover:scale-105 active:scale-95"
          >
            <Plus size={15} />
            New Job
          </button>
        </div>
      </div>
    </nav>
  );
}
