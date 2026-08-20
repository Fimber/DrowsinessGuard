import { FaceLandmarker } from "@mediapipe/tasks-vision";
import type { Point2 } from "../types";

/**
 * Six-point Eye Aspect Ratio (Soukupová & Čech, 2016) on the MediaPipe
 * 468-point face mesh.
 *
 * tasks-vision FaceLandmarker does NOT export named EAR indices. It exports
 * `FACE_LANDMARKS_LEFT_EYE` / `FACE_LANDMARKS_RIGHT_EYE` as Connection[]
 * (start/end pairs for drawing). That is a different API from the old
 * `@mediapipe/face_mesh` FACEMESH_* sets.
 *
 * The 468-point topology is unchanged, but the LEFT/RIGHT *labels* on those
 * connection tables follow the person's anatomy (subject's left = 362-cluster).
 * Many older EAR tutorials called the 33-cluster "left" because it sits on the
 * left of a non-mirrored image (the subject's right eye). We keep the classic
 * EAR index lists below (they are still the correct six points per eye) and
 * verify them against the installed connection graphs at runtime.
 *
 * Order for each eye: [p1 corner, p2 upper, p3 upper, p4 corner, p5 lower, p6 lower].
 *
 * EAR = (‖p2−p6‖ + ‖p3−p5‖) / (2 · ‖p1−p4‖)
 */
export const LEFT_EYE_EAR = [33, 160, 158, 133, 153, 144] as const;
export const RIGHT_EYE_EAR = [362, 385, 387, 263, 373, 380] as const;

const MESH_POINT_COUNT = 468;

function hypot2(a: Point2, b: Point2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function eyeEAR(landmarks: Point2[], indices: readonly number[]): number | null {
  const pts = indices.map((i) => landmarks[i]);
  if (pts.some((p) => p == null)) return null;

  const [p1, p2, p3, p4, p5, p6] = pts as [
    Point2,
    Point2,
    Point2,
    Point2,
    Point2,
    Point2,
  ];

  const vertical = hypot2(p2, p6) + hypot2(p3, p5);
  const horizontal = hypot2(p1, p4);
  if (horizontal < 1e-6) return null;
  return vertical / (2 * horizontal);
}

/**
 * Average left/right EAR from a FaceLandmarker landmark list.
 * Returns null when there is no usable face mesh (caller must pass that
 * into the drowsiness state machine — do not invent a threshold).
 */
export function computeEAR(landmarks: Point2[] | null | undefined): number | null {
  if (!landmarks || landmarks.length < MESH_POINT_COUNT) return null;

  const left = eyeEAR(landmarks, LEFT_EYE_EAR);
  const right = eyeEAR(landmarks, RIGHT_EYE_EAR);
  if (left == null || right == null) return null;
  return (left + right) / 2;
}

function connectionIndexSet(
  connections: ReadonlyArray<{ start: number; end: number }>,
): Set<number> {
  const ids = new Set<number>();
  for (const { start, end } of connections) {
    ids.add(start);
    ids.add(end);
  }
  return ids;
}

/**
 * Confirms the hardcoded EAR indices exist in this installed tasks-vision
 * FaceLandmarker connection tables. Logs a warning instead of throwing so
 * a version skew is visible in the console without crashing the session.
 *
 * In @mediapipe/tasks-vision@1.0.1, FACE_LANDMARKS_LEFT_EYE is the subject's
 * left eye (362-cluster) and FACE_LANDMARKS_RIGHT_EYE is the 33-cluster —
 * the opposite of many older image-left "left eye" EAR snippets.
 */
export function assertEarIndicesMatchInstalledModel(): void {
  const subjectLeft = connectionIndexSet(FaceLandmarker.FACE_LANDMARKS_LEFT_EYE);
  const subjectRight = connectionIndexSet(FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE);

  const missing33Cluster = LEFT_EYE_EAR.filter((i) => !subjectRight.has(i));
  const missing362Cluster = RIGHT_EYE_EAR.filter((i) => !subjectLeft.has(i));

  if (missing33Cluster.length || missing362Cluster.length) {
    console.warn(
      "[drowsiness] EAR landmark indices are not a subset of FaceLandmarker eye connections. " +
        "The installed @mediapipe/tasks-vision topology may have changed.",
      {
        missing33Cluster,
        missing362Cluster,
        subjectLeftSize: subjectLeft.size,
        subjectRightSize: subjectRight.size,
      },
    );
  }
}
