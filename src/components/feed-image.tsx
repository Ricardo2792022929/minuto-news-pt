import { useEffect, useMemo, useRef, useState } from "react";
import { imageKitUrl } from "@/lib/imagekit";

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
  const [active, setActive] = useState(eager);
  const [ready, setReady] = useState<string | null>(null);
  const [attemptIndex, setAttemptIndex] = useState(0);
  const [finished, setFinished] = useState(false);
  const urls = useMemo(() => [...new Set([item.image, ...(item.imageCandidates ?? [])].filter((url): url is string => Boolean(url)))], [item.id, item.image, item.imageCandidates]);
  const attempts = useMemo(() => urls.flatMap((url) => [...new Set([imageKitUrl(url), url].filter((value): value is string => Boolean(value)))]), [urls]);

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
    let cancelled = false;
    setReady(null);
    setFinished(false);
    const loadNext = async () => {
      for (let index = attemptIndex; index < attempts.length; index += 1) {
        const src = attempts[index];
        if (!src) continue;
        try {
          await preloadImage(src);
          if (!cancelled) { setAttemptIndex(index); setReady(src); }
          return;
        } catch { /* tenta a próxima URL desta notícia */ }
      }
      if (!cancelled) {
        setReady(null);
        setFinished(true);
        console.info("feed_image_failed", JSON.stringify({ category: item.category, imageStatus: item.imageStatus, candidates: urls.length }));
      }
    };
    void loadNext();
    return () => { cancelled = true; };
  }, [active, attemptIndex, attempts, item.category, item.imageStatus, urls.length]);

  const failed = !ready && active && finished;
  return (
    <div ref={container} className={`${className} overflow-hidden bg-feed-bg`} aria-busy={active && !ready && !failed} data-feed-image>
      {!ready && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-neutral-900 via-neutral-800 to-neutral-950 px-6 text-center text-white/75" role="img" aria-label={`Fotografia indisponível; categoria ${item.category ?? "Notícias"}`}>
          <span className="text-xs font-bold uppercase tracking-[0.2em] text-white/60">{item.category ?? "Notícias"}</span>
          <span className="text-sm">Fotografia indisponível</span>
        </div>
      )}
      {ready && <img src={ready} alt={alt} decoding="async" referrerPolicy="no-referrer" onError={() => { setReady(null); setAttemptIndex((index) => index + 1); }} className="absolute inset-0 h-full w-full object-cover object-center animate-photo-in" />}
    </div>
  );
}
