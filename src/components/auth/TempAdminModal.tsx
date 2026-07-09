"use client";

import { useState } from "react";
import { createUserWithEmailAndPassword, updateProfile, sendEmailVerification } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import { useAppStore } from "@/lib/useAppStore";

const CHURCH_ID = process.env.NEXT_PUBLIC_CHURCH_ID || "mountain_of_deliverance";

export default function TempAdminModal() {
  const router = useRouter();
  const { setUser, setUserDoc } = useAppStore();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  function showToast(title: string, message: string, type: string, duration = 3000) {
    window.dispatchEvent(new CustomEvent("show-toast", { detail: { title, message, type, duration } }));
  }

  function closeModal() {
    document.getElementById("tempAdminModal")?.classList.remove("active");
    document.body.style.overflow = "";
  }

  async function handleRegister(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setError("");

    if (!name.trim()) { setError("Please enter your full name"); return; }
    if (!email.includes("@")) { setError("Please enter a valid email"); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters"); return; }
    if (password !== confirmPassword) { setError("Passwords do not match"); return; }

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
        church_id: CHURCH_ID,
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
      setUser(firebaseUser);
      setUserDoc(userDoc);

      try {
        await sendEmailVerification(firebaseUser);
      } catch (_) {}

      closeModal();
      showToast("Admin Account Created!", `Welcome ${name}! You now have full admin access.`, "success", 4000);
      setTimeout(() => router.push("/admin"), 800);
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string };
      const code = e.code;
      if (code === "auth/email-already-in-use") {
        setError("This email is already registered. Try signing in.");
      } else if (code === "auth/weak-password") {
        setError("Password should be at least 6 characters");
      } else if (code === "auth/invalid-email") {
        setError("Invalid email address");
      } else {
        setError(e.message || "Registration failed");
      }
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="modal-overlay" id="tempAdminModal">
      <div className="modal-sheet">
        <div className="modal-handle"></div>
        <div className="modal-header">
          <h2>Create Admin Account</h2>
          <p>Temporary admin registration — set up the church management dashboard</p>
        </div>
        <div className="modal-body">
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

          <div className="input-group" style={{ marginTop: "16px" }}>
            <label>Email Address</label>
            <div className="input-wrapper">
              <i className="fas fa-envelope"></i>
              <input type="email" placeholder="admin@church.org" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>

          <div className="input-group" style={{ marginTop: "16px" }}>
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

          <div className="input-group" style={{ marginTop: "16px" }}>
            <label>Confirm Password</label>
            <div className="input-wrapper">
              <i className="fas fa-lock"></i>
              <input
                type={showPassword ? "text" : "password"}
                placeholder="Re-enter password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
          </div>

          <p className="terms-text">
            This creates an admin account with full access to manage radio, TV, content, members, and church settings.
          </p>
        </div>
        <div className="modal-footer">
          <button className={`btn-primary${isLoading ? " loading" : ""}`} onClick={handleRegister} disabled={isLoading}>
            <span className="btn-text">Create Admin Account</span>
            <span className="btn-loader"></span>
          </button>
        </div>
      </div>
    </div>
  );
}
