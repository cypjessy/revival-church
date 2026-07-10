import type { Metadata, Viewport } from "next";
import { ToastProvider } from "@/components/ui/Toast";
import { AuthProvider } from "@/lib/AuthProvider";
import { AudioProvider } from "@/lib/audio/AudioContext";
import { TvPlayerProvider } from "@/lib/tv/TvPlayerProvider";
import { BackButtonHandler } from "@/components/shared/BackButtonHandler";
import { RootErrorBoundary } from "@/components/shared/RootErrorBoundary";
import "./globals.css";

export const metadata: Metadata = {
  title: "CHRISTIAN REVIVAL CHURCH",
  description:
    "CHRISTIAN REVIVAL CHURCH connects you to live radio, sermons, videos, and community — anywhere, anytime.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "CHRISTIAN REVIVAL CHURCH",
  },
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#0F0F0F",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning style={{ background: "#0F0F0F" }}>
      <head>
        {/* base target removed — broke navigation in APK. Use explicit target="_blank" on anchor tags instead. */}
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css"
          integrity="sha512-DTOQO9RWCH3ppGqcWaEA1BIZOC6xxalwEsw9c2QQeAIftl+Vegovlnee1c9QX4TctnWMn13TZye+giMm8e2LwA=="
          crossOrigin="anonymous"
          referrerPolicy="no-referrer"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body style={{ background: "#0F0F0F", margin: 0 }}>
        <AuthProvider>
          <AudioProvider>
            <TvPlayerProvider>
              <ToastProvider>
                <RootErrorBoundary>{children}</RootErrorBoundary>
              </ToastProvider>
              <BackButtonHandler />
            </TvPlayerProvider>
          </AudioProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
