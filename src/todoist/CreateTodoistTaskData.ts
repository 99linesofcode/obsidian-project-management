// The task-manager module's name for the create-task input. The canonical
// interface lives in shared/CreateRemoteTaskData so neutral modules can build
// the input without naming the provider; this alias keeps the provider-facing
// vocabulary local to the provider module.
export type { CreateRemoteTaskData as CreateTodoistTaskData } from '../shared/CreateRemoteTaskData.js';
