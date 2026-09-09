import { useCallback, useEffect, useState } from "react";

import { GlobalNav } from "@/components/GlobalNav";
import { BookmarkIcon, ExternalIcon } from "@/components/icons";
import {
  WorkCardActions,
  WorkCardBody,
  WorkCardFrame,
  WorkCardMedia,
  WorkCardMeta,
  WorkCardTitle,
  WorkListFeedback,
} from "@/components/WorkCardPrimitives";
import type { FeedItem } from "@/lib/types";
import { trackEvent } from "@/src/analytics";
import { fetchJson } from "@/src/api";
import { openWorkInMain } from "@/src/navigationState";
import { formatPrice } from "@/src/price";
import { updateSaveState } from "@/src/saveState";
import { isHttpUrl, mergeUniqueByCid } from "@/src/workUtils";

type SavedResponse = {
  ok: boolean;
  items: FeedItem[];
  total: number;
  nextCursor: string | null;
  hasMore: boolean;
};

export function SavedPage() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [pendingCid, setPendingCid] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchJson<SavedResponse>(
        "/api/saved?limit=24",
        {
          headers: { Accept: "application/json", "Cache-Control": "no-cache" },
          credentials: "same-origin",
          cache: "no-store",
        },
        "保存済み作品を取得できませんでした",
      );
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
      setCursor(data.nextCursor);
      setHasMore(data.hasMore);
    } catch (requestError) {
      setError(requestError instanceof Error
        ? requestError.message
        : "保存済み作品を取得できませんでした。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = async () => {
    if (!hasMore || !cursor || loadingMore) return;
    setLoadingMore(true);
    setError("");
    try {
      const query = new URLSearchParams({ limit: "24", cursor });
      const data = await fetchJson<SavedResponse>(
        `/api/saved?${query}`,
        { headers: { Accept: "application/json" }, credentials: "same-origin", cache: "no-store" },
        "保存済み作品を追加取得できませんでした",
      );
      setItems((current) => mergeUniqueByCid(current, data.items ?? []));
      setCursor(data.nextCursor);
      setHasMore(data.hasMore);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "追加取得に失敗しました。");
    } finally {
      setLoadingMore(false);
    }
  };

  const removeSaved = async (item: FeedItem) => {
    if (pendingCid) return;
    setPendingCid(item.cid);
    setError("");
    try {
      await updateSaveState(item.cid, false);
      setItems((current) => current.filter((candidate) => candidate.cid !== item.cid));
      setTotal((current) => Math.max(0, current - 1));
    } catch {
      setError("保存解除に失敗しました。もう一度お試しください。");
    } finally {
      setPendingCid("");
    }
  };

  return (
    <div className="subpage-shell">
      <header className="subpage-header">
        <h1>保存済み</h1>
        <button className="subpage-refresh" type="button" onClick={() => void load()} disabled={loading}>再読込</button>
      </header>

      <main className="subpage-content">
        <div className="subpage-summary" aria-label={`保存した作品 ${total}件`}>
          <span>保存した作品 <strong>{total.toLocaleString("ja-JP")}</strong>件</span>
        </div>

        {loading ? (
          <div className="subpage-state"><div className="spinner" aria-hidden="true" /><strong>保存済み作品を読み込んでいます</strong></div>
        ) : items.length === 0 && error ? (
          <div className="subpage-state is-error"><strong>読み込みに失敗しました</strong><p>{error}</p><button type="button" onClick={() => void load()}>再試行</button></div>
        ) : items.length === 0 ? (
          <div className="subpage-state">
            <span className="subpage-state-icon"><BookmarkIcon /></span>
            <strong>まだ保存した作品がありません</strong>
            <p>「保存」を押した作品がここに並びます。</p>
            <button type="button" onClick={() => window.location.assign("/")}>コミックを探す</button>
          </div>
        ) : (
          <>
            <div className="work-grid saved-grid">
              {items.map((item) => {
                const canBuy = item.available !== false && isHttpUrl(item.affiliateUrl);
                const priceDrop = typeof item.priceDropValue === "number" && item.priceDropValue > 0 ? item.priceDropValue : null;
                const savedPrice = typeof item.savedPriceValue === "number" ? item.savedPriceValue : null;
                const currentPrice = typeof item.priceValue === "number" ? item.priceValue : null;
                const currentPriceLabel = formatPrice(item.price, currentPrice);
                const savedPriceLabel = savedPrice !== null ? formatPrice("", savedPrice) : "";

                return (
                  <WorkCardFrame
                    className={`saved-card${item.available === false ? " is-unavailable" : ""}${priceDrop !== null ? " is-price-drop" : ""}`}
                    key={item.cid}
                  >
                    <WorkCardMedia className="saved-card-media">
                      {item.images[0] ? <img src={item.images[0]} alt="" loading="lazy" decoding="async" /> : <span>画像なし</span>}
                      {item.available === false ? <span className="saved-card-status">販売終了</span> : null}
                      {priceDrop !== null ? <span className="saved-card-deal-badge">値下げ</span> : null}
                      <button
                        className="saved-card-save-toggle"
                        type="button"
                        disabled={pendingCid === item.cid}
                        onClick={() => void removeSaved(item)}
                        aria-label={`${item.title || item.cid}の保存を解除`}
                        title="保存を解除"
                      >
                        <BookmarkIcon />
                      </button>
                    </WorkCardMedia>

                    <WorkCardBody>
                      <WorkCardTitle>{item.title || item.cid}</WorkCardTitle>
                      <WorkCardMeta>
                        <span>★ {item.rating.toFixed(1)} <small>({item.reviews}件)</small></span>
                        {priceDrop === null && currentPriceLabel ? <span>{currentPriceLabel}</span> : null}
                      </WorkCardMeta>
                      {priceDrop !== null ? (
                        <div className="saved-card-deal">
                          <span className="saved-card-deal-prices">
                            {savedPriceLabel ? <del>{savedPriceLabel}</del> : null}
                            {currentPriceLabel ? <strong>{currentPriceLabel}</strong> : null}
                          </span>
                          <span>保存時より {formatPrice("", priceDrop)} お得</span>
                        </div>
                      ) : null}
                      {item.genres.length > 0 ? <p className="work-card-tags">{item.genres.slice(0, 4).join(" / ")}</p> : null}

                      <WorkCardActions className={canBuy ? "has-buy" : ""}>
                        <button className="work-card-secondary" type="button" onClick={() => openWorkInMain(item.cid)}>サンプルを読む</button>
                        {canBuy ? (
                          <a
                            className="work-card-primary"
                            href={item.affiliateUrl}
                            target="_blank"
                            rel="noopener noreferrer sponsored"
                            onClick={() => trackEvent({
                              eventType: "affiliate_click",
                              cid: item.cid,
                              placement: "saved",
                              metadata: { priceDropValue: priceDrop, savedPriceValue: savedPrice, priceValue: currentPrice },
                            }, true)}
                          >
                            {priceDrop !== null ? "値下げ中にFANZAで見る" : "FANZAで見る"} <ExternalIcon />
                          </a>
                        ) : null}
                      </WorkCardActions>
                    </WorkCardBody>
                  </WorkCardFrame>
                );
              })}
            </div>
            <WorkListFeedback error={error} hasMore={hasMore} loadingMore={loadingMore} onLoadMore={() => void loadMore()} />
          </>
        )}
      </main>

      <GlobalNav active="saved" />
    </div>
  );
}
