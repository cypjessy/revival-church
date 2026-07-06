/**
 * Firestore CRUD for YouTube channel & videos.
 * Single-church, no churchId — flat, descriptive fields for AI querying.
 */

import { db } from "./firebase";
import {
  doc, getDoc, setDoc, collection, getDocs, query, orderBy, limit,
  writeBatch, serverTimestamp, deleteDoc, startAfter,
  collectionGroup,
} from "firebase/firestore";

/* ─── Types ───────────────────────────────────────────────────── */

export interface YouTubeChannel {
  channelId: string;
  title: string;
  thumbnail: string;
  subscriberCount: string;
  videoCount: number;
  syncedAt: Date | null;
}

export interface YouTubeVideo {
  id: string;                    // YouTube video ID
  title: string;
  description: string;
  thumbnail: string;             // medium quality
  channelTitle: string;
  channelId: string;
  publishedAt: string;           // ISO date string
  duration: number;              // seconds
  position: number;              // order in channel
  isFeatured: boolean;
  isHidden: boolean;
  syncedAt: Date | null;
}

const CHANNEL_DOC = "youtube_channel/main";

/* ─── Channel ─────────────────────────────────────────────────── */

export async function getChannel(): Promise<YouTubeChannel | null> {
  const snap = await getDoc(doc(db, "youtube_channel", "main"));
  if (!snap.exists()) return null;
  return snap.data() as YouTubeChannel;
}

export async function saveChannel(data: YouTubeChannel): Promise<void> {
  await setDoc(doc(db, "youtube_channel", "main"), {
    ...data,
    syncedAt: serverTimestamp(),
  });
}

/* ─── Videos ──────────────────────────────────────────────────── */

const VIDEOS_COL = "youtube_videos";

/**
 * Fetch videos with optional limit (no cursor = first page).
 * Used primarily by the admin sync flow where all videos are needed.
 */
export async function getVideos(opts?: {
  max?: number;
  includeHidden?: boolean;
}): Promise<YouTubeVideo[]> {
  let q = query(collection(db, VIDEOS_COL), orderBy("position", "asc"));
  if (opts?.max) q = query(q, limit(opts.max));
  const snap = await getDocs(q);
  let list = snap.docs.map((d) => d.data() as YouTubeVideo);
  if (!opts?.includeHidden) list = list.filter((v) => !v.isHidden);
  return list;
}

/**
 * Paginated videos — returns one page plus the last position for cursor.
 * Pass `startAfterPosition` from the previous page's last document to get the next page.
 */
export async function getVideosPage(
  pageSize: number,
  startAfterPosition?: number,
  includeHidden?: boolean,
): Promise<{ videos: YouTubeVideo[]; lastPosition: number | null }> {
  let q = query(
    collection(db, VIDEOS_COL),
    orderBy("position", "asc"),
    limit(pageSize),
  );
  if (startAfterPosition !== undefined) {
    q = query(q, startAfter(startAfterPosition));
  }
  const snap = await getDocs(q);
  const docs = snap.docs;
  let list = docs.map((d) => d.data() as YouTubeVideo);
  if (!includeHidden) list = list.filter((v) => !v.isHidden);
  const lastPosition = docs.length > 0
    ? (docs[docs.length - 1].data() as YouTubeVideo).position
    : null;
  return { videos: list, lastPosition };
}

/**
 * Fetch specific videos by their IDs (for user's playlist).
 * Does individual doc reads — intended for small sets (user's playlist).
 */
export async function getVideosByIds(ids: string[]): Promise<YouTubeVideo[]> {
  if (ids.length === 0) return [];
  const results: YouTubeVideo[] = [];
  // Process in small batches to avoid too many concurrent reads
  const batchSize = 10;
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const docs = await Promise.all(
      batch.map((id) => getDoc(doc(db, VIDEOS_COL, id)))
    );
    for (const d of docs) {
      if (d.exists()) results.push(d.data() as YouTubeVideo);
    }
  }
  return results;
}

export async function saveVideos(videos: YouTubeVideo[]): Promise<void> {
  const batch = writeBatch(db);
  for (const video of videos) {
    const ref = doc(db, VIDEOS_COL, video.id);
    batch.set(ref, { ...video, syncedAt: serverTimestamp() }, { merge: true });
  }
  await batch.commit();
}

export async function updateVideo(
  id: string,
  data: Partial<YouTubeVideo>
): Promise<void> {
  const ref = doc(db, VIDEOS_COL, id);
  await setDoc(ref, data, { merge: true });
}

export async function deleteVideo(id: string): Promise<void> {
  await deleteDoc(doc(db, VIDEOS_COL, id));
}

export async function getVideoCount(): Promise<number> {
  const snap = await getDocs(collection(db, VIDEOS_COL));
  return snap.size;
}

/* ─── Clear & re-sync ─────────────────────────────────────────── */

export async function clearAllVideos(): Promise<void> {
  const snap = await getDocs(collection(db, VIDEOS_COL));
  const batch = writeBatch(db);
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}

/* ─── TV Playlist (scheduled playlist) ──────────────────────── */

export interface TVPlaylist {
  id: string;
  title: string;             // Playlist name (e.g. "Sunday Service")
  videoIds: string[];        // Ordered list of synced YouTube video IDs
  scheduledDate: string;     // ISO date YYYY-MM-DD (or empty for recurring)
  scheduledTime: string;     // HH:MM in 24hr format
  dayOfWeek: number | null;  // 0=Sun..6=Sat, null for specific date
  isRecurring: boolean;      // Repeats weekly on dayOfWeek
  isActive: boolean;
  lastPlayedAt: Date | null;
  createdAt: Date | null;
}

const PLAYLIST_COL = "tv_playlists";

export async function getPlaylists(): Promise<TVPlaylist[]> {
  const q = query(collection(db, PLAYLIST_COL), orderBy("scheduledTime", "asc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as TVPlaylist));
}

export async function addPlaylist(
  data: Omit<TVPlaylist, "id" | "createdAt" | "lastPlayedAt">
): Promise<string> {
  const ref = doc(collection(db, PLAYLIST_COL));
  await setDoc(ref, {
    ...data,
    createdAt: serverTimestamp(),
    lastPlayedAt: null,
  });
  return ref.id;
}

export async function deletePlaylist(id: string): Promise<void> {
  await deleteDoc(doc(db, PLAYLIST_COL, id));
}

export async function markPlaylistPlayed(id: string): Promise<void> {
  await setDoc(
    doc(db, PLAYLIST_COL, id),
    { lastPlayedAt: serverTimestamp() },
    { merge: true }
  );
}

/** Check if a scheduled playlist should play now */
export function isPlaylistDue(item: TVPlaylist): boolean {
  if (!item.isActive) return false;
  if (!item.videoIds || item.videoIds.length === 0) return false;

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  // Skip if already played within the last hour (prevents re-triggers)
  if (item.lastPlayedAt) {
    const lastPlayed =
      (item.lastPlayedAt as any)?.toMillis?.() ||
      new Date(item.lastPlayedAt as any).getTime();
    if (lastPlayed && now.getTime() - lastPlayed < 3600000) return false;
  }

  // Check day match
  if (item.isRecurring && item.dayOfWeek !== null) {
    if (item.dayOfWeek !== now.getDay()) return false;
  } else if (item.scheduledDate) {
    if (item.scheduledDate !== today) return false;
  } else {
    return false; // no day/date set
  }

  // Check time — within a 10-minute window
  const [h, m] = item.scheduledTime.split(":").map(Number);
  const scheduledMinutes = h * 60 + m;
  const diff = currentMinutes - scheduledMinutes;
  return diff >= -5 && diff <= 10; // 5 min before to 10 min after
}

/* ─── Per-User TV State (personalized playlist + progress) ──── */

export interface UserTvState {
  playlist: string[];        // Ordered YouTube video IDs
  currentIndex: number;      // Which video is playing
  currentSeek: number;       // Seek position in seconds
  updatedAt: Date | null;
}

const DEFAULT_TV_STATE: UserTvState = {
  playlist: [],
  currentIndex: 0,
  currentSeek: 0,
  updatedAt: null,
};

/** Get a user's personalized TV state (playlist + progress). */
export async function getUserTvState(uid: string): Promise<UserTvState> {
  const ref = doc(db, "users", uid, "tv_state", "main");
  const snap = await getDoc(ref);
  if (!snap.exists()) return { ...DEFAULT_TV_STATE };
  const data = snap.data() as UserTvState;
  return {
    playlist: data.playlist || [],
    currentIndex: data.currentIndex || 0,
    currentSeek: data.currentSeek || 0,
    updatedAt: data.updatedAt || null,
  };
}

/** Save full TV state (playlist + progress). */
export async function saveUserTvState(
  uid: string,
  state: Partial<UserTvState>
): Promise<void> {
  const ref = doc(db, "users", uid, "tv_state", "main");
  await setDoc(ref, { ...state, updatedAt: serverTimestamp() }, { merge: true });
}

/** Convenience: update just the playback progress. */
export async function updateUserTvProgress(
  uid: string,
  currentIndex: number,
  currentSeek: number
): Promise<void> {
  await saveUserTvState(uid, { currentIndex, currentSeek });
}

/** Add a video ID to the end of the user's playlist. */
export async function addToUserPlaylist(
  uid: string,
  videoId: string
): Promise<void> {
  const current = await getUserTvState(uid);
  if (current.playlist.includes(videoId)) return; // no duplicates
  current.playlist.push(videoId);
  await saveUserTvState(uid, { playlist: current.playlist });
}

/** Remove a video ID from the user's playlist. */
export async function removeFromUserPlaylist(
  uid: string,
  videoId: string
): Promise<void> {
  const current = await getUserTvState(uid);
  const filtered = current.playlist.filter((id) => id !== videoId);
  // Adjust index if needed
  let newIndex = current.currentIndex;
  if (newIndex >= filtered.length) newIndex = Math.max(0, filtered.length - 1);
  await saveUserTvState(uid, {
    playlist: filtered,
    currentIndex: newIndex,
    currentSeek: 0,
  });
}

/** Reorder the entire user playlist. */
export async function reorderUserPlaylist(
  uid: string,
  playlist: string[]
): Promise<void> {
  await saveUserTvState(uid, { playlist, currentSeek: 0 });
}

/**
 * Auto-initialize a user's TV playlist if it's empty.
 * Fills it with all synced YouTube video IDs (non-hidden, sorted by position).
 * Only writes if the playlist is empty AND there are videos to add.
 * Does NOT reset progress if the user already has a playlist.
 */
export async function autoInitUserPlaylist(uid: string): Promise<UserTvState> {
  const state = await getUserTvState(uid);
  if (state.playlist.length > 0) return state; // Already has a playlist

  const allVideos = await getVideos({ max: 500 });
  const ids = allVideos.map((v) => v.id);
  if (ids.length === 0) return state; // No videos to add

  const newState: UserTvState = {
    playlist: ids,
    currentIndex: 0,
    currentSeek: 0,
    updatedAt: null,
  };
  await saveUserTvState(uid, { playlist: ids, currentIndex: 0, currentSeek: 0 });
  return newState;
}

/* ─── Broadcast Schedule (time-synced TV) ──────────────────── */

export interface BroadcastSlot {
  videoId: string;
  duration: number;         // seconds
  startOffset: number;       // seconds from playlist scheduled time
  playlistName?: string;
  playlistId?: string;
}

export interface TVBroadcast {
  date: string;             // YYYY-MM-DD
  generatedAt: Date | null;
  slots: BroadcastSlot[];
}

const BROADCAST_DOC = "tv_broadcast/main";

/** Fetch today's broadcast schedule */
export async function getTodayBroadcast(): Promise<TVBroadcast | null> {
  const snap = await getDoc(doc(db, "tv_broadcast", "main"));
  if (!snap.exists()) return null;
  const data = snap.data() as TVBroadcast;
  // Only return if it's for today
  const today = new Date().toISOString().slice(0, 10);
  if (data.date !== today) return null;
  return data;
}

/**
 * Generate today's broadcast from manually created playlists.
 * Computes slot offsets (seconds from midnight) and saves to Firestore.
 */
export async function generateBroadcast(): Promise<number> {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const todayDay = now.getDay();

  const allPlaylists = await getPlaylists();
  const allVideos = await getVideos({ max: 200 });
  const vidMap = new Map<string, number>();
  for (const v of allVideos) {
    if (v.duration > 0) vidMap.set(v.id, v.duration);
  }

  // Filter playlists scheduled for today
  const todayPlaylists = allPlaylists.filter((p) => {
    if (!p.isActive || !p.videoIds || p.videoIds.length === 0) return false;
    if (p.isRecurring && p.dayOfWeek !== null) {
      return p.dayOfWeek === todayDay;
    }
    if (p.scheduledDate) {
      return p.scheduledDate === today;
    }
    return false;
  });

  // Sort by time
  todayPlaylists.sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime));

  const slots: BroadcastSlot[] = [];
  for (const pl of todayPlaylists) {
    const [h, m] = pl.scheduledTime.split(":").map(Number);
    const plStartSeconds = h * 3600 + m * 60;
    let offset = 0;
    for (const videoId of pl.videoIds) {
      const duration = vidMap.get(videoId) || 300; // default 5 min if unknown
      slots.push({
        videoId,
        duration,
        startOffset: plStartSeconds + offset,
        playlistName: pl.title,
        playlistId: pl.id,
      });
      offset += duration;
    }
  }

  await setDoc(doc(db, BROADCAST_DOC), {
    date: today,
    generatedAt: serverTimestamp(),
    slots,
  });

  return slots.length;
}

/* ─── TV Giving Config ────────────────────────────────────── */

export interface TVGivingConfig {
  amounts: string[];
  churchName: string;
  description: string;
  methods: { icon: string; label: string; link: string }[];
}

const DEFAULT_GIVING_CONFIG: TVGivingConfig = {
  amounts: ["$10", "$25", "$50", "$100", "Other"],
  churchName: "the Church",
  description: "Your generous giving helps us reach more souls with the gospel. Every contribution makes a difference.",
  methods: [
    { icon: "fa-qrcode", label: "Scan to Give", link: "/admin/giving" },
    { icon: "fa-mobile-screen", label: "Mobile Pay", link: "/admin/giving" },
    { icon: "fa-bank", label: "Bank Transfer", link: "/admin/giving" },
  ],
};

export async function getGivingConfig(): Promise<TVGivingConfig> {
  const snap = await getDoc(doc(db, "tv_giving_config", "main"));
  if (!snap.exists()) return { ...DEFAULT_GIVING_CONFIG };
  return snap.data() as TVGivingConfig;
}

export async function saveGivingConfig(
  config: Partial<TVGivingConfig>
): Promise<void> {
  await setDoc(
    doc(db, "tv_giving_config", "main"),
    { ...config },
    { merge: true }
  );
}

/* ─── User TV Notes (per-video notes saved to Firestore) ──── */

export interface TvNote {
  videoId: string;
  videoTitle: string;
  content: string;            // Markdown-like formatted text
  updatedAt: Date | null;
}

/**
 * Save a note for a specific video. Creates/updates the note document
 * under users/{uid}/tv_notes/{videoId}.
 */
export async function saveUserNote(
  uid: string,
  videoId: string,
  videoTitle: string,
  content: string
): Promise<void> {
  const ref = doc(db, "users", uid, "tv_notes", videoId);
  await setDoc(ref, {
    videoId,
    videoTitle,
    content,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Get the note for a specific video (if any).
 */
export async function getUserNote(
  uid: string,
  videoId: string
): Promise<TvNote | null> {
  const ref = doc(db, "users", uid, "tv_notes", videoId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return snap.data() as TvNote;
}

/**
 * Get all notes the user has saved, ordered by most recently updated.
 */
export async function getAllUserNotes(
  uid: string
): Promise<TvNote[]> {
  const col = collection(db, "users", uid, "tv_notes");
  const q = query(col, orderBy("updatedAt", "desc"), limit(200));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as TvNote);
}

/**
 * Delete a note for a specific video.
 */
export async function deleteUserNote(
  uid: string,
  videoId: string
): Promise<void> {
  const ref = doc(db, "users", uid, "tv_notes", videoId);
  await deleteDoc(ref);
}

/* ─── Prayer Replies (admin response) ─────────────────────── */

/**
 * Reply to a prayer request from the admin TV dashboard.
 * Writes to the user's per-user subcollection: users/{userId}/tv_prayers/{prayerId}
 */
export async function replyToPrayer(
  userId: string,
  prayerId: string,
  replyText: string,
  repliedBy: string
): Promise<void> {
  const ref = doc(db, "users", userId, "tv_prayers", prayerId);
  await setDoc(
    ref,
    {
      replyText,
      repliedBy,
      repliedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

/* ─── TV Active Viewers (heartbeat) ───────────────────────── */

const ACTIVE_VIEWERS_COL = "tv_active_viewers";

/**
 * Write a heartbeat to mark this user as actively watching TV.
 * Called periodically from the member TV page.
 */
export async function updateTvHeartbeat(uid: string): Promise<void> {
  await setDoc(
    doc(db, ACTIVE_VIEWERS_COL, uid),
    { lastSeen: serverTimestamp(), userId: uid },
    { merge: true }
  );
}

/**
 * Count active viewers — users with a heartbeat within the last 3 minutes.
 * We read all docs and filter client-side (small collection).
 */
export async function countActiveViewers(): Promise<number> {
  const snap = await getDocs(collection(db, ACTIVE_VIEWERS_COL));
  const threeMinAgo = Date.now() - 180000;
  let count = 0;
  snap.forEach((d) => {
    const data = d.data();
    const lastSeen = (data.lastSeen as any)?.toMillis?.() || 0;
    if (lastSeen && lastSeen >= threeMinAgo) count++;
  });
  return count;
}

/* ─── TV Active Viewers cleanup (optional) ────────────────── */

/** Remove stale viewer entries older than 10 minutes. */
export async function cleanupStaleViewers(): Promise<void> {
  const snap = await getDocs(collection(db, ACTIVE_VIEWERS_COL));
  const tenMinAgo = Date.now() - 600000;
  const batch = writeBatch(db);
  snap.forEach((d) => {
    const data = d.data();
    const lastSeen = (data.lastSeen as any)?.toMillis?.() || 0;
    if (!lastSeen || lastSeen < tenMinAgo) {
      batch.delete(d.ref);
    }
  });
  await batch.commit();
}

/**
 * Given the current time (seconds since midnight) and today's broadcast slots,
 * find which slot is currently playing. Returns null if in shuffle gap.
 */
export function findCurrentSlot(
  slots: BroadcastSlot[],
  secondsSinceMidnight: number
): { slot: BroadcastSlot; offsetWithinVideo: number } | null {
  for (const slot of slots) {
    const slotEnd = slot.startOffset + slot.duration;
    // Allow a 2-second tolerance at slot boundaries
    if (secondsSinceMidnight >= slot.startOffset - 2 && secondsSinceMidnight < slotEnd) {
      return {
        slot,
        offsetWithinVideo: secondsSinceMidnight - slot.startOffset,
      };
    }
  }
  return null;
}
