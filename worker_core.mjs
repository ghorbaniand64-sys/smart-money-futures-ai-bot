/*
╔══════════════════════════════════════════════════════════════════════════════╗
║ GMX SMART MONEY FUTURES AI BOT — V22.5 PURE 1H STRUCTURE CLEAN           ║
║ GMX universe → completed 1H candles → 1H reversal/continuation → Classic ║
║ GMX only • 20x leverage • 100% wallet • max 1 position • one TP + SL     ║
╚══════════════════════════════════════════════════════════════════════════════╝

ACTIVE SIGNAL PIPELINE:
  GMX MARKET UNIVERSE
    → 1H OHLCV ONLY
    → COMPLETED 1H CANDLE STRUCTURE
    → REVERSAL or CONTINUATION
    → RR ≥ 1.50 + location/late-entry checks
    → ECONOMIC GATE
    → CLASSIC GMX ON-CHAIN EXECUTION
    → POSITION VERIFICATION
    → TELEGRAM

1H RULES:
  • Reversal SHORT: 1H uptrend → resistance reaction/rejection → short.
    SL above reaction high; TP before the next valid support.
  • Reversal LONG: 1H downtrend → support reaction/rejection → long.
    SL below reaction low; TP before the next valid resistance.
  • Continuation LONG: 1H uptrend → strong 1H resistance break → long.
    SL below broken resistance; TP before the next resistance.
  • Continuation SHORT: 1H downtrend → strong 1H support break → short.
    SL above broken support; TP before the next support.
  • Late entries are rejected.
  • Only completed 1H candles create the signal. Lower timeframes are not
    used for signal authority, entry, SL, TP, direction, or timing.

EXECUTION:
  • Direct on-chain Classic GMX only.
  • Existing execution/allowance/verification path is preserved.
  • EXECUTION_ENABLED remains the emergency OFF switch.
*/

import { createRequire } from "node:module";
import { promises as fs } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);

export const BOT_VERSION = "V22.5.0-1H-STRUCTURE-CLEAN";
export const BOT_BUILD = BOT_VERSION;

const CHAIN_ID = 42161;
const ZERO = 0n;
const USD30 = 10n ** 30n;
const USDC6 = 10n ** 6n;

const CONFIG = Object.freeze({
  chainId: CHAIN_ID,
  cronRecommended: "* * * * *",

  maxPositions: 1,
  walletAllocationPerPosition: 1.00,
  maxTotalWalletAllocation: 1.00,
  leverage: 20,


  contextLimit: 96,
  finalCandidates: 1,

  // V20.3: score ranks quality; trigger confidence controls timing.
  minScore: 68,
  minEdge: 8,
  reversalTriggerMinConfidence: 52,
  continuationTriggerMinConfidence: 52,
  setupDominanceMargin: 6,

  // Early-trend timing: prefer the first expansion/breakout phase over late confirmation.

  minTpDistancePct: 0.30,

  // V21.6 Dynamic structure-based stop loss. The stop is derived from the
  // nearest structural swing/support/resistance plus an ATR volatility buffer.
  // Reversal trades use a tighter invalidation; continuation trades get a bit
  // more room. The stop must remain comfortably before the theoretical
  // liquidation zone; a trade with an excessive stop distance is rejected.
  stopLossEnabled: true,
  slAtrMultiplierReversal: 0.45,
  slAtrMultiplierContinuation: 0.65,
  slMinDistancePct: 0.35,
  slMaxDistancePct: 1.80,
  slCounterTrendMaxDistancePct: 1.25,
  slSafetyBufferPct: 0.35,

  // V22.0 Structure-first trade plan. Entry/SL/TP are derived from the
  // same 5M structural zone that created the setup. Score only ranks the
  // already-valid structure; it no longer manufactures a trade location.
  structureEntryMaxDistancePct: 0.85,
  structureEntryMaxAtr: 1.15,
  structureEntryBufferPct: 0.08,
  structureStopBufferAtr: 0.20,
  structureStopBufferPct: 0.08,
  structureTpBufferAtr: 0.15,
  structureTpBufferPct: 0.08,
  structureMinRR: 1.50,
  structureRequireVolume: true,
  structureMinVolumeRatio5m: 1.25,
  structureMinVolumeRatio15m: 1.25,
  structureRequireFlow: true,
  structureMinSmartMoneyProxy: 55,
  structureFlowDirectionRequired: true,
  structureRequireOpposingTarget: true,

  // V22.2: active trade timing is based on completed 1H structure.
  hourlyStructureMaxEntryDistancePct: 0.85,
  hourlyStructureMaxEntryAtr: 1.15,
  hourlyReversalLookback: 12,
  hourlyRejectionAtrTolerance: 0.25,
  hourlyRejectionMinWickRatio: 0.30,
  hourlyRejectionMinBodyRatio: 0.35,
  hourlyTrendMinMovePct: 0.60,
  hourlyTrendLookback: 12,
  hourlyBreakBodyRatio: 0.60,
  hourlyBreakCloseLocationLong: 0.72,
  hourlyBreakCloseLocationShort: 0.28,
  hourlyBreakAtrMultiplier: 1.00,
  hourlyBreakLevelAtrBuffer: 0.10,

  // V21 Capital Flow Engine. Flow is a quality/ranking layer, not a hard
  // direction gate. True wallet-labelled smart-money data is not available
  // from GMX market snapshots, so smart-money is represented as a market-flow
  // proxy using price/OI/side-OI/volume response.
  capitalFlowEnabled: true,
  capitalFlowWeight: 0.34,
  capitalFlowMinScore: 55,
  volumeExpansionMinRatio: 1.25,
  oiExpansionMinPct: 0.50,
  flowLookback: 24,
  volumeProfileLookback: 72,
  volumeProfileBuckets: 24,
  volumeProfileValueAreaPct: 0.70,
  capitalFlowStatePersistMs: 30 * 60 * 1000,


  // V21.4: continuation must be early or retested; never chase the final
  // leg of an already-extended impulse. Trend-end exhaustion is a no-trade
  // state until a real reversal trigger appears.
  continuationMaxExtensionPct: 1.35,
  continuationMaxMove5Pct: 1.60,
  continuationMaxMove15Pct: 2.40,
  continuationMaxDistanceEmaAtr: 2.20,
  continuationRetestLookback: 3,
  continuationRetestAtr: 0.55,
  trendEndRsiLong: 24,
  trendEndRsiShort: 76,
  trendEndAtrDistance: 2.00,
  trendEndRangeExpansion: 1.45,
  trendEndVolumeRatio: 1.45,
  trendEndMinSignals: 2,

  // V21.7: move-maturity filter. The bot is optimized for the FIRST
  // actionable part of a sharp move, not for joining an already mature
  // impulse. This filter is intentionally applied to CONTINUATION entries;
  // confirmed REVERSAL entries may occur after a large prior move because
  // that prior move is the setup itself.
  moveMaturityEarlyPct: 0.45,
  moveMaturityHealthyPct: 0.85,
  moveMaturityLatePct: 1.35,
  moveMaturityExhaustedPct: 2.00,
  moveMaturityAtrHealthy: 1.25,
  moveMaturityAtrLate: 1.90,
  moveMaturityRejectScore: 70,
  moveMaturitySoftRejectScore: 60,
  moveMaturitySoftRejectDeceleration: 0,

  // V21.5: protect the data pipeline from burst/rate-limit failures introduced
  // by the BTC/ETH market-data center. Never let macro intelligence starve
  // the individual-market deep scan.
  deepDataRetryCount: 2,
  deepDataRetryDelayMs: 450,
  allowOneHtfFallback: true,

  // Economic gate: estimates round-trip position fees plus a conservative
  // execution-cost buffer. This is deliberately NOT a minimum-notional gate.
  // A trade is allowed only when the actual wallet size + realistic TP imply
  // enough expected net profit to justify the GMX execution overhead.
  positionFeeBpsPerSide: 6,
  executionCostBufferUsd: 0.75,
  fundingBorrowBufferUsd: 0.15,
  minExpectedNetUsd: 1.00,
  minNetToCostRatio: 1.50,

  ohlcvConcurrency: 8,
  telegramMaxPerCycle: 8,
  telegramEnabled: true,

  stateDir: "state",
  stateFile: "state/bot_state.json",
  cacheFile: "state/gmx_cache.json",

  executionEnabledDefault: true,

  newsTimeoutMs: 5000,
  xTimeoutMs: 5000,
  intelligenceCacheMs: 60_000,
});

let SDK = null;
let SDK_LOAD_ERROR = null;

const TELEGRAM_BUDGET = new WeakMap();
const MEMORY_CACHE = new Map();

function safeError(error) {
  return error?.message || String(error || "Unknown error");
}

function safeJson(value) {
  return JSON.stringify(value, (_, v) => {
    if (typeof v === "bigint") return v.toString();
    return v;
  });
}

function num(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "bigint") {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function pct(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return 0;
  return ((a - b) / b) * 100;
}

function humanUsd30(value) {
  const n = num(value);
  if (!Number.isFinite(n)) return 0;
  if (typeof value === "bigint") return Number(value) / 1e30;
  if (Math.abs(n) > 1e12) return n / 1e30;
  return n;
}

function toUnits(value, decimals) {
  const s = String(value);
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`Invalid decimal value: ${value}`);
  const [whole, fraction = ""] = s.split(".");
  const f = (fraction + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole) * (10n ** BigInt(decimals)) + BigInt(f || "0");
}

function fromUnits(value, decimals) {
  const n = typeof value === "bigint" ? value : BigInt(value || 0);
  const base = 10n ** BigInt(decimals);
  const whole = n / base;
  const fraction = (n % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}

function formatPrice(value) {
  const n = num(value);
  if (!Number.isFinite(n) || n <= 0) return "N/A";
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 8 });
}

function formatUsd(value) {
  return `$${num(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })}`;
}

function normalizeAsset(value) {
  let s = String(value || "").trim().toUpperCase();
  s = s.replace(/\[.*?\]/g, "");
  s = s.replace(/\b(USD|USDC|USDT|PERP)\b/g, "");
  s = s.replace(/[^A-Z0-9]/g, "");
  return s;
}

function marketDisplaySymbol(market) {
  return String(
    market?.symbol ||
    market?.name ||
    market?.marketSymbol ||
    market?.ticker ||
    market?.indexName ||
    market?.indexTokenSymbol ||
    ""
  ).trim();
}

function candleSymbolFromMarket(market) {
  const raw = marketDisplaySymbol(market);
  const base = raw.split("[")[0].trim();
  if (base.includes("/")) return base;
  const asset = normalizeAsset(raw);
  return asset ? `${asset}/USD` : raw;
}

function isLikelyPerpMarket(market) {
  if (!market || market.isSpotOnly === true) return false;
  if (market.isListed === false) return false;
  const raw = safeJson(market).toUpperCase();
  if (raw.includes('"ISSPOTONLY":TRUE')) return false;
  return Boolean(marketDisplaySymbol(market));
}

function findFirst(obj, predicate, depth = 0, seen = new Set()) {
  if (obj === null || obj === undefined || depth > 7) return undefined;
  if (typeof obj !== "object") return undefined;
  if (seen.has(obj)) return undefined;
  seen.add(obj);

  if (predicate(obj)) return obj;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findFirst(item, predicate, depth + 1, seen);
      if (found !== undefined) return found;
    }
  } else {
    for (const value of Object.values(obj)) {
      const found = findFirst(value, predicate, depth + 1, seen);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function collectObjects(obj, predicate, out = [], depth = 0, seen = new Set()) {
  if (obj === null || obj === undefined || depth > 7) return out;
  if (typeof obj !== "object" || seen.has(obj)) return out;
  seen.add(obj);

  if (predicate(obj)) out.push(obj);
  if (Array.isArray(obj)) {
    for (const item of obj) collectObjects(item, predicate, out, depth + 1, seen);
  } else {
    for (const value of Object.values(obj)) collectObjects(value, predicate, out, depth + 1, seen);
  }
  return out;
}

async function loadGmxSdk() {
  if (SDK) return SDK;
  try {
    const v2 = require("@gmx-io/sdk/v2");
    const chains = require("@gmx-io/sdk/configs/chains");
    SDK = {
      GmxApiSdk: v2?.GmxApiSdk,
      PrivateKeySigner: v2?.PrivateKeySigner,
      getViemChain: chains?.getViemChain,
    };
    if (!SDK.GmxApiSdk || !SDK.PrivateKeySigner || !SDK.getViemChain) {
      throw new Error("GMX_SDK_REQUIRED_EXPORTS_UNAVAILABLE");
    }
    SDK_LOAD_ERROR = null;
    console.log("[SDK][LOAD]", {
      ok: true,
      mode: "COMMONJS_REQUIRE",
      version: BOT_VERSION,
    });
    return SDK;
  } catch (error) {
    SDK_LOAD_ERROR = safeError(error);
    console.error("[SDK][LOAD_ERROR]", SDK_LOAD_ERROR);
    throw error;
  }
}

function executionEnabled(env) {
  const raw = env?.EXECUTION_ENABLED;
  if (raw === undefined || raw === null || raw === "") return CONFIG.executionEnabledDefault;
  return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
}

function accountFromEnv(env, signer) {
  return String(env?.GMX_ACCOUNT || signer?.address || "").trim();
}

async function createRuntime(env) {
  const sdkLib = await loadGmxSdk();
  const sdk = new sdkLib.GmxApiSdk({ chainId: CHAIN_ID });

  if (!env?.GMX_PRIVATE_KEY) {
    throw new Error("GMX_PRIVATE_KEY is missing");
  }
  if (!env?.ARBITRUM_RPC) {
    throw new Error("ARBITRUM_RPC is missing");
  }

  const chain = sdkLib.getViemChain(CHAIN_ID);
  const signer = new sdkLib.PrivateKeySigner(env.GMX_PRIVATE_KEY, {
    rpcUrl: env.ARBITRUM_RPC,
    chain,
  });
  const account = accountFromEnv(env, signer);

  return { sdk, signer, account };
}

async function ensureStateDir() {
  await fs.mkdir(CONFIG.stateDir, { recursive: true });
}

async function readJsonFile(path, fallback) {
  try {
    return JSON.parse(await fs.readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJsonFile(path, value) {
  await ensureStateDir();
  const tmp = `${path}.tmp`;
  await fs.writeFile(tmp, safeJson(value), "utf8");
  await fs.rename(tmp, path);
}

async function loadState() {
  const state = await readJsonFile(CONFIG.stateFile, {
    version: BOT_VERSION,
    updatedAt: 0,
    scans: 0,
    lastScanId: null,
    lastExecution: null,
    executionHistory: [],
    marketSnapshots: {},
  });
  if (!Array.isArray(state.executionHistory)) state.executionHistory = [];
  if (!state.marketSnapshots || typeof state.marketSnapshots !== "object") state.marketSnapshots = {};
  return state;
}

async function saveState(state) {
  state.version = BOT_VERSION;
  state.updatedAt = Date.now();
  state.executionHistory = state.executionHistory.slice(-100);
  await writeJsonFile(CONFIG.stateFile, state);
}

function telegramBudget(env) {
  let b = TELEGRAM_BUDGET.get(env);
  if (!b) {
    b = { remaining: CONFIG.telegramMaxPerCycle };
    TELEGRAM_BUDGET.set(env, b);
  }
  return b;
}

async function sendTelegram(env, message) {
  if (!CONFIG.telegramEnabled) return { ok: false, reason: "DISABLED" };
  if (!env?.TELEGRAM_TOKEN || !env?.TELEGRAM_CHAT_ID) {
    return { ok: false, reason: "TELEGRAM_CONFIG_MISSING" };
  }
  const budget = telegramBudget(env);
  if (budget.remaining <= 0) return { ok: false, reason: "TELEGRAM_BUDGET" };
  budget.remaining--;

  const url = `https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text: String(message),
        disable_web_page_preview: true,
      }),
    });
    const body = await response.text();
    if (!response.ok) return { ok: false, reason: `HTTP_${response.status}`, body };
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: safeError(error) };
  }
}

function findTicker(tickers, market) {
  const wanted = marketDisplaySymbol(market).toUpperCase();
  const asset = normalizeAsset(wanted);
  return (tickers || []).find((ticker) => {
    const text = String(
      ticker?.symbol ||
      ticker?.name ||
      ticker?.marketSymbol ||
      ticker?.indexName ||
      ticker?.indexTokenSymbol ||
      ""
    ).toUpperCase();
    return text === wanted || normalizeAsset(text) === asset;
  }) || null;
}

function tickerPrice(ticker) {
  const raw = ticker?.markPrice ?? ticker?.maxPrice ?? ticker?.minPrice ?? ticker?.price ?? ticker?.indexPrice ?? ticker?.lastPrice;
  return humanUsd30(raw);
}

function tickerChange5m(ticker) {
  return num(
    ticker?.priceChange5mPercent ??
    ticker?.change5mPercent ??
    ticker?.priceChange5m ??
    ticker?.change5m
  );
}

function tickerVolume(ticker) {
  return num(
    ticker?.volume24h ??
    ticker?.volumeUsd24h ??
    ticker?.volume ??
    ticker?.dailyVolume
  );
}

function tickerOpenInterest(ticker) {
  return num(
    ticker?.openInterest ??
    ticker?.openInterestUsd ??
    ticker?.oi ??
    ticker?.openInterestValue
  );
}

function tickerFunding(ticker) {
  return num(
    ticker?.fundingRate ??
    ticker?.fundingRatePerHour ??
    ticker?.funding
  );
}

function marketLiquidity(market) {
  return num(
    market?.liquidityUsd ??
    market?.openInterestCap ??
    market?.maxOpenInterest ??
    market?.longOpenInterestCap ??
    market?.shortOpenInterestCap
  );
}

function candleClose(c) {
  return num(c?.close ?? c?.c ?? c?.[4]);
}
function candleOpen(c) {
  return num(c?.open ?? c?.o ?? c?.[1]);
}
function candleHigh(c) {
  return num(c?.high ?? c?.h ?? c?.[2]);
}
function candleLow(c) {
  return num(c?.low ?? c?.l ?? c?.[3]);
}

function cleanCandles(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((c) => ({
      timestamp: num(c?.timestamp ?? c?.time ?? c?.t ?? c?.[0]),
      open: candleOpen(c),
      high: candleHigh(c),
      low: candleLow(c),
      close: candleClose(c),
      volume: num(c?.volume ?? c?.v ?? c?.[5], 0),
    }))
    .filter((c) => c.open > 0 && c.high > 0 && c.low > 0 && c.close > 0)
    .sort((a, b) => a.timestamp - b.timestamp);
}

function ema(values, period) {
  if (!values.length) return 0;
  const k = 2 / (period + 1);
  let e = values[0];
  for (let i = 1; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

function sma(values, period) {
  if (!values.length) return 0;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

function rsi(values, period = 14) {
  if (values.length <= period) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gains += d;
    else losses -= d;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

function atr(candles, period = 14) {
  if (candles.length < 2) return 0;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  return sma(trs, period);
}

function macd(values) {
  const fast = ema(values, 12);
  const slow = ema(values, 26);
  const line = fast - slow;
  const historical = [];
  for (let i = Math.max(0, values.length - 40); i < values.length; i++) {
    const f = ema(values.slice(0, i + 1), 12);
    const s = ema(values.slice(0, i + 1), 26);
    historical.push(f - s);
  }
  return { line, signal: ema(historical, 9), histogram: line - ema(historical, 9) };
}

function adx(candles, period = 14) {
  if (candles.length < period + 2) return 0;
  const tr = [];
  const plus = [];
  const minus = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    tr.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
    const up = c.high - p.high;
    const down = p.low - c.low;
    plus.push(up > down && up > 0 ? up : 0);
    minus.push(down > up && down > 0 ? down : 0);
  }
  const atrValue = sma(tr, period);
  if (atrValue <= 0) return 0;
  const pdi = 100 * sma(plus, period) / atrValue;
  const mdi = 100 * sma(minus, period) / atrValue;
  if (pdi + mdi === 0) return 0;
  return 100 * Math.abs(pdi - mdi) / (pdi + mdi);
}

function recentSwingLevels(candles) {
  const recent = candles.slice(-60);
  const highs = [];
  const lows = [];
  for (let i = 2; i < recent.length - 2; i++) {
    if (
      recent[i].high >= recent[i - 1].high &&
      recent[i].high >= recent[i - 2].high &&
      recent[i].high >= recent[i + 1].high &&
      recent[i].high >= recent[i + 2].high
    ) highs.push(recent[i].high);
    if (
      recent[i].low <= recent[i - 1].low &&
      recent[i].low <= recent[i - 2].low &&
      recent[i].low <= recent[i + 1].low &&
      recent[i].low <= recent[i + 2].low
    ) lows.push(recent[i].low);
  }
  return {
    resistance: [...new Set(highs.map((x) => Number(x.toPrecision(12))))].sort((a, b) => a - b),
    support: [...new Set(lows.map((x) => Number(x.toPrecision(12))))].sort((a, b) => a - b),
  };
}

function reactionScore(candles, direction) {
  if (candles.length < 8) return { score: 0, evidence: 0 };
  const recent = candles.slice(-8);
  const a = recent[recent.length - 1];
  const body = Math.abs(a.close - a.open);
  const range = Math.max(a.high - a.low, 1e-12);
  const upperWick = a.high - Math.max(a.open, a.close);
  const lowerWick = Math.min(a.open, a.close) - a.low;

  let score = 0;
  let evidence = 0;

  if (direction === "long") {
    if (lowerWick / range >= 0.30) { score += 12; evidence++; }
    if (a.close > a.open) { score += 8; evidence++; }
    if (a.close > recent[0].close) { score += 8; evidence++; }
    if (body / range >= 0.45) { score += 6; evidence++; }
  } else {
    if (upperWick / range >= 0.30) { score += 12; evidence++; }
    if (a.close < a.open) { score += 8; evidence++; }
    if (a.close < recent[0].close) { score += 8; evidence++; }
    if (body / range >= 0.45) { score += 6; evidence++; }
  }
  return { score: Math.min(34, score), evidence };
}

function numericFieldByKeys(obj, keys) {
  for (const key of keys) {
    const value = num(obj?.[key], NaN);
    if (Number.isFinite(value) && value !== 0) return value;
  }
  return 0;
}

function extractSideOpenInterest(source) {
  const o = source || {};
  const longA = numericFieldByKeys(o, ["longInterestUsdUsingLongToken", "longInterestUsdUsingShortToken"]);
  const shortA = numericFieldByKeys(o, ["shortInterestUsdUsingLongToken", "shortInterestUsdUsingShortToken"]);
  const longB = numericFieldByKeys(o, ["longOpenInterest", "longOpenInterestUsd", "longOi", "longOI", "longInterestUsd"]);
  const shortB = numericFieldByKeys(o, ["shortOpenInterest", "shortOpenInterestUsd", "shortOi", "shortOI", "shortInterestUsd"]);
  return { longOi: longA || longB, shortOi: shortA || shortB };
}

function marketFlowSnapshot(ticker, marketValue, previous) {
  const source = { ...(ticker || {}), ...(marketValue || {}) };
  const oi = tickerOpenInterest(source);
  const sides = extractSideOpenInterest(source);
  const volume24h = tickerVolume(source);
  const price = tickerPrice(source);
  const prevOi = num(previous?.openInterest);
  const prevVolume = num(previous?.volume24h);
  const prevPrice = num(previous?.price);
  const oiDeltaPct = prevOi > 0 ? pct(oi, prevOi) : 0;
  const volumeDeltaPct = prevVolume > 0 ? pct(volume24h, prevVolume) : 0;
  const priceDeltaPct = prevPrice > 0 ? pct(price, prevPrice) : tickerChange5m(source);
  const total = sides.longOi + sides.shortOi;
  const longShare = total > 0 ? sides.longOi / total : 0.5;
  const shortShare = total > 0 ? sides.shortOi / total : 0.5;
  const sideBias = (longShare - shortShare) * 100;
  let smartMoneyProxy = 50;
  let flowState = "NEUTRAL";
  let flowDirection = priceDeltaPct >= 0 ? "long" : "short";
  const evidence = [];

  if (priceDeltaPct > 0 && oiDeltaPct > 0) {
    smartMoneyProxy += 18; flowState = "ACCUMULATION_BUILD"; flowDirection = "long"; evidence.push("PRICE_UP_OI_UP");
  } else if (priceDeltaPct < 0 && oiDeltaPct > 0) {
    smartMoneyProxy += 18; flowState = "DISTRIBUTION_SHORT_BUILD"; flowDirection = "short"; evidence.push("PRICE_DOWN_OI_UP");
  } else if (priceDeltaPct > 0 && oiDeltaPct < 0) {
    smartMoneyProxy -= 4; flowState = "SHORT_COVERING"; flowDirection = "long"; evidence.push("PRICE_UP_OI_DOWN");
  } else if (priceDeltaPct < 0 && oiDeltaPct < 0) {
    smartMoneyProxy -= 4; flowState = "LONG_UNWIND"; flowDirection = "short"; evidence.push("PRICE_DOWN_OI_DOWN");
  }
  if (Math.abs(volumeDeltaPct) >= 5) { smartMoneyProxy += 8; evidence.push("VOLUME_FLOW_EXPANDING"); }
  if (sides.longOi > 0 && sides.shortOi > 0) {
    if (flowDirection === "long" && sideBias >= 8) { smartMoneyProxy += 10; evidence.push("LONG_OI_DOMINANT"); }
    if (flowDirection === "short" && sideBias <= -8) { smartMoneyProxy += 10; evidence.push("SHORT_OI_DOMINANT"); }
    if (flowDirection === "long" && sideBias <= -12) { smartMoneyProxy -= 8; evidence.push("SHORT_OI_AGAINST_LONG"); }
    if (flowDirection === "short" && sideBias >= 12) { smartMoneyProxy -= 8; evidence.push("LONG_OI_AGAINST_SHORT"); }
  }
  return {
    price, openInterest: oi, volume24h,
    oiDeltaPct: Number(oiDeltaPct.toFixed(3)), volumeDeltaPct: Number(volumeDeltaPct.toFixed(3)), priceDeltaPct: Number(priceDeltaPct.toFixed(3)),
    longOi: sides.longOi, shortOi: sides.shortOi, longShare: Number(longShare.toFixed(4)), shortShare: Number(shortShare.toFixed(4)), sideBias: Number(sideBias.toFixed(2)),
    smartMoneyProxy: Number(clamp(smartMoneyProxy, 0, 100).toFixed(1)), flowState, flowDirection, evidence,
  };
}

function stochastic(candles, kPeriod = 14, dPeriod = 3) {
  const rows = Array.isArray(candles) ? candles : [];
  if (rows.length < kPeriod) return { k: 50, d: 50, available: false };
  const ks = [];
  for (let i = kPeriod - 1; i < rows.length; i++) {
    const w = rows.slice(i - kPeriod + 1, i + 1);
    const hi = Math.max(...w.map(x => num(x.high)));
    const lo = Math.min(...w.map(x => num(x.low)));
    const close = num(rows[i].close);
    ks.push(hi > lo ? ((close - lo) / (hi - lo)) * 100 : 50);
  }
  const k = ks.at(-1) ?? 50;
  const d = sma(ks.slice(-dPeriod), dPeriod);
  return { k, d, available: true, history: ks };
}

function ichimoku(candles, conversionPeriod = 9, basePeriod = 26, spanPeriod = 52) {
  const rows = Array.isArray(candles) ? candles : [];
  if (rows.length < spanPeriod) return { available: false, conversion: 0, base: 0, spanA: 0, spanB: 0, cloudTop: 0, cloudBottom: 0 };
  const mid = (period) => {
    const w = rows.slice(-period);
    const hi = Math.max(...w.map(x => num(x.high)));
    const lo = Math.min(...w.map(x => num(x.low)));
    return (hi + lo) / 2;
  };
  const conversion = mid(conversionPeriod);
  const base = mid(basePeriod);
  const spanA = (conversion + base) / 2;
  const spanB = mid(spanPeriod);
  const cloudTop = Math.max(spanA, spanB);
  const cloudBottom = Math.min(spanA, spanB);
  const price = num(rows.at(-1)?.close);
  return {
    available: true, conversion, base, spanA, spanB, cloudTop, cloudBottom,
    bullish: price > cloudTop && conversion > base,
    bearish: price < cloudBottom && conversion < base,
    inCloud: price >= cloudBottom && price <= cloudTop,
  };
}

function scoreCandidate({ market, ticker, marketValue, previousSnapshot, candles1h }) {
  // V22.3: PURE 1H ENGINE. Only completed 1H candles define the trade.
  // No 5M/15M/4H/1D indicator, timing rule, direction gate, SL, TP or macro gate
  // participates in signal generation.
  const h1 = Array.isArray(candles1h) ? candles1h : [];
  const completed = h1.slice(0, -1);
  const price = tickerPrice(ticker) || num(completed.at(-1)?.close);
  if (!(price > 0)) return {
    symbol: marketDisplaySymbol(market), candleSymbol: candleSymbolFromMarket(market),
    direction: null, entry: 0, tp: 0, sl: 0, score: 0, edge: 0, risk: 0,
    trendConfluence: 0, setupType: 'NONE', reversalEvidence: 0,
    setupConfidence: 0, reversalConfidence: 0, continuationConfidence: 0,
    setupDominance: 0, triggerActive: false, reversalTrigger: false, continuationTrigger: false,
    tpPlan: { tp:0, method:'1H_INVALID', targetType:'1H_STRUCTURE' },
    setupEvidence: { structurePlanValid:false, structurePlanReason:'INVALID_1H_PRICE' },
    reasons: ['INVALID_1H_PRICE'], indicators: {}, market, ticker, marketValue, candles1h:h1,
  };

  const plans = [
    { setupType:'REVERSAL', direction:'long', plan:calculateHourlyReversalTradePlan({direction:'long',price,candles1h:h1}) },
    { setupType:'REVERSAL', direction:'short', plan:calculateHourlyReversalTradePlan({direction:'short',price,candles1h:h1}) },
    { setupType:'CONTINUATION', direction:'long', plan:calculateHourlyContinuationTradePlan({direction:'long',price,candles1h:h1}) },
    { setupType:'CONTINUATION', direction:'short', plan:calculateHourlyContinuationTradePlan({direction:'short',price,candles1h:h1}) },
  ];
  const valid = plans.filter(x => x.plan?.valid === true).sort((a,b) =>
    (num(b.plan.rr)-num(a.plan.rr)) || (num(a.plan.entryDistancePct)-num(b.plan.entryDistancePct))
  );

  const last = completed.at(-1) || {};
  const lookback = Math.max(2, Number(CONFIG.hourlyTrendLookback || 12));
  const base = completed.at(Math.max(0, completed.length - 1 - lookback));
  const trendMove = base ? pct(num(last.close),num(base.close)) : 0;
  const range = Math.max(num(last.high)-num(last.low),1e-12);
  const bodyRatio = Math.abs(num(last.close)-num(last.open))/range;
  const closeLocation = (num(last.close)-num(last.low))/range;
  const bullish = num(last.close)>num(last.open);
  const bearish = num(last.close)<num(last.open);
  const levels = recentSwingLevels(completed.slice(0,-1));
  const support = (levels.support||[]).filter(x=>x<price).sort((a,b)=>b-a)[0]||0;
  const resistance = (levels.resistance||[]).filter(x=>x>price).sort((a,b)=>a-b)[0]||0;

  let chosen = valid[0] || null;
  let setupType = chosen?.setupType || 'NONE';
  let direction = chosen?.direction || (trendMove>=Number(CONFIG.hourlyTrendMinMovePct||0.60)?'long':trendMove<=-Number(CONFIG.hourlyTrendMinMovePct||0.60)?'short':bullish?'long':bearish?'short':null);
  let plan = chosen?.plan || null;

  if (!chosen && direction) {
    const candidates = plans.filter(x=>x.direction===direction).sort((a,b)=>
      Math.abs(price-(num(a.plan.anchorPrice)||price))-Math.abs(price-(num(b.plan.anchorPrice)||price))
    );
    const watch = candidates[0];
    if (watch) { setupType = watch.setupType + '_WATCH'; plan = watch.plan; }
  }

  const validPlan = Boolean(plan?.valid);
  const rr = num(plan?.rr);
  const distancePct = num(plan?.entryDistancePct);
  const distanceAtr = num(plan?.entryDistanceAtr);
  const score = validPlan ? clamp(82 + Math.min(14,rr*6) - Math.min(10,distancePct*4),0,100) : clamp(35 + Math.min(25,Math.abs(trendMove)*8) + (bodyRatio>=0.60?8:0),0,100);
  const edge = validPlan ? clamp(25 + rr*10 + Math.max(0,1.15-distanceAtr)*10,0,100) : clamp(8 + Math.abs(trendMove)*5,0,100);
  const risk = validPlan ? clamp(num(plan.riskPct)*20,0,100) : 0;
  const reason = plan?.reason || 'NO_1H_SIGNAL';
  const evidence = {
    setupType, direction, reactionTimeframe:plan?.reactionTimeframe||null,
    breakoutTimeframe:plan?.breakoutTimeframe||null, targetTimeframe:'1H',
    hourlyStructureReason:reason, structurePlanValid:validPlan, structurePlanReason:reason,
    structureAnchor:plan?.anchor||null, structureAnchorPrice:num(plan?.anchorPrice),
    structureTarget:plan?.target||null, structureTargetPrice:num(plan?.targetPrice),
    structureEntryDistancePct:distancePct, structureEntryDistanceAtr:distanceAtr,
    structureRR:rr, structureRewardPct:num(plan?.rewardPct), structureRiskPct:num(plan?.riskPct),
    sl:num(plan?.sl), slDistancePct:num(plan?.riskPct), slMethod:plan?.slPlan?.method||null,
    slValid:Boolean(plan?.slPlan?.valid), tpMethod:plan?.tpPlan?.method||null,
    tpTargetType:plan?.tpPlan?.targetType||null, tpDistancePct:num(plan?.rewardPct),
    hourlyTrendMovePct:trendMove, hourlyLastCandleBodyRatio:bodyRatio,
    hourlyLastCandleCloseLocation:closeLocation, hourlyLastCandleBullish:bullish,
    hourlyLastCandleBearish:bearish, hourlyLevels:{support,resistance},
    fiveLayers:null, marketRegime:null,
  };
  return {
    symbol:marketDisplaySymbol(market), candleSymbol:candleSymbolFromMarket(market), direction,
    entry:price, tp:num(plan?.tp), sl:num(plan?.sl), score:Number(score.toFixed(2)),
    edge:Number(edge.toFixed(2)), risk:Number(risk.toFixed(2)), trendConfluence:Math.abs(trendMove),
    setupType, reversalEvidence:setupType.startsWith('REVERSAL')&&validPlan?3:0,
    setupConfidence:Number(score.toFixed(1)), reversalConfidence:setupType.startsWith('REVERSAL')?Number(score.toFixed(1)):0,
    continuationConfidence:setupType.startsWith('CONTINUATION')?Number(score.toFixed(1)):0,
    setupDominance:0, triggerActive:setupType==='REVERSAL'||setupType==='CONTINUATION',
    reversalTrigger:setupType==='REVERSAL', continuationTrigger:setupType==='CONTINUATION',
    tpPlan:plan?.tpPlan||{tp:0,method:'1H_INVALID',targetType:'1H_STRUCTURE'},
    setupEvidence:evidence, reasons:[reason],
    indicators:{price,hourlyTrendMovePct:trendMove,hourlyBodyRatio:bodyRatio,hourlyCloseLocation:closeLocation,
      hourlyAtr:Math.max(num(atr(completed,14)),price*0.001,1e-12),structurePlanValid:validPlan,
      structurePlanReason:reason,structureAnchorPrice:num(plan?.anchorPrice),structureTargetPrice:num(plan?.targetPrice),
      structureEntryDistancePct:distancePct,structureEntryDistanceAtr:distanceAtr,structureRR:rr,
      volume24h:tickerVolume(ticker),openInterest:tickerOpenInterest(ticker),fundingRate:tickerFunding(ticker),liquidity:marketLiquidity(market)},
    market,ticker,marketValue,candles1h:h1,candles5:[],candles15:[]
  };
}

function calculateHourlyReversalTradePlan({ direction, price, candles1h }) {
  const entry=num(price), c=Array.isArray(candles1h)?candles1h.slice(0,-1):[];
  const fail=(reason,extra={})=>({valid:false,reason,entry,tp:0,sl:0,anchorPrice:0,targetPrice:0,entryDistancePct:0,entryDistanceAtr:0,riskPct:0,rewardPct:0,rr:0,reactionTimeframe:"1H",slPlan:{sl:0,distancePct:0,method:"HOURLY_REVERSAL_INVALID",valid:false},tpPlan:{tp:0,targetPrice:0,targetType:"1H_STRUCTURE",method:"HOURLY_REVERSAL_INVALID",distancePct:0},...extra});
  if(!(entry>0)) return fail("INVALID_ENTRY");
  if(c.length<24) return fail("INSUFFICIENT_1H_DATA");
  const last=c.at(-1), prev=c.at(-2), atr1=Math.max(num(atr(c,14)),entry*0.001,1e-12);
  const base=c.at(Math.max(0,c.length-1-(Number(CONFIG.hourlyReversalLookback)||12)));
  const trendMove=base?pct(num(last.close),num(base.close)):0;
  const levels=recentSwingLevels(c.slice(0,-1));
  const tol=atr1*Number(CONFIG.hourlyRejectionAtrTolerance||0.25), range=Math.max(num(last.high)-num(last.low),1e-12);
  const bodyRatio=Math.abs(num(last.close)-num(last.open))/range;
  const upper=(num(last.high)-Math.max(num(last.open),num(last.close)))/range;
  const lower=(Math.min(num(last.open),num(last.close))-num(last.low))/range;
  const bodyMin=Number(CONFIG.hourlyRejectionMinBodyRatio||0.35), wickMin=Number(CONFIG.hourlyRejectionMinWickRatio||0.30);
  if(direction==="short") {
    const rs=(levels.resistance||[]).filter(x=>x>0&&Math.abs(num(last.high)-x)<=tol).sort((a,b)=>b-a)[0]||0;
    if(!(rs>0)||!(trendMove>=Number(CONFIG.hourlyTrendMinMovePct||0.60))||!(num(last.close)<num(last.open)&&upper>=wickMin&&bodyRatio>=bodyMin&&num(last.high)>=rs-tol&&num(last.close)<rs)) return fail("NO_1H_BEARISH_REVERSAL");
    const anchor=Math.max(rs,num(last.high)), target=(levels.support||[]).filter(x=>x>0&&x<entry).sort((a,b)=>b-a)[0]||0;
    if(!(target>0)) return fail("NO_1H_SUPPORT_TARGET",{anchorPrice:anchor});
    const dPct=Math.abs(entry-anchor)/entry*100,dAtr=Math.abs(entry-anchor)/atr1;
    if(dPct>Number(CONFIG.hourlyStructureMaxEntryDistancePct||0.85)||dAtr>Number(CONFIG.hourlyStructureMaxEntryAtr||1.15)) return fail(`1H_REVERSAL_TOO_LATE_${dPct.toFixed(2)}PCT_${dAtr.toFixed(2)}ATR`,{anchorPrice:anchor,targetPrice:target,entryDistancePct:dPct,entryDistanceAtr:dAtr});
    const sb=Math.max(atr1*0.18,entry*0.0008),tb=Math.max(atr1*0.15,entry*0.0008),sl=Number((anchor+sb).toPrecision(12)),tp=Number((target+tb).toPrecision(12));
    const risk=Math.abs(entry-sl),reward=Math.abs(tp-entry),rr=risk>0?reward/risk:0;
    if(!(sl>entry&&tp<entry&&rr>=Number(CONFIG.structureMinRR||1.5))) return fail(`RR_${rr.toFixed(2)}_BELOW_${Number(CONFIG.structureMinRR||1.5).toFixed(2)}`,{anchorPrice:anchor,targetPrice:target,entryDistancePct:dPct,entryDistanceAtr:dAtr,riskPct:risk/entry*100,rewardPct:reward/entry*100,rr});
    return {valid:true,reason:"1H_REVERSAL_SHORT_STRUCTURE_VALID",entry,tp,sl,anchor:"1H_RESISTANCE",anchorPrice:anchor,target:"1H_SUPPORT",targetPrice:target,entryDistancePct:dPct,entryDistanceAtr:dAtr,riskPct:risk/entry*100,rewardPct:reward/entry*100,rr,reactionTimeframe:"1H",slPlan:{sl,distancePct:risk/entry*100,method:"1H_RESISTANCE_ABOVE_REACTION_HIGH",valid:true,anchorPrice:anchor},tpPlan:{tp,targetPrice:target,targetType:"1H_SUPPORT_BEFORE_LEVEL",method:"1H_SUPPORT_BEFORE_LEVEL",distancePct:reward/entry*100}};
  }
  const sp=(levels.support||[]).filter(x=>x>0&&Math.abs(num(last.low)-x)<=tol).sort((a,b)=>a-b)[0]||0;
  if(!(sp>0)||!(trendMove<=-Number(CONFIG.hourlyTrendMinMovePct||0.60))||!(num(last.close)>num(last.open)&&lower>=wickMin&&bodyRatio>=bodyMin&&num(last.low)<=sp+tol&&num(last.close)>sp)) return fail("NO_1H_BULLISH_REVERSAL");
  const anchor=Math.min(sp,num(last.low)), target=(levels.resistance||[]).filter(x=>x>entry).sort((a,b)=>a-b)[0]||0;
  if(!(target>0)) return fail("NO_1H_RESISTANCE_TARGET",{anchorPrice:anchor});
  const dPct=Math.abs(entry-anchor)/entry*100,dAtr=Math.abs(entry-anchor)/atr1;
  if(dPct>Number(CONFIG.hourlyStructureMaxEntryDistancePct||0.85)||dAtr>Number(CONFIG.hourlyStructureMaxEntryAtr||1.15)) return fail(`1H_REVERSAL_TOO_LATE_${dPct.toFixed(2)}PCT_${dAtr.toFixed(2)}ATR`,{anchorPrice:anchor,targetPrice:target,entryDistancePct:dPct,entryDistanceAtr:dAtr});
  const sb=Math.max(atr1*0.18,entry*0.0008),tb=Math.max(atr1*0.15,entry*0.0008),sl=Number((anchor-sb).toPrecision(12)),tp=Number((target-tb).toPrecision(12));
  const risk=Math.abs(entry-sl),reward=Math.abs(tp-entry),rr=risk>0?reward/risk:0;
  if(!(sl<entry&&tp>entry&&rr>=Number(CONFIG.structureMinRR||1.5))) return fail(`RR_${rr.toFixed(2)}_BELOW_${Number(CONFIG.structureMinRR||1.5).toFixed(2)}`,{anchorPrice:anchor,targetPrice:target,entryDistancePct:dPct,entryDistanceAtr:dAtr,riskPct:risk/entry*100,rewardPct:reward/entry*100,rr});
  return {valid:true,reason:"1H_REVERSAL_LONG_STRUCTURE_VALID",entry,tp,sl,anchor:"1H_SUPPORT",anchorPrice:anchor,target:"1H_RESISTANCE",targetPrice:target,entryDistancePct:dPct,entryDistanceAtr:dAtr,riskPct:risk/entry*100,rewardPct:reward/entry*100,rr,reactionTimeframe:"1H",slPlan:{sl,distancePct:risk/entry*100,method:"1H_SUPPORT_BELOW_REACTION_LOW",valid:true,anchorPrice:anchor},tpPlan:{tp,targetPrice:target,targetType:"1H_RESISTANCE_BEFORE_LEVEL",method:"1H_RESISTANCE_BEFORE_LEVEL",distancePct:reward/entry*100}};
}

function calculateHourlyContinuationTradePlan({ direction, price, candles1h }) {
  const entry=num(price), c=Array.isArray(candles1h)?candles1h.slice(0,-1):[];
  const fail=(reason,extra={})=>({valid:false,reason,entry,tp:0,sl:0,anchorPrice:0,targetPrice:0,entryDistancePct:0,entryDistanceAtr:0,riskPct:0,rewardPct:0,rr:0,breakoutTimeframe:"1H",slPlan:{sl:0,distancePct:0,method:"HOURLY_CONTINUATION_INVALID",valid:false},tpPlan:{tp:0,targetPrice:0,targetType:"1H_STRUCTURE",method:"HOURLY_CONTINUATION_INVALID",distancePct:0},...extra});
  if(!(entry>0)) return fail("INVALID_ENTRY"); if(c.length<24) return fail("INSUFFICIENT_1H_DATA");
  const last=c.at(-1), atr1=Math.max(num(atr(c,14)),entry*0.001,1e-12), levels=recentSwingLevels(c.slice(0,-2));
  const trendLookback=Math.max(2,Number(CONFIG.hourlyTrendLookback||12));
  const trendBase=c.at(Math.max(0,c.length-1-trendLookback));
  const trendMove=trendBase?pct(num(last.close),num(trendBase.close)):0;
  const range=Math.max(num(last.high)-num(last.low),1e-12), bodyRatio=Math.abs(num(last.close)-num(last.open))/range, loc=(num(last.close)-num(last.low))/range;
  const strong=bodyRatio>=Number(CONFIG.hourlyBreakBodyRatio||0.60)&&range>=atr1*Number(CONFIG.hourlyBreakAtrMultiplier||1);
  let anchor=0,target=0;
  if(direction==="long") {
    anchor=(levels.resistance||[]).filter(x=>x>0&&x<num(last.close)).sort((a,b)=>b-a)[0]||0;
    if(!(anchor>0&&trendMove>=Number(CONFIG.hourlyTrendMinMovePct||0.60)&&num(last.close)>anchor+atr1*Number(CONFIG.hourlyBreakLevelAtrBuffer||0.10)&&loc>=Number(CONFIG.hourlyBreakCloseLocationLong||0.72)&&strong)) return fail("NO_1H_STRONG_BULL_BREAK_OR_UPTREND",{trendMovePct:trendMove});
    target=(levels.resistance||[]).filter(x=>x>entry).sort((a,b)=>a-b)[0]||0;
  } else {
    anchor=(levels.support||[]).filter(x=>x>0&&x>num(last.close)).sort((a,b)=>a-b)[0]||0;
    if(!(anchor>0&&trendMove<=-Number(CONFIG.hourlyTrendMinMovePct||0.60)&&num(last.close)<anchor-atr1*Number(CONFIG.hourlyBreakLevelAtrBuffer||0.10)&&loc<=Number(CONFIG.hourlyBreakCloseLocationShort||0.28)&&strong)) return fail("NO_1H_STRONG_BEAR_BREAK_OR_DOWNTREND",{trendMovePct:trendMove});
    target=(levels.support||[]).filter(x=>x<entry).sort((a,b)=>b-a)[0]||0;
  }
  if(!(target>0)) return fail(direction==="long"?"NO_1H_NEXT_RESISTANCE":"NO_1H_NEXT_SUPPORT",{anchorPrice:anchor});
  const dPct=Math.abs(entry-anchor)/entry*100,dAtr=Math.abs(entry-anchor)/atr1;
  if(dPct>Number(CONFIG.hourlyStructureMaxEntryDistancePct||0.85)||dAtr>Number(CONFIG.hourlyStructureMaxEntryAtr||1.15)) return fail(`1H_CONTINUATION_TOO_LATE_${dPct.toFixed(2)}PCT_${dAtr.toFixed(2)}ATR`,{anchorPrice:anchor,targetPrice:target,entryDistancePct:dPct,entryDistanceAtr:dAtr});
  const sb=Math.max(atr1*0.15,entry*0.0008),tb=Math.max(atr1*0.15,entry*0.0008),sl=Number((direction==="long"?anchor-sb:anchor+sb).toPrecision(12)),tp=Number((direction==="long"?target-tb:target+tb).toPrecision(12));
  const risk=Math.abs(entry-sl),reward=Math.abs(tp-entry),rrv=risk>0?reward/risk:0;
  if(!(direction==="long"?sl<entry&&tp>entry:sl>entry&&tp<entry)) return fail("1H_CONTINUATION_WRONG_SIDE",{anchorPrice:anchor,targetPrice:target});
  if(rrv<Number(CONFIG.structureMinRR||1.5)) return fail(`RR_${rrv.toFixed(2)}_BELOW_${Number(CONFIG.structureMinRR||1.5).toFixed(2)}`,{anchorPrice:anchor,targetPrice:target,entryDistancePct:dPct,entryDistanceAtr:dAtr,riskPct:risk/entry*100,rewardPct:reward/entry*100,rr:rrv});
  return {valid:true,reason:`1H_CONTINUATION_${direction.toUpperCase()}_BREAKOUT_VALID`,entry,tp,sl,anchor:direction==="long"?"1H_BROKEN_RESISTANCE":"1H_BROKEN_SUPPORT",anchorPrice:anchor,target:direction==="long"?"1H_NEXT_RESISTANCE":"1H_NEXT_SUPPORT",targetPrice:target,entryDistancePct:dPct,entryDistanceAtr:dAtr,riskPct:risk/entry*100,rewardPct:reward/entry*100,rr:rrv,breakoutTimeframe:"1H",slPlan:{sl,distancePct:risk/entry*100,method:direction==="long"?"1H_BROKEN_RESISTANCE_BELOW":"1H_BROKEN_SUPPORT_ABOVE",valid:true,anchorPrice:anchor},tpPlan:{tp,targetPrice:target,targetType:"1H_NEXT_STRUCTURE_BEFORE_LEVEL",method:"1H_NEXT_STRUCTURE_BEFORE_LEVEL",distancePct:reward/entry*100}};
}


function estimateEconomicOpportunity(candidate, walletUsd) {
  const wallet = Math.max(num(walletUsd), 0);
  const allocation = CONFIG.walletAllocationPerPosition;
  const collateralUsd = wallet * allocation;
  const leverage = CONFIG.leverage;
  const notionalUsd = collateralUsd * leverage;
  const entry = num(candidate?.entry);
  const tp = num(candidate?.tp);

  if (!(entry > 0) || !(tp > 0) || !(notionalUsd > 0)) {
    return {
      valid: false,
      collateralUsd,
      notionalUsd,
      grossPnlUsd: 0,
      positionFeesUsd: 0,
      executionCostUsd: CONFIG.executionCostBufferUsd,
      fundingBorrowBufferUsd: CONFIG.fundingBorrowBufferUsd,
      totalCostUsd: CONFIG.executionCostBufferUsd + CONFIG.fundingBorrowBufferUsd,
      expectedNetUsd: -(CONFIG.executionCostBufferUsd + CONFIG.fundingBorrowBufferUsd),
      netToCostRatio: 0,
      tpMovePct: 0,
    };
  }

  const tpMovePct = Math.abs(pct(tp, entry));
  const grossPnlUsd = notionalUsd * tpMovePct / 100;
  const positionFeesUsd = notionalUsd * (CONFIG.positionFeeBpsPerSide / 10_000) * 2;
  const executionCostUsd = CONFIG.executionCostBufferUsd;
  const fundingBorrowBufferUsd = CONFIG.fundingBorrowBufferUsd;
  const totalCostUsd = positionFeesUsd + executionCostUsd + fundingBorrowBufferUsd;
  const expectedNetUsd = grossPnlUsd - totalCostUsd;
  const netToCostRatio = totalCostUsd > 0 ? expectedNetUsd / totalCostUsd : 0;

  return {
    valid: true,
    collateralUsd,
    notionalUsd,
    grossPnlUsd,
    positionFeesUsd,
    executionCostUsd,
    fundingBorrowBufferUsd,
    totalCostUsd,
    expectedNetUsd,
    netToCostRatio,
    tpMovePct,
  };
}

function economicGate(candidate, walletUsd) {
  const economics = estimateEconomicOpportunity(candidate, walletUsd);
  if (!economics.valid) return { ok: false, reason: "ECONOMIC_INVALID", economics };
  if (economics.expectedNetUsd < CONFIG.minExpectedNetUsd) {
    return {
      ok: false,
      reason: `EXPECTED_NET_${economics.expectedNetUsd.toFixed(2)}_BELOW_${CONFIG.minExpectedNetUsd.toFixed(2)}`,
      economics,
    };
  }
  if (economics.netToCostRatio < CONFIG.minNetToCostRatio) {
    return {
      ok: false,
      reason: `NET_COST_RATIO_${economics.netToCostRatio.toFixed(2)}_BELOW_${CONFIG.minNetToCostRatio.toFixed(2)}`,
      economics,
    };
  }
  return { ok: true, reason: "ECONOMIC_EDGE_OK", economics };
}

function attachEconomicOpportunity(candidate, walletUsd) {
  const economics = estimateEconomicOpportunity(candidate, walletUsd);
  return {
    ...candidate,
    economics,
    expectedGrossPnlUsd: economics.grossPnlUsd,
    expectedNetPnlUsd: economics.expectedNetUsd,
    estimatedTotalCostUsd: economics.totalCostUsd,
  };
}

function candidateIsActionable(candidate) {
  if (!candidate || !candidate.symbol || !(candidate.entry > 0)) return {ok:false,reason:'INVALID_1H_CANDIDATE'};
  const ev=candidate.setupEvidence||{};
  if (candidate.setupType!=='REVERSAL' && candidate.setupType!=='CONTINUATION') return {ok:false,reason:ev.structurePlanReason||'NO_1H_ACTIVE_SIGNAL'};
  if (ev.reactionTimeframe && ev.reactionTimeframe!=='1H') return {ok:false,reason:'NON_1H_REACTION_TIMEFRAME'};
  if (ev.breakoutTimeframe && ev.breakoutTimeframe!=='1H') return {ok:false,reason:'NON_1H_BREAKOUT_TIMEFRAME'};
  if (ev.structurePlanValid!==true) return {ok:false,reason:ev.structurePlanReason||'1H_STRUCTURE_PLAN_INVALID'};
  if (!(candidate.tp>0) || !(candidate.sl>0)) return {ok:false,reason:'1H_TP_SL_MISSING'};
  if (num(ev.structureRR)<Number(CONFIG.structureMinRR||1.5)) return {ok:false,reason:`RR_${num(ev.structureRR).toFixed(2)}_BELOW_${Number(CONFIG.structureMinRR).toFixed(2)}`};
  if (candidate.direction==='long' && !(candidate.sl<candidate.entry && candidate.tp>candidate.entry)) return {ok:false,reason:'1H_LONG_WRONG_TP_SL_SIDE'};
  if (candidate.direction==='short' && !(candidate.sl>candidate.entry && candidate.tp<candidate.entry)) return {ok:false,reason:'1H_SHORT_WRONG_TP_SL_SIDE'};
  if (Math.abs(pct(candidate.tp,candidate.entry))<Number(CONFIG.minTpDistancePct||0.30)) return {ok:false,reason:'1H_TP_TOO_CLOSE'};
  return {ok:true,reason:candidate.setupType==='REVERSAL'?'1H_REVERSAL_READY':'1H_CONTINUATION_READY'};
}

async function mapLimit(items, concurrency, fn) {
  const out = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      try {
        out[index] = await fn(items[index], index);
      } catch (error) {
        out[index] = { error: safeError(error), item: items[index] };
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, worker);
  await Promise.all(workers);
  return out;
}



const GMX_ORACLE_BASE = String(process.env.GMX_ORACLE_URL || "https://arbitrum-api.gmxinfra.io").replace(/\/+$/, "");

function oracleAssetFromMarket(market) {
  const candidates = [market?.indexTokenSymbol, market?.indexName, market?.symbol, market?.name, market?.marketSymbol].filter(Boolean).map(String);
  for (const raw of candidates) {
    const pair = raw.split("[")[0].trim();
    const asset = pair.includes("/") ? pair.split("/")[0].trim() : normalizeAsset(pair);
    if (asset && asset.length <= 32) return asset.toUpperCase();
  }
  return "";
}

function normalizeOhlcvRows(raw) {
  const rows = Array.isArray(raw) ? raw : Array.isArray(raw?.candles) ? raw.candles : Array.isArray(raw?.data) ? raw.data : [];
  const out = [];
  for (const r of rows) {
    const vals = Array.isArray(r)
      ? r
      : [r?.timestamp ?? r?.time ?? r?.t, r?.open ?? r?.o, r?.high ?? r?.h, r?.low ?? r?.l, r?.close ?? r?.c, r?.volume ?? r?.v ?? 0];
    const [ts, o, h, l, c, v] = vals.map(Number);
    if ([ts,o,h,l,c].every(Number.isFinite)) out.push({ timestamp: ts > 1e12 ? Math.floor(ts/1000) : Math.floor(ts), open:o, high:h, low:l, close:c, volume:Number.isFinite(v)?v:0 });
  }
  out.sort((a,b)=>a.timestamp-b.timestamp);
  return out;
}

async function fetchOracleCandles(market, timeframe, limit) {
  const asset = oracleAssetFromMarket(market);
  if (!asset) throw new Error("GMX_ORACLE_ASSET_UNRESOLVED");
  const url = `${GMX_ORACLE_BASE}/prices/candles?tokenSymbol=${encodeURIComponent(asset)}&period=${encodeURIComponent(timeframe)}&limit=${Math.min(500, Math.max(20, Number(limit)||120))}`;
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), 12000);
  try {
    const res = await fetch(url, { headers:{accept:"application/json"}, signal:controller.signal });
    if (!res.ok) throw new Error(`GMX_ORACLE_HTTP_${res.status}`);
    const candles = normalizeOhlcvRows(await res.json());
    if (candles.length < 20) throw new Error(`INSUFFICIENT_ORACLE_${timeframe}_CANDLES:${candles.length}`);
    return candles;
  } finally { clearTimeout(timer); }
}
async function fetchCandles(sdk, marketOrSymbol, timeframe, limit) {
  const market = typeof marketOrSymbol === "string" ? null : marketOrSymbol;
  const full = market ? marketDisplaySymbol(market) : String(marketOrSymbol || "");
  const base = full.split("[")[0].trim();
  const symbols = [...new Set([full, base, market ? candleSymbolFromMarket(market) : full].filter(Boolean))];
  const errors = [];
  if (typeof sdk?.fetchOhlcv === "function") {
    for (const symbol of symbols) {
      try {
        const candles = cleanCandles(await sdk.fetchOhlcv({symbol, timeframe, limit}));
        if (candles.length >= 20) return candles;
        errors.push(`${symbol}:INSUFFICIENT:${candles.length}`);
      } catch (e) { errors.push(`${symbol}:${safeError(e)}`); }
    }
  } else errors.push("SDK_FETCH_OHLCV_UNAVAILABLE");
  if (market) {
    try { return await fetchOracleCandles(market, timeframe, limit); }
    catch (e) { errors.push(`ORACLE:${safeError(e)}`); }
  }
  throw new Error(`OHLCV_ALL_SOURCES_FAILED:${errors.slice(0,4).join("|")}`);
}

function findMarketValue(marketValues, market) {
  const rows = Array.isArray(marketValues) ? marketValues : [];
  const addr = String(market?.marketTokenAddress || market?.marketAddress || market?.address || market?.marketToken || "").toLowerCase();
  const symbol = marketDisplaySymbol(market).toUpperCase();
  return rows.find(x => {
    const xa = String(x?.marketTokenAddress || x?.marketAddress || x?.address || x?.marketToken || "").toLowerCase();
    const xs = String(x?.symbol || x?.marketSymbol || x?.name || "").toUpperCase();
    return (addr && xa && addr === xa) || (symbol && xs && xs === symbol);
  }) || null;
}

function findReferenceMarket(markets, asset) {
  const target = String(asset || "").toUpperCase();
  return (Array.isArray(markets) ? markets : []).find((m) => {
    const a = normalizeAsset(marketDisplaySymbol(m));
    return a === target;
  }) || null;
}


async function fetchCandlesResilient(sdk, market, timeframe, limit, attempts = Number(CONFIG.deepDataRetryCount || 2)) {
  let lastError = null;
  for (let i = 0; i <= attempts; i++) {
    try {
      return await fetchCandles(sdk, market, timeframe, limit);
    } catch (error) {
      lastError = error;
      const text = safeError(error);
      const transient = /429|408|5\d\d|TIMEOUT|timed out|aborted|ECONN|ETIMEDOUT|rate.?limit/i.test(text);
      if (!transient || i >= attempts) break;
      await sleep(Number(CONFIG.deepDataRetryDelayMs || 450) * (i + 1));
    }
  }
  throw lastError || new Error(`OHLCV_RETRY_FAILED:${timeframe}`);
}


async function broadScan(sdk, markets, tickers, marketValues = [], previousSnapshots = {}) {
  // V22.5: universe discovery is metadata-only. No 5M candle is used by the
  // signal engine. Every listed perpetual goes directly to the completed-1H scan.
  const listed = markets.filter(isLikelyPerpMarket);
  const rows = listed.map((market) => ({
    market,
    ticker: findTicker(tickers, market),
    symbol: marketDisplaySymbol(market),
    candleSymbol: candleSymbolFromMarket(market),
    marketValue: findMarketValue(marketValues, market),
    previousSnapshot: previousSnapshots[marketDisplaySymbol(market)] || null,
    broadRankScore: 0,
  }));
  return { universe: listed.length, successful: rows.length, failed: 0, rows };
}

async function deepScan(sdk, broadRows, marketRegime = null) {
  const selected=broadRows;
  const results=await mapLimit(selected,Math.min(6,CONFIG.ohlcvConcurrency),async(row)=>{
    try {
      const candles1h=await fetchCandlesResilient(sdk,row.market,'1h',CONFIG.contextLimit);
      if(candles1h.length<24) return {...row,error:`INSUFFICIENT_1H_CANDLES:${candles1h.length}`};
      const candidate=scoreCandidate({market:row.market,ticker:row.ticker,marketValue:row.marketValue,previousSnapshot:row.previousSnapshot,candles1h});
      candidate.setupEvidence=candidate.setupEvidence||{};
      candidate.setupEvidence.htfData={oneH:true,fifteenM:false,fourH:false,oneD:false,structuralTf:'1H',degraded:false};
      candidate.indicators=candidate.indicators||{};
      candidate.indicators.htfData=candidate.setupEvidence.htfData;
      return candidate;
    } catch(error) { return {...row,error:safeError(error)}; }
  });
  const valid=results.filter(x=>x&&!x.error&&x.entry>0);
  const failed=results.filter(x=>x?.error);
  console.log('[DEEP][1H-ONLY][SUMMARY]',{attempted:selected.length,successful:valid.length,failed:failed.length,sampleErrors:failed.slice(0,5).map(x=>({symbol:x.symbol||x.item?.symbol||'UNKNOWN',error:x.error}))});
  return valid.sort((a,b)=>(b.score+b.edge*0.35)-(a.score+a.edge*0.35));
}

function extractBalanceRows(payload) {
  return collectObjects(
    payload,
    (x) => {
      const symbol = String(x?.symbol || x?.tokenSymbol || x?.assetSymbol || "").toUpperCase();
      return ["USDC", "USDT", "USDC.E"].includes(symbol);
    }
  );
}

function parseCollateralBalances(payload) {
  const rows = extractBalanceRows(payload);
  const result = {
    USDC: { usd: 0, raw: 0n, decimals: 6, address: null },
    USDT: { usd: 0, raw: 0n, decimals: 6, address: null },
  };

  for (const row of rows) {
    const symbol = String(row.symbol || row.tokenSymbol || row.assetSymbol).toUpperCase() === "USDC.E"
      ? "USDC"
      : String(row.symbol || row.tokenSymbol || row.assetSymbol).toUpperCase();

    const decimals = Math.max(0, Math.min(18, Math.trunc(num(row.decimals, 6))));
    const rawValue =
      row.balance ??
      row.rawBalance ??
      row.balanceAmount ??
      row.amount ??
      row.tokenAmount ??
      row.amountRaw;

    let raw = 0n;
    try {
      if (typeof rawValue === "bigint") raw = rawValue;
      else if (rawValue !== undefined && rawValue !== null) {
        const text = String(rawValue);
        raw = /^\d+$/.test(text) ? BigInt(text) : toUnits(text, decimals);
      }
    } catch {}

    const human =
      row.usd ??
      row.usdValue ??
      row.balanceUsd ??
      row.valueUsd ??
      row.amountUsd;

    const usd = num(human, Number(raw) / 10 ** decimals);

    if (usd > result[symbol].usd) {
      result[symbol] = {
        usd,
        raw,
        decimals,
        address: row.address || row.tokenAddress || row.contractAddress || null,
      };
    }
  }

  return result;
}

async function getWalletSnapshot(sdk, account) {
  const balances = await sdk.fetchWalletBalances({ address: account });
  const parsed = parseCollateralBalances(balances);
  return {
    raw: balances,
    USDC: parsed.USDC,
    USDT: parsed.USDT,
    walletUsd: parsed.USDC.usd + parsed.USDT.usd,
  };
}

function positionAsset(position) {
  return normalizeAsset(
    position?.indexName ||
    position?.symbol ||
    position?.marketSymbol ||
    position?.market?.symbol ||
    ""
  );
}

function positionSizeUsd(position) {
  return humanUsd30(position?.sizeInUsd ?? position?.sizeUsd ?? position?.size);
}

async function getOpenPositions(sdk, account) {
  const positions = await sdk.fetchPositionsInfo({
    address: account,
    includeRelatedOrders: true,
  });
  return (Array.isArray(positions) ? positions : [])
    .filter((p) => positionSizeUsd(p) > 0);
}

function findPositionForCandidate(positions, candidate) {
  const wanted = normalizeAsset(candidate.symbol);
  return positions.find((p) => positionAsset(p) === wanted);
}

async function resolveCollateral(sdk, market, wallet) {
  const marketText = safeJson(market).toUpperCase();

  const possible = [];
  if (marketText.includes("USDC")) possible.push("USDC");
  if (marketText.includes("USDT")) possible.push("USDT");

  for (const symbol of ["USDC", "USDT"]) {
    if (!possible.includes(symbol)) continue;
    if (wallet[symbol]?.usd > 0) return { symbol, ...wallet[symbol] };
  }

  return null;
}

async function findTokenAddress(sdk, tokenSymbol) {
  if (typeof sdk.fetchTokensData !== "function") return null;
  const data = await sdk.fetchTokensData();
  const rows = Array.isArray(data) ? data : Object.values(data || {});
  const wanted = tokenSymbol.toUpperCase();

  for (const row of rows) {
    const symbol = String(row?.symbol || row?.tokenSymbol || row?.name || "").toUpperCase();
    if (symbol === wanted || (wanted === "USDC" && symbol === "USDC.E")) {
      return row?.address || row?.tokenAddress || row?.contractAddress || null;
    }
  }
  return null;
}

function decodeApproveSpender(tx) {
  const data = String(tx?.data || "");
  if (!/^0x095ea7b3[0-9a-fA-F]{128}$/.test(data)) return null;
  return `0x${data.slice(34, 74)}`;
}

async function rpcJson(rpcUrl, method, params) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const body = await response.json();
  if (!response.ok || body.error) {
    throw new Error(body?.error?.message || `RPC_${response.status}`);
  }
  return body.result;
}

function pad32Address(address) {
  return String(address).replace(/^0x/, "").padStart(64, "0");
}

function pad32Uint(value) {
  return BigInt(value).toString(16).padStart(64, "0");
}

async function readAllowance(rpcUrl, token, owner, spender) {
  const data = `0xdd62ed3e${pad32Address(owner)}${pad32Address(spender)}`;
  const raw = await rpcJson(rpcUrl, "eth_call", [{ to: token, data }, "latest"]);
  return BigInt(raw);
}

async function ensureClassicAllowance({ sdk, signer, account, tokenSymbol, tokenAddress, required, rpcUrl }) {
  if (!tokenAddress) throw new Error(`TOKEN_ADDRESS_NOT_FOUND:${tokenSymbol}`);

  const probe = await sdk.buildApproveTransaction({
    tokenAddress,
    spender: "router",
    amount: 0n,
  });

  const routerAddress = decodeApproveSpender(probe);
  if (!routerAddress) throw new Error("GMX_ROUTER_ADDRESS_NOT_DECODED");

  let allowance = ZERO;
  try {
    allowance = await readAllowance(rpcUrl, tokenAddress, account, routerAddress);
  } catch (error) {
    console.warn("[ALLOWANCE][READ_FAILED]", safeError(error));
  }

  if (allowance >= required) {
    return {
      sufficient: true,
      approved: false,
      routerAddress,
      allowance: allowance.toString(),
    };
  }

  const approvalAmount = (1n << 256n) - 1n;
  const tx = await sdk.buildApproveTransaction({
    tokenAddress,
    spender: "router",
    amount: approvalAmount,
  });

  const result = await signer.sendTransaction({
    to: tx.to,
    data: tx.data,
    ...(tx.value !== undefined ? { value: BigInt(tx.value) } : {}),
  });

  const hash =
    typeof result === "string"
      ? result
      : result?.hash || result?.transactionHash || result?.txHash;

  if (!hash) throw new Error("APPROVAL_TX_HASH_MISSING");

  await waitReceipt(rpcUrl, hash, 60_000);

  for (let i = 0; i < 20; i++) {
    const current = await readAllowance(rpcUrl, tokenAddress, account, routerAddress);
    if (current >= required) {
      return {
        sufficient: true,
        approved: true,
        approvalTxHash: hash,
        routerAddress,
        allowance: current.toString(),
      };
    }
    await sleep(1000);
  }

  throw new Error("APPROVAL_VERIFICATION_TIMEOUT");
}

async function waitReceipt(rpcUrl, hash, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const receipt = await rpcJson(rpcUrl, "eth_getTransactionReceipt", [hash]);
    if (receipt) {
      if (receipt.status && receipt.status !== "0x1") {
        throw new Error(`TRANSACTION_REVERTED:${hash}`);
      }
      return receipt;
    }
    await sleep(1000);
  }
  throw new Error(`TRANSACTION_RECEIPT_TIMEOUT:${hash}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function prepareClassicIncrease({
  sdk,
  account,
  symbol,
  direction,
  sizeUsd,
  collateralUsd,
  collateralToken,
  tp,
  sl,
}) {
  const size = toUnits(sizeUsd.toFixed(6), 30);
  const collateral = toUnits(collateralUsd.toFixed(6), 6);
  const trigger = toUnits(tp.toFixed(12), 30);

  return sdk.prepareOrder({
    kind: "increase",
    symbol,
    direction,
    orderType: "market",
    size,
    collateralToken,
    collateralToPay: {
      amount: collateral,
      token: collateralToken,
    },
    mode: "classic",
    from: account,
    slippage: 50,
    executionFeeBufferBps: 3000,
    tpsl: [
      {
        type: "take-profit",
        triggerPrice: trigger,
        size,
      },
      ...(CONFIG.stopLossEnabled && Number(sl) > 0 ? [{
        type: "stop-loss",
        triggerPrice: toUnits(Number(sl).toFixed(12), 30),
        size,
      }] : []),
    ],
  });
}

async function sendClassicTransaction(signer, prepared) {
  if (prepared?.payloadType !== "transaction") {
    throw new Error(`CLASSIC_PAYLOAD_EXPECTED:${prepared?.payloadType || "unknown"}`);
  }

  const tx = {
    to: prepared?.payload?.to,
    data: prepared?.payload?.data,
    value: BigInt(prepared?.payload?.value ?? 0),
  };

  if (!/^0x[0-9a-fA-F]{40}$/.test(String(tx.to || ""))) {
    throw new Error("CLASSIC_TX_TARGET_INVALID");
  }
  if (!String(tx.data || "").startsWith("0x")) {
    throw new Error("CLASSIC_TX_DATA_INVALID");
  }

  const result = await signer.sendTransaction(tx);
  return typeof result === "string"
    ? result
    : result?.hash || result?.transactionHash || result?.txHash || null;
}

async function verifyPosition(sdk, account, candidate, timeoutMs = 45_000) {
  const started = Date.now();
  const wanted = normalizeAsset(candidate.symbol);

  while (Date.now() - started < timeoutMs) {
    const positions = await getOpenPositions(sdk, account);
    const position = positions.find((p) => positionAsset(p) === wanted);
    if (position) {
      return { verified: true, position };
    }
    await sleep(2000);
  }

  return { verified: false, position: null };
}

function tradeMessage(result) {
  if (result.executed) {
    return [
      `🟢 GMX BOT — LIVE CLASSIC TRADE`,
      `━━━━━━━━━━━━━━━━━━`,
      `🪙 Symbol: ${result.symbol}`,
      `📌 Direction: ${result.direction.toUpperCase()}`,
      `💰 Entry: ${formatPrice(result.entry)}`,
      `🎯 TP: ${formatPrice(result.tp)}`,
      `⚙️ Leverage: ${result.leverage.toFixed(1)}x`,
      `📊 Allocation: ${(result.allocation * 100).toFixed(2)}%`,
      `📦 Notional: ${formatUsd(result.notionalUsd)}`,
      `💵 Collateral: ${formatUsd(result.collateralUsd)}`,
      `💰 Wallet: ${formatUsd(result.walletBefore)} → ${formatUsd(result.walletAfter)}`,
      `📉 Wallet Δ: ${formatUsd(result.walletAfter - result.walletBefore)}`,
      `⛓️ Mode: CLASSIC ON-CHAIN`,
      `🔗 Tx: ${result.txHash || "N/A"}`,
      `🧪 Score: ${result.score.toFixed(1)} | Edge: ${result.edge.toFixed(1)} | Risk: ${result.risk.toFixed(1)}`,
      `💹 Expected gross: ${formatUsd(result.expectedGrossPnlUsd)} | Net: ${formatUsd(result.expectedNetPnlUsd)} | Cost: ${formatUsd(result.estimatedTotalCostUsd)}`,
      `🧠 Reasons: ${result.reasons.join(", ") || "N/A"}`,
      `✅ Position verified: ${result.verified ? "YES" : "PENDING"}`,
      `🕐 ${new Date().toISOString()}`,
    ].join("\n");
  }

  return [
    `🔴 GMX BOT — EXECUTION FAILURE`,
    `━━━━━━━━━━━━━━━━━━`,
    `🪙 Symbol: ${result.symbol || "N/A"}`,
    `📌 Direction: ${String(result.direction || "N/A").toUpperCase()}`,
    `💰 Entry: ${formatPrice(result.entry)}`,
    `🎯 TP: ${formatPrice(result.tp)}`,
    `⚙️ Leverage: ${CONFIG.leverage.toFixed(1)}x`,
    `📊 Allocation target: ${(CONFIG.walletAllocationPerPosition * 100).toFixed(2)}%`,
    `❌ Stage: ${result.stage || "EXECUTION"}`,
    `❌ Reason: ${result.reason || "Unknown error"}`,
    `🧪 Score: ${num(result.score).toFixed(1)} | Edge: ${num(result.edge).toFixed(1)} | Risk: ${num(result.risk).toFixed(1)}`,
    `🕐 ${new Date().toISOString()}`,
  ].join("\n");
}

function cycleMessage(report) {
  const lines = [
    `🟢 GMX BOT — CYCLE REPORT`,
    `━━━━━━━━━━━━━━━━━━`,
    `📡 Status: ${report.status}`,
    `🪙 Universe: ${report.universe}`,
    `🔎 Universe: ${report.broadSuccess}/${report.universe}`,
    `🕐 1H signal scan: ${report.deepCount}/${report.deepAttempted || report.deepCount} | Data failures: ${report.deepFailureCount || 0}`,
    `📐 1H structure: active | Flow/Smart-money: diagnostic only`,
    `🧠 Signal authority: COMPLETED 1H CANDLE STRUCTURE`,
    `🧭 Entry/SL/TP timeframe: 1H`,
    `⚡ Event candidates: ${report.actionableCount}`,
    ``,
    `🕯️ 1H trend expansions: ${report.impulseCount}`,
    `🧪 1H debug: Universe ${report.universe} / 1H evaluated ${report.deepCount} | Reversal ${report.layerReversalCount || 0}`,
    `🧩 1H gates: Structure ${report.structureReadyCount || 0} | RR ${report.rrReadyCount || 0} | TP/SL ${report.tpSlReadyCount || 0}`,
    `🚫 1H rejects are reported by the exact structure reason in TOP BLOCKED`,
    `🎯 Entry ready: ${report.actionableCount}`,
    `🟢 Executed: ${report.executedCount}`,
    `🔴 Execution failures: ${report.failureCount}`,
    ``,
  ];

  for (const [index, trade] of report.executions.entries()) {
    lines.push(
      `🟢 EXECUTED #${index + 1} — ${trade.symbol}`,
      `📌 Direction: ${trade.direction.toUpperCase()}`,
      `💰 Entry: ${formatPrice(trade.entry)}`,
      `🎯 TP: ${formatPrice(trade.tp)}`,
      `🛡️ SL: ${formatPrice(trade.sl)}`,
      `📊 Allocation: ${(trade.allocation * 100).toFixed(2)}% | ⚙️ Leverage: ${CONFIG.leverage.toFixed(1)}x`,
      `📦 Notional: ${formatUsd(trade.notionalUsd)} | 💵 Collateral: ${formatUsd(trade.collateralUsd)}`,
      `🔗 Tx: ${trade.txHash || "N/A"}`,
      `🧪 Score ${trade.score.toFixed(1)} | Edge ${trade.edge.toFixed(1)} | Risk ${trade.risk.toFixed(1)}`,
      `💹 Expected gross: ${formatUsd(trade.expectedGrossPnlUsd)} | Net: ${formatUsd(trade.expectedNetPnlUsd)} | Cost: ${formatUsd(trade.estimatedTotalCostUsd)}`,
      `──────────────────`,
    );
  }

  if (report.topRejected.length) {
    lines.push(`ℹ️ TOP BLOCKED`);
    for (const item of report.topRejected.slice(0, 3)) {
      lines.push(`• ${item.symbol}`);
      lines.push(`  📌 ${String(item.direction || "N/A").toUpperCase()} | Entry ${formatPrice(item.entry)} | SL ${formatPrice(item.sl)} | TP ${formatPrice(item.tp)}`);
      const econ = item.economics || {};
      lines.push(`  🧠 ${String(item.setupType || "N/A")} | Score ${num(item.score).toFixed(1)} | Edge ${num(item.edge).toFixed(1)} | Risk ${num(item.risk).toFixed(1)}`);
      lines.push(`  🕐 1H reason: ${String(item.setupEvidence?.hourlyStructureReason || item.reason || "N/A")}`);
      const tm = item.setupEvidence || {};
      lines.push(`  ⏱️ 1H trend ${num(tm.hourlyTrendMovePct).toFixed(2)}% | Body ${num(tm.hourlyLastCandleBodyRatio).toFixed(2)} | Dist ${num(tm.structureEntryDistancePct).toFixed(2)}% / ${num(tm.structureEntryDistanceAtr).toFixed(2)} ATR`);
      const slInfo = item.setupEvidence || {};
      lines.push(`  🛡️ SL ${formatPrice(item.sl)} | ${num(slInfo.slDistancePct).toFixed(2)}% | ${String(slInfo.slMethod || "N/A")}`);
      lines.push(`  💹 Gross ${formatUsd(econ.grossPnlUsd)} | Cost ${formatUsd(econ.totalCostUsd)} | Net ${formatUsd(econ.expectedNetUsd)} | TP move ${num(econ.tpMovePct).toFixed(2)}%`);
      lines.push(`  🚫 ${item.reason}`);
    }
  }

  lines.push(`🆔 Scan: ${report.scanId}`);
  lines.push(`🕐 ${new Date().toISOString()}`);
  lines.push(`ℹ️ مسیر: Universe → 1H OHLCV → Completed 1H Structure → Selection → Economic Gate → Classic Execution → Verification`);

  return lines.join("\n");
}

async function executeCandidate(runtime, candidate, wallet, openPositions, env) {
  const { sdk, signer, account } = runtime;

  if (openPositions.length >= CONFIG.maxPositions) {
    return { executed: false, symbol: candidate.symbol, direction: candidate.direction, entry: candidate.entry, tp: candidate.tp, score: candidate.score, edge: candidate.edge, risk: candidate.risk, reason: "MAX_POSITIONS_REACHED", stage: "PORTFOLIO" };
  }

  if (findPositionForCandidate(openPositions, candidate)) {
    return { executed: false, symbol: candidate.symbol, direction: candidate.direction, entry: candidate.entry, tp: candidate.tp, score: candidate.score, edge: candidate.edge, risk: candidate.risk, reason: "SYMBOL_ALREADY_OPEN", stage: "PORTFOLIO" };
  }

  const collateral = await resolveCollateral(sdk, candidate.market, wallet);
  if (!collateral) {
    return { executed: false, symbol: candidate.symbol, direction: candidate.direction, entry: candidate.entry, tp: candidate.tp, score: candidate.score, edge: candidate.edge, risk: candidate.risk, reason: "NO_USDC_USDT_BALANCE_FOR_MARKET", stage: "BALANCE" };
  }

  const walletBefore = wallet.walletUsd;
  const collateralUsd = walletBefore * CONFIG.walletAllocationPerPosition;
  const notionalUsd = collateralUsd * CONFIG.leverage;
  const economics = estimateEconomicOpportunity(candidate, walletBefore);

  if (collateralUsd <= 0) {
    return { executed: false, symbol: candidate.symbol, direction: candidate.direction, entry: candidate.entry, tp: candidate.tp, score: candidate.score, edge: candidate.edge, risk: candidate.risk, reason: "ZERO_COLLATERAL", stage: "BALANCE" };
  }

  const economicCheck = economicGate(candidate, walletBefore);
  if (!economicCheck.ok) {
    return {
      executed: false, symbol: candidate.symbol, direction: candidate.direction, entry: candidate.entry, tp: candidate.tp,
      score: candidate.score, edge: candidate.edge, risk: candidate.risk, reason: economicCheck.reason, stage: "ECONOMIC_GATE",
      expectedGrossPnlUsd: economics.grossPnlUsd, expectedNetPnlUsd: economics.expectedNetUsd, estimatedTotalCostUsd: economics.totalCostUsd,
    };
  }

  let prepared;
  try {
    prepared = await prepareClassicIncrease({
      sdk,
      account,
      symbol: candidate.symbol,
      direction: candidate.direction,
      sizeUsd: notionalUsd,
      collateralUsd,
      collateralToken: collateral.symbol,
      tp: candidate.tp,
      sl: candidate.sl,
    });
  } catch (error) {
    return {
      executed: false,
      symbol: candidate.symbol,
      direction: candidate.direction,
      entry: candidate.entry,
      tp: candidate.tp,
      sl: candidate.sl,
      score: candidate.score,
      edge: candidate.edge,
      risk: candidate.risk,
      reason: safeError(error),
      stage: "PREPARE_CLASSIC",
    };
  }

  try {
    const tokenAddress = collateral.address || await findTokenAddress(sdk, collateral.symbol);
    const allowance = await ensureClassicAllowance({
      sdk,
      signer,
      account,
      tokenSymbol: collateral.symbol,
      tokenAddress,
      required: toUnits(collateralUsd.toFixed(6), 6),
      rpcUrl: env.ARBITRUM_RPC,
    });

    const txHash = await sendClassicTransaction(signer, prepared);
    if (!txHash) throw new Error("CLASSIC_ORDER_TX_HASH_MISSING");

    const verification = await verifyPosition(sdk, account, candidate);
    const walletAfterSnapshot = await getWalletSnapshot(sdk, account);

    return {
      executed: true,
      verified: verification.verified,
      symbol: candidate.symbol,
      direction: candidate.direction,
      entry: candidate.entry,
      tp: candidate.tp,
      sl: candidate.sl,
      score: candidate.score,
      edge: candidate.edge,
      risk: candidate.risk,
      allocation: CONFIG.walletAllocationPerPosition,
      leverage: CONFIG.leverage,
      notionalUsd,
      collateralUsd,
      walletBefore,
      expectedGrossPnlUsd: economics.grossPnlUsd,
      expectedNetPnlUsd: economics.expectedNetUsd,
      estimatedTotalCostUsd: economics.totalCostUsd,
      walletAfter: walletAfterSnapshot.walletUsd,
      txHash,
      allowance,
      position: verification.position,
      reasons: candidate.reasons,
    };
  } catch (error) {
    return {
      executed: false,
      symbol: candidate.symbol,
      direction: candidate.direction,
      entry: candidate.entry,
      tp: candidate.tp,
      sl: candidate.sl,
      score: candidate.score,
      edge: candidate.edge,
      risk: candidate.risk,
      reason: safeError(error),
      stage: "CLASSIC_BROADCAST",
    };
  }
}

async function emergencyCloseIfRequested(runtime, env) {
  const requested = String(env?.EMERGENCY_CLOSE_SYMBOL || "").trim();
  if (!requested) return null;

  const positions = await getOpenPositions(runtime.sdk, runtime.account);
  const wanted = normalizeAsset(requested);
  const targets = positions.filter((p) => !wanted || positionAsset(p) === wanted);

  if (!targets.length) {
    return {
      executed: false,
      reason: `NO_OPEN_POSITION_FOR_${wanted || "ALL"}`,
    };
  }

  const results = [];
  for (const position of targets) {
    const symbol = position?.symbol || position?.indexName || "";
    const direction = position?.isLong === false ? "short" : "long";
    const sizeUsd = positionSizeUsd(position);
    const prepared = await runtime.sdk.prepareOrder({
      kind: "decrease",
      symbol,
      direction,
      orderType: "market",
      size: toUnits(sizeUsd.toFixed(6), 30),
      collateralToken: "USDC",
      receiveToken: "USDC",
      mode: "classic",
      from: runtime.account,
    });
    const txHash = await sendClassicTransaction(runtime.signer, prepared);
    results.push({ symbol, txHash, sizeUsd });
  }
  return { executed: true, results };
}


async function runCycle(event, env) {
  const scanId = String(
    event?.scanId ||
    `scheduled-${event?.scheduledTime || Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );

  const runtime = await createRuntime(env);
  const state = await loadState();

  console.log("[CYCLE][START]", {
    scanId,
    version: BOT_VERSION,
    executionEnabled: executionEnabled(env),
    chainId: CHAIN_ID,
  });

  const [markets, tickers, wallet, openPositions, marketValues] = await Promise.all([
    runtime.sdk.fetchMarkets(),
    runtime.sdk.fetchMarketsTickers(),
    getWalletSnapshot(runtime.sdk, runtime.account),
    getOpenPositions(runtime.sdk, runtime.account),
    typeof runtime.sdk.fetchMarketsValues === "function" ? runtime.sdk.fetchMarketsValues().catch(() => []) : Promise.resolve([]),
  ]);

  const universe = Array.isArray(markets) ? markets.filter(isLikelyPerpMarket) : [];
  const tickerRows = Array.isArray(tickers) ? tickers : [];

  const broad = await broadScan(runtime.sdk, universe, tickerRows, marketValues, state.marketSnapshots);
  // V22.3: signal engine is 1H-only. Macro/HTF intelligence does not gate or
  // re-score a candidate; the 1H structure plan is the sole signal authority.
  const deep = await deepScan(runtime.sdk, broad.rows, null);
  const deepAttempted = broad.rows.length;
  const deepFailureCount = Math.max(0, deepAttempted - deep.length);
  const ranked = deep;

  const blocked = [];
  const actionable = [];
  const economicBlocked = [];
  for (const candidate of ranked) {
    const check = candidateIsActionable(candidate);
    if (!check.ok) {
      blocked.push({
        symbol: candidate.symbol, direction: candidate.direction, entry: candidate.entry, sl: candidate.sl, tp: candidate.tp,
        score: candidate.score, edge: candidate.edge, risk: candidate.risk, setupType: candidate.setupType,
        reversalEvidence: candidate.reversalEvidence, reason: check.reason, setupEvidence: candidate.setupEvidence,
      });
      continue;
    }

    const economic = economicGate(candidate, wallet.walletUsd);
    const enriched = attachEconomicOpportunity(candidate, wallet.walletUsd);
    if (economic.ok) {
      actionable.push(enriched);
    } else {
      const item = {
        symbol: candidate.symbol, direction: candidate.direction, entry: candidate.entry, sl: candidate.sl, tp: candidate.tp,
        score: candidate.score, edge: candidate.edge, risk: candidate.risk, setupType: candidate.setupType,
        reversalEvidence: candidate.reversalEvidence, reason: economic.reason, setupEvidence: candidate.setupEvidence,
        economics: enriched.economics,
      };
      blocked.push(item);
      economicBlocked.push(item);
    }
  }

  // GMX Opportunity Engine: rank by economic opportunity first, while keeping
  // signal quality as the tie-breaker. We never manufacture a farther TP just
  // to make a trade profitable on paper.
  actionable.sort((a, b) => {
    const net = num(b.expectedNetPnlUsd) - num(a.expectedNetPnlUsd);
    if (Math.abs(net) > 0.05) return net;
    const quality = (b.score + b.edge * 0.35) - (a.score + a.edge * 0.35);
    return quality;
  });
  const selected = actionable.slice(0, CONFIG.finalCandidates);
  console.log("[SELECTION][TOP]", selected[0] ? {
    symbol: selected[0].symbol, direction: selected[0].direction, entry: selected[0].entry, tp: selected[0].tp, sl: selected[0].sl, rr: selected[0].setupEvidence?.structureRR,
    setupType: selected[0].setupType, reversalEvidence: selected[0].reversalEvidence, score: selected[0].score,
    edge: selected[0].edge, risk: selected[0].risk, allocation: CONFIG.walletAllocationPerPosition, leverage: CONFIG.leverage,
    expectedGrossPnlUsd: selected[0].expectedGrossPnlUsd, expectedNetPnlUsd: selected[0].expectedNetPnlUsd,
    estimatedTotalCostUsd: selected[0].estimatedTotalCostUsd, netToCostRatio: selected[0].economics?.netToCostRatio,
    tpMovePct: selected[0].economics?.tpMovePct,
    tpMethod: selected[0].tpPlan?.method, tpTargetType: selected[0].tpPlan?.targetType,
    tpTargetScore: selected[0].tpPlan?.targetScore, tpProbabilityProxy: selected[0].tpPlan?.probabilityProxy,
    sharpMove: selected[0].setupEvidence?.sharpMove, lateChase: selected[0].setupEvidence?.lateChase,
    moveMaturity: selected[0].setupEvidence?.moveMaturity, moveMaturityLabel: selected[0].setupEvidence?.moveMaturityLabel, lateMove: selected[0].setupEvidence?.lateMove,
    zoneState: selected[0].setupEvidence?.zoneState, impulseQuality: selected[0].setupEvidence?.impulseQuality,
    earlyTrend: selected[0].setupEvidence?.earlyTrend, earlyBreak: selected[0].setupEvidence?.earlyBreak, earlyTimingBonus: selected[0].setupEvidence?.earlyTimingBonus,
    reversalConfidence: selected[0].reversalConfidence, continuationConfidence: selected[0].continuationConfidence, setupDominance: selected[0].setupDominance,
    triggerActive: selected[0].triggerActive, reversalTrigger: selected[0].reversalTrigger, continuationTrigger: selected[0].continuationTrigger,
    capitalFlowScore: selected[0].indicators?.capitalFlowScore, capitalFlowDirection: selected[0].indicators?.capitalFlowDirection, capitalFlowState: selected[0].indicators?.capitalFlowState,
    smartMoneyProxy: selected[0].indicators?.smartMoneyProxy, oiDeltaPct: selected[0].indicators?.oiDeltaPct, volumeRatio5m: selected[0].indicators?.volumeRatio5m,
    volumeRatio15m: selected[0].indicators?.volumeRatio15m, volumeProfileZone: selected[0].indicators?.volumeProfileZone,
  } : { selected: 0 });

  const executions = [];
  const failures = [];
  let currentPositions = [...openPositions];
  let currentWallet = wallet;

  if (executionEnabled(env)) {
    for (const candidate of selected) {
      if (currentPositions.length >= CONFIG.maxPositions) break;

      const result = await executeCandidate(
        runtime,
        candidate,
        currentWallet,
        currentPositions,
        env
      );

      if (result.executed) {
        executions.push(result);
        currentPositions.push(result.position || { symbol: candidate.symbol, sizeInUsd: String(toUnits(result.notionalUsd.toFixed(6), 30)) });
        currentWallet = await getWalletSnapshot(runtime.sdk, runtime.account);
      } else {
        failures.push(result);
      }

      if (result.executed || failures.length) {
        try { await sendTelegram(env, tradeMessage(result)); } catch {}
      }
    }
  }

  const impulseCount = ranked.filter((x) =>
    Math.abs(num(x.setupEvidence?.hourlyTrendMovePct)) >= Number(CONFIG.hourlyTrendMinMovePct || 0.60)
  ).length;
  const reversalReadyCount = ranked.filter((x) =>
    x.setupType === "REVERSAL" && x.setupEvidence?.structurePlanValid === true
  ).length;
  const continuationReadyCount = ranked.filter((x) =>
    x.setupType === "CONTINUATION" && x.setupEvidence?.structurePlanValid === true
  ).length;
  const scoreReadyCount = ranked.filter((x) => x.score >= CONFIG.minScore).length;
  const edgeReadyCount = ranked.filter((x) => x.edge >= CONFIG.minEdge).length;

  const report = {
    scanId,
    status: executions.length ? "EXECUTED" : actionable.length ? "ENTRY_READY" : "WATCHING",
    universe: universe.length,
    broadSuccess: broad.successful,
    deepCount: deep.length,
    deepSuccess: deep.length,
    deepAttempted,
    deepFailureCount,
    actionableCount: actionable.length,
    impulseCount,
    flowCount: 0,
    smartMoneyCount: 0,
    maCount: impulseCount,
    adxCount: 0,
    layerReadyCount: 0,
    layerFlowCount: 0,
    layerReversalCount: reversalReadyCount,
    marketRegime: null,
    structureReadyCount: ranked.filter(x => x.setupEvidence?.structurePlanValid === true).length,
    rrReadyCount: ranked.filter(x => num(x.setupEvidence?.structureRR) >= Number(CONFIG.structureMinRR || 1.5)).length,
    tpSlReadyCount: ranked.filter(x => num(x.tp) > 0 && num(x.sl) > 0).length,
    srCount: 0,
    positiveMoveCount: 0,
    pullbackCount: 0,
    scoreReadyCount,
    edgeReadyCount,
    rejectMove: 0,
    rejectBody: 0,
    rejectActivity: 0,
    rejectAccel: 0,
    rejectExt: 0,
    rejectZone: 0,
    rejectPre: 0,
    rejectScore: blocked.filter((x) => x.reason.startsWith("SCORE_")).length,
    rejectEdge: blocked.filter((x) => x.reason.startsWith("EDGE_")).length,
    rejectSetup: blocked.filter((x) => !x.reason.startsWith("SCORE_") && !x.reason.startsWith("EDGE_")).length,
    executedCount: executions.length,
    failureCount: failures.length,
    executions,
    topRejected: blocked,
  };

  state.marketSnapshots = state.marketSnapshots || {};
  for (const row of broad.rows) {
    const symbol = row.symbol;
    const t = row.ticker || {};
    const mv = row.marketValue || {};
    state.marketSnapshots[symbol] = { at: Date.now(), price: tickerPrice(t), openInterest: tickerOpenInterest({ ...(t || {}), ...(mv || {}) }), volume24h: tickerVolume({ ...(t || {}), ...(mv || {}) }) };
  }

  state.scans += 1;
  state.lastScanId = scanId;
  state.lastExecution = executions.at(-1) || state.lastExecution;
  state.executionHistory.push(...executions.map((x) => ({
    at: Date.now(),
    scanId,
    symbol: x.symbol,
    direction: x.direction,
    entry: x.entry,
    tp: x.tp,
    notionalUsd: x.notionalUsd,
    collateralUsd: x.collateralUsd,
    txHash: x.txHash,
  })));
  await saveState(state);

  try {
    await sendTelegram(env, cycleMessage(report));
  } catch (error) {
    console.error("[TELEGRAM][CYCLE_ERROR]", safeError(error));
  }

  console.log("[CYCLE][END]", {
    scanId,
    status: report.status,
    universe: report.universe,
    broad5m: report.broadSuccess,
    deep: report.deepCount,
    entryReady: report.actionableCount,
    executed: report.executedCount,
    failures: report.failureCount,
  });

  return {
    ok: true,
    version: BOT_VERSION,
    scanId,
    report,
    wallet: {
      before: wallet.walletUsd,
      after: currentWallet.walletUsd,
    },
  };
}

export default {
  VERSION: BOT_VERSION,

  async scheduled(event, env) {
    try {
      if (String(env?.EMERGENCY_CLOSE_SYMBOL || "").trim()) {
        const runtime = await createRuntime(env);
        const result = await emergencyCloseIfRequested(runtime, env);
        console.log("[EMERGENCY_CLOSE][RESULT]", result);
        if (result?.executed) {
          await sendTelegram(env, `🚨 EMERGENCY CLOSE\n${safeJson(result)}`);
        }
        return result;
      }

      return await runCycle(event, env);
    } catch (error) {
      console.error("[CYCLE][FATAL]", {
        version: BOT_VERSION,
        error: safeError(error),
        sdk: SDK_LOAD_ERROR,
      });
      try {
        await sendTelegram(env, [
          `🔴 GMX BOT — CYCLE FATAL`,
          `━━━━━━━━━━━━━━━━━━`,
          `Version: ${BOT_VERSION}`,
          `Reason: ${safeError(error)}`,
          `🕐 ${new Date().toISOString()}`,
        ].join("\n"));
      } catch {}
      throw error;
    }
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({
        ok: true,
        version: BOT_VERSION,
        executionEnabled: executionEnabled(env),
        chainId: CHAIN_ID,
      }), {
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("GMX BOT OK", { status: 200 });
  },
};
