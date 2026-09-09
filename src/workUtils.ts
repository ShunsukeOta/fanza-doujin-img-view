export function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

export function mergeUniqueByCid<T extends { cid: string }>(current: T[], incoming: T[]): T[] {
  const seen = new Set(current.map((item) => item.cid));
  const additions = incoming.filter((item) => {
    if (!item.cid || seen.has(item.cid)) return false;
    seen.add(item.cid);
    return true;
  });
  return [...current, ...additions];
}
