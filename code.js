// Linkline 0.1.0: FigJam-style connectors for Figma Design.
// 选中 2 个以上元素运行即按选择顺序连线；插件运行期间拖动元素，连线自动跟随。
// Select 2+ elements and run to connect them; lines follow while the plugin runs.
const KEY = 'linkline';
const GAP = 6;
const STROKE = { r: 0.17, g: 0.17, b: 0.17 };
const tracked = new Map(); // connector id -> { line, from, to, key }
let watchedPage;
let timer;
let updating = false;

function box(node) {
  if (!node || node.removed) return null;
  const b = node.absoluteBoundingBox;
  return b && b.width >= 0 && b.height >= 0 ? b : null;
}
function center(b) { return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }
function edgePoint(b, toward) {
  // 从中心沿方向与外框相交，再外移一个间距。Ray from centre to the box edge, plus a gap.
  const c = center(b), dx = toward.x - c.x, dy = toward.y - c.y;
  const len = Math.hypot(dx, dy);
  if (!len) return c;
  const hw = b.width / 2, hh = b.height / 2;
  const t = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
  return { x: c.x + dx * t + dx / len * GAP, y: c.y + dy * t + dy / len * GAP };
}
function overlaps(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}
function endpoints(a, b) {
  const ca = center(a), cb = center(b);
  if (overlaps(a, b)) return [ca, cb];
  return [edgePoint(a, cb), edgePoint(b, ca)];
}
function geometryKey(a, b) {
  return [a.x, a.y, a.width, a.height, b.x, b.y, b.width, b.height].join(',');
}
async function draw(line, a, b) {
  const [p, q] = endpoints(a, b);
  const x = Math.min(p.x, q.x), y = Math.min(p.y, q.y);
  // 线若被用户移入 Frame/Section，换算为父级局部坐标。Convert to the parent's local space.
  const parent = line.parent, origin = parent && parent.type !== 'PAGE' && parent.absoluteTransform
    ? { x: parent.absoluteTransform[0][2], y: parent.absoluteTransform[1][2] } : { x: 0, y: 0 };
  line.x = x - origin.x; line.y = y - origin.y;
  await line.setVectorNetworkAsync({
    vertices: [
      { x: p.x - x, y: p.y - y, strokeCap: 'NONE' },
      { x: q.x - x, y: q.y - y, strokeCap: 'ARROW_LINES' }
    ],
    segments: [{ start: 0, end: 1, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } }],
    regions: []
  });
}
function pairExists(fromId, toId) {
  for (const t of tracked.values()) {
    if (t.from.id === fromId && t.to.id === toId || t.from.id === toId && t.to.id === fromId) return true;
  }
  return false;
}
async function connect(from, to) {
  const a = box(from), b = box(to);
  if (!a || !b || pairExists(from.id, to.id)) return null;
  const line = figma.createVector();
  figma.currentPage.appendChild(line);
  line.name = 'Connector / ' + from.name.slice(0, 40) + ' → ' + to.name.slice(0, 40);
  line.strokes = [{ type: 'SOLID', color: STROKE }];
  line.strokeWeight = 2;
  line.strokeJoin = 'ROUND';
  line.fills = [];
  line.setPluginData(KEY, JSON.stringify({ version: 1, from: from.id, to: to.id }));
  await draw(line, a, b);
  tracked.set(line.id, { line, from, to, key: geometryKey(a, b) });
  return line;
}
async function track(line) {
  let data;
  try { data = JSON.parse(line.getPluginData(KEY)); } catch (_) { return; }
  if (!data || !data.from || !data.to) return;
  const from = await figma.getNodeByIdAsync(data.from), to = await figma.getNodeByIdAsync(data.to);
  // 端点已删除时保留线条但不再跟随。Keep orphaned lines, stop following them.
  if (!from || !to || from.removed || to.removed) return;
  tracked.set(line.id, { line, from, to, key: '' });
}
async function refresh() {
  if (updating) { schedule(); return; }
  updating = true;
  try {
    for (const [id, t] of tracked) {
      if (t.line.removed) { tracked.delete(id); continue; }
      const a = box(t.from), b = box(t.to);
      if (!a || !b) { tracked.delete(id); continue; }
      const key = geometryKey(a, b);
      if (key === t.key) continue;
      t.key = key;
      await draw(t.line, a, b);
    }
  } finally { updating = false; }
}
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => { refresh().catch(e => console.warn(e)); }, 16);
}
function onChange(event) {
  // 自己画线触发的变化跳过，避免死循环。Ignore changes to our own connectors.
  if (event.nodeChanges.every(c => c.node && tracked.has(c.node.id))) return;
  if (tracked.size) schedule();
}
async function watchPage() {
  if (watchedPage) watchedPage.off('nodechange', onChange);
  tracked.clear();
  watchedPage = figma.currentPage;
  const lines = watchedPage.findAllWithCriteria({ types: ['VECTOR'], pluginData: { keys: [KEY] } });
  for (const line of lines) await track(line);
  watchedPage.on('nodechange', onChange);
  await refresh();
}
async function reverse(line) {
  const data = JSON.parse(line.getPluginData(KEY));
  line.setPluginData(KEY, JSON.stringify({ version: 1, from: data.to, to: data.from }));
  tracked.delete(line.id);
  await track(line);
  await refresh();
}
async function start() {
  await watchPage();
  figma.on('currentpagechange', () => { watchPage().catch(e => console.warn(e)); });
  const selection = figma.currentPage.selection;
  const own = selection.filter(n => n.getPluginData(KEY));
  const targets = selection.filter(n => !n.getPluginData(KEY) && box(n));
  if (own.length === 1 && targets.length === 0) {
    await reverse(own[0]);
    figma.commitUndo();
    figma.notify('Linkline：已反转方向 / Direction reversed. 拖动元素连线会跟随 / Lines follow while running.');
    return;
  }
  let made = 0;
  for (let i = 0; i + 1 < targets.length; i++) if (await connect(targets[i], targets[i + 1])) made++;
  if (made) {
    figma.currentPage.selection = targets;
    figma.commitUndo();
  }
  const msg = made ? '已连线 ' + made + ' 条 / Connected ' + made
    : targets.length >= 2 ? '这些元素已连接 / Already connected'
    : '跟随中，选中 2 个元素再运行即可连线 / Following; select 2 elements and run to connect';
  figma.notify('Linkline：' + msg + ' · 共跟随 ' + tracked.size + ' 条 / following ' + tracked.size, { timeout: 5000 });
}
start().catch(error => figma.closePlugin('Linkline failed: ' + String(error && error.message || error).slice(0, 160)));
