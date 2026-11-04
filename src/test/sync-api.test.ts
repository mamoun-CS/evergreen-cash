import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock, initMock, dbUrlMock } = vi.hoisted(() => ({ queryMock: vi.fn(), initMock: vi.fn(), dbUrlMock: vi.fn() }));
vi.mock("@/lib/server/postgres", () => ({ query: queryMock, initPostgresTables: initMock, getDbUrl: dbUrlMock }));

describe("حماية واجهة المزامنة", () => {
  beforeEach(() => {
    vi.resetModules();
    queryMock.mockReset();
    initMock.mockReset();
    dbUrlMock.mockReturnValue("postgres://configured");
    process.env.SYNC_API_KEY = "api-test-key";
  });

  it("يرفض المفتاح الغائب أو الخاطئ بـ401، ويعطي 503 عند غياب إعداد الخادم", async () => {
    const { GET } = await import("@/app/api/sync/route");
    expect((await GET(new Request("http://localhost/api/sync"))).status).toBe(401);
    expect((await GET(new Request("http://localhost/api/sync", { headers: { Authorization: "Bearer wrong" } }))).status).toBe(401);
    dbUrlMock.mockReturnValue("");
    expect((await GET(new Request("http://localhost/api/sync", { headers: { Authorization: "Bearer api-test-key" } }))).status).toBe(503);
  });

  it("يرفض JSON غير صالح بـ400", async () => {
    const { POST } = await import("@/app/api/sync/route");
    const response = await POST(new Request("http://localhost/api/sync", { method: "POST", headers: { Authorization: "Bearer api-test-key" }, body: "not-json" }));
    expect(response.status).toBe(400);
  });

  it("يعيد 409 مع الحالة المشفرة الحالية فقط ولا يسرّب بيانات خاماً", async () => {
    queryMock.mockResolvedValueOnce([]).mockResolvedValueOnce([{ revision: 8, updated_at: "now", checksum: "a".repeat(64), record_counts: {}, data: { ciphertext: "cipher-only", iv: "0".repeat(24), salt: "0".repeat(32), kdfIterations: 310000, schemaVersion: 3 } }]);
    const { POST } = await import("@/app/api/sync/route");
    const payload = { checksum: "b".repeat(64), ciphertext: "Y2lwaGVy", iv: "1".repeat(24), salt: "2".repeat(32), kdfIterations: 310000, schemaVersion: 3, baseRevision: 7, revision: 8, batchId: "batch-a" };
    const response = await POST(new Request("http://localhost/api/sync", { method: "POST", headers: { Authorization: "Bearer api-test-key", "Content-Type": "application/json" }, body: JSON.stringify(payload) }));
    expect(response.status).toBe(409);
    const json = await response.json();
    expect(json.ciphertext).toBe("cipher-only");
    expect(JSON.stringify(json)).not.toContain("settings");
  });

  it("يفرض حد الطلبات ويعيد429 بعد تجاوزه", async () => {
    queryMock.mockResolvedValue([]);
    const { GET } = await import("@/app/api/sync/route");
    let last: Response | undefined;
    for (let i = 0; i < 61; i += 1) last = await GET(new Request("http://localhost/api/sync", { headers: { Authorization: "Bearer api-test-key", "x-forwarded-for": "198.51.100.17" } }));
    expect(last?.status).toBe(429);
  });

  it("يسمح بطلبات CORS المسبقة من Capacitor وlocalhost", async () => {
    const { OPTIONS } = await import("@/app/api/sync/route");
    const native = OPTIONS(new Request("http://localhost/api/sync", { method: "OPTIONS", headers: { origin: "capacitor://localhost" } }));
    expect(native.status).toBe(204);
    expect(native.headers.get("Access-Control-Allow-Origin")).toBe("capacitor://localhost");
    expect(native.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");

    const local = OPTIONS(new Request("http://localhost/api/sync", { method: "OPTIONS", headers: { origin: "http://localhost:8100" } }));
    expect(local.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:8100");
  });

  it("يعيد ترويسات CORS لفحص الصحة أيضاً", async () => {
    const { GET } = await import("@/app/api/health/route");
    const response = GET(new Request("http://localhost/api/health", { headers: { origin: "capacitor://localhost" } }));
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("capacitor://localhost");
  });
});
