"use client";

import { useEffect, useState } from "react";
import { formatDateAr } from "@/lib/time";
import {
  backupToGoogleDrive,
  exportEncryptedFile,
  restoreFromBytes,
  restoreFromGoogle,
  previewEncryptedBackup,
  listLocalBackupMeta,
  listRemoteBackups,
  type BackupDocument,
} from "@/lib/backup/service";
import { connectGoogle, clearGoogleToken, loadToken, type DriveBackupFile } from "@/lib/google/drive";
import { Card, Button, Input, Field } from "@/components/ui/primitives";
import { useApp } from "@/components/providers";
import {
  UploadCloud,
  FileKey,
  HardDriveDownload,
  Lock,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  X,
} from "lucide-react";
import type { BackupMetaRecord } from "@/lib/finance/types";

export function BackupScreen() {
  const { bump, refresh, toast, online } = useApp();
  const [localHistory, setLocalHistory] = useState<BackupMetaRecord[]>([]);
  const [remoteFiles, setRemoteFiles] = useState<DriveBackupFile[]>([]);
  const [googleConnected, setGoogleConnected] = useState(false);

  // Backup passphrases
  const [passphrase, setPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [backingUp, setBackingUp] = useState(false);

  // Restore states
  const [restoreModalOpen, setRestoreModalOpen] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<
    | { type: "drive"; file: DriveBackupFile }
    | { type: "file"; bytes: Uint8Array; fileName: string }
    | null
  >(null);
  const [restorePassphrase, setRestorePassphrase] = useState("");
  const [previewData, setPreviewData] = useState<BackupDocument | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const token = loadToken();
      setGoogleConnected(Boolean(token));
      const history = await listLocalBackupMeta();
      if (!cancelled) setLocalHistory(history);
      if (token && online) {
        try {
          const files = await listRemoteBackups();
          if (!cancelled) setRemoteFiles(files);
        } catch {
          // Token might need re-auth
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [bump, online]);

  async function handleConnectGoogle() {
    try {
      await connectGoogle();
      setGoogleConnected(true);
      toast("تم الاتصال بـ Google Drive بنجاح", "ok");
      const files = await listRemoteBackups();
      setRemoteFiles(files);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "فشل ربط حساب Google";
      toast(msg, "err");
    }
  }

  function handleDisconnectGoogle() {
    clearGoogleToken();
    setGoogleConnected(false);
    setRemoteFiles([]);
    toast("تم فصل Google Drive من الجلسة الحالية", "ok");
  }

  async function handleManualDriveBackup() {
    if (!passphrase) {
      toast("يرجى إدخال عبارة مرور لتشفير النسخة الاحتياطية (10 أحرف كحد أدنى)", "warn");
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
      const meta = await backupToGoogleDrive(passphrase);
      toast(`تم أخذ نسخة مشفرة AES-256 ورفعها إلى Google Drive (${meta.fileName})`, "ok");
      setPassphrase("");
      setConfirmPassphrase("");
      await refresh();
      const files = await listRemoteBackups();
      setRemoteFiles(files);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "فشل النسخ الاحتياطي إلى Drive";
      toast(msg, "err");
    } finally {
      setBackingUp(false);
    }
  }

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
      setRestoreTarget({ type: "file", bytes, fileName: file.name });
      setRestorePassphrase("");
      setPreviewData(null);
      setPreviewError("");
      setRestoreModalOpen(true);
    } catch {
      toast("فشل قراءة الملف المختار", "err");
    }
  }

  async function handleSelectRemoteFile(file: DriveBackupFile) {
    setRestoreTarget({ type: "drive", file });
    setRestorePassphrase("");
    setPreviewData(null);
    setPreviewError("");
    setRestoreModalOpen(true);
  }

  async function handlePreviewRestore() {
    if (!restoreTarget) return;
    if (!restorePassphrase) {
      setPreviewError("أدخل عبارة المرور لفك التشفير");
      return;
    }

    try {
      setPreviewError("");
      let bytes: Uint8Array;
      if (restoreTarget.type === "drive") {
        const { downloadAppData } = await import("@/lib/google/drive");
        bytes = await downloadAppData(restoreTarget.file.id);
      } else {
        bytes = restoreTarget.bytes;
      }

      const preview = await previewEncryptedBackup(bytes, restorePassphrase);
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
      if (restoreTarget.type === "drive") {
        await restoreFromGoogle(restoreTarget.file.id, restorePassphrase);
      } else {
        await restoreFromBytes(restoreTarget.bytes, restorePassphrase);
      }
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

  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-forest-900 sm:text-3xl">النسخ الاحتياطي والاستعادة المشفرة</h1>
        <p className="text-sm text-muted">
          حماية بيانات الصندوق بتشفير AES-256-GCM ورفعها إلى Google Drive أو تصديرها كملف محلي آمن
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
              يتم تشفير قاعدة بيانات الصندوق على جهازك قبل رفعها أو تصديرها باستخدام مفتاح يُشتق من عبارة المرور (PBKDF2 مع 310,000 دورة). لا تحتفظ خوادم Google ولا أي طرف ثالث بنسخة من مفتاح فك التشفير.
            </p>
          </div>
        </div>
      </Card>

      {/* Google Drive Status & Connection */}
      <Card>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className={`rounded-2xl p-3 ${googleConnected ? "bg-forest-100 text-forest-800" : "bg-cream text-muted"}`}>
              <UploadCloud className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-forest-900">حساب Google Drive (مجلد التطبيق المخفي)</h2>
              <p className="text-xs text-muted">
                {googleConnected
                  ? "متصل — النسخ تُحفظ بأمان في مجلد التطبيق المخصص (drive.appdata)"
                  : clientId
                  ? "غير متصل — اضغط للربط وتفعيل النسخ السحابي المشفر"
                  : "يلزم ضبط معرف العميل NEXT_PUBLIC_GOOGLE_CLIENT_ID في بيئة العمل"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {googleConnected ? (
              <Button variant="secondary" size="sm" onClick={handleDisconnectGoogle}>
                فصل الحساب
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={handleConnectGoogle}
                disabled={!online || !clientId}
                className="flex items-center gap-2"
              >
                <UploadCloud className="h-4 w-4" />
                ربط Google Drive
              </Button>
            )}
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
            variant="primary"
            onClick={handleManualDriveBackup}
            disabled={backingUp || !googleConnected || !online}
            className="flex items-center gap-2"
          >
            <UploadCloud className="h-4 w-4" />
            {backingUp ? "جاري التشفير والرفع..." : "تشفير ورفع إلى Google Drive"}
          </Button>

          <Button
            variant="secondary"
            onClick={handleExportFileBackup}
            disabled={backingUp}
            className="flex items-center gap-2"
          >
            <HardDriveDownload className="h-4 w-4" />
            تصدير ملف مشفر (.egc) لجهاز iPad
          </Button>
        </div>
      </Card>

      {/* Restore Section */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Remote Google Drive Backups */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-forest-900">نسخ Google Drive السحابية</h2>
            {googleConnected && (
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  try {
                    const files = await listRemoteBackups();
                    setRemoteFiles(files);
                    toast("تم تحديث قائمة النسخ من Drive", "ok");
                  } catch {
                    toast("تعذر تحديث النسخ", "warn");
                  }
                }}
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            )}
          </div>

          {!googleConnected ? (
            <p className="text-xs text-muted text-center py-8">اربط حساب Google لعرض النسخ السحابية المتوفرة.</p>
          ) : remoteFiles.length === 0 ? (
            <p className="text-xs text-muted text-center py-8">لا توجد نسخ سحابية في حسابك حالياً.</p>
          ) : (
            <div className="divide-y divide-forest-900/10">
              {remoteFiles.map((file) => (
                <div key={file.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="font-mono text-xs font-bold text-forest-900">{file.name}</p>
                    <p className="text-[11px] text-muted">
                      {file.modifiedTime ? formatDateAr(file.modifiedTime) : "-"}
                    </p>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => handleSelectRemoteFile(file)}>
                    استعادة
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Local File Import */}
        <Card className="flex flex-col justify-between">
          <div>
            <h2 className="text-lg font-bold text-forest-900 mb-2">استعادة من ملف مشفر خارجي</h2>
            <p className="text-xs text-muted mb-6 leading-relaxed">
              يمكنك استعادة قاعدة البيانات من أي ملف نسخة احتياطية (.egc) تم تنزيله سابقاً أو نقله عبر تطبيق Files أو AirDrop بدون الحاجة للاتصال بالإنترنت.
            </p>
          </div>

          <label className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-forest-900/20 bg-cream/40 p-6 cursor-pointer hover:bg-cream/80 transition">
            <FileKey className="h-8 w-8 text-forest-800 mb-2" />
            <span className="text-sm font-bold text-forest-900">اضغط لاختيار ملف نسخة (.egc)</span>
            <span className="text-xs text-muted mt-1">من تطبيق Files أو التخزين الداخلي</span>
            <input type="file" accept=".egc" className="hidden" onChange={handleFileSelected} />
          </label>
        </Card>
      </div>

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
                        {item.destination === "google_drive"
                          ? "Google Drive"
                          : item.destination === "safety"
                          ? "نسخة أمان محلية"
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
                <p className="font-bold">المصدر المختار:</p>
                <p className="font-mono mt-0.5">
                  {restoreTarget.type === "drive" ? restoreTarget.file.name : restoreTarget.fileName}
                </p>
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
