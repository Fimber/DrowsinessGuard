# Driver Drowsiness Guard

Browser-only drowsiness aid. The camera feed, MediaPipe landmarks, and Eye Aspect Ratio (EAR) never leave this device — there is no backend.

This is a **safety aid, not a substitute for rest**. Do not drive if you are tired.

## Run

```bash
npm install
npm run dev
```

Open the printed local URL (typically `http://localhost:5173`). Camera access requires a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts): **localhost** or **HTTPS**.

```bash
npm run build
npm run preview
```

## Use

1. Sit so your face is clearly in the front camera (or flip to the rear camera if the phone is mounted facing you).
2. Press **Start**. The first click also unlocks audio (browser autoplay policy).
3. Look at the camera with your eyes open normally for about 4 seconds. Calibration drops blinks and outliers, then sets your personal EAR thresholds. If too few face samples are collected, calibration re-runs automatically.
4. Keep the tab visible. A screen wake lock is requested so the display does not sleep mid-drive.
5. **WARNING** plays a single chime. **ALARM** loops an urgent stutter until your eyes open (or a face returns).

The sensitivity slider trims the calibrated closed-eye EAR threshold. The delay slider changes how long eyes must stay closed before ALARM (WARNING stays shorter so blinks never fire).

First start downloads the MediaPipe wasm bundle and `face_landmarker.task` from a CDN (jsDelivr + Google storage). After that, inference is local.
