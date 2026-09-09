import { trackEvent } from "@/src/analytics";

const CTA_SELECTOR = ".open-link";

export function installCommerceCtaTracking(): () => void {
  if (typeof document === "undefined" || typeof IntersectionObserver === "undefined") {
    return () => undefined;
  }

  const observed = new WeakSet<Element>();
  const visibleSince = new WeakMap<Element, number>();
  const timers = new WeakMap<Element, number>();

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const element = entry.target;
      const previousTimer = timers.get(element);
      if (previousTimer !== undefined) {
        window.clearTimeout(previousTimer);
        timers.delete(element);
      }
      if (!entry.isIntersecting || entry.intersectionRatio < 0.8) {
        visibleSince.delete(element);
        continue;
      }
      if (visibleSince.has(element)) continue;
      visibleSince.set(element, performance.now());
      const timer = window.setTimeout(() => {
        timers.delete(element);
        if (!document.contains(element)) return;
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        const article = element.closest<HTMLElement>(".feed-item[data-cid]");
        const cid = article?.dataset.cid?.trim() ?? "";
        if (!cid) return;
        trackEvent({
          eventType: "cta_view",
          cid,
          placement: "overlay",
          metadata: {
            readerPage: Number.parseInt(article?.dataset.readerPage ?? "0", 10) || 0,
          },
        });
        observer.unobserve(element);
      }, 650);
      timers.set(element, timer);
    }
  }, { threshold: [0.8, 1] });

  const scan = (root: ParentNode) => {
    if (root instanceof Element && root.matches(CTA_SELECTOR) && !observed.has(root)) {
      observed.add(root);
      observer.observe(root);
    }
    root.querySelectorAll?.(CTA_SELECTOR).forEach((element) => {
      if (observed.has(element)) return;
      observed.add(element);
      observer.observe(element);
    });
  };

  scan(document);
  const mutations = new MutationObserver((records) => {
    for (const record of records) {
      record.addedNodes.forEach((node) => {
        if (node instanceof Element) scan(node);
      });
    }
  });
  mutations.observe(document.body, { childList: true, subtree: true });

  return () => {
    mutations.disconnect();
    observer.disconnect();
  };
}
