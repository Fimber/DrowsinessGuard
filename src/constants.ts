import type { DetectorConfig } from "./types";

/**
 * Pin wasm to the same version as the installed `@mediapipe/tasks-vision`
 * package. Mixing versions throws "Calculator not found" at runtime.
 */
export const TASKS_VISION_VERSION = "1.0.1";

export const WASM_FILES_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`;

export const FACE_LANDMARKER_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

export const CALIBRATION_DURATION_MS = 4000;
export const MIN_CALIBRATION_SAMPLES = 40;
export const MIN_TRIMMED_SAMPLES = 20;

export const BASELINE_EAR_FACTOR = 0.65;
export const WARN_EAR_FACTOR = 0.8;

export const DEFAULT_DETECTOR_CONFIG: DetectorConfig = {
  earThreshold: 0.2,
  warnThreshold: 0.25,
  warnDelayMs: 700,
  alarmDelayMs: 1500,
  smoothWindow: 4,
};

export const ALARM_DELAY_MIN_MS = 900;
export const ALARM_DELAY_MAX_MS = 3000;
export const DEFAULT_WARN_DELAY_MS = 700;
