"use client";

import { useEffect, useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { getVideo, getVideosPage, getSeries } from "@/lib/youtube";
import type { YouTubeVideo, YouTubeSeries } from "@/lib/youtube";
import BottomNavBar from "@/components/shared/BottomNavBar";
import ToastBridge from "@/components/dashboard/ToastBridge";
import { useGlobalVideoPlayer } from "@/lib/video/VideoPlayerProvider";

const CATEGORY_COLORS: Record<string, string> = {
  sermon: "#E8A838",
  worship: "#8B5CF6",
  testimony: "#22C55E",
  "bible-study": "#3B82F6",
  event: "#EF4444",
  announcement: "#F59E0B",
};

export default function WatchVideoClient() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const [video, setVideo] = useState<YouTubeVideo | null>(null);
  const [allVideos, setAllVideos] = useState<YouTubeVideo[]>([]);
  const [seriesList, setSeriesList] = useState<YouTubeSeries[]>([]);
  const [loading, setLoading] = useState(true);
  const [liked, setLiked] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showDesc, setShowDesc] = useState(false);
  const [watchProgress, setWatchProgress] = useState<number>(0);

  const globalPlayer = useGlobalVideoPlayer();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        // Fetch the specific video + related data in parallel
        // Use getVideo() for a single document read instead of fetching 50 unnecessarily
        const [videoData, vpResult, sResult] = await Promise.all([
          getVideo(id),
          getVideosPage(12).catch(() => ({ videos: [] as YouTubeVideo[], lastDoc: null })),
          getSeries().catch(() => [] as YouTubeSeries[]),
        ]);
        if (cancelled) return;
        if (videoData) setVideo(videoData);
        else setVideo(null);
        setAllVideos(vpResult?.videos || []);
        setSeriesList(sResult || []);
      } catch {} finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(`watch_progress_${id}`);
      if (raw) {
        const prog = JSON.parse(raw);
        queueMicrotask(() => setWatchProgress(prog.position || 0));
      }
    } catch {}
  }, [id]);

  const seriesName = useMemo(() => {
    if (!video?.seriesId) return undefined;
    return seriesList.find((s) => s.id === video.seriesId)?.name;
  }, [video, seriesList]);

  const relatedVideos = useMemo(() => {
    if (!video) return [];
    return allVideos
      .filter((v) => v.youtubeId !== video.youtubeId)
      .sort((a, b) => {
        if (a.category === video.category && b.category !== video.category) return -1;
        if (b.category === video.category && a.category !== video.category) return 1;
        return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
      })
      .slice(0, 15);
  }, [video, allVideos]);

  const formatDate = (iso: string) => {
    if (!iso) return "";
    try { return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }); }
    catch { return iso; }
  };

  const formatCount = (n: number) => {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
    if (n >= 1000) return (n / 1000).toFixed(1) + "K";
    return String(n);
  };

  const parseISOToSeconds = (iso: string): number => {
    const m = iso.match(/PT(?:(\\d+)H)?(?:(\\d+)M)?(?:(\\d+)S)?/);
    if (!m) return 0;
    return (parseInt(m[1] || "0") * 3600) + (parseInt(m[2] || "0") * 60) + parseInt(m[3] || "0");
  };

  const handleLike = () => {
    setLiked(!liked);
    window.dispatchEvent(new CustomEvent("show-toast", {
      detail: { title: liked ? "Removed Like" : "Liked", message: liked ? "Video unliked" : "Video liked", type: "success", duration: 1500 },
    }));
  };

  const handleSave = () => {
    const next = !saved;
    setSaved(next);
    try {
      if (next) {
        const savedList = JSON.parse(localStorage.getItem("saved_videos") || "[]");
        savedList.push(id);
        localStorage.setItem("saved_videos", JSON.stringify([...new Set(savedList)]));
      } else {
        const savedList = JSON.parse(localStorage.getItem("saved_videos") || "[]");
        localStorage.setItem("saved_videos", JSON.stringify(savedList.filter((s: string) => s !== id)));
      }
    } catch {}
    window.dispatchEvent(new CustomEvent("show-toast", {
      detail: { title: next ? "Saved" : "Removed", message: next ? "Video saved to library" : "Video removed from library", type: "success", duration: 1500 },
    }));
  };

  const handleShare = async () => {
    const url = window.location.href;
    try {
      const { Share } = await import("@capacitor/share");
      await Share.share({ title: video?.title || "Watch", url });
    } catch {
      try {
        const { Clipboard } = await import("@capacitor/clipboard");
        await Clipboard.write({ string: url });
      } catch {
        try { await navigator.clipboard.writeText(url); } catch {}
      }
      window.dispatchEvent(new CustomEvent("show-toast", {
        detail: { title: "Copied", message: "Link copied to clipboard", type: "success", duration: 2000 },
      }));
    }
  };

  const handleWatchOnYT = async () => {
    if (video) {
      try {
        const { Browser } = await import("@capacitor/browser");
        await Browser.open({ url: `https://www.youtube.com/watch?v=${video.youtubeId}` });
      } catch {
        window.open(`https://www.youtube.com/watch?v=${video.youtubeId}`, "_blank");
      }
    }
  };

  if (loading) {
    return (
      <div className="app-container">
        <style>{`
          html,body{background:#0F0F0F;color:#fff;font-family:'Inter',sans-serif;margin:0;overflow:hidden}
          @keyframes sk-shimmer{0%{background-position:-400px 0}100%{background-position:400px 0}}
          .sk{background:linear-gradient(90deg,#1A1A1A 25%,#252525 50%,#1A1A1A 75%);background-size:800px 100%;animation:sk-shimmer 1.8s ease-in-out infinite;border-radius:8px}
          .sk-topbar{display:flex;align-items:center;gap:12px;padding:8px 12px;border-bottom:1px solid #2A2A2A;flex-shrink:0}
          .sk-back{width:36px;height:36px;border-radius:50%}
          .sk-top-title{height:16px;width:160px}
          .sk-player{width:100%;aspect-ratio:16/9;background:#0a0a0a;display:flex;align-items:center;justify-content:center;position:relative}
          .sk-play-pulse{width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,rgba(232,168,56,0.4),rgba(212,118,42,0.4));position:relative}
          .sk-play-pulse::before{content:'';position:absolute;inset:-8px;border-radius:50%;border:2px solid rgba(232,168,56,0.15);animation:sk-pulse 2s ease-in-out infinite}
          .sk-play-pulse::after{content:'\\f04b';font-family:'Font Awesome 6 Free';font-weight:900;position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:rgba(232,168,56,0.7);font-size:22px}
          @keyframes sk-pulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.15);opacity:0.5}}
          .sk-info{padding:14px 16px 0;display:flex;flex-direction:column;gap:12px}
          .sk-title{height:20px;width:75%}
          .sk-title:nth-child(2){width:50%}
          .sk-meta-row{display:flex;gap:12px;align-items:center;margin-top:2px}
          .sk-meta{height:14px;width:80px}
          .sk-meta:nth-child(2){width:120px}
          .sk-actions{display:flex;gap:8px;padding:0 16px;margin-top:14px}
          .sk-action{height:38px;width:70px;border-radius:12px}
          .sk-action:nth-child(3){width:80px}
          .sk-action:nth-child(4){width:90px}
          .sk-channel{display:flex;align-items:center;gap:12px;padding:12px 16px;border-top:1px solid #2A2A2A;border-bottom:1px solid #2A2A2A;margin:14px 16px 0}
          .sk-avatar{width:40px;height:40px;border-radius:50%}
          .sk-channel-name{height:14px;width:120px}
          .sk-channel-sub{height:11px;width:80px;margin-top:4px}
          .sk-desc{padding:0 16px;margin-top:14px;display:flex;flex-direction:column;gap:7px}
          .sk-desc-line{height:12px;width:100%}
          .sk-desc-line:nth-child(2){width:85%}
          .sk-desc-line:nth-child(3){width:60%}
          .sk-related{padding:16px;display:flex;flex-direction:column;gap:12px}
          .sk-related-title{height:16px;width:140px}
          .sk-related-item{display:flex;gap:10px}
          .sk-related-thumb{width:140px;aspect-ratio:16/9;border-radius:10px}
          .sk-related-info{flex:1;display:flex;flex-direction:column;gap:6px;padding:4px 0}
          .sk-related-name{height:14px;width:90%}
          .sk-related-name:nth-child(2){width:60%}
          .sk-related-meta{height:11px;width:70px}
          @media(max-width:480px){.sk{animation-duration:1.4s}}
        `}</style>
        <div className="sk-topbar"><div className="sk sk-back"></div><div className="sk sk-top-title"></div></div>
        <div className="sk-player"><div className="sk-play-pulse"></div></div>
        <div className="sk-info"><div className="sk sk-title"></div><div className="sk sk-title"></div><div className="sk-meta-row"><div className="sk sk-meta"></div><div className="sk sk-meta"></div></div></div>
        <div className="sk-actions"><div className="sk sk-action"></div><div className="sk sk-action"></div><div className="sk sk-action"></div><div className="sk sk-action"></div></div>
        <div className="sk-channel"><div className="sk sk-avatar"></div><div><div className="sk sk-channel-name"></div><div className="sk sk-channel-sub"></div></div></div>
        <div className="sk-desc"><div className="sk sk-desc-line"></div><div className="sk sk-desc-line"></div><div className="sk sk-desc-line"></div></div>
        <div className="sk-related"><div className="sk sk-related-title"></div>{[1,2,3].map(i => (<div className="sk-related-item" key={i}><div className="sk sk-related-thumb"></div><div className="sk-related-info"><div className="sk sk-related-name"></div><div className="sk sk-related-name"></div><div className="sk sk-related-meta"></div></div></div>))}</div>
      </div>
    );
  }

  if (!video) {
    return (
      <div className="app-container">
        <div className="w-notfound" style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:'100vh',gap:12,color:'var(--text-tertiary)',fontSize:14}}>
          <i className="fas fa-video-slash" style={{fontSize:48,color:'var(--text-tertiary)'}}></i>
          <h3 style={{fontSize:18,color:'var(--text-primary)',marginTop:4}}>Video not found</h3>
          <button className="w-back-btn" style={{padding:'10px 24px',borderRadius:12,background:'var(--surface)',border:'1px solid var(--border)',color:'var(--text-primary)',fontSize:14,fontWeight:600,cursor:'pointer',marginTop:8}} onClick={() => router.back()}>Go Back</button>
        </div>
        <style>{`html,body{background:#0F0F0F;color:#fff;font-family:'Inter',sans-serif;margin:0}`}</style>
      </div>
    );
  }

  return (
    <>
      <style>{`
        :root {
          --primary:#E8A838;--bg:#0F0F0F;--surface:#1A1A1A;
          --surface-elevated:#242424;--surface-card:#1E1E1E;
          --text-primary:#fff;--text-secondary:#A0A0A0;
          --text-tertiary:#6B6B6B;--border:#2A2A2A;
          --gradient-start:#E8A838;--gradient-end:#D4762A;
          --radius-sm:12px;--radius-md:16px;--radius-lg:20px;--radius-full:50%;
        }
        *{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent;font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif}
        html,body{height:100%;overflow:hidden;background:var(--bg);color:var(--text-primary)}
        .app-container{height:100%;display:flex;flex-direction:column;overflow:hidden}
        @media(min-width:480px){.app-container{max-width:480px;margin:0 auto;border-left:1px solid var(--border);border-right:1px solid var(--border)}}
        .w-scroll{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding-bottom:80px}
        .w-scroll::-webkit-scrollbar{display:none}
        .w-topbar{display:flex;align-items:center;gap:12px;padding:8px 12px;background:var(--bg);border-bottom:1px solid var(--border);flex-shrink:0}
        .w-back{width:36px;height:36px;border-radius:50%;background:var(--surface);border:none;color:var(--text-primary);font-size:16px;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0}
        .w-back:active{background:var(--surface-elevated)}
        .w-top-title{font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .w-player{position:relative;width:100%;aspect-ratio:16/9;background:#000;overflow:hidden}
        .w-player iframe{width:100%;height:100%;border:none}
        .w-info{padding:14px 16px 0}
        .w-title{font-size:17px;font-weight:800;line-height:1.35;margin-bottom:8px}
        .w-meta-row{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:14px}
        .w-meta-left{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text-tertiary)}
        .w-meta-left .dot{width:3px;height:3px;border-radius:50%;background:var(--text-tertiary)}
        .w-category-tag{display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;text-transform:capitalize}
        .w-cat-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
        .w-actions{display:flex;gap:8px;margin-bottom:16px;overflow-x:auto}
        .w-actions::-webkit-scrollbar{display:none}
        .w-action-btn{display:flex;align-items:center;gap:6px;padding:10px 16px;border-radius:12px;background:var(--surface);border:1px solid var(--border);color:var(--text-secondary);font-size:12px;font-weight:600;cursor:pointer;transition:all 0.2s;white-space:nowrap;flex-shrink:0}
        .w-action-btn:active{transform:scale(0.95);background:var(--surface-elevated)}
        .w-action-btn.active{background:rgba(232,168,56,0.1);border-color:rgba(232,168,56,0.2);color:var(--primary)}
        .w-action-btn.primary{background:linear-gradient(135deg,var(--gradient-start),var(--gradient-end));border-color:transparent;color:#fff}
        .w-channel-bar{display:flex;align-items:center;gap:12px;padding:12px 0;border-top:1px solid var(--border);border-bottom:1px solid var(--border);margin-bottom:14px}
        .w-channel-avatar{width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,var(--gradient-start),var(--gradient-end));display:flex;align-items:center;justify-content:center;color:#fff;font-size:16px;flex-shrink:0;font-weight:700}
        .w-channel-info{flex:1;min-width:0}
        .w-channel-name{font-size:14px;font-weight:700}
        .w-channel-sub{font-size:11px;color:var(--text-tertiary)}
        .w-series-tag{display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border-radius:10px;background:rgba(232,168,56,0.08);border:1px solid rgba(232,168,56,0.15);color:var(--primary);font-size:12px;font-weight:600;cursor:pointer;transition:all 0.2s}
        .w-desc{font-size:14px;color:var(--text-secondary);line-height:1.7;margin-bottom:16px}
        .w-desc.collapsed{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
        .w-desc-toggle{background:none;border:none;color:var(--text-tertiary);font-size:13px;font-weight:600;cursor:pointer;padding:0;margin-bottom:16px;display:block}
        .w-related{padding:0 16px 16px}
        .w-related-title{font-size:15px;font-weight:700;margin-bottom:12px;display:flex;align-items:center;gap:8px}
        .w-related-list{display:flex;flex-direction:column;gap:10px}
        .w-related-item{display:flex;gap:10px;cursor:pointer;transition:all 0.2s;padding:4px;border-radius:var(--radius-sm)}
        .w-related-item:active{background:var(--surface)}
        .w-related-thumb{width:140px;aspect-ratio:16/9;border-radius:10px;overflow:hidden;flex-shrink:0;background:var(--surface-elevated);position:relative;border:1px solid var(--border)}
        .w-related-thumb img{width:100%;height:100%;object-fit:cover;transition:transform 0.3s}
        .w-related-duration{position:absolute;bottom:5px;right:5px;padding:2px 6px;border-radius:4px;background:rgba(0,0,0,0.8);color:#fff;font-size:10px;font-weight:700}
        .w-related-info{flex:1;min-width:0}
        .w-related-name{font-size:13px;font-weight:600;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin-bottom:3px}
        .w-related-meta{font-size:11px;color:var(--text-tertiary);display:flex;align-items:center;gap:4px;flex-wrap:wrap}
      `}</style>
      <ToastBridge />
      <div className="app-container">
        <div className="w-topbar">
          <button className="w-back" onClick={() => router.back()}><i className="fas fa-chevron-left"></i></button>
          <div className="w-top-title">{video.title}</div>
        </div>
        <div className="w-scroll">            <div className="w-player">
            <iframe
              src={`https://www.youtube.com/embed/${video.youtubeId}?autoplay=1&rel=0&modestbranding=1&playsinline=1`}
              allow="autoplay; encrypted-media; fullscreen"
              allowFullScreen
              title={video.title}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none' }}
            />
          </div>
          <div className="w-info">
            <div className="w-title">{video.title}</div>
            <div className="w-meta-row">
              <div className="w-meta-left">
                <span>{formatCount(video.views)} views</span><span className="dot"></span><span>{formatDate(video.publishedAt)}</span>
              </div>
              <span className="w-category-tag" style={{background:`${CATEGORY_COLORS[video.category]||"#E8A838"}15`,color:CATEGORY_COLORS[video.category]||"var(--primary)"}}>
                <span className="w-cat-dot" style={{background:CATEGORY_COLORS[video.category]||"var(--primary)"}}></span>{video.category}
              </span>
            </div>
            <div className="w-actions">
              <button className={`w-action-btn ${liked?"active":""}`} onClick={handleLike}><i className="fas fa-heart"></i>{liked?"Liked":"Like"}</button>
              <button className="w-action-btn" onClick={handleShare}><i className="fas fa-share-nodes"></i> Share</button>
              <button className={`w-action-btn ${saved?"active":""}`} onClick={handleSave}><i className="fas fa-bookmark"></i>{saved?"Saved":"Save"}</button>
              <button className="w-action-btn primary" onClick={handleWatchOnYT}><i className="fab fa-youtube"></i> YouTube</button>
            </div>
            <div className="w-channel-bar">
              <div className="w-channel-avatar"><i className="fas fa-cross"></i></div>
              <div className="w-channel-info">
                <div className="w-channel-name">Kingdom Seekers Church Nakuru</div>
                <div className="w-channel-sub">{formatCount(allVideos.length)} videos</div>
              </div>
              {seriesName && <div className="w-series-tag" onClick={()=>{router.push("/watch");}}><i className="fas fa-list"></i> {seriesName}</div>}
            </div>
            {video.description && (<><div className={`w-desc ${!showDesc?"collapsed":""}`}>{video.description}</div>{video.description.length>150&&<button className="w-desc-toggle" onClick={()=>setShowDesc(!showDesc)}>{showDesc?"Show less":"Show more"} <i className={`fas fa-chevron-${showDesc?"up":"down"}`} style={{fontSize:10,marginLeft:4}}></i></button>}</>)}
          </div>
          <div className="w-related">
            <div className="w-related-title"><i className="fas fa-list"></i> Related Videos</div>
            {relatedVideos.length===0?<div className="w-empty-related" style={{padding:20,textAlign:'center',color:'var(--text-tertiary)',fontSize:13}}>No related videos found</div>
            :<div className="w-related-list">{relatedVideos.slice(0,10).map(rv=>(
              <div className="w-related-item" key={rv.youtubeId} onClick={()=>globalPlayer.play(rv.youtubeId)}>
                <div className="w-related-thumb"><img src={rv.thumbnail} alt={rv.title} loading="lazy"/><span className="w-related-duration">{rv.duration}</span></div>
                <div className="w-related-info">
                  <div className="w-related-name">{rv.title}</div>
                  <div className="w-related-meta"><span>{formatCount(rv.views)} views</span><span>·</span><span>{formatDate(rv.publishedAt).split(",")[0]}</span></div>
                  <div className="w-related-meta" style={{marginTop:2}}><span className="w-cat-dot" style={{width:5,height:5,background:CATEGORY_COLORS[rv.category]||"var(--primary)"}}></span><span style={{textTransform:"capitalize"}}>{rv.category}</span></div>
                </div>
              </div>
            ))}</div>}
          </div>
        </div>
        <BottomNavBar activeTab="watch" />
      </div>
    </>
  );
}
