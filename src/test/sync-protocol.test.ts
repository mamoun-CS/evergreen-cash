import { describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { decryptBackupPayload, encryptBackupPayload } from "@/lib/crypto/backupCrypto";
import { canonicalize, parseAndValidateBackup } from "@/lib/backup/serialize";
import { sha256Hex } from "@/lib/hash";
import { BACKUP_FORMAT_VERSION, BACKUP_MAGIC, SCHEMA_VERSION, APP_VERSION } from "@/lib/version";
import { TABLE_NAMES } from "@/lib/db/database";
import { decodeRemoteSnapshot } from "@/lib/sync/autoSync";
import Dexie from "dexie";
import { EverGreenDatabase } from "@/lib/db/database";

describe("بروتوكول لقطة المزامنة", () => {
  const phrase = "عبارة مرور اختبار آمنة";
  const data = { settings: [{ companyName: "شركة" }], people: [{ id: "p1", fullName: "أحمد" }] };
  const doc = {
    magic: BACKUP_MAGIC,
    formatVersion: BACKUP_FORMAT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    createdAt: new Date().toISOString(),
    recordCounts: { settings: 1, people: 1 },
    checksum: "",
    data: Object.fromEntries(TABLE_NAMES.map((name) => [name, (data as Record<string, unknown[]>)[name] || []])),
  };

  it("يشفّر اللقطة وينزلها ويفكها ويتحقق من checksum البيانات", async () => {
    doc.checksum = await sha256Hex(canonicalize(doc.data));
    const encrypted = await encryptBackupPayload(JSON.stringify(doc), phrase);
    const downloaded = new Uint8Array(encrypted.bytes);
    const plain = await decryptBackupPayload(downloaded, phrase);
    const verified = await parseAndValidateBackup(plain);
    expect(verified.checksum).toBe(doc.checksum);
  });

  it("يرفض عبارة المرور الخاطئة والـ ciphertext المعدّل", async () => {
    const encrypted = await encryptBackupPayload(JSON.stringify(doc), phrase);
    await expect(decryptBackupPayload(encrypted.bytes, "عبارة أخرى غير صحيحة")).rejects.toThrow("فشل فك التشفير");
    const tampered = new Uint8Array(encrypted.bytes);
    tampered[tampered.length - 1] ^= 1;
    await expect(decryptBackupPayload(tampered, phrase)).rejects.toThrow("فشل فك التشفير");
  });

  it("يقبل checksum القديم المحسوب على كائن النسخة", async () => {
    const legacy = { ...doc, checksum: "" };
    const { checksum: _old, ...unsigned } = legacy;
    legacy.checksum = await sha256Hex(JSON.stringify(unsigned));
    const verified = await parseAndValidateBackup(JSON.stringify(legacy));
    expect(verified.checksum).toBe(legacy.checksum);
  });

  it("يقرأ تنسيق السحابة القديم ثم يعيد بناء checksum البيانات للتحويل المشفر", async () => {
    const tables = Object.fromEntries(TABLE_NAMES.map((name) => [name, [] as unknown[]]));
    tables.people = [{ id: "legacy-person", fullName: "بيانات سحابية قديمة" }];
    const legacy = {
      ...tables,
      exists: true,
      updatedAt: new Date().toISOString(),
      checksum: "a".repeat(64),
      recordCounts: Object.fromEntries(TABLE_NAMES.map((name) => [name, tables[name].length])),
      revision: 1,
    };

    const decoded = await decodeRemoteSnapshot(legacy, phrase);
    expect(decoded.legacyPlaintext).toBe(true);
    expect(decoded.document.data.people).toEqual(tables.people);
    expect(decoded.document.checksum).not.toBe(legacy.checksum);
  });

  it("يفك إطار اللقطة المشفرة الوارد من API ويتحقق من checksum", async () => {
    const encryptedDoc = { ...doc, checksum: await sha256Hex(canonicalize(doc.data)) };
    const encrypted = await encryptBackupPayload(JSON.stringify(encryptedDoc), phrase);
    const bytes = encrypted.bytes;
    const toHex = (value: Uint8Array) => Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
    const ciphertext = btoa(Array.from(bytes.slice(36), (byte) => String.fromCharCode(byte)).join(""));
    const kdfIterations = new DataView(bytes.buffer, bytes.byteOffset + 32, 4).getUint32(0, true);
    const decoded = await decodeRemoteSnapshot({
      ciphertext,
      salt: toHex(bytes.slice(4, 20)),
      iv: toHex(bytes.slice(20, 32)),
      kdfIterations,
      checksum: encryptedDoc.checksum,
    }, phrase);

    expect(decoded.legacyPlaintext).toBe(false);
    expect(decoded.document.checksum).toBe(encryptedDoc.checksum);
  });

  it("يرفض حالة سحابية ناقصة برسالة مفهومة بدلاً من دمج null", async () => {
    await expect(decodeRemoteSnapshot({ exists: true, revision: 2 }, phrase))
      .rejects.toThrow("صيغة بيانات السحابة القديمة غير مكتملة");
  });

  it("يرقي قاعدة v1 ببيانات فعلية وينشئ outbox دون فقدها", async () => {
    const name = "evergreen-cash";
    const old = new Dexie(name);
    old.version(1).stores({
      settings: "id", people: "id, fullName, phone, archived, createdAt",
      ledgerEvents: "id, sequence, type, transactionId, personId, invoiceId, occurredAt, createdAt, reversesEventId, currency",
      transactions: "id, referenceNumber, type, status, personId, occurredAt, invoiceId",
      invoices: "id, invoiceNumber, status, paymentStatus, customerId, issuedAt, createdAt",
      invoiceLines: "id, invoiceId", invoiceRevisions: "id, invoiceId, revision, createdAt",
      reconciliations: "id, occurredAt, createdAt", auditLogs: "id, entityType, entityId, createdAt",
      backupMeta: "id, createdAt, status, destination", sequences: "name", categories: "id, kind, name",
    });
    await old.open();
    await old.table("people").put({ id: "migration-person", fullName: "اختبار الترحيل", phone: "", archived: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    old.close();

    const upgraded = new EverGreenDatabase();
    await upgraded.open();
    expect(await upgraded.people.get("migration-person")).toBeTruthy();
    expect(upgraded.tables.some((table) => table.name === "outbox")).toBe(true);
    const queueItem = { id: "persisted-outbox", table: "people", recordId: "migration-person", op: "put" as const, createdAt: new Date().toISOString(), attempts: 0 };
    await upgraded.outbox.put(queueItem);
    upgraded.close();

    const reopened = new EverGreenDatabase();
    await reopened.open();
    expect(await reopened.people.get("migration-person")).toBeTruthy();
    expect(await reopened.outbox.get("persisted-outbox")).toMatchObject(queueItem);
    reopened.close();
    await reopened.delete();
  });
});
