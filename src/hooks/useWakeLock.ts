import { useCallback, useEffect, useRef } from "react";

export function useWakeLock() {
  const sentinelRef = useRef<WakeLockSentinel | null>(null);
  const desiredRef = useRef(false);

  const release = useCallback(async () => {
    desiredRef.current = false;
    const sentinel = sentinelRef.current;
    sentinelRef.current = null;
    if (sentinel && !sentinel.released) {
      try {
        await sentinel.release();
      } catch {
        // ignore
      }
    }
  }, []);

  const request = useCallback(async () => {
    desiredRef.current = true;
    if (!navigator.wakeLock) return;
    try {
      if (sentinelRef.current && !sentinelRef.current.released) {
        return;
      }
      const sentinel = await navigator.wakeLock.request("screen");
      sentinelRef.current = sentinel;
      sentinel.addEventListener("release", () => {
        if (sentinelRef.current === sentinel) {
          sentinelRef.current = null;
        }
      });
    } catch {
      // Wake Lock can fail on battery saver / unsupported browsers — detection still runs.
    }
  }, []);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible" && desiredRef.current) {
        void request();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      void release();
    };
  }, [release, request]);

  return { request, release };
}
