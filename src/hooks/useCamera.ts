import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { FacingMode } from "../types";

function cameraErrorMessage(error: unknown): string {
  if (!(error instanceof DOMException) && !(error instanceof Error)) {
    return "Could not access the camera.";
  }
  const name = "name" in error ? error.name : "";
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "Camera permission was denied. Allow camera access in the browser address bar, then press Start again.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No camera was found on this device.";
    case "NotReadableError":
    case "TrackStartError":
      return "The camera is already in use by another app, or the device could not start it.";
    case "OverconstrainedError":
      return "This device does not support the requested camera. Try the facing-mode toggle.";
    case "SecurityError":
      return "Camera access requires a secure context (localhost or HTTPS).";
    default:
      return error.message || "Could not access the camera.";
  }
}

export function useCamera(videoRef: RefObject<HTMLVideoElement | null>) {
  const [facingMode, setFacingMode] = useState<FacingMode>("user");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const generationRef = useRef(0);

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    const video = videoRef.current;
    if (video) video.srcObject = null;
  }, [videoRef]);

  const start = useCallback(
    async (mode: FacingMode = facingMode) => {
      if (!navigator.mediaDevices?.getUserMedia) {
        const message =
          "This browser does not support camera access (getUserMedia).";
        setError(message);
        throw new Error(message);
      }

      const generation = ++generationRef.current;
      stopTracks();
      setError(null);

      const constraints: MediaStreamConstraints[] = [
        { video: { facingMode: mode }, audio: false },
        { video: true, audio: false },
      ];

      let lastError: unknown;
      let stream: MediaStream | null = null;
      for (const constraint of constraints) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraint);
          break;
        } catch (err) {
          lastError = err;
        }
      }

      if (generation !== generationRef.current) {
        stream?.getTracks().forEach((track) => track.stop());
        return;
      }

      if (!stream) {
        const message = cameraErrorMessage(lastError);
        setError(message);
        setIsStreaming(false);
        throw new Error(message);
      }

      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        stopTracks();
        const message = "Video element was not ready.";
        setError(message);
        throw new Error(message);
      }

      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await video.play();
      if (generation !== generationRef.current) {
        stopTracks();
        setIsStreaming(false);
        return;
      }
      setFacingMode(mode);
      setIsStreaming(true);
    },
    [facingMode, stopTracks, videoRef],
  );

  const stop = useCallback(() => {
    generationRef.current += 1;
    stopTracks();
    setIsStreaming(false);
  }, [stopTracks]);

  const toggleFacingMode = useCallback(async () => {
    const next: FacingMode = facingMode === "user" ? "environment" : "user";
    setFacingMode(next);
    if (streamRef.current) {
      await start(next);
    }
  }, [facingMode, start]);

  useEffect(() => {
    return () => {
      stopTracks();
    };
  }, [stopTracks]);

  return { facingMode, isStreaming, error, start, stop, toggleFacingMode };
}
