import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { getCurrency } from "@/lib/currencies";
import { formatMinorGrouped } from "@/lib/money";
import { COMPANY_LEGAL_NAME } from "@/lib/version";
import { shapeArabic, splitLines } from "@/lib/pdf/arabic";
import type { InvoiceLineRecord, InvoiceRecord, PersonRecord } from "@/lib/finance/types";
import type { AppSettingsRecord } from "@/lib/finance/types";
import { formatDateAr } from "@/lib/time";

async function loadFontBytes(): Promise<ArrayBuffer> {
  if (typeof window !== "undefined" && typeof fetch === "function") {
    try {
      const res = await fetch("/fonts/Cairo-Regular.ttf");
      if (res.ok) return await res.arrayBuffer();
    } catch {
      /* ignore */
    }
  }
  if (typeof process !== "undefined" && process.versions?.node) {
    try {
      const fsMod = "node:fs/promises";
      const pathMod = "node:path";
      const fs = await import(/* webpackIgnore: true */ fsMod);
      const path = await import(/* webpackIgnore: true */ pathMod);
      const buf = await fs.readFile(path.join(process.cwd(), "public/fonts/Cairo-Regular.ttf"));
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    } catch {
      /* ignore */
    }
  }
  throw new Error("Unable to load Cairo font");
}

async function loadLogoBytes(): Promise<ArrayBuffer | null> {
  if (typeof window !== "undefined" && typeof fetch === "function") {
    try {
      const res = await fetch("/logo.jpg");
      if (res.ok) return await res.arrayBuffer();
    } catch {
      /* ignore */
    }
  }
  if (typeof process !== "undefined" && process.versions?.node) {
    try {
      const fsMod = "node:fs/promises";
      const pathMod = "node:path";
      const fs = await import(/* webpackIgnore: true */ fsMod);
      const path = await import(/* webpackIgnore: true */ pathMod);
      const buf = await fs.readFile(path.join(process.cwd(), "public/logo.jpg"));
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    } catch {
      return null;
    }
  }
  return null;
}

const forest = rgb(15 / 255, 61 / 255, 46 / 255);
const lime = rgb(141 / 255, 198 / 255, 63 / 255);
const muted = rgb(80 / 255, 90 / 255, 80 / 255);

function drawRtl(page: PDFPage, font: PDFFont, text: string, xRight: number, y: number, size: number, color = forest) {
  const shaped = shapeArabic(text);
  const width = font.widthOfTextAtSize(shaped, size);
  page.drawText(shaped, { x: xRight - width, y, size, font, color });
}

export async function buildInvoicePdf(params: {
  invoice: InvoiceRecord;
  lines: InvoiceLineRecord[];
  settings: AppSettingsRecord;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(await loadFontBytes(), { subset: false });
  const page = doc.addPage([595, 842]);
  const { width, height } = page.getSize();
  const margin = 40;
  const right = width - margin;

  page.drawRectangle({ x: 0, y: height - 8, width, height: 8, color: forest });
  page.drawRectangle({ x: 0, y: height - 12, width, height: 4, color: lime });

  const logoBytes = await loadLogoBytes();
  if (logoBytes) {
    try {
      const logo = await doc.embedJpg(logoBytes);
      page.drawImage(logo, { x: margin, y: height - 120, width: 80, height: 80 });
    } catch {
      /* logo optional */
    }
  }

  drawRtl(page, font, params.settings.companyName || COMPANY_LEGAL_NAME, right, height - 50, 16);
  drawRtl(page, font, "فاتورة", right, height - 74, 22);
  drawRtl(page, font, `رقم الفاتورة: ${params.invoice.invoiceNumber}`, right, height - 100, 11);
  drawRtl(page, font, `التاريخ: ${formatDateAr(params.invoice.issuedAt)}`, right, height - 118, 11);
  if (params.settings.companyPhone) {
    drawRtl(page, font, `هاتف: ${params.settings.companyPhone}`, right, height - 136, 10, muted);
  }
  if (params.settings.companyAddress) {
    drawRtl(page, font, params.settings.companyAddress, right, height - 152, 10, muted);
  }

  let y = height - 190;
  drawRtl(page, font, `العميل: ${params.invoice.customerName}`, right, y, 12);
  y -= 18;
  if (params.invoice.customerPhone) {
    drawRtl(page, font, `هاتف العميل: ${params.invoice.customerPhone}`, right, y, 11, muted);
    y -= 18;
  }

  y -= 10;
  page.drawRectangle({ x: margin, y: y - 6, width: width - margin * 2, height: 24, color: forest });
  const headers = ["الوصف", "الكمية", "سعر الوحدة", "الإجمالي"];
  const cols = [right - 10, right - 250, right - 340, right - 430];
  headers.forEach((h, i) => {
    const shaped = shapeArabic(h);
    page.drawText(shaped, { x: cols[i] - font.widthOfTextAtSize(shaped, 10), y: y, size: 10, font, color: rgb(1, 1, 1) });
  });

  y -= 28;
  const currency = getCurrency(params.invoice.currency);
  for (const line of params.lines) {
    const qty = formatMinorGrouped(BigInt(line.quantityMinor), line.quantityExponent);
    const price = `${currency.symbol} ${formatMinorGrouped(BigInt(line.unitPriceMinor), currency.exponent)}`;
    const total = `${currency.symbol} ${formatMinorGrouped(BigInt(line.lineTotalMinor), currency.exponent)}`;
    const descLines = splitLines(line.description, 28);
    drawRtl(page, font, descLines[0] ?? "", cols[0], y, 10);
    drawRtl(page, font, qty, cols[1], y, 10);
    drawRtl(page, font, price, cols[2], y, 10);
    drawRtl(page, font, total, cols[3], y, 10);
    y -= 18;
    for (const extra of descLines.slice(1)) {
      drawRtl(page, font, extra, cols[0], y, 10, muted);
      y -= 14;
    }
    if (y < 160) break;
  }

  y = Math.min(y, 200);
  drawRtl(page, font, `المجموع: ${currency.symbol} ${formatMinorGrouped(BigInt(params.invoice.subtotalMinor), currency.exponent)}`, right, y, 11);
  y -= 16;
  drawRtl(page, font, `الخصم: ${currency.symbol} ${formatMinorGrouped(BigInt(params.invoice.discountMinor), currency.exponent)}`, right, y, 11);
  y -= 16;
  drawRtl(page, font, `الضريبة: ${currency.symbol} ${formatMinorGrouped(BigInt(params.invoice.taxMinor), currency.exponent)}`, right, y, 11);
  y -= 20;
  drawRtl(page, font, `الإجمالي: ${currency.symbol} ${formatMinorGrouped(BigInt(params.invoice.grandTotalMinor), currency.exponent)}`, right, y, 14);
  y -= 18;
  const payLabel = params.invoice.paymentStatus === "paid" ? "مدفوعة" : params.invoice.paymentStatus === "partial" ? "مدفوعة جزئياً" : "غير مدفوعة";
  drawRtl(page, font, `حالة التحصيل: ${payLabel}`, right, y, 11, muted);
  y -= 28;
  if (params.invoice.notes) {
    drawRtl(page, font, `ملاحظات: ${params.invoice.notes}`, right, y, 10, muted);
    y -= 20;
  }
  drawRtl(page, font, params.settings.invoiceFooter || "شكراً لتعاملكم معنا", right, 60, 10, muted);
  drawRtl(page, font, "إصدار الفاتورة لا يعني تحصيل المبلغ نقداً.", right, 44, 9, muted);

  return doc.save();
}

export async function buildStatementPdf(params: {
  person: PersonRecord;
  settings: AppSettingsRecord;
  lines: { date: string; description: string; cashIn: string; cashOut: string; advance: string }[];
  totals: { cashIn: string; cashOut: string; outstanding: string };
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(await loadFontBytes(), { subset: false });
  const page = doc.addPage([595, 842]);
  const right = 555;
  drawRtl(page, font, params.settings.companyName || COMPANY_LEGAL_NAME, right, 800, 14);
  drawRtl(page, font, `كشف حساب: ${params.person.fullName}`, right, 776, 16);
  if (params.person.phone) drawRtl(page, font, `هاتف: ${params.person.phone}`, right, 756, 11);
  let y = 720;
  for (const line of params.lines.slice(0, 28)) {
    drawRtl(page, font, `${line.date}  ${line.description}`, right, y, 9);
    y -= 14;
    drawRtl(page, font, `داخل ${line.cashIn}  خارج ${line.cashOut}  سلفة ${line.advance}`, right, y, 9, muted);
    y -= 16;
    if (y < 80) break;
  }
  drawRtl(page, font, `إجمالي المقبوض: ${params.totals.cashIn}`, right, 70, 11);
  drawRtl(page, font, `إجمالي المدفوع: ${params.totals.cashOut}`, right, 54, 11);
  drawRtl(page, font, `السلف المستحقة: ${params.totals.outstanding}`, right, 38, 12);
  return doc.save();
}

export async function buildReportPdf(title: string, rows: string[], footer: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(await loadFontBytes(), { subset: false });
  let page = doc.addPage([595, 842]);
  let y = 800;
  const right = 555;
  drawRtl(page, font, title, right, y, 16);
  y -= 28;
  for (const row of rows) {
    for (const part of splitLines(row, 70)) {
      drawRtl(page, font, part, right, y, 10);
      y -= 14;
      if (y < 50) {
        page = doc.addPage([595, 842]);
        y = 800;
      }
    }
  }
  drawRtl(page, font, footer, right, 36, 9, muted);
  return doc.save();
}

export async function shareOrDownloadPdf(bytes: Uint8Array, fileName: string): Promise<void> {
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const file = new File([blob], fileName, { type: "application/pdf" });
  const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void>; canShare?: (data: ShareData) => boolean };
  if (nav.share && (!nav.canShare || nav.canShare({ files: [file] }))) {
    try {
      await nav.share({ files: [file], title: fileName });
      return;
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
    }
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
