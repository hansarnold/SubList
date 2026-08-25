import type {
  EmailSender,
  ReminderEmailEnvelope,
  ReminderEmailSendOutcome,
} from "../../application/ports";

export type FakeEmailMetadata = {
  applicationIdempotencyKey: string;
  textBytes: number;
  htmlBytes: number;
};

export class FakeEmailSender implements EmailSender {
  readonly sent: FakeEmailMetadata[] = [];

  constructor(
    private readonly outcomes: ReminderEmailSendOutcome[] = [
      { kind: "accepted", providerMessageId: "fake-message" },
    ],
  ) {}

  send(envelope: ReminderEmailEnvelope): Promise<ReminderEmailSendOutcome> {
    this.sent.push({
      applicationIdempotencyKey: envelope.applicationIdempotencyKey,
      textBytes: new TextEncoder().encode(envelope.text).byteLength,
      htmlBytes: new TextEncoder().encode(envelope.html).byteLength,
    });
    return Promise.resolve(
      this.outcomes.shift() ?? { kind: "accepted", providerMessageId: "fake-message" },
    );
  }
}
