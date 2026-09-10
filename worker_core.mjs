/*
 GMX SMART MONEY FUTURES AI BOT — CLEAN CORE
 V18.2.1-SMART-MONEY-TELEGRAM-DIAGNOSTICS

 Purpose:
 - Preserve the Hybrid structure/event signal core.
 - Preserve Telegram signal/execution/cycle reporting.
 - Remove legacy duplicate engines, radar exit engine, paper engine, old API routes,
   resource counters, stale compatibility wrappers and SDK transport experiments.
 - Use one clean LIVE execution path: prepareOrder -> signOrder -> direct GMX submit
   with GMX BigInt JSON serialization.
*/

import { createRequire } from "node:module";
import crypto from "node:crypto";
const require = createRequire(import.meta.url);

export const BOT_VERSION = "V18.2.1-SMART-MONEY-TELEGRAM-DIAGNOSTICS";
export const BOT_BUILD = "V18.2.1";

let GmxApiSdk = null;
let PrivateKeySigner = null;
let getViemChain = null;
let serializeBigIntsInObject = null;

function loadSdk() {
  if (GmxApiSdk && PrivateKeySigner && getViemChain && serializeBigIntsInObject) return true;
  try {
    const sdk = require("@gmx-io/sdk/v2");
    const chains = require("@gmx-io/sdk/configs/chains");
    const numbers = require("@gmx-io/sdk/utils/numbers");
    GmxApiSdk = sdk?.GmxApiSdk || null;
    PrivateKeySigner = sdk?.PrivateKeySigner || null;
    getViemChain = chains?.getViemChain || null;
    serializeBigIntsInObject = numbers?.serializeBigIntsInObject || null;
    const ok = Boolean(GmxApiSdk && PrivateKeySigner && getViemChain && serializeBigIntsInObject);
    console.log("[SDK][LOAD]", { ok, exports: { GmxApiSdk:!!GmxApiSdk, PrivateKeySigner:!!PrivateKeySigner, getViemChain:!!getViemChain, serializeBigIntsInObject:!!serializeBigIntsInObject } });
    return ok;
  } catch (e) {
    console.error("[SDK][LOAD_ERROR]", safeError(e));
    return false;
  }
}

function safeError(e) { return e?.message || String(e || "Unknown error"); }
function jsonSafe(value) { return JSON.stringify(value, (_k,v) => typeof v === "bigint" ? v.toString() : v); }
function num(v, fallback=0) { const n=Number(v); return Number.isFinite(n) ? n : fallback; }
function hybridNormalizeSymbol(symbol) {
  if (symbol == null) return "";
  let s=String(symbol).trim().toUpperCase();
  s=s.replace(/[-_\/.]?(PERP|USD|USDC|USDT)$/i, "");
  return s.replace(/[^A-Z0-9]/g, "");
}
function normalizeSymbol(symbol) {
  if (symbol == null) return "";
  let s=String(symbol).trim().toUpperCase();
  s=s.replace(/[-_\/.]?(PERP|USD|USDC|USDT)$/i, "");
  return s.replace(/[^A-Z0-9]/g, "");
}
function pairSymbol(symbol) { return `${normalizeSymbol(symbol)}-PERP`; }
function executionEnabled(env) {
  const raw=env?.EXECUTION_ENABLED;
  if (raw === undefined || raw === null || raw === "") return true;
  return ["1","true","yes","on"].includes(String(raw).trim().toLowerCase());
}
function telegramTextSafe(v, fallback="N/A") {
  let s=v==null||v===""?fallback:String(v);
  return s.replace(/[\r\n]+/g," ").trim();
}

const CONFIG = {
  CHAIN_ID: 42161,
  API: "https://arbitrum.gmxapi.io/v1",
  API_PEERS: ["https://arbitrum.gmxapi.io/v1","https://arbitrum.gmxapi.ai/v1"],
  ORACLE: "https://arbitrum-api.gmxinfra.io",
  ORACLE_PEERS: ["https://arbitrum-api.gmxinfra.io","https://arbitrum-api-fallback.gmxinfra.io","https://arbitrum-api-fallback.gmxinfra2.io"],
  CANDLE_LIMIT: 120,
  BROAD_LIMIT: 1000,
  DEEP_LIMIT: 24,
  BROAD_5M_BATCH: 12,
  OPTIONAL_15M: true,
  ALT_CORRELATION_CAP: null,
  CORRELATION_GATE_ENABLED: false,
  MAX_POSITIONS: 3,
  MAX_CAPITAL_ALLOCATION: 0.20,
  MAX_TOTAL_CAPITAL_ALLOCATION: 0.60,
  EXECUTION_MIN_WALLET_RISK: 0.015,
  MAX_POSITION_NOTIONAL_USD: 5000,
  RISK_PER_TRADE: 0.01,
  DEFAULT_LEVERAGE: 5,
  MAX_LEVERAGE: 10,
  TELEGRAM_ENABLED: true,
  TELEGRAM_DEDUPE_TTL_MS: 6*60*60*1000,
  HYBRID_SR: {
    pivotLeft:2,pivotRight:2,lookback5m:120,lookback15m:96,
    mergeAtrDistance:0.35,zoneAtrWidth:0.14,minTouches:1,maxZonesPerSide:10,proximityAtr:1.35,
    rejectionWickRatio:0.30,rejectionCloseRatio:0.60,sweepDepthAtr:0.15,breakoutBufferAtr:0.10,retestToleranceAtr:0.22
  },
  HYBRID_VOLUME: { expansionStrong:1.25, expansionExplosive:1.90, rangeExpansionStrong:1.20, rangeExpansionExplosive:1.60 },
  SMART_MONEY: { enabled:true, lookbackMs:5*60*1000, limit:300, largeNotionalUsd:5000, whaleNotionalUsd:25000, concentrationCap:0.55, minDirectionalImbalance:0.08, suspiciousRepeatCount:2 },
  FAST_INDICATORS: { emaFast:9, emaSlow:21, rsiPeriod:14, macdFast:12, macdSlow:26, macdSignal:9, rocBars:3 },
  HYBRID_ENTRY: {
    minEvidence:1,requireFlowOrVolume:false,minReactionVolumeRatio:1.05,minReactionFlowImbalance:0.06,
    minBreakoutVolumeRatio:1.05,minBreakoutFlowImbalance:0.06,breakoutMinBodyRatio:0.45,retestMinBodyRatio:0.25,
    breakoutRetestTtlMs:35*60*1000,maxChaseAtr:2.40,priorMovePct:0.12,minZoneQuality:1,maxEntryDistanceAtr:1.20,
    maxRetestDistanceAtr:0.70,tierFastAllocation:0.45,tierNormalAllocation:0.75,tierPrimeAllocation:1.00,allowNeutralActivity:true,
    earlyEnabled:true,earlyMinMovePct:0.10,earlyMinBodyRatio:0.30,earlyMinVolumeRatio:1.20,earlyMinFlowImbalance:0.06,
    earlyMinAccelerationPct:0.03,earlyMaxEntryDistanceAtr:1.45,earlyPrebreakToleranceAtr:0.55,earlyMaxExtensionAtr:1.40,
    earlyMinScore:58,earlyMinEdge:4,earlyMinElapsedMs:15000
  },
  HYBRID_RISK: { capitalAllocation:0.20,minLeverage:3,defaultLeverage:5,maxLeverage:10,stopAtrBuffer:0.25,tp1R:1,tp2R:2,tp3R:3 }
};

const stateCache={hybrid:{},events:{}};

async function fetchText(url, options={}, timeoutMs=10000) {
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try { return await fetch(url,{...options,signal:controller.signal}); } finally { clearTimeout(timer); }
}
async function fetchJson(url, options={}) {
  const r=await fetchText(url,options);
  const text=await r.text();
  if(!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0,240)}`);
  return text ? JSON.parse(text) : null;
}
async function peerJson(peers,path,params={}) {
  const errors=[];
  for(const base of peers){
    try { const u=new URL(`${base.replace(/\/$/,"")}${path}`); for(const [k,v] of Object.entries(params)){if(v!==undefined&&v!==null&&v!=="")u.searchParams.set(k,String(v));} return {data:await fetchJson(u.toString(),{headers:{accept:"application/json"}}),source:u.toString()}; }
    catch(e){ errors.push(safeError(e)); }
  }
  throw new Error(errors.join(" | ")||"All peers failed");
}
function rows(payload){ if(Array.isArray(payload))return payload; for(const k of ["markets","data","rows","result"]){if(Array.isArray(payload?.[k]))return payload[k];} return []; }
function marketSymbol(m){
  for(const x of [m?.indexTokenSymbol,m?.indexName,m?.indexToken?.symbol,m?.indexToken?.tokenSymbol,m?.symbol,m?.name]){
    const s=normalizeSymbol(x); if(s&&s.length<=15)return s;
  }
  return "";
}
function marketPrice(m){
  const vals=[m?.price,m?.markPrice,m?.indexPrice,m?.oraclePrice,m?.medianPrice,m?.maxPrice,m?.minPrice,m?.price?.usd,m?.price?.value];
  for(const v of vals){const n=num(v);if(n>0){if(n>=1e18)return n/1e30;return n;}}
  return 0;
}
function normalizeCandles(payload){
  const raw=Array.isArray(payload)?payload:(payload?.candles||payload?.data||payload?.ohlcv||[]);
  return raw.map(c=>Array.isArray(c)?{timestamp:num(c[0]),open:num(c[1]),high:num(c[2]),low:num(c[3]),close:num(c[4]),volume:num(c[5])}:{timestamp:num(c?.timestamp),open:num(c?.open),high:num(c?.high),low:num(c?.low),close:num(c?.close),volume:num(c?.volume??c?.vol??c?.volumeUsd)}).filter(c=>c.timestamp>0&&[c.open,c.high,c.low,c.close].every(Number.isFinite)).sort((a,b)=>a.timestamp-b.timestamp);
}
async function fetchMarkets(sdk){
  try{
    if(sdk?.fetchMarkets){
      const data=await sdk.fetchMarkets();
      if(Array.isArray(data)&&data.length){
        console.log("[MARKETS][SDK_CATALOG]",{count:data.length});
        return data.filter(m=>m?.isSpotOnly!==true&&m?.isListed!==false&&m?.isActive!==false);
      }
    }
  }catch(e){console.warn("[MARKETS][SDK_CATALOG_FAIL]",safeError(e));}
  try{
    const r=await peerJson(CONFIG.API_PEERS,"/markets");
    const data=rows(r.data).filter(m=>m?.isSpotOnly!==true&&m?.isListed!==false&&m?.isActive!==false);
    console.log("[MARKETS][HTTP_CATALOG_FALLBACK]",{count:data.length});
    return data;
  }catch(e){
    console.error("[MARKETS][DISCOVERY_FAIL]",safeError(e));
    return [];
  }
}
function tickerSymbol(t){return normalizeSymbol(t?.indexName||t?.indexTokenSymbol||t?.symbol||t?.name||t?.marketSymbol||"");}
function tickerPrice(t){return normalizeGmxUsd(t?.markPrice??t?.maxPrice??t?.minPrice??t?.indexPrice??t?.price);}
async function fetchAllTickers(sdk){
  if(typeof sdk?.fetchMarketsTickers!=="function")return [];
  try{const t=await sdk.fetchMarketsTickers();return Array.isArray(t)?t:[];}catch(e){console.warn("[MARKETS][TICKERS_FAIL]",safeError(e));return [];}
}

async function fetchCandles(symbol,tf){
  const q={tokenSymbol:normalizeSymbol(symbol),period:tf,limit:CONFIG.CANDLE_LIMIT};
  const errors=[];
  for(const base of CONFIG.ORACLE_PEERS){
    try { const u=new URL(`${base}/prices/candles`); for(const [k,v] of Object.entries(q))u.searchParams.set(k,String(v)); const c=normalizeCandles(await fetchJson(u.toString(),{headers:{accept:"application/json"}})); if(c.length)return c; errors.push("EMPTY"); } catch(e){errors.push(safeError(e));}
  }
  throw new Error(`No candles: ${symbol} ${tf} | ${errors.join(" | ")}`);
}

function tradeRows(payload){
  if(Array.isArray(payload))return payload;
  for(const k of ["trades","data","rows","result","items"]){if(Array.isArray(payload?.[k]))return payload[k];}
  return [];
}
function tradeSymbol(t){return normalizeSymbol(t?.symbol||t?.indexTokenSymbol||t?.indexName||t?.marketSymbol||t?.market?.symbol||t?.market?.indexTokenSymbol||"");}
function tradeAccount(t){return String(t?.account||t?.user||t?.wallet||t?.address||t?.trader||"").toLowerCase();}
function tradeTimestamp(t){return num(t?.timestamp??t?.updatedAt??t?.blockTimestamp??t?.createdAt)*((num(t?.timestamp??t?.updatedAt??t?.blockTimestamp??t?.createdAt)<1e12)?1000:1);}
function tradeNotional(t){
  for(const v of [t?.sizeDeltaUsd,t?.sizeUsd,t?.notionalUsd,t?.positionSizeUsd,t?.size,t?.collateralUsd]){const n=normalizeGmxUsd(v);if(n>0)return n;}
  return 0;
}
function tradeDirection(t){
  const d=String(t?.direction||t?.marketDirection||t?.side||"").toLowerCase();
  if(d.includes("long"))return "LONG"; if(d.includes("short"))return "SHORT";
  return t?.isLong===true?"LONG":t?.isLong===false?"SHORT":"";
}
function tradeIsClose(t){const a=String(t?.eventName||t?.eventType||t?.action||t?.orderEvent||t?.type||"").toLowerCase();return /close|decrease|liquidat|stop|take.?profit/.test(a);}
function tradeIsOpen(t){const a=String(t?.eventName||t?.eventType||t?.action||t?.orderEvent||t?.type||"").toLowerCase();return /open|increase|create|execut/.test(a)&&!tradeIsClose(t);}
async function fetchSmartMoneyFlow(sdk){
  const empty={imbalance:0,flowSpikeRatio:1,flowSurge:false,explosiveFlow:false,largeTradeCount:0,smartWalletCount:0,suspiciousWalletCount:0,walletConcentration:0,bySymbol:{},source:"NONE",available:false};
  if(!CONFIG.SMART_MONEY.enabled||!sdk?.searchTrades)return empty;
  try{
    const from=Date.now()-CONFIG.SMART_MONEY.lookbackMs;
    const res=await sdk.searchTrades({forAllAccounts:true,fromTimestamp:Math.floor(from/1000),limit:CONFIG.SMART_MONEY.limit,showDebugValues:false});
    const trades=tradeRows(res);
    const by={};
    for(const t of trades){
      const symbol=tradeSymbol(t),account=tradeAccount(t),notional=tradeNotional(t),dir=tradeDirection(t),ts=tradeTimestamp(t);
      if(!symbol||!account||!dir||!(notional>0)||!ts||ts<from)continue;
      const close=tradeIsClose(t), open=tradeIsOpen(t)||!close;
      let signed=0;
      if(open) signed=dir==="LONG"?notional:-notional;
      else signed=dir==="SHORT"?notional:-notional;
      const b=by[symbol] ||= {net:0,openLong:0,openShort:0,closeLong:0,closeShort:0,notional:0,largeTradeCount:0,wallets:{},events:0};
      b.net+=signed; b.notional+=notional; b.events++; if(open&&dir==="LONG")b.openLong+=notional; if(open&&dir==="SHORT")b.openShort+=notional; if(close&&dir==="LONG")b.closeLong+=notional; if(close&&dir==="SHORT")b.closeShort+=notional;
      if(notional>=CONFIG.SMART_MONEY.largeNotionalUsd){b.largeTradeCount++;const w=b.wallets[account] ||= {notional:0,count:0,net:0};w.notional+=notional;w.count++;w.net+=signed;}
    }
    for(const b of Object.values(by)){const ws=Object.values(b.wallets).sort((a,c)=>c.notional-a.notional);const totalLarge=ws.reduce((a,w)=>a+w.notional,0);const top=ws[0]?.notional||0;b.walletConcentration=totalLarge>0?top/totalLarge:0;b.smartWalletCount=ws.length;b.suspiciousWalletCount=ws.filter(w=>w.count>=CONFIG.SMART_MONEY.suspiciousRepeatCount||w.notional>=CONFIG.SMART_MONEY.whaleNotionalUsd).length;b.imbalance=b.notional>0?b.net/b.notional:0;b.flowSpikeRatio=b.notional>0?Math.max(1,b.largeTradeCount/(Math.max(1,b.events)*0.12)):1;b.flowSurge=b.flowSpikeRatio>=1.8;b.explosiveFlow=b.flowSpikeRatio>=3;delete b.wallets;}
    return {imbalance:0,flowSpikeRatio:1,flowSurge:false,explosiveFlow:false,largeTradeCount:Object.values(by).reduce((n,b)=>n+b.largeTradeCount,0),smartWalletCount:Object.values(by).reduce((n,b)=>n+b.smartWalletCount,0),suspiciousWalletCount:Object.values(by).reduce((n,b)=>n+b.suspiciousWalletCount,0),walletConcentration:Math.max(0,...Object.values(by).map(b=>b.walletConcentration)),bySymbol:by,source:"GMX_SEARCH_TRADES_ALL_ACCOUNTS",available:trades.length>0};
  }catch(e){console.warn("[SMART_MONEY][ERROR]",safeError(e));return empty;}
}
function smartMoneyForSymbol(flow,symbol,direction){
  const b=flow?.bySymbol?.[normalizeSymbol(symbol)]||{};const aligned=Number(b.imbalance||0)*(direction==="LONG"?1:-1);
  return {...b,imbalance:Number(b.imbalance||0),aligned,confirmed:aligned>=CONFIG.SMART_MONEY.minDirectionalImbalance||Number(b.suspiciousWalletCount||0)>0||Number(b.walletConcentration||0)>=CONFIG.SMART_MONEY.concentrationCap};
}
function fastIndicators(candles){
  const a=Array.isArray(candles)?candles.filter(Boolean):[], closes=a.map(c=>num(c.close)).filter(x=>x>0);
  const ema=(vals,p)=>{if(vals.length<p)return null;let e=vals.slice(0,p).reduce((x,y)=>x+y,0)/p,k=2/(p+1);for(let i=p;i<vals.length;i++)e=vals[i]*k+e*(1-k);return e;};
  const ef=ema(closes,CONFIG.FAST_INDICATORS.emaFast),es=ema(closes,CONFIG.FAST_INDICATORS.emaSlow);
  const p=CONFIG.FAST_INDICATORS.rsiPeriod;let gain=0,loss=0;if(closes.length>p){for(let i=closes.length-p;i<closes.length;i++){const d=closes[i]-closes[i-1];if(d>=0)gain+=d;else loss-=d;}gain/=p;loss/=p;}const rsi=loss===0?100:100-(100/(1+(gain/Math.max(loss,1e-12))));
  const macdFast=ema(closes,CONFIG.FAST_INDICATORS.macdFast),macdSlow=ema(closes,CONFIG.FAST_INDICATORS.macdSlow),macd=(macdFast&&macdSlow)?macdFast-macdSlow:0;
  const rocBars=CONFIG.FAST_INDICATORS.rocBars;const roc=closes.length>rocBars?((closes.at(-1)-closes.at(-1-rocBars))/closes.at(-1-rocBars))*100:0;
  const ranges=a.slice(-20).map(c=>Math.max(0,num(c.high)-num(c.low))).filter(x=>x>0),recent=ranges.slice(-3).reduce((x,y)=>x+y,0)/Math.max(1,Math.min(3,ranges.length)),base=ranges.slice(0,-3).reduce((x,y)=>x+y,0)/Math.max(1,ranges.length-3),rangeRatio=base>0?recent/base:1;
  const last=a.at(-1),m=hybridCandleMetrics(last||{}),price=num(last?.close),atr=num(hybridAtr(a.slice(0,-1),14))||price*0.005;
  const trend=ef&&es?(ef>es?1:-1):0;const momentum=(Math.min(100,Math.abs(roc)*12)+Math.min(100,Math.abs(rsi-50)*2)+Math.min(100,rangeRatio*35))/3;
  return {emaFast:ef,emaSlow:es,rsi:Number(rsi.toFixed(2)),macd:Number(macd.toFixed(8)),rocPct:Number(roc.toFixed(4)),rangeRatio:Number(rangeRatio.toFixed(3)),atr,bodyRatio:m.bodyRatio,trend,momentumScore:Number(momentum.toFixed(1)),bullish:trend>0&&rsi>=50&&macd>=0,bearish:trend<0&&rsi<=50&&macd<=0};
}

function topTraderScore(_topTrader,_symbol,_direction){ return {available:false,boost:0,alignment:0,policy:"NON_BLOCKING"}; }


function hybridAtr(candles, period=14){
  const a=Array.isArray(candles)?candles:[]; if(a.length<2)return null; const tr=[];
  for(let i=0;i<a.length;i++){const h=Number(a[i]?.high),l=Number(a[i]?.low);if(!Number.isFinite(h)||!Number.isFinite(l))continue;if(i===0){tr.push(Math.max(0,h-l));continue;}const prev=Number(a[i-1]?.close);tr.push(Math.max(0,h-l,Number.isFinite(prev)?Math.abs(h-prev):0,Number.isFinite(prev)?Math.abs(l-prev):0));}
  const n=Math.max(2,Number(period)||14);if(tr.length<n)return null;let value=tr.slice(0,n).reduce((x,y)=>x+y,0)/n;for(let i=n;i<tr.length;i++)value=((value*(n-1))+tr[i])/n;return Number.isFinite(value)&&value>0?value:null;
}
function hybridTsMs(ts){const n=Number(ts);if(!Number.isFinite(n)||n<=0)return 0;return n<1e12?n*1000:n;}
function hybridCandleIntervalMs(tf){return ({'5m':300000,'15m':900000}[tf]||300000);}
function hybridClosedCandles(candles,tf){const a=Array.isArray(candles)?candles.filter(Boolean):[];if(a.length<2)return a;const ts=hybridTsMs(a.at(-1)?.timestamp);return ts>0&&ts+hybridCandleIntervalMs(tf)>Date.now()+5000?a.slice(0,-1):a;}
function hybridCandleMetrics(c){const open=Number(c?.open),high=Number(c?.high),low=Number(c?.low),close=Number(c?.close),range=Math.max(0,high-low),body=Math.abs(close-open);return{bullish:close>open,bearish:close<open,range,body,bodyRatio:range>0?body/range:0,lowerWick:range>0?(Math.min(open,close)-low)/range:0,upperWick:range>0?(high-Math.max(open,close))/range:0,closeLocation:range>0?(close-low)/range:0};}
function hybridFlowAligned(flow,direction){const f=Number(flow?.imbalance||0);return Number.isFinite(f)?(direction==='LONG'?f:-f):0;}
function hybridFlowEvidence(flow,direction){const a=hybridFlowAligned(flow,direction),r=[];if(a>=0.15)r.push('SMART_MONEY_FLOW');if(a>=0.30)r.push('STRONG_SMART_MONEY_FLOW');if(Number(flow?.flowSpikeRatio||1)>=Number(CONFIG.SMART_MONEY_FLOW_SPIKE_THRESHOLD||1.8))r.push('FLOW_SURGE');if(Number(flow?.flowSpikeRatio||1)>=Number(CONFIG.SMART_MONEY_FLOW_EXPLOSIVE_THRESHOLD||3))r.push('EXPLOSIVE_FLOW');if(Number(flow?.largeTradeCount||0)>=1)r.push('LARGE_TRADE_PARTICIPATION');if(direction==='LONG'&&Number(flow?.longOpenUsd||0)>Number(flow?.longCloseUsd||0))r.push('LONG_OPENING_PRESSURE');if(direction==='SHORT'&&Number(flow?.shortOpenUsd||0)>Number(flow?.shortCloseUsd||0))r.push('SHORT_OPENING_PRESSURE');return r;}
function hybridCollectPivots(candles,type,lookback){const a=(candles||[]).slice(-lookback),out=[],l=CONFIG.HYBRID_SR.pivotLeft,r=CONFIG.HYBRID_SR.pivotRight;for(let i=l;i<a.length-r;i++){const v=type==='R'?Number(a[i].high):Number(a[i].low);if(!(v>0))continue;let ok=true;for(let j=i-l;j<=i+r;j++)if(j!==i){const x=type==='R'?Number(a[j].high):Number(a[j].low);if((type==='R'&&x>=v)||(type==='S'&&x<=v)){ok=false;break;}}if(ok)out.push({price:v,at:hybridTsMs(a[i].timestamp)});}return out;}
function hybridBuildZones(candlesByTf,currentPrice,currentAtr){
  const atrValue=Number(currentAtr)>0?Number(currentAtr):currentPrice*0.005,all={S:[],R:[]},weights={'5m':1,'15m':1.25};
  for(const tf of ['5m','15m']){const raw=Array.isArray(candlesByTf?.[tf])?candlesByTf[tf]:[],c=hybridClosedCandles(raw,tf),look=CONFIG.HYBRID_SR['lookback'+tf]||96,tfAtr=Number(hybridAtr(c,14))||atrValue;for(const type of ['S','R'])for(const p of hybridCollectPivots(c,type,look))all[type].push({...p,tf,weight:weights[tf]||1,tfAtr});}
  const out={support:[],resistance:[]};
  for(const type of ['S','R']){const zones=[];for(const p of all[type].sort((a,b)=>b.at-a.at)){const mergeDistance=Math.max(atrValue*CONFIG.HYBRID_SR.mergeAtrDistance,Number(p.tfAtr||atrValue)*0.22),zoneWidth=Math.max(atrValue*CONFIG.HYBRID_SR.zoneAtrWidth,Number(p.tfAtr||atrValue)*0.06);let z=zones.find(x=>Math.abs(x.center-p.price)<=mergeDistance);if(!z){z={center:p.price,low:p.price-zoneWidth,high:p.price+zoneWidth,touches:0,weight:0,timeframes:new Set(),lastAt:p.at};zones.push(z);}z.touches++;z.weight+=p.weight;z.timeframes.add(p.tf);z.center=(z.center*(z.touches-1)+p.price)/z.touches;z.low=Math.min(z.low,p.price-zoneWidth);z.high=Math.max(z.high,p.price+zoneWidth);z.lastAt=Math.max(z.lastAt,p.at);}
    const usable=zones.filter(z=>z.touches>=CONFIG.HYBRID_SR.minTouches||z.timeframes.size>=2).map(z=>({...z,timeframes:[...z.timeframes],quality:Number((z.touches+Math.min(2,z.timeframes.size)*0.6+Math.min(2,z.weight)*0.2).toFixed(2)),distanceAtr:Math.abs(currentPrice-z.center)/atrValue})).filter(z=>z.quality>=CONFIG.HYBRID_ENTRY.minZoneQuality).sort((a,b)=>b.quality-a.quality||a.distanceAtr-b.distanceAtr).slice(0,CONFIG.HYBRID_SR.maxZonesPerSide);
    if(type==='S')out.support=usable;else out.resistance=usable;}return out;
}
function hybridNearestZone(zones,price,maxAtr,atrValue,side){const tol=atrValue*maxAtr;return(zones||[]).filter(z=>side==='S'?Number(z.center)<=price+tol&&price>=Number(z.low)-tol:Number(z.center)>=price-tol&&price<=Number(z.high)+tol).sort((a,b)=>a.distanceAtr-b.distanceAtr||b.quality-a.quality)[0]||null;}
function hybridPercentChange(candles,bars){const a=Array.isArray(candles)?candles:[],n=Math.max(1,Math.floor(Number(bars)||1));if(a.length<=n)return 0;const last=Number(a.at(-1)?.close),prev=Number(a[a.length-1-n]?.close);return prev?((last-prev)/prev)*100:0;}
function hybridSma(values,period){const arr=Array.isArray(values)?values:[],p=Math.max(1,Math.floor(Number(period)||1));if(arr.length<p)return null;const sum=arr.slice(-p).reduce((a,b)=>a+Number(b||0),0);return Number.isFinite(sum)?sum/p:null;}
function hybridVolumeContext(candles){const a=(candles||[]).slice(-40),vol=a.map(c=>Number(c.volume)).filter(v=>v>0),ranges=a.map(c=>Number(c.high)-Number(c.low)).filter(v=>v>0),recentVol=hybridSma(vol,5),baseVol=hybridSma(vol.slice(0,-5),Math.min(20,Math.max(1,vol.length-5))),recentRange=hybridSma(ranges,5),baseRange=hybridSma(ranges.slice(0,-5),Math.min(20,Math.max(1,ranges.length-5))),va=vol.length>=15&&baseVol>0,vr=va?recentVol/baseVol:1,rr=baseRange>0?recentRange/baseRange:1;return{volumeAvailable:va,volumeRatio:vr,rangeRatio:rr,volumeSurge:vr>=CONFIG.HYBRID_VOLUME.expansionStrong,volumeExplosive:vr>=CONFIG.HYBRID_VOLUME.expansionExplosive,volumeDrying:va&&vr<=0.65,rangeExpansion:rr>=CONFIG.HYBRID_VOLUME.rangeExpansionStrong,rangeExplosive:rr>=CONFIG.HYBRID_VOLUME.rangeExpansionExplosive,rangeDrying:rr<=0.75};}
function hybridReactionSupport(c,level,flow,vol,atrValue){const m=hybridCandleMetrics(c),inside=c.low<=level.high+atrValue*0.25&&c.close>=level.low,wick=m.lowerWick>=CONFIG.HYBRID_SR.rejectionWickRatio,closeBack=m.closeLocation>=CONFIG.HYBRID_SR.rejectionCloseRatio,sweep=(level.low-c.low)>=atrValue*CONFIG.HYBRID_SR.sweepDepthAtr&&inside,a=hybridFlowAligned(flow,'LONG'),flowOk=a>=CONFIG.HYBRID_ENTRY.minReactionFlowImbalance,volumeOk=vol.volumeAvailable?vol.volumeRatio>=CONFIG.HYBRID_ENTRY.minReactionVolumeRatio:vol.rangeRatio>=1.15,evidence=[];if(wick)evidence.push('LOWER_WICK_REJECTION');if(closeBack)evidence.push('CLOSE_BACK_ABOVE_SUPPORT');if(sweep)evidence.push('LIQUIDITY_SWEEP_RECLAIM');if(flowOk)evidence.push('BUY_FLOW');if(volumeOk)evidence.push('ACTIVITY_CONFIRMATION');return{confirmed:inside&&m.bullish&&(wick||sweep)&&closeBack,evidence,sweep,wick,flowAligned:a,flowOk,volumeOk};}
function hybridReactionResistance(c,level,flow,vol,atrValue){const m=hybridCandleMetrics(c),inside=c.high>=level.low-atrValue*0.20&&c.close<=level.high,wick=m.upperWick>=CONFIG.HYBRID_SR.rejectionWickRatio,closeBack=(1-m.closeLocation)>=CONFIG.HYBRID_SR.rejectionCloseRatio,sweep=(c.high-level.high)>=atrValue*CONFIG.HYBRID_SR.sweepDepthAtr&&inside,a=hybridFlowAligned(flow,'SHORT'),flowOk=a>=CONFIG.HYBRID_ENTRY.minReactionFlowImbalance,volumeOk=vol.volumeAvailable?vol.volumeRatio>=CONFIG.HYBRID_ENTRY.minReactionVolumeRatio:vol.rangeRatio>=1.20,evidence=[];if(wick)evidence.push('UPPER_WICK_REJECTION');if(closeBack)evidence.push('CLOSE_BACK_BELOW_RESISTANCE');if(sweep)evidence.push('LIQUIDITY_SWEEP_RECLAIM');if(flowOk)evidence.push('SELL_FLOW');if(volumeOk)evidence.push('ACTIVITY_CONFIRMATION');return{confirmed:inside&&m.bearish&&(wick||sweep)&&closeBack,evidence,sweep,wick,flowAligned:a,flowOk,volumeOk};}
function hybridBreakout(c,level,direction,flow,vol,atrValue){const m=hybridCandleMetrics(c),buffer=atrValue*CONFIG.HYBRID_SR.breakoutBufferAtr,above=c.close>level.high+buffer,below=c.close<level.low-buffer,a=hybridFlowAligned(flow,direction),volumeOk=vol.volumeAvailable?vol.volumeRatio>=CONFIG.HYBRID_ENTRY.minBreakoutVolumeRatio:vol.rangeRatio>=1.15,flowOk=a>=CONFIG.HYBRID_ENTRY.minBreakoutFlowImbalance,bodyOk=m.bodyRatio>=CONFIG.HYBRID_ENTRY.breakoutMinBodyRatio,broken=direction==='LONG'?above&&m.bullish:below&&m.bearish;return{broken:broken&&bodyOk,above,below,bodyOk,volumeOk,flowOk,aligned:a};}
function hybridRetest(c,level,direction,flow,vol,atrValue){const tol=atrValue*CONFIG.HYBRID_SR.retestToleranceAtr,m=hybridCandleMetrics(c),touched=direction==='LONG'?c.low<=level.high+tol&&c.low>=level.low-tol:c.high>=level.low-tol&&c.high<=level.high+tol,holds=direction==='LONG'?c.close>level.high:c.close<level.low,rejection=direction==='LONG'?(m.bullish&&m.lowerWick>=0.15):(m.bearish&&m.upperWick>=0.15),a=hybridFlowAligned(flow,direction),activity=vol.volumeSurge||vol.rangeExpansion||a>=CONFIG.HYBRID_ENTRY.minReactionFlowImbalance||CONFIG.HYBRID_ENTRY.allowNeutralActivity;return{touched,holds,rejection,activity,aligned:a,confirmed:touched&&holds&&rejection&&activity&&m.bodyRatio>=CONFIG.HYBRID_ENTRY.retestMinBodyRatio};}
function hybridZoneId(z){return z?`${Number(z.center).toFixed(6)}:${Number(z.low).toFixed(6)}:${Number(z.high).toFixed(6)}`:'';}
function hybridEarlyImpulse(symbol,candles,flow,debugStats=null){
  const dbg=debugStats&&typeof debugStats==='object'?debugStats:null;
  const bump=(key)=>{if(dbg)dbg[key]=(Number(dbg[key])||0)+1;};
  const reject=(reason,meta={})=>{
    bump('rejected');
    bump(reason);
    if(dbg?.lastRejections){
      dbg.lastRejections.push({symbol,reason,...meta});
      if(dbg.lastRejections.length>20)dbg.lastRejections.shift();
    }
    return null;
  };
  bump('attempted');

  if(CONFIG.HYBRID_ENTRY?.earlyEnabled===false)return reject('DISABLED');

  const raw=Array.isArray(candles?.["5m"])?candles["5m"]:[];
  if(raw.length<25)return reject('HISTORY');

  const closed=hybridClosedCandles(raw,"5m");
  const current=raw.at(-1);
  if(!current||closed.length<20)return reject('HISTORY');

  const now=Date.now(),ts=hybridTsMs(current.timestamp);
  if(ts>0&&now-ts<0)return reject('FUTURE_CANDLE');
  if(ts>0&&now-ts<Number(CONFIG.HYBRID_ENTRY.earlyMinElapsedMs||20000))return reject('TOO_EARLY');
  bump('elapsedPass');

  const price=Number(current.close||0),open=Number(current.open||price);
  if(!(price>0&&open>0))return reject('PRICE');

  const atr=Number(hybridAtr(closed,14))||price*0.005;
  if(!(atr>0))return reject('ATR');

  const m=hybridCandleMetrics(current);
  const prev1=Number(closed.at(-1)?.close||0),prev2=Number(closed.at(-2)?.close||0);
  const movePct=(price-open)/open*100;
  const prevMove1=prev2>0&&prev1>0?(prev1-prev2)/prev2*100:0;
  const acceleration=movePct-prevMove1;
  const extension=Math.abs(price-open)/atr;

  const vol=hybridVolumeContext(raw);
  const alignedLong=hybridFlowAligned(flow,"LONG"),alignedShort=hybridFlowAligned(flow,"SHORT");
  const directionalMove=Math.abs(movePct);
  const dir=movePct>0?"LONG":movePct<0?"SHORT":null;

  if(!dir)return reject('NO_DIRECTION');
  if(directionalMove<Number(CONFIG.HYBRID_ENTRY.earlyMinMovePct||0.12))
    return reject('MOVE',{movePct:Number(movePct.toFixed(4))});
  bump('movePass');

  const aligned=dir==="LONG"?alignedLong:alignedShort;
  const volumeOk=vol.volumeAvailable
    ? Number(vol.volumeRatio)>=Number(CONFIG.HYBRID_ENTRY.earlyMinVolumeRatio||1.35)
    : Number(vol.rangeRatio)>=1.20;
  const flowOk=aligned>=Number(CONFIG.HYBRID_ENTRY.earlyMinFlowImbalance||0.07);
  const bodyOk=m.bodyRatio>=Number(CONFIG.HYBRID_ENTRY.earlyMinBodyRatio||0.35);
  const accelValue=dir==="LONG"?acceleration:-acceleration;
  const accelOk=accelValue>=Number(CONFIG.HYBRID_ENTRY.earlyMinAccelerationPct||0.04);

  if(bodyOk)bump('bodyPass');
  else return reject('BODY',{bodyRatio:Number(m.bodyRatio.toFixed(3))});

  if(volumeOk)bump('volumePass');
  if(flowOk)bump('flowPass');

  // V17.3.9: activity is no longer a blind hard gate.
  // A genuine momentum impulse can qualify when volume/flow is neutral,
  // but only with materially stronger acceleration + candle body.
  const momentumActivityOk=
    accelValue>=Number(CONFIG.HYBRID_ENTRY.earlyMinAccelerationPct||0.04)*2 &&
    m.bodyRatio>=0.45;
  const activityOk=volumeOk||flowOk||momentumActivityOk;
  const activityPath=volumeOk?"VOLUME":flowOk?"FLOW":momentumActivityOk?"MOMENTUM":"NONE";

  if(momentumActivityOk&&!volumeOk&&!flowOk)bump('momentumActivityPass');
  if(!activityOk)
    return reject('ACTIVITY',{
      volumeRatio:Number(vol.volumeRatio||0),
      flowImbalance:Number(aligned||0),
      accelerationPct:Number(accelValue.toFixed(4)),
      bodyRatio:Number(m.bodyRatio.toFixed(3))
    });

  if(accelOk)bump('accelerationPass');
  else return reject('ACCELERATION',{accelerationPct:Number(accelValue.toFixed(4))});

  if(extension>Number(CONFIG.HYBRID_ENTRY.earlyMaxExtensionAtr||1.25))
    return reject('EXTENSION',{extensionAtr:Number(extension.toFixed(3))});
  bump('extensionPass');

  const zones=hybridBuildZones({"5m":closed,"15m":[]},price,atr);

  // For an early LONG, the relevant structural target is resistance.
  // For an early SHORT, the relevant structural target is support.
  const zone=dir==="LONG"
    ?hybridNearestZone(zones.resistance,price,Number(CONFIG.HYBRID_ENTRY.earlyMaxEntryDistanceAtr||1.30),atr,"R")
    :hybridNearestZone(zones.support,price,Number(CONFIG.HYBRID_ENTRY.earlyMaxEntryDistanceAtr||1.30),atr,"S");

  if(!zone)return reject('ZONE');
  bump('zonePass');

  const distance=Math.abs(price-Number(zone.center))/atr;
  if(distance>Number(CONFIG.HYBRID_ENTRY.earlyMaxEntryDistanceAtr||1.30))
    return reject('DISTANCE',{distanceAtr:Number(distance.toFixed(3))});

  bump('proximityPass');

  // V17.3.9: "near break" is a confirmation bonus, not a mandatory gate.
  // This prevents the old PREBREAK choke where a valid early impulse was
  // discarded simply because price had not yet touched the zone.
  const nearBreak=dir==="LONG"
    ?price>=Number(zone.low)-atr*Number(CONFIG.HYBRID_ENTRY.earlyPrebreakToleranceAtr||0.45)
    :price<=Number(zone.high)+atr*Number(CONFIG.HYBRID_ENTRY.earlyPrebreakToleranceAtr||0.45);

  if(nearBreak)bump('prebreakPass');
  else if(!(momentumActivityOk&&distance<=0.90))
    return reject('PREBREAK',{
      distanceAtr:Number(distance.toFixed(3)),
      nearBreak:false,
      activityPath
    });

  // V17.3.9: score is normalized to the actual Early thresholds.
  // The previous formula required roughly ~1% candle movement to reach
  // earlyMinScore=62 even though earlyMinMovePct was only 0.12%.
  const moveScore=Math.min(20,(directionalMove/Math.max(0.001,Number(CONFIG.HYBRID_ENTRY.earlyMinMovePct||0.12)))*20);
  const accelScore=Math.min(15,(Math.max(0,accelValue)/Math.max(0.001,Number(CONFIG.HYBRID_ENTRY.earlyMinAccelerationPct||0.04)))*15);
  const volumeScore=volumeOk
    ?Math.min(15,Math.max(0,(Number(vol.volumeRatio||1)-1)/0.35*10))
    :0;
  const flowScore=flowOk
    ?Math.min(15,Math.max(0,aligned)/0.07*10)
    :0;
  const bodyScore=Math.min(10,Math.max(0,(m.bodyRatio-0.35)/0.30*10));
  const proximityScore=Math.min(10,Math.max(0,1-distance/Math.max(0.001,Number(CONFIG.HYBRID_ENTRY.earlyMaxEntryDistanceAtr||1.30)))*10);
  const prebreakScore=nearBreak?5:0;
  const score=Math.min(100,25+moveScore+accelScore+volumeScore+flowScore+bodyScore+proximityScore+prebreakScore);

  // Momentum-only path receives enough edge from the impulse itself;
  // volume/flow remain positive confluence, not mandatory evidence.
  const edge=(volumeOk?3:0)+(flowOk?4:0)+(accelOk?3:0)+(m.bodyRatio>=0.55?2:0)+(extension<=0.75?2:0)+(momentumActivityOk&&!volumeOk&&!flowOk?2:0);

  if(score>=Number(CONFIG.HYBRID_ENTRY.earlyMinScore||62))bump('scorePass');
  else return reject('SCORE',{
    score:Number(score.toFixed(1)),
    required:Number(CONFIG.HYBRID_ENTRY.earlyMinScore||62),
    activityPath,
    distanceAtr:Number(distance.toFixed(3))
  });

  if(edge>=Number(CONFIG.HYBRID_ENTRY.earlyMinEdge||5))bump('edgePass');
  else return reject('EDGE',{
    edge:Number(edge.toFixed(1)),
    required:Number(CONFIG.HYBRID_ENTRY.earlyMinEdge||5),
    activityPath
  });

  bump('qualified');

  return {
    direction:dir,
    trigger:dir==="LONG"?"EARLY_IMPULSE_BREAKOUT_LONG":"EARLY_IMPULSE_BREAKOUT_SHORT",
    zone,
    evidence:[
      "LIVE_5M_IMPULSE",
      "ACCELERATION",
      ...(volumeOk?["VOLUME_BURST"]:[]),
      ...(flowOk?["FLOW_CONFIRMATION"]:[]),
      ...(momentumActivityOk&&!volumeOk&&!flowOk?["MOMENTUM_ACTIVITY_CONFIRMATION"]:[]),
      ...(nearBreak?["PRE_BREAKOUT_PROXIMITY"]:["STRUCTURAL_PROXIMITY"])
    ],
    atr,price,volume:vol,flow,entryDistanceAtr:distance,
    tier:score>=82?"PRIME":score>=72?"NORMAL":"FAST",
    confirmationCount:Number(volumeOk)+Number(flowOk)+Number(accelOk)+Number(momentumActivityOk&&!volumeOk&&!flowOk),
    early:true,
    earlyScore:Number(score.toFixed(1)),
    edge:Number(edge.toFixed(1)),
    movePct:Number(movePct.toFixed(4)),
    accelerationPct:Number(acceleration.toFixed(4)),
    extensionAtr:Number(extension.toFixed(3)),
    activityPath,
    nearBreak,
    candleTimestamp:ts
  };
}

function hybridClassifyStructure(symbol,candles,price,flow,previousState={}){
  const raw5=Array.isArray(candles['5m'])?candles['5m']:[],c5=hybridClosedCandles(raw5,'5m'),c15=hybridClosedCandles(candles['15m']||[],'15m'),current=raw5.at(-1)||c5.at(-1);if(!current)return{state:'NO_DATA',direction:'NONE',entries:[],zones:{support:[],resistance:[]}};
  const atr5=Number(hybridAtr(c5,14))||price*0.005,zones=hybridBuildZones({'5m':c5,'15m':c15},price,atr5),vol=hybridVolumeContext(c5),fast=fastIndicators(raw5),sm=smartMoneyForSymbol(flow,symbol,'LONG'),entries=[],watched=[],priorC5=c5.slice(0,-1),preMove5=hybridPercentChange(priorC5,5),support=hybridNearestZone(zones.support,price,CONFIG.HYBRID_SR.proximityAtr,atr5,'S'),resistance=hybridNearestZone(zones.resistance,price,CONFIG.HYBRID_SR.proximityAtr,atr5,'R');
  const pushReaction=(direction,trigger,zone,rx)=>{const distance=Math.abs(price-zone.center)/atr5;const priorOk=direction==='LONG'?preMove5<=-CONFIG.HYBRID_ENTRY.priorMovePct:preMove5>=CONFIG.HYBRID_ENTRY.priorMovePct;const structural=rx.confirmed&&distance<=CONFIG.HYBRID_ENTRY.maxEntryDistanceAtr;const smart=smartMoneyForSymbol(flow,symbol,direction);const fastOk=direction==='LONG'?fast.bullish:fast.bearish;if(structural&&(priorOk||rx.sweep)&&(smart.confirmed||rx.sweep||fastOk)){const evidence=[...(rx.evidence||[])];if(smart.confirmed)evidence.push('SMART_MONEY_CONFIRMATION');if(smart.suspiciousWalletCount)evidence.push('SUSPICIOUS_WHALE_ACTIVITY');if(fastOk)evidence.push('FAST_INDICATOR_ALIGNMENT');const confirmations=Number(Boolean(rx.sweep))+Number(Boolean(rx.flowOk))+Number(Boolean(rx.volumeOk))+Number(Boolean(smart.confirmed));const tier=rx.sweep&&confirmations>=2?'PRIME':confirmations>=1?'NORMAL':'FAST';entries.push({direction,trigger,zone,evidence,atr:atr5,price,volume:vol,flow,smartMoney:smart,fastIndicators:fast,entryDistanceAtr:distance,tier,confirmationCount:confirmations,sweep:Boolean(rx.sweep)});}};
  if(support){const bounce=hybridReactionSupport(current,support,flow,vol,atr5);watched.push({type:'SUPPORT',zone:support,bounce});if(preMove5<=-CONFIG.HYBRID_ENTRY.priorMovePct)pushReaction('LONG','SUPPORT_BOUNCE',support,bounce);const br=hybridBreakout(current,support,'SHORT',flow,vol,atr5);if(br.broken)entries.push({direction:'WAIT',trigger:'SUPPORT_BREAK_WAIT_RETEST',zone:support,evidence:['SUPPORT_BROKEN',...(br.volumeOk?['ACTIVITY_CONFIRMATION']:[]),...(br.flowOk?['FLOW_CONFIRMATION']:[])],breakoutAt:Number(current.timestamp)||Date.now(),atr:atr5,price,flow,volume:vol});}
  if(resistance){const rej=hybridReactionResistance(current,resistance,flow,vol,atr5);watched.push({type:'RESISTANCE',zone:resistance,rejection:rej});if(preMove5>=CONFIG.HYBRID_ENTRY.priorMovePct)pushReaction('SHORT','RESISTANCE_REJECTION',resistance,rej);const br=hybridBreakout(current,resistance,'LONG',flow,vol,atr5);if(br.broken)entries.push({direction:'WAIT',trigger:'RESISTANCE_BREAK_WAIT_RETEST',zone:resistance,evidence:['RESISTANCE_BROKEN',...(br.volumeOk?['ACTIVITY_CONFIRMATION']:[]),...(br.flowOk?['FLOW_CONFIRMATION']:[])],breakoutAt:Number(current.timestamp)||Date.now(),atr:atr5,price,flow,volume:vol});}
  const next={...(previousState||{}),updatedAt:Date.now()},wait=entries.find(x=>x.direction==='WAIT');if(wait)next.pendingRetest={direction:wait.trigger.startsWith('SUPPORT')?'SHORT':'LONG',zone:wait.zone,zoneId:hybridZoneId(wait.zone),createdAt:Date.now(),breakoutAt:wait.breakoutAt,atr:atr5};if(next.pendingRetest&&Date.now()-Number(next.pendingRetest.createdAt||0)>CONFIG.HYBRID_ENTRY.breakoutRetestTtlMs)delete next.pendingRetest;
  const p=next.pendingRetest;if(p){const fresh=Number(current.timestamp)>Number(p.breakoutAt||0),rt=fresh?hybridRetest(current,p.zone,p.direction,flow,vol,atr5):{confirmed:false,touched:false,holds:false,rejection:false,activity:false,aligned:hybridFlowAligned(flow,p.direction)};watched.push({type:'RETEST',zone:p.zone,direction:p.direction,retest:rt,freshCandle:fresh});const distance=Math.abs(price-Number(p.zone.center))/atr5;const smart=smartMoneyForSymbol(flow,symbol,p.direction),fastOk=p.direction==='LONG'?fast.bullish:fast.bearish;if(fresh&&rt.confirmed&&distance<=CONFIG.HYBRID_ENTRY.maxRetestDistanceAtr&&(smart.confirmed||rt.aligned>=CONFIG.HYBRID_ENTRY.minReactionFlowImbalance||fastOk)){entries.push({direction:p.direction,trigger:p.direction==='LONG'?'RESISTANCE_BREAK_RETEST_LONG':'SUPPORT_BREAK_RETEST_SHORT',zone:p.zone,evidence:['BREAKOUT_RETEST','RETEST_HOLD',...(rt.activity?['ACTIVITY']:[]),...(smart.confirmed?['SMART_MONEY_CONFIRMATION']:[]),...(fastOk?['FAST_INDICATOR_ALIGNMENT']:[])],atr:atr5,price,volume:vol,flow,smartMoney:smart,fastIndicators:fast,entryDistanceAtr:distance,confirmationCount:Number(rt.activity)+Number(smart.confirmed)+Number(fastOk)});delete next.pendingRetest;}}
  const move5=Math.abs(hybridPercentChange(c5,5)),extension=atr5>0?Math.abs(price-Number(current.open))/atr5:0,near=Boolean(support||resistance||p);if(!entries.length&&move5>=1.2&&extension>=CONFIG.HYBRID_ENTRY.maxChaseAtr&&!near)next.lastState='EXHAUSTED_NO_CHASE';else if(!entries.length)next.lastState=near?'WATCH_LEVEL':'NO_SETUP';
  return{state:entries.length?(entries.some(e=>e.direction!=='WAIT')?'ENTRY_READY':'WAITING_RETEST'):next.lastState,direction:entries.find(e=>e.direction!=='WAIT')?.direction||'NONE',entries,zones,watched,volume:vol,fastIndicators:fast,atr:atr5,nextState:next,move5,preMove5,extension,eventFlags:{supportZone:Boolean(support),resistanceZone:Boolean(resistance),supportReaction:watched.some(x=>x.type==='SUPPORT'&&x.bounce?.confirmed),resistanceReaction:watched.some(x=>x.type==='RESISTANCE'&&x.rejection?.confirmed),breakout:entries.some(x=>x.trigger.includes('WAIT_RETEST')),waitingRetest:Boolean(next.pendingRetest),retestConfirmed:entries.some(x=>x.trigger.includes('RETEST')),exhausted:next.lastState==='EXHAUSTED_NO_CHASE'}};
}
function hybridLeverage(setup){let l=Number(CONFIG.HYBRID_RISK.defaultLeverage||5),t=String(setup?.trigger||'');if(t.includes('RETEST'))l=7;else if(t.includes('BOUNCE')||t.includes('REJECTION'))l=5;if(setup?.flow?.flowSurge)l=Math.max(l,7);if(setup?.flow?.explosiveFlow)l=Math.max(l,8);return Math.max(CONFIG.HYBRID_RISK.minLeverage,Math.min(CONFIG.HYBRID_RISK.maxLeverage,l));}
function hybridSignalScore(entry,analysis,flow){
  const e=entry||{}, t=String(e.trigger||'');
  let score=50;
  if(t.includes('RETEST')) score+=18;
  else if(t.includes('BOUNCE')||t.includes('REJECTION')) score+=14;
  if(e.sweep) score+=8;
  if(e.confirmationCount>=1) score+=7;
  if(e.confirmationCount>=2) score+=6;
  if(analysis?.volume?.volumeSurge||analysis?.volume?.rangeExpansion) score+=6;
  const aligned=Math.abs(Number(flow?.imbalance||0));
  score+=Math.min(8,aligned*20);
  score+=Math.max(0,Math.min(5,(Number(e.zone?.quality||0)-2)*2));
  return Math.max(0,Math.min(100,Number(score.toFixed(1))));
}

function hybridDirectionScores(entry,analysis,flow){
  const base=hybridSignalScore(entry,analysis,flow);
  const long=entry?.direction==='LONG'?base:Math.max(0,100-base);
  const short=entry?.direction==='SHORT'?base:Math.max(0,100-base);
  return {longScore:Number(long.toFixed(1)),shortScore:Number(short.toFixed(1))};
}
function hybridBuildSetup(symbol,analysis,flow,topTrader){
  const e=analysis.entries?.find(x=>x.direction==='LONG'||x.direction==='SHORT');if(!e)return null;const price=Number(analysis.price||e.price),atrValue=Number(analysis.atr||e.atr),direction=e.direction,zone=e.zone;if(!(price>0)||!(atrValue>0)||!zone||Number(zone.quality||0)<CONFIG.HYBRID_ENTRY.minZoneQuality)return null;const entryDistanceAtr=Math.abs(price-Number(zone.center))/atrValue;const maxEntryDistanceAtr=e.early?Number(CONFIG.HYBRID_ENTRY.earlyMaxEntryDistanceAtr||CONFIG.HYBRID_ENTRY.maxEntryDistanceAtr):Number(CONFIG.HYBRID_ENTRY.maxEntryDistanceAtr);if(entryDistanceAtr>maxEntryDistanceAtr)return null;
  const stopBase=direction==='LONG'?Number(zone.low):Number(zone.high),buffer=atrValue*CONFIG.HYBRID_RISK.stopAtrBuffer,stop=direction==='LONG'?stopBase-buffer:stopBase+buffer,r=Math.max(Math.abs(price-stop),buffer),oppositeZones=direction==='LONG'?(analysis.zones?.resistance||[]):(analysis.zones?.support||[]),levelTarget=oppositeZones.filter(z=>direction==='LONG'?Number(z.center)>price:Number(z.center)<price).sort((a,b)=>Math.abs(Number(a.center)-price)-Math.abs(Number(b.center)-price))[0],levelDistance=levelTarget?Math.abs(Number(levelTarget.center)-price):0,rMin=r*0.90,tp1=levelTarget&&levelDistance>=rMin?Number(levelTarget.center):(direction==='LONG'?price+r*CONFIG.HYBRID_RISK.tp1R:price-r*CONFIG.HYBRID_RISK.tp1R),tp2=direction==='LONG'?Math.max(price+r*CONFIG.HYBRID_RISK.tp2R,tp1+r*0.5):Math.min(price-r*CONFIG.HYBRID_RISK.tp2R,tp1-r*0.5),tp3=direction==='LONG'?Math.max(price+r*CONFIG.HYBRID_RISK.tp3R,tp2+r*0.5):Math.min(price-r*CONFIG.HYBRID_RISK.tp3R,tp2-r*0.5),trader=topTraderScore(topTrader, hybridNormalizeSymbol(symbol), direction);
  if((direction==='LONG'&&!(stop<price))||(direction==='SHORT'&&!(stop>price)))return null;if((direction==='LONG'&&!(tp1>price&&tp2>tp1&&tp3>tp2))||(direction==='SHORT'&&!(tp1<price&&tp2<tp1&&tp3<tp2)))return null;const tier=['FAST','NORMAL','PRIME'].includes(e.tier)?e.tier:(String(e.trigger).includes('RETEST')?'PRIME':'NORMAL');const mult=tier==='PRIME'?CONFIG.HYBRID_ENTRY.tierPrimeAllocation:tier==='NORMAL'?CONFIG.HYBRID_ENTRY.tierNormalAllocation:CONFIG.HYBRID_ENTRY.tierFastAllocation;const allocation=CONFIG.HYBRID_RISK.capitalAllocation*mult;
  const score=hybridSignalScore(e,analysis,flow),directionScores=hybridDirectionScores(e,analysis,flow);
  return{valid:true,symbol:hybridNormalizeSymbol(symbol),direction,trigger:e.trigger,score,longScore:directionScores.longScore,shortScore:directionScores.shortScore,tier,state:'ENTRY_READY',entry:price,entryPrice:price,stopLoss:Number(stop.toFixed(8)),tp1:Number(tp1.toFixed(8)),tp2:Number(tp2.toFixed(8)),tp3:Number(tp3.toFixed(8)),atr:atrValue,stopDistance:r,stopPercent:Number((r/price*100).toFixed(3)),entryDistanceAtr:Number(entryDistanceAtr.toFixed(3)),leverage:hybridLeverage({trigger:e.trigger,flow}),allocation,allocationPercent:Number((allocation*100).toFixed(2)),riskPerTradePercent:Number((CONFIG.RISK_PER_TRADE*100).toFixed(2)),zone,zoneType:e.trigger.includes('SUPPORT')?'SUPPORT':'RESISTANCE',evidence:[...new Set([...(e.evidence||[]),...hybridFlowEvidence(flow,direction)])],confirmationCount:Number(e.confirmationCount||0),entryTier:tier,flow,smartMoney:e.smartMoney||smartMoneyForSymbol(flow,symbol,direction),fastIndicators:e.fastIndicators||analysis.fastIndicators,topTrader:trader,topTraderPolicy:'CONFIRMATION_ONLY_NO_BLOCK',volume:analysis.volume,candleTimestamp:Number(analysis?.candleTimestamp||0)||0,createdAt:Date.now()};
}
function hybridEventPriority(signal){const s=signal?.hybridSetup||{},t=String(s.trigger||'');let p=0;if(t.includes('RETEST'))p+=40;else if(t.includes('BOUNCE')||t.includes('REJECTION'))p+=30;p+=Math.min(20,Number(s.zone?.quality||0)*2);const d=Number(s.entryDistanceAtr||9);p+=Math.max(0,12-d*8);const f=Math.abs(Number(s.flow?.imbalance||0));p+=Math.min(12,f*30);if(s.volume?.volumeSurge||s.volume?.rangeExpansion)p+=6;if(s.flow?.flowSurge)p+=5;if(s.flow?.explosiveFlow)p+=5;return p;}

function hybridResolveIndexSymbol(m){
  const vals=[m?.indexTokenSymbol,m?.indexName,m?.indexToken?.symbol,m?.indexToken?.tokenSymbol,m?.indexToken?.name,m?.indexTokenData?.symbol,m?.token?.symbol];
  for(const v of vals){const s=hybridNormalizeSymbol(String(v||''));if(s&&s.length<=12)return s;}
  const raw=String(m?.symbol||m?.name||m?.ticker||'');const first=raw.split('/')[0].split('[')[0];
  const s=hybridNormalizeSymbol(first);if(s&&s.length<=12)return s;
  const compact=raw.toUpperCase().replace(/[^A-Z0-9.]/g,'');const known=compact.match(/^(BTC|WBTC|ETH|WETH|SOL|ARB|AVAX|LINK|OP|APT|INJ|NEAR|TAO|ZRO|LTC|BCH|AAVE|VVV|DOGE|XRP|UNI|ATOM|SUI|SEI|ENA|PEPE|BONK)/);
  return known?hybridNormalizeSymbol(known[1]):'';
}


function toBigIntDecimal(value, decimals){
  const d=Number(decimals); if(!Number.isInteger(d)||d<0||d>80)throw new Error("Invalid decimals");
  if(typeof value==="bigint")return value;
  if(typeof value==="number"){
    if(!Number.isFinite(value))throw new Error("Invalid number");
    if(!Number.isSafeInteger(Math.round(value))) value=Number(value.toPrecision(15));
    const fixed=Math.abs(value).toFixed(Math.min(d,15));
    return toBigIntDecimal((value<0?"-":"")+fixed,d);
  }
  let s=String(value??"").trim().replace(/,/g,""); if(!s)throw new Error("Empty decimal");
  const neg=s.startsWith("-"); if(neg)s=s.slice(1); if(!/^\d+(?:\.\d+)?$/.test(s))throw new Error(`Invalid decimal: ${value}`);
  const [w,f=""] = s.split("."); if(f.length>d&&/[1-9]/.test(f.slice(d)))throw new Error(`Precision exceeds ${d}: ${value}`);
  const out=BigInt((w+(f+"0".repeat(d)).slice(0,d)).replace(/^0+(?=\d)/,"")||"0"); return neg?-out:out;
}
function validateKey(k){if(!/^0x[0-9a-fA-F]{64}$/.test(String(k||"")))throw new Error("GMX_PRIVATE_KEY is missing or invalid");}
let LIVE=null;
async function liveContext(env){
  if(!loadSdk())throw new Error("GMX_SDK_UNAVAILABLE"); validateKey(env.GMX_PRIVATE_KEY); if(!env.ARBITRUM_RPC)throw new Error("ARBITRUM_RPC is required");
  if(LIVE?.rpc===env.ARBITRUM_RPC)return LIVE;
  const signer=new PrivateKeySigner(env.GMX_PRIVATE_KEY,{rpcUrl:env.ARBITRUM_RPC,chain:getViemChain(CONFIG.CHAIN_ID)});
  const sdk=new GmxApiSdk({chainId:CONFIG.CHAIN_ID}); LIVE={sdk,signer,account:signer.address,rpc:env.ARBITRUM_RPC}; return LIVE;
}
function findSdkMarket(markets,symbol){const wanted=normalizeSymbol(symbol);return (markets||[]).find(m=>normalizeSymbol(m?.indexTokenSymbol||m?.indexName||m?.symbol||m?.name)===wanted)||null;}
function balanceRows(raw){
  const out=[]; const visit=(v,hint="",depth=0)=>{if(depth>6||v==null)return;if(Array.isArray(v)){for(const x of v)visit(x,"",depth+1);return;}if(typeof v!=="object")return;
    const sym=String(v?.tokenSymbol||v?.symbol||v?.token?.symbol||hint||"").toUpperCase(); const amount=v?.balance??v?.amount??v?.available??v?.spendable??v?.balanceUsd;
    if(sym&&amount!=null){
      let usd=num(v?.usd??v?.valueUsd??v?.balanceUsd);
      if(!(usd>0) && (normalizeSymbol(sym)==="USDC" || normalizeSymbol(sym)==="USDT")){
        try { usd=Number(typeof amount==="bigint"?amount:BigInt(String(amount)))/1e6; } catch(_) { usd=0; }
      }
      out.push({symbol:sym,amount,usd});
    }
    for(const [k,x] of Object.entries(v))visit(x,k,depth+1);
  }; visit(raw); return out;
}
function chooseCollateral(markets, symbol, rawBalances){
  const wanted=normalizeSymbol(symbol); const br=balanceRows(rawBalances);
  for(const pref of ["USDC","USDT"]){
    const b=br.find(x=>normalizeSymbol(x.symbol)===pref && num(x.usd)>0);
    if(!b)continue;
    const market=(markets||[]).find(m=>normalizeSymbol(m?.indexTokenSymbol||m?.indexName||m?.symbol||m?.name)===wanted && !m?.isSpotOnly);
    if(market)return {symbol:pref,usd:num(b.usd),market};
  }
  return null;
}
async function liveBalanceUsd(sdk,account){
  const raw=await sdk.fetchWalletBalances({address:account}); const br=balanceRows(raw);
  const usdc=br.filter(x=>normalizeSymbol(x.symbol)==="USDC").reduce((s,x)=>s+num(x.usd),0);
  const usdt=br.filter(x=>normalizeSymbol(x.symbol)==="USDT").reduce((s,x)=>s+num(x.usd),0);
  return {raw,usdc,usdt,walletUsd:usdc+usdt};
}
async function allowanceOk(sdk,account,token,required){
  if(typeof sdk.fetchAllowances!=="function")return {ok:true,skipped:true};
  const raw=await sdk.fetchAllowances({address:account,spender:"router"});
  const visit=(v,hint="",depth=0)=>{if(depth>7||v==null)return null;if(Array.isArray(v)){for(const x of v){const z=visit(x,"",depth+1);if(z!==null)return z;}return null;}if(typeof v!=="object")return normalizeSymbol(hint)===normalizeSymbol(token)?toBigIntDecimal(v,0):null;
    const sym=String(v?.tokenSymbol||v?.symbol||v?.token?.symbol||hint||""); if(normalizeSymbol(sym)===normalizeSymbol(token)){for(const x of [v?.allowance,v?.amount,v?.value,v?.raw]){try{if(x!=null)return typeof x==="bigint"?x:BigInt(String(x));}catch(_){} }}
    for(const [k,x] of Object.entries(v)){const z=visit(x,k,depth+1);if(z!==null)return z;} return null;};
  const a=visit(raw); if(a===null)return {ok:false,reason:`ALLOWANCE_UNAVAILABLE:${token}`}; return {ok:a>=required,allowance:a};
}
function executionRequest(signal,market,account,collateral,notionalUsd,collateralUsd){
  const direction=signal.direction==="LONG"?"long":"short";
  const size=toBigIntDecimal(notionalUsd,30), collateralAmount=toBigIntDecimal(collateralUsd,6);
  const s1=toBigIntDecimal(notionalUsd*.4,30),s2=toBigIntDecimal(notionalUsd*.3,30),s3=toBigIntDecimal(notionalUsd*.3,30);
  return {kind:"increase",symbol:market.symbol||market.name,direction,orderType:"market",size,collateralToken:collateral,collateralToPay:{amount:collateralAmount,token:collateral},mode:"express",from:account,tpsl:[
    {type:"take-profit",triggerPrice:toBigIntDecimal(signal.tradePlan.tp1,30),size:s1},
    {type:"take-profit",triggerPrice:toBigIntDecimal(signal.tradePlan.tp2,30),size:s2},
    {type:"take-profit",triggerPrice:toBigIntDecimal(signal.tradePlan.tp3,30),size:s3},
    {type:"stop-loss",triggerPrice:toBigIntDecimal(signal.tradePlan.stopLoss,30),size}
  ]};
}
async function prepareSignDirectSubmit(sdk,signer,request){
  console.log("[GMX][EXEC] PREPARE_START");
  const prepared=await sdk.prepareOrder(request);
  console.log("[GMX][EXEC] PREPARE_OK",{requestId:prepared?.requestId||null,mode:prepared?.mode||null});
  console.log("[GMX][EXEC] SIGN_START");
  const signature=await sdk.signOrder(prepared,signer);
  console.log("[GMX][EXEC] SIGN_OK");
  const body={mode:prepared.mode,requestId:prepared.requestId,signature,from:request.from,idempotencyKey:prepared.idempotencyKey,eip712Data:{batchParams:prepared?.payload?.batchParams,relayParams:prepared?.payload?.relayParams}};
  if(!serializeBigIntsInObject)throw new Error("GMX_BIGINT_SERIALIZER_UNAVAILABLE");
  const encoded=serializeBigIntsInObject(body);
  const peers=CONFIG.API_PEERS; let last=null;
  console.log("[GMX][EXEC] SUBMIT_START_DIRECT",{requestId:prepared?.requestId||null});
  for(const base of peers){
    try{const r=await fetch(`${base}/orders/txns/submit`,{method:"POST",headers:{"content-type":"application/json",accept:"application/json"},body:JSON.stringify(encoded)});const text=await r.text();if(!r.ok){last=new Error(`GMX_SUBMIT_HTTP_${r.status}: ${text.slice(0,300)}`);continue;}let parsed=null;try{parsed=text?JSON.parse(text):null}catch(_){}console.log("[GMX][EXEC] SUBMIT_OK",{requestId:prepared?.requestId||null});return {requestId:prepared.requestId,status:parsed?.status||parsed?.order?.status||"submitted",response:parsed};}catch(e){last=e;}
  }
  throw last||new Error("GMX_DIRECT_SUBMIT_FAILED");
}
function buildPlan(symbol,analysis){
  const price=num(analysis.price),a=num(analysis.atr); if(!(price>0&&a>0))return null;
  const e=analysis.entries?.find(x=>["LONG","SHORT"].includes(x.direction)); if(!e)return null;
  const dir=e.direction, stopBase=dir==="LONG"?num(e.zone?.low):num(e.zone?.high),buffer=a*CONFIG.HYBRID_RISK.stopAtrBuffer;
  const stop=dir==="LONG"?stopBase-buffer:stopBase+buffer; const r=Math.max(Math.abs(price-stop),buffer); if(!(r>0))return null;
  const tp1=dir==="LONG"?price+r:price-r,tp2=dir==="LONG"?price+2*r:price-2*r,tp3=dir==="LONG"?price+3*r:price-3*r;
  const tier=e.tier||"NORMAL",mult=tier==="PRIME"?1:tier==="FAST"?.45:.75,allocation=CONFIG.HYBRID_RISK.capitalAllocation*mult;
  return {valid:true,entry:price,stopLoss:stop,tp1,tp2,tp3,atr:a,stopDistance:r,stopPercent:r/price*100,leverage:Math.max(CONFIG.HYBRID_RISK.minLeverage,Math.min(CONFIG.HYBRID_RISK.maxLeverage, e.trigger?.includes("RETEST")?7:5)),allocation,allocationPercent:allocation*100};
}
async function verifyLiveEntryPosition(sdk,account,symbol,direction){
  if(typeof sdk?.fetchPositionsInfo!=="function")return {verified:false,position:null};
  try{
    const positions=await sdk.fetchPositionsInfo({address:account});
    const wanted=normalizeSymbol(symbol), wantLong=String(direction).toUpperCase()==="LONG";
    const found=(Array.isArray(positions)?positions:[]).find(p=>normalizeSymbol(p?.indexName||p?.indexTokenSymbol||p?.symbol||p?.marketSymbol||"")===wanted&&Boolean(p?.isLong)===wantLong&&positionSizeUsd(p)>0);
    return {verified:Boolean(found),position:found||null};
  }catch(e){return {verified:false,position:null,error:safeError(e)};}
}
function balanceSummary(bal){
  if(!bal)return null;
  const rows=balanceRows(bal?.raw);const out={USDC:0,USDT:0,total:num(bal?.walletUsd)};
  for(const r of rows){const k=normalizeSymbol(r.symbol);if(k==="USDC"||k==="USDT")out[k]+=num(r.usd);}
  return out;
}

async function executeLiveSignal(signal,env,allowancePreflight){
  const stage=async(name,fn)=>{try{return await fn();}catch(e){e.executionStage=name;throw e;}};
  if(!executionEnabled(env))return {executed:false,mode:"SIGNAL",reason:"EXECUTION_DISABLED"};
  if(!signal?.tradePlan?.valid)throw new Error("INVALID_TRADE_PLAN");
  const {sdk,signer,account}=await stage("LIVE_CONTEXT",()=>liveContext(env));
  const markets=await stage("FETCH_MARKETS",()=>sdk.fetchMarkets());
  const bal=await stage("FETCH_WALLET_BALANCE",()=>liveBalanceUsd(sdk,account));
  if(!(bal.walletUsd>0))throw new Error("NO_USDC_OR_USDT_BALANCE");
  const collateral=chooseCollateral(markets,signal.symbol,bal.raw);
  if(!collateral)throw new Error(`NO_MATCHING_COLLATERAL_MARKET:${signal.symbol}`);
  let positions=[];
  if(typeof sdk.fetchPositions==="function")positions=await stage("FETCH_POSITIONS",()=>sdk.fetchPositions({address:account}));
  const openPositions=Array.isArray(positions)?positions.filter(p=>num(p?.sizeUsd??p?.size??p?.positionSizeUsd)>0):[];
  if(openPositions.length>=CONFIG.MAX_POSITIONS)throw new Error("MAX_OPEN_POSITIONS_REACHED");
  const engaged=openPositions.reduce((sum,p)=>sum+Math.abs(num(p?.sizeUsd??p?.notionalUsd??p?.positionSizeUsd)),0);
  const leverage=Math.max(1,num(signal.tradePlan.leverage,5));
  const allocation=Math.min(CONFIG.MAX_CAPITAL_ALLOCATION,Math.max(0.01,num(signal.tradePlan.allocation,.20)));
  const entry=num(signal.tradePlan.entry),stop=num(signal.tradePlan.stopLoss);
  const stopFraction=Math.abs(entry-stop)/Math.max(entry,1e-12);
  if(!(stopFraction>0))throw new Error("INVALID_STOP_DISTANCE");
  const maxCollateralByWallet=bal.walletUsd*allocation;
  const remainingCapital=Math.max(0,bal.walletUsd*CONFIG.MAX_TOTAL_CAPITAL_ALLOCATION-engaged);
  const collateralCap=Math.min(maxCollateralByWallet,remainingCapital,CONFIG.MAX_POSITION_NOTIONAL_USD/leverage);
  if(!(collateralCap>0))throw new Error("TOTAL_CAPITAL_CAP_REACHED");
  const riskCap=(bal.walletUsd*CONFIG.EXECUTION_MIN_WALLET_RISK)/stopFraction;
  const notionalUsd=Math.min(collateralCap*leverage,riskCap,CONFIG.MAX_POSITION_NOTIONAL_USD);
  if(!(notionalUsd>0))throw new Error("INVALID_POSITION_SIZE");
  const collateralUsd=notionalUsd/leverage;
  const required=await stage("BUILD_COLLATERAL_AMOUNT",async()=>toBigIntDecimal(collateralUsd,6));
  const pre=allowancePreflight||await stage("ALLOWANCE_PREFLIGHT",()=>allowanceOk(sdk,account,collateral.symbol,required));
  if(pre.ok===false)throw new Error(pre.reason||"INSUFFICIENT_GMX_ALLOWANCE");
  const req=executionRequest(signal,collateral.market,account,collateral.symbol,notionalUsd,collateralUsd);
  const submitted=await stage("GMX_PREPARE_SIGN_SUBMIT",()=>prepareSignDirectSubmit(sdk,signer,req));
  await new Promise(r=>setTimeout(r,900));
  const after=await liveBalanceUsd(sdk,account).catch(()=>null);
  const verification=await verifyLiveEntryPosition(sdk,account,signal.symbol,signal.direction);
  const beforeSummary=balanceSummary(bal), afterSummary=balanceSummary(after);
  return {executed:true,mode:"LIVE",account,symbol:signal.symbol,direction:signal.direction,score:signal.score,confidence:signal.confidence,longScore:signal.longScore,shortScore:signal.shortScore,trigger:signal.hybridSetup?.trigger,collateralToken:collateral.symbol,walletUsd:bal.walletUsd,walletBefore:beforeSummary,walletAfter:afterSummary,walletDelta:afterSummary?Number((afterSummary.total-beforeSummary.total).toFixed(6)):null,collateralUsd,notionalUsd,leverage,allocation,allocationPercent:allocation*100,requestId:submitted.requestId,status:submitted.status,entryPrice:entry,stopLoss:stop,tp1:signal.tradePlan.tp1,tp2:signal.tradePlan.tp2,tp3:signal.tradePlan.tp3,positionVerified:verification.verified,verificationError:verification.error||null};
}
function fmtPrice(v){
  const n=num(v);if(!(n>0))return "N/A";
  if(n>=1000)return n.toFixed(2);if(n>=1)return n.toFixed(4);if(n>=0.01)return n.toFixed(6);if(n>=0.0001)return n.toFixed(8);return n.toPrecision(8);
}
function fmtUsd(v){return Number.isFinite(num(v))?`$${num(v).toFixed(4)}`:"N/A";}
function signalTelegram(signal){
  const dir=String(signal?.direction||"UNKNOWN").toUpperCase(), icon=dir==="LONG"?"🟢":"🔴", s=signal?.hybridSetup||{};
  return [
    `${icon} ENTRY READY — ${dir}`,"━━━━━━━━━━━━━━━━━━",
    `🪙 ${telegramTextSafe(signal?.symbol)}`,
    `🔥 Score: ${num(signal?.score).toFixed(1)}/100`,
    `🟢 Long: ${num(signal?.longScore).toFixed(1)} | 🔴 Short: ${num(signal?.shortScore).toFixed(1)}`,
    `⚡ Confidence: ${num(signal?.confidence).toFixed(1)}%`,
    `🎯 Trigger: ${telegramTextSafe(s.trigger)}`,
    `💵 Entry: ${fmtPrice(signal?.tradePlan?.entry)}`,
    `🛑 Stop Loss: ${fmtPrice(signal?.tradePlan?.stopLoss)} (${num(signal?.hybridSetup?.stopPercent).toFixed(2)}%)`,
    `🎯 TP1: ${fmtPrice(signal?.tradePlan?.tp1)}  •  40%`,
    `🎯 TP2: ${fmtPrice(signal?.tradePlan?.tp2)}  •  30%`,
    `🎯 TP3: ${fmtPrice(signal?.tradePlan?.tp3)}  •  30%`,
    `📐 Zone: ${telegramTextSafe(s.zoneType)} | Quality: ${num(s.zone?.quality).toFixed(1)}`,
    `📏 Entry distance: ${num(s.entryDistanceAtr).toFixed(2)} ATR`,
    `💧 Smart Money: ${num(s.flow?.imbalance).toFixed(3)} | Large: ${num(s.flow?.largeTradeCount)} | Suspicious: ${num(s.flow?.suspiciousWalletCount)}`,
    `⚡ RSI: ${num(s.fastIndicators?.rsi).toFixed(1)} | ROC: ${num(s.fastIndicators?.rocPct).toFixed(2)}% | Range: ${num(s.fastIndicators?.rangeRatio).toFixed(2)}x`,
    `💼 Allocation: ${num(signal?.tradePlan?.allocationPercent).toFixed(2)}% | Leverage: ${num(signal?.tradePlan?.leverage).toFixed(1)}x`,
    `🧠 Evidence: ${telegramTextSafe((signal?.diagnostics||[]).slice(0,6).join(", "))}`
  ].join("\n");
}
function executionTelegram(signal,result,error){
  const dir=String(result?.direction||signal?.direction||"UNKNOWN").toUpperCase(), icon=dir==="LONG"?"🟢":"🔴";
  if(error){
    const ctx=error?.executionContext||{};
    return [`❌ LIVE ENTRY FAILED — ${dir}`,"━━━━━━━━━━━━━━━━━━",`🪙 ${telegramTextSafe(signal?.symbol)}`,`📊 Score: ${num(signal?.score).toFixed(1)} | Long: ${num(signal?.longScore).toFixed(1)} | Short: ${num(signal?.shortScore).toFixed(1)}`,`💰 Wallet BEFORE: ${ctx.walletBeforeUsd!=null?fmtUsd(ctx.walletBeforeUsd):"N/A"}`,`🔧 Failed stage: ${telegramTextSafe(error?.executionStage||"EXECUTION")}`,`🚫 Exact reason: ${telegramTextSafe(safeError(error))}`,`🛡️ Entry sent: NO`,`ℹ️ No position was counted as executed.`].join("\n");
  }
  const wb=result?.walletBefore||{},wa=result?.walletAfter||{};
  return [`${icon} LIVE ENTRY — ${dir}`,"━━━━━━━━━━━━━━━━━━",`🪙 ${telegramTextSafe(result?.symbol)}`,`🔥 Score: ${num(result?.score).toFixed(1)} | Confidence: ${num(result?.confidence).toFixed(1)}%`,`💵 Entry: ${fmtPrice(result?.entryPrice)}`,`🛑 Stop Loss: ${fmtPrice(result?.stopLoss)}`,`🎯 TP1: ${fmtPrice(result?.tp1)}  • 40%`,`🎯 TP2: ${fmtPrice(result?.tp2)}  • 30%`,`🎯 TP3: ${fmtPrice(result?.tp3)}  • 30%`,`📦 Notional: ${fmtUsd(result?.notionalUsd)} | Collateral: ${fmtUsd(result?.collateralUsd)} ${telegramTextSafe(result?.collateralToken)}`,`⚙️ Leverage: ${num(result?.leverage).toFixed(1)}x | Allocation: ${num(result?.allocationPercent).toFixed(2)}%`,`💰 Wallet BEFORE: ${fmtUsd(wb.total)}`,`💰 Wallet AFTER: ${wa?fmtUsd(wa.total):"PENDING"}`,`📉 Wallet Δ: ${result?.walletDelta!=null?fmtUsd(result.walletDelta):"PENDING"}`,`🧾 Request ID: ${telegramTextSafe(result?.requestId)}`,result?.positionVerified?"✅ GMX POSITION VERIFIED":"🟡 ORDER SUBMITTED — POSITION VERIFICATION PENDING"].join("\n");
}
function blockedTelegram(signal,reason){
  const dir=String(signal?.direction||"UNKNOWN").toUpperCase();
  return [`🟠 NO ENTRY — ${telegramTextSafe(signal?.symbol)} ${dir}`,"━━━━━━━━━━━━━━━━━━",`⭐ Score: ${num(signal?.score).toFixed(1)} | Long: ${num(signal?.longScore).toFixed(1)} | Short: ${num(signal?.shortScore).toFixed(1)}`,`🚫 Reason: ${telegramTextSafe(reason)}`,`📍 Trigger: ${telegramTextSafe(signal?.hybridSetup?.trigger)}`,`💵 Entry: ${fmtPrice(signal?.tradePlan?.entry)}`,`🛑 SL: ${fmtPrice(signal?.tradePlan?.stopLoss)}`,`🎯 TP1/2/3: ${fmtPrice(signal?.tradePlan?.tp1)} / ${fmtPrice(signal?.tradePlan?.tp2)} / ${fmtPrice(signal?.tradePlan?.tp3)}`].join("\n");
}
function cycleTelegram(result){
  const reasons=[];
  if(!num(result?.scanned))reasons.push("NO_MARKETS_DISCOVERED");
  if(num(result?.scanned)&&!num(result?.deepScanned))reasons.push(`NO_5M_DATA_READY (${num(result?.eventStats?.data5mFailed)} failed)`);
  if(!num(result?.signals)&&num(result?.deepScanned))reasons.push("NO_VALID_ENTRY_SETUP_AFTER_5M_SR_FAST_ANALYSIS");
  if(num(result?.signals)&&!num(result?.executed)&&num(result?.failures))reasons.push("LIVE_EXECUTION_FAILED — SEE FAILURE MESSAGE ABOVE");
  if(num(result?.signals)&&num(result?.executed))reasons.push("TRADE EXECUTED/SUBMITTED");
  return [`🤖 GMX BOT — CYCLE REPORT`,`━━━━━━━━━━━━━━━━━━`,`📡 Status: ${telegramTextSafe(result?.status)}`,`🌐 Markets: ${num(result?.scanned)} | 5m analyzed: ${num(result?.deepScanned)}`,`🎯 Entry-ready: ${num(result?.entryReady)} | Executed: ${num(result?.executed)} | Failed: ${num(result?.failures)}`,`🧠 Smart Money: ${result?.smartMoney?.available?"LIVE":"UNAVAILABLE"} | Large: ${num(result?.smartMoney?.largeTrades)} | Suspicious: ${num(result?.smartMoney?.suspiciousWallets)}`,`📊 5m OK: ${num(result?.eventStats?.data5mReady)} | 5m Failed: ${num(result?.eventStats?.data5mFailed)} | 15m Optional Failed: ${num(result?.optional15mFailed)}`,`🛡️ Position cap: 20% | Total cap: 60% | Max positions: 3`,`📝 Result: ${telegramTextSafe(reasons.join(" | ")||"WATCHING")}`].join("\n");
}
async function sendTelegram(env,message){
  if(!CONFIG.TELEGRAM_ENABLED||!env.TELEGRAM_TOKEN||!env.TELEGRAM_CHAT_ID)return {ok:false,reason:"TELEGRAM_NOT_CONFIGURED"};
  const r=await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({chat_id:env.TELEGRAM_CHAT_ID,text:String(message).slice(0,3900)})});
  let data=null;try{data=await r.json()}catch(_){} return {ok:r.ok&&data?.ok!==false,reason:r.ok?"SENT":`HTTP_${r.status}`};
}
function rankMarkets(markets){
  return markets.map(m=>({m,symbol:marketSymbol(m),price:marketPrice(m)})).filter(x=>x.symbol&&x.price>0).sort((a,b)=>Math.abs(num(b.m?.priceChange5m??b.m?.change5m))-Math.abs(num(a.m?.priceChange5m??a.m?.change5m)));
}

function normalizeGmxUsd(v){
  if(typeof v==='bigint')return Number(v)/1e30;
  const n=num(v);
  if(n>=1e18)return n/1e30;
  return n;
}
function positionDirection(p){return p?.isLong===true||String(p?.direction||p?.side||'').toLowerCase()==='long'?'LONG':'SHORT';}
function positionSizeUsd(p){return normalizeGmxUsd(p?.sizeInUsd??p?.sizeUsd??p?.positionSizeUsd??p?.size);}
function positionEntryPrice(p){return normalizeGmxUsd(p?.entryPrice??p?.entryPriceUsd??p?.averagePrice??p?.entryPrice30);}
function positionSymbol(p){return normalizeSymbol(p?.indexName||p?.indexTokenSymbol||p?.symbol||p?.marketSymbol||'');}
function orderTrigger(o){return normalizeGmxUsd(o?.triggerPrice??o?.triggerPriceUsd??o?.price);}
function orderKey(o){return o?.key||o?.orderKey||o?.id||null;}
function isTpOrder(o){const t=String(o?.orderType||o?.type||o?.orderTypeString||o?.eventName||'').toLowerCase();return Boolean(o?.isTakeProfit)||t.includes('take-profit')||t.includes('take_profit')||t==='takeprofit';}
function isSlOrder(o){const t=String(o?.orderType||o?.type||o?.orderTypeString||o?.eventName||'').toLowerCase();return Boolean(o?.isStopLoss)||t.includes('stop-loss')||t.includes('stop_loss')||t==='stoploss';}
function favorableHit(direction,price,target){return direction==='LONG'?price>=target:price<=target;}
function smartDynamicStop(position,price,atr,tpLevel,stage){
  const dir=positionDirection(position),entry=positionEntryPrice(position),a=Math.max(atr,entry*0.0025),buffer=a*(stage>=2?0.18:0.28);
  const candidate=stage>=2?(dir==='LONG'?Math.max(entry,tpLevel-buffer):Math.min(entry,tpLevel+buffer)):(dir==='LONG'?Math.max(entry,entry+a*0.10):Math.min(entry,entry-a*0.10));
  return Number(candidate.toFixed(8));
}
async function editStopOrder(sdk,signer,account,orderId,newTrigger){
  const prepared=await sdk.prepareEditOrder({orderIds:[orderId],newTriggerPrice:toBigIntDecimal(newTrigger,30),mode:'express',from:account});
  const signature=await sdk.signOrder(prepared,signer);
  const body={mode:prepared.mode,requestId:prepared.requestId,signature,from:account,idempotencyKey:prepared.idempotencyKey,eip712Data:{batchParams:prepared?.payload?.batchParams,relayParams:prepared?.payload?.relayParams}};
  const encoded=serializeBigIntsInObject(body);let last=null;
  for(const base of CONFIG.API_PEERS){try{const r=await fetch(`${base}/orders/txns/submit`,{method:'POST',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify(encoded)});const text=await r.text();if(!r.ok){last=new Error(`GMX_EDIT_HTTP_${r.status}: ${text.slice(0,240)}`);continue;}const parsed=text?JSON.parse(text):{};return {requestId:parsed?.requestId||prepared.requestId,status:parsed?.status||'submitted'};}catch(e){last=e;}}
  throw last||new Error('GMX_EDIT_STOP_FAILED');
}
async function monitorOpenPositions(env){
  if(!executionEnabled(env)||!loadSdk())return {checked:0,protected:0,exits:0};
  try{
    const {sdk,signer,account}=await liveContext(env);
    if(typeof sdk.fetchPositionsInfo!=='function')return {checked:0,protected:0,exits:0};
    const positions=await sdk.fetchPositionsInfo({address:account,includeRelatedOrders:true});
    const active=(Array.isArray(positions)?positions:[]).filter(p=>positionSizeUsd(p)>0);
    if(!active.length)return {checked:0,protected:0,exits:0};
    const symbols=[...new Set(active.map(positionSymbol).filter(Boolean))];
    const tickers=typeof sdk.fetchMarketsTickers==='function'?await sdk.fetchMarketsTickers({symbols:symbols.map(x=>`${x}/USD`)}).catch(()=>[]):[];
    const tickerBy={};for(const t of tickers||[]){const s=normalizeSymbol(t?.symbol||t?.indexName||t?.name||'');tickerBy[s]=t;}
    const flow=await fetchSmartMoneyFlow(sdk);let protectedCount=0,exits=0;
    for(const p of active){
      const symbol=positionSymbol(p),dir=positionDirection(p),entry=positionEntryPrice(p);if(!symbol||!entry)continue;
      const t=tickerBy[symbol],price=normalizeGmxUsd(t?.maxPrice??t?.minPrice??t?.price??t?.markPrice);if(!(price>0))continue;
      const orders=Array.isArray(p?.relatedOrders)?p.relatedOrders:Array.isArray(p?.orders)?p.orders:[];
      const tpOrders=orders.filter(isTpOrder).map(o=>({...o,trigger:orderTrigger(o)})).filter(o=>o.trigger>0).sort((a,b)=>dir==='LONG'?a.trigger-b.trigger:b.trigger-a.trigger);
      const sl=orders.find(isSlOrder),slTrigger=orderTrigger(sl);
      const hit=tpOrders.find(o=>favorableHit(dir,price,o.trigger));
      if(hit&&sl&&orderKey(sl)){
        const atr=Math.max(entry*0.0025,Math.abs(price-entry)*0.25),stage=tpOrders.length>=2?2:1,newStop=smartDynamicStop(p,price,atr,hit.trigger,stage);
        const better=dir==='LONG'?newStop>slTrigger:newStop<slTrigger;
        if(better){const edited=await editStopOrder(sdk,signer,account,orderKey(sl),newStop);protectedCount++;console.log('[EXIT][TP1_PROTECT]',{symbol,direction:dir,price,tpHit:hit.trigger,oldStop:slTrigger,newStop,status:edited.status});}
      }
      const sm=smartMoneyForSymbol(flow,symbol,dir),fast=fastIndicators(await fetchCandles(symbol,'5m').catch(()=>[]));
      const severeOutflow=Number(sm.aligned||0)<=-0.18&&Number(sm.suspiciousWalletCount||0)>0;
      const reversal=dir==='LONG'?(fast.bearish&&fast.rsi<45&&fast.macd<0):(fast.bullish&&fast.rsi>55&&fast.macd>0);
      if(severeOutflow&&reversal){
        console.warn('[EXIT][SMART_MONEY_OUTFLOW]',{symbol,direction:dir,price,aligned:sm.aligned,suspiciousWallets:sm.suspiciousWalletCount});
        // Protective partial exit: close 50% only when smart-money outflow and fast reversal agree.
        const size=positionSizeUsd(p),closeSize=toBigIntDecimal(size*0.5,30);
        if(closeSize>0&&typeof sdk.prepareOrder==='function'){
          const req={kind:'decrease',symbol:p?.indexName||`${symbol}/USD`,direction:dir.toLowerCase(),orderType:'market',size:closeSize,collateralToken:'USDC',receiveToken:'USDC',mode:'express',from:account};
          try{const submitted=await prepareSignDirectSubmit(sdk,signer,req);exits++;console.log('[EXIT][SMART_MONEY_PARTIAL]',{symbol,direction:dir,requestId:submitted.requestId,status:submitted.status});}catch(e){console.error('[EXIT][SMART_MONEY_PARTIAL_FAILED]',{symbol,error:safeError(e)});}
        }
      }
    }
    return {checked:active.length,protected:protectedCount,exits};
  }catch(e){console.error('[EXIT][MONITOR_ERROR]',safeError(e));return {checked:0,protected:0,exits:0,error:safeError(e)};}
}

async function runScan(env){
  const scanId=`scheduled-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;const started=Date.now();
  if(!loadSdk())throw new Error("GMX_SDK_UNAVAILABLE");
  const sdk=new GmxApiSdk({chainId:CONFIG.CHAIN_ID});
  const markets=await fetchMarkets(sdk);
  const tickers=await fetchAllTickers(sdk);
  const tickerBy={};for(const t of tickers){const sym=tickerSymbol(t);if(sym)tickerBy[sym]=tickerPrice(t);}
  const universe=markets.map(m=>{const symbol=marketSymbol(m);return {m,symbol,price:tickerBy[symbol]||marketPrice(m)};}).filter(x=>x.symbol&&x.price>0);
  console.log("[MARKETS][UNIVERSE]",{catalog:markets.length,tickers:tickers.length,universe:universe.length});
  const smartFlow=await fetchSmartMoneyFlow(sdk);
  const signals=[];let deepOk=0,deep5mFailed=0,optional15mFailed=0,eventCandidates=0;
  const eventStats={supportZones:0,resistanceZones:0,supportReactions:0,resistanceReactions:0,breakouts:0,waitingRetests:0,retestConfirmed:0,earlyImpulses:0,entryReady:0,data5mReady:0,data5mFailed:0,data15mReady:0,data15mFailed:0,smartMoneySymbols:Object.keys(smartFlow.bySymbol||{}).length,suspiciousWallets:smartFlow.suspiciousWalletCount||0};
  // Every active market receives a 5m pass. 15m is optional context only; 1h/4h are intentionally absent.
  for(let i=0;i<universe.length;i+=CONFIG.BROAD_5M_BATCH){
    const batch=universe.slice(i,i+CONFIG.BROAD_5M_BATCH);
    await Promise.all(batch.map(async row=>{
      try{
        const c5=await fetchCandles(row.symbol,"5m");eventStats.data5mReady++;
        let c15=[];try{c15=await fetchCandles(row.symbol,"15m");eventStats.data15mReady++;}catch(e){optional15mFailed++;eventStats.data15mFailed++;console.warn("[HYBRID][15M_OPTIONAL_FAIL]",{symbol:row.symbol,error:safeError(e)});}
        const price=num(c5.at(-1)?.close,row.price);const flow=smartFlow;const prev=stateCache.hybrid[row.symbol]||{};
        const analysis=hybridClassifyStructure(row.symbol,{"5m":c5,"15m":c15},price,flow,prev);analysis.price=price;analysis.candleTimestamp=c5.at(-1)?.timestamp||0;stateCache.hybrid[row.symbol]=analysis.nextState||prev;deepOk++;
        const ef=analysis.eventFlags||{};for(const [src,dst] of Object.entries({supportZone:"supportZones",resistanceZone:"resistanceZones",supportReaction:"supportReactions",resistanceReaction:"resistanceReactions",breakout:"breakouts",waitingRetest:"waitingRetests",retestConfirmed:"retestConfirmed"})){if(ef[src])eventStats[dst]++;}if(ef.supportReaction||ef.resistanceReaction||ef.breakout||ef.waitingRetest||ef.retestConfirmed)eventCandidates++;
        let setup=hybridBuildSetup(row.symbol,analysis,flow,null);
        const early=hybridEarlyImpulse(row.symbol,{"5m":c5},smartMoneyForSymbol(flow,row.symbol,analysis.direction||"LONG"),null);
        if(!setup&&early){const earlyAnalysis={...analysis,price:early.price,atr:early.atr,entries:[early],volume:early.volume,fastIndicators:fastIndicators(c5),candleTimestamp:early.candleTimestamp};setup=hybridBuildSetup(row.symbol,earlyAnalysis,flow,null);if(setup){setup.early=true;setup.earlyScore=early.earlyScore;setup.edge=early.edge;setup.trigger=early.trigger;setup.evidence=[...(setup.evidence||[]),...(early.evidence||[])];eventStats.earlyImpulses++;}}
        if(setup){eventStats.entryReady++;const scores={longScore:num(setup.longScore),shortScore:num(setup.shortScore)};signals.push({id:crypto.randomUUID(),symbol:setup.symbol,market:pairSymbol(setup.symbol),direction:setup.direction,status:"ENTRY_READY",score:num(setup.score,setup.earlyScore||0),confidence:num(setup.score,setup.earlyScore||0),...scores,edge:num(setup.edge,5),price:setup.entryPrice,tradePlan:{valid:true,entry:setup.entryPrice,stopLoss:setup.stopLoss,tp1:setup.tp1,tp2:setup.tp2,tp3:setup.tp3,leverage:setup.leverage,allocation:setup.allocation,allocationPercent:setup.allocationPercent},hybridSetup:setup,diagnostics:setup.evidence,generatedAt:Date.now(),executionEligible:true});}
        console.log("[HYBRID][MARKET]",{symbol:row.symbol,price,entryReady:Boolean(setup),state:analysis.state,smartMoney:smartMoneyForSymbol(flow,row.symbol,setup?.direction||analysis.direction||"LONG"),fast:{rsi:analysis.fastIndicators?.rsi,roc:analysis.fastIndicators?.rocPct,emaTrend:analysis.fastIndicators?.trend,rangeRatio:analysis.fastIndicators?.rangeRatio},support:analysis.zones?.support?.[0]?.center||null,resistance:analysis.zones?.resistance?.[0]?.center||null});
      }catch(e){deep5mFailed++;eventStats.data5mFailed++;console.error("[HYBRID][DATA_REJECT]",{symbol:row.symbol,stage:"5m",error:safeError(e)});}
    }));
  }
  signals.sort((a,b)=>hybridEventPriority(b)-hybridEventPriority(a));const selected=signals.slice(0,1),executionResults=[];
  if(signals.length) await sendTelegram(env,signalTelegram(selected[0]));
  for(const signal of signals.slice(1,6)) await sendTelegram(env,blockedTelegram(signal,"MAX_ENTRY_SLOT_PER_CYCLE — lower priority than selected opportunity"));
  for(const signal of selected){let preTradeWallet=null;try{const {sdk:liveSdk,account}=await liveContext(env);const bal=await liveBalanceUsd(liveSdk,account);preTradeWallet=bal.walletUsd;const marketsSdk=await liveSdk.fetchMarkets();const collateral=chooseCollateral(marketsSdk,signal.symbol,bal.raw);let pf={ok:false};if(collateral){try{pf=await allowanceOk(liveSdk,account,collateral.symbol,toBigIntDecimal(Math.max(0.000001,bal.walletUsd*num(signal.tradePlan.allocation,.2)),6));}catch(e){pf={ok:false,reason:safeError(e)}}}if(pf.ok===false){const err=new Error(pf.reason||"ALLOWANCE_PREFLIGHT_FAILED");err.executionStage="ALLOWANCE_PREFLIGHT";err.executionContext={walletBeforeUsd:preTradeWallet};throw err;}const result=await executeLiveSignal(signal,env,pf);executionResults.push(result);await sendTelegram(env,executionTelegram(signal,result,null));}catch(e){e.executionContext={...(e.executionContext||{}),walletBeforeUsd:preTradeWallet};executionResults.push({executed:false,symbol:signal.symbol,direction:signal.direction,error:safeError(e)});await sendTelegram(env,executionTelegram(signal,null,e));console.error("[TELEGRAM][EXECUTION_FAILURE]",{scanId,symbol:signal.symbol,reason:safeError(e)});}}
  const out={ok:true,status:signals.length?"ENTRY_READY":"WATCHING",scanId,scanned:universe.length,deepScanned:deepOk,signals:signals.length,entryReady:signals.length,executed:executionResults.filter(x=>x.executed).length,failures:executionResults.filter(x=>!x.executed).length,eventCandidates,eventStats,smartMoney:{available:smartFlow.available,symbols:Object.keys(smartFlow.bySymbol||{}).length,largeTrades:smartFlow.largeTradeCount,suspiciousWallets:smartFlow.suspiciousWalletCount,concentration:smartFlow.walletConcentration},optional15mFailed,durationMs:Date.now()-started};
  await sendTelegram(env,cycleTelegram(out));console.log("[HYBRID][SELECTION]",{scanId,candidates:signals.length,eligible:signals.length,selected:selected.length});console.log("[SCHEDULED][DONE]",out);return out;
}

async function scheduled(env={}){
  console.log("[RUNTIME][WORKER_IDENTITY]",{version:BOT_VERSION,build:BOT_BUILD,module:"worker_core.mjs",formatter:"safeFormatPrice"});
  const scanId=`scheduled-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  console.log("[GITHUB][START]",{worker:"worker_core.mjs",expectedVersion:BOT_VERSION,actualWorkerVersion:BOT_VERSION,build:BOT_BUILD,executionEnabled:String(env.EXECUTION_ENABLED??true),executionEnabledSource:"github-env"});
  console.log("[EXECUTION][RUNTIME]",{mode:executionEnabled(env)?"LIVE":"SIGNAL",sdkLoaded:loadSdk()});
  const exitMonitor=await monitorOpenPositions(env);
  console.log("[EXIT][MONITOR]",exitMonitor);
  const out=await runScan(env); return {...out,exitMonitor,scanId};
}

export default { scheduled };
export { scheduled, runScan, sendTelegram, executeLiveSignal };
