"use client";

import { useYouTubeLive } from "@/hooks/useYouTubeLive";
import BottomNav from "./BottomNav";

interface Props {
  activeTab: "home" | "radio" | "meetings" | "watch" | "gallery";
  showWatchBadge?: boolean;
}

export default function BottomNavBar({ activeTab, showWatchBadge = false }: Props) {
  const { status } = useYouTubeLive();
  return <BottomNav activeTab={activeTab} showWatchBadge={showWatchBadge} showLiveBadge={status.isLive} />;
}
