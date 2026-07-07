"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import "plyr/dist/plyr.css";
import { useTvPlayer } from "@/lib/tv/TvPlayerProvider";
import {
  getVideos, getVideosPage, getVideosByIds, getVideo,
  getChannel,
  getUserTvState, updateUserTvProgress, saveUserTvState,
  addToUserPlaylist, removeFromUserPlaylist,
  updateTvHeartbeat,
  saveUserNote, getUserNote, getAllUserNotes, deleteUserNote,
} from "@/lib/youtube";
import type { YouTubeVideo, YouTubeChannel, UserTvState, TvNote } from "@/lib/youtube";
import { auth, db } from "@/lib/firebase";
import {
  getEnabledPaymentMethods, getMemberTransactions, submitTransaction,
  type PaymentMethod, type Transaction,
} from "@/lib/giving";
import {
  collection, addDoc, query, orderBy, onSnapshot, limit,
  serverTimestamp, Timestamp,
} from "firebase/firestore";
import ToastBridge from "@/components/dashboard/ToastBridge";
import BottomNavBar from "@/components/shared/BottomNavBar";
import PremiumTopBar from "@/components/shared/PremiumTopBar";

/* ─── Helpers ──────────────────────────────────────────────── */

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/* ─── Types ────────────────────────────────────────────────── */

type TabId = "notes" | "chat" | "prayer" | "give" | "playlist";

interface ChatMessage {
  id: string;
  userId: string;
  userName: string;
  message: string;
  timestamp: Date;
}

interface PrayerEntry {
  id: string;
  name: string;
  request: string;
  createdAt: Date;
  /** Admin reply */
  replyText?: string;
  repliedBy?: string;
  repliedAt?: Date;
}

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: "notes", label: "Notes", icon: "fa-book-bible" },
  { id: "chat", label: "Chat", icon: "fa-comment" },
  { id: "prayer", label: "Prayer", icon: "fa-hands-praying" },
  { id: "give", label: "Give", icon: "fa-hand-holding-heart" },
  { id: "playlist", label: "Playlist", icon: "fa-list" },
];

/* ─── Component ────────────────────────────────────────────── */

export default function TVPage() {
  const router = useRouter();

  // ─── Video / channel state ───
  const [videos, setVideos] = useState<YouTubeVideo[]>([]);  // User's playlist videos only
  const [channel, setChannel] = useState<YouTubeChannel | null>(null);
  const [loading, setLoading] = useState(true);

  // ─── Paginated "All Channel Videos" (loaded lazily when playlist tab opens) ───
  const [allPaginatedVideos, setAllPaginatedVideos] = useState<YouTubeVideo[]>([]);
  const [allVideosLastPos, setAllVideosLastPos] = useState<number | null>(null);
  const [allVideosLoading, setAllVideosLoading] = useState(false);
  const [allVideosHasMore, setAllVideosHasMore] = useState(true);
  const allVideosLoadedRef = useRef(false);

  // ─── User TV state (per-member playlist + progress) ───
  const [tvUserState, setTvUserState] = useState<UserTvState | null>(null);
  const lastTvSeekRef = useRef(0);
  const lastTvIndexRef = useRef(0);

  // localStorage keys for instant cross-page resume (scoped by user UID)
  const tvUid = auth.currentUser?.uid;
  const TV_SEEK_KEY = tvUid ? `tv_resume_seek_${tvUid}` : "tv_resume_seek";
  const TV_INDEX_KEY = tvUid ? `tv_resume_index_${tvUid}` : "tv_resume_index";

  // One-time migration: clean up old non-UID-scoped keys
  useEffect(() => {
    if (tvUid && typeof window !== "undefined") {
      localStorage.removeItem("tv_resume_seek");
      localStorage.removeItem("tv_resume_index");
    }
  }, []);

  const cachedSeek = typeof window !== "undefined" ? Number(localStorage.getItem(TV_SEEK_KEY)) || 0 : 0;

  const tvPlayerTargetRef = useRef<HTMLDivElement>(null);
  const tvPlayer = useTvPlayer();

  // ─── Current playing video ───
  const currentVideo = tvUserState && tvUserState.playlist.length > 0
    ? videos.find((v) => v.id === tvUserState.playlist[tvUserState.currentIndex])
    : undefined;
  const currentSeek = (() => {
    // Prefer Firestore if it has a valid seek > 0.1 seconds
    if (tvUserState && tvUserState.currentSeek > 0.1) return tvUserState.currentSeek;
    // Otherwise use localStorage cache (freshly written by the other page)
    return cachedSeek > 0.1 ? cachedSeek : undefined;
  })();

  // ─── Tabs ───
  const [activeTab, setActiveTab] = useState<TabId>("notes");

  // ─── Chat state ───
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatListRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // ─── Prayer state ───
  const [prayerName, setPrayerName] = useState("");
  const [prayerRequest, setPrayerRequest] = useState("");
  const [prayers, setPrayers] = useState<PrayerEntry[]>([]);
  const [prayerSending, setPrayerSending] = useState(false);

  // ─── Notes state ───
  const [noteContent, setNoteContent] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteLastSaved, setNoteLastSaved] = useState<Date | null>(null);
  const notesLoadedRef = useRef(false);
  const noteSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteChangedRef = useRef(false);

  // ─── All notes library ───
  const [allNotes, setAllNotes] = useState<TvNote[]>([]);
  const [allNotesLoading, setAllNotesLoading] = useState(false);

  // ─── Preview mode toggle ───
  const [notesPreview, setNotesPreview] = useState(false);

  // ─── Notes sub-tabs & reader ───
  const [notesSubTab, setNotesSubTab] = useState<"write" | "saved">("write");
  const [selectedNote, setSelectedNote] = useState<TvNote | null>(null);
  const [noteSavingExplicit, setNoteSavingExplicit] = useState(false);
  const [notesSearch, setNotesSearch] = useState("");

  /* ─── Export all notes as a downloadable markdown file ─── */
  const handleExportNotes = useCallback(() => {
    if (allNotes.length === 0) return;
    const lines: string[] = [];
    lines.push("# FaithStream Notes Export");
    lines.push("");
    lines.push(`Exported on: ${new Date().toLocaleDateString([], { year: "numeric", month: "long", day: "numeric" })}`);
    lines.push(`Total notes: ${allNotes.length}`);
    lines.push("");
    lines.push("---");
    lines.push("");

    const sorted = [...allNotes].sort((a, b) => (a.videoTitle || "").localeCompare(b.videoTitle || ""));

    for (const note of sorted) {
      lines.push(`## ${note.videoTitle || "Untitled Video"}`);
      if (note.updatedAt) {
        const d = new Date(note.updatedAt as any);
        lines.push(`*Last edited: ${d.toLocaleDateString([], { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}*`);
      }
      lines.push("");
      lines.push(note.content || "*(no content)*");
      lines.push("");
      lines.push("---");
      lines.push("");
    }

    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `faithstream-notes-${new Date().toISOString().split("T")[0]}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [allNotes]);

  // ─── Giving state ───
  const [giveMethods, setGiveMethods] = useState<PaymentMethod[]>([]);
  const [giveTxns, setGiveTxns] = useState<Transaction[]>([]);
  const [giveLoading, setGiveLoading] = useState(true);
  const [giveSubmitting, setGiveSubmitting] = useState(false);
  const [giveSelectedMethod, setGiveSelectedMethod] = useState("");
  const [giveCustomAmount, setGiveCustomAmount] = useState("");
  const [giveSelectedAmount, setGiveSelectedAmount] = useState<number | null>(null);
  const [giveConfirmationCode, setGiveConfirmationCode] = useState("");

  // ─── User info ───
  const [userName, setUserName] = useState("");

  useEffect(() => {
    const user = auth.currentUser;
    if (user?.displayName) setUserName(user.displayName);
    else if (user?.email) setUserName(user.email.split("@")[0]);
    else setUserName("Guest");
  }, []);

  // Sync index ref when state changes + update localStorage
  useEffect(() => {
    if (tvUserState) {
      lastTvIndexRef.current = tvUserState.currentIndex;
      if (typeof window !== "undefined") {
        localStorage.setItem(TV_INDEX_KEY, String(tvUserState.currentIndex));
      }
    }
  }, [tvUserState?.currentIndex]);

  // Register portal target for the global player overlay
  useEffect(() => {
    if (tvPlayerTargetRef.current) {
      tvPlayer.registerTarget(tvPlayerTargetRef.current);
    }
    return () => {
      tvPlayer.registerTarget(null);
    };
  }, [currentVideo, tvPlayer]);

  // Call play() when current video changes
  useEffect(() => {
    if (currentVideo) {
      tvPlayer.play(currentVideo.id, currentSeek);
    }
  }, [currentVideo?.id, currentSeek, tvPlayer]);

  // ─── Initial load: fetch channel + user's TV state + only playlist videos ───
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const uid = auth.currentUser?.uid;
      if (!uid) { if (mounted) setLoading(false); return; }
      try {
        const [c, state] = await Promise.all([
          getChannel(),
          getUserTvState(uid),
        ]);
        if (!mounted) return;

        let finalState = state;
        let userVideos: YouTubeVideo[] = [];

        if (state.playlist.length === 0) {
          // First visit — auto-populate playlist with recent videos (more can be added from the Playlist tab)
          const all = await getVideos({ max: 15 });
          const valid = all.filter((v) => v.title && v.id);
          if (valid.length > 0) {
            const ids = valid.map((v) => v.id);
            await saveUserTvState(uid, {
              playlist: ids,
              currentIndex: 0,
              currentSeek: 0,
            });
            finalState = { playlist: ids, currentIndex: 0, currentSeek: 0, updatedAt: null };
            userVideos = valid;
          }
        } else {
          // Only load the current video for playback; rest load lazily when Playlist tab opens
          const currentId = state.playlist[state.currentIndex];
          if (currentId) {
            const current = await getVideo(currentId);
            if (current) userVideos = [current];
          }
        }

        if (!mounted) return;
        setVideos(userVideos);
        setChannel(c);
        setTvUserState(finalState);
      } catch {} finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => { mounted = false; };
  }, []);

  // ─── Load giving data (only when give tab is open) ───
  useEffect(() => {
    if (activeTab !== "give") return;
    let mounted = true;
    const load = async () => {
      const uid = auth.currentUser?.uid;
      try {
        const [m, t] = await Promise.all([
          getEnabledPaymentMethods(),
          uid ? getMemberTransactions(uid) : Promise.resolve([]),
        ]);
        if (!mounted) return;
        setGiveMethods(m);
        setGiveTxns(t);
        if (m.length > 0) setGiveSelectedMethod(m[0].id!);
      } catch {} finally { if (mounted) setGiveLoading(false); }
    };
    load();
    return () => { mounted = false; };
  }, [activeTab]);

  // ─── Lazy-load all user's playlist videos + first page of "All Channel Videos" when playlist tab opens ───
  useEffect(() => {
    if (activeTab !== "playlist" || allVideosLoadedRef.current) return;
    allVideosLoadedRef.current = true;
    (async () => {
      setAllVideosLoading(true);
      try {
        // Load full playlist video data (not just current video)
        if (tvUserState && tvUserState.playlist.length > 0) {
          const allPlaylistVids = await getVideosByIds(tvUserState.playlist);
          setVideos(allPlaylistVids);
        }
        // Load paginated channel videos
        const { videos: page, lastPosition } = await getVideosPage(20);
        setAllPaginatedVideos(page);
        setAllVideosLastPos(lastPosition);
        setAllVideosHasMore(page.length === 20);
      } catch {}
      setAllVideosLoading(false);
    })();
  }, [activeTab]);

  const loadMoreVideos = useCallback(async () => {
    if (allVideosLoading || !allVideosHasMore) return;
    setAllVideosLoading(true);
    try {
      const { videos: page, lastPosition } = await getVideosPage(20, allVideosLastPos ?? undefined);
      setAllPaginatedVideos((prev) => [...prev, ...page]);
      setAllVideosLastPos(lastPosition);
      setAllVideosHasMore(page.length === 20);
    } catch {}
    setAllVideosLoading(false);
  }, [allVideosLastPos, allVideosLoading, allVideosHasMore]);

  // ─── Load video data when advancing to a video not yet in local state ───
  useEffect(() => {
    if (!tvUserState || tvUserState.playlist.length === 0) return;
    const currentId = tvUserState.playlist[tvUserState.currentIndex];
    if (!currentId) return;
    if (!videos.some((v) => v.id === currentId)) {
      getVideo(currentId).then((v) => {
        if (v) setVideos((prev) => [...prev, v]);
      });
    }
  }, [tvUserState?.currentIndex]);

  // ─── Advance to next video in user's playlist ───
  const advanceToNext = useCallback(() => {
    if (!tvUserState || tvUserState.playlist.length === 0) return;
    const nextIndex = (tvUserState.currentIndex + 1) % tvUserState.playlist.length;
    const uid = auth.currentUser?.uid;
    if (uid) {
      updateUserTvProgress(uid, nextIndex, 0);
    }
    // Reset localStorage cache for new video
    if (typeof window !== "undefined") {
      localStorage.setItem(TV_SEEK_KEY, "0");
      localStorage.setItem(TV_INDEX_KEY, String(nextIndex));
    }
    setTvUserState((prev) => prev ? { ...prev, currentIndex: nextIndex, currentSeek: 0 } : prev);
  }, [tvUserState]);

  // ─── Track current seek for periodic Firestore + localStorage saves ───
  const handleTvTimeUpdate = useCallback((time: number) => {
    lastTvSeekRef.current = time;
    // Write to localStorage instantly for cross-page resume
    if (typeof window !== "undefined") {
      localStorage.setItem(TV_SEEK_KEY, String(time));
    }
  }, []);

  // Keep callbacks in sync with latest versions (after advanceToNext/handleTvTimeUpdate)
  useEffect(() => {
    tvPlayer.setCallbacks({
      onEnded: advanceToNext,
      onTimeUpdate: handleTvTimeUpdate,
    });
  }, [advanceToNext, handleTvTimeUpdate, tvPlayer]);

  /* Save current progress to Firestore + localStorage (used by interval + cleanup) */
  const saveTvProgress = useCallback(() => {
    const uid = auth.currentUser?.uid;
    if (uid && lastTvSeekRef.current > 0) {
      updateUserTvProgress(uid, lastTvIndexRef.current, lastTvSeekRef.current);
    }
    // Also persist to localStorage as fresh backup
    if (typeof window !== "undefined") {
      localStorage.setItem(TV_SEEK_KEY, String(lastTvSeekRef.current));
      localStorage.setItem(TV_INDEX_KEY, String(lastTvIndexRef.current));
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
            if (uid) getUserTvState(uid).then((s) => setTvUserState(s));
          }
        }).then((handler) => {
          if (canceled) handler.remove();
        });
      });
    return () => { canceled = true; };
  }, [saveTvProgress]);

  // ─── Tab visibility — re-fetch TV state when tab comes back into focus (web) ───
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        const uid = auth.currentUser?.uid;
        if (uid) {
          // Re-fetch TV state from Firestore when tab becomes visible
          getUserTvState(uid).then((s) => setTvUserState(s));
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  // ─── TV Heartbeat — marks this user as actively watching (for admin viewer count) ───
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    // Immediate heartbeat on mount
    updateTvHeartbeat(uid);
    // Then every 30 seconds
    const interval = setInterval(() => updateTvHeartbeat(uid), 30000);
    return () => clearInterval(interval);
  }, []);

  // ─── Orientation toggle ───
  const [isLandscape, setIsLandscape] = useState(false);
  useEffect(() => {
    const check = () => setIsLandscape(window.innerWidth > window.innerHeight);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const toggleOrientation = useCallback(async () => {
    try {
      const { ScreenOrientation } = await import("@capacitor/screen-orientation");
      if (isLandscape) {
        await ScreenOrientation.lock({ orientation: "portrait" } as any);
      } else {
        await ScreenOrientation.lock({ orientation: "landscape" } as any);
      }
    } catch {
      try {
        if (!document.fullscreenElement) {
          await document.documentElement.requestFullscreen();
        } else {
          await document.exitFullscreen();
        }
      } catch {}
    }
  }, [isLandscape]);

  // ─── Chat real-time listener (only when chat tab is open) ───
  const chatBufferRef = useRef<ChatMessage[]>([]);
  useEffect(() => {
    if (activeTab !== "chat") return;
    const q = query(
      collection(db, "tv_chat"),
      orderBy("timestamp", "desc"),
      limit(100),
    );
    chatBufferRef.current = [];
    const unsub = onSnapshot(q, (snap) => {
      snap.docChanges().forEach((change) => {
        if (change.type === "removed") {
          chatBufferRef.current = chatBufferRef.current.filter((m) => m.id !== change.doc.id);
          return;
        }
        const data = change.doc.data();
        const msg: ChatMessage = {
          id: change.doc.id,
          userId: data.userId || "",
          userName: data.userName || "Anonymous",
          message: data.message || "",
          timestamp: (data.timestamp as Timestamp)?.toDate() || new Date(),
        };
        if (change.type === "added") {
          // Prepend since query orders by timestamp desc (newest first)
          chatBufferRef.current = [msg, ...chatBufferRef.current];
        } else if (change.type === "modified") {
          chatBufferRef.current = chatBufferRef.current.map((m) =>
            m.id === change.doc.id ? msg : m
          );
        }
      });
      setMessages(chatBufferRef.current);
    });
    return () => {
      unsub();
      chatBufferRef.current = [];
    };
  }, [activeTab]);

  // ─── Auto-scroll chat ───
  useEffect(() => {
    if (autoScroll && chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, autoScroll]);

  // Handle chat scroll to detect manual scroll-up
  const handleChatScroll = useCallback(() => {
    if (!chatListRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = chatListRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 60;
    setAutoScroll(isAtBottom);
  }, []);

  // ─── Send chat message ───
  const handleSendChat = useCallback(async () => {
    const msg = chatInput.trim();
    if (!msg) return;
    setChatSending(true);
    try {
      await addDoc(collection(db, "tv_chat"), {
        userId: auth.currentUser?.uid || "anonymous",
        userName: userName,
        message: msg,
        timestamp: serverTimestamp(),
      });
      setChatInput("");
      setAutoScroll(true);
    } catch {}
    setChatSending(false);
  }, [chatInput, userName]);

  const handleChatKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSendChat();
      }
    },
    [handleSendChat],
  );

  // ─── Prayer requests listener (per-user, only when prayer tab is open) ───
  const prayerBufferRef = useRef<PrayerEntry[]>([]);
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid || activeTab !== "prayer") return;
    const q = query(
      collection(db, "users", uid, "tv_prayers"),
      orderBy("createdAt", "desc"),
      limit(50),
    );
    prayerBufferRef.current = [];
    const unsub = onSnapshot(q, (snap) => {
      snap.docChanges().forEach((change) => {
        if (change.type === "removed") {
          prayerBufferRef.current = prayerBufferRef.current.filter((p) => p.id !== change.doc.id);
          return;
        }
        const data = change.doc.data();
        const entry: PrayerEntry = {
          id: change.doc.id,
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
      setPrayers(prayerBufferRef.current);
    });
    return () => {
      unsub();
      prayerBufferRef.current = [];
    };
  }, [activeTab]);

  // ─── Send prayer request (writes to per-user subcollection) ───
  const handleSendPrayer = useCallback(async () => {
    const req = prayerRequest.trim();
    if (!req) return;
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    setPrayerSending(true);
    try {
      await addDoc(collection(db, "users", uid, "tv_prayers"), {
        userId: uid,
        name: prayerName.trim() || userName,
        request: req,
        createdAt: serverTimestamp(),
      });
      setPrayerRequest("");
    } catch {}
    setPrayerSending(false);
  }, [prayerRequest, prayerName, userName]);

  // ─── Give submit handler ───
  const handleGiveSubmit = useCallback(async () => {
    const amount = giveSelectedAmount || (giveCustomAmount ? parseInt(giveCustomAmount) : 0);
    if (amount < 1) { (window as any).dispatchEvent(new CustomEvent("show-toast", { detail: { title: "Amount", message: "Please enter a valid amount", type: "error", duration: 3000 } })); return; }
    if (!giveSelectedMethod) { (window as any).dispatchEvent(new CustomEvent("show-toast", { detail: { title: "Method", message: "Please select a payment method", type: "error", duration: 3000 } })); return; }
    if (!giveConfirmationCode.trim()) { (window as any).dispatchEvent(new CustomEvent("show-toast", { detail: { title: "Code", message: "Please enter your payment confirmation code", type: "error", duration: 3000 } })); return; }
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const method = giveMethods.find((m) => m.id === giveSelectedMethod);
    setGiveSubmitting(true);
    try {
      await submitTransaction({
        memberId: uid,
        memberName: userName,
        amount,
        paymentMethodId: giveSelectedMethod,
        paymentMethodLabel: method?.name || "Unknown",
        confirmationCode: giveConfirmationCode.trim(),
        date: new Date().toISOString(),
      });
      const t = await getMemberTransactions(uid);
      setGiveTxns(t);
      setGiveCustomAmount("");
      setGiveSelectedAmount(null);
      setGiveConfirmationCode("");
      (window as any).dispatchEvent(new CustomEvent("show-toast", { detail: { title: "Thank You!", message: "Your giving has been submitted for confirmation.", type: "success", duration: 3000 } }));
    } catch { (window as any).dispatchEvent(new CustomEvent("show-toast", { detail: { title: "Error", message: "Failed to submit. Please try again.", type: "error", duration: 3000 } })); }
    setGiveSubmitting(false);
  }, [giveSelectedAmount, giveCustomAmount, giveSelectedMethod, giveConfirmationCode, giveMethods, userName]);

  // ─── Load saved notes from Firestore + localStorage draft (only when Notes tab is active) ───
  useEffect(() => {
    if (!currentVideo || !auth.currentUser?.uid || activeTab !== "notes") return;
    notesLoadedRef.current = false;
    const uid = auth.currentUser.uid;
    const vid = currentVideo.id;
    (async () => {
      try {
        // First check localStorage for an unsaved draft
        const draftKey = `tv_draft_${uid}_${vid}`;
        const draft = typeof window !== "undefined" ? localStorage.getItem(draftKey) : null;
        if (draft !== null) {
          // Restore draft — user had unsaved text
          setNoteContent(draft);
        } else {
          // No draft — try Firestore
          const saved = await getUserNote(uid, vid);
          if (saved) setNoteContent(saved.content);
          else setNoteContent("");
        }
      } catch {
        setNoteContent("");
      }
      notesLoadedRef.current = true;
    })();
  }, [currentVideo?.id, activeTab]);

  // ─── Save draft to localStorage on every keystroke ───
  useEffect(() => {
    if (!currentVideo || !auth.currentUser?.uid) return;
    const uid = auth.currentUser.uid;
    const vid = currentVideo.id;
    try {
      localStorage.setItem(`tv_draft_${uid}_${vid}`, noteContent);
    } catch {}
  }, [noteContent, currentVideo?.id]);

  // ─── Save notes to Firestore on change (with debounce) ───
  useEffect(() => {
    if (!currentVideo || !notesLoadedRef.current || !auth.currentUser?.uid) return;
    if (!noteChangedRef.current) return;
    noteChangedRef.current = false;
    const uid = auth.currentUser.uid;
    const vid = currentVideo.id;
    const title = currentVideo.title;
    if (noteSaveTimerRef.current) clearTimeout(noteSaveTimerRef.current);
    noteSaveTimerRef.current = setTimeout(async () => {
      setNoteSaving(true);
      try {
        await saveUserNote(uid, vid, title, noteContent);
        setNoteLastSaved(new Date());
      } catch {}
      setNoteSaving(false);
    }, 800);
    return () => {
      if (noteSaveTimerRef.current) clearTimeout(noteSaveTimerRef.current);
    };
  }, [noteContent, currentVideo?.id]);

  // ─── Track that notes content has changed ───
  const handleNoteChange = useCallback((value: string) => {
    noteChangedRef.current = true;
    setNoteContent(value);
  }, []);

  // ─── Explicit Save to Library button ───
  const handleExplicitSave = useCallback(async () => {
    if (!currentVideo || !auth.currentUser?.uid || !noteContent.trim()) return;
    const uid = auth.currentUser.uid;
    const vid = currentVideo.id;
    const title = currentVideo.title;
    setNoteSavingExplicit(true);
    try {
      await saveUserNote(uid, vid, title, noteContent);
      setNoteLastSaved(new Date());
      noteChangedRef.current = false;
      // Clear localStorage draft after saving
      localStorage.removeItem(`tv_draft_${uid}_${vid}`);
      // Refresh the library
      getAllUserNotes(uid).then(setAllNotes).catch(() => {});
    } catch {}
    setNoteSavingExplicit(false);
  }, [noteContent, currentVideo]);

  // ─── Save on page unload / visibility hidden ───
  useEffect(() => {
    const saveNow = async () => {
      if (!currentVideo || !auth.currentUser?.uid || !noteChangedRef.current) return;
      const uid = auth.currentUser.uid;
      const vid = currentVideo.id;
      const title = currentVideo.title;
      try {
        await saveUserNote(uid, vid, title, noteContent);
        setNoteLastSaved(new Date());
        noteChangedRef.current = false;
      } catch {}
    };
    const handleVis = () => {
      if (document.visibilityState === "hidden") saveNow();
    };
    window.addEventListener("beforeunload", saveNow);
    document.addEventListener("visibilitychange", handleVis);
    return () => {
      window.removeEventListener("beforeunload", saveNow);
      document.removeEventListener("visibilitychange", handleVis);
      saveNow();
    };
  }, [noteContent, currentVideo]);

  // ─── Load all my notes when tab is notes ───
  useEffect(() => {
    if (activeTab !== "notes" || !auth.currentUser?.uid) return;
    const uid = auth.currentUser.uid;
    setAllNotesLoading(true);
    getAllUserNotes(uid).then(setAllNotes).catch(() => {}).finally(() => setAllNotesLoading(false));
  }, [activeTab]);

  // ─── Insert formatting into notes ───
  const insertFormatting = useCallback((before: string, after: string) => {
    const textarea = document.getElementById("tv-notes-textarea") as HTMLTextAreaElement | null;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = noteContent.substring(start, end);
    const newContent = noteContent.substring(0, start) + before + selected + after + noteContent.substring(end);
    setNoteContent(newContent);
    noteChangedRef.current = true;
    // Restore selection after React re-render
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + before.length, start + before.length + selected.length);
    });
  }, [noteContent]);

  const handleBold = useCallback(() => insertFormatting("**", "**"), [insertFormatting]);
  const handleItalic = useCallback(() => insertFormatting("*", "*"), [insertFormatting]);
  const handleHeading = useCallback(() => insertFormatting("\n## ", ""), [insertFormatting]);
  const handleBullet = useCallback(() => insertFormatting("\n- ", ""), [insertFormatting]);
  const handleNumbered = useCallback(() => insertFormatting("\n1. ", ""), [insertFormatting]);
  const handleLink = useCallback(() => {
    const textarea = document.getElementById("tv-notes-textarea") as HTMLTextAreaElement | null;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = noteContent.substring(start, end);
    if (selected) {
      insertFormatting("[", "](url)");
    } else {
      insertFormatting("[link text]", "(url)");
    }
  }, [insertFormatting, noteContent]);

  // ─── Simple markdown-to-HTML renderer ───
  const renderNoteContent = useCallback((content: string) => {
    // Escape HTML entities first
    let html = content
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // Headings (## Heading)
    html = html.replace(/^### (.+)$/gm, '<h4 class="tv-md-h4">$1</h4>');
    html = html.replace(/^## (.+)$/gm, '<h3 class="tv-md-h3">$1</h3>');

    // Bold (**text**)
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // Italic (*text*)
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // Inline code (`text`)
    html = html.replace(/`(.+?)`/g, '<code class="tv-md-code">$1</code>');

    // Links ([text](url))
    html = html.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener" class="tv-md-link">$1</a>');

    // Lists: transform lines starting with - or 1. into list items
    const lines = html.split("\n");
    let result = "";
    let inUl = false;
    let inOl = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const ulMatch = line.match(/^\s*[-*]\s+(.+)/);
      const olMatch = line.match(/^\s*\d+\.\s+(.+)/);
      if (ulMatch) {
        if (!inUl) { if (inOl) { result += "</ol>\n"; inOl = false; } result += "<ul class='tv-md-ul'>\n"; inUl = true; }
        result += `<li>${ulMatch[1]}</li>\n`;
      } else if (olMatch) {
        if (!inOl) { if (inUl) { result += "</ul>\n"; inUl = false; } result += "<ol class='tv-md-ol'>\n"; inOl = true; }
        result += `<li>${olMatch[1]}</li>\n`;
      } else {
        if (inUl) { result += "</ul>\n"; inUl = false; }
        if (inOl) { result += "</ol>\n"; inOl = false; }
        if (line.trim() === "") {
          result += "<br />\n";
        } else {
          result += `<p>${line}</p>\n`;
        }
      }
    }
    if (inUl) result += "</ul>\n";
    if (inOl) result += "</ol>\n";
    return result;
  }, []);

  // ─── Playlist helpers ───
  const [addingToPlaylist, setAddingToPlaylist] = useState<string | null>(null);
  const [removingFromPlaylist, setRemovingFromPlaylist] = useState<string | null>(null);

  const handleAddToPlaylist = useCallback(async (videoId: string) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    setAddingToPlaylist(videoId);
    try {
      await addToUserPlaylist(uid, videoId);
      const fresh = await getUserTvState(uid);
      setTvUserState(fresh);
      // Also add the video data to local state
      if (!videos.some((v) => v.id === videoId)) {
        const vid = await getVideo(videoId);
        if (vid) setVideos((prev) => [...prev, vid]);
      }
    } catch {}
    setAddingToPlaylist(null);
  }, [videos]);

  const handleRemoveFromPlaylist = useCallback(async (videoId: string) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    setRemovingFromPlaylist(videoId);
    try {
      await removeFromUserPlaylist(uid, videoId);
      const fresh = await getUserTvState(uid);
      setTvUserState(fresh);
      setVideos((prev) => prev.filter((v) => v.id !== videoId));
    } catch {}
    setRemovingFromPlaylist(null);
  }, []);

  const playlistVideoIds = new Set(tvUserState?.playlist || []);
  const playlistVideos = videos.filter((v) => playlistVideoIds.has(v.id));

  // ─── Render tab content ───
  const renderTabContent = () => {
    switch (activeTab) {
      case "chat":
        return (
          <div className="tv-tab-pane chat-pane">
            <div className="tv-chat-messages" ref={chatListRef} onScroll={handleChatScroll}>
              {messages.length === 0 ? (
                <div className="tv-chat-empty">
                  <i className="fas fa-comment-dots"></i>
                  <span>No messages yet. Be the first to say something!</span>
                </div>
              ) : (
                messages.map((m) => (
                  <div
                    key={m.id}
                    className={`tv-chat-msg ${m.userId === auth.currentUser?.uid ? "own" : ""}`}
                  >
                    <div className="tv-chat-msg-header">
                      <span className="tv-chat-msg-name">{m.userName}</span>
                      <span className="tv-chat-msg-time">
                        {m.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    <div className="tv-chat-msg-text">{m.message}</div>
                  </div>
                ))
              )}
              <div ref={chatEndRef} />
            </div>
            <div className="tv-chat-input-bar">
              <input
                className="tv-chat-input"
                type="text"
                placeholder="Type a message..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={handleChatKeyDown}
                maxLength={500}
              />
              <button
                className="tv-chat-send"
                onClick={handleSendChat}
                disabled={chatSending || !chatInput.trim()}
              >
                {chatSending ? (
                  <i className="fas fa-spinner fa-spin"></i>
                ) : (
                  <i className="fas fa-paper-plane"></i>
                )}
              </button>
            </div>
          </div>
        );

      case "prayer":
        return (
          <div className="tv-tab-pane">
            <div className="tv-prayer-intro">
              <i className="fas fa-hands-praying"></i>
              <p>Share your prayer requests with our community. We stand with you in faith.</p>
            </div>
            <div className="tv-prayer-form">
              <input
                className="tv-prayer-input"
                type="text"
                placeholder="Your name (optional)"
                value={prayerName}
                onChange={(e) => setPrayerName(e.target.value)}
                maxLength={60}
              />
              <textarea
                className="tv-prayer-textarea"
                placeholder="Share your prayer request..."
                value={prayerRequest}
                onChange={(e) => setPrayerRequest(e.target.value)}
                maxLength={500}
                rows={3}
              />
              <button
                className="tv-prayer-submit"
                onClick={handleSendPrayer}
                disabled={prayerSending || !prayerRequest.trim()}
              >
                {prayerSending ? (
                  <><i className="fas fa-spinner fa-spin"></i> Sending...</>
                ) : (
                  <><i className="fas fa-pray"></i> Send Prayer Request</>
                )}
              </button>
            </div>
            {prayers.length > 0 && (
              <>
                <div className="tv-prayer-section-title">
                  <i className="fas fa-list"></i> Prayer Requests ({prayers.length})
                </div>
                <div className="tv-prayer-list">
                  {prayers.map((p) => (
                    <div key={p.id} className="tv-prayer-item">
                      <div className="tv-prayer-item-header">
                        <span className="tv-prayer-item-name">
                          <i className="fas fa-user"></i> {p.name}
                        </span>
                        <span className="tv-prayer-item-time">
                          {p.createdAt.toLocaleDateString([], { month: "short", day: "numeric" })}
                        </span>
                      </div>
                      <div className="tv-prayer-item-text">{p.request}</div>
                      {/* Admin reply */}
                      {p.replyText && (
                        <div className="tv-prayer-reply">
                          <div className="tv-prayer-reply-header">
                            <i className="fas fa-reply"></i>
                            <span className="tv-prayer-reply-name">{p.repliedBy || "Admin"}</span>
                            {p.repliedAt && (
                              <span className="tv-prayer-reply-time">
                                {p.repliedAt.toLocaleDateString([], { month: "short", day: "numeric" })}
                              </span>
                            )}
                          </div>
                          <div className="tv-prayer-reply-text">{p.replyText}</div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        );

      case "notes":
        return (
          <div className="tv-tab-pane">
            {/* Sub-tabs: Write | Saved Notes */}
            <div className="tv-notes-sub-tabs">
              <button
                className={`tv-notes-sub-tab ${notesSubTab === "write" ? "active" : ""}`}
                onClick={() => setNotesSubTab("write")}
              >
                <i className="fas fa-pen"></i> Write
              </button>
              <button
                className={`tv-notes-sub-tab ${notesSubTab === "saved" ? "active" : ""}`}
                onClick={() => setNotesSubTab("saved")}
              >
                <i className="fas fa-bookmark"></i> Saved Notes ({allNotes.length})
              </button>
            </div>

            {/* ═══ WRITE TAB ═══ */}
            {notesSubTab === "write" && (
              <>
                {currentVideo ? (
                  <>
                    <div className="tv-notes-current">
                      <div className="tv-notes-current-label">Now Watching</div>
                      <div className="tv-notes-current-title">{currentVideo.title}</div>
                      {currentVideo.description && (
                        <div className="tv-notes-current-desc">{currentVideo.description}</div>
                      )}
                      {tvUserState && (
                        <div className="tv-notes-current-playlist">
                          <i className="fas fa-list"></i> Video {tvUserState.currentIndex + 1} of {tvUserState.playlist.length}
                        </div>
                      )}
                    </div>

                    <div className="tv-notes-section-title">
                      <i className="fas fa-pen"></i> Your Notes
                      <div className="tv-notes-toolbar-right">
                        {noteSaving && <span className="tv-notes-saving"><i className="fas fa-spinner fa-spin"></i></span>}
                        <button
                          className="tv-notes-preview-btn"
                          onClick={handleExplicitSave}
                          disabled={noteSavingExplicit || !noteContent.trim()}
                          title="Save to Library"
                        >
                          {noteSavingExplicit ? (
                            <i className="fas fa-spinner fa-spin"></i>
                          ) : (
                            <><i className="fas fa-save"></i></>
                          )}
                        </button>
                        <button
                          className={`tv-notes-preview-btn ${notesPreview ? "active" : ""}`}
                          onClick={() => setNotesPreview((p) => !p)}
                          title={notesPreview ? "Edit" : "Preview"}
                        >
                          <i className={`fas fa-${notesPreview ? "edit" : "eye"}`}></i>
                        </button>
                      </div>
                    </div>

                    {/* Formatting toolbar (edit mode only) */}
                    {!notesPreview && (
                      <div className="tv-notes-toolbar">
                        <button className="tv-notes-tb-btn" onClick={handleBold} title="Bold">
                          <i className="fas fa-bold"></i>
                        </button>
                        <button className="tv-notes-tb-btn" onClick={handleItalic} title="Italic">
                          <i className="fas fa-italic"></i>
                        </button>
                        <button className="tv-notes-tb-btn" onClick={handleHeading} title="Heading">
                          <i className="fas fa-heading"></i>
                        </button>
                        <span className="tv-notes-tb-divider"></span>
                        <button className="tv-notes-tb-btn" onClick={handleBullet} title="Bullet List">
                          <i className="fas fa-list-ul"></i>
                        </button>
                        <button className="tv-notes-tb-btn" onClick={handleNumbered} title="Numbered List">
                          <i className="fas fa-list-ol"></i>
                        </button>
                        <span className="tv-notes-tb-divider"></span>
                        <button className="tv-notes-tb-btn" onClick={handleLink} title="Insert Link">
                          <i className="fas fa-link"></i>
                        </button>
                      </div>
                    )}

                    {/* Editor textarea or rendered preview */}
                    {notesPreview ? (
                      <div
                        className="tv-notes-preview"
                        dangerouslySetInnerHTML={{
                          __html: noteContent.trim()
                            ? renderNoteContent(noteContent)
                            : '<p style="color: var(--text-tertiary); font-style: italic;">No notes yet for this video.</p>',
                        }}
                      />
                    ) : (
                      <textarea
                        id="tv-notes-textarea"
                        className="tv-notes-textarea"
                        placeholder="Write your sermon notes, thoughts, or key verses here...&#10;&#10;Use the toolbar above to format your notes, or type directly:&#10;• **bold** and *italic*&#10;• ## Headings&#10;• - Bullet lists&#10;• 1. Numbered lists&#10;• [links](url)"
                        value={noteContent}
                        onChange={(e) => handleNoteChange(e.target.value)}
                        rows={8}
                      />
                    )}

                    <div className="tv-notes-hint">
                      {noteSaving ? (
                        <><i className="fas fa-spinner fa-spin"></i> Saving...</>
                      ) : noteLastSaved ? (
                        <><i className="fas fa-check-circle" style={{ color: "var(--success)" }}></i> Saved {noteLastSaved.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</>
                      ) : (
                        <><i className="fas fa-save"></i> Draft saved locally</>
                      )}
                    </div>

                    {/* "Save to Library" bottom button */}
                    <button
                      className="tv-notes-save-bottom"
                      onClick={handleExplicitSave}
                      disabled={noteSavingExplicit || !noteContent.trim()}
                    >
                      {noteSavingExplicit ? (
                        <><i className="fas fa-spinner fa-spin"></i> Saving...</>
                      ) : (
                        <><i className="fas fa-save"></i> Save to Library</>
                      )}
                    </button>
                  </>
                ) : (
                  <div className="tv-tab-empty">
                    <i className="fas fa-book-bible"></i>
                    <span>No video playing. Notes will appear here when a video starts.</span>
                  </div>
                )}
              </>
            )}

            {/* ═══ SAVED NOTES TAB ═══ */}
            {notesSubTab === "saved" && (
              <div className="tv-notes-saved-section">
                <div className="tv-notes-section-title">
                  <i className="fas fa-bookmark"></i> My Notes Library
                  <button
                    className="tv-notes-export-btn"
                    onClick={handleExportNotes}
                    disabled={allNotes.length === 0}
                    title="Export all notes as markdown"
                  >
                    <i className="fas fa-download"></i>
                  </button>
                  <button
                    className="tv-notes-refresh-btn"
                    onClick={() => {
                      if (!auth.currentUser?.uid) return;
                      setAllNotesLoading(true);
                      getAllUserNotes(auth.currentUser.uid).then(setAllNotes).catch(() => {}).finally(() => setAllNotesLoading(false));
                    }}
                    disabled={allNotesLoading}
                  >
                    <i className={`fas fa-${allNotesLoading ? "spinner fa-spin" : "refresh"}`}></i>
                  </button>
                </div>

                {/* Search bar */}
                <div className="tv-notes-search-wrap">
                  <i className="fas fa-search tv-notes-search-icon"></i>
                  <input
                    className="tv-notes-search-input"
                    type="text"
                    placeholder="Search notes by video title..."
                    value={notesSearch}
                    onChange={(e) => setNotesSearch(e.target.value)}
                  />
                  {notesSearch && (
                    <button className="tv-notes-search-clear" onClick={() => setNotesSearch("")}>
                      <i className="fas fa-times"></i>
                    </button>
                  )}
                </div>

                {(() => {
                  const filtered = notesSearch
                    ? allNotes.filter((n) => n.videoTitle?.toLowerCase().includes(notesSearch.toLowerCase()))
                    : allNotes;
                  if (filtered.length === 0) {
                    return (
                      <div className="tv-notes-empty">
                        <i className="fas fa-search"></i>
                        <span>
                          {allNotesLoading ? "Loading your notes..." : notesSearch ? `No notes matching "${notesSearch}"` : "No saved notes yet. Write notes on a video and tap 'Save to Library'!"}
                        </span>
                      </div>
                    );
                  }
                  return (
                    <div className="tv-notes-list">
                      {filtered.map((n) => {
                      const isCurrent = currentVideo?.id === n.videoId;
                      return (
                        <div key={n.videoId} className={`tv-notes-list-item ${isCurrent ? "active" : ""}`} onClick={() => setSelectedNote(n)}>
                          <div className="tv-notes-list-item-top">
                            <div className="tv-notes-list-item-title">
                              {n.videoTitle || "Untitled Video"}
                            </div>
                            {n.updatedAt && (
                              <div className="tv-notes-list-item-date">
                                {new Date(n.updatedAt as any).toLocaleDateString([], { month: "short", day: "numeric" })}
                              </div>
                            )}
                          </div>
                          {n.content && (
                            <div className="tv-notes-list-item-preview">
                              {n.content.substring(0, 120)}{n.content.length > 120 ? "..." : ""}
                            </div>
                          )}
                          <div className="tv-notes-list-item-actions">
                            <button
                              className="tv-notes-list-open-btn"
                              onClick={(e) => { e.stopPropagation(); setSelectedNote(n); }}
                            >
                              <i className="fas fa-book-open"></i> Read
                            </button>
                            {!isCurrent && (
                              <button
                                className="tv-notes-list-delete"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  if (!auth.currentUser?.uid) return;
                                  try {
                                    await deleteUserNote(auth.currentUser.uid, n.videoId);
                                    setAllNotes((prev) => prev.filter((x) => x.videoId !== n.videoId));
                                  } catch {}
                                }}
                              >
                                <i className="fas fa-trash"></i> Delete
                              </button>
                            )}
                            {isCurrent && (
                              <span className="tv-notes-list-current-badge">
                                <i className="fas fa-play"></i> Now Playing
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  );
                })()}
              </div>
            )}
          </div>
        );

      case "give":
        return (
          <div className="tv-tab-pane tv-give-tab">
            {giveLoading ? (
              <div className="tv-tab-empty"><i className="fas fa-spinner fa-spin"></i><span>Loading...</span></div>
            ) : (
              <>
                {/* Amount Selection */}
                <div className="giving-section">
                  <h2 className="giving-section-title"><i className="fas fa-coins"></i> Amount</h2>
                  <div className="giving-amount-grid">
                    {[100, 500, 1000, 2000, 5000].map((amt) => (
                      <button
                        key={amt}
                        className={`giving-amount-btn${giveSelectedAmount === amt ? " selected" : ""}`}
                        onClick={() => { setGiveSelectedAmount(amt); setGiveCustomAmount(""); }}
                      >
                        KSh {amt.toLocaleString()}
                      </button>
                    ))}
                    <button
                      className={`giving-amount-btn${giveSelectedAmount === null && giveCustomAmount ? " selected" : ""}`}
                      onClick={() => { setGiveSelectedAmount(null); setGiveCustomAmount(""); }}
                    >
                      Other
                    </button>
                  </div>
                  <input
                    className="giving-custom-input"
                    type="number"
                    placeholder="Enter custom amount"
                    value={giveCustomAmount}
                    onChange={(e) => { setGiveCustomAmount(e.target.value); setGiveSelectedAmount(null); }}
                  />
                </div>

                {/* Payment Methods */}
                {giveMethods.length > 0 && (
                  <div className="giving-section">
                    <h2 className="giving-section-title"><i className="fas fa-credit-card"></i> Payment Method</h2>
                    <div className="giving-method-list">
                      {giveMethods.map((m) => (
                        <div
                          key={m.id}
                          className={`giving-method-option${giveSelectedMethod === m.id ? " selected" : ""}`}
                          onClick={() => setGiveSelectedMethod(m.id!)}
                        >
                          <div className="giving-method-icon"><i className={`fas ${m.icon}`}></i></div>
                          <div className="giving-method-info">
                            <div className="giving-method-name">{m.name}</div>
                            <div className="giving-method-type">{m.type}</div>
                          </div>
                          <div className="giving-method-check"></div>
                        </div>
                      ))}
                    </div>

                    {/* Selected method details */}
                    {(() => {
                      const m = giveMethods.find((x) => x.id === giveSelectedMethod);
                      if (!m) return null;
                      return (
                        <div className="giving-details-card">
                          <div className="giving-details-title">Payment Details</div>
                          {Object.entries(m.details).map(([k, v]) => (
                            <div className="giving-detail-row" key={k}><strong>{k}:</strong> {v}</div>
                          ))}
                          {m.instructions && <div className="giving-instructions">{m.instructions}</div>}
                        </div>
                      );
                    })()}

                    {/* Confirmation Code */}
                    <div className="giving-code-section">
                      <label className="giving-code-label">Payment Confirmation Code</label>
                      <input
                        className="giving-code-input"
                        placeholder="e.g. M-Pesa confirmation code (SJQ7T8K9L0)"
                        value={giveConfirmationCode}
                        onChange={(e) => setGiveConfirmationCode(e.target.value)}
                      />
                      <div className="giving-code-hint">Enter the confirmation code you received after making payment</div>
                    </div>

                    <button className="giving-submit-btn" disabled={giveSubmitting} onClick={handleGiveSubmit}>
                      {giveSubmitting ? (
                        <><i className="fas fa-spinner fa-spin"></i> Submitting...</>
                      ) : (
                        <><i className="fas fa-paper-plane"></i> Submit Payment</>
                      )}
                    </button>
                  </div>
                )}

                {giveMethods.length === 0 && (
                  <div className="tv-tab-empty"><i className="fas fa-circle-dollar"></i><span>No payment methods available yet</span></div>
                )}

                {/* Giving History */}
                <div className="giving-section" style={{ marginTop: 24 }}>
                  <h2 className="giving-section-title"><i className="fas fa-clock-rotate"></i> Your Giving History</h2>
                  {giveTxns.length === 0 ? (
                    <div className="tv-tab-empty"><i className="fas fa-receipt"></i><span>No giving history yet</span></div>
                  ) : (
                    giveTxns.map((tx) => (
                      <div className="giving-tx-card" key={tx.id}>
                        <div className="giving-tx-header">
                          <span className="giving-tx-amount">KSh {tx.amount.toLocaleString()}</span>
                          <span className={`giving-tx-status ${tx.status}`}>{tx.status}</span>
                        </div>
                        <div className="giving-tx-details">
                          <div>{tx.paymentMethodLabel} · {tx.confirmationCode}</div>
                          <div>{tx.createdAt ? new Date((tx.createdAt as unknown as { toMillis?: () => number })?.toMillis ? ((tx.createdAt as unknown as { toMillis: () => number }).toMillis()) : (tx.createdAt as unknown as string)).toLocaleDateString("en-KE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}</div>
                        </div>
                        {tx.adminFeedback && (
                          <div className="giving-tx-feedback"><i className="fas fa-reply"></i> <strong>Feedback:</strong> {tx.adminFeedback}</div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        );

      case "playlist":
        return (
          <div className="tv-tab-pane">
            {/* Now Playing */}
            {currentVideo && (
              <div className="tv-schedule-now">
                <div className="tv-schedule-now-label">
                  <i className="fas fa-play"></i> Now Playing
                </div>
                <div className="tv-schedule-now-title">{currentVideo.title}</div>
                {tvUserState && (
                  <div className="tv-schedule-now-playlist">
                    <i className="fas fa-list"></i> Video {tvUserState.currentIndex + 1} of {tvUserState.playlist.length}
                  </div>
                )}
              </div>
            )}

            {/* My Playlist */}
            <div className="tv-schedule-section-title">
              <i className="fas fa-list"></i> My Playlist ({playlistVideos.length} videos)
            </div>

            {playlistVideos.length === 0 ? (
              <div className="tv-tab-empty">
                <i className="fas fa-list"></i>
                <span>Your playlist is empty. Browse the channel videos below and tap + to add them.</span>
              </div>
            ) : (
              <div className="tv-playlist-videos">
                {tvUserState?.playlist.map((videoId, idx) => {
                  const vid = videos.find((v) => v.id === videoId);
                  if (!vid) return null;
                  const isActive = idx === tvUserState.currentIndex;
                  return (
                    <div key={videoId} className={`tv-pl-video ${isActive ? "active" : ""}`}>
                      <div className="tv-pl-video-num">{idx + 1}</div>
                      <div className="tv-pl-video-thumb">
                        <img src={vid.thumbnail || `https://i.ytimg.com/vi/${vid.id}/default.jpg`} alt="" />
                      </div>
                      <div className="tv-pl-video-info">
                        <div className="tv-pl-video-title">{vid.title}</div>
                        <div className="tv-pl-video-meta">{formatTime(vid.duration)}</div>
                      </div>
                      <button
                        className="tv-pl-remove-btn"
                        onClick={() => handleRemoveFromPlaylist(videoId)}
                        disabled={removingFromPlaylist === videoId}
                      >
                        {removingFromPlaylist === videoId ? (
                          <i className="fas fa-spinner fa-spin"></i>
                        ) : (
                          <i className="fas fa-trash"></i>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* All available channel videos (paginated) */}
            <div className="tv-schedule-section-title" style={{ marginTop: 16 }}>
              <i className="fas fa-video"></i> All Channel Videos {allPaginatedVideos.length > 0 ? `(${allPaginatedVideos.length} loaded)` : ""}
            </div>
            {allPaginatedVideos.length === 0 ? (
              allVideosLoading ? (
                <>
                  <div className="tv-skeleton-title"></div>
                  <div className="tv-skeleton-list">
                    {[1,2,3,4,5].map((i) => (
                      <div key={i} className="tv-skeleton-card">
                        <div className="tv-skeleton-thumb"></div>
                        <div className="tv-skeleton-line"></div>
                        <div className="tv-skeleton-line short"></div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="tv-tab-empty" style={{ padding: "20px 16px" }}>
                  <i className="fas fa-search"></i>
                  <span>No videos available. Videos are synced from your YouTube channel.</span>
                </div>
              )
            ) : (
              <>
                <div className="tv-pl-all-videos">
                  {allPaginatedVideos.map((vid) => {
                    const inPlaylist = playlistVideoIds.has(vid.id);
                    return (
                      <div key={vid.id} className={`tv-pl-all-item ${inPlaylist ? "added" : ""}`}>
                        <div className="tv-pl-all-thumb">
                          <img src={vid.thumbnail || `https://i.ytimg.com/vi/${vid.id}/default.jpg`} alt="" />
                        </div>
                        <div className="tv-pl-all-info">
                          <div className="tv-pl-all-title">{vid.title}</div>
                          <div className="tv-pl-all-meta">{formatTime(vid.duration)}</div>
                        </div>
                        {inPlaylist ? (
                          <button
                            className="tv-pl-remove-btn"
                            onClick={() => handleRemoveFromPlaylist(vid.id)}
                            disabled={removingFromPlaylist === vid.id}
                          >
                            {removingFromPlaylist === vid.id ? (
                              <i className="fas fa-spinner fa-spin"></i>
                            ) : (
                              <i className="fas fa-minus-circle"></i>
                            )}
                          </button>
                        ) : (
                          <button
                            className="tv-pl-add-btn"
                            onClick={() => handleAddToPlaylist(vid.id)}
                            disabled={addingToPlaylist === vid.id}
                          >
                            {addingToPlaylist === vid.id ? (
                              <i className="fas fa-spinner fa-spin"></i>
                            ) : (
                              <i className="fas fa-plus-circle"></i>
                            )}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
                {/* Load More button */}
                {allVideosHasMore && (
                  <button
                    className="tv-pl-load-more"
                    onClick={loadMoreVideos}
                    disabled={allVideosLoading}
                  >
                    {allVideosLoading ? (
                      <><i className="fas fa-spinner fa-spin"></i> Loading...</>
                    ) : (
                      <><i className="fas fa-chevron-down"></i> Load More</>
                    )}
                  </button>
                )}
              </>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <>
      <style>{`
        :root {
          --primary: #E8A838; --primary-light: #F5C76B;
          --bg: #0F0F0F; --surface: #1A1A1A;
          --surface-elevated: #242424; --surface-card: #1E1E1E;
          --text-primary: #FFFFFF; --text-secondary: #A0A0A0; --text-tertiary: #6B6B6B;
          --border: #2A2A2A; --success: #22C55E;
          --gradient-start: #E8A838; --gradient-end: #D4762A;
          --radius-sm: 8px; --radius-md: 12px; --radius-lg: 16px; --radius-xl: 20px;
        }
        * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; }
        html, body { height: 100%; overflow: hidden; background: var(--bg); color: var(--text-primary); }

        .tv-page { height: 100%; display: flex; flex-direction: column; overflow: hidden; }

        /* ─── TOP HEADER BAR ─── */
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
          width: 44px; height: 44px; border-radius: 50%;
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.06);
          color: var(--text-secondary); font-size: 16px;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; flex-shrink: 0; transition: all 0.2s ease;
        }
        .tv-top-header-btn:active { background: rgba(255,255,255,0.12); transform: scale(0.9); }

        /* ─── PLAYER SECTION ─── */
        .tv-player-section {
          position: sticky; top: 0; z-index: 20;
          background: #000; flex-shrink: 0;
        }
        /* Push player section below the top header */
        .tv-top-header + .tv-player-section { top: 0; }
        .tv-player-outer {
          position: relative;
          width: 100%;
          aspect-ratio: 16 / 9;
          max-height: 70vh;
          background: #000;
          overflow: hidden;
        }
        @media (max-width: 480px) {
          .tv-player-outer { max-height: 60vh; min-height: 240px; }
        }
        .tv-player-outer .plyr { width: 100%; height: 100%; }
        .tv-player-outer .plyr__video-wrapper { height: 100%; }
        .tv-player-outer .plyr__video-embed { aspect-ratio: auto !important; }
        .tv-player-outer .plyr__video-embed,
        .tv-player-outer iframe { width: 100% !important; height: 100% !important; }
        .tv-player-outer .plyr__video-embed iframe { object-fit: cover; }
        @media (max-width: 480px) {
          .tv-player-outer .plyr__controls { padding: 8px 4px !important; }
          .tv-player-outer .plyr__control { padding: 10px 8px !important; min-width: 40px; min-height: 40px; }
          .tv-player-outer .plyr__control svg { width: 20px; height: 20px; }
          .tv-player-outer .plyr__progress__container { flex: 1; }
          .tv-player-outer .plyr__time { font-size: 12px; }
        }

        /* ─── PLACEHOLDER / LOADING ─── */
        .tv-player-placeholder {
          width: 100%; height: 100%;
          display: flex; flex-direction: column;
          align-items: center; justify-content: center; gap: 12px;
          background: radial-gradient(ellipse at 50% 50%, rgba(232,168,56,0.04) 0%, transparent 70%);
        }
        .tv-player-placeholder i { font-size: 36px; color: var(--primary); opacity: 0.5; }
        .tv-player-placeholder p { font-size: 13px; color: var(--text-tertiary); }

        /* ─── BROADCAST / SHUFFLE OVERLAYS ─── */
        .tv-broadcast-badge {
          position: absolute; top: 48px; left: 50%; transform: translateX(-50%);
          z-index: 12; padding: 5px 14px;
          background: rgba(74,222,128,0.12);
          border: 1px solid rgba(74,222,128,0.2);
          border-radius: 10px;
          display: flex; align-items: center; gap: 6px;
          font-size: 11px; font-weight: 600;
          color: #4ADE80;
          backdrop-filter: blur(8px);
          animation: tvBadgeIn 0.3s ease;
          white-space: nowrap; max-width: 80%; overflow: hidden;
          pointer-events: none;
        }
        @keyframes tvBadgeIn {
          from { opacity: 0; transform: translateX(-50%) translateY(-8px); }
          to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        .tv-shuffle-badge {
          position: absolute; bottom: 10px; right: 10px;
          z-index: 10; padding: 3px 8px;
          background: rgba(0,0,0,0.6);
          border-radius: 6px;
          display: flex; align-items: center; gap: 4px;
          font-size: 9px; font-weight: 600;
          color: var(--text-tertiary);
          pointer-events: none;
          backdrop-filter: blur(4px);
        }
        .tv-shuffle-badge i { font-size: 8px; }

        /* ─── TAB BAR ─── */
        .tv-tab-bar {
          display: flex; flex-shrink: 0;
          background: var(--surface);
          border-bottom: 1px solid var(--border);
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
        }
        .tv-tab-bar::-webkit-scrollbar { display: none; }
        .tv-tab-btn {
          flex: 1; min-width: 60px;
          display: flex; flex-direction: column; align-items: center; gap: 3px;
          padding: 10px 6px;
          background: none; border: none;
          color: var(--text-tertiary);
          font-size: 10px; font-weight: 600;
          cursor: pointer; position: relative;
          transition: all 0.2s ease;
        }
        .tv-tab-btn i { font-size: 16px; transition: transform 0.2s ease; }
        .tv-tab-btn:active i { transform: scale(0.85); }
        .tv-tab-btn.active { color: var(--primary); }
        .tv-tab-btn.active::after {
          content: ''; position: absolute; bottom: 0; left: 20%; right: 20%;
          height: 2px; background: var(--primary);
          border-radius: 1px 1px 0 0;
        }

        /* ─── TAB CONTENT AREA ─── */
        .tv-tab-content {
          flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch;
          background: var(--bg);
          padding-bottom: 80px;
        }
        .tv-tab-content::-webkit-scrollbar { display: none; }
        .tv-tab-pane { padding: 12px; }

        /* ─── CHAT ─── */
        .tv-tab-pane.chat-pane {
          display: flex; flex-direction: column;
          height: 100%; min-height: 0;
          padding-bottom: 0;
        }
        .tv-chat-messages {
          display: flex; flex-direction: column; gap: 8px;
          flex: 1; overflow-y: auto;
          padding: 4px 16px;
        }
        .tv-chat-messages::-webkit-scrollbar { display: none; }
        .tv-chat-empty {
          display: flex; flex-direction: column; align-items: center; gap: 8px;
          padding: 40px 20px; text-align: center;
          color: var(--text-tertiary); font-size: 13px;
        }
        .tv-chat-empty i { font-size: 36px; opacity: 0.3; }
        .tv-chat-msg {
          padding: 10px 12px;
          background: var(--surface-card);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          transition: all 0.15s;
          max-width: 90%;
        }
        .tv-chat-msg.own {
          align-self: flex-end;
          background: linear-gradient(135deg, rgba(232,168,56,0.08), rgba(232,168,56,0.02));
          border-color: rgba(232,168,56,0.15);
        }
        .tv-chat-msg-header {
          display: flex; align-items: center; gap: 8px; margin-bottom: 4px;
        }
        .tv-chat-msg-name { font-size: 12px; font-weight: 700; color: var(--primary); }
        .tv-chat-msg-time { font-size: 10px; color: var(--text-tertiary); margin-left: auto; }
        .tv-chat-msg-text { font-size: 13px; line-height: 1.5; word-break: break-word; }

        .tv-chat-input-bar {
          display: flex; gap: 8px; align-items: center;
          flex-shrink: 0;
          background: var(--bg);
          padding: 12px 16px calc(12px + env(safe-area-inset-bottom, 0px));
          border-top: 1px solid var(--border);
        }
        .tv-chat-input {
          flex: 1; padding: 12px 16px;
          background: var(--surface); border: 1.5px solid var(--border);
          border-radius: var(--radius-lg); color: var(--text-primary);
          font-size: 14px; outline: none; transition: all 0.2s;
        }
        .tv-chat-input:focus { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(232,168,56,0.08); }
        .tv-chat-input::placeholder { color: var(--text-tertiary); }
        .tv-chat-send {
          width: 44px; height: 44px; border-radius: 50%;
          background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end));
          border: none; color: #fff; font-size: 16px;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; flex-shrink: 0; transition: all 0.2s;
        }
        .tv-chat-send:active { transform: scale(0.9); }
        .tv-chat-send:disabled { opacity: 0.5; transform: none; cursor: not-allowed; }

        /* ─── PRAYER ─── */
        .tv-prayer-intro {
          text-align: center; padding: 16px 8px 20px;
          display: flex; flex-direction: column; align-items: center; gap: 10px;
        }
        .tv-prayer-intro i { font-size: 40px; color: var(--primary); opacity: 0.6; }
        .tv-prayer-intro p { font-size: 13px; color: var(--text-secondary); line-height: 1.6; max-width: 320px; }

        .tv-prayer-form {
          display: flex; flex-direction: column; gap: 10px;
          background: var(--surface-card);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 16px; margin-bottom: 16px;
        }
        .tv-prayer-input, .tv-prayer-textarea {
          width: 100%; padding: 12px 14px;
          background: var(--surface); border: 1.5px solid var(--border);
          border-radius: var(--radius-sm); color: var(--text-primary);
          font-size: 14px; outline: none; font-family: inherit; resize: vertical; transition: all 0.2s;
        }
        .tv-prayer-input:focus, .tv-prayer-textarea:focus { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(232,168,56,0.08); }
        .tv-prayer-input::placeholder, .tv-prayer-textarea::placeholder { color: var(--text-tertiary); }
        .tv-prayer-submit {
          width: 100%; padding: 14px;
          border-radius: var(--radius-sm); font-size: 14px; font-weight: 700;
          border: none; cursor: pointer; transition: all 0.2s;
          background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end));
          color: #fff; display: flex; align-items: center; justify-content: center; gap: 8px;
        }
        .tv-prayer-submit:active { transform: scale(0.97); }
        .tv-prayer-submit:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }

        .tv-prayer-section-title {
          font-size: 14px; font-weight: 700; margin-bottom: 10px;
          display: flex; align-items: center; gap: 6px;
        }
        .tv-prayer-section-title i { color: var(--primary); font-size: 13px; }
        .tv-prayer-list { display: flex; flex-direction: column; gap: 8px; }
        .tv-prayer-item {
          padding: 12px 14px;
          background: var(--surface-card);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
        }
        .tv-prayer-item-header {
          display: flex; align-items: center; gap: 8px; margin-bottom: 6px;
        }
        .tv-prayer-item-name { font-size: 12px; font-weight: 600; display: flex; align-items: center; gap: 4px; }
        .tv-prayer-item-name i { color: var(--primary); font-size: 10px; }
        .tv-prayer-item-time { font-size: 10px; color: var(--text-tertiary); margin-left: auto; }
        .tv-prayer-item-text { font-size: 13px; color: var(--text-secondary); line-height: 1.5; }

        /* ─── Prayer reply (admin response) ─── */
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

        /* ─── NOTES ─── */
        .tv-notes-sub-tabs {
          display: flex; gap: 4px; margin-bottom: 14px;
          background: var(--surface); border-radius: 12px; padding: 3px;
        }
        .tv-notes-sub-tab {
          flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px;
          padding: 10px 12px; border-radius: 10px; font-size: 12px; font-weight: 600;
          background: none; border: none; color: var(--text-tertiary); cursor: pointer;
          transition: all 0.2s ease;
        }
        .tv-notes-sub-tab i { font-size: 12px; }
        .tv-notes-sub-tab.active { background: var(--surface-elevated); color: var(--primary); }
        .tv-notes-sub-tab:active:not(.active) { transform: scale(0.95); }

        .tv-notes-current {
          padding: 14px;
          background: var(--surface-card);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          margin-bottom: 14px;
        }
        .tv-notes-current-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-tertiary); margin-bottom: 6px; }
        .tv-notes-current-title { font-size: 16px; font-weight: 700; }
        .tv-notes-current-desc { font-size: 12px; color: var(--text-secondary); margin-top: 6px; line-height: 1.5; max-height: 60px; overflow-y: auto; }
        .tv-notes-current-playlist { font-size: 11px; color: var(--primary); margin-top: 8px; display: flex; align-items: center; gap: 4px; }

        .tv-notes-section-title {
          font-size: 14px; font-weight: 700; margin-bottom: 10px;
          display: flex; align-items: center; gap: 6px;
        }
        .tv-notes-section-title i { color: var(--primary); font-size: 13px; }

        .tv-notes-toolbar-right {
          margin-left: auto;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .tv-notes-saving { font-size: 12px; color: var(--text-tertiary); display: flex; align-items: center; gap: 4px; }
        .tv-notes-preview-btn {
          padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 600;
          background: var(--surface); border: 1px solid var(--border);
          color: var(--text-tertiary); cursor: pointer;
          display: flex; align-items: center; gap: 4px;
          transition: all 0.2s;
        }
        .tv-notes-preview-btn:active { transform: scale(0.92); }
        .tv-notes-preview-btn.active {
          background: rgba(232,168,56,0.1); border-color: rgba(232,168,56,0.2); color: var(--primary);
        }

        /* ─── Notes formatting toolbar ─── */
        .tv-notes-toolbar {
          display: flex; align-items: center; gap: 4px;
          padding: 8px 12px;
          background: var(--surface-card);
          border: 1px solid var(--border);
          border-radius: var(--radius-md) var(--radius-md) 0 0;
          border-bottom: none;
          flex-wrap: wrap;
        }
        .tv-notes-tb-btn {
          width: 32px; height: 32px; border-radius: 6px;
          background: none; border: none;
          color: var(--text-secondary); font-size: 13px;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; transition: all 0.15s;
        }
        .tv-notes-tb-btn:hover { background: var(--surface-elevated); color: var(--text-primary); }
        .tv-notes-tb-btn:active { transform: scale(0.9); }
        .tv-notes-tb-divider {
          width: 1px; height: 20px;
          background: var(--border);
          margin: 0 2px;
        }

        /* ─── Notes preview ─── */
        .tv-notes-preview {
          padding: 14px;
          background: var(--surface);
          border: 1.5px solid var(--border);
          border-radius: 0 0 var(--radius-md) var(--radius-md);
          color: var(--text-primary);
          font-size: 14px; line-height: 1.7;
          min-height: 200px;
          overflow-y: auto;
          word-break: break-word;
        }
        .tv-notes-preview p { margin-bottom: 8px; }
        .tv-notes-preview strong { color: var(--text-primary); font-weight: 700; }
        .tv-notes-preview em { color: var(--primary-light); }
        .tv-md-h3 { font-size: 16px; font-weight: 700; margin: 12px 0 6px; color: var(--primary); }
        .tv-md-h4 { font-size: 14px; font-weight: 700; margin: 10px 0 4px; color: var(--primary-light); }
        .tv-md-code {
          padding: 2px 6px; border-radius: 4px;
          background: var(--surface-elevated);
          font-family: 'SF Mono', 'Monaco', 'Cascadia Code', monospace;
          font-size: 13px;
          color: var(--primary-light);
        }
        .tv-md-link { color: var(--primary); text-decoration: underline; text-underline-offset: 2px; }
        .tv-md-ul { margin: 6px 0; padding-left: 20px; }
        .tv-md-ul li { margin-bottom: 4px; }
        .tv-md-ol { margin: 6px 0; padding-left: 20px; }
        .tv-md-ol li { margin-bottom: 4px; }

        .tv-notes-textarea {
          width: 100%; padding: 14px;
          background: var(--surface); border: 1.5px solid var(--border);
          border-radius: 0 0 var(--radius-md) var(--radius-md);
          color: var(--text-primary);
          font-size: 14px; line-height: 1.6; font-family: inherit;
          resize: vertical; outline: none; transition: all 0.2s;
          min-height: 200px;
        }
        .tv-notes-textarea:focus { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(232,168,56,0.08); }
        .tv-notes-textarea::placeholder { color: var(--text-tertiary); }
        .tv-notes-hint { font-size: 11px; color: var(--text-tertiary); margin-top: 8px; display: flex; align-items: center; gap: 4px; }
        .tv-notes-hint i { font-size: 10px; }

        /* ─── Save to Library bottom button ─── */
        .tv-notes-save-bottom {
          width: 100%; padding: 14px; margin-top: 14px;
          border-radius: var(--radius-md); font-size: 14px; font-weight: 700;
          background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end));
          border: none; color: #fff; cursor: pointer;
          display: flex; align-items: center; justify-content: center; gap: 8px;
          transition: all 0.2s ease;
        }
        .tv-notes-save-bottom:active { transform: scale(0.97); }
        .tv-notes-save-bottom:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }

        /* ─── Notes library ─── */
        .tv-notes-export-btn {
          width: 28px; height: 28px; border-radius: 6px;
          background: var(--surface); border: 1px solid var(--border);
          color: var(--text-tertiary); font-size: 11px;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; transition: all 0.15s;
        }
        .tv-notes-export-btn:active { transform: scale(0.9); }
        .tv-notes-export-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .tv-notes-refresh-btn {
          margin-left: auto;
          width: 28px; height: 28px; border-radius: 6px;
          background: var(--surface); border: 1px solid var(--border);
          color: var(--text-tertiary); font-size: 11px;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; transition: all 0.15s;
        }
        .tv-notes-refresh-btn:active { transform: scale(0.9); }
        .tv-notes-refresh-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        /* ─── Saved notes search bar ─── */
        .tv-notes-search-wrap {
          position: relative; margin-bottom: 12px;
        }
        .tv-notes-search-icon {
          position: absolute; left: 14px; top: 50%; transform: translateY(-50%);
          font-size: 13px; color: var(--text-tertiary); pointer-events: none;
        }
        .tv-notes-search-input {
          width: 100%; padding: 12px 36px 12px 40px;
          background: var(--surface); border: 1px solid var(--border);
          border-radius: 10px; color: var(--text-primary); font-size: 14px;
          outline: none; transition: all 0.2s;
        }
        .tv-notes-search-input:focus { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(232,168,56,0.08); }
        .tv-notes-search-input::placeholder { color: var(--text-tertiary); }
        .tv-notes-search-clear {
          position: absolute; right: 10px; top: 50%; transform: translateY(-50%);
          width: 24px; height: 24px; border-radius: 6px;
          background: var(--surface-elevated); border: none; color: var(--text-secondary); font-size: 11px;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; transition: all 0.15s;
        }
        .tv-notes-search-clear:active { transform: translateY(-50%) scale(0.85); }

        .tv-notes-empty {
          display: flex; flex-direction: column; align-items: center; gap: 8px;
          padding: 24px 16px; text-align: center;
          color: var(--text-tertiary); font-size: 13px;
        }
        .tv-notes-empty i { font-size: 28px; opacity: 0.3; }
        .tv-notes-list { display: flex; flex-direction: column; gap: 6px; }
        .tv-notes-list-item {
          padding: 12px 14px;
          background: var(--surface-card);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          transition: all 0.15s;
          cursor: pointer;
        }
        .tv-notes-list-item:active { transform: scale(0.97); background: var(--surface); }
        .tv-notes-list-item.active {
          border-color: rgba(232,168,56,0.2);
          background: rgba(232,168,56,0.04);
        }
        .tv-notes-list-item-top {
          display: flex; align-items: flex-start; justify-content: space-between; gap: 8px;
        }
        .tv-notes-list-item-title {
          font-size: 13px; font-weight: 700;
          display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
        }
        .tv-notes-list-item-date {
          font-size: 10px; color: var(--text-tertiary);
          white-space: nowrap; flex-shrink: 0;
        }
        .tv-notes-list-item-preview {
          font-size: 12px; color: var(--text-secondary);
          margin-top: 4px; line-height: 1.5;
          display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
        }
        .tv-notes-list-item-actions {
          margin-top: 8px;
          display: flex; align-items: center; gap: 8px;
        }
        .tv-notes-list-delete {
          padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 600;
          background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.1);
          color: #EF4444; cursor: pointer;
          display: flex; align-items: center; gap: 4px;
          transition: all 0.15s;
        }
        .tv-notes-list-delete:active { transform: scale(0.95); }
        .tv-notes-list-current-badge {
          font-size: 10px; font-weight: 700; color: var(--primary);
          display: flex; align-items: center; gap: 4px;
        }
        .tv-notes-list-open-btn {
          padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 600;
          background: rgba(232,168,56,0.08); border: 1px solid rgba(232,168,56,0.12);
          color: var(--primary); cursor: pointer;
          display: flex; align-items: center; gap: 4px;
          transition: all 0.15s;
        }
        .tv-notes-list-open-btn:active { transform: scale(0.95); }
        .tv-notes-saved-section { margin-top: 0; }

        /* ─── Note Reader Modal ─── */
        .tv-reader-overlay {
          position: fixed; inset: 0; z-index: 900;
          background: rgba(0,0,0,0.85);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          display: flex; flex-direction: column;
          animation: tvReaderIn 0.25s ease;
        }
        @keyframes tvReaderIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .tv-reader-top {
          display: flex; align-items: center; gap: 8px;
          padding: 12px 16px;
          background: var(--bg);
          border-bottom: 1px solid var(--border);
        }
        .tv-reader-back {
          width: 40px; height: 40px; border-radius: 50%;
          background: rgba(255,255,255,0.06); border: none;
          color: var(--text-secondary); font-size: 16px;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; transition: all 0.15s;
        }
        .tv-reader-back:active { background: rgba(255,255,255,0.12); transform: scale(0.9); }
        .tv-reader-title {
          flex: 1; font-size: 15px; font-weight: 700; color: var(--text-primary);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .tv-reader-edit-btn {
          padding: 6px 12px; border-radius: 8px; font-size: 11px; font-weight: 600;
          background: rgba(232,168,56,0.08); border: 1px solid rgba(232,168,56,0.12);
          color: var(--primary); cursor: pointer;
          display: flex; align-items: center; gap: 4px;
          transition: all 0.15s;
        }
        .tv-reader-edit-btn:active { transform: scale(0.95); }
        .tv-reader-delete-btn {
          padding: 6px 12px; border-radius: 8px; font-size: 11px; font-weight: 600;
          background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.12);
          color: #EF4444; cursor: pointer;
          display: flex; align-items: center; gap: 4px;
          transition: all 0.15s;
        }
        .tv-reader-delete-btn:active { transform: scale(0.95); }
        .tv-reader-body {
          flex: 1; overflow-y: auto;
          -webkit-overflow-scrolling: touch;
          padding: 20px 16px;
        }
        .tv-reader-body::-webkit-scrollbar { display: none; }
        .tv-reader-meta {
          display: flex; align-items: center; gap: 10px;
          font-size: 11px; color: var(--text-tertiary);
          margin-bottom: 16px; flex-wrap: wrap;
        }
        .tv-reader-content {
          color: var(--text-primary); font-size: 15px; line-height: 1.7;
        }
        .tv-reader-content p { margin-bottom: 10px; }
        .tv-reader-content strong { color: var(--text-primary); font-weight: 700; }
        .tv-reader-content em { color: var(--primary-light); }
        .tv-reader-content h3 { font-size: 17px; font-weight: 700; margin: 16px 0 8px; color: var(--primary); }
        .tv-reader-content h4 { font-size: 15px; font-weight: 700; margin: 14px 0 6px; color: var(--primary-light); }
        .tv-reader-content ul, .tv-reader-content ol { margin: 8px 0; padding-left: 20px; }
        .tv-reader-content li { margin-bottom: 4px; }
        .tv-reader-content a { color: var(--primary); text-decoration: underline; text-underline-offset: 2px; }
        .tv-reader-content code {
          padding: 2px 6px; border-radius: 4px;
          background: var(--surface-elevated);
          font-family: 'SF Mono', 'Monaco', 'Cascadia Code', monospace;
          font-size: 14px;
          color: var(--primary-light);
        }
        .tv-reader-empty {
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: 12px; padding: 60px 20px; color: var(--text-tertiary); text-align: center;
        }
        .tv-reader-empty i { font-size: 40px; opacity: 0.3; }

        /* ─── GIVE TAB ─── */
        .tv-give-tab { padding: 0 4px; }
        .giving-section { margin-bottom: 20px; }
        .giving-section-title { font-size: 15px; font-weight: 700; margin-bottom: 10px; display: flex; align-items: center; gap: 8px; }
        .giving-section-title i { color: var(--primary); font-size: 14px; }

        .giving-amount-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 6px; }
        .giving-amount-btn {
          padding: 12px 8px; border-radius: 10px; font-size: 15px; font-weight: 800;
          background: var(--surface-card); border: 1.5px solid var(--border);
          color: var(--text-primary); cursor: pointer; transition: all 0.15s ease;
        }
        .giving-amount-btn.selected { border-color: var(--primary); background: rgba(232,168,56,0.1); color: var(--primary); }
        .giving-amount-btn:active { transform: scale(0.95); }

        .giving-custom-input {
          width: 100%; padding: 12px; border-radius: 10px; font-size: 15px; font-weight: 700;
          background: var(--surface-elevated); border: 1px solid var(--border);
          color: var(--text-primary); text-align: center; margin-top: 6px;
        }
        .giving-custom-input:focus { border-color: var(--primary); outline: none; }

        .giving-method-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px; }
        .giving-method-option {
          display: flex; align-items: center; gap: 10px;
          padding: 12px; border-radius: 10px;
          background: var(--surface-card); border: 1.5px solid var(--border);
          cursor: pointer; transition: all 0.15s ease;
        }
        .giving-method-option.selected { border-color: var(--primary); background: rgba(232,168,56,0.05); }
        .giving-method-option:active { transform: scale(0.97); }
        .giving-method-icon {
          width: 36px; height: 36px; border-radius: 10px;
          background: rgba(232,168,56,0.1); color: var(--primary);
          display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0;
        }
        .giving-method-info { flex: 1; min-width: 0; }
        .giving-method-name { font-size: 14px; font-weight: 700; }
        .giving-method-type { font-size: 11px; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.2px; }
        .giving-method-check {
          width: 20px; height: 20px; border-radius: 50%;
          border: 2px solid var(--border); flex-shrink: 0; display: flex; align-items: center; justify-content: center;
        }
        .giving-method-option.selected .giving-method-check { border-color: var(--primary); background: var(--primary); }
        .giving-method-option.selected .giving-method-check::after { content: "\\f00c"; font-family: "Font Awesome 6 Free"; font-weight: 900; color: #fff; font-size: 10px; }

        .giving-details-card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 12px; margin-bottom: 12px; }
        .giving-details-title { font-size: 11px; font-weight: 600; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 6px; }
        .giving-detail-row { font-size: 13px; line-height: 1.6; }
        .giving-detail-row strong { color: var(--text-primary); }
        .giving-instructions { font-size: 12px; color: var(--text-secondary); margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border); white-space: pre-line; }

        .giving-code-section { margin-bottom: 14px; }
        .giving-code-label { display: block; font-size: 12px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 6px; }
        .giving-code-input {
          width: 100%; padding: 12px; border-radius: 10px; font-size: 14px; font-weight: 600;
          background: var(--surface-elevated); border: 1px solid var(--border);
          color: var(--text-primary);
        }
        .giving-code-input:focus { border-color: var(--primary); outline: none; }
        .giving-code-hint { font-size: 11px; color: var(--text-tertiary); margin-top: 4px; }

        .giving-submit-btn {
          width: 100%; padding: 14px; border-radius: 12px; font-size: 15px; font-weight: 700;
          background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end));
          border: none; color: #fff; cursor: pointer; transition: all 0.15s ease;
          display: flex; align-items: center; justify-content: center; gap: 8px;
        }
        .giving-submit-btn:active { transform: scale(0.97); }
        .giving-submit-btn:disabled { opacity: 0.6; cursor: not-allowed; }

        .giving-tx-card { background: var(--surface-card); border: 1px solid var(--border); border-radius: 10px; padding: 12px; margin-bottom: 8px; }
        .giving-tx-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
        .giving-tx-amount { font-size: 17px; font-weight: 800; color: var(--primary); }
        .giving-tx-status { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px; padding: 2px 8px; border-radius: 6px; }
        .giving-tx-status.pending { background: rgba(245,158,11,0.12); color: var(--warning); }
        .giving-tx-status.confirmed { background: rgba(34,197,94,0.12); color: var(--success); }
        .giving-tx-status.rejected { background: rgba(239,68,68,0.12); color: var(--error); }
        .giving-tx-details { font-size: 12px; color: var(--text-secondary); line-height: 1.5; }
        .giving-tx-feedback { font-size: 12px; color: var(--text-secondary); margin-top: 6px; padding: 6px 10px; background: var(--surface); border-radius: 6px; font-style: italic; }
        .giving-tx-feedback strong { color: var(--primary); font-style: normal; }

        /* ─── Shimmer skeleton ─── */
        @keyframes tvShimmer {
          0% { background-position: -200px 0; }
          100% { background-position: 200px 0; }
        }
        .tv-skeleton-title {
          width: 140px; height: 14px; border-radius: 6px;
          background: linear-gradient(90deg, #1A1A1A 25%, #2A2A2A 50%, #1A1A1A 75%);
          background-size: 400px 100%;
          animation: tvShimmer 1.4s ease-in-out infinite;
          margin-bottom: 14px;
        }
        .tv-skeleton-list { display: flex; flex-direction: column; gap: 8px; }
        .tv-skeleton-card {
          display: flex; align-items: center; gap: 10px;
          padding: 10px 12px;
          background: #1A1A1A;
          border: 1px solid #2A2A2A;
          border-radius: 8px;
          height: 54px;
        }
        .tv-skeleton-thumb {
          width: 40px; height: 30px; border-radius: 4px; flex-shrink: 0;
          background: linear-gradient(90deg, #242424 25%, #333 50%, #242424 75%);
          background-size: 400px 100%;
          animation: tvShimmer 1.4s ease-in-out infinite;
        }
        .tv-skeleton-line {
          flex: 1; height: 12px; border-radius: 6px;
          background: linear-gradient(90deg, #242424 25%, #333 50%, #242424 75%);
          background-size: 400px 100%;
          animation: tvShimmer 1.4s ease-in-out infinite;
        }
        .tv-skeleton-line.short { max-width: 60px; }
        .tv-skeleton-load-more {
          width: 100%; height: 40px; border-radius: 10px; margin-top: 12px;
          background: linear-gradient(90deg, #1A1A1A 25%, #2A2A2A 50%, #1A1A1A 75%);
          background-size: 400px 100%;
          animation: tvShimmer 1.4s ease-in-out infinite;
        }

        /* ─── SCHEDULE ─── */
        .tv-schedule-header {
          display: flex; align-items: center; justify-content: space-between;
          margin-bottom: 14px;
        }
        .tv-schedule-channel { font-size: 14px; font-weight: 700; display: flex; align-items: center; gap: 6px; }
        .tv-schedule-channel i { color: var(--primary); font-size: 13px; }
        .tv-schedule-mode-badge {
          font-size: 10px; font-weight: 600; padding: 4px 10px; border-radius: 20px;
          background: var(--surface); border: 1px solid var(--border);
          display: flex; align-items: center; gap: 4px;
        }
        .tv-schedule-mode-badge i { font-size: 9px; color: var(--primary); }

        .tv-schedule-now {
          padding: 14px;
          background: linear-gradient(135deg, rgba(232,168,56,0.06), rgba(232,168,56,0.02));
          border: 1px solid rgba(232,168,56,0.12);
          border-radius: var(--radius-lg);
          margin-bottom: 14px;
        }
        .tv-schedule-now-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--primary); margin-bottom: 4px; display: flex; align-items: center; gap: 4px; }
        .tv-schedule-now-label i { font-size: 9px; }
        .tv-schedule-now-title { font-size: 15px; font-weight: 700; }
        .tv-schedule-now-playlist { font-size: 12px; color: var(--text-secondary); margin-top: 4px; display: flex; align-items: center; gap: 4px; }
        .tv-schedule-now-playlist i { font-size: 10px; }

        .tv-schedule-section-title {
          font-size: 13px; font-weight: 700; margin-bottom: 10px;
          display: flex; align-items: center; gap: 6px;
        }
        .tv-schedule-section-title i { color: var(--primary); font-size: 12px; }
        .tv-schedule-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
        .tv-schedule-slot {
          display: flex; align-items: center; gap: 10px;
          padding: 10px 12px;
          background: var(--surface-card);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          transition: all 0.2s;
        }
        .tv-schedule-slot.active {
          border-color: rgba(74,222,128,0.2);
          background: rgba(74,222,128,0.06);
        }
        .tv-schedule-slot-time {
          display: flex; align-items: center; gap: 6px;
          font-size: 12px; font-weight: 700; color: var(--text-secondary);
          min-width: 50px;
        }
        .tv-schedule-slot-time .tv-schedule-live-dot {
          width: 8px; height: 8px; border-radius: 50%;
          background: var(--success);
          animation: livePulse 1.5s ease-in-out infinite;
        }
        .tv-schedule-slot-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--text-tertiary); }
        .tv-schedule-slot-info { flex: 1; min-width: 0; }
        .tv-schedule-slot-name { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .tv-schedule-slot-duration { font-size: 11px; color: var(--text-tertiary); margin-top: 2px; }
        .tv-schedule-active-badge {
          font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px;
          padding: 3px 8px; border-radius: 6px;
          background: rgba(74,222,128,0.12); color: var(--success);
        }
        .tv-schedule-footer {
          font-size: 12px; color: var(--text-tertiary);
          display: flex; align-items: center; gap: 6px;
          padding: 10px 0;
        }
        .tv-schedule-footer i { font-size: 10px; }

        /* ─── PLAYLIST TAB ─── */
        .tv-playlist-videos { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
        .tv-pl-video {
          display: flex; align-items: center; gap: 10px;
          padding: 8px 10px;
          background: var(--surface-card);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          transition: all 0.2s;
        }
        .tv-pl-video.active {
          border-color: rgba(232,168,56,0.2);
          background: rgba(232,168,56,0.06);
        }
        .tv-pl-video-num {
          width: 22px; height: 22px;
          border-radius: 50%;
          background: var(--surface-elevated);
          display: flex; align-items: center; justify-content: center;
          font-size: 10px; font-weight: 700; color: var(--text-tertiary);
          flex-shrink: 0;
        }
        .tv-pl-video.active .tv-pl-video-num {
          background: var(--primary); color: #fff;
        }
        .tv-pl-video-thumb {
          width: 48px; height: 27px; border-radius: 4px;
          overflow: hidden; flex-shrink: 0; background: var(--surface-elevated);
        }
        .tv-pl-video-thumb img { width: 100%; height: 100%; object-fit: cover; }
        .tv-pl-video-info { flex: 1; min-width: 0; }
        .tv-pl-video-title { font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .tv-pl-video-meta { font-size: 10px; color: var(--text-tertiary); margin-top: 1px; }
        .tv-pl-remove-btn {
          width: 28px; height: 28px; border-radius: 6px;
          background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.1);
          color: var(--error); font-size: 12px; cursor: pointer; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
          transition: all 0.15s;
        }
        .tv-pl-remove-btn:active { transform: scale(0.9); }
        .tv-pl-remove-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .tv-pl-add-btn {
          width: 28px; height: 28px; border-radius: 6px;
          background: rgba(232,168,56,0.08); border: 1px solid rgba(232,168,56,0.1);
          color: var(--primary); font-size: 14px; cursor: pointer; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
          transition: all 0.15s;
        }
        .tv-pl-add-btn:active { transform: scale(0.9); }
        .tv-pl-add-btn:disabled { opacity: 0.5; cursor: not-allowed; }

        .tv-pl-all-videos { display: flex; flex-direction: column; gap: 6px; }
        .tv-pl-all-item {
          display: flex; align-items: center; gap: 10px;
          padding: 8px 10px;
          background: var(--surface-card);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          transition: all 0.2s;
        }
        .tv-pl-all-item.added { opacity: 0.6; }
        .tv-pl-all-thumb {
          width: 48px; height: 27px; border-radius: 4px;
          overflow: hidden; flex-shrink: 0; background: var(--surface-elevated);
        }
        .tv-pl-all-thumb img { width: 100%; height: 100%; object-fit: cover; }
        .tv-pl-all-info { flex: 1; min-width: 0; }
        .tv-pl-all-title { font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .tv-pl-all-meta { font-size: 10px; color: var(--text-tertiary); margin-top: 1px; }

        .tv-tab-empty {
          display: flex; flex-direction: column; align-items: center; gap: 8px;
          padding: 40px 20px; text-align: center;
          color: var(--text-tertiary); font-size: 13px;
        }
        .tv-tab-empty i { font-size: 36px; opacity: 0.3; }

        /* ─── Load More button (paginated all videos) ─── */
        .tv-pl-load-more {
          width: 100%; padding: 12px;
          margin-top: 8px;
          border-radius: var(--radius-md);
          background: var(--surface);
          border: 1px solid var(--border);
          color: var(--text-secondary);
          font-size: 13px; font-weight: 600;
          cursor: pointer;
          display: flex; align-items: center; justify-content: center; gap: 6px;
          transition: all 0.2s;
        }
        .tv-pl-load-more:active { background: var(--surface-elevated); transform: scale(0.98); }
        .tv-pl-load-more:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }

        @keyframes livePulse { 0%,100% { opacity:1;transform:scale(1); } 50% { opacity:0.5;transform:scale(1.4); } }

        /* ─── BOTTOM NAV ─── */
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
      `}</style>

      <ToastBridge />

      <div className="tv-page">
        {/* ─── PLAYER SECTION ─── */}
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
          <>
            <PremiumTopBar
              title={channel?.title ? `${channel.title} TV` : "Church TV"}
              showBack
              rightContent={
                <>
                  <button
                    onClick={toggleOrientation}
                    title={isLandscape ? "Portrait" : "Landscape"}
                    style={{
                      width: 36, height: 36, borderRadius: "50%",
                      background: "var(--surface, #1A1A1A)",
                      border: "1px solid var(--border, #2A2A2A)",
                      color: "var(--text-primary, #fff)",
                      fontSize: 14, cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}
                  >
                    <i className={`fas fa-${isLandscape ? "compress" : "expand"}`}></i>
                  </button>
                  <button
                    onClick={() => router.push("/dashboard")}
                    title="Dashboard"
                    style={{
                      width: 36, height: 36, borderRadius: "50%",
                      background: "var(--surface, #1A1A1A)",
                      border: "1px solid var(--border, #2A2A2A)",
                      color: "var(--text-primary, #fff)",
                      fontSize: 14, cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}
                  >
                    <i className="fas fa-home"></i>
                  </button>
                </>
              }
            />

            <div className="tv-player-section">
              <div className="tv-player-outer">
                {/* Player — rendered by global TvPlayerProvider */}
                <div ref={tvPlayerTargetRef} className="tv-player-outer" style={{ aspectRatio: "16/9" }}>
                  {currentVideo ? (
                    <div className="tv-schedule-now" style={{ display: "none" }}></div>
                  ) : (
                    <div className="tv-player-placeholder">
                      <i className="fas fa-tv"></i>
                      <p>No videos available</p>
                    </div>
                  )}
                </div>

                {/* Playlist badge */}
                {currentVideo && tvUserState && (
                  <div className="tv-shuffle-badge">
                    <i className="fas fa-list"></i>
                    {tvUserState.currentIndex + 1} / {tvUserState.playlist.length}
                  </div>
                )}
              </div>

              {/* ─── TAB BAR ─── */}
              <div className="tv-tab-bar">
                {TABS.map((tab) => (
                  <button
                    key={tab.id}
                    className={`tv-tab-btn ${activeTab === tab.id ? "active" : ""}`}
                    onClick={() => setActiveTab(tab.id)}
                  >
                    <i className={`fas ${tab.icon}`}></i>
                    <span>{tab.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* ─── TAB CONTENT ─── */}
            <div className="tv-tab-content">
              {renderTabContent()}
            </div>
          </>
        )}
        <BottomNavBar activeTab="tv" />
      </div>

      {/* ─── NOTE READER MODAL ─── */}
      {selectedNote && (
        <div className="tv-reader-overlay">
          <div className="tv-reader-top">
            <button className="tv-reader-back" onClick={() => setSelectedNote(null)}>
              <i className="fas fa-arrow-left"></i>
            </button>
            <div className="tv-reader-title">
              {selectedNote.videoTitle || "Note"}
            </div>
            <button
              className="tv-reader-edit-btn"
              onClick={() => {
                if (!selectedNote) return;
                setNoteContent(selectedNote.content || "");
                setNotesSubTab("write");
                setSelectedNote(null);
              }}
            >
              <i className="fas fa-pen"></i>
            </button>
            <button
              className="tv-reader-delete-btn"
              onClick={async () => {
                if (!auth.currentUser?.uid) return;
                try {
                  await deleteUserNote(auth.currentUser.uid, selectedNote.videoId);
                  setAllNotes((prev) => prev.filter((x) => x.videoId !== selectedNote.videoId));
                  setSelectedNote(null);
                } catch {}
              }}
            >
              <i className="fas fa-trash"></i>
            </button>
          </div>
          <div className="tv-reader-body">
            <div className="tv-reader-meta">
              {selectedNote.updatedAt && (
                <span>
                  <i className="fas fa-calendar" style={{ marginRight: 4 }}></i>
                  {new Date(selectedNote.updatedAt as any).toLocaleDateString([], {
                    year: "numeric", month: "long", day: "numeric",
                    hour: "2-digit", minute: "2-digit",
                  })}
                </span>
              )}
              {currentVideo?.id === selectedNote.videoId && (
                <span style={{ color: "var(--primary)" }}>
                  <i className="fas fa-play" style={{ marginRight: 4 }}></i>Now Playing
                </span>
              )}
            </div>
            <div
              className="tv-reader-content"
              dangerouslySetInnerHTML={{
                __html: selectedNote.content
                  ? renderNoteContent(selectedNote.content)
                  : '<p style="color: var(--text-tertiary); font-style: italic;">This note has no content.</p>',
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}
