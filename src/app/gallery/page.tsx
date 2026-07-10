"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import BottomNavBar from "@/components/shared/BottomNavBar";
import ToastBridge from "@/components/dashboard/ToastBridge";
import { getBanners } from "@/lib/content";
import type { Banner, GalleryPhoto } from "@/lib/content";
import { useImageLightbox } from "@/components/shared/ImageLightbox";
import { getAlbums } from "@/lib/albums";
import { getAlbumEntries } from "@/lib/albumEntries";
import type { Album } from "@/lib/albums";
import type { AlbumEntry } from "@/lib/albumEntries";
import { Timestamp, onSnapshot, query, orderBy, collection } from "firebase/firestore";
import { db } from "@/lib/firebase";
import PremiumTopBar from "@/components/shared/PremiumTopBar";


// ========== MAIN COMPONENT ==========

export default function GalleryPage() {
    const [activeTab, setActiveTab] = useState<"home" | "albums">("home");
  const [bannerIndex, setBannerIndex] = useState(0);
  const [galleryView, setGalleryView] = useState<"grid" | "masonry">("grid");
  const [galleryFilter, setGalleryFilter] = useState("all");
  const [offline, setOffline] = useState(false);

  // Real data state
  const [banners, setBanners] = useState<Banner[]>([]);
  const [galleryPhotos, setGalleryPhotos] = useState<GalleryPhoto[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  const viewer = useImageLightbox();

  // Album drill-down state
  const [selectedAlbum, setSelectedAlbum] = useState<Album | null>(null);
  const [entries, setEntries] = useState<AlbumEntry[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<AlbumEntry | null>(null);

  const bannerTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ========== DATA FETCHING ==========

  /* Real-time listener for gallery photos — updates instantly when admin uploads */
  useEffect(() => {
    queueMicrotask(() => setLoadingData(true));
    const q = query(collection(db, "gallery_photos"), orderBy("uploadedAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      const photos = snap.docs.map((d) => ({ id: d.id, ...d.data() } as GalleryPhoto));
      setGalleryPhotos(photos);
      setLoadingData(false);
    }, () => {
      setGalleryPhotos([]);
      setLoadingData(false);
    });
    return () => unsub();
  }, []);

  const fetchData = useCallback(async () => {
    await Promise.all([
      getBanners().then(setBanners).catch(() => setBanners([])),
      getAlbums().then(setAlbums).catch(() => setAlbums([])),
    ]);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function fetchEntries(albumId: string) {
    try {
      const data = await getAlbumEntries(albumId);
      setEntries(data);
    } catch {
      setEntries([]);
    }
  }

  const activeBanners = banners.filter((b) => b.isActive);

  // Auto-swiping carousel
  useEffect(() => {
    if (activeBanners.length <= 1 || activeTab !== "home") return;
    bannerTimerRef.current = setInterval(() => {
      setBannerIndex((i) => (i + 1) % activeBanners.length);
    }, 5000);
    return () => {
      if (bannerTimerRef.current) clearInterval(bannerTimerRef.current);
    };
  }, [activeBanners.length, activeTab]);

  // Online/offline
  useEffect(() => {
    let unsub: (() => void) | null = null;
    (async () => {
      try {
        const { Network } = await import("@capacitor/network");
        const status = await Network.getStatus();
        setOffline(!status.connected);
        const listener = await Network.addListener("networkStatusChange", (s) => {
          setOffline(!s.connected);
        });
        unsub = () => listener.remove();
      } catch {
        setOffline(!navigator.onLine);
        const handleOnline = () => setOffline(false);
        const handleOffline = () => setOffline(true);
        window.addEventListener("online", handleOnline);
        window.addEventListener("offline", handleOffline);
        unsub = () => {
          window.removeEventListener("online", handleOnline);
          window.removeEventListener("offline", handleOffline);
        };
      }
    })();
    return () => unsub?.();
  }, []);

  function handleBannerSwipe(direction: number) {
    const len = activeBanners.length;
    if (len === 0) return;
    setBannerIndex((i) => (i + direction + len) % len);
    if (bannerTimerRef.current) {
      clearInterval(bannerTimerRef.current);
      bannerTimerRef.current = setInterval(() => {
        setBannerIndex((i) => (i + 1) % len);
      }, 5000);
    }
  }

  function openLightbox(index: number, photos: GalleryPhoto[] = galleryPhotos) {
    viewer.open(
      photos.map((p) => ({
        url: p.cdnUrl,
        title: p.title,
        description: p.description,
        date: p.uploadedAt ? formatUploadTime(p.uploadedAt) : undefined,
        category: p.category,
      })),
      index
    );
  }

  const featuredPhotos = galleryPhotos.filter((p) => p.isFeatured);
  const recentPhotos = [...galleryPhotos].sort((a, b) => {
    const aTime = a.uploadedAt?.toMillis() ?? 0;
    const bTime = b.uploadedAt?.toMillis() ?? 0;
    return bTime - aTime;
  }).slice(0, 6);

  function getCategoryColor(cat: string): string {
    const colors: Record<string, string> = {
      events: "#E8A838", services: "#8B5CF6", community: "#4ADE80",
      team: "#3B82F6", facility: "#EF4444", general: "#6B6B6B",
      event: "#E8A838", prayer: "#8B5CF6", notice: "#3B82F6", urgent: "#EF4444",
    };
    return colors[cat] || "#6B6B6B";
  }

  function formatUploadTime(ts: Timestamp | null): string {
    if (!ts) return "";
    const d = ts.toDate();
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  function getPhotosInAlbum(albumId: string): GalleryPhoto[] {
    return galleryPhotos.filter((p) => p.albumId === albumId);
  }

  function getPhotosInEntry(entryId: string): GalleryPhoto[] {
    return galleryPhotos.filter((p) => p.entryId === entryId);
  }

  function handleSelectAlbum(album: Album) {
    setSelectedAlbum(album);
    setGalleryFilter("all");
    setSelectedEntry(null);
    fetchEntries(album.id);
  }

  const filteredAlbums = albums.filter((a) => galleryFilter === "all" || a.category === galleryFilter);

  return (
    <>
      <style>{`
        :root {
            --primary: #E8A838; --primary-light: #F5C76B; --primary-dark: #C48A2A;
            --bg: #0F0F0F; --surface: #1A1A1A; --surface-elevated: #242424;
            --surface-card: #1E1E1E; --surface-hover: #2A2A2A;
            --text-primary: #FFFFFF; --text-secondary: #A0A0A0; --text-tertiary: #6B6B6B;
            --border: #2A2A2A; --error: #FF6B6B; --success: #4ADE80; --info: #38BDF8;
            --overlay: rgba(0,0,0,0.92); --gradient-start: #E8A838; --gradient-end: #D4762A;
            --shadow-soft: 0 4px 20px rgba(232,168,56,0.15);
            --shadow-elevated: 0 8px 32px rgba(0,0,0,0.5);
            --radius-sm: 12px; --radius-md: 16px; --radius-lg: 20px; --radius-xl: 24px; --radius-full: 50%;
        }
        * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; }
        html, body { height: 100%; overflow: hidden; background: var(--bg); color: var(--text-primary); }
        .app-container { height: 100%; display: flex; flex-direction: column; position: relative; overflow: hidden; }
        @media (min-width: 480px) { .app-container { max-width: 480px; margin: 0 auto; border-left: 1px solid var(--border); border-right: 1px solid var(--border); } }

        /* ========== HEADER — PREMIUM ========== */
        .header { padding: 12px 20px; display: flex; align-items: center; gap: 12px; flex-shrink: 0; background: linear-gradient(180deg, rgba(15,15,15,0.98) 0%, rgba(15,15,15,0.92) 100%); backdrop-filter: blur(20px); z-index: 100; }
        .header-logo { width: 38px; height: 38px; border-radius: 12px; background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end)); display: flex; align-items: center; justify-content: center; font-size: 18px; color: #fff; flex-shrink: 0; box-shadow: 0 4px 16px rgba(232,168,56,0.25); }
        .header-info { flex: 1; min-width: 0; }
        .header-church { font-size: 17px; font-weight: 700; letter-spacing: -0.3px; }
        .header-sub { font-size: 11px; color: var(--text-tertiary); font-weight: 500; margin-top: 1px; }
        .header-actions { display: flex; align-items: center; gap: 8px; }
        .header-btn { width: 40px; height: 40px; border-radius: var(--radius-full); background: var(--surface); border: 1px solid var(--border); color: var(--text-primary); font-size: 16px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s ease; position: relative; }
        .header-btn:active { background: var(--surface-elevated); transform: scale(0.9); }

        /* ========== TABS — PREMIUM ========== */
        .tabs-bar { display: flex; border-bottom: 1px solid var(--border); flex-shrink: 0; background: var(--bg); padding: 0 20px; gap: 0; }
        .tab-btn { flex: 1; padding: 14px 6px 12px; background: none; border: none; color: var(--text-tertiary); font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.2s ease; position: relative; display: flex; align-items: center; justify-content: center; gap: 6px; letter-spacing: 0.3px; }
        .tab-btn i { font-size: 14px; }
        .tab-btn.active { color: var(--primary); }
        .tab-btn.active::after { content: ''; position: absolute; bottom: 0; left: 20%; right: 20%; height: 3px; background: linear-gradient(90deg, var(--gradient-start), var(--gradient-end)); border-radius: 3px 3px 0 0; box-shadow: 0 0 12px rgba(232,168,56,0.3); }
        .tab-btn:active { opacity: 0.7; transform: scale(0.97); }

        /* ========== CONTENT ========== */
        .content-scroll { flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch; padding-bottom: 100px; }
        .content-scroll::-webkit-scrollbar { display: none; }

        /* ========== OFFLINE BANNER ========== */
        .offline-banner { padding: 10px 16px; background: var(--error); color: #fff; font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 8px; }

        /* ========== HERO BANNER — PREMIUM ========== */
        .hero-section { padding: 12px 12px 20px; }
        .hero-carousel { position: relative; border-radius: var(--radius-xl); overflow: hidden; cursor: pointer; border: 1px solid var(--border); background: var(--surface); box-shadow: 0 8px 32px rgba(0,0,0,0.4); }
        .hero-slide { width: 100%; aspect-ratio: 16/7; position: relative; overflow: hidden; }
        .hero-slide img { width: 100%; height: 100%; object-fit: cover; transition: transform 6s ease; }
        .hero-carousel:hover .hero-slide img { transform: scale(1.05); }
        .hero-overlay { position: absolute; inset: 0; background: linear-gradient(135deg, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.2) 50%, transparent 80%); display: flex; flex-direction: column; justify-content: flex-end; padding: 24px; }
        .hero-overlay h2 { font-size: 22px; font-weight: 800; color: #fff; margin-bottom: 4px; line-height: 1.2; text-shadow: 0 2px 8px rgba(0,0,0,0.3); }
        .hero-overlay p { font-size: 13px; color: rgba(255,255,255,0.8); margin-bottom: 14px; max-width: 75%; line-height: 1.4; }
        .hero-cta { display: inline-flex; padding: 10px 22px; background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end)); border: none; border-radius: 10px; color: #fff; font-size: 13px; font-weight: 700; cursor: pointer; width: fit-content; transition: all 0.2s; box-shadow: 0 4px 16px rgba(232,168,56,0.3); }
        .hero-cta:active { transform: scale(0.95); }
        .hero-dots { display: flex; justify-content: center; gap: 6px; margin-top: 14px; }
        .hero-dot { width: 6px; height: 6px; border-radius: var(--radius-full); background: var(--border); cursor: pointer; transition: all 0.3s cubic-bezier(0.4,0,0.2,1); }
        .hero-dot.active { width: 28px; background: linear-gradient(90deg, var(--gradient-start), var(--gradient-end)); border-radius: 3px; box-shadow: 0 0 8px rgba(232,168,56,0.3); }
        .hero-nav { position: absolute; top: 50%; transform: translateY(-50%); width: 36px; height: 36px; border-radius: var(--radius-full); background: rgba(0,0,0,0.5); backdrop-filter: blur(8px); border: 1px solid rgba(255,255,255,0.1); color: #fff; font-size: 14px; display: flex; align-items: center; justify-content: center; cursor: pointer; z-index: 5; transition: all 0.2s; }
        .hero-nav:active { background: rgba(0,0,0,0.7); transform: translateY(-50%) scale(0.9); }
        .hero-nav.prev { left: 10px; } .hero-nav.next { right: 10px; }

        /* ========== SECTION HEADERS — PREMIUM ========== */
        .section-header { display: flex; align-items: center; justify-content: space-between; padding: 20px 12px 14px; }
        .section-title { font-size: 18px; font-weight: 800; display: flex; align-items: center; gap: 10px; letter-spacing: -0.3px; }
        .section-title-icon { width: 28px; height: 28px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 13px; color: #fff; flex-shrink: 0; }
        .section-see-all { font-size: 12px; color: var(--primary); font-weight: 700; background: none; border: none; cursor: pointer; display: flex; align-items: center; gap: 4px; padding: 6px 14px; border-radius: 20px; background: rgba(232,168,56,0.08); border: 1px solid rgba(232,168,56,0.15); transition: all 0.2s; }
        .section-see-all:active { background: rgba(232,168,56,0.15); transform: scale(0.95); }

        /* ========== HORIZONTAL SCROLL — PREMIUM ========== */
        .h-scroll { display: flex; gap: 12px; overflow-x: auto; padding: 0 12px 8px; -webkit-overflow-scrolling: touch; scroll-snap-type: x mandatory; }
        .h-scroll::-webkit-scrollbar { display: none; }
        .h-scroll > * { scroll-snap-align: start; flex-shrink: 0; }

        /* ========== FEATURED CARD — PREMIUM ========== */
        .feat-card { width: 180px; cursor: pointer; transition: all 0.35s cubic-bezier(0.4,0,0.2,1); border-radius: var(--radius-lg); overflow: hidden; border: 1px solid var(--border); background: var(--surface-card); flex-shrink: 0; }
        .feat-card:active { transform: scale(0.95); }
        .feat-card:hover { transform: translateY(-4px); box-shadow: 0 8px 30px rgba(0,0,0,0.4); }
        .feat-thumb { width: 100%; aspect-ratio: 1; position: relative; overflow: hidden; }
        .feat-thumb img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.5s ease; }
        .feat-card:hover .feat-thumb img { transform: scale(1.08); }
        .feat-thumb-overlay { position: absolute; inset: 0; background: linear-gradient(to top, rgba(0,0,0,0.5) 0%, transparent 60%); opacity: 0; transition: opacity 0.3s; }
        .feat-card:hover .feat-thumb-overlay { opacity: 1; }
        .feat-thumb-badge { position: absolute; top: 8px; left: 8px; padding: 3px 8px; border-radius: 6px; font-size: 9px; font-weight: 700; text-transform: uppercase; color: #fff; }
        .feat-info { padding: 10px 12px 12px; }
        .feat-name { font-size: 13px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 2px; }
        .feat-date { font-size: 10px; color: var(--text-tertiary); }

        /* ========== RECENT GRID — PREMIUM ========== */
        .recent-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; padding: 0 12px; }
        .recent-grid-item { position: relative; border-radius: var(--radius-md); overflow: hidden; cursor: pointer; border: 1px solid var(--border); transition: all 0.3s ease; }
        .recent-grid-item:active { transform: scale(0.95); }
        .recent-grid-item:hover { box-shadow: 0 4px 20px rgba(0,0,0,0.3); }
        .recent-grid-item img { width: 100%; aspect-ratio: 1; object-fit: cover; display: block; transition: transform 0.4s; }
        .recent-grid-item:hover img { transform: scale(1.06); }
        .recent-grid-overlay { position: absolute; inset: 0; background: linear-gradient(to top, rgba(0,0,0,0.6) 0%, transparent 50%); opacity: 0; transition: opacity 0.3s; display: flex; align-items: flex-end; padding: 10px; }
        .recent-grid-item:hover .recent-grid-overlay { opacity: 1; }
        .recent-grid-label { font-size: 11px; font-weight: 600; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

        /* ========== PHOTO GRID — PREMIUM ========== */
        .photo-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; padding: 0 12px; }
        .photo-item { position: relative; border-radius: var(--radius-md); overflow: hidden; cursor: pointer; border: 1px solid var(--border); transition: all 0.3s ease; background: var(--surface); }
        .photo-item:active { transform: scale(0.96); }
        .photo-item img { width: 100%; aspect-ratio: 1; object-fit: cover; display: block; transition: transform 0.4s; }
        .photo-item:hover img { transform: scale(1.05); }
        .photo-item-badge { position: absolute; top: 8px; left: 8px; padding: 3px 8px; border-radius: 6px; font-size: 9px; font-weight: 700; text-transform: uppercase; color: #fff; backdrop-filter: blur(4px); background: rgba(0,0,0,0.4); }
        .photo-item-title { position: absolute; bottom: 0; left: 0; right: 0; padding: 14px 10px 10px; background: linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent); font-size: 12px; font-weight: 600; color: #fff; }

        /* ========== GALLERY TAB TOOLBAR ========== */
        .gallery-toolbar { padding: 12px; display: flex; flex-direction: column; gap: 10px; }
        .gallery-search { position: relative; }
        .gallery-search i { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: var(--text-tertiary); font-size: 15px; }
        .gallery-search input { width: 100%; padding: 12px 14px 12px 42px; background: var(--surface); border: 1.5px solid var(--border); border-radius: var(--radius-md); color: var(--text-primary); font-size: 14px; font-weight: 500; outline: none; transition: all 0.2s; }
        .gallery-search input:focus { border-color: var(--primary); background: var(--surface-elevated); box-shadow: 0 0 0 3px rgba(232,168,56,0.08); }
        .gallery-search input::placeholder { color: var(--text-tertiary); font-weight: 400; }
        .gallery-chip { padding: 7px 16px; border-radius: 20px; background: var(--surface); border: 1px solid var(--border); color: var(--text-secondary); font-size: 12px; font-weight: 600; white-space: nowrap; cursor: pointer; transition: all 0.2s; flex-shrink: 0; }
        .gallery-chip:active { transform: scale(0.95); }
        .gallery-chip.active { background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end)); border-color: transparent; color: #fff; box-shadow: 0 4px 12px rgba(232,168,56,0.2); }
        .gallery-count { font-size: 12px; color: var(--text-tertiary); padding: 0 12px 4px; font-weight: 500; }

        /* ========== ALBUM CARD — PREMIUM ========== */
        .album-card { border-radius: var(--radius-lg); overflow: hidden; cursor: pointer; border: 1px solid var(--border); background: var(--surface-card); transition: all 0.35s cubic-bezier(0.4,0,0.2,1); }
        .album-card:active { transform: scale(0.97); }
        .album-card:hover { box-shadow: 0 8px 30px rgba(0,0,0,0.4); transform: translateY(-2px); }
        .album-cover { width: 100%; aspect-ratio: 4/3; object-fit: cover; display: block; transition: transform 0.5s; background: var(--surface); }
        .album-card:hover .album-cover { transform: scale(1.04); }
        .album-cover-wrap { position: relative; overflow: hidden; }
        .album-cover-overlay { position: absolute; inset: 0; background: linear-gradient(to top, rgba(0,0,0,0.5) 0%, transparent 60%); opacity: 0; transition: opacity 0.3s; }
        .album-card:hover .album-cover-overlay { opacity: 1; }
        .album-cover-badge { position: absolute; top: 10px; right: 10px; padding: 4px 10px; border-radius: 6px; font-size: 10px; font-weight: 700; text-transform: uppercase; color: #fff; backdrop-filter: blur(8px); background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.08); }
        .album-info { padding: 14px 16px 16px; }
        .album-name { font-size: 17px; font-weight: 700; margin-bottom: 4px; }
        .album-meta { font-size: 13px; color: var(--text-tertiary); display: flex; align-items: center; gap: 8px; }

        /* ========== ALBUM GRID ========== */
        .album-grid { display: grid; gap: 16px; padding: 0 12px; }

        /* ========== ENTRY CARD ========== */
        .entry-card { border-radius: var(--radius-lg); overflow: hidden; cursor: pointer; border: 1px solid var(--border); background: var(--surface-card); transition: all 0.3s ease; }
        .entry-card:active { transform: scale(0.97); }

        /* ========== BACK BUTTON ========== */
        .back-btn { width: 36px; height: 36px; border-radius: var(--radius-full); background: var(--surface); border: 1px solid var(--border); color: var(--text-primary); font-size: 15px; display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; transition: all 0.2s; }
        .back-btn:active { background: var(--surface-elevated); transform: scale(0.9); }

        /* ========== EMPTY STATE ========== */
        .empty-state { text-align: center; padding: 60px 16px; }
        .empty-state-icon { width: 72px; height: 72px; border-radius: var(--radius-full); background: var(--surface); display: flex; align-items: center; justify-content: center; margin: 0 auto 14px; font-size: 28px; color: var(--text-tertiary); border: 1px solid var(--border); }
        .empty-state h3 { font-size: 17px; font-weight: 700; margin-bottom: 6px; }
        .empty-state p { font-size: 14px; color: var(--text-secondary); }

        /* ========== SKELETON LOADERS ========== */
        .skel { background: linear-gradient(90deg, var(--surface) 25%, var(--surface-hover) 50%, var(--surface) 75%); background-size: 200% 100%; animation: sk-shimmer 1.4s ease-in-out infinite; border-radius: 8px; display: block; }
        @keyframes sk-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

        /* ========== VIEW TOGGLE ========== */
        .view-toggle { display: flex; gap: 4px; }
        .view-toggle-btn { width: 34px; height: 34px; border-radius: 8px; background: var(--surface); border: 1px solid var(--border); color: var(--text-tertiary); font-size: 14px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s; }
        .view-toggle-btn:active { transform: scale(0.9); }
        .view-toggle-btn.active { background: var(--surface-elevated); color: var(--primary); border-color: var(--primary); }

        /* ========== PHOTO MASONRY ========== */
        .photo-masonry { columns: 2; column-gap: 10px; padding: 0 12px; }
        .photo-masonry-item { break-inside: avoid; margin-bottom: 10px; border-radius: var(--radius-md); overflow: hidden; border: 1px solid var(--border); cursor: pointer; position: relative; transition: all 0.2s; }
        .photo-masonry-item:active { transform: scale(0.97); }
        .photo-masonry-item img { width: 100%; display: block; }
        .photo-masonry-item .photo-item-badge { position: absolute; top: 8px; left: 8px; }

        /* ========== BOTTOM NAV ========== */
        .bottom-nav { position: fixed; bottom: 0; left: 0; right: 0; background: rgba(15,15,15,0.92); backdrop-filter: blur(20px) saturate(180%); -webkit-backdrop-filter: blur(20px) saturate(180%); border-top: 1px solid var(--border); padding: 8px 0 calc(8px + env(safe-area-inset-bottom, 0px)); z-index: 1000; display: flex; justify-content: space-around; align-items: center; }
        @media (min-width: 480px) { .bottom-nav { max-width: 480px; margin: 0 auto; } }
        .nav-item { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 6px 16px; background: none; border: none; color: var(--text-tertiary); cursor: pointer; transition: all 0.2s ease; position: relative; }
        .nav-item.active { color: var(--primary); }
        .nav-item i { font-size: 22px; transition: transform 0.2s ease; }
        .nav-item:active i { transform: scale(0.85); }
        .nav-item span { font-size: 10px; font-weight: 600; }
        .nav-item .nav-badge { position: absolute; top: 2px; right: 10px; width: 8px; height: 8px; background: var(--error); border-radius: var(--radius-full); border: 2px solid var(--bg); }
        .nav-item .nav-live-dot { position: absolute; top: 1px; right: 8px; width: 8px; height: 8px; background: #EF4444; border-radius: 50%; border: 2px solid var(--bg,#0F0F0F); animation: navLivePulse 1.5s ease-in-out infinite; }
        @keyframes navLivePulse { 0%,100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.3); opacity: 0.6; } }
      `}</style>

      <ToastBridge />

      <div className="app-container">
        <PremiumTopBar icon="fa-images" title="CHRISTIAN REVIVAL CHURCH" subtitle="Photo Gallery" />

        {/* ========== OFFLINE BANNER ========== */}
        {offline && (
          <div className="offline-banner">
            <i className="fas fa-wifi-slash"></i>
            <span>You&apos;re offline — showing cached content</span>
          </div>
        )}

        {/* ========== TABS ========== */}
        <div className="tabs-bar">
          <button className={`tab-btn${activeTab === "home" ? " active" : ""}`} onClick={() => setActiveTab("home")}>
            <i className="fas fa-house"></i> Home
          </button>
          <button className={`tab-btn${activeTab === "albums" ? " active" : ""}`} onClick={() => {
            setActiveTab("albums");
            setSelectedAlbum(null);
            setSelectedEntry(null);
            setGalleryFilter("all");
          }}>
            <i className="fas fa-images"></i> Albums
          </button>
        </div>

        {/* ========== CONTENT ========== */}
        <div className="content-scroll">

          {/* ===== TAB 1: HOME ===== */}
          {activeTab === "home" && (
            <>
              {/* Hero Banner Carousel */}
              {loadingData ? (
                <div className="hero-section" style={{ paddingTop: 16 }}>
                  <div className="skel" style={{ width: "100%", aspectRatio: "16/7", borderRadius: "var(--radius-xl)" }}></div>
                </div>
              ) : activeBanners.length > 0 && (
                <div className="hero-section" style={{ paddingTop: 16 }}>
                  <div className="hero-carousel">
                    <div className="hero-slide" onClick={() => {
                      const b = activeBanners[bannerIndex];
                      if (b.ctaLink) {
                        import("@capacitor/browser").then(({ Browser }) => Browser.open({ url: b.ctaLink })).catch(() => window.open(b.ctaLink, "_blank"));
                      }
                    }}>
                      <img src={activeBanners[bannerIndex].cdnUrl} alt={activeBanners[bannerIndex].title} />
                      <div className="hero-overlay">
                        <h2>{activeBanners[bannerIndex].title}</h2>
                        <p>{activeBanners[bannerIndex].subtitle}</p>
                        {activeBanners[bannerIndex].ctaText && (
                          <span className="hero-cta">{activeBanners[bannerIndex].ctaText}</span>
                        )}
                      </div>
                      <button className="hero-nav prev" onClick={(e) => { e.stopPropagation(); handleBannerSwipe(-1); }}>
                        <i className="fas fa-chevron-left"></i>
                      </button>
                      <button className="hero-nav next" onClick={(e) => { e.stopPropagation(); handleBannerSwipe(1); }}>
                        <i className="fas fa-chevron-right"></i>
                      </button>
                    </div>
                    {activeBanners.length > 1 && (
                      <div className="hero-dots">
                        {activeBanners.map((_, i) => (
                          <div key={i} className={`hero-dot${i === bannerIndex ? " active" : ""}`} onClick={() => setBannerIndex(i)}></div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Loading skeleton for content */}
              {loadingData ? (
                <div style={{ padding: "0 16px" }}>
                  {[1,2,3].map((i) => (
                    <div key={i} style={{ marginBottom: 24 }}>
                      <div className="skel" style={{ width: "40%", height: 16, marginBottom: 14, borderRadius: 4 }} />
                      <div style={{ display: "flex", gap: 12 }}>
                        {[1,2,3].map((j) => (
                          <div key={j} className="skel" style={{ width: 180, aspectRatio: "1", borderRadius: "var(--radius-lg)", flexShrink: 0 }} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  {/* Featured Photos */}
                  {featuredPhotos.length > 0 && (
                    <>
                      <div className="section-header">
                        <h2 className="section-title">
                          <span className="section-title-icon" style={{ background: "linear-gradient(135deg, #E8A838, #F5C76B)" }}><i className="fas fa-star"></i></span>
                          Featured Photos
                        </h2>
                        <button className="section-see-all" onClick={() => { setActiveTab("albums"); setSelectedAlbum(null); setSelectedEntry(null); }}>Albums <i className="fas fa-chevron-right" style={{ fontSize: 9 }}></i></button>
                      </div>
                      <div className="h-scroll">
                        {featuredPhotos.map((photo, i) => (
                          <div className="feat-card" key={photo.id} onClick={() => openLightbox(i, featuredPhotos)}>
                            <div className="feat-thumb">
                              <img src={photo.cdnUrl} alt={photo.title} />
                              <div className="feat-thumb-overlay"></div>
                              <span className="feat-thumb-badge" style={{ background: getCategoryColor(photo.category) }}>{photo.category}</span>
                            </div>
                            <div className="feat-info">
                              <div className="feat-name">{photo.title}</div>
                              <div className="feat-date">{photo.uploadedAt ? formatUploadTime(photo.uploadedAt) : ""}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  {/* Recent Photos Grid */}
                  {recentPhotos.length > 0 && (
                    <>
                      <div className="section-header">
                        <h2 className="section-title">
                          <span className="section-title-icon" style={{ background: "linear-gradient(135deg, #8B5CF6, #6D28D9)" }}><i className="fas fa-clock"></i></span>
                          Recent Photos
                        </h2>
                        <button className="section-see-all" onClick={() => setActiveTab("albums")}>See All <i className="fas fa-chevron-right" style={{ fontSize: 9 }}></i></button>
                      </div>
                      <div className="recent-grid">
                        {recentPhotos.map((photo, i) => (
                          <div className="recent-grid-item" key={photo.id} onClick={() => openLightbox(i, recentPhotos)}>
                            <img src={photo.cdnUrl} alt={photo.title} loading="lazy" />
                            <div className="recent-grid-overlay">
                              <span className="recent-grid-label">{photo.title}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  {/* Albums Preview */}
                  {albums.length > 0 && (
                    <>
                      <div className="section-header">
                        <h2 className="section-title">
                          <span className="section-title-icon" style={{ background: "linear-gradient(135deg, #3B82F6, #2563EB)" }}><i className="fas fa-folder"></i></span>
                          Albums
                        </h2>
                        <button className="section-see-all" onClick={() => setActiveTab("albums")}>See All <i className="fas fa-chevron-right" style={{ fontSize: 9 }}></i></button>
                      </div>
                      <div className="h-scroll">
                        {albums.slice(0, 5).map((album) => {
                          const photos = getPhotosInAlbum(album.id);
                          return (
                            <div className="feat-card" key={album.id} style={{ width: 200, aspectRatio: "auto" }} onClick={() => {
                              handleSelectAlbum(album);
                              setActiveTab("albums");
                            }}>
                              <div className="feat-thumb" style={{ aspectRatio: "4/3" }}>
                                {photos.length > 0 ? (
                                  <img src={photos[0].cdnUrl} alt={album.title} />
                                ) : (
                                  <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--surface)", color: "var(--text-tertiary)", fontSize: 24 }}>
                                    <i className="fas fa-folder-open"></i>
                                  </div>
                                )}
                                <div className="feat-thumb-overlay"></div>
                              </div>
                              <div className="feat-info">
                                <div className="feat-name">{album.title}</div>
                                <div className="feat-date">{photos.length} photo{photos.length !== 1 ? "s" : ""}</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </>
              )}

              <div style={{ height: 40 }}></div>
            </>
          )}
          {/* ===== TAB 2: ALBUMS ===== */}
          {activeTab === "albums" && (
            <>
              {selectedEntry ? (
                /* ---- PHOTOS IN ENTRY ---- */
                <>
                  <div style={{ padding: "10px 16px", display: "flex", alignItems: "center", gap: 10 }}>
                    <button className="back-btn" onClick={() => setSelectedEntry(null)}>
                      <i className="fas fa-arrow-left"></i>
                    </button>
                    <div style={{ fontSize: 17, fontWeight: 700, flex: 1 }}>{selectedEntry.title}</div>
                    <div style={{ fontSize: 12, color: "var(--text-tertiary)", background: "var(--surface)", padding: "4px 12px", borderRadius: 20, border: "1px solid var(--border)" }}>{getPhotosInEntry(selectedEntry.id).length} photos</div>
                  </div>
                  <div className="gallery-toolbar" style={{ padding: "8px 16px", display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end" }}>
                    <div className="view-toggle">
                      <button className={`view-toggle-btn${galleryView === "grid" ? " active" : ""}`} onClick={() => setGalleryView("grid")}><i className="fas fa-border-all"></i></button>
                      <button className={`view-toggle-btn${galleryView === "masonry" ? " active" : ""}`} onClick={() => setGalleryView("masonry")}><i className="fas fa-grip"></i></button>
                    </div>
                  </div>
                  {getPhotosInEntry(selectedEntry.id).length === 0 ? (
                    <div className="empty-state">
                      <div className="empty-state-icon"><i className="fas fa-image"></i></div>
                      <h3>No photos in this entry</h3>
                      <p>Check back soon for new photos</p>
                    </div>
                  ) : galleryView === "grid" ? (
                    <div className="photo-grid">
                      {getPhotosInEntry(selectedEntry.id).map((photo, i) => (
                        <div className="photo-item" key={photo.id} onClick={() => openLightbox(i, galleryPhotos.filter(p => p.entryId === selectedEntry.id))}>
                          <img src={photo.cdnUrl} alt={photo.title} loading="lazy" />
                          <span className="photo-item-badge" style={{ background: getCategoryColor(photo.category) }}>{photo.category}</span>
                          <div className="photo-item-title">{photo.title}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="photo-masonry">
                      {getPhotosInEntry(selectedEntry.id).map((photo, i) => (
                        <div className="photo-masonry-item" key={photo.id} onClick={() => openLightbox(i, galleryPhotos.filter(p => p.entryId === selectedEntry.id))}
                          style={{ aspectRatio: i % 3 === 0 ? "1" : i % 3 === 1 ? "1.2" : "0.8" }}>
                          <img src={photo.cdnUrl} alt={photo.title} loading="lazy" style={{ aspectRatio: i % 3 === 0 ? "1" : i % 3 === 1 ? "1.2" : "0.8" }} />
                          <span className="photo-item-badge" style={{ background: getCategoryColor(photo.category) }}>{photo.category}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ height: 40 }}></div>
                </>
              ) : selectedAlbum ? (
                /* ---- ENTRIES IN ALBUM ---- */
                <>
                  <div style={{ padding: "10px 16px", display: "flex", alignItems: "center", gap: 10 }}>
                    <button className="back-btn" onClick={() => { setSelectedAlbum(null); setGalleryFilter("all"); }}>
                      <i className="fas fa-arrow-left"></i>
                    </button>
                    <div style={{ fontSize: 17, fontWeight: 700, flex: 1 }}>{selectedAlbum.title}</div>
                    <div style={{ fontSize: 12, color: "var(--text-tertiary)", background: "var(--surface)", padding: "4px 12px", borderRadius: 20, border: "1px solid var(--border)" }}>{entries.length} entries</div>
                  </div>
                  {entries.length === 0 ? (
                    <div className="empty-state">
                      <div className="empty-state-icon"><i className="fas fa-folder-open"></i></div>
                      <h3>No entries yet</h3>
                      <p>No entries in this album</p>
                    </div>
                  ) : (
                    <div className="album-grid" style={{ display: "grid", gap: 16, padding: "0 16px" }}>
                      {entries.map((entry) => {
                        const photoCount = getPhotosInEntry(entry.id).length;
                        const albumPhotos = galleryPhotos.filter(p => p.entryId === entry.id);
                        return (
                          <div className="entry-card" key={entry.id} onClick={() => setSelectedEntry(entry)}>
                            <div className="album-cover-wrap">
                              {entry.coverUrl ? (
                                <img src={entry.coverUrl} alt={entry.title} className="album-cover" loading="lazy" />
                              ) : albumPhotos.length > 0 ? (
                                <img src={albumPhotos[0].cdnUrl} alt={entry.title} className="album-cover" loading="lazy" />
                              ) : (
                                <div style={{ width: "100%", aspectRatio: "4/3", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--surface)", color: "var(--text-tertiary)", fontSize: 42 }}>
                                  <i className="fas fa-calendar-day"></i>
                                </div>
                              )}
                              <div className="album-cover-overlay"></div>
                            </div>
                            <div className="album-info">
                              <div className="album-name">{entry.title}</div>
                              <div className="album-meta">
                                <span>{photoCount} photo{photoCount !== 1 ? "s" : ""}</span>
                                {entry.date && <><span>·</span><span>{entry.date}</span></>}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div style={{ height: 40 }}></div>
                </>
              ) : (
                /* ---- ALBUMS VIEW ---- */
                <>
                  <div style={{ padding: "16px 16px 8px", display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 18, fontWeight: 800, flex: 1, letterSpacing: "-0.3px" }}>Albums</span>
                  </div>
                  <div className="gallery-toolbar" style={{ padding: "8px 16px", display: "flex", gap: 8, alignItems: "center", overflowX: "auto" }}>
                    <div style={{ display: "flex", gap: 8, overflowX: "auto", flex: 1 }}>
                      {["all", "events", "services", "community", "leadership", "facility"].map((cat) => (
                        <div key={cat} className={`gallery-chip${galleryFilter === cat ? " active" : ""}`}
                          onClick={() => { setGalleryFilter(cat); }}>
                          {cat === "all" ? "All" : cat.charAt(0).toUpperCase() + cat.slice(1)}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="gallery-count" style={{ padding: "0 16px 12px" }}>
                    {filteredAlbums.length} album{filteredAlbums.length !== 1 ? "s" : ""}
                  </div>
                  {loadingData ? (
                    <div style={{ display: "grid", gap: 16, padding: "0 16px" }}>
                      {[1,2,3].map((i) => (
                        <div key={i} style={{ borderRadius: "var(--radius-lg)", overflow: "hidden", border: "1px solid var(--border)" }}>
                          <div className="skel" style={{ width: "100%", aspectRatio: "4/3" }} />
                        </div>
                      ))}
                    </div>
                  ) : filteredAlbums.length === 0 ? (
                    <div className="empty-state">
                      <div className="empty-state-icon"><i className="fas fa-images"></i></div>
                      <h3>No albums yet</h3>
                      <p>Check back soon for new albums from the church</p>
                    </div>
                  ) : (
                    <div className="album-grid">
                      {filteredAlbums.map((album) => {
                        const photoCount = getPhotosInAlbum(album.id).length;
                        return (
                          <div className="album-card" key={album.id} onClick={() => handleSelectAlbum(album)}>
                            <div className="album-cover-wrap">
                              {photoCount > 0 ? (
                                <img src={getPhotosInAlbum(album.id)[0].cdnUrl} alt={album.title} className="album-cover" loading="lazy" />
                              ) : (
                                <div style={{ width: "100%", aspectRatio: "4/3", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--surface)", color: "var(--text-tertiary)", fontSize: 42 }}>
                                  <i className="fas fa-images"></i>
                                </div>
                              )}
                              <div className="album-cover-overlay"></div>
                              <div className="album-cover-badge">{album.category}</div>
                            </div>
                            <div className="album-info">
                              <div className="album-name">{album.title}</div>
                              <div className="album-meta">
                                <span>{photoCount} photo{photoCount !== 1 ? "s" : ""}</span>
                                {album.description && <><span>·</span><span>{album.description}</span></>}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div style={{ height: 40 }}></div>
                </>
              )}
            </>
          )}

        </div>

        {/* ========== LIGHTBOX ========== */}
        {viewer.ImageLightbox}

        <BottomNavBar activeTab="gallery" />
      </div>
    </>
  );
}
