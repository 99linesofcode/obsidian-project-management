import type { CapturePort } from './CapturePort.js';
import type { CompleteFetchPort } from './CompleteFetchPort.js';
import type { ProjectPort } from './ProjectPort.js';
import type { TaskSurfacePort } from './TaskSurfacePort.js';
import type { TimestampedPort } from './TimestampedPort.js';

export interface MirrorAdapter
  extends ProjectPort,
    TaskSurfacePort,
    CapturePort,
    CompleteFetchPort,
    TimestampedPort {}
