export class RegistrationError {
  readonly applicationId: string;
  readonly reason: string;

  constructor(applicationId: string, reason: string) {
    this.applicationId = applicationId;
    this.reason = reason;
  }
}
