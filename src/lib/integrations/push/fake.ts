import type { PushMessage, PushProvider } from '../types';

/**
 * The default push provider. Delivers into an in-memory outbox and nowhere
 * else, so a rule that fires during a test is inspectable and nothing leaves
 * the machine.
 *
 * Note what push is *not* used for (decision 10): there is no post-event
 * prompt, and there never will be.
 */
export class FakePushProvider implements PushProvider {
  readonly name = 'push:fake';
  readonly isFake = true;
  readonly outbox: { subscriptionRef: string; message: PushMessage; at: string }[] = [];

  async send(subscriptionRef: string, message: PushMessage): Promise<{ delivered: boolean }> {
    this.outbox.push({ subscriptionRef, message, at: new Date().toISOString() });
    return { delivered: true };
  }
}
