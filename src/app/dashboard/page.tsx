"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { signOut as firebaseSignOut } from "firebase/auth";
import { churchConfig } from "@/lib/churchConfig";
import { auth } from "@/lib/firebase";
import { useAppStore } from "@/lib/useAppStore";
import BottomNavBar from "@/components/shared/BottomNavBar";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import ToastBridge from "@/components/dashboard/ToastBridge";
import EventCarousel from "@/components/dashboard/EventCarousel";
import AlbumCarousel from "@/components/shared/AlbumCarousel";
import { useImageLightbox } from "@/components/shared/ImageLightbox";
import PremiumLoader from "@/components/shared/PremiumLoader";
import PremiumTopBar from "@/components/shared/PremiumTopBar";
import { getNowPlaying, getSongHistory, getStationId, getPlaylists } from "@/lib/azuracast";
import { getAlbums } from "@/lib/albums";
import { getAllAlbumEntries } from "@/lib/albumEntries";
import { useAudio } from "@/lib/audio/AudioContext";
import { usePlayConfig } from "@/lib/playControls";
import { useTvPlayer } from "@/lib/tv/TvPlayerProvider";
import { useFullscreenToggle } from "@/lib/tv/fullscreen";
import { getChannel, getVideos, getUserTvState, updateUserTvProgress, autoInitUserPlaylist } from "@/lib/youtube";
import type { NowPlayingData, SongHistoryItem, Playlist } from "@/lib/azuracast";
import type { Album } from "@/lib/albums";
import type { AlbumEntry } from "@/lib/albumEntries";
import type { YouTubeChannel, YouTubeVideo, UserTvState } from "@/lib/youtube";

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

/* ==================================================================
   MOCK DATA
   ================================================================== */

const church = {
  name: "MOUNTAIN OF DELIVERANCE CHURCH",
  tagline: "Worship. Word. Community.",
  logoInitials: "TP",
};

const memberName = "Derick";

/* ==================================================================
   HELPERS
   ================================================================== */

function getWeekSeed(): number {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const diff = now.getTime() - startOfYear.getTime();
  const week = Math.ceil((diff / 86400000 + startOfYear.getDay() + 1) / 7);
  return now.getFullYear() * 100 + week;
}

function seededShuffle<T>(arr: T[], seed: number): T[] {
  const result = [...arr];
  let s = seed;
  for (let i = result.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function getGreeting(): { text: string; emoji: string } {
  const h = new Date().getHours();
  if (h < 12) return { text: "Good Morning", emoji: "🌅" };
  if (h < 17) return { text: "Good Afternoon", emoji: "☀️" };
  return { text: "Good Evening", emoji: "🌙" };
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

  const [heroSeed] = useState(() => Math.random());
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
    // Seeded shuffle for variety on each load
    let s = heroSeed;
    for (let i = all.length - 1; i > 0; i--) {
      s = ((s * 9301 + 49297) % 233280);
      const j = Math.floor((s / 233280) * (i + 1));
      [all[i], all[j]] = [all[j], all[i]];
    }
    return all;
  }, [validAlbums, entries, heroSeed]);

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
  const [albumSeed] = useState(() => Math.random());
  const displayAlbums = useMemo(() => {
    const shuffled = [...validAlbums];
    let s = albumSeed;
    for (let i = shuffled.length - 1; i > 0; i--) {
      s = ((s * 9301 + 49297) % 233280);
      const j = Math.floor((s / 233280) * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled.slice(0, displayCount);
  }, [validAlbums, albumSeed]);

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
   SCHEDULE HELPERS
   ================================================================== */

interface ScheduleSlot {
  time: string;
  label: string;
  isNow: boolean;
  hasContent: boolean;
  stationName?: string;
}

function getFallbackSchedule(): ScheduleSlot[] {
  const h = new Date().getHours();
  if (h < 9) return [{ time: "9:00 AM", label: "Sunday Worship Service", isNow: false, hasContent: true, stationName: "MOUNTAIN OF DELIVERANCE CHURCH Radio" }];
  if (h < 12) return [{ time: "9:00 AM", label: "Sunday Worship Service", isNow: true, hasContent: true, stationName: "MOUNTAIN OF DELIVERANCE CHURCH Radio" }];
  return [{ time: "9:00 AM", label: "Sunday Worship Service", isNow: false, hasContent: true, stationName: "MOUNTAIN OF DELIVERANCE CHURCH Radio" }];
}

function parseTimeToMinutes(t: string): number {
  if (!t) return 0;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

function computeTodaySchedule(stationId: number, stationName: string, playlists: Playlist[]): ScheduleSlot[] {
  const today = new Date().getDay(); // 0=Sun, 6=Sat
  const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
  const slots: ScheduleSlot[] = [];
  for (const pl of playlists) {
    if (pl.type !== "scheduled" || !pl.schedule) continue;
    const days = pl.schedule.days || [];
    if (!days.includes(today)) continue;
    const startH = parseInt(pl.schedule.startTime?.split(":")[0] || "0");
    const startM = parseInt(pl.schedule.startTime?.split(":")[1] || "0");
    const endH = parseInt(pl.schedule.endTime?.split(":")[0] || "0") || startH + 1;
    const endM = parseInt(pl.schedule.endTime?.split(":")[1] || "0");
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;
    const isNow = nowMinutes >= startMinutes && nowMinutes < endMinutes;
    const displayTime = `${startH > 12 ? startH - 12 : startH === 0 ? 12 : startH}:${String(startM).padStart(2, "0")} ${startH >= 12 ? "PM" : "AM"}`;
    slots.push({
      time: displayTime,
      label: pl.name,
      isNow,
      hasContent: true,
      stationName: stationName || "Radio",
    });
  }
  return slots;
}

/* ==================================================================
   COMPONENT
   ================================================================== */

export default function DashboardPage() {
  const router = useRouter();
  const storeLogout = useAppStore((s) => s.logout);
  const greeting = getGreeting();
  const userDoc = useAppStore((s) => s.userDoc);

  const [showOnboarding, setShowOnboarding] = useState(() => {
    // Check Firestore first (persists across devices), then localStorage fallback
    if (typeof window !== "undefined") {
      const localDone = localStorage.getItem("onboarding_done") === "true";
      return localDone ? false : true; // default true, updated when userDoc loads
    }
    return true;
  });

  // Once userDoc loads, respect Firestore's onboarding_done
  useEffect(() => {
    if (userDoc && userDoc.onboarding_done === true) {
      queueMicrotask(() => setShowOnboarding(false));
      localStorage.setItem("onboarding_done", "true");
    }
  }, [userDoc]);

  const completeOnboarding = useCallback(async () => {
    localStorage.setItem("onboarding_done", "true");
    setShowOnboarding(false);
    if (userDoc?.uid) {
      try {
        await updateDoc(doc(db, "users", userDoc.uid), { onboarding_done: true });
      } catch {}
    }
  }, [userDoc]);

  const handleLogout = async () => {
    try {
      // Flush watch progress before clearing auth session
      const uid = auth.currentUser?.uid;
      if (uid) {
        await updateUserTvProgress(uid, lastTvIndexRef.current, lastTvSeekRef.current);
      }
      tvPlayer.hide();
      await firebaseSignOut(auth);
      storeLogout();
    } catch (_) {}
    window.location.href = "/";
  };
  const [onboardingSlide, setOnboardingSlide] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [listeners, setListeners] = useState(0);
  const [npData, setNpData] = useState<NowPlayingData | null>(null);
  const [songHistory, setSongHistory] = useState<SongHistoryItem[]>([]);
  const [radioLoading, setRadioLoading] = useState(true);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [entries, setEntries] = useState<AlbumEntry[]>([]);
  const [galleryLoading, setGalleryLoading] = useState(true);
  const [galleryIndices, setGalleryIndices] = useState<number[]>([]);
  const [scheduleItems, setScheduleItems] = useState<ScheduleSlot[]>([]);
  const [scheduleLoading, setScheduleLoading] = useState(true);
  const [contentReady, setContentReady] = useState(false);

  // ─── Video Gallery ───
  const [recentVideos, setRecentVideos] = useState<YouTubeVideo[]>([]);
  const [weeklyVideos, setWeeklyVideos] = useState<YouTubeVideo[]>([]);
  const [videoGalleryLoading, setVideoGalleryLoading] = useState(true);

  // ─── TV state (per-user personalized playlist) ───

  const [tvChannel, setTvChannel] = useState<YouTubeChannel | null>(null);
  const [tvVideos, setTvVideos] = useState<YouTubeVideo[]>([]);
  const [tvUserState, setTvUserState] = useState<UserTvState | null>(null);
  const [tvLoading, setTvLoading] = useState(true);
  const [showEndCard, setShowEndCard] = useState(false);
  const [nextTvVideo, setNextTvVideo] = useState<YouTubeVideo | null>(null);
  const [tvStartCountdown, setTvStartCountdown] = useState(20);
  const lastTvSeekRef = useRef(0);
  const lastTvIndexRef = useRef(0);
  const tvPlayerTargetRef = useRef<HTMLDivElement>(null);
  const tvPlayer = useTvPlayer();
  const { toggleFullscreen } = useFullscreenToggle();
  const hasInteractedWithTv = useRef(false);

  // Derive current video from user's playlist
  const tvCurrentVideo = tvUserState && tvUserState.playlist.length > 0
    ? tvVideos.find((v) => v.id === tvUserState.playlist[tvUserState.currentIndex]) ?? null
    : null;
  // Resume from Firestore seek position (0 if none)
  const tvInitialSeek = tvUserState?.currentSeek ?? undefined;

  // Sync index ref when state changes
  useEffect(() => {
    if (tvUserState) {
      lastTvIndexRef.current = tvUserState.currentIndex;
    }
  }, [tvUserState?.currentIndex]);

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

  // Register portal target for the global player overlay
  useEffect(() => {
    if (tvPlayerTargetRef.current) {
      tvPlayer.registerTarget(tvPlayerTargetRef.current);
    }
    return () => {
      tvPlayer.registerTarget(null);
    };
  }, [tvCurrentVideo, tvPlayer]);

  // Call play() when current video changes — skip if global player already on this video
  // (prevents stale Firestore seek from rewinding on Android page navigation).
  useEffect(() => {
    if (tvCurrentVideo) {
      if (tvPlayer.currentVideoId === tvCurrentVideo.id && tvPlayer.visible) return;
      tvPlayer.play(tvCurrentVideo.id, tvInitialSeek);
    } else {
      tvPlayer.hide();
    }
  }, [tvCurrentVideo?.id, tvInitialSeek, tvPlayer]);

  // Delay full content render to prevent ANR on Android WebView
  useEffect(() => {
    const timer = setTimeout(() => setContentReady(true), 500);
    return () => clearTimeout(timer);
  }, []);

  const imageViewer = useImageLightbox();
  const audio = useAudio();
  const { config: playConfig } = usePlayConfig();

  // Music controls plugin disabled due to native crash on Android
  // const musicControls = useMusicControls({...});

  const contentRef = useRef<HTMLDivElement>(null);
  const [offline, setOffline] = useState(false);

  // Sync local isPlaying with global audio state
  useEffect(() => {
    const streamUrl = npData?.station?.listenUrl || "";
    const nowPlaying = audio.isPlaying && audio.currentStreamUrl === streamUrl;
    queueMicrotask(() => setIsPlaying(nowPlaying));
  }, [audio.isPlaying, audio.currentStationId, npData]);

  // Push now-playing metadata to Android media notification when audio is playing
  useEffect(() => {
    if (audio.isPlaying) {
      const np = npData?.nowPlaying;
      const title = np?.song?.title || "MOUNTAIN OF DELIVERANCE CHURCH Radio";
      const artist = np?.song?.artist || "MOUNTAIN OF DELIVERANCE CHURCH";
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

  /* Fetch albums and entries from Firestore on mount */
  useEffect(() => {
    let mounted = true;
    const fetchData = async () => {
      const [albumList, entryList] = await Promise.all([
        getAlbums().catch(() => [] as Album[]),
        getAllAlbumEntries().catch(() => [] as AlbumEntry[]),
      ]);
      if (!mounted) return;
      setAlbums(albumList);
      setEntries(entryList);
      // Build initial random gallery indices
      const valid = albumList.filter((a) => a.photoCount > 0 || entryList.some((e) => e.albumId === a.id));
      const usedIndices = valid.map(() => Math.floor(Math.random() * 12));
      setGalleryIndices(usedIndices);
      setGalleryLoading(false);
    };
    fetchData();
    return () => { mounted = false; };
  }, []);

  /* Fetch schedule playlists every 60 seconds */
  useEffect(() => {
    let mounted = true;
    const fetchSchedule = async () => {
      const stationName = npData?.station?.name || church.name;
      const playlists = await getPlaylists().catch(() => [] as Playlist[]);
      if (!mounted) return;
      const allSlots = computeTodaySchedule(Number(getStationId()), stationName, playlists);
      setScheduleItems(allSlots.length > 0 ? allSlots : getFallbackSchedule());
      setScheduleLoading(false);
    };
    fetchSchedule();
    const interval = setInterval(fetchSchedule, 60000);
    return () => { mounted = false; clearInterval(interval); };
  }, [npData]);

  /* Fetch TV channel, videos & user's playlist on mount */
  useEffect(() => {
    let mounted = true;
    const fetchTv = async () => {
      const uid = auth.currentUser?.uid;
      if (!uid) return;
      try {
        const [chan, vids, state] = await Promise.all([
          getChannel().catch(() => null),
          getVideos({ max: 50 }).catch(() => [] as YouTubeVideo[]),
          getUserTvState(uid),
        ]);
        if (!mounted) return;
        if (chan) setTvChannel(chan);
        if (vids.length > 0) setTvVideos(vids);

        // Auto-populate if playlist is empty
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

  /* Fetch videos for gallery sections */
  useEffect(() => {
    let mounted = true;
    const fetchVideos = async () => {
      try {
        const allVids = await getVideos({ max: 200, includeHidden: false });
        if (!mounted) return;
        // Recent: sort by publishedAt descending, take 15
        const sorted = [...allVids].sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
        setRecentVideos(sorted.slice(0, 15));
        // Weekly: deterministic shuffle by week number, take 15
        const weekly = seededShuffle(sorted, getWeekSeed()).slice(0, 15);
        setWeeklyVideos(weekly);
      } catch (e) {
        console.error("Failed to load video gallery:", e);
      } finally {
        if (mounted) setVideoGalleryLoading(false);
      }
    };
    fetchVideos();
    return () => { mounted = false; };
  }, []);

  /* Start TV — resume saved progress, or advance if already interacted */
  const handleStartTv = useCallback(() => {
    if (!tvUserState || tvUserState.playlist.length === 0) {
      // No playlist — try to auto-populate
      const uid = auth.currentUser?.uid;
      if (uid && tvVideos.length > 0) {
        import("@/lib/youtube").then((yt) => {
          yt.autoInitUserPlaylist(uid).then((state) => {
            setTvUserState(state);
          });
        });
      } else {
        window.dispatchEvent(new CustomEvent("show-toast", {
          detail: { title: "No Videos", message: "No videos available to play. Sync videos from the admin panel.", type: "info", duration: 3000 }
        }));
      }
      return;
    }
    const uid = auth.currentUser?.uid;
    // First click after page load = resume saved progress, subsequent clicks = advance
    if (tvCurrentVideo && hasInteractedWithTv.current) {
      // User already pressed Start TV before — advance to next video
      const nextIndex = (tvUserState.currentIndex + 1) % tvUserState.playlist.length;
      const next = tvVideos.find((v) => v.id === tvUserState.playlist[nextIndex]) ?? null;
      if (next) setNextTvVideo(next);
      if (uid) updateUserTvProgress(uid, nextIndex, 0);
      setTvUserState((prev) => prev ? { ...prev, currentIndex: nextIndex, currentSeek: 0 } : prev);
      return;
    }
    hasInteractedWithTv.current = true;
    // Resume or start — check saved progress to decide
    const savedIndex = tvUserState.currentIndex;
    const savedSeek = tvUserState.currentSeek;
    const savedVideo = tvVideos.find((v) => v.id === tvUserState.playlist[savedIndex]) ?? null;
    const nearEnd = savedVideo && savedVideo.duration > 0 && savedSeek >= savedVideo.duration * 0.9;
    if (nearEnd) {
      // Near the end — advance to next video
      const nextIndex = (savedIndex + 1) % tvUserState.playlist.length;
      const next = tvVideos.find((v) => v.id === tvUserState.playlist[nextIndex]) ?? null;
      if (next) setNextTvVideo(next);
      if (uid) updateUserTvProgress(uid, nextIndex, 0);
      setTvUserState((prev) => prev ? { ...prev, currentIndex: nextIndex, currentSeek: 0 } : prev);
    } else {
      // Resume current video at saved progress (or start from index 0 if no progress)
      const resumeIndex = savedSeek > 0 && savedVideo ? savedIndex : 0;
      const resumeSeek = resumeIndex === savedIndex ? savedSeek : 0;
      if (tvUserState.playlist.length > 1) {
        const nextIdx = (resumeIndex + 1) % tvUserState.playlist.length;
        const next = tvVideos.find((v) => v.id === tvUserState.playlist[nextIdx]) ?? null;
        if (next) setNextTvVideo(next);
      }
      console.log('[Dashboard Start TV] Resuming:', { resumeIndex, resumeSeek, videoTitle: savedVideo?.title });
      // DON'T write to Firestore on resume - let the interval save actual progress
      setTvUserState((prev) => prev ? { ...prev, currentIndex: resumeIndex, currentSeek: resumeSeek } : prev);
      if (savedVideo) tvPlayer.play(savedVideo.id, resumeSeek);
    }
  }, [tvCurrentVideo, tvUserState, tvVideos, router, tvPlayer]);

  /* Advance TV video when it ends — show end card with next video ready */
  const advanceTvVideo = useCallback(() => {
    if (!tvUserState || tvUserState.playlist.length === 0) return;
    // Save progress immediately before showing end card
    const uid = auth.currentUser?.uid;
    if (uid && lastTvSeekRef.current > 0) {
      updateUserTvProgress(uid, lastTvIndexRef.current, lastTvSeekRef.current);
    }
    // Show end card with the next video info
    const nextIndex = (tvUserState.currentIndex + 1) % tvUserState.playlist.length;
    const nextVideo = tvVideos.find((v) => v.id === tvUserState.playlist[nextIndex]) ?? null;
    if (nextVideo) {
      setNextTvVideo(nextVideo);
      setShowEndCard(true);
    }
  }, [tvUserState, tvVideos]);

  /* Called when user taps "Continue Watching" — advances and plays the next video */
  const handleContinueWatching = useCallback(() => {
    if (!tvUserState || tvUserState.playlist.length === 0) return;
    const nextIndex = (tvUserState.currentIndex + 1) % tvUserState.playlist.length;
    const uid = auth.currentUser?.uid;
    if (uid) {
      updateUserTvProgress(uid, nextIndex, 0);
    }
    setShowEndCard(false);
    setNextTvVideo(null);
    setTvUserState((prev) => prev ? { ...prev, currentIndex: nextIndex, currentSeek: 0 } : prev);
  }, [tvUserState]);

  /* Track current time for periodic Firestore saves */
  const handleTvTimeUpdate = useCallback((time: number) => {
    lastTvSeekRef.current = time;
    // Also update index ref to ensure it's in sync
    if (tvUserState) {
      lastTvIndexRef.current = tvUserState.currentIndex;
    }
    // Log every 10 seconds to avoid spam
    if (Math.floor(time) % 10 === 0) {
      console.log('[Dashboard TV Time Update]', { time, currentIndex: lastTvIndexRef.current });
    }
  }, [tvUserState]);

  // Keep callbacks in sync with latest versions (defined after advanceTvVideo/handleTvTimeUpdate)
  useEffect(() => {
    tvPlayer.setCallbacks({
      onEnded: advanceTvVideo,
      onTimeUpdate: handleTvTimeUpdate,
    });
  }, [advanceTvVideo, handleTvTimeUpdate, tvPlayer]);

  /* Save current progress to Firestore (used by interval + cleanup) */
  const saveTvProgress = useCallback(() => {
    const uid = auth.currentUser?.uid;
    const seek = lastTvSeekRef.current;
    const index = lastTvIndexRef.current;
    console.log('[Dashboard TV Progress] Saving:', { uid: uid ? 'logged-in' : 'not-logged-in', index, seek });
    if (uid) {
      // Always save, even if seek is 0 (important for index changes)
      updateUserTvProgress(uid, index, seek).then(() => {
        console.log('[Dashboard TV Progress] Saved successfully');
      }).catch((err) => {
        console.error('[Dashboard TV Progress] Failed to save:', err);
      });
      // Keep local state in sync so resume props don't lag behind live playback
      setTvUserState((prev) =>
        prev && (prev.currentIndex !== index || prev.currentSeek !== seek)
          ? { ...prev, currentIndex: index, currentSeek: seek }
          : prev
      );
    }
  }, []);

  /* Periodically save seek position (every 5s) */
  useEffect(() => {
    if (!tvUserState || !auth.currentUser?.uid) return;
    const interval = setInterval(saveTvProgress, 5000);
    return () => {
      clearInterval(interval);
      // Save on unmount/cleanup as well
      saveTvProgress();
    };
  }, [tvUserState?.currentIndex, saveTvProgress]);

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

  /* App resume — save on background, merge remote state on foreground */
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
            console.log('[Dashboard App Background] Saving progress');
            saveTvProgress();
            return;
          }
          console.log('[Dashboard App Resume] App came back to foreground');
          saveTvProgress();
          const uid = auth.currentUser?.uid;
          if (uid) {
            getUserTvState(uid).then((s) => {
              const liveSeek = lastTvSeekRef.current;
              const liveIndex = lastTvIndexRef.current;
              const mergedSeek = Math.max(s.currentSeek, liveSeek);
              const mergedIndex = tvPlayer.visible ? liveIndex : s.currentIndex;
              console.log('[Dashboard App Resume] Merged state:', { index: mergedIndex, seek: mergedSeek, remoteSeek: s.currentSeek, liveSeek });
              setTvUserState({ ...s, currentIndex: mergedIndex, currentSeek: mergedSeek });
            });
          }
        }).then((handler) => {
          if (canceled) handler.remove();
        });
      });
    return () => { canceled = true; };
  }, [saveTvProgress, tvPlayer]);

  /* Tab visibility — save on hide, merge remote state on show (web) */
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        saveTvProgress();
        return;
      }
      console.log('[Dashboard Tab Visible] Tab became visible');
      saveTvProgress();
      const uid = auth.currentUser?.uid;
      if (uid) {
        getUserTvState(uid).then((s) => {
          const liveSeek = lastTvSeekRef.current;
          const liveIndex = lastTvIndexRef.current;
          const mergedSeek = Math.max(s.currentSeek, liveSeek);
          const mergedIndex = tvPlayer.visible ? liveIndex : s.currentIndex;
          console.log('[Dashboard Tab Visible] Merged state:', { index: mergedIndex, seek: mergedSeek });
          setTvUserState({ ...s, currentIndex: mergedIndex, currentSeek: mergedSeek });
        });
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [saveTvProgress, tvPlayer]);

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
  ];

  const renderHomeTab = () => {
    const np = npData?.nowPlaying;
    const isLive = npData?.live?.isLive ?? false;
    const streamerName = npData?.live?.streamerName;
    const stationName = npData?.station?.name || church.name;
    const progressPct = np && np.duration > 0 ? Math.round((np.elapsed / np.duration) * 100) : 0;
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

      {/* ===== PREMIUM TV HERO CARD ===== */}
      {!tvLoading && (
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

          {/* Player — rendered by global TvPlayerProvider, overlays this target */}
          {tvCurrentVideo ? (
            <div ref={tvPlayerTargetRef} className="tv-player-container">
              {/* Normal overlay when playing */}
              {!showEndCard && (
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
              )}

              {/* End card — shown when video finishes */}
              {showEndCard && nextTvVideo && (
                <div className="tv-end-card">
                  <div className="tv-end-card-bg"></div>
                  <div className="tv-end-card-body">
                    <div className="tv-end-card-label">
                      <i className="fas fa-check-circle"></i> Finished Watching
                    </div>
                    <div className="tv-end-card-thumb">
                      <img src={nextTvVideo.thumbnail || `https://i.ytimg.com/vi/${nextTvVideo.id}/default.jpg`} alt="" />
                      <div className="tv-end-card-play-icon">
                        <i className="fas fa-play"></i>
                      </div>
                    </div>
                    <div className="tv-end-card-title">{nextTvVideo.title}</div>
                    <div className="tv-end-card-sub">Up next in your playlist</div>
                    <button className="tv-end-card-btn" onClick={handleContinueWatching}>
                      <i className="fas fa-play"></i> Continue Watching TV
                    </button>
                    <button className="tv-end-card-skip" onClick={() => setShowEndCard(false)}>
                      Dismiss
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="tv-no-video">
              <i className="fas fa-video-slash"></i>
              <span>TV is off air</span>
            </div>
          )}

          {/* Channel info strip */}
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
              <button className="tv-watch-btn" onClick={() => router.push("/tv")}>
                <i className="fas fa-play"></i> Watch
              </button>
            </div>
          )}

          {/* Start TV button — always visible */}
          <button className="tv-start-btn" onClick={handleStartTv} title={tvStartCountdown > 0 ? `Ready in ${tvStartCountdown}s` : "Starts TV or skips to next if already playing"} disabled={tvStartCountdown > 0}>
            <i className="fas fa-play"></i>
            <span>{tvStartCountdown > 0 ? `Starting in ${tvStartCountdown}s` : 'Start TV'}</span>
          </button>
          <div className="tv-start-hint">Click to switch playlist</div>

          {/* Playlist info */}
          {tvUserState && tvUserState.playlist.length === 0 && (
            <div className="tv-next-slot">
              <i className="fas fa-list"></i>
              <span>Your TV playlist is empty — add videos from the TV page</span>
            </div>
          )}
        </div>
      </section>
      )}

      {/* ===== PREMIUM RADIO HERO CARD ===== */}
      <section className="feed-section">
        <div className="rh-hero">
          <div className="rh-glow-1"></div>
          <div className="rh-glow-2"></div>

          <div className="rh-top">
            <div className="rh-station">
              <i className="fas fa-tower-broadcast"></i>
              <span>{npData?.station?.name || stationName}</span>
            </div>
            <div className="rh-badges">
              <div className={`rh-live-badge ${isPlaying || isLive ? "live" : "off"}`}>
                <span className="rh-live-dot"></span>
                {isPlaying || isLive ? "Live" : "Off Air"}
              </div>
            </div>
          </div>

          <div className="rh-main">
            <div className="rh-art-wrap">
              <div className="rh-art-ring"></div>
              <div className={`rh-art ${isPlaying ? "spinning" : ""}`}>
                {np?.song?.albumArt ? (
                  <img src={np.song.albumArt} alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                ) : (
                  <div className="rh-art-fallback">
                    <i className="fas fa-radio"></i>
                  </div>
                )}
              </div>
              {isPlaying && (
                <div className="rh-eq">
                  <span></span><span></span><span></span><span></span>
                </div>
              )}
              {isPlaying && <div className="rh-vinyl-lines"></div>}
            </div>

            <div className="rh-info">
              <div className="rh-track-name">{np?.song?.title || "Station Offline"}</div>
              <div className="rh-track-artist">{np?.song?.artist || "Not currently playing"}</div>
            </div>

            <button className={`rh-play-btn ${isPlaying ? "playing" : ""}`} onClick={() => router.push("/radio")} title="Open Radio">
              <i className="fas fa-play"></i>
              <div className="rh-play-ring"></div>
            </button>
          </div>

          <div className="rh-actions-row">
            <div className="rh-source">
              <i className="fas fa-radio"></i> {npData?.station?.name || "Radio"}
            </div>
            <div className="rh-listener-badge">
              <i className="fas fa-headphones"></i>
              {listeners}
            </div>
            <button className="rh-expand-small" onClick={() => router.push("/radio")}>
              <i className="fas fa-external-link-alt"></i>
            </button>
          </div>
        </div>          </section>

          {/* UPCOMING EVENTS */}
          <EventCarousel redirectUrl="/gallery" />

          {/* PHOTO CAROUSEL */}
          <section className="feed-section">
            <div className="section-header-inline">
              <h2 className="section-title">Photo Gallery</h2>
              <button className="section-link" onClick={() => router.push("/gallery")}>View All <i className="fas fa-chevron-right"></i></button>
            </div>
            <AlbumCarousel />
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

      {/* VIDEO GALLERY — recently added */}
      {!videoGalleryLoading && recentVideos.length > 0 && (
        <section className="feed-section">
          <div className="section-header-inline">
            <h2 className="section-title">Recently Added</h2>
            <button className="section-link" onClick={() => router.push("/tv")}>View All <i className="fas fa-chevron-right"></i></button>
          </div>
          <div className="vg-scroll">
            {recentVideos.map((v) => (
              <div key={v.id} className="vg-card" onClick={() => router.push(`/watch/${v.id}`)}>
                <div className="vg-thumb-wrap">
                  <img src={v.thumbnail} alt={v.title} loading="lazy" />
                  <span className="vg-duration">{Math.floor(v.duration / 60)}:{(v.duration % 60).toString().padStart(2, "0")}</span>
                </div>
                <div className="vg-info">
                  <div className="vg-title">{v.title}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* VIDEO GALLERY — this week's playlist */}
      {!videoGalleryLoading && weeklyVideos.length > 0 && (
        <section className="feed-section">
          <div className="section-header-inline">
            <h2 className="section-title">This Week&apos;s Playlist</h2>
            <button className="section-link" onClick={() => router.push("/tv")}>View All <i className="fas fa-chevron-right"></i></button>
          </div>
          <div className="vg-scroll">
            {weeklyVideos.map((v) => (
              <div key={v.id} className="vg-card" onClick={() => router.push(`/watch/${v.id}`)}>
                <div className="vg-thumb-wrap">
                  <img src={v.thumbnail} alt={v.title} loading="lazy" />
                  <span className="vg-duration">{Math.floor(v.duration / 60)}:{(v.duration % 60).toString().padStart(2, "0")}</span>
                </div>
                <div className="vg-info">
                  <div className="vg-title">{v.title}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* TODAY'S BROADCAST SCHEDULE */}
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
              <div className={`st-item${slot.isNow ? " now" : ""}${!slot.isNow ? "" : ""}`} key={i}>
                <div className="st-indicator">
                  {slot.isNow ? <div className="st-pulse"></div> : <div className="st-dot"></div>}
                </div>
                <div className="st-time">{slot.time}</div>
                <div className="st-body">
                  <div className={`st-label${slot.isNow ? "" : " upcoming"}`}>{slot.label}</div>
                  <div className="st-station"><i className="fas fa-radio"></i> {slot.stationName || "MOUNTAIN OF DELIVERANCE CHURCH Radio"}</div>
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
        <PremiumLoader />
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
        @media (min-width: 480px) { .app-container { max-width: 480px; margin: 0 auto; } }
        @media (min-width: 768px) {
            .feed-section { --section-px: 24px; padding: 0 var(--section-px) 20px; }
            .dash-header { padding: 12px 24px; }
            .pg-hero { height: 320px; border-radius: 24px; }
            .pg-hero-title { font-size: 28px; }
            .pg-grid { grid-template-columns: repeat(4, 1fr); gap: 10px; }
            .section-title { font-size: 19px; }
            .section-link { font-size: 13px; }
            .sc-card { width: 220px; }
            .fv-body { padding: 20px 24px 24px; }
        }
        @media (min-width: 1024px) {
            .pg-hero { height: 360px; }
            .pg-grid { grid-template-columns: repeat(5, 1fr); }
            .feed-section { padding: 0 32px 24px; }
        }
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
        .content-scroll { flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch; padding-bottom: 0; }
        .content-scroll > :last-child { margin-bottom: 72px; }
        .content-scroll::-webkit-scrollbar { display: none; }

        .feed-section { padding: 0 var(--section-px, 16px) 16px; }
        .feed-section { --section-px: 12px; }

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
        .rh-expand-small:active { background: var(--surface-elevated); transform: scale(0.88); }        /* ===== TV WRAP (removed tv-hero card — video now goes edge-to-edge like member TV page) ===== */
        .tv-top-wrap {
          margin: 0 calc(-1 * var(--section-px, 16px));
        }
        .tv-top {
          display: flex; align-items: center; justify-content: space-between;
          padding: 8px 16px;
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
        .tv-live-badge.live {
            background: rgba(59,130,246,0.12); color: #3B82F6;
        }
        .tv-live-badge.off {
            background: rgba(107,107,107,0.12); color: var(--text-tertiary);
        }
        .tv-live-dot {
            width: 6px; height: 6px; border-radius: 50%;
        }
        .tv-live-badge.live .tv-live-dot {
            background: #3B82F6;
            animation: livePulse 1.5s ease-in-out infinite;
        }
        .tv-live-badge.off .tv-live-dot {
            background: var(--text-tertiary);
        }
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
            display: flex;
            align-items: center;
            gap: 4px;
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
        .tv-end-card {
          position: absolute; inset: 0; z-index: 20;
          display: flex; align-items: center; justify-content: center;
          animation: fadeIn 0.3s ease;
        }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        .tv-end-card-bg {
          position: absolute; inset: 0;
          background: rgba(0,0,0,0.75);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
        }
        .tv-end-card-body {
          position: relative; z-index: 1;
          display: flex; flex-direction: column; align-items: center;
          gap: 10px; padding: 24px 20px; max-width: 320px;
          text-align: center;
        }
        .tv-end-card-label {
          font-size: 12px; font-weight: 700; color: var(--success);
          display: flex; align-items: center; gap: 6px;
        }
        .tv-end-card-label i { font-size: 14px; }
        .tv-end-card-thumb {
          position: relative; width: 100%; aspect-ratio: 16/9;
          max-width: 260px; border-radius: 10px; overflow: hidden;
          background: var(--surface-elevated);
          border: 1px solid rgba(255,255,255,0.08);
        }
        .tv-end-card-thumb img { width: 100%; height: 100%; object-fit: cover; }
        .tv-end-card-play-icon {
          position: absolute; inset: 0;
          display: flex; align-items: center; justify-content: center;
          background: rgba(0,0,0,0.15);
        }
        .tv-end-card-play-icon i {
          width: 44px; height: 44px; border-radius: 50%;
          background: rgba(255,255,255,0.15);
          display: flex; align-items: center; justify-content: center;
          font-size: 18px; color: #fff;
          backdrop-filter: blur(4px);
        }
        .tv-end-card-title {
          font-size: 15px; font-weight: 700; color: #fff;
          display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
          overflow: hidden; line-height: 1.4;
        }
        .tv-end-card-sub {
          font-size: 11px; color: var(--text-tertiary);
          margin-top: -4px;
        }
        .tv-end-card-btn {
          width: 100%; padding: 14px;
          border-radius: 12px; font-size: 14px; font-weight: 700;
          background: linear-gradient(135deg, #3B82F6, #6366F1);
          border: none; color: #fff; cursor: pointer;
          display: flex; align-items: center; justify-content: center; gap: 8px;
          transition: all 0.2s ease;
        }
        .tv-end-card-btn:active { transform: scale(0.97); }
        .tv-end-card-skip {
          padding: 6px 16px; border-radius: 8px;
          background: transparent; border: 1px solid rgba(255,255,255,0.1);
          color: var(--text-tertiary); font-size: 12px; font-weight: 600;
          cursor: pointer; transition: all 0.15s ease;
        }
        .tv-end-card-skip:active { background: rgba(255,255,255,0.05); }

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
        .tv-radio-block {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 8px;
            width: 100%;
            height: 100%;
            background: linear-gradient(135deg, rgba(232,168,56,0.08), rgba(232,168,56,0.02));
        }
        .tv-radio-icon-wrap {
            width: 48px; height: 48px;
            border-radius: 50%;
            background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end));
            display: flex; align-items: center; justify-content: center;
            font-size: 20px; color: #fff;
            box-shadow: 0 4px 20px rgba(232,168,56,0.3);
            animation: livePulse 2s ease-in-out infinite;
        }
        .tv-radio-block-label {
            font-size: 14px;
            font-weight: 700;
            color: var(--text-primary);
        }
        .tv-radio-block-sub {
            font-size: 11px;
            color: var(--text-tertiary);
        }
        .tv-channel-strip {
            display: flex;
            align-items: center;
            gap: 12px;
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
            font-size: 16px; color: var(--text-tertiary);
            position: relative;
        }
        .tv-channel-avatar i { font-size: 16px; color: #FF0000; }
        .tv-channel-avatar img { width: 100%; height: 100%; object-fit: cover; }
        .tv-avatar-img { position: absolute; inset: 0; border-radius: 50%; }
        .tv-channel-info { flex: 1; min-width: 0; }
        .tv-channel-name { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
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
        .tv-next-slot {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 8px 12px;
            font-size: 11px;
            color: var(--text-tertiary);
            background: var(--surface);
            border-radius: var(--radius-sm);
            border: 1px solid var(--border);
            position: relative;
            z-index: 1;
            margin-top: 6px;
        }
        .tv-next-slot i { color: #3B82F6; font-size: 10px; }

        .tv-start-btn {
          display: flex; align-items: center; justify-content: center; gap: 8px;
          width: 100%; padding: 14px;
          margin: 8px 16px 0;
          width: calc(100% - 32px);
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

        /* ===== VIDEO GALLERY ===== */
        .vg-scroll {
          display: flex;
          gap: 12px;
          overflow-x: auto;
          padding: 4px 20px 8px;
          scroll-snap-type: x mandatory;
          -webkit-overflow-scrolling: touch;
        }
        .vg-scroll::-webkit-scrollbar { display: none; }
        .vg-card {
          flex: 0 0 180px;
          scroll-snap-align: start;
          border-radius: var(--radius-sm);
          overflow: hidden;
          background: var(--surface);
          cursor: pointer;
          transition: transform 0.2s ease;
        }
        .vg-card:active { transform: scale(0.96); }
        .vg-thumb-wrap {
          position: relative;
          aspect-ratio: 16 / 9;
          background: #000;
        }
        .vg-thumb-wrap img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .vg-duration {
          position: absolute;
          bottom: 6px;
          right: 6px;
          background: rgba(0,0,0,0.85);
          color: #fff;
          font-size: 11px;
          font-weight: 600;
          padding: 2px 6px;
          border-radius: 4px;
        }
        .vg-info { padding: 10px 12px; }
        .vg-title {
          font-size: 13px;
          font-weight: 600;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .vg-empty {
          padding: 24px 20px;
          text-align: center;
          color: var(--text-tertiary);
          font-size: 14px;
        }

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
            <button className="ob-btn primary" onClick={() => { completeOnboarding(); }}>
              Get Started
            </button>
          )}
        </div>
      )}



      {/* ===== MAIN APP ===== */}
      <div className="app-container">
        <PremiumTopBar minimal />

        {offline && (
          <div className="offline-banner">
            <i className="fas fa-wifi-slash"></i>
            <span>You&apos;re offline — showing cached content</span>
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
        </div>

        <BottomNavBar activeTab="home" />
      </div>

      {imageViewer.ImageLightbox}
      </>}
    </>
  );
}
