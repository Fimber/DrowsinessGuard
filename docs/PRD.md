# Product Requirements Document

**Product:** IsoSafe Drowsiness Guard  
**Version:** 1.0  
**Status:** Draft for production hosting  
**Based on:** current client-only app (`DrowsinessApp`, MediaPipe FaceLandmarker, EAR state machine)  
**Companion:** [TECHNICAL.md](./TECHNICAL.md)

---

## 1. Summary

IsoSafe Drowsiness Guard is a browser safety aid that watches a driver’s eyes on-device and escalates **AWAKE → WARNING → ALARM**. Today it is a static web app with **no server**. Video, face landmarks, and Eye Aspect Ratio (EAR) never leave the device.

Hosting it on the public internet does **not** mean moving detection to a backend. The camera still runs in the browser. A backend is only needed for product features the current app does not have: HTTPS delivery, pinned ML assets, accounts, fleet dashboards, and **opt-in event logs that contain no images**.

This PRD specifies:

1. How to ship the **existing** detector as a hosted product (Phase 0).
2. A **greenfield backend** for a multi-user / fleet product (Phases 1–3), designed around the current client so inference stays local.

**Legal / safety line (must appear in product UI and this spec):** this is a safety aid, not a substitute for rest, not a certified driver-monitoring system, not a medical device.

---

## 2. Problem

Tired driving is a leading crash factor. Phone-mount and laptop-in-cab users need a warning they can run without installing native software or sending a face video to a cloud.

The current prototype already does that, but only on `localhost`. Production users need:

- A URL that works on **HTTPS** (required for `getUserMedia`).
- Reliable model load (today wasm + `.task` come from third-party CDNs).
- Optional org features (who is driving which vehicle, how often ALARM fired) **without** uploading faces.

---

## 3. Goals and non-goals

### 3.1 Goals

| ID | Goal |
| --- | --- |
| G1 | Host the existing SPA so any modern browser can run detection over HTTPS. |
| G2 | Keep **all** camera frames, landmarks, and raw EAR time-series on the device by default. |
| G3 | Preserve current detection behaviour: personal calibration, blink-safe delays, no-face ALARM. |
| G4 | Serve MediaPipe wasm + `face_landmarker.task` from IsoSafe-controlled storage (same version pin as npm). |
| G5 | If a backend is built, it stores **events and settings**, never video or meshes. |
| G6 | Keep the disclaimer visible on every session. |

### 3.2 Non-goals (v1 backend)

| ID | Non-goal |
| --- | --- |
| NG1 | Server-side face detection or video upload. |
| NG2 | Replacing EAR with a cloud vision API. |
| NG3 | ISO 26262 / ASIL, UNECE R171, or medical-device certification. |
| NG4 | Gaze, PERCLOS, yawn, lane, or steering fusion (future). |
| NG5 | Multi-face / passenger detection. |
| NG6 | Real-time supervisor video of the driver. |
| NG7 | Rewriting the React detector as a native mobile app (PWA wrap is optional later). |

---

## 4. Current product (source of truth)

The backend must wrap this behaviour, not reinvent it.

### 4.1 Client session

`idle → starting → calibrating → monitoring`

Start (user gesture): unlock Web Audio → camera → load FaceLandmarker → wake lock → 4 s open-eye calibration → monitoring.

Stop: cancel calibration, reset detector, stop alarm, release wake lock, stop tracks.

### 4.2 Detection

| Piece | Current behaviour |
| --- | --- |
| Camera | `getUserMedia({ video: { facingMode }, audio: false })`; front/rear toggle |
| Model | `@mediapipe/tasks-vision@1.0.1`, `VIDEO` mode, 1 face, GPU then CPU |
| EAR | Six-point Soukupová & Čech; average of 33-cluster and 362-cluster; `null` if no face |
| Calibration | 4 s; drop lowest 20% + highest 5%; median; `earThreshold = 0.65 × baseline`; `warnThreshold = 0.80 × baseline`; retry if &lt; 40 samples |
| Smoothing | Rolling mean, 4 frames |
| WARNING | Non-open EAR for ≥ ~700 ms, or no face that long; **one** chime, not looped |
| ALARM | Fully closed EAR for ≥ 1500 ms (slider 900–3000), or no face that long; looping 880 Hz square stutter |
| No face | Separate timer; catches slumped head that leaves the frame |
| Privacy | No app backend; first load hits jsDelivr + Google model storage |

### 4.3 What “hosting online” actually requires

| Need | Backend? |
| --- | --- |
| HTTPS so the camera works | No — static host (Vercel, Netlify, Cloudflare Pages, S3+CloudFront, nginx) |
| Serve `index.html` + JS/CSS | No — Vite `npm run build` |
| Camera / EAR / alarm | No — already in the browser |
| Pin wasm + `.task` on our domain | Optional object storage + CDN, not an API |
| Login, orgs, trip history | Yes |
| Aggregated drowsiness events | Yes, **opt-in**, no images |

**Phase 0 is sufficient to “host it online.”** Phases 1–3 are the backend product.

---

## 5. Users

| Persona | Need |
| --- | --- |
| **Solo driver** | Open URL, grant camera, calibrate, drive. No account required. |
| **Fleet driver** | Same as solo, plus optional signed-in session that can attach a vehicle/trip id. |
| **Fleet supervisor** | Dashboard of **counts and timestamps** (WARNING/ALARM, no-face), not a live face feed. |
| **IsoSafe operator** | Deploy SPA, pin model versions, uptime, no access to user video. |

Default path is **anonymous solo driver**. Auth is never a gate to detection.

---

## 6. Privacy invariant (hard requirement)

The following **must not** be sent to IsoSafe servers (or any third party IsoSafe controls) unless a later version explicitly adds a separate, legally reviewed product with prominent consent — and even then, not in v1:

- Camera frames, thumbnails, recordings
- Face landmarks / blendshapes / meshes
- Per-frame EAR samples
- Debug overlay canvases

**Allowed to leave the device (Phase 0):** HTTP GET of static JS/CSS/wasm/model (same as any website).

**Allowed with explicit opt-in (Phase 2+):**

```ts
type DrowsinessEvent = {
  occurredAt: string;          // ISO-8601
  state: "WARNING" | "ALARM";
  trigger: "eyes_closed" | "no_face";
  durationMs: number;
  sessionId: string;           // random, client-generated
  vehicleId?: string;
  // NO ear, NO landmarks, NO image
};
```

Calibration numbers (`baselineEAR`, thresholds) stay local by default (localStorage). Syncing them to an account is Phase 3 and still must not include video.

---

## 7. Phased requirements

### Phase 0 — Host the existing app (no API)

**User story:** As a driver, I open `https://app.isosafe.example`, allow the camera, and get the same experience as localhost.

| ID | Requirement | Priority |
| --- | --- | --- |
| P0-1 | Production build of the current Vite SPA served over HTTPS. | Must |
| P0-2 | Camera, calibration, detector, audio, wake lock, disclaimer unchanged. | Must |
| P0-3 | Self-host or proxy wasm + `face_landmarker.task` at the **same version** as `@mediapipe/tasks-vision@1.0.1`. Mixing versions is a P0 bug (`Calculator not found`). | Must |
| P0-4 | `index.html` sends `Permissions-Policy` / feature policy that allows `camera` and `fullscreen` on this origin; wake-lock if supported. | Must |
| P0-5 | CSP that allows wasm (`wasm-unsafe-eval` or equivalent for MediaPipe) and the model origin; no unrelated third-party scripts. | Must |
| P0-6 | Offline: detection may fail if model not cached; document that. Optional later: Cache-Control / service worker for wasm+model only. | Should |
| P0-7 | Health: static `GET /` returns 200. No application database. | Must |
| P0-8 | Do not require login. | Must |

**Acceptance:** On a phone on cellular HTTPS, Start → calibrate → close eyes ~2 s → ALARM audio + red badge. Network tab shows **no** POST of video or landmarks.

### Phase 1 — Backend foundation (accounts optional)

Greenfield service. Does not run ML.

| ID | Requirement | Priority |
| --- | --- | --- |
| P1-1 | REST or HTTPS JSON API behind the same parent domain (e.g. `api.` + `app.`). | Must |
| P1-2 | Anonymous sessions continue to work if API is down (detector is client-only). | Must |
| P1-3 | Optional email/password or magic-link auth (or SSO later). | Should |
| P1-4 | Org + member roles: `driver`, `supervisor`, `admin`. | Should |
| P1-5 | Vehicles: id, label, optional plate. | Should |
| P1-6 | Audit log of auth and settings changes, not of faces. | Should |
| P1-7 | Secrets in env / secret manager; no API keys in the SPA repo. | Must |
| P1-8 | CORS allowlist: production app origin only. | Must |

### Phase 2 — Opt-in safety events

| ID | Requirement | Priority |
| --- | --- | --- |
| P2-1 | Client sends `DrowsinessEvent` only after in-app opt-in (default **off**). | Must |
| P2-2 | Rate limit (e.g. max 1 ALARM event per 10 s per session) to prevent floods. | Must |
| P2-3 | Supervisor dashboard: time series of WARNING/ALARM counts per vehicle/day. | Should |
| P2-4 | Driver can download or delete their events (GDPR-style). | Must if EU users |
| P2-5 | Retention default 90 days; configurable per org. | Should |
| P2-6 | No query API that returns images or landmark arrays (those fields must not exist). | Must |

### Phase 3 — Settings sync and ops

| ID | Requirement | Priority |
| --- | --- | --- |
| P3-1 | Sync `earThreshold`, `alarmDelayMs` to the signed-in profile (not EAR traces). | Could |
| P3-2 | Org policy: min alarm delay, force rear camera, force opt-in events. | Could |
| P3-3 | Model version endpoint: `{ tasksVision, wasmUrl, modelUrl }` so the client can pin without a full SPA deploy. | Could |
| P3-4 | Status page / uptime for API + asset CDN. | Should |
| P3-5 | Feature flags: `eventsEnabled`, `authEnabled`. Flags must not disable local detection. | Must |

---

## 8. Target architecture

```
                    HTTPS
Driver browser  ──────────────────────────────►  CDN / static host
  camera (local)                                  SPA (React/Vite build)
  FaceLandmarker (wasm, local)                    /models/face_landmarker.task
  EAR + DrowsinessDetector                        /wasm/*  (tasks-vision 1.0.1)
  optional POST /events  ──►  API (Phase 1+)
                                │
                                ├─ Auth
                                ├─ Orgs / vehicles
                                ├─ Events store (no blobs)
                                └─ Audit
```

**Inference never crosses the dashed line.** The API is CRUD + policy. If the API is down, the SPA still detects.

### 8.1 Suggested stack (guidance, not lock-in)

| Layer | Suggestion | Why |
| --- | --- | --- |
| SPA | Keep React 18 + Vite 6 | Existing code |
| Static host | Cloudflare Pages / Vercel / nginx | HTTPS, SPA fallback to `index.html` |
| Assets | Same origin `/wasm`, `/models` | Version pin, no mixed CDN |
| API | Node (Hono/Fastify) or Python (FastAPI) | JSON, small surface |
| DB | Postgres | Orgs, events, users |
| Auth | Better Auth / Clerk / Auth.js, or magic link | Do not build crypto from scratch |
| Infra | Single region first | Low volume |

Do **not** put MediaPipe in the API. Do **not** use WebSockets for video.

### 8.2 Client changes when API exists

- `VITE_API_BASE_URL` empty ⇒ current behaviour.
- If set and user opted in: `POST /v1/events` on WARNING/ALARM **transitions** (not every frame).
- Calibration and rAF loop stay as in `DrowsinessApp` today.

---

## 9. Backend API (Phase 1–2)

Base path: `/v1`. JSON. Auth: `Authorization: Bearer <access_token>` except where noted.

### 9.1 Public

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/health` | `{ "ok": true }` |
| `GET` | `/runtime` | Optional model URLs + `minAppVersion` |

### 9.2 Auth

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/auth/magic-link` | email |
| `POST` | `/auth/session` | exchange token |
| `POST` | `/auth/logout` | |
| `GET` | `/me` | user + orgs |

### 9.3 Fleet

| Method | Path | Notes |
| --- | --- | --- |
| `GET/POST` | `/orgs/:orgId/vehicles` | |
| `PATCH` | `/orgs/:orgId/settings` | retention, event opt-in policy |

### 9.4 Events

`POST /v1/events`

```json
{
  "sessionId": "uuid",
  "vehicleId": "uuid",
  "occurredAt": "2026-10-06T18:00:00.000Z",
  "state": "ALARM",
  "trigger": "eyes_closed",
  "durationMs": 1800
}
```

**Reject** payloads that include `image`, `landmarks`, `ear`, `baselineEAR`, or any array of points (400 + error code `FORBIDDEN_BIOMETRIC_FIELD`).

`GET /v1/orgs/:orgId/events?from=&to=&vehicleId=` — supervisor; paginated; no biometric fields in the schema.

`DELETE /v1/me/events` — driver erase.

---

## 10. Data model (backend)

```
User        id, email, createdAt
Org         id, name, retentionDays
Membership  userId, orgId, role
Vehicle     id, orgId, label
Session     id (client uuid), userId?, vehicleId?, startedAt, endedAt?
Event       id, sessionId, occurredAt, state, trigger, durationMs
Consent     userId, eventsOptIn, grantedAt
Audit       actorId, action, at, metadata
```

No `bytea` / blob tables for media. No S3 bucket for faces in v1.

**Client localStorage (existing + Phase 0):** last `baselineEAR`, slider values, facing mode. Not a backend concern until Phase 3 sync.

---

## 11. Functional requirements (product UX)

These already exist; hosting must not regress them.

| ID | Requirement |
| --- | --- |
| UX-1 | Big Start/Stop; live preview; facing-mode toggle. |
| UX-2 | Status badge AWAKE / WARNING / ALARM with assertive live region. |
| UX-3 | Live EAR + baseline after calibration. |
| UX-4 | Sensitivity slider = `earThreshold`; delay slider = `alarmDelayMs`. |
| UX-5 | Optional debug landmark overlay (off by default in production builds if desired). |
| UX-6 | Visible disclaimer on every screen that can Start. |
| UX-7 | Calibration copy: “Look at the camera with your eyes open normally.” Auto-retry on insufficient samples. |
| UX-8 | WARNING chime once; ALARM loops until state leaves ALARM. |
| UX-9 | Anonymous mode: zero network besides static assets. |

New for hosted product:

| ID | Requirement |
| --- | --- |
| UX-10 | First-visit camera permission explainer (HTTPS, why camera, what is not uploaded). |
| UX-11 | Settings: “Share ALARM/WARNING times with my organisation” default off. |
| UX-12 | If model download fails, on-screen error with retry (today: generic FaceLandmarker load error). |

---

## 12. Non-functional requirements

| Area | Requirement |
| --- | --- |
| Latency | Detection loop stays on-device; API RTT must not block rAF. |
| Availability | SPA + assets 99.9% monthly; API lower is acceptable if SPA degrades gracefully. |
| Performance | Target 25–30 fps on a mid-range phone; main-thread hitch is a known limit (see TECHNICAL.md). |
| Security | HTTPS only; cookies `Secure; SameSite=Lax` or bearer in memory; no tokens in localStorage if using refresh cookies. |
| Privacy | Privacy policy states: no face video stored; events optional. |
| Compliance | Do not claim medical or type-approved DMS. GDPR: lawful basis + deletion for events. |
| Logging | Server logs: request id, status, user id. Never log event bodies that might be stuffed with extra fields. |
| Browser | Chromium-first; Safari: `playsInline` + muted (already). Document Wake Lock gaps. |

---

## 13. Security and abuse

- Camera permission is the browser’s; IsoSafe never proxies the camera.
- Auth brute-force limits on magic-link.
- Event POST: schema allowlist, size cap (~1 KB), rate limit.
- Supervisors see aggregates, not a live EAR stream (a live EAR stream is still biometric-adjacent; out of scope).
- Model files are public (they already are on Google storage); integrity via HTTPS and optional SRI later.
- Do not embed third-party analytics that can screenshot the tab or hook `getUserMedia`.

---

## 14. Success metrics

| Metric | Target |
| --- | --- |
| Time to first successful calibration (HTTPS) | &lt; 20 s on median mobile network including model download |
| Camera permission grant rate | Track; improve copy if &lt; 50% |
| False ALARM from blinks | Should remain ~0 by design (`warnDelayMs` 700 vs blink ~200 ms) |
| API error must not stop detection | 100% of client sessions still run locally if `/v1` 5xx |
| Support tickets “are you recording my face?” | Answered by in-app privacy panel; aim to reduce repeats |

No vanity metric that requires uploading EAR traces.

---

## 15. Risks

| Risk | Mitigation |
| --- | --- |
| Users think a URL means “cloud cameras” | UX-10 + privacy panel + this PRD’s invariant |
| Mixed wasm/model versions | P0-3; pin in `constants.ts` and copied assets |
| iOS autoplay / audio | Keep Start-button `AudioContext.resume()` |
| Glasses, night, pose | Already documented; do not overclaim |
| Fleet wants live video | Refuse in v1; would be a different product and DPIA |
| Hosting on HTTP LAN IP | Camera blocked; only HTTPS / localhost |

---

## 16. Rollout

1. **Phase 0:** `npm run build`, HTTPS host, copy `node_modules/@mediapipe/tasks-vision/wasm` + official `.task` into `/public`, point `WASM_FILES_URL` and `FACE_LANDMARKER_MODEL_URL` at same origin, smoke-test camera on a real phone.
2. **Phase 1:** Empty API + health + auth; SPA ignores it if unset.
3. **Phase 2:** Opt-in events + dashboard.
4. **Phase 3:** Settings sync, org policy, `/runtime` model pin.

Each phase ships independently. Do not block public detection on auth.

---

## 17. Open questions

1. Brand URL and whether the solo product stays fully anonymous forever.
2. Who is the data controller for fleet events (IsoSafe vs customer org)?
3. Native PWA install / “add to Home Screen” vs browser tab.
4. Whether to drop the debug overlay in production builds.
5. Retention and DPA for paying fleets.

---

## 18. Traceability to current code

| PRD concept | Implementation today |
| --- | --- |
| Session | `DrowsinessApp` `session` state |
| EAR | `src/lib/ear.ts` |
| Calibration | `src/lib/calibration.ts`, `useCalibration` |
| State machine | `src/lib/DrowsinessDetector.ts` |
| Camera | `useCamera` |
| Model load | `useFaceLandmarker`, `src/constants.ts` |
| Audio | `useAlarm` |
| Wake lock | `useWakeLock` |
| Backend | **None — this PRD is the spec to add one without breaking the above** |

---

## 19. Decision record

**D1.** Hosting the app online = static HTTPS + optional self-hosted models.  
**D2.** A backend is a **fleet/account** product, not a requirement for detection.  
**D3.** Biometric raw data stays on device. Events are coarse state transitions only.  
**D4.** Detection must work if the backend is down or the user is signed out.
