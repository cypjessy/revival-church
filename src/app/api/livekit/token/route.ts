import { NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { roomName, identity } = await req.json();

    if (!roomName || !identity) {
      return NextResponse.json(
        { error: "Missing roomName or identity" },
        { status: 400 }
      );
    }

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;

    if (!apiKey || !apiSecret) {
      return NextResponse.json(
        { error: "LiveKit credentials not configured" },
        { status: 500 }
      );
    }

    const at = new AccessToken(apiKey, apiSecret, {
      identity,
      ttl: "1h",
    });

    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const token = await at.toJwt();

    return NextResponse.json({ token, url: process.env.LIVEKIT_URL || "" });
  } catch (error) {
    console.error("LiveKit token error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Token generation failed" },
      { status: 500 }
    );
  }
}
