import type { RegisteredAdapter } from './RegisteredAdapter.js';
import type { RegistrationError } from './RegistrationError.js';

export class RegistrationResult {
  readonly adapters: ReadonlyMap<string, RegisteredAdapter>;
  readonly errors: readonly RegistrationError[];

  constructor(
    adapters: ReadonlyMap<string, RegisteredAdapter>,
    errors: readonly RegistrationError[],
  ) {
    this.adapters = adapters;
    this.errors = errors;
  }
}
