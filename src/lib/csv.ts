export function toCsv(headers: string[], rows: Array<Array<string | number>>): string {
  const escape = (value: string | number) => {
    const text = String(value);
    if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  };
  return `\uFEFF${[headers.map(escape).join(","), ...rows.map((row) => row.map(escape).join(","))].join("\n")}`;
}

export function downloadCsv(fileName: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
