import { NextResponse } from "next/server";
import { getDbUrl, initPostgresTables, query } from "@/lib/server/postgres";

interface SyncStateRow {
  id: string;
  company_name: string;
  updated_at: string;
  record_counts: Record<string, number>;
  checksum: string;
  data: Record<string, unknown[]>;
}

/**
 * GET: Pull latest state from Postgres database
 */
export async function GET() {
  const dbUrl = getDbUrl();
  if (!dbUrl) {
    return NextResponse.json({ error: "Postgres database not configured" }, { status: 503 });
  }

  try {
    await initPostgresTables();
    const rows = await query<SyncStateRow>(
      `SELECT id, company_name, updated_at, record_counts, checksum, data
       FROM egc_sync_state
       WHERE id = $1
       LIMIT 1`,
      ["primary"]
    );

    if (!rows || rows.length === 0) {
      return NextResponse.json({ exists: false, data: null });
    }

    const row = rows[0];
    return NextResponse.json({
      exists: true,
      updatedAt: row.updated_at,
      checksum: row.checksum,
      recordCounts: row.record_counts,
      data: row.data,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Sync pull failed";
    console.error("Sync pull error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST: Push latest local state to Postgres database
 */
export async function POST(req: Request) {
  const dbUrl = getDbUrl();
  if (!dbUrl) {
    return NextResponse.json({ error: "Postgres database not configured" }, { status: 503 });
  }

  try {
    await initPostgresTables();
    const body = await req.json();
    const { data, recordCounts, checksum, companyName = "EVER GREEN" } = body;

    if (!data || !recordCounts || !checksum) {
      return NextResponse.json({ error: "Invalid sync payload" }, { status: 400 });
    }

    // Upsert primary state into Postgres
    await query(
      `INSERT INTO egc_sync_state (id, company_name, updated_at, record_counts, checksum, data)
       VALUES ($1, $2, NOW(), $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET
         company_name = EXCLUDED.company_name,
         updated_at = NOW(),
         record_counts = EXCLUDED.record_counts,
         checksum = EXCLUDED.checksum,
         data = EXCLUDED.data`,
      ["primary", companyName, JSON.stringify(recordCounts), checksum, JSON.stringify(data)]
    );

    // Record sync history
    const historyId = `sync_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const userAgent = req.headers.get("user-agent") || "unknown";

    await query(
      `INSERT INTO egc_sync_history (id, synced_at, client_checksum, device_info)
       VALUES ($1, NOW(), $2, $3)`,
      [historyId, checksum, userAgent]
    );

    return NextResponse.json({ success: true, syncedAt: new Date().toISOString() });
  } catch (err: unknown) {
    // If request was aborted by client disconnect or navigation, ignore cleanly
    if (err instanceof Error && (err.name === "AbortError" || (err as { code?: string }).code === "ECONNRESET")) {
      return new Response(null, { status: 499 });
    }
    const message = err instanceof Error ? err.message : "Sync push failed";
    console.error("Sync push error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
