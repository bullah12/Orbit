import { describe, expect, it } from 'vitest';
import {
  markdownToPlainText,
  parseInline,
  parseMarkdown,
  safeHref,
  type Inline,
} from '@/lib/markdown';

const text = (value: string): Inline => ({ type: 'text', value });

describe('safeHref', () => {
  it('allows http, https and mailto', () => {
    expect(safeHref('https://example.com')).toBe('https://example.com');
    expect(safeHref('http://example.com')).toBe('http://example.com');
    expect(safeHref('mailto:someone@example.com')).toBe('mailto:someone@example.com');
  });

  it('allows in-app paths and fragments', () => {
    expect(safeHref('/tasks/all')).toBe('/tasks/all');
    expect(safeHref('#section')).toBe('#section');
  });

  it('refuses javascript: however it is dressed up', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('JavaScript:alert(1)')).toBeNull();
    expect(safeHref('  javascript:alert(1)  ')).toBeNull();
  });

  it('refuses data: and protocol-relative URLs', () => {
    expect(safeHref('data:text/html,<script>')).toBeNull();
    expect(safeHref('//evil.example.com')).toBeNull();
  });

  it('refuses an empty target', () => {
    expect(safeHref('')).toBeNull();
    expect(safeHref('   ')).toBeNull();
  });
});

describe('parseInline', () => {
  it('leaves plain text alone', () => {
    expect(parseInline('just words')).toEqual([text('just words')]);
  });

  it('reads bold and italic', () => {
    expect(parseInline('a **bold** word')).toEqual([
      text('a '),
      { type: 'strong', children: [text('bold')] },
      text(' word'),
    ]);
    expect(parseInline('an *italic* word')).toEqual([
      text('an '),
      { type: 'em', children: [text('italic')] },
      text(' word'),
    ]);
  });

  it('does not read an underscore inside a word as emphasis', () => {
    expect(parseInline('space_id and owner_id')).toEqual([text('space_id and owner_id')]);
  });

  it('lets code spans win, so backticked markup stays literal', () => {
    expect(parseInline('use `**not bold**` here')).toEqual([
      text('use '),
      { type: 'code', value: '**not bold**' },
      text(' here'),
    ]);
  });

  it('reads a link', () => {
    expect(parseInline('see [the docs](https://example.com/x)')).toEqual([
      text('see '),
      { type: 'link', href: 'https://example.com/x', children: [text('the docs')] },
    ]);
  });

  it('renders an unsafe link as its own literal text rather than dropping it', () => {
    expect(parseInline('[click](javascript:alert(1))')).toEqual([
      text('[click](javascript:alert(1))'),
    ]);
  });

  it('autolinks a bare https URL', () => {
    const out = parseInline('go to https://example.com/a now');
    expect(out[1]).toEqual({
      type: 'link',
      href: 'https://example.com/a',
      children: [text('https://example.com/a')],
    });
  });

  it('does not swallow the sentence-ending full stop into the URL', () => {
    const out = parseInline('see https://example.com/a.');
    expect(out).toEqual([
      text('see '),
      { type: 'link', href: 'https://example.com/a', children: [text('https://example.com/a')] },
      text('.'),
    ]);
  });

  it('nests emphasis inside a link', () => {
    expect(parseInline('[**bold link**](https://example.com)')).toEqual([
      {
        type: 'link',
        href: 'https://example.com',
        children: [{ type: 'strong', children: [text('bold link')] }],
      },
    ]);
  });

  it('terminates on unbalanced markers instead of looping', () => {
    expect(parseInline('**unclosed')).toEqual([text('**unclosed')]);
    expect(parseInline('a ` b')).toEqual([text('a ` b')]);
  });

  it('never emits raw HTML as anything but text', () => {
    expect(parseInline('<script>alert(1)</script>')).toEqual([
      text('<script>alert(1)</script>'),
    ]);
  });
});

describe('parseMarkdown', () => {
  it('reads headings at three levels and no further', () => {
    expect(parseMarkdown('# One')).toEqual([
      { type: 'heading', level: 1, children: [text('One')] },
    ]);
    expect(parseMarkdown('### Three')[0]).toMatchObject({ type: 'heading', level: 3 });
    expect(parseMarkdown('#### Four')[0]).toMatchObject({ type: 'paragraph' });
  });

  it('joins wrapped lines into one paragraph and splits on a blank line', () => {
    const blocks = parseMarkdown('one\ntwo\n\nthree');
    expect(blocks).toEqual([
      { type: 'paragraph', children: [text('one two')] },
      { type: 'paragraph', children: [text('three')] },
    ]);
  });

  it('reads bullet and numbered lists', () => {
    expect(parseMarkdown('- a\n- b')).toEqual([
      { type: 'list', ordered: false, items: [[text('a')], [text('b')]] },
    ]);
    expect(parseMarkdown('1. a\n2. b')).toEqual([
      { type: 'list', ordered: true, items: [[text('a')], [text('b')]] },
    ]);
  });

  it('ends a list at the first non-item line', () => {
    const blocks = parseMarkdown('- a\n- b\n\nafter');
    expect(blocks).toHaveLength(2);
    expect(blocks[1]).toEqual({ type: 'paragraph', children: [text('after')] });
  });

  it('keeps fenced code literal, headings and all', () => {
    const blocks = parseMarkdown('```sql\n# not a heading\nselect 1;\n```');
    expect(blocks).toEqual([
      { type: 'code', lang: 'sql', value: '# not a heading\nselect 1;' },
    ]);
  });

  it('closes an unterminated fence at the end of the note', () => {
    expect(parseMarkdown('```\nabc')).toEqual([{ type: 'code', lang: null, value: 'abc' }]);
  });

  it('reads a blockquote, joining its lines', () => {
    expect(parseMarkdown('> one\n> two')).toEqual([
      { type: 'quote', children: [text('one two')] },
    ]);
  });

  it('reads a horizontal rule', () => {
    expect(parseMarkdown('---')).toEqual([{ type: 'rule' }]);
    expect(parseMarkdown('***')).toEqual([{ type: 'rule' }]);
  });

  it('returns nothing for an empty or whitespace-only note', () => {
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown('\n\n   \n')).toEqual([]);
  });

  it('handles a realistic note without losing anything', () => {
    const blocks = parseMarkdown(
      '# Boiler\n\nServiced by **Whitehouse Heating**.\n\n- Annual service\n- Filter change\n\n> Warranty runs to 2029.',
    );
    expect(blocks.map((b) => b.type)).toEqual([
      'heading', 'paragraph', 'list', 'quote',
    ]);
  });

  it('normalises CRLF line endings', () => {
    expect(parseMarkdown('one\r\n\r\ntwo')).toHaveLength(2);
  });
});

describe('markdownToPlainText', () => {
  it('strips the markup and keeps the words', () => {
    expect(markdownToPlainText('# Title\n\nSome **bold** text.')).toBe('Title\nSome bold text.');
  });

  it('keeps code contents', () => {
    expect(markdownToPlainText('```\nselect 1;\n```')).toBe('select 1;');
  });

  it('flattens a list onto one line', () => {
    expect(markdownToPlainText('- a\n- b')).toBe('a b');
  });
});
