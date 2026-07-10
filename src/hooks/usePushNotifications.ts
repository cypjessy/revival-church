"use client";

import { useEffect, useRef } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAppStore } from "@/lib/useAppStore";

type PushNotificationData = {
  type?: string;
  url?: string;
  title?: string;
  body?: string;
};

export function usePushNotifications() {
  const { user, userDoc } = useAppStore();
  const registeredUid = useRef<string | null>(null);

  useEffect(() => {
    if (!user || !userDoc) return;
    if (registeredUid.current === user.uid) return;

    registeredUid.current = user.uid;

    const unsubs: (() => void)[] = [];

    (async () => {
      try {
        // Only run on native Android/iOS, not in browser dev mode
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const isNative = typeof (window as any).Capacitor !== "undefined" && (window as any).Capacitor.isNativePlatform();
        if (!isNative) return;

        const { PushNotifications } = await import("@capacitor/push-notifications");

        // Only register silently if permission is already granted.
        // We do NOT auto-prompt — the user must opt in explicitly via
        // onboarding or settings to avoid spamming on every login.
        const permStatus = await PushNotifications.checkPermissions();
        if (permStatus.receive !== "granted") return;

        await PushNotifications.register();

        const unsubReg = await PushNotifications.addListener("registration", async (token) => {
          const fcmToken = token.value;
          try {
            await updateDoc(doc(db, "users", user.uid), {
              fcm_token: fcmToken,
              last_seen: Date.now(),
            });
          } catch {}
        });
        unsubs.push(() => { try { unsubReg.remove(); } catch {} });

        const unsubRegErr = await PushNotifications.addListener("registrationError", () => {});
        unsubs.push(() => { try { unsubRegErr.remove(); } catch {} });

        const unsubReceived = await PushNotifications.addListener("pushNotificationReceived", (notification) => {
          const data = notification.data as PushNotificationData;
          const title = notification.title || data?.title || "CHRISTIAN REVIVAL CHURCH";
          const body = notification.body || data?.body || "";
          window.dispatchEvent(
            new CustomEvent("show-toast", {
              detail: { title, message: body, type: "info", duration: 4000 },
            })
          );
        });
        unsubs.push(() => { try { unsubReceived.remove(); } catch {} });

        const unsubAction = await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
          const data = action.notification.data as PushNotificationData;
          if (data?.url) {
            window.location.href = data.url;
          }
        });
        unsubs.push(() => { try { unsubAction.remove(); } catch {} });
      } catch {
        // Push notifications not available — safe to ignore
      }
    })();

    return () => {
      unsubs.forEach(fn => fn());
    };
  }, [user, userDoc]);
}
