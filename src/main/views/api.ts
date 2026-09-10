import { MAX_VIEW_BYTES, MAX_VIEW_FILE_BYTES, VIEW_CALLS_PER_WINDOW, VIEW_CALL_WINDOW_MS, VIEW_FILE_EXTENSIONS } from '../../shared/views';

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
    'posts'  the posts on screen: [{ id, url, authorHandle, text }], re-read every 3 s
    Both call back immediately with what is known now, then on every change.
  call(tool, args) -> Promise<{ success: true, content } | { success: false, error }>
    reads:   x_get_page_state, x_read_visible_posts, x_read_current_post, x_read_post, x_search,
             x_read_timeline, x_read_news_and_trends, x_read_bookmarks, xpilot_search_history,
             xpilot_list_library
    drivers: x_scroll, x_show_new_posts, x_navigate — the X page underneath is the data source, so
             moving it is how a view loads more
    writes:  x_like_post, x_bookmark_post, x_compose_post, x_submit_post — these keep their
             confirmation cards in the sidebar exactly as when you call them yourself
    Every other tool is refused, including all xpilot_* configuration, task and view tools.
    At most ${VIEW_CALLS_PER_WINDOW} calls per ${VIEW_CALL_WINDOW_MS / 1000} s: subscribe to a feed rather than polling one.
  openInX(url) -> the same as call('x_navigate', { url })
  back() -> closes the view and puts the user back on X

What the page may load: its own files, inline <style> (inline <script> is refused, so put JavaScript
in a .js file and load it with <script type="module" src="app.js">), pictures from https://*.twimg.com
and data:/blob:, video from https://*.twimg.com and https://video.twimg.com, and modules from the
library shelf: xpilot://lib/three.module.js (three.js as an ES module) and xpilot://lib/OrbitControls.js.

Files: ${VIEW_FILE_EXTENSIONS.join(', ')}; ${MAX_VIEW_FILE_BYTES / 1024} KB per file, ${MAX_VIEW_BYTES / (1024 * 1024)} MB per view. Writing a file reloads the view on screen.
console.log and errors are kept per view — read them with xpilot_view_console — and xpilot_view_inspect
shows the DOM the view actually rendered.`;

const MINIMAL_HTML = `<!doctype html>
<meta charset="utf-8" />
<title>Posts</title>
<style>
  body { margin: 0; font: 15px/1.5 system-ui, sans-serif; background: #0b0b0f; color: #e7e7ea; }
  header { display: flex; gap: 8px; padding: 12px 16px; border-bottom: 1px solid #23232b; }
  button { background: #1d9bf0; border: 0; border-radius: 999px; color: #fff; padding: 6px 14px; cursor: pointer; }
  ol { list-style: none; margin: 0; padding: 8px 16px; }
  li { padding: 12px 0; border-bottom: 1px solid #1a1a21; cursor: pointer; }
  b { color: #8b98a5; font-weight: 600; }
</style>
<header>
  <button id="more">Load more</button>
  <button id="back">Back to X</button>
</header>
<ol id="posts"></ol>
<script type="module" src="app.js"></script>
`;

const MINIMAL_JS = `const list = document.getElementById('posts');

window.xpilotView.subscribe('posts', (posts) => {
  list.replaceChildren(
    ...posts.map((post) => {
      const li = document.createElement('li');
      const who = document.createElement('b');
      who.textContent = '@' + post.authorHandle;
      const text = document.createElement('div');
      text.textContent = post.text;
      li.append(who, text);
      li.onclick = () => window.xpilotView.openInX(post.url);
      return li;
    }),
  );
});

document.getElementById('more').onclick = () => window.xpilotView.call('x_scroll', { direction: 'down' });
document.getElementById('back').onclick = () => window.xpilotView.back();
`;

const THREE_HTML = `<!doctype html>
<meta charset="utf-8" />
<title>Posts in space</title>
<style>
  body { margin: 0; overflow: hidden; background: #05050a; }
  canvas { display: block; }
  button { position: fixed; top: 12px; right: 12px; background: #1d9bf0; border: 0; border-radius: 999px; color: #fff; padding: 6px 14px; cursor: pointer; }
</style>
<button id="back">Back to X</button>
<script type="module" src="app.js"></script>
`;

const THREE_JS = `import * as THREE from 'xpilot://lib/three.module.js';
import { OrbitControls } from 'xpilot://lib/OrbitControls.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
document.body.append(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 0, 12);
const controls = new OrbitControls(camera, renderer.domElement);
scene.add(new THREE.AmbientLight(0xffffff, 1.2));

/** One card per post, laid out on a ring; the label is the post text drawn into a canvas texture. */
function card(post, index, total) {
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
  post.text.slice(0, 160).match(/.{1,34}/g).slice(0, 6).forEach((line, i) => ctx.fillText(line, 24, 96 + i * 28));
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(4, 2),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas) }),
  );
  const angle = (index / Math.max(1, total)) * Math.PI * 2;
  mesh.position.set(Math.sin(angle) * 8, 0, Math.cos(angle) * 8);
  mesh.lookAt(0, 0, 0);
  return mesh;
}

let cards = [];
window.xpilotView.subscribe('posts', (posts) => {
  for (const mesh of cards) scene.remove(mesh);
  cards = posts.slice(0, 12).map((post, i, all) => card(post, i, all.length));
  for (const mesh of cards) scene.add(mesh);
});

document.getElementById('back').onclick = () => window.xpilotView.back();
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
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
