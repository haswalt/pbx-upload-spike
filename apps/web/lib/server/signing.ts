import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { receiptSecret } from "./env";

/**
 * Minimal HMAC-signed tokens: base64url(json).base64url(hmac).
 * `purpose` is mixed into the MAC to keep token kinds separate.
 */

function mac(purpose: string, body: string): Buffer {
  return createHmac("sha256", receiptSecret())
    .update(`${purpose}\n${body}`)
    .digest();
}

export function sign(purpose: string, payload: object): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${mac(purpose, body).toString("base64url")}`;
}

export function verify<T extends { exp: number }>(
  purpose: string,
  token: string | undefined,
): T | null {
  if (!token) return null;
  const [body, sig, ...rest] = token.split(".");
  if (!body || !sig || rest.length) return null;
  const expected = mac(purpose, body);
  const actual = Buffer.from(sig, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as T;
    if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
