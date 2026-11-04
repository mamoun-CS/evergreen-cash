import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.evergreen.cash",
  appName: "EverGreen CASH",
  webDir: "out",
  ios: {
    contentInset: "never",
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: "#0f3d2e",
      showSpinner: false,
    },
    StatusBar: {
      style: "LIGHT",
      backgroundColor: "#0f3d2e",
    },
  },
};

export default config;
