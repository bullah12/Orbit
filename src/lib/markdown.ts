/**
 * A small Markdown subset, parsed to a tree.
 *
 * Notes are authored and stored as Markdown, so rendering them as plain text
 * was simply wrong. This is deliberately not a full CommonMark implementation:
 * it covers what a note actually contains — headings, lists, quotes, fenced
 * code, emphasis, inline code and links — and treats everything else as text.
 *
 * There is no HTML passthrough, by design. The parser produces a tree of typed
 * nodes and React renders it, so a note body can never introduce markup; the
 * usual sanitiser question does not arise because raw HTML is never a node.
 * The one thing that still needs a check is link targets, hence `safeHref`.
 */

export type Inline =
  | { type: 'text'; value: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'code'; value: string }
  | { type: 'link'; href: string; children: Inline[] };

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3; children: Inline[] }
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'list'; ordered: boolean; items: Inline[][] }
  | { type: 'quote'; children: Inline[] }
  | { type: 'code'; lang: string | null; value: string }
  | { type: 'rule' };

/**
 * Only schemes that cannot execute. `javascript:` and `data:` are the two that
 * matter; anything unrecognised is dropped rather than guessed at.
 */
export function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (href === '') return null;
  if (/^(https?:|mailto:)/i.test(href)) return href;
  // Relative links inside the app are fine; a protocol-relative //host is not,
  // because it inherits the page's scheme and leaves the app.
  if (/^\/(?!\/)/.test(href) || /^#/.test(href)) return href;
  return null;
}

export function parseMarkdown(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    if (line.trim() === '') { i += 1; continue; }

    // Fenced code. Everything up to the closing fence is literal, including
    // things that would otherwise look like headings.
    const fence = /^```\s*([A-Za-z0-9_+-]*)\s*$/.exec(line);
    if (fence) {
      const lang = fence[1] || null;
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i]!)) { body.push(lines[i]!); i += 1; }
      i += 1; // consume the closing fence, or fall off the end
      blocks.push({ type: 'code', lang, value: body.join('\n') });
      continue;
    }

    if (/^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ type: 'rule' });
      i += 1;
      continue;
    }

    const heading = /^ {0,3}(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({
        type: 'heading',
        level: heading[1]!.length as 1 | 2 | 3,
        children: parseInline(heading[2]!.trim()),
      });
      i += 1;
      continue;
    }

    if (/^ {0,3}>\s?/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^ {0,3}>\s?/.test(lines[i]!)) {
        body.push(lines[i]!.replace(/^ {0,3}>\s?/, ''));
        i += 1;
      }
      blocks.push({ type: 'quote', children: parseInline(body.join(' ').trim()) });
      continue;
    }

    const bullet = /^ {0,3}[-*+]\s+(.*)$/;
    const numbered = /^ {0,3}\d+[.)]\s+(.*)$/;
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = !bullet.test(line);
      const re = ordered ? numbered : bullet;
      const items: Inline[][] = [];
      while (i < lines.length) {
        const m = re.exec(lines[i]!);
        if (!m) break;
        items.push(parseInline(m[1]!));
        i += 1;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    // Paragraph: consecutive non-blank lines that do not start another block.
    const para: string[] = [];
    while (i < lines.length) {
      const l = lines[i]!;
      if (
        l.trim() === '' ||
        /^```/.test(l) ||
        /^ {0,3}#{1,3}\s/.test(l) ||
        /^ {0,3}>\s?/.test(l) ||
        bullet.test(l) ||
        numbered.test(l) ||
        /^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(l)
      ) break;
      para.push(l.trim());
      i += 1;
    }
    blocks.push({ type: 'paragraph', children: parseInline(para.join(' ')) });
  }

  return blocks;
}

/**
 * Inline parsing, innermost-first by scanning for the earliest opener.
 *
 * Code spans win over everything, so `**not bold**` inside backticks stays
 * literal — that is the behaviour a person writing notes about Markdown
 * expects.
 */
export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let rest = src;

  const patterns: { re: RegExp; make: (m: RegExpExecArray) => Inline | null }[] = [
    { re: /`([^`]+)`/, make: (m) => ({ type: 'code', value: m[1]! }) },
    {
      re: /\[([^\]]*)\]\(([^)\s]+)\)/,
      make: (m) => {
        const href = safeHref(m[2]!);
        // A link we will not follow becomes its own text, so nothing is lost
        // from the note and nothing unsafe is rendered.
        if (!href) return { type: 'text', value: `[${m[1]}](${m[2]})` };
        return { type: 'link', href, children: parseInline(m[1]!) };
      },
    },
    { re: /\*\*([^*]+)\*\*/, make: (m) => ({ type: 'strong', children: parseInline(m[1]!) }) },
    { re: /__([^_]+)__/, make: (m) => ({ type: 'strong', children: parseInline(m[1]!) }) },
    { re: /(?<![*\w])\*([^*\n]+)\*(?!\*)/, make: (m) => ({ type: 'em', children: parseInline(m[1]!) }) },
    { re: /(?<![_\w])_([^_\n]+)_(?!_)/, make: (m) => ({ type: 'em', children: parseInline(m[1]!) }) },
    {
      re: /(?<![\w@/.])((?:https?:\/\/)[^\s<>()]+[^\s<>().,;:!?])/,
      make: (m) => ({ type: 'link', href: m[1]!, children: [{ type: 'text', value: m[1]! }] }),
    },
  ];

  // Bounded: every iteration consumes at least one character of `rest`.
  while (rest.length > 0) {
    let best: { index: number; length: number; node: Inline | null } | null = null;

    for (const { re, make } of patterns) {
      const m = re.exec(rest);
      if (!m) continue;
      if (best === null || m.index < best.index) {
        best = { index: m.index, length: m[0]!.length, node: make(m) };
      }
    }

    if (!best) { pushText(out, rest); break; }
    if (best.index > 0) pushText(out, rest.slice(0, best.index));
    if (best.node) {
      if (best.node.type === 'text') pushText(out, best.node.value);
      else out.push(best.node);
    }
    rest = rest.slice(best.index + best.length);
  }

  return out;
}

function pushText(out: Inline[], value: string) {
  if (value === '') return;
  const last = out[out.length - 1];
  if (last && last.type === 'text') last.value += value;
  else out.push({ type: 'text', value });
}

/** Plain text of a note, for previews and for the day a search snippet needs one. */
export function markdownToPlainText(md: string): string {
  return parseMarkdown(md)
    .map((b) => {
      switch (b.type) {
        case 'code': return b.value;
        case 'rule': return '';
        case 'list': return b.items.map(inlineText).join(' ');
        default: return inlineText(b.children);
      }
    })
    .filter((s) => s !== '')
    .join('\n');
}

function inlineText(nodes: Inline[]): string {
  return nodes
    .map((n) => (n.type === 'text' ? n.value : n.type === 'code' ? n.value : inlineText(n.children)))
    .join('');
}
