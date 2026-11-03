import { ValidationError } from "@/lib/errors";
import { addMinor, type Minor } from "@/lib/money";
import type { InvoiceLineRecord, PaymentStatus } from "@/lib/finance/types";

export function lineTotal(quantityMinor: Minor, quantityExponent: number, unitPriceMinor: Minor): Minor {
  if (quantityMinor <= 0n || unitPriceMinor < 0n) {
    throw new ValidationError("الكمية يجب أن تكون موجبة والسعر لا يمكن أن يكون سالباً.");
  }
  const scale = 10n ** BigInt(quantityExponent);
  return (quantityMinor * unitPriceMinor) / scale;
}

export function invoiceTotals(
  lines: Pick<InvoiceLineRecord, "lineTotalMinor">[],
  discountMinor: Minor,
  taxMinor: Minor,
): { subtotal: Minor; grandTotal: Minor } {
  const subtotal = lines.reduce((sum, line) => addMinor(sum, BigInt(line.lineTotalMinor)), 0n);
  if (discountMinor < 0n || taxMinor < 0n) {
    throw new ValidationError("الخصم والضريبة لا يمكن أن يكونا سالبين.");
  }
  if (discountMinor > subtotal) {
    throw new ValidationError("الخصم أكبر من مجموع البنود.");
  }
  const grandTotal = subtotal - discountMinor + taxMinor;
  if (grandTotal < 0n) {
    throw new ValidationError("إجمالي الفاتورة غير صالح.");
  }
  return { subtotal, grandTotal };
}

export function paymentStatus(grandTotal: Minor, collected: Minor): PaymentStatus {
  if (collected < 0n) throw new ValidationError("المبلغ المحصّل غير صالح.");
  if (collected === 0n) return "unpaid";
  if (collected < grandTotal) return "partial";
  return "paid";
}

export function remainingDue(grandTotal: Minor, collected: Minor): Minor {
  const remaining = grandTotal - collected;
  return remaining < 0n ? 0n : remaining;
}
