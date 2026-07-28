import { Fragment } from 'react';
import { parseMarkdown, type Block, type Inline } from '@/lib/markdown';

/**
 * Renders the note Markdown subset.
 *
 * The parser produces typed nodes and this maps them to elements — there is no
 * dangerouslySetInnerHTML anywhere, so a note body cannot introduce markup.
 * Type scale stays inside the dense range the rest of the app uses: a note is
 * something you read next to a list, not a document.
 */
export function Markdown({ source }: { source: string }) {
  const blocks = parseMarkdown(source);
  if (blocks.length === 0) return null;

  return (
    <div className="flex flex-col gap-2.5 text-[13px] leading-relaxed">
      {blocks.map((b, i) => (
        <BlockNode key={i} block={b} />
      ))}
    </div>
  );
}

function BlockNode({ block }: { block: Block }) {
  switch (block.type) {
    case 'heading': {
      const cls =
        block.level === 1 ? 'mt-1 text-[15px] font-semibold'
        : block.level === 2 ? 'mt-1 text-[13.5px] font-semibold'
        : 'muted mt-1 text-[12px] font-semibold uppercase tracking-wide';
      if (block.level === 1) return <h2 className={cls}><InlineNodes nodes={block.children} /></h2>;
      if (block.level === 2) return <h3 className={cls}><InlineNodes nodes={block.children} /></h3>;
      return <h4 className={cls}><InlineNodes nodes={block.children} /></h4>;
    }

    case 'paragraph':
      return <p><InlineNodes nodes={block.children} /></p>;

    case 'list':
      return block.ordered ? (
        <ol className="ml-5 flex list-decimal flex-col gap-1">
          {block.items.map((item, i) => <li key={i}><InlineNodes nodes={item} /></li>)}
        </ol>
      ) : (
        <ul className="ml-5 flex list-disc flex-col gap-1">
          {block.items.map((item, i) => <li key={i}><InlineNodes nodes={item} /></li>)}
        </ul>
      );

    case 'quote':
      return (
        <blockquote
          className="muted border-l-2 pl-3 italic"
          style={{ borderColor: 'var(--line-strong)' }}
        >
          <InlineNodes nodes={block.children} />
        </blockquote>
      );

    case 'code':
      return (
        <pre
          className="surface overflow-x-auto rounded p-2.5 font-mono text-[12px] leading-snug"
          aria-label={block.lang ? `Code, ${block.lang}` : 'Code'}
        >
          <code>{block.value}</code>
        </pre>
      );

    case 'rule':
      return <hr className="hairline border-t" />;
  }
}

function InlineNodes({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((n, i) => (
        <Fragment key={i}>
          <InlineNode node={n} />
        </Fragment>
      ))}
    </>
  );
}

function InlineNode({ node }: { node: Inline }) {
  switch (node.type) {
    case 'text':
      return <>{node.value}</>;
    case 'strong':
      return <strong className="font-semibold"><InlineNodes nodes={node.children} /></strong>;
    case 'em':
      return <em><InlineNodes nodes={node.children} /></em>;
    case 'code':
      return (
        <code
          className="rounded px-1 py-0.5 font-mono text-[12px]"
          style={{ background: 'var(--bg-hover)' }}
        >
          {node.value}
        </code>
      );
    case 'link':
      return (
        <a
          href={node.href}
          className="underline underline-offset-2"
          style={{ color: 'var(--accent)' }}
          {...(/^https?:/i.test(node.href)
            ? { target: '_blank', rel: 'noopener noreferrer' }
            : {})}
        >
          <InlineNodes nodes={node.children} />
        </a>
      );
  }
}
