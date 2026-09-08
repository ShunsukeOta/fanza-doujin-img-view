import { StrictMode, type ReactNode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { AgeGate } from "@/components/AgeGate";
import { HistoryPage } from "@/components/HistoryPage";
import { PrivacyPolicyPage, TermsPage } from "@/components/LegalPages";
import { MyPage } from "@/components/MyPage";
import { Onboarding } from "@/components/Onboarding";
import { SavedPage } from "@/components/SavedPage";
import { SwipePreviewApp } from "@/components/SwipePreviewApp";
import type { AssetType, FilterValues } from "@/lib/types";
import "@/styles/globals.css";
import "@/styles/navigation.css";
import "@/styles/pages.css";
import "@/styles/reader.css";
import "@/styles/onboarding.css";
import "@/styles/accessibility.css";
import { hasAgeVerification } from "@/src/ageVerification";
import { startAnalytics } from "@/src/analytics";
import { installMainResumeLifecycle, prepareMainResumeFallback } from "@/src/navigationState";

const ASSET_TYPES = new Set<AssetType>(["all", "comic", "cg", "game", "voice", "other"]);

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

function boundedFloat(
  params: URLSearchParams,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number.parseFloat(params.get(key) ?? "");
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  }, { once: true });
}

type MainExperienceProps = {
  initialFilters: FilterValues;
  initialCid: string;
};

function MainExperience({ initialFilters, initialCid }: MainExperienceProps) {
  // 一時仕様: 閲覧済みフラグを保存せず、メインページを新規表示するたびに必ず出す。
  const [onboardingComplete, setOnboardingComplete] = useState(false);

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
if (!["/saved", "/mypage", "/history", "/favorites", "/privacy", "/terms"].includes(pathname)) {
  prepareMainResumeFallback();
}

const params = new URLSearchParams(window.location.search);
const rawAsset = (params.get("asset_type") ?? params.get("category") ?? "all") as AssetType;
const initialFilters: FilterValues = {
  assetType: ASSET_TYPES.has(rawAsset) ? rawAsset : "all",
  genreId: (params.get("genre_id") ?? "").slice(0, 64),
  minSamples: boundedInt(params, "min_samples", 1, 1, 100),
  minReviews: boundedInt(params, "min_reviews", 0, 0, 100_000),
  minRating: boundedFloat(params, "min_rating", 0, 0, 5),
  minPrice: boundedInt(params, "min_price", 0, 0, 10_000_000),
  maxPrice: boundedInt(params, "max_price", 0, 0, 10_000_000),
  query: (params.get("q") ?? "").slice(0, 100),
};

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
    else if (pathname === "/mypage") protectedPage = <MyPage />;
    else if (pathname === "/history") protectedPage = <HistoryPage />;
    else protectedPage = <MainExperience initialFilters={initialFilters} initialCid={params.get("cid") ?? ""} />;
    app = <ProtectedExperience>{protectedPage}</ProtectedExperience>;
  }

  createRoot(root).render(<StrictMode>{app}</StrictMode>);
}
