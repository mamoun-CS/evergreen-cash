import { isNative } from "@/lib/native";

export function getApiBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").trim().replace(/\/+$/, "");
}

export function getApiUrl(path: string): string | null {
  const baseUrl = getApiBaseUrl();
  if (isNative()) return baseUrl ? `${baseUrl}${path}` : null;
  return baseUrl ? `${baseUrl}${path}` : path;
}
