"use client";
import { useCallback, useRef } from "react";

// Paste commits individual cells. Keep their DOM and drafts mounted until the
// whole batch has finished; a failed batch must remain visible for correction.
export function useBatchedRefresh(onRefresh: () => void) {
  const batching = useRef(false);
  const beginBatch = useCallback(() => { batching.current = true; }, []);
  const endBatch = useCallback(() => { batching.current = false; }, []);
  const refresh = useCallback(() => {
    if (!batching.current) onRefresh();
  }, [onRefresh]);
  return { beginBatch, endBatch, refresh };
}
