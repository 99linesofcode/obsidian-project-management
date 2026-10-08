import { describe, expect, it } from 'vitest';
import { gatedProjectCapture } from '../../src/app/gatedProjectCapture.js';
import type { CaptureResult } from '../../src/projects/CaptureRemoteProjectsAction.js';

function recorder(calls: string[], label: string, captured: string[]) {
  return async (): Promise<CaptureResult> => {
    calls.push(label);
    return { captured, errors: [] };
  };
}

describe('gatedProjectCapture — the engine setting selects the capture', () => {
  it('runs the core capture and skips the legacy capture when the engine is on', async () => {
    const calls: string[] = [];
    const capture = gatedProjectCapture(
      () => true,
      recorder(calls, 'legacy', []),
      recorder(calls, 'core', ['Acme Widgets']),
    );

    const result = await capture();

    expect(result.captured).toEqual(['Acme Widgets']);
    expect(calls).toEqual(['core']);
  });

  it('runs the legacy capture and skips the core capture when the engine is off', async () => {
    const calls: string[] = [];
    const capture = gatedProjectCapture(
      () => false,
      recorder(calls, 'legacy', ['Acme Widgets']),
      recorder(calls, 'core', []),
    );

    const result = await capture();

    expect(result.captured).toEqual(['Acme Widgets']);
    expect(calls).toEqual(['legacy']);
  });

  it('reads the setting at call time, so a toggle needs no reload', async () => {
    const calls: string[] = [];
    let on = false;
    const capture = gatedProjectCapture(
      () => on,
      recorder(calls, 'legacy', []),
      recorder(calls, 'core', []),
    );

    await capture();
    on = true;
    await capture();

    expect(calls).toEqual(['legacy', 'core']);
  });
});
