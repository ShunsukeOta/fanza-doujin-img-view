import type { SubpagePath } from "@/src/routes";
import { isSubpagePath } from "@/src/routes";

const MAIN_RETURN_KEY = "swipe-preview:main-return-v5";
const RESUME_REQUEST_KEY = "swipe-preview:resume-request-v5";
const ACTIVE_READER_KEY = "swipe-preview:active-reader-v1";
const MAX_STATE_AGE_MS = 12 * 60 * 60 * 1000;

type ReaderSnapshot = {
  cid: string;
  pageIndex: number;
  isCta: boolean;
  savedAt: number;
};

export type MainReturnState = ReaderSnapshot & {
  resumeUrl: string;
  subpage: SubpagePath;
  historySteps: number;
};

function safeGet(key: string): string | null {
  try { return sessionStorage.getItem(key); } catch { return null; }
}

function safeSet(key: string, value: string): void {
  try { sessionStorage.setItem(key, value); } catch { /* noop */ }
}

function safeRemove(key: string): void {
  try { sessionStorage.removeItem(key); } catch { /* noop */ }
}

function fresh(savedAt: unknown): savedAt is number {
  return typeof savedAt === "number" && Date.now() - savedAt <= MAX_STATE_AGE_MS;
}

export function rememberActiveReader(snapshot: Omit<ReaderSnapshot, "savedAt">): void {
  const cid = snapshot.cid.trim();
  if (!cid) return;
  safeSet(ACTIVE_READER_KEY, JSON.stringify({
    cid,
    pageIndex: Math.max(0, Math.trunc(snapshot.pageIndex)),
    isCta: Boolean(snapshot.isCta),
    savedAt: Date.now(),
  } satisfies ReaderSnapshot));
}

export function readActiveReader(): ReaderSnapshot | null {
  const raw = safeGet(ACTIVE_READER_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ReaderSnapshot>;
    if (
      typeof parsed.cid !== "string"
      || typeof parsed.pageIndex !== "number"
      || typeof parsed.isCta !== "boolean"
      || !fresh(parsed.savedAt)
    ) {
      safeRemove(ACTIVE_READER_KEY);
      return null;
    }
    return parsed as ReaderSnapshot;
  } catch {
    safeRemove(ACTIVE_READER_KEY);
    return null;
  }
}

export function readMainReturnState(): MainReturnState | null {
  const raw = safeGet(MAIN_RETURN_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<MainReturnState>;
    const valid = typeof parsed.resumeUrl === "string"
      && typeof parsed.cid === "string"
      && typeof parsed.pageIndex === "number"
      && typeof parsed.isCta === "boolean"
      && isSubpagePath(parsed.subpage)
      && typeof parsed.historySteps === "number"
      && parsed.historySteps >= 1
      && fresh(parsed.savedAt);
    if (!valid) {
      safeRemove(MAIN_RETURN_KEY);
      return null;
    }
    return parsed as MainReturnState;
  } catch {
    safeRemove(MAIN_RETURN_KEY);
    return null;
  }
}

export function writeMainReturnState(state: MainReturnState): void {
  safeSet(MAIN_RETURN_KEY, JSON.stringify(state));
}

export function markResumeRequested(): void {
  safeSet(RESUME_REQUEST_KEY, "1");
}

export function resumeRequested(): boolean {
  return safeGet(RESUME_REQUEST_KEY) === "1";
}

export function clearResumeRequested(): void {
  safeRemove(RESUME_REQUEST_KEY);
}
