"use client";

import { useEffect, useRef } from "react";
import { useToast } from "@/components/ui/Toast";

export default function MainPlayer() {
  const { showToast } = useToast();
  const progressFillRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let isPlaying = true;
    let progress = 38;
    const playBtn = document.getElementById("playBtn");
    const progressFill = progressFillRef.current;

    function togglePlay() {
      isPlaying = !isPlaying;
      if (playBtn) {
        playBtn.innerHTML = isPlaying
          ? '<i class="fas fa-pause"></i>'
          : '<i class="fas fa-play"></i>';
        playBtn.classList.toggle("playing", isPlaying);
      }
      showToast(
        isPlaying ? "Now Playing" : "Paused",
        isPlaying ? "Sunday Morning Worship — Live Stream" : "Stream paused",
        "info",
        2500
      );
    }

    playBtn?.addEventListener("click", togglePlay);

    const progressInterval = setInterval(() => {
      if (isPlaying && progressFill) {
        progress = (progress + 0.3) % 100;
        progressFill.style.width = progress + "%";
      }
    }, 1000);

    // Like
    const likeBtn = document.getElementById("likeBtn");
    function handleLike() {
      likeBtn?.classList.toggle("active");
      const isLiked = likeBtn?.classList.contains("active");
      showToast(
        isLiked ? "Added to Favorites" : "Removed from Favorites",
        isLiked ? "Track saved to your liked songs" : "Track removed from liked songs",
        isLiked ? "success" : "info",
        2500
      );
    }
    likeBtn?.addEventListener("click", handleLike);

    // Prev / Next / Share
    const prevBtn = document.getElementById("prevBtn");
    const nextBtn = document.getElementById("nextBtn");
    const shareBtn = document.getElementById("shareBtn");

    function handlePrev() { showToast("Previous", "Loading previous track...", "info", 2000); }
    function handleNext() { showToast("Next Track", "Loading next track...", "info", 2000); }
    function handleShare() { showToast("Share", "Share dialog opened", "info", 2000); }

    prevBtn?.addEventListener("click", handlePrev);
    nextBtn?.addEventListener("click", handleNext);
    shareBtn?.addEventListener("click", handleShare);

    // Progress bar tap
    const progressBar = document.getElementById("progressBar");
    function handleProgressTap(e: MouseEvent) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const percent = ((e.clientX - rect.left) / rect.width) * 100;
      if (progressFill) progressFill.style.width = percent + "%";
      progress = percent;
    }
    progressBar?.addEventListener("click", handleProgressTap);

    return () => {
      playBtn?.removeEventListener("click", togglePlay);
      likeBtn?.removeEventListener("click", handleLike);
      prevBtn?.removeEventListener("click", handlePrev);
      nextBtn?.removeEventListener("click", handleNext);
      shareBtn?.removeEventListener("click", handleShare);
      progressBar?.removeEventListener("click", handleProgressTap);
      clearInterval(progressInterval);
    };
  }, [showToast]);

  return (
    <div className="main-player">
      <div className="player-card">
        <div className="player-artwork">
          <div className="live-pulse-ring"></div>
          <div className="live-pulse-ring"></div>
          <i className="fas fa-radio"></i>
        </div>
        <div className="player-info">
          <div className="player-live-badge"><span className="pulse"></span>Live Now</div>
          <div className="player-track">Sunday Morning Worship</div>
          <div className="player-artist">CHRISTIAN REVIVAL CHURCH · Worship Team</div>
        </div>
        <div className="player-progress">
          <div className="progress-bar" id="progressBar">
            <div className="progress-fill" id="progressFill" ref={progressFillRef}></div>
          </div>
          <div className="progress-time">
            <span>Live</span>
            <span>Streaming</span>
          </div>
        </div>
        <div className="player-controls">
          <button className="ctrl-btn like" id="likeBtn"><i className="fas fa-heart"></i></button>
          <button className="ctrl-btn" id="prevBtn"><i className="fas fa-backward-step"></i></button>
          <button className="ctrl-play" id="playBtn"><i className="fas fa-pause"></i></button>
          <button className="ctrl-btn" id="nextBtn"><i className="fas fa-forward-step"></i></button>
          <button className="ctrl-btn" id="shareBtn"><i className="fas fa-share-nodes"></i></button>
        </div>
      </div>
    </div>
  );
}
