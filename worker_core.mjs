/*
╔══════════════════════════════════════════════════════════════════════════════╗
║ GMX SMART MONEY FUTURES AI BOT — V20 SHARP REVERSAL ENGINE                  ║
║ Single pipeline • 5M broad scan • 15M deep scan • Classic GMX only          ║
║ 5x leverage • 100% wallet • max 1 position • one TP • no SL               ║
╚══════════════════════════════════════════════════════════════════════════════╝

Architecture:
GMX MARKET UNIVERSE
  → FULL 5M BROAD SCAN
  → TOP DEEP CANDIDATES
  → 15M STRUCTURE + SMART-MONEY/OI/FLOW + S/R
  → TOP 3
  → 30% WALLET COLLATERAL EACH
  → 5x CLASSIC GMX MARKET INCREASE
  → ONE STRUCTURE TP (attached to the increase)
  → POSITION VERIFICATION
  → TELEGRAM

Important:
- Execution is direct on-chain Classic GMX only.
- No stop-loss orders.
- Exactly one TP.
- No legacy radar lane.
- No parallel eligibility engine.
- Telegram is diagnostic/notification only.
- EXECUTION_ENABLED is an explicit emergency OFF switch.
*/

import { createRequire } from "node:module";
import { promises as fs } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);

export const BOT_VERSION = "V20.0.0-SHARP-REVERSAL-CLASSIC-ONE-TP";
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
  leverage: 5,

  broadTimeframe: "5m",
  broadLimit: 72,
  deepTimeframe: "15m",
  deepLimit: 96,

  deepCandidates: 30,
  finalCandidates: 1,

  minScore: 72,
  minEdge: 8,
  minTrendConfluence: 3,
  maxRisk: 55,

  minTpDistancePct: 0.30,
  maxTpDistancePct: 3.50,
  tpAtrMultiplier: 1.20,

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
  });
  if (!Array.isArray(state.executionHistory)) state.executionHistory = [];
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

function scoreCandidate({ market, ticker, candles5, candles15 }) {
  const five = structureIndicators(candles5, 'long');
  const fifteen = structureIndicators(candles15, 'long');
  const price = five.price;
  const impulse = candleImpulseMetrics(candles5);
  const rLong = reversalMetrics(candles5,candles15,ticker,'long');
  const rShort = reversalMetrics(candles5,candles15,ticker,'short');

  // Direction is chosen from the current impulse/reversal state first. This is
  // deliberately different from the old EMA-only continuation direction.
  const longContext = Number(five.macd.histogram>0)+Number(five.rsi>50)+Number(fifteen.macd.histogram>0)+Number(fifteen.rsi>50);
  const shortContext = Number(five.macd.histogram<0)+Number(five.rsi<50)+Number(fifteen.macd.histogram<0)+Number(fifteen.rsi<50);
  const zoneLong = classifyZone(candles5,price,five.atr,'long');
  const zoneShort = classifyZone(candles5,price,five.atr,'short');
  const longReversal = rLong.longScore + (zoneLong.nearSupport?20:0);
  const shortReversal = rShort.shortScore + (zoneShort.nearResistance?20:0);
  const reversalBias = longReversal - shortReversal;
  let direction;
  if (Math.max(longReversal,shortReversal) >= 28 && Math.abs(reversalBias) >= 8) direction = reversalBias>0?'long':'short';
  else direction = longContext===shortContext ? (tickerChange5m(ticker)>=0?'long':'short') : (longContext>shortContext?'long':'short');

  const r = direction==='long'?rLong:rShort;
  const zone = direction==='long'?zoneLong:zoneShort;
  const move5 = tickerChange5m(ticker) || impulse.move3;
  const move15 = impulse.m15;
  const absMove3 = Math.abs(impulse.move3), absMove5 = Math.abs(impulse.move5);
  const sharp = absMove3>=0.75 || absMove5>=1.20 || impulse.rangeExpansion>=1.65 || Math.abs(impulse.acceleration)>=0.45;
  const directionalMove = direction==='long' ? move5 : -move5;
  const directional15 = direction==='long' ? move15 : -move15;
  const extension = Math.max(absMove3,absMove5);
  const lateChase = extension>=2.5 && impulse.acceleration <= 0;
  const impulseQuality = clamp(
    absMove3*12 + Math.max(0,impulse.rangeExpansion-1)*14 + Math.max(0,Math.abs(impulse.acceleration))*10 + Math.max(0,impulse.volumeRatio-1)*8,
    0,35
  );
  const srReaction = direction==='long' ? Number(r.bullishReject)*12 : Number(r.bearishReject)*12;
  const setupType = ((direction==='long'?longReversal:shortReversal) >= 28 && zone.state!=='AWAY_FROM_ZONE') ? 'REVERSAL' : 'CONTINUATION';
  const reversalEvidence = direction==='long' ? r.longEvidence + Number(zone.nearSupport) : r.shortEvidence + Number(zone.nearResistance);
  const trend = direction==='long'
    ? Number(five.longTrend)+Number(fifteen.longTrend)
    : Number(five.shortTrend)+Number(fifteen.shortTrend);
  const oi = oiDeltaScore(ticker,direction);
  const rsiQuality = direction==='long' ? (five.rsi>=42&&five.rsi<=68?7:five.rsi>78?-7:0) : (five.rsi<=58&&five.rsi>=32?7:five.rsi<22?-7:0);
  const macdQuality = direction==='long' ? (five.macd.histogram>0?6:-3) : (five.macd.histogram<0?6:-3);
  const context = direction==='long'?longContext:shortContext;
  const timing = sharp ? (lateChase?-8:10) : 0;
  const reversalBonus = setupType==='REVERSAL' ? clamp(reversalEvidence*5 + (zone.nearSupport||zone.nearResistance?10:0),0,28) : 0;
  let score = 35 + impulseQuality + srReaction + trend*2 + rsiQuality + macdQuality + oi.score + context*2 + timing + reversalBonus;
  if (setupType==='REVERSAL') score += 5;
  if (lateChase) score -= 12;
  score = clamp(score,0,100);
  const risk = clamp(
    (lateChase?18:0) + (extension>3.5?15:0) + (five.rsi>82||five.rsi<18?15:0) + (five.adx<12?8:0) + (oi.exhausted?7:0),0,100
  );
  const edge = clamp(18 + impulseQuality*0.8 + reversalEvidence*3 + (zone.state!=='AWAY_FROM_ZONE'?10:0) + (oi.aligned?8:0) + (sharp?6:0) - risk*0.45,0,100);
  const entry = price;
  const tp = calculateLogicalTp(entry,direction,candles5,candles15,five.atr);
  const reasons=[];
  if (sharp) reasons.push('SHARP_MOVE');
  if (impulse.rangeExpansion>=1.65) reasons.push('RANGE_EXPANSION');
  if (Math.abs(impulse.acceleration)>=0.45) reasons.push('ACCELERATION');
  if (impulse.volumeRatio>=1.5) reasons.push('VOLUME_EXPANSION');
  if (zone.nearSupport||zone.nearResistance) reasons.push('S_R_ZONE');
  if (setupType==='REVERSAL') reasons.push(`REVERSAL_${direction.toUpperCase()}`);
  else reasons.push('CONTINUATION');
  if (oi.aligned) reasons.push('OI_ALIGNMENT');
  if (lateChase) reasons.push('LATE_CHASE_PENALTY');
  return {
    symbol:marketDisplaySymbol(market), candleSymbol:candleSymbolFromMarket(market), direction, entry, tp,
    score:Number(score.toFixed(2)), edge:Number(edge.toFixed(2)), risk:Number(risk.toFixed(2)), trendConfluence:trend,
    setupType,reversalEvidence,
    setupEvidence:{setupType,reversalEvidence,zoneState:zone.state,nearSupport:zone.nearSupport,nearResistance:zone.nearResistance,
      nearestSupport:zone.support,nearestResistance:zone.resistance,sharpMove:sharp,lateChase,impulseQuality,
      acceleration:impulse.acceleration,rangeExpansion:impulse.rangeExpansion,volumeRatio:impulse.volumeRatio,
      reversalLong:rLong.longScore,reversalShort:rShort.shortScore},
    reasons,
    indicators:{rsi:Number(five.rsi.toFixed(2)),adx:Number(five.adx.toFixed(2)),ema20:five.ema20,ema50:five.ema50,ema200:five.ema200,
      macdHistogram:five.macd.histogram,move5m:move5,move15m:move15,oiChange5m:oi.delta,reactionScore:srReaction,
      explosive:sharp,impulseQuality,acceleration:impulse.acceleration,rangeExpansion:impulse.rangeExpansion,volumeRatio:impulse.volumeRatio,
      lateChase,volume24h:tickerVolume(ticker),openInterest:tickerOpenInterest(ticker),fundingRate:tickerFunding(ticker),liquidity:marketLiquidity(market)},
    market,ticker,candles5,candles15,
  };
}
function calculateLogicalTp(entry, direction, candles5, candles15, atr5) {
  const levels5 = recentSwingLevels(candles5);
  const levels15 = recentSwingLevels(candles15);

  if (direction === "long") {
    const candidates = [...levels5.resistance, ...levels15.resistance]
      .filter((x) => x > entry * (1 + CONFIG.minTpDistancePct / 100))
      .sort((a, b) => a - b);
    const structural = candidates[0] || entry + atr5 * CONFIG.tpAtrMultiplier;
    const cap = entry * (1 + CONFIG.maxTpDistancePct / 100);
    return Number(Math.min(structural, cap).toPrecision(12));
  }

  const candidates = [...levels5.support, ...levels15.support]
    .filter((x) => x < entry * (1 - CONFIG.minTpDistancePct / 100))
    .sort((a, b) => b - a);
  const structural = candidates[0] || entry - atr5 * CONFIG.tpAtrMultiplier;
  const floor = entry * (1 - CONFIG.maxTpDistancePct / 100);
  return Number(Math.max(structural, floor).toPrecision(12));
}

function candidateIsActionable(candidate) {
  if (!candidate || !candidate.symbol || !candidate.entry || !candidate.tp) {
    return { ok: false, reason: "INVALID_PLAN" };
  }
  if (candidate.score < CONFIG.minScore) {
    return { ok: false, reason: `SCORE_${candidate.score.toFixed(1)}_BELOW_${CONFIG.minScore}` };
  }
  if (candidate.edge < CONFIG.minEdge) {
    return { ok: false, reason: `EDGE_${candidate.edge.toFixed(1)}_BELOW_${CONFIG.minEdge}` };
  }
  if (candidate.setupType === "REVERSAL") {
    if (Number(candidate.reversalEvidence || 0) < 2) return { ok: false, reason: `REVERSAL_EVIDENCE_${candidate.reversalEvidence || 0}` };
    if (candidate.setupEvidence?.zoneState === "AWAY_FROM_ZONE") return { ok: false, reason: "REVERSAL_NOT_AT_S_R_ZONE" };
  } else if (candidate.trendConfluence < CONFIG.minTrendConfluence && !candidate.setupEvidence?.sharpMove) {
    return { ok: false, reason: `TREND_CONFLUENCE_${candidate.trendConfluence}` };
  }
  if (candidate.setupEvidence?.lateChase) return { ok: false, reason: "LATE_CHASE" };
  if (Number(candidate.setupEvidence?.impulseQuality || 0) < 5 && candidate.setupType !== "REVERSAL") return { ok: false, reason: "WEAK_IMPULSE" };
  if (candidate.risk > CONFIG.maxRisk) {
    return { ok: false, reason: `RISK_${candidate.risk.toFixed(1)}_ABOVE_${CONFIG.maxRisk}` };
  }

  const tpDistance = Math.abs(pct(candidate.tp, candidate.entry));
  if (tpDistance < CONFIG.minTpDistancePct) {
    return { ok: false, reason: "TP_TOO_CLOSE" };
  }

  return { ok: true, reason: "READY" };
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

async function broadScan(sdk, markets, tickers) {
  const listed = markets.filter(isLikelyPerpMarket);
  const results = await mapLimit(listed, CONFIG.ohlcvConcurrency, async (market) => {
    const symbol = candleSymbolFromMarket(market);
    try {
      const candles5 = await fetchCandles(sdk, market, CONFIG.broadTimeframe, CONFIG.broadLimit);
      const ticker = findTicker(tickers, market);
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

async function deepScan(sdk, broadRows) {
  const selected = broadRows.slice(0, CONFIG.deepCandidates);
  const results = await mapLimit(selected, Math.min(6, CONFIG.ohlcvConcurrency), async (row) => {
    try {
      const candles15 = await fetchCandles(
        sdk,
        row.market,
        CONFIG.deepTimeframe,
        CONFIG.deepLimit
      );
      return scoreCandidate({
        market: row.market,
        ticker: row.ticker,
        candles5: row.candles5,
        candles15,
      });
    } catch (error) {
      return { ...row, error: safeError(error) };
    }
  });

  return results
    .filter((x) => x && !x.error && x.entry > 0)
    .sort((a, b) => (b.score + b.edge * 0.35) - (a.score + a.edge * 0.35));
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
    `⚙️ Leverage: 5.0x`,
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
    `🧠 Deep: ${report.deepCount}`,
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
      `📊 Allocation: ${(trade.allocation * 100).toFixed(2)}% | ⚙️ Leverage: 5.0x`,
      `📦 Notional: ${formatUsd(trade.notionalUsd)} | 💵 Collateral: ${formatUsd(trade.collateralUsd)}`,
      `🔗 Tx: ${trade.txHash || "N/A"}`,
      `🧪 Score ${trade.score.toFixed(1)} | Edge ${trade.edge.toFixed(1)} | Risk ${trade.risk.toFixed(1)}`,
      `──────────────────`,
    );
  }

  if (report.topRejected.length) {
    lines.push(`ℹ️ TOP BLOCKED`);
    for (const item of report.topRejected.slice(0, 3)) {
      lines.push(`• ${item.symbol}`);
      lines.push(`  📌 ${String(item.direction || "N/A").toUpperCase()} | Entry ${formatPrice(item.entry)} | TP ${formatPrice(item.tp)}`);
      lines.push(`  🧠 ${String(item.setupType || "N/A")} | Score ${num(item.score).toFixed(1)} | Edge ${num(item.edge).toFixed(1)} | Risk ${num(item.risk).toFixed(1)} | ${item.reason}`);
    }
  }

  lines.push(`🆔 Scan: ${report.scanId}`);
  lines.push(`🕐 ${new Date().toISOString()}`);
  lines.push(`ℹ️ مسیر: Scan → Selection → Classic Execution → Verification`);

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

  if (collateralUsd <= 0) {
    return { executed: false, symbol: candidate.symbol, direction: candidate.direction, entry: candidate.entry, tp: candidate.tp, score: candidate.score, edge: candidate.edge, risk: candidate.risk, reason: "ZERO_COLLATERAL", stage: "BALANCE" };
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
    });
  } catch (error) {
    return {
      executed: false,
      symbol: candidate.symbol,
      direction: candidate.direction,
      entry: candidate.entry,
      tp: candidate.tp,
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
      score: candidate.score,
      edge: candidate.edge,
      risk: candidate.risk,
      allocation: CONFIG.walletAllocationPerPosition,
      leverage: CONFIG.leverage,
      notionalUsd,
      collateralUsd,
      walletBefore,
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

  const [markets, tickers, wallet, openPositions] = await Promise.all([
    runtime.sdk.fetchMarkets(),
    runtime.sdk.fetchMarketsTickers(),
    getWalletSnapshot(runtime.sdk, runtime.account),
    getOpenPositions(runtime.sdk, runtime.account),
  ]);

  const universe = Array.isArray(markets) ? markets.filter(isLikelyPerpMarket) : [];
  const tickerRows = Array.isArray(tickers) ? tickers : [];

  const broad = await broadScan(runtime.sdk, universe, tickerRows);
  const deep = await deepScan(runtime.sdk, broad.rows);
  const intelligence = await fetchOptionalIntelligence(env);
  const ranked = enrichWithIntelligence(deep, intelligence);

  const blocked = [];
  const actionable = [];
  for (const candidate of ranked) {
    const check = candidateIsActionable(candidate);
    if (check.ok) actionable.push(candidate);
    else blocked.push({
      symbol: candidate.symbol, direction: candidate.direction, entry: candidate.entry, tp: candidate.tp,
      score: candidate.score, edge: candidate.edge, risk: candidate.risk, setupType: candidate.setupType,
      reversalEvidence: candidate.reversalEvidence, reason: check.reason, setupEvidence: candidate.setupEvidence,
    });
  }

  actionable.sort((a, b) => (b.score + b.edge * 0.35) - (a.score + a.edge * 0.35));
  const selected = actionable.slice(0, CONFIG.finalCandidates);
  console.log("[SELECTION][TOP]", selected[0] ? {
    symbol: selected[0].symbol, direction: selected[0].direction, entry: selected[0].entry, tp: selected[0].tp,
    setupType: selected[0].setupType, reversalEvidence: selected[0].reversalEvidence, score: selected[0].score,
    edge: selected[0].edge, risk: selected[0].risk, allocation: CONFIG.walletAllocationPerPosition, leverage: CONFIG.leverage,
    sharpMove: selected[0].setupEvidence?.sharpMove, lateChase: selected[0].setupEvidence?.lateChase,
    zoneState: selected[0].setupEvidence?.zoneState, impulseQuality: selected[0].setupEvidence?.impulseQuality,
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
  const flowCount = ranked.filter((x) => Math.abs(x.indicators?.oiChange5m || 0) > 0).length;
  const maCount = ranked.filter((x) => x.trendConfluence >= 3).length;
  const adxCount = ranked.filter((x) => x.indicators?.adx >= 18).length;
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
    actionableCount: actionable.length,
    impulseCount,
    flowCount,
    maCount,
    adxCount,
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
