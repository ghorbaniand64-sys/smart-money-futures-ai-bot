import { GmxApiSdk, PrivateKeySigner } from "@gmx-io/sdk/v2";
import { getViemChain } from "@gmx-io/sdk/configs/chains";

Â 
// ======================================================
// Smart Money Futures AI Bot
// Version: V15.6.5 / Phase 6 Radar Price Integrity + GitHub Actions Multi-Source Smart Money + Independent Radar + Smart Money Data Health + OI/Funding Integrity + Volume-Aware OHLCV + Exploration Deep Scan + Radar Coverage
// Platform: Cloudflare Workers
// Network: Arbitrum Ready
// Execution: LIVE ARMED; ENV EXECUTION_ENABLED=false remains an explicit emergency OFF switch
// ======================================================
Â 
Â 
// ================================
// MODULE-SCOPE ERROR HELPERS
// ================================
function safeError(error) {
return error?.message || String(error || "Unknown error");
}
Â 
// ================================
// CONFIGURATION
// ================================
Â 
Â 
Â 
Â 
const DYNAMIC_RISK_ENGINE = {
enabled: true,
Â 
// SL is derived from volatility/structure first, then bounded by safety limits.
sl: {
atrMultiplier: 1.8,
structureBufferAtr: 0.25,
minPercent: 0.35,
maxPercent: 3.50
},
Â 
// TP uses risk/reward plus nearby structure/volatility; it is not a fixed price.
tp: {
minRR: 1.5,
baseRR: 2.0,
strongSignalRR: 2.5,
extremeSignalRR: 3.0
},
Â 
// Trailing protection activates only after the position has earned enough R.
trailing: {
enabled: true,
activateAfterR: 1.0,
atrMultiplier: 1.2,
tightenAfterR: 1.5,
tightenAtrMultiplier: 0.9
}
};
Â 
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
Â 
function deriveDynamicTPSL(position, market) {
const entry = finitePositive(position?.entryPrice);
const atr = finitePositive(
market?.atr ??
market?.indicators?.atr ??
market?.volatility?.atr
);
Â 
const high = finitePositive(market?.structure?.recentHigh);
const low = finitePositive(market?.structure?.recentLow);
const side = String(position?.side || position?.direction || "").toUpperCase();
const isLong = side === "LONG";
Â 
// If market inputs are incomplete, do not invent a tradable price.
if (!entry || !atr || (isLong && !low) || (!isLong && !high)) {
return {
ready: false,
reason: "insufficient_market_inputs_for_dynamic_tp_sl",
entryPrice: entry || null,
atr: atr || null
};
}
Â 
const structureStopDistance = isLong
? Math.max(0, entry - low)
: Math.max(0, high - entry);
Â 
const volatilityStopDistance = atr * DYNAMIC_RISK_ENGINE.sl.atrMultiplier;
const buffer = atr * DYNAMIC_RISK_ENGINE.sl.structureBufferAtr;
Â 
const stopDistance = Math.max(
volatilityStopDistance,
structureStopDistance + buffer
);
Â 
const rawSlPercent = (stopDistance / entry) * 100;
const slPercent = Math.max(
DYNAMIC_RISK_ENGINE.sl.minPercent,
Math.min(DYNAMIC_RISK_ENGINE.sl.maxPercent, rawSlPercent)
);
Â 
const boundedStopDistance = entry * slPercent / 100;
const stopPrice = isLong
? entry - boundedStopDistance
: entry + boundedStopDistance;
Â 
const signalScore = Number(
position?.score ??
market?.score ??
0
);
Â 
const rr =
signalScore >= 90 ? DYNAMIC_RISK_ENGINE.tp.extremeSignalRR :
signalScore >= 80 ? DYNAMIC_RISK_ENGINE.tp.strongSignalRR :
DYNAMIC_RISK_ENGINE.tp.baseRR;
Â 
const targetDistance = boundedStopDistance * Math.max(
DYNAMIC_RISK_ENGINE.tp.minRR,
rr
);
Â 
const takeProfitPrice = isLong
? entry + targetDistance
: entry - targetDistance;
Â 
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
Â 
function deriveTrailingStop(position, market, currentPrice) {
if (!DYNAMIC_RISK_ENGINE.trailing.enabled) return { enabled: false };
Â 
const entry = finitePositive(position?.entryPrice);
const atr = finitePositive(market?.atr ?? market?.indicators?.atr);
const price = finitePositive(currentPrice);
const side = String(position?.side || position?.direction || "").toUpperCase();
Â 
if (!entry || !atr || !price || !side) {
return { enabled: true, ready: false };
}
Â 
const risk = Math.abs(entry - finitePositive(position?.initialStopPrice));
if (!risk) return { enabled: true, ready: false, reason: "initial_stop_required" };
Â 
const pnlDistance = side === "LONG" ? price - entry : entry - price;
const rMultiple = pnlDistance / risk;
Â 
if (rMultiple < DYNAMIC_RISK_ENGINE.trailing.activateAfterR) {
return { enabled: true, active: false, rMultiple: Number(rMultiple.toFixed(3)) };
}
Â 
const atrMult = rMultiple >= DYNAMIC_RISK_ENGINE.trailing.tightenAfterR
? DYNAMIC_RISK_ENGINE.trailing.tightenAtrMultiplier
: DYNAMIC_RISK_ENGINE.trailing.atrMultiplier;
Â 
const distance = atr * atrMult;
const stop = side === "LONG" ? price - distance : price + distance;
Â 
return {
enabled: true,
active: true,
rMultiple: Number(rMultiple.toFixed(3)),
price: Number(stop.toFixed(8)),
atrMultiplier: atrMult
};
}
Â 
const EXIT_ENGINE = {
enabled: true,
monitorEveryScan: true,
Â 
// Exit score is independent from entry score.
// 0-39 HOLD, 40-59 PROTECT, 60-74 PARTIAL_25,
// 75-89 PARTIAL_50, 90-100 FULL.
thresholds: {
protect: 40,
partial25: 60,
partial50: 75,
full: 90
},
Â 
partialClosePercent: {
first: 25,
second: 50
},
Â 
// Hard protection always overrides the score engine.
emergency: {
maxRiskScore: 70,
structureBreak: true,
smartMoneyOutflow: true,
trendFlip: true
},
Â 
trailing: {
enabled: true,
activateAfterR: 1.0,
tightenAfterR: 1.5
}
};
Â 
const CONFIG = {
VERSION: "V15.6.5-GITHUB-ACTIONS-RADAR-PRICE-INTEGRITY",
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
MAX_CAPITAL_ALLOCATION: 0.15,
MAX_TOTAL_CAPITAL_ALLOCATION: 0.30,
RISK_PER_TRADE: 0.01,
MAX_TOTAL_RISK: 0.03,
DEFAULT_LEVERAGE: 3,
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
{ minScore: 97, allocation: 0.15 }
],
MIN_SCORE: 88,
// Canonical V6.2 signal tiers.
// WATCH = directional bias worth monitoring; VALID = actionable signal;
// STRONG = high-confluence signal; EXECUTION remains stricter.
WATCH_SCORE: 65,
VALID_SIGNAL_SCORE: 75,
STRONG_SIGNAL_SCORE: 85,
EXECUTION_SCORE: 88,
MIN_SIGNAL_SCORE: 75,
MIN_EDGE: 7,
EXECUTION_MIN_EDGE: 10,
EXECUTION_MAX_RISK: 40,
MAX_MARKETS: 30,
// V15.6: broad Radar is not capped by this legacy compatibility field.
DEEP_SCAN_LIMIT: 18,
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
RADAR_EARLY_ENTRY_ENABLED: true,
RADAR_EARLY_ENTRY_SCORE: 60,
RADAR_EARLY_ENTRY_MIN_VELOCITY: 0.75,
RADAR_EARLY_ENTRY_MIN_EDGE: 8,
RADAR_EXIT_SCORE: 65,
RADAR_REVERSAL_EDGE: 8,
RADAR_RISK_PER_TRADE: 0.005,
RADAR_CAPITAL_ALLOCATION: 0.03,
RADAR_MAX_POSITION_NOTIONAL_USD: 2500,
// V15.3.5: independent Radar live lane is armed; execution still honors executionEnabled(env).
RADAR_LIVE_ENABLED: true,
RADAR_LIVE_MAX_POSITIONS: 1,
RADAR_LIVE_RISK_PER_TRADE: 0.005,
RADAR_LIVE_CAPITAL_ALLOCATION: 0.03,
RADAR_LIVE_MAX_POSITION_NOTIONAL_USD: 2500,
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
Â 
NOTIFY_WATCH: true,
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
MIN_POSITION_NOTIONAL_USD: 10,
TRAILING_STOP: true,
PARTIAL_TP: true,
TELEGRAM_ENABLED: true,
DIAGNOSTIC_MODE: true,
LIVE_REQUIRE_PRIVATE_KEY: true
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
Â 
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
//Â Â  ReferenceError: extractOpenInterest is not defined
// ======================================================
Â 
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
m?.longInterestUsd,m?.shortInterestUsd,m?.longInterestUsdUsingLongToken,m?.longInterestUsdUsingShortToken,
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
Â 
const usdParts = [
m?.longPoolValueUsd, m?.shortPoolValueUsd,
m?.longPoolAmountUsd, m?.shortPoolAmountUsd,
m?.longPoolUsd, m?.shortPoolUsd,
m?.values?.longPoolAmountUsd, m?.values?.shortPoolAmountUsd,
m?.marketValues?.longPoolAmountUsd, m?.marketValues?.shortPoolAmountUsd
].map(v => v132NumberValue(v)).filter(v => v > 0);
return usdParts.reduce((a,b) => a+b, 0);
}
Â 
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
PUMP_RADAR: {enabled: CONFIG.PUMP_RADAR_ENABLED, watchScore: CONFIG.PUMP_RADAR_WATCH_SCORE, hotScore: CONFIG.PUMP_RADAR_HOT_SCORE},
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
Â 
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
Â 
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
Â 
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
const cur=Number(currentPrice);
const out=[];
for(const x of rows){
  const at=Number(x?.at), price=Number(x?.price);
  if(!Number.isFinite(at)||!Number.isFinite(price)||price<=0||at<=0)continue;
  // Reject future samples and samples older than the rolling retention window.
  if(at>now+60000||now-at>48*60*60*1000)continue;
  // Price-integrity gate: history must be on the same order of magnitude as
  // the current Oracle price. A mismatch is treated as stale/corrupt data.
  if(cur>0){
    const ratio=price/cur;
    if(!Number.isFinite(ratio)||ratio<0.05||ratio>20)continue;
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
return dedup.slice(-96);
}
function v8WindowSample(hist,minutes,now=Date.now()){
const target=now-minutes*60*1000;
let best=null;
for(let i=hist.length-1;i>=0;i--){
  const x=hist[i];
  if(Number(x.at)<=target){best=x;break;}
}
if(!best)return null;
const age=now-Number(best.at);
const minAge=Math.max(0,minutes*60*1000-60000);
const maxAge=minutes*60*1000+3*60*1000;
if(age<minAge||age>maxAge)return null;
return best;
}
function v8PctMove(current,prior){
const c=Number(current),p=Number(prior);
if(!(c>0&&p>0))return 0;
const pct=((c-p)/p)*100;
return Number.isFinite(pct)&&Math.abs(pct)<=10000?pct:0;
}
let SMART_MONEY_FLOW_CACHE = { at: 0, result: null };
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
function smfConfidence(flow){if(!flow)return{level:"UNAVAILABLE",score:0};const total=Number(flow.totalUsd||0),trades=Number(flow.tradeCount||0),large=Number(flow.largeTradeCount||0),imbalance=Math.abs(Number(flow.imbalance||0)),surge=Boolean(flow.flowSurge||flow.explosiveFlow);let score=0;if(total>0)score+=20;if(trades>=3)score+=20;if(trades>=10)score+=15;if(large>=1)score+=20;if(large>=2)score+=10;if(imbalance>=0.20)score+=10;if(surge)score+=15;score=Math.min(100,score);return{level:score>=75?"HIGH":score>=45?"MEDIUM":"LOW",score};}
function smfFlowReasons(flow,direction){if(!flow||!["LONG","SHORT"].includes(direction))return[];const aligned=direction==="LONG"?Number(flow.imbalance||0):-Number(flow.imbalance||0),reasons=[];if(aligned>=.2)reasons.push("smart_money_imbalance");if(aligned>=.45)reasons.push("strong_smart_money_flow");if(Number(flow.flowSpikeRatio||1)>=Number(CONFIG.SMART_MONEY_FLOW_SPIKE_THRESHOLD||1.8))reasons.push("flow_surge");if(Number(flow.flowSpikeRatio||1)>=Number(CONFIG.SMART_MONEY_FLOW_EXPLOSIVE_THRESHOLD||3))reasons.push("explosive_flow");if(Number(flow.largeTradeCount||0)>=2)reasons.push("large_order_participation");return reasons;}
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
const arr=Array.isArray(next[symbol])?next[symbol].slice(-47):[];
const sample={at:now,totalUsd:Number(flow.totalUsd||0),buyUsd:Number(flow.buyUsd||0),sellUsd:Number(flow.sellUsd||0),imbalance:Number(flow.imbalance||0)};
const last=arr[arr.length-1];
if(!last||now-Number(last.at||0)>=Number(CONFIG.RADAR_HISTORY_SAMPLE_MS||30000))arr.push(sample);else arr[arr.length-1]=sample;
next[symbol]=arr.slice(-48);
}
return next;
}
function v8PumpRadar(market, previous=null, history=[]){
if(!market)return{score:0,longScore:0,shortScore:0,edge:0,direction:"NEUTRAL",reasons:["missing_market"],priceDataStatus:"INVALID"};
const price=v8HighMetric(market,["price","markPrice","indexPrice","currentPrice","indexPriceUsd"]);
const prevPrice=v8HighMetric(previous,["price","markPrice","indexPrice","currentPrice"]);
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

const rawHist=Array.isArray(history)?history.filter(x=>Number(x?.price)>0&&Number(x?.at)>0).slice(-96):[];
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

const positiveMove=Math.max(p24,p4h,p1h,priorMovePct,move10m,move15m,move30m);
const negativeMove=Math.min(p24,p4h,p1h,priorMovePct,move10m,move15m,move30m);
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
if(velocity5m>0.35){long+=6;reasonsLong.push("5m_velocity");}
if(velocity5m>0.75){long+=8;reasonsLong.push("5m_acceleration");}
if(velocity5m>1.25){long+=10;reasonsLong.push("5m_impulse");}
if(velocity5m>2.0){long+=12;reasonsLong.push("5m_explosion");}
if(velocity5m>4.0){long+=8;reasonsLong.push("5m_extreme");}
if(velocity5m<-0.35){short+=6;reasonsShort.push("5m_velocity");}
if(velocity5m<-0.75){short+=8;reasonsShort.push("5m_acceleration");}
if(velocity5m<-1.25){short+=10;reasonsShort.push("5m_impulse");}
if(velocity5m<-2.0){short+=12;reasonsShort.push("5m_explosion");}
if(velocity5m<-4.0){short+=8;reasonsShort.push("5m_extreme");}
if(acceleration5m>0.35){long+=7;reasonsLong.push("velocity_acceleration");}
if(acceleration5m<-0.35){short+=7;reasonsShort.push("velocity_acceleration");}
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
if(nearHigh&&(positiveMove>=1||priorMovePct>=0.5)){long+=10;reasonsLong.push("near_24h_high");}
if(nearLow&&(negativeMove<=-1||priorMovePct<=-0.5)){short+=10;reasonsShort.push("near_24h_low");}
const breakoutPressure=Math.min(20,Math.max(0,rangePct-4)*2);
if(breakoutPressure>0&&positiveMove>0.5){long+=breakoutPressure;reasonsLong.push("range_expansion");}
if(breakoutPressure>0&&negativeMove<-0.5){short+=breakoutPressure;reasonsShort.push("range_expansion");}
const liquidity=v8LiquidityScore(market);
const liquidityBoost=CONFIG.FAIR_LIQUIDITY_SCORE_IN_RADAR?Math.min(8,liquidity/12.5):0;
long+=liquidityBoost;short+=liquidityBoost;
const longScore=Math.min(100,long),shortScore=Math.min(100,short),edge=Math.abs(longScore-shortScore);
const direction=edge>=CONFIG.PUMP_RADAR_MIN_DIRECTIONAL_EDGE?(longScore>shortScore?"LONG":"SHORT"):"NEUTRAL";
const timingState=direction==="NEUTRAL"?"NEUTRAL":
  (radarWarmup?"WARMUP":
   ((Math.abs(velocity5m)>=0.75||Math.abs(acceleration5m)>=0.35)?"EARLY_FAST":
    (Math.abs(move15m)>=2||Math.abs(move30m)>=4)?"ACTIVE":"LATE_OR_SLOW"));
return{
score:Number(Math.max(longScore,shortScore).toFixed(2)),longScore:Number(longScore.toFixed(2)),shortScore:Number(shortScore.toFixed(2)),edge:Number(edge.toFixed(2)),direction,
priceChange24h:Number(p24.toFixed(3)),priceChange1h:Number(p1h.toFixed(3)),priceChange4h:Number(p4h.toFixed(3)),priorMovePct:Number(priorMovePct.toFixed(3)),
move10m:Number(move10m.toFixed(3)),move15m:Number(move15m.toFixed(3)),move30m:Number(move30m.toFixed(3)),velocity5m:Number(velocity5m.toFixed(3)),acceleration5m:Number(acceleration5m.toFixed(3)),timingState,
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
priceDataStatus,radarWarmup,historySamples:hist.length,valid5mSample:Boolean(prior5),valid15mSample:Boolean(prior15),valid30mSample:Boolean(prior30),
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
Â 
const reasons = [];
if (!symbol) reasons.push("missing_symbol");
if (V8_UNIVERSE.REQUIRE_VALID_MARKET && market?.isActive === false) reasons.push("inactive");
if (Number.isFinite(price) && price < V8_UNIVERSE.MIN_PRICE) reasons.push("price_too_low");
const liquidityKnown = liq > 0;
// V15 FAIR: liquidity remains telemetry/execution-risk context, never an asset-selection bonus.
// Do not reject smaller/non-major markets merely because their liquidity score is lower/unknown.
if (!liquidityKnown) reasons.push("liquidity_unknown_diagnostic");
Â 
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
Â 
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
universeRotationCursor: 0,
lastExitDiagnostics: []
};
Â 
const CACHE = new Map();
const INFLIGHT = new Map();
Â 
// ======================================================
// GMX V2 READ-ONLY ADAPTER
// Arbitrum One / Chain ID 42161
// ======================================================
Â 
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
Â 
Â 
Â 
Â 
// ======================================================
// V6 PRO SIGNAL ENGINE - MERGED MODULE
// This module is embedded into the original V6.3.1 engine.
// Original engines are preserved; V6 adds a complete directional
// signal pipeline and dedicated /v6/* routes.
// ======================================================
const FUTURES_V6 = (() => {
// ======================================================
// HTTP / RPC HELPERS
// ======================================================
Â 
function json(data, status = 200) {
return new Response(JSON.stringify(data, null, 2), {
status,
headers: {
"content-type": "application/json; charset=utf-8",
"cache-control": "no-store"
}
});
}
Â 
// V8 dynamic-universe integration point: feed the resolved GMX market catalog through v8RankFastMarkets() and v8SelectDeepCandidates() before deep candle fetching.
Â 
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
Â 
async function fetchJson(url, options = {}) {
const response = await fetchTimeout(url, options);
const text = await response.text();
Â 
if (!response.ok) {
throw new Error(`HTTP ${response.status}: ${text.slice(0, 250)}`);
}
Â 
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
Â 
async function rpc(env, method, params = []) {
if (!env.ARBITRUM_RPC) {
throw new Error("ARBITRUM_RPC is not configured");
}
Â 
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
Â 
const data = await response.json();
Â 
if (data.error) {
throw new Error(`RPC ${data.error.code}: ${data.error.message}`);
}
Â 
return data.result;
}
Â 
async function verifyArbitrumRPC(env) {
const chainHex = await rpc(env, "eth_chainId");
const chainId = parseInt(chainHex, 16);
if (chainId !== GMX.CHAIN_ID) {
throw new Error(`Wrong RPC network: ${chainId}; expected ${GMX.CHAIN_ID}`);
}
Â 
const blockHex = await rpc(env, "eth_blockNumber");
return {
chainId,
blockNumber: parseInt(blockHex, 16)
};
}
Â 
// ======================================================
// CACHE
// ======================================================
Â 
async function cached(key, loader, ttl = CONFIG.MARKET_CACHE_TTL_MS) {
const now = Date.now();
const hit = CACHE.get(key);
Â 
if (hit && hit.expiresAt > now) {
return { value: hit.value, cache: "HIT" };
}
Â 
// Deduplicate concurrent requests for the same resource.
// This is critical for Cloudflare's per-invocation subrequest budget.
if (INFLIGHT.has(key)) {
const value = await INFLIGHT.get(key);
return { value, cache: "INFLIGHT" };
}
Â 
const promise = (async () => {
const value = await loader();
CACHE.set(key, { value, expiresAt: Date.now() + ttl });
return value;
})();
Â 
INFLIGHT.set(key, promise);
Â 
try {
const value = await promise;
return { value, cache: "MISS" };
} finally {
INFLIGHT.delete(key);
}
}
Â 
// ======================================================
// SYMBOL / MARKET NORMALIZATION
// ======================================================
Â 
function normalizeSymbol(symbol) {
if (!symbol) return null;
Â 
let s = String(symbol).trim().toUpperCase();
s = s.replace(/[-_/]?(PERP|USD|USDC|USDT)$/i, "");
s = s.replace(/[^A-Z0-9]/g, "");
Â 
return s || null;
}
Â 
function pairSymbol(symbol) {
return `${normalizeSymbol(symbol)}/USD`;
}
Â 
// ======================================================
// GMX MARKET DATA
// ======================================================
Â 
async function fetchGmxMarketsInfo() {
const urls = [
`${GMX.ORACLE}/markets/info`,
...GMX.FALLBACKS.map(base => `${base}/markets/info`)
];
Â 
let lastError;
Â 
for (const url of urls) {
try {
return await fetchJson(url, {
headers: { accept: "application/json" }
});
} catch (error) {
lastError = error;
}
}
Â 
throw lastError || new Error("All GMX market endpoints failed");
}
Â 
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
Â 
async function fetchGmxMarkets() {
const urls = [
`${GMX.ORACLE}/markets`,
...GMX.FALLBACKS.map(base => `${base}/markets`)
];
Â 
let lastError;
Â 
for (const url of urls) {
try {
return await fetchJson(url, {
headers: { accept: "application/json" }
});
} catch (error) {
lastError = error;
}
}
Â 
throw lastError || new Error("All GMX market catalog endpoints failed");
}
Â 
function marketArray(payload) {
if (Array.isArray(payload)) return payload;
if (Array.isArray(payload?.markets)) return payload.markets;
if (Array.isArray(payload?.data)) return payload.data;
return [];
}
Â 
function findMarket(rawMarkets, symbol) {
const wanted = normalizeSymbol(symbol);
Â 
return rawMarkets.find(m => {
const direct = [
m?.symbol, m?.indexTokenSymbol,
m?.indexToken?.symbol, m?.indexToken?.tokenSymbol
].filter(Boolean).map(normalizeSymbol);
Â 
if (direct.includes(wanted)) return true;
Â 
const names = [m?.name, m?.symbol].filter(Boolean).map(String);
return names.some(name => {
const base = name.split(/[\/\[\]\s_-]+/)[0];
return normalizeSymbol(base) === wanted || normalizeSymbol(name).startsWith(wanted);
});
}) || null;
}
Â 
// ======================================================
// OHLCV
// ======================================================
Â 
async function fetchCandles(symbol, timeframe, limit) {
const normalized = normalizeSymbol(symbol);
const key = `candles:${normalized}:${timeframe}:${limit}`;
Â 
const result = await cached(
key,
async () => {
const oracleUrl =
`${GMX.ORACLE}/prices/candles?tokenSymbol=${encodeURIComponent(normalized)}` +
`&period=${encodeURIComponent(timeframe)}&limit=${limit}`;
Â 
try {
const data = await fetchJson(oracleUrl, {
headers: { accept: "application/json" }
});
Â 
return normalizeCandles(data);
} catch {
const apiUrls = GMX.FALLBACKS.map(base =>
`${base}/prices/candles?tokenSymbol=${encodeURIComponent(normalized)}` +
`&period=${encodeURIComponent(timeframe)}&limit=${limit}`
);
Â 
let lastError;
Â 
for (const url of apiUrls) {
try {
return normalizeCandles(await fetchJson(url));
} catch (error) {
lastError = error;
}
}
Â 
throw lastError || new Error(`No candle source for ${normalized}`);
}
},
CONFIG.CANDLE_CACHE_TTL_MS
);
Â 
return result.value;
}
Â 
// Scan-safe candle fetch: one external request per timeframe.
// We intentionally do not fan out to multiple fallbacks inside a scan,
// because a 10-market x 4-timeframe scan must stay below Cloudflare's
// per-invocation subrequest budget. Single-symbol /v6/signal retains
// the resilient fallback path above.
async function fetchCandlesScan(symbol, timeframe, limit) {
const normalized = normalizeSymbol(symbol);
const key = `scan-candles:${normalized}:${timeframe}:${limit}`;
Â 
const result = await cached(
key,
async () => {
const url =
`${GMX.ORACLE}/prices/candles?tokenSymbol=${encodeURIComponent(normalized)}` +
`&period=${encodeURIComponent(timeframe)}&limit=${limit}`;
Â 
const data = await fetchJson(url, {
headers: { accept: "application/json" }
});
Â 
const candles = normalizeCandles(data);
if (!candles.length) {
throw new Error(`Empty candle data: ${normalized} ${timeframe}`);
}
return candles;
},
CONFIG.CANDLE_CACHE_TTL_MS
);
Â 
return result.value;
}
Â 
function normalizeCandles(payload) {
let raw = [];
Â 
if (Array.isArray(payload)) raw = payload;
else if (Array.isArray(payload?.candles)) raw = payload.candles;
else if (Array.isArray(payload?.data)) raw = payload.data;
else if (Array.isArray(payload?.ohlcv)) raw = payload.ohlcv;
Â 
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
Â 
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
Â 
candles.sort((a, b) => a.timestamp - b.timestamp);
return candles;
}
Â 
// ======================================================
// TECHNICAL INDICATORS
// ======================================================
Â 
function sma(values, period) {
if (values.length < period) return null;
const slice = values.slice(-period);
return slice.reduce((a, b) => a + b, 0) / period;
}
Â 
function ema(values, period) {
if (values.length < period) return null;
Â 
const k = 2 / (period + 1);
let value = values.slice(0, period)
.reduce((a, b) => a + b, 0) / period;
Â 
for (let i = period; i < values.length; i++) {
value = values[i] * k + value * (1 - k);
}
Â 
return value;
}
Â 
function trueRanges(candles) {
const out = [];
Â 
for (let i = 0; i < candles.length; i++) {
if (i === 0) {
out.push(candles[i].high - candles[i].low);
continue;
}
Â 
const c = candles[i];
const prev = candles[i - 1].close;
Â 
out.push(Math.max(
c.high - c.low,
Math.abs(c.high - prev),
Math.abs(c.low - prev)
));
}
Â 
return out;
}
Â 
function atr(candles, period = 14) {
const tr = trueRanges(candles);
return ema(tr, period);
}
Â 
function rsi(candles, period = 14) {
if (candles.length <= period) return null;
Â 
let gains = 0;
let losses = 0;
Â 
for (let i = 1; i <= period; i++) {
const diff = candles[i].close - candles[i - 1].close;
if (diff >= 0) gains += diff;
else losses += Math.abs(diff);
}
Â 
let avgGain = gains / period;
let avgLoss = losses / period;
Â 
for (let i = period + 1; i < candles.length; i++) {
const diff = candles[i].close - candles[i - 1].close;
const gain = Math.max(diff, 0);
const loss = Math.max(-diff, 0);
Â 
avgGain = ((avgGain * (period - 1)) + gain) / period;
avgLoss = ((avgLoss * (period - 1)) + loss) / period;
}
Â 
if (avgLoss === 0) return 100;
Â 
const rs = avgGain / avgLoss;
return 100 - (100 / (1 + rs));
}
Â 
function percentChange(candles, bars) {
if (candles.length <= bars) return 0;
const a = candles[candles.length - 1].close;
const b = candles[candles.length - 1 - bars].close;
return b ? ((a - b) / b) * 100 : 0;
}
Â 
function highest(candles, period) {
return Math.max(...candles.slice(-period).map(c => c.high));
}
Â 
function lowest(candles, period) {
return Math.min(...candles.slice(-period).map(c => c.low));
}
Â 
// ======================================================
// TREND ENGINE
// ======================================================
Â 
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
Â 
const closes = candles.map(c => c.close);
const fast = ema(closes, 21);
const slow = ema(closes, 55);
const last = closes[closes.length - 1];
const rs = rsi(candles, 14);
Â 
let score = 0;
Â 
if (last > fast) score += 25;
else score -= 25;
Â 
if (fast > slow) score += 35;
else score -= 35;
Â 
if (rs !== null) {
if (rs >= 52 && rs <= 72) score += 20;
else if (rs <= 48 && rs >= 28) score -= 20;
else if (rs > 72) score += 5;
else if (rs < 28) score -= 5;
}
Â 
const change = percentChange(candles, Math.min(12, candles.length - 1));
Â 
if (change > 0) score += 20;
else if (change < 0) score -= 20;
Â 
const direction =
score >= 30 ? "BULLISH" :
score <= -30 ? "BEARISH" :
"NEUTRAL";
Â 
return {
direction,
score: Math.max(-100, Math.min(100, score)),
emaFast: fast,
emaSlow: slow,
rsi: rs,
change
};
}
Â 
function buildTrendConfluence(data) {
const macro = timeframeTrend(data["4h"]);
const trend = timeframeTrend(data["1h"]);
const entry = timeframeTrend(data["15m"]);
const fast = timeframeTrend(data["5m"]);
Â 
const bullish = [
macro.direction === "BULLISH",
trend.direction === "BULLISH",
entry.direction === "BULLISH",
fast.direction === "BULLISH"
].filter(Boolean).length;
Â 
const bearish = [
macro.direction === "BEARISH",
trend.direction === "BEARISH",
entry.direction === "BEARISH",
fast.direction === "BEARISH"
].filter(Boolean).length;
Â 
const longScore =
(macro.direction === "BULLISH" ? 30 : 0) +
(trend.direction === "BULLISH" ? 30 : 0) +
(entry.direction === "BULLISH" ? 25 : 0) +
(fast.direction === "BULLISH" ? 15 : 0);
Â 
const shortScore =
(macro.direction === "BEARISH" ? 30 : 0) +
(trend.direction === "BEARISH" ? 30 : 0) +
(entry.direction === "BEARISH" ? 25 : 0) +
(fast.direction === "BEARISH" ? 15 : 0);
Â 
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
Â 
// ======================================================
// MOMENTUM ENGINE
// ======================================================
Â 
function momentumScore(candles) {
if (!candles || candles.length < 30) {
return { long: 0, short: 0, rsi: null, change5: 0, change15: 0 };
}
Â 
const rs = rsi(candles, 14);
const change5 = percentChange(candles, 5);
const change15 = percentChange(candles, 15);
Â 
let long = 0;
let short = 0;
Â 
if (change5 > 0.25) long += 20;
if (change5 > 0.75) long += 10;
if (change15 > 0.5) long += 20;
if (change15 > 1.5) long += 10;
Â 
if (change5 < -0.25) short += 20;
if (change5 < -0.75) short += 10;
if (change15 < -0.5) short += 20;
if (change15 < -1.5) short += 10;
Â 
if (rs !== null) {
if (rs >= 52 && rs <= 68) long += 20;
if (rs <= 48 && rs >= 32) short += 20;
Â 
if (rs > 78) long -= 15;
if (rs < 22) short -= 15;
}
Â 
return {
long: Math.max(0, Math.min(100, long)),
short: Math.max(0, Math.min(100, short)),
rsi: rs,
change5,
change15
};
}
Â 
// ======================================================
// VOLUME / PARTICIPATION ENGINE
// ======================================================
//
// GMX OHLCV does not provide exchange-style volume in the
// documented candle format. Therefore this engine NEVER
// invents volume. It uses candle range expansion as a
// participation proxy and explicitly labels it as such.
// ======================================================
Â 
function participationScore(candles) {
if (!candles || candles.length < 25) {
return { long: 0, short: 0, expansion: 0 };
}
Â 
const ranges = candles.map(c => c.high - c.low);
const recent = sma(ranges, 5);
const base = sma(ranges.slice(0, -5), Math.min(20, ranges.length - 5));
Â 
if (!recent || !base || base <= 0) {
return { long: 0, short: 0, expansion: 0 };
}
Â 
const expansion = recent / base;
const last = candles[candles.length - 1];
Â 
let long = 0;
let short = 0;
Â 
if (expansion > 1.15) {
if (last.close > last.open) long += 20;
if (last.close < last.open) short += 20;
}
Â 
if (expansion > 1.5) {
if (last.close > last.open) long += 10;
if (last.close < last.open) short += 10;
}
Â 
return {
long: Math.min(100, long),
short: Math.min(100, short),
expansion
};
}
Â 
// ======================================================
// MARKET STRUCTURE
// ======================================================
Â 
function structureScore(candles) {
if (!candles || candles.length < 30) {
return { long: 0, short: 0, breakout: "NONE" };
}
Â 
const last = candles[candles.length - 1];
const prior = candles.slice(0, -1);
Â 
const resistance = highest(prior, 20);
const support = lowest(prior, 20);
Â 
let long = 0;
let short = 0;
let breakout = "NONE";
Â 
if (last.close > resistance) {
long += 25;
breakout = "UPSIDE";
}
Â 
if (last.close < support) {
short += 25;
breakout = "DOWNSIDE";
}
Â 
const recentHigh = highest(candles, 10);
const recentLow = lowest(candles, 10);
Â 
if (last.close >= recentHigh * 0.995) long += 10;
if (last.close <= recentLow * 1.005) short += 10;
Â 
return { long, short, breakout, resistance, support };
}
Â 
// ======================================================
// OI / FUNDING ENGINE
// ======================================================
//
// /markets/info provides near-live OI and funding. We compare
// against a previous snapshot stored in KV. A missing previous
// value is treated as "unknown", never as zero confirmation.
// ======================================================
Â 
function derivativesScore(current, previous) {
const oi = extractOpenInterest(current);
const funding = extractFunding(current);
Â 
const previousOI = previous ? extractOpenInterest(previous) : 0;
Â 
let oiChange = null;
if (previous && previousOI > 0 && oi > 0) {
oiChange = ((oi - previousOI) / previousOI) * 100;
}
Â 
let long = 0;
let short = 0;
Â 
if (oiChange !== null) {
const priceBias = current.__priceBias || 0;
Â 
if (oiChange > 3 && priceBias > 0) long += 20;
if (oiChange > 3 && priceBias < 0) short += 20;
Â 
if (oiChange < -3 && priceBias > 0) short += 8;
if (oiChange < -3 && priceBias < 0) long += 8;
}
Â 
// Funding is a crowding filter, not a standalone entry signal.
if (funding > 0.0008) short += 12;
if (funding < -0.0008) long += 12;
Â 
if (funding > 0.003) short += 8;
if (funding < -0.003) long += 8;
Â 
return {
long: Math.min(40, long),
short: Math.min(40, short),
oi,
oiChange,
funding
};
}
Â 
// ======================================================
// RISK DETECTORS
// ======================================================
Â 
function fakeMoveRisk(candles) {
if (!candles || candles.length < 20) return 0;

const change = Math.abs(percentChange(candles, 3));
let risk = 0;

// V13.8: derivatives are intentionally excluded from score/risk.
// Keep only pure price-action risk here.
if (change > 7) risk += 20;

return Math.min(40, risk);
}
Â 
function exhaustionRisk(candles) {
const rs = rsi(candles, 14);
if (rs === null) return 0;
Â 
if (rs >= 82 || rs <= 18) return 25;
if (rs >= 76 || rs <= 24) return 12;
Â 
return 0;
}
Â 
function chopRisk(trend) {
if (trend.alignment === "MIXED") return 15;
return 0;
}
Â 
function totalRisk(...risks) {
return Math.min(100, risks.reduce((a, b) => a + b, 0));
}
Â 
// ======================================================
// MARKET SNAPSHOT
// ======================================================
Â 
async function buildMarketSnapshot(symbol, env, options = {}) {
const normalized = normalizeSymbol(symbol);
const scanMode = options.scanMode === true;
Â 
// In a full scan the market catalog is fetched once and shared.
// For a single-symbol request the normal cached path is retained.
const marketPromise = options.marketResult
? Promise.resolve(options.marketResult)
: cached("markets-info", fetchGmxMarketsInfo, CONFIG.MARKET_CACHE_TTL_MS);
Â 
const candleFetcher = scanMode ? fetchCandlesScan : fetchCandles;
Â 
const [marketResult, c5, c15, c1h, c4h] = await Promise.all([
marketPromise,
candleFetcher(normalized, "5m", CONFIG.CANDLE_LIMIT["5m"]),
candleFetcher(normalized, "15m", CONFIG.CANDLE_LIMIT["15m"]),
candleFetcher(normalized, "1h", CONFIG.CANDLE_LIMIT["1h"]),
candleFetcher(normalized, "4h", CONFIG.CANDLE_LIMIT["4h"])
]);
Â 
const rawMarkets = marketArray(marketResult.value);
const raw = findMarket(rawMarkets, normalized);
Â 
if (!raw) {
throw new Error(`GMX market not found: ${normalized}`);
}
Â 
const counts = {
"5m": c5.length,
"15m": c15.length,
"1h": c1h.length,
"4h": c4h.length
};
Â 
const insufficient = Object.entries(counts)
.filter(([_, n]) => n < 55)
.map(([tf]) => tf);
Â 
if (insufficient.length) {
throw new Error(`Insufficient candle data: ${insufficient.join(",")}`);
}
Â 
const lastPrice =
c5?.[c5.length - 1]?.close ||
c15?.[c15.length - 1]?.close ||
0;
Â 
const priceBias = percentChange(c15, 3);
raw.__priceBias = priceBias;
Â 
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
Â 
// ======================================================
// SIGNAL ENGINE
// ======================================================
Â 
Â 
// ======================================================
// V7 ADVANCED FAST CONFLUENCE ENGINE
// All calculations below are local and use already-fetched candles.
// They add ZERO network subrequests and therefore do not add API latency.
// The engine uses confirmation voting rather than requiring every indicator.
// ======================================================
Â 
function v7Closes(candles) {
return (candles || []).map(c => Number(c.close)).filter(Number.isFinite);
}
Â 
function v7Volumes(candles) {
return (candles || []).map(c => Number(c.volume)).filter(Number.isFinite);
}
Â 
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
Â 
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
Â 
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
Â 
function v7Macd(candles) {
const closes = v7Closes(candles);
if (closes.length < 35) return null;
const fast = ema(closes, 12);
const slow = ema(closes, 26);
if (![fast,slow].every(Number.isFinite)) return null;
const macd = fast - slow;
Â 
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
Â 
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
Â 
return {
bullish: Number.isFinite(rsiLeft) && Number.isFinite(rsiRight) &&
lowRight < lowLeft && rsiRight > rsiLeft,
bearish: Number.isFinite(rsiLeft) && Number.isFinite(rsiRight) &&
highRight > highLeft && rsiRight < rsiLeft,
rsi: rsiNow
};
}
Â 
function v7Regime(candles) {
const closes = v7Closes(candles);
if (closes.length < 50) return { regime: "UNKNOWN", adx: null };
const adx = v7Adx(candles, 14);
const atrNow = atr(candles, 14);
const price = closes[closes.length - 1];
const ema20 = ema(closes, 20);
const ema50 = ema(closes, 50);
const atrPct = price > 0 && Number.isFinite(atrNow) ? atrNow / price * 100 : 0;
Â 
let regime = "RANGE";
if (Number.isFinite(adx) && adx >= 25) regime = "TREND";
else if (Number.isFinite(adx) && adx <= 18) regime = "RANGE";
Â 
if (atrPct >= 2.5) regime = "HIGH_VOL";
if (Number.isFinite(ema20) && Number.isFinite(ema50) &&
Math.abs(ema20 - ema50) / price < 0.0015 &&
(!Number.isFinite(adx) || adx < 22)) regime = "CHOP";
Â 
return { regime, adx, atrPct, ema20, ema50 };
}
Â 
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
Â 
const long = direction === "LONG";
const short = direction === "SHORT";
const confirmations = [];
const contradictions = [];
Â 
if (Number.isFinite(price) && Number.isFinite(vwap)) {
if ((long && price > vwap) || (short && price < vwap)) confirmations.push("VWAP");
else contradictions.push("VWAP");
}
Â 
if ([ema20,ema50].every(Number.isFinite)) {
if ((long && ema20 > ema50) || (short && ema20 < ema50)) confirmations.push("EMA20_50");
else contradictions.push("EMA20_50");
}
Â 
if (Number.isFinite(ema200)) {
if ((long && price > ema200) || (short && price < ema200)) confirmations.push("EMA200");
else contradictions.push("EMA200");
}
Â 
if (Number.isFinite(adx)) {
if (adx >= 22) confirmations.push("ADX");
else contradictions.push("ADX_WEAK");
}
Â 
if (Number.isFinite(macd?.histogram)) {
if ((long && macd.histogram > 0) || (short && macd.histogram < 0)) confirmations.push("MACD");
else contradictions.push("MACD");
}
Â 
if ((long && div.bullish) || (short && div.bearish)) confirmations.push("DIVERGENCE");
if ((long && div.bearish) || (short && div.bullish)) contradictions.push("DIVERGENCE");
Â 
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
Â 
// Fast-vote design: require only 2 confirmations, not every indicator.
const votes = confirmations.length - contradictions.length * 0.75;
const boost = Math.max(-8, Math.min(10, confirmations.length * 2 - contradictions.length * 1.5));
Â 
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
Â 
Â 
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
Â 
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
Â 
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
Â 
function scoreSignal(snapshot, previousMarket) {
const c5 = snapshot.candles["5m"] || [];
const c15 = snapshot.candles["15m"] || [];
const c1h = snapshot.candles["1h"] || [];
const c4h = snapshot.candles["4h"] || [];
Â 
const trend = snapshot.trend;
const momentum = momentumScore(c15);
const participation = participationScore(c15);
const structure = structureScore(c15);
const derivatives = derivativesScore(snapshot.market, previousMarket);
Â 
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
Â 
// Fast local confirmation: no additional network calls.
const advancedLong = v7AdvancedConfirmation(snapshot, "LONG");
const advancedShort = v7AdvancedConfirmation(snapshot, "SHORT");
const precisionLong = v91EntryPrecision(snapshot, "LONG");
const precisionShort = v91EntryPrecision(snapshot, "SHORT");
const radar = V8_UNIVERSE.PUMP_RADAR.enabled ? v8PumpRadar(snapshot.market, previousMarket) : null;
Â 
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
Â 
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
  longRaw - risk * 0.30 + advancedLong.boost
));
const shortScore = Math.max(0, Math.min(100,
  shortRaw - risk * 0.30 + advancedShort.boost
));
const edge = Math.abs(longScore - shortScore);

const reasons = { long: [], short: [], common: [] };
Â 
// Stage 1: directional signal.
// Two-of-four trend confluence is enough to produce a VALID/WATCH signal.
// Stage 2: live execution remains stricter and requires 3-of-4.
const longEligible =
longScore >= CONFIG.VALID_SIGNAL_SCORE &&
longScore >= shortScore + CONFIG.MIN_EDGE &&
trend.bullish >= 2 &&
advancedLong.ready &&
risk < 45 &&
(!V8_UNIVERSE.PRECISION.enabled || precisionLong.ready) &&
!entryQuality.overextended;
Â 
const shortEligible =
shortScore >= CONFIG.VALID_SIGNAL_SCORE &&
shortScore >= longScore + CONFIG.MIN_EDGE &&
trend.bearish >= 2 &&
advancedShort.ready &&
risk < 45 &&
(!V8_UNIVERSE.PRECISION.enabled || precisionShort.ready) &&
!entryQuality.overextended;
Â 
if (trend.bullish < 2) reasons.long.push(`trend_confluence=${trend.bullish}/4`);
if (trend.bearish < 2) reasons.short.push(`trend_confluence=${trend.bearish}/4`);
Â 
if (longScore < CONFIG.VALID_SIGNAL_SCORE) {
reasons.long.push(`score=${longScore.toFixed(2)}<${CONFIG.VALID_SIGNAL_SCORE}`);
}
if (shortScore < CONFIG.VALID_SIGNAL_SCORE) {
reasons.short.push(`score=${shortScore.toFixed(2)}<${CONFIG.VALID_SIGNAL_SCORE}`);
}
Â 
if (longScore < shortScore + CONFIG.MIN_EDGE) {
reasons.long.push(`edge=${(longScore-shortScore).toFixed(2)}<${CONFIG.MIN_EDGE}`);
}
if (shortScore < longScore + CONFIG.MIN_EDGE) {
reasons.short.push(`edge=${(shortScore-longScore).toFixed(2)}<${CONFIG.MIN_EDGE}`);
}
Â 
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
Â 
for (const [tf, n] of [
["5m", c5.length],
["15m", c15.length],
["1h", c1h.length],
["4h", c4h.length]
]) {
if (n < 55) reasons.common.push(`${tf}_data_below_55`);
}
Â 
let direction = "NO_TRADE";
const score = Math.max(longScore, shortScore);
Â 
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
Â 
const executionScore =
direction === "LONG" ? longScore :
direction === "SHORT" ? shortScore : 0;
Â 
const executionTrendConfluence =
direction === "LONG" ? trend.bullish :
direction === "SHORT" ? trend.bearish : 0;
Â 
const executionEligible =
direction !== "NO_TRADE" &&
executionScore >= CONFIG.EXECUTION_SCORE &&
edge >= CONFIG.EXECUTION_MIN_EDGE &&
executionTrendConfluence >= 3 &&
risk < CONFIG.EXECUTION_MAX_RISK &&
!entryQuality.overextended;
Â 
if (direction === "LONG" && executionTrendConfluence < 3) {
reasons.long.push(`execution_trend_confluence=${executionTrendConfluence}/4`);
}
if (direction === "SHORT" && executionTrendConfluence < 3) {
reasons.short.push(`execution_trend_confluence=${executionTrendConfluence}/4`);
}
Â 
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
Â 
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
scoreModel: {
normalizedTo100: true,
weightedMaximum: 100,
activeComponents: ["trend", "momentum", "participation", "structure", "derivatives"],
excludedComponents: ["asset_identity", "market_cap", "major_symbol_bias", "liquidity_bonus"],
fairAssetScoring: true,
availabilityAwareScoring: true,
scoreEngineVersion: "V15.3-VELOCITY-RADAR-AVAILABILITY-AWARE-MULTIFACTOR",
note: "Score is asset-agnostic and availability-aware: available current market evidence determines the score; unavailable factors are neutral and their weights are re-normalized. Asset identity, market size, major-symbol status and liquidity do not add entry-score points."
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
Â 
// ======================================================
// ENTRY / SL / TP / RISK
// ======================================================
Â 
function leverageFromScore(score) {
let lev = CONFIG.DEFAULT_LEVERAGE;
for (const tier of CONFIG.LEVERAGE_TIERS) {
if (Number(score) >= tier.minScore) lev = Math.max(lev, tier.leverage);
}
return Math.min(lev, CONFIG.MAX_LEVERAGE);
}
Â 
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
Â 
function calculateRiskBasedNotional(balance, entry, stopLoss) {
if (!(balance > 0) || !(entry > 0) || !(stopLoss > 0)) return 0;
const riskCapital = balance * CONFIG.RISK_PER_TRADE;
const stopPercent = Math.abs(entry - stopLoss) / entry;
if (!(stopPercent > 0)) return 0;
return riskCapital / stopPercent;
}
Â 
Â 
// ======================================================
Â 
function buildTradePlan(snapshot, analysis) {
const candles = snapshot.candles["15m"];
const entry = snapshot.price;
const a = atr(candles, 14);
Â 
if (!entry || !a || a <= 0) {
return {
valid: false,
reason: "Insufficient price/ATR data"
};
}
Â 
const stopDistance = a * CONFIG.ATR_STOP_MULTIPLIER;
Â 
let stopLoss;
let tp1;
let tp2;
let tp3;
Â 
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
Â 
const precisionExit = v91PrecisionExitPlan(snapshot, analysis, entry, stopLoss);
if (precisionExit) { tp1 = precisionExit.tp1; tp2 = precisionExit.tp2; tp3 = precisionExit.tp3; }
const riskPerUnit = Math.abs(entry - stopLoss);
const stopPercent = (riskPerUnit / entry) * 100;
Â 
const leverage = leverageFromScore(analysis.score);
const allocation = allocationFromScore(analysis.score);
Â 
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
Â 
function calculatePositionSize(balance, entry, stopLoss) {
return calculateRiskBasedNotional(balance, entry, stopLoss);
}
Â 
// ======================================================
// SIGNAL OBJECT
// ======================================================
Â 
async function generateSignal(symbol, env, options = {}) {
const normalized = normalizeSymbol(symbol);
const snapshot = await buildMarketSnapshot(normalized, env, options);
Â 
// Full scans keep the previous market snapshot in the single state object
// instead of doing one KV read/write per symbol.
const previousMarket = options.previousMarket || null;
Â 
const analysis = scoreSignal(snapshot, previousMarket);
const plan = buildTradePlan(snapshot, analysis);
Â 
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
Â 
price: snapshot.price,
tradePlan: plan,
Â 
trend: {
alignment: snapshot.trend.alignment,
macro4h: snapshot.trend.macro.direction,
trend1h: snapshot.trend.trend.direction,
entry15m: snapshot.trend.entry.direction,
fast5m: snapshot.trend.fast.direction
},
Â 
components: analysis.components,
diagnostics: analysis.rejectionReasons,
signalTier: analysis.tier,
executionEligible: analysis.executionEligible,
opportunity: {type: analysis.opportunity?.type || "STANDARD", score: Number(analysis.opportunity?.score || 0), direction: analysis.opportunity?.direction || analysis.direction, edge: Number(analysis.opportunity?.edge || 0), reasons: analysis.opportunity?.reasons || []},
riskScore: analysis.risk,
edge: analysis.edge,
dataQuality: analysis.dataQuality,
signalDiagnostics: analysis.diagnostics,
Â 
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
Â 
chain: {
chainId: GMX.CHAIN_ID,
healthCheck: "SKIPPED_IN_SCAN"
},
Â 
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
Â 
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
Â 
await saveMarketSnapshot(env, normalized, snapshot.market);
}
Â 
return signal;
}
Â 
// ======================================================
// FULL MARKET SCAN
// ======================================================
Â 
Â 
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
Â 
return score * 0.70 + Math.min(edge, 30) * 0.20 + Math.max(0, 40 - risk) * 0.25 + execution + radarBoost + dataCompleteness;
}
Â 
function baseAsset(symbol) {
return normalizeSymbol(symbol).replace(/-PERP$/i, "");
}
Â 
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
Â 
function selectPrioritySignals(signals, positions) {
const ranked = [...signals]
.filter(s => s?.executionEligible && s?.tradePlan?.valid)
.sort((a,b) => signalPriorityScore(b) - signalPriorityScore(a));
Â 
const selected = [];
let totalAllocation = 0;
let totalRisk = 0;
Â 
for (const signal of ranked) {
if (selected.length >= CONFIG.MAX_POSITIONS) break;
Â 
const conflict = exposureConflict(signal, [...positions, ...selected.map(s => ({
symbol: s.symbol
}))]);
if (conflict.conflict) continue;
Â 
const allocation = Number(
signal.tradePlan?.allocation ?? allocationFromScore(signal.score)
);
const risk = Number(CONFIG.RISK_PER_TRADE);
Â 
if (totalAllocation + allocation > CONFIG.MAX_TOTAL_CAPITAL_ALLOCATION + 1e-9) continue;
if (totalRisk + risk > CONFIG.MAX_TOTAL_RISK + 1e-9) continue;
Â 
selected.push(signal);
totalAllocation += allocation;
totalRisk += risk;
}
Â 
return {
selected,
totalAllocation,
totalRisk,
ranked
};
}
Â 
Â 
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
if (["VALID", "STRONG"].includes(signal.signalTier)) return true;
return CONFIG.NOTIFY_WATCH && signal.signalTier === "WATCH";
}
Â 
function markTelegramNotified(state, signal) {
if(!notificationEligible(signal))return;
if(!state.telegramEvents||typeof state.telegramEvents!=="object")state.telegramEvents={};
const symbol=baseAsset(signal?.symbol||""); if(!symbol)return;
state.telegramEvents[symbol]={direction:String(signal?.direction||"NO_TRADE").toUpperCase(),stage:signalEventStage(signal),key:signalNotificationKey(signal),updatedAt:Date.now()};
}

function formatTelegramExit(action) {
const isError = String(action?.action || "").toUpperCase() === "ERROR";
const isRadar = String(action?.lane || "").toUpperCase() === "RADAR";
const icon = isError ? "ðŸŸ " : (Number(action?.pnlUsd || 0) >= 0 ? "ðŸŸ¢" : "ðŸ”´");
const hasPnl=Number.isFinite(Number(action?.pnlUsd)) && Number.isFinite(Number(action?.pnlPercent));
const pnlPct = Number(action?.pnlPercent || 0);
const pnlUsd = Number(action?.pnlUsd || 0);
const lines = [
`${icon} ${isRadar ? "RADAR" : "GMX FUTURES"} EXIT â€” ${action?.action || "EXIT"}`,
"â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”",
`ðŸ“Œ ${action?.symbol || "UNKNOWN"} â€¢ ${action?.direction || "UNKNOWN"}`,
isRadar ? `ðŸ§­ Lane: RADAR / Paper simulation` : "",
`ðŸ“¥ Entry: ${action?.entryPrice != null ? formatPrice(action.entryPrice) : "N/A"}`,
`ðŸ“¤ Exit: ${action?.exitPrice != null ? formatPrice(action.exitPrice) : (action?.price != null ? formatPrice(action.price) : "N/A")}`,
action?.leverage != null ? `âš™ï¸ Leverage: ${Number(action.leverage).toFixed(0)}x` : "",
action?.notionalUsd != null ? `ðŸ“¦ Notional: $${Number(action.notionalUsd).toFixed(2)}` : "",
`ðŸ“‰ PnL: ${hasPnl ? `${pnlUsd >= 0 ? "+" : ""}$${pnlUsd.toFixed(2)} (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%)` : "NOT CALCULATED â€” PRICE DATA INVALID"}`,
`ðŸ“Š Exit score: ${Number(action?.exitScore || action?.radarScore || 0).toFixed(1)}/100`,
`ðŸ§­ Reason: ${action?.reason || "PROTECTION"}`,
`ðŸ’° Close: ${Number(action?.closePercent || 0)}%`,
action?.remainingPct != null ? `ðŸ“Š Remaining: ${Number(action.remainingPct).toFixed(2)}%` : ""
].filter(Boolean);
if (isError && action?.error) lines.push(`âš ï¸ Error: ${String(action.error).slice(0, 500)}`);
if (isRadar && action?.priceRatio && Number(action.priceRatio) > 25) lines.push(`âš ï¸ Price ratio: ${Number(action.priceRatio).toExponential(2)}x â€” paper result quarantined.`);
lines.push(isRadar
  ? "â„¹ï¸ PnL above is the simulated result that would have occurred at this exit price."
  : "â„¹ï¸ Telegram is notification-only; the bot does not wait for Telegram confirmation.");
return lines.join("\n");
}
Â 
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
Â 
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
Â 

// ======================================================
// V15.6.5 RADAR PRICE INTEGRITY / SCALE NORMALIZATION
// Radar is allowed to observe aggressively, but it must never
// create or report a paper position from mixed price scales.
// Core signal scoring and the multi-source Data Center are unchanged.
// ======================================================
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
  // V15.3.5: live price feed is initialized inside the scan body.
  // This is the authoritative current-price input for the independent Radar lane.
  let radarPriceFeed={available:false,source:null,prices:{},error:null};
  try{ radarPriceFeed=await fetchRadarLivePrices(); }catch(e){
    radarPriceFeed={available:false,source:null,prices:{},error:String(e?.message||e)};
  }
const state=await loadState(env);
if(!state.running)return{ok:true,status:"PAUSED",signals:[]};
const smartMoneyFlowHistory=state.smartMoneyFlowHistory&&typeof state.smartMoneyFlowHistory==="object"?state.smartMoneyFlowHistory:{};
let smartMoneyFlowData={available:false,source:null,trades:0,parsedTrades:0,symbols:0,bySymbol:{},error:null};

// V13.9.5: risk limits govern NEW POSITION OPENING, not market observation.
// A full position book must never stop the 5-minute scanner or Telegram alerts.
resetDailyLossIfNeeded(state);
const scanStartedAt=Date.now(),errors=[];let marketResult;
try{marketResult=await cached("markets-info",fetchGmxMarketsInfo,CONFIG.MARKET_CACHE_TTL_MS);}catch(error){const result={ok:false,status:"DATA_ENGINE_ERROR",scanned:0,requested:0,candidates:0,topSignals:[],errors:[{scope:"markets-info",error:safeError(error)}],timestamp:Date.now()};try{await sendTelegram(env,formatTelegramStatus(result));}catch(_){}return result;}
let tickerRows=[];let tickerError=null;
try{const tickerResult=await cached("markets-tickers",fetchGmxMarketsTickers,CONFIG.MARKET_CACHE_TTL_MS);tickerRows=marketArray(tickerResult);}catch(error){tickerError=safeError(error);}
let catalogRows=[];let catalogSource=null;
try{const catalogResult=await cached("markets-catalog",fetchGmxMarkets,CONFIG.MARKET_CACHE_TTL_MS);catalogRows=marketArray(catalogResult.value);catalogSource=GMX.ORACLE+"/markets";}catch(error){errors.push({scope:"markets-catalog",error:safeError(error)});}
const tickerBySymbol=new Map();
for(const t of tickerRows){const sym=v8NormSymbol(t?.symbol??t?.name??t?.ticker);if(sym)tickerBySymbol.set(sym,t);}
const unique=new Map();
for(const m of [...marketArray(marketResult.value),...catalogRows]){
const sym=v8NormSymbol(m?.symbol??m?.name??m?.ticker??m?.indexTokenSymbol);if(!sym)continue;
const t=tickerBySymbol.get(sym);
unique.set(sym,{...(unique.get(sym)||{}),...m,...(t||{}),symbol:sym});
}
const mergedMarkets=[...unique.values()];
const enriched=await enrichMarketsWithValues(mergedMarkets);
for(const m of enriched.markets){const symbol=v8NormSymbol(m?.symbol??m?.name??m?.ticker??m?.indexTokenSymbol) || normalizeSymbol(m?.symbol??m?.name??m?.ticker??m?.indexTokenSymbol);if(!symbol)continue;unique.set(symbol,{...(unique.get(symbol)||{}),...m,symbol});}
const allMarkets=[...unique.values()].filter(m=>m.isListed!==false);
// V15.6.3: Smart Money trade records expose market addresses, while the
// signal/radar engine works in symbols. Build the address -> symbol map from
// the already-fetched market universe; no extra network request is required.
smfSetMarketMap(allMarkets);
try{smartMoneyFlowData=await fetchSmartMoneyFlowData(env,smartMoneyFlowHistory);}catch(error){smartMoneyFlowData={available:false,source:null,trades:0,parsedTrades:0,symbols:0,bySymbol:{},error:safeError(error)};}
// Cloudflare subrequest safety: each deep symbol needs four candle calls.
// Keep a reserve for market metadata, Telegram notifications, paper alerts,
// and future small additions. The effective limit adapts to the configured
// Worker budget instead of blindly attempting the configured maximum.
const candleRequestsPerSymbol = 4;
// V13.9.7: scheduled position monitoring can consume candle subrequests
// before the scan starts. Reserve that equivalent budget so the scan does
// not exhaust the Worker invocation before Telegram notifications run.
const baseReservedSubrequests = Math.max(1, Number(CONFIG.RESERVED_SCAN_SUBREQUESTS || 10));
const additionalScheduledReserve = Math.max(0, Number(scanOptions?.additionalSubrequestReserve || 0));
const radarSubrequestReserve = CONFIG.RADAR_INDEPENDENT_ENABLED && CONFIG.RADAR_PAPER_ENABLED ? Math.max(0, Number(CONFIG.RADAR_SUBREQUEST_RESERVE || 0)) : 0;
const reservedSubrequests = baseReservedSubrequests + additionalScheduledReserve + radarSubrequestReserve;
const budgetDerivedDeepLimit = Math.max(1, Math.floor(
Math.max(0, Number(CONFIG.MAX_SCAN_SUBREQUESTS || 50) - reservedSubrequests) / candleRequestsPerSymbol
));
const effectiveDeepScanLimit = Math.min(
Number(CONFIG.DEEP_SCAN_LIMIT || 18),
budgetDerivedDeepLimit
);
// V15.3.5: ZERO-CYCLE-DELAY RADAR.
// Add the current market sample BEFORE Radar scoring so the current invocation
// can use the newest price together with persisted prior samples. Previous snapshots
// remain untouched until after scoring, preserving the prior/current comparison.
const radarHistory=state.radarHistory&&typeof state.radarHistory==="object"?state.radarHistory:{};
const radarNow=Date.now();

// V15.3.5: one and only one current-sample update, BEFORE every Radar score.
// Inject the live Oracle price into the market object so v8PumpRadar() consumes
// the same authoritative price that is written to history.
const radarMarkets=allMarkets.map(m=>{
  const sym=v8NormSymbol(m?.symbol??m?.name??m?.ticker??m?.indexTokenSymbol);
  const livePx=v1565NormalizePrice(radarPriceFeed?.prices?.[sym]);
  const nativePx=v1565RadarNativePrice(m);
  const sourcePrice=livePx>0 ? livePx : nativePx;
  // Preserve native GMX fields for later integrity checks. Do not destroy
  // the alternate price evidence when injecting the live Radar feed.
  return sourcePrice>0 ? {
    ...m,
    __radarLivePrice:livePx,
    __radarNativePrice:nativePx,
    price:sourcePrice,
    markPrice:sourcePrice,
    indexPrice:sourcePrice
  } : m;
});

for(const m of radarMarkets){
  const sym=v8NormSymbol(m?.symbol??m?.name??m?.ticker??m?.indexTokenSymbol);
  if(!sym) continue;
  const px=Number(m?.price??m?.markPrice??m?.indexPrice??m?.oraclePrice??m?.midPrice);
  if(!Number.isFinite(px) || px<=0) continue;
  const arr=Array.isArray(radarHistory[sym])?radarHistory[sym].slice(-47):[];
  const last=arr[arr.length-1];
  const vol=Number(m?.volume24h??m?.volume??m?.stats?.volume24h??m?.stats?.volume??0)||0;
  if(!last || radarNow-Number(last.at||0)>=30000){
    arr.push({at:radarNow,price:px,volume24h:vol});
  }else{
    arr[arr.length-1]={at:Number(last.at||radarNow),price:px,volume24h:vol};
  }
  radarHistory[sym]=arr.slice(-48);
}
state.radarHistory=radarHistory;
const radarMarketsWithFlow=radarMarkets.map(m=>{const sym=v8NormSymbol(m?.symbol??m?.name??m?.ticker??m?.indexTokenSymbol);const flow=smartMoneyFlowData?.bySymbol?.[sym]||null;return flow?{...m,__smartMoneyFlow:flow}:m;});

const previousSnapshots=state.marketSnapshots&&typeof state.marketSnapshots==="object"?state.marketSnapshots:{};
// V15.3.7 DEPLOY FINGERPRINT: syntax-fixed Radar path; do not duplicate fastRows assignment.
const fastRows=v8RankFastMarkets(radarMarketsWithFlow,previousSnapshots,radarHistory);
const universeRotationCursor=Number(state.universeRotationCursor||0);
const deepRows=v8SelectDeepCandidates(fastRows,universeRotationCursor).slice(0,effectiveDeepScanLimit);
const symbols=deepRows.map(x=>x.symbol).filter(Boolean);
state.universeRotationCursor=(universeRotationCursor+1)%1000000;
const fastReasonCounts={};
for(const m of allMarkets){const f=v8FastMarketFilter(m);if(!f.eligible)for(const r of f.reasons||[])fastReasonCounts[r]=(fastReasonCounts[r]||0)+1;}
// V14.0.1: Radar coverage is calculated over the complete eligible universe.
const radarRows=radarMarketsWithFlow.map(m=>{
 const symbol=v8NormSymbol(m?.symbol??m?.name??m?.ticker??m?.indexTokenSymbol);
 const previous=previousSnapshots?.[symbol]?.market||previousSnapshots?.[symbol]||null;
 const history=radarHistory?.[symbol] || [];
 const radarPrice=Number(m?.price??m?.markPrice??m?.indexPrice??m?.oraclePrice??m?.midPrice);
 const active=m?.isActive!==false && m?.isListed!==false;
 const pumpRadar=CONFIG.PUMP_RADAR_ENABLED?v8PumpRadar(m,previous,history):null;
 // V15.6.2: Radar is an independent discovery lane. Do not discard a listed
 // GMX market merely because the fast/deep signal filter lacks a market-native
 // price or liquidity field. The live Oracle price injected above is enough
 // for Radar price/momentum detection.
 return {market:m,symbol,pumpRadar,radarEligible:Boolean(symbol&&active&&radarPrice>0),...v8FastMarketFilter(m)};
}).filter(x=>x.radarEligible);
const radarRanked=radarRows.map(x=>({symbol:x.symbol,score:Number(x.pumpRadar?.score||0),direction:x.pumpRadar?.direction||"NEUTRAL",edge:Number(x.pumpRadar?.edge||0),reasons:x.pumpRadar?.reasons||[]})).sort((a,b)=>b.score-a.score);
const radarDirectional=radarRows.filter(x=>x?.pumpRadar?.direction!=="NEUTRAL");
const radarPrioritySymbols=radarRanked.filter(x=>x.direction!=="NEUTRAL"&&Number(x.score||0)>=Number(CONFIG.PUMP_RADAR_WATCH_SCORE||50)).slice(0,Math.max(6,Number(CONFIG.NOTIFY_EVENT_MAX||6))).map(x=>x.symbol);
const mergedDeepSymbols=[...new Set([...radarPrioritySymbols,...symbols])].slice(0,effectiveDeepScanLimit);
symbols.splice(0,symbols.length,...mergedDeepSymbols);
const radarLongCount=radarDirectional.filter(x=>x.pumpRadar.direction==="LONG").length;
const radarShortCount=radarDirectional.filter(x=>x.pumpRadar.direction==="SHORT").length;
const fastFilterDiagnostics={total:allMarkets.length,eligible:fastRows.length,rejected:allMarkets.length-fastRows.length,rejectionReasons:fastReasonCounts,majorMarkets:allMarkets.map(m=>v8NormSymbol(m?.symbol??m?.name??m?.ticker)).filter(s=>V8_UNIVERSE.MAJOR_SYMBOLS.includes(s)).slice(0,30),pumpRadar:{enabled:!!CONFIG.PUMP_RADAR_ENABLED,watchScore:CONFIG.PUMP_RADAR_WATCH_SCORE,hotScore:CONFIG.PUMP_RADAR_HOT_SCORE,coverageMarkets:radarRows.length,directionalMarkets:radarDirectional.length,longMarkets:radarLongCount,shortMarkets:radarShortCount,top:radarRanked.slice(0,30)}};
const results=[];const batchSize=Math.max(1, Math.min(CONFIG.SCAN_BATCH_SIZE || 2, 2));
for(let i=0;i<symbols.length;i+=batchSize){const batch=symbols.slice(i,i+batchSize);const batchResults=await Promise.all(batch.map(async symbol=>{try{return await generateSignal(symbol,env,{scanMode:true,marketResult,previousMarket:previousSnapshots[symbol]?.market||null});}catch(error){errors.push({symbol,scope:"deep_scan",error:safeError(error)});return null;}}));results.push(...batchResults.filter(Boolean));}
const directional=results.filter(s=>s.direction!=="NO_TRADE").sort((a,b)=>signalPriorityScore(b)-signalPriorityScore(a));
const radarEarly=results.filter(s=>s?.opportunity?.type==="EARLY_MOMENTUM"&&s?.opportunity?.score>=CONFIG.PUMP_RADAR_WATCH_SCORE);
const valid=directional.filter(s=>["VALID","STRONG"].includes(s.signalTier)),watch=directional.filter(s=>s.signalTier==="WATCH"),notificationPool=[...valid,...watch,...radarEarly].filter(notificationEligible).sort((a,b)=>signalPriorityScore(b)-signalPriorityScore(a));
// V14.0.1: event-based notification pool. No repeated top-3 snapshots.
const notifyLimit=Math.max(1,Number(CONFIG.NOTIFY_EVENT_MAX||6));
const eventPool=[]; const eventSeen=new Set();
for(const signal of notificationPool){const k=`${baseAsset(signal.symbol)}|${String(signal.direction).toUpperCase()}`;if(eventSeen.has(k)||!canNotifyTelegram(state,signal))continue;eventSeen.add(k);eventPool.push(signal);}
const notifySignals=[]; const notifyUsed=new Set();
for(const direction of ["LONG","SHORT"]){const candidate=eventPool.find(x=>x.direction===direction);if(candidate&&notifySignals.length<notifyLimit){notifySignals.push(candidate);notifyUsed.add(candidate.id);}}
for(const signal of eventPool){if(notifySignals.length>=notifyLimit)break;if(notifyUsed.has(signal.id))continue;notifySignals.push(signal);notifyUsed.add(signal.id);}
notifySignals.sort((a,b)=>signalPriorityScore(b)-signalPriorityScore(a));
let livePositions=[],livePositionError=null;
if(executionEnabled(env)&&valid.length){try{const live=await getLiveContext(env);const fetched=await live.sdk.fetchPositionsInfo({address:live.account});livePositions=Array.isArray(fetched)?fetched:[];}catch(error){livePositionError=safeError(error);}}
const existingCount=livePositions.length,remainingSlots=Math.max(0,CONFIG.MAX_POSITIONS-existingCount);
const entryRiskAllowed = Number(state.dailyLoss || 0) > -CONFIG.MAX_DAILY_LOSS;
const selection=selectPrioritySignals(entryRiskAllowed && remainingSlots>0?valid:[],livePositions);
const top=selection.selected.slice(0,remainingSlots);
// V15.3.5: radar history was already updated before scoring; do not add a second sample here.
state.marketSnapshots={};
for(const m of allMarkets){const sym=v8NormSymbol(m?.symbol??m?.name??m?.ticker??m?.indexTokenSymbol);if(!sym)continue;state.marketSnapshots[sym]={market:{
price:v8HighMetric(m,["price","markPrice","indexPrice","currentPrice","indexPriceUsd"]),
volume24h:v8HighMetric(m,["volume24h","volume","dailyVolume","volumeUsd24h"]),
openInterest:extractOpenInterest(m),
fundingRate:extractFunding(m),
longInterestUsd:v132NumberValue(m?.longInterestUsd),
shortInterestUsd:v132NumberValue(m?.shortInterestUsd),
oiUpdatedAt:m?.updatedAt ?? m?.openInterestUpdatedAt ?? null,
high24h:v8HighMetric(m,["high24h","highPrice24h","dailyHigh"]),
low24h:v8HighMetric(m,["low24h","lowPrice24h","dailyLow"])
},savedAt:Date.now()};}
for(const signal of results){if(signal?.symbol&&signal._marketSnapshotForState){state.marketSnapshots[signal.symbol]=signal._marketSnapshotForState;delete signal._marketSnapshotForState;}}
state.lastScan=Date.now();state.signals=notifySignals;state.opportunityRanking=notificationPool.slice(0,20).map((s,index)=>({rank:index+1,symbol:s.symbol,direction:s.direction,tier:s.signalTier,score:s.score,opportunityScore:Number(s.opportunity?.score||0),opportunityType:s.opportunity?.type||"STANDARD",edge:s.edge,risk:s.riskScore,executionEligible:!!s.executionEligible,priority:Number(signalPriorityScore(s).toFixed(2))}));state.lastDiagnostics=results.sort((a,b)=>signalPriorityScore(b)-signalPriorityScore(a)).slice(0,50).map(s=>({symbol:s.symbol,direction:s.direction,tier:s.signalTier,score:s.score,longScore:s.longScore,shortScore:s.shortScore,edge:s.edge,risk:s.riskScore,priority:Number(signalPriorityScore(s).toFixed(2)),executionEligible:!!s.executionEligible,reasons:s.diagnostics||null,signalDiagnostics:s.signalDiagnostics||null,components:s.components||null,trend:s.trend||null,dataQuality:s.dataQuality||null}));await saveState(env,state);
const executionResults=[],executionSymbols=new Set(livePositions.map(p=>baseAsset(normalizeSymbol(String(p?.indexName||p?.symbol||"")))));
if(top.length&&executionEnabled(env)){for(const signal of top){if(executionSymbols.has(baseAsset(signal.symbol)))continue;try{const result=await executeSignal(signal,env);executionResults.push({symbol:signal.symbol,direction:signal.direction,score:signal.score,allocation:signal.tradePlan?.allocation??null,leverage:signal.tradePlan?.leverage??null,...result});}catch(error){executionResults.push({symbol:signal.symbol,error:safeError(error)});}}}

// V14.0: independent Radar live lane. It does not consume Core selection slots.
let radarLiveResult = null;
if (executionEnabled(env) && CONFIG.RADAR_INDEPENDENT_ENABLED && CONFIG.RADAR_LIVE_ENABLED) {
  const radarCandidates = radarRows
    .filter(x => x?.pumpRadar?.direction !== "NEUTRAL")
    .filter(x => radarEntryEligible(x))
    .sort((a,b) => Number(b?.pumpRadar?.score || 0) - Number(a?.pumpRadar?.score || 0))
    .map(candidate => {
      // The Radar candidate is normally included in the deep scan. Reuse the
      // already-fetched candle price as a third, independent price reference.
      // This adds zero network requests and protects Paper Radar from a bad
      // Oracle/ticker scale without turning Radar into Core-style selection.
      const ref=results.find(r => v8NormSymbol(r?.symbol) === v8NormSymbol(candidate?.symbol));
      const referencePrice=v1565NormalizePrice(ref?.price);
      return referencePrice>0
        ? {...candidate,market:{...(candidate.market||{}),__radarReferencePrice:referencePrice}}
        : candidate;
    });
  if (radarCandidates.length) {
    try {
      radarLiveResult = await executeLiveRadarCandidate(radarCandidates[0], env);
      if (radarLiveResult?.executed && CONFIG.TELEGRAM_ENABLED) {
        markRadarTelegramNotified(state, radarCandidates[0]);
        try { await sendTelegram(env, formatTelegramRadarLiveEntry(radarLiveResult)); }
        catch (telegramError) { errors.push({symbol:radarCandidates[0]?.symbol||null,scope:"radar_live_telegram",error:safeError(telegramError)}); }
      }
    } catch (error) {
      radarLiveResult = { executed:false, mode:"LIVE", lane:"RADAR", error:safeError(error) };
      await auditLog(env, { type:"LIVE_RADAR_EXECUTION_ERROR", error:safeError(error), symbol:radarCandidates[0]?.symbol || null });
    }
  }
}
let notified = 0;
let telegramAttempted = 0;
let telegramDedupeSkipped = 0;
let telegramDisabledSkipped = 0;
let telegramFailed = 0;
const telegramResults = [];
for(const signal of notifySignals){
try{
if(!CONFIG.TELEGRAM_ENABLED){telegramDisabledSkipped++;continue;}
if(!canNotifyTelegram(state, signal)){
telegramDedupeSkipped++;
telegramResults.push({symbol:signal.symbol,direction:signal.direction,skipped:"DEDUPE",key:signalNotificationKey(signal)});
continue;
}
telegramAttempted++;
const result = await sendTelegram(env, formatTelegramSignal(signal));
if(result?.ok) {
markTelegramNotified(state, signal);
notified++;
telegramResults.push({symbol:signal.symbol,direction:signal.direction,sent:true,reason:result.reason||"SENT"});
} else {
telegramFailed++;
telegramResults.push({symbol:signal.symbol,direction:signal.direction,sent:false,reason:result?.reason||"UNKNOWN"});
}
} catch(error){
telegramFailed++;
errors.push({symbol:signal.symbol,scope:"telegram",error:safeError(error)});
telegramResults.push({symbol:signal.symbol,direction:signal.direction,sent:false,reason:safeError(error)});
}
}

// V13.9.2: persist Telegram dedupe timestamps after marking notifications.
try {
await saveState(env,state);
} catch (stateError) {
errors.push({scope:"telegram_state",error:safeError(stateError)});
}

const paperResults = [];
if (!executionEnabled(env) && CONFIG.PAPER_ENABLED) {
const paperPositions = await loadPositions(env);
const paperCount = paperPositions.filter(p => p.status === "PAPER_OPEN" && String(p.lane || "CORE").toUpperCase() !== "RADAR").length;
const entryRiskAllowed = Number(state.dailyLoss || 0) > -CONFIG.MAX_DAILY_LOSS;
const slots = entryRiskAllowed ? Math.max(0, CONFIG.MAX_POSITIONS - paperCount) : 0;
const paperCandidates = valid.filter(s => s.executionEligible).slice(0, slots);
for (const signal of paperCandidates) {
try {
const result = await openPaperPosition(env, signal, CONFIG.PAPER_STARTING_BALANCE_USD);
paperResults.push({ symbol: signal.symbol, direction: signal.direction, score: signal.score, ...result });
if (result.ok) {
  // Entry notification is already represented by the Core event stream.
  // Do not spend another Telegram subrequest for the same Paper entry.
}
} catch (error) {
paperResults.push({ symbol: signal.symbol, error: safeError(error) });
}
}
}
Â 
// V13.9.9: Radar has its own entry lane and does not consume a Core slot.
let radarPaperResult = null;
if (!executionEnabled(env) && CONFIG.PAPER_ENABLED && CONFIG.RADAR_INDEPENDENT_ENABLED && CONFIG.RADAR_PAPER_ENABLED) {
  const radarCandidates = radarRows
    .filter(x => x?.pumpRadar?.direction !== "NEUTRAL")
    .filter(x => radarEntryEligible(x))
    .sort((a,b) => Number(b?.pumpRadar?.score || 0) - Number(a?.pumpRadar?.score || 0));
  if (radarCandidates.length) {
    try {
      radarPaperResult = await openRadarPaperPosition(env, radarCandidates[0], CONFIG.PAPER_STARTING_BALANCE_USD);
      if (radarPaperResult?.ok) {
        // Radar WATCH/entry is emitted by the dedicated Radar event lane below.
      }
    } catch (error) {
      radarPaperResult = { ok: false, reason: safeError(error) };
    }
  }
}

// V14.0.5: independent PUMP/DUMP Radar notifications.
// Radar alerts use their own state so a Core signal can never suppress a Radar event.
let radarWatchNotified = 0;
let radarWatchSkipped = 0;
if (CONFIG.TELEGRAM_ENABLED && CONFIG.PUMP_RADAR_ENABLED) {
  const radarEventPool = [];
  const radarSeen = new Set();
  const radarNotifyLimit = 3;
  const radarCandidates = radarRanked
    .filter(x => x.direction !== "NEUTRAL")
    .filter(x => Number(x.score || 0) >= Number(CONFIG.PUMP_RADAR_WATCH_SCORE || 60))
    .sort((a,b) => Number(b.score || 0) - Number(a.score || 0));

  for (const ranked of radarCandidates) {
    const key = `${ranked.symbol}|${ranked.direction}`;
    if (radarSeen.has(key)) continue;
    const candidate = radarRows.find(x => x.symbol === ranked.symbol);
    if (!candidate || !canNotifyRadarTelegram(state, candidate)) { radarWatchSkipped++; continue; }
    radarSeen.add(key);
    radarEventPool.push(candidate);
    if (radarEventPool.length >= radarNotifyLimit) break;
  }

  for (const candidate of radarEventPool) {
    try {
      const result = await sendTelegram(env, formatTelegramRadarWatch(candidate));
      if (result?.ok) { markRadarTelegramNotified(state, candidate); radarWatchNotified++; }
    } catch (error) {
      errors.push({symbol:candidate.symbol, scope:"radar_telegram", error:safeError(error)});
    }
  }
}

const signalsDetected=directional.length;
const notificationEligibleCount=notificationPool.length;
const eventCandidates=eventPool.length;
const radarHotCount=radarRanked.filter(x=>x.direction!=="NEUTRAL"&&x.score>=CONFIG.PUMP_RADAR_HOT_SCORE).length;
const radarWatchCount=radarRanked.filter(x=>x.direction!=="NEUTRAL"&&x.score>=CONFIG.PUMP_RADAR_WATCH_SCORE).length;
state.smartMoneyFlowHistory=smfPersistHistory(smartMoneyFlowHistory,smartMoneyFlowData,Date.now());
const universeDiagnostics=buildUniverseDiagnostics(allMarkets,fastRows,radarMarkets); universeDiagnostics.deepCandidates=symbols.length; universeDiagnostics.explorationSlots=CONFIG.DEEP_EXPLORATION_SLOTS; universeDiagnostics.rotationCursor=universeRotationCursor; universeDiagnostics.radarCoverage=radarRows.length; universeDiagnostics.topEligible=radarRanked.slice(0,Number(CONFIG.UNIVERSE_DIAGNOSTICS_TOP_N||25)); const diagnostics={marketsDiscovered:allMarkets.length,eligibleMarkets:fastRows.length,deepAnalyzed:results.length,signalsDetected,notificationEligible:notificationEligibleCount,eventCandidates,signalsDeduped:Math.max(0,notificationEligibleCount-eventCandidates),directionalSetups:directional.length,longAnalyzed:results.filter(s=>s.direction==="LONG").length,shortAnalyzed:results.filter(s=>s.direction==="SHORT").length,noTradeAnalyzed:results.filter(s=>s.direction==="NO_TRADE").length,watchSignals:watch.length,validSignals:valid.length,executionEligible:results.filter(s=>s.executionEligible).length,earlyMomentum:results.filter(s=>s?.opportunity?.type==="EARLY_MOMENTUM").length,notified,telegram:{enabled:CONFIG.TELEGRAM_ENABLED,candidates:notifySignals.length,attempted:telegramAttempted,sent:notified,dedupeSkipped:telegramDedupeSkipped,disabledSkipped:telegramDisabledSkipped,failed:telegramFailed,results:telegramResults,eventBased:true,eventMax:CONFIG.NOTIFY_EVENT_MAX,radarEventBased:true,radarWatchThreshold:CONFIG.PUMP_RADAR_WATCH_SCORE,radarHotThreshold:CONFIG.PUMP_RADAR_HOT_SCORE,radarWatchNotified,radarWatchSkipped,subrequestBudget:TELEGRAM_MAX_SENDS_PER_INVOCATION},selectedForExecution:top.length,rejectedByReason:results.filter(s=>s.direction==="NO_TRADE").slice(0,30).map(s=>({symbol:s.symbol,score:s.score,reasons:s.diagnostics||s.signalDiagnostics||[]})),timings:{elapsedMs:Date.now()-scanStartedAt},fastFilter:{...fastFilterDiagnostics,liquiditySource:enriched.source,marketCatalogSource:catalogSource||null,tickers:{available:tickerRows.length>0,error:tickerError},priceFeed:{available:!!radarPriceFeed.available,source:radarPriceFeed.source,symbols:Object.keys(radarPriceFeed.prices||{}).length,error:radarPriceFeed.error},smartMoneyFlow:{enabled:Boolean(CONFIG.SMART_MONEY_FLOW_ENABLED),multiSource:Boolean(CONFIG.DATA_CENTER_ENABLED),apiPeers:V156_DATA_CENTER.apiPeers,available:Boolean(smartMoneyFlowData?.available),source:smartMoneyFlowData?.source||null,trades:Number(smartMoneyFlowData?.trades||0),parsedTrades:Number(smartMoneyFlowData?.parsedTrades||0),symbols:Number(smartMoneyFlowData?.symbols||0),error:smartMoneyFlowData?.error||null,lookbackMs:Number(CONFIG.SMART_MONEY_FLOW_LOOKBACK_MS||300000),cacheMs:Number(CONFIG.SMART_MONEY_FLOW_CACHE_MS||20000),spikeThreshold:Number(CONFIG.SMART_MONEY_FLOW_SPIKE_THRESHOLD||1.8),explosiveThreshold:Number(CONFIG.SMART_MONEY_FLOW_EXPLOSIVE_THRESHOLD||3)}},requestStrategy:{phase5MarketDiscovery:true,universeDiscovered:allMarkets.length,fastEligible:fastRows.length,deepCandidates:symbols.length,explorationSlots:Number(CONFIG.DEEP_EXPLORATION_SLOTS||0),marketsInfo:1,marketsCatalog:1,gmxApiMarketsInfo:true,marketsTickers:1,marketsValuesFallback:enriched.source==="markets-info+markets-values"?1:0,candleRequestsPerSymbol:4,fallbackCandleRequestsInScan:"ON_ERROR_ONLY",perSymbolRpcChecks:0,perSymbolKvReadsWrites:0,batchSize,configuredDeepScanLimit:CONFIG.DEEP_SCAN_LIMIT,effectiveDeepScanLimit,maxScanSubrequests:CONFIG.MAX_SCAN_SUBREQUESTS,reservedScanSubrequests:reservedSubrequests,baseReservedScanSubrequests:baseReservedSubrequests,additionalScheduledReserve,radarSubrequestReserve,estimatedCandleSubrequests:effectiveDeepScanLimit*candleRequestsPerSymbol,telegramDedupeTtlMs:CONFIG.TELEGRAM_DEDUPE_TTL_MS,cronRecommended:CONFIG.CRON_RECOMMENDED,cronIntervalMinutes:CONFIG.CRON_INTERVAL_MINUTES,directionalLongSlots:CONFIG.DIRECTIONAL_DEEP_LONG_SLOTS,directionalShortSlots:CONFIG.DIRECTIONAL_DEEP_SHORT_SLOTS,balancedMajorSlots:CONFIG.BALANCED_MAJOR_SLOTS,
universe:universeDiagnostics,fairAssetScoring:CONFIG.FAIR_ASSET_SCORING_ENABLED,dataCenter:{enabled:Boolean(CONFIG.DATA_CENTER_ENABLED),apiPeers:V156_DATA_CENTER.apiPeers,oraclePeers:V156_DATA_CENTER.oraclePeers,staleMs:Number(CONFIG.DATA_CENTER_STALE_MS||15000)},
liquidityScoreInRadar:CONFIG.FAIR_LIQUIDITY_SCORE_IN_RADAR,
majorSelectionBias:CONFIG.FAIR_MAJOR_SELECTION_BIAS,
notifyEventMax:CONFIG.NOTIFY_EVENT_MAX},radarLane:{enabled:CONFIG.RADAR_INDEPENDENT_ENABLED,paperEnabled:CONFIG.RADAR_PAPER_ENABLED,liveEnabled:CONFIG.RADAR_LIVE_ENABLED,entryScore:CONFIG.RADAR_ENTRY_SCORE,earlyEntryEnabled:CONFIG.RADAR_EARLY_ENTRY_ENABLED,earlyEntryScore:CONFIG.RADAR_EARLY_ENTRY_SCORE,earlyMinVelocity:CONFIG.RADAR_EARLY_ENTRY_MIN_VELOCITY,earlyMinEdge:CONFIG.RADAR_EARLY_ENTRY_MIN_EDGE,exitScore:CONFIG.RADAR_EXIT_SCORE,maxPositions:CONFIG.RADAR_MAX_POSITIONS,coverageMarkets:radarRows.length,priceFeedCoverage:Object.keys(radarPriceFeed.prices||{}).length,directionalMarkets:radarDirectional.length,longMarkets:radarLongCount,shortMarkets:radarShortCount,watchCandidates:radarWatchCount,hotCandidateCount:radarHotCount,radarHistorySymbols:Object.keys(radarHistory).length,radarHistorySamples:Object.values(radarHistory).reduce((n,a)=>n+(Array.isArray(a)?a.length:0),0),radarPrioritySymbols:radarPrioritySymbols.slice(0,20),hotCandidates:radarRanked.filter(x=>x.score>=CONFIG.PUMP_RADAR_HOT_SCORE).slice(0,20),liveEntryGuard:"PRICE_OK + HOT_OR_EARLY",result:radarPaperResult,liveResult:radarLiveResult},entryRisk:{appliedToScan:false,dailyLoss:Number(state.dailyLoss||0),maxDailyLoss:CONFIG.MAX_DAILY_LOSS,entryRiskAllowed:Number(state.dailyLoss||0)>-CONFIG.MAX_DAILY_LOSS,positionLimit:CONFIG.MAX_POSITIONS}};
// V15.6.1 FIX: persist radar history + market snapshots between cron invocations.
// Without this write, every scan reloaded one fresh sample per symbol, so
// 5m/15m/30m velocity and acceleration stayed at zero forever.
try{await saveState(env,state);}catch(error){errors.push({scope:"state-persist",error:safeError(error)});}
return{ok:true,status:(valid.length||radarHotCount)?"SIGNALS_FOUND":watch.length||radarWatchCount?"WATCH_ONLY":"NO_SIGNAL",scanned:results.length,requested:allMarkets.length,deepCandidates:symbols.length,candidates:valid.length,watchCandidates:watch.length,signalsDetected,notificationEligible:notificationEligibleCount,eventCandidates,signalsDeduped:Math.max(0,notificationEligibleCount-eventCandidates),radarHotCandidates:radarHotCount,radarWatchCandidates:radarWatchCount,radarCoverageMarkets:radarRows.length,radarDirectionalMarkets:radarDirectional.length,radarLongMarkets:radarLongCount,radarShortMarkets:radarShortCount,topSignals:notifySignals,watchSignals:watch.slice(0,CONFIG.NOTIFY_TOP_N),opportunityRanking:notificationPool.slice(0,20).map((s,index)=>({rank:index+1,symbol:s.symbol,direction:s.direction,tier:s.signalTier,score:s.score,edge:s.edge,risk:s.riskScore,executionEligible:!!s.executionEligible,priority:Number(signalPriorityScore(s).toFixed(2))})),executionSignals:top,portfolio:{existingLivePositions:existingCount,remainingSlots,selectedAllocation:Number(selection.totalAllocation.toFixed(4)),selectedAllocationPercent:Number((selection.totalAllocation*100).toFixed(2)),selectedRisk:Number(selection.totalRisk.toFixed(4)),selectedRiskPercent:Number((selection.totalRisk*100).toFixed(2)),maxTotalAllocationPercent:Number((CONFIG.MAX_TOTAL_CAPITAL_ALLOCATION*100).toFixed(2)),maxTotalRiskPercent:Number((CONFIG.MAX_TOTAL_RISK*100).toFixed(2))},executionResults,paperResults,radarPaperResult,radarLiveResult,livePositionError,diagnostics,errors,timestamp:Date.now()};
}
Â 
// ======================================================
// RISK GUARD
// ======================================================
Â 
async function riskGuard(env, state) {
resetDailyLossIfNeeded(state);
Â 
if (Number(state.dailyLoss || 0) <= -CONFIG.MAX_DAILY_LOSS) {
return {
allowed: false,
reason: "Daily loss limit reached"
};
}
Â 
const positions = await loadPositions(env);
Â 
if (positions.length >= CONFIG.MAX_POSITIONS) {
return {
allowed: false,
reason: "Maximum positions reached"
};
}
Â 
return { allowed: true };
}
Â 
function resetDailyLossIfNeeded(state) {
const key = new Date().toISOString().slice(0, 10);
Â 
if (state.dayKey !== key) {
state.dayKey = key;
state.dailyLoss = 0;
}
}
Â 
// ======================================================
// STATE / KV
// ======================================================
Â 
async function loadState(env) {
if (!env.BOT_STATE) {
return { ...DEFAULT_STATE };
}
Â 
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
universeRotationCursor: Number.isFinite(Number(data?.universeRotationCursor)) ? Number(data.universeRotationCursor) : 0,
lastExitDiagnostics: Array.isArray(data?.lastExitDiagnostics) ? data.lastExitDiagnostics : []
};
}
Â 
async function saveState(env, state) {
if (!env.BOT_STATE) return false;
Â 
await env.BOT_STATE.put(
"engine_state",
JSON.stringify(state)
);
Â 
return true;
}
Â 
async function loadPositions(env) {
if (!env.BOT_STATE) return [];
Â 
const positions = await env.BOT_STATE.get(
"positions",
"json"
);
Â 
return Array.isArray(positions) ? positions : [];
}
Â 
async function savePositions(env, positions) {
if (!env.BOT_STATE) return false;
Â 
await env.BOT_STATE.put(
"positions",
JSON.stringify(positions)
);
Â 
return true;
}
Â 
async function loadMarketSnapshot(env, symbol) {
if (!env.BOT_STATE) return null;
Â 
return await env.BOT_STATE.get(
`market:${normalizeSymbol(symbol)}`,
"json"
);
}
Â 
async function saveMarketSnapshot(env, symbol, market) {
if (!env.BOT_STATE) return false;
Â 
await env.BOT_STATE.put(
`market:${normalizeSymbol(symbol)}`,
JSON.stringify({
market,
savedAt: Date.now()
}),
{ expirationTtl: 86400 }
);
Â 
return true;
}
Â 
// ======================================================
// MARKET DISCOVERY
// ======================================================
Â 
async function discoverMarkets(env) {
const [catalog,info]=await Promise.all([fetchGmxMarkets(),fetchGmxMarketsInfo()]);
const bySymbol=new Map();
for(const raw of [...marketArray(catalog),...marketArray(info)]){const symbol=normalizeSymbol(raw?.symbol??raw?.name??raw?.ticker??raw?.indexTokenSymbol);if(!symbol)continue;bySymbol.set(symbol,{...(bySymbol.get(symbol)||{}),...raw,symbol});}
const all=[...bySymbol.values()].filter(m=>m.isListed!==false);const ranked=v8RankFastMarkets(all);
return {ok:true,network:"Arbitrum One",chainId:GMX.CHAIN_ID,markets:all.map(m=>({symbol:m.symbol,listed:m.isListed!==false,marketToken:m.marketToken||m.marketTokenAddress||null,liquidity:extractLiquidity(m),openInterest:extractOpenInterest(m),fundingRate:extractFunding(m)})),ranked:ranked.map(x=>({symbol:x.symbol,liquidityScore:x.liquidityScore,major:x.major})),source:{catalog:`${GMX.ORACLE}/markets`,info:`${GMX.ORACLE}/markets/info`},timestamp:Date.now()};
}
Â 
// ======================================================
// HEALTH / DEBUG
// ======================================================
Â 
async function healthRoute(env) {
try {
const rpcStatus = await verifyArbitrumRPC(env);
const marketInfo = await fetchGmxMarketsInfo();
Â 
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
Â 
async function debugState(env) {
const state = await loadState(env);
Â 
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
Â 
// ======================================================
// CONTROL
// ======================================================
Â 
async function control(cmd, env) {
const state = await loadState(env);
Â 
switch (String(cmd || "").toLowerCase()) {
case "pause":
state.running = false;
await saveState(env, state);
return { ok: true, result: "BOT PAUSED" };
Â 
case "resume":
state.running = true;
await saveState(env, state);
return { ok: true, result: "BOT RESUMED" };
Â 
case "status":
return { ok: true, state };
Â 
default:
return {
ok: false,
result: "UNKNOWN COMMAND",
allowed: ["pause", "resume", "status"]
};
}
}
Â 
// ======================================================
// TELEGRAM
// ======================================================
Â 
function formatPrice(value) {
if (!Number.isFinite(Number(value))) return "N/A";
Â 
const n = Number(value);
Â 
if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
if (n >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
return n.toLocaleString("en-US", { maximumFractionDigits: 8 });
}
Â 
function tgText(value, fallback = "N/A") {
const s = value === null || value === undefined || value === "" ? fallback : String(value);
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
const icon = direction === "LONG" ? "ðŸŸ¢" : direction === "SHORT" ? "ðŸ”´" : "âšª";
const p = signal?.tradePlan || {};
const t = signal?.trend || {};
const tier = tgText(signal?.signalTier || signal?.status, "SIGNAL");
const symbol = tgText(signal?.symbol, "UNKNOWN");
const score = tgNumber(signal?.score, 1, "0.0");
const confidence = tgNumber(signal?.confidence, 0, "0");
const edge = tgNumber(signal?.edge, 1, "0.0");
const risk = tgNumber(signal?.riskScore ?? signal?.risk, 1, "0.0");
const opportunity = signal?.opportunity || {};
const radarScore = tgNumber(opportunity?.score, 1, "0.0");
const radarType = opportunity?.type === "EARLY_MOMENTUM" ? "ðŸ”¥ EARLY MOMENTUM" : "";

const lines = [
`${icon} GMX FUTURES â€” ${tier}`,
"â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”",
`ðŸ“Œ ${symbol}/USD  â€¢  ${direction || "UNKNOWN"}`,
`ðŸ“Š Score: ${score}/100`,
`ðŸŽ¯ Confidence: ${confidence}/100`,
`âš¡ Edge: ${edge}`,
`ðŸ›¡ï¸ Risk: ${risk}/100`,
radarType ? `${radarType}  â€¢  Radar: ${radarScore}/100` : "",
"",
"ðŸ’° TRADE PLAN",
`Entry : ${tgPrice(p?.entry ?? signal?.price)}`,
`SL    : ${tgPrice(p?.stopLoss)}`,
`TP1   : ${tgPrice(p?.tp1)}`,
`TP2   : ${tgPrice(p?.tp2)}`,
`TP3   : ${tgPrice(p?.tp3)}`,
"",
"ðŸ“ˆ TREND",
`4H  : ${tgText(t?.macro4h)}`,
`1H  : ${tgText(t?.trend1h)}`,
`15M : ${tgText(t?.entry15m)}`,
`5M  : ${tgText(t?.fast5m)}`,
"",
`âš™ï¸ Leverage: ${tgText(p?.leverage ?? CONFIG.DEFAULT_LEVERAGE, CONFIG.DEFAULT_LEVERAGE) }x`,
`ðŸ›¡ï¸ Risk/Trade: ${tgText(p?.riskPerTradePercent ?? (CONFIG.RISK_PER_TRADE * 100).toFixed(2), (CONFIG.RISK_PER_TRADE * 100).toFixed(2))}%`,
`ðŸ¤– ${signal?.executionEligible ? "EXECUTION-ELIGIBLE" : "SIGNAL-ONLY"}`,
"",
"â„¹ï¸ Ø§ÛŒÙ† Ù¾ÛŒØ§Ù… ÙÙ‚Ø· Ø§Ø·Ù„Ø§Ø¹â€ŒØ±Ø³Ø§Ù†ÛŒ Ø§Ø³ØªØ› Ø¨Ø±Ø§ÛŒ ÙˆØ±ÙˆØ¯ Ù†ÛŒØ§Ø²ÛŒ Ø¨Ù‡ ØªØ£ÛŒÛŒØ¯ ØªÙ„Ú¯Ø±Ø§Ù… Ù†ÛŒØ³Øª.",
`#${symbol} #GMX #Arbitrum #Futures`
];

return lines.join("\n");
}

function formatTelegramStatus(result) {
return [
"âš ï¸ GMX FUTURES SCAN",
"â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”",
`Status   : ${tgText(result?.status, "UNKNOWN")}`,
`Scanned  : ${tgText(result?.scanned, "0")}`,
`Signals  : ${tgText(result?.candidates, "0")}`,
result?.reason ? `Reason   : ${tgText(result.reason)}` : "",
"â„¹ï¸ Telegram is notification-only and does not control the bot."
].filter(Boolean).join("\n");
}

// ======================================================
// OPTIONAL PAPER POSITION HELPERS
// ======================================================
Â 
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
// V15.3.9: one lightweight integrity guard only. Do not turn Radar into
// another Core-style confirmation engine: a valid HOT Radar can still enter
// without waiting for every longer window, but it must have a valid price feed.
if (!['LONG','SHORT'].includes(direction) || priceStatus === "INVALID") return false;
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
const icon = direction === "LONG" ? "ðŸŸ¢" : "ðŸ”´";
const leverage = Number(position?.leverage || 1);
const allocationPct = Number(position?.allocation || CONFIG.RADAR_CAPITAL_ALLOCATION) * 100;
const notional = Number(position?.notionalUsd || 0);
const margin = leverage > 0 ? notional / leverage : 0;
const riskPct = Number(position?.riskPerTradePercent ?? (CONFIG.RADAR_RISK_PER_TRADE * 100));
return [
`${icon} RADAR ENTRY â€” ${direction}`,
"â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”",
`ðŸ“Œ ${position?.symbol || "UNKNOWN"}/USD`,
`ðŸ”¥ Score: ${Number(position?.radarScore || 0).toFixed(1)}/100`,
`âš¡ Edge: ${Number(position?.radarEdge || 0).toFixed(1)}`,
"",
"ðŸ“¥ HYPOTHETICAL ENTRY",
`ðŸ’° Entry: ${formatPrice(position?.entryPrice)}`,
`âš™ï¸ Leverage: ${leverage}x`,
`ðŸ’¼ Allocation: ${allocationPct.toFixed(2)}%`,
`ðŸ’µ Margin Used: $${margin.toFixed(2)}`,
`ðŸ“¦ Position Notional: $${notional.toFixed(2)}`,
`ðŸ›¡ï¸ Risk/Trade: ${riskPct.toFixed(2)}%`,
"",
"ðŸŽ¯ TRADE PLAN",
`ðŸ›‘ Initial SL: ${formatPrice(position?.initialStopPrice)}`,
`ðŸŽ¯ TP1: ${formatPrice(position?.tp1)}`,
`ðŸŽ¯ TP2: ${formatPrice(position?.tp2)}`,
`ðŸŽ¯ TP3: ${formatPrice(position?.tp3)}`,
"",
"ðŸ“Š RESULT TRACKING",
"ðŸŸ¡ PnL starts at $0.00 / 0.00%",
"ðŸ§­ Lane: RADAR / Paper simulation",
"â„¹ï¸ This is a simulated entry; no real order is submitted."
].join("\n");
}

function formatTelegramRadarLiveEntry(result) {
const direction=String(result?.direction||"UNKNOWN").toUpperCase();
const icon=direction==="LONG"?"ðŸŸ¢":"ðŸ”´";
return [
`${icon} RADAR LIVE ENTRY â€” ${direction}`,
"â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”",
`ðŸª™ ${result?.symbol||"UNKNOWN"}`,
`ðŸ”¥ Radar Score: ${Number(result?.radarScore||0).toFixed(1)}/100`,
`âš¡ Edge: ${Number(result?.radarEdge||0).toFixed(1)}`,
`âš™ï¸ Leverage: ${Number(result?.leverage||1).toFixed(1)}x`,
`ðŸ’¼ Collateral: ${Number(result?.collateralUsd||0).toFixed(2)} USD (${result?.collateralToken||"?"})`,
`ðŸ“¦ Notional: ${Number(result?.notionalUsd||0).toFixed(2)} USD`,
`ðŸ§¾ Request ID: ${result?.requestId||"n/a"}`,
"âœ… ORDER SUBMITTED BEFORE TELEGRAM",
"âš ï¸ Radar live lane â€” independent fast-entry path"
].join("\n");
}

function formatTelegramRadarWatch(candidate) {
const direction=String(candidate?.pumpRadar?.direction||"NEUTRAL").toUpperCase();
const radar=candidate?.pumpRadar||{};
const score=Number(radar.score||0);
const isPump=direction==="LONG";
const tier=score>=Number(CONFIG.PUMP_RADAR_HOT_SCORE||72)?"HOT":"WATCH";
const title=isPump?"ðŸš€ PUMP RADAR":"ðŸ”» DUMP RADAR";
const action=isPump?"BUY-SIDE MOMENTUM":"SELL-SIDE MOMENTUM";
const reasons=(Array.isArray(radar.reasons)?radar.reasons:[]).slice(0,6).join(" â€¢ ")||"momentum detected";
const flow=radar.smartMoneyFlow||{};
return [
`${title} â€” ${tier}`,
"â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”",
`ðŸª™ ${candidate?.symbol||"UNKNOWN"}/USD`,
`ðŸ“¡ Event: ${action}`,
`ðŸ”¥ Radar Score: ${score.toFixed(1)}/100`,
`âš¡ Directional Edge: ${Number(radar.edge||0).toFixed(1)}`,
`ðŸ“ˆ 24h Move: ${Number(radar.priceChange24h||0).toFixed(2)}%`,
`â±ï¸ 1h Move: ${Number(radar.priceChange1h||0).toFixed(2)}%`,
`ðŸ• 4h Move: ${Number(radar.priceChange4h||0).toFixed(2)}%`,
`âš¡ 5m Velocity: ${Number(radar.velocity5m||0).toFixed(2)}%`,
`ðŸ“ˆ 15m Move: ${Number(radar.move15m||0).toFixed(2)}%`,
`â±ï¸ Detection: ${radar.timingState || "UNKNOWN"}`,
`ðŸ›°ï¸ Last-Scan Move: ${Number(radar.priorMovePct||0).toFixed(2)}%`,
`ðŸ’§ Volume Ratio: ${Number(radar.volumeRatio||1).toFixed(2)}x`,
`ðŸ“Š OI Change: ${Number(radar.oiChangePct||0).toFixed(2)}% â€¢ ${radar.oiAvailable===false?"UNAVAILABLE":"AVAILABLE"}`,
`ðŸ’µ Smart Money Buy: $${Number(flow.buyUsd||0).toFixed(0)}`,
`ðŸ’¸ Smart Money Sell: $${Number(flow.sellUsd||0).toFixed(0)}`,
`âš–ï¸ Flow Imbalance: ${(Number(flow.imbalance||0)*100).toFixed(1)}%`,
`ðŸš€ Flow Surge: ${flow.flowSurge?"YES":"NO"} â€¢ x${Number(flow.flowSpikeRatio||1).toFixed(2)}`,
`ðŸ‹ Large Trades: ${Number(flow.largeTradeCount||0)}`,
`ðŸ§  Trigger: ${reasons}`,
"âš ï¸ RADAR ALERT â€” notification only; not a trade execution signal."
].join("\n");
}
async function openPaperPosition(env, signal, balance) {
if (!CONFIG.PAPER_ENABLED || !signal || !["LONG", "SHORT"].includes(signal.direction) || !signal.tradePlan?.valid) {
return { ok: false, reason: "Invalid signal or paper mode disabled" };
}
Â 
const positions = await loadPositions(env);
const base = baseAsset(normalizeSymbol(signal.symbol));
if (positions.some(p => p.status === "PAPER_OPEN" && baseAsset(normalizeSymbol(p.symbol)) === base)) {
return { ok: false, reason: "Paper position already open for symbol" };
}
const coreOpenCount = positions.filter(p => p.status === "PAPER_OPEN" && String(p.lane || "CORE").toUpperCase() !== "RADAR").length;
if (coreOpenCount >= CONFIG.MAX_POSITIONS) {
return { ok: false, reason: "Maximum Core paper positions reached" };
}
Â 
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
Â 
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
Math.max(CONFIG.MIN_POSITION_NOTIONAL_USD, Math.min(riskBasedNotional, allocationNotional))
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
Â 
function paperStopReached(side, price, stop) {
if (!(price > 0) || !(stop > 0)) return false;
return side === "LONG" ? price <= stop : price >= stop;
}
Â 
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
Â 
async function updatePaperPositions(env) {
if (!CONFIG.PAPER_ENABLED) return [];
const positions = await loadPositions(env);
const open = positions.filter(p => p.status === "PAPER_OPEN");
if (!open.length) return [];
const actions = [];
const now = Date.now();
Â 
for (const position of open) {
try {
const symbol = normalizeSymbol(position.symbol);
const snapshot = await buildMarketSnapshot(symbol, env);
const currentPrice = v1565NormalizePrice(snapshot?.price || snapshot?.currentPrice);
if (!(currentPrice > 0)) continue;
position.currentPrice = currentPrice;

// V15.6.5: quarantine legacy/corrupt Radar paper positions whose stored
// entry and current price are on incompatible scales. Do not emit a fake PnL.
if (String(position?.lane || "CORE").toUpperCase() === "RADAR") {
  const integrity=v1565RadarPriceIntegrity(position?.entryPrice,currentPrice,{maxRatio:25});
  if (!integrity.ok) {
    const actualPct=Math.max(0,Math.min(100,Number(position?.remainingPct||100)));
    position.remainingPct=0;
    position.status="PAPER_CLOSED";
    position.closedAt=now;
    position.lastExitActionAt=now;
    position.exitHistory=Array.isArray(position.exitHistory)?position.exitHistory:[];
    position.exitHistory.push({at:now,action:"RADAR_PRICE_DATA_QUARANTINE",reason:integrity.reason,price:currentPrice,closePercent:actualPct,pnlUsd:null,entryPrice:v1565NormalizePrice(position?.entryPrice),exitPrice:currentPrice,ratio:integrity.ratio});
    actions.push({id:position.id,symbol,direction:position.side,lane:"RADAR",action:"RADAR_PRICE_DATA_QUARANTINE",reason:integrity.reason,closePercent:actualPct,pnlPercent:null,pnlUsd:null,entryPrice:v1565NormalizePrice(position?.entryPrice),exitPrice:currentPrice,leverage:position.leverage,notionalUsd:position.notionalUsd,exitScore:0,remainingPct:0,priceRatio:integrity.ratio});
    continue;
  }
}
Â 
const previous = await loadMarketSnapshot(env, symbol);
const analysis = scoreSignal(snapshot, previous?.market || null);
const market = { ...snapshot, price: currentPrice, currentPrice, score: analysis.score, trend: snapshot.trend, structure: snapshot.structure, participation: snapshot.participation, momentum: snapshot.momentum, smartMoney: snapshot.smartMoney, smartMoneyOutflow: snapshot.smartMoneyOutflow, risk: analysis.risk, atr: snapshot.atr ?? snapshot.indicators?.atr };

// V13.9.9.1 HOTFIX: bind the unified exit plan before the CORE exit branch uses it.
const plan = buildPositionExitPlan(position, market, false);

if (String(position.lane || "CORE").toUpperCase() === "RADAR") {
  const radarNow = v8PumpRadar(snapshot.market, previous?.market || null);
  position.radarLastScore = Number(radarNow?.score || 0);
  position.radarPeakScore = Math.max(Number(position.radarPeakScore || 0), Number(radarNow?.score || 0));
  const radarExit = radarReversalDecision(position, radarNow, analysis);
  if (radarExit.close) {
    const actualPct = Number(position.remainingPct || 100);
    const pnlIntegrity=v1565RadarPriceIntegrity(position?.entryPrice,currentPrice,{maxRatio:25});
    if(!pnlIntegrity.ok){
      const actualPct=Math.max(0,Math.min(100,Number(position?.remainingPct||100)));
      position.remainingPct=0; position.status="PAPER_CLOSED"; position.closedAt=now; position.lastExitActionAt=now;
      position.exitHistory=Array.isArray(position.exitHistory)?position.exitHistory:[];
      position.exitHistory.push({at:now,action:"RADAR_PRICE_DATA_QUARANTINE",reason:pnlIntegrity.reason,price:currentPrice,closePercent:actualPct,pnlUsd:null,entryPrice:v1565NormalizePrice(position?.entryPrice),exitPrice:currentPrice,ratio:pnlIntegrity.ratio});
      actions.push({id:position.id,symbol,direction:position.side,lane:"RADAR",action:"RADAR_PRICE_DATA_QUARANTINE",reason:pnlIntegrity.reason,closePercent:actualPct,pnlPercent:null,pnlUsd:null,entryPrice:v1565NormalizePrice(position?.entryPrice),exitPrice:currentPrice,leverage:position.leverage,notionalUsd:position.notionalUsd,radarScore:radarExit.radarScore,radarDirection:radarExit.radarDirection,remainingPct:0,priceRatio:pnlIntegrity.ratio});
      continue;
    }
    const pnl = paperPnlUsd(position, currentPrice, actualPct);
    position.realizedPnlUsd = Number((Number(position.realizedPnlUsd || 0) + pnl).toFixed(4));
    position.remainingPct = 0;
    position.status = "PAPER_CLOSED";
    position.closedAt = now;
    position.lastExitActionAt = now;
    position.exitHistory = Array.isArray(position.exitHistory) ? position.exitHistory : [];
    position.exitHistory.push({ at: now, action: "RADAR_REVERSAL_FULL", reason: radarExit.reason, price: currentPrice, closePercent: actualPct, pnlUsd: Number(pnl.toFixed(4)), radarScore: radarExit.radarScore, radarDirection: radarExit.radarDirection });
    actions.push({ id: position.id, symbol, direction: position.side, lane: "RADAR", action: "RADAR_REVERSAL_FULL", reason: radarExit.reason, closePercent: actualPct, pnlPercent: Number((pnl / Math.max(1, Number(position.notionalUsd || 1)) * 100).toFixed(2)), pnlUsd: Number(pnl.toFixed(4)), entryPrice: position.entryPrice, exitPrice: currentPrice, leverage: position.leverage, notionalUsd: position.notionalUsd, radarScore: radarExit.radarScore, radarDirection: radarExit.radarDirection, remainingPct: 0 });
    continue;
  }
}

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
Â 
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
Â 
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
Â 
Â 
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
Â 
// ================================
// MAIN WORKER
// ================================
Â 
Â 
Â 
function clamp100(v) {
return Math.max(0, Math.min(100, Number(v) || 0));
}
Â 
function calculateExitSignal(position, market) {
const side = String(position?.side || position?.direction || "").toUpperCase();
const isLong = side === "LONG";
const isShort = side === "SHORT";
Â 
const trend = Number(market?.trend?.[isLong ? "shortScore" : "longScore"] || 0);
const momentum = Number(market?.momentum?.[isLong ? "short" : "long"] || 0);
const structure = Number(market?.structure?.[isLong ? "short" : "long"] || 0);
const participation = Number(market?.participation?.[isLong ? "short" : "long"] || 0);
Â 
const smartMoneyOutflow = Boolean(
market?.smartMoney?.outflow ??
market?.smartMoneyOutflow ??
false
);
Â 
const structureBreak = Boolean(
market?.structure?.breakAgainstPosition ??
market?.structureBreak ??
false
);
Â 
const trendFlip = Boolean(
market?.trend?.flipAgainstPosition ??
false
);
Â 
const components = {
trendReversal: clamp100(trend),
momentumReversal: clamp100(momentum / 0.60),
structureBreak: structureBreak ? 100 : clamp100(structure),
participationReversal: clamp100(participation / 0.30),
smartMoneyOutflow: smartMoneyOutflow ? 100 : 0,
trendFlip: trendFlip ? 100 : 0
};
Â 
const score =
components.trendReversal * 0.22 +
components.momentumReversal * 0.18 +
components.structureBreak * 0.20 +
components.participationReversal * 0.10 +
components.smartMoneyOutflow * 0.20 +
components.trendFlip * 0.10;
Â 
let action = "HOLD";
let closePercent = 0;
Â 
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
Â 
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
Â 
function shouldEmergencyClose(exitSignal, hardStopTriggered = false) {
return Boolean(
hardStopTriggered ||
exitSignal?.action === "EMERGENCY_FULL" ||
exitSignal?.action === "FULL_CLOSE"
);
}
Â 
function buildPositionExitPlan(position, market, hardStopTriggered = false) {
const exitSignal = calculateExitSignal(position, market);
const dynamicTPSL = deriveDynamicTPSL(position, market);
const trailingStop = deriveTrailingStop(
position,
market,
market?.currentPrice ?? market?.price
);
Â 
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
Â 
if (exitSignal.action === "PARTIAL_50" || exitSignal.action === "PARTIAL_25") {
return {
...exitSignal,
dynamicTPSL,
trailingStop,
execution: "PARTIAL_CLOSE"
};
}
Â 
if (exitSignal.action === "PROTECT") {
return {
...exitSignal,
dynamicTPSL,
trailingStop,
execution: "TIGHTEN_PROTECTION"
};
}
Â 
return {
...exitSignal,
dynamicTPSL,
trailingStop,
execution: "HOLD"
};
}
Â 
export default {
Â 
Â 
Â 
async scheduled(event, env, ctx) {
const cron = event?.cron || "unknown";
const scheduledTime = event?.scheduledTime ?? null;
Â 
const task = (async () => {
try {
console.log("[SCHEDULED][START]", { cron, scheduledTime, recommendedCron: CONFIG.CRON_RECOMMENDED, cronMatchesRecommended: cron === CONFIG.CRON_RECOMMENDED });
Â 
const exits = executionEnabled(env)
? await FUTURES_V6.monitorLivePositions(env)
: await FUTURES_V6.updatePaperPositions(env);
Â 
let scheduledOpenPositions = 0;
try {
const scheduledPositions = await FUTURES_V6.positions(env);
scheduledOpenPositions = Array.isArray(scheduledPositions)
? scheduledPositions.filter(p => p?.status === "PAPER_OPEN").length
: 0;
} catch (_) {}
const scheduledPositionReserve = scheduledOpenPositions * 4;
const scan = await FUTURES_V6.scan(env, {
additionalSubrequestReserve: scheduledPositionReserve,
source: "cron"
});
Â 
console.log("[SCHEDULED][DONE]", {
cron,
scheduledTime,
recommendedCron: CONFIG.CRON_RECOMMENDED,
cronMatchesRecommended: cron === CONFIG.CRON_RECOMMENDED,
scanStatus: scan?.status || null,
scanOk: scan?.ok ?? null,
scanned: scan?.scanned ?? null,
signals: scan?.signalsDetected ?? scan?.topSignals?.length ?? 0,
notificationEligible: scan?.notificationEligible ?? scan?.diagnostics?.notificationEligible ?? 0,
eventCandidates: scan?.eventCandidates ?? scan?.diagnostics?.eventCandidates ?? 0,
signalsDeduped: scan?.signalsDeduped ?? scan?.diagnostics?.signalsDeduped ?? 0,
notified: scan?.diagnostics?.notified ?? 0,
coreDirectional: { long: scan?.diagnostics?.longAnalyzed ?? 0, short: scan?.diagnostics?.shortAnalyzed ?? 0, noTrade: scan?.diagnostics?.noTradeAnalyzed ?? 0, valid: scan?.diagnostics?.validSignals ?? 0, watch: scan?.diagnostics?.watchSignals ?? 0 },
radar: { coverage: scan?.radarCoverageMarkets ?? scan?.diagnostics?.radarLane?.coverageMarkets ?? 0, directional: scan?.radarDirectionalMarkets ?? scan?.diagnostics?.radarLane?.directionalMarkets ?? 0, long: scan?.radarLongMarkets ?? scan?.diagnostics?.radarLane?.longMarkets ?? 0, short: scan?.radarShortMarkets ?? scan?.diagnostics?.radarLane?.shortMarkets ?? 0, hot: scan?.radarHotCandidates ?? scan?.diagnostics?.radarLane?.hotCandidateCount ?? 0, watch: scan?.radarWatchCandidates ?? scan?.diagnostics?.radarLane?.watchCandidates ?? 0 },
telegram: scan?.diagnostics?.telegram || null,
subrequestBudget: scan?.diagnostics?.requestStrategy || null,
scheduledPositionReserve
});
Â 
try {
await auditLog(env, {
type: "SCHEDULED_CYCLE",
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
cron,
scheduledTime,
error: safeError(error),
stack: error?.stack || null
});
Â 
// Never allow the error-reporting path itself to create a second
// uncaught exception and turn the Cron invocation into an opaque failure.
try {
await auditLog(env, {
type: "SCHEDULED_CYCLE_ERROR",
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
})();
Â 
// V13.9.6: Cron explicitly awaits the full cycle. This keeps the scan,
// Telegram sends, state persistence, and audit logging inside the scheduled
// invocation lifecycle instead of detaching the task from the handler.
return await task;
},
Â 
async fetch(request, env, ctx){
Â 
Â 
try{
Â 
Â 
const url =
new URL(request.url);
Â 
Â 
Â 
if(
url.pathname === "/status"
){
Â 
return jsonResponse({
Â 
bot:
"Smart Money Futures AI Bot",
Â 
Â 
version:
CONFIG.VERSION,
Â 
Â 
mode:
CONFIG.MODE,
Â 
Â 
execution:
executionEnabled(env),
Â 
Â 
network:
"ARBITRUM",
Â 
Â 
status:
"ONLINE",
Â 
Â 
time:
Date.now()
Â 
Â 
});
Â 
}
Â 
Â 
Â 
Â 
if(
url.pathname === "/debug"
){
Â 
return jsonResponse({
Â 
config:
CONFIG,
Â 
Â 
env:
Â 
Â 
{
Â 
kv:
!!env.BOT_STATE,
Â 
Â 
telegram:
!!env.TELEGRAM_TOKEN,
Â 
Â 
rpc:
!!env.ARBITRUM_RPC
Â 
Â 
}
Â 
Â 
});
Â 
}
Â 
Â 
Â 
Â 
if(
url.searchParams.get("test") === "telegram"
){
Â 
const sent = await sendTelegram(
env,
"Telegram test successful - Smart Money Futures AI Bot V6.3.1"
);
Â 
return jsonResponse({
test: "telegram",
sent,
tokenConfigured: !!env.TELEGRAM_TOKEN,
chatIdConfigured: !!env.TELEGRAM_CHAT_ID,
time: Date.now()
});
}
Â 
Â 
Â 
if(url.pathname === "/debug/gmx/summary"){
return await gmxSummaryRoute(env);
}
Â 
if(url.pathname === "/debug/gmx/markets"){
return await gmxMarketsRoute(env, false);
}
Â 
if(url.pathname === "/debug/gmx/markets/info"){
return await gmxMarketsRoute(env, true);
}
Â 
if(url.pathname === "/markets"){
return await gmxMarketsRoute(env, false);
}
Â 
if(
url.pathname === "/positions"
){
Â 
Â 
const positions =
await loadPositions(env);
Â 
Â 
Â 
return jsonResponse({
Â 
count:
positions.length,
Â 
Â 
positions
Â 
Â 
});
Â 
}
Â 
Â 
Â 
Â 
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
Â 
// /scan is handled above by FUTURES_V6. This marker makes accidental
// fallback routing visible in Cloudflare logs during future debugging.
console.log("[V9.1][ROUTER] fallback apiRouter", { path: url.pathname });
const routedResponse = await apiRouter(request, env);
Â 
if(routedResponse){
return routedResponse;
}
Â 
return new Response(
Â 
"Smart Money Futures AI Bot V9.1 ONLINE",
Â 
{
Â 
status:200,
Â 
headers:{
"content-type":
"text/plain"
Â 
}
Â 
}
Â 
);
Â 
Â 
Â 
}
Â 
catch(error){
Â 
Â 
Â 
return jsonResponse({
Â 
error:
error.message,
Â 
Â 
version:
CONFIG.VERSION,
Â 
Â 
time:
Date.now()
Â 
Â 
},500);
Â 
Â 
Â 
}
Â 
Â 
}
Â 
Â 
Â 
};
Â 
Â 
Â 
Â 
Â 
Â 
// ======================================================
// GMX MARKET INTELLIGENCE V1
// KV CACHE + MARKET EXECUTION TELEMETRY
// ======================================================
Â 
const GMX_CACHE_KEY = "GMX_MARKETS_INFO_CACHE";
const GMX_CACHE_TTL = 15;
Â 
async function getGmxMarketsInfoCached(env){
const now = Math.floor(Date.now()/1000);
Â 
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
Â 
const response = await fetch(
GMX_V2_CONFIG.MARKETS_INFO_URL,
{
headers:{
"accept":"application/json"
}
}
);
Â 
const data = await response.json();
Â 
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
Â 
return {
cache:"MISS",
data
};
}
Â 
function calculateMarketQuality(m){
let score = 0;
Â 
const liquidity = Number(
m.liquidity ||
m.totalLiquidity ||
0
);
Â 
const oi = Number(
m.openInterest ||
m.openInterestUsd ||
0
);
Â 
if(liquidity > 1000000) score += 35;
else if(liquidity > 100000) score += 20;
Â 
if(oi > 1000000) score += 30;
else if(oi > 100000) score += 15;
Â 
if(m.fundingRate !== undefined) score += 20;
if(m.isListed !== false) score += 15;
Â 
return Math.min(score,100);
}
Â 
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
Â 
async function gmxSummaryRoute(env){
try{
const result = await getGmxMarketsInfoCached(env);
Â 
const markets =
Array.isArray(result.data.markets)
? result.data.markets
: [];
Â 
const ranked = markets
.map(normalizeGmxMarketInfo)
.sort((a,b)=>{
// V15 FAIR: this endpoint is telemetry only; do not use this quality
// score to select or prioritize trading candidates.
if(Number(b.qualityScore)!==Number(a.qualityScore)) return Number(b.qualityScore)-Number(a.qualityScore);
return String(a.symbol).localeCompare(String(b.symbol));
})
.slice(0,10);
Â 
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
Â 
}catch(error){
return jsonResponse({
ok:false,
gmx:"error",
error:error.message
},500);
}
}
Â 
// ================================
// RESPONSE HELPER
// ================================
Â 
Â 
function jsonResponse(data,status=200){
Â 
Â 
return new Response(
Â 
JSON.stringify(
data,
null,
2
),
Â 
{
Â 
Â 
status,
Â 
Â 
headers:{
Â 
"content-type":
"application/json"
Â 
}
Â 
Â 
}
Â 
);
Â 
Â 
}
Â 
Â 
Â 
Â 
Â 
// ================================
// KV STATE MANAGER
// ================================
Â 
Â 
async function legacyLoadPositions(env){
Â 
Â 
Â 
if(!env.BOT_STATE){
Â 
return [];
Â 
}
Â 
Â 
Â 
const data =
Â 
await env.BOT_STATE.get(
"positions",
"json"
);
Â 
Â 
Â 
return data || [];
Â 
}
Â 
Â 
Â 
Â 
Â 
async function legacySavePositions(
env,
positions
){
Â 
Â 
Â 
if(!env.BOT_STATE){
Â 
return false;
Â 
}
Â 
Â 
Â 
await env.BOT_STATE.put(
Â 
"positions",
Â 
JSON.stringify(
positions
)
Â 
);
Â 
Â 
Â 
return true;
Â 
Â 
}
Â 
Â 
Â 
Â 
Â 
// ================================
// AUDIT LOGGER
// ================================
Â 
Â 
async function auditLog(
env,
event
){
Â 
Â 
Â 
if(!env.BOT_STATE){
Â 
return;
Â 
}
Â 
Â 
Â 
const logs =
Â 
await env.BOT_STATE.get(
"audit",
"json"
)
||
[];
Â 
Â 
Â 
Â 
logs.push({
Â 
event,
Â 
Â 
time:
Date.now()
Â 
Â 
});
Â 
Â 
Â 
await env.BOT_STATE.put(
Â 
"audit",
Â 
JSON.stringify(
logs.slice(-100)
)
Â 
);
Â 
Â 
Â 
}
Â 
Â 
Â 
Â 
Â 
// ================================
// SYSTEM HEALTH
// ================================
Â 
Â 
function systemHealth(env){
Â 
Â 
Â 
return {
Â 
Â 
version:
CONFIG.VERSION,
Â 
Â 
execution:
executionEnabled(env),
Â 
Â 
mode:
CONFIG.MODE,
Â 
Â 
healthy:true,
Â 
Â 
timestamp:
Date.now()
Â 
Â 
};
Â 
Â 
Â 
}
// ======================================================
// MARKET INTELLIGENCE ENGINE
// V6.3.1 PART 2
// ======================================================
Â 
Â 
Â 
// ================================
// MARKET STATE CACHE
// ================================
Â 
Â 
const MARKET_CACHE = {};
Â 
Â 
Â 
Â 
Â 
function updateMarketData(
symbol,
data
){
Â 
Â 
Â 
MARKET_CACHE[symbol]={
Â 
Â 
...MARKET_CACHE[symbol],
Â 
Â 
...data,
Â 
Â 
updatedAt:
Date.now()
Â 
Â 
};
Â 
Â 
Â 
return MARKET_CACHE[symbol];
Â 
Â 
}
Â 
Â 
Â 
Â 
Â 
Â 
function getMarketData(symbol){
Â 
Â 
return MARKET_CACHE[symbol] || null;
Â 
Â 
}
Â 
Â 
Â 
Â 
Â 
// ================================
// PRICE ANALYSIS
// ================================
Â 
Â 
function analyzePrice(data){
Â 
Â 
let score=0;
Â 
Â 
Â 
if(
data.change5m >= 3
){
Â 
score +=20;
Â 
}
Â 
Â 
Â 
if(
data.change15m >=5
){
Â 
score +=20;
Â 
}
Â 
Â 
Â 
if(
data.trend==="UP"
){
Â 
score +=10;
Â 
}
Â 
Â 
Â 
return score;
Â 
Â 
}
Â 
Â 
Â 
Â 
Â 
// ================================
// VOLUME ANALYSIS
// ================================
Â 
Â 
function analyzeVolume(data){
Â 
Â 
Â 
let score=0;
Â 
Â 
Â 
if(
data.volumeChange >=100
){
Â 
score+=20;
Â 
}
Â 
Â 
Â 
if(
data.volumeChange >=300
){
Â 
score+=15;
Â 
}
Â 
Â 
Â 
return score;
Â 
Â 
}
Â 
Â 
Â 
Â 
Â 
Â 
// ================================
// OPEN INTEREST ENGINE
// ================================
Â 
Â 
function analyzeOpenInterest(data){
Â 
Â 
Â 
let score=0;
Â 
Â 
Â 
if(
data.openInterestChange>=10
){
Â 
score+=10;
Â 
}
Â 
Â 
Â 
if(
data.openInterestChange>=30
){
Â 
score+=20;
Â 
}
Â 
Â 
Â 
return score;
Â 
Â 
}
Â 
Â 
Â 
Â 
Â 
Â 
// ================================
// FUNDING RATE ANALYSIS
// ================================
Â 
Â 
function analyzeFunding(data){
Â 
Â 
Â 
let score=0;
Â 
Â 
Â 
const funding =
data.fundingRate || 0;
Â 
Â 
Â 
Â 
// Avoid overcrowded longs
Â 
if(
funding > 0.10
){
Â 
score-=15;
Â 
}
Â 
Â 
Â 
// Healthy short pressure
Â 
if(
funding < -0.05
){
Â 
score+=10;
Â 
}
Â 
Â 
Â 
return score;
Â 
Â 
}
Â 
Â 
Â 
Â 
Â 
Â 
// ================================
// ORDERBOOK IMBALANCE
// ================================
Â 
Â 
function analyzeOrderbook(data){
Â 
Â 
Â 
const imbalance =
Â 
data.orderbookImbalance || 0;
Â 
Â 
Â 
if(
imbalance > 0.40
){
Â 
return 20;
Â 
}
Â 
Â 
Â 
if(
imbalance > 0.20
){
Â 
return 10;
Â 
}
Â 
Â 
Â 
if(
imbalance < -0.40
){
Â 
return -20;
Â 
}
Â 
Â 
Â 
return 0;
Â 
Â 
}
Â 
Â 
Â 
Â 
Â 
Â 
// ================================
// FAKE PUMP DETECTOR
// ================================
Â 
Â 
function detectFakePump(data){
Â 
Â 
Â 
let risk=0;
Â 
Â 
Â 
// Price moving without OI support
Â 
if(
Â 
data.change5m > 10 &&
Â 
data.openInterestChange < 5
Â 
){
Â 
risk+=40;
Â 
}
Â 
Â 
Â 
Â 
// Volume spike with weak liquidity
Â 
if(
Â 
data.volumeChange > 500 &&
Â 
data.liquidity < 500000
Â 
){
Â 
risk+=30;
Â 
}
Â 
Â 
Â 
return Math.min(
risk,
100
);
Â 
Â 
}
Â 
Â 
Â 
Â 
Â 
Â 
// ================================
// LIQUIDITY TRAP DETECTOR
// ================================
Â 
Â 
function detectLiquidityTrap(data){
Â 
Â 
Â 
let risk=0;
Â 
Â 
Â 
if(
Â 
data.volumeChange > 300 &&
Â 
data.liquidity < 1000000
Â 
){
Â 
risk+=50;
Â 
}
Â 
Â 
Â 
if(
Â 
data.spread > 1
Â 
){
Â 
risk+=20;
Â 
}
Â 
Â 
Â 
return Math.min(
risk,
100
);
Â 
Â 
}
Â 
Â 
Â 
Â 
Â 
Â 
// ================================
// SMART MONEY SCORE ENGINE
// ================================
Â 
Â 
function calculateSmartMoneyScore(data){
Â 
Â 
Â 
let score=50;
Â 
Â 
Â 
score += analyzePrice(data);
Â 
Â 
score += analyzeVolume(data);
Â 
Â 
score += analyzeOpenInterest(data);
Â 
Â 
score += analyzeFunding(data);
Â 
Â 
score += analyzeOrderbook(data);
Â 
Â 
Â 
Â 
// Risk reduction
Â 
score -= detectFakePump(data);
Â 
Â 
score -= detectLiquidityTrap(data);
Â 
Â 
Â 
Â 
Â 
return Math.max(
Â 
0,
Â 
Math.min(
score,
100
)
Â 
);
Â 
Â 
Â 
}
Â 
Â 
Â 
Â 
Â 
Â 
// ================================
// MARKET ANALYSIS PIPELINE
// ================================
Â 
Â 
function analyzeMarket(symbol){
Â 
Â 
Â 
const data =
getMarketData(symbol);
Â 
Â 
Â 
if(!data){
Â 
Â 
return {
Â 
Â 
symbol,
Â 
Â 
status:
"NO_DATA"
Â 
Â 
};
Â 
Â 
}
Â 
Â 
Â 
const score =
Â 
calculateSmartMoneyScore(data);
Â 
Â 
Â 
Â 
return {
Â 
Â 
symbol,
Â 
Â 
score,
Â 
Â 
fakePumpRisk:
Â 
detectFakePump(data),
Â 
Â 
Â 
liquidityRisk:
Â 
detectLiquidityTrap(data),
Â 
Â 
Â 
timestamp:
Date.now()
Â 
Â 
};
Â 
Â 
Â 
}
// ======================================================
// MULTI AGENT STRATEGY ENGINE
// V6.3.1 PART 3
// ======================================================
Â 
Â 
Â 
// ================================
// MOMENTUM AGENT
// ================================
Â 
Â 
function momentumAgent(data){
Â 
Â 
let score=0;
Â 
Â 
Â 
if(
data.change5m >=3
){
Â 
score+=25;
Â 
}
Â 
Â 
Â 
if(
data.change15m >=5
){
Â 
score+=20;
Â 
}
Â 
Â 
Â 
if(
data.volumeChange>=200
){
Â 
score+=25;
Â 
}
Â 
Â 
Â 
return Math.min(
score,
100
);
Â 
Â 
}
Â 
Â 
Â 
Â 
Â 
Â 
// ================================
// SMART MONEY AGENT
// ================================
Â 
Â 
function smartMoneyAgent(data){
Â 
Â 
Â 
let score=0;
Â 
Â 
Â 
if(
data.openInterestChange>=20
){
Â 
score+=30;
Â 
}
Â 
Â 
Â 
if(
data.largeOrders===true
){
Â 
score+=25;
Â 
}
Â 
Â 
Â 
if(
data.orderbookImbalance>0.3
){
Â 
score+=25;
Â 
}
Â 
Â 
Â 
return Math.min(
score,
100
);
Â 
Â 
}
Â 
Â 
Â 
Â 
Â 
Â 
// ================================
// TREND AGENT
// ================================
Â 
Â 
function trendAgent(data){
Â 
Â 
Â 
let score=0;
Â 
Â 
Â 
if(
data.trend==="UP"
){
Â 
score+=30;
Â 
}
Â 
Â 
Â 
if(
data.higherTimeframeTrend==="UP"
){
Â 
score+=40;
Â 
}
Â 
Â 
Â 
if(
data.maFast >
data.maSlow
){
Â 
score+=20;
Â 
}
Â 
Â 
Â 
return Math.min(
score,
100
);
Â 
Â 
}
Â 
Â 
Â 
Â 
Â 
Â 
// ================================
// REVERSAL SAFETY AGENT
// ??????? ?? ???? ????? ???
// ================================
Â 
Â 
function reversalAgent(data){
Â 
Â 
Â 
let risk=0;
Â 
Â 
Â 
if(
data.change1h>15
){
Â 
risk+=30;
Â 
}
Â 
Â 
Â 
if(
data.volumeChange < data.priceChange*10
){
Â 
risk+=20;
Â 
}
Â 
Â 
Â 
return risk;
Â 
Â 
}
Â 
Â 
Â 
Â 
Â 
Â 
Â 
// ================================
// LEGACY STRATEGY VOTING (NOT USED BY FUTURES_V6 CANONICAL ENGINE)
// ================================
Â 
Â 
function legacyStrategyVote(data){
Â 
Â 
Â 
const votes={
Â 
Â 
momentum:
Â 
momentumAgent(data),
Â 
Â 
Â 
smartMoney:
Â 
smartMoneyAgent(data),
Â 
Â 
Â 
trend:
Â 
trendAgent(data)
Â 
Â 
};
Â 
Â 
Â 
Â 
let finalScore =
Â 
(
votes.momentum +
Â 
votes.smartMoney +
Â 
votes.trend
Â 
)
/3;
Â 
Â 
Â 
Â 
// ???? ?????? ?? ???? ??? ?????
Â 
finalScore -=
Â 
reversalAgent(data);
Â 
Â 
Â 
Â 
return {
Â 
Â 
votes,
Â 
Â 
finalScore:
Â 
Math.max(
Â 
0,
Â 
Math.min(
finalScore,
100
)
Â 
)
Â 
Â 
Â 
};
Â 
Â 
Â 
}
Â 
Â 
Â 
Â 
Â 
Â 
Â 
// ================================
// MARKET RANKING ENGINE
// ================================
Â 
Â 
function rankMarkets(markets){
Â 
Â 
Â 
return markets.sort(
Â 
(a,b)=>
Â 
b.finalScore - a.finalScore
Â 
);
Â 
Â 
}
Â 
Â 
Â 
Â 
Â 
Â 
Â 
// ================================
// BEST OPPORTUNITY SELECTOR
// ================================
Â 
Â 
function selectBestMarkets(
markets
){
Â 
Â 
Â 
const ranked =
Â 
rankMarkets(markets);
Â 
Â 
Â 
Â 
return ranked.slice(
0,
3
);
Â 
Â 
}
Â 
Â 
Â 
Â 
Â 
Â 
// ================================
// FULL AI MARKET SCAN
// ================================
Â 
Â 
function runAIScan(symbols){
Â 
Â 
Â 
const results=[];
Â 
Â 
Â 
for(
const symbol of symbols
){
Â 
Â 
Â 
const data =
getMarketData(symbol);
Â 
Â 
Â 
if(!data)
continue;
Â 
Â 
Â 
const analysis =
Â 
legacyStrategyVote(data);
Â 
Â 
Â 
Â 
results.push({
Â 
symbol,
Â 
Â 
...analysis
Â 
Â 
});
Â 
Â 
Â 
}
Â 
Â 
Â 
return selectBestMarkets(
results
);
Â 
Â 
}
// ======================================================
// PORTFOLIO MANAGER & RISK ENGINE
// V6.3.1 PART 4
// ======================================================
Â 
Â 
Â 
Â 
// ================================
// PORTFOLIO STATE
// ================================
Â 
Â 
const PORTFOLIO = {
Â 
Â 
positions: [],
Â 
Â 
dailyLoss:0,
Â 
Â 
balance:0
Â 
Â 
};
Â 
Â 
Â 
Â 
Â 
Â 
Â 
// ================================
// POSITION LIMIT CHECK
// ================================
Â 
Â 
function canOpenPosition(){
Â 
Â 
Â 
return (
Â 
PORTFOLIO.positions.length
<
CONFIG.MAX_POSITIONS
Â 
);
Â 
Â 
}
Â 
Â 
Â 
Â 
Â 
Â 
Â 
// ================================
// CAPITAL ALLOCATION
// ================================
Â 
Â 
function calculateTradeSize(balance,score){
Â 
Â 
Â 
let allocation =
Â 
CONFIG.CAPITAL_PER_TRADE;
Â 
Â 
Â 
Â 
// ?????????? ????? ???
Â 
if(
score>=95
){
Â 
allocation=0.07;
Â 
}
Â 
Â 
Â 
Â 
// ????? ???????
Â 
if(
score<90
){
Â 
allocation=0.03;
Â 
}
Â 
Â 
Â 
Â 
return {
Â 
Â 
capital:
Â 
balance*allocation,
Â 
Â 
percentage:
Â 
allocation
Â 
Â 
};
Â 
Â 
}
Â 
Â 
Â 
Â 
Â 
Â 
Â 
// ================================
// CORRELATION ENGINE
// ================================
Â 
Â 
Â 
function calculateCorrelation(
asset1,
asset2
){
Â 
Â 
Â 
// ?? ???? ???? ?? ???? ????? ?????? ??????
Â 
// ????? ??? ????
Â 
Â 
Â 
if(
asset1.base===asset2.base
){
Â 
return 1;
Â 
}
Â 
Â 
Â 
return 0.5;
Â 
Â 
}
Â 
Â 
Â 
Â 
Â 
Â 
Â 
function checkCorrelation(
newSignal
){
Â 
Â 
Â 
for(
const position of PORTFOLIO.positions
){
Â 
Â 
Â 
const correlation =
Â 
calculateCorrelation(
Â 
newSignal,
Â 
position
Â 
);
Â 
Â 
Â 
Â 
if(
correlation>=0.8
){
Â 
return {
Â 
Â 
allowed:false,
Â 
Â 
reason:
"High correlation"
Â 
Â 
};
Â 
}
Â 
Â 
Â 
}
Â 
Â 
Â 
return {
Â 
Â 
allowed:true
Â 
Â 
};
Â 
Â 
}
Â 
Â 
Â 
Â 
Â 
Â 
Â 
Â 
// ================================
// RISK CHECK
// ================================
Â 
Â 
function legacyRiskGuard(signal){
Â 
Â 
Â 
if(
!canOpenPosition()
){
Â 
return {
Â 
Â 
allowed:false,
Â 
Â 
reason:
"Maximum positions reached"
Â 
Â 
};
Â 
Â 
}
Â 
Â 
Â 
Â 
Â 
const correlation =
Â 
checkCorrelation(signal);
Â 
Â 
Â 
Â 
if(
!correlation.allowed
){
Â 
return correlation;
Â 
}
Â 
Â 
Â 
Â 
Â 
Â 
if(
PORTFOLIO.dailyLoss
<=
-Â Â Â Â Â Â Â Â  Â Â Â Â Â Â Â Â  CONFIG.MAX_DAILY_LOSS
){
Â 
return {
Â 
Â 
allowed:false,
Â 
Â 
reason:
"Daily loss limit"
Â 
Â 
};
Â 
Â 
}
Â 
Â 
Â 
Â 
return {
Â 
Â 
allowed:true
Â 
Â 
};
Â 
Â 
Â 
}
Â 
Â 
Â 
Â 
Â 
Â 
Â 
Â 
Â 
// ================================
// SIGNAL PRIORITY RANKING
// ================================
Â 
Â 
function rankSignals(signals){
Â 
return signals.sort((a,b)=>{
Â 
const scoreA = Number(a?.finalScore ?? a?.score ?? 0);
const scoreB = Number(b?.finalScore ?? b?.score ?? 0);
Â 
if (scoreB !== scoreA) return scoreB - scoreA;
Â 
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
Â 
return precisionB - precisionA;
Â 
});
Â 
}
Â 
Â 
// ================================
// SELECT BEST OPPORTUNITY
// ================================
Â 
Â 
function chooseBestSignal(
signals
){
Â 
Â 
Â 
const ranked =
Â 
rankSignals(signals);
Â 
Â 
Â 
return ranked[0] || null;
Â 
Â 
}
Â 
Â 
Â 
Â 
Â 
Â 
Â 
Â 
// ================================
// CREATE POSITION
// ================================
Â 
Â 
function createPortfolioPosition(
signal,
balance
){
Â 
Â 
Â 
const size =
Â 
calculateTradeSize(
Â 
balance,
Â 
signal.finalScore
Â 
);
Â 
Â 
Â 
Â 
const position={
Â 
Â 
Â 
id:
Â 
crypto.randomUUID(),
Â 
Â 
Â 
symbol:
Â 
signal.symbol,
Â 
Â 
Â 
side:
Â 
signal.direction || "LONG",
Â 
Â 
Â 
score:
Â 
signal.finalScore,
Â 
Â 
Â 
smartMoney:
Â 
signal.votes.smartMoney,
Â 
Â 
Â 
capital:
Â 
size.capital,
Â 
Â 
Â 
openedAt:
Â 
Date.now(),
Â 
Â 
Â 
status:
Â 
"OPEN"
Â 
Â 
};
Â 
Â 
Â 
Â 
Â 
PORTFOLIO.positions.push(
position
);
Â 
Â 
Â 
return position;
Â 
Â 
}
Â 
Â 
Â 
Â 
Â 
Â 
Â 
Â 
// ================================
// REMOVE POSITION
// ================================
Â 
Â 
function closePortfolioPosition(
id,
pnl
){
Â 
Â 
Â 
PORTFOLIO.positions =
Â 
PORTFOLIO.positions.filter(
Â 
p=>p.id!==id
Â 
);
Â 
Â 
Â 
Â 
if(
pnl<0
){
Â 
PORTFOLIO.dailyLoss += pnl;
Â 
}
Â 
Â 
Â 
return true;
Â 
Â 
}
Â 
Â 
Â 
Â 
Â 
Â 
// ================================
// PORTFOLIO STATUS
// ================================
Â 
Â 
function getPortfolioStatus(){
Â 
Â 
Â 
return {
Â 
Â 
openPositions:
Â 
PORTFOLIO.positions.length,
Â 
Â 
positions:
Â 
PORTFOLIO.positions,
Â 
Â 
dailyLoss:
Â 
PORTFOLIO.dailyLoss
Â 
Â 
};
Â 
Â 
}
// ======================================================
// POSITION MANAGER & SMART EXIT ENGINE
// V6.3.1 PART 5
// ======================================================
Â 
Â 
Â 
// ================================
// POSITION CONFIG
// ================================
Â 
Â 
const POSITION_CONFIG = {
Â 
Â 
TP_LEVELS:[
Â 
30,
Â 
60,
Â 
100
Â 
],
Â 
Â 
STOP_LOSS:
Â 
10,
Â 
Â 
TRAILING_PERCENT:
Â 
8
Â 
Â 
};
Â 
Â 
Â 
Â 
Â 
// ================================
// CALCULATE PNL
// ================================
Â 
Â 
function calculatePnL(
position,
currentPrice
){
Â 
Â 
Â 
let pnl;
Â 
Â 
Â 
if(
position.side==="LONG"
){
Â 
Â 
pnl =
Â 
(
(
currentPrice -
position.entryPrice
)
/
position.entryPrice
Â 
)
*
100;
Â 
Â 
Â 
}
Â 
Â 
else{
Â 
Â 
pnl =
Â 
(
(
position.entryPrice -
currentPrice
)
/
position.entryPrice
Â 
)
*
100;
Â 
Â 
Â 
}
Â 
Â 
Â 
Â 
return Number(
pnl.toFixed(2)
);
Â 
Â 
}
Â 
Â 
Â 
Â 
Â 
Â 
// ================================
// PARTIAL TAKE PROFIT ENGINE
// ================================
Â 
Â 
function checkPartialTP(
position,
pnl
){
Â 
Â 
Â 
for(
const level of POSITION_CONFIG.TP_LEVELS
){
Â 
Â 
Â 
if(
Â 
pnl>=level &&
Â 
!position.closedTP?.includes(level)
Â 
){
Â 
Â 
return {
Â 
Â 
action:
"PARTIAL_CLOSE",
Â 
Â 
level
Â 
Â 
};
Â 
Â 
Â 
}
Â 
Â 
Â 
}
Â 
Â 
Â 
return null;
Â 
Â 
}
Â 
Â 
Â 
Â 
Â 
Â 
Â 
// ================================
// STOP LOSS ENGINE
// ================================
Â 
Â 
function checkStopLoss(
position,
pnl
){
Â 
Â 
Â 
if(
pnl <=
-
POSITION_CONFIG.STOP_LOSS
){
Â 
Â 
Â 
return {
Â 
Â 
action:
"CLOSE_ALL",
Â 
Â 
reason:
"STOP_LOSS"
Â 
Â 
};
Â 
Â 
}
Â 
Â 
Â 
return null;
Â 
Â 
}
Â 
Â 
Â 
Â 
Â 
Â 
Â 
// ================================
// TRAILING STOP ENGINE
// ================================
Â 
Â 
function updateTrailingStop(
position,
currentPrice
){
Â 
Â 
Â 
if(
!CONFIG.TRAILING_STOP
){
Â 
return position;
Â 
}
Â 
Â 
Â 
Â 
Â 
if(
position.side==="LONG"
){
Â 
Â 
Â 
const newStop =
Â 
currentPrice *
(
POSITION_CONFIG.TRAILING_PERCENT/100
);
Â 
Â 
Â 
Â 
Â 
if(
!position.trailingStop ||
Â 
newStop >
position.trailingStop
){
Â 
Â 
position.trailingStop =
newStop;
Â 
Â 
}
Â 
Â 
Â 
}
Â 
Â 
Â 
Â 
Â 
else{
Â 
Â 
const newStop =
Â 
currentPrice *
(
POSITION_CONFIG.TRAILING_PERCENT/100
);
Â 
Â 
Â 
Â 
Â 
if(
!position.trailingStop ||
Â 
newStop <
position.trailingStop
){
Â 
Â 
position.trailingStop =
newStop;
Â 
Â 
}
Â 
Â 
Â 
}
Â 
Â 
Â 
Â 
Â 
return position;
Â 
Â 
}
Â 
Â 
Â 
Â 
Â 
Â 
Â 
// ================================
// TRAILING STOP CHECK
// ================================
Â 
Â 
function checkTrailingStop(
position,
price
){
Â 
Â 
Â 
if(
!position.trailingStop
){
Â 
return null;
Â 
}
Â 
Â 
Â 
if(
position.side==="LONG" &&
Â 
price <= position.trailingStop
Â 
){
Â 
Â 
return {
Â 
Â 
action:
"CLOSE_ALL",
Â 
Â 
reason:
"TRAILING_STOP"
Â 
Â 
};
Â 
Â 
}
Â 
Â 
Â 
Â 
Â 
Â 
if(
position.side==="SHORT" &&
Â 
price >= position.trailingStop
Â 
){
Â 
Â 
return {
Â 
Â 
action:
"CLOSE_ALL",
Â 
Â 
reason:
"TRAILING_STOP"
Â 
Â 
};
Â 
Â 
}
Â 
Â 
Â 
return null;
Â 
Â 
}
Â 
Â 
Â 
Â 
Â 
Â 
Â 
// ================================
// SMART EXIT ENGINE
// ================================
Â 
Â 
function smartExitCheck(
position,
market
){
Â 
Â 
Â 
// ??? Smart Money
Â 
Â 
if(
market.smartMoneyScore < 50
){
Â 
Â 
return {
Â 
Â 
action:
"CLOSE_ALL",
Â 
Â 
reason:
"SMART_MONEY_EXIT"
Â 
Â 
};
Â 
Â 
}
Â 
Â 
Â 
Â 
Â 
Â 
// ??? ??? ????
Â 
Â 
if(
market.volumeChange < -50
){
Â 
Â 
return {
Â 
Â 
action:
"CLOSE_ALL",
Â 
Â 
reason:
"VOLUME_FADE"
Â 
Â 
};
Â 
Â 
}
Â 
Â 
Â 
Â 
Â 
Â 
return null;
Â 
Â 
}
Â 
Â 
Â 
Â 
Â 
Â 
Â 
// ================================
// POSITION MONITOR
// ================================
Â 
Â 
function monitorPosition(
position,
market
){
Â 
Â 
Â 
const pnl =
Â 
calculatePnL(
Â 
position,
Â 
market.price
Â 
);
Â 
Â 
Â 
Â 
Â 
const tp =
Â 
checkPartialTP(
position,
pnl
);
Â 
Â 
Â 
if(tp){
Â 
return tp;
Â 
}
Â 
Â 
Â 
Â 
Â 
Â 
const sl =
Â 
checkStopLoss(
position,
pnl
);
Â 
Â 
Â 
if(sl){
Â 
return sl;
Â 
}
Â 
Â 
Â 
Â 
Â 
Â 
updateTrailingStop(
Â 
position,
Â 
market.price
Â 
);
Â 
Â 
Â 
Â 
Â 
const trailing =
Â 
checkTrailingStop(
Â 
position,
Â 
market.price
Â 
);
Â 
Â 
Â 
if(trailing){
Â 
return trailing;
Â 
}
Â 
Â 
Â 
Â 
Â 
const smartExit =
Â 
smartExitCheck(
Â 
position,
Â 
market
Â 
);
Â 
Â 
Â 
if(smartExit){
Â 
return smartExit;
Â 
}
Â 
Â 
Â 
Â 
Â 
return {
Â 
Â 
action:
"HOLD",
Â 
Â 
pnl
Â 
Â 
};
Â 
Â 
}
// ======================================================
// MAIN ENGINE + TELEGRAM CONTROL
// V6.1.1 PART 6
// ======================================================
Â 
Â 
Â 
// ================================
// BOT STATE
// ================================
Â 
Â 
const BOT_STATE = {
Â 
Â 
running:true,
Â 
Â 
lastScan:null,
Â 
Â 
signals:[],
Â 
Â 
executions:0,
Â 
Â 
errors:0
Â 
Â 
};
Â 
Â 
Â 
Â 
Â 
// ================================
// MARKET WATCHLIST
// ================================
Â 
Â 
const WATCHLIST = [
Â 
Â 
"BTC-PERP",
Â 
"ETH-PERP",
Â 
"SOL-PERP",
Â 
"ARB-PERP",
Â 
"AVAX-PERP",
Â 
"INJ-PERP",
Â 
"LINK-PERP",
Â 
"OP-PERP",
Â 
"APT-PERP",
Â 
"NEAR-PERP"
Â 
Â 
];
Â 
Â 
Â 
Â 
Â 
// ================================
// LIVE GMX EXECUTION ENGINE V6.1
// ================================
Â 
let LIVE_CONTEXT = null;
Â 
function validatePrivateKey(key) {
if (!/^0x[0-9a-fA-F]{64}$/.test(String(key || ""))) throw new Error("GMX_PRIVATE_KEY is missing or invalid");
}
Â 
async function getLiveContext(env) {
if (!executionEnabled(env)) throw new Error("Execution disabled: set Cloudflare ENV EXECUTION_ENABLED=true");
if (!GmxApiSdk || !PrivateKeySigner || !getViemChain) {
throw new Error("Bundled GMX SDK exports are unavailable");
}
validatePrivateKey(env.GMX_PRIVATE_KEY);
if (!env.ARBITRUM_RPC) throw new Error("ARBITRUM_RPC is required");
if (LIVE_CONTEXT && LIVE_CONTEXT.rpc === env.ARBITRUM_RPC) return LIVE_CONTEXT;
Â 
const signer = new PrivateKeySigner(env.GMX_PRIVATE_KEY, {
rpcUrl: env.ARBITRUM_RPC,
chain: getViemChain(42161)
});
const sdk = new GmxApiSdk({ chainId: 42161 });
LIVE_CONTEXT = { sdk, signer, account: signer.address, rpc: env.ARBITRUM_RPC };
return LIVE_CONTEXT;
}
Â 
function toBigIntDecimal(value, decimals) {
const s = Number(value).toFixed(Math.min(decimals,8));
const [whole,frac=""] = s.split(".");
return BigInt(whole)*10n**BigInt(decimals)+BigInt((frac+"0".repeat(decimals)).slice(0,decimals)||"0");
}
Â 
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
Â 
function extractCollateralBalances(balances) {
const arr=Array.isArray(balances)?balances:Array.isArray(balances?.balances)?balances.balances:Object.values(balances||{});
const result={USDC:null,USDT:null};
for (const b of arr) {
const rawSymbol=String(b?.tokenSymbol||b?.symbol||b?.token?.symbol||"").toUpperCase();
const symbol=rawSymbol==="USDC.E" ? "USDC" : rawSymbol;
if (symbol!=="USDC" && symbol!=="USDT") continue;
let usd=Number(b?.balanceUsd??b?.balanceUSD??b?.usdValue??0);
const raw=Number(b?.balance??b?.amount??0);
const decimals=Number(b?.decimals??6);
if (!(usd>0) && raw>0) usd=raw/10**decimals;
if (usd>0) {
  result[symbol]={symbol,usd,balance:raw,decimals};
}
}
return result;
}

function extractUsdcUsd(balances) {
return Number(extractCollateralBalances(balances)?.USDC?.usd || 0);
}

function marketCollateralSymbols(market) {
const raw=JSON.stringify({
symbol:market?.symbol,
name:market?.name,
longToken:market?.longToken,
shortToken:market?.shortToken,
longTokenSymbol:market?.longTokenSymbol,
shortTokenSymbol:market?.shortTokenSymbol,
collateralTokens:market?.collateralTokens,
collateralTokenSymbols:market?.collateralTokenSymbols
}).toUpperCase();
const out=new Set();
if (raw.includes("USDC")) out.add("USDC");
if (raw.includes("USDT")) out.add("USDT");
return out;
}

function findSdkMarketWithCollateral(markets, symbol, collateralSymbol) {
const wanted=liveNormalizeSymbol(symbol);
const collateral=String(collateralSymbol||"").toUpperCase();
const matches=(markets||[]).filter(m=>{
if (m?.isSpotOnly) return false;
const raw=String(m?.symbol||m?.name||"");
const base=liveNormalizeSymbol(raw.split("/")[0]);
const indexName=liveNormalizeSymbol(raw.split("/")[0].split("[")[0]);
return base===wanted || indexName===wanted;
});
return matches.find(m=>marketCollateralSymbols(m).has(collateral))
  || (matches.length===1 && marketCollateralSymbols(matches[0]).size===0 ? matches[0] : null);
}

function selectLiveCollateral(markets, symbol, balances) {
const available=extractCollateralBalances(balances);
for (const preferred of ["USDC","USDT"]) {
const bal=available[preferred];
if (!(bal?.usd>0)) continue;
const market=findSdkMarketWithCollateral(markets,symbol,preferred);
if (market) return {symbol:preferred,usd:bal.usd,balance:bal.balance,decimals:bal.decimals,market};
}
return null;
}
Â 
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
if (existing && existing.status === "submitted") {
INFLIGHT.delete(key);
return { acquired:false, reason:"Duplicate live execution blocked", key, existing };
}
await env.BOT_STATE.put(`live_exec:${key}`, JSON.stringify({status:"submitted",at:Date.now(),symbol:signal?.symbol,direction:signal?.direction}), { expirationTtl: 86400 });
}
return { acquired:true, key };
} catch (error) {
INFLIGHT.delete(key);
throw error;
}
}

function releaseLiveExecutionLock(key) { if (key) INFLIGHT.delete(key); }


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
const same = corePositions.some(pos => liveBaseAsset(liveNormalizeSymbol(String(pos?.indexName || pos?.symbol || ""))) === liveBaseAsset(symbol));
if (same) return { executed:false, mode:"LIVE", lane:"RADAR", reason:"Symbol already occupied by live portfolio" };
}
const balances = await sdk.fetchWalletBalances({ address: account });
const collateral = selectLiveCollateral(markets, requestedSymbol, balances);
if (!collateral) {
  throw new Error("No usable USDC/USDT balance with a matching GMX collateral market was detected for Radar");
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
const notionalUsd = Math.min(allocationNotional, riskBasedNotional, CONFIG.RADAR_LIVE_MAX_POSITION_NOTIONAL_USD, capacityUsd > 0 ? capacityUsd : Number.MAX_SAFE_INTEGER);
if (notionalUsd < CONFIG.MIN_POSITION_NOTIONAL_USD) throw new Error(`Radar calculated notional too small: ${notionalUsd}`);

const size = toBigIntDecimal(notionalUsd, 30);
const collateralAmount = toBigIntDecimal(collateralUsd, 6);
const tp = toBigIntDecimal(plan.tp1, 30);
const sl = toBigIntDecimal(plan.stopLoss, 30);
const signalLike = { symbol, direction: plan.direction, signalTier: "RADAR", tradePlan: { entry: plan.entry, stopLoss: plan.stopLoss, tp1: plan.tp1 } };
const lock = await acquireLiveExecutionLock(env, signalLike);
if (!lock.acquired) return { executed:false, mode:"LIVE", lane:"RADAR", reason:lock.reason, executionKey:lock.key };
try {
const result = await sdk.executeExpressOrder({
kind:"increase", symbol:market.symbol, direction:plan.direction === "LONG" ? "long" : "short", orderType:"market",
size, collateralToken:collateral.symbol, collateralToPay:{amount:collateralAmount,token:collateral.symbol}, mode:"express", from:account,
tpsl:[{type:"take-profit",triggerPrice:tp,size},{type:"stop-loss",triggerPrice:sl,size}]
}, signer);
ledger[key] = { status:"OPEN", lane:"RADAR", symbol, direction:plan.direction, radarScore:plan.score, radarEdge:Number(candidate?.pumpRadar?.edge || 0), entryPrice:plan.entry, initialStopPrice:plan.stopLoss, tp1:plan.tp1, tp2:plan.tp2, tp3:plan.tp3, leverage, notionalUsd, collateralToken:collateral.symbol, openedAt:Date.now(), requestId:result?.requestId || null };
await saveRadarLiveLedger(env, ledger);
return { executed:true, mode:"LIVE", lane:"RADAR", account, symbol, direction:plan.direction, radarScore:plan.score, radarEdge:Number(candidate?.pumpRadar?.edge || 0), leverage, walletUsd, collateralUsd, collateralToken:collateral.symbol, notionalUsd, requestId:result?.requestId || null, executionKey:lock.key };
} finally { releaseLiveExecutionLock(lock.key); }
}

async function executeLiveSignal(signal, env) {
if (!executionEnabled(env)) return {executed:false,mode:"SIGNAL",reason:"Execution disabled"};
if (!signal?.executionEligible) return {executed:false,mode:"LIVE",reason:"Signal is not execution-eligible"};
if (!signal?.tradePlan?.valid || !["LONG","SHORT"].includes(signal.direction)) return {executed:false,mode:"LIVE",reason:"Invalid live signal"};

const {sdk,signer,account}=await getLiveContext(env);
const positions=await sdk.fetchPositionsInfo({address:account});
const radarLedger = await loadRadarLiveLedger(env);
const radarOpenCount = Object.values(radarLedger).filter(v => v && v.status === "OPEN").length;
const coreLiveCount = Math.max(0, Array.isArray(positions) ? positions.length - radarOpenCount : 0);
if (coreLiveCount>=CONFIG.MAX_POSITIONS) throw new Error("Maximum Core live positions reached");
const markets=await sdk.fetchMarkets();
const balances=await sdk.fetchWalletBalances({address:account});
const collateral=selectLiveCollateral(markets, signal.symbol, balances);
if (!collateral) throw new Error("No usable USDC/USDT balance with a matching GMX collateral market was detected");
const market=collateral.market;
const sdkSymbol=market.symbol;
const direction=signal.direction==="LONG"?"long":"short";
const capacity=await sdk.getTradingCapacity({symbol:sdkSymbol,direction});
const capacityUsd=Number(capacity?.availableLiquidity||0n)/1e30;
const walletUsd=collateral.usd;
const leverage=Number(signal.tradePlan.leverage||CONFIG.DEFAULT_LEVERAGE);
if (!Number.isFinite(leverage)||leverage<=0||leverage>CONFIG.MAX_LEVERAGE) throw new Error(`Invalid leverage: ${leverage}`);
const allocation=Number(signal.tradePlan.allocation??allocationFromScore(signal.score));
if (!Number.isFinite(allocation)||allocation<=0||allocation>CONFIG.MAX_CAPITAL_ALLOCATION) throw new Error(`Invalid capital allocation: ${allocation}`);
const collateralTargetUsd=walletUsd*allocation;
const collateralCapUsd=CONFIG.MAX_POSITION_NOTIONAL_USD/Math.max(leverage,1);
const collateralUsd=Math.min(collateralTargetUsd,collateralCapUsd,walletUsd*CONFIG.MAX_CAPITAL_ALLOCATION);
const riskBasedNotional=calculatePositionSize(walletUsd,signal.tradePlan.entry,signal.tradePlan.stopLoss);
if (!(riskBasedNotional>0)) throw new Error("Risk-based position sizing is invalid");
const allocationNotional=collateralUsd*leverage;
const notionalUsd=Math.min(allocationNotional,riskBasedNotional,CONFIG.MAX_POSITION_NOTIONAL_USD,capacityUsd>0?capacityUsd:Number.MAX_SAFE_INTEGER);
if (notionalUsd<CONFIG.MIN_POSITION_NOTIONAL_USD) throw new Error(`Calculated notional too small: ${notionalUsd}`);
const size=toBigIntDecimal(notionalUsd,30);
const collateralAmount=toBigIntDecimal(collateralUsd,6);
const tp=toBigIntDecimal(signal.tradePlan.tp1,30);
const sl=toBigIntDecimal(signal.tradePlan.stopLoss,30);
const lock = await acquireLiveExecutionLock(env, signal);
if (!lock.acquired) return {executed:false,mode:"LIVE",reason:lock.reason,executionKey:lock.key};

try {
const result=await sdk.executeExpressOrder({kind:"increase",symbol:sdkSymbol,direction,orderType:"market",size,collateralToken:collateral.symbol,collateralToPay:{amount:collateralAmount,token:collateral.symbol},mode:"express",from:account,tpsl:[{type:"take-profit",triggerPrice:tp,size},{type:"stop-loss",triggerPrice:sl,size}]},signer);
return {executed:true,mode:"LIVE",account,symbol:sdkSymbol,direction,leverage,allocation,allocationPercent:Number((allocation*100).toFixed(2)),walletUsd,collateralUsd,collateralToken:collateral.symbol,notionalUsd,riskBasedNotional,requestId:result?.requestId||null,status:result?.status||null,executionKey:lock.key};
} finally {
releaseLiveExecutionLock(lock.key);
}
}

async function monitorLivePositions(env) {
const { sdk, signer, account } = await getLiveContext(env);
const positions = await sdk.fetchPositionsInfo({
address: account,
includeRelatedOrders: true
});
const actions = [];
if (!Array.isArray(positions)) return actions;
Â 
const markets = await sdk.fetchMarkets();
Â 
for (const position of positions) {
try {
const rawIndex = String(position.indexName || "");
const symbol = liveNormalizeSymbol(rawIndex.split("/")[0]);
if (!symbol || !position.sizeInUsd) continue;
Â 
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
Â 
const entryPrice = Number(position.entryPrice || position.entryPriceUsd || position.averagePrice || 0);
const currentPrice = Number(snapshot.price || 0);
const isLong = Boolean(position.isLong);
const side = isLong ? "LONG" : "SHORT";
const hardStop = entryPrice > 0 && currentPrice > 0 && (
(isLong && Number(position.stopLossPrice || position.stopLoss || 0) > 0 && currentPrice <= Number(position.stopLossPrice || position.stopLoss)) ||
(!isLong && Number(position.stopLossPrice || position.stopLoss || 0) > 0 && currentPrice >= Number(position.stopLossPrice || position.stopLoss))
);
Â 
const radarLedger = await loadRadarLiveLedger(env);
const radarKey = radarLiveLedgerKey(symbol);
const radarMeta = radarLedger[radarKey]?.status === "OPEN" ? radarLedger[radarKey] : null;
const syntheticPosition = {
...position,
lane: radarMeta ? "RADAR" : "CORE",
side,
entryPrice,
score: radarMeta ? Number(radarMeta.radarScore || analysis.score) : analysis.score,
initialStopPrice: Number(position.stopLossPrice || position.stopLoss || radarMeta?.initialStopPrice || 0) || undefined
};
if (radarMeta) {
  const radarNow = v8PumpRadar(snapshot.market, previous?.market || null);
  const reversal = radarReversalDecision(syntheticPosition, radarNow, analysis);
  if (reversal.close) {
    const sizeUsd = Number(position.sizeInUsd);
    const size = BigInt(Math.floor(sizeUsd));
    const marketSdk = findSdkMarket(markets, symbol);
    if (marketSdk && size > 0n) {
      const positionCollateral = String(position?.collateralToken || position?.collateralSymbol || position?.receiveToken || "USDC").toUpperCase();
const exitCollateral = positionCollateral === "USDT" ? "USDT" : "USDC";
const result = await sdk.executeExpressOrder({kind:"decrease",symbol:marketSdk.symbol,direction:isLong?"long":"short",orderType:"market",size,collateralToken:exitCollateral,receiveToken:exitCollateral,mode:"express",from:account},signer);
      radarLedger[radarKey] = {...radarMeta,status:"CLOSED",closedAt:Date.now(),closeRequestId:result?.requestId || null,closeReason:reversal.reason};
      await saveRadarLiveLedger(env, radarLedger);
      const actionRecord = {symbol,direction:side,lane:"RADAR",action:"RADAR_REVERSAL_FULL",reason:reversal.reason,closePercent:100,pnlPercent:entryPrice>0&&currentPrice>0?(isLong?(currentPrice-entryPrice)/entryPrice:(entryPrice-currentPrice)/entryPrice)*100:0,radarScore:reversal.radarScore,radarDirection:reversal.radarDirection,requestId:result?.requestId||null};
      actions.push(actionRecord);
      await auditLog(env,{type:"LIVE_RADAR_REVERSAL_CLOSE",account,action:actionRecord});
      try { await sendTelegram(env, formatTelegramExit(actionRecord)); } catch (_) {}
      continue;
    }
  }
}
const plan = buildPositionExitPlan(syntheticPosition, market, hardStop);
Â 
// Preserve the original smart-money/reversal protection as a fallback signal,
// but let the unified exit manager decide the action.
const oppositeScore = isLong ? analysis.shortScore : analysis.longScore;
if (plan.execution === "HOLD" && oppositeScore < 65 && analysis.risk < 45) continue;
Â 
const action = plan.action;
if (!action || action === "HOLD") continue;
Â 
const marketSdk = findSdkMarket(markets, symbol);
if (!marketSdk) continue;
Â 
const sizeUsd = Number(position.sizeInUsd);
const closePercent = Math.max(0, Math.min(100, Number(plan.closePercent || 0)));
const closeSizeUsd = closePercent >= 100 ? sizeUsd : sizeUsd * closePercent / 100;
if (!(closeSizeUsd > 0)) continue;
Â 
const size = BigInt(Math.floor(closeSizeUsd));
const result = await sdk.executeExpressOrder({
kind: "decrease",
symbol: marketSdk.symbol,
direction: isLong ? "long" : "short",
orderType: "market",
size,
collateralToken: positionCollateral || "USDC",
receiveToken: positionCollateral || "USDC",
mode: "express",
from: account
}, signer);
Â 
const pnlPercent = entryPrice > 0 && currentPrice > 0
? (isLong ? (currentPrice - entryPrice) / entryPrice : (entryPrice - currentPrice) / entryPrice) * 100
: 0;
Â 
const actionRecord = {
symbol,
direction: side,
action,
reason: hardStop ? "HARD_STOP" : (plan.reasons?.structureBreak ? "STRUCTURE_BREAK" : plan.execution),
closePercent,
pnlPercent: Number(pnlPercent.toFixed(2)),
exitScore: plan.score,
components: plan.components,
requestId: result?.requestId || null
};
actions.push(actionRecord);
await auditLog(env, { type: "LIVE_UNIFIED_EXIT", account, action: actionRecord });
Â 
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
Â 
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
await auditLog(env,{type:"LIVE_EXECUTION",signalId:signal.id,result});
return {...result,signal};
} catch(error) {
await auditLog(env,{type:"LIVE_EXECUTION_ERROR",signalId:signal?.id,error:safeError(error)});
return {executed:false,mode:"LIVE",error:safeError(error),signal};
}
}
Â 
Â 
// ================================
// COMPLETE MARKET SCAN
// ================================
Â 
Â 
async function runLegacyFullScan(
env
){
Â 
Â 
Â 
if(
!BOT_STATE.running
){
Â 
Â 
return {
Â 
Â 
status:
"PAUSED"
Â 
Â 
};
Â 
}
Â 
Â 
Â 
Â 
Â 
const candidates=[];
Â 
Â 
Â 
for(
const symbol of WATCHLIST
){
Â 
Â 
Â 
const analysis =
Â 
analyzeMarket(symbol);
Â 
Â 
Â 
if(
analysis.status==="NO_DATA"
)
Â 
continue;
Â 
Â 
Â 
Â 
Â 
const data =
Â 
getMarketData(symbol);
Â 
Â 
Â 
const strategy =
Â 
legacyStrategyVote(data);
Â 
Â 
Â 
Â 
Â 
candidates.push({
Â 
symbol,
Â 
Â 
...strategy,
Â 
Â 
smartScore:
Â 
analysis.score
Â 
Â 
});
Â 
Â 
Â 
}
Â 
Â 
Â 
Â 
Â 
Â 
const ranked =
Â 
rankSignals(candidates);
Â 
Â 
Â 
Â 
Â 
BOT_STATE.lastScan =
Date.now();
Â 
Â 
BOT_STATE.signals =
ranked.slice(0,3);
Â 
Â 
Â 
Â 
Â 
Â 
if(
ranked.length
){
Â 
Â 
const best =
Â 
chooseBestSignal(ranked);
Â 
Â 
Â 
await executeSignal(
Â 
best,
Â 
env
Â 
);
Â 
Â 
Â 
return {
Â 
Â 
status:
"SCAN_COMPLETE",
Â 
Â 
best,
Â 
Â 
top3:
BOT_STATE.signals
Â 
Â 
};
Â 
Â 
}
Â 
Â 
Â 
Â 
Â 
return {
Â 
Â 
status:
"NO_SIGNAL"
Â 
Â 
};
Â 
Â 
}
Â 
Â 
Â 
Â 
Â 
Â 
Â 
Â 
// ======================================================
// GMX V2 MARKET DISCOVERY / READ-ONLY ADAPTER
// Uses the official GMX Oracle API for public market reads.
// No wallet, signing, private key or order submission.
// ======================================================
Â 
async function fetchWithTimeout(url, options = {}, timeoutMs = GMX_V2_CONFIG.REQUEST_TIMEOUT_MS){
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), timeoutMs);
Â 
try{
return await fetch(url, {
...options,
signal: controller.signal
});
}finally{
clearTimeout(timer);
}
}
Â 
function normalizeGmxMarket(market){
if(!market || typeof market !== "object"){
return null;
}
Â 
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
Â 
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
Â 
const text = await response.text();
Â 
if(!response.ok){
throw new Error(
`GMX markets HTTP ${response.status}: ${text.slice(0,300)}`
);
}
Â 
let data;
try{
data = JSON.parse(text);
}catch(error){
throw new Error("GMX markets returned invalid JSON");
}
Â 
const rawMarkets =
Array.isArray(data)
? data
: Array.isArray(data.markets)
? data.markets
: [];
Â 
return {
count: rawMarkets.length,
markets: rawMarkets
.map(normalizeGmxMarket)
.filter(Boolean)
};
}
Â 
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
Â 
const text = await response.text();
Â 
if(!response.ok){
throw new Error(
`GMX markets/info HTTP ${response.status}: ${text.slice(0,300)}`
);
}
Â 
let data;
try{
data = JSON.parse(text);
}catch(error){
throw new Error("GMX markets/info returned invalid JSON");
}
Â 
return data;
}
Â 
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
Â 
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
Â 
const rpcData = await rpcResponse.json();
const chainId =
rpcData.result
? parseInt(rpcData.result, 16)
: null;
Â 
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
Â 
if(infoOnly){
const info = await fetchGmxMarketsInfo();
Â 
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
Â 
const result = await fetchGmxMarkets();
Â 
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
Â 
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
Â 
// V14.0.5.1: Telegram has a strict per-invocation fetch budget.
// Keep a small deterministic allowance so notification fetches can never
// consume the remaining Cloudflare subrequest budget after market analysis.
// The WeakMap is keyed by the current Worker env object, so separate
// invocations do not share counters.
const TELEGRAM_BUDGETS = new WeakMap();
const TELEGRAM_MAX_SENDS_PER_INVOCATION = 4;

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
Â 
Â 
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
headers:{"content-type":"application/json"},
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
Â 
Â 
function handleCommand(
command
){
Â 
Â 
Â 
switch(command){
Â 
Â 
Â 
case "/pause":
Â 
Â 
BOT_STATE.running=false;
Â 
Â 
return "BOT PAUSED";
Â 
Â 
Â 
Â 
Â 
case "/resume":
Â 
Â 
BOT_STATE.running=true;
Â 
Â 
return "BOT RESUMED";
Â 
Â 
Â 
Â 
Â 
case "/status":
Â 
Â 
return JSON.stringify(
BOT_STATE
);
Â 
Â 
Â 
Â 
Â 
default:
Â 
Â 
return "UNKNOWN COMMAND";
Â 
Â 
}
Â 
Â 
Â 
}
Â 
Â 
Â 
Â 
Â 
Â 
Â 
// ================================
// EXTEND WORKER ROUTER
// ================================
Â 
Â 
async function apiRouter(
request,
env
){
Â 
Â 
Â 
const url =
Â 
new URL(request.url);
Â 
Â 
Â 
Â 
Â 
if(url.pathname === "/scan") {
return jsonResponse(await FUTURES_V6.scan(env));
}
Â 
Â 
Â 
Â 
Â 
if(
url.pathname === "/health"
){
Â 
Â 
return jsonResponse(
systemHealth(env)
);
Â 
Â 
}
Â 
Â 
Â 
Â 
Â 
Â 
if(
url.pathname === "/control"
){
Â 
Â 
Â 
const cmd =
Â 
url.searchParams.get(
"cmd"
);
Â 
Â 
Â 
return jsonResponse({
Â 
result:
Â 
handleCommand(cmd)
Â 
Â 
});
Â 
Â 
}
Â 
Â 
Â 
Â 
Â 
return null;
Â 
Â 
}
