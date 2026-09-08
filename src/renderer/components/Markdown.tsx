import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** Links go through main so x.com opens in the window and everything else in the browser. */
export function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => (
          <a href={href} title={href} onClick={(e) => { e.preventDefault(); if (href) void window.xpilot.openLink(href); }}>{children}</a>
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  );
}
