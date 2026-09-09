import type { HTMLAttributes, ReactNode } from "react";

export function WorkCardFrame({ className = "", children, ...props }: HTMLAttributes<HTMLElement> & { children: ReactNode }) {
  return <article className={`work-card${className ? ` ${className}` : ""}`} {...props}>{children}</article>;
}

export function WorkCardMedia({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`work-card-media${className ? ` ${className}` : ""}`}>{children}</div>;
}

export function WorkCardBody({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`work-card-body${className ? ` ${className}` : ""}`}>{children}</div>;
}

export function WorkCardTitle({ className = "", children }: { className?: string; children: ReactNode }) {
  return <h2 className={`work-card-title${className ? ` ${className}` : ""}`}>{children}</h2>;
}

export function WorkCardMeta({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`work-card-meta${className ? ` ${className}` : ""}`}>{children}</div>;
}

export function WorkCardActions({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`work-card-actions${className ? ` ${className}` : ""}`}>{children}</div>;
}

export function WorkListFeedback({ error, hasMore, loadingMore, onLoadMore }: {
  error: string;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  return (
    <>
      {error ? <div className="work-list-error" role="status">{error}</div> : null}
      {hasMore ? (
        <div className="work-list-more">
          <button type="button" disabled={loadingMore} onClick={onLoadMore}>
            {loadingMore ? "読み込み中…" : "さらに表示"}
          </button>
        </div>
      ) : null}
    </>
  );
}
