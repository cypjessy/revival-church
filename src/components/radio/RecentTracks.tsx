"use client";

import { useEffect } from "react";
import { useToast } from "@/components/ui/Toast";
import AlbumArt from "@/components/shared/AlbumArt";

export default function RecentTracks() {
  const { showToast } = useToast();

  useEffect(() => {
    const items = document.querySelectorAll(".track-item");
    const trackMenus = document.querySelectorAll(".track-menu");

    const handler = (e: Event) => {
      const item = (e.currentTarget as HTMLElement).closest(".track-item") as HTMLElement;
      if (!item) return;
      document.querySelectorAll(".track-item").forEach((t) => t.classList.remove("playing"));
      item.classList.add("playing");
      const name = item.querySelector(".track-name")?.textContent || "";
      showToast("Now Playing", name, "info", 2500);
    };

    const menuHandler = (e: Event) => {
      e.stopPropagation();
      showToast("Options", "Add to playlist, Share, Not interested...", "info", 2500);
    };

    items.forEach((i) => i.addEventListener("click", handler));
    trackMenus.forEach((m) => m.addEventListener("click", menuHandler));

    return () => {
      items.forEach((i) => i.removeEventListener("click", handler));
      trackMenus.forEach((m) => m.removeEventListener("click", menuHandler));
    };
  }, [showToast]);

  return (
    <div className="tab-content" id="tracksTab" style={{ display: "none" }}>
      <div className="tracks-list">
        <div className="track-item playing">
          <div className="track-num">1</div>
          <div className="track-thumb"><AlbumArt className="track-thumb-img" size={40} fallbackIcon="fa-music" /></div>
          <div className="track-details">
            <div className="track-name">Amazing Grace</div>
            <div className="track-artist">Worship Team · MOUNTAIN OF DELIVERANCE CHURCH</div>
          </div>
          <span className="track-duration">4:32</span>
          <button className="track-menu"><i className="fas fa-ellipsis-vertical"></i></button>
        </div>
        <div className="track-item">
          <div className="track-num">2</div>
          <div className="track-thumb"><AlbumArt className="track-thumb-img" src="https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=100&h=100&fit=crop" size={40} fallbackIcon="fa-music" /></div>
          <div className="track-details">
            <div className="track-name">Way Maker</div>
            <div className="track-artist">Sinach · Live Performance</div>
          </div>
          <span className="track-duration">8:15</span>
          <button className="track-menu"><i className="fas fa-ellipsis-vertical"></i></button>
        </div>
        <div className="track-item">
          <div className="track-num">3</div>
          <div className="track-thumb"><AlbumArt className="track-thumb-img" size={40} fallbackIcon="fa-music" /></div>
          <div className="track-details">
            <div className="track-name">Tuko Pamoja</div>
            <div className="track-artist">Kenyan Gospel Collective</div>
          </div>
          <span className="track-duration">5:48</span>
          <button className="track-menu"><i className="fas fa-ellipsis-vertical"></i></button>
        </div>
        <div className="track-item">
          <div className="track-num">4</div>
          <div className="track-thumb"><AlbumArt className="track-thumb-img" src="https://images.unsplash.com/photo-1507692049790-de58290a4334?w=100&h=100&fit=crop" size={40} fallbackIcon="fa-music" /></div>
          <div className="track-details">
            <div className="track-name">Great Is Thy Faithfulness</div>
            <div className="track-artist">Choir · Hymn Revival</div>
          </div>
          <span className="track-duration">6:22</span>
          <button className="track-menu"><i className="fas fa-ellipsis-vertical"></i></button>
        </div>
        <div className="track-item">
          <div className="track-num">5</div>
          <div className="track-thumb"><AlbumArt className="track-thumb-img" size={40} fallbackIcon="fa-music" /></div>
          <div className="track-details">
            <div className="track-name">Mungu Mkuu</div>
            <div className="track-artist">Grace Worship Band</div>
          </div>
          <span className="track-duration">7:10</span>
          <button className="track-menu"><i className="fas fa-ellipsis-vertical"></i></button>
        </div>
        <div className="track-item">
          <div className="track-num">6</div>
          <div className="track-thumb"><AlbumArt className="track-thumb-img" src="https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=100&h=100&fit=crop" size={40} fallbackIcon="fa-music" /></div>
          <div className="track-details">
            <div className="track-name">10,000 Reasons</div>
            <div className="track-artist">Matt Redman · Cover</div>
          </div>
          <span className="track-duration">5:55</span>
          <button className="track-menu"><i className="fas fa-ellipsis-vertical"></i></button>
        </div>
        <div className="track-item">
          <div className="track-num">7</div>
          <div className="track-thumb"><AlbumArt className="track-thumb-img" size={40} fallbackIcon="fa-music" /></div>
          <div className="track-details">
            <div className="track-name">Nifundishe Kunyamaza</div>
            <div className="track-artist">Eunice Njeri</div>
          </div>
          <span className="track-duration">6:40</span>
          <button className="track-menu"><i className="fas fa-ellipsis-vertical"></i></button>
        </div>
        <div className="track-item">
          <div className="track-num">8</div>
          <div className="track-thumb"><AlbumArt className="track-thumb-img" src="https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=100&h=100&fit=crop" size={40} fallbackIcon="fa-music" /></div>
          <div className="track-details">
            <div className="track-name">What a Beautiful Name</div>
            <div className="track-artist">Hillsong Worship · Cover</div>
          </div>
          <span className="track-duration">5:28</span>
          <button className="track-menu"><i className="fas fa-ellipsis-vertical"></i></button>
        </div>
      </div>
    </div>
  );
}
