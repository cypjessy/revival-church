"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { signOut as firebaseSignOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useAppStore } from "@/lib/useAppStore";
import { getNowPlaying as azuracastGetNowPlaying, getSongHistory, getStationStatus, getQueue, toggleAutoDJ, getStreamers, deleteStreamer, getStationId } from "@/lib/azuracast";
import type { QueueItem, Streamer, Playlist } from "@/lib/azuracast";

import AlbumArt from "@/components/shared/AlbumArt";

import { useTvPlayer } from "@/lib/tv/TvPlayerProvider";
import { useFullscreenToggle } from "@/lib/tv/fullscreen";
import { getChannel, getVideos, getUserTvState, updateUserTvProgress, autoInitUserPlaylist } from "@/lib/youtube";
import type { YouTubeChannel, YouTubeVideo, UserTvState } from "@/lib/youtube";
import AdminBottomNav from "@/components/admin/AdminBottomNav";
import ToastBridge from "@/components/dashboard/ToastBridge";
import EventCarousel from "@/components/dashboard/EventCarousel";
import AlbumCarousel from "@/components/shared/AlbumCarousel";
import PremiumTopBar from "@/components/shared/PremiumTopBar";

/* ==================================================================
   MOCK DATA
   ================================================================== */

// churchInfo now comes from useAppStore churchConfig — see component body

// Radio state defaults — values replaced in real-time via AzuraCast polling
const DEFAULT_NP = {
  title: "Station Offline",
  artist: "",
  albumArt: "",
  elapsed: 0,
  duration: 0,
  source: "Offline" as const,
  playlist: "",
  nextUp: { title: "", artist: "" },
  isBackendRunning: false,
};

const DEFAULT_LISTENER_COUNT = 0;

const formatNumber = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K` : String(n);







const setupChecklistItems = [
  { id: "station", label: "Start your station", desc: "Turn on your radio station for the first time", completed: true },
  { id: "songs", label: "Upload your first songs", desc: "Add songs to your media library", completed: true },
  { id: "playlist", label: "Create a playlist", desc: "Organize songs into a broadcast playlist", completed: true },
  { id: "dj", label: "Add a DJ account", desc: "Create streamer accounts for live presenters", completed: false },
  { id: "golive", label: "Go live for the first time", desc: "Start your first live broadcast", completed: true },
  { id: "photos", label: "Upload your first photos", desc: "Add photos to the gallery", completed: false },
];

/* ==================================================================
   HELPERS
   ================================================================== */

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function timeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const secs = Math.floor(diffMs / 1000);
  if (secs < 10) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

/* ==================================================================
   COMPONENT
   ================================================================== */

export default function AdminPage() {
  const router = useRouter();
  const { toggleFullscreen } = useFullscreenToggle();
  const storeLogout = useAppStore((s) => s.logout);
  const storeChurchConfig = useAppStore((s) => s.churchConfig);
  const churchInfo = {
    name: storeChurchConfig?.name || "Church",
    tagline: storeChurchConfig?.tagline || "",
    logoInitials: (storeChurchConfig?.name || "CH").split(" ").map((w:string) => w[0]).join("").slice(0, 3).toUpperCase(),
  };
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);
  const [chartPeriod, setChartPeriod] = useState<string>("7days");
  const [showSetup, setShowSetup] = useState(false);

  /* Radio real-time state (polled from AzuraCast) */
  const [radioNP, setRadioNP] = useState<import("@/lib/azuracast").NowPlayingData | null>(null);
  const [radioHistory, setRadioHistory] = useState<import("@/lib/azuracast").SongHistoryItem[]>([]);
  const [radioSongsPlayedToday, setRadioSongsPlayedToday] = useState(0);
  const [radioBackendRunning, setRadioBackendRunning] = useState(false);
  const [radioPeakListeners, setRadioPeakListeners] = useState(0);
  const [radioListenerHistory, setRadioListenerHistory] = useState<number[]>([]);
  const [liveListeners, setLiveListeners] = useState(DEFAULT_LISTENER_COUNT);
  const [radioQueue, setRadioQueue] = useState<QueueItem[]>([]);
  const [autoDJToggling, setAutoDJToggling] = useState(false);
  const [liveStreamers, setLiveStreamers] = useState<Streamer[]>([]);
  const [streamDeletingId, setStreamDeletingId] = useState<string | null>(null);

  const [stationUptime, setStationUptime] = useState("");

  // ─── TV state (channel + videos + user playlist) ───
  const [tvChannel, setTvChannel] = useState<YouTubeChannel | null>(null);
  const [tvVideos, setTvVideos] = useState<YouTubeVideo[]>([]);
  const [tvLoading, setTvLoading] = useState(true);
  const tvPlayer = useTvPlayer();
  const [tvUserState, setTvUserState] = useState<UserTvState | null>(null);
  const [tvStartCountdown, setTvStartCountdown] = useState(20);
  const lastTvSeekRef = useRef(0);
  const lastTvIndexRef = useRef(0);

  const tvCurrentVideo = tvUserState && tvUserState.playlist.length > 0
    ? tvVideos.find((v) => v.id === tvUserState.playlist[tvUserState.currentIndex]) ?? null
    : null;

  // Register portal target via callback ref — fires on mount/unmount regardless
  // of conditional rendering timing. Works with the async-loaded div.
  const tvPlayerTargetRef = useCallback((el: HTMLDivElement | null) => {
    tvPlayer.registerTarget(el);
  }, [tvPlayer.registerTarget]);

  // Play current video when it changes to a different one (initial mount, advancement, page switches).
  // Does NOT watch seek — avoids re-firing when saveTvProgress updates state.
  // Guards against overriding an active live stream.
  useEffect(() => {
    if (tvPlayer.isLive) return;
    if (tvCurrentVideo && tvPlayer.currentVideoId !== tvCurrentVideo.id) {
      tvPlayer.play(tvCurrentVideo.id, tvUserState?.currentSeek || 0);
    }
  }, [tvCurrentVideo?.id, tvPlayer, tvPlayer.isLive]);

  // Track current seek and index via refs for periodic Firestore saves
  const handleTvTimeUpdate = useCallback((time: number) => {
    lastTvSeekRef.current = time;
  }, []);

  // Keep index ref in sync with state (used by saveTvProgress)
  useEffect(() => {
    if (tvUserState) {
      lastTvIndexRef.current = tvUserState.currentIndex;
    }
  }, [tvUserState?.currentIndex]);

  // Advance to next video when current ends
  const handleAdvanceToNext = useCallback(() => {
    if (!tvUserState || tvUserState.playlist.length === 0) return;
    // If on the last video, don't advance — playlist is complete
    if (tvUserState.currentIndex >= tvUserState.playlist.length - 1) return;
    const nextIndex = tvUserState.currentIndex + 1;
    const nextId = tvUserState.playlist[nextIndex];
    const uid = auth.currentUser?.uid;
    if (uid) updateUserTvProgress(uid, nextIndex, 0);
    setTvUserState((prev) => prev ? { ...prev, currentIndex: nextIndex, currentSeek: 0 } : prev);
    if (nextId) tvPlayer.play(nextId, 0);
  }, [tvUserState, tvPlayer]);

  // Keep callbacks in sync with latest versions
  useEffect(() => {
    tvPlayer.setCallbacks({
      onEnded: handleAdvanceToNext,
      onTimeUpdate: handleTvTimeUpdate,
    });
  }, [handleAdvanceToNext, handleTvTimeUpdate, tvPlayer]);

  /* Save current progress to Firestore and sync local state.
     setTvUserState is safe here because the interval effect has stable deps
     ([saveTvProgress]) — it does NOT restart on state changes. */
  const saveTvProgress = useCallback(() => {
    const uid = auth.currentUser?.uid;
    const seek = lastTvSeekRef.current;
    const index = lastTvIndexRef.current;
    if (uid) {
      updateUserTvProgress(uid, index, seek).catch(() => {});
      setTvUserState((prev) =>
        prev && (prev.currentIndex !== index || prev.currentSeek !== seek)
          ? { ...prev, currentIndex: index, currentSeek: seek }
          : prev
      );
    }
  }, []);

  /* Periodically save seek position (every 5s) — stable deps, never restarts mid-session */
  useEffect(() => {
    if (!auth.currentUser?.uid) return;
    const interval = setInterval(saveTvProgress, 5000);
    return () => clearInterval(interval);
  }, [saveTvProgress]);

  /* Save on page unload / tab hide */
  useEffect(() => {
    const handleUnload = () => saveTvProgress();
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") saveTvProgress();
    };
    window.addEventListener("beforeunload", handleUnload);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("beforeunload", handleUnload);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [saveTvProgress]);

  // ─── App resume — save on background, re-fetch on foreground (Android) ───
  useEffect(() => {
    let canceled = false;
    import("@capacitor/core")
      .then(({ Capacitor }) => {
        if (canceled || !Capacitor.isNativePlatform()) return;
        return import("@capacitor/app");
      })
      .then((AppModule) => {
        if (canceled || !AppModule) return;
        const { App } = AppModule;
        App.addListener("appStateChange", (state) => {
          if (!state.isActive) {
            saveTvProgress();
          } else {
            const uid = auth.currentUser?.uid;
            if (uid) {
              getUserTvState(uid).then((s) => setTvUserState(s));
            }
          }
        }).then((handler) => {
          if (canceled) handler.remove();
        });
      });
    return () => { canceled = true; };
  }, [saveTvProgress]);

  // Countdown timer on Start TV button (prevents premature clicks while video preloads)
  useEffect(() => {
    setTvStartCountdown(20);
    const t = setInterval(() => {
      setTvStartCountdown((prev) => {
        if (prev <= 1) { clearInterval(t); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, []);

  /* Start TV — always advances to the next video in the playlist.
     If no playlist exists yet, auto-initialises one and plays the first video.
     Progress is saved periodically by the 5s interval once the new video plays. */
  const handleStartTv = useCallback(async () => {
    if (!tvUserState || tvUserState.playlist.length === 0) {
      const uid = auth.currentUser?.uid;
      if (uid && tvVideos.length > 0) {
        const yt = await import("@/lib/youtube");
        const state = await yt.autoInitUserPlaylist(uid);
        setTvUserState(state);
        const firstId = state.playlist[state.currentIndex];
        if (firstId) tvPlayer.play(firstId, state.currentSeek || 0);
      } else {
        window.dispatchEvent(new CustomEvent("show-toast", {
          detail: { title: "No Videos", message: "No videos available to play. Sync videos from the admin panel.", type: "info", duration: 3000 }
        }));
      }
      return;
    }
    const nextIndex = (tvUserState.currentIndex + 1) % tvUserState.playlist.length;
    const nextId = tvUserState.playlist[nextIndex];
    const uid = auth.currentUser?.uid;
    if (uid) await updateUserTvProgress(uid, nextIndex, 0);
    setTvUserState((prev) => prev ? { ...prev, currentIndex: nextIndex, currentSeek: 0 } : prev);
    if (nextId) tvPlayer.play(nextId, 0);
  }, [tvUserState, tvVideos, tvPlayer]);

  // Fetch TV channel and videos on mount
  useEffect(() => {
    let mounted = true;
    const fetchTv = async () => {
      const uid = auth.currentUser?.uid;
      if (!uid) return;
      try {
        const [c, vids, state] = await Promise.all([
          getChannel().catch(() => null),
          getVideos({ max: 500, includeHidden: true }).catch<YouTubeVideo[]>(() => []),
          uid ? getUserTvState(uid) : Promise.resolve({ playlist: [], currentIndex: 0, currentSeek: 0, updatedAt: null }),
        ]);
        if (!mounted) return;
        if (c) setTvChannel(c);
        if (vids.length > 0) setTvVideos(vids);
        let finalState = state;
        if (state.playlist.length === 0 && vids.length > 0) {
          finalState = await autoInitUserPlaylist(uid);
        }
        setTvUserState(finalState);
      } catch {} finally {
        if (mounted) setTvLoading(false);
      }
    };
    fetchTv();
    return () => { mounted = false; };
  }, []);



  // Stat cards (YouTube sections removed)
  interface StatCard {
    id: string; color: string; icon: string; value: string; label: string;
    trend?: string; sparkline?: number[]; colorCode: string;
    subtitle?: string; progress?: number;
  }



  const nowPlaying = radioNP?.nowPlaying ? {
    title: radioNP.nowPlaying.song.title || "No track",
    artist: radioNP.nowPlaying.song.artist || "",
    albumArt: radioNP.nowPlaying.song.albumArt || "",
    elapsed: radioNP.nowPlaying.elapsed || 0,
    duration: radioNP.nowPlaying.duration || 0,
    source: radioBackendRunning ? "AutoDJ" as const : "Offline" as const,
    playlist: radioNP.nowPlaying.playlist || "",
    nextUp: radioHistory.length > 1 ? {
      title: radioHistory[1]?.song?.title || "Unknown",
      artist: radioHistory[1]?.song?.artist || "",
    } : { title: "No upcoming", artist: "" },
    isBackendRunning: radioBackendRunning,
  } : DEFAULT_NP;

  const liveWeeklyChart = radioListenerHistory.length > 0
    ? radioListenerHistory
    : [0, 2, 5, 8, 12, 20, 32];

  const statCards: StatCard[] = [
    {
      id: "listeners",
      color: "blue",
      icon: "fa-headphones",
      value: String(liveListeners),
      label: "Listening now",
      trend: radioHistory.length > 0 ? `↑ ${radioPeakListeners} peak today` : "Awaiting data",
      sparkline: [liveListeners > 5 ? Math.max(0, liveListeners - 5) : 1, Math.max(1, liveListeners - 3), liveListeners + 2, liveListeners + 5, liveListeners > 8 ? liveListeners - 2 : 1, liveListeners + 3, liveListeners],
      colorCode: "#3B82F6",
    },
    {
      id: "plays",
      color: "purple",
      icon: "fa-music",
      value: String(radioSongsPlayedToday || "..."),
      label: "Songs played today",
      subtitle: radioBackendRunning ? `AutoDJ ${radioHistory.length > 0 ? "· " + radioHistory[0]?.song?.title || "" : ""}` : "Station offline",
      colorCode: "#8B5CF6",
    },
  ];

  const dropdownRef = useRef<HTMLDivElement>(null);



  const handleLogout = async () => {
    setShowProfileDropdown(false);
    try {
      await firebaseSignOut(auth);
      storeLogout();
    } catch (_) {}
    router.push("/");
  };

  // Toggle AutoDJ on/off via the real API
  const handleToggleAutoDJ = useCallback(async () => {
    setAutoDJToggling(true);
    try {
      const result = await toggleAutoDJ();
      setRadioBackendRunning(result.running);
      window.dispatchEvent(new CustomEvent("show-toast", {
        detail: { title: result.running ? "AutoDJ Started" : "AutoDJ Stopped", message: result.running ? "AutoDJ is now running" : "AutoDJ has been stopped", type: "success", duration: 2500 },
      }));
    } catch (e) {
      window.dispatchEvent(new CustomEvent("show-toast", {
        detail: { title: "Toggle Failed", message: e instanceof Error ? e.message : "Could not toggle AutoDJ", type: "error", duration: 4000 },
      }));
    }
    setAutoDJToggling(false);
  }, []);

  // Delete a streamer via the real API
  const handleDeleteStreamer = useCallback(async (id: string, name: string) => {
    setStreamDeletingId(id);
    try {
      await deleteStreamer(id);
      setLiveStreamers((prev) => prev.filter((s) => s.id !== id));
      window.dispatchEvent(new CustomEvent("show-toast", {
        detail: { title: "Streamer Removed", message: `${name} has been removed`, type: "success", duration: 2500 },
      }));
    } catch (e) {
      window.dispatchEvent(new CustomEvent("show-toast", {
        detail: { title: "Delete Failed", message: e instanceof Error ? e.message : "Could not delete streamer", type: "error", duration: 4000 },
      }));
    }
    setStreamDeletingId(null);
  }, []);





  // Compute uptime from earliest song in history
  useEffect(() => {
    const update = () => {
      if (radioHistory.length > 0) {
        const firstPlayed = radioHistory[radioHistory.length - 1]?.playedAt;
        if (firstPlayed) {
          const diffMs = Date.now() - new Date(firstPlayed).getTime();
          const hrs = Math.floor(diffMs / 3600000);
          const mins = Math.floor((diffMs % 3600000) / 60000);
          setStationUptime(hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`);
        }
      }
    };
    const timer = setTimeout(update, 0);
    const interval = setInterval(update, 60000);
    return () => { clearTimeout(timer); clearInterval(interval); };
  }, [radioHistory]);



  // Poll AzuraCast every 10 seconds
  useEffect(() => {
    let mounted = true;
    const poll = async () => {
      try {
        const [np, history, status, queue] = await Promise.all([
          azuracastGetNowPlaying(getStationId()).catch(() => null),
          getSongHistory(50).catch<[]>(() => []),
          getStationStatus(getStationId()).catch(() => ({ backendRunning: false, frontendRunning: false })),
          getQueue().catch<QueueItem[]>(() => []),
        ]);
        if (!mounted) return;

        if (np) {
          setRadioNP(np);
          const lc = np.listeners.current ?? 0;
          setLiveListeners(lc);

          // Track peak listeners
          setRadioPeakListeners((prev) => Math.max(prev, lc));

          // Build listener history for chart (store last 24 points at 30min intervals)
          setRadioListenerHistory((prev) => {
            const next = [...prev, lc];
            return next.length > 48 ? next.slice(-48) : next;
          });

          setRadioBackendRunning(status?.backendRunning ?? false);
        }

        if (history && history.length > 0) {
          setRadioHistory(history);
        }

        setRadioQueue(queue && queue.length > 0 ? queue : []);

        // Fetch real streamers
        getStreamers().then((s) => {
          if (mounted) setLiveStreamers(s);
        }).catch(() => {});

        // Estimate songs played today from history (songs in last 24h)
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const todaySongs = history.filter((h: any) => {
          if (!h.playedAt) return false;
          const played = new Date(h.playedAt);
          return played >= today;
        });
        setRadioSongsPlayedToday(todaySongs.length || history.length);
      } catch {}
    };
    poll();
    const interval = setInterval(poll, 10000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  /* Show setup checklist initially (simulate first-time) */
  const [setupCompleted, setSetupCompleted] = useState<string[]>(
    setupChecklistItems.filter((i) => i.completed).map((i) => i.id)
  );

  const handleSetupDone = (id: string) => {
    setSetupCompleted((p) => (p.includes(id) ? p : [...p, id]));
  };

  /* Setup progress */
  const setupProgress = Math.round(
    (setupCompleted.length / setupChecklistItems.length) * 100
  );
  const allSetupDone = setupCompleted.length === setupChecklistItems.length;

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
            --error: #EF4444;
            --success: #22C55E;
            --info: #3B82F6;
            --warning: #F59E0B;
            --overlay: rgba(0,0,0,0.92);
            --gradient-start: #E8A838;
            --gradient-end: #D4762A;
            --gradient-purple: #8B5CF6;
            --gradient-blue: #3B82F6;
            --gradient-green: #22C55E;
            --shadow-soft: 0 4px 20px rgba(232,168,56,0.15);
            --shadow-elevated: 0 8px 32px rgba(0,0,0,0.45);
            --radius-sm: 12px;
            --radius-md: 16px;
            --radius-lg: 20px;
            --radius-xl: 24px;
            --radius-full: 50%;
        }

        * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; }
        html, body { height: 100%; overflow: hidden; background: var(--bg); color: var(--text-primary); }

        .app-container { height: 100%; display: flex; flex-direction: column; position: relative; overflow: hidden; }
        @media (min-width: 480px) { .app-container { max-width: 480px; margin: 0 auto; } }
        @media (min-width: 768px) {
            .stats-grid { grid-template-columns: repeat(4, 1fr); gap: 12px; padding: 16px 24px; }
            .dash-header { padding: 10px 24px; }
            .dash-grid { padding: 0 24px; gap: 20px; }
            .dash-nowplaying-strip { padding: 10px 24px; }
            .activity-filter { gap: 8px; }
            .chart-period-toggle { gap: 6px; }
            .widget-card { padding: 22px; }
        }
        @media (min-width: 1024px) {
            .stats-grid { grid-template-columns: repeat(4, 1fr); padding: 16px 32px; }
            .dash-header { padding: 12px 32px; }
            .dash-grid { padding: 0 32px; }
            .dash-nowplaying-strip { padding: 12px 32px; }
        }


        /* ========== SCROLLABLE CONTENT ========== */
        .content-scroll { flex: 1; overflow-y: auto; overflow-x: hidden; -webkit-overflow-scrolling: touch; padding-bottom: 80px; }
        .content-scroll::-webkit-scrollbar { display: none; }

        /* ========== HEADER ========== */
        .dash-header {
            padding: 8px 16px 10px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-shrink: 0;
            background: var(--bg);
            border-bottom: 1px solid var(--border);
            position: relative;
            z-index: 100;
        }
        .dash-header-left { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }
        .dash-header-logo { width: 36px; height: 36px; background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end)); border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 14px; font-weight: 800; color: #fff; }
        .dash-header-info { min-width: 0; }
        .dash-header-info h1 { font-size: 16px; font-weight: 800; letter-spacing: -0.3px; line-height: 1.2; }
        .dash-header-info .tagline { font-size: 11px; color: var(--text-tertiary); font-weight: 500; }

        .dash-header-center { display: flex; align-items: center; gap: 8px; padding: 0 10px; }
        .dash-onair-badge {
            display: flex; align-items: center; gap: 5px;
            padding: 4px 10px; border-radius: 20px;
            font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;
        }
        .dash-onair-badge.live {
            background: rgba(74,222,128,0.12); color: var(--success);
        }
        .dash-onair-badge.off {
            background: rgba(107,107,107,0.12); color: var(--text-tertiary);
        }
        .dash-onair-dot {
            width: 6px; height: 6px; border-radius: var(--radius-full);
        }
        .dash-onair-badge.live .dash-onair-dot {
            background: var(--success); animation: livePulse 1.5s ease-in-out infinite;
        }
        .dash-onair-badge.off .dash-onair-dot { background: var(--text-tertiary); }

        @keyframes livePulse { 0%,100% { opacity:1;transform:scale(1); } 50% { opacity:0.5;transform:scale(1.4); } }

        /* ===== LIVE BANNER ===== */
        .live-banner {
            padding: 12px 16px; display: flex; align-items: center; gap: 12px;
            background: linear-gradient(135deg, rgba(239,68,68,0.1), rgba(239,68,68,0.04));
            flex-shrink: 0;
        }
        .live-banner-left { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }
        .live-banner-dot {
            width: 10px; height: 10px; border-radius: var(--radius-full);
            background: var(--error); flex-shrink: 0;
            animation: livePulse 1.5s ease-in-out infinite;
            box-shadow: 0 0 8px rgba(239,68,68,0.4);
        }
        .live-banner-info { min-width: 0; }
        .live-banner-title { font-size: 13px; font-weight: 700; color: var(--error); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .live-banner-sub { font-size: 11px; color: var(--text-tertiary); margin-top: 1px; }
        .live-banner-btn {
            flex-shrink: 0; padding: 8px 16px; border-radius: 20px;
            background: var(--error); color: #fff; border: none;
            font-size: 12px; font-weight: 700; cursor: pointer;
            display: flex; align-items: center; gap: 6px;
            transition: all 0.15s ease;
        }
        .live-banner-btn:active { transform: scale(0.95); opacity: 0.9; }

        .dash-listener-count {
            display: flex; align-items: center; gap: 4px;
            font-size: 12px; font-weight: 600; color: var(--text-secondary);
            background: var(--surface); border-radius: 12px; padding: 4px 10px;
            border: 1px solid var(--border);
        }
        .dash-listener-count i { font-size: 12px; color: var(--primary); }

        .dash-header-right { position: relative; }
        .dash-avatar-btn {
            width: 36px; height: 36px; border-radius: var(--radius-full);
            background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end));
            border: 2px solid var(--surface-elevated); color: #fff;
            font-size: 13px; font-weight: 700; cursor: pointer;
            display: flex; align-items: center; justify-content: center;
            transition: all 0.2s ease;
        }
        .dash-avatar-btn:active { transform: scale(0.92); }

        .dash-dropdown {
            position: absolute; top: calc(100% + 8px); right: 0;
            background: var(--surface-elevated); border: 1px solid var(--border);
            border-radius: var(--radius-md); padding: 6px; min-width: 200px;
            z-index: 200; box-shadow: var(--shadow-elevated);
            animation: fadeSlideDown 0.2s ease;
        }
        @keyframes fadeSlideDown { from { opacity:0;transform:translateY(-8px); } to { opacity:1;transform:translateY(0); } }
        .dash-dropdown-item {
            display: flex; align-items: center; gap: 10px;
            padding: 10px 14px; border-radius: 10px;
            font-size: 13px; font-weight: 600; color: var(--text-secondary);
            cursor: pointer; transition: all 0.15s ease; border: none; background: none; width: 100%; text-align: left;
        }
        .dash-dropdown-item i { width: 18px; text-align: center; font-size: 14px; }
        .dash-dropdown-item:hover { background: var(--surface-hover); color: var(--text-primary); }
        .dash-dropdown-item.danger { color: var(--error); }
        .dash-dropdown-item.danger:hover { background: rgba(239,68,68,0.1); }

        /* ========== NOW PLAYING STRIP IN HEADER ========== */
        .dash-nowplaying-strip {
            display: flex; align-items: center; gap: 8px;
            padding: 8px 16px; background: var(--surface);
            border-bottom: 1px solid var(--border); flex-shrink: 0;
        }
        .dash-np-thumb {
            width: 36px; height: 36px; border-radius: 8px; flex-shrink: 0;
            background: var(--surface-elevated); object-fit: cover;
        }
        .dash-np-info { flex: 1; min-width: 0; }
        .dash-np-title { font-size: 13px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .dash-np-artist { font-size: 11px; color: var(--text-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .dash-np-badge { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; padding: 2px 8px; border-radius: 8px; background: rgba(232,168,56,0.12); color: var(--primary); flex-shrink: 0; }

        /* ========== STAT CARDS ========== */
        .stats-grid {
            display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;
            padding: 12px 16px;
        }
        .stat-card {
            background: var(--surface-card); border: 1px solid var(--border);
            border-radius: var(--radius-lg); padding: 16px; position: relative;
            overflow: hidden; cursor: pointer; transition: all 0.2s ease;
        }
        .stat-card:active { transform: scale(0.97); }
        .stat-card .accent-line {
            position: absolute; top: 0; left: 0; right: 0; height: 3px;
        }
        .stat-card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
        .stat-icon-bg {
            width: 34px; height: 34px; border-radius: 10px;
            display: flex; align-items: center; justify-content: center; font-size: 15px;
        }
        .stat-sparkline { height: 20px; margin-bottom: 6px; }
        .stat-value { font-size: 24px; font-weight: 800; letter-spacing: -0.5px; }
        .stat-label { font-size: 12px; color: var(--text-secondary); font-weight: 500; margin-top: 2px; }
        .stat-subtitle { font-size: 11px; color: var(--text-tertiary); margin-top: 2px; }
        .stat-trend {
            display: inline-flex; align-items: center; gap: 3px;
            font-size: 11px; font-weight: 600; margin-top: 6px;
            padding: 2px 8px; border-radius: 6px;
        }
        .stat-trend.up { background: rgba(34,197,94,0.12); color: var(--success); }
        .stat-trend.down { background: rgba(239,68,68,0.12); color: var(--error); }

        .storage-bar {
            width: 100%; height: 6px; border-radius: 3px;
            background: var(--surface-elevated); margin-top: 8px; overflow: hidden;
        }
        .storage-bar-fill { height: 100%; border-radius: 3px; transition: width 1s ease; }

        /* ========== SECTIONS LAYOUT ========== */
        .dash-grid {
            padding: 0 16px;
            display: flex; flex-direction: column; gap: 16px;
        }

        .dash-section { margin-bottom: 0; }

        .dash-section-title {
            font-size: 16px; font-weight: 700; margin-bottom: 12px;
            display: flex; align-items: center; justify-content: space-between;
        }
        .dash-section-title .see-all {
            font-size: 12px; color: var(--primary); font-weight: 600;
            background: none; border: none; cursor: pointer;
            display: flex; align-items: center; gap: 4px;
        }
        .dash-section-title .see-all:active { opacity: 0.7; }

        /* ========== WIDGET CARDS ========== */
        .widget-card {
            background: var(--surface-card); border: 1px solid var(--border);
            border-radius: var(--radius-lg); padding: 18px; margin-bottom: 14px;
        }
        .widget-card:last-child { margin-bottom: 0; }

        .widget-label {
            font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;
            color: var(--text-tertiary); margin-bottom: 8px;
        }

        /* ========== NOW PLAYING WIDGET ========== */
        .np-hero { display: flex; gap: 14px; margin-bottom: 14px; }
        .np-cover {
            width: 100px; height: 100px; border-radius: var(--radius-md); flex-shrink: 0;
            background: var(--surface-elevated); object-fit: cover;
        }
        .np-info { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; }
        .np-info .song { font-size: 17px; font-weight: 700; }
        .np-info .artist { font-size: 13px; color: var(--text-secondary); margin-top: 2px; }
        .np-info .source { font-size: 11px; color: var(--primary); font-weight: 600; margin-top: 4px; }
        .np-info .playlist { font-size: 11px; color: var(--text-tertiary); margin-top: 1px; }

        .np-progress { margin-bottom: 12px; }
        .np-progress-bar {
            width: 100%; height: 6px; border-radius: 3px;
            background: var(--surface-elevated); overflow: hidden; cursor: pointer;
        }
        .np-progress-fill {
            height: 100%; border-radius: 3px;
            background: linear-gradient(90deg, var(--gradient-start), var(--gradient-end));
            transition: width 0.5s ease; width: 37%;
        }
        .np-times { display: flex; justify-content: space-between; font-size: 11px; color: var(--text-tertiary); margin-top: 4px; font-weight: 500; }

        .np-next {
            padding: 10px 12px; background: var(--surface); border-radius: var(--radius-sm);
            border: 1px solid var(--border); display: flex; align-items: center; gap: 10px;
        }
        .np-next i { color: var(--text-tertiary); font-size: 12px; }
        .np-next-info { flex: 1; min-width: 0; }
        .np-next-label { font-size: 11px; color: var(--text-tertiary); font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px; }
        .np-next-title { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .np-next-artist { font-size: 11px; color: var(--text-secondary); }

        .np-actions { display: flex; gap: 10px; margin-top: 12px; }
        .np-btn {
            flex: 1; padding: 10px; border-radius: var(--radius-sm);
            font-size: 12px; font-weight: 700; border: none; cursor: pointer;
            display: flex; align-items: center; justify-content: center; gap: 6px;
            transition: all 0.2s ease;
        }
        .np-btn:active { transform: scale(0.96); }
        .np-btn.primary { background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end)); color: #fff; }
        .np-btn.secondary { background: var(--surface); color: var(--text-primary); border: 1px solid var(--border); }

        /* ========== QUICK STATS ========== */
        .quickstats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px; }
        .qs-item { }
        .qs-label { font-size: 11px; color: var(--text-tertiary); font-weight: 500; }
        .qs-value { font-size: 16px; font-weight: 700; margin-top: 2px; }

        .chart-bar-container {
            display: flex; align-items: flex-end; gap: 6px; height: 60px; padding-top: 4px;
        }
        .chart-bar {
            flex: 1; border-radius: 3px 3px 0 0;
            background: linear-gradient(180deg, var(--gradient-start), rgba(232,168,56,0.3));
            transition: height 0.5s ease; position: relative; min-height: 4px;
        }
        .chart-bar.today { background: linear-gradient(180deg, var(--gradient-blue), rgba(59,130,246,0.3)); }

        /* ========== TODAY AT A GLANCE ENHANCED ========== */
        .qs-item { position: relative; }
        .qs-sub { font-size:12px;font-weight:500;color:var(--text-tertiary);margin-left:4px; }
        .autodj-toggle {
          display:flex;align-items:center;justify-content:center;gap:6px;
          padding:6px 14px;border-radius:10px;border:none;font-size:13px;font-weight:700;
          cursor:pointer;transition:all 0.2s ease;width:100%;
        }
        .autodj-toggle:active { transform:scale(0.95); }
        .autodj-toggle[data-running="true"] { background:rgba(74,222,128,0.12);color:var(--success); }
        .autodj-toggle[data-running="false"] { background:var(--surface);color:var(--text-primary);border:1px solid var(--border); }
        .autodj-toggle:disabled { opacity:0.6;cursor:not-allowed;transform:none; }

        .glance-np { display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--surface);border-radius:var(--radius-sm);margin-bottom:10px;border:1px solid var(--border);transition:all 0.15s ease; }
        .glance-np:active { background:var(--surface-elevated);transform:scale(0.98); }
        .glance-np-cover { width:42px;height:42px;border-radius:8px;flex-shrink:0;object-fit:cover; }
        .glance-np-cover-fallback { display:flex;align-items:center;justify-content:center;background:var(--surface-elevated);color:var(--text-tertiary);font-size:16px; }
        .glance-np-info { flex:1;min-width:0; }
        .glance-np-label { font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-tertiary);margin-bottom:2px; }
        .glance-np-title { font-size:14px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
        .glance-np-artist { font-size:12px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
        .glance-np-source { flex-shrink:0; }
        .source-badge { font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.3px;padding:3px 8px;border-radius:8px; }
        .source-badge.auto { background:rgba(232,168,56,0.12);color:var(--primary); }
        .source-badge.off { background:rgba(107,107,107,0.12);color:var(--text-tertiary); }

        .glance-queue { margin-bottom:10px; }
        .glance-queue-label, .glance-recent-label { font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-tertiary);margin-bottom:6px;display:flex;align-items:center;gap:6px; }
        .glance-queue-list { display:flex;flex-direction:column;gap:4px; }
        .glance-queue-item { display:flex;align-items:center;gap:8px;padding:5px 8px;background:var(--surface);border-radius:6px;font-size:12px; }
        .glance-queue-pos { width:16px;height:16px;border-radius:4px;background:var(--surface-elevated);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:var(--text-secondary);flex-shrink:0; }
        .glance-queue-title { font-weight:600;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
        .glance-queue-artist { font-size:11px;color:var(--text-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
        .glance-queue-more { text-align:center;font-size:11px;color:var(--text-tertiary);padding:3px 0; }

        .glance-recent { margin-bottom:10px; }
        .glance-recent-list { display:flex;flex-direction:column;gap:4px; }
        .glance-recent-item { display:flex;align-items:center;gap:8px;padding:5px 8px;background:var(--surface);border-radius:6px; }
        .glance-recent-thumb { width:24px;height:24px;border-radius:4px;object-fit:cover;flex-shrink:0; }
        .glance-recent-thumb-fallback { display:flex;align-items:center;justify-content:center;background:var(--surface-elevated);color:var(--text-tertiary); }
        .glance-recent-info { flex:1;min-width:0; }
        .glance-recent-title { font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
        .glance-recent-artist { font-size:11px;color:var(--text-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
        .glance-recent-time { font-size:10px;color:var(--text-tertiary);flex-shrink:0; }

        .glance-chart-section { }
        .glance-chart-header { display:flex;align-items:center;justify-content:space-between;margin-bottom:6px; }
        .glance-chart-label { font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-tertiary); }

        .chart-empty { width:100%;text-align:center;color:var(--text-tertiary);font-size:12px;padding:20px 0; }

        .chart-period-toggle {
            display: flex; gap: 4px; margin-bottom: 10px;
        }
        .chart-period-btn {
            padding: 4px 12px; border-radius: 14px; font-size: 11px; font-weight: 600;
            background: var(--surface); border: 1px solid var(--border); color: var(--text-tertiary);
            cursor: pointer; transition: all 0.15s ease;
        }
        .chart-period-btn.active { background: rgba(232,168,56,0.12); border-color: var(--primary); color: var(--primary); }
        .chart-period-btn:active { transform: scale(0.95); }

        /* ========== ACTIVITY FEED ========== */
        .activity-filter {
            display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px;
        }
        .af-btn {
            padding: 4px 12px; border-radius: 14px; font-size: 11px; font-weight: 600;
            background: var(--surface); border: 1px solid var(--border); color: var(--text-tertiary);
            cursor: pointer; transition: all 0.15s ease;
        }
        .af-btn.active { background: rgba(59,130,246,0.12); border-color: var(--info); color: var(--info); }
        .af-btn:active { transform: scale(0.95); }

        .activity-item {
            display: flex; align-items: flex-start; gap: 10px;
            padding: 10px 0; border-bottom: 1px solid var(--border);
        }
        .activity-item:last-child { border-bottom: none; }
        .activity-icon {
            width: 32px; height: 32px; border-radius: 9px; flex-shrink: 0;
            display: flex; align-items: center; justify-content: center; font-size: 13px;
            margin-top: 2px;
        }
        .activity-icon-wrap { flex-shrink: 0; margin-top: 2px; }
        .act-thumb { width: 32px; height: 32px; border-radius: 9px; object-fit: cover; }
        .act-count {
          margin-left: auto; font-size: 10px; font-weight: 700; text-transform: none; letter-spacing: 0;
          background: rgba(232,168,56,0.12); color: var(--primary);
          padding: 1px 8px; border-radius: 10px;
        }
        .act-empty {
          text-align: center; padding: 20px 0;
          display: flex; flex-direction: column; align-items: center; gap: 2px;
        }
        .act-empty p { font-size: 13px; color: var(--text-secondary); }
        .activity-icon.gold { background: rgba(232,168,56,0.12); color: var(--primary); }
        .activity-icon.green { background: rgba(34,197,94,0.12); color: var(--success); }
        .activity-icon.blue { background: rgba(59,130,246,0.12); color: var(--info); }
        .activity-icon.purple { background: rgba(139,92,246,0.12); color: var(--gradient-purple); }
        .activity-icon.red { background: rgba(239,68,68,0.12); color: var(--error); }
        .activity-text { flex: 1; min-width: 0; font-size: 13px; font-weight: 500; line-height: 1.4; }
        .activity-time { font-size: 11px; color: var(--text-tertiary); flex-shrink: 0; margin-top: 1px; }

        .load-more-btn {
            width: 100%; padding: 12px; border-radius: var(--radius-sm);
            background: var(--surface); border: 1px solid var(--border);
            color: var(--primary); font-size: 13px; font-weight: 600;
            cursor: pointer; margin-top: 8px; transition: all 0.2s ease;
        }
        .load-more-btn:active { background: var(--surface-elevated); transform: scale(0.97); }

        /* ========== SCHEDULE ========== */
        .schedule-timeline { }
        .schedule-slot {
            display: flex; align-items: center; gap: 12px;
            padding: 10px 0; border-bottom: 1px solid var(--border);
        }
        .schedule-slot:last-child { border-bottom: none; }
        .schedule-time {
            width: 44px; flex-shrink: 0;
            font-size: 12px; font-weight: 700; color: var(--text-secondary);
        }
        .schedule-time.now { color: var(--primary); }
        .schedule-dot {
            width: 12px; height: 12px; border-radius: var(--radius-full); flex-shrink: 0;
            border: 2px solid;
        }
        .schedule-dot.active { border-color: var(--success); background: var(--success); animation: livePulse 1.5s ease-in-out infinite; }
        .schedule-dot.upcoming { border-color: var(--text-tertiary); }
        .schedule-dot.warning { border-color: var(--error); background: rgba(239,68,68,0.2); }
        .schedule-info { flex: 1; min-width: 0; }
        .schedule-label { font-size: 13px; font-weight: 600; }
        .schedule-label.warning { color: var(--error); }
        .schedule-source {
            font-size: 11px; color: var(--text-tertiary); margin-top: 2px;
        }
        .schedule-badge {
            font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px;
            padding: 3px 8px; border-radius: 8px;
        }
        .schedule-badge.now { background: rgba(74,222,128,0.12); color: var(--success); }
        .schedule-badge.empty { background: rgba(239,68,68,0.12); color: var(--error); }

        /* ========== RIGHT COLUMN WIDGETS ========== */
        .swidget {
            background: var(--surface-card); border: 1px solid var(--border);
            border-radius: var(--radius-lg); padding: 16px; margin-bottom: 12px;
        }
        .swidget:last-child { margin-bottom: 0; }
        .swidget-header {
            display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;
        }
        .swidget-title {
            font-size: 14px; font-weight: 700; display: flex; align-items: center; gap: 8px;
        }
        .swidget-title i { font-size: 14px; color: var(--primary); }
        .swidget-badge {
            font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px;
            padding: 3px 8px; border-radius: 8px;
        }
        .swidget-badge.green { background: rgba(74,222,128,0.12); color: var(--success); }
        .swidget-badge.red { background: rgba(239,68,68,0.12); color: var(--error); }

        /* Station Status */
        .status-row {
            display: flex; align-items: center; justify-content: space-between;
            padding: 8px 0; border-bottom: 1px solid var(--border);
        }
        .status-row:last-child { border-bottom: none; }
        .status-name { font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
        .status-dot { width: 8px; height: 8px; border-radius: var(--radius-full); }
        .status-dot.on { background: var(--success); }
        .status-dot.off { background: var(--error); }
        .status-action {
            font-size: 11px; font-weight: 600; color: var(--primary);
            background: none; border: none; cursor: pointer; padding: 4px 8px; border-radius: 6px;
        }
        .status-action:active { background: rgba(232,168,56,0.1); }

        .status-uptime { font-size: 12px; color: var(--text-tertiary); margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border); }

        .mount-url {
            margin-top: 8px; padding: 8px 10px; background: var(--surface);
            border: 1px solid var(--border); border-radius: 8px;
            display: flex; align-items: center; gap: 8px;
        }
        .mount-url code { font-size: 11px; color: var(--text-secondary); flex: 1; word-break: break-all; font-family: monospace; }
        .mount-url .copy-btn {
            background: none; border: none; color: var(--primary); cursor: pointer; font-size: 14px; padding: 2px;
        }

        .status-actions { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
        .stat-btn {
            padding: 7px 14px; border-radius: 8px; font-size: 11px; font-weight: 600;
            border: none; cursor: pointer; transition: all 0.15s ease;
        }
        .stat-btn:active { transform: scale(0.95); }
        .stat-btn.start { background: var(--success); color: #fff; }
        .stat-btn.stop { background: rgba(239,68,68,0.15); color: var(--error); border: 1px solid rgba(239,68,68,0.2); }
        .stat-btn.restart { background: var(--surface); color: var(--text-primary); border: 1px solid var(--border); }

        /* Active DJs */
        .dj-item {
            display: flex; align-items: center; gap: 10px;
            padding: 8px 0; border-bottom: 1px solid var(--border);
        }
        .dj-item:last-child { border-bottom: none; }
        .dj-avatar {
            width: 34px; height: 34px; border-radius: var(--radius-full);
            background: linear-gradient(135deg, var(--surface-elevated), var(--surface-hover));
            display: flex; align-items: center; justify-content: center;
            font-size: 12px; font-weight: 700; flex-shrink: 0;
            position: relative;
        }
        .dj-avatar .live-ring {
            position: absolute; inset: -2px; border-radius: var(--radius-full);
            border: 2px solid var(--success); animation: livePulse 1.5s ease-in-out infinite;
        }
        .dj-info { flex: 1; min-width: 0; }
        .dj-name { font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 6px; }
        .dj-name .live-badge { font-size: 9px; font-weight: 700; text-transform: uppercase; padding: 1px 6px; border-radius: 6px; background: rgba(74,222,128,0.15); color: var(--success); }
        .dj-username { font-size: 11px; color: var(--text-tertiary); }
        .dj-last { font-size: 11px; color: var(--text-tertiary); flex-shrink: 0; }
        .dj-actions { display: flex; gap: 4px; flex-shrink: 0; }
        .dj-action-btn {
            width: 28px; height: 28px; border-radius: 8px; border: none;
            background: var(--surface); color: var(--text-tertiary);
            font-size: 11px; cursor: pointer; transition: all 0.15s ease;
            display: flex; align-items: center; justify-content: center;
        }
        .dj-action-btn:active { background: var(--surface-elevated); color: var(--text-secondary); }
        .dj-action-btn.danger:active { color: var(--error); background: rgba(239,68,68,0.1); }

        .add-dj-btn {
            width: 100%; padding: 8px; border-radius: 8px; margin-top: 8px;
            background: var(--surface); border: 1px dashed var(--border);
            color: var(--text-secondary); font-size: 12px; font-weight: 600;
            cursor: pointer; transition: all 0.15s ease;
        }
        .add-dj-btn:active { background: var(--surface-elevated); color: var(--text-primary); }

        .view-all-link {
            display: block; text-align: center; font-size: 12px; color: var(--primary);
            font-weight: 600; margin-top: 8px; text-decoration: none;
        }

        /* YouTube Live Widget */
        .yt-header { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
        .yt-avatar {
            width: 38px; height: 38px; border-radius: var(--radius-full);
            background: var(--surface-elevated); display: flex;
            align-items: center; justify-content: center; font-size: 14px; font-weight: 700;
        }
        .yt-info { flex: 1; }
        .yt-info .name { font-size: 13px; font-weight: 700; }
        .yt-info .sub { font-size: 11px; color: var(--text-tertiary); }

        .yt-live-card {
            background: rgba(239,68,68,0.06); border: 1px solid rgba(239,68,68,0.15);
            border-radius: var(--radius-sm); padding: 12px;
            display: flex; align-items: center; gap: 10px;
        }
        .yt-live-dot {
            width: 10px; height: 10px; border-radius: var(--radius-full);
            background: #EF4444; animation: livePulse 1.5s ease-in-out infinite;
            flex-shrink: 0;
        }
        .yt-live-info { flex: 1; }
        .yt-live-title { font-size: 13px; font-weight: 600; }
        .yt-live-meta { font-size: 11px; color: var(--text-tertiary); margin-top: 2px; }

        .yt-not-live {
            padding: 10px 0; text-align: center;
        }
        .yt-not-live p { font-size: 13px; color: var(--text-secondary); }
        .yt-not-live .next { font-size: 11px; color: var(--text-tertiary); margin-top: 4px; }

        .yt-sync-row {
            display: flex; align-items: center; justify-content: space-between;
            margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border);
            font-size: 12px; color: var(--text-tertiary);
        }
        .yt-sync-row .sync-btn {
            background: none; border: none; color: var(--primary); font-size: 12px; font-weight: 600;
            cursor: pointer; display: flex; align-items: center; gap: 4px;
        }

        /* Content Summary */
        .cs-row {
            display: flex; align-items: center; gap: 10px;
            padding: 8px 0; border-bottom: 1px solid var(--border);
            cursor: pointer; transition: all 0.15s ease;
        }
        .cs-row:last-child { border-bottom: none; }
        .cs-row:active { opacity: 0.6; }
        .cs-icon {
            width: 32px; height: 32px; border-radius: 8px; flex-shrink: 0;
            display: flex; align-items: center; justify-content: center; font-size: 14px;
        }
        .cs-icon.blue { background: rgba(59,130,246,0.12); color: var(--info); }
        .cs-icon.gold { background: rgba(232,168,56,0.12); color: var(--primary); }
        .cs-icon.purple { background: rgba(139,92,246,0.12); color: var(--gradient-purple); }
        .cs-info { flex: 1; min-width: 0; display: flex; align-items: center; justify-content: space-between; }
        .cs-label { font-size: 13px; font-weight: 600; }
        .cs-detail { font-size: 11px; color: var(--text-tertiary); }

        .cs-warning {
            display: inline-flex; align-items: center; gap: 4px;
            padding: 2px 6px; border-radius: 6px;
            font-size: 10px; font-weight: 600;
            background: rgba(239,68,68,0.1); color: var(--error);
        }

        /* Storage Breakdown */
        .donut-container {
            display: flex; align-items: center; gap: 16px; margin-bottom: 10px;
        }
        .donut-svg { width: 80px; height: 80px; flex-shrink: 0; }
        .donut-legend { flex: 1; display: flex; flex-direction: column; gap: 6px; }
        .legend-item {
            display: flex; align-items: center; gap: 8px; font-size: 12px;
        }
        .legend-color {
            width: 10px; height: 10px; border-radius: 3px; flex-shrink: 0;
        }
        .legend-label { flex: 1; color: var(--text-secondary); }
        .legend-size { font-weight: 600; }

        .storage-total {
            text-align: center; padding-top: 10px; border-top: 1px solid var(--border);
            font-size: 13px; color: var(--text-secondary);
        }
        .storage-total strong { color: var(--text-primary); }

        .manage-link {
            display: block; text-align: center; font-size: 12px; color: var(--primary);
            font-weight: 600; margin-top: 6px; text-decoration: none;
        }



        /* ========== SETUP CHECKLIST ========== */
        .setup-overlay {
            position: fixed; inset: 0; background: rgba(0,0,0,0.94);
            z-index: 500; display: flex; flex-direction: column;
            align-items: center; justify-content: center; padding: 24px;
        }
        .setup-card {
            max-width: 380px; width: 100%;
            background: var(--surface-card); border: 1px solid var(--border);
            border-radius: var(--radius-xl); padding: 28px 24px;
        }
        .setup-welcome { text-align: center; margin-bottom: 20px; }
        .setup-welcome h2 { font-size: 22px; font-weight: 800; }
        .setup-welcome p { font-size: 14px; color: var(--text-secondary); margin-top: 6px; line-height: 1.5; }
        .setup-progress {
            width: 100%; height: 6px; border-radius: 3px;
            background: var(--surface-elevated); margin-bottom: 8px; overflow: hidden;
        }
        .setup-progress-fill {
            height: 100%; border-radius: 3px;
            background: linear-gradient(90deg, var(--gradient-start), var(--gradient-end));
            transition: width 0.5s ease;
        }
        .setup-progress-text {
            font-size: 12px; color: var(--text-secondary); margin-bottom: 18px; text-align: center;
        }
        .setup-item {
            display: flex; align-items: center; gap: 12px;
            padding: 12px 14px; border-radius: var(--radius-sm);
            margin-bottom: 6px; transition: all 0.2s ease;
        }
        .setup-item.done { opacity: 0.5; }
        .setup-item:not(.done) { background: var(--surface); border: 1px solid var(--border); cursor: pointer; }
        .setup-item:not(.done):active { background: var(--surface-elevated); transform: scale(0.98); }
        .setup-check {
            width: 26px; height: 26px; border-radius: var(--radius-full);
            border: 2px solid var(--border); display: flex;
            align-items: center; justify-content: center; flex-shrink: 0;
            font-size: 12px; color: transparent; transition: all 0.3s ease;
        }
        .setup-item.done .setup-check { background: var(--success); border-color: var(--success); color: #fff; }
        .setup-info { flex: 1; }
        .setup-info h4 { font-size: 14px; font-weight: 600; }
        .setup-info p { font-size: 12px; color: var(--text-tertiary); margin-top: 2px; }
        .setup-dismiss {
            width: 100%; padding: 14px; border-radius: var(--radius-md);
            background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end));
            border: none; color: #fff; font-size: 15px; font-weight: 700;
            cursor: pointer; margin-top: 18px; transition: all 0.2s ease;
        }
        .setup-dismiss:active { transform: scale(0.97); }

        /* ========== BOTTOM NAV ========== */
        .bottom-nav {
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            background: rgba(15,15,15,0.92);
            backdrop-filter: blur(20px) saturate(180%);
            -webkit-backdrop-filter: blur(20px) saturate(180%);
            border-top: 1px solid var(--border);
            padding: 8px 0 calc(8px + env(safe-area-inset-bottom, 0px));
            z-index: 900;
            display: flex;
            justify-content: space-around;
            align-items: center;
        }
        @media (min-width: 480px) {
            .bottom-nav { max-width: 480px; margin: 0 auto; }
        }
        @media (min-width: 768px) {
            .bottom-nav { left: 72px; max-width: calc(100% - 72px); }
        }
        .nav-item {
            display: flex; flex-direction: column; align-items: center; gap: 4px;
            padding: 6px 12px; background: none; border: none;
            color: var(--text-tertiary); cursor: pointer;
            transition: all 0.2s ease; position: relative;
        }
        .nav-item.active { color: var(--primary); }
        .nav-item i { font-size: 20px; transition: transform 0.2s ease; }
        .nav-item:active i { transform: scale(0.85); }
        .nav-item span { font-size: 10px; font-weight: 600; }
        .nav-item .nav-badge { position: absolute; top: 2px; right: 6px; width: 8px; height: 8px; background: var(--error); border-radius: var(--radius-full); border: 2px solid var(--bg); }


        /* ========== ANIMATIONS ========== */
        @keyframes fadeIn { from { opacity:0; } to { opacity:1; } }

        .toast-container { position: fixed; top: env(safe-area-inset-top, 12px); left: 16px; right: 16px; z-index: 10001; display: flex; flex-direction: column; gap: 8px; pointer-events: none; }
        .toast { background: var(--surface-elevated); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 14px 18px; display: flex; align-items: center; gap: 12px; box-shadow: var(--shadow-elevated); transform: translateY(-20px); opacity: 0; transition: all 0.35s cubic-bezier(0.32, 0.72, 0, 1); pointer-events: auto; }
        .toast.show { transform: translateY(0); opacity: 1; }
        .toast-icon { width: 32px; height: 32px; border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .toast-icon.success { background: rgba(74,222,128,0.15); color: var(--success); }
        .toast-icon.error { background: rgba(255,107,107,0.15); color: var(--error); }
        .toast-icon.info { background: rgba(232,168,56,0.15); color: var(--primary); }
        .toast-content { flex: 1; }
        .toast-content .title { font-size: 14px; font-weight: 600; }
        .toast-content .message { font-size: 13px; color: var(--text-secondary); margin-top: 2px; }

        /* ===== TV WRAP (edge-to-edge like member dashboard) ===== */
        .tv-top-wrap {
          margin: 0 calc(-1 * var(--section-px, 16px));
        }
        .tv-top {
          display: flex; align-items: center; justify-content: space-between;
          padding: 8px 14px;
        }
        .tv-station {
          display: flex; align-items: center; gap: 8px;
          font-size: 13px; font-weight: 700;
        }
        .tv-station i { color: #3B82F6; font-size: 14px; }
        .tv-badges { display: flex; align-items: center; gap: 8px; }
        .tv-live-badge {
          display: flex; align-items: center; gap: 5px;
          padding: 4px 10px; border-radius: 20px;
          font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;
          transition: all 0.3s ease;
        }
        .tv-live-badge.live { background: rgba(59,130,246,0.12); color: #3B82F6; }
        .tv-live-badge.off { background: rgba(107,107,107,0.12); color: var(--text-tertiary); }
        .tv-live-dot { width: 6px; height: 6px; border-radius: 50%; }
        .tv-live-badge.live .tv-live-dot { background: #3B82F6; animation: livePulse 1.5s ease-in-out infinite; }
        .tv-live-badge.off .tv-live-dot { background: var(--text-tertiary); }
        .tv-sub-badge {
          display: flex; align-items: center; gap: 4px;
          padding: 4px 10px; border-radius: 20px;
          background: var(--surface); border: 1px solid var(--border);
          font-size: 11px; font-weight: 600; color: var(--text-secondary);
        }
        .tv-sub-badge i { font-size: 10px; color: #3B82F6; }

        .tv-player-container {
          position: relative;
          width: 100%;
          aspect-ratio: 16 / 9;
          background: #000;
          overflow: hidden;
          z-index: 1;
        }
        .tv-player-container .plyr { width: 100%; height: 100%; }
        .tv-player-container .plyr__video-wrapper { height: 100%; }
        .tv-player-container .plyr__video-embed { aspect-ratio: auto !important; }
        .tv-player-container .plyr__video-embed,
        .tv-player-container iframe { width: 100% !important; height: 100% !important; }
        .tv-player-container .plyr__video-embed iframe { transform: scale(1.03); }
        @media (max-width: 480px) {
          .tv-player-container .plyr__controls { padding: 6px 4px !important; }
          .tv-player-container .plyr__control { padding: 8px 6px !important; min-width: 36px; min-height: 36px; }
          .tv-player-container .plyr__control svg { width: 18px; height: 18px; }
          .tv-player-container .plyr__time { font-size: 11px; }
          .tv-player-container { min-height: 240px; }
        }

        .tv-overlay {
          position: absolute;
          bottom: 0; left: 0; right: 0;
          padding: 10px 14px;
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 8px;
          background: linear-gradient(0deg, rgba(0,0,0,0.8) 0%, transparent 100%);
          pointer-events: none;
        }
        .tv-overlay > * { pointer-events: auto; }
        .tv-overlay-info { flex: 1; min-width: 0; }
        .tv-overlay-now {
          font-size: 10px;
          color: #3B82F6;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          display: flex; align-items: center; gap: 4px;
          margin-bottom: 2px;
        }
        .tv-overlay-now i { font-size: 9px; }
        .tv-overlay-title {
          font-size: 13px;
          font-weight: 600;
          color: #fff;
          text-shadow: 0 1px 4px rgba(0,0,0,0.5);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .tv-expand-btn {
          width: 44px; height: 44px; border-radius: 12px;
          background: rgba(255,255,255,0.12);
          border: 1px solid rgba(255,255,255,0.12);
          color: rgba(255,255,255,0.9);
          font-size: 18px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          transition: all 0.2s;
          backdrop-filter: blur(4px);
        }
        .tv-expand-btn:active { background: rgba(255,255,255,0.2); transform: scale(0.9); }

        .tv-no-video {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 32px;
          border-radius: var(--radius-md);
          background: var(--surface-card);
          border: 1px dashed var(--border);
          color: var(--text-tertiary);
          font-size: 13px;
          margin-bottom: 10px;
          z-index: 1;
          position: relative;
        }
        .tv-no-video i { font-size: 28px; opacity: 0.4; }

        .tv-channel-strip {
          display: flex; align-items: center; gap: 12px;
          padding: 10px 12px;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          position: relative;
          z-index: 1;
        }
        .tv-channel-avatar {
          width: 36px; height: 36px; border-radius: 50%;
          overflow: hidden; flex-shrink: 0;
          background: var(--surface-elevated);
          display: flex; align-items: center; justify-content: center;
          position: relative;
        }
        .tv-channel-avatar img { width: 100%; height: 100%; object-fit: cover; }
        .tv-channel-avatar i { font-size: 16px; color: #FF0000; }
        .tv-avatar-img { position: absolute; inset: 0; border-radius: 50%; }
        .tv-channel-info { flex: 1; min-width: 0; }
        .tv-channel-name { font-size: 13px; font-weight: 700; }
        .tv-channel-meta { font-size: 11px; color: var(--text-tertiary); margin-top: 1px; }
        .tv-watch-btn {
          flex-shrink: 0;
          padding: 7px 14px;
          border-radius: 8px;
          background: linear-gradient(135deg, #3B82F6, #6366F1);
          border: none;
          color: #fff;
          font-size: 11px;
          font-weight: 700;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 5px;
          transition: all 0.2s;
        }
        .tv-watch-btn:active { transform: scale(0.95); }

        .tv-start-btn {
          display: flex; align-items: center; justify-content: center; gap: 8px;
          width: calc(100% - 32px); padding: 14px;
          margin: 8px 16px 0;
          border-radius: var(--radius-md);
          background: linear-gradient(135deg, #3B82F6, #6366F1);
          border: none; color: #fff;
          font-size: 14px; font-weight: 700;
          cursor: pointer; transition: all 0.2s ease;
          position: relative; z-index: 1;
        }
        .tv-start-btn:active { transform: scale(0.97); }
        .tv-start-btn:disabled { opacity: 0.55; cursor: not-allowed; transform: none; }
        .tv-start-btn i { font-size: 13px; }
        .tv-start-hint { font-size: 12px; color: var(--text-secondary); text-align: center; padding: 6px 16px 0; font-weight: 500; }
        .tv-next-slot {
          display: flex; align-items: center; gap: 6px;
          padding: 8px 12px;
          margin: 6px 16px 0;
          font-size: 11px; color: var(--text-tertiary);
          background: var(--surface);
          border-radius: var(--radius-sm);
          border: 1px solid var(--border);
          position: relative; z-index: 1;
        }
        .tv-next-slot i { color: #3B82F6; font-size: 10px; }

                /* ===== PREMIUM RADIO CARD (compact) ===== */
        .rh-hero {
            position: relative;
            background: linear-gradient(180deg, rgba(232,168,56,0.06) 0%, rgba(15,15,15,0.5) 100%);
            border: 1px solid rgba(232,168,56,0.12);
            border-radius: var(--radius-xl);
            padding: 14px 16px 12px;
            overflow: hidden;
            box-shadow: 0 8px 40px rgba(0,0,0,0.4), 0 0 80px rgba(232,168,56,0.04);
        }
        .rh-glow-1 {
            position: absolute; top: -80px; left: 50%; transform: translateX(-50%);
            width: 300px; height: 300px;
            background: radial-gradient(circle, rgba(232,168,56,0.12) 0%, transparent 70%);
            pointer-events: none;
        }
        .rh-glow-2 {
            position: absolute; bottom: -60px; right: -60px;
            width: 200px; height: 200px;
            background: radial-gradient(circle, rgba(212,118,42,0.06) 0%, transparent 70%);
            pointer-events: none;
        }
        .rh-top {
            display: flex; align-items: center; justify-content: space-between;
            margin-bottom: 10px; position: relative; z-index: 1;
        }
        .rh-station {
            display: flex; align-items: center; gap: 6px;
            font-size: 12px; font-weight: 700;
        }
        .rh-station i { color: var(--primary); font-size: 12px; }
        .rh-badges { display: flex; align-items: center; gap: 6px; }
        .rh-live-badge {
            display: flex; align-items: center; gap: 4px;
            padding: 3px 8px; border-radius: 20px;
            font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;
            transition: all 0.3s ease;
        }
        .rh-live-badge.live {
            background: rgba(74,222,128,0.12); color: var(--success);
        }
        .rh-live-badge.off {
            background: rgba(107,107,107,0.12); color: var(--text-tertiary);
        }
        .rh-live-dot {
            width: 5px; height: 5px; border-radius: 50%;
        }
        .rh-live-badge.live .rh-live-dot {
            background: var(--success);
        }
        .rh-live-badge.off .rh-live-dot {
            background: var(--text-tertiary);
        }
        .rh-main {
            display: flex; align-items: center; gap: 12px;
            margin-bottom: 8px; position: relative; z-index: 1;
        }
        .rh-art-wrap {
            position: relative; flex-shrink: 0;
            width: 52px; height: 52px;
        }
        .rh-art-ring {
            position: absolute; inset: -3px;
            border-radius: 50%;
            border: 1.5px solid rgba(232,168,56,0.2);
        }
        .rh-art {
            width: 100%; height: 100%;
            border-radius: 50%; overflow: hidden;
            box-shadow: 0 4px 16px rgba(0,0,0,0.4), 0 0 0 1.5px rgba(232,168,56,0.1);
            position: relative;
        }
        .rh-art.spinning {
            animation: rhSpin 12s linear infinite;
        }
        @keyframes rhSpin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
        .rh-art img { width: 100%; height: 100%; object-fit: cover; }
        .rh-art-fallback {
            width: 100%; height: 100%;
            background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end));
            display: flex; align-items: center; justify-content: center;
            font-size: 22px; color: #fff;
        }
        .rh-vinyl-lines {
            position: absolute; inset: 0; border-radius: 50%;
            background: conic-gradient(from 0deg, transparent 0deg, rgba(255,255,255,0.03) 10deg, transparent 20deg, rgba(255,255,255,0.03) 30deg, transparent 40deg, rgba(255,255,255,0.03) 50deg, transparent 60deg, rgba(255,255,255,0.03) 70deg, transparent 80deg, rgba(255,255,255,0.03) 90deg, transparent 100deg, rgba(255,255,255,0.03) 110deg, transparent 120deg, rgba(255,255,255,0.03) 130deg, transparent 140deg, rgba(255,255,255,0.03) 150deg, transparent 160deg, rgba(255,255,255,0.03) 170deg, transparent 180deg, rgba(255,255,255,0.03) 190deg, transparent 200deg, rgba(255,255,255,0.03) 210deg, transparent 220deg, rgba(255,255,255,0.03) 230deg, transparent 240deg, rgba(255,255,255,0.03) 250deg, transparent 260deg, rgba(255,255,255,0.03) 270deg, transparent 280deg, rgba(255,255,255,0.03) 290deg, transparent 300deg, rgba(255,255,255,0.03) 310deg, transparent 320deg, rgba(255,255,255,0.03) 330deg, transparent 340deg, rgba(255,255,255,0.03) 350deg, transparent 360deg);
            pointer-events: none; z-index: 2;
        }
        .rh-eq {
            position: absolute; bottom: 4px; left: 50%; transform: translateX(-50%);
            display: flex; gap: 2px; align-items: flex-end;
            z-index: 3;
        }
        .rh-eq span {
            width: 3px; background: var(--primary); border-radius: 2px;
            animation: rhEqBounce 0.6s ease-in-out infinite alternate;
        }
        .rh-eq span:nth-child(1) { height: 8px; animation-delay: 0s; }
        .rh-eq span:nth-child(2) { height: 12px; animation-delay: 0.15s; }
        .rh-eq span:nth-child(3) { height: 10px; animation-delay: 0.3s; }
        .rh-eq span:nth-child(4) { height: 6px; animation-delay: 0.45s; }
        @keyframes rhEqBounce {
            from { transform: scaleY(0.5); }
            to { transform: scaleY(1); }
        }
        .rh-info {
            flex: 1; min-width: 0;
        }
        .rh-track-name {
            font-size: 14px; font-weight: 700;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .rh-track-artist {
            font-size: 11px; color: var(--text-secondary);
            margin-top: 2px;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .rh-play-btn {
            width: 40px; height: 40px; border-radius: 50%;
            background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end));
            border: none; color: #fff; font-size: 14px;
            display: flex; align-items: center; justify-content: center;
            cursor: pointer; position: relative; flex-shrink: 0;
            box-shadow: 0 4px 16px rgba(232,168,56,0.3);
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .rh-play-btn:active { transform: scale(0.88); }
        .rh-play-btn.playing {
            box-shadow: 0 4px 20px rgba(232,168,56,0.35);
        }
        .rh-play-ring {
            position: absolute; inset: -4px; border-radius: 50%;
            border: 1.5px solid rgba(232,168,56,0.15);
        }
        .rh-play-btn.playing .rh-play-ring {
            border-color: rgba(74,222,128,0.3);
        }
        .rh-actions-row {
            display: flex; align-items: center; gap: 8px;
            position: relative; z-index: 1;
        }
        .rh-source {
            font-size: 10px; color: var(--text-tertiary);
            display: flex; align-items: center; gap: 3px;
            flex: 1; min-width: 0;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .rh-source i { color: var(--primary); font-size: 9px; }
        .rh-listener-badge {
            display: flex; align-items: center; gap: 3px;
            padding: 2px 8px; border-radius: 20px;
            background: var(--surface); border: 1px solid var(--border);
            font-size: 10px; font-weight: 600; color: var(--text-secondary);
            white-space: nowrap;
        }
        .rh-listener-badge i { font-size: 9px; color: var(--primary); }
        .rh-expand-small {
            width: 28px; height: 28px; border-radius: 50%;
            background: var(--surface); border: 1px solid var(--border);
            color: var(--text-secondary); font-size: 11px;
            display: flex; align-items: center; justify-content: center;
            cursor: pointer; flex-shrink: 0; transition: all 0.2s ease;
        }
        .rh-expand-small:active { background: var(--surface-elevated); transform: scale(0.88); }.feed-section { padding: 0 var(--section-px, 16px) 16px; }
        .feed-section { --section-px: 12px; }

        /* ===== SECTION HEADER ===== */
        .section-header-inline {
            display: flex; align-items: center; justify-content: space-between;
            margin-bottom: 12px;
        }
        .section-title { font-size: 17px; font-weight: 700; }
        .section-link {
            font-size: 12px; color: var(--primary); font-weight: 600;
            background: none; border: none; cursor: pointer;
            display: flex; align-items: center; gap: 4px;
            padding: 4px 8px; border-radius: 8px;
            transition: all 0.15s ease;
        }
        .section-link i { font-size: 10px; }
        .section-link:active { background: rgba(232,168,56,0.1); }
      `}</style>

      <ToastBridge />

      {/* ===== SETUP CHECKLIST ===== */}
      {showSetup && !allSetupDone && (
        <div className="setup-overlay">
          <div className="setup-card">
            <div className="setup-welcome">
              <h2>Welcome to {churchInfo.name}!</h2>
              <p>Let&apos;s get you set up and broadcasting in no time.</p>
            </div>
            <div className="setup-progress">
              <div className="setup-progress-fill" style={{ width: `${setupProgress}%` }}></div>
            </div>
            <div className="setup-progress-text">{setupCompleted.length} of {setupChecklistItems.length} complete</div>
            {setupChecklistItems.map((item) => {
              const done = setupCompleted.includes(item.id);
              return (
                <div
                  key={item.id}
                  className={`setup-item${done ? " done" : ""}`}
                  onClick={() => !done && handleSetupDone(item.id)}
                >
                  <div className="setup-check">
                    {done && <i className="fas fa-check"></i>}
                  </div>
                  <div className="setup-info">
                    <h4>{item.label}</h4>
                    <p>{item.desc}</p>
                  </div>
                </div>
              );
            })}
            <button className="setup-dismiss" onClick={() => setShowSetup(false)}>
              {setupCompleted.length >= 3 ? "Continue to Dashboard" : "Skip for now"}
            </button>
          </div>
        </div>
      )}

      {/* ===== MAIN APP ===== */}
      <div className="app-container">
        <PremiumTopBar minimal />

        {/* HEADER */}
        <header className="dash-header">
          <div className="dash-header-left">
            <div className="dash-header-logo">
              <i className="fas fa-cross"></i>
            </div>
            <div className="dash-header-info">
              <h1>{churchInfo.name}</h1>
            </div>
          </div>

          <div className="dash-header-center">
            <div className={`dash-onair-badge ${radioBackendRunning ? "live" : "off"}`}>
              <div className="dash-onair-dot"></div>
              {radioBackendRunning ? "On Air" : "Off Air"}
            </div>
            <div className="dash-listener-count">
              <i className="fas fa-headphones"></i>
              <span>{liveListeners}</span>
            </div>
          </div>

          <div className="dash-header-right" ref={dropdownRef}>
            <button
              className="dash-avatar-btn"
              onClick={() => setShowProfileDropdown((p) => !p)}
            >
              {churchInfo.logoInitials}
            </button>
            {showProfileDropdown && (
              <div className="dash-dropdown">
                <button className="dash-dropdown-item">
                  <i className="fas fa-user"></i> My Profile
                </button>
                <button className="dash-dropdown-item">
                  <i className="fas fa-sliders"></i> Station Settings
                </button>
                <button className="dash-dropdown-item" onClick={() => { setShowProfileDropdown(false); router.push("/admin/accounts"); }}>
                  <i className="fas fa-user-shield"></i> Accounts
                </button>
                <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "4px 0" }} />
                <button className="dash-dropdown-item danger" onClick={handleLogout}>
                  <i className="fas fa-right-from-bracket"></i> Logout
                </button>
              </div>
            )}
          </div>
        </header>

        {/* CONTENT SCROLL */}
        <div className="content-scroll">

          {/* ─── TV LIVE STREAM BANNER ─── */}
          {tvPlayer.isLive && tvPlayer.liveStatus?.liveVideoId && (
            <div className="live-banner" style={{ borderTop: "1px solid rgba(239,68,68,0.1)", borderBottom: "1px solid rgba(239,68,68,0.1)" }}>
              <div className="live-banner-left">
                <div className="live-banner-dot"></div>
                <div className="live-banner-info">
                  <div className="live-banner-title" style={{ color: "#EF4444" }}>
                    <i className="fab fa-youtube" style={{ marginRight: 4 }}></i>
                    {tvPlayer.liveStatus.liveTitle || "Live Stream"}
                  </div>
                  <div className="live-banner-sub">
                    Church TV · Watch the live broadcast now
                  </div>
                </div>
              </div>
              <button className="live-banner-btn" onClick={() => tvPlayer.play(tvPlayer.liveStatus!.liveVideoId!)}>
                <i className="fas fa-play"></i> Watch Live
              </button>
            </div>
          )}

          {/* ─── TV HERO CARD ─── */}
          <section className="feed-section">
            <div className="tv-top-wrap">
              <div className="tv-top">
                <div className="tv-station">
                  <i className="fas fa-tv"></i>
                  <span>Church TV</span>
                </div>
                <div className="tv-badges">
                  <div className={`tv-live-badge ${tvCurrentVideo ? "live" : "off"}`}>
                    <span className="tv-live-dot"></span>
                    {tvCurrentVideo ? "On Air" : "Off Air"}
                  </div>
                  {tvChannel && (
                    <div className="tv-sub-badge">
                      <i className="fas fa-users"></i>
                      {tvChannel.subscriberCount || "—"}
                    </div>
                  )}
                </div>
              </div>

              {tvCurrentVideo ? (
                <div ref={tvPlayerTargetRef} className="tv-player-container">
                  <div className="tv-overlay">
                    <div className="tv-overlay-info">
                      <div className="tv-overlay-now">
                        <i className="fas fa-tv"></i>
                        Now Playing
                      </div>
                      <div className="tv-overlay-title">{tvCurrentVideo.title}</div>
                    </div>
                    <button className="tv-expand-btn" onClick={toggleFullscreen} title="Full screen">
                      <i className="fas fa-expand"></i>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="tv-no-video">
                  <i className="fas fa-video-slash"></i>
                  <span>TV is off air</span>
                </div>
              )}

              {tvChannel && (
                <div className="tv-channel-strip">
                  <div className="tv-channel-avatar">
                    <i className="fab fa-youtube"></i>
                    {tvChannel.thumbnail && (
                      <img src={tvChannel.thumbnail.replace(/^http:/, 'https:')} alt="" referrerPolicy="no-referrer" crossOrigin="anonymous" onError={(e) => { e.currentTarget.style.display = 'none'; }} className="tv-avatar-img" />
                    )}
                  </div>
                  <div className="tv-channel-info">
                    <div className="tv-channel-name">{tvChannel.title}</div>
                    <div className="tv-channel-meta">{tvVideos.length} videos</div>
                  </div>
                  <button className="tv-watch-btn" onClick={() => router.push("/admin/tv")}>
                    <i className="fas fa-expand"></i> Manage
                  </button>
                </div>
              )}

              <button className="tv-start-btn" onClick={handleStartTv} title={tvStartCountdown > 0 ? `Ready in ${tvStartCountdown}s` : "Skip to next video"} disabled={tvStartCountdown > 0}>
                <i className="fas fa-play"></i>
                <span>{tvStartCountdown > 0 ? `Starting in ${tvStartCountdown}s` : 'Start TV'}</span>
              </button>
              <div className="tv-start-hint">Click to switch playlist</div>

              {tvUserState && tvUserState.playlist.length === 0 && (
                <div className="tv-next-slot">
                  <i className="fas fa-list"></i>
                  <span>Your TV playlist is empty — add videos from the TV page</span>
                </div>
              )}
            </div>
          </section>

          {/* PREMIUM RADIO HERO CARD */}
          <section className="feed-section">
            <div className="rh-hero">
              <div className="rh-glow-1"></div>
              <div className="rh-glow-2"></div>

              <div className="rh-top">
                <div className="rh-station">
                  <i className="fas fa-tower-broadcast"></i>
                  <span>{radioNP?.station?.name || "Radio Station"}</span>
                </div>
                <div className="rh-badges">
                  <div className={`rh-live-badge ${radioBackendRunning ? "live" : "off"}`}>
                    <span className="rh-live-dot"></span>
                    {radioBackendRunning ? "Live" : "Off Air"}
                  </div>
                </div>
              </div>

              <div className="rh-main" style={{ cursor: "pointer" }} onClick={() => router.push("/admin/radio")}>
                <div className="rh-art-wrap">
                  <div className="rh-art-ring"></div>
                  <div className="rh-art">
                    {nowPlaying.albumArt ? (
                      <img src={nowPlaying.albumArt} alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    ) : (
                      <div className="rh-art-fallback">
                        <i className="fas fa-radio"></i>
                      </div>
                    )}
                  </div>
                </div>

                <div className="rh-info">
                  <div className="rh-track-name">{nowPlaying.title || "Station Offline"}</div>
                  <div className="rh-track-artist">{nowPlaying.artist || "Not currently playing"}</div>
                </div>

                <button className="rh-play-btn" onClick={() => router.push("/admin/radio")}>
                  <i className="fas fa-headphones"></i>
                  <div className="rh-play-ring"></div>
                </button>
              </div>

              <div className="rh-actions-row">
                <div className="rh-source">
                  <i className="fas fa-radio"></i> {radioNP?.station?.name || "Radio"}
                </div>
                <div className="rh-listener-badge">
                  <i className="fas fa-headphones"></i>
                  {liveListeners}
                </div>
                <button className="rh-expand-small" onClick={() => router.push("/admin/radio")}>
                  <i className="fas fa-external-link-alt"></i>
                </button>
              </div>
            </div>
          </section>

          {/* UPCOMING EVENTS */}
          <EventCarousel redirectUrl="/admin/content" />

          {/* PHOTO CAROUSEL */}
          <section className="feed-section">
            <div className="section-header-inline">
              <h2 className="section-title">Photo Gallery</h2>
              <button className="section-link" onClick={() => router.push("/admin/content")}>Manage <i className="fas fa-chevron-right"></i></button>
            </div>
            <AlbumCarousel />
          </section>

          {/* STAT CARDS */}
          <div className="stats-grid">
            {statCards.map((card) => (
              <div key={card.id} className="stat-card" onClick={() => {
                window.dispatchEvent(new CustomEvent("show-toast", { detail: { title: card.label, message: `Opening ${card.label.toLowerCase()} details...`, type: "info", duration: 2500 } }));
              }}>
                <div className="accent-line" style={{ background: card.colorCode }}></div>
                <div className="stat-card-head">
                  <div className="stat-icon-bg" style={{ background: `${card.colorCode}15`, color: card.colorCode }}>
                    <i className={`fas ${card.icon}`}></i>
                  </div>
                  {card.sparkline && card.sparkline.length > 0 && (() => {
                    const max = Math.max(...card.sparkline!);
                    const pts = card.sparkline!.map((v: number, i: number) => `${(i / 9) * 100},${20 - (v / max) * 18}`).join(" ");
                    return (
                      <svg className="stat-sparkline" viewBox="0 0 100 20" preserveAspectRatio="none">
                        <polyline points={pts} fill="none" stroke={card.colorCode} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.4" />
                      </svg>
                    );
                  })()}
                </div>
                <div className="stat-value">{card.value}</div>
                <div className="stat-label">{card.label}</div>
                {card.subtitle && <div className="stat-subtitle">{card.subtitle}</div>}
                {card.trend && (
                  <div className={`stat-trend ${card.trend.startsWith("↑") ? "up" : "down"}`}>
                    <i className="fas fa-arrow-up" style={{ fontSize: "9px" }}></i> {card.trend.replace("↑ ", "").replace("↓ ", "")}
                  </div>
                )}
                {card.progress !== undefined && (
                  <div className="storage-bar">
                    <div
                      className="storage-bar-fill"
                      style={{
                        width: `${card.progress}%`,
                        background: card.progress > 90 ? "#EF4444" : card.progress > 75 ? "#F59E0B" : card.colorCode,
                      }}
                    ></div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* MAIN GRID */}
          <div className="dash-grid">
            {/* LEFT COLUMN */}
            <div className="dash-section">


              {/* TODAY AT A GLANCE */}
              <div className="widget-card">
                <div className="widget-label">
                  <i className="fas fa-bolt" style={{ marginRight: 6, color: "var(--primary)" }}></i>
                  Today at a Glance
                  <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 600, color: "var(--text-tertiary)", textTransform: "none", letterSpacing: 0 }}>
                    <i className="fas fa-circle" style={{ fontSize: 6, color: radioBackendRunning ? "var(--success)" : "var(--error)", marginRight: 4 }}></i>
                    {radioBackendRunning ? "Live" : "Offline"}
                  </span>
                </div>

                {/* Top stats row */}
                <div className="quickstats-grid">
                  <div className="qs-item" style={{ cursor: "pointer" }} onClick={() => router.push("/admin/radio")}>
                    <div className="qs-label">Peak Listeners</div>
                    <div className="qs-value">{radioPeakListeners || "..."}
                      <span className="qs-sub">today</span>
                    </div>
                  </div>
                  <div className="qs-item" style={{ cursor: "pointer" }} onClick={() => router.push("/admin/radio")}>
                    <div className="qs-label">Songs Played</div>
                    <div className="qs-value">{radioSongsPlayedToday || "..."}
                      <span className="qs-sub">today</span>
                    </div>
                  </div>
                  <div className="qs-item">
                    <div className="qs-label">Live Listeners</div>
                    <div className="qs-value" style={{ color: liveListeners > 0 ? "var(--success)" : "var(--text-tertiary)" }}>
                      {liveListeners}
                    </div>
                  </div>
                  <div className="qs-item" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <div className="qs-label">AutoDJ</div>
                    <button
                      className="autodj-toggle"
                      onClick={handleToggleAutoDJ}
                      disabled={autoDJToggling}
                      data-running={radioBackendRunning}
                    >
                      {autoDJToggling ? (
                        <i className="fas fa-spinner fa-spin"></i>
                      ) : radioBackendRunning ? (
                        <><i className="fas fa-pause"></i> Pause</>
                      ) : (
                        <><i className="fas fa-play"></i> Start</>
                      )}
                    </button>
                  </div>
                </div>

                {/* Current Track mini-now-playing */}
                <div className="glance-np" onClick={() => router.push("/admin/radio")} style={{ cursor: "pointer" }}>
                  <AlbumArt className="glance-np-cover" src={nowPlaying.albumArt} size={42} />
                  <div className="glance-np-info">
                    <div className="glance-np-label">Now Playing</div>
                    <div className="glance-np-title">{nowPlaying.title}</div>
                    <div className="glance-np-artist">{nowPlaying.artist || "No artist"}</div>
                  </div>
                  <div className="glance-np-source">
                    <span className={`source-badge ${radioBackendRunning ? "auto" : "off"}`}>
                      {nowPlaying.source}
                    </span>
                  </div>
                </div>

                {/* Up Next from queue */}
                {radioQueue.length > 0 && (
                  <div className="glance-queue">
                    <div className="glance-queue-label">
                      <i className="fas fa-forward-step" style={{ fontSize: 10 }}></i> Up Next ({radioQueue.length})
                    </div>
                    <div className="glance-queue-list">
                      {radioQueue.slice(0, 3).map((item, i) => (
                        <div className="glance-queue-item" key={i}>
                          <span className="glance-queue-pos">{i + 1}</span>
                          <span className="glance-queue-title">{item.song.title}</span>
                          <span className="glance-queue-artist">{item.song.artist}</span>
                        </div>
                      ))}
                      {radioQueue.length > 3 && (
                        <div className="glance-queue-more">+{radioQueue.length - 3} more</div>
                      )}
                    </div>
                  </div>
                )}

                {/* Recent songs from history */}
                {radioHistory.length > 0 && (
                  <div className="glance-recent">
                    <div className="glance-recent-label">
                      <i className="fas fa-clock-rotate" style={{ fontSize: 10 }}></i> Recently Played
                    </div>
                    <div className="glance-recent-list">
                      {radioHistory.slice(0, 4).map((item, i) => (
                        <div className="glance-recent-item" key={i}>
                          <div className="glance-recent-album">
                            <AlbumArt className="glance-recent-thumb glance-recent-thumb-fallback" src={item.song?.albumArt} size={24} fallbackIcon="fa-music" />
                          </div>
                          <div className="glance-recent-info">
                            <div className="glance-recent-title">{item.song?.title || "Unknown"}</div>
                            <div className="glance-recent-artist">{item.song?.artist || ""}</div>
                          </div>
                          <div className="glance-recent-time">{item.playedAt ? new Date(item.playedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Listener Activity Chart */}
                <div className="glance-chart-section">
                  <div className="glance-chart-header">
                    <span className="glance-chart-label">Listener Activity</span>
                    <div className="chart-period-toggle">
                      <button
                        className={`chart-period-btn ${chartPeriod === "24h" ? "active" : ""}`}
                        onClick={() => setChartPeriod("24h")}
                      >24h</button>
                      <button
                        className={`chart-period-btn ${chartPeriod === "7days" ? "active" : ""}`}
                        onClick={() => setChartPeriod("7days")}
                      >7d</button>
                    </div>
                  </div>
                  <div className="chart-bar-container">
                    {liveWeeklyChart.length > 0 ? (
                      (chartPeriod === "24h" ? liveWeeklyChart.slice(-7) : liveWeeklyChart.slice(-7)).map((v, i) => {
                        const maxVal = Math.max(...liveWeeklyChart.slice(-7), 1);
                        return (
                          <div
                            key={i}
                            className={`chart-bar${i === (chartPeriod === "24h" ? 6 : 6) ? " today" : ""}`}
                            style={{ height: `${(v / maxVal) * 100}%` }}
                            title={`${v} listeners`}
                          ></div>
                        );
                      })
                    ) : (
                      <div className="chart-empty">Waiting for data...</div>
                    )}
                  </div>
                </div>
              </div>




            </div>

            {/* RIGHT COLUMN */}
            <div className="dash-section">
              {/* STATION STATUS */}
              <div className="swidget">
                <div className="swidget-header">
                  <div className="swidget-title">
                    <i className="fas fa-tower-broadcast"></i> Station Status
                  </div>
                </div>
                <div className="status-row">
                  <div className="status-name">
                    <div className={`status-dot ${radioBackendRunning ? "on" : "off"}`}></div>
                    Icecast (Frontend)
                  </div>
                  <span style={{ fontSize: 12, color: radioBackendRunning ? "var(--success)" : "var(--error)", fontWeight: 600 }}>
                    {radioBackendRunning ? "Running" : "Offline"}
                  </span>
                </div>
                <div className="status-row">
                  <div className="status-name">
                    <div className={`status-dot ${radioBackendRunning ? "on" : "off"}`}></div>
                    Liquidsoap (AutoDJ)
                  </div>
                  <span style={{ fontSize: 12, color: radioBackendRunning ? "var(--success)" : "var(--error)", fontWeight: 600 }}>
                    {radioBackendRunning ? "Running" : "Offline"}
                  </span>
                </div>
                <div className="status-uptime">
                  <i className="fas fa-clock" style={{ marginRight: 6, color: "var(--text-tertiary)" }}></i>
                  {stationUptime ? `Running for ${stationUptime}` : "No uptime data"}
                </div>

                <div className="status-actions">
                  <button className="stat-btn restart" disabled={autoDJToggling} onClick={handleToggleAutoDJ}>
                    {autoDJToggling ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-rotate"></i>} {radioBackendRunning ? "Pause" : "Start"} AutoDJ
                  </button>
                </div>
              </div>

              {/* ACTIVE DJs */}
              <div className="swidget">
                <div className="swidget-header">
                  <div className="swidget-title">
                    <i className="fas fa-microphone"></i> Active DJs
                  </div>
                  <span style={{ fontSize: 12, color: "var(--text-tertiary)", fontWeight: 600 }}>{liveStreamers.length}</span>
                </div>
                {liveStreamers.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "16px 0", color: "var(--text-secondary)", fontSize: 13 }}>
                    <i className="fas fa-circle-info" style={{ marginRight: 6, color: "var(--text-tertiary)" }}></i>
                    No DJs configured yet
                  </div>
                ) : (
                  liveStreamers.slice(0, 5).map((dj) => (
                    <div className="dj-item" key={dj.id}>
                      <div className="dj-avatar">
                        {dj.isLive && <div className="live-ring"></div>}
                        {(dj.displayName || dj.username)[0]?.toUpperCase() || "?"}
                      </div>
                      <div className="dj-info">
                        <div className="dj-name">
                          {dj.displayName || dj.username || "Unknown"}
                          {dj.isLive && <span className="live-badge">LIVE</span>}
                        </div>
                        <div className="dj-username">@{dj.username}</div>
                      </div>
                      <div className="dj-last">
                        {dj.isLive ? "Now" : dj.lastBroadcast ? timeAgo(new Date(dj.lastBroadcast)) : "Never"}
                      </div>
                      <div className="dj-actions">
                        <button className="dj-action-btn" title="Edit" onClick={() => window.dispatchEvent(new CustomEvent("show-toast", { detail: { title: "Edit DJ", message: `Editing ${dj.displayName || dj.username}...`, type: "info", duration: 2000 } }))}>
                          <i className="fas fa-pen"></i>
                        </button>
                        <button className="dj-action-btn danger" title="Remove" disabled={streamDeletingId === dj.id} onClick={() => handleDeleteStreamer(dj.id, dj.displayName || dj.username)}>
                          {streamDeletingId === dj.id ? (
                            <i className="fas fa-spinner fa-spin"></i>
                          ) : (
                            <i className="fas fa-xmark"></i>
                          )}
                        </button>
                      </div>
                    </div>
                  ))
                )}
                <button className="add-dj-btn" onClick={() => window.dispatchEvent(new CustomEvent("show-toast", { detail: { title: "Add DJ", message: "Opening add DJ form...", type: "info", duration: 2000 } }))}>
                  <i className="fas fa-plus" style={{ marginRight: 6 }}></i> Add DJ
                </button>
                <a className="view-all-link" href="/admin/radio">View all {liveStreamers.length} DJs →</a>
              </div>



            </div>
          </div>

        </div>


        {!showSetup && <AdminBottomNav />}
      </div>
    </>
  );
}
