"use client";

import { Component, type ReactNode, type ErrorInfo } from "react";
import { reportError } from "@/lib/errorReporter";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Global error boundary that catches unhandled React render errors
 * and shows a graceful fallback. Without this, any uncaught JS error
 * crashes the Android WebView entirely ("app keeps stopping").
 */
export class RootErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    reportError(error, { componentStack: errorInfo.componentStack ?? "" });
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  handleGoHome = () => {
    this.setState({ hasError: false, error: null });
    if (typeof window !== "undefined") {
      window.location.href = "/dashboard";
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <>
          <style>{`
            .reb-overlay {
              position: fixed; inset: 0; z-index: 9999;
              background: #0F0F0F; color: #fff;
              display: flex; flex-direction: column;
              align-items: center; justify-content: center;
              padding: 32px; font-family: 'Inter', -apple-system, sans-serif;
            }
            .reb-icon {
              width: 80px; height: 80px; border-radius: 50%;
              background: rgba(239,68,68,0.1);
              display: flex; align-items: center; justify-content: center;
              font-size: 36px; color: #EF4444; margin-bottom: 20px;
            }
            .reb-title {
              font-size: 22px; font-weight: 800; margin-bottom: 8px;
              letter-spacing: -0.3px;
            }
            .reb-message {
              font-size: 14px; color: #A0A0A0; text-align: center;
              max-width: 320px; line-height: 1.6; margin-bottom: 24px;
            }
            .reb-actions { display: flex; gap: 12px; }
            .reb-btn {
              padding: 12px 24px; border-radius: 12px;
              font-size: 14px; font-weight: 700; cursor: pointer;
              transition: all 0.2s ease; border: none;
            }
            .reb-btn:active { transform: scale(0.95); }
            .reb-btn.primary {
              background: linear-gradient(135deg, #E8A838, #D4762A);
              color: #fff;
            }
            .reb-btn.secondary {
              background: #1A1A1A; color: #A0A0A0;
              border: 1px solid #2A2A2A;
            }
          `}</style>
          <div className="reb-overlay">
            <div className="reb-icon">
              <i className="fas fa-exclamation-triangle"></i>
            </div>
            <div className="reb-title">Something went wrong</div>
            <div className="reb-message">
              An unexpected error occurred. Please try again or go back to the home screen.
            </div>
            <div className="reb-actions">
              <button className="reb-btn secondary" onClick={this.handleGoHome}>
                <i className="fas fa-house" style={{ marginRight: 6 }}></i> Go Home
              </button>
              <button className="reb-btn primary" onClick={this.handleRetry}>
                <i className="fas fa-rotate" style={{ marginRight: 6 }}></i> Retry
              </button>
            </div>
          </div>
        </>
      );
    }

    return this.props.children;
  }
}
