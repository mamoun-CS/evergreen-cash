import { NextResponse } from "next/server";

function withCors(request: Request, response: NextResponse): NextResponse {
  const origin = request.headers.get("origin");
  let allowedOrigin = origin === "capacitor://localhost";
  if (origin) {
    try {
      const parsed = new URL(origin);
      allowedOrigin ||= parsed.protocol === "http:" && parsed.hostname === "localhost";
    } catch {
      allowedOrigin = false;
    }
  }
  if (allowedOrigin && origin) response.headers.set("Access-Control-Allow-Origin", origin);
  response.headers.set("Vary", "Origin");
  response.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  response.headers.set("Access-Control-Max-Age", "86400");
  return response;
}

export function GET(request: Request) {
  return withCors(request, NextResponse.json({ ok: true, timestamp: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } }));
}

export function OPTIONS(request: Request) {
  return withCors(request, new NextResponse(null, { status: 204 }));
}
