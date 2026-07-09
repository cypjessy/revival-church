"use client";

import React, { useEffect, useRef, useState } from "react";
import AdminBottomNav from "@/components/admin/AdminBottomNav";
import ToastBridge from "@/components/dashboard/ToastBridge";
import PremiumTopBar from "@/components/shared/PremiumTopBar";
import {
  getNowPlaying, getStationStatus, toggleAutoDJ,
  getPlaylists, createPlaylist as apiCreatePlaylist,
  togglePlaylistEnabled as apiTogglePlaylist,
  deletePlaylist as apiDeletePlaylist,
  updatePlaylist as apiUpdatePlaylist,
  addSongsToPlaylist as apiAddSongs,
  removeSongFromPlaylist as apiRemoveSong,
  getStationFiles,
  deleteStationFiles, deleteFile, updateFileMetadata, uploadFile,
  getSongHistory,
  getQueue as apiGetQueue,
  getApiBase,
  getApiKey,
  getStationId,
  getPublicPlayerUrl,
  getStreamers,
  createStreamer,
  updateStreamer,
  deleteStreamer,
} from "@/lib/azuracast";
import { hapticSuccess } from "@/lib/haptics";
import { getRadioConfig, defaultRadioConfig } from "@/lib/radioConfig";
import type { Playlist, StationFile, QueueItem } from "@/lib/azuracast";
import dynamic from "next/dynamic";
import RadioEmbed from "@/components/shared/RadioEmbed";

const RadioOverviewTab = dynamic(() => import("@/components/admin/radio/tabs/RadioOverviewTab").then(m => m.RadioOverviewTab), { ssr: false });
const RadioMediaTab = dynamic(() => import("@/components/admin/radio/tabs/RadioMediaTab").then(m => m.RadioMediaTab), { ssr: false });
const RadioPlaylistsTab = dynamic(() => import("@/components/admin/radio/tabs/RadioPlaylistsTab").then(m => m.RadioPlaylistsTab), { ssr: false });
const RadioGoLiveTab = dynamic(() => import("@/components/admin/radio/tabs/RadioGoLiveTab").then(m => m.RadioGoLiveTab), { ssr: false });

// ========== REFERENCE DATA ==========
const sidebarTabs = [
  { id: "overview", icon: "fa-house", label: "Overview" },
  { id: "media", icon: "fa-music", label: "Media" },
  { id: "playlists", icon: "fa-list", label: "Playlists" },
  { id: "golive", icon: "fa-microphone", label: "Go Live" },
];

// ========== REFERENCE DATA ==========
const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

export default function AdminRadioPage() {
  const [activeTab, setActiveTab] = useState("overview");
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [autoDJ, setAutoDJ] = useState(false);
  const [listeners, setListeners] = useState(0);
  const [overviewNP, setOverviewNP] = useState<import("@/lib/azuracast").NowPlayingData | null>(null);

  // Radio config from Firestore
  const [radioConfig, setRadioConfig] = useState(defaultRadioConfig());

  // Fetch radio config from Firestore on mount
  useEffect(() => {
    getRadioConfig().then((config) => {
      if (config) setRadioConfig({
        stationName: config.stationName || "MOUNTAIN OF DELIVERANCE CHURCH Radio",
        description: config.description || "Radio Station",
        stationId: config.stationId || "4",
        embedUrl: config.embedUrl || "https://azuracast.histoview.co.ke/public/mountain_of_delivarance_church/embed?autoplay=1&rounded=1&allow_popup=1&continuous=1",
        streamUrl: config.streamUrl || "",
      });
    }).catch(() => {});
  }, []);
  const [overviewHistory, setOverviewHistory] = useState<import("@/lib/azuracast").SongHistoryItem[]>([]);
  const [overviewLoading, setOverviewLoading] = useState(false);

  // Media Library state
  const [mediaSearch, setMediaSearch] = useState("");
  const [mediaFilterPlaylist, setMediaFilterPlaylist] = useState("");
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [uploadProgress, setUploadProgress] = useState<{ id: string; name: string; progress: number }[]>([]);
  const [editingFile, setEditingFile] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editArtist, setEditArtist] = useState("");
  const [editAlbum, setEditAlbum] = useState("");
  const [showMediaActions, setShowMediaActions] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [playlistPickerOpen, setPlaylistPickerOpen] = useState(false);

  const [backendRunning, setBackendRunning] = useState(false);

  // Playlists state
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [stationFiles, setStationFiles] = useState<StationFile[]>([]);
  const [loadingPlaylists, setLoadingPlaylists] = useState(true);
  const [expandedPlaylist, setExpandedPlaylist] = useState<string | null>(null);
  const [showCreatePlaylist, setShowCreatePlaylist] = useState(false);
  const [plForm, setPlForm] = useState({ name: "", type: "standard", order: "shuffle", weight: 10 });
  const [plSchedule, setPlSchedule] = useState({ days: [] as string[], startTime: "09:00", endTime: "17:00" });
  const [showSongPicker, setShowSongPicker] = useState(false);
  const [songPickerPlaylistId, setSongPickerPlaylistId] = useState<string | null>(null);
  const [pickerSearch, setPickerSearch] = useState("");
  const [playlistFilter, setPlaylistFilter] = useState("");
  const [plFilterTab, setPlFilterTab] = useState("all");
  const [selectedPlId, setSelectedPlId] = useState<string | null>(null);
  const [showEditPlModal, setShowEditPlModal] = useState(false);
  const [editingPlId, setEditingPlId] = useState<string | null>(null);
  const [plConfirmDelete, setPlConfirmDelete] = useState<string | null>(null);
  const [plMenuOpen, setPlMenuOpen] = useState<string | null>(null);
  const [addSongsSearch, setAddSongsSearch] = useState("");
  const [addSongsSelected, setAddSongsSelected] = useState<Set<string>>(new Set());
  const [plCreateType, setPlCreateType] = useState<"standard" | "scheduled" | "on_demand">("standard");
  const [plCreateOrder, setPlCreateOrder] = useState<"shuffle" | "sequential">("shuffle");
  const [addSongsPlId, setAddSongsPlId] = useState<string | null>(null);
  const [showScheduleView, setShowScheduleView] = useState(false);

  // Play Control state
  const [pcMode, setPcMode] = useState<"schedule" | "playlist" | "single">("schedule");
  const [pcQueue, setPcQueue] = useState<QueueItem[]>([]);
  const [pcPlaylists, setPcPlaylists] = useState<Playlist[]>([]);
  const [pcFiles, setPcFiles] = useState<StationFile[]>([]);
  const [pcActivePlaylist, setPcActivePlaylist] = useState<string | null>(null);
  const [pcActiveTrack, setPcActiveTrack] = useState<string>("");
  const [pcAutoDJ, setPcAutoDJ] = useState(false);
  const [pcLoading, setPcLoading] = useState(false);
  const [pcActionLoading, setPcActionLoading] = useState<string | null>(null);

  // Shared per-tab loading states
  const [plActionLoading, setPlActionLoading] = useState(false);
  const [mediaActionLoading, setMediaActionLoading] = useState(false);

  // Go Live state
  const [streamers, setStreamers] = useState<import("@/lib/azuracast").Streamer[]>([]);
  const [glLoading, setGlLoading] = useState(false);
  const [glActionLoading, setGlActionLoading] = useState<string | null>(null);
  const [showStreamerForm, setShowStreamerForm] = useState(false);
  const [editingStreamerId, setEditingStreamerId] = useState<string | null>(null);
  const [streamerForm, setStreamerForm] = useState({ displayName: "", username: "", password: "" });
  const [glBroadcasts, setGlBroadcasts] = useState<{ streamer: string; date: string; duration: string; startTime: string }[]>([]);
  const [showPassword, setShowPassword] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [selectedStreamerId, setSelectedStreamerId] = useState<string | null>(null);
  const [streamerPasswords, setStreamerPasswords] = useState<Record<string, string>>({});
  const MASTER_PW = "7ZajL44g";

  // Poll Go Live data when tab is active
  useEffect(() => {
    if (activeTab !== "golive") return;
    const poll = async () => {
      await Promise.resolve(); // defer to avoid sync setState
      setGlLoading(true);
      const [strResult, npResult] = await Promise.all([
        getStreamers().catch(() => [] as import("@/lib/azuracast").Streamer[]),
        getNowPlaying(getStationId()).catch(() => null),
      ]);
      setStreamers(strResult);
      if (npResult) {
        setOverviewNP(npResult);
        setListeners(npResult.listeners.current);
        setIsLive(npResult.live.isLive);
      }
      // Set initial selected streamer
      if (strResult.length > 0 && !selectedStreamerId) {
        setSelectedStreamerId(strResult[0].id);
      }
      // Fetch broadcasts for all streamers
      const allBroadcasts: { streamer: string; date: string; duration: string; startTime: string }[] = [];
      for (const s of strResult) {
        try {
          const res = await fetch(
            `${getApiBase()}/api/station/${getStationId()}/streamer/${s.id}/broadcasts`,
            { headers: { Authorization: `Bearer ${getApiKey()}` } }
          );
          if (res.ok) {
            const data = await res.json();
            for (const b of (Array.isArray(data) ? data : [])) {
              const start = new Date(b.timestampStart);
              const end = new Date(b.timestampEnd);
              const diffSec = Math.round((end.getTime() - start.getTime()) / 1000);
              const mins = Math.floor(diffSec / 60);
              const secs = diffSec % 60;
              allBroadcasts.push({
                streamer: s.displayName,
                date: start.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
                startTime: start.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
                duration: diffSec < 60 ? `${diffSec}s` : `${mins}m ${secs}s`,
              });
            }
          }
        } catch {}
      }
      allBroadcasts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setGlBroadcasts(allBroadcasts);
      setGlLoading(false);
    };
    poll();
    const interval = setInterval(poll, 15000);
    return () => clearInterval(interval);
  }, [activeTab]);

  // Fetch playlists and files when Playlists or Media tab is active
  useEffect(() => {
    if (activeTab !== "playlists" && activeTab !== "media") return;
    queueMicrotask(() => setLoadingPlaylists(activeTab === "playlists"));
    Promise.all([
      getPlaylists().then(setPlaylists),
      getStationFiles().then(setStationFiles),
    ]).catch(() => {}).finally(() => {
      if (activeTab === "playlists") setLoadingPlaylists(false);
    });
  }, [activeTab]);

  // Poll overview data when tab is active
  useEffect(() => {
    if (activeTab !== "overview") return;
    const poll = async () => {
      await Promise.resolve();
      setOverviewLoading(true);
      const [np, status, history, queue, playlists, files] = await Promise.all([
        getNowPlaying(getStationId()).catch(() => null),
        getStationStatus(getStationId()).catch(() => ({ backendRunning: false })),
        getSongHistory(5).catch(() => []),
        apiGetQueue().catch(() => []),
        getPlaylists().catch(() => []),
        getStationFiles().catch(() => []),
      ]);
      if (np) {
        setOverviewNP(np);
        setListeners(np.listeners.current);
        setIsLive(np.live.isLive || (status?.backendRunning ?? false));
      }
      if (status) {
        setAutoDJ(status.backendRunning);
        setPcAutoDJ(status.backendRunning);
        setBackendRunning(status.backendRunning);
      }
      if (history) setOverviewHistory(history);
      if (queue) setPcQueue(queue);
      if (playlists) {
        setPcPlaylists(playlists);
        const active = playlists.find((p: Playlist) => p.enabled && !p.schedule && playlists.filter((o: Playlist) => o.enabled && !o.schedule).length === 1);
        setPcActivePlaylist(active?.id || null);
        if (!active) setPcActiveTrack("");
      }
      if (files) setPcFiles(files);
      setOverviewLoading(false);
    };
    poll();
    const interval = setInterval(poll, 10000);
    return () => clearInterval(interval);
  }, [activeTab]);

  const renderOverview = () => (
    <RadioOverviewTab
      overviewNP={overviewNP}
      overviewHistory={overviewHistory}
      overviewLoading={overviewLoading}
      autoDJ={autoDJ}
      isLive={isLive}
      isPlaying={isPlaying}
      listeners={listeners}
      backendRunning={backendRunning}
      streamUrl={overviewNP?.station?.listenUrl || radioConfig.streamUrl}
      setAutoDJ={setAutoDJ}
      pcMode={pcMode}
      pcQueue={pcQueue}
      pcPlaylists={pcPlaylists}
      pcFiles={pcFiles}
      pcActivePlaylist={pcActivePlaylist}
      pcActiveTrack={pcActiveTrack}
      pcAutoDJ={pcAutoDJ}
      pcActionLoading={pcActionLoading}
      setPcMode={setPcMode}
      setPcPlaylists={setPcPlaylists}
      setPcActivePlaylist={setPcActivePlaylist}
      setPcActiveTrack={setPcActiveTrack}
      setPcActionLoading={setPcActionLoading}
      setActiveTab={setActiveTab}
    />
  );

  const renderMedia = () => (
    <RadioMediaTab
      stationFiles={stationFiles}
      setStationFiles={setStationFiles}
      mediaSearch={mediaSearch}
      setMediaSearch={setMediaSearch}
      mediaFilterPlaylist={mediaFilterPlaylist}
      setMediaFilterPlaylist={setMediaFilterPlaylist}
      selectedFileIds={selectedFileIds}
      setSelectedFileIds={setSelectedFileIds}
      uploadProgress={uploadProgress}
      setUploadProgress={setUploadProgress}
      editingFile={editingFile}
      setEditingFile={setEditingFile}
      editTitle={editTitle}
      setEditTitle={setEditTitle}
      editArtist={editArtist}
      setEditArtist={setEditArtist}
      editAlbum={editAlbum}
      setEditAlbum={setEditAlbum}
      showMediaActions={showMediaActions}
      setShowMediaActions={setShowMediaActions}
      menuPos={menuPos}
      setMenuPos={setMenuPos}
      dragging={dragging}
      setDragging={setDragging}
      playlistPickerOpen={playlistPickerOpen}
      setPlaylistPickerOpen={setPlaylistPickerOpen}
      playlists={playlists}
      mediaActionLoading={mediaActionLoading}
      setMediaActionLoading={setMediaActionLoading}
    />
  );
  const renderPlaylists = () => (
    <RadioPlaylistsTab
      playlists={playlists}
      setPlaylists={setPlaylists}
      stationFiles={stationFiles}
      setStationFiles={setStationFiles}
      loadingPlaylists={loadingPlaylists}
      setLoadingPlaylists={setLoadingPlaylists}
      selectedPlId={selectedPlId}
      setSelectedPlId={setSelectedPlId}
      showEditPlModal={showEditPlModal}
      setShowEditPlModal={setShowEditPlModal}
      editingPlId={editingPlId}
      setEditingPlId={setEditingPlId}
      plConfirmDelete={plConfirmDelete}
      setPlConfirmDelete={setPlConfirmDelete}
      plMenuOpen={plMenuOpen}
      setPlMenuOpen={setPlMenuOpen}
      showCreatePlaylist={showCreatePlaylist}
      setShowCreatePlaylist={setShowCreatePlaylist}
      plForm={plForm}
      setPlForm={setPlForm}
      plSchedule={plSchedule}
      setPlSchedule={setPlSchedule}
      showSongPicker={showSongPicker}
      setShowSongPicker={setShowSongPicker}
      addSongsSearch={addSongsSearch}
      setAddSongsSearch={setAddSongsSearch}
      addSongsSelected={addSongsSelected}
      setAddSongsSelected={setAddSongsSelected}
      addSongsPlId={addSongsPlId}
      setAddSongsPlId={setAddSongsPlId}
      plCreateType={plCreateType}
      setPlCreateType={setPlCreateType}
      plCreateOrder={plCreateOrder}
      setPlCreateOrder={setPlCreateOrder}
      plFilterTab={plFilterTab}
      setPlFilterTab={setPlFilterTab}
      playlistFilter={playlistFilter}
      setPlaylistFilter={setPlaylistFilter}
      showScheduleView={showScheduleView}
      setShowScheduleView={setShowScheduleView}
      plActionLoading={plActionLoading}
      setPlActionLoading={setPlActionLoading}
      pcActivePlaylist={pcActivePlaylist}
    />
  );

  const renderGoLive = () => (
    <RadioGoLiveTab
      isLive={isLive}
      listeners={listeners}
      streamers={streamers}
      setStreamers={setStreamers}
      glLoading={glLoading}
      glActionLoading={glActionLoading}
      setGlActionLoading={setGlActionLoading}
      showStreamerForm={showStreamerForm}
      setShowStreamerForm={setShowStreamerForm}
      editingStreamerId={editingStreamerId}
      setEditingStreamerId={setEditingStreamerId}
      streamerForm={streamerForm}
      setStreamerForm={setStreamerForm}
      glBroadcasts={glBroadcasts}
      showPassword={showPassword}
      setShowPassword={setShowPassword}
      copyFeedback={copyFeedback}
      setCopyFeedback={setCopyFeedback}
      selectedStreamerId={selectedStreamerId}
      setSelectedStreamerId={setSelectedStreamerId}
      streamerPasswords={streamerPasswords}
      setStreamerPasswords={setStreamerPasswords}
      MASTER_PW={MASTER_PW}
    />
  );

  const renderContent = () => {
    switch (activeTab) {
      case "overview": return renderOverview();
      case "media": return renderMedia();
      case "playlists": return renderPlaylists();
      case "golive": return renderGoLive();
      default: return renderOverview();
    }
  };
  return (
    <>
      <style>{`
        :root {
          --primary: #E8A838;
          --primary-light: #F5C76B;
          --primary-dark: #C48A2A;
          --bg: #0F0F0F;
          --surface: #1A1A1A;
          --surface-elevated: #242424;
          --surface-card: #1E1E1E;
          --surface-hover: #2A2A2A;
          --text-primary: #FFFFFF;
          --text-secondary: #A0A0A0;
          --text-tertiary: #6B6B6B;
          --border: #2A2A2A;
          --error: #FF6B6B;
          --success: #4ADE80;
          --info: #38BDF8;
          --warning: #FBBF24;
          --overlay: rgba(0,0,0,0.92);
          --gradient-start: #E8A838;
          --gradient-end: #D4762A;
          --gradient-purple: #8B5CF6;
          --gradient-blue: #3B82F6;
          --gradient-red: #EF4444;
          --gradient-green: #22C55E;
          --shadow-soft: 0 4px 20px rgba(232,168,56,0.15);
          --shadow-elevated: 0 8px 32px rgba(0,0,0,0.5);
          --radius-sm: 10px;
          --radius-md: 14px;
          --radius-lg: 18px;
          --radius-xl: 22px;
          --radius-full: 50%;
        }

        * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; }
        html, body { height: 100%; overflow: hidden; background: var(--bg); color: var(--text-primary); }

        .app-container {
          height: 100%; display: flex; flex-direction: column; position: relative; overflow: hidden;
        }
        @media (min-width: 480px) {
          .app-container { max-width: 480px; margin: 0 auto; border-left: 1px solid var(--border); border-right: 1px solid var(--border); }
        }


        /* ========== HEADER ========== */
        .radio-header {
          padding: 12px 16px 10px;
          display: flex; align-items: center; gap: 12px;
          flex-shrink: 0; background: var(--bg); border-bottom: 1px solid var(--border);
        }
        .radio-header-logo {
          width: 40px; height: 40px;
          background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end));
          border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: center;
          flex-shrink: 0; box-shadow: var(--shadow-soft);
        }
        .radio-header-logo i { font-size: 18px; color: #fff; }
        .radio-header-info { flex: 1; min-width: 0; }
        .radio-header-name { font-size: 15px; font-weight: 700; line-height: 1.2; }
        .radio-header-sub { font-size: 11px; color: var(--text-tertiary); margin-top: 1px; }
        .radio-header-right { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }

        .on-air-badge {
          display: flex; align-items: center; gap: 6px;
          padding: 4px 12px; border-radius: 20px;
          font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;
        }
        .on-air-badge.live { background: rgba(239,68,68,0.12); color: var(--error); }
        .on-air-badge.off { background: var(--surface-elevated); color: var(--text-tertiary); }
        .on-air-dot {
          width: 7px; height: 7px; border-radius: var(--radius-full);
        }
        .on-air-dot.live { background: var(--error); animation: livePulse 1.5s ease-in-out infinite; }
        .on-air-dot.off { background: var(--text-tertiary); }

        .listener-count {
          display: flex; align-items: center; gap: 5px;
          font-size: 12px; color: var(--text-secondary); font-weight: 600;
        }
        .listener-count i { font-size: 11px; color: var(--text-tertiary); }

        @keyframes livePulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(1.5); }
        }

        /* ===== PREMIUM RADIO HERO CARD ===== */
        .rh-hero {
            position: relative;
            background: linear-gradient(180deg, rgba(232,168,56,0.06) 0%, rgba(15,15,15,0.5) 100%);
            border: 1px solid rgba(232,168,56,0.12);
            border-radius: var(--radius-xl);
            padding: 20px 18px 16px;
            overflow: hidden;
            box-shadow: 0 8px 40px rgba(0,0,0,0.4), 0 0 80px rgba(232,168,56,0.04);
            animation: rhFadeIn 0.6s ease;
        }
        @keyframes rhFadeIn {
            from { opacity: 0; transform: translateY(16px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .rh-glow-1 {
            position: absolute; top: -80px; left: 50%; transform: translateX(-50%);
            width: 300px; height: 300px;
            background: radial-gradient(circle, rgba(232,168,56,0.12) 0%, transparent 70%);
            pointer-events: none;
            animation: rhGlowPulse 4s ease-in-out infinite;
        }
        .rh-glow-2 {
            position: absolute; bottom: -60px; right: -60px;
            width: 200px; height: 200px;
            background: radial-gradient(circle, rgba(212,118,42,0.06) 0%, transparent 70%);
            pointer-events: none;
            animation: rhGlowPulse2 5s ease-in-out infinite reverse;
        }
        @keyframes rhGlowPulse {
            0%, 100% { opacity: 0.5; transform: translateX(-50%) scale(1); }
            50% { opacity: 1; transform: translateX(-50%) scale(1.15); }
        }
        @keyframes rhGlowPulse2 {
            0%, 100% { opacity: 0.3; transform: scale(1); }
            50% { opacity: 0.8; transform: scale(1.2); }
        }
        .rh-top {
            display: flex; align-items: center; justify-content: space-between;
            margin-bottom: 16px; position: relative; z-index: 1;
        }
        .rh-station {
            display: flex; align-items: center; gap: 8px;
            font-size: 13px; font-weight: 700;
        }
        .rh-station i { color: var(--primary); font-size: 14px; }
        .rh-badges { display: flex; align-items: center; gap: 8px; }
        .rh-live-badge {
            display: flex; align-items: center; gap: 5px;
            padding: 4px 10px; border-radius: 20px;
            font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;
            transition: all 0.3s ease;
        }
        .rh-live-badge.live { background: rgba(74,222,128,0.12); color: var(--success); }
        .rh-live-badge.off { background: rgba(107,107,107,0.12); color: var(--text-tertiary); }
        .rh-live-dot {
            width: 6px; height: 6px; border-radius: 50%;
        }
        .rh-live-badge.live .rh-live-dot { background: var(--success); animation: livePulse 1.5s ease-in-out infinite; }
        .rh-live-badge.off .rh-live-dot { background: var(--text-tertiary); }
        .rh-listener-badge {
            display: flex; align-items: center; gap: 4px;
            padding: 4px 10px; border-radius: 20px;
            background: var(--surface); border: 1px solid var(--border);
            font-size: 11px; font-weight: 600; color: var(--text-secondary);
        }
        .rh-listener-badge i { font-size: 10px; color: var(--primary); }
        .rh-main {
            display: flex; align-items: center; gap: 18px;
            margin-bottom: 14px; position: relative; z-index: 1;
        }
        .rh-art-wrap {
            position: relative; flex-shrink: 0;
            width: 100px; height: 100px;
        }
        .rh-art-ring {
            position: absolute; inset: -4px;
            border-radius: 50%;
            border: 2px solid rgba(232,168,56,0.2);
            animation: rhRingSpin 8s linear infinite;
        }
        @keyframes rhRingSpin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
        .rh-art-ring::before {
            content: ''; position: absolute; top: -2px; left: 50%; transform: translateX(-50%);
            width: 8px; height: 8px; border-radius: 50%;
            background: var(--primary);
            box-shadow: 0 0 12px rgba(232,168,56,0.6);
        }
        .rh-art {
            width: 100%; height: 100%;
            border-radius: 50%; overflow: hidden;
            box-shadow: 0 8px 32px rgba(0,0,0,0.5), 0 0 0 2px rgba(232,168,56,0.1);
            transition: all 0.5s ease;
            position: relative;
        }
        .rh-art.spinning { animation: rhSpin 12s linear infinite; }
        @keyframes rhSpin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
        .rh-art img { width: 100%; height: 100%; object-fit: cover; }
        .rh-art-fallback {
            width: 100%; height: 100%;
            background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end));
            display: flex; align-items: center; justify-content: center;
            font-size: 38px; color: #fff;
        }
        .rh-vinyl-lines {
            position: absolute; inset: 0; border-radius: 50%;
            background: conic-gradient(from 0deg, transparent 0deg, rgba(255,255,255,0.03) 10deg, transparent 20deg, rgba(255,255,255,0.03) 30deg, transparent 40deg, rgba(255,255,255,0.03) 50deg, transparent 60deg, rgba(255,255,255,0.03) 70deg, transparent 80deg, rgba(255,255,255,0.03) 90deg, transparent 100deg, rgba(255,255,255,0.03) 110deg, transparent 120deg, rgba(255,255,255,0.03) 130deg, transparent 140deg, rgba(255,255,255,0.03) 150deg, transparent 160deg, rgba(255,255,255,0.03) 170deg, transparent 180deg, rgba(255,255,255,0.03) 190deg, transparent 200deg, rgba(255,255,255,0.03) 210deg, transparent 220deg, rgba(255,255,255,0.03) 230deg, transparent 240deg, rgba(255,255,255,0.03) 250deg, transparent 260deg, rgba(255,255,255,0.03) 270deg, transparent 280deg, rgba(255,255,255,0.03) 290deg, transparent 300deg, rgba(255,255,255,0.03) 310deg, transparent 320deg, rgba(255,255,255,0.03) 330deg, transparent 340deg, rgba(255,255,255,0.03) 350deg, transparent 360deg);
            pointer-events: none; z-index: 2;
        }
        .rh-eq {
            position: absolute; bottom: 6px; left: 50%; transform: translateX(-50%);
            display: flex; gap: 3px; align-items: flex-end;
            z-index: 3;
        }
        .rh-eq span {
            width: 4px; background: var(--primary); border-radius: 2px;
            animation: rhEqBounce 0.6s ease-in-out infinite alternate;
        }
        .rh-eq span:nth-child(1) { height: 10px; animation-delay: 0s; }
        .rh-eq span:nth-child(2) { height: 16px; animation-delay: 0.15s; }
        .rh-eq span:nth-child(3) { height: 12px; animation-delay: 0.3s; }
        .rh-eq span:nth-child(4) { height: 8px; animation-delay: 0.45s; }
        @keyframes rhEqBounce {
            from { transform: scaleY(0.5); }
            to { transform: scaleY(1); }
        }
        .rh-info { flex: 1; min-width: 0; }
        .rh-track-name {
            font-size: 18px; font-weight: 800;
            letter-spacing: -0.3px;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .rh-track-artist {
            font-size: 14px; color: var(--primary-light);
            margin-top: 4px;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .rh-source {
            font-size: 11px; color: var(--text-tertiary);
            margin-top: 6px; display: flex; align-items: center; gap: 4px;
        }
        .rh-source i { color: var(--primary); font-size: 10px; }
        .rh-progress-wrap {
            margin-bottom: 14px; position: relative; z-index: 1;
        }
        .rh-progress-bar {
            width: 100%; height: 4px;
            background: rgba(255,255,255,0.06);
            border-radius: 3px; overflow: hidden;
        }
        .rh-progress-fill {
            height: 100%;
            background: linear-gradient(90deg, var(--gradient-start), var(--gradient-end));
            border-radius: 3px;
            transition: width 1s ease;
            position: relative;
        }
        .rh-progress-glow {
            position: absolute; right: 0; top: -2px;
            width: 8px; height: 8px; border-radius: 50%;
            background: var(--primary);
            box-shadow: 0 0 12px rgba(232,168,56,0.6);
            opacity: 0;
            transition: opacity 0.3s;
        }
        .rh-progress-bar:hover .rh-progress-glow { opacity: 1; }
        .rh-progress-time {
            display: flex; justify-content: space-between;
            font-size: 11px; color: var(--text-tertiary);
            margin-top: 4px; font-weight: 500;
        }
        .rh-actions {
            display: flex; align-items: center; justify-content: center;
            gap: 20px; position: relative; z-index: 1;
            margin-bottom: 12px;
        }
        .rh-play-btn {
            width: 56px; height: 56px; border-radius: 50%;
            background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end));
            border: none; color: #fff; font-size: 22px;
            display: flex; align-items: center; justify-content: center;
            cursor: pointer; position: relative;
            box-shadow: 0 6px 24px rgba(232,168,56,0.35);
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .rh-play-btn:active { transform: scale(0.88); }
        .rh-play-btn.playing {
            box-shadow: 0 6px 28px rgba(232,168,56,0.4), 0 0 40px rgba(232,168,56,0.1);
        }
        .rh-play-ring {
            position: absolute; inset: -6px; border-radius: 50%;
            border: 1.5px solid rgba(232,168,56,0.15);
            animation: rhRingPulse 2s ease-in-out infinite;
        }
        .rh-play-btn.playing .rh-play-ring {
            border-color: rgba(74,222,128,0.3);
        }
        @keyframes rhRingPulse {
            0%, 100% { transform: scale(1); opacity: 0.5; }
            50% { transform: scale(1.1); opacity: 0; }
        }
        .rh-shuffle-btn, .rh-expand-btn {
            width: 40px; height: 40px; border-radius: 50%;
            background: var(--surface); border: 1px solid var(--border);
            color: var(--text-secondary); font-size: 14px;
            display: flex; align-items: center; justify-content: center;
            cursor: pointer; transition: all 0.2s ease;
        }
        .rh-shuffle-btn:active, .rh-expand-btn:active {
            background: var(--surface-elevated); transform: scale(0.88);
        }

        /* ========== TAB BAR ========== */
        .tab-bar {
          display: flex; gap: 2px;
          padding: 8px 12px; overflow-x: auto;
          -webkit-overflow-scrolling: touch; flex-shrink: 0;
          background: var(--bg); border-bottom: 1px solid var(--border);
        }
        .tab-bar::-webkit-scrollbar { display: none; }
        .tab-btn {
          display: flex; align-items: center; gap: 6px;
          padding: 8px 14px; border-radius: 10px;
          border: none; background: transparent;
          color: var(--text-tertiary); font-size: 12px; font-weight: 600;
          cursor: pointer; transition: all 0.2s ease;
          white-space: nowrap; flex-shrink: 0;
        }
        .tab-btn i { font-size: 14px; }
        .tab-btn:active { transform: scale(0.95); }
        .tab-btn.active {
          background: var(--surface-elevated); color: var(--primary);
          box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        }

        /* ========== SCROLLABLE CONTENT ========== */
        .content-scroll {
          flex: 1; overflow-y: auto; overflow-x: hidden;
          -webkit-overflow-scrolling: touch; padding-bottom: 100px;
        }
        .content-scroll::-webkit-scrollbar { display: none; }

        /* ========== OVERVIEW SECTION ========== */
        .overview-content { padding: 12px; display: flex; flex-direction: column; gap: 12px; }

        /* Status Cards Row */
        .overview-cards-row { display: flex; gap: 12px; }
        .status-card {
          flex: 1; background: var(--surface-card); border: 1px solid var(--border);
          border-radius: var(--radius-lg); padding: 16px;
          display: flex; flex-direction: column; gap: 12px;
        }
        .status-card-header {
          display: flex; align-items: center; justify-content: space-between;
        }
        .status-card-label { font-size: 12px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; }
        .status-badge {
          display: flex; align-items: center; gap: 5px;
          padding: 3px 10px; border-radius: 20px;
          font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;
        }
        .status-badge.live { background: rgba(34,197,94,0.12); color: var(--success); }
        .status-badge.offline { background: var(--surface-elevated); color: var(--text-tertiary); }
        .status-dot {
          width: 6px; height: 6px; border-radius: var(--radius-full);
          background: var(--success);
        }
        .status-dot.pulse { animation: livePulse 1.5s ease-in-out infinite; }

        .status-card-body { display: flex; flex-direction: column; gap: 10px; }
        .status-card-info { display: flex; flex-direction: column; }
        .status-card-stat { font-size: 28px; font-weight: 800; line-height: 1; letter-spacing: -0.5px; }
        .status-card-stat-label { font-size: 12px; color: var(--text-tertiary); font-weight: 500; margin-top: 2px; }

        .broadcast-ctrl-btn {
          width: 100%; padding: 10px; border-radius: var(--radius-sm);
          font-size: 13px; font-weight: 700; cursor: pointer; transition: all 0.2s ease;
          display: flex; align-items: center; justify-content: center; gap: 6px; border: none;
        }
        .broadcast-ctrl-btn:active { transform: scale(0.97); }
        .broadcast-ctrl-btn.stop {
          background: rgba(239,68,68,0.12); color: var(--error);
        }
        .broadcast-ctrl-btn.start {
          background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end));
          color: #fff; box-shadow: var(--shadow-soft);
        }

        /* Now Playing Card */
        .now-playing-card {
          background: linear-gradient(135deg, rgba(232,168,56,0.08) 0%, rgba(139,92,246,0.04) 100%);
          border: 1px solid rgba(232,168,56,0.1);
          border-radius: var(--radius-lg); padding: 16px;
          display: flex; align-items: center; gap: 14px;
        }
        .now-playing-cover {
          width: 72px; height: 72px; border-radius: var(--radius-md); overflow: hidden;
          position: relative; flex-shrink: 0; border: 1px solid var(--border);
        }
        .now-playing-cover img { width: 100%; height: 100%; object-fit: cover; }
        .now-playing-equalizer {
          position: absolute; bottom: 6px; left: 50%; transform: translateX(-50%);
          display: flex; gap: 2px; align-items: flex-end; height: 16px;
        }
        .now-playing-equalizer span {
          width: 3px; background: var(--primary); border-radius: 2px;
          animation: equalizer 0.8s ease-in-out infinite alternate;
        }
        .now-playing-equalizer span:nth-child(1) { height: 8px; animation-delay: 0s; }
        .now-playing-equalizer span:nth-child(2) { height: 14px; animation-delay: 0.2s; }
        .now-playing-equalizer span:nth-child(3) { height: 10px; animation-delay: 0.4s; }
        .now-playing-equalizer span:nth-child(4) { height: 6px; animation-delay: 0.6s; }

        @keyframes equalizer {
          0% { height: 4px; }
          100% { height: 16px; }
        }

        .now-playing-info { flex: 1; min-width: 0; }
        .now-playing-title { font-size: 15px; font-weight: 700; line-height: 1.3; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .now-playing-artist { font-size: 13px; color: var(--text-secondary); margin-bottom: 8px; }

        .now-playing-progress { display: flex; flex-direction: column; gap: 4px; }
        .progress-bar {
          width: 100%; height: 4px; background: var(--surface-card);
          border-radius: 2px; overflow: hidden;
        }
        .progress-fill {
          height: 100%; background: linear-gradient(90deg, var(--gradient-start), var(--gradient-end));
          border-radius: 2px; transition: width 0.3s ease;
        }
        .progress-time { display: flex; justify-content: space-between; font-size: 11px; color: var(--text-tertiary); }

        .mini-player-btn {
          width: 42px; height: 42px; border-radius: var(--radius-full);
          background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end));
          border: none; color: #fff; font-size: 16px; box-shadow: var(--shadow-soft);
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; transition: all 0.2s ease; flex-shrink: 0;
        }
        .mini-player-btn:active { transform: scale(0.9); }

        /* Section Block */
        .section-block { display: flex; flex-direction: column; }
        .section-block-header {
          display: flex; align-items: center; justify-content: space-between;
          margin-bottom: 12px;
        }
        .section-block-header h3 { font-size: 16px; font-weight: 700; }
        .section-block-count { font-size: 12px; color: var(--text-tertiary); font-weight: 500; }
        .section-block-count strong { color: var(--text-primary); }

        /* History List */
        .history-list {
          background: var(--surface-card); border: 1px solid var(--border);
          border-radius: var(--radius-lg); overflow: hidden;
        }
        .history-item {
          display: flex; align-items: center; gap: 12px;
          padding: 12px 14px; border-bottom: 1px solid var(--border);
          transition: background 0.2s ease;
        }
        .history-item:last-child { border-bottom: none; }
        .history-item:active { background: var(--surface-elevated); }
        .history-cover {
          width: 36px; height: 36px; border-radius: 6px; object-fit: cover; flex-shrink: 0;
        }
        .history-info { flex: 1; min-width: 0; }
        .history-title { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .history-artist { font-size: 12px; color: var(--text-secondary); }
        .history-time { font-size: 11px; color: var(--text-tertiary); flex-shrink: 0; }

        /* Quick Actions Row */
        .quick-actions-row {
          display: flex; gap: 10px;
        }
        .quick-action-btn {
          flex: 1; display: flex; flex-direction: column; align-items: center; gap: 8px;
          padding: 16px 8px; background: var(--surface-card); border: 1px solid var(--border);
          border-radius: var(--radius-md); cursor: pointer; transition: all 0.2s ease;
        }
        .quick-action-btn:active { background: var(--surface-elevated); transform: scale(0.96); }
        .quick-action-btn span { font-size: 11px; font-weight: 600; color: var(--text-secondary); text-align: center; }
        .qab-icon {
          width: 44px; height: 44px; border-radius: var(--radius-sm);
          display: flex; align-items: center; justify-content: center; font-size: 18px;
        }
        .qab-icon.gold { background: rgba(232,168,56,0.12); color: var(--primary); }
        .qab-icon.blue { background: rgba(59,130,246,0.12); color: var(--gradient-blue); }
        .qab-icon.purple { background: rgba(139,92,246,0.12); color: var(--gradient-purple); }

        /* Sparkline Chart */
        .sparkline-chart {
          display: flex; align-items: flex-end; gap: 4px;
          height: 120px; background: var(--surface-card);
          border: 1px solid var(--border); border-radius: var(--radius-lg);
          padding: 16px 12px 8px;
        }
        .sparkline-bar {
          flex: 1; display: flex; align-items: flex-end;
          height: 100%; cursor: pointer; position: relative;
        }
        .sparkline-fill {
          width: 100%; border-radius: 3px 3px 0 0;
          background: linear-gradient(to top, rgba(232,168,56,0.3), var(--primary));
          transition: height 0.3s ease; min-height: 2px;
        }
        .sparkline-labels {
          display: flex; justify-content: space-between;
          padding: 6px 12px 0;
        }
        .sparkline-labels span { font-size: 10px; color: var(--text-tertiary); font-weight: 500; }

        /* ========== PLAY CONTROL (integrated in Overview) ========== */
        .ov-pc-dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
        .ov-pc-dot.green { background: var(--success); }
        .ov-pc-dot.gray { background: var(--text-tertiary); }
        .ov-pc-mode-row { display: flex; gap: 6px; margin-bottom: 10px; }
        .ov-pc-mode-btn {
          flex: 1; padding: 8px 6px; border-radius: var(--radius-sm); border: none;
          background: var(--surface-elevated); color: var(--text-secondary);
          font-size: 11px; font-weight: 600; cursor: pointer;
          display: flex; align-items: center; justify-content: center; gap: 5px;
          transition: all 0.2s ease;
        }
        .ov-pc-mode-btn i { font-size: 12px; }
        .ov-pc-mode-btn.active { background: var(--primary); color: white; }
        .ov-pc-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
        .ov-pc-item {
          display: flex; align-items: center; justify-content: space-between;
          background: var(--surface-card); border: 1px solid var(--border);
          border-radius: var(--radius-sm); padding: 10px 12px;
        }
        .ov-pc-item-info { flex: 1; min-width: 0; }
        .ov-pc-item-name { font-size: 13px; font-weight: 600; }
        .ov-pc-item-sub { font-size: 11px; color: var(--text-tertiary); margin-top: 1px; }
        .ov-pc-play-btn {
          width: 32px; height: 32px; border-radius: 50%; border: none;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; transition: all 0.2s ease; flex-shrink: 0;
          background: var(--primary); color: white; font-size: 12px;
        }
        .ov-pc-play-btn.active { background: rgba(74,222,128,0.15); color: var(--success); }
        .ov-pc-play-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .ov-pc-active {
          display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600;
          color: var(--success); padding: 8px 0 4px;
        }
        .ov-pc-now-playing {
          display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600;
          color: var(--success); padding: 6px 0; margin-bottom: 2px;
        }
        .ov-pc-empty { font-size: 12px; color: var(--text-tertiary); padding: 12px 0; text-align: center; }
        .ov-pc-queue-header {
          display: flex; align-items: center; justify-content: space-between;
          font-size: 12px; font-weight: 700; color: var(--text-secondary);
          text-transform: uppercase; letter-spacing: 0.5px; margin-top: 4px;
        }
        .ov-pc-queue-count { font-size: 10px; color: var(--text-tertiary); font-weight: 600; text-transform: none; }
        .ov-pc-queue { background: var(--surface-card); border: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden; }
        .ov-pc-q-item { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--border); }
        .ov-pc-q-item:last-child { border-bottom: none; }
        .ov-pc-q-num {
          width: 18px; height: 18px; border-radius: 50%; background: var(--surface-elevated);
          display: flex; align-items: center; justify-content: center;
          font-size: 9px; font-weight: 700; color: var(--text-tertiary); flex-shrink: 0;
        }
        .ov-pc-q-info { flex: 1; min-width: 0; }
        .ov-pc-q-title { font-size: 12px; font-weight: 600; }
        .ov-pc-q-artist { font-size: 10px; color: var(--text-tertiary); }

        /* ========== MEDIA LIBRARY SECTION ========== */
        .media-content { padding: 12px; display: flex; flex-direction: column; gap: 12px; }

        .upload-zone {
          display: flex; flex-direction: column; align-items: center; gap: 10px;
          padding: 28px 20px; background: var(--surface-card);
          border: 2px dashed var(--border); border-radius: var(--radius-lg);
          cursor: pointer; transition: all 0.25s ease; text-align: center;
        }
        .upload-zone:active { background: var(--surface-elevated); border-color: var(--primary); }
        .upload-zone.dragging {
          background: rgba(232,168,56,0.06); border-color: var(--primary);
          transform: scale(1.01);
        }
        .upload-zone i { font-size: 36px; color: var(--text-tertiary); transition: all 0.25s ease; }
        .upload-zone.dragging i { color: var(--primary); transform: translateY(-4px); }
        .upload-zone-text h4 { font-size: 15px; font-weight: 600; margin-bottom: 2px; }
        .upload-zone-text p { font-size: 13px; color: var(--text-tertiary); }

        /* Upload Progress */
        .upload-progress-list { display: flex; flex-direction: column; gap: 10px; }
        .upload-progress-item {
          background: var(--surface-card); border: 1px solid var(--border);
          border-radius: var(--radius-md); padding: 12px 14px;
          animation: fadeSlideUp 0.25s ease;
        }
        .upload-progress-info {
          display: flex; align-items: center; justify-content: space-between;
          margin-bottom: 8px;
        }
        .upload-progress-name {
          font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 6px;
        }
        .upload-progress-name i { color: var(--primary); font-size: 14px; }
        .upload-progress-pct { font-size: 12px; font-weight: 700; color: var(--primary); font-variant-numeric: tabular-nums; }
        .upload-progress-bar {
          width: 100%; height: 4px; background: var(--surface-elevated);
          border-radius: 2px; overflow: hidden;
        }
        .upload-progress-fill {
          height: 100%; background: linear-gradient(90deg, var(--gradient-start), var(--gradient-end));
          border-radius: 2px; transition: width 0.3s ease;
        }

        /* Media Toolbar */
        .media-toolbar { display: flex; flex-direction: column; gap: 10px; }
        .media-search-wrapper {
          position: relative; display: flex; align-items: center;
        }
        .media-search-wrapper > i {
          position: absolute; left: 14px; top: 50%; transform: translateY(-50%);
          color: var(--text-tertiary); font-size: 15px; pointer-events: none;
        }
        .media-search-input {
          width: 100%; padding: 12px 40px 12px 42px;
          background: var(--surface-card); border: 1.5px solid var(--border);
          border-radius: var(--radius-md); color: var(--text-primary);
          font-size: 14px; font-weight: 500; outline: none;
        }
        .media-search-input:focus { border-color: var(--primary); box-shadow: 0 0 0 4px rgba(232,168,56,0.08); }
        .media-search-input::placeholder { color: var(--text-tertiary); font-weight: 400; }
        .media-search-clear {
          position: absolute; right: 10px; top: 50%; transform: translateY(-50%);
          width: 28px; height: 28px; border-radius: var(--radius-full);
          background: var(--surface-elevated); border: none;
          color: var(--text-secondary); font-size: 12px;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer;
        }
        .media-search-clear:active { background: var(--surface-hover); }

        .media-filter-select {
          width: 100%; padding: 12px 16px;
          background: var(--surface-card); border: 1.5px solid var(--border);
          border-radius: var(--radius-md); color: var(--text-primary);
          font-size: 13px; font-weight: 500; outline: none;
          appearance: none; -webkit-appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='%236B6B6B' viewBox='0 0 16 16'%3E%3Cpath d='M7.247 11.14 2.451 5.658C1.885 5.013 2.345 4 3.204 4h9.592a1 1 0 0 1 .753 1.659l-4.796 5.48a1 1 0 0 1-1.506 0z'/%3E%3C/svg%3E");
          background-repeat: no-repeat; background-position: right 14px center; padding-right: 40px;
        }
        .media-filter-select:focus { border-color: var(--primary); box-shadow: 0 0 0 4px rgba(232,168,56,0.08); }

        /* Bulk Actions */
        .media-bulk-bar {
          display: flex; align-items: center; gap: 10px;
          padding: 10px 14px; background: rgba(232,168,56,0.08);
          border: 1px solid rgba(232,168,56,0.15);
          border-radius: var(--radius-md);
          animation: fadeSlideUp 0.2s ease;
        }
        .media-bulk-count { font-size: 13px; font-weight: 700; color: var(--primary); flex-shrink: 0; }
        .media-bulk-actions { display: flex; gap: 8px; flex: 1; justify-content: flex-end; }
        .media-bulk-btn {
          padding: 8px 12px; border-radius: var(--radius-sm);
          font-size: 12px; font-weight: 600; cursor: pointer;
          border: none; display: flex; align-items: center; gap: 5px;
          background: var(--surface-elevated); color: var(--text-primary);
          transition: all 0.2s ease;
        }
        .media-bulk-btn:active { transform: scale(0.95); }
        .media-bulk-btn.danger { background: rgba(239,68,68,0.12); color: var(--error); }
        .media-bulk-clear {
          width: 28px; height: 28px; border-radius: var(--radius-full);
          background: none; border: none; color: var(--text-tertiary);
          cursor: pointer; font-size: 14px; display: flex; align-items: center; justify-content: center;
        }
        .media-bulk-clear:active { background: var(--surface-elevated); }

        /* File Count */
        .media-count { font-size: 12px; color: var(--text-tertiary); font-weight: 500; text-align: right; }

        /* File List */
        .media-file-list {
          background: var(--surface-card); border: 1px solid var(--border);
          border-radius: var(--radius-lg); overflow: hidden;
        }
        .media-empty {
          display: flex; flex-direction: column; align-items: center; gap: 8px;
          padding: 40px 20px; text-align: center;
        }
        .media-empty i { font-size: 32px; color: var(--text-tertiary); }
        .media-empty p { font-size: 14px; color: var(--text-secondary); }

        .media-file-item {
          display: flex; align-items: flex-start; gap: 12px;
          padding: 14px; border-bottom: 1px solid var(--border);
          transition: background 0.2s ease; position: relative;
        }
        .media-file-item:last-child { border-bottom: none; }
        .media-file-item.selected { background: rgba(232,168,56,0.04); }

        .media-checkbox {
          width: 22px; height: 22px; border-radius: 6px;
          border: 2px solid var(--border); flex-shrink: 0;
          margin-top: 6px; cursor: pointer; transition: all 0.2s ease;
          display: flex; align-items: center; justify-content: center;
        }
        .media-checkbox.checked {
          background: var(--primary); border-color: var(--primary);
        }
        .media-checkbox i { font-size: 11px; color: #fff; }

        .media-file-cover {
          width: 44px; height: 44px; border-radius: 8px; overflow: hidden;
          flex-shrink: 0; border: 1px solid var(--border);
        }
        .media-file-cover img { width: 100%; height: 100%; object-fit: cover; }

        .media-file-info { flex: 1; min-width: 0; }
        .media-file-title { font-size: 14px; font-weight: 600; line-height: 1.3; margin-bottom: 2px; }
        .media-file-artist { font-size: 12px; color: var(--text-secondary); margin-bottom: 4px; }
        .media-file-tags {
          display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 4px;
        }
        .media-file-tag {
          padding: 2px 8px; border-radius: 4px;
          font-size: 10px; font-weight: 600; color: var(--text-tertiary);
          background: var(--surface-elevated);
        }
        .media-file-playlists {
          display: flex; gap: 4px; flex-wrap: wrap;
        }
        .media-playlist-chip {
          padding: 2px 8px; border-radius: 4px;
          font-size: 10px; font-weight: 600;
          background: rgba(232,168,56,0.1); color: var(--primary);
        }

        /* File Menu */
        .media-file-actions-relative { position: relative; }
        .media-file-menu {
          width: 32px; height: 32px; border-radius: var(--radius-full);
          background: none; border: none; color: var(--text-tertiary);
          font-size: 16px; cursor: pointer; display: flex;
          align-items: center; justify-content: center; flex-shrink: 0;
        }
        .media-file-menu:active { background: var(--surface-elevated); color: var(--text-primary); }

        /* Action Sheet */
        .media-actions-overlay {
          position: fixed; inset: 0; z-index: 9999;
        }
        .media-actions-sheet {
          z-index: 10000;
          width: 240px; background: var(--surface-elevated);
          border: 1px solid var(--border); border-radius: var(--radius-md);
          padding: 8px; box-shadow: var(--shadow-elevated);
          animation: fadeSlideUp 0.15s ease;
        }
        .media-action-btn {
          display: flex; align-items: center; gap: 10px;
          padding: 10px 8px; border-radius: 8px;
          background: none; border: none; color: var(--text-primary);
          width: 100%; text-align: left; cursor: pointer;
          transition: background 0.2s ease;
        }
        .media-action-btn:active { background: var(--surface-hover); }
        .media-action-icon {
          width: 34px; height: 34px; border-radius: 8px;
          display: flex; align-items: center; justify-content: center;
          font-size: 15px; flex-shrink: 0;
        }
        .media-action-icon.blue { background: rgba(59,130,246,0.12); color: var(--gradient-blue); }
        .media-action-icon.gold { background: rgba(232,168,56,0.12); color: var(--primary); }
        .media-action-icon.red { background: rgba(239,68,68,0.12); color: var(--error); }
        .media-action-info { flex: 1; }
        .media-action-info h4 { font-size: 14px; font-weight: 600; }
        .media-action-info p { font-size: 11px; color: var(--text-secondary); margin-top: 1px; }

        /* Inline Edit Fields */
        .media-edit-fields { display: flex; flex-direction: column; gap: 6px; }
        .media-edit-input {
          padding: 8px 10px; border-radius: 6px;
          background: var(--surface-elevated); border: 1.5px solid var(--border);
          color: var(--text-primary); font-size: 13px; font-weight: 500;
          outline: none; width: 100%;
        }
        .media-edit-input:focus { border-color: var(--primary); }
        .media-edit-input::placeholder { color: var(--text-tertiary); }
        .media-edit-actions {
          display: flex; gap: 6px; margin-top: 2px;
        }
        .media-edit-save, .media-edit-cancel {
          padding: 6px 12px; border-radius: 6px;
          font-size: 12px; font-weight: 600; cursor: pointer;
          border: none; transition: all 0.2s ease;
        }
        .media-edit-save {
          background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end));
          color: #fff;
        }
        .media-edit-save:active { transform: scale(0.95); }
        .media-edit-cancel {
          background: var(--surface-elevated); color: var(--text-secondary);
        }
        .media-edit-cancel:active { transform: scale(0.95); }

        /* Playlist Picker Modal */
        .media-modal-overlay {
          position: fixed; inset: 0; background: var(--overlay);
          z-index: 9000; animation: fadeSlideUp 0.2s ease;
        }
        .media-modal-sheet {
          position: fixed; bottom: 0; left: 0; right: 0; z-index: 9001;
          max-width: 480px; margin: 0 auto;
          background: var(--surface);
          border-radius: 28px 28px 0 0;
          animation: slideUp 0.35s cubic-bezier(0.32, 0.72, 0, 1);
          max-height: 80vh; display: flex; flex-direction: column;
        }
        @keyframes slideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
        .media-modal-handle {
          width: 40px; height: 5px; background: var(--text-tertiary);
          border-radius: 3px; margin: 12px auto 8px; opacity: 0.5;
        }
        .media-modal-header {
          padding: 8px 24px 16px; text-align: center;
        }
        .media-modal-header h2 { font-size: 20px; font-weight: 700; }
        .media-modal-header p { font-size: 13px; color: var(--text-secondary); margin-top: 4px; }
        .media-modal-body {
          flex: 1; overflow-y: auto; padding: 0 24px 20px;
          -webkit-overflow-scrolling: touch;
        }
        .media-modal-body::-webkit-scrollbar { display: none; }

        .media-pl-item {
          display: flex; align-items: center; gap: 14px;
          padding: 14px 0; border-bottom: 1px solid var(--border);
          cursor: pointer; transition: opacity 0.2s ease;
        }
        .media-pl-item:last-child { border-bottom: none; }
        .media-pl-item:active { opacity: 0.6; }
        .media-pl-icon {
          width: 40px; height: 40px; border-radius: var(--radius-sm);
          background: rgba(232,168,56,0.1); color: var(--primary);
          display: flex; align-items: center; justify-content: center;
          font-size: 18px; flex-shrink: 0;
        }
        .media-pl-info { flex: 1; }
        .media-pl-name { font-size: 15px; font-weight: 600; }
        .media-pl-arrow { font-size: 14px; color: var(--text-tertiary); }

        /* ========== PLACEHOLDER SECTION ========== */
        .placeholder-section {
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          padding: 60px 40px; text-align: center; gap: 12px;
        }
        .placeholder-icon {
          width: 64px; height: 64px; border-radius: var(--radius-full);
          background: var(--surface-elevated); display: flex; align-items: center; justify-content: center;
          font-size: 24px; color: var(--text-tertiary);
        }
        .placeholder-section h2 { font-size: 20px; font-weight: 700; }
        .placeholder-section p { font-size: 14px; color: var(--text-secondary); line-height: 1.6; max-width: 280px; }

        /* ========== BOTTOM NAV ========== */
        .bottom-nav {
          position: fixed; bottom: 0; left: 0; right: 0;
          background: rgba(15,15,15,0.92);
          backdrop-filter: blur(20px) saturate(180%);
          -webkit-backdrop-filter: blur(20px) saturate(180%);
          border-top: 1px solid var(--border);
          padding: 8px 0 calc(8px + env(safe-area-inset-bottom, 0px));
          z-index: 1000; display: flex; justify-content: space-around; align-items: center;
        }
        @media (min-width: 480px) {
          .bottom-nav { max-width: 480px; margin: 0 auto; }
        }
        .nav-item {
          display: flex; flex-direction: column; align-items: center; gap: 4px;
          padding: 6px 12px; background: none; border: none;
          color: var(--text-tertiary); cursor: pointer; transition: all 0.2s ease; position: relative;
        }
        .nav-item.active { color: var(--primary); }
        .nav-item i { font-size: 20px; transition: transform 0.2s ease; }
        .nav-item:active i { transform: scale(0.85); }
        .nav-item span { font-size: 10px; font-weight: 600; }
        .nav-item .nav-badge {
          position: absolute; top: 2px; right: 6px; width: 8px; height: 8px;
          background: var(--error); border-radius: var(--radius-full); border: 2px solid var(--bg);
        }
        /* ========== PLAYLISTS SECTION ========== */
        .pl-content { padding: 12px; display: flex; flex-direction: column; gap: 12px; }
        .pl-toolbar { display: flex; gap: 10px; align-items: center; }
        .pl-search-wrapper { position: relative; flex: 1; }
        .pl-search-wrapper > i { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--text-tertiary); font-size: 14px; pointer-events: none; }
        .pl-search-input { width: 100%; padding: 10px 12px 10px 36px; background: var(--surface-card); border: 1.5px solid var(--border); border-radius: var(--radius-md); color: var(--text-primary); font-size: 13px; font-weight: 500; outline: none; }
        .pl-search-input:focus { border-color: var(--primary); }
        .pl-picker-toolbar { position: relative; margin: 0 20px 8px; }
        .pl-picker-toolbar > i { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--text-tertiary); font-size: 14px; pointer-events: none; }
        .pl-picker-search { width: 100%; padding: 10px 12px 10px 36px; background: var(--surface-elevated); border: 1.5px solid var(--border); border-radius: var(--radius-md); color: var(--text-primary); font-size: 13px; outline: none; box-sizing: border-box; }
        .pl-picker-search:focus { border-color: var(--primary); }
        .pl-create-btn { display: flex; align-items: center; gap: 6px; padding: 10px 16px; background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end)); border: none; border-radius: var(--radius-md); color: #fff; font-size: 13px; font-weight: 700; cursor: pointer; transition: all 0.2s ease; white-space: nowrap; box-shadow: var(--shadow-soft); }
        .pl-create-btn:active { transform: scale(0.95); }
        .pl-refresh-btn { display: flex; align-items: center; justify-content: center; width: 40px; height: 40px; background: var(--surface-card); border: 1.5px solid var(--border); border-radius: var(--radius-md); color: var(--text-secondary); font-size: 15px; cursor: pointer; transition: all 0.2s ease; flex-shrink: 0; }
        .pl-refresh-btn:hover { border-color: var(--primary); color: var(--primary); }
        .pl-refresh-btn:active { transform: scale(0.92); }
        .pl-count { font-size: 12px; color: var(--text-tertiary); font-weight: 500; text-align: right; }
        .pl-create-form, .dj-form, .wh-form { background: var(--surface-card); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 18px; display: flex; flex-direction: column; gap: 14px; animation: fadeSlideUp 0.25s ease; }
        .pl-create-form h4, .dj-form h4, .wh-form h4 { font-size: 16px; font-weight: 700; }
        .pl-form-row { display: flex; flex-direction: column; gap: 6px; }
        .pl-form-row label { font-size: 12px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; }
        .pl-form-input { padding: 11px 14px; background: var(--surface-elevated); border: 1.5px solid var(--border); border-radius: var(--radius-sm); color: var(--text-primary); font-size: 14px; font-weight: 500; outline: none; color-scheme: dark; }
        .pl-form-input:focus { border-color: var(--primary); }
        .pl-form-input[type="time"]::-webkit-calendar-picker-indicator { filter: invert(0.7); cursor: pointer; }
        .pl-form-input[type="time"]::-webkit-datetime-edit { color: var(--text-primary); }
        .pl-form-select { padding: 11px 14px; background: var(--surface-elevated); border: 1.5px solid var(--border); border-radius: var(--radius-sm); color: var(--text-primary); font-size: 14px; font-weight: 500; outline: none; appearance: none; -webkit-appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' fill='%236B6B6B' viewBox='0 0 16 16'%3E%3Cpath d='M7.247 11.14 2.451 5.658C1.885 5.013 2.345 4 3.204 4h9.592a1 1 0 0 1 .753 1.659l-4.796 5.48a1 1 0 0 1-1.506 0z'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 12px center; padding-right: 36px; }
        .pl-form-select:focus { border-color: var(--primary); }
        .pl-form-range { width: 100%; height: 6px; -webkit-appearance: none; appearance: none; background: var(--surface-elevated); border-radius: 3px; outline: none; }
        .pl-form-range::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 20px; height: 20px; border-radius: 50%; background: var(--primary); cursor: pointer; box-shadow: var(--shadow-soft); }
        .pl-form-actions { display: flex; gap: 8px; margin-top: 4px; }
        .pl-form-save { padding: 10px 20px; background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end)); border: none; border-radius: var(--radius-sm); color: #fff; font-size: 13px; font-weight: 700; cursor: pointer; transition: all 0.2s ease; }
        .pl-form-save:active { transform: scale(0.95); }
        .pl-form-cancel { padding: 10px 20px; background: var(--surface-elevated); border: none; border-radius: var(--radius-sm); color: var(--text-secondary); font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.2s ease; }
        .pl-form-cancel:active { transform: scale(0.95); }
        .pl-schedule-config { background: var(--surface-elevated); border-radius: var(--radius-md); padding: 14px; display: flex; flex-direction: column; gap: 12px; }
        .pl-day-chips { display: flex; gap: 6px; flex-wrap: wrap; }
        .pl-day-chip { padding: 6px 12px; border-radius: 8px; font-size: 12px; font-weight: 600; border: 1.5px solid var(--border); background: transparent; color: var(--text-secondary); cursor: pointer; transition: all 0.2s ease; }
        .pl-day-chip:active { transform: scale(0.95); }
        .pl-day-chip.active { background: var(--primary); border-color: var(--primary); color: #fff; }
        .pl-time-row { display: flex; gap: 12px; }
        .pl-time-row > div { flex: 1; display: flex; flex-direction: column; gap: 6px; }
        .pl-time-row label { font-size: 11px; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.5px; }
        .pl-list { display: flex; flex-direction: column; gap: 8px; }
        .pl-card { background: var(--surface-card); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; transition: all 0.2s ease; }
        .pl-card.expanded { border-color: rgba(232,168,56,0.2); }
        .pl-card-header { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; cursor: pointer; transition: background 0.2s ease; }
        .pl-card-header:active { background: var(--surface-hover); }
        .pl-card-left { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; }
        .pl-type-badge { padding: 3px 10px; border-radius: 6px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; flex-shrink: 0; }
        .pl-type-badge.standard { background: rgba(59,130,246,0.12); color: #3B82F6; }
        .pl-type-badge.scheduled { background: rgba(232,168,56,0.12); color: var(--primary); }
        .pl-type-badge.ondemand { background: rgba(139,92,246,0.12); color: #8B5CF6; }
        .pl-card-info { min-width: 0; }
        .pl-card-name { font-size: 15px; font-weight: 600; }
        .pl-card-meta { font-size: 12px; color: var(--text-tertiary); margin-top: 2px; }
        .pl-card-right { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
        .pl-card-delete { width: 30px; height: 30px; border-radius: 50%; background: none; border: none; color: var(--text-tertiary); font-size: 14px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
        .pl-card-delete:active { background: rgba(239,68,68,0.1); color: var(--error); }
        .pl-chevron { font-size: 14px; color: var(--text-tertiary); transition: transform 0.25s ease; }
        .pl-chevron.open { transform: rotate(180deg); color: var(--primary); }
        .pl-toggle { position: relative; display: inline-block; width: 42px; height: 24px; cursor: pointer; }
        .pl-toggle input { display: none; }
        .pl-toggle-slider { position: absolute; inset: 0; background: var(--surface-elevated); border-radius: 12px; transition: all 0.25s ease; }
        .pl-toggle-slider::before { content: ''; position: absolute; left: 3px; top: 3px; width: 18px; height: 18px; background: var(--text-tertiary); border-radius: 50%; transition: all 0.25s ease; }
        .pl-toggle input:checked + .pl-toggle-slider { background: var(--primary); }
        .pl-toggle input:checked + .pl-toggle-slider::before { background: #fff; transform: translateX(18px); }
        .pl-song-list { border-top: 1px solid var(--border); padding: 10px 16px 14px; display: flex; flex-direction: column; gap: 6px; }
        .pl-empty-songs { text-align: center; padding: 20px; color: var(--text-tertiary); font-size: 13px; }
        .pl-song-item { display: flex; align-items: center; gap: 10px; padding: 6px 0; }
        .pl-song-idx { width: 20px; text-align: center; font-size: 12px; color: var(--text-tertiary); font-weight: 600; }
        .pl-song-cover { width: 32px; height: 32px; border-radius: 6px; object-fit: cover; flex-shrink: 0; border: 1px solid var(--border); }
        .pl-song-info { flex: 1; min-width: 0; }
        .pl-song-title { font-size: 13px; font-weight: 600; }
        .pl-song-artist { font-size: 11px; color: var(--text-secondary); }
        .pl-song-remove { width: 28px; height: 28px; border-radius: 50%; background: none; border: none; color: var(--text-tertiary); cursor: pointer; font-size: 14px; display: flex; align-items: center; justify-content: center; }
        .pl-song-remove:active { background: rgba(239,68,68,0.1); color: var(--error); }
        .pl-add-songs-btn { display: flex; align-items: center; justify-content: center; gap: 6px; padding: 10px; border: 1.5px dashed var(--border); border-radius: var(--radius-sm); background: transparent; color: var(--primary); font-size: 13px; font-weight: 600; cursor: pointer; margin-top: 4px; transition: all 0.2s ease; }
        .pl-add-songs-btn:active { background: rgba(232,168,56,0.05); border-color: var(--primary); }
        .pl-schedule-info { display: flex; align-items: center; gap: 8px; padding: 8px 10px; background: rgba(232,168,56,0.06); border-radius: var(--radius-sm); margin-top: 6px; font-size: 12px; color: var(--primary); }
        .pl-schedule-info i { font-size: 14px; }
        .pl-schedule-time { margin-left: auto; font-weight: 600; }
        .pl-picker-item { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--border); cursor: pointer; transition: opacity 0.2s ease; }
        .pl-picker-item:last-child { border-bottom: none; }
        .pl-picker-item.disabled { opacity: 0.4; cursor: default; }
        .pl-picker-item:not(.disabled):active { opacity: 0.6; }
        .pl-picker-cover { width: 36px; height: 36px; border-radius: 6px; object-fit: cover; border: 1px solid var(--border); }
        .pl-picker-info { flex: 1; min-width: 0; }
        .pl-picker-title { font-size: 14px; font-weight: 600; }
        .pl-picker-artist { font-size: 12px; color: var(--text-secondary); }
        .pl-picker-add { color: var(--primary); font-size: 20px; }
        .pl-picker-checked { color: var(--success); font-size: 18px; }

        /* ========== NEW PLAYLISTS SECTION ========== */
        .pl-content-new { padding: 12px; display: flex; flex-direction: column; gap: 12px; }
        .pl-new-header { display: flex; align-items: center; justify-content: space-between; }
        .pl-new-heading { font-size: 22px; font-weight: 800; }
        .pl-filter-tabs { display: flex; gap: 6px; align-items: center; overflow-x: auto; -webkit-overflow-scrolling: touch; }
        .pl-filter-tabs::-webkit-scrollbar { display: none; }
        .pl-filter-tab { display: flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 8px; font-size: 13px; font-weight: 600; border: none; background: transparent; color: var(--text-secondary); cursor: pointer; white-space: nowrap; transition: all 0.2s ease; }
        .pl-filter-tab:active { transform: scale(0.95); }
        .pl-filter-tab.active { background: var(--surface-card); border: 1px solid var(--border); color: var(--text-primary); }
        .pl-filter-count { padding: 1px 7px; border-radius: 8px; font-size: 11px; font-weight: 700; background: var(--surface-elevated); color: var(--text-tertiary); }
        .pl-two-panel { display: flex; gap: 14px; min-height: 400px; }
        .pl-left-panel { flex: 1; min-width: 0; }
        .pl-left-compact { max-width: 400px; }
        .pl-right-panel { flex: 1; min-width: 0; background: var(--surface-card); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 18px; display: flex; flex-direction: column; gap: 18px; align-self: flex-start; }
        .pl-card-list { display: flex; flex-direction: column; gap: 6px; }
        .pl-card-new { display: flex; align-items: flex-start; gap: 10px; padding: 12px 14px; background: var(--surface-card); border: 1px solid var(--border); border-radius: var(--radius-lg); cursor: pointer; transition: all 0.2s ease; position: relative; }
        .pl-card-new:active { transform: scale(0.98); }
        .pl-card-new.selected { border-color: var(--primary); border-left: 3px solid var(--primary); padding-left: 12px; }
        .pl-card-new.now-playing { border-left: 3px solid var(--success); padding-left: 12px; }
        .pl-card-new.default { background: rgba(232,168,56,0.03); }
        .pl-card-status-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; margin-top: 5px; }
        .pl-card-status-dot.active { background: var(--success); box-shadow: 0 0 6px var(--success); animation: livePulse 1.5s ease-in-out infinite; }
        .pl-card-status-dot.scheduled { background: var(--primary); }
        .pl-card-status-dot.general { background: var(--text-tertiary); }
        .pl-card-status-dot.disabled { background: var(--error); opacity: 0.5; }
        .pl-card-new-body { flex: 1; min-width: 0; }
        .pl-card-new-top { display: flex; align-items: center; gap: 8px; }
        .pl-card-new-name { font-size: 15px; font-weight: 600; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .pl-card-new-meta { font-size: 12px; color: var(--text-tertiary); margin-top: 3px; }
        .pl-card-new-tag { display: inline-flex; align-items: center; gap: 4px; margin-top: 6px; padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; background: rgba(232,168,56,0.08); color: var(--primary); }
        .pl-card-new-actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
        .pl-card-edit-btn { width: 30px; height: 30px; border-radius: 50%; background: none; border: none; color: var(--text-tertiary); font-size: 13px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
        .pl-card-edit-btn:active { background: var(--surface-elevated); color: var(--text-primary); }
        .pl-card-menu-wrapper { position: relative; }
        .pl-card-menu-btn { width: 30px; height: 30px; border-radius: 50%; background: none; border: none; color: var(--text-tertiary); font-size: 16px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
        .pl-card-menu-btn:active { background: var(--surface-elevated); }
        .pl-menu-overlay { position: fixed; inset: 0; z-index: 100; }
        .pl-menu-dropdown { position: absolute; top: 100%; right: 0; margin-top: 4px; background: var(--surface-card); border: 1px solid var(--border); border-radius: var(--radius-md); box-shadow: var(--shadow-lg); z-index: 101; min-width: 140px; overflow: hidden; }
        .pl-menu-item { display: flex; align-items: center; gap: 8px; width: 100%; padding: 10px 14px; font-size: 13px; font-weight: 500; border: none; background: none; color: var(--text-primary); cursor: pointer; text-align: left; }
        .pl-menu-item:active { background: var(--surface-hover); }
        .pl-menu-item.danger { color: var(--error); }
        .pl-card-now-playing-badge { position: absolute; top: -1px; right: -1px; padding: 2px 8px; font-size: 10px; font-weight: 700; background: var(--success); color: #fff; border-radius: 0 var(--radius-lg) 0 6px; }
        .pl-detail-header { display: flex; align-items: center; gap: 10px; }
        .pl-detail-back { width: 32px; height: 32px; border-radius: 50%; border: none; background: var(--surface-elevated); color: var(--text-secondary); font-size: 14px; cursor: pointer; display: none; align-items: center; justify-content: center; }
        .pl-detail-back:active { transform: scale(0.92); }
        .pl-detail-header-info { flex: 1; display: flex; align-items: center; gap: 8px; }
        .pl-detail-name { font-size: 20px; font-weight: 700; }
        .pl-detail-header-actions { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
        .pl-detail-edit-btn { display: flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: var(--radius-sm); font-size: 12px; font-weight: 600; border: 1px solid var(--border); background: transparent; color: var(--text-secondary); cursor: pointer; }
        .pl-detail-edit-btn:active { background: var(--surface-elevated); }
        .pl-detail-schedule { background: rgba(232,168,56,0.04); border: 1px solid rgba(232,168,56,0.1); border-radius: var(--radius-md); padding: 14px; display: flex; flex-direction: column; gap: 10px; }
        .pl-detail-section-title { font-size: 13px; font-weight: 600; color: var(--text-secondary); display: flex; align-items: center; gap: 6px; }
        .pl-detail-schedule-body { display: flex; flex-direction: column; gap: 8px; }
        .pl-detail-days { display: flex; gap: 4px; flex-wrap: wrap; }
        .pl-detail-day-pill { padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 600; background: var(--surface-elevated); color: var(--text-tertiary); }
        .pl-detail-day-pill.active { background: var(--primary); color: #fff; }
        .pl-detail-time { font-size: 14px; font-weight: 700; color: var(--text-primary); }
        .pl-detail-next-run { font-size: 12px; color: var(--text-tertiary); display: flex; align-items: center; gap: 6px; }
        .pl-detail-songs { display: flex; flex-direction: column; gap: 10px; }
        .pl-detail-songs-header { display: flex; align-items: center; justify-content: space-between; }
        .pl-detail-add-songs-btn { display: flex; align-items: center; gap: 4px; padding: 8px 14px; border-radius: var(--radius-sm); font-size: 12px; font-weight: 600; border: 1.5px dashed var(--border); background: transparent; color: var(--primary); cursor: pointer; }
        .pl-detail-add-songs-btn:active { border-color: var(--primary); background: rgba(232,168,56,0.03); }
        .pl-detail-empty-songs { text-align: center; padding: 30px 0; color: var(--text-tertiary); }
        .pl-detail-empty-songs i { font-size: 32px; opacity: 0.4; margin-bottom: 8px; display: block; }
        .pl-detail-empty-songs p { font-size: 15px; font-weight: 600; margin: 0 0 4px; }
        .pl-detail-empty-songs span { font-size: 13px; }
        .pl-detail-song-list { display: flex; flex-direction: column; gap: 4px; }
        .pl-detail-song-item { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: var(--radius-sm); transition: background 0.15s ease; }
        .pl-detail-song-item:active { background: var(--surface-hover); }
        .pl-detail-song-drag { color: var(--text-tertiary); font-size: 14px; cursor: grab; flex-shrink: 0; }
        .pl-detail-song-cover { width: 36px; height: 36px; border-radius: 6px; object-fit: cover; flex-shrink: 0; border: 1px solid var(--border); }
        .pl-detail-song-info { flex: 1; min-width: 0; }
        .pl-detail-song-title { font-size: 14px; font-weight: 600; }
        .pl-detail-song-artist { font-size: 12px; color: var(--text-secondary); }
        .pl-detail-song-duration { font-size: 12px; color: var(--text-tertiary); font-weight: 500; flex-shrink: 0; }
        .pl-detail-song-remove { width: 26px; height: 26px; border-radius: 50%; border: none; background: none; color: var(--text-tertiary); font-size: 14px; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; opacity: 0; transition: all 0.2s ease; }
        .pl-detail-song-item:hover .pl-detail-song-remove { opacity: 1; }
        .pl-detail-song-remove:active { background: rgba(239,68,68,0.1); color: var(--error); }
        .pl-detail-total-duration { font-size: 12px; font-weight: 600; color: var(--text-tertiary); padding: 8px 8px 0; border-top: 1px solid var(--border); margin-top: 4px; }
        .pl-sched-view-toggle { display: flex; align-items: center; gap: 8px; }
        .pl-sched-toggle-btn { display: flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 8px; font-size: 13px; font-weight: 600; border: 1.5px solid var(--border); background: var(--surface-card); color: var(--text-secondary); cursor: pointer; transition: all 0.2s ease; }
        .pl-sched-toggle-btn:active { transform: scale(0.95); }
        .pl-sched-toggle-btn.active { border-color: var(--primary); color: var(--primary); }
        .pl-schedule-view { display: flex; flex-direction: column; gap: 10px; }
        .pl-sv-header { display: flex; align-items: center; justify-content: space-between; }
        .pl-sv-title { font-size: 16px; font-weight: 700; }
        .pl-sv-grid-wrapper { overflow-x: auto; -webkit-overflow-scrolling: touch; }
        .pl-sv-grid-wrapper::-webkit-scrollbar { display: none; }
        .pl-sv-grid { display: grid; grid-template-columns: 50px repeat(7, 1fr); gap: 1px; background: var(--border); border: 1px solid var(--border); border-radius: var(--radius-md); overflow: hidden; min-width: 600px; }
        .pl-sv-corner { background: var(--surface-card); }
        .pl-sv-day-header { background: var(--surface-card); padding: 8px 4px; text-align: center; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-secondary); }
        .pl-sv-day-header.today { background: rgba(232,168,56,0.1); color: var(--primary); }
        .pl-sv-time { background: var(--surface-card); padding: 2px 6px; font-size: 9px; color: var(--text-tertiary); font-weight: 500; text-align: right; display: flex; align-items: flex-start; justify-content: flex-end; }
        .pl-sv-cell { background: var(--surface-elevated); min-height: 24px; padding: 1px; position: relative; cursor: default; }
        .pl-sv-cell.today { background: rgba(232,168,56,0.03); }
        .pl-sv-cell.has-block { padding: 1px; }
        .pl-sv-block { border-radius: 3px; padding: 1px 4px; font-size: 8px; font-weight: 700; color: #fff; margin-bottom: 1px; cursor: pointer; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; line-height: 1.4; }
        .pl-sv-block:active { opacity: 0.8; }
        .pl-empty-state { text-align: center; padding: 50px 20px; color: var(--text-tertiary); }
        .pl-empty-state i { font-size: 40px; opacity: 0.3; margin-bottom: 12px; display: block; }
        .pl-empty-state h4 { font-size: 16px; font-weight: 700; margin: 0 0 6px; color: var(--text-primary); }
        .pl-empty-state p { font-size: 13px; margin: 0 0 16px; }
        .pl-type-options { display: flex; flex-direction: column; gap: 6px; }
        .pl-type-option { display: flex; flex-direction: column; gap: 2px; padding: 12px 14px; border: 1.5px solid var(--border); border-radius: var(--radius-md); cursor: pointer; transition: all 0.2s ease; }
        .pl-type-option:active { transform: scale(0.98); }
        .pl-type-option.active { border-color: var(--primary); background: rgba(232,168,56,0.03); }
        .pl-type-option input { display: none; }
        .pl-type-option-label { font-size: 14px; font-weight: 600; }
        .pl-type-option-desc { font-size: 12px; color: var(--text-tertiary); }
        .pl-order-options { display: flex; gap: 8px; }
        .pl-order-option { display: flex; align-items: center; gap: 6px; padding: 10px 16px; border: 1.5px solid var(--border); border-radius: var(--radius-md); cursor: pointer; font-size: 13px; font-weight: 600; transition: all 0.2s ease; }
        .pl-order-option:active { transform: scale(0.95); }
        .pl-order-option.active { border-color: var(--primary); background: rgba(232,168,56,0.03); }
        .pl-order-option input { display: none; }
        .pl-form-danger { padding: 10px 20px; background: rgba(239,68,68,0.1); border: none; border-radius: var(--radius-sm); color: var(--error); font-size: 13px; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 6px; transition: all 0.2s ease; }
        .pl-form-danger:active { background: rgba(239,68,68,0.2); }
        .pl-form-danger:disabled { opacity: 0.5; cursor: not-allowed; }
        .media-modal-close { width: 32px; height: 32px; border-radius: 50%; border: none; background: var(--surface-elevated); color: var(--text-secondary); font-size: 16px; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .media-modal-close:active { background: var(--surface-hover); }
        .pl-picker-checkbox { width: 20px; height: 20px; border-radius: 4px; border: 2px solid var(--border); display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 11px; color: #fff; background: transparent; }
        .pl-picker-checkbox.checked { background: var(--primary); border-color: var(--primary); }
        .pl-picker-already { font-size: 11px; color: var(--text-tertiary); font-weight: 500; flex-shrink: 0; }
        .pl-picker-footer { display: flex; align-items: center; justify-content: space-between; padding: 12px 20px; border-top: 1px solid var(--border); }
        .pl-picker-count { font-size: 13px; font-weight: 600; color: var(--text-secondary); }
        @media (max-width: 767px) {
          .pl-two-panel { flex-direction: column; }
          .pl-left-compact { max-width: 100%; }
          .pl-detail-back { display: flex; }
          .pl-right-panel { margin-left: 0; }
          .pl-filter-tab { font-size: 12px; padding: 6px 10px; }
        }
          
          /* ========== SKELETON LOADERS ========== */
          .skeleton-loading { background: linear-gradient(90deg, var(--surface) 25%, var(--surface-hover) 50%, var(--surface) 75%); background-size: 200% 100%; animation: shimmer 1.5s ease-in-out infinite; border-radius: var(--radius-md); }
          .skeleton-line { height: 14px; width: 100%; margin-bottom: 8px; }
          .skeleton-line.w60 { width: 60%; }
          .skeleton-line.w40 { width: 40%; }
          .skeleton-line.w80 { width: 80%; }
          .skeleton-line.w30 { width: 30%; }
          .skeleton-line.h24 { height: 24px; }
          .skeleton-line.h40 { height: 40px; }
          .skeleton-line.h100 { height: 100px; }
          .skeleton-block { background: var(--surface-card); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 16px; }
          .skeleton-img { background: linear-gradient(90deg, var(--surface) 25%, var(--surface-hover) 50%, var(--surface) 75%); background-size: 200% 100%; animation: shimmer 1.5s ease-in-out infinite; border-radius: var(--radius-md); }
          .skeleton-card { background: var(--surface-card); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; }
          @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

          /* ========== GO LIVE TAB ========== */
          .golive-content { padding: 16px; display: flex; flex-direction: column; gap: 16px; }

          .gl-status-card {
            display: flex; align-items: center; gap: 14px;
            padding: 18px; background: var(--surface-card);
            border: 1px solid var(--border); border-radius: var(--radius-lg);
          }
          .gl-status-left { display: flex; align-items: center; }
          .gl-live-indicator {
            display: flex; flex-direction: column; align-items: center; gap: 6px;
            width: 64px; height: 64px; border-radius: var(--radius-md);
            background: var(--surface-elevated); justify-content: center;
          }
          .gl-live-indicator.live { background: rgba(239,68,68,0.12); }
          .gl-live-dot {
            width: 12px; height: 12px; border-radius: 50%;
            background: var(--text-tertiary);
          }
          .gl-live-dot.pulse { background: var(--error); animation: livePulse 1.5s ease-in-out infinite; }
          .gl-live-label { font-size: 8px; font-weight: 700; letter-spacing: 1px; color: var(--text-tertiary); }
          .gl-live-indicator.live .gl-live-label { color: var(--error); }
          .gl-status-info { flex: 1; min-width: 0; }
          .gl-status-title { font-size: 16px; font-weight: 700; }
          .gl-status-sub { font-size: 13px; color: var(--text-secondary); margin-top: 2px; }
          .gl-listeners {
            display: inline-flex; align-items: center; gap: 5px;
            margin-top: 6px; font-size: 12px; font-weight: 600; color: var(--primary);
          }

          .gl-player-container {
            background: var(--surface-card); border: 1px solid var(--border);
            border-radius: var(--radius-lg); overflow: hidden;
          }
          .gl-player-header {
            display: flex; align-items: center; gap: 8px;
            padding: 12px 14px; border-bottom: 1px solid var(--border);
            font-size: 13px; font-weight: 600;
          }
          .gl-player-header i { color: var(--text-tertiary); font-size: 14px; }
          .gl-player-badge {
            margin-left: auto; display: flex; align-items: center; gap: 5px;
            padding: 3px 10px; border-radius: 6px; font-size: 10px; font-weight: 700;
            background: var(--surface-elevated); color: var(--text-tertiary);
          }
          .gl-player-badge.live { background: rgba(239,68,68,0.12); color: var(--error); }
          .gl-player-dot {
            width: 6px; height: 6px; border-radius: 50%; background: var(--text-tertiary);
          }
          .gl-player-dot.pulse { background: var(--error); animation: livePulse 1.5s ease-in-out infinite; }
          .gl-player-iframe {
            width: 100%; height: 120px; border: none; display: block;
          }
          .gl-connection-box {
            background: var(--surface-card); border: 1px solid var(--border);
            border-radius: var(--radius-lg); overflow: hidden;
          }
          .gl-conn-row {
            display: flex; align-items: center; justify-content: space-between;
            padding: 12px 14px; border-bottom: 1px solid var(--border);
            cursor: pointer; transition: background 0.15s ease;
          }
          .gl-conn-row:last-child { border-bottom: none; }
          .gl-conn-row:active { background: var(--surface-hover); }
          .gl-conn-label {
            display: flex; align-items: center; gap: 8px;
            font-size: 13px; font-weight: 600; color: var(--text-secondary);
          }
          .gl-conn-label i { width: 16px; font-size: 13px; color: var(--text-tertiary); }
          .gl-conn-value {
            display: flex; align-items: center; gap: 8px;
            font-size: 14px; font-weight: 700; font-variant-numeric: tabular-nums;
            font-family: 'JetBrains Mono', 'Fira Code', monospace;
          }
          .gl-conn-value i { font-size: 13px; color: var(--text-tertiary); cursor: pointer; }
          .gl-conn-value i:active { color: var(--primary); }
          .gl-pw-input {
            background: var(--surface-elevated); border: 1.5px solid var(--border);
            border-radius: 6px; padding: 4px 8px; color: var(--text-primary);
            font-size: 13px; font-weight: 700; font-family: 'JetBrains Mono', 'Fira Code', monospace;
            outline: none; width: 130px; text-align: center;
          }
          .gl-pw-input:focus { border-color: var(--primary); }
          .gl-pw-toggle {
            background: none; border: none; color: var(--text-tertiary);
            cursor: pointer; font-size: 14px; padding: 0;
          }
          .gl-pw-toggle:active { color: var(--primary); }
          .gl-conn-note {
            display: flex; align-items: center; gap: 6px;
            padding: 8px 0 0; font-size: 11px; color: var(--text-tertiary);
          }
          .gl-conn-note i { font-size: 12px; }

          .gl-streamer-list { display: flex; flex-direction: column; gap: 6px; }
          .gl-streamer-item.selected { border-color: var(--primary); border-left: 3px solid var(--primary); padding-left: 12px; }
          .gl-streamer-check { margin-left: 4px; color: var(--success); font-size: 14px; }
          .gl-streamer-actions { display: flex; align-items: center; gap: 2px; flex-shrink: 0; }
          .gl-streamer-edit {
            width: 28px; height: 28px; border-radius: 50%; border: none;
            background: none; color: var(--text-tertiary); cursor: pointer;
            font-size: 12px; display: flex; align-items: center; justify-content: center;
          }
          .gl-streamer-edit:active { background: var(--surface-elevated); color: var(--primary); }
          .gl-streamer-item {
            display: flex; align-items: center; gap: 10px;
            padding: 12px 14px; background: var(--surface-card);
            border: 1px solid var(--border); border-radius: var(--radius-md);
            transition: all 0.2s ease;
          }
          .gl-streamer-item.live { border-color: rgba(239,68,68,0.2); background: rgba(239,68,68,0.03); }
          .gl-streamer-status {
            width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0;
            background: var(--text-tertiary);
          }
          .gl-streamer-status.live { background: var(--error); }
          .gl-streamer-dot.pulse { animation: livePulse 1.5s ease-in-out infinite; }
          .gl-streamer-info { flex: 1; min-width: 0; }
          .gl-streamer-name { font-size: 14px; font-weight: 600; }
          .gl-streamer-user { font-size: 12px; color: var(--text-tertiary); }
          .gl-streamer-meta { flex-shrink: 0; }
          .gl-streamer-live-tag {
            padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 700;
            background: rgba(239,68,68,0.12); color: var(--error);
          }
          .gl-streamer-off-tag {
            padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600;
            background: var(--surface-elevated); color: var(--text-tertiary);
          }
          .gl-streamer-delete {
            width: 28px; height: 28px; border-radius: 50%; border: none;
            background: none; color: var(--text-tertiary); cursor: pointer;
            font-size: 13px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;
          }
          .gl-streamer-delete:active { background: rgba(239,68,68,0.1); color: var(--error); }
          .gl-streamer-delete:disabled { opacity: 0.4; }

          .gl-empty {
            display: flex; flex-direction: column; align-items: center;
            padding: 30px 0; text-align: center; gap: 6px;
          }
          .gl-empty i { font-size: 28px; color: var(--text-tertiary); opacity: 0.4; }
          .gl-empty p { font-size: 15px; font-weight: 600; margin: 0; }
          .gl-empty span { font-size: 13px; color: var(--text-tertiary); }

          .gl-history-list { display: flex; flex-direction: column; gap: 4px; }
          .gl-history-item {
            display: flex; align-items: center; gap: 10px;
            padding: 10px 12px; background: var(--surface-card);
            border: 1px solid var(--border); border-radius: var(--radius-sm);
          }
          .gl-history-icon {
            width: 32px; height: 32px; border-radius: var(--radius-sm);
            background: rgba(232,168,56,0.08); color: var(--primary);
            display: flex; align-items: center; justify-content: center; flex-shrink: 0;
          }
          .gl-history-icon i { font-size: 14px; }
          .gl-history-info { flex: 1; }
          .gl-history-date { font-size: 13px; font-weight: 600; }
          .gl-history-time { font-size: 11px; color: var(--text-tertiary); }

          .gl-form-row { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
          .gl-form-row label { font-size: 12px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; }
          .gl-form-note {
            display: flex; align-items: flex-start; gap: 6px;
            padding: 10px 12px; background: rgba(232,168,56,0.04);
            border: 1px solid rgba(232,168,56,0.1); border-radius: var(--radius-sm);
            font-size: 12px; color: var(--text-secondary); line-height: 1.4;
          }
          .gl-form-note i { font-size: 13px; color: var(--primary); margin-top: 1px; flex-shrink: 0; }

          `}</style>

      <ToastBridge />

      <div className="app-container">
        <PremiumTopBar />

        {/* ========== RADIO HEADER ========== */}
        <header className="radio-header">
          <div className="radio-header-logo"><i className="fas fa-tower-broadcast"></i></div>
          <div className="radio-header-info">
            <div className="radio-header-name">{overviewNP?.station?.name || radioConfig.stationName}</div>
            <div className="radio-header-sub">{radioConfig.description}</div>
          </div>
          <div className="radio-header-right">
            <div className={`on-air-badge ${isLive ? "live" : "off"}`}>
              <span className={`on-air-dot ${isLive ? "live" : "off"}`}></span>
              {isLive ? "On Air" : "Off Air"}
            </div>
            <div className="listener-count">
              <i className="fas fa-headphones"></i>
              {listeners}
            </div>
          </div>
        </header>

        {/* ========== AZURACAST EMBEDDED PLAYER ========== */}
        <div style={{ margin: "8px 16px 0" }}>
          <RadioEmbed
            src="https://azuracast.histoview.co.ke/public/mountain_of_delivarance_church/embed?autoplay=1&rounded=1&allow_popup=1&continuous=1"
            title="MOUNTAIN OF DELIVERANCE CHURCH Radio Player"
          />
        </div>

        {/* ========== TAB BAR ========== */}
        <nav className="tab-bar">
          {sidebarTabs.map((tab) => (
            <button
              key={tab.id}
              className={`tab-btn ${activeTab === tab.id ? "active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <i className={`fas ${tab.icon}`}></i>
              {tab.label}
            </button>
          ))}
        </nav>

        {/* ========== MAIN CONTENT ========== */}
        <div className="content-scroll" id="contentScroll">
          {renderContent()}
          <div style={{ height: "40px" }}></div>
        </div>

        {/* ========== BOTTOM NAV ========== */}
        <AdminBottomNav />
      </div>
    </>
  );
}
