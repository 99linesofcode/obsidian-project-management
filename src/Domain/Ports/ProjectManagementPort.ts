import type { AttachProjectData } from '../DataTransferObjects/AttachProjectData.js';
import type { ProjectIdentityData } from '../DataTransferObjects/ProjectIdentityData.js';

// The core's need: given a project note's sync frontmatter, resolve the
// GitHub identities for that project. Designed for the core, not to mimic
// GitHub's API. Returns null when the provider is not ours to handle.
export interface ProjectManagementPort {
  fetchProjectIdentity(data: AttachProjectData): Promise<ProjectIdentityData | null>;
}
