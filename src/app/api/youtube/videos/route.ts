/**
 * GET /api/youtube/videos
 *
 * Returns YouTube videos from Firestore in clean JSON format for AI querying.
 * Query params:
 *   - max: number (optional, default 50)
 *   - includeHidden: "true" | "false" (optional, default false)
 *
 * Response: { videos: YouTubeVideo[], channel: YouTubeChannel | null, count: number }
 */

import { NextRequest, NextResponse } from "next/server";
import { getVideos, getChannel } from "@/lib/youtube";

export async function GET(request: NextRequest) {
  try {
    const maxParam = request.nextUrl.searchParams.get("max");
    const includeHidden =
      request.nextUrl.searchParams.get("includeHidden") === "true";

    const [videos, channel] = await Promise.all([
      getVideos({
        max: maxParam ? parseInt(maxParam) : undefined,
        includeHidden,
      }),
      getChannel(),
    ]);

    return NextResponse.json(
      { videos, channel, count: videos.length },
      {
        status: 200,
        headers: {
          "Cache-Control": "public, max-age=60",
          "Content-Type": "application/json",
        },
      }
    );
  } catch (err) {
    console.error("Error fetching YouTube videos:", err);
    return NextResponse.json(
      { error: "Failed to fetch videos", videos: [], channel: null, count: 0 },
      { status: 500 }
    );
  }
}
