"use client";

import { useEffect, useState } from "react";
import { formatMinorGrouped, parseMajorToMinor } from "@/lib/money";
import { formatDateAr } from "@/lib/time";
import { getCurrency } from "@/lib/currencies";
import {
  listTransactions,
  createTransaction,
  reverseTransaction,
  listPeople,
  type TransactionRecord,
  type PersonRecord,
  type UserTransactionType,
} from "@/lib/services/financeService";
import { TRANSACTION_TYPE_LABELS } from "@/lib/finance/types";
import { Card, Button, Input, Select, Textarea, Field, EmptyState } from "@/components/ui/primitives";
import { useApp } from "@/components/providers";
import { Plus, RotateCcw, Search, Filter, X } from "lucide-react";
import { useSearchParams } from "next/navigation";

function getInitialType(param: string | null): UserTransactionType {
  if (param === "income") return "income";
  if (param === "expense") return "expense";
  if (param === "advance") return "advance_given";
  return "income";
}

export function TransactionsScreen() {
  const { bump, refresh, toast, settings, notifyDataChanged } = useApp();
  const searchParams = useSearchParams();
  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [people, setPeople] = useState<PersonRecord[]>([]);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const initialNewParam = searchParams.get("new");
  const [modalOpen, setModalOpen] = useState(Boolean(initialNewParam));
  const [reverseModalTx, setReverseModalTx] = useState<TransactionRecord | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Form states
  const [type, setType] = useState<UserTransactionType>(() => getInitialType(initialNewParam));
  const [amount, setAmount] = useState("");
  const [personId, setPersonId] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [occurredAt, setOccurredAt] = useState(new Date().toISOString().slice(0, 16));
  const [adjDir, setAdjDir] = useState<"increase" | "decrease">("increase");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [txs, ppl] = await Promise.all([listTransactions(), listPeople()]);
      if (!cancelled) {
        setTransactions(txs);
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

  const filtered = transactions.filter((tx) => {
    if (typeFilter !== "all" && tx.type !== typeFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      tx.description.toLowerCase().includes(q) ||
      tx.referenceNumber.toLowerCase().includes(q) ||
      (tx.notes && tx.notes.toLowerCase().includes(q))
    );
  });

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    try {
      setSubmitting(true);
      const minor = parseMajorToMinor(amount, exp);
      await createTransaction({
        type,
        amountMinor: minor,
        personId: personId || undefined,
        category: category || undefined,
        description,
        notes: notes || undefined,
        occurredAt: new Date(occurredAt).toISOString(),
        adjustmentDirection: type === "adjustment" ? adjDir : undefined,
      });
      toast("تم تسجيل الحركة بنجاح في السجل المالي", "ok");
      setModalOpen(false);
      resetForm();
      await refresh();
      notifyDataChanged();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "فشل تسجيل الحركة";
      toast(message, "err");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReverse() {
    if (!reverseModalTx) return;
    try {
      setSubmitting(true);
      await reverseTransaction(reverseModalTx.id, reverseReason || "عكس حركة من قبل المستخدم");
      toast("تم إنشاء قيد العكس بنجاح وتحديث الأرصدة", "ok");
      setReverseModalTx(null);
      setReverseReason("");
      await refresh();
      notifyDataChanged();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "فشل عكس الحركة";
      toast(message, "err");
    } finally {
      setSubmitting(false);
    }
  }

  function resetForm() {
    setAmount("");
    setPersonId("");
    setCategory("");
    setDescription("");
    setNotes("");
    setOccurredAt(new Date().toISOString().slice(0, 16));
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-forest-900 sm:text-3xl">الحركات النقدية واليومية</h1>
          <p className="text-sm text-muted">سجل دقيق وموثق لجميع مقبوضات ومصروفات وسلف الصندوق</p>
        </div>
        <Button
          variant="primary"
          onClick={() => {
            resetForm();
            setModalOpen(true);
          }}
        >
          <Plus className="h-5 w-5 ml-1 text-lime-400" />
          حركة نقدية جديدة
        </Button>
      </div>

      {/* Filter and Search Bar */}
      <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-3.5 h-5 w-5 text-muted" />
          <Input
            placeholder="بحث بالوصف، الرقم المرجعي..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pr-10"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-5 w-5 text-muted shrink-0" />
          <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="all">جميع الأنواع</option>
            <option value="income">قبض نقدي</option>
            <option value="expense">صرف نقدي</option>
            <option value="advance_given">سلفة معطاة</option>
            <option value="advance_settlement">تسوية سلفة</option>
            <option value="advance_refund">استرداد سلفة</option>
            <option value="opening_balance">رصيد افتتاحي</option>
            <option value="adjustment">تسوية رصيد</option>
          </Select>
        </div>
      </Card>

      {/* Transaction List */}
      <Card>
        {filtered.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead>
                <tr className="border-b border-forest-900/10 text-muted">
                  <th className="py-3 px-2">الرقم المرجعي</th>
                  <th className="py-3 px-2">التاريخ</th>
                  <th className="py-3 px-2">النوع</th>
                  <th className="py-3 px-2">الوصف والشخص</th>
                  <th className="py-3 px-2">المبلغ</th>
                  <th className="py-3 px-2">الحالة</th>
                  <th className="py-3 px-2 text-center">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-forest-900/5">
                {filtered.map((tx) => {
                  const person = people.find((p) => p.id === tx.personId);
                  const isPositive = tx.type === "income" || tx.type === "advance_refund" || tx.type === "opening_balance";
                  const isNegative = tx.type === "expense" || tx.type === "advance_given";

                  return (
                    <tr key={tx.id} className="hover:bg-cream/40 transition">
                      <td className="py-3 px-2 font-mono font-bold text-forest-950">{tx.referenceNumber}</td>
                      <td className="py-3 px-2 text-muted">{formatDateAr(tx.occurredAt)}</td>
                      <td className="py-3 px-2">
                        <span className="inline-block rounded-xl bg-forest-900/5 px-2.5 py-1 text-xs font-semibold text-forest-900">
                          {TRANSACTION_TYPE_LABELS[tx.type]}
                        </span>
                      </td>
                      <td className="py-3 px-2">
                        <p className="font-semibold text-forest-900">{tx.description}</p>
                        {person ? <p className="text-xs text-forest-700">الشخص: {person.fullName}</p> : null}
                        {tx.category ? <span className="text-xs text-muted">[{tx.category}]</span> : null}
                      </td>
                      <td className="py-3 px-2 font-bold text-base">
                        <span
                          className={
                            isPositive ? "text-forest-800" : isNegative ? "text-danger" : "text-forest-950"
                          }
                        >
                          {isPositive ? "+" : isNegative ? "-" : ""}
                          {currency.symbol} {formatMinorGrouped(BigInt(tx.amountMinor), exp)}
                        </span>
                      </td>
                      <td className="py-3 px-2">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
                            tx.status === "reversed"
                              ? "bg-red-100 text-danger"
                              : tx.status === "corrected"
                              ? "bg-amber-100 text-warning"
                              : "bg-forest-100 text-forest-800"
                          }`}
                        >
                          {tx.status === "reversed" ? "معكوسة" : tx.status === "corrected" ? "مصححة" : "معتمدة"}
                        </span>
                      </td>
                      <td className="py-3 px-2 text-center">
                        {tx.status !== "reversed" ? (
                          <Button
                            variant="ghost"
                            onClick={() => setReverseModalTx(tx)}
                            className="text-xs text-danger hover:bg-red-50 p-2"
                            title="عكس الحركة"
                          >
                            <RotateCcw className="h-4 w-4 ml-1" />
                            عكس
                          </Button>
                        ) : (
                          <span className="text-xs text-muted">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="لا توجد حركات مطابقة" hint="جرب تغيير معايير البحث أو تسجيل حركة جديدة." />
        )}
      </Card>

      {/* Modal: New Transaction */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-forest-950/60 p-4">
          <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-forest-900/10 pb-4">
              <h2 className="text-xl font-bold text-forest-900">تسجيل حركة نقدية جديدة</h2>
              <button onClick={() => setModalOpen(false)} className="rounded-full p-2 hover:bg-forest-900/5">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreate} className="mt-4 space-y-4">
              <Field label="نوع الحركة">
                <Select value={type} onChange={(e) => setType(e.target.value as UserTransactionType)}>
                  <option value="income">قبض نقدي (دخل للصندوق)</option>
                  <option value="expense">صرف نقدي (مصروف من الصندوق)</option>
                  <option value="advance_given">سلفة معطاة (خارجة من الصندوق لشخص)</option>
                  <option value="advance_settlement">تسوية سلفة (تحويل لمصروف دون حركة نقد)</option>
                  <option value="advance_refund">استرداد سلفة (إرجاع نقد للصندوق)</option>
                  <option value="opening_balance">رصيد افتتاحي</option>
                  <option value="adjustment">تسوية رصيد يدوي</option>
                </Select>
              </Field>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label={`المبلغ (${currency.symbol})`}>
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    required
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </Field>
                <Field label="تاريخ ووقت الحركة">
                  <Input
                    type="datetime-local"
                    required
                    value={occurredAt}
                    onChange={(e) => setOccurredAt(e.target.value)}
                  />
                </Field>
              </div>

              {(type === "advance_given" || type === "advance_settlement" || type === "advance_refund") && (
                <Field label="الشخص المرتبط بالسلفة *">
                  <Select required value={personId} onChange={(e) => setPersonId(e.target.value)}>
                    <option value="">اختر شخصاً من القائمة...</option>
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.fullName} ({p.phone})
                      </option>
                    ))}
                  </Select>
                </Field>
              )}

              {type !== "advance_given" && type !== "advance_settlement" && type !== "advance_refund" && (
                <Field label="الشخص المرتبط (اختياري)">
                  <Select value={personId} onChange={(e) => setPersonId(e.target.value)}>
                    <option value="">لا يوجد شخص محدد</option>
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.fullName} ({p.phone})
                      </option>
                    ))}
                  </Select>
                </Field>
              )}

              {type === "adjustment" && (
                <Field label="اتجاه التسوية">
                  <Select
                    value={adjDir}
                    onChange={(e) => setAdjDir(e.target.value as "increase" | "decrease")}
                  >
                    <option value="increase">زيادة رصيد الصندوق (+)</option>
                    <option value="decrease">نقص رصيد الصندوق (-)</option>
                  </Select>
                </Field>
              )}

              <Field label="الوصف *">
                <Input
                  required
                  placeholder="مثال: شراء ديزل، دفعة مقاولة، سلفة مشتريات..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </Field>

              <Field label="التصنيف">
                <Input
                  placeholder="مثال: وقود، صيانة، رواتب، مبيعات..."
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                />
              </Field>

              <Field label="ملاحظات إضافية">
                <Textarea
                  placeholder="أي تفاصيل أو مستندات ورقية مرتبطة..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </Field>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-forest-900/10">
                <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
                  إلغاء
                </Button>
                <Button type="submit" variant="primary" disabled={submitting}>
                  {submitting ? "جاري الحفظ..." : "حفظ الحركة في السجل"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Reverse Transaction */}
      {reverseModalTx && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-forest-950/60 p-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
            <h2 className="text-xl font-bold text-danger">عكس حركة نقدية</h2>
            <p className="mt-2 text-sm text-muted">
              حسب معايير السجلات المالية غير القابلة للتعديل، لن يتم حذف الحركة الأصلية (
              {reverseModalTx.referenceNumber})، بل سيتم تسجيل حركة عكسية موثقة ومعتمدة محاسبياً تعيد الرصيد إلى ما كان عليه.
            </p>

            <div className="mt-4">
              <Field label="سبب العكس *">
                <Input
                  placeholder="مثال: خطأ في إدخال المبلغ، تكرار الإيصال..."
                  value={reverseReason}
                  onChange={(e) => setReverseReason(e.target.value)}
                  required
                />
              </Field>
            </div>

            <div className="flex items-center justify-end gap-3 mt-6">
              <Button variant="secondary" onClick={() => setReverseModalTx(null)}>
                تراجع
              </Button>
              <Button variant="danger" onClick={handleReverse} disabled={submitting || !reverseReason.trim()}>
                {submitting ? "جاري العكس..." : "تأكيد العكس"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
