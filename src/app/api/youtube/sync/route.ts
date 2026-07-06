/**
 * POST /api/youtube/sync
 *
 * Fetches channel info and all uploaded videos from YouTube Data API.
 * Returns data so the client can write it to Firestore (no firebase-admin needed).
 *
 * Body: { channelId: string }
 * Returns: { channel: YouTubeChannel, videos: YouTubeVideo[] }
 */

import { NextRequest, NextResponse } from "next/server";

interface YouTubeVideoSnippet {
  title: string;
  description: string;
  thumbnails: { medium?: { url: string }; high?: { url: string } };
  channelTitle: string;
  channelId: string;
  publishedAt: string;
  resourceId?: { videoId: string };
}

interface YouTubeVideoItem {
  id: string;
  snippet?: YouTubeVideoSnippet;
  contentDetails?: { duration: string; videoId?: string };
}

function parseISO8601Duration(duration: string): number {
  const match = duration.match(/PT(\d+H)?(\d+M)?(\d+S)?/);
  if (!match) return 0;
  const hours = parseInt(match[1]?.replace("H", "") || "0");
  const mins = parseInt(match[2]?.replace("M", "") || "0");
  const secs = parseInt(match[3]?.replace("S", "") || "0");
  return hours * 3600 + mins * 60 + secs;
}

export async function POST(request: NextRequest) {
  try {
    const { channelId } = await request.json();
    if (!channelId) {
      return NextResponse.json({ error: "channelId is required" }, { status: 400 });
    }

    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "YOUTUBE_API_KEY not configured on server" },
        { status: 500 }
      );
    }

    // 1. Fetch channel info
    const channelRes = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&id=${channelId}&key=${apiKey}`
    );
    if (!channelRes.ok) {
      const err = await channelRes.text();
      return NextResponse.json(
        { error: `YouTube API error (channels): ${err}` },
        { status: 502 }
      );
    }
    const channelData = await channelRes.json();
    const channelItem = channelData.items?.[0];
    if (!channelItem) {
      return NextResponse.json(
        { error: "Channel not found" },
        { status: 404 }
      );
    }

    const channel = {
      channelId: channelItem.id,
      title: channelItem.snippet?.title || "",
      thumbnail: channelItem.snippet?.thumbnails?.high?.url ||
                 channelItem.snippet?.thumbnails?.medium?.url || "",
      subscriberCount: channelItem.statistics?.subscriberCount || "0",
      videoCount: parseInt(channelItem.statistics?.videoCount || "0"),
    };

    // 2. Get uploads playlist ID (UC{channelId} or from contentDetails)
    const uploadsPlaylistId =
      channelItem.contentDetails?.relatedPlaylists?.uploads || `UU${channelId}`;

    // 3. Fetch all video IDs from the uploads playlist (max 500)
    const allVideoIds: string[] = [];
    let nextPageToken: string | undefined;
    let pages = 0;

    do {
      const plRes = await fetch(
        `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${uploadsPlaylistId}&key=${apiKey}${nextPageToken ? `&pageToken=${nextPageToken}` : ""}`
      );
      if (!plRes.ok) {
        const err = await plRes.text();
        return NextResponse.json(
          { error: `YouTube API error (playlistItems): ${err}` },
          { status: 502 }
        );
      }
      const plData = await plRes.json();

      for (const item of (plData.items || []) as YouTubeVideoItem[]) {
        const videoId = item.snippet?.resourceId?.videoId;
        if (videoId) allVideoIds.push(videoId);
      }

      nextPageToken = plData.nextPageToken;
      pages++;
    } while (nextPageToken && pages < 10); // max ~500 videos

    // 4. Fetch video details (duration) in batches of 50
    const videos: Array<{
      id: string;
      title: string;
      description: string;
      thumbnail: string;
      channelTitle: string;
      channelId: string;
      publishedAt: string;
      duration: number;
      position: number;
      isFeatured: boolean;
      isHidden: boolean;
    }> = [];

    for (let i = 0; i < allVideoIds.length; i += 50) {
      const batch = allVideoIds.slice(i, i + 50);
      const detailsRes = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${batch.join(",")}&key=${apiKey}`
      );
      if (!detailsRes.ok) continue;
      const detailsData = await detailsRes.json();

      for (const item of (detailsData.items || []) as YouTubeVideoItem[]) {
        const snippet = item.snippet;
        const videoId = item.id || item.contentDetails?.videoId || "";
        if (!videoId || !snippet) continue;

        videos.push({
          id: videoId,
          title: snippet.title || "Untitled",
          description: snippet.description || "",
          thumbnail:
            snippet.thumbnails?.high?.url ||
            snippet.thumbnails?.medium?.url ||
            "",
          channelTitle: snippet.channelTitle || "",
          channelId: snippet.channelId || channelId,
          publishedAt: snippet.publishedAt || "",
          duration: parseISO8601Duration(
            item.contentDetails?.duration || "PT0S"
          ),
          position: videos.length,
          isFeatured: false,
          isHidden: false,
        });
      }
    }

    return NextResponse.json(
      { channel, videos },
      {
        status: 200,
        headers: {
          "Cache-Control": "public, max-age=60",
          "Content-Type": "application/json",
        },
      }
    );
  } catch (err) {
    console.error("YouTube sync error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
