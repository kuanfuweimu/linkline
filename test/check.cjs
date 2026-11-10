// Offline checks against a mock of the documented Plugin API. Not a Figma runtime test.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict'), path = require('node:path');
const code = fs.readFileSync(path.join(__dirname, '..', 'code.js'), 'utf8');
let count = 0;
async function test(name, fn) { await fn(); count++; console.log('PASS ' + name); }
const tick = () => new Promise(r => setTimeout(r, 40));

function host() {
  const nodes = [], notes = [], handlers = {}; let serial = 0, closed = null;
  function node(type, props = {}) {
    const n = { type, id: String(++serial), name: type, x: 0, y: 0, width: 100, height: 100, removed: false, children: [], data: {}, ...props,
      get absoluteTransform() { const o = this.parent && this.parent.type !== 'PAGE' ? this.parent.absoluteTransform : [[1, 0, 0], [0, 1, 0]]; return [[1, 0, o[0][2] + this.x], [0, 1, o[1][2] + this.y]]; },
      get absoluteBoundingBox() { const t = this.absoluteTransform; return { x: t[0][2], y: t[1][2], width: this.width, height: this.height }; },
      appendChild(c) { if (c.parent) c.parent.children = c.parent.children.filter(k => k !== c); this.children.push(c); c.parent = this; },
      setPluginData(k, v) { this.data[k] = v; }, getPluginData(k) { return this.data[k] || ''; },
      remove() { this.removed = true; this.parent.children = this.parent.children.filter(k => k !== this); } };
    nodes.push(n); return n;
  }
  const page = node('PAGE'); page.selection = []; page.events = {};
  page.on = (t, f) => page.events[t] = f; page.off = t => delete page.events[t];
  page.findAllWithCriteria = ({ types, pluginData }) => nodes.filter(n => !n.removed && types.includes(n.type) && pluginData.keys.every(k => n.data[k]));
  const make = (type, props) => { const n = node(type, props); page.appendChild(n); return n; };
  const figma = {
    currentPage: page,
    createVector() { const v = make('VECTOR'); v.setVectorNetworkAsync = async net => { v.network = net; }; return v; },
    getNodeByIdAsync: async id => nodes.find(n => n.id === id && !n.removed) || null,
    notify: (text, o) => notes.push({ text, o }), closePlugin: t => { closed = t; }, commitUndo() {},
    on: (t, f) => handlers[t] = f
  };
  const run = () => { vm.runInContext(code, vm.createContext({ figma, console, setTimeout: (f, ms) => { const t = setTimeout(f, ms); t.unref(); return t; }, clearTimeout, JSON, Math, Map, Infinity, String })); return tick(); };
  const moved = n => { page.events.nodechange && page.events.nodechange({ nodeChanges: [{ type: 'PROPERTY_CHANGE', node: n }] }); return tick(); };
  return { figma, page, nodes, notes, make, run, moved, get closed() { return closed; } };
}
const ends = v => { const [a, b] = v.network.vertices; return [{ x: v.x + a.x, y: v.y + a.y }, { x: v.x + b.x, y: v.y + b.y }]; };
const lines = s => s.nodes.filter(n => n.type === 'VECTOR' && !n.removed);

(async () => {
  await test('two selected elements get one arrow from edge to edge', async () => {
    const s = host(), a = s.make('RECTANGLE', { x: 0, y: 0 }), b = s.make('FRAME', { x: 300, y: 0 });
    s.page.selection = [a, b]; await s.run();
    const [v] = lines(s); assert.equal(lines(s).length, 1);
    const [p, q] = ends(v);
    assert.deepEqual(p, { x: 106, y: 50 }); assert.deepEqual(q, { x: 294, y: 50 });
    assert.equal(v.network.vertices[1].strokeCap, 'ARROW_LINES'); assert.equal(v.network.vertices[0].strokeCap, 'NONE');
    assert.deepEqual(JSON.parse(v.getPluginData('linkline')), { version: 1, from: a.id, to: b.id });
    assert.equal(s.closed, null, 'plugin keeps running to follow moves');
  });
  await test('moving an element redraws its connector while running', async () => {
    const s = host(), a = s.make('RECTANGLE'), b = s.make('RECTANGLE', { x: 300 });
    s.page.selection = [a, b]; await s.run();
    b.x = 0; b.y = 400; await s.moved(b);
    const [p, q] = ends(lines(s)[0]);
    assert.deepEqual(p, { x: 50, y: 106 }); assert.deepEqual(q, { x: 50, y: 394 });
  });
  await test('three selected elements chain in selection order', async () => {
    const s = host(), a = s.make('RECTANGLE'), b = s.make('RECTANGLE', { x: 300 }), c = s.make('RECTANGLE', { x: 600 });
    s.page.selection = [a, b, c]; await s.run();
    assert.deepEqual(lines(s).map(v => JSON.parse(v.getPluginData('linkline'))).map(d => [d.from, d.to]), [[a.id, b.id], [b.id, c.id]]);
  });
  await test('running again on the same pair does not duplicate', async () => {
    const s = host(), a = s.make('RECTANGLE'), b = s.make('RECTANGLE', { x: 300 });
    s.page.selection = [a, b]; await s.run(); s.page.selection = [b, a]; await s.run();
    assert.equal(lines(s).length, 1); assert(s.notes.some(n => /Already connected/.test(n.text)));
  });
  await test('a later run resumes following saved connectors', async () => {
    const s = host(), a = s.make('RECTANGLE'), b = s.make('RECTANGLE', { x: 300 });
    s.page.selection = [a, b]; await s.run();
    s.page.selection = []; delete s.page.events.nodechange; a.y = 500; await s.run();
    const p = ends(lines(s)[0])[0]; assert(p.y > 490 && p.y < 500, 'stale line is corrected on start');
  });
  await test('nested elements use absolute positions', async () => {
    const s = host(), f = s.make('FRAME', { x: 1000, y: 1000, width: 800, height: 800 }), a = s.make('RECTANGLE'), b = s.make('RECTANGLE', { x: 300 });
    f.appendChild(a); f.appendChild(b); s.page.selection = [a, b]; await s.run();
    assert.deepEqual(ends(lines(s)[0])[0], { x: 1106, y: 1050 });
  });
  await test('a connector moved into a frame still lands on the elements', async () => {
    const s = host(), f = s.make('FRAME', { x: 200, y: 200, width: 900, height: 900 }), a = s.make('RECTANGLE'), b = s.make('RECTANGLE', { x: 300 });
    s.page.selection = [a, b]; await s.run(); const v = lines(s)[0]; f.appendChild(v);
    b.x = 310; await s.moved(b);
    const abs = { x: 200 + v.x + v.network.vertices[1].x, y: 200 + v.y + v.network.vertices[1].y };
    assert.deepEqual(abs, { x: 304, y: 50 });
  });
  await test('deleting an endpoint keeps the line and stops following it', async () => {
    const s = host(), a = s.make('RECTANGLE'), b = s.make('RECTANGLE', { x: 300 });
    s.page.selection = [a, b]; await s.run(); b.remove(); await s.moved(a);
    assert.equal(lines(s).length, 1); a.x = 50; await s.moved(a);
  });
  await test('overlapping elements connect centre to centre without NaN', async () => {
    const s = host(), a = s.make('RECTANGLE'), b = s.make('RECTANGLE', { x: 20, y: 20 });
    s.page.selection = [a, b]; await s.run();
    assert(ends(lines(s)[0]).every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
  });
  await test('selecting one connector and running reverses its direction', async () => {
    const s = host(), a = s.make('RECTANGLE'), b = s.make('RECTANGLE', { x: 300 });
    s.page.selection = [a, b]; await s.run(); const v = lines(s)[0];
    s.page.selection = [v]; delete s.page.events.nodechange; await s.run();
    assert.equal(JSON.parse(v.getPluginData('linkline')).from, b.id);
    assert.deepEqual(ends(v)[0], { x: 294, y: 50 });
  });
  await test('own redraws do not trigger another redraw cycle', async () => {
    const s = host(), a = s.make('RECTANGLE'), b = s.make('RECTANGLE', { x: 300 });
    s.page.selection = [a, b]; await s.run(); const v = lines(s)[0]; let draws = 0;
    const orig = v.setVectorNetworkAsync; v.setVectorNetworkAsync = async n => { draws++; return orig(n); };
    await s.moved(v); assert.equal(draws, 0);
  });
  await test('manifest is Design-only with no network access', () => {
    const m = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
    assert.deepEqual(m.editorType, ['figma']); assert.deepEqual(m.networkAccess.allowedDomains, ['none']); assert(!code.includes('createConnector'));
  });
  console.log(count + ' checks passed. Mock Plugin API only; no screen automation.');
})().catch(e => { console.error(e); process.exitCode = 1; });
