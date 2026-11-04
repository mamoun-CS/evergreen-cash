import { IntegrityError } from "@/lib/errors";
import { getDb, TABLE_NAMES } from "@/lib/db/database";
import { APP_VERSION, BACKUP_FORMAT_VERSION, BACKUP_MAGIC, SCHEMA_VERSION } from "@/lib/version";
import { sha256Hex } from "@/lib/hash";
import { verifyChain } from "@/lib/finance/ledger";

export interface BackupDocument {
  magic: typeof BACKUP_MAGIC;
  formatVersion: number;
  schemaVersion: number;
  appVersion: string;
  createdAt: string;
  recordCounts: Record<string, number>;
  checksum: string;
  data: Record<string, unknown[]>;
}

export async function snapshotDatabase(): Promise<BackupDocument> {
  const db = getDb();
  const data: Record<string, unknown[]> = {};
  const recordCounts: Record<string, number> = {};
  await db.transaction("r", TABLE_NAMES.map((name) => db.table(name)), async () => {
    for (const name of TABLE_NAMES) {
      const rows = await db.table(name).toArray();
      data[name] = name === "settings"
        ? rows.map((row) => {
            const copy = { ...(row as Record<string, unknown>) };
            for (const key of ["pinEnabled", "pinHash", "pinSalt", "pinIterations", "autoLockMinutes", "dirtySince", "syncApiKey"]) delete copy[key];
            return copy;
          })
        : rows;
      recordCounts[name] = data[name].length;
    }
  });
  const unsigned = {
    magic: BACKUP_MAGIC as typeof BACKUP_MAGIC,
    formatVersion: BACKUP_FORMAT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    createdAt: new Date().toISOString(),
    recordCounts,
    data,
  };
  const checksum = await sha256Hex(stableStringify(data));
  return { ...unsigned, checksum };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function serializeBackup(doc: BackupDocument): string {
  return JSON.stringify(doc);
}

export async function parseAndValidateBackup(json: string): Promise<BackupDocument> {
  let parsed: BackupDocument;
  try {
    parsed = JSON.parse(json) as BackupDocument;
  } catch {
    throw new IntegrityError("تعذر قراءة ملف النسخة الاحتياطية.");
  }
  if (parsed.magic !== BACKUP_MAGIC) {
    throw new IntegrityError("الملف ليس نسخة EverGreen CASH.");
  }
  if (parsed.formatVersion > BACKUP_FORMAT_VERSION) {
    throw new IntegrityError("إصدار ملف النسخة أحدث من هذا التطبيق.");
  }
  if (parsed.schemaVersion > SCHEMA_VERSION) {
    throw new IntegrityError("مخطط قاعدة البيانات في النسخة غير متوافق.");
  }
  for (const name of TABLE_NAMES) {
    if (!Array.isArray(parsed.data?.[name])) {
      throw new IntegrityError(`جدول مفقود في النسخة: ${name}`);
    }
  }
  await verifyChain(parsed.data.ledgerEvents as never[]);
  const unsigned = Object.fromEntries(Object.entries(parsed).filter(([key]) => key !== "checksum"));
  const currentChecksum = await sha256Hex(stableStringify(parsed.data));
  const legacyChecksum = await sha256Hex(JSON.stringify(unsigned));
  if (parsed.checksum !== currentChecksum && parsed.checksum !== legacyChecksum) throw new IntegrityError("بصمة النسخة الاحتياطية غير صحيحة؛ تم رفض الاستعادة.");
  return parsed;
}

export function canonicalize(value: unknown): string {
  return stableStringify(value);
}

export async function restoreSnapshot(doc: BackupDocument): Promise<void> {
  const validated = await parseAndValidateBackup(JSON.stringify(doc));
  const db = getDb();
  await db.transaction("rw", TABLE_NAMES.map((name) => db.table(name)), async () => {
    for (const name of TABLE_NAMES) {
      await db.table(name).clear();
      const rows = validated.data[name];
      if (rows.length) await db.table(name).bulkAdd(rows);
    }
  });
}
