"use client";

import { useEffect, useRef } from "react";
import { useToast } from "@/components/ui/Toast";

export default function MiniPlayer() {
  const { showToast } = useToast();
  const progressRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  const playRef = useRef<HTMLButtonElement>(null);
  const prevRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let isPlaying = false;
    let progress = 35;
    const progressEl = progressRef.current;
    const playBtn = playRef.current;
    const prevBtn = prevRef.current;
    const nextBtn = nextRef.current;
    const miniPlayer = playerRef.current;

    miniPlayer?.classList.add("visible");

    // Progress simulation
    const progressInterval = setInterval(() => {
      if (isPlaying && progressEl) {
        progress = (progress + 0.5) % 100;
        progressEl.style.width = progress + "%";
      }
    }, 1000);

    prevBtn?.addEventListener("click", () => {
      showToast("Previous Track", "Loading previous stream...", "info", 2000);
    });
    nextBtn?.addEventListener("click", () => {
      showToast("Next Track", "Loading next stream...", "info", 2000);
    });

    // Dispatch toggle event to sync with RadioPlayer
    function handleMiniPlay() {
      isPlaying = !isPlaying;
      if (playBtn) {
        playBtn.innerHTML = isPlaying
          ? '<i class="fas fa-pause"></i>'
          : '<i class="fas fa-play"></i>';
      }
      window.dispatchEvent(new CustomEvent("radio-toggle", { detail: { playing: isPlaying } }));
    }

    playBtn?.addEventListener("click", handleMiniPlay);

    // Listen for toggles from RadioPlayer
    function handleRemoteToggle(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.playing !== undefined) {
        isPlaying = detail.playing;
        if (playBtn) {
          playBtn.innerHTML = isPlaying ? '<i class="fas fa-pause"></i>' : '<i class="fas fa-play"></i>';
        }
      }
    }

    window.addEventListener("radio-toggle", handleRemoteToggle);

    return () => {
      clearInterval(progressInterval);
      playBtn?.removeEventListener("click", handleMiniPlay);
      window.removeEventListener("radio-toggle", handleRemoteToggle);
    };
  }, [showToast]);

  return (
    <div className="mini-player" ref={playerRef}>
      <div className="mini-thumb"><i className="fas fa-music"></i></div>
      <div className="mini-info">
        <div className="mini-title">Amazing Grace</div>
        <div className="mini-subtitle">Worship Team · CHRISTIAN REVIVAL CHURCH</div>
      </div>
      <div className="mini-controls">
        <button className="mini-btn" ref={prevRef}><i className="fas fa-backward-step"></i></button>
        <button className="mini-btn play" ref={playRef}><i className="fas fa-play"></i></button>
        <button className="mini-btn" ref={nextRef}><i className="fas fa-forward-step"></i></button>
      </div>
      <div className="mini-progress">
        <div className="mini-progress-bar" ref={progressRef}></div>
      </div>
    </div>
  );
}
