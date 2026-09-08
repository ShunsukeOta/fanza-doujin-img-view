import { StrictMode, type ReactNode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { AgeGate } from "@/components/AgeGate";
import { HistoryPage } from "@/components/HistoryPage";
import { PrivacyPolicyPage, TermsPage } from "@/components/LegalPages";
import { MyPage } from "@/components/MyPage";
import { Onboarding } from "@/components/Onboarding";
import { SavedPage } from "@/components/SavedPage";
import { SearchPage } from "@/components/SearchPage";
import { SwipePreviewApp } from "@/components/SwipePreviewApp";
import type { FilterValues } from "@/lib/types";
import "@/styles/globals.css";
import "@/styles/navigation.css";
import "@/styles/pages.css";
import "@/styles/reader.css";
import "@/styles/onboarding.css";
import "@/styles/discovery.css";
import "@/styles/accessibility.css";
import { hasAgeVerification } from "@/src/ageVerification";
import { startAnalytics } from "@/src/analytics";
import { installMainResumeLifecycle, prepareMainResumeFallback } from "@/src/navigationState";

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
  skipOnboarding?: boolean;
};

function MainExperience({ initialFilters, initialCid, skipOnboarding = false }: MainExperienceProps) {
  // 一時仕様: 通常のFeedは新規表示するたびに案内。作品共有URLは対象作品へ直接入る。
  const [onboardingComplete, setOnboardingComplete] = useState(skipOnboarding);

  useEffect(() => {
    if (onboardingComplete) installMainResumeLifecycle();
  }, [onboardingComplete]);

  if (!onboardingComplete) {
    return <Onboarding onComplete={() => setOnboardingComplete(true)} />;
  }

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
const protectedSubpages = ["/saved", "/search", "/mypage", "/history", "/favorites"];
if (![...protectedSubpages, "/privacy", "/terms"].includes(pathname)) {
  prepareMainResumeFallback();
}

const params = new URLSearchParams(window.location.search);
if (params.has("asset_type") || params.has("category")) {
  params.delete("asset_type");
  params.delete("category");
  const cleaned = params.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${cleaned ? `?${cleaned}` : ""}${window.location.hash}`);
}
const initialFilters: FilterValues = {
  genreId: (params.get("genre_id") ?? "").slice(0, 64),
  minSamples: boundedInt(params, "min_samples", 1, 1, 100),
  minReviews: boundedInt(params, "min_reviews", 0, 0, 100_000),
  minRating: ratingFilter(params),
  minPrice: boundedInt(params, "min_price", 0, 0, 10_000_000),
  maxPrice: boundedInt(params, "max_price", 0, 0, 10_000_000),
  query: (params.get("q") ?? "").slice(0, 100),
};
const pathWorkCid = workCidFromPath(pathname);
const workCid = pathWorkCid || (params.get("cid") ?? "");

const root = document.getElementById("root");
if (!root) throw new Error("#root が見つかりません。");

registerServiceWorker();

if (pathname === "/favorites") {
  window.location.replace("/saved");
} else {
  let app: ReactNode;
  if (pathname === "/privacy") app = <PrivacyPolicyPage />;
  else if (pathname === "/terms") app = <TermsPage />;
  else {
    let protectedPage: ReactNode;
    if (pathname === "/saved") protectedPage = <SavedPage />;
    else if (pathname === "/search") protectedPage = <SearchPage />;
    else if (pathname === "/mypage") protectedPage = <MyPage />;
    else if (pathname === "/history") protectedPage = <HistoryPage />;
    else protectedPage = (
      <MainExperience
        initialFilters={initialFilters}
        initialCid={workCid}
        skipOnboarding={pathWorkCid !== ""}
      />
    );
    app = <ProtectedExperience>{protectedPage}</ProtectedExperience>;
  }

  createRoot(root).render(<StrictMode>{app}</StrictMode>);
}
