import { useEffect, useRef, useState } from "react";
import { categoryImage } from "@/lib/image-policy";

const downloads = new Map<string, Promise<string>>();
export function preloadImage(src: string): Promise<string> {
  const cached = downloads.get(src);
  if (cached) return cached;
  const pending = new Promise<string>((resolve, reject) => {
    const image = new Image();
    image.referrerPolicy = "no-referrer";
    image.onload = () => {
      image.decode().then(() => resolve(src), reject);
    };
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
  item: { image?: string; category?: string; title?: string };
  className: string;
  alt?: string;
  eager?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const fallback = categoryImage(item.category, item.title);
  const [active, setActive] = useState(eager);
  const [ready, setReady] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(true);

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
    let settled = false;
    setReady(null);
    setWaiting(true);
    // Warm the local photo simultaneously, never after a slow external request.
    void preloadImage(fallback).catch(() => undefined);
    const useFallback = () => {
      if (cancelled || settled) return;
      settled = true;
      setReady(fallback);
      setWaiting(false);
    };
    const timeout = window.setTimeout(useFallback, 1500);
    void preloadImage(item.image || fallback).then((src) => {
      if (cancelled || settled) return;
      settled = true;
      window.clearTimeout(timeout);
      setReady(src);
      setWaiting(false);
    }).catch(useFallback);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [active, item.image, fallback]);

  return (
    <div ref={container} className={`${className} overflow-hidden bg-feed-bg`} aria-busy={waiting} data-feed-image>
      <img src={fallback} alt="" loading={active ? "eager" : "lazy"} decoding="async" className="absolute inset-0 h-full w-full object-cover object-top" />
      {ready && <img src={ready} alt={alt} decoding="async" referrerPolicy="no-referrer" onError={() => setReady(fallback)} className="absolute inset-0 h-full w-full object-cover object-top animate-photo-in" />}
      <div aria-hidden="true" className={`absolute inset-0 image-shimmer transition-opacity duration-300 motion-reduce:transition-none ${waiting ? "opacity-100" : "opacity-0"}`} />
    </div>
  );
}