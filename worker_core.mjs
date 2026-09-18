/*
╔══════════════════════════════════════════════════════════════════════════════╗
║ GMX SMART MONEY FUTURES AI BOT — V22.5 PURE 1H STRUCTURE + DIRECTION LOCK + PRICE NORMALIZATION      ║
║ Single pipeline • COMPLETED 1H signal scan • Classic GMX only ║
║ 20x leverage • 100% wallet • max 1 position • dynamic TP + structure SL               ║
╚══════════════════════════════════════════════════════════════════════════════╝

Architecture:
GMX MARKET UNIVERSE
  → UNIVERSE DISCOVERY (NO SIGNAL AUTHORITY)
  → COMPLETED 1H OHLCV FOR EVERY MARKET
  → 1H STRUCTURE → SINGLE DIRECTION LOCK
  → 1H SL/TP + RR VALIDATION
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

export const BOT_VERSION = "V22.6.0-PURE-1H-RISK-DIRECTION-DUPLICATE-FIX";
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

  // V22.5: ONLY completed 1H candles have signal authority.
  signalTimeframe: "1h",
  signalLimit: 120,
  deepCandidates: 117,
  finalCandidates: 1,
  // Legacy scan values retained only for backwards-compatible config reads.
  broadTimeframe: "1h",
  broadLimit: 120,
  deepTimeframe: "1h",
  deepLimit: 120,
  htfTimeframe: "1h",
  contextTimeframe: "1h",
  htfLimit: 120,
  contextLimit: 120,

  // Pure-1H structure rules.
  oneHLookbackTrend: 8,
  oneHLookbackStructure: 30,
  oneHMinTrendMovePct: 0.80,
  oneHReversalTouchPct: 0.35,
  oneHReversalMaxDistanceFromExtremePct: 0.80,
  oneHReversalMinBodyRatio: 0.35,
  oneHReversalMinEvidence: 3,
  oneHContinuationBreakBufferPct: 0.08,
  oneHContinuationMaxChasePct: 1.25,
  oneHContinuationMinBodyRatio: 0.60,
  oneHContinuationMinCloseLocation: 0.70,
  oneHTargetBufferPct: 0.12,
  oneHTargetBufferAtr: 0.12,
  oneHMinRR: 1.50,

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

  // V21.8 Professional risk/reward plan. SL is structural/ATR; TP must
  // respect the actual stop distance instead of being selected independently.
  // This prevents valid setups from reaching Entry with an undefined/invalid plan.
  rrEnabled: true,
  rrMin: 1.50,
  rrBase: 2.00,
  rrStrong: 2.50,
  rrExtreme: 3.00,
  rrStructureTolerance: 0.12,

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

// GMX SDK price fields can be returned as 30-decimal fixed-point values
// (e.g. XRP 1.295e30). Never apply this conversion to generic numbers such
// as volume/OI; use it only for actual price fields.
function normalizePrice(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = num(value, NaN);
  if (!Number.isFinite(n)) return fallback;
  if (Math.abs(n) >= 1e20) {
    const scaled = n / 1e30;
    return Number.isFinite(scaled) ? scaled : fallback;
  }
  return n;
}

function normalizeTimestamp(value) {
  const n = num(value, 0);
  if (!(n > 0)) return 0;
  // Internal candle timestamps are stored in seconds.
  return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
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
  return normalizePrice(
    ticker?.markPrice ??
    ticker?.indexPrice ??
    ticker?.price ??
    ticker?.lastPrice ??
    ticker?.maxPrice ??
    ticker?.minPrice
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
  return normalizePrice(c?.close ?? c?.c ?? c?.[4]);
}
function candleOpen(c) {
  return normalizePrice(c?.open ?? c?.o ?? c?.[1]);
}
function candleHigh(c) {
  return normalizePrice(c?.high ?? c?.h ?? c?.[2]);
}
function candleLow(c) {
  return normalizePrice(c?.low ?? c?.l ?? c?.[3]);
}

function cleanCandles(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((c) => ({
      timestamp: normalizeTimestamp(c?.timestamp ?? c?.time ?? c?.t ?? c?.[0]),
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


function completedOneHCandles(candles) {
  const rows = Array.isArray(candles) ? candles.filter(c =>
    num(c?.open) > 0 && num(c?.high) > 0 && num(c?.low) > 0 && num(c?.close) > 0
  ).sort((a,b) => num(a.timestamp) - num(b.timestamp)) : [];
  if (rows.length < 3) return rows;

  // Drop the newest row only when it is actually the currently forming UTC
  // 1H candle. Some SDK endpoints return completed candles only; blindly
  // removing the newest row would otherwise discard the latest valid signal.
  const last = rows.at(-1);
  const tsMs = num(last?.timestamp) * 1000;
  const now = Date.now();
  const hourStart = Math.floor(now / 3600000) * 3600000;
  const lastMs = Number.isFinite(tsMs) ? tsMs : 0;
  const looksCurrent = lastMs >= hourStart && lastMs < now + 60000;
  return looksCurrent ? rows.slice(0, -1) : rows;
}

function oneHConfirmedSwings(candles, lookback = CONFIG.oneHLookbackStructure) {
  const rows = (candles || []).slice(-Math.max(10, Number(lookback) || 30));
  const highs = [], lows = [];
  for (let i = 2; i < rows.length - 2; i++) {
    const c = rows[i];
    if (c.high >= rows[i-1].high && c.high >= rows[i-2].high &&
        c.high >= rows[i+1].high && c.high >= rows[i+2].high) highs.push({
      price: c.high, index: i, timestamp: c.timestamp
    });
    if (c.low <= rows[i-1].low && c.low <= rows[i-2].low &&
        c.low <= rows[i+1].low && c.low <= rows[i+2].low) lows.push({
      price: c.low, index: i, timestamp: c.timestamp
    });
  }
  return { highs, lows };
}

function oneHStructureSignal(candles1h, ticker) {
  const c = completedOneHCandles(candles1h);
  if (c.length < 24) return {
    valid: false, reason: `INSUFFICIENT_COMPLETED_1H:${c.length}`,
    direction: null, setupType: "NONE", entry: num(c.at(-1)?.close) || tickerPrice(ticker) || 0
  };

  const last = c.at(-1);
  const prev = c.at(-2);
  // Entry authority uses the same completed 1H candle data as the structure
  // engine. Ticker price is only a fallback, preventing unit mismatches between
  // SDK fixed-point ticker fields and human-readable OHLCV prices.
  const price = num(last.close) || tickerPrice(ticker);
  const atr1h = Math.max(atr(c, 14), price * 0.001, 1e-12);
  const closes = c.map(x => num(x.close));
  const e20 = ema(closes, 20), e50 = ema(closes, 50), e200 = ema(closes, 200);
  const r = rsi(closes, 14), m = macd(closes), d = adx(c, 14);
  const st = stochastic(c);
  const bb = bollingerBands(closes);
  const swings = oneHConfirmedSwings(c);
  const recent = c.slice(-Math.max(6, Number(CONFIG.oneHLookbackTrend) || 8));
  const trendStart = num(recent[0]?.close);
  const trendMove = trendStart > 0 ? pct(last.close, trendStart) : 0;
  const prior = c.slice(-Math.max(12, Number(CONFIG.oneHLookbackTrend) || 8) - 1, -1);
  const priorHigh = prior.length ? Math.max(...prior.map(x => x.high)) : 0;
  const priorLow = prior.length ? Math.min(...prior.map(x => x.low)) : 0;

  const range = Math.max(last.high - last.low, 1e-12);
  const body = Math.abs(last.close - last.open);
  const bodyRatio = body / range;
  const closeLocation = (last.close - last.low) / range;
  const upperWick = last.high - Math.max(last.open, last.close);
  const lowerWick = Math.min(last.open, last.close) - last.low;
  const upperWickRatio = upperWick / range;
  const lowerWickRatio = lowerWick / range;

  const priorUp = trendMove >= CONFIG.oneHMinTrendMovePct &&
    last.close > e20 && e20 >= e50;
  const priorDown = trendMove <= -CONFIG.oneHMinTrendMovePct &&
    last.close < e20 && e20 <= e50;

  const priorSwingHigh = [...swings.highs]
    .filter(s => s.index < c.length - 2)
    .at(-1)?.price || 0;
  const priorSwingLow = [...swings.lows]
    .filter(s => s.index < c.length - 2)
    .at(-1)?.price || 0;

  // --------------------------- REVERSAL ----------------------------------
  // SHORT: prior 1H move UP -> valid confirmed high -> price tests that high
  // -> completed 1H bearish rejection/close -> current price has NOT already
  // fallen too far from the extreme.
  // IMPORTANT: a recent high is not automatically a valid resistance.
  // Reversal authority requires a CONFIRMED 1H swing high. This prevents a
  // single red candle inside an ongoing bullish impulse from becoming a SHORT.
  const shortExtreme = priorSwingHigh;
  const shortTouch = shortExtreme > 0 &&
    last.high >= shortExtreme * (1 - CONFIG.oneHReversalTouchPct / 100);
  const shortBearishReaction =
    shortExtreme > 0 &&
    last.close < last.open &&
    (upperWickRatio >= 0.25 || bodyRatio >= 0.45) &&
    last.close < prev.low &&
    last.close < shortExtreme;
  const shortReversalEvidence = [
    priorUp,
    shortTouch,
    shortBearishReaction,
    last.close < shortExtreme
  ].filter(Boolean).length;
  const shortDistanceFromExtreme = shortExtreme > 0 ? Math.abs(pct(price, shortExtreme)) : 999;
  const shortReversal =
    priorUp &&
    shortTouch &&
    shortBearishReaction &&
    shortReversalEvidence >= CONFIG.oneHReversalMinEvidence &&
    shortDistanceFromExtreme <= CONFIG.oneHReversalMaxDistanceFromExtremePct;

  // LONG: prior 1H move DOWN -> valid confirmed low -> price tests that low
  // -> completed 1H bullish rejection/close -> current price has NOT already
  // risen too far from the extreme.
  // Mirror rule: a recent low is not automatically valid support.
  // Reversal authority requires a CONFIRMED 1H swing low and a real bullish
  // reversal close, not merely a green candle above the previous close.
  const longExtreme = priorSwingLow;
  const longTouch = longExtreme > 0 &&
    last.low <= longExtreme * (1 + CONFIG.oneHReversalTouchPct / 100);
  const longBullishReaction =
    longExtreme > 0 &&
    last.close > last.open &&
    (lowerWickRatio >= 0.25 || bodyRatio >= 0.45) &&
    last.close > prev.high &&
    last.close > longExtreme;
  const longReversalEvidence = [
    priorDown,
    longTouch,
    longBullishReaction,
    last.close > longExtreme
  ].filter(Boolean).length;
  const longDistanceFromExtreme = Number.isFinite(longExtreme) && longExtreme > 0
    ? Math.abs(pct(price, longExtreme)) : 999;
  const longReversal =
    priorDown &&
    longTouch &&
    longBullishReaction &&
    longReversalEvidence >= CONFIG.oneHReversalMinEvidence &&
    longDistanceFromExtreme <= CONFIG.oneHReversalMaxDistanceFromExtremePct;

  // ------------------------- CONTINUATION --------------------------------
  // LONG requires a completed 1H solid-body close through resistance.
  // SHORT is the exact mirror below support.
  // Continuation also uses confirmed 1H structure. Rolling highs/lows are
  // intentionally NOT treated as resistance/support.
  const breakoutResistance = priorSwingHigh;
  const breakdownSupport = priorSwingLow;
  const longBreak =
    breakoutResistance > 0 &&
    last.close > breakoutResistance * (1 + CONFIG.oneHContinuationBreakBufferPct / 100) &&
    bodyRatio >= CONFIG.oneHContinuationMinBodyRatio &&
    closeLocation >= CONFIG.oneHContinuationMinCloseLocation;
  const shortBreak =
    Number.isFinite(breakdownSupport) && breakdownSupport > 0 &&
    last.close < breakdownSupport * (1 - CONFIG.oneHContinuationBreakBufferPct / 100) &&
    bodyRatio >= CONFIG.oneHContinuationMinBodyRatio &&
    closeLocation <= (1 - CONFIG.oneHContinuationMinCloseLocation);

  const longChase = breakoutResistance > 0
    ? Math.abs(pct(price, breakoutResistance)) > CONFIG.oneHContinuationMaxChasePct : true;
  const shortChase = Number.isFinite(breakdownSupport) && breakdownSupport > 0
    ? Math.abs(pct(price, breakdownSupport)) > CONFIG.oneHContinuationMaxChasePct : true;

  const longContinuation = longBreak && !longChase;
  const shortContinuation = shortBreak && !shortChase;

  // Direction is selected ONCE here. Nothing downstream may reinterpret it.
  // If both setups are somehow true on the same completed candle, refuse the
  // trade instead of guessing.
  let direction = null;
  let setupType = "NONE";
  let confidence = 0;
  let extreme = null;
  let structureLevel = null;
  let reversalEvidence = 0;
  let reasons = [];

  const directionConflict =
    (shortReversal && (longReversal || longContinuation)) ||
    (longReversal && (shortReversal || shortContinuation)) ||
    (longContinuation && shortContinuation);

  if (directionConflict) {
    return {
      valid:false, reason:"1H_DIRECTION_CONFLICT_NO_TRADE",
      direction:null, setupType:"NONE"
    };
  } else if (shortReversal) {
    direction = "short"; setupType = "REVERSAL"; confidence = 88;
    extreme = shortExtreme; structureLevel = priorSwingLow || priorLow || 0;
    reversalEvidence = shortReversalEvidence;
    reasons = ["1H_PRIOR_UPMOVE", "1H_VALID_HIGH", "1H_BEARISH_REJECTION"];
  } else if (longReversal) {
    direction = "long"; setupType = "REVERSAL"; confidence = 88;
    extreme = longExtreme; structureLevel = priorSwingHigh || priorHigh || 0;
    reversalEvidence = longReversalEvidence;
    reasons = ["1H_PRIOR_DOWNMOVE", "1H_VALID_LOW", "1H_BULLISH_REJECTION"];
  } else if (longContinuation) {
    direction = "long"; setupType = "CONTINUATION"; confidence = 86;
    extreme = breakoutResistance; structureLevel = breakoutResistance;
    reasons = ["1H_STRONG_RESISTANCE_BREAK", "1H_SOLID_BODY", "1H_CLOSE_ABOVE_RESISTANCE"];
  } else if (shortContinuation) {
    direction = "short"; setupType = "CONTINUATION"; confidence = 86;
    extreme = breakdownSupport; structureLevel = breakdownSupport;
    reasons = ["1H_STRONG_SUPPORT_BREAK", "1H_SOLID_BODY", "1H_CLOSE_BELOW_SUPPORT"];
  } else {
    // WATCH state: expose the structurally stronger side for diagnostics only.
    // It is NEVER entry authority.
    const longBias =
      Number(priorDown) * 2 + Number(longTouch) + Number(longBullishReaction) +
      Number(longBreak) * 2;
    const shortBias =
      Number(priorUp) * 2 + Number(shortTouch) + Number(shortBearishReaction) +
      Number(shortBreak) * 2;
    const diagnosticBias = longBias > shortBias ? "long" : shortBias > longBias ? "short" : null;
    setupType = diagnosticBias ? "1H_WATCH" : "NONE";
    confidence = Math.max(longBias, shortBias) * 15;
    return {
      valid: false, reason: "NO_CONFIRMED_1H_SETUP", direction: null, setupType, confidence,
      entry: price,
      diagnostics: {
        diagnosticBias,
        price, e20, e50, e200, rsi:r, macd:m, adx:d, stoch:st, bb,
        trendMove, priorUp, priorDown, longTouch, shortTouch,
        longBullishReaction, shortBearishReaction, longBreak, shortBreak,
        longChase, shortChase, bodyRatio, closeLocation,
        priorSwingHigh, priorSwingLow, breakoutResistance, breakdownSupport
      }
    };
  }

  // Structural SL:
  // Reversal: beyond the confirmed reversal extreme.
  // Continuation: beyond the confirmed broken level.
  // Use the configured ATR distances; the old 0.18 ATR buffer was too tight
  // and ignored the V21.6 SL configuration.
  const slAtrMultiplier = setupType === "REVERSAL"
    ? CONFIG.slAtrMultiplierReversal
    : CONFIG.slAtrMultiplierContinuation;
  const buffer = Math.max(
    atr1h * slAtrMultiplier,
    price * CONFIG.slMinDistancePct / 100,
    price * CONFIG.slSafetyBufferPct / 100
  );
  let sl = 0;
  if (direction === "short") sl = setupType === "REVERSAL" ? extreme + buffer : structureLevel + buffer;
  else sl = setupType === "REVERSAL" ? extreme - buffer : structureLevel - buffer;

  // For continuation, the stop must be on the invalidation side of the break.
  // For reversal, the stop must be beyond the actual high/low.
  if (direction === "short" && setupType === "REVERSAL") sl = Math.max(sl, extreme + buffer);
  if (direction === "long" && setupType === "REVERSAL") sl = Math.min(sl, extreme - buffer);
  if (direction === "short" && setupType === "CONTINUATION") sl = structureLevel + buffer;
  if (direction === "long" && setupType === "CONTINUATION") sl = structureLevel - buffer;

  // Targets are generated ONLY from 1H structure.
  const bufferTarget = Math.max(price * CONFIG.oneHTargetBufferPct / 100, atr1h * CONFIG.oneHTargetBufferAtr);
  let tp = 0, targetLevel = 0, targetType = "";

  if (direction === "short") {
    if (setupType === "REVERSAL") {
      const lows = swings.lows.map(x => x.price).filter(x => x < price && x < extreme).sort((a,b) => b-a);
      targetLevel = lows[0] || 0;
      if (!(targetLevel > 0)) return { valid:false, reason:"1H_SHORT_REVERSAL_NO_VALID_LOW", direction, setupType };
      tp = targetLevel + bufferTarget; // above the valid low, never the low itself
      targetType = "1H_VALID_LOW_BUFFERED";
    } else {
      const highsAbove = swings.highs.map(x => x.price).filter(x => x > price).sort((a,b) => a-b);
      targetLevel = highsAbove[0] || 0;
      // For a short continuation the next valid lower support is the target.
      const lowsBelow = swings.lows.map(x => x.price).filter(x => x < price).sort((a,b) => b-a);
      targetLevel = lowsBelow[0] || 0;
      if (!(targetLevel > 0)) return { valid:false, reason:"1H_SHORT_CONTINUATION_NO_VALID_LOW", direction, setupType };
      tp = targetLevel + bufferTarget;
      targetType = "1H_NEXT_SUPPORT_BUFFERED";
    }
  } else {
    if (setupType === "REVERSAL") {
      const highs = swings.highs.map(x => x.price).filter(x => x > price && x > extreme).sort((a,b) => a-b);
      targetLevel = highs[0] || 0;
      if (!(targetLevel > 0)) return { valid:false, reason:"1H_LONG_REVERSAL_NO_VALID_HIGH", direction, setupType };
      tp = targetLevel - bufferTarget; // below the valid high, never the high itself
      targetType = "1H_VALID_HIGH_BUFFERED";
    } else {
      const highsAbove = swings.highs.map(x => x.price).filter(x => x > price).sort((a,b) => a-b);
      targetLevel = highsAbove[0] || 0;
      if (!(targetLevel > 0)) return { valid:false, reason:"1H_LONG_CONTINUATION_NO_VALID_HIGH", direction, setupType };
      tp = targetLevel - bufferTarget;
      targetType = "1H_NEXT_RESISTANCE_BUFFERED";
    }
  }

  const slDistance = Math.abs(price - sl);
  const tpDistance = Math.abs(tp - price);
  const rr = slDistance > 0 ? tpDistance / slDistance : 0;
  const sideValid = direction === "long" ? sl < price && tp > price : sl > price && tp < price;
  const slDistancePct = Math.abs(pct(sl, price));
  const rrPass = rr >= CONFIG.oneHMinRR;

  if (!sideValid) return {
    valid:false, reason:"1H_PLAN_WRONG_SIDE", direction, setupType, entry:price, sl, tp, rr
  };
  if (slDistancePct < CONFIG.slMinDistancePct) return {
    valid:false,
    reason:`SL_${slDistancePct.toFixed(2)}_BELOW_MIN_${CONFIG.slMinDistancePct.toFixed(2)}`,
    direction, setupType, entry:price, sl, tp, rr
  };
  if (slDistancePct > CONFIG.slMaxDistancePct) return {
    valid:false,
    reason:`SL_${slDistancePct.toFixed(2)}_ABOVE_MAX_${CONFIG.slMaxDistancePct.toFixed(2)}`,
    direction, setupType, entry:price, sl, tp, rr
  };
  if (!rrPass) return {
    valid:false, reason:`RR_${rr.toFixed(2)}_BELOW_${CONFIG.oneHMinRR.toFixed(2)}`,
    direction, setupType, entry:price, sl, tp, rr
  };

  const distanceFromExtreme = Math.abs(pct(price, extreme));
  if (setupType === "REVERSAL" &&
      distanceFromExtreme > CONFIG.oneHReversalMaxDistanceFromExtremePct) {
    return {
      valid:false, reason:"REVERSAL_ALREADY_TRAVELLED_TOO_FAR",
      direction, setupType, entry:price, sl, tp, rr
    };
  }

  const movePct = Math.abs(trendMove);
  const score = clamp(
    72 +
    confidence * 0.18 +
    (d >= 18 ? 5 : 0) +
    (bodyRatio >= 0.60 ? 5 : 0) +
    (rr >= 2 ? 5 : 0),
    0, 100
  );
  const edge = clamp(
    18 + confidence * 0.55 + Math.min(20, rr * 5) +
    (setupType === "REVERSAL" ? reversalEvidence * 4 : 8),
    0, 100
  );
  const risk = clamp(Math.abs(pct(sl, price)) * 20, 0, 100);

  const volumeRows = c.filter(x => num(x.volume) > 0);
  const volAvg = volumeRows.slice(-21,-1).reduce((a,x)=>a+num(x.volume),0) /
    Math.max(1, volumeRows.slice(-21,-1).length);
  const volumeRatio1h = num(last.volume) > 0 && volAvg > 0 ? num(last.volume) / volAvg : 0;

  const fiveLayers = {
    enabled: true,
    direction,
    authority: "1H_STRUCTURE",
    confidence: Number(confidence.toFixed(1)),
    edge: Number(edge.toFixed(1)),
    long: direction === "long" ? Number(confidence.toFixed(1)) : 50,
    short: direction === "short" ? Number(confidence.toFixed(1)) : 50,
    trend: {
      long: Number((last.close > e20 && e20 >= e50 ? 80 : 45).toFixed(1)),
      short: Number((last.close < e20 && e20 <= e50 ? 80 : 45).toFixed(1)),
      direction: last.close >= e20 ? "long" : "short"
    },
    location: { long: longTouch ? 75 : 50, short: shortTouch ? 75 : 50 },
    momentum: {
      long: Number(clamp(50 + (m.histogram > 0 ? 18 : -8) + (r < 40 ? 10 : 0),0,100).toFixed(1)),
      short: Number(clamp(50 + (m.histogram < 0 ? 18 : -8) + (r > 60 ? 10 : 0),0,100).toFixed(1))
    },
    flow: {
      long: volumeRatio1h >= 1.25 && last.close > last.open ? 72 : 50,
      short: volumeRatio1h >= 1.25 && last.close < last.open ? 72 : 50
    },
    reversal: { long: longReversal ? confidence : 50, short: shortReversal ? confidence : 50 }
  };

  return {
    valid: true,
    symbol: null,
    direction,
    directionAuthority: "1H_STRUCTURE",
    setupType,
    entry: price,
    sl: Number(sl.toPrecision(12)),
    tp: Number(tp.toPrecision(12)),
    rr: Number(rr.toFixed(2)),
    score: Number(score.toFixed(2)),
    edge: Number(edge.toFixed(2)),
    risk: Number(risk.toFixed(2)),
    trendConfluence: direction === "long"
      ? Number(last.close > e20) + Number(e20 >= e50) + Number(m.histogram > 0)
      : Number(last.close < e20) + Number(e20 <= e50) + Number(m.histogram < 0),
    reversalEvidence,
    setupConfidence: confidence,
    reversalConfidence: setupType === "REVERSAL" ? confidence : 0,
    continuationConfidence: setupType === "CONTINUATION" ? confidence : 0,
    setupDominance: setupType === "REVERSAL" ? 20 : 15,
    triggerActive: true,
    reversalTrigger: setupType === "REVERSAL",
    continuationTrigger: setupType === "CONTINUATION",
    tpPlan: {
      tp: Number(tp.toPrecision(12)), method: "PURE_1H_STRUCTURE",
      targetType, targetScore: 80, probabilityProxy: 80,
      distancePct: Number(Math.abs(pct(tp, price)).toFixed(3)),
      rr: Number(rr.toFixed(2)), rrPass: true, targetPrice: targetLevel,
      atrDistance: Number(tpDistance / atr1h).toFixed(2)
    },
    setupEvidence: {
      setupType, directionAuthority: "1H_STRUCTURE",
      directionLocked: true,
      signalTimeframe: "1H",
      signalCandle: last.timestamp,
      priorTrend: priorUp ? "UP" : priorDown ? "DOWN" : "NEUTRAL",
      priorTrendMovePct: Number(trendMove.toFixed(3)),
      validExtreme: extreme,
      structureLevel,
      targetLevel,
      targetType,
      bodyRatio: Number(bodyRatio.toFixed(3)),
      closeLocation: Number(closeLocation.toFixed(3)),
      volumeRatio1h: Number(volumeRatio1h.toFixed(2)),
      rsi1h: Number(r.toFixed(2)),
      macdHistogram1h: Number(m.histogram.toFixed(8)),
      atr1h,
      reversalEvidence,
      reversalTouch: setupType === "REVERSAL",
      continuationBreak: setupType === "CONTINUATION",
      continuationChasePct: setupType === "CONTINUATION"
        ? Number(Math.abs(pct(price, structureLevel)).toFixed(3)) : 0,
      sl: Number(sl.toPrecision(12)),
      slDistancePct: Number(Math.abs(pct(sl, price)).toFixed(3)),
      slMethod: setupType === "REVERSAL" ? "1H_EXTREME_ATR_BUFFER" : "1H_BROKEN_STRUCTURE_ATR_BUFFER",
      slValid: true,
      tpMethod: "PURE_1H_STRUCTURE",
      tpDistancePct: Number(Math.abs(pct(tp, price)).toFixed(3)),
      tpRR: Number(rr.toFixed(2)),
      tpRRPass: true,
      fiveLayers,
      marketRegime: null,
      capitalFlow: null,
      legacy5mDisabled: true,
      legacy15mDisabled: true
    },
    reasons: [...reasons, "DIRECTION_LOCKED_1H", `RR_${rr.toFixed(2)}`, `SL_1H`, `TP_1H`],
    indicators: {
      timeframe: "1H",
      rsi: Number(r.toFixed(2)), adx: Number(d.toFixed(2)),
      ema20: e20, ema50: e50, ema200: e200,
      macdHistogram: m.histogram,
      move1h: Number(trendMove.toFixed(3)),
      volumeRatio1h: Number(volumeRatio1h.toFixed(2)),
      fiveLayerConfidence: confidence,
      fiveLayerEdge: edge,
      fiveLayerDirection: direction,
      directionAuthority: "1H_STRUCTURE"
    },
    market: null, ticker, candles1h: c
  };
}

function scoreCandidate({ market, ticker, candles1h, marketRegime }) {
  const base = oneHStructureSignal(candles1h, ticker);
  const symbol = marketDisplaySymbol(market);
  if (!base.valid) {
    return {
      symbol, candleSymbol: candleSymbolFromMarket(market),
      direction: base.valid ? (base.direction || null) : null,
      setupType: base.setupType || "NONE",
      score: 0, edge: 0, risk: 100,
      entry: num(base.entry) || num(base.diagnostics?.price) || tickerPrice(ticker) || 0,
      sl: num(base.sl) || 0, tp: num(base.tp) || 0, rr: num(base.rr) || 0,
      triggerActive: false,
      reversalTrigger: false, continuationTrigger: false,
      reversalEvidence: num(base.reversalEvidence),
      setupConfidence: num(base.confidence),
      setupEvidence: {
        ...(base.diagnostics || {}),
        reason: base.reason,
        signalTimeframe: "1H",
        directionAuthority: "1H_STRUCTURE",
        directionLocked: false,
        legacy5mDisabled: true,
        legacy15mDisabled: true
      },
      reasons: [base.reason],
      indicators: { timeframe: "1H", directionAuthority: "1H_STRUCTURE" },
      market, ticker, candles1h: completedOneHCandles(candles1h)
    };
  }

  base.symbol = symbol;
  base.candleSymbol = candleSymbolFromMarket(market);
  base.market = market;
  base.ticker = ticker;
  base.candles1h = completedOneHCandles(candles1h);

  // Global BTC/ETH context can penalize a counter-trend trade, but it can NEVER
  // change the direction locked by the completed 1H structure.
  if (marketRegime?.enabled) {
    base.setupEvidence.marketRegime = {
      regime: marketRegime.regime,
      direction: marketRegime.direction,
      score: marketRegime.score,
      confidence: marketRegime.confidence,
      btcScore: marketRegime.btc?.score ?? 50,
      ethScore: marketRegime.eth?.score ?? 50,
      breadthScore: marketRegime.breadth?.score ?? 50,
      agreement: marketRegime.agreement ?? 0,
      counterTrend: marketRegime.direction !== "neutral" && marketRegime.direction !== base.direction,
      aligned: marketRegime.direction !== "neutral" && marketRegime.direction === base.direction
    };
    base.setupEvidence.marketRegimeDirectionCannotOverride = true;
  }

  return base;
}


function calculateDynamicSl(entry, direction, candles1h, _unused, atr1h, setupType = "CONTINUATION", setupEvidence = {}) {
  const price = num(entry);
  const sl = num(setupEvidence?.sl);
  if (!(price > 0) || !(sl > 0)) return { sl: 0, distancePct: 0, method: "INVALID_1H_SL", valid: false };
  const validSide = direction === "long" ? sl < price : sl > price;
  const distancePct = Math.abs(pct(sl, price));
  return {
    sl: Number(sl.toPrecision(12)),
    distancePct: Number(distancePct.toFixed(3)),
    method: setupEvidence?.slMethod || "PURE_1H_STRUCTURE",
    valid: validSide,
    directionLocked: true
  };
}

function calculateLogicalTp(entry, direction, _candles1h, _unused, _atr1h, setupType = "CONTINUATION", _impulse = {}, slPrice = 0, _signalScore = 0) {
  const tp = num(arguments[2]?.tp ?? 0);
  const fallback = num(arguments[7]?.tp ?? 0);
  const target = tp > 0 ? tp : fallback;
  const slDistance = Math.abs(num(entry) - num(slPrice));
  const rr = slDistance > 0 && target > 0 ? Math.abs(target - num(entry)) / slDistance : 0;
  const sideValid = direction === "long" ? target > num(entry) : target < num(entry);
  return {
    tp: target,
    method: "PURE_1H_STRUCTURE",
    targetType: "1H_STRUCTURE",
    targetScore: 80,
    probabilityProxy: 80,
    distancePct: target > 0 ? Number(Math.abs(pct(target, num(entry))).toFixed(3)) : 0,
    rr: Number(rr.toFixed(2)),
    rrPass: sideValid && rr >= CONFIG.oneHMinRR,
    targetPrice: target,
    atrDistance: 0
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
  if (!candidate || !candidate.symbol || !(num(candidate.entry) > 0)) {
    return { ok: false, reason: "INVALID_1H_CANDIDATE" };
  }

  const direction = String(candidate.direction || "").toLowerCase();
  if (direction !== "long" && direction !== "short") {
    return { ok: false, reason: "DIRECTION_NOT_LOCKED" };
  }
  if (candidate.directionAuthority !== "1H_STRUCTURE" ||
      candidate.setupEvidence?.directionAuthority !== "1H_STRUCTURE" ||
      candidate.setupEvidence?.directionLocked !== true) {
    return { ok: false, reason: "DIRECTION_AUTHORITY_NOT_1H" };
  }
  if (candidate.setupEvidence?.signalTimeframe !== "1H") {
    return { ok: false, reason: "SIGNAL_TIMEFRAME_NOT_1H" };
  }

  const entry = num(candidate.entry), sl = num(candidate.sl), tp = num(candidate.tp);
  if (!(sl > 0) || !(tp > 0)) return { ok: false, reason: "1H_SL_TP_MISSING" };

  if (direction === "long" && (!(sl < entry) || !(tp > entry))) {
    return { ok: false, reason: "DIRECTION_PLAN_MISMATCH_LONG" };
  }
  if (direction === "short" && (!(sl > entry) || !(tp < entry))) {
    return { ok: false, reason: "DIRECTION_PLAN_MISMATCH_SHORT" };
  }

  const rr = Math.abs(tp - entry) / Math.max(Math.abs(entry - sl), 1e-12);
  if (rr < CONFIG.oneHMinRR) return { ok: false, reason: `RR_${rr.toFixed(2)}_BELOW_${CONFIG.oneHMinRR.toFixed(2)}` };

  if (candidate.setupType !== "REVERSAL" && candidate.setupType !== "CONTINUATION") {
    return { ok: false, reason: "NO_CONFIRMED_1H_SETUP" };
  }

  if (candidate.setupType === "REVERSAL") {
    if (num(candidate.reversalEvidence) < CONFIG.oneHReversalMinEvidence) {
      return { ok: false, reason: "1H_REVERSAL_EVIDENCE_INSUFFICIENT" };
    }
    if (num(candidate.setupEvidence?.continuationChasePct) > CONFIG.oneHReversalMaxDistanceFromExtremePct) {
      return { ok: false, reason: "REVERSAL_ALREADY_TRAVELLED_TOO_FAR" };
    }
  }

  if (candidate.setupType === "CONTINUATION") {
    if (num(candidate.setupEvidence?.continuationChasePct) > CONFIG.oneHContinuationMaxChasePct) {
      return { ok: false, reason: "1H_CONTINUATION_CHASE_TOO_FAR" };
    }
    if (!candidate.setupEvidence?.continuationBreak) {
      return { ok: false, reason: "1H_CONTINUATION_BREAK_NOT_CONFIRMED" };
    }
  }

  // Global context is a gate/quality modifier only. It NEVER changes direction.
  const macro = candidate.setupEvidence?.marketRegime;
  if (macro?.direction && macro.direction !== "neutral" && macro.direction !== direction) {
    if (candidate.setupType !== "REVERSAL" || num(candidate.reversalConfidence) < 78) {
      return { ok: false, reason: `GLOBAL_${macro.regime}_COUNTER_TREND_NOT_STRONG_ENOUGH` };
    }
    candidate.setupEvidence.globalCounterTrendApproved = true;
  }

  const slDistance = Math.abs(pct(sl, entry));
  if (slDistance < CONFIG.slMinDistancePct * 0.95) {
    return { ok: false, reason: `SL_TOO_CLOSE_${slDistance.toFixed(2)}PCT` };
  }
  if (slDistance > CONFIG.slMaxDistancePct + 0.05) {
    return { ok: false, reason: `SL_TOO_FAR_${slDistance.toFixed(2)}PCT` };
  }

  return {
    ok: true,
    reason: candidate.setupType === "REVERSAL" ? "PURE_1H_REVERSAL_READY" : "PURE_1H_CONTINUATION_READY"
  };
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
    const oo = normalizePrice(o), hh = normalizePrice(h), ll = normalizePrice(l), cc = normalizePrice(c);
    if ([ts,oo,hh,ll,cc].every(Number.isFinite)) out.push({ timestamp: normalizeTimestamp(ts), open:oo, high:hh, low:ll, close:cc, volume:Number.isFinite(v)?v:0 });
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

// V22.5.1+: single resilient 1H OHLCV entry point.
// The previous V22.5 build called this helper but never defined it, causing
// every market (and BTC/ETH) to fail before the 1H engine could run.
async function fetchCandlesResilient(sdk, marketOrSymbol, timeframe, limit) {
  const tf = String(timeframe || "1h").toLowerCase();
  if (tf !== "1h") throw new Error(`PURE_1H_ONLY_TIMEFRAME:${tf}`);
  return fetchCandles(sdk, marketOrSymbol, "1h", limit);
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
  const rows = completedOneHCandles(candles);
  if (rows.length < 24) return { available: false, score: 50, direction: "neutral", confidence: 0 };
  const closes = rows.map(x => num(x.close)).filter(x => x > 0);
  const last = closes.at(-1);
  const e20 = ema(closes, 20), e50 = ema(closes, 50), e200 = ema(closes, 200);
  const m = macd(closes), ad = adx(rows, 14), r = rsi(closes, 14);
  const ret3 = pct(last, closes.at(-4) || last);
  const ret8 = pct(last, closes.at(-9) || last);
  let bull = 50;
  bull += last > e20 ? 8 : -8;
  bull += e20 > e50 ? 10 : -10;
  bull += e50 > e200 ? 8 : -8;
  bull += m.histogram > 0 ? 8 : -8;
  bull += r >= 52 ? 5 : -5;
  bull += ret3 > 0.15 ? 5 : ret3 < -0.15 ? -5 : 0;
  bull += ret8 > 0.50 ? 8 : ret8 < -0.50 ? -8 : 0;
  if (ad >= 18) bull += bull >= 50 ? 4 : -4;
  bull = clamp(bull, 0, 100);
  return {
    available: true, score: Number(bull.toFixed(1)),
    direction: bull >= 55 ? "long" : bull <= 45 ? "short" : "neutral",
    confidence: Number(Math.abs(bull - 50).toFixed(1)),
    price:last, ema20:e20, ema50:e50, ema200:e200,
    macdHistogram:m.histogram, rsi:r, adx:ad, ret3, ret8
  };
}

async function buildMarketRegimeDataCenter(sdk, markets, _broadRows = []) {
  if (!CONFIG.marketRegimeEnabled) {
    return { enabled:false, regime:"NEUTRAL", direction:"neutral", score:50, confidence:0, btc:null, eth:null, breadth:null };
  }
  const btcMarket = findReferenceMarket(markets, "BTC");
  const ethMarket = findReferenceMarket(markets, "ETH");

  async function analyzeRef(market, asset) {
    if (!market) return { asset, available:false, reason:"REFERENCE_MARKET_NOT_FOUND" };
    try {
      const candles = await fetchCandlesResilient(sdk, market, "1h", CONFIG.signalLimit);
      const x = marketRegimeFrameScore(candles);
      return { asset, ...x, timeframe:"1H" };
    } catch (e) {
      return { asset, available:false, reason:safeError(e), score:50, direction:"neutral", confidence:0 };
    }
  }

  const [btc, eth] = await Promise.all([analyzeRef(btcMarket,"BTC"), analyzeRef(ethMarket,"ETH")]);
  const btcScore = num(btc.score,50), ethScore = num(eth.score,50);
  const weights = (btc.available ? CONFIG.marketRegimeBtcWeight : 0) + (eth.available ? CONFIG.marketRegimeEthWeight : 0);
  const refScore = weights > 0
    ? ((btc.available ? btcScore * CONFIG.marketRegimeBtcWeight : 0) +
       (eth.available ? ethScore * CONFIG.marketRegimeEthWeight : 0)) / weights
    : 50;

  // Breadth is derived from the current ticker snapshot, not a 5M signal.
  const rows = Array.isArray(_broadRows) ? _broadRows : [];
  const changes = rows.map(r => num(r?.ticker?.priceChange24hPercent ?? r?.ticker?.change24hPercent ?? 0, 0));
  const positive = changes.filter(x => x > 0.25).length;
  const negative = changes.filter(x => x < -0.25).length;
  const breadthRatio = changes.length ? (positive - negative) / changes.length : 0;
  const breadthScore = 50 + breadthRatio * 50;
  const combinedScore = clamp(
    refScore * (1 - CONFIG.marketRegimeBreadthWeight) + breadthScore * CONFIG.marketRegimeBreadthWeight,
    0, 100
  );

  const bothBear = btcScore <= 45 && ethScore <= 45;
  const bothBull = btcScore >= 55 && ethScore >= 55;
  let regime = "MIXED", direction = "neutral";
  if (combinedScore >= CONFIG.marketRegimeBullThreshold && (bothBull || combinedScore >= CONFIG.marketRegimeStrongThreshold)) {
    regime = combinedScore >= CONFIG.marketRegimeStrongThreshold ? "BULLISH_STRONG" : "BULLISH";
    direction = "long";
  } else if (combinedScore <= CONFIG.marketRegimeBearThreshold && (bothBear || combinedScore <= 100 - CONFIG.marketRegimeStrongThreshold)) {
    regime = combinedScore <= 100 - CONFIG.marketRegimeStrongThreshold ? "BEARISH_STRONG" : "BEARISH";
    direction = "short";
  }

  const agreement = 100 - Math.min(100, Math.abs(btcScore - ethScore) * 2);
  return {
    enabled:true, timeframe:"1H", regime, direction,
    score:Number(combinedScore.toFixed(1)), referenceScore:Number(refScore.toFixed(1)),
    confidence:Number(Math.max(Math.abs(combinedScore-50),Math.abs(refScore-50)).toFixed(1)),
    agreement:Number(agreement.toFixed(1)), btc, eth,
    breadth:{score:Number(breadthScore.toFixed(1)), ratio:Number(breadthRatio.toFixed(3)), positive, negative, total:changes.length},
    supportReliability:1, resistanceReliability:1, timestamp:Date.now()
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
  // No OHLCV is fetched here. This is universe discovery only; it has zero
  // signal authority and cannot create a direction.
  const rows = listed.map((market) => {
    const ticker = findTicker(tickers, market);
    const marketValue = findMarketValue(marketValues, market);
    const change24h = num(ticker?.priceChange24hPercent ?? ticker?.change24hPercent ?? 0);
    const oi = tickerOpenInterest(ticker);
    return {
      market, ticker,
      symbol: marketDisplaySymbol(market),
      candleSymbol: candleSymbolFromMarket(market),
      marketValue,
      previousSnapshot: previousSnapshots[marketDisplaySymbol(market)] || null,
      broadRankScore: Number((Math.abs(change24h) + (oi > 0 ? 0.5 : 0)).toFixed(3))
    };
  });
  return { universe:listed.length, successful:listed.length, failed:0, rows };
}

async function deepScan(sdk, broadRows, marketRegime = null) {
  const selected = broadRows.slice(0, Math.min(CONFIG.deepCandidates, broadRows.length));
  const results = await mapLimit(selected, Math.min(8, CONFIG.ohlcvConcurrency), async (row) => {
    try {
      const candles1h = await fetchCandlesResilient(sdk, row.market, "1h", CONFIG.signalLimit);
      if (candles1h.length < 24) {
        return { ...row, error:`INSUFFICIENT_1H_CANDLES:${candles1h.length}` };
      }
      const candidate = scoreCandidate({
        market: row.market, ticker: row.ticker,
        candles1h, marketRegime
      });
      return candidate;
    } catch (error) {
      return { ...row, error:safeError(error) };
    }
  });

  const valid = results.filter(x => x && !x.error && x.symbol);
  const failed = results.filter(x => x?.error);
  console.log("[DEEP][PURE_1H][SUMMARY]", {
    attempted:selected.length, successful:valid.length,
    failed:failed.length, timeframe:"1H",
    failures:failed.slice(0, 5).map(x => ({symbol:x.symbol, error:x.error}))
  });
  const ordered = valid.sort((a,b) => num(b.score)-num(a.score));
  Object.defineProperty(ordered, "failedCount", { value: failed.length, enumerable: false });
  Object.defineProperty(ordered, "attemptedCount", { value: selected.length, enumerable: false });
  return ordered;
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
  const response = await sdk.fetchPositionsInfo({
    address: account,
    includeRelatedOrders: true,
  });

  // GMX SDK versions may return an array directly or wrap it in
  // positions/data/result. The old code accepted arrays only, which could
  // turn a real open position into [] and allow the bot to open it again.
  const direct =
    Array.isArray(response) ? response :
    Array.isArray(response?.positions) ? response.positions :
    Array.isArray(response?.data) ? response.data :
    Array.isArray(response?.data?.positions) ? response.data.positions :
    Array.isArray(response?.result) ? response.result :
    Array.isArray(response?.result?.positions) ? response.result.positions :
    null;

  const positions = direct || collectObjects(
    response,
    (x) => Boolean(
      x &&
      (x.isLong !== undefined || x.indexName || x.marketSymbol || x.market?.symbol) &&
      (x.sizeInUsd !== undefined || x.sizeUsd !== undefined || x.size !== undefined)
    )
  );

  return positions
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
    `🔎 Universe discovery: ${report.universeScanSuccess}/${report.universe} | Signal authority: 1H`,
    `🕐 1H signal scan: ${report.deepCount}/${report.deepAttempted || report.deepCount} | Data failures: ${report.deepFailureCount || 0}`,
    `📐 Signal authority: COMPLETED 1H CANDLE STRUCTURE`,
    `🧭 Entry / SL / TP timeframe: 1H`,
    `🔒 Direction lock: 1H STRUCTURE → LONG / SHORT`,
    `💧 1H volume-flow diagnostic: ${report.flowCount} | Strong volume: ${report.smartMoneyCount}`,
    `🧠 1H setups: Ready ${report.layerReadyCount} | Continuation ${report.impulseCount} | Reversal ${report.layerReversalCount}`,
    `🌐 Market Data Center: ${report.marketRegime?.regime || "N/A"} | BTC ${num(report.marketRegime?.btcScore).toFixed(0)} | ETH ${num(report.marketRegime?.ethScore).toFixed(0)} | Breadth ${num(report.marketRegime?.breadthScore).toFixed(0)}`,
    ``,
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
      `🔒 Direction verified: ${trade.directionVerified ? "YES" : "NO"}`,
      `──────────────────`,
    );
  }

  if (report.topRejected.length) {
    lines.push(`ℹ️ TOP BLOCKED`);
    for (const item of report.topRejected.slice(0, 3)) {
      lines.push(`• ${item.symbol}`);
      lines.push(`  📌 ${String(item.direction || "N/A").toUpperCase()} | Entry ${formatPrice(item.entry)} | SL ${formatPrice(item.sl)} | TP ${formatPrice(item.tp)}`);
      lines.push(`  🧠 ${String(item.setupType || "N/A")} | Score ${num(item.score).toFixed(1)} | Edge ${num(item.edge).toFixed(1)} | Risk ${num(item.risk).toFixed(1)}`);
      const ev = item.setupEvidence || {};
      lines.push(`  🕐 1H trend ${String(ev.priorTrend || "N/A")} | Move ${num(ev.priorTrendMovePct).toFixed(2)}% | Body ${num(ev.bodyRatio).toFixed(2)} | Close ${num(ev.closeLocation).toFixed(2)}`);
      lines.push(`  💧 1H volume ${num(ev.volumeRatio1h).toFixed(2)}x`);
      const mr = ev.marketRegime || {};
      if (mr.regime) lines.push(`  🌐 ${mr.regime} | BTC ${num(mr.btcScore).toFixed(0)} ETH ${num(mr.ethScore).toFixed(0)} Breadth ${num(mr.breadthScore).toFixed(0)} | ${mr.counterTrend ? "COUNTER" : "ALIGNED"}`);
      lines.push(`  🛡️ SL ${formatPrice(item.sl)} | ${num(ev.slDistancePct).toFixed(2)}% | ${String(ev.slMethod || "N/A")}`);
      const econ = item.economics || {};
      lines.push(`  💹 Gross ${formatUsd(econ.grossPnlUsd)} | Cost ${formatUsd(econ.totalCostUsd)} | Net ${formatUsd(econ.expectedNetUsd)} | TP move ${num(econ.tpMovePct).toFixed(2)}%`);
      lines.push(`  🚫 ${item.reason}`);
    }
  }

  lines.push(`🆔 Scan: ${report.scanId}`);
  lines.push(`🕐 ${new Date().toISOString()}`);
  lines.push(`ℹ️ مسیر: Universe → Completed 1H Structure → Direction Lock → 1H SL/TP → Selection → Classic Execution → Verification`);
  return lines.join("\n");
}

function validateDirectionIntegrity(candidate) {
  const direction = String(candidate?.direction || "").toLowerCase();
  if (direction !== "long" && direction !== "short") {
    return { ok:false, reason:"DIRECTION_INVALID_OR_MISSING" };
  }
  if (candidate?.directionAuthority !== "1H_STRUCTURE" ||
      candidate?.setupEvidence?.directionAuthority !== "1H_STRUCTURE" ||
      candidate?.setupEvidence?.directionLocked !== true) {
    return { ok:false, reason:"DIRECTION_NOT_LOCKED_TO_1H_STRUCTURE" };
  }
  const entry = num(candidate.entry), sl = num(candidate.sl), tp = num(candidate.tp);
  if (!(entry > 0 && sl > 0 && tp > 0)) return { ok:false, reason:"DIRECTION_PLAN_NUMBERS_INVALID" };
  if (direction === "long" && !(sl < entry && tp > entry)) {
    return { ok:false, reason:"LONG_DIRECTION_PLAN_MISMATCH" };
  }
  if (direction === "short" && !(sl > entry && tp < entry)) {
    return { ok:false, reason:"SHORT_DIRECTION_PLAN_MISMATCH" };
  }
  return { ok:true, direction };
}

async function executeCandidate(runtime, candidate, wallet, openPositions, env) {
  const { sdk, signer, account } = runtime;

  const directionCheck = validateDirectionIntegrity(candidate);
  if (!directionCheck.ok) {
    return {
      executed: false,
      symbol: candidate?.symbol || "N/A",
      direction: candidate?.direction || null,
      entry: candidate?.entry || 0,
      tp: candidate?.tp || 0,
      sl: candidate?.sl || 0,
      score: num(candidate?.score), edge: num(candidate?.edge), risk: num(candidate?.risk),
      reason: directionCheck.reason,
      stage: "DIRECTION_GUARD"
    };
  }

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

  // Final pre-broadcast recheck. This is intentionally scoped to the
  // duplicate-position bug: if another scheduled runner/cycle opened a
  // position after the first portfolio snapshot, do not broadcast another one.
  try {
    const latestOpenPositions = await getOpenPositions(sdk, account);
    if (latestOpenPositions.length >= CONFIG.maxPositions) {
      return {
        executed: false, symbol: candidate.symbol, direction: candidate.direction,
        entry: candidate.entry, tp: candidate.tp, sl: candidate.sl,
        score: candidate.score, edge: candidate.edge, risk: candidate.risk,
        reason: "MAX_POSITIONS_RECHECK", stage: "PORTFOLIO"
      };
    }
    if (findPositionForCandidate(latestOpenPositions, candidate)) {
      return {
        executed: false, symbol: candidate.symbol, direction: candidate.direction,
        entry: candidate.entry, tp: candidate.tp, sl: candidate.sl,
        score: candidate.score, edge: candidate.edge, risk: candidate.risk,
        reason: "SYMBOL_ALREADY_OPEN_RECHECK", stage: "PORTFOLIO"
      };
    }
  } catch (error) {
    // Do not silently bypass the safety check if the position endpoint fails.
    return {
      executed: false, symbol: candidate.symbol, direction: candidate.direction,
      entry: candidate.entry, tp: candidate.tp, sl: candidate.sl,
      score: candidate.score, edge: candidate.edge, risk: candidate.risk,
      reason: `POSITION_RECHECK_FAILED:${safeError(error)}`, stage: "PORTFOLIO"
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
      directionVerified: true,
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
  const deepAttempted = Number(deep.attemptedCount || Math.min(CONFIG.deepCandidates, broad.rows.length));
  const deepFailureCount = Number(deep.failedCount || 0);
  const intelligence = await fetchOptionalIntelligence(env);
  const ranked = enrichWithIntelligence(deep, intelligence);

  const blocked = [];
  const actionable = [];
  const economicBlocked = [];
  for (const candidate of ranked) {
    const directionCheck = validateDirectionIntegrity(candidate);
    if (!directionCheck.ok) {
      blocked.push({
        symbol: candidate?.symbol || "N/A",
        direction: candidate?.direction || null,
        entry: candidate?.entry || 0,
        sl: candidate?.sl || 0,
        tp: candidate?.tp || 0,
        score: num(candidate?.score),
        edge: num(candidate?.edge),
        risk: num(candidate?.risk),
        setupType: candidate?.setupType || "NONE",
        reversalEvidence: num(candidate?.reversalEvidence),
        reason: directionCheck.reason,
        setupEvidence: candidate?.setupEvidence || {}
      });
      continue;
    }

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

  const impulseCount = ranked.filter((x) => x.setupType === "CONTINUATION" && x.continuationTrigger).length;
  const flowCount = ranked.filter((x) => num(x.setupEvidence?.volumeRatio1h) >= 1.25).length;
  const smartMoneyCount = ranked.filter((x) => num(x.setupEvidence?.volumeRatio1h) >= 1.50).length;
  const maCount = ranked.filter((x) => x.trendConfluence >= 3).length;
  const adxCount = ranked.filter((x) => num(x.indicators?.adx) >= 18).length;
  const layerReadyCount = ranked.filter((x) => x.setupEvidence?.directionAuthority === "1H_STRUCTURE" && x.triggerActive).length;
  const layerFlowCount = flowCount;
  const layerReversalCount = ranked.filter((x) => x.setupType === "REVERSAL" && x.reversalTrigger).length;
  const srCount = ranked.filter((x) => x.setupEvidence?.validExtreme > 0).length;
  const positiveMoveCount = ranked.filter((x) => x.direction && x.setupEvidence?.priorTrend && ((x.direction === "long" && num(x.setupEvidence.priorTrendMovePct) > 0) || (x.direction === "short" && num(x.setupEvidence.priorTrendMovePct) < 0))).length;
  const pullbackCount = ranked.filter((x) => x.setupType === "REVERSAL_WATCH").length;
  const scoreReadyCount = ranked.filter((x) => x.score >= CONFIG.minScore).length;
  const edgeReadyCount = ranked.filter((x) => x.edge >= CONFIG.minEdge).length;

  const report = {
    scanId,
    status: executions.length ? "EXECUTED" : actionable.length ? "ENTRY_READY" : "WATCHING",
    universe: universe.length,
    universeScanSuccess: broad.successful,
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
    rejectMove: blocked.filter(x => /TRAVELLED_TOO_FAR|CHASE/.test(String(x.reason))).length,
    rejectBody: blocked.filter(x => /SOLID_BODY|BODY/.test(String(x.reason))).length,
    rejectActivity: 0,
    rejectAccel: 0,
    rejectExt: 0,
    rejectZone: blocked.filter(x => /VALID_(HIGH|LOW)|EXTREME/.test(String(x.reason))).length,
    rejectPre: blocked.filter(x => /NO_CONFIRMED_1H_SETUP/.test(String(x.reason))).length,
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
    universeScan: report.universeScanSuccess,
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
