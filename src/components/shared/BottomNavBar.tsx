"use client";

import BottomNav from "./BottomNav";

interface Props {
  activeTab: "home" | "radio" | "meetings" | "gallery" | "tv";
}

export default function BottomNavBar({ activeTab }: Props) {
  return <BottomNav activeTab={activeTab} />;
}
