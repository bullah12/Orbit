import type { AiProvider, AiRequest } from '../types';

/**
 * The default AI provider. Entirely local, deterministic, and offline.
 *
 * AI is off by default and opt-in per feature (decision 8); this exists so the
 * plumbing around that consent can be built and tested without a key and
 * without anything leaving the device. It is not a language model and does not
 * pretend to be one — it returns a stated placeholder so a screen that forgot
 * to check consent is obvious rather than plausible.
 */
export class FakeAiProvider implements AiProvider {
  readonly name = 'ai:fake';
  readonly isFake = true;
  readonly calls: AiRequest[] = [];

  async complete(request: AiRequest): Promise<{ text: string; model: string }> {
    this.calls.push(request);
    const words = request.prompt.trim().split(/\s+/).filter(Boolean).length;
    return {
      text: `[fake AI — nothing left this device] ${request.feature}: ${words} words in.`,
      model: 'fake-local',
    };
  }
}
