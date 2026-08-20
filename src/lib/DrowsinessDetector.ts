import { DEFAULT_DETECTOR_CONFIG } from "../constants";
import type { DetectorConfig, DrowsyState } from "../types";

/**
 * Three-state drowsiness machine driven by smoothed EAR plus a no-face timer.
 *
 * AWAKE  → eyes open (smoothed EAR ≥ warnThreshold)
 * WARNING → eyes not fully open for ≥ warnDelayMs, or face missing that long
 * ALARM  → eyes fully closed for ≥ alarmDelayMs, or face missing that long
 *
 * One `closedSince` timestamp drives both eye-close delays so a normal blink
 * (~150–250 ms) never reaches WARNING, let alone ALARM.
 *
 * Face loss is tracked separately. A slumped head that leaves the frame
 * produces no EAR at all; treating that as "hold" forever would miss it.
 */
export class DrowsinessDetector {
  private config: DetectorConfig;
  private state: DrowsyState = "AWAKE";
  private closedSince: number | null = null;
  private noFaceSince: number | null = null;
  private earHistory: number[] = [];
  private smoothedEar: number | null = null;

  constructor(config: DetectorConfig = DEFAULT_DETECTOR_CONFIG) {
    this.config = { ...config };
  }

  getState(): DrowsyState {
    return this.state;
  }

  getSmoothedEar(): number | null {
    return this.smoothedEar;
  }

  getConfig(): DetectorConfig {
    return { ...this.config };
  }

  setConfig(partial: Partial<DetectorConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  reset(): void {
    this.state = "AWAKE";
    this.closedSince = null;
    this.noFaceSince = null;
    this.earHistory = [];
    this.smoothedEar = null;
  }

  /**
   * @param rawEAR  Average left/right EAR, or null when no face was detected.
   * @param now     Monotonic timestamp in ms (performance.now()).
   */
  update(rawEAR: number | null, now: number): DrowsyState {
    if (rawEAR == null) {
      return this.updateNoFace(now);
    }

    this.noFaceSince = null;
    this.smoothedEar = this.pushSmoothed(rawEAR);

    // Fully open — clear the close timer. This is the blink-reset path.
    if (this.smoothedEar >= this.config.warnThreshold) {
      this.closedSince = null;
      this.state = "AWAKE";
      return this.state;
    }

    // Eyes are not fully open. Start a single timer used for both thresholds.
    if (this.closedSince == null) {
      this.closedSince = now;
    }
    const closedFor = now - this.closedSince;

    if (
      this.smoothedEar < this.config.earThreshold &&
      closedFor >= this.config.alarmDelayMs
    ) {
      this.state = "ALARM";
    } else if (closedFor >= this.config.warnDelayMs) {
      this.state = "WARNING";
    }
    // else: still within a blink-length dip — hold current state (usually AWAKE)

    return this.state;
  }

  private updateNoFace(now: number): DrowsyState {
    this.smoothedEar = null;
    if (this.noFaceSince == null) {
      this.noFaceSince = now;
    }
    const gone = now - this.noFaceSince;

    if (gone >= this.config.alarmDelayMs) {
      this.state = "ALARM";
    } else if (gone >= this.config.warnDelayMs) {
      this.state = "WARNING";
    }
    // else: brief loss (mirror check / tracker glitch) — hold current state

    return this.state;
  }

  private pushSmoothed(rawEAR: number): number {
    this.earHistory.push(rawEAR);
    const extra = this.earHistory.length - this.config.smoothWindow;
    if (extra > 0) {
      this.earHistory.splice(0, extra);
    }
    const sum = this.earHistory.reduce((acc, v) => acc + v, 0);
    return sum / this.earHistory.length;
  }
}
