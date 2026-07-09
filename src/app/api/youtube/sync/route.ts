import { NextRequest, NextResponse } from "next/server";

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || "";

interface YouTubeChannelResult {
  channelId: string;
  title: string;
  thumbnail: string;
  subscriberCount: string;
  videoCount: number;
}

interface YouTubeVideoResult {
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
}

async function fetchWithRetry(url: string, retries = 3): Promise<any> {
  for (let i = 0; i < retries; i++) {
    const res = await fetch(url);
    if (res.ok) return res.json();
    if (res.status === 403) {
      throw new Error("YouTube API quota exceeded or API key invalid");
    }
    if (res.status === 404) {
      throw new Error("Channel not found. Check the channel ID.");
    }
    if (i < retries - 1) {
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    } else {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `YouTube API error: ${res.status}`);
    }
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!YOUTUBE_API_KEY) {
      return NextResponse.json(
        { error: "YouTube API key not configured. Set YOUTUBE_API_KEY in environment variables." },
        { status: 500 }
      );
    }

    const { channelId } = await req.json();

    if (!channelId || typeof channelId !== "string") {
      return NextResponse.json(
        { error: "channelId is required" },
        { status: 400 }
      );
    }

    // 1. Fetch channel info
    const channelUrl = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&id=${channelId}&key=${YOUTUBE_API_KEY}`;
    const channelData = await fetchWithRetry(channelUrl);

    if (!channelData.items || channelData.items.length === 0) {
      return NextResponse.json(
        { error: "Channel not found" },
        { status: 404 }
      );
    }

    const channelItem = channelData.items[0];
    const uploadsPlaylistId = channelItem.contentDetails?.relatedPlaylists?.uploads;

    if (!uploadsPlaylistId) {
      return NextResponse.json(
        { error: "No uploads playlist found for this channel" },
        { status: 404 }
      );
    }

    const channel: YouTubeChannelResult = {
      channelId,
      title: channelItem.snippet?.title || "Unknown",
      thumbnail: channelItem.snippet?.thumbnails?.medium?.url || channelItem.snippet?.thumbnails?.default?.url || "",
      subscriberCount: channelItem.statistics?.subscriberCount || "0",
      videoCount: parseInt(channelItem.statistics?.videoCount || "0"),
    };

    // 2. Fetch all videos from uploads playlist (max 500)
    const videos: YouTubeVideoResult[] = [];
    let nextPageToken: string | undefined;
    const maxVideos = 500;

    while (videos.length < maxVideos) {
      const playlistUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${uploadsPlaylistId}&key=${YOUTUBE_API_KEY}${nextPageToken ? `&pageToken=${nextPageToken}` : ""}`;
      const playlistData = await fetchWithRetry(playlistUrl);

      if (!playlistData.items) break;

      for (const item of playlistData.items) {
        const videoId = item.snippet?.resourceId?.videoId;
        if (!videoId) continue;

        videos.push({
          id: videoId,
          title: item.snippet?.title || "Untitled",
          description: item.snippet?.description || "",
          thumbnail: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || "",
          channelTitle: item.snippet?.channelTitle || "",
          channelId,
          publishedAt: item.snippet?.publishedAt || "",
          duration: 0, // will be filled below
          position: videos.length,
          isFeatured: false,
          isHidden: false,
        });
      }

      nextPageToken = playlistData.nextPageToken;
      if (!nextPageToken) break;
    }

    // 3. Fetch durations in batches of 50
    for (let i = 0; i < videos.length; i += 50) {
      const batch = videos.slice(i, i + 50);
      const videoIds = batch.map((v) => v.id).join(",");
      const durationUrl = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${videoIds}&key=${YOUTUBE_API_KEY}`;
      const durationData = await fetchWithRetry(durationUrl);

      if (durationData.items) {
        const durationMap = new Map<string, number>();
        for (const item of durationData.items) {
          const isoDuration = item.contentDetails?.duration || "PT0S";
          durationMap.set(item.id, parseISODuration(isoDuration));
        }
        for (const video of batch) {
          video.duration = durationMap.get(video.id) || 0;
        }
      }
    }

    return NextResponse.json({ channel, videos });
  } catch (err: any) {
    console.error("YouTube sync error:", err);
    return NextResponse.json(
      { error: err.message || "Sync failed" },
      { status: 500 }
    );
  }
}

function parseISODuration(iso: string): number {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const hours = parseInt(match[1] || "0");
  const minutes = parseInt(match[2] || "0");
  const seconds = parseInt(match[3] || "0");
  return hours * 3600 + minutes * 60 + seconds;
}
