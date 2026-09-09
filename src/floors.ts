export type FloorKey = "comic" | "actress" | "amateur";
export type FloorContext = "feed" | "saved" | "search";

export type FloorDefinition = {
  key: FloorKey;
  label: string;
  available: boolean;
};

export const FLOORS: readonly FloorDefinition[] = [
  { key: "comic", label: "同人漫画", available: true },
  { key: "actress", label: "女優動画", available: false },
  { key: "amateur", label: "素人動画", available: false },
] as const;

export function normalizeFloor(value: string | null | undefined): FloorKey {
  if (value === "actress" || value === "amateur") return value;
  return "comic";
}

export function floorFromLocation(): FloorKey {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (path !== "/" && path !== "/saved" && path !== "/search") return "comic";
  return normalizeFloor(new URLSearchParams(window.location.search).get("floor"));
}

export function floorContextPath(floor: FloorKey, context: FloorContext): string {
  const base = context === "feed" ? "/" : `/${context}`;
  if (floor === "comic") return base;
  return `${base}?floor=${encodeURIComponent(floor)}`;
}

export function floorLabel(floor: FloorKey): string {
  return FLOORS.find((candidate) => candidate.key === floor)?.label ?? "同人漫画";
}
