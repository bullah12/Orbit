import Link from 'next/link';
import { Icon } from './Icon';

/**
 * Search, in the header of a page that bears a list.
 *
 * It was a tab, sharing the bar with five other things. A tab is the wrong
 * shape for it: search is something you do *to* the list you are looking at,
 * not a sixth place to stand. In the header it can carry that page's context
 * into the query — `kind=person` from People — which a tab pointing at a bare
 * `/search` never could.
 *
 * A link, not a button: `/search` is a page with a bookmarkable URL and this
 * is a plain navigation to it. 44px square, because it is the smallest thing
 * a thumb hits reliably and the icon inside it is 20px.
 */
export function SearchButton({
  kind,
  label = 'Search',
}: {
  /** Prefilled `kind=` for the search page, where the page has one to offer. */
  kind?: 'task' | 'note' | 'person' | 'event' | 'place';
  label?: string;
}) {
  return (
    <Link
      href={(kind ? `/search?kind=${kind}` : '/search') as never}
      aria-label={label}
      className="row-hover flex h-11 w-11 shrink-0 items-center justify-center rounded"
    >
      <Icon name="search" size={20} className="muted" />
    </Link>
  );
}
