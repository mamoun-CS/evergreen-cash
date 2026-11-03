import { createId } from "@/lib/ids";
import { nowIso } from "@/lib/time";
import { getDb } from "@/lib/db/database";
import { decryptBackupPayload, encryptBackupPayload } from "@/lib/crypto/backupCrypto";
import {
  parseAndValidateBackup,
  restoreSnapshot,
  serializeBackup,
  snapshotDatabase,
  type BackupDocument,
} from "@/lib/backup/serialize";
export type { BackupDocument };
import type { BackupMetaRecord } from "@/lib/finance/types";

function fileNameFor(date = new Date()): string {
  const stamp = date.toISOString().replace(/[:.]/g, "-");
  return `evergreen-cash-${stamp}.egc`;
}

export async function createEncryptedBackup(passphrase: string) {
  const snapshot = await snapshotDatabase();
  const json = serializeBackup(snapshot);
  const encrypted = await encryptBackupPayload(json, passphrase);
  return { snapshot, encrypted, fileName: fileNameFor() };
}

export async function exportEncryptedFile(passphrase: string): Promise<void> {
  const { snapshot, encrypted, fileName } = await createEncryptedBackup(passphrase);
  const blob = new Blob([encrypted.bytes as BlobPart], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
  await getDb().backupMeta.add({
    id: createId(),
    createdAt: nowIso(),
    status: "success",
    destination: "file",
    fileName,
    recordCountsJson: JSON.stringify(snapshot.recordCounts),
    verified: true,
  });
}

export async function previewEncryptedBackup(bytes: Uint8Array, passphrase: string): Promise<BackupDocument> {
  const json = await decryptBackupPayload(bytes, passphrase);
  return parseAndValidateBackup(json);
}

export async function restoreFromBytes(bytes: Uint8Array, passphrase: string): Promise<void> {
  const incoming = await previewEncryptedBackup(bytes, passphrase);
  const safety = await createEncryptedBackup(passphrase);
  await getDb().backupMeta.add({
    id: createId(),
    createdAt: nowIso(),
    status: "local",
    destination: "safety",
    fileName: `safety-${safety.fileName}`,
    recordCountsJson: JSON.stringify(safety.snapshot.recordCounts),
    verified: true,
  });
  try {
    await restoreSnapshot(incoming);
  } catch (error) {
    await restoreSnapshot(safety.snapshot);
    throw error;
  }
}

export async function listLocalBackupMeta(): Promise<BackupMetaRecord[]> {
  return getDb().backupMeta.orderBy("createdAt").reverse().toArray();
}


