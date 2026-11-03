"use client";

import { useEffect, useState } from "react";
import { formatDateAr } from "@/lib/time";
import {
  exportEncryptedFile,
  restoreFromBytes,
  previewEncryptedBackup,
  listLocalBackupMeta,
  type BackupDocument,
} from "@/lib/backup/service";
import { Card, Button, Input, Field } from "@/components/ui/primitives";
import { useApp } from "@/components/providers";
import {
  FileKey,
  HardDriveDownload,
  Lock,
  Cloud,
  CheckCircle2,
  AlertCircle,
  X,
} from "lucide-react";
import type { BackupMetaRecord } from "@/lib/finance/types";

export function BackupScreen() {
  const { bump, refresh, toast } = useApp();
  const [localHistory, setLocalHistory] = useState<BackupMetaRecord[]>([]);

  // Backup passphrases
  const [passphrase, setPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [backingUp, setBackingUp] = useState(false);

  // Restore states
  const [restoreModalOpen, setRestoreModalOpen] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<{
    bytes: Uint8Array;
    fileName: string;
  } | null>(null);
  const [restorePassphrase, setRestorePassphrase] = useState("");
  const [previewData, setPreviewData] = useState<BackupDocument | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const history = await listLocalBackupMeta();
      if (!cancelled) setLocalHistory(history);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [bump]);

  async function handleExportFileBackup() {
    if (!passphrase) {
      toast("يرجى إدخال عبارة مرور لتشفير النسخة الاحتياطية", "warn");
      return;
    }
    if (passphrase.length < 10) {
      toast("عبارة المرور يجب أن تكون 10 أحرف على الأقل", "warn");
      return;
    }
    if (passphrase !== confirmPassphrase) {
      toast("عبارة المرور وتأكيدها غير متطابقين", "warn");
      return;
    }

    try {
      setBackingUp(true);
      await exportEncryptedFile(passphrase);
      toast("تم تصدير ملف النسخة المشفرة (.egc) بنجاح", "ok");
      setPassphrase("");
      setConfirmPassphrase("");
      await refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "فشل تصدير النسخة الاحتياطية";
      toast(msg, "err");
    } finally {
      setBackingUp(false);
    }
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      setRestoreTarget({ bytes, fileName: file.name });
      setRestorePassphrase("");
      setPreviewData(null);
      setPreviewError("");
      setRestoreModalOpen(true);
    } catch {
      toast("فشل قراءة الملف المختار", "err");
    }
  }

  async function handlePreviewRestore() {
    if (!restoreTarget) return;
    if (!restorePassphrase) {
      setPreviewError("أدخل عبارة المرور لفك التشفير");
      return;
    }

    try {
      setPreviewError("");
      const preview = await previewEncryptedBackup(restoreTarget.bytes, restorePassphrase);
      setPreviewData(preview);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "عبارة المرور غير صحيحة أو الملف تالف";
      setPreviewError(msg);
      setPreviewData(null);
    }
  }

  async function handleExecuteRestore() {
    if (!restoreTarget || !previewData || !restorePassphrase) return;
    if (!confirm("تحذير: سيتم استبدال البيانات الحالية بالبيانات المسترجعة من النسخة بعد حفظ نسخة أمان تلقائية. هل تؤكد المتابعة؟")) {
      return;
    }

    try {
      setRestoring(true);
      await restoreFromBytes(restoreTarget.bytes, restorePassphrase);
      toast("تمت استعادة البيانات بنجاح والتحقق من ترابط السجل المالي", "ok");
      setRestoreModalOpen(false);
      await refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "فشلت عملية الاستعادة";
      toast(msg, "err");
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-forest-900 sm:text-3xl">النسخ الاحتياطي والاستعادة المشفرة</h1>
        <p className="text-sm text-muted">
          حماية بيانات الصندوق بتشفير AES-256-GCM وتصديرها كملف محلي آمن
        </p>
      </div>

      {/* Security Info Banner */}
      <Card className="!bg-forest-950 !text-white border-2 border-forest-900 p-5 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="rounded-2xl bg-forest-900 p-3 shadow-inner">
            <Lock className="h-6 w-6 text-lime-400" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-lime-400">تشفير كامل بصفر معرفة (Zero-Knowledge)</h3>
            <p className="mt-1.5 text-sm text-emerald-100/90 leading-relaxed font-normal">
              يتم تشفير قاعدة بيانات الصندوق على جهازك قبل تصديرها باستخدام مفتاح يُشتق من عبارة المرور (PBKDF2 مع 310,000 دورة). لا يحتفظ أي طرف ثالث بنسخة من مفتاح فك التشفير.
            </p>
          </div>
        </div>
      </Card>

      {/* Cloud Sync Banner */}
      <Card className="border border-forest-900/20 bg-forest-50 p-4">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-forest-900/10 p-3">
            <Cloud className="h-6 w-6 text-forest-800" />
          </div>
          <div>
            <h3 className="text-base font-bold text-forest-900">المزامنة السحابية التلقائية</h3>
            <p className="text-xs text-muted mt-0.5 leading-relaxed">
              يتم مزامنة بياناتك تلقائياً مع قاعدة بيانات Vercel Postgres عند الاتصال بالإنترنت. يعمل التطبيق بشكل كامل بدون الإنترنت ويُزامن عند العودة للاتصال.
            </p>
          </div>
        </div>
      </Card>

      {/* Create Backup Section */}
      <Card>
        <h2 className="text-lg font-bold text-forest-900 mb-2">إنشاء نسخة احتياطية مشفرة الآن</h2>
        <p className="text-xs text-muted mb-4">
          اختر عبارة مرور قوية واحتفظ بها. لن تتمكن من استعادة البيانات بدونها.
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="عبارة مرور التشفير (10 أحرف كحد أدنى) *">
            <Input
              type="password"
              placeholder="أدخل عبارة المرور..."
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
            />
          </Field>
          <Field label="تأكيد عبارة المرور *">
            <Input
              type="password"
              placeholder="أعد إدخال عبارة المرور..."
              value={confirmPassphrase}
              onChange={(e) => setConfirmPassphrase(e.target.value)}
            />
          </Field>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-forest-900/10 pt-4">
          <Button
            variant="secondary"
            onClick={handleExportFileBackup}
            disabled={backingUp}
            className="flex items-center gap-2"
          >
            <HardDriveDownload className="h-4 w-4" />
            {backingUp ? "جاري التشفير والتصدير..." : "تصدير ملف مشفر (.egc) لجهاز iPad"}
          </Button>
        </div>
      </Card>

      {/* Local File Import */}
      <Card>
        <h2 className="text-lg font-bold text-forest-900 mb-2">استعادة من ملف مشفر خارجي</h2>
        <p className="text-xs text-muted mb-6 leading-relaxed">
          يمكنك استعادة قاعدة البيانات من أي ملف نسخة احتياطية (.egc) تم تنزيله سابقاً أو نقله عبر تطبيق Files أو AirDrop بدون الحاجة للاتصال بالإنترنت.
        </p>

        <label className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-forest-900/20 bg-cream/40 p-6 cursor-pointer hover:bg-cream/80 transition">
          <FileKey className="h-8 w-8 text-forest-800 mb-2" />
          <span className="text-sm font-bold text-forest-900">اضغط لاختيار ملف نسخة (.egc)</span>
          <span className="text-xs text-muted mt-1">من تطبيق Files أو التخزين الداخلي</span>
          <input type="file" accept=".egc" className="hidden" onChange={handleFileSelected} />
        </label>
      </Card>

      {/* Local Backup History */}
      <Card>
        <h2 className="text-lg font-bold text-forest-900 mb-4">سجل عمليات النسخ السابقة على هذا الجهاز</h2>
        {localHistory.length === 0 ? (
          <p className="text-xs text-muted text-center py-6">لم يتم تسجيل أي عمليات نسخ سابقة بعد.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-cream border-b border-forest-900/10 font-bold text-forest-900">
                <tr>
                  <th className="p-3">التاريخ والوقت</th>
                  <th className="p-3">اسم الملف</th>
                  <th className="p-3">الوجهة</th>
                  <th className="p-3">الحالة والتحقق</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-forest-900/10">
                {localHistory.map((item) => (
                  <tr key={item.id} className="hover:bg-cream/40">
                    <td className="p-3 text-muted">{formatDateAr(item.createdAt)}</td>
                    <td className="p-3 font-mono font-semibold text-forest-900">{item.fileName}</td>
                    <td className="p-3">
                      <span className="rounded-xl bg-forest-900/5 px-2 py-0.5 font-semibold text-forest-800">
                        {item.destination === "safety"
                          ? "نسخة أمان محلية"
                          : item.destination === "postgres"
                          ? "مزامنة سحابية"
                          : "ملف محلي"}
                      </span>
                    </td>
                    <td className="p-3">
                      <span
                        className={`inline-flex items-center gap-1 font-semibold ${
                          item.status === "success" ? "text-forest-800" : "text-danger"
                        }`}
                      >
                        {item.status === "success" ? (
                          <>
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            تم بنجاح وتأكيد التحقق
                          </>
                        ) : (
                          <>
                            <AlertCircle className="h-3.5 w-3.5" />
                            فشل: {item.errorMessage}
                          </>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Restore Confirmation & Passphrase Modal */}
      {restoreModalOpen && restoreTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-forest-950/60 p-4">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-forest-900/10 pb-4">
              <h2 className="text-xl font-bold text-forest-900">استعادة نسخة احتياطية</h2>
              <Button variant="ghost" size="sm" onClick={() => setRestoreModalOpen(false)}>
                <X className="h-5 w-5" />
              </Button>
            </div>

            <div className="mt-4 space-y-4">
              <div className="rounded-2xl bg-cream/70 p-3 text-xs text-forest-900">
                <p className="font-bold">الملف المختار:</p>
                <p className="font-mono mt-0.5">{restoreTarget.fileName}</p>
              </div>

              <Field label="أدخل عبارة المرور لفك التشفير *">
                <Input
                  type="password"
                  autoFocus
                  placeholder="عبارة المرور الخاصة بالنسخة..."
                  value={restorePassphrase}
                  onChange={(e) => setRestorePassphrase(e.target.value)}
                />
              </Field>

              {previewError && (
                <div className="rounded-2xl bg-red-50 p-3 text-xs font-semibold text-danger border border-red-200">
                  {previewError}
                </div>
              )}

              {previewData && (
                <div className="rounded-2xl bg-forest-50 p-4 border border-forest-900/10 space-y-2 text-xs">
                  <p className="font-bold text-forest-900 text-sm">تفاصيل محتوى النسخة المعتمدة:</p>
                  <p className="text-muted">تاريخ النسخة: {formatDateAr(previewData.createdAt)}</p>
                  <p className="text-muted">إصدار المخطط: v{previewData.schemaVersion}</p>
                  <div className="grid grid-cols-2 gap-1 pt-1 font-semibold text-forest-800">
                    <span>الحركات: {previewData.recordCounts.transactions || 0}</span>
                    <span>الفواتير: {previewData.recordCounts.invoices || 0}</span>
                    <span>الأشخاص: {previewData.recordCounts.people || 0}</span>
                    <span>قيود السجل: {previewData.recordCounts.ledgerEvents || 0}</span>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 border-t border-forest-900/10 pt-4">
                <Button variant="secondary" onClick={() => setRestoreModalOpen(false)}>
                  إلغاء
                </Button>
                {!previewData ? (
                  <Button variant="primary" onClick={handlePreviewRestore}>
                    فك التشفير ومعاينة المحتوى
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    disabled={restoring}
                    onClick={handleExecuteRestore}
                    className="bg-danger hover:bg-danger/90"
                  >
                    {restoring ? "جاري الاستعادة..." : "تأكيد استبدال البيانات الحالية"}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
