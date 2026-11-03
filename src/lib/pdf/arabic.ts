import ArabicReshaper from "arabic-reshaper";
import bidiFactory from "bidi-js";

const bidi = bidiFactory();

interface Reshaper {
  convertArabic: (text: string) => string;
}

const reshaper = ArabicReshaper as unknown as Reshaper;

export function shapeArabic(text: string): string {
  const reshaped = reshaper.convertArabic(text);
  const embeddingLevels = bidi.getEmbeddingLevels(reshaped, "rtl");
  const flattened = bidi.getReorderedString(reshaped, embeddingLevels);
  return flattened;
}

export function splitLines(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}
