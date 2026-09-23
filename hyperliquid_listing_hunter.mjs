#!/usr/bin/env node
/**
 * HYPERLIQUID LISTING HUNTER V0.3
 * READ-ONLY | NO ORDERS
 *
 * Detects newly observed markets, observes the first trade after detection,
 * then measures early price/volume behavior at T+5s / 15s / 30s / 60s.
 * This is an observation tool: "first observed" is NOT guaranteed to be the
 * historical first trade if the monitor was offline or discovered late.
 */

const REST = process.env.HYPERLIQUID_API_URL || 'https://api.hyperliquid.xyz/info';
const WS_URL = process.env.HYPERLIQUID_WS_URL || 'wss://api.hyperliquid.xyz/ws';
const POLL_MS = Math.max(5000, Number(process.env.HYPERLIQUID_LISTING_POLL_MS || 15000));
const STATE_FILE = process.env.HYPERLIQUID_LISTING_STATE || './state/hyperliquid_listing_state.json';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.HYPERLIQUID_TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || process.env.HYPERLIQUID_TELEGRAM_CHAT_ID || '';
const REPORT_EVERY_CYCLE = String(process.env.HYPERLIQUID_LISTING_REPORT_EVERY_CYCLE || 'false').toLowerCase() === 'true';
const MILESTONES = [5, 15, 30, 60];
const MAX_TRACKED_FRESH = 25;

import fs from 'node:fs/promises';
import path from 'node:path';

const now = () => Date.now();
const iso = (t = now()) => new Date(t).toISOString();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const num = (v, d = null) => Number.isFinite(Number(v)) ? Number(v) : d;
const pct = (v, d = null) => Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` : (d ?? 'n/a');
const fmt = (v, max = 6) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 'n/a';
  return Math.abs(n) >= 1000 ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : n.toPrecision(Math.min(max, 8));
};

async function loadState() {
  try {
    const s = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
    s.version = 'V0.3';
    s.markets ||= {};
    s.fresh ||= {};
    s.cycles ||= 0;
    return s;
  } catch {
    return { version: 'V0.3', markets: {}, fresh: {}, firstSeenAt: null, cycles: 0 };
  }
}

async function saveState(state) {
  await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

async function info(body) {
  let last;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(REST, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (res.status === 429 || res.status >= 500) {
        await sleep(Math.min(10000, 800 * 2 ** (attempt - 1)));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      return await res.json();
    } catch (e) {
      last = e;
      if (attempt < 4) await sleep(500 * attempt);
    }
  }
  throw last || new Error('INFO_REQUEST_FAILED');
}

function extractPerpMarkets(meta, dexName) {
  const out = new Map();
  for (const u of meta?.universe || []) {
    if (!u?.name) continue;
    const coin = dexName ? `${dexName}:${u.name}` : u.name;
    out.set(`PERP:${coin}`, {
      key: `PERP:${coin}`, type: 'PERP', venue: dexName ? 'HIP-3' : 'NATIVE', dex: dexName || '', coin,
      name: u.name, szDecimals: u.szDecimals ?? null, maxLeverage: u.maxLeverage ?? null,
      isDelisted: Boolean(u.isDelisted), onlyIsolated: Boolean(u.onlyIsolated)
    });
  }
  return out;
}

function extractSpotMarkets(meta) {
  const out = new Map();
  for (const u of meta?.universe || []) {
    if (!u?.name) continue;
    out.set(`SPOT:${u.name}`, { key: `SPOT:${u.name}`, type: 'SPOT', venue: 'NATIVE_SPOT', dex: '', coin: u.name, name: u.name, tokens: u.tokens || [] });
  }
  return out;
}

async function discover() {
  const [native, spot, dexes] = await Promise.all([
    info({ type: 'meta' }), info({ type: 'spotMeta' }), info({ type: 'perpDexs' })
  ]);
  const markets = new Map([...extractPerpMarkets(native, ''), ...extractSpotMarkets(spot)]);
  const hip3 = [];
  for (let i = 1; i < (dexes || []).length; i++) {
    const d = dexes[i];
    if (!d?.name) continue;
    try {
      const m = await info({ type: 'meta', dex: d.name });
      for (const [k, v] of extractPerpMarkets(m, d.name)) markets.set(k, v);
      hip3.push({ index: i, name: d.name, fullName: d.fullName || d.name, deployer: d.deployer || null });
    } catch (e) {
      hip3.push({ index: i, name: d.name, error: String(e?.message || e) });
    }
  }
  return { markets, hip3 };
}

class TradeWatcher {
  constructor() {
    this.ws = null;
    this.coins = new Set();
    this.pending = [];
    this.backoff = 1000;
    this.closed = false;
    this.rawCount = 0;
  }
  ensure() {
    if (this.closed || this.ws || !this.coins.size) return;
    try { this.ws = new WebSocket(WS_URL); }
    catch { this.ws = null; setTimeout(() => this.ensure(), this.backoff); return; }
    this.ws.onopen = () => {
      this.backoff = 1000;
      for (const coin of this.coins) this.subscribe(coin);
    };
    this.ws.onmessage = ev => this.onMessage(ev.data);
    this.ws.onerror = () => {};
    this.ws.onclose = () => {
      this.ws = null;
      if (!this.closed) {
        const w = this.backoff;
        this.backoff = Math.min(30000, this.backoff * 2);
        setTimeout(() => this.ensure(), w);
      }
    };
  }
  subscribe(coin) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'trades', coin } }));
  }
  add(coin) {
    if (!coin || this.coins.has(coin)) return;
    this.coins.add(coin);
    if (this.ws?.readyState === WebSocket.OPEN) this.subscribe(coin); else this.ensure();
  }
  onMessage(raw) {
    try {
      const m = JSON.parse(raw);
      if (m.channel !== 'trades') return;
      const rows = Array.isArray(m.data) ? m.data : [m.data];
      for (const t of rows) {
        const coin = t?.coin;
        if (!coin) continue;
        this.rawCount++;
        this.pending.push({
          coin,
          ts: num(t.time, now()),
          px: num(t.px),
          sz: num(t.sz),
          side: t.side ?? null,
          hash: t.hash ?? null,
          tid: t.tid ?? null
        });
      }
    } catch {}
  }
  drain() { const out = this.pending; this.pending = []; const raw = this.rawCount; this.rawCount = 0; return { out, raw }; }
  close() { this.closed = true; try { this.ws?.close(); } catch {} }
}

async function telegram(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error(`TELEGRAM_NOT_CONFIGURED token=${TELEGRAM_BOT_TOKEN ? 'present' : 'missing'} chat_id=${TELEGRAM_CHAT_ID ? 'present' : 'missing'}`);
    return false;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, disable_web_page_preview: true })
    });
    const body = await res.text();
    if (!res.ok) { console.error(`TELEGRAM_SEND_FAILED HTTP_${res.status} ${body.slice(0, 500)}`); return false; }
    let json = null; try { json = JSON.parse(body); } catch {}
    if (!json?.ok) { console.error(`TELEGRAM_SEND_FAILED ${body.slice(0, 500)}`); return false; }
    console.log('TELEGRAM_SEND_OK');
    return true;
  } catch (e) { console.error(`TELEGRAM_SEND_ERROR ${e?.message || e}`); return false; }
}

function formatNew(rows) {
  if (!rows.length) return '';
  const lines = ['🆕 NEW HYPERLIQUID MARKET', '━━━━━━━━━━━━━━━━━━'];
  for (const x of rows.slice(0, 10)) {
    lines.push(`🪙 ${x.coin}`);
    lines.push(`📍 ${x.type} | ${x.venue}${x.dex ? ` (${x.dex})` : ''}`);
    lines.push(`⏱ Detected: ${iso(x.firstSeenAt)}`);
    lines.push('⚡ First trade observation is now armed.');
    lines.push('');
  }
  return lines.join('\n').trim();
}

function formatFirstTrade(x) {
  return [
    '⚡ FIRST TRADE OBSERVED',
    '━━━━━━━━━━━━━━━━━━',
    `🪙 ${x.coin}`,
    `📍 ${x.venue}${x.dex ? ` (${x.dex})` : ''}`,
    `💵 Price: ${fmt(x.firstPx)}`,
    `📦 Size: ${fmt(x.firstSz)}`,
    `↔️ Side: ${x.firstSide ?? 'n/a'}`,
    `⏱ ${iso(x.firstTs)}`,
    '⚠️ First observed after detector subscription; not guaranteed historical first trade.'
  ].join('\n');
}

function formatMilestone(x, seconds) {
  const s = x.milestones[String(seconds)];
  if (!s) return '';
  return [
    `📊 EARLY MOVE — T+${seconds}s`,
    '━━━━━━━━━━━━━━━━━━',
    `🪙 ${x.coin}`,
    `💵 Entry/first px: ${fmt(x.firstPx)}`,
    `💵 Price @ +${seconds}s: ${fmt(s.px)}`,
    `📈 Move: ${pct(s.movePct)}`,
    `📦 Volume: ${fmt(s.volume)}`,
    `🔢 Trades: ${s.tradeCount}`,
    `🔥 Volume acceleration: ${s.volumePerSec > 0 ? `${fmt(s.volumePerSec)}/s` : 'n/a'}`
  ].join('\n');
}

function applyTrades(state, trades, freshKeys) {
  const alerts = { first: [], milestones: [] };
  const grouped = new Map();
  for (const t of trades) {
    const key = `PERP:${t.coin}`;
    if (!freshKeys.has(key)) continue;
    if (!state.fresh[key]) continue;
    if (!Number.isFinite(t.px) || !Number.isFinite(t.sz) || t.px <= 0) continue;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(t);
  }

  for (const [key, rows] of grouped) {
    const f = state.fresh[key];
    rows.sort((a, b) => a.ts - b.ts);
    if (!f.firstTs) {
      const t = rows[0];
      f.firstTs = t.ts;
      f.firstPx = t.px;
      f.firstSz = t.sz;
      f.firstSide = t.side;
      f.firstHash = t.hash;
      f.firstTid = t.tid;
      f.lastPx = t.px;
      f.lastTs = t.ts;
      f.totalVolume = t.sz;
      f.tradeCount = 1;
      f.milestones ||= {};
      const m = state.markets[key];
      alerts.first.push({ ...f, coin: m?.coin || t.coin, venue: m?.venue || 'NATIVE', dex: m?.dex || '' });
    }
    for (const t of rows) {
      if (t.ts < f.firstTs) continue;
      f.lastPx = t.px;
      f.lastTs = t.ts;
      f.totalVolume += t.sz;
      f.tradeCount++;
    }

    for (const seconds of MILESTONES) {
      const k = String(seconds);
      if (f.milestones[k]) continue;
      const due = f.firstTs + seconds * 1000;
      if (now() < due) continue;
      const px = f.lastPx;
      if (!Number.isFinite(px)) continue;
      const elapsed = Math.max(1, (f.lastTs || now()) - f.firstTs) / 1000;
      const movePct = ((px - f.firstPx) / f.firstPx) * 100;
      f.milestones[k] = {
        at: now(), px, movePct,
        volume: f.totalVolume,
        tradeCount: f.tradeCount,
        volumePerSec: f.totalVolume / elapsed
      };
      alerts.milestones.push({ ...f, coin: state.markets[key]?.coin || key, venue: state.markets[key]?.venue || 'NATIVE', dex: state.markets[key]?.dex || '', seconds });
    }
  }
  return alerts;
}

async function main() {
  const state = await loadState();
  const watcher = new TradeWatcher();
  process.on('SIGINT', () => watcher.close());
  process.on('SIGTERM', () => watcher.close());

  console.log(`🟢 HYPERLIQUID LISTING HUNTER V0.3 | READ-ONLY | poll=${POLL_MS}ms`);
  await telegram(`🟢 HYPERLIQUID LISTING HUNTER ONLINE\nREAD-ONLY | NO ORDERS\nPoll: ${POLL_MS}ms\nMode: NEW MARKET → FIRST TRADE → T+5/15/30/60s\nTime: ${iso()}`);

  while (true) {
    const cycleAt = now();
    try {
      const { markets, hip3 } = await discover();
      const newRows = [];
      const freshKeys = new Set();

      for (const [key, m] of markets) {
        const existing = state.markets[key];
        if (!existing) {
          state.markets[key] = { ...m, firstSeenAt: cycleAt, firstTradeObservedAt: null, lastSeenAt: cycleAt, observations: 1 };
          newRows.push(state.markets[key]);
          if (m.type === 'PERP' && !m.isDelisted && Object.keys(state.fresh).length < MAX_TRACKED_FRESH) {
            state.fresh[key] = {
              key, createdAt: cycleAt, firstTs: null, firstPx: null, firstSz: null, firstSide: null,
              lastPx: null, lastTs: null, totalVolume: 0, tradeCount: 0, milestones: {}
            };
          }
        } else {
          existing.lastSeenAt = cycleAt;
          existing.observations = (existing.observations || 0) + 1;
          existing.isDelisted = Boolean(m.isDelisted);
        }
        if (state.fresh[key]) freshKeys.add(key);
        if (m.type === 'PERP' && !m.isDelisted) watcher.add(m.coin);
      }

      const { out: trades, raw } = watcher.drain();
      const alerts = applyTrades(state, trades, freshKeys);

      for (const f of alerts.first) {
        const key = f.key;
        if (state.markets[key]) state.markets[key].firstTradeObservedAt = f.firstTs;
      }

      state.cycles = (state.cycles || 0) + 1;
      state.lastCycleAt = cycleAt;
      state.hip3 = hip3;
      state.lastRawTrades = raw;
      await saveState(state);

      if (newRows.length) {
        const msg = formatNew(newRows);
        console.log(msg);
        await telegram(msg);
      }
      for (const f of alerts.first) {
        const msg = formatFirstTrade(f);
        console.log(msg);
        await telegram(msg);
      }
      for (const m of alerts.milestones) {
        const msg = formatMilestone(m, m.seconds);
        console.log(msg);
        await telegram(msg);
        if (m.seconds === 60) {
          const key = m.key;
          if (state.markets[key]) {
            state.markets[key].earlyMove = { firstTs: m.firstTs, firstPx: m.firstPx, firstSz: m.firstSz, milestones: m.milestones };
            state.markets[key].earlyMoveCompletedAt = now();
          }
          delete state.fresh[key];
        }
      }
      await saveState(state);

      console.log(`cycle=${state.cycles} markets=${markets.size} hip3=${hip3.length} new=${newRows.length} trackedFresh=${freshKeys.size} firstTrades=${alerts.first.length} milestones=${alerts.milestones.length} rawTrades=${raw}`);
      if (REPORT_EVERY_CYCLE) {
        await telegram(`🟢 LISTING HUNTER STATUS\nCycle: ${state.cycles}\nMarkets: ${markets.size}\nHIP-3: ${hip3.length}\nTracked fresh: ${freshKeys.size}\nRaw trades: ${raw}\nTime: ${iso()}`);
      }
    } catch (e) {
      console.error(`LISTING_HUNTER_ERROR ${e?.stack || e}`);
    }
    await sleep(POLL_MS);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
