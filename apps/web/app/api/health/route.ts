import type { NextRequest } from "next/server";
import { getSession } from "@/lib/server/auth";
import { handleError, json } from "@/lib/server/http";
import { probeDelegation } from "@/lib/server/storage";

export const dynamic = "force-dynamic";

/**
 * GET /api/health          — liveness, no Azure calls.
 * GET /api/health?deep=1   — (signed-in only) proves the server identity can
 *                            obtain a user delegation key.
 */
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("deep") !== "1") {
    return json({ status: "ok" });
  }
  if (!(await getSession())) return json({ status: "ok", deep: "skipped_unauthenticated" });
  try {
    const started = performance.now();
    await probeDelegation();
    return json({ status: "ok", storage: "ok", delegationKeyMs: Math.round(performance.now() - started) });
  } catch (err) {
    return handleError("health", err);
  }
}
