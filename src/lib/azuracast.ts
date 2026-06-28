"use client";

// ============================================================
// AZURACAST API CLIENT
// ============================================================

export function getStationId(): string {
  try {
    return process.env.NEXT_PUBLIC_STATION_ID || "";
  } catch {
    return "";
  }
}

/** Extract the station shortcode from the public embed URL (last path segment).
 *  Falls back to getStationId() if the embed URL is not set. */
export function getStationShortcode(): string {
  try {
    const url = process.env.NEXT_PUBLIC_AZURACAST_PUBLIC_EMBED_URL || "";
    const segs = url.split("/").filter(Boolean);
    return segs[segs.length - 1] || getStationId();
  } catch {
    return getStationId();
  }
}

/** Return the full public embed URL, falling back to constructing one from the API base + shortcode. */
export function getPublicPlayerUrl(): string {
  try {
    return process.env.NEXT_PUBLIC_AZURACAST_PUBLIC_EMBED_URL || `${getApiBase()}/public/${getStationShortcode()}`;
  } catch {
    return `${getApiBase()}/public/${getStationShortcode()}`;
  }
}

const STATION_ID = getStationId();

export function getApiBase(): string {
  if (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_AZURACAST_URL)
    return process.env.NEXT_PUBLIC_AZURACAST_URL;
  return "";
}

export function getApiKey(): string {
  if (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_AZURACAST_API_KEY)
    return process.env.NEXT_PUBLIC_AZURACAST_API_KEY;
  return "";
}

/** Return the API host for server-side route proxying. When set, the app
 *  will call an external server (e.g. Vercel) for API routes instead of
 *  relying on the Next.js dev/production server. Leave empty for relative URLs. */
export function getApiHost(): string {
  try {
    return process.env.NEXT_PUBLIC_API_HOST || "";
  } catch {
    return "";
  }
}

async function apiFetch<T>(
  endpoint: string,
  options?: RequestInit
): Promise<{ ok: boolean; status: number; data?: T }> {
  const key = getApiKey();
  const apiHost = getApiHost();
  const apiBase = getApiBase();
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options?.headers as Record<string, string>),
    };
    if (key) headers["Authorization"] = `Bearer ${key}`;

    // When apiHost is set, call via the Vercel proxy; otherwise call AzuraCast directly
    const url = apiHost
      ? `${apiHost}/api/azuracast${endpoint}`
      : `${apiBase}/api${endpoint}`;

    const res = await fetch(url, {
      ...options,
      headers,
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, status: res.status };
    if (res.status === 204) return { ok: true, status: 204 };
    const text = await res.text();
    if (!text) return { ok: true, status: res.status };
    let data: T;
    try { data = JSON.parse(text); } catch { return { ok: true, status: res.status }; }
    return { ok: true, status: res.status, data };
  } catch (err) {
    console.warn(`[AzuraCast] ${endpoint} failed:`, err);
    return { ok: false, status: 0 };
  }
}

// ============================================================
// TYPES
// ============================================================

export interface NowPlayingData {
  station: { name: string; shortName: string; isLive: boolean; listenUrl: string };
  nowPlaying: {
    song: { title: string; artist: string; albumArt: string };
    duration: number;
    elapsed: number;
    playlist: string;
  } | null;
  listeners: { current: number; unique: number; total: number };
  live: { isLive: boolean; streamerName: string | null };
  songHistory: SongHistoryItem[];
}

export interface SongHistoryItem {
  song: { title: string; artist: string; albumArt: string };
  playedAt: string;
  duration: number;
}

export interface StationFile {
  id: string;
  unique_id: string;
  title: string;
  artist: string;
  album: string;
  duration: string;
  genre: string;
  path: string;
  size: string;
  albumArt: string;
  playlists: string[];
}

export interface Playlist {
  id: string;
  name: string;
  type: "standard" | "scheduled" | "on_demand";
  order: "shuffle" | "sequential";
  weight: number;
  enabled: boolean;
  songCount: number;
  songs: string[];
  schedule?: {
    days: number[];
    startTime: string;
    endTime: string;
  };
}

export interface Streamer {
  id: string;
  displayName: string;
  username: string;
  isLive: boolean;
  lastBroadcast: string | null;
  broadcastHistory: { date: string; duration: string; startTime: string }[];
}

export interface Webhook {
  id: string;
  name?: string;
  url: string;
  events: string[];
  enabled: boolean;
  secret: string;
}

export interface AnalyticsReport {
  totalListeners: { today: number; week: number; month: number };
  peakConcurrent: number;
  listenersOverTime: { time: string; count: number }[];
  topSongs: { title: string; artist: string; plays: number }[];
  broadcastHistory: { date: string; dj: string; duration: string }[];
}

export interface StationSettings {
  name: string;
  streamUrl: string;
  publicPageUrl: string;
  autoDJ: boolean;
  maxListeners: number;
  defaultBitrate: number;
  publicPageVisible: boolean;
  mountPoint: string;
}

export interface StationStatus {
  backendRunning: boolean;
  frontendRunning: boolean;
}

export interface QueueItem {
  song: { title: string; artist: string; albumArt: string };
  cuedAt: number;
  playlist: string;
  isRequest: boolean;
}

export interface Station {
  id: number;
  name: string;
  shortcode: string;
  description: string;
  listen_url: string;
  url: string | null;
  public_player_url: string;
  is_public: boolean;
  mounts: Array<{
    id: number;
    name: string;
    url: string;
    bitrate: number;
    format: string;
    listeners: { current: number; unique: number; total: number };
    path: string;
    is_default: boolean;
  }>;
}

// ============================================================
// MOCK DATA (fallbacks)
// ============================================================

const FALLBACK_NOW_PLAYING: NowPlayingData = {
  station: { name: "Radio Station", shortName: "station", isLive: false, listenUrl: "" },
  nowPlaying: null,
  listeners: { current: 0, unique: 0, total: 0 },
  live: { isLive: false, streamerName: null },
  songHistory: [],
};

const FALLBACK_STREAMERS: Streamer[] = [];

// ============================================================
// LEGACY MOCK EXPORTS (used by radio-station section components)
// ============================================================

export const MOCK_FILES: StationFile[] = [];
export const MOCK_PLAYLISTS: Playlist[] = [];
export const MOCK_STREAMERS: Streamer[] = [];
export const MOCK_WEBHOOKS: Webhook[] = [];

const FALLBACK_SETTINGS: StationSettings = {
  name: "Radio Station",
  streamUrl: "",
  publicPageUrl: "",
  autoDJ: false,
  maxListeners: 0,
  defaultBitrate: 128,
  publicPageVisible: false,
  mountPoint: "/live",
};

// ============================================================
// API FUNCTIONS
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapNowPlaying(raw: any): NowPlayingData {
  const rawListenUrl = raw.station?.listen_url || "";
  return {
    station: {
      name: raw.station?.name || FALLBACK_NOW_PLAYING.station.name,
      shortName: raw.station?.shortcode || FALLBACK_NOW_PLAYING.station.shortName,
      isLive: raw.station?.is_streamer_live ?? false,
      listenUrl: rawListenUrl,
    },
    nowPlaying: raw.now_playing?.song
      ? {
          song: {
            title: raw.now_playing.song.title || "",
            artist: raw.now_playing.song.artist || "",
            albumArt: raw.now_playing.song.art || "",
          },
          duration: raw.now_playing.duration || 0,
          elapsed: raw.now_playing.elapsed || 0,
          playlist: raw.now_playing.playlist || "",
        }
      : null,
    listeners: {
      current: raw.listeners?.current ?? 0,
      unique: raw.listeners?.unique ?? 0,
      total: raw.listeners?.total ?? 0,
    },
    live: {
      isLive: raw.live?.is_live ?? false,
      streamerName: raw.live?.streamer_name || null,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    songHistory: (raw.song_history || []).map((h: any) => ({
      song: {
        title: h.song?.title || "",
        artist: h.song?.artist || "",
        albumArt: h.song?.art || "",
      },
      playedAt: h.played_at
        ? new Date(h.played_at * 1000).toISOString()
        : "",
      duration: h.duration || 0,
    })),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapStreamer(raw: any): Streamer {
  return {
    id: String(raw.id || ""),
    displayName: raw.display_name || raw.streamer_name || raw.username || "Unknown",
    username: raw.streamer_username || raw.username || "",
    isLive: raw.is_active ?? raw.is_online ?? false,
    lastBroadcast: raw.last_broadcast || null,
    broadcastHistory: [],
  };
}

export async function getNowPlaying(
  stationId: string
): Promise<NowPlayingData> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await apiFetch<any>(`/nowplaying/${stationId}`);
  if (result.ok && result.data) {
    return mapNowPlaying(result.data);
  }
  return FALLBACK_NOW_PLAYING;
}

export async function getStations(): Promise<Station[]> {
  const embedUrl = getPublicPlayerUrl();
  const shortcode = getStationShortcode();
  const stationId = Number(getStationId()) || 0;
  return [{
    id: stationId,
    name: shortcode.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    shortcode,
    description: "",
    listen_url: `${getApiBase()}/listen/${getStationId()}/radio.mp3`,
    url: getApiBase(),
    public_player_url: embedUrl,
    is_public: true,
    mounts: [{
      id: 0,
      name: "Default",
      url: `${getApiBase()}/listen/${getStationId()}/radio.mp3`,
      bitrate: 128,
      format: "mp3",
      listeners: { current: 0, unique: 0, total: 0 },
      path: "/radio.mp3",
      is_default: true,
    }],
  }];
}

export function getStationEmbedUrl(station: Station): string {
  const base = (station.public_player_url || `${getApiBase()}/public/${station.shortcode}`);
  return `${base}/embed`;
}

export async function getQueue(): Promise<QueueItem[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await apiFetch<any[]>(`/station/${STATION_ID}/queue`);
  if (result.ok && Array.isArray(result.data)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return result.data.map((item: any) => ({
      song: {
        title: item.song?.title || "",
        artist: item.song?.artist || "",
        albumArt: item.song?.art || "",
      },
      cuedAt: item.cued_at || 0,
      playlist: item.playlist || "",
      isRequest: item.is_request || false,
    }));
  }
  return [];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapStationStatus(raw: any): StationStatus {
  return {
    backendRunning: raw.backend_running ?? raw.backendRunning ?? false,
    frontendRunning: raw.frontend_running ?? raw.frontendRunning ?? false,
  };
}

export async function getStationStatus(
  stationId: string
): Promise<StationStatus> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await apiFetch<any>(
    `/station/${stationId}/status`
  );
  if (result.ok && result.data) {
    return mapStationStatus(result.data);
  }
  return { backendRunning: false, frontendRunning: false };
}

let _savedEnabledPlaylistIds: string[] | null = null;

export async function toggleAutoDJ(): Promise<{ running: boolean }> {
  const status = await getStationStatus(STATION_ID);
  const isRunning = status.backendRunning;
  const action = isRunning ? "off" : "on";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await apiFetch<any>(
    `/station/${STATION_ID}/backend`,
    {
      method: "POST",
      body: JSON.stringify({ action }),
    }
  );
  if (result.ok) {
    return { running: action === "on" };
  }

  // Fallback: toggle playlists on/off (backend endpoint returned 405 or similar)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const plResult = await apiFetch<any[]>(`/station/${STATION_ID}/playlists`);
  if (!plResult.ok || !Array.isArray(plResult.data)) {
    return { running: isRunning };
  }

  if (isRunning) {
    // PAUSE: save which playlists are enabled, then disable all
    _savedEnabledPlaylistIds = plResult.data
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((p: any) => p.is_enabled)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((p: any) => String(p.id));
    for (const id of _savedEnabledPlaylistIds) {
      await apiFetch(`/station/${STATION_ID}/playlist/${id}/toggle`, { method: "PUT" }).catch(() => {});
    }
    return { running: false };
  } else {
    // RESUME: restore previously-enabled playlists
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const idsToRestore = _savedEnabledPlaylistIds || plResult.data.map((p: any) => String(p.id));
    _savedEnabledPlaylistIds = null;
    for (const id of idsToRestore) {
      await apiFetch(`/station/${STATION_ID}/playlist/${id}/toggle`, { method: "PUT" }).catch(() => {});
    }
    return { running: true };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapStationFile(raw: any): StationFile {
  const media = raw.media || raw;
  return {
    id: String(media.id || ""),
    unique_id: media.unique_id || "",
    title: media.title || "",
    artist: media.artist || "",
    album: media.album || "",
    duration: media.length_text || "0:00",
    genre: media.genre || "",
    path: media.path || raw.path || "",
    size: "",
    albumArt: media.art || "",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    playlists: (media.playlists || []).map((p: any) => String(p.id)),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapPlaylist(raw: any): Playlist {
  let schedule: Playlist["schedule"];
  if (raw.schedule_items?.length > 0) {
    const days = [...new Set(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (raw.schedule_items.flatMap((s: any) => s.days ?? []) as number[]).map(Number)
    )];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fmtTime = (val: any): string => {
      if (val == null) return "00:00";
      const n = Number(val);
      if (isNaN(n)) return String(val);
      const h = Math.floor(n / 60);
      const m = n % 60;
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    };
    schedule = {
      days,
      startTime: fmtTime(raw.schedule_items[0]?.start_time),
      endTime: fmtTime(raw.schedule_items[0]?.end_time),
    };
  }
  return {
    id: String(raw.id),
    name: raw.name || "",
    type: raw.type === "scheduled" ? "scheduled" : (raw.type === "on_demand" || raw.type === "ondemand") ? "on_demand" : "standard",
    order: raw.order === "sequential" ? "sequential" : "shuffle",
    weight: raw.weight ?? 10,
    enabled: raw.is_enabled ?? true,
    songCount: raw.num_songs ?? 0,
    songs: [],
    schedule,
  };
}

export async function getStationFiles(): Promise<StationFile[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await apiFetch<any[]>(`/station/${STATION_ID}/files`);
  if (result.ok && Array.isArray(result.data)) {
    return result.data.map(mapStationFile);
  }
  return [];
}

export async function deleteStationFiles(filePaths: string[]): Promise<boolean> {
  if (filePaths.length === 0) return true;
  const result = await apiFetch(`/station/${STATION_ID}/files/batch`, {
    method: "PUT",
    body: JSON.stringify({ do: "delete", files: filePaths }),
  });
  return result.ok;
}

export async function deleteFile(fileId: string): Promise<boolean> {
  const result = await apiFetch(`/station/${STATION_ID}/file/${fileId}`, {
    method: "DELETE",
  });
  return result.ok;
}

export async function updateFileMetadata(
  fileId: string,
  data: Record<string, unknown>
): Promise<boolean> {
  const result = await apiFetch(`/station/${STATION_ID}/file/${fileId}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
  return result.ok;
}

export async function uploadFile(
  file: File,
  directory?: string
): Promise<StationFile | null> {
  const base = getApiBase();
  const key = getApiKey();
  const formData = new FormData();
  formData.append("path", directory || "/");
  formData.append("file", file);
  try {
    const res = await fetch(`${base}/api/station/${STATION_ID}/files/upload`, {
      method: "POST",
      headers: key ? { Authorization: `Bearer ${key}` } : {},
      body: formData,
    });
    if (!res.ok) {
      console.warn(`[AzuraCast] Upload failed: ${res.status} ${res.statusText}`);
      return null;
    }
    const files = await getStationFiles();
    return files[files.length - 1] || null;
  } catch (err) {
    console.warn(`[AzuraCast] Upload error:`, err);
    return null;
  }
}

export async function getPlaylists(): Promise<Playlist[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await apiFetch<any[]>(`/station/${STATION_ID}/playlists`);
  if (result.ok && Array.isArray(result.data)) {
    return result.data.map(mapPlaylist);
  }
  return [];
}

export async function getStationPlaylists(stationId: string): Promise<Playlist[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await apiFetch<any[]>(`/station/${stationId}/playlists`);
  if (result.ok && Array.isArray(result.data)) {
    return result.data.map(mapPlaylist);
  }
  return [];
}

export async function getPlaylistSongs(playlistId: string): Promise<StationFile[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await apiFetch<any[]>(
    `/station/${STATION_ID}/files/list?searchPhrase=playlist:${playlistId}`
  );
  if (result.ok && Array.isArray(result.data)) {
    return result.data.map(mapStationFile);
  }
  return [];
}

export async function createPlaylist(
  data: Partial<Playlist>
): Promise<Playlist> {
  const mappedType = data.type === "standard" ? "default" : (data.type || "default");
  const body: Record<string, unknown> = {
    name: data.name || "New Playlist",
    type: mappedType,
    source: "songs",
    order: data.order || "shuffle",
    weight: data.weight ?? 10,
  };
  if (data.type === "scheduled" && data.schedule && data.schedule.days.length > 0) {
    const dayValues = data.schedule.days.map((d) => Number(d));
    if (dayValues.length === 1 && dayValues[0] === 0) {
      dayValues.push(0);
    }
    const [sh, sm] = data.schedule.startTime.split(":").map(Number);
    const [eh, em] = data.schedule.endTime.split(":").map(Number);
    body.schedule_items = [{
      days: dayValues,
      start_time: sh * 60 + (sm || 0),
      end_time: eh * 60 + (em || 0),
    }];
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await apiFetch<any>(`/station/${STATION_ID}/playlists`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!result.ok || !result.data) {
    throw new Error("Failed to create playlist");
  }
  const plId = result.data.id;
  if (plId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const refreshed = await apiFetch<any>(`/station/${STATION_ID}/playlist/${plId}`);
    if (refreshed.ok && refreshed.data) {
      const mapped = mapPlaylist(refreshed.data);
      if (mapped.schedule) return mapped;
    }
    if (data.type === "scheduled" && data.schedule && data.schedule.days.length > 0) {
      const dayValues = data.schedule.days.map((d) => Number(d));
      if (dayValues.length === 1 && dayValues[0] === 0) dayValues.push(0);
      const [sh, sm] = data.schedule.startTime.split(":").map(Number);
      const [eh, em] = data.schedule.endTime.split(":").map(Number);
      await apiFetch(`/station/${STATION_ID}/playlist/${plId}`, {
        method: "PUT",
        body: JSON.stringify({
          schedule_items: [{
            days: dayValues,
            start_time: sh * 60 + (sm || 0),
            end_time: eh * 60 + (em || 0),
          }],
        }),
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const reRefreshed = await apiFetch<any>(`/station/${STATION_ID}/playlist/${plId}`);
      if (reRefreshed.ok && reRefreshed.data) {
        return mapPlaylist(reRefreshed.data);
      }
    }
  }
  return mapPlaylist(result.data);
}

export async function togglePlaylistEnabled(id: string): Promise<Playlist> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await apiFetch<any>(
    `/station/${STATION_ID}/playlist/${id}/toggle`,
    { method: "PUT" }
  );
  if (!result.ok) {
    throw new Error("Failed to toggle playlist");
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const refreshed = await apiFetch<any>(
    `/station/${STATION_ID}/playlist/${id}`
  );
  if (refreshed.ok && refreshed.data) {
    return mapPlaylist(refreshed.data);
  }
  throw new Error("Failed to fetch playlist after toggle");
}

export async function updatePlaylist(
  id: string,
  data: Partial<Playlist>
): Promise<Playlist> {
  const body: Record<string, unknown> = {};
  if (data.name !== undefined) body.name = data.name;
  if (data.order !== undefined) body.order = data.order;
  if (data.weight !== undefined) body.weight = data.weight;
  if (data.enabled !== undefined) body.is_enabled = data.enabled;
  if (data.type !== undefined) body.type = data.type === "standard" ? "default" : data.type;
  if (data.schedule !== undefined) {
    const dayValues = data.schedule.days.map((d) => Number(d));
    if (dayValues.length === 1 && dayValues[0] === 0) {
      dayValues.push(0);
    }
    if (dayValues.length > 0) {
      const [sh, sm] = data.schedule.startTime.split(":").map(Number);
      const [eh, em] = data.schedule.endTime.split(":").map(Number);
      body.schedule_items = [{
        days: dayValues,
        start_time: sh * 60 + (sm || 0),
        end_time: eh * 60 + (em || 0),
      }];
    } else {
      body.schedule_items = [];
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await apiFetch<any>(
    `/station/${STATION_ID}/playlist/${id}`,
    { method: "PUT", body: JSON.stringify(body) }
  );
  if (result.ok && result.data) {
    return mapPlaylist(result.data);
  }
  throw new Error("Failed to update playlist");
}

export async function deletePlaylist(id: string): Promise<void> {
  await apiFetch(`/station/${STATION_ID}/playlist/${id}`, {
    method: "DELETE",
  });
}

export async function addSongsToPlaylist(
  playlistId: string,
  songIds: string[]
): Promise<boolean> {
  const plId = parseInt(playlistId);
  let allOk = true;
  for (const songId of songIds) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fileResult = await apiFetch<any>(`/station/${STATION_ID}/file/${songId}`);
    if (!fileResult.ok) { allOk = false; continue; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const currentIds: number[] = (fileResult.data?.playlists || []).map((p: any) => Number(p.id ?? p));
    if (!currentIds.includes(plId)) currentIds.push(plId);
    const putResult = await apiFetch(`/station/${STATION_ID}/file/${songId}`, {
      method: "PUT",
      body: JSON.stringify({ playlists: currentIds }),
    });
    if (!putResult.ok) allOk = false;
  }
  return allOk;
}

export async function removeSongFromPlaylist(
  playlistId: string,
  songIdOrIds: string | string[]
): Promise<boolean> {
  const plId = parseInt(playlistId);
  const songIds = Array.isArray(songIdOrIds) ? songIdOrIds : [songIdOrIds];
  let allOk = true;
  for (const songId of songIds) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fileResult = await apiFetch<any>(`/station/${STATION_ID}/file/${songId}`);
    if (!fileResult.ok) { allOk = false; continue; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const currentIds: number[] = (fileResult.data?.playlists || []).map((p: any) => Number(p.id ?? p));
    const newIds = currentIds.filter((id: number) => id !== plId);
    const putResult = await apiFetch(`/station/${STATION_ID}/file/${songId}`, {
      method: "PUT",
      body: JSON.stringify({ playlists: newIds }),
    });
    if (!putResult.ok) allOk = false;
  }
  return allOk;
}

export async function getStreamers(): Promise<Streamer[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await apiFetch<any>(`/station/${STATION_ID}/streamers`);
  if (result.ok && Array.isArray(result.data)) {
    return result.data.map(mapStreamer);
  }
  return FALLBACK_STREAMERS;
}

export async function createStreamer(data: {
  displayName: string;
  username: string;
  password: string;
}): Promise<Streamer> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await apiFetch<any>(`/station/${STATION_ID}/streamers`, {
    method: "POST",
    body: JSON.stringify({
      display_name: data.displayName,
      streamer_username: data.username,
      streamer_password: data.password,
    }),
  });
  if (result.ok && result.data) {
    return mapStreamer(result.data);
  }
  throw new Error("Failed to create streamer");
}

export async function updateStreamer(
  id: string,
  data: Partial<Streamer>
): Promise<Streamer> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await apiFetch<any>(`/station/${STATION_ID}/streamers/${id}`, {
    method: "PUT",
    body: JSON.stringify({
      display_name: data.displayName,
      streamer_username: data.username,
    }),
  });
  if (result.ok && result.data) {
    return mapStreamer(result.data);
  }
  throw new Error("Failed to update streamer");
}

export async function deleteStreamer(id: string): Promise<void> {
  await apiFetch(`/station/${STATION_ID}/streamers/${id}`, {
    method: "DELETE",
  });
}

export async function getAnalytics(): Promise<AnalyticsReport> {
  return {
    totalListeners: { today: 0, week: 0, month: 0 },
    peakConcurrent: 0,
    listenersOverTime: [],
    topSongs: [],
    broadcastHistory: [],
  };
}

export async function getSongHistory(limit = 50): Promise<SongHistoryItem[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await apiFetch<any[]>(`/station/${STATION_ID}/history`, {
    cache: "no-store",
  });
  if (result.ok && Array.isArray(result.data)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return result.data.slice(0, limit).map((h: any) => ({
      song: {
        title: h.song?.title || "Unknown",
        artist: h.song?.artist || "",
        albumArt: h.song?.art || "",
      },
      playedAt: h.played_at
        ? new Date(h.played_at * 1000).toISOString()
        : "",
      duration: h.duration || 0,
    }));
  }
  return [];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getListenerDetails(): Promise<any[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await apiFetch<any[]>(`/station/${STATION_ID}/listeners`);
  if (result.ok && Array.isArray(result.data)) {
    return result.data;
  }
  return [];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapWebhook(raw: any): Webhook {
  const config = raw.config || {};
  return {
    id: String(raw.id),
    name: raw.name || undefined,
    url: config.webhook_url || config.url || "",
    events: raw.triggers || [],
    enabled: raw.is_enabled ?? true,
    secret: config.secret || "",
  };
}

export async function getWebhooks(): Promise<Webhook[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await apiFetch<any[]>(`/station/${STATION_ID}/webhooks`);
  if (result.ok && Array.isArray(result.data)) {
    return result.data.map(mapWebhook);
  }
  return [];
}

export async function createWebhook(
  data: Partial<Webhook>
): Promise<Webhook> {
  const body: Record<string, unknown> = {
    webhook_url: data.url || "",
    triggers: data.events || [],
    type: "generic",
  };
  if (data.name) body.name = data.name;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await apiFetch<any>(`/station/${STATION_ID}/webhooks`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (result.ok && result.data) {
    return mapWebhook(result.data);
  }
  throw new Error("Failed to create webhook");
}

export async function updateWebhook(
  id: string,
  data: Partial<Webhook>
): Promise<Webhook> {
  const body: Record<string, unknown> = {};
  if (data.url !== undefined) body.webhook_url = data.url;
  if (data.events !== undefined) body.triggers = data.events;
  if (data.enabled !== undefined) body.is_enabled = data.enabled;
  if (data.name !== undefined) body.name = data.name;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await apiFetch<any>(`/station/${STATION_ID}/webhook/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  if (result.ok && result.data) {
    return mapWebhook(result.data);
  }
  throw new Error("Failed to update webhook");
}

export async function deleteWebhook(id: string): Promise<void> {
  await apiFetch(`/station/${STATION_ID}/webhook/${id}`, {
    method: "DELETE",
  });
}

export async function testWebhook(
  id: string
): Promise<{ success: boolean }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await apiFetch<any>(`/station/${STATION_ID}/webhook/${id}/test`, {
    method: "PUT",
  });
  return { success: result.ok };
}

export async function toggleWebhook(id: string): Promise<Webhook> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await apiFetch<any>(`/station/${STATION_ID}/webhook/${id}/toggle`, {
    method: "PUT",
  });
  if (result.ok && result.data) {
    return mapWebhook(result.data);
  }
  throw new Error("Failed to toggle webhook");
}

export async function getSettings(): Promise<StationSettings> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stationResult = await apiFetch<any>(`/station/${STATION_ID}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adminResult = await apiFetch<any>(`/admin/station/${STATION_ID}`);
  if (stationResult.ok && stationResult.data) {
    const s = stationResult.data;
    const a = adminResult.ok ? adminResult.data : {};
    const mountUrl = s.mounts?.[0]?.url || "";
    return {
      name: a.name ?? s.name ?? "Radio Station",
      streamUrl: s.listen_url || mountUrl,
      publicPageUrl: s.public_player_url || "",
      autoDJ: true,
      maxListeners: a.max_listeners ?? 500,
      defaultBitrate: s.mounts?.[0]?.bitrate ?? 128,
      publicPageVisible: a.enable_public_page ?? s.is_public ?? true,
      mountPoint: s.mounts?.[0]?.path || "/radio.mp3",
    };
  }
  return { ...FALLBACK_SETTINGS };
}

export async function updateSettings(
  data: Partial<StationSettings>
): Promise<StationSettings> {
  const body: Record<string, unknown> = {};
  if (data.name !== undefined) body.name = data.name;
  if (data.publicPageVisible !== undefined) body.enable_public_page = data.publicPageVisible;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await apiFetch<any>(
    `/admin/station/${STATION_ID}`,
    { method: "PUT", body: JSON.stringify(body) }
  );
  if (result.ok) {
    const current = await getSettings();
    return current;
  }
  throw new Error("Failed to update settings");
}


