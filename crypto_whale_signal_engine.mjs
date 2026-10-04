'use strict';

import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * GLOBAL FUTURES TOP-TRADER & SIGNAL HUNTER
 * Futures-only | CEX + DEX | READ-ONLY | NO ORDERS
 *
 * Sources with built-in public adapters:
 *   - Hyperliquid
 *   - Binance Futures Leaderboard / Smart Money
 *   - OKX Futures Copy-Trading Lead Traders
 *
 * Additional exchanges are represented as optional adapters via environment URLs.
 * They are never treated as healthy unless their endpoint returns verifiable data.
 */

const VERSION = 'GFTSH-V1.0.0-GLOBAL-CEX-DEX-FUTURES-ONLY';
const STATE_FILE = process.env.GLOBAL_STATE_FILE || 'state/global_futures_hunter.json';
const CACHE_FILE = process.env.GLOBAL_CACHE_FILE || 'state/global_futures_cache.json';
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const TG_LIMIT = 3900;
const LOOKBACK_DAYS = Number(process.env.GLOBAL_LOOKBACK_DAYS || 7);
const MAX_DISCOVERED_PER_SOURCE = Number(process.env.GLOBAL_MAX_DISCOVERED_PER_SOURCE || 100);
const MAX_VERIFY_PER_SOURCE = Number(process.env.GLOBAL_MAX_VERIFY_PER_SOURCE || 25);
const TOP_SIGNALS = Number(process.env.GLOBAL_TOP_SIGNALS || 10);
const CACHE_TTL_MIN = Number(process.env.GLOBAL_CACHE_TTL_MIN || 60);
const POSITION_FRESH_MIN = Number(process.env.GLOBAL_POSITION_FRESH_MIN || 15);
const MAX_ENTRY_DISTANCE_PCT = Number(process.env.GLOBAL_MAX_ENTRY_DISTANCE_PCT || 0.5);
const MIN_TRADES_7D = Number(process.env.GLOBAL_MIN_TRADES_7D || 30);
const MIN_ACTIVE_DAYS = Number(process.env.GLOBAL_MIN_ACTIVE_DAYS || 4);
const MIN_WR = Number(process.env.GLOBAL_MIN_WR || 55);
const MIN_PF = Number(process.env.GLOBAL_MIN_PF || 1.5);
const MIN_MEDIAN_HOLD_H = Number(process.env.GLOBAL_MIN_MEDIAN_HOLD_H || 0);
const MAX_MEDIAN_HOLD_H = Number(process.env.GLOBAL_MAX_MEDIAN_HOLD_H || 4);
const MAX_AVG_HOLD_H = Number(process.env.GLOBAL_MAX_AVG_HOLD_H || 8);
const MIN_RR = Number(process.env.GLOBAL_MIN_RR || 1.5);
const MAX_DD = Number(process.env.GLOBAL_MAX_DD || 40);
const FETCH_TIMEOUT_MS = Number(process.env.GLOBAL_FETCH_TIMEOUT_MS || 12000);
const HL_URL = process.env.HYPERLIQUID_API_URL || 'https://api.hyperliquid.xyz/info';
const BINANCE_RANK_URL = process.env.BINANCE_LEADERBOARD_RANK_URL || 'https://www.binance.com/bapi/futures/v3/public/future/leaderboard/getLeaderboardRank';
const BINANCE_POS_URL = process.env.BINANCE_LEADERBOARD_POSITION_URL || 'https://www.binance.com/bapi/futures/v1/public/future/leaderboard/getOtherPosition';
const OKX_URL = process.env.OKX_API_URL || 'https://www.okx.com';

const OPTIONAL_SOURCES = {
  BYBIT: process.env.BYBIT_LEADERBOARD_URL || '',
  BITGET: process.env.BITGET_LEADERBOARD_URL || '',
  KUCOIN: process.env.KUCOIN_LEADERBOARD_URL || '',
  GATE: process.env.GATE_LEADERBOARD_URL || '',
  MEXC: process.env.MEXC_LEADERBOARD_URL || '',
  PHEMEX: process.env.PHEMEX_LEADERBOARD_URL || '',
  BINGX: process.env.BINGX_LEADERBOARD_URL || '',
  COINEX: process.env.COINEX_LEADERBOARD_URL || '',
  DYDX: process.env.DYDX_LEADERBOARD_URL || '',
  PARADEX: process.env.PARADEX_LEADERBOARD_URL || '',
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
const num = v => { const x = Number(v); return Number.isFinite(x) ? x : null; };
const str = v => v == null ? '' : String(v);
const now = () => Date.now();
const pct = (v, d=2) => num(v) == null ? '—' : `${num(v).toFixed(d)}%`;
const usd = (v, d=0) => num(v) == null ? '—' : `$${num(v).toLocaleString('en-US',{maximumFractionDigits:d})}`;
const hours = v => num(v) == null ? '—' : `${num(v).toFixed(1)}h`;
const short = v => { const s=str(v); return s.length>18 ? `${s.slice(0,8)}…${s.slice(-6)}` : s; };

async function ensureDir(file){ await fs.mkdir(path.dirname(file), {recursive:true}); }
async function readJson(file, fallback){ try{return JSON.parse(await fs.readFile(file,'utf8'));}catch{return fallback;} }
async function writeJson(file, value){ await ensureDir(file); await fs.writeFile(file, JSON.stringify(value,null,2)); }

async function fetchJson(url, options={}, label='http'){
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), FETCH_TIMEOUT_MS);
  try{
    const res = await fetch(url, {...options, signal:controller.signal, headers:{accept:'application/json',...(options.headers||{})}});
    const text = await res.text();
    if(!res.ok) throw new Error(`${label}:HTTP_${res.status}:${text.slice(0,180)}`);
    try{return JSON.parse(text);}catch{throw new Error(`${label}:INVALID_JSON`);}
  }finally{clearTimeout(timer);}
}

function arr(v){
  if(Array.isArray(v)) return v;
  if(v && Array.isArray(v.data)) return v.data;
  if(v && Array.isArray(v.rows)) return v.rows;
  if(v && Array.isArray(v.list)) return v.list;
  if(v && Array.isArray(v.data?.list)) return v.data.list;
  return [];
}

function first(o, keys){
  for(const k of keys){
    const v = o?.[k];
    if(v !== undefined && v !== null && v !== '') return v;
  }
  return null;
}

function normalizeTrader(x, source){
  const metrics = {
    pnl7d: num(first(x,['pnl7d','pnl','profit','profitAndLoss','totalPnl','profitLoss','pnlValue'])),
    roi7d: num(first(x,['roi7d','roi','returnRate','roiRate','rate'])),
    winRate: num(first(x,['winRate','win_rate','winRatio','profitRate'])),
    trades7d: num(first(x,['trades7d','tradeCount','totalTrades','closedTrades','positionCount'])),
    activeDays: num(first(x,['activeDays','tradingDays','daysTrading','tradeDays'])),
    maxDD: num(first(x,['maxDrawdown','mdd','maxDD','drawdown'])),
    pf: num(first(x,['profitFactor','pf'])),
    avgHoldH: num(first(x,['avgHoldHours','averageHoldHours','avgHoldingHours'])),
    medianHoldH: num(first(x,['medianHoldHours','medianHoldingHours'])),
    sharpe: num(first(x,['sharpe','sharpeRatio'])),
  };
  const id = str(first(x,['address','wallet','walletAddress','uniqueCode','encryptedUid','futureUid','traderId','uid','id','accountId']));
  return {
    source,
    venue: source,
    id,
    name: str(first(x,['nickName','nickname','name','alias','userName','displayName'])) || short(id),
    profile: str(first(x,['profile','profileUrl','url'])),
    encryptedUid: str(x?.encryptedUid || ''),
    uniqueCode: str(x?.uniqueCode || ''),
    raw: x,
    metrics
  };
}

function mergeMetric(a,b){
  if(a!=null) return a; return b;
}
function mergeTrader(a,b){
  const out={...a,...b,metrics:{...a.metrics}};
  for(const k of Object.keys(out.metrics)) out.metrics[k]=mergeMetric(a.metrics?.[k],b.metrics?.[k]);
  for(const k of ['encryptedUid','uniqueCode','profile','name']) if(!out[k] && b[k]) out[k]=b[k];
  return out;
}

function windowPerf(row, names=['week','7d','7D']){
  const wp=Array.isArray(row?.windowPerformances)?row.windowPerformances:[];
  for(const name of names){
    const hit=wp.find(x=>Array.isArray(x)&&String(x[0]).toLowerCase()===name.toLowerCase());
    if(hit?.[1]) return hit[1];
  }
  return null;
}

async function discoverHyperliquid(){
  try{
    const statsUrl=process.env.HYPERLIQUID_LEADERBOARD_URL || 'https://stats-data.hyperliquid.xyz/Mainnet/leaderboard';
    const data=await fetchJson(statsUrl,{},'hyperliquid:leaderboard');
    const rows=arr(data?.leaderboardRows||data);
    const out=[];
    for(const r of rows){
      const perf=windowPerf(r);
      const x=normalizeTrader({...r, address:r.ethAddress, pnl7d:perf?.pnl, roi7d:perf?.roi!=null?Number(perf.roi)*100:null},'HYPERLIQUID');
      if(x.id) out.push(x);
    }
    out.sort((a,b)=>(b.metrics.pnl7d??-Infinity)-(a.metrics.pnl7d??-Infinity));
    return {source:'HYPERLIQUID',ok:true,rows:out.slice(0,MAX_DISCOVERED_PER_SOURCE)};
  }catch(e){return {source:'HYPERLIQUID',ok:false,error:e.message,rows:[]};}
}

async function discoverBinance(){
  try{
    const body={isShared:true,isTrader:true,periodType:'WEEKLY',statisticsType:'PNL',tradeType:'PERPETUAL'};
    const data=await fetchJson(BINANCE_RANK_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)},'binance:leaderboard');
    const rows=arr(data);
    const out=[];
    for(const r of rows.slice(0,MAX_DISCOVERED_PER_SOURCE)){
      const x=normalizeTrader(r,'BINANCE');
      if(x.id || x.encryptedUid) out.push(x);
    }
    return {source:'BINANCE',ok:true,rows:out};
  }catch(e){return {source:'BINANCE',ok:false,error:e.message,rows:[]};}
}

async function discoverOKX(){
  try{
    const u=`${OKX_URL.replace(/\/$/,'')}/api/v5/copytrading/public-lead-traders?instType=SWAP`;
    const data=await fetchJson(u,{},'okx:lead-traders');
    const rows=arr(data);
    const out=[];
    for(const r of rows.slice(0,MAX_DISCOVERED_PER_SOURCE)){
      const x=normalizeTrader(r,'OKX');
      if(x.id || x.uniqueCode) out.push(x);
    }
    return {source:'OKX',ok:true,rows:out};
  }catch(e){return {source:'OKX',ok:false,error:e.message,rows:[]};}
}

async function discoverOptional(name,url){
  if(!url) return {source:name,ok:false,disabled:true,rows:[]};
  try{
    const data=await fetchJson(url,{},`${name}:leaderboard`);
    const rows=arr(data);
    const out=rows.slice(0,MAX_DISCOVERED_PER_SOURCE).map(r=>normalizeTrader(r,name)).filter(x=>x.id);
    return {source:name,ok:true,rows:out};
  }catch(e){return {source:name,ok:false,error:e.message,rows:[]};}
}

async function hlFillStats(address){
  try{
    const fills=await fetchJson(HL_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'userFills',user:address})},'hyperliquid:fills');
    const rows=Array.isArray(fills)?fills:[];
    const cutoff=now()-LOOKBACK_DAYS*86400000;
    const recent=rows.filter(f=>num(f?.time)>=cutoff);
    const closed=recent.filter(f=>num(f?.closedPnl)!=null && Math.abs(num(f.closedPnl))>1e-12);
    if(!closed.length) return {};
    const wins=closed.filter(f=>num(f.closedPnl)>0);
    const losses=closed.filter(f=>num(f.closedPnl)<0);
    const grossWin=wins.reduce((a,f)=>a+num(f.closedPnl),0);
    const grossLoss=Math.abs(losses.reduce((a,f)=>a+num(f.closedPnl),0));
    const days=new Set(closed.map(f=>new Date(num(f.time)).toISOString().slice(0,10)));
    const byCoin=new Map();
    for(const f of recent){
      const coin=str(f.coin); if(!coin) continue;
      if(!byCoin.has(coin)) byCoin.set(coin,[]);
      byCoin.get(coin).push(f);
    }
    const holds=[];
    for(const fs of byCoin.values()){
      fs.sort((a,b)=>num(a.time)-num(b.time));
      const opens=[];
      for(const f of fs){
        const dir=str(f.dir).toLowerCase();
        const isOpen=dir.includes('open');
        const isClose=dir.includes('close');
        if(isOpen) opens.push(num(f.time));
        else if(isClose && opens.length){
          const ot=opens.shift(); const h=(num(f.time)-ot)/3600000;
          if(h>=0 && h<=168) holds.push(h);
        }
      }
    }
    holds.sort((a,b)=>a-b);
    const medianHoldH=holds.length ? (holds.length%2?holds[(holds.length-1)/2]:(holds[holds.length/2-1]+holds[holds.length/2])/2) : null;
    const avgHoldH=holds.length ? holds.reduce((a,b)=>a+b,0)/holds.length : null;
    return {trades7d:closed.length,winRate:wins.length/closed.length*100,pf:grossLoss>0?grossWin/grossLoss:null,activeDays:days.size,medianHoldH,avgHoldH};
  }catch(e){return {};}
}

async function hlPositions(trader){
  const address=trader.id;
  if(!/^0x[0-9a-fA-F]{20,}$/.test(address)) return [];
  try{
    const data=await fetchJson(HL_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'clearinghouseState',user:address})},'hyperliquid:positions');
    const p=data?.assetPositions || [];
    return p.map(z=>z?.position||z).filter(z=>num(z?.szi)!==0).map(z=>({
      symbol:str(z.coin), side:num(z.szi)>0?'LONG':'SHORT', qty:Math.abs(num(z.szi)),
      entry:num(z.entryPx), mark:num(z.positionValue)/Math.abs(num(z.szi)) || null,
      unrealized:num(z.unrealizedPnl), leverage:num(z.leverage?.value),
      openedAt:null, lastActivityAt:null, source:'HYPERLIQUID'
    }));
  }catch(e){return [];}
}

async function binancePositions(trader){
  const encryptedUid=trader.encryptedUid || trader.id;
  if(!encryptedUid) return [];
  try{
    const data=await fetchJson(BINANCE_POS_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({encryptedUid})},'binance:positions');
    const rows=arr(data);
    return rows.map(z=>({
      symbol:str(first(z,['symbol','pair','ticker'])), side:str(first(z,['positionSide','side','direction'])).toUpperCase().includes('SHORT')?'SHORT':'LONG',
      qty:Math.abs(num(first(z,['positionAmt','amount','qty','position']))||0),
      entry:num(first(z,['entryPrice','avgPrice','openAvgPx'])), mark:num(first(z,['markPrice','markPx','currentPrice'])),
      unrealized:num(first(z,['unRealizedProfit','unrealizedPnl','upl'])), leverage:num(first(z,['leverage'])),
      openedAt:num(first(z,['openTime','openTimestamp','ctime'])), lastActivityAt:num(first(z,['updateTime','utime','time'])), source:'BINANCE'
    })).filter(z=>z.symbol && (z.qty>0 || z.entry!=null));
  }catch(e){return [];}
}

async function okxPositions(trader){
  const code=trader.uniqueCode || trader.id;
  if(!code) return [];
  try{
    const u=`${OKX_URL.replace(/\/$/,'')}/api/v5/copytrading/public-current-subpositions?instType=SWAP&uniqueCode=${encodeURIComponent(code)}`;
    const data=await fetchJson(u,{},'okx:positions');
    const rows=arr(data);
    return rows.map(z=>({
      symbol:str(first(z,['instId','instIdCode','symbol'])), side:str(first(z,['posSide','side','direction'])).toUpperCase().includes('SHORT')?'SHORT':'LONG',
      qty:Math.abs(num(first(z,['subPos','pos','sz','quantity']))||0), entry:num(first(z,['openAvgPx','avgPx','entryPx'])),
      mark:num(first(z,['markPx','markPrice'])), unrealized:num(first(z,['upl','unrealizedPnl'])), leverage:num(first(z,['lever','leverage'])),
      openedAt:num(first(z,['openTime','ctime'])), lastActivityAt:num(first(z,['updateTime','utime'])), source:'OKX'
    })).filter(z=>z.symbol && (z.qty>0 || z.entry!=null));
  }catch(e){return [];}
}

function estimateStats(t){
  const m=t.metrics||{};
  const trades=m.trades7d;
  const wr=m.winRate;
  const pf=m.pf;
  const dd=m.maxDD;
  const active=m.activeDays;
  const scoreParts=[];
  if(wr!=null) scoreParts.push(Math.min(25,Math.max(0,(wr-50)*0.5)));
  if(pf!=null) scoreParts.push(Math.min(25,Math.max(0,(pf-1)*10)));
  if(trades!=null) scoreParts.push(Math.min(15,trades/4));
  if(active!=null) scoreParts.push(Math.min(10,active*1.5));
  if(dd!=null) scoreParts.push(Math.max(0,10-dd/5));
  if(m.sharpe!=null) scoreParts.push(Math.min(10,Math.max(0,m.sharpe*3)));
  return scoreParts.reduce((a,b)=>a+b,0);
}

function qualityGate(t){
  const m=t.metrics||{}; const r=[];
  if(m.trades7d==null) r.push('MISSING_7D_TRADES'); else if(m.trades7d<MIN_TRADES_7D) r.push(`TRADES_7D<${MIN_TRADES_7D}`);
  if(m.activeDays==null) r.push('MISSING_ACTIVE_DAYS'); else if(m.activeDays<MIN_ACTIVE_DAYS) r.push(`ACTIVE_DAYS<${MIN_ACTIVE_DAYS}`);
  if(m.winRate==null) r.push('MISSING_WR'); else if(m.winRate<MIN_WR) r.push(`WR<${MIN_WR}%`);
  if(m.pf==null) r.push('MISSING_PF'); else if(m.pf<MIN_PF) r.push(`PF<${MIN_PF}`);
  if(m.maxDD!=null && Math.abs(m.maxDD)>MAX_DD) r.push(`DD>${MAX_DD}%`);
  if(m.medianHoldH!=null && m.medianHoldH>MAX_MEDIAN_HOLD_H) r.push(`MEDIAN_HOLD>${MAX_MEDIAN_HOLD_H}H`);
  if(m.avgHoldH!=null && m.avgHoldH>MAX_AVG_HOLD_H) r.push(`AVG_HOLD>${MAX_AVG_HOLD_H}H`);
  if(m.pnl7d!=null && m.pnl7d<=0) r.push('PNL<=0');
  return r;
}

function currentSignal(t,positions){
  if(!positions.length) return null;
  let best=null;
  for(const p of positions){
    if(!(p.entry>0)) continue;
    const price=p.mark;
    const distance=price>0 ? Math.abs(price-p.entry)/p.entry*100 : null;
    const ageMs=p.lastActivityAt || p.openedAt ? now()-(p.lastActivityAt||p.openedAt) : null;
    const ageMin=ageMs!=null ? ageMs/60000 : null;
    if(distance!=null && distance>MAX_ENTRY_DISTANCE_PCT) continue;
    if(ageMin!=null && ageMin>POSITION_FRESH_MIN) continue;
    const riskPct=0.8;
    const rewardPct=Math.max(1.2,riskPct*2);
    const side=p.side;
    const sl=side==='LONG' ? p.entry*(1-riskPct/100) : p.entry*(1+riskPct/100);
    const tp=side==='LONG' ? p.entry*(1+rewardPct/100) : p.entry*(1-rewardPct/100);
    const rr=rewardPct/riskPct;
    const candidate={...p,distancePct:distance,ageMin,sl,tp,rr,signalReason:`${t.source} top-trader current ${side} position | ${distance==null?'entry distance unavailable':`entry distance ${distance.toFixed(2)}%`} | activity ${ageMin==null?'freshness unavailable':`${ageMin.toFixed(1)}m`}`};
    if(!best || (distance??999)<(best.distancePct??999)) best=candidate;
  }
  return best;
}

async function verifyTrader(t){
  let positions=[];
  let metrics={...t.metrics};
  if(t.source==='HYPERLIQUID'){
    positions=await hlPositions(t);
    metrics={...metrics,...(await hlFillStats(t.id))};
  } else if(t.source==='BINANCE') positions=await binancePositions(t);
  else if(t.source==='OKX') positions=await okxPositions(t);
  const enriched={...t,metrics};
  const gate=qualityGate(enriched);
  const signal=currentSignal(enriched,positions);
  return {...enriched,positions,qualityBlocks:gate,signal,verifiedAt:now(),copyabilityScore:Math.round(estimateStats(enriched)+(signal?25:0)-(gate.length*4))};
}

function dedupe(rows){
  const m=new Map();
  for(const r of rows){
    const key=`${r.source}:${r.id||r.uniqueCode||r.encryptedUid}`;
    m.set(key,m.has(key)?mergeTrader(m.get(key),r):r);
  }
  return [...m.values()];
}

function formatSignal(x,i){
  const s=x.signal, m=x.metrics;
  return [
    `#${i+1} ${x.source} | ${x.name}`,
    `Trader: ${short(x.id||x.uniqueCode||x.encryptedUid)}`,
    `Signal: ${s.side} ${s.symbol} | Entry ${s.entry??'—'} | SL ${s.sl?.toPrecision(8)??'—'} | TP ${s.tp?.toPrecision(8)??'—'} | RR ${s.rr.toFixed(2)}`,
    `Distance: ${pct(s.distancePct)} | Freshness: ${s.ageMin==null?'—':s.ageMin.toFixed(1)+'m'}`,
    `7D: trades ${m.trades7d??'—'} | WR ${pct(m.winRate,1)} | PF ${m.pf??'—'} | PnL ${usd(m.pnl7d)} | DD ${pct(m.maxDD,1)}`,
    `Hold: median ${hours(m.medianHoldH)} | avg ${hours(m.avgHoldH)} | Active days ${m.activeDays??'—'}`,
    `Reason: ${s.signalReason}`
  ].join('\n');
}

function sourceLine(r){
  if(r.disabled) return `${r.source}: DISABLED (no adapter URL)`;
  return `${r.source}: ${r.ok?'OK':'ERROR'}${r.error?' | '+r.error.slice(0,100):''} | discovered=${r.rows.length}`;
}

function buildTelegram({results,verified,signals,elapsed}){
  const lines=[
    `🌐 GLOBAL FUTURES TOP-TRADER & SIGNAL HUNTER`,
    `🧠 ${VERSION}`,
    `📡 READ-ONLY | NO ORDERS | FUTURES ONLY`,
    '━━━━━━━━━━━━━━━━━━',
    `🔎 Sources: ${results.filter(x=>x.ok).length}/${results.length} healthy | Traders discovered: ${results.reduce((n,x)=>n+x.rows.length,0)}`,
    `🛡️ Verified: ${verified.length} | Actionable signals: ${signals.length}/${TOP_SIGNALS}`,
    `🎯 Gate: 7D trades≥${MIN_TRADES_7D} | active days≥${MIN_ACTIVE_DAYS} | WR≥${MIN_WR}% | PF≥${MIN_PF} | median hold≤${MAX_MEDIAN_HOLD_H}h | avg hold≤${MAX_AVG_HOLD_H}h | DD≤${MAX_DD}%`,
    `⚡ Signal gate: fresh≤${POSITION_FRESH_MIN}m | entry distance≤${MAX_ENTRY_DISTANCE_PCT}% | RR≥${MIN_RR}`,
    `⏱ Runtime: ${elapsed.toFixed(1)}s`,
    ''
  ];
  lines.push('📡 SOURCE STATUS');
  for(const r of results) lines.push(sourceLine(r));
  lines.push('','🏆 TOP ACTIONABLE FUTURES SIGNALS');
  if(!signals.length) lines.push('No trader passed BOTH the statistical quality gate and current-position signal gate this cycle.');
  signals.forEach((x,i)=>lines.push('',formatSignal(x,i)));
  const blocked=verified.filter(x=>x.qualityBlocks?.length).slice(0,8);
  if(blocked.length){
    lines.push('','🧱 TOP BLOCKED TRADERS');
    for(const x of blocked) lines.push(`${x.source} ${x.name}: ${x.qualityBlocks.join(' | ')}`);
  }
  return lines.join('\n');
}

async function telegram(text){
  if(!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID){console.log('[TELEGRAM] credentials missing; report printed only');return;}
  for(let i=0;i<text.length;i+=TG_LIMIT){
    await fetchJson(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:TELEGRAM_CHAT_ID,text:text.slice(i,i+TG_LIMIT),disable_web_page_preview:true})},'telegram');
  }
}

async function main(){
  const t0=now();
  console.log(`========================================`);
  console.log(`GLOBAL FUTURES TOP-TRADER & SIGNAL HUNTER`);
  console.log(`Version: ${VERSION}`);
  console.log(`Mode: READ-ONLY / NO ORDERS / FUTURES ONLY`);
  console.log(`========================================`);

  const cache=await readJson(CACHE_FILE,{schema:VERSION,generatedAt:0,traders:[]});
  const cacheFresh=cache.generatedAt && (now()-cache.generatedAt)<CACHE_TTL_MIN*60000 && Array.isArray(cache.traders);
  let results=[];
  if(cacheFresh){
    console.log(`[CACHE] Using candidate pool age=${((now()-cache.generatedAt)/60000).toFixed(1)}m`);
    results=[{source:'CACHE',ok:true,rows:cache.traders}];
  }else{
    const built=[discoverHyperliquid(),discoverBinance(),discoverOKX(),...Object.entries(OPTIONAL_SOURCES).map(([k,u])=>discoverOptional(k,u))];
    results=await Promise.all(built);
    const pool=dedupe(results.flatMap(r=>r.rows));
    await writeJson(CACHE_FILE,{schema:VERSION,generatedAt:now(),traders:pool});
  }

  const pool=dedupe(results.flatMap(r=>r.rows));
  pool.sort((a,b)=>estimateStats(b)-estimateStats(a));
  const verifyPool=pool.slice(0,MAX_VERIFY_PER_SOURCE*3);
  console.log(`[POOL] candidates=${pool.length} verify=${verifyPool.length}`);
  const verified=[];
  for(const trader of verifyPool){
    try{
      const v=await verifyTrader(trader);
      verified.push(v);
      console.log(`[VERIFY] ${v.source} ${short(v.id)} positions=${v.positions.length} gate=${v.qualityBlocks.length?'BLOCK':'PASS'} signal=${v.signal?'YES':'NO'}`);
    }catch(e){console.log(`[VERIFY][ERROR] ${trader.source} ${short(trader.id)} ${e.message}`);}
    await sleep(50);
  }

  const signals=verified.filter(x=>x.qualityBlocks.length===0 && x.signal && x.signal.rr>=MIN_RR).sort((a,b)=>{
    const da=a.signal?.distancePct??999, db=b.signal?.distancePct??999;
    return (b.copyabilityScore-a.copyabilityScore) || (da-db);
  }).slice(0,TOP_SIGNALS);

  const report=buildTelegram({results,verified,signals,elapsed:(now()-t0)/1000});
  console.log(report);
  await telegram(report);

  await writeJson(STATE_FILE,{schema:VERSION,generatedAt:now(),sources:results.map(r=>({source:r.source,ok:r.ok,disabled:r.disabled||false,discovered:r.rows.length,error:r.error||null})),verified:verified.slice(0,100).map(x=>({source:x.source,id:x.id,name:x.name,metrics:x.metrics,positions:x.positions,qualityBlocks:x.qualityBlocks,signal:x.signal,copyabilityScore:x.copyabilityScore})),signals:signals.map(x=>({source:x.source,id:x.id,name:x.name,signal:x.signal,metrics:x.metrics,copyabilityScore:x.copyabilityScore}))});
  console.log(`[DONE] signals=${signals.length} runtime=${((now()-t0)/1000).toFixed(1)}s`);
}

main().catch(async e=>{console.error('[FATAL]',e.stack||e);process.exitCode=1;});
