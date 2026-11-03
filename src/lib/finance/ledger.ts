import { IntegrityError, ValidationError } from "@/lib/errors";
import { sha256Hex } from "@/lib/hash";
import { absMinor, assertPositiveMinor, type Minor } from "@/lib/money";
import type {
  LedgerDeltas,
  LedgerEventRecord,
  LedgerEventType,
  NewLedgerInput,
} from "@/lib/finance/types";

export function computeDeltas(input: NewLedgerInput): LedgerDeltas {
  const amount = absMinor(input.amountMinor);
  if (input.type !== "reversal") {
    assertPositiveMinor(amount);
  }

  switch (input.type) {
    case "income":
    case "opening_balance":
      return { cashDelta: amount, advanceDelta: 0n, incomeDelta: input.type === "income" ? amount : 0n, expenseDelta: 0n };
    case "expense":
      return { cashDelta: -amount, advanceDelta: 0n, incomeDelta: 0n, expenseDelta: amount };
    case "advance_given":
      return { cashDelta: -amount, advanceDelta: amount, incomeDelta: 0n, expenseDelta: 0n };
    case "advance_settlement":
      return { cashDelta: 0n, advanceDelta: -amount, incomeDelta: 0n, expenseDelta: amount };
    case "advance_refund":
      return { cashDelta: amount, advanceDelta: -amount, incomeDelta: 0n, expenseDelta: 0n };
    case "adjustment": {
      if (!input.adjustmentDirection) {
        throw new ValidationError("يجب تحديد اتجاه تسوية الرصيد.");
      }
      const signed = input.adjustmentDirection === "increase" ? amount : -amount;
      return { cashDelta: signed, advanceDelta: 0n, incomeDelta: 0n, expenseDelta: 0n };
    }
    case "reversal":
      throw new IntegrityError("أحداث العكس تُحسب من العملية الأصلية فقط.");
    default:
      throw new ValidationError("نوع الحركة غير معروف.");
  }
}

export function negateDeltas(deltas: LedgerDeltas): LedgerDeltas {
  return {
    cashDelta: -deltas.cashDelta,
    advanceDelta: -deltas.advanceDelta,
    incomeDelta: -deltas.incomeDelta,
    expenseDelta: -deltas.expenseDelta,
  };
}

export function deltasFromEvent(event: LedgerEventRecord): LedgerDeltas {
  return {
    cashDelta: BigInt(event.cashDeltaMinor),
    advanceDelta: BigInt(event.advanceDeltaMinor),
    incomeDelta: BigInt(event.incomeDeltaMinor),
    expenseDelta: BigInt(event.expenseDeltaMinor),
  };
}

export function isActiveEvent(event: LedgerEventRecord): boolean {
  return !event.reversedByEventId;
}

export function outstandingAfter(events: LedgerEventRecord[], personId: string, currency: string): Minor {
  return events
    .filter((event) => isActiveEvent(event) && event.personId === personId && event.currency === currency)
    .reduce((sum, event) => sum + BigInt(event.advanceDeltaMinor), 0n);
}

export function cashBalance(events: LedgerEventRecord[], currency: string): Minor {
  return events
    .filter((event) => isActiveEvent(event) && event.currency === currency)
    .reduce((sum, event) => sum + BigInt(event.cashDeltaMinor), 0n);
}

export function totals(events: LedgerEventRecord[], currency: string) {
  const active = events.filter((event) => isActiveEvent(event) && event.currency === currency);
  return {
    cash: active.reduce((sum, event) => sum + BigInt(event.cashDeltaMinor), 0n),
    income: active.reduce((sum, event) => sum + BigInt(event.incomeDeltaMinor), 0n),
    expense: active.reduce((sum, event) => sum + BigInt(event.expenseDeltaMinor), 0n),
    outstandingAdvances: active.reduce((sum, event) => sum + BigInt(event.advanceDeltaMinor), 0n),
  };
}

export function filterByRange(
  events: LedgerEventRecord[],
  fromIso?: string,
  toIso?: string,
): LedgerEventRecord[] {
  return events.filter((event) => {
    if (fromIso && event.occurredAt < fromIso) return false;
    if (toIso && event.occurredAt > toIso) return false;
    return true;
  });
}

function canonicalEventPayload(event: Omit<LedgerEventRecord, "hash">): string {
  return JSON.stringify({
    id: event.id,
    sequence: event.sequence,
    transactionId: event.transactionId,
    type: event.type,
    currency: event.currency,
    amountMinor: event.amountMinor,
    cashDeltaMinor: event.cashDeltaMinor,
    advanceDeltaMinor: event.advanceDeltaMinor,
    incomeDeltaMinor: event.incomeDeltaMinor,
    expenseDeltaMinor: event.expenseDeltaMinor,
    personId: event.personId ?? null,
    category: event.category ?? null,
    description: event.description,
    notes: event.notes ?? null,
    occurredAt: event.occurredAt,
    createdAt: event.createdAt,
    invoiceId: event.invoiceId ?? null,
    reconciliationId: event.reconciliationId ?? null,
    reversesEventId: event.reversesEventId ?? null,
    prevHash: event.prevHash,
  });
}

export async function hashEvent(event: Omit<LedgerEventRecord, "hash">): Promise<string> {
  return sha256Hex(canonicalEventPayload(event));
}

export async function verifyChain(events: LedgerEventRecord[]): Promise<void> {
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence);
  let prev = "GENESIS";
  for (const event of ordered) {
    if (event.prevHash !== prev) {
      throw new IntegrityError("سلسلة السجل المالي غير مترابطة.");
    }
    const expected = await hashEvent(event);
    if (expected !== event.hash) {
      throw new IntegrityError("تم اكتشاف تعديل غير مصرّح به في السجل المالي.");
    }
    prev = event.hash;
  }
}

export const LEDGER_TYPE_CASH_HINT: Record<Exclude<LedgerEventType, "reversal">, string> = {
  income: "يزيد الصندوق",
  expense: "ينقص الصندوق",
  advance_given: "ينقص الصندوق ويزيد رصيد السلفة",
  advance_settlement: "لا يحرّك الصندوق — يحوّل السلفة إلى مصروف",
  advance_refund: "يعيد النقد إلى الصندوق ويخفض السلفة",
  opening_balance: "يثبت الرصيد الافتتاحي للصندوق",
  adjustment: "يسوّي الفرق بعد الجرد",
};
