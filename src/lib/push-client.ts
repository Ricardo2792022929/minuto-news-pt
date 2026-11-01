let listening = false;

export async function pushPluginReady(): Promise<boolean> {
  try {
    const { Capacitor } = await import("@capacitor/core");
    return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("PushNotifications");
  } catch {
    return false;
  }
}

export async function registerPush(): Promise<boolean> {
  const { PushNotifications } = await import("@capacitor/push-notifications");
  try {
    await PushNotifications.createChannel({
      id: "news",
      name: "Notícias importantes",
      description: "Avisos quando sai uma notícia importante",
      importance: 5,
      visibility: 1,
    });
  } catch {
    /* o canal já pode existir */
  }
  const perm = await PushNotifications.requestPermissions();
  if (perm.receive !== "granted") return false;
  const token = await new Promise<string>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("timeout")), 8000);
    let registered: { remove: () => Promise<void> } | null = null;
    let failed: { remove: () => Promise<void> } | null = null;
    const done = (value: string | null) => {
      window.clearTimeout(timer);
      void registered?.remove();
      void failed?.remove();
      if (value) resolve(value);
      else reject(new Error("register"));
    };
    void PushNotifications.addListener("registration", (event) => done(event.value)).then((handle) => {
      registered = handle;
    });
    void PushNotifications.addListener("registrationError", () => done(null)).then((handle) => {
      failed = handle;
    });
    void PushNotifications.register();
  });
  const res = await fetch("/api/public/hooks/push-token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
  return res.ok;
}

export function listenPushOpen(open: (url: string) => void) {
  if (listening) return;
  listening = true;
  void import("@capacitor/push-notifications").then(({ PushNotifications }) => {
    void PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
      const url = action.notification.data?.url;
      if (typeof url === "string" && url) open(url);
    });
  }).catch(() => {
    /* a app instalada ainda não tem o plugin */
  });
}
