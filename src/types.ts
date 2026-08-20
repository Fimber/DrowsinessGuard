export type DrowsyState = "AWAKE" | "WARNING" | "ALARM";
export type FacingMode = "user" | "environment";

export type DetectorConfig = {
  /** Eyes count as closed at or below this smoothed EAR (~0.65 × baseline). */
  earThreshold: number;
  /** Eyes count as fully open at or above this smoothed EAR (~0.80 × baseline). */
  warnThreshold: number;
  /** How long eyes must stay non-open before WARNING. Default 700 ms. */
  warnDelayMs: number;
  /** How long eyes must stay fully closed (or face lost) before ALARM. Default 1500 ms. */
  alarmDelayMs: number;
  /** Rolling average length in frames. Default 4. */
  smoothWindow: number;
};

export type CalibrationResult = {
  baselineEAR: number;
  earThreshold: number;
  warnThreshold: number;
  sampleCount: number;
};

export type Point2 = {
  x: number;
  y: number;
};
