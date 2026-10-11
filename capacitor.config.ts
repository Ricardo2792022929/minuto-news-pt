import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.flashnoticias.app",
  appName: "Flash Notícias",
  webDir: "public",
  server: {
    url: "https://minuto-news-pt.lovable.app",
    androidScheme: "https",
    cleartext: false,
  },
};

export default config;
