import { IntegrationError, type IcsProvider, type IcsSource } from '../types';
import { ICS_FIXTURES } from '../fixtures/ics';

/**
 * The default ICS provider. Serves fixture documents by name, no network.
 *
 * It refuses an unknown ref rather than returning an empty calendar, because
 * "the import found nothing" and "the import was pointed at nothing" are
 * different problems and only one of them is the user's fault.
 */
export class FakeIcsProvider implements IcsProvider {
  readonly name = 'ics:fake';
  readonly isFake = true;

  constructor(private readonly fixtures: Record<string, string> = ICS_FIXTURES) {}

  listFixtures(): string[] {
    return Object.keys(this.fixtures).sort();
  }

  async fetchText(source: IcsSource): Promise<string> {
    const doc = this.fixtures[source.ref];
    if (doc === undefined) {
      throw new IntegrationError(
        'ics:fake',
        'not_found',
        `no fixture named "${source.ref}" (have: ${this.listFixtures().join(', ')})`,
      );
    }
    return doc;
  }
}
