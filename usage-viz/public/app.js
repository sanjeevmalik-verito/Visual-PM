const SERIES = [
  { key: 'out',        label: 'Output',      color: 'var(--series-1)' },
  { key: 'in',         label: 'Fresh input', color: 'var(--series-2)' },
  { key: 'cacheWrite', label: 'Cache write', color: 'var(--series-3)' },
  { key: 'cacheRead',  label: 'Cache read',  color: 'var(--series-4)' },
];

const state = {
  records: [],
  rangeMin: 1440,
  project: '',
  off: new Set(),      // hidden series keys
  fullTable: false,
};

const $ = (id) => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';

const fmtInt = new Intl.NumberFormat();
const compact = (n) =>
  n >= 1e9 ? (n / 1e9).toFixed(1) + 'B'
  : n >= 1e6 ? (n / 1e6).toFixed(n < 1e7 ? 1 : 0) + 'M'
  : n >= 1e3 ? (n / 1e3).toFixed(n < 1e4 ? 1 : 0) + 'k'
  : String(Math.round(n));
// round an axis maximum up to 1/2/5 x 10^n so the ticks read cleanly
function niceMax(v) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}
const money = (v) => (v < 0.01 && v > 0 ? '<$0.01' : '$' + v.toFixed(2));

function el(name, attrs = {}, parent) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
}

/* ---------- tooltip ---------- */
const tip = $('tip');
function showTip(evt, html) {
  tip.innerHTML = html;
  tip.hidden = false;
  const pad = 14;
  const r = tip.getBoundingClientRect();
  let x = evt.clientX + pad;
  let y = evt.clientY + pad;
  if (x + r.width > window.innerWidth - 8) x = evt.clientX - r.width - pad;
  if (y + r.height > window.innerHeight - 8) y = evt.clientY - r.height - pad;
  tip.style.left = x + 'px';
  tip.style.top = y + 'px';
}
const hideTip = () => { tip.hidden = true; };
function hoverable(node, html) {
  node.addEventListener('mousemove', (e) => showTip(e, html));
  node.addEventListener('mouseleave', hideTip);
}

/* ---------- data ---------- */
function filtered() {
  const cut = state.rangeMin ? Date.now() - state.rangeMin * 60000 : 0;
  return state.records.filter(
    (r) => r.ts >= cut && (!state.project || r.project === state.project)
  );
}
const activeSeries = () => SERIES.filter((s) => !state.off.has(s.key));
const totalOf = (r) => activeSeries().reduce((a, s) => a + r[s.key], 0);

// Bucket width follows the data, not just the dropdown: a 24h window holding
// ten minutes of work should still show ten minutes of detail, not one bar.
const BUCKETS = [
  60000, 2 * 60000, 5 * 60000, 10 * 60000, 15 * 60000, 30 * 60000,
  3600000, 2 * 3600000, 6 * 3600000, 12 * 3600000, 86400000,
];
function bucketMs(rows) {
  if (!rows.length) return 60000;
  const dataSpan = rows.at(-1).ts - rows[0].ts;
  const windowSpan = state.rangeMin ? state.rangeMin * 60000 : dataSpan;
  const span = Math.max(60000, Math.min(windowSpan, dataSpan * 1.3));
  const target = span / 30; // aim for roughly 30 bars
  return BUCKETS.find((b) => b >= target) ?? BUCKETS.at(-1);
}

/* ---------- tiles ---------- */
function renderTiles(rows) {
  const tokens = rows.reduce((a, r) => a + totalOf(r), 0);
  const cost = rows.reduce((a, r) => a + r.cost, 0);
  const live = new Set(
    rows.filter((r) => Date.now() - r.ts < 10 * 60000).map((r) => r.sessionId)
  ).size;
  const last = rows.at(-1);
  const ago = last ? Math.round((Date.now() - last.ts) / 1000) : null;

  const tiles = [
    { k: 'Tokens in window', v: compact(tokens), m: fmtInt.format(tokens) + ' exact' },
    { k: 'Estimated cost', v: money(cost), m: 'API list prices — not your bill' },
    { k: 'Model replies', v: fmtInt.format(rows.length), m: new Set(rows.map(r => r.sessionId)).size + ' sessions' },
    {
      k: 'Active now',
      v: String(live),
      m: ago == null ? 'no activity yet'
        : ago < 90 ? `last reply ${ago}s ago`
        : `last reply ${Math.round(ago / 60)} min ago`,
    },
  ];
  $('tiles').innerHTML = tiles
    .map((t) => `<div class="tile"><div class="k">${t.k}</div><div class="v">${t.v}</div><div class="m">${t.m}</div></div>`)
    .join('');
}

/* ---------- legend ---------- */
function renderLegend() {
  const box = $('legend');
  box.innerHTML = '';
  for (const s of SERIES) {
    const on = !state.off.has(s.key);
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-pressed', String(on));
    b.innerHTML = `<span class="sw" style="background:${s.color}"></span>${s.label}`;
    b.onclick = () => {
      if (on) state.off.add(s.key); else state.off.delete(s.key);
      render();
    };
    box.appendChild(b);
  }
}

/* ---------- stacked time chart ---------- */
function renderTime(rows) {
  const host = $('timechart');
  host.innerHTML = '';
  const W = host.clientWidth || 800, H = host.clientHeight || 240;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}` }, host);
  const pad = { t: 8, r: 8, b: 22, l: 46 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const series = activeSeries();

  if (!rows.length || !series.length) {
    el('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', fill: 'var(--text-muted)', 'font-size': 12 }, svg)
      .textContent = 'No activity in this window.';
    return;
  }

  const bw = bucketMs(rows);
  const end = Math.ceil(Date.now() / bw) * bw;
  const windowStart = state.rangeMin
    ? end - Math.ceil((state.rangeMin * 60000) / bw) * bw
    : Math.floor(rows[0].ts / bw) * bw;
  // A wide window with a short burst of work would otherwise be one bar
  // against a screenful of blank. Start at the first reply instead, but keep
  // at least a quarter of the window so the bar never fills the whole plot.
  const firstBucket = Math.floor(rows[0].ts / bw) * bw;
  const minSpan = Math.max(bw * 10, Math.round((end - firstBucket) * 1.2));
  const start = Math.max(windowStart, Math.min(firstBucket - bw, end - minSpan));
  const n = Math.max(1, Math.round((end - start) / bw));
  const buckets = Array.from({ length: n }, (_, i) => ({
    t: start + i * bw, out: 0, in: 0, cacheWrite: 0, cacheRead: 0, cost: 0, count: 0,
  }));
  for (const r of rows) {
    const i = Math.floor((r.ts - start) / bw);
    if (i < 0 || i >= n) continue;
    const b = buckets[i];
    for (const s of SERIES) b[s.key] += r[s.key];
    b.cost += r.cost;
    b.count++;
  }

  const peak = Math.max(1, ...buckets.map((b) => series.reduce((a, s) => a + b[s.key], 0)));
  const tickStep = niceMax(peak / 4);
  const max = tickStep * 4;
  const y = (v) => pad.t + ih - (v / max) * ih;
  const slot = iw / n;
  // thin marks with a 2px surface gap between neighbouring bars
  const barW = Math.max(1.5, Math.min(26, slot - 2));

  // recessive gridlines + y labels
  for (let i = 0; i <= 4; i++) {
    const v = tickStep * i;
    const yy = y(v);
    el('line', { x1: pad.l, x2: W - pad.r, y1: yy, y2: yy, stroke: 'var(--grid)', 'stroke-width': 1 }, svg);
    el('text', { x: pad.l - 7, y: yy + 3, 'text-anchor': 'end', fill: 'var(--text-muted)', 'font-size': 10 }, svg)
      .textContent = compact(v);
  }

  const timeLabel = (t) =>
    bw >= 3600000
      ? new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric' })
      : new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  buckets.forEach((b, i) => {
    const total = series.reduce((a, s) => a + b[s.key], 0);
    const x = pad.l + i * slot + (slot - barW) / 2;
    if (total > 0) {
      let acc = 0;
      // draw bottom-up so the rounded top sits on the last segment only
      for (let k = series.length - 1; k >= 0; k--) {
        const s = series[k];
        const v = b[s.key];
        if (!v) continue;
        const h = (v / max) * ih;
        const yTop = y(acc + v);
        // 2px surface gap keeps stacked segments legible without outlines
        el('rect', {
          x, y: yTop, width: barW, height: Math.max(0.5, h - (acc > 0 ? 2 : 0)),
          fill: s.color, rx: k === 0 ? 3 : 0,
        }, svg);
        acc += v;
      }
    }
    // full-height invisible hit target, wider than the mark
    const hit = el('rect', { x: pad.l + i * slot, y: pad.t, width: slot, height: ih, fill: 'transparent' }, svg);
    const rowsHtml = series
      .map((s) => `<div class="r"><span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${s.color};margin-right:6px"></span>${s.label}</span><b>${fmtInt.format(b[s.key])}</b></div>`)
      .join('');
    hoverable(hit,
      `<b>${timeLabel(b.t)}</b><div class="r"><span>Total tokens</span><b>${fmtInt.format(total)}</b></div>${rowsHtml}` +
      `<div class="r"><span>Replies</span><b>${b.count}</b></div><div class="r"><span>Est. cost</span><b>${money(b.cost)}</b></div>`);
  });

  // x labels: about 6, never overlapping
  const step = Math.max(1, Math.ceil(n / 6));
  for (let i = 0; i < n; i += step) {
    el('text', { x: pad.l + i * slot + slot / 2, y: H - 6, 'text-anchor': 'middle', fill: 'var(--text-muted)', 'font-size': 10 }, svg)
      .textContent = timeLabel(buckets[i].t);
  }
}

/* ---------- horizontal cost bars (single series: no legend) ---------- */
function renderBars(hostId, rows, keyFn) {
  const host = $(hostId);
  host.innerHTML = '';
  host.style.height = '';
  const W = host.clientWidth || 400;
  const agg = new Map();
  for (const r of rows) {
    const k = keyFn(r) || 'unknown';
    const a = agg.get(k) || { cost: 0, tokens: 0, count: 0 };
    a.cost += r.cost; a.tokens += totalOf(r); a.count++;
    agg.set(k, a);
  }
  let items = [...agg].sort((a, b) => b[1].cost - a[1].cost);
  if (items.length > 6) {
    const rest = items.slice(5).reduce((a, [, v]) => ({
      cost: a.cost + v.cost, tokens: a.tokens + v.tokens, count: a.count + v.count,
    }), { cost: 0, tokens: 0, count: 0 });
    items = [...items.slice(0, 5), ['Other', rest]];
  }
  const rowH = 30;
  const H = Math.max(60, items.length * rowH);
  host.style.height = H + 'px';
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}` }, host);
  if (!items.length) {
    el('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', fill: 'var(--text-muted)', 'font-size': 12 }, svg)
      .textContent = 'Nothing in this window.';
    return;
  }

  const labelW = 118, valW = 58;
  const trackX = labelW, trackW = Math.max(20, W - labelW - valW);
  const barH = 13;
  const max = Math.max(...items.map(([, v]) => v.cost)) || 1;

  items.forEach(([name, v], i) => {
    const cy = i * rowH + rowH / 2;
    const short = name.length > 18 ? name.slice(0, 17) + '…' : name;
    el('text', { x: labelW - 9, y: cy + 4, 'text-anchor': 'end', fill: 'var(--text-secondary)', 'font-size': 11 }, svg)
      .textContent = short;
    const w = Math.max(2, (v.cost / max) * trackW);
    // 4px rounded data-end, anchored flat to the baseline at x = trackX
    el('rect', { x: trackX, y: cy - barH / 2, width: w, height: barH, rx: 4, fill: 'var(--series-1)' }, svg);
    // direct label — required relief for low-contrast marks, and faster to read
    el('text', { x: trackX + w + 7, y: cy + 4, fill: 'var(--text-primary)', 'font-size': 11 }, svg)
      .textContent = money(v.cost);
    const hit = el('rect', { x: 0, y: i * rowH, width: W, height: rowH, fill: 'transparent' }, svg);
    hoverable(hit,
      `<b>${name}</b><div class="r"><span>Est. cost</span><b>${money(v.cost)}</b></div>` +
      `<div class="r"><span>Tokens</span><b>${fmtInt.format(v.tokens)}</b></div>` +
      `<div class="r"><span>Replies</span><b>${v.count}</b></div>`);
  });
}

/* ---------- table (also the accessible view of the charts) ---------- */
function renderTable(rows) {
  const list = state.fullTable ? [...rows].reverse() : [...rows].reverse().slice(0, 20);
  const head = `<thead><tr><th>Time</th><th>Project</th><th>Branch</th><th>Model</th>
    <th class="n">Output</th><th class="n">Thinking</th><th class="n">Fresh in</th>
    <th class="n">Cache write</th><th class="n">Cache read</th><th class="n">Est. cost</th></tr></thead>`;
  const body = list.map((r) => `<tr>
      <td>${new Date(r.ts).toLocaleTimeString()}</td>
      <td>${r.project}${r.sidechain ? ' <span style="color:var(--text-muted)">(subagent)</span>' : ''}</td>
      <td>${r.branch || '—'}</td><td>${r.model}</td>
      <td class="n">${fmtInt.format(r.out)}</td><td class="n">${fmtInt.format(r.thinking)}</td>
      <td class="n">${fmtInt.format(r.in)}</td><td class="n">${fmtInt.format(r.cacheWrite)}</td>
      <td class="n">${fmtInt.format(r.cacheRead)}</td><td class="n">${money(r.cost)}</td>
    </tr>`).join('');
  $('recent').innerHTML = head + `<tbody>${body || '<tr><td colspan="10">Nothing yet.</td></tr>'}</tbody>`;
}

function renderProjects() {
  const sel = $('project');
  const names = [...new Set(state.records.map((r) => r.project))].sort();
  if (sel.options.length - 1 === names.length) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">all</option>' + names.map((n) => `<option>${n}</option>`).join('');
  sel.value = cur;
}

function render() {
  const rows = filtered();
  renderProjects();
  renderLegend();
  renderTiles(rows);
  renderTime(rows);
  renderBars('byproject', rows, (r) => r.project);
  renderBars('bymodel', rows, (r) => r.model);
  renderTable(rows);
}

/* ---------- wiring ---------- */
$('range').onchange = (e) => { state.rangeMin = Number(e.target.value); render(); };
$('project').onchange = (e) => { state.project = e.target.value; render(); };
$('theme').onclick = () => {
  const dark = document.documentElement.dataset.theme === 'dark';
  document.documentElement.dataset.theme = dark ? 'light' : 'dark';
  render();
};
$('toggletable').onclick = (e) => {
  state.fullTable = !state.fullTable;
  e.target.textContent = state.fullTable ? 'Show recent only' : 'Show full data table';
  renderTable(filtered());
};
addEventListener('resize', () => render());

async function boot() {
  const res = await fetch('/api/history');
  const data = await res.json();
  state.records = data.records;
  $('source').textContent = `watching ${data.logRoot}`;
  render();

  const es = new EventSource('/api/stream');
  es.onopen = () => $('dot').classList.add('live');
  es.onerror = () => $('dot').classList.remove('live');
  es.onmessage = (ev) => {
    state.records.push(...JSON.parse(ev.data));
    state.records.sort((a, b) => a.ts - b.ts);
    render();
  };
  // keeps "active now" and the trailing time buckets honest while idle
  setInterval(render, 15000);
}
boot();
