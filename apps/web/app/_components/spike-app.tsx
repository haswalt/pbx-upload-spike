"use client";

import { Diagnostics } from "./diagnostics";
import { Uploader } from "./uploader";

export function SpikeApp({ debugTools }: { debugTools: boolean }) {
  return (
    <>
      <Uploader />
      <Diagnostics debugTools={debugTools} />
    </>
  );
}
