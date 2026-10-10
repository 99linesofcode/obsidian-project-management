import type { AdapterDescriptor } from './AdapterDescriptor.js';
import type { CapturePort } from '../../port/CapturePort.js';
import type { CompleteFetchPort } from '../../port/CompleteFetchPort.js';
import type { ProjectActivityPort } from '../../port/ProjectActivityPort.js';
import type { ProjectCapturePort } from '../../port/ProjectCapturePort.js';
import type { ProjectPort } from '../../port/ProjectPort.js';
import type { TaskLockPort } from '../../port/TaskLockPort.js';
import type { TaskSurfacePort } from '../../port/TaskSurfacePort.js';
import type { TimestampedPort } from '../../port/TimestampedPort.js';

export class RegisteredAdapter {
  readonly descriptor: AdapterDescriptor;
  readonly project: ProjectPort;
  readonly tasks: TaskSurfacePort;
  readonly capture: CapturePort | undefined;
  readonly projectCapture: ProjectCapturePort | undefined;
  readonly completeFetch: CompleteFetchPort | undefined;
  readonly timestamps: TimestampedPort | undefined;
  readonly taskLock: TaskLockPort | undefined;
  readonly activity: ProjectActivityPort | undefined;

  constructor(init: {
    descriptor: AdapterDescriptor;
    project: ProjectPort;
    tasks: TaskSurfacePort;
    capture: CapturePort | undefined;
    projectCapture: ProjectCapturePort | undefined;
    completeFetch: CompleteFetchPort | undefined;
    timestamps: TimestampedPort | undefined;
    taskLock: TaskLockPort | undefined;
    activity: ProjectActivityPort | undefined;
  }) {
    this.descriptor = init.descriptor;
    this.project = init.project;
    this.tasks = init.tasks;
    this.capture = init.capture;
    this.projectCapture = init.projectCapture;
    this.completeFetch = init.completeFetch;
    this.timestamps = init.timestamps;
    this.taskLock = init.taskLock;
    this.activity = init.activity;
  }
}
