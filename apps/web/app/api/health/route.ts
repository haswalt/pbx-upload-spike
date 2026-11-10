import type { NextRequest } from "next/server";
import { handleError, json } from "@/lib/server/http";
import { probeDelegation } from "@/lib/server/storage";

export const dynamic = "force-dynamic";

/**
 * GET /api/health          — liveness, no Azure calls.
 * GET /api/health?deep=1   — proves the server identity can obtain a user
 *                            delegation key (cached, so cheap after the first call).
 */
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("deep") !== "1") {
    return json({ status: "ok" });
  }
  try {
    const started = performance.now();
    await probeDelegation();
    return json({ status: "ok", storage: "ok", delegationKeyMs: Math.round(performance.now() - started) });
  } catch (err) {
    return handleError("health", err);
  }
}
