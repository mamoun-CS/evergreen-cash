"use client";

import { useState } from "react";
import { saveSettings } from "@/lib/services/financeService";
import { enablePin, disablePin, useApp } from "@/components/providers";
import { Card, Button, Input, Select, Textarea, Field } from "@/components/ui/primitives";
import {
  Lock,
  Building,
  FileText,
  Save,
  HardDrive,
} from "lucide-react";
import { CURRENCIES } from "@/lib/currencies";
import { APP_VERSION, SCHEMA_VERSION } from "@/lib/version";

export function SettingsScreen() {
  const { settings, refresh, toast } = useApp();

  // Company details
  const [companyName, setCompanyName] = useState(settings?.companyName || "");
  const [companyAddress, setCompanyAddress] = useState(settings?.companyAddress || "");
  const [companyPhone, setCompanyPhone] = useState(settings?.companyPhone || "");
  const [companyEmail, setCompanyEmail] = useState(settings?.companyEmail || "");
  const [defaultCurrency, setDefaultCurrency] = useState(settings?.defaultCurrency || "ILS");
  const [invoicePrefix, setInvoicePrefix] = useState(settings?.invoicePrefix || "INV-");
  const [invoiceFooter, setInvoiceFooter] = useState(settings?.invoiceFooter || "");

  // Auto-backup configuration
  const [autoBackupEnabled, setAutoBackupEnabled] = useState(settings?.autoBackupEnabled ?? true);
  const [autoBackupIntervalMinutes, setAutoBackupIntervalMinutes] = useState(
    String(settings?.autoBackupIntervalMinutes || 60)
  );
  const [keepBackupCount, setKeepBackupCount] = useState(String(settings?.keepBackupCount || 7));

  // Security / PIN
  const [pinEnabled, setPinEnabled] = useState(settings?.pinEnabled ?? false);
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [autoLockMinutes, setAutoLockMinutes] = useState(String(settings?.autoLockMinutes || 5));

  const [saving, setSaving] = useState(false);

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    try {
      setSaving(true);
      await saveSettings({
        companyName,
        companyAddress,
        companyPhone,
        companyEmail,
        defaultCurrency,
        invoicePrefix,
        invoiceFooter,
        autoBackupEnabled,
        autoBackupIntervalMinutes: parseInt(autoBackupIntervalMinutes, 10) || 60,
        keepBackupCount: parseInt(keepBackupCount, 10) || 7,
        autoLockMinutes: parseInt(autoLockMinutes, 10) || 5,
      });

      // Handle PIN toggle
      if (pinEnabled && !settings?.pinEnabled) {
        if (!newPin || newPin.length < 4) {
          toast("رمز PIN يجب أن يتكون من 4 أرقام على الأقل", "warn");
          setSaving(false);
          return;
        }
        if (newPin !== confirmPin) {
          toast("تأكيد رمز PIN غير متطابق", "warn");
          setSaving(false);
          return;
        }
        await enablePin(newPin);
        setNewPin("");
        setConfirmPin("");
      } else if (!pinEnabled && settings?.pinEnabled) {
        await disablePin();
      }

      toast("تم حفظ الإعدادات بنجاح", "ok");
      await refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "فشل حفظ الإعدادات";
      toast(msg, "err");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-forest-900 sm:text-3xl">إعدادات النظام والتطبيق</h1>
        <p className="text-sm text-muted">
          تخصيص هوية شركة إيفر غرين، العملة الافتراضية، أرقام الفواتير، وسياسات الأمان والقفل
        </p>
      </div>

      <form onSubmit={handleSaveSettings} className="space-y-6">
        {/* Company Identity */}
        <Card>
          <div className="flex items-center gap-2 mb-4 border-b border-forest-900/10 pb-3">
            <Building className="h-5 w-5 text-forest-800" />
            <h2 className="text-lg font-bold text-forest-900">بيانات الشركة وهوية المطبوعات</h2>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="اسم الشركة الرسمي *">
              <Input
                required
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
              />
            </Field>

            <Field label="العملة الأساسية للصندوق">
              <Select value={defaultCurrency} onChange={(e) => setDefaultCurrency(e.target.value)}>
                {Object.values(CURRENCIES).map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} ({c.symbol}) — {c.nameAr}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="رقم هاتف الشركة">
              <Input
                type="tel"
                value={companyPhone}
                onChange={(e) => setCompanyPhone(e.target.value)}
              />
            </Field>

            <Field label="البريد الإلكتروني للشركة">
              <Input
                type="email"
                value={companyEmail}
                onChange={(e) => setCompanyEmail(e.target.value)}
              />
            </Field>

            <div className="sm:col-span-2">
              <Field label="عنوان مقر الشركة">
                <Input
                  value={companyAddress}
                  onChange={(e) => setCompanyAddress(e.target.value)}
                />
              </Field>
            </div>
          </div>
        </Card>

        {/* Invoice Settings */}
        <Card>
          <div className="flex items-center gap-2 mb-4 border-b border-forest-900/10 pb-3">
            <FileText className="h-5 w-5 text-forest-800" />
            <h2 className="text-lg font-bold text-forest-900">إعدادات الفواتير والترقيم</h2>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="بادئة ترقيم الفواتير">
              <Input
                value={invoicePrefix}
                onChange={(e) => setInvoicePrefix(e.target.value)}
              />
            </Field>

            <div className="sm:col-span-2">
              <Field label="تذييل الفاتورة (ملاحظة أسفل الصفحة في PDF)">
                <Textarea
                  value={invoiceFooter}
                  onChange={(e) => setInvoiceFooter(e.target.value)}
                  rows={2}
                />
              </Field>
            </div>
          </div>
        </Card>

        {/* Security & PIN Lock */}
        <Card>
          <div className="flex items-center gap-2 mb-4 border-b border-forest-900/10 pb-3">
            <Lock className="h-5 w-5 text-forest-800" />
            <h2 className="text-lg font-bold text-forest-900">أمان التطبيق وقفل الشاشة (PIN)</h2>
          </div>

          <div className="space-y-4">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={pinEnabled}
                onChange={(e) => setPinEnabled(e.target.checked)}
                className="h-4 w-4 rounded accent-forest-900"
              />
              <div>
                <span className="font-bold text-sm text-forest-900">تفعيل رمز القفل السريع (PIN Lock)</span>
                <p className="text-xs text-muted">
                  قفل التطبيق عند تركه مفتوحاً دون نشاط لمنع الوصول غير المصرح به على جهاز iPad.
                </p>
              </div>
            </label>

            {pinEnabled && !settings?.pinEnabled && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 pt-2">
                <Field label="تعيين رمز PIN جديد (4 أرقام على الأقل) *">
                  <Input
                    type="password"
                    inputMode="numeric"
                    placeholder="مثال: 1234"
                    value={newPin}
                    onChange={(e) => setNewPin(e.target.value)}
                  />
                </Field>
                <Field label="تأكيد رمز PIN *">
                  <Input
                    type="password"
                    inputMode="numeric"
                    placeholder="أعد إدخال الرمز..."
                    value={confirmPin}
                    onChange={(e) => setConfirmPin(e.target.value)}
                  />
                </Field>
              </div>
            )}

            {pinEnabled && (
              <div className="max-w-xs pt-2">
                <Field label="مهلة القفل التلقائي عند عدم النشاط">
                  <Select value={autoLockMinutes} onChange={(e) => setAutoLockMinutes(e.target.value)}>
                    <option value="1">دقيقة واحدة</option>
                    <option value="3">3 دقائق</option>
                    <option value="5">5 دقائق</option>
                    <option value="15">15 دقيقة</option>
                    <option value="30">30 دقيقة</option>
                  </Select>
                </Field>
              </div>
            )}
          </div>
        </Card>

        {/* Auto Backup & Storage Information */}
        <Card>
          <div className="flex items-center gap-2 mb-4 border-b border-forest-900/10 pb-3">
            <HardDrive className="h-5 w-5 text-forest-800" />
            <h2 className="text-lg font-bold text-forest-900">التخزين المحلي والنسخ الاحتياطي</h2>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoBackupEnabled}
                  onChange={(e) => setAutoBackupEnabled(e.target.checked)}
                  className="h-4 w-4 rounded accent-forest-900"
                />
                <div>
                  <span className="font-bold text-sm text-forest-900">تفعيل التنبيه أو النسخ الاحتياطي التلقائي عند توفر الإنترنت</span>
                  <p className="text-xs text-muted">محاولة النسخ بأفضل جهد عند فتح التطبيق وتوفر اتصال بالإنترنت.</p>
                </div>
              </label>
            </div>

            <Field label="فترة التحقق من التغييرات">
              <Select
                value={autoBackupIntervalMinutes}
                onChange={(e) => setAutoBackupIntervalMinutes(e.target.value)}
              >
                <option value="30">كل 30 دقيقة</option>
                <option value="60">كل ساعة (موصى به)</option>
                <option value="180">كل 3 ساعات</option>
                <option value="360">كل 6 ساعات</option>
              </Select>
            </Field>

            <Field label="عدد النسخ السحابية المحفوظة في Google Drive">
              <Select value={keepBackupCount} onChange={(e) => setKeepBackupCount(e.target.value)}>
                <option value="5">أحدث 5 نسخ</option>
                <option value="7">أحدث 7 نسخ (موصى به)</option>
                <option value="14">أحدث 14 نسخة</option>
                <option value="30">أحدث 30 نسخة</option>
              </Select>
            </Field>

            <div className="rounded-2xl bg-cream/70 p-4 border border-forest-900/10 text-xs text-forest-900 space-y-1 sm:col-span-2">
              <p className="font-bold text-sm">حالة التخزين المحلي والبرمجية:</p>
              <p>نوع التخزين: IndexedDB (محلي على متصفح جهاز iPad)</p>
              <p>إصدار التطبيق: EverGreen CASH v{APP_VERSION}</p>
              <p>إصدار مخطط البيانات: Schema v{SCHEMA_VERSION}</p>
              <p className="text-muted pt-1">
                جميع المعاملات والقيود والعمليات المحاسبية مخزنة محلياً بالكامل ومتاحة بدون اتصال بالإنترنت.
              </p>
            </div>
          </div>
        </Card>

        {/* Submit Bar */}
        <div className="flex justify-end pt-2">
          <Button type="submit" disabled={saving} className="flex items-center gap-2">
            <Save className="h-4 w-4" />
            {saving ? "جاري الحفظ..." : "حفظ جميع الإعدادات"}
          </Button>
        </div>
      </form>
    </div>
  );
}
