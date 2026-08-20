import { useCallback, useRef, useState } from "react";
import {
  ALARM_DELAY_MAX_MS,
  ALARM_DELAY_MIN_MS,
  DEFAULT_DETECTOR_CONFIG,
  DEFAULT_WARN_DELAY_MS,
} from "../constants";
import { DrowsinessDetector } from "../lib/DrowsinessDetector";
import type { CalibrationResult, DetectorConfig, DrowsyState } from "../types";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function useDrowsinessDetector() {
  const detectorRef = useRef(new DrowsinessDetector(DEFAULT_DETECTOR_CONFIG));
  const activeRef = useRef(false);
  const [state, setState] = useState<DrowsyState>("AWAKE");
  const [smoothedEar, setSmoothedEar] = useState<number | null>(null);
  const [config, setConfig] = useState<DetectorConfig>(DEFAULT_DETECTOR_CONFIG);
  const [baselineEAR, setBaselineEAR] = useState<number | null>(null);

  const applyCalibration = useCallback((result: CalibrationResult) => {
    detectorRef.current.reset();
    detectorRef.current.setConfig({
      earThreshold: result.earThreshold,
      warnThreshold: result.warnThreshold,
    });
    setBaselineEAR(result.baselineEAR);
    setConfig(detectorRef.current.getConfig());
    setState("AWAKE");
    activeRef.current = true;
  }, []);

  const update = useCallback((rawEAR: number | null, now: number) => {
    if (!activeRef.current) return;
    const next = detectorRef.current.update(rawEAR, now);
    const ear = detectorRef.current.getSmoothedEar();
    const rounded = ear == null ? null : Math.round(ear * 1000) / 1000;
    setState((prev) => (prev === next ? prev : next));
    setSmoothedEar((prev) => (prev === rounded ? prev : rounded));
  }, []);

  const setEarThreshold = useCallback((earThreshold: number) => {
    const current = detectorRef.current.getConfig();
    const next = clamp(earThreshold, 0.05, current.warnThreshold - 0.01);
    detectorRef.current.setConfig({ earThreshold: next });
    setConfig(detectorRef.current.getConfig());
  }, []);

  const setAlarmDelayMs = useCallback((alarmDelayMs: number) => {
    const nextAlarm = clamp(alarmDelayMs, ALARM_DELAY_MIN_MS, ALARM_DELAY_MAX_MS);
    const warnDelayMs = Math.min(DEFAULT_WARN_DELAY_MS, nextAlarm * 0.47);
    detectorRef.current.setConfig({ alarmDelayMs: nextAlarm, warnDelayMs });
    setConfig(detectorRef.current.getConfig());
  }, []);

  const reset = useCallback(() => {
    activeRef.current = false;
    detectorRef.current.reset();
    setState("AWAKE");
    setSmoothedEar(null);
    setBaselineEAR(null);
    setConfig(DEFAULT_DETECTOR_CONFIG);
    detectorRef.current.setConfig(DEFAULT_DETECTOR_CONFIG);
  }, []);

  return {
    state,
    smoothedEar,
    config,
    baselineEAR,
    applyCalibration,
    update,
    setEarThreshold,
    setAlarmDelayMs,
    reset,
  };
}
