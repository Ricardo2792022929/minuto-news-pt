import { useEffect, useMemo, useRef, useState } from "react";
import { imageKitUrl } from "@/lib/imagekit";
import { categoryImage } from "@/lib/image-policy";

const downloads = new Map<string, Promise<string>>();
/** Fotos já descarregadas e descodificadas: um FeedImage novo mostra-as logo no 1.º frame (sem piscar a preto). */
const decoded = new Set<string>();
function markDecoded(src: string) {
  decoded.add(src);
  if (decoded.size > 96) {
    const oldest = decoded.values().next().value;
    if (oldest) decoded.delete(oldest);
  }
}
/** Descarrega e descodifica a foto e o fundo desfocado de uma notícia (usado para preparar a secção ao lado). */
export function preloadFeedImage(item: { image?: string | null }): Promise<unknown> {
  if (!item.image) return Promise.resolve();
  const main = imageKitUrl(item.image) ?? item.image;
  const backdrop = imageKitUrl(item.image, "backdrop");
  return Promise.allSettled([preloadImage(main), backdrop ? preloadImage(backdrop) : Promise.resolve()]);
}
export function preloadImage(src: string, priority: "high" | "low" | "auto" = "auto"): Promise<string> {
  const cached = downloads.get(src);
  if (cached) return cached;
  const pending = new Promise<string>((resolve, reject) => {
    const image = new Image();
    image.referrerPolicy = "no-referrer";
    // A foto que está no ecrã passa à frente das que estão a ser pré-carregadas.
    (image as HTMLImageElement & { fetchPriority?: string }).fetchPriority = priority;
    image.onload = () => { image.decode().then(() => { markDecoded(src); resolve(src); }, reject); };
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

export function FeedImage({ item, className, alt = "", eager = false, fill = false }: {
  item: { id?: string; image?: string; imageCandidates?: string[]; imageStatus?: "original" | "search" | "provisional"; category?: string; title?: string };
  className: string;
  alt?: string;
  eager?: boolean;
  fill?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const failedSrc = useRef(new Set<string>());
  const generation = useRef(0);
  const urls = useMemo(() => [...new Set([item.image, ...(item.imageCandidates ?? [])].filter((url): url is string => Boolean(url)))], [item.id, item.image, item.imageCandidates]);
  const attempts = useMemo(() => urls.flatMap((url) => [...new Set([imageKitUrl(url), url].filter((value): value is string => Boolean(value)))]), [urls]);
  const attemptKey = attempts.join("\n");
  // Foto (e fundo) já prontos na memória: aparecem no 1.º render, sem fade nem frame preto — é o que dá o efeito galeria no swipe.
  const instant = attempts.find((src) => decoded.has(src)) ?? null;
  const instantBackdrop = (() => {
    if (!instant) return null;
    const original = urls.find((url) => url === instant || imageKitUrl(url) === instant) ?? instant;
    const backdrop = imageKitUrl(original, "backdrop");
    return backdrop && decoded.has(backdrop) ? backdrop : null;
  })();
  const [active, setActive] = useState(eager || Boolean(instant));
  const [ready, setReady] = useState<string | null>(instant);
  const [finished, setFinished] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [backdropLoaded, setBackdropLoaded] = useState<string | null>(instantBackdrop);
  const [fadeIn, setFadeIn] = useState(!instant);
  const firstRun = useRef(true);

  useEffect(() => {
    // No 1.º render o estado já veio certo (foto pronta ou não): não apagar para não piscar.
    if (firstRun.current) { firstRun.current = false; return; }
    failedSrc.current = new Set();
    const hit = attempts.find((src) => decoded.has(src)) ?? null;
    setReady(hit);
    setFadeIn(!hit);
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
    // O fundo desfocado começa a descarregar ao mesmo tempo que a foto (antes só depois de ela chegar).
    if (fill) for (const url of urls) {
      const backdrop = imageKitUrl(url, "backdrop");
      if (backdrop) void preloadImage(backdrop, eager ? "high" : "auto").then((src) => { if (!cancelled) setBackdropLoaded(src); }, () => {});
    }
    const loadNext = async () => {
      const hit = attempts.find((src) => decoded.has(src) && !failedSrc.current.has(src));
      if (hit) { setReady(hit); setFinished(false); return; }
      for (const src of attempts) {
        if (!src || failedSrc.current.has(src)) continue;
        try {
          await preloadImage(src, eager ? "high" : "auto");
          if (cancelled || token !== generation.current) return;
          setFadeIn(true);
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
  }, [active, attemptKey, attempts, item.category, item.imageStatus, nonce, urls.length, fill, urls, eager]);

  const failed = !ready && active && finished;
  // Fundo: a mesma foto desfocada. Se a foto veio direta (sem ImageKit), desfoca-se no próprio telemóvel.
  const readyOriginal = ready ? urls.find((url) => url === ready || imageKitUrl(url) === ready) ?? ready : null;
  const wantedBackdrop = readyOriginal ? imageKitUrl(readyOriginal, "backdrop") : null;
  // Enquanto o fundo pequeno do ImageKit não chega, usa-se a própria foto desfocada no telemóvel: sem espera nenhuma.
  const backdropKit = wantedBackdrop && backdropLoaded === wantedBackdrop ? wantedBackdrop : null;
  const backdropSrc = fill && ready ? backdropKit ?? ready : null;
  const fallbackSrc = failed ? categoryImage(item.category, item.title ?? "", item.id ?? "") : null;
  const frontStyle = fill ? {
    // Foto inteira (4:5) no meio do ecrã, com as pontas a fundir-se no fundo desfocado.
    position: "absolute", top: "50%", left: "50%", width: "min(100%, 80svh)", aspectRatio: "4 / 5",
    transform: "translate(-50%, -54%)", objectFit: "cover", objectPosition: "center center",
    maskImage: "linear-gradient(to bottom, transparent 0%, #000 9%, #000 91%, transparent 100%)",
    WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, #000 9%, #000 91%, transparent 100%)",
  } as const : { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "center center" } as const;
  const backdropStyle = (blurHere: boolean) => ({
    position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "center center",
    transform: "scale(1.12)",
    filter: blurHere ? "blur(28px) brightness(0.5) saturate(1.25)" : "brightness(0.5) saturate(1.25)",
  } as const);

  return (
    <div
      ref={container}
      className={`${fill ? "" : "relative"} ${className} overflow-hidden ${fill ? "bg-black" : "bg-feed-bg"}`}
      style={fill ? { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, width: "100%", height: "100%" } : undefined}
      aria-busy={active && !ready && !failed}
      data-feed-image
    >
      {!ready && (
        <div className="absolute inset-0 bg-neutral-950" role="img" aria-label={item.category ?? "Notícias"}>
          {fallbackSrc ? (
            // Imagem genérica do tema: o mesmo formato das fotos (4:5 sobre a própria imagem desfocada).
            <>
              {fill ? <img src={fallbackSrc} alt="" aria-hidden style={backdropStyle(true)} /> : null}
              <img src={fallbackSrc} alt="" className="animate-photo-in" style={frontStyle} />
            </>
          ) : null}
        </div>
      )}
      {backdropSrc && (
        <img
          src={backdropSrc}
          alt=""
          aria-hidden
          decoding={decoded.has(backdropSrc) ? "sync" : "async"}
          referrerPolicy="no-referrer"
          style={backdropStyle(!backdropKit)}
        />
      )}
      {ready && (
        <img
          src={ready}
          alt={alt}
          className={fadeIn ? "animate-photo-in" : undefined}
          // Já está descodificada (preloadImage): "sync" pinta-a no mesmo frame em vez de deixar um frame vazio.
          decoding="sync"
          referrerPolicy="no-referrer"
          onError={() => { failedSrc.current.add(ready); setReady(null); setNonce((current) => current + 1); }}
          style={frontStyle}
        />
      )}
    </div>
  );
}
