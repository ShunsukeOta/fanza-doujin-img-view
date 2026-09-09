export type SubpagePath = "/saved" | "/search" | "/mypage" | "/history";
export type NavOrigin = "main" | "saved" | "search" | "mypage" | "history";

export const PROTECTED_SUBPAGES: readonly SubpagePath[] = ["/saved", "/search", "/mypage", "/history"];
export const PUBLIC_PAGES = ["/privacy", "/terms"] as const;

export function normalizePathname(pathname = window.location.pathname): string {
  return pathname.replace(/\/+$/, "") || "/";
}

export function isSubpagePath(value: unknown): value is SubpagePath {
  return typeof value === "string" && PROTECTED_SUBPAGES.includes(value as SubpagePath);
}

export function workCidFromPath(pathname: string): string {
  const match = normalizePathname(pathname).match(/^\/work\/([^/]+)$/);
  if (!match) return "";
  try {
    return decodeURIComponent(match[1]).slice(0, 256);
  } catch {
    return "";
  }
}

export function isKnownStandalonePage(pathname: string): boolean {
  const normalized = normalizePathname(pathname);
  return PROTECTED_SUBPAGES.includes(normalized as SubpagePath)
    || (PUBLIC_PAGES as readonly string[]).includes(normalized);
}
