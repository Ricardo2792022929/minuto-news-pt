import { useEffect, useMemo, useRef, useState } from "react";
import { imageKitUrl } from "@/lib/imagekit";
import { categoryImage } from "@/lib/image-policy";

const downloads = new Map<string, Promise<string>>();
export function preloadImage(src: string): Promise<string> {
  const cached = downloads.get(src);
  if (cached) return cached;
  const pending = new Promise<string>((resolve, reject) => {
    const image = new Image();
    image.referrerPolicy = "no-referrer";
    image.onload = () => { image.decode().then(() => resolve(src), reject); };
    image.onerror = () => reject(new Error("Image unavailable"));
    image.src = src;
  });
  downloads.set(src, pending);
  pending.catch(() => downloads.delete(src));
  if (downloads.size > 48) {
    const oldest = downloads.keys().next().value;
    if (oldest) downloads.delete(oldest);
  }
  return pending;
}

export function FeedImage({ item, className, alt = "", eager = false }: {
  item: { id?: string; image?: string; imageCandidates?: string[]; imageStatus?: "original" | "search" | "provisional"; category?: string; title?: string };
  className: string;
  alt?: string;
  eager?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const failedSrc = useRef(new Set<string>());
  const generation = useRef(0);
  const [active, setActive] = useState(eager);
  const [ready, setReady] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const [nonce, setNonce] = useState(0);
  const urls = useMemo(() => [...new Set([item.image, ...(item.imageCandidates ?? [])].filter((url): url is string => Boolean(url)))], [item.id, item.image, item.imageCandidates]);
  const attempts = useMemo(() => urls.flatMap((url) => [...new Set([imageKitUrl(url), url].filter((value): value is string => Boolean(value)))]), [urls]);
  const attemptKey = attempts.join("\n");

  useEffect(() => {
    failedSrc.current = new Set();
    setReady(null);
    setFinished(false);
  }, [item.id, attemptKey]);

  useEffect(() => {
    const element = container.current;
    if (!element || active) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setActive(true);
        observer.disconnect();
      }
    }, { rootMargin: "200% 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const token = ++generation.current;
    let cancelled = false;
    const loadNext = async () => {
      for (const src of attempts) {
        if (!src || failedSrc.current.has(src)) continue;
        try {
          await preloadImage(src);
          if (cancelled || token !== generation.current) return;
          setReady(src);
          setFinished(false);
          return;
        } catch {
          failedSrc.current.add(src);
        }
      }
      if (!cancelled && token === generation.current) {
        setReady(null);
        setFinished(true);
        console.info("feed_image_failed", JSON.stringify({ category: item.category, imageStatus: item.imageStatus, candidates: urls.length }));
      }
    };
    void loadNext();
    return () => { cancelled = true; };
  }, [active, attemptKey, attempts, item.category, item.imageStatus, nonce, urls.length]);

  const failed = !ready && active && finished;
  const fallbackSrc = failed ? categoryImage(item.category, item.title ?? "", item.id ?? "") : null;

  return (
    <div ref={container} className={`relative ${className} overflow-hidden bg-feed-bg`} aria-busy={active && !ready && !failed} data-feed-image>
      {!ready && (
        <div className="absolute inset-0 bg-neutral-950" role="img" aria-label={item.category ?? "Notícias"}>
          {fallbackSrc ? <img src={fallbackSrc} alt="" className="absolute inset-0 h-full w-full object-cover" /> : null}
        </div>
      )}
      {ready && (
        <img
          src={ready}
          alt={alt}
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => { failedSrc.current.add(ready); setReady(null); setNonce((current) => current + 1); }}
          className="absolute inset-0 h-full w-full object-cover object-center"
        />
      )}
    </div>
  );
}
