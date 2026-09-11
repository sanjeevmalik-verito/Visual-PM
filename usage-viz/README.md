# usage-viz — live Claude usage dashboard

A small local web page that shows your Claude Code usage as it happens.

**It does not call the Anthropic API.** It reads the log files Claude Code
already writes on your own machine. No API key, no account setup, no cost,
nothing leaves your laptop.

## Run it

```bash
cd usage-viz
npm start          # needs Node 18+; there are no dependencies to install
```

Open <http://localhost:3000>. Start a Claude Code session in another terminal
and new replies show up in about a second.

Options:

- `PORT=4000 npm start` — use a different port.
- `CLAUDE_LOG_ROOT=/some/path npm start` — point at a different log folder
  (default `~/.claude/projects`).

## What it shows

- Tokens and estimated cost in the chosen window, replies, active sessions.
- A stacked bar chart of tokens over time, split into output, fresh input,
  cache write and cache read. Hover any bar for the exact numbers.
- Estimated cost by project and by model.
- A table of recent replies, with a full-table toggle.

Filter by project and time window at the top right. The theme button switches
light/dark; with no choice made the page follows your system setting.

## Two things to be clear about

**The dollar figures are an estimate.** They apply the published Anthropic API
list prices (`src/pricing.js`) to your local token counts. On a Pro or Max
subscription you are not billed per token, so read this as "what this work
would have cost on the API", not as your bill.

**Your subscription quota is not in the log files.** The 5-hour window and
weekly limit percentages are not written to disk. Run `/usage` inside Claude
Code to see those.

## How it works

`src/store.js` lists every `*.jsonl` under the log root and, on a one-second
poll, reads only the bytes appended since last time. Lines of type `assistant`
that carry `message.usage` become records.

One model reply is written to the log as **several lines** — one per content
block — and each of them repeats the identical `usage` object. The store keys
on `message.id` and keeps the first, so nothing is counted two or three times.

`src/server.js` serves the page, `GET /api/history` for the backfill, and
`GET /api/stream` (Server-Sent Events) for live updates. `public/app.js` draws
the charts as plain SVG — no chart library, no CDN, works offline.
