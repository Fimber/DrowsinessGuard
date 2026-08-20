import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { LEFT_EYE_EAR, RIGHT_EYE_EAR } from "./ear";

function drawConnections(
  ctx: CanvasRenderingContext2D,
  landmarks: NormalizedLandmark[],
  connections: ReadonlyArray<{ start: number; end: number }>,
  width: number,
  height: number,
): void {
  ctx.beginPath();
  for (const { start, end } of connections) {
    const a = landmarks[start];
    const b = landmarks[end];
    if (!a || !b) continue;
    ctx.moveTo(a.x * width, a.y * height);
    ctx.lineTo(b.x * width, b.y * height);
  }
  ctx.stroke();
}

function drawPoints(
  ctx: CanvasRenderingContext2D,
  landmarks: NormalizedLandmark[],
  indices: readonly number[],
  width: number,
  height: number,
  radius: number,
): void {
  for (const i of indices) {
    const p = landmarks[i];
    if (!p) continue;
    ctx.beginPath();
    ctx.arc(p.x * width, p.y * height, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Debug overlay: eye contours plus the six EAR points per eye. */
export function drawEyeLandmarks(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  landmarks: NormalizedLandmark[] | null,
  leftEye: ReadonlyArray<{ start: number; end: number }>,
  rightEye: ReadonlyArray<{ start: number; end: number }>,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const width = video.videoWidth;
  const height = video.videoHeight;
  if (width === 0 || height === 0) return;

  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;

  ctx.clearRect(0, 0, width, height);
  if (!landmarks) return;

  ctx.lineWidth = Math.max(1.5, width / 400);
  ctx.strokeStyle = "rgba(61, 214, 140, 0.95)";
  drawConnections(ctx, landmarks, leftEye, width, height);
  drawConnections(ctx, landmarks, rightEye, width, height);

  ctx.fillStyle = "rgba(245, 165, 36, 1)";
  const radius = Math.max(2.5, width / 280);
  drawPoints(ctx, landmarks, LEFT_EYE_EAR, width, height, radius);
  drawPoints(ctx, landmarks, RIGHT_EYE_EAR, width, height, radius);
}
