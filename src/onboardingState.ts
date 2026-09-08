const ONBOARDING_KEY = "swipe-preview:onboarding-v2";
const COMPLETE_VALUE = "complete";

export function hasCompletedOnboarding(): boolean {
  try {
    if (window.localStorage.getItem(ONBOARDING_KEY) === COMPLETE_VALUE) return true;
  } catch {
    // localStorage自体へアクセスできない環境ではsessionStorageを確認する。
  }

  try {
    return window.sessionStorage.getItem(ONBOARDING_KEY) === COMPLETE_VALUE;
  } catch {
    return false;
  }
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
