"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

export default function AdminTopBar() {
  const router = useRouter();
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const notifBtn = document.getElementById("adminNotifBtn");
    const profileBtn = document.getElementById("adminProfileBtn");

    const handleNotif = () => {
      window.dispatchEvent(
        new CustomEvent("show-toast", {
          detail: { title: "Notifications", message: "3 new admin notifications", type: "info", duration: 2500 },
        })
      );
    };

    const handleProfile = () => {
      router.push("/admin/settings");
    };

    notifBtn?.addEventListener("click", handleNotif);
    profileBtn?.addEventListener("click", handleProfile);

    cleanupRef.current = () => {
      notifBtn?.removeEventListener("click", handleNotif);
      profileBtn?.removeEventListener("click", handleProfile);
    };

    return () => cleanupRef.current?.();
  }, [router]);

  return (
    <header className="header">
      <div className="header-brand">
        <div className="header-logo"><i className="fas fa-cross"></i></div>
        <div className="header-text">
          <h1>CHRISTIAN REVIVAL CHURCH</h1>
        </div>
      </div>
      <div className="header-actions">
        <button className="header-btn" id="adminNotifBtn"><i className="fas fa-bell"></i><span className="badge"></span></button>
        <button className="header-btn" id="adminProfileBtn"><i className="fas fa-user-shield"></i></button>
      </div>
    </header>
  );
}
