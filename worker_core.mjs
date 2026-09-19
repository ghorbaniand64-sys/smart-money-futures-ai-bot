/*
╔══════════════════════════════════════════════════════════════════════════════╗
║ GMX SMART MONEY FUTURES AI BOT — V22.9 PURE 1H STRUCTURE + DIRECTION LOCK + REPORT DEDUPE      ║
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

export const BOT_VERSION = "V24.0.0-GMX-COPY-TRADER-ENGINE";
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
  copyMaxLeverage: 20,
  copyMaxEntryDistancePct: 0.50,
  copyRecentDays: 30,
  copyTradeLimit: 100,
  copyTraderCount: 3,

  // V23: strict top-down authority: D1 -> H4 -> H1.
  // D1/H4 establish directional context; completed H1 supplies the entry trigger.
  signalTimeframe: "1h",
  signalLimit: 120,
  d1Timeframe: "1d",
  h4Timeframe: "4h",
  h1Timeframe: "1h",
  d1Limit: 120,
  h4Limit: 120,
  h1Limit: 120,
  deepCandidates: 117,
  finalCandidates: 1,
  marketScanConcurrency: 8,
  referenceAssets: ["BTC","ETH","SOL"],
  requireAllReferenceAssets: false,
  requireD1H4Agreement: false,
  requireH1SetupConfirmation: true,
  indicatorMinConfirmation: 4,

  // H1 structure rules.
  oneHLookbackTrend: 8,
  oneHLookbackStructure: 30,
  oneHMinTrendMovePct: 0.80,
  oneHReversalTouchPct: 0.35,
  oneHReversalMaxDistanceFromExtremePct: 1.80,
  oneHReversalMinBodyRatio: 0.35,
  oneHReversalMinEvidence: 3,
  oneHContinuationBreakBufferPct: 0.08,
  oneHContinuationMaxChasePct: 1.25,
  oneHContinuationMinBodyRatio: 0.60,
  oneHContinuationMinCloseLocation: 0.70,
  // Strong-break quality: body/close-location alone is insufficient.
  oneHContinuationMinRangeAtr: 1.05,
  oneHContinuationMinVolumeRatio: 1.15,
  oneHContinuationMinMove3Pct: 0.25,
  oneHContinuationMinAccelerationPct: 0.10,
  oneHContinuationMinQualityScore: 70,
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
    lastCycleReportFingerprint: null,
  });
  if (!Array.isArray(state.executionHistory)) state.executionHistory = [];
  if (!state.marketSnapshots || typeof state.marketSnapshots !== "object") state.marketSnapshots = {};
  if (typeof state.lastCycleReportFingerprint !== "string") state.lastCycleReportFingerprint = null;
  return state;
}

async function saveState(state) {
  state.version = BOT_VERSION;
  state.updatedAt = Date.now();
  state.executionHistory = state.executionHistory.slice(-100);
  await writeJsonFile(CONFIG.stateFile, state);
}

function cycleReportFingerprint(report) {
  const top = (Array.isArray(report?.topRejected) ? report.topRejected : []).slice(0, 3).map((x) => ({
    symbol: x?.symbol || "", direction: x?.direction || "", setupType: x?.setupType || "",
    entry: num(x?.entry), sl: num(x?.sl), tp: num(x?.tp), rr: num(x?.rr),
    score: num(x?.score), edge: num(x?.edge), risk: num(x?.risk), reason: String(x?.reason || ""),
    regime: x?.setupEvidence?.marketRegime?.regime || "", macroDirection: x?.setupEvidence?.marketRegime?.direction || "",
  }));
  return JSON.stringify({
    status: String(report?.status || ""), universe: num(report?.universe), deepCount: num(report?.deepCount),
    actionableCount: num(report?.actionableCount), executedCount: num(report?.executedCount), failureCount: num(report?.failureCount),
    marketRegime: report?.marketRegime?.regime || "", marketDirection: report?.marketRegime?.direction || "", topRejected: top,
  });
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
  const volumeRatio = num(last.volume)>0 && vAvg>0 ? num(last.volume)/vAvg : null;
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


function buildValidatedStructuralZones(candles, atrValue, lookback = 60) {
  const rows = Array.isArray(candles) ? candles.slice(-Math.max(25, lookback)) : [];
  if (rows.length < 10) return { resistance: [], support: [], tolerance: 0 };
  const price = num(rows.at(-1)?.close);
  const atrSafe = Math.max(num(atrValue), price * 0.001, 1e-12);
  const tolerance = Math.max(atrSafe * 0.35, price * 0.0025);
  const pivots = [];
  for (let i = 2; i < rows.length - 2; i++) {
    const c = rows[i];
    const hi = num(c.high), lo = num(c.low);
    const isHigh = hi >= num(rows[i-1].high) && hi >= num(rows[i-2].high) &&
      hi >= num(rows[i+1].high) && hi >= num(rows[i+2].high);
    const isLow = lo <= num(rows[i-1].low) && lo <= num(rows[i-2].low) &&
      lo <= num(rows[i+1].low) && lo <= num(rows[i+2].low);
    if (isHigh) pivots.push({ side:'R', price:hi, index:i, timestamp:c.timestamp });
    if (isLow) pivots.push({ side:'S', price:lo, index:i, timestamp:c.timestamp });
  }
  const makeZones = (side) => {
    const zones = [];
    for (const pivot of pivots.filter(x => x.side === side)) {
      let z = zones.find(x => Math.abs(x.center - pivot.price) <= tolerance);
      if (!z) {
        z = { center:pivot.price, pivots:[], touches:0, rejections:0, recency:0, strength:0 };
        zones.push(z);
      }
      z.pivots.push(pivot);
      z.center = z.pivots.reduce((a,b)=>a+b.price,0) / z.pivots.length;
    }
    for (const z of zones) {
      for (const p of z.pivots) {
        let touches = 0, rejections = 0;
        for (let j = Math.max(0,p.index-3); j < Math.min(rows.length,p.index+6); j++) {
          if (j === p.index) continue;
          const c = rows[j], range = Math.max(num(c.high)-num(c.low),1e-12);
          const distance = side === 'R' ? Math.abs(num(c.high)-z.center) : Math.abs(num(c.low)-z.center);
          if (distance <= tolerance) {
            touches++;
            const upper = (num(c.high)-Math.max(num(c.open),num(c.close)))/range;
            const lower = (Math.min(num(c.open),num(c.close))-num(c.low))/range;
            if (side === 'R' && (upper >= 0.20 || num(c.close) < num(c.open))) rejections++;
            if (side === 'S' && (lower >= 0.20 || num(c.close) > num(c.open))) rejections++;
          }
        }
        z.touches += touches;
        z.rejections += rejections;
        z.recency = Math.max(z.recency, p.index);
      }
      const age = rows.length - 1 - z.recency;
      const recencyScore = Math.max(0, 1 - age / Math.max(rows.length,1));
      // A level is valid when it has repeated interaction, or one pivot plus
      // a clear rejection. This avoids treating every wick as S/R while still
      // allowing a fresh, decisive swing to become structural.
      z.strength = Math.min(100, 35 + Math.min(35, z.pivots.length * 14) +
        Math.min(20, z.rejections * 5) + recencyScore * 10);
    }
    return zones.filter(z => z.pivots.length >= 2 || z.rejections >= 1)
      .sort((a,b)=>b.strength-a.strength || b.recency-a.recency);
  };
  return { resistance:makeZones('R'), support:makeZones('S'), tolerance };
}


function continuationBreakQuality(candles, triggerIndex, atrValue, direction) {
  const rows = Array.isArray(candles) ? candles : [];
  const i = Number(triggerIndex);
  const trigger = rows[i];
  if (!trigger || i < 6) return {
    available:false, qualityScore:0, rangeAtr:0, volumeRatio:1,
    move3:0, move5:0, acceleration:0, bodyRatio:0, closeLocation:0,
    rangeExpansion:0, checks:[]
  };

  const prior = rows.slice(Math.max(0, i - 8), i);
  const range = Math.max(num(trigger.high) - num(trigger.low), 1e-12);
  const atrSafe = Math.max(num(atrValue), num(trigger.close) * 0.001, 1e-12);
  const bodyRatio = Math.abs(num(trigger.close) - num(trigger.open)) / range;
  const closeLocation = (num(trigger.close) - num(trigger.low)) / range;
  const rangeAtr = range / atrSafe;
  const avgRange = prior.map(x => Math.max(num(x.high) - num(x.low), 1e-12))
    .reduce((a,b)=>a+b,0) / Math.max(1, prior.length);
  const rangeExpansion = range / Math.max(avgRange, 1e-12);

  const prevClose = num(rows[i-1]?.close);
  const c3 = num(rows[i-3]?.close);
  const c5 = num(rows[i-5]?.close);
  const move3 = prevClose > 0 && c3 > 0 ? pct(prevClose, c3) : 0;
  const move5 = prevClose > 0 && c5 > 0 ? pct(prevClose, c5) : 0;
  const prior3 = c3 > 0 && c5 > 0 ? pct(c3, c5) : 0;
  const acceleration = move3 - prior3;

  const priorVols = prior.map(x=>num(x.volume)).filter(x=>x>0);
  const avgVol = priorVols.reduce((a,b)=>a+b,0) / Math.max(1, priorVols.length);
  const volumeAvailable = num(trigger.volume) > 0 && avgVol > 0;
  const volumeRatio = volumeAvailable ? num(trigger.volume) / avgVol : 1;

  const bull = direction === 'long';
  const directionCandle = bull ? num(trigger.close) > num(trigger.open) : num(trigger.close) < num(trigger.open);
  const closeQuality = bull
    ? closeLocation >= CONFIG.oneHContinuationMinCloseLocation
    : closeLocation <= (1 - CONFIG.oneHContinuationMinCloseLocation);
  const bodyQuality = bodyRatio >= CONFIG.oneHContinuationMinBodyRatio;
  const rangeQuality = rangeAtr >= CONFIG.oneHContinuationMinRangeAtr;
  const expansionQuality = rangeExpansion >= 1.05;
  const moveQuality = bull ? move3 >= CONFIG.oneHContinuationMinMove3Pct : move3 <= -CONFIG.oneHContinuationMinMove3Pct;
  const accelerationQuality = bull ? acceleration >= CONFIG.oneHContinuationMinAccelerationPct : acceleration <= -CONFIG.oneHContinuationMinAccelerationPct;
  const volumeQuality = !volumeAvailable || volumeRatio >= CONFIG.oneHContinuationMinVolumeRatio;

  // Volume is optional because some GMX OHLCV feeds do not expose reliable
  // volume. When available, failure to expand volume costs quality points;
  // when unavailable it neither rewards nor blocks the setup.
  const checks = [
    ['directionCandle', directionCandle, 10],
    ['body', bodyQuality, 15],
    ['closeLocation', closeQuality, 15],
    ['rangeVsAtr', rangeQuality, 15],
    ['rangeExpansion', expansionQuality, 10],
    ['move3', moveQuality, 10],
    ['acceleration', accelerationQuality, 10],
    ['volume', volumeQuality, 15]
  ];
  let qualityScore = checks.reduce((sum, [,ok,weight]) => sum + (ok ? weight : 0), 0);
  if (!volumeAvailable) qualityScore -= 5;
  qualityScore = clamp(qualityScore, 0, 100);

  return {
    available:true, qualityScore:Number(qualityScore.toFixed(1)),
    rangeAtr:Number(rangeAtr.toFixed(2)), volumeRatio:Number(volumeRatio.toFixed(2)),
    volumeAvailable, move3:Number(move3.toFixed(3)), move5:Number(move5.toFixed(3)),
    acceleration:Number(acceleration.toFixed(3)), bodyRatio:Number(bodyRatio.toFixed(3)),
    closeLocation:Number(closeLocation.toFixed(3)), rangeExpansion:Number(rangeExpansion.toFixed(2)),
    checks:Object.fromEntries(checks.map(([name,ok])=>[name,ok]))
  };
}

function oneHStructureSignal(candles1h, ticker) {
  const c = completedOneHCandles(candles1h);
  if (c.length < 40) return {
    valid: false, reason: `INSUFFICIENT_COMPLETED_1H:${c.length}`,
    direction: null, setupType: "NONE", entry: num(c.at(-1)?.close) || tickerPrice(ticker) || 0
  };

  const last = c.at(-1), confirm = c.at(-2), trigger = c.at(-3), prev = c.at(-4);
  const price = num(last.close) || tickerPrice(ticker);
  const atr1h = Math.max(atr(c, 14), price * 0.001, 1e-12);
  const closes = c.map(x => num(x.close));
  const e20 = ema(closes, 20), e50 = ema(closes, 50), e200 = ema(closes, 200);
  const r = rsi(closes, 14), m = macd(closes), d = adx(c, 14), st = stochastic(c), bb = bollingerBands(closes);

  // Only confirmed pivots are structural levels. Raw rolling highs/lows are
  // deliberately excluded from entry authority because a single wick is not
  // a "valid resistance/support" by itself.
  // Structural zones are validated by repeated pivots/interactions and
  // rejection quality. They are kept independent of current price so a level
  // that was just broken remains available as the breakout/retest reference.
  const zoneBook = buildValidatedStructuralZones(c.slice(0, -2), atr1h, Math.min(CONFIG.oneHLookbackStructure, c.length - 2));
  const tolerance = zoneBook.tolerance;
  const confirmedHighs = zoneBook.resistance || [];
  const confirmedLows = zoneBook.support || [];
  const resistances = confirmedHighs.map(x=>num(x.center)).filter(x => x > price).sort((a,b)=>a-b);
  const supports = confirmedLows.map(x=>num(x.center)).filter(x => x < price).sort((a,b)=>b-a);
  const resistance = resistances[0] || 0;
  const support = supports[0] || 0;

  const prior = c.slice(-Math.max(12, Number(CONFIG.oneHLookbackTrend) || 8) - 3, -3);
  const priorHigh = prior.length ? Math.max(...prior.map(x => num(x.high))) : 0;
  const priorLow = prior.length ? Math.min(...prior.map(x => num(x.low))) : 0;
  const trendRows = c.slice(-Math.max(9, Number(CONFIG.oneHLookbackTrend) || 8) - 1, -1);
  const trendStart = num(trendRows[0]?.close);
  const trendMove = trendStart > 0 ? pct(confirm.close, trendStart) : 0;
  const priorUp = trendMove >= CONFIG.oneHMinTrendMovePct && confirm.close > e20 && e20 >= e50;
  const priorDown = trendMove <= -CONFIG.oneHMinTrendMovePct && confirm.close < e20 && e20 <= e50;

  const candleStats = (x) => {
    const range = Math.max(num(x?.high) - num(x?.low), 1e-12);
    const body = Math.abs(num(x?.close) - num(x?.open));
    return {
      range, bodyRatio: body / range,
      closeLocation: (num(x?.close) - num(x?.low)) / range,
      upperWickRatio: (num(x?.high) - Math.max(num(x?.open), num(x?.close))) / range,
      lowerWickRatio: (Math.min(num(x?.open), num(x?.close)) - num(x?.low)) / range
    };
  };
  const ts = candleStats(trigger), cs = candleStats(confirm), ls = candleStats(last);

  // --------------------------- REVERSAL ----------------------------------
  // A reversal is a two-step event: the trigger candle rejects a confirmed
  // level, then the next completed candle confirms/stabilizes the rejection.
  // A mere touch or one-candle wick is never enough.
  const nearbyResistance = confirmedHighs
    .map(z=>num(z.center)).filter(x=>x>0 && Math.abs(num(trigger.high)-x)<=Math.max(tolerance, atr1h*0.75))
    .sort((a,b)=>Math.abs(num(trigger.high)-a)-Math.abs(num(trigger.high)-b))[0] || resistance;
  const nearbySupport = confirmedLows
    .map(z=>num(z.center)).filter(x=>x>0 && Math.abs(num(trigger.low)-x)<=Math.max(tolerance, atr1h*0.75))
    .sort((a,b)=>Math.abs(num(trigger.low)-a)-Math.abs(num(trigger.low)-b))[0] || support;
  const resistanceForReaction = nearbyResistance;
  const supportForReaction = nearbySupport;
  const resistanceTouched = resistanceForReaction > 0 && trigger.high >= resistanceForReaction - tolerance;
  const supportTouched = supportForReaction > 0 && trigger.low <= supportForReaction + tolerance;
  const bearishReject = trigger.close < trigger.open &&
    (ts.upperWickRatio >= 0.20 || ts.bodyRatio >= CONFIG.oneHReversalMinBodyRatio) &&
    trigger.close < resistanceForReaction;
  const bullishReject = trigger.close > trigger.open &&
    (ts.lowerWickRatio >= 0.20 || ts.bodyRatio >= CONFIG.oneHReversalMinBodyRatio) &&
    trigger.close > supportForReaction;
  const shortStable = resistanceTouched && bearishReject &&
    confirm.close < resistanceForReaction && confirm.close <= trigger.close &&
    confirm.high <= resistanceForReaction + tolerance;
  const longStable = supportTouched && bullishReject &&
    confirm.close > supportForReaction && confirm.close >= trigger.close &&
    confirm.low >= supportForReaction - tolerance;
  const shortDistance = resistanceForReaction > 0 ? Math.abs(pct(last.close, resistanceForReaction)) : 999;
  const longDistance = supportForReaction > 0 ? Math.abs(pct(last.close, supportForReaction)) : 999;
  const shortReversalEvidence = [priorUp, resistanceTouched, bearishReject, shortStable].filter(Boolean).length;
  const longReversalEvidence = [priorDown, supportTouched, bullishReject, longStable].filter(Boolean).length;
  const shortReversal = priorUp && resistanceTouched && bearishReject && shortStable &&
    shortDistance <= CONFIG.oneHReversalMaxDistanceFromExtremePct;
  const longReversal = priorDown && supportTouched && bullishReject && longStable &&
    longDistance <= CONFIG.oneHReversalMaxDistanceFromExtremePct;

  // ------------------------- CONTINUATION --------------------------------
  // Continuation is deliberately a two-candle breakout, not an entry on the
  // breakout candle itself. The trigger must break a confirmed level with a
  // strong body; the following candle must hold/accept above/below that level.
  const breakoutCandidates = confirmedHighs.map(z=>num(z.center)).filter(x=>x>0 && x < num(trigger.close) &&
    num(trigger.high) >= x - tolerance && Math.abs(pct(num(trigger.close),x)) <= 3.5)
    .sort((a,b)=>Math.abs(num(trigger.close)-a)-Math.abs(num(trigger.close)-b));
  const breakdownCandidates = confirmedLows.map(z=>num(z.center)).filter(x=>x>0 && x > num(trigger.close) &&
    num(trigger.low) <= x + tolerance && Math.abs(pct(num(trigger.close),x)) <= 3.5)
    .sort((a,b)=>Math.abs(num(trigger.close)-a)-Math.abs(num(trigger.close)-b));
  const breakoutLevel = breakoutCandidates[0] || 0;
  const breakdownLevel = breakdownCandidates[0] || 0;
  const bullBreakQuality = continuationBreakQuality(c, c.length - 3, atr1h, "long");
  const bearBreakQuality = continuationBreakQuality(c, c.length - 3, atr1h, "short");
  const strongBullBreak = breakoutLevel > 0 &&
    trigger.close > breakoutLevel * (1 + CONFIG.oneHContinuationBreakBufferPct / 100) &&
    bullBreakQuality.qualityScore >= CONFIG.oneHContinuationMinQualityScore;
  const strongBearBreak = breakdownLevel > 0 &&
    trigger.close < breakdownLevel * (1 - CONFIG.oneHContinuationBreakBufferPct / 100) &&
    bearBreakQuality.qualityScore >= CONFIG.oneHContinuationMinQualityScore;
  const longAccepted = strongBullBreak && confirm.close > breakoutLevel &&
    confirm.low >= breakoutLevel - atr1h * CONFIG.continuationRetestAtr &&
    confirm.close >= trigger.close - atr1h * 0.35;
  const shortAccepted = strongBearBreak && confirm.close < breakdownLevel &&
    confirm.high <= breakdownLevel + atr1h * CONFIG.continuationRetestAtr &&
    confirm.close <= trigger.close + atr1h * 0.35;
  const longChase = breakoutLevel > 0 ? Math.abs(pct(last.close, breakoutLevel)) > CONFIG.oneHContinuationMaxChasePct : true;
  const shortChase = breakdownLevel > 0 ? Math.abs(pct(last.close, breakdownLevel)) > CONFIG.oneHContinuationMaxChasePct : true;
  const longContinuation = longAccepted && !longChase;
  const shortContinuation = shortAccepted && !shortChase;

  const directionConflict =
    (shortReversal && (longReversal || longContinuation)) ||
    (longReversal && (shortReversal || shortContinuation)) ||
    (longContinuation && shortContinuation);
  if (directionConflict) return { valid:false, reason:"1H_DIRECTION_CONFLICT_NO_TRADE", direction:null, setupType:"NONE" };

  let direction = null, setupType = "NONE", confidence = 0, extreme = 0, structureLevel = 0;
  let reversalEvidence = 0, reasons = [];
  if (shortReversal) {
    direction = "short"; setupType = "REVERSAL"; confidence = 90;
    extreme = resistanceForReaction; structureLevel = resistanceForReaction; reversalEvidence = shortReversalEvidence;
    reasons = ["1H_PRIOR_UPMOVE","1H_VALID_RESISTANCE","1H_BEARISH_REJECTION","1H_REJECTION_STABILIZED"];
  } else if (longReversal) {
    direction = "long"; setupType = "REVERSAL"; confidence = 90;
    extreme = supportForReaction; structureLevel = supportForReaction; reversalEvidence = longReversalEvidence;
    reasons = ["1H_PRIOR_DOWNMOVE","1H_VALID_SUPPORT","1H_BULLISH_REJECTION","1H_REJECTION_STABILIZED"];
  } else if (longContinuation) {
    direction = "long"; setupType = "CONTINUATION"; confidence = 92;
    extreme = breakoutLevel; structureLevel = breakoutLevel;
    reasons = ["1H_STRONG_RESISTANCE_BREAK","1H_BREAKOUT_CANDLE","1H_BREAKOUT_ACCEPTED"];
  } else if (shortContinuation) {
    direction = "short"; setupType = "CONTINUATION"; confidence = 92;
    extreme = breakdownLevel; structureLevel = breakdownLevel;
    reasons = ["1H_STRONG_SUPPORT_BREAK","1H_BREAKDOWN_CANDLE","1H_BREAKDOWN_ACCEPTED"];
  } else {
    return {
      valid:false, reason:"NO_CONFIRMED_1H_SETUP", direction:null, setupType:"1H_WATCH", confidence:0,
      entry:price,
      diagnostics:{ price,resistance,support,priorUp,priorDown,trendMove,strongBullBreak,strongBearBreak,
        bullBreakQuality,bearBreakQuality,
        longAccepted,shortAccepted,longChase,shortChase,shortReversal,longReversal,
        bodyRatio:ls.bodyRatio,closeLocation:ls.closeLocation,validatedResistance:resistanceForReaction,validatedSupport:supportForReaction,
        structuralResistanceCount:confirmedHighs.length,structuralSupportCount:confirmedLows.length }
    };
  }

  // -------------------------- PLAN ---------------------------------------
  // Continuation stops are structural: below the next valid support for LONG
  // and above the next valid resistance for SHORT. Reversal stops sit beyond
  // the rejection level. No synthetic TP is allowed merely to manufacture RR.
  const buffer = Math.max(atr1h * 0.18, price * 0.0010);
  let sl = 0, tp = 0, targetLevel = 0, targetType = "";
  const futureRes = confirmedHighs.map(x=>num(x.center)).filter(x=>x > price + tolerance).sort((a,b)=>a-b);
  const futureSup = confirmedLows.map(x=>num(x.center)).filter(x=>x < price - tolerance).sort((a,b)=>b-a);

  if (direction === "long") {
    if (setupType === "REVERSAL") {
      sl = supportForReaction - buffer;
      targetLevel = futureRes[0] || 0;
      targetType = "NEXT_RESISTANCE_AFTER_SUPPORT_REVERSAL";
    } else {
      const structuralSupport = futureSup[0] || 0;
      if (!(structuralSupport > 0 && structuralSupport < price)) return { valid:false, reason:"1H_LONG_CONTINUATION_NO_VALID_SUPPORT", direction, setupType };
      sl = structuralSupport - buffer;
      targetLevel = futureRes[0] || 0;
      targetType = "NEXT_RESISTANCE_AFTER_BREAKOUT";
    }
    if (!(targetLevel > price)) return { valid:false, reason:"1H_LONG_NO_VALID_TARGET", direction, setupType };
    tp = targetLevel - Math.max(price * CONFIG.oneHTargetBufferPct / 100, atr1h * CONFIG.oneHTargetBufferAtr);
  } else {
    if (setupType === "REVERSAL") {
      sl = resistanceForReaction + buffer;
      targetLevel = futureSup[0] || 0;
      targetType = "NEXT_SUPPORT_AFTER_RESISTANCE_REVERSAL";
    } else {
      const structuralResistance = futureRes[0] || 0;
      if (!(structuralResistance > price)) return { valid:false, reason:"1H_SHORT_CONTINUATION_NO_VALID_RESISTANCE", direction, setupType };
      sl = structuralResistance + buffer;
      targetLevel = futureSup[0] || 0;
      targetType = "NEXT_SUPPORT_AFTER_BREAKDOWN";
    }
    if (!(targetLevel > 0 && targetLevel < price)) return { valid:false, reason:"1H_SHORT_NO_VALID_TARGET", direction, setupType };
    tp = targetLevel + Math.max(price * CONFIG.oneHTargetBufferPct / 100, atr1h * CONFIG.oneHTargetBufferAtr);
  }

  const slDistance = Math.abs(price - sl), tpDistance = Math.abs(tp - price);
  const rr = slDistance > 0 ? tpDistance / slDistance : 0;
  const sideValid = direction === "long" ? sl < price && tp > price : sl > price && tp < price;
  if (!sideValid) return { valid:false, reason:"1H_PLAN_WRONG_SIDE", direction, setupType, entry:price, sl,tp,rr };
  if (rr < CONFIG.oneHMinRR) return { valid:false, reason:`RR_${rr.toFixed(2)}_BELOW_${CONFIG.oneHMinRR.toFixed(2)}`, direction,setupType,entry:price,sl,tp,rr };

  // The entry must still be close to the actual trigger zone. This is applied
  // to both setup types, but reversal uses the rejection level and continuation
  // uses the accepted breakout level.
  const entryDistance = Math.abs(pct(price, structureLevel));
  const maxEntryDistance = setupType === "CONTINUATION"
    ? CONFIG.oneHContinuationMaxChasePct : CONFIG.oneHReversalMaxDistanceFromExtremePct;
  if (entryDistance > maxEntryDistance) return { valid:false, reason:"ENTRY_TOO_FAR_FROM_TRIGGER_ZONE", direction,setupType,entry:price,sl,tp,rr };

  const volumeRows = c.filter(x => num(x.volume) > 0);
  const volAvg = volumeRows.slice(-21,-1).reduce((a,x)=>a+num(x.volume),0) / Math.max(1,volumeRows.slice(-21,-1).length);
  const volumeRatio1h = num(trigger.volume) > 0 && volAvg > 0 ? num(trigger.volume) / volAvg : 0;
  const score = clamp(76 + confidence * 0.12 + (d >= 18 ? 5 : 0) + (rr >= 2 ? 6 : 0) + (volumeRatio1h >= CONFIG.volumeExpansionMinRatio ? 4 : 0),0,100);
  const edge = clamp(20 + confidence * 0.55 + Math.min(20,rr * 5) + (setupType === "REVERSAL" ? reversalEvidence * 5 : 12),0,100);
  const risk = clamp(Math.abs(pct(sl, price)) * 20,0,100);
  const fiveLayers = {
    enabled:true, direction, authority:"1H_STRUCTURE_CONFIRMED",
    confidence:Number(confidence.toFixed(1)), edge:Number(edge.toFixed(1)),
    long:direction === "long" ? confidence : 50, short:direction === "short" ? confidence : 50,
    trend:{long:Number((last.close > e20 && e20 >= e50 ? 80 : 45).toFixed(1)),short:Number((last.close < e20 && e20 <= e50 ? 80 : 45).toFixed(1)),direction:last.close >= e20 ? "long":"short"},
    location:{long:longReversal ? 78 : 50, short:shortReversal ? 78 : 50},
    momentum:{long:Number(clamp(50+(m.histogram>0?18:-8)+(r<40?10:0),0,100).toFixed(1)),short:Number(clamp(50+(m.histogram<0?18:-8)+(r>60?10:0),0,100).toFixed(1))},
    flow:{long:volumeRatio1h>=CONFIG.volumeExpansionMinRatio&&trigger.close>trigger.open?72:50,short:volumeRatio1h>=CONFIG.volumeExpansionMinRatio&&trigger.close<trigger.open?72:50},
    reversal:{long:longReversal?confidence:50,short:shortReversal?confidence:50}
  };

  return {
    valid:true, symbol:null, direction, directionAuthority:"1H_STRUCTURE", setupType,
    entry:price, sl:Number(sl.toPrecision(12)), tp:Number(tp.toPrecision(12)), rr:Number(rr.toFixed(2)),
    score:Number(score.toFixed(2)), edge:Number(edge.toFixed(2)), risk:Number(risk.toFixed(2)),
    trendConfluence:direction === "long" ? Number(last.close>e20)+Number(e20>=e50)+Number(m.histogram>0) : Number(last.close<e20)+Number(e20<=e50)+Number(m.histogram<0),
    reversalEvidence, setupConfidence:confidence, reversalConfidence:setupType === "REVERSAL" ? confidence:0,
    continuationConfidence:setupType === "CONTINUATION" ? confidence:0,
    setupDominance:setupType === "REVERSAL" ? 20:15, triggerActive:true,
    reversalTrigger:setupType === "REVERSAL", continuationTrigger:setupType === "CONTINUATION",
    tpPlan:{tp:Number(tp.toPrecision(12)),method:"PURE_1H_VALID_STRUCTURE",targetType,targetScore:80,probabilityProxy:80,distancePct:Number(Math.abs(pct(tp,price)).toFixed(3)),rr:Number(rr.toFixed(2)),rrPass:true,targetPrice:targetLevel,atrDistance:Number(tpDistance/atr1h).toFixed(2)},
    setupEvidence:{setupType,directionAuthority:"1H_STRUCTURE",directionLocked:true,signalTimeframe:"1H",
      signalCandle:last.timestamp, triggerCandle:trigger.timestamp, confirmationCandle:confirm.timestamp,
      priorTrend:priorUp?"UP":priorDown?"DOWN":"NEUTRAL", priorTrendMovePct:Number(trendMove.toFixed(3)),
      validExtreme:extreme, structureLevel, support, resistance, reversalTouch:setupType === "REVERSAL",
      reversalStabilized:setupType === "REVERSAL", continuationBreak:setupType === "CONTINUATION",
      continuationAccepted:setupType === "CONTINUATION", continuationChasePct:entryDistance,
      continuationTriggerLevel:setupType === "CONTINUATION" ? structureLevel:0,
      reasons, bodyRatio:Number(ts.bodyRatio.toFixed(3)),closeLocation:Number(ts.closeLocation.toFixed(3)),
      volumeRatio1h:Number(volumeRatio1h.toFixed(2)),
      breakQuality:setupType === "CONTINUATION" ? (direction === "long" ? bullBreakQuality : bearBreakQuality) : null,
      marketRegime:null,
      slMethod:setupType === "REVERSAL" ? "1H_REJECTION_LEVEL_BUFFER" : "1H_NEXT_STRUCTURAL_SUPPORT_RESISTANCE",
      tpMethod:targetType
    },
    indicators:{rsi:r,macd:m,adx:d,stochastic:st,bollinger:bb,ichimoku:ichimoku(c)},
    fiveLayers
  };
}


function scoreCandidate({ market, ticker, candles1h, candles4h, candles1d, marketRegime }) {
  const symbol = marketDisplaySymbol(market);
  const h1 = completedCandles(candles1h, "1h");
  const h4 = completedCandles(candles4h, "4h");
  const d1 = completedCandles(candles1d, "1d");
  if (d1.length < 60 || h4.length < 60 || h1.length < 30) {
    return { symbol, direction:null, setupType:"NONE", score:0, edge:0, risk:100, error:"INSUFFICIENT_MTF_DATA" };
  }

  const d1c = timeframeTrendConfirmation(d1, "1d");
  const h4c = timeframeTrendConfirmation(h4, "4h");
  const h1c = timeframeTrendConfirmation(h1, "1h");
  const base = oneHStructureSignal(h1, ticker);
  const price = num(base.entry) || num(h1.at(-1)?.close) || tickerPrice(ticker) || 0;

  // BTC/ETH/SOL are soft context only; they never block the H1 scan.

  if (!base.valid) {
    const directionBias =
      (base.diagnostics?.priorUp ? "long" :
       base.diagnostics?.priorDown ? "short" :
       h1c.direction && h1c.direction !== "neutral" ? h1c.direction : null);
    return {
      symbol, candleSymbol:candleSymbolFromMarket(market),
      direction:null, directionBias,
      setupType:base.setupType||"1H_WATCH", state:"WATCH",
      score:0, edge:0, risk:100, entry:price, sl:0,tp:0,rr:0,
      triggerActive:false, reversalTrigger:false, continuationTrigger:false,
      reversalEvidence:num(base.reversalEvidence),
      setupConfidence:num(base.confidence),
      setupEvidence:{
        ...(base.diagnostics||{}), reason:base.reason,
        signalTimeframe:"1H", directionAuthority:"1H_STRUCTURE",
        directionLocked:false, directionBias,
        d1Confirmation:d1c,h4Confirmation:h4c,h1Confirmation:h1c,
        macroIsSoft:true, contextIsSoft:true
      },
      indicators:{d1:d1c,h4:h4c,h1:h1c}
    };
  }

  const dir = base.direction;
  const macroDir = marketRegime?.direction || "neutral";

  // D1/H4 are quality context, not gates.
  const contextLong = Number(d1c.direction === "long") + Number(h4c.direction === "long");
  const contextShort = Number(d1c.direction === "short") + Number(h4c.direction === "short");
  const contextAligned = dir === "long" ? contextLong : contextShort;
  const contextQualityModifier = Number(clamp((contextAligned - 1) * 3, -3, 3).toFixed(2));

  // BTC/ETH/SOL are a small macro quality modifier only.
  const refAssets = Object.values(marketRegime?.assets || {}).filter(x => x?.available);
  const refAligned = refAssets.filter(x => x.direction === dir).length;
  const refOpposed = refAssets.filter(x => x.direction && x.direction !== "neutral" && x.direction !== dir).length;
  const macroQualityModifier =
    refAssets.length === 0 ? 0 :
    refAligned === refAssets.length ? 4 :
    refOpposed === refAssets.length ? -4 :
    refAligned > refOpposed ? 2 :
    refOpposed > refAligned ? -2 : 0;

  const d1Ichi = d1c.ichimoku, h4Ichi = h4c.ichimoku;
  const trendOK = dir === "long"
    ? d1c.e20 > d1c.e50 && h4c.e20 > h4c.e50
    : d1c.e20 < d1c.e50 && h4c.e20 < h4c.e50;
  const macdOK = dir === "long"
    ? d1c.macdHistogram > 0 && h4c.macdHistogram > 0
    : d1c.macdHistogram < 0 && h4c.macdHistogram < 0;
  const adxOK = d1c.adx >= 18 && h4c.adx >= 18;
  const ichimokuOK = dir === "long"
    ? Boolean(d1Ichi?.bullish && h4Ichi?.bullish)
    : Boolean(d1Ichi?.bearish && h4Ichi?.bearish);
  const rsiOK = dir === "long"
    ? d1c.rsi >= 50 && h4c.rsi >= 50 && d1c.rsi < 75 && h4c.rsi < 75
    : d1c.rsi <= 50 && h4c.rsi <= 50 && d1c.rsi > 25 && h4c.rsi > 25;
  const indicatorVotes = [trendOK,macdOK,adxOK,ichimokuOK,rsiOK].filter(Boolean).length;

  const h1TrendSide = h1c.direction === dir;
  const h1MomentumSide = dir === "long" ? h1c.macdHistogram > 0 : h1c.macdHistogram < 0;
  const h1Strength = h1c.adx >= 18;
  const h1Rsi = dir === "long" ? h1c.rsi >= 45 && h1c.rsi < 78 : h1c.rsi <= 55 && h1c.rsi > 22;
  const h1Ichi = dir === "long" ? h1c.ichimoku?.bullish : h1c.ichimoku?.bearish;
  const h1Votes = [h1TrendSide,h1MomentumSide,h1Strength,h1Rsi,Boolean(h1Ichi)].filter(Boolean).length;
  // Reversals are allowed to have H1 Ichimoku/momentum conflict immediately
  // after the rejection; the actual H1 structure trigger remains mandatory.
  const minH1Votes = base.setupType === "REVERSAL" ? 3 : 4;
  if (h1Votes < minH1Votes) {
    return { ...base, symbol, score:0,edge:0,risk:100,triggerActive:false,error:`H1_CONFIRMATION_${h1Votes}_OF_5`,
      setupEvidence:{...(base.setupEvidence||{}),d1Confirmation:d1c,h4Confirmation:h4c,h1Confirmation:h1c,
        indicatorVotes,h1Votes,directionAuthority:"1H_STRUCTURE",directionLocked:false} };
  }

  const final = { ...base, symbol, candleSymbol:candleSymbolFromMarket(market), market,ticker,candles1h:h1,
    score:Number(clamp(base.score + indicatorVotes*2 + h1Votes*2,0,100).toFixed(2)),
    edge:Number(clamp(base.edge + indicatorVotes*2 + h1Votes*2,0,100).toFixed(2)),
    trendConfluence:indicatorVotes + h1Votes,
    directionAuthority:"1H_STRUCTURE",
    setupEvidence:{
      ...(base.setupEvidence||{}),
      signalTimeframe:"1H", directionAuthority:"1H_STRUCTURE", directionLocked:true,
      d1Confirmation:d1c,h4Confirmation:h4c,h1Confirmation:h1c,
      indicatorVotes,h1Votes,trendOK,macdOK,adxOK,ichimokuOK,rsiOK,
      marketRegime, counterTrend,
      legacy5mDisabled:true,legacy15mDisabled:true
    },
    indicators:{...(base.indicators||{}),d1:d1c,h4:h4c,h1:h1c,indicatorVotes,h1Votes,
      ichimokuD1:d1Ichi,ichimokuH4:h4Ichi,ichimokuH1:h1c.ichimoku,
      directionAuthority:"1H_STRUCTURE"} };
  return applyMarketRegimeToCandidate(final, marketRegime);
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
    return { ok: false, reason: "DIRECTION_AUTHORITY_NOT_MTF" };
  }
  if (candidate.setupEvidence?.signalTimeframe !== "1H" ||
       !candidate.setupEvidence?.d1Confirmation?.available || !candidate.setupEvidence?.h4Confirmation?.available || !candidate.setupEvidence?.h1Confirmation?.available) {
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

  // BTC/ETH/SOL macro regime is informational only; never block an H1 trade.

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
  if (!["1d","4h","1h"].includes(tf)) throw new Error(`UNSUPPORTED_TIMEFRAME:${tf}`);
  return fetchCandles(sdk, marketOrSymbol, tf, limit);
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


function completedCandles(candles, timeframe = "1h") {
  const rows = Array.isArray(candles) ? candles.filter(c =>
    num(c?.open) > 0 && num(c?.high) > 0 && num(c?.low) > 0 && num(c?.close) > 0
  ).sort((a,b) => num(a.timestamp) - num(b.timestamp)) : [];
  if (rows.length < 3) return rows;

  const ms = timeframe === "1d" ? 86400000 : timeframe === "4h" ? 14400000 : 3600000;
  const tsMs = num(rows.at(-1)?.timestamp) * 1000;
  if (!Number.isFinite(tsMs) || tsMs <= 0) return rows;
  const now = Date.now();
  const bucketStart = Math.floor(now / ms) * ms;
  return tsMs >= bucketStart && tsMs < now + 60000 ? rows.slice(0, -1) : rows;
}

function timeframeTrendConfirmation(candles, timeframe) {
  const rows = completedCandles(candles, timeframe);
  if (rows.length < 60) return { available:false, direction:"neutral", score:50, confidence:0, confirmations:0, timeframe };
  const closes = rows.map(x => num(x.close));
  const price = closes.at(-1);
  const e20 = ema(closes,20), e50 = ema(closes,50), e200 = ema(closes,200);
  const m = macd(closes), ad = adx(rows,14), r = rsi(closes,14);
  const ichi = ichimoku(rows);
  const fib = fibonacciLevels(rows, Math.min(72, rows.length));
  const ret = pct(price, closes.at(-Math.min(21, closes.length)) || price);

  let long = 0, short = 0;
  const add = (condition, side, weight=1) => { if (condition) side === "long" ? long += weight : short += weight; };
  add(price > e20 && e20 > e50, "long", 2);
  add(price < e20 && e20 < e50, "short", 2);
  add(e50 > e200, "long");
  add(e50 < e200, "short");
  add(m.histogram > 0, "long");
  add(m.histogram < 0, "short");
  add(r >= 52 && r < 72, "long");
  add(r <= 48 && r > 28, "short");
  add(ad >= 18 && price > e20, "long");
  add(ad >= 18 && price < e20, "short");
  if (ichi.available) {
    add(ichi.bullish, "long", 2);
    add(ichi.bearish, "short", 2);
    // Being inside the cloud is explicitly non-directional.
    if (ichi.inCloud) { long -= 1; short -= 1; }
  }
  add(ret > 0.50, "long");
  add(ret < -0.50, "short");

  const confirmations = Math.max(long, short);
  const direction = long >= short + 2 ? "long" : short >= long + 2 ? "short" : "neutral";
  const raw = 50 + (long - short) * 5;
  return {
    available:true, timeframe, direction, score:Number(clamp(raw,0,100).toFixed(1)),
    confidence:Number(Math.abs(long-short)*5), confirmations,
    long:Number(long.toFixed(1)), short:Number(short.toFixed(1)),
    price,e20,e50,e200,rsi:r,adx:ad,macdHistogram:m.histogram,ichimoku:ichi,
    fibonacci:fib, returnPct:Number(ret.toFixed(3))
  };
}

async function buildMarketRegimeDataCenter(sdk, markets, _broadRows = []) {
  if (!CONFIG.marketRegimeEnabled) {
    return { enabled:false, regime:"NEUTRAL", direction:"neutral", score:50, confidence:0, assets:{}, agreement:0 };
  }
  const refs = {};
  for (const asset of CONFIG.referenceAssets) refs[asset] = findReferenceMarket(markets, asset);

  async function analyzeAsset(asset) {
    const market = refs[asset];
    if (!market) return { asset, available:false, reason:"REFERENCE_MARKET_NOT_FOUND", frames:{} };
    const frames = {};
    for (const tf of ["1d","4h","1h"]) {
      try {
        const candles = await fetchCandlesResilient(sdk, market, tf, tf === "1d" ? CONFIG.d1Limit : tf === "4h" ? CONFIG.h4Limit : CONFIG.h1Limit);
        frames[tf] = timeframeTrendConfirmation(candles, tf);
      } catch (e) {
        frames[tf] = { available:false, direction:"neutral", score:50, confidence:0, timeframe:tf, reason:safeError(e) };
      }
    }
    const available = ["1d","4h","1h"].every(tf => frames[tf]?.available);
    const dirs = ["1d","4h","1h"].map(tf => frames[tf]?.direction);
    const bullishFrames = dirs.filter(d => d === "long").length;
    const bearishFrames = dirs.filter(d => d === "short").length;
    const direction = bullishFrames === 3 ? "long" : bearishFrames === 3 ? "short" : "neutral";
    return { asset, available, direction, frames, bullishFrames, bearishFrames };
  }

  const assets = {};
  for (const asset of CONFIG.referenceAssets) assets[asset] = await analyzeAsset(asset);

  const usable = Object.values(assets).filter(x => x.available);

  const assetDirs = usable.map(x => x.direction);
  const longs = assetDirs.filter(x => x === "long").length;
  const shorts = assetDirs.filter(x => x === "short").length;
  let direction = longs === 3 ? "long" : shorts === 3 ? "short" : "neutral";
  if (direction === "neutral") {
    return { enabled:true, regime:"MIXED", direction:"neutral", score:50, confidence:0, assets,
      agreement:Number((Math.max(longs,shorts)/3*100).toFixed(1)), reason:"BTC_ETH_SOL_NOT_UNANIMOUS" };
  }

  const selected = usable.map(x => x.frames);
  const scores = selected.map(fr => fr["1d"].score * 0.45 + fr["4h"].score * 0.35 + fr["1h"].score * 0.20);
  const score = Number((scores.reduce((a,b)=>a+b,0)/scores.length).toFixed(1));
  const agreement = 100;
  return {
    enabled:true,
    regime: direction === "long" ? (score >= 72 ? "BULLISH_STRONG" : "BULLISH") : (score <= 28 ? "BEARISH_STRONG" : "BEARISH"),
    direction, score, confidence:Number(Math.abs(score-50).toFixed(1)), assets, agreement,
    btc:assets.BTC, eth:assets.ETH, sol:assets.SOL, timeframe:"D1/H4/H1",
    supportReliability:1, resistanceReliability:1, timestamp:Date.now()
  };
}

function applyMarketRegimeToCandidate(candidate, marketRegime) {
  if (!candidate || !marketRegime?.enabled) return candidate;
  const ev = { ...(candidate.setupEvidence || {}) };
  const macroDir = marketRegime.direction;
  const dir = candidate.direction;
  const counterTrend = macroDir !== "neutral" && dir !== macroDir;
  ev.marketRegime = {
    regime: marketRegime.regime, direction: macroDir, score: marketRegime.score,
    confidence: marketRegime.confidence, agreement: marketRegime.agreement,
    btcDirection: marketRegime.btc?.direction ?? marketRegime.assets?.BTC?.direction ?? "neutral",
    ethDirection: marketRegime.eth?.direction ?? marketRegime.assets?.ETH?.direction ?? "neutral",
    solDirection: marketRegime.sol?.direction ?? marketRegime.assets?.SOL?.direction ?? "neutral",
    counterTrend, aligned: !counterTrend && macroDir !== "neutral"
  };
  ev.marketRegimeTag = `${marketRegime.regime}_${dir.toUpperCase()}${counterTrend ? "_COUNTER" : "_ALIGNED"}`;
  return { ...candidate, setupEvidence:ev, indicators:{...(candidate.indicators||{}), marketRegime:ev.marketRegime} };
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
  const results = await mapLimit(selected, Math.min(8, CONFIG.marketScanConcurrency), async (row) => {
    try {
      const [d1, h4, h1] = await Promise.all([
        fetchCandlesResilient(sdk, row.market, "1d", CONFIG.d1Limit),
        fetchCandlesResilient(sdk, row.market, "4h", CONFIG.h4Limit),
        fetchCandlesResilient(sdk, row.market, "1h", CONFIG.h1Limit)
      ]);
      if (d1.length < 60 || h4.length < 60 || h1.length < 30) {
        return { ...row, error:`INSUFFICIENT_MTF_DATA:D1=${d1.length},H4=${h4.length},H1=${h1.length}` };
      }
      const candidate = scoreCandidate({ market:row.market, ticker:row.ticker, candles1h:h1, candles4h:h4, candles1d:d1, marketRegime });
      return candidate;
    } catch (error) {
      return { ...row, error:safeError(error) };
    }
  });
  const valid = results.filter(x => x && x.symbol && (!x.error || x.state === "WATCH"));
  const failed = results.filter(x => x?.error);
  console.log("[DEEP][MTF][SUMMARY]", {
    attempted:selected.length, successful:valid.length, failed:failed.length,
    timeframes:"D1/H4/H1", failures:failed.slice(0,5).map(x=>({symbol:x.symbol,error:x.error}))
  });
  const ordered = valid.sort((a,b)=>num(b.score)-num(a.score));
  Object.defineProperty(ordered,"failedCount",{value:failed.length,enumerable:false});
  Object.defineProperty(ordered,"attemptedCount",{value:selected.length,enumerable:false});
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
  const tpsl = [
    ...(Number(tp) > 0 ? [{
      type: "take-profit",
      triggerPrice: toUnits(Number(tp).toFixed(12), 30),
      size,
    }] : []),
    ...(CONFIG.stopLossEnabled && Number(sl) > 0 ? [{
      type: "stop-loss",
      triggerPrice: toUnits(Number(sl).toFixed(12), 30),
      size,
    }] : []),
  ];

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
    ...(tpsl.length ? { tpsl } : {}),
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
    `🔒 Direction authority: 1H STRUCTURE → LONG / SHORT`,
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
      `📐 RR: ${trade.rr > 0 ? Number(trade.rr).toFixed(2) : "N/A"}`,
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
      lines.push(`  📌 ${item.direction ? String(item.direction).toUpperCase() : `BIAS ${String(item.directionBias || item.setupEvidence?.directionBias || "UNCONFIRMED").toUpperCase()}`} | Entry ${formatPrice(item.entry)} | SL ${item.sl > 0 ? formatPrice(item.sl) : "WAITING"} | TP ${item.tp > 0 ? formatPrice(item.tp) : "WAITING"}`);
      lines.push(`  🧠 ${String(item.setupType || "N/A")} | ${item.direction ? "SIGNAL" : "WATCH"} | Score ${num(item.score).toFixed(1)} | Edge ${num(item.edge).toFixed(1)} | Risk ${num(item.risk).toFixed(1)} | RR ${item.rr > 0 ? num(item.rr).toFixed(2) : "N/A"}`);
      const ev = item.setupEvidence || {};
      lines.push(`  🕐 1H trend ${String(ev.priorTrend || ev.directionBias || "N/A")} | Move ${num(ev.priorTrendMovePct).toFixed(2)}% | Body ${num(ev.bodyRatio).toFixed(2)} | Close ${num(ev.closeLocation).toFixed(2)}`);
      lines.push(`  💧 1H volume ${Number.isFinite(Number(ev.volumeRatio1h)) ? `${num(ev.volumeRatio1h).toFixed(2)}x` : "N/A (feed has no usable volume)"}`);
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
  const direction=String(candidate?.direction||"").toLowerCase();
  if (direction!=="long" && direction!=="short") return {ok:false,reason:"DIRECTION_INVALID_OR_MISSING"};
  const authority=String(candidate?.directionAuthority||candidate?.setupEvidence?.directionAuthority||"");
  if (authority!=="COPY_TRADER" && authority!=="1H_STRUCTURE") return {ok:false,reason:"DIRECTION_AUTHORITY_INVALID"};
  const entry=num(candidate.entry);
  if (!(entry>0)) return {ok:false,reason:"ENTRY_INVALID"};
  return {ok:true,direction};
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
  const allocation = num(candidate?.walletAllocation ?? candidate?.allocation, CONFIG.walletAllocationPerPosition);
  const leverage = num(candidate?.leverage, CONFIG.leverage);
  const collateralUsd = walletBefore * allocation;
  const notionalUsd = collateralUsd * leverage;
  const economics = candidate?.signalMode === "COPY_TRADER"
    ? { grossPnlUsd:0, expectedNetUsd:0, totalCostUsd:0 }
    : estimateEconomicOpportunity(candidate, walletBefore);

  if (collateralUsd <= 0) {
    return { executed: false, symbol: candidate.symbol, direction: candidate.direction, entry: candidate.entry, tp: candidate.tp, score: candidate.score, edge: candidate.edge, risk: candidate.risk, reason: "ZERO_COLLATERAL", stage: "BALANCE" };
  }

  const economicCheck = candidate?.signalMode === "COPY_TRADER"
    ? { ok:true, reason:"COPY_TRADER_ECONOMICS_NON_BLOCKING" }
    : economicGate(candidate, walletBefore);
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
      directionVerified: true,
      symbol: candidate.symbol,
      direction: candidate.direction,
      entry: candidate.entry,
      tp: candidate.tp,
      sl: candidate.sl,
      score: candidate.score,
      edge: candidate.edge,
      risk: candidate.risk,
      allocation,
      leverage,
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


// ======================================================
// V24 COPY-TRADER CONFIGURATION
// The three configured trader wallets for this engine.
// GitHub Actions Variables can override them one-by-one.
// Leverage is capped at 20x in code and can be configured with
// GMX_COPY_MAX_LEVERAGE, but can never exceed 20x.
// ======================================================
const COPY_TRADER_DEFAULTS = Object.freeze({
  1: "0x314686cdcfF77C6b7878d3584e34fED3ec76aF50",
  2: "0x1C5288C47EA4c2D56169f5883FCaE6574181fd0D",
  3: "0xd49d22f2a2f05B2088fD42503409E430a8a7D827",
});

function copyMaxLeverage(env) {
  const requested = Number(env?.GMX_COPY_MAX_LEVERAGE ?? CONFIG.copyMaxLeverage);
  if (!Number.isFinite(requested) || requested <= 0) return CONFIG.copyMaxLeverage;
  return clamp(requested, 1, 20);
}

function copyTraderAddresses(env) {
  const list = [];
  const csv = String(env?.GMX_COPY_TRADERS || "").split(",");
  for (const x of csv) if (x.trim()) list.push(x.trim());
  for (let i = 1; i <= CONFIG.copyTraderCount; i++) {
    const fallback = COPY_TRADER_DEFAULTS[i];
    const x = String(env?.[`GMX_COPY_TRADER_${i}`] || fallback).trim();
    if (x) list.push(x);
  }
  return [...new Set(list.filter(x => /^0x[a-fA-F0-9]{40}$/.test(x)).map(x => x.toLowerCase()))].slice(0, CONFIG.copyTraderCount);
}

function tradeRows(payload) {
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload?.trades) ? payload.trades :
    Array.isArray(payload?.data) ? payload.data :
    Array.isArray(payload?.items) ? payload.items : [];
}

function tradePnl(x) {
  for (const k of ["realizedPnlUsd","realizedPnl","pnlAfterFees","pnlUsd","pnl","profitUsd","profit"]) {
    if (x?.[k] !== undefined) return humanUsd30(x[k]);
  }
  return 0;
}

function tradeTimestamp(x) {
  return num(x?.timestamp ?? x?.blockTimestamp ?? x?.createdAt ?? x?.updatedAt ?? x?.executedAt ?? 0);
}

function positionEntry(position) {
  return normalizePrice(position?.entryPrice ?? position?.entryPriceUsd ?? position?.averageEntryPrice ?? position?.avgEntryPrice ?? 0);
}

function positionLeverage(position) {
  const direct = num(position?.leverage);
  if (direct > 0) return direct > 1000 ? direct / 100 : direct;
  const size = humanUsd30(position?.sizeInUsd ?? position?.sizeUsd ?? position?.size);
  const collateral = humanUsd30(position?.collateralUsd ?? position?.collateral ?? position?.initialCollateralUsd);
  return size > 0 && collateral > 0 ? size / collateral : 0;
}

function positionRelatedOrders(position) {
  const rows = [];
  const candidates = [
    ...(Array.isArray(position?.relatedOrders) ? position.relatedOrders : []),
    ...(Array.isArray(position?.orders) ? position.orders : []),
  ];
  for (const x of candidates) rows.push(x);
  return rows;
}

function extractExitPrices(position, direction) {
  let tp = 0, sl = 0;
  const rows = positionRelatedOrders(position);
  for (const o of rows) {
    const type = String(o?.orderType ?? o?.type ?? o?.orderTypeName ?? o?.name ?? "").toLowerCase();
    const price = normalizePrice(o?.triggerPrice ?? o?.triggerPriceUsd ?? o?.price ?? 0);
    if (!(price > 0)) continue;
    if (type.includes("take") || type.includes("profit") || type === "tp") tp = price;
    if (type.includes("stop") || type.includes("loss") || type === "sl") sl = price;
  }
  for (const [keys, target] of [
    [["takeProfitPrice","takeProfit","tp"], "tp"],
    [["stopLossPrice","stopLoss","sl"], "sl"],
  ]) {
    for (const k of keys) {
      const v = normalizePrice(position?.[k] ?? 0);
      if (v > 0) { if (target === "tp") tp = v; else sl = v; break; }
    }
  }
  if (direction === "long") {
    if (!(tp > 0 && tp > positionEntry(position))) tp = 0;
    if (!(sl > 0 && sl < positionEntry(position))) sl = 0;
  } else {
    if (!(tp > 0 && tp < positionEntry(position))) tp = 0;
    if (!(sl > 0 && sl > positionEntry(position))) sl = 0;
  }
  return { tp, sl };
}

function positionKeyForCopy(address, position) {
  return [
    address.toLowerCase(),
    positionAsset(position),
    position?.isLong === false ? "short" : "long",
    String(position?.positionKey || position?.key || "")
  ].join("|");
}

function summarizeTraderPerformance(trades) {
  const rows = tradeRows(trades).filter(x => tradeTimestamp(x) > 0);
  const ordered = rows.sort((a,b) => tradeTimestamp(a) - tradeTimestamp(b)).slice(-CONFIG.copyTradeLimit);
  const pnls = ordered.map(tradePnl);
  const wins = pnls.filter(x => x > 0).length;
  const losses = pnls.filter(x => x < 0).length;
  const decided = wins + losses;
  let equity = 0, peak = 0, maxDd = 0;
  for (const p of pnls) {
    equity += p; peak = Math.max(peak, equity); maxDd = Math.max(maxDd, peak - equity);
  }
  const totalPnl = pnls.reduce((a,b)=>a+b,0);
  const recent = ordered.slice(-20).map(tradePnl);
  const recentPnl = recent.reduce((a,b)=>a+b,0);
  const mean = pnls.length ? totalPnl / pnls.length : 0;
  const variance = pnls.length ? pnls.reduce((s,x)=>s + (x-mean)**2,0)/pnls.length : 0;
  const stdev = Math.sqrt(variance);
  const consistency = stdev > 0 ? clamp((mean / stdev + 0.5) * 100, 0, 100) : (mean > 0 ? 75 : 50);
  const winRate = decided ? wins / decided * 100 : 50;
  const recentWinRate = recent.length ? recent.filter(x=>x>0).length / Math.max(1,recent.filter(x=>x!==0).length) * 100 : winRate;
  const drawdownPenalty = totalPnl > 0 ? clamp(maxDd / Math.max(totalPnl,1) * 100,0,100) : 100;
  const drawdownScore = 100 - drawdownPenalty;
  const activityScore = clamp(ordered.length / 30 * 100, 0, 100);
  const recentScore = clamp(50 + recentPnl / Math.max(1, Math.abs(totalPnl) + Math.abs(recentPnl)) * 50, 0, 100);
  const score = Number(clamp(
    recentScore*0.25 + winRate*0.25 + recentWinRate*0.10 + consistency*0.20 + drawdownScore*0.10 + activityScore*0.10,
    0,100
  ).toFixed(1));
  return { trades: ordered.length, totalPnl, recentPnl, winRate, recentWinRate, consistency, maxDrawdown:maxDd, drawdownScore, activityScore, score };
}

async function readCopyTrader(sdk, address) {
  const since = Math.floor(Date.now()/1000) - CONFIG.copyRecentDays * 86400;
  const [positionsRaw, tradesRaw] = await Promise.all([
    sdk.fetchPositionsInfo({ address, includeRelatedOrders:true }),
    sdk.fetchTrades({ address, since, limit: CONFIG.copyTradeLimit }),
  ]);
  const positions = (Array.isArray(positionsRaw) ? positionsRaw : []).filter(p => positionSizeUsd(p) > 0);
  const performance = summarizeTraderPerformance(tradesRaw);
  const enriched = positions.map(p => {
    const direction = p?.isLong === false ? "short" : "long";
    const entry = positionEntry(p);
    const exits = extractExitPrices(p, direction);
    const sizeUsd = positionSizeUsd(p);
    const leverage = positionLeverage(p);
    return {
      key: positionKeyForCopy(address,p),
      symbol: marketDisplaySymbol(p) || p?.indexName || p?.symbol || positionAsset(p),
      asset: positionAsset(p),
      direction, entry, sizeUsd, leverage, tp:exits.tp, sl:exits.sl,
      pnlUsd: humanUsd30(p?.pnlAfterFees ?? p?.pnl ?? p?.unrealizedPnlUsd ?? 0),
      positionValueUsd: humanUsd30(p?.positionValueInUsd ?? p?.positionValueUsd ?? 0),
      raw:p,
    };
  });
  return { address, positions: enriched, performance, ok:true };
}

function consensusCopyCandidates(traders, tickers) {
  const all = [];
  for (const t of traders) for (const p of t.positions) {
    const ticker = tickers.find(x => normalizeAsset(marketDisplaySymbol(x)) === p.asset || normalizeAsset(x?.symbol) === p.asset);
    all.push({ ...p, trader:t.address, traderPerformance:t.performance, currentPrice:tickerPrice(ticker), traderScore:t.performance.score });
  }
  const groups = new Map();
  for (const x of all) {
    const key = `${x.asset}|${x.direction}`;
    const g = groups.get(key) || {asset:x.asset,direction:x.direction,items:[]};
    g.items.push(x); groups.set(key,g);
  }
  return [...groups.values()].map(g => {
    const uniqueTraders = new Set(g.items.map(x=>x.trader)).size;
    const best = [...g.items].sort((a,b)=>b.traderScore-a.traderScore || b.traderPerformance.recentPnl-a.traderPerformance.recentPnl)[0];
    return {...best, consensusCount:uniqueTraders, consensusBonus:Math.min(20, (uniqueTraders-1)*10)};
  }).sort((a,b)=>
    (b.consensusCount*20+b.traderScore+b.consensusBonus) -
    (a.consensusCount*20+a.traderScore+a.consensusBonus)
  );
}

async function buildCopyTraderEngine(sdk, markets, tickers, state, env) {
  const addresses = copyTraderAddresses(env);
  if (!addresses.length) {
    return { configured:false, reason:"COPY_TRADERS_NOT_CONFIGURED", traders:[], candidates:[], selected:null, closeSignals:[] };
  }
  const results = await Promise.all(addresses.map(async address => {
    try { return await readCopyTrader(sdk,address); }
    catch (error) { return { address, ok:false, error:safeError(error), positions:[], performance:summarizeTraderPerformance([]) }; }
  }));
  const okTraders = results.filter(x=>x.ok);
  const candidates = consensusCopyCandidates(okTraders, tickers).map(c => {
    const current = num(c.currentPrice) || num(c.entry);
    const distance = current > 0 && c.entry > 0 ? Math.abs(pct(current,c.entry)) : Infinity;
    const maxDistance = Number(env?.COPY_MAX_ENTRY_DISTANCE_PCT || CONFIG.copyMaxEntryDistancePct);
    const eligible = Number.isFinite(distance) && distance <= maxDistance;
    const leverage = clamp(c.leverage || 1, 1, copyMaxLeverage(env));
    return {
      symbol:c.symbol, direction:c.direction, market:markets.find(m=>normalizeAsset(marketDisplaySymbol(m))===c.asset) || null,
      entry:current, sourceEntry:c.entry, tp:c.tp, sl:c.sl, leverage,
      allocation:1, walletAllocation:1, consensusCount:c.consensusCount, trader:c.trader,
      traderScore:c.traderScore, copyDistancePct:distance, copyMaxDistancePct:maxDistance,
      setupType:"COPY_TRADE", signalMode:"COPY_TRADER", directionAuthority:"COPY_TRADER",
      setupEvidence:{ signalMode:"COPY_TRADER", directionAuthority:"COPY_TRADER", directionLocked:true,
        sourceTrader:c.trader, sourceEntry:c.entry, copyDistancePct:distance, consensusCount:c.consensusCount,
        sourceLeverage:c.leverage, sourcePnlUsd:c.pnlUsd, traderScore:c.traderScore,
        recentPnl:c.traderPerformance.recentPnl, winRate:c.traderPerformance.winRate,
        consistency:c.traderPerformance.consistency, maxDrawdown:c.traderPerformance.maxDrawdown,
        exitSource:c.tp||c.sl ? "TRADER_RELATED_ORDER" : "TRADER_CLOSE_ACTION" },
      score:Number(clamp(c.traderScore + c.consensusBonus,0,100).toFixed(1)),
      edge:Number(clamp(c.traderScore + c.consensusBonus,0,100).toFixed(1)),
      risk:Number(clamp(100-c.traderScore,0,100).toFixed(1)),
      rr: c.tp>0 && c.sl>0 ? Math.abs(c.tp-current)/Math.max(Math.abs(current-c.sl),1e-12) : 0,
      eligible, ineligibleReason:eligible?null:`ENTRY_TOO_FAR_${distance.toFixed(2)}PCT`,
      reasons:[`COPY_${c.consensusCount}TRADER_CONSENSUS`, `SOURCE_SCORE_${c.traderScore.toFixed(1)}`, `SOURCE_LEVERAGE_${leverage.toFixed(1)}X`]
    };
  });
  const active = state?.copyActive || null;
  const closeSignals = [];
  if (active) {
    const source = okTraders.find(t=>t.address === String(active.trader).toLowerCase());
    const stillOpen = source?.positions.some(p => p.asset === active.asset && p.direction === active.direction);
    if (!stillOpen) closeSignals.push({ ...active, reason:"SOURCE_POSITION_CLOSED" });
  }
  const eligible = candidates.filter(x=>x.eligible);
  const selected = eligible[0] || null;
  return { configured:true, traders:results, candidates, selected, closeSignals };
}

async function closeCopiedPosition(runtime, active) {
  const positions = await getOpenPositions(runtime.sdk, runtime.account);
  const wanted = normalizeAsset(active.asset || active.symbol);
  const position = positions.find(p => positionAsset(p) === wanted &&
    ((p?.isLong === false ? "short":"long") === active.direction));
  if (!position) return { executed:false, reason:"COPY_POSITION_ALREADY_CLOSED", symbol:active.symbol };
  const symbol = position?.symbol || position?.indexName || active.symbol;
  const direction = position?.isLong === false ? "short" : "long";
  const sizeUsd = positionSizeUsd(position);
  const preClosePrice = normalizePrice(
    position?.markPrice ?? position?.markPriceUsd ?? position?.currentPrice ?? position?.price ?? 0
  );
  const preClosePnlUsd = humanUsd30(
    position?.pnlAfterFees ?? position?.pnl ?? position?.unrealizedPnlUsd ?? 0
  );
  const prepared = await runtime.sdk.prepareOrder({
    kind:"decrease", symbol, direction, orderType:"market",
    size:toUnits(sizeUsd.toFixed(6),30), collateralToken:"USDC", receiveToken:"USDC",
    mode:"classic", from:runtime.account
  });
  const txHash = await sendClassicTransaction(runtime.signer,prepared);
  return {
    executed:true, symbol:active.symbol, direction, txHash, sizeUsd,
    preClosePrice, preClosePnlUsd, reason:"SOURCE_POSITION_CLOSED"
  };
}

async function findLatestOwnCloseTrade(sdk, account, active, sinceMs) {
  try {
    const rows = tradeRows(await sdk.fetchTrades({
      address: account,
      since: Math.floor((sinceMs - 30_000) / 1000),
      limit: 50,
    }));
    const wanted = normalizeAsset(active.asset || active.symbol);
    const direction = String(active.direction || "").toLowerCase();
    const candidates = rows.filter(x => {
      const asset = normalizeAsset(
        x?.indexName ?? x?.symbol ?? x?.marketSymbol ?? x?.market?.symbol ?? x?.market?.name ?? ""
      );
      if (asset !== wanted) return false;
      const isLong = x?.isLong ?? x?.long ?? (String(x?.direction || "").toLowerCase() === "long" ? true : undefined);
      if (isLong !== undefined && isLong !== null) {
        const d = isLong === false ? "short" : "long";
        if (d !== direction) return false;
      }
      const ts = tradeTimestamp(x);
      return ts >= Math.floor(sinceMs / 1000) - 10;
    }).sort((a,b) => tradeTimestamp(b) - tradeTimestamp(a));
    const x = candidates[0];
    if (!x) return null;
    const closePrice = normalizePrice(
      x?.executionPrice ?? x?.executionPriceUsd ?? x?.fillPrice ?? x?.price ?? x?.priceUsd ?? x?.avgPrice ?? 0
    );
    return {
      closePrice,
      pnlUsd: tradePnl(x),
      timestamp: tradeTimestamp(x),
    };
  } catch {
    return null;
  }
}

function copyCloseTelegram(close) {
  const price = num(close.closePrice) > 0 ? formatPrice(close.closePrice) : "N/A";
  const pnl = Number.isFinite(num(close.pnlUsd)) ? formatUsd(close.pnlUsd) : "N/A";
  return [
    "🔻 GMX COPY-TRADE CLOSED",
    "━━━━━━━━━━━━━━━━━━",
    `📌 Position: ${close.symbol} ${String(close.direction || "").toUpperCase()}`,
    `💰 Closed at: ${price}`,
    `📊 PnL: ${pnl}`,
    `👤 Source trader: ${String(close.trader || "").slice(0,6)}…${String(close.trader || "").slice(-4)}`,
    `🕐 ${new Date().toISOString()}`,
  ].join("\n");
}

function copyTraderTelegram(report) {
  const lines = [
    "🟣 GMX SMART COPY-TRADER ENGINE","━━━━━━━━━━━━━━━━━━",
    `📡 Status: ${report.status}`,
    `👥 Traders: ${report.traders.length}/${CONFIG.copyTraderCount}`,
    `📍 Open source positions: ${report.sourcePositions}`,
  ];
  for (const [i,t] of report.traders.slice(0,5).entries()) {
    const p=t.performance||{};
    lines.push(`\n#${i+1} ${t.address.slice(0,6)}…${t.address.slice(-4)} | Score ${num(p.score).toFixed(1)}`,
      `📊 Trades ${p.trades} | Win ${num(p.winRate).toFixed(1)}% | Recent PnL ${formatUsd(p.recentPnl)}`,
      `📉 Max DD ${formatUsd(p.maxDrawdown)} | Consistency ${num(p.consistency).toFixed(1)}`);
    if (t.error) lines.push(`❌ ${t.error}`);
    for (const x of (t.positions||[]).slice(0,3))
      lines.push(`  • ${x.asset} ${x.direction.toUpperCase()} | Entry ${formatPrice(x.entry)} | Lev ${num(x.leverage).toFixed(1)}x | Size ${formatUsd(x.sizeUsd)} | PnL ${formatUsd(x.pnlUsd)}`);
  }
  if (report.closeActions?.length) for (const c of report.closeActions)
    lines.push(`\n🔻 COPY CLOSE: ${c.symbol} ${c.direction.toUpperCase()} | ${c.reason} | Tx ${c.txHash||"N/A"}`);
  const s=report.selected;
  if (s) lines.push(`\n🎯 SELECTED COPY: ${s.symbol} ${s.direction.toUpperCase()}`,
    `👤 Trader ${s.trader.slice(0,6)}…${s.trader.slice(-4)} | Score ${s.traderScore.toFixed(1)}`,
    `💰 Source entry ${formatPrice(s.sourceEntry)} | Current ${formatPrice(s.entry)} | Distance ${num(s.copyDistancePct).toFixed(2)}%`,
    `⚙️ Source leverage ${num(s.leverage).toFixed(1)}x | Consensus ${s.consensusCount}`,
    `🎯 TP ${s.tp>0?formatPrice(s.tp):"FOLLOW SOURCE CLOSE"} | 🛡️ SL ${s.sl>0?formatPrice(s.sl):"FOLLOW SOURCE CLOSE"}`,
    `💵 Wallet allocation 100% | Signal authority COPY TRADER`);
  else lines.push(`\n👀 No eligible copy trade. ${report.reason||"Waiting for source position / entry distance."}`);
  lines.push(`\n🕐 ${new Date().toISOString()}`);
  return lines.join("\n");
}

async function runCycle(event, env) {
  const scanId = String(event?.scanId || `scheduled-${event?.scheduledTime || Date.now()}-${Math.random().toString(36).slice(2,8)}`);
  const runtime = await createRuntime(env);
  const state = await loadState();

  console.log("[CYCLE][START]", {scanId, version:BOT_VERSION, executionEnabled:executionEnabled(env), chainId:CHAIN_ID});

  const [markets,tickers,wallet,openPositions] = await Promise.all([
    runtime.sdk.fetchMarkets(),
    runtime.sdk.fetchMarketsTickers(),
    getWalletSnapshot(runtime.sdk,runtime.account),
    getOpenPositions(runtime.sdk,runtime.account),
  ]);
  const universe = Array.isArray(markets) ? markets.filter(isLikelyPerpMarket) : [];
  const tickerRows = Array.isArray(tickers) ? tickers : [];

  const copy = await buildCopyTraderEngine(runtime.sdk, universe, tickerRows, state, env);
  const executions=[], failures=[], closeActions=[];

  // Follow the previously copied source position until that source closes.
  for (const closeSignal of copy.closeSignals || []) {
    try {
      const result = await closeCopiedPosition(runtime, closeSignal);
      closeActions.push(result);
      if (result.executed) {
        const closeStartedAt = Date.now();
        const trade = await findLatestOwnCloseTrade(runtime.sdk, runtime.account, closeSignal, closeStartedAt);
        const closeNotice = {
          ...result,
          trader: closeSignal.trader,
          closePrice: trade?.closePrice || result.preClosePrice || 0,
          pnlUsd: trade ? trade.pnlUsd : result.preClosePnlUsd,
        };
        await sendTelegram(env, copyCloseTelegram(closeNotice));
        state.copyActive = null;
        state.copyLastClose = {...closeNotice, at:Date.now(), scanId};
      }
    } catch (error) {
      closeActions.push({...closeSignal, executed:false, reason:safeError(error)});
    }
  }

  let currentPositions = await getOpenPositions(runtime.sdk,runtime.account);
  let selected = copy.selected;
  if (state.copyActive && !copy.closeSignals?.length) {
    selected = null; // keep following the existing copied position; never switch sources mid-trade
  }

  if (selected && executionEnabled(env) && currentPositions.length < CONFIG.maxPositions) {
    if (findPositionForCandidate(currentPositions,selected)) {
      selected = null;
    } else {
      const result = await executeCandidate(runtime,selected,wallet,currentPositions,env);
      if (result.executed) {
        executions.push(result);
        currentPositions.push(result.position || {symbol:selected.symbol,sizeInUsd:String(toUnits(result.notionalUsd.toFixed(6),30))});
        state.copyActive = {
          trader:selected.trader, asset:normalizeAsset(selected.symbol), symbol:selected.symbol,
          direction:selected.direction, sourceEntry:selected.sourceEntry, leverage:selected.leverage,
          openedAt:Date.now(), txHash:result.txHash
        };
      } else failures.push(result);
    }
  }

  const sourcePositions = copy.traders.reduce((n,t)=>n+(t.positions?.length||0),0);
  const report = {
    scanId,
    status: executions.length ? "EXECUTED" : closeActions.some(x=>x.executed) ? "CLOSED" :
      !copy.configured ? "CONFIG_MISSING" : selected ? "ENTRY_READY" : "WATCHING",
    universe:universe.length,
    universeScanSuccess:universe.length,
    deepCount:copy.traders.filter(t=>t.ok).length,
    deepAttempted:copy.traders.length,
    deepFailureCount:copy.traders.filter(t=>!t.ok).length,
    actionableCount:selected ? 1 : 0,
    sourcePositions,
    traders:copy.traders,
    candidates:copy.candidates,
    selected,
    closeActions,
    executions,
    failures,
    reason:copy.reason,
    flowCount:0,smartMoneyCount:0,maCount:0,adxCount:0,layerReadyCount:selected?1:0,
    impulseCount:0,layerFlowCount:0,layerReversalCount:0,srCount:0,positiveMoveCount:0,pullbackCount:0,
    scoreReadyCount:selected?1:0,edgeReadyCount:selected?1:0,topRejected:copy.candidates.filter(x=>!x.eligible).slice(0,5),
  };

  state.scans += 1;
  state.lastScanId=scanId;
  state.lastExecution=executions.at(-1)||state.lastExecution;
  state.executionHistory.push(...executions.map(x=>({at:Date.now(),scanId,symbol:x.symbol,direction:x.direction,entry:x.entry,tp:x.tp,notionalUsd:x.notionalUsd,collateralUsd:x.collateralUsd,txHash:x.txHash})));
  await saveState(state);

  try {
    const msg=copyTraderTelegram(report);
    const fp=JSON.stringify({
      status:report.status, selected:report.selected?.symbol||"", direction:report.selected?.direction||"",
      distance:num(report.selected?.copyDistancePct), source:report.selected?.trader||"",
      closes:report.closeActions.map(x=>x.symbol+":"+x.executed), traders:report.traders.map(x=>[x.address,x.positions?.length,x.performance?.score])
    });
    if (report.status!=="WATCHING" || state.lastCycleReportFingerprint!==fp) {
      const sent=await sendTelegram(env,msg);
      if(sent?.ok){state.lastCycleReportFingerprint=fp;await saveState(state);}
    }
  } catch(error) { console.error("[TELEGRAM][CYCLE_ERROR]",safeError(error)); }

  console.log("[CYCLE][END]",{scanId,status:report.status,traders:report.deepCount,selected:report.actionableCount,executed:report.executions.length,closes:report.closeActions.length,failures:report.failures.length});
  return {ok:true,version:BOT_VERSION,scanId,report,wallet:{before:wallet.walletUsd,after:(await getWalletSnapshot(runtime.sdk,runtime.account)).walletUsd}};
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
