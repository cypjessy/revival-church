/**
 * API fetch helper that routes to Vercel when the app runs in Capacitor (APK).
 * In local development (next dev), relative paths work fine.
 * In production (static export in Capacitor), we need the absolute Vercel URL.
 */
const API_BASE = (process.env.NEXT_PUBLIC_VERCEL_URL || "").replace(/\/+$/, "");

/** Detect if running inside Capacitor native WebView */
function isCapacitorNative(): boolean {
  return typeof window !== "undefined" && !!(window as any).Capacitor?.isNative;
}

export function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  // ═══ 1. Android emulator connecting to host dev server ═══
  // 10.0.2.2 is the Android emulator's alias for the host machine.
  // The dev server has API routes, so use relative URLs.
  if (typeof window !== "undefined" && window.location.hostname === "10.0.2.2") {
    return fetch(input, init);
  }

  // ═══ 2. Capacitor native (Android APK / real device) ═══
  // Static export has no server — route all API calls to Vercel.
  if (isCapacitorNative()) {
    if (!API_BASE) {
      console.warn(
        "[apiFetch] Capacitor native detected but NEXT_PUBLIC_VERCEL_URL is not set. " +
        "API calls will fail. Add it to .env.local and rebuild."
      );
    }
    const url = typeof input === "string" && API_BASE
      ? `${API_BASE}${input}`
      : input;
    return fetch(url, init);
  }

  // ═══ 3. Web dev server (localhost) ═══
  if (typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")) {
    return fetch(input, init);
  }

  // ═══ 4. Production web ═══
  const url = typeof input === "string" && API_BASE
    ? `${API_BASE}${input}`
    : input;
  return fetch(url, init);
}
