export interface CurrencyDefinition {
  code: string;
  symbol: string;
  exponent: number;
  nameAr: string;
  nameEn: string;
}

export const CURRENCIES: Record<string, CurrencyDefinition> = {
  ILS: { code: "ILS", symbol: "₪", exponent: 2, nameAr: "شيكل", nameEn: "Israeli Shekel" },
  JOD: { code: "JOD", symbol: "د.أ", exponent: 3, nameAr: "دينار أردني", nameEn: "Jordanian Dinar" },
  USD: { code: "USD", symbol: "$", exponent: 2, nameAr: "دولار أمريكي", nameEn: "US Dollar" },
  EUR: { code: "EUR", symbol: "€", exponent: 2, nameAr: "يورو", nameEn: "Euro" },
};

export const DEFAULT_CURRENCY = "ILS";

export function getCurrency(code: string): CurrencyDefinition {
  const currency = CURRENCIES[code];
  if (!currency) {
    throw new Error(`عملة غير مدعومة: ${code}`);
  }
  return currency;
}
