import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { Role } from "@/lib/contracts";
import { spikeUsers } from "./env";
import { sign, verify } from "./signing";

export const SESSION_COOKIE = "spike_session";
const SESSION_TTL_SECONDS = 8 * 60 * 60;

export interface Session {
  sub: string;
  role: Role;
  exp: number;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function checkCredentials(id: string, password: string) {
  const user = spikeUsers().find((u) => u.id === id);
  // Compare digests so timing doesn't depend on password length.
  const ok =
    !!user && timingSafeEqual(digest(user.password), digest(password));
  return ok ? user : null;
}

export async function startSession(sub: string, role: Role) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  (await cookies()).set(SESSION_COOKIE, sign("session", { sub, role, exp }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function endSession() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function getSession(): Promise<Session | null> {
  return verify<Session>("session", (await cookies()).get(SESSION_COOKIE)?.value);
}
