"use client";

import { useEffect, useState } from "react";
import { sendPasswordResetEmail } from "firebase/auth";
import { auth } from "@/lib/firebase";

export default function ForgotPasswordModal() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function showToast(title: string, message: string, type: string, duration = 3000) {
    window.dispatchEvent(new CustomEvent("show-toast", { detail: { title, message, type, duration } }));
  }

  useEffect(() => {
    const openBtn = document.getElementById("forgotPasswordBtn");
    const modal = document.getElementById("forgotModal");
    const overlayHandler = (e: MouseEvent) => {
      if (e.target === e.currentTarget) {
        modal?.classList.remove("active");
        document.body.style.overflow = "";
        resetForm();
      }
    };
    const openHandler = () => {
      resetForm();
      modal?.classList.add("active");
      document.body.style.overflow = "hidden";
    };
    openBtn?.addEventListener("click", openHandler);
    modal?.addEventListener("click", overlayHandler);
    return () => {
      openBtn?.removeEventListener("click", openHandler);
      modal?.removeEventListener("click", overlayHandler);
    };
  }, []);

  function resetForm() {
    setEmail("");
    setSent(false);
    setLoading(false);
    setError("");
  }

  async function handleSubmit() {
    setError("");
    if (!email.includes("@")) {
      setError("Please enter a valid email address");
      return;
    }
    setLoading(true);
    try {
      await sendPasswordResetEmail(auth, email);
      setSent(true);
      showToast("Email Sent", "Check your inbox for password reset instructions", "success", 4000);
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string };
      const msg = e.code === "auth/user-not-found"
        ? "No account found with this email"
        : e.message || "Failed to send reset email";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" id="forgotModal">
      <div className="modal-sheet">
        <div className="modal-handle"></div>
        <div className="modal-header">
          <h2>Reset Password</h2>
          <p>Enter your email to receive password reset instructions</p>
        </div>
        <div className="modal-body">
          {sent ? (
            <div style={{ textAlign: "center", padding: "20px 0" }}>
              <div style={{
                width: 64, height: 64, borderRadius: "50%",
                background: "rgba(74,222,128,0.15)", color: "#4ADE80",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 28, margin: "0 auto 16px",
              }}>
                <i className="fas fa-envelope-circle-check"></i>
              </div>
              <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Email Sent</h3>
              <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                Check <strong>{email}</strong> for password reset instructions. The link expires in 1 hour.
              </p>
              <button
                className="btn-primary"
                style={{ marginTop: 24 }}
                onClick={() => {
                  document.getElementById("forgotModal")?.classList.remove("active");
                  document.body.style.overflow = "";
                  resetForm();
                }}
              >
                Done
              </button>
            </div>
          ) : (
            <div className="input-group">
              <label>Email Address</label>
              <div className={`input-wrapper${error ? " error" : ""}`}>
                <i className="fas fa-envelope"></i>
                <input
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(""); }}
                />
              </div>
              {error && (
                <div className="error-message" style={{ display: "flex", marginTop: 8, fontSize: 13, color: "var(--error)", gap: 6, alignItems: "center" }}>
                  <i className="fas fa-circle-exclamation"></i>
                  <span>{error}</span>
                </div>
              )}
            </div>
          )}
        </div>
        {!sent && (
          <div className="modal-footer">
            <button className="btn-primary" onClick={handleSubmit} disabled={loading}>
              {loading ? (
                <><i className="fas fa-spinner fa-spin"></i> Sending...</>
              ) : (
                "Send Reset Link"
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
