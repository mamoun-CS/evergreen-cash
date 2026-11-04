import Dexie from "dexie";
import { canonicalize, parseAndValidateBackup, parseAuthenticatedRemoteBackup, snapshotDatabase, type BackupDocument } from "@/lib/backup/serialize";
import { decryptBackupPayload, encryptBackupPayload } from "@/lib/crypto/backupCrypto";
import { APP_VERSION, BACKUP_FORMAT_VERSION, BACKUP_MAGIC, SCHEMA_VERSION } from "@/lib/version";
import { getDb, TABLE_NAMES } from "@/lib/db/database";
import { hashEvent, verifyChain } from "@/lib/finance/ledger";
import { createId } from "@/lib/ids";
import { sha256Hex } from "@/lib/hash";

let isSyncing = false;
let lastSyncedChecksum: string | null = null;
let pendingSyncTimer: ReturnType<typeof setTimeout> | null = null;

export interface SyncStatus {
  state: "idle" | "syncing" | "error" | "offline" | "unavailable";
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
    const keyRow = await getDb().syncMeta.get("syncApiKey");
    const headers: Record<string, string> = keyRow?.value ? { Authorization: `Bearer ${keyRow.value}` } : {};
    const lastRevision = await getDb().syncMeta.get("lastSyncedRevision");
    const pendingOutbox = (await getDb().outbox.orderBy("createdAt").toArray()).filter((item) => !item.nextAttemptAt || item.nextAttemptAt <= new Date().toISOString());

    // 1. Check server status & latest remote state
    const res = await fetchWithTimeout("/api/sync", {
      method: "GET",
      cache: "no-store",
      headers,
    });

    if (!res.ok) {
      if (res.status === 503) {
        return {
          state: "unavailable",
          lastSyncTime: null,
          errorMessage: await getSyncErrorMessage(res, "خدمة المزامنة السحابية غير متاحة؛ تحقق من إعدادات الخادم"),
        };
      }
      if (res.status === 401) throw new Error("مفتاح المزامنة غير صحيح أو غير محفوظ على هذا الجهاز");
      throw new Error(`Sync error: ${res.statusText}`);
    }

    const serverState = await res.json();
    const passphrase = await getDb().syncMeta.get("syncPassphrase");
    if (typeof passphrase?.value !== "string" || passphrase.value.length < 10) throw new Error("أدخل عبارة مرور المزامنة في الإعدادات");

    // If server has no data → first time, upload
    if (!serverState.exists) {
      const pushed = await pushToPostgres(localSnapshot, serverState.revision ?? 0, headers, pendingOutbox);
      await acknowledgeOutbox(pendingOutbox);
      await getDb().syncMeta.put({ key: "lastSyncedRevision", value: pushed.revision });
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

    const { document: verifiedRemote, legacyPlaintext } = await decodeRemoteSnapshot(serverState, passphrase.value);
    if (!legacyPlaintext && verifiedRemote.checksum !== serverState.checksum) {
      throw new Error("بصمة بيانات السحابة غير مطابقة؛ تم رفض المزامنة لحماية البيانات المحلية.");
    }
    // Checksums match → fully in sync
    if (!legacyPlaintext && verifiedRemote.checksum === serverState.checksum && serverState.checksum === localSnapshot.checksum) {
      lastSyncedChecksum = localSnapshot.checksum;
      await getDb().syncMeta.put({ key: "lastSyncedRevision", value: Number(serverState.revision ?? 0) });
      await acknowledgeOutbox(pendingOutbox);
      const settings = await getDb().settings.get("app");
      if (settings?.dirtySince) {
        await getDb().settings.put({ ...settings, dirtySince: undefined });
      }
      return {
        state: "idle",
        lastSyncTime: new Date().toLocaleTimeString("ar-EG"),
      };
    }

    if (Number(lastRevision?.value ?? 0) !== Number(serverState.revision ?? 0)) {
      await mergeRemoteSafely(verifiedRemote!, passphrase.value);
      const merged = await snapshotDatabase();
      const revision = Number(serverState.revision ?? 0);
      const pushed = !legacyPlaintext && merged.checksum === serverState.checksum
        ? { revision }
        : await pushToPostgres(merged, revision, headers, pendingOutbox);
      await acknowledgeOutbox(pendingOutbox);
      await getDb().syncMeta.put({ key: "lastSyncedRevision", value: pushed.revision });
      lastSyncedChecksum = merged.checksum;
      const settings = await getDb().settings.get("app");
      if (settings?.dirtySince) await getDb().settings.put({ ...settings, dirtySince: undefined });
      return { state: "idle", lastSyncTime: new Date().toLocaleTimeString("ar-EG") };
    }

    // Local has pending changes (dirtySince set) → push local
    const settings = await getDb().settings.get("app");
    const hasPendingLocal = Boolean(settings?.dirtySince);
    if (hasPendingLocal || (Number(lastRevision?.value ?? 0) === Number(serverState.revision ?? 0) && lastSyncedChecksum && localSnapshot.checksum !== lastSyncedChecksum)) {
      const pushed = await pushToPostgres(localSnapshot, serverState.revision ?? 0, headers, pendingOutbox);
      await acknowledgeOutbox(pendingOutbox);
      await getDb().syncMeta.put({ key: "lastSyncedRevision", value: pushed.revision });
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
    if (verifiedRemote) {
      const remoteDoc = verifiedRemote;
      if (remoteDoc.schemaVersion > SCHEMA_VERSION) throw new Error("إصدار مخطط البيانات السحابي أحدث من التطبيق");
      if (remoteDoc.appVersion === "0.1.0") remoteDoc.appVersion = APP_VERSION;
      await mergeRemoteSafely(remoteDoc, passphrase.value);
      const mergedSnapshot = await snapshotDatabase();
      if (legacyPlaintext || mergedSnapshot.checksum !== serverState.checksum) {
        const mergedPush = await pushToPostgres(mergedSnapshot, Number(serverState.revision ?? 0), headers, pendingOutbox);
        await acknowledgeOutbox(pendingOutbox);
        await getDb().syncMeta.put({ key: "lastSyncedRevision", value: mergedPush.revision });
        lastSyncedChecksum = mergedSnapshot.checksum;
        return { state: "idle", lastSyncTime: new Date().toLocaleTimeString("ar-EG") };
      }
      await acknowledgeOutbox(pendingOutbox);
      lastSyncedChecksum = serverState.checksum;
      await getDb().syncMeta.put({ key: "lastSyncedRevision", value: serverState.revision });
      return {
        state: "idle",
        lastSyncTime: new Date().toLocaleTimeString("ar-EG"),
      };
    }

    // Default: push local
      const pushed = await pushToPostgres(localSnapshot, serverState.revision ?? 0, headers, pendingOutbox);
      await acknowledgeOutbox(pendingOutbox);
    await getDb().syncMeta.put({ key: "lastSyncedRevision", value: pushed.revision });
    lastSyncedChecksum = localSnapshot.checksum;
    return {
      state: "idle",
      lastSyncTime: new Date().toLocaleTimeString("ar-EG"),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Sync failed";
    const pending = await getDb().outbox.toArray().catch(() => []);
    const now = Date.now();
    await Promise.all(pending.map((item) => getDb().outbox.update(item.id, {
      attempts: item.attempts + 1,
      lastError: msg,
      nextAttemptAt: new Date(now + Math.min(300_000, 1000 * 2 ** Math.min(item.attempts, 8))).toISOString(),
    })));
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

async function pushToPostgres(snapshot: BackupDocument, baseRevision: number, authHeaders: Record<string, string>, queue: Array<{ id: string }> = []): Promise<{ revision: number }> {
  const settings = await getDb().settings.get("app");
  const phrase = await getDb().syncMeta.get("syncPassphrase");
  if (typeof phrase?.value !== "string" || phrase.value.length < 10) throw new Error("أدخل عبارة مرور المزامنة في الإعدادات");
  const batchId = queue[0]?.id || `${snapshot.checksum}-${baseRevision + 1}`;
  let current = snapshot;
  let revision = baseRevision;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const encrypted = await encryptBackupPayload(JSON.stringify(current), phrase.value);
    const { ciphertext, iv, salt, kdfIterations } = splitEncrypted(encrypted.bytes);
    const payload = {
      companyName: settings?.companyName || "EVER GREEN", recordCounts: current.recordCounts,
      baseRevision: revision, revision: revision + 1, batchId, schemaVersion: current.schemaVersion,
      checksum: current.checksum, ciphertext, iv, salt, kdfIterations,
    };
    if (new TextEncoder().encode(JSON.stringify(payload)).length > 1024 * 1024) throw new Error("حجم دفعة المزامنة أكبر من 1 ميغابايت؛ بقيت العناصر محفوظة في قائمة الانتظار");
    const pushRes = await fetchWithTimeout("/api/sync", { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders }, body: JSON.stringify(payload) });
    if (pushRes.ok) return await pushRes.json() as { revision: number };
    if (pushRes.status === 503) throw new Error(await getSyncErrorMessage(pushRes, "خدمة المزامنة السحابية غير متاحة؛ تحقق من إعدادات الخادم"));
    if (pushRes.status === 401) throw new Error("مفتاح المزامنة غير صحيح أو غير محفوظ على هذا الجهاز");
    if (pushRes.status !== 409) throw new Error(`تعذر رفع المزامنة (${pushRes.status})`);
    const conflict = await pushRes.json();
    const { document: remote } = await decodeRemoteSnapshot(conflict, phrase.value);
    await mergeRemoteSafely(remote, phrase.value);
    revision = Number(conflict.revision);
    current = await snapshotDatabase();
  }
  throw new Error("تعارض يحتاج مراجعة: تعذر إتمام الدمج بعد ثلاث محاولات، وحُفظت نسخة أمان محلية.");
}

async function getSyncErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
      return body.error;
    }
  } catch {
    // Keep a useful Arabic fallback if the server response is not JSON.
  }
  return fallback;
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs = 12_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function decodeRemoteSnapshot(
  remote: Record<string, unknown>,
  passphrase: string,
): Promise<{ document: BackupDocument; legacyPlaintext: boolean }> {
  if (typeof remote.ciphertext === "string") {
    const decoded = await parseAuthenticatedRemoteBackup(await decryptBackupPayload(frameFromRemote({
      ciphertext: remote.ciphertext,
      iv: String(remote.iv ?? ""),
      salt: String(remote.salt ?? ""),
      kdfIterations: Number(remote.kdfIterations),
    }), passphrase));
    if (typeof remote.checksum === "string" && decoded.originalChecksum !== remote.checksum && decoded.document.checksum !== remote.checksum) {
      throw new Error("بصمة بيانات السحابة غير مطابقة؛ تم رفض المزامنة لحماية البيانات المحلية.");
    }
    return { document: decoded.document, legacyPlaintext: decoded.legacyChecksum };
  }

  if (typeof remote.blob === "string") {
    const bytes = Uint8Array.from(atob(remote.blob), (char) => char.charCodeAt(0));
    const decoded = await parseAuthenticatedRemoteBackup(await decryptBackupPayload(bytes, passphrase));
    if (typeof remote.checksum === "string" && decoded.originalChecksum !== remote.checksum && decoded.document.checksum !== remote.checksum) {
      throw new Error("بصمة بيانات السحابة غير مطابقة؛ تم رفض المزامنة لحماية البيانات المحلية.");
    }
    return { document: decoded.document, legacyPlaintext: decoded.legacyChecksum };
  }

  // Older server versions stored the table map directly in Postgres and
  // returned it as `data` (or spread the tables into the response). The old
  // checksum covered metadata that this API never retained, so validate table
  // shape/counts and the ledger chain, then immediately re-checksum and encrypt
  // it on the next successful push.
  const rawData = remote.data && typeof remote.data === "object"
    ? remote.data as Record<string, unknown>
    : remote;
  if (!TABLE_NAMES.every((name) => Array.isArray(rawData[name]))) {
    throw new Error("صيغة بيانات السحابة القديمة غير مكتملة؛ لم تُدمج البيانات المحلية.");
  }
  const data = Object.fromEntries(TABLE_NAMES.map((name) => [name, rawData[name] as unknown[]])) as Record<string, unknown[]>;
  const recordCounts = remote.recordCounts && typeof remote.recordCounts === "object"
    ? remote.recordCounts as Record<string, number>
    : Object.fromEntries(TABLE_NAMES.map((name) => [name, data[name].length]));
  for (const name of TABLE_NAMES) {
    if (typeof recordCounts[name] === "number" && recordCounts[name] !== data[name].length) {
      throw new Error(`عدد السجلات في جدول ${name} لا يطابق بيانات السحابة؛ تم رفض الدمج.`);
    }
  }

  data.settings = data.settings.map((row) => {
    const safe = { ...(row as Record<string, unknown>) };
    for (const key of ["pinEnabled", "pinHash", "pinSalt", "pinIterations", "autoLockMinutes", "dirtySince", "syncApiKey"]) delete safe[key];
    return safe;
  });
  const document: BackupDocument = {
    magic: BACKUP_MAGIC,
    formatVersion: BACKUP_FORMAT_VERSION,
    schemaVersion: Number(remote.schemaVersion) || 1,
    appVersion: typeof remote.appVersion === "string" ? remote.appVersion : "0.1.0",
    createdAt: typeof remote.updatedAt === "string" ? remote.updatedAt : new Date().toISOString(),
    recordCounts: Object.fromEntries(TABLE_NAMES.map((name) => [name, data[name].length])),
    checksum: await sha256Hex(canonicalize(data)),
    data,
  };
  return { document: await parseAndValidateBackup(JSON.stringify(document)), legacyPlaintext: true };
}

async function acknowledgeOutbox(queue: Array<{ id: string }>): Promise<void> {
  if (queue.length) await getDb().outbox.bulkDelete(queue.map((item) => item.id));
}

export async function pendingOutboxCount(): Promise<number> {
  return getDb().outbox.count();
}

function splitEncrypted(bytes: Uint8Array) {
  const toHex = (input: Uint8Array) => Array.from(input, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const start = 4;
  const salt = bytes.slice(start, start + 16);
  const iv = bytes.slice(start + 16, start + 28);
  const iterations = new DataView(bytes.buffer, bytes.byteOffset + start + 28, 4).getUint32(0, true);
  const ciphertext = bytes.slice(start + 32);
  return { ciphertext: btoa(Array.from(ciphertext, (byte) => String.fromCharCode(byte)).join("")), salt: toHex(salt), iv: toHex(iv), kdfIterations: iterations };
}

function frameFromRemote(remote: { ciphertext: string; salt: string; iv: string; kdfIterations: number }): Uint8Array {
  const fromHex = (hex: string) => Uint8Array.from(hex.match(/.{2}/g) || [], (byte) => Number.parseInt(byte, 16));
  const magic = new TextEncoder().encode("EGC1");
  const iterations = new Uint8Array(new Uint32Array([remote.kdfIterations]).buffer);
  const ciphertext = Uint8Array.from(atob(remote.ciphertext), (char) => char.charCodeAt(0));
  const result = new Uint8Array(magic.length + 16 + 12 + 4 + ciphertext.length);
  result.set(magic, 0); result.set(fromHex(remote.salt), 4); result.set(fromHex(remote.iv), 20); result.set(iterations, 32); result.set(ciphertext, 36);
  return result;
}

async function mergeRemote(remote: BackupDocument): Promise<void> {
  if (remote.schemaVersion > SCHEMA_VERSION) throw new Error("مخطط البيانات السحابية أحدث من هذا التطبيق");
  const db = getDb();
  const names = ["settings", "people", "ledgerEvents", "transactions", "invoices", "invoiceLines", "invoiceRevisions", "reconciliations", "auditLogs", "sequences", "categories"];
  await db.transaction("rw", names.map((name) => db.table(name)), async () => {
    for (const name of ["people", "transactions", "invoices", "invoiceLines", "categories"]) {
      const table = db.table(name);
      const rows = new Map((await table.toArray() as Array<Record<string, unknown>>).map((row) => [String(row.id ?? row.name), row]));
      for (const item of (remote.data[name] || []) as Array<Record<string, unknown>>) {
        const id = String(item.id ?? item.name);
        const prior = rows.get(id);
        if (!prior || String(item.updatedAt || "") > String(prior.updatedAt || "")) rows.set(id, item);
      }
      await table.bulkPut([...rows.values()]);
    }
    for (const name of ["ledgerEvents", "auditLogs", "invoiceRevisions", "reconciliations"]) {
      const table = db.table(name);
      const rows = new Map((await table.toArray() as Array<Record<string, unknown>>).map((row) => [String(row.id), row]));
      for (const item of (remote.data[name] || []) as Array<Record<string, unknown>>) rows.set(String(item.id), item);
      await table.bulkPut([...rows.values()]);
    }
    const localSettings = await db.settings.get("app");
    const remoteSettings = remote.data.settings?.[0] as Record<string, unknown> | undefined;
    if (localSettings && remoteSettings) await db.settings.put({ ...localSettings, ...remoteSettings, id: "app", pinEnabled: localSettings.pinEnabled, pinHash: localSettings.pinHash, pinSalt: localSettings.pinSalt, pinIterations: localSettings.pinIterations, autoLockMinutes: localSettings.autoLockMinutes, dirtySince: localSettings.dirtySince });

    const ledger = (await db.ledgerEvents.toArray()).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
    let previousHash = "GENESIS";
    const rehashed = [];
    for (let index = 0; index < ledger.length; index += 1) {
      const { hash: _oldHash, ...rest } = ledger[index];
      const draft = { ...rest, sequence: index + 1, prevHash: previousHash };
      const hash = await Dexie.waitFor(hashEvent(draft));
      rehashed.push({ ...draft, hash });
      previousHash = hash;
    }
    await db.ledgerEvents.clear();
    if (rehashed.length) await db.ledgerEvents.bulkAdd(rehashed);
    await verifyChain(rehashed);

    const allInvoices = await db.invoices.toArray();
    const seenInvoiceNumbers = new Set<string>();
    const sortedInvoices = [...allInvoices].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.id.localeCompare(b.id));
    let maxInvoiceSequence = 0;
    const prefix = localSettings?.invoicePrefix || "INV-";
    for (const invoice of sortedInvoices) {
      const match = invoice.invoiceNumber.startsWith(prefix) ? Number(invoice.invoiceNumber.slice(prefix.length)) : 0;
      if (Number.isFinite(match)) maxInvoiceSequence = Math.max(maxInvoiceSequence, match);
      if (seenInvoiceNumbers.has(invoice.invoiceNumber)) {
        maxInvoiceSequence += 1;
        const oldNumber = invoice.invoiceNumber;
        invoice.invoiceNumber = `${prefix}${String(maxInvoiceSequence).padStart(6, "0")}`;
        await db.invoices.put(invoice);
        await db.auditLogs.add({ id: createId(), entityType: "invoice", entityId: invoice.id, action: "renumber_after_sync", details: `إعادة ترقيم ${oldNumber} إلى ${invoice.invoiceNumber} بعد الدمج`, createdAt: new Date().toISOString() });
        if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("egc:toast", { detail: `أعيد ترقيم الفاتورة ${oldNumber} إلى ${invoice.invoiceNumber} لتعارض الرقم بين الأجهزة` }));
      }
      seenInvoiceNumbers.add(invoice.invoiceNumber);
    }
    const maxTx = (await db.transactions.toArray()).reduce((max, tx) => Math.max(max, Number(tx.referenceNumber.replace(/^TX-/, "")) || 0), 0);
    const counters = [
      { name: "ledger", value: rehashed.length },
      { name: "transaction", value: maxTx },
      { name: "invoice", value: maxInvoiceSequence },
    ];
    for (const sequence of counters) {
      const existing = await db.sequences.get(sequence.name);
      await db.sequences.put({ name: sequence.name, value: Math.max(existing?.value || 0, sequence.value) });
    }
  });
}

async function mergeRemoteSafely(remote: BackupDocument, passphrase: string): Promise<void> {
  const local = await snapshotDatabase();
  const safety = await encryptBackupPayload(JSON.stringify(local), passphrase);
  await getDb().syncMeta.put({ key: `mergeSafety:${Date.now()}`, value: btoa(Array.from(safety.bytes, (byte) => String.fromCharCode(byte)).join("")) });
  await mergeRemote(remote);
}
