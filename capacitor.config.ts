import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.flash.noticias",
  appName: "Flash Notícias",
  webDir: "public",
  backgroundColor: "#000000",
  server: {
    url: "https://minuto-news-pt.lovable.app/?nativeIntro=1",
    androidScheme: "https",
    cleartext: false,
    // Sem rede (ou erro a abrir o site) mostra esta página local em vez do erro do Android.
    // Sem "/" no início: o Capacitor já junta "https://localhost/" e "//offline.html" não é encontrado nos assets.
    errorPath: "offline.html",
  },
};

export default config;
