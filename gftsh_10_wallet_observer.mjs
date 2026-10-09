import fs from 'node:fs/promises';
import path from 'node:path';

/*
 * GFTSH — 10 WALLET LIVE FUTURES OBSERVER
 * READ ONLY. NO ORDERS. NO COPY TRADING.
 *
 * Purpose:
 *   Watch exactly 10 Hyperliquid perpetual-futures wallets.
 *   Every run checks all CURRENTLY OPEN positions.
 *   Position age does not matter.
 *   Adds/averages are reflected in the current weighted-average entry.
 *
 * Detection authority:
 *   userFillsByTime -> startPosition + post-fill position
 *   clearinghouseState -> current position / entry / leverage
 *   frontendOpenOrders -> real TP/SL if publicly exposed
 *
 * Recommended scheduler:
 *   GitHub Actions cron: every 5–10 minutes
 */

const VERSION = 'GFTSH-10W-LIVE-OBSERVER-V2.2.0-NEW-POSITION-NEAR-ENTRY';
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
const RR_ALERT_MAX = Number.isFinite(Number(process.env.GFTSH_RR_ALERT_MAX))
  ? Number(process.env.GFTSH_RR_ALERT_MAX)
  : 0.5;
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

function buildAlert({ trader, address, position, mark, realTpsl }) {
  const side = position?.side;
  const entry = num(position?.entry);
  const lev = num(position?.leverage);
  const current = num(mark);
  const distance = entry > 0 ? ((current - entry) / entry) * 100 * (side === 'LONG' ? 1 : -1) : null;

  // IMPORTANT: RR is evaluated from the trader's REAL currently-open TP/SL.
  // The old model fallback (RR=2.0) is intentionally NOT used for the RR<0.5 watcher.
  const sl = num(realTpsl?.sl);
  const tp = num(realTpsl?.tp);
  const rr = calculateRR(side, entry, sl, tp);

  return {
    trader,
    address,
    coin: String(position?.coin || ''),
    side,
    entry,
    current,
    leverage: lev,
    distancePct: distance,
    sl: sl > 0 ? sl : null,
    tp: tp > 0 ? tp : null,
    rr,
    notional: num(position?.positionValue),
    positionSize: Math.abs(num(position?.szi)),
    tpslSource: sl > 0 || tp > 0 ? 'TRADER_TPSL' : 'NONE'
  };
}

function formatAlert(a) {
  const icon = a.side === 'LONG' ? '🟢' : '🔴';
  const levels = modelLevels(a.side, a.entry);
  return [
    '🐋 SMART MONEY — NEW POSITION',
    '━━━━━━━━━━━━━━━━━━',
    `👤 ${a.trader}`,
    `🔗 ${short(a.address)}`,
    '',
    `${icon} ${a.side} ${a.coin}`,
    '🆕 Event: NEW POSITION OPENED',
    `⚡ Leverage: ${fmtLev(a.leverage)}`,
    `📍 Average Entry: ${fmtPx(a.entry)}`,
    `💵 Current Mark: ${fmtPx(a.current)}`,
    `📏 Entry Distance: ${fmtPct(a.distancePct)}`,
    '',
    `🎯 Model TP: ${fmtPx(levels.tp)}`,
    `🛑 Model SL: ${fmtPx(levels.sl)}`,
    `💰 Position Notional: $${a.notional.toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
    `🕒 Opening fill: ${a.fillTime ? new Date(a.fillTime).toISOString() : 'recent'}`,
    '',
    '🔒 Averaging/add fills are ignored',
    '📐 Signal only when mark is within 0.50% of current average entry',
    '🛡 READ-ONLY | NO ORDERS | NO AUTO-COPY'
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
  console.log('Signal rule: NEW position only; ignore averaging; mark-entry distance < 0.50%.');

  const state = await readJson(STATE_FILE, {
    version: VERSION,
    initialized: false,
    lastScanAt: 0,
    wallets: {},
    alertedFillIds: [],
    pendingPositionFills: {}
  });

  // Suppress only near-simultaneous duplicate invocations; never block a valid 5–10m scan.
  const previousScanAt = num(state.lastScanAt);
  const scanAgeMs = Date.now() - previousScanAt;
  if (previousScanAt && scanAgeMs >= 0 && scanAgeMs < 2 * 60_000) {
    console.log(`[SCHEDULE-GUARD] Duplicate run suppressed; previous scan was ${Math.round(scanAgeMs / 1000)}s ago.`);
    return;
  }

  const now = Date.now();
  const startTime = Math.max(0, now - LOOKBACK_MIN * 60_000);
  const mids = await fetchMids();
  const alertedFillIds = new Set((state.alertedFillIds || []).map(String));
  state.pendingPositionFills ||= {};
  const alerts = [];
  const newPositionFills = [];
  let errors = 0;
  let positionsChecked = 0;
  let averagingFillsIgnored = 0;
  let outsideEntryBand = 0;
  let belowMinimumNotional = 0;

  for (const [trader, address] of WALLETS) {
    try {
      const [currentState, orders, fills] = await Promise.all([
        fetchCurrentState(address),
        fetchFrontendOrders(address),
        fetchFills(address, startTime, now)
      ]);
      const positions = extractPositions(currentState);
      const fillsSorted = fills.slice().sort((a, b) => num(a.time) - num(b.time));

      // Reconstruct the latest open lifecycle per coin from chronological fills.
      // A close clears the previous opening event; a later reopen replaces it.
      // This prevents an old opening fill from being mistaken for a recent reopen.
      const latestOpenByCoin = new Map();
      for (const fill of fillsSorted) {
        const coin = String(fill?.coin || '');
        if (!coin) continue;
        const before = num(fill?.startPosition);
        const after = postPositionFromFill(fill);

        const pendingCoinKey = `${address}|${coin}`;
        if (Math.abs(before) > 1e-12 && Math.abs(after) < 1e-12) {
          latestOpenByCoin.delete(coin);
          delete state.pendingPositionFills[pendingCoinKey];
          continue;
        }

        if (isNewPositionFill(fill)) {
          latestOpenByCoin.set(coin, fill);
          const lifecycleKey = `${address}|${fillKey(fill)}`;
          if (!alertedFillIds.has(lifecycleKey)) {
            state.pendingPositionFills[pendingCoinKey] = {
              trader, address, coin, side: sideFromFill(fill),
              time: num(fill?.time), key: lifecycleKey, fillKey: fillKey(fill)
            };
          }
          continue;
        }

        if (Math.abs(before) > 1e-12 && Math.abs(after) > Math.abs(before) && Math.sign(before) === Math.sign(after)) {
          averagingFillsIgnored++;
        }
      }

      // Persist newly detected lifecycles. Keep them pending until the mark enters
      // the strict 0.50% band and Telegram confirms delivery, or the position closes.
      for (const [coin, fill] of latestOpenByCoin.entries()) {
        const key = `${address}|${fillKey(fill)}`;
        if (alertedFillIds.has(key)) continue;
        const pendingCoinKey = `${address}|${coin}`;
        state.pendingPositionFills[pendingCoinKey] = {
          trader, address, coin, side: sideFromFill(fill),
          time: num(fill?.time), key, fillKey: fillKey(fill)
        };
      }

      // Evaluate all still-open pending lifecycles, including those first seen in an
      // earlier scan while price was outside the entry band or mark data was missing.
      for (const [pendingCoinKey, pending] of Object.entries(state.pendingPositionFills)) {
        if (pending.address !== address) continue;
        const currentPosition = findPosition(positions, pending.coin, pending.side);
        if (!currentPosition) {
          delete state.pendingPositionFills[pendingCoinKey];
          continue;
        }
        if (alertedFillIds.has(pending.key)) {
          delete state.pendingPositionFills[pendingCoinKey];
          continue;
        }

        if (!(num(currentPosition.positionValue) >= MIN_ALERT_NOTIONAL)) {
          belowMinimumNotional++;
          continue;
        }

        const mark = num(mids?.[pending.coin]);
        const entry = num(currentPosition.entry);
        if (!(mark > 0 && entry > 0)) {
          console.log(`[NEW-POSITION][NO-MARK] ${trader} ${pending.side} ${pending.coin} entry=${fmtPx(entry)} mark=${fmtPx(mark)}`);
          continue;
        }

        // Strictly less than 0.50% absolute distance from current average entry.
        const distancePct = Math.abs((mark - entry) / entry) * 100;
        if (!(distancePct < 0.5)) {
          outsideEntryBand++;
          console.log(`[NEW-POSITION][OUTSIDE-BAND] ${trader} ${pending.side} ${pending.coin} entry=${fmtPx(entry)} mark=${fmtPx(mark)} distance=${fmtPct(distancePct)} >= 0.50%`);
          continue;
        }

        const alert = {
          trader: pending.trader,
          address,
          coin: pending.coin,
          side: pending.side,
          entry,
          current: mark,
          leverage: num(currentPosition.leverage),
          distancePct,
          notional: num(currentPosition.positionValue),
          positionSize: Math.abs(num(currentPosition.szi)),
          fillTime: pending.time,
          fillKey: pending.key,
          pendingCoinKey
        };
        alerts.push(alert);
        console.log(`[NEW-POSITION][SIGNAL] ${trader} ${pending.side} ${pending.coin} entry=${fmtPx(entry)} mark=${fmtPx(mark)} distance=${fmtPct(distancePct)} fill=${pending.fillKey}`);
      }

      state.wallets[address] = {
        trader,
        address,
        checkedAt: now,
        positions,
        recentFillCount: fills.length
      };
      positionsChecked += positions.length;
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
    distancePct: a.distancePct,
    fillTime: a.fillTime
  }));
  // Only successfully delivered alert IDs belong in the dedupe set.
  state.alertedFillIds = [...alertedFillIds].slice(-5000);
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

  for (const alert of alerts) {
    await sendTelegram(formatAlert(alert));
    // Mark delivered only after Telegram returns success; failed sends remain pending.
    alertedFillIds.add(alert.fillKey);
    delete state.pendingPositionFills[alert.pendingCoinKey];
    state.alertedFillIds = [...alertedFillIds].slice(-5000);
    await writeJson(STATE_FILE, state);
  }

  const cycleRuntimeSec = ((Date.now() - started) / 1000).toFixed(1);
  const cycleText = [
    '👁️ GFTSH — 10 WALLET OBSERVER',
    '━━━━━━━━━━━━━━━━━━',
    '📡 Status: WATCHING',
    `👥 Wallets checked: ${WALLETS.length}/${WALLETS.length}`,
    `⏱ Scan interval: ${SCAN_INTERVAL_MIN} minutes`,
    '',
    `🆕 New-position signals sent: ${alerts.length}`,
    `📊 Open positions checked: ${positionsChecked}`,
    `🔄 Averaging/add fills ignored: ${averagingFillsIgnored}`,
    `📏 New positions outside 0.50% entry band: ${outsideEntryBand}`,
    `⏭ Below minimum notional: ${belowMinimumNotional}`,
    `❌ Wallet/API errors: ${errors}`,
    '',
    `🕐 Cycle: ${new Date(now).toISOString()}`,
    `⚙️ Runtime: ${cycleRuntimeSec}s`,
    '',
    'Signal rule: a newly opened position only; a later reopen can signal again.',
    '🛡 READ-ONLY | NO ORDERS | NO AUTO-COPY'
  ].join('\n');
  await sendTelegram(cycleText);

  tgState.lastCycleAt = now;
  tgState.lastCycleAlerts = alerts.length;
  tgState.lastCycleErrors = errors;
  await writeJson(TG_STATE_FILE, tgState);

  console.log(`[CYCLE] wallets=${WALLETS.length} positions=${positionsChecked} newPositionSignals=${alerts.length} averagingIgnored=${averagingFillsIgnored} outsideBand=${outsideEntryBand} errors=${errors} runtime=${cycleRuntimeSec}s`);
}

main().catch(e => {
  console.error(`[FATAL] ${e?.stack || e}`);
  process.exitCode = 1;
});
