import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Note: file:// origins send "null" per the Fetch spec, so we use * as fallback
const ALLOWED_ORIGINS = [
  "capacitor://localhost",
  "http://localhost",
  "http://localhost:3000",
  "http://localhost:5173",
  "https://mountain-of-delivarance.vercel.app",
  "null",
];

/**
 * Middleware to add CORS headers for Capacitor Android APK.
 *
 * The APK runs in a WebView from `file://` origin, so all fetches to the
 * Vercel-hosted API are cross-origin. Without proper CORS headers the
 * browser blocks the request before it reaches the API route.
 */
export function middleware(request: NextRequest) {
  const origin = request.headers.get("origin") || "";
  const isApiRoute = request.nextUrl.pathname.startsWith("/api/");

  // Only apply CORS to API routes
  if (!isApiRoute) {
    return NextResponse.next();
  }

  // Allow any origin — the APK sends requests from file:// (origin: "null")
  const allowedOrigin = ALLOWED_ORIGINS.some((o) => origin.startsWith(o))
    ? origin
    : "*";

  // Handle OPTIONS preflight
  if (request.method === "OPTIONS") {
    return new NextResponse(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": allowedOrigin,
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  // Add CORS headers to the response
  const response = NextResponse.next();
  response.headers.set("Access-Control-Allow-Origin", allowedOrigin);
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");

  return response;
}

export const config = {
  matcher: "/api/:path*",
};
