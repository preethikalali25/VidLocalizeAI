import { Routes, Route } from "react-router-dom";
import LandingPage from "@/pages/LandingPage";
import DashboardPage from "@/pages/DashboardPage";
import NewJobPage from "@/pages/NewJobPage";
import ProcessingPage from "@/pages/ProcessingPage";
import ManageAvatarsPage from "@/pages/ManageAvatarsPage";
import NotFound from "@/pages/NotFound";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="/new" element={<NewJobPage />} />
      <Route path="/processing/:jobId" element={<ProcessingPage />} />
      <Route path="/avatars" element={<ManageAvatarsPage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
