import { StrictMode, type ReactNode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { AgeGate } from "@/components/AgeGate";
import { HistoryPage } from "@/components/HistoryPage";
import { PrivacyPolicyPage, TermsPage } from "@/components/LegalPages";
import { MyPage } from "@/components/MyPage";
import { SavedPage } from "@/components/SavedPage";
import { SearchPage } from "@/components/SearchPage";
import { SwipePreviewApp } from "@/components/SwipePreviewApp";
import type { FilterValues } from "@/lib/types";
import "@/styles/globals.css";
import "@/styles/navigation.css";
import "@/styles/pages.css";
import "@/styles/reader.css";
import "@/styles/discovery.css";
import "@/styles/accessibility.css";
import "@/styles/commerce.css";
import "@/styles/viewport.css";
import { hasAgeVerification } from "@/src/ageVerification";
import { startAnalytics } from "@/src/analytics";
import { installCommerceCtaTracking } from "@/src/commerceTracking";
import { installMainResumeLifecycle, prepareMainResumeFallback } from "@/src/navigationState";
import { installViewportSizing } from "@/src/viewport";

function boundedInt(
  params: URLSearchParams,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number.parseInt(params.get(key) ?? "", 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function ratingFilter(params: URLSearchParams): number {
  const raw = params.get("min_rating") ?? "";
  if (!/^[1-5]$/.test(raw)) return 0;
  return Number.parseInt(raw, 10);
}

function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  }, { once: true });
}

function workCidFromPath(pathname: string): string {
  const match = pathname.match(/^\/work\/([^/]+)$/);
  if (!match) return "";
  try {
    return decodeURIComponent(match[1]).slice(0, 256);
  } catch {
    return "";
  }
}

type MainExperienceProps = {
  initialFilters: FilterValues;
  initialCid: string;
};

function MainExperience({ initialFilters, initialCid }: MainExperienceProps) {
  useEffect(() => {
    installMainResumeLifecycle();
    return installCommerceCtaTracking();
  }, []);

  return <SwipePreviewApp initialFilters={initialFilters} initialCid={initialCid} />;
}

function ProtectedExperience({ children }: { children: ReactNode }) {
  const [verified, setVerified] = useState(() => hasAgeVerification());

  useEffect(() => {
    if (verified) startAnalytics();
  }, [verified]);

  if (!verified) {
    return <AgeGate onVerified={() => setVerified(true)} />;
  }

  return children;
}

const pathname = window.location.pathname.replace(/\/+$/, "") || "/";
const protectedSubpages = ["/saved", "/search", "/mypage", "/history"];
if (![...protectedSubpages, "/privacy", "/terms"].includes(pathname)) {
  prepareMainResumeFallback();
}

const params = new URLSearchParams(window.location.search);
const initialFilters: FilterValues = {
  genreId: (params.get("genre_id") ?? "").slice(0, 64),
  minSamples: boundedInt(params, "min_samples", 1, 1, 100),
  minReviews: boundedInt(params, "min_reviews", 0, 0, 100_000),
  minRating: ratingFilter(params),
  minPrice: boundedInt(params, "min_price", 0, 0, 10_000_000),
  maxPrice: boundedInt(params, "max_price", 0, 0, 10_000_000),
  query: (params.get("q") ?? "").slice(0, 100),
};
const workCid = workCidFromPath(pathname);

const root = document.getElementById("root");
if (!root) throw new Error("#root が見つかりません。");

installViewportSizing();
registerServiceWorker();

let app: ReactNode;
if (pathname === "/privacy") app = <PrivacyPolicyPage />;
else if (pathname === "/terms") app = <TermsPage />;
else {
  let protectedPage: ReactNode;
  if (pathname === "/saved") protectedPage = <SavedPage />;
  else if (pathname === "/search") protectedPage = <SearchPage />;
  else if (pathname === "/mypage") protectedPage = <MyPage />;
  else if (pathname === "/history") protectedPage = <HistoryPage />;
  else protectedPage = <MainExperience initialFilters={initialFilters} initialCid={workCid} />;
  app = <ProtectedExperience>{protectedPage}</ProtectedExperience>;
}

createRoot(root).render(<StrictMode>{app}</StrictMode>);
