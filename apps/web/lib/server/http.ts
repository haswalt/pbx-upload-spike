import "server-only";
import { NextResponse } from "next/server";
import type { ApiError } from "@/lib/contracts";
import { ConfigError } from "./env";
import { statusOf } from "./storage";

export function jsonError(status: number, error: string, message: string) {
  return NextResponse.json<ApiError>(
    { error, message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export function json<T>(body: T, status = 200) {
  return NextResponse.json<T>(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

/**
 * CSRF guard for cookie-authenticated mutations: require a same-origin
 * Origin header (the session cookie is also SameSite=Strict).
 */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Strip SAS query strings from anything that might end up in logs. */
export function redact(value: string): string {
  return value.replace(/([?&])(sig|se|st|sp|sv|skoid|sktid|skt|ske|sks|skv|sr|spr)=[^&\s"']*/gi, "$1$2=REDACTED");
}

/** Log server errors without leaking SAS tokens; map to a safe response. */
export function handleError(scope: string, err: unknown) {
  if (err instanceof ConfigError) {
    console.error(`[${scope}] config error: ${err.message}`);
    return jsonError(500, "server_misconfigured", err.message);
  }
  const status = statusOf(err);
  const code =
    typeof err === "object" && err && "code" in err
      ? String((err as { code?: unknown }).code)
      : undefined;
  const message = err instanceof Error ? redact(err.message).split("\n")[0] : String(err);
  console.error(`[${scope}] ${err instanceof Error ? err.name : "Error"} status=${status ?? "-"} code=${code ?? "-"}: ${message}`);
  const authFailure =
    err instanceof Error &&
    ["CredentialUnavailableError", "AggregateAuthenticationError", "AuthenticationError"].includes(err.name);
  if (status === 403 || authFailure) {
    return jsonError(502, "storage_auth_failed", "The server could not authenticate to Blob Storage");
  }
  return jsonError(500, "internal_error", "Unexpected server error");
}
