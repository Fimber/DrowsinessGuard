import type { DrowsyState } from "../types";

const COPY: Record<DrowsyState, { label: string; hint: string }> = {
  AWAKE: { label: "AWAKE", hint: "Eyes open" },
  WARNING: { label: "WARNING", hint: "Drowsiness signs" },
  ALARM: { label: "ALARM", hint: "Wake up" },
};

type Props = {
  state: DrowsyState;
  active: boolean;
  faceDetected: boolean;
};

export function StatusBadge({ state, active, faceDetected }: Props) {
  const copy = COPY[state];
  return (
    <div
      className={`badge badge--${state.toLowerCase()} ${active ? "badge--live" : ""}`}
      role="status"
      aria-live="assertive"
    >
      <span className="badge__lamp" />
      <div>
        <div className="badge__label">{active ? copy.label : "STANDBY"}</div>
        <div className="badge__hint">
          {!active
            ? "Press Start to calibrate"
            : !faceDetected
              ? "No face in view"
              : copy.hint}
        </div>
      </div>
    </div>
  );
}
