"use client";

import { useState, useEffect } from "react";
import { signInWithEmailAndPassword, signInWithPopup } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { hapticSuccess, hapticError } from "@/lib/haptics";
import { auth, db, googleProvider } from "@/lib/firebase";
import { useAppStore } from "@/lib/useAppStore";
import { churchConfig } from "@/lib/churchConfig";

export default function LoginForm() {
  const router = useRouter();
  const { setUser, setUserDoc, setChurchConfig } = useAppStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [hasBiometric, setHasBiometric] = useState(false);
  const [biometricLoading, setBiometricLoading] = useState(false);
  function showToast(title: string, message: string, type: string, duration = 3000) {
    window.dispatchEvent(new CustomEvent("show-toast", { detail: { title, message, type, duration } }));
  }

  // Restore saved email on mount and check if biometric credentials exist
  useEffect(() => {
    (async () => {
      try {
        const { Preferences } = await import("@capacitor/preferences");
        const savedEmail = await Preferences.get({ key: "saved_email" });
        if (savedEmail.value) {
          setEmail(savedEmail.value);
        }

        // Check if user has previously enabled biometric login (but don't auto-trigger)
        const biometricEnabled = await Preferences.get({ key: "biometric_enabled" });
        if (biometricEnabled.value === "true") {
          setHasBiometric(true);
        }
      } catch {}
    })();
  }, []);

  async function handleBiometricLogin() {
    setBiometricLoading(true);
    try {
      const { NativeBiometric } = await import("capacitor-native-biometric");
      const available = await NativeBiometric.isAvailable();
      if (!available) {
        showToast("Not Available", "Biometrics are not available on this device", "error");
        setBiometricLoading(false);
        return;
      }

      const storedCreds = await NativeBiometric.getCredentials({ server: "mountain-of-deliverance-auth" });
      if (!storedCreds?.username || !storedCreds?.password) {
        showToast("No Credentials", "Please sign in manually first to set up biometrics", "info");
        setHasBiometric(false);
        setBiometricLoading(false);
        return;
      }

      await NativeBiometric.verifyIdentity({ reason: "Sign in to MOUNTAIN OF DELIVERANCE CHURCH", title: "Biometric Sign In" });

      setIsLoading(true);
      const result = await signInWithEmailAndPassword(auth, storedCreds.username, storedCreds.password);
      const firebaseUser = result.user;
      setUser(firebaseUser);

      const userDocRef = doc(db, "users", firebaseUser.uid);
      const userSnap = await getDoc(userDocRef);

      if (userSnap.exists()) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const userData = userSnap.data() as any;
        setUserDoc(userData);
        setChurchConfig(churchConfig);
        showToast("Welcome Back!", `Signed in as ${userData.display_name || storedCreds.username}`, "success", 2500);
        setTimeout(() => {
          if (userData.role === "admin") router.push("/admin");
          else router.push("/dashboard");
        }, 500);
      }
    } catch {
      // User cancelled or biometric failed — silently reset
      setBiometricLoading(false);
    }
  }

  async function handleLogin(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setError("");

    if (!email.includes("@")) {
      setError("Please enter a valid email address");
      await hapticError();
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      await hapticError();
      return;
    }

    setIsLoading(true);
    try {
      const result = await signInWithEmailAndPassword(auth, email, password);
      const firebaseUser = result.user;
      setUser(firebaseUser);

      // Fetch user doc
      const userDocRef = doc(db, "users", firebaseUser.uid);
      const userSnap = await getDoc(userDocRef);

      if (userSnap.exists()) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const userData = userSnap.data() as any;
        setUserDoc(userData);
        setChurchConfig(churchConfig);

        // Save email preference
        try {
          const { Preferences } = await import("@capacitor/preferences");
          if (rememberMe) {
            await Preferences.set({ key: "saved_email", value: email });
          } else {
            await Preferences.remove({ key: "saved_email" });
          }
        } catch {}

        await hapticSuccess();

        showToast("Welcome Back!", `Signed in as ${userData.display_name || email}`, "success", 2500);

        setTimeout(() => {
          if (userData.role === "admin") router.push("/admin");
          else router.push("/dashboard");
        }, 500);
      } else {
        showToast("Welcome!", "Account found. Setting up...", "info");
        setTimeout(() => router.push("/dashboard"), 500);
      }
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string };
      const code = e.code;
      await hapticError();
      if (code === "auth/user-not-found" || code === "auth/wrong-password" || code === "auth/invalid-credential") {
        setError("Invalid email or password");
      } else if (code === "auth/too-many-requests") {
        setError("Too many attempts. Please try again later");
      } else if (code === "auth/invalid-email") {
        setError("Invalid email address");
      } else {
        setError(e.message || "Something went wrong");
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function handleGoogleSignIn() {
    setError("");
    setIsLoading(true);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const firebaseUser = result.user;
      setUser(firebaseUser);

      const userDocRef = doc(db, "users", firebaseUser.uid);
      const userSnap = await getDoc(userDocRef);

      if (userSnap.exists()) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const userData = userSnap.data() as any;
        setUserDoc(userData);
        setChurchConfig(churchConfig);

        showToast("Welcome Back!", `Signed in as ${userData.display_name || firebaseUser.displayName}`, "success", 2500);

        setTimeout(() => {
          if (userData.role === "admin") router.push("/admin");
          else router.push("/dashboard");
        }, 500);
      } else {
        showToast("Welcome!", "Let's set up your profile", "info");
        document.getElementById("registerModal")?.classList.add("active");
        document.body.style.overflow = "hidden";
      }
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string };
      if (e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") {
        setError(e.message || "Google sign in failed");
      }
    } finally {
      setIsLoading(false);
    }
  }

  function handleForgotPassword() {
    document.getElementById("forgotModal")?.classList.add("active");
    document.body.style.overflow = "hidden";
  }

  return (
    <>
      {/* Hero */}
      <div className="login-hero">
        <div className="login-hero-bg"></div>
        <div className="login-hero-logo">
          <i className="fas fa-cross"></i>
        </div>
        <h1>Welcome Back</h1>
        <p>Sign in to access your church&apos;s live radio, sermons, and media</p>
      </div>

      {/* Form */}
      <form className="login-form" onSubmit={handleLogin}>
        {error && (
          <div style={{
            padding: "10px 14px",
            background: "rgba(255,107,107,0.1)",
            border: "1px solid rgba(255,107,107,0.2)",
            borderRadius: 12,
            fontSize: 13,
            color: "var(--error)",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}>
            <i className="fas fa-circle-exclamation"></i>
            <span>{error}</span>
          </div>
        )}

        <div className="input-group">
          <label>Email Address</label>
          <div className={`input-wrapper${error && !email.includes("@") ? " error" : ""}`}>
            <i className="fas fa-envelope"></i>
            <input
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
        </div>

        <div className="input-group">
          <label>Password</label>
          <div className={`input-wrapper${error && password.length < 6 ? " error" : ""}`}>
            <i className="fas fa-lock"></i>
            <input
              type={showPassword ? "text" : "password"}
              placeholder="Enter your password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              className="toggle-password"
              type="button"
              onClick={() => setShowPassword(!showPassword)}
            >
              <i className={`fas fa-${showPassword ? "eye" : "eye-slash"}`}></i>
            </button>
          </div>
        </div>

        <div className="login-options">
          <label className="remember-me">
            <input type="checkbox" checked={rememberMe} onChange={() => setRememberMe(!rememberMe)} />
            <span>Remember me</span>
          </label>
          <button type="button" className="forgot-password" onClick={handleForgotPassword}>
            Forgot Password?
          </button>
        </div>

        <button type="submit" className={`btn-primary${isLoading ? " loading" : ""}`} disabled={isLoading}>
          <span className="btn-text">Sign In</span>
          <span className="btn-loader"></span>
        </button>

        {hasBiometric && (
          <button
            type="button"
            className={`btn-biometric${biometricLoading ? " loading" : ""}`}
            onClick={handleBiometricLogin}
            disabled={isLoading || biometricLoading}
          >
            <i className="fas fa-fingerprint"></i>
            <span className="btn-text">{biometricLoading ? "Verifying..." : "Sign in with Fingerprint"}</span>
            <span className="btn-loader"></span>
          </button>
        )}

        <div className="divider">
          <span>or continue with</span>
        </div>

        <div className="social-login" style={{ justifyContent: "center" }}>
          <button type="button" className="social-btn google" onClick={handleGoogleSignIn} disabled={isLoading} style={{ maxWidth: 220 }}>
            <i className="fab fa-google"></i>
            <span>Continue with Google</span>
          </button>
        </div>
      </form>

      {/* Footer */}
      <div className="login-footer">
        <p>
          Don&apos;t have an account?{" "}
          <a href="#" onClick={(e) => {
            e.preventDefault();
            document.getElementById("registerModal")?.classList.add("active");
            document.body.style.overflow = "hidden";
          }}>
            Create Account
          </a>
        </p>
        <p style={{ marginTop: 16, fontSize: 12, color: "var(--text-tertiary)" }}>
          First time setting up?{" "}
          <a href="#" onClick={(e) => {
            e.preventDefault();
            document.getElementById("tempAdminModal")?.classList.add("active");
            document.body.style.overflow = "hidden";
          }}>
            Register as Admin
          </a>
        </p>
      </div>
    </>
  );
}
