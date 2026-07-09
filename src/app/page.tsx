"use client";

import { useEffect } from "react";
import { hapticSuccess, hapticError } from "@/lib/haptics";
import { ToastProvider } from "@/components/ui/Toast";
import SplashScreen from "@/components/auth/SplashScreen";
import LoginForm from "@/components/auth/LoginForm";
import ForgotPasswordModal from "@/components/auth/ForgotPasswordModal";
import PhoneLoginModal from "@/components/auth/PhoneLoginModal";
import CountryPickerModal from "@/components/auth/CountryPickerModal";
import RegisterModal from "@/components/auth/RegisterModal";
import TempAdminModal from "@/components/auth/TempAdminModal";
import PremiumTopBar from "@/components/shared/PremiumTopBar";


export default function LoginPage() {
  useEffect(() => {
    let cleanup: (() => void) | null = null;

    (async () => {
      try {
        const { Keyboard } = await import("@capacitor/keyboard");
        const { App } = await import("@capacitor/app");
        const { StatusBar, Style } = await import("@capacitor/status-bar");
        await StatusBar.setStyle({ style: Style.Dark });
        await StatusBar.setBackgroundColor({ color: "#0F0F0F" });

        const showListener = await Keyboard.addListener("keyboardWillShow", (info) => {
          const loginScreen = document.querySelector(".login-screen") as HTMLElement | null;
          if (loginScreen) {
            loginScreen.style.paddingBottom = info.keyboardHeight + "px";
          }
          // Scroll focused input into view so it isn't hidden by the keyboard
          setTimeout(() => {
            (document.activeElement as HTMLElement | null)?.scrollIntoView({ behavior: "smooth", block: "center" });
          }, 150);
        });
        const hideListener = await Keyboard.addListener("keyboardWillHide", () => {
          const loginScreen = document.querySelector(".login-screen") as HTMLElement | null;
          if (loginScreen) {
            loginScreen.style.paddingBottom = "0";
          }
        });
        const backListener = await App.addListener("backButton", () => {
          App.exitApp().catch(() => {});
        });

        cleanup = () => {
          showListener.remove();
          hideListener.remove();
          backListener.remove();
        };
      } catch {
        // Fallback for web — use the old custom event approach
        function handleKeyboardShow(e: Event) {
          const evt = e as CustomEvent;
          const loginScreen = document.querySelector(".login-screen") as HTMLElement | null;
          if (loginScreen) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            loginScreen.style.paddingBottom = (evt as any).keyboardHeight + "px";
          }
          setTimeout(() => {
            (document.activeElement as HTMLElement | null)?.scrollIntoView({ behavior: "smooth", block: "center" });
          }, 150);
        }
        function handleKeyboardHide() {
          const loginScreen = document.querySelector(".login-screen") as HTMLElement | null;
          if (loginScreen) {
            loginScreen.style.paddingBottom = "0";
          }
        }
        window.addEventListener("keyboardWillShow", handleKeyboardShow);
        window.addEventListener("keyboardWillHide", handleKeyboardHide);
        cleanup = () => {
          window.removeEventListener("keyboardWillShow", handleKeyboardShow);
          window.removeEventListener("keyboardWillHide", handleKeyboardHide);
        };
      }
    })();

    return () => cleanup?.();
  }, []);

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
            --shadow-elevated: 0 8px 32px rgba(0,0,0,0.4);
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            -webkit-tap-highlight-color: transparent;
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        }

        html, body {
            height: 100%;
            overflow: hidden;
            background: var(--bg);
            color: var(--text-primary);
        }

        .splash-screen {
            position: fixed;
            inset: 0;
            background: var(--bg);
            z-index: 10000;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            transition: opacity 0.6s ease, visibility 0.6s ease;
        }

        .splash-screen.hidden {
            opacity: 0;
            visibility: hidden;
        }

        .splash-logo {
            width: 120px;
            height: 120px;
            background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end));
            border-radius: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: var(--shadow-soft), 0 0 60px rgba(232,168,56,0.2);
            animation: splashPulse 2s ease-in-out infinite;
        }

        .splash-logo i {
            font-size: 52px;
            color: #fff;
        }

        .splash-brand {
            margin-top: 28px;
            font-size: 28px;
            font-weight: 800;
            letter-spacing: -0.5px;
            background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }

        .splash-tagline {
            margin-top: 8px;
            font-size: 14px;
            color: var(--text-tertiary);
            font-weight: 400;
        }

        .splash-loader {
            margin-top: 40px;
            width: 40px;
            height: 40px;
            border: 3px solid var(--surface-elevated);
            border-top-color: var(--primary);
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
        }

        @keyframes splashPulse {
            0%, 100% { transform: scale(1); box-shadow: var(--shadow-soft), 0 0 60px rgba(232,168,56,0.2); }
            50% { transform: scale(1.05); box-shadow: var(--shadow-soft), 0 0 80px rgba(232,168,56,0.35); }
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }

        .app-container {
            height: 100%;
            display: flex;
            flex-direction: column;
            position: relative;
            overflow: hidden;
        }

        .status-bar {
            height: env(safe-area-inset-top, 24px);
            min-height: 24px;
            background: var(--bg);
        }

        .login-screen {
            flex: 1;
            display: flex;
            flex-direction: column;
            padding: 0 28px;
            overflow-y: auto;
            -webkit-overflow-scrolling: touch;
        }

        .login-screen::-webkit-scrollbar { display: none; }

        .login-hero {
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 40px 0 32px;
            position: relative;
        }

        .login-hero-bg {
            position: absolute;
            top: -100px;
            left: 50%;
            transform: translateX(-50%);
            width: 400px;
            height: 400px;
            background: radial-gradient(circle, rgba(232,168,56,0.12) 0%, transparent 70%);
            pointer-events: none;
        }

        .login-hero-logo {
            width: 88px;
            height: 88px;
            background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end));
            border-radius: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: var(--shadow-soft);
            position: relative;
            z-index: 1;
        }

        .login-hero-logo i { font-size: 38px; color: #fff; }

        .login-hero h1 {
            margin-top: 24px;
            font-size: 26px;
            font-weight: 700;
            text-align: center;
            letter-spacing: -0.3px;
        }

        .login-hero p {
            margin-top: 8px;
            font-size: 15px;
            color: var(--text-secondary);
            text-align: center;
            line-height: 1.5;
            max-width: 280px;
        }

        .login-form {
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 20px;
        }

        .input-group { position: relative; }

        .input-group label {
            display: block;
            font-size: 13px;
            font-weight: 600;
            color: var(--text-secondary);
            margin-bottom: 8px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .input-wrapper {
            position: relative;
            background: var(--surface);
            border: 1.5px solid var(--border);
            border-radius: 16px;
            transition: all 0.25s ease;
            overflow: hidden;
        }

        .input-wrapper:focus-within {
            border-color: var(--primary);
            background: var(--surface-elevated);
            box-shadow: 0 0 0 4px rgba(232,168,56,0.08);
        }

        .input-wrapper.error {
            border-color: var(--error);
            box-shadow: 0 0 0 4px rgba(255,107,107,0.08);
        }

        .input-wrapper i {
            position: absolute;
            left: 18px;
            top: 50%;
            transform: translateY(-50%);
            color: var(--text-tertiary);
            font-size: 18px;
            transition: color 0.25s ease;
        }

        .input-wrapper:focus-within i { color: var(--primary); }

        .input-wrapper input {
            width: 100%;
            padding: 16px 54px 16px 50px;
            background: transparent;
            border: none;
            outline: none;
            color: var(--text-primary);
            font-size: 16px;
            font-weight: 500;
        }

        .input-wrapper input::placeholder {
            color: var(--text-tertiary);
            font-weight: 400;
        }

        .toggle-password {
            position: absolute;
            right: 14px;
            top: 50%;
            transform: translateY(-50%);
            background: none;
            border: none;
            color: var(--text-secondary);
            font-size: 20px;
            cursor: pointer;
            padding: 12px;
            z-index: 3;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: color 0.2s ease;
            min-width: 44px;
            min-height: 44px;
        }

        .toggle-password:active { color: var(--primary); }
        .toggle-password:hover { color: var(--text-primary); }

        .login-options {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-top: 4px;
        }

        .remember-me {
            display: flex;
            align-items: center;
            gap: 10px;
            cursor: pointer;
        }

        .remember-me input {
            appearance: none;
            width: 22px;
            height: 22px;
            border: 2px solid var(--border);
            border-radius: 6px;
            background: var(--surface);
            cursor: pointer;
            transition: all 0.2s ease;
            position: relative;
            flex-shrink: 0;
        }

        .remember-me input:checked {
            background: var(--primary);
            border-color: var(--primary);
        }

        .remember-me input:checked::after {
            content: '\\f00c';
            font-family: 'Font Awesome 6 Free';
            font-weight: 900;
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            color: #fff;
            font-size: 12px;
        }

        .remember-me span {
            font-size: 14px;
            color: var(--text-secondary);
            font-weight: 500;
        }

        .forgot-password {
            font-size: 14px;
            color: var(--primary);
            font-weight: 600;
            text-decoration: none;
            background: none;
            border: none;
            cursor: pointer;
        }

        .forgot-password:active { opacity: 0.7; }

        .btn-primary {
            width: 100%;
            padding: 18px;
            background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end));
            border: none;
            border-radius: 16px;
            color: #fff;
            font-size: 16px;
            font-weight: 700;
            cursor: pointer;
            position: relative;
            overflow: hidden;
            transition: all 0.3s ease;
            box-shadow: var(--shadow-soft);
            letter-spacing: 0.3px;
        }

        .btn-primary:active { transform: scale(0.97); box-shadow: none; }
        .btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }

        .btn-primary .btn-text { transition: opacity 0.2s ease; }
        .btn-primary.loading .btn-text { opacity: 0; }

        .btn-primary .btn-loader {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 24px;
            height: 24px;
            border: 2.5px solid rgba(255,255,255,0.3);
            border-top-color: #fff;
            border-radius: 50%;
            animation: spin 0.7s linear infinite;
            opacity: 0;
            transition: opacity 0.2s ease;
        }

        .btn-primary.loading .btn-loader { opacity: 1; }

        .btn-biometric {
            width: 100%;
            padding: 16px;
            background: var(--surface);
            border: 1.5px solid var(--border);
            border-radius: 16px;
            color: var(--text-primary);
            font-size: 15px;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            transition: all 0.2s ease;
            position: relative;
            font-family: inherit;
        }
        .btn-biometric:active { background: var(--surface-elevated); transform: scale(0.97); }
        .btn-biometric:disabled { opacity: 0.6; cursor: not-allowed; }
        .btn-biometric i { font-size: 20px; color: var(--primary); }
        .btn-biometric .btn-text { transition: opacity 0.2s ease; }
        .btn-biometric.loading .btn-text { opacity: 0; }
        .btn-biometric .btn-loader {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 22px;
            height: 22px;
            border: 2.5px solid var(--border);
            border-top-color: var(--primary);
            border-radius: 50%;
            animation: spin 0.7s linear infinite;
            opacity: 0;
            transition: opacity 0.2s ease;
        }
        .btn-biometric.loading .btn-loader { opacity: 1; }

        .divider {
            display: flex;
            align-items: center;
            gap: 16px;
            margin: 8px 0;
        }

        .divider::before, .divider::after {
            content: '';
            flex: 1;
            height: 1px;
            background: var(--border);
        }

        .divider span {
            font-size: 13px;
            color: var(--text-tertiary);
            font-weight: 500;
            text-transform: uppercase;
            letter-spacing: 1px;
        }

        .social-login { display: flex; gap: 12px; }

        .social-btn {
            flex: 1;
            padding: 16px;
            background: var(--surface);
            border: 1.5px solid var(--border);
            border-radius: 16px;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            color: var(--text-primary);
            font-size: 15px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s ease;
        }

        .social-btn:active { background: var(--surface-elevated); transform: scale(0.97); }
        .social-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .social-btn i { font-size: 20px; }
        .social-btn.google i { color: #EA4335; }
        .social-btn.phone i { color: var(--primary); }

        .login-footer {
            padding: 24px 0 32px;
            text-align: center;
        }

        .login-footer p {
            font-size: 14px;
            color: var(--text-secondary);
        }

        .login-footer a {
            color: var(--primary);
            font-weight: 700;
            text-decoration: none;
        }

        .login-footer a:active { opacity: 0.7; }


        .modal-overlay {
            position: fixed;
            inset: 0;
            background: var(--overlay);
            z-index: 9000;
            display: flex;
            align-items: flex-end;
            justify-content: center;
            opacity: 0;
            visibility: hidden;
            transition: opacity 0.3s ease, visibility 0.3s ease;
        }

        .modal-overlay.active { opacity: 1; visibility: visible; }

        .modal-sheet {
            width: 100%;
            max-height: 85vh;
            background: var(--surface);
            border-radius: 28px 28px 0 0;
            padding: 0 0 env(safe-area-inset-bottom, 20px);
            transform: translateY(100%);
            transition: transform 0.35s cubic-bezier(0.32, 0.72, 0, 1);
            overflow: hidden;
            display: flex;
            flex-direction: column;
        }

        .modal-overlay.active .modal-sheet { transform: translateY(0); }

        .modal-handle {
            width: 40px;
            height: 5px;
            background: var(--text-tertiary);
            border-radius: 3px;
            margin: 12px auto 8px;
            opacity: 0.5;
        }

        .modal-header {
            padding: 8px 24px 16px;
            text-align: center;
        }

        .modal-header h2 { font-size: 22px; font-weight: 700; margin-bottom: 6px; }
        .modal-header p { font-size: 14px; color: var(--text-secondary); line-height: 1.5; }

        .modal-body {
            flex: 1;
            overflow-y: auto;
            padding: 0 24px 20px;
            -webkit-overflow-scrolling: touch;
        }

        .modal-body::-webkit-scrollbar { display: none; }

        .modal-footer {
            padding: 16px 24px;
            border-top: 1px solid var(--border);
        }

        .terms-text {
            font-size: 13px;
            color: var(--text-tertiary);
            text-align: center;
            line-height: 1.6;
            margin-top: 16px;
        }

        .terms-text a {
            color: var(--primary);
            font-weight: 600;
            text-decoration: none;
        }

        @media (min-width: 480px) {
            .app-container {
                max-width: 480px;
                margin: 0 auto;
            }
        }
        @media (min-width: 768px) {
            .app-container { max-width: 100%; }
            .login-screen { padding: 0 32px; justify-content: center; }
            .login-hero { padding: 32px 0 24px; }
            .login-hero-logo { width: 100px; height: 100px; }
            .login-hero-logo i { font-size: 44px; }
            .login-hero h1 { font-size: 30px; }
            .login-hero p { font-size: 16px; max-width: 340px; }
            .input-wrapper input { padding: 18px 54px 18px 50px; font-size: 17px; }
            .btn-primary { padding: 20px; font-size: 17px; }
            .login-footer { padding: 28px 0 40px; }
            .modal-body { padding: 0 32px 24px; }
            .modal-header { padding: 8px 32px 20px; }
        }
      `}</style>

      <SplashScreen />

      <ToastProvider>
        <div className="app-container">
          <PremiumTopBar minimal />
          <div className="login-screen">
            <LoginForm />
          </div>
        </div>

        <RegisterModal />
        <TempAdminModal />
        <ForgotPasswordModal />
        <PhoneLoginModal />
        <CountryPickerModal />
      </ToastProvider>
    </>
  );
}
