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
  { key: "amateur", label: "素人動画", available: true },
] as const;

export function normalizeFloor(value: string | null | undefined): FloorKey {
  if (value === "actress" || value === "amateur") return value;
  return "comic";
}

export function floorFromLocation(): FloorKey {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (path === "/actress") return "actress";
  if (path === "/amateur") return "amateur";
  if (path === "/saved" || path === "/search") {
    return normalizeFloor(new URLSearchParams(window.location.search).get("floor"));
  }
  return "comic";
}

export function floorFeedPath(floor: FloorKey): string {
  if (floor === "actress") return "/actress";
  if (floor === "amateur") return "/amateur";
  return "/";
}

export function floorContextPath(floor: FloorKey, context: FloorContext): string {
  if (context === "feed") return floorFeedPath(floor);
  const params = new URLSearchParams();
  if (floor !== "comic") params.set("floor", floor);
  const query = params.toString();
  return `/${context}${query ? `?${query}` : ""}`;
}

export function floorLabel(floor: FloorKey): string {
  return FLOORS.find((candidate) => candidate.key === floor)?.label ?? "同人漫画";
}
