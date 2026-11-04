import { saveOrShareFile } from "@/lib/files";

export function toCsv(headers: string[], rows: Array<Array<string | number>>): string {
  const escape = (value: string | number) => {
    const text = String(value);
    if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  };
  return `\uFEFF${[headers.map(escape).join(","), ...rows.map((row) => row.map(escape).join(","))].join("\n")}`;
}

export async function downloadCsv(fileName: string, csv: string): Promise<void> {
  await saveOrShareFile(new TextEncoder().encode(csv), fileName, "text/csv;charset=utf-8;");
}

