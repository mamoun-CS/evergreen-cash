"use client";

import { useEffect, useState } from "react";
import { formatMinorGrouped } from "@/lib/money";
import { formatDateAr } from "@/lib/time";
import { getCurrency } from "@/lib/currencies";
import {
  listPeople,
  upsertPerson,
  archivePerson,
  personStatement,
  type PersonRecord,
} from "@/lib/services/financeService";
import { Card, Button, Input, Textarea, Field, EmptyState } from "@/components/ui/primitives";
import { useApp } from "@/components/providers";
import {
  UserPlus,
  Search,
  FileDown,
  Phone,
  MapPin,
  Archive,
  X,
} from "lucide-react";
import { buildStatementPdf, shareOrDownloadPdf } from "@/lib/pdf/generate";

export function PeopleScreen() {
  const { bump, refresh, toast, settings, notifyDataChanged } = useApp();
  const [people, setPeople] = useState<PersonRecord[]>([]);
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingPerson, setEditingPerson] = useState<PersonRecord | null>(null);

  // Statement modal state
  const [statementPerson, setStatementPerson] = useState<PersonRecord | null>(null);
  const [statementData, setStatementData] = useState<Awaited<ReturnType<typeof personStatement>> | null>(null);
  const [loadingStatement, setLoadingStatement] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  // Form states
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const data = await listPeople(showArchived);
      if (!cancelled) setPeople(data);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [bump, showArchived]);

  const currency = getCurrency(settings?.defaultCurrency || "ILS");
  const exp = currency.exponent;

  const filtered = people.filter((p) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return p.fullName.toLowerCase().includes(q) || p.phone.includes(q);
  });

  function openCreateModal() {
    setEditingPerson(null);
    setFullName("");
    setPhone("");
    setAddress("");
    setNotes("");
    setEditModalOpen(true);
  }

  function openEditModal(person: PersonRecord) {
    setEditingPerson(person);
    setFullName(person.fullName);
    setPhone(person.phone);
    setAddress(person.address || "");
    setNotes(person.notes || "");
    setEditModalOpen(true);
  }

  async function handleSavePerson(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName.trim()) {
      toast("يرجى إدخال اسم الشخص", "warn");
      return;
    }
    try {
      setSubmitting(true);
      await upsertPerson({
        id: editingPerson?.id,
        fullName,
        phone,
        address: address || undefined,
        notes: notes || undefined,
      });
      toast(editingPerson ? "تم تعديل بيانات الشخص" : "تمت إضافة الشخص بنجاح", "ok");
      setEditModalOpen(false);
      await refresh();
      notifyDataChanged();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "حدث خطأ أثناء حفظ البيانات";
      toast(msg, "err");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleArchive(id: string, name: string) {
    if (!confirm(`هل أنت متأكد من أرشفة (${name})؟`)) return;
    try {
      await archivePerson(id);
      toast("تمت أرشفة الشخص بنجاح", "ok");
      await refresh();
      notifyDataChanged();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "فشلت الأرشفة";
      toast(msg, "err");
    }
  }

  async function openStatement(person: PersonRecord) {
    setStatementPerson(person);
    setLoadingStatement(true);
    try {
      const data = await personStatement(person.id);
      setStatementData(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "فشل تحميل كشف الحساب";
      toast(msg, "err");
    } finally {
      setLoadingStatement(false);
    }
  }

  async function handleExportStatementPdf() {
    if (!statementPerson || !statementData || !settings) return;
    try {
      setExportingPdf(true);
      const lines = statementData.events.map((e) => {
        const cashDelta = BigInt(e.cashDeltaMinor);
        const advDelta = BigInt(e.advanceDeltaMinor);
        return {
          date: formatDateAr(e.occurredAt),
          description: e.description,
          cashIn: cashDelta > 0n ? `${currency.symbol} ${formatMinorGrouped(cashDelta, exp)}` : "-",
          cashOut: cashDelta < 0n ? `${currency.symbol} ${formatMinorGrouped(-cashDelta, exp)}` : "-",
          advance: advDelta !== 0n ? `${currency.symbol} ${formatMinorGrouped(advDelta, exp)}` : "-",
        };
      });

      const bytes = await buildStatementPdf({
        person: statementPerson,
        settings,
        lines,
        totals: {
          cashIn: `${currency.symbol} ${formatMinorGrouped(statementData.cashIn, exp)}`,
          cashOut: `${currency.symbol} ${formatMinorGrouped(statementData.cashOut, exp)}`,
          outstanding: `${currency.symbol} ${formatMinorGrouped(statementData.outstanding, exp)}`,
        },
      });

      await shareOrDownloadPdf(bytes, `statement-${statementPerson.fullName}.pdf`);
      toast("تم تصدير كشف الحساب بنجاح", "ok");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "فشل تصدير كشف الحساب";
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
          <h1 className="text-2xl font-bold text-forest-900 sm:text-3xl">دليل الأشخاص والموظفين</h1>
          <p className="text-sm text-muted">إدارة المقاولين، الموظفين، والعملاء، ومتابعة السلف وكشوف الحسابات</p>
        </div>
        <Button onClick={openCreateModal} className="flex items-center gap-2">
          <UserPlus className="h-5 w-5" />
          إضافة شخص جديد
        </Button>
      </div>

      {/* Filters and Search */}
      <Card>
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="relative flex-1">
            <Search className="absolute right-3.5 top-3.5 h-4 w-4 text-muted" />
            <Input
              type="text"
              placeholder="البحث بالاسم أو رقم الهاتف..."
              className="pr-10"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-forest-900 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
                className="h-4 w-4 rounded accent-forest-900"
              />
              عرض المؤرشفين
            </label>
          </div>
        </div>
      </Card>

      {/* People Grid */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={UserPlus}
          title="لا يوجد أشخاص"
          description={search ? "لم يتم العثور على أي نتائج تطابق بحثك." : "ابدأ بإضافة موظف، مقاول، أو عميل جديد."}
          action={
            !search ? (
              <Button onClick={openCreateModal} variant="primary">
                إضافة شخص الآن
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((person) => (
            <Card key={person.id} className="flex flex-col justify-between">
              <div>
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-lg font-bold text-forest-900">{person.fullName}</h3>
                    {person.phone ? (
                      <p className="mt-1 flex items-center gap-1.5 text-xs text-muted" dir="ltr">
                        <Phone className="h-3.5 w-3.5" />
                        {person.phone}
                      </p>
                    ) : null}
                    {person.address ? (
                      <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                        <MapPin className="h-3.5 w-3.5" />
                        {person.address}
                      </p>
                    ) : null}
                  </div>
                  {person.archived && (
                    <span className="rounded-full bg-muted/20 px-2 py-0.5 text-xs text-muted font-medium">
                      مؤرشف
                    </span>
                  )}
                </div>

                {person.notes && (
                  <p className="mt-3 text-xs text-forest-700/80 bg-cream/60 p-2 rounded-xl">
                    {person.notes}
                  </p>
                )}
              </div>

              <div className="mt-5 flex items-center justify-between border-t border-forest-900/10 pt-3 text-sm">
                <Button variant="ghost" size="sm" onClick={() => openStatement(person)} className="text-forest-800">
                  كشف حساب
                </Button>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => openEditModal(person)}>
                    تعديل
                  </Button>
                  {!person.archived && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleArchive(person.id, person.fullName)}
                      className="text-muted hover:text-danger"
                    >
                      <Archive className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Edit / Create Person Modal */}
      {editModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-forest-950/60 p-4">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-forest-900/10 pb-4">
              <h2 className="text-xl font-bold text-forest-900">
                {editingPerson ? "تعديل بيانات شخص" : "إضافة شخص جديد"}
              </h2>
              <Button variant="ghost" size="sm" onClick={() => setEditModalOpen(false)}>
                <X className="h-5 w-5" />
              </Button>
            </div>

            <form onSubmit={handleSavePerson} className="mt-4 space-y-4">
              <Field label="الاسم الكامل *">
                <Input
                  required
                  placeholder="مثال: أحمد خالد"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                />
              </Field>

              <Field label="رقم الهاتف">
                <Input
                  type="tel"
                  placeholder="مثال: 0599123456"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </Field>

              <Field label="العنوان">
                <Input
                  placeholder="مثال: رام الله، المزرعة الشرقية"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
              </Field>

              <Field label="ملاحظات">
                <Textarea
                  placeholder="ملاحظات اختيارية..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                />
              </Field>

              <div className="mt-6 flex justify-end gap-2 border-t border-forest-900/10 pt-4">
                <Button type="button" variant="secondary" onClick={() => setEditModalOpen(false)}>
                  إلغاء
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? "جاري الحفظ..." : "حفظ البيانات"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Statement Modal */}
      {statementPerson && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-forest-950/60 p-4">
          <div className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-forest-900/10 pb-4">
              <div>
                <h2 className="text-xl font-bold text-forest-900">
                  كشف حساب: {statementPerson.fullName}
                </h2>
                <p className="text-xs text-muted">{statementPerson.phone || "لا يوجد هاتف مسجل"}</p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleExportStatementPdf}
                  disabled={exportingPdf || loadingStatement}
                >
                  <FileDown className="h-4 w-4 ml-1" />
                  {exportingPdf ? "تصدير..." : "تصدير PDF"}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setStatementPerson(null)}>
                  <X className="h-5 w-5" />
                </Button>
              </div>
            </div>

            {loadingStatement ? (
              <div className="flex min-h-[40vh] items-center justify-center">
                <p className="font-bold text-forest-900">جاري تحميل كشف الحساب...</p>
              </div>
            ) : statementData ? (
              <div className="flex-1 overflow-y-auto py-4 space-y-4">
                {/* Financial Overview Cards */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl bg-forest-50 p-4 border border-forest-900/10 text-center">
                    <span className="text-xs text-forest-800 font-semibold">إجمالي المقبوض منه</span>
                    <p className="text-xl font-bold text-forest-900 mt-1">
                      {currency.symbol} {formatMinorGrouped(statementData.cashIn, exp)}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-red-50 p-4 border border-red-900/10 text-center">
                    <span className="text-xs text-danger font-semibold">إجمالي المدفوع له</span>
                    <p className="text-xl font-bold text-danger mt-1">
                      {currency.symbol} {formatMinorGrouped(statementData.cashOut, exp)}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-lime-100 p-4 border border-lime-500/20 text-center">
                    <span className="text-xs text-forest-950 font-semibold">رصيد السلف المستحقة</span>
                    <p className="text-xl font-bold text-forest-950 mt-1">
                      {currency.symbol} {formatMinorGrouped(statementData.outstanding, exp)}
                    </p>
                  </div>
                </div>

                {/* Ledger Events Table */}
                <h3 className="font-bold text-forest-900 text-sm mt-4">سجل الحركات المالية المباشرة</h3>
                {statementData.events.length === 0 ? (
                  <p className="text-xs text-muted text-center py-6">لا توجد حركات نقدية مسجلة لهذا الشخص.</p>
                ) : (
                  <div className="overflow-x-auto rounded-2xl border border-forest-900/10">
                    <table className="w-full text-right text-xs">
                      <thead className="bg-cream border-b border-forest-900/10 font-bold text-forest-900">
                        <tr>
                          <th className="p-3">التاريخ</th>
                          <th className="p-3">الوصف</th>
                          <th className="p-3">نقد داخل (+)</th>
                          <th className="p-3">نقد خارج (-)</th>
                          <th className="p-3">أثر السلفة</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-forest-900/10">
                        {statementData.events.map((e) => {
                          const cashDelta = BigInt(e.cashDeltaMinor);
                          const advDelta = BigInt(e.advanceDeltaMinor);
                          return (
                            <tr key={e.id} className="hover:bg-cream/40">
                              <td className="p-3 text-muted">{formatDateAr(e.occurredAt)}</td>
                              <td className="p-3 font-semibold text-forest-900">{e.description}</td>
                              <td className="p-3 font-mono font-bold text-forest-800">
                                {cashDelta > 0n ? `${currency.symbol} ${formatMinorGrouped(cashDelta, exp)}` : "-"}
                              </td>
                              <td className="p-3 font-mono font-bold text-danger">
                                {cashDelta < 0n ? `${currency.symbol} ${formatMinorGrouped(-cashDelta, exp)}` : "-"}
                              </td>
                              <td className="p-3 font-mono font-semibold text-forest-900">
                                {advDelta !== 0n ? `${currency.symbol} ${formatMinorGrouped(advDelta, exp)}` : "-"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
