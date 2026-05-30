import type { CapacitorConfig } from "@capacitor/cli";

// Capacitor wrapper config for Mobile Pearl Wallet. The web build in
// `dist/` is bundled into the APK and served from the app's own origin
// (no remote server). Keep this minimal — no extra native plugins beyond
// the core shell, per the "lightweight, no heavy frameworks" goal.
const config: CapacitorConfig = {
  appId: "xyz.pearlwallet.mobile",
  appName: "Mobile Pearl Wallet",
  webDir: "dist",
  android: {
    // Debug-signed APK for sideloading.
    buildOptions: {},
  },
};

export default config;
