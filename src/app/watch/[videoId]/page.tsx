import { getVideos } from "@/lib/youtube";
import WatchPageClient from "./WatchPageClient";

export const dynamicParams = false;

export async function generateStaticParams() {
  try {
    const videos = await getVideos({ max: 500 });
    return videos.map((v) => ({ videoId: v.id }));
  } catch (e) {
    console.warn("[WatchPage] generateStaticParams failed — no watch pages will be pre-generated.", e);
    return [];
  }
}

export default function WatchPage() {
  return <WatchPageClient />;
}
