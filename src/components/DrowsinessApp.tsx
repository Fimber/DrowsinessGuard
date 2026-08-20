import { useCallback, useEffect, useRef, useState } from "react";
import {
  ALARM_DELAY_MAX_MS,
  ALARM_DELAY_MIN_MS,
  CALIBRATION_DURATION_MS,
} from "../constants";
import { useAlarm } from "../hooks/useAlarm";
import { useCalibration } from "../hooks/useCalibration";
import { useCamera } from "../hooks/useCamera";
import { useDrowsinessDetector } from "../hooks/useDrowsinessDetector";
import { useFaceLandmarker } from "../hooks/useFaceLandmarker";
import { useWakeLock } from "../hooks/useWakeLock";
import { StatusBadge } from "./StatusBadge";

function formatEar(value: number | null): string {
  return value == null ? "—" : value.toFixed(3);
}

export function DrowsinessApp() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runningRef = useRef(false);
  const startLockRef = useRef(false);

  const [session, setSession] = useState<
    "idle" | "starting" | "calibrating" | "monitoring"
  >("idle");
  const [liveEar, setLiveEar] = useState<number | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);

  const camera = useCamera(videoRef);
  const {
    phase: calPhase,
    progress: calProgress,
    message: calMessage,
    addSample,
    run: runCalibration,
    cancel: cancelCalibration,
  } = useCalibration();
  const {
    state,
    smoothedEar,
    config,
    baselineEAR: baseline,
    applyCalibration,
    update: updateDetector,
    setEarThreshold,
    setAlarmDelayMs,
    reset: resetDetector,
  } = useDrowsinessDetector();
  const alarm = useAlarm();
  const wakeLock = useWakeLock();

  const onFrame = useCallback(
    (frame: { ear: number | null; timestamp: number }) => {
      const rounded =
        frame.ear == null ? null : Math.round(frame.ear * 1000) / 1000;
      setLiveEar((prev) => (prev === rounded ? prev : rounded));
      addSample(frame.ear);
      updateDetector(frame.ear, frame.timestamp);
    },
    [addSample, updateDetector],
  );

  const landmarker = useFaceLandmarker({
    enabled: camera.isStreaming,
    showDebug,
    videoRef,
    canvasRef,
    onFrame,
  });

  const stop = useCallback(async () => {
    runningRef.current = false;
    startLockRef.current = false;
    cancelCalibration();
    resetDetector();
    alarm.stopAlarm();
    await wakeLock.release();
    camera.stop();
    setSession("idle");
    setLiveEar(null);
    setBusy(false);
  }, [alarm, cancelCalibration, camera, resetDetector, wakeLock]);

  const start = useCallback(async () => {
    if (startLockRef.current) return;
    startLockRef.current = true;
    setSessionError(null);
    setBusy(true);
    runningRef.current = true;
    setSession("starting");
    try {
      await alarm.unlock();
      if (!runningRef.current) return;
      await camera.start();
      if (!runningRef.current) return;
      await landmarker.ensureReady();
      if (!runningRef.current) return;
      await wakeLock.request();
      if (!runningRef.current) return;

      setSession("calibrating");
      while (runningRef.current) {
        const result = await runCalibration(CALIBRATION_DURATION_MS);
        if (!runningRef.current) return;
        if (result) {
          applyCalibration(result);
          setSession("monitoring");
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
    } catch (err) {
      runningRef.current = false;
      resetDetector();
      alarm.stopAlarm();
      await wakeLock.release();
      camera.stop();
      setSession("idle");
      setSessionError(err instanceof Error ? err.message : "Failed to start.");
    } finally {
      startLockRef.current = false;
      setBusy(false);
    }
  }, [
    alarm,
    applyCalibration,
    camera,
    landmarker.ensureReady,
    resetDetector,
    runCalibration,
    wakeLock,
  ]);

  useEffect(() => {
    if (session !== "monitoring") {
      alarm.stopAlarm();
      return;
    }
    if (state === "ALARM") {
      alarm.startAlarm();
      return () => alarm.stopAlarm();
    }
    if (state === "WARNING") {
      alarm.chime();
    } else {
      alarm.stopAlarm();
    }
  }, [alarm, state, session]);

  const monitoring = session === "monitoring";
  const calibrating = session === "calibrating" || calPhase === "retrying";
  const running = session !== "idle";
  const remainingSec = Math.max(
    1,
    Math.ceil((1 - calProgress) * (CALIBRATION_DURATION_MS / 1000)),
  );

  const sliderMin = baseline != null ? baseline * 0.45 : 0.1;
  const sliderMax =
    baseline != null
      ? Math.min(config.warnThreshold - 0.01, baseline * 0.75)
      : 0.3;

  const error =
    sessionError || camera.error || landmarker.error || null;

  return (
    <div
      className={`app ${monitoring ? `app--${state.toLowerCase()}` : ""}`}
    >
      <div className="vignette" aria-hidden="true" />

      <header className="topbar">
        <div>
          <p className="eyebrow">On-device · no data leaves this browser</p>
          <h1>Drowsiness Guard</h1>
        </div>
        <p className="disclaimer">
          Safety aid only — not a substitute for proper rest. Do not drive if
          you are tired.
        </p>
      </header>

      <div className="layout">
        <section className="stage">
          <div
            className={`viewport ${camera.facingMode === "user" ? "viewport--mirror" : ""}`}
          >
            <video
              ref={videoRef}
              className="viewport__video"
              autoPlay
              playsInline
              muted
            />
            <canvas ref={canvasRef} className="viewport__overlay" />

            {!running && (
              <div className="viewport__idle">
                <p>Camera preview appears here after Start.</p>
              </div>
            )}

            {calibrating && (
              <div className="cal-overlay">
                <div className="cal-overlay__time">{remainingSec}s</div>
                <p>{calMessage}</p>
                <div className="cal-bar">
                  <div
                    className="cal-bar__fill"
                    style={{ width: `${Math.round(calProgress * 100)}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </section>

        <aside className="hud">
          <StatusBadge
            state={state}
            active={monitoring}
            faceDetected={liveEar != null}
          />

          <dl className="metrics">
            <div>
              <dt>EAR</dt>
              <dd className="mono">{formatEar(monitoring ? smoothedEar : liveEar)}</dd>
            </div>
            <div>
              <dt>Baseline</dt>
              <dd className="mono">{formatEar(baseline)}</dd>
            </div>
            <div>
              <dt>Close thresh.</dt>
              <dd className="mono">{formatEar(monitoring ? config.earThreshold : null)}</dd>
            </div>
          </dl>

          <label className="slider">
            <span>
              Sensitivity
              <em>higher = alerts sooner</em>
            </span>
            <input
              type="range"
              min={sliderMin}
              max={Math.max(sliderMin + 0.01, sliderMax)}
              step={0.005}
              disabled={!monitoring}
              value={config.earThreshold}
              onChange={(e) => setEarThreshold(Number(e.target.value))}
            />
          </label>

          <label className="slider">
            <span>
              Alarm delay
              <em>{(config.alarmDelayMs / 1000).toFixed(1)}s closed</em>
            </span>
            <input
              type="range"
              min={ALARM_DELAY_MIN_MS}
              max={ALARM_DELAY_MAX_MS}
              step={50}
              disabled={!monitoring}
              value={config.alarmDelayMs}
              onChange={(e) => setAlarmDelayMs(Number(e.target.value))}
            />
          </label>

          <div className="actions">
            {running ? (
              <button type="button" className="btn btn--stop" onClick={() => void stop()}>
                Stop
              </button>
            ) : (
              <button
                type="button"
                className="btn btn--start"
                onClick={() => void start()}
                disabled={busy}
              >
                {busy || landmarker.status === "loading" ? "Starting…" : "Start"}
              </button>
            )}

            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => void camera.toggleFacingMode()}
              disabled={!running}
            >
              Camera: {camera.facingMode === "user" ? "front" : "rear"}
            </button>
          </div>

          <label className="check">
            <input
              type="checkbox"
              checked={showDebug}
              onChange={(e) => setShowDebug(e.target.checked)}
            />
            Debug overlay (eye landmarks)
          </label>

          {session === "starting" && (
            <p className="hint">Loading FaceLandmarker model…</p>
          )}
          {error && <p className="error">{error}</p>}
        </aside>
      </div>

      <footer className="footer">
        Face landmarks and EAR stay on this device. This is a safety aid, not a
        substitute for sleep.
      </footer>
    </div>
  );
}
