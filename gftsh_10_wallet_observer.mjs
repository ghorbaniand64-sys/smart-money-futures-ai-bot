import fs from 'node:fs/promises';
import path from 'node:path';

const VERSION = 'GFTSH-10-WALLET-OBSERVER-V1.0.0';
const API = process.env.HYPERLIQUID_API_URL || 'https://api.hyperliquid.xyz/info';
const TG_TOKEN = process.env.TELEGRAM_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '';
const TG_CHAT = process.env.TELEGRAM_CHAT_ID || '';
const SCAN_INTERVAL_MIN = Math.max(5, Number(process.env.GFTSH_SCAN_INTERVAL_MIN || 15));
const LOOKBACK_MIN = Math.max(SCAN_INTERVAL_MIN + 2, Number(process.env.GFTSH_LOOKBACK_MIN || 20));
const GAP_MS = Math.max(100, Number(process.env.GFTSH_REQUEST_GAP_MS || 250));
const TIMEOUT_MS = Math.max(3000, Number(process.env.GFTSH_REQUEST_TIMEOUT_MS || 15000));
const RETRIES = Math.max(0, Number(process.env.GFTSH_RETRIES || 3));
const RETRY_BASE_MS = Math.max(100, Number(process.env.GFTSH_RETRY_BASE_MS || 500));
const SL_PCT = Math.max(0.01, Number(process.env.GFTSH_MODEL_SL_PCT || 0.5));
const TP_R = Math.max(0.1, Number(process.env.GFTSH_MODEL_TP_R || 2));
const MIN_NOTIONAL = Math.max(0, Number(process.env.GFTSH_MIN_ALERT_NOTIONAL_USD || 50));
const TG_MAX = Math.max(1000, Number(process.env.GFTSH_TELEGRAM_MAX_CHARS || 3800));
const STARTUP_STATUS = String(process.env.GFTSH_SEND_STARTUP_STATUS || 'true').toLowerCase() === 'true';
const STATE_FILE = process.env.GFTSH_WATCH_STATE_FILE || 'production/state/gftsh_10_wallet_observer.json';
const TG_STATE_FILE = process.env.GFTSH_WATCH_TELEGRAM_STATE_FILE || 'production/state/gftsh_10_wallet_telegram.json';

const DEFAULT_WALLETS = [
  '0x885989fd94d30c150e6eaf897090509bce4f6aa8',
  '0xf97ad6704baec104d00b88e0c157e2b7b3a1ddd1',
  '0xe67f141977da22e5c34d15c19b35f180a1532715',
  '0x810b41bd2294ea9b87efd8fd03040ff74a1e5130',
  '0x736850ee773ac6170fcaeda596514269b863ee56',
  '0xad68fabb1bec8b08c8080ad165ae5bdec64136d6',
  '0x95da8596c44dd09f4b8becce87ad3b7894fb2328',
  '0x4bafc8eca50fc3208fb2520a2a49980768ec60f6',
  '0x58f0bf4307c61bc7a5fe11e24fe36e64300b0d20',
  '0xd21d931890d27b6e7e2e668f27931e17698e90f1'
];

const walletEnv = String(process.env.GFTSH_WATCH_WALLETS || '').trim();
const WATCH_WALLETS = (walletEnv ? walletEnv.split(/[\s,;]+/) : DEFAULT_WALLETS)
  .map(x => x.trim().toLowerCase())
  .filter((x, i, a) => /^0x[a-f0-9]{40}$/.test(x) && a.indexOf(x) === i);

if (WATCH_WALLETS.length !== 10) {
  throw new Error(`GFTSH_WATCH_WALLETS must contain exactly 10 valid EVM addresses; got ${WATCH_WALLETS.length}`);
}

let nextRequestAt = 0;
let requestGate = Promise.resolve();

const sleep = ms => new Promise(r => setTimeout(r, ms));
const num = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const short = a => `${a.slice(0, 6)}…${a.slice(-4)}`;
const sideOfSigned = n => n > 0 ? 'LONG' : n < 0 ? 'SHORT' : 'FLAT';
const pct = (v, digits = 2) => Number.isFinite(Number(v)) ? `${Number(v).toFixed(digits)}%` : '—';
const px = v => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1000) return n.toFixed(2);
  if (Math.abs(n) >= 1) return n.toFixed(4);
  if (Math.abs(n) >= 0.01) return n.toFixed(6);
  return n.toPrecision(6);
};
const usd = v => Number.isFinite(Number(v)) ? `$${Number(v).toFixed(2)}` : '—';

async function post(body, label) {
  requestGate = requestGate.then(async () => {
    const wait = Math.max(0, nextRequestAt - Date.now());
    if (wait) await sleep(wait);
    nextRequestAt = Date.now() + GAP_MS;
  });
  await requestGate;

  let lastErr;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`${label}: HTTP_${res.status} ${text.slice(0, 300)}`);
      let data;
      try { data = JSON.parse(text); } catch { throw new Error(`${label}: INVALID_JSON`); }
      return data;
    } catch (e) {
      lastErr = e;
      if (attempt >= RETRIES) break;
      await sleep(RETRY_BASE_MS * (2 ** attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

async function telegram(text) {
  if (!TG_TOKEN || !TG_CHAT) return { skipped: true };
  const url = `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`;
  const chunks = [];
  let s = String(text || '');
  while (s.length > TG_MAX) {
    let cut = s.lastIndexOf('\n', TG_MAX);
    if (cut < 500) cut = TG_MAX;
    chunks.push(s.slice(0, cut));
    s = s.slice(cut).replace(/^\n+/, '');
  }
  if (s) chunks.push(s);
  for (const chunk of chunks) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT, text: chunk, disable_web_page_preview: true })
    });
    if (!res.ok) throw new Error(`Telegram HTTP_${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return { sent: chunks.length };
}

async function loadJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch { return fallback; }
}
async function saveJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2));
  await fs.rename(tmp, file);
}

function fillId(f) {
  return String(f?.tid ?? f?.hash ?? f?.oid ?? `${f?.coin || ''}:${f?.time || ''}:${f?.px || ''}:${f?.sz || ''}:${f?.dir || ''}`);
}

function fillSide(f) {
  const dir = String(f?.dir || '').toLowerCase();
  if (dir.includes('open long')) return 'LONG';
  if (dir.includes('open short')) return 'SHORT';
  if (dir.includes('close long')) return 'CLOSE_LONG';
  if (dir.includes('close short')) return 'CLOSE_SHORT';
  const delta = num(f?.startPosition) + (dir.includes('buy') ? num(f?.sz) : -num(f?.sz));
  return sideOfSigned(delta);
}

function signedAfterFromFill(f) {
  const start = num(f?.startPosition);
  const sz = Math.abs(num(f?.sz));
  const dir = String(f?.dir || '').toLowerCase();
  if (dir.includes('open long') || dir === 'buy') return start + sz;
  if (dir.includes('open short') || dir === 'sell') return start - sz;
  if (dir.includes('close long')) return start - sz;
  if (dir.includes('close short')) return start + sz;
  return start;
}

function isNewPositionFill(f) {
  const start = num(f?.startPosition);
  const after = signedAfterFromFill(f);
  const dir = String(f?.dir || '').toLowerCase();
  if (start === 0 && (dir.includes('open long') || dir.includes('open short'))) return true;
  if (start !== 0 && after !== 0 && Math.sign(start) !== Math.sign(after)) return true;
  return false;
}

function isAddOnlyFill(f) {
  const start = num(f?.startPosition);
  const after = signedAfterFromFill(f);
  if (!start || !after) return false;
  return Math.sign(start) === Math.sign(after) && Math.abs(after) > Math.abs(start);
}

function positionRows(state) {
  const arr = Array.isArray(state?.assetPositions) ? state.assetPositions : [];
  return arr.map(x => x?.position || x).filter(Boolean).map(p => ({
    coin: String(p.coin || ''),
    szi: num(p.szi),
    side: sideOfSigned(num(p.szi)),
    entry: num(p.entryPx),
    leverage: num(p.leverage?.value, num(p.leverage)),
    liquidationPx: num(p.liquidationPx),
    unrealizedPnl: num(p.unrealizedPnl),
    notional: Math.abs(num(p.szi) * num(p.entryPx))
  })).filter(p => p.coin && p.szi !== 0);
}

function modelLevels(side, entry) {
  const risk = entry * (SL_PCT / 100);
  const sl = side === 'LONG' ? entry - risk : entry + risk;
  const tp = side === 'LONG' ? entry + risk * TP_R : entry - risk * TP_R;
  return { sl, tp, rr: TP_R };
}

function currentPrice(mids, coin) { return num(mids?.[coin], NaN); }

function distanceFromEntry(side, entry, current) {
  if (!Number.isFinite(entry) || !Number.isFinite(current) || entry === 0) return NaN;
  return side === 'LONG' ? ((current / entry) - 1) * 100 : ((entry / current) - 1) * 100;
}

async function userFillsByTime(user, startTime, endTime) {
  return post({ type: 'userFillsByTime', user, startTime, endTime }, `fills ${short(user)}`);
}
async function stateFor(user) {
  return post({ type: 'clearinghouseState', user }, `state ${short(user)}`);
}
async function mids() {
  return post({ type: 'allMids' }, 'allMids');
}

function eventFromFill(f, position, mid, walletIndex, address) {
  const side = fillSide(f);
  const entry = num(position?.entry, num(f?.px));
  const model = modelLevels(side, entry);
  const current = Number.isFinite(mid) ? mid : entry;
  const dist = distanceFromEntry(side, entry, current);
  const notional = Math.abs(num(f?.sz) * num(f?.px));
  const timestamp = num(f?.time, Date.now());
  return {
    id: fillId(f), walletIndex, address, coin: String(f?.coin || position?.coin || ''), side,
    leverage: num(position?.leverage, NaN), entry, current, distancePct: dist,
    sl: model.sl, tp: model.tp, rr: model.rr, notional,
    timestamp, fill: f, position
  };
}

function dedupNewEvents(events, seen) {
  const out = [];
  const ids = new Set(seen);
  for (const e of events.sort((a,b) => a.timestamp - b.timestamp)) {
    if (ids.has(e.id)) continue;
    ids.add(e.id);
    out.push(e);
  }
  return { out, ids };
}

function formatAlert(e) {
  const t = new Date(e.timestamp).toISOString().replace('T', ' ').replace('.000Z', ' UTC');
  const wallet = `#${e.walletIndex} ${e.address}`;
  const lev = Number.isFinite(e.leverage) && e.leverage > 0 ? `${e.leverage}x` : '—';
  const dist = Number.isFinite(e.distancePct) ? pct(e.distancePct, 2) : '—';
  return [
    `🐋 GFTSH — NEW FUTURES POSITION`,
    '━━━━━━━━━━━━━━━━━━',
    `👤 Trader: ${wallet}`,
    `🪙 ${e.coin} — ${e.side}`,
    `⚡ Leverage: ${lev}`,
    `💵 Entry: ${px(e.entry)}`,
    `📍 Current: ${px(e.current)}`,
    `📏 From Entry: ${dist}`,
    `🎯 TP: ${px(e.tp)}`,
    `🛑 SL: ${px(e.sl)}`,
    `⚖️ RR: ${e.rr.toFixed(2)}R`,
    `💰 Notional: ${usd(e.notional)}`,
    `ℹ️ TP/SL: MODEL (${SL_PCT}% SL / ${TP_R}R TP)`,
    `🕐 ${t}`,
    '━━━━━━━━━━━━━━━━━━',
    'READ-ONLY • NO COPY TRADE'
  ].join('\n');
}

async function main() {
  const started = Date.now();
  console.log(`${VERSION} | READ-ONLY | FUTURES ONLY | wallets=${WATCH_WALLETS.length}`);
  console.log(`scan=${SCAN_INTERVAL_MIN}m lookback=${LOOKBACK_MIN}m API=${API}`);

  const state = await loadJson(STATE_FILE, { version: VERSION, seenFillIds: [], lastPositions: {}, updatedAt: 0 });
  const telegramState = await loadJson(TG_STATE_FILE, { version: VERSION, startupSent: false });
  const seen = Array.isArray(state.seenFillIds) ? state.seenFillIds.slice(-5000) : [];
  const startTime = Date.now() - LOOKBACK_MIN * 60_000;
  const endTime = Date.now();

  let midsData = {};
  try { midsData = await mids(); } catch (e) { console.warn(`[MIDS] ${e.message}`); }

  const allNew = [];
  const stats = { wallets: 0, fills: 0, newPositions: 0, addsIgnored: 0, belowNotional: 0, errors: 0 };
  const nextPositions = { ...(state.lastPositions || {}) };

  for (let i = 0; i < WATCH_WALLETS.length; i++) {
    const address = WATCH_WALLETS[i];
    stats.wallets++;
    try {
      const [fills, chState] = await Promise.all([
        userFillsByTime(address, startTime, endTime),
        stateFor(address)
      ]);
      if (!Array.isArray(fills)) throw new Error('fills response is not an array');
      stats.fills += fills.length;

      const live = positionRows(chState);
      nextPositions[address] = live.map(p => ({ coin: p.coin, szi: p.szi, side: p.side, entry: p.entry, leverage: p.leverage }));
      const liveByCoin = new Map(live.map(p => [p.coin, p]));

      const candidates = fills
        .filter(f => String(f?.coin || '') && isNewPositionFill(f))
        .sort((a,b) => num(a?.time) - num(b?.time));

      for (const f of candidates) {
        const coin = String(f.coin);
        const position = liveByCoin.get(coin);
        if (!position || position.szi === 0) continue; // source-native current position authority
        const side = fillSide(f);
        if (side !== position.side) continue;
        const notional = Math.abs(num(f.sz) * num(f.px));
        if (notional < MIN_NOTIONAL) { stats.belowNotional++; continue; }
        const e = eventFromFill(f, position, currentPrice(midsData, coin), i + 1, address);
        if (isAddOnlyFill(f)) { stats.addsIgnored++; continue; }
        allNew.push(e);
      }
    } catch (e) {
      stats.errors++;
      console.error(`[WALLET ${i + 1}] ${short(address)} | ${e.message}`);
    }
  }

  const { out: freshEvents, ids } = dedupNewEvents(allNew, seen);
  stats.newPositions = freshEvents.length;

  for (const e of freshEvents) {
    console.log(`[NEW POSITION] #${e.walletIndex} ${short(e.address)} ${e.coin} ${e.side} entry=${px(e.entry)} notional=${usd(e.notional)}`);
    try { await telegram(formatAlert(e)); }
    catch (err) { console.error(`[TELEGRAM] ${err.message}`); }
  }

  if (STARTUP_STATUS && !telegramState.startupSent) {
    try {
      await telegram([
        '🟢 GFTSH 10-WALLET OBSERVER ONLINE',
        '━━━━━━━━━━━━━━━━━━',
        `👀 Futures wallets: ${WATCH_WALLETS.length}`,
        `⏱ Scan: every ${SCAN_INTERVAL_MIN} minutes`,
        `🔎 Lookback: ${LOOKBACK_MIN} minutes`,
        '🚫 Existing-position adds: IGNORED',
        '🚫 Orders/copy trading: DISABLED',
        '🎯 TP/SL: MODEL only',
        `🕐 ${new Date().toISOString()}`
      ].join('\n'));
      telegramState.startupSent = true;
    } catch (e) { console.error(`[STARTUP TELEGRAM] ${e.message}`); }
  }

  const compactSeen = [...ids].slice(-5000);
  await saveJson(STATE_FILE, { version: VERSION, updatedAt: Date.now(), lastScanAt: Date.now(), seenFillIds: compactSeen, lastPositions: nextPositions });
  await saveJson(TG_STATE_FILE, { version: VERSION, updatedAt: Date.now(), startupSent: Boolean(telegramState.startupSent) });

  console.log(`[CYCLE] wallets=${stats.wallets} fills=${stats.fills} new=${stats.newPositions} addsIgnored=${stats.addsIgnored} belowNotional=${stats.belowNotional} errors=${stats.errors} runtime=${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main().catch(e => { console.error(`[FATAL] ${e.stack || e}`); process.exitCode = 1; });
