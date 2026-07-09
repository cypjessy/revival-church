"use client";

import { useEffect, useRef } from "react";
import { useToast } from "@/components/ui/Toast";

export default function RadioPlayer() {
  const { showToast } = useToast();
  const playBtnRef = useRef<HTMLButtonElement>(null);
  const waveRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let isPlaying = false;
    const playBtn = playBtnRef.current;
    const wave = waveRef.current;

    function toggleRadio() {
      isPlaying = !isPlaying;
      if (isPlaying) {
        if (playBtn) {
          playBtn.innerHTML = '<i class="fas fa-pause"></i>';
          playBtn.classList.add("playing");
        }
        if (wave) wave.classList.remove("paused");
        showToast("Now Playing", "Sunday Morning Worship — Live Stream", "info", 3000);
      } else {
        if (playBtn) {
          playBtn.innerHTML = '<i class="fas fa-play"></i>';
          playBtn.classList.remove("playing");
        }
        if (wave) wave.classList.add("paused");
      }
      // Dispatch custom event to sync MiniPlayer
      window.dispatchEvent(new CustomEvent("radio-toggle", { detail: { playing: isPlaying } }));
    }

    // Listen for toggles from MiniPlayer
    function handleRemoteToggle(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.playing !== undefined) {
        isPlaying = detail.playing;
        if (playBtn) {
          playBtn.innerHTML = isPlaying ? '<i class="fas fa-pause"></i>' : '<i class="fas fa-play"></i>';
          playBtn.classList.toggle("playing", isPlaying);
        }
        if (wave) wave.classList.toggle("paused", !isPlaying);
      }
    }

    playBtn?.addEventListener("click", toggleRadio);
    window.addEventListener("radio-toggle", handleRemoteToggle);

    return () => {
      playBtn?.removeEventListener("click", toggleRadio);
      window.removeEventListener("radio-toggle", handleRemoteToggle);
    };
  }, [showToast]);

  return (
    <section className="radio-section">
      <div className="radio-card">
        <div className="radio-live-badge"><span className="pulse"></span>Live Now</div>
        <div className="radio-info">
          <div className="radio-title">Sunday Morning Worship</div>
          <div className="radio-subtitle">MOUNTAIN OF DELIVERANCE CHURCH · Live Stream</div>
          <div className="radio-controls">
            <button className="radio-play-btn" ref={playBtnRef}>
              <i className="fas fa-play"></i>
            </button>
            <div className="radio-meta">
              <div className="radio-now-playing">Now Playing</div>
              <div className="radio-artist">Amazing Grace — Worship Team</div>
              <div className="radio-wave" ref={waveRef}>
                <span></span><span></span><span></span><span></span><span></span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
