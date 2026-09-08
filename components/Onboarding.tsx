import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

type Props = {
  onComplete: () => void;
};

type Step = {
  eyebrow: string;
  title: string;
  description: string;
  visual: "discover" | "reader" | "save";
};

const STEPS: Step[] = [
  {
    eyebrow: "DISCOVER",
    title: "気になる作品を、\n流すように。",
    description: "上下にスワイプするだけで次の作品へ。テンポを崩さず、気になるサンプルを次々チェックできます。",
    visual: "discover",
  },
  {
    eyebrow: "READ",
    title: "横に送って、\nそのまま読む。",
    description: "左右スワイプ、または画面端タップでページ送り。ダブルタップやピンチ操作で細部まで拡大できます。",
    visual: "reader",
  },
  {
    eyebrow: "KEEP",
    title: "見つけたら、\nすぐ残す。",
    description: "いいね・保存であとから見返せます。サンプルを読み終えたら、そのままFANZAで続きを確認できます。",
    visual: "save",
  },
];

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function HeartIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20.8 4.9a5.6 5.6 0 0 0-7.9 0L12 5.8l-.9-.9a5.6 5.6 0 1 0-7.9 7.9l.9.9L12 21l7.9-7.3.9-.9a5.6 5.6 0 0 0 0-7.9Z" />
    </svg>
  );
}

function BookmarkIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6.5 3.5h11v17L12 17l-5.5 3.5v-17Z" />
    </svg>
  );
}

function DiscoverVisual() {
  return (
    <div className="onboarding-visual onboarding-discover" aria-hidden="true">
      <div className="onboarding-phone">
        <div className="onboarding-work-card onboarding-work-card--back">
          <span className="onboarding-card-tag">NEXT</span>
        </div>
        <div className="onboarding-work-card onboarding-work-card--front">
          <div className="onboarding-card-lines">
            <span />
            <span />
          </div>
          <div className="onboarding-card-actions">
            <span><HeartIcon /></span>
            <span><BookmarkIcon /></span>
          </div>
        </div>
        <div className="onboarding-swipe onboarding-swipe--vertical">
          <span className="onboarding-swipe-dot" />
          <span className="onboarding-swipe-line" />
          <span className="onboarding-swipe-arrow">↑</span>
        </div>
      </div>
      <span className="onboarding-visual-caption">SWIPE UP</span>
    </div>
  );
}

function ReaderVisual() {
  return (
    <div className="onboarding-visual onboarding-reader" aria-hidden="true">
      <div className="onboarding-reader-frame">
        <div className="onboarding-reader-page onboarding-reader-page--prev" />
        <div className="onboarding-reader-page onboarding-reader-page--current">
          <div className="onboarding-manga-panel onboarding-manga-panel--one" />
          <div className="onboarding-manga-panel onboarding-manga-panel--two" />
          <div className="onboarding-manga-panel onboarding-manga-panel--three" />
        </div>
        <div className="onboarding-reader-page onboarding-reader-page--next" />
        <span className="onboarding-page-number">03 / 12</span>
      </div>
      <div className="onboarding-swipe onboarding-swipe--horizontal">
        <span className="onboarding-swipe-arrow">←</span>
        <span className="onboarding-swipe-line" />
        <span className="onboarding-swipe-dot" />
      </div>
      <span className="onboarding-visual-caption">SWIPE / TAP</span>
    </div>
  );
}

function SaveVisual() {
  return (
    <div className="onboarding-visual onboarding-save" aria-hidden="true">
      <div className="onboarding-save-stack">
        <div className="onboarding-save-card onboarding-save-card--ghost" />
        <div className="onboarding-save-card">
          <span className="onboarding-save-kicker">SAMPLE COMPLETE</span>
          <strong>サンプルはここまで</strong>
          <div className="onboarding-save-meta"><span>全 84 ページ</span><span>¥770</span></div>
          <div className="onboarding-save-cta">FANZAで続きを読む <ChevronIcon /></div>
          <div className="onboarding-save-secondary"><BookmarkIcon /> あとで読む</div>
        </div>
      </div>
      <div className="onboarding-floating-reaction onboarding-floating-reaction--heart"><HeartIcon /></div>
      <div className="onboarding-floating-reaction onboarding-floating-reaction--bookmark"><BookmarkIcon /></div>
    </div>
  );
}

function StepVisual({ type }: { type: Step["visual"] }) {
  if (type === "reader") return <ReaderVisual />;
  if (type === "save") return <SaveVisual />;
  return <DiscoverVisual />;
}

export function Onboarding({ onComplete }: Props) {
  const [stepIndex, setStepIndex] = useState(0);
  const pointerStart = useRef<number | null>(null);
  const completedRef = useRef(false);
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
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        complete();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        if (stepIndex === STEPS.length - 1) complete();
        else move(1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        move(-1);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [complete, move, stepIndex]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    pointerStart.current = event.clientX;
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = pointerStart.current;
    pointerStart.current = null;
    if (start === null) return;
    const delta = event.clientX - start;
    if (Math.abs(delta) < 52) return;
    if (delta < 0) {
      if (isLast) complete();
      else move(1);
    } else {
      move(-1);
    }
  };

  return (
    <div
      className="onboarding"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => { pointerStart.current = null; }}
    >
      <div className="onboarding-shell">
        <header className="onboarding-header">
          <div className="onboarding-brand" aria-label="Swipe Preview">
            <span className="onboarding-brand-mark"><i /><i /></span>
            <span>SWIPE PREVIEW</span>
          </div>
          <button className="onboarding-skip" type="button" onClick={complete}>スキップ</button>
        </header>

        <main className="onboarding-main" key={stepIndex}>
          <StepVisual type={step.visual} />

          <div className="onboarding-copy">
            <div className="onboarding-step-label">
              <span>{String(stepIndex + 1).padStart(2, "0")}</span>
              <i />
              <span>{String(STEPS.length).padStart(2, "0")}</span>
              <em>{step.eyebrow}</em>
            </div>
            <h1 id="onboarding-title">{step.title}</h1>
            <p>{step.description}</p>
          </div>
        </main>

        <footer className="onboarding-footer">
          <div className="onboarding-progress" aria-label={`${stepIndex + 1} / ${STEPS.length}`}>
            {STEPS.map((item, index) => (
              <button
                key={item.eyebrow}
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
              {isLast ? "はじめる" : "次へ"}
              <ChevronIcon />
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
