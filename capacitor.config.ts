import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.flash.noticias",
  appName: "Flash Notícias",
  webDir: "public",
  backgroundColor: "#F25C27",
  server: {
    url: "https://minuto-news-pt.lovable.app/?nativeIntro=1",
    androidScheme: "https",
    cleartext: false,
  },
};

export default config;
