/*
╔══════════════════════════════════════════════════════════════════════════════╗
║ GMX SMART MONEY FUTURES AI BOT — V21.5 GLOBAL MARKET DATA CENTER + ROBUST DEEP DATA      ║
║ Single pipeline • 5M broad scan • 15M deep scan • Classic GMX only          ║
║ 20x leverage • 100% wallet • max 1 position • dynamic TP + structure SL               ║
╚══════════════════════════════════════════════════════════════════════════════╝

Architecture:
GMX MARKET UNIVERSE
  → FULL 5M BROAD SCAN
  → TOP DEEP CANDIDATES
  → 15M STRUCTURE + SMART-MONEY/OI/FLOW + S/R
  → TOP 1 ECONOMIC OPPORTUNITY
  → 100% WALLET COLLATERAL
  → 20x CLASSIC GMX MARKET INCREASE
  → ONE STRUCTURE TP (attached to the increase)
  → POSITION VERIFICATION
  → TELEGRAM

Important:
- Execution is direct on-chain Classic GMX only.
- Dynamic structure-based stop-loss + one TP.
- Stop-loss is attached to the opening increase via GMX TP/SL.
- No legacy radar lane.
- No parallel eligibility engine.
- Telegram is diagnostic/notification only.
- EXECUTION_ENABLED is an explicit emergency OFF switch.
*/

import { createRequire } from "node:module";
import { promises as fs } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);

export const BOT_VERSION = "V21.6.0-DYNAMIC-STRUCTURE-SL-20X";
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

  broadTimeframe: "5m",
  broadLimit: 72,
  deepTimeframe: "15m",
  deepLimit: 96,

  deepCandidates: 30,
  htfTimeframe: "1d",
  contextTimeframe: "4h",
  htfLimit: 96,
  contextLimit: 96,
  finalCandidates: 1,

  // V20.3: score ranks quality; trigger confidence controls timing.
  minScore: 68,
  minEdge: 8,
  reversalTriggerMinConfidence: 52,
  continuationTriggerMinConfidence: 52,
  setupDominanceMargin: 6,

  // Early-trend timing: prefer the first expansion/breakout phase over late confirmation.
  earlyImpulseMinAccelerationPct: 0.10,
  earlyImpulseMinMove3Pct: 0.25,
  earlyBreakLookback: 8,
  htfBreakLookback15: 4,
  lateChaseExtensionPct: 2.25,
  minTrendConfluence: 3,
  maxRisk: 55,

  minTpDistancePct: 0.30,
  maxTpDistancePct: 2.40,
  tpAtrMultiplier: 1.00,
  tpNearTermLookback5: 8,
  tpNearTermLookback15: 6,
  tpPreferNearTerm: true,
  tpReversalMaxPct: 1.80,
  tpContinuationMaxPct: 2.20,
  tpMinTargetScore: 52,

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

  // V21.2 Five-Layer Market Intelligence.
  // These are scoring/ranking inputs, not blanket hard gates.
  fiveLayerEnabled: true,
  trendLayerWeight: 0.22,
  locationLayerWeight: 0.20,
  momentumLayerWeight: 0.18,
  flowLayerWeight: 0.24,
  reversalLayerWeight: 0.16,
  htfConflictSoft: true,
  htfConflictOverrideMinReversal: 72,
  htfConflictOverrideMinFlow: 68,
  htfConflictOverrideMinLayerEdge: 62,

  // V21.2: direction authority. The five layers now decide the side;
  // HTF is context, not an unconditional direction override.
  directionAuthorityEnabled: true,
  reversalAuthorityMin: 68,
  reversalAuthorityEdge: 10,
  continuationAuthorityMin: 66,
  continuationAuthorityEdge: 10,
  // V21.3 Global Crypto Market Data Center. BTC/ETH define the market prior
  // before any individual market signal is authorized. Counter-trend trades
  // remain possible, but require materially stronger local reversal evidence.
  marketRegimeEnabled: true,
  marketRegimeTimeframes: ["5m", "15m", "1h", "4h", "1d"],
  marketRegimeBtcWeight: 0.60,
  marketRegimeEthWeight: 0.40,
  marketRegimeBullThreshold: 62,
  marketRegimeBearThreshold: 38,
  marketRegimeStrongThreshold: 72,
  marketRegimeCounterTrendPenalty: 10,
  marketRegimeCounterTrendReversalMin: 78,
  marketRegimeCounterTrendFlowMin: 72,
  marketRegimeCounterTrendEdgeMin: 14,
  marketRegimeSupportReliabilityBear: 0.65,
  marketRegimeResistanceReliabilityBull: 0.65,
  marketRegimeAlignedBonus: 8,
  marketRegimeBreadthWeight: 0.20,
  marketRegimeBtcEthAgreementMin: 60,
  locationConflictBlock: 34,
  momentumConflictBlock: 36,
  flowConflictBlock: 38,
  reversalContinuationGap: 5,

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

  // V21.5: protect the data pipeline from burst/rate-limit failures introduced
  // by the BTC/ETH market-data center. Never let macro intelligence starve
  // the individual-market deep scan.
  marketRegimeFrameConcurrency: 2,
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
  return num(
    ticker?.maxPrice ??
    ticker?.minPrice ??
    ticker?.markPrice ??
    ticker?.price ??
    ticker?.indexPrice ??
    ticker?.lastPrice
  );
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

function structureIndicators(candles, direction) {
  const closes = candles.map((c) => c.close);
  const price = closes.at(-1) || 0;
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const e200 = ema(closes, 200);
  const r = rsi(closes, 14);
  const m = macd(closes);
  const a = atr(candles, 14);
  const d = adx(candles, 14);
  const levels = recentSwingLevels(candles);

  const longTrend =
    price > e20 && e20 > e50 && e50 >= e200;
  const shortTrend =
    price < e20 && e20 < e50 && e50 <= e200;

  const trendConfluence = direction === "long"
    ? Number(price > e20) + Number(e20 > e50) + Number(m.histogram > 0) + Number(r > 50) + Number(d >= 18)
    : Number(price < e20) + Number(e20 < e50) + Number(m.histogram < 0) + Number(r < 50) + Number(d >= 18);

  const reaction = reactionScore(candles, direction);
  const move5 = candles.length >= 2 ? pct(price, closes.at(-2)) : 0;
  const move15 = candles.length >= 4 ? pct(price, closes.at(-4)) : 0;
  const rangePct = price ? (a / price) * 100 : 0;

  return {
    price,
    ema20: e20,
    ema50: e50,
    ema200: e200,
    rsi: r,
    macd: m,
    atr: a,
    adx: d,
    longTrend,
    shortTrend,
    trendConfluence,
    reaction,
    move5,
    move15,
    rangePct,
    levels,
  };
}

function oiDeltaScore(ticker, direction) {
  const candidates = [
    ticker?.openInterestChange5mPercent,
    ticker?.oiChange5mPercent,
    ticker?.openInterestDeltaPercent,
    ticker?.oiDeltaPercent,
    ticker?.openInterestChangePercent,
  ];
  const delta = candidates.map(num).find((x) => x !== 0) ?? 0;
  const priceMove = tickerChange5m(ticker);

  // Positive price + rising OI supports long continuation.
  // Negative price + rising OI supports short continuation.
  // Falling OI during a sharp move is treated as exhaustion rather than strong
  // confirmation.
  const aligned = direction === "long"
    ? priceMove > 0 && delta > 0
    : priceMove < 0 && delta > 0;
  const exhausted = direction === "long"
    ? priceMove > 0 && delta < 0
    : priceMove < 0 && delta < 0;

  return {
    delta,
    score: aligned ? 12 : exhausted ? -6 : 0,
    aligned,
    exhausted,
  };
}

function directionFromIndicators(five, fifteen, ticker) {
  const p5 = five.price;
  const p15 = fifteen.price;
  const bullish =
    Number(p5 > five.ema20) +
    Number(p5 > five.ema50) +
    Number(five.macd.histogram > 0) +
    Number(five.rsi >= 50) +
    Number(p15 > p15 ? false : p15 > fifteen.ema20) +
    Number(five.move15 > 0) +
    Number(fifteen.move15 > 0);
  const bearish =
    Number(p5 < five.ema20) +
    Number(p5 < five.ema50) +
    Number(five.macd.histogram < 0) +
    Number(five.rsi <= 50) +
    Number(p15 < fifteen.ema20) +
    Number(five.move15 < 0) +
    Number(fifteen.move15 < 0);

  if (bullish === bearish) {
    const change = tickerChange5m(ticker);
    return change >= 0 ? "long" : "short";
  }
  return bullish > bearish ? "long" : "short";
}

function exhaustiveReversalHint(five, fifteen, direction) {
  const move5 = Number(five.move5 || 0);
  const move15 = Number(five.move15 || 0);
  if (direction === "long") {
    return Number(five.rsi <= 42) + Number(five.macd.histogram >= 0) + Number(move5 > 0 && move15 < 0);
  }
  return Number(five.rsi >= 58) + Number(five.macd.histogram <= 0) + Number(move5 < 0 && move15 > 0);
}

function candleImpulseMetrics(candles) {
  const a = Array.isArray(candles) ? candles : [];
  if (a.length < 8) return { available:false, move3:0, move5:0, acceleration:0, rangeExpansion:0, bodyRatio:0, closeLocation:0, volumeRatio:1 };
  const last = a.at(-1), prev = a.at(-2), p3 = a.at(-4), p5 = a.at(-6);
  const close = num(last.close), prevClose = num(prev.close), c3 = num(p3.close), c5 = num(p5.close);
  const move3 = pct(close, c3), move5 = pct(close, c5);
  const prev3 = pct(c3, c5);
  const acceleration = move3 - prev3;
  const range = Math.max(num(last.high) - num(last.low), 1e-12);
  const priorRanges = a.slice(-8,-1).map(x => Math.max(num(x.high)-num(x.low),1e-12));
  const avgRange = priorRanges.reduce((x,y)=>x+y,0)/Math.max(priorRanges.length,1);
  const rangeExpansion = range / Math.max(avgRange,1e-12);
  const bodyRatio = Math.abs(num(last.close)-num(last.open))/range;
  const closeLocation = (num(last.close)-num(last.low))/range;
  const vols = a.slice(-8).map(x=>num(x.volume));
  const vAvg = vols.slice(0,-1).filter(x=>x>0).reduce((x,y)=>x+y,0)/Math.max(vols.slice(0,-1).filter(x=>x>0).length,1);
  const volumeRatio = num(last.volume)>0 && vAvg>0 ? num(last.volume)/vAvg : 1;
  return { available:true, move3, move5, acceleration, rangeExpansion, bodyRatio, closeLocation, volumeRatio };
}

function reversalMetrics(candles5, candles15, ticker, direction) {
  const m5 = candleImpulseMetrics(candles5), m15 = candleImpulseMetrics(candles15);
  const c = candles5.at(-1), p = candles5.at(-2), p2 = candles5.at(-3);
  const range = Math.max(num(c?.high)-num(c?.low),1e-12);
  const upperWick = num(c?.high)-Math.max(num(c?.open),num(c?.close));
  const lowerWick = Math.min(num(c?.open),num(c?.close))-num(c?.low);
  const bullishReject = lowerWick/range >= 0.30 && num(c?.close) > num(c?.open);
  const bearishReject = upperWick/range >= 0.30 && num(c?.close) < num(c?.open);
  const greenFlip = num(p?.close) < num(p?.open) && num(c?.close) > num(c?.open);
  const redFlip = num(p?.close) > num(p?.open) && num(c?.close) < num(c?.open);
  const momentumFlipLong = m5.move3 > 0 && m5.acceleration > 0;
  const momentumFlipShort = m5.move3 < 0 && m5.acceleration < 0;
  const rsi5 = rsi(candles5.map(x=>num(x.close)),14);
  const rsi15 = rsi(candles15.map(x=>num(x.close)),14);
  const oi = oiDeltaScore(ticker, direction);
  const longEvidence = [bullishReject, greenFlip, momentumFlipLong, rsi5 <= 45, m5.move5 < 0 && m5.move3 > 0, oi.exhausted && m5.move5 < 0].filter(Boolean).length;
  const shortEvidence = [bearishReject, redFlip, momentumFlipShort, rsi5 >= 55, m5.move5 > 0 && m5.move3 < 0, oi.exhausted && m5.move5 > 0].filter(Boolean).length;
  const longScore = clamp(longEvidence*12 + (bullishReject?12:0) + (greenFlip?10:0) + (m5.move3>0&&m5.acceleration>0?10:0) + (rsi5<=45?8:0),0,70);
  const shortScore = clamp(shortEvidence*12 + (bearishReject?12:0) + (redFlip?10:0) + (m5.move3<0&&m5.acceleration<0?10:0) + (rsi5>=55?8:0),0,70);
  return {m5,m15,bullishReject,bearishReject,greenFlip,redFlip,rsi5,rsi15,longEvidence,shortEvidence,longScore,shortScore,oi};
}

function classifyZone(candles, entry, atrValue, direction) {
  const levels = recentSwingLevels(candles);
  const atrSafe = Math.max(num(atrValue), entry*0.0001, 1e-12);
  const supports = (levels.support||[]).filter(x=>x<entry).sort((a,b)=>b-a);
  const resistances = (levels.resistance||[]).filter(x=>x>entry).sort((a,b)=>a-b);
  const support = supports[0] ?? null, resistance = resistances[0] ?? null;
  const nearSupport = support != null && Math.abs(entry-support) <= atrSafe*1.35;
  const nearResistance = resistance != null && Math.abs(resistance-entry) <= atrSafe*1.35;
  const state = direction === 'long' ? (nearSupport?'AT_SUPPORT': 'AWAY_FROM_ZONE') : (nearResistance?'AT_RESISTANCE':'AWAY_FROM_ZONE');
  return {levels,support,resistance,nearSupport,nearResistance,state};
}

function topDownLevelAnalysis(candles1d, candles4h, candles1h, price) {
  // V20.5: hierarchy is explicit: 1D -> 4H -> 1H -> 15M -> 5M.
  // Higher-timeframe S/R determines the structural side. Lower timeframes
  // are used only to confirm reaction/break and to time the entry.
  const frames = [
    { tf: "1D", candles: candles1d || [], weight: 3.4 },
    { tf: "4H", candles: candles4h || [], weight: 2.4 },
    { tf: "1H", candles: candles1h || [], weight: 1.5 },
  ];
  const levels = [];

  for (const frame of frames) {
    const c = frame.candles;
    if (!Array.isArray(c) || c.length < 20) continue;
    const completed = c.slice(0, -1);
    if (completed.length < 12) continue;
    const last = completed.at(-1) || {};
    const swings = recentSwingLevels(completed);
    const atrValue = Math.max(atr(completed, 14), price * 0.001, 1e-12);
    const high = num(last.high), low = num(last.low), open = num(last.open), close = num(last.close);
    const range = Math.max(high - low, 1e-12);
    const bodyRatio = Math.abs(close - open) / range;
    const closeLocation = (close - low) / range;

    for (const resistance of swings.resistance || []) {
      if (!(resistance > 0)) continue;
      const distPct = Math.abs(pct(resistance, price));
      if (distPct <= 5.0) levels.push({ type: "R", price: resistance, tf: frame.tf, weight: frame.weight, atr: atrValue, distPct, bodyRatio, closeLocation, lastHigh: high, lastLow: low, lastClose: close, lastOpen: open });
    }
    for (const support of swings.support || []) {
      if (!(support > 0)) continue;
      const distPct = Math.abs(pct(support, price));
      if (distPct <= 5.0) levels.push({ type: "S", price: support, tf: frame.tf, weight: frame.weight, atr: atrValue, distPct, bodyRatio, closeLocation, lastHigh: high, lastLow: low, lastClose: close, lastOpen: open });
    }
  }

  const supports = levels.filter(x => x.type === "S" && x.price < price).sort((a,b) => (a.distPct - b.distPct) || (b.weight - a.weight));
  const resistances = levels.filter(x => x.type === "R" && x.price > price).sort((a,b) => (a.distPct - b.distPct) || (b.weight - a.weight));
  const support = supports[0] || null;
  const resistance = resistances[0] || null;

  function interaction(level) {
    if (!level) return { near:false, reaction:false, break:false, strongBreak:false, failedBreak:false };
    const atrSafe = Math.max(level.atr, price * 0.001);
    const near = level.distPct <= (level.tf === "1D" ? 1.10 : level.tf === "4H" ? 0.90 : 0.70);
    const penetration = atrSafe * 0.12;
    const strongBody = level.bodyRatio >= 0.55;
    const strongRange = Math.abs(level.lastHigh - level.lastLow) >= atrSafe * 1.05;

    if (level.type === "S") {
      const reaction = near && level.lastLow <= level.price + atrSafe * 0.25 && level.lastClose >= level.price && level.lastClose > level.lastOpen;
      const strongBreak = level.lastClose < level.price - penetration && strongBody && strongRange;
      const failedBreak = level.lastLow < level.price - penetration && level.lastClose >= level.price;
      return { near, reaction, break:strongBreak, strongBreak, failedBreak };
    }

    const reaction = near && level.lastHigh >= level.price - atrSafe * 0.25 && level.lastClose <= level.price && level.lastClose < level.lastOpen;
    const strongBreak = level.lastClose > level.price + penetration && strongBody && strongRange;
    const failedBreak = level.lastHigh > level.price + penetration && level.lastClose <= level.price;
    return { near, reaction, break:strongBreak, strongBreak, failedBreak };
  }

  const s = interaction(support);
  const r = interaction(resistance);

  let state = "NEUTRAL";
  let preferredDirection = null;
  let confidence = 0;
  let controllingTimeframe = null;
  let levelPrice = null;

  // A decisive break of a major support/resistance reverses the expected side.
  // A genuine reaction from the level takes the opposite side. This ordering
  // is intentional: BREAK has priority over simple proximity/reaction.
  if (s.strongBreak) {
    state = "SUPPORT_BREAK";
    preferredDirection = "short";
    confidence = support?.tf === "1D" ? 98 : support?.tf === "4H" ? 94 : 90;
    controllingTimeframe = support?.tf || null;
    levelPrice = support?.price || null;
  } else if (r.strongBreak) {
    state = "RESISTANCE_BREAK";
    preferredDirection = "long";
    confidence = resistance?.tf === "1D" ? 98 : resistance?.tf === "4H" ? 94 : 90;
    controllingTimeframe = resistance?.tf || null;
    levelPrice = resistance?.price || null;
  } else if (s.reaction) {
    state = "SUPPORT_REACTION";
    preferredDirection = "long";
    confidence = support?.tf === "1D" ? 96 : support?.tf === "4H" ? 92 : 86;
    controllingTimeframe = support?.tf || null;
    levelPrice = support?.price || null;
  } else if (r.reaction) {
    state = "RESISTANCE_REACTION";
    preferredDirection = "short";
    confidence = resistance?.tf === "1D" ? 96 : resistance?.tf === "4H" ? 92 : 86;
    controllingTimeframe = resistance?.tf || null;
    levelPrice = resistance?.price || null;
  } else if (s.near) {
    state = "AT_SUPPORT";
    preferredDirection = "long";
    confidence = support?.tf === "1D" ? 72 : support?.tf === "4H" ? 68 : 62;
    controllingTimeframe = support?.tf || null;
    levelPrice = support?.price || null;
  } else if (r.near) {
    state = "AT_RESISTANCE";
    preferredDirection = "short";
    confidence = resistance?.tf === "1D" ? 72 : resistance?.tf === "4H" ? 68 : 62;
    controllingTimeframe = resistance?.tf || null;
    levelPrice = resistance?.price || null;
  }

  return {
    state, preferredDirection, confidence, controllingTimeframe, levelPrice,
    support, resistance,
    nearSupport: s.near, nearResistance: r.near,
    supportBreak: s.strongBreak, resistanceBreak: r.strongBreak,
    supportReaction: s.reaction, resistanceReaction: r.reaction,
    supportFailedBreak: s.failedBreak, resistanceFailedBreak: r.failedBreak,
    levels,
  };
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

function volumeProfile(candles, currentPrice) {
  const rows = (candles || []).slice(-CONFIG.volumeProfileLookback).filter(c => num(c.volume) > 0 && c.high >= c.low && c.close > 0);
  if (rows.length < 12) return { available: false, reason: "NO_CANDLE_VOLUME" };
  const low = Math.min(...rows.map(c => c.low)), high = Math.max(...rows.map(c => c.high));
  if (!(high > low)) return { available: false, reason: "FLAT_PRICE_RANGE" };
  const buckets = Math.max(8, Number(CONFIG.volumeProfileBuckets) || 24), width = (high - low) / buckets;
  const bins = Array.from({length:buckets},(_,i)=>({index:i,low:low+i*width,high:i===buckets-1?high:low+(i+1)*width,volume:0}));
  for (const c of rows) {
    const typical = (c.high + c.low + c.close) / 3;
    const idx = clamp(Math.floor((typical-low)/width),0,buckets-1);
    bins[idx].volume += num(c.volume);
  }
  const total = bins.reduce((a,b)=>a+b.volume,0); if (!(total>0)) return {available:false,reason:"ZERO_PROFILE_VOLUME"};
  const poc = bins.reduce((a,b)=>b.volume>a.volume?b:a,bins[0]);
  const sorted=[...bins].sort((a,b)=>b.volume-a.volume); const target=total*CONFIG.volumeProfileValueAreaPct; let acc=0; const value=[];
  for (const b of sorted){if(acc>=target)break;acc+=b.volume;value.push(b);}
  const valueLow=Math.min(...value.map(b=>b.low)), valueHigh=Math.max(...value.map(b=>b.high));
  const maxVol=poc.volume, hvn=bins.filter(b=>b.volume>=maxVol*0.65).map(b=>(b.low+b.high)/2), lvn=bins.filter(b=>b.volume<=maxVol*0.18).map(b=>(b.low+b.high)/2);
  const p=num(currentPrice), pocPrice=(poc.low+poc.high)/2; let zoneState="AWAY";
  if(p>=valueLow&&p<=valueHigh)zoneState="VALUE_AREA";
  if(Math.abs(p-pocPrice)<=width)zoneState="POC";
  if(hvn.some(x=>Math.abs(pct(p,x))<=0.35))zoneState="HVN";
  if(lvn.some(x=>Math.abs(pct(p,x))<=0.35))zoneState="LVN";
  return {available:true,poc:pocPrice,valueLow,valueHigh,hvn,lvn,zoneState,pocDistancePct:Number(Math.abs(pct(p,pocPrice)).toFixed(3)),totalVolume:total,binWidth:width};
}

function candleVolumeFlow(candles) {
  const rows=(candles||[]).filter(c=>num(c.volume)>0); if(rows.length<8)return {available:false,ratio:0,lastVolume:0};
  const recent=rows.slice(-3).reduce((a,c)=>a+num(c.volume),0)/3, baseRows=rows.slice(-21,-3), base=baseRows.length?baseRows.reduce((a,c)=>a+num(c.volume),0)/baseRows.length:recent;
  return {available:true,ratio:base>0?recent/base:0,lastVolume:num(rows.at(-1).volume)};
}

function capitalFlowEngine({ticker,marketValue,previousSnapshot,candles5,candles15,price}) {
  if(!CONFIG.capitalFlowEnabled)return {enabled:false,score:50,direction:null,state:"DISABLED",reasons:[]};
  const flow=marketFlowSnapshot(ticker,marketValue,previousSnapshot), v5=candleVolumeFlow(candles5), v15=candleVolumeFlow(candles15), profile=volumeProfile(candles15,price);
  let longScore=50, shortScore=50; const reasons=[];
  if(flow.flowDirection==="long")longScore+=16; if(flow.flowDirection==="short")shortScore+=16;
  if(flow.smartMoneyProxy>=65){if(flow.flowDirection==="long")longScore+=10;if(flow.flowDirection==="short")shortScore+=10;}
  if(v5.available&&v5.ratio>=CONFIG.volumeExpansionMinRatio){if(flow.priceDeltaPct>=0)longScore+=10;else shortScore+=10;reasons.push("5M_VOLUME_EXPANSION");}
  if(v15.available&&v15.ratio>=CONFIG.volumeExpansionMinRatio){if(flow.priceDeltaPct>=0)longScore+=8;else shortScore+=8;reasons.push("15M_VOLUME_EXPANSION");}
  if(Math.abs(flow.oiDeltaPct)>=CONFIG.oiExpansionMinPct){if(flow.priceDeltaPct>0&&flow.oiDeltaPct>0)longScore+=10;if(flow.priceDeltaPct<0&&flow.oiDeltaPct>0)shortScore+=10;reasons.push("OI_EXPANSION");}
  if(flow.longOi>0&&flow.shortOi>0){if(flow.sideBias>=10)longScore+=7;if(flow.sideBias<=-10)shortScore+=7;}
  if(profile.available){if(profile.zoneState==="LVN")reasons.push("LOW_VOLUME_NODE");if(profile.zoneState==="HVN"||profile.zoneState==="POC")reasons.push("HIGH_VOLUME_NODE");}
  const direction=longScore===shortScore?flow.flowDirection:longScore>shortScore?"long":"short", score=Number(clamp(direction==="long"?longScore:shortScore,0,100).toFixed(1));
  if(score>=CONFIG.capitalFlowMinScore)reasons.push(`FLOW_${score.toFixed(0)}`);
  return {enabled:true,score,longScore:Number(clamp(longScore,0,100).toFixed(1)),shortScore:Number(clamp(shortScore,0,100).toFixed(1)),direction,state:flow.flowState,smartMoneyProxy:flow.smartMoneyProxy,oiDeltaPct:flow.oiDeltaPct,volumeDeltaPct:flow.volumeDeltaPct,priceDeltaPct:flow.priceDeltaPct,longOi:flow.longOi,shortOi:flow.shortOi,sideBias:flow.sideBias,volumeRatio5m:v5.ratio,volumeRatio15m:v15.ratio,profile,reasons:[...flow.evidence,...reasons]};
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

function bollingerBands(values, period = 20, multiplier = 2) {
  const a = Array.isArray(values) ? values : [];
  if (a.length < period) return { available: false, mid: 0, upper: 0, lower: 0, widthPct: 0, position: 0.5 };
  const window = a.slice(-period);
  const mid = sma(window, period);
  const variance = window.reduce((sum, x) => sum + (x - mid) ** 2, 0) / window.length;
  const sd = Math.sqrt(Math.max(variance, 0));
  const upper = mid + multiplier * sd;
  const lower = mid - multiplier * sd;
  const price = a.at(-1);
  const widthPct = mid > 0 ? ((upper - lower) / mid) * 100 : 0;
  const position = upper > lower ? clamp((price - lower) / (upper - lower), 0, 1) : 0.5;
  return { available: true, mid, upper, lower, widthPct, position };
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

function rsiDivergence(candles, period = 14, lookback = 30) {
  const rows = Array.isArray(candles) ? candles : [];
  if (rows.length < period + 8) return { available: false, bullish: false, bearish: false, strength: 0 };
  const recent = rows.slice(-Math.max(lookback, period + 8));
  const closes = recent.map(x => num(x.close));
  const rsis = closes.map((_, i) => i < period ? 50 : rsi(closes.slice(0, i + 1), period));
  const split = Math.max(3, Math.floor(recent.length / 2));
  const first = recent.slice(0, split), second = recent.slice(-split);
  const firstClose = first.at(-1)?.close ?? 0, secondClose = second.at(-1)?.close ?? 0;
  const firstRsi = rsis[Math.max(0, split - 1)] ?? 50, secondRsi = rsis.at(-1) ?? 50;
  const firstLow = Math.min(...first.map(x => num(x.low)));
  const secondLow = Math.min(...second.map(x => num(x.low)));
  const firstHigh = Math.max(...first.map(x => num(x.high)));
  const secondHigh = Math.max(...second.map(x => num(x.high)));
  // Price lower-low + RSI higher-low = bullish divergence.
  // Price higher-high + RSI lower-high = bearish divergence.
  const bullish = secondLow < firstLow && secondRsi > firstRsi + 2;
  const bearish = secondHigh > firstHigh && secondRsi < firstRsi - 2;
  const strength = bullish ? clamp((secondRsi - firstRsi) * 5, 0, 25)
    : bearish ? clamp((firstRsi - secondRsi) * 5, 0, 25) : 0;
  return { available: true, bullish, bearish, strength, firstRsi, secondRsi, firstClose, secondClose };
}

function fibonacciLevels(candles, lookback = 72) {
  const rows = (Array.isArray(candles) ? candles : []).slice(-lookback);
  if (rows.length < 12) return { available: false, swingHigh: 0, swingLow: 0, retracement: {}, extension: {} };
  const swingHigh = Math.max(...rows.map(x => num(x.high)));
  const swingLow = Math.min(...rows.map(x => num(x.low)));
  const range = swingHigh - swingLow;
  if (!(range > 0)) return { available: false, swingHigh, swingLow, retracement: {}, extension: {} };
  const retracement = {
    r236: swingHigh - range * 0.236,
    r382: swingHigh - range * 0.382,
    r500: swingHigh - range * 0.500,
    r618: swingHigh - range * 0.618,
    r786: swingHigh - range * 0.786,
  };
  const extension = {
    e1272Long: swingHigh + range * 0.272,
    e1618Long: swingHigh + range * 0.618,
    e1272Short: swingLow - range * 0.272,
    e1618Short: swingLow - range * 0.618,
  };
  return { available: true, swingHigh, swingLow, range, retracement, extension };
}

function nearestFibZone(price, fib, atrValue) {
  if (!fib?.available || !(price > 0)) return { near: false, level: null, type: null, distancePct: 0 };
  const values = [
    ["R23.6", fib.retracement.r236], ["R38.2", fib.retracement.r382],
    ["R50", fib.retracement.r500], ["R61.8", fib.retracement.r618], ["R78.6", fib.retracement.r786],
  ].filter(([, x]) => Number.isFinite(x) && x > 0);
  const tolerance = Math.max(num(atrValue) * 0.45, price * 0.0025);
  let best = null;
  for (const [type, level] of values) {
    const d = Math.abs(price - level);
    if (!best || d < best.d) best = { type, level, d };
  }
  return best && best.d <= tolerance
    ? { near: true, level: best.level, type: best.type, distancePct: Math.abs(pct(price, best.level)) }
    : { near: false, level: best?.level ?? null, type: best?.type ?? null, distancePct: best ? Math.abs(pct(price, best.level)) : 0 };
}

function trendLayer(candles5, candles15, candles1h, candles4h, candles1d) {
  const frames = [
    ["5M", candles5, 1],
    ["15M", candles15, 1.4],
    ["1H", candles1h, 1.8],
    ["4H", candles4h, 2.2],
    ["1D", candles1d, 2.8],
  ];
  let long = 50, short = 50, weight = 0, evidence = [];
  for (const [tf, rows, w] of frames) {
    if (!Array.isArray(rows) || rows.length < 30) continue;
    const closes = rows.map(x => num(x.close));
    const price = closes.at(-1);
    const e20 = ema(closes, 20), e50 = ema(closes, 50), e200 = ema(closes, 200);
    const m = macd(closes), a = adx(rows, 14), ichi = ichimoku(rows), r = rsi(closes, 14);
    const votesLong = Number(price > e20) + Number(e20 > e50) + Number(e50 >= e200) + Number(m.histogram > 0) + Number(r > 50) + Number(a >= 18) + Number(ichi.bullish);
    const votesShort = Number(price < e20) + Number(e20 < e50) + Number(e50 <= e200) + Number(m.histogram < 0) + Number(r < 50) + Number(a >= 18) + Number(ichi.bearish);
    long += (votesLong - 3.5) * w * 2.0;
    short += (votesShort - 3.5) * w * 2.0;
    weight += w;
    if (votesLong >= 5) evidence.push(`${tf}_LONG`);
    if (votesShort >= 5) evidence.push(`${tf}_SHORT`);
  }
  return {
    long: Number(clamp(long, 0, 100).toFixed(1)),
    short: Number(clamp(short, 0, 100).toFixed(1)),
    direction: long === short ? null : long > short ? "long" : "short",
    evidence,
    available: weight > 0,
  };
}

function locationLayer(candles5, candles15, candles1h, candles4h, candles1d, price, atrValue) {
  const frames = [candles5, candles15, candles1h, candles4h, candles1d].filter(x => Array.isArray(x) && x.length >= 20);
  const fib5 = fibonacciLevels(candles5), fib15 = fibonacciLevels(candles15);
  const fib = fib15.available ? fib15 : fib5;
  const fibZone = nearestFibZone(price, fib, atrValue);
  const bb = bollingerBands((candles5 || []).map(x => num(x.close)), 20, 2);
  const topDown = topDownLevelAnalysis(candles1d, candles4h, candles1h, price);
  let long = 50, short = 50, reasons = [];
  if (topDown.supportReaction || topDown.nearSupport) { long += 18; reasons.push("HTF_SUPPORT"); }
  if (topDown.resistanceReaction || topDown.nearResistance) { short += 18; reasons.push("HTF_RESISTANCE"); }
  if (fibZone.near) {
    if (fibZone.type === "R61.8" || fibZone.type === "R78.6") { long += 8; short += 8; }
    else { long += 5; short += 5; }
    reasons.push(`FIB_${fibZone.type}`);
  }
  if (bb.available) {
    if (bb.position <= 0.15) { long += 10; reasons.push("BB_LOWER_EXTREME"); }
    if (bb.position >= 0.85) { short += 10; reasons.push("BB_UPPER_EXTREME"); }
    if (bb.widthPct <= 1.2) reasons.push("BB_SQUEEZE");
  }
  const sr5 = recentSwingLevels(candles5 || []);
  const nearestSupport = (sr5.support || []).filter(x => x < price).sort((a,b) => b-a)[0];
  const nearestResistance = (sr5.resistance || []).filter(x => x > price).sort((a,b) => a-b)[0];
  if (nearestSupport && Math.abs(price - nearestSupport) <= Math.max(atrValue * 1.35, price * 0.003)) long += 12;
  if (nearestResistance && Math.abs(nearestResistance - price) <= Math.max(atrValue * 1.35, price * 0.003)) short += 12;
  return {
    long: Number(clamp(long, 0, 100).toFixed(1)), short: Number(clamp(short, 0, 100).toFixed(1)),
    direction: long === short ? null : long > short ? "long" : "short",
    fib, fibZone, bollinger: bb, topDown, reasons, available: frames.length > 0,
  };
}

function momentumLayer(candles5, candles15) {
  const c5 = candles5 || [], c15 = candles15 || [];
  const closes5 = c5.map(x => num(x.close)), closes15 = c15.map(x => num(x.close));
  const r5 = rsi(closes5, 14), r15 = rsi(closes15, 14);
  const s5 = stochastic(c5), s15 = stochastic(c15);
  const b5 = bollingerBands(closes5, 20, 2);
  const m5 = macd(closes5);
  const div5 = rsiDivergence(c5);
  let long = 50, short = 50, reasons = [];
  if (r5 < 38) { long += 14; reasons.push("RSI_OVERSOLD"); }
  if (r5 > 62) { short += 14; reasons.push("RSI_OVERBOUGHT"); }
  if (s5.available && s5.k < 20 && s5.k > s5.d) { long += 14; reasons.push("STOCH_BULL_CROSS_LOW"); }
  if (s5.available && s5.k > 80 && s5.k < s5.d) { short += 14; reasons.push("STOCH_BEAR_CROSS_HIGH"); }
  if (s15.available && s15.k < 25) long += 6;
  if (s15.available && s15.k > 75) short += 6;
  if (m5.histogram > 0) long += 8;
  if (m5.histogram < 0) short += 8;
  if (div5.bullish) { long += 18; reasons.push("RSI_BULL_DIV"); }
  if (div5.bearish) { short += 18; reasons.push("RSI_BEAR_DIV"); }
  if (b5.available && b5.position <= 0.12) long += 8;
  if (b5.available && b5.position >= 0.88) short += 8;
  // Avoid treating extreme RSI as automatic entry: it is exhaustion context.
  if (r5 > 78) long -= 8;
  if (r5 < 22) short -= 8;
  return {
    long: Number(clamp(long, 0, 100).toFixed(1)), short: Number(clamp(short, 0, 100).toFixed(1)),
    direction: long === short ? null : long > short ? "long" : "short",
    rsi5: r5, rsi15: r15, stochastic5: s5, stochastic15: s15, bollinger: b5,
    macd: m5, divergence: div5, reasons, available: closes5.length >= 20,
  };
}

function fiveLayerEngine({ candles5, candles15, candles1h, candles4h, candles1d, capitalFlow, price, atrValue }) {
  const trend = trendLayer(candles5, candles15, candles1h, candles4h, candles1d);
  const location = locationLayer(candles5, candles15, candles1h, candles4h, candles1d, price, atrValue);
  const momentum = momentumLayer(candles5, candles15);
  const flowScoreLong = num(capitalFlow?.longScore, 50);
  const flowScoreShort = num(capitalFlow?.shortScore, 50);
  const flow = {
    long: flowScoreLong, short: flowScoreShort,
    direction: flowScoreLong === flowScoreShort ? capitalFlow?.direction : flowScoreLong > flowScoreShort ? "long" : "short",
    state: capitalFlow?.state || "NEUTRAL",
    smartMoneyProxy: num(capitalFlow?.smartMoneyProxy, 50),
    reasons: capitalFlow?.reasons || [],
    available: Boolean(capitalFlow?.enabled),
  };
  const reversalRaw = reversalMetrics(candles5, candles15, null, "long");
  const reversalShortRaw = reversalMetrics(candles5, candles15, null, "short");
  const reversal = {
    long: Number(clamp(reversalRaw.longScore + (momentum.divergence?.bullish ? 18 : 0) + (location.fibZone?.near ? 5 : 0), 0, 100).toFixed(1)),
    short: Number(clamp(reversalShortRaw.shortScore + (momentum.divergence?.bearish ? 18 : 0) + (location.fibZone?.near ? 5 : 0), 0, 100).toFixed(1)),
    direction: null,
    reasons: [...reversalRaw.longEvidence ? ["REVERSAL_PRICE_ACTION"] : [], ...reversalShortRaw.shortEvidence ? ["REVERSAL_PRICE_ACTION"] : []],
    available: true,
  };
  reversal.direction = reversal.long === reversal.short ? null : reversal.long > reversal.short ? "long" : "short";

  const weights = {
    trend: CONFIG.trendLayerWeight, location: CONFIG.locationLayerWeight,
    momentum: CONFIG.momentumLayerWeight, flow: CONFIG.flowLayerWeight, reversal: CONFIG.reversalLayerWeight,
  };
  const long = trend.long * weights.trend + location.long * weights.location + momentum.long * weights.momentum + flow.long * weights.flow + reversal.long * weights.reversal;
  const short = trend.short * weights.trend + location.short * weights.location + momentum.short * weights.momentum + flow.short * weights.flow + reversal.short * weights.reversal;
  const weightedLong = Number(clamp(long, 0, 100).toFixed(1));
  const weightedShort = Number(clamp(short, 0, 100).toFixed(1));
  const weightedDirection = weightedLong === weightedShort ? null : weightedLong > weightedShort ? "long" : "short";

  // V21.2 DIRECTION AUTHORITY:
  // A strong, confirmed reversal is allowed to beat a stale trend score.
  // A continuation is allowed only when breakout/momentum/flow agree.
  // This prevents the exact failure where a resistance rejection was still
  // forced LONG because the higher-timeframe trend happened to be bullish.
  const reversalLong = Number(reversal.long);
  const reversalShort = Number(reversal.short);
  const reversalDirection = reversalLong === reversalShort ? null : reversalLong > reversalShort ? "long" : "short";
  const reversalEdge = Math.abs(reversalLong - reversalShort);
  const continuationLong = Number(clamp((trend.long * 0.45) + (momentum.long * 0.25) + (flow.long * 0.30), 0, 100));
  const continuationShort = Number(clamp((trend.short * 0.45) + (momentum.short * 0.25) + (flow.short * 0.30), 0, 100));
  const continuationDirection = continuationLong === continuationShort ? null : continuationLong > continuationShort ? "long" : "short";
  const continuationEdge = Math.abs(continuationLong - continuationShort);

  const reversalStrongLong = reversalLong >= CONFIG.reversalAuthorityMin && reversalDirection === "long" && reversalEdge >= CONFIG.reversalAuthorityEdge;
  const reversalStrongShort = reversalShort >= CONFIG.reversalAuthorityMin && reversalDirection === "short" && reversalEdge >= CONFIG.reversalAuthorityEdge;
  const reversalAuthority = reversalStrongLong ? "long" : reversalStrongShort ? "short" : null;
  const continuationStrongLong = continuationLong >= CONFIG.continuationAuthorityMin && continuationDirection === "long" && continuationEdge >= CONFIG.continuationAuthorityEdge;
  const continuationStrongShort = continuationShort >= CONFIG.continuationAuthorityMin && continuationDirection === "short" && continuationEdge >= CONFIG.continuationAuthorityEdge;
  const continuationAuthority = continuationStrongLong ? "long" : continuationStrongShort ? "short" : null;

  let direction = weightedDirection;
  let authority = "WEIGHTED";
  if (CONFIG.directionAuthorityEnabled) {
    if (reversalAuthority && (!continuationAuthority || (reversalAuthority === continuationAuthority ? reversalEdge >= continuationEdge : reversalEdge >= continuationEdge - CONFIG.reversalContinuationGap))) {
      direction = reversalAuthority;
      authority = "REVERSAL";
    } else if (continuationAuthority) {
      direction = continuationAuthority;
      authority = "CONTINUATION";
    }
  }
  const confidence = Number(clamp(Math.max(weightedLong, weightedShort), 0, 100).toFixed(1));
  const edge = Number(clamp(Math.abs(weightedLong - weightedShort), 0, 100).toFixed(1));
  return {
    enabled: CONFIG.fiveLayerEnabled,
    direction, confidence, edge, authority,
    long: weightedLong, short: weightedShort,
    reversalAuthority, reversalEdge: Number(reversalEdge.toFixed(1)),
    continuationAuthority, continuationLong: Number(continuationLong.toFixed(1)), continuationShort: Number(continuationShort.toFixed(1)), continuationEdge: Number(continuationEdge.toFixed(1)),
    weights, trend, location, momentum, flow, reversal,
  };
}

function scoreCandidate({ market, ticker, marketValue, previousSnapshot, candles5, candles15, candles1h, candles4h, candles1d, marketRegime }) {
  const five = structureIndicators(candles5, 'long');
  const fifteen = structureIndicators(candles15, 'long');
  const price = five.price;
  const topDown = topDownLevelAnalysis(candles1d, candles4h, candles1h, price);
  const impulse = candleImpulseMetrics(candles5);
  const capitalFlow = capitalFlowEngine({ ticker, marketValue, previousSnapshot, candles5, candles15, price });
  const fiveLayers = fiveLayerEngine({
    candles5, candles15, candles1h, candles4h, candles1d,
    capitalFlow, price, atrValue: five.atr,
  });
  const rLong = reversalMetrics(candles5, candles15, ticker, 'long');
  const rShort = reversalMetrics(candles5, candles15, ticker, 'short');

  const longContext = Number(five.macd.histogram > 0) + Number(five.rsi > 50) + Number(fifteen.macd.histogram > 0) + Number(fifteen.rsi > 50);
  const shortContext = Number(five.macd.histogram < 0) + Number(five.rsi < 50) + Number(fifteen.macd.histogram < 0) + Number(fifteen.rsi < 50);
  const zoneLong = classifyZone(candles5, price, five.atr, 'long');
  const zoneShort = classifyZone(candles5, price, five.atr, 'short');

  // -----------------------------------------------------------------------
  // V20.3: TRIGGER-FIRST SETUP CLASSIFIER
  // Score is now a quality/ranking metric, NOT the timing trigger.
  // We explicitly compare REVERSAL vs CONTINUATION before deciding direction.
  // These are model-confidence scores, not statistically calibrated win rates.
  // -----------------------------------------------------------------------
  const lookbackN = Number(CONFIG.earlyBreakLookback) || 8;
  const lookback = candles5.slice(-lookbackN - 1, -1);
  const priorHigh = lookback.length ? Math.max(...lookback.map(x => num(x.high)).filter(Number.isFinite)) : 0;
  const priorLow = lookback.length ? Math.min(...lookback.map(x => num(x.low)).filter(Number.isFinite)) : 0;
  const firstBreakLong = priorHigh > 0 && price > priorHigh;
  const firstBreakShort = priorLow > 0 && price < priorLow;

  // V20.4.2: a 5m-only breakout can disappear after the first few candles.
  // Keep a higher-timeframe breakout state so a still-live 15m expansion
  // cannot be mistaken for a reversal merely because the 5m window no longer
  // sits above its local 8-candle high.
  const completed15 = candles15.slice(0, -1);
  const htfLookback = Math.max(3, Number(CONFIG.htfBreakLookback15) || 4);
  const htfWindow = completed15.slice(-htfLookback);
  const htfPriorHigh = htfWindow.length ? Math.max(...htfWindow.map(x => num(x.high)).filter(Number.isFinite)) : 0;
  const htfPriorLow = htfWindow.length ? Math.min(...htfWindow.map(x => num(x.low)).filter(Number.isFinite)) : 0;
  const htfLast = candles15.at(-1) || {};
  const htfLastClose = num(htfLast.close);
  const htfLastHigh = num(htfLast.high);
  const htfLastLow = num(htfLast.low);
  const htfRange = Math.max(htfLastHigh - htfLastLow, 1e-12);
  const htfCloseLocation = (htfLastClose - htfLastLow) / htfRange;
  const htfBreakLong = htfPriorHigh > 0 && htfLastClose > htfPriorHigh;
  const htfBreakShort = htfPriorLow > 0 && htfLastClose < htfPriorLow;
  const htfStrongBreakLong = Boolean(htfBreakLong && (htfCloseLocation >= 0.65 || impulse.m15 > 0.45));
  const htfStrongBreakShort = Boolean(htfBreakShort && (htfCloseLocation <= 0.35 || impulse.m15 < -0.45));
  const htfFailedBreakLong = Boolean(htfPriorHigh > 0 && htfLastHigh > htfPriorHigh && htfLastClose < htfPriorHigh);
  const htfFailedBreakShort = Boolean(htfPriorLow > 0 && htfLastLow < htfPriorLow && htfLastClose > htfPriorLow);

  const preMove = pct(num(candles5.at(-2)?.close), num(candles5.at(-Math.min(8, candles5.length))?.close));
  const currentMove = impulse.move3;
  const priorMoveOppositeLong = preMove < -0.35;
  const priorMoveOppositeShort = preMove > 0.35;
  const directionalDisplacementLong = currentMove > 0.15 && impulse.acceleration > 0.03;
  const directionalDisplacementShort = currentMove < -0.15 && impulse.acceleration < -0.03;
  const freshExpansion = impulse.rangeExpansion >= 1.15 || impulse.volumeRatio >= 1.20;
  const compressionBase = candles5.slice(-14, -3);
  const avgCompressionRange = compressionBase.length
    ? compressionBase.reduce((a, x) => a + Math.max(0, num(x.high) - num(x.low)), 0) / compressionBase.length
    : 0;
  const previousRange = Math.max(0, num(candles5.at(-2)?.high) - num(candles5.at(-2)?.low));
  const preCompression = avgCompressionRange > 0 && previousRange <= avgCompressionRange * 0.95;

  const reversalLongRaw =
    (zoneLong.nearSupport ? 24 : 0) +
    (rLong.bullishReject ? 22 : 0) +
    (rLong.greenFlip ? 12 : 0) +
    (priorMoveOppositeLong ? 16 : 0) +
    (directionalDisplacementLong ? 10 : 0) +
    (rLong.oi?.exhausted && impulse.move5 < 0 ? 8 : 0) +
    (rLong.rsi5 <= 45 ? 5 : 0);
  const reversalShortRaw =
    (zoneShort.nearResistance ? 24 : 0) +
    (rShort.bearishReject ? 22 : 0) +
    (rShort.redFlip ? 12 : 0) +
    (priorMoveOppositeShort ? 16 : 0) +
    (directionalDisplacementShort ? 10 : 0) +
    (rShort.oi?.exhausted && impulse.move5 > 0 ? 8 : 0) +
    (rShort.rsi5 >= 55 ? 5 : 0);

  const continuationLongRaw =
    (firstBreakLong ? 24 : 0) +
    (directionalDisplacementLong ? 20 : 0) +
    (freshExpansion ? 14 : 0) +
    (preCompression ? 10 : 0) +
    (impulse.volumeRatio >= 1.35 ? 8 : 0) +
    (Math.abs(impulse.acceleration) >= 0.10 ? 8 : 0) +
    (longContext >= 2 ? 8 : 0);
  const continuationShortRaw =
    (firstBreakShort ? 24 : 0) +
    (directionalDisplacementShort ? 20 : 0) +
    (freshExpansion ? 14 : 0) +
    (preCompression ? 10 : 0) +
    (impulse.volumeRatio >= 1.35 ? 8 : 0) +
    (Math.abs(impulse.acceleration) >= 0.10 ? 8 : 0) +
    (shortContext >= 2 ? 8 : 0);

  // -----------------------------------------------------------------------
  // V20.4.1: REVERSAL VALIDATION / BREAKOUT FAILURE FILTER
  // A strong breakout in the opposite direction must NOT be faded merely
  // because price is touching resistance/support. A reversal becomes valid
  // only after the breakout actually fails (close back through the broken
  // level) or a genuine rejection/momentum flip appears.
  // -----------------------------------------------------------------------
  const close = price;
  const lastHigh = num(candles5.at(-1)?.high);
  const lastLow = num(candles5.at(-1)?.low);
  const closeNearHigh = impulse.rangeExpansion >= 1.15 && impulse.closeLocation >= 0.68;
  const closeNearLow = impulse.rangeExpansion >= 1.15 && impulse.closeLocation <= 0.32;
  const strongBreakLong = Boolean(firstBreakLong && (directionalDisplacementLong || closeNearHigh || impulse.rangeExpansion >= 1.45));
  const strongBreakShort = Boolean(firstBreakShort && (directionalDisplacementShort || closeNearLow || impulse.rangeExpansion >= 1.45));
  const failedBreakLong = Boolean(priorHigh > 0 && lastHigh > priorHigh && close < priorHigh);
  const failedBreakShort = Boolean(priorLow > 0 && lastLow < priorLow && close > priorLow);
  const genuineShortFailure = Boolean(failedBreakLong || htfFailedBreakLong || (rShort.bearishReject && rShort.redFlip && impulse.acceleration < 0));
  const genuineLongFailure = Boolean(failedBreakShort || htfFailedBreakShort || (rLong.bullishReject && rLong.greenFlip && impulse.acceleration > 0));

  // V20.4.2: a reversal against a live 15m breakout is invalid until that
  // breakout fails. This closes the gap that allowed a 5m/local resistance
  // reading to create a SHORT while the higher-timeframe move was still
  // expanding.
  const liveBreakLong = Boolean(strongBreakLong || htfStrongBreakLong);
  const liveBreakShort = Boolean(strongBreakShort || htfStrongBreakShort);

  // Hard penalty against fading a live breakout. Touching resistance/support
  // alone is not a reversal signal. Once a breakout is live, wait for failure.
  let reversalLong = reversalLongRaw;
  let reversalShort = reversalShortRaw;
  if (liveBreakShort && !genuineLongFailure) reversalLong -= 40;
  if (liveBreakLong && !genuineShortFailure) reversalShort -= 40;
  if (liveBreakLong && genuineShortFailure) reversalShort += 8;
  if (liveBreakShort && genuineLongFailure) reversalLong += 8;
  reversalLong = clamp(reversalLong, 0, 100);
  reversalShort = clamp(reversalShort, 0, 100);
  let continuationLong = clamp(continuationLongRaw + (strongBreakLong ? 10 : 0), 0, 100);
  let continuationShort = clamp(continuationShortRaw + (strongBreakShort ? 10 : 0), 0, 100);

  // V21.2: HTF remains structural context, but it no longer forcibly sets
  // direction. A confirmed reversal may legitimately trade against the HTF.
  // HTF only penalizes weak counter-trend ideas; strong layer authority wins.
  const htfLong = topDown.preferredDirection === "long";
  const htfShort = topDown.preferredDirection === "short";
  if (htfLong) {
    reversalLong += topDown.confidence * 0.05;
    continuationLong += topDown.confidence * 0.08;
    reversalShort -= 10;
    continuationShort -= 8;
  } else if (htfShort) {
    reversalShort += topDown.confidence * 0.05;
    continuationShort += topDown.confidence * 0.08;
    reversalLong -= 10;
    continuationLong -= 8;
  }
  if (topDown.supportBreak) { reversalLong -= 70; continuationShort += 28; }
  if (topDown.resistanceBreak) { reversalShort -= 70; continuationLong += 28; }
  if (topDown.supportReaction) { reversalLong += 28; continuationShort -= 35; }
  if (topDown.resistanceReaction) { reversalShort += 28; continuationLong -= 35; }
  reversalLong = clamp(reversalLong, 0, 100);
  reversalShort = clamp(reversalShort, 0, 100);
  continuationLong = clamp(continuationLong, 0, 100);
  continuationShort = clamp(continuationShort, 0, 100);

  // V21.3 GLOBAL MARKET PRIOR: BTC/ETH + market breadth are applied before
  // REVERSAL/CONTINUATION classification. In a bearish crypto regime, old
  // support is discounted and short continuation/reversal gets preference;
  // the inverse applies in a bullish regime. Strong local reversals can still
  // override the macro prior, but must prove themselves.
  if (marketRegime?.enabled) {
    const macro = marketRegime.direction;
    const macroStrength = clamp(num(marketRegime.confidence, 0) / 30, 0, 1.25);
    if (macro === "short") {
      continuationShort += 8 * macroStrength;
      continuationLong -= 8 * macroStrength;
      reversalShort += 5 * macroStrength;
      reversalLong -= 6 * macroStrength;
      if (marketRegime.supportReliability < 1) reversalLong -= 8 * (1 - marketRegime.supportReliability);
    } else if (macro === "long") {
      continuationLong += 8 * macroStrength;
      continuationShort -= 8 * macroStrength;
      reversalLong += 5 * macroStrength;
      reversalShort -= 6 * macroStrength;
      if (marketRegime.resistanceReliability < 1) reversalShort -= 8 * (1 - marketRegime.resistanceReliability);
    }
  }
  reversalLong = clamp(reversalLong, 0, 100);
  reversalShort = clamp(reversalShort, 0, 100);
  continuationLong = clamp(continuationLong, 0, 100);
  continuationShort = clamp(continuationShort, 0, 100);

  const bestReversal = Math.max(reversalLong, reversalShort);
  const bestContinuation = Math.max(continuationLong, continuationShort);
  const reversalDirection = reversalLong >= reversalShort ? 'long' : 'short';
  const continuationDirection = continuationLong >= continuationShort ? 'long' : 'short';

  // V21.2: setup classification is independent of HTF direction.
  // REVERSAL requires prior displacement + reaction/zone + directional flip.
  // CONTINUATION requires fresh expansion/breakout and layer agreement.
  const reversalSideLayer = reversalDirection === 'long' ? fiveLayers.reversal.long : fiveLayers.reversal.short;
  const reversalSideMomentum = reversalDirection === 'long' ? fiveLayers.momentum.long : fiveLayers.momentum.short;
  const reversalSideLocation = reversalDirection === 'long' ? fiveLayers.location.long : fiveLayers.location.short;
  const reversalSideFlow = reversalDirection === 'long' ? fiveLayers.flow.long : fiveLayers.flow.short;
  const reversalStrong = bestReversal >= Number(CONFIG.reversalAuthorityMin || 68) &&
    Math.abs(reversalLong - reversalShort) >= Number(CONFIG.reversalAuthorityEdge || 10) &&
    reversalSideMomentum >= 45 && reversalSideLocation >= 45 &&
    ((reversalDirection === 'long' && priorMoveOppositeLong && (zoneLong.nearSupport || rLong.bullishReject || fiveLayers.momentum.divergence?.bullish)) ||
     (reversalDirection === 'short' && priorMoveOppositeShort && (zoneShort.nearResistance || rShort.bearishReject || fiveLayers.momentum.divergence?.bearish))) &&
    !((reversalDirection === 'long' && liveBreakShort && !genuineLongFailure) ||
      (reversalDirection === 'short' && liveBreakLong && !genuineShortFailure));

  const continuationSideTrend = continuationDirection === 'long' ? fiveLayers.trend.long : fiveLayers.trend.short;
  const continuationSideMomentum = continuationDirection === 'long' ? fiveLayers.momentum.long : fiveLayers.momentum.short;
  const continuationSideFlow = continuationDirection === 'long' ? fiveLayers.flow.long : fiveLayers.flow.short;

  // V21.5.1: define extension before continuation timing uses it.
  // The previous build declared this const later in the same function, which
  // caused a temporal-dead-zone ReferenceError for every deep candidate.
  const extension = Math.max(Math.abs(impulse.move3), Math.abs(impulse.move5));

  // V21.4: a directional displacement is NOT, by itself, a continuation
  // entry. That was the exact failure mode behind late SHORTs at the bottom
  // of a dump. Continuation now needs either an early breakout or a genuine
  // breakout-retest. A mature impulse without a retest becomes NO TRADE.
  const retestLookback = Math.max(2, Number(CONFIG.continuationRetestLookback || 3));
  const retestRows = candles5.slice(-retestLookback - 1, -1);
  const retestAtr = Math.max(num(five.atr), price * 0.0005, 1e-12);
  const shortRetest = Boolean(
    (firstBreakShort || htfBreakShort) &&
    retestRows.length >= 2 &&
    retestRows.some(x => num(x.high) >= (firstBreakShort ? priorLow : htfPriorLow) - retestAtr * Number(CONFIG.continuationRetestAtr || 0.55)) &&
    price < (firstBreakShort ? priorLow : htfPriorLow)
  );
  const longRetest = Boolean(
    (firstBreakLong || htfBreakLong) &&
    retestRows.length >= 2 &&
    retestRows.some(x => num(x.low) <= (firstBreakLong ? priorHigh : htfPriorHigh) + retestAtr * Number(CONFIG.continuationRetestAtr || 0.55)) &&
    price > (firstBreakLong ? priorHigh : htfPriorHigh)
  );
  const continuationEarly = continuationDirection === 'long'
    ? (firstBreakLong && !htfFailedBreakLong && extension <= Number(CONFIG.continuationMaxExtensionPct || 1.35))
    : (firstBreakShort && !htfFailedBreakShort && extension <= Number(CONFIG.continuationMaxExtensionPct || 1.35));
  const continuationRetest = continuationDirection === 'long' ? longRetest : shortRetest;
  const continuationBreak = continuationEarly || continuationRetest;

  // Trend-end / exhaustion detector. Two independent exhaustion signals are
  // required so a normal strong candle is not incorrectly labelled a top/bottom.
  const ema20 = ema(candles5.map(x => num(x.close)), 20);
  const atrDistance = Math.abs(price - ema20) / Math.max(retestAtr, 1e-12);
  const trendEndSignals = continuationDirection === 'short'
    ? [
        rShort.rsi5 <= Number(CONFIG.trendEndRsiLong || 24),
        atrDistance >= Number(CONFIG.trendEndAtrDistance || 2.0),
        Math.abs(impulse.move5) >= Number(CONFIG.continuationMaxMove5Pct || 1.60),
        Math.abs(impulse.m15) >= Number(CONFIG.continuationMaxMove15Pct || 2.40),
        impulse.rangeExpansion >= Number(CONFIG.trendEndRangeExpansion || 1.45) && impulse.volumeRatio >= Number(CONFIG.trendEndVolumeRatio || 1.45),
        zoneLong.nearSupport || fiveLayers.location.long >= 64,
      ].filter(Boolean).length
    : [
        rLong.rsi5 >= Number(CONFIG.trendEndRsiShort || 76),
        atrDistance >= Number(CONFIG.trendEndAtrDistance || 2.0),
        Math.abs(impulse.move5) >= Number(CONFIG.continuationMaxMove5Pct || 1.60),
        Math.abs(impulse.m15) >= Number(CONFIG.continuationMaxMove15Pct || 2.40),
        impulse.rangeExpansion >= Number(CONFIG.trendEndRangeExpansion || 1.45) && impulse.volumeRatio >= Number(CONFIG.trendEndVolumeRatio || 1.45),
        zoneShort.nearResistance || fiveLayers.location.short >= 64,
      ].filter(Boolean).length;
  const trendEndExhaustion = trendEndSignals >= Number(CONFIG.trendEndMinSignals || 2);

  const continuationExtension = Math.max(extension, Math.abs(impulse.m15));
  const continuationTooLate =
    continuationExtension >= Number(CONFIG.continuationMaxExtensionPct || 1.35) ||
    atrDistance >= Number(CONFIG.continuationMaxDistanceEmaAtr || 2.20);
  const continuationExhaustion = continuationDirection === 'long'
    ? (rLong.rsi5 > 78 || (impulse.move5 > 0 && impulse.acceleration < 0 && impulse.rangeExpansion < 1.05))
    : (rShort.rsi5 < 22 || (impulse.move5 < 0 && impulse.acceleration > 0 && impulse.rangeExpansion < 1.05));

  // V21.5.2: continuation timing must not depend on `setupType`. The prior
  // build referenced `lateChase` here before setupType (and therefore lateChase)
  // existed, creating a TDZ error for the remaining deep candidate. Compute the
  // continuation-side chase condition directly from direction/timing primitives.
  const continuationLateChase =
    extension >= Number(CONFIG.lateChaseExtensionPct || 2.25) &&
    (continuationDirection === 'long' ? impulse.acceleration <= 0 : impulse.acceleration >= 0);

  const continuationStrong = bestContinuation >= Number(CONFIG.continuationAuthorityMin || 66) &&
    Math.abs(continuationLong - continuationShort) >= Number(CONFIG.continuationAuthorityEdge || 10) &&
    continuationBreak && continuationSideTrend >= 52 && continuationSideMomentum >= 50 && continuationSideFlow >= 48 &&
    !continuationExhaustion && !continuationTooLate && !trendEndExhaustion &&
    !continuationLateChase;

  const reversalVsContinuation = bestReversal - bestContinuation;
  const reversalTrigger = reversalStrong &&
    (reversalVsContinuation >= -Number(CONFIG.reversalContinuationGap || 5));
  const continuationTrigger = continuationStrong &&
    (bestContinuation > bestReversal + Number(CONFIG.reversalContinuationGap || 5));

  let setupType = 'NONE';
  let direction = fiveLayers.direction || continuationDirection;
  if (reversalTrigger) {
    setupType = 'REVERSAL';
    direction = reversalDirection;
  } else if (continuationTrigger) {
    setupType = 'CONTINUATION';
    direction = continuationDirection;
  } else {
    if (reversalVsContinuation > 0) {
      setupType = 'REVERSAL_WATCH';
      direction = reversalDirection;
    } else {
      setupType = 'CONTINUATION_WATCH';
      direction = continuationDirection;
    }
  }

  const reversalConfidence = direction === 'long' ? reversalLong : reversalShort;
  const continuationConfidence = direction === 'long' ? continuationLong : continuationShort;
  const setupDominance = reversalConfidence - continuationConfidence;

  const r = direction === 'long' ? rLong : rShort;
  const zone = direction === 'long' ? zoneLong : zoneShort;
  const move5 = tickerChange5m(ticker) || impulse.move3;
  const move15 = impulse.m15;
  const absMove3 = Math.abs(impulse.move3);
  const absMove5 = Math.abs(impulse.move5);
  const sharp = absMove3 >= 0.75 || absMove5 >= 1.20 || impulse.rangeExpansion >= 1.65 || Math.abs(impulse.acceleration) >= 0.45;
  const directionalAcceleration = direction === 'long' ? impulse.acceleration : -impulse.acceleration;
  const directionalMove3 = direction === 'long' ? impulse.move3 : -impulse.move3;
  const earlyBreak = direction === 'long' ? firstBreakLong : firstBreakShort;
  const earlyTrend = directionalMove3 >= CONFIG.earlyImpulseMinMove3Pct && directionalAcceleration >= CONFIG.earlyImpulseMinAccelerationPct;
  const notExtended = extension <= 1.80;
  const lateChase = setupType === 'CONTINUATION' && continuationLateChase;

  // Reversal gets timing credit for the FIRST rejection/displacement, not for
  // waiting until the down/up trend is fully confirmed by moving averages.
  const reversalTiming = setupType.startsWith('REVERSAL')
    ? clamp((priorMoveOppositeLong || priorMoveOppositeShort ? 12 : 0) +
            ((direction === 'long' ? rLong.bullishReject : rShort.bearishReject) ? 16 : 0) +
            (directionalAcceleration > 0.03 ? 8 : 0) +
            (notExtended ? 8 : 0), 0, 44)
    : 0;
  const continuationTiming = setupType.startsWith('CONTINUATION')
    ? clamp((earlyTrend ? 12 : 0) + (earlyBreak ? 16 : 0) + (freshExpansion ? 10 : 0) + (notExtended ? 8 : 0), 0, 44)
    : 0;
  const timing = setupType === 'REVERSAL' ? reversalTiming : continuationTiming;

  const impulseQuality = clamp(
    absMove3 * 10 + Math.max(0, impulse.rangeExpansion - 1) * 12 + Math.max(0, Math.abs(impulse.acceleration)) * 9 + Math.max(0, impulse.volumeRatio - 1) * 6 + timing * 0.35,
    0, 40
  );
  const srReaction = direction === 'long' ? Number(r.bullishReject) * 12 : Number(r.bearishReject) * 12;
  const reversalEvidence = direction === 'long'
    ? rLong.longEvidence + Number(zoneLong.nearSupport) + Number(priorMoveOppositeLong)
    : rShort.shortEvidence + Number(zoneShort.nearResistance) + Number(priorMoveOppositeShort);
  const trend = direction === 'long'
    ? Number(five.longTrend) + Number(fifteen.longTrend)
    : Number(five.shortTrend) + Number(fifteen.shortTrend);
  const oi = oiDeltaScore(ticker, direction);
  const rsiQuality = direction === 'long'
    ? (five.rsi >= 42 && five.rsi <= 68 ? 7 : five.rsi > 78 ? -7 : 0)
    : (five.rsi <= 58 && five.rsi >= 32 ? 7 : five.rsi < 22 ? -7 : 0);
  const macdQuality = direction === 'long' ? (five.macd.histogram > 0 ? 6 : -3) : (five.macd.histogram < 0 ? 6 : -3);
  const context = direction === 'long' ? longContext : shortContext;

  // Quality score remains useful for ranking, but it no longer decides whether
  // an EARLY trigger is allowed to fire.
  let score = 28 + impulseQuality + srReaction + trend * 1.2 + rsiQuality + macdQuality + oi.score + context * 1.2 + timing;
  if (setupType === 'REVERSAL') score += Math.min(14, reversalConfidence * 0.14);
  if (setupType === 'CONTINUATION') score += Math.min(12, continuationConfidence * 0.12);
  if (lateChase) score -= 22;
  const capitalFlowBoost = capitalFlow.enabled
    ? (capitalFlow.direction === direction ? (capitalFlow.score - 50) * CONFIG.capitalFlowWeight : -(capitalFlow.score - 50) * 0.18)
    : 0;
  const layerScore = direction === "long" ? fiveLayers.long : fiveLayers.short;
  const layerBoost = fiveLayers.enabled ? (layerScore - 50) * 0.22 : 0;
  score = clamp(score + capitalFlowBoost + layerBoost, 0, 100);

  const risk = clamp(
    (lateChase ? 18 : 0) + (extension > 3.5 ? 15 : 0) + (five.rsi > 82 || five.rsi < 18 ? 15 : 0) + (five.adx < 12 ? 8 : 0) + (oi.exhausted && setupType === 'CONTINUATION' ? 7 : 0),
    0, 100
  );
  const edge = clamp(
    16 + impulseQuality * 0.8 + reversalEvidence * 2.5 + (zone.state !== 'AWAY_FROM_ZONE' ? 10 : 0) + (oi.aligned ? 8 : 0) + (sharp ? 6 : 0) + Math.max(0, setupDominance) * 0.08 + (capitalFlow.enabled ? (capitalFlow.score - 50) * 0.12 : 0) + (fiveLayers.enabled ? fiveLayers.edge * 0.10 : 0) - risk * 0.45,
    0, 100
  );

  const entry = price;
  const tpPlan = calculateLogicalTp(entry, direction, candles5, candles15, five.atr, setupType, impulse);
  const tp = tpPlan.tp;
  const slPlan = CONFIG.stopLossEnabled
    ? calculateDynamicSl(entry, direction, candles5, candles15, five.atr, setupType, { ...topDown, nearestSupport: zone.support, nearestResistance: zone.resistance }, marketRegime)
    : { sl: 0, distancePct: 0, method: "DISABLED", valid: true };
  const sl = slPlan.sl;
  const reasons = [];
  if (setupType === 'REVERSAL') reasons.push(`REVERSAL_${direction.toUpperCase()}`);
  if (setupType === 'CONTINUATION') reasons.push(`CONTINUATION_${direction.toUpperCase()}`);
  if (reversalTrigger) reasons.push('REVERSAL_TRIGGER');
  if (continuationTrigger) reasons.push('CONTINUATION_TRIGGER');
  if (trendEndExhaustion) reasons.push(`TREND_END_EXHAUSTION_${trendEndSignals}`);
  if (continuationRetest) reasons.push('CONTINUATION_RETEST');
  if (continuationEarly) reasons.push('CONTINUATION_EARLY_BREAK');
  if (continuationTooLate) reasons.push('CONTINUATION_TOO_LATE');
  if (firstBreakLong || firstBreakShort) reasons.push('FIRST_BREAK');
  if (strongBreakLong || strongBreakShort || htfStrongBreakLong || htfStrongBreakShort) reasons.push('STRONG_BREAKOUT');
  if (failedBreakLong || failedBreakShort || htfFailedBreakLong || htfFailedBreakShort) reasons.push('BREAKOUT_FAILURE');
  if (liveBreakLong && !genuineShortFailure) reasons.push('NO_SHORT_FADE_ON_LIVE_BREAKOUT');
  if (liveBreakShort && !genuineLongFailure) reasons.push('NO_LONG_FADE_ON_LIVE_BREAKOUT');
  if (freshExpansion) reasons.push('FRESH_EXPANSION');
  if (sharp) reasons.push('SHARP_MOVE');
  if (preCompression) reasons.push('PRE_COMPRESSION');
  if (zone.nearSupport || zone.nearResistance) reasons.push('S_R_ZONE');
  if (topDown.state !== 'NEUTRAL') reasons.push(`HTF_${topDown.state}`);
  if (topDown.controllingTimeframe) reasons.push(`HTF_TF_${topDown.controllingTimeframe}`);
  if (oi.aligned) reasons.push('OI_ALIGNMENT');
  if (lateChase) reasons.push('LATE_CHASE_PENALTY');
  if (fiveLayers.direction === direction) reasons.push(`5L_${direction.toUpperCase()}_${fiveLayers.confidence.toFixed(0)}`);
  if (fiveLayers.authority === "REVERSAL") reasons.push(`DIRECTION_AUTHORITY_REVERSAL_${direction.toUpperCase()}`);
  if (fiveLayers.authority === "CONTINUATION") reasons.push(`DIRECTION_AUTHORITY_CONTINUATION_${direction.toUpperCase()}`);
  if (fiveLayers.location.reasons.length) reasons.push(...fiveLayers.location.reasons.slice(0, 4).map(x => `LOC:${x}`));
  if (fiveLayers.momentum.reasons.length) reasons.push(...fiveLayers.momentum.reasons.slice(0, 4).map(x => `MOM:${x}`));
  if (fiveLayers.flow.reasons.length) reasons.push(...fiveLayers.flow.reasons.slice(0, 4).map(x => `FLOW5:${x}`));
  if (fiveLayers.reversal.reasons.length) reasons.push(...fiveLayers.reversal.reasons.slice(0, 3).map(x => `REV5:${x}`));

  return {
    symbol: marketDisplaySymbol(market), candleSymbol: candleSymbolFromMarket(market), direction, entry, tp, sl,
    score: Number(score.toFixed(2)), edge: Number(edge.toFixed(2)), risk: Number(risk.toFixed(2)), trendConfluence: trend,
    setupType, reversalEvidence,
    setupConfidence: setupType === 'REVERSAL' ? reversalConfidence : continuationConfidence,
    reversalConfidence: Number(reversalConfidence.toFixed(1)),
    continuationConfidence: Number(continuationConfidence.toFixed(1)),
    setupDominance: Number(setupDominance.toFixed(1)),
    triggerActive: setupType === 'REVERSAL' || setupType === 'CONTINUATION',
    reversalTrigger, continuationTrigger,
    tpPlan,
    setupEvidence: {
      setupType, reversalEvidence, reversalConfidence, continuationConfidence, setupDominance,
      directionAuthority: fiveLayers.authority, reversalAuthority: fiveLayers.reversalAuthority, continuationAuthority: fiveLayers.continuationAuthority,
      reversalEdge: fiveLayers.reversalEdge, continuationEdge: fiveLayers.continuationEdge,
      trendEndExhaustion, trendEndSignals, continuationEarly, continuationRetest, continuationTooLate, continuationBreak,
      tpMethod: tpPlan.method, tpTargetScore: tpPlan.targetScore, tpDistancePct: tpPlan.distancePct,
      tpTargetType: tpPlan.targetType, tpProbabilityProxy: tpPlan.probabilityProxy,
      sl: slPlan.sl, slDistancePct: slPlan.distancePct, slMethod: slPlan.method, slValid: slPlan.valid,
      zoneState: zone.state, nearSupport: zone.nearSupport, nearResistance: zone.nearResistance,
      nearestSupport: zone.support, nearestResistance: zone.resistance, sharpMove: sharp, lateChase, impulseQuality,
      acceleration: impulse.acceleration, rangeExpansion: impulse.rangeExpansion, volumeRatio: impulse.volumeRatio,
      earlyTrend, earlyBreak, freshExpansion, notExtended, earlyTimingBonus: timing,
      reversalLong: rLong.longScore, reversalShort: rShort.shortScore,
      continuationLong, continuationShort, firstBreakLong, firstBreakShort,
      strongBreakLong, strongBreakShort, htfBreakLong, htfBreakShort, htfStrongBreakLong, htfStrongBreakShort,
      liveBreakLong, liveBreakShort, failedBreakLong, failedBreakShort, htfFailedBreakLong, htfFailedBreakShort,
      genuineLongFailure, genuineShortFailure, closeNearHigh, closeNearLow,
      topDown: { state: topDown.state, preferredDirection: topDown.preferredDirection, confidence: topDown.confidence, controllingTimeframe: topDown.controllingTimeframe, levelPrice: topDown.levelPrice, nearSupport: topDown.nearSupport, nearResistance: topDown.nearResistance, supportBreak: topDown.supportBreak, resistanceBreak: topDown.resistanceBreak, supportReaction: topDown.supportReaction, resistanceReaction: topDown.resistanceReaction, supportFailedBreak: topDown.supportFailedBreak, resistanceFailedBreak: topDown.resistanceFailedBreak, support: topDown.support?.price || null, resistance: topDown.resistance?.price || null },
      priorMove: preMove, priorMoveOppositeLong, priorMoveOppositeShort,
      reversalTiming, continuationTiming,
      tpMethod: tpPlan.method, tpTargetScore: tpPlan.targetScore, tpDistancePct: tpPlan.distancePct,
      tpTargetType: tpPlan.targetType, tpProbabilityProxy: tpPlan.probabilityProxy,
      capitalFlow, smartMoneyProxy: capitalFlow.smartMoneyProxy, capitalFlowScore: capitalFlow.score,
      capitalFlowDirection: capitalFlow.direction, capitalFlowState: capitalFlow.state,
      volumeRatio5m: capitalFlow.volumeRatio5m, volumeRatio15m: capitalFlow.volumeRatio15m, oiDeltaPct: capitalFlow.oiDeltaPct,
      longOi: capitalFlow.longOi, shortOi: capitalFlow.shortOi, volumeProfileZone: capitalFlow.profile?.zoneState || null,
      volumeProfilePoc: capitalFlow.profile?.poc || null, volumeProfileValueLow: capitalFlow.profile?.valueLow || null, volumeProfileValueHigh: capitalFlow.profile?.valueHigh || null,
      fiveLayers,
      marketRegime: marketRegime ? {
        regime: marketRegime.regime, direction: marketRegime.direction, score: marketRegime.score,
        confidence: marketRegime.confidence, referenceScore: marketRegime.referenceScore, agreement: marketRegime.agreement,
        btcScore: marketRegime.btc?.score ?? 50, ethScore: marketRegime.eth?.score ?? 50,
        breadthScore: marketRegime.breadth?.score ?? 50, breadthRatio: marketRegime.breadth?.ratio ?? 0,
        supportReliability: marketRegime.supportReliability, resistanceReliability: marketRegime.resistanceReliability,
      } : null,
      layerScores: { trend: direction === "long" ? fiveLayers.trend.long : fiveLayers.trend.short, location: direction === "long" ? fiveLayers.location.long : fiveLayers.location.short, momentum: direction === "long" ? fiveLayers.momentum.long : fiveLayers.momentum.short, flow: direction === "long" ? fiveLayers.flow.long : fiveLayers.flow.short, reversal: direction === "long" ? fiveLayers.reversal.long : fiveLayers.reversal.short },
      fibZone: fiveLayers.location.fibZone,
      bollinger: fiveLayers.location.bollinger,
      stochastic5: fiveLayers.momentum.stochastic5,
      rsiDivergence: fiveLayers.momentum.divergence,
    },
    reasons: [...reasons, ...capitalFlow.reasons.map(x => `FLOW:${x}`)],
    indicators: {
      rsi: Number(five.rsi.toFixed(2)), adx: Number(five.adx.toFixed(2)), ema20: five.ema20, ema50: five.ema50, ema200: five.ema200,
      macdHistogram: five.macd.histogram, move5m: move5, move15m: move15, oiChange5m: oi.delta, reactionScore: srReaction,
      explosive: sharp, impulseQuality, acceleration: impulse.acceleration, rangeExpansion: impulse.rangeExpansion, volumeRatio: impulse.volumeRatio,
      earlyTrend, earlyBreak, freshExpansion, earlyTimingBonus: timing, lateChase,
      strongBreakLong, strongBreakShort, htfBreakLong, htfBreakShort, htfStrongBreakLong, htfStrongBreakShort,
      liveBreakLong, liveBreakShort, failedBreakLong, failedBreakShort, htfFailedBreakLong, htfFailedBreakShort, genuineLongFailure, genuineShortFailure,
      tpMethod: tpPlan.method, tpTargetScore: tpPlan.targetScore, tpDistancePct: tpPlan.distancePct,
      tpTargetType: tpPlan.targetType, tpProbabilityProxy: tpPlan.probabilityProxy,
      sl: slPlan.sl, slDistancePct: slPlan.distancePct, slMethod: slPlan.method,
      reversalConfidence, continuationConfidence, setupDominance, triggerActive: setupType === 'REVERSAL' || setupType === 'CONTINUATION',
      topDownState: topDown.state, topDownDirection: topDown.preferredDirection, topDownConfidence: topDown.confidence, topDownControllingTimeframe: topDown.controllingTimeframe, topDownLevelPrice: topDown.levelPrice, topDownSupport: topDown.support?.price || null, topDownResistance: topDown.resistance?.price || null, topDownSupportBreak: topDown.supportBreak, topDownResistanceBreak: topDown.resistanceBreak, topDownSupportReaction: topDown.supportReaction, topDownResistanceReaction: topDown.resistanceReaction, topDownSupportFailedBreak: topDown.supportFailedBreak, topDownResistanceFailedBreak: topDown.resistanceFailedBreak,
      volume24h: tickerVolume(ticker), openInterest: tickerOpenInterest(ticker), fundingRate: tickerFunding(ticker), liquidity: marketLiquidity(market),
      capitalFlowScore: capitalFlow.score, capitalFlowDirection: capitalFlow.direction, capitalFlowState: capitalFlow.state, smartMoneyProxy: capitalFlow.smartMoneyProxy,
      oiDeltaPct: capitalFlow.oiDeltaPct, volumeDeltaPct: capitalFlow.volumeDeltaPct, volumeRatio5m: capitalFlow.volumeRatio5m, volumeRatio15m: capitalFlow.volumeRatio15m,
      longOi: capitalFlow.longOi, shortOi: capitalFlow.shortOi, sideBias: capitalFlow.sideBias, volumeProfileZone: capitalFlow.profile?.zoneState || null, volumeProfilePoc: capitalFlow.profile?.poc || null,
      fiveLayerConfidence: fiveLayers.confidence, fiveLayerEdge: fiveLayers.edge, fiveLayerDirection: fiveLayers.direction,
      marketRegime: marketRegime ? { regime: marketRegime.regime, direction: marketRegime.direction, score: marketRegime.score, confidence: marketRegime.confidence, referenceScore: marketRegime.referenceScore, agreement: marketRegime.agreement, btcScore: marketRegime.btc?.score ?? 50, ethScore: marketRegime.eth?.score ?? 50, breadthScore: marketRegime.breadth?.score ?? 50, breadthRatio: marketRegime.breadth?.ratio ?? 0, supportReliability: marketRegime.supportReliability, resistanceReliability: marketRegime.resistanceReliability } : null,
      directionAuthority: fiveLayers.authority, reversalAuthority: fiveLayers.reversalAuthority, continuationAuthority: fiveLayers.continuationAuthority,
      reversalAuthorityEdge: fiveLayers.reversalEdge, continuationAuthorityEdge: fiveLayers.continuationEdge,
      trendLayer: direction === "long" ? fiveLayers.trend.long : fiveLayers.trend.short,
      locationLayer: direction === "long" ? fiveLayers.location.long : fiveLayers.location.short,
      momentumLayer: direction === "long" ? fiveLayers.momentum.long : fiveLayers.momentum.short,
      flowLayer: direction === "long" ? fiveLayers.flow.long : fiveLayers.flow.short,
      reversalLayer: direction === "long" ? fiveLayers.reversal.long : fiveLayers.reversal.short,
      ichimokuBullish: Boolean(fiveLayers.trend?.direction === "long"),
      fibNear: Boolean(fiveLayers.location?.fibZone?.near),
      stochasticK: fiveLayers.momentum?.stochastic5?.k || 50,
      stochasticD: fiveLayers.momentum?.stochastic5?.d || 50,
      bollingerPosition: fiveLayers.momentum?.bollinger?.position ?? 0.5,
      rsiBullDivergence: Boolean(fiveLayers.momentum?.divergence?.bullish),
      rsiBearDivergence: Boolean(fiveLayers.momentum?.divergence?.bearish),
    },
    market, ticker, candles5, candles15,
  };
}


function calculateDynamicSl(entry, direction, candles5, candles15, atr5, setupType = "CONTINUATION", setupEvidence = {}, marketRegime = null) {
  const price = Number(entry || 0);
  if (!(price > 0)) return { sl: 0, distancePct: 0, method: "INVALID_ENTRY", valid: false };

  const a5 = Math.max(Number(atr5 || 0), price * 0.0015, 1e-12);
  const a15 = Math.max(Number(atr(candles15 || [], 14) || 0), price * 0.0018, 1e-12);
  const volatilityAtr = Math.max(a5, a15 * 0.55);
  const atrMult = setupType === "REVERSAL" ? CONFIG.slAtrMultiplierReversal : CONFIG.slAtrMultiplierContinuation;
  const buffer = volatilityAtr * atrMult;

  const supports = [
    num(setupEvidence?.nearestSupport),
    ...recentSwingLevels(candles5 || []).support,
    ...recentSwingLevels(candles15 || []).support,
  ].filter(x => x > 0 && x < price);
  const resistances = [
    num(setupEvidence?.nearestResistance),
    ...recentSwingLevels(candles5 || []).resistance,
    ...recentSwingLevels(candles15 || []).resistance,
  ].filter(x => x > price);

  let structural = 0;
  let method = "ATR_ONLY";
  if (direction === "long") {
    structural = supports.length ? Math.max(...supports) : 0;
    if (structural > 0) {
      // Put the trigger just beyond the structural low/support.
      const candidate = structural - buffer;
      const minSl = price * (1 - CONFIG.slMaxDistancePct / 100);
      const sl = Math.max(candidate, minSl);
      structural = sl;
      method = "STRUCTURE_SUPPORT_ATR";
    } else {
      structural = price - buffer;
      method = "ATR_FALLBACK";
    }
  } else {
    structural = resistances.length ? Math.min(...resistances) : 0;
    if (structural > 0) {
      const candidate = structural + buffer;
      const maxSl = price * (1 + CONFIG.slMaxDistancePct / 100);
      structural = Math.min(candidate, maxSl);
      method = "STRUCTURE_RESISTANCE_ATR";
    } else {
      structural = price + buffer;
      method = "ATR_FALLBACK";
    }
  }

  // Enforce a minimum distance so normal oracle noise does not immediately
  // trigger the stop, while respecting the hard maximum risk envelope.
  const minDist = price * (CONFIG.slMinDistancePct / 100);
  if (direction === "long") structural = Math.min(structural, price - minDist);
  else structural = Math.max(structural, price + minDist);

  const macro = String(marketRegime?.direction || "neutral");
  const counterTrend = macro !== "neutral" && macro !== direction;
  const maxPct = counterTrend ? Math.min(CONFIG.slMaxDistancePct, CONFIG.slCounterTrendMaxDistancePct) : CONFIG.slMaxDistancePct;
  const maxDist = price * (maxPct / 100);
  if (direction === "long") structural = Math.max(structural, price - maxDist);
  else structural = Math.min(structural, price + maxDist);

  const sl = Number(structural.toPrecision(12));
  const distancePct = Math.abs(pct(sl, price));
  const validSide = direction === "long" ? sl < price : sl > price;
  const valid = validSide && distancePct >= CONFIG.slMinDistancePct * 0.95 && distancePct <= maxPct + 0.05;
  return {
    sl,
    distancePct: Number(distancePct.toFixed(3)),
    method,
    valid,
    counterTrend,
    maxDistancePct: maxPct,
    bufferPct: Number((buffer / price * 100).toFixed(3)),
  };
}

function calculateLogicalTp(entry, direction, candles5, candles15, atr5, setupType = "CONTINUATION", impulse = {}) {
  const minDist = CONFIG.minTpDistancePct / 100;
  const maxDistPct = setupType === "REVERSAL" ? CONFIG.tpReversalMaxPct : CONFIG.tpContinuationMaxPct;
  const maxDist = maxDistPct / 100;
  const atr = Math.max(num(atr5), entry * 0.0005, 1e-12);

  const levels5 = recentSwingLevels(candles5);
  const levels15 = recentSwingLevels(candles15);
  const completed5 = candles5.slice(0, -1);
  const completed15 = candles15.slice(0, -1);
  const n5 = Math.max(3, Number(CONFIG.tpNearTermLookback5) || 8);
  const n15 = Math.max(3, Number(CONFIG.tpNearTermLookback15) || 6);
  const near5 = completed5.slice(-n5);
  const near15 = completed15.slice(-n15);

  const nearHigh5 = near5.length ? Math.max(...near5.map(c => num(c.high)).filter(Number.isFinite)) : NaN;
  const nearLow5 = near5.length ? Math.min(...near5.map(c => num(c.low)).filter(Number.isFinite)) : NaN;
  const nearHigh15 = near15.length ? Math.max(...near15.map(c => num(c.high)).filter(Number.isFinite)) : NaN;
  const nearLow15 = near15.length ? Math.min(...near15.map(c => num(c.low)).filter(Number.isFinite)) : NaN;

  const candidates = [];
  const add = (price, type, tf, weight = 0) => {
    const x = num(price);
    if (!(x > 0)) return;
    const distancePct = Math.abs(pct(x, entry));
    const favorable = direction === "long" ? x > entry : x < entry;
    if (!favorable || distancePct < CONFIG.minTpDistancePct || distancePct > maxDistPct) return;

    // Probability proxy: closer first reaction levels are generally more reachable;
    // a second confirmation from 15m earns a small bonus. This is deliberately
    // a ranking proxy, not a statistically calibrated probability.
    const atrDist = Math.abs(x - entry) / atr;
    const distanceScore = clamp(88 - atrDist * 18, 25, 88);
    const tfBonus = tf === "15m" ? 7 : 3;
    const setupBonus = setupType === "REVERSAL" ? (distancePct <= 1.25 ? 10 : 0) : (distancePct <= 1.80 ? 6 : 0);
    const weightBonus = Number(weight) || 0;
    const targetScore = clamp(distanceScore + tfBonus + setupBonus + weightBonus, 0, 100);
    candidates.push({price:x, type, tf, distancePct, atrDist, targetScore});
  };

  // First reaction / recent range is considered before older swing structure.
  if (direction === "long") {
    add(nearHigh5, "NEAR_TERM_REACTION", "5m", 10);
    add(nearHigh15, "NEAR_TERM_STRUCTURE", "15m", 8);
    for (const x of levels5.resistance) add(x, "SWING_RESISTANCE", "5m", 4);
    for (const x of levels15.resistance) add(x, "SWING_RESISTANCE", "15m", 6);
  } else {
    add(nearLow5, "NEAR_TERM_REACTION", "5m", 10);
    add(nearLow15, "NEAR_TERM_STRUCTURE", "15m", 8);
    for (const x of levels5.support) add(x, "SWING_SUPPORT", "5m", 4);
    for (const x of levels15.support) add(x, "SWING_SUPPORT", "15m", 6);
  }

  // De-duplicate nearly identical targets while preserving the strongest evidence.
  const dedup = new Map();
  for (const c of candidates) {
    const key = c.price.toPrecision(10);
    const prior = dedup.get(key);
    if (!prior || c.targetScore > prior.targetScore) dedup.set(key, c);
  }

  let pool = [...dedup.values()];
  pool.sort((a, b) => b.targetScore - a.targetScore || a.distancePct - b.distancePct);

  let selected = pool.find(x => x.targetScore >= CONFIG.tpMinTargetScore);
  if (!selected) selected = pool[0] || null;

  if (!selected) {
    const fallbackDistance = Math.min(maxDist, Math.max(minDist, CONFIG.tpAtrMultiplier * atr / entry));
    const tp = direction === "long" ? entry * (1 + fallbackDistance) : entry * (1 - fallbackDistance);
    return {
      tp: Number(tp.toPrecision(12)), method: "ATR_PROBABILITY_FALLBACK", targetType: "ATR_FALLBACK",
      targetScore: 50, probabilityProxy: 50, distancePct: fallbackDistance * 100,
      targetPrice: tp, atrDistance: fallbackDistance * entry / atr,
    };
  }

  // For reversal trades, never chase a distant major structure when a nearer
  // reaction target exists. For continuation, allow a little more room only
  // when the impulse is still expanding.
  const impulseExpansion = Math.max(num(impulse?.rangeExpansion), num(impulse?.volumeRatio));
  const expansionSupport = impulseExpansion >= 1.25 || Math.abs(num(impulse?.acceleration)) >= 0.15;
  if (setupType === "REVERSAL" && selected.distancePct > CONFIG.tpReversalMaxPct) {
    const nearer = pool.find(x => x.distancePct <= CONFIG.tpReversalMaxPct);
    if (nearer) selected = nearer;
  }
  if (setupType === "CONTINUATION" && !expansionSupport) {
    const nearer = pool.find(x => x.distancePct <= 1.80);
    if (nearer && nearer.targetScore >= selected.targetScore - 5) selected = nearer;
  }

  return {
    tp: Number(selected.price.toPrecision(12)),
    method: "PROBABILITY_AWARE_STRUCTURE",
    targetType: selected.type,
    targetScore: Number(selected.targetScore.toFixed(1)),
    probabilityProxy: Number(selected.targetScore.toFixed(1)),
    distancePct: Number(selected.distancePct.toFixed(3)),
    targetPrice: selected.price,
    atrDistance: Number(selected.atrDist.toFixed(2)),
  };
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
  if (!candidate || !candidate.symbol || !candidate.entry || !candidate.tp) {
    return { ok: false, reason: "INVALID_PLAN" };
  }

  const ev = candidate.setupEvidence || {};
  const isEarlyReversal = candidate.setupType === "REVERSAL" && candidate.reversalTrigger;
  const isEarlyContinuation = candidate.setupType === "CONTINUATION" && candidate.continuationTrigger;

  // V20.3: do NOT require the mature Score threshold for an active early
  // trigger. The trigger is specifically designed to fire before EMA/MACD
  // confluence becomes fully developed.
  if (!isEarlyReversal && !isEarlyContinuation) {
    if (candidate.score < CONFIG.minScore) {
      return { ok: false, reason: `NO_EARLY_TRIGGER_SCORE_${candidate.score.toFixed(1)}_BELOW_${CONFIG.minScore}` };
    }
    return { ok: false, reason: "NO_EARLY_TRIGGER" };
  }

  if (candidate.edge < CONFIG.minEdge) {
    return { ok: false, reason: `EDGE_${candidate.edge.toFixed(1)}_BELOW_${CONFIG.minEdge}` };
  }

  const evTopDown = ev.topDown || {};
  const layer = ev.fiveLayers || {};
  if (CONFIG.directionAuthorityEnabled && candidate.setupType === "REVERSAL") {
    const revSide = candidate.direction === "long" ? num(layer.reversal?.long) : num(layer.reversal?.short);
    const revOpp = candidate.direction === "long" ? num(layer.reversal?.short) : num(layer.reversal?.long);
    const momSide = candidate.direction === "long" ? num(layer.momentum?.long) : num(layer.momentum?.short);
    const locSide = candidate.direction === "long" ? num(layer.location?.long) : num(layer.location?.short);
    if (revSide < CONFIG.reversalAuthorityMin || (revSide - revOpp) < CONFIG.reversalAuthorityEdge || momSide < CONFIG.momentumConflictBlock || locSide < CONFIG.locationConflictBlock) {
      return { ok: false, reason: "REVERSAL_DIRECTION_AUTHORITY_NOT_CONFIRMED" };
    }
  }
  if (candidate.setupType === "CONTINUATION" && ev.continuationTooLate) {
    return { ok: false, reason: "CONTINUATION_TOO_LATE_AFTER_IMPULSE" };
  }
  if (candidate.setupType === "CONTINUATION" && ev.trendEndExhaustion) {
    return { ok: false, reason: "CONTINUATION_BLOCKED_TREND_END_EXHAUSTION" };
  }

  if (CONFIG.directionAuthorityEnabled && candidate.setupType === "CONTINUATION") {
    const side = candidate.direction === "long" ? "long" : "short";
    const trendSide = num(layer.trend?.[side]);
    const momSide = num(layer.momentum?.[side]);
    const flowSide = num(layer.flow?.[side]);
    const opp = side === "long" ? "short" : "long";
    if (trendSide < 52 || momSide < 50 || flowSide < 48 || (num(layer.momentum?.[side]) - num(layer.momentum?.[opp]) < -CONFIG.momentumConflictBlock)) {
      return { ok: false, reason: "CONTINUATION_DIRECTION_AUTHORITY_NOT_CONFIRMED" };
    }
  }
  const macro = ev.marketRegime || {};
  if (macro.regime && macro.direction && macro.direction !== "neutral" && macro.direction !== candidate.direction) {
    const side = candidate.direction === "long" ? "long" : "short";
    const five = ev.fiveLayers || {};
    const reversalSide = num(five.reversal?.[side]);
    const flowSide = num(five.flow?.[side]);
    const counterTrendReversal = candidate.setupType === "REVERSAL" &&
      reversalSide >= CONFIG.marketRegimeCounterTrendReversalMin &&
      flowSide >= CONFIG.marketRegimeCounterTrendFlowMin &&
      num(candidate.reversalConfidence) >= CONFIG.marketRegimeCounterTrendReversalMin &&
      num(candidate.edge) >= CONFIG.marketRegimeCounterTrendEdgeMin;
    if (!counterTrendReversal) {
      return { ok: false, reason: `GLOBAL_MARKET_${macro.regime}_COUNTER_TREND_NOT_CONFIRMED` };
    }
    candidate.setupEvidence.marketRegimeCounterTrendOverride = true;
    candidate.setupEvidence.marketRegimeCounterTrendOverrideReason = "STRONG_LOCAL_REVERSAL_AGAINST_BTC_ETH";
  }

  if (evTopDown.preferredDirection && candidate.direction !== evTopDown.preferredDirection) {
    const layers = ev.fiveLayers || {};
    const oppositeReversal = candidate.direction === "long" ? num(layers.reversal?.long) : num(layers.reversal?.short);
    const matchingFlow = candidate.direction === "long" ? num(layers.flow?.long) : num(layers.flow?.short);
    const layerConfidence = num(layers.confidence);
    const override =
      CONFIG.htfConflictSoft &&
      candidate.setupType === "REVERSAL" &&
      oppositeReversal >= CONFIG.htfConflictOverrideMinReversal &&
      matchingFlow >= CONFIG.htfConflictOverrideMinFlow &&
      layerConfidence >= CONFIG.htfConflictOverrideMinLayerEdge &&
      Number(candidate.reversalConfidence || 0) >= Number(CONFIG.reversalTriggerMinConfidence) + 8;
    if (!override) {
      return { ok: false, reason: `HTF_DIRECTION_CONFLICT_${evTopDown.preferredDirection.toUpperCase()}` };
    }
    candidate.setupEvidence.htfOverride = true;
    candidate.setupEvidence.htfOverrideReason = "STRONG_5L_REVERSAL_FLOW_OVERRIDE";
  }
  if (evTopDown.supportBreak && candidate.direction !== "short") {
    return { ok: false, reason: "HTF_SUPPORT_BREAK_REQUIRES_SHORT" };
  }
  if (evTopDown.resistanceBreak && candidate.direction !== "long") {
    return { ok: false, reason: "HTF_RESISTANCE_BREAK_REQUIRES_LONG" };
  }

  if (isEarlyReversal) {
    if (Number(candidate.reversalConfidence || 0) < Number(CONFIG.reversalTriggerMinConfidence)) {
      return { ok: false, reason: `REVERSAL_CONFIDENCE_${candidate.reversalConfidence || 0}_BELOW_${CONFIG.reversalTriggerMinConfidence}` };
    }
    if (Number(candidate.reversalEvidence || 0) < 2) {
      return { ok: false, reason: `REVERSAL_EVIDENCE_${candidate.reversalEvidence || 0}` };
    }
    if (ev.zoneState === "AWAY_FROM_ZONE" && !ev.bearishReject && !ev.bullishReject) {
      return { ok: false, reason: "REVERSAL_NO_ZONE_OR_REJECTION" };
    }
  }

  if (isEarlyContinuation) {
    if (Number(candidate.continuationConfidence || 0) < Number(CONFIG.continuationTriggerMinConfidence)) {
      return { ok: false, reason: `CONTINUATION_CONFIDENCE_${candidate.continuationConfidence || 0}_BELOW_${CONFIG.continuationTriggerMinConfidence}` };
    }
    if (!ev.firstBreakLong && !ev.firstBreakShort && !ev.earlyTrend && !ev.freshExpansion) {
      return { ok: false, reason: "CONTINUATION_NOT_FRESH" };
    }
  }

  // A continuation that has already travelled far and lost acceleration is a
  // chase. A reversal is allowed to appear after a large prior move because
  // that extension is part of the reversal setup rather than a chase entry.
  if (ev.lateChase) return { ok: false, reason: "LATE_CHASE" };
  if (candidate.risk > CONFIG.maxRisk) return { ok: false, reason: `RISK_${candidate.risk.toFixed(1)}_ABOVE_${CONFIG.maxRisk}` };

  const tpDistance = Math.abs(pct(candidate.tp, candidate.entry));
  if (tpDistance < CONFIG.minTpDistancePct) return { ok: false, reason: "TP_TOO_CLOSE" };

  if (CONFIG.stopLossEnabled) {
    const sl = num(candidate.sl);
    if (!(sl > 0)) return { ok: false, reason: "SL_NOT_CALCULATED" };
    if (candidate.direction === "long" && !(sl < candidate.entry)) return { ok: false, reason: "SL_WRONG_SIDE_LONG" };
    if (candidate.direction === "short" && !(sl > candidate.entry)) return { ok: false, reason: "SL_WRONG_SIDE_SHORT" };
    const slDistance = Math.abs(pct(sl, candidate.entry));
    const maxSl = candidate.setupEvidence?.marketRegime?.counterTrend ? CONFIG.slCounterTrendMaxDistancePct : CONFIG.slMaxDistancePct;
    if (slDistance > maxSl + 0.05) return { ok: false, reason: `SL_TOO_FAR_${slDistance.toFixed(2)}PCT` };
    if (slDistance < CONFIG.slMinDistancePct * 0.95) return { ok: false, reason: `SL_TOO_CLOSE_${slDistance.toFixed(2)}PCT` };
  }

  return { ok: true, reason: isEarlyReversal ? "EARLY_REVERSAL_READY" : "EARLY_CONTINUATION_READY" };
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

function marketRegimeFrameScore(candles) {
  const rows = Array.isArray(candles) ? candles : [];
  if (rows.length < 20) return { available: false, score: 50, direction: "neutral", confidence: 0 };
  const closes = rows.map(x => num(x.close)).filter(x => x > 0);
  const last = closes.at(-1);
  const e20 = ema(closes, 20), e50 = ema(closes, 50), e200 = ema(closes, 200);
  const m = macd(closes);
  const ad = adx(rows, 14);
  const r = rsi(closes, 14);
  const look3 = closes.at(-4) || last;
  const look12 = closes.at(-13) || last;
  const ret3 = pct(last, look3);
  const ret12 = pct(last, look12);
  const slope20 = pct(e20, closes.at(-Math.min(8, closes.length)) || e20);

  let bull = 50;
  if (last > e20) bull += 7; else bull -= 7;
  if (e20 > e50) bull += 10; else bull -= 10;
  if (e50 > e200) bull += 10; else bull -= 10;
  if (m.histogram > 0) bull += 8; else bull -= 8;
  if (r >= 52) bull += 5; else bull -= 5;
  if (ret3 > 0.15) bull += 5; else if (ret3 < -0.15) bull -= 5;
  if (ret12 > 0.75) bull += 8; else if (ret12 < -0.75) bull -= 8;
  if (slope20 > 0.15) bull += 5; else if (slope20 < -0.15) bull -= 5;
  if (ad >= 18) bull += (bull >= 50 ? 4 : -4);

  bull = clamp(bull, 0, 100);
  const direction = bull >= 55 ? "long" : bull <= 45 ? "short" : "neutral";
  return {
    available: true, score: Number(bull.toFixed(1)), direction,
    confidence: Number(Math.abs(bull - 50).toFixed(1)),
    price: last, ema20: e20, ema50: e50, ema200: e200,
    macdHistogram: m.histogram, rsi: r, adx: ad, ret3, ret12, slope20,
  };
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

async function buildMarketRegimeDataCenter(sdk, markets, broadRows = []) {
  if (!CONFIG.marketRegimeEnabled) {
    return { enabled: false, regime: "NEUTRAL", direction: "neutral", confidence: 0, score: 50, btc: null, eth: null, breadth: null };
  }

  const btcMarket = findReferenceMarket(markets, "BTC");
  const ethMarket = findReferenceMarket(markets, "ETH");
  const frames = CONFIG.marketRegimeTimeframes || ["5m", "15m", "1h", "4h", "1d"];
  const frameWeight = { "5m": 0.6, "15m": 0.9, "1h": 1.3, "4h": 1.8, "1d": 2.4 };

  async function analyzeRef(market, asset) {
    if (!market) return { asset, available: false, reason: "REFERENCE_MARKET_NOT_FOUND" };
    const broadMatch = (Array.isArray(broadRows) ? broadRows : []).find((r) => normalizeAsset(r?.symbol || marketDisplaySymbol(r?.market)) === asset);
    const rows = [];
    // 5M is already fetched for the full universe; reuse it instead of issuing
    // another network request. The remaining macro frames are deliberately
    // serialized in small batches to avoid starving the deep scan.
    for (const tf of frames) {
      if (tf === "5m" && Array.isArray(broadMatch?.candles5) && broadMatch.candles5.length >= 20) {
        rows.push({ tf, candles: broadMatch.candles5 });
        continue;
      }
      try {
        const candles = await fetchCandlesResilient(sdk, market, tf, 96);
        rows.push({ tf, candles });
      } catch (e) {
        rows.push({ tf, candles: [], error: safeError(e) });
      }
    }
    let weighted = 0, totalWeight = 0;
    const frameScores = {};
    for (const row of rows) {
      const x = marketRegimeFrameScore(row.candles);
      frameScores[row.tf] = x;
      if (x.available) { const w = frameWeight[row.tf] || 1; weighted += x.score * w; totalWeight += w; }
    }
    const score = totalWeight ? weighted / totalWeight : 50;
    const available = totalWeight > 0;
    const direction = score >= 55 ? "long" : score <= 45 ? "short" : "neutral";
    return { asset, available, score: Number(score.toFixed(1)), direction, confidence: Number(Math.abs(score - 50).toFixed(1)), frames: frameScores };
  }

  const [btc, eth] = await Promise.all([analyzeRef(btcMarket, "BTC"), analyzeRef(ethMarket, "ETH")]);
  const btcScore = num(btc.score, 50), ethScore = num(eth.score, 50);
  const refWeight = (btc.available ? CONFIG.marketRegimeBtcWeight : 0) + (eth.available ? CONFIG.marketRegimeEthWeight : 0);
  const refScore = refWeight > 0
    ? ((btc.available ? btcScore * CONFIG.marketRegimeBtcWeight : 0) + (eth.available ? ethScore * CONFIG.marketRegimeEthWeight : 0)) / refWeight
    : 50;

  const rows = Array.isArray(broadRows) ? broadRows : [];
  const breadthValues = rows.map(r => tickerChange5m(r.ticker)).filter(Number.isFinite);
  const positive = breadthValues.filter(x => x > 0.08).length;
  const negative = breadthValues.filter(x => x < -0.08).length;
  const breadthRatio = breadthValues.length ? (positive - negative) / breadthValues.length : 0;
  const breadthScore = 50 + breadthRatio * 50;
  const combinedScore = clamp(refScore * (1 - CONFIG.marketRegimeBreadthWeight) + breadthScore * CONFIG.marketRegimeBreadthWeight, 0, 100);

  const bothBear = btcScore <= 45 && ethScore <= 45;
  const bothBull = btcScore >= 55 && ethScore >= 55;
  const agreement = 100 - Math.min(100, Math.abs(btcScore - ethScore) * 2);
  let regime = "MIXED";
  let direction = "neutral";
  if (combinedScore >= CONFIG.marketRegimeBullThreshold && (bothBull || combinedScore >= CONFIG.marketRegimeStrongThreshold)) {
    regime = combinedScore >= CONFIG.marketRegimeStrongThreshold ? "BULLISH_STRONG" : "BULLISH";
    direction = "long";
  } else if (combinedScore <= CONFIG.marketRegimeBearThreshold && (bothBear || combinedScore <= 100 - CONFIG.marketRegimeStrongThreshold)) {
    regime = combinedScore <= 100 - CONFIG.marketRegimeStrongThreshold ? "BEARISH_STRONG" : "BEARISH";
    direction = "short";
  } else if (bothBear && breadthRatio < -0.20) {
    regime = "BEARISH"; direction = "short";
  } else if (bothBull && breadthRatio > 0.20) {
    regime = "BULLISH"; direction = "long";
  }

  const supportReliability = direction === "short" ? CONFIG.marketRegimeSupportReliabilityBear : 1;
  const resistanceReliability = direction === "long" ? CONFIG.marketRegimeResistanceReliabilityBull : 1;
  const confidence = Number(Math.max(Math.abs(combinedScore - 50), Math.abs(refScore - 50)).toFixed(1));
  return {
    enabled: true, regime, direction, score: Number(combinedScore.toFixed(1)), referenceScore: Number(refScore.toFixed(1)),
    confidence, agreement: Number(agreement.toFixed(1)), btc, eth,
    breadth: { score: Number(breadthScore.toFixed(1)), ratio: Number(breadthRatio.toFixed(3)), positive, negative, total: breadthValues.length },
    supportReliability, resistanceReliability,
    timestamp: Date.now(),
  };
}

function applyMarketRegimeToCandidate(candidate, marketRegime) {
  if (!candidate || !marketRegime?.enabled) return candidate;
  const ev = candidate.setupEvidence || {};
  const dir = candidate.direction;
  const macroDir = marketRegime.direction;
  const counterTrend = macroDir !== "neutral" && dir !== macroDir;
  const aligned = macroDir !== "neutral" && dir === macroDir;
  const regimeStrength = num(marketRegime.confidence, 0);

  let score = num(candidate.score), edge = num(candidate.edge);
  if (aligned) { score += CONFIG.marketRegimeAlignedBonus * Math.min(1, regimeStrength / 30); edge += 3; }
  if (counterTrend) {
    score -= CONFIG.marketRegimeCounterTrendPenalty * Math.min(1.25, regimeStrength / 30);
    edge -= 3;
  }

  const five = ev.fiveLayers || {};
  const side = dir === "long" ? "long" : "short";
  const localReversal = num(five.reversal?.[side]);
  const localFlow = num(five.flow?.[side]);
  const reversalConfidence = num(candidate.reversalConfidence);
  const strongCounterTrendReversal = candidate.setupType === "REVERSAL" && counterTrend &&
    localReversal >= CONFIG.marketRegimeCounterTrendReversalMin &&
    localFlow >= CONFIG.marketRegimeCounterTrendFlowMin &&
    reversalConfidence >= CONFIG.marketRegimeCounterTrendReversalMin &&
    num(candidate.edge) >= CONFIG.marketRegimeCounterTrendEdgeMin;

  const marketRegimeTag = `${marketRegime.regime}_${dir.toUpperCase()}${counterTrend ? "_COUNTER" : "_ALIGNED"}`;
  ev.marketRegime = {
    regime: marketRegime.regime, direction: macroDir, score: marketRegime.score, confidence: marketRegime.confidence,
    referenceScore: marketRegime.referenceScore, agreement: marketRegime.agreement,
    btcScore: marketRegime.btc?.score ?? 50, ethScore: marketRegime.eth?.score ?? 50,
    breadthScore: marketRegime.breadth?.score ?? 50, breadthRatio: marketRegime.breadth?.ratio ?? 0,
    counterTrend, aligned, strongCounterTrendReversal,
    supportReliability: marketRegime.supportReliability, resistanceReliability: marketRegime.resistanceReliability,
  };
  ev.marketRegimeTag = marketRegimeTag;

  return {
    ...candidate,
    score: Number(clamp(score, 0, 100).toFixed(2)),
    edge: Number(clamp(edge, 0, 100).toFixed(2)),
    setupEvidence: ev,
    indicators: { ...(candidate.indicators || {}), marketRegime: ev.marketRegime },
  };
}

async function broadScan(sdk, markets, tickers, marketValues = [], previousSnapshots = {}) {
  const listed = markets.filter(isLikelyPerpMarket);
  const results = await mapLimit(listed, CONFIG.ohlcvConcurrency, async (market) => {
    const symbol = candleSymbolFromMarket(market);
    try {
      const candles5 = await fetchCandles(sdk, market, CONFIG.broadTimeframe, CONFIG.broadLimit);
      const ticker = findTicker(tickers, market);
      const marketValue = findMarketValue(marketValues, market);
      const five = structureIndicators(candles5, "long");
      const short = structureIndicators(candles5, "short");
      const change = tickerChange5m(ticker);
      const impulse = Math.abs(change || five.move15);

      return {
        market,
        ticker,
        symbol: marketDisplaySymbol(market),
        candleSymbol: symbol,
        candles5,
        marketValue,
        previousSnapshot: previousSnapshots[marketDisplaySymbol(market)] || null,
        broadRankScore: Number((
          impulse * 10 +
          Math.max(five.adx, short.adx) * 0.7 +
          Math.max(five.reaction.score, short.reaction.score) +
          (tickerOpenInterest(ticker) > 0 ? 3 : 0)
        ).toFixed(3)),
      };
    } catch (error) {
      return {
        market,
        ticker: findTicker(tickers, market),
        symbol: marketDisplaySymbol(market),
        candleSymbol: symbol,
        error: safeError(error),
      };
    }
  });

  return {
    universe: listed.length,
    successful: results.filter((x) => x.candles5).length,
    failed: results.filter((x) => x.error).length,
    rows: results
      .filter((x) => x.candles5)
      .sort((a, b) => b.broadRankScore - a.broadRankScore),
  };
}

async function deepScan(sdk, broadRows, marketRegime = null) {
  const selected = broadRows.slice(0, CONFIG.deepCandidates);
  const results = await mapLimit(selected, Math.min(6, CONFIG.ohlcvConcurrency), async (row) => {
    // V20.5.1: never let one missing HTF feed kill the entire deep candidate.
    // The old Promise.all made a single 1D/4H/1H failure discard the symbol
    // before scoreCandidate() was even reached, which produced Deep: 0.
    const [d1, h4, h1, m15] = await Promise.allSettled([
      fetchCandlesResilient(sdk, row.market, CONFIG.htfTimeframe, CONFIG.htfLimit),
      fetchCandlesResilient(sdk, row.market, CONFIG.contextTimeframe, CONFIG.contextLimit),
      fetchCandlesResilient(sdk, row.market, "1h", CONFIG.contextLimit),
      fetchCandlesResilient(sdk, row.market, CONFIG.deepTimeframe, CONFIG.deepLimit),
    ]);

    const candles1d = d1.status === "fulfilled" ? d1.value : [];
    const candles4h = h4.status === "fulfilled" ? h4.value : [];
    const candles1h = h1.status === "fulfilled" ? h1.value : [];
    const candles15 = m15.status === "fulfilled" ? m15.value : [];

    // V21.5: 15M remains the preferred deep-timing source. One genuine HTF
    // layer (1D/4H/1H) is enough; a single transient HTF failure must not turn
    // the entire deep scan into zero candidates.
    if (candles15.length < 20) {
      return { ...row, error: `DEEP_15M_UNAVAILABLE:${m15.status === "rejected" ? safeError(m15.reason) : candles15.length}` };
    }
    const htfAvailable = candles1d.length >= 20 || candles4h.length >= 20 || candles1h.length >= 20;
    if (!htfAvailable && !CONFIG.allowOneHtfFallback) {
      const e1 = d1.status === "rejected" ? safeError(d1.reason) : `COUNT:${candles1d.length}`;
      const e4 = h4.status === "rejected" ? safeError(h4.reason) : `COUNT:${candles4h.length}`;
      const eH = h1.status === "rejected" ? safeError(h1.reason) : `COUNT:${candles1h.length}`;
      return { ...row, error: `HTF_ALL_UNAVAILABLE|1D:${e1}|4H:${e4}|1H:${eH}` };
    }

    const candidate = scoreCandidate({
      market: row.market,
      ticker: row.ticker,
      marketValue: row.marketValue,
      previousSnapshot: row.previousSnapshot,
      candles5: row.candles5,
      candles15,
      candles1h,
      candles4h,
      candles1d,
      marketRegime,
    });

    candidate.setupEvidence = candidate.setupEvidence || {};
    candidate.setupEvidence.htfData = {
      oneD: candles1d.length >= 20,
      fourH: candles4h.length >= 20,
      oneH: candles1h.length >= 20,
      fifteenM: candles15.length >= 20,
      structuralTf: candles1d.length >= 20 ? "1D" : candles4h.length >= 20 ? "4H" : candles1h.length >= 20 ? "1H" : "15M_FALLBACK",
      degraded: !htfAvailable,
    };
    candidate.indicators = candidate.indicators || {};
    candidate.indicators.htfData = candidate.setupEvidence.htfData;
    return applyMarketRegimeToCandidate(candidate, marketRegime);
  });

  const valid = results.filter((x) => x && !x.error && x.entry > 0);
  const failed = results.filter((x) => x?.error);
  console.log("[DEEP][15M+HTF][SUMMARY]", {
    attempted: selected.length,
    successful: valid.length,
    failed: failed.length,
    sampleErrors: failed.slice(0, 5).map(x => ({ symbol: x.symbol || x.item?.symbol || x.item?.market?.symbol || "UNKNOWN", error: x.error })),
  });

  return valid.sort((a, b) => (b.score + b.edge * 0.35) - (a.score + a.edge * 0.35));
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
    `🔎 Broad 5M: ${report.broadSuccess}/${report.universe}`,
    `🧠 Deep: ${report.deepCount}/${report.deepAttempted || report.deepCount} | Data failures: ${report.deepFailureCount || 0}`,
    `💧 Capital flow strong: ${report.flowCount} | Smart-money proxy: ${report.smartMoneyCount}`,
    `🧠 5-Layer: Ready ${report.layerReadyCount} | Flow ${report.layerFlowCount} | Reversal ${report.layerReversalCount}`,
    `🌐 Market Data Center: ${report.marketRegime?.regime || "N/A"} | BTC ${num(report.marketRegime?.btcScore).toFixed(0)} | ETH ${num(report.marketRegime?.ethScore).toFixed(0)} | Breadth ${num(report.marketRegime?.breadthScore).toFixed(0)}`,
    `⚡ Event candidates: ${report.actionableCount}`,
    ``,
    `🚀 Early impulses: ${report.impulseCount}`,
    `🧪 Early debug: A ${report.universe} / Q ${report.broadSuccess} / R ${report.deepCount}`,
    `🧩 Early gates: M ${report.universe} | B ${report.broadSuccess} | V ${report.deepSuccess} | F ${report.flowCount} | MA ${report.maCount} | A ${report.adxCount} | Z ${report.srCount} | P ${report.positiveMoveCount} | PB ${report.pullbackCount} | S ${report.scoreReadyCount} | E ${report.edgeReadyCount}`,
    `🚫 Early reject: Move ${report.rejectMove} / Body ${report.rejectBody} / Activity ${report.rejectActivity} / Accel ${report.rejectAccel} / Ext ${report.rejectExt} / Zone ${report.rejectZone} / Pre ${report.rejectPre} / Score ${report.rejectScore} / Edge ${report.rejectEdge} / Setup ${report.rejectSetup}`,
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
      const cf = item.setupEvidence?.capitalFlow || {};
      lines.push(`  💧 Flow ${num(cf.score).toFixed(1)} | ${String(cf.state || "N/A")} | Smart ${num(cf.smartMoneyProxy).toFixed(1)} | OI Δ ${num(cf.oiDeltaPct).toFixed(2)}% | Vol5 ${num(cf.volumeRatio5m).toFixed(2)}x`);
      const li = item.setupEvidence?.fiveLayers || {};
      const dir = String(item.direction || "").toLowerCase();
      const pick = (x) => dir === "long" ? num(x?.long) : num(x?.short);
      lines.push(`  🧠 5L T${pick(li.trend).toFixed(0)} L${pick(li.location).toFixed(0)} M${pick(li.momentum).toFixed(0)} F${pick(li.flow).toFixed(0)} R${pick(li.reversal).toFixed(0)} | ${String(li.direction || "N/A").toUpperCase()}`);
      const mr = item.setupEvidence?.marketRegime || {};
      if (mr.regime) lines.push(`  🌐 ${mr.regime} | BTC ${num(mr.btcScore).toFixed(0)} ETH ${num(mr.ethScore).toFixed(0)} Breadth ${num(mr.breadthScore).toFixed(0)} | ${mr.counterTrend ? "COUNTER" : "ALIGNED"}`);
      const slInfo = item.setupEvidence || {};
      lines.push(`  🛡️ SL ${formatPrice(item.sl)} | ${num(slInfo.slDistancePct).toFixed(2)}% | ${String(slInfo.slMethod || "N/A")}`);
      lines.push(`  💹 Gross ${formatUsd(econ.grossPnlUsd)} | Cost ${formatUsd(econ.totalCostUsd)} | Net ${formatUsd(econ.expectedNetUsd)} | TP move ${num(econ.tpMovePct).toFixed(2)}%`);
      lines.push(`  🚫 ${item.reason}`);
    }
  }

  lines.push(`🆔 Scan: ${report.scanId}`);
  lines.push(`🕐 ${new Date().toISOString()}`);
  lines.push(`ℹ️ مسیر: Scan → Selection → Dynamic SL/TP → Classic Execution → Verification`);

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

async function fetchOptionalIntelligence(env) {
  const cacheKey = "market-intelligence";
  const cached = MEMORY_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.at < CONFIG.intelligenceCacheMs) return cached.value;

  const value = {
    news: [],
    x: [],
    status: "OPTIONAL",
  };

  if (env?.NEWS_API_KEY) {
    try {
      const q = encodeURIComponent("crypto bitcoin ethereum altcoin market");
      const url = `https://newsapi.org/v2/everything?q=${q}&language=en&sortBy=publishedAt&pageSize=8&apiKey=${env.NEWS_API_KEY}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(CONFIG.newsTimeoutMs) });
      if (response.ok) {
        const body = await response.json();
        value.news = (body?.articles || []).slice(0, 8).map((x) => ({
          title: x.title,
          source: x.source?.name,
        }));
      }
    } catch (error) {
      value.newsError = safeError(error);
    }
  }

  if (env?.X_BEARER_TOKEN) {
    try {
      const query = encodeURIComponent("(bitcoin OR ethereum OR crypto) lang:en -is:retweet");
      const url = `https://api.x.com/2/tweets/search/recent?query=${query}&max_results=10`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${env.X_BEARER_TOKEN}`,
        },
        signal: AbortSignal.timeout(CONFIG.xTimeoutMs),
      });
      if (response.ok) {
        const body = await response.json();
        value.x = (body?.data || []).slice(0, 10).map((x) => x.text);
      }
    } catch (error) {
      value.xError = safeError(error);
    }
  }

  MEMORY_CACHE.set(cacheKey, { at: Date.now(), value });
  return value;
}

function enrichWithIntelligence(candidates, intelligence) {
  if (!intelligence?.news?.length && !intelligence?.x?.length) return candidates;
  const positiveWords = /(bull|breakout|surge|inflow|approval|adoption|rally|strong)/i;
  const negativeWords = /(hack|exploit|ban|liquidation|crash|dump|fraud|lawsuit)/i;
  const positive = [...intelligence.news.map((x) => x.title || ""), ...intelligence.x].filter((x) => positiveWords.test(x)).length;
  const negative = [...intelligence.news.map((x) => x.title || ""), ...intelligence.x].filter((x) => negativeWords.test(x)).length;
  const regime = positive > negative ? 1 : negative > positive ? -1 : 0;

  return candidates.map((c) => {
    const boost =
      regime === 0 ? 0 :
      (regime === 1 && c.direction === "long") || (regime === -1 && c.direction === "short")
        ? 3
        : -2;

    return {
      ...c,
      score: Number(clamp(c.score + boost, 0, 100).toFixed(2)),
      edge: Number(clamp(c.edge + boost, 0, 100).toFixed(2)),
      intelligenceRegime: regime,
    };
  });
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
  // GLOBAL MARKET DATA CENTER runs before deep signal classification. BTC/ETH
  // + breadth become the macro prior for every individual market.
  const marketRegime = await buildMarketRegimeDataCenter(runtime.sdk, universe, broad.rows);
  console.log("[MARKET_DATA_CENTER]", {
    regime: marketRegime.regime, direction: marketRegime.direction, score: marketRegime.score,
    confidence: marketRegime.confidence, btc: marketRegime.btc?.score, eth: marketRegime.eth?.score,
    breadth: marketRegime.breadth?.score, agreement: marketRegime.agreement,
  });
  const deep = await deepScan(runtime.sdk, broad.rows, marketRegime);
  const deepAttempted = Math.min(CONFIG.deepCandidates, broad.rows.length);
  const deepFailureCount = Math.max(0, deepAttempted - deep.length);
  const intelligence = await fetchOptionalIntelligence(env);
  const ranked = enrichWithIntelligence(deep, intelligence);

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
    symbol: selected[0].symbol, direction: selected[0].direction, entry: selected[0].entry, tp: selected[0].tp,
    setupType: selected[0].setupType, reversalEvidence: selected[0].reversalEvidence, score: selected[0].score,
    edge: selected[0].edge, risk: selected[0].risk, allocation: CONFIG.walletAllocationPerPosition, leverage: CONFIG.leverage,
    expectedGrossPnlUsd: selected[0].expectedGrossPnlUsd, expectedNetPnlUsd: selected[0].expectedNetPnlUsd,
    estimatedTotalCostUsd: selected[0].estimatedTotalCostUsd, netToCostRatio: selected[0].economics?.netToCostRatio,
    tpMovePct: selected[0].economics?.tpMovePct,
    tpMethod: selected[0].tpPlan?.method, tpTargetType: selected[0].tpPlan?.targetType,
    tpTargetScore: selected[0].tpPlan?.targetScore, tpProbabilityProxy: selected[0].tpPlan?.probabilityProxy,
    sharpMove: selected[0].setupEvidence?.sharpMove, lateChase: selected[0].setupEvidence?.lateChase,
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

  const impulseCount = broad.rows.filter((x) => Math.abs(tickerChange5m(x.ticker) || 0) >= 0.70).length;
  const flowCount = ranked.filter((x) => num(x.indicators?.capitalFlowScore) >= CONFIG.capitalFlowMinScore).length;
  const smartMoneyCount = ranked.filter((x) => num(x.indicators?.smartMoneyProxy) >= 65).length;
  const maCount = ranked.filter((x) => x.trendConfluence >= 3).length;
  const adxCount = ranked.filter((x) => x.indicators?.adx >= 18).length;
  const layerReadyCount = ranked.filter((x) => num(x.indicators?.fiveLayerConfidence) >= 62).length;
  const layerFlowCount = ranked.filter((x) => num(x.indicators?.flowLayer) >= 68).length;
  const layerReversalCount = ranked.filter((x) => num(x.indicators?.reversalLayer) >= 72).length;
  const srCount = ranked.filter((x) => x.indicators?.reactionScore >= 24).length;
  const positiveMoveCount = ranked.filter((x) => x.indicators?.move5m * (x.direction === "long" ? 1 : -1) > 0).length;
  const pullbackCount = ranked.filter((x) => x.indicators?.reactionScore >= 12).length;
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
    flowCount,
    smartMoneyCount,
    maCount,
    adxCount,
    layerReadyCount,
    layerFlowCount,
    layerReversalCount,
    marketRegime: marketRegime ? { regime: marketRegime.regime, direction: marketRegime.direction, score: marketRegime.score, confidence: marketRegime.confidence, btcScore: marketRegime.btc?.score ?? 50, ethScore: marketRegime.eth?.score ?? 50, breadthScore: marketRegime.breadth?.score ?? 50, agreement: marketRegime.agreement ?? 0 } : null,
    srCount,
    positiveMoveCount,
    pullbackCount,
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
