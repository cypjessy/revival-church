import { NextRequest, NextResponse } from "next/server";

/**
 * API route for radio station configuration.
 *
 * GET  /api/radio-config  → returns the radioConfig document (public info, no auth)
 * PUT  /api/radio-config  → updates the document (requires Firebase Auth token)
 *
 * Response shape for AI consumption:
 * {
 *   "stationName": "Kingdom Seekers Radio",
 *   "description": "Kingdom Seekers Church Nakuru Radio Station",
 *   "stationId": "2",
 *   "embedUrl": "https://azuracast.histoview.co.ke/public/turningpoint_church/embed?theme=dark",
 *   "streamUrl": "https://azuracast.histoview.co.ke/listen/2/radio.mp3",
 *   "updatedAt": "...",
 *   "updatedBy": "admin-uid"
 * }
 */

// ─── Lazy Firebase init (server-safe) ─────────────────────────────────────

let serverDb: ReturnType<typeof import("firebase/firestore").getFirestore> | null = null;

async function getServerDb() {
  if (serverDb) return serverDb;
  const { initializeApp, getApps } = await import("firebase/app");
  const { getFirestore } = await import("firebase/firestore");

  if (getApps().length === 0) {
    initializeApp({
      apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
      authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    });
  }
  serverDb = getFirestore();
  return serverDb;
}

// ─── Types ────────────────────────────────────────────────────────────────

interface RadioConfigInput {
  stationName: string;
  description: string;
  stationId: string;
  embedUrl: string;
  streamUrl: string;
}

// ─── GET ──────────────────────────────────────────────────────────────────

export async function GET() {
  try {
    const db = await getServerDb();
    const { doc, getDoc } = await import("firebase/firestore");

    const snap = await getDoc(doc(db, "radioConfig", "main"));

    if (!snap.exists()) {
      return NextResponse.json(
        { message: "Radio config not yet configured", data: null },
        { status: 200 },
      );
    }

    const data = snap.data();
    return NextResponse.json(
      {
        message: "OK",
        data: {
          stationName: data.stationName || "",
          description: data.description || "",
          stationId: data.stationId || "",
          embedUrl: data.embedUrl || "",
          streamUrl: data.streamUrl || "",
          updatedAt: data.updatedAt?.toDate?.()?.toISOString() || null,
          updatedBy: data.updatedBy || null,
        },
      },
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
        },
      },
    );
  } catch (error) {
    console.error("GET /api/radio-config error:", error);
    return NextResponse.json(
      { message: "Internal server error", data: null },
      { status: 500 },
    );
  }
}

// ─── PUT ──────────────────────────────────────────────────────────────────

export async function PUT(request: NextRequest) {
  try {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { message: "Unauthorized — valid Firebase Auth token required" },
        { status: 401 },
      );
    }
    const uid = authHeader.slice(7);

    const body: RadioConfigInput = await request.json();

    if (!body.stationName?.trim()) {
      return NextResponse.json(
        { message: "Validation error: 'stationName' is required" },
        { status: 400 },
      );
    }

    const db = await getServerDb();
    const { doc, setDoc, Timestamp } = await import("firebase/firestore");

    await setDoc(doc(db, "radioConfig", "main"), {
      stationName: body.stationName.trim(),
      description: body.description?.trim() || "",
      stationId: body.stationId?.trim() || "",
      embedUrl: body.embedUrl?.trim() || "",
      streamUrl: body.streamUrl?.trim() || "",
      updatedAt: Timestamp.now(),
      updatedBy: uid,
    });

    return NextResponse.json(
      { message: "Radio config updated successfully" },
      { status: 200 },
    );
  } catch (error) {
    console.error("PUT /api/radio-config error:", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 },
    );
  }
}
