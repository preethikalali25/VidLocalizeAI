import { useNavigate } from "react-router-dom";
import { Home } from "lucide-react";

export default function NotFound() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center text-center px-4">
      <p className="font-display text-8xl font-800 gradient-text mb-4">404</p>
      <h1 className="font-display text-2xl font-700 mb-3">Page not found</h1>
      <p className="text-muted-foreground mb-8">This page doesn't exist or has been moved.</p>
      <button
        onClick={() => navigate("/")}
        className="flex items-center gap-2 px-6 py-3 rounded-xl gradient-primary text-white font-semibold hover:opacity-90 transition-all"
      >
        <Home size={16} /> Back to Home
      </button>
    </div>
  );
}
