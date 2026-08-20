import {
  BASELINE_EAR_FACTOR,
  MIN_CALIBRATION_SAMPLES,
  MIN_TRIMMED_SAMPLES,
  WARN_EAR_FACTOR,
} from "../constants";
import type { CalibrationResult } from "../types";

function median(sorted: number[]): number {
  const n = sorted.length;
  const mid = Math.floor(n / 2);
  if (n % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

/**
 * Turn a stream of per-frame open-eye EAR samples into a personal baseline.
 *
 * 1. Sort.
 * 2. Drop the lowest 20% (blinks during the prompt) and the highest 5%
 *    (landmark spikes).
 * 3. Take the median of what remains — robust to leftover blinks.
 * 4. earThreshold = 0.65 × baseline, warnThreshold = 0.80 × baseline.
 *
 * Returns null when there were not enough valid faces. The caller must
 * re-run calibration rather than fall back to a generic threshold.
 */
export function finalizeCalibration(samples: number[]): CalibrationResult | null {
  if (samples.length < MIN_CALIBRATION_SAMPLES) return null;

  const sorted = [...samples].sort((a, b) => a - b);
  const dropLow = Math.floor(sorted.length * 0.2);
  const dropHigh = Math.floor(sorted.length * 0.05);
  const trimmed = sorted.slice(dropLow, sorted.length - dropHigh);

  if (trimmed.length < MIN_TRIMMED_SAMPLES) return null;

  const baselineEAR = median(trimmed);
  if (!Number.isFinite(baselineEAR) || baselineEAR <= 0) return null;

  return {
    baselineEAR,
    earThreshold: baselineEAR * BASELINE_EAR_FACTOR,
    warnThreshold: baselineEAR * WARN_EAR_FACTOR,
    sampleCount: samples.length,
  };
}
