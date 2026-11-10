import { debugToolsEnabled } from "@/lib/server/env";
import { SpikeApp } from "./_components/spike-app";
import styles from "./_components/spike.module.css";

// Read SPIKE_DEBUG_TOOLS at request time, not build time.
export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <main className={styles.page}>
      <header>
        <h1>Azure direct-to-Blob upload spike</h1>
        <p className={styles.muted}>
          The browser asks this app for a short-lived, single-blob, write-only SAS, then PUTs bytes straight to
          Azure Blob Storage. No file bytes pass through the Next.js server.
        </p>
      </header>
      <SpikeApp debugTools={debugToolsEnabled()} />
    </main>
  );
}
