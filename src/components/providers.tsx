"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { enablePersistentStorage, ensureDefaults, getDb } from "@/lib/db/database";
import { getSettings } from "@/lib/services/financeService";
import { hashPin, verifyPin } from "@/lib/crypto/backupCrypto";
import { saveSettings } from "@/lib/services/financeService";
import type { AppSettingsRecord } from "@/lib/finance/types";
import { registerServiceWorker } from "@/lib/pwa/register";
import { Button, Input } from "@/components/ui/primitives";

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
  const [online, setOnline] = useState(true);
  const [bump, setBump] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pendingUpdate, setPendingUpdate] = useState(false);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState("");
  const lastActiveRef = useRef(0);

  const toast = useCallback((message: string, tone: Toast["tone"] = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, message, tone }]);
    setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 4200);
  }, []);

  const refresh = useCallback(async () => {
    const next = await getSettings();
    setSettings(next);
    setBump((value) => value + 1);
    if (!next.pinEnabled) setUnlocked(true);
  }, []);

  useEffect(() => {
    lastActiveRef.current = Date.now();
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    void (async () => {
      await enablePersistentStorage();
      await ensureDefaults(getDb());
      await refresh();
      setReady(true);
      registerServiceWorker({
        onWaiting: (worker) => {
          setWaitingWorker(worker);
          setPendingUpdate(true);
        },
      });
    })();
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, [refresh]);

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
    waitingWorker?.postMessage({ type: "SKIP_WAITING" });
    window.location.reload();
  }, [waitingWorker]);

  const value = useMemo(
    () => ({ ready, settings, online, refresh, bump, toast, pendingUpdate, applyUpdate }),
    [applyUpdate, bump, online, pendingUpdate, ready, refresh, settings, toast],
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
