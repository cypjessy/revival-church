import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const BASE = "https://www.googleapis.com/youtube/v3";

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
  "1": "announcement", "2": "announcement", "10": "worship", "11": "worship",
  "12": "worship", "17": "event", "18": "event", "19": "testimony",
  "20": "testimony", "22": "bible-study", "23": "bible-study", "24": "bible-study",
  "25": "sermon", "26": "sermon", "28": "sermon", "29": "sermon",
};

function mapCategory(youtubeCategoryId: string | undefined, title: string, description: string): string {
  if (youtubeCategoryId && CATEGORY_MAP[youtubeCategoryId]) return CATEGORY_MAP[youtubeCategoryId];
  const t = (title + " " + description).toLowerCase();
  if (/\bsermon\b|\bmessage\b|\bpreach\b|\bteaching\b|\bword\b/i.test(t)) return "sermon";
  if (/\bworship\b|\bpraise\b|\bsong\b|\bmusic\b|\bhymn\b/i.test(t)) return "worship";
  if (/\btestimony\b|\btestimonial\b|\bstory\b|\btestify\b/i.test(t)) return "testimony";
  if (/\bbible.?study\b|\bscripture\b|\bromans\b|\bgospel\b/i.test(t)) return "bible-study";
  if (/\bevent\b|\bconference\b|\byouth\b|\bcamp\b/i.test(t)) return "event";
  return "sermon";
}

export async function GET() {
  try {
    if (!YOUTUBE_API_KEY) {
      return NextResponse.json({ error: "YOUTUBE_API_KEY not configured" }, { status: 500 });
    }

    const channelId = process.env.NEXT_PUBLIC_YOUTUBE_CHANNEL_ID;
    if (!channelId) {
      return NextResponse.json({ error: "NEXT_PUBLIC_YOUTUBE_CHANNEL_ID not configured" }, { status: 500 });
    }

    // Search for any active live stream on this channel
    const searchParams = new URLSearchParams({
      part: "snippet",
      channelId,
      eventType: "live",
      type: "video",
      key: YOUTUBE_API_KEY,
    });

    const searchRes = await fetch(`${BASE}/search?${searchParams}`);
    if (!searchRes.ok) {
      const err = await searchRes.text();
      return NextResponse.json({ error: `YouTube search API error: ${err}` }, { status: 502 });
    }

    const searchData = await searchRes.json();
    const liveItem = searchData?.items?.[0];
    if (!liveItem) {
      return NextResponse.json({ isLive: false, video: null });
    }

    const videoId = liveItem.id?.videoId;
    if (!videoId) {
      return NextResponse.json({ isLive: false, video: null });
    }

    // Fetch detailed video info (duration, statistics) — costs ~1 quota unit
    const vidRes = await fetch(
      `${BASE}/videos?part=contentDetails,snippet,statistics&id=${videoId}&key=${YOUTUBE_API_KEY}`
    );
    if (!vidRes.ok) {
      // Fall back to snippet-only data
      const s = liveItem.snippet || {};
      return NextResponse.json({
        isLive: true,
        video: {
          youtubeId: videoId,
          title: s.title || "Untitled",
          description: s.description || "",
          thumbnail: s.thumbnails?.high?.url || s.thumbnails?.medium?.url || s.thumbnails?.default?.url || "",
          duration: "",
          publishedAt: s.publishedAt || new Date().toISOString(),
          views: 0,
          category: mapCategory(undefined, s.title || "", s.description || ""),
          tags: [],
          isFeatured: true,
          isHidden: false,
          seriesId: null,
        },
      });
    }

    const vidData = await vidRes.json();
    const item = vidData?.items?.[0];
    if (!item) {
      return NextResponse.json({ isLive: true, video: null });
    }

    const s = item.snippet || {};
    const video = {
      youtubeId: videoId,
      title: s.title || "Untitled",
      description: s.description || "",
      thumbnail: s.thumbnails?.high?.url || s.thumbnails?.medium?.url || s.thumbnails?.default?.url || "",
      duration: parseISO8601Duration(item.contentDetails?.duration || "PT0S"),
      publishedAt: s.publishedAt || new Date().toISOString(),
      views: parseInt(item.statistics?.viewCount || "0"),
      category: mapCategory(s.categoryId, s.title, s.description),
      tags: s.tags || [],
      isFeatured: true,
      isHidden: false,
      seriesId: null,
    };

    return NextResponse.json({ isLive: true, video });
  } catch (error) {
    console.error("YouTube live check error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
