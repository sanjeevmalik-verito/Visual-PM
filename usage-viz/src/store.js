import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { costOf } from './pricing.js';

export const LOG_ROOT =
  process.env.CLAUDE_LOG_ROOT || path.join(os.homedir(), '.claude', 'projects');

// One assistant reply is written to the log as several lines (one per content
// block), each repeating the identical `usage` object. Counting every line
// would multiply every number by 2-3x, so we key on message.id and keep the
// first one we see.
function toRecord(obj) {
  if (obj?.type !== 'assistant') return null;
  const m = obj.message;
  const u = m?.usage;
  if (!u || !m.id) return null;
  return {
    id: m.id,
    ts: Date.parse(obj.timestamp) || Date.now(),
    sessionId: obj.sessionId || 'unknown',
    model: m.model || obj.model || 'unknown',
    project: path.basename(obj.cwd || '') || 'unknown',
    branch: obj.gitBranch || '',
    sidechain: !!obj.isSidechain,
    in: u.input_tokens || 0,
    out: u.output_tokens || 0,
    cacheWrite: u.cache_creation_input_tokens || 0,
    cacheRead: u.cache_read_input_tokens || 0,
    thinking: u.output_tokens_details?.thinking_tokens || 0,
  };
}

export class UsageStore extends EventEmitter {
  constructor(root = LOG_ROOT) {
    super();
    this.root = root;
    this.records = [];
    this.seen = new Set(); // message ids
    this.offsets = new Map(); // file -> bytes consumed
    this.partials = new Map(); // file -> trailing incomplete line
    this.timer = null;
  }

  listFiles() {
    const out = [];
    let dirs;
    try {
      dirs = fs.readdirSync(this.root, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      const dir = path.join(this.root, d.name);
      for (const f of fs.readdirSync(dir)) {
        if (f.endsWith('.jsonl')) out.push(path.join(dir, f));
      }
    }
    return out;
  }

  // Read only the bytes appended since last time. Keeps the poll cheap even
  // when a session log has grown to tens of megabytes.
  readNew(file) {
    let size;
    try {
      size = fs.statSync(file).size;
    } catch {
      return [];
    }
    const from = this.offsets.get(file) ?? 0;
    if (size === from) return [];
    if (size < from) {
      // file was truncated or replaced - start over
      this.offsets.set(file, 0);
      this.partials.set(file, '');
      return this.readNew(file);
    }
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.allocUnsafe(size - from);
    fs.readSync(fd, buf, 0, buf.length, from);
    fs.closeSync(fd);
    this.offsets.set(file, size);

    const text = (this.partials.get(file) || '') + buf.toString('utf8');
    const lines = text.split('\n');
    this.partials.set(file, lines.pop() ?? ''); // last piece may be half-written

    const fresh = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      const rec = toRecord(obj);
      if (!rec || this.seen.has(rec.id)) continue;
      this.seen.add(rec.id);
      rec.cost = costOf(rec);
      this.records.push(rec);
      fresh.push(rec);
    }
    return fresh;
  }

  scanAll() {
    const fresh = [];
    for (const f of this.listFiles()) fresh.push(...this.readNew(f));
    this.records.sort((a, b) => a.ts - b.ts);
    return fresh;
  }

  // fs.watch on a deep tree is unreliable across platforms, and the logs are
  // append-only, so a cheap stat-based poll is both simpler and steadier.
  start(intervalMs = 1000) {
    this.scanAll();
    this.timer = setInterval(() => {
      const fresh = this.scanAll();
      if (fresh.length) this.emit('records', fresh);
    }, intervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }
}
