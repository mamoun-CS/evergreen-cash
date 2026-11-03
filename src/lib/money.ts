import { ValidationError } from "@/lib/errors";

/** Exact integer minor units. Never use IEEE floats for totals. */
export type Minor = bigint;

export function toMinor(value: bigint | number | string): Minor {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new ValidationError("المبالغ المالية يجب أن تكون أعداداً صحيحة بالوحدة الصغرى.");
    }
    return BigInt(value);
  }
  if (!/^-?\d+$/.test(value)) {
    throw new ValidationError("قيمة مالية غير صالحة.");
  }
  return BigInt(value);
}

export function minorToString(value: Minor): string {
  return value.toString();
}

export function parseMajorToMinor(input: string, exponent: number): Minor {
  const trimmed = input.trim().replace(/,/g, "").replace(/[٠-٩]/g, (d) =>
    String("٠١٢٣٤٥٦٧٨٩".indexOf(d)),
  );
  if (!trimmed) throw new ValidationError("أدخل المبلغ.");
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new ValidationError("صيغة المبلغ غير صحيحة.");
  }
  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [wholeRaw, fracRaw = ""] = unsigned.split(".");
  if (fracRaw.length > exponent) {
    throw new ValidationError(`لا يمكن إدخال أكثر من ${exponent} خانات عشرية.`);
  }
  const whole = wholeRaw === "" ? "0" : wholeRaw;
  const frac = fracRaw.padEnd(exponent, "0");
  const minor = BigInt(whole) * 10n ** BigInt(exponent) + (exponent === 0 ? 0n : BigInt(frac || "0"));
  return negative ? -minor : minor;
}

export function formatMinor(minor: Minor, exponent: number): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const scale = 10n ** BigInt(exponent);
  const whole = abs / scale;
  const frac = abs % scale;
  const fracText = exponent === 0 ? "" : `.${frac.toString().padStart(exponent, "0")}`;
  return `${negative ? "-" : ""}${whole.toString()}${fracText}`;
}

export function formatMinorGrouped(minor: Minor, exponent: number): string {
  const raw = formatMinor(minor, exponent);
  const [whole, frac] = raw.replace("-", "").split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const sign = raw.startsWith("-") ? "-" : "";
  return frac === undefined ? `${sign}${grouped}` : `${sign}${grouped}.${frac}`;
}

export function assertPositiveMinor(amount: Minor, label = "المبلغ"): void {
  if (amount <= 0n) {
    throw new ValidationError(`${label} يجب أن يكون أكبر من صفر.`);
  }
}

export function addMinor(...values: Minor[]): Minor {
  return values.reduce((sum, value) => sum + value, 0n);
}

export function subMinor(a: Minor, b: Minor): Minor {
  return a - b;
}

export function absMinor(value: Minor): Minor {
  return value < 0n ? -value : value;
}
