"use client";

import { useState, useEffect, useCallback } from "react";
import AdminBottomNav from "@/components/admin/AdminBottomNav";
import ToastBridge from "@/components/dashboard/ToastBridge";
import { apiFetch } from "@/lib/api";
import { hapticSuccess } from "@/lib/haptics";
import { getVideosPage, saveVideos, updateVideo, deleteVideo, deleteAllYouTubeData, getChannel, saveChannel, getSeries, createSeries, updateSeries, deleteSeries } from "@/lib/youtube";
import type { YouTubeVideo, YouTubeChannel, YouTubeSeries } from "@/lib/youtube";
import type { DocumentSnapshot } from "firebase/firestore";

const categoryOptions = [
  { value: "sermon", label: "Sermon" },
  { value: "worship", label: "Worship" },
  { value: "testimony", label: "Testimony" },
  { value: "announcement", label: "Announcement" },
  { value: "event", label: "Event" },
  { value: "bible-study", label: "Bible Study" },
];

const seriesCategoryOptions = [
  { value: "sermon_series", label: "Sermon Series" },
  { value: "worship_series", label: "Worship Series" },
  { value: "bible_study", label: "Bible Study" },
  { value: "event", label: "Event" },
];

export default function AdminVideoPage() {
  // Connection state
  const [isConnected, setIsConnected] = useState(false);
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [channel, setChannel] = useState<YouTubeChannel | null>(null);
  const [channelLoading, setChannelLoading] = useState(true);

  // Library state
  const [activeTab, setActiveTab] = useState("library");
  const [videoFilter, setVideoFilter] = useState("all");
  const [videoSort, setVideoSort] = useState("newest");
  const [videoSearch, setVideoSearch] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [lastSynced, setLastSynced] = useState("");
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  // Data state
  const [videos, setVideos] = useState<YouTubeVideo[]>([]);
  const [videosLoading, setVideosLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  // Edit form state
  const [editForm, setEditForm] = useState({ title: "", description: "", category: "sermon", seriesId: "", isFeatured: false, isHidden: false, tags: "" });

  // Series state
  const [seriesList, setSeriesList] = useState<YouTubeSeries[]>([]);
  const [seriesLoading, setSeriesLoading] = useState(true);
  const [showCreateSeries, setShowCreateSeries] = useState(false);
  const [openSeriesId, setOpenSeriesId] = useState<string | null>(null);
  const [seriesForm, setSeriesForm] = useState({ name: "", description: "", category: "sermon_series", isPublic: true });
  const [showAddVideoPicker, setShowAddVideoPicker] = useState(false);

  // Live state
  const [embedLive, setEmbedLive] = useState(true);

  // Settings state
  const [autoSync, setAutoSync] = useState(true);
  const [syncFreq, setSyncFreq] = useState("6");
  const [defaultVisibility, setDefaultVisibility] = useState("public");
  const [defaultCategory, setDefaultCategory] = useState("sermon");
  const [featuredLimit, setFeaturedLimit] = useState(3);
  const [clearAllLoading, setClearAllLoading] = useState(false);

  function showToast(title: string, message: string, type: string, duration: number) {
    window.dispatchEvent(new CustomEvent("show-toast", { detail: { title, message, type, duration } }));
  }

  const formatNumber = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K` : String(n);

  // Firestore pagination
  const PAGE_SIZE = 20;
  const [lastDoc, setLastDoc] = useState<DocumentSnapshot | null>(null);

  const loadVideosPage = useCallback(async (cursor?: DocumentSnapshot | null) => {
    try {
      const { videos: newVideos, lastDoc: newLastDoc } = await getVideosPage(PAGE_SIZE, cursor || undefined);
      setVideos((prev) => cursor ? [...prev, ...newVideos] : newVideos);
      setLastDoc(newLastDoc);
    } catch (e) {
      console.error("Failed to load videos:", e);
    }
  }, []);

  // Load data from Firestore on mount
  const loadData = useCallback(async () => {
    const channelId = process.env.NEXT_PUBLIC_YOUTUBE_CHANNEL_ID;
    if (!channelId) {
      setChannelLoading(false);
      return;
    }

    try {
      const [ch, series] = await Promise.all([
        getChannel(channelId),
        getSeries(),
      ]);

      if (ch) {
        setChannel(ch);
        setIsConnected(true);
      } else {
        setChannel(null);
        setIsConnected(false);
      }
      setSeriesList(series);
      await loadVideosPage(null);
    } catch (e) {
      console.error("Failed to load YouTube data:", e);
    } finally {
      setChannelLoading(false);
      setVideosLoading(false);
      setSeriesLoading(false);
    }
  }, [loadVideosPage]);

  useEffect(() => { setTimeout(() => loadData(), 0); }, [loadData]);

  const loadMore = useCallback(async () => {
    if (!lastDoc) return;
    await loadVideosPage(lastDoc);
  }, [lastDoc, loadVideosPage]);

  // ========== FILTERING & SORTING ==========
  let filteredVideos = videos.filter((v) => {
    if (videoFilter === "published" && v.isHidden) return false;
    if (videoFilter === "hidden" && !v.isHidden) return false;
    if (videoFilter === "featured" && !v.isFeatured) return false;
    if (videoSearch && !v.title.toLowerCase().includes(videoSearch.toLowerCase()) && !v.description.toLowerCase().includes(videoSearch.toLowerCase())) return false;
    return true;
  });

  filteredVideos = [...filteredVideos].sort((a, b) => {
    switch (videoSort) {
      case "oldest": return new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime();
      case "views": return b.views - a.views;
      case "alpha": return a.title.localeCompare(b.title);
      default: return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
    }
  });

  // ========== HANDLERS ==========
  const handleConnect = async () => {
    setSyncing(true);
    showToast("Connecting...", "Fetching YouTube channel data", "info", 3000);
    try {
      const res = await apiFetch("/api/youtube/sync", { method: "POST" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Sync failed");
      }
      const data = await res.json();

      // Save to Firestore
      await Promise.all([
        saveChannel(data.channel),
        saveVideos(data.videos),
      ]);

      setChannel(data.channel);
      setVideos(data.videos);
      setIsConnected(true);
      setLastSynced("Just now");
      showToast("YouTube Connected", `Channel "${data.channel.name}" connected with ${data.videos.length} videos`, "success", 4000);
      await hapticSuccess();
    } catch (e) {
      showToast("Connection Failed", e instanceof Error ? e.message : "Unknown error", "error", 4000);
    } finally {
      setSyncing(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    showToast("Syncing...", "Checking for new videos from YouTube", "info", 2500);
    try {
      const res = await apiFetch("/api/youtube/sync", { method: "POST" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Sync failed");
      }
      const data = await res.json();

      await Promise.all([
        saveChannel(data.channel),
        saveVideos(data.videos),
      ]);

      setChannel(data.channel);
      setVideos(data.videos);
      setLastSynced("Just now");
      showToast("Sync Complete", `Synced ${data.videos.length} videos`, "success", 3000);
      await hapticSuccess();
    } catch (e) {
      showToast("Sync Failed", e instanceof Error ? e.message : "Unknown error", "error", 4000);
    } finally {
      setSyncing(false);
    }
  };

  const openEditVideo = (videoId: string) => {
    const v = videos.find((x) => x.youtubeId === videoId);
    if (!v) return;
    setSelectedVideoId(videoId);
    setEditForm({
      title: v.title,
      description: v.description,
      category: v.category,
      seriesId: v.seriesId || "",
      isFeatured: v.isFeatured,
      isHidden: v.isHidden,
      tags: v.tags.join(", "),
    });
    setShowEditModal(true);
  };

  const saveEditVideo = async () => {
    if (!selectedVideoId) return;
    try {
      await updateVideo(selectedVideoId, {
        title: editForm.title,
        description: editForm.description,
        category: editForm.category,
        seriesId: editForm.seriesId || null,
        isFeatured: editForm.isFeatured,
        isHidden: editForm.isHidden,
        tags: editForm.tags.split(",").map((t) => t.trim()).filter(Boolean),
      });
      setVideos((prev) => prev.map((v) =>
        v.youtubeId === selectedVideoId
          ? { ...v, title: editForm.title, description: editForm.description, category: editForm.category, seriesId: editForm.seriesId || null, isFeatured: editForm.isFeatured, isHidden: editForm.isHidden, tags: editForm.tags.split(",").map((t) => t.trim()).filter(Boolean) }
          : v
      ));
      setShowEditModal(false);
      showToast("Video Updated", `"${editForm.title}" saved successfully`, "success", 2500);
      await hapticSuccess();
    } catch (e) {
      showToast("Error", "Failed to save video", "error", 3000);
    }
  };

  const deleteVideoHandler = async () => {
    if (!selectedVideoId) return;
    try {
      const title = editForm.title;
      await deleteVideo(selectedVideoId);
      setVideos((prev) => prev.filter((v) => v.youtubeId !== selectedVideoId));
      setSeriesList((prev) => prev.map((s) => ({ ...s, videoIds: s.videoIds.filter((vid) => vid !== selectedVideoId) })));
      setShowDeleteModal(false);
      showToast("Video Deleted", `"${title}" removed from library`, "success", 2500);
      await hapticSuccess();
    } catch (e) {
      showToast("Error", "Failed to delete video", "error", 3000);
    }
  };

  const createSeriesHandler = async () => {
    try {
      const id = await createSeries({
        name: seriesForm.name || "New Series",
        description: seriesForm.description,
        coverImage: "https://images.unsplash.com/photo-1507692049790-de58290a4334?w=400&h=225&fit=crop",
        category: seriesForm.category,
        videoIds: [],
        isPublic: seriesForm.isPublic,
      });
      const newS: YouTubeSeries = { id, name: seriesForm.name || "New Series", description: seriesForm.description, coverImage: "https://images.unsplash.com/photo-1507692049790-de58290a4334?w=400&h=225&fit=crop", category: seriesForm.category, videoIds: [], isPublic: seriesForm.isPublic, createdAt: new Date().toISOString().slice(0, 10) };
      setSeriesList([newS, ...seriesList]);
      setShowCreateSeries(false);
      setSeriesForm({ name: "", description: "", category: "sermon_series", isPublic: true });
      showToast("Series Created", `"${newS.name}" has been added`, "success", 2500);
      await hapticSuccess();
    } catch (e) {
      showToast("Error", "Failed to create series", "error", 3000);
    }
  };

  const deleteSeriesHandler = async (id: string) => {
    try {
      await deleteSeries(id);
      setSeriesList(seriesList.filter((s) => s.id !== id));
      if (openSeriesId === id) setOpenSeriesId(null);
      showToast("Series Deleted", "Series removed", "info", 2500);
      await hapticSuccess();
    } catch (e) {
      showToast("Error", "Failed to delete series", "error", 3000);
    }
  };

  const clearAllData = async () => {
    if (!confirm("Delete all YouTube data (videos, series, channel info)? This cannot be undone.")) return;
    setClearAllLoading(true);
    try {
      const { videos, series } = await deleteAllYouTubeData();
      setVideos([]);
      setSeriesList([]);
      setChannel(null);
      setIsConnected(false);
      setLastSynced("");
      showToast("Database Cleared", `Deleted ${videos} videos and ${series} series`, "success", 3000);
      await hapticSuccess();
    } catch {
      showToast("Error", "Failed to clear database", "error", 3000);
    }
    setClearAllLoading(false);
  };

  const removeVideoFromSeries = async (seriesId: string, videoId: string) => {
    const s = seriesList.find((x) => x.id === seriesId);
    if (!s) return;
    const newIds = s.videoIds.filter((vid) => vid !== videoId);
    try {
      await updateSeries(seriesId, { videoIds: newIds });
      setSeriesList(seriesList.map((x) => x.id === seriesId ? { ...x, videoIds: newIds } : x));
      await hapticSuccess();
    } catch (e) {
      showToast("Error", "Failed to remove video", "error", 3000);
    }
  };

  const addVideoToSeries = async (videoId: string) => {
    if (!openSeriesId) return;
    const s = seriesList.find((x) => x.id === openSeriesId);
    if (!s || s.videoIds.includes(videoId)) return;
    const newIds = [...s.videoIds, videoId];
    try {
      await updateSeries(openSeriesId, { videoIds: newIds });
      setSeriesList(seriesList.map((x) => x.id === openSeriesId ? { ...x, videoIds: newIds } : x));
      await hapticSuccess();
    } catch (e) {
      showToast("Error", "Failed to add video", "error", 3000);
    }
  };

  const handleAddPastBroadcast = () => {
    showToast("Added to Library", "Broadcast added to video library", "success", 2500);
  };

  const openSeries = (id: string) => {
    setOpenSeriesId(openSeriesId === id ? null : id);
  };

  const openSeriesSafe = (id: string | undefined) => {
    if (id) setOpenSeriesId(openSeriesId === id ? null : id);
  };

  const openSeriesVideos = (id: string) => {
    const s = seriesList.find((x) => x.id === id);
    return s ? s.videoIds.map((vid) => videos.find((v) => v.youtubeId === vid)).filter(Boolean) as YouTubeVideo[] : [];
  };

  // ========== RENDER ==========
  if (channelLoading && !isConnected) {
    return (
      <>
        <style>{`
          :root { --primary: #E8A838; --primary-light: #F5C76B; --primary-dark: #C48A2A; --bg: #0F0F0F; --surface: #1A1A1A; --surface-elevated: #242424; --surface-card: #1E1E1E; --surface-hover: #2A2A2A; --text-primary: #FFFFFF; --text-secondary: #A0A0A0; --text-tertiary: #6B6B6B; --border: #2A2A2A; --error: #FF6B6B; --success: #4ADE80; --info: #38BDF8; --overlay: rgba(0,0,0,0.92); --gradient-start: #E8A838; --gradient-end: #D4762A; --gradient-red: #EF4444; --gradient-green: #22C55E; --shadow-soft: 0 4px 20px rgba(232,168,56,0.15); --radius-sm: 10px; --radius-md: 14px; --radius-lg: 18px; --radius-xl: 22px; --radius-full: 50%; }
          * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; font-family: Inter, -apple-system, BlinkMacSystemFont, sans-serif; }
          html, body { height: 100%; overflow: hidden; background: var(--bg); color: var(--text-primary); }
          .skeleton-loading { background: linear-gradient(90deg, var(--surface) 25%, var(--surface-hover) 50%, var(--surface) 75%); background-size: 200% 100%; animation: shimmer 1.5s ease-in-out infinite; border-radius: var(--radius-md); }
          .skeleton-line { height: 14px; width: 100%; margin-bottom: 8px; }
          .skeleton-line.w60 { width: 60%; }
          .skeleton-line.w40 { width: 40%; }
          .skeleton-line.w80 { width: 80%; }
          .skeleton-line.h24 { height: 24px; }
          @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
        `}</style>
        <ToastBridge />
        <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: "40px 28px", background: "var(--bg)" }}>
          <div className="skeleton-loading" style={{ width: 80, height: 80, borderRadius: 24, marginBottom: 8 }}></div>
          <div className="skeleton-loading skeleton-line w40 h24"></div>
          <div className="skeleton-loading skeleton-line w60"></div>
          <div className="skeleton-loading skeleton-line w80"></div>
        </div>
      </>
    );
  }

  if (!isConnected) {
    return (
      <>
        <style>{`
          :root { --primary: #E8A838; --primary-light: #F5C76B; --primary-dark: #C48A2A; --bg: #0F0F0F; --surface: #1A1A1A; --surface-elevated: #242424; --surface-card: #1E1E1E; --surface-hover: #2A2A2A; --text-primary: #FFFFFF; --text-secondary: #A0A0A0; --text-tertiary: #6B6B6B; --border: #2A2A2A; --error: #FF6B6B; --success: #4ADE80; --info: #38BDF8; --overlay: rgba(0,0,0,0.92); --gradient-start: #E8A838; --gradient-end: #D4762A; --gradient-red: #EF4444; --gradient-green: #22C55E; --shadow-soft: 0 4px 20px rgba(232,168,56,0.15); --radius-sm: 10px; --radius-md: 14px; --radius-lg: 18px; --radius-xl: 22px; --radius-full: 50%; }
          * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; font-family: Inter, -apple-system, BlinkMacSystemFont, sans-serif; }
          html, body { height: 100%; overflow: hidden; background: var(--bg); color: var(--text-primary); }
          .connect-screen { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px 28px; text-align: center; }
          .connect-icon { width: 80px; height: 80px; background: linear-gradient(135deg, var(--gradient-red), #DC2626); border-radius: 24px; display: flex; align-items: center; justify-content: center; font-size: 36px; color: #fff; box-shadow: 0 4px 24px rgba(239,68,68,0.25); margin-bottom: 24px; }
          .connect-title { font-size: 24px; font-weight: 800; margin-bottom: 8px; }
          .connect-desc { font-size: 14px; color: var(--text-secondary); max-width: 320px; line-height: 1.6; margin-bottom: 8px; }
          .connect-input { width: 100%; max-width: 380px; padding: 14px 18px; background: var(--surface-card); border: 1.5px solid var(--border); border-radius: var(--radius-md); color: var(--text-primary); font-size: 15px; outline: none; margin-bottom: 16px; }
          .connect-input:focus { border-color: var(--primary); box-shadow: 0 0 0 4px rgba(232,168,56,0.08); }
          .connect-input::placeholder { color: var(--text-tertiary); }
          .connect-btn { width: 100%; max-width: 380px; padding: 16px; border-radius: var(--radius-md); font-size: 15px; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 10px; border: none; background: linear-gradient(135deg, var(--gradient-red), #DC2626); color: #fff; box-shadow: 0 4px 20px rgba(239,68,68,0.25); transition: all 0.2s ease; }
          .connect-btn:active { transform: scale(0.97); }
          .connect-btn i { font-size: 18px; }
          .connect-note { font-size: 12px; color: var(--text-tertiary); margin-top: 16px; max-width: 340px; line-height: 1.5; }
        
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

          `}</style>
        <ToastBridge />
        <div className="connect-screen">
          <div className="connect-icon"><i className="fab fa-youtube"></i></div>
          <h1 className="connect-title">Connect YouTube</h1>
          <p className="connect-desc">Sync your church&apos;s YouTube channel to manage and organize all your videos in one place.</p>
          <button className="connect-btn" onClick={handleConnect} disabled={syncing}>
            {syncing ? <i className="fas fa-spinner fa-spin"></i> : <i className="fab fa-youtube"></i>}
            {syncing ? "Connecting..." : "Connect with YouTube"}
          </button>
          <p className="connect-note">Your videos remain hosted on YouTube. We only store metadata to organize and present them in your church app.</p>
          <button onClick={() => { setIsConnected(true); setActiveTab("settings"); }} style={{ marginTop: 24, background: "none", border: "none", color: "var(--text-tertiary)", fontSize: 13, cursor: "pointer", textDecoration: "underline" }}>
            Skip — go to Settings
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <ToastBridge />
      <style>{`
        :root { --primary: #E8A838; --primary-light: #F5C76B; --primary-dark: #C48A2A; --bg: #0F0F0F; --surface: #1A1A1A; --surface-elevated: #242424; --surface-card: #1E1E1E; --surface-hover: #2A2A2A; --text-primary: #FFFFFF; --text-secondary: #A0A0A0; --text-tertiary: #6B6B6B; --border: #2A2A2A; --error: #FF6B6B; --success: #4ADE80; --info: #38BDF8; --warning: #FBBF24; --overlay: rgba(0,0,0,0.92); --gradient-start: #E8A838; --gradient-end: #D4762A; --gradient-red: #EF4444; --gradient-green: #22C55E; --gradient-blue: #3B82F6; --gradient-purple: #8B5CF6; --shadow-soft: 0 4px 20px rgba(232,168,56,0.15); --shadow-elevated: 0 8px 32px rgba(0,0,0,0.5); --radius-sm: 10px; --radius-md: 14px; --radius-lg: 18px; --radius-xl: 22px; --radius-full: 50%; }
        * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; font-family: Inter, -apple-system, BlinkMacSystemFont, sans-serif; }
        html, body { height: 100%; overflow: hidden; background: var(--bg); color: var(--text-primary); }
        .app-container { height: 100%; display: flex; flex-direction: column; position: relative; overflow: hidden; }
        @media (min-width: 480px) { .app-container { max-width: 480px; margin: 0 auto; border-left: 1px solid var(--border); border-right: 1px solid var(--border); } }
        .status-bar { height: env(safe-area-inset-top, 24px); min-height: 24px; background: var(--bg); flex-shrink: 0; }

        /* ========== HEADER ========== */
        .header { padding: 10px 16px 8px; display: flex; align-items: center; gap: 12px; flex-shrink: 0; background: var(--bg); border-bottom: 1px solid var(--border); }
        .header-logo { width: 38px; height: 38px; background: linear-gradient(135deg, var(--gradient-red), #DC2626); border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 12px rgba(239,68,68,0.2); }
        .header-logo i { font-size: 16px; color: #fff; }
        .header-info { flex: 1; min-width: 0; }
        .header-title { font-size: 15px; font-weight: 700; line-height: 1.2; display: flex; align-items: center; gap: 8px; }
        .header-title .connected-badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; background: rgba(34,197,94,0.1); border-radius: 10px; font-size: 9px; font-weight: 700; color: var(--success); text-transform: uppercase; letter-spacing: 0.5px; }
        .header-title .connected-badge i { font-size: 6px; }
        .header-sub { font-size: 11px; color: var(--text-tertiary); margin-top: 1px; }
        .header-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
        .header-avatar { width: 32px; height: 32px; border-radius: var(--radius-full); object-fit: cover; border: 2px solid var(--border); }

        /* ========== IN-PAGE TABS ========== */
        .vtabs { display: flex; gap: 2px; padding: 6px 12px; background: var(--bg); border-bottom: 1px solid var(--border); flex-shrink: 0; }
        .vtab { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 8px 4px; border-radius: 10px; border: none; background: transparent; color: var(--text-tertiary); font-size: 10px; font-weight: 600; cursor: pointer; transition: all 0.2s ease; }
        .vtab i { font-size: 18px; transition: transform 0.2s ease; }
        .vtab:active i { transform: scale(0.85); }
        .vtab.active { color: var(--primary); background: var(--surface-elevated); }

        /* ========== CONTENT SCROLL ========== */
        .content-scroll { flex: 1; overflow-y: auto; overflow-x: hidden; -webkit-overflow-scrolling: touch; padding-bottom: 80px; }
        .content-scroll::-webkit-scrollbar { display: none; }

        /* ========== SYNC BAR (Library) ========== */
        .sync-bar { display: flex; align-items: center; gap: 10px; padding: 12px 16px; flex-shrink: 0; background: var(--bg); }
        .sync-btn { padding: 10px 16px; border-radius: var(--radius-md); font-size: 13px; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 6px; border: none; background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end)); color: #fff; box-shadow: var(--shadow-soft); white-space: nowrap; }
        .sync-btn:active { transform: scale(0.95); }
        .sync-btn:disabled { opacity: 0.6; }
        .sync-status { font-size: 12px; color: var(--text-tertiary); }
        .sync-status strong { color: var(--text-secondary); }

        /* ========== FILTER BAR ========== */
        .filter-bar { display: flex; gap: 8px; padding: 0 16px 10px; flex-wrap: wrap; }
        .filter-chips { display: flex; gap: 4px; flex-wrap: wrap; flex: 1; }
        .filter-chip { padding: 6px 12px; border-radius: 8px; font-size: 12px; font-weight: 600; border: 1.5px solid var(--border); background: transparent; color: var(--text-secondary); cursor: pointer; transition: all 0.2s ease; white-space: nowrap; }
        .filter-chip:active { transform: scale(0.95); }
        .filter-chip.active { background: var(--primary); border-color: var(--primary); color: #fff; }
        .sort-select { padding: 6px 10px; border-radius: 8px; font-size: 12px; font-weight: 600; border: 1.5px solid var(--border); background: var(--surface-card); color: var(--text-secondary); cursor: pointer; outline: none; appearance: none; padding-right: 28px; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%236B6B6B' viewBox='0 0 16 16'%3E%3Cpath d='M7.247 11.14 2.451 5.658C1.885 5.013 2.345 4 3.204 4h9.592a1 1 0 0 1 .753 1.659l-4.796 5.48a1 1 0 0 1-1.506 0z'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 8px center; }
        .view-toggle { display: flex; gap: 2px; background: var(--surface-card); border: 1px solid var(--border); border-radius: 8px; padding: 2px; }
        .view-btn { padding: 4px 8px; border-radius: 6px; font-size: 14px; border: none; background: transparent; color: var(--text-tertiary); cursor: pointer; }
        .view-btn.active { background: var(--surface-elevated); color: var(--text-primary); }

        /* ========== SEARCH ========== */
        .search-bar { padding: 0 16px 12px; }
        .search-wrapper { position: relative; }
        .search-wrapper i { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: var(--text-tertiary); font-size: 15px; pointer-events: none; }
        .search-wrapper input { width: 100%; padding: 12px 14px 12px 42px; background: var(--surface-card); border: 1.5px solid var(--border); border-radius: var(--radius-md); color: var(--text-primary); font-size: 14px; outline: none; }
        .search-wrapper input:focus { border-color: var(--primary); }
        .search-wrapper input::placeholder { color: var(--text-tertiary); }

        /* ========== VIDEO GRID — PREMIUM ========== */
        .video-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; padding: 0 16px; }
        .v-card { background: var(--surface-card); border: 1px solid var(--border); border-radius: var(--radius-xl); overflow: hidden; cursor: pointer; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); position: relative; }
        .v-card:hover { transform: translateY(-3px); border-color: rgba(232,168,56,0.15); box-shadow: 0 8px 25px rgba(0,0,0,0.2); }
        .v-card:active { transform: scale(0.95); }
        .v-thumb { position: relative; aspect-ratio: 16/9; overflow: hidden; background: var(--surface-elevated); }
        .v-thumb img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.4s ease; }
        .v-card:hover .v-thumb img { transform: scale(1.08); }
        .v-duration { position: absolute; bottom: 8px; right: 8px; padding: 3px 8px; background: rgba(0,0,0,0.7); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); border-radius: 6px; font-size: 11px; font-weight: 700; color: #fff; }
        .v-badges { position: absolute; top: 8px; left: 8px; display: flex; gap: 4px; }
        .v-badge { padding: 3px 8px; border-radius: 6px; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; backdrop-filter: blur(4px); }
        .v-badge.featured { background: rgba(232,168,56,0.85); color: #fff; box-shadow: 0 2px 8px rgba(232,168,56,0.2); }
        .v-badge.hidden { background: rgba(107,107,107,0.8); color: #fff; }
        .v-body { padding: 12px 14px 14px; }
        .v-title { font-size: 13px; font-weight: 700; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin-bottom: 8px; }
        .v-meta { display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--text-tertiary); flex-wrap: wrap; }
        .v-category { padding: 2px 8px; border-radius: 4px; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; display: inline-flex; align-items: center; gap: 4px; }
        .v-category::before { content: ''; width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; }
        .v-category.sermon { background: rgba(232,168,56,0.1); color: var(--primary); }
        .v-category.sermon::before { background: var(--primary); }
        .v-category.worship { background: rgba(139,92,246,0.1); color: var(--gradient-purple); }
        .v-category.worship::before { background: var(--gradient-purple); }
        .v-category.testimony { background: rgba(34,197,94,0.1); color: var(--gradient-green); }
        .v-category.testimony::before { background: var(--gradient-green); }
        .v-category.announcement { background: rgba(59,130,246,0.1); color: var(--gradient-blue); }
        .v-category.announcement::before { background: var(--gradient-blue); }
        .v-category.event { background: rgba(239,68,68,0.1); color: var(--error); }
        .v-category.event::before { background: var(--error); }
        .v-category.bible-study { background: rgba(59,130,246,0.1); color: var(--gradient-blue); }
        .v-category.bible-study::before { background: var(--gradient-blue); }
        .v-series-tag { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; background: rgba(232,168,56,0.08); border-radius: 4px; font-size: 10px; font-weight: 600; color: var(--primary); }

        /* ========== VIDEO LIST VIEW ========== */
        .video-list { padding: 0 16px; }
        .v-list-item { display: flex; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--border); cursor: pointer; transition: opacity 0.2s ease; }
        .v-list-item:last-child { border-bottom: none; }
        .v-list-item:active { opacity: 0.6; }
        .v-list-thumb { width: 120px; aspect-ratio: 16/9; border-radius: var(--radius-sm); overflow: hidden; position: relative; flex-shrink: 0; border: 1px solid var(--border); }
        .v-list-thumb img { width: 100%; height: 100%; object-fit: cover; }
        .v-list-info { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; }
        .v-list-title { font-size: 14px; font-weight: 600; margin-bottom: 4px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .v-list-meta { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text-tertiary); flex-wrap: wrap; }
        .v-list-menu { width: 32px; height: 32px; border-radius: var(--radius-full); background: none; border: none; color: var(--text-tertiary); font-size: 14px; display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; align-self: center; }
        .v-list-menu:active { background: var(--surface); }

        /* ========== VIDEO COUNT ========== */
        .v-count { padding: 0 16px 12px; font-size: 12px; color: var(--text-tertiary); font-weight: 500; }
        .v-count strong { color: var(--text-primary); }

        /* ========== EDIT MODAL ========== */
        .modal-overlay { position: fixed; inset: 0; background: var(--overlay); z-index: 9000; display: flex; align-items: flex-end; justify-content: center; opacity: 0; visibility: hidden; transition: opacity 0.3s ease, visibility 0.3s ease; }
        .modal-overlay.active { opacity: 1; visibility: visible; }
        .modal-sheet { width: 100%; max-width: 480px; background: var(--surface); border-radius: 28px 28px 0 0; padding: 0 0 env(safe-area-inset-bottom, 20px); transform: translateY(100%); transition: transform 0.35s cubic-bezier(0.32,0.72,0,1); max-height: 88vh; display: flex; flex-direction: column; }
        .modal-overlay.active .modal-sheet { transform: translateY(0); }
        .modal-handle { width: 40px; height: 5px; background: var(--text-tertiary); border-radius: 3px; margin: 12px auto 8px; opacity: 0.5; }
        .modal-header { padding: 8px 24px 16px; text-align: center; }
        .modal-header h2 { font-size: 20px; font-weight: 700; }
        .modal-body { flex: 1; overflow-y: auto; padding: 0 24px 20px; }
        .modal-body::-webkit-scrollbar { display: none; }
        .modal-footer { padding: 16px 24px; border-top: 1px solid var(--border); display: flex; gap: 12px; }
        .form-group { margin-bottom: 14px; }
        .form-group label { display: block; font-size: 12px; font-weight: 600; color: var(--text-secondary); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px; }
        .form-input { width: 100%; padding: 12px 14px; background: var(--surface-card); border: 1.5px solid var(--border); border-radius: var(--radius-md); color: var(--text-primary); font-size: 14px; outline: none; }
        .form-input:focus { border-color: var(--primary); }
        .form-select { width: 100%; padding: 12px 14px; background: var(--surface-card); border: 1.5px solid var(--border); border-radius: var(--radius-md); color: var(--text-primary); font-size: 14px; outline: none; appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' fill='%236B6B6B' viewBox='0 0 16 16'%3E%3Cpath d='M7.247 11.14 2.451 5.658C1.885 5.013 2.345 4 3.204 4h9.592a1 1 0 0 1 .753 1.659l-4.796 5.48a1 1 0 0 1-1.506 0z'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 12px center; padding-right: 36px; }
        .form-textarea { width: 100%; padding: 12px 14px; background: var(--surface-card); border: 1.5px solid var(--border); border-radius: var(--radius-md); color: var(--text-primary); font-size: 14px; outline: none; resize: vertical; min-height: 70px; font-family: inherit; }
        .form-textarea:focus { border-color: var(--primary); }
        .btn-primary { flex: 1; padding: 14px; background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end)); border: none; border-radius: var(--radius-md); color: #fff; font-size: 15px; font-weight: 700; cursor: pointer; transition: all 0.2s ease; }
        .btn-primary:active { transform: scale(0.97); }
        .btn-secondary { flex: 1; padding: 14px; background: var(--surface-elevated); border: none; border-radius: var(--radius-md); color: var(--text-secondary); font-size: 15px; font-weight: 700; cursor: pointer; transition: all 0.2s ease; }
        .btn-secondary:active { transform: scale(0.97); }
        .btn-danger { width: 100%; padding: 14px; background: rgba(239,68,68,0.1); border: none; border-radius: var(--radius-md); color: var(--error); font-size: 15px; font-weight: 700; cursor: pointer; transition: all 0.2s ease; }
        .btn-danger:active { transform: scale(0.97); }

        /* Toggle */
        .toggle-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; }
        .toggle-info { flex: 1; }
        .toggle-title { font-size: 14px; font-weight: 600; }
        .toggle-desc { font-size: 12px; color: var(--text-tertiary); margin-top: 1px; }
        .toggle-switch { width: 44px; height: 24px; background: var(--surface-elevated); border-radius: 12px; position: relative; cursor: pointer; border: none; flex-shrink: 0; transition: all 0.25s ease; }
        .toggle-switch.active { background: var(--primary); }
        .toggle-switch::after { content: ''; position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; background: #fff; border-radius: var(--radius-full); transition: all 0.25s ease; box-shadow: 0 2px 4px rgba(0,0,0,0.2); }
        .toggle-switch.active::after { left: 23px; }

        /* ========== SERIES TAB ========== */
        .series-content { padding: 16px; display: flex; flex-direction: column; gap: 14px; }
        .series-toolbar { display: flex; gap: 10px; }
        .series-create-btn { display: flex; align-items: center; gap: 6px; padding: 10px 16px; background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end)); border: none; border-radius: var(--radius-md); color: #fff; font-size: 13px; font-weight: 700; cursor: pointer; box-shadow: var(--shadow-soft); }
        .series-create-btn:active { transform: scale(0.95); }
        .series-count { font-size: 12px; color: var(--text-tertiary); font-weight: 500; }
        .series-grid { display: flex; flex-direction: column; gap: 10px; }
        .series-card { background: var(--surface-card); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; cursor: pointer; transition: all 0.2s ease; }
        .series-card:active { background: var(--surface-hover); }
        .series-card.expanded { border-color: rgba(232,168,56,0.2); }
        .series-card-header { display: flex; align-items: center; gap: 12px; padding: 14px 16px; }
        .series-cover { width: 56px; height: 56px; border-radius: var(--radius-sm); object-fit: cover; flex-shrink: 0; border: 1px solid var(--border); }
        .series-info { flex: 1; min-width: 0; }
        .series-name { font-size: 15px; font-weight: 600; }
        .series-meta { font-size: 12px; color: var(--text-tertiary); margin-top: 2px; }
        .series-category-badge { padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; background: rgba(232,168,56,0.1); color: var(--primary); text-transform: uppercase; letter-spacing: 0.5px; }
        .series-toggle { width: 30px; height: 30px; border-radius: var(--radius-full); background: none; border: none; color: var(--text-tertiary); font-size: 14px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
        .series-toggle:hover { background: var(--surface-elevated); }
        .series-toggle.danger:active { color: var(--error); }
        .series-chevron { font-size: 14px; color: var(--text-tertiary); transition: transform 0.25s ease; }
        .series-chevron.open { transform: rotate(180deg); color: var(--primary); }

        .series-detail { border-top: 1px solid var(--border); padding: 12px 16px 16px; }
        .series-desc { font-size: 13px; color: var(--text-secondary); margin-bottom: 12px; line-height: 1.5; }
        .series-videos { display: flex; flex-direction: column; gap: 4px; }
        .series-video-item { display: flex; align-items: center; gap: 10px; padding: 6px 0; }
        .series-video-thumb { width: 44px; height: 28px; border-radius: 4px; object-fit: cover; flex-shrink: 0; border: 1px solid var(--border); }
        .series-video-title { flex: 1; font-size: 13px; font-weight: 500; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .series-video-remove { width: 26px; height: 26px; border-radius: var(--radius-full); background: none; border: none; color: var(--text-tertiary); font-size: 14px; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .series-video-remove:active { color: var(--error); }
        .series-add-btn { display: flex; align-items: center; justify-content: center; gap: 6px; padding: 10px; border: 1.5px dashed var(--border); border-radius: var(--radius-sm); background: transparent; color: var(--primary); font-size: 13px; font-weight: 600; cursor: pointer; margin-top: 8px; transition: all 0.2s ease; }
        .series-add-btn:active { border-color: var(--primary); background: rgba(232,168,56,0.04); }
        .series-stats { display: flex; gap: 16px; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border); }
        .series-stat { font-size: 12px; color: var(--text-tertiary); }
        .series-stat strong { color: var(--text-primary); }
        .series-empty { text-align: center; padding: 40px 20px; color: var(--text-tertiary); }
        .series-empty i { font-size: 36px; margin-bottom: 12px; display: block; }
        .series-empty h3 { font-size: 18px; font-weight: 700; color: var(--text-primary); margin-bottom: 6px; }
        .series-empty p { font-size: 14px; }

        /* ========== LIVE TAB ========== */
        .live-content { padding: 16px; display: flex; flex-direction: column; gap: 16px; }
        .live-active-card { background: linear-gradient(135deg, rgba(239,68,68,0.06), rgba(232,168,56,0.04)); border: 1px solid rgba(239,68,68,0.15); border-radius: var(--radius-lg); padding: 20px; text-align: center; }
        .live-active-dot { width: 12px; height: 12px; border-radius: var(--radius-full); background: var(--error); margin: 0 auto 10px; animation: livePulse 1.5s ease-in-out infinite; box-shadow: 0 0 16px rgba(239,68,68,0.4); }
        @keyframes livePulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(1.6); } }
        .live-active-title { font-size: 16px; font-weight: 700; margin-bottom: 4px; }
        .live-active-meta { font-size: 13px; color: var(--text-secondary); display: flex; align-items: center; justify-content: center; gap: 12px; }
        .live-not-active { background: var(--surface-card); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 24px; text-align: center; }
        .live-not-active i { font-size: 32px; color: var(--text-tertiary); margin-bottom: 10px; }
        .live-not-active h3 { font-size: 16px; font-weight: 700; margin-bottom: 4px; }
        .live-not-active p { font-size: 13px; color: var(--text-secondary); }

        .live-upcoming { display: flex; flex-direction: column; gap: 8px; }
        .live-upcoming-item { display: flex; align-items: center; gap: 12px; padding: 12px 14px; background: var(--surface-card); border: 1px solid var(--border); border-radius: var(--radius-md); }
        .live-upcoming-icon { width: 36px; height: 36px; border-radius: var(--radius-sm); background: rgba(59,130,246,0.1); color: var(--gradient-blue); display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0; }
        .live-upcoming-info { flex: 1; }
        .live-upcoming-name { font-size: 14px; font-weight: 600; }
        .live-upcoming-date { font-size: 12px; color: var(--text-tertiary); }

        .live-past-toggle { display: flex; gap: 6px; }
        .live-past-btn { padding: 8px 14px; border-radius: 8px; font-size: 12px; font-weight: 600; border: 1.5px solid var(--border); background: transparent; color: var(--text-secondary); cursor: pointer; }
        .live-past-btn.active { background: var(--primary); border-color: var(--primary); color: #fff; }

        .live-past-list { display: flex; flex-direction: column; gap: 6px; }
        .live-past-item { display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: var(--surface-card); border: 1px solid var(--border); border-radius: var(--radius-md); }
        .live-past-info { flex: 1; min-width: 0; }
        .live-past-name { font-size: 13px; font-weight: 600; }
        .live-past-meta { font-size: 11px; color: var(--text-tertiary); margin-top: 1px; }
        .live-past-add-btn { padding: 6px 12px; border-radius: 6px; font-size: 11px; font-weight: 700; border: none; background: rgba(232,168,56,0.1); color: var(--primary); cursor: pointer; white-space: nowrap; }
        .live-past-add-btn:active { transform: scale(0.95); }
        .live-past-add-btn.done { background: var(--surface-elevated); color: var(--text-tertiary); }

        /* ========== SETTINGS TAB ========== */
        .settings-content { padding: 16px; display: flex; flex-direction: column; gap: 18px; }
        .st-section { display: flex; flex-direction: column; gap: 10px; }
        .st-title { font-size: 13px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; }

        .st-channel-card { display: flex; align-items: center; gap: 14px; padding: 16px; background: var(--surface-card); border: 1px solid var(--border); border-radius: var(--radius-lg); }
        .st-channel-avatar { width: 52px; height: 52px; border-radius: var(--radius-full); object-fit: cover; border: 2px solid var(--border); }
        .st-channel-info { flex: 1; }
        .st-channel-name { font-size: 15px; font-weight: 700; }
        .st-channel-meta { font-size: 12px; color: var(--text-tertiary); margin-top: 2px; }
        .st-channel-disconnect { padding: 8px 14px; border-radius: 8px; font-size: 12px; font-weight: 600; border: 1px solid rgba(239,68,68,0.3); background: transparent; color: var(--error); cursor: pointer; }
        .st-channel-disconnect:active { background: rgba(239,68,68,0.05); }

        .st-toggle-row { display: flex; align-items: center; gap: 14px; padding: 12px 14px; background: var(--surface-card); border: 1px solid var(--border); border-radius: var(--radius-md); }
        .st-toggle-info { flex: 1; }
        .st-toggle-label { font-size: 14px; font-weight: 600; }
        .st-toggle-desc { font-size: 12px; color: var(--text-tertiary); margin-top: 1px; }

        .st-freq-group { display: flex; gap: 6px; }
        .st-freq-btn { padding: 8px 14px; border-radius: 8px; font-size: 12px; font-weight: 600; border: 1.5px solid var(--border); background: transparent; color: var(--text-secondary); cursor: pointer; }
        .st-freq-btn.active { background: var(--primary); border-color: var(--primary); color: #fff; }

        /* ========== FAB ========== */
        .fab { position: fixed; bottom: calc(80px + env(safe-area-inset-bottom, 0px)); right: 20px; width: 56px; height: 56px; border-radius: var(--radius-full); background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end)); border: none; color: #fff; font-size: 22px; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: var(--shadow-soft), 0 4px 20px rgba(232,168,56,0.3); z-index: 1000; transition: all 0.2s ease; }
        .fab:active { transform: scale(0.92); }

        /* ========== PICKER MODAL ========== */
        .picker-item { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--border); cursor: pointer; transition: opacity 0.2s ease; }
        .picker-item:last-child { border-bottom: none; }
        .picker-item:active { opacity: 0.6; }
        .picker-item.disabled { opacity: 0.4; cursor: default; }
        .picker-thumb { width: 44px; height: 28px; border-radius: 4px; object-fit: cover; flex-shrink: 0; border: 1px solid var(--border); }
        .picker-info { flex: 1; }
        .picker-title { font-size: 14px; font-weight: 600; }
        .picker-icon { color: var(--primary); font-size: 18px; }
        .picker-icon.done { color: var(--success); }

        /* ========== BOTTOM NAV ========== */
        .bottom-nav { position: fixed; bottom: 0; left: 0; right: 0; background: rgba(15,15,15,0.92); backdrop-filter: blur(20px) saturate(180%); -webkit-backdrop-filter: blur(20px) saturate(180%); border-top: 1px solid var(--border); padding: 8px 0 calc(8px + env(safe-area-inset-bottom, 0px)); z-index: 1000; display: flex; justify-content: space-around; align-items: center; }
        @media (min-width: 480px) { .bottom-nav { max-width: 480px; margin: 0 auto; } }
        .nav-item { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 6px 12px; background: none; border: none; color: var(--text-tertiary); cursor: pointer; transition: all 0.2s ease; position: relative; }
        .nav-item.active { color: var(--primary); }
        .nav-item i { font-size: 20px; transition: transform 0.2s ease; }
        .nav-item:active i { transform: scale(0.85); }
        .nav-item span { font-size: 10px; font-weight: 600; }
        .nav-item .nav-badge { position: absolute; top: 2px; right: 6px; width: 8px; height: 8px; background: var(--error); border-radius: var(--radius-full); border: 2px solid var(--bg); }
      
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

      `}</style>

      <div className="app-container">
        <div className="status-bar"></div>

        {/* ========== HEADER ========== */}
        <header className="header">
          <div className="header-logo"><i className="fab fa-youtube"></i></div>
          <div className="header-info">
            <div className="header-title">
              Video Management
              <span className="connected-badge"><i className="fas fa-circle"></i> Connected</span>
            </div>
            <div className="header-sub">{channel?.name || "YouTube"} · {channel ? formatNumber(channel.subscribers) : "0"} subscribers</div>
          </div>
          <div className="header-right">
            {channel?.avatar && <img className="header-avatar" src={channel.avatar} alt={channel.name} loading="lazy" decoding="async" />}
          </div>
        </header>

        {/* ========== IN-PAGE TABS ========== */}
        <nav className="vtabs">
          <button className={`vtab ${activeTab === "library" ? "active" : ""}`} onClick={() => setActiveTab("library")}><i className="fas fa-video"></i>Library</button>
          <button className={`vtab ${activeTab === "series" ? "active" : ""}`} onClick={() => setActiveTab("series")}><i className="fas fa-list"></i>Series</button>
          <button className={`vtab ${activeTab === "live" ? "active" : ""}`} onClick={() => setActiveTab("live")}><i className="fas fa-tower-broadcast"></i>Live</button>
          <button className={`vtab ${activeTab === "settings" ? "active" : ""}`} onClick={() => setActiveTab("settings")}><i className="fas fa-gear"></i>Settings</button>
        </nav>

        {/* ========== SCROLLABLE CONTENT ========== */}
        <div className="content-scroll">

          {/* ===== TAB 1: LIBRARY ===== */}
          {activeTab === "library" && (
            <>
              <div className="sync-bar">
                <button className="sync-btn" onClick={handleSync} disabled={syncing}>
                  {syncing ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-rotate"></i>}
                  {" "}Sync Now
                </button>
                <span className="sync-status">{lastSynced ? `Last synced ` : ""}{lastSynced && <strong>{lastSynced}</strong>}</span>
              </div>

              <div className="search-bar">
                <div className="search-wrapper">
                  <i className="fas fa-search"></i>
                  <input type="text" placeholder="Search title, description..." value={videoSearch} onChange={(e) => setVideoSearch(e.target.value)} />
                </div>
              </div>

              <div className="filter-bar">
                <div className="filter-chips">
                  {["all", "published", "hidden", "featured"].map((f) => (
                    <button key={f} className={`filter-chip ${videoFilter === f ? "active" : ""}`} onClick={() => setVideoFilter(f)}>{f.charAt(0).toUpperCase() + f.slice(1)}</button>
                  ))}
                </div>
                <select className="sort-select" value={videoSort} onChange={(e) => setVideoSort(e.target.value)}>
                  <option value="newest">Newest</option>
                  <option value="oldest">Oldest</option>
                  <option value="views">Most Viewed</option>
                  <option value="alpha">Alphabetical</option>
                </select>
                <div className="view-toggle">
                  <button className={`view-btn ${viewMode === "grid" ? "active" : ""}`} onClick={() => setViewMode("grid")}><i className="fas fa-grid"></i></button>
                  <button className={`view-btn ${viewMode === "list" ? "active" : ""}`} onClick={() => setViewMode("list")}><i className="fas fa-list"></i></button>
                </div>
              </div>

              {videosLoading ? (
                <div style={{ padding: "0 16px" }}>
                  <div className="skeleton-loading skeleton-line w30 h20" style={{ marginBottom: 12 }}></div>
                  <div className="video-grid">
                    {[1,2,3,4].map((i) => (
                      <div key={i} className="skeleton-card">
                        <div className="skeleton-loading" style={{ width: "100%", aspectRatio: "16/9", borderRadius: 0 }}></div>
                        <div style={{ padding: "10px 12px 12px" }}>
                          <div className="skeleton-loading skeleton-line w80 h16" style={{ marginBottom: 8 }}></div>
                          <div className="skeleton-loading skeleton-line w40"></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  <div className="v-count">
                    <strong>{filteredVideos.length}</strong> video{filteredVideos.length !== 1 ? "s" : ""} shown
                    {lastDoc && <span style={{ color: "var(--text-tertiary)", fontWeight: 400, marginLeft: 6 }}>· scroll for more</span>}
                  </div>

                  {viewMode === "grid" ? (
                    <div className="video-grid">
                      {filteredVideos.map((v) => (
                        <div className="v-card" key={v.youtubeId} onClick={() => openEditVideo(v.youtubeId)}>
                          <div className="v-thumb">
                            <img src={v.thumbnail} alt={v.title} loading="lazy" decoding="async" />
                            <span className="v-duration">{v.duration}</span>
                            <div className="v-badges">
                              {v.isFeatured && <span className="v-badge featured">Featured</span>}
                              {v.isHidden && <span className="v-badge hidden">Hidden</span>}
                            </div>
                          </div>
                          <div className="v-body">
                            <div className="v-title">{v.title}</div>
                            <div className="v-meta">
                              <span className={`v-category ${v.category}`}>{categoryOptions.find((c) => c.value === v.category)?.label || v.category}</span>
                              {v.seriesId && <span className="v-series-tag"><i className="fas fa-list"></i> {seriesList.find((s) => s.id === v.seriesId)?.name}</span>}
                              <span>{formatNumber(v.views)} views</span>
                              <span>{v.publishedAt?.slice(0, 10)}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="video-list">
                      {filteredVideos.map((v) => (
                        <div className="v-list-item" key={v.youtubeId} onClick={() => openEditVideo(v.youtubeId)}>
                          <div className="v-list-thumb">
                            <img src={v.thumbnail} alt={v.title} loading="lazy" decoding="async" />
                            <span className="v-duration">{v.duration}</span>
                          </div>
                          <div className="v-list-info">
                            <div className="v-list-title">{v.title}</div>
                            <div className="v-list-meta">
                              <span className={`v-category ${v.category}`}>{categoryOptions.find((c) => c.value === v.category)?.label || v.category}</span>
                              {v.isFeatured && <span className="v-series-tag">Featured</span>}
                              {v.isHidden && <span className="v-series-tag" style={{ color: "var(--text-tertiary)" }}>Hidden</span>}
                              <span>{formatNumber(v.views)} views</span>
                              <span>{v.publishedAt?.slice(0, 10)}</span>
                            </div>
                          </div>
                          <button className="v-list-menu"><i className="fas fa-ellipsis-vertical"></i></button>
                        </div>
                      ))}
                    </div>
                  )}

                  {filteredVideos.length === 0 && (
                    <div style={{ textAlign: "center", padding: 40, color: "var(--text-tertiary)", fontSize: 14 }}>No videos match your search</div>
                  )}

                  {lastDoc && (
                    <div style={{ textAlign: "center", padding: "10px 0 20px" }}>
                      <button className="sync-btn" onClick={loadMore}>
                        <i className="fas fa-chevron-down"></i> Load More
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {/* ===== TAB 2: SERIES ===== */}
          {activeTab === "series" && (
            <div className="series-content">
              <div className="series-toolbar">
                <button className="series-create-btn" onClick={() => setShowCreateSeries(true)}><i className="fas fa-plus"></i> Create Series</button>
              </div>

              {showCreateSeries && (
                <div style={{ background: "var(--surface-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
                  <h4 style={{ fontSize: 16, fontWeight: 700 }}>New Series</h4>
                  <div className="form-group"><label>Name</label><input type="text" className="form-input" value={seriesForm.name} onChange={(e) => setSeriesForm({ ...seriesForm, name: e.target.value })} placeholder="e.g. Walking By Faith" /></div>
                  <div className="form-group"><label>Description</label><textarea className="form-textarea" value={seriesForm.description} onChange={(e) => setSeriesForm({ ...seriesForm, description: e.target.value })} placeholder="Describe this series..." /></div>
                  <div className="form-group"><label>Category</label><select className="form-select" value={seriesForm.category} onChange={(e) => setSeriesForm({ ...seriesForm, category: e.target.value })}>{seriesCategoryOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
                  <div className="toggle-row">
                    <div className="toggle-info"><div className="toggle-title">Public</div><div className="toggle-desc">Visible to listeners in the app</div></div>
                    <button className={`toggle-switch ${seriesForm.isPublic ? "active" : ""}`} onClick={() => setSeriesForm({ ...seriesForm, isPublic: !seriesForm.isPublic })}></button>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                    <button className="btn-primary" style={{ flex: "none", padding: "10px 20px", fontSize: 14 }} onClick={createSeriesHandler}>Create</button>
                    <button className="btn-secondary" style={{ flex: "none", padding: "10px 20px", fontSize: 14 }} onClick={() => setShowCreateSeries(false)}>Cancel</button>
                  </div>
                </div>
              )}

              <div className="series-count">{seriesList.length} series</div>

              {seriesLoading ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {[1,2].map((i) => (
                    <div key={i} className="skeleton-card" style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px" }}>
                      <div className="skeleton-loading" style={{ width: 56, height: 56, borderRadius: "var(--radius-sm)", flexShrink: 0 }}></div>
                      <div style={{ flex: 1 }}>
                        <div className="skeleton-loading skeleton-line w60 h18" style={{ marginBottom: 6 }}></div>
                        <div className="skeleton-loading skeleton-line w30"></div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : seriesList.length === 0 ? (
                <div className="series-empty"><i className="fas fa-list"></i><h3>No Series Yet</h3><p>Create your first series to organize videos</p></div>
              ) : (
                <div className="series-grid">
                  {seriesList.map((s) => {
                    const isOpen = openSeriesId === s.id;
                    const vidCount = s.videoIds.length;
                    const totalViews = s.videoIds.reduce((sum, vid) => { const v = videos.find((x) => x.youtubeId === vid); return sum + (v ? v.views : 0); }, 0);
                    return (
                      <div className={`series-card ${isOpen ? "expanded" : ""}`} key={s.id}>
                        <div className="series-card-header" onClick={() => openSeriesSafe(s.id)}>
                          <img className="series-cover" src={s.coverImage} alt={s.name} loading="lazy" decoding="async" />
                          <div className="series-info">
                            <div className="series-name">{s.name}</div>
                            <div className="series-meta">{vidCount} videos · from {s.createdAt}</div>
                          </div>
                          <span className="series-category-badge">{seriesCategoryOptions.find((o) => o.value === s.category)?.label || s.category}</span>
                          <button className="series-toggle danger" onClick={(e) => { e.stopPropagation(); deleteSeriesHandler(s.id!); }} style={{ fontSize: 12 }}><i className="fas fa-trash-can"></i></button>
                          <i className={`fas fa-chevron-down series-chevron ${isOpen ? "open" : ""}`}></i>
                        </div>

                        {isOpen && (
                          <div className="series-detail">
                            {s.description && <div className="series-desc">{s.description}</div>}
                            <div className="series-videos">
                              {openSeriesVideos(s.id!).length === 0 ? (
                                <div style={{ fontSize: 13, color: "var(--text-tertiary)", padding: 6 }}>No videos in this series</div>
                              ) : (
                                openSeriesVideos(s.id!).map((v) => v && (
                                  <div className="series-video-item" key={v.youtubeId}>
                                    <img className="series-video-thumb" src={v.thumbnail} alt={v.title} loading="lazy" decoding="async" />
                                    <span className="series-video-title">{v.title}</span>
                                    <button className="series-video-remove" onClick={() => removeVideoFromSeries(s.id!, v.youtubeId)}><i className="fas fa-xmark"></i></button>
                                  </div>
                                ))
                              )}
                              <button className="series-add-btn" onClick={() => { setOpenSeriesId(s.id!); setShowAddVideoPicker(true); }}>
                                <i className="fas fa-plus-circle"></i> Add Videos from Library
                              </button>
                            </div>
                            <div className="series-stats">
                              <span className="series-stat"><strong>{vidCount}</strong> videos</span>
                              <span className="series-stat"><strong>{formatNumber(totalViews)}</strong> total views</span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Add Video Picker Modal */}
              {showAddVideoPicker && (
                <>
                  <div className="modal-overlay active" onClick={() => setShowAddVideoPicker(false)}></div>
                  <div className="modal-sheet" style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 9001, margin: "0 auto" }}>
                    <div className="modal-handle"></div>
                    <div className="modal-header"><h2>Add Videos</h2></div>
                    <div className="modal-body">
                      {videos.length === 0 ? (
                        <div style={{ textAlign: "center", padding: 20, color: "var(--text-tertiary)", fontSize: 14 }}>No videos in library</div>
                      ) : (
                        videos.map((v) => {
                          const inSeries = openSeriesId ? seriesList.find((s) => s.id === openSeriesId)?.videoIds.includes(v.youtubeId) : false;
                          return (
                            <div className={`picker-item ${inSeries ? "disabled" : ""}`} key={v.youtubeId} onClick={() => { if (!inSeries) addVideoToSeries(v.youtubeId); }}>
                              <img className="picker-thumb" src={v.thumbnail} alt={v.title} loading="lazy" decoding="async" />
                              <div className="picker-info"><div className="picker-title">{v.title}</div></div>
                              {inSeries ? <i className="fas fa-check picker-icon done"></i> : <i className="fas fa-plus-circle picker-icon"></i>}
                            </div>
                          );
                        })
                      )}
                    </div>
                    <div className="modal-footer"><button className="btn-primary" onClick={() => setShowAddVideoPicker(false)}>Done</button></div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ===== TAB 3: LIVE ===== */}
          {activeTab === "live" && (
            <div className="live-content">
              <div className="live-not-active">
                <i className="fas fa-tower-broadcast"></i>
                <h3>Not Currently Live</h3>
                <p>YouTube Live streaming requires OAuth — coming soon</p>
              </div>

              <div className="toggle-row" style={{ padding: "10px 0", borderTop: "1px solid var(--border)" }}>
                <div className="toggle-info"><div className="toggle-title">Embed Live on App</div><div className="toggle-desc">Auto-push live stream to listener app homepage</div></div>
                <button className={`toggle-switch ${embedLive ? "active" : ""}`} onClick={() => setEmbedLive(!embedLive)}></button>
              </div>
            </div>
          )}

          {/* ===== TAB 4: SETTINGS ===== */}
          {activeTab === "settings" && (
            <div className="settings-content">
              {channel && (
                <div className="st-channel-card">
                  {channel.avatar && <img className="st-channel-avatar" src={channel.avatar} alt={channel.name} loading="lazy" decoding="async" />}
                  <div className="st-channel-info">
                    <div className="st-channel-name">{channel.name}</div>
                    <div className="st-channel-meta">{formatNumber(channel.subscribers)} subscribers · {channel.videoCount} videos</div>
                  </div>
                  <button className="st-channel-disconnect" onClick={() => showToast("Disconnected", "YouTube channel disconnected", "info", 2500)}>
                    Disconnect
                  </button>
                </div>
              )}

              <div>
                <div className="st-title" style={{ marginBottom: 10 }}>Auto-Sync</div>
                <div className="st-toggle-row">
                  <div className="st-toggle-info"><div className="st-toggle-label">Auto-Sync New Videos</div><div className="st-toggle-desc">Automatically check for new videos</div></div>
                  <button className={`toggle-switch ${autoSync ? "active" : ""}`} onClick={() => setAutoSync(!autoSync)}></button>
                </div>
                {autoSync && (
                  <div style={{ marginTop: 8 }}>
                    <div className="st-toggle-desc" style={{ marginBottom: 8 }}>Sync frequency</div>
                    <div className="st-freq-group">
                      {["1", "6", "12", "24"].map((f) => (
                        <button key={f} className={`st-freq-btn ${syncFreq === f ? "active" : ""}`} onClick={() => setSyncFreq(f)}>{f}h</button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div>
                <div className="st-title" style={{ marginBottom: 10 }}>Defaults</div>
                <div className="form-group">
                  <label>Default Visibility on Import</label>
                  <select className="form-select" value={defaultVisibility} onChange={(e) => setDefaultVisibility(e.target.value)}>
                    <option value="public">Public</option>
                    <option value="hidden">Hidden</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Default Category</label>
                  <select className="form-select" value={defaultCategory} onChange={(e) => setDefaultCategory(e.target.value)}>
                    {categoryOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Featured Videos Limit</label>
                  <input type="number" className="form-input" value={featuredLimit} onChange={(e) => setFeaturedLimit(parseInt(e.target.value) || 1)} min="1" max="10" />
                </div>
              </div>

              <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16, marginTop: 8 }}>
                <div className="st-title" style={{ marginBottom: 10, color: "var(--error)" }}>Danger Zone</div>
                <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 12, lineHeight: 1.5 }}>
                  This will permanently delete all videos, series, and channel data from the database. You can re-sync from YouTube afterward.
                </p>
                <button className="btn-danger" onClick={clearAllData} disabled={clearAllLoading} style={{ width: "100%", padding: 14, fontSize: 14, fontWeight: 700, borderRadius: 12, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                  {clearAllLoading ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-trash-can"></i>}
                  {clearAllLoading ? "Clearing..." : "Clear All YouTube Data"}
                </button>
              </div>
            </div>
          )}

          <div style={{ height: 80 }}></div>
        </div>

        {/* FAB (only on library) */}
        {activeTab === "library" && (
          <button className="fab" onClick={() => { setEditForm({ title: "", description: "", category: "sermon", seriesId: "", isFeatured: false, isHidden: false, tags: "" }); setShowEditModal(true); }}>
            <i className="fas fa-plus"></i>
          </button>
        )}

        <AdminBottomNav />
      </div>

      {/* ========== EDIT VIDEO MODAL ========== */}
      <div className={`modal-overlay ${showEditModal ? "active" : ""}`} onClick={() => setShowEditModal(false)}>
        <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
          <div className="modal-handle"></div>
          <div className="modal-header"><h2>{selectedVideoId ? "Edit Video" : "Add Video"}</h2></div>
          <div className="modal-body">
            <div className="form-group"><label>Title</label><input type="text" className="form-input" value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} placeholder="Video title" /></div>
            <div className="form-group"><label>Description</label><textarea className="form-textarea" value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} placeholder="Video description" /></div>
            <div className="form-group"><label>Category</label><select className="form-select" value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}>{categoryOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
            <div className="form-group"><label>Series</label><select className="form-select" value={editForm.seriesId} onChange={(e) => setEditForm({ ...editForm, seriesId: e.target.value })}><option value="">None (standalone video)</option>{seriesList.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
            <div className="form-group"><label>Tags (comma separated)</label><input type="text" className="form-input" value={editForm.tags} onChange={(e) => setEditForm({ ...editForm, tags: e.target.value })} placeholder="e.g. faith, sermon, pastor" /></div>
            <div className="toggle-row"><div className="toggle-info"><div className="toggle-title">Featured</div><div className="toggle-desc">Show on listener app homepage</div></div><button className={`toggle-switch ${editForm.isFeatured ? "active" : ""}`} onClick={() => setEditForm({ ...editForm, isFeatured: !editForm.isFeatured })}></button></div>
            <div className="toggle-row"><div className="toggle-info"><div className="toggle-title">Hidden</div><div className="toggle-desc">Hide from listener app</div></div><button className={`toggle-switch ${editForm.isHidden ? "active" : ""}`} onClick={() => setEditForm({ ...editForm, isHidden: !editForm.isHidden })}></button></div>
          </div>
          <div className="modal-footer">
            <button className="btn-secondary" onClick={() => setShowEditModal(false)}>Cancel</button>
            <button className="btn-primary" onClick={saveEditVideo}>{selectedVideoId ? "Save Changes" : "Add Video"}</button>
          </div>
          {selectedVideoId && <div className="modal-footer" style={{ borderTop: "none", paddingTop: 0 }}><button className="btn-danger" onClick={() => { setShowEditModal(false); setShowDeleteModal(true); }}><i className="fas fa-trash-can"></i> Delete Video</button></div>}
        </div>
      </div>

      {/* ========== DELETE MODAL ========== */}
      <div className={`modal-overlay ${showDeleteModal ? "active" : ""}`} onClick={() => setShowDeleteModal(false)}>
        <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
          <div className="modal-handle"></div>
          <div className="modal-header"><h2>Delete Video</h2></div>
          <div className="modal-body">
            <p style={{ textAlign: "center", color: "var(--text-secondary)", fontSize: 15, lineHeight: 1.6 }}>
              Are you sure you want to delete <strong style={{ color: "var(--text-primary)" }}>&quot;{editForm.title}&quot;</strong>? This action cannot be undone.
            </p>
          </div>
          <div className="modal-footer" style={{ flexDirection: "column" }}>
            <button className="btn-danger" onClick={deleteVideoHandler}>Delete Permanently</button>
            <button className="btn-secondary" onClick={() => setShowDeleteModal(false)}>Cancel</button>
          </div>
        </div>
      </div>
    </>
  );
}
