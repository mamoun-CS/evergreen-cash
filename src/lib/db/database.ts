import Dexie, { type EntityTable } from "dexie";
import { COMPANY_LEGAL_NAME, SCHEMA_VERSION } from "@/lib/version";
import type {
  AppSettingsRecord,
  AuditLogRecord,
  BackupMetaRecord,
  CategoryRecord,
  InvoiceLineRecord,
  InvoiceRecord,
  InvoiceRevisionRecord,
  LedgerEventRecord,
  PersonRecord,
  ReconciliationRecord,
  SequenceRecord,
  TransactionRecord,
} from "@/lib/finance/types";

export class EverGreenDatabase extends Dexie {
  settings!: EntityTable<AppSettingsRecord, "id">;
  people!: EntityTable<PersonRecord, "id">;
  ledgerEvents!: EntityTable<LedgerEventRecord, "id">;
  transactions!: EntityTable<TransactionRecord, "id">;
  invoices!: EntityTable<InvoiceRecord, "id">;
  invoiceLines!: EntityTable<InvoiceLineRecord, "id">;
  invoiceRevisions!: EntityTable<InvoiceRevisionRecord, "id">;
  reconciliations!: EntityTable<ReconciliationRecord, "id">;
  auditLogs!: EntityTable<AuditLogRecord, "id">;
  backupMeta!: EntityTable<BackupMetaRecord, "id">;
  sequences!: EntityTable<SequenceRecord, "name">;
  categories!: EntityTable<CategoryRecord, "id">;

  constructor() {
    super("evergreen-cash");
    this.version(SCHEMA_VERSION).stores({
      settings: "id",
      people: "id, fullName, phone, archived, createdAt",
      ledgerEvents: "id, sequence, type, transactionId, personId, invoiceId, occurredAt, createdAt, reversesEventId, currency",
      transactions: "id, referenceNumber, type, status, personId, occurredAt, invoiceId",
      invoices: "id, invoiceNumber, status, paymentStatus, customerId, issuedAt, createdAt",
      invoiceLines: "id, invoiceId",
      invoiceRevisions: "id, invoiceId, revision, createdAt",
      reconciliations: "id, occurredAt, createdAt",
      auditLogs: "id, entityType, entityId, createdAt",
      backupMeta: "id, createdAt, status, destination",
      sequences: "name",
      categories: "id, kind, name",
    });
  }
}

let instance: EverGreenDatabase | null = null;

export function getDb(): EverGreenDatabase {
  if (typeof window === "undefined" && process.env.VITEST !== "true") {
    throw new Error("IndexedDB is only available in the browser.");
  }
  if (!instance) instance = new EverGreenDatabase();
  return instance;
}

export function resetDbInstance(): void {
  instance = null;
}

/**
 * Requests persistent storage from the browser (WebKit / Safari / iPadOS)
 * to prevent the operating system from evicting IndexedDB data during low storage conditions.
 */
export async function enablePersistentStorage(): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.storage && navigator.storage.persist) {
    try {
      const isPersisted = await navigator.storage.persisted();
      if (!isPersisted) {
        return await navigator.storage.persist();
      }
      return isPersisted;
    } catch (err) {
      console.warn("Could not request persistent storage:", err);
      return false;
    }
  }
  return false;
}

export async function ensureDefaults(db: EverGreenDatabase): Promise<void> {
  await db.transaction("rw", [db.settings, db.sequences, db.categories], async () => {
    const existing = await db.settings.get("app");
    if (!existing) {
      await db.settings.put({
        id: "app",
        companyName: COMPANY_LEGAL_NAME,
        companyAddress: "",
        companyPhone: "0597749188",
        companyEmail: "",
        defaultCurrency: "ILS",
        invoicePrefix: "INV-",
        invoiceFooter: "شكراً لتعاملكم مع إيفر غرين للمقاولات الزراعية.",
        autoBackupEnabled: true,
        autoBackupIntervalMinutes: 60,
        keepBackupCount: 7,
        pinEnabled: false,
        autoLockMinutes: 5,
        schemaVersion: SCHEMA_VERSION,
      });
    } else if (!existing.companyPhone) {
      await db.settings.put({
        ...existing,
        companyPhone: "0597749188",
      });
    }

    await db.sequences.bulkPut([
      { name: "transaction", value: 0 },
      { name: "invoice", value: 0 },
      { name: "ledger", value: 0 },
    ]);

    await db.categories.bulkPut([
      { id: "inc-sales", kind: "income", name: "مبيعات" },
      { id: "inc-services", kind: "income", name: "خدمات زراعية" },
      { id: "inc-other", kind: "income", name: "إيرادات أخرى" },
      { id: "exp-fuel", kind: "expense", name: "وقود" },
      { id: "exp-materials", kind: "expense", name: "مواد ومستلزمات" },
      { id: "exp-maintenance", kind: "expense", name: "صيانة" },
      { id: "exp-salaries", kind: "expense", name: "رواتب" },
      { id: "exp-other", kind: "expense", name: "مصروفات أخرى" },
      { id: "adv-purchase", kind: "advance", name: "سلفة مشتريات" },
      { id: "adv-personal", kind: "advance", name: "سلفة شخصية" },
      { id: "adj-count", kind: "adjustment", name: "فرق جرد" },
    ]);
  });
}

export const TABLE_NAMES = [
  "settings",
  "people",
  "ledgerEvents",
  "transactions",
  "invoices",
  "invoiceLines",
  "invoiceRevisions",
  "reconciliations",
  "auditLogs",
  "backupMeta",
  "sequences",
  "categories",
] as const;

export type TableName = (typeof TABLE_NAMES)[number];
