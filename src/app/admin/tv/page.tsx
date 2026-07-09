"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useFullscreenToggle } from "@/lib/tv/fullscreen";
import {
  getChannel, getVideos, getVideosPage, saveChannel, saveVideos, clearAllVideos,
  getPlaylists, addPlaylist, deletePlaylist,
  generateBroadcast, getTodayBroadcast,
  getGivingConfig, saveGivingConfig,
  replyToPrayer,
  getUserTvState, updateUserTvProgress, autoInitUserPlaylist,
} from "@/lib/youtube";
import type { YouTubeChannel, YouTubeVideo, TVPlaylist, TVGivingConfig } from "@/lib/youtube";
import {
  getPaymentMethods, addPaymentMethod, updatePaymentMethod, deletePaymentMethod,
  getTransactions, updateTransactionStatus,
  type PaymentMethod, type Transaction,
} from "@/lib/giving";
import { auth, db } from "@/lib/firebase";
import {
  collection, collectionGroup, query, orderBy, onSnapshot, limit, Timestamp,
} from "firebase/firestore";
import { churchConfig } from "@/lib/churchConfig";
import AdminBottomNav from "@/components/admin/AdminBottomNav";
import { useTvPlayer } from "@/lib/tv/TvPlayerProvider";
import ToastBridge from "@/components/dashboard/ToastBridge";
import PremiumTopBar from "@/components/shared/PremiumTopBar";

export default function AdminTVPage() {
  const router = useRouter();
  const { toggleFullscreen } = useFullscreenToggle();
  const [channel, setChannel] = useState<YouTubeChannel | null>(null);
  const [videoCount, setVideoCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [channelIdInput, setChannelIdInput] = useState(
    churchConfig.youtube_channel_id || ""
  );
  const [lastSyncTime, setLastSyncTime] = useState<string>("");

  // ─── Global TvPlayerProvider (portal-based, survives page navigations) ───
  const adminTvPlayer = useTvPlayer();
  // Callback ref fires on every mount/remount (handles tab switching correctly)
  const tvPlayerTargetRef = useCallback((el: HTMLDivElement | null) => {
    adminTvPlayer.registerTarget(el);
  }, [adminTvPlayer]);

  // ─── All synced videos (for playlist builder) ───
  const [allVideos, setAllVideos] = useState<YouTubeVideo[]>([]);
  const [videoSearch, setVideoSearch] = useState("");

  // ─── Paginated video grid (channel tab, lazy loaded) ───
  const [paginatedVideos, setPaginatedVideos] = useState<YouTubeVideo[]>([]);
  const [paginatedLastPos, setPaginatedLastPos] = useState<number | null>(null);
  const [paginatedHasMore, setPaginatedHasMore] = useState(false);
  const [paginatedLoading, setPaginatedLoading] = useState(false);
  const paginatedLoadedRef = useRef(false);

  // ─── Playlist state ───
  const [playlists, setPlaylists] = useState<TVPlaylist[]>([]);
  const [playlistsLoading, setPlaylistsLoading] = useState(true);
  const [showAddPlaylist, setShowAddPlaylist] = useState(false);
  const [plName, setPlName] = useState("");
  const [plDate, setPlDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [plTime, setPlTime] = useState("09:00");
  const [plRecurring, setPlRecurring] = useState(false);
  const [plDay, setPlDay] = useState("0");
  const [plVideoIds, setPlVideoIds] = useState<string[]>([]);
  const [plSaving, setPlSaving] = useState(false);
  const [plDeletingId, setPlDeletingId] = useState<string | null>(null);
  // ─── Admin TV player resume state (for embedded player) ───
  // Use UID-scoped localStorage keys for per-admin privacy (like member pages)
  const tvUid = auth.currentUser?.uid;
  const ADMIN_TV_SEEK_KEY = tvUid ? `admin_tv_resume_seek_${tvUid}` : "admin_tv_resume_seek";
  const ADMIN_TV_INDEX_KEY = tvUid ? `admin_tv_resume_index_${tvUid}` : "admin_tv_resume_index";

  // One-time migration: clean up old non-UID-scoped keys so admins don't share progress
  useEffect(() => {
    if (tvUid && typeof window !== "undefined") {
      localStorage.removeItem("admin_tv_resume_seek");
      localStorage.removeItem("admin_tv_resume_index");
    }
  }, []);

  // Firestore-backed TV progress (persists across browser sessions like member dashboard)
  const [tvFirestoreLoaded, setTvFirestoreLoaded] = useState(false);

  const [currentTvIndex, setCurrentTvIndex] = useState(
    () => typeof window !== "undefined" ? Number(localStorage.getItem(ADMIN_TV_INDEX_KEY)) || 0 : 0
  );
  const [broadcasting, setBroadcasting] = useState(false);
  const [broadcastSlotCount, setBroadcastSlotCount] = useState(0);
  // ─── External video paste ───
  const [externalUrl, setExternalUrl] = useState("");
  const [externalAdding, setExternalAdding] = useState(false);

  function showToast(title: string, message: string, type: string, duration: number) {
    window.dispatchEvent(
      new CustomEvent("show-toast", {
        detail: { title, message, type, duration },
      })
    );
  }
  const cachedAdminSeek = typeof window !== "undefined" ? Number(localStorage.getItem(ADMIN_TV_SEEK_KEY)) || 0 : 0;
  const lastAdminTvSeekRef = useRef(0);
  const lastAdminTvIndexRef = useRef(0);

  // Load current channel data + restore Firestore TV state
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const [c, videos] = await Promise.all([getChannel(), getVideos({ max: 50, includeHidden: true })]);
        if (!mounted) return;
        setChannel(c);
        setVideoCount(videos.length);
        setAllVideos(videos);
        if (c?.channelId) setChannelIdInput(c.channelId);

        // Restore TV progress from Firestore (like member dashboard)
        const uid = auth.currentUser?.uid;
        if (uid) {
          const tvState = await getUserTvState(uid);
          if (!mounted) return;
          // Restore index if within range
          if (tvState.currentIndex > 0 && tvState.currentIndex < videos.length) {
            setCurrentTvIndex(tvState.currentIndex);
          }
          // Restore seek from Firestore (overrides localStorage for fresh session)
          if (tvState.currentSeek > 0.1) {
            if (typeof window !== "undefined") {
              localStorage.setItem(ADMIN_TV_SEEK_KEY, String(tvState.currentSeek));
            }
            lastAdminTvSeekRef.current = tvState.currentSeek;
          }
          // Auto-init playlist if empty (fill with all synced videos)
          if (tvState.playlist.length === 0 && videos.length > 0) {
            await autoInitUserPlaylist(uid);
          }
        }
        setTvFirestoreLoaded(true);
      } catch {} finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => { mounted = false; };
  }, []);



  // Load playlists
  useEffect(() => {
    let mounted = true;
    const loadPl = async () => {
      try {
        const list = await getPlaylists();
        if (mounted) setPlaylists(list);
      } catch {} finally {
        if (mounted) setPlaylistsLoading(false);
      }
    };
    loadPl();
    return () => { mounted = false; };
  }, []);

  // ─── Paginated video grid — load first page on mount ───
  useEffect(() => {
    if (paginatedLoadedRef.current) return;
    paginatedLoadedRef.current = true;
    (async () => {
      setPaginatedLoading(true);
      try {
        const { videos: page, lastPosition } = await getVideosPage(12, undefined, true);
        setPaginatedVideos(page);
        setPaginatedLastPos(lastPosition);
        setPaginatedHasMore(page.length === 12);
      } catch {}
      setPaginatedLoading(false);
    })();
  }, []);

  const handleLoadMoreVideos = useCallback(async () => {
    if (paginatedLoading || !paginatedHasMore) return;
    setPaginatedLoading(true);
    try {
      const { videos: page, lastPosition } = await getVideosPage(12, paginatedLastPos ?? undefined, true);
      setPaginatedVideos((prev) => [...prev, ...page]);
      setPaginatedLastPos(lastPosition);
      setPaginatedHasMore(page.length === 12);
    } catch {}
    setPaginatedLoading(false);
  }, [paginatedLastPos, paginatedLoading, paginatedHasMore]);

  // Add video to playlist
  const addVideoToPlaylist = useCallback((videoId: string) => {
    setPlVideoIds((prev) => (prev.includes(videoId) ? prev : [...prev, videoId]));
  }, []);

  // Remove video from playlist
  const removeVideoFromPlaylist = useCallback((videoId: string) => {
    setPlVideoIds((prev) => prev.filter((id) => id !== videoId));
  }, []);

  // Move video up in playlist
  const moveVideoUp = useCallback((index: number) => {
    if (index === 0) return;
    setPlVideoIds((prev) => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  }, []);

  // Move video down in playlist
  const moveVideoDown = useCallback((index: number) => {
    setPlVideoIds((prev) => {
      if (index >= prev.length - 1) return prev;
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  }, []);

  // Add playlist handler
  const handleAddPlaylist = useCallback(async () => {
    if (!plName.trim()) {
      showToast("Name Required", "Enter a name for this playlist", "error", 3000);
      return;
    }
    if (plVideoIds.length === 0) {
      showToast("No Videos", "Add at least one video to the playlist", "error", 3000);
      return;
    }
    if (!plTime) {
      showToast("Time Required", "Set a time for this playlist", "error", 3000);
      return;
    }
    setPlSaving(true);
    try {
      await addPlaylist({
        title: plName.trim(),
        videoIds: plVideoIds,
        scheduledDate: plRecurring ? "" : plDate,
        scheduledTime: plTime,
        dayOfWeek: plRecurring ? parseInt(plDay) : null,
        isRecurring: plRecurring,
        isActive: true,
      });
      const list = await getPlaylists();
      setPlaylists(list);
      setShowAddPlaylist(false);
      setPlName("");
      setPlVideoIds([]);
      showToast("Playlist Created!", `"${plName.trim()}" will play at the scheduled time`, "success", 3000);
    } catch {
      showToast("Error", "Could not save playlist", "error", 3000);
    }
    setPlSaving(false);
  }, [plName, plVideoIds, plDate, plTime, plRecurring, plDay]);

  // Delete playlist handler
  const handleDeletePlaylist = useCallback(async (id: string) => {
    setPlDeletingId(id);
    try {
      await deletePlaylist(id);
      setPlaylists((prev) => prev.filter((p) => p.id !== id));
      showToast("Removed", "Playlist deleted", "success", 2500);
    } catch {
      showToast("Error", "Could not delete playlist", "error", 3000);
    }
    setPlDeletingId(null);
  }, []);

  // Sync channel from YouTube API
  const handleSync = useCallback(async () => {
    const channelId = channelIdInput.trim();
    if (!channelId) {
      showToast("Channel Required", "Enter a YouTube channel ID", "error", 3000);
      return;
    }

    setSyncing(true);
    try {
      const res = await fetch("/api/youtube/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Sync failed");
      }

      const data = await res.json();

      await saveChannel(data.channel);
      setChannel(data.channel);

      await clearAllVideos();
      if (data.videos.length > 0) {
        await saveVideos(data.videos);
      }

      setVideoCount(data.videos.length);
      setAllVideos(data.videos);
      setLastSyncTime(new Date().toLocaleTimeString());
      showToast(
        "Sync Complete",
        `${data.videos.length} videos synced from "${data.channel.title}"`,
        "success",
        4000
      );
    } catch (err: any) {
      showToast("Sync Failed", err.message || "Could not sync channel", "error", 4000);
    } finally {
      setSyncing(false);
    }
  }, [channelIdInput]);

  // Helper: get YouTubeVideo for an id
  const getVideoById = useCallback(
    (id: string) => allVideos.find((v) => v.id === id),
    [allVideos]
  );

  // Advance to next video in the admin embedded player (save to Firestore + localStorage)
  const advanceTvVideo = useCallback(() => {
    const nextIndex = (lastAdminTvIndexRef.current + 1) % (allVideos.length || 1);
    setCurrentTvIndex(nextIndex);
    // Reset seek cache
    if (typeof window !== "undefined") {
      localStorage.setItem(ADMIN_TV_SEEK_KEY, "0");
      localStorage.setItem(ADMIN_TV_INDEX_KEY, String(nextIndex));
    }
    // Save to Firestore for cross-session persistence
    const uid = auth.currentUser?.uid;
    if (uid) {
      updateUserTvProgress(uid, nextIndex, 0);
    }
  }, [allVideos.length]);

  const currentVideo = allVideos.length > 0 ? allVideos[currentTvIndex >= allVideos.length ? 0 : currentTvIndex] : null;

  // Sync index ref when currentTvIndex changes + update localStorage
  useEffect(() => {
    lastAdminTvIndexRef.current = currentTvIndex;
    if (typeof window !== "undefined") {
      localStorage.setItem(ADMIN_TV_INDEX_KEY, String(currentTvIndex));
    }
  }, [currentTvIndex]);

  // ─── Derive initial seek from localStorage ───
  const adminTvInitialSeek = cachedAdminSeek > 0.1 ? cachedAdminSeek : undefined;

  // Track current seek for periodic saves
  const handleAdminTvTimeUpdate = useCallback((time: number) => {
    lastAdminTvSeekRef.current = time;
    if (typeof window !== "undefined") {
      localStorage.setItem(ADMIN_TV_SEEK_KEY, String(time));
    }
  }, []);

  // Call play() when current video changes
  // NOTE: No else/hide branch — keeping the player alive across async loads
  // prevents unnecessary destruction/recreation of the YouTube iframe.
  // The player is restored from localStorage seek on mount.
  useEffect(() => {
    if (currentVideo) {
      adminTvPlayer.play(currentVideo.id, adminTvInitialSeek);
    }
  }, [currentVideo?.id, adminTvInitialSeek, adminTvPlayer]);

  // Keep callbacks in sync with latest versions
  useEffect(() => {
    adminTvPlayer.setCallbacks({
      onEnded: advanceTvVideo,
      onTimeUpdate: handleAdminTvTimeUpdate,
    });
  }, [advanceTvVideo, handleAdminTvTimeUpdate, adminTvPlayer]);

  // Save current progress to Firestore + localStorage (used by interval + cleanup)
  const saveAdminTvProgress = useCallback(() => {
    const seek = lastAdminTvSeekRef.current;
    const index = lastAdminTvIndexRef.current;
    // Always persist to localStorage for instant cross-page resume
    if (typeof window !== "undefined") {
      localStorage.setItem(ADMIN_TV_SEEK_KEY, String(seek));
      localStorage.setItem(ADMIN_TV_INDEX_KEY, String(index));
    }
    // Persist to Firestore for cross-session resume
    const uid = auth.currentUser?.uid;
    if (uid) {
      updateUserTvProgress(uid, index, seek);
    }
  }, []);

  // Periodically save seek position (every 5s)
  useEffect(() => {
    const interval = setInterval(saveAdminTvProgress, 5000);
    return () => {
      clearInterval(interval);
      saveAdminTvProgress();
    };
  }, [saveAdminTvProgress]);

  // Save on page unload / tab hide
  useEffect(() => {
    const handleUnload = () => saveAdminTvProgress();
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") saveAdminTvProgress();
    };
    window.addEventListener("beforeunload", handleUnload);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("beforeunload", handleUnload);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [saveAdminTvProgress]);

  // Tab visibility — restore TV state from Firestore when tab becomes visible (web)
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.visibilityState === "visible") {
        const uid = auth.currentUser?.uid;
        if (uid) {
          // Re-fetch TV state from Firestore to pick up changes from other tabs/pages
          try {
            const state = await getUserTvState(uid);
            if (state.currentIndex >= 0 && state.currentIndex < allVideos.length) {
              setCurrentTvIndex(state.currentIndex);
            }
            if (state.currentSeek > 0.1) {
              if (typeof window !== "undefined") {
                localStorage.setItem(ADMIN_TV_SEEK_KEY, String(state.currentSeek));
              }
              lastAdminTvSeekRef.current = state.currentSeek;
            }
          } catch {}
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [allVideos.length]);

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
            saveAdminTvProgress();
          } else {
            const uid = auth.currentUser?.uid;
            if (uid) {
              getUserTvState(uid).then((s) => {
                if (s.currentIndex >= 0 && s.currentIndex < allVideos.length) {
                  setCurrentTvIndex(s.currentIndex);
                }
                if (s.currentSeek > 0.1) {
                  if (typeof window !== "undefined") {
                    localStorage.setItem(ADMIN_TV_SEEK_KEY, String(s.currentSeek));
                  }
                  lastAdminTvSeekRef.current = s.currentSeek;
                }
              });
            }
          }
        }).then((handler) => {
          if (canceled) handler.remove();
        });
      });
    return () => { canceled = true; };
  }, [saveAdminTvProgress, allVideos.length]);

  // Generate today's broadcast
  const handleGenerateBroadcast = useCallback(async () => {
    setBroadcasting(true);
    try {
      const count = await generateBroadcast();
      setBroadcastSlotCount(count);
      showToast(
        "Broadcast Generated",
        count > 0
          ? `${count} scheduled slots created for today`
          : "No active playlists scheduled for today",
        count > 0 ? "success" : "info",
        3500
      );
    } catch {
      showToast("Error", "Could not generate broadcast", "error", 3000);
    }
    setBroadcasting(false);
  }, []);

  // Load broadcast status
  useEffect(() => {
    getTodayBroadcast().then((b) => {
      if (b) setBroadcastSlotCount(b.slots.length);
    });
  }, []);

  // ─── YouTube URL parser ───
  function extractYouTubeId(input: string): string | null {
    const trimmed = input.trim();
    // Already a plain ID (11 chars, alphanumeric + -_)
    if (/^[\w-]{11}$/.test(trimmed)) return trimmed;
    // youtube.com/watch?v=ID
    const match = trimmed.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/);
    return match ? match[1] : null;
  }

  // Add external video
  const handleAddExternalVideo = useCallback(async () => {
    const id = extractYouTubeId(externalUrl);
    if (!id) {
      showToast("Invalid Link", "Enter a valid YouTube URL or video ID", "error", 3000);
      return;
    }
    if (plVideoIds.includes(id)) {
      showToast("Already Added", "This video is already in the playlist", "info", 2500);
      setExternalUrl("");
      return;
    }
    setExternalAdding(true);
    // Try to fetch title from YouTube oEmbed (no API key needed)
    try {
      const res = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`);
      if (res.ok) {
        const data = await res.json();
        showToast("Video Found", `"${data.title}" added to playlist`, "success", 2500);
      }
    } catch {}
    addVideoToPlaylist(id);
    setExternalUrl("");
    setExternalAdding(false);
  }, [externalUrl, plVideoIds, addVideoToPlaylist]);

  // Filter videos by search
  const filteredVideos = videoSearch
    ? allVideos.filter(
        (v) =>
          v.title.toLowerCase().includes(videoSearch.toLowerCase()) ||
          v.id.toLowerCase().includes(videoSearch.toLowerCase())
      )
    : allVideos;

  // ─── LIVE DASHBOARD STATE ───
  type AdminTabId = "channel" | "schedule" | "live";
  const [activeAdminTab, setActiveAdminTab] = useState<AdminTabId>("channel");
  type LiveSubTab = "dashboard" | "chat" | "prayers" | "giving";
  const [liveSubTab, setLiveSubTab] = useState<LiveSubTab>("dashboard");

  // Chat messages (read-only, for admin to monitor)
  interface LiveChatMsg {
    id: string;
    userId: string;
    userName: string;
    message: string;
    timestamp: Date;
  }
  interface LivePrayer {
    id: string;
    userId: string;
    name: string;
    request: string;
    createdAt: Date;
    replyText?: string;
    repliedBy?: string;
    repliedAt?: Date;
  }

  const [liveChatMsgs, setLiveChatMsgs] = useState<LiveChatMsg[]>([]);
  const [livePrayers, setLivePrayers] = useState<LivePrayer[]>([]);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyTexts, setReplyTexts] = useState<Record<string, string>>({});
  const [replyingSaving, setReplyingSaving] = useState<string | null>(null);
  const [viewerCount, setViewerCount] = useState(0);
  const [givingConfig, setGivingConfig] = useState<TVGivingConfig | null>(null);
  const [gcSaving, setGcSaving] = useState(false);
  const [gcAmounts, setGcAmounts] = useState("");
  const [gcChurchName, setGcChurchName] = useState("");
  const [gcDescription, setGcDescription] = useState("");
  const [gcMethods, setGcMethods] = useState("");

  // Giving management state
  type GivingSubTab = "config" | "methods" | "transactions";
  const [givingSubTab, setGivingSubTab] = useState<GivingSubTab>("methods");
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [methodsLoading, setMethodsLoading] = useState(false);
  const [showMethodForm, setShowMethodForm] = useState(false);
  const [editingMethod, setEditingMethod] = useState<PaymentMethod | null>(null);
  const [methodName, setMethodName] = useState("");
  const [methodType, setMethodType] = useState<PaymentMethod["type"]>("mpesa");
  const [methodDetails, setMethodDetails] = useState("");
  const [methodIcon, setMethodIcon] = useState("");
  const [methodInstructions, setMethodInstructions] = useState("");
  const [methodEnabled, setMethodEnabled] = useState(true);
  const [methodSaving, setMethodSaving] = useState(false);

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [transLoading, setTransLoading] = useState(false);
  const [feedbackInputs, setFeedbackInputs] = useState<Record<string, string>>({});

  // Live chat listener
  useEffect(() => {
    const q = query(
      collection(db, "tv_chat"),
      orderBy("timestamp", "desc"),
      limit(200)
    );
    const unsub = onSnapshot(q, (snap) => {
      const list: LiveChatMsg[] = [];
      snap.forEach((d) => {
        const data = d.data();
        list.push({
          id: d.id,
          userId: data.userId || "",
          userName: data.userName || "Anonymous",
          message: data.message || "",
          timestamp: (data.timestamp as Timestamp)?.toDate() || new Date(),
        });
      });
      setLiveChatMsgs(list);
    });
    return () => unsub();
  }, []);

  // Live prayer requests listener (collectionGroup — sees all users' prayers)
  const prayerBufferRef = useRef<LivePrayer[]>([]);
  useEffect(() => {
    const q = query(
      collectionGroup(db, "tv_prayers"),
      orderBy("createdAt", "desc"),
      limit(200)
    );
    prayerBufferRef.current = [];
    const unsub = onSnapshot(q, (snap) => {
      snap.docChanges().forEach((change) => {
        if (change.type === "removed") {
          prayerBufferRef.current = prayerBufferRef.current.filter((p) => p.id !== change.doc.id);
          return;
        }
        const data = change.doc.data();
        // Extract userId from doc path: "users/{userId}/tv_prayers/{docId}"
        const pathParts = change.doc.ref.path.split("/");
        const userId = pathParts.length >= 4 ? pathParts[1] : (data.userId || "");
        const entry: LivePrayer = {
          id: change.doc.id,
          userId,
          name: data.name || "Anonymous",
          request: data.request || "",
          createdAt: (data.createdAt as Timestamp)?.toDate() || new Date(),
          replyText: data.replyText || undefined,
          repliedBy: data.repliedBy || undefined,
          repliedAt: data.repliedAt ? (data.repliedAt as Timestamp)?.toDate() : undefined,
        };
        if (change.type === "added") {
          prayerBufferRef.current = [entry, ...prayerBufferRef.current];
        } else if (change.type === "modified") {
          prayerBufferRef.current = prayerBufferRef.current.map((p) =>
            p.id === change.doc.id ? entry : p
          );
        }
      });
      setLivePrayers(prayerBufferRef.current);
    });
    return () => unsub();
  }, []);

  // Poll active viewers every 15 seconds
  useEffect(() => {
    let mounted = true;
    const poll = async () => {
      try {
        const { countActiveViewers } = await import("@/lib/youtube");
        const count = await countActiveViewers();
        if (mounted) setViewerCount(count);
      } catch {}
    };
    poll();
    const interval = setInterval(poll, 15000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  // Load giving config
  useEffect(() => {
    getGivingConfig().then((c) => {
      setGivingConfig(c);
      setGcAmounts(c.amounts.join(", "));
      setGcChurchName(c.churchName);
      setGcDescription(c.description);
      setGcMethods(c.methods.map((m) => `${m.icon}|${m.label}|${m.link}`).join("\n"));
    });
  }, []);

  // Save giving config
  const handleSaveGivingConfig = useCallback(async () => {
    setGcSaving(true);
    try {
      const amounts = gcAmounts.split(",").map((s) => s.trim()).filter(Boolean);
      const methods = gcMethods.split("\n").filter(Boolean).map((line) => {
        const parts = line.split("|").map((s) => s.trim());
        return { icon: parts[0] || "fa-heart", label: parts[1] || "Give", link: parts[2] || "/admin/giving" };
      });
      await saveGivingConfig({
        amounts,
        churchName: gcChurchName.trim() || "the Church",
        description: gcDescription.trim() || "Support the ministry",
        methods,
      });
      const fresh = await getGivingConfig();
      setGivingConfig(fresh);
      showToast("Saved", "Giving configuration updated", "success", 2500);
    } catch {
      showToast("Error", "Could not save giving config", "error", 3000);
    }
    setGcSaving(false);
  }, [gcAmounts, gcChurchName, gcDescription, gcMethods]);

  // Load giving management data
  const loadMethods = useCallback(async () => {
    setMethodsLoading(true);
    try { setMethods(await getPaymentMethods()); } catch { showToast("Error", "Failed to load payment methods", "error", 3000); }
    setMethodsLoading(false);
  }, []);

  const loadTransactions = useCallback(async () => {
    setTransLoading(true);
    try { setTransactions(await getTransactions()); } catch { showToast("Error", "Failed to load transactions", "error", 3000); }
    setTransLoading(false);
  }, []);

  useEffect(() => { loadMethods(); loadTransactions(); }, [loadMethods, loadTransactions]);

  const resetMethodForm = () => {
    setEditingMethod(null); setMethodName(""); setMethodType("mpesa");
    setMethodDetails(""); setMethodIcon(""); setMethodInstructions(""); setMethodEnabled(true);
  };

  const openEditMethod = (m: PaymentMethod) => {
    setEditingMethod(m); setMethodName(m.name); setMethodType(m.type);
    setMethodDetails(Object.entries(m.details).map(([k, v]) => `${k}: ${v}`).join("\n"));
    setMethodIcon(m.icon); setMethodInstructions(m.instructions); setMethodEnabled(m.enabled);
    setShowMethodForm(true);
  };

  const handleSaveMethod = async () => {
    if (!methodName.trim()) { showToast("Validation", "Method name is required", "error", 3000); return; }
    setMethodSaving(true);
    const details: Record<string, string> = {};
    methodDetails.split("\n").filter(Boolean).forEach((line) => {
      const idx = line.indexOf(":");
      if (idx > 0) details[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    });
    const payload = {
      name: methodName.trim(), type: methodType, details,
      icon: methodIcon || "fa-circle-dollar", instructions: methodInstructions.trim(),
      enabled: methodEnabled, order: editingMethod ? editingMethod.order : methods.length,
    };
    try {
      if (editingMethod?.id) { await updatePaymentMethod(editingMethod.id, payload); showToast("Updated", "Payment method updated", "success", 2500); }
      else { await addPaymentMethod(payload); showToast("Added", "Payment method added", "success", 2500); }
      resetMethodForm(); setShowMethodForm(false); await loadMethods();
    } catch { showToast("Error", "Failed to save payment method", "error", 3000); }
    setMethodSaving(false);
  };

  const handleDeleteMethod = async (id: string, name: string) => {
    if (!window.confirm(`Delete "${name}"?`)) return;
    try { await deletePaymentMethod(id); showToast("Deleted", `"${name}" removed`, "success", 2500); await loadMethods(); }
    catch { showToast("Error", "Failed to delete payment method", "error", 3000); }
  };

  const handleToggleMethod = async (m: PaymentMethod) => {
    if (!m.id) return;
    try { await updatePaymentMethod(m.id, { enabled: !m.enabled }); await loadMethods(); }
    catch { showToast("Error", "Failed to toggle method", "error", 3000); }
  };

  const handleConfirmTx = async (id: string, memberName: string) => {
    const feedback = feedbackInputs[id]?.trim() || "Thank you for your generous giving!";
    try {
      await updateTransactionStatus(id, "confirmed", feedback);
      showToast("Confirmed", `${memberName}'s giving confirmed`, "success", 2500);
      setFeedbackInputs((prev) => ({ ...prev, [id]: "" }));
      await loadTransactions();
    } catch { showToast("Error", "Failed to confirm transaction", "error", 3000); }
  };

  const handleRejectTx = async (id: string, memberName: string) => {
    const feedback = feedbackInputs[id]?.trim() || "We could not verify this transaction. Please contact us.";
    try {
      await updateTransactionStatus(id, "rejected", feedback);
      showToast("Rejected", `${memberName}'s giving rejected`, "info", 2500);
      setFeedbackInputs((prev) => ({ ...prev, [id]: "" }));
      await loadTransactions();
    } catch { showToast("Error", "Failed to reject transaction", "error", 3000); }
  };

  const txStats = {
    pending: transactions.filter((t) => t.status === "pending").length,
    confirmed: transactions.filter((t) => t.status === "confirmed").length,
    rejected: transactions.filter((t) => t.status === "rejected").length,
  };

  // Count unique users in chat (proxy for active chatters)
  const uniqueChatters = new Set(liveChatMsgs.map((m) => m.userId)).size;

  // ─── ADMIN TABS ───
  const ADMIN_TABS: { id: AdminTabId; label: string; icon: string }[] = [
    { id: "channel", label: "Channel", icon: "fa-tv" },
    { id: "schedule", label: "Schedule", icon: "fa-calendar" },
    { id: "live", label: "Live", icon: "fa-chart-line" },
  ];

  const renderChannelTab = () => (
    <>
      {/* ─── TV CARD (matches member dashboard `tv-hero`) ─── */}
      {!channel && (
        <div className="no-channel">
          <i className="fab fa-youtube"></i>
          <h3>No Channel Connected</h3>
          <p>Enter a YouTube channel ID below to get started.</p>
        </div>
      )}

      {/* Channel ID Input */}
      <div className="form-group">
        <label className="form-label">
          <i className="fas fa-link"></i>
          YouTube Channel ID
        </label>
        <input
          className="form-input"
          type="text"
          placeholder="UC_dQw4w9WgXcQ..."
          value={channelIdInput}
          onChange={(e) => setChannelIdInput(e.target.value)}
        />
        <span className="form-hint">
          <i className="fas fa-circle-info"></i>
          Find it in your YouTube channel URL: youtube.com/channel/<strong>UC...</strong>
        </span>
      </div>

      {/* Sync Button */}
      <button
        className="btn-primary"
        onClick={handleSync}
        disabled={syncing || !channelIdInput.trim()}
      >
        {syncing ? (
          <><span className="spinner"></span> Syncing...</>
        ) : (
          <><i className="fas fa-sync"></i> {channel ? "Sync Now" : "Connect Channel"}</>
        )}
      </button>

      {/* Stats */}
      {channel && (
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-value" style={{ color: "var(--primary)" }}>{videoCount}</div>
            <div className="stat-label">Videos</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: "#FF0000" }}>
              {channel.subscriberCount ? (
                parseInt(channel.subscriberCount) > 1000000
                  ? `${(parseInt(channel.subscriberCount) / 1000000).toFixed(1)}M`
                  : parseInt(channel.subscriberCount) > 1000
                    ? `${(parseInt(channel.subscriberCount) / 1000).toFixed(1)}K`
                    : channel.subscriberCount
              ) : "0"}
            </div>
            <div className="stat-label">Subscribers</div>
          </div>
        </div>
      )}

      {/* ─── SYNCED VIDEOS GRID (paginated, lazy-loaded) ─── */}
      {channel && (
        <section>
          <div className="section-title" style={{ marginTop: 8, marginBottom: 12 }}>
            <i className="fas fa-video"></i>
            Synced Videos
            {paginatedVideos.length > 0 && (
              <span style={{ fontSize: 11, color: "var(--text-tertiary)", fontWeight: 500, marginLeft: 4 }}>
                ({paginatedVideos.length} loaded)
              </span>
            )}
          </div>

          {paginatedVideos.length === 0 && paginatedLoading ? (
            <div className="tv-grid-skeleton">
              {[1,2,3,4].map((i) => (
                <div key={i} className="tv-grid-skeleton-card">
                  <div className="tv-grid-skeleton-thumb"></div>
                  <div className="tv-grid-skeleton-title"></div>
                  <div className="tv-grid-skeleton-meta"></div>
                </div>
              ))}
            </div>
          ) : paginatedVideos.length === 0 ? (
            <div className="tv-grid-empty">
              <i className="fas fa-video-slash"></i>
              <span>No videos synced yet. Connect a channel and sync.</span>
            </div>
          ) : (
            <>
              <div className="tv-grid">
                {paginatedVideos.map((v) => (
                  <div key={v.id} className="tv-grid-card">
                    <div className="tv-grid-card-thumb">
                      <img
                        src={v.thumbnail || `https://i.ytimg.com/vi/${v.id}/default.jpg`}
                        alt={v.title}
                        loading="lazy"
                      />
                      <div className="tv-grid-card-duration">
                        {v.duration > 0
                          ? `${Math.floor(v.duration / 60)}:${String(v.duration % 60).padStart(2, "0")}`
                          : ""}
                      </div>
                      {v.isFeatured && <div className="tv-grid-card-badge featured"><i className="fas fa-star"></i></div>}
                      {v.isHidden && <div className="tv-grid-card-badge hidden"><i className="fas fa-eye-slash"></i></div>}
                    </div>
                    <div className="tv-grid-card-info">
                      <div className="tv-grid-card-title">{v.title}</div>
                      <div className="tv-grid-card-meta">{v.channelTitle}</div>
                    </div>
                  </div>
                ))}
              </div>
              {paginatedHasMore && (
                <button
                  className="tv-grid-load-more"
                  onClick={handleLoadMoreVideos}
                  disabled={paginatedLoading}
                >
                  {paginatedLoading ? (
                    <><i className="fas fa-spinner fa-spin"></i> Loading...</>
                  ) : (
                    <><i className="fas fa-chevron-down"></i> Load More</>
                  )}
                </button>
              )}
              {paginatedLoading && paginatedVideos.length > 0 && (
                <div style={{ textAlign: "center", padding: 12, color: "var(--text-tertiary)", fontSize: 12 }}>
                  <i className="fas fa-spinner fa-spin"></i> Loading more...
                </div>
              )}
            </>
          )}
        </section>
      )}
    </>
  );

  const renderScheduleTab = () => (
    <>
      {/* ─── BROADCAST GENERATOR ─── */}
      <div className="section-title" style={{ marginTop: 4 }}>
        <i className="fas fa-tower-broadcast"></i>
        TV Broadcast
        {broadcastSlotCount > 0 && (
          <span style={{ fontSize: 11, color: "var(--text-tertiary)", fontWeight: 500 }}>
            ({broadcastSlotCount} slots)
          </span>
        )}
      </div>
      <button
        className="btn-primary"
        onClick={handleGenerateBroadcast}
        disabled={broadcasting}
      >
        {broadcasting ? (
          <><span className="spinner"></span> Generating...</>
        ) : (
          <><i className="fas fa-calendar-day"></i> Generate Today's Broadcast</>
        )}
      </button>

      {/* ─── SCHEDULED PLAYLISTS ─── */}
      <div style={{ borderTop: "1px solid var(--border)", marginTop: 8 }}></div>
      <div className="section-title" style={{ marginTop: 4 }}>
        <i className="fas fa-list"></i>
        Scheduled Playlists
        <span style={{ fontSize: 11, color: "var(--text-tertiary)", fontWeight: 500 }}>
          ({playlists.length})
        </span>
      </div>

      <button
        className="btn-outline"
        onClick={() => setShowAddPlaylist(!showAddPlaylist)}
      >
        <i className={`fas fa-${showAddPlaylist ? "minus" : "plus"}`}></i>
        {showAddPlaylist ? "Cancel" : "Create Scheduled Playlist"}
      </button>

      {showAddPlaylist && (
        <div className="pl-builder">
          <div className="form-group">
            <label className="form-label"><i className="fas fa-tag"></i> Playlist Name</label>
            <input className="form-input" type="text" placeholder="e.g. Sunday Service" value={plName} onChange={(e) => setPlName(e.target.value)} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13, color: "var(--text-secondary)" }}>
              <input type="checkbox" checked={plRecurring} onChange={(e) => setPlRecurring(e.target.checked)} style={{ accentColor: "var(--primary)" }} />
              Recurring weekly
            </label>
          </div>
          {plRecurring ? (
            <div className="form-group">
              <label className="form-label"><i className="fas fa-calendar-week"></i> Day of Week</label>
              <select className="form-input" value={plDay} onChange={(e) => setPlDay(e.target.value)}
                style={{ appearance: "none", WebkitAppearance: "none", cursor: "pointer" }}
              >
                {["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"].map((d, i) => (
                  <option key={i} value={i}>{d}</option>
                ))}
              </select>
            </div>
          ) : (
            <div className="form-group">
              <label className="form-label"><i className="fas fa-calendar"></i> Date</label>
              <input className="form-input" type="date" value={plDate} onChange={(e) => setPlDate(e.target.value)} />
            </div>
          )}
          <div className="form-group">
            <label className="form-label"><i className="fas fa-clock"></i> Time</label>
            <input className="form-input" type="time" value={plTime} onChange={(e) => setPlTime(e.target.value)} />
          </div>
          <div className="pl-selected-header">
            <span><i className="fas fa-video"></i> Videos in playlist ({plVideoIds.length})</span>
          </div>
          {plVideoIds.length === 0 ? (
            <div style={{ padding: "12px 0", textAlign: "center", fontSize: 12, color: "var(--text-tertiary)" }}>
              No videos added yet. Browse synced videos below and tap <i className="fas fa-plus"></i> to add them.
            </div>
          ) : (
            <div className="pl-selected-list">
              {plVideoIds.map((id, i) => {
                const v = getVideoById(id);
                return (
                  <div key={id} className="pl-selected-item">
                    <div className="pl-selected-thumb">
                      <img src={v?.thumbnail || `https://img.youtube.com/vi/${id}/default.jpg`} alt="" />
                    </div>
                    <div className="pl-selected-title">{v?.title || id}</div>
                    <div className="pl-selected-pos">
                      <button onClick={() => moveVideoUp(i)} disabled={i === 0} style={{ opacity: i === 0 ? 0.3 : 1 }}><i className="fas fa-chevron-up"></i></button>
                      <button onClick={() => moveVideoDown(i)} disabled={i >= plVideoIds.length - 1} style={{ opacity: i >= plVideoIds.length - 1 ? 0.3 : 1 }}><i className="fas fa-chevron-down"></i></button>
                    </div>
                    <button className="pl-selected-remove" onClick={() => removeVideoFromPlaylist(id)}><i className="fas fa-xmark"></i></button>
                  </div>
                );
              })}
            </div>
          )}
          {/* External video paste */}
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <div className="form-group" style={{ flex: 1, minWidth: 0 }}>
              <label className="form-label"><i className="fas fa-link"></i> Paste YouTube Link or ID</label>
              <input className="form-input" type="text" placeholder="youtube.com/watch?v=..." value={externalUrl} onChange={(e) => setExternalUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && externalUrl.trim()) handleAddExternalVideo(); }} />
            </div>
            <button className="btn-primary small" style={{ width: "auto", padding: "14px 16px", whiteSpace: "nowrap", flexShrink: 0 }} onClick={handleAddExternalVideo} disabled={externalAdding || !externalUrl.trim()}>
              {externalAdding ? <span className="spinner" style={{ width: 18, height: 18 }}></span> : <><i className="fas fa-plus"></i> Add</>}
            </button>
          </div>
          {/* Browse videos */}
          <div className="form-group">
            <label className="form-label"><i className="fas fa-search"></i> Browse Synced Videos</label>
            <div className="pl-browse-search">
              <i className="fas fa-search"></i>
              <input className="form-input" type="text" placeholder="Search videos..." value={videoSearch} onChange={(e) => setVideoSearch(e.target.value)} style={{ paddingLeft: 36 }} />
            </div>
          </div>
          <div className="pl-browse-grid">
              {filteredVideos.length === 0 ? (
                <div style={{ padding: 16, textAlign: "center", fontSize: 12, color: "var(--text-tertiary)" }}>No videos found</div>
              ) : (
                filteredVideos.slice(0, 30).map((v) => {
                  const isAdded = plVideoIds.includes(v.id);
                  return (
                    <div key={v.id} className={`pl-browse-item ${isAdded ? "added" : ""}`} onClick={() => !isAdded && addVideoToPlaylist(v.id)}>
                      <div className="pl-browse-thumb"><img src={v.thumbnail || ""} alt="" /></div>
                      <div className="pl-browse-info">
                        <div className="pl-browse-title">{v.title}</div>
                        <div className="pl-browse-meta">{v.duration > 0 ? `${Math.floor(v.duration / 60)}:${String(v.duration % 60).padStart(2, "0")}` : ""}</div>
                      </div>
                      <div className={`pl-browse-add ${isAdded ? "added" : ""}`}><i className={`fas fa-${isAdded ? "check" : "plus"}`}></i></div>
                    </div>
                  );
                })
              )}
            </div>
          <button className="btn-primary" onClick={handleAddPlaylist} disabled={plSaving || !plName.trim() || plVideoIds.length === 0}>
            {plSaving ? <><span className="spinner"></span> Saving...</> : <><i className="fas fa-save"></i> Save Playlist</>}
          </button>
        </div>
      )}

      {playlistsLoading ? (
        <div className="loading-state"><span className="spinner"></span></div>
      ) : playlists.length === 0 ? (
        <div style={{ padding: 16, textAlign: "center", color: "var(--text-tertiary)", fontSize: 13 }}>
          No scheduled playlists. Create one above to run at a specific time.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {playlists.map((p) => {
            const dayName = p.dayOfWeek !== null ? ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][p.dayOfWeek] : "";
            return (
              <div key={p.id} className="preview-card" style={{ alignItems: "center" }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, flexShrink: 0, background: `linear-gradient(135deg, rgba(232,168,56,0.12), rgba(232,168,56,0.04))`, border: "1px solid rgba(232,168,56,0.12)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: "var(--primary)" }}>
                  <i className="fas fa-list"></i>
                </div>
                <div className="preview-info" style={{ flex: 1 }}>
                  <div className="preview-title">{p.title}</div>
                  <div className="preview-meta">
                    <i className="fas fa-clock"></i> {p.scheduledTime}
                    {p.isRecurring ? ` every ${dayName}` : ` on ${p.scheduledDate}`}
                    <span style={{ marginLeft: 8 }}>· {p.videoIds.length} videos</span>
                  </div>
                </div>
                <button style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--error)", fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }} onClick={() => handleDeletePlaylist(p.id)} disabled={plDeletingId === p.id}>
                  {plDeletingId === p.id ? <span className="spinner" style={{ width: 16, height: 16 }}></span> : <i className="fas fa-xmark"></i>}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </>
  );

  const renderLiveTab = () => (
    <>
      {/* ─── LIVE SUB-TABS ─── */}
      <div className="live-sub-tabs">
        <button className={`live-sub-tab${liveSubTab === "dashboard" ? " active" : ""}`} onClick={() => setLiveSubTab("dashboard")}>
          <i className="fas fa-chart-simple"></i> Dashboard
        </button>
        <button className={`live-sub-tab${liveSubTab === "chat" ? " active" : ""}`} onClick={() => setLiveSubTab("chat")}>
          <i className="fas fa-comment"></i> Chat ({liveChatMsgs.length})
        </button>
        <button className={`live-sub-tab${liveSubTab === "prayers" ? " active" : ""}`} onClick={() => setLiveSubTab("prayers")}>
          <i className="fas fa-hands-praying"></i> Prayers ({livePrayers.length})
        </button>
        <button className={`live-sub-tab${liveSubTab === "giving" ? " active" : ""}`} onClick={() => setLiveSubTab("giving")}>
          <i className="fas fa-hand-holding-heart"></i> Giving
          {txStats.pending > 0 && <span className="live-sub-badge">{txStats.pending}</span>}
        </button>
      </div>

      {/* ─── DASHBOARD ─── */}
      {liveSubTab === "dashboard" && (
        <>
          <div className="live-stats-grid">
            <div className="live-stat-card" style={{ borderColor: "rgba(59,130,246,0.2)" }}>
              <div className="live-stat-value" style={{ color: "#3B82F6" }}>{viewerCount}</div>
              <div className="live-stat-label">Active Viewers</div>
              <div className="live-stat-sub">
                <i className="fas fa-circle" style={{ fontSize: 6, color: viewerCount > 0 ? "var(--success)" : "var(--text-tertiary)" }}></i>
                {viewerCount > 0 ? "Watching now" : "No active viewers"}
              </div>
            </div>
            <div className="live-stat-card" style={{ borderColor: "rgba(232,168,56,0.2)" }}>
              <div className="live-stat-value" style={{ color: "var(--primary)" }}>{liveChatMsgs.length}</div>
              <div className="live-stat-label">Chat Messages</div>
              <div className="live-stat-sub">{uniqueChatters} unique chatters</div>
            </div>
            <div className="live-stat-card" style={{ borderColor: "rgba(139,92,246,0.2)" }}>
              <div className="live-stat-value" style={{ color: "#8B5CF6" }}>{livePrayers.length}</div>
              <div className="live-stat-label">Prayer Requests</div>
              <div className="live-stat-sub">{livePrayers.filter((p) => !p.replyText).length} unreplied</div>
            </div>
          </div>

          {/* Compact chat preview */}
          <div className="section-title" style={{ marginTop: 4 }}>
            <i className="fas fa-comment"></i> Recent Chat
            <button className="section-title-btn" onClick={() => setLiveSubTab("chat")}>View All <i className="fas fa-chevron-right"></i></button>
          </div>
          <div className="live-feed-compact">
            {liveChatMsgs.length === 0 ? (
              <div className="live-empty"><i className="fas fa-comment-dots"></i><span>No messages yet</span></div>
            ) : (
              liveChatMsgs.slice(0, 10).map((m) => (
                <div key={m.id} className="live-chat-item">
                  <div className="live-chat-header">
                    <span className="live-chat-name">{m.userName}</span>
                    <span className="live-chat-time">{m.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                  <div className="live-chat-text">{m.message}</div>
                </div>
              ))
            )}
          </div>

          {/* Compact prayer preview */}
          <div className="section-title" style={{ marginTop: 16 }}>
            <i className="fas fa-hands-praying"></i> Recent Prayers
            <button className="section-title-btn" onClick={() => setLiveSubTab("prayers")}>View All <i className="fas fa-chevron-right"></i></button>
          </div>
          <div className="live-feed-compact">
            {livePrayers.length === 0 ? (
              <div className="live-empty"><i className="fas fa-pray"></i><span>No prayer requests yet</span></div>
            ) : (
              livePrayers.slice(0, 5).map((p) => (
                <div key={p.id} className="live-prayer-card">
                  <div className="live-chat-header">
                    <span className="live-chat-name"><i className="fas fa-user"></i> {p.name}</span>
                    <span className="live-chat-time">{p.createdAt.toLocaleDateString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                  <div className="live-chat-text">{p.request}</div>
                  {p.replyText && <div className="tv-prayer-reply"><div className="tv-prayer-reply-text" style={{ fontSize: 11 }}><i className="fas fa-reply"></i> {p.replyText}</div></div>}
                </div>
              ))
            )}
          </div>
        </>
      )}

      {/* ─── FULL CHAT FEED ─── */}
      {liveSubTab === "chat" && (
        <>
          <div className="section-title"><i className="fas fa-comment"></i> Live Chat Feed ({liveChatMsgs.length} messages)</div>
          <div className="live-feed-full">
            {liveChatMsgs.length === 0 ? (
              <div className="live-empty"><i className="fas fa-comment-dots"></i><span>No messages yet</span></div>
            ) : (
              [...liveChatMsgs].reverse().map((m) => (
                <div key={m.id} className="live-chat-item">
                  <div className="live-chat-header">
                    <span className="live-chat-name">{m.userName}</span>
                    <span className="live-chat-time">{m.timestamp.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                  <div className="live-chat-text">{m.message}</div>
                </div>
              ))
            )}
          </div>
        </>
      )}

      {/* ─── FULL PRAYERS FEED ─── */}
      {liveSubTab === "prayers" && (
        <>
          <div className="section-title">
            <i className="fas fa-hands-praying"></i> Prayer Requests ({livePrayers.length})
          </div>
          <div className="live-feed-full">
            {livePrayers.length === 0 ? (
              <div className="live-empty"><i className="fas fa-pray"></i><span>No prayer requests yet</span></div>
            ) : (
              livePrayers.map((p) => (
                <div key={p.id} className="live-prayer-card">
                  <div className="live-chat-header">
                    <span className="live-chat-name"><i className="fas fa-user"></i> {p.name}</span>
                    <span className="live-chat-time">
                      {p.createdAt.toLocaleDateString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  <div className="live-chat-text">{p.request}</div>

                  {p.replyText && (
                    <div className="tv-prayer-reply">
                      <div className="tv-prayer-reply-header">
                        <i className="fas fa-reply"></i>
                        <span className="tv-prayer-reply-name">{p.repliedBy || "Admin"}</span>
                        {p.repliedAt && <span className="tv-prayer-reply-time">{p.repliedAt.toLocaleDateString([], { month: "short", day: "numeric" })}</span>}
                      </div>
                      <div className="tv-prayer-reply-text">{p.replyText}</div>
                    </div>
                  )}

                  <div className="live-prayer-reply-form">
                    {replyingTo === p.id ? (
                      <>
                        <textarea
                          className="live-prayer-reply-input"
                          placeholder="Type your reply..."
                          value={replyTexts[p.id] || ""}
                          onChange={(e) => setReplyTexts((prev) => ({ ...prev, [p.id]: e.target.value }))}
                          rows={2} maxLength={500}
                        />
                        <div className="live-prayer-reply-actions">
                          <button className="live-prayer-reply-cancel" onClick={() => { setReplyingTo(null); setReplyTexts((prev) => { const n = { ...prev }; delete n[p.id]; return n; }); }}>Cancel</button>
                          <button className="live-prayer-reply-send" onClick={async () => {
                            const text = (replyTexts[p.id] || "").trim();
                            if (!text) return;
                            setReplyingSaving(p.id);
                            try {
                              const adminName = auth.currentUser?.displayName || "Admin";
                              await replyToPrayer(p.userId, p.id, text, adminName);
                              setReplyTexts((prev) => { const n = { ...prev }; delete n[p.id]; return n; });
                              setReplyingTo(null);
                              showToast("Reply Sent", "Your response has been sent to the member", "success", 2500);
                            } catch { showToast("Error", "Could not send reply", "error", 3000); }
                            setReplyingSaving(null);
                          }} disabled={replyingSaving === p.id || !(replyTexts[p.id] || "").trim()}>
                            {replyingSaving === p.id ? <><span className="spinner" style={{ width: 14, height: 14 }}></span> Sending...</> : <><i className="fas fa-reply"></i> Reply</>}
                          </button>
                        </div>
                      </>
                    ) : (
                      <button className="live-prayer-reply-btn" onClick={() => { setReplyingTo(p.id); setReplyTexts((prev) => ({ ...prev, [p.id]: "" })); }}>
                        <i className="fas fa-reply"></i> {p.replyText ? "Edit Reply" : "Reply"}
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}

      {/* ─── GIVING MANAGEMENT ─── */}
      {liveSubTab === "giving" && (
        <>
          <div className="giving-sub-tabs">
            <button className={`giving-sub-tab${givingSubTab === "methods" ? " active" : ""}`} onClick={() => setGivingSubTab("methods")}>
              <i className="fas fa-circle-dollar"></i> Methods
            </button>
            <button className={`giving-sub-tab${givingSubTab === "transactions" ? " active" : ""}`} onClick={() => setGivingSubTab("transactions")}>
              <i className="fas fa-receipt"></i> Transactions
              {txStats.pending > 0 && <span className="giving-sub-badge">{txStats.pending}</span>}
            </button>
            <button className={`giving-sub-tab${givingSubTab === "config" ? " active" : ""}`} onClick={() => setGivingSubTab("config")}>
              <i className="fas fa-gear"></i> Config
            </button>
          </div>

          {givingSubTab === "methods" && (
            <div className="live-giving-form">
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
                <button className="btn-primary small" onClick={() => { resetMethodForm(); setShowMethodForm(true); }}>
                  <i className="fas fa-plus"></i> Add Method
                </button>
              </div>
              {methodsLoading ? (
                <div className="loading-state"><i className="fas fa-spinner fa-spin"></i><span>Loading...</span></div>
              ) : methods.length === 0 ? (
                <div className="live-empty"><i className="fas fa-circle-dollar"></i><span>No payment methods yet</span></div>
              ) : (
                methods.map((m) => (
                  <div className="pm-card" key={m.id}>
                    <div className="pm-card-header">
                      <div className="pm-icon"><i className={`fas ${m.icon || "fa-circle-dollar"}`}></i></div>
                      <div className="pm-info">
                        <div className="pm-name">{m.name}</div>
                        <div className="pm-type">{m.type} · {m.enabled ? "Enabled" : "Disabled"}</div>
                      </div>
                    </div>
                    {Object.keys(m.details).length > 0 && (
                      <div className="pm-details">{Object.entries(m.details).map(([k, v]) => <div key={k}><strong>{k}:</strong> {v}</div>)}</div>
                    )}
                    {m.instructions && <div className="pm-instr">{m.instructions}</div>}
                    <div className="pm-actions">
                      <button className="pm-btn edit" onClick={() => openEditMethod(m)}><i className="fas fa-pen"></i> Edit</button>
                      <button className="pm-btn toggle" onClick={() => handleToggleMethod(m)}><i className={`fas ${m.enabled ? "fa-toggle-on" : "fa-toggle-off"}`}></i> {m.enabled ? "Disable" : "Enable"}</button>
                      <button className="pm-btn danger" onClick={() => m.id && handleDeleteMethod(m.id, m.name)}><i className="fas fa-trash"></i> Delete</button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {givingSubTab === "transactions" && (
            <div className="live-giving-form">
              <div className="tx-stats-row">
                <div className="tx-stat-box pending"><div className="tx-stat-val">{txStats.pending}</div><div className="tx-stat-lbl">Pending</div></div>
                <div className="tx-stat-box confirmed"><div className="tx-stat-val">{txStats.confirmed}</div><div className="tx-stat-lbl">Confirmed</div></div>
                <div className="tx-stat-box rejected"><div className="tx-stat-val">{txStats.rejected}</div><div className="tx-stat-lbl">Rejected</div></div>
              </div>
              {transLoading ? (
                <div className="loading-state"><i className="fas fa-spinner fa-spin"></i><span>Loading...</span></div>
              ) : transactions.length === 0 ? (
                <div className="live-empty"><i className="fas fa-receipt"></i><span>No transactions yet</span></div>
              ) : (
                transactions.map((tx) => (
                  <div className="tx-card" key={tx.id}>
                    <div className="tx-card-header">
                      <span className="tx-member">{tx.memberName}</span>
                      <span className={`tx-badge ${tx.status}`}>{tx.status}</span>
                    </div>
                    <div className="tx-amount">KSh {tx.amount.toLocaleString()}</div>
                    <div className="tx-meta"><strong>Method:</strong> {tx.paymentMethodLabel}</div>
                    <div className="tx-meta"><strong>Code:</strong> {tx.confirmationCode}</div>
                    <div className="tx-meta"><strong>Date:</strong> {tx.createdAt ? new Date((tx.createdAt as unknown as { toMillis?: () => number })?.toMillis ? ((tx.createdAt as unknown as { toMillis: () => number }).toMillis()) : (tx.createdAt as unknown as string)).toLocaleDateString("en-KE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}</div>
                    {tx.adminFeedback && <div className="tx-feedback"><i className="fas fa-reply"></i> {tx.adminFeedback}</div>}
                    {tx.status === "pending" && (
                      <div className="tx-actions">
                        <input className="tx-fb-input" placeholder="Feedback (optional)" value={feedbackInputs[tx.id!] ?? ""} onChange={(e) => setFeedbackInputs((p) => ({ ...p, [tx.id!]: e.target.value }))} />
                        <button className="tx-btn confirm" onClick={() => tx.id && handleConfirmTx(tx.id, tx.memberName)}><i className="fas fa-check"></i> Confirm</button>
                        <button className="tx-btn reject" onClick={() => tx.id && handleRejectTx(tx.id, tx.memberName)}><i className="fas fa-times"></i> Reject</button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {givingSubTab === "config" && (
            <div className="live-giving-form">
              <div className="form-group">
                <label className="form-label"><i className="fas fa-church"></i> Church Name</label>
                <input className="form-input" type="text" value={gcChurchName} onChange={(e) => setGcChurchName(e.target.value)} placeholder="e.g. MOUNTAIN OF DELIVERANCE CHURCH" />
              </div>
              <div className="form-group">
                <label className="form-label"><i className="fas fa-align-left"></i> Description</label>
                <textarea className="form-input" style={{ resize: "vertical", minHeight: 60, fontFamily: "inherit" }} value={gcDescription} onChange={(e) => setGcDescription(e.target.value)} placeholder="Encourage giving..." rows={2} />
              </div>
              <div className="form-group">
                <label className="form-label"><i className="fas fa-coins"></i> Giving Amounts</label>
                <input className="form-input" type="text" value={gcAmounts} onChange={(e) => setGcAmounts(e.target.value)} placeholder="$10, $25, $50, $100, Other" />
                <span className="form-hint"><i className="fas fa-info-circle"></i> Comma-separated list of amount buttons</span>
              </div>
              <div className="form-group">
                <label className="form-label"><i className="fas fa-credit-card"></i> Payment Methods (TV overlay)</label>
                <textarea className="form-input" style={{ resize: "vertical", minHeight: 80, fontFamily: "monospace", fontSize: 12 }} value={gcMethods} onChange={(e) => setGcMethods(e.target.value)} placeholder={`fa-qrcode|Scan to Give|/give\nfa-mobile-screen|Mobile Pay|/give\nfa-bank|Bank Transfer|/give`} rows={4} />
                <span className="form-hint"><i className="fas fa-info-circle"></i> One per line: <strong>icon|label|link</strong></span>
              </div>
              <button className="btn-primary" onClick={handleSaveGivingConfig} disabled={gcSaving}>
                {gcSaving ? <><span className="spinner"></span> Saving...</> : <><i className="fas fa-save"></i> Save Giving Config</>}
              </button>
            </div>
          )}

          {/* Method form modal */}
          {showMethodForm && (
            <div className="modal-overlay" onClick={() => setShowMethodForm(false)}>
              <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
                <div className="modal-handle"></div>
                <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>{editingMethod ? "Edit Payment Method" : "Add Payment Method"}</div>
                <div className="form-group"><label className="form-label">Method Name</label><input className="form-input" placeholder="e.g. M-Pesa Paybill" value={methodName} onChange={(e) => setMethodName(e.target.value)} /></div>
                <div className="form-group">
                  <label className="form-label">Type</label>
                  <select className="form-input" value={methodType} onChange={(e) => setMethodType(e.target.value as PaymentMethod["type"])}>
                    <option value="mpesa">M-Pesa</option><option value="bank">Bank Transfer</option>
                    <option value="paypal">PayPal</option><option value="card">Card</option><option value="other">Other</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Details (Key: Value, one per line)</label>
                  <textarea className="form-input" style={{ resize: "vertical", minHeight: 60, fontFamily: "inherit" }} placeholder={`Paybill: 123456\nAccount: Church Name`} value={methodDetails} onChange={(e) => setMethodDetails(e.target.value)} rows={3} />
                </div>
                <div className="form-group"><label className="form-label">Icon class</label><input className="form-input" placeholder="fa-mobile-screen" value={methodIcon} onChange={(e) => setMethodIcon(e.target.value)} /></div>
                <div className="form-group">
                  <label className="form-label">Instructions</label>
                  <textarea className="form-input" style={{ resize: "vertical", minHeight: 60, fontFamily: "inherit" }} placeholder="1. Go to M-Pesa\n2. Select Lipa na M-Pesa\n3. Enter Paybill..." value={methodInstructions} onChange={(e) => setMethodInstructions(e.target.value)} rows={3} />
                </div>
                <div className="form-group">
                  <label className="form-check" style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                    <input type="checkbox" checked={methodEnabled} onChange={(e) => setMethodEnabled(e.target.checked)} style={{ width: 20, height: 20, accentColor: "var(--primary)" }} />
                    <span style={{ fontSize: 13, fontWeight: 600 }}>Enabled</span>
                  </label>
                </div>
                <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                  <button className="btn-outline small" style={{ flex: 1 }} onClick={() => { setShowMethodForm(false); resetMethodForm(); }}>Cancel</button>
                  <button className="btn-primary small" style={{ flex: 1 }} disabled={methodSaving} onClick={handleSaveMethod}>
                    {methodSaving ? <><span className="spinner" style={{ width: 16, height: 16 }}></span> Saving...</> : editingMethod ? "Update" : "Add Method"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );

  // ─── Render current tab ───
  const renderAdminTabContent = () => {
    switch (activeAdminTab) {
      case "channel": return renderChannelTab();
      case "schedule": return renderScheduleTab();
      case "live": return renderLiveTab();
      default: return null;
    }
  };

  return (
    <>
      <style>{`
        :root {
          --primary: #E8A838; --primary-light: #F5C76B; --bg: #0F0F0F;
          --surface: #1A1A1A; --surface-elevated: #242424;
          --surface-card: #1E1E1E; --surface-hover: #2A2A2A;
          --text-primary: #FFFFFF; --text-secondary: #A0A0A0; --text-tertiary: #6B6B6B;
          --border: #2A2A2A; --error: #EF4444; --success: #22C55E;
          --gradient-start: #E8A838; --gradient-end: #D4762A;
          --radius-sm: 12px; --radius-md: 16px; --radius-lg: 20px; --radius-xl: 24px;
          --radius-full: 50%;
        }
        * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; }
        html, body { height: 100%; overflow: hidden; background: var(--bg); color: var(--text-primary); }
        .app-container { height: 100%; display: flex; flex-direction: column; position: relative; overflow: hidden; }
        @media (min-width: 480px) { .app-container { max-width: 480px; margin: 0 auto; } }

        .header {
          padding: 12px 16px; display: flex; align-items: center; gap: 12px;
          flex-shrink: 0; background: var(--bg); border-bottom: 1px solid var(--border);
        }
        .header-icon {
          width: 38px; height: 38px; border-radius: var(--radius-sm);
          background: linear-gradient(135deg, #FF0000, #CC0000);
          display: flex; align-items: center; justify-content: center; flex-shrink: 0;
        }
        .header-icon i { font-size: 16px; color: #fff; }
        .header-info { flex: 1; min-width: 0; }
        .header-title { font-size: 16px; font-weight: 700; }
        .header-sub { font-size: 11px; color: var(--text-tertiary); margin-top: 1px; }

        .content-scroll { flex: 1; overflow-y: auto; overflow-x: hidden; -webkit-overflow-scrolling: touch; padding-bottom: 80px; }
        .content-scroll::-webkit-scrollbar { display: none; }

        .section { padding: 12px; display: flex; flex-direction: column; gap: 12px; }


        .channel-card {
          background: var(--surface-card); border: 1px solid var(--border);
          border-radius: var(--radius-lg); padding: 20px;
          display: flex; align-items: center; gap: 16px;
        }
        .channel-avatar {
          width: 56px; height: 56px; border-radius: 50%;
          overflow: hidden; flex-shrink: 0;
          background: var(--surface-elevated);
          border: 2px solid rgba(232,168,56,0.15);
        }
        .channel-avatar img { width: 100%; height: 100%; object-fit: cover; }
        .channel-avatar-fallback {
          width: 56px; height: 56px; border-radius: 50%;
          background: linear-gradient(135deg, rgba(255,0,0,0.1), rgba(255,0,0,0.04));
          display: flex; align-items: center; justify-content: center;
          font-size: 22px; color: var(--text-tertiary);
        }
        .channel-info { flex: 1; min-width: 0; }
        .channel-name { font-size: 16px; font-weight: 700; }
        .channel-meta { font-size: 12px; color: var(--text-secondary); margin-top: 3px; display: flex; align-items: center; gap: 12px; }
        .channel-meta span { display: flex; align-items: center; gap: 4px; }
        .channel-meta i { font-size: 10px; color: var(--text-tertiary); }
        .channel-sync-time { font-size: 11px; color: var(--text-tertiary); margin-top: 4px; }

        .no-channel {
          background: var(--surface-card); border: 1px dashed var(--border);
          border-radius: var(--radius-lg); padding: 32px 20px;
          text-align: center;
        }
        .no-channel i { font-size: 40px; color: var(--text-tertiary); opacity: 0.3; margin-bottom: 12px; }
        .no-channel h3 { font-size: 17px; font-weight: 700; margin-bottom: 6px; }
        .no-channel p { font-size: 13px; color: var(--text-secondary); }

        .form-group { display: flex; flex-direction: column; gap: 8px; }
        .form-label { font-size: 13px; font-weight: 600; color: var(--text-secondary); display: flex; align-items: center; gap: 6px; }
        .form-label i { font-size: 12px; color: var(--primary); }
        .form-input {
          width: 100%; padding: 14px 16px;
          background: var(--surface); border: 1.5px solid var(--border);
          border-radius: var(--radius-md); color: var(--text-primary);
          font-size: 14px; font-weight: 500; outline: none;
          transition: all 0.2s;
        }
        .form-input:focus { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(232,168,56,0.08); }
        .form-input::placeholder { color: var(--text-tertiary); font-weight: 400; }
        .form-hint { font-size: 11px; color: var(--text-tertiary); display: flex; align-items: center; gap: 4px; }
        .form-hint i { font-size: 10px; }

        .btn-primary {
          width: 100%; padding: 16px;
          border-radius: var(--radius-md); font-size: 15px; font-weight: 700;
          border: none; cursor: pointer; transition: all 0.2s ease;
          background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end));
          color: #fff; display: flex; align-items: center; justify-content: center; gap: 8px;
        }
        .btn-primary:active { transform: scale(0.97); }
        .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
        .btn-primary.small { padding: 10px; font-size: 13px; }

        .btn-outline {
          width: 100%; padding: 14px;
          border-radius: var(--radius-md); font-size: 14px; font-weight: 600;
          border: 1.5px solid var(--border); cursor: pointer; transition: all 0.2s ease;
          background: var(--surface); color: var(--text-secondary);
          display: flex; align-items: center; justify-content: center; gap: 8px;
        }
        .btn-outline:active { background: var(--surface-elevated); transform: scale(0.97); }
        .btn-outline.small { padding: 8px 12px; font-size: 12px; width: auto; }

        .stats-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
        .stat-card {
          background: var(--surface-card); border: 1px solid var(--border);
          border-radius: var(--radius-md); padding: 16px;
          text-align: center;
        }
        .stat-value { font-size: 28px; font-weight: 800; }
        .stat-label { font-size: 11px; color: var(--text-tertiary); margin-top: 4px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; }

        .preview-card {
          background: var(--surface-card); border: 1px solid var(--border);
          border-radius: var(--radius-lg); overflow: hidden;
          display: flex; gap: 12px; padding: 12px;
          transition: all 0.2s;
        }
        .preview-card:active { background: var(--surface-elevated); }
        .preview-thumb {
          width: 80px; height: 48px; border-radius: 6px;
          overflow: hidden; flex-shrink: 0;
          background: var(--surface-elevated);
        }
        .preview-thumb img { width: 100%; height: 100%; object-fit: cover; }
        .preview-info { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; }
        .preview-title { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .preview-meta { font-size: 11px; color: var(--text-tertiary); margin-top: 2px; }
        .previews { display: flex; flex-direction: column; gap: 8px; }

        .section-title { font-size: 14px; font-weight: 700; display: flex; align-items: center; gap: 6px; }
        .section-title i { color: var(--primary); font-size: 13px; }

        .loading-state { padding: 40px; text-align: center; color: var(--text-tertiary); display: flex; flex-direction: column; align-items: center; gap: 12px; }
        .loading-state i { font-size: 32px; opacity: 0.3; }
        .spinner { width: 24px; height: 24px; border: 3px solid rgba(255,255,255,0.05); border-top-color: var(--primary); border-radius: 50%; animation: spin 0.8s linear infinite; display: inline-block; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes tvGridShimmer {
          0% { background-position: -200px 0; }
          100% { background-position: 200px 0; }
        }

        /* ─── Synced Videos Grid (premium card grid) ─── */
        .tv-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }
        .tv-grid-card {
          background: var(--surface-card);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          overflow: hidden;
          transition: all 0.2s ease;
        }
        .tv-grid-card:active { transform: scale(0.97); background: var(--surface-elevated); }
        .tv-grid-card-thumb {
          position: relative;
          aspect-ratio: 16 / 9;
          background: var(--surface-elevated);
          overflow: hidden;
        }
        .tv-grid-card-thumb img {
          width: 100%; height: 100%; object-fit: cover;
        }
        .tv-grid-card-duration {
          position: absolute; bottom: 6px; right: 6px;
          padding: 2px 6px; border-radius: 4px;
          background: rgba(0,0,0,0.8); color: #fff;
          font-size: 10px; font-weight: 700;
          letter-spacing: 0.3px;
        }
        .tv-grid-card-badge {
          position: absolute; top: 6px; left: 6px;
          width: 24px; height: 24px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-size: 10px; backdrop-filter: blur(4px);
        }
        .tv-grid-card-badge.featured {
          background: rgba(232,168,56,0.85); color: #fff;
        }
        .tv-grid-card-badge.hidden {
          background: rgba(107,107,107,0.85); color: #fff;
        }
        .tv-grid-card-info {
          padding: 8px 10px 10px;
        }
        .tv-grid-card-title {
          font-size: 12px; font-weight: 600;
          display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
          overflow: hidden; line-height: 1.4;
        }
        .tv-grid-card-meta {
          font-size: 10px; color: var(--text-tertiary);
          margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }

        /* ─── Skeleton shimmer for video grid ─── */
        .tv-grid-skeleton {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }
        .tv-grid-skeleton-card {
          background: var(--surface-card);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          overflow: hidden;
        }
        .tv-grid-skeleton-thumb {
          aspect-ratio: 16 / 9;
          background: linear-gradient(90deg, var(--surface-elevated) 25%, var(--surface-hover) 50%, var(--surface-elevated) 75%);
          background-size: 400px 100%;
          animation: tvGridShimmer 1.4s ease-in-out infinite;
        }
        .tv-grid-skeleton-title {
          height: 12px; margin: 10px 10px 6px; border-radius: 6px;
          background: linear-gradient(90deg, var(--surface-elevated) 25%, var(--surface-hover) 50%, var(--surface-elevated) 75%);
          background-size: 400px 100%;
          animation: tvGridShimmer 1.4s ease-in-out infinite;
        }
        .tv-grid-skeleton-meta {
          height: 10px; width: 60%; margin: 0 10px 12px; border-radius: 6px;
          background: linear-gradient(90deg, var(--surface-elevated) 25%, var(--surface-hover) 50%, var(--surface-elevated) 75%);
          background-size: 400px 100%;
          animation: tvGridShimmer 1.4s ease-in-out infinite;
        }

        .tv-grid-empty {
          padding: 24px; text-align: center; color: var(--text-tertiary);
          display: flex; flex-direction: column; align-items: center; gap: 8px;
          background: var(--surface-card); border: 1px dashed var(--border);
          border-radius: var(--radius-lg);
        }
        .tv-grid-empty i { font-size: 28px; opacity: 0.3; }

        .tv-grid-load-more {
          width: 100%; margin-top: 12px; padding: 14px;
          border-radius: var(--radius-md); font-size: 14px; font-weight: 600;
          border: 1.5px solid var(--border); cursor: pointer; transition: all 0.2s ease;
          background: var(--surface); color: var(--text-secondary);
          display: flex; align-items: center; justify-content: center; gap: 8px;
        }
        .tv-grid-load-more:active { background: var(--surface-elevated); transform: scale(0.97); }
        .tv-grid-load-more:disabled { opacity: 0.5; cursor: not-allowed; }

        /* ─── Premium TV Loading Screen ─── */
        .tv-loading-screen {
          position: fixed; inset: 0; z-index: 99999;
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          background: #000;
        }
        .tv-loading-ring {
          width: 72px; height: 72px; border-radius: 50%;
          border: 3px solid rgba(232,168,56,0.08);
          border-top-color: #E8A838; border-right-color: #D4762A;
          animation: tvLoadingSpin 0.9s cubic-bezier(0.4, 0, 0.2, 1) infinite;
          display: flex; align-items: center; justify-content: center;
          position: relative;
        }
        .tv-loading-ring-inner {
          width: 48px; height: 48px; border-radius: 50%;
          border: 2px solid rgba(232,168,56,0.06);
          border-bottom-color: #E8A838; border-left-color: #D4762A;
          animation: tvLoadingSpin 1.4s cubic-bezier(0.4, 0, 0.2, 1) infinite reverse;
        }
        .tv-loading-icon {
          position: absolute; font-size: 20px; color: #E8A838;
          animation: tvLoadingPulse 1.6s ease-in-out infinite;
        }
        .tv-loading-brand {
          margin-top: 24px; font-size: 15px; font-weight: 800;
          letter-spacing: -0.3px; color: #E8A838;
          animation: tvLoadingFade 1.6s ease-in-out infinite;
        }
        .tv-loading-dots {
          margin-top: 10px; display: flex; gap: 6px;
        }
        .tv-loading-dot {
          width: 6px; height: 6px; border-radius: 50%;
          background: #E8A838;
          animation: tvLoadingBounce 1.2s ease-in-out infinite;
        }
        .tv-loading-dot:nth-child(2) { animation-delay: 0.2s; }
        .tv-loading-dot:nth-child(3) { animation-delay: 0.4s; }
        @keyframes tvLoadingSpin { to { transform: rotate(360deg); } }
        @keyframes tvLoadingPulse {
          0%, 100% { opacity: 0.4; transform: scale(0.9); }
          50% { opacity: 1; transform: scale(1.1); }
        }
        @keyframes tvLoadingFade {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
        @keyframes tvLoadingBounce {
          0%, 100% { transform: translateY(0); opacity: 0.3; }
          50% { transform: translateY(-6px); opacity: 1; }
        }

        /* ─── Skeleton shimmer for browse section ─── */
        @keyframes adminShimmer {
          0% { background-position: -200px 0; }
          100% { background-position: 200px 0; }
        }
        .pl-skeleton-list { display: flex; flex-direction: column; gap: 6px; }
        .pl-skeleton-item {
          display: flex; align-items: center; gap: 10px;
          padding: 8px 10px;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          height: 46px;
        }
        .pl-skeleton-thumb {
          width: 50px; height: 30px; border-radius: 4px; flex-shrink: 0;
          background: linear-gradient(90deg, var(--surface-elevated) 25%, var(--surface-hover) 50%, var(--surface-elevated) 75%);
          background-size: 400px 100%;
          animation: adminShimmer 1.4s ease-in-out infinite;
        }
        .pl-skeleton-line {
          flex: 1; height: 12px; border-radius: 6px;
          background: linear-gradient(90deg, var(--surface-elevated) 25%, var(--surface-hover) 50%, var(--surface-elevated) 75%);
          background-size: 400px 100%;
          animation: adminShimmer 1.4s ease-in-out infinite;
        }

        /* ─── Playlist Builder ─── */
        .pl-builder {
          background: var(--surface-card); border: 1px solid var(--border);
          border-radius: var(--radius-lg); padding: 16px;
          display: flex; flex-direction: column; gap: 12px;
        }
        .pl-selected-header {
          display: flex; align-items: center; justify-content: space-between;
          font-size: 13px; font-weight: 600; color: var(--text-secondary);
          padding-bottom: 8px; border-bottom: 1px solid var(--border);
        }
        .pl-selected-list {
          display: flex; flex-direction: column; gap: 6px;
          max-height: 200px; overflow-y: auto;
        }
        .pl-selected-item {
          display: flex; align-items: center; gap: 8px;
          padding: 6px 8px; border-radius: var(--radius-sm);
          background: var(--surface); border: 1px solid var(--border);
        }
        .pl-selected-thumb {
          width: 40px; height: 26px; border-radius: 4px; overflow: hidden; flex-shrink: 0;
          background: var(--surface-elevated);
        }
        .pl-selected-thumb img { width: 100%; height: 100%; object-fit: cover; }
        .pl-selected-title { flex: 1; min-width: 0; font-size: 12px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .pl-selected-pos {
          display: flex; gap: 2px;
        }
        .pl-selected-pos button {
          width: 24px; height: 24px; border-radius: 6px;
          background: var(--surface-elevated); border: 1px solid var(--border);
          color: var(--text-tertiary); font-size: 10px;
          cursor: pointer; display: flex; align-items: center; justify-content: center;
        }
        .pl-selected-pos button:active { background: var(--surface-hover); }
        .pl-selected-remove {
          width: 24px; height: 24px; border-radius: 6px;
          background: transparent; border: none;
          color: var(--error); font-size: 12px;
          cursor: pointer; display: flex; align-items: center; justify-content: center;
        }
        .pl-browse-search {
          position: relative;
        }
        .pl-browse-search i {
          position: absolute; left: 14px; top: 50%; transform: translateY(-50%);
          color: var(--text-tertiary); font-size: 13px;
        }
        .pl-browse-search input {
          padding-left: 36px;
        }
        .pl-browse-grid {
          display: flex; flex-direction: column; gap: 6px;
          max-height: 240px; overflow-y: auto;
        }
        .pl-browse-item {
          display: flex; align-items: center; gap: 10px;
          padding: 8px 10px; border-radius: var(--radius-sm);
          background: var(--surface); border: 1px solid var(--border);
          cursor: pointer; transition: all 0.15s;
        }
        .pl-browse-item:active { background: var(--surface-elevated); }
        .pl-browse-item.added { border-color: var(--success); opacity: 0.6; }
        .pl-browse-thumb {
          width: 50px; height: 30px; border-radius: 4px; overflow: hidden; flex-shrink: 0;
          background: var(--surface-elevated);
        }
        .pl-browse-thumb img { width: 100%; height: 100%; object-fit: cover; }
        .pl-browse-info { flex: 1; min-width: 0; }
        .pl-browse-title { font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .pl-browse-meta { font-size: 10px; color: var(--text-tertiary); margin-top: 1px; }
        .pl-browse-add {
          width: 28px; height: 28px; border-radius: 8px;
          background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end));
          border: none; color: #fff; font-size: 11px;
          cursor: pointer; display: flex; align-items: center; justify-content: center;
          flex-shrink: 0;
        }
        .pl-browse-add:active { transform: scale(0.9); }
        .pl-browse-add.added { background: var(--surface-elevated); color: var(--success); }

        /* ─── Bottom Nav (mobile) ─── */
        .bottom-nav { position: fixed; bottom: 0; left: 0; right: 0; background: rgba(15,15,15,0.92); backdrop-filter: blur(20px) saturate(180%); -webkit-backdrop-filter: blur(20px) saturate(180%); border-top: 1px solid var(--border); padding: 8px 0 calc(8px + env(safe-area-inset-bottom, 0px)); z-index: 1000; display: flex; justify-content: space-around; align-items: center; }
        @media (min-width: 480px) { .bottom-nav { max-width: 480px; margin: 0 auto; } }
        .nav-item { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 6px 12px; background: none; border: none; color: var(--text-tertiary); cursor: pointer; transition: all 0.2s ease; position: relative; }
        .nav-item.active { color: var(--primary); }
        .nav-item i { font-size: 20px; transition: transform 0.2s ease; }
        .nav-item:active i { transform: scale(0.85); }
        .nav-item span { font-size: 10px; font-weight: 600; }
        .nav-item .nav-badge { position: absolute; top: 2px; right: 6px; width: 8px; height: 8px; background: var(--error); border-radius: var(--radius-full); border: 2px solid var(--bg); }

        /* ─── TOP HEADER BAR (matches member TV page) ─── */
        .tv-top-header {
          display: flex; align-items: center; padding: 8px 12px; gap: 8px;
          background: var(--bg-card); border-bottom: 1px solid var(--border);
          flex-shrink: 0; z-index: 25;
        }
        .tv-top-header-title {
          flex: 1; font-size: 15px; font-weight: 700; text-align: center;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .tv-top-header-actions { display: flex; gap: 4px; }
        .tv-top-header-btn {
          width: 34px; height: 34px; border-radius: 50%;
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.06);
          color: var(--text-secondary); font-size: 14px;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; flex-shrink: 0; transition: all 0.2s ease;
        }
        .tv-top-header-btn:active { background: rgba(255,255,255,0.12); transform: scale(0.9); }

        .feed-section { padding: 0 var(--section-px, 16px) 16px; }
        .feed-section { --section-px: 12px; }

        .tv-top-wrap {
          margin: 0 calc(-1 * var(--section-px, 16px));
        }
        .tv-top {
          display: flex; align-items: center; justify-content: space-between;
          padding: 8px 14px 0;
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
          font-size: 15px;
          font-weight: 700;
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
        }
        .tv-channel-avatar img { width: 100%; height: 100%; object-fit: cover; }
        .tv-channel-avatar i { font-size: 16px; color: #FF0000; }
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

        /* ─── ADMIN TV TAB BAR (matches member TV page) ─── */
        .admin-tv-tab-bar {
          display: flex; flex-shrink: 0;
          background: var(--surface);
          border-bottom: 1px solid var(--border);
          overflow-x: auto; -webkit-overflow-scrolling: touch;
        }
        .admin-tv-tab-bar::-webkit-scrollbar { display: none; }
        .admin-tv-tab-btn {
          flex: 1;
          display: flex; align-items: center; justify-content: center; gap: 6px;
          padding: 12px 6px;
          background: none; border: none;
          color: var(--text-tertiary);
          font-size: 12px; font-weight: 600;
          cursor: pointer; position: relative; white-space: nowrap;
          transition: all 0.2s ease;
        }
        .admin-tv-tab-btn i { font-size: 14px; }
        .admin-tv-tab-btn.active { color: var(--primary); }
        .admin-tv-tab-btn.active::after {
          content: ''; position: absolute; bottom: 0; left: 20%; right: 20%;
          height: 2px; background: var(--primary);
          border-radius: 1px 1px 0 0;
        }

        /* ─── LIVE SUB-TABS ─── */
        .live-sub-tabs {
          display: flex; gap: 6px; margin-bottom: 12px;
          flex-shrink: 0; overflow-x: auto;
          -webkit-overflow-scrolling: touch;
        }
        .live-sub-tabs::-webkit-scrollbar { display: none; }
        .live-sub-tab {
          padding: 8px 14px; border-radius: 10px; font-size: 12px; font-weight: 700;
          background: var(--surface); border: 1px solid var(--border); color: var(--text-secondary);
          cursor: pointer; transition: all 0.15s ease; position: relative;
          display: flex; align-items: center; gap: 6px;
          white-space: nowrap; flex-shrink: 0;
        }
        .live-sub-tab.active { background: rgba(232,168,56,0.12); border-color: var(--primary); color: var(--primary); }
        .live-sub-tab:active { transform: scale(0.95); }
        .live-sub-badge {
          position: absolute; top: -5px; right: -5px; width: 18px; height: 18px; border-radius: 50%;
          background: var(--error); color: #fff; font-size: 10px; font-weight: 700;
          display: flex; align-items: center; justify-content: center;
        }
        .section-title-btn {
          margin-left: auto; font-size: 11px; font-weight: 600; color: var(--primary);
          background: none; border: none; cursor: pointer;
          display: flex; align-items: center; gap: 4px;
        }
        .section-title-btn:active { opacity: 0.7; }

        .live-feed-compact {
          display: flex; flex-direction: column; gap: 6px;
          max-height: 260px; overflow-y: auto;
          background: var(--surface-card);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 8px;
        }
        .live-feed-compact::-webkit-scrollbar { display: none; }

        .live-feed-full {
          display: flex; flex-direction: column; gap: 6px;
          background: var(--surface-card);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 8px;
        }

        /* ─── LIVE DASHBOARD ─── */
        .live-stats-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10px;
          margin-bottom: 8px;
        }
        .live-stat-card {
          background: var(--surface-card);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          padding: 14px 10px;
          text-align: center;
        }
        .live-stat-value { font-size: 24px; font-weight: 800; }
        .live-stat-label { font-size: 10px; color: var(--text-tertiary); margin-top: 2px; text-transform: uppercase; letter-spacing: 0.3px; font-weight: 600; }
        .live-stat-sub { font-size: 10px; color: var(--text-tertiary); margin-top: 4px; display: flex; align-items: center; justify-content: center; gap: 4px; }

        .live-chat-feed {
          display: flex; flex-direction: column; gap: 6px;
          max-height: 300px; overflow-y: auto;
          background: var(--surface-card);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 8px;
        }
        .live-chat-feed::-webkit-scrollbar { display: none; }
        .live-chat-item {
          padding: 8px 10px;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
        }
        .live-chat-header {
          display: flex; align-items: center; gap: 8px; margin-bottom: 3px;
        }
        .live-chat-name { font-size: 11px; font-weight: 700; color: var(--primary); }
        .live-chat-time { font-size: 9px; color: var(--text-tertiary); margin-left: auto; }
        .live-chat-text { font-size: 12px; line-height: 1.5; word-break: break-word; color: var(--text-secondary); }

        .live-empty {
          padding: 24px; text-align: center; color: var(--text-tertiary);
          display: flex; flex-direction: column; align-items: center; gap: 8px;
        }
        .live-empty i { font-size: 28px; opacity: 0.3; }

        /* ─── Prayer cards with reply ─── */
        .live-prayer-card {
          padding: 10px 12px;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          display: flex; flex-direction: column; gap: 4px;
        }
        .live-prayer-card .live-chat-header { margin-bottom: 2px; }
        .live-prayer-card .live-chat-text { margin-bottom: 4px; }

        .tv-prayer-reply {
          margin-top: 8px;
          padding: 10px 12px;
          background: rgba(139,92,246,0.08);
          border: 1px solid rgba(139,92,246,0.12);
          border-radius: var(--radius-sm);
          margin-left: 12px;
        }
        .tv-prayer-reply-header {
          display: flex; align-items: center; gap: 6px; margin-bottom: 4px;
        }
        .tv-prayer-reply-header i { font-size: 10px; color: #8B5CF6; }
        .tv-prayer-reply-name { font-size: 11px; font-weight: 700; color: #8B5CF6; }
        .tv-prayer-reply-time { font-size: 9px; color: var(--text-tertiary); margin-left: auto; }
        .tv-prayer-reply-text { font-size: 12px; color: var(--text-secondary); line-height: 1.5; }

        .live-prayer-reply-form { margin-top: 6px; }
        .live-prayer-reply-btn {
          display: flex; align-items: center; gap: 4px;
          padding: 5px 10px; border-radius: 6px;
          background: var(--surface-elevated); border: 1px solid var(--border);
          color: var(--text-tertiary); font-size: 11px; font-weight: 600;
          cursor: pointer; transition: all 0.15s; font-family: inherit;
        }
        .live-prayer-reply-btn:active { background: var(--surface-hover); }
        .live-prayer-reply-btn i { font-size: 10px; }
        .live-prayer-reply-input {
          width: 100%; padding: 8px 10px;
          background: var(--surface-elevated); border: 1.5px solid var(--border);
          border-radius: var(--radius-sm); color: var(--text-primary);
          font-size: 12px; outline: none; font-family: inherit; resize: vertical;
          transition: all 0.2s; margin-bottom: 6px;
        }
        .live-prayer-reply-input:focus { border-color: #8B5CF6; box-shadow: 0 0 0 2px rgba(139,92,246,0.1); }
        .live-prayer-reply-actions {
          display: flex; gap: 8px; justify-content: flex-end;
        }
        .live-prayer-reply-cancel {
          padding: 6px 12px; border-radius: 6px;
          background: var(--surface); border: 1px solid var(--border);
          color: var(--text-tertiary); font-size: 11px; font-weight: 600;
          cursor: pointer; font-family: inherit;
        }
        .live-prayer-reply-cancel:active { background: var(--surface-elevated); }
        .live-prayer-reply-send {
          padding: 6px 14px; border-radius: 6px;
          background: linear-gradient(135deg, #8B5CF6, #7C3AED);
          border: none; color: #fff; font-size: 11px; font-weight: 700;
          cursor: pointer; display: flex; align-items: center; gap: 4px; font-family: inherit;
          transition: all 0.15s;
        }
        .live-prayer-reply-send:active { transform: scale(0.97); }
        .live-prayer-reply-send:disabled { opacity: 0.5; cursor: not-allowed; }

        .live-giving-form {
          display: flex; flex-direction: column; gap: 12px;
          background: var(--surface-card);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 16px;
        }

        /* ─── Giving Sub-Tabs ─── */
        .giving-sub-tabs { display: flex; gap: 6px; margin-bottom: 10px; }
        .giving-sub-tab {
          padding: 6px 14px; border-radius: 10px; font-size: 12px; font-weight: 700;
          background: var(--surface); border: 1px solid var(--border); color: var(--text-secondary);
          cursor: pointer; transition: all 0.15s ease; position: relative;
          display: flex; align-items: center; gap: 6px;
        }
        .giving-sub-tab.active { background: rgba(232,168,56,0.12); border-color: var(--primary); color: var(--primary); }
        .giving-sub-tab:active { transform: scale(0.95); }
        .giving-sub-badge {
          position: absolute; top: -5px; right: -5px; width: 18px; height: 18px; border-radius: 50%;
          background: var(--error); color: #fff; font-size: 10px; font-weight: 700;
          display: flex; align-items: center; justify-content: center;
        }

        /* ─── Payment Method Cards ─── */
        .pm-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 12px; margin-bottom: 8px; }
        .pm-card-header { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
        .pm-icon { width: 36px; height: 36px; border-radius: 10px; background: rgba(232,168,56,0.12); color: var(--primary); display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0; }
        .pm-info { flex: 1; min-width: 0; }
        .pm-name { font-size: 14px; font-weight: 700; }
        .pm-type { font-size: 11px; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.2px; }
        .pm-details { font-size: 12px; color: var(--text-secondary); margin: 4px 0; }
        .pm-details strong { color: var(--text-primary); }
        .pm-instr { font-size: 12px; color: var(--text-tertiary); font-style: italic; margin: 4px 0; }
        .pm-actions { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
        .pm-btn { padding: 5px 10px; border-radius: 6px; font-size: 11px; font-weight: 600; border: none; cursor: pointer; transition: all 0.15s ease; display: flex; align-items: center; gap: 4px; }
        .pm-btn:active { transform: scale(0.95); }
        .pm-btn.edit { background: var(--surface-elevated); color: var(--text-primary); border: 1px solid var(--border); }
        .pm-btn.toggle { background: rgba(232,168,56,0.1); color: var(--primary); }
        .pm-btn.danger { background: rgba(239,68,68,0.1); color: var(--error); }

        /* ─── Transaction Cards ─── */
        .tx-stats-row { display: flex; gap: 8px; margin-bottom: 12px; }
        .tx-stat-box { flex: 1; padding: 10px; border-radius: 10px; text-align: center; background: var(--surface); border: 1px solid var(--border); }
        .tx-stat-val { font-size: 20px; font-weight: 800; }
        .tx-stat-lbl { font-size: 10px; color: var(--text-tertiary); font-weight: 500; text-transform: uppercase; letter-spacing: 0.3px; margin-top: 2px; }
        .tx-stat-box.pending .tx-stat-val { color: var(--warning); }
        .tx-stat-box.confirmed .tx-stat-val { color: var(--success); }
        .tx-stat-box.rejected .tx-stat-val { color: var(--error); }

        .tx-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 12px; margin-bottom: 8px; }
        .tx-card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
        .tx-member { font-size: 14px; font-weight: 700; }
        .tx-badge { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px; padding: 2px 8px; border-radius: 6px; }
        .tx-badge.pending { background: rgba(245,158,11,0.12); color: var(--warning); }
        .tx-badge.confirmed { background: rgba(34,197,94,0.12); color: var(--success); }
        .tx-badge.rejected { background: rgba(239,68,68,0.12); color: var(--error); }
        .tx-amount { font-size: 20px; font-weight: 800; color: var(--primary); margin: 4px 0; }
        .tx-meta { font-size: 12px; color: var(--text-secondary); line-height: 1.6; }
        .tx-meta strong { color: var(--text-primary); }
        .tx-feedback { font-size: 12px; color: var(--text-tertiary); font-style: italic; margin-top: 6px; padding: 6px 10px; background: var(--surface-elevated); border-radius: 6px; }
        .tx-actions { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
        .tx-fb-input { flex: 1; min-width: 120px; padding: 7px 10px; border-radius: 6px; background: var(--surface-elevated); border: 1px solid var(--border); color: var(--text-primary); font-size: 12px; }
        .tx-btn { padding: 7px 14px; border-radius: 6px; font-size: 11px; font-weight: 700; border: none; cursor: pointer; transition: all 0.15s ease; display: flex; align-items: center; gap: 4px; }
        .tx-btn:active { transform: scale(0.95); }
        .tx-btn.confirm { background: var(--success); color: #fff; }
        .tx-btn.reject { background: rgba(239,68,68,0.1); color: var(--error); border: 1px solid rgba(239,68,68,0.2); }

        /* ─── Modal Overlay ─── */
        .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.85); z-index: 9000; display: flex; align-items: flex-end; justify-content: center; animation: fadeIn 0.2s ease; }
        @keyframes fadeIn { from { opacity:0; } to { opacity:1; } }
        .modal-sheet { width: 100%; max-width: 480px; max-height: 85vh; background: var(--surface); border-radius: 24px 24px 0 0; padding: 12px 20px 30px; overflow-y: auto; }
        .modal-handle { width: 40px; height: 4px; background: var(--text-tertiary); border-radius: 2px; margin: 0 auto 12px; opacity: 0.4; }

      `}</style>

      <ToastBridge />

      <div className="app-container">
        <PremiumTopBar />

        {/* ─── TOP HEADER BAR (matches member TV page) ─── */}
        <div className="tv-top-header">
          <button className="tv-top-header-btn" onClick={() => router.back()}>
            <i className="fas fa-chevron-left"></i>
          </button>
          <div className="tv-top-header-title">
            {channel?.title ? `${channel.title} TV` : "TV Settings"}
          </div>
          <div className="tv-top-header-actions">
            <button
              className="tv-top-header-btn"
              onClick={() => router.push("/tv")}
              title="Open TV in new tab"
            >
              <i className="fas fa-external-link-alt"></i>
            </button>
            <button
              className="tv-top-header-btn"
              onClick={() => router.push("/admin")}
              title="Dashboard"
            >
              <i className="fas fa-home"></i>
            </button>
          </div>
        </div>

        {/* TAB BAR */}
        <div className="admin-tv-tab-bar">
          {ADMIN_TABS.map((tab) => (
            <button
              key={tab.id}
              className={`admin-tv-tab-btn ${activeAdminTab === tab.id ? "active" : ""}`}
              onClick={() => setActiveAdminTab(tab.id)}
            >
              <i className={`fas ${tab.icon}`}></i>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* CONTENT */}
        <div className="content-scroll">
            {/* TV CARD — outside section wrapper for edge-to-edge */}
            {!loading && activeAdminTab === "channel" && channel && (
              <section className="feed-section">
                <div className="tv-top-wrap">
                  <div className="tv-top">
                    <div className="tv-station">
                      <i className="fas fa-tv"></i>
                      <span>Church TV</span>
                    </div>
                    <div className="tv-badges">
                      <div className={`tv-live-badge ${currentVideo ? "live" : "off"}`}>
                        <span className="tv-live-dot"></span>
                        {currentVideo ? "On Air" : "Off Air"}
                      </div>
                      <div className="tv-sub-badge">
                        <i className="fas fa-users"></i>
                        {channel?.subscriberCount || "—"}
                      </div>
                    </div>
                  </div>



                  <div className="tv-channel-strip">
                    <div className="tv-channel-avatar">
                      {channel.thumbnail ? (
                        <img src={channel.thumbnail.replace(/^http:/, 'https:')} alt={channel.title} referrerPolicy="no-referrer" crossOrigin="anonymous" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                      ) : (
                        <i className="fab fa-youtube"></i>
                      )}
                    </div>
                    <div className="tv-channel-info">
                      <div className="tv-channel-name">{channel.title}</div>
                      <div className="tv-channel-meta">{videoCount} videos</div>
                    </div>
                    <button className="tv-watch-btn" onClick={() => router.push("/tv")}>
                      <i className="fas fa-expand"></i> Manage
                    </button>
                  </div>
                </div>
              </section>
            )}

            {loading ? (
              <div className="tv-loading-screen">
                <div className="tv-loading-ring">
                  <div className="tv-loading-ring-inner"></div>
                  <i className="fas fa-tv tv-loading-icon"></i>
                </div>
                <div className="tv-loading-brand">Church TV</div>
                <div className="tv-loading-dots">
                  <div className="tv-loading-dot"></div>
                  <div className="tv-loading-dot"></div>
                  <div className="tv-loading-dot"></div>
                </div>
              </div>
            ) : (
              <div className="section">
                {renderAdminTabContent()}
              </div>
            )}
        </div>

        <AdminBottomNav />
      </div>
    </>
  );
}
