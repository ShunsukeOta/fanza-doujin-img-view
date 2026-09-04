import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import "./feed-stats.css";

export const metadata: Metadata = {
  title: "FANZA同人 Swipe Preview",
  description: "FANZA同人のsample_lを縦横スワイプで検証するSP向けプレビュー",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#090909",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
