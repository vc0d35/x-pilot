import type { PageContext } from '../../shared/page';

export function ContextChip({ ctx, onDetach }: { ctx: PageContext; onDetach: () => void }) {
  const preview = (ctx.post.articleTitle || ctx.post.text).replace(/\s+/g, ' ').slice(0, 80);
  return (
    <div className="chip" title={ctx.post.url}>
      <span className="chip-label">{ctx.post.kind === 'article' ? 'Article' : 'Post'} by @{ctx.post.authorHandle}:</span>
      <span className="chip-text"> {preview}{preview.length === 80 ? '…' : ''}</span>
      <button className="chip-x" onClick={onDetach} aria-label="Detach context">×</button>
    </div>
  );
}
