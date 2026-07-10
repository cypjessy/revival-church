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
      "Content-Length": String(buffer.length),
    },
    body: new Uint8Array(buffer),
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
 * Upload a file directly to BunnyCDN from the client (no server proxy).
 * Used on Capacitor native where the static export has no backend.
 */
export async function directUploadToBunny(
  file: File,
  churchId: string,
  category: string = "gallery"
): Promise<{ cdnUrl: string; fileSize: number; storagePath: string; width: number; height: number }> {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const uuid = crypto.randomUUID();
  const storagePath = `churches/${churchId}/${category}/${uuid}.${ext}`;

  // Client-side validation (mirrors server)
  const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];
  const mimeFromExt: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    avif: "image/avif",
  };
  const mimeType = file.type || mimeFromExt[ext] || "";
  if (!allowedTypes.includes(mimeType)) {
    throw new Error(`Unsupported file type: "${file.type || ext}". Allowed: JPG, PNG, WEBP, GIF, AVIF`);
  }
  const maxSize = 10 * 1024 * 1024;
  if (file.size > maxSize) {
    throw new Error(`File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB. Max: 10MB`);
  }

  const url = `https://${CLIENT_BUNNY_STORAGE_HOST}/${CLIENT_BUNNY_STORAGE_ZONE}/${storagePath}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      AccessKey: CLIENT_BUNNY_API_KEY,
      "Content-Type": mimeType,
    },
    body: file,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`BunnyCDN upload failed (${res.status}): ${text}`);
  }

  // Detect dimensions client-side (best-effort)
  let width = 0;
  let height = 0;
  try {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    await new Promise<void>((resolve, reject) => {
      img.onload = () => { width = img.naturalWidth; height = img.naturalHeight; URL.revokeObjectURL(objectUrl); resolve(); };
      img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(); };
      img.src = objectUrl;
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
 * Upload a file — uses direct-to-Bunny when running in Capacitor native (APK),
 * otherwise falls back to the Vercel server proxy for same-origin safety on web.
 */
export async function uploadFile(
  file: File,
  churchId: string,
  category: string = "gallery"
): Promise<{ cdnUrl: string; fileSize: number; storagePath: string; width: number; height: number }> {
  // Detect Capacitor native: use direct upload (no server available in static export)
  if (typeof window !== "undefined" &&
      typeof (window as any).Capacitor?.isNativePlatform === "function" &&
      (window as any).Capacitor.isNativePlatform()) {
    return directUploadToBunny(file, churchId, category);
  }

  // Web: use the Vercel server proxy
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
