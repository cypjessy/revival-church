"use client";

import { useState, useEffect } from "react";
import {
  getEnabledPaymentMethods,
  submitTransaction,
  type PaymentMethod,
} from "@/lib/giving";
import { auth } from "@/lib/firebase";

export default function GivePage() {
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod | null>(null);

  // Form
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [confirmationCode, setConfirmationCode] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getEnabledPaymentMethods()
      .then(setMethods)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMethod) return setError("Select a payment method");
    if (!amount.trim() || isNaN(Number(amount)) || Number(amount) <= 0)
      return setError("Enter a valid amount");
    if (!confirmationCode.trim())
      return setError("Enter your M-Pesa confirmation code");

    setError("");
    setSubmitting(true);
    try {
      const user = auth.currentUser;
      await submitTransaction({
        memberId: user?.uid || "anonymous",
        memberName: name.trim() || (user?.displayName || "Anonymous"),
        amount: Number(amount),
        paymentMethodId: selectedMethod.id!,
        paymentMethodLabel: selectedMethod.name,
        confirmationCode: confirmationCode.trim(),
        message: message.trim() || "",
        date: new Date().toISOString(),
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
          <div style={{ fontSize: 56, marginBottom: 16 }}>🎉</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Thank You!</h1>
          <p style={{ color: "rgba(255,255,255,0.6)", lineHeight: 1.6, fontSize: 15 }}>
            Your giving confirmation has been received. Our finance team will verify and send you a confirmation.
          </p>
          <p style={{ color: "rgba(255,255,255,0.3)", fontSize: 12, marginTop: 16 }}>
            M-Pesa Code: {confirmationCode}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: "100dvh", background: "#0F0F0F", color: "#fff",
      fontFamily: "system-ui, sans-serif",
    }}>
      {/* Header */}
      <div style={{
        background: "linear-gradient(180deg, rgba(16,185,129,0.08) 0%, transparent 100%)",
        padding: "48px 24px 32px", textAlign: "center",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>💰</div>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 6 }}>Give</h1>
        <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 14, lineHeight: 1.5 }}>
          Support the ministry by making a contribution
        </p>
      </div>

      <form onSubmit={handleSubmit} style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
        {error && (
          <div style={{
            padding: "12px 14px", borderRadius: 10, fontSize: 13,
            background: "rgba(239,68,68,0.1)", color: "#EF4444",
            border: "1px solid rgba(239,68,68,0.2)",
          }}>{error}</div>
        )}

        {/* Name */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{
            fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.5)",
            textTransform: "uppercase", letterSpacing: "0.5px",
          }}>Your Name <span style={{ opacity: 0.4 }}>(optional)</span></label>
          <input type="text" placeholder="Anonymous"
            value={name} onChange={(e) => setName(e.target.value)}
            style={inputStyle}
            onFocus={(e) => e.target.style.borderColor = "#10B981"}
            onBlur={(e) => e.target.style.borderColor = "#2A2A2A"} />
        </div>

        {/* Payment Methods */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{
            fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.5)",
            textTransform: "uppercase", letterSpacing: "0.5px",
          }}>Payment Method <span style={{ color: "#EF4444" }}>*</span></label>
          {loading ? (
            <div style={{ padding: 20, textAlign: "center", color: "rgba(255,255,255,0.3)", fontSize: 13 }}>
              Loading payment methods...
            </div>
          ) : methods.length === 0 ? (
            <div style={{
              padding: 20, textAlign: "center", borderRadius: 12,
              background: "#1A1A1A", border: "1px dashed #2A2A2A",
              color: "rgba(255,255,255,0.3)", fontSize: 13,
            }}>
              No payment methods available yet. Check back later.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {methods.map((m) => (
                <div key={m.id}
                  onClick={() => setSelectedMethod(m)}
                  style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "14px 16px", borderRadius: 12, cursor: "pointer",
                    background: selectedMethod?.id === m.id
                      ? "rgba(16,185,129,0.08)"
                      : "#1A1A1A",
                    border: selectedMethod?.id === m.id
                      ? "1.5px solid #10B981"
                      : "1.5px solid #2A2A2A",
                    transition: "all 0.2s ease",
                  }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: 10,
                    background: "rgba(16,185,129,0.1)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 16, color: "#10B981", flexShrink: 0,
                  }}>
                    <i className={`fas ${m.icon || "fa-circle-dollar"}`}></i>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>{m.name}</div>
                    {Object.keys(m.details).length > 0 && (
                      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>
                        {Object.entries(m.details).map(([k, v]) => `${k}: ${v}`).join(" · ")}
                      </div>
                    )}
                  </div>
                  <div style={{
                    width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
                    border: "2px solid",
                    borderColor: selectedMethod?.id === m.id ? "#10B981" : "rgba(255,255,255,0.15)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    {selectedMethod?.id === m.id && (
                      <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#10B981" }}></div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Instructions */}
        {selectedMethod?.instructions && (
          <div style={{
            padding: "12px 14px", borderRadius: 10,
            background: "rgba(16,185,129,0.04)",
            border: "1px solid rgba(16,185,129,0.1)",
            fontSize: 13, color: "rgba(255,255,255,0.6)", lineHeight: 1.6,
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#10B981", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Instructions
            </div>
            {selectedMethod.instructions.split("\n").map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        )}

        {/* Amount */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{
            fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.5)",
            textTransform: "uppercase", letterSpacing: "0.5px",
          }}>Amount (KSh) <span style={{ color: "#EF4444" }}>*</span></label>
          <div style={{ position: "relative" }}>
            <span style={{
              position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)",
              color: "rgba(255,255,255,0.3)", fontWeight: 700, fontSize: 15,
            }}>KSh</span>
            <input type="number" placeholder="0"
              value={amount} onChange={(e) => setAmount(e.target.value)}
              style={{ ...inputStyle, paddingLeft: 52 }}
              onFocus={(e) => e.target.style.borderColor = "#10B981"}
              onBlur={(e) => e.target.style.borderColor = "#2A2A2A"} />
          </div>
        </div>

        {/* Confirmation Code */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{
            fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.5)",
            textTransform: "uppercase", letterSpacing: "0.5px",
          }}>M-Pesa Confirmation Code <span style={{ color: "#EF4444" }}>*</span></label>
          <input type="text" placeholder="e.g. RHJ9X8"
            value={confirmationCode} onChange={(e) => setConfirmationCode(e.target.value)}
            style={{ ...inputStyle, textTransform: "uppercase", fontFamily: "monospace" }}
            onFocus={(e) => e.target.style.borderColor = "#10B981"}
            onBlur={(e) => e.target.style.borderColor = "#2A2A2A"} />
        </div>

        {/* Message */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{
            fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.5)",
            textTransform: "uppercase", letterSpacing: "0.5px",
          }}>Message <span style={{ opacity: 0.4 }}>(optional)</span></label>
          <textarea placeholder="Any notes about your contribution..."
            value={message} onChange={(e) => setMessage(e.target.value)}
            rows={3} maxLength={500}
            style={{
              ...inputStyle, resize: "vertical", minHeight: 60, fontFamily: "inherit",
            }}
            onFocus={(e) => e.target.style.borderColor = "#10B981"}
            onBlur={(e) => e.target.style.borderColor = "#2A2A2A"} />
        </div>

        <button type="submit" disabled={submitting || !amount || !confirmationCode || !selectedMethod}
          style={{
            width: "100%", padding: 16, borderRadius: 14, fontSize: 16, fontWeight: 700,
            border: "none", cursor: "pointer", marginTop: 4,
            background: !amount || !confirmationCode || !selectedMethod
              ? "#2A2A2A"
              : "linear-gradient(135deg, #10B981, #059669)",
            color: !amount || !confirmationCode || !selectedMethod
              ? "rgba(255,255,255,0.3)" : "#fff",
            fontFamily: "inherit", transition: "all 0.2s",
          }}>
          {submitting ? "Submitting..." : "Submit Giving Confirmation"}
        </button>
      </form>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "14px 16px", borderRadius: 12, fontSize: 15,
  background: "#1A1A1A", border: "1.5px solid #2A2A2A", color: "#fff",
  outline: "none",
};
