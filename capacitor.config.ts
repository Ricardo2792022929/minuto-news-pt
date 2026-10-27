import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.flash.noticias",
  appName: "Flash Notícias",
  webDir: "public",
  backgroundColor: "#000000",
  server: {
    url: "https://minuto-news-pt.lovable.app",
    androidScheme: "https",
    cleartext: false,
  },
};

export default config;
