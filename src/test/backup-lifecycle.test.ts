import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { getDb, ensureDefaults } from "@/lib/db/database";
import { createAutomaticBackup } from "@/lib/backup/service";

describe("دورة النسخ الاحتياطي المحلي", () => {
  it("يحفظ النسخ مشفرة ويحتفظ بالعدد المحدد ويحدث وقت النجاح", async () => {
    const db = getDb();
    await db.delete();
    await db.open();
    await ensureDefaults(db);
    await createAutomaticBackup("عبارة اختبار قوية وآمنة", 2);
    await createAutomaticBackup("عبارة اختبار قوية وآمنة", 2);
    await createAutomaticBackup("عبارة اختبار قوية وآمنة", 2);
    expect(await db.localBackups.count()).toBe(2);
    expect((await db.settings.get("app"))?.lastSuccessfulBackupAt).toBeTruthy();
    const local = await db.localBackups.toArray();
    expect(local.every((backup) => backup.bytes.byteLength > 100)).toBe(true);
    await db.delete();
  });

  it("لا يسجل نجاحاً إذا تعذر اشتقاق مفتاح التشفير", async () => {
    const db = getDb();
    await db.delete();
    await db.open();
    await ensureDefaults(db);
    await expect(createAutomaticBackup("قصير", 3)).rejects.toThrow("10 أحرف على الأقل");
    expect(await db.localBackups.count()).toBe(0);
    await db.delete();
  });
});
