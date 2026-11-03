import { snapshotDatabase, restoreSnapshot, type BackupDocument } from "@/lib/backup/serialize";
import { getDb } from "@/lib/db/database";

let isSyncing = false;
let lastSyncedChecksum: string | null = null;
let pendingSyncTimer: ReturnType<typeof setTimeout> | null = null;

export interface SyncStatus {
  state: "idle" | "syncing" | "error" | "offline";
  lastSyncTime: string | null;
  errorMessage?: string;
}

// Called by any data-mutating operation to request an immediate sync.
// If online → syncs within 500ms (debounced to avoid hammering on bulk ops).
// If offline → sets dirtySince flag and waits; sync fires on reconnect.
export function scheduleSync(onResult?: (status: SyncStatus) => void): void {
  if (typeof window === "undefined") return;

  if (pendingSyncTimer !== null) {
    clearTimeout(pendingSyncTimer);
  }

  pendingSyncTimer = setTimeout(async () => {
    pendingSyncTimer = null;
    if (!navigator.onLine) return; // offline — will sync on reconnect via "online" event
    const result = await performAutoSync();
    onResult?.(result);
  }, 500);
}

/**
 * Performs bi-directional synchronization with Vercel Postgres:
 * 1. Pushes local changes if any occurred.
 * 2. Pulls remote changes if server has newer data.
 */
export async function performAutoSync(): Promise<SyncStatus> {
  if (typeof window === "undefined" || !navigator.onLine) {
    return { state: "offline", lastSyncTime: null };
  }

  if (isSyncing) {
    return { state: "syncing", lastSyncTime: null };
  }

  isSyncing = true;
  try {
    const localSnapshot = await snapshotDatabase();

    // 1. Check server status & latest remote state
    const res = await fetch("/api/sync", {
      method: "GET",
      cache: "no-store",
    });

    if (!res.ok) {
      if (res.status === 503) {
        // Postgres not configured yet on Vercel
        return {
          state: "idle",
          lastSyncTime: null,
          errorMessage: "Postgres database not connected yet",
        };
      }
      throw new Error(`Sync error: ${res.statusText}`);
    }

    const serverState = await res.json();

    // If server has no data → first time, upload
    if (!serverState.exists) {
      await pushToPostgres(localSnapshot);
      lastSyncedChecksum = localSnapshot.checksum;
      const settings = await getDb().settings.get("app");
      if (settings?.dirtySince) {
        await getDb().settings.put({ ...settings, dirtySince: undefined });
      }
      return {
        state: "idle",
        lastSyncTime: new Date().toLocaleTimeString("ar-EG"),
      };
    }

    // Checksums match → fully in sync
    if (serverState.checksum === localSnapshot.checksum) {
      lastSyncedChecksum = localSnapshot.checksum;
      const settings = await getDb().settings.get("app");
      if (settings?.dirtySince) {
        await getDb().settings.put({ ...settings, dirtySince: undefined });
      }
      return {
        state: "idle",
        lastSyncTime: new Date().toLocaleTimeString("ar-EG"),
      };
    }

    // Local has pending changes (dirtySince set) → push local
    const settings = await getDb().settings.get("app");
    const hasPendingLocal = Boolean(settings?.dirtySince);
    if (hasPendingLocal || (lastSyncedChecksum && localSnapshot.checksum !== lastSyncedChecksum)) {
      await pushToPostgres(localSnapshot);
      // Clear dirtySince after successful push
      if (settings?.dirtySince) {
        await getDb().settings.put({ ...settings, dirtySince: undefined });
      }
      lastSyncedChecksum = localSnapshot.checksum;
      return {
        state: "idle",
        lastSyncTime: new Date().toLocaleTimeString("ar-EG"),
      };
    }

    // Server has newer data from another device → pull and restore
    if (serverState.data) {
      const remoteDoc: BackupDocument = {
        magic: "EVERGREEN_CASH_BACKUP",
        formatVersion: 1,
        schemaVersion: 1,
        appVersion: "0.1.0",
        createdAt: serverState.updatedAt,
        recordCounts: serverState.recordCounts,
        checksum: serverState.checksum,
        data: serverState.data,
      };
      await restoreSnapshot(remoteDoc);
      lastSyncedChecksum = serverState.checksum;
      return {
        state: "idle",
        lastSyncTime: new Date().toLocaleTimeString("ar-EG"),
      };
    }

    // Default: push local
    await pushToPostgres(localSnapshot);
    lastSyncedChecksum = localSnapshot.checksum;
    return {
      state: "idle",
      lastSyncTime: new Date().toLocaleTimeString("ar-EG"),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Sync failed";
    console.warn("Auto-sync error:", msg);
    return {
      state: "error",
      lastSyncTime: null,
      errorMessage: msg,
    };
  } finally {
    isSyncing = false;
  }
}

async function pushToPostgres(snapshot: BackupDocument) {
  const settings = await getDb().settings.get("app");
  const payload = {
    companyName: settings?.companyName || "EVER GREEN",
    recordCounts: snapshot.recordCounts,
    checksum: snapshot.checksum,
    data: snapshot.data,
  };

  const pushRes = await fetch("/api/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!pushRes.ok) {
    throw new Error(`Failed to push to Postgres (${pushRes.status})`);
  }
}
