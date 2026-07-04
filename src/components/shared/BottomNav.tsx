"use client";

import { useRouter } from "next/navigation";

interface BottomNavProps {
  activeTab: "home" | "radio" | "meetings" | "gallery";
}

export default function BottomNav({ activeTab }: BottomNavProps) {
  const router = useRouter();

  const navigate = (path: string) => {
    router.push(path);
  };

  return (
    <>
      <style>{`
        .nav-live-dot { position: absolute; top: 1px; right: 8px; width: 8px; height: 8px; background: #EF4444; border-radius: 50%; border: 2px solid var(--bg,#0F0F0F); animation: navLivePulse 1.5s ease-in-out infinite; }
        @keyframes navLivePulse { 0%,100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.3); opacity: 0.6; } }
      `}</style>
    <nav className="bottom-nav">
      <button
        className={`nav-item${activeTab === "home" ? " active" : ""}`}
        onClick={() => navigate("/dashboard")}
      >
        <i className="fas fa-house"></i>
        <span>Home</span>
      </button>
      <button
        className={`nav-item${activeTab === "radio" ? " active" : ""}`}
        onClick={() => navigate("/radio")}
      >
        <i className="fas fa-radio"></i>
        <span>Radio</span>
      </button>
      <button
        className={`nav-item${activeTab === "meetings" ? " active" : ""}`}
        onClick={() => navigate("/meetings")}
      >
        <i className="fas fa-people-group"></i>
        <span>Meetings</span>
      </button>
      <button
        className={`nav-item${activeTab === "gallery" ? " active" : ""}`}
        onClick={() => navigate("/gallery")}
      >
        <i className="fas fa-images"></i>
        <span>Gallery</span>
      </button>
    </nav>
    </>
  );
}
