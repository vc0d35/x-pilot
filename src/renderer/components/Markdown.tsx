import { Children, isValidElement, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { deceptiveLinkHost } from '../display-safety';

function plainText(node: ReactNode): string {
  let out = '';
  Children.forEach(node, (child) => {
    if (typeof child === 'string' || typeof child === 'number') out += String(child);
    else if (isValidElement<{ children?: ReactNode }>(child)) out += plainText(child.props.children);
  });
  return out;
}

/** Links go through main so x.com opens in the window and everything else in the browser. */
export function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => {
          // The link text is model-written: when it names a destination, show where the link really goes.
          const realHost = href ? deceptiveLinkHost(plainText(children), href) : null;
          return (
            <a href={href} title={href} onClick={(e) => { e.preventDefault(); if (href) void window.xpilot.openLink(href); }}>
              {children}{realHost ? <span className="link-host"> ({realHost})</span> : null}
            </a>
          );
        },
      }}
    >
      {text}
    </ReactMarkdown>
  );
}
