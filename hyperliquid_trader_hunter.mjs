import fs from "node:fs/promises";

/*
 HYPERLIQUID TRADER HUNTER V4
 READ-ONLY discovery + trader analytics + copy-trade planning.
 NO ORDERS / NO PRIVATE KEY / NO EXECUTION.

 Important:
 - A trader is selected from CLOSED trades over the configured lookback.
 - Entry/SL/TP below are a PLANNING layer for a potential future copy.
 - They are NOT the source trader's TP/SL and are NOT executed by this file.
*/

const INFO = process.env.HYPERLIQUID_API_URL || "https://api.hyperliquid.xyz/info";
const LOOKBACK_DAYS = Number(process.env.HYPERLIQUID_HUNTER_LOOKBACK_DAYS || 7);
const MAX_CANDIDATES = Number(process.env.HYPERLIQUID_HUNTER_MAX_CANDIDATES || 300);

const MIN_TRADES = Number(process.env.HYPERLIQUID_HUNTER_MIN_7D_TRADES || 30);
const MIN_WR = Number(process.env.HYPERLIQUID_HUNTER_MIN_7D_WIN_RATE || 65);
const MIN_PNL = Number(process.env.HYPERLIQUID_HUNTER_MIN_7D_PNL || 0);
const MIN_PF = Number(process.env.HYPERLIQUID_HUNTER_MIN_PROFIT_FACTOR || 1.5);
const MAX_MEDIAN_HOLD = Number(process.env.HYPERLIQUID_HUNTER_MAX_MEDIAN_HOLD_HOURS || 6);
const MAX_AVG_HOLD = Number(process.env.HYPERLIQUID_HUNTER_MAX_AVG_HOLD_HOURS || 12);
const MIN_ACTIVE_DAYS = Number(process.env.HYPERLIQUID_HUNTER_MIN_ACTIVE_DAYS || 4);
const MAX_LOSING_STREAK = Number(process.env.HYPERLIQUID_HUNTER_MAX_LOSING_STREAK || 8);
const MAX_LIQUIDATIONS = Number(process.env.HYPERLIQUID_HUNTER_MAX_LIQUIDATIONS || 1);

const MIN_SETUP_RR = Number(process.env.HYPERLIQUID_HUNTER_MIN_SETUP_RR || 1.5);
const MAX_ENTRY_DISTANCE_PCT = Number(process.env.HYPERLIQUID_HUNTER_MAX_ENTRY_DISTANCE_PCT || 1.0);
const SL_ATR_MULT = Number(process.env.HYPERLIQUID_HUNTER_SL_ATR_MULT || 1.2);
const TP_ATR_MULT = Number(process.env.HYPERLIQUID_HUNTER_TP_ATR_MULT || 2.0);
const MAX_HOLD_PLAN_HOURS = Number(process.env.HYPERLIQUID_HUNTER_MAX_PLANNED_HOLD_HOURS || 12);

const STATE_FILE = process.env.HYPERLIQUID_HUNTER_STATE_FILE ||
  "state/hyperliquid_trader_hunter_v4.json";

const DISCOVERY_URL = process.env.HYPERLIQUID_HUNTER_DISCOVERY_URL ||
  "https://stats-data.hyperliquid.xyz/Mainnet/leaderboard";

const DISCOVERY_ENABLED =
  String(process.env.HYPERLIQUID_HUNTER_DISCOVERY_ENABLED ?? "true").toLowerCase() !== "false";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

const sleep = ms => new Promise(r => setTimeout(r, ms));

function addresses(raw) {
  return [...new Set(String(raw || "")
    .split(/[\s,;\n]+/)
    .map(x => x.trim().toLowerCase())
    .filter(x => ADDRESS_RE.test(x)))];
}

async function info(body) {
  const r = await fetch(INFO, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`Info API ${r.status}`);
  return r.json();
}

function extractAddresses(v, out = []) {
  if (typeof v === "string") {
    if (ADDRESS_RE.test(v)) out.push(v.toLowerCase());
    return out;
  }
  if (Array.isArray(v)) {
    for (const x of v) extractAddresses(x, out);
    return out;
  }
  if (v && typeof v === "object") {
    for (const x of Object.values(v)) extractAddresses(x, out);
  }
  return out;
}

async function discover() {
  let publicPool = [];

  if (DISCOVERY_ENABLED) {
    try {
      const r = await fetch(DISCOVERY_URL, {
        headers: { accept: "application/json,*/*" }
      });
      if (!r.ok) throw new Error(`Discovery ${r.status}`);
      publicPool = extractAddresses(await r.json());
      console.log(`[DISCOVERY] public=${publicPool.length}`);
    } catch (e) {
      console.log(`[DISCOVERY] unavailable: ${e.message}`);
    }
  }

  const manual = addresses(process.env.HYPERLIQUID_HUNTER_CANDIDATES);
  const seeds = addresses(process.env.HYPERLIQUID_TRADERS);

  const pool = [...new Set([...publicPool, ...manual, ...seeds])]
    .slice(0, MAX_CANDIDATES);

  return {
    pool,
    publicCount: publicPool.length,
    manualCount: manual.length,
    seedCount: seeds.length
  };
}

async function fetchFills(user, startTime, endTime) {
  const result = [];
  let cursor = startTime;

  for (let page = 0; page < 20; page++) {
    const rows = await info({
      type: "userFillsByTime",
      user,
      startTime: cursor,
      endTime
    });

    if (!Array.isArray(rows) || !rows.length) break;

    result.push(...rows);

    if (rows.length < 2000) break;

    const newest = Math.max(...rows.map(x => Number(x.time || 0)));
    if (!newest || newest < cursor) break;

    cursor = newest + 1;
    await sleep(60);
  }

  const seen = new Set();

  return result.filter(x => {
    const key = [
      x.tid, x.hash, x.time, x.oid, x.coin, x.px, x.sz, x.dir
    ].join("|");

    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function direction(dir) {
  const d = String(dir || "");
  if (d === "Open Long") return "OPEN_LONG";
  if (d === "Close Long") return "CLOSE_LONG";
  if (d === "Open Short") return "OPEN_SHORT";
  if (d === "Close Short") return "CLOSE_SHORT";
  return null;
}

/*
 FIFO reconstruction.
 Every partial close creates a measurable closed slice.
 closedPnl is allocated pro-rata to the portion of the closing fill.
*/
function reconstruct(fills) {
  const books = new Map();
  const trades = [];
  let liquidations = 0;

  const ordered = [...fills].sort(
    (a, b) => Number(a.time || 0) - Number(b.time || 0)
  );

  for (const f of ordered) {
    if (/liquidat/i.test(String(f.dir || ""))) liquidations++;

    const d = direction(f.dir);
    if (!d) continue;

    const coin = String(f.coin || "");
    const qty = Math.abs(Number(f.sz || 0));
    const px = Number(f.px || 0);
    const time = Number(f.time || 0);

    if (!coin || !qty || !time) continue;

    if (!books.has(coin)) books.set(coin, { long: [], short: [] });

    const side = d.includes("LONG") ? "long" : "short";
    const q = books.get(coin)[side];

    if (d.startsWith("OPEN")) {
      q.push({
        qty,
        px,
        time,
        fill: f
      });
      continue;
    }

    let remaining = qty;

    while (remaining > 1e-12 && q.length) {
      const lot = q[0];
      const take = Math.min(remaining, lot.qty);
      const ratio = take / qty;

      trades.push({
        coin,
        side,
        openTime: lot.time,
        closeTime: time,
        openPx: lot.px,
        closePx: px,
        qty: take,
        holdHours: Math.max(0, time - lot.time) / 3600000,
        pnl: Number(f.closedPnl || 0) * ratio
      });

      lot.qty -= take;
      remaining -= take;

      if (lot.qty <= 1e-12) q.shift();
    }
  }

  return { trades, liquidations };
}

function median(values) {
  if (!values.length) return null;
  const a = [...values].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function percentile(values, p) {
  if (!values.length) return null;
  const a = [...values].sort((x, y) => x - y);
  const i = (a.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return a[lo];
  return a[lo] + (a[hi] - a[lo]) * (i - lo);
}

function losingStreak(trades) {
  let cur = 0;
  let max = 0;

  for (const t of trades) {
    if (t.pnl < 0) {
      cur++;
      max = Math.max(max, cur);
    } else {
      cur = 0;
    }
  }

  return max;
}

function metrics(address, fills) {
  const { trades, liquidations } = reconstruct(fills);
  const pnls = trades.map(x => x.pnl);
  const wins = pnls.filter(x => x > 0);
  const losses = pnls.filter(x => x < 0);
  const holds = trades.map(x => x.holdHours);

  const pnl = pnls.reduce((a, b) => a + b, 0);
  const grossWin = wins.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));

  const closeDates = new Set(
    trades.map(t => new Date(t.closeTime).toISOString().slice(0, 10))
  );

  return {
    address,
    fills: fills.length,
    trades,
    closedTrades: trades.length,
    winRate: trades.length ? wins.length / trades.length * 100 : null,
    pnl,
    grossWin,
    grossLoss,
    profitFactor:
      grossLoss > 0 ? grossWin / grossLoss :
      grossWin > 0 ? Infinity : null,
    medianHoldHours: median(holds),
    avgHoldHours: holds.length
      ? holds.reduce((a, b) => a + b, 0) / holds.length
      : null,
    p25HoldHours: percentile(holds, 0.25),
    p75HoldHours: percentile(holds, 0.75),
    activeDays: closeDates.size,
    tradesPerActiveDay: closeDates.size
      ? trades.length / closeDates.size
      : 0,
    maxLosingStreak: losingStreak(
      [...trades].sort((a, b) => a.closeTime - b.closeTime)
    ),
    liquidations
  };
}

function passes(m) {
  return (
    m.closedTrades >= MIN_TRADES &&
    m.winRate !== null &&
    m.winRate >= MIN_WR &&
    m.pnl >= MIN_PNL &&
    (m.profitFactor === Infinity ||
      (m.profitFactor !== null && m.profitFactor >= MIN_PF)) &&
    m.medianHoldHours !== null &&
    m.medianHoldHours <= MAX_MEDIAN_HOLD &&
    m.avgHoldHours !== null &&
    m.avgHoldHours <= MAX_AVG_HOLD &&
    m.activeDays >= MIN_ACTIVE_DAYS &&
    m.maxLosingStreak <= MAX_LOSING_STREAK &&
    m.liquidations <= MAX_LIQUIDATIONS
  );
}

/*
 Build a proposed copy plan from the trader's latest still-open position.

 We deliberately use only public market data:
 - current mid from l2Book
 - recent candle range from candleSnapshot
 - source position direction/entry from clearinghouseState

 This is a PLAN ONLY. No order is sent.
*/
async function latestPosition(address) {
  const state = await info({
    type: "clearinghouseState",
    user: address
  });

  const positions = Array.isArray(state?.assetPositions)
    ? state.assetPositions
    : [];

  const active = [];

  for (const p of positions) {
    const pos = p?.position || p;
    const szi = Number(pos?.szi || 0);
    if (!szi) continue;

    active.push({
      coin: String(pos.coin || ""),
      side: szi > 0 ? "LONG" : "SHORT",
      size: Math.abs(szi),
      entry: Number(pos.entryPx || 0),
      unrealizedPnl: Number(pos.unrealizedPnl || 0),
      leverage:
        typeof pos.leverage === "object"
          ? Number(pos.leverage.value || 0)
          : Number(pos.leverage || 0)
    });
  }

  if (!active.length) return null;

  active.sort((a, b) =>
    Math.abs(b.unrealizedPnl) - Math.abs(a.unrealizedPnl)
  );

  const p = active[0];

  try {
    const book = await info({ type: "l2Book", coin: p.coin });
    const levels = book?.levels || [];
    const bid = Number(levels?.[0]?.[0]?.px || 0);
    const ask = Number(levels?.[1]?.[0]?.px || 0);
    const mid = bid && ask ? (bid + ask) / 2 : bid || ask;

    const candles = await info({
      type: "candleSnapshot",
      req: {
        coin: p.coin,
        interval: "1h",
        startTime: Date.now() - 48 * 3600000,
        endTime: Date.now()
      }
    });

    const rows = Array.isArray(candles) ? candles : [];
    const completed = rows.slice(0, -1);

    const ranges = completed
      .map(c => Number(c.h) - Number(c.l))
      .filter(x => Number.isFinite(x) && x > 0);

    const atr =
      ranges.length
        ? ranges.slice(-14).reduce((a, b) => a + b, 0) /
          Math.min(14, ranges.length)
        : 0;

    const distancePct = p.entry && mid
      ? Math.abs(mid - p.entry) / p.entry * 100
      : null;

    if (!mid || !atr) {
      return {
        ...p,
        mid,
        atr,
        distancePct,
        eligiblePlan: false,
        planReason: "INSUFFICIENT_MARKET_DATA"
      };
    }

    const rawSL =
      p.side === "LONG"
        ? p.entry - atr * SL_ATR_MULT
        : p.entry + atr * SL_ATR_MULT;

    const rawTP =
      p.side === "LONG"
        ? p.entry + atr * TP_ATR_MULT
        : p.entry - atr * TP_ATR_MULT;

    const risk = Math.abs(p.entry - rawSL);
    const reward = Math.abs(rawTP - p.entry);
    const rr = risk > 0 ? reward / risk : 0;

    const eligible =
      distancePct !== null &&
      distancePct <= MAX_ENTRY_DISTANCE_PCT &&
      rr >= MIN_SETUP_RR;

    return {
      ...p,
      mid,
      atr,
      distancePct,
      sl: rawSL,
      tp: rawTP,
      rr,
      plannedHoldHours: Math.min(MAX_HOLD_PLAN_HOURS, MAX_AVG_HOLD),
      eligiblePlan: eligible,
      planReason:
        eligible
          ? "SOURCE_POSITION_NEAR_CURRENT_MARKET_AND_RR_VALID"
          : distancePct > MAX_ENTRY_DISTANCE_PCT
            ? "ENTRY_TOO_FAR_FROM_SOURCE_ENTRY"
            : "RR_BELOW_MINIMUM"
    };
  } catch (e) {
    return {
      ...p,
      eligiblePlan: false,
      planReason: `MARKET_DATA_ERROR: ${e.message}`
    };
  }
}

function fmtMoney(x) {
  if (!Number.isFinite(x)) return "N/A";
  return `${x >= 0 ? "+" : "-"}$${Math.abs(x).toLocaleString("en-US", {
    maximumFractionDigits: 2
  })}`;
}

function fmtNum(x, d = 4) {
  return Number.isFinite(x) ? x.toFixed(d) : "N/A";
}

function reason(m) {
  const parts = [];

  if (m.winRate >= MIN_WR) parts.push(`WR ${m.winRate.toFixed(1)}%≥${MIN_WR}%`);
  if (m.profitFactor === Infinity || m.profitFactor >= MIN_PF)
    parts.push(`PF ${m.profitFactor === Infinity ? "∞" : m.profitFactor.toFixed(2)}≥${MIN_PF}`);
  if (m.medianHoldHours <= MAX_MEDIAN_HOLD)
    parts.push(`Median ${m.medianHoldHours.toFixed(2)}h`);
  if (m.avgHoldHours <= MAX_AVG_HOLD)
    parts.push(`Avg ${m.avgHoldHours.toFixed(2)}h`);
  if (m.activeDays >= MIN_ACTIVE_DAYS)
    parts.push(`${m.activeDays}/7 active days`);
  if (m.pnl > 0) parts.push(`PnL ${fmtMoney(m.pnl)}`);

  return parts.join(" | ");
}

async function telegram(text) {
  const token = process.env.TELEGRAM_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chat) {
    console.log("[TELEGRAM] credentials missing");
    return;
  }

  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chat,
      text
    })
  });

  if (!r.ok) throw new Error(`Telegram ${r.status}`);
}

const end = Date.now();
const start = end - LOOKBACK_DAYS * 86400000;

console.log("[HUNTER V4][START]", {
  lookbackDays: LOOKBACK_DAYS,
  maxCandidates: MAX_CANDIDATES
});

const discovery = await discover();
const results = [];

for (let i = 0; i < discovery.pool.length; i++) {
  const address = discovery.pool[i];

  try {
    const fills = await fetchFills(address, start, end);
    const m = metrics(address, fills);
    results.push(m);
  } catch (e) {
    results.push({ address, error: e.message });
  }

  if ((i + 1) % 25 === 0) {
    console.log(`[SCAN] ${i + 1}/${discovery.pool.length}`);
  }
}

const scanned = results.filter(x => !x.error);
const passed = scanned.filter(passes);

passed.sort((a, b) => {
  if (b.winRate !== a.winRate) return b.winRate - a.winRate;
  if (b.profitFactor !== a.profitFactor)
    return (b.profitFactor === Infinity ? 1e9 : b.profitFactor) -
           (a.profitFactor === Infinity ? 1e9 : a.profitFactor);
  return b.pnl - a.pnl;
});

const plans = [];

for (const trader of passed.slice(0, 5)) {
  try {
    const p = await latestPosition(trader.address);
    plans.push({
      trader,
      position: p,
      selectionReason: reason(trader)
    });
  } catch (e) {
    plans.push({
      trader,
      position: null,
      selectionReason: reason(trader),
      error: e.message
    });
  }
}

const lines = [
  "🟣 HYPERLIQUID TRADER HUNTER V4",
  "📡 READ-ONLY | NO ORDERS",
  "━━━━━━━━━━━━━━━━━━",
  `🔎 Discovery: ${discovery.publicCount}`,
  `👥 Candidates: ${discovery.pool.length}/${MAX_CANDIDATES}`,
  `📊 Scanned: ${scanned.length}`,
  `✅ PASS: ${passed.length}`,
  "",
  "🏆 SELECTED TRADERS"
];

if (!passed.length) {
  lines.push("No trader currently satisfies all statistical filters.");
} else {
  for (let i = 0; i < plans.length; i++) {
    const x = plans[i].trader;
    const p = plans[i].position;

    lines.push(
      "",
      `#${i + 1} ${x.address.slice(0, 6)}…${x.address.slice(-4)}`,
      `📊 Trades ${x.closedTrades} | WR ${x.winRate.toFixed(1)}%`,
      `💰 7D PnL ${fmtMoney(x.pnl)} | PF ${x.profitFactor === Infinity ? "∞" : x.profitFactor.toFixed(2)}`,
      `⏱ Hold median ${x.medianHoldHours.toFixed(2)}h | avg ${x.avgHoldHours.toFixed(2)}h`,
      `📅 Active ${x.activeDays}/7 | ${x.tradesPerActiveDay.toFixed(1)} trades/active day`,
      `⚠️ Losing streak ${x.maxLosingStreak} | Liquidations ${x.liquidations}`,
      `🧠 WHY: ${plans[i].selectionReason}`
    );

    if (!p) {
      lines.push("📍 Position: NONE / unavailable");
      continue;
    }

    lines.push(
      `📍 Source: ${p.coin} ${p.side}`,
      `🎯 Source entry: ${fmtNum(p.entry, 6)}`,
      `💵 Current mid: ${fmtNum(p.mid, 6)}`,
      `📏 Entry distance: ${p.distancePct == null ? "N/A" : p.distancePct.toFixed(3) + "%"}`,
      `📐 Source leverage (info only): ${fmtNum(p.leverage, 2)}x`,
      `📈 Source uPnL: ${fmtMoney(p.unrealizedPnl)}`
    );

    if (p.sl && p.tp) {
      lines.push(
        `🛡 Planned SL: ${fmtNum(p.sl, 6)}`,
        `🎯 Planned TP: ${fmtNum(p.tp, 6)}`,
        `⚖️ Planned RR: ${p.rr.toFixed(2)}R`,
        `⏳ Planned max hold: ${p.plannedHoldHours.toFixed(1)}h`,
        `🚦 COPY PLAN: ${p.eligiblePlan ? "ELIGIBLE" : "BLOCKED"}`,
        `🔍 Plan reason: ${p.planReason}`
      );
    } else {
      lines.push(`🚦 COPY PLAN: BLOCKED | ${p.planReason}`);
    }
  }
}

lines.push(
  "",
  "ℹ️ TP/SL/Entry above are a read-only COPY PLAN, not source TP/SL and not executed.",
  `🕐 ${new Date().toISOString()}`
);

await telegram(lines.join("\n"));

await fs.mkdir("state", { recursive: true });
await fs.writeFile(
  STATE_FILE,
  JSON.stringify(
    {
      version: "V4",
      generatedAt: new Date().toISOString(),
      discovery,
      thresholds: {
        MIN_TRADES,
        MIN_WR,
        MIN_PNL,
        MIN_PF,
        MAX_MEDIAN_HOLD,
        MAX_AVG_HOLD,
        MIN_ACTIVE_DAYS,
        MAX_LOSING_STREAK,
        MAX_LIQUIDATIONS,
        MIN_SETUP_RR,
        MAX_ENTRY_DISTANCE_PCT,
        SL_ATR_MULT,
        TP_ATR_MULT,
        MAX_HOLD_PLAN_HOURS
      },
      selected: plans.map(x => ({
        trader: x.trader,
        position: x.position,
        selectionReason: x.selectionReason
      })),
      passed,
      results
    },
    null,
    2
  )
);

console.log(`[HUNTER V4][DONE] scanned=${scanned.length} pass=${passed.length}`);
