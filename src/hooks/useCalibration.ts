import { useCallback, useRef, useState } from "react";
import { CALIBRATION_DURATION_MS } from "../constants";
import { finalizeCalibration } from "../lib/calibration";
import type { CalibrationResult } from "../types";

export function useCalibration() {
  const [phase, setPhase] = useState<"idle" | "collecting" | "retrying">("idle");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState(
    "Look at the camera with your eyes open normally.",
  );
  const collectingRef = useRef(false);
  const samplesRef = useRef<number[]>([]);
  const runIdRef = useRef(0);

  const addSample = useCallback((ear: number | null) => {
    if (!collectingRef.current || ear == null) return;
    samplesRef.current.push(ear);
  }, []);

  const cancel = useCallback(() => {
    collectingRef.current = false;
    runIdRef.current += 1;
    setPhase("idle");
    setProgress(0);
  }, []);

  const run = useCallback(
    (durationMs: number = CALIBRATION_DURATION_MS): Promise<CalibrationResult | null> => {
      const runId = ++runIdRef.current;
      samplesRef.current = [];
      collectingRef.current = true;
      setPhase("collecting");
      setProgress(0);
      setMessage("Look at the camera with your eyes open normally.");

      return new Promise((resolve) => {
        const started = performance.now();

        const tick = () => {
          if (runId !== runIdRef.current) {
            resolve(null);
            return;
          }
          const elapsed = performance.now() - started;
          setProgress(Math.min(1, elapsed / durationMs));

          if (elapsed < durationMs && collectingRef.current) {
            requestAnimationFrame(tick);
            return;
          }

          collectingRef.current = false;
          if (runId !== runIdRef.current) {
            resolve(null);
            return;
          }

          const result = finalizeCalibration(samplesRef.current);
          if (!result) {
            setPhase("retrying");
            setProgress(0);
            setMessage(
              "Not enough valid samples — keep your face in view with eyes open. Recalibrating…",
            );
            resolve(null);
            return;
          }

          setPhase("idle");
          setProgress(1);
          setMessage("Calibration complete.");
          resolve(result);
        };

        requestAnimationFrame(tick);
      });
    },
    [],
  );

  return { phase, progress, message, addSample, run, cancel };
}
