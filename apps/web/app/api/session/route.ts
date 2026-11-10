import type { SessionInfo } from "@/lib/contracts";
import { checkCredentials, endSession, getSession, startSession } from "@/lib/server/auth";
import { debugToolsEnabled } from "@/lib/server/env";
import { handleError, json, jsonError, sameOrigin } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getSession();
    return json<SessionInfo>({
      user: session ? { id: session.sub, role: session.role } : null,
      debugTools: debugToolsEnabled(),
    });
  } catch (err) {
    return handleError("session", err);
  }
}

/** Spike test login: { id, password } checked against SPIKE_USERS. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return jsonError(403, "bad_origin", "Cross-origin request rejected");
  try {
    const body = (await req.json().catch(() => null)) as { id?: unknown; password?: unknown } | null;
    if (typeof body?.id !== "string" || typeof body.password !== "string") {
      return jsonError(400, "bad_request", "id and password are required");
    }
    const user = checkCredentials(body.id, body.password);
    if (!user) return jsonError(401, "invalid_credentials", "Unknown user or wrong password");
    await startSession(user.id, user.role);
    return json<SessionInfo>({ user: { id: user.id, role: user.role }, debugTools: debugToolsEnabled() });
  } catch (err) {
    return handleError("session", err);
  }
}

export async function DELETE(req: Request) {
  if (!sameOrigin(req)) return jsonError(403, "bad_origin", "Cross-origin request rejected");
  await endSession();
  return json({ ok: true });
}
