"use client";

import { useState } from "react";
import { addPrayer } from "@/lib/churchAiData";
import { auth } from "@/lib/firebase";

export default function PrayerRequestPage() {
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [phone, setPhone] = useState("");
  const [isSensitive, setIsSensitive] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return setError("Please enter your prayer request");
    setError("");
    setSubmitting(true);
    try {
      await addPrayer({
        name: name.trim() || "Anonymous",
        phone,
        text: text.trim(),
        isSensitive,
        notes: "",
        assignedTo: "",
      });
      setSubmitted(true);
    } catch {
      setError("Something went wrong. Please try again.");
    }
    setSubmitting(false);
  };

  if (submitted) {
    return (
      <div style={{
        minHeight: "100dvh", background: "#0F0F0F", color: "#fff",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 24, fontFamily: "system-ui, sans-serif",
      }}>
        <div style={{ textAlign: "center", maxWidth: 360 }}>
          <div style={{ fontSize: 56, marginBottom: 16 }}>🙏</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Prayer Received</h1>
          <p style={{ color: "rgba(255,255,255,0.6)", lineHeight: 1.6, fontSize: 15 }}>
            Thank you for sharing your prayer request. Our team will be praying with you.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: "100dvh", background: "#0F0F0F", color: "#fff",
      display: "flex", flexDirection: "column",
      fontFamily: "system-ui, sans-serif",
    }}>
      <div style={{
        background: "linear-gradient(180deg, rgba(201,162,75,0.08) 0%, transparent 100%)",
        padding: "48px 24px 32px", textAlign: "center",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🙏</div>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 6 }}>Prayer Request</h1>
        <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 14, lineHeight: 1.5 }}>
          Share your prayer request and our church family will pray with you.
        </p>
      </div>

      <form onSubmit={handleSubmit} style={{
        padding: 24, display: "flex", flexDirection: "column", gap: 18, flex: 1,
      }}>
        {error && (
          <div style={{
            padding: "12px 14px", borderRadius: 10, fontSize: 13,
            background: "rgba(207,102,121,0.1)", color: "#CF6679",
            border: "1px solid rgba(207,102,121,0.2)",
          }}>{error}</div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
            Your Name <span style={{ opacity: 0.4 }}>(optional)</span>
          </label>
          <input type="text" placeholder="Anonymous"
            value={name} onChange={(e) => setName(e.target.value)}
            style={{
              width: "100%", padding: "14px 16px", borderRadius: 12, fontSize: 15,
              background: "#1A1A1A", border: "1.5px solid #2A2A2A", color: "#fff",
              outline: "none", fontFamily: "inherit",
            }}
            onFocus={(e) => e.target.style.borderColor = "#C9A24B"}
            onBlur={(e) => e.target.style.borderColor = "#2A2A2A"} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
            Phone Number <span style={{ opacity: 0.4 }}>(optional)</span>
          </label>
          <input type="tel" placeholder="+254 712 345 678"
            value={phone} onChange={(e) => setPhone(e.target.value)}
            style={{
              width: "100%", padding: "14px 16px", borderRadius: 12, fontSize: 15,
              background: "#1A1A1A", border: "1.5px solid #2A2A2A", color: "#fff",
              outline: "none", fontFamily: "inherit",
            }}
            onFocus={(e) => e.target.style.borderColor = "#C9A24B"}
            onBlur={(e) => e.target.style.borderColor = "#2A2A2A"} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
            Prayer Request <span style={{ color: "#CF6679" }}>*</span>
          </label>
          <textarea placeholder="Share what you'd like us to pray about..."
            value={text} onChange={(e) => setText(e.target.value)}
            rows={5} maxLength={1000}
            style={{
              width: "100%", padding: "14px 16px", borderRadius: 12, fontSize: 15,
              background: "#1A1A1A", border: "1.5px solid #2A2A2A", color: "#fff",
              outline: "none", fontFamily: "inherit", resize: "vertical", flex: 1, minHeight: 120,
            }}
            onFocus={(e) => e.target.style.borderColor = "#C9A24B"}
            onBlur={(e) => e.target.style.borderColor = "#2A2A2A"} />
          <div style={{ textAlign: "right", fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
            {text.length}/1000
          </div>
        </div>

        <label style={{
          display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
          padding: "12px 14px", borderRadius: 10,
          background: "rgba(201,162,75,0.04)", border: "1px solid rgba(201,162,75,0.1)",
        }}>
          <input type="checkbox" checked={isSensitive}
            onChange={(e) => setIsSensitive(e.target.checked)}
            style={{ width: 20, height: 20, accentColor: "#C9A24B" }} />
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Keep Private</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 1 }}>
              Only church leaders will see this request
            </div>
          </div>
        </label>

        <button type="submit" disabled={submitting || !text.trim()}
          style={{
            width: "100%", padding: 16, borderRadius: 14, fontSize: 16, fontWeight: 700,
            border: "none", cursor: "pointer", marginTop: 8,
            background: !text.trim() ? "#2A2A2A" : "linear-gradient(135deg, #C9A24B, #A8843A)",
            color: !text.trim() ? "rgba(255,255,255,0.3)" : "#000",
            fontFamily: "inherit", transition: "all 0.2s",
          }}>
          {submitting ? "Submitting..." : "Submit Prayer Request"}
        </button>
      </form>
    </div>
  );
}
