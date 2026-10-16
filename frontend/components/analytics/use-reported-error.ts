"use client";

import { useEffect } from "react";
import { captureException } from "@/lib/analytics";

/**
 * React error boundaries swallow the error, so an `error.tsx` is the only place a render failure
 * can still be reported. The boundaries render the same fallback they always did; this only adds
 * the report.
 */
const reported = new WeakSet<object>();

export function useReportedError(error: Error, boundary: string): void {
  useEffect(() => {
    // Effects run twice under React's development double-invoke, and a boundary re-renders when
    // its sibling state changes. One report per error object.
    if (reported.has(error)) return;
    reported.add(error);
    captureException(error, {
      boundary,
      // Set by Next.js on a server-render failure, and the only way to tie this to the server log.
      digest: (error as Error & { digest?: string }).digest,
    });
  }, [error, boundary]);
}
