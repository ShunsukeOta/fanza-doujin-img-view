import { useRef } from "react";

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

function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 10.5v6M12 7.4h.01" />
    </svg>
  );
}

function closeDialog(dialog: HTMLDialogElement | null) {
  if (dialog?.open) dialog.close();
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
  const dialogId = `work-details-${item.cid}`;
  const series = item.series?.filter(Boolean) ?? [];
  const genres = item.genres.filter(Boolean);

  const openDialog = () => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    onOpen();
    dialog.showModal();
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
        onClose={() => triggerRef.current?.focus({ preventScroll: true })}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeDialog(dialogRef.current);
        }}
      >
        <div className="work-details-panel">
          <header className="work-details-header">
            <h2 id={`${dialogId}-title`}>作品詳細</h2>
            <button
              className="work-details-close"
              type="button"
              aria-label="作品詳細を閉じる"
              onClick={() => closeDialog(dialogRef.current)}
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
