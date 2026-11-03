import { getCurrency } from "@/lib/currencies";
import { formatMinorGrouped, type Minor } from "@/lib/money";

export function moneyLabel(minor: Minor | string, currencyCode: string): string {
  const currency = getCurrency(currencyCode);
  const value = typeof minor === "string" ? BigInt(minor) : minor;
  return `${currency.symbol} ${formatMinorGrouped(value, currency.exponent)}`;
}
