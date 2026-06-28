import { NextResponse } from "next/server";
import { addCorsHeaders, handleCorsPreflight } from "@/lib/cors";

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const BASE = "https://www.googleapis.com/youtube/v3";

interface YouTubeVideoItem {
  id: string;
  snippet: {
    title: string;
    description: string;
    publishedAt: string;
    thumbnails: { high?: { url: string }; medium?: { url: string }; default?: { url: string } };
    tags?: string[];
    categoryId?: string;
  };
  contentDetails: { duration: string };
  statistics?: { viewCount?: string };
}

function parseISO8601Duration(d: string): string {
  const m = d.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return d;
  const h = parseInt(m[1] || "0");
  const mn = parseInt(m[2] || "0");
  const s = parseInt(m[3] || "0");
  if (h > 0) return `${h}:${String(mn).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${mn}:${String(s).padStart(2, "0")}`;
}

const CATEGORY_MAP: Record<string, string> = {
  "1": "announcement",
  "2": "announcement",
  "10": "worship",
  "11": "worship",
  "12": "worship",
  "17": "event",
  "18": "event",
  "19": "testimony",
  "20": "testimony",
  "22": "bible-study",
  "23": "bible-study",
  "24": "bible-study",
  "25": "sermon",
  "26": "sermon",
  "28": "sermon",
  "29": "sermon",
};

function mapCategory(youtubeCategoryId: string | undefined, title: string, description: string): string {
  if (youtubeCategoryId && CATEGORY_MAP[youtubeCategoryId]) return CATEGORY_MAP[youtubeCategoryId];
  const t = (title + " " + description).toLowerCase();
  if (/\bsermon\b|\bmessage\b|\bpreach\b|\bteaching\b|\bword\b/i.test(t)) return "sermon";
  if (/\bworship\b|\bpraise\b|\bsong\b|\bmusic\b|\bhymn\b/i.test(t)) return "worship";
  if(/\btestimony\b|\btestimonial\b|\bstory\b|\btestify\b/i.test(t)) return "testimony";
  if (/\bbible.?study\b|\bscripture\b|\bromans\b|\bgospel\b/i.test(t)) return "bible-study";
  if (/\bevent\b|\bconference\b|\byouth\b|\bcamp\b/i.test(t)) return "event";
  return "sermon";
}

export async function OPTIONS(req: Request) {
  return handleCorsPreflight(req);
}

export async function POST(req: Request) {
  try {
    if (!YOUTUBE_API_KEY) {
      return addCorsHeaders(NextResponse.json({ error: "YOUTUBE_API_KEY not configured" }, { status: 500 }), req);
    }

    const channelId = process.env.NEXT_PUBLIC_YOUTUBE_CHANNEL_ID;
    if (!channelId) {
      return addCorsHeaders(NextResponse.json({ error: "NEXT_PUBLIC_YOUTUBE_CHANNEL_ID not configured" }, { status: 500 }), req);
    }

    // 1. Fetch channel info
    const channelRes = await fetch(
      `${BASE}/channels?part=snippet,statistics&id=${channelId}&key=${YOUTUBE_API_KEY}`
    );
    if (!channelRes.ok) {
      const err = await channelRes.text();
      return addCorsHeaders(NextResponse.json({ error: `YouTube API error (channel): ${err}` }, { status: 502 }), req);
    }
    const channelData = await channelRes.json();
    const channelItem = channelData?.items?.[0];
    if (!channelItem) {
      return addCorsHeaders(NextResponse.json({ error: "Channel not found" }, { status: 404 }), req);
    }

    const channel = {
      id: channelItem.id,
      name: channelItem.snippet?.title || "",
      avatar: channelItem.snippet?.thumbnails?.high?.url || channelItem.snippet?.thumbnails?.default?.url || "",
      subscribers: parseInt(channelItem.statistics?.subscriberCount || "0"),
      videoCount: parseInt(channelItem.statistics?.videoCount || "0"),
      views: parseInt(channelItem.statistics?.viewCount || "0"),
      previousTotalViews: 0,
      weeklyViews: 0,
    };

    // 2. Fetch all uploaded videos via the uploads playlist
    const uploadsPlaylistId = "UU" + channelId.replace(/^UC/, "");
    const allVideoIds: string[] = [];
    let nextPageToken: string | undefined;

    do {
      const searchParams = new URLSearchParams({
        part: "snippet",
        playlistId: uploadsPlaylistId,
        maxResults: "50",
        key: YOUTUBE_API_KEY,
      });
      if (nextPageToken) searchParams.set("pageToken", nextPageToken);

      const plRes = await fetch(`${BASE}/playlistItems?${searchParams}`);
      if (!plRes.ok) {
        const err = await plRes.text();
        return addCorsHeaders(NextResponse.json({ error: `YouTube API error (playlistItems): ${err}` }, { status: 502 }), req);
      }
      const plData = await plRes.json();

      for (const item of plData.items || []) {
        const vid = item.snippet?.resourceId?.videoId;
        if (vid) allVideoIds.push(vid);
      }

      nextPageToken = plData.nextPageToken;
    } while (nextPageToken && allVideoIds.length < 500);

    // 3. Fetch video details (duration, statistics) in batches of 50
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const videos: any[] = [];

    for (let i = 0; i < allVideoIds.length; i += 50) {
      const batch = allVideoIds.slice(i, i + 50);
      const vidRes = await fetch(
        `${BASE}/videos?part=contentDetails,snippet,statistics&id=${batch.join(",")}&key=${YOUTUBE_API_KEY}`
      );
      if (!vidRes.ok) continue;
      const vidData = await vidRes.json();

      for (const item of vidData.items || []) {
        const s = item.snippet || {};
        videos.push({
          youtubeId: item.id,
          title: s.title || "Untitled",
          description: s.description || "",
          thumbnail: s.thumbnails?.high?.url || s.thumbnails?.medium?.url || s.thumbnails?.default?.url || "",
          duration: parseISO8601Duration(item.contentDetails?.duration || "PT0S"),
          publishedAt: s.publishedAt || "",
          views: parseInt(item.statistics?.viewCount || "0"),
          category: mapCategory(s.categoryId, s.title, s.description),
          tags: s.tags || [],
          isFeatured: false,
          isHidden: false,
          seriesId: null,
        });
      }
    }

    return addCorsHeaders(NextResponse.json({ channel, videos }), req);
  } catch (error) {
    console.error("YouTube sync error:", error);
    return addCorsHeaders(
      NextResponse.json(
        { error: error instanceof Error ? error.message : "Unknown error" },
        { status: 500 }
      ),
      req
    );
  }
}
