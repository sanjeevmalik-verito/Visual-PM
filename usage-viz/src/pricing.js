// Published Anthropic API list prices, USD per million tokens.
// Used only to turn local token counts into a rough dollar figure.
// On a Pro/Max subscription you are NOT billed these amounts — this is an
// "equivalent API value" estimate, not your bill.
//
// Cache write = 1.25x input, cache read = 0.10x input (standard 5m TTL).

const BASE = {
  'claude-fable-5-1': { in: 10, out: 50 },
  'claude-fable-5': { in: 10, out: 50 },
  'claude-opus-5': { in: 5, out: 25 },
  'claude-opus-4-8': { in: 5, out: 25 },
  'claude-opus-4-7': { in: 5, out: 25 },
  'claude-opus-4-6': { in: 5, out: 25 },
  'claude-sonnet-5': { in: 2, out: 10 },
  'claude-sonnet-4-6': { in: 3, out: 15 },
  'claude-haiku-4-5': { in: 1, out: 5 },
};

const FALLBACK = { in: 5, out: 25 };

export function rates(model) {
  if (!model) return FALLBACK;
  let b = BASE[model];
  if (!b) {
    // tolerate date suffixes like claude-haiku-4-5-20251001
    const key = Object.keys(BASE).find((k) => model.startsWith(k));
    b = key ? BASE[key] : FALLBACK;
  }
  return b;
}

// r: a usage record. Returns estimated USD.
export function costOf(r) {
  const b = rates(r.model);
  const M = 1e6;
  return (
    (r.in * b.in) / M +
    (r.out * b.out) / M +
    (r.cacheWrite * b.in * 1.25) / M +
    (r.cacheRead * b.in * 0.1) / M
  );
}
