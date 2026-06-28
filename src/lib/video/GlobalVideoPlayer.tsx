"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import type { YouTubeVideo, YouTubeSeries } from "@/lib/youtube";

// ========== PURE HELPERS ==========

function getWatchProgressKey(videoId: string): string {
  return `watch_progress_${videoId}`;
}

function loadWatchProgress(videoId: string): { position: number; completed: boolean } | null {
  try {
    const raw = localStorage.getItem(getWatchProgressKey(videoId));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveWatchProgress(videoId: string, position: number, duration: number) {
  try {
    const completed = position / duration >= 0.9;
    localStorage.setItem(getWatchProgressKey(videoId), JSON.stringify({ position, completed }));
  } catch { /* noop */ }
}

function parseISOToSeconds(iso: string): number {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  const h = parseInt(m[1] || "0", 10);
  const mn = parseInt(m[2] || "0", 10);
  const s = parseInt(m[3] || "0", 10);
  return h * 3600 + mn * 60 + s;
}

function formatISOToDisplay(iso: string): string {
  const total = parseISOToSeconds(iso);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatViewCount(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return String(n);
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  } catch { return iso; }
}

function formatTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ========== PROPS ==========

interface GlobalVideoPlayerProps {
  video: YouTubeVideo | null;
  allVideos: YouTubeVideo[];
  seriesList: YouTubeSeries[];
  onClose: () => void;
  onPlayNext?: (youtubeId: string) => void;
}

// ========== COMPONENT ==========

export function GlobalVideoPlayer({ video, allVideos, seriesList, onClose, onPlayNext }: GlobalVideoPlayerProps) {
  const [timerSec, setTimerSec] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Derive up-next video
  const upNextVideo = useMemo(() => {
    if (!video) return undefined;
    if (video.seriesId) {
      const series = seriesList.find(s => s.id === video.seriesId);
      if (series) {
        const idx = series.videoIds.indexOf(video.youtubeId);
        if (idx >= 0 && idx < series.videoIds.length - 1) {
          const nextId = series.videoIds[idx + 1];
          return allVideos.find(v => v.youtubeId === nextId);
        }
      }
    }
    const sameCat = allVideos.filter(v => v.category === video.category && v.youtubeId !== video.youtubeId);
    return sameCat.length > 0 ? sameCat[0] : undefined;
  }, [video?.youtubeId, allVideos, seriesList]);

  // Simulate watch time for progress tracking (iframe doesn't expose time to parent easily)
  useEffect(() => {
    if (!video) return;
    timerRef.current = setInterval(() => {
      setTimerSec(prev => {
        const d = video ? parseISOToSeconds(video.duration) : 0;
        const next = prev + 2;
        if (d > 0) saveWatchProgress(video.youtubeId, Math.min(next, d), d);
        return Math.min(next, d);
      });
    }, 2000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); setTimerSec(0); };
  }, [video?.youtubeId]);

  // Body scroll lock
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  const videoDuration = video ? parseISOToSeconds(video.duration) : 0;
  const progressPct = videoDuration > 0 ? (timerSec / videoDuration) * 100 : 0;
  const formattedDuration = video ? formatISOToDisplay(video.duration) : "0:00";
  const formattedViews = video ? formatViewCount(video.views) : "0";
  const formattedDate = video ? formatDate(video.publishedAt) : "";
  const seriesName = video?.seriesId ? seriesList.find(s => s.id === video.seriesId)?.name : undefined;

  const share = useCallback(() => {
    const url = `https://www.youtube.com/watch?v=${video?.youtubeId}`;
    if (navigator.share) {
      navigator.share({ title: video?.title || "Kingdom Seekers Church Nakuru", text: `Watch "${video?.title}" on Kingdom Seekers Church Nakuru`, url }).catch(() => {});
    } else {
      window.dispatchEvent(new CustomEvent("show-toast", {
        detail: { title: "Share", message: "Link copied to clipboard!", type: "success", duration: 2500 },
      }));
    }
  }, [video?.youtubeId, video?.title]);

  const watchOnYT = useCallback(async () => {
    if (video) {
      try {
        const { Browser } = await import("@capacitor/browser");
        await Browser.open({ url: `https://www.youtube.com/watch?v=${video.youtubeId}` });
      } catch {
        window.open(`https://www.youtube.com/watch?v=${video.youtubeId}`, "_blank");
      }
    }
  }, [video?.youtubeId]);

  if (!video) {
    return (
      <div className="gvp-loading">
        <style>{`
          .gvp-loading {
            position: fixed; inset: 0; z-index: 5000;
            background: #0F0F0F;
            display: flex; align-items: center; justify-content: center;
            flex-direction: column; gap: 16px;
          }
          .gvp-loading-spinner {
            width: 48px; height: 48px;
            border: 3px solid #242424;
            border-top-color: #E8A838;
            border-radius: 50%;
            animation: gvpSpin 0.8s linear infinite;
          }
          @keyframes gvpSpin { to { transform: rotate(360deg); } }
        `}</style>
        <div className="gvp-loading-spinner"></div>
        <span style={{ color: "#A0A0A0", fontSize: 14 }}>Loading video...</span>
      </div>
    );
  }

  return (
    <>
      <style>{`
        .gvp-overlay {
          position: fixed; inset: 0; z-index: 5000;
          display: flex; flex-direction: column;
          background: #0F0F0F;
          animation: gvpSlideUp 0.4s cubic-bezier(0.32,0.72,0,1);
        }
        @keyframes gvpSlideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }

        .gvp-top-bar {
          padding: env(safe-area-inset-top, 20px) 16px 8px;
          display: flex; align-items: center; justify-content: space-between;
          background: #000; flex-shrink: 0;
        }
        .gvp-close-btn {
          width: 36px; height: 36px; border-radius: 50%;
          background: rgba(255,255,255,0.1); border: none; color: #fff;
          font-size: 18px; display: flex; align-items: center;
          justify-content: center; cursor: pointer;
        }
        .gvp-close-btn:active { background: rgba(255,255,255,0.2); }

        .gvp-player-wrap {
          width: 100%; aspect-ratio: 16/9; background: #000;
          position: relative; flex-shrink: 0; overflow: hidden;
        }
        .gvp-player-wrap iframe {
          position: absolute; inset: 0;
          width: 100%; height: 100%; border: none;
        }

        .gvp-progress-bar {
          width: 100%; height: 4px; background: rgba(255,255,255,0.2);
          border-radius: 2px; position: relative; flex-shrink: 0;
        }
        .gvp-progress-fill {
          height: 100%; background: #E8A838; border-radius: 2px; position: relative;
          transition: width 0.5s ease;
        }

        .gvp-info {
          flex: 1; overflow-y: auto; padding: 16px;
          background: #0F0F0F;
        }
        .gvp-info::-webkit-scrollbar { display: none; }
        .gvp-info h2 {
          font-size: 18px; font-weight: 700; line-height: 1.3;
          margin-bottom: 8px; color: #fff;
        }
        .gvp-info-meta {
          display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
          font-size: 13px; color: #A0A0A0; margin-bottom: 14px;
        }
        .gvp-info-meta .dot {
          width: 3px; height: 3px; background: #6B6B6B;
          border-radius: 50%;
        }
        .gvp-actions-row { display: flex; gap: 10px; margin-bottom: 16px; }
        .gvp-action-btn {
          flex: 1; padding: 12px; background: #1A1A1A;
          border: 1px solid #2A2A2A; border-radius: 12px;
          color: #fff; font-size: 13px; font-weight: 600;
          display: flex; align-items: center; justify-content: center;
          gap: 8px; cursor: pointer; transition: all 0.2s ease;
        }
        .gvp-action-btn:active { background: #242424; transform: scale(0.97); }
        .gvp-action-btn.primary {
          background: linear-gradient(135deg, #E8A838, #D4762A);
          border-color: transparent; color: #fff;
        }
        .gvp-desc { font-size: 14px; color: #A0A0A0; line-height: 1.7; margin-bottom: 20px; }

        .gvp-upnext {
          padding: 16px; border-top: 1px solid #2A2A2A;
          background: #0F0F0F; flex-shrink: 0;
        }
        .gvp-upnext-header {
          display: flex; align-items: center; justify-content: space-between;
          margin-bottom: 10px;
        }
        .gvp-upnext-title { font-size: 14px; font-weight: 700; display: flex; align-items: center; gap: 8px; color: #fff; }
        .gvp-upnext-cancel { background: none; border: none; color: #6B6B6B; font-size: 13px; font-weight: 500; cursor: pointer; }
        .gvp-upnext-item {
          display: flex; gap: 12px; padding: 10px;
          background: #1E1E1E; border: 1px solid #2A2A2A;
          border-radius: 16px; cursor: pointer; transition: all 0.2s ease;
        }
        .gvp-upnext-item:active { background: #242424; }
        .gvp-upnext-thumb {
          width: 100px; height: 56px; border-radius: 8px;
          overflow: hidden; flex-shrink: 0; border: 1px solid #2A2A2A;
        }
        .gvp-upnext-thumb img { width: 100%; height: 100%; object-fit: cover; }
        .gvp-upnext-info { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; }
        .gvp-upnext-name { font-size: 13px; font-weight: 600; line-height: 1.3; margin-bottom: 2px; color: #fff; }
        .gvp-upnext-meta { font-size: 11px; color: #6B6B6B; }

        .gvp-safe-bottom { height: env(safe-area-inset-bottom, 20px); background: #0F0F0F; flex-shrink: 0; }
      `}</style>

      <div className="gvp-overlay">
        {/* Top bar */}
        <div className="gvp-top-bar">
          <button className="gvp-close-btn" onClick={onClose}>
            <i className="fas fa-chevron-down"></i>
          </button>
          <span style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", fontWeight: 500 }}>
            {seriesName || "Now Playing"}
          </span>
          <div style={{ width: 36 }}></div>
        </div>

        {/* Video player — YouTube iframe (no native plugin, no crash) */}
        <div className="gvp-player-wrap">
          <iframe
            src={`https://www.youtube.com/embed/${video.youtubeId}?autoplay=1&rel=0&modestbranding=1&playsinline=1&controls=1`}
            allow="autoplay; encrypted-media; fullscreen"
            allowFullScreen
            title={video.title}
          />
        </div>

        {/* Simple thin progress bar (approximate) */}
        <div className="gvp-progress-bar">
          <div className="gvp-progress-fill" style={{ width: `${progressPct}%` }}></div>
        </div>

        {/* Info */}
        <div className="gvp-info">
          <h2>{video.title}</h2>
          <div className="gvp-info-meta">
            {seriesName && <><span>{seriesName}</span><span className="dot"></span></>}
            <span>{formattedDate}</span>
            <span className="dot"></span>
            <span>{formattedViews} views</span>
          </div>
          <div className="gvp-actions-row">
            <button className="gvp-action-btn primary" onClick={share}>
              <i className="fas fa-share"></i> Share
            </button>
            <button className="gvp-action-btn" onClick={watchOnYT}>
              <i className="fab fa-youtube"></i> YouTube
            </button>
          </div>
          {video.description && (
            <div className="gvp-desc">
              <h3 style={{ fontSize: 15, fontWeight: 700, color: "#fff", marginBottom: 8 }}>About</h3>
              <p>{video.description}</p>
            </div>
          )}

          {/* Up Next */}
          {upNextVideo && (
            <div className="gvp-upnext" style={{ margin: "16px -16px -16px", borderTop: "1px solid #2A2A2A" }}>
              <div className="gvp-upnext-header">
                <div className="gvp-upnext-title">
                  <span>Up Next</span>
                </div>

              </div>
              <div
                className="gvp-upnext-item"
                onClick={() => {
                  if (onPlayNext && upNextVideo) {
                    onPlayNext(upNextVideo.youtubeId);
                  }
                }}
              >
                <div className="gvp-upnext-thumb">
                  <img src={upNextVideo.thumbnail} alt={upNextVideo.title} />
                </div>
                <div className="gvp-upnext-info">
                  <div className="gvp-upnext-name">{upNextVideo.title}</div>
                  <div className="gvp-upnext-meta">{formatISOToDisplay(upNextVideo.duration)} · {formatViewCount(upNextVideo.views)} views</div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Safe area spacer */}
        <div className="gvp-safe-bottom"></div>
      </div>
    </>
  );
}
