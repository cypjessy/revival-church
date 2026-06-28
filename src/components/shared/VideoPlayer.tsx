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
  const m = iso.match(/PT(?:(\\d+)H)?(?:(\\d+)M)?(?:(\\d+)S)?/);
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

// ========== TYPES ==========

export interface VideoPlayerDeps {
  videos: YouTubeVideo[];
  seriesList: YouTubeSeries[];
}

export interface VideoPlayerAPI {
  /** The player modal JSX — render at the end of your component tree */
  VideoPlayer: React.ReactNode;
  /** Open the player with a specific video */
  play: (video: YouTubeVideo) => void;
  /** Close the player */
  close: () => void;
}

// ========== HOOK ==========

export function useVideoPlayer({ videos, seriesList }: VideoPlayerDeps): VideoPlayerAPI {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState<YouTubeVideo | null>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [volume, setVolume] = useState(80);
  const [currentTime, setCurrentTime] = useState(0);
  const [showResumePrompt, setShowResumePrompt] = useState(false);
  const [resumePosition, setResumePosition] = useState(0);
  const [showUpNext, setShowUpNext] = useState(false);
  const [upNextCountdown, setUpNextCountdown] = useState(10);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [watchedVideos, setWatchedVideos] = useState<Set<string>>(new Set());

  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const upNextTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const play = useCallback((video: YouTubeVideo) => {
    const prog = loadWatchProgress(video.youtubeId);
    if (prog && !prog.completed && prog.position > 0) {
      setResumePosition(prog.position);
      setShowResumePrompt(true);
    }
    setSelectedVideo(video);
    setCurrentTime(prog?.position || 0);
    setIsPlaying(true);
    setShowUpNext(false);
    setIsOpen(true);
    document.body.style.overflow = "hidden";
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setShowUpNext(false);
    setShowResumePrompt(false);
    document.body.style.overflow = "";
    if (upNextTimerRef.current) clearInterval(upNextTimerRef.current);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      const { ScreenOrientation } = await import("@capacitor/screen-orientation");
      if (isFullscreen) {
        await ScreenOrientation.unlock().catch(() => {});
        setIsFullscreen(false);
      } else {
        await ScreenOrientation.lock({ orientation: "landscape-primary" }).catch(() => {});
        setIsFullscreen(true);
      }
    } catch {
      setIsFullscreen(prev => !prev);
    }
  }, [isFullscreen]);

  // Unlock orientation when player closes
  useEffect(() => {
    if (!isOpen) return;
    return () => {
      import("@capacitor/screen-orientation").then(({ ScreenOrientation }) => {
        ScreenOrientation.unlock().catch(() => {});
      }).catch(() => {});
    };
  }, [isOpen]);

  const togglePlay = useCallback(() => { setIsPlaying(p => !p); }, []);

  const skip = useCallback((seconds: number) => {
    setCurrentTime(t => {
      const durationSec = selectedVideo ? parseISOToSeconds(selectedVideo.duration) : 0;
      const newTime = Math.max(0, Math.min(t + seconds, durationSec));
      if (selectedVideo) saveWatchProgress(selectedVideo.youtubeId, newTime, durationSec);
      return newTime;
    });
  }, [selectedVideo]);

  const seek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    const durationSec = selectedVideo ? parseISOToSeconds(selectedVideo.duration) : 0;
    const newTime = Math.round(pct * durationSec);
    setCurrentTime(newTime);
    if (selectedVideo) saveWatchProgress(selectedVideo.youtubeId, newTime, durationSec);
  }, [selectedVideo]);

  const toggleMute = useCallback(() => {
    setVolume(v => v === 0 ? 80 : 0);
  }, []);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setVolume(Number(e.target.value));
  }, []);

  const share = useCallback(() => {
    if (navigator.share) {
      navigator.share({
        title: selectedVideo?.title || "Grace Church",
        text: `Watch "${selectedVideo?.title}" on Kingdom Seekers Church Nakuru`,
        url: `https://www.youtube.com/watch?v=${selectedVideo?.youtubeId}`,
      }).catch(() => {});
    } else {
      window.dispatchEvent(new CustomEvent("show-toast", {
        detail: { title: "Share", message: "Link copied to clipboard!", type: "success", duration: 2500 },
      }));
    }
  }, [selectedVideo]);

  const watchOnYT = useCallback(async () => {
    if (selectedVideo) {
      try {
        const { Browser } = await import("@capacitor/browser");
        await Browser.open({ url: `https://www.youtube.com/watch?v=${selectedVideo.youtubeId}` });
      } catch {
        window.open(`https://www.youtube.com/watch?v=${selectedVideo.youtubeId}`, "_blank");
      }
    }
  }, [selectedVideo]);

  const handlePlayFrom = useCallback((position: number) => {
    setCurrentTime(position);
    setShowResumePrompt(false);
  }, []);

  // Derive up-next video
  const upNextVideo = useMemo(() => {
    if (!selectedVideo) return undefined;
    if (selectedVideo.seriesId) {
      const series = seriesList.find(s => s.id === selectedVideo.seriesId);
      if (series) {
        const idx = series.videoIds.indexOf(selectedVideo.youtubeId);
        if (idx >= 0 && idx < series.videoIds.length - 1) {
          const nextId = series.videoIds[idx + 1];
          return videos.find(v => v.youtubeId === nextId);
        }
      }
    }
    const sameCat = videos.filter(v => v.category === selectedVideo.category && v.youtubeId !== selectedVideo.youtubeId);
    return sameCat.length > 0 ? sameCat[0] : undefined;
  }, [selectedVideo, videos, seriesList]);

  // Auto-save progress every 5s
  useEffect(() => {
    if (!isOpen || !selectedVideo) return;
    progressTimerRef.current = setInterval(() => {
      setCurrentTime(t => {
        const dSec = parseISOToSeconds(selectedVideo.duration);
        const newTime = Math.min(t + 5, dSec);
        saveWatchProgress(selectedVideo.youtubeId, newTime, dSec);
        if (newTime / dSec >= 0.85) {
          setWatchedVideos(prev => new Set(prev).add(selectedVideo.youtubeId));
          setShowUpNext(true);
        }
        return newTime;
      });
    }, 5000);
    return () => { if (progressTimerRef.current) clearInterval(progressTimerRef.current); };
  }, [isOpen, selectedVideo]);

  // Up-next auto-play countdown
  useEffect(() => {
    if (!showUpNext || !selectedVideo) return;
    let count = 10;
    queueMicrotask(() => setUpNextCountdown(10));
    upNextTimerRef.current = setInterval(() => {
      count -= 1;
      setUpNextCountdown(count);
      if (count <= 0) {
        if (upNextVideo) play(upNextVideo);
      }
    }, 1000);
    return () => { if (upNextTimerRef.current) clearInterval(upNextTimerRef.current); };
  }, [showUpNext, selectedVideo, upNextVideo, play]);



  // Hydrate watched videos on mount
  useEffect(() => {
    const watched: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith("watch_progress_")) {
        try {
          const data = JSON.parse(localStorage.getItem(key) || "{}");
          if (data.completed) watched.push(key.replace("watch_progress_", ""));
        } catch { /* noop */ }
      }
    }
    queueMicrotask(() => setWatchedVideos(new Set(watched)));
  }, []);

  useEffect(() => () => { document.body.style.overflow = ""; }, []);

  // Derived values
  const durationSec = selectedVideo ? parseISOToSeconds(selectedVideo.duration) : 0;
  const progressPct = durationSec > 0 ? (currentTime / durationSec) * 100 : 0;
  const formattedDuration = selectedVideo ? formatISOToDisplay(selectedVideo.duration) : "0:00";
  const formattedViews = selectedVideo ? formatViewCount(selectedVideo.views) : "0";
  const formattedDate = selectedVideo ? formatDate(selectedVideo.publishedAt) : "";
  const volIcon = volume === 0 ? "volume-xmark" : volume < 50 ? "volume-low" : "volume-high";
  const seriesName = selectedVideo?.seriesId ? seriesList.find(s => s.id === selectedVideo.seriesId)?.name : undefined;

  // ========== PLAYER MODAL JSX ==========

  const VideoPlayer = isOpen && selectedVideo ? (
    <>
      <style>{`
        .player-modal-shared {
          position: fixed; inset: 0; background: var(--bg); z-index: 5000;
          display: flex; flex-direction: column;
          animation: pmSlideUp 0.4s cubic-bezier(0.32,0.72,0,1);
        }
        @keyframes pmSlideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }

        .pm-top-bar {
          padding: env(safe-area-inset-top, 20px) 16px 8px;
          display: flex; align-items: center; justify-content: space-between;
          background: #000; flex-shrink: 0;
        }
        .pm-close-btn {
          width: 36px; height: 36px; border-radius: 50%;
          background: rgba(255,255,255,0.1); border: none; color: #fff;
          font-size: 18px; display: flex; align-items: center;
          justify-content: center; cursor: pointer;
        }
        .pm-close-btn:active { background: rgba(255,255,255,0.2); }

        .pm-video-area {
          width: 100%; aspect-ratio: 16/9; background: #000;
          position: relative; display: flex; flex-direction: column;
          justify-content: center; align-items: center; flex-shrink: 0;
        }
        .pm-video-area > img {
          width: 100%; height: 100%; object-fit: cover;
          position: absolute; inset: 0; opacity: 0.5;
        }
        .pm-yt-icon-wrap {
          position: absolute; inset: 0; z-index: 2;
          display: flex; align-items: center; justify-content: center;
        }
        .pm-yt-icon { font-size: 48px; color: #FF0000; }

        .pm-controls-overlay {
          position: absolute; inset: 0; z-index: 3;
          display: flex; flex-direction: column;
          justify-content: center; align-items: center; gap: 20px;
        }
        .pm-center-ctrls { display: flex; align-items: center; gap: 30px; }
        .pm-ctrl-btn {
          background: none; border: none; color: rgba(255,255,255,0.85);
          font-size: 22px; cursor: pointer; transition: all 0.2s ease;
          width: 48px; height: 48px; display: flex; align-items: center;
          justify-content: center; border-radius: 50%;
        }
        .pm-ctrl-btn:active { background: rgba(255,255,255,0.15); transform: scale(0.9); }
        .pm-ctrl-btn.main {
          width: 64px; height: 64px; background: rgba(255,255,255,0.95);
          color: var(--bg); font-size: 26px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.4);
        }
        .pm-ctrl-btn.main:active { background: rgba(255,255,255,0.8); }

        .pm-bottom-ctrls {
          position: absolute; bottom: 0; left: 0; right: 0;
          padding: 0 16px 12px; z-index: 3;
        }
        .pm-progress-bar {
          width: 100%; height: 4px; background: rgba(255,255,255,0.2);
          border-radius: 2px; cursor: pointer; position: relative; margin-bottom: 8px;
        }
        .pm-progress-fill {
          height: 100%; background: var(--primary); border-radius: 2px; position: relative;
        }
        .pm-progress-fill::after {
          content: ''; position: absolute; right: -6px; top: -4px;
          width: 12px; height: 12px; background: var(--primary);
          border-radius: 50%; opacity: 0; transition: opacity 0.2s;
        }
        .pm-progress-bar:hover .pm-progress-fill::after { opacity: 1; }
        .pm-time-row {
          display: flex; justify-content: space-between;
          font-size: 11px; color: rgba(255,255,255,0.6); font-weight: 500;
        }
        .pm-bottom-bar {
          display: flex; align-items: center; gap: 12px; padding: 4px 0;
        }
        .pm-vol-area { display: flex; align-items: center; gap: 8px; }
        .pm-vol-btn {
          background: none; border: none;
          color: rgba(255,255,255,0.7); font-size: 14px; cursor: pointer;
        }
        .pm-vol-slider {
          width: 60px; height: 3px; -webkit-appearance: none; appearance: none;
          background: rgba(255,255,255,0.2); border-radius: 2px;
          outline: none; cursor: pointer;
        }
        .pm-vol-slider::-webkit-slider-thumb {
          -webkit-appearance: none; width: 12px; height: 12px;
          border-radius: 50%; background: #fff; cursor: pointer;
        }
        .pm-full-btn {
          margin-left: auto; background: none; border: none;
          color: rgba(255,255,255,0.7); font-size: 16px; cursor: pointer;
        }

        .pm-info { padding: 16px 16px 0; overflow-y: auto; }
        .pm-info h2 { font-size: 18px; font-weight: 700; line-height: 1.3; margin-bottom: 8px; }
        .pm-info-meta {
          display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
          font-size: 13px; color: var(--text-secondary); margin-bottom: 14px;
        }
        .pm-info-meta .dot {
          width: 3px; height: 3px; background: var(--text-tertiary);
          border-radius: 50%;
        }
        .pm-actions-row { display: flex; gap: 10px; margin-bottom: 16px; }
        .pm-action-btn {
          flex: 1; padding: 12px; background: var(--surface);
          border: 1px solid var(--border); border-radius: 12px;
          color: var(--text-primary); font-size: 13px; font-weight: 600;
          display: flex; align-items: center; justify-content: center;
          gap: 8px; cursor: pointer; transition: all 0.2s ease;
        }
        .pm-action-btn:active { background: var(--surface-elevated); transform: scale(0.97); }
        .pm-action-btn.primary {
          background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end));
          border-color: transparent; color: #fff;
        }
        .pm-desc { font-size: 14px; color: var(--text-secondary); line-height: 1.7; margin-bottom: 20px; }

        .pm-upnext {
          padding: 16px; border-top: 1px solid var(--border); background: var(--bg);
        }
        .pm-upnext-header {
          display: flex; align-items: center; justify-content: space-between;
          margin-bottom: 10px;
        }
        .pm-upnext-title { font-size: 14px; font-weight: 700; display: flex; align-items: center; gap: 8px; }
        .pm-upnext-countdown { font-size: 13px; color: var(--primary); font-weight: 600; }
        .pm-upnext-cancel { background: none; border: none; color: var(--text-tertiary); font-size: 13px; font-weight: 500; cursor: pointer; }
        .pm-upnext-item {
          display: flex; gap: 12px; padding: 10px;
          background: var(--surface-card); border: 1px solid var(--border);
          border-radius: var(--radius-md); cursor: pointer; transition: all 0.2s ease;
        }
        .pm-upnext-item:active { background: var(--surface-elevated); }
        .pm-upnext-thumb {
          width: 100px; height: 56px; border-radius: 8px;
          overflow: hidden; flex-shrink: 0; border: 1px solid var(--border);
        }
        .pm-upnext-thumb img { width: 100%; height: 100%; object-fit: cover; }
        .pm-upnext-info { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; }
        .pm-upnext-name { font-size: 13px; font-weight: 600; line-height: 1.3; margin-bottom: 2px; }
        .pm-upnext-meta { font-size: 11px; color: var(--text-tertiary); }

        .pm-resume {
          position: absolute; bottom: 60px; left: 16px; right: 16px; z-index: 10;
          padding: 14px 18px; background: var(--surface-elevated);
          border: 1px solid var(--border); border-radius: var(--radius-md);
          box-shadow: 0 8px 32px rgba(0,0,0,0.5);
          display: flex; align-items: center; gap: 12px;
          animation: pmFadeUp 0.3s ease;
        }
        @keyframes pmFadeUp { from { opacity:0;transform:translateY(20px); } to { opacity:1;transform:translateY(0); } }
        .pm-resume-info { flex: 1; }
        .pm-resume-title { font-size: 13px; font-weight: 600; }
        .pm-resume-sub { font-size: 12px; color: var(--text-secondary); margin-top: 2px; }
        .pm-resume-actions { display: flex; gap: 8px; }
        .pm-resume-btn {
          padding: 8px 14px; border-radius: 10px;
          font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.2s ease;
        }
        .pm-resume-btn.primary { background: var(--primary); border: none; color: #fff; }
        .pm-resume-btn.secondary { background: var(--surface); border: 1px solid var(--border); color: var(--text-secondary); }
        .pm-resume-btn:active { transform: scale(0.95); }
      `}</style>

      <div className="player-modal-shared">
        {/* Top bar */}
        <div className="pm-top-bar">
          <button className="pm-close-btn" onClick={close}><i className="fas fa-chevron-down"></i></button>
          <span style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", fontWeight: 500 }}>
            {seriesName || "Now Playing"}
          </span>
          <div style={{ width: 36 }}></div>
        </div>

        {/* Video area */}
        <div className="pm-video-area">
          <img src={selectedVideo.thumbnail} alt={selectedVideo.title} />
          <div className="pm-yt-icon-wrap">
            <i className="fab fa-youtube pm-yt-icon"></i>
          </div>

          {/* Resume prompt */}
          {showResumePrompt && (
            <div className="pm-resume">
              <div className="pm-resume-info">
                <div className="pm-resume-title">Resume from {formatTime(resumePosition)}?</div>
                <div className="pm-resume-sub">You were {Math.round((resumePosition / durationSec) * 100)}% through this video</div>
              </div>
              <div className="pm-resume-actions">
                <button className="pm-resume-btn secondary" onClick={() => setShowResumePrompt(false)}>Start Over</button>
                <button className="pm-resume-btn primary" onClick={() => handlePlayFrom(resumePosition)}>Resume</button>
              </div>
            </div>
          )}

          {/* Controls overlay */}
          <div className="pm-controls-overlay">
            <div className="pm-center-ctrls">
              <button className="pm-ctrl-btn" onClick={() => skip(-10)}>
                <i className="fas fa-rotate-left"></i>
                <span style={{ fontSize: 9, position: "absolute", bottom: 6 }}>10</span>
              </button>
              <button className="pm-ctrl-btn main" onClick={togglePlay}>
                <i className={`fas fa-${isPlaying ? "pause" : "play"}`}></i>
              </button>
              <button className="pm-ctrl-btn" onClick={() => skip(10)}>
                <i className="fas fa-rotate-right"></i>
                <span style={{ fontSize: 9, position: "absolute", bottom: 6 }}>10</span>
              </button>
            </div>
          </div>

          {/* Bottom controls */}
          <div className="pm-bottom-ctrls">
            <div className="pm-progress-bar" onClick={seek}>
              <div className="pm-progress-fill" style={{ width: `${progressPct}%` }}></div>
            </div>
            <div className="pm-time-row">
              <span>{formatTime(currentTime)}</span>
              <span>{formattedDuration}</span>
            </div>
            <div className="pm-bottom-bar">
              <div className="pm-vol-area">
                <button className="pm-vol-btn" onClick={toggleMute}><i className={`fas fa-${volIcon}`}></i></button>
                <input className="pm-vol-slider" type="range" min="0" max="100" value={volume} onChange={handleVolumeChange} />
              </div>
              <button className={`pm-full-btn ${isFullscreen ? "active" : ""}`} onClick={toggleFullscreen} title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}>
                <i className={`fas fa-${isFullscreen ? "compress" : "expand"}`}></i>
              </button>
            </div>
          </div>
        </div>

        {/* Info */}
        <div className="pm-info">
          <h2>{selectedVideo.title}</h2>
          <div className="pm-info-meta">
            {seriesName && <><span>{seriesName}</span><span className="dot"></span></>}
            <span>{formattedDate}</span>
            <span className="dot"></span>
            <span>{formattedViews} views</span>
          </div>
          <div className="pm-actions-row">
            <button className="pm-action-btn primary" onClick={share}><i className="fas fa-share"></i> Share</button>
            <button className="pm-action-btn" onClick={watchOnYT}><i className="fab fa-youtube"></i> YouTube</button>
          </div>
          <div className="pm-desc">
            <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>About</h3>
            <p>{selectedVideo.description}</p>
          </div>
        </div>

        {/* Up Next */}
        {upNextVideo && (
          <div className="pm-upnext">
            <div className="pm-upnext-header">
              <div className="pm-upnext-title">
                <span>Up Next</span>
                {showUpNext && <span className="pm-upnext-countdown">Auto-play in {upNextCountdown}s</span>}
              </div>
              <button className="pm-upnext-cancel" onClick={() => setShowUpNext(false)}>Cancel</button>
            </div>
            <div className="pm-upnext-item" onClick={() => { play(upNextVideo); }}>
              <div className="pm-upnext-thumb">
                <img src={upNextVideo.thumbnail} alt={upNextVideo.title} />
              </div>
              <div className="pm-upnext-info">
                <div className="pm-upnext-name">{upNextVideo.title}</div>
                <div className="pm-upnext-meta">{formatISOToDisplay(upNextVideo.duration)} · {formatViewCount(upNextVideo.views)} views</div>
              </div>
            </div>
          </div>
        )}

        {/* Spacer for iOS safe area */}
        <div style={{ height: "env(safe-area-inset-bottom, 20px)" }}></div>
      </div>
    </>
  ) : null;

  return { VideoPlayer, play, close };
}
