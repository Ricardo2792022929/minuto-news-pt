import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.flash.noticias",
  appName: "Flash Notícias",
  webDir: "public",
  server: {
    url: "https://flash-news-pt.lovable.app",
    androidScheme: "https",
    cleartext: false,
  },
};

export default config;
