const ONBOARDING_KEY = "swipe-preview:onboarding-v2";
const COMPLETE_VALUE = "complete";

function readStorage(storage: Storage): boolean {
  try {
    return storage.getItem(ONBOARDING_KEY) === COMPLETE_VALUE;
  } catch {
    return false;
  }
}

export function hasCompletedOnboarding(): boolean {
  return readStorage(window.localStorage) || readStorage(window.sessionStorage);
}

export function markOnboardingComplete(): void {
  try {
    window.localStorage.setItem(ONBOARDING_KEY, COMPLETE_VALUE);
    return;
  } catch {
    // localStorageを利用できない環境では、このタブ内だけでも再表示を防ぐ。
  }

  try {
    window.sessionStorage.setItem(ONBOARDING_KEY, COMPLETE_VALUE);
  } catch {
    // Storage自体が利用できない環境では、現在のReact stateだけで完了状態を保持する。
  }
}
