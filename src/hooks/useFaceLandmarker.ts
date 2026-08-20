import {
  FaceLandmarker,
  FilesetResolver,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { FACE_LANDMARKER_MODEL_URL, WASM_FILES_URL } from "../constants";
import { drawEyeLandmarks } from "../lib/drawLandmarks";
import { assertEarIndicesMatchInstalledModel, computeEAR } from "../lib/ear";

export type FramePayload = {
  ear: number | null;
  landmarks: NormalizedLandmark[] | null;
  timestamp: number;
};

type Options = {
  enabled: boolean;
  showDebug: boolean;
  videoRef: RefObject<HTMLVideoElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  onFrame: (frame: FramePayload) => void;
};

async function createLandmarker(
  fileset: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>,
  delegate: "GPU" | "CPU",
): Promise<FaceLandmarker> {
  return FaceLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: FACE_LANDMARKER_MODEL_URL,
      delegate,
    },
    runningMode: "VIDEO",
    numFaces: 1,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
}

export function useFaceLandmarker({
  enabled,
  showDebug,
  videoRef,
  canvasRef,
  onFrame,
}: Options) {
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const landmarkerRef = useRef<FaceLandmarker | null>(null);
  const onFrameRef = useRef(onFrame);
  const showDebugRef = useRef(showDebug);
  const lastTimestampRef = useRef(-1);
  const lastVideoTimeRef = useRef(-1);
  const mountedRef = useRef(true);
  const loadingRef = useRef<Promise<void> | null>(null);

  onFrameRef.current = onFrame;
  showDebugRef.current = showDebug;

  const ensureReady = useCallback(async () => {
    if (landmarkerRef.current) {
      setStatus("ready");
      return;
    }
    if (loadingRef.current) {
      await loadingRef.current;
      if (!landmarkerRef.current) {
        throw new Error("FaceLandmarker failed to initialize.");
      }
      return;
    }

    setStatus("loading");
    setError(null);

    const pending = (async () => {
      const fileset = await FilesetResolver.forVisionTasks(WASM_FILES_URL);
      let landmarker: FaceLandmarker;
      try {
        landmarker = await createLandmarker(fileset, "GPU");
      } catch {
        landmarker = await createLandmarker(fileset, "CPU");
      }
      if (!mountedRef.current) {
        landmarker.close();
        return;
      }
      assertEarIndicesMatchInstalledModel();
      landmarkerRef.current = landmarker;
      setStatus("ready");
    })();

    loadingRef.current = pending;
    try {
      await pending;
      if (!landmarkerRef.current) {
        throw new Error("FaceLandmarker failed to initialize.");
      }
    } catch (err) {
      loadingRef.current = null;
      const message =
        err instanceof Error
          ? err.message
          : "Failed to load the face landmark model.";
      setError(
        `Could not load MediaPipe FaceLandmarker. Check your network (wasm + model are fetched from a CDN). ${message}`,
      );
      setStatus("error");
      throw err;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;

    let raf = 0;
    let cancelled = false;

    const loop = () => {
      if (cancelled) return;
      raf = requestAnimationFrame(loop);

      const video = videoRef.current;
      const landmarker = landmarkerRef.current;
      if (!video || !landmarker) return;
      if (video.readyState < 2 || video.videoWidth === 0) return;
      if (video.currentTime === lastVideoTimeRef.current) return;

      const timestamp = performance.now();
      if (timestamp <= lastTimestampRef.current) return;

      lastVideoTimeRef.current = video.currentTime;
      lastTimestampRef.current = timestamp;

      let ear: number | null = null;
      let landmarks: NormalizedLandmark[] | null = null;

      try {
        const result = landmarker.detectForVideo(video, timestamp);
        const face = result.faceLandmarks[0];
        if (face && face.length > 0) {
          landmarks = face;
          ear = computeEAR(face);
        }
      } catch {
        // Empty or not-yet-ready frames must not crash the loop.
        ear = null;
        landmarks = null;
      }

      const canvas = canvasRef.current;
      if (canvas) {
        if (showDebugRef.current) {
          drawEyeLandmarks(
            canvas,
            video,
            landmarks,
            FaceLandmarker.FACE_LANDMARKS_LEFT_EYE,
            FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE,
          );
        } else if (canvas.width !== 0 || canvas.height !== 0) {
          const ctx = canvas.getContext("2d");
          ctx?.clearRect(0, 0, canvas.width, canvas.height);
        }
      }

      onFrameRef.current({ ear, landmarks, timestamp });
    };

    raf = requestAnimationFrame(loop);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [canvasRef, enabled, videoRef]);

  return { status, error, ensureReady };
}
