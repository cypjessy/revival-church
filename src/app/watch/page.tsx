"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import BottomNavBar from "@/components/shared/BottomNavBar";
import ToastBridge from "@/components/dashboard/ToastBridge";
import { getVideosPage, getSeries } from "@/lib/youtube";
import type { YouTubeVideo, YouTubeSeries } from "@/lib/youtube";
import { getNowPlaying, getStationId } from "@/lib/azuracast";
import type { NowPlayingData } from "@/lib/azuracast";
import { useGlobalVideoPlayer } from "@/lib/video/VideoPlayerProvider";
import { useYouTubeLive } from "@/hooks/useYouTubeLive";

// ========== MOCK DATA ==========

interface VideoData {
  id: string;
  youtubeId: string;
  title: string;
  description: string;
  thumbnail: string;
  duration: string;
  durationSec: number;
  publishedAt: string;
  viewCount: string;
  category: string;
  seriesId?: string;
  seriesName?: string;
  episode?: number;
  speaker?: string;
}


// Real data is now fetched from Firestore via getVideosPage/getSeries
// ========== HELPERS ==========

function getWatchProgressKey(videoId: string): string {
  return `watch_progress_${videoId}`;
}

function getRecentSearchesKey(): string {
  return "recent_searches_watch";
}

function loadWatchProgress(videoId: string): { position: number; completed: boolean } | null {
  try {
    const raw = localStorage.getItem(getWatchProgressKey(videoId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveWatchProgress(videoId: string, position: number, duration: number) {
  try {
    const completed = position / duration >= 0.9;
    localStorage.setItem(
      getWatchProgressKey(videoId),
      JSON.stringify({ position, completed })
    );
  } catch { /* noop */ }
}

function loadRecentLocalSearches(): string[] {
  try {
    const raw = localStorage.getItem(getRecentSearchesKey());
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveRecentLocalSearches(searches: string[]) {
  try {
    localStorage.setItem(getRecentSearchesKey(), JSON.stringify(searches.slice(0, 10)));
  } catch { /* noop */ }
}

// ========== MAIN COMPONENT ==========

export default function WatchPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"home" | "series" | "live" | "search">("home");
  const [seriesFilter, setSeriesFilter] = useState<string>("all");
  const [expandedSeries, setExpandedSeries] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<VideoData[]>([]);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [localSearches, setLocalSearches] = useState<string[]>([]);
  const [isLive, setIsLive] = useState(false);
  const [liveViewers, setLiveViewers] = useState(247);
  const [liveDuration, setLiveDuration] = useState(3840); // 1h 04m
  const [offline, setOffline] = useState(false);
  const [watchedVideos, setWatchedVideos] = useState<Set<string>>(new Set());
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [searchPageSize, setSearchPageSize] = useState(12);

    const [videos, setVideos] = useState<YouTubeVideo[]>([]);
  const [seriesList, setSeriesList] = useState<YouTubeSeries[]>([]);
  const [loading, setLoading] = useState(true);
  const [radioLive, setRadioLive] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const globalPlayer = useGlobalVideoPlayer();
  const ytLive = useYouTubeLive();

  // ========== REAL DATA FETCHING ==========

  const [allLoaded, setAllLoaded] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lastDocRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [vpResult, sResult] = await Promise.all([
          getVideosPage(8),
          getSeries(),
        ]);
        if (cancelled) return;
        setVideos(vpResult.videos);
        lastDocRef.current = vpResult.lastDoc;
        setSeriesList(sResult);
      } catch (err) {
        console.error("Failed to load videos/series:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  /* Load remaining videos when user enters search tab */
  useEffect(() => {
    if (activeTab !== "search" || allLoaded || loading) return;
    let cancelled = false;
    const loadMore = async () => {
      const remaining: YouTubeVideo[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let cursor: any = lastDocRef.current;
      while (cursor) {
        const page = await getVideosPage(50, cursor);
        if (cancelled) return;
        remaining.push(...page.videos);
        cursor = page.lastDoc;
      }
      if (cancelled) return;
      setVideos(prev => [...prev, ...remaining]);
      setAllLoaded(true);
    };
    loadMore();
    return () => { cancelled = true; };
  }, [activeTab, allLoaded, loading]);

  // Check radio live status (poll every 30s)
  useEffect(() => {
    let cancelled = false;
    async function checkLive() {
      try {
        const np = await getNowPlaying(getStationId());
        if (!cancelled) {
          setRadioLive(np.live.isLive || np.nowPlaying !== null);
          setIsLive(np.live.isLive || np.nowPlaying !== null);
        }
      } catch {}
    }
    checkLive();
    const iv = setInterval(checkLive, 30000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  // ========== DATA MAPPING HELPERS ==========

  function parseISOToSeconds(iso: string): number {
    const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!m) return 0;
    const h = parseInt(m[1] || "0", 10);
    const mn = parseInt(m[2] || "0", 10);
    const s = parseInt(m[3] || "0", 10);
    return h * 3600 + mn * 60 + s;
  }

  function formatISOToDisplay(iso: string): string {
    const total = parseISOToSeconds(iso);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  function formatViewCount(n: number): string {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
    if (n >= 1000) return (n / 1000).toFixed(1) + "K";
    return String(n);
  }

  function formatDate(iso: string): string {
    try {
      const d = new Date(iso);
      const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
    } catch { return iso; }
  }

  // Build a map of seriesId -> YouTubeSeries for quick lookup
  const seriesMap = useMemo(() => {
    const map = new Map<string, YouTubeSeries>();
    for (const s of seriesList) {
      if (s.id) map.set(s.id, s);
    }
    return map;
  }, [seriesList]);

  // Daily-seeded shuffle for featured picks
  function seededShuffle<T>(arr: T[]): T[] {
    const result = [...arr];
    const seed = new Date().toDateString();
    let s = 0;
    for (let i = 0; i < seed.length; i++) s = ((s << 5) - s + seed.charCodeAt(i)) | 0;
    let m = result.length;
    while (m) {
      m--;
      s = (s * 16807) % 2147483647;
      const j = Math.abs(s) % (m + 1);
      [result[m], result[j]] = [result[j], result[m]];
    }
    return result;
  }

  // Map YouTubeVideo to the VideoData interface the UI expects
  function ytToVideoData(yv: YouTubeVideo): VideoData {
    const sec = parseISOToSeconds(yv.duration);
    const series = yv.seriesId ? seriesMap.get(yv.seriesId) : undefined;
    let episode: number | undefined;
    if (series && series.videoIds) {
      const idx = series.videoIds.indexOf(yv.youtubeId);
      if (idx >= 0) episode = idx + 1;
    }
    return {
      id: yv.youtubeId,
      youtubeId: yv.youtubeId,
      title: yv.title,
      description: yv.description,
      thumbnail: yv.thumbnail,
      duration: formatISOToDisplay(yv.duration),
      durationSec: sec,
      publishedAt: formatDate(yv.publishedAt),
      viewCount: formatViewCount(yv.views),
      category: yv.category || "Sermon",
      seriesId: yv.seriesId || undefined,
      seriesName: series?.name,
      episode,
    };
  }

  // All videos mapped to the display format, sorted by publishedAt descending
  const allVideos = useMemo(() => {
    return [...videos]
      .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
      .map(ytToVideoData);
  }, [videos, seriesMap]);


  // ========== DERIVED DATA ==========

  const featuredVideos = allVideos.filter((v) => v.seriesId !== undefined);
  const recentUploads = allVideos;

  const filteredSeries = seriesFilter === "all"
    ? seriesList
    : seriesList.filter((s) => s.category.toLowerCase().replace(/\s/g, "-") === seriesFilter);

  const continueWatching = allVideos.filter((v) => {
    const prog = loadWatchProgress(v.id);
    return prog && !prog.completed && prog.position > 0;
  });

  // Load watched videos
  useEffect(() => {
    const watched: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith("watch_progress_")) {
        try {
          const data = JSON.parse(localStorage.getItem(key) || "{}");
          if (data.completed) watched.push(key.replace("watch_progress_", ""));
        } catch { /* noop */ }
      }
    }
    queueMicrotask(() => { setWatchedVideos(new Set(watched)); setLocalSearches(loadRecentLocalSearches()); });
  }, []);

  // Online/offline detection
  useEffect(() => {
    let unsub: (() => void) | null = null;
    (async () => {
      try {
        const { Network } = await import("@capacitor/network");
        const status = await Network.getStatus();
        setOffline(!status.connected);
        const listener = await Network.addListener("networkStatusChange", (s) => {
          setOffline(!s.connected);
        });
        unsub = () => listener.remove();
      } catch {
        setOffline(!navigator.onLine);
        const handleOnline = () => setOffline(false);
        const handleOffline = () => setOffline(true);
        window.addEventListener("online", handleOnline);
        window.addEventListener("offline", handleOffline);
        unsub = () => {
          window.removeEventListener("online", handleOnline);
          window.removeEventListener("offline", handleOffline);
        };
      }
    })();
    return () => unsub?.();
  }, []);

  // Live duration timer
  useEffect(() => {
    if (!isLive) return;
    liveTimerRef.current = setInterval(() => {
      setLiveDuration((d) => d + 10);
    }, 10000);
    return () => {
      if (liveTimerRef.current) clearInterval(liveTimerRef.current);
    };
  }, [isLive]);

  // Search debounce
  useEffect(() => {
    if (!searchQuery.trim()) {
      queueMicrotask(() => { setShowSearchResults(false); setSearchResults([]); setSubmittedSearch(""); });
      return;
    }
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      const q = searchQuery.toLowerCase();
      const results = allVideos.filter(
        (v) =>
          v.title.toLowerCase().includes(q) ||
          v.description.toLowerCase().includes(q) ||
          v.category.toLowerCase().includes(q) ||
          (v.seriesName || "").toLowerCase().includes(q)
      );
      setSearchResults(results);
      setSearchPageSize(12);
      setShowSearchResults(true);
      setSubmittedSearch(searchQuery);

      // Save to recent searches
      const newSearches = [searchQuery, ...localSearches.filter((s) => s !== searchQuery)].slice(0, 10);
      setLocalSearches(newSearches);
      saveRecentLocalSearches(newSearches);
    }, 300);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [searchQuery]);

  // Focus search input when tab changes to search
  useEffect(() => {
    if (activeTab === "search" && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [activeTab]);

  function handlePlayVideo(video: VideoData) {
    globalPlayer.play(video.id);
  }

  // [REMOVED inline player — using global VideoPlayerProvider]

  // [REMOVED body overflow cleanup — handled by shared hook]

  // [REMOVED handlePlayFrom — handled by shared hook]

  // [REMOVED handleClosePlayer, handleTogglePlay, handleSkip, handleWatchOnYT — handled by GlobalVideoPlayer overlay]

  // [REMOVED getUpNextVideo — handled by shared hook]

  async function handleShare() {
    try {
      const { Share } = await import("@capacitor/share");
      await Share.share({ title: "Kingdom Seekers Church Nakuru", text: "Check out Kingdom Seekers Church Nakuru", url: window.location.href });
    } catch {
      if (navigator.share) {
        navigator.share({
          title: "Kingdom Seekers Church Nakuru",
          text: "Check out Kingdom Seekers Church Nakuru",
          url: window.location.href,
        }).catch(() => {});
      } else {
        try {
          const { Clipboard } = await import("@capacitor/clipboard");
          await Clipboard.write({ string: window.location.href });
        } catch {
          await navigator.clipboard.writeText(window.location.href).catch(() => {});
        }
        window.dispatchEvent(
          new CustomEvent("show-toast", {
            detail: { title: "Shared", message: "Link copied to clipboard!", type: "success", duration: 2500 },
          })
        );
      }
    }
  }

  function getSeriesVideos(seriesId: string): VideoData[] {
    const series = seriesList.find((s) => s.id === seriesId);
    if (!series) return [];
    return series.videoIds.map((id) => allVideos.find((v) => v.id === id)).filter(Boolean) as VideoData[];
  }

  function handlePlayAll(seriesId: string) {
    const videos = getSeriesVideos(seriesId);
    if (videos.length > 0) {
      handlePlayVideo(videos[0]);
    }
  }

  const formatLiveDuration = (sec: number) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  function formatTime(sec: number): string {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  // [REMOVED progressPct — handled by shared hook]
  // [REMOVED upNextVideo — handled by shared hook]

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
            --live: #EF4444;
            --overlay: rgba(0,0,0,0.92);
            --gradient-start: #E8A838;
            --gradient-end: #D4762A;
            --shadow-soft: 0 4px 20px rgba(232,168,56,0.15);
            --shadow-elevated: 0 8px 32px rgba(0,0,0,0.5);
            --radius-sm: 12px;
            --radius-md: 16px;
            --radius-lg: 20px;
            --radius-xl: 24px;
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
        .status-bar { height: env(safe-area-inset-top, 24px); min-height: 24px; background: var(--bg); flex-shrink: 0; }

        /* ========== HEADER ========== */
        .header { padding: 8px 20px 12px; display: flex; align-items: center; gap: 12px; flex-shrink: 0; background: var(--bg); z-index: 100; }
        .header-logo { width: 32px; height: 32px; border-radius: 10px; background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end)); display: flex; align-items: center; justify-content: center; font-size: 16px; color: #fff; flex-shrink: 0; }
        .header-info { flex: 1; min-width: 0; }
        .header-church { font-size: 16px; font-weight: 700; }
        .header-sub { font-size: 11px; color: var(--text-tertiary); font-weight: 500; }
        .header-actions { display: flex; align-items: center; gap: 6px; }
        .header-btn { width: 40px; height: 40px; border-radius: var(--radius-full); background: var(--surface); border: none; color: var(--text-primary); font-size: 16px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s ease; position: relative; }
        .header-btn:active { background: var(--surface-elevated); transform: scale(0.9); }
        .header-btn .badge-dot { position: absolute; top: 8px; right: 8px; width: 8px; height: 8px; background: var(--error); border-radius: var(--radius-full); border: 2px solid var(--bg); }

        .live-badge {
            display: flex; align-items: center; gap: 6px; padding: 6px 14px; border-radius: 20px; background: rgba(239,68,68,0.15); border: 1px solid rgba(239,68,68,0.3); cursor: pointer; transition: all 0.2s ease; font-size: 12px; font-weight: 700; color: var(--live);
        }
        .live-badge:active { transform: scale(0.95); }
        .live-badge .pulse-dot { width: 8px; height: 8px; background: var(--live); border-radius: var(--radius-full); animation: livePulse 1.5s ease-in-out infinite; }
        .live-badge.off { background: var(--surface); border-color: var(--border); color: var(--text-tertiary); }
        .live-badge.off .pulse-dot { background: var(--text-tertiary); animation: none; }

        @keyframes livePulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.5; transform: scale(1.3); }
        }

        /* ========== BOTTOM TABS ========== */
        .tabs-bar {
            display: flex; border-bottom: 1px solid var(--border); flex-shrink: 0; background: var(--bg); padding: 0 8px;
        }
        .tab-btn {
            flex: 1; padding: 12px 8px; background: none; border: none; color: var(--text-tertiary); font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.2s ease; position: relative; display: flex; align-items: center; justify-content: center; gap: 6px;
        }
        .tab-btn i { font-size: 14px; }
        .tab-btn.active { color: var(--primary); }
        .tab-btn.active::after { content: ''; position: absolute; bottom: 0; left: 20%; right: 20%; height: 3px; background: var(--primary); border-radius: 3px 3px 0 0; }
        .tab-btn:active { opacity: 0.7; }

        /* ========== CONTENT SCROLL ========== */
        .content-scroll { flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch; padding-bottom: 100px; }
        .content-scroll::-webkit-scrollbar { display: none; }

        /* ========== LIVE BANNER (in Home) ========== */
        .live-banner {
            margin: 0 16px 16px; padding: 14px 18px; border-radius: var(--radius-md); background: linear-gradient(135deg, rgba(239,68,68,0.12), rgba(239,68,68,0.05)); border: 1px solid rgba(239,68,68,0.25); display: flex; align-items: center; gap: 14px; position: relative; overflow: hidden;
        }
        .live-banner.has-bg::before { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, #0F0F0F 30%, transparent 100%); z-index: 0; pointer-events: none; }
        .live-banner-bg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0.2; pointer-events: none; z-index: 0; }
        .live-banner > * { position: relative; z-index: 1; }
        .live-banner-dot { width: 12px; height: 12px; background: var(--live); border-radius: var(--radius-full); animation: livePulse 1.5s ease-in-out infinite; flex-shrink: 0; }
        .live-banner-info { flex: 1; min-width: 0; }
        .live-banner-title { font-size: 14px; font-weight: 700; }
        .live-banner-meta { font-size: 12px; color: var(--text-secondary); margin-top: 2px; display: flex; align-items: center; gap: 8px; }
        .live-banner-btn { padding: 8px 16px; background: var(--live); border: none; border-radius: 10px; color: #fff; font-size: 13px; font-weight: 700; cursor: pointer; flex-shrink: 0; transition: all 0.2s ease; }
        .live-banner-btn:active { transform: scale(0.95); }

        /* ========== FEATURED HERO ========== */
        .featured-section { padding: 0 16px 20px; }
        .featured-card { position: relative; border-radius: var(--radius-xl); overflow: hidden; cursor: pointer; border: 1px solid var(--border); transition: all 0.3s ease; }
        .featured-card:active { transform: scale(0.98); }
        .featured-thumb { width: 100%; aspect-ratio: 16/9; position: relative; overflow: hidden; }
        .featured-thumb img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.4s ease; }
        .featured-card:active .featured-thumb img { transform: scale(1.05); }
        .featured-thumb-placeholder { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: var(--surface-elevated); color: var(--text-tertiary); font-size: 32px; }
        .featured-overlay { position: absolute; inset: 0; background: linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.2) 50%, transparent 100%); display: flex; flex-direction: column; justify-content: flex-end; padding: 20px; }
        .featured-play-btn { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 64px; height: 64px; background: rgba(255,255,255,0.95); border-radius: var(--radius-full); display: flex; align-items: center; justify-content: center; color: var(--bg); font-size: 22px; box-shadow: 0 8px 32px rgba(0,0,0,0.4); transition: all 0.2s ease; }
        .featured-card:active .featured-play-btn { transform: translate(-50%, -50%) scale(0.9); }
        .featured-badge { display: inline-flex; align-items: center; gap: 6px; background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end)); color: #fff; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; padding: 5px 12px; border-radius: 20px; margin-bottom: 10px; width: fit-content; }
        .featured-title { font-size: 18px; font-weight: 700; line-height: 1.3; margin-bottom: 6px; }
        .featured-meta { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--text-secondary); }
        .featured-meta .dot { width: 3px; height: 3px; background: var(--text-tertiary); border-radius: var(--radius-full); }
        .featured-duration { position: absolute; bottom: 16px; right: 16px; background: rgba(0,0,0,0.8); color: #fff; font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 6px; backdrop-filter: blur(8px); }

        /* ========== SECTION HEADERS ========== */
        .section-header { display: flex; align-items: center; justify-content: space-between; padding: 20px 16px 12px; }
        .section-title { font-size: 17px; font-weight: 700; display: flex; align-items: center; gap: 8px; }
        .section-see-all { font-size: 13px; color: var(--primary); font-weight: 600; background: none; border: none; cursor: pointer; display: flex; align-items: center; gap: 4px; }
        .section-see-all:active { opacity: 0.7; }

        /* ========== HORIZONTAL SCROLL ROWS ========== */
        .h-scroll { display: flex; gap: 12px; overflow-x: auto; padding: 0 16px 8px; -webkit-overflow-scrolling: touch; scroll-snap-type: x mandatory; }
        .h-scroll::-webkit-scrollbar { display: none; }
        .h-scroll > * { scroll-snap-align: start; flex-shrink: 0; }

        /* ========== VIDEO GRID (3-column) ========== */
        .video-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; padding: 0 16px; }
        .video-grid .video-card { width: auto; }
        .video-grid .video-info .video-title { font-size: 12px; -webkit-line-clamp: 2; }

        /* ===== VIDEO CARD — PREMIUM ===== */
        .video-card { width: 240px; cursor: pointer; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); flex-shrink: 0; }
        .video-card:hover { transform: translateY(-4px); }
        .video-card:active { transform: scale(0.95); }
        .video-thumb { width: 100%; aspect-ratio: 16/9; border-radius: var(--radius-lg); overflow: hidden; position: relative; margin-bottom: 10px; border: 1px solid var(--border); background: var(--surface-elevated); }
        .video-thumb img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.5s ease; }
        .video-card:hover .video-thumb img { transform: scale(1.1); }
        .video-duration { position: absolute; bottom: 8px; right: 8px; background: rgba(0,0,0,0.75); color: #fff; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 6px; backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
        .video-progress-bar { position: absolute; bottom: 0; left: 0; right: 0; height: 4px; background: rgba(255,255,255,0.1); }
        .video-progress-fill { height: 100%; background: linear-gradient(90deg, var(--gradient-start), var(--gradient-end)); border-radius: 0 2px 0 0; box-shadow: 0 0 8px rgba(232,168,56,0.3); }
        .video-info .video-title { font-size: 13px; font-weight: 700; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin-bottom: 4px; }
        .video-info .video-meta { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text-tertiary); }
        .video-card .watched-badge { position: absolute; top: 8px; left: 8px; width: 24px; height: 24px; background: var(--success); border-radius: var(--radius-full); display: flex; align-items: center; justify-content: center; color: #fff; font-size: 11px; border: 2px solid var(--bg); box-shadow: 0 2px 10px rgba(34,197,94,0.3); }
        .video-card .play-hover {
            position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
            background: rgba(0,0,0,0.1); opacity: 0; transition: opacity 0.3s ease;
        }
        .video-card:hover .play-hover { opacity: 1; }
        .video-card .play-hover i {
            width: 44px; height: 44px; border-radius: 50%;
            background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end));
            display: flex; align-items: center; justify-content: center;
            font-size: 16px; color: #fff; box-shadow: 0 4px 20px rgba(232,168,56,0.3);
        }

        /* ===== SERIES CARD — PREMIUM ===== */
        .series-card { width: 180px; cursor: pointer; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); flex-shrink: 0; }
        .series-card:hover { transform: translateY(-4px); }
        .series-card:active { transform: scale(0.95); }
        .series-cover { width: 100%; aspect-ratio: 3/2; border-radius: var(--radius-lg); overflow: hidden; position: relative; margin-bottom: 10px; border: 1px solid var(--border); background: var(--surface-elevated); }
        .series-cover img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.5s ease; }
        .series-card:hover .series-cover img { transform: scale(1.1); }
        .series-count { position: absolute; bottom: 8px; right: 8px; background: rgba(0,0,0,0.7); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); color: #fff; font-size: 11px; font-weight: 700; padding: 5px 10px; border-radius: 8px; display: flex; align-items: center; gap: 5px; }
        .series-name { font-size: 14px; font-weight: 700; margin-bottom: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .series-meta { font-size: 11px; color: var(--text-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; gap: 4px; }
        .series-meta::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: var(--primary); flex-shrink: 0; }

        /* ========== CATEGORIES GRID ========== */


        /* ========== SERIES TAB ========== */
        .series-filter-bar { display: flex; gap: 8px; overflow-x: auto; padding: 0 16px 12px; -webkit-overflow-scrolling: touch; }
        .series-filter-bar::-webkit-scrollbar { display: none; }
        .series-filter-chip { padding: 7px 16px; border-radius: 20px; background: var(--surface); border: 1px solid var(--border); color: var(--text-secondary); font-size: 12px; font-weight: 600; white-space: nowrap; cursor: pointer; transition: all 0.2s ease; flex-shrink: 0; }
        .series-filter-chip:active { transform: scale(0.95); }
        .series-filter-chip.active { background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end)); border-color: transparent; color: #fff; }

        .series-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; padding: 0 16px; }
        .series-grid-item { cursor: pointer; transition: all 0.25s ease; }
        .series-grid-item:active { transform: scale(0.96); opacity: 0.8; }
        .series-grid-cover { width: 100%; aspect-ratio: 16/9; border-radius: var(--radius-md); overflow: hidden; position: relative; border: 1px solid var(--border); margin-bottom: 10px; }
        .series-grid-cover img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.4s ease; }
        .series-grid-item:active .series-grid-cover img { transform: scale(1.05); }
        .series-grid-badge { position: absolute; bottom: 8px; left: 8px; padding: 4px 10px; border-radius: 6px; font-size: 10px; font-weight: 700; color: #fff; text-transform: uppercase; }
        .series-grid-name { font-size: 14px; font-weight: 600; margin-bottom: 3px; }
        .series-grid-count { font-size: 12px; color: var(--text-tertiary); }

        /* ========== SERIES DETAIL MODAL ========== */
        .series-detail-modal { position: fixed; inset: 0; background: var(--bg); z-index: 4000; display: flex; flex-direction: column; transform: translateY(100%); transition: transform 0.35s cubic-bezier(0.32, 0.72, 0, 1); }
        .series-detail-modal.active { transform: translateY(0); }
        .series-detail-close { position: absolute; top: calc(env(safe-area-inset-top, 12px) + 12px); left: 16px; z-index: 10; width: 40px; height: 40px; border-radius: var(--radius-full); background: rgba(0,0,0,0.6); backdrop-filter: blur(8px); border: none; color: #fff; font-size: 18px; display: flex; align-items: center; justify-content: center; cursor: pointer; }
        .series-detail-cover { width: 100%; aspect-ratio: 16/9; position: relative; overflow: hidden; }
        .series-detail-cover img { width: 100%; height: 100%; object-fit: cover; }
        .series-detail-cover-overlay { position: absolute; inset: 0; background: linear-gradient(to top, var(--bg) 0%, transparent 60%); }
        .series-detail-info { padding: 20px 16px; flex: 1; overflow-y: auto; }
        .series-detail-name { font-size: 22px; font-weight: 800; margin-bottom: 6px; }
        .series-detail-desc { font-size: 14px; color: var(--text-secondary); line-height: 1.6; margin-bottom: 12px; }
        .series-detail-stats { display: flex; gap: 16px; font-size: 13px; color: var(--text-tertiary); margin-bottom: 20px; }
        .play-all-btn { width: 100%; padding: 16px; background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end)); border: none; border-radius: var(--radius-md); color: #fff; font-size: 15px; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; transition: all 0.2s ease; margin-bottom: 20px; }
        .play-all-btn:active { transform: scale(0.97); }
        .episode-list { display: flex; flex-direction: column; gap: 2px; }
        .episode-item { display: flex; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--border); cursor: pointer; transition: all 0.2s ease; }
        .episode-item:last-child { border-bottom: none; }
        .episode-item:active { opacity: 0.7; }
        .episode-thumb { width: 120px; height: 68px; border-radius: 10px; overflow: hidden; position: relative; flex-shrink: 0; border: 1px solid var(--border); }
        .episode-thumb img { width: 100%; height: 100%; object-fit: cover; }
        .episode-dur { position: absolute; bottom: 4px; right: 4px; background: rgba(0,0,0,0.8); color: #fff; font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 4px; }
        .episode-info { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; }
        .episode-num { font-size: 11px; color: var(--primary); font-weight: 600; margin-bottom: 2px; }
        .episode-title { font-size: 14px; font-weight: 600; line-height: 1.3; margin-bottom: 3px; }
        .episode-meta { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-tertiary); }
        .episode-check { color: var(--success); font-size: 14px; }

        /* ========== LIVE TAB ========== */
        .live-active-section { padding: 0 16px; }
        .live-embed { width: 100%; aspect-ratio: 16/9; border-radius: var(--radius-md); overflow: hidden; background: #000; border: 1px solid var(--border); position: relative; display: flex; align-items: center; justify-content: center; margin-bottom: 16px; }
        .live-embed-placeholder { color: var(--text-tertiary); text-align: center; }
        .live-embed-placeholder i { font-size: 48px; margin-bottom: 12px; opacity: 0.5; }
        .live-header { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
        .live-header h2 { font-size: 18px; font-weight: 700; flex: 1; }
        .live-viewers { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--text-secondary); }
        .live-share-btn { padding: 10px 18px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-md); color: var(--text-primary); font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 8px; cursor: pointer; transition: all 0.2s ease; }
        .live-share-btn:active { background: var(--surface-elevated); transform: scale(0.97); }

        .live-empty { display: flex; flex-direction: column; align-items: center; padding: 40px 16px; text-align: center; }
        .live-empty-icon { width: 80px; height: 80px; border-radius: var(--radius-full); background: var(--surface); display: flex; align-items: center; justify-content: center; margin-bottom: 16px; font-size: 32px; color: var(--text-tertiary); }
        .live-empty h3 { font-size: 18px; font-weight: 700; margin-bottom: 6px; }
        .live-empty p { font-size: 14px; color: var(--text-secondary); margin-bottom: 20px; }

        .next-scheduled { margin: 0 16px; padding: 16px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-md); display: flex; align-items: center; gap: 14px; }
        .next-scheduled-icon { width: 44px; height: 44px; border-radius: var(--radius-sm); background: rgba(232,168,56,0.12); display: flex; align-items: center; justify-content: center; color: var(--primary); font-size: 18px; flex-shrink: 0; }
        .next-scheduled-info { flex: 1; }
        .next-scheduled-title { font-size: 14px; font-weight: 600; }
        .next-scheduled-time { font-size: 12px; color: var(--text-tertiary); margin-top: 2px; }
        .next-remind-btn { padding: 8px 14px; background: var(--primary); border: none; border-radius: 10px; color: #fff; font-size: 12px; font-weight: 700; cursor: pointer; flex-shrink: 0; }

        .past-broadcasts { padding: 0 16px; }
        .past-item { display: flex; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--border); }
        .past-item:last-child { border-bottom: none; }
        .past-thumb { width: 100px; height: 56px; border-radius: 10px; overflow: hidden; flex-shrink: 0; border: 1px solid var(--border); }
        .past-thumb img { width: 100%; height: 100%; object-fit: cover; }
        .past-info { flex: 1; min-width: 0; }
        .past-title { font-size: 13px; font-weight: 600; margin-bottom: 3px; line-height: 1.3; }
        .past-meta { font-size: 11px; color: var(--text-tertiary); }

        /* ========== SEARCH TAB ========== */
        .search-section { padding: 0 16px; }
        .search-input-wrapper { position: relative; margin-bottom: 16px; }
        .search-input-wrapper i { position: absolute; left: 16px; top: 50%; transform: translateY(-50%); color: var(--text-tertiary); font-size: 16px; }
        .search-input-wrapper input { width: 100%; padding: 14px 16px 14px 46px; background: var(--surface); border: 1.5px solid var(--border); border-radius: var(--radius-md); color: var(--text-primary); font-size: 16px; font-weight: 500; outline: none; transition: all 0.2s ease; }
        .search-input-wrapper input:focus { border-color: var(--primary); background: var(--surface-elevated); }
        .search-input-wrapper input::placeholder { color: var(--text-tertiary); font-weight: 400; }
        .search-clear { position: absolute; right: 14px; top: 50%; transform: translateY(-50%); background: none; border: none; color: var(--text-tertiary); font-size: 16px; cursor: pointer; display: none; }
        .search-clear.visible { display: block; }

        .search-recent-section { margin-bottom: 20px; }
        .search-recent-title { font-size: 14px; font-weight: 600; color: var(--text-secondary); margin-bottom: 10px; display: flex; align-items: center; gap: 8px; }
        .search-recent-tags { display: flex; flex-wrap: wrap; gap: 8px; }
        .search-recent-tag { padding: 8px 14px; background: var(--surface); border: 1px solid var(--border); border-radius: 20px; color: var(--text-secondary); font-size: 13px; font-weight: 500; cursor: pointer; transition: all 0.2s ease; }
        .search-recent-tag:active { background: var(--surface-elevated); }

        .search-trending-title { font-size: 14px; font-weight: 600; color: var(--text-secondary); margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
        .search-trending-items { display: flex; flex-direction: column; gap: 2px; }
        .search-trending-item { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--border); cursor: pointer; }
        .search-trending-item:last-child { border-bottom: none; }
        .search-trending-item:active { opacity: 0.7; }
        .search-trending-num { width: 24px; font-size: 14px; font-weight: 800; color: var(--text-tertiary); text-align: center; }
        .search-trending-thumb { width: 60px; height: 40px; border-radius: 8px; overflow: hidden; flex-shrink: 0; border: 1px solid var(--border); }
        .search-trending-thumb img { width: 100%; height: 100%; object-fit: cover; }
        .search-trending-info { flex: 1; min-width: 0; }
        .search-trending-title { font-size: 13px; font-weight: 600; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .search-trending-meta { font-size: 11px; color: var(--text-tertiary); }
        .search-trending-views { font-size: 11px; color: var(--text-tertiary); flex-shrink: 0; }

        .search-result-item { display: flex; gap: 12px; padding: 14px 0; border-bottom: 1px solid var(--border); cursor: pointer; transition: opacity 0.2s ease; }
        .search-result-item:last-child { border-bottom: none; }
        .search-result-item:active { opacity: 0.6; }
        .search-result-thumb { width: 140px; height: 80px; border-radius: var(--radius-sm); overflow: hidden; position: relative; flex-shrink: 0; border: 1px solid var(--border); }
        .search-result-thumb img { width: 100%; height: 100%; object-fit: cover; }
        .search-result-dur { position: absolute; bottom: 6px; right: 6px; background: rgba(0,0,0,0.8); color: #fff; font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 4px; }
        .search-result-info { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; }
        .search-result-title { font-size: 14px; font-weight: 600; line-height: 1.3; margin-bottom: 4px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .search-result-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 12px; color: var(--text-tertiary); }
        .search-result-cat { padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; text-transform: uppercase; color: #fff; }
        .search-empty { text-align: center; padding: 40px 16px; color: var(--text-tertiary); }
        .search-empty i { font-size: 40px; margin-bottom: 12px; opacity: 0.5; }
        .search-empty h3 { font-size: 16px; font-weight: 600; color: var(--text-secondary); margin-bottom: 6px; }
        .search-load-more { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 20px 0; }
        .search-load-more-btn { width: 100%; padding: 14px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-md); color: var(--primary); font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s ease; display: flex; align-items: center; justify-content: center; gap: 8px; }
        .search-load-more-btn:active { background: var(--surface-elevated); transform: scale(0.97); }
        .search-load-count { font-size: 12px; color: var(--text-tertiary); }

        /* ========== VIDEO PLAYER MODAL ========== */
        .player-modal { position: fixed; inset: 0; background: var(--bg); z-index: 5000; display: flex; flex-direction: column; transform: translateY(100%); transition: transform 0.4s cubic-bezier(0.32, 0.72, 0, 1); }
        .player-modal.active { transform: translateY(0); }

        .player-top-bar { padding: env(safe-area-inset-top, 20px) 16px 8px; display: flex; align-items: center; justify-content: space-between; background: #000; }
        .player-close { width: 36px; height: 36px; border-radius: var(--radius-full); background: rgba(255,255,255,0.1); border: none; color: #fff; font-size: 18px; display: flex; align-items: center; justify-content: center; cursor: pointer; }
        .player-close:active { background: rgba(255,255,255,0.2); }

        .player-video-area { width: 100%; aspect-ratio: 16/9; background: #000; position: relative; display: flex; flex-direction: column; justify-content: center; align-items: center; }
        .player-video-area img { width: 100%; height: 100%; object-fit: cover; position: absolute; inset: 0; opacity: 0.5; }
        .player-yt-embed { position: absolute; inset: 0; z-index: 2; display: flex; align-items: center; justify-content: center; }
        .player-yt-icon { font-size: 48px; color: var(--error); }

        .player-controls-overlay { position: absolute; inset: 0; z-index: 3; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 20px; }
        .player-center-controls { display: flex; align-items: center; gap: 30px; }
        .player-ctrl-btn { background: none; border: none; color: rgba(255,255,255,0.85); font-size: 22px; cursor: pointer; transition: all 0.2s ease; width: 48px; height: 48px; display: flex; align-items: center; justify-content: center; border-radius: var(--radius-full); }
        .player-ctrl-btn:active { background: rgba(255,255,255,0.15); transform: scale(0.9); }
        .player-ctrl-btn.main { width: 64px; height: 64px; background: rgba(255,255,255,0.95); color: var(--bg); font-size: 26px; box-shadow: 0 4px 20px rgba(0,0,0,0.4); }
        .player-ctrl-btn.main:active { background: rgba(255,255,255,0.8); }

        .player-bottom-controls { position: absolute; bottom: 0; left: 0; right: 0; padding: 0 16px 12px; z-index: 3; }
        .player-progress-bar { width: 100%; height: 4px; background: rgba(255,255,255,0.2); border-radius: 2px; cursor: pointer; position: relative; margin-bottom: 8px; }
        .player-progress-fill { height: 100%; background: var(--primary); border-radius: 2px; position: relative; }
        .player-progress-fill::after { content: ''; position: absolute; right: -6px; top: -4px; width: 12px; height: 12px; background: var(--primary); border-radius: var(--radius-full); opacity: 0; transition: opacity 0.2s; }
        .player-progress-bar:hover .player-progress-fill::after { opacity: 1; }
        .player-time-row { display: flex; justify-content: space-between; font-size: 11px; color: rgba(255,255,255,0.6); font-weight: 500; }

        .player-bottom-bar { display: flex; align-items: center; gap: 12px; padding: 4px 0; }
        .player-volume-area { display: flex; align-items: center; gap: 8px; }
        .player-volume-btn { background: none; border: none; color: rgba(255,255,255,0.7); font-size: 14px; cursor: pointer; }
        .player-volume-slider { width: 60px; height: 3px; -webkit-appearance: none; appearance: none; background: rgba(255,255,255,0.2); border-radius: 2px; outline: none; cursor: pointer; }
        .player-volume-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 12px; height: 12px; border-radius: var(--radius-full); background: #fff; cursor: pointer; }
        .player-fullscreen-btn { margin-left: auto; background: none; border: none; color: rgba(255,255,255,0.7); font-size: 16px; cursor: pointer; }

        .player-info { padding: 16px; flex: 1; overflow-y: auto; }
        .player-info h2 { font-size: 18px; font-weight: 700; line-height: 1.3; margin-bottom: 8px; }
        .player-info-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 13px; color: var(--text-secondary); margin-bottom: 14px; }
        .player-info-meta .dot { width: 3px; height: 3px; background: var(--text-tertiary); border-radius: var(--radius-full); }
        .player-actions-row { display: flex; gap: 10px; margin-bottom: 16px; }
        .player-action-btn { flex: 1; padding: 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; color: var(--text-primary); font-size: 13px; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer; transition: all 0.2s ease; }
        .player-action-btn:active { background: var(--surface-elevated); transform: scale(0.97); }
        .player-action-btn.primary { background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end)); border-color: transparent; color: #fff; }
        .player-desc { font-size: 14px; color: var(--text-secondary); line-height: 1.7; margin-bottom: 20px; }

        /* ========== UP NEXT ========== */
        .up-next-section { padding: 16px; border-top: 1px solid var(--border); background: var(--bg); }
        .up-next-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
        .up-next-title { font-size: 14px; font-weight: 700; display: flex; align-items: center; gap: 8px; }
        .up-next-title .countdown { font-size: 13px; color: var(--primary); font-weight: 600; }
        .up-next-cancel { background: none; border: none; color: var(--text-tertiary); font-size: 13px; font-weight: 500; cursor: pointer; }
        .up-next-item { display: flex; gap: 12px; padding: 10px; background: var(--surface-card); border: 1px solid var(--border); border-radius: var(--radius-md); cursor: pointer; transition: all 0.2s ease; }
        .up-next-item:active { background: var(--surface-elevated); }
        .up-next-thumb { width: 100px; height: 56px; border-radius: 8px; overflow: hidden; flex-shrink: 0; border: 1px solid var(--border); }
        .up-next-thumb img { width: 100%; height: 100%; object-fit: cover; }
        .up-next-info { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; }
        .up-next-name { font-size: 13px; font-weight: 600; line-height: 1.3; margin-bottom: 2px; }
        .up-next-meta { font-size: 11px; color: var(--text-tertiary); }

        /* ========== RESUME PROMPT ========== */
        .resume-prompt { position: absolute; bottom: 60px; left: 16px; right: 16px; z-index: 10; padding: 14px 18px; background: var(--surface-elevated); border: 1px solid var(--border); border-radius: var(--radius-md); box-shadow: var(--shadow-elevated); display: flex; align-items: center; gap: 12px; animation: slideUp 0.3s ease; }
        @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        .resume-prompt-info { flex: 1; }
        .resume-prompt-title { font-size: 13px; font-weight: 600; }
        .resume-prompt-sub { font-size: 12px; color: var(--text-secondary); margin-top: 2px; }
        .resume-prompt-actions { display: flex; gap: 8px; }
        .resume-btn { padding: 8px 14px; border-radius: 10px; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.2s ease; }
        .resume-btn.primary { background: var(--primary); border: none; color: #fff; }
        .resume-btn.secondary { background: var(--surface); border: 1px solid var(--border); color: var(--text-secondary); }
        .resume-btn:active { transform: scale(0.95); }

        /* ========== OFFLINE BANNER ========== */
        .offline-banner { padding: 10px 16px; background: var(--error); color: #fff; font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 8px; }

        /* ========== EMPTY STATE ========== */
        .empty-state { display: flex; flex-direction: column; align-items: center; padding: 60px 16px; text-align: center; }
        .empty-state-icon { width: 80px; height: 80px; border-radius: var(--radius-full); background: var(--surface); display: flex; align-items: center; justify-content: center; margin-bottom: 16px; font-size: 32px; color: var(--text-tertiary); }
        .empty-state h3 { font-size: 18px; font-weight: 700; margin-bottom: 6px; }
        .empty-state p { font-size: 14px; color: var(--text-secondary); max-width: 280px; }

        /* ========== BOTTOM NAV (override) ========== */
        .bottom-nav { position: fixed; bottom: 0; left: 0; right: 0; background: rgba(15,15,15,0.92); backdrop-filter: blur(20px) saturate(180%); -webkit-backdrop-filter: blur(20px) saturate(180%); border-top: 1px solid var(--border); padding: 8px 0 calc(8px + env(safe-area-inset-bottom, 0px)); z-index: 1000; display: flex; justify-content: space-around; align-items: center; }
        @media (min-width: 480px) { .bottom-nav { max-width: 480px; margin: 0 auto; } }
        .nav-item { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 6px 16px; background: none; border: none; color: var(--text-tertiary); cursor: pointer; transition: all 0.2s ease; position: relative; }
        .nav-item.active { color: var(--primary); }
        .nav-item i { font-size: 22px; transition: transform 0.2s ease; }
        .nav-item:active i { transform: scale(0.85); }
        .nav-item span { font-size: 10px; font-weight: 600; }
        .nav-item .nav-badge { position: absolute; top: 2px; right: 10px; width: 8px; height: 8px; background: var(--error); border-radius: var(--radius-full); border: 2px solid var(--bg); }
      `}</style>

      <ToastBridge />

      <div className="app-container">
        <div className="status-bar"></div>

        {/* ========== OFFLINE BANNER ========== */}
        {offline && (
          <div className="offline-banner">
            <i className="fas fa-wifi-slash"></i>
            <span>You&apos;re offline — check your connection</span>
          </div>
        )}

        {/* ========== HEADER ========== */}
        <div className="header">
          <div className="header-logo"><i className="fas fa-video"></i></div>
          <div className="header-info">
            <div className="header-church">Kingdom Seekers Church Nakuru</div>
          </div>
          <div className="header-actions">
            <button
              className={`live-badge${!isLive && !ytLive.status.isLive ? " off" : ""}`}
              onClick={() => { if (isLive || ytLive.status.isLive) setActiveTab("live"); }}
            >
              <span className="pulse-dot"></span>
              <span>{isLive || ytLive.status.isLive ? "LIVE" : "Off Air"}</span>
            </button>
            <button className="header-btn">
              <i className="fas fa-bell"></i>
              {(isLive || ytLive.status.isLive) && <span className="badge-dot"></span>}
            </button>
          </div>
        </div>

        {/* ========== TABS ========== */}
        <div className="tabs-bar">
          <button className={`tab-btn${activeTab === "home" ? " active" : ""}`} onClick={() => setActiveTab("home")}>
            <i className="fas fa-house"></i> Home
          </button>
          <button className={`tab-btn${activeTab === "series" ? " active" : ""}`} onClick={() => setActiveTab("series")}>
            <i className="fas fa-list"></i> Series
          </button>
          <button className={`tab-btn${activeTab === "live" ? " active" : ""}`} onClick={() => setActiveTab("live")}>
            {(isLive || ytLive.status.isLive) && <span className="pulse-dot" style={{ width: 8, height: 8, background: "var(--live)", borderRadius: "50%", animation: "livePulse 1.5s ease-in-out infinite", display: "inline-block" }}></span>}
            Live
          </button>
          <button className={`tab-btn${activeTab === "search" ? " active" : ""}`} onClick={() => setActiveTab("search")}>
            <i className="fas fa-magnifying-glass"></i> Search
          </button>
        </div>

        {/* ========== CONTENT ========== */}
        <div className="content-scroll">
          {loading && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "40px 16px", color: "var(--text-tertiary)" }}>
              <i className="fas fa-spinner fa-spin" style={{ fontSize: 28, marginBottom: 10 }}></i>
              <p style={{ fontSize: 14 }}>Loading video library...</p>
            </div>
          )}
          {/* ===== TAB 1: HOME ===== */}
          {activeTab === "home" && (
            <>

              {/* Live Now Banner — YouTube or radio */}
              {(isLive || ytLive.status.isLive) && (
                <div className={`live-banner${ytLive.status.isLive && ytLive.status.video?.thumbnail ? " has-bg" : ""}`} onClick={() => setActiveTab("live")}>
                  {ytLive.status.isLive && ytLive.status.video?.thumbnail && (
                    <img className="live-banner-bg" src={ytLive.status.video.thumbnail} alt="" />
                  )}
                  <span className="live-banner-dot"></span>
                  <div className="live-banner-info">
                    <div className="live-banner-title">
                      {ytLive.status.isLive
                        ? ytLive.status.video?.title
                        : "Kingdom Seekers Church Nakuru is streaming live"}
                    </div>
                    <div className="live-banner-meta">
                      {ytLive.status.isLive ? (
                        <><i className="fab fa-youtube" style={{ color: "#FF0000" }}></i> YouTube Live · {formatViewCount(ytLive.status.video?.views || 0)} watching</>
                      ) : (
                        <><span>▶ Radio Live</span><span>·</span><span>🔴 {formatLiveDuration(liveDuration)}</span></>
                      )}
                    </div>
                  </div>
                  <button className="live-banner-btn" onClick={(e) => { e.stopPropagation(); setActiveTab("live"); }}>Watch</button>
                </div>
              )}

              {/* Featured Hero */}
              {(() => {
                const fv = featuredVideos[0] || allVideos[0];
                return (
                  <div className="featured-section">
                    <div className="featured-card" onClick={() => handlePlayVideo(fv)}>
                      <div className="featured-thumb">
                        {fv?.thumbnail ? (
                          <img src={fv.thumbnail} alt="Featured" />
                        ) : (
                          <div className="featured-thumb-placeholder"><i className="fas fa-video"></i></div>
                        )}
                      </div>
                      <div className="featured-overlay">
                        <div className="featured-badge"><i className="fas fa-fire"></i> Featured</div>
                        <div className="featured-title">{fv?.title || ''}</div>
                        <div className="featured-meta">
                          <span>{fv?.viewCount || '0'} views</span>
                          <span className="dot"></span>
                          <span>{fv?.publishedAt || ''}</span>
                        </div>
                      </div>
                      <div className="featured-play-btn"><i className="fas fa-play"></i></div>
                      <div className="featured-duration">{fv?.duration || ''}</div>
                    </div>
                  </div>
                );
              })()}

              {/* Continue Watching */}
              {continueWatching.length > 0 && (
                <>
                  <div className="section-header">
                    <h2 className="section-title"><i className="fas fa-clock-rotate" style={{ fontSize: 14 }}></i> Continue Watching</h2>
                  </div>
                  <div className="h-scroll">
                    {continueWatching.map((video) => {
                      const prog = loadWatchProgress(video.id);
                      const pct = prog ? (prog.position / video.durationSec) * 100 : 0;
                      return (
                        <div className="video-card" key={video.id} onClick={() => handlePlayVideo(video)}>
                          <div className="video-thumb">
                            <img src={video.thumbnail} alt={video.title} />
                            <span className="video-duration">{video.duration}</span>
                            <div className="play-hover"><i className="fas fa-play"></i></div>
                            {pct > 0 && (
                              <div className="video-progress-bar">
                                <div className="video-progress-fill" style={{ width: `${pct}%` }}></div>
                              </div>
                            )}
                          </div>
                          <div className="video-info">
                            <div className="video-title">{video.title}</div>
                            <div className="video-meta">
                              <span>Resume at {formatTime(prog?.position || 0)}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {/* Featured — random videos reshuffled daily */}
              <div className="section-header">
                <h2 className="section-title"><i className="fas fa-star" style={{ fontSize: 14 }}></i> Featured</h2>
                <button className="section-see-all" onClick={() => setActiveTab("search")}>See All <i className="fas fa-chevron-right" style={{ fontSize: 10 }}></i></button>
              </div>
              <div className="video-grid">
                {seededShuffle(allVideos).slice(0, 9).map((video) => (
                  <div className="video-card" key={video.id} onClick={() => handlePlayVideo(video)}>
                    <div className="video-thumb">
                      <img src={video.thumbnail} alt={video.title} />
                      <span className="video-duration">{video.duration}</span>
                      <div className="play-hover"><i className="fas fa-play"></i></div>
                      {watchedVideos.has(video.id) && <span className="watched-badge"><i className="fas fa-check"></i></span>}
                    </div>
                    <div className="video-info">
                      <div className="video-title">{video.title}</div>
                      <div className="video-meta">
                        <span>{video.publishedAt}</span>
                        <span>·</span>
                        <span>{video.viewCount} views</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ height: "8px" }}></div>

              {/* Recent Uploads */}
              <div className="section-header">
                <h2 className="section-title"><i className="fas fa-clock" style={{ fontSize: 14 }}></i> Recent Uploads</h2>
                <button className="section-see-all" onClick={() => setActiveTab("search")}>See All <i className="fas fa-chevron-right" style={{ fontSize: 10 }}></i></button>
              </div>
              <div className="video-grid">
                {recentUploads.slice(0, 9).map((video) => (
                  <div className="video-card" key={video.id} onClick={() => handlePlayVideo(video)}>
                    <div className="video-thumb">
                      <img src={video.thumbnail} alt={video.title} />
                      <span className="video-duration">{video.duration}</span>
                      <div className="play-hover"><i className="fas fa-play"></i></div>
                      {watchedVideos.has(video.id) && <span className="watched-badge"><i className="fas fa-check"></i></span>}
                    </div>
                    <div className="video-info">
                      <div className="video-title">{video.title}</div>
                      <div className="video-meta">
                        <span>{video.publishedAt}</span>
                        <span>·</span>
                        <span>{video.viewCount} views</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ height: "24px" }}></div>
            </>
          )}

          {/* ===== TAB 2: SERIES ===== */}
          {activeTab === "series" && (
            <>
              {/* Filter chips */}
              <div className="series-filter-bar" style={{ paddingTop: 16 }}>
                {["all", "sermon-series", "worship", "bible-study", "events"].map((f) => (
                  <div
                    key={f}
                    className={`series-filter-chip${seriesFilter === f ? " active" : ""}`}
                    onClick={() => setSeriesFilter(f)}
                  >
                    {f === "all" ? "All" : f.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}
                  </div>
                ))}
              </div>

              {/* Series Grid */}
              {filteredSeries.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-icon"><i className="fas fa-list"></i></div>
                  <h3>No series found</h3>
                  <p>No series match the selected filter</p>
                </div>
              ) : (
                <div className="series-grid" style={{ paddingTop: 8, paddingBottom: 40 }}>
                  {filteredSeries.map((series) => (
                    <div
                      className="series-grid-item"
                      key={series.id}
                      onClick={() => { if (series.id) setExpandedSeries(series.id); }}
                    >
                      <div className="series-grid-cover">
                        <img src={series.coverImage} alt={series.name} />
                        <div
                          className="series-grid-badge"
                          style={{
                            background:
                              series.category === "Sermon Series" ? "linear-gradient(135deg, var(--gradient-start), var(--gradient-end))" :
                              series.category === "Worship" ? "linear-gradient(135deg, #8B5CF6, #6D28D9)" :
                              series.category === "Bible Study" ? "linear-gradient(135deg, #3B82F6, #2563EB)" :
                              "linear-gradient(135deg, #EF4444, #DC2626)"
                          }}
                        >
                          {series.category === "Sermon Series" ? "Sermon" : series.category}
                        </div>
                      </div>
                      <div className="series-grid-name">{series.name}</div>
                      <div className="series-grid-count">{series.videoIds.length} videos</div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* ===== TAB 3: LIVE ===== */}
          {activeTab === "live" && (
            <>
              {ytLive.status.isLive && ytLive.status.video ? (
                <div className="live-active-section" style={{ paddingTop: 16 }}>
                  {/* YouTube Embed */}
                  <div className="live-embed">
                    <iframe
                      src={`https://www.youtube.com/embed/${ytLive.status.video.youtubeId}?autoplay=1&rel=0`}
                      allow="autoplay; encrypted-media; fullscreen"
                      allowFullScreen
                      title={ytLive.status.video.title}
                      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }}
                    />
                    <div style={{ position: "absolute", bottom: 12, left: 12, display: "flex", alignItems: "center", gap: 8, zIndex: 2 }}>
                      <span style={{ width: 8, height: 8, background: "var(--live)", borderRadius: "50%", animation: "livePulse 1.5s ease-in-out infinite" }}></span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "#fff", background: "rgba(0,0,0,0.6)", padding: "4px 10px", borderRadius: 6 }}>LIVE</span>
                    </div>
                  </div>

                  {/* Stream Info */}
                  <div className="live-header">
                    <h2>{ytLive.status.video.title}</h2>
                    <div className="live-viewers"><i className="fas fa-eye"></i> {formatViewCount(ytLive.status.video.views)} watching</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-secondary)", marginBottom: 16 }}>
                    <span><i className="fas fa-circle" style={{ color: "var(--live)", fontSize: 8 }}></i> Live</span>
                  </div>

                  <button className="live-share-btn" style={{ width: "100%", marginBottom: 24 }} onClick={handleShare}>
                    <i className="fas fa-share"></i> Share Stream
                  </button>

                  {/* Past broadcasts under live */}
                  <div className="section-header" style={{ paddingLeft: 0, paddingRight: 0 }}>
                    <h2 className="section-title">Recent Videos</h2>
                  </div>
                  <div className="past-broadcasts" style={{ padding: 0 }}>
                    {allVideos.slice(0, 3).map((b) => (
                      <div className="past-item" key={b.id}>
                        <div className="past-thumb">
                          <img src={b.thumbnail} alt={b.title} />
                        </div>
                        <div className="past-info">
                          <div className="past-title">{b.title}</div>
                          <div className="past-meta">{b.viewCount} views · {b.publishedAt} · {b.duration}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  {/* No live stream */}
                  <div className="live-empty">
                    <div className="live-empty-icon"><i className="fas fa-video-slash"></i></div>
                    <h3>No live stream right now</h3>
                    <p>Check back for upcoming broadcasts or browse past recordings</p>
                  </div>

                  {/* Next Scheduled */}
                  <div className="next-scheduled">
                    <div className="next-scheduled-icon"><i className="fas fa-calendar"></i></div>
                    <div className="next-scheduled-info">
                      <div className="next-scheduled-title">Sunday Worship Service</div>
                      <div className="next-scheduled-time">Sunday at 9:00 AM</div>
                    </div>
                    <button className="next-remind-btn" onClick={() => {
                      window.dispatchEvent(new CustomEvent("show-toast", {
                        detail: { title: "Reminder Set", message: "We'll notify you when this broadcast starts", type: "success", duration: 2500 },
                      }));
                    }}>Remind Me</button>
                  </div>

                  {/* Recent Videos */}
                  <div className="section-header">
                    <h2 className="section-title">Recent Videos</h2>
                  </div>
                  <div className="past-broadcasts" style={{ paddingBottom: 40 }}>
                    {allVideos.slice(0, 3).map((b) => (
                      <div className="past-item" key={b.id}>
                        <div className="past-thumb">
                          <img src={b.thumbnail} alt={b.title} />
                        </div>
                        <div className="past-info">
                          <div className="past-title">{b.title}</div>
                          <div className="past-meta">{b.viewCount} views · {b.publishedAt} · {b.duration}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}

          {/* ===== TAB 4: SEARCH ===== */}
          {activeTab === "search" && (
            <div className="search-section" style={{ paddingTop: 16 }}>
              <div className="search-input-wrapper">
                <i className="fas fa-magnifying-glass"></i>
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Search sermons, worship, events..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                  <button className="search-clear visible" onClick={() => { setSearchQuery(""); setShowSearchResults(false); }}>
                    <i className="fas fa-xmark"></i>
                  </button>
                )}
              </div>

              {showSearchResults ? (
                searchResults.length === 0 ? (
                  <div className="search-empty">
                    <i className="fas fa-search"></i>
                    <h3>No videos found for &quot;{submittedSearch}&quot;</h3>
                    <p>Try a different search term</p>
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 12, fontWeight: 500 }}>
                      {searchResults.length} result{searchResults.length !== 1 ? "s" : ""} for &quot;{submittedSearch}&quot;
                    </div>
                    {searchResults.slice(0, searchPageSize).map((video) => (
                      <div className="search-result-item" key={video.id} onClick={() => handlePlayVideo(video)}>
                        <div className="search-result-thumb">
                          <img src={video.thumbnail} alt={video.title} />
                          <span className="search-result-dur">{video.duration}</span>
                        </div>
                        <div className="search-result-info">
                          <div className="search-result-title">{video.title}</div>
                          <div className="search-result-meta">
                            <span
                              className="search-result-cat"
                              style={{
                                background:
                                  video.category === "Sermon" ? "linear-gradient(135deg, var(--gradient-start), var(--gradient-end))" :
                                  video.category === "Worship" ? "linear-gradient(135deg, #8B5CF6, #6D28D9)" :
                                  video.category === "Testimony" ? "linear-gradient(135deg, #4ADE80, #22C55E)" :
                                  video.category === "Bible Study" ? "linear-gradient(135deg, #3B82F6, #2563EB)" :
                                  "linear-gradient(135deg, #EF4444, #DC2626)"
                              }}
                            >
                              {video.category}
                            </span>
                            {video.seriesName && <span>{video.seriesName}</span>}
                            <span>·</span>
                            <span>{video.viewCount} views</span>
                          </div>
                        </div>
                      </div>
                    ))}
                    {searchResults.length > searchPageSize && (
                      <div className="search-load-more">
                        <button className="search-load-more-btn" onClick={() => setSearchPageSize(p => p + 12)}>
                          <i className="fas fa-chevron-down"></i> Load More
                        </button>
                        <span className="search-load-count">Showing {Math.min(searchPageSize, searchResults.length)} of {searchResults.length}</span>
                      </div>
                    )}
                  </>
                )
              ) : (
                <>
                  {/* Recent Searches */}
                  {localSearches.length > 0 && (
                    <div className="search-recent-section">
                      <div className="search-recent-title"><i className="fas fa-clock-rotate"></i> Recent Searches</div>
                      <div className="search-recent-tags">
                        {localSearches.map((s, i) => (
                          <div className="search-recent-tag" key={i} onClick={() => setSearchQuery(s)}>
                            {s}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Trending / Popular */}
                  <div className="search-trending-title" style={{ marginTop: localSearches.length > 0 ? 0 : 0 }}>
                    <i className="fas fa-fire" style={{ color: "var(--live)" }}></i> Trending
                  </div>
                  <div className="search-trending-items">
                    {allVideos.slice(0, 5).map((video, i) => (
                      <div className="search-trending-item" key={video.id} onClick={() => handlePlayVideo(video)}>
                        <div className="search-trending-num">#{i + 1}</div>
                        <div className="search-trending-thumb">
                          <img src={video.thumbnail} alt={video.title} />
                        </div>
                        <div className="search-trending-info">
                          <div className="search-trending-title">{video.title}</div>
                          <div className="search-trending-meta">{video.publishedAt}</div>
                        </div>
                        <div className="search-trending-views">{video.viewCount} views</div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div style={{ height: 40 }}></div>
            </div>
          )}

        </div>

        {/* ========== SERIES DETAIL MODAL ========== */}
        <div className={`series-detail-modal${expandedSeries ? " active" : ""}`}>
          {expandedSeries && (() => {
            const series = seriesList.find((s) => s.id === expandedSeries);
            if (!series) return null;
            const videos = getSeriesVideos(series.id!);
            return (
              <>
                <button className="series-detail-close" onClick={() => setExpandedSeries(null)}>
                  <i className="fas fa-xmark"></i>
                </button>
                <div className="series-detail-cover">
                  <img src={series.coverImage} alt={series.name} />
                  <div className="series-detail-cover-overlay"></div>
                </div>
                <div className="series-detail-info">
                  <div className="series-detail-name">{series.name}</div>
                  <div className="series-detail-desc">{series.description}</div>
                  <div className="series-detail-stats">
                    <span>{videos.length} episodes</span>
                    <span>·</span>
                    <span>{series.createdAt}</span>
                  </div>
                  <button className="play-all-btn" onClick={() => series.id && handlePlayAll(series.id)}>
                    <i className="fas fa-play"></i> Play All ({videos.length} episodes)
                  </button>
                  <div className="episode-list">
                    {videos.map((video, idx) => {
                      const prog = loadWatchProgress(video.id);
                      const isCompleted = watchedVideos.has(video.id);
                      const pct = prog ? (prog.position / video.durationSec) * 100 : 0;
                      return (
                        <div className="episode-item" key={video.id} onClick={() => { handlePlayVideo(video); setExpandedSeries(null); }}>
                          <div className="episode-thumb">
                            <img src={video.thumbnail} alt={video.title} />
                            <span className="episode-dur">{video.duration}</span>
                          </div>
                          <div className="episode-info">
                            {video.episode && <div className="episode-num">Episode {video.episode}</div>}
                            <div className="episode-title">{video.title}</div>
                            <div className="episode-meta">
                              {isCompleted ? (
                                <><span className="episode-check"><i className="fas fa-check-circle"></i></span><span>Watched</span></>
                              ) : pct > 0 ? (
                                <span>{Math.round(pct)}% watched</span>
                              ) : null}
                              {!pct || pct === 0 ? <span>{video.duration}</span> : null}
                              <span>·</span>
                              <span>{video.viewCount} views</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            );
          })()}
        </div>

        {/* ========== VIDEO PLAYER MODAL ========== */}
        {/* Video player handled by global VideoPlayerProvider at layout level */}

        <BottomNavBar activeTab="watch" />
      </div>
    </>
  );
}
