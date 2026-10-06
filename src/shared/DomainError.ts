// A domain-level error: a problem with the input or state the core was
// asked to act on, distinct from transport/infrastructure failures.
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainError';
  }
}
