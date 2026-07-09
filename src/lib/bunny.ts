// Server-side env vars (not available in client bundle)
export const BUNNY_STORAGE_ZONE = process.env.BUNNY_STORAGE_ZONE || "histoview";
export const BUNNY_STORAGE_HOST = process.env.BUNNY_STORAGE_HOST || "storage.bunnycdn.com";
export const BUNNY_CDN_URL = process.env.BUNNY_CDN_URL || "https://histoview.b-cdn.net";
export const BUNNY_API_KEY = process.env.BUNNY_STORAGE_API_KEY || "";

// Client-side env vars (baked into JS bundle via NEXT_PUBLIC_ prefix)
export const CLIENT_BUNNY_API_KEY =
  process.env.NEXT_PUBLIC_BUNNY_STORAGE_API_KEY || "";
export const CLIENT_BUNNY_STORAGE_ZONE =
  process.env.NEXT_PUBLIC_BUNNY_STORAGE_ZONE || "histoview";
export const CLIENT_BUNNY_STORAGE_HOST =
  process.env.NEXT_PUBLIC_BUNNY_STORAGE_HOST || "storage.bunnycdn.com";
export const CLIENT_BUNNY_CDN_URL =
  process.env.NEXT_PUBLIC_BUNNY_CDN_URL || "https://histoview.b-cdn.net";

export interface BunnyFileInfo {
  guid: string;
  storagePath: string;
  cdnUrl: string;
  fileName: string;
  length: number;
  lastChanged: string;
  isDirectory: boolean;
  contentType?: string;
}

export interface BunnyStorageStats {
  totalBytes: number;
  totalFiles: number;
  totalDirectories: number;
}

/**
 * Upload a file buffer to BunnyCDN storage zone.
 */
export async function uploadToBunny(
  buffer: Buffer,
  storagePath: string,
  contentType: string = "application/octet-stream"
): Promise<{ success: boolean; cdnUrl: string }> {
  const url = `https://${BUNNY_STORAGE_HOST}/${BUNNY_STORAGE_ZONE}/${storagePath}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      AccessKey: BUNNY_API_KEY,
      "Content-Type": contentType,
    },
    body: buffer as unknown as ReadableStream,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`BunnyCDN upload failed (${res.status}): ${text}`);
  }
  return {
    success: true,
    cdnUrl: `${BUNNY_CDN_URL}/${storagePath}`,
  };
}

/**
 * Delete a file from BunnyCDN storage zone.
 */
export async function deleteFromBunny(storagePath: string): Promise<boolean> {
  const url = `https://${BUNNY_STORAGE_HOST}/${BUNNY_STORAGE_ZONE}/${storagePath}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: {
      AccessKey: BUNNY_API_KEY,
    },
  });
  if (res.status === 404) return true; // already gone
  return res.ok;
}

/**
 * List files in a directory path.
 */
export async function listBunnyFiles(prefix: string): Promise<BunnyFileInfo[]> {
  const url = `https://${BUNNY_STORAGE_HOST}/${BUNNY_STORAGE_ZONE}/${prefix}`;
  const res = await fetch(url, {
    headers: { AccessKey: BUNNY_API_KEY },
  });
  if (!res.ok) throw new Error(`BunnyCDN list failed (${res.status})`);
  const data = await res.json();
  return data as BunnyFileInfo[];
}

/**
 * Get storage usage stats for the entire zone.
 */
export async function getBunnyStorageStats(): Promise<BunnyStorageStats> {
  try {
    const url = `https://${BUNNY_STORAGE_HOST}/${BUNNY_STORAGE_ZONE}/`;
    const res = await fetch(url, {
      headers: { AccessKey: BUNNY_API_KEY },
    });
    if (!res.ok) throw new Error(`BunnyCDN stats failed (${res.status})`);
    const files: BunnyFileInfo[] = await res.json();
    const totalBytes = files.reduce((sum, f) => sum + (f.isDirectory ? 0 : f.length), 0);
    const totalFiles = files.filter((f) => !f.isDirectory).length;
    const totalDirectories = files.filter((f) => f.isDirectory).length;
    return { totalBytes, totalFiles, totalDirectories };
  } catch {
    // Fallback to mock stats for UI development
    return { totalBytes: 2.4 * 1024 * 1024 * 1024, totalFiles: 312, totalDirectories: 4 };
  }
}

/**
 * Purge CDN cache for a specific URL or the entire zone.
 */
export async function purgeBunnyCache(url?: string): Promise<boolean> {
  const purgeUrl = url
    ? `https://api.bunny.net/purge?url=${encodeURIComponent(url)}`
    : `https://api.bunny.net/purge?zone=${BUNNY_STORAGE_ZONE}`;
  const res = await fetch(purgeUrl, {
    method: "POST",
    headers: {
      AccessKey: BUNNY_API_KEY,
    },
  });
  return res.ok;
}

/**
 * Upload a file directly to BunnyCDN from the client side.
 * Uses Capacitor's native HTTP plugin on Android (bypasses CORS)
 * Falls back to regular fetch on web (will fail due to CORS on direct BunnyCDN API — use Vercel proxy instead).
 */
export async function uploadToBunnyClient(
  file: File,
  churchId: string,
  category: string = "gallery"
): Promise<{ cdnUrl: string; fileSize: number; storagePath: string; width: number; height: number }> {
  const ext = file.name.split(".").pop() || "jpg";
  const uuid = crypto.randomUUID();
  const storagePath = `churches/${churchId}/${category}/${uuid}.${ext}`;
  const url = `https://${CLIENT_BUNNY_STORAGE_HOST}/${CLIENT_BUNNY_STORAGE_ZONE}/${storagePath}`;
  const headers = {
    AccessKey: CLIENT_BUNNY_API_KEY,
    "Content-Type": file.type || "application/octet-stream",
  };
  const buffer = await file.arrayBuffer();

  // Use CapacitorHttp (bypasses CORS on Android native)
  const { CapacitorHttp } = await import("@capacitor/core");
  const response = await CapacitorHttp.put({
    url,
    headers,
    data: buffer, // CapacitorHttp supports ArrayBuffer natively
  });
  if (response.status >= 400) {
    const errMsg = typeof response.data === "string" ? response.data : JSON.stringify(response.data);
    throw new Error(`BunnyCDN upload failed (${response.status}): ${errMsg}`);
  }

  // Detect dimensions client-side (best-effort)
  let width = 0;
  let height = 0;
  try {
    const img = new Image();
    const url = URL.createObjectURL(file);
    await new Promise<void>((resolve, reject) => {
      img.onload = () => { width = img.naturalWidth; height = img.naturalHeight; URL.revokeObjectURL(url); resolve(); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(); };
      img.src = url;
    });
  } catch {
    // Non-fatal — dimensions default to 0
  }

  return {
    cdnUrl: `${CLIENT_BUNNY_CDN_URL}/${storagePath}`,
    fileSize: file.size,
    storagePath,
    width,
    height,
  };
}

/**
 * Shared upload helper that routes to the right upload method based on platform.
 * - On Capacitor (Android APK): uploads directly to BunnyCDN via native HTTP
 * - On web: goes through Vercel proxy
 */
export async function uploadFile(
  file: File,
  churchId: string,
  category: string = "gallery"
): Promise<{ cdnUrl: string; fileSize: number; storagePath: string; width: number; height: number }> {
  const isCapacitor = typeof window !== "undefined" && !!(window as any).Capacitor?.isNative;

  if (isCapacitor) {
    return uploadToBunnyClient(file, churchId, category);
  }

  // Web: go through Vercel proxy using apiFetch for proper routing
  const { apiFetch } = await import("@/lib/api");
  const formData = new FormData();
  formData.append("file", file);
  formData.append("church_id", churchId);
  formData.append("category", category);
  const res = await apiFetch("/api/content/upload", { method: "POST", body: formData });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Upload failed");
  }
  return res.json();
}

/**
 * Format bytes to human-readable size.
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + " " + units[i];
}
