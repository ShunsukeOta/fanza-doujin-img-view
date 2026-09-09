import { useEffect, useRef } from "react";

import { ExternalIcon } from "@/components/icons";
import type { FeedItem } from "@/lib/types";
import { isHttpUrl } from "@/src/workUtils";
import "@/styles/work-details.css";

type Props = {
  item: FeedItem;
  priceLabel: string;
  totalPages: number | null;
  detailsLoading: boolean;
  available: boolean;
  affiliateUrl: string;
  onOpen: () => void;
  onAffiliateClick: () => void;
};

const CLOSE_MOTION_MS = 180;

function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 10.5v6M12 7.4h.01" />
    </svg>
  );
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export function WorkDetailsAction({
  item,
  priceLabel,
  totalPages,
  detailsLoading,
  available,
  affiliateUrl,
  onOpen,
  onAffiliateClick,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const dialogId = `work-details-${item.cid}`;
  const series = item.series?.filter(Boolean) ?? [];
  const genres = item.genres.filter(Boolean);

  useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
  }, []);

  const openDialog = () => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    dialog.classList.remove("is-closing");
    onOpen();
    dialog.showModal();
  };

  const closeDialog = () => {
    const dialog = dialogRef.current;
    if (!dialog?.open || dialog.classList.contains("is-closing")) return;
    if (prefersReducedMotion()) {
      dialog.close();
      return;
    }
    dialog.classList.add("is-closing");
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      if (dialog.open) dialog.close();
      dialog.classList.remove("is-closing");
    }, CLOSE_MOTION_MS);
  };

  const handleClosed = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    dialogRef.current?.classList.remove("is-closing");
    triggerRef.current?.focus({ preventScroll: true });
  };

  return (
    <>
      <button
        ref={triggerRef}
        className="action-btn work-details-trigger"
        type="button"
        aria-haspopup="dialog"
        aria-controls={dialogId}
        onClick={openDialog}
      >
        <span className="action-icon"><InfoIcon /></span>
        <span className="action-label">詳細</span>
      </button>

      <dialog
        ref={dialogRef}
        id={dialogId}
        className="work-details-dialog"
        aria-labelledby={`${dialogId}-title`}
        onClose={handleClosed}
        onCancel={(event) => {
          event.preventDefault();
          closeDialog();
        }}
        onWheel={(event) => event.stopPropagation()}
        onTouchMove={(event) => event.stopPropagation()}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeDialog();
        }}
      >
        <div className="work-details-panel">
          <header className="work-details-header">
            <h2 id={`${dialogId}-title`}>作品詳細</h2>
            <button
              className="work-details-close"
              type="button"
              aria-label="作品詳細を閉じる"
              onClick={closeDialog}
            >
              ×
            </button>
          </header>

          <div className="work-details-scroll">
            <h3 className="work-details-title">{item.title || "作品情報"}</h3>

            <dl className="work-details-list">
              {item.maker ? (
                <div>
                  <dt>サークル</dt>
                  <dd>{item.maker}</dd>
                </div>
              ) : null}
              {series.length > 0 ? (
                <div>
                  <dt>シリーズ</dt>
                  <dd>{series.join(" / ")}</dd>
                </div>
              ) : null}
              <div>
                <dt>評価</dt>
                <dd>★{item.rating.toFixed(1)}（{item.reviews.toLocaleString("ja-JP")}件）</dd>
              </div>
              <div>
                <dt>価格</dt>
                <dd>{priceLabel || "FANZAで確認"}</dd>
              </div>
              <div>
                <dt>ページ</dt>
                <dd>
                  {detailsLoading
                    ? "本編情報を確認中…"
                    : totalPages !== null
                      ? `全${totalPages.toLocaleString("ja-JP")}ページ / サンプル${item.sampleCount.toLocaleString("ja-JP")}ページ`
                      : `サンプル${item.sampleCount.toLocaleString("ja-JP")}ページ`}
                </dd>
              </div>
            </dl>

            {genres.length > 0 ? (
              <section className="work-details-genres" aria-label="ジャンル">
                <h3>ジャンル</h3>
                <div>
                  {genres.map((genre) => <span key={genre}>{genre}</span>)}
                </div>
              </section>
            ) : null}

            {available && isHttpUrl(affiliateUrl) ? (
              <a
                className="work-details-buy"
                href={affiliateUrl}
                target="_blank"
                rel="noopener noreferrer sponsored"
                onClick={onAffiliateClick}
              >
                FANZAで作品を見る <ExternalIcon />
              </a>
            ) : (
              <p className="work-details-unavailable">現在販売状況を確認中です</p>
            )}
          </div>
        </div>
      </dialog>
    </>
  );
}
