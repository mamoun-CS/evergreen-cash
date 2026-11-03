import { endOfDay, endOfMonth, endOfWeek, startOfDay, startOfMonth, startOfWeek } from "date-fns";

export function nowIso(): string {
  return new Date().toISOString();
}

export function toIso(date: Date): string {
  return date.toISOString();
}

export function startOfLocalDayIso(date = new Date()): string {
  return startOfDay(date).toISOString();
}

export function endOfLocalDayIso(date = new Date()): string {
  return endOfDay(date).toISOString();
}

export type DatePreset = "day" | "week" | "month" | "custom";

export function rangeForPreset(preset: DatePreset, customFrom?: string, customTo?: string): {
  from: string;
  to: string;
} {
  const now = new Date();
  if (preset === "day") return { from: startOfDay(now).toISOString(), to: endOfDay(now).toISOString() };
  if (preset === "week") {
    return {
      from: startOfWeek(now, { weekStartsOn: 6 }).toISOString(),
      to: endOfWeek(now, { weekStartsOn: 6 }).toISOString(),
    };
  }
  if (preset === "month") {
    return { from: startOfMonth(now).toISOString(), to: endOfMonth(now).toISOString() };
  }
  const from = customFrom ? new Date(`${customFrom}T00:00:00`).toISOString() : startOfMonth(now).toISOString();
  const to = customTo ? new Date(`${customTo}T23:59:59.999`).toISOString() : endOfDay(now).toISOString();
  return { from, to };
}

export function formatDateTimeAr(iso: string): string {
  return new Intl.DateTimeFormat("ar", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

export function formatDateAr(iso: string): string {
  return new Intl.DateTimeFormat("ar", { dateStyle: "medium" }).format(new Date(iso));
}

export function datetimeLocalValue(iso?: string): string {
  const date = iso ? new Date(iso) : new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromDatetimeLocal(value: string): string {
  return new Date(value).toISOString();
}
