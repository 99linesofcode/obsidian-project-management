import type { CapturePort } from './CapturePort.js';
import type { CompleteFetchPort } from './CompleteFetchPort.js';
import type { ProjectActivityPort } from './ProjectActivityPort.js';
import type { ProjectCapturePort } from './ProjectCapturePort.js';
import type { ProjectPort } from './ProjectPort.js';
import type { TaskLockPort } from './TaskLockPort.js';
import type { TaskSurfacePort } from './TaskSurfacePort.js';
import type { TimestampedPort } from './TimestampedPort.js';

export interface MirrorAdapter
  extends
    ProjectPort,
    TaskSurfacePort,
    CapturePort,
    ProjectCapturePort,
    CompleteFetchPort,
    TimestampedPort,
    TaskLockPort,
    ProjectActivityPort {}
