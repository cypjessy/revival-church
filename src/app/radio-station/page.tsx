"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useNowPlaying } from "@/lib/useNowPlaying";
import { getNowPlaying, toggleAutoDJ, getStationId } from "@/lib/azuracast";

import PremiumTopBar from "@/components/shared/PremiumTopBar";
import Overview from "@/components/radio-station/sections/Overview";
import Media from "@/components/radio-station/sections/Media";
import Playlists from "@/components/radio-station/sections/Playlists";
import DJAccounts from "@/components/radio-station/sections/DJAccounts";
import Schedule from "@/components/radio-station/sections/Schedule";
import Analytics from "@/components/radio-station/sections/Analytics";
import Webhooks from "@/components/radio-station/sections/Webhooks";
import Settings from "@/components/radio-station/sections/Settings";

type TabId = "overview" | "media" | "playlists" | "djs" | "schedule" | "analytics" | "webhooks" | "settings";

const SIDEBAR_TABS: { id: TabId; icon: string; label: string }[] = [
  { id: "overview", icon: "fa-house", label: "Overview" },
  { id: "media", icon: "fa-music", label: "Media" },
  { id: "playlists", icon: "fa-list", label: "Playlists" },
  { id: "djs", icon: "fa-user", label: "DJs" },
  { id: "schedule", icon: "fa-calendar-days", label: "Schedule" },
  { id: "analytics", icon: "fa-chart-line", label: "Analytics" },
  { id: "webhooks", icon: "fa-link", label: "Webhooks" },
  { id: "settings", icon: "fa-gear", label: "Settings" },
];

export default function RadioStationPage() {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);

  const { data: npData, refetch } = useNowPlaying(getStationId());
  const isLive = npData ? npData.live.isLive : true;
  const listeners = npData ? npData.listeners.current : 342;
  const nowPlayingTitle = npData?.nowPlaying?.song?.title || "Amazing Grace (My Chains Are Gone)";
  const nowPlayingArtist = npData?.nowPlaying?.song?.artist || "Chris Tomlin";
  const activeDJ = npData?.live?.streamerName || "Pastor Sarah";

  // Keyboard shortcut: Escape closes sidebar
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSidebarOpen(false);
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  // Listen for navigation events from section components
  useEffect(() => {
    function handleNavigate(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail?.tab) setActiveTab(detail.tab as TabId);
    }
    window.addEventListener("rs-navigate", handleNavigate);
    return () => window.removeEventListener("rs-navigate", handleNavigate);
  }, []);

  // Toast helper
  const showToast = useCallback((title: string, message: string, type: "success" | "error" | "info" = "info", duration = 4000) => {
    const container = document.getElementById("rsToastContainer");
    if (!container) return;
    const toast = document.createElement("div");
    toast.className = "rs-toast";
    const icons = { success: "fa-check", error: "fa-xmark", info: "fa-info" };
    toast.innerHTML = `
      <div class="rs-toast-icon ${type}"><i class="fas ${icons[type]}"></i></div>
      <div class="rs-toast-content"><div class="rs-toast-title">${title}</div><div class="rs-toast-msg">${message}</div></div>
      <button class="rs-toast-close" onclick="this.parentElement.remove()"><i class="fas fa-xmark"></i></button>
    `;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("show"));
    setTimeout(() => { toast.classList.remove("show"); setTimeout(() => toast.remove(), 350); }, duration);
  }, []);

  const renderSection = () => {
    const commonProps = { showToast };
    switch (activeTab) {
      case "overview": return <Overview {...commonProps} />;
      case "media": return <Media {...commonProps} />;
      case "playlists": return <Playlists {...commonProps} />;
      case "djs": return <DJAccounts {...commonProps} />;
      case "schedule": return <Schedule {...commonProps} />;
      case "analytics": return <Analytics {...commonProps} />;
      case "webhooks": return <Webhooks {...commonProps} />;
      case "settings": return <Settings {...commonProps} />;
    }
  };

  return (
    <>
      {/* ========== GLOBAL STYLES ========== */}
      <style>{`
        :root {
          --rs-primary: #E8A838; --rs-primary-light: #F5C76B; --rs-primary-dark: #C48A2A;
          --rs-bg: #0F0F0F; --rs-surface: #1A1A1A; --rs-surface-elevated: #242424;
          --rs-surface-card: #1E1E1E; --rs-surface-hover: #2A2A2A;
          --rs-text: #FFFFFF; --rs-text-secondary: #A0A0A0; --rs-text-tertiary: #6B6B6B;
          --rs-border: #2A2A2A;
          --rs-error: #FF6B6B; --rs-success: #4ADE80; --rs-info: #38BDF8; --rs-warning: #FBBF24;
          --rs-overlay: rgba(0,0,0,0.92);
          --rs-grad-start: #E8A838; --rs-grad-end: #D4762A;
          --rs-grad-purple: #8B5CF6; --rs-grad-blue: #3B82F6; --rs-grad-red: #EF4444; --rs-grad-green: #22C55E;
          --rs-shadow-soft: 0 4px 20px rgba(232,168,56,0.15);
          --rs-shadow-elevated: 0 8px 32px rgba(0,0,0,0.5);
          --rs-radius-sm: 10px; --rs-radius-md: 14px; --rs-radius-lg: 18px; --rs-radius-xl: 22px; --rs-radius-full: 50%;
          --rs-sidebar-width: 200px;
        }
        * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; }
        html, body { height: 100%; overflow: hidden; background: var(--rs-bg); color: var(--rs-text); }

        .rs-app {
          height: 100%; display: flex; flex-direction: column;
          background: var(--rs-bg);
        }

        /* ========== HEADER ========== */
        .rs-header {
          display: flex; align-items: center; gap: 14px;
          padding: 8px 20px; background: var(--rs-bg);
          border-bottom: 1px solid var(--rs-border);
          flex-shrink: 0; z-index: 100;
          min-height: 56px;
        }
        .rs-header-logo {
          width: 36px; height: 36px;
          background: linear-gradient(135deg, var(--rs-grad-start), var(--rs-grad-end));
          border-radius: 10px; display: flex; align-items: center; justify-content: center;
          box-shadow: var(--rs-shadow-soft); flex-shrink: 0;
        }
        .rs-header-logo i { font-size: 16px; color: #fff; }
        .rs-header-info { flex: 1; min-width: 0; }
        .rs-header-name { font-size: 15px; font-weight: 700; }
        .rs-header-sub { font-size: 11px; color: var(--rs-text-tertiary); margin-top: 1px; }
        .rs-header-right { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }

        .rs-on-air-badge {
          display: flex; align-items: center; gap: 6px;
          padding: 4px 12px; border-radius: 20px;
          font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;
        }
        .rs-on-air-badge.live { background: rgba(34,197,94,0.12); color: var(--rs-success); }
        .rs-on-air-badge.off { background: var(--rs-surface-elevated); color: var(--rs-text-tertiary); }
        .rs-on-air-dot {
          width: 7px; height: 7px; border-radius: var(--rs-radius-full);
        }
        .rs-on-air-dot.live { background: var(--rs-success); animation: rsPulse 1.5s ease-in-out infinite; }
        .rs-on-air-dot.off { background: var(--rs-text-tertiary); }

        @keyframes rsPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(1.5); }
        }

        .rs-listeners {
          display: flex; align-items: center; gap: 5px;
          font-size: 13px; color: var(--rs-text-secondary); font-weight: 600;
        }
        .rs-listeners i { font-size: 12px; color: var(--rs-text-tertiary); }

        .rs-dj-name {
          font-size: 12px; color: var(--rs-primary); font-weight: 600;
          padding: 4px 10px; background: rgba(232,168,56,0.1); border-radius: 20px;
        }

        .rs-header-play-btn {
          width: 36px; height: 36px; border-radius: var(--rs-radius-full);
          background: linear-gradient(135deg, var(--rs-grad-start), var(--rs-grad-end));
          border: none; color: #fff; font-size: 14px;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; transition: all 0.2s ease; box-shadow: var(--rs-shadow-soft);
        }
        .rs-header-play-btn:active { transform: scale(0.9); }
        .rs-header-play-btn.playing { animation: rsGlow 2s ease-in-out infinite; }

        @keyframes rsGlow {
          0%, 100% { box-shadow: var(--rs-shadow-soft); }
          50% { box-shadow: 0 0 20px rgba(232,168,56,0.3); }
        }

        /* ========== NOW PLAYING BAR ========== */
        .rs-nowplaying-bar {
          display: flex; align-items: center; gap: 10px;
          padding: 6px 20px; background: var(--rs-surface);
          border-bottom: 1px solid var(--rs-border); flex-shrink: 0;
        }
        .rs-np-thumb {
          width: 32px; height: 32px; border-radius: 6px; overflow: hidden; flex-shrink: 0;
          background: linear-gradient(135deg, var(--rs-surface-elevated), var(--rs-surface-hover));
          display: flex; align-items: center; justify-content: center;
        }
        .rs-np-thumb i { font-size: 14px; color: var(--rs-text-tertiary); }
        .rs-np-thumb img { width: 100%; height: 100%; object-fit: cover; }
        .rs-np-info { flex: 1; min-width: 0; display: flex; align-items: center; gap: 12px; }
        .rs-np-title { font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .rs-np-artist { font-size: 11px; color: var(--rs-text-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .rs-np-sep { width: 3px; height: 3px; background: var(--rs-text-tertiary); border-radius: 50%; flex-shrink: 0; }

        /* ========== BODY ========== */
        .rs-body {
          flex: 1; display: flex; overflow: hidden;
        }

        /* ========== SIDEBAR ========== */
        .rs-sidebar {
          width: var(--rs-sidebar-width);
          background: var(--rs-surface);
          border-right: 1px solid var(--rs-border);
          display: flex; flex-direction: column;
          flex-shrink: 0; overflow-y: auto;
          padding: 8px 0;
        }
        .rs-sidebar::-webkit-scrollbar { display: none; }

        .rs-sidebar-btn {
          display: flex; align-items: center; gap: 10px;
          padding: 10px 16px; width: 100%;
          background: none; border: none;
          color: var(--rs-text-tertiary); font-size: 13px; font-weight: 600;
          cursor: pointer; transition: all 0.15s ease;
          text-align: left; position: relative;
        }
        .rs-sidebar-btn i { width: 18px; font-size: 15px; text-align: center; }
        .rs-sidebar-btn:hover { color: var(--rs-text-secondary); }
        .rs-sidebar-btn:active { background: var(--rs-surface-elevated); }
        .rs-sidebar-btn.active {
          color: var(--rs-primary);
          background: linear-gradient(90deg, rgba(232,168,56,0.08), transparent);
        }
        .rs-sidebar-btn.active::before {
          content: ''; position: absolute; left: 0; top: 4px; bottom: 4px; width: 3px;
          background: linear-gradient(to bottom, var(--rs-grad-start), var(--rs-grad-end));
          border-radius: 0 3px 3px 0;
        }

        /* ========== MAIN CONTENT ========== */
        .rs-main {
          flex: 1; overflow-y: auto; overflow-x: hidden;
          -webkit-overflow-scrolling: touch;
          padding: 20px;
        }
        .rs-main::-webkit-scrollbar { display: none; }

        /* ========== OVERLAY (mobile sidebar) ========== */
        .rs-sidebar-overlay {
          display: none;
        }

        /* ========== MOBILE SIDEBAR BOTTOM NAV ========== */
        .rs-mobile-nav {
          display: none;
        }

        /* ========== TOAST ========== */
        #rsToastContainer {
          position: fixed; top: env(safe-area-inset-top, 12px); left: 16px; right: 16px;
          z-index: 10001; display: flex; flex-direction: column; gap: 8px; pointer-events: none;
        }
        .rs-toast {
          background: var(--rs-surface-elevated); border: 1px solid var(--rs-border);
          border-radius: var(--rs-radius-lg); padding: 14px 18px;
          display: flex; align-items: center; gap: 12px;
          box-shadow: var(--rs-shadow-elevated);
          transform: translateY(-20px); opacity: 0;
          transition: all 0.35s cubic-bezier(0.32, 0.72, 0, 1);
          pointer-events: auto;
        }
        .rs-toast.show { transform: translateY(0); opacity: 1; }
        .rs-toast-icon {
          width: 32px; height: 32px; border-radius: 10px;
          display: flex; align-items: center; justify-content: center; flex-shrink: 0;
        }
        .rs-toast-icon.success { background: rgba(74,222,128,0.15); color: var(--rs-success); }
        .rs-toast-icon.error { background: rgba(255,107,107,0.15); color: var(--rs-error); }
        .rs-toast-icon.info { background: rgba(232,168,56,0.15); color: var(--rs-primary); }
        .rs-toast-content { flex: 1; }
        .rs-toast-title { font-size: 14px; font-weight: 600; }
        .rs-toast-msg { font-size: 13px; color: var(--rs-text-secondary); margin-top: 2px; }
        .rs-toast-close {
          background: none; border: none; color: var(--rs-text-tertiary);
          font-size: 16px; cursor: pointer; padding: 4px;
        }

        /* ========== RESPONSIVE ========== */
        @media (min-width: 481px) {
          .rs-app { max-width: 100%; margin: 0; }
        }
        @media (max-width: 768px) {
          .rs-sidebar { display: none; }
          .rs-mobile-nav {
            display: flex;
            position: fixed; bottom: 0; left: 0; right: 0;
            background: rgba(15,15,15,0.92);
            backdrop-filter: blur(20px) saturate(180%);
            -webkit-backdrop-filter: blur(20px) saturate(180%);
            border-top: 1px solid var(--rs-border);
            padding: 6px 0 calc(6px + env(safe-area-inset-bottom, 0px));
            z-index: 1000;
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
          }
          .rs-mobile-nav::-webkit-scrollbar { display: none; }
          .rs-mobile-nav-btn {
            display: flex; flex-direction: column; align-items: center; gap: 3px;
            padding: 4px 12px; background: none; border: none;
            color: var(--rs-text-tertiary); cursor: pointer;
            transition: all 0.2s ease; flex-shrink: 0;
            font-size: 10px; font-weight: 600;
          }
          .rs-mobile-nav-btn i { font-size: 18px; }
          .rs-mobile-nav-btn.active { color: var(--rs-primary); }
          .rs-mobile-nav-btn:active i { transform: scale(0.85); }
          .rs-main { padding: 16px; padding-bottom: 80px; }

          .rs-sidebar-overlay {
            display: none; position: fixed; inset: 0;
            background: var(--rs-overlay); z-index: 9000;
          }
          .rs-sidebar-overlay.open { display: block; }
          .rs-mobile-sidebar {
            position: fixed; top: 0; left: 0; bottom: 0;
            width: 260px; background: var(--rs-surface);
            z-index: 9001; transform: translateX(-100%);
            transition: transform 0.3s cubic-bezier(0.32, 0.72, 0, 1);
            display: flex; flex-direction: column; padding: 8px 0;
            border-right: 1px solid var(--rs-border);
          }
          .rs-mobile-sidebar.open { transform: translateX(0); }
          .rs-mobile-sidebar-header {
            padding: 16px; border-bottom: 1px solid var(--rs-border);
            display: flex; align-items: center; justify-content: space-between;
          }
          .rs-mobile-sidebar-header h3 { font-size: 16px; font-weight: 700; }
          .rs-mobile-sidebar-close {
            width: 32px; height: 32px; border-radius: var(--rs-radius-full);
            background: var(--rs-surface-elevated); border: none;
            color: var(--rs-text); font-size: 14px;
            display: flex; align-items: center; justify-content: center; cursor: pointer;
          }
        }

        /* ========== COMMON SECTION STYLES ========== */
        .rs-section { display: flex; flex-direction: column; gap: 20px; }
        .rs-section-title { font-size: 20px; font-weight: 700; }
        .rs-section-header {
          display: flex; align-items: center; justify-content: space-between;
        }
        .rs-section-subtitle { font-size: 13px; color: var(--rs-text-tertiary); }
        .rs-card {
          background: var(--rs-surface-card); border: 1px solid var(--rs-border);
          border-radius: var(--rs-radius-lg); padding: 18px;
        }
        .rs-card-row {
          display: flex; gap: 12px;
        }
        .rs-card-row > * { flex: 1; }
        .rs-badge {
          padding: 3px 10px; border-radius: 20px;
          font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;
          display: inline-flex; align-items: center; gap: 5px;
        }
        .rs-badge.green { background: rgba(34,197,94,0.12); color: var(--rs-success); }
        .rs-badge.red { background: rgba(239,68,68,0.12); color: var(--rs-error); }
        .rs-badge.gold { background: rgba(232,168,56,0.12); color: var(--rs-primary); }
        .rs-badge.blue { background: rgba(59,130,246,0.12); color: var(--rs-grad-blue); }
        .rs-badge.purple { background: rgba(139,92,246,0.12); color: var(--rs-grad-purple); }
        .rs-badge.gray { background: var(--rs-surface-elevated); color: var(--rs-text-tertiary); }

        .rs-btn-primary {
          padding: 10px 20px; background: linear-gradient(135deg, var(--rs-grad-start), var(--rs-grad-end));
          border: none; border-radius: var(--rs-radius-md);
          color: #fff; font-size: 14px; font-weight: 700;
          cursor: pointer; transition: all 0.2s ease; box-shadow: var(--rs-shadow-soft);
          display: inline-flex; align-items: center; gap: 8px;
        }
        .rs-btn-primary:active { transform: scale(0.97); }
        .rs-btn-secondary {
          padding: 10px 20px; background: var(--rs-surface);
          border: 1.5px solid var(--rs-border); border-radius: var(--rs-radius-md);
          color: var(--rs-text); font-size: 14px; font-weight: 600;
          cursor: pointer; transition: all 0.2s ease;
          display: inline-flex; align-items: center; gap: 8px;
        }
        .rs-btn-secondary:active { background: var(--rs-surface-elevated); }
        .rs-btn-danger {
          padding: 10px 20px; background: rgba(239,68,68,0.12);
          border: none; border-radius: var(--rs-radius-md);
          color: var(--rs-error); font-size: 14px; font-weight: 700;
          cursor: pointer; transition: all 0.2s ease;
          display: inline-flex; align-items: center; gap: 8px;
        }
        .rs-btn-danger:active { background: rgba(239,68,68,0.2); transform: scale(0.97); }

        .rs-input {
          width: 100%; padding: 12px 14px;
          background: var(--rs-surface-card); border: 1.5px solid var(--rs-border);
          border-radius: var(--rs-radius-md); color: var(--rs-text);
          font-size: 14px; font-weight: 500; outline: none;
          transition: all 0.2s ease;
        }
        .rs-input:focus { border-color: var(--rs-primary); box-shadow: 0 0 0 4px rgba(232,168,56,0.08); }
        .rs-input::placeholder { color: var(--rs-text-tertiary); font-weight: 400; }

        .rs-select {
          width: 100%; padding: 12px 14px;
          background: var(--rs-surface-card); border: 1.5px solid var(--rs-border);
          border-radius: var(--rs-radius-md); color: var(--rs-text);
          font-size: 14px; font-weight: 500; outline: none;
          appearance: none; -webkit-appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='%236B6B6B' viewBox='0 0 16 16'%3E%3Cpath d='M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z'/%3E%3C/svg%3E");
          background-repeat: no-repeat; background-position: right 14px center; padding-right: 40px;
        }
        .rs-select:focus { border-color: var(--rs-primary); }

        .rs-empty {
          display: flex; flex-direction: column; align-items: center;
          padding: 40px 20px; text-align: center; gap: 10px;
        }
        .rs-empty i { font-size: 36px; color: var(--rs-text-tertiary); }
        .rs-empty h4 { font-size: 16px; font-weight: 600; }
        .rs-empty p { font-size: 13px; color: var(--rs-text-secondary); }

        .rs-divider { height: 1px; background: var(--rs-border); margin: 8px 0; }

        .rs-toggle {
          width: 44px; height: 26px; background: var(--rs-surface-elevated);
          border-radius: 13px; position: relative; cursor: pointer;
          transition: all 0.25s ease; border: none; flex-shrink: 0;
        }
        .rs-toggle.active { background: linear-gradient(135deg, var(--rs-grad-green), #16A34A); }
        .rs-toggle::after {
          content: ''; position: absolute; top: 3px; left: 3px;
          width: 20px; height: 20px; background: #fff;
          border-radius: var(--rs-radius-full);
          transition: all 0.25s cubic-bezier(0.32, 0.72, 0, 1);
          box-shadow: 0 2px 6px rgba(0,0,0,0.2);
        }
        .rs-toggle.active::after { left: 21px; }

        @keyframes rsFadeUp {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .rs-animate-in { animation: rsFadeUp 0.3s ease; }
      `}</style>

      {/* ========== TOAST CONTAINER ========== */}
      <div id="rsToastContainer"></div>

      {/* ========== MOBILE SIDEBAR OVERLAY ========== */}
      {sidebarOpen && (
        <>
          <div className="rs-sidebar-overlay open" onClick={() => setSidebarOpen(false)}></div>
          <div className="rs-mobile-sidebar open">
            <div className="rs-mobile-sidebar-header">
              <h3>Radio Station</h3>
              <button className="rs-mobile-sidebar-close" onClick={() => setSidebarOpen(false)}>
                <i className="fas fa-xmark"></i>
              </button>
            </div>
            {SIDEBAR_TABS.map((tab) => (
              <button
                key={tab.id}
                className={`rs-sidebar-btn${activeTab === tab.id ? " active" : ""}`}
                onClick={() => { setActiveTab(tab.id); setSidebarOpen(false); }}
              >
                <i className={`fas ${tab.icon}`}></i>
                {tab.label}
              </button>
            ))}
          </div>
        </>
      )}

      {/* ========== MAIN APP ========== */}
      <div className="rs-app">
        <PremiumTopBar minimal />
        {/* HEADER */}
        <header className="rs-header">
          <button className="rs-header-play-btn" style={{ display: "none" }} id="rsMobileMenuBtn"
            onClick={() => setSidebarOpen(true)}>
            <i className="fas fa-bars"></i>
          </button>
          <style>{`@media(max-width:768px){#rsMobileMenuBtn{display:flex!important;}}`}</style>
          <div className="rs-header-logo"><i className="fas fa-tower-broadcast"></i></div>
          <div className="rs-header-info">
            <div className="rs-header-name">CHRISTIAN REVIVAL CHURCH Radio</div>
          </div>
          <div className="rs-header-right">
            {activeDJ && <div className="rs-dj-name"><i className="fas fa-user"></i> {activeDJ}</div>}
            <div className={`rs-on-air-badge ${isLive ? "live" : "off"}`}>
              <span className={`rs-on-air-dot ${isLive ? "live" : "off"}`}></span>
              {isLive ? "On Air" : "Off Air"}
            </div>
            <div className="rs-listeners">
              <i className="fas fa-headphones"></i>
              {listeners}
            </div>
            <button
              className={`rs-header-play-btn ${isPlaying ? "playing" : ""}`}
              onClick={() => setIsPlaying(!isPlaying)}
            >
              <i className={`fas ${isPlaying ? "fa-pause" : "fa-play"}`}></i>
            </button>
          </div>
        </header>

        {/* NOW PLAYING BAR */}
        <div className="rs-nowplaying-bar">
          <div className="rs-np-thumb">
            <i className="fas fa-music"></i>
          </div>
          <div className="rs-np-info">
            <span className="rs-np-title">{nowPlayingTitle}</span>
            <span className="rs-np-sep"></span>
            <span className="rs-np-artist">{nowPlayingArtist}</span>
          </div>
        </div>

        {/* BODY */}
        <div className="rs-body">
          {/* SIDEBAR */}
          <nav className="rs-sidebar">
            {SIDEBAR_TABS.map((tab) => (
              <button
                key={tab.id}
                className={`rs-sidebar-btn${activeTab === tab.id ? " active" : ""}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <i className={`fas ${tab.icon}`}></i>
                {tab.label}
              </button>
            ))}
          </nav>

          {/* MAIN CONTENT */}
          <main className="rs-main" id="rsMainContent">
            <div className="rs-section rs-animate-in" key={activeTab}>
              {renderSection()}
            </div>
          </main>
        </div>

        {/* MOBILE BOTTOM NAV */}
        <nav className="rs-mobile-nav">
          {SIDEBAR_TABS.map((tab) => (
            <button
              key={tab.id}
              className={`rs-mobile-nav-btn${activeTab === tab.id ? " active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <i className={`fas ${tab.icon}`}></i>
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>
      </div>
    </>
  );
}
