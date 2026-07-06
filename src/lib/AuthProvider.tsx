"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { useRouter, usePathname } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import { useAppStore } from "@/lib/useAppStore";
import type { UserDoc } from "@/lib/useAppStore";
import { churchConfig } from "@/lib/churchConfig";
import { usePushNotifications } from "@/hooks/usePushNotifications";

const PUBLIC_PATHS = ["/", "/login"];
const PUBLIC_PATH_PREFIXES: string[] = [];

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  useEffect(() => { pathnameRef.current = pathname; }, [pathname]);
  const { setUser, setUserDoc, setChurchConfig, setLoading, isLoading } =
    useAppStore();

  // Track whether we've ever seen a logged-in user during this session.
  // Used to distinguish "initial load (no user)" from "transient null during token refresh".
  const hasHadUserRef = useRef(false);
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastNavTimeRef = useRef(0);
  useEffect(() => { lastNavTimeRef.current = Date.now(); }, []);

  // Track navigation timestamps to detect client-side route changes
  // that may cause Firebase to briefly emit null (token refresh race).
  // We use a longer timeout (3000ms) when a navigation just happened
  // vs 500ms for other cases.
  useEffect(() => {
    lastNavTimeRef.current = Date.now();
  }, [pathname]);

  // Register push notifications when user is authenticated
  usePushNotifications();

  useEffect(() => {
    // Set church config immediately — it's local, no async needed
    setChurchConfig(churchConfig);

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      const currentPath = pathnameRef.current;

      if (firebaseUser) {
        hasHadUserRef.current = true;

        // Cancel any pending redirect — Firebase restored the user
        if (redirectTimerRef.current) {
          clearTimeout(redirectTimerRef.current);
          redirectTimerRef.current = null;
        }

        setUser(firebaseUser);

        try {
          const userDocRef = doc(db, "users", firebaseUser.uid);
          const userSnap = await getDoc(userDocRef);

          if (userSnap.exists()) {
            const userData = userSnap.data() as UserDoc;
            setUserDoc(userData);
            setLoading(false);

            // Route based on role
            const role = userData.role;
            const isAdminPath = currentPath?.startsWith("/admin");

            if (role === "admin" && !isAdminPath) {
              router.push("/admin");
            } else if (
              role === "member" &&
              (currentPath === "/" || currentPath === "/login")
            ) {
              router.push("/dashboard");
            } else if (role === "member" && isAdminPath) {
              router.push("/dashboard");
            }
          } else {
            // No user doc yet (first-time or incomplete registration)
            setLoading(false);
            if (!PUBLIC_PATHS.includes(currentPath || "/")) {
              router.push("/");
            }
          }
        } catch (err) {
          console.error("Error fetching user data:", err);
          setLoading(false);
        }
      } else {
        setUser(null);
        setUserDoc(null);
        setLoading(false);

        if (
          currentPath &&
          !PUBLIC_PATHS.includes(currentPath) &&
          !PUBLIC_PATH_PREFIXES.some(p => currentPath.startsWith(p))
        ) {
          if (hasHadUserRef.current) {
            // Transient null guard: Firebase can briefly emit null during
            // token refresh, especially in Android WebView after a
            // client-side navigation. Give more time (3000ms) if a
            // navigation just happened; otherwise use 500ms as before.
            // If the user comes back, the timer is cancelled in the
            // firebaseUser branch above. Clear any previous timer first
            // to prevent stacking in rare rapid-null scenarios.
            if (redirectTimerRef.current) {
              clearTimeout(redirectTimerRef.current);
            }
            const timeSinceNav = Date.now() - lastNavTimeRef.current;
            const delay = timeSinceNav < 2000 ? 3000 : 500;
            redirectTimerRef.current = setTimeout(() => {
              if (!auth.currentUser) {
                router.push("/");
              }
              redirectTimerRef.current = null;
            }, delay);
          } else {
            // First load — no user has ever been seen. Redirect immediately.
            router.push("/");
          }
        }
      }
    });

    return () => {
      unsubscribe();
      if (redirectTimerRef.current) {
        clearTimeout(redirectTimerRef.current);
      }
    };
    // Only run once on mount — pathname is tracked via ref to avoid
    // recreating the auth listener on every navigation, which causes
    // a race condition where the user briefly appears logged out.
  }, [router, setUser, setUserDoc, setChurchConfig, setLoading]);

  const isProtected =
    pathname &&
    !PUBLIC_PATHS.includes(pathname) &&
    !PUBLIC_PATH_PREFIXES.some(p => pathname.startsWith(p));

  if (isLoading && isProtected) {
    return (
      <div
        style={{
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0F0F0F",
          color: "#fff",
          fontFamily: "Inter, sans-serif",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            border: "3px solid #242424",
            borderTopColor: "#E8A838",
            borderRadius: "50%",
            animation: "spin 0.8s linear infinite",
          }}
        />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return <>{children}</>;
}

/** Hook to check if user has a specific role */
export function useRequireRole(requiredRole: "admin" | "member") {
  const { role, isLoading } = useAppStore();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && role !== requiredRole) {
      if (role === "admin") router.push("/admin");
      else if (role === "member") router.push("/dashboard");
      else router.push("/");
    }
  }, [role, isLoading, requiredRole, router]);

  return { isAuthorized: role === requiredRole, isLoading };
}
