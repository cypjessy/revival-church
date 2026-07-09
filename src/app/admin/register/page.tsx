"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { createUserWithEmailAndPassword, updateProfile, sendEmailVerification } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import PremiumTopBar from "@/components/shared/PremiumTopBar";

const ADMIN_REG_TOKEN = process.env.NEXT_PUBLIC_ADMIN_REG_TOKEN || "admin-secret-token";

function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const isTokenValid = token === ADMIN_REG_TOKEN;

  if (!isTokenValid) {
    return (
      <div style={{ padding: "40px 24px", textAlign: "center" }}>
        <div style={{ fontSize: 48, marginBottom: 16, color: "var(--error)" }}>
          <i className="fas fa-lock"></i>
        </div>
        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Invalid Link</h2>
        <p style={{ color: "var(--text-secondary)", fontSize: 14, lineHeight: 1.5 }}>
          This registration link is invalid or expired. Contact an existing admin for a new link.
        </p>
      </div>
    );
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!name.trim()) { setError("Please enter your full name"); return; }
    if (!email.includes("@")) { setError("Please enter a valid email"); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters"); return; }

    setIsLoading(true);
    try {
      const result = await createUserWithEmailAndPassword(auth, email, password);
      const firebaseUser = result.user;

      await updateProfile(firebaseUser, { displayName: name });

      const userDoc = {
        uid: firebaseUser.uid,
        email,
        display_name: name,
        photo_url: firebaseUser.photoURL || "",
        church_id: process.env.NEXT_PUBLIC_CHURCH_ID || "mountain_of_deliverance",
        role: "admin" as const,
        phone: "",
        is_verified: false,
        notification_preferences: {
          live_radio: true,
          youtube_live: true,
          new_sermons: true,
          new_photos: true,
          event_reminders: true,
        },
        created_at: Date.now(),
        last_seen: Date.now(),
      };

      await setDoc(doc(db, "users", firebaseUser.uid), userDoc);

      try {
        await sendEmailVerification(firebaseUser);
      } catch (_) {}

      setSuccess(true);
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string };
      const code = e.code;
      if (code === "auth/email-already-in-use") {
        setError("This email is already registered.");
      } else if (code === "auth/weak-password") {
        setError("Password should be at least 6 characters");
      } else {
        setError(e.message || "Registration failed");
      }
    } finally {
      setIsLoading(false);
    }
  }

  if (success) {
    return (
      <div style={{ padding: "40px 24px", textAlign: "center" }}>
        <div style={{ fontSize: 48, marginBottom: 16, color: "var(--success)" }}>
          <i className="fas fa-check-circle"></i>
        </div>
        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Admin Account Created!</h2>
        <p style={{ color: "var(--text-secondary)", fontSize: 14, lineHeight: 1.5, marginBottom: 24 }}>
          Welcome, {name}! You now have admin access. Check your email to verify your account.
        </p>
        <button
          onClick={() => router.push("/admin")}
          style={{
            padding: "14px 32px",
            background: "linear-gradient(135deg, var(--gradient-start), var(--gradient-end))",
            border: "none",
            borderRadius: 16,
            color: "#fff",
            fontSize: 15,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Go to Dashboard
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleRegister} style={{ padding: "24px" }}>
      <div style={{ textAlign: "center", marginBottom: 28 }}>
        <div
          style={{
            width: 72,
            height: 72,
            margin: "0 auto 16px",
            background: "linear-gradient(135deg, var(--gradient-start), var(--gradient-end))",
            borderRadius: 20,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 28,
            color: "#fff",
          }}
        >
          <i className="fas fa-user-shield"></i>
        </div>
        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>Create Admin Account</h2>
        <p style={{ color: "var(--text-secondary)", fontSize: 14 }}>
          Register as a church administrator
        </p>
      </div>

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
          marginBottom: 16,
        }}>
          <i className="fas fa-circle-exclamation"></i>
          <span>{error}</span>
        </div>
      )}

      <div className="input-group">
        <label>Full Name</label>
        <div className="input-wrapper">
          <i className="fas fa-user"></i>
          <input type="text" placeholder="Admin Name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
      </div>

      <div className="input-group" style={{ marginTop: 16 }}>
        <label>Email Address</label>
        <div className="input-wrapper">
          <i className="fas fa-envelope"></i>
          <input type="email" placeholder="admin@church.org" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
      </div>

      <div className="input-group" style={{ marginTop: 16 }}>
        <label>Password</label>
        <div className="input-wrapper">
          <i className="fas fa-lock"></i>
          <input
            type={showPassword ? "text" : "password"}
            placeholder="Min 6 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button className="toggle-password" type="button" onClick={() => setShowPassword(!showPassword)}>
            <i className={`fas fa-${showPassword ? "eye" : "eye-slash"}`}></i>
          </button>
        </div>
      </div>

      <button
        type="submit"
        className={`btn-primary${isLoading ? " loading" : ""}`}
        disabled={isLoading}
        style={{ marginTop: 24 }}
      >
        <span className="btn-text">Create Admin Account</span>
        <span className="btn-loader"></span>
      </button>
    </form>
  );
}

export default function AdminRegisterPage() {
  return (
    <>
      <style>{`
        :root {
          --primary: #E8A838;
          --primary-light: #F5C76B;
          --primary-dark: #C48A2A;
          --bg: #0F0F0F;
          --surface: #1A1A1A;
          --surface-elevated: #242424;
          --surface-card: #1E1E1E;
          --text-primary: #FFFFFF;
          --text-secondary: #A0A0A0;
          --text-tertiary: #6B6B6B;
          --border: #2A2A2A;
          --error: #FF6B6B;
          --success: #4ADE80;
          --overlay: rgba(0,0,0,0.85);
          --gradient-start: #E8A838;
          --gradient-end: #D4762A;
          --shadow-soft: 0 4px 20px rgba(232,168,56,0.15);
          --radius-full: 50%;
        }
        * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; }
        html, body { height: 100%; background: var(--bg); color: var(--text-primary); }
        .app-container { min-height: 100vh; display: flex; flex-direction: column; }
        @media (min-width: 768px) {
            .app-container { justify-content: center; }
        }
        .input-group { position: relative; }
        .input-group label { display: block; font-size: 13px; font-weight: 600; color: var(--text-secondary); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; }
        .input-wrapper { position: relative; background: var(--surface); border: 1.5px solid var(--border); border-radius: 16px; transition: all 0.25s ease; overflow: hidden; }
        .input-wrapper:focus-within { border-color: var(--primary); background: var(--surface-elevated); box-shadow: 0 0 0 4px rgba(232,168,56,0.08); }
        .input-wrapper i { position: absolute; left: 18px; top: 50%; transform: translateY(-50%); color: var(--text-tertiary); font-size: 18px; }
        .input-wrapper input { width: 100%; padding: 16px 18px 16px 50px; background: transparent; border: none; outline: none; color: var(--text-primary); font-size: 16px; font-weight: 500; }
        .input-wrapper input::placeholder { color: var(--text-tertiary); font-weight: 400; }
        .toggle-password { position: absolute; right: 16px; top: 50%; transform: translateY(-50%); background: none; border: none; color: var(--text-tertiary); font-size: 18px; cursor: pointer; padding: 4px; }
        .btn-primary { width: 100%; padding: 18px; background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end)); border: none; border-radius: 16px; color: #fff; font-size: 16px; font-weight: 700; cursor: pointer; position: relative; overflow: hidden; transition: all 0.3s ease; box-shadow: var(--shadow-soft); letter-spacing: 0.3px; }
        .btn-primary:active { transform: scale(0.97); box-shadow: none; }
        .btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
        .btn-primary .btn-text { transition: opacity 0.2s ease; }
        .btn-primary.loading .btn-text { opacity: 0; }
        .btn-primary .btn-loader { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 24px; height: 24px; border: 2.5px solid rgba(255,255,255,0.3); border-top-color: #fff; border-radius: 50%; animation: spin 0.7s linear infinite; opacity: 0; }
        .btn-primary.loading .btn-loader { opacity: 1; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
      <div className="app-container">
        <PremiumTopBar minimal />
        <Suspense fallback={<div style={{ padding: 40, textAlign: "center", color: "var(--text-secondary)" }}>Loading...</div>}>
          <RegisterForm />
        </Suspense>
      </div>
    </>
  );
}
