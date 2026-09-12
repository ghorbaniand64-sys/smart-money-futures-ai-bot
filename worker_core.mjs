/*
╔══════════════════════════════════════════════════════════════════════════════╗
║  GMX SMART MONEY FUTURES AI BOT                                             ║
║  V17.8.1 — LIQUIDITY MAP + REACTION + EARLY IMPULSE ENGINE                                          ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  RELEASE: V17.8.2-EARLY-IMPULSE-UNLOCK                                   ║
║                                                                              ║
║  PURPOSE                                                                     ║
║  • Diagnose exactly why EARLY IMPULSE candidates are rejected.              ║
║  • Measure each Early gate from scan → qualification → setup.               ║
║  • Preserve anti-chase / exhaustion protection and execution safety.        ║
║                                                                              ║
║  TELEMETRY                                                                   ║
║  • Attempts / elapsed / move / body / volume / flow / acceleration          ║
║  • Extension / zone / proximity / score / edge / setup rejection            ║
║  • Last rejection samples are retained for server-side diagnostics.         ║
║  • Telegram cycle report exposes compact Early gate counters.               ║
║                                                                              ║
║  CAPITAL & RISK RULES                                                        ║
║  • Maximum allocation per position: 20% of wallet                           ║
║  • Maximum simultaneous positions: 3                                        ║
║  • Maximum total capital engaged: 60% of wallet                              ║
║  • Core + Radar share the same global position/capital limits.              ║
╚══════════════════════════════════════════════════════════════════════════════╝
*/

// V17.3.25: immutable runtime identity. The GitHub runner logs this exact value
// from the imported worker module so stale/wrong-file deployments are immediately visible.
export const BOT_VERSION = "V17.8.2-EARLY-IMPULSE-UNLOCK";
export const BOT_BUILD = "V17.8.2-EARLY-IMPULSE-UNLOCK";

// V17.3.25: formatter fallback is intentionally dependency-free and BigInt-safe.
// Telegram diagnostics must never hide the real GMX execution error.
function safeFormatPrice(value) {
  try {
    const n = Number(value);
    if (!Number.isFinite(n)) return "N/A";
    if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
    if (n >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
    return n.toLocaleString("en-US", { maximumFractionDigits: 8 });
  } catch (_) {
    return "N/A";
  }
}

// V17.4.1 LIVE EXECUTION — OFFICIAL GMX SDK TRANSPORT
// V17.2.4 LIVE DIAGNOSTICS + SELECTION REPAIR
// V17.1.6 SDK SAFE LOADER
// CommonJS resolution is intentional: GMX SDK 1.8.2 may expose a broken
// ESM subpath in GitHub Actions while the package is resolvable via require().
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);


let GmxApiSdk = null;
let PrivateKeySigner = null;
let getViemChain = null;
let GMX_SDK_LOAD_ERROR = null;

async function loadGmxSdkSafe(){
  if(GmxApiSdk && PrivateKeySigner && getViemChain) return true;
  try {
    const sdk = require("@gmx-io/sdk/v2");
    const chains = require("@gmx-io/sdk/configs/chains");
    GmxApiSdk = sdk?.GmxApiSdk || null;
    PrivateKeySigner = sdk?.PrivateKeySigner || null;
    getViemChain = chains?.getViemChain || null;
    GMX_SDK_LOAD_ERROR = null;
    const ok = Boolean(GmxApiSdk && PrivateKeySigner && getViemChain);
    if(!ok) GMX_SDK_LOAD_ERROR = "GMX_SDK_REQUIRED_EXPORTS_UNAVAILABLE";
    console.log("[SDK][LOAD]", {ok,mode:"COMMONJS_REQUIRE",exports:{GmxApiSdk:Boolean(GmxApiSdk),PrivateKeySigner:Boolean(PrivateKeySigner),getViemChain:Boolean(getViemChain)}});
    return ok;
  } catch(error){
    GMX_SDK_LOAD_ERROR = error?.message || String(error);
    console.log("[SDK][FALLBACK]", GMX_SDK_LOAD_ERROR);
    return false;
  }
}

// Hybrid-local symbol normalizer. Kept independent from the legacy V16
// normalization helpers so the Event Engine can never fail because of a
// missing/relocated legacy declaration.
function hybridNormalizeSymbol(symbol){
  if(symbol===null || symbol===undefined) return "";
  let s=String(symbol).trim().toUpperCase();
  s=s.replace(/[-_\/\.]?(PERP|USD|USDC|USDT)$/i,"");
  s=s.replace(/[^A-Z0-9]/g,"");
  return s || "";
}

// V17.1.7 COMPATIBILITY REPAIR: legacy V16 helpers still call normalizeSymbol.
// Keep one canonical normalizer so legacy and hybrid engines use the same symbol mapping.
function normalizeSymbol(symbol){
  return hybridNormalizeSymbol(symbol);
}


// ======================================================
// Smart Money Futures AI Bot
// Version: V17.3.22 / Phase 6 Automatic Execution + Trend Bridge + Radar + Live Entry/Exit Telegram + Resource Guard + Multi-Source Smart Money + Independent Radar + Scope Repair + Market-Aware Minimum Sizing + No Arbitrary Order Floor + Top Trader Intelligence Shadow/Confluence
// Platform: GitHub Actions + Node.js
// Network: Arbitrum Ready
// Execution: LIVE ARMED; ENV EXECUTION_ENABLED=false remains an explicit emergency OFF switch
// ======================================================
 
 
// ================================
// MODULE-SCOPE ERROR HELPERS
// ================================
function safeError(error) {
return error?.message || String(error || "Unknown error");
}

// V17.5.11: GMX USD fields can arrive as 30-decimal fixed-point values.
// Normalize only USD-denominated position fields at the human-USD boundary.
function gmxUsdHumanNumber(value) {
  if (value === null || value === undefined || value === "") return 0;
  let n;
  try { n = Number(value); } catch (_) { return 0; }
  if (!Number.isFinite(n) || n <= 0) return 0;
  // GMX protocol USD fixed-point values are scaled by 1e30.
  // Ordinary human USD values are far below this threshold.
  return n >= 1e12 ? n / 1e30 : n;
}

// V17.3.22: JSON-safe serializer for SDK responses that may contain native BigInt values.
// This is only for persistence/logging boundaries. GMX requests continue using native BigInt.
function jsonStringifySafe(value, space = undefined) {
return JSON.stringify(value, (_key, v) => typeof v === "bigint" ? v.toString() : v, space);
}

// V15.6.7 FIX: Radar price-integrity helpers are module-scope so the
// paper-position exit monitor can access them. V15.6.6 accidentally left
// these helpers inside FUTURES_V6, causing repeated EXIT_MONITOR_ERROR.
function v1565NormalizePrice(value){
  if(value===null || value===undefined || value==="") return 0;
  let n;
  if(typeof value === "number") n=value;
  else if(typeof value === "bigint") n=Number(value);
  else if(typeof value === "string") n=Number(value.replace(/,/g,"").trim());
  else if(typeof value === "object") {
    n=v132NumberValue(value?.usd,value?.value,value?.amount,value?.raw,value?.price,value?.markPrice,value?.indexPrice,value?.oraclePrice,value?.medianPrice);
  } else n=Number(value);
  if(!Number.isFinite(n) || n<=0) return 0;
  // GMX 30-decimal fixed-point USD values are very large.
  // Convert only clearly scaled values; ordinary USD prices remain untouched.
  if(Math.abs(n)>=1e18) {
    const scaled=n/1e30;
    return Number.isFinite(scaled) && scaled>0 ? scaled : 0;
  }
  return n;
}

function v1565MedianPositive(values){
  const nums=(values||[]).map(v1565NormalizePrice).filter(x=>Number.isFinite(x)&&x>0).sort((a,b)=>a-b);
  if(!nums.length) return 0;
  const mid=Math.floor(nums.length/2);
  return nums.length%2 ? nums[mid] : (nums[mid-1]+nums[mid])/2;
}

function v1565PriceRatio(a,b){
  const x=v1565NormalizePrice(a), y=v1565NormalizePrice(b);
  if(!(x>0&&y>0)) return 0;
  return Math.max(x,y)/Math.min(x,y);
}

function v1565RadarPriceIntegrity(entry, exit, options={}){
  const e=v1565NormalizePrice(entry), x=v1565NormalizePrice(exit);
  if(!(e>0) || !(x>0)) return {ok:false,reason:"INVALID_PRICE",entry:e,exit:x,ratio:0};
  const maxRatio=Math.max(2,Number(options.maxRatio||25));
  const ratio=v1565PriceRatio(e,x);
  if(!Number.isFinite(ratio) || ratio>maxRatio){
    return {ok:false,reason:"PRICE_SCALE_MISMATCH",entry:e,exit:x,ratio};
  }
  return {ok:true,reason:"PRICE_OK",entry:e,exit:x,ratio};
}

function v1565RadarNativePrice(row){
  if(!row || typeof row!=="object") return 0;
  return v1565MedianPositive([
    row.__radarNativePrice,
    row.oraclePrice, row.medianPrice, row.markPrice, row.indexPrice,
    row.currentPrice, row.indexPriceUsd, row.maxPrice, row.minPrice
  ]);
}

function radarTickerPrice(row){
  if(!row || typeof row!=="object") return 0;
  const candidates=[
    row.medianPrice, row.price, row.markPrice, row.indexPrice,
    row.oraclePrice, row.maxPrice, row.minPrice
  ];
  return v1565MedianPositive(candidates);
}

 
// ================================
// CONFIGURATION
// ================================
 
 
 
 
const DYNAMIC_RISK_ENGINE = {
enabled: true,
 
// SL is derived from volatility/structure first, then bounded by safety limits.
sl: {
atrMultiplier: 1.8,
structureBufferAtr: 0.25,
minPercent: 0.35,
maxPercent: 3.50
},
 
// TP uses risk/reward plus nearby structure/volatility; it is not a fixed price.
tp: {
minRR: 1.5,
baseRR: 2.0,
strongSignalRR: 2.5,
extremeSignalRR: 3.0
},
 
// Trailing protection activates only after the position has earned enough R.
trailing: {
enabled: true,
activateAfterR: 1.0,
atrMultiplier: 1.2,
tightenAfterR: 1.5,
tightenAtrMultiplier: 0.9
}
};
 
// ======================================================
// V13.9.8 SMART PROFIT-LOCK / ANTI-WICK ENGINE
// TP1 -> lock profit -> TP2 -> lock more profit -> TP3 ->
// lock again and leave a 25% runner for the trend/trailing exit.
// Initial SL breaches are confirmation-based to avoid closing a
// good trade because of a single 5m wick, while catastrophic
// overshoots still close immediately.
// ======================================================
const PROFIT_LOCK_ENGINE = {
enabled: true,
partialClosePercent: { tp1: 25, tp2: 25, tp3: 25 },
runnerPercent: 25,
lockBufferAtr: { tp1: 0.15, tp2: 0.12, tp3: 0.10 },
antiWick: { enabled: true, initialStopConfirmations: 2, maxOvershootAtr: 0.75 },
trailingRunnerOnlyAfterTP3: true
};

function deriveProfitLockPlan(position, market) {
const entry = finitePositive(position?.entryPrice);
const atr = finitePositive(market?.atr ?? market?.indicators?.atr ?? market?.volatility?.atr);
const side = String(position?.side || position?.direction || "").toUpperCase();
const isLong = side === "LONG";
if (!entry || !atr || !["LONG", "SHORT"].includes(side)) return { ready: false };
const initialStop = finitePositive(position?.initialStopPrice ?? position?.stopLoss);
const risk = Math.abs(entry - initialStop);
if (!(risk > 0)) return { ready: false, reason: "initial_stop_required" };
const tp1 = finitePositive(position?.tp1) || (isLong ? entry + risk : entry - risk);
const tp2 = finitePositive(position?.tp2) || (isLong ? entry + risk * 2 : entry - risk * 2);
const tp3 = finitePositive(position?.tp3) || (isLong ? entry + risk * 3 : entry - risk * 3);
const lock = (tp, bufferAtr) => { const buffer = atr * bufferAtr; return Number((isLong ? tp - buffer : tp + buffer).toFixed(8)); };
return { ready: true, side, entry, atr, risk, tp1, tp2, tp3, sl1: lock(tp1, PROFIT_LOCK_ENGINE.lockBufferAtr.tp1), sl2: lock(tp2, PROFIT_LOCK_ENGINE.lockBufferAtr.tp2), sl3: lock(tp3, PROFIT_LOCK_ENGINE.lockBufferAtr.tp3), partialClosePercent: { ...PROFIT_LOCK_ENGINE.partialClosePercent }, runnerPercent: PROFIT_LOCK_ENGINE.runnerPercent };
}

function profitLockStage(position) {
if (position?.tp3Hit) return 3;
if (position?.tp2Hit) return 2;
if (position?.tp1Hit) return 1;
return 0;
}

function applyProfitLock(position, lockPlan, stage) {
if (!lockPlan?.ready || !position || stage < 1) return;
const stop = stage >= 3 ? lockPlan.sl3 : stage >= 2 ? lockPlan.sl2 : lockPlan.sl1;
const current = finitePositive(position.stopLoss);
const better = String(position.side || "").toUpperCase() === "LONG" ? (!current || stop > current) : (!current || stop < current);
if (better) position.stopLoss = stop;
position.protectedStopPrice = Number(position.stopLoss || stop);
position.protectedStage = stage;
position.breakEvenActive = true;
}

function antiWickStopDecision(position, currentPrice, lockPlan) {
const stop = finitePositive(position?.stopLoss);
if (!stop || !lockPlan?.ready) return { breached: false, confirmed: false, catastrophic: false };
const isLong = String(position?.side || "").toUpperCase() === "LONG";
const breached = isLong ? currentPrice <= stop : currentPrice >= stop;
if (!breached) return { breached: false, confirmed: false, catastrophic: false };
const overshoot = lockPlan.atr > 0 ? Math.abs(currentPrice - stop) / lockPlan.atr : 0;
const stage = profitLockStage(position);
const catastrophic = PROFIT_LOCK_ENGINE.antiWick.enabled && stage === 0 && overshoot >= PROFIT_LOCK_ENGINE.antiWick.maxOvershootAtr;
const required = stage > 0 ? 1 : PROFIT_LOCK_ENGINE.antiWick.initialStopConfirmations;
const count = Number(position.stopBreachCount || 0) + 1;
position.stopBreachCount = count;
return { breached: true, confirmed: catastrophic || count >= required, catastrophic, count, required, overshootAtr: Number(overshoot.toFixed(3)) };
}

function clearStopBreach(position, currentPrice) {
const stop = finitePositive(position?.stopLoss);
if (!stop || !currentPrice) return;
const isLong = String(position?.side || "").toUpperCase() === "LONG";
if ((isLong && currentPrice > stop) || (!isLong && currentPrice < stop)) position.stopBreachCount = 0;
}

function finitePositive(v, fallback = 0) {
const n = Number(v);
return Number.isFinite(n) && n > 0 ? n : fallback;
}
 
function deriveDynamicTPSL(position, market) {
const entry = finitePositive(position?.entryPrice);
const atr = finitePositive(
market?.atr ??
market?.indicators?.atr ??
market?.volatility?.atr
);
 
const high = finitePositive(market?.structure?.recentHigh);
const low = finitePositive(market?.structure?.recentLow);
const side = String(position?.side || position?.direction || "").toUpperCase();
const isLong = side === "LONG";
 
// If market inputs are incomplete, do not invent a tradable price.
if (!entry || !atr || (isLong && !low) || (!isLong && !high)) {
return {
ready: false,
reason: "insufficient_market_inputs_for_dynamic_tp_sl",
entryPrice: entry || null,
atr: atr || null
};
}
 
const structureStopDistance = isLong
? Math.max(0, entry - low)
: Math.max(0, high - entry);
 
const volatilityStopDistance = atr * DYNAMIC_RISK_ENGINE.sl.atrMultiplier;
const buffer = atr * DYNAMIC_RISK_ENGINE.sl.structureBufferAtr;
 
const stopDistance = Math.max(
volatilityStopDistance,
structureStopDistance + buffer
);
 
const rawSlPercent = (stopDistance / entry) * 100;
const slPercent = Math.max(
DYNAMIC_RISK_ENGINE.sl.minPercent,
Math.min(DYNAMIC_RISK_ENGINE.sl.maxPercent, rawSlPercent)
);
 
const boundedStopDistance = entry * slPercent / 100;
const stopPrice = isLong
? entry - boundedStopDistance
: entry + boundedStopDistance;
 
const signalScore = Number(
position?.score ??
market?.score ??
0
);
 
const rr =
signalScore >= 90 ? DYNAMIC_RISK_ENGINE.tp.extremeSignalRR :
signalScore >= 80 ? DYNAMIC_RISK_ENGINE.tp.strongSignalRR :
DYNAMIC_RISK_ENGINE.tp.baseRR;
 
const targetDistance = boundedStopDistance * Math.max(
DYNAMIC_RISK_ENGINE.tp.minRR,
rr
);
 
const takeProfitPrice = isLong
? entry + targetDistance
: entry - targetDistance;
 
return {
ready: true,
side,
entryPrice: entry,
atr,
stopLoss: {
price: Number(stopPrice.toFixed(8)),
distance: Number(boundedStopDistance.toFixed(8)),
percent: Number(slPercent.toFixed(4))
},
takeProfit: {
price: Number(takeProfitPrice.toFixed(8)),
distance: Number(targetDistance.toFixed(8)),
percent: Number(((targetDistance / entry) * 100).toFixed(4)),
riskReward: rr
},
method: {
stop: "max(ATR volatility stop, structure stop + ATR buffer), bounded",
target: "dynamic risk/reward based on signal strength"
}
};
}
 
function deriveTrailingStop(position, market, currentPrice) {
if (!DYNAMIC_RISK_ENGINE.trailing.enabled) return { enabled: false };
 
const entry = finitePositive(position?.entryPrice);
const atr = finitePositive(market?.atr ?? market?.indicators?.atr);
const price = finitePositive(currentPrice);
const side = String(position?.side || position?.direction || "").toUpperCase();
 
if (!entry || !atr || !price || !side) {
return { enabled: true, ready: false };
}
 
const risk = Math.abs(entry - finitePositive(position?.initialStopPrice));
if (!risk) return { enabled: true, ready: false, reason: "initial_stop_required" };
 
const pnlDistance = side === "LONG" ? price - entry : entry - price;
const rMultiple = pnlDistance / risk;
 
if (rMultiple < DYNAMIC_RISK_ENGINE.trailing.activateAfterR) {
return { enabled: true, active: false, rMultiple: Number(rMultiple.toFixed(3)) };
}
 
const atrMult = rMultiple >= DYNAMIC_RISK_ENGINE.trailing.tightenAfterR
? DYNAMIC_RISK_ENGINE.trailing.tightenAtrMultiplier
: DYNAMIC_RISK_ENGINE.trailing.atrMultiplier;
 
const distance = atr * atrMult;
const stop = side === "LONG" ? price - distance : price + distance;
 
return {
enabled: true,
active: true,
rMultiple: Number(rMultiple.toFixed(3)),
price: Number(stop.toFixed(8)),
atrMultiplier: atrMult
};
}
 
const EXIT_ENGINE = {
enabled: true,
monitorEveryScan: true,
 
// Exit score is independent from entry score.
// 0-39 HOLD, 40-59 PROTECT, 60-74 PARTIAL_25,
// 75-89 PARTIAL_50, 90-100 FULL.
thresholds: {
protect: 40,
partial25: 60,
partial50: 75,
full: 90
},
 
partialClosePercent: {
first: 25,
second: 50
},
 
// Hard protection always overrides the score engine.
emergency: {
maxRiskScore: 70,
structureBreak: true,
smartMoneyOutflow: true,
trendFlip: true
},
 
trailing: {
enabled: true,
activateAfterR: 1.0,
tightenAfterR: 1.5
}
};
 
const CONFIG = {
VERSION: "V17.8.2-EARLY-IMPULSE-UNLOCK",
MODE: "SIGNAL",
EXECUTION_ENABLED: true, // LIVE armed by default; explicit ENV EXECUTION_ENABLED=false/0/no still disables execution.
PAPER_ENABLED: true,
PAPER_STARTING_BALANCE_USD: 10000,
PAPER_MAX_HOLD_MS: 7 * 24 * 60 * 60 * 1000,
PAPER_EXIT_COOLDOWN_MS: 15 * 60 * 1000,
MAX_POSITIONS: 3,
// Capital allocation is margin/collateral allocation, independent of leverage.
CAPITAL_PER_TRADE: 0.05,
MIN_CAPITAL_ALLOCATION: 0.05,
MAX_CAPITAL_ALLOCATION: 0.20,
MAX_TOTAL_CAPITAL_ALLOCATION: 0.60,
RISK_PER_TRADE: 0.01,
MAX_TOTAL_RISK: 0.03,
DEFAULT_LEVERAGE: 5,
MAX_LEVERAGE: 10,
LEVERAGE_TIERS: [
{ minScore: 88, leverage: 3 },
{ minScore: 92, leverage: 5 },
{ minScore: 95, leverage: 7 },
{ minScore: 98, leverage: 10 }
],
// Margin allocation tiers by signal score.
ALLOCATION_TIERS: [
{ minScore: 75, allocation: 0.05 },
{ minScore: 82, allocation: 0.075 },
{ minScore: 88, allocation: 0.10 },
{ minScore: 93, allocation: 0.125 },
{ minScore: 97, allocation: 0.20 }
],
MIN_SCORE: 88,
// Canonical V6.2 signal tiers.
// WATCH = directional bias worth monitoring; VALID = actionable signal;
// STRONG = high-confluence signal; EXECUTION remains stricter.
WATCH_SCORE: 65,
VALID_SIGNAL_SCORE: 75,
STRONG_SIGNAL_SCORE: 85,
EXECUTION_SCORE: 85,
MIN_SIGNAL_SCORE: 75,
MIN_EDGE: 7,
EXECUTION_MIN_EDGE: 10,
EXECUTION_MAX_RISK: 40,
MAX_MARKETS: 30,
// V15.6: broad Radar is not capped by this legacy compatibility field.
DEEP_SCAN_LIMIT: 18,
  // V17.1.8: every listed/active market gets a lightweight 5m pass each cycle.
  // Only the most relevant markets receive the expensive 15m/1h/4h structure pass.
  HYBRID_BROAD_5M_SCAN_ENABLED: true,
  HYBRID_BROAD_5M_BATCH_SIZE: 20,
  HYBRID_BROAD_5M_LIMIT: 60,
  HYBRID_DEEP_SCAN_LIMIT: 18,
// V15: asset-agnostic ranking. Asset identity/size must not add score or selection priority.
FAIR_ASSET_SCORING_ENABLED: true,
FAIR_LIQUIDITY_SCORE_IN_RADAR: false,
FAIR_MAJOR_SELECTION_BIAS: false,
SCAN_BATCH_SIZE: 2,
NOTIFY_TOP_N: 3,
// V14.0.1: notifications are event-driven, not repeated top-N snapshots.
NOTIFY_EVENT_MAX: 6,
TELEGRAM_EVENT_TTL_MS: 24 * 60 * 60 * 1000,
// Balanced deep coverage quotas; these affect observation coverage, not execution gates.
DIRECTIONAL_DEEP_LONG_SLOTS: 4,
DIRECTIONAL_DEEP_SHORT_SLOTS: 4,
BALANCED_MAJOR_SLOTS: 0,
MAX_SCAN_SUBREQUESTS: 50,
RESERVED_SCAN_SUBREQUESTS: 10,
// V15.5 Phase 5: broad market discovery is separated from deep analysis.
// All eligible GMX markets remain visible to Radar; only a bounded subset
// receives the expensive 4-timeframe deep scan in each invocation.
MARKET_UNIVERSE_PHASE5_ENABLED: true,
DEEP_PRIMARY_SLOTS: 7,
DEEP_EXPLORATION_SLOTS: 3,
DEEP_EXPLORATION_POOL_LIMIT: 100,
DEEP_EXPLORATION_MIN_SCORE: 35,
DEEP_ROTATION_ENABLED: true,
UNIVERSE_DIAGNOSTICS_TOP_N: 25,
// V13.9 opportunity radar
PUMP_RADAR_ENABLED: true,
PUMP_RADAR_WATCH_SCORE: 50,
PUMP_RADAR_HOT_SCORE: 72,
PUMP_RADAR_MIN_DIRECTIONAL_EDGE: 3,
PUMP_RADAR_MAJOR_SLOTS: 0,
PUMP_RADAR_NON_MAJOR_SLOTS: 0,
// V13.9.9: independent Radar trading lane. Radar capacity/risk is separate
// from the three-position Core lane. Live execution remains governed by
// EXECUTION_ENABLED; Paper Radar can be tested independently now.
RADAR_INDEPENDENT_ENABLED: true,
RADAR_PAPER_ENABLED: true,
RADAR_MAX_POSITIONS: 1,
RADAR_ENTRY_SCORE: 72,
// V16.1.2: a HOT Radar is an independent execution signal. Once HOT is
// confirmed, timing-score/exhaustion gates must not silently convert it into
// notification-only. Only invalid price or a confirmed reversal against the
// selected HOT direction may block the entry before wallet/market checks.
RADAR_HOT_EXECUTION_ENABLED: true,
RADAR_EARLY_ENTRY_ENABLED: true,
RADAR_EARLY_ENTRY_SCORE: 60,
RADAR_EARLY_ENTRY_MIN_VELOCITY: 0.75,
RADAR_EARLY_ENTRY_MIN_EDGE: 8,
// V16.0.6: Radar timing/exhaustion guard is separate from movement strength.
RADAR_TIMING_EXHAUSTED_MOVE15: 3.0,
RADAR_TIMING_EXHAUSTED_MOVE30: 5.0,
RADAR_TIMING_DECELERATION: 0.20,
RADAR_TIMING_MIN_ENTRY_SCORE: 45,
// V16.1: separate reversal intelligence from movement strength.
RADAR_HISTORY_RETENTION_SAMPLES: 240,
RADAR_FLOW_HISTORY_RETENTION_SAMPLES: 120,
RADAR_REVERSAL_SCORE_THRESHOLD: 50,
RADAR_REVERSAL_STRONG_THRESHOLD: 70,
RADAR_REVERSAL_PRICE_FLIP_PCT: 0.35,
RADAR_REVERSAL_FLOW_RATIO: 0.35,
RADAR_REVERSAL_CLOSE_RATIO: 0.30,
RADAR_REVERSAL_PENALTY_MAX: 28,
RADAR_REVERSAL_OPPOSITE_BONUS_MAX: 24,
// V16.1.1: candle-aware microstructure overlay.
RADAR_CANDLE_REVERSAL_THRESHOLD: 55,
RADAR_CANDLE_DUMP_SCORE: 60,
RADAR_CANDLE_PUMP_SCORE: 60,
RADAR_CANDLE_RANGE_EXPANSION: 1.45,
RADAR_CANDLE_CLOSE_EXTREME: 0.22,
RADAR_CANDLE_WICK_REJECTION: 0.45,
RADAR_CANDLE_MOVE3_PCT: 1.00,
RADAR_CANDLE_MOVE5_PCT: 1.50,
RADAR_EXIT_SCORE: 65,
RADAR_REVERSAL_EDGE: 8,
RADAR_RISK_PER_TRADE: 0.005,
RADAR_CAPITAL_ALLOCATION: 0.03,
RADAR_MAX_POSITION_NOTIONAL_USD: 2500,
// V15.3.5: independent Radar live lane is armed; execution still honors executionEnabled(env).
RADAR_LIVE_ENABLED: false,
RADAR_LIVE_MAX_POSITIONS: 1,
RADAR_LIVE_RISK_PER_TRADE: 0.005,
RADAR_LIVE_CAPITAL_ALLOCATION: 0.03,
RADAR_LIVE_MAX_POSITION_NOTIONAL_USD: 2500,
RADAR_HOT_MAX_WALLET_RISK: 0.015,
RADAR_LIVE_REVERSAL_CONFIRMATIONS: 1,
RADAR_LIVE_LEDGER_TTL_SEC: 86400,
// V14.0.5.5: live collateral may be USDC or USDT when the selected GMX perp market supports it.
LIVE_COLLATERAL_PREFERENCE: ["USDC","USDT"],
RADAR_SUBREQUEST_RESERVE: 0,
SMART_MONEY_FLOW_ENABLED: true,
SMART_MONEY_FLOW_LIMIT: 250,
SMART_MONEY_FLOW_LOOKBACK_MS: 5 * 60 * 1000,
SMART_MONEY_FLOW_CACHE_MS: 20 * 1000,
SMART_MONEY_FLOW_SPIKE_BASE_SAMPLES: 12,
SMART_MONEY_FLOW_SPIKE_THRESHOLD: 1.80,
SMART_MONEY_FLOW_EXPLOSIVE_THRESHOLD: 3.00,
SMART_MONEY_FLOW_MIN_NOTIONAL_USD: 5000,
SMART_MONEY_FLOW_SCORE_MAX: 18,
// V16.2 Top Trader Intelligence: read-only GMX all-account trade cohort.
// This layer can add positive confluence only; it never creates a hard gate,
// never subtracts score, and never blocks an otherwise eligible execution.
TOP_TRADER_INTELLIGENCE_ENABLED: true,
TOP_TRADER_INTELLIGENCE_CACHE_MS: 60000,
TOP_TRADER_INTELLIGENCE_LOOKBACK_MS: 60 * 60 * 1000,
TOP_TRADER_INTELLIGENCE_LIMIT: 750,
TOP_TRADER_INTELLIGENCE_MAX_ACCOUNTS: 40,
TOP_TRADER_INTELLIGENCE_MIN_TRADES: 2,
TOP_TRADER_INTELLIGENCE_SCORE_MAX: 6,
TOP_TRADER_INTELLIGENCE_MIN_NOTIONAL_USD: 1000,
// V15.6 Multi-Source Data Center
DATA_CENTER_ENABLED: true,
DATA_CENTER_TIMEOUT_MS: 5000,
DATA_CENTER_STALE_MS: 15000,
DATA_CENTER_MAX_TRADE_PAGES: 1,
DATA_CENTER_MAX_TRADE_ROWS: 750,
DATA_CENTER_PRIMARY_API: "https://arbitrum.gmxapi.io/v1",
DATA_CENTER_PEER_API: "https://arbitrum.gmxapi.ai/v1",
DATA_CENTER_ORACLE_PRIMARY: "https://arbitrum-api.gmxinfra.io",
DATA_CENTER_ORACLE_FALLBACKS: [
"https://arbitrum-api-fallback.gmxinfra.io",
"https://arbitrum-api-fallback.gmxinfra2.io"
],
RADAR_HISTORY_SAMPLE_MS: 30000,
RADAR_STOP_MIN_PERCENT: 0.60,
RADAR_STOP_MAX_PERCENT: 3.00,
RADAR_TP_R: { tp1: 1.0, tp2: 1.8, tp3: 2.6 },
RADAR_LEVERAGE_TIERS: [
{ minScore: 72, leverage: 2 },
{ minScore: 79, leverage: 3 },
{ minScore: 85, leverage: 5 },
{ minScore: 91, leverage: 7 }
],
 
// V15.6.8: persistent resource-usage telemetry + conservative internal guard.
// These are bot safety ceilings, not claims about GitHub/GMX provider limits.
// They are intentionally configurable so the scanner can stop before a platform
// quota is exhausted. Normal operation at */5 should remain below these ceilings.
RESOURCE_USAGE_ENABLED: true,
RESOURCE_DAILY_RUN_LIMIT: 300,
RESOURCE_MONTHLY_RUN_LIMIT: 8500,
RESOURCE_DAILY_HTTP_LIMIT: 15000,
RESOURCE_MONTHLY_HTTP_LIMIT: 450000,
RESOURCE_DAILY_GMX_HTTP_LIMIT: 14000,
RESOURCE_MONTHLY_GMX_HTTP_LIMIT: 420000,
RESOURCE_WARN_PERCENT: 80,
RESOURCE_PAUSE_PERCENT: 95,

NOTIFY_WATCH: false,
CRON_RECOMMENDED: "* * * * *",
CRON_INTERVAL_MINUTES: 1,
TELEGRAM_DEDUPE_TTL_MS: 6 * 60 * 60 * 1000,
WATCHLIST: ["BTC-PERP","ETH-PERP","SOL-PERP","ARB-PERP","AVAX-PERP","INJ-PERP","LINK-PERP","OP-PERP","APT-PERP","NEAR-PERP"],
MAX_DAILY_LOSS: 0.10,
DATA_TIMEOUT_MS: 10000,
MARKET_CACHE_TTL_MS: 15000,
CANDLE_CACHE_TTL_MS: 15000,
CANDLE_LIMIT: {"5m":120,"15m":120,"1h":120,"4h":120},
ATR_STOP_MULTIPLIER: 1.5,
TP1_R: 1.0,
TP2_R: 2.0,
TP3_R: 3.0,
MAX_POSITION_NOTIONAL_USD: 5000,
TRAILING_STOP: true,
PARTIAL_TP: true,
TELEGRAM_ENABLED: true,
DIAGNOSTIC_MODE: true,
LIVE_REQUIRE_PRIVATE_KEY: true,

// V17 HYBRID EVENT ENGINE: structure/flow/volume are decision inputs, not score gates.
HYBRID_EVENT_ENGINE_ENABLED: true,
HYBRID_SR: {
  pivotLeft: 2, pivotRight: 2,
  lookback5m: 120, lookback15m: 120, lookback1h: 120, lookback4h: 120,
  mergeAtrDistance: 0.40, zoneAtrWidth: 0.16,
  minTouches: 2, maxZonesPerSide: 8, proximityAtr: 1.20,
  rejectionWickRatio: 0.30, rejectionCloseRatio: 0.60,
  sweepDepthAtr: 0.15, breakoutBufferAtr: 0.10, retestToleranceAtr: 0.22,
  liquidityBins: 24, liquidityLookback5m: 120, liquidityZoneAtr: 0.22,
  liquidityMinScore: 55, liquidityStrongScore: 72, requireLiquidityForReaction: true
},
HYBRID_VOLUME: {
  expansionStrong: 1.40, expansionExplosive: 2.20,
  rangeExpansionStrong: 1.25, rangeExpansionExplosive: 1.80
},
HYBRID_ENTRY: {
  minEvidence: 1, requireFlowOrVolume: false,
  minReactionVolumeRatio: 1.10, minReactionFlowImbalance: 0.08,
  minBreakoutVolumeRatio: 1.15, minBreakoutFlowImbalance: 0.08,
  breakoutMinBodyRatio: 0.45, retestMinBodyRatio: 0.25,
  breakoutRetestTtlMs: 35 * 60 * 1000, maxChaseAtr: 2.10,
  priorMovePct: 0.20, minZoneQuality: 2, maxEntryDistanceAtr: 1.05,
  maxRetestDistanceAtr: 0.70,
  tierFastAllocation: 0.45, tierNormalAllocation: 0.75, tierPrimeAllocation: 1.00,
  allowNeutralActivity: true,
  // V17.3: detect the live 5m impulse before candle close.
  earlyEnabled: true,
  earlyMinMovePct: 0.10,
  earlyMinBodyRatio: 0.30,
  earlyMinVolumeRatio: 1.15,
  earlyMinFlowImbalance: 0.05,
  earlyMinAccelerationPct: 0.03,
  earlyMaxEntryDistanceAtr: 1.50,
  earlyPrebreakToleranceAtr: 0.45,
  earlyMaxExtensionAtr: 1.50,
  earlyMinScore: 62,
  earlyMinEdge: 5,
  earlyMinElapsedMs: 20 * 1000,
  earlyImpulseEnabled: true, earlyImpulseMinBodyRatio: 0.45,
  earlyImpulseMinVolumeRatio: 1.20, earlyImpulseMinFlowImbalance: 0.06,
  earlyImpulseMinAccelerationPct: 0.03, earlyImpulseMaxExtensionAtr: 1.50,
  earlyImpulsePrebreakAtr: 0.30, squeezeMaxBbWidthPct: 3.25,
  squeezeExpansionRatio: 1.08, earlyImpulseMinConfluence: 2
},
HYBRID_RISK: {
  capitalAllocation: 0.20, minLeverage: 3, defaultLeverage: 5, maxLeverage: 10,
  stopAtrBuffer: 0.25, tp1R: 1.0, tp2R: 2.0, tp3R: 3.0,
  maxNotionalUsd: 5000, maxExecutionRisk: 0.015
}
}

// V17.2.4: module-scope Telegram text sanitizer. Keep diagnostics and
// execution-failure notifications independent from any legacy local scope.
function telegramTextSafe(value, fallback = "N/A") {
  let s = value === null || value === undefined || value === "" ? fallback : String(value);
  for (let i = 0; i < 2; i++) {
    if (!/[ÃÂâðØÙ]/.test(s)) break;
    try {
      const repaired = decodeURIComponent(escape(s));
      if (repaired === s) break;
      s = repaired;
    } catch (_) { break; }
  }
  return s.replace(/[\r\n]+/g, " ").trim();
}

// ================================================================
// V17 HYBRID MARKET EVENT ENGINE
// Preserves the large V16 data/AI/risk/execution body while replacing only
// entry decision logic with structure + volume + smart-money event sequencing.
// No weighted score or trend-count gate is used for entry.
// ================================================================
function hybridAtr(candles, period=14){
  const a=Array.isArray(candles)?candles:[]; if(a.length<2)return null; const tr=[];
  for(let i=0;i<a.length;i++){const h=Number(a[i]?.high),l=Number(a[i]?.low);if(!Number.isFinite(h)||!Number.isFinite(l))continue;if(i===0){tr.push(Math.max(0,h-l));continue;}const prev=Number(a[i-1]?.close);tr.push(Math.max(0,h-l,Number.isFinite(prev)?Math.abs(h-prev):0,Number.isFinite(prev)?Math.abs(l-prev):0));}
  const n=Math.max(2,Number(period)||14);if(tr.length<n)return null;let value=tr.slice(0,n).reduce((x,y)=>x+y,0)/n;for(let i=n;i<tr.length;i++)value=((value*(n-1))+tr[i])/n;return Number.isFinite(value)&&value>0?value:null;
}
function hybridTsMs(ts){const n=Number(ts);if(!Number.isFinite(n)||n<=0)return 0;return n<1e12?n*1000:n;}
function hybridCandleIntervalMs(tf){return ({'5m':300000,'15m':900000,'1h':3600000,'4h':14400000}[tf]||300000);}
function hybridClosedCandles(candles,tf){const a=Array.isArray(candles)?candles.filter(Boolean):[];if(a.length<2)return a;const ts=hybridTsMs(a.at(-1)?.timestamp);return ts>0&&ts+hybridCandleIntervalMs(tf)>Date.now()+5000?a.slice(0,-1):a;}
function hybridCandleMetrics(c){const open=Number(c?.open),high=Number(c?.high),low=Number(c?.low),close=Number(c?.close),range=Math.max(0,high-low),body=Math.abs(close-open);return{bullish:close>open,bearish:close<open,range,body,bodyRatio:range>0?body/range:0,lowerWick:range>0?(Math.min(open,close)-low)/range:0,upperWick:range>0?(high-Math.max(open,close))/range:0,closeLocation:range>0?(close-low)/range:0};}
function hybridFlowAligned(flow,direction){const f=Number(flow?.imbalance||0);return Number.isFinite(f)?(direction==='LONG'?f:-f):0;}
function hybridFlowEvidence(flow,direction){const a=hybridFlowAligned(flow,direction),r=[];if(a>=0.15)r.push('SMART_MONEY_FLOW');if(a>=0.30)r.push('STRONG_SMART_MONEY_FLOW');if(Number(flow?.flowSpikeRatio||1)>=Number(CONFIG.SMART_MONEY_FLOW_SPIKE_THRESHOLD||1.8))r.push('FLOW_SURGE');if(Number(flow?.flowSpikeRatio||1)>=Number(CONFIG.SMART_MONEY_FLOW_EXPLOSIVE_THRESHOLD||3))r.push('EXPLOSIVE_FLOW');if(Number(flow?.largeTradeCount||0)>=1)r.push('LARGE_TRADE_PARTICIPATION');if(direction==='LONG'&&Number(flow?.longOpenUsd||0)>Number(flow?.longCloseUsd||0))r.push('LONG_OPENING_PRESSURE');if(direction==='SHORT'&&Number(flow?.shortOpenUsd||0)>Number(flow?.shortCloseUsd||0))r.push('SHORT_OPENING_PRESSURE');return r;}
function hybridCollectPivots(candles,type,lookback){const a=(candles||[]).slice(-lookback),out=[],l=CONFIG.HYBRID_SR.pivotLeft,r=CONFIG.HYBRID_SR.pivotRight;for(let i=l;i<a.length-r;i++){const v=type==='R'?Number(a[i].high):Number(a[i].low);if(!(v>0))continue;let ok=true;for(let j=i-l;j<=i+r;j++)if(j!==i){const x=type==='R'?Number(a[j].high):Number(a[j].low);if((type==='R'&&x>=v)||(type==='S'&&x<=v)){ok=false;break;}}if(ok)out.push({price:v,at:hybridTsMs(a[i].timestamp)});}return out;}
function hybridBuildZones(candlesByTf,currentPrice,currentAtr){
  const atrValue=Number(currentAtr)>0?Number(currentAtr):currentPrice*0.005,all={S:[],R:[]},weights={'5m':1,'15m':1.4,'1h':1.8,'4h':2.1};
  for(const [tf,raw] of Object.entries(candlesByTf||{})){const c=hybridClosedCandles(raw,tf),look=CONFIG.HYBRID_SR['lookback'+tf]||120,tfAtr=Number(hybridAtr(c,14))||atrValue;for(const type of ['S','R'])for(const p of hybridCollectPivots(c,type,look))all[type].push({...p,tf,weight:weights[tf]||1,tfAtr});}
  const out={support:[],resistance:[]};
  for(const type of ['S','R']){const zones=[];for(const p of all[type].sort((a,b)=>b.at-a.at)){const mergeDistance=Math.max(atrValue*CONFIG.HYBRID_SR.mergeAtrDistance,Number(p.tfAtr||atrValue)*0.25),zoneWidth=Math.max(atrValue*CONFIG.HYBRID_SR.zoneAtrWidth,Number(p.tfAtr||atrValue)*0.08);let z=zones.find(x=>Math.abs(x.center-p.price)<=mergeDistance);if(!z){z={center:p.price,low:p.price-zoneWidth,high:p.price+zoneWidth,touches:0,weight:0,timeframes:new Set(),lastAt:p.at};zones.push(z);}z.touches++;z.weight+=p.weight;z.timeframes.add(p.tf);z.center=(z.center*(z.touches-1)+p.price)/z.touches;z.low=Math.min(z.low,p.price-zoneWidth);z.high=Math.max(z.high,p.price+zoneWidth);z.lastAt=Math.max(z.lastAt,p.at);}
    const usable=zones.filter(z=>z.touches>=CONFIG.HYBRID_SR.minTouches||z.timeframes.size>=2).map(z=>({...z,timeframes:[...z.timeframes],quality:Number((z.touches+Math.min(3,z.timeframes.size)*0.75+Math.min(3,z.weight)*0.25).toFixed(2)),distanceAtr:Math.abs(currentPrice-z.center)/atrValue})).filter(z=>z.quality>=CONFIG.HYBRID_ENTRY.minZoneQuality).sort((a,b)=>b.quality-a.quality||a.distanceAtr-b.distanceAtr).slice(0,CONFIG.HYBRID_SR.maxZonesPerSide);
    if(type==='S')out.support=usable;else out.resistance=usable;}return out;
}
function hybridNearestZone(zones,price,maxAtr,atrValue,side){const tol=atrValue*maxAtr;return(zones||[]).filter(z=>side==='S'?Number(z.center)<=price+tol&&price>=Number(z.low)-tol:Number(z.center)>=price-tol&&price<=Number(z.high)+tol).sort((a,b)=>a.distanceAtr-b.distanceAtr||b.quality-a.quality)[0]||null;}
function hybridPercentChange(candles,bars){const a=Array.isArray(candles)?candles:[],n=Math.max(1,Math.floor(Number(bars)||1));if(a.length<=n)return 0;const last=Number(a.at(-1)?.close),prev=Number(a[a.length-1-n]?.close);return prev?((last-prev)/prev)*100:0;}
function hybridSma(values,period){const arr=Array.isArray(values)?values:[],p=Math.max(1,Math.floor(Number(period)||1));if(arr.length<p)return null;const sum=arr.slice(-p).reduce((a,b)=>a+Number(b||0),0);return Number.isFinite(sum)?sum/p:null;}
function hybridVolumeContext(candles){const a=(candles||[]).slice(-40),vol=a.map(c=>Number(c.volume)).filter(v=>v>0),ranges=a.map(c=>Number(c.high)-Number(c.low)).filter(v=>v>0),recentVol=hybridSma(vol,5),baseVol=hybridSma(vol.slice(0,-5),Math.min(20,Math.max(1,vol.length-5))),recentRange=hybridSma(ranges,5),baseRange=hybridSma(ranges.slice(0,-5),Math.min(20,Math.max(1,ranges.length-5))),va=vol.length>=15&&baseVol>0,vr=va?recentVol/baseVol:1,rr=baseRange>0?recentRange/baseRange:1;return{volumeAvailable:va,volumeRatio:vr,rangeRatio:rr,volumeSurge:vr>=CONFIG.HYBRID_VOLUME.expansionStrong,volumeExplosive:vr>=CONFIG.HYBRID_VOLUME.expansionExplosive,volumeDrying:va&&vr<=0.65,rangeExpansion:rr>=CONFIG.HYBRID_VOLUME.rangeExpansionStrong,rangeExplosive:rr>=CONFIG.HYBRID_VOLUME.rangeExpansionExplosive,rangeDrying:rr<=0.75};}
function hybridBuildLiquidityProfile(candles,currentPrice,atrValue){
  const a=(candles||[]).slice(-Number(CONFIG.HYBRID_SR.liquidityLookback5m||120));
  if(!a.length||!(currentPrice>0)||!(atrValue>0)) return {available:false,zones:[],poc:null};
  const step=Math.max(atrValue*0.12,currentPrice*0.0005),map=new Map();
  for(const c of a){const h=Number(c?.high),l=Number(c?.low),o=Number(c?.open),cl=Number(c?.close),v=Math.max(0,Number(c?.volume)||0);if(!(h>0&&l>0&&h>=l&&v>0))continue;const k=Math.round(((h+l+cl)/3)/step),x=map.get(k)||{price:k*step,volume:0,buyVolume:0,sellVolume:0,touches:0};x.volume+=v;x.touches++;if(cl>=o)x.buyVolume+=v;else x.sellVolume+=v;map.set(k,x);}
  const rows=[...map.values()].filter(x=>x.volume>0).sort((a,b)=>b.volume-a.volume);if(!rows.length)return {available:false,zones:[],poc:null};
  const maxVol=rows[0].volume,zones=rows.slice(0,10).map(x=>{const buyRatio=x.volume>0?x.buyVolume/x.volume:.5,sellRatio=1-buyRatio,side=buyRatio>=.58?'BUY':sellRatio>=.58?'SELL':'BALANCED',concentration=x.volume/maxVol,score=Math.min(100,Math.round(concentration*55+Math.min(1,x.touches/8)*20+(side==='BALANCED'?5:25)));return {...x,buyRatio,sellRatio,side,concentration,score,distanceAtr:Math.abs(currentPrice-x.price)/atrValue,low:x.price-.22*atrValue,high:x.price+.22*atrValue};});
  return {available:true,zones,poc:rows[0]};
}
function hybridLiquidityAtZone(profile,zone,side){
  if(!profile?.available||!zone)return {available:false,score:0,side:'UNKNOWN',buyRatio:0,sellRatio:0};
  const width=Math.max(Number(zone.high)-Number(zone.low),.44*Number(zone._atr||0));
  const best=profile.zones.filter(x=>Math.abs(Number(x.price)-Number(zone.center))<=width).sort((a,b)=>a.distanceAtr-b.distanceAtr||b.score-a.score)[0];
  if(!best)return {available:false,score:0,side:'UNKNOWN',buyRatio:0,sellRatio:0};
  const aligned=side==='BUY'?best.buyRatio:best.sellRatio;
  return {available:true,score:best.score,side:best.side,buyRatio:best.buyRatio,sellRatio:best.sellRatio,aligned,price:best.price,concentration:best.concentration};
}
function hybridOrderbookEvidence(flow,side){
  const ob=flow?.orderbook||flow?.orderBook;if(!ob)return {available:false,score:0,aligned:0};
  const raw=Number(ob.imbalance??ob.bidAskImbalance??ob.depthImbalance);if(!Number.isFinite(raw))return {available:false,score:0,aligned:0};
  const aligned=side==='BUY'?raw:-raw;return {available:true,score:Math.min(100,Math.abs(aligned)*100),aligned};
}
function hybridEarlyImpulse(c5,price,atrValue,flow,vol,resistance,support){
  // V17.8.2 EARLY IMPULSE UNLOCK: independent 5M lane.
  // No legacy Score/Radar entry gate; volume OR smart-money flow can confirm activity.
  if(!CONFIG.HYBRID_ENTRY.earlyImpulseEnabled||!(price>0)||!(atrValue>0))
    return {long:false,short:false,evidence:[],reason:'DISABLED_OR_INVALID'};
  const cur=c5.at(-1),prev=c5.at(-2);
  if(!cur||!prev)return {long:false,short:false,evidence:[],reason:'NO_CANDLES'};
  const m=hybridCandleMetrics(cur);
  const move1=hybridPercentChange(c5,1);
  const prevMove=hybridPercentChange(c5.slice(0,-1),1);
  const acceleration=move1-prevMove;
  const atrPct=Math.max(0.0001,atrValue/price*100);
  const bodyAtr=m.body/atrValue,rangeAtr=m.range/atrValue;
  const volumeRatio=Number(vol.volumeRatio||1),rangeRatio=Number(vol.rangeRatio||1);
  const volumePass=vol.volumeAvailable?volumeRatio>=Number(CONFIG.HYBRID_ENTRY.earlyImpulseMinVolumeRatio||1.20):rangeRatio>=1.15;
  const rangePass=rangeAtr>=0.32||rangeRatio>=1.12||vol.rangeExpansion||vol.rangeExplosive;
  const bodyPass=m.bodyRatio>=Number(CONFIG.HYBRID_ENTRY.earlyImpulseMinBodyRatio||0.45)&&bodyAtr>=0.22;
  const accelPass=Math.abs(acceleration)>=Number(CONFIG.HYBRID_ENTRY.earlyImpulseMinAccelerationPct||0.03);
  const flowLong=hybridFlowAligned(flow,'LONG'),flowShort=hybridFlowAligned(flow,'SHORT');
  const flowThreshold=Number(CONFIG.HYBRID_ENTRY.earlyImpulseMinFlowImbalance||0.06);
  const flowLongPass=flowLong>=flowThreshold,flowShortPass=flowShort>=flowThreshold;
  const lookback=c5.slice(-9,-1);
  const priorHigh=lookback.length?Math.max(...lookback.map(x=>Number(x.high)).filter(Number.isFinite)):0;
  const priorLow=lookback.length?Math.min(...lookback.map(x=>Number(x.low)).filter(Number.isFinite)):0;
  const firstBreakLong=priorHigh>0&&Number(cur.close)>priorHigh;
  const firstBreakShort=priorLow>0&&Number(cur.close)<priorLow;
  const compressionBase=c5.slice(-13,-3);
  const avgRange=compressionBase.length?compressionBase.reduce((a,x)=>a+Math.max(0,Number(x.high)-Number(x.low)),0)/compressionBase.length:0;
  const compression=avgRange>0&&Number(prev.high)-Number(prev.low)<=avgRange*0.95;
  const squeezeBase=c5.slice(-22,-2).map(x=>Number(x.close)).filter(Number.isFinite);
  const squeezeMean=squeezeBase.length?squeezeBase.reduce((a,b)=>a+b,0)/squeezeBase.length:0;
  const squeezeSd=squeezeBase.length>=10?Math.sqrt(squeezeBase.reduce((a,x)=>a+(x-squeezeMean)**2,0)/squeezeBase.length):0;
  const squeezeWidth=squeezeMean>0?4*squeezeSd/squeezeMean*100:0;
  const squeeze=squeezeWidth>0&&squeezeWidth<=Number(CONFIG.HYBRID_ENTRY.squeezeMaxBbWidthPct||3.25);
  const expansion=compression||squeeze||vol.rangeExpansion||vol.volumeSurge||vol.volumeExplosive||firstBreakLong||firstBreakShort;
  const extension=Math.abs(move1)/atrPct;
  const notChasing=extension<=Number(CONFIG.HYBRID_ENTRY.earlyImpulseMaxExtensionAtr||1.50);
  const directionalLong=m.bullish&&move1>0,directionalShort=m.bearish&&move1<0;
  const activityLong=volumePass||flowLongPass,activityShort=volumePass||flowShortPass;
  const momentumLong=accelPass||firstBreakLong||vol.rangeExplosive,momentumShort=accelPass||firstBreakShort||vol.rangeExplosive;
  const longConfluence=Number(firstBreakLong)+Number(flowLongPass)+Number(volumePass)+Number(expansion)+Number(accelPass);
  const shortConfluence=Number(firstBreakShort)+Number(flowShortPass)+Number(volumePass)+Number(expansion)+Number(accelPass);
  const long=directionalLong&&bodyPass&&rangePass&&activityLong&&momentumLong&&expansion&&notChasing&&longConfluence>=Number(CONFIG.HYBRID_ENTRY.earlyImpulseMinConfluence||2);
  const short=directionalShort&&bodyPass&&rangePass&&activityShort&&momentumShort&&expansion&&notChasing&&shortConfluence>=Number(CONFIG.HYBRID_ENTRY.earlyImpulseMinConfluence||2);
  const evidence=[];
  if(compression||squeeze)evidence.push('COMPRESSION_RELEASE');
  if(bodyPass)evidence.push('BODY_EXPANSION');
  if(volumePass)evidence.push('VOLUME_OR_RANGE_EXPANSION');
  if(rangePass)evidence.push('RANGE_EXPANSION');
  if(accelPass)evidence.push('ACCELERATION');
  if(firstBreakLong)evidence.push('FIRST_BREAKOUT_HIGH_8');
  if(firstBreakShort)evidence.push('FIRST_BREAKOUT_LOW_8');
  if(flowLongPass)evidence.push('BUY_FLOW_ALIGNMENT');
  if(flowShortPass)evidence.push('SELL_FLOW_ALIGNMENT');
  return {
    long,short,evidence,move1,acceleration,bodyAtr,rangeAtr,volumeRatio,rangeRatio,extension,
    firstBreakLong,firstBreakShort,compression,squeeze,confluenceLong:longConfluence,confluenceShort:shortConfluence,
    gates:{move:Math.abs(move1)>=Number(CONFIG.HYBRID_ENTRY.earlyMinMovePct||0.10),body:bodyPass,volume:volumePass,
      flowLong:flowLongPass,flowShort:flowShortPass,activityLong,activityShort,acceleration:accelPass,
      extension:notChasing,expansion,prebreak:firstBreakLong||firstBreakShort,score:true,edge:true},
    reason:long?'EARLY_LONG_READY':short?'EARLY_SHORT_READY':'GATE_FAIL'
  };
}
function hybridReactionSupport(c,level,flow,vol,atrValue){const m=hybridCandleMetrics(c),inside=c.low<=level.high+atrValue*0.25&&c.close>=level.low,wick=m.lowerWick>=CONFIG.HYBRID_SR.rejectionWickRatio,closeBack=m.closeLocation>=CONFIG.HYBRID_SR.rejectionCloseRatio,sweep=(level.low-c.low)>=atrValue*CONFIG.HYBRID_SR.sweepDepthAtr&&inside,a=hybridFlowAligned(flow,'LONG'),flowOk=a>=CONFIG.HYBRID_ENTRY.minReactionFlowImbalance,volumeOk=vol.volumeAvailable?vol.volumeRatio>=CONFIG.HYBRID_ENTRY.minReactionVolumeRatio:vol.rangeRatio>=1.15,evidence=[];if(wick)evidence.push('LOWER_WICK_REJECTION');if(closeBack)evidence.push('CLOSE_BACK_ABOVE_SUPPORT');if(sweep)evidence.push('LIQUIDITY_SWEEP_RECLAIM');if(flowOk)evidence.push('BUY_FLOW');if(volumeOk)evidence.push('ACTIVITY_CONFIRMATION');return{confirmed:inside&&m.bullish&&(wick||sweep)&&closeBack,evidence,sweep,wick,flowAligned:a,flowOk,volumeOk};}
function hybridReactionResistance(c,level,flow,vol,atrValue){const m=hybridCandleMetrics(c),inside=c.high>=level.low-atrValue*0.20&&c.close<=level.high,wick=m.upperWick>=CONFIG.HYBRID_SR.rejectionWickRatio,closeBack=(1-m.closeLocation)>=CONFIG.HYBRID_SR.rejectionCloseRatio,sweep=(c.high-level.high)>=atrValue*CONFIG.HYBRID_SR.sweepDepthAtr&&inside,a=hybridFlowAligned(flow,'SHORT'),flowOk=a>=CONFIG.HYBRID_ENTRY.minReactionFlowImbalance,volumeOk=vol.volumeAvailable?vol.volumeRatio>=CONFIG.HYBRID_ENTRY.minReactionVolumeRatio:vol.rangeRatio>=1.20,evidence=[];if(wick)evidence.push('UPPER_WICK_REJECTION');if(closeBack)evidence.push('CLOSE_BACK_BELOW_RESISTANCE');if(sweep)evidence.push('LIQUIDITY_SWEEP_RECLAIM');if(flowOk)evidence.push('SELL_FLOW');if(volumeOk)evidence.push('ACTIVITY_CONFIRMATION');return{confirmed:inside&&m.bearish&&(wick||sweep)&&closeBack,evidence,sweep,wick,flowAligned:a,flowOk,volumeOk};}
function hybridBreakout(c,level,direction,flow,vol,atrValue){const m=hybridCandleMetrics(c),buffer=atrValue*CONFIG.HYBRID_SR.breakoutBufferAtr,above=c.close>level.high+buffer,below=c.close<level.low-buffer,a=hybridFlowAligned(flow,direction),volumeOk=vol.volumeAvailable?vol.volumeRatio>=CONFIG.HYBRID_ENTRY.minBreakoutVolumeRatio:vol.rangeRatio>=1.15,flowOk=a>=CONFIG.HYBRID_ENTRY.minBreakoutFlowImbalance,bodyOk=m.bodyRatio>=CONFIG.HYBRID_ENTRY.breakoutMinBodyRatio,broken=direction==='LONG'?above&&m.bullish:below&&m.bearish;return{broken:broken&&bodyOk,above,below,bodyOk,volumeOk,flowOk,aligned:a};}
function hybridRetest(c,level,direction,flow,vol,atrValue){const tol=atrValue*CONFIG.HYBRID_SR.retestToleranceAtr,m=hybridCandleMetrics(c),touched=direction==='LONG'?c.low<=level.high+tol&&c.low>=level.low-tol:c.high>=level.low-tol&&c.high<=level.high+tol,holds=direction==='LONG'?c.close>level.high:c.close<level.low,rejection=direction==='LONG'?(m.bullish&&m.lowerWick>=0.15):(m.bearish&&m.upperWick>=0.15),a=hybridFlowAligned(flow,direction),activity=vol.volumeSurge||vol.rangeExpansion||a>=CONFIG.HYBRID_ENTRY.minReactionFlowImbalance||CONFIG.HYBRID_ENTRY.allowNeutralActivity;return{touched,holds,rejection,activity,aligned:a,confirmed:touched&&holds&&rejection&&activity&&m.bodyRatio>=CONFIG.HYBRID_ENTRY.retestMinBodyRatio};}
function hybridZoneId(z){return z?`${Number(z.center).toFixed(6)}:${Number(z.low).toFixed(6)}:${Number(z.high).toFixed(6)}`:'';}
// V17.7: legacy early-impulse/score entry function removed.
function hybridClassifyStructure(symbol,candles,price,flow,previousState={}){
  const c5=hybridClosedCandles(candles?.['5m']||[],'5m');
  const c15=hybridClosedCandles(candles?.['15m']||[],'15m');
  const c1h=hybridClosedCandles(candles?.['1h']||[],'1h');
  const c4h=hybridClosedCandles(candles?.['4h']||[],'4h');
  const current=c5.at(-1);
  if(!current)return{state:'NO_DATA',direction:'NONE',entries:[],zones:{support:[],resistance:[]},nextState:previousState||{}};

  const atr5=Number(hybridAtr(c5,14))||price*0.005;
  const zones=hybridBuildZones({'5m':c5,'15m':c15,'1h':c1h,'4h':c4h},price,atr5);
  const liquidityProfile=hybridBuildLiquidityProfile(c5,price,atr5);
  for(const z of [...zones.support,...zones.resistance]) z._atr=atr5;
  const vol=hybridVolumeContext(c5);
  const entries=[],watched=[];
  const currentTs=hybridTsMs(current.timestamp)||Date.now();
  const prior=c5.slice(0,-1);
  const move3=hybridPercentChange(prior,3);
  const move5=hybridPercentChange(prior,5);
  const atrPct=price>0?atr5/price*100:0;
  const m=hybridCandleMetrics(current);
  const closes=c5.slice(-20).map(x=>Number(x.close)).filter(Number.isFinite);
  const mean=hybridSma(closes,20);
  const sd=closes.length>=20?Math.sqrt(closes.slice(-20).reduce((a,x)=>a+(x-mean)**2,0)/20):null;
  const bbWidth=mean>0&&Number.isFinite(sd)?(4*sd/mean)*100:null;
  const prevCloses=closes.slice(0,-1),prevMean=hybridSma(prevCloses,Math.min(20,prevCloses.length));
  const prevSd=prevCloses.length>=20?Math.sqrt(prevCloses.slice(-20).reduce((a,x)=>a+(x-prevMean)**2,0)/20):null;
  const prevBbWidth=prevMean>0&&Number.isFinite(prevSd)?(4*prevSd/prevMean)*100:null;
  const bbExpanding=Number.isFinite(bbWidth)&&Number.isFinite(prevBbWidth)&&bbWidth>prevBbWidth*1.05;
  const flowLong=hybridFlowAligned(flow,'LONG'),flowShort=hybridFlowAligned(flow,'SHORT');
  const flowSurge=Boolean(flow?.flowSurge||flow?.explosiveFlow);
  const newCandle=currentTs!==Number(previousState?.lastCandleTs||0);

  // Sharp displacement is a prerequisite, not an entry trigger.
  const sharpThreshold=Math.max(0.45,atrPct*1.15);
  const downImpulse=move3<=-sharpThreshold || move5<=-Math.max(0.65,atrPct*1.55);
  const upImpulse=move3>=sharpThreshold || move5>=Math.max(0.65,atrPct*1.55);
  const explosion=(vol.volumeAvailable?vol.volumeRatio>=1.35:vol.rangeRatio>=1.20) &&
    (vol.rangeExpansion||vol.rangeExplosive||bbExpanding||Math.max(Math.abs(move3),Math.abs(move5))>=sharpThreshold) &&
    m.bodyRatio>=0.42;
  const expansionEvidence=explosion||vol.volumeSurge||vol.rangeExpansion||flowSurge;

  const support=hybridNearestZone(zones.support,price,CONFIG.HYBRID_SR.proximityAtr,atr5,'S');
  const resistance=hybridNearestZone(zones.resistance,price,CONFIG.HYBRID_SR.proximityAtr,atr5,'R');
  const next={...(previousState||{}),updatedAt:Date.now(),lastCandleTs:currentTs};

  // V17.8 early impulse lane: first displacement/break from compression.
  let earlyImpulseHit=false;
  let earlyImpulseInfo=null;
  if(newCandle){
    earlyImpulseInfo=hybridEarlyImpulse(c5,price,atr5,flow,vol,resistance,support);
    if(earlyImpulseInfo.long){ earlyImpulseHit=true; entries.push({direction:'LONG',trigger:'EARLY_IMPULSE_LONG',zone:null,evidence:earlyImpulseInfo.evidence,atr:atr5,price,volume:vol,flow,early:true,entryDistanceAtr:0,tier:'FAST',confirmationCount:3,earlyInfo:earlyImpulseInfo}); }
    else if(earlyImpulseInfo.short){ earlyImpulseHit=true; entries.push({direction:'SHORT',trigger:'EARLY_IMPULSE_SHORT',zone:null,evidence:earlyImpulseInfo.evidence,atr:atr5,price,volume:vol,flow,early:true,entryDistanceAtr:0,tier:'FAST',confirmationCount:3,earlyInfo:earlyImpulseInfo}); }
  }

  // ONLY reversal setups are tradable:
  // bearish impulse -> strong support -> rejection/absorption -> bounce -> pullback/retest -> LONG
  // bullish impulse -> strong resistance -> rejection/absorption -> bounce -> pullback/retest -> SHORT
  if(!earlyImpulseHit && !next.stage && newCandle && support){
    const rx=hybridReactionSupport(current,support,flow,vol,atr5);
    const strongLevel=Number(support.quality||0)>=3 || Number(support.timeframes?.length||0)>=2;
    const hit=current.low<=Number(support.high)+atr5*0.15 && current.close>=Number(support.low);
    const bearishContext=downImpulse && expansionEvidence;
    const flowConflict=flowShort>=0.12;
    const liq=hybridLiquidityAtZone(liquidityProfile,support,'BUY');
    const ob=hybridOrderbookEvidence(flow,'BUY');
    const liquidityConfirmed=(liq.available&&liq.score>=55&&liq.buyRatio>=.55)||(ob.available&&ob.aligned>=.25);
    const absorption=rx.confirmed && (rx.sweep||rx.flowOk||rx.volumeOk) && (!CONFIG.HYBRID_SR.requireLiquidityForReaction||liquidityConfirmed);
    watched.push({type:'SUPPORT',liquidity:liq,orderbook:ob,zone:support,bounce:rx,sharpMove:downImpulse,explosion,flowConflict});
    if(strongLevel&&hit&&bearishContext&&!flowConflict&&absorption){
      next.stage='REACTION_SUPPORT';
      next.direction='LONG'; next.zone=support; next.zoneId=hybridZoneId(support);
      next.reactionCandleTs=currentTs; next.reactionPrice=price;
      next.reactionHigh=Number(current.high); next.reactionLow=Number(current.low);
      next.impulseDirection=-1; next.impulseAt=Date.now(); next.awaySeen=false;
    }
  }
  if(!earlyImpulseHit && !next.stage && newCandle && resistance){
    const rx=hybridReactionResistance(current,resistance,flow,vol,atr5);
    const strongLevel=Number(resistance.quality||0)>=3 || Number(resistance.timeframes?.length||0)>=2;
    const hit=current.high>=Number(resistance.low)-atr5*0.15 && current.close<=Number(resistance.high);
    const bullishContext=upImpulse && expansionEvidence;
    const flowConflict=flowLong>=0.12;
    const liq=hybridLiquidityAtZone(liquidityProfile,resistance,'SELL');
    const ob=hybridOrderbookEvidence(flow,'SELL');
    const liquidityConfirmed=(liq.available&&liq.score>=55&&liq.sellRatio>=.55)||(ob.available&&ob.aligned>=.25);
    const absorption=rx.confirmed && (rx.sweep||rx.flowOk||rx.volumeOk) && (!CONFIG.HYBRID_SR.requireLiquidityForReaction||liquidityConfirmed);
    watched.push({type:'RESISTANCE',liquidity:liq,orderbook:ob,zone:resistance,rejection:rx,sharpMove:upImpulse,explosion,flowConflict});
    if(strongLevel&&hit&&bullishContext&&!flowConflict&&absorption){
      next.stage='REACTION_RESISTANCE';
      next.direction='SHORT'; next.zone=resistance; next.zoneId=hybridZoneId(resistance);
      next.reactionCandleTs=currentTs; next.reactionPrice=price;
      next.reactionHigh=Number(current.high); next.reactionLow=Number(current.low);
      next.impulseDirection=1; next.impulseAt=Date.now(); next.awaySeen=false;
    }
  }

  if(next.stage==='REACTION_SUPPORT'&&next.zone){
    const z=next.zone, fresh=currentTs>Number(next.reactionCandleTs||0);
    const away=fresh&&price>=Number(next.reactionPrice||price)+atr5*0.20;
    if(away)next.awaySeen=true;
    const pullback=fresh&&Boolean(next.awaySeen)&&current.low<=Number(z.high)+atr5*0.22&&current.close>Number(z.high)&&m.bullish&&m.bodyRatio>=0.25;
    const flowConflict=flowShort>=0.12;
    const flowConfirm=flowLong>=0.06;
    const activity=vol.volumeAvailable?vol.volumeRatio>=1.05:vol.rangeRatio>=1.05;
    const vwap5=Number(v7Vwap(c5,60));
    const vwapContext=!Number.isFinite(vwap5)||price>=vwap5*0.998;
    if(pullback&&!flowConflict&&(flowConfirm||activity)&&vwapContext){
      entries.push({direction:'LONG',trigger:'SUPPORT_REACTION_PULLBACK_RETEST',zone:z,evidence:['SHARP_DOWN_MOVE_INTO_SUPPORT','SUPPORT_REACTION','ABSORPTION_OR_SWEEP','BOUNCE_AWAY','PULLBACK_RETEST_HOLD',...(flowConfirm?['BUY_FLOW_CONFIRMATION']:[]),...(activity?['ACTIVITY_CONFIRMATION']:[]),...(explosion?['VOLATILITY_EXPANSION']:[])],atr:atr5,price,volume:vol,flow,entryDistanceAtr:Math.abs(price-Number(z.center))/atr5,tier:'PRIME',confirmationCount:Number(flowConfirm)+Number(activity)+Number(explosion)});
      next.lastTriggeredCandle=currentTs; delete next.stage; delete next.zone; delete next.zoneId; next.awaySeen=false;
    }
  }

  if(next.stage==='REACTION_RESISTANCE'&&next.zone){
    const z=next.zone, fresh=currentTs>Number(next.reactionCandleTs||0);
    const away=fresh&&price<=Number(next.reactionPrice||price)-atr5*0.20;
    if(away)next.awaySeen=true;
    const pullback=fresh&&Boolean(next.awaySeen)&&current.high>=Number(z.low)-atr5*0.22&&current.close<Number(z.low)&&m.bearish&&m.bodyRatio>=0.25;
    const flowConflict=flowLong>=0.12;
    const flowConfirm=flowShort>=0.06;
    const activity=vol.volumeAvailable?vol.volumeRatio>=1.05:vol.rangeRatio>=1.05;
    const vwap5=Number(v7Vwap(c5,60));
    const vwapContext=!Number.isFinite(vwap5)||price<=vwap5*1.002;
    if(pullback&&!flowConflict&&(flowConfirm||activity)&&vwapContext){
      entries.push({direction:'SHORT',trigger:'RESISTANCE_REACTION_PULLBACK_RETEST',zone:z,evidence:['SHARP_UP_MOVE_INTO_RESISTANCE','RESISTANCE_REJECTION','ABSORPTION_OR_SWEEP','BOUNCE_AWAY','PULLBACK_RETEST_HOLD',...(flowConfirm?['SELL_FLOW_CONFIRMATION']:[]),...(activity?['ACTIVITY_CONFIRMATION']:[]),...(explosion?['VOLATILITY_EXPANSION']:[])],atr:atr5,price,volume:vol,flow,entryDistanceAtr:Math.abs(price-Number(z.center))/atr5,tier:'PRIME',confirmationCount:Number(flowConfirm)+Number(activity)+Number(explosion)});
      next.lastTriggeredCandle=currentTs; delete next.stage; delete next.zone; delete next.zoneId; next.awaySeen=false;
    }
  }

  if(next.stage&&Date.now()-Number(next.reactionCandleTs||0)>35*60*1000){delete next.stage;delete next.zone;delete next.zoneId;delete next.awaySeen;next.lastState='REACTION_EXPIRED';}
  if(!next.stage&&!entries.length&&next.lastState!=='REACTION_EXPIRED')next.lastState=(support||resistance)?'WATCH_LEVEL':'NO_SETUP';

  return{
    state:entries.length?'ENTRY_READY':(next.stage||next.lastState||'WATCH_LEVEL'),direction:entries.find(e=>e.direction)?.direction||'NONE',entries,zones,watched,volume:vol,atr:atr5,nextState:next,move5:hybridPercentChange(c5,5),preMove5:move5,extension:atr5>0?Math.abs(price-Number(current.open))/atr5:0,
    eventFlags:{earlyImpulse:earlyImpulseHit,earlyImpulseLong:Boolean(earlyImpulseInfo?.long),earlyImpulseShort:Boolean(earlyImpulseInfo?.short),supportZone:Boolean(support),resistanceZone:Boolean(resistance),supportReaction:watched.some(x=>x.type==='SUPPORT'&&x.bounce?.confirmed),resistanceReaction:watched.some(x=>x.type==='RESISTANCE'&&x.rejection?.confirmed),sharpDownMove:downImpulse,sharpUpMove:upImpulse,explosion,waitingRetest:Boolean(next.stage),retestConfirmed:entries.length>0,pullbackRetest:entries.length>0,breakout:entries.some(e=>String(e.trigger||'').includes('EARLY_IMPULSE')),earlyImpulse:entries.some(e=>String(e.trigger||'').includes('EARLY_IMPULSE')),exhausted:false},
    earlyImpulseInfo,
    indicators:{atrPct:Number(atrPct.toFixed(4)),bbWidth:Number.isFinite(bbWidth)?Number(bbWidth.toFixed(4)):null,bbExpanding,flowLong:Number(flowLong.toFixed(4)),flowShort:Number(flowShort.toFixed(4)),volumeRatio:Number(vol.volumeRatio||1),rangeRatio:Number(vol.rangeRatio||1),liquidityProfileAvailable:Boolean(liquidityProfile.available),liquidityZones:Number(liquidityProfile.zones?.length||0)},
    engine:'DUAL_PATH_LIQUIDITY_REACTION_5M_PLUS_EARLY_IMPULSE_5M'
  };
}
function hybridLeverage(setup){let l=Number(CONFIG.HYBRID_RISK.defaultLeverage||5),t=String(setup?.trigger||'');if(t.includes('RETEST'))l=7;else if(t.includes('BOUNCE')||t.includes('REJECTION'))l=5;if(setup?.flow?.flowSurge)l=Math.max(l,7);if(setup?.flow?.explosiveFlow)l=Math.max(l,8);return Math.max(CONFIG.HYBRID_RISK.minLeverage,Math.min(CONFIG.HYBRID_RISK.maxLeverage,l));}
function hybridBuildEarlySetup(symbol,analysis,flow){
  const e=analysis.entries?.find(x=>x.early&&(/EARLY_IMPULSE_(LONG|SHORT)/).test(String(x.trigger||'')));
  if(!e)return null;
  const price=Number(analysis.price||e.price),atrValue=Number(analysis.atr||e.atr);
  if(!(price>0)||!(atrValue>0))return null;
  const direction=e.direction;
  const c5=analysis.candles?.['5m']||[];
  const closed=hybridClosedCandles(c5,'5m');
  const recent=closed.slice(-5,-1);
  const lows=recent.map(x=>Number(x.low)).filter(Number.isFinite), highs=recent.map(x=>Number(x.high)).filter(Number.isFinite);
  let stop;
  if(direction==='LONG') stop=(lows.length?Math.min(...lows):price-atrValue)-atrValue*0.20;
  else stop=(highs.length?Math.max(...highs):price+atrValue)+atrValue*0.20;
  let r=Math.abs(price-stop);
  r=Math.max(r,atrValue*0.55);
  stop=direction==='LONG'?price-r:price+r;
  const opposite=direction==='LONG'?(analysis.zones?.resistance||[]):(analysis.zones?.support||[]);
  const candidates=opposite.filter(z=>direction==='LONG'?Number(z.center)>price:Number(z.center)<price).sort((a,b)=>Math.abs(Number(a.center)-price)-Math.abs(Number(b.center)-price));
  const target=candidates.find(z=>Math.abs(Number(z.center)-price)>=r*0.90);
  const tp1=target?Number(target.center):(direction==='LONG'?price+r:price-r);
  const tp2=direction==='LONG'?Math.max(price+2*r,tp1+0.5*r):Math.min(price-2*r,tp1-0.5*r);
  const tp3=direction==='LONG'?Math.max(price+3*r,tp2+0.5*r):Math.min(price-3*r,tp2-0.5*r);
  if((direction==='LONG'&&!(stop<price&&tp1>price&&tp2>tp1&&tp3>tp2))||(direction==='SHORT'&&!(stop>price&&tp1<price&&tp2<tp1&&tp3<tp2)))return null;
  return {valid:true,symbol:hybridNormalizeSymbol(symbol),direction,trigger:e.trigger,tier:'FAST',state:'ENTRY_READY',entry:price,entryPrice:price,stopLoss:Number(stop.toFixed(8)),tp1:Number(tp1.toFixed(8)),tp2:Number(tp2.toFixed(8)),tp3:Number(tp3.toFixed(8)),atr:atrValue,stopDistance:r,stopPercent:Number((r/price*100).toFixed(3)),entryDistanceAtr:0,leverage:hybridLeverage({trigger:e.trigger,flow}),allocation:CONFIG.HYBRID_RISK.capitalAllocation,allocationPercent:Number((CONFIG.HYBRID_RISK.capitalAllocation*100).toFixed(2)),riskPerTradePercent:Number((CONFIG.RISK_PER_TRADE*100).toFixed(2)),zone:target||null,zoneType:target?(direction==='LONG'?'RESISTANCE':'SUPPORT'):'NONE',evidence:[...new Set([...(e.evidence||[]),...hybridFlowEvidence(flow,direction)])],confirmationCount:Number(e.confirmationCount||0),entryTier:'FAST',flow,topTrader:null,topTraderPolicy:'NOT_USED_IN_EARLY_LANE',volume:analysis.volume,candleTimestamp:Number(candlesTimestamp(analysis))||0,createdAt:Date.now(),path:'EARLY_IMPULSE_5M',scoreGate:false,retestRequired:false,mtfRequired:false};
}
function hybridBuildSetup(symbol,analysis,flow,topTrader){
  const e=analysis.entries?.find(x=>x.direction==='LONG'||x.direction==='SHORT');if(!e)return null;const price=Number(analysis.price||e.price),atrValue=Number(analysis.atr||e.atr),direction=e.direction,zone=e.zone;if(!(price>0)||!(atrValue>0)||!zone||Number(zone.quality||0)<CONFIG.HYBRID_ENTRY.minZoneQuality)return null;const entryDistanceAtr=Math.abs(price-Number(zone.center))/atrValue;const maxEntryDistanceAtr=e.early?Number(CONFIG.HYBRID_ENTRY.earlyMaxEntryDistanceAtr||CONFIG.HYBRID_ENTRY.maxEntryDistanceAtr):Number(CONFIG.HYBRID_ENTRY.maxEntryDistanceAtr);if(entryDistanceAtr>maxEntryDistanceAtr)return null;
  const stopBase=direction==='LONG'?Number(zone.low):Number(zone.high),buffer=atrValue*CONFIG.HYBRID_RISK.stopAtrBuffer,stop=direction==='LONG'?stopBase-buffer:stopBase+buffer,r=Math.max(Math.abs(price-stop),buffer),oppositeZones=direction==='LONG'?(analysis.zones?.resistance||[]):(analysis.zones?.support||[]),levelTarget=oppositeZones.filter(z=>direction==='LONG'?Number(z.center)>price:Number(z.center)<price).sort((a,b)=>Math.abs(Number(a.center)-price)-Math.abs(Number(b.center)-price))[0],levelDistance=levelTarget?Math.abs(Number(levelTarget.center)-price):0,rMin=r*0.90,tp1=levelTarget&&levelDistance>=rMin?Number(levelTarget.center):(direction==='LONG'?price+r*CONFIG.HYBRID_RISK.tp1R:price-r*CONFIG.HYBRID_RISK.tp1R),tp2=direction==='LONG'?Math.max(price+r*CONFIG.HYBRID_RISK.tp2R,tp1+r*0.5):Math.min(price-r*CONFIG.HYBRID_RISK.tp2R,tp1-r*0.5),tp3=direction==='LONG'?Math.max(price+r*CONFIG.HYBRID_RISK.tp3R,tp2+r*0.5):Math.min(price-r*CONFIG.HYBRID_RISK.tp3R,tp2-r*0.5),trader=ttiScoreForSymbol(topTrader?.cohort||[],hybridNormalizeSymbol(symbol),direction);
  if((direction==='LONG'&&!(stop<price))||(direction==='SHORT'&&!(stop>price)))return null;if((direction==='LONG'&&!(tp1>price&&tp2>tp1&&tp3>tp2))||(direction==='SHORT'&&!(tp1<price&&tp2<tp1&&tp3<tp2)))return null;const tier=['FAST','NORMAL','PRIME'].includes(e.tier)?e.tier:(String(e.trigger).includes('RETEST')?'PRIME':'NORMAL');const allocation=CONFIG.HYBRID_RISK.capitalAllocation;
  return{valid:true,symbol:hybridNormalizeSymbol(symbol),direction,trigger:e.trigger,tier,state:'ENTRY_READY',entry:price,entryPrice:price,stopLoss:Number(stop.toFixed(8)),tp1:Number(tp1.toFixed(8)),tp2:Number(tp2.toFixed(8)),tp3:Number(tp3.toFixed(8)),atr:atrValue,stopDistance:r,stopPercent:Number((r/price*100).toFixed(3)),entryDistanceAtr:Number(entryDistanceAtr.toFixed(3)),leverage:hybridLeverage({trigger:e.trigger,flow}),allocation,allocationPercent:Number((allocation*100).toFixed(2)),riskPerTradePercent:Number((CONFIG.RISK_PER_TRADE*100).toFixed(2)),zone,zoneType:e.trigger.includes('SUPPORT')?'SUPPORT':'RESISTANCE',evidence:[...new Set([...(e.evidence||[]),...hybridFlowEvidence(flow,direction)])],confirmationCount:Number(e.confirmationCount||0),entryTier:tier,flow,topTrader:trader,topTraderPolicy:'CONFIRMATION_ONLY_NO_BLOCK',volume:analysis.volume,candleTimestamp:Number(candlesTimestamp(analysis))||0,createdAt:Date.now()};
}
function candlesTimestamp(a){return a?.candles?.['5m']?.at(-1)?.timestamp||0;}
function hybridEventPriority(signal){const s=signal?.hybridSetup||{},t=String(s.trigger||'');let p=0;if(t.includes('EARLY_IMPULSE'))p+=55;else if(t.includes('RETEST'))p+=40;else if(t.includes('BOUNCE')||t.includes('REJECTION'))p+=30;p+=Math.min(20,Number(s.zone?.quality||0)*2);const d=Number(s.entryDistanceAtr||9);p+=Math.max(0,12-d*8);const f=Math.abs(Number(s.flow?.imbalance||0));p+=Math.min(12,f*30);if(s.volume?.volumeSurge||s.volume?.rangeExpansion)p+=6;if(s.flow?.flowSurge)p+=5;if(s.flow?.explosiveFlow)p+=5;return p;}

function hybridResolveIndexSymbol(m){
  const vals=[m?.indexTokenSymbol,m?.indexName,m?.indexToken?.symbol,m?.indexToken?.tokenSymbol,m?.indexToken?.name,m?.indexTokenData?.symbol,m?.token?.symbol];
  for(const v of vals){const s=hybridNormalizeSymbol(String(v||''));if(s&&s.length<=12)return s;}
  const raw=String(m?.symbol||m?.name||m?.ticker||'');const first=raw.split('/')[0].split('[')[0];
  const s=hybridNormalizeSymbol(first);if(s&&s.length<=12)return s;
  const compact=raw.toUpperCase().replace(/[^A-Z0-9.]/g,'');const known=compact.match(/^(BTC|WBTC|ETH|WETH|SOL|ARB|AVAX|LINK|OP|APT|INJ|NEAR|TAO|ZRO|LTC|BCH|AAVE|VVV|DOGE|XRP|UNI|ATOM|SUI|SEI|ENA|PEPE|BONK)/);
  return known?hybridNormalizeSymbol(known[1]):'';
}

// ======================================================
// V15.3.5 LIVE EXECUTION SWITCH
// Live execution is armed by CONFIG.EXECUTION_ENABLED=true by default.
// Cloudflare ENV EXECUTION_ENABLED=false/0/no is an explicit OFF override.
// This does not alter signal thresholds or entry logic.
// ======================================================
function executionEnabled(env) {
const raw = env?.EXECUTION_ENABLED;
if (raw === undefined || raw === null || String(raw).trim() === "") {
return CONFIG.EXECUTION_ENABLED === true;
}
const value = String(raw).trim().toLowerCase();
if (value === "false" || value === "0" || value === "no" || value === "off") return false;
return value === "true" || value === "1" || value === "yes" || value === "on";
}

function effectiveExecutionMode(env) {
return executionEnabled(env) ? "LIVE" : "PAPER";
}
 
// ======================================================
// V8 DYNAMIC MARKET UNIVERSE / TWO-STAGE FAST SCANNER
// Stage 1: cheap/local screening of known GMX markets.
// Stage 2: deep multi-timeframe analysis only for finalists.
// IMPORTANT: no blind all-market candle fan-out.
// ======================================================
// V13.3 CLEAN NUMERIC PARSER
// Deliberately uses a unique name and is declared before all dynamic-universe code.
// This removes dependency on any legacy numeric helper.
function v132NumberValue(...values) {
const seen=new Set();
const parse=(value,depth=0)=>{
if(depth>5||value===null||value===undefined||value==="")return null;
if(typeof value==="number")return Number.isFinite(value)?value:null;
if(typeof value==="bigint"){const n=Number(value);return Number.isFinite(n)?n:null;}
if(typeof value==="string"){const n=Number(value.replace(/,/g,"").trim());return Number.isFinite(n)?n:null;}
if(typeof value==="object"){
if(seen.has(value))return null;
seen.add(value);
for(const key of ["usd","value","amount","raw","data","valueUsd","usdValue","decimal","formatted","displayValue"]){
if(value[key]!==undefined&&value[key]!==value){const n=parse(value[key],depth+1);if(n!==null)return n;}
}
}
return null;
};
for(const value of values){const n=parse(value);if(n!==null)return n;}
return 0;
}

function v156IsScaled30(n){return Number.isFinite(Number(n))&&Math.abs(Number(n))>=1e18;}
function v156UsdValue(...values){
for(const value of values){const n=v132NumberValue(value);if(Number.isFinite(n)&&n!==0)return v156IsScaled30(n)?n/1e30:n;}
return 0;
}

// SHARED GMX DERIVATIVES / LIQUIDITY HELPERS
// V13.3.1 FIX: these helpers must be in module scope because
// the V8 Dynamic Universe calls them before FUTURES_V6 is entered.
// Keeping them inside FUTURES_V6 causes:
//   ReferenceError: extractOpenInterest is not defined
// ======================================================
 
function extractFunding(m){
const fields=[
m?.fundingRate,m?.fundingRateLong,m?.fundingRateShort,m?.fundingFactorPerSecond,m?.fundingFactor,
m?.funding?.rate,m?.funding?.long,m?.funding?.short,m?.values?.fundingRate,m?.marketValues?.fundingRate
];
for(const field of fields){const n=v132NumberValue(field);if(Number.isFinite(n)&&n!==0)return v156IsScaled30(n)?n/1e30:n;}
return 0;
}

function extractOpenInterest(m){
const direct=v156UsdValue(
m?.openInterest,m?.openInterestUsd,m?.totalOpenInterest,m?.openInterestUSD,
m?.longInterestUsd,m?.shortInterestUsd,m?.longOpenInterestUsd,m?.shortOpenInterestUsd,
m?.ticker?.longInterestUsd,m?.ticker?.shortInterestUsd,m?.ticker?.openInterestUsd,
m?.marketInfo?.longInterestUsd,m?.marketInfo?.shortInterestUsd,
m?.openInterest?.usd,m?.openInterest?.value,m?.values?.openInterest,m?.marketValues?.openInterest
);
if(direct>0)return direct;
// Do not sum the four *InterestUsdUsing*Token fields together: they are
// alternative USD valuations of the same side, not four independent OI buckets.
const firstPositive=(...values)=>{
for(const value of values){const n=v156UsdValue(value);if(n>0)return n;}
return 0;
};
const longOi=firstPositive(
m?.longInterestUsd,
m?.longInterestUsdUsingLongToken,
m?.longInterestUsdUsingShortToken,
m?.longOpenInterestUsd,
m?.longOpenInterest,
m?.values?.longInterestUsdUsingLongToken,
m?.values?.longInterestUsdUsingShortToken,
m?.marketValues?.longInterestUsdUsingLongToken,
m?.marketValues?.longInterestUsdUsingShortToken
);
const shortOi=firstPositive(
m?.shortInterestUsd,
m?.shortInterestUsdUsingLongToken,
m?.shortInterestUsdUsingShortToken,
m?.shortOpenInterestUsd,
m?.shortOpenInterest,
m?.values?.shortInterestUsdUsingLongToken,
m?.values?.shortInterestUsdUsingShortToken,
m?.marketValues?.shortInterestUsdUsingLongToken,
m?.marketValues?.shortInterestUsdUsingShortToken
);
return longOi+shortOi;
}

function extractOpenInterestMeta(m){
const fields=[
m?.openInterest,m?.openInterestUsd,m?.totalOpenInterest,m?.openInterestUSD,
m?.longInterestUsd,m?.shortInterestUsd,m?.longOpenInterestUsd,m?.shortOpenInterestUsd,
m?.ticker?.longInterestUsd,m?.ticker?.shortInterestUsd,m?.ticker?.openInterestUsd,
m?.marketInfo?.longInterestUsd,m?.marketInfo?.shortInterestUsd,
m?.longInterestUsdUsingLongToken,m?.longInterestUsdUsingShortToken,
m?.shortInterestUsdUsingLongToken,m?.shortInterestUsdUsingShortToken,m?.longOpenInterestUsd,m?.shortOpenInterestUsd,
m?.values?.longInterestUsdUsingLongToken,m?.values?.longInterestUsdUsingShortToken,
m?.values?.shortInterestUsdUsingLongToken,m?.values?.shortInterestUsdUsingShortToken,
m?.marketValues?.longInterestUsdUsingLongToken,m?.marketValues?.longInterestUsdUsingShortToken,
m?.marketValues?.shortInterestUsdUsingLongToken,m?.marketValues?.shortInterestUsdUsingShortToken
];
const found=fields.some(v=>v!==undefined&&v!==null&&v!=="");
const value=extractOpenInterest(m);
return{available:found&&value>=0,value};
}

function extractFundingMeta(m){
const fields=[m?.fundingRate,m?.fundingRateLong,m?.fundingRateShort,m?.fundingFactorPerSecond,m?.fundingFactor,m?.funding?.rate,m?.funding?.long,m?.funding?.short,m?.values?.fundingRate,m?.marketValues?.fundingRate];
const found=fields.some(v=>v!==undefined&&v!==null&&v!=="");
return{available:found,value:extractFunding(m)};
}

function extractLiquidity(m) {
// GMX /markets/info exposes poolValueMax/poolValueMin as USD values.
// These are the correct liquidity fields for the fast universe filter.
const direct = v132NumberValue(
m?.liquidity,
m?.totalLiquidity,
m?.poolValueUsd,
m?.poolValue,
m?.poolValueMax,
m?.poolValueMin,
m?.liquidityUsd,
m?.maxPoolAmountUsd,
m?.poolAmountLongUsd, m?.poolAmountShortUsd,
m?.availableLiquidityLong, m?.availableLiquidityShort, m?.availableLiquidity,
m?.values?.poolValueMax, m?.values?.poolValueMin,
m?.values?.poolAmountLongUsd, m?.values?.poolAmountShortUsd,
m?.marketValues?.poolValueMax, m?.marketValues?.poolValueMin,
m?.pool?.valueUsd,
m?.pool?.poolValueUsd,
m?.liquidity?.usd,
m?.totalLiquidity?.usd
);
if (direct > 0) return direct;
 
const usdParts = [
m?.longPoolValueUsd, m?.shortPoolValueUsd,
m?.longPoolAmountUsd, m?.shortPoolAmountUsd,
m?.longPoolUsd, m?.shortPoolUsd,
m?.values?.longPoolAmountUsd, m?.values?.shortPoolAmountUsd,
m?.marketValues?.longPoolAmountUsd, m?.marketValues?.shortPoolAmountUsd
].map(v => v132NumberValue(v)).filter(v => v > 0);
return usdParts.reduce((a,b) => a+b, 0);
}
 
const V8_UNIVERSE = {
ENABLE_DYNAMIC_UNIVERSE: true,
FAST_STAGE_LIMIT: 1000,
DEEP_STAGE_LIMIT: CONFIG.DEEP_SCAN_LIMIT,
MIN_HISTORY_QUALITY: 80,
MIN_DAILY_LIQUIDITY_SCORE: 45,
MIN_VOLATILITY_PCT: 0.15,
MAX_VOLATILITY_PCT: 12,
MIN_PRICE: 0.000001,
REQUIRE_VALID_MARKET: true,
PREFER_MAJOR_MARKETS: false,
MAJOR_SYMBOLS: ["BTC","ETH","SOL","ARB","AVAX","INJ","LINK","OP","APT","NEAR"],
// A candidate can proceed without OI; OI is diagnostics only and is not an entry-score blocker.
OI_OPTIONAL: true,
entryEngine: "LIQUIDITY_REACTION_5M", legacyRadar: "REMOVED", legacyScoreEntry: "REMOVED",
PRECISION: {
enabled: true,
minEntryScore: 72,
strongEntryScore: 85,
minTriggerScore: 60,
maxExtensionAtr: 1.8,
minAdx: 18,
minRiskReward: 1.5,
requireHigherTfAgreement: true,
requireFiveMinuteTrigger: true
}
};
 
function v8NormSymbol(symbol) {
// GMX market-info names are commonly formatted like:
// "BTC/USD [WBTC-USDC]". Normalize to the base index symbol "BTC"
// so major-market preference and downstream symbol matching work.
let s = String(symbol || "").trim().toUpperCase();
s = s.split("[")[0].trim();
s = s.split("/")[0].trim();
s = s.replace(/-PERP$/,"");
s = s.replace(/[^A-Z0-9]/g,"");
return s;
}
 
function v8LiquidityScore(market) {
// GMX /markets/info provides near-live liquidity/open-interest state; 24h volume is optional.
const volume = v132NumberValue(market?.volume24h, market?.volume, market?.dailyVolume, market?.volumeUsd24h, market?.stats?.volume24h, market?.stats?.volumeUsd, market?.volume?.usd);
const oi = extractOpenInterest(market);
const liquidity = extractLiquidity(market);
let score = 0;
if (liquidity > 1e9) score += 55;
else if (liquidity > 3e8) score += 45;
else if (liquidity > 1e8) score += 35;
else if (liquidity > 3e7) score += 25;
else if (liquidity > 1e7) score += 15;
else if (liquidity > 1e6) score += 8;
if (oi > 5e8) score += 35;
else if (oi > 1e8) score += 25;
else if (oi > 1e7) score += 15;
else if (oi > 0) score += 5;
if (volume > 1e8) score += 15;
else if (volume > 3e7) score += 10;
else if (volume > 1e7) score += 7;
else if (volume > 1e6) score += 4;
return Math.min(100, score);
}
 
function v8PercentMetric(market, keys) {
const raw=v132NumberValue(...keys.map(k=>market?.[k]));
if(!Number.isFinite(raw)||raw===0)return 0;
return Math.abs(raw)<=1?raw*100:raw;
}
function v8HighMetric(market, keys) {
const value=v132NumberValue(...keys.map(k=>market?.[k]));
return Number.isFinite(value)&&value>0?value:0;
}
function v8RadarSanitizeHistory(history,currentPrice){
const rows=Array.isArray(history)?history:[];
const now=Date.now();
const cur=v1565NormalizePrice(currentPrice);
const out=[];
for(const x of rows){
  const at=Number(x?.at);
  const price=v1565NormalizePrice(x?.price);
  if(!Number.isFinite(at)||!Number.isFinite(price)||price<=0||at<=0)continue;
  // Reject future samples and samples older than the rolling retention window.
  if(at>now+60000||now-at>48*60*60*1000)continue;
  // V15.6.6: discard legacy/corrupt history before momentum math.
  if(cur>0){
    const ratio=v1565PriceRatio(price,cur);
    if(!Number.isFinite(ratio)||ratio>25)continue;
  }
  out.push({at,price});
}
out.sort((a,b)=>a.at-b.at);
const dedup=[];
for(const x of out){
  const last=dedup[dedup.length-1];
  if(last&&Math.abs(x.at-last.at)<15000){ dedup[dedup.length-1]=x; }
  else dedup.push(x);
}
return dedup.slice(-Number(CONFIG.RADAR_HISTORY_RETENTION_SAMPLES||240));
}
function v8WindowSample(hist,minutes,now=Date.now()){
// V15.6.12: GitHub Actions is a scheduled runner, so the real interval can
// drift around the configured 5-minute cron. Select the nearest valid
// persisted sample around the requested window instead of requiring a sample
// to land inside a narrow +/-1 minute slot. This preserves data integrity while
// preventing scheduler jitter from turning healthy history into WARMUP forever.
const rows=Array.isArray(hist)?hist:[];
if(!rows.length)return null;
const target=now-minutes*60*1000;
const targetMs=minutes*60*1000;
const minAge=Math.max(60*1000,targetMs-2*60*1000);
const maxAge=targetMs+7*60*1000;
let best=null,bestDistance=Infinity;
for(const x of rows){
  const at=Number(x?.at);
  if(!Number.isFinite(at)||at<=0)continue;
  const age=now-at;
  if(age<minAge||age>maxAge)continue;
  const distance=Math.abs(at-target);
  if(distance<bestDistance){best=x;bestDistance=distance;}
}
return best;
}
function v8PctMove(current,prior){
const c=Number(current),p=Number(prior);
if(!(c>0&&p>0))return 0;
const pct=((c-p)/p)*100;
return Number.isFinite(pct)&&Math.abs(pct)<=10000?pct:0;
}
let SMART_MONEY_FLOW_CACHE = { at: 0, result: null };
let TOP_TRADER_INTELLIGENCE_CACHE = { at: 0, result: null };
function smfNum(...values){for(const value of values){const n=Number(value);if(Number.isFinite(n))return n;}return 0;}
// V15.6.2 FIX: Smart-Money parser is global, so it must not reference
// v156Finite/v156ScaledUsd which live inside FUTURES_V6 scope.
function smfFinite(value){const n=Number(value);return Number.isFinite(n)?n:null;}
function smfScaledUsd(value){const n=smfFinite(value);if(n===null)return null;return Math.abs(n)>=1e18?n/1e30:n;}
function smfNormSymbol(symbol){return String(symbol||"").toUpperCase().replace(/\/USD.*$/i,"").replace(/[-_ ]?(PERP|USD|USDC|USDT)$/i,"").replace(/\[.*$/,"").replace(/[^A-Z0-9.]/g,"");}
let SMART_MONEY_MARKET_MAP = Object.create(null);
function smfMarketKey(value){
  const s=String(value||"").trim().toLowerCase();
  return /^0x[a-f0-9]{20,}$/.test(s)?s:"";
}
function smfSetMarketMap(markets){
  const map=Object.create(null);
  for(const m of Array.isArray(markets)?markets:[]){
    const sym=smfNormSymbol(m?.symbol??m?.name??m?.ticker??m?.indexTokenSymbol);
    if(!sym) continue;
    const keys=[
      m?.marketToken,m?.marketAddress,m?.address,m?.market?.address,
      m?.market?.marketToken,m?.market?.marketAddress,
      m?.indexTokenAddress,m?.indexToken?.address
    ];
    for(const k of keys){const key=smfMarketKey(k);if(key)map[key]=sym;}
  }
  SMART_MONEY_MARKET_MAP=map;
  return map;
}
function smfExtractTradeRows(payload){
  const candidates=[
    payload,
    payload?.data,
    payload?.result,
    payload?.trades,
    payload?.data?.trades,
    payload?.result?.trades,
    payload?.items,
    payload?.rows
  ];
  for(const c of candidates) if(Array.isArray(c)) return c;
  return [];
}
function smfTradeSymbol(t){
  const direct=t?.symbol??t?.marketSymbol??t?.indexTokenSymbol??t?.indexName??t?.indexToken?.symbol??t?.market?.symbol??t?.market?.name;
  const directNorm=smfNormSymbol(direct);
  if(directNorm) return directNorm;
  const rawMarket=t?.market?.address??t?.market?.marketToken??t?.marketAddress??t?.marketToken??t?.market;
  const key=smfMarketKey(rawMarket);
  return key&&SMART_MONEY_MARKET_MAP[key] ? SMART_MONEY_MARKET_MAP[key] : "";
}
function smfTradeNotionalUsd(t){
for(const raw of [t?.sizeDeltaUsd,t?.sizeUsd,t?.notionalUsd,t?.notional,t?.executionSizeUsd,t?.positionSizeUsd,t?.sizeDelta?.usd,t?.size?.usd,t?.positionSize?.usd]){
const n=smfFinite(raw);if(n!==null&&Math.abs(n)>0){const usd=smfScaledUsd(n);if(usd!==null&&usd>0)return Math.abs(usd);}
}
let price=0;
for(const raw of [t?.executionPrice,t?.price,t?.markPrice,t?.indexPrice,t?.executionPriceUsd]){
const n=smfFinite(raw);if(n!==null&&n>0){price=smfScaledUsd(n)??n;if(price>0)break;}
}
let size=0;
for(const raw of [t?.sizeDelta,t?.size,t?.quantity,t?.executionSize,t?.sizeDeltaInTokens]){
const n=smfFinite(raw);if(n!==null&&Math.abs(n)>0){size=Math.abs(n);break;}
}
return price>0&&size>0?price*size:0;
}
function smfIsIncrease(t){
if(typeof t?.isIncrease==="boolean")return t.isIncrease;
const event=String(t?.eventName??t?.event??t?.action??t?.orderEvent??t?.orderType??t?.tradeType??"").toLowerCase();
if(/increase|open|long_open|short_open|position_increase/.test(event))return true;
if(/decrease|close|long_close|short_close|position_decrease/.test(event))return false;
return null;
}
function smfDirection(t){
if(typeof t?.isLong==="boolean")return t.isLong?"LONG":"SHORT";
const raw=String(t?.direction??t?.side??t?.positionSide??t?.marketDirection??t?.position?.side??"").toLowerCase();
if(raw==="long"||raw==="buy"||raw==="longs")return "LONG";
if(raw==="short"||raw==="sell"||raw==="shorts")return "SHORT";
return null;
}
function smfSignedPressure(t){
const symbol=smfTradeSymbol(t),direction=smfDirection(t),increase=smfIsIncrease(t),notionalUsd=smfTradeNotionalUsd(t);
if(!symbol||!direction||!(notionalUsd>0)||notionalUsd<Number(CONFIG.SMART_MONEY_FLOW_MIN_NOTIONAL_USD||0))return null;
let sign=direction==="LONG"?1:-1;if(increase===false)sign*=-1;
return{symbol,notionalUsd,signedUsd:notionalUsd*sign,direction,increase};
}
function smfMedian(values){const a=values.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return 0;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;}
function smfAggregateTrades(trades){
const bySymbol={};let rejected=0;
for(const t of trades||[]){const row=smfSignedPressure(t);if(!row?.symbol){rejected++;continue;}
const x=bySymbol[row.symbol]||={buyUsd:0,sellUsd:0,longOpenUsd:0,shortOpenUsd:0,longCloseUsd:0,shortCloseUsd:0,totalUsd:0,signedUsd:0,tradeCount:0,largeTradeCount:0};
x.totalUsd+=row.notionalUsd;x.signedUsd+=row.signedUsd;x.tradeCount++;
if(row.signedUsd>0)x.buyUsd+=row.notionalUsd;else x.sellUsd+=row.notionalUsd;
if(row.direction==="LONG"&&row.increase===true)x.longOpenUsd+=row.notionalUsd;
if(row.direction==="SHORT"&&row.increase===true)x.shortOpenUsd+=row.notionalUsd;
if(row.direction==="LONG"&&row.increase===false)x.longCloseUsd+=row.notionalUsd;
if(row.direction==="SHORT"&&row.increase===false)x.shortCloseUsd+=row.notionalUsd;
if(row.notionalUsd>=100000)x.largeTradeCount++;}
return{bySymbol,rejected};
}
function smfBuildFlowMetrics(raw,previousSamples=[]){
const buyUsd=smfNum(raw?.buyUsd),sellUsd=smfNum(raw?.sellUsd),totalUsd=buyUsd+sellUsd,signedUsd=buyUsd-sellUsd,imbalance=totalUsd>0?signedUsd/totalUsd:0,buyShare=totalUsd>0?buyUsd/totalUsd:0,baseline=smfMedian((previousSamples||[]).map(x=>smfNum(x?.totalUsd)).filter(x=>x>0).slice(-Number(CONFIG.SMART_MONEY_FLOW_SPIKE_BASE_SAMPLES||12))),flowSpikeRatio=baseline>0?totalUsd/baseline:1;
return{buyUsd,sellUsd,totalUsd,signedUsd,buyShare,imbalance,flowSpikeRatio,flowSurge:flowSpikeRatio>=Number(CONFIG.SMART_MONEY_FLOW_SPIKE_THRESHOLD||1.8),explosiveFlow:flowSpikeRatio>=Number(CONFIG.SMART_MONEY_FLOW_EXPLOSIVE_THRESHOLD||3),confidence:smfConfidence({totalUsd,signedUsd,imbalance,flowSpikeRatio,flowSurge:flowSpikeRatio>=Number(CONFIG.SMART_MONEY_FLOW_SPIKE_THRESHOLD||1.8),explosiveFlow:flowSpikeRatio>=Number(CONFIG.SMART_MONEY_FLOW_EXPLOSIVE_THRESHOLD||3),tradeCount:Number(raw?.tradeCount||0),largeTradeCount:Number(raw?.largeTradeCount||0)}),tradeCount:Number(raw?.tradeCount||0),largeTradeCount:Number(raw?.largeTradeCount||0),longOpenUsd:smfNum(raw?.longOpenUsd),shortOpenUsd:smfNum(raw?.shortOpenUsd),longCloseUsd:smfNum(raw?.longCloseUsd),shortCloseUsd:smfNum(raw?.shortCloseUsd)};
}
function smfDirectionalBoost(flow,direction){if(!flow||!["LONG","SHORT"].includes(direction))return 0;const imbalance=Number(flow.imbalance||0),aligned=direction==="LONG"?imbalance:-imbalance;if(!Number.isFinite(aligned))return 0;let boost=Math.min(8,Math.max(0,aligned)*12),spike=Number(flow.flowSpikeRatio||1);if(spike>=Number(CONFIG.SMART_MONEY_FLOW_EXPLOSIVE_THRESHOLD||3))boost+=5;else if(spike>=Number(CONFIG.SMART_MONEY_FLOW_SPIKE_THRESHOLD||1.8))boost+=3;if(Number(flow.largeTradeCount||0)>=2)boost+=2;return Math.min(Number(CONFIG.SMART_MONEY_FLOW_SCORE_MAX||18),Math.max(0,boost));}
function smfReversalMetrics(flow,direction){
  if(!flow||!["LONG","SHORT"].includes(direction)) return {risk:0,opposingUsd:0,supportingUsd:0,opposingRatio:0,closeRatio:0,divergence:false,reasons:[]};
  const longOpen=Number(flow.longOpenUsd||0),shortOpen=Number(flow.shortOpenUsd||0),longClose=Number(flow.longCloseUsd||0),shortClose=Number(flow.shortCloseUsd||0);
  const supportingUsd=direction==="LONG"?(longOpen+shortClose):(shortOpen+longClose);
  const opposingUsd=direction==="LONG"?(longClose+shortOpen):(shortClose+longOpen);
  const total=Math.max(0,supportingUsd)+Math.max(0,opposingUsd);
  const opposingRatio=total>0?opposingUsd/total:0;
  const closeUsd=direction==="LONG"?longClose:shortClose;
  const openUsd=direction==="LONG"?longOpen:shortOpen;
  const closeRatio=(closeUsd+openUsd)>0?closeUsd/(closeUsd+openUsd):0;
  const imbalance=Number(flow.imbalance||0);
  const against=direction==="LONG"?imbalance< -Number(CONFIG.RADAR_REVERSAL_FLOW_RATIO||0.35):imbalance>Number(CONFIG.RADAR_REVERSAL_FLOW_RATIO||0.35);
  let risk=0;const reasons=[];
  if(opposingRatio>=Number(CONFIG.RADAR_REVERSAL_FLOW_RATIO||0.35)){risk+=20;reasons.push("OPPOSING_FLOW_RATIO_HIGH");}
  if(opposingRatio>=0.50){risk+=12;reasons.push("OPPOSING_FLOW_DOMINANT");}
  if(closeRatio>=Number(CONFIG.RADAR_REVERSAL_CLOSE_RATIO||0.30)){risk+=18;reasons.push("POSITION_CLOSURES_ELEVATED");}
  if(closeRatio>=0.50){risk+=10;reasons.push("POSITION_CLOSURES_DOMINANT");}
  if(against){risk+=18;reasons.push("FLOW_DIVERGENCE");}
  if(Number(flow.flowSpikeRatio||1)>=Number(CONFIG.SMART_MONEY_FLOW_SPIKE_THRESHOLD||1.8)&&against){risk+=8;reasons.push("FLOW_SURGE_AGAINST_DIRECTION");}
  return {risk:Math.min(100,risk),opposingUsd,supportingUsd,opposingRatio,closeRatio,divergence:against,reasons:[...new Set(reasons)]};
}
function smfConfidence(flow){if(!flow)return{level:"UNAVAILABLE",score:0};const total=Number(flow.totalUsd||0),trades=Number(flow.tradeCount||0),large=Number(flow.largeTradeCount||0),imbalance=Math.abs(Number(flow.imbalance||0)),surge=Boolean(flow.flowSurge||flow.explosiveFlow);let score=0;if(total>0)score+=20;if(trades>=3)score+=20;if(trades>=10)score+=15;if(large>=1)score+=20;if(large>=2)score+=10;if(imbalance>=0.20)score+=10;if(surge)score+=15;score=Math.min(100,score);return{level:score>=75?"HIGH":score>=45?"MEDIUM":"LOW",score};}
function smfFlowReasons(flow,direction){if(!flow||!["LONG","SHORT"].includes(direction))return[];const aligned=direction==="LONG"?Number(flow.imbalance||0):-Number(flow.imbalance||0),reasons=[];if(aligned>=.2)reasons.push("smart_money_imbalance");if(aligned>=.45)reasons.push("strong_smart_money_flow");if(Number(flow.flowSpikeRatio||1)>=Number(CONFIG.SMART_MONEY_FLOW_SPIKE_THRESHOLD||1.8))reasons.push("flow_surge");if(Number(flow.flowSpikeRatio||1)>=Number(CONFIG.SMART_MONEY_FLOW_EXPLOSIVE_THRESHOLD||3))reasons.push("explosive_flow");if(Number(flow.largeTradeCount||0)>=2)reasons.push("large_order_participation");return reasons;}
function ttiNum(v){
  const n=Number(v); return Number.isFinite(n)?n:0;
}
function ttiAccount(t){
  return String(t?.account??t?.trader??t?.userAddress??t?.user??t?.owner??t?.address??t?.accountAddress??"").toLowerCase();
}
function ttiPnl(t){
  for(const v of [t?.realizedPnlUsd,t?.realizedPnl,t?.pnlUsd,t?.pnl,t?.profitUsd,t?.profit,t?.position?.realizedPnlUsd,t?.debug?.realizedPnlUsd]){
    const n=Number(v); if(Number.isFinite(n)) return Math.abs(n)>=1e18?n/1e30:n;
  }
  return null;
}
function ttiTimestamp(t){
  const n=Number(t?.timestamp??t?.createdAt??t?.updatedAt??t?.blockTimestamp??0);
  return n>1e12?n:n*1000;
}
function ttiBuildCohort(trades){
  const accounts=new Map();
  for(const t of trades||[]){
    const account=ttiAccount(t), symbol=smfTradeSymbol(t), direction=smfDirection(t), notional=smfTradeNotionalUsd(t);
    if(!account||!symbol||!direction||!(notional>=Number(CONFIG.TOP_TRADER_INTELLIGENCE_MIN_NOTIONAL_USD||0))) continue;
    const a=accounts.get(account)||{account,trades:0,notional:0,longUsd:0,shortUsd:0,pnlKnown:0,pnlSum:0,pnlWins:0,pnlLosses:0,lastTs:0,bySymbol:{}};
    a.trades++; a.notional+=notional; if(direction==='LONG')a.longUsd+=notional; else a.shortUsd+=notional;
    const pnl=ttiPnl(t); if(pnl!==null){a.pnlKnown++;a.pnlSum+=pnl;if(pnl>0)a.pnlWins++;else if(pnl<0)a.pnlLosses++;}
    a.lastTs=Math.max(a.lastTs,ttiTimestamp(t));
    const x=a.bySymbol[symbol]||={longUsd:0,shortUsd:0,trades:0}; x.trades++; if(direction==='LONG')x.longUsd+=notional; else x.shortUsd+=notional;
    accounts.set(account,a);
  }
  const ranked=[...accounts.values()].filter(a=>a.trades>=Number(CONFIG.TOP_TRADER_INTELLIGENCE_MIN_TRADES||2)).map(a=>{
    const pnlQuality=a.pnlKnown>0?Math.max(0,Math.min(1,a.pnlSum>=0?0.6+0.4*(a.pnlWins/Math.max(1,a.pnlKnown)):0.25)):0.5;
    const sizeQuality=Math.min(1,Math.log10(Math.max(1,a.notional))/7);
    const consistency=a.pnlKnown>=3?Math.min(1,a.pnlWins/a.pnlKnown):0.5;
    a.quality=100*(0.45*pnlQuality+0.30*sizeQuality+0.25*consistency); return a;
  }).sort((a,b)=>b.quality-a.quality).slice(0,Number(CONFIG.TOP_TRADER_INTELLIGENCE_MAX_ACCOUNTS||40));
  return ranked;
}
function ttiScoreForSymbol(cohort,symbol,direction){
  if(!Array.isArray(cohort)||!cohort.length||!['LONG','SHORT'].includes(direction)) return {available:false,boost:0,alignment:0,conflict:0,activeTraders:0,quality:0,notionalUsd:0};
  let aligned=0,opposed=0,qualitySum=0,active=0;
  for(const a of cohort){const x=a.bySymbol?.[symbol];if(!x)continue;active++;const q=Math.max(0,Math.min(1,a.quality/100));qualitySum+=a.quality; if(direction==='LONG'){aligned+=x.longUsd*q;opposed+=x.shortUsd*q;}else{aligned+=x.shortUsd*q;opposed+=x.longUsd*q;}}
  const total=aligned+opposed, alignment=total>0?aligned/total:0, conflict=total>0?opposed/total:0;
  // Positive-only confluence: opposing top-trader flow is reported but never penalizes/block execution.
  const boost=Math.min(Number(CONFIG.TOP_TRADER_INTELLIGENCE_SCORE_MAX||6),Math.max(0,(alignment-0.50)*12)+Math.min(2,active*0.35));
  return {available:active>0,boost:Number(boost.toFixed(2)),alignment:Number(alignment.toFixed(3)),conflict:Number(conflict.toFixed(3)),activeTraders:active,quality:Number((active?qualitySum/active:0).toFixed(1)),notionalUsd:Number(total.toFixed(2))};
}
async function fetchTopTraderIntelligence(env){
  if(!CONFIG.TOP_TRADER_INTELLIGENCE_ENABLED)return {available:false,source:null,cohort:[],error:'disabled'};
  const now=Date.now();
  if(TOP_TRADER_INTELLIGENCE_CACHE.result&&now-TOP_TRADER_INTELLIGENCE_CACHE.at<Number(CONFIG.TOP_TRADER_INTELLIGENCE_CACHE_MS||60000))return TOP_TRADER_INTELLIGENCE_CACHE.result;
  try{
    const params={forAllAccounts:'true',fromTimestamp:Math.floor((now-Number(CONFIG.TOP_TRADER_INTELLIGENCE_LOOKBACK_MS||3600000))/1000),limit:Number(CONFIG.TOP_TRADER_INTELLIGENCE_LIMIT||750),showDebugValues:'true'};
    const direct=await fetchGmxApiTradesSearch(params);
    let trades=direct.ok?direct.trades:[]; let source=direct.source||null;
    if(!trades.length&&typeof GmxApiSdk!=='undefined'){
      const sdk=new GmxApiSdk({chainId:42161});
      const result=await sdk.searchTrades({forAllAccounts:true,fromTimestamp:params.fromTimestamp,limit:params.limit,showDebugValues:true});
      trades=smfExtractTradeRows(result); source='SDK_V2_SEARCH_TRADES';
    }
    const cohort=ttiBuildCohort(trades.slice(0,Number(CONFIG.TOP_TRADER_INTELLIGENCE_LIMIT||750)));
    const out={available:cohort.length>0,source:source||'GMX_API_TRADES_SEARCH',cohort,accounts:cohort.length,trades:trades.length,lookbackMs:Number(CONFIG.TOP_TRADER_INTELLIGENCE_LOOKBACK_MS||3600000),cacheMs:Number(CONFIG.TOP_TRADER_INTELLIGENCE_CACHE_MS||60000),mode:'NON_BLOCKING_POSITIVE_CONFLUENCE'};
    TOP_TRADER_INTELLIGENCE_CACHE={at:now,result:out}; return out;
  }catch(error){const out={available:false,source:null,cohort:[],accounts:0,trades:0,error:safeError(error),mode:'NON_BLOCKING_POSITIVE_CONFLUENCE'};TOP_TRADER_INTELLIGENCE_CACHE={at:now,result:out};return out;}
}

async function fetchSmartMoneyFlowData(env,flowHistory={}){
if(!CONFIG.SMART_MONEY_FLOW_ENABLED)return{available:false,source:null,bySymbol:{},trades:0,parsedTrades:0,symbols:0,rejectedTrades:0,error:"disabled"};
const now=Date.now();
if(SMART_MONEY_FLOW_CACHE.result&&now-SMART_MONEY_FLOW_CACHE.at<Number(CONFIG.SMART_MONEY_FLOW_CACHE_MS||20000))return SMART_MONEY_FLOW_CACHE.result;
try{
let allTrades=[],cursor=null,source=null,errors=[];
const maxPages=Math.max(1,Number(CONFIG.DATA_CENTER_MAX_TRADE_PAGES||2));
for(let page=0;page<maxPages;page++){
const params={forAllAccounts:"true",fromTimestamp:Math.floor((now-Number(CONFIG.SMART_MONEY_FLOW_LOOKBACK_MS||300000))/1000),limit:Number(CONFIG.SMART_MONEY_FLOW_LIMIT||250),showDebugValues:"true"};
if(cursor)params.cursor=cursor;
const direct=await fetchGmxApiTradesSearch(params);
if(direct.ok){allTrades.push(...direct.trades);source=direct.source;cursor=direct.cursor;errors.push(...(direct.errors||[]));if(!cursor||!direct.trades.length)break;}
else{errors.push(...(direct.errors||[]));break;}
}
if(!allTrades.length&&typeof GmxApiSdk!=="undefined"){
const sdk=new GmxApiSdk({chainId:42161});
const result=await sdk.searchTrades({forAllAccounts:true,fromTimestamp:Math.floor((now-Number(CONFIG.SMART_MONEY_FLOW_LOOKBACK_MS||300000))/1000),limit:Number(CONFIG.SMART_MONEY_FLOW_LIMIT||250),showDebugValues:true});
allTrades=smfExtractTradeRows(result);source="SDK_V2_SEARCH_TRADES";
}
const cappedTrades=allTrades.slice(0,Number(CONFIG.DATA_CENTER_MAX_TRADE_ROWS||750));
const aggregated=smfAggregateTrades(cappedTrades),bySymbol={};
for(const [symbol,row] of Object.entries(aggregated.bySymbol))bySymbol[symbol]=smfBuildFlowMetrics(row,Array.isArray(flowHistory?.[symbol])?flowHistory[symbol].slice(-47):[]);
const out={available:true,source:source||"GMX_API_TRADES_SEARCH",trades:cappedTrades.length,symbols:Object.keys(bySymbol).length,bySymbol,parsedTrades:Object.values(bySymbol).reduce((n,x)=>n+Number(x.tradeCount||0),0),rejectedTrades:Number(aggregated.rejected||0),error:errors.length?errors.slice(-3).join(" | "):null,lookbackMs:Number(CONFIG.SMART_MONEY_FLOW_LOOKBACK_MS||300000),cacheMs:Number(CONFIG.SMART_MONEY_FLOW_CACHE_MS||20000),spikeThreshold:Number(CONFIG.SMART_MONEY_FLOW_SPIKE_THRESHOLD||1.8),explosiveThreshold:Number(CONFIG.SMART_MONEY_FLOW_EXPLOSIVE_THRESHOLD||3)};
SMART_MONEY_FLOW_CACHE={at:now,result:out};return out;
}catch(error){const out={available:false,source:null,trades:0,symbols:0,bySymbol:{},parsedTrades:0,rejectedTrades:0,error:safeError(error)};SMART_MONEY_FLOW_CACHE={at:now,result:out};return out;}
}
function smfPersistHistory(flowHistory,flowData,now=Date.now()){
const next=flowHistory&&typeof flowHistory==="object"?{...flowHistory}:{};
for(const [symbol,flow] of Object.entries(flowData?.bySymbol||{})){
const arr=Array.isArray(next[symbol])?next[symbol].slice(-(Number(CONFIG.RADAR_FLOW_HISTORY_RETENTION_SAMPLES||120)-1)):[];
const sample={at:now,totalUsd:Number(flow.totalUsd||0),buyUsd:Number(flow.buyUsd||0),sellUsd:Number(flow.sellUsd||0),imbalance:Number(flow.imbalance||0)};
const last=arr[arr.length-1];
if(!last||now-Number(last.at||0)>=Number(CONFIG.RADAR_HISTORY_SAMPLE_MS||30000))arr.push(sample);else arr[arr.length-1]=sample;
next[symbol]=arr.slice(-Number(CONFIG.RADAR_FLOW_HISTORY_RETENTION_SAMPLES||120));
}
return next;
}
function v8PumpRadar(market, previous=null, history=[]){
if(!market)return{score:0,longScore:0,shortScore:0,edge:0,direction:"NEUTRAL",reasons:["missing_market"],priceDataStatus:"INVALID"};
const price=v8HighMetric(market,["price","markPrice","indexPrice","currentPrice","indexPriceUsd"]);
const prevPriceRaw=v8HighMetric(previous,["price","markPrice","indexPrice","currentPrice"]);
const prevPrice=v1565RadarPriceIntegrity(price,prevPriceRaw,{maxRatio:25}).ok?prevPriceRaw:0;
const p24Bps=v132NumberValue(market?.priceChangePercent24hBps);
const p24=p24Bps!==0?p24Bps/100:v8PercentMetric(market,["priceChange24h","priceChangePercent24h","change24h","priceChange24H","changePercent24h"]);
const p1h=v8PercentMetric(market,["priceChange1h","priceChangePercent1h","change1h","priceChange1H","changePercent1h"]);
const p4h=v8PercentMetric(market,["priceChange4h","priceChangePercent4h","change4h","change4H","priceChange4H","changePercent4h"]);
const volume=v8HighMetric(market,["volume24h","volume","dailyVolume","volumeUsd24h","volume24H"]);
const prevVolume=v8HighMetric(previous,["volume24h","volume","dailyVolume","volumeUsd24h"]);
const volumeRatio=prevVolume>0&&volume>0?volume/prevVolume:1;
const smartMoneyFlow=market?.__smartMoneyFlow||null;
const oi=extractOpenInterest(market),prevOi=extractOpenInterest(previous);
const oiChangePct=prevOi>0&&oi>0?((oi-prevOi)/prevOi)*100:0;
const high24h=v8HighMetric(market,["high24h","highPrice24h","dailyHigh","high24H"]);
const low24h=v8HighMetric(market,["low24h","lowPrice24h","dailyLow","low24H"]);
const nearHigh=price>0&&high24h>0&&price/high24h>=0.992;
const nearLow=price>0&&low24h>0&&price/low24h<=1.008;
const rangePct=price>0&&high24h>0&&low24h>0?((high24h-low24h)/price)*100:0;
const priorMovePct=v8PctMove(price,prevPrice);

const rawHist=Array.isArray(history)?history.filter(x=>Number(x?.price)>0&&Number(x?.at)>0).slice(-Number(CONFIG.RADAR_HISTORY_RETENTION_SAMPLES||240)):[];
const hist=v8RadarSanitizeHistory(rawHist,price);
const now=Date.now();
const latest=hist.length?hist[hist.length-1]:null;
const prior5=v8WindowSample(hist,5,now);
const prior10=v8WindowSample(hist,10,now);
const prior15=v8WindowSample(hist,15,now);
const prior30=v8WindowSample(hist,30,now);
const latestPrice=latest?Number(latest.price):0;
const velocity5m=prior5?v8PctMove(price,prior5.price):0;
const move10m=prior10?v8PctMove(price,prior10.price):0;
const move15m=prior15?v8PctMove(price,prior15.price):0;
const move30m=prior30?v8PctMove(price,prior30.price):0;
const prior5m=prior5&&latestPrice>0?v8PctMove(latestPrice,prior5.price):0;
const acceleration5m=prior5?(velocity5m-prior5m):0;
const radarWarmup=!(prior5||prior15);
const priceDataStatus=price>0?(hist.length?"OK":"WARMUP"):"INVALID";
const radarHistoryReady=Boolean(prior5||prior15);
const historyIntegrityOk=price>0 && (!latestPrice || v1565RadarPriceIntegrity(price,latestPrice,{maxRatio:25}).ok);

const historyMoveAllowed=historyIntegrityOk && radarHistoryReady;
const historicalMoves=historyMoveAllowed?[priorMovePct,move10m,move15m,move30m]:[];
const positiveMove=Math.max(p24,p4h,p1h,...historicalMoves);
const negativeMove=Math.min(p24,p4h,p1h,...historicalMoves);
let long=0,short=0;const reasonsLong=[],reasonsShort=[];
const smartMoneyLongBoost=smfDirectionalBoost(smartMoneyFlow,"LONG"),smartMoneyShortBoost=smfDirectionalBoost(smartMoneyFlow,"SHORT");
long+=smartMoneyLongBoost;short+=smartMoneyShortBoost;
for(const r of smfFlowReasons(smartMoneyFlow,"LONG"))reasonsLong.push(r);
for(const r of smfFlowReasons(smartMoneyFlow,"SHORT"))reasonsShort.push(r);
if(positiveMove>0.5){long+=5;reasonsLong.push("price_acceleration");}
if(positiveMove>1){long+=7;reasonsLong.push("strong_momentum");}
if(positiveMove>3){long+=10;reasonsLong.push("impulse_move");}
if(positiveMove>5){long+=12;reasonsLong.push("impulse_move");}
if(positiveMove>10){long+=16;reasonsLong.push("explosive_move");}
if(positiveMove>15){long+=12;reasonsLong.push("parabolic_move");}
if(positiveMove>25){long+=8;reasonsLong.push("extreme_move");}
if(negativeMove<-0.5){short+=5;reasonsShort.push("price_acceleration");}
if(negativeMove<-1){short+=7;reasonsShort.push("strong_momentum");}
if(negativeMove<-3){short+=10;reasonsShort.push("impulse_move");}
if(negativeMove<-5){short+=12;reasonsShort.push("impulse_move");}
if(negativeMove<-10){short+=16;reasonsShort.push("explosive_move");}
if(negativeMove<-15){short+=12;reasonsShort.push("parabolic_move");}
if(negativeMove<-25){short+=8;reasonsShort.push("extreme_move");}
if(historyMoveAllowed && velocity5m>0.35){long+=6;reasonsLong.push("5m_velocity");}
if(historyMoveAllowed && velocity5m>0.75){long+=8;reasonsLong.push("5m_acceleration");}
if(historyMoveAllowed && velocity5m>1.25){long+=10;reasonsLong.push("5m_impulse");}
if(historyMoveAllowed && velocity5m>2.0){long+=12;reasonsLong.push("5m_explosion");}
if(historyMoveAllowed && velocity5m>4.0){long+=8;reasonsLong.push("5m_extreme");}
if(historyMoveAllowed && velocity5m<-0.35){short+=6;reasonsShort.push("5m_velocity");}
if(historyMoveAllowed && velocity5m<-0.75){short+=8;reasonsShort.push("5m_acceleration");}
if(historyMoveAllowed && velocity5m<-1.25){short+=10;reasonsShort.push("5m_impulse");}
if(historyMoveAllowed && velocity5m<-2.0){short+=12;reasonsShort.push("5m_explosion");}
if(historyMoveAllowed && velocity5m<-4.0){short+=8;reasonsShort.push("5m_extreme");}
if(historyMoveAllowed && acceleration5m>0.35){long+=7;reasonsLong.push("velocity_acceleration");}
if(historyMoveAllowed && acceleration5m<-0.35){short+=7;reasonsShort.push("velocity_acceleration");}
if(move10m>1){long+=6;reasonsLong.push("10m_continuation");}
if(move15m>1.5){long+=7;reasonsLong.push("15m_continuation");}
if(move30m>3){long+=6;reasonsLong.push("30m_trend");}
if(move10m<-1){short+=6;reasonsShort.push("10m_continuation");}
if(move15m<-1.5){short+=7;reasonsShort.push("15m_continuation");}
if(move30m<-3){short+=6;reasonsShort.push("30m_trend");}
if(p1h>0.5){long+=8;reasonsLong.push("1h_momentum");}
if(p1h>1.5){long+=8;reasonsLong.push("1h_acceleration");}
if(p1h<-0.5){short+=8;reasonsShort.push("1h_momentum");}
if(p1h<-1.5){short+=8;reasonsShort.push("1h_acceleration");}
if(p4h>2){long+=6;reasonsLong.push("4h_momentum");}
if(p4h<-2){short+=6;reasonsShort.push("4h_momentum");}
if(volumeRatio>1.25){long+=6;short+=6;}
if(volumeRatio>1.5){long+=7;short+=7;}
if(volumeRatio>2){long+=8;short+=8;}
if(oiChangePct>2){long+=5;reasonsLong.push("oi_expansion");}
if(oiChangePct>5){long+=5;reasonsLong.push("oi_acceleration");}
if(oiChangePct<-2){short+=5;reasonsShort.push("oi_expansion");}
if(oiChangePct<-5){short+=5;reasonsShort.push("oi_acceleration");}
if(nearHigh&&(positiveMove>=1||priorMovePct>=0.5))reasonsLong.push("near_24h_high_extension");
if(nearLow&&(negativeMove<=-1||priorMovePct<=-0.5))reasonsShort.push("near_24h_low_extension");
const breakoutPressure=Math.min(20,Math.max(0,rangePct-4)*2);
if(breakoutPressure>0&&positiveMove>0.5){long+=breakoutPressure;reasonsLong.push("range_expansion");}
if(breakoutPressure>0&&negativeMove<-0.5){short+=breakoutPressure;reasonsShort.push("range_expansion");}
const liquidity=v8LiquidityScore(market);
const liquidityBoost=CONFIG.FAIR_LIQUIDITY_SCORE_IN_RADAR?Math.min(8,liquidity/12.5):0;
long+=liquidityBoost;short+=liquidityBoost;
const rawLongScore=Math.min(100,long),rawShortScore=Math.min(100,short);
// V16.1: reversal intelligence. Strength and entry timing are separate dimensions.
const longFlowReversal=smfReversalMetrics(smartMoneyFlow,"LONG");
const shortFlowReversal=smfReversalMetrics(smartMoneyFlow,"SHORT");
const longPriceFlip=Boolean(velocity5m<=-Number(CONFIG.RADAR_REVERSAL_PRICE_FLIP_PCT||0.35) && prior5m>=0.50);
const shortPriceFlip=Boolean(velocity5m>=Number(CONFIG.RADAR_REVERSAL_PRICE_FLIP_PCT||0.35) && prior5m<=-0.50);
const longRejection=Boolean(nearHigh && velocity5m<0);
const shortRejection=Boolean(nearLow && velocity5m>0);
const longDecelAfterMove=Boolean(move15m>=Number(CONFIG.RADAR_TIMING_EXHAUSTED_MOVE15||3) && acceleration5m<=-Number(CONFIG.RADAR_TIMING_DECELERATION||0.20));
const shortDecelAfterMove=Boolean(move15m<=-Number(CONFIG.RADAR_TIMING_EXHAUSTED_MOVE15||3) && acceleration5m>=Number(CONFIG.RADAR_TIMING_DECELERATION||0.20));
let longReversalRisk=longFlowReversal.risk,shortReversalRisk=shortFlowReversal.risk;
if(longPriceFlip)longReversalRisk+=25;
if(shortPriceFlip)shortReversalRisk+=25;
if(longRejection)longReversalRisk+=15;
if(shortRejection)shortReversalRisk+=15;
if(longDecelAfterMove)longReversalRisk+=12;
if(shortDecelAfterMove)shortReversalRisk+=12;
longReversalRisk=Math.min(100,longReversalRisk);
shortReversalRisk=Math.min(100,shortReversalRisk);
const longReversalEvidenceCount=(longFlowReversal.risk>0?1:0)+(longPriceFlip?1:0)+(longRejection?1:0)+(longDecelAfterMove?1:0);
const shortReversalEvidenceCount=(shortFlowReversal.risk>0?1:0)+(shortPriceFlip?1:0)+(shortRejection?1:0)+(shortDecelAfterMove?1:0);
const longReversalConfirmed=longReversalRisk>=Number(CONFIG.RADAR_REVERSAL_SCORE_THRESHOLD||50)&&longReversalEvidenceCount>=2;
const shortReversalConfirmed=shortReversalRisk>=Number(CONFIG.RADAR_REVERSAL_SCORE_THRESHOLD||50)&&shortReversalEvidenceCount>=2;
const longPenalty=Math.min(Number(CONFIG.RADAR_REVERSAL_PENALTY_MAX||28),Math.round(longReversalRisk*0.35));
const shortPenalty=Math.min(Number(CONFIG.RADAR_REVERSAL_PENALTY_MAX||28),Math.round(shortReversalRisk*0.35));
const longOppositeBonus=longReversalConfirmed?Math.min(Number(CONFIG.RADAR_REVERSAL_OPPOSITE_BONUS_MAX||24),Math.round(longReversalRisk*0.40)):0;
const shortOppositeBonus=shortReversalConfirmed?Math.min(Number(CONFIG.RADAR_REVERSAL_OPPOSITE_BONUS_MAX||24),Math.round(shortReversalRisk*0.40)):0;
const longScore=Math.min(100,Math.max(0,rawLongScore-longPenalty+shortOppositeBonus));
const shortScore=Math.min(100,Math.max(0,rawShortScore-shortPenalty+longOppositeBonus));
const edge=Math.abs(longScore-shortScore);
const direction=edge>=CONFIG.PUMP_RADAR_MIN_DIRECTIONAL_EDGE?(longScore>shortScore?"LONG":"SHORT"):"NEUTRAL";
const reversalDirection = longReversalConfirmed && longReversalRisk > shortReversalRisk ? "SHORT" : shortReversalConfirmed && shortReversalRisk > longReversalRisk ? "LONG" : direction;
const reversalScore=Math.max(longReversalRisk,shortReversalRisk);
const reversalReasons=[...(longReversalRisk>=shortReversalRisk?longFlowReversal.reasons:shortFlowReversal.reasons)];
if(longPriceFlip&&longReversalRisk>=shortReversalRisk)reversalReasons.push("LONG_PRICE_VELOCITY_FLIP");
if(shortPriceFlip&&shortReversalRisk>longReversalRisk)reversalReasons.push("SHORT_PRICE_VELOCITY_FLIP");
if(longRejection&&longReversalRisk>=shortReversalRisk)reversalReasons.push("LONG_HIGH_REJECTION");
if(shortRejection&&shortReversalRisk>longReversalRisk)reversalReasons.push("SHORT_LOW_REJECTION");
if(longDecelAfterMove&&longReversalRisk>=shortReversalRisk)reversalReasons.push("LONG_MOMENTUM_DECELERATION");
if(shortDecelAfterMove&&shortReversalRisk>longReversalRisk)reversalReasons.push("SHORT_MOMENTUM_DECELERATION");
const directionalVelocity=direction==="LONG"?Number(velocity5m||0):direction==="SHORT"?-Number(velocity5m||0):0;
const directionalAcceleration=direction==="LONG"?Number(acceleration5m||0):direction==="SHORT"?-Number(acceleration5m||0):0;
const directionalMove15=direction==="LONG"?Number(move15m||0):direction==="SHORT"?-Number(move15m||0):0;
const directionalMove30=direction==="LONG"?Number(move30m||0):direction==="SHORT"?-Number(move30m||0):0;
const directionalNearExtreme=direction==="LONG"?Boolean(nearHigh):direction==="SHORT"?Boolean(nearLow):false;
const momentumDecelerating=directionalVelocity>=0.5&&directionalAcceleration<=-Number(CONFIG.RADAR_TIMING_DECELERATION||0.20);
const largeRecentMove=directionalMove15>=Number(CONFIG.RADAR_TIMING_EXHAUSTED_MOVE15||3)||directionalMove30>=Number(CONFIG.RADAR_TIMING_EXHAUSTED_MOVE30||5);
const exhausted=direction!=="NEUTRAL"&&!radarWarmup&&directionalNearExtreme&&(largeRecentMove||momentumDecelerating||directionalVelocity<0.35);
let timingState=direction==="NEUTRAL"?"NEUTRAL":
  (radarWarmup?"WARMUP":
   (exhausted?"EXHAUSTED":
    ((Math.abs(velocity5m)>=0.75||Math.abs(acceleration5m)>=0.35)?"EARLY_FAST":
     (Math.abs(move15m)>=2||Math.abs(move30m)>=4)?"ACTIVE":"LATE_OR_SLOW")));
if(direction==="SHORT"&&longReversalConfirmed&&longReversalRisk>=Number(CONFIG.RADAR_REVERSAL_STRONG_THRESHOLD||70)) timingState="REVERSAL_SHORT";
if(direction==="LONG"&&shortReversalConfirmed&&shortReversalRisk>=Number(CONFIG.RADAR_REVERSAL_STRONG_THRESHOLD||70)) timingState="REVERSAL_LONG";
let entryTimingScore=50;
if(Math.abs(velocity5m)>=0.75)entryTimingScore+=20;
if(Math.abs(acceleration5m)>=0.35)entryTimingScore+=15;
if(directionalAcceleration>0.20)entryTimingScore+=10;
if(directionalNearExtreme)entryTimingScore-=25;
if(momentumDecelerating)entryTimingScore-=20;
if(largeRecentMove)entryTimingScore-=15;
if(timingState==="EXHAUSTED")entryTimingScore-=15;
entryTimingScore=Math.min(100,Math.max(0,entryTimingScore));
return{
score:Number(Math.max(longScore,shortScore).toFixed(2)),longScore:Number(longScore.toFixed(2)),shortScore:Number(shortScore.toFixed(2)),rawLongScore:Number(rawLongScore.toFixed(2)),rawShortScore:Number(rawShortScore.toFixed(2)),edge:Number(edge.toFixed(2)),direction,
reversalDirection,reversalScore:Number(reversalScore.toFixed(2)),longReversalRisk:Number(longReversalRisk.toFixed(2)),shortReversalRisk:Number(shortReversalRisk.toFixed(2)),longReversalEvidenceCount,shortReversalEvidenceCount,longReversalConfirmed,shortReversalConfirmed,reversalReasons:[...new Set(reversalReasons)].slice(0,10),flowReversal:{long:longFlowReversal,short:shortFlowReversal},
priceChange24h:Number(p24.toFixed(3)),priceChange1h:Number(p1h.toFixed(3)),priceChange4h:Number(p4h.toFixed(3)),priorMovePct:Number(priorMovePct.toFixed(3)),
move10m:Number(move10m.toFixed(3)),move15m:Number(move15m.toFixed(3)),move30m:Number(move30m.toFixed(3)),velocity5m:Number(velocity5m.toFixed(3)),acceleration5m:Number(acceleration5m.toFixed(3)),timingState,
directionalVelocity:Number(directionalVelocity.toFixed(3)),directionalAcceleration:Number(directionalAcceleration.toFixed(3)),directionalMove15:Number(directionalMove15.toFixed(3)),directionalMove30:Number(directionalMove30.toFixed(3)),directionalNearExtreme,momentumDecelerating,largeRecentMove,exhausted,entryTimingScore:Number(entryTimingScore.toFixed(2)),
volumeRatio:Number(volumeRatio.toFixed(3)),oiChangePct:Number(oiChangePct.toFixed(3)),nearHigh,nearLow,breakoutPressure:Number(breakoutPressure.toFixed(2)),liquidityScore:Number(liquidity.toFixed(2)),
smartMoneyFlow: smartMoneyFlow ? {
  buyUsd:Number(smartMoneyFlow.buyUsd||0),
  sellUsd:Number(smartMoneyFlow.sellUsd||0),
  totalUsd:Number(smartMoneyFlow.totalUsd||0),
  signedUsd:Number(smartMoneyFlow.signedUsd||0),
  imbalance:Number(smartMoneyFlow.imbalance||0),
  flowSpikeRatio:Number(smartMoneyFlow.flowSpikeRatio||1),
  flowSurge:Boolean(smartMoneyFlow.flowSurge),
  explosiveFlow:Boolean(smartMoneyFlow.explosiveFlow),
  tradeCount:Number(smartMoneyFlow.tradeCount||0),
  largeTradeCount:Number(smartMoneyFlow.largeTradeCount||0),
  longOpenUsd:Number(smartMoneyFlow.longOpenUsd||0),
  shortOpenUsd:Number(smartMoneyFlow.shortOpenUsd||0),
  longCloseUsd:Number(smartMoneyFlow.longCloseUsd||0),
  shortCloseUsd:Number(smartMoneyFlow.shortCloseUsd||0)
} : null,
priceDataStatus,radarWarmup,radarHistoryReady,historyIntegrityOk,historySamples:hist.length,
latestHistoryAgeSec:latest?Math.max(0,Math.round((now-Number(latest.at||0))/1000)):null,
prior5AgeSec:prior5?Math.max(0,Math.round((now-Number(prior5.at||0))/1000)):null,
prior15AgeSec:prior15?Math.max(0,Math.round((now-Number(prior15.at||0))/1000)):null,
prior30AgeSec:prior30?Math.max(0,Math.round((now-Number(prior30.at||0))/1000)):null,
valid5mSample:Boolean(prior5),valid15mSample:Boolean(prior15),valid30mSample:Boolean(prior30),
reasons:direction==="LONG"?[...new Set(reasonsLong)].slice(0,8):direction==="SHORT"?[...new Set(reasonsShort)].slice(0,8):[...new Set([...reasonsLong,...reasonsShort])].slice(0,8)
};
}
function v8FastMarketFilter(market) {
const symbol = v8NormSymbol(
market?.symbol ?? market?.name ?? market?.ticker
);
const price = Number(market?.price ?? market?.markPrice ?? market?.indexPrice);
const liq = v8LiquidityScore(market);
const isMajor = V8_UNIVERSE.MAJOR_SYMBOLS.includes(symbol);
 
const reasons = [];
if (!symbol) reasons.push("missing_symbol");
if (V8_UNIVERSE.REQUIRE_VALID_MARKET && market?.isActive === false) reasons.push("inactive");
if (Number.isFinite(price) && price < V8_UNIVERSE.MIN_PRICE) reasons.push("price_too_low");
const liquidityKnown = liq > 0;
// V15 FAIR: liquidity remains telemetry/execution-risk context, never an asset-selection bonus.
// Do not reject smaller/non-major markets merely because their liquidity score is lower/unknown.
if (!liquidityKnown) reasons.push("liquidity_unknown_diagnostic");
 
return {
symbol,
eligible: reasons.filter(r => r !== "liquidity_unknown").length === 0,
major: isMajor,
liquidityScore: liq,
reasons,
// DEBUG MODE: expose raw adapter values for first-stage filter diagnosis
_debug: {
rawSymbol: market?.symbol ?? market?.name ?? market?.ticker ?? null,
normalizedSymbol: symbol,
price: price || null,
liquidityScore: liq,
liquidityKnown: liq > 0,
fairAssetScoring: true,
rawLiquidity: extractLiquidity(market),
rawOpenInterest: extractOpenInterest(market),
poolValueMax: market?.poolValueMax ?? null,
poolValueMin: market?.poolValueMin ?? null,
longInterestUsd: market?.longInterestUsd ?? null,
shortInterestUsd: market?.shortInterestUsd ?? null,
isMajor
}
};
}
 
function v8RankFastMarkets(markets, previousSnapshots = {}, radarHistory = {}) {
return (markets||[]).map(m=>{const symbol=v8NormSymbol(m?.symbol??m?.name??m?.ticker??m?.indexTokenSymbol);const previous=previousSnapshots?.[symbol]?.market||previousSnapshots?.[symbol]||null;const history=radarHistory?.[symbol] || [];
 const pumpRadar=CONFIG.PUMP_RADAR_ENABLED?v8PumpRadar(m,previous,history):null;return{market:m,...v8FastMarketFilter(m),pumpRadar};}).filter(x=>x.eligible).sort((a,b)=>{
const ar=Number(a.pumpRadar?.score||0), br=Number(b.pumpRadar?.score||0);
if(br!==ar)return br-ar;
// V15 FAIR: deterministic tie-break only; no major/market-size preference.
if(String(a.symbol)!==String(b.symbol)) return String(a.symbol).localeCompare(String(b.symbol));
return 0;
}).slice(0,V8_UNIVERSE.FAST_STAGE_LIMIT);
}

function v8StableHash(value) {
const s = String(value || "");
let h = 2166136261;
for (let i = 0; i < s.length; i++) {
h ^= s.charCodeAt(i);
h = Math.imul(h, 16777619);
}
return h >>> 0;
}

function v8SelectDeepCandidates(fastRows, rotationCursor = 0) {
const rows = [...(fastRows || [])];
const limit = Math.min(
  Number(V8_UNIVERSE.DEEP_STAGE_LIMIT || 10),
  Math.max(1, Number(CONFIG.DEEP_SCAN_LIMIT || 10))
);
if (!rows.length || limit <= 0) return [];

const score = x => Number(x?.pumpRadar?.score || 0);
const side = x => String(x?.pumpRadar?.direction || "NEUTRAL").toUpperCase();
const longRows = rows.filter(x => side(x) === "LONG").sort((a,b) => score(b) - score(a));
const shortRows = rows.filter(x => side(x) === "SHORT").sort((a,b) => score(b) - score(a));

const selected = [];
const used = new Set();
const add = candidate => {
  if (!candidate || used.has(candidate.symbol) || selected.length >= limit) return false;
  selected.push(candidate);
  used.add(candidate.symbol);
  return true;
};

// Primary lane: preserve directional coverage and let current signal quality
// earn priority. No major-asset or market-size preference is introduced.
const explorationSlots = CONFIG.MARKET_UNIVERSE_PHASE5_ENABLED
  ? Math.min(Number(CONFIG.DEEP_EXPLORATION_SLOTS || 0), Math.max(0, limit - 1))
  : 0;
const primarySlots = Math.max(1, limit - explorationSlots);
const longQuota = Math.min(
  Number(CONFIG.DIRECTIONAL_DEEP_LONG_SLOTS || 4),
  Math.floor(primarySlots / 2)
);
const shortQuota = Math.min(
  Number(CONFIG.DIRECTIONAL_DEEP_SHORT_SLOTS || 4),
  Math.floor(primarySlots / 2)
);

let longCount = 0, shortCount = 0;
for (const candidate of longRows) {
  if (longCount >= longQuota || selected.length >= primarySlots) break;
  if (add(candidate)) longCount++;
}
for (const candidate of shortRows) {
  if (shortCount >= shortQuota || selected.length >= primarySlots) break;
  if (add(candidate)) shortCount++;
}

const remainingPrimary = rows
  .filter(x => !used.has(x.symbol))
  .sort((a,b) => {
    const diff = score(b) - score(a);
    return diff || String(a.symbol).localeCompare(String(b.symbol));
  });

for (const candidate of remainingPrimary) {
  if (selected.length >= primarySlots) break;
  add(candidate);
}

// Phase 5 exploration lane: deliberately allocate a small rotating portion
// of deep capacity to less-observed/emerging markets. This prevents a stable
// top-10 from monopolizing deep analysis forever while keeping Radar coverage
// broad across the full eligible universe.
if (explorationSlots > 0) {
  const minScore = Number(CONFIG.DEEP_EXPLORATION_MIN_SCORE || 0);
  const poolLimit = Math.max(
    explorationSlots,
    Number(CONFIG.DEEP_EXPLORATION_POOL_LIMIT || 100)
  );

  const explorationPool = rows
    .filter(x => !used.has(x.symbol))
    .filter(x => score(x) >= minScore)
    .slice()
    .sort((a,b) => {
      const ar = score(a), br = score(b);
      if (br !== ar) return br - ar;

      // Stable pseudo-random ordering driven by the persisted cursor.
      const ah = v8StableHash(`${a.symbol}|${rotationCursor}`);
      const bh = v8StableHash(`${b.symbol}|${rotationCursor}`);
      if (ah !== bh) return ah - bh;
      return String(a.symbol).localeCompare(String(b.symbol));
    })
    .slice(0, poolLimit);

  const offset = CONFIG.DEEP_ROTATION_ENABLED && explorationPool.length
    ? Math.abs(Number(rotationCursor || 0)) % explorationPool.length
    : 0;

  for (let i = 0; i < explorationSlots && explorationPool.length; i++) {
    const candidate = explorationPool[(offset + i) % explorationPool.length];
    add(candidate);
  }
}

// If the exploration pool was too small, fill unused capacity with the best
// remaining current-score candidates.
if (selected.length < limit) {
  for (const candidate of remainingPrimary) {
    if (selected.length >= limit) break;
    add(candidate);
  }
}

return selected.slice(0, limit);
}

const DEFAULT_STATE = {
running: true,
dayKey: new Date().toISOString().slice(0, 10),
dailyLoss: 0,
lastScan: null,
signals: [],
executions: 0,
errors: 0,
lastDiagnostics: [],
telegramNotifications: {},
telegramEvents: {},
radarTelegramEvents: {},
radarHistory: {},
smartMoneyFlowHistory: {},
hybridStructureStates: {},
hybridScanCursor: 0,
universeRotationCursor: 0,
lastExitDiagnostics: [],
resourceUsage: null
};
 
const CACHE = new Map();
const INFLIGHT = new Map();
 
// ======================================================
// GMX V2 READ-ONLY ADAPTER
// Arbitrum One / Chain ID 42161
// ======================================================
 
const GMX_V2_CONFIG = {
CHAIN_ID: 42161,
ORACLE: "https://arbitrum-api.gmxinfra.io",
FALLBACKS: [
"https://arbitrum-api-fallback.gmxinfra.io",
"https://arbitrum-api-fallback.gmxinfra2.io"
],
MARKETS_URL: "https://arbitrum-api.gmxinfra.io/markets",
MARKETS_INFO_URL: "https://arbitrum-api.gmxinfra.io/markets/info",
REQUEST_TIMEOUT_MS: 10000
};
const GMX = {
...GMX_V2_CONFIG,
API: GMX_V2_CONFIG.ORACLE,
FALLBACK_API: GMX_V2_CONFIG.FALLBACKS[0]
};
 
 
 
 
// ======================================================
// V6 PRO SIGNAL ENGINE - MERGED MODULE
// This module is embedded into the original V6.3.1 engine.
// Original engines are preserved; V6 adds a complete directional
// signal pipeline and dedicated /v6/* routes.
// ======================================================
// ======================================================
// RESOURCE USAGE GUARD — MODULE SCOPE
// ======================================================
let RESOURCE_USAGE_RUNTIME = null;

function resourcePeriodKeys(now = Date.now()) {
  const d = new Date(now);
  return { day: d.toISOString().slice(0, 10), month: d.toISOString().slice(0, 7) };
}

function newResourceBucket(key) {
  return {
    key,
    runs: 0,
    httpRequests: 0,
    gmxRequests: 0,
    gmxFallbackRequests: 0,
    candleRequests: 0,
    telegramRequests: 0,
    telegramSuccesses: 0,
    runtimeMs: 0
  };
}

function resourceUsageEnsure(state, now = Date.now()) {
  const keys = resourcePeriodKeys(now);
  const old = state?.resourceUsage && typeof state.resourceUsage === "object" ? state.resourceUsage : {};
  const usage = {
    daily: old.daily?.key === keys.day ? { ...newResourceBucket(keys.day), ...old.daily } : newResourceBucket(keys.day),
    monthly: old.monthly?.key === keys.month ? { ...newResourceBucket(keys.month), ...old.monthly } : newResourceBucket(keys.month),
    lastRun: old.lastRun || null,
    lastWarning: old.lastWarning || {},
    lastPause: old.lastPause || null
  };
  state.resourceUsage = usage;
  return usage;
}

function resourceUsageInstallFetchTracker() {
  if (!CONFIG.RESOURCE_USAGE_ENABLED || typeof globalThis.fetch !== "function") return () => {};
  const original = globalThis.fetch;
  RESOURCE_USAGE_RUNTIME = {
    startedAt: Date.now(),
    httpRequests: 0,
    gmxRequests: 0,
    gmxFallbackRequests: 0,
    candleRequests: 0,
    telegramRequests: 0,
    telegramSuccesses: 0
  };
  globalThis.fetch = async (...args) => {
    const input = args?.[0];
    const url = typeof input === "string" ? input : (input?.url || "");
    const u = String(url || "");
    const lower = u.toLowerCase();
    RESOURCE_USAGE_RUNTIME.httpRequests++;
    if (lower.includes("api.telegram.org")) RESOURCE_USAGE_RUNTIME.telegramRequests++;
    if (lower.includes("gmxapi.io") || lower.includes("gmxapi.ai") || lower.includes("gmxinfra.io")) {
      RESOURCE_USAGE_RUNTIME.gmxRequests++;
      if (lower.includes("fallback")) RESOURCE_USAGE_RUNTIME.gmxFallbackRequests++;
      if (lower.includes("/candles")) RESOURCE_USAGE_RUNTIME.candleRequests++;
    }
    const response = await original(...args);
    if (lower.includes("api.telegram.org") && response?.ok) RESOURCE_USAGE_RUNTIME.telegramSuccesses++;
    return response;
  };
  return () => { globalThis.fetch = original; };
}

function resourceUsageRuntimeSnapshot(startedAt = null) {
  const r = RESOURCE_USAGE_RUNTIME || {};
  return {
    runs: 1,
    httpRequests: Number(r.httpRequests || 0),
    gmxRequests: Number(r.gmxRequests || 0),
    gmxFallbackRequests: Number(r.gmxFallbackRequests || 0),
    candleRequests: Number(r.candleRequests || 0),
    telegramRequests: Number(r.telegramRequests || 0),
    telegramSuccesses: Number(r.telegramSuccesses || 0),
    runtimeMs: Math.max(0, Date.now() - Number(r.startedAt || startedAt || Date.now()))
  };
}

function resourceUsagePercent(value, limit) {
  return limit > 0 ? (Number(value || 0) / limit) * 100 : 0;
}

function resourceUsageLevels(usage) {
  const checks = [
    ["dailyRuns", usage.daily.runs, CONFIG.RESOURCE_DAILY_RUN_LIMIT],
    ["monthlyRuns", usage.monthly.runs, CONFIG.RESOURCE_MONTHLY_RUN_LIMIT],
    ["dailyHttp", usage.daily.httpRequests, CONFIG.RESOURCE_DAILY_HTTP_LIMIT],
    ["monthlyHttp", usage.monthly.httpRequests, CONFIG.RESOURCE_MONTHLY_HTTP_LIMIT],
    ["dailyGmx", usage.daily.gmxRequests, CONFIG.RESOURCE_DAILY_GMX_HTTP_LIMIT],
    ["monthlyGmx", usage.monthly.gmxRequests, CONFIG.RESOURCE_MONTHLY_GMX_HTTP_LIMIT]
  ];
  let maxPercent = 0, maxKey = null;
  for (const [key, value, limit] of checks) {
    const pct = resourceUsagePercent(value, limit);
    if (pct > maxPercent) { maxPercent = pct; maxKey = key; }
  }
  return { percent: maxPercent, key: maxKey, warning: maxPercent >= CONFIG.RESOURCE_WARN_PERCENT, paused: maxPercent >= CONFIG.RESOURCE_PAUSE_PERCENT };
}

function resourceUsageWouldPause(state, now = Date.now()) {
  if (!CONFIG.RESOURCE_USAGE_ENABLED) return { paused: false, percent: 0, key: null };
  const usage = resourceUsageEnsure(state, now);
  const level = resourceUsageLevels(usage);
  return { paused: level.paused, percent: level.percent, key: level.key };
}

function resourceUsageCommit(state, runtime, now = Date.now()) {
  if (!CONFIG.RESOURCE_USAGE_ENABLED) return null;
  const usage = resourceUsageEnsure(state, now);
  const add = runtime || {};
  for (const bucketName of ["daily", "monthly"]) {
    const b = usage[bucketName];
    b.runs += Number(add.runs || 0);
    b.httpRequests += Number(add.httpRequests || 0);
    b.gmxRequests += Number(add.gmxRequests || 0);
    b.gmxFallbackRequests += Number(add.gmxFallbackRequests || 0);
    b.candleRequests += Number(add.candleRequests || 0);
    b.telegramRequests += Number(add.telegramRequests || 0);
    b.telegramSuccesses += Number(add.telegramSuccesses || 0);
    b.runtimeMs += Number(add.runtimeMs || 0);
  }
  usage.lastRun = { at: now, ...add };
  const level = resourceUsageLevels(usage);
  if (level.warning) {
    const period = level.percent >= resourceUsagePercent(usage.monthly.runs, CONFIG.RESOURCE_MONTHLY_RUN_LIMIT) ? usage.monthly.key : usage.daily.key;
    const alertKey = `${level.key}|${level.percent >= CONFIG.RESOURCE_PAUSE_PERCENT ? "PAUSE" : "WARN"}|${period}`;
    if (usage.lastWarning?.key !== alertKey) {
      usage.lastWarning = { key: alertKey, at: now, level: level.paused ? "PAUSE" : "WARNING", metric: level.key, percent: Number(level.percent.toFixed(1)) };
      console.warn("[RESOURCE][GUARD]", usage.lastWarning);
    }
  }
  if (level.paused) usage.lastPause = { at: now, metric: level.key, percent: Number(level.percent.toFixed(1)) };
  return { usage, level };
}

function resourceUsageSummary(state) {
  const usage = resourceUsageEnsure(state);
  const level = resourceUsageLevels(usage);
  return {
    enabled: Boolean(CONFIG.RESOURCE_USAGE_ENABLED),
    level: level.paused ? "PAUSED" : level.warning ? "WARNING" : "OK",
    maxPercent: Number(level.percent.toFixed(1)),
    limitingMetric: level.key,
    warnPercent: CONFIG.RESOURCE_WARN_PERCENT,
    pausePercent: CONFIG.RESOURCE_PAUSE_PERCENT,
    daily: usage.daily,
    monthly: usage.monthly,
    limits: {
      dailyRuns: CONFIG.RESOURCE_DAILY_RUN_LIMIT,
      monthlyRuns: CONFIG.RESOURCE_MONTHLY_RUN_LIMIT,
      dailyHttp: CONFIG.RESOURCE_DAILY_HTTP_LIMIT,
      monthlyHttp: CONFIG.RESOURCE_MONTHLY_HTTP_LIMIT,
      dailyGmx: CONFIG.RESOURCE_DAILY_GMX_HTTP_LIMIT,
      monthlyGmx: CONFIG.RESOURCE_MONTHLY_GMX_HTTP_LIMIT
    }
  };
}


// V15.6.9 FIX: module-scope state access for the scheduled handler.
// The engine's internal loadState/saveState helpers remain inside FUTURES_V6,
// while the top-level scheduled() handler also needs them for Resource Guard
// checks and final persistence. Keep these wrappers independent and compatible
// with the GitHub Actions JSON-backed BOT_STATE binding.
async function loadState(env) {
  if (!env.BOT_STATE) return { ...DEFAULT_STATE };
  const data = await env.BOT_STATE.get("engine_state", "json");
  return {
    ...DEFAULT_STATE,
    ...(data || {}),
    signals: Array.isArray(data?.signals) ? data.signals : [],
    lastDiagnostics: Array.isArray(data?.lastDiagnostics) ? data.lastDiagnostics : [],
    telegramEvents: data?.telegramEvents && typeof data.telegramEvents === "object" ? data.telegramEvents : {},
    radarTelegramEvents: data?.radarTelegramEvents && typeof data.radarTelegramEvents === "object" ? data.radarTelegramEvents : {},
    radarHistory: data?.radarHistory && typeof data.radarHistory === "object" ? data.radarHistory : {},
    smartMoneyFlowHistory: data?.smartMoneyFlowHistory && typeof data.smartMoneyFlowHistory === "object" ? data.smartMoneyFlowHistory : {},
    hybridStructureStates: data?.hybridStructureStates && typeof data.hybridStructureStates === "object" ? data.hybridStructureStates : {},
    hybridScanCursor: Number.isFinite(Number(data?.hybridScanCursor)) ? Number(data.hybridScanCursor) : 0,
    universeRotationCursor: Number.isFinite(Number(data?.universeRotationCursor)) ? Number(data.universeRotationCursor) : 0,
    lastExitDiagnostics: Array.isArray(data?.lastExitDiagnostics) ? data.lastExitDiagnostics : [],
    resourceUsage: data?.resourceUsage && typeof data.resourceUsage === "object" ? data.resourceUsage : null
  };
}

async function saveState(env, state) {
  if (!env.BOT_STATE) return false;
  await env.BOT_STATE.put("engine_state", JSON.stringify(state));
  return true;
}

// V16.0.0: Module-scope trend-confluence bridge.
// Execution helpers below FUTURES_V6 need this helper after the IIFE closes.
// Keep the canonical implementation available at module scope as well as
// inside FUTURES_V6 for the legacy signal pipeline.
function v15613TrendConfluence(trend, direction) {
  const t = trend || {};
  const dirs = [
    t.macro4h ?? t.macro?.direction,
    t.trend1h ?? t.trend?.direction,
    t.entry15m ?? t.entry?.direction,
    t.fast5m ?? t.fast?.direction
  ].map(x => String(x || '').toUpperCase());
  const bullish = dirs.filter(x => x === 'BULLISH').length;
  const bearish = dirs.filter(x => x === 'BEARISH').length;
  return {
    bullish,
    bearish,
    selected: direction === 'LONG' ? bullish : direction === 'SHORT' ? bearish : 0
  };
}

const FUTURES_V6 = (() => {
// ======================================================
// HTTP / RPC HELPERS
// ======================================================
 
function json(data, status = 200) {
return new Response(JSON.stringify(data, null, 2), {
status,
headers: {
"content-type": "application/json; charset=utf-8",
"cache-control": "no-store"
}
});
}
 
// V8 dynamic-universe integration point: feed the resolved GMX market catalog through v8RankFastMarkets() and v8SelectDeepCandidates() before deep candle fetching.
 
async function fetchTimeout(url, options = {}, timeout = CONFIG.DATA_TIMEOUT_MS) {
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), timeout);
try {
return await fetch(url, {
...options,
signal: controller.signal
});
} finally {
clearTimeout(timer);
}
}
 
async function fetchJson(url, options = {}) {
const response = await fetchTimeout(url, options);
const text = await response.text();
 
if (!response.ok) {
throw new Error(`HTTP ${response.status}: ${text.slice(0, 250)}`);
}
 
try {
return JSON.parse(text);
} catch {
throw new Error("Invalid JSON response");
}
}


// ======================================================
// V15.6 MULTI-SOURCE DATA CENTER
// GMX API: two independent peer regions (.io / .ai).
// Oracle API: primary + documented fallbacks.
// ======================================================
const V156_DATA_CENTER = {
apiPeers: [CONFIG.DATA_CENTER_PRIMARY_API, CONFIG.DATA_CENTER_PEER_API].filter(Boolean),
oraclePeers: [
CONFIG.DATA_CENTER_ORACLE_PRIMARY,
...(Array.isArray(CONFIG.DATA_CENTER_ORACLE_FALLBACKS) ? CONFIG.DATA_CENTER_ORACLE_FALLBACKS : [])
].filter(Boolean)
};

function v156UrlWithQuery(base, path, params = {}) {
const url = new URL(`${String(base).replace(/\/$/,"")}${path}`);
for (const [key,value] of Object.entries(params || {})) {
if (value === undefined || value === null || value === "") continue;
url.searchParams.set(key,String(value));
}
return url.toString();
}

async function fetchPeerJson(baseUrls, path, params = {}, options = {}) {
const errors = [];
for (const base of Array.isArray(baseUrls) ? baseUrls.filter(Boolean) : []) {
const url = v156UrlWithQuery(base,path,params);
try {
const response = await fetchTimeout(url,{headers:{accept:"application/json",...(options.headers||{})}},Number(options.timeoutMs||CONFIG.DATA_CENTER_TIMEOUT_MS||5000));
const body = await response.text();
if (!response.ok) { errors.push(`${url}:HTTP_${response.status}`); continue; }
let data;
try { data=JSON.parse(body); } catch (_) { errors.push(`${url}:INVALID_JSON`); continue; }
return {ok:true,data,source:url,errors};
} catch(error) { errors.push(`${url}:${safeError(error)}`); }
}
return {ok:false,data:null,source:null,errors};
}

function v156Rows(payload, keys = []) {
if (Array.isArray(payload)) return payload;
for (const key of keys) if (Array.isArray(payload?.[key])) return payload[key];
if (Array.isArray(payload?.data)) return payload.data;
if (Array.isArray(payload?.data?.rows)) return payload.data.rows;
return [];
}

function v156Finite(value) {
const n=Number(value);
return Number.isFinite(n)?n:null;
}

function v156ScaledUsd(value) {
const n=v156Finite(value);
if (n===null) return null;
return Math.abs(n)>=1e18 ? n/1e30 : n;
}

function v156ExtractTradeRows(payload) {
const direct=v156Rows(payload,["trades","results","items","rows"]);
if(direct.length) return direct;
if(payload?.data&&typeof payload.data==="object"){
const nested=v156Rows(payload.data,["trades","results","items","rows"]);
if(nested.length) return nested;
}
return [];
}
 
async function rpc(env, method, params = []) {
if (!env.ARBITRUM_RPC) {
throw new Error("ARBITRUM_RPC is not configured");
}
 
const response = await fetchTimeout(env.ARBITRUM_RPC, {
method: "POST",
headers: { "content-type": "application/json" },
body: JSON.stringify({
jsonrpc: "2.0",
id: Date.now(),
method,
params
})
});
 
const data = await response.json();
 
if (data.error) {
throw new Error(`RPC ${data.error.code}: ${data.error.message}`);
}
 
return data.result;
}
 
async function verifyArbitrumRPC(env) {
const chainHex = await rpc(env, "eth_chainId");
const chainId = parseInt(chainHex, 16);
if (chainId !== GMX.CHAIN_ID) {
throw new Error(`Wrong RPC network: ${chainId}; expected ${GMX.CHAIN_ID}`);
}
 
const blockHex = await rpc(env, "eth_blockNumber");
return {
chainId,
blockNumber: parseInt(blockHex, 16)
};
}
 
// ======================================================
// CACHE
// ======================================================
 
async function cached(key, loader, ttl = CONFIG.MARKET_CACHE_TTL_MS) {
const now = Date.now();
const hit = CACHE.get(key);
 
if (hit && hit.expiresAt > now) {
return { value: hit.value, cache: "HIT" };
}
 
// Deduplicate concurrent requests for the same resource.
// This is critical for Cloudflare's per-invocation subrequest budget.
if (INFLIGHT.has(key)) {
const value = await INFLIGHT.get(key);
return { value, cache: "INFLIGHT" };
}
 
const promise = (async () => {
const value = await loader();
CACHE.set(key, { value, expiresAt: Date.now() + ttl });
return value;
})();
 
INFLIGHT.set(key, promise);
 
try {
const value = await promise;
return { value, cache: "MISS" };
} finally {
INFLIGHT.delete(key);
}
}
 
// ======================================================
// SYMBOL / MARKET NORMALIZATION
// ======================================================
 
 
function pairSymbol(symbol) {
return `${normalizeSymbol(symbol)}/USD`;
}
 
// ======================================================
// GMX MARKET DATA
// ======================================================
 
async function fetchGmxMarketsInfo() {
const urls = [
`${GMX.ORACLE}/markets/info`,
...GMX.FALLBACKS.map(base => `${base}/markets/info`)
];
 
let lastError;
 
for (const url of urls) {
try {
return await fetchJson(url, {
headers: { accept: "application/json" }
});
} catch (error) {
lastError = error;
}
}
 
throw lastError || new Error("All GMX market endpoints failed");
}
 
async function fetchGmxMarketsTickers() {
// V13.9: the current GMX API exposes market tickers on the GMX API
// hosts (gmxapi.io / gmxapi.ai). The legacy oracle route can return 404.
// Keep legacy oracle fallbacks only as a compatibility fallback.
const urls = [
"https://arbitrum.gmxapi.io/v1/markets/tickers",
"https://arbitrum.gmxapi.ai/v1/markets/tickers",
`${GMX.ORACLE}/markets/tickers`,
...GMX.FALLBACKS.map(base => `${base}/markets/tickers`)
];

let lastError;

for (const url of urls) {
try {
const result = await fetchJson(url, {
headers: { accept: "application/json" }
});
const rows = marketArray(result);
if (rows.length) return result;
lastError = new Error(`Ticker endpoint returned no rows: ${url}`);
} catch (error) {
lastError = error;
}
}

// SDK v2 is an additional compatibility path when the Worker bundle exposes it.
// This uses the officially supported fetchMarketsTickers() surface.
try {
if (typeof GmxApiSdk !== "undefined") {
const sdk = new GmxApiSdk({ chainId: 42161 });
const rows = await sdk.fetchMarketsTickers();
if (Array.isArray(rows) && rows.length) return rows;
lastError = new Error("GmxApiSdk.fetchMarketsTickers() returned no rows");
}
} catch (error) {
lastError = error;
}

throw lastError || new Error("All GMX market ticker endpoints failed");
}

async function fetchGmxMarketsValues(){
if(CONFIG.DATA_CENTER_ENABLED){
const api=await fetchPeerJson(V156_DATA_CENTER.apiPeers,"/markets/values",{}, {timeoutMs:CONFIG.DATA_CENTER_TIMEOUT_MS});
if(api.ok)return api.data;
}
let lastError;
for(const base of V156_DATA_CENTER.oraclePeers){
try{return await fetchJson(`${base}/markets/values`,{headers:{accept:"application/json"}});}
catch(error){lastError=error;}
}
throw lastError||new Error("All GMX market values endpoints failed");
}

async function fetchGmxApiMarketsInfo(){
if(!CONFIG.DATA_CENTER_ENABLED)return null;
const api=await fetchPeerJson(V156_DATA_CENTER.apiPeers,"/markets/info",{}, {timeoutMs:CONFIG.DATA_CENTER_TIMEOUT_MS});
return api.ok?{data:api.data,source:api.source,errors:api.errors}:null;
}

async function fetchGmxApiTradesSearch(params={}){
if(!CONFIG.DATA_CENTER_ENABLED)return{ok:false,trades:[],source:null,cursor:null,errors:["disabled"]};
const api=await fetchPeerJson(V156_DATA_CENTER.apiPeers,"/trades/search",params,{timeoutMs:CONFIG.DATA_CENTER_TIMEOUT_MS});
if(!api.ok)return{ok:false,trades:[],source:null,cursor:null,errors:api.errors||[]};
return{ok:true,trades:v156ExtractTradeRows(api.data),source:api.source,cursor:api.data?.cursor??api.data?.nextCursor??api.data?.next_cursor??null,errors:api.errors||[]};
}

// V15.6.1 FIX: Smart Money fetcher lives inside FUTURES_V6 because its
// data-center helpers (fetchGmxApiTradesSearch / v156ExtractTradeRows) are
// scoped to this module. The previous V15.6.0 global fetcher could see the
// parser helpers but not the module-local API function, causing:
//   fetchGmxApiTradesSearch is not defined
// Keep the scoring/parser helpers global, but bind the network fetcher here.
async function fetchSmartMoneyFlowData(env,flowHistory={}){
if(!CONFIG.SMART_MONEY_FLOW_ENABLED)return{available:false,source:null,bySymbol:{},trades:0,parsedTrades:0,symbols:0,rejectedTrades:0,error:"disabled"};
const now=Date.now();
if(SMART_MONEY_FLOW_CACHE.result&&now-SMART_MONEY_FLOW_CACHE.at<Number(CONFIG.SMART_MONEY_FLOW_CACHE_MS||20000))return SMART_MONEY_FLOW_CACHE.result;
try{
let allTrades=[],cursor=null,source=null,errors=[];
const maxPages=Math.max(1,Number(CONFIG.DATA_CENTER_MAX_TRADE_PAGES||2));
for(let page=0;page<maxPages;page++){
const params={forAllAccounts:"true",fromTimestamp:Math.floor((now-Number(CONFIG.SMART_MONEY_FLOW_LOOKBACK_MS||300000))/1000),limit:Number(CONFIG.SMART_MONEY_FLOW_LIMIT||250),showDebugValues:"true"};
if(cursor)params.cursor=cursor;
const direct=await fetchGmxApiTradesSearch(params);
if(direct.ok){allTrades.push(...direct.trades);source=direct.source;cursor=direct.cursor;errors.push(...(direct.errors||[]));if(!cursor||!direct.trades.length)break;}
else{errors.push(...(direct.errors||[]));break;}
}
if(!allTrades.length&&typeof GmxApiSdk!=="undefined"){
const sdk=new GmxApiSdk({chainId:42161});
const result=await sdk.searchTrades({forAllAccounts:true,fromTimestamp:Math.floor((now-Number(CONFIG.SMART_MONEY_FLOW_LOOKBACK_MS||300000))/1000),limit:Number(CONFIG.SMART_MONEY_FLOW_LIMIT||250),showDebugValues:true});
allTrades=smfExtractTradeRows(result);source="SDK_V2_SEARCH_TRADES";
}
const cappedTrades=allTrades.slice(0,Number(CONFIG.DATA_CENTER_MAX_TRADE_ROWS||750));
const aggregated=smfAggregateTrades(cappedTrades),bySymbol={};
for(const [symbol,row] of Object.entries(aggregated.bySymbol))bySymbol[symbol]=smfBuildFlowMetrics(row,Array.isArray(flowHistory?.[symbol])?flowHistory[symbol].slice(-47):[]);
const out={available:true,source:source||"GMX_API_TRADES_SEARCH",trades:cappedTrades.length,symbols:Object.keys(bySymbol).length,bySymbol,parsedTrades:Object.values(bySymbol).reduce((n,x)=>n+Number(x.tradeCount||0),0),rejectedTrades:Number(aggregated.rejected||0),error:errors.length?errors.slice(-3).join(" | "):null,lookbackMs:Number(CONFIG.SMART_MONEY_FLOW_LOOKBACK_MS||300000),cacheMs:Number(CONFIG.SMART_MONEY_FLOW_CACHE_MS||20000),spikeThreshold:Number(CONFIG.SMART_MONEY_FLOW_SPIKE_THRESHOLD||1.8),explosiveThreshold:Number(CONFIG.SMART_MONEY_FLOW_EXPLOSIVE_THRESHOLD||3)};
SMART_MONEY_FLOW_CACHE={at:now,result:out};return out;
}catch(error){const out={available:false,source:null,trades:0,symbols:0,bySymbol:{},parsedTrades:0,rejectedTrades:0,error:safeError(error)};SMART_MONEY_FLOW_CACHE={at:now,result:out};return out;}
}
 
async function fetchGmxMarkets() {
const urls = [
`${GMX.ORACLE}/markets`,
...GMX.FALLBACKS.map(base => `${base}/markets`)
];
 
let lastError;
 
for (const url of urls) {
try {
return await fetchJson(url, {
headers: { accept: "application/json" }
});
} catch (error) {
lastError = error;
}
}
 
throw lastError || new Error("All GMX market catalog endpoints failed");
}
 
function marketArray(payload) {
if (Array.isArray(payload)) return payload;
if (Array.isArray(payload?.markets)) return payload.markets;
if (Array.isArray(payload?.data)) return payload.data;
return [];
}
 
function findMarket(rawMarkets, symbol) {
const wanted = normalizeSymbol(symbol);
 
return rawMarkets.find(m => {
const direct = [
m?.symbol, m?.indexTokenSymbol,
m?.indexToken?.symbol, m?.indexToken?.tokenSymbol
].filter(Boolean).map(normalizeSymbol);
 
if (direct.includes(wanted)) return true;
 
const names = [m?.name, m?.symbol].filter(Boolean).map(String);
return names.some(name => {
const base = name.split(/[\/\[\]\s_-]+/)[0];
return normalizeSymbol(base) === wanted || normalizeSymbol(name).startsWith(wanted);
});
}) || null;
}
 
// ======================================================
// OHLCV
// ======================================================
 
async function fetchCandles(symbol, timeframe, limit) {
const normalized = normalizeSymbol(symbol);
const key = `candles:${normalized}:${timeframe}:${limit}`;
 
const result = await cached(
key,
async () => {
const oracleUrl =
`${GMX.ORACLE}/prices/candles?tokenSymbol=${encodeURIComponent(normalized)}` +
`&period=${encodeURIComponent(timeframe)}&limit=${limit}`;
 
try {
const data = await fetchJson(oracleUrl, {
headers: { accept: "application/json" }
});
 
return normalizeCandles(data);
} catch {
const apiUrls = GMX.FALLBACKS.map(base =>
`${base}/prices/candles?tokenSymbol=${encodeURIComponent(normalized)}` +
`&period=${encodeURIComponent(timeframe)}&limit=${limit}`
);
 
let lastError;
 
for (const url of apiUrls) {
try {
return normalizeCandles(await fetchJson(url));
} catch (error) {
lastError = error;
}
}
 
throw lastError || new Error(`No candle source for ${normalized}`);
}
},
CONFIG.CANDLE_CACHE_TTL_MS
);
 
return result.value;
}
 
// Scan-safe candle fetch: one external request per timeframe.
// We intentionally do not fan out to multiple fallbacks inside a scan,
// because a 10-market x 4-timeframe scan must stay below Cloudflare's
// per-invocation subrequest budget. Single-symbol /v6/signal retains
// the resilient fallback path above.
async function fetchCandlesScan(symbol, timeframe, limit) {
const normalized = normalizeSymbol(symbol);
const key = `scan-candles:${normalized}:${timeframe}:${limit}`;
 
const result = await cached(
key,
async () => {
const url =
`${GMX.ORACLE}/prices/candles?tokenSymbol=${encodeURIComponent(normalized)}` +
`&period=${encodeURIComponent(timeframe)}&limit=${limit}`;
 
const data = await fetchJson(url, {
headers: { accept: "application/json" }
});
 
const candles = normalizeCandles(data);
if (!candles.length) {
throw new Error(`Empty candle data: ${normalized} ${timeframe}`);
}
return candles;
},
CONFIG.CANDLE_CACHE_TTL_MS
);
 
return result.value;
}
 
function normalizeCandles(payload) {
let raw = [];
 
if (Array.isArray(payload)) raw = payload;
else if (Array.isArray(payload?.candles)) raw = payload.candles;
else if (Array.isArray(payload?.data)) raw = payload.data;
else if (Array.isArray(payload?.ohlcv)) raw = payload.ohlcv;
 
const candles = raw.map(c => {
if (Array.isArray(c)) {
return {
timestamp: Number(c[0]),
open: Number(c[1]),
high: Number(c[2]),
low: Number(c[3]),
close: Number(c[4]),
volume: Number(c[5] ?? 0)
};
}
 
return {
timestamp: Number(c.timestamp),
open: Number(c.open),
high: Number(c.high),
low: Number(c.low),
close: Number(c.close),
volume: Number(c.volume ?? c.vol ?? c.volumeUsd ?? c.volumeUSD ?? 0)
};
}).filter(c =>
c.timestamp > 0 &&
[c.open, c.high, c.low, c.close].every(Number.isFinite)
);
 
candles.sort((a, b) => a.timestamp - b.timestamp);
return candles;
}
 
// ======================================================
// TECHNICAL INDICATORS
// ======================================================
 
function sma(values, period) {
if (values.length < period) return null;
const slice = values.slice(-period);
return slice.reduce((a, b) => a + b, 0) / period;
}
 
function ema(values, period) {
if (values.length < period) return null;
 
const k = 2 / (period + 1);
let value = values.slice(0, period)
.reduce((a, b) => a + b, 0) / period;
 
for (let i = period; i < values.length; i++) {
value = values[i] * k + value * (1 - k);
}
 
return value;
}
 
function trueRanges(candles) {
const out = [];
 
for (let i = 0; i < candles.length; i++) {
if (i === 0) {
out.push(candles[i].high - candles[i].low);
continue;
}
 
const c = candles[i];
const prev = candles[i - 1].close;
 
out.push(Math.max(
c.high - c.low,
Math.abs(c.high - prev),
Math.abs(c.low - prev)
));
}
 
return out;
}
 
function atr(candles, period = 14) {
const tr = trueRanges(candles);
return ema(tr, period);
}
 
function rsi(candles, period = 14) {
if (candles.length <= period) return null;
 
let gains = 0;
let losses = 0;
 
for (let i = 1; i <= period; i++) {
const diff = candles[i].close - candles[i - 1].close;
if (diff >= 0) gains += diff;
else losses += Math.abs(diff);
}
 
let avgGain = gains / period;
let avgLoss = losses / period;
 
for (let i = period + 1; i < candles.length; i++) {
const diff = candles[i].close - candles[i - 1].close;
const gain = Math.max(diff, 0);
const loss = Math.max(-diff, 0);
 
avgGain = ((avgGain * (period - 1)) + gain) / period;
avgLoss = ((avgLoss * (period - 1)) + loss) / period;
}
 
if (avgLoss === 0) return 100;
 
const rs = avgGain / avgLoss;
return 100 - (100 / (1 + rs));
}
 
function percentChange(candles, bars) {
if (candles.length <= bars) return 0;
const a = candles[candles.length - 1].close;
const b = candles[candles.length - 1 - bars].close;
return b ? ((a - b) / b) * 100 : 0;
}
 
function highest(candles, period) {
return Math.max(...candles.slice(-period).map(c => c.high));
}
 
function lowest(candles, period) {
return Math.min(...candles.slice(-period).map(c => c.low));
}
 
// ======================================================
// TREND ENGINE
// ======================================================
 
function timeframeTrend(candles) {
if (!candles || candles.length < 55) {
return {
direction: "UNKNOWN",
score: 0,
emaFast: null,
emaSlow: null,
rsi: null
};
}
 
const closes = candles.map(c => c.close);
const fast = ema(closes, 21);
const slow = ema(closes, 55);
const last = closes[closes.length - 1];
const rs = rsi(candles, 14);
 
let score = 0;
 
if (last > fast) score += 25;
else score -= 25;
 
if (fast > slow) score += 35;
else score -= 35;
 
if (rs !== null) {
if (rs >= 52 && rs <= 72) score += 20;
else if (rs <= 48 && rs >= 28) score -= 20;
else if (rs > 72) score += 5;
else if (rs < 28) score -= 5;
}
 
const change = percentChange(candles, Math.min(12, candles.length - 1));
 
if (change > 0) score += 20;
else if (change < 0) score -= 20;
 
const direction =
score >= 30 ? "BULLISH" :
score <= -30 ? "BEARISH" :
"NEUTRAL";
 
return {
direction,
score: Math.max(-100, Math.min(100, score)),
emaFast: fast,
emaSlow: slow,
rsi: rs,
change
};
}
 
function buildTrendConfluence(data) {
const macro = timeframeTrend(data["4h"]);
const trend = timeframeTrend(data["1h"]);
const entry = timeframeTrend(data["15m"]);
const fast = timeframeTrend(data["5m"]);
 
const bullish = [
macro.direction === "BULLISH",
trend.direction === "BULLISH",
entry.direction === "BULLISH",
fast.direction === "BULLISH"
].filter(Boolean).length;
 
const bearish = [
macro.direction === "BEARISH",
trend.direction === "BEARISH",
entry.direction === "BEARISH",
fast.direction === "BEARISH"
].filter(Boolean).length;
 
const longScore =
(macro.direction === "BULLISH" ? 30 : 0) +
(trend.direction === "BULLISH" ? 30 : 0) +
(entry.direction === "BULLISH" ? 25 : 0) +
(fast.direction === "BULLISH" ? 15 : 0);
 
const shortScore =
(macro.direction === "BEARISH" ? 30 : 0) +
(trend.direction === "BEARISH" ? 30 : 0) +
(entry.direction === "BEARISH" ? 25 : 0) +
(fast.direction === "BEARISH" ? 15 : 0);
 
return {
macro,
trend,
entry,
fast,
bullish,
bearish,
longScore,
shortScore,
alignment:
bullish >= 3 ? "BULLISH" :
bearish >= 3 ? "BEARISH" :
"MIXED"
};
}
 
// ======================================================
// MOMENTUM ENGINE
// ======================================================
 
function momentumScore(candles) {
if (!candles || candles.length < 30) {
return { long: 0, short: 0, rsi: null, change5: 0, change15: 0 };
}
 
const rs = rsi(candles, 14);
const change5 = percentChange(candles, 5);
const change15 = percentChange(candles, 15);
 
let long = 0;
let short = 0;
 
if (change5 > 0.25) long += 20;
if (change5 > 0.75) long += 10;
if (change15 > 0.5) long += 20;
if (change15 > 1.5) long += 10;
 
if (change5 < -0.25) short += 20;
if (change5 < -0.75) short += 10;
if (change15 < -0.5) short += 20;
if (change15 < -1.5) short += 10;
 
if (rs !== null) {
if (rs >= 52 && rs <= 68) long += 20;
if (rs <= 48 && rs >= 32) short += 20;
 
if (rs > 78) long -= 15;
if (rs < 22) short -= 15;
}
 
return {
long: Math.max(0, Math.min(100, long)),
short: Math.max(0, Math.min(100, short)),
rsi: rs,
change5,
change15
};
}
 
// ======================================================
// VOLUME / PARTICIPATION ENGINE
// ======================================================
//
// GMX OHLCV does not provide exchange-style volume in the
// documented candle format. Therefore this engine NEVER
// invents volume. It uses candle range expansion as a
// participation proxy and explicitly labels it as such.
// ======================================================
 
function participationScore(candles) {
if (!candles || candles.length < 25) {
return { long: 0, short: 0, expansion: 0 };
}
 
const ranges = candles.map(c => c.high - c.low);
const recent = sma(ranges, 5);
const base = sma(ranges.slice(0, -5), Math.min(20, ranges.length - 5));
 
if (!recent || !base || base <= 0) {
return { long: 0, short: 0, expansion: 0 };
}
 
const expansion = recent / base;
const last = candles[candles.length - 1];
 
let long = 0;
let short = 0;
 
if (expansion > 1.15) {
if (last.close > last.open) long += 20;
if (last.close < last.open) short += 20;
}
 
if (expansion > 1.5) {
if (last.close > last.open) long += 10;
if (last.close < last.open) short += 10;
}
 
return {
long: Math.min(100, long),
short: Math.min(100, short),
expansion
};
}
 
// ======================================================
// MARKET STRUCTURE
// ======================================================
 
function structureScore(candles) {
if (!candles || candles.length < 30) {
return { long: 0, short: 0, breakout: "NONE" };
}
 
const last = candles[candles.length - 1];
const prior = candles.slice(0, -1);
 
const resistance = highest(prior, 20);
const support = lowest(prior, 20);
 
let long = 0;
let short = 0;
let breakout = "NONE";
 
if (last.close > resistance) {
long += 25;
breakout = "UPSIDE";
}
 
if (last.close < support) {
short += 25;
breakout = "DOWNSIDE";
}
 
const recentHigh = highest(candles, 10);
const recentLow = lowest(candles, 10);
 
if (last.close >= recentHigh * 0.995) long += 10;
if (last.close <= recentLow * 1.005) short += 10;
 
return { long, short, breakout, resistance, support };
}
 
// ======================================================
// OI / FUNDING ENGINE
// ======================================================
//
// /markets/info provides near-live OI and funding. We compare
// against a previous snapshot stored in KV. A missing previous
// value is treated as "unknown", never as zero confirmation.
// ======================================================
 
function derivativesScore(current, previous) {
const oi = extractOpenInterest(current);
const funding = extractFunding(current);
 
const previousOI = previous ? extractOpenInterest(previous) : 0;
 
let oiChange = null;
if (previous && previousOI > 0 && oi > 0) {
oiChange = ((oi - previousOI) / previousOI) * 100;
}
 
let long = 0;
let short = 0;
 
if (oiChange !== null) {
const priceBias = current.__priceBias || 0;
 
if (oiChange > 3 && priceBias > 0) long += 20;
if (oiChange > 3 && priceBias < 0) short += 20;
 
if (oiChange < -3 && priceBias > 0) short += 8;
if (oiChange < -3 && priceBias < 0) long += 8;
}
 
// Funding is a crowding filter, not a standalone entry signal.
if (funding > 0.0008) short += 12;
if (funding < -0.0008) long += 12;
 
if (funding > 0.003) short += 8;
if (funding < -0.003) long += 8;
 
return {
long: Math.min(40, long),
short: Math.min(40, short),
oi,
oiChange,
funding
};
}
 
// ======================================================
// RISK DETECTORS
// ======================================================
 
function fakeMoveRisk(candles) {
if (!candles || candles.length < 20) return 0;

const change = Math.abs(percentChange(candles, 3));
let risk = 0;

// V13.8: derivatives are intentionally excluded from score/risk.
// Keep only pure price-action risk here.
if (change > 7) risk += 20;

return Math.min(40, risk);
}
 
function exhaustionRisk(candles) {
const rs = rsi(candles, 14);
if (rs === null) return 0;
 
if (rs >= 82 || rs <= 18) return 25;
if (rs >= 76 || rs <= 24) return 12;
 
return 0;
}
 
function chopRisk(trend) {
if (trend.alignment === "MIXED") return 15;
return 0;
}
 
function totalRisk(...risks) {
return Math.min(100, risks.reduce((a, b) => a + b, 0));
}
 
// ======================================================
// MARKET SNAPSHOT
// ======================================================
 
async function buildMarketSnapshot(symbol, env, options = {}) {
const normalized = normalizeSymbol(symbol);
const scanMode = options.scanMode === true;
 
// In a full scan the market catalog is fetched once and shared.
// For a single-symbol request the normal cached path is retained.
const marketPromise = options.marketResult
? Promise.resolve(options.marketResult)
: cached("markets-info", fetchGmxMarketsInfo, CONFIG.MARKET_CACHE_TTL_MS);
 
const candleFetcher = scanMode ? fetchCandlesScan : fetchCandles;
 
const [marketResult, c5, c15, c1h, c4h] = await Promise.all([
marketPromise,
candleFetcher(normalized, "5m", CONFIG.CANDLE_LIMIT["5m"]),
candleFetcher(normalized, "15m", CONFIG.CANDLE_LIMIT["15m"]),
candleFetcher(normalized, "1h", CONFIG.CANDLE_LIMIT["1h"]),
candleFetcher(normalized, "4h", CONFIG.CANDLE_LIMIT["4h"])
]);
 
const rawMarkets = marketArray(marketResult.value);
const raw = findMarket(rawMarkets, normalized);
 
if (!raw) {
throw new Error(`GMX market not found: ${normalized}`);
}
 
const counts = {
"5m": c5.length,
"15m": c15.length,
"1h": c1h.length,
"4h": c4h.length
};
 
const insufficient = Object.entries(counts)
.filter(([_, n]) => n < 55)
.map(([tf]) => tf);
 
if (insufficient.length) {
throw new Error(`Insufficient candle data: ${insufficient.join(",")}`);
}
 
const lastPrice =
c5?.[c5.length - 1]?.close ||
c15?.[c15.length - 1]?.close ||
0;
 
const priceBias = percentChange(c15, 3);
raw.__priceBias = priceBias;
 
return {
symbol: normalized,
price: lastPrice,
market: raw,
candles: {
"5m": c5,
"15m": c15,
"1h": c1h,
"4h": c4h
},
trend: buildTrendConfluence({
"5m": c5,
"15m": c15,
"1h": c1h,
"4h": c4h
}),
fetchedAt: Date.now()
};
}
 
// ======================================================
// V16.1.1: candle-aware microstructure overlay.
// The independent Radar history is intentionally lightweight and can be stale
// on scheduled runners. The deep scan already fetches 5m candles, so reuse
// those candles to detect an intrabar impulse/rejection without extra HTTP.
function v1611CandleMicrostructure(candles) {
  const rows = Array.isArray(candles) ? candles.filter(c =>
    c && Number.isFinite(Number(c.open)) && Number.isFinite(Number(c.high)) &&
    Number.isFinite(Number(c.low)) && Number.isFinite(Number(c.close)) &&
    Number(c.high) >= Number(c.low) && Number(c.close) > 0
  ) : [];
  if (rows.length < 20) return {available:false, reason:"INSUFFICIENT_5M_CANDLES", longScore:0, shortScore:0, longReversalRisk:0, shortReversalRisk:0, reasons:[]};
  const last=rows[rows.length-1], prev=rows[rows.length-2];
  const close=Number(last.close), open=Number(last.open), high=Number(last.high), low=Number(last.low);
  const move3=percentChange(rows,Math.min(3,rows.length-1)), move5=percentChange(rows,Math.min(5,rows.length-1));
  const range=Math.max(0,high-low), body=Math.abs(close-open);
  const upperWick=Math.max(0,high-Math.max(open,close)), lowerWick=Math.max(0,Math.min(open,close)-low);
  const closeLocation=range>0?(close-low)/range:0.5;
  const bodyRatio=range>0?body/range:0;
  const priorRanges=rows.slice(-21,-1).map(c=>Math.max(0,Number(c.high)-Number(c.low))).filter(x=>x>0);
  const baseRange=priorRanges.length?sma(priorRanges,Math.min(20,priorRanges.length)):0;
  const rangeExpansion=baseRange>0?range/baseRange:1;
  const lastRed=close<open,lastGreen=close>open,prevRed=Number(prev.close)<Number(prev.open),prevGreen=Number(prev.close)>Number(prev.open);
  const rangeShock=rangeExpansion>=Number(CONFIG.RADAR_CANDLE_RANGE_EXPANSION||1.45);
  const closeLow=closeLocation<=Number(CONFIG.RADAR_CANDLE_CLOSE_EXTREME||0.22),closeHigh=closeLocation>=1-Number(CONFIG.RADAR_CANDLE_CLOSE_EXTREME||0.22);
  const bearishRejection=upperWick/Math.max(range,1e-12)>=Number(CONFIG.RADAR_CANDLE_WICK_REJECTION||0.45)&&closeLocation<0.45;
  const bullishRejection=lowerWick/Math.max(range,1e-12)>=Number(CONFIG.RADAR_CANDLE_WICK_REJECTION||0.45)&&closeLocation>0.55;
  const dumpImpulse=move3<=-Number(CONFIG.RADAR_CANDLE_MOVE3_PCT||1)||move5<=-Number(CONFIG.RADAR_CANDLE_MOVE5_PCT||1.5);
  const pumpImpulse=move3>=Number(CONFIG.RADAR_CANDLE_MOVE3_PCT||1)||move5>=Number(CONFIG.RADAR_CANDLE_MOVE5_PCT||1.5);
  const reversalFromGreen=lastRed&&prevGreen&&dumpImpulse;
  const reversalFromRed=lastGreen&&prevRed&&pumpImpulse;
  let shortScore=0,longScore=0,longReversalRisk=0,shortReversalRisk=0;
  const shortReasons=[],longReasons=[],longReversalReasons=[],shortReversalReasons=[];
  if(dumpImpulse){shortScore+=25;shortReasons.push("CANDLE_DUMP_IMPULSE");}
  if(move3<=-2){shortScore+=12;shortReasons.push("CANDLE_DUMP_ACCELERATION");}
  if(rangeShock&&lastRed){shortScore+=15;shortReasons.push("CANDLE_RANGE_SHOCK_SELL");}
  if(closeLow&&lastRed){shortScore+=12;shortReasons.push("CANDLE_CLOSE_NEAR_LOW");}
  if(lastRed&&prevRed){shortScore+=8;shortReasons.push("CANDLE_RED_SEQUENCE");}
  if(bearishRejection){shortScore+=8;shortReasons.push("CANDLE_BEARISH_REJECTION");}
  if(pumpImpulse){longScore+=25;longReasons.push("CANDLE_PUMP_IMPULSE");}
  if(move3>=2){longScore+=12;longReasons.push("CANDLE_PUMP_ACCELERATION");}
  if(rangeShock&&lastGreen){longScore+=15;longReasons.push("CANDLE_RANGE_SHOCK_BUY");}
  if(closeHigh&&lastGreen){longScore+=12;longReasons.push("CANDLE_CLOSE_NEAR_HIGH");}
  if(lastGreen&&prevGreen){longScore+=8;longReasons.push("CANDLE_GREEN_SEQUENCE");}
  if(bullishRejection){longScore+=8;longReasons.push("CANDLE_BULLISH_REJECTION");}
  if(reversalFromGreen){longReversalRisk+=30;longReversalReasons.push("LONG_TO_RED_CANDLE_FLIP");}
  if(rangeShock&&lastRed){longReversalRisk+=18;longReversalReasons.push("LONG_RANGE_EXPANSION_AGAINST_SIDE");}
  if(closeLow&&lastRed){longReversalRisk+=18;longReversalReasons.push("LONG_CLOSE_NEAR_LOW");}
  if(bearishRejection){longReversalRisk+=12;longReversalReasons.push("LONG_BEARISH_REJECTION");}
  if(dumpImpulse){longReversalRisk+=18;longReversalReasons.push("LONG_DOWNSIDE_IMPULSE");}
  if(reversalFromRed){shortReversalRisk+=30;shortReversalReasons.push("SHORT_TO_GREEN_CANDLE_FLIP");}
  if(rangeShock&&lastGreen){shortReversalRisk+=18;shortReversalReasons.push("SHORT_RANGE_EXPANSION_AGAINST_SIDE");}
  if(closeHigh&&lastGreen){shortReversalRisk+=18;shortReversalReasons.push("SHORT_CLOSE_NEAR_HIGH");}
  if(bullishRejection){shortReversalRisk+=12;shortReversalReasons.push("SHORT_BULLISH_REJECTION");}
  if(pumpImpulse){shortReversalRisk+=18;shortReversalReasons.push("SHORT_UPSIDE_IMPULSE");}
  return {available:true,move3:Number(move3.toFixed(3)),move5:Number(move5.toFixed(3)),rangeExpansion:Number(rangeExpansion.toFixed(3)),closeLocation:Number(closeLocation.toFixed(3)),bodyRatio:Number(bodyRatio.toFixed(3)),upperWickRatio:Number((upperWick/Math.max(range,1e-12)).toFixed(3)),lowerWickRatio:Number((lowerWick/Math.max(range,1e-12)).toFixed(3)),lastRed,lastGreen,prevRed,prevGreen,rangeShock,closeLow,closeHigh,bearishRejection,bullishRejection,dumpImpulse,pumpImpulse,reversalFromGreen,reversalFromRed,longScore:Math.min(100,longScore),shortScore:Math.min(100,shortScore),longReversalRisk:Math.min(100,longReversalRisk),shortReversalRisk:Math.min(100,shortReversalRisk),shortReasons:[...new Set(shortReasons)],longReasons:[...new Set(longReasons)],longReversalReasons:[...new Set(longReversalReasons)],shortReversalReasons:[...new Set(shortReversalReasons)],reasons:[...new Set([...shortReasons,...longReasons,...longReversalReasons,...shortReversalReasons])].slice(0,16),timestamp:Number(last.timestamp||0),close};
}

// SIGNAL ENGINE
// ======================================================
 
 
// ======================================================
// V7 ADVANCED FAST CONFLUENCE ENGINE
// All calculations below are local and use already-fetched candles.
// They add ZERO network subrequests and therefore do not add API latency.
// The engine uses confirmation voting rather than requiring every indicator.
// ======================================================
 
function v7Closes(candles) {
return (candles || []).map(c => Number(c.close)).filter(Number.isFinite);
}
 
function v7Volumes(candles) {
return (candles || []).map(c => Number(c.volume)).filter(Number.isFinite);
}
 
function v7Vwap(candles, period = 60) {
const cs = (candles || []).slice(-period);
let pv = 0, vol = 0;
for (const c of cs) {
const h = Number(c.high), l = Number(c.low), cl = Number(c.close);
const v = Number(c.volume);
if (![h,l,cl,v].every(Number.isFinite) || v <= 0) continue;
pv += ((h + l + cl) / 3) * v;
vol += v;
}
return vol > 0 ? pv / vol : null;
}
 
function v7Adx(candles, period = 14) {
if (!candles || candles.length < period * 2 + 1) return null;
const tr = [], plus = [], minus = [];
for (let i = 1; i < candles.length; i++) {
const c = candles[i], p = candles[i-1];
const up = c.high - p.high;
const down = p.low - c.low;
tr.push(Math.max(c.high-c.low, Math.abs(c.high-p.close), Math.abs(c.low-p.close)));
plus.push(up > down && up > 0 ? up : 0);
minus.push(down > up && down > 0 ? down : 0);
}
let atrv = sma(tr.slice(0, period), period);
let pDM = sma(plus.slice(0, period), period);
let mDM = sma(minus.slice(0, period), period);
if (![atrv,pDM,mDM].every(Number.isFinite) || atrv === 0) return null;
 
const dx = [];
for (let i = period; i < tr.length; i++) {
atrv = ((atrv * (period - 1)) + tr[i]) / period;
pDM = ((pDM * (period - 1)) + plus[i]) / period;
mDM = ((mDM * (period - 1)) + minus[i]) / period;
const pDI = atrv ? 100 * pDM / atrv : 0;
const mDI = atrv ? 100 * mDM / atrv : 0;
const denom = pDI + mDI;
dx.push(denom ? 100 * Math.abs(pDI - mDI) / denom : 0);
}
return dx.length >= period ? sma(dx.slice(-period), period) : null;
}
 
function v7Macd(candles) {
const closes = v7Closes(candles);
if (closes.length < 35) return null;
const fast = ema(closes, 12);
const slow = ema(closes, 26);
if (![fast,slow].every(Number.isFinite)) return null;
const macd = fast - slow;
 
// Lightweight histogram approximation from the current MACD and a
// short MACD history. No extra requests are needed.
const history = [];
for (let i = Math.max(26, closes.length - 35); i < closes.length; i++) {
const f = ema(closes.slice(0, i + 1), 12);
const s = ema(closes.slice(0, i + 1), 26);
if (Number.isFinite(f) && Number.isFinite(s)) history.push(f - s);
}
const signal = history.length >= 9 ? ema(history, 9) : null;
return {
macd,
signal,
histogram: Number.isFinite(signal) ? macd - signal : null
};
}
 
function v7PivotDivergence(candles) {
if (!candles || candles.length < 40) return { bullish: false, bearish: false };
const recent = candles.slice(-40);
const closes = v7Closes(recent);
const rsiNow = rsi(recent, 14);
const half = Math.floor(recent.length / 2);
const left = recent.slice(0, half);
const right = recent.slice(half);
const rsiLeft = rsi(left, 14);
const rsiRight = rsi(right, 14);
const highLeft = Math.max(...left.map(c => c.high));
const highRight = Math.max(...right.map(c => c.high));
const lowLeft = Math.min(...left.map(c => c.low));
const lowRight = Math.min(...right.map(c => c.low));
 
return {
bullish: Number.isFinite(rsiLeft) && Number.isFinite(rsiRight) &&
lowRight < lowLeft && rsiRight > rsiLeft,
bearish: Number.isFinite(rsiLeft) && Number.isFinite(rsiRight) &&
highRight > highLeft && rsiRight < rsiLeft,
rsi: rsiNow
};
}
 
function v7Regime(candles) {
const closes = v7Closes(candles);
if (closes.length < 50) return { regime: "UNKNOWN", adx: null };
const adx = v7Adx(candles, 14);
const atrNow = atr(candles, 14);
const price = closes[closes.length - 1];
const ema20 = ema(closes, 20);
const ema50 = ema(closes, 50);
const atrPct = price > 0 && Number.isFinite(atrNow) ? atrNow / price * 100 : 0;
 
let regime = "RANGE";
if (Number.isFinite(adx) && adx >= 25) regime = "TREND";
else if (Number.isFinite(adx) && adx <= 18) regime = "RANGE";
 
if (atrPct >= 2.5) regime = "HIGH_VOL";
if (Number.isFinite(ema20) && Number.isFinite(ema50) &&
Math.abs(ema20 - ema50) / price < 0.0015 &&
(!Number.isFinite(adx) || adx < 22)) regime = "CHOP";
 
return { regime, adx, atrPct, ema20, ema50 };
}
 
function v7AdvancedConfirmation(snapshot, direction) {
const candles = snapshot?.candles?.["15m"] || [];
const closes = v7Closes(candles);
const price = Number(snapshot?.price);
const ema20 = ema(closes, 20);
const ema50 = ema(closes, 50);
const ema200 = ema(closes, 200);
const vwap = v7Vwap(candles, 60);
const adx = v7Adx(candles, 14);
const macd = v7Macd(candles);
const div = v7PivotDivergence(candles);
const regime = v7Regime(candles);
 
const long = direction === "LONG";
const short = direction === "SHORT";
const confirmations = [];
const contradictions = [];
 
if (Number.isFinite(price) && Number.isFinite(vwap)) {
if ((long && price > vwap) || (short && price < vwap)) confirmations.push("VWAP");
else contradictions.push("VWAP");
}
 
if ([ema20,ema50].every(Number.isFinite)) {
if ((long && ema20 > ema50) || (short && ema20 < ema50)) confirmations.push("EMA20_50");
else contradictions.push("EMA20_50");
}
 
if (Number.isFinite(ema200)) {
if ((long && price > ema200) || (short && price < ema200)) confirmations.push("EMA200");
else contradictions.push("EMA200");
}
 
if (Number.isFinite(adx)) {
if (adx >= 22) confirmations.push("ADX");
else contradictions.push("ADX_WEAK");
}
 
if (Number.isFinite(macd?.histogram)) {
if ((long && macd.histogram > 0) || (short && macd.histogram < 0)) confirmations.push("MACD");
else contradictions.push("MACD");
}
 
if ((long && div.bullish) || (short && div.bearish)) confirmations.push("DIVERGENCE");
if ((long && div.bearish) || (short && div.bullish)) contradictions.push("DIVERGENCE");
 
// Optional derivatives/order-flow evidence, if the Data Engine supplies it.
const smOut = Boolean(snapshot?.smartMoney?.outflow ?? snapshot?.smartMoneyOutflow);
const cvd = Number(snapshot?.cvd ?? snapshot?.orderFlow?.cvd);
const oiChange = Number(snapshot?.market?.oiChange);
if (Number.isFinite(cvd)) {
if ((long && cvd > 0) || (short && cvd < 0)) confirmations.push("CVD");
else contradictions.push("CVD");
}
if (Number.isFinite(oiChange)) {
if (Math.abs(oiChange) >= 0.5) confirmations.push("OI_DELTA");
}
if (smOut) contradictions.push("SMART_MONEY_OUTFLOW");
 
// Fast-vote design: require only 2 confirmations, not every indicator.
const votes = confirmations.length - contradictions.length * 0.75;
const boost = Math.max(-8, Math.min(10, confirmations.length * 2 - contradictions.length * 1.5));
 
return {
confirmations,
contradictions,
votes: Number(votes.toFixed(2)),
boost: Number(boost.toFixed(2)),
regime,
indicators: {
ema20, ema50, ema200, vwap, adx,
macd,
divergence: div
},
ready: confirmations.length >= 2 && votes >= 1.5 && regime.regime !== "CHOP"
};
}
 
 
// ======================================================
// V9.1 PRECISION ENTRY / EXIT ENGINE
// Adds a price-action trigger and anti-chase gate on top of
// the existing V8 trend, momentum, structure and derivatives engines.
// ======================================================
function v91CandleTrigger(candles, direction) {
if (!candles || candles.length < 8) return { score: 0, trigger: "NONE", reasons: ["insufficient_trigger_data"] };
const c = candles[candles.length - 1], p = candles[candles.length - 2];
const range = Math.max(1e-12, c.high - c.low);
const body = Math.abs(c.close - c.open);
const upper = c.high - Math.max(c.open, c.close);
const lower = Math.min(c.open, c.close) - c.low;
const bodyRatio = body / range;
let score = 0, trigger = "NONE";
const reasons = [];
if (direction === "LONG") {
if (c.close > c.open && bodyRatio >= 0.45) { score += 25; reasons.push("bullish_body"); }
if (lower / range >= 0.30 && c.close >= c.open) { score += 20; reasons.push("lower_wick_rejection"); }
if (c.close > p.high) { score += 25; trigger = "BREAKOUT"; reasons.push("close_above_previous_high"); }
if (c.low <= p.high && c.close > p.high) { score += 20; trigger = "RETEST_RECLAIM"; reasons.push("breakout_reclaim"); }
} else {
if (c.close < c.open && bodyRatio >= 0.45) { score += 25; reasons.push("bearish_body"); }
if (upper / range >= 0.30 && c.close <= c.open) { score += 20; reasons.push("upper_wick_rejection"); }
if (c.close < p.low) { score += 25; trigger = "BREAKDOWN"; reasons.push("close_below_previous_low"); }
if (c.high >= p.low && c.close < p.low) { score += 20; trigger = "RETEST_REJECT"; reasons.push("breakdown_reject"); }
}
if (bodyRatio < 0.18) { score -= 20; reasons.push("indecision_candle"); }
return { score: Math.max(0, Math.min(100, score)), trigger, reasons, bodyRatio };
}
 
function v91EntryPrecision(snapshot, direction) {
const c5 = snapshot?.candles?.["5m"] || [], c15 = snapshot?.candles?.["15m"] || [];
const c1h = snapshot?.candles?.["1h"] || [], c4h = snapshot?.candles?.["4h"] || [];
if ([c5,c15,c1h,c4h].some(c => c.length < 55)) return { ready:false, score:0, triggerScore:0, reasons:["insufficient_multi_timeframe_data"] };
const long = direction === "LONG", expected = long ? "BULLISH" : "BEARISH";
const price = Number(snapshot.price), atr5 = atr(c5,14);
const closes5=v7Closes(c5), closes15=v7Closes(c15);
const ema20_5=ema(closes5,20), ema50_5=ema(closes5,50), vwap5=v7Vwap(c5,60);
const adx5=v7Adx(c5,14), adx15=v7Adx(c15,14), macd5=v7Macd(c5), rsi5=rsi(c5,14);
const t15=timeframeTrend(c15), t1h=timeframeTrend(c1h), t4h=timeframeTrend(c4h);
const trigger=v91CandleTrigger(c5,direction);
let score=0; const confirmations=[], contradictions=[], reasons=[];
if(t4h.direction===expected){score+=15;confirmations.push("4H_TREND");}else contradictions.push("4H_TREND");
if(t1h.direction===expected){score+=15;confirmations.push("1H_TREND");}else contradictions.push("1H_TREND");
if(t15.direction===expected){score+=15;confirmations.push("15M_TREND");}else contradictions.push("15M_TREND");
if([ema20_5,ema50_5].every(Number.isFinite)&&((long&&ema20_5>ema50_5)||(!long&&ema20_5<ema50_5))){score+=10;confirmations.push("5M_EMA_ALIGNMENT");}else contradictions.push("5M_EMA_ALIGNMENT");
if(Number.isFinite(price)&&Number.isFinite(vwap5)&&((long&&price>vwap5)||(!long&&price<vwap5))){score+=8;confirmations.push("VWAP");}else contradictions.push("VWAP");
if(Number.isFinite(macd5?.histogram)&&((long&&macd5.histogram>0)||(!long&&macd5.histogram<0))){score+=8;confirmations.push("MACD_5M");}else contradictions.push("MACD_5M");
if(Number.isFinite(adx5)&&adx5>=V8_UNIVERSE.PRECISION.minAdx){score+=7;confirmations.push("ADX_5M");}else contradictions.push("ADX_5M_WEAK");
if(Number.isFinite(adx15)&&adx15>=V8_UNIVERSE.PRECISION.minAdx){score+=5;confirmations.push("ADX_15M");}
if(Number.isFinite(rsi5)){
const ok=long?(rsi5>=45&&rsi5<=72):(rsi5>=28&&rsi5<=55);
if(ok){score+=5;confirmations.push("RSI_ZONE");}
if((long&&rsi5>82)||(!long&&rsi5<18)){score-=10;contradictions.push("RSI_EXHAUSTION");}
}
const extension=Number.isFinite(price)&&Number.isFinite(ema20_5)&&Number.isFinite(atr5)&&atr5>0?Math.abs(price-ema20_5)/atr5:null;
if(extension!==null){if(extension<=V8_UNIVERSE.PRECISION.maxExtensionAtr){score+=5;confirmations.push("NOT_OVEREXTENDED");}else{score-=15;contradictions.push("OVEREXTENDED");reasons.push(`extension_atr=${extension.toFixed(2)}`);}}
score+=Math.round(trigger.score*0.25);
if(trigger.score>=V8_UNIVERSE.PRECISION.minTriggerScore) confirmations.push(`TRIGGER:${trigger.trigger}`); else contradictions.push("TRIGGER_WEAK");
reasons.push(...trigger.reasons);
const higherTfAgreement=(t4h.direction===expected?1:0)+(t1h.direction===expected?1:0)+(t15.direction===expected?1:0);
const ready=score>=V8_UNIVERSE.PRECISION.minEntryScore&&trigger.score>=V8_UNIVERSE.PRECISION.minTriggerScore&&(!V8_UNIVERSE.PRECISION.requireHigherTfAgreement||higherTfAgreement>=2)&&!contradictions.includes("OVEREXTENDED");
return {ready,score:Math.max(0,Math.min(100,score)),triggerScore:trigger.score,trigger:trigger.trigger,confirmations,contradictions,higherTfAgreement,extensionAtr:extension,indicators:{atr5,ema20_5,ema50_5,vwap5,adx5,adx15,macd5,rsi5},reasons};
}
 
function v91PrecisionExitPlan(snapshot, analysis, entry, stopLoss) {
if(!entry||!stopLoss||!["LONG","SHORT"].includes(analysis.direction)) return null;
const c15=snapshot?.candles?.["15m"]||[], a=atr(c15,14), risk=Math.abs(entry-stopLoss), long=analysis.direction==="LONG";
if(!(risk>0)) return null;
const hi=highest(c15.slice(0,-1),30), lo=lowest(c15.slice(0,-1),30);
const rrBase=analysis.score>=90?3:analysis.score>=85?2.5:2;
const structureDist=long?hi-entry:entry-lo;
let target=Math.max(risk*rrBase,Number.isFinite(a)?a*1.5:risk*1.5);
if(Number.isFinite(structureDist)&&structureDist>0) target=Math.max(target,Math.min(structureDist*1.15,risk*4));
return {tp1:Number((long?entry+risk:entry-risk).toFixed(8)),tp2:Number((long?entry+target*.66:entry-target*.66).toFixed(8)),tp3:Number((long?entry+target:entry-target).toFixed(8)),rr:Number((target/risk).toFixed(2)),method:"ATR+structure+signal-strength",invalidation:long?"15m_close_below_stop":"15m_close_above_stop"};
}
 
// V15.6.13: Canonical trend-confluence bridge. The signal object historically
// exposed only the four timeframe directions, while the execution trace/gate
// later expected snapshot-only bullish/bearish counters. Keep one canonical
// calculation so Trend -> Signal -> Execution cannot silently become 0/4.
function v15613TrendConfluence(trend, direction) {
  const t = trend || {};
  const dirs = [t.macro4h ?? t.macro?.direction, t.trend1h ?? t.trend?.direction, t.entry15m ?? t.entry?.direction, t.fast5m ?? t.fast?.direction]
    .map(x => String(x || '').toUpperCase());
  const bullish = dirs.filter(x => x === 'BULLISH').length;
  const bearish = dirs.filter(x => x === 'BEARISH').length;
  return { bullish, bearish, selected: direction === 'LONG' ? bullish : direction === 'SHORT' ? bearish : 0 };
}

function scoreSignal(snapshot, previousMarket, topTraderIntelligence = null) {
const c5 = snapshot.candles["5m"] || [];
const c15 = snapshot.candles["15m"] || [];
const c1h = snapshot.candles["1h"] || [];
const c4h = snapshot.candles["4h"] || [];
 
const trend = snapshot.trend;
const momentum = momentumScore(c15);
const participation = participationScore(c15);
const structure = structureScore(c15);
const derivatives = derivativesScore(snapshot.market, previousMarket);

const topTraderLong = ttiScoreForSymbol(topTraderIntelligence?.cohort, snapshot.symbol || snapshot.market?.symbol || snapshot.market?.name || "", "LONG");
const topTraderShort = ttiScoreForSymbol(topTraderIntelligence?.cohort, snapshot.symbol || snapshot.market?.symbol || snapshot.market?.name || "", "SHORT");
 
const riskParts = {
fakeMove: fakeMoveRisk(c15),
exhaustion: exhaustionRisk(c15),
chop: chopRisk(trend)
};
const risk = totalRisk(
riskParts.fakeMove,
riskParts.exhaustion,
riskParts.chop
);
 
// Fast local confirmation: no additional network calls.
const advancedLong = v7AdvancedConfirmation(snapshot, "LONG");
const advancedShort = v7AdvancedConfirmation(snapshot, "SHORT");
const precisionLong = v91EntryPrecision(snapshot, "LONG");
const precisionShort = v91EntryPrecision(snapshot, "SHORT");
const radar = V8_UNIVERSE.PUMP_RADAR.enabled ? v8PumpRadar(snapshot.market, previousMarket) : null;
 
// Entry-quality protection: a strong trend can still be a poor late entry.
// If the market is >1.8 ATR extended and RSI is already hot, keep the
// directional bias but downgrade it to WATCH rather than treating it as
// an actionable VALID setup.
const selectedPrecision = precisionLong.score >= precisionShort.score ? precisionLong : precisionShort;
const entryQuality = {
extensionAtr: Number(selectedPrecision?.extensionAtr || 0),
rsi5: Number(selectedPrecision?.indicators?.rsi5 || 0),
rsi15: Number(rsi(c15, 14) || 0)
};
entryQuality.overextended = entryQuality.extensionAtr > 1.8 &&
(entryQuality.rsi5 >= 70 || entryQuality.rsi15 >= 70);
entryQuality.state = entryQuality.overextended ? "WAIT_PULLBACK" : entryQuality.extensionAtr > 1.2 ? "PULLBACK_PREFERRED" : "ENTRY_ZONE";
 
// V15.3 FAIR + AVAILABILITY-AWARE MULTI-FACTOR SCORE MODEL
// Fairness rule:
// - Market cap, major-symbol identity and liquidity NEVER add opportunity points.
// - Trend, momentum, participation, structure and derivatives are evidence factors.
// - Native component ranges are normalized to 0-100 before weighting.
// - A factor is included only when its underlying data is actually available.
// - Missing/unavailable data is NEUTRAL: it contributes neither positive nor
//   negative points, and the remaining weights are re-normalized.
// - A real zero score from an AVAILABLE factor remains a real zero; only
//   unavailable data is excluded.
// - No score bonus is granted for BTC/ETH/SOL/etc. being "major" assets.
//
// Original evidence weights are preserved:
// trend=34%, momentum=20%, participation=10%, structure=16%, derivatives=10%.
// V15.3 fixes the V15.1 issue where unavailable derivatives could behave like
// a zero-scoring factor and depress otherwise strong setups.
const weights = {
trend: 0.34,
momentum: 0.20,
participation: 0.10,
structure: 0.16,
derivatives: 0.10
};

const componentMax = {
trend: 100,
momentum: 60,
participation: 30,
structure: 35,
derivatives: 40
};

// Availability is based on the actual source data, not on a derived zero.
// Participation uses the already-fetched candle range expansion proxy.
// Derivatives are available when GMX supplies OI/funding data; an absent
// previous OI snapshot alone does NOT make current funding/OI unavailable.
const participationAvailable =
  c15.length >= 25 &&
  Number.isFinite(Number(participation.expansion)) &&
  Number(participation.expansion) > 0;

const derivativeFundingFields = [
  snapshot?.market?.fundingRate,
  snapshot?.market?.fundingRateLong,
  snapshot?.market?.fundingRateShort,
  snapshot?.market?.fundingFactorPerSecond,
  snapshot?.market?.fundingFactor,
  snapshot?.market?.funding?.rate,
  snapshot?.market?.funding?.long,
  snapshot?.market?.funding?.short
];

const derivativeFundingAvailable =
  derivativeFundingFields.some(v => Number.isFinite(Number(v)));

const derivativesAvailable =
  Number(derivatives.oi) > 0 ||
  derivatives.oiChange !== null ||
  derivativeFundingAvailable;

const componentAvailable = {
trend: Number.isFinite(Number(trend.longScore)) || Number.isFinite(Number(trend.shortScore)),
momentum: Number.isFinite(Number(momentum.long)) || Number.isFinite(Number(momentum.short)),
participation: participationAvailable,
structure: Number.isFinite(Number(structure.long)) || Number.isFinite(Number(structure.short)),
derivatives: derivativesAvailable
};

const activeWeightSum = Object.keys(weights)
  .filter(key => componentAvailable[key])
  .reduce((sum, key) => sum + weights[key], 0);

const normalizeComponent = (value, max) =>
  Math.max(0, Math.min(100, Number(value) / max * 100));

const normalized = {
long: {
trend: normalizeComponent(trend.longScore, componentMax.trend),
momentum: normalizeComponent(momentum.long, componentMax.momentum),
participation: normalizeComponent(participation.long, componentMax.participation),
structure: normalizeComponent(structure.long, componentMax.structure),
derivatives: normalizeComponent(derivatives.long, componentMax.derivatives)
},
short: {
trend: normalizeComponent(trend.shortScore, componentMax.trend),
momentum: normalizeComponent(momentum.short, componentMax.momentum),
participation: normalizeComponent(participation.short, componentMax.participation),
structure: normalizeComponent(structure.short, componentMax.structure),
derivatives: normalizeComponent(derivatives.short, componentMax.derivatives)
}
};

const contributions = {
long: {
trend: componentAvailable.trend ? normalized.long.trend * weights.trend / activeWeightSum : 0,
momentum: componentAvailable.momentum ? normalized.long.momentum * weights.momentum / activeWeightSum : 0,
participation: componentAvailable.participation ? normalized.long.participation * weights.participation / activeWeightSum : 0,
structure: componentAvailable.structure ? normalized.long.structure * weights.structure / activeWeightSum : 0,
derivatives: componentAvailable.derivatives ? normalized.long.derivatives * weights.derivatives / activeWeightSum : 0
},
short: {
trend: componentAvailable.trend ? normalized.short.trend * weights.trend / activeWeightSum : 0,
momentum: componentAvailable.momentum ? normalized.short.momentum * weights.momentum / activeWeightSum : 0,
participation: componentAvailable.participation ? normalized.short.participation * weights.participation / activeWeightSum : 0,
structure: componentAvailable.structure ? normalized.short.structure * weights.structure / activeWeightSum : 0,
derivatives: componentAvailable.derivatives ? normalized.short.derivatives * weights.derivatives / activeWeightSum : 0
}
};

const longRaw = Object.values(contributions.long).reduce((a,b) => a + b, 0);
const shortRaw = Object.values(contributions.short).reduce((a,b) => a + b, 0);

// V15.3 keeps the risk penalty and advanced confirmation layer unchanged.
// Only the treatment of genuinely unavailable evidence changed.
const longScore = Math.max(0, Math.min(100,
  longRaw - risk * 0.30 + advancedLong.boost + topTraderLong.boost
));
const shortScore = Math.max(0, Math.min(100,
  shortRaw - risk * 0.30 + advancedShort.boost + topTraderShort.boost
));
const edge = Math.abs(longScore - shortScore);

const reasons = { long: [], short: [], common: [] };
 
// Stage 1: directional signal.
// Two-of-four trend confluence is enough to produce a VALID/WATCH signal.
// Stage 2: live execution remains stricter and requires 3-of-4.
const longEligible =
longScore >= CONFIG.VALID_SIGNAL_SCORE &&
longScore >= shortScore + CONFIG.MIN_EDGE &&
trend.bullish >= 2 &&
risk < 45 &&
!entryQuality.overextended;

const shortEligible =
shortScore >= CONFIG.VALID_SIGNAL_SCORE &&
shortScore >= longScore + CONFIG.MIN_EDGE &&
trend.bearish >= 2 &&
risk < 45 &&
!entryQuality.overextended;

if (trend.bullish < 2) reasons.long.push(`trend_confluence=${trend.bullish}/4`);
if (trend.bearish < 2) reasons.short.push(`trend_confluence=${trend.bearish}/4`);
 
if (longScore < CONFIG.VALID_SIGNAL_SCORE) {
reasons.long.push(`score=${longScore.toFixed(2)}<${CONFIG.VALID_SIGNAL_SCORE}`);
}
if (shortScore < CONFIG.VALID_SIGNAL_SCORE) {
reasons.short.push(`score=${shortScore.toFixed(2)}<${CONFIG.VALID_SIGNAL_SCORE}`);
}
 
if (longScore < shortScore + CONFIG.MIN_EDGE) {
reasons.long.push(`edge=${(longScore-shortScore).toFixed(2)}<${CONFIG.MIN_EDGE}`);
}
if (shortScore < longScore + CONFIG.MIN_EDGE) {
reasons.short.push(`edge=${(shortScore-longScore).toFixed(2)}<${CONFIG.MIN_EDGE}`);
}
 
if (risk >= 45) {
reasons.common.push(`risk=${risk.toFixed(2)}>=45`);
}
if (!advancedLong.ready) {
reasons.long.push(`advanced_confirmation=${advancedLong.confirmations.length} confirmations, votes=${advancedLong.votes}`);
}
if (!advancedShort.ready) {
reasons.short.push(`advanced_confirmation=${advancedShort.confirmations.length} confirmations, votes=${advancedShort.votes}`);
}
if (V8_UNIVERSE.PRECISION.enabled && !precisionLong.ready) reasons.long.push(`precision_entry=${precisionLong.score}/${precisionLong.triggerScore}`);
if (V8_UNIVERSE.PRECISION.enabled && !precisionShort.ready) reasons.short.push(`precision_entry=${precisionShort.score}/${precisionShort.triggerScore}`);
if (entryQuality.overextended) {
const msg = `entry_quality:overextended extension_atr=${entryQuality.extensionAtr.toFixed(2)} rsi5=${entryQuality.rsi5.toFixed(1)} rsi15=${entryQuality.rsi15.toFixed(1)}`;
reasons.common.push(msg);
}
 
for (const [tf, n] of [
["5m", c5.length],
["15m", c15.length],
["1h", c1h.length],
["4h", c4h.length]
]) {
if (n < 55) reasons.common.push(`${tf}_data_below_55`);
}
 
let direction = "NO_TRADE";
const score = Math.max(longScore, shortScore);
 
if (longEligible && (!shortEligible || longScore >= shortScore)) {
direction = "LONG";
} else if (shortEligible) {
direction = "SHORT";
} else if (score >= CONFIG.WATCH_SCORE && longScore !== shortScore) {
// WATCH is a directional setup, not an execution approval.
direction = longScore > shortScore ? "LONG" : "SHORT";
} else if (radar?.score >= CONFIG.PUMP_RADAR_WATCH_SCORE && radar?.direction !== "NEUTRAL") {
// V13.8 EARLY MOMENTUM: surface abnormal movers before WATCH/VALID.
// This never relaxes the strict live execution gate.
direction = radar.direction;
}
 
const executionScore =
direction === "LONG" ? longScore :
direction === "SHORT" ? shortScore : 0;
 
const trendBridge = v15613TrendConfluence(trend, direction);
const executionTrendConfluence = trendBridge.selected;
 
// V16.0.1: Canonical execution-gate diagnostics.
// These checks mirror the exact execution gate so the trace reports the real
// blocking condition, including invalid numeric values such as NaN.
const executionGateDiagnostics = [];
const executionScoreThreshold = Number(CONFIG.EXECUTION_SCORE);
const executionEdgeThreshold = Number(CONFIG.EXECUTION_MIN_EDGE);
const executionRiskThreshold = Number(CONFIG.EXECUTION_MAX_RISK);

if (!["LONG", "SHORT"].includes(direction)) {
  executionGateDiagnostics.push(`DIRECTION_INVALID_${direction || "EMPTY"}`);
}
if (!Number.isFinite(executionScore) || executionScore < executionScoreThreshold) {
  executionGateDiagnostics.push(`EXECUTION_SCORE_${Number.isFinite(executionScore) ? executionScore.toFixed(2) : "INVALID"}_BELOW_${executionScoreThreshold}`);
}
if (!Number.isFinite(edge) || edge < executionEdgeThreshold) {
  executionGateDiagnostics.push(`EXECUTION_EDGE_${Number.isFinite(edge) ? edge.toFixed(2) : "INVALID"}_BELOW_${executionEdgeThreshold}`);
}
if (!Number.isFinite(executionTrendConfluence) || executionTrendConfluence < 3) {
  executionGateDiagnostics.push(`EXECUTION_TREND_CONFLUENCE_${Number.isFinite(executionTrendConfluence) ? executionTrendConfluence : "INVALID"}_OF_4`);
}
if (!Number.isFinite(risk) || !(risk < executionRiskThreshold)) {
  executionGateDiagnostics.push(`EXECUTION_RISK_${Number.isFinite(risk) ? risk.toFixed(2) : "INVALID"}_NOT_BELOW_${executionRiskThreshold}`);
}
if (Boolean(entryQuality.overextended)) {
  executionGateDiagnostics.push("OVEREXTENDED_ENTRY");
}

const executionEligible =
direction !== "NO_TRADE" &&
executionScore >= CONFIG.EXECUTION_SCORE &&
edge >= CONFIG.EXECUTION_MIN_EDGE &&
executionTrendConfluence >= 3 &&
risk < CONFIG.EXECUTION_MAX_RISK &&
!entryQuality.overextended;
 
if (direction === "LONG" && executionTrendConfluence < 3) {
reasons.long.push(`execution_trend_confluence=${executionTrendConfluence}/4`);
}
if (direction === "SHORT" && executionTrendConfluence < 3) {
reasons.short.push(`execution_trend_confluence=${executionTrendConfluence}/4`);
}
 
if (direction === "LONG" && !executionEligible) {
reasons.long.push(
`execution_gate:score/edge/trend/risk=${executionScore.toFixed(2)}/${edge.toFixed(2)}/${executionTrendConfluence}/4/${risk.toFixed(2)}`
);
}
if (direction === "SHORT" && !executionEligible) {
reasons.short.push(
`execution_gate:score/edge/trend/risk=${executionScore.toFixed(2)}/${edge.toFixed(2)}/${executionTrendConfluence}/4/${risk.toFixed(2)}`
);
}
 
const earlyMomentum=!!(radar&&radar.score>=CONFIG.PUMP_RADAR_WATCH_SCORE&&radar.direction!=="NEUTRAL"&&executionScore<CONFIG.VALID_SIGNAL_SCORE);
// V13.9.2: Tier reflects signal strength, not entry timing. An overextended
// signal can remain STRONG while executionEligible stays false.
const tier=direction==="NO_TRADE"?(score>=CONFIG.WATCH_SCORE?"WATCH":"NO_TRADE"):earlyMomentum?"WATCH":executionScore>=CONFIG.STRONG_SIGNAL_SCORE?"STRONG":"VALID";
const opportunity=radar&&radar.score>=CONFIG.PUMP_RADAR_WATCH_SCORE?{type:"EARLY_MOMENTUM",score:radar.score,direction:radar.direction,edge:radar.edge,reasons:radar.reasons,radar}:{type:"STANDARD",score,direction,edge,reasons:[]};

return {
direction,
tier,
executionEligible,
score: Number(score.toFixed(2)),
longScore: Number(longScore.toFixed(2)),
shortScore: Number(shortScore.toFixed(2)),
edge: Number(edge.toFixed(2)),
risk: Number(risk.toFixed(2)),
opportunity,
rejectionReasons: direction === "NO_TRADE" ? reasons : reasons,
components: {
trend,
momentum,
participation,
structure,
derivatives
},
diagnostics: {
weights,
componentMax,
normalizedComponents: normalized,
contributions,
raw: {
long: Number(longRaw.toFixed(2)),
short: Number(shortRaw.toFixed(2))
},
riskParts,
topTraderIntelligence: { long: topTraderLong, short: topTraderShort, mode: "POSITIVE_CONFLUENCE_ONLY_NO_BLOCK" },
advanced: {
long: advancedLong,
short: advancedShort,
precisionEntry: {long: precisionLong, short: precisionShort},
latencyModel: "LOCAL_ONLY_ZERO_EXTRA_SUBREQUESTS",
confirmationPolicy: "2+ confirmations; not all indicators required"
},
selectedDirection: direction,
entryQuality,
executionTrendConfluence,
executionGateDiagnostics,
directionalScores: {
  long: Number(longScore || 0),
  short: Number(shortScore || 0),
  selected: Number(executionScore || 0),
  selectedDirection: direction,
  threshold: Number(CONFIG.EXECUTION_SCORE || 0),
  longPassesExecutionScore: Number(longScore || 0) >= Number(CONFIG.EXECUTION_SCORE || 0),
  shortPassesExecutionScore: Number(shortScore || 0) >= Number(CONFIG.EXECUTION_SCORE || 0)
},
trendConfluence: trendBridge,
scoreModel: {
normalizedTo100: true,
weightedMaximum: 100,
activeComponents: ["trend", "momentum", "participation", "structure", "derivatives", "topTraderConfluence"],
excludedComponents: ["asset_identity", "market_cap", "major_symbol_bias", "liquidity_bonus"],
fairAssetScoring: true,
availabilityAwareScoring: true,
scoreEngineVersion: "V15.3-VELOCITY-RADAR-AVAILABILITY-AWARE-MULTIFACTOR",
note: "Score is asset-agnostic and availability-aware. Top Trader Intelligence is a capped positive-only confluence boost; unavailable or conflicting trader data is neutral and never creates a gate or execution block."
},
gates: {
validScore: CONFIG.VALID_SIGNAL_SCORE,
minEdge: CONFIG.MIN_EDGE,
executionScore: CONFIG.EXECUTION_SCORE,
executionMinEdge: CONFIG.EXECUTION_MIN_EDGE,
executionMaxRisk: CONFIG.EXECUTION_MAX_RISK,
validTrendConfluence: 2,
executionTrendConfluence: 3
}
},
dataQuality: {
candles5m: c5.length,
candles15m: c15.length,
candles1h: c1h.length,
candles4h: c4h.length,
oiAvailable: derivatives.oi > 0,
oiDataQuality: extractOpenInterestMeta(snapshot.market),
fundingAvailable: Number.isFinite(derivatives.funding),
oiChangeAvailable: derivatives.oiChange !== null,
advancedIndicatorsLocal: true,
precisionEntryEngine: true,
participantsAffectScore: true,
participationDataAvailable: participationAvailable,
derivativesAffectScore: true,
derivativesDataAvailable: derivativesAvailable,
vwapAvailable: Number.isFinite(advancedLong.indicators.vwap),
adxAvailable: Number.isFinite(advancedLong.indicators.adx),
macdAvailable: Number.isFinite(advancedLong.indicators.macd?.histogram),
ema20Available: Number.isFinite(advancedLong.indicators.ema20),
ema50Available: Number.isFinite(advancedLong.indicators.ema50),
ema200Available: Number.isFinite(advancedLong.indicators.ema200)
}
};
}
 
// ======================================================
// ENTRY / SL / TP / RISK
// ======================================================
 
function leverageFromScore(score) {
let lev = CONFIG.DEFAULT_LEVERAGE;
for (const tier of CONFIG.LEVERAGE_TIERS) {
if (Number(score) >= tier.minScore) lev = Math.max(lev, tier.leverage);
}
return Math.min(lev, CONFIG.MAX_LEVERAGE);
}
 
function allocationFromScore(score) {
let allocation = CONFIG.MIN_CAPITAL_ALLOCATION;
for (const tier of CONFIG.ALLOCATION_TIERS) {
if (Number(score) >= tier.minScore) {
allocation = Math.max(allocation, tier.allocation);
}
}
return Math.min(
allocation,
CONFIG.MAX_CAPITAL_ALLOCATION,
CONFIG.MAX_TOTAL_CAPITAL_ALLOCATION
);
}
 
function calculateRiskBasedNotional(balance, entry, stopLoss) {
if (!(balance > 0) || !(entry > 0) || !(stopLoss > 0)) return 0;
const riskCapital = balance * CONFIG.RISK_PER_TRADE;
const stopPercent = Math.abs(entry - stopLoss) / entry;
if (!(stopPercent > 0)) return 0;
return riskCapital / stopPercent;
}
 
 
// ======================================================
 
function buildTradePlan(snapshot, analysis) {
const candles = snapshot.candles["15m"];
const entry = snapshot.price;
const a = atr(candles, 14);
 
if (!entry || !a || a <= 0) {
return {
valid: false,
reason: "Insufficient price/ATR data"
};
}
 
const stopDistance = a * CONFIG.ATR_STOP_MULTIPLIER;
 
let stopLoss;
let tp1;
let tp2;
let tp3;
 
if (analysis.direction === "LONG") {
stopLoss = entry - stopDistance;
tp1 = entry + stopDistance * CONFIG.TP1_R;
tp2 = entry + stopDistance * CONFIG.TP2_R;
tp3 = entry + stopDistance * CONFIG.TP3_R;
} else if (analysis.direction === "SHORT") {
stopLoss = entry + stopDistance;
tp1 = entry - stopDistance * CONFIG.TP1_R;
tp2 = entry - stopDistance * CONFIG.TP2_R;
tp3 = entry - stopDistance * CONFIG.TP3_R;
} else {
return {
valid: false,
reason: "No trade direction"
};
}
 
const precisionExit = v91PrecisionExitPlan(snapshot, analysis, entry, stopLoss);
if (precisionExit) { tp1 = precisionExit.tp1; tp2 = precisionExit.tp2; tp3 = precisionExit.tp3; }
const riskPerUnit = Math.abs(entry - stopLoss);
const stopPercent = (riskPerUnit / entry) * 100;
 
const leverage = leverageFromScore(analysis.score);
const allocation = allocationFromScore(analysis.score);
 
return {
valid: true,
entry,
stopLoss,
tp1,
tp2,
tp3,
atr: a,
stopDistance: riskPerUnit,
stopPercent: Number(stopPercent.toFixed(3)),
leverage,
allocation,
allocationPercent: Number((allocation * 100).toFixed(2)),
riskPerTradePercent: Number((CONFIG.RISK_PER_TRADE * 100).toFixed(2)),
precisionExit: precisionExit || null
};
}
 
function calculatePositionSize(balance, entry, stopLoss) {
return calculateRiskBasedNotional(balance, entry, stopLoss);
}
 
// ======================================================
// SIGNAL OBJECT
// ======================================================
 
async function generateSignal(symbol, env, options = {}) {
const normalized = normalizeSymbol(symbol);
const snapshot = await buildMarketSnapshot(normalized, env, options);
 
// Full scans keep the previous market snapshot in the single state object
// instead of doing one KV read/write per symbol.
const previousMarket = options.previousMarket || null;

const topTraderIntelligence = options.topTraderIntelligence || await fetchTopTraderIntelligence(env);

const analysis = scoreSignal(snapshot, previousMarket, topTraderIntelligence);
const plan = buildTradePlan(snapshot, analysis);
 
// RPC health is not part of signal generation. It is checked once by
// health/debug routes when needed, avoiding one or two extra subrequests
// per symbol during a scan.
const signal = {
id: crypto.randomUUID(),
symbol: normalized,
market: pairSymbol(normalized),
direction: analysis.direction,
score: analysis.score,
longScore: analysis.longScore,
shortScore: analysis.shortScore,
confidence:
analysis.direction === "NO_TRADE"
? 0
: Math.round(analysis.score),
status: analysis.tier,
 
price: snapshot.price,
tradePlan: plan,
 
trend: {
alignment: snapshot.trend.alignment,
macro4h: snapshot.trend.macro.direction,
trend1h: snapshot.trend.trend.direction,
entry15m: snapshot.trend.entry.direction,
fast5m: snapshot.trend.fast.direction,
bullish: Number(snapshot.trend.bullish || 0),
bearish: Number(snapshot.trend.bearish || 0)
},
 
components: analysis.components,
diagnostics: analysis.rejectionReasons,
signalTier: analysis.tier,
executionEligible: analysis.executionEligible,
opportunity: {type: analysis.opportunity?.type || "STANDARD", score: Number(analysis.opportunity?.score || 0), direction: analysis.opportunity?.direction || analysis.direction, edge: Number(analysis.opportunity?.edge || 0), reasons: analysis.opportunity?.reasons || []},
riskScore: analysis.risk,
edge: analysis.edge,
dataQuality: analysis.dataQuality,
radarMicro: v1611CandleMicrostructure(snapshot.candles?.["5m"] || []),
signalDiagnostics: analysis.diagnostics,
entryQuality: analysis.entryQuality || null,
executionGateDiagnostics: Array.isArray(analysis.executionGateDiagnostics) ? analysis.executionGateDiagnostics : [],
topTraderIntelligence: analysis.diagnostics?.topTraderIntelligence || null,
directionalScores: analysis.directionalScores || {
  long: 0,
  short: 0,
  selected: 0,
  selectedDirection: analysis.direction || "NO_TRADE",
  threshold: Number(CONFIG.EXECUTION_SCORE || 0),
  longPassesExecutionScore: false,
  shortPassesExecutionScore: false
},
 
execution: {
enabled: executionEnabled(env),
mode: effectiveExecutionMode(env),
action:
analysis.direction === "NO_TRADE"
? "NONE"
: analysis.executionEligible && executionEnabled(env)
? "EXECUTE"
: "SIGNAL_ONLY"
},
 
chain: {
chainId: GMX.CHAIN_ID,
healthCheck: "SKIPPED_IN_SCAN"
},
 
generatedAt: Date.now(),
_marketSnapshotForState: {
// Only persist fields needed for next-scan derivatives comparison.
// Keeping the full GMX market object here would waste KV space.
market: {
price: v8HighMetric(snapshot.market,["price","markPrice","indexPrice","currentPrice","indexPriceUsd"]) || snapshot.price || 0,
volume24h: v8HighMetric(snapshot.market,["volume24h","volume","dailyVolume","volumeUsd24h"]),
openInterest: extractOpenInterest(snapshot.market),
fundingRate: extractFunding(snapshot.market),
high24h: v8HighMetric(snapshot.market,["high24h","highPrice24h","dailyHigh"]),
low24h: v8HighMetric(snapshot.market,["low24h","lowPrice24h","dailyLow"])
},
savedAt: Date.now()
}
};
 
if (!options.scanMode) {
const previous = await loadMarketSnapshot(env, normalized);
// Single-symbol route gets the persisted previous snapshot for OI delta.
// Recompute only when the caller did not explicitly provide it.
if (!options.previousMarket) {
const singleAnalysis = scoreSignal(snapshot, previous?.market || null);
signal.direction = singleAnalysis.direction;
signal.score = singleAnalysis.score;
signal.longScore = singleAnalysis.longScore;
signal.shortScore = singleAnalysis.shortScore;
signal.confidence =
singleAnalysis.direction === "NO_TRADE"
? 0
: Math.round(singleAnalysis.score);
signal.status = singleAnalysis.tier;
signal.signalTier = singleAnalysis.tier;
signal.executionEligible = singleAnalysis.executionEligible;
signal.opportunity = {type: singleAnalysis.opportunity?.type || "STANDARD", score:Number(singleAnalysis.opportunity?.score||0), direction:singleAnalysis.opportunity?.direction||singleAnalysis.direction, edge:Number(singleAnalysis.opportunity?.edge||0), reasons:singleAnalysis.opportunity?.reasons||[]};
signal.tradePlan = buildTradePlan(snapshot, singleAnalysis);
signal.components = singleAnalysis.components;
signal.diagnostics = singleAnalysis.rejectionReasons;
signal.riskScore = singleAnalysis.risk;
signal.edge = singleAnalysis.edge;
signal.dataQuality = singleAnalysis.dataQuality;
}
 
await saveMarketSnapshot(env, normalized, snapshot.market);
}
 
return signal;
}
 
// ======================================================
// FULL MARKET SCAN
// ======================================================
 
 
function signalPriorityScore(signal) {
const score = Number(signal?.score || 0);
const edge = Number(signal?.edge || 0);
const risk = Number(signal?.riskScore || 100);
const execution = signal?.executionEligible ? 10 : 0;
const radarBoost = Number(signal?.opportunity?.score || 0) >= CONFIG.PUMP_RADAR_HOT_SCORE ? 8 : Number(signal?.opportunity?.score || 0) >= CONFIG.PUMP_RADAR_WATCH_SCORE ? 4 : 0;
const data = signal?.dataQuality || {};
const dataCompleteness =
["candles5m","candles15m","candles1h","candles4h"]
.map(k => Number(data[k] || 0))
.reduce((a,b) => a + Math.min(b / 120, 1), 0) / 4 * 5;
 
return score * 0.70 + Math.min(edge, 30) * 0.20 + Math.max(0, 40 - risk) * 0.25 + execution + radarBoost + dataCompleteness;
}
 
function baseAsset(symbol) {
return normalizeSymbol(symbol).replace(/-PERP$/i, "");
}
 
function exposureConflict(signal, positions) {
const base = baseAsset(signal.symbol);
for (const p of positions || []) {
const pbase = baseAsset(p.symbol);
if (pbase === base) return { conflict: true, reason: "DUPLICATE_SYMBOL" };
// Conservative proxy: non-BTC/ETH alts are treated as correlated.
if (base !== "BTC" && base !== "ETH" && pbase !== "BTC" && pbase !== "ETH") {
return { conflict: true, reason: "ALT_CORRELATION_CAP" };
}
}
return { conflict: false, reason: null };
}
 
function v15610ExecutionGateReasons(signal) {
  const canonical = Array.isArray(signal?.executionGateDiagnostics) ? signal.executionGateDiagnostics.filter(Boolean).map(String) : [];
  if (canonical.length) return canonical;
  const reasons = [];
  const score = Number(signal?.score || 0);
  const edge = Number(signal?.edge || 0);
  const risk = Number(signal?.riskScore ?? 100);
  if (score < Number(CONFIG.EXECUTION_SCORE || 85)) reasons.push(`SCORE_BELOW_${CONFIG.EXECUTION_SCORE || 88}`);
  if (edge < Number(CONFIG.EXECUTION_MIN_EDGE || 10)) reasons.push(`EDGE_BELOW_${CONFIG.EXECUTION_MIN_EDGE || 10}`);
  if (risk > Number(CONFIG.EXECUTION_MAX_RISK || 40)) reasons.push(`RISK_ABOVE_${CONFIG.EXECUTION_MAX_RISK || 40}`);
  const direction = String(signal?.direction || "").toUpperCase();
  const trend = signal?.trend || {};
  const trendBridge = v15613TrendConfluence(trend, direction);
  const trendConfluence = trendBridge.selected;
  if (["LONG","SHORT"].includes(direction) && trendConfluence < 2) reasons.push(`TREND_CONFLUENCE_${trendConfluence}_OF_4`);
  if (signal?.entryQuality?.overextended) reasons.push("OVEREXTENDED_ENTRY");
  if (!signal?.tradePlan?.valid) reasons.push("TRADE_PLAN_INVALID");
  if (!['LONG','SHORT'].includes(String(signal?.direction || '').toUpperCase())) reasons.push("DIRECTION_INVALID");
  if (!signal?.executionEligible && reasons.length === 0) reasons.push("EXECUTION_ELIGIBILITY_ENGINE_BLOCK");
  return reasons;
}

function v15610RadarGateReasons(candidate) {
  const radar = candidate?.pumpRadar || {};
  const reasons = [];
  const score = Number(radar?.score || 0);
  const direction = String(radar?.direction || "NEUTRAL").toUpperCase();
  const priceStatus = String(radar?.priceDataStatus || "INVALID").toUpperCase();
  const timingState = String(radar?.timingState || "UNKNOWN").toUpperCase();
  const timingScore = Number(radar?.entryTimingScore ?? 0);
  if (!['LONG','SHORT'].includes(direction)) reasons.push("DIRECTION_NEUTRAL_OR_INVALID");
  if (priceStatus === "INVALID") reasons.push("PRICE_DATA_INVALID");
  if (score < Number(CONFIG.PUMP_RADAR_WATCH_SCORE || 60)) reasons.push(`SCORE_BELOW_RADAR_WATCH_${CONFIG.PUMP_RADAR_WATCH_SCORE || 60}`);
  if (timingState === "EXHAUSTED") reasons.push("ENTRY_TIMING_EXHAUSTED");
  if (Number(radar?.reversalScore||0) >= Number(CONFIG.RADAR_REVERSAL_STRONG_THRESHOLD||70)) reasons.push(`REVERSAL_SCORE_${Number(radar.reversalScore||0).toFixed(0)}`);
  if (["LONG","SHORT"].includes(String(radar?.reversalDirection||"").toUpperCase()) && String(radar.reversalDirection).toUpperCase() !== direction && Number(radar?.reversalScore||0) >= Number(CONFIG.RADAR_REVERSAL_SCORE_THRESHOLD||50)) reasons.push(`REVERSAL_FAVORS_${String(radar.reversalDirection).toUpperCase()}`);
  if (Boolean(radar?.directionalNearExtreme)) reasons.push(direction === "LONG" ? "LONG_NEAR_24H_HIGH" : "SHORT_NEAR_24H_LOW");
  if (Boolean(radar?.momentumDecelerating)) reasons.push("MOMENTUM_DECELERATING");
  if (Boolean(radar?.largeRecentMove)) reasons.push("LARGE_RECENT_MOVE");
  if (score < Number(CONFIG.RADAR_ENTRY_SCORE || 72)) {
    if (!CONFIG.RADAR_EARLY_ENTRY_ENABLED) reasons.push("EARLY_ENTRY_DISABLED");
    else {
      const velocity = Math.abs(Number(radar?.velocity5m || 0));
      const acceleration = Math.abs(Number(radar?.acceleration5m || 0));
      const edge = Number(radar?.edge || 0);
      if (score < Number(CONFIG.RADAR_EARLY_ENTRY_SCORE || 60)) reasons.push(`EARLY_SCORE_BELOW_${CONFIG.RADAR_EARLY_ENTRY_SCORE || 60}`);
      if (edge < Number(CONFIG.RADAR_EARLY_ENTRY_MIN_EDGE || 8)) reasons.push(`EARLY_EDGE_BELOW_${CONFIG.RADAR_EARLY_ENTRY_MIN_EDGE || 8}`);
      if (!radar?.valid5mSample) reasons.push("EARLY_5M_SAMPLE_INVALID");
      if (!(velocity >= Number(CONFIG.RADAR_EARLY_ENTRY_MIN_VELOCITY || 0.75) || acceleration >= 0.35)) reasons.push("EARLY_MOMENTUM_TOO_WEAK");
      if (radar?.timingState !== "EARLY_FAST") reasons.push("TIMING_NOT_EARLY_FAST");
    }
  }
  if (timingScore < Number(CONFIG.RADAR_TIMING_MIN_ENTRY_SCORE || 45)) reasons.push(`ENTRY_TIMING_SCORE_BELOW_${CONFIG.RADAR_TIMING_MIN_ENTRY_SCORE || 45}`);
  return reasons;
}
function selectPrioritySignals(signals, positions, options = {}) {
  const liveMode = options?.liveMode === true;
  const positionSet = liveMode ? [] : (Array.isArray(positions) ? positions : []);
  const ranked = [...(Array.isArray(signals) ? signals : [])]
    .filter(s => s?.executionEligible && s?.tradePlan?.valid)
    .sort((a,b) => (a?.signalTier==='EVENT_SEQUENCE' && b?.signalTier==='EVENT_SEQUENCE')
      ? hybridEventPriority(b)-hybridEventPriority(a)
      : a?.signalTier==='EVENT_SEQUENCE' ? -1
      : b?.signalTier==='EVENT_SEQUENCE' ? 1
      : signalPriorityScore(b)-signalPriorityScore(a));

  const selected = [];
  const rejected = [];
  let totalAllocation = 0;
  let totalRisk = 0;

  for (const signal of ranked) {
    if (selected.length >= CONFIG.MAX_POSITIONS) {
      rejected.push({symbol:signal.symbol, reason:"MAX_POSITIONS_SELECTION"});
      continue;
    }

    const conflict = exposureConflict(signal, [...positionSet, ...selected.map(s => ({symbol:s.symbol}))]);
    if (conflict.conflict) {
      rejected.push({symbol:signal.symbol, reason:conflict.reason});
      continue;
    }

    const allocation = Number(signal.tradePlan?.allocation ?? allocationFromScore(signal.score));
    const risk = Number(CONFIG.RISK_PER_TRADE);
    if (totalAllocation + allocation > CONFIG.MAX_TOTAL_CAPITAL_ALLOCATION + 1e-9) {
      rejected.push({symbol:signal.symbol, reason:"TOTAL_ALLOCATION_CAP"});
      continue;
    }
    if (totalRisk + risk > CONFIG.MAX_TOTAL_RISK + 1e-9) {
      rejected.push({symbol:signal.symbol, reason:"TOTAL_RISK_CAP"});
      continue;
    }

    selected.push(signal);
    totalAllocation += allocation;
    totalRisk += risk;
  }

  return {selected,totalAllocation,totalRisk,ranked,rejected};
}
 
 
function signalNotificationKey(signal) {
const symbol=baseAsset(signal?.symbol||"");
const direction=String(signal?.direction||"NO_TRADE").toUpperCase();
const tier=String(signal?.signalTier||signal?.status||"UNKNOWN").toUpperCase();
const radar=Number(signal?.opportunity?.score||0);
const execution=signal?.executionEligible?"EXECUTION_READY":"";
return [symbol,direction,tier,execution,radar>=CONFIG.PUMP_RADAR_HOT_SCORE?"RADAR_HOT":""].filter(Boolean).join("|");
}

function signalEventStage(signal) {
const score=Number(signal?.score||0); const radar=Number(signal?.opportunity?.score||0);
if(signal?.executionEligible)return 5;
if(radar>=CONFIG.PUMP_RADAR_HOT_SCORE)return 4;
if(score>=CONFIG.STRONG_SIGNAL_SCORE||signal?.signalTier==="STRONG")return 3;
if(score>=CONFIG.VALID_SIGNAL_SCORE||["VALID","VALID-PAPER"].includes(signal?.signalTier))return 2;
if(score>=CONFIG.WATCH_SCORE||signal?.signalTier==="WATCH")return 1;
return 0;
}

function canNotifyTelegram(state, signal) {
if(!notificationEligible(signal))return false;
if(!state.telegramEvents||typeof state.telegramEvents!=="object")state.telegramEvents={};
const now=Date.now();
for(const [symbol,record] of Object.entries(state.telegramEvents))if(!record||now-Number(record.updatedAt||0)>=CONFIG.TELEGRAM_EVENT_TTL_MS)delete state.telegramEvents[symbol];
const symbol=baseAsset(signal?.symbol||""); const direction=String(signal?.direction||"NO_TRADE").toUpperCase(); const stage=signalEventStage(signal);
if(!symbol||!direction||stage<=0)return false;
const previous=state.telegramEvents[symbol];
return !previous||previous.direction!==direction||stage>Number(previous.stage||0);
}

function canNotifyRadarTelegram(state, candidate) {
if (!candidate?.pumpRadar) return false;
const symbol = baseAsset(candidate?.symbol || "");
const direction = String(candidate?.pumpRadar?.direction || "NEUTRAL").toUpperCase();
const score = Number(candidate?.pumpRadar?.score || 0);
if (!symbol || !["LONG", "SHORT"].includes(direction) || score < Number(CONFIG.PUMP_RADAR_WATCH_SCORE || 60)) return false;
if (!state.radarTelegramEvents || typeof state.radarTelegramEvents !== "object") state.radarTelegramEvents = {};
const now = Date.now();
for (const [k, record] of Object.entries(state.radarTelegramEvents)) {
  if (!record || now - Number(record.updatedAt || 0) >= CONFIG.TELEGRAM_EVENT_TTL_MS) delete state.radarTelegramEvents[k];
}
const key = `${symbol}|${direction}`;
const previous = state.radarTelegramEvents[key];
const tier = score >= Number(CONFIG.PUMP_RADAR_HOT_SCORE || 78) ? "HOT" : "WATCH";
return !previous || previous.tier !== tier || score >= Number(previous.score || 0) + 8;
}

function markRadarTelegramNotified(state, candidate) {
if (!candidate?.pumpRadar) return;
const symbol = baseAsset(candidate?.symbol || "");
const direction = String(candidate?.pumpRadar?.direction || "NEUTRAL").toUpperCase();
if (!symbol || !["LONG", "SHORT"].includes(direction)) return;
const score = Number(candidate?.pumpRadar?.score || 0);
const key = `${symbol}|${direction}`;
state.radarTelegramEvents = state.radarTelegramEvents || {};
state.radarTelegramEvents[key] = { tier: score >= Number(CONFIG.PUMP_RADAR_HOT_SCORE || 78) ? "HOT" : "WATCH", score, updatedAt: Date.now() };
}

function notificationEligible(signal) {
if (!signal || signal.direction === "NO_TRADE") return false;
if (["VALID", "STRONG", "EVENT_SEQUENCE"].includes(signal.signalTier)) return true;
if (String(signal?.status || "").toUpperCase() === "EVENT_ENTRY_READY") return true;
return CONFIG.NOTIFY_WATCH && signal.signalTier === "WATCH";
}
 
function markTelegramNotified(state, signal) {
if(!notificationEligible(signal))return;
if(!state.telegramEvents||typeof state.telegramEvents!=="object")state.telegramEvents={};
const symbol=baseAsset(signal?.symbol||""); if(!symbol)return;
state.telegramEvents[symbol]={direction:String(signal?.direction||"NO_TRADE").toUpperCase(),stage:signalEventStage(signal),key:signalNotificationKey(signal),updatedAt:Date.now()};
}

function formatTelegramExit(action) {
const isError = String(action?.action || "").toUpperCase() === "ERROR";
const isRadar = String(action?.lane || "").toUpperCase() === "RADAR";
const icon = isError ? "🟢" : (Number(action?.pnlUsd || 0) >= 0 ? "🟢" : "🔴");
const hasPnl=Number.isFinite(Number(action?.pnlUsd)) && Number.isFinite(Number(action?.pnlPercent));
const pnlPct = Number(action?.pnlPercent || 0);
const pnlUsd = Number(action?.pnlUsd || 0);
const lines = [
`${icon} ${isRadar ? "RADAR" : "GMX FUTURES"} EXIT — ${action?.action || "EXIT"}`,
"━━━━━━━━━━━━━━━━━━",
`📌 ${action?.symbol || "UNKNOWN"} • ${action?.direction || "UNKNOWN"}`,
isRadar ? `🧭 Lane: RADAR / Paper simulation` : "",
`📥 Entry: ${action?.entryPrice != null ? safeFormatPrice(action.entryPrice) : "N/A"}`,
`📤 Exit: ${action?.exitPrice != null ? safeFormatPrice(action.exitPrice) : (action?.price != null ? safeFormatPrice(action.price) : "N/A")}`,
action?.leverage != null ? `⚙️ Leverage: ${Number(action.leverage).toFixed(0)}x` : "",
action?.notionalUsd != null ? `📦 Notional: $${Number(action.notionalUsd).toFixed(2)}` : "",
`📉 PnL: ${hasPnl ? `${pnlUsd >= 0 ? "+" : ""}$${pnlUsd.toFixed(2)} (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%)` : "NOT CALCULATED — PRICE DATA INVALID"}`,
`📊 Exit score: ${Number(action?.exitScore || action?.radarScore || 0).toFixed(1)}/100`,
`🧭 Reason: ${action?.reason || "PROTECTION"}`,
`💰 Close: ${Number(action?.closePercent || 0)}%`,
action?.remainingPct != null ? `📊 Remaining: ${Number(action.remainingPct).toFixed(2)}%` : ""
].filter(Boolean);
if (isError && action?.error) lines.push(`⚠️ Error: ${String(action.error).slice(0, 500)}`);
if (isRadar && action?.priceRatio && Number(action.priceRatio) > 25) lines.push(`⚠️ Price ratio: ${Number(action.priceRatio).toExponential(2)}x — paper result quarantined.`);
lines.push(isRadar
  ? "ℹ️ PnL above is the simulated result that would have occurred at this exit price."
  : "ℹ️ Telegram is notification-only; the bot does not wait for Telegram confirmation.");
return lines.join("\n");
}
 
function buildUniverseDiagnostics(allMarkets, fastRows, radarMarkets = []) {
const reasonCounts = {};
let withPrice = 0, withLiquidity = 0, withOi = 0, withFunding = 0, active = 0;
let withRadarPrice = 0;
for (const m of allMarkets || []) {
const price = v132NumberValue(m?.price, m?.markPrice, m?.indexPrice, m?.indexPriceUsd);
const liq = extractLiquidity(m);
const oi = extractOpenInterest(m);
if (price > 0) withPrice++;
if (liq > 0) withLiquidity++;
if (oi > 0) withOi++;
if (extractFundingMeta(m).available) withFunding++;
if (m?.isActive !== false && m?.isListed !== false) active++;
}
for (const m of radarMarkets || []) {
  const px = Number(m?.price ?? m?.markPrice ?? m?.indexPrice ?? m?.oraclePrice ?? m?.midPrice);
  if (px > 0) withRadarPrice++;
}
for (const m of allMarkets || []) {
const f = v8FastMarketFilter(m);
if (!f.eligible) for (const r of f.reasons || []) reasonCounts[r] = (reasonCounts[r] || 0) + 1;
}
return {
marketsDiscovered: allMarkets?.length || 0,
marketsWithPrice: withPrice,
marketsWithRadarPrice: withRadarPrice,
marketsWithLiquidity: withLiquidity,
marketsWithOpenInterest: withOi,
marketsWithFunding: withFunding,
activeOrListed: active,
fastEligible: fastRows?.length || 0,
fastRejected: Math.max(0, (allMarkets?.length || 0) - (fastRows?.length || 0)),
rejectionReasons: reasonCounts
};
}
 
async function enrichMarketsWithValues(markets) {
const rows = Array.isArray(markets) ? markets : [];
if (!rows.length || !rows.some(m => extractLiquidity(m) <= 0 || extractOpenInterest(m) <= 0)) return { markets: rows, source: "markets-info" };
try {
const values = marketArray(await fetchGmxMarketsValues());
const byToken = new Map(), byName = new Map();
for (const v of values) { const token = String(v?.marketTokenAddress || v?.marketToken || "").toLowerCase(); const name = v8NormSymbol(v?.symbol || v?.name || ""); if (token) byToken.set(token,v); if (name) byName.set(name,v); }
const merged = rows.map(m => { const token=String(m?.marketTokenAddress || m?.marketToken || "").toLowerCase(); const name=v8NormSymbol(m?.symbol || m?.name || m?.indexTokenSymbol || ""); const v=(token&&byToken.get(token))||byName.get(name); return v ? {...m,...v} : m; });
return {markets:merged,source:"markets-info+markets-values"};
} catch(error) { return {markets:rows,source:"markets-info",error:safeError(error)}; }
}
 

// ======================================================
// V15.6.5 RADAR PRICE INTEGRITY / SCALE NORMALIZATION
// Radar is allowed to observe aggressively, but it must never
// create or report a paper position from mixed price scales.
// Core signal scoring and the multi-source Data Center are unchanged.
// ======================================================
function normalizeRadarTokenSymbol(symbol){
  let s=String(symbol||"").trim().toUpperCase();
  s=s.split("[")[0].trim();
  s=s.split("/")[0].trim();
  s=s.replace(/[-_ ]PERP$/,"").replace(/[^A-Z0-9]/g,"");
  const aliases={WETH:"ETH",WBTC:"BTC",WBNB:"BNB",WSOL:"SOL"};
  return aliases[s]||s;
}

function extractRadarPriceMap(payload){
  const out={};
  const rows=Array.isArray(payload)?payload:
    Array.isArray(payload?.prices)?payload.prices:
    Array.isArray(payload?.tickers)?payload.tickers:
    Array.isArray(payload?.data)?payload.data:
    Array.isArray(payload?.data?.prices)?payload.data.prices:
    Array.isArray(payload?.data?.tickers)?payload.data.tickers:[];
  for(const row of rows){
    if(!row || typeof row!=="object") continue;
    const symbol=normalizeRadarTokenSymbol(row.tokenSymbol||row.symbol||row.baseSymbol||row.name);
    const p=radarTickerPrice(row);
    if(symbol && Number.isFinite(p) && p>0) out[symbol]=p;
  }
  return out;
}

async function fetchRadarLivePrices(){
  const urls=[
    `${GMX_V2_CONFIG.ORACLE}/prices/tickers`,
    `${GMX_V2_CONFIG.FALLBACKS[0]}/prices/tickers`,
    `${GMX_V2_CONFIG.FALLBACKS[1]}/prices/tickers`
  ];
  const errors=[];
  for(const url of urls){
    try{
      const r=await fetchTimeout(url,{headers:{accept:"application/json"}},Math.min(5000,Number(CONFIG.DATA_TIMEOUT_MS||10000)));
      if(!r.ok){ errors.push(`${url}:HTTP_${r.status}`); continue; }
      const j=await r.json();
      const prices=extractRadarPriceMap(j);
      if(Object.keys(prices).length) return {available:true,source:url,prices,error:null};
      errors.push(`${url}:EMPTY`);
    }catch(e){ errors.push(`${url}:${String(e?.message||e)}`); }
  }
  return {available:false,source:null,prices:{},error:errors.slice(-3).join(" | ")||null};
}

async function runFullScan(env, scanOptions = {}) {
  const scanId = String(scanOptions?.scanId || `scan-${Date.now()}-${Math.random().toString(36).slice(2,8)}`);
  const state=await loadState(env);
  if(!state.running)return{ok:true,status:"PAUSED",signals:[]};
  resetDailyLossIfNeeded(state);
  const started=Date.now(),errors=[],signals=[],executionResults=[];
  let marketResult;
  try{marketResult=await cached("markets-info",fetchGmxMarketsInfo,CONFIG.MARKET_CACHE_TTL_MS);}catch(e){return{ok:false,status:"DATA_ENGINE_ERROR",scanned:0,requested:0,candidates:0,errors:[{scope:"markets-info",error:safeError(e)}],timestamp:Date.now()};}
  let catalogRows=[];try{const r=await cached("markets-catalog",fetchGmxMarkets,CONFIG.MARKET_CACHE_TTL_MS);catalogRows=marketArray(r.value);}catch(e){errors.push({scope:"markets-catalog",error:safeError(e)});}
  const infoRows=marketArray(marketResult.value),unique=new Map();
  for(const m of [...infoRows,...catalogRows]){const sym=hybridResolveIndexSymbol(m);if(!sym)continue;const key=String(m?.marketTokenAddress||m?.marketToken||m?.marketAddress||m?.address||sym);unique.set(key,{...(unique.get(key)||{}),...m,symbol:sym,indexTokenSymbol:sym});}
  const markets=[...unique.values()].filter(m=>m?.isListed!==false&&m?.isActive!==false);
  try{smfSetMarketMap(markets);}catch(_){}
  const flowData=await fetchSmartMoneyFlowData(env,state.smartMoneyFlowHistory||{});
  state.smartMoneyFlowHistory=smfPersistHistory(state.smartMoneyFlowHistory||{},flowData);
  let traders={available:false,cohort:[]};try{traders=await fetchTopTraderIntelligence(env);}catch(_){}
  // V17.1.8 ALL-ALTCOIN COVERAGE:
  // First observe the entire active/listed GMX universe with a cheap 5m pass.
  // This prevents PEPE/PUMP/VVV/CHZ/CAKE and other altcoins from disappearing
  // merely because they were outside the old 10-market deep-scan window.
  const broad5m=new Map();
  if(CONFIG.HYBRID_BROAD_5M_SCAN_ENABLED!==false){
    const batchSize=Math.max(1,Number(CONFIG.HYBRID_BROAD_5M_BATCH_SIZE||20));
    const broadLimit=Math.max(30,Number(CONFIG.HYBRID_BROAD_5M_LIMIT||60));
    for(let start=0;start<markets.length;start+=batchSize){
      const batch=markets.slice(start,start+batchSize);
      const fetched=await Promise.all(batch.map(async m=>{
        const s=normalizeSymbol(m.symbol);
        try{
          const c5=await fetchCandlesScan(s,"5m",broadLimit);
          const last=c5.at(-1)||{},prev=c5.at(-2)||{};
          const close=Number(last.close||0),prevClose=Number(prev.close||close);
          const body=Math.abs(Number(last.close||0)-Number(last.open||0));
          const range=Math.max(0,Number(last.high||0)-Number(last.low||0));
          const avgVol=c5.slice(-20).reduce((a,c)=>a+Number(c.volume||0),0)/Math.max(1,Math.min(20,c5.length));
          const vol=Number(last.volume||0);
          const prev2Close=Number(c5.at(-3)?.close||prevClose); const currentMovePct=close>0&&Number(last.open||0)>0?(close-Number(last.open))/Number(last.open)*100:0; const prevBarMovePct=prevClose>0&&prev2Close>0?(prevClose-prev2Close)/prev2Close*100:0; const accelerationPct=currentMovePct-prevBarMovePct; broad5m.set(s,{candles:c5,price:close,move5m:prevClose>0?(close-prevClose)/prevClose:0,range,body,volumeRatio:avgVol>0?vol/avgVol:0,currentMovePct,accelerationPct});
          return true;
        }catch(e){ errors.push({symbol:s,scope:"broad-5m",error:safeError(e)}); return false; }
      }));
      console.log("[HYBRID][BROAD_5M]",{batchStart:start,batchSize:batch.length,ok:fetched.filter(Boolean).length,total:markets.length});
    }
  }
  const ranked=markets.map(m=>{
    const s=normalizeSymbol(m.symbol),f=flowData.bySymbol?.[s]||null,b=broad5m.get(s)||{};
    const abs=Math.abs(Number(f?.imbalance||0));
    const quick=Math.min(4,Math.abs(Number(b.move5m||0))*100)+(Number(b.volumeRatio||0)>=2?2:Number(b.volumeRatio||0)>=1.4?1:0);
    const currentMove=Math.abs(Number(b.currentMovePct||0));
    const accel=Math.abs(Number(b.accelerationPct||0));
    const earlyBoost=currentMove>=Number(CONFIG.HYBRID_ENTRY.earlyMinMovePct||0.12)&&accel>=Number(CONFIG.HYBRID_ENTRY.earlyMinAccelerationPct||0.04)?6:currentMove>=Number(CONFIG.HYBRID_ENTRY.earlyMinMovePct||0.12)?2:0;
    return{m,s,f,b,priority:(f?.explosiveFlow?5:f?.flowSurge?4:0)+(abs>=0.30?2:abs>=0.15?1:0)+(Number(f?.largeTradeCount||0)>0?1:0)+quick+earlyBoost,earlyBoost};
  }).sort((a,b)=>b.priority-a.priority);
  // Deep structure remains intentionally bounded, but it rotates across the COMPLETE universe.
  // The broad pass above is what gives every altcoin continuous observation coverage.
  const limit=Math.min(Number(CONFIG.HYBRID_DEEP_SCAN_LIMIT||CONFIG.DEEP_SCAN_LIMIT||18),Math.max(1,ranked.length));
  const cursor=Math.abs(Number(state.hybridScanCursor||0))%Math.max(1,ranked.length),rows=[];const hot=ranked.filter(x=>x.priority>=4).sort((a,b)=>(Number(b.earlyBoost||0)-Number(a.earlyBoost||0))||(b.priority-a.priority)).slice(0,Math.min(8,limit));
  // Retest states get first-class rotation priority so a valid breakout is not lost
  // simply because its symbol moved out of the top-flow slice on the next cycle.
  const pendingSymbols=new Set(Object.entries(state.hybridStructureStates||{}).filter(([,v])=>['REACTION_SUPPORT','REACTION_RESISTANCE'].includes(String(v?.stage||''))).map(([k])=>normalizeSymbol(k)));
  const rowSymbols=new Set();
  const pushDeepRow=(x)=>{
    const symbol=normalizeSymbol(x?.s);
    if(!symbol || rowSymbols.has(symbol) || rows.length>=limit) return false;
    rowSymbols.add(symbol);
    rows.push(x);
    return true;
  };
  for(const x of ranked)if(pendingSymbols.has(x.s))pushDeepRow(x);
  for(const x of hot)pushDeepRow(x);
  for(let i=0;i<ranked.length&&rows.length<limit;i++)pushDeepRow(ranked[(cursor+i)%ranked.length]);
  state.hybridScanCursor=(cursor+rows.length)%Math.max(1,ranked.length);
  console.log("[HYBRID][DEEP_PLAN]",{scanId,universe:markets.length,broad5mScanned:broad5m.size,deepPlanned:rows.length,uniqueDeepSymbols:rowSymbols.size,cursorBefore:cursor,cursorAfter:state.hybridScanCursor,hotSelected:hot.length,rotating:true});
  const eventStats={supportZones:0,resistanceZones:0,flowEvents:0,volumeEvents:0,supportReactions:0,resistanceReactions:0,breakouts:0,waitingRetests:0,retestConfirmed:0,earlyImpulses:0,entryReady:0,earlyDebug:{attempted:0,rejected:0,elapsedPass:0,movePass:0,bodyPass:0,volumePass:0,flowPass:0,activity:0,momentumActivityPass:0,accelerationPass:0,extensionPass:0,zonePass:0,proximityPass:0,prebreakPass:0,scorePass:0,edgePass:0,qualified:0,setupRejected:0,lastRejections:[]}};
  let eventCandidates=0;
  let deepAttempted=0,deepSucceeded=0,deepErrors=0;
  console.log("[HYBRID][DEEP_START]",{scanId,planned:rows.length,uniqueDeepSymbols:rowSymbols.size,universe:markets.length,broad5mScanned:broad5m.size});
  // V17.8.4: send an immediate cycle-start heartbeat before deep analysis.
  // This prevents Telegram from appearing dead when a deep fetch/analysis stalls.
  try {
    const startHeartbeat = await sendTelegram(env, [
      "🟡 GMX BOT — CYCLE START",
      "━━━━━━━━━━━━━━━━━━",
      `📡 Status: DEEP_SCAN_RUNNING`,
      `🪙 Universe: ${Number(markets.length||0)}`,
      `🔎 Broad 5M: ${Number(broad5m.size||0)}`,
      `🧠 Deep planned: ${Number(rows.length||0)}`,
      `🆔 Scan: ${telegramTextSafe(scanId, "n/a")}`,
      `🕐 ${new Date().toISOString()}`,
      "ℹ️ Deep scan شروع شد؛ گزارش نهایی پس از Selection/Execution ارسال می‌شود."
    ].join("\n"));
    console.log("[TELEGRAM][CYCLE_START]",{scanId,sent:Boolean(startHeartbeat?.ok),reason:startHeartbeat?.reason||null});
  } catch (tgError) {
    console.error("[TELEGRAM][CYCLE_START_ERROR]",{scanId,error:safeError(tgError)});
  }
  for(const row of rows){
    deepAttempted++;
    let deepStage="START";
    console.log("[HYBRID][DEEP_ROW]",{scanId,symbol:row.s,priority:row.priority,stage:deepStage});
    try{
      deepStage="5M";
      const c5=broad5m.get(row.s)?.candles || await fetchCandlesScan(row.s,"5m",CONFIG.CANDLE_LIMIT["5m"]);
      deepStage="MTF";
      const [c15,c1h,c4h]=await Promise.all([fetchCandlesScan(row.s,"15m",CONFIG.CANDLE_LIMIT["15m"]),fetchCandlesScan(row.s,"1h",CONFIG.CANDLE_LIMIT["1h"]),fetchCandlesScan(row.s,"4h",CONFIG.CANDLE_LIMIT["4h"])]);
      deepStage="ANALYZE";
      const closed5=hybridClosedCandles(c5,'5m'),price=Number(closed5.at(-1)?.close||c15.at(-1)?.close||0);if(!(price>0)){deepErrors++;console.warn("[HYBRID][DEEP_ERROR]",{symbol:row.s,stage:"PRICE",error:"INVALID_PRICE"});continue;}
      const flow=row.f||{imbalance:0,totalUsd:0};const prev=state.hybridStructureStates?.[row.s]||{};
      const analysis=hybridClassifyStructure(row.s,{"5m":c5,"15m":c15,"1h":c1h,"4h":c4h},price,flow,prev);analysis.price=price;analysis.candles={"5m":c5,"15m":c15,"1h":c1h,"4h":c4h};
      if(!state.hybridStructureStates)state.hybridStructureStates={};state.hybridStructureStates[row.s]=analysis.nextState||prev;
      const ef=analysis.eventFlags||{};eventStats.earlyImpulses+=ef.earlyImpulse?1:0;eventStats.supportZones+=ef.supportZone?1:0;eventStats.resistanceZones+=ef.resistanceZone?1:0;eventStats.flowEvents+=(flow.flowSurge||flow.explosiveFlow)?1:0;eventStats.volumeEvents+=(analysis.volume?.volumeSurge||analysis.volume?.rangeExpansion||analysis.volume?.volumeExplosive)?1:0;eventStats.supportReactions+=ef.supportReaction?1:0;eventStats.resistanceReactions+=ef.resistanceReaction?1:0;eventStats.breakouts+=ef.breakout?1:0;eventStats.waitingRetests+=ef.waitingRetest?1:0;eventStats.retestConfirmed+=ef.retestConfirmed?1:0;
      const ei=analysis.earlyImpulseInfo||null,eg=ei?.gates||null;
      if(eg){
        const d=eventStats.earlyDebug; d.attempted++;
        d.movePass+=eg.move?1:0; d.bodyPass+=eg.body?1:0; d.volumePass+=eg.volume?1:0;
        d.flowPass+=(eg.flowLong||eg.flowShort)?1:0; d.momentumActivityPass+=(eg.activityLong||eg.activityShort)?1:0;
        d.accelerationPass+=eg.acceleration?1:0; d.extensionPass+=eg.extension?1:0;
        d.prebreakPass+=eg.prebreak?1:0; d.scorePass+=eg.score?1:0; d.edgePass+=eg.edge?1:0; d.zonePass+=eg.expansion?1:0;
        if(ei.long||ei.short)d.qualified++; else { d.rejected++;
          if(!eg.move)d.MOVE++; else if(!eg.body)d.BODY++; else if(!eg.volume&&!eg.flowLong&&!eg.flowShort)d.ACTIVITY++;
          else if(!eg.acceleration&&!eg.prebreak)d.ACCELERATION++; else if(!eg.extension)d.EXTENSION++;
          else if(!eg.expansion)d.ZONE++; else d.setupRejected++;
        }
      }
      if(ef.supportReaction||ef.resistanceReaction||ef.breakout||ef.waitingRetest||ef.retestConfirmed)eventCandidates++;
      const earlySetup=hybridBuildEarlySetup(row.s,analysis,flow);
      const reactionSetup=hybridBuildSetup(row.s,analysis,flow,traders);
      const setup=earlySetup||reactionSetup;
      const setupMode=earlySetup?"EARLY_IMPULSE_5M":"LIQUIDITY_REACTION_5M";
      if(setup){
        eventStats.entryReady++;
        signals.push({
          id:crypto.randomUUID(), symbol:setup.symbol, market:pairSymbol(setup.symbol), direction:setup.direction,
          status:"EVENT_ENTRY_READY", score:0, confidence:100, price:setup.entryPrice,
          tradePlan:{valid:true,entry:setup.entryPrice,stopLoss:setup.stopLoss,tp1:setup.tp1,tp2:setup.tp2,tp3:setup.tp3,leverage:setup.leverage,allocation:setup.allocation,allocationPercent:Number((setup.allocation*100).toFixed(2))},
          trend:{}, components:{structureEvent:setup.trigger,volume:analysis.volume,flow:flow,reaction5m:analysis.indicators},
          diagnostics:setup.evidence, signalTier:setupMode, executionEligible:true, edge:0, riskScore:0,
          entryQuality:{overextended:false}, entryEngine:setupMode, eventStrength:0, topTraderIntelligence:null,
          hybridSetup:{...setup,mode:setupMode}, generatedAt:Date.now()
        });
      }
      deepSucceeded++;
      console.log("[HYBRID][STRUCTURE]",{symbol:row.s,state:analysis.state,direction:analysis.direction,move5:analysis.move5,flow:flow.imbalance,flowSurge:Boolean(flow.flowSurge||flow.explosiveFlow),volume:analysis.volume?.volumeRatio,range:analysis.volume?.rangeRatio,support:analysis.zones?.support?.[0]?.center||null,resistance:analysis.zones?.resistance?.[0]?.center||null,events:analysis.eventFlags||{}});
    }catch(e){deepErrors++;const detail=safeError(e);errors.push({symbol:row.s,scope:"deep-structure",stage:deepStage,error:detail});console.error("[HYBRID][DEEP_ERROR]",{symbol:row.s,stage:deepStage,error:detail});}
  }
  console.log("[HYBRID][DEEP_DONE]",{scanId,attempted:deepAttempted,succeeded:deepSucceeded,errors:deepErrors,planned:rows.length,uniqueDeepSymbols:rowSymbols.size,eventCandidates});
  // Entry selection remains event-based, but execution MUST still pass portfolio/risk limits.
  // Top Trader is positive confirmation only; it never creates an entry.
  const openPositions = await loadPositions(env);
  const liveMode = executionEnabled(env);
  const selectionBasePositions = liveMode ? [] : openPositions;
  const selection = selectPrioritySignals(signals, selectionBasePositions, {liveMode});
  const selectedEvents = selection.selected;
  selectedEvents.sort((a,b)=>hybridEventPriority(b)-hybridEventPriority(a));
  for(const signal of selectedEvents){
    const key=signal.id;
    try{
      const result=await executeLiveSignal(signal,env);
      executionResults.push({...result,symbol:result?.symbol||signal.symbol});
      if(result?.executed){state.executions=Number(state.executions||0)+1;break;}
      if(result?.error || result?.reason){
        const reason=String(result.error||result.reason);
        errors.push({symbol:signal.symbol,error:reason});
        try {
          const tg=await sendTelegram(env,formatTelegramExecutionFailure(signal,reason,result));
          console.log("[TELEGRAM][EXECUTION_BLOCKED]",{scanId,symbol:signal.symbol,sent:Boolean(tg?.ok),reason:tg?.reason||null});
        } catch(tgError) {
          console.error("[TELEGRAM][EXECUTION_BLOCKED_SEND_ERROR]",{scanId,symbol:signal.symbol,error:safeError(tgError)});
        }
      }
    }catch(e){
      const detail=safeError(e);
      const failure={executed:false,mode:"LIVE",symbol:signal.symbol,direction:signal.direction,error:detail,stage:e?.executionStage||null};
      executionResults.push(failure);
      errors.push({symbol:signal.symbol,error:detail});
      try {
        const tg=await sendTelegram(env,formatTelegramExecutionFailure(signal,detail,failure));
        console.log("[TELEGRAM][EXECUTION_FAILURE]",{scanId,symbol:signal.symbol,sent:Boolean(tg?.ok),reason:tg?.reason||null});
      } catch(tgError) {
        console.error("[TELEGRAM][EXECUTION_FAILURE_SEND_ERROR]",{scanId,symbol:signal.symbol,error:safeError(tgError)});
      }
    }
  }
  try {
    const heartbeat = await sendTelegram(env, formatTelegramScanHeartbeat({
      ...{status:signals.length?"ENTRY_READY":"WATCHING",scanned:markets.length,broad5mScanned:broad5m.size,deepScanned:deepSucceeded,deepPlanned:rows.length,eventCandidates,candidates:signals.length,eventStats,executionResults,allowancePreflight:scanOptions?.allowancePreflight||null}
    }, scanId));
    console.log("[TELEGRAM][CYCLE_REPORT]", {scanId, sent:Boolean(heartbeat?.ok), reason:heartbeat?.reason||null});
  } catch (tgError) {
    console.error("[TELEGRAM][CYCLE_REPORT_ERROR]", {scanId,error:safeError(tgError)});
  }
  console.log("[HYBRID][SELECTION]",{scanId,liveMode,candidates:signals.length,eligible:selection.ranked.length,selected:selectedEvents.length,rejected:selection.rejected});
  state.lastScan={at:Date.now(),durationMs:Date.now()-started,candidates:signals.length,selected:selectedEvents.length,executionRejected:Math.max(0,signals.length-selectedEvents.length),executed:executionResults.filter(x=>x?.executed).length,selectionRejected:selection.rejected};
  state.lastDiagnostics={version:CONFIG.VERSION,engine:"STRUCTURE_EVENT_SEQUENCE_NO_ENTRY_SCORE",markets:markets.length,broad5mScanned:broad5m.size,deepScanned:rows.length,eventCandidates,entries:signals.length,executed:executionResults.filter(x=>x?.executed).length,flowAvailable:Boolean(flowData?.available),topTraderAvailable:Boolean(traders?.available),eventStats,errors,selection:{liveMode,eligible:selection.ranked.length,selected:selectedEvents.length,rejected:selection.rejected}};
  try{await saveState(env,state);}catch(e){errors.push({scope:"state",error:safeError(e)});
  }
  return{ok:true,status:signals.length?"ENTRY_READY":"WATCHING",scanned:markets.length,requested:markets.length,broad5mScanned:broad5m.size,deepPlanned:rows.length,deepAttempted,deepSucceeded,deepErrors,deepScanned:deepSucceeded,eventCandidates,candidates:signals.length,signals,executionResults,errors,eventStats,selection:{liveMode,eligible:selection.ranked.length,selected:selectedEvents.length,rejected:selection.rejected},diagnostics:state.lastDiagnostics,timestamp:Date.now()};
}

async function riskGuard(env, state) {
resetDailyLossIfNeeded(state);
 
if (Number(state.dailyLoss || 0) <= -CONFIG.MAX_DAILY_LOSS) {
return {
allowed: false,
reason: "Daily loss limit reached"
};
}
 
const positions = await loadPositions(env);
 
if (positions.length >= CONFIG.MAX_POSITIONS) {
return {
allowed: false,
reason: "Maximum positions reached"
};
}
 
return { allowed: true };
}
 
function resetDailyLossIfNeeded(state) {
const key = new Date().toISOString().slice(0, 10);
 
if (state.dayKey !== key) {
state.dayKey = key;
state.dailyLoss = 0;
}
}
 
// ======================================================
// V15.6.8 RESOURCE USAGE TRACKER / GUARD
// Counts actual outbound HTTP calls made during one scheduled
// invocation, then persists rolling daily/monthly totals in BOT_STATE.
// ======================================================
// ======================================================
// STATE / KV
// ======================================================
 
async function loadState(env) {
if (!env.BOT_STATE) {
return { ...DEFAULT_STATE };
}
 
const data = await env.BOT_STATE.get("engine_state", "json");
return {
...DEFAULT_STATE,
...(data || {}),
signals: Array.isArray(data?.signals) ? data.signals : [],
lastDiagnostics: Array.isArray(data?.lastDiagnostics) ? data.lastDiagnostics : [],
telegramEvents: data?.telegramEvents && typeof data.telegramEvents === "object" ? data.telegramEvents : {},
radarTelegramEvents: data?.radarTelegramEvents && typeof data.radarTelegramEvents === "object" ? data.radarTelegramEvents : {},
radarHistory: data?.radarHistory && typeof data.radarHistory === "object" ? data.radarHistory : {},
smartMoneyFlowHistory: data?.smartMoneyFlowHistory && typeof data.smartMoneyFlowHistory === "object" ? data.smartMoneyFlowHistory : {},
    hybridStructureStates: data?.hybridStructureStates && typeof data.hybridStructureStates === "object" ? data.hybridStructureStates : {},
    hybridScanCursor: Number.isFinite(Number(data?.hybridScanCursor)) ? Number(data.hybridScanCursor) : 0,
universeRotationCursor: Number.isFinite(Number(data?.universeRotationCursor)) ? Number(data.universeRotationCursor) : 0,
lastExitDiagnostics: Array.isArray(data?.lastExitDiagnostics) ? data.lastExitDiagnostics : [],
resourceUsage: data?.resourceUsage && typeof data.resourceUsage === "object" ? data.resourceUsage : null
};
}
 
async function saveState(env, state) {
if (!env.BOT_STATE) return false;
 
await env.BOT_STATE.put(
"engine_state",
JSON.stringify(state)
);
 
return true;
}
 
async function loadPositions(env) {
if (!env.BOT_STATE) return [];
 
const positions = await env.BOT_STATE.get(
"positions",
"json"
);
 
return Array.isArray(positions) ? positions : [];
}
 
async function savePositions(env, positions) {
if (!env.BOT_STATE) return false;
 
await env.BOT_STATE.put(
"positions",
JSON.stringify(positions)
);
 
return true;
}
 
async function loadMarketSnapshot(env, symbol) {
if (!env.BOT_STATE) return null;
 
return await env.BOT_STATE.get(
`market:${normalizeSymbol(symbol)}`,
"json"
);
}
 
async function saveMarketSnapshot(env, symbol, market) {
if (!env.BOT_STATE) return false;
 
await env.BOT_STATE.put(
`market:${normalizeSymbol(symbol)}`,
JSON.stringify({
market,
savedAt: Date.now()
}),
{ expirationTtl: 86400 }
);
 
return true;
}
 
// ======================================================
// MARKET DISCOVERY
// ======================================================
 
async function discoverMarkets(env) {
const [catalog,info]=await Promise.all([fetchGmxMarkets(),fetchGmxMarketsInfo()]);
const bySymbol=new Map();
for(const raw of [...marketArray(catalog),...marketArray(info)]){const symbol=normalizeSymbol(raw?.symbol??raw?.name??raw?.ticker??raw?.indexTokenSymbol);if(!symbol)continue;bySymbol.set(symbol,{...(bySymbol.get(symbol)||{}),...raw,symbol});}
const all=[...bySymbol.values()].filter(m=>m.isListed!==false);const ranked=v8RankFastMarkets(all);
return {ok:true,network:"Arbitrum One",chainId:GMX.CHAIN_ID,markets:all.map(m=>({symbol:m.symbol,listed:m.isListed!==false,marketToken:m.marketToken||m.marketTokenAddress||null,liquidity:extractLiquidity(m),openInterest:extractOpenInterest(m),fundingRate:extractFunding(m)})),ranked:ranked.map(x=>({symbol:x.symbol,liquidityScore:x.liquidityScore,major:x.major})),source:{catalog:`${GMX.ORACLE}/markets`,info:`${GMX.ORACLE}/markets/info`},timestamp:Date.now()};
}
 
// ======================================================
// HEALTH / DEBUG
// ======================================================
 
async function healthRoute(env) {
try {
const rpcStatus = await verifyArbitrumRPC(env);
const marketInfo = await fetchGmxMarketsInfo();
 
return json({
ok: true,
status: "HEALTHY",
version: CONFIG.VERSION,
exitEngine: EXIT_ENGINE,
dynamicRiskEngine: DYNAMIC_RISK_ENGINE,
profitLockEngine: PROFIT_LOCK_ENGINE,
rpc: rpcStatus,
gmx: "reachable",
telegramConfigured: Boolean(
env.TELEGRAM_TOKEN && env.TELEGRAM_CHAT_ID
),
kvConfigured: Boolean(env.BOT_STATE),
execution: executionEnabled(env),
marketCount: marketArray(marketInfo).length,
timestamp: Date.now()
});
} catch (error) {
return json({
ok: false,
status: "DEGRADED",
error: safeError(error),
timestamp: Date.now()
}, 503);
}
}
 
async function debugState(env) {
const state = await loadState(env);
 
return {
ok: true,
config: {
...CONFIG,
// Never expose secrets.
EXECUTION_ENABLED: executionEnabled(env)
},
env: {
kv: Boolean(env.BOT_STATE),
rpc: Boolean(env.ARBITRUM_RPC),
telegram: Boolean(
env.TELEGRAM_TOKEN && env.TELEGRAM_CHAT_ID
)
},
state
};
}
 
// ======================================================
// CONTROL
// ======================================================
 
async function control(cmd, env) {
const state = await loadState(env);
 
switch (String(cmd || "").toLowerCase()) {
case "pause":
state.running = false;
await saveState(env, state);
return { ok: true, result: "BOT PAUSED" };
 
case "resume":
state.running = true;
await saveState(env, state);
return { ok: true, result: "BOT RESUMED" };
 
case "status":
return { ok: true, state };
 
default:
return {
ok: false,
result: "UNKNOWN COMMAND",
allowed: ["pause", "resume", "status"]
};
}
}
 
// ======================================================
// TELEGRAM
// ======================================================
 
function formatPrice(value) { return safeFormatPrice(value); }

console.log("[RUNTIME][WORKER_IDENTITY]", { version: BOT_VERSION, build: BOT_BUILD, module: "worker_core.mjs", formatter: "safeFormatPrice" });
 
function legacyTelegramTextUnused(value, fallback = "N/A") {
let s = value === null || value === undefined || value === "" ? fallback : String(value);
// V15.6.6: defensive repair for persisted/dynamic UTF-8 mojibake.
for(let i=0;i<2;i++){
  if(!/[ÃÂâðØÙ]/.test(s)) break;
  try{
    const repaired=decodeURIComponent(escape(s));
    if(repaired===s)break;
    s=repaired;
  }catch(_){break;}
}
return s.replace(/[\r\n]+/g, " ").trim();
}

function tgNumber(value, digits = 2, fallback = "N/A") {
const n = Number(value);
return Number.isFinite(n) ? n.toFixed(digits) : fallback;
}

function tgPrice(value, fallback = "N/A") {
const n = Number(value);
if (!Number.isFinite(n) || n <= 0) return fallback;
if (n >= 1000) return n.toFixed(2);
if (n >= 1) return n.toFixed(4);
if (n >= 0.01) return n.toFixed(6);
return n.toFixed(8);
}

function formatTelegramSignal(signal) {
const direction = String(signal?.direction || "").toUpperCase();
const icon = direction === "LONG" ? "🟢" : direction === "SHORT" ? "🔴" : "⚪";
const p = signal?.tradePlan || {};
const t = signal?.trend || {};
const tier = telegramTextSafe(signal?.signalTier || signal?.status, "SIGNAL");
const symbol = telegramTextSafe(signal?.symbol, "UNKNOWN");
const score = tgNumber(signal?.score, 1, "0.0");
const confidence = tgNumber(signal?.confidence, 0, "0");
const edge = tgNumber(signal?.edge, 1, "0.0");
const risk = tgNumber(signal?.riskScore ?? signal?.risk, 1, "0.0");
const opportunity = signal?.opportunity || {};
const radarScore = tgNumber(opportunity?.score, 1, "0.0");
const radarType = opportunity?.type === "EARLY_MOMENTUM" ? "🔥 EARLY MOMENTUM" : "";

const lines = [
`${icon} GMX FUTURES — ${tier}`,
"━━━━━━━━━━━━━━━━━━",
`📌 ${symbol}/USD  •  ${direction || "UNKNOWN"}`,
`📊 Score: ${score}/100`,
`🎯 Confidence: ${confidence}/100`,
`⚡ Edge: ${edge}`,
`🛡️ Risk: ${risk}/100`,
radarType ? `${radarType}  •  Radar: ${radarScore}/100` : "",
"",
"💰 TRADE PLAN",
`Entry : ${tgPrice(p?.entry ?? signal?.price)}`,
`SL    : ${tgPrice(p?.stopLoss)}`,
`TP1   : ${tgPrice(p?.tp1)}`,
`TP2   : ${tgPrice(p?.tp2)}`,
`TP3   : ${tgPrice(p?.tp3)}`,
"",
"📈 TREND",
`4H  : ${telegramTextSafe(t?.macro4h)}`,
`1H  : ${telegramTextSafe(t?.trend1h)}`,
`15M : ${telegramTextSafe(t?.entry15m)}`,
`5M  : ${telegramTextSafe(t?.fast5m)}`,
"",
`⚙️ Leverage: ${telegramTextSafe(p?.leverage ?? CONFIG.DEFAULT_LEVERAGE, CONFIG.DEFAULT_LEVERAGE) }x`,
`🛡️ Risk/Trade: ${telegramTextSafe(p?.riskPerTradePercent ?? (CONFIG.RISK_PER_TRADE * 100).toFixed(2), (CONFIG.RISK_PER_TRADE * 100).toFixed(2))}%`,
`🤖 ${signal?.executionEligible ? "EXECUTION-ELIGIBLE" : "SIGNAL-ONLY"}`,
"",
"ℹ️ این پیام فقط اطلاع‌رسانی است؛ برای ورود نیازی به تأیید تلگرام نیست.",
`#${symbol} #GMX #Arbitrum #Futures`
];

return lines.join("\n");
}

function formatTelegramStatus(result) {
return [
"⚠️ GMX FUTURES SCAN",
"━━━━━━━━━━━━━━━━━━",
`Status   : ${telegramTextSafe(result?.status, "UNKNOWN")}`,
`Scanned  : ${telegramTextSafe(result?.scanned, "0")}`,
`Signals  : ${telegramTextSafe(result?.candidates, "0")}`,
result?.reason ? `Reason   : ${telegramTextSafe(result.reason)}` : "",
"ℹ️ Telegram is notification-only and does not control the bot."
].filter(Boolean).join("\n");
}

// ======================================================
// OPTIONAL PAPER POSITION HELPERS
// ======================================================
 
// ======================================================
// V13.9.9 INDEPENDENT PUMP / DUMP RADAR LANE
// ======================================================
// This lane is deliberately independent from CONFIG.MAX_POSITIONS.
// It is an opportunity/reaction lane, not part of the Core 3-position book.
// Radar positions are still risk-capped and never bypass the global
// EXECUTION_ENABLED switch. In V13.9.9, Paper Radar is the testable path.
function radarLeverageFromScore(score) {
let lev = 1;
for (const tier of CONFIG.RADAR_LEVERAGE_TIERS || []) {
if (Number(score) >= Number(tier.minScore)) lev = Math.max(lev, Number(tier.leverage));
}
return Math.max(1, Math.min(CONFIG.MAX_LEVERAGE, lev));
}

function radarStopPercent(candidate) {
const m = candidate?.market || {};
const price = finitePositive(m?.price ?? m?.markPrice ?? m?.indexPrice ?? m?.currentPrice ?? m?.indexPriceUsd);
const high = finitePositive(m?.high24h ?? m?.highPrice24h ?? m?.dailyHigh);
const low = finitePositive(m?.low24h ?? m?.lowPrice24h ?? m?.dailyLow);
const rangePct = price > 0 && high > 0 && low > 0 ? ((high - low) / price) * 100 : 0;
const raw = rangePct > 0 ? rangePct * 0.12 : CONFIG.RADAR_STOP_MIN_PERCENT;
return Math.max(CONFIG.RADAR_STOP_MIN_PERCENT, Math.min(CONFIG.RADAR_STOP_MAX_PERCENT, raw));
}

function radarEntryEligible(candidate) {
const radar = candidate?.pumpRadar || {};
const score = Number(radar?.score || 0);
const direction = String(radar?.direction || "NEUTRAL").toUpperCase();
const priceStatus = String(radar?.priceDataStatus || "INVALID").toUpperCase();
const timingState = String(radar?.timingState || "UNKNOWN").toUpperCase();
const timingScore = Number(radar?.entryTimingScore ?? 0);
if (!['LONG','SHORT'].includes(direction) || priceStatus === "INVALID") return false;
// V16.1.2 HOT EXECUTION CONTRACT:
// HOT means the independent Radar has already earned its execution score.
// Do NOT re-apply Core execution gates, timing score, early-entry rules, or
// exhaustion as a second hidden gate. The only pre-wallet directional safety
// check retained here is a confirmed reversal explicitly favoring the
// opposite direction; otherwise the live executor must proceed to wallet,
// collateral, capacity and order submission immediately.
const reversalBlocksDirection = direction === "LONG"
  ? Boolean(radar?.longReversalConfirmed && String(radar?.reversalDirection||"").toUpperCase() === "SHORT")
  : direction === "SHORT"
    ? Boolean(radar?.shortReversalConfirmed && String(radar?.reversalDirection||"").toUpperCase() === "LONG")
    : false;
const hotThreshold = Number(CONFIG.PUMP_RADAR_HOT_SCORE || 72);
if (CONFIG.RADAR_HOT_EXECUTION_ENABLED && score >= hotThreshold) return !reversalBlocksDirection;
if (reversalBlocksDirection) return false;
if (timingState === "EXHAUSTED") return false;
if (timingScore < Number(CONFIG.RADAR_TIMING_MIN_ENTRY_SCORE || 45)) return false;
if (score >= Number(CONFIG.RADAR_ENTRY_SCORE || 72)) return true;
if (!CONFIG.RADAR_EARLY_ENTRY_ENABLED) return false;
const velocity = Math.abs(Number(radar?.velocity5m || 0));
const acceleration = Math.abs(Number(radar?.acceleration5m || 0));
const edge = Number(radar?.edge || 0);
return score >= Number(CONFIG.RADAR_EARLY_ENTRY_SCORE || 60) &&
  edge >= Number(CONFIG.RADAR_EARLY_ENTRY_MIN_EDGE || 8) &&
  Boolean(radar?.valid5mSample) &&
  (velocity >= Number(CONFIG.RADAR_EARLY_ENTRY_MIN_VELOCITY || 0.75) || acceleration >= 0.35) &&
  radar?.timingState === "EARLY_FAST";
}
function v154BuildRadarTradePlan(candidate) {
// V15.4.1: unique Radar live-plan symbol prevents runtime name collisions.
// V15.6.5: validate live-vs-native price scale before creating a paper/live plan.

const radar = candidate?.pumpRadar || {};
const market = candidate?.market || {};
const livePrice = v1565NormalizePrice(market?.__radarLivePrice);
const nativePrice = v1565RadarNativePrice(market);
const referencePrice = v1565NormalizePrice(market?.__radarReferencePrice);
let price = referencePrice || livePrice || nativePrice || v1565NormalizePrice(market?.price ?? market?.markPrice ?? market?.indexPrice ?? market?.currentPrice ?? market?.indexPriceUsd);
let priceSource = referencePrice>0 ? "CANDLE_REFERENCE" : (livePrice>0 ? "RADAR_ORACLE" : (nativePrice>0 ? "MARKET_NATIVE" : "MARKET_FIELD"));
if(referencePrice>0){
  if(livePrice>0 && !v1565RadarPriceIntegrity(livePrice,referencePrice,{maxRatio:25}).ok) priceSource="CANDLE_REFERENCE_LIVE_MISMATCH";
  if(nativePrice>0 && !v1565RadarPriceIntegrity(nativePrice,referencePrice,{maxRatio:25}).ok) priceSource="CANDLE_REFERENCE_NATIVE_MISMATCH";
} else if(livePrice>0 && nativePrice>0){
  const integrity=v1565RadarPriceIntegrity(livePrice,nativePrice,{maxRatio:25});
  if(!integrity.ok){
    price=nativePrice;
    priceSource="MARKET_NATIVE_FALLBACK";
  }
}
const direction = String(radar?.direction || "").toUpperCase();
const score = Number(radar?.score || 0);
if (!(price > 0) || !["LONG", "SHORT"].includes(direction) || !radarEntryEligible(candidate)) {
return { valid: false, reason: "radar_entry_gate_not_met" };
}
const stopPct = radarStopPercent({...candidate,market:{...market,price}});
const riskDistance = price * stopPct / 100;
const long = direction === "LONG";
const stopLoss = long ? price - riskDistance : price + riskDistance;
const tp1 = long ? price + riskDistance * CONFIG.RADAR_TP_R.tp1 : price - riskDistance * CONFIG.RADAR_TP_R.tp1;
const tp2 = long ? price + riskDistance * CONFIG.RADAR_TP_R.tp2 : price - riskDistance * CONFIG.RADAR_TP_R.tp2;
const tp3 = long ? price + riskDistance * CONFIG.RADAR_TP_R.tp3 : price - riskDistance * CONFIG.RADAR_TP_R.tp3;
const leverage = radarLeverageFromScore(score);
return {
valid: true,
entry: Number(price.toFixed(8)),
stopLoss: Number(stopLoss.toFixed(8)),
tp1: Number(tp1.toFixed(8)),
tp2: Number(tp2.toFixed(8)),
tp3: Number(tp3.toFixed(8)),
stopPercent: Number(stopPct.toFixed(4)),
leverage,
allocation: CONFIG.RADAR_CAPITAL_ALLOCATION,
riskPerTradePercent: Number((CONFIG.RADAR_RISK_PER_TRADE * 100).toFixed(2)),
score,
direction,
method: "RADAR-PRICE-RANGE-R-MULTIPLES",
priceSource,
priceIntegrity: {
  livePrice,
  nativePrice,
  referencePrice,
  liveVsReferenceRatio: livePrice>0 && referencePrice>0 ? Number(v1565PriceRatio(livePrice,referencePrice).toFixed(6)) : 1,
  nativeVsReferenceRatio: nativePrice>0 && referencePrice>0 ? Number(v1565PriceRatio(nativePrice,referencePrice).toFixed(6)) : 1,
  ratio: referencePrice>0 && livePrice>0 ? Number(v1565PriceRatio(livePrice,referencePrice).toFixed(6)) : (livePrice>0 && nativePrice>0 ? Number(v1565PriceRatio(livePrice,nativePrice).toFixed(6)) : 1),
  ok: referencePrice>0
    ? ((livePrice<=0 || v1565RadarPriceIntegrity(livePrice,referencePrice,{maxRatio:25}).ok) && (nativePrice<=0 || v1565RadarPriceIntegrity(nativePrice,referencePrice,{maxRatio:25}).ok))
    : (!(livePrice>0 && nativePrice>0) || v1565RadarPriceIntegrity(livePrice,nativePrice,{maxRatio:25}).ok)
}
};
}

function radarReversalDecision(position, radar, analysis) {
if (!position || String(position.lane || "").toUpperCase() !== "RADAR") return { close: false };
const side = String(position.side || "").toUpperCase();
const opposite = side === "LONG" ? "SHORT" : "LONG";
const radarDirection = String(radar?.direction || "NEUTRAL").toUpperCase();
const radarScore = Number(radar?.score || 0);
const radarEdge = Number(radar?.edge || 0);
const radarFlip = radarDirection === opposite && radarScore >= CONFIG.RADAR_EXIT_SCORE && radarEdge >= CONFIG.RADAR_REVERSAL_EDGE;
const longScore = Number(analysis?.longScore || 0);
const shortScore = Number(analysis?.shortScore || 0);
const trendFlip = side === "LONG"
? shortScore >= longScore + 8 && shortScore >= 65
: longScore >= shortScore + 8 && longScore >= 65;
return {
close: radarFlip || trendFlip,
reason: radarFlip ? "RADAR_DIRECTION_REVERSAL" : trendFlip ? "CORE_TREND_FLIP_CONFIRMATION" : null,
radarScore,
radarDirection,
radarEdge,
trendFlip
};
}

function formatTelegramRadarEntry(position) {
const direction = String(position?.side || "").toUpperCase();
const icon = direction === "LONG" ? "🟢" : "🔴";
const leverage = Number(position?.leverage || 1);
const allocationPct = Number(position?.allocation || CONFIG.RADAR_CAPITAL_ALLOCATION) * 100;
const notional = Number(position?.notionalUsd || 0);
const margin = leverage > 0 ? notional / leverage : 0;
const riskPct = Number(position?.riskPerTradePercent ?? (CONFIG.RADAR_RISK_PER_TRADE * 100));
return [
`${icon} RADAR ENTRY — ${direction}`,
"━━━━━━━━━━━━━━━━━━",
`📌 ${position?.symbol || "UNKNOWN"}/USD`,
`🔥 Score: ${Number(position?.radarScore || 0).toFixed(1)}/100`,
`⚡ Edge: ${Number(position?.radarEdge || 0).toFixed(1)}`,
"",
"📥 HYPOTHETICAL ENTRY",
`💰 Entry: ${safeFormatPrice(position?.entryPrice)}`,
`⚙️ Leverage: ${leverage}x`,
`💼 Allocation: ${allocationPct.toFixed(2)}%`,
`💵 Margin Used: $${margin.toFixed(2)}`,
`📦 Position Notional: $${notional.toFixed(2)}`,
`🛡️ Risk/Trade: ${riskPct.toFixed(2)}%`,
"",
"🎯 TRADE PLAN",
`🛑 Initial SL: ${safeFormatPrice(position?.initialStopPrice)}`,
`🎯 TP1: ${safeFormatPrice(position?.tp1)}`,
`🎯 TP2: ${safeFormatPrice(position?.tp2)}`,
`🎯 TP3: ${safeFormatPrice(position?.tp3)}`,
"",
"📊 RESULT TRACKING",
"🟢 PnL starts at $0.00 / 0.00%",
"🧭 Lane: RADAR / Paper simulation",
"ℹ️ This is a simulated entry; no real order is submitted."
].join("\n");
}

function formatTelegramRadarLiveEntry(result) {
const direction=String(result?.direction||"UNKNOWN").toUpperCase();
const icon=direction==="LONG"?"🟢":"🔴";
return [
`${icon} RADAR LIVE ENTRY — ${direction}`,
"━━━━━━━━━━━━━━━━━━",
`🪙 ${result?.symbol||"UNKNOWN"}`,
`🔥 Radar Score: ${Number(result?.radarScore||0).toFixed(1)}/100`,
`⚡ Edge: ${Number(result?.radarEdge||0).toFixed(1)}`,
`⚙️ Leverage: ${Number(result?.leverage||1).toFixed(1)}x`,
`💼 Collateral: ${Number(result?.collateralUsd||0).toFixed(2)} USD (${result?.collateralToken||"?"})`,
`📦 Notional: ${Number(result?.notionalUsd||0).toFixed(2)} USD`,
`🧾 Request ID: ${result?.requestId||"n/a"}`,
"✅ ORDER SUBMITTED BEFORE TELEGRAM",
"⚠️ Radar live lane — independent fast-entry path"
].join("\n");
}

function formatTelegramRadarWatch(candidate) {
const direction=String(candidate?.pumpRadar?.direction||"NEUTRAL").toUpperCase();
const radar=candidate?.pumpRadar||{};
const score=Number(radar.score||0);
const isPump=direction==="LONG";
const tier=score>=Number(CONFIG.PUMP_RADAR_HOT_SCORE||72)?"HOT":"WATCH";
const title=isPump?"🚀 PUMP RADAR":"🔻 DUMP RADAR";
const action=isPump?"BUY-SIDE MOMENTUM":"SELL-SIDE MOMENTUM";
const reasons=(Array.isArray(radar.reasons)?radar.reasons:[]).slice(0,6).join(" • ")||"momentum detected";
const flow=radar.smartMoneyFlow||{};
return [
`${title} — ${tier}`,
"━━━━━━━━━━━━━━━━━━",
`🪙 ${candidate?.symbol||"UNKNOWN"}/USD`,
`📡 Event: ${action}`,
`🔥 Radar Score: ${score.toFixed(1)}/100`,
`⚡ Directional Edge: ${Number(radar.edge||0).toFixed(1)}`,
`📈 24h Move: ${Number(radar.priceChange24h||0).toFixed(2)}%`,
`⏱️ 1h Move: ${Number(radar.priceChange1h||0).toFixed(2)}%`,
`🕐 4h Move: ${Number(radar.priceChange4h||0).toFixed(2)}%`,
`⚡ 5m Velocity: ${Number(radar.velocity5m||0).toFixed(2)}%`,
`🕯️ 5m Candles (15m/25m): ${Number(radar.candleMicro?.move3||0).toFixed(2)}% / ${Number(radar.candleMicro?.move5||0).toFixed(2)}%`,
`🧨 Reversal Risk: ${Math.max(Number(radar.longReversalRisk||0),Number(radar.shortReversalRisk||0)).toFixed(0)}/100`,
`📈 15m Move: ${Number(radar.move15m||0).toFixed(2)}%`,
`⏱️ Detection: ${radar.timingState || "UNKNOWN"}`,
`🛡️ Last-Scan Move: ${Number(radar.priorMovePct||0).toFixed(2)}%`,
`💧 Volume Ratio: ${Number(radar.volumeRatio||1).toFixed(2)}x`,
`📊 OI Change: ${Number(radar.oiChangePct||0).toFixed(2)}% • ${radar.oiAvailable===false?"UNAVAILABLE":"AVAILABLE"}`,
`💵 Smart Money Buy: $${Number(flow.buyUsd||0).toFixed(0)}`,
`💸 Smart Money Sell: $${Number(flow.sellUsd||0).toFixed(0)}`,
`⚖️ Flow Imbalance: ${(Number(flow.imbalance||0)*100).toFixed(1)}%`,
`🚀 Flow Surge: ${flow.flowSurge?"YES":"NO"} • x${Number(flow.flowSpikeRatio||1).toFixed(2)}`,
`🧠 Reversal: ${radar.reversalDirection||"NONE"} • ${Array.isArray(radar.reversalReasons)?radar.reversalReasons.slice(0,3).join(" • "):""}`,
`🐋 Large Trades: ${Number(flow.largeTradeCount||0)}`,
`🧠 Trigger: ${reasons}`,
"⚠️ RADAR ALERT — notification only; not a trade execution signal."
].join("\n");
}
async function openPaperPosition(env, signal, balance) {
if (!CONFIG.PAPER_ENABLED || !signal || !["LONG", "SHORT"].includes(signal.direction) || !signal.tradePlan?.valid) {
return { ok: false, reason: "Invalid signal or paper mode disabled" };
}
 
const positions = await loadPositions(env);
const base = baseAsset(normalizeSymbol(signal.symbol));
if (positions.some(p => p.status === "PAPER_OPEN" && baseAsset(normalizeSymbol(p.symbol)) === base)) {
return { ok: false, reason: "Paper position already open for symbol" };
}
const coreOpenCount = positions.filter(p => p.status === "PAPER_OPEN" && String(p.lane || "CORE").toUpperCase() !== "RADAR").length;
if (coreOpenCount >= CONFIG.MAX_POSITIONS) {
return { ok: false, reason: "Maximum Core paper positions reached" };
}
 
const accountBalance = Number(balance) > 0 ? Number(balance) : CONFIG.PAPER_STARTING_BALANCE_USD;
const sizeUsd = calculatePositionSize(accountBalance, signal.tradePlan.entry, signal.tradePlan.stopLoss);
const entry = Number(signal.tradePlan.entry);
const stop = Number(signal.tradePlan.stopLoss);
const riskPerUnit = Math.abs(entry - stop);
const position = {
id: crypto.randomUUID(),
symbol: signal.symbol,
side: signal.direction,
entryPrice: entry,
currentPrice: entry,
stopLoss: stop,
initialStopPrice: stop,
tp1: Number(signal.tradePlan.tp1 || 0),
tp2: Number(signal.tradePlan.tp2 || 0),
tp3: Number(signal.tradePlan.tp3 || 0),
leverage: signal.tradePlan.leverage,
notionalUsd: sizeUsd,
remainingPct: 100,
realizedPnlUsd: 0,
unrealizedPnlUsd: 0,
initialRiskPerUnit: riskPerUnit,
score: signal.score,
openedAt: Date.now(),
status: "PAPER_OPEN",
tp1Hit: false,
tp2Hit: false,
tp3Hit: false,
breakEvenActive: false,
trailingActive: false,
protectedStage: 0,
protectedStopPrice: stop,
stopBreachCount: 0,
exitHistory: [],
lastExitActionAt: 0
};
positions.push(position);
await savePositions(env, positions);
return { ok: true, mode: "PAPER", position };
}
 
async function openRadarPaperPosition(env, candidate, balance) {
if (!CONFIG.RADAR_INDEPENDENT_ENABLED || !CONFIG.RADAR_PAPER_ENABLED) return { ok: false, reason: "Radar Paper disabled" };
const plan = v154BuildRadarTradePlan(candidate);
if (!plan.valid) return { ok: false, reason: plan.reason };
const positions = await loadPositions(env);
const open = positions.filter(p => p.status === "PAPER_OPEN");
const radarOpen = open.filter(p => String(p.lane || "").toUpperCase() === "RADAR");
if (radarOpen.length >= CONFIG.RADAR_MAX_POSITIONS) return { ok: false, reason: "Maximum Radar positions reached" };
const symbol = normalizeSymbol(candidate?.symbol || candidate?.market?.symbol || "");
if (!symbol) return { ok: false, reason: "Radar symbol missing" };
if (open.some(p => baseAsset(normalizeSymbol(p.symbol)) === baseAsset(symbol))) return { ok: false, reason: "Radar symbol already open in portfolio" };
const accountBalance = Number(balance) > 0 ? Number(balance) : CONFIG.PAPER_STARTING_BALANCE_USD;
const stopFraction = Math.abs(plan.entry - plan.stopLoss) / plan.entry;
const riskCapital = accountBalance * CONFIG.RADAR_RISK_PER_TRADE;
const riskBasedNotional = stopFraction > 0 ? riskCapital / stopFraction : 0;
const allocationNotional = accountBalance * CONFIG.RADAR_CAPITAL_ALLOCATION * plan.leverage;
const notionalUsd = Math.min(
CONFIG.RADAR_MAX_POSITION_NOTIONAL_USD,
Math.min(riskBasedNotional, allocationNotional)
);
const position = {
id: crypto.randomUUID(),
lane: "RADAR",
symbol,
side: plan.direction,
entryPrice: plan.entry,
currentPrice: plan.entry,
stopLoss: plan.stopLoss,
initialStopPrice: plan.stopLoss,
tp1: plan.tp1,
tp2: plan.tp2,
tp3: plan.tp3,
leverage: plan.leverage,
allocation: plan.allocation,
notionalUsd,
score: plan.score,
radarScore: plan.score,
radarEdge: Number(candidate?.pumpRadar?.edge || 0),
radarPeakScore: plan.score,
radarLastScore: plan.score,
radarEntryReason: candidate?.pumpRadar?.reasons || [],
radarPriceSource: plan.priceSource || "UNKNOWN",
radarReferencePrice: Number(plan?.priceIntegrity?.referencePrice || 0),
radarPriceIntegrity: plan.priceIntegrity || null,
openedAt: Date.now(),
status: "PAPER_OPEN",
tp1Hit: false,
tp2Hit: false,
tp3Hit: false,
breakEvenActive: false,
trailingActive: false,
protectedStage: 0,
protectedStopPrice: plan.stopLoss,
stopBreachCount: 0,
exitHistory: [],
lastExitActionAt: 0
};
positions.push(position);
await savePositions(env, positions);
return { ok: true, mode: "PAPER", lane: "RADAR", position };
}

function paperPriceReached(side, price, target) {
if (!(price > 0) || !(target > 0)) return false;
return side === "LONG" ? price >= target : price <= target;
}
 
function paperStopReached(side, price, stop) {
if (!(price > 0) || !(stop > 0)) return false;
return side === "LONG" ? price <= stop : price >= stop;
}
 
function paperPnlUsd(position, price, percent = position.remainingPct || 100) {
const entry = v1565NormalizePrice(position?.entryPrice);
const exit = v1565NormalizePrice(price);
const notional = Number(position?.notionalUsd || 0);
if (!(entry > 0) || !(exit > 0) || !(notional > 0)) return 0;
const isRadar = String(position?.lane || "CORE").toUpperCase() === "RADAR";
if (isRadar) {
  const integrity=v1565RadarPriceIntegrity(entry,exit,{maxRatio:25});
  if (!integrity.ok) return 0;
}
const pct=Math.max(0,Math.min(100,Number(percent)||0));
const move = String(position?.side || "").toUpperCase() === "LONG" ? (exit - entry) / entry : (entry - exit) / entry;
const pnl = notional * (pct / 100) * move;
return Number.isFinite(pnl) ? pnl : 0;
}
 
async function updatePaperPositions(env) {
if (!CONFIG.PAPER_ENABLED) return [];
const positions = await loadPositions(env);
const open = positions.filter(p => p.status === "PAPER_OPEN");
if (!open.length) return [];
const actions = [];
const now = Date.now();
 
for (const position of open) {
try {
const symbol = normalizeSymbol(position.symbol);
const snapshot = await buildMarketSnapshot(symbol, env);
const currentPrice = v1565NormalizePrice(snapshot?.price || snapshot?.currentPrice);
if (!(currentPrice > 0)) continue;
position.currentPrice = currentPrice;

const previous = await loadMarketSnapshot(env, symbol);
const analysis = scoreSignal(snapshot, previous?.market || null);
const market = { ...snapshot, price: currentPrice, currentPrice, score: analysis.score, trend: snapshot.trend, structure: snapshot.structure, participation: snapshot.participation, momentum: snapshot.momentum, smartMoney: snapshot.smartMoney, smartMoneyOutflow: snapshot.smartMoneyOutflow, risk: analysis.risk, atr: snapshot.atr ?? snapshot.indicators?.atr };

// V13.9.9.1 HOTFIX: bind the unified exit plan before the CORE exit branch uses it.
const plan = buildPositionExitPlan(position, market, false);

const lockPlan = deriveProfitLockPlan(position, market);
const stageBefore = profitLockStage(position);
const tp1Reached = !position.tp1Hit && paperPriceReached(position.side, currentPrice, Number(lockPlan.tp1 || position.tp1 || 0));
const tp2Reached = !position.tp2Hit && paperPriceReached(position.side, currentPrice, Number(lockPlan.tp2 || position.tp2 || 0));
const tp3Reached = !position.tp3Hit && paperPriceReached(position.side, currentPrice, Number(lockPlan.tp3 || position.tp3 || 0));

let action = null, closePercent = 0, reason = null;
// If one scan jumps through multiple targets, advance one stage at a time.
if (tp1Reached) {
position.tp1Hit = true;
applyProfitLock(position, lockPlan, 1);
action = "TP1_PARTIAL"; closePercent = PROFIT_LOCK_ENGINE.partialClosePercent.tp1; reason = "TP1_HIT_PROFIT_LOCK";
} else if (tp2Reached) {
position.tp2Hit = true;
applyProfitLock(position, lockPlan, 2);
action = "TP2_PARTIAL"; closePercent = PROFIT_LOCK_ENGINE.partialClosePercent.tp2; reason = "TP2_HIT_PROFIT_LOCK";
} else if (tp3Reached) {
position.tp3Hit = true;
applyProfitLock(position, lockPlan, 3);
action = "TP3_PARTIAL"; closePercent = PROFIT_LOCK_ENGINE.partialClosePercent.tp3; reason = "TP3_HIT_PROFIT_LOCK";
}

const stopDecision = antiWickStopDecision(position, currentPrice, lockPlan);
if (!action && stopDecision.confirmed) {
action = stopDecision.catastrophic ? "CATASTROPHIC_STOP_FULL" : (stageBefore > 0 ? "PROFIT_LOCK_STOP" : "CONFIRMED_STOP_FULL");
closePercent = 100;
reason = stopDecision.catastrophic ? "CATASTROPHIC_STOP" : (stageBefore > 0 ? "PROTECTED_STOP_BREACH" : "CONFIRMED_INITIAL_STOP");
}
clearStopBreach(position, currentPrice);

if (!action && plan.execution === "FULL_CLOSE") { action = plan.action; closePercent = 100; reason = "EXIT_SCORE"; }
else if (!action && plan.execution === "PARTIAL_CLOSE" && now - Number(position.lastExitActionAt || 0) >= CONFIG.PAPER_EXIT_COOLDOWN_MS) {
 action = plan.action; closePercent = Math.min(Number(plan.closePercent || 0), Math.max(0, position.remainingPct)); reason = "EXIT_SCORE";
}

// Trailing is reserved for the final 25% runner after TP3.
const trailing = lockPlan?.ready && position.tp3Hit ? plan.trailingStop : null;
if (trailing?.active) {
position.trailingActive = true;
const trail = Number(trailing.price || 0);
const currentStop = Number(position.stopLoss || 0);
if (trail > 0 && (position.side === "LONG" ? trail > currentStop : trail < currentStop || !currentStop)) position.stopLoss = trail;
if (!action && paperStopReached(position.side, currentPrice, Number(position.stopLoss || 0))) {
 action = "RUNNER_TRAILING_STOP"; closePercent = 100; reason = "RUNNER_TRAILING_STOP";
}
}

if (position.breakEvenActive && !position.trailingActive) applyProfitLock(position, lockPlan, profitLockStage(position));

position.unrealizedPnlUsd = Number(paperPnlUsd(position, currentPrice).toFixed(4));
position.unrealizedPnlPercent = Number((paperPnlUsd(position, currentPrice) / Math.max(1, Number(position.notionalUsd || 1)) * 100).toFixed(2));
if (action && closePercent > 0) {
const actualPct = Math.min(closePercent, Number(position.remainingPct || 0));
const pnl = paperPnlUsd(position, currentPrice, actualPct);
position.realizedPnlUsd = Number((Number(position.realizedPnlUsd || 0) + pnl).toFixed(4));
position.remainingPct = Number((Number(position.remainingPct || 0) - actualPct).toFixed(4));
position.lastExitActionAt = now;
position.exitHistory = Array.isArray(position.exitHistory) ? position.exitHistory : [];
position.exitHistory.push({ at: now, action, reason, price: currentPrice, closePercent: actualPct, pnlUsd: Number(pnl.toFixed(4)), exitScore: plan.score });
if (position.remainingPct <= 0.001 || closePercent >= 100) { position.remainingPct = 0; position.status = "PAPER_CLOSED"; position.closedAt = now; }
actions.push({ id: position.id, symbol, direction: position.side, lane: position.lane, action, reason, closePercent: actualPct, pnlPercent: Number((paperPnlUsd(position, currentPrice, actualPct) / Math.max(1, Number(position.notionalUsd || 1)) * 100).toFixed(2)), pnlUsd: Number(pnl.toFixed(4)), entryPrice: position.entryPrice, exitPrice: currentPrice, leverage: position.leverage, notionalUsd: position.notionalUsd, exitScore: plan.score, remainingPct: position.remainingPct });
}
 
if (position.status === "PAPER_OPEN" && now - Number(position.openedAt || now) >= CONFIG.PAPER_MAX_HOLD_MS) {
const pct = Number(position.remainingPct || 0);
if (pct > 0) {
const pnl = paperPnlUsd(position, currentPrice, pct);
position.realizedPnlUsd = Number((Number(position.realizedPnlUsd || 0) + pnl).toFixed(4));
position.remainingPct = 0; position.status = "PAPER_CLOSED"; position.closedAt = now;
position.exitHistory.push({ at: now, action: "MAX_HOLD_FULL", reason: "MAX_HOLD", price: currentPrice, closePercent: pct, pnlUsd: Number(pnl.toFixed(4)), exitScore: plan.score });
actions.push({ id: position.id, symbol, direction: position.side, lane: position.lane, action: "MAX_HOLD_FULL", reason: "MAX_HOLD", closePercent: pct, pnlPercent: Number((pnl / Math.max(1, Number(position.notionalUsd || 1)) * 100).toFixed(2)), pnlUsd: Number(pnl.toFixed(4)), entryPrice: position.entryPrice, exitPrice: currentPrice, leverage: position.leverage, notionalUsd: position.notionalUsd, exitScore: plan.score, remainingPct: 0 });
}
}
} catch (error) {
const errorMessage = safeError(error);
const errorAction = {
  id: position?.id,
  symbol: normalizeSymbol(position?.symbol) || position?.symbol || "UNKNOWN",
  direction: String(position?.side || position?.direction || "UNKNOWN").toUpperCase(),
  lane: String(position?.lane || "CORE").toUpperCase(),
  action: "ERROR",
  reason: "EXIT_MONITOR_ERROR",
  closePercent: 0,
  pnlPercent: 0,
  exitScore: 0,
  error: errorMessage
};
actions.push(errorAction);
console.error("[PAPER_EXIT][ERROR]", errorAction);
}
}
const exitDiagnostics = open.map(position => {
  const symbol = normalizeSymbol(position?.symbol);
  const snapshot = null;
  return {
    id: position?.id, symbol, direction: position?.side, lane: position?.lane || "CORE",
    status: position?.status, remainingPct: Number(position?.remainingPct || 0),
    tp1Hit: !!position?.tp1Hit, tp2Hit: !!position?.tp2Hit, tp3Hit: !!position?.tp3Hit,
    protectedStage: Number(position?.protectedStage || 0), lastExitActionAt: Number(position?.lastExitActionAt || 0)
  };
});
try {
  const stateForExit = await loadState(env);
  stateForExit.lastExitDiagnostics = exitDiagnostics;
  await saveState(env, stateForExit);
} catch (_) {}
await savePositions(env, positions);
for (const action of actions) {
await auditLog(env, { type: "PAPER_UNIFIED_EXIT", action });
try { await sendTelegram(env, formatTelegramExit(action)); } catch (_) {}
}
return actions;
}
 
// ======================================================
// LIVE EXECUTION STATUS
// ======================================================
//
// When executionEnabled(env) === true, the live path is armed.
// A valid execution-eligible signal is sized, checked against live
// wallet balance / position count / trading capacity, then submitted
// through the GMX V2 Express flow using the configured signer.
//
// Required Worker secrets/vars:
// - GMX_PRIVATE_KEY : 0x + 64 hex characters
// - ARBITRUM_RPC   : Arbitrum One RPC endpoint
//
// The signer address is derived from GMX_PRIVATE_KEY; no private key
// is ever returned by the HTTP status routes. Duplicate signal keys
// are guarded with an in-memory + KV execution lock.
//
 
 
return {
status: (env) => ({
ok: true,
bot: "Smart Money Futures Signal Engine",
version: CONFIG.VERSION,
mode: CONFIG.MODE,
execution: executionEnabled(env),
radar: { independent: CONFIG.RADAR_INDEPENDENT_ENABLED, paper: CONFIG.RADAR_PAPER_ENABLED, live: CONFIG.RADAR_LIVE_ENABLED, earlyEntry: CONFIG.RADAR_EARLY_ENTRY_ENABLED, maxPositions: CONFIG.RADAR_MAX_POSITIONS },
network: "Arbitrum One",
chainId: GMX.CHAIN_ID,
time: Date.now()
}),
health: healthRoute,
debug: debugState,
markets: discoverMarkets,
market: buildMarketSnapshot,
signal: generateSignal,
scan: runFullScan,
positions: loadPositions,
updatePaperPositions,
openRadarPaperPosition,
monitorLivePositions,
control,
telegramTest: async (env) => sendTelegram(env, "\u2705 V14.0.1 Signal Engine Telegram test successful."),
diagnostics: async (env) => {
const state = await loadState(env);
return {
ok: true,
version: CONFIG.VERSION,
thresholds: {
watch: CONFIG.WATCH_SCORE,
valid: CONFIG.VALID_SIGNAL_SCORE,
strong: CONFIG.STRONG_SIGNAL_SCORE,
execution: CONFIG.EXECUTION_SCORE
},
lastScan: state.lastScan,
diagnostics: state.lastDiagnostics || []
};
},
dataHealth: async () => {
let marketsInfo=null,marketsValues=null,smartMoney=null;
try {
const info=await fetchGmxApiMarketsInfo();
marketsInfo=info?{available:true,source:info.source,rows:marketArray(info.data).length}:{available:false};
} catch(error) { marketsInfo={available:false,error:safeError(error)}; }
try {
const values=await fetchGmxMarketsValues();
const rows=marketArray(values);
marketsValues={available:rows.length>0,rows:rows.length,openInterestRows:rows.filter(r=>extractOpenInterest(r)>0).length,fundingRows:rows.filter(r=>extractFundingMeta(r).available).length};
} catch(error) { marketsValues={available:false,error:safeError(error)}; }
try {
  try {
    const infoRows=marketArray(marketsInfo?.data);
    if(infoRows.length) smfSetMarketMap(infoRows);
  } catch (_) {}
const flow=await fetchSmartMoneyFlowData({}, {});
smartMoney={available:!!flow?.available,source:flow?.source||null,trades:Number(flow?.trades||0),parsedTrades:Number(flow?.parsedTrades||0),symbols:Number(flow?.symbols||0),rejectedTrades:Number(flow?.rejectedTrades||0),error:flow?.error||null};
} catch(error) { smartMoney={available:false,error:safeError(error)}; }
return {ok:true,version:CONFIG.VERSION,multiSource:{apiPeers:V156_DATA_CENTER.apiPeers,oraclePeers:V156_DATA_CENTER.oraclePeers,timeoutMs:CONFIG.DATA_CENTER_TIMEOUT_MS,staleMs:CONFIG.DATA_CENTER_STALE_MS},marketsInfo,marketsValues,smartMoney};
}
};
})();
 
// ================================
// MAIN WORKER
// ================================
 
 
 
function clamp100(v) {
return Math.max(0, Math.min(100, Number(v) || 0));
}
 
function calculateExitSignal(position, market) {
const side = String(position?.side || position?.direction || "").toUpperCase();
const isLong = side === "LONG";
const isShort = side === "SHORT";
 
const trend = Number(market?.trend?.[isLong ? "shortScore" : "longScore"] || 0);
const momentum = Number(market?.momentum?.[isLong ? "short" : "long"] || 0);
const structure = Number(market?.structure?.[isLong ? "short" : "long"] || 0);
const participation = Number(market?.participation?.[isLong ? "short" : "long"] || 0);
 
const smartMoneyOutflow = Boolean(
market?.smartMoney?.outflow ??
market?.smartMoneyOutflow ??
false
);
 
const structureBreak = Boolean(
market?.structure?.breakAgainstPosition ??
market?.structureBreak ??
false
);
 
const trendFlip = Boolean(
market?.trend?.flipAgainstPosition ??
false
);
 
const components = {
trendReversal: clamp100(trend),
momentumReversal: clamp100(momentum / 0.60),
structureBreak: structureBreak ? 100 : clamp100(structure),
participationReversal: clamp100(participation / 0.30),
smartMoneyOutflow: smartMoneyOutflow ? 100 : 0,
trendFlip: trendFlip ? 100 : 0
};
 
const score =
components.trendReversal * 0.22 +
components.momentumReversal * 0.18 +
components.structureBreak * 0.20 +
components.participationReversal * 0.10 +
components.smartMoneyOutflow * 0.20 +
components.trendFlip * 0.10;
 
let action = "HOLD";
let closePercent = 0;
 
if (
(EXIT_ENGINE.emergency.structureBreak && structureBreak) ||
(EXIT_ENGINE.emergency.smartMoneyOutflow && smartMoneyOutflow) ||
(EXIT_ENGINE.emergency.trendFlip && trendFlip) ||
Number(market?.risk?.score ?? market?.risk ?? 0) >= EXIT_ENGINE.emergency.maxRiskScore
) {
action = "EMERGENCY_FULL";
closePercent = 100;
} else if (score >= EXIT_ENGINE.thresholds.full) {
action = "FULL_CLOSE";
closePercent = 100;
} else if (score >= EXIT_ENGINE.thresholds.partial50) {
action = "PARTIAL_50";
closePercent = 50;
} else if (score >= EXIT_ENGINE.thresholds.partial25) {
action = "PARTIAL_25";
closePercent = 25;
} else if (score >= EXIT_ENGINE.thresholds.protect) {
action = "PROTECT";
closePercent = 0;
}
 
return {
enabled: EXIT_ENGINE.enabled,
score: Number(score.toFixed(2)),
action,
closePercent,
components,
reasons: {
smartMoneyOutflow,
structureBreak,
trendFlip
},
trailing: EXIT_ENGINE.trailing
};
}
 
function shouldEmergencyClose(exitSignal, hardStopTriggered = false) {
return Boolean(
hardStopTriggered ||
exitSignal?.action === "EMERGENCY_FULL" ||
exitSignal?.action === "FULL_CLOSE"
);
}
 
function buildPositionExitPlan(position, market, hardStopTriggered = false) {
const exitSignal = calculateExitSignal(position, market);
const dynamicTPSL = deriveDynamicTPSL(position, market);
const trailingStop = deriveTrailingStop(
position,
market,
market?.currentPrice ?? market?.price
);
 
if (shouldEmergencyClose(exitSignal, hardStopTriggered)) {
return {
...exitSignal,
dynamicTPSL,
trailingStop,
action: hardStopTriggered ? "HARD_STOP_FULL" : exitSignal.action,
closePercent: 100,
execution: "FULL_CLOSE"
};
}
 
if (exitSignal.action === "PARTIAL_50" || exitSignal.action === "PARTIAL_25") {
return {
...exitSignal,
dynamicTPSL,
trailingStop,
execution: "PARTIAL_CLOSE"
};
}
 
if (exitSignal.action === "PROTECT") {
return {
...exitSignal,
dynamicTPSL,
trailingStop,
execution: "TIGHTEN_PROTECTION"
};
}
 
return {
...exitSignal,
dynamicTPSL,
trailingStop,
execution: "HOLD"
};
}
 
export default {
VERSION: CONFIG.VERSION,
 
 
 
async scheduled(event, env, ctx) {
await loadGmxSdkSafe();
const cron = event?.cron || "unknown";
const scheduledTime = event?.scheduledTime ?? null;
const scanId = String(event?.scanId || `scheduled-${scheduledTime || Date.now()}-${Math.random().toString(36).slice(2,8)}`);
 
const task = (async () => {
const restoreResourceFetch = resourceUsageInstallFetchTracker();
try {
console.log("[SCHEDULED][START]", { scanId, cron, scheduledTime, recommendedCron: CONFIG.CRON_RECOMMENDED, cronMatchesRecommended: cron === CONFIG.CRON_RECOMMENDED });
console.log("[EXECUTION][RUNTIME]", {mode:executionEnabled(env)?"LIVE":"PAPER",sdkLoaded:Boolean(GmxApiSdk && PrivateKeySigner && getViemChain),sdkLoadError:GMX_SDK_LOAD_ERROR || null});
 
let exits = [];
if (executionEnabled(env)) {
  try {
    exits = await FUTURES_V6.monitorLivePositions(env);
  } catch (exitError) {
    console.warn("[EXECUTION][MONITOR_ERROR_CONTINUE_SCAN]", {reason:safeError(exitError),code:exitError?.code || null,detail:exitError?.detail || null});
    exits = [];
  }
} else {
  exits = await FUTURES_V6.updatePaperPositions(env);
}
 
const allowancePreflight = {enabled:false,attempted:false,ok:true,approved:[],sufficient:[],skipped:["EXECUTION_TIME_ONLY"],errors:[],elapsedMs:0};
let scheduledOpenPositions = 0;
try {
const scheduledPositions = await FUTURES_V6.positions(env);
scheduledOpenPositions = Array.isArray(scheduledPositions)
? scheduledPositions.filter(p => p?.status === "PAPER_OPEN").length
: 0;
} catch (_) {}
const scheduledPositionReserve = scheduledOpenPositions * 4;
let scan;
let resourceGuardPaused = false;
let resourceGuardSnapshot = null;
const guardState = await loadState(env);
resourceGuardSnapshot = resourceUsageWouldPause(guardState, Date.now());
if (resourceGuardSnapshot.paused) {
  resourceGuardPaused = true;
  scan = { ok: true, status: "RESOURCE_GUARD_PAUSED", signalsDetected: 0, notificationEligible: 0, eventCandidates: 0, signalsDeduped: 0, diagnostics: { resourceGuard: resourceUsageSummary(guardState) } };
  console.warn("[RESOURCE][PAUSE_SCAN]", resourceGuardSnapshot);
} else {
  scan = await FUTURES_V6.scan(env, {
    additionalSubrequestReserve: scheduledPositionReserve,
    source: "cron",
    scanId
  });
}
 
const resourceState = await loadState(env);
const resourceRuntime = resourceUsageRuntimeSnapshot(scheduledTime);
const resourceCommitted = resourceUsageCommit(resourceState, resourceRuntime, Date.now());
try { await saveState(env, resourceState); } catch (resourceSaveError) { console.error("[RESOURCE][STATE_SAVE_ERROR]", { error: safeError(resourceSaveError) }); }
console.log("[SCHEDULED][DONE]", {
scanId,
cron,
scheduledTime,
recommendedCron: CONFIG.CRON_RECOMMENDED,
cronMatchesRecommended: cron === CONFIG.CRON_RECOMMENDED,
scanStatus: scan?.status || null,
scanOk: scan?.ok ?? null,
scanned: scan?.scanned ?? null,
signals: scan?.candidates ?? scan?.signals?.length ?? scan?.signalsDetected ?? scan?.topSignals?.length ?? 0,
notificationEligible: scan?.notificationEligible ?? scan?.diagnostics?.notificationEligible ?? scan?.candidates ?? 0,
eventCandidates: scan?.eventCandidates ?? scan?.diagnostics?.eventCandidates ?? 0,
  broad5mScanned: scan?.broad5mScanned ?? scan?.diagnostics?.broad5mScanned ?? 0,
  deepScanned: scan?.deepScanned ?? scan?.diagnostics?.deepScanned ?? 0,
  eventStats: scan?.eventStats ?? scan?.diagnostics?.eventStats ?? null,
signalsDeduped: scan?.signalsDeduped ?? scan?.diagnostics?.signalsDeduped ?? 0,
notified: scan?.diagnostics?.notified ?? 0,
coreDirectional: { long: scan?.diagnostics?.longAnalyzed ?? 0, short: scan?.diagnostics?.shortAnalyzed ?? 0, noTrade: scan?.diagnostics?.noTradeAnalyzed ?? 0, valid: scan?.diagnostics?.validSignals ?? 0, watch: scan?.diagnostics?.watchSignals ?? 0 },
execution: scan?.executionSummary || scan?.diagnostics?.executionSummary || (Array.isArray(scan?.executionResults) ? {attempted:scan.executionResults.length,executed:scan.executionResults.filter(x=>x?.executed).length,failed:scan.executionResults.filter(x=>x && x.executed===false && (x.error||x.reason)).length} : null),
executionResults: Array.isArray(scan?.executionResults) ? scan.executionResults.slice(0,3).map(x => ({symbol:x?.symbol || null,executed:Boolean(x?.executed),reason:x?.reason || null,error:x?.error || null})) : [],
allowancePreflight,
radar: { coverage: scan?.radarCoverageMarkets ?? scan?.diagnostics?.radarLane?.coverageMarkets ?? 0, directional: scan?.radarDirectionalMarkets ?? scan?.diagnostics?.radarLane?.directionalMarkets ?? 0, long: scan?.radarLongMarkets ?? scan?.diagnostics?.radarLane?.longMarkets ?? 0, short: scan?.radarShortMarkets ?? scan?.diagnostics?.radarLane?.shortMarkets ?? 0, hot: scan?.radarHotCandidates ?? scan?.diagnostics?.radarLane?.hotCandidateCount ?? 0, watch: scan?.radarWatchCandidates ?? scan?.diagnostics?.radarLane?.watchCandidates ?? 0, trace: scan?.diagnostics?.radarLane?.trace || null },
telegram: scan?.diagnostics?.telegram || null,
radarLive: scan?.radarLiveResult ? {executed:Boolean(scan.radarLiveResult.executed),symbol:scan.radarLiveResult.symbol || null,reason:scan.radarLiveResult.reason || null,error:scan.radarLiveResult.error || null} : null,
subrequestBudget: scan?.diagnostics?.requestStrategy || null,
scheduledPositionReserve,
resourceGuardPaused,
resourceGuard: resourceCommitted ? resourceUsageSummary(resourceState) : null
});
 
try {
await auditLog(env, {
type: "SCHEDULED_CYCLE",
scanId,
cron,
scheduledTime,
exits,
scanStatus: scan?.status || null
});
} catch (auditError) {
console.error("[SCHEDULED][AUDIT_ERROR]", {
cron,
error: safeError(auditError)
});
}
 } catch (error) {
console.error("[SCHEDULED][ERROR]", {
scanId,
cron,
scheduledTime,
error: safeError(error),
stack: error?.stack || null
});
try { restoreResourceFetch(); } catch (_) {}
 
// Never allow the error-reporting path itself to create a second
// uncaught exception and turn the Cron invocation into an opaque failure.
try {
await auditLog(env, {
type: "SCHEDULED_CYCLE_ERROR",
scanId,
cron,
scheduledTime,
error: safeError(error)
});
} catch (auditError) {
console.error("[SCHEDULED][AUDIT_ERROR_AFTER_FAILURE]", {
cron,
error: safeError(auditError)
});
}
}
try { restoreResourceFetch(); } catch (_) {}
})();
 
// V13.9.6: Cron explicitly awaits the full cycle. This keeps the scan,
// Telegram sends, state persistence, and audit logging inside the scheduled
// invocation lifecycle instead of detaching the task from the handler.
return await task;
},
 
async fetch(request, env, ctx){
 
 
try{
 
 
const url =
new URL(request.url);
 
 
 
if(
url.pathname === "/status"
){
 
return jsonResponse({
 
bot:
"Smart Money Futures AI Bot",
 
 
version:
CONFIG.VERSION,
 
 
mode:
CONFIG.MODE,
 
 
execution:
executionEnabled(env),
 
 
network:
"ARBITRUM",
 
 
status:
"ONLINE",
 
 
time:
Date.now()
 
 
});
 
}
 
 
 
 
if(
url.pathname === "/debug"
){
 
return jsonResponse({
 
config:
CONFIG,
 
 
env:
 
 
{
 
kv:
!!env.BOT_STATE,
 
 
telegram:
!!env.TELEGRAM_TOKEN,
 
 
rpc:
!!env.ARBITRUM_RPC
 
 
}
 
 
});
 
}
 
 
 
 
if(
url.searchParams.get("test") === "telegram"
){
 
const sent = await sendTelegram(
env,
`✅ Telegram test successful — ${CONFIG.VERSION}`
);
 
return jsonResponse({
test: "telegram",
sent,
tokenConfigured: !!env.TELEGRAM_TOKEN,
chatIdConfigured: !!env.TELEGRAM_CHAT_ID,
time: Date.now()
});
}
 
 
 
if(url.pathname === "/debug/gmx/summary"){
return await gmxSummaryRoute(env);
}
 
if(url.pathname === "/debug/gmx/markets"){
return await gmxMarketsRoute(env, false);
}
 
if(url.pathname === "/debug/gmx/markets/info"){
return await gmxMarketsRoute(env, true);
}
 
if(url.pathname === "/markets"){
return await gmxMarketsRoute(env, false);
}
 
if(
url.pathname === "/positions"
){
 
 
const positions =
await loadPositions(env);
 
 
 
return jsonResponse({
 
count:
positions.length,
 
 
positions
 
 
});
 
}
 
 
 
 
// V17.6.0 Classic cost probe — prepares a real Classic transaction but NEVER broadcasts it.
if(url.pathname === "/debug/gmx/classic-cost") {
  try {
    const {sdk,account}=await getLiveContext(env);
    const qs=new URL(request.url).searchParams;
    const result=await classicCostProbe(sdk,env,{
      account,
      symbol:qs.get("symbol") || "ETH/USD [WETH-USDC]",
      direction:qs.get("direction") || "long",
      sizeUsd:qs.get("sizeUsd") || "5",
      collateralUsd:qs.get("collateralUsd") || "1",
      collateralToken:qs.get("collateralToken") || "USDC"
    });
    return jsonResponse(result);
  } catch(error) {
    return jsonResponse({ok:false,mode:"classic",error:safeError(error),stage:error?.executionStage||"CLASSIC_COST_PROBE",version:BOT_VERSION},503);
  }
}

// V17.5.15 dashboard routes — read-only
if(url.pathname === "/dashboard") {
  return new Response(dashboardHtml(), { status:200, headers:{"content-type":"text/html; charset=UTF-8","cache-control":"no-store"} });
}
if(url.pathname === "/dashboard/data") {
  try { return jsonResponse(await gmxDashboardData(env)); }
  catch(error) { return jsonResponse({ok:false,error:safeError(error),version:"V17.5.15-DASHBOARD"},503); }
}

// ======================================================
// V6 PRO SIGNAL ROUTES (MERGED)
// ======================================================
if(url.pathname === "/v6/status") { return jsonResponse(FUTURES_V6.status(env)); }
if(url.pathname === "/v6/live/status") {
try {
const {sdk,account}=await getLiveContext(env);
const positions=await sdk.fetchPositionsInfo({address:account});
return jsonResponse({ok:true,armed:true,signerConnected:true,account,positions:Array.isArray(positions)?positions.length:0,chainId:42161});
} catch(error) {
return jsonResponse({ok:false,armed:false,error:safeError(error)},503);
}
}
if(url.pathname === "/v6/health") { return await FUTURES_V6.health(env); }
if(url.pathname === "/v6/diagnostics") { return jsonResponse(await FUTURES_V6.diagnostics(env)); }
if(url.pathname === "/v6/data-health") { return jsonResponse(await FUTURES_V6.dataHealth(env)); }
if(url.pathname === "/v6/debug") { return jsonResponse(await FUTURES_V6.debug(env)); }
if(url.pathname === "/v6/markets") { return jsonResponse(await FUTURES_V6.markets(env)); }
if(url.pathname === "/v6/market") { const symbol=url.searchParams.get("symbol"); if(!symbol) return jsonResponse({ok:false,error:"symbol is required"},400); return jsonResponse(await FUTURES_V6.market(symbol,env)); }
if(url.pathname === "/v6/signal" || url.pathname === "/signal") { const symbol=url.searchParams.get("symbol"); if(!symbol) return jsonResponse({ok:false,error:"symbol is required"},400); return jsonResponse(await FUTURES_V6.signal(symbol,env)); }
if(url.pathname === "/v6/scan" || url.pathname === "/scan-v6" || url.pathname === "/scan") { return jsonResponse(await FUTURES_V6.scan(env)); }
if(url.pathname === "/v6/positions") { return jsonResponse({ok:true,positions:await FUTURES_V6.positions(env)}); }
if(url.pathname === "/v6/control") { return jsonResponse(await FUTURES_V6.control(url.searchParams.get("cmd"),env)); }
if(url.pathname === "/v6/test/telegram") { const sent=await FUTURES_V6.telegramTest(env); return jsonResponse({ok:sent,sent}); }
 
// /scan is handled above by FUTURES_V6. This marker makes accidental
// fallback routing visible in Cloudflare logs during future debugging.
console.log("[V9.1][ROUTER] fallback apiRouter", { path: url.pathname });
const routedResponse = await apiRouter(request, env);
 
if(routedResponse){
return routedResponse;
}
 
return new Response(
 
"Smart Money Futures AI Bot V9.1 ONLINE",
 
{
 
status:200,
 
headers:{
"content-type":
"text/plain"
 
}
 
}
 
);
 
 
 
}
 
catch(error){
 
 
 
return jsonResponse({
 
error:
error.message,
 
 
version:
CONFIG.VERSION,
 
 
time:
Date.now()
 
 
},500);
 
 
 
}
 
 
}
 
 
 
};
 
 
 
 
 
 
// ======================================================
// GMX MARKET INTELLIGENCE V1
// KV CACHE + MARKET EXECUTION TELEMETRY
// ======================================================
 
const GMX_CACHE_KEY = "GMX_MARKETS_INFO_CACHE";
const GMX_CACHE_TTL = 15;
 
async function getGmxMarketsInfoCached(env){
const now = Math.floor(Date.now()/1000);
 
if(env.GMX_CACHE){
try{
const cached = await env.GMX_CACHE.get(GMX_CACHE_KEY, "json");
if(cached && cached.expiresAt > now){
return {
cache:"HIT",
data:cached.data
};
}
}catch(e){}
}
 
const response = await fetch(
GMX_V2_CONFIG.MARKETS_INFO_URL,
{
headers:{
"accept":"application/json"
}
}
);
 
const data = await response.json();
 
if(env.GMX_CACHE){
try{
await env.GMX_CACHE.put(
GMX_CACHE_KEY,
JSON.stringify({
expiresAt:now + GMX_CACHE_TTL,
data
})
);
}catch(e){}
}
 
return {
cache:"MISS",
data
};
}
 
function calculateMarketQuality(m){
let score = 0;
 
const liquidity = Number(
m.liquidity ||
m.totalLiquidity ||
0
);
 
const oi = Number(
m.openInterest ||
m.openInterestUsd ||
0
);
 
if(liquidity > 1000000) score += 35;
else if(liquidity > 100000) score += 20;
 
if(oi > 1000000) score += 30;
else if(oi > 100000) score += 15;
 
if(m.fundingRate !== undefined) score += 20;
if(m.isListed !== false) score += 15;
 
return Math.min(score,100);
}
 
function normalizeGmxMarketInfo(m){
return {
symbol:m.name || m.symbol || "UNKNOWN",
marketToken:m.marketToken || null,
liquidity:m.liquidity || m.totalLiquidity || 0,
openInterest:m.openInterest || m.openInterestUsd || 0,
fundingRate:m.fundingRate || null,
qualityScore:calculateMarketQuality(m)
};
}
 
async function gmxSummaryRoute(env){
try{
const result = await getGmxMarketsInfoCached(env);
 
const markets =
Array.isArray(result.data.markets)
? result.data.markets
: [];
 
const ranked = markets
.map(normalizeGmxMarketInfo)
.sort((a,b)=>{
// V15 FAIR: this endpoint is telemetry only; do not use this quality
// score to select or prioritize trading candidates.
if(Number(b.qualityScore)!==Number(a.qualityScore)) return Number(b.qualityScore)-Number(a.qualityScore);
return String(a.symbol).localeCompare(String(b.symbol));
})
.slice(0,10);
 
return jsonResponse({
ok:true,
network:"Arbitrum One",
chainId:42161,
gmx:"reachable",
cache:result.cache,
markets:markets.length,
topMarkets:ranked,
mode:CONFIG.MODE,
execution:executionEnabled(env),
timestamp:Date.now()
});
 
}catch(error){
return jsonResponse({
ok:false,
gmx:"error",
error:error.message
},500);
}
}
 
// ================================
// RESPONSE HELPER
// ================================
 
 
function jsonResponse(data,status=200){
 
 
return new Response(
 
JSON.stringify(
data,
null,
2
),
 
{
 
 
status,
 
 
headers:{
 
"content-type":
"application/json"
 
}
 
 
}
 
);
 
 
}
 
 
 
 
 
// ================================
// KV STATE MANAGER
// ================================
 
 
async function legacyLoadPositions(env){
 
 
 
if(!env.BOT_STATE){
 
return [];
 
}
 
 
 
const data =
 
await env.BOT_STATE.get(
"positions",
"json"
);
 
 
 
return data || [];
 
}
 
 
 
 
 
async function legacySavePositions(
env,
positions
){
 
 
 
if(!env.BOT_STATE){
 
return false;
 
}
 
 
 
await env.BOT_STATE.put(
 
"positions",
 
JSON.stringify(
positions
)
 
);
 
 
 
return true;
 
 
}
 
 
 
 
 
// ================================
// AUDIT LOGGER
// ================================
 
 
async function auditLog(
env,
event
){
 
 
 
if(!env.BOT_STATE){
 
return;
 
}
 
 
 
const logs =
 
await env.BOT_STATE.get(
"audit",
"json"
)
||
[];
 
 
 
 
logs.push({
 
event,
 
 
time:
Date.now()
 
 
});
 
 
 
await env.BOT_STATE.put(
 
"audit",
 
jsonStringifySafe(
logs.slice(-100)
)
 
);
 
 
 
}
 
 
 
 
 
// ================================
// SYSTEM HEALTH
// ================================
 
 
function systemHealth(env){
 
 
 
return {
 
 
version:
CONFIG.VERSION,
 
 
execution:
executionEnabled(env),
 
 
mode:
CONFIG.MODE,
 
 
healthy:true,
 
 
timestamp:
Date.now()
 
 
};
 
 
 
}
// ======================================================
// MARKET INTELLIGENCE ENGINE
// V6.3.1 PART 2
// ======================================================
 
 
 
// ================================
// MARKET STATE CACHE
// ================================
 
 
const MARKET_CACHE = {};
 
 
 
 
 
function updateMarketData(
symbol,
data
){
 
 
 
MARKET_CACHE[symbol]={
 
 
...MARKET_CACHE[symbol],
 
 
...data,
 
 
updatedAt:
Date.now()
 
 
};
 
 
 
return MARKET_CACHE[symbol];
 
 
}
 
 
 
 
 
 
function getMarketData(symbol){
 
 
return MARKET_CACHE[symbol] || null;
 
 
}
 
 
 
 
 
// ================================
// PRICE ANALYSIS
// ================================
 
 
function analyzePrice(data){
 
 
let score=0;
 
 
 
if(
data.change5m >= 3
){
 
score +=20;
 
}
 
 
 
if(
data.change15m >=5
){
 
score +=20;
 
}
 
 
 
if(
data.trend==="UP"
){
 
score +=10;
 
}
 
 
 
return score;
 
 
}
 
 
 
 
 
// ================================
// VOLUME ANALYSIS
// ================================
 
 
function analyzeVolume(data){
 
 
 
let score=0;
 
 
 
if(
data.volumeChange >=100
){
 
score+=20;
 
}
 
 
 
if(
data.volumeChange >=300
){
 
score+=15;
 
}
 
 
 
return score;
 
 
}
 
 
 
 
 
 
// ================================
// OPEN INTEREST ENGINE
// ================================
 
 
function analyzeOpenInterest(data){
 
 
 
let score=0;
 
 
 
if(
data.openInterestChange>=10
){
 
score+=10;
 
}
 
 
 
if(
data.openInterestChange>=30
){
 
score+=20;
 
}
 
 
 
return score;
 
 
}
 
 
 
 
 
 
// ================================
// FUNDING RATE ANALYSIS
// ================================
 
 
function analyzeFunding(data){
 
 
 
let score=0;
 
 
 
const funding =
data.fundingRate || 0;
 
 
 
 
// Avoid overcrowded longs
 
if(
funding > 0.10
){
 
score-=15;
 
}
 
 
 
// Healthy short pressure
 
if(
funding < -0.05
){
 
score+=10;
 
}
 
 
 
return score;
 
 
}
 
 
 
 
 
 
// ================================
// ORDERBOOK IMBALANCE
// ================================
 
 
function analyzeOrderbook(data){
 
 
 
const imbalance =
 
data.orderbookImbalance || 0;
 
 
 
if(
imbalance > 0.40
){
 
return 20;
 
}
 
 
 
if(
imbalance > 0.20
){
 
return 10;
 
}
 
 
 
if(
imbalance < -0.40
){
 
return -20;
 
}
 
 
 
return 0;
 
 
}
 
 
 
 
 
 
// ================================
// FAKE PUMP DETECTOR
// ================================
 
 
function detectFakePump(data){
 
 
 
let risk=0;
 
 
 
// Price moving without OI support
 
if(
 
data.change5m > 10 &&
 
data.openInterestChange < 5
 
){
 
risk+=40;
 
}
 
 
 
 
// Volume spike with weak liquidity
 
if(
 
data.volumeChange > 500 &&
 
data.liquidity < 500000
 
){
 
risk+=30;
 
}
 
 
 
return Math.min(
risk,
100
);
 
 
}
 
 
 
 
 
 
// ================================
// LIQUIDITY TRAP DETECTOR
// ================================
 
 
function detectLiquidityTrap(data){
 
 
 
let risk=0;
 
 
 
if(
 
data.volumeChange > 300 &&
 
data.liquidity < 1000000
 
){
 
risk+=50;
 
}
 
 
 
if(
 
data.spread > 1
 
){
 
risk+=20;
 
}
 
 
 
return Math.min(
risk,
100
);
 
 
}
 
 
 
 
 
 
// ================================
// SMART MONEY SCORE ENGINE
// ================================
 
 
function calculateSmartMoneyScore(data){
 
 
 
let score=50;
 
 
 
score += analyzePrice(data);
 
 
score += analyzeVolume(data);
 
 
score += analyzeOpenInterest(data);
 
 
score += analyzeFunding(data);
 
 
score += analyzeOrderbook(data);
 
 
 
 
// Risk reduction
 
score -= detectFakePump(data);
 
 
score -= detectLiquidityTrap(data);
 
 
 
 
 
return Math.max(
 
0,
 
Math.min(
score,
100
)
 
);
 
 
 
}
 
 
 
 
 
 
// ================================
// MARKET ANALYSIS PIPELINE
// ================================
 
 
function analyzeMarket(symbol){
 
 
 
const data =
getMarketData(symbol);
 
 
 
if(!data){
 
 
return {
 
 
symbol,
 
 
status:
"NO_DATA"
 
 
};
 
 
}
 
 
 
const score =
 
calculateSmartMoneyScore(data);
 
 
 
 
return {
 
 
symbol,
 
 
score,
 
 
fakePumpRisk:
 
detectFakePump(data),
 
 
 
liquidityRisk:
 
detectLiquidityTrap(data),
 
 
 
timestamp:
Date.now()
 
 
};
 
 
 
}
// ======================================================
// MULTI AGENT STRATEGY ENGINE
// V6.3.1 PART 3
// ======================================================
 
 
 
// ================================
// MOMENTUM AGENT
// ================================
 
 
function momentumAgent(data){
 
 
let score=0;
 
 
 
if(
data.change5m >=3
){
 
score+=25;
 
}
 
 
 
if(
data.change15m >=5
){
 
score+=20;
 
}
 
 
 
if(
data.volumeChange>=200
){
 
score+=25;
 
}
 
 
 
return Math.min(
score,
100
);
 
 
}
 
 
 
 
 
 
// ================================
// SMART MONEY AGENT
// ================================
 
 
function smartMoneyAgent(data){
 
 
 
let score=0;
 
 
 
if(
data.openInterestChange>=20
){
 
score+=30;
 
}
 
 
 
if(
data.largeOrders===true
){
 
score+=25;
 
}
 
 
 
if(
data.orderbookImbalance>0.3
){
 
score+=25;
 
}
 
 
 
return Math.min(
score,
100
);
 
 
}
 
 
 
 
 
 
// ================================
// TREND AGENT
// ================================
 
 
function trendAgent(data){
 
 
 
let score=0;
 
 
 
if(
data.trend==="UP"
){
 
score+=30;
 
}
 
 
 
if(
data.higherTimeframeTrend==="UP"
){
 
score+=40;
 
}
 
 
 
if(
data.maFast >
data.maSlow
){
 
score+=20;
 
}
 
 
 
return Math.min(
score,
100
);
 
 
}
 
 
 
 
 
 
// ================================
// REVERSAL SAFETY AGENT
// ??????? ?? ???? ????? ???
// ================================
 
 
function reversalAgent(data){
 
 
 
let risk=0;
 
 
 
if(
data.change1h>15
){
 
risk+=30;
 
}
 
 
 
if(
data.volumeChange < data.priceChange*10
){
 
risk+=20;
 
}
 
 
 
return risk;
 
 
}
 
 
 
 
 
 
 
// ================================
// LEGACY STRATEGY VOTING (NOT USED BY FUTURES_V6 CANONICAL ENGINE)
// ================================
 
 
function legacyStrategyVote(data){
 
 
 
const votes={
 
 
momentum:
 
momentumAgent(data),
 
 
 
smartMoney:
 
smartMoneyAgent(data),
 
 
 
trend:
 
trendAgent(data)
 
 
};
 
 
 
 
let finalScore =
 
(
votes.momentum +
 
votes.smartMoney +
 
votes.trend
 
)
/3;
 
 
 
 
// ???? ?????? ?? ???? ??? ?????
 
finalScore -=
 
reversalAgent(data);
 
 
 
 
return {
 
 
votes,
 
 
finalScore:
 
Math.max(
 
0,
 
Math.min(
finalScore,
100
)
 
)
 
 
 
};
 
 
 
}
 
 
 
 
 
 
 
// ================================
// MARKET RANKING ENGINE
// ================================
 
 
function rankMarkets(markets){
 
 
 
return markets.sort(
 
(a,b)=>
 
b.finalScore - a.finalScore
 
);
 
 
}
 
 
 
 
 
 
 
// ================================
// BEST OPPORTUNITY SELECTOR
// ================================
 
 
function selectBestMarkets(
markets
){
 
 
 
const ranked =
 
rankMarkets(markets);
 
 
 
 
return ranked.slice(
0,
3
);
 
 
}
 
 
 
 
 
 
// ================================
// FULL AI MARKET SCAN
// ================================
 
 
function runAIScan(symbols){
 
 
 
const results=[];
 
 
 
for(
const symbol of symbols
){
 
 
 
const data =
getMarketData(symbol);
 
 
 
if(!data)
continue;
 
 
 
const analysis =
 
legacyStrategyVote(data);
 
 
 
 
results.push({
 
symbol,
 
 
...analysis
 
 
});
 
 
 
}
 
 
 
return selectBestMarkets(
results
);
 
 
}
// ======================================================
// PORTFOLIO MANAGER & RISK ENGINE
// V6.3.1 PART 4
// ======================================================
 
 
 
 
// ================================
// PORTFOLIO STATE
// ================================
 
 
const PORTFOLIO = {
 
 
positions: [],
 
 
dailyLoss:0,
 
 
balance:0
 
 
};
 
 
 
 
 
 
 
// ================================
// POSITION LIMIT CHECK
// ================================
 
 
function canOpenPosition(){
 
 
 
return (
 
PORTFOLIO.positions.length
<
CONFIG.MAX_POSITIONS
 
);
 
 
}
 
 
 
 
 
 
 
// ================================
// CAPITAL ALLOCATION
// ================================
 
 
function calculateTradeSize(balance,score){
 
 
 
let allocation =
 
CONFIG.CAPITAL_PER_TRADE;
 
 
 
 
// ?????????? ????? ???
 
if(
score>=95
){
 
allocation=0.07;
 
}
 
 
 
 
// ????? ???????
 
if(
score<90
){
 
allocation=0.03;
 
}
 
 
 
 
return {
 
 
capital:
 
balance*allocation,
 
 
percentage:
 
allocation
 
 
};
 
 
}
 
 
 
 
 
 
 
// ================================
// CORRELATION ENGINE
// ================================
 
 
 
function calculateCorrelation(
asset1,
asset2
){
 
 
 
// ?? ???? ???? ?? ???? ????? ?????? ??????
 
// ????? ??? ????
 
 
 
if(
asset1.base===asset2.base
){
 
return 1;
 
}
 
 
 
return 0.5;
 
 
}
 
 
 
 
 
 
 
function checkCorrelation(
newSignal
){
 
 
 
for(
const position of PORTFOLIO.positions
){
 
 
 
const correlation =
 
calculateCorrelation(
 
newSignal,
 
position
 
);
 
 
 
 
if(
correlation>=0.8
){
 
return {
 
 
allowed:false,
 
 
reason:
"High correlation"
 
 
};
 
}
 
 
 
}
 
 
 
return {
 
 
allowed:true
 
 
};
 
 
}
 
 
 
 
 
 
 
 
// ================================
// RISK CHECK
// ================================
 
 
function legacyRiskGuard(signal){
 
 
 
if(
!canOpenPosition()
){
 
return {
 
 
allowed:false,
 
 
reason:
"Maximum positions reached"
 
 
};
 
 
}
 
 
 
 
 
const correlation =
 
checkCorrelation(signal);
 
 
 
 
if(
!correlation.allowed
){
 
return correlation;
 
}
 
 
 
 
 
 
if(
PORTFOLIO.dailyLoss
<=
-                  CONFIG.MAX_DAILY_LOSS
){
 
return {
 
 
allowed:false,
 
 
reason:
"Daily loss limit"
 
 
};
 
 
}
 
 
 
 
return {
 
 
allowed:true
 
 
};
 
 
 
}
 
 
 
 
 
 
 
 
 
// ================================
// SIGNAL PRIORITY RANKING
// ================================
 
 
function rankSignals(signals){
 
return signals.sort((a,b)=>{
 
const scoreA = Number(a?.finalScore ?? a?.score ?? 0);
const scoreB = Number(b?.finalScore ?? b?.score ?? 0);
 
if (scoreB !== scoreA) return scoreB - scoreA;
 
const precisionA = Number(
(a?.diagnostics?.advanced?.precisionEntry?.long?.score ??
a?.diagnostics?.advanced?.precisionEntry?.short?.score ??
a?.precisionScore ?? 0)
);
const precisionB = Number(
(b?.diagnostics?.advanced?.precisionEntry?.long?.score ??
b?.diagnostics?.advanced?.precisionEntry?.short?.score ??
b?.precisionScore ?? 0)
);
 
return precisionB - precisionA;
 
});
 
}
 
 
// ================================
// SELECT BEST OPPORTUNITY
// ================================
 
 
function chooseBestSignal(
signals
){
 
 
 
const ranked =
 
rankSignals(signals);
 
 
 
return ranked[0] || null;
 
 
}
 
 
 
 
 
 
 
 
// ================================
// CREATE POSITION
// ================================
 
 
function createPortfolioPosition(
signal,
balance
){
 
 
 
const size =
 
calculateTradeSize(
 
balance,
 
signal.finalScore
 
);
 
 
 
 
const position={
 
 
 
id:
 
crypto.randomUUID(),
 
 
 
symbol:
 
signal.symbol,
 
 
 
side:
 
signal.direction || "LONG",
 
 
 
score:
 
signal.finalScore,
 
 
 
smartMoney:
 
signal.votes.smartMoney,
 
 
 
capital:
 
size.capital,
 
 
 
openedAt:
 
Date.now(),
 
 
 
status:
 
"OPEN"
 
 
};
 
 
 
 
 
PORTFOLIO.positions.push(
position
);
 
 
 
return position;
 
 
}
 
 
 
 
 
 
 
 
// ================================
// REMOVE POSITION
// ================================
 
 
function closePortfolioPosition(
id,
pnl
){
 
 
 
PORTFOLIO.positions =
 
PORTFOLIO.positions.filter(
 
p=>p.id!==id
 
);
 
 
 
 
if(
pnl<0
){
 
PORTFOLIO.dailyLoss += pnl;
 
}
 
 
 
return true;
 
 
}
 
 
 
 
 
 
// ================================
// PORTFOLIO STATUS
// ================================
 
 
function getPortfolioStatus(){
 
 
 
return {
 
 
openPositions:
 
PORTFOLIO.positions.length,
 
 
positions:
 
PORTFOLIO.positions,
 
 
dailyLoss:
 
PORTFOLIO.dailyLoss
 
 
};
 
 
}
// ======================================================
// POSITION MANAGER & SMART EXIT ENGINE
// V6.3.1 PART 5
// ======================================================
 
 
 
// ================================
// POSITION CONFIG
// ================================
 
 
const POSITION_CONFIG = {
 
 
TP_LEVELS:[
 
30,
 
60,
 
100
 
],
 
 
STOP_LOSS:
 
10,
 
 
TRAILING_PERCENT:
 
8
 
 
};
 
 
 
 
 
// ================================
// CALCULATE PNL
// ================================
 
 
function calculatePnL(
position,
currentPrice
){
 
 
 
let pnl;
 
 
 
if(
position.side==="LONG"
){
 
 
pnl =
 
(
(
currentPrice -
position.entryPrice
)
/
position.entryPrice
 
)
*
100;
 
 
 
}
 
 
else{
 
 
pnl =
 
(
(
position.entryPrice -
currentPrice
)
/
position.entryPrice
 
)
*
100;
 
 
 
}
 
 
 
 
return Number(
pnl.toFixed(2)
);
 
 
}
 
 
 
 
 
 
// ================================
// PARTIAL TAKE PROFIT ENGINE
// ================================
 
 
function checkPartialTP(
position,
pnl
){
 
 
 
for(
const level of POSITION_CONFIG.TP_LEVELS
){
 
 
 
if(
 
pnl>=level &&
 
!position.closedTP?.includes(level)
 
){
 
 
return {
 
 
action:
"PARTIAL_CLOSE",
 
 
level
 
 
};
 
 
 
}
 
 
 
}
 
 
 
return null;
 
 
}
 
 
 
 
 
 
 
// ================================
// STOP LOSS ENGINE
// ================================
 
 
function checkStopLoss(
position,
pnl
){
 
 
 
if(
pnl <=
-
POSITION_CONFIG.STOP_LOSS
){
 
 
 
return {
 
 
action:
"CLOSE_ALL",
 
 
reason:
"STOP_LOSS"
 
 
};
 
 
}
 
 
 
return null;
 
 
}
 
 
 
 
 
 
 
// ================================
// TRAILING STOP ENGINE
// ================================
 
 
function updateTrailingStop(
position,
currentPrice
){
 
 
 
if(
!CONFIG.TRAILING_STOP
){
 
return position;
 
}
 
 
 
 
 
if(
position.side==="LONG"
){
 
 
 
const newStop =
 
currentPrice *
(
POSITION_CONFIG.TRAILING_PERCENT/100
);
 
 
 
 
 
if(
!position.trailingStop ||
 
newStop >
position.trailingStop
){
 
 
position.trailingStop =
newStop;
 
 
}
 
 
 
}
 
 
 
 
 
else{
 
 
const newStop =
 
currentPrice *
(
POSITION_CONFIG.TRAILING_PERCENT/100
);
 
 
 
 
 
if(
!position.trailingStop ||
 
newStop <
position.trailingStop
){
 
 
position.trailingStop =
newStop;
 
 
}
 
 
 
}
 
 
 
 
 
return position;
 
 
}
 
 
 
 
 
 
 
// ================================
// TRAILING STOP CHECK
// ================================
 
 
function checkTrailingStop(
position,
price
){
 
 
 
if(
!position.trailingStop
){
 
return null;
 
}
 
 
 
if(
position.side==="LONG" &&
 
price <= position.trailingStop
 
){
 
 
return {
 
 
action:
"CLOSE_ALL",
 
 
reason:
"TRAILING_STOP"
 
 
};
 
 
}
 
 
 
 
 
 
if(
position.side==="SHORT" &&
 
price >= position.trailingStop
 
){
 
 
return {
 
 
action:
"CLOSE_ALL",
 
 
reason:
"TRAILING_STOP"
 
 
};
 
 
}
 
 
 
return null;
 
 
}
 
 
 
 
 
 
 
// ================================
// SMART EXIT ENGINE
// ================================
 
 
function smartExitCheck(
position,
market
){
 
 
 
// ??? Smart Money
 
 
if(
market.smartMoneyScore < 50
){
 
 
return {
 
 
action:
"CLOSE_ALL",
 
 
reason:
"SMART_MONEY_EXIT"
 
 
};
 
 
}
 
 
 
 
 
 
// ??? ??? ????
 
 
if(
market.volumeChange < -50
){
 
 
return {
 
 
action:
"CLOSE_ALL",
 
 
reason:
"VOLUME_FADE"
 
 
};
 
 
}
 
 
 
 
 
 
return null;
 
 
}
 
 
 
 
 
 
 
// ================================
// POSITION MONITOR
// ================================
 
 
function monitorPosition(
position,
market
){
 
 
 
const pnl =
 
calculatePnL(
 
position,
 
market.price
 
);
 
 
 
 
 
const tp =
 
checkPartialTP(
position,
pnl
);
 
 
 
if(tp){
 
return tp;
 
}
 
 
 
 
 
 
const sl =
 
checkStopLoss(
position,
pnl
);
 
 
 
if(sl){
 
return sl;
 
}
 
 
 
 
 
 
updateTrailingStop(
 
position,
 
market.price
 
);
 
 
 
 
 
const trailing =
 
checkTrailingStop(
 
position,
 
market.price
 
);
 
 
 
if(trailing){
 
return trailing;
 
}
 
 
 
 
 
const smartExit =
 
smartExitCheck(
 
position,
 
market
 
);
 
 
 
if(smartExit){
 
return smartExit;
 
}
 
 
 
 
 
return {
 
 
action:
"HOLD",
 
 
pnl
 
 
};
 
 
}
// ======================================================
// MAIN ENGINE + TELEGRAM CONTROL
// V6.1.1 PART 6
// ======================================================
 
 
 
// ================================
// BOT STATE
// ================================
 
 
const BOT_STATE = {
 
 
running:true,
 
 
lastScan:null,
 
 
signals:[],
 
 
executions:0,
 
 
errors:0
 
 
};
 
 
 
 
 
// ================================
// MARKET WATCHLIST
// ================================
 
 
const WATCHLIST = [
 
 
"BTC-PERP",
 
"ETH-PERP",
 
"SOL-PERP",
 
"ARB-PERP",
 
"AVAX-PERP",
 
"INJ-PERP",
 
"LINK-PERP",
 
"OP-PERP",
 
"APT-PERP",
 
"NEAR-PERP"
 
 
];
 
 
 
 
 
// ================================
// LIVE GMX EXECUTION ENGINE V6.1
// ================================
 
let LIVE_CONTEXT = null;
 
function validatePrivateKey(key) {
if (!/^0x[0-9a-fA-F]{64}$/.test(String(key || ""))) throw new Error("GMX_PRIVATE_KEY is missing or invalid");
}
 
async function getLiveContext(env) {
if (!executionEnabled(env)) throw new Error("Execution disabled: set Cloudflare ENV EXECUTION_ENABLED=true");
if (!GmxApiSdk || !PrivateKeySigner || !getViemChain) {
  const loaded = await loadGmxSdkSafe();
  if(!loaded || !GmxApiSdk || !PrivateKeySigner || !getViemChain){
    const err=new Error("SDK_UNAVAILABLE");
    err.code="SDK_UNAVAILABLE";
    err.detail=GMX_SDK_LOAD_ERROR || "GMX SDK exports unavailable";
    throw err;
  }
}
validatePrivateKey(env.GMX_PRIVATE_KEY);
if (!env.ARBITRUM_RPC) throw new Error("ARBITRUM_RPC is required");
if (LIVE_CONTEXT && LIVE_CONTEXT.rpc === env.ARBITRUM_RPC) return LIVE_CONTEXT;
 
const signer = new PrivateKeySigner(env.GMX_PRIVATE_KEY, {
rpcUrl: env.ARBITRUM_RPC,
chain: getViemChain(42161)
});
const sdk = new GmxApiSdk({ chainId: 42161 });
LIVE_CONTEXT = { sdk, signer, account: signer.address, rpc: env.ARBITRUM_RPC };
return LIVE_CONTEXT;
}
 
function toBigIntDecimal(value, decimals) {
  const d = Number(decimals);
  if (!Number.isInteger(d) || d < 0 || d > 80) throw new Error(`Invalid decimals: ${decimals}`);
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Invalid decimal value: ${value}`);
    // Numeric values in this engine are IEEE-754 quantities. Values such as
    // 5.7744086 can arrive as 5.774408600000001 even though the intended
    // token amount has exactly 6 decimals. Quantize numeric inputs to the
    // token precision before converting; never reject harmless binary-float
    // residue as if it were real token precision.
    const factor = 10 ** d;
    if (!Number.isSafeInteger(Math.round(Math.abs(value) * factor))) {
      const fixed = value.toFixed(d);
      return toBigIntDecimal(fixed, d);
    }
    return BigInt(Math.round(value * factor));
  }
  let s = String(value ?? "").trim().replace(/,/g, "");
  if (!s) throw new Error("Decimal value is empty");
  if (/e/i.test(s)) {
    const n = Number(s);
    if (!Number.isFinite(n)) throw new Error(`Invalid decimal value: ${value}`);
    s = n.toLocaleString("en-US", {useGrouping:false, maximumFractionDigits:d});
  }
  const negative = s.startsWith("-");
  if (negative) s = s.slice(1);
  if (!/^\d+(?:\.\d+)?$/.test(s)) throw new Error(`Invalid decimal value: ${value}`);
  const [whole, frac=""] = s.split(".");
  if (frac.length > d && /[1-9]/.test(frac.slice(d))) {
    throw new Error(`Decimal precision exceeds ${d}: ${value}`);
  }
  const digits = `${whole}${(frac + "0".repeat(d)).slice(0,d)}`.replace(/^0+(?=\d)/, "") || "0";
  const out = BigInt(digits);
  return negative ? -out : out;
}
 
function liveNormalizeSymbol(symbol) {
if (!symbol) return null;
let s = String(symbol).trim().toUpperCase();
s = s.replace(/[-_/]?(PERP|USD|USDC|USDT)$/i, "");
s = s.replace(/[^A-Z0-9]/g, "");
return s || null;
}

function liveBaseAsset(symbol) {
return liveNormalizeSymbol(symbol)?.replace(/-PERP$/i, "") || null;
}


// V17.3.9 — GMX router allowance hardening + max-approval recovery + recovery telemetry.
function allowanceNumber(value) {
  if (value===null || value===undefined || value==="") return null;
  if (typeof value==="bigint") return value;
  if (typeof value==="number") return Number.isFinite(value)?BigInt(Math.trunc(value)):null;
  if (typeof value==="string") { try { return BigInt(value.trim()); } catch (_) { return null; } }
  if (typeof value==="object") for (const k of ["allowance","amount","value","raw","balance","available","spendable"]) { if(value?.[k]!==undefined){const n=allowanceNumber(value[k]);if(n!==null)return n;} }
  return null;
}
function allowanceEntryForToken(raw, tokenSymbol) {
  const wanted=String(tokenSymbol||"").toUpperCase(), canonical=wanted==="USDC.E"?"USDC":wanted;
  const visit=(v,keyHint="",depth=0)=>{
    if(depth>6||v==null)return null;
    if(Array.isArray(v)){for(const x of v){const n=visit(x,"",depth+1);if(n!==null)return n;}return null;}
    if(typeof v!=="object") return String(keyHint).toUpperCase()===canonical?allowanceNumber(v):null;
    const sym=String(v?.tokenSymbol||v?.symbol||v?.token?.symbol||v?.name||keyHint||"").toUpperCase();
    if(sym===canonical||sym===wanted||(sym==="USDC.E"&&canonical==="USDC")){const n=allowanceNumber(v?.allowance??v?.amount??v?.value??v?.raw);if(n!==null)return n;}
    for(const [k,x] of Object.entries(v)){if([canonical,wanted].includes(String(k).toUpperCase())){const n=allowanceNumber(x);if(n!==null)return n;}const n=visit(x,k,depth+1);if(n!==null)return n;}
    return null;
  }; return visit(raw);
}
const GMX_ARBITRUM_CANONICAL_COLLATERAL = Object.freeze({
  USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  USDT: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9"
});

function tokenAddressFromObject(value, tokenSymbol) {
  const wanted=String(tokenSymbol||"").toUpperCase(), canonical=wanted==="USDC.E"?"USDC":wanted;
  // V17.3.11: never infer Arbitrum GMX USDC from an arbitrary wallet entry.
  // GMX's current SDK v2 order examples explicitly use this contract as USDC
  // collateral on Arbitrum. This prevents USDC/USDC.e symbol collisions.
  if(canonical==="USDC") return GMX_ARBITRUM_CANONICAL_COLLATERAL.USDC;
  const visit=(v,depth=0)=>{
    if(depth>6||v==null)return null;
    if(Array.isArray(v)){for(const x of v){const a=visit(x,depth+1);if(a)return a;}return null;}
    if(typeof v!=="object")return null;
    const sym=String(v?.tokenSymbol||v?.symbol||v?.token?.symbol||v?.name||"").toUpperCase();
    const a=v?.address||v?.tokenAddress||v?.contractAddress||v?.token?.address||v?.token?.tokenAddress;
    if((sym===canonical||sym===wanted||(sym==="USDC.E"&&canonical==="USDC"))&&/^0x[0-9a-fA-F]{40}$/.test(String(a||"")))return String(a);
    for(const x of Object.values(v)){const z=visit(x,depth+1);if(z)return z;} return null;
  }; return visit(value);
}
async function resolveGmxCollateralTokenAddress(sdk,symbol,balances){
  const canonical=String(symbol||"").toUpperCase()==="USDC.E"?"USDC":String(symbol||"").toUpperCase();
  const canonicalAddress=GMX_ARBITRUM_CANONICAL_COLLATERAL[canonical];
  if(canonicalAddress) return canonicalAddress;
  const a=tokenAddressFromObject(balances,symbol); if(a)return a;
  if(typeof sdk.fetchTokens==="function"){const t=await sdk.fetchTokens();const b=tokenAddressFromObject(t,symbol);if(b)return b;}
  return null;
}
async function fetchGmxRouterAllowance(sdk,account,symbol){
  if(typeof sdk.fetchAllowances!=="function") throw new Error("GMX SDK does not expose fetchAllowances");
  const raw=await sdk.fetchAllowances({address:account,spender:"router"});
  const allowance=allowanceEntryForToken(raw,symbol);
  if(allowance===null) throw new Error(`GMX_ROUTER_ALLOWANCE_UNAVAILABLE: token=${symbol}`);
  return {raw,allowance};
}

// V17.3.10: the GMX API allowance endpoint is useful telemetry, but it is not
// authoritative for a latency-critical ERC20 transfer. It can be cached while
// the relay/chain checks the live ERC20 allowance. Read allowance() directly
// from Arbitrum before deciding that approval is sufficient.
async function gmxRpcCall(rpcUrl,method,params=[]){
  if(!rpcUrl) throw new Error("ARBITRUM_RPC_REQUIRED_FOR_ALLOWANCE_VERIFY");
  const response=await fetch(rpcUrl,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:Date.now(),method,params})});
  if(!response.ok) throw new Error(`ARBITRUM_RPC_HTTP_${response.status}`);
  const body=await response.json();
  if(body?.error) throw new Error(`ARBITRUM_RPC_${body.error.code||"ERROR"}: ${body.error.message||"unknown"}`);
  return body?.result;
}
function gmxPadAddress(address){
  const a=String(address||"").toLowerCase();
  if(!/^0x[0-9a-f]{40}$/.test(a)) throw new Error(`INVALID_EVM_ADDRESS: ${address}`);
  return a.slice(2).padStart(64,"0");
}
async function readGmxOnchainAllowance(rpcUrl,tokenAddress,owner,spender){
  const data="0xdd62ed3e"+gmxPadAddress(owner)+gmxPadAddress(spender);
  const raw=await gmxRpcCall(rpcUrl,"eth_call",[{to:tokenAddress,data},"latest"]);
  if(typeof raw!=="string"||!/^0x[0-9a-fA-F]+$/.test(raw)) throw new Error(`ERC20_ALLOWANCE_CALL_INVALID: ${String(raw)}`);
  return BigInt(raw);
}
async function waitForGmxApprovalReceipt(rpcUrl,txHash,attempts=60,intervalMs=1000){
  if(!txHash) throw new Error("GMX_APPROVAL_TX_HASH_MISSING");
  let last=null;
  for(let i=0;i<attempts;i++){
    last=await gmxRpcCall(rpcUrl,"eth_getTransactionReceipt",[txHash]);
    if(last){
      const status=String(last.status||"").toLowerCase();
      if(status==="0x1"||status==="0x01") return {ok:true,receipt:last,polls:i+1};
      if(status==="0x0"||status==="0x00") return {ok:false,receipt:last,polls:i+1};
    }
    if(i+1<attempts) await new Promise(r=>setTimeout(r,intervalMs));
  }
  return {ok:false,receipt:last,polls:attempts,timeout:true};
}
async function waitForGmxRouterAllowance(sdk,account,symbol,required,attempts=30,options={}){
  const rpcUrl=options?.rpcUrl;
  const tokenAddress=options?.tokenAddress;
  const routerAddress=options?.routerAddress;
  if(rpcUrl&&tokenAddress&&routerAddress){
    let last=0n;
    for(let i=0;i<attempts;i++){
      last=await readGmxOnchainAllowance(rpcUrl,tokenAddress,account,routerAddress);
      if(last>=required)return {ok:true,allowance:last,polls:i+1,source:"ONCHAIN"};
      if(i+1<attempts)await new Promise(r=>setTimeout(r,1000));
    }
    return {ok:false,allowance:last,polls:attempts,source:"ONCHAIN"};
  }
  let last=0n;
  for(let i=0;i<attempts;i++){last=(await fetchGmxRouterAllowance(sdk,account,symbol)).allowance;if(last>=required)return {ok:true,allowance:last,polls:i+1,source:"API"};if(i+1<attempts)await new Promise(r=>setTimeout(r,1000));}
  return {ok:false,allowance:last,polls:attempts,source:"API"};
}
async function ensureGmxCollateralAllowance(sdk,signer,account,symbol,requiredAmount,balances,options={}){
  const forceRefresh=Boolean(options?.forceRefresh);
  const required=allowanceNumber(requiredAmount);
  if(required===null||required<=0n)throw new Error("GMX_ALLOWANCE_REQUIRED_AMOUNT_INVALID");

  // GMX SDK v2 deliberately uses the symbolic spender "router" for API reads
  // and for buildApproveTransaction(). We still resolve the actual Router address
  // from the SDK-built approval transaction and verify the ERC20 allowance on-chain.
  const tokenAddress=await resolveGmxCollateralTokenAddress(sdk,symbol,balances);
  if(!tokenAddress)throw new Error(`GMX_COLLATERAL_TOKEN_ADDRESS_UNAVAILABLE: token=${symbol}`);
  const apiBefore=await fetchGmxRouterAllowance(sdk,account,symbol);
  if(typeof sdk.buildApproveTransaction!=="function")
    throw executionStageError("ERC20_APPROVAL",new Error("GMX SDK buildApproveTransaction unavailable"),{token:symbol,tokenAddress,requiredAmount:required.toString()});
  let routerProbe;
  try{
    routerProbe=await sdk.buildApproveTransaction({tokenAddress,spender:"router",amount:0n});
  }catch(error){
    throw executionStageError("ERC20_APPROVAL_BUILD",error,{token:symbol,tokenAddress,requiredAmount:required.toString(),apiAllowanceBefore:apiBefore.allowance.toString()});
  }
  const approvalTokenTarget=routerProbe?.to;
  if(!/^0x[0-9a-fA-F]{40}$/.test(String(approvalTokenTarget||"")))
    throw executionStageError("ERC20_APPROVAL_BUILD",new Error(`GMX_APPROVAL_TOKEN_TARGET_INVALID: ${String(approvalTokenTarget||"")}`),{token:symbol,tokenAddress});
  const decodeApproveSpender=(tx)=>{
    const data=String(tx?.data||"");
    if(!/^0x095ea7b3[0-9a-fA-F]{128}$/.test(data)) return null;
    const raw=`0x${data.slice(10,74)}`;
    const spender=`0x${raw.slice(-40)}`;
    return /^0x[0-9a-fA-F]{40}$/.test(spender)?spender:null;
  };
  const routerAddress=decodeApproveSpender(routerProbe);
  if(!routerAddress)
    throw executionStageError("ERC20_APPROVAL_BUILD",new Error("GMX_APPROVAL_SPENDER_DECODE_FAILED: SDK approval calldata did not contain a standard ERC20 approve(address,uint256) spender"),{token:symbol,tokenAddress,approvalTokenTarget});
  const rpcUrl=options?.rpcUrl;
  const onchainBefore=rpcUrl
    ? await readGmxOnchainAllowance(rpcUrl,tokenAddress,account,routerAddress)
    : apiBefore.allowance;
  const meta={
    token:symbol,
    tokenAddress,
    spender:"router",
    routerAddress,
    spenderResolution:"ERC20_APPROVE_CALLDATA",
    requiredAmount:required.toString(),
    apiAllowanceBefore:apiBefore.allowance.toString(),
    allowanceBefore:onchainBefore.toString(),
    onchainAllowanceBefore:onchainBefore.toString(),
    approved:false,
    approvalTxHash:null,
    allowanceSource:rpcUrl?"ONCHAIN":"GMX_API"
  };

  if(onchainBefore>=required && !forceRefresh)return {...meta,sufficient:true,allowanceAfter:onchainBefore.toString(),polls:0};
  if(forceRefresh){ meta.forceRefresh=true; meta.allowanceWasSufficient=onchainBefore>=required; }

  if(typeof sdk.buildApproveTransaction!=="function")
    throw executionStageError("ERC20_APPROVAL",new Error("GMX SDK buildApproveTransaction unavailable"),meta);
  if(!signer||typeof signer.sendTransaction!=="function")
    throw executionStageError("ERC20_APPROVAL",new Error("GMX signer does not expose sendTransaction"),meta);

  // V17.5.12: an exact collateral approval is not sufficient for every
  // Express increase path. GMX Relay can transfer slightly more than the
  // user-facing collateralToPay amount because of protocol-side accounting
  // and execution-fee handling. Approve the configured Router with the
  // standard uint256 max allowance whenever an approval is needed. This does
  // NOT transfer funds; it only changes ERC20 spending permission.
  const approvalAmount = (1n << 256n) - 1n;
  meta.approvalAmount = approvalAmount.toString();
  meta.approvalMode = forceRefresh ? "MAX_UINT256_RECOVERY" : "MAX_UINT256_STANDARD";

  let approveTx;
  try{
    approveTx=await sdk.buildApproveTransaction({
      tokenAddress,
      spender:"router",
      amount:approvalAmount
    });
    const txTo=approveTx?.to;
    if(!/^0x[0-9a-fA-F]{40}$/.test(String(txTo||"")))
      throw new Error(`GMX_APPROVAL_TX_TARGET_INVALID: ${String(txTo||"")}`);
  }catch(error){
    throw executionStageError("ERC20_APPROVAL_BUILD",error,meta);
  }

  let approvalResult;
  try{
    approvalResult=await signer.sendTransaction({
      to:approveTx.to,
      data:approveTx.data,
      ...(approveTx.value!=null?{value:BigInt(approveTx.value)}:{})
    });
  }catch(error){
    throw executionStageError("ERC20_APPROVAL",error,{...meta,approvalTxTarget:approveTx?.to||null});
  }

  const tx=typeof approvalResult==="string"
    ? approvalResult
    : (approvalResult?.hash||approvalResult?.transactionHash||approvalResult?.txHash||approvalResult?.transaction?.hash||null);

  if(!tx)throw executionStageError("ERC20_APPROVAL",new Error("GMX approval transaction hash was not returned"),{...meta,approvalTxTarget:approveTx?.to||null});
  let receipt=null;
  if(rpcUrl){
    const receiptResult=await waitForGmxApprovalReceipt(rpcUrl,tx,60,1000);
    if(!receiptResult.ok)throw executionStageError("ERC20_APPROVAL_RECEIPT",new Error(receiptResult.timeout?"Approval transaction receipt timed out":"Approval transaction reverted"),{...meta,approvalTxHash:tx,approvalTxTarget:approveTx?.to||null,receipt:receiptResult.receipt||null,receiptPolls:receiptResult.polls});
    receipt=receiptResult.receipt;
  }
  const verified=await waitForGmxRouterAllowance(sdk,account,symbol,required,30,{rpcUrl,tokenAddress,routerAddress});
  if(!verified.ok)throw executionStageError("ERC20_APPROVAL_VERIFY",new Error(`Allowance verification failed: required=${required}, allowance=${verified.allowance}`),{...meta,approvalTxHash:tx,approvalTxTarget:approveTx?.to||null,allowanceAfter:verified.allowance.toString(),polls:verified.polls,source:verified.source,receipt});

  return {...meta,sufficient:true,approved:true,approvalTxHash:tx,approvalTxTarget:approveTx?.to||null,allowanceAfter:verified.allowance.toString(),polls:verified.polls,verificationSource:verified.source,receipt};
}

// V17.3.6 — Cycle-start allowance warmup.
// Runs before the expensive market scan so an approval transaction, when
// genuinely needed, does not occur in the critical entry-execution path.
// The approval target is capped at one position's maximum collateral (20%
// of the currently available wallet collateral), so this does NOT loosen any
// portfolio/risk limit. When allowance is already sufficient, this function
// performs only RPC/API reads and consumes no gas.
async function readGmxOnchainTokenBalance(rpcUrl,tokenAddress,owner,decimals=6){
  if(!rpcUrl||!tokenAddress||!owner) return {ok:false,balance:0,raw:0n};
  const data="0x70a08231"+gmxPadAddress(owner);
  const raw=await gmxRpcCall(rpcUrl,"eth_call",[{to:tokenAddress,data},"latest"]);
  if(typeof raw!=="string"||!/^0x[0-9a-fA-F]+$/.test(raw)) throw new Error(`ERC20_BALANCE_CALL_INVALID: ${String(raw)}`);
  const value=BigInt(raw);
  return {ok:true,balance:Number(value)/(10**decimals),raw:value};
}

async function resolveLiveCollateralBalances(sdk,account,balances,rpcUrl){
  const parsed=extractCollateralBalances(balances);
  const result={USDC:parsed.USDC,USDT:parsed.USDT};
  const source=[];
  if(parsed.USDC?.usd>0) source.push("SDK_USDC");
  if(parsed.USDT?.usd>0) source.push("SDK_USDT");
  if(rpcUrl){
    for(const symbol of ["USDC","USDT"]){
      const address=GMX_ARBITRUM_CANONICAL_COLLATERAL[symbol];
      try{
        const chain=await readGmxOnchainTokenBalance(rpcUrl,address,account,6);
        if(chain.ok){
          const chainUsd=Number(chain.balance);
          // On-chain is authoritative for execution sizing, including zero.
          result[symbol]=chainUsd>0
            ? {symbol,usd:chainUsd,balance:chainUsd,decimals:6,address,source:"ONCHAIN",interpretation:"ERC20_RAW_6_DECIMALS"}
            : null;
          source.push(`ONCHAIN_${symbol}${chainUsd>0?"":"_ZERO"}`);
        }
      }catch(error){
        source.push(`ONCHAIN_${symbol}_ERROR`);
        console.warn("[BALANCE][ONCHAIN_READ_ERROR]",{symbol,error:safeError(error)});
      }
    }
  }
  return {balances:result,source:[...new Set(source)],walletUsd:Object.values(result).reduce((sum,b)=>sum+Number(b?.usd||0),0)};
}

function findSdkMarket(markets, symbol) {
const wanted = liveNormalizeSymbol(symbol);
return markets.find(m => {
if (m?.isSpotOnly) return false;
const raw = String(m?.symbol || m?.name || "");
const base = liveNormalizeSymbol(raw.split("/")[0]);
const indexName = liveNormalizeSymbol(raw.split("/")[0].split("[")[0]);
return base === wanted || indexName === wanted;
}) || null;
}
 
function walletBalanceEntries(balances) {
  const out=[];
  const seen=new Set();
  const visit=(value,keyHint="",depth=0)=>{
    if(value==null || depth>7) return;
    if(Array.isArray(value)){ for(const item of value) visit(item,"",depth+1); return; }
    if(typeof value!=="object") return;
    const symbolHint=String(value?.tokenSymbol||value?.symbol||value?.token?.symbol||value?.asset?.symbol||keyHint||"").toUpperCase();
    const hasBalance=["balance","amount","balanceRaw","rawBalance","tokenBalance","balanceFormatted","balanceHuman","uiAmount","amountFormatted","usdValue","balanceUsd","balanceUSD"].some(k=>value?.[k]!=null);
    const hasTokenIdentity=Boolean(symbolHint || value?.address || value?.tokenAddress || value?.contractAddress || value?.token?.address);
    if(hasBalance && hasTokenIdentity){
      const marker=`${symbolHint}|${String(value?.address||value?.tokenAddress||value?.contractAddress||value?.token?.address||"").toLowerCase()}|${String(value?.balance??value?.amount??value?.balanceRaw??value?.rawBalance??"")}`;
      if(!seen.has(marker)){ seen.add(marker); out.push({value,keyHint}); }
    }
    for(const [k,v] of Object.entries(value)){
      const ku=String(k).toUpperCase();
      if(v && typeof v==="object") visit(v, ku, depth+1);
    }
  };
  visit(balances);
  return out;
}

function tokenNumericBalance(entry) {
  const b=entry?.value||{};
  const decimalsRaw=Number(b?.decimals ?? b?.token?.decimals ?? 6);
  const decimals=Number.isFinite(decimalsRaw)&&decimalsRaw>=0&&decimalsRaw<=36?decimalsRaw:6;
  const explicitUsd=Number(b?.balanceUsd ?? b?.balanceUSD ?? b?.usdValue ?? b?.valueUsd ?? b?.token?.usdValue ?? 0);

  // GMX API wallet responses can expose both a human token quantity and a USD
  // value, while older wrappers may expose explicit raw/base-unit fields.
  // Never divide an already-human `balance` by 10**decimals: that was the
  // V17.5.4 failure that turned ~$28.87 into ~$0.000029.
  const humanCandidates=[
    b?.balanceFormatted,b?.balanceHuman,b?.uiAmount,b?.amountFormatted,
    b?.displayBalance,b?.token?.balanceFormatted
  ];
  let human=humanCandidates.map(Number).find(n=>Number.isFinite(n)&&n>0);
  let interpretation=human>0?"FORMATTED_HUMAN":null;

  if(!(human>0)){
    const rawValue=b?.balanceRaw ?? b?.rawBalance ?? b?.tokenBalance ?? b?.amountRaw;
    if(rawValue!=null){
      const n=Number(rawValue);
      if(Number.isFinite(n)&&n>0){ human=n/(10**decimals); interpretation="EXPLICIT_RAW"; }
    }
  }

  if(!(human>0)){
    const value=b?.balance ?? b?.amount ?? b?.value;
    if(value!=null){
      const text=String(value).trim();
      const n=Number(value);
      if(Number.isFinite(n)&&n>0){
        // If a USD value exists, use it as a scale cross-check. A raw USDC
        // amount will differ from USD by approximately 10**6; an API-human
        // amount will be close to the USD amount.
        if(explicitUsd>0){
          const humanErr=Math.abs(n-explicitUsd)/Math.max(Math.abs(explicitUsd),1e-12);
          const rawConverted=n/(10**decimals);
          const rawErr=Math.abs(rawConverted-explicitUsd)/Math.max(Math.abs(explicitUsd),1e-12);
          if(humanErr<=0.05 && rawErr>humanErr){
            human=n; interpretation="BALANCE_HUMAN_BY_USD";
          } else if(rawErr<=0.05 && humanErr>rawErr){
            human=rawConverted; interpretation="BALANCE_RAW_BY_USD";
          } else {
            human=n; interpretation="BALANCE_HUMAN_DEFAULT";
          }
        } else if(/[.eE]/.test(text) || !Number.isInteger(n)) {
          human=n; interpretation="BALANCE_HUMAN_DECIMAL";
        } else if(n>1_000_000) {
          human=n/(10**decimals); interpretation="BALANCE_RAW_LARGE_INTEGER";
        } else {
          // The v2 wallet endpoint is API-facing; absent an explicit raw field,
          // treat the generic balance as human units rather than silently
          // shrinking a normal $1-$100 wallet by 10**decimals.
          human=n; interpretation="BALANCE_HUMAN_DEFAULT";
        }
      }
    }
  }
  return {usd:explicitUsd>0?explicitUsd:human>0?human:0,balance:human>0?human:0,decimals,interpretation};
}

function extractCollateralBalances(balances) {
  const result={USDC:null,USDT:null};
  for(const entry of walletBalanceEntries(balances)){
    const b=entry.value||{};
    const rawSymbol=String(b?.tokenSymbol||b?.symbol||b?.token?.symbol||b?.asset?.symbol||entry?.keyHint||"").toUpperCase();
    const symbol=rawSymbol.replace(/[^A-Z0-9.]/g,"")==="USDC.E"?"USDC":rawSymbol.replace(/[^A-Z0-9]/g,"");
    if(symbol!=="USDC"&&symbol!=="USDT") continue;
    const address=String(b?.address||b?.tokenAddress||b?.contractAddress||b?.token?.address||b?.token?.tokenAddress||"");
    // USDC is eligible only at the current canonical GMX Arbitrum address.
    if(symbol==="USDC"&&address&&address.toLowerCase()!==GMX_ARBITRUM_CANONICAL_COLLATERAL.USDC.toLowerCase()) continue;
    const parsed=tokenNumericBalance(entry);
    if(!(parsed.usd>0)) continue;
    // V17.5.4: USDC/USDT are USD-denominated collateral tokens. Some SDK/API
    // wrappers expose balanceUsd/valueUsd in a different scale or stale form.
    // For execution sizing, the human token balance is the authoritative USD
    // quantity; on-chain RPC (when available) supersedes this API value below.
    const stableUsd=Number(parsed.balance||0);
    const candidate={symbol,usd:stableUsd,balance:stableUsd,decimals:parsed.decimals,address:address||GMX_ARBITRUM_CANONICAL_COLLATERAL[symbol]||null,source:"GMX_API_STABLECOIN_BALANCE",interpretation:parsed.interpretation||"UNKNOWN"};
    // Prefer the largest positive balance when multiple wrapper entries exist.
    if(!result[symbol] || candidate.usd>Number(result[symbol].usd||0)) result[symbol]=candidate;
  }
  return result;
}


function extractUsdcUsd(balances) {
return Number(extractCollateralBalances(balances)?.USDC?.usd || 0);
}

// V17.3.15 — unified collateral resolution: match GMX markets by symbols OR token addresses.
function marketTextCandidates(market) {
  const out=[];
  const seen=new Set();
  const visit=(value,keyHint="",depth=0)=>{
    if(value==null || depth>7) return;
    if(typeof value === "string" || typeof value === "number") {
      const text=String(value);
      if(text && text.length<=160) {
        const key=String(keyHint||"").toLowerCase();
        if(key.includes("symbol") || key.includes("name") || key.includes("token") || key.includes("collateral") || key.includes("index") || key.includes("market")) out.push(text);
      }
      return;
    }
    if(Array.isArray(value)) { for(const item of value) visit(item,keyHint,depth+1); return; }
    if(typeof value !== "object") return;
    for(const [k,v] of Object.entries(value)) visit(v,k,depth+1);
  };
  visit(market);
  for(const x of [market?.symbol,market?.name,market?.indexName,market?.indexTokenSymbol,market?.longTokenSymbol,market?.shortTokenSymbol,market?.collateralTokenSymbols]) if(x!=null) out.push(String(x));
  return [...new Set(out)];
}

function marketHasTokenAddress(market,address) {
  const wanted=String(address||"").toLowerCase();
  if(!/^0x[0-9a-f]{40}$/.test(wanted)) return false;
  let found=false;
  const visit=(value,depth=0)=>{
    if(found || value==null || depth>8) return;
    if(typeof value === "string") {
      if(value.toLowerCase()===wanted) found=true;
      return;
    }
    if(Array.isArray(value)) { for(const item of value) visit(item,depth+1); return; }
    if(typeof value !== "object") return;
    for(const v of Object.values(value)) visit(v,depth+1);
  };
  visit(market);
  return found;
}

function marketCollateralSymbols(market) {
  const out=new Set();
  // V17.5.2: GMX SDK market metadata may contain native BigInt fields.
  // Never JSON.stringify() SDK market objects directly.
  const raw=jsonStringifySafe(market||{}).toUpperCase();
  if(raw.includes("USDC")) out.add("USDC");
  if(raw.includes("USDT")) out.add("USDT");
  // GMX market/config rows can expose the collateral as explicit long/short
  // token addresses instead of symbols. Address matching is authoritative.
  if(marketHasTokenAddress(market,GMX_ARBITRUM_CANONICAL_COLLATERAL.USDC)) out.add("USDC");
  if(marketHasTokenAddress(market,GMX_ARBITRUM_CANONICAL_COLLATERAL.USDT)) out.add("USDT");
  return out;
}

function marketHasCanonicalCollateral(market, collateralSymbol) {
  const canonical=String(collateralSymbol||"").toUpperCase();
  const address=GMX_ARBITRUM_CANONICAL_COLLATERAL[canonical];
  if(!address) return false;
  if(marketHasTokenAddress(market,address)) return true;
  // Explicit token-address fields are checked separately so this remains
  // resilient even when a future SDK object stops serializing nested tokens.
  const explicit=[
    market?.longTokenAddress, market?.shortTokenAddress,
    market?.longToken?.address, market?.shortToken?.address,
    market?.longToken?.tokenAddress, market?.shortToken?.tokenAddress,
    market?.longToken?.contractAddress, market?.shortToken?.contractAddress
  ].filter(Boolean).map(String).map(x=>x.toLowerCase());
  return explicit.includes(String(address).toLowerCase());
}

function marketMatchesRequestedSymbol(market,wanted) {
  const targets=[market?.symbol,market?.name,market?.indexName,market?.indexTokenSymbol,market?.ticker,market?.marketSymbol].filter(Boolean).map(String);
  for(const raw of targets) {
    const normalized=liveNormalizeSymbol(raw);
    if(normalized===wanted) return true;
    const pieces=raw.split(/[\/:[\](),|_-]+/).map(x=>liveNormalizeSymbol(x)).filter(Boolean);
    if(pieces.includes(wanted)) return true;
    if(liveNormalizeSymbol(raw.split("/")[0].split("[")[0])===wanted) return true;
  }
  return false;
}

function findSdkMarketWithCollateral(markets, symbol, collateralSymbol) {
  const wanted=liveNormalizeSymbol(symbol);
  const collateral=String(collateralSymbol||"").toUpperCase();
  const matches=(markets||[]).filter(m=>!m?.isSpotOnly && marketMatchesRequestedSymbol(m,wanted));
  const exact=matches.find(m=>marketHasCanonicalCollateral(m,collateral) || marketCollateralSymbols(m).has(collateral));
  if(exact) return exact;
  // If the SDK returned exactly one non-spot market for the requested index and
  // omitted token metadata entirely, preserve the previous safe single-market fallback.
  return matches.length===1 && marketCollateralSymbols(matches[0]).size===0 ? matches[0] : null;
}

function selectLiveCollateral(markets, symbol, balances) {
  const available=extractCollateralBalances(balances);
  const diagnostics=[];
  for (const preferred of ["USDC","USDT"]) {
    const bal=available[preferred];
    if (!(bal?.usd>0)) continue;
    const market=findSdkMarketWithCollateral(markets,symbol,preferred);
    if (market) return {symbol:preferred,usd:bal.usd,balance:bal.balance,decimals:bal.decimals,address:bal.address||GMX_ARBITRUM_CANONICAL_COLLATERAL[preferred],market,source:bal.source||"UNKNOWN",interpretation:bal.interpretation||"UNKNOWN"};
    diagnostics.push(`${preferred}:NO_MARKET_COLLATERAL_MATCH`);
  }
  return null;
}

// V17.5.1 EXECUTION MARKET RESOLVER
// The scanner may discover a newly listed / synthetic market from the GMX
// Oracle/API catalog before the SDK market-label cache exposes the same symbol.
// Never manufacture a market label. Resolve the canonical GMX market address
// from SDK market-info/config, then ask fetchMarketsTickers({addresses}) for the
// exact order symbol accepted by SDK v2 prepareOrder().
function marketFieldTextCandidates(value) {
  const out=[];
  const visit=(v,keyHint="",depth=0)=>{
    if(v==null || depth>8) return;
    if(typeof v==="string" || typeof v==="number") {
      const k=String(keyHint||"").toLowerCase();
      if(k.includes("symbol")||k.includes("name")||k.includes("index")||k.includes("market")||k.includes("token")) out.push(String(v));
      return;
    }
    if(Array.isArray(v)){for(const x of v)visit(x,keyHint,depth+1);return;}
    if(typeof v!=="object")return;
    for(const [k,x] of Object.entries(v))visit(x,k,depth+1);
  };
  visit(value);
  return [...new Set(out)];
}

function marketAddressCandidates(value) {
  const out=[];
  const visit=(v,keyHint="",depth=0)=>{
    if(v==null || depth>8) return;
    if(typeof v==="string") {
      const k=String(keyHint||"").toLowerCase();
      if((k.includes("market")||k.includes("address")) && /^0x[0-9a-fA-F]{40}$/.test(v)) out.push(v);
      return;
    }
    if(Array.isArray(v)){for(const x of v)visit(x,keyHint,depth+1);return;}
    if(typeof v!=="object")return;
    for(const [k,x] of Object.entries(v))visit(x,k,depth+1);
  };
  visit(value);
  return [...new Set(out.map(x=>x.toLowerCase()))];
}

function marketIndexMatches(market,wanted) {
  if(!market || !wanted) return false;
  if(marketMatchesRequestedSymbol(market,wanted)) return true;
  return marketFieldTextCandidates(market).some(v=>liveNormalizeSymbol(v)===wanted || String(v).toUpperCase().split(/[\/:[\](),|_-]+/).some(x=>liveNormalizeSymbol(x)===wanted));
}

async function resolveLiveCollateralForSignal(sdk, markets, symbol, balances) {
  // V17.5.10: resolver hardening. Do not assume the first market-info/config
  // row is the complete source of truth. GMX v2 exposes the market catalog,
  // raw market info, config and tickers as separate read surfaces.
  const direct=selectLiveCollateral(markets,symbol,balances);
  if(direct) return {...direct,resolution:"SDK_MARKETS"};

  const available=extractCollateralBalances(balances);
  const wanted=liveNormalizeSymbol(symbol);
  if(!wanted) return null;

  let infos=[];
  let configs=[];
  try { if(typeof sdk.fetchMarketsInfo==="function") infos=await sdk.fetchMarketsInfo(); } catch(e) { console.warn("[EXECUTION][MARKET_INFO_FALLBACK]",safeError(e)); }
  try { if(typeof sdk.fetchMarketsConfig==="function") configs=await sdk.fetchMarketsConfig(); } catch(e) { console.warn("[EXECUTION][MARKET_CONFIG_FALLBACK]",safeError(e)); }

  const rows=[...(Array.isArray(infos)?infos:[]),...(Array.isArray(configs)?configs:[])];
  const matchingRows=rows.filter(m=>marketIndexMatches(m,wanted));

  // First resolve by the canonical collateral address from every matching row.
  // SATS/USD is a WBTC-USDC market, so the pool must not be hard-coded to WETH-USDC.
  for(const row of matchingRows) {
    const addresses=[...new Set([...marketAddressCandidates(row), ...marketAddressCandidates(row?.market)])];
    for(const preferred of ["USDC","USDT"]) {
      const bal=available[preferred];
      if(!(bal?.usd>0)) continue;
      if(!(marketHasCanonicalCollateral(row,preferred) || marketCollateralSymbols(row).has(preferred))) continue;

      let exact=addresses.map(a=>(markets||[]).find(m=>String(m?.marketTokenAddress||m?.marketAddress||m?.address||"").toLowerCase()===a)).find(Boolean)||null;
      if(!exact && addresses.length && typeof sdk.fetchMarketsTickers==="function") {
        try {
          const tickers=await sdk.fetchMarketsTickers({addresses:[addresses[0]]});
          const t=Array.isArray(tickers)?tickers.find(x=>String(x?.marketTokenAddress||x?.marketAddress||"").toLowerCase()===addresses[0]) || tickers[0]:null;
          if(t?.symbol) exact={...row,...t,marketTokenAddress:t.marketTokenAddress||addresses[0]};
        } catch(e) { console.warn("[EXECUTION][MARKET_TICKER_RESOLVE]",safeError(e)); }
      }
      if(exact && !exact.isSpotOnly) {
        return {symbol:preferred,usd:bal.usd,balance:bal.balance,decimals:bal.decimals,address:bal.address||GMX_ARBITRUM_CANONICAL_COLLATERAL[preferred],market:exact,resolution:"SDK_MARKETS_INFO_ADDRESS",source:bal.source||"UNKNOWN",interpretation:bal.interpretation||"UNKNOWN"};
      }
    }
  }

  // Last SDK-native fallback: fetch the complete ticker catalog and match by
  // the exact market name/pool. This catches cases where /markets and
  // /markets/info expose slightly different shapes or caches.
  if(typeof sdk.fetchMarketsTickers==="function") {
    try {
      const tickers=await sdk.fetchMarketsTickers();
      for(const ticker of (Array.isArray(tickers)?tickers:[])) {
        if(ticker?.isSpotOnly) continue;
        if(!marketMatchesRequestedSymbol(ticker,wanted)) continue;
        for(const preferred of ["USDC","USDT"]) {
          const bal=available[preferred];
          if(!(bal?.usd>0)) continue;
          if(!(marketHasCanonicalCollateral(ticker,preferred) || marketCollateralSymbols(ticker).has(preferred))) continue;
          const address=String(ticker?.marketTokenAddress||ticker?.marketAddress||ticker?.address||"").toLowerCase();
          const base=(markets||[]).find(m=>String(m?.marketTokenAddress||m?.marketAddress||m?.address||"").toLowerCase()===address);
          const market=base ? {...base,...ticker} : ticker;
          if(market?.symbol) {
            return {symbol:preferred,usd:bal.usd,balance:bal.balance,decimals:bal.decimals,address:bal.address||GMX_ARBITRUM_CANONICAL_COLLATERAL[preferred],market,resolution:"SDK_MARKETS_TICKER_FALLBACK",source:bal.source||"UNKNOWN",interpretation:bal.interpretation||"UNKNOWN"};
          }
        }
      }
    } catch(e) { console.warn("[EXECUTION][MARKET_TICKER_CATALOG_FALLBACK]",safeError(e)); }
  }

  return null;
}
 
function liveExecutionKey(signal) {
const entry = Number(signal?.tradePlan?.entry ?? signal?.price ?? 0);
const stop = Number(signal?.tradePlan?.stopLoss ?? 0);
const tp = Number(signal?.tradePlan?.tp1 ?? 0);
return ["LIVE",liveBaseAsset(signal?.symbol || ""),signal?.direction || "NO_TRADE",signal?.signalTier || signal?.status || "UNKNOWN",Number.isFinite(entry) ? entry.toPrecision(10) : "na",Number.isFinite(stop) ? stop.toPrecision(10) : "na",Number.isFinite(tp) ? tp.toPrecision(10) : "na"].join("|");
}

async function acquireLiveExecutionLock(env, signal) {
const key = liveExecutionKey(signal);
if (INFLIGHT.has(key)) return { acquired:false, reason:"Execution already in progress", key };
INFLIGHT.set(key, Date.now());
try {
if (env.BOT_STATE) {
const existing = await env.BOT_STATE.get(`live_exec:${key}`, "json");
if (existing && (existing.status === "submitted" || (existing.status === "inflight" && Date.now() - Number(existing.at || 0) < 10 * 60 * 1000))) {
INFLIGHT.delete(key);
return { acquired:false, reason:"Duplicate live execution blocked", key, existing };
}
await env.BOT_STATE.put(`live_exec:${key}`, JSON.stringify({status:"inflight",at:Date.now(),symbol:signal?.symbol,direction:signal?.direction}), { expirationTtl: 600 });
}
return { acquired:true, key };
} catch (error) {
INFLIGHT.delete(key);
throw error;
}
}

function releaseLiveExecutionLock(key) { if (key) INFLIGHT.delete(key); }

async function markLiveExecutionSubmitted(env, key, signal, result) {
  if (!env?.BOT_STATE || !key) return;
  await env.BOT_STATE.put(`live_exec:${key}`, JSON.stringify({
    status:"submitted", at:Date.now(), symbol:signal?.symbol, direction:signal?.direction, requestId:result?.requestId || null
  }), { expirationTtl: 86400 });
}

async function clearLiveExecutionLock(env, key) {
  if (!env?.BOT_STATE || !key) return;
  try { await env.BOT_STATE.delete(`live_exec:${key}`); } catch (_) {}
}


function radarLiveLedgerKey(symbol) {
return `radar_live:${liveBaseAsset(liveNormalizeSymbol(symbol))}`;
}

async function loadRadarLiveLedger(env) {
if (!env.BOT_STATE) return {};
const data = await env.BOT_STATE.get("radar_live_ledger", "json");
return data && typeof data === "object" ? data : {};
}

async function saveRadarLiveLedger(env, ledger) {
if (!env.BOT_STATE) return;
await env.BOT_STATE.put("radar_live_ledger", JSON.stringify(ledger || {}), { expirationTtl: CONFIG.RADAR_LIVE_LEDGER_TTL_SEC });
}

function v156BuildRadarLiveTradePlan(candidate) {
  const radar=candidate?.pumpRadar||{};
  const market=candidate?.market||{};
  const price=Number(market?.price??market?.markPrice??market?.indexPrice??market?.currentPrice??market?.indexPriceUsd);
  const direction=String(radar?.direction||"").toUpperCase();
  const score=Number(radar?.score||0);
  const priceStatus=String(radar?.priceDataStatus||"INVALID").toUpperCase();
  if(!(price>0)||!["LONG","SHORT"].includes(direction)||priceStatus==="INVALID"){
    return {valid:false,reason:"radar_entry_gate_not_met"};
  }
  const velocity=Math.abs(Number(radar?.velocity5m||0));
  const acceleration=Math.abs(Number(radar?.acceleration5m||0));
  const edge=Number(radar?.edge||0);
  const early=CONFIG.RADAR_EARLY_ENTRY_ENABLED &&
    score>=Number(CONFIG.RADAR_EARLY_ENTRY_SCORE||60) &&
    edge>=Number(CONFIG.RADAR_EARLY_ENTRY_MIN_EDGE||8) &&
    Boolean(radar?.valid5mSample) &&
    (velocity>=Number(CONFIG.RADAR_EARLY_ENTRY_MIN_VELOCITY||0.75)||acceleration>=0.35) &&
    radar?.timingState==="EARLY_FAST";
  if(score<Number(CONFIG.RADAR_ENTRY_SCORE||72) && !early){
    return {valid:false,reason:"radar_entry_gate_not_met"};
  }
  const high=Number(market?.high24h??market?.highPrice24h??market?.dailyHigh);
  const low=Number(market?.low24h??market?.lowPrice24h??market?.dailyLow);
  const rangePct=price>0&&high>0&&low>0?((high-low)/price)*100:0;
  const stopPct=Math.max(Number(CONFIG.RADAR_STOP_MIN_PERCENT||0.5),
    Math.min(Number(CONFIG.RADAR_STOP_MAX_PERCENT||4),
      rangePct>0?rangePct*0.12:Number(CONFIG.RADAR_STOP_MIN_PERCENT||0.5)));
  const riskDistance=price*stopPct/100;
  const long=direction==="LONG";
  const stopLoss=long?price-riskDistance:price+riskDistance;
  const tp1=long?price+riskDistance*CONFIG.RADAR_TP_R.tp1:price-riskDistance*CONFIG.RADAR_TP_R.tp1;
  const tp2=long?price+riskDistance*CONFIG.RADAR_TP_R.tp2:price-riskDistance*CONFIG.RADAR_TP_R.tp2;
  const tp3=long?price+riskDistance*CONFIG.RADAR_TP_R.tp3:price-riskDistance*CONFIG.RADAR_TP_R.tp3;
  let leverage=1;
  for(const tier of CONFIG.RADAR_LEVERAGE_TIERS||[]){
    if(score>=Number(tier.minScore)) leverage=Math.max(leverage,Number(tier.leverage));
  }
  leverage=Math.max(1,Math.min(Number(CONFIG.MAX_LEVERAGE||1),leverage));
  return {
    valid:true,entry:Number(price.toFixed(8)),stopLoss:Number(stopLoss.toFixed(8)),
    tp1:Number(tp1.toFixed(8)),tp2:Number(tp2.toFixed(8)),tp3:Number(tp3.toFixed(8)),
    stopPercent:Number(stopPct.toFixed(4)),leverage,
    allocation:CONFIG.RADAR_CAPITAL_ALLOCATION,
    riskPerTradePercent:Number((CONFIG.RADAR_RISK_PER_TRADE*100).toFixed(2)),
    score,direction,method:"RADAR-PRICE-RANGE-R-MULTIPLES"
  };
}

async function executeLiveRadarCandidate(candidate, env) {
if (!executionEnabled(env) || !CONFIG.RADAR_LIVE_ENABLED) {
return { executed: false, mode: "LIVE", lane: "RADAR", reason: "Radar live execution disabled" };
}
const plan = v156BuildRadarLiveTradePlan(candidate);
if (!plan.valid) return { executed:false, mode:"LIVE", lane:"RADAR", reason:plan.reason };
const { sdk, signer, account } = await getLiveContext(env);
const markets = await sdk.fetchMarkets();
const requestedSymbol = candidate?.symbol || candidate?.market?.symbol;
const initialMarket = findSdkMarket(markets, requestedSymbol);
if (!initialMarket) throw new Error(`SDK Radar market not found: ${requestedSymbol || "UNKNOWN"}`);

const ledger = await loadRadarLiveLedger(env);
for (const [k, v] of Object.entries(ledger)) {
if (!v || Date.now() - Number(v.openedAt || 0) > CONFIG.RADAR_LIVE_LEDGER_TTL_SEC * 1000) delete ledger[k];
}
const openRadar = Object.values(ledger).filter(v => v && v.status === "OPEN");
if (openRadar.length >= CONFIG.RADAR_LIVE_MAX_POSITIONS) {
return { executed:false, mode:"LIVE", lane:"RADAR", reason:"Maximum Radar live positions reached" };
}
const symbol = liveNormalizeSymbol(candidate?.symbol || candidate?.market?.symbol || candidate?.market?.name || candidate?.market?.indexTokenSymbol);

if (!symbol) throw new Error("Radar live symbol missing");
const key = radarLiveLedgerKey(symbol);
if (ledger[key]?.status === "OPEN") return { executed:false, mode:"LIVE", lane:"RADAR", reason:"Radar live position already tracked" };

const corePositions = await sdk.fetchPositionsInfo({ address: account });
if (Array.isArray(corePositions)) {
const totalLivePositions = corePositions.filter(pos => Number(pos?.sizeInUsd || pos?.size || 0) > 0).length;
if (totalLivePositions >= CONFIG.MAX_POSITIONS) return { executed:false, mode:"LIVE", lane:"RADAR", reason:`MAX_TOTAL_LIVE_POSITIONS_REACHED: ${totalLivePositions}/${CONFIG.MAX_POSITIONS}` };
const same = corePositions.some(pos => liveBaseAsset(liveNormalizeSymbol(String(pos?.indexName || pos?.symbol || ""))) === liveBaseAsset(symbol));
if (same) return { executed:false, mode:"LIVE", lane:"RADAR", reason:"Symbol already occupied by live portfolio" };
}
const balances = await sdk.fetchWalletBalances({ address: account });
const resolvedBalances = await resolveLiveCollateralBalances(sdk, account, balances, env.ARBITRUM_RPC);
const collateral = await resolveLiveCollateralForSignal(sdk,markets,requestedSymbol,resolvedBalances.balances);
if (!collateral) {
  const candidates=(markets||[]).filter(m=>!m?.isSpotOnly && (marketMatchesRequestedSymbol(m,liveNormalizeSymbol(requestedSymbol)) || marketIndexMatches(m,liveNormalizeSymbol(requestedSymbol)))).slice(0,8).map(m=>({symbol:m?.symbol||m?.name||"?",marketTokenAddress:m?.marketTokenAddress||m?.marketAddress||m?.address||null,collateral:[...marketCollateralSymbols(m)]}));
  throw new Error(`No usable USDC/USDT balance with a matching GMX collateral market was detected for Radar | walletUsd=${Number(resolvedBalances.walletUsd||0).toFixed(6)} | source=${resolvedBalances.source.join("+")||"NONE"} | market=${liveNormalizeSymbol(requestedSymbol)} | sdkMarkets=${Array.isArray(markets)?markets.length:0} | candidates=${JSON.stringify(candidates)}`);
}
const market = collateral.market;
const capacity = await sdk.getTradingCapacity({ symbol: market.symbol, direction: plan.direction === "LONG" ? "long" : "short" });
const capacityUsd = Number(capacity?.availableLiquidity || 0n) / 1e30;
const walletUsd = collateral.usd;

const leverage = Number(plan.leverage || 1);
const collateralTargetUsd = walletUsd * CONFIG.RADAR_LIVE_CAPITAL_ALLOCATION;
const collateralCapUsd = CONFIG.RADAR_LIVE_MAX_POSITION_NOTIONAL_USD / Math.max(leverage, 1);
const collateralUsd = Math.min(collateralTargetUsd, collateralCapUsd, walletUsd * CONFIG.MAX_CAPITAL_ALLOCATION);
const stopFraction = Math.abs(plan.entry - plan.stopLoss) / Math.max(plan.entry, 1e-12);
const riskCapital = walletUsd * CONFIG.RADAR_LIVE_RISK_PER_TRADE;
const riskBasedNotional = stopFraction > 0 ? riskCapital / stopFraction : 0;
const allocationNotional = collateralUsd * leverage;
let notionalUsd = Math.min(allocationNotional, riskBasedNotional, CONFIG.RADAR_LIVE_MAX_POSITION_NOTIONAL_USD, capacityUsd > 0 ? capacityUsd : Number.MAX_SAFE_INTEGER);

// V16.1.5: never invent a minimum order size. The only minimums that may
// block execution are the live GMX market's own minPositionSizeUsd and
// minCollateralUsd, when those values are supplied by the market metadata.
const isHotRadar = Number(plan.score || 0) >= Number(CONFIG.PUMP_RADAR_HOT_SCORE || 72);
const hotMaxWalletRisk = Number(CONFIG.RADAR_HOT_MAX_WALLET_RISK || 0.015);
const hotRiskCapNotional = stopFraction > 0 && hotMaxWalletRisk > 0 ? (walletUsd * hotMaxWalletRisk) / stopFraction : 0;
if (isHotRadar && hotRiskCapNotional > 0) notionalUsd = Math.min(notionalUsd, hotRiskCapNotional);

// Keep collateral consistent with the leveraged notional; never silently
// request more effective leverage than plan.leverage.
const maxCollateralUsd = Math.min(walletUsd * CONFIG.MAX_CAPITAL_ALLOCATION, CONFIG.RADAR_LIVE_MAX_POSITION_NOTIONAL_USD / Math.max(leverage, 1));
if (notionalUsd / Math.max(leverage, 1) > maxCollateralUsd) notionalUsd = maxCollateralUsd * Math.max(leverage, 1);
let finalCollateralUsd = Math.min(maxCollateralUsd, Math.max(collateralUsd, notionalUsd / Math.max(leverage, 1)));
const marketMinPositionUsd = Number(market?.minPositionSizeUsd || 0n) / 1e30;
const marketMinCollateralUsd = Number(market?.minCollateralUsd || 0n) / 1e30;
if (marketMinPositionUsd > 0 && notionalUsd < marketMinPositionUsd) {
  throw new Error(`RADAR_MARKET_MIN_POSITION_BLOCKED: marketMinimum=$${marketMinPositionUsd.toFixed(6)}, computed=$${notionalUsd.toFixed(6)}, wallet=$${walletUsd.toFixed(6)}, stop=${(stopFraction*100).toFixed(2)}%, riskCap=$${hotRiskCapNotional.toFixed(6)}, hot=${isHotRadar}, allocationNotional=$${allocationNotional.toFixed(6)}, riskBasedNotional=$${riskBasedNotional.toFixed(6)}, capacity=$${capacityUsd.toFixed(6)}`);
}
if (marketMinCollateralUsd > 0) {
  if (walletUsd < marketMinCollateralUsd || maxCollateralUsd < marketMinCollateralUsd) {
    throw new Error(`RADAR_MARKET_MIN_COLLATERAL_BLOCKED: marketMinimum=$${marketMinCollateralUsd.toFixed(6)}, wallet=$${walletUsd.toFixed(6)}, maxCollateral=$${maxCollateralUsd.toFixed(6)}, computedNotional=$${notionalUsd.toFixed(6)}`);
  }
  finalCollateralUsd = Math.max(finalCollateralUsd, marketMinCollateralUsd);
}
const size = toBigIntDecimal(notionalUsd, 30);
const collateralAmount = toBigIntDecimal(finalCollateralUsd, 6);
const allowanceInfo=await ensureGmxCollateralAllowance(sdk,signer,account,collateral.symbol,collateralAmount,balances,{rpcUrl:env.ARBITRUM_RPC});
const tp = toBigIntDecimal(plan.tp1, 30);
const sl = toBigIntDecimal(plan.stopLoss, 30);
const signalLike = { symbol, direction: plan.direction, signalTier: "RADAR", tradePlan: { entry: plan.entry, stopLoss: plan.stopLoss, tp1: plan.tp1 } };
const lock = await acquireLiveExecutionLock(env, signalLike);
if (!lock.acquired) return { executed:false, mode:"LIVE", lane:"RADAR", reason:lock.reason, executionKey:lock.key };
try {
const result = await executeGmxOrder(sdk, {
  kind:"increase", symbol:market.symbol, direction:plan.direction === "LONG" ? "long" : "short", orderType:"market",
  size, collateralToken:collateral.symbol, collateralToPay:{amount:collateralAmount,token:collateral.symbol}, mode:"classic", from:account,
  tpsl:[{type:"take-profit",triggerPrice:tp,size},{type:"stop-loss",triggerPrice:sl,size}]
}, signer, {symbol:market.symbol, direction:plan.direction, lane:"RADAR", rpcUrl:env.ARBITRUM_RPC});
ledger[key] = { status:"OPEN", lane:"RADAR", symbol, direction:plan.direction, radarScore:plan.score, radarEdge:Number(candidate?.pumpRadar?.edge || 0), entryPrice:plan.entry, initialStopPrice:plan.stopLoss, tp1:plan.tp1, tp2:plan.tp2, tp3:plan.tp3, leverage, notionalUsd, collateralToken:collateral.symbol, openedAt:Date.now(), requestId:result?.requestId || null };
await saveRadarLiveLedger(env, ledger);
return { executed:true, mode:"LIVE", lane:"RADAR", account, symbol, direction:plan.direction, radarScore:plan.score, radarEdge:Number(candidate?.pumpRadar?.edge || 0), leverage, walletUsd, collateralUsd, collateralToken:collateral.symbol, notionalUsd, riskBasedNotional, hotSizing:isHotRadar, marketMinPositionUsd, marketMinCollateralUsd, allowance:allowanceInfo, requestId:result?.requestId || null, executionKey:lock.key };
} finally { releaseLiveExecutionLock(lock.key); }
}


function formatTelegramExecutionFailure(signal, error, result=null) {
  const symbol = telegramTextSafe(signal?.symbol || result?.symbol || "UNKNOWN");
  const direction = String(signal?.direction || result?.direction || "UNKNOWN").toUpperCase();
  const reason = telegramTextSafe(result?.reason || result?.error || error || "UNKNOWN_EXECUTION_ERROR");
  const tier = telegramTextSafe(signal?.signalTier || signal?.hybridSetup?.tier || "EVENT");
  const p=signal?.tradePlan||{};
  const stage=telegramTextSafe(result?.stage || error?.executionStage || "PRE-EXECUTION");
  return [
    "🔴 LIVE EXECUTION FAILED",
    "━━━━━━━━━━━━━━━━━━",
    `🪙 ${symbol}`,
    `📌 Direction: ${direction}`,
    `🏷️ Tier: ${tier}`,
    `💰 Entry: ${p.entry!=null?safeFormatPrice(p.entry):"N/A"}`,
    `🛑 Stop Loss: ${p.stopLoss!=null?safeFormatPrice(p.stopLoss):"N/A"}`,
    `🎯 TP1: ${p.tp1!=null?safeFormatPrice(p.tp1):"N/A"}`,
    `🎯 TP2: ${p.tp2!=null?safeFormatPrice(p.tp2):"N/A"}`,
    `🎯 TP3: ${p.tp3!=null?safeFormatPrice(p.tp3):"N/A"}`,
    `📊 Allocation: ${Number(p.allocationPercent!=null?p.allocationPercent:Number(p.allocation||0)*100).toFixed(2)}%`,
    `⚙️ Leverage: ${Number(p.leverage||1).toFixed(1)}x`,
    `🔧 Stage: ${stage}`,
    result?.executionMeta?.token ? `🪙 Allowance Token: ${telegramTextSafe(result.executionMeta.token)}` : null,
    result?.executionMeta?.requiredAmount ? `🔐 Allowance Required: ${result.executionMeta.requiredAmount}` : null,
    result?.executionMeta?.allowanceBefore ? `🔐 Allowance Before: ${result.executionMeta.allowanceBefore}` : null,
    result?.executionMeta?.allowanceAfter ? `🔐 Allowance After: ${result.executionMeta.allowanceAfter}` : null,
    result?.executionMeta?.approvalTxHash ? `🧾 Approval Tx: ${result.executionMeta.approvalTxHash}` : null,
    result?.recovery?.attempted ? `🔧 Allowance Recovery: attempted | Retry: ${telegramTextSafe(result.recovery.retryStatus || "unknown")}` : null,
    result?.recovery?.repair?.approvalTxHash ? `🧾 Recovery Approval Tx: ${result.recovery.repair.approvalTxHash}` : null,
    result?.recovery?.repair?.approvalMode ? `🛡️ Recovery Approval Mode: ${telegramTextSafe(result.recovery.repair.approvalMode)}` : null,
    `❌ Reason: ${reason}`,
    `🕐 ${new Date().toISOString()}`,
    `#${symbol} #GMX #ExecutionError`
  ].join("\n");
}

function formatTelegramScanHeartbeat(result, scanId) {
  const stats = result?.eventStats || {};
  const exec = Array.isArray(result?.executionResults) ? result.executionResults : [];
  const executed = exec.filter(x => x?.executed).length;
  const failures = exec.filter(x => x && x.executed === false && (x.error || x.reason)).length;
  const status = String(result?.status || "UNKNOWN");
  const icon = executed > 0 ? "🟢" : result?.candidates > 0 ? "🟡" : "🔵";
  const executedDetails = exec.filter(x => x?.executed).map((x,i) => {
    const dir = String(x?.direction || "UNKNOWN").toUpperCase();
    const icon2 = dir === "LONG" ? "🟢" : dir === "SHORT" ? "🔴" : "⚪";
    const allocation = Number(x?.allocationPercent || (Number(x?.allocation || 0) * 100) || 0);
    return [
      `
${icon2} EXECUTED #${i+1} — ${telegramTextSafe(x?.symbol || "UNKNOWN")}`,
      `📌 Direction: ${dir}`,
      `💰 Entry: ${x?.entryPrice!=null ? safeFormatPrice(x.entryPrice) : "N/A"}`,
      `🛑 SL: ${x?.stopLoss!=null ? safeFormatPrice(x.stopLoss) : "N/A"}`,
      `🎯 TP1: ${x?.tp1!=null ? safeFormatPrice(x.tp1) : "N/A"}`,
      `🎯 TP2: ${x?.tp2!=null ? safeFormatPrice(x.tp2) : "N/A"}`,
      `🎯 TP3: ${x?.tp3!=null ? safeFormatPrice(x.tp3) : "N/A"}`,
      `📊 Allocation: ${allocation.toFixed(2)}% | ⚙️ Leverage: ${Number(x?.leverage || 1).toFixed(1)}x`,
      `📦 Notional: $${Number(x?.notionalUsd || 0).toFixed(2)} | 💵 Collateral: $${Number(x?.collateralUsd || 0).toFixed(2)}`,
      x?.walletBefore?.[String(x?.collateralToken||"").toUpperCase()]!=null ? `💰 Wallet ${x?.collateralToken||"?"}: $${Number(x.walletBefore[String(x.collateralToken||"").toUpperCase()]).toFixed(4)} → $${Number(x?.walletAfter?.[String(x?.collateralToken||"").toUpperCase()]||0).toFixed(4)}` : "💰 Wallet balance: N/A",
      x?.walletDelta!=null ? `📉 Wallet Δ: $${Number(x.walletDelta).toFixed(6)}` : "📉 Wallet Δ: N/A",
      x?.positionVerified ? (x?.settlementVerified ? "✅ Position verified + wallet settlement observed" : "✅ Position verified | settlement still settling") : "⚠️ Order submitted — position verification pending"
    ].join("\n");
  });
  return [
    `${icon} GMX BOT — CYCLE REPORT`,
    "━━━━━━━━━━━━━━━━━━",
    `📡 Status: ${status}`,
    `🪙 Universe: ${Number(result?.scanned || 0)}`,
    `🔎 Broad 5M: ${Number(result?.broad5mScanned || 0)}`,
    `🧠 Deep: ${Number(result?.deepScanned || result?.deepPlanned || 0)}`,
    `⚡ Event candidates: ${Number(result?.eventCandidates || 0)}`,
    result?.allowancePreflight ? `🔐 Allowance preflight: ${result.allowancePreflight.attempted ? (result.allowancePreflight.ok ? "READY" : "ISSUE") : "NOT_RUN"} | Mode ${telegramTextSafe(result.allowancePreflight.mode||"?")} | Wallet $${Number(result.allowancePreflight.walletUsd||0).toFixed(2)} | Src ${telegramTextSafe((result.allowancePreflight.balanceSource||[]).join("+")||"-")} | Approved ${Number(result.allowancePreflight.approved?.length||0)} | Existing ${Number(result.allowancePreflight.sufficient?.length||0)} | Errors ${Number(result.allowancePreflight.errors?.length||0)} | Skip ${telegramTextSafe((result.allowancePreflight.skipped||[]).join(",")||"-")} | ${Number(result.allowancePreflight.elapsedMs||0)}ms` : null,
    `🚀 Early impulses: ${Number(stats.earlyImpulses || 0)}`,
    `🧪 Early debug: A ${Number(stats.earlyDebug?.attempted || 0)} / Q ${Number(stats.earlyDebug?.qualified || 0)} / R ${Number(stats.earlyDebug?.rejected || 0)}`,
    `🧩 Early gates: M ${Number(stats.earlyDebug?.movePass || 0)} | B ${Number(stats.earlyDebug?.bodyPass || 0)} | V ${Number(stats.earlyDebug?.volumePass || 0)} | F ${Number(stats.earlyDebug?.flowPass || 0)} | MA ${Number(stats.earlyDebug?.momentumActivityPass || 0)} | A ${Number(stats.earlyDebug?.accelerationPass || 0)} | Z ${Number(stats.earlyDebug?.zonePass || 0)} | P ${Number(stats.earlyDebug?.proximityPass || 0)} | PB ${Number(stats.earlyDebug?.prebreakPass || 0)} | S ${Number(stats.earlyDebug?.scorePass || 0)} | E ${Number(stats.earlyDebug?.edgePass || 0)}`,
    `🚫 Early reject: Move ${Number(stats.earlyDebug?.MOVE || 0)} / Body ${Number(stats.earlyDebug?.BODY || 0)} / Activity ${Number(stats.earlyDebug?.ACTIVITY || 0)} / Accel ${Number(stats.earlyDebug?.ACCELERATION || 0)} / Ext ${Number(stats.earlyDebug?.EXTENSION || 0)} / Zone ${Number(stats.earlyDebug?.ZONE || 0)} / Pre ${Number(stats.earlyDebug?.PREBREAK || 0)} / Score ${Number(stats.earlyDebug?.SCORE || 0)} / Edge ${Number(stats.earlyDebug?.EDGE || 0)} / Setup ${Number(stats.earlyDebug?.setupRejected || 0)}`,
    `🎯 Entry ready: ${Number(result?.candidates || 0)}`,
    `🟢 Executed: ${executed}`,
    `🔴 Execution failures: ${failures}`,
    ...exec.filter(x => x && x.executed === false && (x.error || x.reason)).slice(0,3).map((x,i) => `❌ FAIL #${i+1}: ${telegramTextSafe(x.symbol||"UNKNOWN")} | ${telegramTextSafe(x.stage||"?")} | ${telegramTextSafe(x.error||x.reason||"UNKNOWN")}`),
    ...executedDetails,
    `📍 Reactions: S ${Number(stats.supportReactions || 0)} / R ${Number(stats.resistanceReactions || 0)}`,
    `💥 Breakouts: ${Number(stats.breakouts || 0)}`,
    `🔁 Retests: ${Number(stats.retestConfirmed || 0)}`,
    `🆔 Scan: ${telegramTextSafe(scanId, "n/a")}`,
    `🕐 ${new Date().toISOString()}`,
    "ℹ️ این گزارش مسیر Scan → Selection → Execution را همراه با جزئیات معامله اجراشده نشان می‌دهد."
  ].join("\n");
}

function formatTelegramLiveExecutionStatus(result) {
  const direction=String(result?.direction||"UNKNOWN").toUpperCase();
  const status=String(result?.status||"unknown").toLowerCase();
  const terminal=status==="executed";
  const icon=terminal?"🟢":(status==="cancelled"||status.includes("failed")||status.includes("reverted")?"🔴":"🟡");
  const token=String(result?.collateralToken||"").toUpperCase();
  const before=Number(result?.walletBefore?.[token]);
  const after=Number(result?.walletAfter?.[token]);
  const response=result?.statusResponse||{};
  const err=result?.statusError || response?.error?.message || response?.cancellationReason || "n/a";
  return [
    `${icon} GMX ORDER STATUS — ${status.toUpperCase()}`,
    "━━━━━━━━━━━━━━━━━━",
    `🪙 ${result?.symbol||"UNKNOWN"}`,
    `📌 Direction: ${direction}`,
    `💵 Collateral: $${Number(result?.collateralUsd||0).toFixed(2)} ${token}`,
    `🧾 Request ID: ${result?.requestId||"n/a"}`,
    `📡 GMX Status: ${status}`,
    `🔎 Polls: ${Number(result?.polls||0)}`,
    `⏱️ Tracking: ${Number(result?.elapsedMs||0)} ms`,
    `💰 Wallet BEFORE: ${Number.isFinite(before)?`$${before.toFixed(4)}`:"N/A"}`,
    `💰 Wallet AFTER: ${Number.isFinite(after)?`$${after.toFixed(4)}`:"N/A"}`,
    `📉 Wallet Δ: ${result?.walletDelta!=null?`$${Number(result.walletDelta).toFixed(6)}`:"N/A"}`,
    response?.txHash ? `🔗 Relay Tx: ${response.txHash}` : null,
    response?.createdTxnHash ? `🧾 Created Tx: ${response.createdTxnHash}` : null,
    response?.executionTxnHash ? `⚡ Execution Tx: ${response.executionTxnHash}` : null,
    response?.taskId ? `🤖 Task ID: ${response.taskId}` : null,
    response?.traceId ? `🧬 Trace ID: ${response.traceId}` : null,
    response?.error?.code ? `🧩 Error Code: ${telegramTextSafe(response.error.code)}` : null,
    response?.error?.message ? `📝 Error Message: ${telegramTextSafe(response.error.message)}` : null,
    response?.reason ? `🔎 Relay Reason: ${telegramTextSafe(response.reason)}` : null,
    response?.revertReason ? `↩️ Revert Reason: ${telegramTextSafe(response.revertReason)}` : null,
    response?.revertData ? `🧱 Revert Data: ${telegramTextSafe(String(response.revertData).slice(0,180))}` : null,
    result?.statusDiagnostic?.submitCode ? `📨 Submit Error Code: ${telegramTextSafe(result.statusDiagnostic.submitCode)}` : null,
    result?.statusDiagnostic?.submitMessage ? `📨 Submit Error: ${telegramTextSafe(result.statusDiagnostic.submitMessage)}` : null,
    result?.statusDiagnostic?.submitTraceId ? `🧬 Submit Trace ID: ${telegramTextSafe(result.statusDiagnostic.submitTraceId)}` : null,
    result?.statusDiagnostic?.preparedTraceId ? `🧬 Prepared Trace ID: ${telegramTextSafe(result.statusDiagnostic.preparedTraceId)}` : null,
    Array.isArray(result?.preparedValidationWarnings) && result.preparedValidationWarnings.length ? `⚠️ Prepare Validation: ${telegramTextSafe(jsonStringifySafe(result.preparedValidationWarnings).slice(0,260))}` : null,
    Array.isArray(result?.preparedWarnings) && result.preparedWarnings.length ? `⚠️ Prepare Warnings: ${telegramTextSafe(jsonStringifySafe(result.preparedWarnings).slice(0,260))}` : null,
    `❌ GMX Reason: ${telegramTextSafe(err)}`,
    terminal ? "🟢 GMX relay reports EXECUTED — verifying on-chain position next." : "❌ No confirmed execution; this is NOT counted as Executed."
  ].filter(Boolean).join("\n");
}

function formatTelegramLiveExecutionPending(result) {
  const direction=String(result?.direction||"UNKNOWN").toUpperCase();
  const icon=direction==="LONG"?"🟡":"🟠";
  const token=String(result?.collateralToken||"").toUpperCase();
  const before=Number(result?.walletBefore?.[token]);
  const after=Number(result?.walletAfter?.[token]);
  return [
    `${icon} GMX ORDER SUBMITTED — VERIFYING`,
    "━━━━━━━━━━━━━━━━━━",
    `🪙 ${result?.symbol||"UNKNOWN"}`,
    `📌 Direction: ${direction}`,
    `💵 Collateral: $${Number(result?.collateralUsd||0).toFixed(2)} ${token}`,
    `💰 Wallet BEFORE: ${Number.isFinite(before)?`$${before.toFixed(4)}`:"N/A"}`,
    `💰 Wallet AFTER: ${Number.isFinite(after)?`$${after.toFixed(4)}`:"N/A"}`,
    `📉 Wallet Δ: ${result?.walletDelta!=null?`$${Number(result.walletDelta).toFixed(6)}`:"N/A"}`,
    `🧾 Request ID: ${result?.requestId||"n/a"}`,
    "⚠️ Order was submitted, but the GMX position could not yet be verified.",
    "❌ This is NOT counted as Executed in the cycle report."
  ].join("\n");
}

function formatTelegramLiveEntry(result) {
  const direction=String(result?.direction||"UNKNOWN").toUpperCase();
  const icon=direction==="LONG"?"🟢":"🔴";
  const verified=!!result?.positionVerified;
  return [
    `${icon} LIVE ENTRY — ${direction}`,
    "━━━━━━━━━━━━━━━━━━",
    `🪙 ${result?.symbol||"UNKNOWN"}`,
    result?.entryEngine ? `🧠 Entry Engine: ${result.entryEngine}` : null,
    result?.eventStrength!=null ? `⚡ Event Strength: ${Number(result.eventStrength).toFixed(1)}/100 (telemetry only)` : `⚡ Confidence: ${Number(result?.confidence||0).toFixed(0)}%`,
    `💰 Entry: ${result?.entryPrice!=null?safeFormatPrice(result.entryPrice):"N/A"}`,
    `🛑 Stop Loss: ${result?.stopLoss!=null?safeFormatPrice(result.stopLoss):"N/A"}`,
    `🎯 TP1: ${result?.tp1!=null?safeFormatPrice(result.tp1):"N/A"}`,
    `🎯 TP2: ${result?.tp2!=null?safeFormatPrice(result.tp2):"N/A"}`,
    `🎯 TP3: ${result?.tp3!=null?safeFormatPrice(result.tp3):"N/A"}`,
    `📊 Allocation: ${Number(result?.allocationPercent||0).toFixed(2)}%`,
    `⚙️ Leverage: ${Number(result?.leverage||1).toFixed(1)}x`,
    `📦 Notional: $${Number(result?.notionalUsd||0).toFixed(2)}`,
    `💵 Collateral: $${Number(result?.collateralUsd||0).toFixed(2)} ${result?.collateralToken||""}`,
    `💰 Wallet BEFORE: ${Number(result?.walletBefore?.[String(result?.collateralToken||"").toUpperCase()]).toFixed(4)}`,
    `💰 Wallet AFTER: ${Number(result?.walletAfter?.[String(result?.collateralToken||"").toUpperCase()]).toFixed(4)}`,
    `📉 Wallet Δ: ${result?.walletDelta!=null?Number(result.walletDelta).toFixed(6):"N/A"}`,
    result?.accounting?.walletDebitUsd!=null ? `💸 Observed Debit: $${Number(result.accounting.walletDebitUsd).toFixed(6)}` : null,
    result?.accounting?.observedExtraDebitUsd!=null ? `🧾 Extra Debit vs Collateral: $${Number(result.accounting.observedExtraDebitUsd).toFixed(6)}` : null,
    result?.accounting?.positionCollateralUsd!=null ? `📌 GMX Position Collateral: $${Number(result.accounting.positionCollateralUsd).toFixed(6)}` : null,
    ...feeTelemetryDisplayLines(result),
    `🧾 Request ID: ${result?.requestId||"n/a"}`,
    verified ? (result?.settlementVerified ? "✅ GMX POSITION VERIFIED + WALLET SETTLEMENT OBSERVED" : "✅ GMX POSITION VERIFIED | WALLET SETTLEMENT STILL SETTLING") : "⚠️ GMX ORDER ACCEPTED — POSITION VERIFICATION PENDING",
    "ℹ️ Extra Debit is observed wallet movement beyond requested collateral; it is not assumed to be a fee unless GMX/SDK reports it as such."
  ].filter(Boolean).join("\n");
}

async function verifyLiveEntryPosition(sdk, account, sdkSymbol, direction, attempts=2) {
  for(let i=0;i<attempts;i++) {
    try {
      const positions=await sdk.fetchPositionsInfo({address:account});
      if(Array.isArray(positions)) {
        const wanted=String(sdkSymbol||"").toUpperCase();
        const wantLong=direction==="long";
        const found=positions.find(p=>{
          const ps=String(p?.indexName||p?.symbol||"").toUpperCase();
          return ps.includes(wanted.split("/")[0]) && Boolean(p?.isLong)===wantLong && Number(p?.sizeInUsd||0)>0;
        });
        if(found) return {verified:true,position:found};
      }
    } catch(_) {}
    if(i+1<attempts) await new Promise(resolve=>setTimeout(resolve,500));
  }
  return {verified:false,position:null};
}

// V16.0.4: Module-scope live position-size bridge.
// calculatePositionSize historically lived inside FUTURES_V6, while the live
// execution pipeline runs at module scope after that IIFE closes. Keep the
// exact risk-based sizing formula available to live execution without changing
// the strict execution gate or the paper-trading implementation.
function calculatePositionSize(balance, entry, stopLoss) {
  if (!(Number(balance) > 0) || !(Number(entry) > 0) || !(Number(stopLoss) > 0)) return 0;
  const riskCapital = Number(balance) * CONFIG.RISK_PER_TRADE;
  const stopPercent = Math.abs(Number(entry) - Number(stopLoss)) / Number(entry);
  if (!(stopPercent > 0) || !Number.isFinite(stopPercent)) return 0;
  const notional = riskCapital / stopPercent;
  return Number.isFinite(notional) && notional > 0 ? notional : 0;
}

function executionStageError(stage, error, meta = {}) {
  const message = safeError(error);
  const e = new Error(`EXECUTION_${stage}_FAILED: ${message}`);
  e.executionStage = stage;
  e.causeMessage = message;
  e.executionMeta = meta;
  return e;
}

// V17.5.13: capture fee/cost fields exposed by GMX prepare/submit responses.
// The SDK has changed response shapes across releases, so this telemetry is
// deliberately schema-tolerant and never serializes native BigInt directly.
function feeTelemetryValue(value, key = "") {
  const k = String(key || "").toLowerCase();
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") {
    const raw = value.toString();
    return k.includes("usd") ? { raw, usd: gmxUsdHumanNumber(raw) } : { raw };
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return k.includes("usd") ? { raw: value, usd: gmxUsdHumanNumber(value) } : { raw: value };
  }
  if (typeof value === "string") {
    if (k.includes("usd") && /^-?\d+(?:\.\d+)?$/.test(value.trim())) return { raw:value, usd:gmxUsdHumanNumber(value.trim()) };
    return { raw:value };
  }
  return null;
}

function collectGmxFeeTelemetry(...sources) {
  const out = {};
  const seen = new WeakSet();
  let nodes = 0;
  const visit = (value, path = "", depth = 0) => {
    if (value == null || depth > 7 || nodes++ > 600) return;
    if (typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.slice(0, 50).forEach((v,i)=>visit(v, `${path}[${i}]`, depth+1));
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      const childPath = path ? `${path}.${key}` : key;
      const lower = key.toLowerCase();
      if (/(fee|cost|gas)/i.test(key) && (typeof child !== "object" || child === null)) {
        const item = feeTelemetryValue(child, key);
        if (item) {
          const bucket = lower.includes("position") && lower.includes("fee") ? "positionFee"
            : lower.includes("execution") && lower.includes("fee") ? "executionFee"
            : lower.includes("relay") && lower.includes("fee") ? "relayFee"
            : lower.includes("swap") && lower.includes("fee") ? "feeSwap"
            : lower.includes("gas") ? "gas"
            : lower.includes("fee") ? "fee" : "cost";
          if (!out[bucket]) out[bucket] = [];
          if (out[bucket].length < 12) out[bucket].push({ key: childPath, ...item });
        }
      }
      if (typeof child === "object" && child !== null) visit(child, childPath, depth+1);
    }
  };
  sources.forEach(src=>visit(src));
  return Object.keys(out).length ? out : null;
}

function feeTelemetryDisplayLines(result) {
  const f = result?.feeTelemetry || {};
  const lines = [];
  const add = (label,bucket) => {
    const rows=Array.isArray(f[bucket])?f[bucket]:[];
    if(!rows.length)return;
    const shown=rows.slice(0,3).map(x=>x?.usd!=null&&Number.isFinite(Number(x.usd))?`$${Number(x.usd).toFixed(6)}`:String(x?.raw??"reported")).join(" | ");
    lines.push(`💳 ${label}: ${shown}`);
  };
  add("Position fee","positionFee");
  add("Execution fee","executionFee");
  add("Relay fee","relayFee");
  add("Fee swap","feeSwap");
  add("Gas/cost","gas");
  add("Other fee","fee");
  return lines;
}

function buildObservedWalletAccounting(result) {
  const token=String(result?.collateralToken||"").toUpperCase();
  const before=Number(result?.walletBefore?.[token]);
  const after=Number(result?.walletAfter?.[token]);
  const delta=Number(result?.walletDelta);
  const walletDebitUsd=Number.isFinite(delta)?Math.max(0,-delta):null;
  const collateralUsd=Number(result?.collateralUsd);
  const observedExtraDebitUsd=Number.isFinite(walletDebitUsd)&&Number.isFinite(collateralUsd)?Math.max(0,walletDebitUsd-collateralUsd):null;
  const position=result?.position||null;
  const positionCollateralUsd=position?gmxUsdHumanNumber(position?.collateralUsd??position?.collateralValueUsd??position?.initialCollateralUsd):null;
  return { token, before:Number.isFinite(before)?before:null, after:Number.isFinite(after)?after:null, netDelta:Number.isFinite(delta)?delta:null, walletDebitUsd, collateralUsd:Number.isFinite(collateralUsd)?collateralUsd:null, observedExtraDebitUsd, positionCollateralUsd:Number.isFinite(positionCollateralUsd)&&positionCollateralUsd>0?positionCollateralUsd:null };
}

async function executeGmxOrder(sdk, request, signer, meta = {}) {
  let prepared;
  try {
    prepared = await sdk.prepareOrder(request);
  } catch (error) {
    throw executionStageError("PREPARE", error, meta);
  }

  // V17.6.0: CLASSIC is the only live execution transport.
  // GMX SDK v2 returns an on-chain transaction for mode=classic; there is
  // no signOrder()/submitOrder()/GMX Relay step. The transaction's value is
  // the execution fee paid in ETH on Arbitrum.
  if (String(request?.mode || prepared?.mode || "").toLowerCase() === "classic") {
    if (prepared?.payloadType !== "transaction" || !prepared?.payload?.to || !prepared?.payload?.data) {
      throw executionStageError("CLASSIC_PREPARE", new Error("GMX_CLASSIC_TRANSACTION_PAYLOAD_MISSING"), meta);
    }
    let txHash;
    try {
      txHash = await signer.sendTransaction({
        to: prepared.payload.to,
        data: prepared.payload.data,
        value: BigInt(prepared.payload.value ?? 0),
      });
    } catch (error) {
      throw executionStageError("CLASSIC_SEND", error, {
        ...meta,
        requestId: prepared?.requestId || null,
        executionFeeWei: String(prepared?.payload?.value ?? 0),
        preparedEstimates: prepared?.estimates || null,
      });
    }
    const receiptResult = await waitClassicReceipt(meta?.rpcUrl || null, typeof txHash === "string" ? txHash : (txHash?.hash || txHash?.transactionHash || null), 120000, 2500);
    const receipt = receiptResult?.receipt || null;
    const receiptStatus = receipt ? (String(receipt.status || "").toLowerCase() === "0x1" ? "classic_confirmed" : "classic_reverted") : "classic_pending";
    return {
      requestId: prepared?.requestId || null,
      status: receiptStatus,
      mode: "classic",
      txHash: typeof txHash === "string" ? txHash : (txHash?.hash || txHash?.transactionHash || null),
      transactionHash: typeof txHash === "string" ? txHash : (txHash?.hash || txHash?.transactionHash || null),
      receipt,
      receiptAvailable: Boolean(receipt),
      receiptTimedOut: Boolean(receiptResult?.timedOut),
      preparedTraceId: prepared?.traceId || null,
      preparedExpiresAt: prepared?.expiresAt || null,
      preparedWarnings: Array.isArray(prepared?.warnings) ? prepared.warnings : [],
      preparedValidationWarnings: Array.isArray(prepared?.validationWarnings) ? prepared.validationWarnings : [],
      preparedEstimates: prepared?.estimates || null,
      classicPayload: {
        to: prepared.payload.to,
        data: prepared.payload.data,
        value: String(prepared.payload.value ?? 0),
      },
      feeTelemetry: collectGmxFeeTelemetry(prepared, prepared?.payload, null, null),
    };
  }

  throw executionStageError("EXECUTION_MODE", new Error("LIVE_EXECUTION_REQUIRES_CLASSIC_MODE"), meta);
}

function classicCostHuman(value, decimals) {
  try {
    const n = typeof value === "bigint" ? Number(value) : Number(value || 0);
    if (!Number.isFinite(n)) return null;
    return n / (10 ** Number(decimals));
  } catch (_) { return null; }
}

async function rpcJson(rpcUrl, method, params = []) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const data = await response.json();
  if (!response.ok || data?.error) throw new Error(data?.error?.message || `RPC_${method}_FAILED`);
  return data?.result;
}

async function waitClassicReceipt(rpcUrl, txHash, timeoutMs = 120000, intervalMs = 2500) {
  if (!rpcUrl || !txHash) return { available:false, timedOut:false, receipt:null };
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const receipt = await rpcJson(rpcUrl, "eth_getTransactionReceipt", [txHash]);
      if (receipt) return { available:true, timedOut:false, receipt };
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  return { available:false, timedOut:true, receipt:null };
}

async function classicCostProbe(sdk, env, params = {}) {
  const account = String(params.account || "0x0000000000000000000000000000000000000000");
  const symbol = String(params.symbol || "ETH/USD [WETH-USDC]");
  const direction = String(params.direction || "long").toLowerCase() === "short" ? "short" : "long";
  const sizeUsd = Math.max(1, Number(params.sizeUsd || 5));
  const collateralUsd = Math.max(0.01, Number(params.collateralUsd || Math.max(1, sizeUsd / 5)));
  const size = toBigIntDecimal(sizeUsd, 30);
  const collateralAmount = toBigIntDecimal(collateralUsd, 6);
  const prepared = await sdk.prepareOrder({
    kind:"increase", symbol, direction, orderType:"market", size,
    collateralToken:String(params.collateralToken || "USDC"),
    collateralToPay:{amount:collateralAmount, token:String(params.collateralToken || "USDC")},
    mode:"classic", from:account,
  });
  const estimates = prepared?.estimates || {};
  let requestGas = null;
  let gasPriceWei = null;
  let requestGasCostEth = null;
  try {
    gasPriceWei = BigInt(await rpcJson(env.ARBITRUM_RPC, "eth_gasPrice", []));
    const gas = await rpcJson(env.ARBITRUM_RPC, "eth_estimateGas", [{
      from:account, to:prepared?.payload?.to, data:prepared?.payload?.data, value:`0x${BigInt(prepared?.payload?.value || 0).toString(16)}`
    }]);
    requestGas = BigInt(gas);
    requestGasCostEth = Number(requestGas * gasPriceWei) / 1e18;
  } catch (error) {
    requestGas = null;
  }
  const executionFeeWei = BigInt(prepared?.payload?.value ?? estimates?.executionFeeAmount ?? 0);
  return {
    ok:true, mode:"classic", chainId:42161, account, symbol, direction,
    sizeUsd, collateralUsd,
    positionFeeUsd:classicCostHuman(estimates?.positionFeeUsd,30),
    executionFeeEth:Number(executionFeeWei)/1e18,
    executionFeeWei:executionFeeWei.toString(),
    requestGasEstimate:requestGas == null ? null : requestGas.toString(),
    gasPriceGwei:gasPriceWei == null ? null : Number(gasPriceWei)/1e9,
    requestGasCostEth,
    positionPriceImpactUsd:classicCostHuman(estimates?.positionPriceImpactDeltaUsd,30),
    swapPriceImpactUsd:classicCostHuman(estimates?.swapPriceImpactDeltaUsd,30),
    borrowingFeeUsd:classicCostHuman(estimates?.borrowingFeeUsd,30),
    fundingFeeUsd:classicCostHuman(estimates?.fundingFeeUsd,30),
    acceptablePrice:estimates?.acceptablePrice == null ? null : String(estimates.acceptablePrice),
    relayFeeUsd:0,
    note:"Classic probe prepares the real on-chain transaction but does NOT broadcast it. executionFee is the max keeper fee; unused execution fee is refunded by GMX.",
    preparedPayload:{to:prepared?.payload?.to || null, value:String(prepared?.payload?.value ?? 0)},
  };
}



// V17.5.3 — LIVE execution read/verification helpers.
// These helpers intentionally use the documented SDK v2 account-read surfaces:
// fetchWalletBalances(), fetchPositionsInfo(), and fetchOrderStatus().
// Keep all native bigint values inside the SDK boundary; only convert values
// to Number for human-readable diagnostics/comparisons.
async function readLiveWalletSnapshot(sdk, account) {
  if (!sdk || typeof sdk.fetchWalletBalances !== "function") {
    throw new Error("GMX_SDK_FETCH_WALLET_BALANCES_UNAVAILABLE");
  }
  const balances = await sdk.fetchWalletBalances({ address: account });
  const parsed = extractCollateralBalances(balances);
  return {
    USDC: Number(parsed?.USDC?.usd || 0),
    USDT: Number(parsed?.USDT?.usd || 0),
    walletUsd: Number(parsed?.USDC?.usd || 0) + Number(parsed?.USDT?.usd || 0),
  };
}

function orderStatusFailureReason(orderStatusResult) {
  const response = orderStatusResult?.response || {};
  const error = response?.error;
  const candidates = [
    response?.statusError,
    response?.failureReason,
    response?.cancellationReason,
    response?.reason,
    response?.errorMessage,
    response?.revertReason,
    response?.revertData,
    typeof error === "string" ? error : error?.message,
    error?.reason,
    error?.message,
    error?.code,
    orderStatusResult?.error,
  ];
  const found = candidates.find(v => v !== undefined && v !== null && String(v).trim() !== "");
  if (found) return typeof found === "object" ? jsonStringifySafe(found) : String(found);
  return "n/a";
}

function orderStatusDiagnostic(orderStatusResult) {
  const response = orderStatusResult?.response || {};
  const error = response?.error;
  return {
    code: error?.code || response?.errorCode || response?.code || null,
    message: error?.message || response?.errorMessage || response?.message || null,
    reason: response?.reason || response?.failureReason || response?.cancellationReason || response?.revertReason || null,
    traceId: response?.traceId || response?.traceID || null,
    taskId: response?.taskId || null,
    txHash: response?.txHash || null,
    executionTxnHash: response?.executionTxnHash || null,
    revertData: response?.revertData || null,
  };
}

async function pollLiveOrderStatus(sdk, requestId, timeoutMs = 60000, intervalMs = 2000) {
  const terminal = new Set(["executed", "cancelled", "relay_failed", "relay_reverted"]);
  if (!requestId) {
    return { available: false, terminal: false, timedOut: false, status: "unknown", response: null, polls: 0, elapsedMs: 0, error: "MISSING_REQUEST_ID" };
  }
  if (!sdk || typeof sdk.fetchOrderStatus !== "function") {
    return { available: false, terminal: false, timedOut: false, status: "unknown", response: null, polls: 0, elapsedMs: 0, error: "GMX_SDK_FETCH_ORDER_STATUS_UNAVAILABLE" };
  }
  const started = Date.now();
  let polls = 0;
  let lastResponse = null;
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    polls += 1;
    try {
      const response = await sdk.fetchOrderStatus({ requestId });
      lastResponse = response || null;
      const status = String(response?.status || "unknown").toLowerCase();
      if (terminal.has(status)) {
        const forensic = {
          requestId,
          status,
          polls,
          elapsedMs: Date.now() - started,
          response: response || null,
          diagnostic: orderStatusDiagnostic({ response }),
        };
        try { console.warn("[GMX][ORDER_STATUS_FORENSICS]", jsonStringifySafe(forensic)); } catch (_) {}
        return { available: true, terminal: true, timedOut: false, status, response, polls, elapsedMs: Date.now() - started, forensic };
      }
      // A successful read with a non-terminal state is meaningful, but remains
      // inconclusive until the documented terminal state is reached.
      if (Date.now() - started >= timeoutMs) break;
    } catch (error) {
      lastError = safeError(error);
    }
    await new Promise(resolve => setTimeout(resolve, Math.max(250, intervalMs)));
  }
  const status = String(lastResponse?.status || "unknown").toLowerCase();
  return {
    available: Boolean(lastResponse),
    terminal: terminal.has(status),
    timedOut: true,
    status,
    response: lastResponse,
    polls,
    elapsedMs: Date.now() - started,
    error: lastError,
  };
}

function livePositionMatches(positions, sdkSymbol, direction) {
  const wanted = liveNormalizeSymbol(sdkSymbol);
  const wantedBase = liveNormalizeSymbol(String(sdkSymbol || "").split("/")[0]);
  const isLong = direction === "long";
  return (Array.isArray(positions) ? positions : []).find(position => {
    if (!position || Boolean(position.isLong) !== isLong) return false;
    const candidates = [position.indexName, position.symbol, position.marketSymbol, position.name]
      .filter(Boolean)
      .map(v => liveNormalizeSymbol(v));
    const marketAddress = String(position.marketAddress || position.marketTokenAddress || position.market || "").toLowerCase();
    const symbolAddress = String(sdkSymbol || "").match(/\[([^\]]+)\]/)?.[1]?.toLowerCase() || "";
    const symbolMatch = candidates.some(v => v === wanted || v === wantedBase || wanted === v || wanted.startsWith(v));
    const addressMatch = Boolean(symbolAddress && marketAddress && marketAddress === symbolAddress);
    const size = Number(position.sizeInUsd || position.size || 0);
    return (symbolMatch || addressMatch) && Number.isFinite(size) && size > 0;
  }) || null;
}

async function verifyLiveEntrySettlement(sdk, account, sdkSymbol, direction, collateralSymbol, walletBefore, maxPolls = 5) {
  let walletAfter = null;
  let matchedPosition = null;
  let lastError = null;
  for (let poll = 0; poll < Math.max(1, Number(maxPolls) || 1); poll++) {
    try {
      const [positions, wallet] = await Promise.all([
        sdk.fetchPositionsInfo({ address: account }),
        readLiveWalletSnapshot(sdk, account),
      ]);
      walletAfter = wallet;
      matchedPosition = livePositionMatches(positions, sdkSymbol, direction);
      if (matchedPosition) {
        const token = String(collateralSymbol || "").toUpperCase();
        const before = Number(walletBefore?.[token]);
        const after = Number(walletAfter?.[token]);
        const delta = Number.isFinite(before) && Number.isFinite(after) ? after - before : null;
        return {
          verified: true,
          settled: Number.isFinite(delta) ? delta < -0.000001 : false,
          position: matchedPosition,
          walletAfter,
          walletDelta: delta,
          polls: poll + 1,
        };
      }
    } catch (error) {
      lastError = safeError(error);
    }
    if (poll + 1 < Math.max(1, Number(maxPolls) || 1)) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  const token = String(collateralSymbol || "").toUpperCase();
  const before = Number(walletBefore?.[token]);
  const after = Number(walletAfter?.[token]);
  return {
    verified: false,
    settled: false,
    position: null,
    walletAfter,
    walletDelta: Number.isFinite(before) && Number.isFinite(after) ? after - before : null,
    polls: Math.max(1, Number(maxPolls) || 1),
    error: lastError,
  };
}

async function executeLiveSignal(signal, env) {
if (!executionEnabled(env)) return {executed:false,mode:"SIGNAL",reason:"Execution disabled"};
const direction = String(signal?.direction || "").toUpperCase();
// V17 HYBRID: entry gating is event-based. Do not reintroduce score/trend-count gates.
// Risk limits, valid direction/plan, wallet/market capacity and GMX-native minimums remain safety controls.
if (!signal?.tradePlan?.valid || !["LONG","SHORT"].includes(direction)) return {executed:false,mode:"LIVE",reason:"Invalid live signal"};
if (String(signal?.entryEngine||"") !== "LIQUIDITY_REACTION_5M" || String(signal?.signalTier||"") !== "LIQUIDITY_REACTION_5M") return {executed:false,mode:"LIVE",reason:"LEGACY_ENTRY_ENGINE_BLOCKED"};

let sdk,signer,account;
try { ({sdk,signer,account}=await getLiveContext(env)); } catch(error) { throw executionStageError("LIVE_CONTEXT", error); }
let positions;
try { positions=await sdk.fetchPositionsInfo({address:account}); } catch(error) { throw executionStageError("FETCH_POSITIONS", error); }
const totalLivePositions = Array.isArray(positions) ? positions.filter(p => gmxUsdHumanNumber(p?.sizeInUsd || p?.size) > 0).length : 0;
if (totalLivePositions>=CONFIG.MAX_POSITIONS) throw new Error(`MAX_TOTAL_LIVE_POSITIONS_REACHED: ${totalLivePositions}/${CONFIG.MAX_POSITIONS}`);
let markets, balances, resolvedBalances;
try { markets=await sdk.fetchMarkets(); } catch(error) { throw executionStageError("FETCH_MARKETS", error); }
try { balances=await sdk.fetchWalletBalances({address:account}); } catch(error) { throw executionStageError("FETCH_WALLET_BALANCES", error); }
try { resolvedBalances=await resolveLiveCollateralBalances(sdk,account,balances,env.ARBITRUM_RPC); } catch(error) { throw executionStageError("RESOLVE_COLLATERAL", error); }
const collateral=await resolveLiveCollateralForSignal(sdk,markets,signal.symbol,resolvedBalances.balances);
if (!collateral) {
  const candidates=(markets||[]).filter(m=>!m?.isSpotOnly && (marketMatchesRequestedSymbol(m,liveNormalizeSymbol(signal.symbol)) || marketIndexMatches(m,liveNormalizeSymbol(signal.symbol)))).slice(0,8).map(m=>({symbol:m?.symbol||m?.name||"?",marketTokenAddress:m?.marketTokenAddress||m?.marketAddress||m?.address||null,collateral:[...marketCollateralSymbols(m)]}));
  throw new Error(`No usable USDC/USDT balance with a matching GMX collateral market was detected | walletUsd=${Number(resolvedBalances.walletUsd||0).toFixed(6)} | source=${resolvedBalances.source.join("+")||"NONE"} | market=${liveNormalizeSymbol(signal.symbol)} | sdkMarkets=${Array.isArray(markets)?markets.length:0} | candidates=${JSON.stringify(candidates)}`);
}
let walletBefore;
try { walletBefore=await readLiveWalletSnapshot(sdk, account); } catch(error) { throw executionStageError("READ_WALLET_SNAPSHOT", error); }
const market=collateral.market;
const sdkSymbol=market.symbol;
const orderDirection=signal.direction==="LONG"?"long":"short";
let capacity;
try { capacity=await sdk.getTradingCapacity({symbol:sdkSymbol,direction:orderDirection,rpcUrl:env.ARBITRUM_RPC}); } catch(error) { throw executionStageError("GET_TRADING_CAPACITY", error, {symbol:sdkSymbol,direction:orderDirection,rpcUrl:env.ARBITRUM_RPC}); }
const capacityUsd=Number(capacity?.availableLiquidity||0n)/1e30;
const walletUsd=collateral.usd;
const existingCollateralUsd=Array.isArray(positions)?positions.reduce((sum,p)=>{
  const directKey=["collateralUsd","collateralValueUsd","collateralAmountUsd","initialCollateralUsd"].find(key=>gmxUsdHumanNumber(p?.[key])>0);
  if(directKey){
    const direct=gmxUsdHumanNumber(p?.[directKey]);
    return sum+direct;
  }
  const size=gmxUsdHumanNumber(p?.sizeInUsd),lev=Number(p?.leverage||0);
  return sum+(size>0&&lev>0?size/lev:0);
},0):0;
if(walletUsd>0&&existingCollateralUsd>=walletUsd*CONFIG.MAX_TOTAL_CAPITAL_ALLOCATION-1e-9) throw new Error(`MAX_TOTAL_CAPITAL_ALLOCATION_REACHED: estimatedCollateral=$${existingCollateralUsd.toFixed(6)}, wallet=$${walletUsd.toFixed(6)}, cap=${(CONFIG.MAX_TOTAL_CAPITAL_ALLOCATION*100).toFixed(2)}%`);
const leverage=Number(signal.tradePlan.leverage||CONFIG.DEFAULT_LEVERAGE);
if (!Number.isFinite(leverage)||leverage<=0||leverage>CONFIG.MAX_LEVERAGE) throw new Error(`Invalid leverage: ${leverage}`);
const allocation=Number(signal.tradePlan.allocation??CONFIG.HYBRID_RISK.capitalAllocation);
if (!Number.isFinite(allocation)||allocation<=0||allocation>CONFIG.MAX_CAPITAL_ALLOCATION) throw new Error(`Invalid capital allocation: ${allocation}`);
const collateralTargetUsd=walletUsd*allocation;
const collateralCapUsd=CONFIG.MAX_POSITION_NOTIONAL_USD/Math.max(leverage,1);
const collateralUsd=Math.min(collateralTargetUsd,collateralCapUsd,walletUsd*CONFIG.MAX_CAPITAL_ALLOCATION);
const entryPrice=Number(signal.tradePlan.entry||0);
const stopPrice=Number(signal.tradePlan.stopLoss||0);
const stopFraction=Math.abs(entryPrice-stopPrice)/Math.max(entryPrice,1e-12);
if ((direction === "LONG" && !(stopPrice < entryPrice)) || (direction === "SHORT" && !(stopPrice > entryPrice))) throw new Error("Invalid stop side relative to entry");
if (!(stopFraction > 0) || !Number.isFinite(stopFraction)) throw new Error("Invalid stop distance");
const riskBasedNotional=calculatePositionSize(walletUsd,entryPrice,stopPrice);
if (!(riskBasedNotional>0)) throw new Error("Risk-based position sizing is invalid");
const allocationNotional=collateralUsd*leverage;
let notionalUsd=Math.min(allocationNotional,riskBasedNotional,CONFIG.MAX_POSITION_NOTIONAL_USD,capacityUsd>0?capacityUsd:Number.MAX_SAFE_INTEGER);

// No synthetic order floor and no extra execution-only risk gate.
// Sizing is bounded by the existing strategy allocation/risk model and
// the live GMX market's own capacity/minimum metadata.
const maxCollateralUsd=Math.min(walletUsd*CONFIG.MAX_CAPITAL_ALLOCATION,CONFIG.MAX_POSITION_NOTIONAL_USD/Math.max(leverage,1));
if (notionalUsd/Math.max(leverage,1)>maxCollateralUsd) notionalUsd=maxCollateralUsd*Math.max(leverage,1);
let finalCollateralUsd=Math.min(maxCollateralUsd,Math.max(collateralUsd,notionalUsd/Math.max(leverage,1)));
const requestedCollateralUsd=finalCollateralUsd;
const marketMinPositionUsd=Number(market?.minPositionSizeUsd||0n)/1e30;
const marketMinCollateralUsd=Number(market?.minCollateralUsd||0n)/1e30;
if (marketMinPositionUsd>0 && notionalUsd<marketMinPositionUsd) throw new Error(`CORE_MARKET_MIN_POSITION_BLOCKED: marketMinimum=$${marketMinPositionUsd.toFixed(6)}, computed=$${notionalUsd.toFixed(6)}, wallet=$${walletUsd.toFixed(6)}, stop=${(stopFraction*100).toFixed(2)}%, allocationNotional=$${allocationNotional.toFixed(6)}, riskBasedNotional=$${riskBasedNotional.toFixed(6)}, capacity=$${capacityUsd.toFixed(6)}, collateral=${collateral.symbol}, balanceSource=${collateral.source||"UNKNOWN"}, balanceInterpretation=${collateral.interpretation||"UNKNOWN"}`);
if (marketMinCollateralUsd>0) {
  if (walletUsd<marketMinCollateralUsd || maxCollateralUsd<marketMinCollateralUsd) throw new Error(`CORE_MARKET_MIN_COLLATERAL_BLOCKED: marketMinimum=$${marketMinCollateralUsd.toFixed(6)}, wallet=$${walletUsd.toFixed(6)}, maxCollateral=$${maxCollateralUsd.toFixed(6)}, computedNotional=$${notionalUsd.toFixed(6)}`);
  finalCollateralUsd=Math.max(finalCollateralUsd,marketMinCollateralUsd);
}
let size, collateralAmount, tp, sl;
try { size=toBigIntDecimal(notionalUsd,30); collateralAmount=toBigIntDecimal(finalCollateralUsd,6); tp=toBigIntDecimal(signal.tradePlan.tp1,30); sl=toBigIntDecimal(signal.tradePlan.stopLoss,30); } catch(error) { throw executionStageError("BUILD_BIGINTS", error, {notionalUsd,finalCollateralUsd}); }
let lock;
try { lock=await acquireLiveExecutionLock(env, signal); } catch(error) { throw executionStageError("ACQUIRE_EXECUTION_LOCK", error); }
if (!lock.acquired) return {executed:false,mode:"LIVE",reason:lock.reason,executionKey:lock.key};

try {
const size1=toBigIntDecimal(notionalUsd*0.40,30);
const size2=toBigIntDecimal(notionalUsd*0.30,30);
const size3=toBigIntDecimal(notionalUsd*0.30,30);
const buildOrderRequest = (collateralUsdForOrder) => ({kind:"increase",symbol:sdkSymbol,direction:orderDirection,orderType:"market",size,collateralToken:collateral.symbol,collateralToPay:{amount:toBigIntDecimal(collateralUsdForOrder,6),token:collateral.symbol},mode:"classic",from:account,tpsl:[{type:"take-profit",triggerPrice:toBigIntDecimal(signal.tradePlan.tp1,30),size:size1},{type:"take-profit",triggerPrice:toBigIntDecimal(signal.tradePlan.tp2,30),size:size2},{type:"take-profit",triggerPrice:toBigIntDecimal(signal.tradePlan.tp3,30),size:size3},{type:"stop-loss",triggerPrice:sl,size}]});

let allowanceInfo;
try {
  allowanceInfo=await ensureGmxCollateralAllowance(sdk,signer,account,collateral.symbol,toBigIntDecimal(finalCollateralUsd,6),balances,{rpcUrl:env.ARBITRUM_RPC});
} catch(error) {
  throw executionStageError("COLLATERAL_ALLOWANCE", error, {symbol:sdkSymbol,direction:orderDirection,rpcUrl:env.ARBITRUM_RPC});
}

let result;
try {
  if (typeof sdk?.prepareOrder !== "function") {
    throw new Error("GMX SDK prepareOrder method is unavailable");
  }
  result=await executeGmxOrder(sdk,buildOrderRequest(finalCollateralUsd),signer,{symbol:sdkSymbol,direction:orderDirection,rpcUrl:env.ARBITRUM_RPC});
} catch(error) {
  if (error?.executionStage) throw error;
  throw executionStageError("GMX_ORDER", error, {symbol:sdkSymbol,direction:orderDirection,rpcUrl:env.ARBITRUM_RPC});
}
await markLiveExecutionSubmitted(env, lock.key, signal, result);

// V17.3.4: A GMX Express submit acknowledgement is NOT execution.
// Track the exact requestId through the GMX order lifecycle before counting
// anything as Executed. GMX documents terminal states as executed/cancelled/
// relay_failed/relay_reverted; pending/accepted states remain inconclusive.
let orderStatusResult;
let orderStatus;
if (String(result?.mode || "").toLowerCase() === "classic") {
  orderStatus = String(result?.status || "classic_pending").toLowerCase();
  orderStatusResult = {available:Boolean(result?.receiptAvailable),terminal:Boolean(result?.receiptAvailable),timedOut:Boolean(result?.receiptTimedOut),status:orderStatus,response:result?.receipt||null,polls:result?.receiptAvailable?1:0,elapsedMs:0};
} else {
  orderStatusResult = await pollLiveOrderStatus(sdk, result?.requestId, 60000, 2000);
  orderStatus = String(orderStatusResult?.status || result?.status || "unknown").toLowerCase();
}
if (orderStatusResult?.available && orderStatusResult?.terminal && !["executed","classic_confirmed"].includes(orderStatus)) {
  // V17.5.12: expose the live allowance context on relay failures. The
  // approval path now uses max allowance, so an ERC20 allowance failure is
  // actionable evidence of a spender/token mismatch rather than an amount
  // ceiling that the exact approval itself created.
  let relayAllowanceDiagnostic = null;
  try {
    if (orderStatus === "relay_failed" && /allowance|transfer amount exceeds allowance/i.test(orderStatusFailureReason(orderStatusResult))) {
      const tokenAddress = await resolveGmxCollateralTokenAddress(sdk, collateral.symbol, balances);
      let routerAddress = null;
      try {
        const probe = await sdk.buildApproveTransaction({tokenAddress, spender:"router", amount:0n});
        const data = String(probe?.data || "");
        if (/^0x095ea7b3[0-9a-fA-F]{128}$/.test(data)) routerAddress = `0x${data.slice(34,74)}`;
      } catch (_) {}
      const liveAllowance = (env.ARBITRUM_RPC && tokenAddress && routerAddress)
        ? await readGmxOnchainAllowance(env.ARBITRUM_RPC, tokenAddress, account, routerAddress)
        : null;
      relayAllowanceDiagnostic = {token:collateral.symbol,tokenAddress,routerAddress,requiredAmount:toBigIntDecimal(finalCollateralUsd,6).toString(),liveAllowance:liveAllowance==null?null:liveAllowance.toString(),liveAllowanceHex:liveAllowance==null?null:`0x${liveAllowance.toString(16)}`};
    }
  } catch (diagError) {
    relayAllowanceDiagnostic = {error:safeError(diagError)};
  }
  const walletAfterFailure = await readLiveWalletSnapshot(sdk, account);
  const tokenKey=String(collateral.symbol||"").toUpperCase();
  const beforeToken=Number(walletBefore?.[tokenKey]);
  const afterToken=Number(walletAfterFailure?.[tokenKey]);
  const delta=(Number.isFinite(beforeToken)&&Number.isFinite(afterToken)) ? afterToken-beforeToken : null;
  const failed={
    executed:false, mode:"LIVE", account, symbol:sdkSymbol, direction:orderDirection,
    reason:`GMX_ORDER_${orderStatus.toUpperCase()}`,
    stage:"GMX_ORDER_STATUS", requestId:result?.requestId||null,
    status:orderStatus, statusResponse:orderStatusResult?.response||null,
    statusError:orderStatusFailureReason(orderStatusResult),
    statusDiagnostic:{
      ...orderStatusDiagnostic(orderStatusResult),
      submitCode: result?.error?.code || null,
      submitMessage: result?.error?.message || null,
      submitTraceId: result?.traceId || null,
      preparedTraceId: result?.preparedTraceId || null,
      preparedExpiresAt: result?.preparedExpiresAt || null,
    },
    statusForensics:orderStatusResult?.forensic||null,
    submitResponse:result?.submitResponse || result || null,
    preparedWarnings:result?.preparedWarnings||[],
    preparedValidationWarnings:result?.preparedValidationWarnings||[],
    preparedEstimates:result?.preparedEstimates||null,
    recovery:orderStatusResult?.recovery||null, relayAllowanceDiagnostic, positionVerified:false,
    walletBefore, walletAfter:walletAfterFailure, walletDelta:delta,
    collateralToken:collateral.symbol, collateralUsd:finalCollateralUsd, executionKey:lock.key
  };
  try { await sendTelegram(env, formatTelegramLiveExecutionStatus(failed)); } catch(_) {}
  return failed;
}
if (orderStatusResult?.timedOut || !orderStatusResult?.available || !orderStatusResult?.terminal) {
  const pendingStatus={
    executed:false, mode:"LIVE", account, symbol:sdkSymbol, direction:orderDirection,
    reason:"GMX_ORDER_STATUS_PENDING", stage:"GMX_ORDER_STATUS", requestId:result?.requestId||null,
    status:orderStatus, statusResponse:orderStatusResult?.response||null,
    positionVerified:false, walletBefore, walletAfter:null, walletDelta:null,
    collateralToken:collateral.symbol, collateralUsd:finalCollateralUsd, executionKey:lock.key
  };
  try { await sendTelegram(env, formatTelegramLiveExecutionStatus(pendingStatus)); } catch(_) {}
  return pendingStatus;
}

// Only after GMX reports terminal `executed` do we verify the actual position.
const verification=await verifyLiveEntrySettlement(sdk,account,sdkSymbol,orderDirection,collateral.symbol,walletBefore,5);
if (!verification.verified) {
  const pending={executed:false,mode:"LIVE",account,symbol:sdkSymbol,direction:orderDirection,reason:"ORDER_SUBMITTED_BUT_POSITION_NOT_VERIFIED",stage:"POST_SUBMIT_VERIFY",requestId:result?.requestId||null,status:result?.status||null,positionVerified:false,walletBefore,walletAfter:verification.walletAfter,walletDelta:verification.walletDelta,collateralToken:collateral.symbol,collateralUsd:finalCollateralUsd,executionKey:lock.key};
  try { await sendTelegram(env, formatTelegramLiveExecutionPending(pending)); } catch(_) {}
  return pending;
}
const walletAfter=verification.walletAfter || await readLiveWalletSnapshot(sdk, account);
const walletDelta=Number.isFinite(Number(verification.walletDelta)) ? Number(verification.walletDelta) : null;
const entryNotice={executed:true,mode:"LIVE",account,symbol:sdkSymbol,direction:orderDirection,score:0,confidence:100,leverage,allocation,allocationPercent:Number((allocation*100).toFixed(2)),walletUsd,collateralUsd:finalCollateralUsd,requestedCollateralUsd,collateralToken:collateral.symbol,notionalUsd,riskBasedNotional,marketMinPositionUsd,marketMinCollateralUsd,allowance:allowanceInfo,entryPrice:Number(signal.tradePlan.entry||0),stopLoss:Number(signal.tradePlan.stopLoss||0),tp1:Number(signal.tradePlan.tp1||0),tp2:Number(signal.tradePlan.tp2||0),tp3:Number(signal.tradePlan.tp3||0),requestId:result?.requestId||null,status:result?.status||null,entryEngine:entryEngine,eventStrength:Number(signal?.eventStrength||0),positionVerified:true,walletBefore,walletAfter,walletDelta,settlementVerified:Boolean(verification.settled),position:verification.position||null,feeTelemetry:result?.feeTelemetry||null,executionKey:lock.key};
entryNotice.accounting=buildObservedWalletAccounting(entryNotice);
try { await sendTelegram(env, formatTelegramLiveEntry(entryNotice)); } catch(_) {}
return entryNotice;
} catch (error) {
  await clearLiveExecutionLock(env, lock.key);
  throw error;
} finally {
releaseLiveExecutionLock(lock.key);
}
}

async function monitorLivePositions(env) {
if(!GmxApiSdk || !PrivateKeySigner || !getViemChain){
  const loaded=await loadGmxSdkSafe();
  if(!loaded){
    console.warn("[EXECUTION][MONITOR_SKIP]", {reason:"SDK_UNAVAILABLE",detail:GMX_SDK_LOAD_ERROR || "GMX SDK exports unavailable"});
    return [];
  }
}
const { sdk, signer, account } = await getLiveContext(env);
const positions = await sdk.fetchPositionsInfo({
address: account,
includeRelatedOrders: true
});
const actions = [];
if (!Array.isArray(positions)) return actions;
 
const markets = await sdk.fetchMarkets();
 
for (const position of positions) {
try {
const rawIndex = String(position.indexName || "");
const symbol = liveNormalizeSymbol(rawIndex.split("/")[0]);
if (!symbol || !position.sizeInUsd) continue;
 
const snapshot = await buildMarketSnapshot(symbol, env);
const previous = await loadMarketSnapshot(env, symbol);
const analysis = scoreSignal(snapshot, previous?.market || null);
const market = {
...snapshot,
price: snapshot.price,
currentPrice: snapshot.price,
score: analysis.score,
trend: snapshot.trend,
structure: snapshot.structure,
participation: snapshot.participation,
momentum: snapshot.momentum,
smartMoney: snapshot.smartMoney,
smartMoneyOutflow: snapshot.smartMoneyOutflow,
risk: analysis.risk,
atr: snapshot.atr ?? snapshot.indicators?.atr
};
 
const entryPrice = Number(position.entryPrice || position.entryPriceUsd || position.averagePrice || 0);
const currentPrice = Number(snapshot.price || 0);
const isLong = Boolean(position.isLong);
const side = isLong ? "LONG" : "SHORT";
const hardStop = entryPrice > 0 && currentPrice > 0 && (
(isLong && Number(position.stopLossPrice || position.stopLoss || 0) > 0 && currentPrice <= Number(position.stopLossPrice || position.stopLoss)) ||
(!isLong && Number(position.stopLossPrice || position.stopLoss || 0) > 0 && currentPrice >= Number(position.stopLossPrice || position.stopLoss))
);
 
// V17.7: legacy Radar reversal exit is disabled; only unified hard-stop/TP exit logic may close positions.
const plan = buildPositionExitPlan(position, market, hardStop);
 
// Preserve the original smart-money/reversal protection as a fallback signal,
// but let the unified exit manager decide the action.
const oppositeScore = isLong ? analysis.shortScore : analysis.longScore;
if (plan.execution === "HOLD" && oppositeScore < 65 && analysis.risk < 45) continue;
 
const action = plan.action;
if (!action || action === "HOLD") continue;
 
const marketSdk = findSdkMarket(markets, symbol);
if (!marketSdk) continue;
 
const sizeUsd = Number(position.sizeInUsd);
const closePercent = Math.max(0, Math.min(100, Number(plan.closePercent || 0)));
const closeSizeUsd = closePercent >= 100 ? sizeUsd : sizeUsd * closePercent / 100;
if (!(closeSizeUsd > 0)) continue;
 
const size = toBigIntDecimal(closeSizeUsd, 30);
const result = await executeGmxOrder(sdk, {
  kind: "decrease",
  symbol: marketSdk.symbol,
  direction: isLong ? "long" : "short",
  orderType: "market",
  size,
  collateralToken: positionCollateral || "USDC",
  receiveToken: positionCollateral || "USDC",
  mode: "classic",
  from: account
}, signer, {symbol:marketSdk.symbol,direction:isLong?"LONG":"SHORT",lane:"CORE_EXIT",action,rpcUrl:env.ARBITRUM_RPC});
 
const pnlPercent = entryPrice > 0 && currentPrice > 0
? (isLong ? (currentPrice - entryPrice) / entryPrice : (entryPrice - currentPrice) / entryPrice) * 100
: 0;
 
const actionRecord = {
symbol,
direction: side,
action,
reason: hardStop ? "HARD_STOP" : (plan.reasons?.structureBreak ? "STRUCTURE_BREAK" : plan.execution),
closePercent,
pnlPercent: Number(pnlPercent.toFixed(2)),
pnlUsd: Number((Number(position.sizeInUsd||0) * pnlPercent / 100).toFixed(4)),
entryPrice,
exitPrice: currentPrice,
leverage: Number(position?.leverage || 1),
notionalUsd: Number(position?.sizeInUsd || 0),
exitScore: plan.score,
components: plan.components,
requestId: result?.requestId || null
};
actions.push(actionRecord);
await auditLog(env, { type: "LIVE_UNIFIED_EXIT", account, action: actionRecord });
 
try {
await sendTelegram(env, formatTelegramExit(actionRecord));
} catch (_) {}
} catch (error) {
actions.push({
symbol: position?.indexName || "UNKNOWN",
action: "ERROR",
error: safeError(error)
});
}
}
return actions;
}
 
async function executeSignal(signal,env) {
if (!executionEnabled(env)) {
await auditLog(env,{type:"SIGNAL_ONLY",signal});
return {executed:false,mode:CONFIG.MODE,signal};
}
if (!signal?.executionEligible) {
await auditLog(env,{type:"LIVE_EXECUTION_BLOCKED",signalId:signal?.id,reason:"Signal is not execution-eligible"});
return {executed:false,mode:"LIVE",reason:"Signal is not execution-eligible",signal};
}
try {
const result=await executeLiveSignal(signal,env);
try {
  await auditLog(env,{type:"LIVE_EXECUTION",signalId:signal.id,result});
} catch(auditError) {
  // Audit persistence must never turn a successful GMX execution into a
  // reported execution failure.
  console.error("[AUDIT][LIVE_EXECUTION_LOG_ERROR]", {error:safeError(auditError)});
}
return {...result,signal};
} catch(error) {
await auditLog(env,{type:"LIVE_EXECUTION_ERROR",signalId:signal?.id,error:safeError(error)});
return {executed:false,mode:"LIVE",error:safeError(error),stage:error?.executionStage||null,executionMeta:error?.executionMeta||null,signal};
}
}
 
 
// ================================
// COMPLETE MARKET SCAN
// ================================
 
 
async function runLegacyFullScan(
env
){
 
 
 
if(
!BOT_STATE.running
){
 
 
return {
 
 
status:
"PAUSED"
 
 
};
 
}
 
 
 
 
 
const candidates=[];
 
 
 
for(
const symbol of WATCHLIST
){
 
 
 
const analysis =
 
analyzeMarket(symbol);
 
 
 
if(
analysis.status==="NO_DATA"
)
 
continue;
 
 
 
 
 
const data =
 
getMarketData(symbol);
 
 
 
const strategy =
 
legacyStrategyVote(data);
 
 
 
 
 
candidates.push({
 
symbol,
 
 
...strategy,
 
 
smartScore:
 
analysis.score
 
 
});
 
 
 
}
 
 
 
 
 
 
const ranked =
 
rankSignals(candidates);
 
 
 
 
 
BOT_STATE.lastScan =
Date.now();
 
 
BOT_STATE.signals =
ranked.slice(0,3);
 
 
 
 
 
 
if(
ranked.length
){
 
 
const best =
 
chooseBestSignal(ranked);
 
 
 
await executeSignal(
 
best,
 
env
 
);
 
 
 
return {
 
 
status:
"SCAN_COMPLETE",
 
 
best,
 
 
top3:
BOT_STATE.signals
 
 
};
 
 
}
 
 
 
 
 
return {
 
 
status:
"NO_SIGNAL"
 
 
};
 
 
}
 
 
 
 
 
 
 
 
// ======================================================
// GMX V2 MARKET DISCOVERY / READ-ONLY ADAPTER
// Uses the official GMX Oracle API for public market reads.
// No wallet, signing, private key or order submission.
// ======================================================
 
async function fetchWithTimeout(url, options = {}, timeoutMs = GMX_V2_CONFIG.REQUEST_TIMEOUT_MS){
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), timeoutMs);
 
try{
return await fetch(url, {
...options,
signal: controller.signal
});
}finally{
clearTimeout(timer);
}
}
 
function normalizeGmxMarket(market){
if(!market || typeof market !== "object"){
return null;
}
 
return {
marketToken: market.marketToken || market.marketTokenAddress || null,
symbol: market.symbol || market.name || null,
indexToken: market.indexToken || null,
longToken: market.longToken || null,
shortToken: market.shortToken || null,
isListed: market.isListed ?? null,
isSpotOnly: market.isSpotOnly ?? null
};
}
 
async function legacyFetchGmxMarkets(){
const response = await fetchWithTimeout(
GMX_V2_CONFIG.MARKETS_URL,
{
method: "GET",
headers: {
"accept": "application/json"
}
}
);
 
const text = await response.text();
 
if(!response.ok){
throw new Error(
`GMX markets HTTP ${response.status}: ${text.slice(0,300)}`
);
}
 
let data;
try{
data = JSON.parse(text);
}catch(error){
throw new Error("GMX markets returned invalid JSON");
}
 
const rawMarkets =
Array.isArray(data)
? data
: Array.isArray(data.markets)
? data.markets
: [];
 
return {
count: rawMarkets.length,
markets: rawMarkets
.map(normalizeGmxMarket)
.filter(Boolean)
};
}
 
async function legacyFetchGmxMarketsInfo(){
const response = await fetchWithTimeout(
GMX_V2_CONFIG.MARKETS_INFO_URL,
{
method: "GET",
headers: {
"accept": "application/json"
}
}
);
 
const text = await response.text();
 
if(!response.ok){
throw new Error(
`GMX markets/info HTTP ${response.status}: ${text.slice(0,300)}`
);
}
 
let data;
try{
data = JSON.parse(text);
}catch(error){
throw new Error("GMX markets/info returned invalid JSON");
}
 
return data;
}
 
async function gmxMarketsRoute(env, infoOnly){
if(!env.ARBITRUM_RPC){
return jsonResponse({
ok: false,
network: "Arbitrum One",
chainId: GMX_V2_CONFIG.CHAIN_ID,
rpc: "missing",
gmx: "blocked",
reason: "ARBITRUM_RPC is not configured"
}, 503);
}
 
try{
// Verify the RPC network before using GMX data.
const rpcResponse = await fetchWithTimeout(
env.ARBITRUM_RPC,
{
method: "POST",
headers: {
"content-type": "application/json"
},
body: JSON.stringify({
jsonrpc: "2.0",
id: 1,
method: "eth_chainId",
params: []
})
}
);
 
const rpcData = await rpcResponse.json();
const chainId =
rpcData.result
? parseInt(rpcData.result, 16)
: null;
 
if(chainId !== GMX_V2_CONFIG.CHAIN_ID){
return jsonResponse({
ok: false,
network: "Unknown",
chainId,
expectedChainId: GMX_V2_CONFIG.CHAIN_ID,
rpc: "wrong_network",
gmx: "blocked"
}, 502);
}
 
if(infoOnly){
const info = await fetchGmxMarketsInfo();
 
return jsonResponse({
ok: true,
network: "Arbitrum One",
chainId,
rpc: "connected",
gmx: "reachable",
source: GMX_V2_CONFIG.MARKETS_INFO_URL,
mode: CONFIG.MODE,
execution: executionEnabled(env),
data: info,
timestamp: Date.now()
});
}
 
const result = await fetchGmxMarkets();
 
return jsonResponse({
ok: true,
network: "Arbitrum One",
chainId,
rpc: "connected",
gmx: "reachable",
source: GMX_V2_CONFIG.MARKETS_URL,
mode: CONFIG.MODE,
execution: executionEnabled(env),
count: result.count,
markets: result.markets,
timestamp: Date.now()
});
 
}catch(error){
return jsonResponse({
ok: false,
network: "Arbitrum One",
chainId: GMX_V2_CONFIG.CHAIN_ID,
rpc: "connected",
gmx: "error",
error: error.message,
mode: CONFIG.MODE,
execution: executionEnabled(env),
timestamp: Date.now()
}, 502);
}
}
 
// V14.0.5.1: Telegram has a strict per-invocation fetch budget.
// Keep a small deterministic allowance so notification fetches can never
// consume the remaining Cloudflare subrequest budget after market analysis.
// The WeakMap is keyed by the current Worker env object, so separate
// invocations do not share counters.
const TELEGRAM_BUDGETS = new WeakMap();
const TELEGRAM_MAX_SENDS_PER_INVOCATION = 8;

function telegramBudget(env) {
  let budget = TELEGRAM_BUDGETS.get(env);
  if (!budget) {
    budget = { remaining: TELEGRAM_MAX_SENDS_PER_INVOCATION, attempted: 0, skipped: 0 };
    TELEGRAM_BUDGETS.set(env, budget);
  }
  return budget;
}

function consumeTelegramBudget(env) {
  const budget = telegramBudget(env);
  if (budget.remaining <= 0) {
    budget.skipped++;
    console.warn("[TELEGRAM][BUDGET_SKIP]", {
      remaining: budget.remaining,
      maxPerInvocation: TELEGRAM_MAX_SENDS_PER_INVOCATION
    });
    return false;
  }
  budget.remaining--;
  budget.attempted++;
  return true;
}

// ================================
// TELEGRAM SENDER
// ================================
 
 
async function sendTelegram(
env,
message
){
// V13.9.6: never fail silently. Scheduled Cron and manual /scan use the
// same transport, so Telegram failures are explicitly visible in logs.
if(!env.TELEGRAM_TOKEN || !env.TELEGRAM_CHAT_ID){
console.error("[TELEGRAM][CONFIG_ERROR]", {
 tokenConfigured: !!env.TELEGRAM_TOKEN,
 chatIdConfigured: !!env.TELEGRAM_CHAT_ID
});
return {ok:false,reason:"TELEGRAM_CONFIG_MISSING"};
}

if (!consumeTelegramBudget(env)) {
return {ok:false,reason:"TELEGRAM_SUBREQUEST_BUDGET"};
}
const url = `https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`;
try {
const response = await fetch(url,{
method:"POST",
headers:{"content-type":"application/json; charset=UTF-8"},
body:JSON.stringify({chat_id:env.TELEGRAM_CHAT_ID,text:String(message||"")})
});
const body = await response.text();
if(!response.ok){
console.error("[TELEGRAM][HTTP_ERROR]", {status:response.status,body:body.slice(0,500)});
return {ok:false,reason:`HTTP_${response.status}`};
}
let parsed=null;
try { parsed=JSON.parse(body); } catch (_) {}
if(parsed && parsed.ok === false){
console.error("[TELEGRAM][API_ERROR]", {status:response.status,description:parsed.description||null});
return {ok:false,reason:"TELEGRAM_API_ERROR"};
}
return {ok:true,reason:"SENT"};
} catch(error){
console.error("[TELEGRAM][FETCH_ERROR]", {error:safeError(error)});
return {ok:false,reason:safeError(error)};
}
}


// ================================
// TELEGRAM COMMAND HANDLER
// ================================
 
 
function handleCommand(
command
){
 
 
 
switch(command){
 
 
 
case "/pause":
 
 
BOT_STATE.running=false;
 
 
return "BOT PAUSED";
 
 
 
 
 
case "/resume":
 
 
BOT_STATE.running=true;
 
 
return "BOT RESUMED";
 
 
 
 
 
case "/status":
 
 
return JSON.stringify(
BOT_STATE
);
 
 
 
 
 
default:
 
 
return "UNKNOWN COMMAND";
 
 
}
 
 
 
}
 
 
 
 
 
 
 
// ================================
// EXTEND WORKER ROUTER
// ================================
 
 
async function apiRouter(
request,
env
){
 
 
 
const url =
 
new URL(request.url);
 
 
 
 
 
if(url.pathname === "/scan") {
return jsonResponse(await FUTURES_V6.scan(env));
}
 
 
 
 
 
if(
url.pathname === "/health"
){
 
 
return jsonResponse(
systemHealth(env)
);
 
 
}
 
 
 
 
 
 
if(
url.pathname === "/control"
){
 
 
 
const cmd =
 
url.searchParams.get(
"cmd"
);
 
 
 
return jsonResponse({
 
result:
 
handleCommand(cmd)
 
 
});
 
 
}
 
 
 
 
 
return null;
 
 
}
