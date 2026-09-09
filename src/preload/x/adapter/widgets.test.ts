// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { fixture } from '../../../../tests/fixtures';
import { extractWidgets, findNewPostsButton, textLines, widgetItem } from './widgets';

const el = (html: string) => {
  const d = document.createElement('div');
  d.innerHTML = html;
  return d.firstElementChild!;
};

describe('textLines', () => {
  it('splits at block boundaries, collapses whitespace, skips buttons and repeated lines', () => {
    const e = el(
      '<div><div><span>Trending in </span><span>Netherlands</span></div><div><span>#tag</span><span>#tag</span></div><button><svg></svg>x</button><div>  </div></div>',
    );
    expect(textLines(e)).toEqual(['Trending in Netherlands', '#tag']);
  });
});

describe('widgetItem', () => {
  it('names a trend by the line that is neither context nor count', () => {
    expect(widgetItem(el('<div data-testid="trend"><div>Politics · Trending</div><div>Rusland</div><div>12.3K posts</div></div>'))).toEqual(
      { title: 'Rusland', detail: 'Politics · Trending · 12.3K posts' },
    );
    expect(widgetItem(el('<div data-testid="trend"><div>Trending in Netherlands</div><div>Nijkerk</div></div>'))).toEqual({
      title: 'Nijkerk',
      detail: 'Trending in Netherlands',
    });
  });
  it('uses the first line for a news headline even when it mentions trending', () => {
    expect(
      widgetItem(
        el('<div data-testid="news_sidebar_article_x"><div>Why Trending Topics Fade</div><div>1 hour ago · Other · 9 posts</div></div>'),
      ),
    ).toEqual({ title: 'Why Trending Topics Fade', detail: '1 hour ago · Other · 9 posts' });
  });
  it('falls back to the first line when every line looks like context', () => {
    expect(widgetItem(el('<div data-testid="trend"><div>Trending</div></div>'))).toEqual({ title: 'Trending', detail: '' });
    expect(widgetItem(el('<div data-testid="trend"></div>'))).toBeNull();
  });
});

describe('extractWidgets', () => {
  it('groups Explore and sidebar items under their headings, resetting at empty cells, and dedupes titles', () => {
    document.body.innerHTML = fixture('x-explore.html');
    const sections = extractWidgets(document);
    expect(sections.map((s) => [s.heading, s.items.map((i) => i.title)])).toEqual([
      [
        "Today's News",
        ['Meme Contrasts Vibe Coding Chaos with Neat Engineering', "Blockbuster's 2001 Shift from VHS to DVDs Marks 25 Years"],
      ],
      ['Trending', ['Nijkerk', 'Rusland', '#nieuwsvandedag']],
      ['Today’s News', ['Meme Contrasts Vibe Coding Chaos with Neat Engineering', 'ZKsync Open-Sources Permissioning Engine']],
      ['What’s happening', ['Leclerc']],
    ]);
    expect(sections[0].items[0].detail).toBe('Trending now · News · 200 posts');
    expect(sections[2].items[0].detail).toBe('1 hour ago · Other · 200 posts');
    expect(sections[3].items[0]).toEqual({ title: 'Leclerc', detail: 'Motorsport · Trending · 5,120 posts' });
  });
  it('returns nothing on a page without widgets', () => {
    document.body.innerHTML = fixture('x-status.html');
    expect(extractWidgets(document)).toEqual([]);
  });
});

describe('findNewPostsButton', () => {
  it('finds the pill by its label and parses the count', () => {
    document.body.innerHTML =
      '<div data-testid="primaryColumn"><div data-testid="cellInnerDiv"><button aria-label="Retry">Retry</button></div><div data-testid="cellInnerDiv"><button><div><span>Show 1,204 posts</span></div></button></div></div>';
    expect(findNewPostsButton(document)?.count).toBe(1204);
    document.body.innerHTML = '<div data-testid="primaryColumn"><div data-testid="cellInnerDiv"><button>Show 1 post</button></div></div>';
    expect(findNewPostsButton(document)?.count).toBe(1);
    document.body.innerHTML = '<div data-testid="primaryColumn"><button>Show 3 posts</button></div>';
    expect(findNewPostsButton(document)).toBeNull();
  });
});
