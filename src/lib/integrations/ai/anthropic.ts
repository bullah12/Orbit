/**
 * REAL IMPLEMENTATION — WRITTEN, NEVER RUN.
 *
 * The Anthropic Messages API, written from the published documentation. There
 * is no outbound network and no API key in the environment Orbit is built in,
 * so not one line of this has been executed. Do not describe it as working, and
 * do not let `FakeAiProvider` stand in for it in a claim that it does.
 *
 * Selected with AI_PROVIDER=anthropic. `ANTHROPIC_API_KEY` is required and is
 * read when the provider is **called**, never when it is constructed — the app
 * boots and demos with zero credentials whatever the env says, and that is a
 * hard requirement rather than a convenience.
 *
 * Written against the API as published rather than against the SDK, for the
 * same reason as every other real provider here: adding a dependency Orbit
 * cannot execute is a dependency nobody can check.
 *
 * Two things this deliberately does not do.
 *
 * It does not decide whether it is allowed to run. Consent is checked before
 * anything reaches this file (`src/lib/queries/ai.ts`), and a locked item is
 * refused before that — a provider that decided its own permissions would be
 * the only copy of that rule, and it would be in the file furthest from the
 * database.
 *
 * It does not retry. A refusal, a rate limit and a timeout are all reported as
 * what they are, and the `ai_runs` row records it. Silently retrying a request
 * that costs money and leaves the device is not an implementation detail.
 */

import { IntegrationError, type AiProvider, type AiRequest } from '../types';

const API = 'https://api.anthropic.com/v1/messages';

/**
 * The API version header, which is a date and not the model's.
 * Pinned deliberately: an unpinned version is a response shape that can change
 * under a build nobody is watching.
 */
const API_VERSION = '2023-06-01';

/** Overridable with ANTHROPIC_MODEL. */
const DEFAULT_MODEL = 'claude-opus-5';

type ContentBlock = { type: string; text?: string };

type MessagesResponse = {
  model: string;
  content: ContentBlock[];
  stop_reason: string | null;
  stop_details?: { type?: string; category?: string | null; explanation?: string } | null;
  usage?: { input_tokens?: number; output_tokens?: number };
};

export class AnthropicAiProvider implements AiProvider {
  readonly name = 'ai:anthropic';
  readonly isFake = false;

  constructor(
    private readonly env: Record<string, string | undefined> = process.env as Record<
      string,
      string | undefined
    >,
    private readonly timeoutMs = 30_000,
  ) {}

  private apiKey(): string {
    const key = this.env.ANTHROPIC_API_KEY;
    if (!key) {
      throw new IntegrationError(
        'ai:anthropic',
        'missing_credential',
        'set ANTHROPIC_API_KEY, or leave AI_PROVIDER=fake — the fake is deterministic, ' +
          'offline, and the one the tests exercise',
      );
    }
    return key;
  }

  async complete(request: AiRequest): Promise<{ text: string; model: string }> {
    const key = this.apiKey();
    const model = this.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;

    // The caller asserts the context holds nothing from a locked item. That
    // assertion is enforced two layers up, where the rows are read; here it is
    // only worth restating that this is the boundary it protects.
    const prompt = request.context
      ? `${request.context}\n\n---\n\n${request.prompt}`
      : request.prompt;

    const body = {
      model,
      max_tokens: 1024,
      system:
        'You are helping inside a private personal organiser. Answer in British English, ' +
        'plainly and briefly. Do not invent facts that are not in what you were given.',
      messages: [{ role: 'user', content: prompt }],
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await fetch(API, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': API_VERSION,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      throw new IntegrationError(
        'ai:anthropic',
        'transport',
        err instanceof Error && err.name === 'AbortError'
          ? `no answer within ${this.timeoutMs}ms`
          : `could not reach the API: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 401 || response.status === 403) {
      throw new IntegrationError(
        'ai:anthropic',
        'missing_credential',
        `the API rejected the key (${response.status})`,
      );
    }
    if (!response.ok) {
      throw new IntegrationError(
        'ai:anthropic',
        'transport',
        `the API answered ${response.status}`,
      );
    }

    let payload: MessagesResponse;
    try {
      payload = (await response.json()) as MessagesResponse;
    } catch {
      throw new IntegrationError('ai:anthropic', 'malformed', 'the API answered with non-JSON');
    }

    // A refusal is a successful HTTP response with an empty or partial body, so
    // reading content[0] first would be reading a refusal as an answer.
    if (payload.stop_reason === 'refusal') {
      throw new IntegrationError(
        'ai:anthropic',
        'malformed',
        `the model declined to answer${
          payload.stop_details?.category ? ` (${payload.stop_details.category})` : ''
        }`,
      );
    }

    const text = (payload.content ?? [])
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text as string)
      .join('')
      .trim();

    if (!text) {
      throw new IntegrationError('ai:anthropic', 'malformed', 'the API answered with no text');
    }

    return { text, model: payload.model ?? model };
  }
}
