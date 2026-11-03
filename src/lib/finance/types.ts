import type { Minor } from "@/lib/money";

export const LEDGER_EVENT_TYPES = [
  "income",
  "expense",
  "advance_given",
  "advance_settlement",
  "advance_refund",
  "opening_balance",
  "adjustment",
  "reversal",
] as const;

export type LedgerEventType = (typeof LEDGER_EVENT_TYPES)[number];

export const USER_TRANSACTION_TYPES = [
  "income",
  "expense",
  "advance_given",
  "advance_settlement",
  "advance_refund",
  "opening_balance",
  "adjustment",
] as const;

export type UserTransactionType = (typeof USER_TRANSACTION_TYPES)[number];

export const TRANSACTION_STATUS = ["posted", "reversed", "corrected"] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUS)[number];

export const INVOICE_STATUS = ["draft", "finalized", "canceled"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUS)[number];

export const PAYMENT_STATUS = ["unpaid", "partial", "paid"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUS)[number];

export interface LedgerDeltas {
  cashDelta: Minor;
  advanceDelta: Minor;
  incomeDelta: Minor;
  expenseDelta: Minor;
}

export interface NewLedgerInput {
  type: LedgerEventType;
  amountMinor: Minor;
  currency: string;
  personId?: string;
  category?: string;
  description: string;
  notes?: string;
  occurredAt: string;
  invoiceId?: string;
  reconciliationId?: string;
  adjustmentDirection?: "increase" | "decrease";
  reversesEventId?: string;
  transactionId?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface LedgerEventRecord {
  id: string;
  sequence: number;
  transactionId: string;
  type: LedgerEventType;
  currency: string;
  amountMinor: string;
  cashDeltaMinor: string;
  advanceDeltaMinor: string;
  incomeDeltaMinor: string;
  expenseDeltaMinor: string;
  personId?: string;
  category?: string;
  description: string;
  notes?: string;
  occurredAt: string;
  createdAt: string;
  invoiceId?: string;
  reconciliationId?: string;
  reversesEventId?: string;
  reversedByEventId?: string;
  metadataJson?: string;
  prevHash: string;
  hash: string;
}

export interface TransactionRecord {
  id: string;
  referenceNumber: string;
  type: UserTransactionType;
  status: TransactionStatus;
  currency: string;
  amountMinor: string;
  personId?: string;
  category?: string;
  description: string;
  notes?: string;
  occurredAt: string;
  createdAt: string;
  updatedAt: string;
  originalEventId: string;
  currentEventId: string;
  invoiceId?: string;
  reconciliationId?: string;
}

export interface PersonRecord {
  id: string;
  fullName: string;
  phone: string;
  address?: string;
  notes?: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceLineRecord {
  id: string;
  invoiceId: string;
  description: string;
  quantityMinor: string;
  quantityExponent: number;
  unitPriceMinor: string;
  lineTotalMinor: string;
  sortOrder: number;
}

export interface InvoiceRecord {
  id: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  paymentStatus: PaymentStatus;
  currency: string;
  customerId?: string;
  customerName: string;
  customerPhone?: string;
  issuedAt: string;
  notes?: string;
  discountMinor: string;
  taxMinor: string;
  subtotalMinor: string;
  grandTotalMinor: string;
  collectedMinor: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  finalizedAt?: string;
  canceledAt?: string;
}

export interface InvoiceRevisionRecord {
  id: string;
  invoiceId: string;
  revision: number;
  snapshotJson: string;
  createdAt: string;
  reason: string;
}

export interface ReconciliationRecord {
  id: string;
  occurredAt: string;
  currency: string;
  expectedMinor: string;
  countedMinor: string;
  differenceMinor: string;
  notes?: string;
  adjustmentTransactionId?: string;
  createdAt: string;
}

export interface AuditLogRecord {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  details: string;
  createdAt: string;
}

export interface BackupMetaRecord {
  id: string;
  createdAt: string;
  status: "success" | "failed" | "local";
  destination: "file" | "safety" | "postgres";
  fileName: string;
  recordCountsJson: string;
  errorMessage?: string;
  verified: boolean;
}

export interface SequenceRecord {
  name: string;
  value: number;
}

export interface CategoryRecord {
  id: string;
  kind: "income" | "expense" | "advance" | "adjustment";
  name: string;
}

export interface AppSettingsRecord {
  id: "app";
  companyName: string;
  companyAddress: string;
  companyPhone: string;
  companyEmail: string;
  logoDataUrl?: string;
  defaultCurrency: string;
  invoicePrefix: string;
  invoiceFooter: string;
  autoBackupEnabled: boolean;
  autoBackupIntervalMinutes: number;
  keepBackupCount: number;
  lastSuccessfulBackupAt?: string;
  pinEnabled: boolean;
  pinHash?: string;
  pinSalt?: string;
  pinIterations?: number;
  autoLockMinutes: number;
  schemaVersion: number;
  dirtySince?: string;
}

export const TRANSACTION_TYPE_LABELS: Record<UserTransactionType, string> = {
  income: "قبض نقدي",
  expense: "صرف نقدي",
  advance_given: "سلفة",
  advance_settlement: "تسوية سلفة",
  advance_refund: "استرداد سلفة",
  opening_balance: "رصيد افتتاحي",
  adjustment: "تسوية رصيد",
};
