import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { BookmarkIcon, HeartIcon } from "@/components/icons";

type Props = {
  onComplete: () => void;
  mode?: "first-run" | "guide";
};

type Step = {
  key: "feed" | "reader" | "keep";
  eyebrow: string;
  title: string;
  description: string;
};

type GestureAxis = "vertical" | "horizontal";

type ActiveGesture = {
  axis: GestureAxis;
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
};

const STEPS: Step[] = [
  {
    key: "feed",
    eyebrow: "FIND",
    title: "作品は、上下で切り替える",
    description: "上にスワイプすると次の作品へ。下に戻せば前の作品です。まずは下の画面で試してみてください。",
  },
  {
    key: "reader",
    eyebrow: "READ",
    title: "漫画は、左右で読む",
    description: "サンプルは左右スワイプでページ送り。画面端のタップでも送れます。読む方向は設定から変更できます。",
  },
  {
    key: "keep",
    eyebrow: "KEEP",
    title: "気になったら保存。続きはFANZAへ",
    description: "いいね・保存した作品はあとから見返せます。サンプル最終ページのボタンからFANZAの作品ページへ移動できます。",
  },
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function FeedPractice({ practiced, onPracticed }: { practiced: boolean; onPracticed: () => void }) {
  const gestureRef = useRef<ActiveGesture | null>(null);

  const resetOffset = (target: HTMLDivElement) => {
    target.style.setProperty("--practice-x", "0px");
    target.style.setProperty("--practice-y", "0px");
    target.classList.remove("is-dragging");
  };

  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    gestureRef.current = {
      axis: "vertical",
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.classList.add("is-dragging");
  };

  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gesture.lastX = event.clientX;
    gesture.lastY = event.clientY;
    const deltaY = clamp(event.clientY - gesture.startY, -72, 24);
    event.currentTarget.style.setProperty("--practice-y", `${deltaY}px`);
  };

  const finishPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const deltaY = gesture.lastY - gesture.startY;
    gestureRef.current = null;
    resetOffset(event.currentTarget);
    if (deltaY <= -42) onPracticed();
  };

  const keyboardPractice = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowUp") return;
    event.preventDefault();
    onPracticed();
  };

  return (
    <div className="onboarding-practice-wrap">
      <div
        className={`onboarding-practice onboarding-practice--feed${practiced ? " is-practiced" : ""}`}
        role="group"
        aria-label="作品切替の練習。上にスワイプしてください。"
        tabIndex={0}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={(event) => {
          gestureRef.current = null;
          resetOffset(event.currentTarget);
        }}
        onKeyDown={keyboardPractice}
      >
        <div className="onboarding-demo-phone">
          <div className="onboarding-demo-feed">
            <article className="onboarding-demo-work onboarding-demo-work--current">
              <span className="onboarding-demo-cover" />
              <div><strong>気になる作品</strong><small>サンプルをチェック</small></div>
            </article>
            <article className="onboarding-demo-work onboarding-demo-work--next">
              <span className="onboarding-demo-cover onboarding-demo-cover--next" />
              <div><strong>次の作品</strong><small>そのまま続けて見る</small></div>
            </article>
          </div>
        </div>
        {!practiced ? (
          <div className="onboarding-gesture-hint onboarding-gesture-hint--up" aria-hidden="true">
            <span className="onboarding-touch-dot" />
            <span className="onboarding-gesture-line" />
            <strong>上へスワイプ</strong>
          </div>
        ) : null}
      </div>
      <p className={`onboarding-practice-result${practiced ? " is-complete" : ""}`} aria-live="polite">
        {practiced ? "OK　この操作で次の作品へ進みます" : "ここで実際に操作できます"}
      </p>
    </div>
  );
}

function ReaderPractice({ practiced, onPracticed }: { practiced: boolean; onPracticed: () => void }) {
  const gestureRef = useRef<ActiveGesture | null>(null);

  const resetOffset = (target: HTMLDivElement) => {
    target.style.setProperty("--practice-x", "0px");
    target.style.setProperty("--practice-y", "0px");
    target.classList.remove("is-dragging");
  };

  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    gestureRef.current = {
      axis: "horizontal",
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.classList.add("is-dragging");
  };

  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gesture.lastX = event.clientX;
    gesture.lastY = event.clientY;
    const deltaX = clamp(event.clientX - gesture.startX, -72, 72);
    event.currentTarget.style.setProperty("--practice-x", `${deltaX}px`);
  };

  const finishPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const deltaX = gesture.lastX - gesture.startX;
    gestureRef.current = null;
    resetOffset(event.currentTarget);
    if (Math.abs(deltaX) >= 42) onPracticed();
  };

  const keyboardPractice = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    onPracticed();
  };

  return (
    <div className="onboarding-practice-wrap">
      <div
        className={`onboarding-practice onboarding-practice--reader${practiced ? " is-practiced" : ""}`}
        role="group"
        aria-label="ページ送りの練習。左右にスワイプしてください。"
        tabIndex={0}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={(event) => {
          gestureRef.current = null;
          resetOffset(event.currentTarget);
        }}
        onKeyDown={keyboardPractice}
      >
        <div className="onboarding-reader-demo">
          <div className="onboarding-reader-strip">
            <div className="onboarding-demo-page onboarding-demo-page--one">
              <span /><span /><span />
            </div>
            <div className="onboarding-demo-page onboarding-demo-page--two">
              <span /><span /><span />
            </div>
          </div>
          <span className="onboarding-demo-counter">{practiced ? "02" : "01"} / 12</span>
        </div>
        {!practiced ? (
          <div className="onboarding-gesture-hint onboarding-gesture-hint--side" aria-hidden="true">
            <span className="onboarding-touch-dot" />
            <span className="onboarding-gesture-line" />
            <strong>左右にスワイプ</strong>
          </div>
        ) : null}
      </div>
      <p className={`onboarding-practice-result${practiced ? " is-complete" : ""}`} aria-live="polite">
        {practiced ? "OK　この操作で漫画のページを送れます" : "左右どちらでも試せます"}
      </p>
    </div>
  );
}

function KeepVisual() {
  return (
    <div className="onboarding-practice-wrap">
      <div className="onboarding-practice onboarding-practice--keep" aria-hidden="true">
        <article className="onboarding-keep-card">
          <div className="onboarding-keep-preview"><span /><span /><span /></div>
          <div className="onboarding-keep-actions">
            <div><span className="onboarding-keep-icon"><HeartIcon /></span><strong>いいね</strong></div>
            <div><span className="onboarding-keep-icon"><BookmarkIcon /></span><strong>保存</strong></div>
          </div>
          <div className="onboarding-keep-divider" />
          <small>サンプルはここまで</small>
          <div className="onboarding-keep-cta">FANZAで続きを読む <span>›</span></div>
        </article>
      </div>
      <p className="onboarding-practice-result is-complete">保存した作品は「保存」メニューから確認できます</p>
    </div>
  );
}

export function Onboarding({ onComplete, mode = "first-run" }: Props) {
  const [stepIndex, setStepIndex] = useState(0);
  const [feedPracticed, setFeedPracticed] = useState(false);
  const [readerPracticed, setReaderPracticed] = useState(false);
  const completedRef = useRef(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const step = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;

  const complete = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    onComplete();
  }, [onComplete]);

  const move = useCallback((direction: -1 | 1) => {
    setStepIndex((current) => Math.max(0, Math.min(STEPS.length - 1, current + direction)));
  }, []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => headingRef.current?.focus());

    return () => {
      document.body.style.overflow = previousOverflow;
      if (mode === "guide") previousFocus?.focus();
    };
  }, [mode]);

  useEffect(() => {
    requestAnimationFrame(() => headingRef.current?.focus());
  }, [stepIndex]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        complete();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      )].filter((element) => !element.hasAttribute("aria-hidden"));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [complete]);

  return (
    <div
      ref={dialogRef}
      className="onboarding"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      aria-describedby="onboarding-description"
    >
      <div className="onboarding-shell">
        <header className="onboarding-header">
          <div className="onboarding-brand" aria-label="Swipe Preview">
            <span className="onboarding-brand-mark" aria-hidden="true"><i /><i /></span>
            <span>SWIPE PREVIEW</span>
          </div>
          <button className="onboarding-dismiss" type="button" onClick={complete}>
            {mode === "guide" ? "閉じる" : "スキップ"}
          </button>
        </header>

        <main className="onboarding-main">
          <div className="onboarding-stage">
            {step.key === "feed" ? (
              <FeedPractice practiced={feedPracticed} onPracticed={() => setFeedPracticed(true)} />
            ) : step.key === "reader" ? (
              <ReaderPractice practiced={readerPracticed} onPracticed={() => setReaderPracticed(true)} />
            ) : (
              <KeepVisual />
            )}
          </div>

          <div className="onboarding-copy" aria-live="polite">
            <div className="onboarding-step-label">
              <span>{String(stepIndex + 1).padStart(2, "0")}</span>
              <i />
              <span>{String(STEPS.length).padStart(2, "0")}</span>
              <em>{step.eyebrow}</em>
            </div>
            <h1 id="onboarding-title" ref={headingRef} tabIndex={-1}>{step.title}</h1>
            <p id="onboarding-description">{step.description}</p>
          </div>
        </main>

        <footer className="onboarding-footer">
          <div className="onboarding-progress" aria-label={`${stepIndex + 1} / ${STEPS.length}`}>
            {STEPS.map((item, index) => (
              <button
                key={item.key}
                type="button"
                className={index === stepIndex ? "is-active" : ""}
                aria-label={`${index + 1}ページ目`}
                aria-current={index === stepIndex ? "step" : undefined}
                onClick={() => setStepIndex(index)}
              />
            ))}
          </div>

          <div className="onboarding-actions">
            {stepIndex > 0 ? (
              <button className="onboarding-back" type="button" onClick={() => move(-1)}>戻る</button>
            ) : <span />}
            <button
              className="onboarding-primary"
              type="button"
              onClick={() => isLast ? complete() : move(1)}
            >
              {isLast ? (mode === "guide" ? "閉じる" : "はじめる") : "次へ"}
              <span aria-hidden="true">›</span>
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
