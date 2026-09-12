import {
  MAX_VIEW_BYTES,
  MAX_VIEW_FILE_BYTES,
  VIEW_CALLS_PER_WINDOW,
  VIEW_CALL_WINDOW_MS,
  VIEW_FILE_EXTENSIONS,
  VIEW_RUNTIME_ERRORS_PER_WINDOW,
  VIEW_STATE_BYTES_MAX,
  VIEW_STATE_FOCUS_TEXT_MAX,
  VIEW_STATE_ITEMS_MAX,
  VIEW_STATE_ITEM_TEXT_MAX,
  VIEW_STATE_SUMMARY_MAX,
  VIEW_STATE_UPDATES_PER_WINDOW,
  VIEW_UNRESPONSIVE_MS,
} from '../../shared/views';

/**
 * The whole contract a view is written against, as the agent reads it. It is text rather than a
 * schema because the model is writing a web page, not calling a function: what it needs is the
 * shape of `window.xpilotView`, what is refused, and what the page it draws on is allowed to load.
 */
export const VIEW_API_CONTRACT = `A custom view is a small web app in <profile>/views/<name>/ that XPilot renders over the x.com page, in its own window. index.html is what loads. Your code never runs inside x.com, and the X page stays loaded underneath: it is where a view's data comes from.

The view's window has no network. fetch, XHR, WebSocket and any foreign URL are blocked by its content policy, and it has none of the X session's cookies. Everything a view knows comes through one object:

window.xpilotView
  subscribe(feed, cb) -> unsubscribe()
    'page'   the page the user is on: { url, kind, post, visible } (the same context the sidebar gets)
    'posts'  the posts on screen: [{ id, url, authorHandle, text }], re-read every 3 s — the
             re-read carries the whole post object: pictures, stats { replies, reposts, likes,
             bookmarks, views }, and liked / bookmarked, read from the post's own buttons, so a
             toggle draws from the page's state rather than from what you last did
    'message' what the agent sent with xpilot_view_message: a plain object whose meaning is yours,
             e.g. { type: 'focus', url }. Handle the shapes you defined and ignore the rest.
    'page' and 'posts' call back immediately with what is known now, then on every change;
    'message' only when something is sent.
  setState(state) -> Promise<{ success: true } | { success: false, error }>
    Tells the agent what your view is showing, so it can answer about the view instead of about the
    X page hidden underneath it:
      { summary?: string (${VIEW_STATE_SUMMARY_MAX}), focus?: { url?, authorHandle?, text? (${VIEW_STATE_FOCUS_TEXT_MAX}) } | null,
        items?: [{ url?, authorHandle?, text? (${VIEW_STATE_ITEM_TEXT_MAX}) }] (${VIEW_STATE_ITEMS_MAX}), extra?: { key: string | number | boolean } }
    Publish the focused item every time it changes — while your view is on screen that focus is what
    the user means by "this post" — and a summary once, when the view loads, saying what it shows and
    how it is driven. focus: null says nothing is focused. Unknown keys are refused, long strings are
    cut, and it replaces the whole state each time rather than merging. ${VIEW_STATE_BYTES_MAX / 1024} KB in all, ${VIEW_STATE_UPDATES_PER_WINDOW} updates a
    second (publish freely: past that the newest one wins rather than failing).
  call(tool, args) -> Promise<{ success: true, content } | { success: false, error }>
    reads:   x_get_page_state, x_read_visible_posts, x_read_current_post, x_read_post, x_search,
             x_read_timeline, x_read_news_and_trends, x_read_bookmarks, xpilot_search_history,
             xpilot_list_library
    drivers: x_scroll, x_show_new_posts, x_navigate — the X page underneath is the data source, so
             moving it is how a view loads more
    writes:  x_like_post { url, action: 'like' | 'unlike' }, x_bookmark_post { url, action:
             'bookmark' | 'unbookmark' } — each answers { liked | bookmarked, changed, and the
             likes | bookmarks count the page shows after the click }, so update your own count
             from the answer rather than waiting for the next re-read — x_compose_post,
             x_submit_post. These follow the user's likes, bookmarks and posting settings exactly
             as when you call them yourself
    Every other tool is refused, including all xpilot_* configuration, task and view tools.
    At most ${VIEW_CALLS_PER_WINDOW} calls per ${VIEW_CALL_WINDOW_MS / 1000} s: subscribe to a feed rather than polling one.
  openInX(url) -> the same as call('x_navigate', { url })
  back() -> closes the view and puts the user back on X

A post object carries its pictures as well as its words. media[] entries are
{ kind: 'image' | 'video' | 'gif', alt?, url?, preview? } — url is the picture itself or a video's own
file, preview a video's poster frame; cards[] entries carry image?; and the post carries authorAvatar.
Every one of those is an https URL on a twimg.com host, which is exactly what this page's policy lets
you put in an <img> or a <video>, so draw them as they are and never rewrite one. All four are
optional — a video that plays from a blob has only a preview, an older post may have nothing — so
check before you build the element rather than after.

What the page may load: its own files, inline <style> (inline <script> is refused, so put JavaScript
in a .js file and load it with <script type="module" src="app.js">), pictures from https://*.twimg.com
and data:/blob:, video from https://*.twimg.com and https://video.twimg.com, and modules from the
library shelf: xpilot://lib/three.module.js (three.js as an ES module) and xpilot://lib/OrbitControls.js.

Files: ${VIEW_FILE_EXTENSIONS.join(', ')}; ${MAX_VIEW_FILE_BYTES / 1024} KB per file, ${MAX_VIEW_BYTES / (1024 * 1024)} MB per view. Writing a file reloads the view on screen.
console.log and errors are kept per view — read them with xpilot_view_console — and xpilot_view_inspect
shows the DOM the view actually rendered.

Errors. Nothing across the bridge throws: call(), openInX() and back() never reject, and a refusal, a
budget, a failed tool and a bridge that has gone away all arrive as { success: false, error }. So check
the result rather than wrapping the call in try/catch, and put what went wrong on the page — a view has
no console the user can open. What your own scripts throw is caught anyway: uncaught errors, unhandled
rejections and content-policy refusals are kept with the console log and raise a banner in the sidebar
offering the user to have you fix it, while the view stays on screen. More than ${VIEW_RUNTIME_ERRORS_PER_WINDOW} errors in a minute
takes the view off the screen instead, and so does a page that will not load, a renderer that dies, and
one that stops responding for ${VIEW_UNRESPONSIVE_MS / 1000} s: the user is put back on x.com and told which of those it was.`;

const MINIMAL_HTML = `<!doctype html>
<meta charset="utf-8" />
<title>Posts</title>
<style>
  body { margin: 0; font: 15px/1.5 system-ui, sans-serif; background: #0b0b0f; color: #e7e7ea; }
  header { display: flex; gap: 8px; padding: 12px 16px; border-bottom: 1px solid #23232b; }
  button { background: #1d9bf0; border: 0; border-radius: 999px; color: #fff; padding: 6px 14px; cursor: pointer; }
  ol { list-style: none; margin: 0; padding: 8px 16px; }
  li { padding: 12px 0; border-bottom: 1px solid #1a1a21; cursor: pointer; }
  li.focused { box-shadow: inset 3px 0 0 #1d9bf0; padding-left: 12px; }
  b { color: #8b98a5; font-weight: 600; }
  .who { display: flex; align-items: center; gap: 8px; }
  .avatar { width: 32px; height: 32px; border-radius: 50%; }
  .photo { display: block; max-width: 100%; margin-top: 8px; border-radius: 12px; }
  #error { margin: 0; padding: 8px 16px; color: #ffb4a9; background: #2a1414; font-size: 13px; }
  #error:empty { display: none; }
</style>
<header>
  <button id="more">Load more</button>
  <button id="back">Back to X</button>
</header>
<p id="error"></p>
<ol id="posts"></ol>
<script type="module" src="app.js"></script>
`;

const MINIMAL_JS = `const list = document.getElementById('posts');
const problem = document.getElementById('error');
let posts = [];
let focusedUrl = null;

/** A view has no console the user can open, so anything that goes wrong is a line on the page. */
function show(text) {
  problem.textContent = text;
}

/**
 * Every bridge call answers with a result — it never throws — so a failure is something to draw
 * rather than something to catch. The user sees why the button did nothing.
 */
async function call(tool, args) {
  const result = await window.xpilotView.call(tool, args);
  show(result.success ? '' : tool + ': ' + result.error);
  return result;
}

/** An <img> for a twimg URL, or nothing: every picture on a post is optional. */
function picture(url, alt, className) {
  if (!url) return null;
  const img = document.createElement('img');
  img.src = url;
  img.alt = alt || '';
  img.loading = 'lazy';
  img.className = className;
  return img;
}

/**
 * What the agent knows about this view. The focused post is the point: while the view is on screen
 * it is what the user means by "this post", so it is published every time it moves, with a summary
 * saying what the view is and how it is driven.
 */
function publish() {
  const focused = posts.find((p) => p.url === focusedUrl) || null;
  const item = (p) => ({ url: p.url, authorHandle: p.authorHandle, text: p.text });
  window.xpilotView.setState({
    summary: posts.length + ' posts from the timeline underneath, newest first. Hover one to focus it; clicking one opens it in X.',
    focus: focused ? item(focused) : null,
    items: posts.slice(0, 20).map(item),
  });
}

/** Moves the highlight, whether the user hovered a row or the agent asked for a post by URL. */
function focus(url) {
  focusedUrl = url;
  for (const li of list.children) {
    const isIt = li.dataset.url === url;
    li.classList.toggle('focused', isIt);
    if (isIt) li.scrollIntoView({ block: 'nearest' });
  }
  publish();
}

function render(post) {
  const li = document.createElement('li');
  li.dataset.url = post.url;
  li.onmouseenter = () => focus(post.url);
  const head = document.createElement('div');
  head.className = 'who';
  const who = document.createElement('b');
  who.textContent = '@' + post.authorHandle;
  head.append(...[picture(post.authorAvatar, '', 'avatar'), who].filter(Boolean));
  const text = document.createElement('div');
  text.textContent = post.text;
  li.append(head, text);
  // A video that plays from a blob has only its poster frame, so either URL is worth showing.
  const media = (post.media || []).find((m) => m.url || m.preview);
  const photo = media && picture(media.url || media.preview, media.alt || post.text, 'photo');
  if (photo) li.append(photo);
  li.onclick = () => call('x_navigate', { url: post.url });
  return li;
}

/** The posts are re-read every 3 s, and rebuilding rows under a still pointer would fire mouseenter
 * and move the focus by itself, so the same posts are left on screen as they are. */
const key = (some) => some.map((p) => p.url).join(' ');
let drawn = null;

window.xpilotView.subscribe('posts', (visible) => {
  try {
    posts = visible;
    if (key(visible) !== drawn) {
      drawn = key(visible);
      list.replaceChildren(...posts.map(render));
    }
    show('');
    // The post that was focused may have scrolled away; the top one is the sensible fallback.
    focus(posts.some((p) => p.url === focusedUrl) ? focusedUrl : (posts[0] && posts[0].url) || null);
  } catch (err) {
    // A post that is not shaped the way this expects should cost one render, not the whole view.
    show('could not draw the posts: ' + (err && err.message ? err.message : err));
  }
});

// What the agent can ask this view to do. Anything else is ignored: these shapes are our own.
window.xpilotView.subscribe('message', (message) => {
  if (message && message.type === 'focus' && message.url) focus(message.url);
});

document.getElementById('more').onclick = () => call('x_scroll', { direction: 'down' });
document.getElementById('back').onclick = () => window.xpilotView.back();

// Said once, before any post has arrived, so the agent knows what is on screen from the first turn.
publish();
`;

const THREE_HTML = `<!doctype html>
<meta charset="utf-8" />
<title>Posts in space</title>
<style>
  body { margin: 0; overflow: hidden; background: #05050a; color: #e7e7ea; font: 15px/1.5 system-ui, sans-serif; }
  canvas { display: block; }
  button { position: fixed; top: 12px; right: 12px; background: #1d9bf0; border: 0; border-radius: 999px; color: #fff; padding: 6px 14px; cursor: pointer; }
  #flat { margin: 0; padding: 56px 16px 16px; list-style: none; overflow: auto; height: 100vh; box-sizing: border-box; }
  #flat li { padding: 12px 0; border-bottom: 1px solid #1a1a21; }
  #flat li.focused { box-shadow: inset 3px 0 0 #1d9bf0; padding-left: 12px; }
  #flat img.avatar { width: 28px; height: 28px; border-radius: 50%; vertical-align: middle; margin-right: 8px; }
  #flat img.photo { display: block; max-width: 100%; margin-top: 8px; border-radius: 12px; }
  #error { position: fixed; left: 0; right: 0; top: 0; margin: 0; padding: 8px 16px; background: #2a1414; color: #ffb4a9; font-size: 13px; }
  #error:empty { display: none; }
</style>
<button id="back">Back to X</button>
<p id="error"></p>
<ul id="flat" hidden></ul>
<script type="module" src="app.js"></script>
`;

const THREE_JS = `import * as THREE from 'xpilot://lib/three.module.js';
import { OrbitControls } from 'xpilot://lib/OrbitControls.js';

const problem = document.getElementById('error');
const flat = document.getElementById('flat');
const show = (text) => {
  problem.textContent = text;
};

document.getElementById('back').onclick = () => window.xpilotView.back();

let posts = [];
let focusedUrl = null;
/** Set by whichever renderer is in use below: the ring lifts a card, the list marks a row. */
let highlight = () => {};

/**
 * What the agent knows about this view. The focused post is the point: while the view is on screen
 * it is what the user means by "this post", so it is published every time it moves, with a summary
 * saying what the view is.
 */
function publish() {
  const focused = posts.find((p) => p.url === focusedUrl) || null;
  const item = (p) => ({ url: p.url, authorHandle: p.authorHandle, text: p.text });
  window.xpilotView.setState({
    summary: posts.length + ' posts from the timeline underneath, drawn on a ring you can orbit. The highlighted card is the focused post.',
    focus: focused ? item(focused) : null,
    items: posts.slice(0, 20).map(item),
  });
}

function focus(url) {
  focusedUrl = url;
  highlight(url);
  publish();
}

/** Whatever drew the posts, the focus follows them: the one that was focused, or the first. */
function drew(visible) {
  posts = visible;
  focus(posts.some((p) => p.url === focusedUrl) ? focusedUrl : (posts[0] && posts[0].url) || null);
}

// What the agent can ask this view to do. Anything else is ignored: these shapes are our own.
window.xpilotView.subscribe('message', (message) => {
  if (message && message.type === 'focus' && message.url) focus(message.url);
});

/**
 * WebGL is not always there — a machine with no GPU process, a driver Chromium has blocklisted — and
 * a black window with nothing in it is the worst way to say so. The posts are the point; the ring is
 * how they are drawn when the machine can draw it, and a plain list is how they are drawn when it
 * cannot.
 */
let renderer = null;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true });
} catch (err) {
  show('WebGL is not available here (' + (err && err.message ? err.message : err) + '); showing the posts as a list.');
}

/**
 * A post's pictures are plain <img> elements here rather than textures on the ring: a WebGL texture
 * from another origin needs CORS the X CDN does not promise, while an <img> only needs the content
 * policy, which already allows twimg.
 */
const picture = (url, alt, className) => {
  if (!url) return null;
  const img = document.createElement('img');
  img.src = url;
  img.alt = alt || '';
  img.loading = 'lazy';
  img.className = className;
  return img;
};

if (!renderer) {
  flat.hidden = false;
  highlight = (url) => {
    for (const li of flat.children) li.classList.toggle('focused', li.dataset.url === url);
  };
  // Rebuilding rows under a still pointer would fire mouseenter and move the focus by itself, so
  // the same posts are left on screen as they are.
  let drawn = null;
  window.xpilotView.subscribe('posts', (visible) => {
    const key = visible.map((p) => p.url).join(' ');
    if (key === drawn) return drew(visible);
    drawn = key;
    flat.replaceChildren(
      ...visible.map((post) => {
        const li = document.createElement('li');
        li.dataset.url = post.url;
        li.onmouseenter = () => focus(post.url);
        const text = document.createElement('span');
        text.textContent = '@' + post.authorHandle + ' — ' + post.text;
        const media = (post.media || []).find((m) => m.url || m.preview);
        const parts = [
          picture(post.authorAvatar, '', 'avatar'),
          text,
          media && picture(media.url || media.preview, media.alt || post.text, 'photo'),
        ];
        li.append(...parts.filter(Boolean));
        return li;
      }),
    );
    drew(visible);
  });
} else {
  renderer.setSize(innerWidth, innerHeight);
  document.body.append(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 100);
  camera.position.set(0, 0, 12);
  const controls = new OrbitControls(camera, renderer.domElement);
  scene.add(new THREE.AmbientLight(0xffffff, 1.2));

  /** One card per post, laid out on a ring; the label is the post text drawn into a canvas texture. */
  const card = (post, index, total) => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#15151d';
    ctx.fillRect(0, 0, 512, 256);
    ctx.fillStyle = '#8b98a5';
    ctx.font = '24px sans-serif';
    ctx.fillText('@' + post.authorHandle, 24, 48);
    ctx.fillStyle = '#e7e7ea';
    ctx.font = '22px sans-serif';
    const lines = (post.text || '').slice(0, 160).match(/.{1,34}/g) || [];
    lines.slice(0, 6).forEach((line, i) => ctx.fillText(line, 24, 96 + i * 28));
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(4, 2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas) }));
    const angle = (index / Math.max(1, total)) * Math.PI * 2;
    mesh.position.set(Math.sin(angle) * 8, 0, Math.cos(angle) * 8);
    mesh.lookAt(0, 0, 0);
    return mesh;
  };

  let cards = [];
  // The focused card is the one standing out of the ring, which is also what the agent is told.
  highlight = (url) => {
    for (const c of cards) c.mesh.scale.setScalar(c.url === url ? 1.3 : 1);
  };
  window.xpilotView.subscribe('posts', (visible) => {
    try {
      for (const c of cards) scene.remove(c.mesh);
      cards = visible.slice(0, 12).map((post, i, all) => ({ url: post.url, mesh: card(post, i, all.length) }));
      for (const c of cards) scene.add(c.mesh);
      show('');
      drew(visible);
    } catch (err) {
      show('could not build the cards: ' + (err && err.message ? err.message : err));
    }
  });

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });
}

// Said once, before any post has arrived, so the agent knows what is on screen from the first turn.
publish();
`;

/**
 * Two views that already work, so the model starts from a running page rather than from the CSP
 * rules: the smallest possible list of the posts on screen, and the same posts drawn with three.js
 * off the library shelf.
 */
export const VIEW_STARTERS = {
  posts: { 'index.html': MINIMAL_HTML, 'app.js': MINIMAL_JS },
  'posts-in-three': { 'index.html': THREE_HTML, 'app.js': THREE_JS },
};
