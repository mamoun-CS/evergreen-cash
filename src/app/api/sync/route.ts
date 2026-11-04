import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDbUrl, initPostgresTables, query } from "@/lib/server/postgres";

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const payloadSchema = z.object({
  companyName: z.string().max(200).optional(),
  checksum: z.string().regex(/^[a-f0-9]{64}$/i),
  recordCounts: z.record(z.string(), z.number().int().nonnegative()).optional(),
  ciphertext: z.string().min(1).max(MAX_BODY_BYTES * 2),
  iv: z.string().regex(/^[a-f0-9]{24}$/i),
  salt: z.string().regex(/^[a-f0-9]{32}$/i),
  kdfIterations: z.number().int().min(100_000).max(1_000_000),
  schemaVersion: z.number().int().positive(),
  revision: z.number().int().nonnegative(),
  baseRevision: z.number().int().nonnegative(),
  batchId: z.string().min(1).max(160),
}).strict();

interface SyncStateRow {
  updated_at: string;
  record_counts: Record<string, number>;
  checksum: string;
  data: Record<string, unknown[]>;
  revision: number;
}

const hits = new Map<string, { count: number; resetAt: number }>();
function responseError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}
function authorized(request: Request): boolean | null {
  const key = process.env.SYNC_API_KEY;
  if (!key) return null;
  const header = request.headers.get("authorization") || "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(supplied);
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}
function rateLimited(request: Request): boolean {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const now = Date.now();
  const slot = hits.get(ip);
  if (!slot || slot.resetAt <= now) {
    hits.set(ip, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  slot.count += 1;
  return slot.count > 60;
}
function gate(request: Request): NextResponse | null {
  const auth = authorized(request);
  if (auth === null) return responseError("مفتاح المزامنة غير مضبوط على الخادم", 503);
  if (!auth) return responseError("غير مصرح", 401);
  if (rateLimited(request)) return responseError("طلبات كثيرة، أعد المحاولة لاحقاً", 429);
  if (!getDbUrl()) return responseError("قاعدة البيانات السحابية غير مضبوطة", 503);
  return null;
}

export async function GET(request: Request) {
  const rejected = gate(request);
  if (rejected) return rejected;
  try {
    await initPostgresTables();
    const rows = await query<SyncStateRow>(
      `SELECT updated_at, record_counts, checksum, data, revision FROM egc_sync_state WHERE id = $1 LIMIT 1`,
      ["primary"],
    );
    if (!rows.length) return NextResponse.json({ exists: false, revision: 0 });
    const row = rows[0];
    const payload = row.data as unknown as Record<string, unknown>;
    return NextResponse.json({ exists: true, updatedAt: row.updated_at, checksum: row.checksum, recordCounts: row.record_counts, ...payload, revision: row.revision });
  } catch (error) {
    console.error("Sync pull error:", error);
    return responseError("تعذر جلب بيانات المزامنة", 500);
  }
}

export async function POST(request: Request) {
  const rejected = gate(request);
  if (rejected) return rejected;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return responseError("حجم طلب المزامنة أكبر من الحد المسموح", 413);
    let json: unknown;
    try { json = JSON.parse(raw); } catch { return responseError("صيغة طلب المزامنة غير صالحة", 400); }
    const parsed = payloadSchema.safeParse(json);
    if (!parsed.success) return responseError("بيانات المزامنة غير صالحة", 400);
    const body = parsed.data;
    const decoded = Buffer.from(body.ciphertext, "base64");
    if (decoded.toString("base64") !== body.ciphertext) return responseError("كتلة المزامنة المشفرة غير صالحة", 400);
    if (body.revision !== body.baseRevision + 1) return responseError("رقم إصدار المزامنة غير صالح", 400);
    await initPostgresTables();
    const priorBatch = await query<{ id: string }>(`SELECT id FROM egc_sync_history WHERE id = $1 LIMIT 1`, [body.batchId]);
    if (priorBatch.length) return NextResponse.json({ success: true, revision: body.revision, duplicate: true, syncedAt: new Date().toISOString() });
    const rows = await query<SyncStateRow>(`SELECT updated_at, record_counts, checksum, data, revision FROM egc_sync_state WHERE id = $1 LIMIT 1`, ["primary"]);
    const currentRevision = rows[0]?.revision ?? 0;
    const currentPayload = rows[0]?.data as unknown as Record<string, unknown> | undefined;
    if (body.baseRevision !== currentRevision) return NextResponse.json({ error: "توجد تغييرات أحدث على الخادم", exists: Boolean(rows[0]), revision: currentRevision, updatedAt: rows[0]?.updated_at, checksum: rows[0]?.checksum, recordCounts: rows[0]?.record_counts, ...currentPayload }, { status: 409 });
    const revision = body.revision;
    await query(
      `INSERT INTO egc_sync_state (id, company_name, updated_at, record_counts, checksum, data, revision)
       VALUES ($1, $2, NOW(), $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET company_name = EXCLUDED.company_name, updated_at = NOW(), record_counts = EXCLUDED.record_counts, checksum = EXCLUDED.checksum, data = EXCLUDED.data, revision = EXCLUDED.revision`,
      ["primary", body.companyName || "EVER GREEN", JSON.stringify(body.recordCounts || {}), body.checksum, JSON.stringify({ ciphertext: body.ciphertext, iv: body.iv, salt: body.salt, kdfIterations: body.kdfIterations, schemaVersion: body.schemaVersion }), revision],
    );
    await query(`INSERT INTO egc_sync_history (id, synced_at, client_checksum, device_info) VALUES ($1, NOW(), $2, $3)`, [body.batchId, body.checksum, request.headers.get("user-agent") || "unknown"]);
    await query(`DELETE FROM egc_sync_history WHERE id IN (SELECT id FROM egc_sync_history ORDER BY synced_at DESC OFFSET 100)`);
    return NextResponse.json({ success: true, revision, syncedAt: new Date().toISOString() });
  } catch (error) {
    console.error("Sync push error:", error);
    return responseError("تعذر رفع بيانات المزامنة", 500);
  }
}
