import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/*
 * NOVARA SMART MONEY AI V2.8.6 STRUCTURE-FIRST REPAIR + PREMIUM GRAPHIC OUTCOME CARDS
 * READ-ONLY | NO ORDERS | NO AUTO-COPY | PAPER OUTCOME TRACKING
 * Final LONG/SHORT direction follows a fresh BTC 15m + 1h direction check at candidate time; altcoin structure sets SL/TP
 *
 * Combines three entry families:
 *  1) Liquidity sweep + reclaim
 *  2) Breakout + retest
 *  3) Trend pullback + continuation
 *
 * Data: Hyperliquid public Info API (no paid data API required).
 * All eligible liquid perp markets are considered; the worker does not depend on wallet lists.
 */

const VERSION = 'NOVARA-SMART-MONEY-AI-V2.8.6-LEVEL-PROXIMITY-EARLY-ENTRY';
const CLEAN_START_ID = 'NOVARA-V2.8.6-CLEAN-START-2026-10-27';
const PAPER_MARGIN_USD = Math.max(10, Number(process.env.NOVARA_PAPER_MARGIN_USD || 1000));
const REVERSE_SWEEP_ONLY = false; // BTC live direction is authoritative; prevent any second inversion of SWEEP_RECLAIM.
const API = (process.env.HYPERLIQUID_API_URL || 'https://api.hyperliquid.xyz/info').trim();
const TOKEN = process.env.TELEGRAM_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '';
const LEGACY_CHAT = process.env.TELEGRAM_CHAT_ID || '';
const FREE_CHAT = process.env.NOVARA_FREE_CHAT_ID || process.env.FREE_CHAT_ID || '';
const VIP_CHAT = process.env.NOVARA_VIP_CHAT_ID || process.env.VIP_CHAT_ID || process.env.NOVARA_PREMIUM_CHAT_ID || '';
const STATE_FILE = process.env.NOVARA_SMART_MONEY_STATE_FILE || 'production/state/novara_smart_money_state.json';
const SCAN_GAP_MS = Math.max(200, Number(process.env.NOVARA_SMART_REQUEST_GAP_MS || 300));
const MAX_429_RETRIES = Math.max(0, Math.min(4, Number(process.env.NOVARA_SMART_429_RETRIES || 3))); 
const TIMEOUT_MS = Math.max(3000, Number(process.env.NOVARA_SMART_TIMEOUT_MS || 12000));
// No 24h-volume floor and no fixed market-count cap: evaluate every active Hyperliquid perp market returned by metaAndAssetCtxs.
const MIN_SCORE = Math.max(5.8, Math.min(8.5, Number(process.env.NOVARA_SMART_MIN_SCORE || 6.0)));
const MIN_RR = Math.max(1.5, Number(process.env.NOVARA_SMART_MIN_RR || 1.5));
const BTC_COUNTERTREND_HARD_MOVE_PCT = Math.max(1.0, Number(process.env.NOVARA_BTC_COUNTERTREND_HARD_MOVE_PCT || 2.0));
const BTC_COUNTERTREND_MIN_SCORE = Math.max(MIN_SCORE, Math.min(8.8, Number(process.env.NOVARA_BTC_COUNTERTREND_MIN_SCORE || 7.0)));
const BTC_COUNTERTREND_MIN_EVIDENCE = Math.max(1, Math.min(5, Number(process.env.NOVARA_BTC_COUNTERTREND_MIN_EVIDENCE || 2)));
const STRUCTURE_BUFFER_ATR = Math.max(0.1, Number(process.env.NOVARA_STRUCTURE_BUFFER_ATR || 0.25));
const MAX_SPREAD_PCT = Math.max(0.03, Number(process.env.NOVARA_SMART_MAX_SPREAD_PCT || 0.25));
const MAX_SIGNALS_PER_CYCLE = Math.max(1, Number(process.env.NOVARA_SMART_MAX_SIGNALS_PER_CYCLE || 8));
const TELEGRAM_GAP_MS = Math.max(1000, Number(process.env.NOVARA_TELEGRAM_MIN_GAP_MS || 3200));
const STATE_SCHEMA = 1; // State shape retained; one-time clean-start archives legacy trades before evaluation
const now = () => Date.now();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const n = (v, d = 0) => { const x = Number(v); return Number.isFinite(x) ? x : d; };
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const pct = (x, digits = 2) => `${n(x).toFixed(digits)}%`;
const fmtPrice = x => {
  const v = n(x);
  if (!(v > 0)) return '—';
  if (v >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (v >= 1) return v.toFixed(4);
  if (v >= 0.01) return v.toFixed(6);
  if (v >= 0.0001) return v.toFixed(8);
  return v.toExponential(5);
};

let nextRequestAt = 0;
let requestGate = Promise.resolve();
let globalRateLimitUntil = 0;
const RATE_LIMIT_BASE_MS = Math.max(1000, Number(process.env.NOVARA_SMART_429_BASE_MS || 1500));
const RATE_LIMIT_MAX_MS = Math.max(RATE_LIMIT_BASE_MS, Number(process.env.NOVARA_SMART_429_MAX_MS || 15000));
async function paceRequest() {
  const slot = requestGate.then(async () => {
    const wait = Math.max(0, nextRequestAt - now(), globalRateLimitUntil - now());
    if (wait) await sleep(wait);
    nextRequestAt = now() + SCAN_GAP_MS;
  });
  requestGate = slot.catch(() => {});
  await slot;
}
async function request(body, label = 'info') {
  let lastError;
  for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
    await paceRequest();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      if (res.status === 429) {
        const retryAfterHeader = Number(res.headers.get('retry-after'));
        const serverDelay = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
          ? retryAfterHeader * 1000 : 0;
        const exponential = Math.min(RATE_LIMIT_MAX_MS, RATE_LIMIT_BASE_MS * (2 ** attempt));
        const jitter = Math.floor(Math.random() * Math.min(750, exponential * 0.2));
        const delay = Math.min(RATE_LIMIT_MAX_MS, Math.max(serverDelay, exponential) + jitter);
        globalRateLimitUntil = Math.max(globalRateLimitUntil, now() + delay);
        nextRequestAt = Math.max(nextRequestAt, globalRateLimitUntil);
        lastError = new Error(`${label}: HTTP 429 ${text.slice(0, 160)}`);
        if (attempt < MAX_429_RETRIES) {
          console.warn(`[API][429] ${label}: retry ${attempt + 1}/${MAX_429_RETRIES} after ${delay}ms (global cooldown)`);
          continue;
        }
        console.error(`[API][429][EXHAUSTED] ${label}: retries exhausted; request marked unavailable`);
        throw lastError;
      }
      if (!res.ok) throw new Error(`${label}: HTTP ${res.status} ${text.slice(0, 160)}`);
      try { return JSON.parse(text); } catch { throw new Error(`${label}: invalid JSON`); }
    } catch (error) {
      lastError = error;
      if (String(error?.message || error).includes('HTTP 429')) {
        if (attempt >= MAX_429_RETRIES) throw error;
        continue;
      }
      throw error;
    } finally { clearTimeout(timer); }
  }
  throw lastError || new Error(`${label}: request failed`);
}

async function readState() {
  try {
    const parsed = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
    if (parsed?.schema === STATE_SCHEMA) return parsed;
  } catch {}
  return {
    schema: STATE_SCHEMA,
    version: VERSION,
    lastRunAt: 0,
    previousMarketContext: {},
    alertHistory: {},
    dailyFreeCount: {},
    paperTrades: [],
    dailyStats: {},
    lastStatusAt: 0,
    lastDailyReportAt: 0,
  };
}
async function writeState(state) {
  await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
  const tmp = `${STATE_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2) + '\n');
  await fs.rename(tmp, STATE_FILE);
}

function ema(values, period) {
  if (!values.length) return 0;
  const k = 2 / (period + 1);
  let out = values[0];
  for (let i = 1; i < values.length; i++) out = values[i] * k + out * (1 - k);
  return out;
}
function mean(values) { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0; }
function median(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function parseCandle(c) {
  return { t: n(c.t), T: n(c.T), o: n(c.o), h: n(c.h), l: n(c.l), c: n(c.c), v: n(c.v), n: n(c.n) };
}
function completedCandles(raw, intervalMs) {
  const currentTime = now();
  return (Array.isArray(raw) ? raw : []).map(parseCandle)
    .filter(c => c.t > 0 && c.c > 0 && (c.T ? c.T < currentTime : c.t + intervalMs <= currentTime))
    .sort((a, b) => a.t - b.t);
}
function atr(candles, period = 14) {
  if (candles.length < 2) return 0;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    trs.push(Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c)));
  }
  return mean(trs.slice(-period));
}
function pivots(candles, left = 2, right = 2) {
  const highs = [], lows = [];
  for (let i = left; i < candles.length - right; i++) {
    const c = candles[i];
    if (candles.slice(i - left, i).every(x => c.h > x.h) && candles.slice(i + 1, i + right + 1).every(x => c.h >= x.h)) highs.push({ price: c.h, index: i });
    if (candles.slice(i - left, i).every(x => c.l < x.l) && candles.slice(i + 1, i + right + 1).every(x => c.l <= x.l)) lows.push({ price: c.l, index: i });
  }
  return { highs, lows };
}
function nearestBelow(levels, price) { return levels.filter(x => x.price < price).sort((a, b) => b.price - a.price)[0]?.price || 0; }
function nearestAbove(levels, price) { return levels.filter(x => x.price > price).sort((a, b) => a.price - b.price)[0]?.price || 0; }
function volumeRatio(candles) {
  const recent = candles.at(-1)?.v || 0;
  const base = mean(candles.slice(-21, -1).map(c => c.v));
  return base > 0 ? recent / base : 1;
}
function vwap(candles) {
  const rows = candles.slice(-32);
  const denom = rows.reduce((s, c) => s + c.v, 0);
  return denom > 0 ? rows.reduce((s, c) => s + ((c.h + c.l + c.c) / 3) * c.v, 0) / denom : rows.at(-1)?.c || 0;
}
function rsi(candles, period = 14) {
  const closes = candles.map(c => c.c).filter(x => x > 0);
  if (closes.length <= period) return 50;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) avgGain += change; else avgLoss -= change;
  }
  avgGain /= period;
  avgLoss /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = Math.max(0, change), loss = Math.max(0, -change);
    avgGain = ((avgGain * (period - 1)) + gain) / period;
    avgLoss = ((avgLoss * (period - 1)) + loss) / period;
  }
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}
function fibonacciConfluence(candles, price, tolerancePct) {
  const rows = candles.slice(-48);
  if (rows.length < 20 || !(price > 0)) return { confluence: false, level: 0, distancePct: null };
  const high = Math.max(...rows.map(c => c.h));
  const low = Math.min(...rows.map(c => c.l));
  const range = high - low;
  if (!(range > 0)) return { confluence: false, level: 0, distancePct: null };
  const levels = [0.382, 0.5, 0.618].flatMap(r => [high - range * r, low + range * r]);
  const nearest = levels.map(level => ({ level, distancePct: Math.abs(price - level) / price * 100 }))
    .sort((a, b) => a.distancePct - b.distancePct)[0];
  return { confluence: nearest.distancePct <= tolerancePct, level: nearest.level, distancePct: nearest.distancePct };
}
function marketRegime(candles, barsPer24h = 6, timeframe = '4H') {
  const needed = Math.max(60, barsPer24h + 5);
  if (!Array.isArray(candles) || candles.length < needed) {
    return { timeframe, status: 'UNAVAILABLE', trend: 'UNAVAILABLE', change24hPct: null, label: 'UNAVAILABLE', candles: Array.isArray(candles) ? candles.length : 0 };
  }
  const trend = trendBias(candles);
  const last = candles.at(-1)?.c || 0;
  const base = candles.at(-(barsPer24h + 1))?.c || last;
  if (!(last > 0 && base > 0)) return { timeframe, status: 'UNAVAILABLE', trend: 'UNAVAILABLE', change24hPct: null, label: 'UNAVAILABLE', candles: candles.length };
  const change24hPct = (last - base) / base * 100;
  let label = trend === 'LONG' ? 'BULLISH' : trend === 'SHORT' ? 'BEARISH' : 'NEUTRAL';
  if (change24hPct <= -2.5) label = 'BEARISH';
  else if (change24hPct >= 2.5) label = 'BULLISH';
  return { timeframe, status: 'OK', trend, change24hPct, label, candles: candles.length };
}
function trendBias(candles) {
  const closes = candles.map(c => c.c);
  const fast = ema(closes.slice(-60), 20);
  const slow = ema(closes.slice(-100), 50);
  const last = closes.at(-1) || 0;
  const prev = closes.at(-5) || last;
  if (last > fast && fast > slow && last >= prev) return 'LONG';
  if (last < fast && fast < slow && last <= prev) return 'SHORT';
  return 'NEUTRAL';
}
function spreadPct(book, mid) {
  const bids = book?.levels?.[0] || [], asks = book?.levels?.[1] || [];
  if (!bids.length || !asks.length || !(mid > 0)) return null;
  return ((n(asks[0].px) - n(bids[0].px)) / mid) * 100;
}
function bookImbalance(book) {
  const bids = (book?.levels?.[0] || []).slice(0, 10).reduce((s, x) => s + n(x.sz) * n(x.px), 0);
  const asks = (book?.levels?.[1] || []).slice(0, 10).reduce((s, x) => s + n(x.sz) * n(x.px), 0);
  const total = bids + asks;
  return total > 0 ? (bids - asks) / total : 0;
}
function tradeDelta(trades) {
  let buy = 0, sell = 0;
  for (const t of Array.isArray(trades) ? trades : []) {
    const usd = Math.abs(n(t.sz) * n(t.px));
    if (String(t.side).toUpperCase() === 'B') buy += usd;
    else if (String(t.side).toUpperCase() === 'A') sell += usd;
  }
  const total = buy + sell;
  return { buy, sell, delta: total ? (buy - sell) / total : 0, total };
}

function detectPatterns({ coin, c15, c1h, ctx, prevCtx, mid, spread, imbalance, flow, btcRegime }) {
  const last = c15.at(-1), prev = c15.at(-2);
  if (!last || !prev || c15.length < 35 || c1h.length < 30) return [];
  const atr15 = atr(c15, 14) || mid * 0.006;
  const atrPct = atr15 / mid * 100;
  // V2.3: structural SL/TP levels come ONLY from completed 1H candles.
  // 15m candles are reserved for entry timing, momentum, VWAP and RSI.
  const levels1h = pivots(c1h.slice(-90));
  const atr1h = atr(c1h, 14) || mid * 0.01;
  const pivotLows1h = levels1h.lows.map(x => ({ ...x, tf: '1h', source: '1h-pivot' }));
  const pivotHighs1h = levels1h.highs.map(x => ({ ...x, tf: '1h', source: '1h-pivot' }));
  const minLevelGap = Math.max(atr1h * 0.20, mid * 0.0020);
  const rawSupport = nearestBelow(pivotLows1h, mid);
  const rawResistance = nearestAbove(pivotHighs1h, mid);

  // Candidate levels: confirmed 1H pivots plus completed 1H range extremes.
  // Never allow a 15m pivot/range to become the structural SL/TP anchor.
  const rangeLows1h = [
    { candles: c1h.slice(-20), source: '1h-range-low-20' },
    { candles: c1h.slice(-40), source: '1h-range-low-40' },
    { candles: c1h.slice(-72), source: '1h-range-low-72' },
  ].filter(x => x.candles.length >= 10).map(x => ({ price: Math.min(...x.candles.map(c => c.l)), index: x.candles.length - 1, tf: '1h', source: x.source }));
  const rangeHighs1h = [
    { candles: c1h.slice(-20), source: '1h-range-high-20' },
    { candles: c1h.slice(-40), source: '1h-range-high-40' },
    { candles: c1h.slice(-72), source: '1h-range-high-72' },
  ].filter(x => x.candles.length >= 10).map(x => ({ price: Math.max(...x.candles.map(c => c.h)), index: x.candles.length - 1, tf: '1h', source: x.source }));
  const allLows1h = [...pivotLows1h, ...rangeLows1h];
  const allHighs1h = [...pivotHighs1h, ...rangeHighs1h];
  // Use confirmed 1H levels only, and require repeated reactions near each level.
  // Count touches across completed 1H candles; a single pivot/range extreme is not enough.
  const touchTolerance = Math.max(atr1h * 0.30, mid * 0.0020);
  const countTouches = (price, kind) => {
    const rows = c1h.slice(-90);
    const hitIndices = [];
    rows.forEach((c, i) => {
      if (Math.abs((kind === 'support' ? c.l : c.h) - price) <= touchTolerance) hitIndices.push(i);
    });
    // Count separate reaction episodes, not several adjacent candles in one visit.
    let episodes = 0, lastTouch = -999;
    for (const i of hitIndices) {
      if (i - lastTouch >= 3) { episodes++; lastTouch = i; }
    }
    return episodes;
  };
  const supportCandidates = allLows1h
    .filter(x => x.price > 0 && x.price < mid && mid - x.price >= minLevelGap)
    .map(x => ({ ...x, touches: countTouches(x.price, 'support') }))
    .filter(x => x.touches >= 2);
  const resistanceCandidates = allHighs1h
    .filter(x => x.price > mid && x.price - mid >= minLevelGap)
    .map(x => ({ ...x, touches: countTouches(x.price, 'resistance') }))
    .filter(x => x.touches >= 2);
  const chooseLevel = levels => {
    if (!levels.length) return null;
    const ranked = levels.map(level => ({
      ...level,
      distance: Math.abs(level.price - mid),
      confluence: levels.filter(other => other !== level && Math.abs(other.price - level.price) / mid <= 0.0025).length,
    }));
    // Prefer confluence among nearby 1H levels, but do not select a materially
    // farther level solely for confluence. Price distance is the primary rank.
    ranked.sort((a, b) => a.distance - b.distance);
    const nearest = ranked[0];
    const nearTies = ranked.filter(x => x.distance <= nearest.distance + mid * 0.0015);
    nearTies.sort((a, b) => (b.confluence - a.confluence) || a.distance - b.distance);
    return nearTies[0];
  };
  const selectedSupport = chooseLevel(supportCandidates);
  const selectedResistance = chooseLevel(resistanceCandidates);
  const support = selectedSupport?.price || 0;
  const resistance = selectedResistance?.price || 0;
  const supportSource = selectedSupport?.source || 'missing-1h-structure';
  const resistanceSource = selectedResistance?.source || 'missing-1h-structure';
  const trend = trendBias(c1h);
  const volRatio = volumeRatio(c15);
  const vwap15 = vwap(c15);
  const rsi15 = rsi(c15, 14);
  const fib = fibonacciConfluence(c1h, mid, Math.max(0.35, atrPct * 0.35));
  const oiNow = n(ctx?.openInterest);
  const oiPrev = n(prevCtx?.openInterest);
  const oiChange = oiPrev > 0 ? (oiNow - oiPrev) / oiPrev * 100 : 0;
  const funding = n(ctx?.funding);
  const fundingPct = funding * 100;
  const bullishFlow = flow.delta > 0.08 || imbalance > 0.12;
  const bearishFlow = flow.delta < -0.08 || imbalance < -0.12;
  const oiConfirmsLong = oiChange > 0.25 && mid >= last.o;
  const oiConfirmsShort = oiChange > 0.25 && mid <= last.o;
  const results = [];
  const addContext = (side, score, reasons) => {
    if (fib.confluence) { score += 0.25; reasons.push(`1H Fibonacci confluence (${fib.level.toPrecision(6)})`); }
    if (side === 'LONG' && rsi15 >= 72 || side === 'SHORT' && rsi15 <= 28) {
      score -= 0.45; reasons.push(`15m RSI stretched (${rsi15.toFixed(1)})`);
    } else if (side === 'LONG' && rsi15 >= 45 && rsi15 <= 68 || side === 'SHORT' && rsi15 >= 32 && rsi15 <= 55) {
      score += 0.15; reasons.push(`15m RSI supports entry (${rsi15.toFixed(1)})`);
    }
    const btcLabel = btcRegime?.label || 'NEUTRAL';
    const btcOpposes = side === 'LONG' && btcLabel === 'BEARISH' || side === 'SHORT' && btcLabel === 'BULLISH';
    const btcAligns = side === 'LONG' && btcLabel === 'BULLISH' || side === 'SHORT' && btcLabel === 'BEARISH';
    if (btcOpposes) {
      // Adaptive context penalty: a weak/flat BTC regime should not veto a strong
      // altcoin setup. Reserve the strongest penalty for an actual BTC impulse.
      const btcMoveAbs = Math.abs(n(btcRegime?.change24hPct));
      const btcPenalty = btcMoveAbs >= 2.5 ? 0.85 : btcMoveAbs >= BTC_COUNTERTREND_HARD_MOVE_PCT ? 0.45 : 0.15;
      score -= btcPenalty;
      reasons.push(`BTC 4H regime opposes ${side} (${btcLabel}; ${btcMoveAbs.toFixed(2)}%/24h, score penalty -${btcPenalty.toFixed(2)})`);
    } else if (btcAligns) { score += 0.20; reasons.push(`BTC 4H regime aligns (${btcLabel})`); }
    // Shorter BTC timeframes refine (but never independently veto) the 4H context.
    for (const tf of ['1H', '15m']) {
      const shortRegime = btcRegime?.timeframes?.[tf];
      if (shortRegime?.status !== 'OK') continue;
      const aligned = (side === 'LONG' && shortRegime.trend === 'LONG') || (side === 'SHORT' && shortRegime.trend === 'SHORT');
      const opposed = (side === 'LONG' && shortRegime.trend === 'SHORT') || (side === 'SHORT' && shortRegime.trend === 'LONG');
      if (aligned) { score += 0.10; reasons.push(`BTC ${tf} trend confirms ${side} (+0.10)`); }
      else if (opposed) { score -= 0.15; reasons.push(`BTC ${tf} trend conflicts with ${side} (-0.15)`); }
    }
    return score;
  };

  // Pattern 1: sweep a recent swing level, then reclaim it on a completed candle.
  const priorLow = Math.min(...c15.slice(-10, -1).map(c => c.l));
  const priorHigh = Math.max(...c15.slice(-10, -1).map(c => c.h));
  const sweepLong = last.l < priorLow && last.c > priorLow && last.c > last.o;
  const sweepShort = last.h > priorHigh && last.c < priorHigh && last.c < last.o;
  if (sweepLong || sweepShort) {
    const side = sweepLong ? 'LONG' : 'SHORT';
    let score = 5.0;
    const reasons = ['Liquidity sweep + reclaim'];
    if (side === 'LONG' && bullishFlow || side === 'SHORT' && bearishFlow) { score += 0.9; reasons.push('order-flow supports reversal'); }
    if (volRatio >= 1.15) { score += 0.45; reasons.push('relative volume expansion'); }
    if (side === 'LONG' && trend === 'LONG' || side === 'SHORT' && trend === 'SHORT') { score += 0.4; reasons.push('aligned 1H trend'); }
    if (side === 'LONG' && oiConfirmsLong || side === 'SHORT' && oiConfirmsShort) { score += 0.25; reasons.push('OI rising with directional move'); }
    if (side === 'LONG' && fundingPct < 0.035 || side === 'SHORT' && fundingPct > -0.035) score += 0.15;
    if (spread !== null && spread > MAX_SPREAD_PCT) score -= 1.5;
    score = addContext(side, score, reasons);
    results.push({ coin, side, pattern: 'SWEEP_RECLAIM', rawSupport, rawResistance, minLevelGap, score: clamp(score, 0, 9.5), reasons, entry: mid, atr: atr15, atr1h, support, resistance, supportSource, resistanceSource, supportTouches: selectedSupport?.touches || 0, resistanceTouches: selectedResistance?.touches || 0, supportLevels: supportCandidates.map(x => ({ price: x.price, touches: x.touches, source: x.source })), resistanceLevels: resistanceCandidates.map(x => ({ price: x.price, touches: x.touches, source: x.source })), trend, btcRegime: btcRegime || { label: 'NEUTRAL', change24hPct: 0 }, rsi15, fibConfluence: fib.confluence, volRatio, oiChange, fundingPct, flowDelta: flow.delta, imbalance, vwap: vwap15, spreadPct: spread, atrPct, dayVolume: n(ctx?.dayVolume), maxLeverage: n(ctx?.maxLeverage) });
  }

  // Pattern 2: close beyond a recent structure level, then retest within tolerance.
  const breakoutHigh = Math.max(...c15.slice(-14, -2).map(c => c.h));
  const breakoutLow = Math.min(...c15.slice(-14, -2).map(c => c.l));
  const tolerance = Math.max(atr15 * 0.25, mid * 0.0015);
  const retestLong = prev.c > breakoutHigh && last.l <= breakoutHigh + tolerance && last.c >= breakoutHigh && last.c > last.o;
  const retestShort = prev.c < breakoutLow && last.h >= breakoutLow - tolerance && last.c <= breakoutLow && last.c < last.o;
  if (retestLong || retestShort) {
    const side = retestLong ? 'LONG' : 'SHORT';
    let score = 5.05;
    const reasons = ['Breakout + retest'];
    if (side === 'LONG' && bullishFlow || side === 'SHORT' && bearishFlow) { score += 0.7; reasons.push('order-flow confirms continuation'); }
    if (volRatio >= 1.1) { score += 0.45; reasons.push('volume supports level break'); }
    if (side === 'LONG' && trend === 'LONG' || side === 'SHORT' && trend === 'SHORT') { score += 0.65; reasons.push('aligned 1H trend'); }
    if (side === 'LONG' && mid >= vwap15 || side === 'SHORT' && mid <= vwap15) { score += 0.25; reasons.push('VWAP alignment'); }
    if (side === 'LONG' && oiConfirmsLong || side === 'SHORT' && oiConfirmsShort) { score += 0.3; reasons.push('OI confirms participation'); }
    if (spread !== null && spread > MAX_SPREAD_PCT) score -= 1.5;
    score = addContext(side, score, reasons);
    results.push({ coin, side, pattern: 'BREAKOUT_RETEST', rawSupport, rawResistance, minLevelGap, score: clamp(score, 0, 9.5), reasons, entry: mid, atr: atr15, atr1h, support, resistance, supportSource, resistanceSource, supportTouches: selectedSupport?.touches || 0, resistanceTouches: selectedResistance?.touches || 0, supportLevels: supportCandidates.map(x => ({ price: x.price, touches: x.touches, source: x.source })), resistanceLevels: resistanceCandidates.map(x => ({ price: x.price, touches: x.touches, source: x.source })), trend, btcRegime: btcRegime || { label: 'NEUTRAL', change24hPct: 0 }, rsi15, fibConfluence: fib.confluence, volRatio, oiChange, fundingPct, flowDelta: flow.delta, imbalance, vwap: vwap15, spreadPct: spread, atrPct, dayVolume: n(ctx?.dayVolume), maxLeverage: n(ctx?.maxLeverage) });
  }

  // Pattern 3: 1H trend with a 15m pullback into fast mean and a directional recovery candle.
  const ema20_15 = ema(c15.slice(-60).map(c => c.c), 20);
  const pullbackLong = trend === 'LONG' && last.l <= ema20_15 + atr15 * 0.25 && last.c > ema20_15 && last.c > last.o && last.c > prev.c;
  const pullbackShort = trend === 'SHORT' && last.h >= ema20_15 - atr15 * 0.25 && last.c < ema20_15 && last.c < last.o && last.c < prev.c;
  if (pullbackLong || pullbackShort) {
    const side = pullbackLong ? 'LONG' : 'SHORT';
    let score = 4.95;
    const reasons = ['Trend pullback + continuation'];
    if (side === 'LONG' && bullishFlow || side === 'SHORT' && bearishFlow) { score += 0.75; reasons.push('order-flow resumes with trend'); }
    if (volRatio >= 0.9) { score += 0.25; reasons.push('participation present'); }
    if (side === 'LONG' && mid >= vwap15 || side === 'SHORT' && mid <= vwap15) { score += 0.4; reasons.push('VWAP alignment'); }
    if (side === 'LONG' && oiConfirmsLong || side === 'SHORT' && oiConfirmsShort) { score += 0.3; reasons.push('OI rising with trend'); }
    if (side === 'LONG' && fundingPct > 0.08 || side === 'SHORT' && fundingPct < -0.08) { score -= 0.25; reasons.push('crowded funding slightly penalized'); }
    if (spread !== null && spread > MAX_SPREAD_PCT) score -= 1.5;
    score = addContext(side, score, reasons);
    results.push({ coin, side, pattern: 'TREND_PULLBACK', rawSupport, rawResistance, minLevelGap, score: clamp(score, 0, 9.5), reasons, entry: mid, atr: atr15, atr1h, support, resistance, supportSource, resistanceSource, supportTouches: selectedSupport?.touches || 0, resistanceTouches: selectedResistance?.touches || 0, supportLevels: supportCandidates.map(x => ({ price: x.price, touches: x.touches, source: x.source })), resistanceLevels: resistanceCandidates.map(x => ({ price: x.price, touches: x.touches, source: x.source })), trend, btcRegime: btcRegime || { label: 'NEUTRAL', change24hPct: 0 }, rsi15, fibConfluence: fib.confluence, volRatio, oiChange, fundingPct, flowDelta: flow.delta, imbalance, vwap: vwap15, spreadPct: spread, atrPct, dayVolume: n(ctx?.dayVolume), maxLeverage: n(ctx?.maxLeverage) });
  }

  // V2.8.6: attach location/rejection diagnostics. A directional pattern alone
  // is not enough: entries must occur near the relevant 1H boundary and show
  // a completed 15m rejection/reclaim, rather than chasing the middle of a range.
  const upperWick = last.h - Math.max(last.o, last.c);
  const lowerWick = Math.min(last.o, last.c) - last.l;
  for (const candidate of results) {
    const level = candidate.side === 'SHORT' ? resistance : support;
    const distPct = level > 0 ? Math.abs(mid - level) / mid * 100 : Infinity;
    const atr1hPct = atr1h / mid * 100;
    candidate.entryLevel = level;
    candidate.entryLevelDistancePct = distPct;
    candidate.entryProximityMaxPct = Math.min(1.0, Math.max(0.35, atr1hPct * 0.70));
    candidate.entryReactionConfirmed = candidate.side === 'SHORT'
      ? (level > 0 && last.c < level && last.c < last.o && upperWick >= Math.max(atr15 * 0.10, mid * 0.0005))
      : (level > 0 && last.c > level && last.c > last.o && lowerWick >= Math.max(atr15 * 0.10, mid * 0.0005));
  }
  return results;
}

function buildRisk(candidate) {
  const entry = n(candidate.entry);
  const atrValue = n(candidate.atr);
  if (!(entry > 0) || !(atrValue > 0) || !['LONG', 'SHORT'].includes(candidate.side)) {
    return { entry, sl: 0, tp: 0, riskPct: 0, rewardPct: 0, rr: 0, valid: false, reason: 'invalid entry/side/ATR' };
  }

  // V2.8.6: choose among all confirmed multi-touch 1H levels instead of forcing
  // one nearest level to serve both risk and target. This avoids SL buffers pushing
  // a TP through entry, and avoids rejecting a valid farther structural level.
  const atr1h = n(candidate.atr1h, atrValue * 4);
  const buffer = Math.max(atr1h * 0.22, atrValue * 0.20, entry * 0.0015);
  const minRisk = Math.max(entry * 0.0050, atr1h * 0.35);
  // Allow genuine 1H structure to define a wider stop, but never accept an
  // unbounded stop; require a valid R:R after choosing the level combination.
  const maxRisk = entry * 0.05;
  const fallbackSupport = n(candidate.support) > 0 ? [{ price: n(candidate.support), touches: n(candidate.supportTouches), source: candidate.supportSource || 'selected-1h-level' }] : [];
  const fallbackResistance = n(candidate.resistance) > 0 ? [{ price: n(candidate.resistance), touches: n(candidate.resistanceTouches), source: candidate.resistanceSource || 'selected-1h-level' }] : [];
  const supports = (Array.isArray(candidate.supportLevels) && candidate.supportLevels.length ? candidate.supportLevels : fallbackSupport)
    .filter(x => n(x.price) > 0 && n(x.price) < entry && n(x.touches, 2) >= 2)
    .map(x => ({ ...x, price: n(x.price), stop: n(x.price) - buffer }))
    .filter(x => x.stop > 0 && entry - x.stop >= minRisk && entry - x.stop <= maxRisk)
    .sort((a,b) => (entry-a.stop) - (entry-b.stop));
  const resistances = (Array.isArray(candidate.resistanceLevels) && candidate.resistanceLevels.length ? candidate.resistanceLevels : fallbackResistance)
    .filter(x => n(x.price) > entry && n(x.touches, 2) >= 2)
    .map(x => ({ ...x, price: n(x.price), stop: n(x.price) + buffer }))
    .filter(x => x.stop > entry && x.stop-entry >= minRisk && x.stop-entry <= maxRisk)
    .sort((a,b) => (a.stop-entry) - (b.stop-entry));

  const targetResistances = (Array.isArray(candidate.resistanceLevels) && candidate.resistanceLevels.length ? candidate.resistanceLevels : fallbackResistance)
    .filter(x => n(x.price) > entry && n(x.touches, 2) >= 2)
    .map(x => ({ ...x, price: n(x.price), tp: n(x.price) - buffer }))
    .filter(x => x.tp > entry)
    .sort((a,b) => a.price-b.price);
  const targetSupports = (Array.isArray(candidate.supportLevels) && candidate.supportLevels.length ? candidate.supportLevels : fallbackSupport)
    .filter(x => n(x.price) > 0 && n(x.price) < entry && n(x.touches, 2) >= 2)
    .map(x => ({ ...x, price: n(x.price), tp: n(x.price) + buffer }))
    .filter(x => x.tp < entry)
    .sort((a,b) => b.price-a.price);

  if (candidate.side === 'LONG') {
    if (!supports.length) {
      const support = n(candidate.support);
      const sl = support > 0 ? support-buffer : 0;
      const riskDist = entry-sl;
      return { entry, sl, tp: 0, riskPct: riskDist > 0 ? riskDist/entry*100 : 0, rewardPct: 0, rr: 0, valid: false,
        reason: support > 0 ? 'no confirmed 1H support gives a stop within 0.50%-5.00% structural risk bounds' : 'no valid repeated-touch 1H support for long' };
    }
    for (const sup of supports) {
      const riskDist = entry-sup.stop;
      const target = targetResistances.find(r => (r.tp-entry)/riskDist >= MIN_RR);
      if (!target) continue;
      const targetDist = target.tp-entry;
      return { entry, sl: sup.stop, tp: target.tp, riskPct: riskDist/entry*100, rewardPct: targetDist/entry*100,
        rr: targetDist/riskDist, valid: true, targetUsesStructure: true,
        selectedSupport: sup.price, selectedResistance: target.price, supportTouches: sup.touches, resistanceTouches: target.touches };
    }
    const sup=supports[0], nearestTarget=targetResistances[0];
    const riskDist=entry-sup.stop, targetDist=nearestTarget ? nearestTarget.tp-entry : 0;
    return { entry, sl: sup.stop, tp: nearestTarget?.tp || 0, riskPct: riskDist/entry*100, rewardPct: Math.max(0,targetDist)/entry*100,
      rr: riskDist>0 ? targetDist/riskDist : 0, valid: false, reason: 'no overhead repeated-touch 1H resistance provides the required R:R before the resistance zone' };
  }

  if (!resistances.length) {
    const resistance = n(candidate.resistance);
    const sl = resistance > 0 ? resistance+buffer : 0;
    const riskDist = sl-entry;
    return { entry, sl, tp: 0, riskPct: riskDist > 0 ? riskDist/entry*100 : 0, rewardPct: 0, rr: 0, valid: false,
      reason: resistance > 0 ? 'no confirmed 1H resistance gives a stop within 0.50%-5.00% structural risk bounds' : 'no valid repeated-touch 1H resistance for short' };
  }
  for (const res of resistances) {
    const riskDist = res.stop-entry;
    const target = targetSupports.find(s => (entry-s.tp)/riskDist >= MIN_RR);
    if (!target) continue;
    const targetDist = entry-target.tp;
    return { entry, sl: res.stop, tp: target.tp, riskPct: riskDist/entry*100, rewardPct: targetDist/entry*100,
      rr: targetDist/riskDist, valid: true, targetUsesStructure: true,
      selectedSupport: target.price, selectedResistance: res.price, supportTouches: target.touches, resistanceTouches: res.touches };
  }
  const res=resistances[0], nearestTarget=targetSupports[0];
  const riskDist=res.stop-entry, targetDist=nearestTarget ? entry-nearestTarget.tp : 0;
  return { entry, sl: res.stop, tp: nearestTarget?.tp || 0, riskPct: riskDist/entry*100, rewardPct: Math.max(0,targetDist)/entry*100,
    rr: riskDist>0 ? targetDist/riskDist : 0, valid: false, reason: 'no downside repeated-touch 1H support provides the required R:R before the support zone' };
}
function oppositeSide(side) { return side === 'LONG' ? 'SHORT' : side === 'SHORT' ? 'LONG' : side; }
function shouldReverseSignal(s) { return REVERSE_SWEEP_ONLY && s?.pattern === 'SWEEP_RECLAIM'; }
function signalKey(s) { return `${s.coin}|${s.side}|${s.pattern}`; }
function isCooldown(state, s) {
  // A short cross-pattern cooldown prevents repeat alerts for the same coin/side
  // when two pattern families trigger in adjacent runs. The longer per-pattern
  // cooldown remains in place; opposite directions remain independent.
  const globalKey = `${s.coin}|${s.side}|GLOBAL`;
  const globalLast = n(state.alertHistory[globalKey]);
  if (globalLast > 0 && now() - globalLast < 30 * 60_000) return true;
  const lookup = shouldReverseSignal(s) ? `${s.coin}|${oppositeSide(s.side)}|${s.pattern}` : signalKey(s);
  const last = n(state.alertHistory[lookup]);
  return last > 0 && now() - last < 90 * 60_000;
}

function finalSideEvidenceAdjustment(s, originalSide) {
  // The original pattern score includes side-specific evidence. Once live BTC
  // chooses the final side, make a modest, transparent adjustment using the
  // final side's own trend/flow/book/RSI/VWAP evidence rather than carrying the
  // original score forward unchanged. Keep the adjustment bounded so it does
  // not turn into an excessively strict second filter.
  const side = s.side;
  let delta = originalSide === side ? 0 : -0.20;
  const alignedTrend = s.trend === side;
  delta += alignedTrend ? 0.15 : s.trend === oppositeSide(side) ? -0.15 : 0;
  const flow = n(s.flowDelta), book = n(s.imbalance), rsiValue = n(s.rsi15, 50);
  const flowAligned = side === 'LONG' ? flow >= 0.12 : flow <= -0.12;
  const flowOpposed = side === 'LONG' ? flow <= -0.12 : flow >= 0.12;
  const bookAligned = side === 'LONG' ? book >= 0.12 : book <= -0.12;
  const bookOpposed = side === 'LONG' ? book <= -0.12 : book >= 0.12;
  delta += flowAligned ? 0.12 : flowOpposed ? -0.12 : 0;
  delta += bookAligned ? 0.10 : bookOpposed ? -0.10 : 0;
  const rsiAligned = side === 'LONG' ? rsiValue >= 48 && rsiValue <= 70 : rsiValue >= 30 && rsiValue <= 52;
  const rsiStretched = side === 'LONG' ? rsiValue >= 75 : rsiValue <= 25;
  delta += rsiAligned ? 0.08 : rsiStretched ? -0.10 : 0;
  const vwap = n(s.vwap), entry = n(s.entry);
  if (vwap > 0 && entry > 0) {
    const above = entry >= vwap;
    delta += ((side === 'LONG' && above) || (side === 'SHORT' && !above)) ? 0.08 : -0.08;
  }
  return clamp(delta, -0.55, 0.45);
}
function countertrendEvidence(s) {
  // Count independent, observable confirmations rather than relying on a score alone.
  // These are deliberately moderate so strong reversal setups remain possible.
  const checks = [
    ['asset_trend', s.trend === s.side],
    ['directional_trade_flow', s.side === 'LONG' ? n(s.flowDelta) >= 0.12 : n(s.flowDelta) <= -0.12],
    ['directional_order_book', s.side === 'LONG' ? n(s.imbalance) >= 0.15 : n(s.imbalance) <= -0.15],
    ['volume_expansion', n(s.volRatio) >= 1.15],
    ['directional_rsi_momentum', s.side === 'LONG' ? n(s.rsi15, 50) >= 50 && n(s.rsi15, 50) <= 68 : n(s.rsi15, 50) >= 32 && n(s.rsi15, 50) <= 50],
  ];
  return { count: checks.filter(([, ok]) => ok).length, passed: checks.filter(([, ok]) => ok).map(([name]) => name), checks };
}
function btcImpulseOpposes(s) {
  const regime = s.btcRegime || {};
  const move = n(regime.change24hPct);
  const label = regime.label || 'NEUTRAL';
  // A directional BTC move of at least 2% only tightens the opposite side.
  // It does not disable countertrend signals automatically.
  return (s.side === 'LONG' && label === 'BEARISH' && move <= -BTC_COUNTERTREND_HARD_MOVE_PCT) ||
    (s.side === 'SHORT' && label === 'BULLISH' && move >= BTC_COUNTERTREND_HARD_MOVE_PCT);
}
function dayKey(ts = now()) { return new Date(ts).toISOString().slice(0, 10); }
function escapeHtml(s) { return String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'); }
function suggestLeverage(s) {
  // This is a signal annotation only: no orders or account settings are changed.
  // Blend setup quality, coin liquidity and current market confirmation; penalize volatility/crowding.
  const signalStrength = clamp((n(s.score, 5.8) - MIN_SCORE) / Math.max(0.1, 9.5 - MIN_SCORE), 0, 1);
  const vol = Math.max(0, n(s.dayVolume));
  const coinStrength = clamp(Math.log10(Math.max(1, vol / 2_000_000)) / Math.log10(50), 0, 1);
  const alignedTrend = s.trend === s.side ? 1 : 0;
  const btcLabel = s.btcRegime?.label || 'NEUTRAL';
  const btcAlignment = (s.side === 'LONG' && btcLabel === 'BULLISH') || (s.side === 'SHORT' && btcLabel === 'BEARISH') ? 1 :
    ((s.side === 'LONG' && btcLabel === 'BEARISH') || (s.side === 'SHORT' && btcLabel === 'BULLISH') ? 0 : 0.5);
  const alignedFlow = (s.side === 'LONG' && n(s.flowDelta) > 0.08) || (s.side === 'SHORT' && n(s.flowDelta) < -0.08) ? 1 : 0;
  const alignedBook = (s.side === 'LONG' && n(s.imbalance) > 0.12) || (s.side === 'SHORT' && n(s.imbalance) < -0.12) ? 1 : 0;
  const oiConfirm = n(s.oiChange) > 0.25 ? 1 : 0;
  const volumeConfirm = n(s.volRatio) >= 1.1 ? 1 : 0;
  const spread = s.spreadPct == null ? 0.5 : clamp(1 - n(s.spreadPct) / Math.max(0.01, MAX_SPREAD_PCT), 0, 1);
  const atrPct = n(s.atrPct, n(s.atr) / Math.max(0.00000001, n(s.entry)) * 100);
  const volatilitySuitability = atrPct <= 0.9 ? 1 : atrPct <= 1.5 ? 0.75 : atrPct <= 2.0 ? 0.45 : 0.15;
  const fundingCrowded = (s.side === 'LONG' && n(s.fundingPct) > 0.08) || (s.side === 'SHORT' && n(s.fundingPct) < -0.08);
  const marketStrength = clamp(
    alignedTrend * 0.22 + alignedFlow * 0.16 + alignedBook * 0.09 + oiConfirm * 0.11 +
    volumeConfirm * 0.11 + spread * 0.11 + volatilitySuitability * 0.11 + btcAlignment * 0.09 - (fundingCrowded ? 0.10 : 0),
    0, 1
  );
  const combined = signalStrength * 0.40 + coinStrength * 0.25 + marketStrength * 0.35;
  let leverage = Math.round(5 + combined * 10);
  const exchangeMax = n(s.maxLeverage);
  if (exchangeMax > 0) leverage = Math.min(leverage, Math.floor(exchangeMax));
  leverage = Math.max(1, leverage);
  const cappedBelowRequestedRange = exchangeMax > 0 && exchangeMax < 5;
  return { leverage, signalStrength, coinStrength, marketStrength, exchangeMax, cappedBelowRequestedRange };
}

function formatSignal(s, risk) {
  const lev = s.leverageInfo || suggestLeverage(s);
  const emoji = s.side === 'LONG' ? '🟢' : '🔴';
  const reasons = s.reasons.slice(0, 4).map(x => `• ${escapeHtml(x)}`).join('\n');
  const btc = s.btcRegime || {};
  const tfLine = (tf, label) => {
    const r = btc.timeframes?.[tf];
    if (!r || r.status !== 'OK' || !Number.isFinite(Number(r.change24hPct))) return `${tf}: UNAVAILABLE`;
    return `${tf}: ${r.label}/${r.trend} (${Number(r.change24hPct).toFixed(2)}%/24h)`;
  };
  const reversed = false;
  const modeLabel = 'LIVE BTC DIRECTION';
  return `${emoji} <b>NOVARA SMART MONEY AI — LIVE BTC DIRECTION</b>\n🧭 Final direction follows BTC 15m+1H live check; altcoin structure retains SL/TP\n━━━━━━━━━━━━━━━━━━\n<b>${s.side} ${escapeHtml(s.coin)} PERP</b>\n🧭 Setup: ${escapeHtml(s.pattern.replaceAll('_', ' '))}\n📍 Entry (reference): <code>${fmtPrice(risk.entry)}</code>\n🛑 Stop Loss: <code>${fmtPrice(risk.sl)}</code> (${pct(risk.riskPct)})\n🎯 Take Profit: <code>${fmtPrice(risk.tp)}</code> (${pct(risk.rewardPct)})\n⚖️ Planned R:R: 1:${risk.rr.toFixed(2)}\n⚡ Suggested Leverage: ${lev.leverage}x${lev.cappedBelowRequestedRange ? ` (exchange max: ${Math.floor(lev.exchangeMax)}x)` : ''}\n🧠 Setup score: ${s.score.toFixed(2)}/10 (not a win-probability estimate)\n📊 Asset 1H trend: ${s.trend}\n₿ <b>BTC MARKET CHECK</b>\n${tfLine('4H', '4H')}\n${tfLine('1H', '1H')}\n${tfLine('15m', '15m')}\n📉 Alt 15m RSI: ${n(s.rsi15, 50).toFixed(1)} | Fib: ${s.fibConfluence ? 'YES' : 'NO'} | Volume: ${s.volRatio.toFixed(2)}x\n🌊 Trade delta: ${(s.flowDelta * 100).toFixed(1)}% | Book imbalance: ${(s.imbalance * 100).toFixed(1)}%\n📈 OI change: ${s.oiChange >= 0 ? '+' : ''}${s.oiChange.toFixed(2)}% | Funding: ${s.fundingPct.toFixed(4)}%\n🧱 1H Structure: Support ${fmtPrice(s.support)} (${s.supportTouches || 0} touches) | Resistance ${fmtPrice(s.resistance)} (${s.resistanceTouches || 0} touches)\n🧩 Evidence:\n${reasons}\n\n🧪 Mode: ${modeLabel}. Paper tracking only — no real orders.`;
}

let telegramNextAt = 0;
async function sendTelegram(chatId, message) {
  if (!TOKEN || !chatId) return { sent: false, reason: !TOKEN ? 'telegram_token_not_configured' : 'telegram_chat_not_configured' };
  const wait = Math.max(0, telegramNextAt - now());
  if (wait) await sleep(wait);
  telegramNextAt = now() + TELEGRAM_GAP_MS;
  const response = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  const raw = await response.text();
  let data = {}; try { data = JSON.parse(raw); } catch {}
  if (!response.ok || !data.ok) throw new Error(`Telegram ${response.status}: ${raw.slice(0, 180)}`);
  return { sent: true };
}
function audienceForScore(score) {
  return n(score) >= MIN_SCORE ? 'BOTH' : 'NONE';
}
function audienceForTrade(trade) {
  if (trade.audience === 'FREE' || trade.audience === 'VIP' || trade.audience === 'LEGACY' || trade.audience === 'BOTH') return trade.audience;
  // Backward compatibility for paper trades recorded before score-based routing existed.
  return audienceForScore(trade.score);
}
function configuredAudience(name) {
  if (name === 'VIP') {
    if (VIP_CHAT) return { name: 'VIP', id: VIP_CHAT, viaLegacy: false };
    // Backward-compatible fallback: TELEGRAM_CHAT_ID remains a usable primary
    // destination even when a FREE chat is also configured.
    if (LEGACY_CHAT) return { name: 'VIP', id: LEGACY_CHAT, viaLegacy: true };
    return null;
  }
  if (name === 'FREE' && FREE_CHAT) return { name: 'FREE', id: FREE_CHAT, viaLegacy: false };
  if (name === 'LEGACY' && !VIP_CHAT && LEGACY_CHAT) return { name: 'LEGACY', id: LEGACY_CHAT, viaLegacy: true };
  return null;
}
async function sendSignalToAudience(state, message, audience) {
  const results = [];
  const names = audience === 'BOTH' ? ['VIP', 'FREE'] : [audience];
  for (const name of names) {
    const destination = configuredAudience(name);
    if (!destination) {
      results.push({ name, sent: false, reason: `${name.toLowerCase()}_chat_not_configured` });
      continue;
    }
    try { results.push({ name, ...(await sendTelegram(destination.id, message)) }); }
    catch (e) { results.push({ name, sent: false, reason: e.message }); }
  }
  return results;
}

// Outcome updates and 24-hour performance reports are broadcast to both configured channels.
async function sendUpdateToAudience(message, audience, alreadySent = [], trade = null) {
  const names = audience === 'BOTH' ? ['VIP', 'FREE'] : [audience];
  const results = [];
  for (const name of names) {
    const destination = configuredAudience(name);
    if (!destination || alreadySent.includes(name)) continue;
    try {
      if (trade && ['TP','SL'].includes(trade.status)) results.push({ name, ...(await sendOutcomePhoto(destination.id, trade)) });
      else results.push({ name, ...(await sendTelegram(destination.id, message)) });
    } catch (e) { results.push({ name, sent: false, reason: e.message }); }
  }
  return results;
}

async function sendOutcomePhoto(chatId, trade) {
  if (!TOKEN || !chatId) return { sent: false, reason: !TOKEN ? 'telegram_token_not_configured' : 'telegram_chat_not_configured' };
  const isTp = trade.status === 'TP';
  const long = String(trade.side || 'LONG').toUpperCase() === 'LONG';
  const lev = Math.max(1, n(trade.suggestedLeverage, 1));
  const margin = Math.max(10, n(trade.paperMarginUsd, PAPER_MARGIN_USD));
  const entry = n(trade.entry), exit = isTp ? n(trade.tp) : n(trade.sl);
  const movePct = entry > 0 ? ((exit-entry)/entry)*100*(long?1:-1) : 0;
  const pnl = Math.max(-margin, margin*lev*movePct/100);
  const payload = { status: trade.status, side: trade.side, coin: trade.coin, leverage: lev, margin,
    notional: margin*lev, entryText: fmtPrice(trade.entry), tpText: fmtPrice(trade.tp), slText: fmtPrice(trade.sl),
    exitText: fmtPrice(exit), movePct, pnl, pnlPct: margin ? pnl/margin*100 : 0,
    duration: (()=>{const m=Math.max(0,Math.round((n(trade.closedAt)-n(trade.openedAt))/60000));return m>=60?`${Math.floor(m/60)}H ${m%60}M`:`${m}M`;})(),
    pattern: trade.pattern || '', strategy: trade.strategyVersion || VERSION };
  const temp = path.join(os.tmpdir(), `novara-outcome-${process.pid}-${now()}.png`);
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'novara_outcome_card.py');
  const run = (cmd, args, input) => new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['pipe','ignore','pipe'] }); let err='';
    child.stderr.on('data', d => err += d.toString()); child.on('error', reject);
    child.on('close', code => code===0 ? resolve() : reject(new Error(`${cmd} exited ${code}: ${err.slice(-400)}`)));
    child.stdin.end(input);
  });
  try {
    try { await run(process.env.PYTHON || 'python3', ['-c', 'from PIL import Image'], ''); }
    catch { await run(process.env.PYTHON || 'python3', ['-m','pip','install','--user','Pillow'], ''); }
    await run(process.env.PYTHON || 'python3', [script, temp], JSON.stringify(payload));
    const bytes = await fs.readFile(temp);
    const form = new FormData(); form.append('chat_id', chatId); form.append('caption', `${trade.status==='TP'?'🟢 TAKE PROFIT':'🔴 STOP LOSS'} • ${trade.side} ${trade.coin} • PAPER TRADING — no real order was placed.`);
    form.append('photo', new Blob([bytes], { type: 'image/png' }), 'novara-outcome.png');
    const wait = Math.max(0, telegramNextAt-now()); if (wait) await sleep(wait); telegramNextAt = now()+TELEGRAM_GAP_MS;
    const response = await fetch(`https://api.telegram.org/bot${TOKEN}/sendPhoto`, { method:'POST', body:form });
    const raw = await response.text(); let data={}; try { data=JSON.parse(raw); } catch {}
    if (!response.ok || !data.ok) throw new Error(`Telegram sendPhoto ${response.status}: ${raw.slice(0,180)}`);
    return { sent:true, type:'photo' };
  } finally { try { await fs.unlink(temp); } catch {} }
}

function reportAudiences() {
  const names = [];
  if (FREE_CHAT) names.push('FREE');
  if (VIP_CHAT || LEGACY_CHAT) names.push('VIP');
  return names;
}

function candleHit(trade, candle) {
  const hitSL = trade.side === 'LONG' ? candle.l <= trade.sl : candle.h >= trade.sl;
  const hitTP = trade.side === 'LONG' ? candle.h >= trade.tp : candle.l <= trade.tp;
  if (hitSL && hitTP) return 'AMBIGUOUS';
  if (hitSL) return 'SL';
  if (hitTP) return 'TP';
  return null;
}

async function updatePaperTrades(state, contexts) {
  const closed = [];
  const openTrades = state.paperTrades.filter(t => t.status === 'OPEN');
  const byCoin = new Map();
  for (const trade of openTrades) {
    if (!byCoin.has(trade.coin)) byCoin.set(trade.coin, []);
    byCoin.get(trade.coin).push(trade);
  }

  // Check completed 1-minute candles for touches between five-minute scans. Current mark is a fallback.
  const candlesByCoin = new Map();
  for (const [coin, trades] of byCoin) {
    const oldest = Math.min(...trades.map(t => n(t.lastCheckedAt, n(t.openedAt))));
    const startTime = Math.max(now() - 6 * 3600_000, Math.floor(oldest / 60_000) * 60_000);
    try {
      const raw = await request({ type: 'candleSnapshot', req: { coin, interval: '1m', startTime, endTime: now() } }, `exit candles ${coin}`);
      const bars = (Array.isArray(raw) ? raw : []).map(parseCandle).filter(c => c.t > 0 && c.c > 0 && c.T < now()).sort((a,b) => a.t-b.t);
      candlesByCoin.set(coin, { bars, ok: true });
    } catch (e) {
      console.warn(`[OUTCOME][WARN] ${coin}: ${e?.message || e}`);
      candlesByCoin.set(coin, { bars: [], ok: false });
    }
  }

  for (const trade of openTrades) {
    const mark = n(contexts[trade.coin]?.markPx);
    const candleSet = candlesByCoin.get(trade.coin) || { bars: [], ok: false };
    let result = null, exitMark = 0, hitAt = 0, exitDetection = null;
    const lastCheckedAt = n(trade.lastCheckedAt, n(trade.openedAt));
    const firstWholeMinute = Math.ceil(Math.max(lastCheckedAt, n(trade.openedAt)) / 60_000) * 60_000;
    for (const bar of candleSet.bars) {
      // Only use fully post-entry, post-check minute bars to avoid counting price action from before the signal/check.
      if (bar.t < firstWholeMinute) continue;
      const hit = candleHit(trade, bar);
      if (hit) { result = hit; exitMark = bar.c; hitAt = bar.T || bar.t + 60_000; exitDetection = '1m_candle_ohlc'; break; }
    }
    if (!result && mark > 0) {
      if (trade.side === 'LONG') {
        if (mark <= trade.sl) result = 'SL'; else if (mark >= trade.tp) result = 'TP';
      } else {
        if (mark >= trade.sl) result = 'SL'; else if (mark <= trade.tp) result = 'TP';
      }
      if (result) { exitMark = mark; hitAt = now(); exitDetection = 'mark_price_snapshot'; }
    }
    if (candleSet.ok) trade.lastCheckedAt = now();
    if (!result) continue;

    trade.status = result;
    trade.closedAt = hitAt || now();
    trade.exitMark = exitMark || mark;
    trade.pnlR = result === 'TP' ? n(trade.rr) : result === 'SL' ? -1 : null;
    trade.paperMarginUsd = PAPER_MARGIN_USD;
    trade.exitDetection = result === 'AMBIGUOUS' ? 'same_1m_candle_both_levels' : (exitDetection || 'unknown_detection');
    closed.push(trade);
    if (result === 'TP' || result === 'SL') {
      const dk = dayKey(trade.closedAt);
      state.dailyStats[dk] ||= { tp: 0, sl: 0, closed: 0, realizedR: 0 };
      state.dailyStats[dk][result === 'TP' ? 'tp' : 'sl']++;
      state.dailyStats[dk].closed++;
      state.dailyStats[dk].realizedR += trade.pnlR;
    }
  }
  state.paperTrades = state.paperTrades.filter(t => t.status === 'OPEN' || now() - n(t.closedAt) < 14 * 86400_000);
  return closed;
}

function formatOutcome(trade) {
  const isTp = trade.status === 'TP';
  const isSl = trade.status === 'SL';
  const ambiguous = !isTp && !isSl;
  const side = String(trade.side || 'LONG').toUpperCase();
  const long = side === 'LONG';
  const lev = Math.max(1, n(trade.suggestedLeverage, 1));
  const margin = Math.max(10, n(trade.paperMarginUsd, PAPER_MARGIN_USD));
  const entry = n(trade.entry);
  const targetExit = isTp ? n(trade.tp) : isSl ? n(trade.sl) : n(trade.exitMark, entry);
  const movePct = entry > 0 ? ((targetExit - entry) / entry) * 100 * (long ? 1 : -1) : 0;
  const grossPnl = margin * lev * (movePct / 100);
  // Conservative isolated-margin display: never claim loss beyond the simulated margin.
  const pnl = Math.max(-margin, grossPnl);
  const pnlPct = margin > 0 ? pnl / margin * 100 : 0;
  const notional = margin * lev;
  const finalEquity = Math.max(0, margin + pnl);
  const durationMin = Math.max(0, Math.round((n(trade.closedAt) - n(trade.openedAt)) / 60_000));
  const duration = durationMin >= 60 ? `${Math.floor(durationMin / 60)}H ${durationMin % 60}M` : `${durationMin}M`;
  const outcomeR = ambiguous ? 'UNDETERMINED' : `${trade.pnlR >= 0 ? '+' : ''}${n(trade.pnlR).toFixed(2)}R`;
  const header = ambiguous ? '⚠️ OUTCOME UNCERTAIN' : isTp
    ? (long ? '🏁 LONG TAKE PROFIT HIT' : '🏁 SHORT TAKE PROFIT HIT')
    : (long ? '🛑 LONG STOP LOSS HIT' : '🛑 SHORT STOP LOSS HIT');
  const pnlLine = ambiguous ? 'P&L: UNDETERMINED' : `${pnl >= 0 ? '🟢' : '🔴'} <b>${pnl >= 0 ? '+' : '−'}$${Math.abs(pnl).toFixed(2)}</b>  (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}% on margin)`;
  const exitLabel = isTp ? 'TP reference' : isSl ? 'SL reference' : 'Exit/reference';
  const accent = isTp ? '🟢 PROFIT CARD' : isSl ? '🔴 LOSS CARD' : '🟠 REVIEW CARD';
  return `${accent}  |  <b>NOVARA AI</b>
━━━━━━━━━━━━━━━━━━
${header}
<b>${long ? '🟩 LONG' : '🟥 SHORT'}  ${escapeHtml(trade.coin)} PERP</b>
━━━━━━━━━━━━━━━━━━
💵 <b>SIMULATED POSITION</b>
• Margin: <b>$${margin.toFixed(2)}</b>
• Leverage: <b>${lev}x</b>
• Position notional: <b>$${notional.toLocaleString('en-US', { maximumFractionDigits: 2 })}</b>

📍 Entry: <code>${fmtPrice(entry)}</code>
🎯 Take Profit: <code>${fmtPrice(trade.tp)}</code>
🛑 Stop Loss: <code>${fmtPrice(trade.sl)}</code>
🏁 ${exitLabel}: <code>${fmtPrice(targetExit)}</code>
📉 Price move (direction-adjusted): <b>${movePct >= 0 ? '+' : ''}${movePct.toFixed(2)}%</b>

💰 <b>SIMULATED P&L</b>
${pnlLine}
💼 Margin after trade: <b>$${ambiguous ? '—' : finalEquity.toFixed(2)}</b>
📊 Result in R: <b>${outcomeR}</b>
⏱ Duration: <b>${duration}</b>
🧩 Setup: ${escapeHtml(String(trade.pattern || '').replaceAll('_', ' '))}
🧠 Strategy: ${escapeHtml(String(trade.strategyVersion || 'LEGACY/UNKNOWN'))}

<b>HYPERLIQUID MARKET DATA • PAPER TRADING</b>
No real order was placed. P&L is an estimate before fees, funding and slippage; leverage can cause liquidation before a stop is reached. ${ambiguous ? 'Both levels may have been touched in the same candle; no win/loss is assigned.' : ''}`;
}

function report24h(state, audience) {
  const cutoff = now() - 24 * 3600_000;
  const cohort = state.paperTrades.filter(t => {
    if (t.strategyVersion !== VERSION || n(t.openedAt) < cutoff || n(t.openedAt) > now()) return false;
    const deliveredTo = t.audience || 'VIP';
    if (audience === 'FREE') return deliveredTo === 'FREE' || deliveredTo === 'BOTH';
    if (audience === 'VIP') return deliveredTo === 'VIP' || deliveredTo === 'BOTH' || deliveredTo === 'LEGACY';
    return deliveredTo === 'LEGACY';
  });
  const tp = cohort.filter(t => t.status === 'TP').length;
  const sl = cohort.filter(t => t.status === 'SL').length;
  const ambiguous = cohort.filter(t => t.status === 'AMBIGUOUS').length;
  const open = cohort.filter(t => t.status === 'OPEN').length;
  const resolved = tp + sl;
  const winRate = resolved ? tp / resolved * 100 : 0;
  const successOfAll = cohort.length ? tp / cohort.length * 100 : 0;
  const lossOfAll = cohort.length ? sl / cohort.length * 100 : 0;
  const netR = cohort.filter(t => t.status === 'TP' || t.status === 'SL').reduce((sum,t) => sum + n(t.pnlR), 0);
  // A separate closure-time cohort answers the distinct question: which trades
  // actually closed during the last 24h? Include retained legacy-version trades
  // here so an old OPEN trade closed by this run is not silently omitted.
  const closedCohort = state.paperTrades.filter(t => {
    if (!['TP', 'SL', 'AMBIGUOUS'].includes(t.status) || n(t.closedAt) < cutoff || n(t.closedAt) > now()) return false;
    const deliveredTo = t.audience || 'VIP';
    if (audience === 'FREE') return deliveredTo === 'FREE' || deliveredTo === 'BOTH';
    if (audience === 'VIP') return deliveredTo === 'VIP' || deliveredTo === 'BOTH' || deliveredTo === 'LEGACY';
    return deliveredTo === 'LEGACY';
  });
  const closedTP = closedCohort.filter(t => t.status === 'TP').length;
  const closedSL = closedCohort.filter(t => t.status === 'SL').length;
  const closedAmbiguous = closedCohort.filter(t => t.status === 'AMBIGUOUS').length;
  const closedResolved = closedTP + closedSL;
  const closedWinRate = closedResolved ? closedTP / closedResolved * 100 : 0;
  const closedNetR = closedCohort.filter(t => t.status === 'TP' || t.status === 'SL').reduce((sum,t) => sum + n(t.pnlR), 0);
  const closedLegacy = closedCohort.filter(t => t.strategyVersion !== VERSION).length;
  const details = [...cohort].sort((a,b) => n(b.openedAt)-n(a.openedAt)).slice(0, 12).map(t => {
    const status = t.status === 'OPEN' ? 'OPEN' : t.status === 'TP' ? 'TP ✅' : t.status === 'SL' ? 'SL ❌' : 'AMBIGUOUS ⚠️';
    return `• ${escapeHtml(t.coin)} ${t.side} | ${status} | score ${n(t.score).toFixed(2)}/10 | ${n(t.suggestedLeverage) || '—'}x | ${t.status === 'TP' || t.status === 'SL' ? `${n(t.pnlR) > 0 ? '+' : ''}${n(t.pnlR).toFixed(2)}R` : 'pending'}`;
  });
  return `📊 <b>NOVARA — 24H ${audience === 'FREE' ? 'PUBLIC' : audience === 'VIP' ? 'VIP' : 'CHANNEL'} SIGNAL PERFORMANCE</b>
━━━━━━━━━━━━━━━━━━
🔐 Coverage: separate entry-time and closure-time reporting windows
🕒 Window: last 24 hours (UTC)
🔔 Signals opened in this version/window: <b>${cohort.length}</b>
🎯 TP reached: <b>${tp}</b> (${successOfAll.toFixed(1)}% of all signals)
🛑 SL reached: <b>${sl}</b> (${lossOfAll.toFixed(1)}% of all signals)
📈 Win rate of resolved signals: <b>${resolved ? `${winRate.toFixed(1)}%` : 'N/A — no resolved signals'}</b> (${tp}/${resolved})
⏳ Still open/pending: <b>${open}</b>
⚠️ Ambiguous 1m candles: <b>${ambiguous}</b> (excluded from win rate)
🧮 Net realized result (entry cohort): <b>${netR >= 0 ? '+' : ''}${netR.toFixed(2)}R</b> (paper estimate, before fees/slippage)

<b>Trades CLOSED in the last 24h (all retained versions):</b>
🔒 Closed: <b>${closedCohort.length}</b> | TP ${closedTP} | SL ${closedSL} | ambiguous ${closedAmbiguous}
📈 Closed-trade win rate: <b>${closedResolved ? `${closedWinRate.toFixed(1)}%` : 'N/A'}</b> (${closedTP}/${closedResolved})
🧮 Closed-cohort net result: <b>${closedNetR >= 0 ? '+' : ''}${closedNetR.toFixed(2)}R</b>
🧾 Older-version trades included in closure cohort: <b>${closedLegacy}</b>

<b>Signal details (up to 12 most recent):</b>
${details.length ? details.join('\n') : 'No tracked signals were opened in this 24-hour window.'}

ℹ️ Entry cohort is filtered by openedAt and this strategy version; closure cohort is filtered by closedAt and includes retained older versions. Win rate = TP ÷ (TP + SL). Paper estimates exclude fees/slippage and do not represent actual fills. No real orders.`;
}

function dailySummary(state) {
  const all = state.paperTrades.filter(t => t.strategyVersion === VERSION && (t.status === 'TP' || t.status === 'SL'));
  const tp = all.filter(t => t.status === 'TP').length;
  const sl = all.filter(t => t.status === 'SL').length;
  const closed = tp + sl;
  const r = all.reduce((sum, t) => sum + n(t.pnlR), 0);
  const avgR = closed ? r / closed : 0;
  return { closed, tp, sl, winRate: closed ? tp / closed * 100 : 0, realizedR: r, avgR, open: state.paperTrades.filter(t => t.strategyVersion === VERSION && t.status === 'OPEN').length };
}

async function getMarketSnapshot() {
  const result = await request({ type: 'metaAndAssetCtxs' }, 'metaAndAssetCtxs');
  const meta = result?.[0];
  const contexts = result?.[1];
  if (!meta?.universe || !Array.isArray(contexts)) throw new Error('Hyperliquid metaAndAssetCtxs returned an unexpected schema');
  const ctxByCoin = {};
  const assets = [];
  for (let i = 0; i < meta.universe.length; i++) {
    const u = meta.universe[i], c = contexts[i] || {};
    const coin = String(u.name || '');
    const volume = n(c.dayNtlVlm);
    const markPx = n(c.markPx || c.midPx);
    if (!coin || !(markPx > 0) || u.isDelisted) continue;
    const ctx = { coin, markPx, dayVolume: volume, funding: n(c.funding), openInterest: n(c.openInterest), premium: n(c.premium), oraclePx: n(c.oraclePx), maxLeverage: n(u.maxLeverage) };
    ctxByCoin[coin] = ctx;
    assets.push(ctx);
  }
  assets.sort((a, b) => b.dayVolume - a.dayVolume);
  return { ctxByCoin, assets, totalEligible: assets.length };
}
async function candles(coin, interval, hours) {
  const endTime = now();
  const startTime = endTime - hours * 3600_000;
  const raw = await request({ type: 'candleSnapshot', req: { coin, interval, startTime, endTime } }, `candles ${coin} ${interval}`);
  const intervalMs = { '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000, '1h': 3_600_000, '2h': 7_200_000, '4h': 14_400_000, '8h': 28_800_000, '12h': 43_200_000, '1d': 86_400_000 };
  return completedCandles(raw, intervalMs[interval] || 900_000);
}

function directionalBias(candlesIn) {
  if (!Array.isArray(candlesIn) || candlesIn.length < 20) return null;
  const structural = trendBias(candlesIn);
  if (structural === 'LONG' || structural === 'SHORT') return structural;
  // Range-aware fallback: even when EMA structure is neutral, use recent momentum,
  // then EMA positioning, then the latest completed candle so a range does not
  // automatically suppress a valid altcoin setup.
  const closes = candlesIn.map(c => c.c).filter(x => x > 0);
  const last = closes.at(-1), prev3 = closes.at(-4) || last;
  const momentumPct = prev3 > 0 ? (last - prev3) / prev3 * 100 : 0;
  if (momentumPct > 0.015) return 'LONG';
  if (momentumPct < -0.015) return 'SHORT';
  const fast = ema(closes.slice(-30), 10);
  const slow = ema(closes.slice(-60), 20);
  if (last > fast && fast >= slow) return 'LONG';
  if (last < fast && fast <= slow) return 'SHORT';
  const lastCandle = candlesIn.at(-1);
  if (lastCandle && lastCandle.c !== lastCandle.o) return lastCandle.c > lastCandle.o ? 'LONG' : 'SHORT';
  return momentumPct >= 0 ? 'LONG' : 'SHORT';
}

function recentMovePct(rows, lookbackBars) {
  const usable = Array.isArray(rows) ? rows.filter(c => n(c.c) > 0) : [];
  if (usable.length < lookbackBars + 1) return null;
  const start = n(usable[usable.length - lookbackBars - 1]?.c);
  const end = n(usable.at(-1)?.c);
  return start > 0 && end > 0 ? (end - start) / start * 100 : null;
}

async function refreshBtcDirection(fallbackRegime) {
  const refreshedAt = now();
  const out = { ...(fallbackRegime || {}), timeframes: { ...(fallbackRegime?.timeframes || {}) }, refreshedAt };
  const specs = [
    { key: '15m', interval: '15m', hours: 36, barsPer24h: 96, recentLookback: 4 },
    { key: '1H', interval: '1h', hours: 72, barsPer24h: 24, recentLookback: 1 },
  ];
  for (const spec of specs) {
    try {
      const rows = await candles('BTC', spec.interval, spec.hours);
      const regime = marketRegime(rows, spec.barsPer24h, spec.key);
      const bias = directionalBias(rows);
      out.timeframes[spec.key] = { ...regime, trend: bias || regime.trend, label: bias === 'LONG' ? 'BULLISH' : bias === 'SHORT' ? 'BEARISH' : regime.label, recentMovePct: recentMovePct(rows, spec.recentLookback) };
      console.log(`[BTC][LIVE-CHECK] ${spec.key}=${out.timeframes[spec.key].label}/${out.timeframes[spec.key].trend} change24h=${Number.isFinite(regime.change24hPct) ? regime.change24hPct.toFixed(2) + '%' : 'NA'} candles=${rows.length}`);
    } catch (e) {
      console.warn(`[BTC][LIVE-CHECK][WARN] ${spec.key} refresh failed: ${e?.message || e}`);
      const old = out.timeframes[spec.key];
      if (!old || old.status !== 'OK') out.timeframes[spec.key] = { timeframe: spec.key, status: 'UNAVAILABLE', trend: 'UNAVAILABLE', label: 'UNAVAILABLE', change24hPct: null, candles: 0 };
    }
  }
  const b15 = out.timeframes['15m'];
  const b1h = out.timeframes['1H'];
  const d15 = b15?.trend === 'LONG' || b15?.trend === 'SHORT' ? b15.trend : null;
  const d1h = b1h?.trend === 'LONG' || b1h?.trend === 'SHORT' ? b1h.trend : null;
  // The 1H direction has more weight; 15m captures the immediate move. If they
  // disagree, prefer 1H unless 15m has a clearly stronger short-term impulse.
  let direction = d1h || d15;
  if (d1h && d15 && d1h !== d15) {
    // Compare approximately equal one-hour windows: four completed 15m bars
    // versus one completed 1h bar. Do not compare two 24h changes as if they
    // represented the strength of each timeframe's immediate impulse.
    const m15 = b15?.recentMovePct;
    const m1h = b1h?.recentMovePct;
    const recent15Strong = Number.isFinite(m15) && Math.sign(m15) === (d15 === 'LONG' ? 1 : -1)
      && Math.abs(m15) >= Math.max(0.35, Number.isFinite(m1h) ? Math.abs(m1h) * 1.25 : 0.35);
    direction = recent15Strong ? d15 : d1h;
    console.log(`[BTC][LIVE-CHECK] 15m/1h conflict: 15m=${d15} recent~1h=${Number.isFinite(m15) ? m15.toFixed(2) + '%' : 'NA'}, 1h=${d1h} recent1h=${Number.isFinite(m1h) ? m1h.toFixed(2) + '%' : 'NA'}, chosen=${direction}`);
  }
  if (!direction && ['LONG', 'SHORT'].includes(fallbackRegime?.trend)) direction = fallbackRegime.trend;
  out.trend = direction || 'UNAVAILABLE';
  out.label = direction === 'LONG' ? 'BULLISH' : direction === 'SHORT' ? 'BEARISH' : 'UNAVAILABLE';
  out.timeframe = 'LIVE 15m+1H';
  out.status = (d15 || d1h) ? 'OK' : (direction ? 'FALLBACK' : 'UNAVAILABLE');
  out.directionSource = d15 && d1h && d15 !== d1h ? `weighted 1H/15m (${direction})` : (d1h ? '1H + 15m live' : d15 ? '15m live/fallback' : direction ? 'last known BTC direction' : 'BTC unavailable; retain alt setup side');
  if (Number.isFinite(b1h?.change24hPct)) out.change24hPct = b1h.change24hPct;
  console.log(`[BTC][LIVE-DIRECTION] ${direction} source=${out.directionSource} | 15m=${b15?.label || 'UNAVAILABLE'} 1H=${b1h?.label || 'UNAVAILABLE'}`);
  return out;
}

async function analyzeAsset(asset, previous, btcRegime) {
  const [c15, c1h] = await Promise.all([
    candles(asset.coin, '15m', 30),
    candles(asset.coin, '1h', 90),
  ]);
  if (c15.length < 35 || c1h.length < 30) return [];
  // Entry confirmation is based on a completed 15m candle. Do not send a signal
  // if the live mark has already drifted too far from that confirmed close.
  const lastClosed15m = c15.at(-1);
  const atr15ForTiming = atr(c15, 14) || asset.markPx * 0.006;
  const entryDriftPct = Math.abs(asset.markPx - lastClosed15m.c) / asset.markPx * 100;
  const maxEntryDriftPct = Math.max(0.35, (atr15ForTiming / asset.markPx) * 100 * 0.80);
  if (entryDriftPct > maxEntryDriftPct) {
    console.log(`[ENTRY][STALE] ${asset.coin} mark/confirmed-close drift=${entryDriftPct.toFixed(3)}% > ${maxEntryDriftPct.toFixed(3)}%; skip chase`);
    const skipped = [];
    skipped.stale = true;
    return skipped;
  }
  const [book, trades] = await Promise.all([
    request({ type: 'l2Book', coin: asset.coin }, `book ${asset.coin}`).catch(error => { console.warn(`[API][DEGRADED] book ${asset.coin}: ${error?.message || error}`); return null; }),
    request({ type: 'recentTrades', coin: asset.coin }, `trades ${asset.coin}`).catch(error => { console.warn(`[API][DEGRADED] trades ${asset.coin}: ${error?.message || error}`); return []; }),
  ]);
  const spread = spreadPct(book, asset.markPx);
  const imbalance = bookImbalance(book);
  const flow = tradeDelta(trades);
  return detectPatterns({ coin: asset.coin, c15, c1h, ctx: asset, prevCtx: previous, mid: asset.markPx, spread, imbalance, flow, btcRegime });
}

async function main() {
  const started = now();
  const state = await readState();

  // One-time clean start: preserve legacy records for audit, but remove them
  // from active paper tracking so old trades cannot close, notify, or affect
  // V2.8.1 performance statistics. The stable marker prevents repeated resets.
  if (state.cleanStartId !== CLEAN_START_ID) {
    const legacyTrades = Array.isArray(state.paperTrades) ? state.paperTrades : [];
    state.archivedPaperTrades = [
      ...(Array.isArray(state.archivedPaperTrades) ? state.archivedPaperTrades : []),
      ...legacyTrades.map(t => ({ ...t, archivedAt: now(), archiveReason: 'V2.8.6_CLEAN_START' }))
    ];
    state.paperTrades = [];
    state.alertHistory = {};
    state.dailyStats = {};
    state.dailyFreeCount = {};
    state.previousMarketContext = {};
    state.pendingDailyReports = null;
    delete state.pendingDailyReportCreatedAt;
    delete state.pendingDailyReportText;
    delete state.pendingDailyReportDelivered;
    state.lastDailyReportAt = now();
    state.cleanStartId = CLEAN_START_ID;
    state.cleanStartAt = now();
    console.log(`[CLEAN-START] Archived ${legacyTrades.length} legacy paper trades; active paper history, cooldowns, and pending reports reset.`);
  } else {
    console.log(`[CLEAN-START] Already initialized at ${new Date(n(state.cleanStartAt, 0)).toISOString()}; continuing current V2.8.6 evaluation.`);
  }
  state.version = VERSION;
  console.log(`\n${VERSION} — START`);
  console.log(`Mode: READ-ONLY / NO ORDERS / NO AUTO-COPY / PAPER TRACKING`);
  console.log(`[CLEAN-START] Evaluation cohort begins ${new Date(n(state.cleanStartAt, started)).toISOString()} (UTC); only newly recorded V2.8.6 trades count.`);
  console.log(`Time: ${new Date().toISOString()}`);
  console.log(`Strategy: asset 1H trend is authoritative for LONG/SHORT; 15m is entry timing only; BTC 1H/15m is contextual confirmation, not a side override; final-side evidence adjustment; 30m cross-pattern cooldown; 1H multi-touch support/resistance sets SL/TP; risk bounds 0.50%-5.00% with ATR-aware buffer; selects among repeated-touch 1H levels to preserve valid TP/SL geometry; single-touch levels rejected | Signal threshold: ${MIN_SCORE}/10 | min R:R: 1:${MIN_RR.toFixed(2)} | BTC countertrend: ${BTC_COUNTERTREND_HARD_MOVE_PCT.toFixed(1)}% impulse requires score >= ${BTC_COUNTERTREND_MIN_SCORE.toFixed(1)} and ${BTC_COUNTERTREND_MIN_EVIDENCE} confirmations | structure-first SL/TP | 24h volume floor: NONE | market cap: NONE (all active listed perps)`);
  console.log(`[API][POLICY] requestGap=${SCAN_GAP_MS}ms retries429=${MAX_429_RETRIES} backoff=${RATE_LIMIT_BASE_MS}-${RATE_LIMIT_MAX_MS}ms globalCooldown=yes`);
  console.log(`[TELEGRAM][CONFIG] token=${TOKEN ? 'configured' : 'MISSING'} vipChat=${VIP_CHAT ? 'configured' : (LEGACY_CHAT ? 'legacy-fallback' : 'MISSING')} freeChat=${FREE_CHAT ? 'configured' : 'MISSING'} legacyChat=${LEGACY_CHAT ? 'configured' : 'MISSING'}`);
  if (!TOKEN || (!VIP_CHAT && !LEGACY_CHAT && !FREE_CHAT)) {
    console.warn('[TELEGRAM][ACTION REQUIRED] Signals may be generated but cannot be delivered until TELEGRAM_TOKEN and at least one chat ID are configured in the production environment.');
  }

  const snapshot = await getMarketSnapshot();
  const contexts = snapshot.ctxByCoin;
  const eligible = snapshot.assets;
  const btcRegime = { timeframe: '4H', status: 'UNAVAILABLE', trend: 'UNAVAILABLE', change24hPct: null, label: 'UNAVAILABLE', timeframes: {} };
  const btcTfSpecs = [
    { key: '4H', interval: '4h', hours: 30 * 24, barsPer24h: 6 },
    { key: '1H', interval: '1h', hours: 96, barsPer24h: 24 },
    { key: '15m', interval: '15m', hours: 60, barsPer24h: 96 },
  ];
  for (const tf of btcTfSpecs) {
    try {
      const rows = await candles('BTC', tf.interval, tf.hours);
      const regime = marketRegime(rows, tf.barsPer24h, tf.key);
      btcRegime.timeframes[tf.key] = regime;
      console.log(`[BTC][REGIME] ${tf.key}=${regime.label} trend=${regime.trend} change24h=${Number.isFinite(regime.change24hPct) ? regime.change24hPct.toFixed(2) + '%' : 'UNAVAILABLE'} candles=${regime.candles}`);
      if (tf.key === '4H') Object.assign(btcRegime, regime, { timeframes: btcRegime.timeframes });
    } catch (e) {
      const unavailable = { timeframe: tf.key, status: 'UNAVAILABLE', trend: 'UNAVAILABLE', change24hPct: null, label: 'UNAVAILABLE', candles: 0 };
      btcRegime.timeframes[tf.key] = unavailable;
      console.warn(`[BTC][WARN] ${tf.key} regime unavailable; not silently treating missing data as neutral: ${e?.message || e}`);
    }
  }
  // Keep the 4H regime as the primary directional gate, while attaching all timeframes for signal diagnostics.
  btcRegime.timeframes = { ...btcRegime.timeframes };
  console.log(`[BTC][SUMMARY] ${['4H', '1H', '15m'].map(tf => { const r = btcRegime.timeframes[tf]; return `${tf}=${r?.status === 'OK' ? `${r.label}/${r.trend} ${r.change24hPct.toFixed(2)}%` : 'UNAVAILABLE'}`; }).join(' | ')}`);
  if (!n(state.lastDailyReportAt)) state.lastDailyReportAt = now(); // first report is sent after one full 24-hour observation window
  const closed = await updatePaperTrades(state, contexts);
  for (const t of closed) {
    console.log(`[PAPER][${t.status}] ${t.coin} ${t.side} entry=${fmtPrice(t.entry)} mark=${fmtPrice(t.exitMark)} R=${t.pnlR ?? 'undetermined'}`);
  }
  // Retry undelivered outcome notifications only to the audience that received the signal.
  for (const t of state.paperTrades.filter(x => x.status !== 'OPEN' && !x.outcomeNotifiedAt)) {
    t.audience = audienceForTrade(t);
    t.outcomeDelivered ||= [];
    const updateResults = await sendUpdateToAudience(formatOutcome(t), t.audience, t.outcomeDelivered, t);
    for (const r of updateResults) if (r.sent && !t.outcomeDelivered.includes(r.name)) t.outcomeDelivered.push(r.name);
    const required = t.audience === 'BOTH' ? ['VIP', 'FREE'] : [t.audience];
    if (required.length && required.every(name => t.outcomeDelivered.includes(name))) t.outcomeNotifiedAt = now();
    console.log(`[OUTCOME][DELIVERY] ${t.coin} ${t.status} audience=${t.audience} ${JSON.stringify(updateResults)} delivered=${t.outcomeDelivered.join(',')}`);
  }

  const candidates = [];
  let checked = 0, failed = 0;
  const rejects = { stale: 0, regime: 0, regimeSoft: 0, score: 0, cooldown: 0, risk: 0, location: 0, vwap: 0, spread: 0, accepted: 0 };
  const rejectionSamples = [];
  const noteReject = (kind, s, reason) => { rejects[kind]++; if (rejectionSamples.length < 18) rejectionSamples.push(`${s.coin} ${s.side} ${s.pattern}: ${reason}`); };
  for (const asset of eligible) {
    try {
      const found = await analyzeAsset(asset, state.previousMarketContext[asset.coin], btcRegime);
      checked++;
      if (found.stale) rejects.stale++;
      if (found.length) {
        // Refresh BTC at candidate-generation time, once per altcoin, before any
        // side-dependent gates or SL/TP calculation. Reuse this snapshot for any
        // patterns found on the same coin during this pass.
        const liveBtc = await refreshBtcDirection(btcRegime);
        for (const candidate of found) {
          const originalSide = candidate.side;
          const oneHourSide = ['LONG', 'SHORT'].includes(candidate.trend) ? candidate.trend : originalSide;
          candidate.side = oneHourSide;
          candidate.btcRegime = liveBtc;
          candidate.reasons = [`1H ASSET TREND AUTHORITY: ${originalSide}->${oneHourSide}; 15m used for entry timing only; BTC ${liveBtc.trend || 'UNAVAILABLE'} is context, not a side override; source=${liveBtc.directionSource}; SL/TP from repeated-touch 1H levels`, ...candidate.reasons];
          const sideAdjustment = finalSideEvidenceAdjustment(candidate, originalSide);
          candidate.score = clamp(candidate.score + sideAdjustment, 0, 9.5);
          candidate.reasons = [`Final-side evidence adjustment ${sideAdjustment >= 0 ? '+' : ''}${sideAdjustment.toFixed(2)} (original=${originalSide}, final=${oneHourSide}; checks trend/flow/order-book/RSI/VWAP)`, ...candidate.reasons];
          console.log(`[1H][DIRECTION-AUTHORITY] ${candidate.coin} ${candidate.pattern}: ${originalSide}->${oneHourSide}; BTC context=${liveBtc.trend}; finalSideAdjustment=${sideAdjustment.toFixed(2)}; score=${candidate.score.toFixed(2)}; entry=${fmtPrice(candidate.entry)} support=${fmtPrice(candidate.support)} resistance=${fmtPrice(candidate.resistance)}`);
        }
      }
      for (const s of found) {
        // Hard market-quality gate: unknown/wide spreads are not signal-worthy.
        if (s.spreadPct == null || !Number.isFinite(s.spreadPct) || s.spreadPct > MAX_SPREAD_PCT) {
          noteReject('spread', s, s.spreadPct == null ? 'order-book spread unavailable' : `spread ${s.spreadPct.toFixed(3)}% > ${MAX_SPREAD_PCT}%`);
          continue;
        }
        // V2.8.6 LOCATION GATE: SHORTs must trigger near a repeatedly tested 1H
        // resistance after a completed 15m bearish rejection; LONGs must trigger
        // near a repeatedly tested 1H support after a completed 15m bullish reclaim.
        // This prevents late entries after most of the move toward the opposite level.
        const entryLevel = n(s.entryLevel);
        const levelDistancePct = n(s.entryLevelDistancePct, Infinity);
        const maxEntryLevelDistancePct = n(s.entryProximityMaxPct, 0.45);
        const levelTouches = s.side === 'SHORT' ? n(s.resistanceTouches) : n(s.supportTouches);
        if (!(entryLevel > 0) || levelTouches < 2 || levelDistancePct > maxEntryLevelDistancePct || !s.entryReactionConfirmed) {
          const reason = !(entryLevel > 0) ? 'no repeated-touch 1H level on entry side'
            : levelTouches < 2 ? `entry level has only ${levelTouches} independent touches`
            : levelDistancePct > maxEntryLevelDistancePct ? `late entry: ${levelDistancePct.toFixed(2)}% from ${s.side === 'SHORT' ? 'resistance' : 'support'}; max ${maxEntryLevelDistancePct.toFixed(2)}%`
            : `15m ${s.side === 'SHORT' ? 'bearish resistance rejection' : 'bullish support reclaim'} not confirmed`;
          console.log(`[FILTER][ENTRY-LOCATION] ${s.coin} ${s.side} ${s.pattern} rejected: ${reason}; entry=${fmtPrice(s.entry)} level=${fmtPrice(entryLevel)} distance=${Number.isFinite(levelDistancePct) ? levelDistancePct.toFixed(2)+'%' : 'NA'} max=${maxEntryLevelDistancePct.toFixed(2)}% touches=${levelTouches}`);
          noteReject('location', s, reason);
          continue;
        }
        console.log(`[ENTRY][LOCATION-PASS] ${s.coin} ${s.side}: near ${s.side === 'SHORT' ? '1H resistance' : '1H support'} (${levelDistancePct.toFixed(2)}%, ${levelTouches} touches), 15m rejection confirmed`);
        // Adaptive regime gate: trend disagreement is a warning, not an automatic
        // rejection. Hard-block only when BOTH the asset trend and BTC oppose the
        // setup and BTC itself has a material 24h impulse. Structure/R:R gates below
        // remain mandatory for every direction, including counter-trend setups.
        const assetOpposes = s.trend === (s.side === 'LONG' ? 'SHORT' : 'LONG');
        const btcLabel = s.btcRegime?.label || 'NEUTRAL';
        const btcOpposes = (s.side === 'LONG' && btcLabel === 'BEARISH') || (s.side === 'SHORT' && btcLabel === 'BULLISH');
        const btcMoveAbs = Math.abs(n(s.btcRegime?.change24hPct));
        if (assetOpposes && btcOpposes) {
          rejects.regimeSoft++;
          console.log(`[FILTER][REGIME][ADAPTIVE] ${s.coin} ${s.side}: asset trend=${s.trend}, BTC=${btcLabel}, impulse=${btcMoveAbs.toFixed(2)}%; evaluate setup strength before deciding`);
        }
        // V1.0.8 applied a second hard distance gate before structural risk validation.
        // That duplicate gate could reject setups even when the actual SL/TP structure
        // and configured R:R were valid. Let buildRisk() make the authoritative decision:
        // it verifies the correct-side support/resistance, buffer, stop bounds and R:R.
        const structureRoomPct = s.side === 'LONG'
          ? (n(s.resistance) > s.entry ? (n(s.resistance) - s.entry) / s.entry * 100 : 0)
          : (n(s.support) > 0 && n(s.support) < s.entry ? (s.entry - n(s.support)) / s.entry * 100 : 0);
        if (structureRoomPct > 0 && structureRoomPct < Math.max(0.35, n(s.atrPct) * 0.65)) {
          console.log(`[STRUCTURE][TIGHT] ${s.coin} ${s.side}: room=${structureRoomPct.toFixed(2)}%; checking actual structural SL/TP and R:R instead of auto-rejecting`);
        }
        if (s.score < MIN_SCORE) {
          noteReject('score', s, `score ${s.score.toFixed(2)} < ${MIN_SCORE}`);
          if (s.score >= MIN_SCORE - 0.75) {
            console.log(`[NEAR-MISS][SCORE] ${s.coin} ${s.side} ${s.pattern} score=${s.score.toFixed(2)}/${MIN_SCORE} trend=${s.trend} BTC=${s.btcRegime?.label || 'NEUTRAL'} RSI15=${n(s.rsi15).toFixed(1)} volRatio=${n(s.volRatio).toFixed(2)} OI=${n(s.oiChange).toFixed(2)} flow=${n(s.flowDelta).toFixed(3)} imbalance=${n(s.imbalance).toFixed(3)} spread=${s.spreadPct == null ? 'NA' : n(s.spreadPct).toFixed(3) + '%'} reasons=${(s.reasons || []).slice(0, 8).join('; ')}`);
          }
          continue;
        }
        if (btcImpulseOpposes(s)) {
          const evidence = countertrendEvidence(s);
          const minScore = BTC_COUNTERTREND_MIN_SCORE;
          if (s.score < minScore || evidence.count < BTC_COUNTERTREND_MIN_EVIDENCE) {
            const reason = `BTC ${s.btcRegime.label} ${n(s.btcRegime.change24hPct).toFixed(2)}%/24h opposes ${s.side}; score=${s.score.toFixed(2)}/${minScore.toFixed(2)}, evidence=${evidence.count}/${BTC_COUNTERTREND_MIN_EVIDENCE} [${evidence.passed.join(',') || 'none'}]`;
            console.log(`[FILTER][BTC-COUNTERTREND] ${s.coin} ${s.side} rejected: ${reason}`);
            noteReject('regime', s, reason);
            continue;
          }
          console.log(`[FILTER][BTC-COUNTERTREND][PASS] ${s.coin} ${s.side}: BTC ${s.btcRegime.label} ${n(s.btcRegime.change24hPct).toFixed(2)}%/24h; score=${s.score.toFixed(2)} evidence=${evidence.count} [${evidence.passed.join(',')}]`);
        }
        if (isCooldown(state, s)) { noteReject('cooldown', s, '30-minute cross-pattern / 90-minute per-pattern cooldown'); continue; }
        const risk = buildRisk(s);
        if (!risk.valid) console.log(`[FILTER][RISK] ${s.coin} ${s.side} rejected: ${risk.reason} | entry=${fmtPrice(risk.entry || s.entry)} SL=${fmtPrice(risk.sl)} TP=${fmtPrice(risk.tp)} risk=${pct(risk.riskPct)} reward=${pct(risk.rewardPct)} support=${fmtPrice(s.support)}(${s.supportSource || '?'}) resistance=${fmtPrice(s.resistance)}(${s.resistanceSource || '?'}) rawSupport=${fmtPrice(s.rawSupport)} rawResistance=${fmtPrice(s.rawResistance)} ATR=${fmtPrice(s.atr)} R:R=${n(risk.rr).toFixed(2)} required=1:${MIN_RR.toFixed(2)}`);
        if (!risk.valid || risk.rr < MIN_RR || !(risk.sl > 0) || !(risk.tp > 0)) {
          noteReject('risk', s, risk.reason || `R:R ${n(risk.rr).toFixed(2)} < ${MIN_RR}`);
          if (n(risk.rr) >= MIN_RR - 0.5 && n(risk.rr) < MIN_RR) {
            console.log(`[NEAR-MISS][RISK] ${s.coin} ${s.side} ${s.pattern} R:R=1:${n(risk.rr).toFixed(2)} required=1:${MIN_RR.toFixed(2)} entry=${fmtPrice(risk.entry)} SL=${fmtPrice(risk.sl)} TP=${fmtPrice(risk.tp)} risk=${pct(risk.riskPct)} reward=${pct(risk.rewardPct)} support=${fmtPrice(s.support)} resistance=${fmtPrice(s.resistance)} bufferATR=${STRUCTURE_BUFFER_ATR}`);
          }
          continue;
        }
        // Use the exact structural anchors selected by buildRisk() in the alert and paper record.
        if (risk.selectedSupport > 0) { s.support = risk.selectedSupport; s.supportTouches = risk.supportTouches || s.supportTouches; }
        if (risk.selectedResistance > 0) { s.resistance = risk.selectedResistance; s.resistanceTouches = risk.resistanceTouches || s.resistanceTouches; }
        // Avoid chasing a move that has already travelled too far from its 15m mean.
        const distanceToVwap = Math.abs((s.entry - s.vwap) / s.entry) * 100;
        if (distanceToVwap > Math.max(2.2, s.atr / s.entry * 100 * 2.8)) { noteReject('vwap', s, `distance ${distanceToVwap.toFixed(2)}%`); continue; }
        if (shouldReverseSignal(s)) {
          // Only SWEEP_RECLAIM is inverted: LONG <-> SHORT, and original numeric TP becomes SL while original numeric SL becomes TP.
          // BREAKOUT_RETEST and TREND_PULLBACK keep their original side and SL/TP.
          const originalSide = s.side;
          const originalSL = risk.sl;
          const originalTP = risk.tp;
          s.side = oppositeSide(originalSide);
          risk.sl = originalTP;
          risk.tp = originalSL;
          risk.riskPct = Math.abs(risk.sl - risk.entry) / risk.entry * 100;
          risk.rewardPct = Math.abs(risk.entry - risk.tp) / risk.entry * 100;
          risk.rr = Math.abs(risk.entry - risk.tp) / Math.max(1e-12, Math.abs(risk.sl - risk.entry));
          risk.reverseExperiment = true;
          s.reasons = [`REVERSE EXPERIMENT: original ${originalSide} inverted to ${s.side}; SL/TP numeric levels swapped`, ...s.reasons];
          console.log(`[REVERSE-EXPERIMENT][SWEEP_RECLAIM] ${s.coin}: ${originalSide}->${s.side} entry=${fmtPrice(risk.entry)} swappedSL=${fmtPrice(risk.sl)} swappedTP=${fmtPrice(risk.tp)} reversedRR=1:${risk.rr.toFixed(2)}`);
        }
        s.risk = risk;
        s.leverageInfo = suggestLeverage(s);
        candidates.push(s); rejects.accepted++;
      }
    } catch (e) {
      failed++;
      console.warn(`[SCAN][WARN] ${asset.coin}: ${e?.message || e}`);
    }
  }

  // If several patterns fire on one market/side, keep the highest-quality setup only for this cycle.
  console.log(`[DIAGNOSTICS][REJECTS] ${JSON.stringify(rejects)}`);
  for (const sample of rejectionSamples) console.log(`[DIAGNOSTICS][SAMPLE] ${sample}`);
  candidates.sort((a, b) => b.score - a.score);
  const chosen = [];
  const seenMarketSide = new Set();
  for (const c of candidates) {
    const k = `${c.coin}|${c.side}`;
    if (seenMarketSide.has(k)) continue;
    seenMarketSide.add(k);
    chosen.push(c);
    if (chosen.length >= MAX_SIGNALS_PER_CYCLE) break;
  }

  let sentSignals = 0, sendErrors = 0;
  // Deterministic public selection: highest-scoring eligible setup, not random.
  const publicPool = chosen.filter(s => n(s.score) >= MIN_SCORE);
  const publicPick = publicPool[0] || null;
  for (const s of chosen) {
    if (n(s.score) < MIN_SCORE) continue;
    const message = formatSignal(s, s.risk);
    const destinations = [];
    // Every eligible signal goes to VIP. At most the top-scoring signal goes public per cycle.
    const vip = configuredAudience('VIP');
    if (vip) {
      try {
        const result = await sendTelegram(vip.id, message);
        destinations.push({ name: 'VIP', ...(vip.viaLegacy ? { route: 'TELEGRAM_CHAT_ID fallback' } : {}), ...result });
      } catch (e) { destinations.push({ name: 'VIP', sent: false, reason: e.message }); }
    } else destinations.push({ name: 'VIP', sent: false, reason: 'vip_chat_not_configured_and_no_legacy_fallback' });
    if (s === publicPick) {
      const pub = configuredAudience('FREE');
      if (pub) {
        try { destinations.push({ name: 'FREE', ...(await sendTelegram(pub.id, message)) }); }
        catch (e) { destinations.push({ name: 'FREE', sent: false, reason: e.message }); }
      } else destinations.push({ name: 'FREE', sent: false, reason: 'free_chat_not_configured' });
    }
    const deliveredNames = destinations.filter(x => x.sent).map(x => x.name);
    const anySent = deliveredNames.length > 0;
    console.log(`[SIGNAL] ${s.coin} ${s.side} pattern=${s.pattern} score=${s.score.toFixed(2)} audience=${s === publicPick ? 'VIP+PUBLIC' : 'VIP'} leverage=${s.leverageInfo?.leverage ?? suggestLeverage(s).leverage}x entry=${fmtPrice(s.risk.entry)} SL=${fmtPrice(s.risk.sl)} TP=${fmtPrice(s.risk.tp)} deliveries=${JSON.stringify(destinations)}`);
    if (anySent) {
      sentSignals++;
      state.alertHistory[signalKey(s)] = now();
      state.alertHistory[`${s.coin}|${s.side}|GLOBAL`] = now();
      const audience = deliveredNames.includes('VIP') && deliveredNames.includes('FREE') ? 'BOTH' : deliveredNames[0];
      state.paperTrades.push({ strategyVersion: VERSION, id: `${s.coin}|${s.side}|${s.pattern}|${now()}`, coin: s.coin, side: s.side, pattern: s.pattern, score: Number(s.score.toFixed(2)), audience, outcomeDelivered: [], entry: s.risk.entry, sl: s.risk.sl, tp: s.risk.tp, rr: s.risk.rr, suggestedLeverage: s.leverageInfo?.leverage ?? null, btcRegime: s.btcRegime?.label || 'NEUTRAL', rsi15: s.rsi15, fibConfluence: Boolean(s.fibConfluence), openedAt: now(), lastCheckedAt: now(), status: 'OPEN', pnlR: null, reasons: s.reasons });
    } else {
      sendErrors++;
      console.warn(`[DELIVERY][FAIL] ${s.coin} ${s.side}: no destination confirmed delivery`);
    }
  }

  // Persist a compact market context for OI change measurement on the next run.
  const nextCtx = {};
  for (const a of eligible) nextCtx[a.coin] = { markPx: a.markPx, openInterest: a.openInterest, funding: a.funding, at: now() };
  state.previousMarketContext = nextCtx;
  state.lastRunAt = now();
  state.lastCycle = { at: state.lastRunAt, rejectionCounts: rejects, eligible: eligible.length, totalEligible: snapshot.totalEligible, checked, failed, rawCandidates: candidates.length, signalsSelected: chosen.length, sentSignals, sendErrors, openPaperTrades: state.paperTrades.filter(t => t.status === 'OPEN').length };

  const stats = dailySummary(state);
  console.log(`[CYCLE] markets=${eligible.length}/${snapshot.totalEligible} checked=${checked} dataErrors=${failed} candidates=${candidates.length} selected=${chosen.length} sent=${sentSignals} deliveryErrors=${sendErrors} paperOpen=${stats.open} paperClosed=${stats.closed} paperWinRate=${stats.winRate.toFixed(1)}% paperNetR=${stats.realizedR.toFixed(2)} v2Rejects=${JSON.stringify(rejects)} runtime=${((now() - started) / 1000).toFixed(1)}s`);

  // No WATCHING/status spam. Send separate audience-specific reports so VIP signal details never leak to FREE.
  if (!state.pendingDailyReports && now() - n(state.lastDailyReportAt) >= 24 * 3600_000) {
    state.pendingDailyReports = {};
    state.pendingDailyReportCreatedAt = now();
    for (const audience of reportAudiences()) {
      state.pendingDailyReports[audience] = { text: report24h(state, audience), delivered: false };
    }
  }
  if (state.pendingDailyReports && typeof state.pendingDailyReports === 'object') {
    for (const [audience, report] of Object.entries(state.pendingDailyReports)) {
      if (report.delivered) continue;
      const destination = configuredAudience(audience);
      if (!destination) {
        console.warn(`[REPORT][24H] audience=${audience} not configured; report retained`);
        continue;
      }
      const reportResults = await sendUpdateToAudience(report.text, audience, []);
      if (reportResults.some(r => r.sent)) report.delivered = true;
      console.log(`[REPORT][24H] audience=${audience} ${JSON.stringify(reportResults)} delivered=${report.delivered}`);
    }
    const pending = Object.values(state.pendingDailyReports).some(r => !r.delivered);
    if (!pending && Object.keys(state.pendingDailyReports).length > 0) {
      state.lastDailyReportAt = n(state.pendingDailyReportCreatedAt, now());
      delete state.pendingDailyReports;
      delete state.pendingDailyReportCreatedAt;
      // Clear legacy single-report fields from previous versions without re-broadcasting them.
      delete state.pendingDailyReportText;
      delete state.pendingDailyReportDelivered;
      delete state.pendingDailyReportCreatedAtLegacy;
    }
  }

  await writeState(state);
}

main().catch(async error => {
  console.error(`[FATAL] ${error?.stack || error}`);
  process.exitCode = 1;
});
