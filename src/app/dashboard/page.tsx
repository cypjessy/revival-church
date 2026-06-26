"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { signOut as firebaseSignOut } from "firebase/auth";
import { churchConfig } from "@/lib/churchConfig";
import { auth } from "@/lib/firebase";
import { useAppStore } from "@/lib/useAppStore";
import BottomNavBar from "@/components/shared/BottomNavBar";
import ToastBridge from "@/components/dashboard/ToastBridge";
import { useVideoPlayer } from "@/components/shared/VideoPlayer";
import { useImageLightbox } from "@/components/shared/ImageLightbox";
import { getNowPlaying, getSongHistory, getPlaylists, getStationId, getPublicPlayerUrl } from "@/lib/azuracast";
import { getVideosPage, getSeries } from "@/lib/youtube";
import { getAlbums } from "@/lib/albums";
import { getAllAlbumEntries } from "@/lib/albumEntries";
import type { YouTubeVideo, YouTubeSeries } from "@/lib/youtube";
import { useYouTubeLive } from "@/hooks/useYouTubeLive";
import { useAudio } from "@/lib/audio/AudioContext";
import type { NowPlayingData, SongHistoryItem, Playlist } from "@/lib/azuracast";
import type { Album } from "@/lib/albums";
import type { AlbumEntry } from "@/lib/albumEntries";

function timeAgo(dateStr: string): string {
  if (!dateStr) return "";
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

interface ScheduleSlot {
  time: string;
  label: string;
  stationName: string;
  stationId: number;
  ended: boolean;
  isNow: boolean;
}

/* ==================================================================
   MOCK DATA
   ================================================================== */

const church = {
  name: "Turningpoint Church Nakuru",
  tagline: "Worship. Word. Community.",
  logoInitials: "TP",
};

const memberName = "Derick";

function getFallbackSchedule(): ScheduleSlot[] {
  const h = new Date().getHours();
  if (h < 6)  return [{ time: "6:00 AM", label: "No broadcasts scheduled", stationName: "", stationId: 0, ended: false, isNow: false }];
  if (h < 9)  return [{ time: "6:00 AM", label: "Morning Devotion", stationName: "Turningpoint", stationId: 1, ended: false, isNow: true }, { time: "9:00 AM", label: "Sunday Worship", stationName: "Turningpoint", stationId: 1, ended: false, isNow: false }];
  if (h < 14) return [{ time: "6:00 AM", label: "Morning Devotion", stationName: "Turningpoint", stationId: 1, ended: true, isNow: false }, { time: "9:00 AM", label: "Sunday Worship", stationName: "Turningpoint", stationId: 1, ended: false, isNow: true }, { time: "2:00 PM", label: "Afternoon Praise", stationName: "Turningpoint", stationId: 1, ended: false, isNow: false }];
  if (h < 19) return [{ time: "6:00 AM", label: "Morning Devotion", stationName: "Turningpoint", stationId: 1, ended: true, isNow: false }, { time: "9:00 AM", label: "Sunday Worship", stationName: "Turningpoint", stationId: 1, ended: true, isNow: false }, { time: "2:00 PM", label: "Afternoon Praise", stationName: "Turningpoint", stationId: 1, ended: false, isNow: true }, { time: "7:00 PM", label: "Evening Service", stationName: "Turningpoint", stationId: 1, ended: false, isNow: false }];
  return [
    { time: "6:00 AM", label: "Morning Devotion", stationName: "Turningpoint", stationId: 1, ended: true, isNow: false },
    { time: "9:00 AM", label: "Sunday Worship", stationName: "Turningpoint", stationId: 1, ended: true, isNow: false },
    { time: "2:00 PM", label: "Afternoon Praise", stationName: "Turningpoint", stationId: 1, ended: true, isNow: false },
    { time: "7:00 PM", label: "Evening Service", stationName: "Turningpoint", stationId: 1, ended: false, isNow: true },
  ];
}

function computeTodaySchedule(stationId: number, stationName: string, playlists: Playlist[]): ScheduleSlot[] {
  const today = new Date().getDay();
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const items: ScheduleSlot[] = [];
  for (const p of playlists) {
    if (p.type !== "scheduled" || !p.schedule) continue;
    if (!p.schedule.days.some((d) => d === today)) continue;
    const [sh, sm] = p.schedule.startTime.split(":").map(Number);
    const [eh, em] = p.schedule.endTime.split(":").map(Number);
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;
    const hour = sh % 12 || 12;
    const ampm = sh >= 12 ? "PM" : "AM";
    const time = `${hour}:${String(sm).padStart(2, "0")} ${ampm}`;
    items.push({ time, label: p.name, stationName, stationId, ended: nowMinutes > endMin, isNow: nowMinutes >= startMin && nowMinutes <= endMin });
  }
  items.sort((a, b) => {
    const aH = parseInt(a.time.split(":")[0]) + (a.time.includes("PM") && parseInt(a.time.split(":")[0]) !== 12 ? 12 : 0) - (a.time.includes("AM") && parseInt(a.time.split(":")[0]) === 12 ? 12 : 0);
    const bH = parseInt(b.time.split(":")[0]) + (b.time.includes("PM") && parseInt(b.time.split(":")[0]) !== 12 ? 12 : 0) - (b.time.includes("AM") && parseInt(b.time.split(":")[0]) === 12 ? 12 : 0);
    const aM = parseInt(a.time.split(":")[1].split(" ")[0]);
    const bM = parseInt(b.time.split(":")[1].split(" ")[0]);
    return (aH * 60 + aM) - (bH * 60 + bM);
  });
  return items;
}

/* ==================================================================
   HELPERS
   ================================================================== */

function getGreeting(): { text: string; emoji: string } {
  const h = new Date().getHours();
  if (h < 12) return { text: "Good Morning", emoji: "🌅" };
  if (h < 17) return { text: "Good Afternoon", emoji: "☀️" };
  return { text: "Good Evening", emoji: "🌙" };
}

function parseTimeToMinutes(time: string): number {
  const [hhmm, ampm] = time.split(" ");
  let [h, m] = hhmm.split(":").map(Number);
  if (ampm === "PM" && h !== 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  return h * 60 + m;
}

/* ==================================================================
   ROTATING GALLERY COMPONENT
   ================================================================== */

function RotatingGallery({
  albums,
  entries,
  albumsLoading,
  galleryIndices,
  setGalleryIndices,
  onAlbumClick,
}: {
  albums: Album[];
  entries: AlbumEntry[];
  albumsLoading: boolean;
  galleryIndices: number[];
  setGalleryIndices: React.Dispatch<React.SetStateAction<number[]>>;
  onAlbumClick: (albumId: string, images: { url: string; title: string }[]) => void;
}) {
  const router = useRouter();

  const validAlbums = useMemo(() => {
    return albums.filter((a) => a.photoCount > 0 || entries.some((e) => e.albumId === a.id));
  }, [albums, entries]);

  // Build a flat list of all images (url + album info) for the hero slideshow
  const heroImages = useMemo(() => {
    const all: { url: string; albumId: string; albumTitle: string; photoCount: number }[] = [];
    for (const album of validAlbums) {
      const imgs: string[] = [];
      if (album.coverUrl) imgs.push(album.coverUrl);
      const albumEntries = entries.filter((e) => e.albumId === album.id && e.coverUrl);
      albumEntries.forEach((e) => { if (e.coverUrl) imgs.push(e.coverUrl); });
      for (const url of imgs) {
        all.push({
          url,
          albumId: album.id,
          albumTitle: album.title,
          photoCount: album.photoCount || albumEntries.length,
        });
      }
    }
    // Shuffle for variety on each load
    return all.sort(() => Math.random() - 0.5);
  }, [validAlbums, entries]);

  const intervalRefs = useRef<(ReturnType<typeof setInterval> | null)[]>([]);

  const [heroIdx, setHeroIdx] = useState(0);

  // Auto-cycle hero every 4 seconds
  useEffect(() => {
    if (heroImages.length < 2) return;
    const interval = setInterval(() => {
      setHeroIdx((prev) => (prev + 1) % heroImages.length);
    }, 4000);
    return () => clearInterval(interval);
  }, [heroImages.length]);

  // Small grid display (first 6 albums)
  const displayCount = 6;
  const displayAlbums = useMemo(() => {
    const shuffled = [...validAlbums].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, displayCount);
  }, [validAlbums, albumsLoading]);

  const getAlbumImages = useCallback((album: Album): string[] => {
    const imgs: string[] = [];
    if (album.coverUrl) imgs.push(album.coverUrl);
    const albumEntries = entries.filter((e) => e.albumId === album.id && e.coverUrl);
    albumEntries.forEach((e) => { if (e.coverUrl) imgs.push(e.coverUrl); });
    if (imgs.length === 0 && album.coverUrl) imgs.push(album.coverUrl);
    if (imgs.length === 0) imgs.push("");
    return imgs;
  }, [entries]);

  useEffect(() => {
    if (displayAlbums.length === 0) return;
    displayAlbums.forEach((album, idx) => {
      const images = getAlbumImages(album);
      if (images.length < 2) return;
      const interval = setInterval(() => {
        setGalleryIndices((prev: number[]) => {
          const next = [...prev];
          next[idx] = ((next[idx] || 0) + 1) % images.length;
          return next;
        });
      }, 3000 + Math.random() * 3000);
      intervalRefs.current[idx] = interval;
    });
    return () => {
      intervalRefs.current.forEach((interval) => {
        if (interval) clearInterval(interval);
      });
      intervalRefs.current = [];
    };
  }, [displayAlbums, getAlbumImages, setGalleryIndices]);

  const galleryAccents = ["#E8A838", "#8B5CF6", "#22C55E", "#3B82F6", "#EF4444", "#F59E0B", "#EC4899"];
  const currentHero = heroImages[heroIdx];

  if (validAlbums.length === 0) return null;

  return (
    <section className="feed-section">
      <div className="section-header-inline">
        <h2 className="section-title">Photo Gallery <span className="section-title-badge">{validAlbums.length} albums</span></h2>
              <button className="section-link" onClick={() => router.push("/gallery")}>View All <i className="fas fa-chevron-right"></i></button>
      </div>

      {/* Hero slideshow — large auto-playing banner */}
      {heroImages.length > 0 && (
        <div className="pg-hero" onClick={() => {
          if (currentHero) {
            const albumImages = entries
              .filter((e) => e.albumId === currentHero.albumId && e.coverUrl)
              .map((e) => ({ url: e.coverUrl!, title: e.title || currentHero.albumTitle }));
            if (currentHero.url) {
              const coverEntry = albums.find((a) => a.id === currentHero.albumId);
              if (coverEntry?.coverUrl) {
                albumImages.unshift({ url: coverEntry.coverUrl, title: currentHero.albumTitle });
              }
            }
            onAlbumClick(currentHero.albumId, albumImages.length > 0 ? albumImages : [{ url: currentHero.url, title: currentHero.albumTitle }]);
          }
        }}>
          <div className="pg-hero-bg">
            {currentHero && (
              <img
                key={heroIdx}
                className="pg-hero-img"
                src={currentHero.url}
                alt=""
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            )}
          </div>
          {currentHero && (
            <>
              <div className="pg-hero-gradient"></div>
              <div className="pg-hero-body">
                <div className="pg-hero-label">Featured Album</div>
                <div className="pg-hero-title">{currentHero.albumTitle}</div>
                <div className="pg-hero-meta">{currentHero.photoCount} photos · Tap to explore</div>
              </div>
              <div className="pg-hero-dots">
                {heroImages.slice(0, Math.min(heroImages.length, 24)).map((_, i) => (
                  <span
                    key={i}
                    className={`pg-hero-dot${i === heroIdx % Math.min(heroImages.length, 24) ? " active" : ""}`}
                    onClick={(e) => { e.stopPropagation(); setHeroIdx(i); }}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Thumbnail grid — small cards that navigate to album */}
      {displayAlbums.length > 0 && (
        <div className="pg-grid">
          {displayAlbums.map((album, idx) => {
            const images = getAlbumImages(album);
            const imgIdx = galleryIndices[idx] ?? 0;
            const currentImage = images[imgIdx % images.length] || "";
            const isCycling = images.length > 1;
            const accent = galleryAccents[idx % galleryAccents.length];

            return (
              <div
                className="pg-card"
                key={album.id}
                onClick={() => {
                  const albumImages = getAlbumImages(album);
                  const albumEntry = entries.filter((e) => e.albumId === album.id);
                  const imageList = albumImages.map((u, i) => ({
                    url: u,
                    title: albumEntry[i]?.title || album.title,
                  }));
                  onAlbumClick(album.id, imageList);
                }}
              >
                <div className="pg-glow" style={{ background: `radial-gradient(circle at 50% 0%, ${accent}33, transparent 70%)` }} />
                <div className="pg-inner">
                  {currentImage ? (
                    <img className="pg-img" key={`${album.id}-${imgIdx}`} src={currentImage} alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  ) : (
                    <div className="pg-img-placeholder">
                      <i className="fas fa-image"></i>
                    </div>
                  )}
                  {isCycling && (
                    <div className="pg-cycling">
                      <i className="fas fa-random"></i>
                    </div>
                  )}
                </div>
                <div className="pg-accent-bar" style={{ background: accent }} />
                <div className="pg-overlay">
                  <div className="pg-title">{album.title}</div>
                  <div className="pg-count">{album.photoCount || entries.filter((e) => e.albumId === album.id).length} photos</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/* ==================================================================
   COMPONENT
   ================================================================== */

export default function DashboardPage() {
  const router = useRouter();
  const storeLogout = useAppStore((s) => s.logout);
  const greeting = getGreeting();

  const handleLogout = async () => {
    try {
      await firebaseSignOut(auth);
      storeLogout();
    } catch (_) {}
    window.location.href = "/";
  };
  const [showOnboarding, setShowOnboarding] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("onboarding_done") !== "true";
    }
    return true;
  });
  const [onboardingSlide, setOnboardingSlide] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [listeners, setListeners] = useState(0);
  const [npData, setNpData] = useState<NowPlayingData | null>(null);
  const [songHistory, setSongHistory] = useState<SongHistoryItem[]>([]);
  const [videos, setVideos] = useState<YouTubeVideo[]>([]);
  const [seriesList, setSeriesList] = useState<YouTubeSeries[]>([]);
  const [radioLoading, setRadioLoading] = useState(true);
  const [videoLoading, setVideoLoading] = useState(true);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [entries, setEntries] = useState<AlbumEntry[]>([]);
  const [galleryLoading, setGalleryLoading] = useState(true);
  const [galleryIndices, setGalleryIndices] = useState<number[]>([]);
  const [scheduleItems, setScheduleItems] = useState<ScheduleSlot[]>([]);
  const [scheduleLoading, setScheduleLoading] = useState(true);

  const [contentReady, setContentReady] = useState(false);

  // Delay full content render to prevent ANR on Android WebView
  useEffect(() => {
    const timer = setTimeout(() => setContentReady(true), 500);
    return () => clearTimeout(timer);
  }, []);

  const player = useVideoPlayer({ videos, seriesList });
  const imageViewer = useImageLightbox();
  const ytLive = useYouTubeLive();
  const audio = useAudio();

  // Music controls plugin disabled due to native crash on Android
  // const musicControls = useMusicControls({...});

  const contentRef = useRef<HTMLDivElement>(null);
  const [offline, setOffline] = useState(false);

  // Sync local isPlaying with global audio state
  useEffect(() => {
    const streamUrl = npData?.station?.listenUrl || "";
    const nowPlaying = audio.isPlaying && audio.currentStreamUrl === streamUrl;
    setIsPlaying(nowPlaying);
  }, [audio.isPlaying, audio.currentStationId, npData]);

  // Push now-playing metadata to Android media notification when audio is playing
  useEffect(() => {
    if (audio.isPlaying) {
      const np = npData?.nowPlaying;
      const title = np?.song?.title || "Turningpoint Radio";
      const artist = np?.song?.artist || "Turningpoint Church Nakuru";
      const albumArt = np?.song?.albumArt;
      audio.updateMediaSession(title, artist, albumArt);
    }
  }, [audio.isPlaying, npData?.nowPlaying?.song?.title, audio.updateMediaSession]);

  const streamUrl = npData?.station?.listenUrl || "";

  // Network detection via Capacitor
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

  const togglePlay = useCallback(() => {
    if (streamUrl) {
      audio.toggle(streamUrl, Number(getStationId()));
    }
  }, [audio, streamUrl]);

  /* Poll AzuraCast now playing every 10 seconds */
  useEffect(() => {
    let mounted = true;
    const poll = async () => {
      const np = await getNowPlaying(getStationId()).catch(() => null);
      const history = await getSongHistory(5).catch(() => []);
      if (!mounted) return;
      if (np) {
        setNpData(np);
        setListeners(np.listeners.current);
      }
      if (history.length > 0) setSongHistory(history);
      setRadioLoading(false);
    };
    poll();
    const interval = setInterval(poll, 10000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  /* Fetch videos, series, albums, and entries from Firestore on mount */
  useEffect(() => {
    let mounted = true;
    const fetchData = async () => {
      const [page, series, albumList, entryList] = await Promise.all([
        getVideosPage(12).catch(() => ({ videos: [] as YouTubeVideo[], lastDoc: null })),
        getSeries().catch(() => [] as YouTubeSeries[]),
        getAlbums().catch(() => [] as Album[]),
        getAllAlbumEntries().catch(() => [] as AlbumEntry[]),
      ]);
      if (!mounted) return;
      setVideos(page.videos);
      setSeriesList(series);
      setAlbums(albumList);
      setEntries(entryList);
      setVideoLoading(false);
      // Build initial random gallery indices
      const valid = albumList.filter((a) => a.photoCount > 0 || entryList.some((e) => e.albumId === a.id));
      const usedIndices = valid.map(() => Math.floor(Math.random() * 12));
      setGalleryIndices(usedIndices);
      setGalleryLoading(false);
    };
    fetchData();
    return () => { mounted = false; };
  }, []);

  /* Fetch schedule from single station's AzuraCast playlists */
  useEffect(() => {
    let mounted = true;
    const fetchSchedule = async () => {
      const playlists = await getPlaylists().catch(() => [] as Playlist[]);
      if (!mounted) return;
      const stationName = npData?.station?.name || church.name;
      const allSlots = computeTodaySchedule(Number(getStationId()), stationName, playlists);
      allSlots.sort((a, b) => {
        const aMin = parseTimeToMinutes(a.time);
        const bMin = parseTimeToMinutes(b.time);
        return aMin - bMin;
      });
      setScheduleItems(allSlots.length > 0 ? allSlots : getFallbackSchedule());
      setScheduleLoading(false);
    };
    fetchSchedule();
    const interval = setInterval(fetchSchedule, 60000);
    return () => { mounted = false; clearInterval(interval); };
  }, [npData?.station?.name]);



  /* Pull to refresh */
  const [touchStartY, setTouchStartY] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    setTouchStartY(e.touches[0].clientY);
  }, []);

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const diff = e.changedTouches[0].clientY - touchStartY;
      if (contentRef.current && contentRef.current.scrollTop <= 0 && diff > 120) {
        setRefreshing(true);
        setTimeout(() => {
          setRefreshing(false);
          window.dispatchEvent(new CustomEvent("show-toast", { detail: { title: "Refreshed", message: "Content updated", type: "success", duration: 2000 } }));
        }, 1500);
      }
    },
    [touchStartY]
  );

  const onboardingSlides = [
    {
      icon: "fa-church",
      title: `Welcome to ${church.name}`,
      subtitle: "Your church in your pocket",
      color: "var(--gradient-start)",
    },
    {
      icon: "fa-radio",
      title: "Listen Live",
      subtitle: "Tune into our radio station anytime",
      color: "var(--gradient-blue)",
    },
    {
      icon: "fa-bell",
      title: "Stay Connected",
      subtitle: "Get notified when we go live",
      color: "var(--gradient-purple)",
    },
  ];

  const renderHomeTab = () => {
    const np = npData?.nowPlaying;
    const isLive = npData?.live?.isLive ?? false;
    const streamerName = npData?.live?.streamerName;
    const stationName = npData?.station?.name || church.name;
    const progressPct = np && np.duration > 0 ? Math.round((np.elapsed / np.duration) * 100) : 0;
    const featuredVideo = videos.find((v) => v.isFeatured) || videos[0];
    const latestVideos = videos.filter((v) => !v.isFeatured).slice(0, 8);

    return (
    <>
      {/* LIVE BANNER — Radio */}
      {isLive && (
        <div className="live-banner">
          <div className="live-banner-left">
            <div className="live-banner-dot"></div>
            <div className="live-banner-info">
              <div className="live-banner-title">
                {streamerName ? `${streamerName} is on air` : `${stationName} is live`}
              </div>
              <div className="live-banner-sub">
                {stationName} · {listeners} listening
              </div>
            </div>
          </div>              <button className="live-banner-btn" onClick={() => { setIsPlaying(true); router.push("/radio"); }}>
            <i className="fas fa-play"></i> Tune In Now
          </button>
        </div>
      )}

      {/* LIVE BANNER — YouTube */}
      {ytLive.status.isLive && (
        <div className="live-banner" style={{ borderLeftColor: "#FF0000" }} onClick={() => router.push("/watch")}>
          <div className="live-banner-left">
            <div className="live-banner-dot" style={{ background: "#FF0000" }}></div>
            <div className="live-banner-info">
              <div className="live-banner-title">
                {ytLive.status.video?.title || "YouTube Live"}
              </div>
              <div className="live-banner-sub">
                YouTube Live · Watch now
              </div>
            </div>
          </div>
          <button className="live-banner-btn" onClick={(e) => { e.stopPropagation(); router.push("/watch"); }}>
            <i className="fas fa-play"></i> Watch Now
          </button>
        </div>
      )}

      {/* LIVE RADIO — AzuraCast Public Embed */}
      <section className="feed-section">
        <div className="section-header-inline">
          <h2 className="section-title">Live Radio</h2>
          <button className="section-link" onClick={() => router.push("/radio")}>Full Radio <i className="fas fa-chevron-right"></i></button>
        </div>
        <div className="azura-embed">
          <iframe
            src={`${getPublicPlayerUrl()}/embed`}
            frameBorder="0"
            allowTransparency={true}
            style={{ width: "100%", minHeight: 150, height: 150, border: 0, borderRadius: 16 }}
            title="Live Radio"
          />
        </div>
      </section>

      {/* PERSISTENT MINI PLAYER */}
      <section className="feed-section" style={{ paddingTop: 0 }}>
        <div className="minibar">
          <div className="minibar-cover">
            {np?.song?.albumArt ? (
              <img src={np.song.albumArt} alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
            ) : (
              <div className="minibar-cover-fallback"><i className="fas fa-radio"></i></div>
            )}
            {isPlaying && <div className="minibar-eq"><span></span><span></span><span></span></div>}
          </div>
          <div className="minibar-info">
            <div className="minibar-station">{npData?.station?.name || stationName}</div>
            <div className="minibar-track">{np?.song?.title || "Station Offline"}{np?.song?.artist ? ` — ${np.song.artist}` : ""}</div>
          </div>
          <div className="minibar-actions">
            <button className="minibar-play-btn" onClick={togglePlay}>
              <i className={`fas fa-${isPlaying ? "pause" : "play"}`}></i>
            </button>
            <button className="minibar-expand" onClick={() => router.push("/radio")}>
              <i className="fas fa-expand"></i>
            </button>
          </div>
        </div>
      </section>

      {/* Note: Audio is handled globally by AudioProvider at the layout level */}

      {/* RECENTLY PLAYED — glass premium cards */}
      {songHistory.length > 0 && (
      <section className="feed-section">
        <div className="section-header-inline">
          <h2 className="section-title">Now Playing <span className="section-title-badge">Recent</span></h2>
          <button className="section-link" onClick={() => router.push("/radio")}>Full History <i className="fas fa-chevron-right"></i></button>
        </div>
        <div className="rp-list">
          {songHistory.slice(0, 3).map((item, i) => {
            const isNow = i === 0 && isPlaying;
            return (
            <div className={`rp-card${isNow ? " live" : ""}`} key={i}>
              <div className="rp-accent" style={{ opacity: isNow ? 1 : 0.25 }}></div>
              <div className="rp-cover-wrap">
                {item.song.albumArt ? (
                  <img className="rp-cover" src={item.song.albumArt} alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                ) : (
                  <div className="rp-cover rp-cover-fallback">
                    <i className="fas fa-waveform"></i>
                  </div>
                )}

              </div>
              <div className="rp-body">
                <div className="rp-title-row">
                  <span className="rp-title">{item.song.title}</span>
                  {isNow && <span className="rp-live-tag">LIVE</span>}
                </div>
                <div className="rp-artist">{item.song.artist}</div>
                <div className="rp-footer">                      <span className="rp-source"><i className="fas fa-radio"></i> {npData?.station?.name || "Radio"}</span>
                  <span className={`rp-time${isNow ? " now" : ""}`}><i className="fas fa-clock"></i> {isNow ? "Now" : timeAgo(item.playedAt)}</span>
                </div>
              </div>
              {isNow && <div className="rp-glow"></div>}
            </div>
            );
          })}
        </div>
      </section>
      )}

      {/* FEATURED VIDEO — from Firestore */}
      {!videoLoading && featuredVideo && (
      <section className="feed-section">
        <div className="section-header-inline">
          <h2 className="section-title">Featured Video</h2>
              <button className="section-link" onClick={() => router.push("/watch")}>See All Videos <i className="fas fa-chevron-right"></i></button>
        </div>
        <div className="fv-card" onClick={() => player.play(featuredVideo)}>
          <div className="fv-thumb">
            <div className="fv-thumb-glow"></div>
            <img src={featuredVideo.thumbnail} alt="" />
            <div className="fv-top-badge">
              <span className={`fv-cat-dot ${featuredVideo.category}`}></span>
              {featuredVideo.category}
            </div>
            <div className="fv-duration">{featuredVideo.duration}</div>
            <div className="fv-play-overlay">
              <div className="fv-play-btn">
                <i className="fas fa-play"></i>
              </div>
            </div>
          </div>
          <div className="fv-body">
            <div className="fv-title">{featuredVideo.title}</div>
            <div className="fv-meta-row">
              <div className="fv-meta-item">
                <i className="fas fa-calendar"></i>
                {new Date(featuredVideo.publishedAt).toLocaleDateString()}
              </div>
              <div className="fv-meta-item">
                <i className="fas fa-eye"></i>
                {featuredVideo.views?.toLocaleString() || 0} views
              </div>
            </div>
          </div>
        </div>
      </section>
      )}

      {/* SERMON SERIES — from Firestore */}
      {!videoLoading && seriesList.length > 0 && (
      <section className="feed-section">
        <div className="section-header-inline">
          <h2 className="section-title">Sermon Series</h2>
          <button className="section-link" onClick={() => router.push("/watch")}>Browse All Series <i className="fas fa-chevron-right"></i></button>
        </div>
        <div className="h-scroll">
          {seriesList.map((s, i) => (
            <div className="sc-card" key={s.id || i} onClick={() => router.push("/watch")}>
              <div className="sc-cover">
                {s.coverImage ? (
                  <img src={s.coverImage} alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                ) : (
                  <div className="sc-cover-fallback"><i className="fas fa-list"></i></div>
                )}
                <div className="sc-count"><i className="fas fa-video"></i> {s.videoIds?.length || 0}</div>
              </div>
              <div className="sc-body">
                <div className="sc-name">{s.name}</div>
                <div className="sc-episodes">{s.videoIds?.length || 0} videos</div>
              </div>
            </div>
          ))}
        </div>
      </section>
      )}

      {/* LATEST VIDEOS — grid layout from Firestore */}
      {!videoLoading && latestVideos.length > 0 && (
      <section className="feed-section">
        <div className="section-header-inline">
          <h2 className="section-title">Latest Videos</h2>
          <button className="section-link" onClick={() => router.push("/watch")}>See All <i className="fas fa-chevron-right"></i></button>
        </div>
        <div className="vg-grid">
          {latestVideos.slice(0, 6).map((v) => (
            <div className="vg-card" key={v.youtubeId} onClick={() => player.play(v)}>
              <div className="vg-thumb">
                <img src={v.thumbnail} alt="" />
                <div className="vg-play-icon"><i className="fas fa-play"></i></div>
                <span className="vg-duration">{v.duration}</span>
              </div>
              <div className="vg-body">
                <div className="vg-title">{v.title}</div>
                <div className="vg-meta">
                  <i className="fas fa-calendar"></i>
                  {new Date(v.publishedAt).toLocaleDateString()}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
      )}

      {/* PHOTO GALLERY — rotating images from saved albums */}
      {!galleryLoading && albums.length > 0 && (
        <RotatingGallery
          albums={albums}
          entries={entries}
          albumsLoading={galleryLoading}
          galleryIndices={galleryIndices}
          setGalleryIndices={setGalleryIndices}
          onAlbumClick={(albumId, images) => {
            if (images.length > 0) {
              imageViewer.open(images, 0);
            } else {
              router.push("/gallery");
            }
          }}
        />
      )}

      {/* TODAY'S SCHEDULE */}
      <section className="feed-section">
        <div className="section-header-inline">
          <h2 className="section-title">Today&apos;s Broadcast Schedule</h2>
          <button className="section-link" onClick={() => router.push("/radio")}>Full Schedule <i className="fas fa-chevron-right"></i></button>
        </div>
        <div className="schedule-today">
          {scheduleLoading ? (
            <div className="st-loading"><i className="fas fa-spinner fa-spin"></i> Loading schedule...</div>
          ) : scheduleItems.length === 0 ? (
            <div className="st-empty">No broadcasts scheduled for today</div>
          ) : (
            scheduleItems.map((slot, i) => (
              <div className={`st-item${slot.isNow ? " now" : ""}${slot.ended ? " ended" : ""}`} key={i}>
                <div className="st-indicator">
                  {slot.ended ? <i className="fas fa-check-circle"></i> : slot.isNow ? <span className="st-pulse"></span> : <span className="st-dot"></span>}
                </div>
                <div className="st-time">{slot.time}</div>
                <div className="st-body">
                  <div className={`st-label${!slot.isNow && !slot.ended ? " upcoming" : ""}`}>{slot.label}</div>
                  {slot.stationName && <div className="st-station"><i className="fas fa-radio"></i> {slot.stationName}</div>}
                </div>
                {slot.isNow && <span className="st-now-badge">NOW</span>}
              </div>
            ))
          )}
        </div>
      </section>



    </>
  );
  };

  return (
    <>
      {/* ===== INITIAL LOADING SKELETON (prevents ANR) ===== */}
      {!contentReady && (
        <div style={{
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--bg, #0F0F0F)",
          color: "#fff",
          fontFamily: "'Inter', sans-serif",
          flexDirection: "column",
          gap: 16,
        }}>
          <div className="dh-logo" style={{
            width: 48, height: 48, borderRadius: "50%",
            background: "linear-gradient(135deg, #E8A838, #D4762A)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18, fontWeight: 800, color: "#fff",
          }}>
            <i className="fas fa-cross"></i>
          </div>
          <div style={{
            width: 32, height: 32,
            border: "3px solid #242424",
            borderTopColor: "#E8A838",
            borderRadius: "50%",
            animation: "spin 0.8s linear infinite",
          }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {contentReady && <>
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
        @media (min-width: 480px) { .app-container { max-width: 480px; margin: 0 auto; border-left: 1px solid var(--border); border-right: 1px solid var(--border); } }
        .status-bar { height: env(safe-area-inset-top, 24px); min-height: 24px; background: var(--bg); flex-shrink: 0; }
        .offline-banner { padding: 10px 16px; background: var(--error); color: #fff; font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 8px; flex-shrink: 0; }

        /* ===== HEADER ===== */
        .dash-header {
            padding: 10px 16px 10px;
            display: flex; align-items: center; justify-content: space-between;
            flex-shrink: 0; background: var(--bg);
            border-bottom: 1px solid var(--border);
        }
        .dh-left { display: flex; align-items: center; gap: 10px; }
        .dh-logo {
            width: 38px; height: 38px; border-radius: var(--radius-full);
            background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end));
            display: flex; align-items: center; justify-content: center; flex-shrink: 0;
            font-size: 14px; font-weight: 800; color: #fff;
        }
        .dh-greeting { }
        .dh-greeting .hello { font-size: 13px; color: var(--text-secondary); font-weight: 500; }
        .dh-greeting .name { font-size: 17px; font-weight: 800; letter-spacing: -0.3px; }
        .dh-right { display: flex; gap: 8px; align-items: center; }
        .dh-btn {
            width: 38px; height: 38px; border-radius: var(--radius-full);
            background: var(--surface); border: 1px solid var(--border);
            color: var(--text-secondary); font-size: 16px;
            display: flex; align-items: center; justify-content: center; cursor: pointer;
            position: relative; transition: all 0.15s ease;
        }
        .dh-btn:active { background: var(--surface-elevated); transform: scale(0.92); }
        .dh-btn .badge {
            position: absolute; top: 6px; right: 6px;
            width: 8px; height: 8px; background: var(--error);
            border-radius: var(--radius-full); border: 2px solid var(--surface);
        }
        .dh-btn.settings { font-size: 17px; }

        /* ===== LIVE BANNER ===== */
        .live-banner {
            padding: 12px 16px; display: flex; align-items: center; gap: 12px;
            background: linear-gradient(135deg, rgba(239,68,68,0.1), rgba(239,68,68,0.04));
            border-bottom: 1px solid rgba(239,68,68,0.15); flex-shrink: 0;
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

        @keyframes livePulse { 0%,100% { opacity:1;transform:scale(1); } 50% { opacity:0.5;transform:scale(1.3); } }

        /* ===== CONTENT SCROLL ===== */
        .content-scroll { flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch; padding-bottom: 80px; }
        .content-scroll::-webkit-scrollbar { display: none; }

        .feed-section { padding: 0 16px 16px; }

        .section-header-inline {
            display: flex; align-items: center; justify-content: space-between;
            margin-bottom: 12px;
        }
        .section-title { font-size: 17px; font-weight: 700; }
        .section-link {
            font-size: 12px; color: var(--primary); font-weight: 600;
            background: none; border: none; cursor: pointer;
            display: flex; align-items: center; gap: 4px;
        }
        .section-link i { font-size: 10px; }
        .section-link:active { opacity: 0.7; }

        .h-scroll {
            display: flex; gap: 12px; overflow-x: auto;
            -webkit-overflow-scrolling: touch; scroll-snap-type: x mandatory;
            padding-bottom: 4px;
        }
        .h-scroll::-webkit-scrollbar { display: none; }
        .h-scroll > * { flex-shrink: 0; scroll-snap-align: start; }

        .section-title-badge {
            font-size: 10px;
            font-weight: 600;
            color: var(--text-tertiary);
            background: var(--surface);
            padding: 2px 10px;
            border-radius: 20px;
            margin-left: 8px;
            border: 1px solid var(--border);
            vertical-align: middle;
        }

        /* ===== FEATURED VIDEO — PREMIUM ===== */
        .fv-card {
            border-radius: var(--radius-xl); overflow: hidden;
            cursor: pointer; transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1);
            background: var(--surface-card);
            border: 1px solid var(--border);
            position: relative;
        }
        .fv-card:hover { transform: translateY(-3px); border-color: rgba(232,168,56,0.2); box-shadow: 0 12px 40px rgba(0,0,0,0.3), 0 0 0 1px rgba(232,168,56,0.05); }
        .fv-card:active { transform: scale(0.97); }
        .fv-thumb {
            position: relative; width: 100%; aspect-ratio: 16/9;
            overflow: hidden; background: var(--surface-elevated);
        }
        .fv-thumb-glow {
            position: absolute; inset: 0;
            background: radial-gradient(ellipse at 50% 0%, rgba(232,168,56,0.08) 0%, transparent 70%);
            z-index: 1; pointer-events: none; opacity: 0; transition: opacity 0.4s ease;
        }
        .fv-card:hover .fv-thumb-glow { opacity: 1; }
        .fv-thumb img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.5s cubic-bezier(0.4, 0, 0.2, 1); }
        .fv-card:hover .fv-thumb img { transform: scale(1.08); }
        .fv-top-badge {
            position: absolute; top: 12px; left: 12px; z-index: 2;
            display: flex; align-items: center; gap: 6px;
            padding: 5px 12px; border-radius: 20px;
            background: rgba(0,0,0,0.65); backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            font-size: 11px; font-weight: 600; color: #fff; text-transform: capitalize;
        }
        .fv-cat-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
        .fv-cat-dot.sermon { background: var(--primary); }
        .fv-cat-dot.worship { background: #8B5CF6; }
        .fv-cat-dot.testimony { background: #22C55E; }
        .fv-cat-dot.bible-study { background: #3B82F6; }
        .fv-cat-dot.event { background: #EF4444; }
        .fv-cat-dot.announcement { background: #F59E0B; }
        .fv-duration {
            position: absolute; bottom: 12px; right: 12px; z-index: 2;
            padding: 4px 10px; border-radius: 8px;
            background: rgba(0,0,0,0.7); backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            color: #fff; font-size: 12px; font-weight: 700;
            font-variant-numeric: tabular-nums;
        }
        .fv-play-overlay {
            position: absolute; inset: 0; z-index: 2;
            background: rgba(0,0,0,0.15);
            display: flex; align-items: center; justify-content: center;
            opacity: 0; transition: opacity 0.3s ease;
        }
        .fv-card:hover .fv-play-overlay { opacity: 1; }
        .fv-play-btn {
            width: 64px; height: 64px; border-radius: 50%;
            background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end));
            display: flex; align-items: center; justify-content: center;
            font-size: 24px; color: #fff;
            box-shadow: 0 4px 30px rgba(232,168,56,0.4), 0 0 0 4px rgba(255,255,255,0.1);
            transition: all 0.3s ease;
        }
        .fv-card:hover .fv-play-btn { transform: scale(1.1); box-shadow: 0 6px 40px rgba(232,168,56,0.5), 0 0 0 6px rgba(255,255,255,0.08); }
        .fv-body { padding: 16px 18px 18px; }
        .fv-title { font-size: 16px; font-weight: 700; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .fv-meta-row { display: flex; align-items: center; gap: 16px; margin-top: 8px; }
        .fv-meta-item { display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--text-tertiary); }
        .fv-meta-item i { font-size: 11px; color: var(--text-secondary); }

        /* ===== SERIES CARD — PREMIUM ===== */
        .sc-card {
            width: 200px; border-radius: var(--radius-lg); overflow: hidden;
            border: 1px solid var(--border); transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            cursor: pointer; background: var(--surface-card); flex-shrink: 0;
        }
        .sc-card:hover { transform: translateY(-4px); border-color: rgba(232,168,56,0.2); box-shadow: 0 10px 30px rgba(0,0,0,0.3); }
        .sc-card:active { transform: scale(0.96); }
        .sc-cover { width: 100%; height: 130px; position: relative; overflow: hidden; background: var(--surface-elevated); }
        .sc-cover img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.4s ease; }
        .sc-card:hover .sc-cover img { transform: scale(1.1); }
        .sc-cover-fallback { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, rgba(232,168,56,0.08), rgba(212,118,42,0.04)); color: var(--text-tertiary); font-size: 32px; }
        .sc-count {
            position: absolute; bottom: 8px; right: 8px;
            display: flex; align-items: center; gap: 4px;
            padding: 4px 10px; border-radius: 8px;
            background: rgba(0,0,0,0.7); backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            color: #fff; font-size: 11px; font-weight: 600;
        }
        .sc-count i { font-size: 10px; }
        .sc-body { padding: 12px 14px 14px; }
        .sc-name { font-size: 14px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .sc-episodes { font-size: 11px; color: var(--text-tertiary); margin-top: 3px; display: flex; align-items: center; gap: 4px; }
        .sc-episodes::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: var(--primary); flex-shrink: 0; }

        /* ===== PREMIUM PHOTO GALLERY ===== */
        .pg-hero {
            position: relative;
            width: 100%;
            height: 260px;
            border-radius: 20px;
            overflow: hidden;
            cursor: pointer;
            margin-bottom: 10px;
            background: var(--surface-elevated);
            border: 1px solid var(--border);
            transition: all 0.3s ease;
        }
        .pg-hero:active { transform: scale(0.98); }
        .pg-hero-bg {
            position: absolute;
            inset: 0;
        }
        .pg-hero-img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            animation: heroFadeIn 0.8s ease;
        }
        @keyframes heroFadeIn {
            from { opacity: 0; transform: scale(1.08); filter: blur(6px); }
            to { opacity: 1; transform: scale(1); filter: blur(0); }
        }
        .pg-hero-gradient {
            position: absolute;
            inset: 0;
            background: linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.2) 50%, rgba(0,0,0,0.05) 100%);
            z-index: 1;
        }
        .pg-hero-body {
            position: absolute;
            bottom: 40px;
            left: 20px;
            right: 20px;
            z-index: 2;
        }
        .pg-hero-label {
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 1.5px;
            color: var(--primary);
            margin-bottom: 6px;
            text-shadow: 0 1px 8px rgba(0,0,0,0.5);
        }
        .pg-hero-title {
            font-size: 22px;
            font-weight: 800;
            color: #fff;
            letter-spacing: -0.3px;
            text-shadow: 0 2px 12px rgba(0,0,0,0.5);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .pg-hero-meta {
            font-size: 13px;
            color: rgba(255,255,255,0.6);
            margin-top: 4px;
            text-shadow: 0 1px 6px rgba(0,0,0,0.4);
        }
        .pg-hero-dots {
            position: absolute;
            bottom: 14px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 3;
            display: flex;
            gap: 5px;
            max-width: 80%;
            overflow: hidden;
        }
        .pg-hero-dot {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: rgba(255,255,255,0.3);
            transition: all 0.3s ease;
            flex-shrink: 0;
            cursor: pointer;
        }
        .pg-hero-dot.active {
            width: 20px;
            border-radius: 3px;
            background: var(--primary);
            box-shadow: 0 0 8px rgba(232,168,56,0.4);
        }

        .pg-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 8px;
        }
        .pg-card {
            position: relative;
            aspect-ratio: 1;
            overflow: hidden;
            cursor: pointer;
            border-radius: 12px;
            background: var(--surface-elevated);
            transition: all 0.4s cubic-bezier(0.4,0,0.2,1);
            transform: translateY(0);
        }
        .pg-card:active { transform: scale(0.97); }
        .pg-glow {
            position: absolute;
            inset: 0;
            z-index: 0;
            opacity: 0;
            transition: opacity 0.4s ease;
            pointer-events: none;
        }
        .pg-card:hover .pg-glow { opacity: 1; }
        .pg-inner {
            position: relative;
            width: 100%;
            height: 100%;
            overflow: hidden;
            z-index: 1;
        }
        .pg-img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            transition: transform 0.8s cubic-bezier(0.4,0,0.2,1), filter 0.8s ease;
            animation: pgFadeIn 0.8s ease;
        }
        @keyframes pgFadeIn {
            from { opacity: 0; transform: scale(1.12); filter: blur(4px); }
            to { opacity: 1; transform: scale(1); filter: blur(0); }
        }
        .pg-card:hover .pg-img { transform: scale(1.08); }
        .pg-img-placeholder {
            width: 100%;
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            background: linear-gradient(135deg, var(--surface-elevated), var(--surface));
            color: var(--text-tertiary);
            font-size: 32px;
        }
        .pg-accent-bar {
            position: absolute;
            bottom: 0;
            left: 0;
            right: 0;
            height: 3px;
            z-index: 3;
            border-radius: 0 0 12px 12px;
        }
        .pg-overlay {
            position: absolute;
            inset: 0;
            z-index: 2;
            pointer-events: none;
            display: flex;
            flex-direction: column;
            justify-content: flex-end;
            padding: 16px;
            background: linear-gradient(to top, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.15) 50%, transparent 100%);
            opacity: 0;
            transition: opacity 0.35s ease;
        }
        .pg-card:hover .pg-overlay { opacity: 1; }
        .pg-card:active .pg-overlay { opacity: 1; }
        .pg-title {
            font-size: 13px;
            font-weight: 700;
            color: #fff;
            letter-spacing: 0.3px;
            text-shadow: 0 1px 4px rgba(0,0,0,0.4);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .pg-count {
            font-size: 10px;
            color: rgba(255,255,255,0.6);
            margin-top: 3px;
            letter-spacing: 0.5px;
            display: flex;
            align-items: center;
            gap: 4px;
        }
        .pg-count::before {
            content: "📷";
            font-size: 9px;
            filter: grayscale(1) brightness(2);
        }
        .pg-cycling {
            position: absolute;
            top: 8px;
            right: 8px;
            z-index: 3;
            width: 24px;
            height: 24px;
            border-radius: var(--radius-full);
            background: rgba(0,0,0,0.45);
            backdrop-filter: blur(4px);
            display: flex;
            align-items: center;
            justify-content: center;
            color: rgba(255,255,255,0.7);
            font-size: 10px;
        }

        /* ===== SCHEDULE TODAY ===== */
        .schedule-today {
            background: var(--surface-card); border: 1px solid var(--border);
            border-radius: var(--radius-lg); padding: 6px 16px;
        }
        .st-item {
            display: flex; align-items: center; gap: 12px;
            padding: 12px 0; border-bottom: 1px solid var(--border);
        }
        .st-item:last-child { border-bottom: none; }
        .st-item.ended { opacity: 0.5; }
        .st-indicator { width: 20px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .st-item.ended .st-indicator i { color: var(--success); font-size: 14px; }
        .st-pulse {
            width: 10px; height: 10px; border-radius: var(--radius-full);
            background: var(--success);
            animation: livePulse 1.5s ease-in-out infinite;
        }
        .st-dot { width: 8px; height: 8px; border-radius: var(--radius-full); background: var(--text-tertiary); }
        .st-time { font-size: 13px; font-weight: 600; color: var(--text-secondary); width: 52px; flex-shrink: 0; }
        .st-item.now .st-time { color: var(--primary); }
        .st-body { flex: 1; min-width: 0; }
        .st-label { font-size: 13px; font-weight: 500; }
        .st-label.upcoming { color: var(--text-secondary); }
        .st-station { font-size: 11px; color: var(--text-tertiary); margin-top: 2px; display: flex; align-items: center; gap: 4px; }
        .st-station i { font-size: 9px; }
        .st-now-badge {
            font-size: 9px; font-weight: 700; text-transform: uppercase;
            padding: 3px 8px; border-radius: 8px; letter-spacing: 0.5px;
            background: rgba(74,222,128,0.12); color: var(--success);
        }
        .st-loading { padding: 16px; text-align: center; font-size: 13px; color: var(--text-tertiary); display: flex; align-items: center; justify-content: center; gap: 8px; }
        .st-empty { padding: 20px 16px; text-align: center; font-size: 13px; color: var(--text-tertiary); }

        /* ===== AZURACAST EMBED WIDGET ===== */
        .azura-embed {
            border-radius: var(--radius-lg);
            overflow: hidden;
            background: var(--surface-card);
            border: 1px solid var(--border);
        }
        .azura-embed iframe {
            display: block;
        }

        /* ===== MINI BAR ===== */
        .minibar {
            display: flex; align-items: center; gap: 12px;
            padding: 10px 14px;
            background: var(--surface-card);
            border: 1px solid var(--border);
            border-radius: var(--radius-lg);
            transition: all 0.2s ease;
        }
        .minibar-cover {
            width: 40px; height: 40px; border-radius: 10px;
            overflow: hidden; flex-shrink: 0; position: relative;
            background: var(--surface-elevated);
        }
        .minibar-cover img { width: 100%; height: 100%; object-fit: cover; }
        .minibar-cover-fallback {
            width: 100%; height: 100%;
            display: flex; align-items: center; justify-content: center;
            color: var(--text-tertiary); font-size: 16px;
        }
        .minibar-eq {
            position: absolute; bottom: 2px; left: 50%; transform: translateX(-50%);
            display: flex; gap: 2px; align-items: flex-end;
        }
        .minibar-eq span {
            width: 3px; background: var(--primary); border-radius: 1px;
            animation: eqBounce 0.6s ease-in-out infinite alternate;
        }
        .minibar-eq span:nth-child(1) { height: 8px; animation-delay: 0s; }
        .minibar-eq span:nth-child(2) { height: 12px; animation-delay: 0.2s; }
        .minibar-eq span:nth-child(3) { height: 6px; animation-delay: 0.4s; }
        @keyframes eqBounce { from { transform: scaleY(0.5); } to { transform: scaleY(1); } }
        .minibar-info { flex: 1; min-width: 0; }
        .minibar-station { font-size: 11px; font-weight: 700; color: var(--primary); }
        .minibar-track { font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px; }
        .minibar-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
        .minibar-play-btn {
            width: 34px; height: 34px; border-radius: var(--radius-full);
            background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end));
            border: none; color: #fff; font-size: 13px; cursor: pointer;
            display: flex; align-items: center; justify-content: center;
            box-shadow: var(--shadow-soft); transition: all 0.2s ease;
        }
        .minibar-play-btn:active { transform: scale(0.88); }
        .minibar-expand {
            width: 30px; height: 30px; border-radius: var(--radius-full);
            background: var(--surface); border: 1px solid var(--border);
            color: var(--text-secondary); font-size: 12px; cursor: pointer;
            display: flex; align-items: center; justify-content: center;
        }
        .minibar-expand:active { background: var(--surface-elevated); }

        /* ===== ONBOARDING ===== */
        .onboarding-overlay {
            position: fixed; inset: 0; background: var(--bg);
            z-index: 5000; display: flex; flex-direction: column;
            align-items: center; justify-content: center; padding: 32px;
        }
        .ob-slide {
            display: flex; flex-direction: column; align-items: center;
            text-align: center; max-width: 320px;
            animation: fadeSlideUp 0.4s ease;
        }
        @keyframes fadeSlideUp { from { opacity:0;transform:translateY(20px); } to { opacity:1;transform:translateY(0); } }
        .ob-icon {
            width: 120px; height: 120px; border-radius: 32px;
            display: flex; align-items: center; justify-content: center;
            font-size: 52px; color: #fff; margin-bottom: 28px;
            box-shadow: 0 4px 30px rgba(232,168,56,0.2);
        }
        .ob-slide h2 { font-size: 26px; font-weight: 800; margin-bottom: 8px; }
        .ob-slide p { font-size: 15px; color: var(--text-secondary); line-height: 1.5; }
        .ob-dots {
            display: flex; gap: 8px; margin: 32px 0 24px;
        }
        .ob-dot {
            width: 8px; height: 8px; border-radius: var(--radius-full);
            background: var(--text-tertiary); transition: all 0.3s ease;
        }
        .ob-dot.active { width: 28px; border-radius: 4px; background: var(--primary); }
        .ob-btn {
            width: 100%; max-width: 280px; padding: 16px;
            border-radius: var(--radius-md); font-size: 16px; font-weight: 700;
            border: none; cursor: pointer; transition: all 0.15s ease;
        }
        .ob-btn:active { transform: scale(0.97); }
        .ob-btn.primary { background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end)); color: #fff; }
        .ob-btn.secondary {
            background: transparent; color: var(--text-secondary);
            margin-top: 8px; font-size: 14px;
        }
        .ob-btn.secondary:active { color: var(--text-primary); }

        /* ===== REFRESH SPINNER ===== */
        .refresh-indicator {
            display: flex; align-items: center; justify-content: center;
            padding: 12px; font-size: 13px; color: var(--text-tertiary); gap: 8px;
            transition: all 0.3s ease;
        }
        .refresh-indicator i { animation: spin 0.8s linear infinite; }

        @keyframes spin { to { transform: rotate(360deg); } }

        /* ===== RECENTLY PLAYED — GLASS PREMIUM ===== */
        .rp-list { display: flex; flex-direction: column; gap: 10px; }
        .rp-card {
            display: flex; align-items: center; gap: 14px;
            padding: 12px 14px 12px 0;
            background: linear-gradient(135deg, var(--surface-card), var(--surface));
            border: 1px solid var(--border);
            border-radius: var(--radius-lg);
            position: relative; overflow: hidden;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .rp-card:active { transform: scale(0.98); }
        .rp-card.live {
            border-color: rgba(232,168,56,0.25);
            background: linear-gradient(135deg, rgba(232,168,56,0.08), rgba(232,168,56,0.02));
        }
        .rp-accent {
            position: absolute; left: 0; top: 0; bottom: 0; width: 3px;
            background: linear-gradient(180deg, var(--gradient-start), var(--gradient-end));
            border-radius: 0 2px 2px 0;
            transition: opacity 0.3s ease;
        }
        .rp-card.live .rp-accent {
            box-shadow: 0 0 12px rgba(232,168,56,0.4);
        }
        .rp-glow {
            position: absolute; top: -50%; right: -20%;
            width: 160px; height: 160px;
            background: radial-gradient(circle, rgba(232,168,56,0.1) 0%, transparent 70%);
            pointer-events: none;
        }
        .rp-cover-wrap { position: relative; flex-shrink: 0; margin-left: 14px; }
        .rp-cover {
            width: 56px; height: 56px; border-radius: var(--radius-md);
            object-fit: cover; display: block;
            background: var(--surface-elevated);
            box-shadow: 0 4px 16px rgba(0,0,0,0.3);
            transition: all 0.3s ease;
        }
        .rp-card.live .rp-cover {
            box-shadow: 0 4px 20px rgba(232,168,56,0.2);
        }
        .rp-cover-fallback {
            display: flex; align-items: center; justify-content: center;
            background: linear-gradient(135deg, var(--surface-elevated), var(--surface));
            color: var(--text-tertiary); font-size: 18px;
        }

        .rp-body { flex: 1; min-width: 0; position: relative; z-index: 1; }
        .rp-title-row { display: flex; align-items: center; gap: 8px; }
        .rp-title {
            font-size: 14px; font-weight: 700;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .rp-live-tag {
            font-size: 9px; font-weight: 800; text-transform: uppercase;
            letter-spacing: 0.5px; padding: 2px 7px; border-radius: 4px;
            background: rgba(239,68,68,0.15); color: var(--error);
            flex-shrink: 0; animation: livePulse 2s ease-in-out infinite;
        }
        .rp-artist { font-size: 12px; color: var(--text-secondary); margin-top: 2px; }
        .rp-footer { display: flex; align-items: center; gap: 12px; margin-top: 4px; }
        .rp-source { font-size: 10px; color: var(--primary); font-weight: 600; display: flex; align-items: center; gap: 4px; }
        .rp-source i { font-size: 9px; }
        .rp-time {
            font-size: 10px; color: var(--text-tertiary); font-weight: 500;
            display: flex; align-items: center; gap: 3px;
        }
        .rp-time.now { color: var(--primary); font-weight: 700; }
        .rp-time i { font-size: 9px; }

        /* ===== VIDEO GRID — PREMIUM ===== */
        .vg-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 12px;
        }
        .vg-card {
            border-radius: var(--radius-lg);
            overflow: hidden;
            cursor: pointer;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            background: var(--surface-card);
            border: 1px solid var(--border);
        }
        .vg-card:hover { transform: translateY(-3px); border-color: rgba(232,168,56,0.15); box-shadow: 0 8px 25px rgba(0,0,0,0.2); }
        .vg-card:active { transform: scale(0.95); }
        .vg-thumb {
            position: relative;
            width: 100%;
            aspect-ratio: 16/9;
            overflow: hidden;
            background: var(--surface-elevated);
        }
        .vg-thumb img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.4s ease; }
        .vg-card:hover .vg-thumb img { transform: scale(1.1); }
        .vg-play-icon {
            position: absolute; inset: 0; display: flex;
            align-items: center; justify-content: center;
            opacity: 0; transition: opacity 0.3s ease;
            background: rgba(0,0,0,0.1);
        }
        .vg-card:hover .vg-play-icon { opacity: 1; }
        .vg-play-icon i {
            width: 40px; height: 40px; border-radius: 50%;
            background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end));
            display: flex; align-items: center; justify-content: center;
            font-size: 14px; color: #fff;
            box-shadow: 0 4px 20px rgba(232,168,56,0.3);
        }
        .vg-duration {
            position: absolute; bottom: 8px; right: 8px;
            padding: 3px 8px; border-radius: 6px;
            background: rgba(0,0,0,0.7); backdrop-filter: blur(6px);
            -webkit-backdrop-filter: blur(6px);
            color: #fff; font-size: 11px; font-weight: 700;
        }
        .vg-body { padding: 10px 12px 14px; }
        .vg-title { font-size: 13px; font-weight: 700; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .vg-meta { font-size: 11px; color: var(--text-tertiary); margin-top: 4px; display: flex; align-items: center; gap: 5px; }
        .vg-meta i { font-size: 10px; color: var(--text-secondary); }

        /* ===== BOTTOM NAV ===== */
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
            z-index: 1000;
            display: flex;
            justify-content: space-around;
            align-items: center;
        }

        @media (min-width: 480px) {
            .bottom-nav {
                max-width: 480px;
                margin: 0 auto;
            }
        }

        .nav-item {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 4px;
            padding: 6px 12px;
            background: none;
            border: none;
            color: var(--text-tertiary);
            cursor: pointer;
            transition: all 0.2s ease;
            position: relative;
        }

        .nav-item.active {
            color: var(--primary);
        }

        .nav-item i {
            font-size: 20px;
            transition: transform 0.2s ease;
        }

        .nav-item:active i {
            transform: scale(0.85);
        }

        .nav-item span {
            font-size: 10px;
            font-weight: 600;
        }

        .nav-item .nav-badge {
            position: absolute;
            top: 2px;
            right: 6px;
            width: 8px;
            height: 8px;
            background: var(--error);
            border-radius: var(--radius-full);
            border: 2px solid var(--bg);
        }
      `}</style>

      <ToastBridge />

      {/* ===== ONBOARDING ===== */}
      {showOnboarding && (
        <div className="onboarding-overlay">
          <div className="ob-slide" key={onboardingSlide}>
            <div className="ob-icon" style={{ background: `linear-gradient(135deg, ${onboardingSlides[onboardingSlide].color}, ${onboardingSlides[onboardingSlide].color}88)` }}>
              <i className={`fas ${onboardingSlides[onboardingSlide].icon}`}></i>
            </div>
            <h2>{onboardingSlides[onboardingSlide].title}</h2>
            <p>{onboardingSlides[onboardingSlide].subtitle}</p>
          </div>
          <div className="ob-dots">
            {onboardingSlides.map((_, i) => (
              <div key={i} className={`ob-dot${i === onboardingSlide ? " active" : ""}`}></div>
            ))}
          </div>
          {onboardingSlide < onboardingSlides.length - 1 ? (
            <button className="ob-btn primary" onClick={() => setOnboardingSlide((s) => s + 1)}>Continue</button>
          ) : (
            <>
              <button className="ob-btn primary" onClick={() => { localStorage.setItem("onboarding_done", "true"); setShowOnboarding(false); }}>
                <i className="fas fa-bell" style={{ marginRight: 8 }}></i> Enable Notifications
              </button>
              <button className="ob-btn secondary" onClick={() => { localStorage.setItem("onboarding_done", "true"); setShowOnboarding(false); }}>Skip</button>
            </>
          )}
        </div>
      )}



      {/* ===== MAIN APP ===== */}
      <div className="app-container">
        <div className="status-bar"></div>

        {offline && (
          <div className="offline-banner">
            <i className="fas fa-wifi-slash"></i>
            <span>You're offline — showing cached content</span>
          </div>
        )}

        {/* HEADER */}
        <header className="dash-header">
          <div className="dh-left">
            <div className="dh-logo">
              <i className="fas fa-cross"></i>
            </div>
            <div className="dh-greeting">
              <div className="hello">{greeting.text} {greeting.emoji}</div>
              <div className="name">{memberName ? `Good ${greeting.text.split(" ")[1]}, ${memberName}` : church.name}</div>
            </div>
          </div>
          <div className="dh-right">
            <button className="dh-btn logout" onClick={handleLogout} title="Sign out">
              <i className="fas fa-right-from-bracket"></i>
            </button>
          </div>
        </header>

        {/* CONTENT SCROLL */}
        <div
          className="content-scroll"
          ref={contentRef}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {refreshing && (
            <div className="refresh-indicator">
              <i className="fas fa-spinner"></i> Refreshing...
            </div>
          )}

          {renderHomeTab()}

          <div style={{ height: 40 }}></div>
        </div>

        <BottomNavBar activeTab="home" />
      </div>

      {player.VideoPlayer}
      {imageViewer.ImageLightbox}
      </>}
    </>
  );
}
