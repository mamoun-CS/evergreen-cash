"use client";

import { useEffect, useState } from "react";
import { formatMinorGrouped } from "@/lib/money";
import { formatDateAr } from "@/lib/time";
import { getCurrency } from "@/lib/currencies";
import {
  listLedger,
  listInvoices,
  listPeople,
  listReconciliations,
  type LedgerEventRecord,
  type InvoiceRecord,
  type PersonRecord,
  type ReconciliationRecord,
} from "@/lib/services/financeService";
import { Card, Button, Input, Select, Field } from "@/components/ui/primitives";
import { useApp } from "@/components/providers";
import {
  FileDown,
  FileSpreadsheet,
} from "lucide-react";
import { toCsv, downloadCsv } from "@/lib/csv";
import { buildReportPdf, shareOrDownloadPdf } from "@/lib/pdf/generate";

type ReportType =
  | "cash"
  | "income"
  | "expense"
  | "advances"
  | "invoices"
  | "reconciliations";

export function ReportsScreen() {
  const { bump, settings, toast } = useApp();
  const [reportType, setReportType] = useState<ReportType>("cash");
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setDate(1); // Start of month
    return d.toISOString().slice(0, 10);
  });
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10));

  const [ledger, setLedger] = useState<LedgerEventRecord[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [people, setPeople] = useState<PersonRecord[]>([]);
  const [reconciliations, setReconciliations] = useState<ReconciliationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const [led, invs, ppl, recs] = await Promise.all([
        listLedger(),
        listInvoices(),
        listPeople(true),
        listReconciliations(),
      ]);
      if (!cancelled) {
        setLedger(led);
        setInvoices(invs);
        setPeople(ppl);
        setReconciliations(recs);
        setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [bump]);

  const currency = getCurrency(settings?.defaultCurrency || "ILS");
  const exp = currency.exponent;

  // Filter helpers
  const fromIso = fromDate ? new Date(fromDate).toISOString() : "";
  const toIso = toDate ? new Date(`${toDate}T23:59:59.999Z`).toISOString() : "";

  const filteredLedger = ledger.filter((e) => {
    if (!e.reversedByEventId) {
      if (fromIso && e.occurredAt < fromIso) return false;
      if (toIso && e.occurredAt > toIso) return false;
      return true;
    }
    return false;
  });

  const filteredInvoices = invoices.filter((inv) => {
    if (fromIso && inv.issuedAt < fromIso) return false;
    if (toIso && inv.issuedAt > toIso) return false;
    return true;
  });

  const filteredReconciliations = reconciliations.filter((r) => {
    if (fromIso && r.occurredAt < fromIso) return false;
    if (toIso && r.occurredAt > toIso) return false;
    return true;
  });

  // Aggregated totals
  const totalCashIn = filteredLedger
    .filter((e) => BigInt(e.cashDeltaMinor) > 0n)
    .reduce((s, e) => s + BigInt(e.cashDeltaMinor), 0n);

  const totalCashOut = filteredLedger
    .filter((e) => BigInt(e.cashDeltaMinor) < 0n)
    .reduce((s, e) => s + -BigInt(e.cashDeltaMinor), 0n);

  const totalIncome = filteredLedger.reduce((s, e) => s + BigInt(e.incomeDeltaMinor), 0n);
  const totalExpense = filteredLedger.reduce((s, e) => s + BigInt(e.expenseDeltaMinor), 0n);
  const totalAdvances = filteredLedger.reduce((s, e) => s + BigInt(e.advanceDeltaMinor), 0n);

  // CSV Export
  async function handleExportCsv() {
    let headers: string[] = [];
    let rows: Array<Array<string | number>> = [];
    const fileName = `report-${reportType}-${fromDate}-to-${toDate}.csv`;

    if (reportType === "cash" || reportType === "income" || reportType === "expense" || reportType === "advances") {
      headers = ["التاريخ", "رقم الحركة", "الوصف", "التصنيف", "الشخص", "داخل (+)", "خارج (-)", "أثر السلفة", "الأثر على الدخل", "الأثر على المصروف"];
      rows = filteredLedger.map((e) => {
        const p = people.find((person) => person.id === e.personId);
        return [
          formatDateAr(e.occurredAt),
          e.transactionId,
          e.description,
          e.category || "",
          p?.fullName || "",
          formatMinorGrouped(BigInt(e.cashDeltaMinor), exp),
          formatMinorGrouped(BigInt(e.cashDeltaMinor) < 0n ? -BigInt(e.cashDeltaMinor) : 0n, exp),
          formatMinorGrouped(BigInt(e.advanceDeltaMinor), exp),
          formatMinorGrouped(BigInt(e.incomeDeltaMinor), exp),
          formatMinorGrouped(BigInt(e.expenseDeltaMinor), exp),
        ];
      });
    } else if (reportType === "invoices") {
      headers = ["رقم الفاتورة", "التاريخ", "العميل", "الهاتف", "المجموع الفرعي", "الخصم", "الضريبة", "الإجمالي", "المحصل", "الحالة", "حالة الدفع"];
      rows = filteredInvoices.map((inv) => [
        inv.invoiceNumber,
        formatDateAr(inv.issuedAt),
        inv.customerName,
        inv.customerPhone || "",
        formatMinorGrouped(BigInt(inv.subtotalMinor), exp),
        formatMinorGrouped(BigInt(inv.discountMinor), exp),
        formatMinorGrouped(BigInt(inv.taxMinor), exp),
        formatMinorGrouped(BigInt(inv.grandTotalMinor), exp),
        formatMinorGrouped(BigInt(inv.collectedMinor), exp),
        inv.status,
        inv.paymentStatus,
      ]);
    } else if (reportType === "reconciliations") {
      headers = ["تاريخ الجرد", "الرصيد المتوقع", "الرصيد الفعلي", "فرق الجرد", "ملاحظات"];
      rows = filteredReconciliations.map((r) => [
        formatDateAr(r.occurredAt),
        formatMinorGrouped(BigInt(r.expectedMinor), exp),
        formatMinorGrouped(BigInt(r.countedMinor), exp),
        formatMinorGrouped(BigInt(r.differenceMinor), exp),
        r.notes || "",
      ]);
    }

    const csvContent = toCsv(headers, rows);
    try {
      await downloadCsv(fileName, csvContent);
    } catch {
      toast("تعذر مشاركة أو تنزيل ملف CSV", "err");
    }
  }

  // PDF Export
  async function handleExportPdf() {
    if (!settings) return;
    try {
      setExporting(true);
      let title = "تقرير مالي شامل";
      const rows: string[] = [];

      if (reportType === "cash") {
        title = `تقرير حركة الصندوق (${fromDate} إلى ${toDate})`;
        rows.push(`إجمالي المقبوضات النقدية: ${currency.symbol} ${formatMinorGrouped(totalCashIn, exp)}`);
        rows.push(`إجمالي المدفوعات النقدية: ${currency.symbol} ${formatMinorGrouped(totalCashOut, exp)}`);
        rows.push(`صافي حركة الصندوق: ${currency.symbol} ${formatMinorGrouped(totalCashIn - totalCashOut, exp)}`);
        rows.push("--- تفاصيل الحركات ---");
        filteredLedger.forEach((e) => {
          rows.push(`${formatDateAr(e.occurredAt)} | ${e.description} | أثر نقد: ${formatMinorGrouped(BigInt(e.cashDeltaMinor), exp)}`);
        });
      } else if (reportType === "income") {
        title = `تقرير الإيرادات والمقبوضات (${fromDate} إلى ${toDate})`;
        rows.push(`إجمالي الإيرادات المحققة: ${currency.symbol} ${formatMinorGrouped(totalIncome, exp)}`);
        filteredLedger
          .filter((e) => BigInt(e.incomeDeltaMinor) > 0n)
          .forEach((e) => {
            rows.push(`${formatDateAr(e.occurredAt)} | ${e.description} | ${formatMinorGrouped(BigInt(e.incomeDeltaMinor), exp)}`);
          });
      } else if (reportType === "expense") {
        title = `تقرير المصروفات والنفقات (${fromDate} إلى ${toDate})`;
        rows.push(`إجمالي المصروفات: ${currency.symbol} ${formatMinorGrouped(totalExpense, exp)}`);
        filteredLedger
          .filter((e) => BigInt(e.expenseDeltaMinor) > 0n)
          .forEach((e) => {
            rows.push(`${formatDateAr(e.occurredAt)} | ${e.description} | ${formatMinorGrouped(BigInt(e.expenseDeltaMinor), exp)}`);
          });
      } else if (reportType === "advances") {
        title = `تقرير حركة السلف والعهد (${fromDate} إلى ${toDate})`;
        rows.push(`رصيد السلف الصافي في هذه الفترة: ${currency.symbol} ${formatMinorGrouped(totalAdvances, exp)}`);
        filteredLedger
          .filter((e) => BigInt(e.advanceDeltaMinor) !== 0n)
          .forEach((e) => {
            const p = people.find((person) => person.id === e.personId);
            rows.push(`${formatDateAr(e.occurredAt)} | ${p?.fullName || "غير محدد"} | ${e.description} | ${formatMinorGrouped(BigInt(e.advanceDeltaMinor), exp)}`);
          });
      } else if (reportType === "invoices") {
        title = `تقرير الفواتير الصادرة (${fromDate} إلى ${toDate})`;
        filteredInvoices.forEach((inv) => {
          rows.push(`${inv.invoiceNumber} | ${inv.customerName} | تاريخ: ${formatDateAr(inv.issuedAt)} | الإجمالي: ${formatMinorGrouped(BigInt(inv.grandTotalMinor), exp)} | المحصل: ${formatMinorGrouped(BigInt(inv.collectedMinor), exp)}`);
        });
      }

      const bytes = await buildReportPdf(
        title,
        rows,
        `شركة ${settings.companyName || "إيفر غرين"} — تقرير مستخرج في ${formatDateAr(new Date().toISOString())}`
      );
      await shareOrDownloadPdf(bytes, `${reportType}-report.pdf`);
    } catch (e) {
      console.error(e);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-forest-900 sm:text-3xl">التقارير المالية والتحليلية</h1>
          <p className="text-sm text-muted">استخراج تقارير الصندوق، المقبوضات، المصروفات، والسلف، مع التصدير إلى PDF و CSV</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={handleExportCsv} className="flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4" />
            تصدير CSV
          </Button>
          <Button onClick={handleExportPdf} disabled={exporting} className="flex items-center gap-2">
            <FileDown className="h-4 w-4" />
            {exporting ? "تصدير..." : "تصدير PDF"}
          </Button>
        </div>
      </div>

      {/* Filter and Configuration Card */}
      <Card>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="نوع التقرير">
            <Select value={reportType} onChange={(e) => setReportType(e.target.value as ReportType)}>
              <option value="cash">تقرير حركة الصندوق الإجمالية</option>
              <option value="income">تقرير المقبوضات والإيرادات</option>
              <option value="expense">تقرير المصروفات والنفقات</option>
              <option value="advances">تقرير السلف والعهد للموظفين</option>
              <option value="invoices">تقرير الفواتير والتحصيل</option>
              <option value="reconciliations">تقرير مطابقة الجرد الدوري</option>
            </Select>
          </Field>

          <Field label="من تاريخ">
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </Field>

          <Field label="إلى تاريخ">
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </Field>
        </div>
      </Card>

      {/* Key Metric Highlights for Selected Period */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <Card className="!bg-forest-950 !text-white border-2 border-forest-900 p-5 shadow-sm">
          <span className="text-xs text-emerald-100 font-medium">المقبوضات النقدية</span>
          <p className="text-2xl font-bold mt-1 text-lime-400">
            {currency.symbol} {formatMinorGrouped(totalCashIn, exp)}
          </p>
        </Card>
        <Card className="bg-white p-5 border border-forest-900/10">
          <span className="text-xs text-muted">المدفوعات النقدية</span>
          <p className="text-2xl font-bold mt-1 text-danger">
            {currency.symbol} {formatMinorGrouped(totalCashOut, exp)}
          </p>
        </Card>
        <Card className="bg-white p-5 border border-forest-900/10">
          <span className="text-xs text-muted">الإيرادات المحققة</span>
          <p className="text-2xl font-bold mt-1 text-forest-800">
            {currency.symbol} {formatMinorGrouped(totalIncome, exp)}
          </p>
        </Card>
        <Card className="bg-white p-5 border border-forest-900/10">
          <span className="text-xs text-muted">المصروفات المحققة</span>
          <p className="text-2xl font-bold mt-1 text-forest-900">
            {currency.symbol} {formatMinorGrouped(totalExpense, exp)}
          </p>
        </Card>
      </div>

      {/* Report Data Table */}
      <Card>
        <div className="flex items-center justify-between mb-4 border-b border-forest-900/10 pb-3">
          <h2 className="text-lg font-bold text-forest-900">
            جدول البيانات المالية للتقرير ({filteredLedger.length} سجل)
          </h2>
          <span className="text-xs text-muted">الفترة: {fromDate} إلى {toDate}</span>
        </div>

        {loading ? (
          <p className="py-8 text-center text-sm text-muted">جاري تحميل البيانات...</p>
        ) : filteredLedger.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">لا توجد حركات في الفترة المحددة.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-cream border-b border-forest-900/10 font-bold text-forest-900">
                <tr>
                  <th className="p-3">التاريخ</th>
                  <th className="p-3">النوع والوصف</th>
                  <th className="p-3">الشخص / التصنيف</th>
                  <th className="p-3">أثر النقد</th>
                  <th className="p-3">أثر السلفة</th>
                  <th className="p-3">أثر الأرباح/المصروف</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-forest-900/10">
                {filteredLedger.map((e) => {
                  const p = people.find((person) => person.id === e.personId);
                  const cashDelta = BigInt(e.cashDeltaMinor);
                  const advDelta = BigInt(e.advanceDeltaMinor);
                  return (
                    <tr key={e.id} className="hover:bg-cream/40">
                      <td className="p-3 text-muted">{formatDateAr(e.occurredAt)}</td>
                      <td className="p-3">
                        <p className="font-semibold text-forest-900">{e.description}</p>
                        <span className="text-[10px] text-muted">#{e.sequence} • {e.type}</span>
                      </td>
                      <td className="p-3 text-muted">
                        {p ? <span className="font-semibold text-forest-800">{p.fullName}</span> : "-"}
                        {e.category ? <span className="block text-[10px]">[{e.category}]</span> : null}
                      </td>
                      <td className="p-3 font-mono font-bold">
                        <span className={cashDelta > 0n ? "text-forest-800" : cashDelta < 0n ? "text-danger" : "text-muted"}>
                          {cashDelta > 0n ? `+${formatMinorGrouped(cashDelta, exp)}` : cashDelta < 0n ? formatMinorGrouped(cashDelta, exp) : "0.00"}
                        </span>
                      </td>
                      <td className="p-3 font-mono">
                        {advDelta !== 0n ? `${formatMinorGrouped(advDelta, exp)}` : "-"}
                      </td>
                      <td className="p-3 font-mono">
                        {BigInt(e.incomeDeltaMinor) > 0n ? (
                          <span className="text-forest-700 font-semibold">دخل: +{formatMinorGrouped(BigInt(e.incomeDeltaMinor), exp)}</span>
                        ) : BigInt(e.expenseDeltaMinor) > 0n ? (
                          <span className="text-danger font-semibold">مصروف: {formatMinorGrouped(BigInt(e.expenseDeltaMinor), exp)}</span>
                        ) : (
                          "-"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
