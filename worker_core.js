import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { GmxApiSdk, PrivateKeySigner } = require("@gmx-io/sdk/v2");
const { getViemChain } = require("@gmx-io/sdk/configs/chains");

// ================================================================
// GMX SMART MONEY STRUCTURE ENGINE V17.0.0
// ================================================================
// Decision model: MARKET EVENT + STRUCTURE + FLOW, not weighted score.
//
// Core sequence:
//   1) Find meaningful support/resistance zones.
//   2) Observe what price does at the zone.
//   3) Measure volume/range expansion and GMX trade-flow response.
//   4) Classify: rejection, sweep/reclaim, breakout, waiting-retest,
//      retest-confirmed, exhausted or invalidated.
//   5) Enter only on a real structural trigger.
//   6) Top-trader intelligence is confirmation only. It NEVER blocks.
//   7) Risk/sizing/GMX market constraints remain hard safety gates.
// ================================================================

const CONFIG = {
  VERSION: "V17.0.1-SMART-MONEY-STRUCTURE-ENGINE",
  CHAIN_ID: 42161,
  EXECUTION_ENABLED: true,
  TELEGRAM_ENABLED: true,
  DATA_TIMEOUT_MS: 10000,
  MARKET_CACHE_TTL_MS: 15000,
  CANDLE_CACHE_TTL_MS: 15000,
  CANDLE_LIMIT: { "5m": 160, "15m": 160, "1h": 120, "4h": 120 },

  // Scanner: one full structural scan uses four candle requests per market.
  MAX_MARKETS: 30,
  DEEP_SCAN_LIMIT: 10,
  MAX_SCAN_SUBREQUESTS: 50,
  RESERVED_SCAN_SUBREQUESTS: 10,
  SCAN_BATCH_SIZE: 2,

  // --------------------------------------------------------------
  // STRUCTURE
  // --------------------------------------------------------------
  SR: {
    pivotLeft: 2,
    pivotRight: 2,
    zoneAtrWidth: 0.35,
    mergeAtrDistance: 0.55,
    minTouches: 2,
    maxZonesPerSide: 5,
    lookback5m: 100,
    lookback15m: 100,
    lookback1h: 80,
    lookback4h: 60,
    proximityAtr: 0.65,
    breakoutBufferAtr: 0.12,
    retestToleranceAtr: 0.45,
    rejectionWickRatio: 0.38,
    rejectionCloseRatio: 0.28,
    sweepDepthAtr: 0.20,
  },

  // --------------------------------------------------------------
  // FLOW / VOLUME
  // --------------------------------------------------------------
  FLOW: {
    lookbackMs: 5 * 60 * 1000,
    minNotionalUsd: 1000,
    spikeRatio: 1.80,
    explosiveRatio: 3.00,
    baselineSamples: 12,
    strongImbalance: 0.22,
    dominantImbalance: 0.45,
    largeTradeUsd: 100000,
  },
  VOLUME: {
    expansionStrong: 1.35,
    expansionExplosive: 2.00,
    rangeExpansionStrong: 1.35,
    rangeExpansionExplosive: 1.80,
  },

  // --------------------------------------------------------------
  // ENTRY EVENT RULES
  // --------------------------------------------------------------
  ENTRY: {
    maxDistanceFromLevelAtr: 0.70,
    maxChaseAtr: 0.90,
    minEvidence: 2,
    requireFlowOrVolume: true,
    requireCloseConfirmation: true,
    breakoutMinBodyRatio: 0.45,
    retestMinBodyRatio: 0.25,
    minBreakoutVolumeRatio: 1.20,
    minBreakoutFlowImbalance: 0.10,
    setupTtlMs: 45 * 60 * 1000,
    breakoutRetestTtlMs: 90 * 60 * 1000,
  },

  // --------------------------------------------------------------
  // TOP TRADER CONFIRMATION — NEVER A BLOCK
  // --------------------------------------------------------------
  TOP_TRADER: {
    enabled: true,
    lookbackMs: 60 * 60 * 1000,
    limit: 750,
    maxAccounts: 40,
    minTrades: 2,
    minNotionalUsd: 1000,
    confirmationRatio: 0.55,
  },

  // --------------------------------------------------------------
  // RISK / EXECUTION
  // --------------------------------------------------------------
  RISK: {
    riskPerTrade: 0.01,
    maxTotalRisk: 0.03,
    capitalAllocation: 0.05,
    maxCapitalAllocation: 0.15,
    defaultLeverage: 3,
    maxLeverage: 10,
    stopAtrBuffer: 0.25,
    minStopPercent: 0.35,
    maxStopPercent: 3.50,
    tp1R: 1.0,
    tp2R: 2.0,
    tp3R: 3.0,
    maxNotionalUsd: 5000,
    executionMinWalletRisk: 0.015,
    maxPositions: 3,
  },

  // --------------------------------------------------------------
  // RADAR: same structure engine, not a second score engine.
  // --------------------------------------------------------------
  RADAR: {
    enabled: true,
    watchEnabled: true,
    liveEnabled: true,
    maxLivePositions: 1,
    riskPerTrade: 0.005,
    capitalAllocation: 0.03,
    maxNotionalUsd: 2500,
    eventTtlMs: 6 * 60 * 60 * 1000,
  },

  TELEGRAM_MAX_SENDS_PER_INVOCATION: 8,
  TELEGRAM_EVENT_TTL_MS: 6 * 60 * 60 * 1000,

  DATA_CENTER: {
    enabled: true,
    timeoutMs: 5000,
    apiPeers: ["https://arbitrum.gmxapi.io/v1", "https://arbitrum.gmxapi.ai/v1"],
    oraclePeers: [
      "https://arbitrum-api.gmxinfra.io",
      "https://arbitrum-api-fallback.gmxinfra.io",
      "https://arbitrum-api-fallback.gmxinfra2.io"
    ],
    maxTradePages: 1,
    maxTradeRows: 750,
  },

  MAX_DAILY_LOSS: 0.10,
  WATCHLIST: ["BTC-PERP","ETH-PERP","SOL-PERP","ARB-PERP","AVAX-PERP","INJ-PERP","LINK-PERP","OP-PERP","APT-PERP","NEAR-PERP"]
};

const GMX = {
  ORACLE: CONFIG.DATA_CENTER.oraclePeers[0],
  FALLBACKS: CONFIG.DATA_CENTER.oraclePeers.slice(1),
  API_PEERS: CONFIG.DATA_CENTER.apiPeers,
};

const CACHE = new Map();
const INFLIGHT = new Map();
let LIVE_CONTEXT = null;
let SMART_MONEY_MARKET_MAP = Object.create(null);
let SMART_MONEY_CACHE = { at: 0, result: null };
let TOP_TRADER_CACHE = { at: 0, result: null };

const DEFAULT_STATE = {
  stateVersion: 2,
  running: true,
  dayKey: new Date().toISOString().slice(0, 10),
  dailyLoss: 0,
  executions: 0,
  errors: 0,
  lastScan: null,
  structureStates: {},
  flowHistory: {},
  telegramEvents: {},
  radarTelegramEvents: {},
  liveExecutionLocks: {},
  diagnostics: {},
  scanCursor: 0,
};

function safeError(error) { return error?.message || String(error || "Unknown error"); }
function finite(n, fallback = 0) { const x = Number(n); return Number.isFinite(x) ? x : fallback; }
function positive(n, fallback = 0) { const x = Number(n); return Number.isFinite(x) && x > 0 ? x : fallback; }
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, finite(n, lo))); }
function normalizeSymbol(symbol) {
  if (!symbol) return null;
  let s = String(symbol).trim().toUpperCase();
  s = s.replace(/[-_/]?(PERP|USD|USDC|USDT)$/i, "");
  s = s.replace(/[^A-Z0-9.]/g, "");
  return s || null;
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function executionEnabled(env) {
  const raw = env?.EXECUTION_ENABLED;
  if (raw === undefined || raw === null || String(raw).trim() === "") return CONFIG.EXECUTION_ENABLED;
  return !["false", "0", "no", "off"].includes(String(raw).trim().toLowerCase());
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

async function fetchTimeout(url, options = {}, timeout = CONFIG.DATA_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

async function fetchJson(url, options = {}, timeout = CONFIG.DATA_TIMEOUT_MS) {
  const response = await fetchTimeout(url, options, timeout);
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 250)}`);
  try { return JSON.parse(text); } catch { throw new Error("Invalid JSON response"); }
}

async function cached(key, loader, ttl = CONFIG.MARKET_CACHE_TTL_MS) {
  const now = Date.now();
  const hit = CACHE.get(key);
  if (hit && hit.expiresAt > now) return hit.value;
  if (INFLIGHT.has(key)) return await INFLIGHT.get(key);
  const promise = (async () => {
    const value = await loader();
    CACHE.set(key, { value, expiresAt: Date.now() + ttl });
    return value;
  })();
  INFLIGHT.set(key, promise);
  try { return await promise; } finally { INFLIGHT.delete(key); }
}

function rows(payload, keys = []) {
  if (Array.isArray(payload)) return payload;
  for (const key of keys) if (Array.isArray(payload?.[key])) return payload[key];
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.data?.rows)) return payload.data.rows;
  return [];
}

function scaledUsd(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.abs(n) >= 1e18 ? n / 1e30 : n;
}

function priceFromRow(row) {
  if (!row || typeof row !== "object") return 0;
  const vals = [row.price,row.markPrice,row.indexPrice,row.oraclePrice,row.medianPrice,row.currentPrice,row.indexPriceUsd];
  const nums = vals.map(scaledUsd).filter(x => x > 0);
  if (!nums.length) return 0;
  nums.sort((a,b) => a-b);
  const m = Math.floor(nums.length/2);
  return nums.length % 2 ? nums[m] : (nums[m-1] + nums[m])/2;
}

function marketArray(payload) { return rows(payload, ["markets", "results", "items"]); }

async function fetchMarketsInfo() {
  let last;
  for (const base of [GMX.ORACLE, ...GMX.FALLBACKS]) {
    try { return await fetchJson(`${base}/markets/info`, { headers: { accept: "application/json" } }); }
    catch (e) { last = e; }
  }
  throw last || new Error("GMX markets/info unavailable");
}

async function fetchMarketsCatalog() {
  let last;
  for (const base of [GMX.ORACLE, ...GMX.FALLBACKS]) {
    try { return await fetchJson(`${base}/markets`, { headers: { accept: "application/json" } }); }
    catch (e) { last = e; }
  }
  throw last || new Error("GMX markets unavailable");
}

function findMarket(markets, symbol) {
  const wanted = normalizeSymbol(symbol);
  return (markets || []).find(m => {
    const direct = [m?.symbol,m?.name,m?.ticker,m?.indexTokenSymbol,m?.indexToken?.symbol].filter(Boolean).map(normalizeSymbol);
    return direct.includes(wanted) || direct.some(x => x && x.startsWith(`${wanted}`));
  }) || null;
}

async function fetchCandles(symbol, timeframe, limit = CONFIG.CANDLE_LIMIT[timeframe]) {
  const normalized = normalizeSymbol(symbol);
  const key = `candles:${normalized}:${timeframe}:${limit}`;
  return await cached(key, async () => {
    let last;
    for (const base of [GMX.ORACLE, ...GMX.FALLBACKS]) {
      try {
        const data = await fetchJson(`${base}/prices/candles?tokenSymbol=${encodeURIComponent(normalized)}&period=${encodeURIComponent(timeframe)}&limit=${limit}`, { headers: { accept: "application/json" } });
        const c = normalizeCandles(data);
        if (c.length) return c;
      } catch (e) { last = e; }
    }
    throw last || new Error(`No candles for ${normalized} ${timeframe}`);
  }, CONFIG.CANDLE_CACHE_TTL_MS);
}

function normalizeCandles(payload) {
  const raw = rows(payload, ["candles", "ohlcv", "data"]);
  return raw.map(c => {
    if (Array.isArray(c)) return { timestamp: finite(c[0]), open: finite(c[1]), high: finite(c[2]), low: finite(c[3]), close: finite(c[4]), volume: finite(c[5]) };
    return { timestamp: finite(c?.timestamp), open: finite(c?.open), high: finite(c?.high), low: finite(c?.low), close: finite(c?.close), volume: finite(c?.volume ?? c?.vol ?? c?.volumeUsd ?? c?.volumeUSD) };
  }).filter(c => c.timestamp > 0 && c.high >= c.low && c.open > 0 && c.close > 0).sort((a,b) => a.timestamp-b.timestamp);
}

function sma(values, period) {
  if (!Array.isArray(values) || values.length < period || period <= 0) return null;
  const a = values.slice(-period); return a.reduce((x,y)=>x+y,0)/a.length;
}
function ema(values, period) {
  if (!Array.isArray(values) || values.length < period) return null;
  const k=2/(period+1); let e=sma(values.slice(0,period),period);
  for(let i=period;i<values.length;i++) e=values[i]*k+e*(1-k);
  return e;
}
function atr(candles, period=14) {
  if (!candles || candles.length < period+1) return null;
  const tr=[];
  for(let i=0;i<candles.length;i++) {
    const c=candles[i], prev=candles[i-1]?.close;
    tr.push(i===0?c.high-c.low:Math.max(c.high-c.low,Math.abs(c.high-prev),Math.abs(c.low-prev)));
  }
  return ema(tr,period);
}
function rsi(candles, period=14) {
  if (!candles || candles.length <= period) return null;
  let gain=0,loss=0;
  for(let i=1;i<=period;i++){const d=candles[i].close-candles[i-1].close;if(d>=0)gain+=d;else loss-=d;}
  let ag=gain/period, al=loss/period;
  for(let i=period+1;i<candles.length;i++){const d=candles[i].close-candles[i-1].close;ag=((ag*(period-1))+Math.max(d,0))/period;al=((al*(period-1))+Math.max(-d,0))/period;}
  if(al===0)return 100; const rs=ag/al; return 100-100/(1+rs);
}
function bodyRatio(c) { const range=Math.max(1e-12,c.high-c.low); return Math.abs(c.close-c.open)/range; }
function candleMetrics(c,p) {
  const range=Math.max(1e-12,c.high-c.low), body=Math.abs(c.close-c.open);
  const upper=(c.high-Math.max(c.open,c.close))/range;
  const lower=(Math.min(c.open,c.close)-c.low)/range;
  return { range, bodyRatio:body/range, upperWick:upper, lowerWick:lower, bullish:c.close>c.open, bearish:c.close<c.open, closeLocation:(c.close-c.low)/range, prev:p||null };
}
function percentMove(candles,bars){if(!candles||candles.length<=bars)return 0;const a=candles.at(-1)?.close,b=candles.at(-1-bars)?.close;return b?((a-b)/b)*100:0;}

// ================================================================
// SMART MONEY FLOW
// ================================================================
function smfNormSymbol(symbol){return normalizeSymbol(String(symbol||""));}
function smfMarketKey(value){const s=String(value||"").trim().toLowerCase();return /^0x[a-f0-9]{20,}$/.test(s)?s:"";}
function smfSetMarketMap(markets){
  const map=Object.create(null);
  for(const m of markets||[]){
    const sym=smfNormSymbol(m?.symbol??m?.name??m?.ticker??m?.indexTokenSymbol); if(!sym)continue;
    for(const k of [m?.marketToken,m?.marketAddress,m?.address,m?.market?.address,m?.market?.marketToken,m?.indexTokenAddress,m?.indexToken?.address]){
      const key=smfMarketKey(k);if(key)map[key]=sym;
    }
  }
  SMART_MONEY_MARKET_MAP=map; return map;
}
function tradeRows(payload){return rows(payload,["trades","results","items","rows"]).length?rows(payload,["trades","results","items","rows"]):rows(payload?.data,["trades","results","items","rows"]);}
function smfTradeSymbol(t){
  const direct=smfNormSymbol(t?.symbol??t?.marketSymbol??t?.indexTokenSymbol??t?.indexName??t?.indexToken?.symbol??t?.market?.symbol??t?.market?.name);
  if(direct)return direct;
  const key=smfMarketKey(t?.market?.address??t?.market?.marketToken??t?.marketAddress??t?.marketToken??t?.market);
  return key?SMART_MONEY_MARKET_MAP[key]||"":"";
}
function smfNotional(t){
  for(const v of [t?.sizeDeltaUsd,t?.sizeUsd,t?.notionalUsd,t?.notional,t?.executionSizeUsd,t?.positionSizeUsd,t?.sizeDelta?.usd,t?.size?.usd,t?.positionSize?.usd]){
    const n=scaledUsd(v);if(n>0)return Math.abs(n);
  }
  const price=scaledUsd(t?.executionPrice??t?.price??t?.markPrice??t?.indexPrice);
  const size=Math.abs(finite(t?.sizeDelta??t?.size??t?.quantity??t?.executionSize??t?.sizeDeltaInTokens));
  return price>0&&size>0?price*size:0;
}
function smfIncrease(t){
  if(typeof t?.isIncrease==="boolean")return t.isIncrease;
  const e=String(t?.eventName??t?.event??t?.action??t?.orderEvent??t?.orderType??t?.tradeType??"").toLowerCase();
  if(/increase|open|position_increase/.test(e))return true;if(/decrease|close|position_decrease/.test(e))return false;return null;
}
function smfDirection(t){
  if(typeof t?.isLong==="boolean")return t.isLong?"LONG":"SHORT";
  const d=String(t?.direction??t?.side??t?.positionSide??t?.marketDirection??t?.position?.side??"").toLowerCase();
  if(["long","buy","longs"].includes(d))return "LONG";if(["short","sell","shorts"].includes(d))return "SHORT";return null;
}
function smfSigned(t){
  const symbol=smfTradeSymbol(t),direction=smfDirection(t),increase=smfIncrease(t),notional=smfNotional(t);
  if(!symbol||!direction||notional<CONFIG.FLOW.minNotionalUsd)return null;
  let sign=direction==="LONG"?1:-1;if(increase===false)sign*=-1;
  return {symbol,direction,increase,notionalUsd:notional,signedUsd:notional*sign};
}
function median(a){const x=(a||[]).filter(Number.isFinite).sort((m,n)=>m-n);if(!x.length)return 0;const i=Math.floor(x.length/2);return x.length%2?x[i]:(x[i-1]+x[i])/2;}
function aggregateFlow(trades){
  const bySymbol={};let rejected=0;
  for(const t of trades||[]){const r=smfSigned(t);if(!r){rejected++;continue;}
    const x=bySymbol[r.symbol] ||= {buyUsd:0,sellUsd:0,longOpenUsd:0,shortOpenUsd:0,longCloseUsd:0,shortCloseUsd:0,totalUsd:0,tradeCount:0,largeTradeCount:0};
    x.totalUsd+=r.notionalUsd;x.tradeCount++;
    if(r.signedUsd>0)x.buyUsd+=r.notionalUsd;else x.sellUsd+=r.notionalUsd;
    if(r.direction==="LONG"&&r.increase===true)x.longOpenUsd+=r.notionalUsd;
    if(r.direction==="SHORT"&&r.increase===true)x.shortOpenUsd+=r.notionalUsd;
    if(r.direction==="LONG"&&r.increase===false)x.longCloseUsd+=r.notionalUsd;
    if(r.direction==="SHORT"&&r.increase===false)x.shortCloseUsd+=r.notionalUsd;
    if(r.notionalUsd>=CONFIG.FLOW.largeTradeUsd)x.largeTradeCount++;
  }
  return {bySymbol,rejected};
}
function flowMetrics(raw,history=[]){
  const buy=finite(raw?.buyUsd),sell=finite(raw?.sellUsd),total=buy+sell,signed=buy-sell;
  const imbalance=total>0?signed/total:0;
  const base=median((history||[]).map(x=>finite(x?.totalUsd)).filter(x=>x>0).slice(-CONFIG.FLOW.baselineSamples));
  const ratio=base>0?total/base:1;
  return {buyUsd:buy,sellUsd:sell,totalUsd:total,signedUsd:signed,imbalance,buyShare:total>0?buy/total:0,flowSpikeRatio:ratio,flowSurge:ratio>=CONFIG.FLOW.spikeRatio,explosiveFlow:ratio>=CONFIG.FLOW.explosiveRatio,tradeCount:finite(raw?.tradeCount),largeTradeCount:finite(raw?.largeTradeCount),longOpenUsd:finite(raw?.longOpenUsd),shortOpenUsd:finite(raw?.shortOpenUsd),longCloseUsd:finite(raw?.longCloseUsd),shortCloseUsd:finite(raw?.shortCloseUsd)};
}
function flowAligned(flow,direction){return direction==="LONG"?finite(flow?.imbalance):-finite(flow?.imbalance);}
function flowEvidence(flow,direction){
  const aligned=flowAligned(flow,direction), reasons=[];
  if(aligned>=CONFIG.FLOW.strongImbalance)reasons.push("FLOW_DIRECTIONAL");
  if(aligned>=CONFIG.FLOW.dominantImbalance)reasons.push("FLOW_DOMINANT");
  if(flow?.flowSurge)reasons.push("FLOW_SURGE");
  if(flow?.explosiveFlow)reasons.push("FLOW_EXPLOSIVE");
  if(finite(flow?.largeTradeCount)>=2)reasons.push("LARGE_TRADES");
  return reasons;
}
async function fetchTradesSearch(params={}){
  const errors=[];
  for(const base of GMX.API_PEERS){
    try{
      const data=await fetchJson(`${base}/trades/search?${new URLSearchParams(Object.entries(params).filter(([,v])=>v!==undefined&&v!==null).map(([k,v])=>[k,String(v)]))}`,{headers:{accept:"application/json"}},CONFIG.DATA_CENTER.timeoutMs);
      return {ok:true,trades:tradeRows(data),source:base,errors};
    }catch(e){errors.push(`${base}:${safeError(e)}`);}
  }
  return {ok:false,trades:[],source:null,errors};
}
async function fetchSmartMoneyFlow(state){
  const now=Date.now();
  if(SMART_MONEY_CACHE.result&&now-SMART_MONEY_CACHE.at<20000)return SMART_MONEY_CACHE.result;
  try{
    const result=await fetchTradesSearch({forAllAccounts:"true",fromTimestamp:Math.floor((now-CONFIG.FLOW.lookbackMs)/1000),limit:250,showDebugValues:"true"});
    let trades=result.trades;
    if(!trades.length){
      const sdk=new GmxApiSdk({chainId:CONFIG.CHAIN_ID});
      try{trades=tradeRows(await sdk.searchTrades({forAllAccounts:true,fromTimestamp:Math.floor((now-CONFIG.FLOW.lookbackMs)/1000),limit:250,showDebugValues:true}));}catch(_){ }
    }
    const agg=aggregateFlow(trades.slice(0,CONFIG.DATA_CENTER.maxTradeRows));const bySymbol={};
    for(const [sym,raw] of Object.entries(agg.bySymbol))bySymbol[sym]=flowMetrics(raw,state.flowHistory?.[sym]||[]);
    const out={available:true,source:result.source||"SDK_V2_SEARCH_TRADES",trades:trades.length,bySymbol,rejectedTrades:agg.rejected};
    SMART_MONEY_CACHE={at:now,result:out};return out;
  }catch(error){const out={available:false,source:null,trades:0,bySymbol:{},error:safeError(error)};SMART_MONEY_CACHE={at:now,result:out};return out;}
}
function persistFlowHistory(state,flowData){
  const next={...(state.flowHistory||{})},now=Date.now();
  for(const [sym,f] of Object.entries(flowData?.bySymbol||{})){
    const a=Array.isArray(next[sym])?next[sym].slice(-119):[];const last=a.at(-1);const sample={at:now,totalUsd:f.totalUsd,buyUsd:f.buyUsd,sellUsd:f.sellUsd,imbalance:f.imbalance};
    if(!last||now-last.at>=30000)a.push(sample);else a[a.length-1]=sample;next[sym]=a.slice(-120);
  }
  state.flowHistory=next;
}

// ================================================================
// TOP TRADER CONFIRMATION
// ================================================================
function traderAccount(t){return String(t?.account??t?.trader??t?.userAddress??t?.user??t?.owner??t?.address??t?.accountAddress??"").toLowerCase();}
function traderPnl(t){for(const v of [t?.realizedPnlUsd,t?.realizedPnl,t?.pnlUsd,t?.pnl,t?.profitUsd,t?.profit]){const n=scaledUsd(v);if(Number.isFinite(n)&&n!==0)return n;}return null;}
function traderTs(t){const n=finite(t?.timestamp??t?.createdAt??t?.updatedAt??t?.blockTimestamp);return n>1e12?n:n*1000;}
function buildTraderCohort(trades){
  const accounts=new Map();
  for(const t of trades||[]){const account=traderAccount(t),symbol=smfTradeSymbol(t),dir=smfDirection(t),notional=smfNotional(t);if(!account||!symbol||!dir||notional<CONFIG.TOP_TRADER.minNotionalUsd)continue;
    const a=accounts.get(account)||{account,trades:0,notional:0,pnlKnown:0,pnlSum:0,wins:0,bySymbol:{},lastTs:0};a.trades++;a.notional+=notional;
    const p=traderPnl(t);if(p!==null){a.pnlKnown++;a.pnlSum+=p;if(p>0)a.wins++;}
    a.lastTs=Math.max(a.lastTs,traderTs(t));const x=a.bySymbol[symbol] ||= {longUsd:0,shortUsd:0,trades:0};x.trades++;if(dir==="LONG")x.longUsd+=notional;else x.shortUsd+=notional;accounts.set(account,a);
  }
  return [...accounts.values()].filter(a=>a.trades>=CONFIG.TOP_TRADER.minTrades).map(a=>{const pnlQ=a.pnlKnown?clamp(0.6+0.4*(a.wins/a.pnlKnown),0,1):0.5;const sizeQ=clamp(Math.log10(Math.max(1,a.notional))/7,0,1);a.quality=100*(0.55*pnlQ+0.45*sizeQ);return a;}).sort((a,b)=>b.quality-a.quality).slice(0,CONFIG.TOP_TRADER.maxAccounts);
}
function topTraderConfirm(cohort,symbol,direction){
  if(!Array.isArray(cohort)||!cohort.length)return {available:false,confirmed:false,alignment:0,conflict:0,accounts:0,notionalUsd:0};
  let aligned=0,opposed=0,accounts=0;
  for(const a of cohort){const x=a.bySymbol?.[symbol];if(!x)continue;accounts++;const q=clamp(a.quality/100,0,1);if(direction==="LONG"){aligned+=x.longUsd*q;opposed+=x.shortUsd*q;}else{aligned+=x.shortUsd*q;opposed+=x.longUsd*q;}}
  const total=aligned+opposed,alignment=total>0?aligned/total:0,conflict=total>0?opposed/total:0;
  return {available:accounts>0,confirmed:alignment>=CONFIG.TOP_TRADER.confirmationRatio,alignment,conflict,accounts,notionalUsd:total};
}
async function fetchTopTraders(){
  const now=Date.now();if(TOP_TRADER_CACHE.result&&now-TOP_TRADER_CACHE.at<60000)return TOP_TRADER_CACHE.result;
  try{const r=await fetchTradesSearch({forAllAccounts:"true",fromTimestamp:Math.floor((now-CONFIG.TOP_TRADER.lookbackMs)/1000),limit:CONFIG.TOP_TRADER.limit,showDebugValues:"true"});let trades=r.trades;
    if(!trades.length){try{const sdk=new GmxApiSdk({chainId:CONFIG.CHAIN_ID});trades=tradeRows(await sdk.searchTrades({forAllAccounts:true,fromTimestamp:Math.floor((now-CONFIG.TOP_TRADER.lookbackMs)/1000),limit:CONFIG.TOP_TRADER.limit,showDebugValues:true}));}catch(_){}}
    const cohort=buildTraderCohort(trades);const out={available:cohort.length>0,accounts:cohort.length,trades:trades.length,cohort,mode:"CONFIRMATION_ONLY_NO_BLOCK"};TOP_TRADER_CACHE={at:now,result:out};return out;
  }catch(error){const out={available:false,accounts:0,trades:0,cohort:[],mode:"CONFIRMATION_ONLY_NO_BLOCK",error:safeError(error)};TOP_TRADER_CACHE={at:now,result:out};return out;}
}

// ================================================================
// SUPPORT / RESISTANCE ZONE ENGINE
// ================================================================
function isPivotHigh(candles,i,left,right){if(i<left||i+right>=candles.length)return false;const h=candles[i].high;for(let j=i-left;j<=i+right;j++)if(j!==i&&candles[j].high>=h)return false;return true;}
function isPivotLow(candles,i,left,right){if(i<left||i+right>=candles.length)return false;const l=candles[i].low;for(let j=i-left;j<=i+right;j++)if(j!==i&&candles[j].low<=l)return false;return true;}
function collectPivots(candles,type,lookback){
  const a=(candles||[]).slice(-lookback),out=[];for(let i=CONFIG.SR.pivotLeft;i<a.length-CONFIG.SR.pivotRight;i++){
    if(type==="R"&&isPivotHigh(a,i,CONFIG.SR.pivotLeft,CONFIG.SR.pivotRight))out.push({price:a[i].high,at:a[i].timestamp});
    if(type==="S"&&isPivotLow(a,i,CONFIG.SR.pivotLeft,CONFIG.SR.pivotRight))out.push({price:a[i].low,at:a[i].timestamp});
  }return out;
}
function buildZones(candlesByTf,currentPrice,currentAtr){
  const atrValue=positive(currentAtr)||currentPrice*0.005;const all={S:[],R:[]};
  const weights={"5m":1,"15m":1.4,"1h":1.8,"4h":2.1};
  for(const [tf,c] of Object.entries(candlesByTf||{})){
    const look=CONFIG.SR[`lookback${tf}`]||80;for(const type of ["S","R"])for(const p of collectPivots(c,type,look))all[type].push({...p,tf,weight:weights[tf]||1});
  }
  const out={support:[],resistance:[]};
  for(const type of ["S","R"]){const sorted=all[type].sort((a,b)=>b.at-a.at),zones=[];
    for(const p of sorted){let z=zones.find(x=>Math.abs(x.center-p.price)<=atrValue*CONFIG.SR.mergeAtrDistance);if(!z){z={center:p.price,low:p.price-atrValue*CONFIG.SR.zoneAtrWidth,high:p.price+atrValue*CONFIG.SR.zoneAtrWidth,touches:0,weight:0,timeframes:new Set(),lastAt:p.at};zones.push(z);}z.touches++;z.weight+=p.weight;z.timeframes.add(p.tf);z.center=(z.center*(z.touches-1)+p.price)/z.touches;z.low=Math.min(z.low,p.price-atrValue*CONFIG.SR.zoneAtrWidth);z.high=Math.max(z.high,p.price+atrValue*CONFIG.SR.zoneAtrWidth);z.lastAt=Math.max(z.lastAt,p.at);}
    const usable=zones.filter(z=>z.touches>=CONFIG.SR.minTouches||z.timeframes.size>=2).map(z=>({...z,timeframes:[...z.timeframes],distanceAtr:Math.abs(currentPrice-z.center)/atrValue,below:currentPrice>z.high,above:currentPrice<z.low})).sort((a,b)=>a.distanceAtr-b.distanceAtr).slice(0,CONFIG.SR.maxZonesPerSide);
    if(type==="S")out.support=usable;else out.resistance=usable;
  }
  return out;
}
function nearestZone(zones,price,maxAtr,atrValue,side){return (zones||[]).filter(z=>z.distanceAtr<=maxAtr&&(side==="S"?price>=z.low:price<=z.high)).sort((a,b)=>a.distanceAtr-b.distanceAtr)[0]||null;}

// ================================================================
// VOLUME / RANGE EVENT ENGINE
// ================================================================
function volumeContext(candles){
  const a=(candles||[]).slice(-40),vol=a.map(c=>c.volume).filter(v=>v>0),ranges=a.map(c=>c.high-c.low).filter(v=>v>0);
  const recentVol=sma(vol,5),baseVol=sma(vol.slice(0,-5),Math.min(20,Math.max(1,vol.length-5)));
  const recentRange=sma(ranges,5),baseRange=sma(ranges.slice(0,-5),Math.min(20,Math.max(1,ranges.length-5)));
  const volumeAvailable=vol.length>=15&&baseVol>0,volumeRatio=volumeAvailable?recentVol/baseVol:1;
  const rangeRatio=baseRange>0?recentRange/baseRange:1;
  return {volumeAvailable,volumeRatio,rangeRatio,volumeSurge:volumeRatio>=CONFIG.VOLUME.expansionStrong,volumeExplosive:volumeRatio>=CONFIG.VOLUME.expansionExplosive,volumeDrying:volumeAvailable&&volumeRatio<=0.65,rangeExpansion:rangeRatio>=CONFIG.VOLUME.rangeExpansionStrong,rangeExplosive:rangeRatio>=CONFIG.VOLUME.rangeExpansionExplosive,rangeDrying:rangeRatio<=0.75};
}

// ================================================================
// MARKET EVENT CLASSIFIER
// ================================================================
function reactionAtSupport(c,level,flow,vol,atrValue){
  const m=candleMetrics(c),depth=level.low-c.low,inside=c.close>=level.low,wick=m.lowerWick>=CONFIG.SR.rejectionWickRatio,closeBack=m.closeLocation>=CONFIG.SR.rejectionCloseRatio;
  const sweep=depth>=atrValue*CONFIG.SR.sweepDepthAtr&&inside;
  const evidence=[];if(wick)evidence.push("LOWER_WICK_REJECTION");if(closeBack)evidence.push("CLOSE_BACK_ABOVE_SUPPORT");if(sweep)evidence.push("LIQUIDITY_SWEEP_RECLAIM");
  const flowAlignedValue=flowAligned(flow,"LONG");if(flowAlignedValue>=CONFIG.FLOW.strongImbalance)evidence.push("BUY_FLOW");if(vol.volumeSurge||vol.rangeExpansion)evidence.push("ACTIVITY_EXPANSION");if(vol.volumeDrying||vol.rangeDrying)evidence.push("ACTIVITY_DRYING");
  const confirmed=inside&&m.bullish&&(wick||sweep)&&evidence.length>=CONFIG.ENTRY.minEvidence&&(!CONFIG.ENTRY.requireFlowOrVolume||flowAlignedValue>=0.08||vol.volumeSurge||vol.rangeExpansion);
  return {confirmed,evidence,sweep,wick,flowAligned:flowAlignedValue};
}
function reactionAtResistance(c,level,flow,vol,atrValue){
  const m=candleMetrics(c),depth=c.high-level.high,inside=c.close<=level.high,wick=m.upperWick>=CONFIG.SR.rejectionWickRatio,closeBack=(1-m.closeLocation)>=CONFIG.SR.rejectionCloseRatio;
  const sweep=depth>=atrValue*CONFIG.SR.sweepDepthAtr&&inside;
  const evidence=[];if(wick)evidence.push("UPPER_WICK_REJECTION");if(closeBack)evidence.push("CLOSE_BACK_BELOW_RESISTANCE");if(sweep)evidence.push("LIQUIDITY_SWEEP_RECLAIM");
  const flowAlignedValue=flowAligned(flow,"SHORT");if(flowAlignedValue>=CONFIG.FLOW.strongImbalance)evidence.push("SELL_FLOW");if(vol.volumeSurge||vol.rangeExpansion)evidence.push("ACTIVITY_EXPANSION");if(vol.volumeDrying||vol.rangeDrying)evidence.push("ACTIVITY_DRYING");
  const confirmed=inside&&m.bearish&&(wick||sweep)&&evidence.length>=CONFIG.ENTRY.minEvidence&&(!CONFIG.ENTRY.requireFlowOrVolume||flowAlignedValue>=0.08||vol.volumeSurge||vol.rangeExpansion);
  return {confirmed,evidence,sweep,wick,flowAligned:flowAlignedValue};
}
function breakoutState(c,level,direction,flow,vol,atrValue){
  const m=candleMetrics(c);const buffer=atrValue*CONFIG.SR.breakoutBufferAtr;
  const above=c.close>level.high+buffer,below=c.close<level.low-buffer;
  const aligned=flowAligned(flow,direction);
  const volumeOk=vol.volumeAvailable?vol.volumeRatio>=CONFIG.ENTRY.minBreakoutVolumeRatio:vol.rangeRatio>=1.15;
  const flowOk=aligned>=CONFIG.ENTRY.minBreakoutFlowImbalance;
  const bodyOk=m.bodyRatio>=CONFIG.ENTRY.breakoutMinBodyRatio;
  const broken=direction==="LONG"?above&&m.bullish:below&&m.bearish;
  return {broken:broken&&bodyOk&&(volumeOk||flowOk),above,below,bodyOk,volumeOk,flowOk,aligned};
}
function retestState(c,level,direction,flow,vol,atrValue){
  const tol=atrValue*CONFIG.SR.retestToleranceAtr,m=candleMetrics(c);
  const touched=direction==="LONG"?c.low<=level.high+tol&&c.low>=level.low-tol:c.high>=level.low-tol&&c.high<=level.high+tol;
  const holds=direction==="LONG"?c.close>level.high:c.close<level.low;
  const rejection=direction==="LONG"?(m.bullish&&m.lowerWick>=0.20):(m.bearish&&m.upperWick>=0.20);
  const aligned=flowAligned(flow,direction);
  const activity=vol.volumeSurge||vol.rangeExpansion||aligned>=0.08;
  return {touched,holds,rejection,activity,aligned,confirmed:touched&&holds&&rejection&&activity&&m.bodyRatio>=CONFIG.ENTRY.retestMinBodyRatio};
}

function stateKey(symbol,side,levelId){return `${normalizeSymbol(symbol)}|${side}|${levelId}`;}
function zoneId(z){return `${z.center.toFixed(6)}:${z.low.toFixed(6)}:${z.high.toFixed(6)}`;}

function classifyStructure(symbol,candles,price,flow,previousState={}){
  const c5=candles["5m"]||[],c15=candles["15m"]||[],c1h=candles["1h"]||[],c4h=candles["4h"]||[];
  const current=c5.at(-1),previous=c5.at(-2);if(!current)return {state:"NO_DATA",direction:"NONE",entries:[],zones:{support:[],resistance:[]}};
  const atr5=positive(atr(c5,14))||price*0.005;
  const zones=buildZones({"5m":c5,"15m":c15,"1h":c1h,"4h":c4h},price,atr5);
  const vol=volumeContext(c5);const entries=[];const watched=[];
  const preMove5=percentMove(c5.slice(0,-1),5);
  const preMove15=percentMove(c15.slice(0,-1),5);
  const support=nearestZone(zones.support,price,CONFIG.SR.proximityAtr,atr5,"S");
  const resistance=nearestZone(zones.resistance,price,CONFIG.SR.proximityAtr,atr5,"R");
  const supportForBreak=(zones.support||[]).filter(z=>Math.abs(price-z.center)/atr5<=1.25).sort((a,b)=>Math.abs(price-a.center)-Math.abs(price-b.center))[0]||support;
  const resistanceForBreak=(zones.resistance||[]).filter(z=>Math.abs(price-z.center)/atr5<=1.25).sort((a,b)=>Math.abs(price-a.center)-Math.abs(price-b.center))[0]||resistance;

  if(support||supportForBreak){
    if(support){
      const bounce=reactionAtSupport(current,support,flow,vol,atr5);watched.push({type:"SUPPORT",zone:support,bounce});
      if(bounce.confirmed&&preMove5<=-0.35){entries.push({direction:"LONG",trigger:"SUPPORT_BOUNCE",zone:support,evidence:["PRIOR_DOWN_MOVE",...bounce.evidence],atr:atr5,price,volume:vol,flow});}
    }
    const br=breakoutState(current,supportForBreak,"SHORT",flow,vol,atr5);
    if(br.broken){entries.push({direction:"WAIT",trigger:"SUPPORT_BREAK_WAIT_RETEST",zone:support,evidence:["SUPPORT_BROKEN",...br.volumeOk?["ACTIVITY_CONFIRMATION"]:[],...br.flowOk?["FLOW_CONFIRMATION"]:[]],breakoutAt:current.timestamp,atr:atr5,price,flow,volume:vol});}
  }
  if(resistance||resistanceForBreak){
    if(resistance){
      const rejection=reactionAtResistance(current,resistance,flow,vol,atr5);watched.push({type:"RESISTANCE",zone:resistance,rejection});
      if(rejection.confirmed&&preMove5>=0.35){entries.push({direction:"SHORT",trigger:"RESISTANCE_REJECTION",zone:resistance,evidence:["PRIOR_UP_MOVE",...rejection.evidence],atr:atr5,price,volume:vol,flow});}
    }
    const br=breakoutState(current,resistanceForBreak,"LONG",flow,vol,atr5);
    if(br.broken){entries.push({direction:"WAIT",trigger:"RESISTANCE_BREAK_WAIT_RETEST",zone:resistance,evidence:["RESISTANCE_BROKEN",...br.volumeOk?["ACTIVITY_CONFIRMATION"]:[],...br.flowOk?["FLOW_CONFIRMATION"]:[]],breakoutAt:current.timestamp,atr:atr5,price,flow,volume:vol});}
  }

  // Persist/consume a breakout -> retest state. The state machine deliberately
  // requires a second candle interaction; a raw breakout never becomes entry.
  const prior=previousState||{};const next={...prior,updatedAt:Date.now()};
  if(entries.some(x=>x.trigger.includes("WAIT_RETEST"))){
    const e=entries.find(x=>x.trigger.includes("WAIT_RETEST"));next.pendingRetest={direction:e.trigger.startsWith("SUPPORT")?"SHORT":"LONG",zone:e.zone,zoneId:zoneId(e.zone),createdAt:Date.now(),breakoutAt:e.breakoutAt,atr:atr5};
  }
  const p=next.pendingRetest;
  if(p&&Date.now()-finite(p.createdAt)>CONFIG.ENTRY.breakoutRetestTtlMs){delete next.pendingRetest;}
  if(p){
    const freshCandle=finite(current.timestamp)>finite(p.breakoutAt);
    const zone=p.zone;
    const rt=freshCandle?retestState(current,zone,p.direction,flow,vol,atr5):{confirmed:false,touched:false,holds:false,rejection:false,activity:false,aligned:flowAligned(flow,p.direction)};
    watched.push({type:"RETEST",zone,direction:p.direction,retest:rt,freshCandle});
    if(freshCandle&&rt.confirmed){
      entries.push({direction:p.direction,trigger:p.direction==="LONG"?"RESISTANCE_BREAK_RETEST_LONG":"SUPPORT_BREAK_RETEST_SHORT",zone,evidence:["BREAKOUT_RETEST","RETEST_HOLD",...(rt.activity?["ACTIVITY"]:[]),...(rt.aligned>=0.08?["FLOW_CONFIRMATION"]:[])],atr:atr5,price,volume:vol,flow});
      delete next.pendingRetest;
    }
  }

  // Anti-chase: if price is far from every relevant level and no retest/reaction
  // happened now, the engine stays WAIT instead of chasing the impulse.
  const nearLevel=Boolean(support||resistance||p);
  const move5=Math.abs(percentMove(c5,5));
  const extension=atr5>0?Math.abs(price-current.open)/atr5:0;
  if(!entries.length&&move5>=1.5&&extension>=CONFIG.ENTRY.maxChaseAtr&&!nearLevel)next.lastState="EXHAUSTED_NO_CHASE";
  else if(!entries.length)next.lastState=nearLevel?"WATCH_LEVEL":"NO_SETUP";

  const eventFlags={
    supportZone:Boolean(support||supportForBreak),
    resistanceZone:Boolean(resistance||resistanceForBreak),
    supportReaction:watched.some(x=>x.type==="SUPPORT"&&x.bounce?.confirmed),
    resistanceReaction:watched.some(x=>x.type==="RESISTANCE"&&x.rejection?.confirmed),
    breakout:entries.some(x=>x.trigger.includes("WAIT_RETEST")),
    waitingRetest:Boolean(next.pendingRetest),
    retestConfirmed:entries.some(x=>x.trigger.includes("RETEST")),
    exhausted:next.lastState==="EXHAUSTED_NO_CHASE"
  };
  return {state:entries.length?entries.some(e=>e.direction!=="WAIT")?"ENTRY_READY":"WAITING_RETEST":next.lastState,direction:entries.find(e=>e.direction!=="WAIT")?.direction||entries.find(e=>e.direction==="WAIT")?.direction||"NONE",entries,zones,watched,volume:vol,atr:atr5,nextState:next,move5,preMove5,preMove15,extension,eventFlags};
}

// ================================================================
// EVENT-BASED SETUP BUILDER
// ================================================================
function buildSetup(symbol,analysis,flow,topTrader){
  const entry=analysis.entries?.find(e=>e.direction==="LONG"||e.direction==="SHORT");
  if(!entry)return null;
  const direction=entry.direction,zone=entry.zone,atrValue=analysis.atr,price=finite(analysis.price);
  const top=topTraderConfirm(topTrader?.cohort,symbol,direction);
  const flowReasons=flowEvidence(flow,direction);
  const candle=analysis.candles?.["5m"]?.at(-1);
  const stopBase=direction==="LONG"?zone.low:zone.high;
  const stopDistance=Math.max(Math.abs(price-stopBase),atrValue*CONFIG.RISK.stopAtrBuffer);
  const stop=direction==="LONG"?stopBase-atrValue*CONFIG.RISK.stopAtrBuffer:stopBase+atrValue*CONFIG.RISK.stopAtrBuffer;
  const r=stopDistance;
  const tp1=direction==="LONG"?price+r*CONFIG.RISK.tp1R:price-r*CONFIG.RISK.tp1R;
  const tp2=direction==="LONG"?price+r*CONFIG.RISK.tp2R:price-r*CONFIG.RISK.tp2R;
  const tp3=direction==="LONG"?price+r*CONFIG.RISK.tp3R:price-r*CONFIG.RISK.tp3R;
  const evidence=[...(entry.evidence||[]),...flowReasons];
  const unique=[...new Set(evidence)];
  return {
    valid:true,symbol,direction,trigger:entry.trigger,state:"ENTRY_READY",price,entryPrice:price,
    stopLoss:Number(stop.toFixed(8)),tp1:Number(tp1.toFixed(8)),tp2:Number(tp2.toFixed(8)),tp3:Number(tp3.toFixed(8)),
    riskDistance:r,atr:atrValue,zone,zoneType:entry.trigger.includes("SUPPORT")?"SUPPORT":"RESISTANCE",
    evidence:unique,flow,topTrader:top,topTraderPolicy:"CONFIRMATION_ONLY_NO_BLOCK",
    volume:analysis.volume,createdAt:Date.now(),candleTimestamp:finite(candle?.timestamp),
  };
}

// ================================================================
// STATE
// ================================================================
async function loadState(env){
  if(!env?.BOT_STATE)return {...DEFAULT_STATE};
  const data=await env.BOT_STATE.get("engine_state","json");
  const base={...DEFAULT_STATE,...(data||{})};
  if(finite(data?.stateVersion,0)!==DEFAULT_STATE.stateVersion){
    base.stateVersion=DEFAULT_STATE.stateVersion;
    base.structureStates={};
    base.scanCursor=0;
  }
  return {...base,scanCursor:finite(base.scanCursor,0),structureStates:base.structureStates&&typeof base.structureStates==="object"?base.structureStates:{},flowHistory:base.flowHistory&&typeof base.flowHistory==="object"?base.flowHistory:{},telegramEvents:base.telegramEvents&&typeof base.telegramEvents==="object"?base.telegramEvents:{},radarTelegramEvents:base.radarTelegramEvents&&typeof base.radarTelegramEvents==="object"?base.radarTelegramEvents:{},liveExecutionLocks:base.liveExecutionLocks&&typeof base.liveExecutionLocks==="object"?base.liveExecutionLocks:{}};
}
async function saveState(env,state){if(env?.BOT_STATE)await env.BOT_STATE.put("engine_state",JSON.stringify(state));}
function resetDailyLoss(state){const d=new Date().toISOString().slice(0,10);if(state.dayKey!==d){state.dayKey=d;state.dailyLoss=0;}}

// ================================================================
// TELEGRAM — event priority, with budget reserved for entries/radar.
// ================================================================
function tgBudget(env){if(!env.__tgBudget)env.__tgBudget={remaining:CONFIG.TELEGRAM_MAX_SENDS_PER_INVOCATION,attempted:0};return env.__tgBudget;}
async function sendTelegram(env,message,priority="normal"){
  if(!CONFIG.TELEGRAM_ENABLED||!env?.TELEGRAM_TOKEN||!env?.TELEGRAM_CHAT_ID)return {ok:false,reason:"TELEGRAM_CONFIG_MISSING"};
  const b=tgBudget(env);
  // Entry/live messages always get priority while the cycle still has budget.
  if(b.remaining<=0){console.warn("[TELEGRAM][BUDGET_SKIP]",{priority});return {ok:false,reason:"TELEGRAM_BUDGET"};}
  b.remaining--;b.attempted++;
  try{const r=await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({chat_id:env.TELEGRAM_CHAT_ID,text:String(message||"")})});const body=await r.text();if(!r.ok)throw new Error(`HTTP_${r.status}:${body.slice(0,300)}`);return {ok:true};}
  catch(e){console.error("[TELEGRAM][ERROR]",safeError(e));return {ok:false,reason:safeError(e)};}
}
function eventKey(prefix,setup){return `${prefix}|${normalizeSymbol(setup?.symbol)}|${setup?.direction}|${setup?.trigger}|${finite(setup?.candleTimestamp)}`;}
function eventFresh(state,key){const at=finite(state.telegramEvents?.[key]);return at>0&&Date.now()-at<CONFIG.TELEGRAM_EVENT_TTL_MS;}
function markEvent(state,key){state.telegramEvents[key]=Date.now();const keys=Object.keys(state.telegramEvents);if(keys.length>1000)for(const k of keys.slice(0,keys.length-100))delete state.telegramEvents[k];}
function formatSetupTelegram(setup){
  const icon=setup.direction==="LONG"?"🟢":"🔴";
  return [
    `${icon} GMX STRUCTURE ENTRY — ${setup.direction}`,
    "━━━━━━━━━━━━━━━━━━",
    `📌 ${setup.symbol}/USD`,
    `🧭 Trigger: ${setup.trigger}`,
    `📍 Entry: ${setup.entryPrice.toFixed(8)}`,
    `🛑 SL: ${setup.stopLoss.toFixed(8)}`,
    `🎯 TP1: ${setup.tp1.toFixed(8)}`,
    `🎯 TP2: ${setup.tp2.toFixed(8)}`,
    `🎯 TP3: ${setup.tp3.toFixed(8)}`,
    `📐 Zone: ${setup.zoneType} ${setup.zone.low.toFixed(6)} — ${setup.zone.high.toFixed(6)}`,
    `💧 Flow: ${finite(setup.flow?.imbalance).toFixed(3)} | surge=${Boolean(setup.flow?.flowSurge)}`,
    `📊 Activity: vol=${finite(setup.volume?.volumeRatio).toFixed(2)}x range=${finite(setup.volume?.rangeRatio).toFixed(2)}x`,
    `🐋 Top Traders: ${setup.topTrader?.confirmed?"CONFIRMED":"NOT CONFIRMED"} (${(finite(setup.topTrader?.alignment)*100).toFixed(0)}%)`,
    `🔎 Evidence: ${(setup.evidence||[]).slice(0,8).join(" • ")}`,
    "ℹ️ Top-trader data confirms only; it never blocks an entry."
  ].join("\n");
}
function formatWaitingTelegram(symbol,analysis){
  const p=analysis.entries?.find(e=>e.direction==="WAIT");if(!p)return null;
  return [`⏳ GMX STRUCTURE — WAIT RETEST`,`━━━━━━━━━━━━━━━━━━`,`📌 ${symbol}/USD`,`🔻 ${p.trigger}`,`📍 Level: ${p.zone.low.toFixed(6)} — ${p.zone.high.toFixed(6)}`,`🧭 Next: ${p.direction==="LONG"?"retest above resistance → LONG":"retest below support → SHORT"}`,`📊 Evidence: ${(p.evidence||[]).join(" • ")}`].join("\n");
}
function formatRadarTelegram(symbol,analysis){
  if(!analysis||analysis.state==="NO_SETUP"||analysis.state==="NO_DATA")return null;
  const vol=analysis.volume||{};const flow=analysis.flow||{};
  if(!(vol.volumeSurge||vol.rangeExpansion||vol.volumeDrying||vol.rangeDrying||flow.flowSurge||Math.abs(finite(analysis.move5))>=1.5))return null;
  const dir=analysis.direction==="NONE"?"WATCH":analysis.direction;const icon=dir==="LONG"?"🟢":dir==="SHORT"?"🔴":"🟡";
  return [`${icon} GMX STRUCTURE RADAR — ${dir}`,"━━━━━━━━━━━━━━━━━━",`📌 ${symbol}/USD`,`🧭 State: ${analysis.state}`,`⚡ 5m Move: ${finite(analysis.move5).toFixed(2)}%`,`📊 Volume: ${finite(vol.volumeRatio).toFixed(2)}x | Range: ${finite(vol.rangeRatio).toFixed(2)}x`,`💧 Flow: ${finite(flow.imbalance).toFixed(3)} | Surge=${Boolean(flow.flowSurge)}`,`📍 Support: ${analysis.zones?.support?.[0]?`${analysis.zones.support[0].low.toFixed(5)}-${analysis.zones.support[0].high.toFixed(5)}`:"N/A"}`,`📍 Resistance: ${analysis.zones?.resistance?.[0]?`${analysis.zones.resistance[0].low.toFixed(5)}-${analysis.zones.resistance[0].high.toFixed(5)}`:"N/A"}`].join("\n");
}

// ================================================================
// LIVE GMX EXECUTION
// ================================================================
function validatePrivateKey(key){if(!/^0x[0-9a-fA-F]{64}$/.test(String(key||"")))throw new Error("GMX_PRIVATE_KEY is missing or invalid");}
async function getLiveContext(env){
  if(!executionEnabled(env))throw new Error("Execution disabled");validatePrivateKey(env.GMX_PRIVATE_KEY);if(!env.ARBITRUM_RPC)throw new Error("ARBITRUM_RPC is required");
  if(LIVE_CONTEXT&&LIVE_CONTEXT.rpc===env.ARBITRUM_RPC)return LIVE_CONTEXT;
  const signer=new PrivateKeySigner(env.GMX_PRIVATE_KEY,{rpcUrl:env.ARBITRUM_RPC,chain:getViemChain(CONFIG.CHAIN_ID)});const sdk=new GmxApiSdk({chainId:CONFIG.CHAIN_ID});
  LIVE_CONTEXT={sdk,signer,account:signer.address,rpc:env.ARBITRUM_RPC};return LIVE_CONTEXT;
}
function toBigIntDecimal(value,decimals){const n=Number(value);if(!Number.isFinite(n))throw new Error("Invalid decimal value");const s=n.toFixed(Math.min(decimals,8));const [w,f=""]=s.split(".");return BigInt(w)*10n**BigInt(decimals)+BigInt((f+"0".repeat(decimals)).slice(0,decimals)||"0");}
function sdkMarket(markets,symbol,collateral){const wanted=normalizeSymbol(symbol);const matches=(markets||[]).filter(m=>!m?.isSpotOnly&&normalizeSymbol(String(m?.symbol||m?.name||"").split("/")[0])===wanted);if(!collateral)return matches[0]||null;const c=String(collateral).toUpperCase();return matches.find(m=>JSON.stringify(m).toUpperCase().includes(c))||matches[0]||null;}
function balancesMap(balances){const arr=Array.isArray(balances)?balances:Array.isArray(balances?.balances)?balances.balances:Object.values(balances||{}),out={};for(const b of arr){let s=String(b?.tokenSymbol??b?.symbol??b?.token?.symbol??"").toUpperCase();if(s==="USDC.E")s="USDC";if(!["USDC","USDT"].includes(s))continue;let usd=finite(b?.balanceUsd??b?.balanceUSD??b?.usdValue);const raw=finite(b?.balance??b?.amount);if(!(usd>0)&&raw>0)usd=raw/10**finite(b?.decimals,6);if(usd>0)out[s]={usd,balance:raw,decimals:finite(b?.decimals,6)};}return out;}
function chooseCollateral(markets,symbol,balances){const map=balancesMap(balances);for(const c of ["USDC","USDT"]){if(map[c]?.usd>0&&sdkMarket(markets,symbol,c))return {...map[c],symbol:c,market:sdkMarket(markets,symbol,c)};}return null;}
function riskNotional(wallet,entry,stop,risk){const frac=Math.abs(entry-stop)/Math.max(entry,1e-12);return frac>0?(wallet*risk)/frac:0;}
async function verifyPosition(sdk,account,symbol,direction,attempts=3){for(let i=0;i<attempts;i++){try{const p=await sdk.fetchPositionsInfo({address:account});const want=normalizeSymbol(symbol),long=direction==="LONG";const found=(p||[]).find(x=>normalizeSymbol(String(x?.indexName||x?.symbol||"").split("/")[0])===want&&Boolean(x?.isLong)===long&&finite(x?.sizeInUsd)>0);if(found)return {verified:true,position:found};}catch(_){ }if(i<attempts-1)await sleep(500);}return {verified:false,position:null};}
async function executeSetup(setup,env){
  if(!executionEnabled(env))return {executed:false,reason:"EXECUTION_DISABLED",setup};
  const {sdk,signer,account}=await getLiveContext(env);const positions=await sdk.fetchPositionsInfo({address:account});if(Array.isArray(positions)&&positions.length>=CONFIG.RISK.maxPositions) return {executed:false,reason:"MAX_POSITIONS",setup};
  const markets=await sdk.fetchMarkets();const balances=await sdk.fetchWalletBalances({address:account});const collateral=chooseCollateral(markets,setup.symbol,balances);if(!collateral)throw new Error("NO_USDC_USDT_COLLATERAL_MARKET");
  const market=collateral.market,sdkSymbol=market.symbol,orderDirection=setup.direction==="LONG"?"long":"short";const capacity=await sdk.getTradingCapacity({symbol:sdkSymbol,direction:orderDirection});const capacityUsd=scaledUsd(capacity?.availableLiquidity||0);const walletUsd=collateral.usd;
  const leverage=CONFIG.RISK.defaultLeverage,allocation=CONFIG.RISK.capitalAllocation;const entry=setup.entryPrice,stop=setup.stopLoss;const rb=riskNotional(walletUsd,entry,stop,CONFIG.RISK.riskPerTrade);const allocationNotional=walletUsd*allocation*leverage;let notional=Math.min(rb,allocationNotional,CONFIG.RISK.maxNotionalUsd,capacityUsd>0?capacityUsd:Number.MAX_SAFE_INTEGER);
  const frac=Math.abs(entry-stop)/Math.max(entry,1e-12),riskCap=riskNotional(walletUsd,entry,stop,CONFIG.RISK.executionMinWalletRisk);notional=Math.min(notional,riskCap);if(!(notional>0))throw new Error("INVALID_RISK_NOTIONAL");
  const minPos=scaledUsd(market?.minPositionSizeUsd||0),minCol=scaledUsd(market?.minCollateralUsd||0);const collateralUsd=notional/leverage;if(minPos>0&&notional<minPos)throw new Error(`MARKET_MIN_POSITION_BLOCKED:${minPos}`);if(minCol>0&&collateralUsd<minCol)throw new Error(`MARKET_MIN_COLLATERAL_BLOCKED:${minCol}`);
  const size=toBigIntDecimal(notional,30),collateralAmount=toBigIntDecimal(collateralUsd,6),tp=toBigIntDecimal(setup.tp1,30),sl=toBigIntDecimal(setup.stopLoss,30);
  const lockKey=`LIVE|${normalizeSymbol(setup.symbol)}|${setup.direction}|${setup.trigger}|${setup.candleTimestamp}`;const stateLocks=env.BOT_STATE?await env.BOT_STATE.get("live_locks","json"):{};if(stateLocks?.[lockKey])return {executed:false,reason:"DUPLICATE_EXECUTION",setup};const locks={...(stateLocks||{}),[lockKey]:Date.now()};if(env.BOT_STATE)await env.BOT_STATE.put("live_locks",JSON.stringify(locks),{expirationTtl:86400});
  try{
    const result=await sdk.executeExpressOrder({kind:"increase",symbol:sdkSymbol,direction:orderDirection,orderType:"market",size,collateralToken:collateral.symbol,collateralToPay:{amount:collateralAmount,token:collateral.symbol},mode:"express",from:account,tpsl:[{type:"take-profit",triggerPrice:tp,size},{type:"stop-loss",triggerPrice:sl,size}]},signer);
    const verification=await verifyPosition(sdk,account,sdkSymbol,setup.direction,3);
    return {executed:true,orderSubmitted:true,positionVerified:verification.verified,requestId:result?.requestId||null,status:result?.status||null,account,symbol:sdkSymbol,direction:setup.direction,notionalUsd:notional,collateralUsd,collateralToken:collateral.symbol,leverage,setup};
  }finally{}
}

// ================================================================
// SCAN
// ================================================================
async function scan(env,options={}){
  const state=await loadState(env);resetDailyLoss(state);if(!state.running)return {ok:true,status:"PAUSED"};
  const started=Date.now(),errors=[];
  const eventStats={supportZones:0,resistanceZones:0,flowEvents:0,volumeEvents:0,supportReactions:0,resistanceReactions:0,breakouts:0,waitingRetests:0,retestConfirmed:0,exhausted:0,entryReady:0};
  let info,catalog;try{info=marketArray(await fetchMarketsInfo());}catch(e){return {ok:false,status:"DATA_ERROR",error:safeError(e)};}
  try{catalog=marketArray(await fetchMarketsCatalog());}catch(e){catalog=[];errors.push({scope:"markets",error:safeError(e)});
  }
  const unique=new Map();for(const m of [...info,...catalog]){const s=normalizeSymbol(m?.symbol??m?.name??m?.ticker??m?.indexTokenSymbol);if(s)unique.set(s,{...(unique.get(s)||{}),...m,symbol:s});}
  const markets=[...unique.values()].filter(m=>m.isListed!==false&&m.isActive!==false);smfSetMarketMap(markets);
  const flowData=await fetchSmartMoneyFlow(state);persistFlowHistory(state,flowData);const traders=await fetchTopTraders();
  const candidates=[];
  // Prioritize abnormal flow, but always rotate through the broader market universe
  // so a structural setup is not invisible merely because its current flow sample
  // is quiet. This is coverage logic, never an entry score.
  const ranked=markets.map(m=>{const s=normalizeSymbol(m.symbol);const f=flowData.bySymbol?.[s];const px=priceFromRow(m);return {m,s,f,px,priority:(f?.explosiveFlow?4:f?.flowSurge?3:0)+(Math.abs(finite(f?.imbalance))>=CONFIG.FLOW.strongImbalance?2:0)+(px>0?1:0)};}).sort((a,b)=>b.priority-a.priority);
  const limit=Math.min(CONFIG.DEEP_SCAN_LIMIT,Math.max(1,Math.floor((CONFIG.MAX_SCAN_SUBREQUESTS-CONFIG.RESERVED_SCAN_SUBREQUESTS)/4)));
  const hot=ranked.filter(x=>x.priority>=3).slice(0,Math.min(5,limit));
  const cursor=Math.abs(finite(state.scanCursor))%Math.max(1,ranked.length);
  const rotation=[];for(let i=0;i<ranked.length&&rotation.length<limit;i++){const r=ranked[(cursor+i)%ranked.length];if(!hot.includes(r))rotation.push(r);}
  const scanRows=[...hot,...rotation].slice(0,limit);state.scanCursor=(cursor+scanRows.length)%Math.max(1,ranked.length);
  for(const row of scanRows){
    try{
      const [c5,c15,c1h,c4h]=await Promise.all([fetchCandles(row.s,"5m"),fetchCandles(row.s,"15m"),fetchCandles(row.s,"1h"),fetchCandles(row.s,"4h")]);
      const price=positive(priceFromRow(row.m))||positive(c5.at(-1)?.close);if(!(price>0))continue;
      const flow=row.f||{imbalance:0,totalUsd:0};const previousState=state.structureStates?.[row.s]||{};
      const analysis=classifyStructure(row.s,{"5m":c5,"15m":c15,"1h":c1h,"4h":c4h},price,flow,previousState);analysis.candles={"5m":c5,"15m":c15,"1h":c1h,"4h":c4h};analysis.flow=flow;analysis.price=price;
      state.structureStates[row.s]=analysis.nextState||previousState;
      const ef=analysis.eventFlags||{};
      eventStats.supportZones+=ef.supportZone?1:0;
      eventStats.resistanceZones+=ef.resistanceZone?1:0;
      eventStats.flowEvents+=(flow.flowSurge||flow.explosiveFlow)?1:0;
      eventStats.volumeEvents+=(analysis.volume?.volumeSurge||analysis.volume?.rangeExpansion||analysis.volume?.volumeExplosive||analysis.volume?.rangeExplosive)?1:0;
      eventStats.supportReactions+=ef.supportReaction?1:0;
      eventStats.resistanceReactions+=ef.resistanceReaction?1:0;
      eventStats.breakouts+=ef.breakout?1:0;
      eventStats.waitingRetests+=ef.waitingRetest?1:0;
      eventStats.retestConfirmed+=ef.retestConfirmed?1:0;
      eventStats.exhausted+=ef.exhausted?1:0;
      const setup=buildSetup(row.s,analysis,flow,traders);if(setup){candidates.push(setup);eventStats.entryReady++;}
      const wait=formatWaitingTelegram(row.s,analysis);if(wait&&!eventFresh(state,`WAIT|${row.s}|${analysis.state}`)){await sendTelegram(env,wait,"normal");markEvent(state,`WAIT|${row.s}|${analysis.state}`);}
      if(CONFIG.RADAR.enabled){const radar=formatRadarTelegram(row.s,analysis);if(radar&&!eventFresh(state,`RADAR|${row.s}|${analysis.state}|${analysis.direction}`)){await sendTelegram(env,radar,"radar");state.radarTelegramEvents[`RADAR|${row.s}|${analysis.state}|${analysis.direction}`]=Date.now();}}
      console.log("[TRACE][MARKET]",{symbol:row.s,state:analysis.state,direction:analysis.direction,move5:analysis.move5,preMove5:analysis.preMove5,preMove15:analysis.preMove15,extension:analysis.extension,flow:flow.imbalance,flowSurge:Boolean(flow.flowSurge||flow.explosiveFlow),volume:analysis.volume?.volumeRatio,range:analysis.volume?.rangeRatio,support:analysis.zones?.support?.[0]?.center||null,resistance:analysis.zones?.resistance?.[0]?.center||null,supportDistanceAtr:analysis.zones?.support?.[0]?.distanceAtr??null,resistanceDistanceAtr:analysis.zones?.resistance?.[0]?.distanceAtr??null,pendingRetest:Boolean(analysis.nextState?.pendingRetest),entries:(analysis.entries||[]).map(e=>({direction:e.direction,trigger:e.trigger,evidence:e.evidence||[]})),watched:(analysis.watched||[]).map(w=>({type:w.type,confirmed:Boolean(w.bounce?.confirmed||w.rejection?.confirmed||w.retest?.confirmed),evidence:w.bounce?.evidence||w.rejection?.evidence||[],retest:w.retest?{touched:w.retest.touched,holds:w.retest.holds,rejection:w.retest.rejection,activity:w.retest.activity,confirmed:w.retest.confirmed}:undefined})),events:analysis.eventFlags||{}});
    }catch(e){errors.push({symbol:row.s,error:safeError(e)});}
  }
  // Only one Core live entry per cycle; a structural trigger must exist.
  candidates.sort((a,b)=>{const at=(a.topTrader?.confirmed?1:0)+(a.flow?.flowSurge?1:0);const bt=(b.topTrader?.confirmed?1:0)+(b.flow?.flowSurge?1:0);return bt-at;});
  const executionResults=[];let executed=0;
  for(const setup of candidates.slice(0,CONFIG.RISK.maxPositions)){
    const key=eventKey("ENTRY",setup);if(eventFresh(state,key))continue;
    try{
      const result=await executeSetup(setup,env);executionResults.push(result);
      if(result.executed){executed++;state.executions++;markEvent(state,key);await sendTelegram(env,[result.positionVerified?"✅ GMX POSITION VERIFIED":"⚠️ GMX ORDER SUBMITTED — VERIFICATION PENDING","━━━━━━━━━━━━━━━━━━",`${setup.symbol}/USD ${setup.direction}`,`Trigger: ${setup.trigger}`,`Entry: ${setup.entryPrice}`,`SL: ${setup.stopLoss}`,`TP1: ${setup.tp1}`,`Request: ${result.requestId||"n/a"}`,`Position verified: ${result.positionVerified?"YES":"NO"}`].join("\n"),"entry");break;}
    }catch(e){executionResults.push({executed:false,symbol:setup.symbol,error:safeError(e)});}
  }
  state.lastScan={at:Date.now(),durationMs:Date.now()-started,candidates:candidates.length,executed};state.diagnostics={version:CONFIG.VERSION,structureModel:"EVENT_SEQUENCE_NO_SCORE",markets:markets.length,deepScanned:scanRows.length,entries:candidates.length,executed,flowAvailable:flowData.available,topTraderAvailable:traders.available,eventStats,telegram:{remaining:tgBudget(env).remaining,attempted:tgBudget(env).attempted},statePersistence:Boolean(env?.BOT_STATE),errors};await saveState(env,state);
  return {ok:true,status:candidates.length?"ENTRY_READY":"WATCHING",scanned:scanRows.length,requested:markets.length,entries:candidates,executionResults,executed,diagnostics:state.diagnostics,timestamp:Date.now()};
}

// ================================================================
// LIVE POSITION MONITOR — safety only. It does not manufacture entries.
// ================================================================
async function monitorLivePositions(env){
  if(!executionEnabled(env))return [];
  const {sdk,account}=await getLiveContext(env);const positions=await sdk.fetchPositionsInfo({address:account});if(!Array.isArray(positions)||!positions.length)return [];
  const markets=await sdk.fetchMarkets();const actions=[];
  for(const p of positions){try{
    const symbol=normalizeSymbol(String(p?.indexName||p?.symbol||"").split("/")[0]);if(!symbol||!(finite(p?.sizeInUsd)>0))continue;
    const c5=await fetchCandles(symbol,"5m",80);const price=positive(c5.at(-1)?.close);if(!(price>0))continue;const entry=positive(p?.entryPrice||p?.entryPriceUsd||p?.averagePrice);const side=p?.isLong?"LONG":"SHORT";const stop=positive(p?.stopLossPrice||p?.stopLoss);const hardStop=stop>0&&(side==="LONG"?price<=stop:price>=stop);
    const pnlPct=entry>0?(side==="LONG"?(price-entry)/entry:(entry-price)/entry)*100:0;
    if(hardStop){const market=sdkMarket(markets,symbol);if(market){const collateral=String(p?.collateralToken||p?.collateralSymbol||"USDC").toUpperCase()==="USDT"?"USDT":"USDC";const size=BigInt(Math.floor(finite(p?.sizeInUsd)));try{const r=await sdk.executeExpressOrder({kind:"decrease",symbol:market.symbol,direction:side==="LONG"?"long":"short",orderType:"market",size,collateralToken:collateral,receiveToken:collateral,mode:"express",from:account},LIVE_CONTEXT.signer);actions.push({symbol,direction:side,action:"HARD_STOP",pnlPct,requestId:r?.requestId||null});}catch(e){actions.push({symbol,direction:side,action:"HARD_STOP_ERROR",error:safeError(e)});}}}
  }catch(e){actions.push({symbol: p?.indexName||"UNKNOWN",action:"MONITOR_ERROR",error:safeError(e)});}}
  return actions;
}

// ================================================================
// ROUTER / SCHEDULED
// ================================================================
async function scheduled(event,env,ctx){
  console.log("[SCHEDULED][START]",{cron:event?.cron||"unknown",scheduledTime:event?.scheduledTime||null,version:CONFIG.VERSION,executionEnabled:executionEnabled(env)});
  try{
    const exits=executionEnabled(env)?await monitorLivePositions(env):[];
    const result=await scan(env,{source:"scheduled"});
    console.log("[SCHEDULED][DONE]",{status:result.status,scanned:result.scanned,entries:result.entries?.length||0,executed:result.executed||0,executionResults:(result.executionResults||[]).map(x=>({symbol:x?.symbol||x?.setup?.symbol||null,executed:Boolean(x?.executed),positionVerified:Boolean(x?.positionVerified),reason:x?.reason||null,error:x?.error||null})),exits});
    if(result.diagnostics){console.log("[TRACE][SUMMARY]",result.diagnostics);}
    return result;
  }catch(error){console.error("[SCHEDULED][ERROR]",{error:safeError(error),stack:error?.stack||null});return {ok:false,status:"ERROR",error:safeError(error)};}
}

export default {
  scheduled,
  async fetch(request,env,ctx){
    try{const url=new URL(request.url);if(url.pathname==="/status")return jsonResponse({bot:"GMX Smart Money Structure Engine",version:CONFIG.VERSION,execution:executionEnabled(env),network:"ARBITRUM",status:"ONLINE",time:Date.now()});if(url.pathname==="/scan")return jsonResponse(await scan(env,{source:"http"}));if(url.pathname==="/debug")return jsonResponse({config:CONFIG,state:await loadState(env)});return jsonResponse({ok:true,version:CONFIG.VERSION});}catch(e){return jsonResponse({ok:false,error:safeError(e)},500);}
  },
  scan,
  monitorLivePositions,
  CONFIG
};
