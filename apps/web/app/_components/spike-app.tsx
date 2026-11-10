"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { SessionInfo } from "@/lib/contracts";
import { ApiCallError, api } from "@/lib/client/api";
import { Diagnostics } from "./diagnostics";
import { Uploader } from "./uploader";
import styles from "./spike.module.css";

export function SpikeApp() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    api.session().then(setSession, (err: unknown) =>
      setLoadError(err instanceof ApiCallError ? err.message : "Could not load session"),
    );
  }, []);

  if (loadError) return <p className={styles.error}>{loadError}</p>;
  if (!session) return <p className={styles.muted}>Loading…</p>;
  if (!session.user) return <Login onSignedIn={setSession} />;

  return (
    <>
      <div className={styles.row}>
        <span className={styles.muted}>
          Signed in as <strong>{session.user.id}</strong> ({session.user.role})
        </span>
        <button
          className={styles.linkButton}
          onClick={async () => {
            await api.logout();
            setSession({ ...session, user: null });
          }}
        >
          Sign out
        </button>
      </div>
      {session.user.role === "viewer" && (
        <p className={styles.error}>
          The viewer role is not allowed to upload — requests will be rejected with 403. That&apos;s the point.
        </p>
      )}
      <Uploader />
      <Diagnostics debugTools={session.debugTools} />
    </>
  );
}

function Login({ onSignedIn }: { onSignedIn: (s: SessionInfo) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await api.login(String(data.get("id")), String(data.get("password"))));
    } catch (err) {
      setError(err instanceof ApiCallError ? err.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={`${styles.card} ${styles.login}`} onSubmit={submit}>
      <h2>Test sign-in</h2>
      <p className={styles.muted}>Spike-only auth. Users are configured via SPIKE_USERS.</p>
      <label>
        User
        <input name="id" autoComplete="username" required />
      </label>
      <label>
        Password
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      {error && <p className={styles.error}>{error}</p>}
      <button type="submit" disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
