const LOCAL_KEY = "swipe-preview:age-verification-v1";
const SESSION_KEY = "swipe-preview:age-verification-session-v1";
const VERSION = 1;

type AgeVerificationRecord = {
  version: number;
  acceptedAt: string;
};

function validRecord(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as Partial<AgeVerificationRecord>;
    return parsed.version === VERSION && typeof parsed.acceptedAt === "string" && parsed.acceptedAt.length > 0;
  } catch {
    return false;
  }
}

export function hasAgeVerification(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return validRecord(window.localStorage.getItem(LOCAL_KEY))
      || validRecord(window.sessionStorage.getItem(SESSION_KEY));
  } catch {
    return false;
  }
}

export function acceptAgeVerification(rememberOnDevice: boolean): void {
  if (typeof window === "undefined") return;
  const payload = JSON.stringify({ version: VERSION, acceptedAt: new Date().toISOString() });
  try {
    if (rememberOnDevice) {
      window.localStorage.setItem(LOCAL_KEY, payload);
      window.sessionStorage.removeItem(SESSION_KEY);
    } else {
      window.sessionStorage.setItem(SESSION_KEY, payload);
      window.localStorage.removeItem(LOCAL_KEY);
    }
  } catch {
    // Storageが使えない環境では、この表示中のReact stateだけで利用を継続する。
  }
}

export function clearAgeVerification(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LOCAL_KEY);
    window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // 削除失敗時もアプリを停止しない。
  }
}
