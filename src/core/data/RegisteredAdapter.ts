import type { AdapterDescriptor } from '../AdapterDescriptor.js';
import type { CapturePort } from '../ports/CapturePort.js';
import type { CompleteFetchPort } from '../ports/CompleteFetchPort.js';
import type { ProjectCapturePort } from '../ports/ProjectCapturePort.js';
import type { ProjectPort } from '../ports/ProjectPort.js';
import type { TaskSurfacePort } from '../ports/TaskSurfacePort.js';
import type { TimestampedPort } from '../ports/TimestampedPort.js';

export class RegisteredAdapter {
  readonly descriptor: AdapterDescriptor;
  readonly project: ProjectPort;
  readonly tasks: TaskSurfacePort;
  readonly capture: CapturePort | undefined;
  readonly projectCapture: ProjectCapturePort | undefined;
  readonly completeFetch: CompleteFetchPort | undefined;
  readonly timestamps: TimestampedPort | undefined;

  constructor(init: {
    descriptor: AdapterDescriptor;
    project: ProjectPort;
    tasks: TaskSurfacePort;
    capture: CapturePort | undefined;
    projectCapture: ProjectCapturePort | undefined;
    completeFetch: CompleteFetchPort | undefined;
    timestamps: TimestampedPort | undefined;
  }) {
    this.descriptor = init.descriptor;
    this.project = init.project;
    this.tasks = init.tasks;
    this.capture = init.capture;
    this.projectCapture = init.projectCapture;
    this.completeFetch = init.completeFetch;
    this.timestamps = init.timestamps;
  }
}
