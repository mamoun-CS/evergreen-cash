"use client";

import { useEffect, useState } from "react";
import { formatMinorGrouped, parseMajorToMinor } from "@/lib/money";
import { formatDateAr } from "@/lib/time";
import { getCurrency } from "@/lib/currencies";
import {
  createReconciliation,
  listReconciliations,
  dashboardSummary,
  type ReconciliationRecord,
} from "@/lib/services/financeService";
import { Card, Button, Input, Textarea, Field, EmptyState } from "@/components/ui/primitives";
import { useApp } from "@/components/providers";
import {
  Scale,
  Plus,
  AlertTriangle,
  CheckCircle,
  FileDown,
  X,
} from "lucide-react";
import { buildReportPdf, shareOrDownloadPdf } from "@/lib/pdf/generate";

export function ReconcileScreen() {
  const { bump, refresh, toast, settings, notifyDataChanged } = useApp();
  const [reconciliations, setReconciliations] = useState<ReconciliationRecord[]>([]);
  const [expectedMinor, setExpectedMinor] = useState<bigint>(0n);
  const [modalOpen, setModalOpen] = useState(false);

  // Form states
  const [countedAmount, setCountedAmount] = useState("");
  const [occurredAt, setOccurredAt] = useState(new Date().toISOString().slice(0, 16));
  const [notes, setNotes] = useState("");
  const [createAdjustment, setCreateAdjustment] = useState(true);
  const [adjustmentNotes, setAdjustmentNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [list, summary] = await Promise.all([listReconciliations(), dashboardSummary()]);
      if (!cancelled) {
        setReconciliations(list);
        setExpectedMinor(summary.cash);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [bump]);

  const currency = getCurrency(settings?.defaultCurrency || "ILS");
  const exp = currency.exponent;

  // Real-time difference preview
  let countedMinor = 0n;
  let parsedDifference = 0n;
  try {
    if (countedAmount.trim()) {
      countedMinor = parseMajorToMinor(countedAmount, exp);
      parsedDifference = countedMinor - expectedMinor;
    }
  } catch {
    // Ignore formatting input errors during typing
  }

  function openModal() {
    setCountedAmount("");
    setOccurredAt(new Date().toISOString().slice(0, 16));
    setNotes("");
    setCreateAdjustment(true);
    setAdjustmentNotes("");
    setModalOpen(true);
  }

  async function handleSaveReconciliation(e: React.FormEvent) {
    e.preventDefault();
    if (!countedAmount.trim()) {
      toast("يرجى إدخال المبلغ الفعلي المعدود", "warn");
      return;
    }

    try {
      setSubmitting(true);
      const counted = parseMajorToMinor(countedAmount, exp);
      const diff = counted - expectedMinor;

      if (diff !== 0n && createAdjustment) {
        const confirmMsg =
          diff > 0n
            ? `يوجد زيادة بقيمة (${currency.symbol} ${formatMinorGrouped(diff, exp)}). هل تؤكد قيد تسوية رصيد الصندوق بالزيادة؟`
            : `يوجد عجز بقيمة (${currency.symbol} ${formatMinorGrouped(-diff, exp)}). هل تؤكد قيد تسوية رصيد الصندوق بالنقص؟`;
        if (!confirm(confirmMsg)) {
          setSubmitting(false);
          return;
        }
      }

      await createReconciliation({
        occurredAt: new Date(occurredAt).toISOString(),
        countedMinor: counted,
        notes: notes || undefined,
        createAdjustment,
        adjustmentNotes: adjustmentNotes || undefined,
      });

      toast("تم تسجيل عملية الجرد وتحديث السجل المالي بنجاح", "ok");
      setModalOpen(false);
      await refresh();
      notifyDataChanged();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "فشل تسجيل الجرد";
      toast(msg, "err");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleExportReportPdf() {
    if (!settings) return;
    try {
      setExportingPdf(true);
      const rows = reconciliations.map((r) => {
        const diff = BigInt(r.differenceMinor);
        const diffStr =
          diff === 0n
            ? "مطابق تماماً (0)"
            : diff > 0n
            ? `زيادة +${formatMinorGrouped(diff, exp)}`
            : `عجز ${formatMinorGrouped(diff, exp)}`;
        return `${formatDateAr(r.occurredAt)} | متوقع: ${formatMinorGrouped(BigInt(r.expectedMinor), exp)} | فعلي: ${formatMinorGrouped(BigInt(r.countedMinor), exp)} | الفرق: ${diffStr} ${currency.symbol}`;
      });

      const bytes = await buildReportPdf(
        "تقرير مطابقة وجرد الصندوق النقدي",
        rows,
        `تاريخ التقرير: ${formatDateAr(new Date().toISOString())} — ${settings.companyName}`
      );
      await shareOrDownloadPdf(bytes, "cash-reconciliations-report.pdf");
      toast("تم تصدير تقرير الجرد بنجاح", "ok");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "فشل تصدير التقرير";
      toast(msg, "err");
    } finally {
      setExportingPdf(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-forest-900 sm:text-3xl">الجرد ومطابقة الصندوق</h1>
          <p className="text-sm text-muted">
            مطابقة النقد الفعلي في الخزينة مع الرصيد المحاسبي وتسوية الفروقات بدقة
          </p>
        </div>
        <div className="flex items-center gap-2">
          {reconciliations.length > 0 && (
            <Button
              variant="secondary"
              onClick={handleExportReportPdf}
              disabled={exportingPdf}
              className="flex items-center gap-2"
            >
              <FileDown className="h-4 w-4" />
              {exportingPdf ? "تصدير..." : "تصدير التقرير PDF"}
            </Button>
          )}
          <Button onClick={openModal} className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            جرد نقدي جديد
          </Button>
        </div>
      </div>

      {/* Current Ledger Expected Balance Banner */}
      <Card className="!bg-forest-950 !text-white border-2 border-forest-900 p-6 shadow-md">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <span className="text-xs font-semibold text-emerald-100">رصيد الصندوق المتوقع حسابياً الآن</span>
            <p className="text-3xl font-extrabold mt-1 tracking-tight !text-lime-400 drop-shadow-sm">
              {currency.symbol} {formatMinorGrouped(expectedMinor, exp)}
            </p>
            <p className="text-xs font-medium text-emerald-200/90 mt-1">
              محسوب مباشرة من السجل المالي التراكمي (Append-only Ledger)
            </p>
          </div>
          <Button
            onClick={openModal}
            variant="primary"
            className="!bg-lime-500 !text-forest-950 hover:!bg-lime-400 font-bold px-6 py-3 rounded-2xl shadow-sm"
          >
            بدء عد النقد الآن
          </Button>
        </div>
      </Card>

      {/* Reconciliation History Table */}
      <Card>
        <h2 className="text-lg font-bold text-forest-900 mb-4">سجل عمليات الجرد السابقة</h2>
        {reconciliations.length === 0 ? (
          <EmptyState
            icon={Scale}
            title="لا توجد عمليات جرد سابقة"
            description="قم بإجراء أول عملية جرد نقدي لمطابقة الخزينة وحفظ سلامة السجلات المالية."
            action={
              <Button onClick={openModal} variant="primary">
                إجراء جرد الآن
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="border-b border-forest-900/10 text-xs font-bold text-forest-900">
                <tr>
                  <th className="py-3 px-2">تاريخ الجرد</th>
                  <th className="py-3 px-2">الرصيد المتوقع</th>
                  <th className="py-3 px-2">الرصيد الفعلي المعدود</th>
                  <th className="py-3 px-2">فرق الجرد</th>
                  <th className="py-3 px-2">التسوية الآلية</th>
                  <th className="py-3 px-2">ملاحظات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-forest-900/10">
                {reconciliations.map((rec) => {
                  const diff = BigInt(rec.differenceMinor);
                  const isMatch = diff === 0n;
                  const isSurplus = diff > 0n;
                  return (
                    <tr key={rec.id} className="hover:bg-cream/40 transition">
                      <td className="py-3 px-2 text-muted">{formatDateAr(rec.occurredAt)}</td>
                      <td className="py-3 px-2 font-mono font-semibold text-forest-900">
                        {currency.symbol} {formatMinorGrouped(BigInt(rec.expectedMinor), exp)}
                      </td>
                      <td className="py-3 px-2 font-mono font-bold text-forest-950">
                        {currency.symbol} {formatMinorGrouped(BigInt(rec.countedMinor), exp)}
                      </td>
                      <td className="py-3 px-2">
                        <span
                          className={`inline-flex items-center gap-1 rounded-xl px-2.5 py-1 text-xs font-bold ${
                            isMatch
                              ? "bg-forest-100 text-forest-800"
                              : isSurplus
                              ? "bg-amber-100 text-amber-800"
                              : "bg-red-100 text-danger"
                          }`}
                        >
                          {isMatch ? (
                            <>
                              <CheckCircle className="h-3.5 w-3.5" />
                              مطابق تماماً
                            </>
                          ) : isSurplus ? (
                            <>
                              <AlertTriangle className="h-3.5 w-3.5" />
                              زيادة +{currency.symbol} {formatMinorGrouped(diff, exp)}
                            </>
                          ) : (
                            <>
                              <AlertTriangle className="h-3.5 w-3.5" />
                              عجز {currency.symbol} {formatMinorGrouped(-diff, exp)}
                            </>
                          )}
                        </span>
                      </td>
                      <td className="py-3 px-2 text-xs">
                        {rec.adjustmentTransactionId ? (
                          <span className="text-forest-700 font-semibold">تم إنشاء قيد تسوية</span>
                        ) : isMatch ? (
                          <span className="text-muted">لا يلزم تسوية</span>
                        ) : (
                          <span className="text-muted">لم يتم قيد تسوية</span>
                        )}
                      </td>
                      <td className="py-3 px-2 text-xs text-muted max-w-xs truncate">
                        {rec.notes || "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Reconciliation Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-forest-950/60 p-4">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-forest-900/10 pb-4">
              <h2 className="text-xl font-bold text-forest-900">عملية جرد نقدي ومطابقة</h2>
              <Button variant="ghost" size="sm" onClick={() => setModalOpen(false)}>
                <X className="h-5 w-5" />
              </Button>
            </div>

            <form onSubmit={handleSaveReconciliation} className="mt-4 space-y-4">
              <div className="rounded-2xl bg-cream/70 p-4 border border-forest-900/10">
                <span className="text-xs text-muted">الرصيد الدفتري المتوقع:</span>
                <p className="text-2xl font-bold text-forest-900 mt-1">
                  {currency.symbol} {formatMinorGrouped(expectedMinor, exp)}
                </p>
              </div>

              <Field label="النقد الفعلي المعدود في الخزينة *">
                <Input
                  required
                  type="number"
                  step="0.01"
                  min="0"
                  autoFocus
                  placeholder="أدخل المبلغ بعد العد اليدوي..."
                  value={countedAmount}
                  onChange={(e) => setCountedAmount(e.target.value)}
                />
              </Field>

              {countedAmount.trim() && (
                <div
                  className={`rounded-2xl p-4 border text-sm font-semibold flex items-center justify-between ${
                    parsedDifference === 0n
                      ? "bg-forest-50 border-forest-600/30 text-forest-800"
                      : parsedDifference > 0n
                      ? "bg-amber-50 border-amber-600/30 text-amber-900"
                      : "bg-red-50 border-red-600/30 text-danger"
                  }`}
                >
                  <span>فرق الجرد:</span>
                  <span className="text-lg font-bold font-mono">
                    {parsedDifference === 0n
                      ? "مطابق تماماً (لا يوجد فرق)"
                      : parsedDifference > 0n
                      ? `زيادة: +${currency.symbol} ${formatMinorGrouped(parsedDifference, exp)}`
                      : `عجز: -${currency.symbol} ${formatMinorGrouped(-parsedDifference, exp)}`}
                  </span>
                </div>
              )}

              <Field label="تاريخ ووقت الجرد">
                <Input
                  type="datetime-local"
                  value={occurredAt}
                  onChange={(e) => setOccurredAt(e.target.value)}
                />
              </Field>

              {parsedDifference !== 0n && countedAmount.trim() && (
                <div className="rounded-2xl bg-amber-500/10 p-4 border border-amber-500/20 space-y-3">
                  <label className="flex items-center gap-2 cursor-pointer text-sm font-bold text-forest-950">
                    <input
                      type="checkbox"
                      checked={createAdjustment}
                      onChange={(e) => setCreateAdjustment(e.target.checked)}
                      className="h-4 w-4 rounded accent-forest-900"
                    />
                    إنشاء حركة تسوية مالية تلقائياً لتحديث رصيد الصندوق
                  </label>
                  {createAdjustment && (
                    <Input
                      placeholder="بيان حركة التسوية (مثال: تسوية فرق جرد نقدي)"
                      value={adjustmentNotes}
                      onChange={(e) => setAdjustmentNotes(e.target.value)}
                    />
                  )}
                </div>
              )}

              <Field label="ملاحظات الجرد">
                <Textarea
                  placeholder="ملاحظات إضافية حول عملية الجرد..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                />
              </Field>

              <div className="mt-6 flex justify-end gap-2 border-t border-forest-900/10 pt-4">
                <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
                  إلغاء
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? "جاري الحفظ..." : "تأكيد وتسجيل الجرد"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
