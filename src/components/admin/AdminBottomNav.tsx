"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";

interface NavTab {
  tab: string;
  icon: string;
  label: string;
  showBadge?: boolean;
}

const tabs: NavTab[] = [
  { tab: "dashboard", icon: "fa-chart-line", label: "Dashboard" },
  { tab: "radio", icon: "fa-tower-broadcast", label: "Radio" },
  { tab: "tv", icon: "fa-tv", label: "TV" },
  { tab: "meetings", icon: "fa-people-group", label: "Meetings" },
  { tab: "content", icon: "fa-photo-film", label: "Content" },
  { tab: "members", icon: "fa-users", label: "Members", showBadge: true },
];

const tabRoutes: Record<string, string> = {
  dashboard: "/admin",
  radio: "/admin/radio",
  tv: "/admin/tv",
  meetings: "/admin/meetings",
  content: "/admin/content",
  members: "/admin/members",
};

export default function AdminBottomNav() {
  const router = useRouter();
  const pathname = usePathname();
  const [showSidebar, setShowSidebar] = useState(false);

  useEffect(() => {
    const check = () => setShowSidebar(window.innerWidth >= 1400);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const activeTab = Object.entries(tabRoutes).find(
    ([, route]) => pathname === route || (route !== "/admin" && pathname?.startsWith(route + "/"))
  )?.[0] || "dashboard";

  const navigate = (tab: string) => {
    const route = tabRoutes[tab];
    if (route) router.push(route);
  };

  return (
    <nav className={showSidebar ? "admin-sidebar" : "bottom-nav"}>
      {tabs.map((tab) => (
        <button
          key={tab.tab}
          className={`nav-item${tab.tab === activeTab ? " active" : ""}`}
          onClick={() => navigate(tab.tab)}
        >
          <i className={`fas ${tab.icon}`}></i>
          <span>{tab.label}</span>
          {tab.showBadge && <span className="nav-badge"></span>}
        </button>
      ))}
    </nav>
  );
}
