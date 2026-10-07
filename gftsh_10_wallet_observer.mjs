import fs from 'node:fs/promises';
import path from 'node:path';

/*
 * GFTSH — 10 WALLET LIVE FUTURES OBSERVER
 * READ ONLY. NO ORDERS. NO COPY TRADING.
 *
 * Purpose:
 *   Watch exactly 10 Hyperliquid perpetual-futures wallets.
 *   Every run checks for NEW position opens since the previous run.
 *   Adds/averages are ignored.
 *
 * Detection authority:
 *   userFillsByTime -> startPosition + post-fill position
 *   clearinghouseState -> current position / entry / leverage
 *   frontendOpenOrders -> real TP/SL if publicly exposed
 *
 * Recommended scheduler:
 *   GitHub Actions cron: every 15 minutes
 */

const VERSION = 'GFTSH-10W-LIVE-OBSERVER-V1.1.0-CYCLE-TELEGRAM';
const API = process.env.HYPERLIQUID_API_URL || 'https://api.hyperliquid.xyz/info';

const TG_TOKEN = process.env.TELEGRAM_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '';
const TG_CHAT = process.env.TELEGRAM_CHAT_ID || '';

const SCAN_INTERVAL_MIN = Math.max(1, Number(process.env.GFTSH_SCAN_INTERVAL_MIN || 5));
const LOOKBACK_MIN = Math.max(5, Number(process.env.GFTSH_LOOKBACK_MIN || SCAN_INTERVAL_MIN + 5));
const REQUEST_GAP_MS = Math.max(100, Number(process.env.GFTSH_REQUEST_GAP_MS || 250));
const TIMEOUT_MS = Math.max(3000, Number(process.env.GFTSH_REQUEST_TIMEOUT_MS || 15000));
const RETRIES = Math.max(1, Number(process.env.GFTSH_RETRIES || 3));
const RETRY_BASE_MS = Math.max(200, Number(process.env.GFTSH_RETRY_BASE_MS || 500));

const STATE_FILE =
  process.env.GFTSH_WATCH_STATE_FILE ||
  'production/state/gftsh_10_wallet_observer.json';

const TG_STATE_FILE =
  process.env.GFTSH_WATCH_TELEGRAM_STATE_FILE ||
  'production/state/gftsh_10_wallet_telegram.json';

const MODEL_SL_PCT = Math.max(0.01, Number(process.env.GFTSH_MODEL_SL_PCT || 0.5));
const MODEL_TP_R = Math.max(0.1, Number(process.env.GFTSH_MODEL_TP_R || 2.0));
const MIN_ALERT_NOTIONAL = Math.max(0, Number(process.env.GFTSH_MIN_ALERT_NOTIONAL_USD || 50));
const TELEGRAM_MAX = Math.max(1000, Number(process.env.GFTSH_TELEGRAM_MAX_CHARS || 3800));
const SEND_STARTUP_STATUS =
  String(process.env.GFTSH_SEND_STARTUP_STATUS || 'true').toLowerCase() !== 'false';

/*
 * The 10 wallets selected for the observation phase.
 *
 * #1  0x885989fd94d30c150e6eaf897090509bce4f6aa8
 * #2  0xf97ad6704baec104d00b88e0c157e2b7b3a1ddd1
 * #3  0xe67f141977da22e5c34d15c19b35f180a1532715
 * #4  0x810b41bd2294ea9b87efd8fd03040ff74a1e5130
 * #5  0x736850ee773ac6170fcaeda596514269b863ee56
 * #6  0xad68fabb1bec8b08c8080ad165ae5bdec64136d6
 * #7  0x95da8596c44dd09f4b8becce87ad3b7894fb2328
 * #8  0x4bafc8eca50fc3208fb2520a2a49980768ec60f6
 * #9  0x58f0bf4307c61bc7a5fe11e24fe36e64300b0d20
 * #10 0xd21d931890d27b6e7e2e668f27931e17698e90f1
 *
 * Override with GFTSH_WATCH_WALLETS only if you intentionally want another set.
 */
const DEFAULT_WALLETS = [
  ['Trader #1',  '0x885989fd94d30c150e6eaf897090509bce4f6aa8'],
  ['Trader #2',  '0xf97ad6704baec104d00b88e0c157e2b7b3a1ddd1'],
  ['Trader #3',  '0xe67f141977da22e5c34d15c19b35f180a1532715'],
  ['Trader #4',  '0x810b41bd2294ea9b87efd8fd03040ff74a1e5130'],
  ['Trader #5',  '0x736850ee773ac6170fcaeda596514269b863ee56'],
  ['Trader #6',  '0xad68fabb1bec8b08c8080ad165ae5bdec64136d6'],
  ['Trader #7',  '0x95da8596c44dd09f4b8becce87ad3b7894fb2328'],
  ['Trader #8',  '0x4bafc8eca50fc3208fb2520a2a49980768ec60f6'],
  ['Trader #9',  '0x58f0bf4307c61bc7a5fe11e24fe36e64300b0d20'],
  ['Trader #10', '0xd21d931890d27b6e7e2e668f27931e17698e90f1'],
];

function parseWallets() {
  const raw = String(process.env.GFTSH_WATCH_WALLETS || '').trim();
  if (!raw) return DEFAULT_WALLETS;
  const items = raw.split(',').map(x => x.trim()).filter(Boolean);
  const out = [];
  for (let i = 0; i < items.length && out.length < 10; i++) {
    const [label, address] = items[i].includes('|')
      ? items[i].split('|').map(x => x.trim())
      : [`Trader #${i + 1}`, items[i]];
    if (/^0x[a-fA-F0-9]{40}$/.test(address)) out.push([label || `Trader #${i + 1}`, address]);
  }
  return out.length === 10 ? out : DEFAULT_WALLETS;
}

const WALLETS = parseWallets();

const sleep = ms => new Promise(r => setTimeout(r, ms));
const num = (x, d = 0) => {
  const n = Number(x);
  return Number.isFinite(n) ? n : d;
};
const short = a => `${a.slice(0, 8)}…${a.slice(-6)}`;

function fmtPx(x) {
  const n = num(x);
  if (!(n > 0)) return '—';
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  if (n >= 0.01) return n.toFixed(6);
  if (n >= 0.0001) return n.toFixed(8);
  return n.toExponential(5);
}

function fmtPct(x, digits = 2) {
  const n = Number(x);
  return Number.isFinite(n) ? `${n.toFixed(digits)}%` : '—';
}

function fmtLev(x) {
  const n = Number(x);
  return Number.isFinite(n) && n > 0 ? `${n.toFixed(n >= 10 ? 1 : 2)}x` : '—';
}

function postPositionFromFill(fill) {
  const before = num(fill?.startPosition);
  const sz = Math.abs(num(fill?.sz));
  const dir = String(fill?.dir || '').toLowerCase();

  if (dir.includes('open long')) return before + sz;
  if (dir.includes('open short')) return before - sz;
  if (dir.includes('close long')) return before - sz;
  if (dir.includes('close short')) return before + sz;

  // Fallback for generic buy/sell records.
  if (dir.includes('buy')) return before + sz;
  if (dir.includes('sell')) return before - sz;

  return before;
}

function isNewPositionFill(fill) {
  const before = num(fill?.startPosition);
  const after = postPositionFromFill(fill);

  if (Math.abs(after) < 1e-12) return false;

  // The critical rule:
  // flat -> non-flat = NEW position.
  if (Math.abs(before) < 1e-12) return true;

  // Existing position -> opposite side = FLIP, therefore a new position.
  if (Math.sign(before) !== Math.sign(after)) return true;

  // Existing same-side position = ADD / average -> IGNORE.
  return false;
}

function sideFromFill(fill) {
  const after = postPositionFromFill(fill);
  if (after > 0) return 'LONG';
  if (after < 0) return 'SHORT';
  const dir = String(fill?.dir || '').toLowerCase();
  return dir.includes('short') || dir.includes('sell') ? 'SHORT' : 'LONG';
}

function notional(fill) {
  return Math.abs(num(fill?.sz) * num(fill?.px));
}

function fillKey(fill) {
  return String(
    fill?.tid ??
    `${fill?.coin}|${fill?.time}|${fill?.oid}|${fill?.px}|${fill?.sz}|${fill?.dir}`
  );
}

let gate = Promise.resolve();
let nextRequestAt = 0;

async function pace() {
  gate = gate.then(async () => {
    const wait = Math.max(0, nextRequestAt - Date.now());
    if (wait) await sleep(wait);
    nextRequestAt = Date.now() + REQUEST_GAP_MS;
  });
  return gate;
}

async function postInfo(body, label) {
  let last;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    await pace();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      const text = await res.text();

      if (!res.ok) {
        const err = new Error(`${label}: HTTP ${res.status} ${text.slice(0, 160)}`);
        err.status = res.status;
        throw err;
      }

      return JSON.parse(text);
    } catch (e) {
      last = e;
      if (attempt >= RETRIES) break;
      await sleep(RETRY_BASE_MS * Math.pow(2, attempt - 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw last || new Error(`${label}: failed`);
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2));
}

function getPositionRows(state) {
  return Array.isArray(state?.assetPositions) ? state.assetPositions : [];
}

function normalizePosition(row) {
  const p = row?.position || row || {};
  const szi = num(p?.szi);
  return {
    coin: String(p?.coin || ''),
    szi,
    side: szi > 0 ? 'LONG' : szi < 0 ? 'SHORT' : 'FLAT',
    entry: num(p?.entryPx),
    positionValue: Math.abs(num(p?.positionValue)),
    unrealizedPnl: num(p?.unrealizedPnl),
    leverage:
      num(p?.leverage?.value) ||
      num(p?.leverage?.leverage) ||
      num(p?.leverage)
  };
}

function extractPositions(state) {
  return getPositionRows(state)
    .map(normalizePosition)
    .filter(x => x.coin && x.side !== 'FLAT');
}

async function fetchCurrentState(address) {
  return postInfo({ type: 'clearinghouseState', user: address }, `state:${short(address)}`);
}

async function fetchMids() {
  return postInfo({ type: 'allMids' }, 'mids');
}

async function fetchFills(address, startTime, endTime) {
  const rows = await postInfo(
    {
      type: 'userFillsByTime',
      user: address,
      startTime,
      endTime,
      aggregateByTime: false
    },
    `fills:${short(address)}`
  );
  return Array.isArray(rows) ? rows : [];
}

async function fetchFrontendOrders(address) {
  try {
    const rows = await postInfo(
      { type: 'frontendOpenOrders', user: address },
      `orders:${short(address)}`
    );
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function findPosition(positions, coin, side) {
  return positions.find(p => p.coin === coin && p.side === side) || null;
}

function extractRealTpsl(orders, coin, side) {
  const sameCoin = orders.filter(o => String(o?.coin) === coin);

  let tp = null;
  let sl = null;

  for (const o of sameCoin) {
    if (!o?.reduceOnly && !o?.isPositionTpsl) continue;

    const trigger = num(o?.triggerPx);
    if (!(trigger > 0)) continue;

    const text = `${o?.orderType || ''} ${o?.triggerCondition || ''}`.toLowerCase();

    // Frontend order direction is from the perspective of the order itself.
    // For a LONG position: sell-trigger above entry is TP, below entry is SL.
    // For a SHORT position: buy-trigger below entry is TP, above entry is SL.
    if (side === 'LONG') {
      if (text.includes('take profit') || text.includes('tp')) tp = trigger;
      else if (text.includes('stop') || text.includes('sl')) sl = trigger;
    } else {
      if (text.includes('take profit') || text.includes('tp')) tp = trigger;
      else if (text.includes('stop') || text.includes('sl')) sl = trigger;
    }
  }

  return { tp, sl };
}

function modelLevels(side, entry) {
  const slDistance = entry * MODEL_SL_PCT / 100;
  const tpDistance = slDistance * MODEL_TP_R;

  if (side === 'LONG') {
    return {
      sl: entry - slDistance,
      tp: entry + tpDistance,
      rr: MODEL_TP_R
    };
  }

  return {
    sl: entry + slDistance,
    tp: entry - tpDistance,
    rr: MODEL_TP_R
  };
}

function calculateRR(side, entry, sl, tp) {
  if (!(entry > 0 && sl > 0 && tp > 0)) return null;
  const risk = side === 'LONG' ? entry - sl : sl - entry;
  const reward = side === 'LONG' ? tp - entry : entry - tp;
  if (!(risk > 0 && reward > 0)) return null;
  return reward / risk;
}

function buildAlert({ trader, address, fill, position, mark, realTpsl }) {
  const side = position?.side || sideFromFill(fill);
  const entry = num(position?.entry) || num(fill?.px);
  const lev = num(position?.leverage);
  const current = num(mark);
  const distance = entry > 0 ? ((current - entry) / entry) * 100 * (side === 'LONG' ? 1 : -1) : null;

  const model = modelLevels(side, entry);
  const sl = num(realTpsl?.sl) || model.sl;
  const tp = num(realTpsl?.tp) || model.tp;
  const rr = calculateRR(side, entry, sl, tp);

  return {
    trader,
    address,
    coin: String(fill?.coin || position?.coin || ''),
    side,
    entry,
    current,
    leverage: lev,
    distancePct: distance,
    sl,
    tp,
    rr,
    notional: notional(fill),
    openedAt: num(fill?.time) || Date.now(),
    fillId: fillKey(fill),
    tpslSource: realTpsl?.sl || realTpsl?.tp ? 'TRADER_TPSL' : 'MODEL'
  };
}

function formatAlert(a) {
  const icon = a.side === 'LONG' ? '🟢' : '🔴';
  const tpslLabel = a.tpslSource === 'TRADER_TPSL' ? 'Trader TP/SL' : 'Model TP/SL';

  return [
    '🐋 SMART MONEY — NEW FUTURES POSITION',
    '━━━━━━━━━━━━━━━━━━',
    `👤 ${a.trader}`,
    `🔗 ${short(a.address)}`,
    '',
    `${icon} ${a.side} ${a.coin}`,
    `⚡ Leverage: ${fmtLev(a.leverage)}`,
    `📍 Entry: ${fmtPx(a.entry)}`,
    `💵 Current: ${fmtPx(a.current)}`,
    `📏 Distance from Entry: ${fmtPct(a.distancePct)}`,
    '',
    `🎯 TP: ${fmtPx(a.tp)}`,
    `🛑 SL: ${fmtPx(a.sl)}`,
    `📊 RR: ${a.rr != null ? a.rr.toFixed(2) : '—'}`,
    `🧮 TP/SL source: ${tpslLabel}`,
    `💰 New position notional: $${a.notional.toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
    '',
    `🕐 Opened: ${new Date(a.openedAt).toISOString()}`,
    `🆔 Fill: ${a.fillId}`,
    '',
    '✅ NEW POSITION',
    '❌ ADD / averaging ignored'
  ].join('\n');
}

async function sendTelegram(text) {
  if (!TG_TOKEN || !TG_CHAT) return { sent: false, reason: 'telegram_not_configured' };

  const chunks = [];
  if (text.length <= TELEGRAM_MAX) chunks.push(text);
  else {
    chunks.push(text.slice(0, TELEGRAM_MAX - 80) + '\n\n⚠️ Message truncated.');
  }

  for (const chunk of chunks) {
    const url = `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: TG_CHAT,
        text: chunk,
        disable_web_page_preview: true
      })
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Telegram HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
  }

  return { sent: true };
}

async function sendStartupStatus(state) {
  if (!SEND_STARTUP_STATUS) return;
  const text = [
    '👁️ GFTSH — 10 WALLET OBSERVER',
    '━━━━━━━━━━━━━━━━━━',
    `📡 Status: WATCHING`,
    `👥 Wallets: ${WALLETS.length}`,
    `⏱ Scan interval: ${SCAN_INTERVAL_MIN}m`,
    '📚 Market: Hyperliquid Perpetuals',
    '🛡 Mode: READ-ONLY',
    '❌ Orders: DISABLED',
    '❌ Auto-copy: DISABLED',
    `🗂 State: ${state.initialized ? 'RESTORED' : 'INITIALIZED'}`
  ].join('\n');
  await sendTelegram(text);
}

async function main() {
  const started = Date.now();
  console.log(`\n${VERSION}`);
  console.log('READ-ONLY | NO ORDERS | NO AUTO-COPY | FUTURES ONLY');
  console.log(`Watching ${WALLETS.length} fixed wallets every ${SCAN_INTERVAL_MIN} minutes.`);

  const state = await readJson(STATE_FILE, {
    version: VERSION,
    initialized: false,
    lastScanAt: 0,
    wallets: {},
    alertedFillIds: []
  });

  if (state.lastScanAt && Date.now() - state.lastScanAt < (SCAN_INTERVAL_MIN * 60_000 * 0.8)) {
    console.log('[SCHEDULE-GUARD] Previous scan is too recent; skipping duplicate run.');
    return;
  }

  const now = Date.now();
  const start = now - LOOKBACK_MIN * 60_000;
  const mids = await fetchMids();

  let alerts = [];
  let errors = 0;
  let staleCount = 0;

  for (const [trader, address] of WALLETS) {
    try {
      const [fills, currentState, orders] = await Promise.all([
        fetchFills(address, start, now),
        fetchCurrentState(address),
        fetchFrontendOrders(address)
      ]);

      const positions = extractPositions(currentState);
      const previous = state.wallets[address] || {};
      const seen = new Set(state.alertedFillIds || []);

      const candidates = fills
        .filter(f => num(f?.time) >= start && num(f?.time) <= now + 1000)
        .filter(f => notional(f) >= MIN_ALERT_NOTIONAL)
        .filter(isNewPositionFill)
        .filter(f => !seen.has(fillKey(f)))
        .sort((a, b) => num(a.time) - num(b.time));

      for (const fill of candidates) {
        const coin = String(fill?.coin || '');
        const side = sideFromFill(fill);
        const position = findPosition(positions, coin, side);

        // Only alert if the source-native current position confirms the new trade
        // still exists. This prevents stale historical fills from becoming alerts.
        if (!position) {
          staleCount++;
          console.log(`[SKIP][STALE/FLAT] ${trader} ${coin} ${side} fill=${fillKey(fill)}`);
          continue;
        }

        const realTpsl = extractRealTpsl(orders, coin, side);
        const alert = buildAlert({
          trader,
          address,
          fill,
          position,
          mark: num(mids?.[coin]),
          realTpsl
        });

        alerts.push(alert);
        seen.add(fillKey(fill));
        console.log(
          `[NEW] ${trader} ${side} ${coin} entry=${fmtPx(alert.entry)} ` +
          `mark=${fmtPx(alert.current)} lev=${fmtLev(alert.leverage)} ` +
          `dist=${fmtPct(alert.distancePct)} rr=${alert.rr ?? '—'}`
        );
      }

      // Persist latest known current positions for diagnostics/reconciliation.
      state.wallets[address] = {
        trader,
        address,
        checkedAt: now,
        positions
      };

      state.alertedFillIds = [...seen].slice(-2000);
    } catch (e) {
      errors++;
      console.error(`[WATCH][ERROR] ${trader} ${short(address)}: ${e?.message || e}`);
    }
  }

  state.version = VERSION;
  state.initialized = true;
  state.lastScanAt = now;
  state.lastRuntimeMs = Date.now() - started;
  state.lastAlerts = alerts.map(a => ({
    trader: a.trader,
    address: a.address,
    coin: a.coin,
    side: a.side,
    entry: a.entry,
    current: a.current,
    leverage: a.leverage,
    distancePct: a.distancePct,
    tp: a.tp,
    sl: a.sl,
    rr: a.rr,
    openedAt: a.openedAt,
    fillId: a.fillId
  }));

  await writeJson(STATE_FILE, state);

  const tgState = await readJson(TG_STATE_FILE, {
    initialized: false,
    lastStartupAt: 0,
    lastCycleAt: 0
  });
  if (!tgState.initialized) {
    await sendStartupStatus(state);
    tgState.initialized = true;
    tgState.lastStartupAt = now;
  }

  // Send one Telegram alert per genuinely new position.
  // Multiple new positions in one scan are separated clearly.
  for (const alert of alerts) {
    await sendTelegram(formatAlert(alert));
  }

  // GitHub Actions starts a fresh process on every scheduled run.
  // Therefore send one cycle/status message on every successful run.
  const cycleRuntimeSec = ((Date.now() - started) / 1000).toFixed(1);
  const cycleText = [
    '👁️ GFTSH — 10 WALLET OBSERVER',
    '━━━━━━━━━━━━━━━━━━',
    '📡 Status: WATCHING',
    `👥 Wallets checked: ${WALLETS.length}/${WALLETS.length}`,
    `⏱ Schedule: every ${SCAN_INTERVAL_MIN} minutes`,
    '',
    `🆕 New positions: ${alerts.length}`,
    '➕ ADD / averaging: ignored',
    `⏭ Stale / flat: ${staleCount}`,
    `❌ Errors: ${errors}`,
    '',
    `🕐 Cycle: ${new Date(now).toISOString()}`,
    `⚙️ Runtime: ${cycleRuntimeSec}s`,
    '',
    '🛡 READ-ONLY',
    '❌ Orders: DISABLED',
    '❌ Auto-copy: DISABLED'
  ].join('\n');

  await sendTelegram(cycleText);

  tgState.lastCycleAt = now;
  tgState.lastCycleAlerts = alerts.length;
  tgState.lastCycleErrors = errors;
  await writeJson(TG_STATE_FILE, tgState);

  console.log(
    `[CYCLE] wallets=${WALLETS.length} alerts=${alerts.length} errors=${errors} ` +
    `runtime=${cycleRuntimeSec}s`
  );
}

main().catch(e => {
  console.error(`[FATAL] ${e?.stack || e}`);
  process.exitCode = 1;
});
