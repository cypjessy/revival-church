import { db } from "@/lib/firebase";
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  collection, query, orderBy, limit, startAfter,
  serverTimestamp, writeBatch, DocumentSnapshot,
} from "firebase/firestore";

export interface YouTubeVideo {
  id?: string;
  youtubeId: string;
  title: string;
  description: string;
  thumbnail: string;
  duration: string;
  publishedAt: string;
  views: number;
  category: string;
  tags: string[];
  isFeatured: boolean;
  isHidden: boolean;
  seriesId: string | null;
}

export interface YouTubeChannel {
  id: string;
  name: string;
  avatar: string;
  subscribers: number;
  videoCount: number;
  views: number;
  previousTotalViews: number;
  weeklyViews: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  syncedAt?: any;
}

export interface YouTubeSeries {
  id?: string;
  name: string;
  description: string;
  coverImage: string;
  category: string;
  videoIds: string[];
  isPublic: boolean;
  createdAt: string;
}

const channelDoc = (id: string) => doc(db, "youtube_channel", id);
const videosCol = () => collection(db, "youtube_videos");
const videoDoc = (id: string) => doc(db, "youtube_videos", id);
const seriesCol = () => collection(db, "youtube_series");
const seriesDoc = (id: string) => doc(db, "youtube_series", id);
const liveDoc = () => doc(db, "youtube_live", "current");

export interface YouTubeLiveStatus {
  isLive: boolean;
  video: YouTubeVideo | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  lastCheckedAt?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  detectedAt?: any;
}

export async function getChannel(channelId: string): Promise<YouTubeChannel | null> {
  const snap = await getDoc(channelDoc(channelId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as YouTubeChannel;
}

export async function saveChannel(channel: YouTubeChannel) {
  // Get existing channel data to calculate weekly views
  const existing = await getDoc(channelDoc(channel.id));
  const existingData = existing.exists() ? existing.data() : null;
  const previousViews = existingData?.views ?? channel.views;
  const weeklyViews = channel.views >= previousViews
    ? channel.views - previousViews
    : 0;

  await setDoc(channelDoc(channel.id), {
    name: channel.name,
    avatar: channel.avatar,
    subscribers: channel.subscribers,
    videoCount: channel.videoCount,
    views: channel.views,
    previousTotalViews: previousViews,
    weeklyViews: weeklyViews,
    syncedAt: serverTimestamp(),
  }, { merge: true });
}

export async function getYouTubeStats(): Promise<YouTubeChannel & { lastSynced?: string } | null> {
  const channelId = process.env.NEXT_PUBLIC_YOUTUBE_CHANNEL_ID;
  if (!channelId) return null;
  try {
    const snap = await getDoc(channelDoc(channelId));
    if (!snap.exists()) return null;
    const data = snap.data();
    return {
      id: snap.id,
      name: data.name || "",
      avatar: data.avatar || "",
      subscribers: data.subscribers || 0,
      videoCount: data.videoCount || 0,
      views: data.views || 0,
      previousTotalViews: data.previousTotalViews || 0,
      weeklyViews: data.weeklyViews || 0,
      lastSynced: data.syncedAt?.toDate?.()?.toLocaleString() || "",
    };
  } catch {
    return null;
  }
}

export async function getVideosPage(pageSize: number, lastDoc?: DocumentSnapshot): Promise<{ videos: YouTubeVideo[]; lastDoc: DocumentSnapshot | null }> {
  let q = query(videosCol(), orderBy("publishedAt", "desc"), limit(pageSize));
  if (lastDoc) q = query(videosCol(), orderBy("publishedAt", "desc"), startAfter(lastDoc), limit(pageSize));
  const snap = await getDocs(q);
  const videos = snap.docs.map((d) => ({ id: d.id, ...d.data() } as YouTubeVideo));
  const newLastDoc = snap.docs.length === pageSize ? snap.docs[snap.docs.length - 1] : null;
  return { videos, lastDoc: newLastDoc };
}

export async function saveVideos(videos: YouTubeVideo[]) {
  const batch = writeBatch(db);
  for (const v of videos) {
    const ref = videoDoc(v.youtubeId);
    batch.set(ref, { ...v, syncedAt: serverTimestamp() }, { merge: true });
  }
  await batch.commit();
}

export async function updateVideo(id: string, data: Partial<YouTubeVideo>) {
  await updateDoc(videoDoc(id), { ...data, updatedAt: serverTimestamp() });
}

export async function deleteVideo(id: string) {
  await deleteDoc(videoDoc(id));
}

export async function deleteAllYouTubeData(): Promise<{ videos: number; series: number }> {
  // Delete all videos
  const videoSnap = await getDocs(videosCol());
  const videoBatch = writeBatch(db);
  videoSnap.docs.forEach((d) => videoBatch.delete(d.ref));
  await videoBatch.commit();

  // Delete all series
  const seriesSnap = await getDocs(seriesCol());
  const seriesBatch = writeBatch(db);
  seriesSnap.docs.forEach((d) => seriesBatch.delete(d.ref));
  await seriesBatch.commit();

  // Delete channel doc
  const channelId = process.env.NEXT_PUBLIC_YOUTUBE_CHANNEL_ID;
  if (channelId) await deleteDoc(channelDoc(channelId));

  // Delete live doc
  await deleteDoc(liveDoc());

  return { videos: videoSnap.docs.length, series: seriesSnap.docs.length };
}

export async function getSeries(): Promise<YouTubeSeries[]> {
  const q = query(seriesCol(), orderBy("createdAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as YouTubeSeries));
}

export async function createSeries(series: Omit<YouTubeSeries, "id" | "createdAt">): Promise<string> {
  const ref = doc(seriesCol());
  await setDoc(ref, { ...series, createdAt: new Date().toISOString().slice(0, 10) });
  return ref.id;
}

export async function updateSeries(id: string, data: Partial<YouTubeSeries>) {
  await updateDoc(seriesDoc(id), data);
}

export async function deleteSeries(id: string) {
  await deleteDoc(seriesDoc(id));
}

export async function getVideo(youtubeId: string): Promise<YouTubeVideo | null> {
  try {
    const snap = await getDoc(doc(db, "youtube_videos", youtubeId));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() } as YouTubeVideo;
  } catch {
    return null;
  }
}

export async function getLiveStatus(): Promise<YouTubeLiveStatus | null> {
  try {
    const snap = await getDoc(liveDoc());
    if (!snap.exists()) return null;
    const data = snap.data();
    return {
      isLive: data.isLive || false,
      video: data.video || null,
      lastCheckedAt: data.lastCheckedAt,
      detectedAt: data.detectedAt,
    };
  } catch {
    return null;
  }
}

export async function saveLiveStatus(
  status: { isLive: boolean; video?: YouTubeVideo | null }
) {
  const batch = writeBatch(db);
  batch.set(liveDoc(), {
    isLive: status.isLive,
    video: status.video || null,
    lastCheckedAt: serverTimestamp(),
    ...(status.isLive ? { detectedAt: serverTimestamp() } : {}),
  }, { merge: true });

  if (status.isLive && status.video) {
    const ref = videoDoc(status.video.youtubeId);
    batch.set(ref, { ...status.video, syncedAt: serverTimestamp() }, { merge: true });
  }

  await batch.commit();
}

export function liveDocRef() {
  return liveDoc();
}
