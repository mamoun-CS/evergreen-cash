import { IntegrityError, ValidationError } from "@/lib/errors";
import { createId, padSequence } from "@/lib/ids";
import { absMinor, assertPositiveMinor, type Minor } from "@/lib/money";
import { nowIso } from "@/lib/time";
import { ensureDefaults, getDb, type EverGreenDatabase } from "@/lib/db/database";
import {
  computeDeltas,
  deltasFromEvent,
  hashEvent,
  isActiveEvent,
  negateDeltas,
  outstandingAfter,
} from "@/lib/finance/ledger";
import { invoiceTotals, lineTotal, paymentStatus } from "@/lib/finance/invoices";
import type {
  AppSettingsRecord,
  AuditLogRecord,
  InvoiceLineRecord,
  InvoiceRecord,
  LedgerEventRecord,
  NewLedgerInput,
  PersonRecord,
  ReconciliationRecord,
  TransactionRecord,
  UserTransactionType,
} from "@/lib/finance/types";

export type {
  AppSettingsRecord,
  AuditLogRecord,
  InvoiceLineRecord,
  InvoiceRecord,
  LedgerEventRecord,
  NewLedgerInput,
  PersonRecord,
  ReconciliationRecord,
  TransactionRecord,
  UserTransactionType,
};

async function nextSequence(db: EverGreenDatabase, name: string): Promise<number> {
  const current = (await db.sequences.get(name)) ?? { name, value: 0 };
  const value = current.value + 1;
  await db.sequences.put({ name, value });
  return value;
}

async function lastHash(db: EverGreenDatabase): Promise<string> {
  const last = await db.ledgerEvents.orderBy("sequence").last();
  return last?.hash ?? "GENESIS";
}

async function audit(
  db: EverGreenDatabase,
  entityType: string,
  entityId: string,
  action: string,
  details: string,
): Promise<void> {
  const log: AuditLogRecord = {
    id: createId(),
    entityType,
    entityId,
    action,
    details,
    createdAt: nowIso(),
  };
  await db.auditLogs.add(log);
}

async function markDirty(db: EverGreenDatabase): Promise<void> {
  const settings = await db.settings.get("app");
  if (settings) {
    await db.settings.put({ ...settings, dirtySince: settings.dirtySince ?? nowIso() });
  }
}

export async function getSettings(): Promise<AppSettingsRecord> {
  const db = getDb();
  await ensureDefaults(db);
  const settings = await db.settings.get("app");
  if (!settings) throw new IntegrityError("تعذر تحميل الإعدادات.");
  return settings;
}

export async function saveSettings(patch: Partial<AppSettingsRecord>): Promise<AppSettingsRecord> {
  const db = getDb();
  const current = await getSettings();
  const next = { ...current, ...patch, id: "app" as const };
  await db.settings.put(next);
  await audit(db, "settings", "app", "update", "تم تحديث إعدادات الشركة.");
  await markDirty(db);
  return next;
}

export async function listPeople(includeArchived = false): Promise<PersonRecord[]> {
  const db = getDb();
  const rows = await db.people.orderBy("fullName").toArray();
  return includeArchived ? rows : rows.filter((p) => !p.archived);
}

export async function searchPeople(query: string): Promise<PersonRecord[]> {
  const q = query.trim().toLowerCase();
  const people = await listPeople(true);
  if (!q) return people.filter((p) => !p.archived);
  return people.filter(
    (p) => p.fullName.toLowerCase().includes(q) || p.phone.includes(q),
  );
}

export async function upsertPerson(input: {
  id?: string;
  fullName: string;
  phone: string;
  address?: string;
  notes?: string;
}): Promise<PersonRecord> {
  const fullName = input.fullName.trim();
  const phone = input.phone.trim();
  if (fullName.length < 2) throw new ValidationError("أدخل اسم الشخص.");
  const db = getDb();
  const now = nowIso();
  if (input.id) {
    const existing = await db.people.get(input.id);
    if (!existing) throw new ValidationError("الشخص غير موجود.");
    const next: PersonRecord = { ...existing, fullName, phone, address: input.address, notes: input.notes, updatedAt: now };
    await db.people.put(next);
    await audit(db, "person", next.id, "update", `تعديل بيانات ${fullName}`);
    await markDirty(db);
    return next;
  }
  const record: PersonRecord = {
    id: createId(),
    fullName,
    phone,
    address: input.address,
    notes: input.notes,
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
  await db.people.add(record);
  await audit(db, "person", record.id, "create", `إضافة ${fullName}`);
  await markDirty(db);
  return record;
}

export async function archivePerson(id: string): Promise<void> {
  const db = getDb();
  const person = await db.people.get(id);
  if (!person) throw new ValidationError("الشخص غير موجود.");
  await db.people.put({ ...person, archived: true, updatedAt: nowIso() });
  await audit(db, "person", id, "archive", `أرشفة ${person.fullName}`);
  await markDirty(db);
}

export async function deletePerson(id: string): Promise<void> {
  const db = getDb();
  const linked = await db.ledgerEvents.where("personId").equals(id).count();
  const invoices = await db.invoices.where("customerId").equals(id).count();
  if (linked > 0 || invoices > 0) {
    throw new ValidationError("لا يمكن حذف شخص مرتبط بحركات أو فواتير. يمكن أرشفته فقط.");
  }
  await db.people.delete(id);
  await audit(db, "person", id, "delete", "حذف شخص بلا حركات مرتبطة");
  await markDirty(db);
}

async function postEvent(
  db: EverGreenDatabase,
  input: NewLedgerInput,
  transaction: TransactionRecord,
): Promise<LedgerEventRecord> {
  if (!input.description.trim()) throw new ValidationError("أدخل وصف الحركة.");
  const seq = await nextSequence(db, "ledger");
  const deltas =
    input.type === "reversal" && input.reversesEventId
      ? negateDeltas(deltasFromEvent((await db.ledgerEvents.get(input.reversesEventId))!))
      : computeDeltas(input);

  if (input.type === "advance_settlement" || input.type === "advance_refund") {
    if (!input.personId) throw new ValidationError("يجب تحديد الشخص لتسوية أو استرداد السلفة.");
    const events = await db.ledgerEvents.where("personId").equals(input.personId).toArray();
    const outstanding = outstandingAfter(events, input.personId, input.currency);
    if (absMinor(deltas.advanceDelta) > outstanding) {
      throw new ValidationError("المبلغ أكبر من رصيد السلفة المستحق على هذا الشخص.");
    }
  }

  if ((input.type === "advance_given" || input.type === "advance_settlement" || input.type === "advance_refund") && !input.personId) {
    throw new ValidationError("يجب ربط السلفة بشخص.");
  }

  const createdAt = nowIso();
  const draft: Omit<LedgerEventRecord, "hash"> = {
    id: createId(),
    sequence: seq,
    transactionId: transaction.id,
    type: input.type,
    currency: input.currency,
    amountMinor: absMinor(input.amountMinor).toString(),
    cashDeltaMinor: deltas.cashDelta.toString(),
    advanceDeltaMinor: deltas.advanceDelta.toString(),
    incomeDeltaMinor: deltas.incomeDelta.toString(),
    expenseDeltaMinor: deltas.expenseDelta.toString(),
    personId: input.personId,
    category: input.category,
    description: input.description.trim(),
    notes: input.notes?.trim(),
    occurredAt: input.occurredAt,
    createdAt,
    invoiceId: input.invoiceId,
    reconciliationId: input.reconciliationId,
    reversesEventId: input.reversesEventId,
    metadataJson: input.metadata ? JSON.stringify(input.metadata) : undefined,
    prevHash: await lastHash(db),
  };
  const record: LedgerEventRecord = { ...draft, hash: await hashEvent(draft) };
  await db.ledgerEvents.add(record);
  return record;
}

export async function createTransaction(input: {
  type: UserTransactionType;
  amountMinor: Minor;
  currency?: string;
  personId?: string;
  category?: string;
  description: string;
  notes?: string;
  occurredAt: string;
  invoiceId?: string;
  reconciliationId?: string;
  adjustmentDirection?: "increase" | "decrease";
}): Promise<TransactionRecord> {
  assertPositiveMinor(input.amountMinor);
  const db = getDb();
  const settings = await getSettings();
  const currency = input.currency ?? settings.defaultCurrency;

  return db.transaction(
    "rw",
    [db.sequences, db.ledgerEvents, db.transactions, db.auditLogs, db.settings, db.people, db.invoices],
    async () => {
      if (input.personId) {
        const person = await db.people.get(input.personId);
        if (!person || person.archived) throw new ValidationError("الشخص غير موجود أو مؤرشف.");
      }
      const seq = await nextSequence(db, "transaction");
      const id = createId();
      const now = nowIso();
      const tx: TransactionRecord = {
        id,
        referenceNumber: `TX-${padSequence(seq)}`,
        type: input.type,
        status: "posted",
        currency,
        amountMinor: input.amountMinor.toString(),
        personId: input.personId,
        category: input.category,
        description: input.description.trim(),
        notes: input.notes?.trim(),
        occurredAt: input.occurredAt,
        createdAt: now,
        updatedAt: now,
        originalEventId: "",
        currentEventId: "",
        invoiceId: input.invoiceId,
        reconciliationId: input.reconciliationId,
      };
      const event = await postEvent(
        db,
        {
          type: input.type,
          amountMinor: input.amountMinor,
          currency,
          personId: input.personId,
          category: input.category,
          description: input.description,
          notes: input.notes,
          occurredAt: input.occurredAt,
          invoiceId: input.invoiceId,
          reconciliationId: input.reconciliationId,
          adjustmentDirection: input.adjustmentDirection,
          transactionId: id,
        },
        tx,
      );
      tx.originalEventId = event.id;
      tx.currentEventId = event.id;
      await db.transactions.add(tx);
      if (input.invoiceId && input.type === "income") {
        await applyInvoiceCollection(db, input.invoiceId, input.amountMinor);
      }
      await audit(db, "transaction", id, "create", `${tx.referenceNumber} ${input.type}`);
      await markDirty(db);
      return tx;
    },
  );
}

export async function correctTransaction(
  transactionId: string,
  input: {
    type: UserTransactionType;
    amountMinor: Minor;
    personId?: string;
    category?: string;
    description: string;
    notes?: string;
    occurredAt: string;
    adjustmentDirection?: "increase" | "decrease";
  },
): Promise<TransactionRecord> {
  assertPositiveMinor(input.amountMinor);
  const db = getDb();
  return db.transaction(
    "rw",
    [db.sequences, db.ledgerEvents, db.transactions, db.auditLogs, db.settings, db.people, db.invoices],
    async () => {
      const tx = await db.transactions.get(transactionId);
      if (!tx) throw new ValidationError("الحركة غير موجودة.");
      if (tx.status === "reversed") throw new ValidationError("لا يمكن تعديل حركة معكوسة.");
      const current = await db.ledgerEvents.get(tx.currentEventId);
      if (!current || current.reversedByEventId) {
        throw new IntegrityError("حدث الحركة الحالي غير صالح.");
      }
      if (tx.invoiceId && tx.type === "income") {
        await applyInvoiceCollection(db, tx.invoiceId, -BigInt(current.amountMinor));
      }
      const reversalDraftTx = tx;
      const reversal = await postEvent(
        db,
        {
          type: "reversal",
          amountMinor: BigInt(current.amountMinor),
          currency: tx.currency,
          personId: current.personId,
          description: `عكس ${tx.referenceNumber}`,
          occurredAt: nowIso(),
          reversesEventId: current.id,
          invoiceId: current.invoiceId,
          transactionId: tx.id,
        },
        reversalDraftTx,
      );
      await db.ledgerEvents.update(current.id, { reversedByEventId: reversal.id });
      const nextEvent = await postEvent(
        db,
        {
          type: input.type,
          amountMinor: input.amountMinor,
          currency: tx.currency,
          personId: input.personId,
          category: input.category,
          description: input.description,
          notes: input.notes,
          occurredAt: input.occurredAt,
          invoiceId: tx.invoiceId,
          reconciliationId: tx.reconciliationId,
          adjustmentDirection: input.adjustmentDirection,
          transactionId: tx.id,
        },
        tx,
      );
      const updated: TransactionRecord = {
        ...tx,
        type: input.type,
        amountMinor: input.amountMinor.toString(),
        personId: input.personId,
        category: input.category,
        description: input.description.trim(),
        notes: input.notes?.trim(),
        occurredAt: input.occurredAt,
        updatedAt: nowIso(),
        currentEventId: nextEvent.id,
        status: "corrected",
      };
      await db.transactions.put(updated);
      if (updated.invoiceId && updated.type === "income") {
        await applyInvoiceCollection(db, updated.invoiceId, input.amountMinor);
      }
      await audit(db, "transaction", tx.id, "correct", `تصحيح ${tx.referenceNumber}`);
      await markDirty(db);
      return updated;
    },
  );
}

export async function reverseTransaction(transactionId: string, reason: string): Promise<TransactionRecord> {
  const db = getDb();
  return db.transaction(
    "rw",
    [db.sequences, db.ledgerEvents, db.transactions, db.auditLogs, db.settings, db.invoices],
    async () => {
      const tx = await db.transactions.get(transactionId);
      if (!tx) throw new ValidationError("الحركة غير موجودة.");
      if (tx.status === "reversed") throw new ValidationError("الحركة معكوسة مسبقاً.");
      const current = await db.ledgerEvents.get(tx.currentEventId);
      if (!current) throw new IntegrityError("حدث الحركة غير موجود.");
      const reversal = await postEvent(
        db,
        {
          type: "reversal",
          amountMinor: BigInt(current.amountMinor),
          currency: tx.currency,
          personId: current.personId,
          description: reason.trim() || `عكس ${tx.referenceNumber}`,
          occurredAt: nowIso(),
          reversesEventId: current.id,
          invoiceId: current.invoiceId,
          transactionId: tx.id,
        },
        tx,
      );
      await db.ledgerEvents.update(current.id, { reversedByEventId: reversal.id });
      const updated: TransactionRecord = { ...tx, status: "reversed", updatedAt: nowIso() };
      await db.transactions.put(updated);
      if (tx.invoiceId && tx.type === "income") {
        await applyInvoiceCollection(db, tx.invoiceId, -BigInt(current.amountMinor));
      }
      await audit(db, "transaction", tx.id, "reverse", reason);
      await markDirty(db);
      return updated;
    },
  );
}

async function applyInvoiceCollection(db: EverGreenDatabase, invoiceId: string, delta: Minor): Promise<void> {
  const invoice = await db.invoices.get(invoiceId);
  if (!invoice) throw new ValidationError("الفاتورة غير موجودة.");
  if (invoice.status !== "finalized") {
    throw new ValidationError("لا يمكن تسجيل قبض إلا على فاتورة معتمدة.");
  }
  const collected = BigInt(invoice.collectedMinor) + delta;
  if (collected < 0n) throw new ValidationError("المبلغ المحصّل أصبح سالباً.");
  await db.invoices.update(invoiceId, {
    collectedMinor: collected.toString(),
    paymentStatus: paymentStatus(BigInt(invoice.grandTotalMinor), collected),
    updatedAt: nowIso(),
  });
}

export async function listTransactions(): Promise<TransactionRecord[]> {
  const db = getDb();
  return db.transactions.orderBy("occurredAt").reverse().toArray();
}

export async function listLedger(): Promise<LedgerEventRecord[]> {
  const db = getDb();
  return db.ledgerEvents.orderBy("sequence").toArray();
}

export async function personStatement(personId: string) {
  const db = getDb();
  const person = await db.people.get(personId);
  if (!person) throw new ValidationError("الشخص غير موجود.");
  const events = (await db.ledgerEvents.where("personId").equals(personId).toArray()).filter(isActiveEvent);
  const invoices = await db.invoices.where("customerId").equals(personId).toArray();
  const received = events.reduce((s, e) => s + BigInt(e.cashDeltaMinor < "0" && BigInt(e.cashDeltaMinor) > 0n ? e.cashDeltaMinor : e.incomeDeltaMinor > "0" ? e.incomeDeltaMinor : "0"), 0n);
  const cashIn = events.filter((e) => BigInt(e.cashDeltaMinor) > 0n).reduce((s, e) => s + BigInt(e.cashDeltaMinor), 0n);
  const cashOut = events.filter((e) => BigInt(e.cashDeltaMinor) < 0n).reduce((s, e) => s + -BigInt(e.cashDeltaMinor), 0n);
  const outstanding = events.reduce((s, e) => s + BigInt(e.advanceDeltaMinor), 0n);
  return { person, events, invoices, cashIn, cashOut, outstanding, received };
}

export interface InvoiceDraftLine {
  description: string;
  quantity: string;
  unitPrice: string;
}

export async function saveInvoice(input: {
  id?: string;
  customerId?: string;
  customerName: string;
  customerPhone?: string;
  issuedAt: string;
  notes?: string;
  discountMinor: Minor;
  taxMinor: Minor;
  currency?: string;
  lines: InvoiceDraftLine[];
  finalize?: boolean;
}): Promise<InvoiceRecord> {
  if (!input.customerName.trim()) throw new ValidationError("أدخل اسم العميل.");
  if (input.lines.length === 0) throw new ValidationError("أضف بنداً واحداً على الأقل.");
  const db = getDb();
  const settings = await getSettings();
  const currency = input.currency ?? settings.defaultCurrency;
  const { getCurrency } = await import("@/lib/currencies");
  const { parseMajorToMinor } = await import("@/lib/money");
  const exponent = getCurrency(currency).exponent;

  return db.transaction(
    "rw",
    [db.invoices, db.invoiceLines, db.invoiceRevisions, db.sequences, db.auditLogs, db.settings, db.people],
    async () => {
      const existing = input.id ? await db.invoices.get(input.id) : undefined;
      if (existing?.status === "canceled") throw new ValidationError("لا يمكن تعديل فاتورة ملغاة.");
      if (existing?.status === "finalized" && !input.finalize) {
        throw new ValidationError("الفاتورة المعتمدة تُعدَّل عبر مراجعة جديدة فقط.");
      }

      const lineRecords: InvoiceLineRecord[] = input.lines.map((line, index) => {
        const qty = parseMajorToMinor(line.quantity, 3);
        const price = parseMajorToMinor(line.unitPrice, exponent);
        const total = lineTotal(qty, 3, price);
        return {
          id: createId(),
          invoiceId: existing?.id ?? "pending",
          description: line.description.trim(),
          quantityMinor: qty.toString(),
          quantityExponent: 3,
          unitPriceMinor: price.toString(),
          lineTotalMinor: total.toString(),
          sortOrder: index,
        };
      });
      if (lineRecords.some((l) => !l.description)) throw new ValidationError("وصف البند مطلوب.");
      const { subtotal, grandTotal } = invoiceTotals(lineRecords, input.discountMinor, input.taxMinor);
      const now = nowIso();
      const isNew = !existing;
      const becomingFinal = Boolean(input.finalize);
      let invoiceNumber = existing?.invoiceNumber;
      if (isNew || (existing.status === "draft" && becomingFinal && existing.invoiceNumber.startsWith("DRAFT-"))) {
        if (becomingFinal) {
          const seq = await nextSequence(db, "invoice");
          invoiceNumber = `${settings.invoicePrefix}${padSequence(seq)}`;
        } else {
          invoiceNumber = existing?.invoiceNumber ?? `DRAFT-${createId().slice(0, 8)}`;
        }
      }

      const record: InvoiceRecord = {
        id: existing?.id ?? createId(),
        invoiceNumber: invoiceNumber!,
        status: becomingFinal ? "finalized" : "draft",
        paymentStatus: existing?.paymentStatus ?? "unpaid",
        currency,
        customerId: input.customerId,
        customerName: input.customerName.trim(),
        customerPhone: input.customerPhone?.trim(),
        issuedAt: input.issuedAt,
        notes: input.notes?.trim(),
        discountMinor: input.discountMinor.toString(),
        taxMinor: input.taxMinor.toString(),
        subtotalMinor: subtotal.toString(),
        grandTotalMinor: grandTotal.toString(),
        collectedMinor: existing?.collectedMinor ?? "0",
        revision: (existing?.revision ?? 0) + (existing ? 1 : 0),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        finalizedAt: becomingFinal ? now : existing?.finalizedAt,
      };
      lineRecords.forEach((line) => {
        line.invoiceId = record.id;
      });

      if (existing) {
        const previousLines = await db.invoiceLines.where("invoiceId").equals(existing.id).toArray();
        await db.invoiceRevisions.add({
          id: createId(),
          invoiceId: existing.id,
          revision: record.revision,
          snapshotJson: JSON.stringify({ invoice: existing, lines: previousLines }),
          createdAt: now,
          reason: becomingFinal ? "اعتماد الفاتورة" : "تعديل مسودة/مراجعة",
        });
        await db.invoiceLines.where("invoiceId").equals(existing.id).delete();
      }

      await db.invoices.put(record);
      await db.invoiceLines.bulkAdd(lineRecords);
      await audit(db, "invoice", record.id, becomingFinal ? "finalize" : isNew ? "create" : "update", record.invoiceNumber);
      await markDirty(db);
      return record;
    },
  );
}

export async function duplicateInvoice(id: string): Promise<InvoiceRecord> {
  const db = getDb();
  const invoice = await db.invoices.get(id);
  if (!invoice) throw new ValidationError("الفاتورة غير موجودة.");
  const lines = await db.invoiceLines.where("invoiceId").equals(id).toArray();
  const { formatMinor } = await import("@/lib/money");
  const { getCurrency } = await import("@/lib/currencies");
  const exponent = getCurrency(invoice.currency).exponent;
  return saveInvoice({
    customerId: invoice.customerId,
    customerName: invoice.customerName,
    customerPhone: invoice.customerPhone,
    issuedAt: nowIso(),
    notes: invoice.notes,
    discountMinor: BigInt(invoice.discountMinor),
    taxMinor: BigInt(invoice.taxMinor),
    currency: invoice.currency,
    lines: lines
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((line) => ({
        description: line.description,
        quantity: formatMinor(BigInt(line.quantityMinor), line.quantityExponent),
        unitPrice: formatMinor(BigInt(line.unitPriceMinor), exponent),
      })),
  });
}

export async function cancelInvoice(id: string, reason: string): Promise<InvoiceRecord> {
  const db = getDb();
  const invoice = await db.invoices.get(id);
  if (!invoice) throw new ValidationError("الفاتورة غير موجودة.");
  if (invoice.status === "canceled") throw new ValidationError("الفاتورة ملغاة مسبقاً.");
  if (BigInt(invoice.collectedMinor) > 0n) {
    throw new ValidationError("لا يمكن إلغاء فاتورة تم تحصيل مبالغ عليها. اعكس حركات القبض أولاً.");
  }
  const updated: InvoiceRecord = {
    ...invoice,
    status: "canceled",
    canceledAt: nowIso(),
    updatedAt: nowIso(),
    revision: invoice.revision + 1,
  };
  await db.invoices.put(updated);
  await db.invoiceRevisions.add({
    id: createId(),
    invoiceId: id,
    revision: updated.revision,
    snapshotJson: JSON.stringify(invoice),
    createdAt: nowIso(),
    reason: reason.trim() || "إلغاء فاتورة",
  });
  await audit(db, "invoice", id, "cancel", reason);
  await markDirty(db);
  return updated;
}

export async function listInvoices(): Promise<InvoiceRecord[]> {
  return getDb().invoices.orderBy("createdAt").reverse().toArray();
}

export async function getInvoiceWithLines(id: string) {
  const db = getDb();
  const invoice = await db.invoices.get(id);
  if (!invoice) throw new ValidationError("الفاتورة غير موجودة.");
  const lines = (await db.invoiceLines.where("invoiceId").equals(id).toArray()).sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );
  const revisions = await db.invoiceRevisions.where("invoiceId").equals(id).toArray();
  return { invoice, lines, revisions };
}

export async function createReconciliation(input: {
  occurredAt: string;
  countedMinor: Minor;
  notes?: string;
  createAdjustment: boolean;
  adjustmentNotes?: string;
}): Promise<ReconciliationRecord> {
  const db = getDb();
  const settings = await getSettings();
  const events = await db.ledgerEvents.toArray();
  const expected = events
    .filter((e) => isActiveEvent(e) && e.currency === settings.defaultCurrency)
    .reduce((s, e) => s + BigInt(e.cashDeltaMinor), 0n);
  const difference = input.countedMinor - expected;

  return db.transaction(
    "rw",
    [db.reconciliations, db.transactions, db.ledgerEvents, db.sequences, db.auditLogs, db.settings, db.people, db.invoices],
    async () => {
      const rec: ReconciliationRecord = {
        id: createId(),
        occurredAt: input.occurredAt,
        currency: settings.defaultCurrency,
        expectedMinor: expected.toString(),
        countedMinor: input.countedMinor.toString(),
        differenceMinor: difference.toString(),
        notes: input.notes,
        createdAt: nowIso(),
      };
      if (input.createAdjustment && difference !== 0n) {
        const tx = await createTransaction({
          type: "adjustment",
          amountMinor: difference < 0n ? -difference : difference,
          occurredAt: input.occurredAt,
          description: input.adjustmentNotes || "تسوية فرق الجرد النقدي",
          notes: input.notes,
          reconciliationId: rec.id,
          adjustmentDirection: difference > 0n ? "increase" : "decrease",
          category: "فرق جرد",
        });
        rec.adjustmentTransactionId = tx.id;
      }
      await db.reconciliations.add(rec);
      await audit(db, "reconciliation", rec.id, "create", `فرق ${difference.toString()}`);
      await markDirty(db);
      return rec;
    },
  );
}

export async function listReconciliations(): Promise<ReconciliationRecord[]> {
  return getDb().reconciliations.orderBy("occurredAt").reverse().toArray();
}

export async function dashboardSummary(from?: string, to?: string) {
  const settings = await getSettings();
  const currency = settings.defaultCurrency;
  const events = (await listLedger()).filter((e) => e.currency === currency);
  const active = events.filter(isActiveEvent);
  const inRange = active.filter((e) => {
    if (from && e.occurredAt < from) return false;
    if (to && e.occurredAt > to) return false;
    return true;
  });
  const cash = active.reduce((s, e) => s + BigInt(e.cashDeltaMinor), 0n);
  const incomeAll = active.reduce((s, e) => s + BigInt(e.incomeDeltaMinor), 0n);
  const expenseAll = active.reduce((s, e) => s + BigInt(e.expenseDeltaMinor), 0n);
  const incomeRange = inRange.reduce((s, e) => s + BigInt(e.incomeDeltaMinor), 0n);
  const expenseRange = inRange.reduce((s, e) => s + BigInt(e.expenseDeltaMinor), 0n);
  const outstanding = active.reduce((s, e) => s + BigInt(e.advanceDeltaMinor), 0n);
  const transactions = (await listTransactions()).slice(0, 8);
  const invoices = (await listInvoices()).slice(0, 6);
  return {
    settings,
    currency,
    cash,
    incomeAll,
    expenseAll,
    incomeRange,
    expenseRange,
    outstanding,
    transactions,
    invoices,
    lastBackupAt: settings.lastSuccessfulBackupAt,
    dirtySince: settings.dirtySince,
  };
}
