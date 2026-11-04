"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { enablePersistentStorage, ensureDefaults, getDb } from "@/lib/db/database";
import { getSettings } from "@/lib/services/financeService";
import { hashPin, verifyPin } from "@/lib/crypto/backupCrypto";
import { saveSettings } from "@/lib/services/financeService";
import type { AppSettingsRecord } from "@/lib/finance/types";
import { registerServiceWorker } from "@/lib/pwa/register";
import { performAutoSync, scheduleSync, type SyncStatus } from "@/lib/sync/autoSync";
import { Button, Input } from "@/components/ui/primitives";
import { createAutomaticBackup } from "@/lib/backup/service";
import { getApiUrl } from "@/lib/apiBase";
import { isNative } from "@/lib/native";
import { StatusBar, Style } from "@capacitor/status-bar";
import { SplashScreen } from "@capacitor/splash-screen";

interface Toast {
  id: number;
  message: string;
  tone: "ok" | "err" | "warn";
}

interface AppContextValue {
  ready: boolean;
  settings: AppSettingsRecord | null;
  online: boolean;
  refresh: () => Promise<void>;
  bump: number;
  toast: (message: string, tone?: Toast["tone"]) => void;
  pendingUpdate: boolean;
  applyUpdate: () => void;
  syncStatus: SyncStatus;
  triggerSync: () => Promise<void>;
  notifyDataChanged: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp must be used within Providers");
  return value;
}

export function Providers({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<AppSettingsRecord | null>(null);
  // Keep the server render and the client's first render identical. The actual
  // network state is read after mount, when browser APIs are available.
  const [online, setOnline] = useState(false);
  const [bump, setBump] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pendingUpdate, setPendingUpdate] = useState(false);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState("");
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ state: "idle", lastSyncTime: null });
  const lastActiveRef = useRef(0);

  const toast = useCallback((message: string, tone: Toast["tone"] = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, message, tone }]);
    setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 4200);
  }, []);

  const triggerSync = useCallback(async () => {
    setSyncStatus((s) => ({ ...s, state: "syncing" }));
    const result = await performAutoSync();
    setSyncStatus(result);
    if (result.state === "idle" && result.lastSyncTime) {
      // Refresh local UI after sync
      const next = await getSettings();
      setSettings(next);
      setBump((value) => value + 1);
    }
  }, []);

  // Called immediately after any data mutation (add/edit/delete/reconcile)
  // Schedules a debounced sync: fires in 500ms if online, waits for reconnect if offline
  const notifyDataChanged = useCallback(() => {
    scheduleSync((result) => {
      setSyncStatus(result);
    });
  }, []);

  const refresh = useCallback(async () => {
    const next = await getSettings();
    setSettings(next);
    setBump((value) => value + 1);
    if (!next.pinEnabled) setUnlocked(true);
  }, []);

  useEffect(() => {
    lastActiveRef.current = Date.now();
    const initialOnlineCheck = window.setTimeout(() => setOnline(navigator.onLine), 0);
    const on = () => {
      setOnline(true);
      setSyncStatus((s) => ({ ...s, state: "syncing" }));
      // Reconnected: immediately push any offline-queued changes
      void triggerSync().then(() => {
        // After push, refresh UI to reflect any changes from other devices
        void refresh();
      });
    };
    const off = () => {
      setOnline(false);
      setSyncStatus((s) => ({ ...s, state: "offline" }));
    };
    const checkServer = async () => {
      if (!navigator.onLine) return;
      const healthUrl = getApiUrl("/api/health");
      if (!healthUrl) {
        if (isNative()) setSyncStatus({ state: "disabled", lastSyncTime: null });
        return;
      }
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch(healthUrl, { method: "GET", cache: "no-store", signal: controller.signal });
        if (!response.ok) setSyncStatus({ state: "unavailable", lastSyncTime: null, errorMessage: "السيرفر غير متاح حالياً" });
        else setSyncStatus((current) =>
          current.state === "unavailable" && current.errorMessage === "السيرفر غير متاح حالياً"
            ? { state: "idle", lastSyncTime: null }
            : current,
        );
      } catch {
        setSyncStatus({ state: "unavailable", lastSyncTime: null, errorMessage: "السيرفر غير متاح حالياً" });
      } finally { window.clearTimeout(timer); }
    };
    const visibility = () => { if (document.visibilityState === "visible") { void checkServer(); void triggerSync(); } };
    const autoBackup = async () => {
      const current = await getDb().settings.get("app");
      if (!current?.autoBackupEnabled) return;
      const dueAt = Date.now() - (current.autoBackupIntervalMinutes || 60) * 60_000;
      if (current.lastSuccessfulBackupAt && Date.parse(current.lastSuccessfulBackupAt) > dueAt) return;
      const phrase = await getDb().syncMeta.get("backupPassphrase");
      if (typeof phrase?.value === "string" && phrase.value.length >= 10) {
        try { await createAutomaticBackup(phrase.value, current.keepBackupCount); }
        catch { toast("فشل إنشاء النسخة الاحتياطية التلقائية المشفرة", "err"); }
      }
    };
    const runOnVisible = () => { if (document.visibilityState === "visible") void autoBackup(); };
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    const onDataChanged = () => notifyDataChanged();
    window.addEventListener("egc:data-changed", onDataChanged);
    const onSyncToast = (event: Event) => toast((event as CustomEvent<string>).detail, "warn");
    window.addEventListener("egc:toast", onSyncToast);
    document.addEventListener("visibilitychange", visibility);
    document.addEventListener("visibilitychange", runOnVisible);
    registerServiceWorker({
      onWaiting: (worker) => {
        if (isNative()) return;
        setWaitingWorker(worker);
        setPendingUpdate(true);
      },
    });
    if (isNative()) {
      void Promise.all([
        StatusBar.setStyle({ style: Style.Light }),
        StatusBar.setBackgroundColor({ color: "#0f3d2e" }),
      ]).catch((error) => console.warn("تعذر ضبط شريط الحالة:", error));
    }
    void (async () => {
      await enablePersistentStorage();
      await ensureDefaults(getDb());
      await refresh();
      // When online, finish the first pull/merge before exposing the local UI.
      // If cloud sync is unavailable, performAutoSync returns an error status
      // and the app still opens from its durable IndexedDB copy.
      if (navigator.onLine) await triggerSync();
      else setSyncStatus({ state: "offline", lastSyncTime: null });
      setReady(true);
      if (isNative()) void SplashScreen.hide().catch((error) => console.warn("تعذر إخفاء شاشة البداية:", error));
      void checkServer();
      await autoBackup();
    })();
    return () => {
      window.clearTimeout(initialOnlineCheck);
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      window.removeEventListener("egc:data-changed", onDataChanged);
      window.removeEventListener("egc:toast", onSyncToast);
      document.removeEventListener("visibilitychange", visibility);
      document.removeEventListener("visibilitychange", runOnVisible);
    };
  }, [refresh, triggerSync, notifyDataChanged, toast]);

  useEffect(() => {
    if (!ready) return;
    const timer = window.setInterval(async () => {
      const current = await getDb().settings.get("app");
      if (!current?.autoBackupEnabled) return;
      const dueAt = Date.now() - (current.autoBackupIntervalMinutes || 60) * 60_000;
      if (current.lastSuccessfulBackupAt && Date.parse(current.lastSuccessfulBackupAt) > dueAt) return;
      const phrase = await getDb().syncMeta.get("backupPassphrase");
      if (typeof phrase?.value === "string" && phrase.value.length >= 10) {
        try { await createAutomaticBackup(phrase.value, current.keepBackupCount); }
        catch { toast("فشل إنشاء النسخة الاحتياطية التلقائية المشفرة", "err"); }
      }
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [ready, toast]);

  // Periodic background sync every 30 seconds when online (fallback for missed events)
  useEffect(() => {
    if (!online) return;
    const interval = setInterval(() => {
      void triggerSync();
    }, 30_000);
    return () => clearInterval(interval);
  }, [online, triggerSync]);

  useEffect(() => {
    const mark = () => {
      lastActiveRef.current = Date.now();
    };
    window.addEventListener("pointerdown", mark);
    window.addEventListener("keydown", mark);
    const timer = window.setInterval(() => {
      if (!settings?.pinEnabled || !unlocked) return;
      const minutes = settings.autoLockMinutes || 5;
      if (lastActiveRef.current > 0 && Date.now() - lastActiveRef.current > minutes * 60_000) {
        setUnlocked(false);
      }
    }, 5000);
    return () => {
      window.removeEventListener("pointerdown", mark);
      window.removeEventListener("keydown", mark);
      window.clearInterval(timer);
    };
  }, [settings, unlocked]);

  const applyUpdate = useCallback(() => {
    if (isNative()) return;
    waitingWorker?.postMessage({ type: "SKIP_WAITING" });
    window.location.reload();
  }, [waitingWorker]);

  const value = useMemo(
    () => ({
      ready,
      settings,
      online,
      refresh,
      bump,
      toast,
      pendingUpdate: isNative() ? false : pendingUpdate,
      applyUpdate,
      syncStatus,
      triggerSync,
      notifyDataChanged,
    }),
    [applyUpdate, bump, notifyDataChanged, online, pendingUpdate, ready, refresh, settings, syncStatus, toast, triggerSync],
  );

  const locked = Boolean(ready && settings?.pinEnabled && !unlocked);

  return (
    <AppContext.Provider value={value}>
      {children}
      {locked ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-forest-950/80 p-6">
          <div className="w-full max-w-md rounded-3xl bg-white p-8 text-center">
            <img src="/logo.jpg" alt="" className="mx-auto h-24 w-24 rounded-full object-cover" />
            <h1 className="mt-4 text-2xl font-bold text-forest-900">EverGreen CASH مقفل</h1>
            <p className="mt-2 text-sm text-muted">قفل التطبيق محلي وليس بديلاً عن تشفير الجهاز.</p>
            <div className="mt-6 flex flex-col gap-3">
              <Input
                inputMode="numeric"
                type="password"
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value)}
                placeholder="رمز PIN"
              />
              {pinError ? <p className="text-danger">{pinError}</p> : null}
              <Button
                onClick={async () => {
                  if (!settings?.pinHash || !settings.pinSalt || !settings.pinIterations) return;
                  const ok = await verifyPin(pinInput, settings.pinHash, settings.pinSalt, settings.pinIterations);
                  if (!ok) {
                    setPinError("رمز غير صحيح");
                    return;
                  }
                  setUnlocked(true);
                  setPinInput("");
                  setPinError("");
                }}
              >
                فتح
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      <div className="pointer-events-none fixed bottom-6 left-6 z-40 flex flex-col gap-2">
        {toasts.map((item) => (
          <div
            key={item.id}
            className={cnToast(item.tone)}
          >
            {item.message}
          </div>
        ))}
      </div>
    </AppContext.Provider>
  );
}

function cnToast(tone: Toast["tone"]): string {
  const color =
    tone === "ok" ? "bg-forest-900" : tone === "warn" ? "bg-warning" : "bg-danger";
  return `${color} pointer-events-auto rounded-2xl px-4 py-3 text-sm font-semibold text-white shadow-lg`;
}

export async function enablePin(pin: string) {
  const hashed = await hashPin(pin);
  await saveSettings({ pinEnabled: true, pinHash: hashed.hash, pinSalt: hashed.salt, pinIterations: hashed.iterations });
}

export async function disablePin() {
  await saveSettings({ pinEnabled: false, pinHash: undefined, pinSalt: undefined, pinIterations: undefined });
}
