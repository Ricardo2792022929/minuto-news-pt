import introUrl from "@/assets/intro.mp4";

export const INTRO_SRC = introUrl;

let ready: Promise<string> | null = null;

/** Descarrega o vídeo inteiro assim que a app abre, sem criar um leitor visível. */
export function preloadIntroVideo(): Promise<string> {
  if (typeof window === "undefined") return Promise.resolve(introUrl);
  if (ready) return ready;
  ready = fetch(introUrl)
    .then((response) => (response.ok ? response.blob() : Promise.reject(new Error("intro"))))
    .then((blob) => URL.createObjectURL(blob))
    .catch(() => introUrl);
  return ready;
}

