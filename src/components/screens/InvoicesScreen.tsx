"use client";

import { useEffect, useState } from "react";
import { formatMinorGrouped, formatMinor, parseMajorToMinor } from "@/lib/money";
import { formatDateAr } from "@/lib/time";
import { getCurrency } from "@/lib/currencies";
import {
  listInvoices,
  getInvoiceWithLines,
  saveInvoice,
  cancelInvoice,
  duplicateInvoice,
  listPeople,
  type InvoiceRecord,
  type InvoiceLineRecord,
  type PersonRecord,
  type InvoiceDraftLine,
} from "@/lib/services/financeService";
import { Card, Button, Input, Select, Textarea, Field, EmptyState } from "@/components/ui/primitives";
import { useApp } from "@/components/providers";
import {
  FileText,
  Plus,
  Search,
  FileDown,
  Copy,
  Ban,
  Eye,
  Trash2,
  X,
  CreditCard,
} from "lucide-react";
import { buildInvoicePdf, shareOrDownloadPdf } from "@/lib/pdf/generate";
import Link from "next/link";

export function InvoicesScreen() {
  const { bump, refresh, toast, settings } = useApp();
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [people, setPeople] = useState<PersonRecord[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Create / Edit modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [issuedAt, setIssuedAt] = useState(new Date().toISOString().slice(0, 10));
  const [discount, setDiscount] = useState("0");
  const [tax, setTax] = useState("0");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<InvoiceDraftLine[]>([
    { description: "", quantity: "1", unitPrice: "0" },
  ]);
  const [submitting, setSubmitting] = useState(false);

  // View invoice modal state
  const [viewInvoice, setViewInvoice] = useState<{
    invoice: InvoiceRecord;
    lines: InvoiceLineRecord[];
  } | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);

  // Cancel invoice modal state
  const [cancelModalInvoice, setCancelModalInvoice] = useState<InvoiceRecord | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [invs, ppl] = await Promise.all([listInvoices(), listPeople()]);
      if (!cancelled) {
        setInvoices(invs);
        setPeople(ppl);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [bump]);

  const currency = getCurrency(settings?.defaultCurrency || "ILS");
  const exp = currency.exponent;

  const filtered = invoices.filter((inv) => {
    const matchesSearch =
      inv.invoiceNumber.toLowerCase().includes(search.toLowerCase()) ||
      inv.customerName.toLowerCase().includes(search.toLowerCase());
    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "draft" && inv.status === "draft") ||
      (statusFilter === "finalized" && inv.status === "finalized") ||
      (statusFilter === "canceled" && inv.status === "canceled") ||
      (statusFilter === "unpaid" && inv.paymentStatus === "unpaid") ||
      (statusFilter === "paid" && inv.paymentStatus === "paid");
    return matchesSearch && matchesStatus;
  });

  function openCreateModal() {
    setEditingInvoiceId(null);
    setCustomerId("");
    setCustomerName("");
    setCustomerPhone("");
    setIssuedAt(new Date().toISOString().slice(0, 10));
    setDiscount("0");
    setTax("0");
    setNotes("");
    setLines([{ description: "", quantity: "1", unitPrice: "0" }]);
    setModalOpen(true);
  }

  async function openEditModal(inv: InvoiceRecord) {
    if (inv.status === "canceled") {
      toast("لا يمكن تعديل فاتورة ملغاة", "warn");
      return;
    }
    try {
      const full = await getInvoiceWithLines(inv.id);
      setEditingInvoiceId(inv.id);
      setCustomerId(inv.customerId || "");
      setCustomerName(inv.customerName);
      setCustomerPhone(inv.customerPhone || "");
      setIssuedAt(inv.issuedAt.slice(0, 10));
      setDiscount(formatMinor(BigInt(inv.discountMinor), exp));
      setTax(formatMinor(BigInt(inv.taxMinor), exp));
      setNotes(inv.notes || "");
      setLines(
        full.lines.map((l) => ({
          description: l.description,
          quantity: formatMinor(BigInt(l.quantityMinor), l.quantityExponent),
          unitPrice: formatMinor(BigInt(l.unitPriceMinor), exp),
        }))
      );
      setModalOpen(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "فشل تحميل الفاتورة للتعديل";
      toast(msg, "err");
    }
  }

  async function openViewModal(invId: string) {
    try {
      const full = await getInvoiceWithLines(invId);
      setViewInvoice(full);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "فشل تحميل تفاصيل الفاتورة";
      toast(msg, "err");
    }
  }

  function handleAddLine() {
    setLines((cur) => [...cur, { description: "", quantity: "1", unitPrice: "0" }]);
  }

  function handleRemoveLine(index: number) {
    if (lines.length <= 1) return;
    setLines((cur) => cur.filter((_, i) => i !== index));
  }

  function handleLineChange(index: number, field: keyof InvoiceDraftLine, value: string) {
    setLines((cur) => {
      const copy = [...cur];
      copy[index] = { ...copy[index], [field]: value };
      return copy;
    });
  }

  function handlePersonSelect(personId: string) {
    setCustomerId(personId);
    if (!personId) return;
    const person = people.find((p) => p.id === personId);
    if (person) {
      setCustomerName(person.fullName);
      if (person.phone) setCustomerPhone(person.phone);
    }
  }

  async function handleSave(finalize: boolean) {
    if (!customerName.trim()) {
      toast("يرجى إدخال اسم العميل", "warn");
      return;
    }
    if (lines.some((l) => !l.description.trim())) {
      toast("يرجى إدخال وصف لجميع البنود", "warn");
      return;
    }

    try {
      setSubmitting(true);
      const discountMinor = parseMajorToMinor(discount || "0", exp);
      const taxMinor = parseMajorToMinor(tax || "0", exp);

      await saveInvoice({
        id: editingInvoiceId || undefined,
        customerId: customerId || undefined,
        customerName,
        customerPhone: customerPhone || undefined,
        issuedAt: new Date(issuedAt).toISOString(),
        discountMinor,
        taxMinor,
        notes: notes || undefined,
        lines,
        finalize,
      });

      toast(finalize ? "تم اعتماد الفاتورة بنجاح" : "تم حفظ الفاتورة كمسودة", "ok");
      setModalOpen(false);
      await refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "فشل حفظ الفاتورة";
      toast(msg, "err");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDuplicate(id: string) {
    try {
      await duplicateInvoice(id);
      toast("تم تكرار الفاتورة كمسودة جديدة", "ok");
      await refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "فشل تكرار الفاتورة";
      toast(msg, "err");
    }
  }

  async function handleCancelInvoice() {
    if (!cancelModalInvoice) return;
    try {
      setSubmitting(true);
      await cancelInvoice(cancelModalInvoice.id, cancelReason || "إلغاء من قبل المستخدم");
      toast("تم إلغاء الفاتورة بنجاح", "ok");
      setCancelModalInvoice(null);
      setCancelReason("");
      await refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "فشل إلغاء الفاتورة";
      toast(msg, "err");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleExportPdf(inv: InvoiceRecord) {
    if (!settings) return;
    try {
      setExportingPdf(true);
      const full = await getInvoiceWithLines(inv.id);
      const bytes = await buildInvoicePdf({
        invoice: full.invoice,
        lines: full.lines,
        settings,
      });
      await shareOrDownloadPdf(bytes, `${full.invoice.invoiceNumber}.pdf`);
      toast("تم تصدير الفاتورة بنجاح", "ok");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "فشل تصدير الفاتورة إلى PDF";
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
          <h1 className="text-2xl font-bold text-forest-900 sm:text-3xl">إدارة الفواتير والخدمات</h1>
          <p className="text-sm text-muted">إصدار واعتماد الفواتير، تصدير PDF باللغة العربية، ومتابعة التحصيل النقدي</p>
        </div>
        <Button onClick={openCreateModal} className="flex items-center gap-2">
          <Plus className="h-5 w-5" />
          إنشاء فاتورة جديدة
        </Button>
      </div>

      {/* Filter Bar */}
      <Card>
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="relative flex-1">
            <Search className="absolute right-3.5 top-3.5 h-4 w-4 text-muted" />
            <Input
              type="text"
              placeholder="البحث برقم الفاتورة أو اسم العميل..."
              className="pr-10"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">جميع الحالات</option>
              <option value="draft">مسودة</option>
              <option value="finalized">معتمدة</option>
              <option value="unpaid">غير مدفوعة</option>
              <option value="paid">مدفوعة بالكامل</option>
              <option value="canceled">ملغاة</option>
            </Select>
          </div>
        </div>
      </Card>

      {/* Invoices Table */}
      <Card>
        {filtered.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="لا توجد فواتير"
            description={search ? "لا توجد نتائج تطابق بحثك." : "ابدأ بإنشاء أول فاتورة لعملائك ومقاولي الخدمات."}
            action={
              !search ? (
                <Button onClick={openCreateModal} variant="primary">
                  إنشاء فاتورة الآن
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="border-b border-forest-900/10 text-xs font-bold text-forest-900">
                <tr>
                  <th className="py-3 px-2">رقم الفاتورة</th>
                  <th className="py-3 px-2">العميل</th>
                  <th className="py-3 px-2">التاريخ</th>
                  <th className="py-3 px-2">الحالة</th>
                  <th className="py-3 px-2">الإجمالي</th>
                  <th className="py-3 px-2">التحصيل</th>
                  <th className="py-3 px-2 text-center">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-forest-900/10">
                {filtered.map((inv) => (
                  <tr key={inv.id} className="hover:bg-cream/40 transition">
                    <td className="py-3.5 px-2 font-mono font-bold text-forest-950">
                      {inv.invoiceNumber}
                    </td>
                    <td className="py-3.5 px-2">
                      <p className="font-semibold text-forest-900">{inv.customerName}</p>
                      {inv.customerPhone ? (
                        <p className="text-xs text-muted" dir="ltr">{inv.customerPhone}</p>
                      ) : null}
                    </td>
                    <td className="py-3.5 px-2 text-muted">{formatDateAr(inv.issuedAt)}</td>
                    <td className="py-3.5 px-2">
                      <span
                        className={`inline-block rounded-xl px-2.5 py-1 text-xs font-semibold ${
                          inv.status === "finalized"
                            ? "bg-forest-100 text-forest-900"
                            : inv.status === "draft"
                            ? "bg-amber-100 text-amber-900"
                            : "bg-red-100 text-danger"
                        }`}
                      >
                        {inv.status === "finalized" ? "معتمدة" : inv.status === "draft" ? "مسودة" : "ملغاة"}
                      </span>
                    </td>
                    <td className="py-3.5 px-2 font-mono font-bold text-forest-900">
                      {currency.symbol} {formatMinorGrouped(BigInt(inv.grandTotalMinor), exp)}
                    </td>
                    <td className="py-3.5 px-2">
                      <div className="flex flex-col gap-0.5">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                            inv.paymentStatus === "paid"
                              ? "bg-forest-100 text-forest-800"
                              : inv.paymentStatus === "partial"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-red-50 text-danger"
                          }`}
                        >
                          {inv.paymentStatus === "paid"
                            ? "مدفوعة بالكامل"
                            : inv.paymentStatus === "partial"
                            ? `جزئي (${currency.symbol} ${formatMinorGrouped(BigInt(inv.collectedMinor), exp)})`
                            : "غير مدفوعة"}
                        </span>
                        {inv.status === "finalized" && inv.paymentStatus !== "paid" && (
                          <Link
                            href={`/transactions?new=income`}
                            className="text-[10px] text-forest-700 hover:underline flex items-center gap-1"
                          >
                            <CreditCard className="h-3 w-3" />
                            قبض نقدي
                          </Link>
                        )}
                      </div>
                    </td>
                    <td className="py-3.5 px-2">
                      <div className="flex items-center justify-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openViewModal(inv.id)}
                          title="عرض الفاتورة"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleExportPdf(inv)}
                          disabled={exportingPdf}
                          title="تصدير PDF ومشاركة"
                        >
                          <FileDown className="h-4 w-4" />
                        </Button>
                        {inv.status === "draft" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEditModal(inv)}
                            title="تعديل المسودة"
                          >
                            تعديل
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDuplicate(inv.id)}
                          title="تكرار الفاتورة"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                        {inv.status !== "canceled" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setCancelModalInvoice(inv);
                              setCancelReason("");
                            }}
                            className="text-muted hover:text-danger"
                            title="إلغاء الفاتورة"
                          >
                            <Ban className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Create / Edit Invoice Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-forest-950/60 p-4">
          <div className="w-full max-w-4xl max-h-[92vh] flex flex-col rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-forest-900/10 pb-4">
              <h2 className="text-xl font-bold text-forest-900">
                {editingInvoiceId ? "تعديل فاتورة" : "إنشاء فاتورة جديدة"}
              </h2>
              <Button variant="ghost" size="sm" onClick={() => setModalOpen(false)}>
                <X className="h-5 w-5" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto py-4 space-y-4">
              {/* Customer Info */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Field label="اختيار عميل مسجل">
                  <Select value={customerId} onChange={(e) => handlePersonSelect(e.target.value)}>
                    <option value="">-- عميل يدوي جديد --</option>
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.fullName} {p.phone ? `(${p.phone})` : ""}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label="اسم العميل *">
                  <Input
                    required
                    placeholder="اسم العميل أو الجهة"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                  />
                </Field>

                <Field label="رقم هاتف العميل">
                  <Input
                    type="tel"
                    placeholder="059xxxxxxx"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Field label="تاريخ الفاتورة">
                  <Input
                    type="date"
                    value={issuedAt}
                    onChange={(e) => setIssuedAt(e.target.value)}
                  />
                </Field>
                <Field label="الخصم (₪)">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={discount}
                    onChange={(e) => setDiscount(e.target.value)}
                  />
                </Field>
                <Field label="الضريبة (₪)">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={tax}
                    onChange={(e) => setTax(e.target.value)}
                  />
                </Field>
              </div>

              {/* Invoice Lines */}
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-forest-900 text-sm">بنود الفاتورة / الخدمات الزراعية</h3>
                  <Button type="button" variant="secondary" size="sm" onClick={handleAddLine}>
                    <Plus className="h-4 w-4 ml-1" />
                    إضافة بند
                  </Button>
                </div>

                <div className="space-y-2">
                  {lines.map((line, idx) => (
                    <div
                      key={idx}
                      className="flex flex-col gap-2 rounded-2xl bg-cream/60 p-3 sm:flex-row sm:items-center"
                    >
                      <div className="flex-[3]">
                        <Input
                          placeholder="وصف البند / الخدمة (مثال: حراثة أرض 10 دونم، شتلات زيتون...)"
                          value={line.description}
                          onChange={(e) => handleLineChange(idx, "description", e.target.value)}
                        />
                      </div>
                      <div className="flex-1">
                        <Input
                          type="number"
                          step="0.001"
                          min="0.001"
                          placeholder="الكمية"
                          value={line.quantity}
                          onChange={(e) => handleLineChange(idx, "quantity", e.target.value)}
                        />
                      </div>
                      <div className="flex-1">
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="سعر الوحدة"
                          value={line.unitPrice}
                          onChange={(e) => handleLineChange(idx, "unitPrice", e.target.value)}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={lines.length <= 1}
                        onClick={() => handleRemoveLine(idx)}
                        className="text-danger self-end sm:self-center"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              <Field label="ملاحظات وشروط الفاتورة">
                <Textarea
                  placeholder="ملاحظات تظهر أسفل الفاتورة..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                />
              </Field>
            </div>

            <div className="flex items-center justify-between border-t border-forest-900/10 pt-4">
              <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
                إلغاء
              </Button>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={submitting}
                  onClick={() => handleSave(false)}
                >
                  حفظ كمسودة
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  disabled={submitting}
                  onClick={() => handleSave(true)}
                >
                  اعتماد الفاتورة نهائياً
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* View Invoice Modal */}
      {viewInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-forest-950/60 p-4">
          <div className="w-full max-w-3xl max-h-[92vh] flex flex-col rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-forest-900/10 pb-4">
              <div>
                <h2 className="text-xl font-bold text-forest-900">
                  فاتورة {viewInvoice.invoice.invoiceNumber}
                </h2>
                <p className="text-xs text-muted">
                  تاريخ: {formatDateAr(viewInvoice.invoice.issuedAt)} • العميل: {viewInvoice.invoice.customerName}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleExportPdf(viewInvoice.invoice)}
                  disabled={exportingPdf}
                >
                  <FileDown className="h-4 w-4 ml-1" />
                  {exportingPdf ? "تصدير..." : "تصدير PDF"}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setViewInvoice(null)}>
                  <X className="h-5 w-5" />
                </Button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto py-4 space-y-4">
              {/* Lines Table */}
              <div className="overflow-x-auto rounded-2xl border border-forest-900/10">
                <table className="w-full text-right text-xs">
                  <thead className="bg-cream border-b border-forest-900/10 font-bold text-forest-900">
                    <tr>
                      <th className="p-3">الوصف</th>
                      <th className="p-3">الكمية</th>
                      <th className="p-3">سعر الوحدة</th>
                      <th className="p-3">المجموع</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-forest-900/10">
                    {viewInvoice.lines.map((l) => (
                      <tr key={l.id}>
                        <td className="p-3 font-semibold text-forest-900">{l.description}</td>
                        <td className="p-3">{formatMinorGrouped(BigInt(l.quantityMinor), l.quantityExponent)}</td>
                        <td className="p-3 font-mono">
                          {currency.symbol} {formatMinorGrouped(BigInt(l.unitPriceMinor), exp)}
                        </td>
                        <td className="p-3 font-mono font-bold text-forest-900">
                          {currency.symbol} {formatMinorGrouped(BigInt(l.lineTotalMinor), exp)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Financial Totals */}
              <div className="flex flex-col items-end gap-1.5 text-sm p-4 rounded-2xl bg-cream/40">
                <p className="text-muted">
                  المجموع الفرعي:{" "}
                  <span className="font-mono font-bold text-forest-900">
                    {currency.symbol} {formatMinorGrouped(BigInt(viewInvoice.invoice.subtotalMinor), exp)}
                  </span>
                </p>
                {BigInt(viewInvoice.invoice.discountMinor) > 0n && (
                  <p className="text-muted">
                    الخصم:{" "}
                    <span className="font-mono font-bold text-danger">
                      - {currency.symbol} {formatMinorGrouped(BigInt(viewInvoice.invoice.discountMinor), exp)}
                    </span>
                  </p>
                )}
                {BigInt(viewInvoice.invoice.taxMinor) > 0n && (
                  <p className="text-muted">
                    الضريبة:{" "}
                    <span className="font-mono font-bold text-forest-900">
                      + {currency.symbol} {formatMinorGrouped(BigInt(viewInvoice.invoice.taxMinor), exp)}
                    </span>
                  </p>
                )}
                <div className="border-t border-forest-900/10 pt-2 mt-1">
                  <p className="text-lg font-bold text-forest-950">
                    الإجمالي النهائي: {currency.symbol}{" "}
                    {formatMinorGrouped(BigInt(viewInvoice.invoice.grandTotalMinor), exp)}
                  </p>
                </div>
              </div>

              {viewInvoice.invoice.notes && (
                <div className="p-3 rounded-2xl bg-cream/60 text-xs text-muted">
                  <p className="font-bold text-forest-900 mb-1">ملاحظات:</p>
                  <p>{viewInvoice.invoice.notes}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Cancel Modal */}
      {cancelModalInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-forest-950/60 p-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-forest-900">
              إلغاء الفاتورة ({cancelModalInvoice.invoiceNumber})
            </h2>
            <p className="mt-2 text-sm text-muted">
              سيتم الاحتفاظ بالفاتورة في سجل التدقيق المالي كفاتورة ملغاة ولن يتم حذفها نهائياً.
            </p>
            <div className="mt-4">
              <Field label="سبب الإلغاء *">
                <Input
                  required
                  placeholder="مثال: خطأ في التسعير، إلغاء الطلب..."
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                />
              </Field>
            </div>
            <div className="mt-6 flex justify-end gap-2 border-t border-forest-900/10 pt-4">
              <Button variant="secondary" onClick={() => setCancelModalInvoice(null)}>
                رجوع
              </Button>
              <Button
                variant="primary"
                disabled={submitting}
                onClick={handleCancelInvoice}
                className="bg-danger hover:bg-danger/90"
              >
                تأكيد الإلغاء
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
