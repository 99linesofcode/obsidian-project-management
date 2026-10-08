import type { CaptureResult } from '../projects/CaptureRemoteProjectsAction.js';

export function gatedProjectCapture(
  engineOn: () => boolean,
  legacy: () => Promise<CaptureResult>,
  core: () => Promise<CaptureResult>,
): () => Promise<CaptureResult> {
  return () => (engineOn() ? core() : legacy());
}
