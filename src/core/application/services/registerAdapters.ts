import type { AdapterDescriptor } from '../data/AdapterDescriptor.js';
import {
  isCapability,
  REQUIRED_CAPABILITIES,
} from '../../domain/capabilities.js';
import type { AdapterRegistration } from '../data/AdapterRegistration.js';
import { RegisteredAdapter } from '../data/RegisteredAdapter.js';
import { RegistrationError } from '../data/RegistrationError.js';
import { RegistrationResult } from '../data/RegistrationResult.js';

const APPLICATION_ID = /^[a-z0-9-]+$/;
const SETTINGS_ROW_KINDS = ['text', 'toggle', 'number', 'list'] as const;

export function registerAdapters(
  registrations: readonly AdapterRegistration[],
): RegistrationResult {
  const adapters = new Map<string, RegisteredAdapter>();
  const errors: RegistrationError[] = [];

  for (const registration of registrations) {
    const reason = rejectionReason(registration.descriptor, adapters);
    if (reason !== null) {
      errors.push(
        new RegistrationError(registration.descriptor.applicationId, reason),
      );
      continue;
    }
    adapters.set(
      registration.descriptor.applicationId,
      pairAdapter(registration),
    );
  }

  return new RegistrationResult(adapters, errors);
}

function rejectionReason(
  descriptor: AdapterDescriptor,
  registered: ReadonlyMap<string, RegisteredAdapter>,
): string | null {
  if (!APPLICATION_ID.test(descriptor.applicationId)) {
    return 'application id must be lowercase alphanumerics with dashes';
  }
  if (registered.has(descriptor.applicationId)) {
    return 'duplicate application id';
  }
  if (
    !descriptor.capabilities ||
    !descriptor.secretKeys ||
    !descriptor.settingsRows
  ) {
    return 'descriptor is missing a required field';
  }
  for (const capability of descriptor.capabilities) {
    if (!isCapability(capability)) {
      return `unknown capability: ${capability}`;
    }
  }
  for (const row of descriptor.settingsRows) {
    if (!SETTINGS_ROW_KINDS.includes(row.kind)) {
      return `unknown settings-row kind: ${row.kind}`;
    }
  }
  for (const capability of REQUIRED_CAPABILITIES) {
    if (!descriptor.capabilities.includes(capability)) {
      return `out of scope: missing ${capability}`;
    }
  }
  return null;
}

function pairAdapter(registration: AdapterRegistration): RegisteredAdapter {
  return new RegisteredAdapter({
    descriptor: registration.descriptor,
    adapter: registration.adapter,
  });
}
