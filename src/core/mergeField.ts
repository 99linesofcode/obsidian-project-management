import { Delta } from './data/Delta.js';
import { MergeResult } from './data/MergeResult.js';
import type { SideObservation } from './data/SideObservation.js';

export function mergeField(
  origin: SideObservation,
  mirrors: readonly SideObservation[],
): MergeResult {
  const deltas: Delta[] = [];
  const originDelta = deriveDelta(origin);
  if (originDelta !== null) {
    deltas.push(originDelta);
  }
  for (const mirror of mirrors) {
    const mirrorDelta = deriveDelta(mirror);
    if (mirrorDelta !== null) {
      deltas.push(mirrorDelta);
    }
  }

  if (deltas.length === 0) {
    return new MergeResult({
      outcome: 'unchanged',
      value: origin.current,
      winner: null,
      rung: 0,
      deltas,
      superseded: [],
    });
  }

  if (deltas.length === 1) {
    const only = deltas[0]!;
    return new MergeResult({
      outcome: outcomeFor(only),
      value: only.value,
      winner: only.side,
      rung: 0,
      deltas,
      superseded: [],
    });
  }

  const timestampWinner = decisiveTimestamp(deltas);
  if (timestampWinner !== null) {
    return new MergeResult({
      outcome: outcomeFor(timestampWinner),
      value: timestampWinner.value,
      winner: timestampWinner.side,
      rung: 1,
      deltas,
      superseded: deltas.filter((delta) => delta !== timestampWinner),
    });
  }

  const completionWinner = completionOverOpen(deltas, origin);
  if (completionWinner !== null) {
    return new MergeResult({
      outcome: outcomeFor(completionWinner),
      value: completionWinner.value,
      winner: completionWinner.side,
      rung: 2,
      deltas,
      superseded: deltas.filter((delta) => delta !== completionWinner),
    });
  }

  return new MergeResult({
    outcome: origin.current === null ? 'delete' : 'value',
    value: origin.current,
    winner: origin.side,
    rung: 3,
    deltas,
    superseded: deltas,
  });
}

function deriveDelta(observation: SideObservation): Delta | null {
  const isOrigin = observation.role === 'origin';

  if (observation.current === null) {
    if (observation.baseline === null) {
      return null;
    }
    if (!isOrigin && !observation.completeFetch) {
      return null;
    }
    return new Delta({
      side: observation.side,
      kind: 'delete',
      value: null,
      time: observation.fieldTime,
      trustworthy: isOrigin || observation.timestampTrustworthy,
      completed: false,
    });
  }

  const changed =
    observation.baseline === null ||
    observation.current !== observation.baseline.value;
  if (!changed) {
    return null;
  }

  return new Delta({
    side: observation.side,
    kind: 'value',
    value: observation.current,
    time: observation.fieldTime,
    trustworthy: isOrigin || observation.timestampTrustworthy,
    completed: observation.currentCompleted,
  });
}

function decisiveTimestamp(deltas: readonly Delta[]): Delta | null {
  const comparable = deltas.filter(
    (delta) => delta.trustworthy && delta.time !== null,
  );
  if (comparable.length === 0) {
    return null;
  }

  let newest = comparable[0]!;
  for (const delta of comparable) {
    if (Date.parse(delta.time!) > Date.parse(newest.time!)) {
      newest = delta;
    }
  }

  const newestTime = Date.parse(newest.time!);
  const atNewest = comparable.filter(
    (delta) => Date.parse(delta.time!) === newestTime,
  );
  if (atNewest.length !== 1) {
    return null;
  }

  const winner = atNewest[0]!;
  for (const delta of deltas) {
    if (delta === winner) {
      continue;
    }
    if (!delta.trustworthy || delta.time === null) {
      return null;
    }
    if (Date.parse(delta.time) >= newestTime) {
      return null;
    }
  }

  return winner;
}

function completionOverOpen(
  deltas: readonly Delta[],
  origin: SideObservation,
): Delta | null {
  const completions = deltas.filter(
    (delta) => delta.kind === 'value' && delta.completed,
  );
  const opens = deltas.filter(
    (delta) => delta.kind === 'value' && !delta.completed,
  );
  const deletes = deltas.filter((delta) => delta.kind === 'delete');
  if (completions.length === 0 || opens.length === 0 || deletes.length > 0) {
    return null;
  }
  if (opens.some((delta) => delta.side === origin.side)) {
    return null;
  }
  const distinctValues = new Set(completions.map((delta) => delta.value));
  if (distinctValues.size !== 1) {
    return null;
  }
  return (
    completions.find((delta) => delta.side === origin.side) ?? completions[0]!
  );
}

function outcomeFor(delta: Delta): 'value' | 'delete' {
  return delta.kind === 'delete' ? 'delete' : 'value';
}
