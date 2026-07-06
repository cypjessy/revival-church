/**
 * GET /api/youtube/live
 *
 * Checks if the YouTube channel is currently live streaming.
 * Query params: channelId (required)
 *
 * Returns: { isLive: boolean, liveTitle?: string, liveViewers?: number }
 */

import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const channelId = request.nextUrl.searchParams.get("channelId");
    if (!channelId) {
      return NextResponse.json(
        { error: "channelId query param is required" },
        { status: 400 }
      );
    }

    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "YOUTUBE_API_KEY not configured" },
        { status: 500 }
      );
    }

    // Search for active live broadcasts on this channel
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&eventType=live&type=video&key=${apiKey}`
    );
    if (!res.ok) {
      return NextResponse.json({ isLive: false }, { status: 200 });
    }

    const data = await res.json();
    const liveItem = data.items?.[0];

    if (!liveItem) {
      return NextResponse.json({ isLive: false }, { status: 200 });
    }

    return NextResponse.json(
      {
        isLive: true,
        liveTitle: liveItem.snippet?.title || "",
        liveViewers: 0, // requires separate API call
        videoId: liveItem.id?.videoId || "",
      },
      {
        status: 200,
        headers: { "Cache-Control": "public, max-age=30" },
      }
    );
  } catch {
    return NextResponse.json({ isLive: false }, { status: 200 });
  }
}
