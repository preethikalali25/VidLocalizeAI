import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";
import App from "./App";
import { ensureAnonymousSession } from "./lib/supabase";
import "./index.css";

void ensureAnonymousSession();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
      <Toaster position="top-right" richColors theme="dark" />
    </BrowserRouter>
  </StrictMode>
);
