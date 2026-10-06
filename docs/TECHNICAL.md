# Technical Documentation — Drowsiness Guard

On-device driver drowsiness aid. A browser app that estimates eye openness from a live camera, calibrates to the driver, and escalates **AWAKE → WARNING → ALARM**. There is no backend: video, landmarks, and Eye Aspect Ratio (EAR) never leave the device.

This is a **safety aid, not a substitute for rest or an approved driver-monitoring system**. It can miss drowsiness, false-alarm, and fail under poor lighting, glasses glare, extreme head pose, or camera occlusion.

---

## 1. Scope

| In scope | Out of scope |
| --- | --- |
| Single-face EAR from MediaPipe FaceLandmarker | Server, accounts, telemetry |
| Per-driver open-eye calibration | Gaze / PERCLOS / yawn / steering |
| Time-based WARNING / ALARM with no-face fallback | Multi-occupant detection |
| Client-side audio + screen wake lock | Certified automotive ASIL / ISO 26262 |

**Stack:** React 18, TypeScript, Vite 6, `@mediapipe/tasks-vision@1.0.1` (FaceLandmarker, `VIDEO` mode).

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         DrowsinessApp                           │
│  session: idle → starting → calibrating → monitoring            │
└────────┬──────────┬───────────┬──────────┬──────────┬───────────┘
         │          │           │          │          │
    useCamera  useFaceLandmarker  useCalibration  useDrowsinessDetector
         │          │                  │                │
         │     detectForVideo          │         DrowsinessDetector
         │     computeEAR ─────────────┼────────────────┘
         │                             │
    <video>                      useAlarm (Web Audio)
    <canvas>                     useWakeLock (Screen Wake Lock)
```

Inference runs on the main thread via `requestAnimationFrame`. `detectForVideo` is synchronous; a typical laptop webcam stays interactive at ~30 fps. A web worker is not used.

### 2.1 Source layout

| Path | Role |
| --- | --- |
| `src/components/DrowsinessApp.tsx` | Session orchestration, HUD |
| `src/components/StatusBadge.tsx` | AWAKE / WARNING / ALARM lamp |
| `src/hooks/useCamera.ts` | `getUserMedia`, facing-mode toggle, track teardown |
| `src/hooks/useFaceLandmarker.ts` | Wasm + model load, rAF loop, EAR + debug overlay |
| `src/hooks/useCalibration.ts` | Timed sample collection |
| `src/hooks/useDrowsinessDetector.ts` | React wrapper around the detector class |
| `src/hooks/useAlarm.ts` | Chime + looping alarm |
| `src/hooks/useWakeLock.ts` | `navigator.wakeLock` |
| `src/lib/ear.ts` | Six-point EAR + landmark-index check |
| `src/lib/calibration.ts` | Trim / median / threshold derivation |
| `src/lib/DrowsinessDetector.ts` | State machine |
| `src/lib/drawLandmarks.ts` | Debug canvas |
| `src/constants.ts` | CDN URLs, timing, default thresholds |
| `src/types.ts` | Shared types |

---

## 3. Session lifecycle

`DrowsinessApp` owns a `session` discriminant: `idle | starting | calibrating | monitoring`.

**Start** (user gesture — required for camera + `AudioContext.resume()`):

1. Unlock Web Audio.
2. Open camera (`facingMode: "user"` by default).
3. Load FaceLandmarker (GPU delegate, CPU fallback).
4. Request a screen wake lock.
5. Run calibration (4 s). On failure, wait 1.2 s and retry. Never fall back to a generic EAR threshold.
6. `applyCalibration` → `session = monitoring`. Detector `update()` is ignored until this point.

**Per frame** (camera streaming):

```
detectForVideo(video, performance.now())
  → faceLandmarks[0] or empty
  → computeEAR(landmarks) | null
  → addSample(ear)          // no-op unless calibrating
  → detector.update(ear, t) // no-op unless monitoring
```

**Stop** cancels calibration, `detector.reset()`, stops alarm, releases wake lock, stops media tracks.

`runningRef` is checked after every `await` so Stop during model download cannot leak a camera or wake lock. `useCamera` uses a generation counter so an in-flight `getUserMedia` cannot reattach after Stop.

---

## 4. Camera

```ts
navigator.mediaDevices.getUserMedia({
  video: { facingMode: "user" | "environment" },
  audio: false,
});
```

- `<video autoPlay playsInline muted>` — `playsInline` + `muted` are required for autoplay on iOS.
- If `facingMode` is overconstrained, a second attempt uses `{ video: true }`.
- Mapped errors: `NotAllowedError`, `NotFoundError`, `NotReadableError`, `OverconstrainedError`, `SecurityError`.
- Front camera preview is CSS-mirrored (`scaleX(-1)` on video + overlay). EAR uses unmirrored normalized landmark coordinates; mirroring does not change distances.
- Camera access requires a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts): **localhost** or **HTTPS**. Vite binds `host: true` on port **5173**; LAN IPs usually will not get a camera permission on plain HTTP.

---

## 5. Face landmark detection

### 5.1 Runtime assets

Wasm and the npm package **must share the same version**. A mismatch throws `Calculator not found` at runtime.

| Asset | URL |
| --- | --- |
| Wasm fileset | `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm` |
| Model | `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task` |

Loaded with `FilesetResolver.forVisionTasks` + `FaceLandmarker.createFromOptions`.

### 5.2 Options

| Option | Value |
| --- | --- |
| `runningMode` | `"VIDEO"` |
| `numFaces` | `1` (enables landmark smoothing) |
| `minFaceDetectionConfidence` | `0.5` |
| `minFacePresenceConfidence` | `0.5` |
| `minTrackingConfidence` | `0.5` |
| `delegate` | `"GPU"`, then `"CPU"` |

`outputFaceBlendshapes` and transformation matrices are off. Detection uses **EAR only**, not blendshape `eyeBlinkLeft` / `eyeBlinkRight`.

### 5.3 Video loop

`detectForVideo(video, timestampMs)` requires a **monotonically increasing** timestamp. The loop:

- skips until `video.readyState >= 2` and `videoWidth > 0`
- skips duplicate `video.currentTime`
- skips non-increasing `performance.now()`
- catches exceptions and treats the frame as no-face (`ear = null`) so an empty result cannot crash the rAF loop

Empty `faceLandmarks` → `null` EAR. The state machine, not the landmarker hook, decides what that means.

The landmarker instance is kept for the page lifetime and `close()`d on unmount.

---

## 6. Eye Aspect Ratio

Soukupová & Čech (2016), six points per eye, Euclidean distance on **normalized x, y** (z is ignored so pose-induced depth does not dominate):

\[
\mathrm{EAR} = \frac{\|p_2-p_6\| + \|p_3-p_5\|}{2\,\|p_1-p_4\|}
\]

Per-frame value is the mean of left and right. Typical open EAR is ~0.25–0.35; closed is ~0.10–0.15. Absolute numbers vary by person, camera, and distance — that is why calibration exists.

### 6.1 Landmark indices

FaceLandmarker still uses the 468-point mesh (plus iris points 468–477). It does **not** export EAR index arrays. It exports `FACE_LANDMARKS_LEFT_EYE` / `FACE_LANDMARKS_RIGHT_EYE` as `Connection[]` (`{start, end}`) for drawing — a different API from `@mediapipe/face_mesh` `FACEMESH_*` sets.

Hardcoded six-point lists (classic EAR order `[p1, p2, p3, p4, p5, p6]`):

| Label in this codebase | Indices |
| --- | --- |
| `LEFT_EYE_EAR` (33-cluster) | `[33, 160, 158, 133, 153, 144]` |
| `RIGHT_EYE_EAR` (362-cluster) | `[362, 385, 387, 263, 373, 380]` |

**tasks-vision 1.0.1 naming:** `FACE_LANDMARKS_LEFT_EYE` is the **subject’s** left eye (362-cluster). `FACE_LANDMARKS_RIGHT_EYE` is the 33-cluster. Older tutorials often called the 33-cluster “left” because it sits on the left of a non-mirrored image (the subject’s right eye). Averaging both eyes makes the label swap irrelevant to the score.

`assertEarIndicesMatchInstalledModel()` checks that the six points are subsets of those connection graphs and `console.warn`s on topology skew instead of crashing.

If either eye is missing points or `landmarks.length < 468`, `computeEAR` returns `null`.

---

## 7. Calibration

Prompt: *“Look at the camera with your eyes open normally.”* Duration: **4000 ms**.

`finalizeCalibration(samples)`:

1. Reject if fewer than **40** finite EAR samples (face was missing / user looked away).
2. Sort ascending.
3. Drop lowest **20%** (blinks) and highest **5%** (landmark spikes).
4. Reject if fewer than **20** samples remain.
5. `baselineEAR` = median of the remainder (mean of the two central values when even).
6. `earThreshold = 0.65 × baseline` (closed).
7. `warnThreshold = 0.80 × baseline` (open enough to reset).

Failure returns `null`. The Start loop retries; it does not install a canned threshold.

After success, the sensitivity slider binds to `earThreshold` in `[0.45×baseline, min(warnThreshold−0.01, 0.75×baseline)]`. Raising it alerts sooner (eyes need not close as far). `warnThreshold` stays at the calibrated value so the open-eye reset band does not collapse.

---

## 8. Drowsiness state machine

`DrowsinessDetector.update(rawEAR, now) → "AWAKE" | "WARNING" | "ALARM"`.

Defaults (`src/constants.ts`):

| Parameter | Default | Meaning |
| --- | --- | --- |
| `earThreshold` | `0.2` until calibrated | Closed if smoothed EAR is below this |
| `warnThreshold` | `0.25` until calibrated | Open if smoothed EAR is at or above this |
| `warnDelayMs` | `700` | Time in the non-open band before WARNING |
| `alarmDelayMs` | `1500` (slider 900–3000) | Time fully closed (or no-face) before ALARM |
| `smoothWindow` | `4` frames | Rolling mean against single-frame jitter |

When the alarm-delay slider moves, `warnDelayMs = min(700, alarmDelayMs × 0.47)` so WARNING always fires first.

### 8.1 Face present

```
smoothed = mean(last smoothWindow raw EAR values)

if smoothed >= warnThreshold:
    clear closedSince; state = AWAKE
else:
    start/continue closedSince
    closedFor = now - closedSince
    if smoothed < earThreshold AND closedFor >= alarmDelayMs → ALARM
    else if closedFor >= warnDelayMs → WARNING
    else hold (blink; ~150–250 ms never crosses 700 ms)
```

One `closedSince` drives both delays. Partial closure (`earThreshold ≤ EAR < warnThreshold`) can reach WARNING but not ALARM until EAR is actually below `earThreshold` for `alarmDelayMs` of that same timer.

### 8.2 No face (`rawEAR === null`)

A slumped head that leaves the frame produces **no EAR**. A pure-EAR detector would stay AWAKE forever.

```
start/continue noFaceSince (reset when a face returns)
gone = now - noFaceSince
if gone >= alarmDelayMs → ALARM
else if gone >= warnDelayMs → WARNING
else hold   // brief loss: mirror check, tracker glitch
```

`closedSince` is not mixed with the no-face timer.

```
          smoothed ≥ warnThreshold
     ┌──────────────────────────────────┐
     │                                  │
     ▼                                  │
 ┌────────┐  closedFor ≥ warnDelay   ┌──────────┐  ear < thresh
 │ AWAKE  │ ───────────────────────► │ WARNING  │  AND closedFor
 └────────┘                          └──────────┘  ≥ alarmDelay
     ▲                                  │                │
     │         open eyes                │                ▼
     └──────────────────────────────────┘          ┌─────────┐
                                                   │  ALARM  │
                                                   └─────────┘
 No-face uses the same WARNING/ALARM delays on noFaceSince.
```

`reset()` clears state, both timers, and the EAR history.

---

## 9. Audio

Driven by **state transitions**, not raw EAR (`useEffect` on `state` while `session === "monitoring"`).

| State | Sound |
| --- | --- |
| WARNING | One-shot two-tone sine chime (C5 523 Hz, E5 659 Hz). **Not looped.** |
| ALARM | Looping 880 Hz **square** wave; gain pulsed on/off by a ~6 Hz square LFO. Stops immediately on leaving ALARM. |
| AWAKE / not monitoring | `stopAlarm()` |

`AudioContext` is created/resumed in `unlock()` from the Start click so autoplay policy does not mute the first warning.

---

## 10. Screen wake lock

`navigator.wakeLock.request("screen")` while detecting. Re-acquired on `visibilitychange` → `visible`. Released on Stop / unmount. Missing API or battery-saver rejection is ignored; detection still runs.

---

## 11. UI

- Large Start / Stop, live preview, facing-mode toggle (front / rear).
- Status badge: STANDBY, or AWAKE (green) / WARNING (amber) / ALARM (red) with `aria-live="assertive"`.
- Live EAR, calibrated baseline, closed-eye threshold.
- Sensitivity → `earThreshold`; delay → `alarmDelayMs`.
- Optional debug overlay: eye contours from FaceLandmarker connections + the six EAR points per eye.
- Persistent disclaimer: safety aid, not a substitute for rest.
- ALARM applies a pulsing red vignette.

---

## 12. Privacy and network

| Data | Leaves the device? |
| --- | --- |
| Camera frames | No |
| Landmarks / EAR | No |
| Audio | Generated locally, not captured |

**Does leave the device (first Start, then browser-cached):** wasm from jsDelivr and `face_landmarker.task` from Google Cloud Storage. After that, inference is local. There is no app analytics endpoint.

Vite `optimizeDeps.exclude` for `@mediapipe/tasks-vision` avoids pre-bundling the wasm loader incorrectly.

---

## 13. Browser support and limits

- Chromium-class browsers are the primary target (Wake Lock, WebGPU/WebGL for the GPU delegate, `getUserMedia`).
- Safari: `playsInline` + muted video; Wake Lock may be absent.
- Glasses, low light, backlight, large yaw/pitch, masks, and camera shake degrade EAR.
- Main-thread inference can hitch on low-end phones.
- No-face ALARM also fires if the driver is simply out of frame (leaning to the glovebox).
- Not validated against a drowsiness ground-truth corpus; thresholds are heuristics.

---

## 14. Build and run

```bash
npm install
npm run dev      # http://localhost:5173/
npm run build    # tsc --noEmit && vite build
npm run preview
```

Node.js with npm is required. First Start needs network for wasm + the `.task` model.

---

## 15. Tuning checklist

Change defaults in `src/constants.ts`:

- **More false alarms:** raise `BASELINE_EAR_FACTOR` (e.g. 0.70) or lower `warnDelayMs`.
- **Missed long blinks / microsleep:** lower `BASELINE_EAR_FACTOR` or `alarmDelayMs`.
- **Jittery badge:** increase `smoothWindow` (more lag).
- **Upgrade MediaPipe:** bump `TASKS_VISION_VERSION` and the npm pin **together**, then re-run the EAR index assertion against `FACE_LANDMARKS_*_EYE`.
