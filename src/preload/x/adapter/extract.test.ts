// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { fixture } from '../../../../tests/fixtures';
import {
  pageKindFromUrl,
  extractPost,
  extractVisiblePosts,
  findMainArticle,
  extractThread,
  extractComposer,
  parseStats,
  postFromArticleUrl,
  extractArticle,
  extractNotifications,
  unreadNotificationCount,
  extractConversation,
  extractRepliesBelow,
} from './extract';
import { SEL } from './selectors';

describe('pageKindFromUrl', () => {
  it.each([
    ['https://x.com/home', 'home'],
    ['https://x.com/alice/status/111', 'post'],
    ['https://x.com/alice/status/111/photo/1', 'post'],
    ['https://x.com/i/article/123', 'article'],
    ['https://x.com/alice/article/123', 'article'],
    ['https://x.com/search?q=rust', 'search'],
    ['https://x.com/alice/likes', 'likes'],
    ['https://x.com/i/bookmarks', 'bookmarks'],
    ['https://x.com/notifications', 'notifications'],
    ['https://x.com/notifications/mentions', 'notifications'],
    ['https://x.com/alice', 'profile'],
    ['https://x.com/compose/post', 'compose'],
    ['https://x.com/intent/post?text=hi', 'compose'],
    ['https://x.com/explore', 'other'],
    ['https://x.com/i/flow/login', 'other'],
  ])('%s -> %s', (url, kind) => expect(pageKindFromUrl(url)).toBe(kind));
});

describe('parseStats', () => {
  it('parses the aria-label group', () => {
    expect(parseStats('3 replies, 2 reposts, 10 likes, 1,500 views')).toEqual({
      replies: 3,
      reposts: 2,
      likes: 10,
      bookmarks: 0,
      views: 1500,
    });
    expect(parseStats('1 like')).toEqual({ replies: 0, reposts: 0, likes: 1, bookmarks: 0, views: 0 });
    // A liked post's label says so with ", Liked": the comma is not a count of likes.
    expect(parseStats('24 replies, 52 reposts, 331 likes, Liked, 3 bookmarks, 10214 views')).toEqual({
      replies: 24,
      reposts: 52,
      likes: 331,
      bookmarks: 3,
      views: 10214,
    });
  });
});

describe('postFromArticleUrl', () => {
  it('synthesises an article post from /i/article and /handle/article urls', () => {
    expect(postFromArticleUrl('https://x.com/i/article/555', 'On Compilers')).toMatchObject({
      id: '555',
      kind: 'article',
      url: 'https://x.com/i/article/555',
      authorHandle: '',
      text: 'On Compilers',
    });
    expect(postFromArticleUrl('https://x.com/alice/article/777')).toMatchObject({
      id: '777',
      kind: 'article',
      url: 'https://x.com/alice/article/777',
      authorHandle: 'alice',
      text: '',
    });
  });
  it('returns null for non-article urls', () => {
    expect(postFromArticleUrl('https://x.com/alice/status/111')).toBeNull();
    expect(postFromArticleUrl('not a url')).toBeNull();
  });
});

describe('timeline extraction', () => {
  beforeEach(() => {
    document.body.innerHTML = fixture('x-timeline.html');
  });

  it('extracts posts with emoji alt text, author, url, time and stats', () => {
    const posts = extractVisiblePosts(document);
    expect(posts.map((p) => p.id)).toEqual(['111', '222', '333', '444']);
    expect(posts[0]).toEqual({
      id: '111',
      url: 'https://x.com/alice/status/111',
      authorHandle: 'alice',
      authorName: 'Alice Doe',
      text: 'Hello 🌍world',
      postedAt: '2026-09-01T10:00:00.000Z',
      kind: 'post',
      stats: { replies: 3, reposts: 2, likes: 10, bookmarks: 0, views: 1500 },
      quoted: null,
      liked: false,
      bookmarked: false,
    });
    expect(posts[1].text).toBe('Second post about rust');
  });

  it('says whether the user has liked or bookmarked a post, from the state of its buttons', () => {
    const posts = extractVisiblePosts(document);
    expect(posts[1]).toMatchObject({ id: '222', liked: true, bookmarked: true });
    // A post rendered without the buttons says nothing either way.
    for (const b of document.querySelectorAll('article:nth-of-type(1) button')) b.remove();
    expect(extractVisiblePosts(document)[0]).not.toHaveProperty('liked');
  });

  it('returns null for an article without a permalink and no fallback', () => {
    const junk = document.querySelectorAll(SEL.article)[2];
    expect(extractPost(junk)).toBeNull();
  });

  it('reads the composer state', () => {
    expect(extractComposer(document)).toEqual({ present: false, text: '', canSubmit: false });
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div role="dialog"><div data-testid="tweetTextarea_0" contenteditable="true"><span>draft</span></div><button data-testid="tweetButton">Post</button></div>',
    );
    expect(extractComposer(document)).toEqual({ present: true, text: 'draft', canSubmit: true });
    document.querySelector('[data-testid="tweetButton"]')!.setAttribute('aria-disabled', 'true');
    expect(extractComposer(document).canSubmit).toBe(false);
  });
});

describe('status page extraction', () => {
  beforeEach(() => {
    document.body.innerHTML = fixture('x-status.html');
  });

  it('finds the main article by permalink and extracts the author thread', () => {
    const url = 'https://x.com/alice/status/111';
    const main = findMainArticle(document, url)!;
    expect(main).not.toBeNull();
    const post = extractPost(main, url)!;
    expect(post.id).toBe('111');
    expect(post.text).toBe('Main post text. More text here…');
    const thread = extractThread(document, main, post.authorHandle);
    expect(thread.map((p) => p.id)).toEqual(['112', '113']);
  });

  it('falls back to the first article on a non-status page', () => {
    const main = findMainArticle(document, 'https://x.com/i/article/555')!;
    expect(extractPost(main, 'https://x.com/i/article/555')!.id).toBe('100');
  });

  it('reads the conversation by position: ancestors above, the thread, then replies until "Discover more"', () => {
    const url = 'https://x.com/alice/status/111';
    const main = findMainArticle(document, url)!;
    const post = extractPost(main, url)!;
    expect(post.inReplyTo).toEqual(['bob']);
    const c = extractConversation(document, main, 'alice');
    expect(c.ancestors.map((p) => p.id)).toEqual(['100']);
    expect(c.thread.map((p) => p.id)).toEqual(['112', '113']);
    expect(c.replies.map((p) => p.id)).toEqual(['999']);
    expect(c.replies[0].inReplyTo).toBeUndefined();
  });

  it('reads the replies below after a scroll, without the post itself and without the unrelated section', () => {
    expect(extractRepliesBelow(document, 'https://x.com/alice/status/111').map((p) => p.id)).toEqual(['100', '112', '113', '999']);
    document.querySelectorAll(SEL.article)[1].remove();
    expect(extractRepliesBelow(document, 'https://x.com/alice/status/111').map((p) => p.id)).toEqual(['100', '112', '113', '999']);
  });

  it('returns no main article when the page is a status page and nothing on it carries that permalink', () => {
    expect(findMainArticle(document, 'https://x.com/victim/status/9999999')).toBeNull();
  });

  it('stops the thread at an impostor whose display name matches but whose permalink does not', () => {
    const main = findMainArticle(document, 'https://x.com/alice/status/111')!;
    document.querySelectorAll(SEL.article)[2].insertAdjacentHTML(
      'beforebegin',
      `
      <article data-testid="tweet">
        <div data-testid="User-Name"><a role="link" href="/alice"><span>Alice Doe</span></a><a role="link" href="/alice"><span>@alice</span></a></div>
        <a href="/attacker/status/2" role="link"><time datetime="2026-09-01T10:00:30.000Z">Sep 1</time></a>
        <div data-testid="tweetText"><span>Impostor continuation</span></div>
      </article>`,
    );
    expect(extractThread(document, main, 'alice')).toEqual([]);
  });
});

describe('page-controlled identity', () => {
  const hostile = (attrs: string, permalink: string) => `
    <article data-testid="tweet"${attrs}>
      <div data-testid="User-Name"><a role="link" href="/nytimes"><span>@nytimes</span></a></div>
      <a href="${permalink}" role="link"><time datetime="2026-09-01T10:00:00.000Z">Sep 1</time></a>
      <div data-testid="tweetText"><span>attacker chosen text</span></div>
    </article>`;

  beforeEach(() => {
    document.body.innerHTML = fixture('x-status.html');
  });

  it('takes the handle from the permalink, never from the display name', () => {
    document.body.insertAdjacentHTML('beforeend', hostile('', '/attacker/status/1734000000000000000'));
    const articles = document.querySelectorAll(SEL.article);
    const post = extractPost(articles[articles.length - 1])!;
    expect(post.authorHandle).toBe('attacker');
    expect(post.url).toBe('https://x.com/attacker/status/1734000000000000000');
    expect(post.authorName).not.toContain('nytimes');
  });

  it('rejects permalinks that are not exactly /handle/status/<digits>', () => {
    for (const href of [
      '/vic\ntim/status/1',
      '/a/status/1x',
      '/a b/status/1',
      '/toolongahandlename1/status/1',
      '/a/status/',
      '/a/statuses/1',
    ]) {
      document.body.insertAdjacentHTML('beforeend', hostile('', href));
      const article = [...document.querySelectorAll(SEL.article)].at(-1)!;
      expect(extractPost(article), href).toBeNull();
    }
  });

  it('ignores a hidden injected article carrying the page permalink', () => {
    const url = 'https://x.com/alice/status/111';
    document.body.insertAdjacentHTML('afterbegin', hostile(' style="display:none"', '/attacker/status/111'));
    document.body.insertAdjacentHTML('afterbegin', hostile(' style="visibility:hidden"', '/attacker/status/111'));
    const main = findMainArticle(document, url)!;
    const post = extractPost(main, url)!;
    expect(post.authorHandle).toBe('alice');
    expect(post.text).toBe('Main post text. More text here…');
  });

  it('returns no main article when only a hidden article matches the page id', () => {
    document.body.innerHTML = hostile(' style="display:none"', '/attacker/status/424242');
    expect(findMainArticle(document, 'https://x.com/victim/status/424242')).toBeNull();
  });
});

describe('article extraction', () => {
  it('reads the dedicated title element and only the rich-text body, excluding author chrome', () => {
    document.body.innerHTML = fixture('x-article.html');
    const a = extractArticle(document)!;
    expect(a.title).toBe('On Compilers');
    expect(a.body).toContain('machine code');
    expect(a.body).toContain('Heading');
    expect(a.body).not.toContain('Follow');
    expect(a.body).not.toContain('11217');
  });
});

describe('quoted posts, cards and media', () => {
  it('reads the quoted post without letting it stand in for the post that quotes it', () => {
    document.body.innerHTML = fixture('x-status-quote.html');
    const url = 'https://x.com/pilvar222/status/2098139345328959887';
    const post = extractPost(findMainArticle(document, url)!, url)!;
    expect(post.authorHandle).toBe('pilvar222');
    expect(post.authorName).toBe('pilvar (Philippe Dourassov)');
    expect(post.postedAt).toBe('2026-09-10T19:59:36.000Z');
    expect(post.text).toContain('Why is Google proud of these');
    expect(post.text).not.toContain('166,000');
    expect(post.quoted).toEqual({
      authorHandle: 'GoogleAI',
      authorName: 'Google AI',
      text: expect.stringContaining('166,000 of the male fruit fly'),
      postedAt: '2026-09-10T18:00:26.000Z',
    });
  });

  it('takes the quoted handle from the avatar container when the quote carries no link', () => {
    document.body.innerHTML = fixture('x-status-quote.html');
    expect(document.querySelector(SEL.quotedPost)!.querySelectorAll('a[href]')).toHaveLength(0);
    document
      .querySelector('[data-testid="UserAvatar-Container-GoogleAI"]')!
      .setAttribute('data-testid', 'UserAvatar-Container-not a handle');
    expect(extractPost(document.querySelector(SEL.article)!)!.quoted!.authorHandle).toBe('');
  });

  it('is null when the post quotes nothing, and ignores a role=link block with no post text in it', () => {
    document.body.innerHTML = fixture('x-timeline.html');
    expect(extractVisiblePosts(document)[0].quoted).toBeNull();
    document.body.innerHTML = fixture('x-status.html');
    const main = findMainArticle(document, 'https://x.com/alice/status/111')!;
    main.insertAdjacentHTML('beforeend', '<div role="link" tabindex="0"><span>a badge, not a quote</span></div>');
    expect(extractPost(main)!.quoted).toBeNull();
  });

  it('picks the main article by its own permalink when an earlier article quotes that post', () => {
    const quoting = `
      <article data-testid="tweet">
        <div data-testid="User-Name"><a role="link" href="/mallory"><span>Mallory</span></a></div>
        <a href="/mallory/status/777" role="link"><time datetime="2026-09-01T09:00:00.000Z">Sep 1</time></a>
        <div role="link" tabindex="0">
          <div data-testid="UserAvatar-Container-alice"></div>
          <div data-testid="User-Name"><span>Alice Doe</span><span>@alice</span></div>
          <a href="/alice/status/111" role="link"><time datetime="2026-09-01T10:00:00.000Z">Sep 1</time></a>
          <div data-testid="tweetText"><span>Main post text. More text here…</span></div>
        </div>
        <div data-testid="tweetText"><span>Mallory's own words</span></div>
      </article>`;
    document.body.innerHTML = quoting + fixture('x-status.html');
    const main = findMainArticle(document, 'https://x.com/alice/status/111')!;
    const post = extractPost(main, 'https://x.com/alice/status/111')!;
    expect(post.authorHandle).toBe('alice');
    expect(post.text).toBe('Main post text. More text here…');
    // The quoting article is still readable, as itself.
    expect(extractPost(document.querySelector(SEL.article)!)).toMatchObject({
      id: '777',
      authorHandle: 'mallory',
      text: "Mallory's own words",
      quoted: { authorHandle: 'alice', text: 'Main post text. More text here…' },
    });
  });

  it('reads a link card as its target, its headline and its picture, skipping the domain line', () => {
    document.body.innerHTML = fixture('x-timeline.html');
    const card = extractVisiblePosts(document).find((p) => p.id === '333')!;
    expect(card.cards).toEqual([
      {
        url: 'https://t.co/abc123',
        title: 'Electron 40 ships a new renderer',
        image: 'https://pbs.twimg.com/card_img/1889404481/ZJ0mCxQ0?format=jpg&name=800x320_1',
      },
    ]);
    expect(card.media).toBeUndefined();
  });

  // The shape X renders for a promoted card: media and a call to action, no domain or headline lines.
  it('reads a card that carries no detail block from its only text line', () => {
    document.body.innerHTML = fixture('x-timeline.html');
    document.querySelector(SEL.linkCard)!.outerHTML = `
      <div data-testid="card.wrapper">
        <div data-testid="card.layoutLarge.media">
          <a href="https://www.12procent.nl/?twclid=22ilckn5msgpttbssiplkg656b" aria-label="12procent.nl meer informatie" role="link">
            <div><img alt="" /></div>
            <div><div dir="ltr"><span>meer informatie</span></div></div>
          </a>
        </div>
      </div>`;
    expect(extractVisiblePosts(document).find((p) => p.id === '333')!.cards).toEqual([
      { url: 'https://www.12procent.nl/?twclid=22ilckn5msgpttbssiplkg656b', title: 'meer informatie' },
    ]);
  });

  it('reads attached images with their alt text and their URL, and a player as one video', () => {
    document.body.innerHTML = fixture('x-timeline.html');
    const photos = extractVisiblePosts(document).find((p) => p.id === '444')!;
    // The second image is labelled "Image", which says nothing the kind does not.
    expect(photos.media).toEqual([
      {
        kind: 'image',
        alt: 'A chart of release cadence since 2013',
        url: 'https://pbs.twimg.com/media/HR7XqfOWAAcGIWv?format=jpg&name=small',
      },
      { kind: 'image', url: 'https://pbs.twimg.com/media/HR7XqfOWAAcGIWw?format=jpg&name=small' },
    ]);
    expect(photos.cards).toBeUndefined();
    document.querySelectorAll(SEL.article)[4].insertAdjacentHTML('beforeend', '<div data-testid="videoPlayer"><video></video></div>');
    expect(extractVisiblePosts(document).find((p) => p.id === '444')!.media).toContainEqual({ kind: 'video' });
  });

  it("reads the author's avatar, and not the avatar of the post they quote", () => {
    document.body.innerHTML = fixture('x-status-quote.html');
    const url = 'https://x.com/pilvar222/status/2098139345328959887';
    expect(extractPost(findMainArticle(document, url)!, url)!.authorAvatar).toBe(
      'https://pbs.twimg.com/profile_images/1833196679610175488/Cjtuov9z_normal.jpg',
    );
    document.body.innerHTML = fixture('x-timeline.html');
    const posts = extractVisiblePosts(document);
    expect(posts.find((p) => p.id === '444')!.authorAvatar).toBe(
      'https://pbs.twimg.com/profile_images/719163421934137344/RsnjNy0I_normal.jpg',
    );
    // The fixtures' other posts carry no avatar at all, and a missing field is not an empty one.
    expect(posts.find((p) => p.id === '111')).not.toHaveProperty('authorAvatar');
  });

  it('reads a video player as its poster frame, and an https source when there is one', () => {
    document.body.innerHTML = fixture('x-timeline.html');
    const poster = 'https://pbs.twimg.com/amplify_video_thumb/1889404481/img/ZJ0mCxQ0.jpg';
    const src = 'https://video.twimg.com/amplify_video/1889404481/vid/avc1/1280x720/ZJ0mCxQ0.mp4';
    const player = (video: string) => {
      const article = document.querySelectorAll(SEL.article)[1];
      article.querySelector('[data-testid="videoPlayer"]')?.remove();
      article.insertAdjacentHTML('beforeend', `<div data-testid="videoPlayer">${video}</div>`);
      return extractVisiblePosts(document).find((p) => p.id === '222')!.media;
    };
    expect(player(`<video poster="${poster}" src="${src}"></video>`)).toEqual([{ kind: 'video', url: src, preview: poster }]);
    // X plays most videos from a MediaSource: the blob: source is dropped and the poster is all there is.
    expect(player(`<video poster="${poster}" src="blob:https://x.com/8b3c-4f2a"></video>`)).toEqual([{ kind: 'video', preview: poster }]);
  });

  it('reads a video whose player has not mounted yet as its poster frame, not as a picture', () => {
    document.body.innerHTML = fixture('x-timeline.html');
    const article = document.querySelectorAll(SEL.article)[1];
    const thumb = (path: string) => `https://pbs.twimg.com/${path}/2097703920818954240/img/1NledwbaMPwHmGfb?format=jpg&name=medium`;
    const poster = (src: string) => {
      article.querySelector('[data-testid="tweetPhoto"]')?.remove();
      article.insertAdjacentHTML('beforeend', `<div data-testid="tweetPhoto"><img alt="Embedded video" src="${src}" /></div>`);
      return extractVisiblePosts(document).find((p) => p.id === '222')!.media;
    };
    expect(poster(thumb('amplify_video_thumb'))).toEqual([{ kind: 'video', preview: thumb('amplify_video_thumb') }]);
    expect(poster(thumb('ext_tw_video_thumb'))).toEqual([{ kind: 'video', preview: thumb('ext_tw_video_thumb') }]);
    expect(poster(thumb('tweet_video_thumb'))).toEqual([{ kind: 'gif', preview: thumb('tweet_video_thumb') }]);
  });

  it('counts a mounted player once, taking its poster from the photo it wraps', () => {
    document.body.innerHTML = fixture('x-timeline.html');
    const poster = 'https://pbs.twimg.com/amplify_video_thumb/1889404481/img/ZJ0mCxQ0.jpg';
    document
      .querySelectorAll(SEL.article)[1]
      .insertAdjacentHTML(
        'beforeend',
        `<div data-testid="videoPlayer"><div data-testid="tweetPhoto"><img alt="Embedded video" src="${poster}" /></div><video src="blob:https://x.com/8b3c"></video></div>`,
      );
    expect(extractVisiblePosts(document).find((p) => p.id === '222')!.media).toEqual([{ kind: 'video', preview: poster }]);
  });

  it('calls a looping attachment a gif, by the badge X prints or by the path it serves it from', () => {
    document.body.innerHTML = fixture('x-timeline.html');
    const gif = (player: string) => {
      const article = document.querySelectorAll(SEL.article)[1];
      article.querySelector('[data-testid="videoPlayer"]')?.remove();
      article.insertAdjacentHTML('beforeend', player);
      return extractVisiblePosts(document).find((p) => p.id === '222')!.media![0].kind;
    };
    expect(gif('<div data-testid="videoPlayer"><video></video><span>GIF</span></div>')).toBe('gif');
    expect(gif('<div data-testid="videoPlayer" aria-label="Embedded GIF"><video></video></div>')).toBe('gif');
    expect(gif('<div data-testid="videoPlayer"><video src="https://video.twimg.com/tweet_video/ZJ0mCxQ0.mp4"></video></div>')).toBe('gif');
    expect(gif('<div data-testid="videoPlayer"><video></video><span>0:42</span></div>')).toBe('video');
  });

  it("drops every media URL that is not https on one of X's own hosts, and never rewrites one", () => {
    document.body.innerHTML = fixture('x-timeline.html');
    const photo = document.querySelectorAll(SEL.tweetPhoto)[0];
    const avatar = document.querySelector(SEL.authorAvatar)!;
    const cardImage = document.querySelector(`${SEL.linkCard} img`)!;
    for (const bad of [
      'data:image/png;base64,iVBORw0KGgo=',
      'http://pbs.twimg.com/media/HR7XqfOWAAcGIWv.jpg',
      'https://evil.test/media/HR7XqfOWAAcGIWv.jpg',
      'https://twimg.com.evil.test/media/HR7XqfOWAAcGIWv.jpg',
    ]) {
      photo.setAttribute('src', bad);
      avatar.setAttribute('src', bad);
      cardImage.setAttribute('src', bad);
      const posts = extractVisiblePosts(document);
      expect(posts.find((p) => p.id === '444')!.media![0]).toEqual({ kind: 'image', alt: 'A chart of release cadence since 2013' });
      expect(posts.find((p) => p.id === '444')).not.toHaveProperty('authorAvatar');
      expect(posts.find((p) => p.id === '333')!.cards![0]).not.toHaveProperty('image');
    }
  });

  it('keeps at most four media entries, dropping the player when four pictures already filled them', () => {
    document.body.innerHTML = fixture('x-timeline.html');
    const article = document.querySelectorAll(SEL.article)[4];
    const src = 'https://pbs.twimg.com/media/HR7XqfOWAAcGIWx?format=jpg&name=small';
    for (let i = 0; i < 6; i++) article.insertAdjacentHTML('beforeend', `<div data-testid="tweetPhoto"><img alt="" src="${src}" /></div>`);
    article.insertAdjacentHTML('beforeend', '<div data-testid="videoPlayer"><video></video></div>');
    const media = extractVisiblePosts(document).find((p) => p.id === '444')!.media!;
    expect(media).toHaveLength(4);
    expect(media.map((m) => m.kind)).toEqual(['image', 'image', 'image', 'image']);
  });
});

describe('notifications', () => {
  beforeEach(() => {
    document.body.innerHTML = fixture('x-notifications.html');
  });

  it('reads the unread count off the navigation bar, 0 without a badge, null without the bar', () => {
    expect(unreadNotificationCount(document)).toBe(2);
    document.querySelector(SEL.notificationsLink)!.setAttribute('aria-label', 'Notifications');
    expect(unreadNotificationCount(document)).toBe(0);
    document.querySelector(SEL.notificationsLink)!.remove();
    expect(unreadNotificationCount(document)).toBeNull();
  });

  it('reads every entry in order: replies as posts, the rest as who did what', () => {
    const entries = extractNotifications(document);
    expect(entries.map((e) => [e.kind, e.headline])).toEqual([
      ['post', '@serros404 replied to you'],
      ['like', 'Alex Van de Sande (avsa.eth) liked your reply'],
      ['new_posts', 'New post notifications for Tibo and Immunefi'],
      ['repost', 'Carol reposted your post'],
      ['follow', 'Dave followed you'],
    ]);
    expect(entries[0].post).toMatchObject({
      id: '2098773361820065897',
      url: 'https://x.com/serros404/status/2098773361820065897',
      inReplyTo: ['v_c0d35'],
    });
    expect(entries[0].text).toBe('foram pra triagem');
    expect(entries[1]).toMatchObject({
      actors: [{ handle: 'avsa', name: 'Alex Van de Sande (avsa.eth)' }],
      text: 'This looks very cool, thanks for sharing.',
      at: '2026-09-11T21:10:18.149Z',
      post: null,
    });
    expect(entries[2].actors).toEqual([
      { handle: 'thsottiaux', name: 'Tibo' },
      { handle: 'immunefi', name: 'Immunefi' },
    ]);
    expect(entries[4]).toMatchObject({ text: '', actors: [{ handle: 'dave', name: 'Dave' }] });
  });

  it('gives each entry an id that survives a re-render and differs between entries', () => {
    const ids = extractNotifications(document).map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}$/);
    document.body.innerHTML = fixture('x-notifications.html');
    expect(extractNotifications(document).map((e) => e.id)).toEqual(ids);
  });
});
