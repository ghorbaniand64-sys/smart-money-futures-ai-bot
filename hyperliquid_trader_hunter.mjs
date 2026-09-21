// Hyperliquid Trader Hunter V5.15 - READ ONLY
// Professional ranking: statistical quality + current-position copyability.
// NO ORDERS. NO PRIVATE KEYS.

const API_URL = process.env.HYPERLIQUID_API_URL || 'https://api.hyperliquid.xyz/info';
const DISCOVERY_URL = process.env.HYPERLIQUID_HUNTER_DISCOVERY_URL || 'https://stats-data.hyperliquid.xyz/Mainnet/leaderboard';
const DISCOVERY_ENABLED = String(process.env.HYPERLIQUID_HUNTER_DISCOVERY_ENABLED ?? 'true').toLowerCase() === 'true';

const LOOKBACK_DAYS = num('HYPERLIQUID_HUNTER_LOOKBACK_DAYS', 7);
const QUALIFIED_TARGET = integer('HYPERLIQUID_HUNTER_QUALIFIED_TARGET', 100);
const SCREEN_PREFILTER = integer('HYPERLIQUID_HUNTER_SCREEN_PREFILTER', 500);
const SCREEN_CONCURRENCY = integer('HYPERLIQUID_HUNTER_SCREEN_CONCURRENCY', 10);
const DEEP_CONCURRENCY = integer('HYPERLIQUID_HUNTER_DEEP_CONCURRENCY', 6);
const MAX_CANDIDATES = integer('HYPERLIQUID_HUNTER_MAX_CANDIDATES', 500);
const STAT_POOL_SIZE = QUALIFIED_TARGET;
const FINALISTS = integer('HYPERLIQUID_HUNTER_FINALISTS', 5);
const AUTO_SELECT = integer('HYPERLIQUID_HUNTER_AUTO_SELECT', 1);

// Legacy thresholds are SOFT signals in V5.13, not hard rejection gates.
const MIN_TRADES = integer('HYPERLIQUID_HUNTER_MIN_7D_TRADES', 30);
const MIN_WR = num('HYPERLIQUID_HUNTER_MIN_7D_WIN_RATE', 65);
const MIN_PNL = num('HYPERLIQUID_HUNTER_MIN_7D_PNL', 0);
const MIN_PF = num('HYPERLIQUID_HUNTER_MIN_PROFIT_FACTOR', 1.5);
const MAX_MEDIAN_HOLD = num('HYPERLIQUID_HUNTER_MAX_MEDIAN_HOLD_HOURS', 6);
const MAX_AVG_HOLD = num('HYPERLIQUID_HUNTER_MAX_AVG_HOLD_HOURS', 12);
const MIN_ACTIVE_DAYS = integer('HYPERLIQUID_HUNTER_MIN_ACTIVE_DAYS', 4);
const MAX_LOSING_STREAK = integer('HYPERLIQUID_HUNTER_MAX_LOSING_STREAK', 8);
const MAX_LIQ = integer('HYPERLIQUID_HUNTER_MAX_LIQUIDATIONS', 1);

const MIN_RR = num('HYPERLIQUID_HUNTER_MIN_SETUP_RR', 1.5);
const MAX_ENTRY_DIST = num('HYPERLIQUID_HUNTER_MAX_ENTRY_DISTANCE_PCT', 0.5);
const SL_ATR = num('HYPERLIQUID_HUNTER_SL_ATR_MULT', 1.2);
const TP_ATR = num('HYPERLIQUID_HUNTER_TP_ATR_MULT', 2.0);
const MAX_HOLD = num('HYPERLIQUID_HUNTER_MAX_PLANNED_HOLD_HOURS', 12);

const RETRIES = integer('HYPERLIQUID_HUNTER_API_RETRIES', 4);
const BASE_DELAY = integer('HYPERLIQUID_HUNTER_API_BASE_DELAY_MS', 700);
const BETWEEN = integer('HYPERLIQUID_HUNTER_BETWEEN_TRADERS_MS', 0);
const MAX_PAGES = integer('HYPERLIQUID_HUNTER_MAX_FILL_PAGES', 6);
const TIMEOUT = integer('HYPERLIQUID_HUNTER_REQUEST_TIMEOUT_MS', 30000);

const TG_TOKEN = process.env.TELEGRAM_TOKEN || '';
const TG_CHAT = process.env.TELEGRAM_CHAT_ID || '';
const SEEDS = csv('HYPERLIQUID_TRADERS');
const MANUAL = csv('HYPERLIQUID_HUNTER_CANDIDATES');
const TG_LIMIT = 3800;

function num(k,d){const x=Number(process.env[k]);return Number.isFinite(x)?x:d}
function integer(k,d){const x=parseInt(process.env[k]||'',10);return Number.isFinite(x)?x:d}
function csv(k){return String(process.env[k]||'').split(',').map(x=>x.trim()).filter(Boolean)}
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
function addr(x){return /^0x[a-fA-F0-9]{40}$/.test(String(x||''))}
function norm(x){return String(x).toLowerCase()}
function short(x){const s=String(x||'');return s.length>14?`${s.slice(0,8)}…${s.slice(-6)}`:s}
function fmt(x,d=2){return Number.isFinite(Number(x))?Number(x).toFixed(d):'n/a'}
function pct(x,d=1){return Number.isFinite(Number(x))?`${Number(x).toFixed(d)}%`:'n/a'}
function median(a){if(!a.length)return NaN;const s=[...a].sort((a,b)=>a-b),m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2}
function quantile(a,q){if(!a.length)return NaN;const s=[...a].sort((a,b)=>a-b),p=(s.length-1)*q,l=Math.floor(p),h=Math.ceil(p);return l===h?s[l]:s[l]+(s[h]-s[l])*(p-l)}

function category(e){
  const s=String(e?.message||e||'');
  if(/HTTP 429/i.test(s))return'HTTP_429';
  if(/HTTP 5\d\d/i.test(s))return'HTTP_5XX';
  if(/timeout/i.test(s))return'TIMEOUT';
  if(/fetch|network|ECONN|socket|ENOTFOUND/i.test(s))return'NETWORK';
  if(/JSON/i.test(s))return'BAD_JSON';
  if(/fills/i.test(s))return'FILLS';
  return'OTHER'
}

async function fetchJson(url, options={}, label='request'){
  let last;
  for(let attempt=0;attempt<=RETRIES;attempt++){
    const c=new AbortController(),t=setTimeout(()=>c.abort(),TIMEOUT);
    try{
      const r=await fetch(url,{...options,signal:c.signal});
      clearTimeout(t);
      if(r.ok){
        const text=await r.text();
        try{return JSON.parse(text)}catch{throw new Error(`${label}: invalid JSON`)}
      }
      const body=(await r.text()).slice(0,240);
      const e=new Error(`${label}: HTTP ${r.status} ${body}`);e.status=r.status;throw e;
    }catch(e){
      clearTimeout(t);last=e?.name==='AbortError'?new Error(`${label}: timeout`):e;
      const s=Number(last?.status||0);
      if(!([429,...Array.from({length:100},(_,i)=>500+i)].includes(s)||!s)||attempt>=RETRIES)break;
      const wait=BASE_DELAY*(2**attempt)+Math.floor(Math.random()*250);
      console.log(`[RETRY] ${label} ${attempt+1}/${RETRIES} wait=${wait}ms ${category(last)}`);await sleep(wait);
    }
  }
  throw last||new Error(`${label}: failed`)
}
async function info(payload,label=payload.type){return fetchJson(API_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)},label)}

function weekStats(row){
  const wp=Array.isArray(row?.windowPerformances)?row.windowPerformances:[];
  const m=Object.fromEntries(wp.filter(Array.isArray).map(x=>[String(x[0]).toLowerCase(),x[1]||{}]));
  return m.week||m["7d"]||m.day||{};
}
function rowMetric(row, keys, fallback=NaN){
  for(const k of keys){
    const parts=k.split('.');
    let v=row;
    for(const p of parts)v=v?.[p];
    if(v!==undefined&&v!==null&&Number.isFinite(Number(v)))return Number(v);
    const w=weekStats(row);
    v=w;
    for(const p of parts)v=v?.[p];
    if(v!==undefined&&v!==null&&Number.isFinite(Number(v)))return Number(v);
  }
  return fallback;
}
function hunterPreScore(row){
  const w=weekStats(row);
  const pnl=rowMetric(row,['pnl','accountValue.pnl','performance.pnl'],0);
  const roi=rowMetric(row,['roi','returnOnEquity','performance.roi'],0);
  const vol=rowMetric(row,['vlm','volume','volumeUsd','performance.vlm'],0);
  // Cheap leaderboard-only pre-rank. Raw PnL is deliberately not dominant.
  return Math.max(0,pnl)*0.35 + Math.max(0,roi)*1000*0.30 + Math.log10(Math.max(1,vol))*10*0.20
       + (Number.isFinite(Number(w.accountValue))?Math.log10(Math.max(1,Number(w.accountValue)))*2:0)*0.15;
}
async function discover(){
  const map=new Map();
  for(const a of [...SEEDS,...MANUAL])if(addr(a))map.set(norm(a),{ethAddress:norm(a)});
  if(!DISCOVERY_ENABLED){
    const candidates=[...map.values()].map(r=>norm(r.ethAddress)).slice(0,SCREEN_PREFILTER);
    return{discovered:map.size,candidates,rows:[],source:'manual_only'};
  }
  const data=await fetchJson(DISCOVERY_URL,{},'leaderboard discovery');
  const rows=Array.isArray(data?.leaderboardRows)?data.leaderboardRows:[];
  const valid=[];
  for(const row of rows)if(addr(row?.ethAddress)){
    const a=norm(row.ethAddress);map.set(a,row);valid.push(a);
  }
  const candidates=[...map.values()]
    .sort((a,b)=>hunterPreScore(b)-hunterPreScore(a))
    .slice(0,Math.max(SCREEN_PREFILTER,QUALIFIED_TARGET))
    .map(r=>norm(r.ethAddress));
  const rowMap=new Map([...map.values()].filter(r=>addr(r?.ethAddress)).map(r=>[norm(r.ethAddress),r]));
  return{discovered:new Set(valid).size,candidates,rows:rowMap,source:'leaderboardRows.ethAddress:fast_prefilter'};
}

function fillKey(f){return [f?.tid??'',f?.hash??'',f?.time??'',f?.coin??'',f?.px??'',f?.sz??'',f?.side??''].join('|')}
async function getFills(user,start,end){
  let cursor=start,pages=0;const map=new Map(),newest=0;
  while(pages<MAX_PAGES){
    pages++;
    const b=await info({type:'userFillsByTime',user,startTime:cursor,endTime:end,aggregateByTime:false},`fills ${short(user)} page=${pages}`);
    if(!Array.isArray(b))throw new Error('fills: unexpected response');
    for(const f of b){if(f?.time)map.set(fillKey(f),f)}
    if(b.length===0||b.length<2000)break;
    const max=Math.max(...b.map(f=>Number(f?.time||0)));
    if(!max||max>=end)break;
    const next=Math.max(cursor+1,max);if(next<=cursor)break;
    cursor=next;await sleep(100);
  }
  const fills=[...map.values()].sort((a,b)=>Number(a.time)-Number(b.time));
  return{fills,pages,truncated:pages>=MAX_PAGES||fills.length>=10000,newest};
}
function delta(f){
  const sz=Math.abs(Number(f?.sz||0));
  if(!Number.isFinite(sz)||sz<=0)return 0;
  const side=String(f?.side||'').toUpperCase();
  return side==='B'?sz:side==='A'?-sz:0;
}

function reconstruct(fills){
  const books=new Map(),trades=[];
  let liquidations=0,invalidLifecycle=0;

  for(const f of fills){
    const coin=String(f?.coin||'');
    if(!coin)continue;

    const dir=String(f?.dir||'').toLowerCase();
    if(dir.includes('liquid'))liquidations++;

    const d=delta(f);
    if(!d)continue;

    const px=Number(f?.px),time=Number(f?.time),start=Number(f?.startPosition);
    if(!Number.isFinite(px)||!Number.isFinite(time))continue;

    const lots=books.get(coin)||[];
    books.set(coin,lots);

    // Prefer Hyperliquid's explicit lifecycle direction when present.
    // startPosition is only the fallback. This prevents a missing/ambiguous
    // startPosition field from turning every fill into an "open" and producing
    // the old NO_CLOSED_TRADES false-negative.
    const explicitCloseLong=/close\s*long/i.test(dir);
    const explicitCloseShort=/close\s*short/i.test(dir);
    const explicitOpenLong=/open\s*long/i.test(dir);
    const explicitOpenShort=/open\s*short/i.test(dir);
    const explicitClose=explicitCloseLong||explicitCloseShort;
    const explicitOpen=explicitOpenLong||explicitOpenShort;

    let reducing;
    if(explicitClose) reducing=true;
    else if(explicitOpen) reducing=false;
    else {
      const before=Math.abs(Number.isFinite(start)?start:0);
      reducing=before>0 && ((start>0&&d<0)||(start<0&&d>0));
    }

    if(!reducing){
      lots.push({
        side:explicitOpenShort?'short':explicitOpenLong?'long':(d>0?'long':'short'),
        qty:Math.abs(d),
        px,
        time
      });
      continue;
    }

    let rem=Math.abs(d);
    const closingSide=explicitCloseLong?'long':explicitCloseShort?'short':(start>0?'long':'short');

    while(rem>1e-12){
      // Drop incompatible stale lots rather than manufacturing a trade.
      while(lots.length && lots[0].side!==closingSide)lots.shift();
      if(!lots.length){
        invalidLifecycle++;
        break;
      }

      const lot=lots[0];
      const used=Math.min(rem,lot.qty);
      const fq=Math.abs(Number(f?.sz||0));
      const cp=Number(f?.closedPnl);

      let pnl;
      if(Number.isFinite(cp)&&fq>0){
        pnl=cp*(used/fq);
      }else{
        pnl=lot.side==='long'?(px-lot.px)*used:(lot.px-px)*used;
      }

      if(!Number.isFinite(pnl)){
        invalidLifecycle++;
        break;
      }

      trades.push({
        coin,
        side:lot.side,
        qty:used,
        entryPx:lot.px,
        exitPx:px,
        openTime:lot.time,
        closeTime:time,
        holdHours:Math.max(0,(time-lot.time)/3600000),
        pnl
      });

      lot.qty-=used;
      rem-=used;
      if(lot.qty<=1e-12)lots.shift();
    }

    // If the fill flips the position, the residual becomes a new lifecycle.
    if(rem>1e-12){
      lots.push({
        side:d>0?'long':'short',
        qty:rem,
        px,
        time
      });
    }
  }

  return{trades,liquidations,invalidLifecycle};
}

function metrics(fills,r){
  const ts=r.trades,w=ts.filter(t=>t.pnl>0),l=ts.filter(t=>t.pnl<0),holds=ts.map(t=>t.holdHours).filter(Number.isFinite);
  const gw=w.reduce((s,t)=>s+t.pnl,0),gl=Math.abs(l.reduce((s,t)=>s+t.pnl,0)),pnl=ts.reduce((s,t)=>s+t.pnl,0);
  const days=new Set(ts.map(t=>new Date(t.closeTime).toISOString().slice(0,10)));
  let st=0,maxst=0;for(const t of [...ts].sort((a,b)=>a.closeTime-b.closeTime)){if(t.pnl<0){st++;maxst=Math.max(maxst,st)}else if(t.pnl>0)st=0}
  return{fills:fills.length,closedTrades:ts.length,invalidLifecycle:Number(r.invalidLifecycle||0),winRate:ts.length?w.length/ts.length*100:0,pnl,grossWin:gw,grossLossAbs:gl,profitFactor:gl>0?gw/gl:(gw>0?Infinity:0),medianHoldHours:median(holds),avgHoldHours:holds.length?holds.reduce((a,b)=>a+b,0)/holds.length:NaN,p25HoldHours:quantile(holds,.25),p75HoldHours:quantile(holds,.75),activeDays:days.size,maxLosingStreak:maxst,liquidations:r.liquidations}
}
function safetyGate(m,truncated){
  const reasons=[];
  if(truncated)reasons.push('HISTORY_TRUNCATED');
  if(m.closedTrades<=0)reasons.push('NO_CLOSED_TRADES');
  if(m.invalidLifecycle>Math.max(3,Math.ceil(m.fills*0.02)))reasons.push(`INVALID_LIFECYCLE>${Math.max(3,Math.ceil(m.fills*0.02))}`);
  if(!Number.isFinite(m.profitFactor)&&m.profitFactor!==Infinity)reasons.push('INVALID_PROFIT_FACTOR');
  if(m.liquidations>Math.max(MAX_LIQ,3))reasons.push(`LIQUIDATIONS>${Math.max(MAX_LIQ,3)}`);
  if(m.maxLosingStreak>Math.max(MAX_LOSING_STREAK,12))reasons.push(`EXTREME_LOSING_STREAK>${Math.max(MAX_LOSING_STREAK,12)}`);
  return{ok:!reasons.length,reasons}
}
function softFlags(m){
  const r=[];
  if(m.closedTrades<MIN_TRADES)r.push(`TRADES<${MIN_TRADES}`);
  if(m.winRate<MIN_WR)r.push(`WR<${MIN_WR}%`);
  if(m.pnl<MIN_PNL)r.push(`PNL<${MIN_PNL}`);
  if(!(m.profitFactor>=MIN_PF))r.push(`PF<${MIN_PF}`);
  if(!(m.medianHoldHours<=MAX_MEDIAN_HOLD))r.push(`MEDIAN_HOLD>${MAX_MEDIAN_HOLD}h`);
  if(!(m.avgHoldHours<=MAX_AVG_HOLD))r.push(`AVG_HOLD>${MAX_AVG_HOLD}h`);
  if(m.activeDays<MIN_ACTIVE_DAYS)r.push(`ACTIVE_DAYS<${MIN_ACTIVE_DAYS}`);
  if(m.maxLosingStreak>MAX_LOSING_STREAK)r.push(`LOSING_STREAK>${MAX_LOSING_STREAK}`);
  if(m.liquidations>MAX_LIQ)r.push(`LIQUIDATIONS>${MAX_LIQ}`);
  return r
}
function qualityScore(m){
  if(m.closedTrades<=0)return 0;
  const trade=Math.min(100,m.closedTrades/Math.max(30,MIN_TRADES)*100);
  const wr=Math.max(0,Math.min(100,m.winRate/80*100));
  const pf=Math.max(0,Math.min(100,Math.min(m.profitFactor,5)/3*100));
  const hold=Number.isFinite(m.avgHoldHours)?Math.max(0,Math.min(100,100-Math.max(0,m.avgHoldHours-2)/18*100)):40;
  const active=Math.max(0,Math.min(100,m.activeDays/7*100));
  const pnl=m.pnl>0?Math.min(100,60+Math.log10(Math.max(1,m.pnl))*8):Math.max(0,40-Math.log10(Math.max(1,Math.abs(m.pnl)+1))*8);
  return Math.max(0,Math.min(100,0.20*trade+0.22*wr+0.24*pf+0.12*hold+0.10*active+0.12*pnl-Math.min(35,m.maxLosingStreak*4)*.5-Math.min(35,m.liquidations*12)*.5))
}
function rankStat(a,b){return(b.qualityScore-a.qualityScore)||(b.metrics.profitFactor-a.metrics.profitFactor)||(b.metrics.winRate-a.metrics.winRate)||(b.metrics.closedTrades-a.metrics.closedTrades)}

async function position(user){
  const s=await info({type:'clearinghouseState',user},`position ${short(user)}`);
  return(Array.isArray(s?.assetPositions)?s.assetPositions:[]).map(x=>x?.position).filter(Boolean).filter(p=>Math.abs(Number(p.szi||0))>0).sort((a,b)=>Math.abs(Number(b.szi||0))-Math.abs(Number(a.szi||0)))[0]||null;
}
async function book(coin){
  const b=await info({type:'l2Book',coin},`book ${coin}`),lv=Array.isArray(b?.levels)?b.levels:[];
  const bid=Number(lv?.[0]?.[0]?.px),ask=Number(lv?.[1]?.[0]?.px);
  if(!Number.isFinite(bid)||!Number.isFinite(ask))throw new Error(`book ${coin}: no bid/ask`);
  return{bid,ask,mid:(bid+ask)/2}
}
async function atr(coin,end){
  const c=await info({
    type:'candleSnapshot',
    req:{coin,interval:'1h',startTime:end-96*3600000,endTime:end}
  },`candles ${coin}`);

  const rows=Array.isArray(c)?c:[];
  const parsed=rows.map(x=>({
    h:Number(x?.h),l:Number(x?.l),o:Number(x?.o),c:Number(x?.c)
  })).filter(x=>Number.isFinite(x.h)&&Number.isFinite(x.l)&&x.h>x.l);

  if(parsed.length<12)throw new Error(`candles ${coin}: insufficient 1h data (${parsed.length})`);

  let prevClose=NaN;
  const tr=[];
  for(const x of parsed){
    const range=x.h-x.l;
    const trueRange=Number.isFinite(prevClose)
      ? Math.max(range,Math.abs(x.h-prevClose),Math.abs(x.l-prevClose))
      : range;
    if(Number.isFinite(trueRange)&&trueRange>0)tr.push(trueRange);
    prevClose=Number.isFinite(x.c)?x.c:prevClose;
  }

  if(tr.length<12)throw new Error(`candles ${coin}: invalid 1h true-range data`);
  const recent=tr.slice(-72);
  const value=recent.reduce((a,b)=>a+b,0)/recent.length;

  if(!Number.isFinite(value)||value<=0)throw new Error(`candles ${coin}: ATR invalid ${value}`);
  return value;
}

function plan(pos,m,atrv,now){
  const s=Number(pos?.szi||0),source=Number(pos?.entryPx||0);
  if(!Number.isFinite(s)||s===0)throw new Error('position: invalid size');

  const side=s>0?'LONG':'SHORT';
  if(!Number.isFinite(source)||source<=0)throw new Error('position: invalid entryPx');

  const dist=Math.abs(m.mid-source)/source*100;
  const atrPct=m.mid>0?atrv/m.mid*100:Infinity;

  if(!Number.isFinite(atrv)||atrv<=0)throw new Error('ATR_INVALID');
  if(!Number.isFinite(m.mid)||m.mid<=0)throw new Error('BOOK_MID_INVALID');
  if(!Number.isFinite(atrPct)||atrPct<=0||atrPct>25)throw new Error(`ATR_SANITY_FAIL:${fmt(atrPct,2)}%`);

  const sl=side==='LONG'?m.mid-SL_ATR*atrv:m.mid+SL_ATR*atrv;
  const tp=side==='LONG'?m.mid+TP_ATR*atrv:m.mid-TP_ATR*atrv;

  if(!Number.isFinite(sl)||!Number.isFinite(tp))throw new Error('SL_TP_INVALID');
  if(sl<=0||tp<=0)throw new Error(`SL_TP_NONPOSITIVE:sl=${sl},tp=${tp}`);
  if(Math.abs(sl-m.mid)<Math.max(atrv*0.05,m.mid*0.00005))throw new Error('SL_TOO_CLOSE');
  if(Math.abs(tp-m.mid)<Math.max(atrv*0.05,m.mid*0.00005))throw new Error('TP_TOO_CLOSE');

  const risk=Math.abs(m.mid-sl),reward=Math.abs(tp-m.mid),rr=risk>0?reward/risk:0;
  if(!Number.isFinite(rr)||rr<=0)throw new Error('RR_INVALID');

  const age=Number(pos?.timestamp||pos?.entryTimestamp||0);
  const ageH=age>0?Math.max(0,(now-age)/3600000):NaN;

  return{
    eligible:dist<=MAX_ENTRY_DIST&&rr>=MIN_RR,
    reason:dist>MAX_ENTRY_DIST?`ENTRY_DISTANCE>${MAX_ENTRY_DIST}%`:rr<MIN_RR?`RR<${MIN_RR}`:'READY',
    side,coin:String(pos?.coin||''),sourceEntry:source,entry:m.mid,distancePct:dist,
    sl,tp,rr,atr:atrv,atrPct,maxHoldHours:MAX_HOLD,positionAgeHours:ageH
  };
}

function copyability(x){
  let s=x.qualityScore*.35;
  if(x.position)s+=20;
  if(x.plan && x.plan.eligible!==undefined){
    s+=Math.max(0,15-Math.min(15,(x.plan.distancePct||99)/Math.max(MAX_ENTRY_DIST,.01)*15));
    s+=Math.max(0,10-Math.min(10,(x.positionAgeHours||0)/12*10));
    if(x.plan.rr>=MIN_RR)s+=10;
    s+=x.plan.atrPct<=3?10:Math.max(0,10-(x.plan.atrPct-3)*2);
  }
  return Math.max(0,Math.min(100,s))
}
async function enrich(x,now){
  try{
    const p=await position(x.address);
    if(!p){x.enrichmentStatus='WATCH_NO_POSITION';x.position=null;x.copyabilityScore=Math.round(x.qualityScore*.35);return x}
    x.position=p;
    const coin=String(p.coin||'');
    if(!coin)throw new Error('POSITION_COIN_MISSING');

    const bk=await book(coin);
    const av=await atr(coin,now);
    x.plan=plan(p,bk,av,now);
    x.positionAgeHours=x.plan.positionAgeHours;
    x.copyabilityScore=Math.round(copyability(x));
    x.enrichmentStatus=x.plan.eligible?'COPY_READY':'POSITION_BLOCKED';
    return x;
  }catch(e){
    x.plan=null;
    x.enrichmentStatus=`POSITION_DATA_INVALID:${category(e)}`;
    x.enrichmentError=e.message;
    x.copyabilityScore=0;
    return x
  }
}

async function mapConcurrent(items,limit,worker){
  const out=new Array(items.length),errors=[];
  let next=0;
  async function runner(){
    while(true){
      const i=next++;
      if(i>=items.length)return;
      try{out[i]=await worker(items[i],i)}catch(e){errors.push({item:items[i],index:i,cat:category(e),message:String(e?.message||e)})}
    }
  }
  await Promise.all(Array.from({length:Math.max(1,Math.min(limit,items.length))},runner));
  return{out:out.filter(Boolean),errors};
}
function fastRowFlags(row){
  const w=weekStats(row);
  const trades=rowMetric(row,['trades','closedTrades','numTrades','performance.trades'],NaN);
  const pnl=rowMetric(row,['pnl','accountValue.pnl','performance.pnl'],NaN);
  const roi=rowMetric(row,['roi','returnOnEquity','performance.roi'],NaN);
  return{trades,pnl,roi,w};
}
async function scanOne(address,start,now){
  const f=await getFills(address,start,now);
  const r=reconstruct(f.fills);
  const m=metrics(f.fills,r);
  const sg=safetyGate(m,f.truncated);
  return{address,metrics:m,safety:sg,truncated:f.truncated,qualityScore:Math.round(qualityScore(m)),softFlags:softFlags(m)};
}
function rankQualified(a,b){
  return rankStat(a,b) || (b.metrics.pnl-a.metrics.pnl);
}
function elapsed(t){return `${((Date.now()-t)/1000).toFixed(1)}s`}
function countsByReason(xs,key){
  const m={};for(const x of xs){for(const r of (x[key]||[]))m[r]=(m[r]||0)+1}
  return Object.entries(m).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([k,v])=>`${k}:${v}`).join(' | ')||'none';
}

async function telegram(text){
  if(!TG_TOKEN||!TG_CHAT){console.log('[TELEGRAM] missing credentials');return}
  for(let i=0;i<text.length;i+=TG_LIMIT){
    try{
      await fetchJson(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`,{
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({chat_id:TG_CHAT,text:text.slice(i,i+TG_LIMIT),disable_web_page_preview:true})
      },'telegram');
    }catch(e){
      console.error(`[TELEGRAM][ERROR] ${e.message}`)
    }
  }
}
function errSummary(es){const m={};for(const e of es)m[e.cat]=(m[e.cat]||0)+1;return Object.entries(m).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k}:${v}`).join(' | ')||'none'}
function icon(s){return s==='COPY_READY'?'🟢':s==='WATCH_NO_POSITION'?'🟡':s==='POSITION_BLOCKED'?'🟠':'🔴'}

async function main(){
  const t0=Date.now();
  console.log(`[HUNTER V5.15][START] ${JSON.stringify({lookbackDays:LOOKBACK_DAYS,qualifiedTarget:QUALIFIED_TARGET,screenPrefilter:SCREEN_PREFILTER,finalists:FINALISTS})}`);

  let d;
  try{d=await discover()}
  catch(e){
    console.error(`[DISCOVERY][ERROR] ${e.message}`);
    await telegram(`🟣 HYPERLIQUID TRADER HUNTER V5.15\n📡 READ-ONLY | NO ORDERS\n━━━━━━━━━━━━━━━━━━\n❌ DISCOVERY ERROR\n${e.message}`);
    process.exitCode=1;return;
  }

  const t1=Date.now();
  console.log(`[DISCOVERY] leaderboard=${d.discovered} prefilter=${d.candidates.length}`);

  const start=Date.now()-LOOKBACK_DAYS*86400000,now=Date.now();

  // Phase 1: parallel statistical screening. No artificial inter-trader delay.
  const screen=await mapConcurrent(d.candidates,SCREEN_CONCURRENCY,(a)=>scanOne(a,start,now));
  const scanned=screen.out;
  const errors=screen.errors;
  const t2=Date.now();

  // Only truly safe/statistically qualified traders enter the 100-person deep pool.
  // Soft flags remain visible, but the explicit quality gates are now enforced here.
  const qualified=scanned
    .filter(x=>x.safety.ok)
    .filter(x=>x.metrics.closedTrades>=MIN_TRADES)
    .filter(x=>x.metrics.winRate>=MIN_WR)
    .filter(x=>x.metrics.pnl>=MIN_PNL)
    .filter(x=>x.metrics.profitFactor>=MIN_PF)
    .filter(x=>x.metrics.activeDays>=MIN_ACTIVE_DAYS)
    .filter(x=>x.metrics.maxLosingStreak<=MAX_LOSING_STREAK)
    .filter(x=>x.metrics.liquidations<=MAX_LIQ)
    .sort(rankQualified)
    .slice(0,QUALIFIED_TARGET);

  const t3=Date.now();

  // Phase 2: deep scan ONLY the qualified pool.
  const deep=await mapConcurrent(qualified,DEEP_CONCURRENCY,(x)=>enrich(x,now));
  const deepPool=deep.out;
  const deepErrors=deep.errors;
  const t4=Date.now();

  // Finalists are selected from the fully enriched 100.
  const finalists=[...deepPool]
    .sort((a,b)=>(b.copyabilityScore-a.copyabilityScore)||rankQualified(a,b))
    .slice(0,Math.max(1,FINALISTS));

  const selected=AUTO_SELECT?finalists.filter(x=>x.enrichmentStatus==='COPY_READY').slice(0,1):[];
  const t5=Date.now();

  const safetyBlocks={};
  for(const x of scanned)for(const r of x.safety.reasons)safetyBlocks[r]=(safetyBlocks[r]||0)+1;
  const hardRejected=scanned.filter(x=>!x.safety.ok||x.metrics.closedTrades<MIN_TRADES||x.metrics.winRate<MIN_WR||x.metrics.pnl<MIN_PNL||x.metrics.profitFactor<MIN_PF||x.metrics.activeDays<MIN_ACTIVE_DAYS||x.metrics.maxLosingStreak>MAX_LOSING_STREAK||x.metrics.liquidations>MAX_LIQ);

  const enrichCounts={};
  for(const x of deepPool)enrichCounts[x.enrichmentStatus]=(enrichCounts[x.enrichmentStatus]||0)+1;
  for(const e of deepErrors)enrichCounts[`ERROR:${e.cat}`]=(enrichCounts[`ERROR:${e.cat}`]||0)+1;

  const lines=[
    '🟣 HYPERLIQUID TRADER HUNTER V5.15',
    '📡 READ-ONLY | NO ORDERS',
    '━━━━━━━━━━━━━━━━━━',
    `🔎 Leaderboard: ${d.discovered}`,
    `⚡ Fast prefilter: ${d.candidates.length}`,
    `📊 Screened: ${scanned.length}/${d.candidates.length}`,
    `✅ Qualified: ${qualified.length}/${QUALIFIED_TARGET}`,
    `🧠 Deep-scanned: ${deepPool.length}/${qualified.length}`,
    `🏆 Finalists: ${finalists.length}/${Math.min(FINALISTS,deepPool.length)}`,
    `🟢 Copy eligible: ${selected.length}`,
    `⚠️ Screen errors: ${errors.length}`,
    `⚠️ Deep errors: ${deepErrors.length}`,
    '',
    '⏱ PIPELINE TIME',
    `Discovery: ${elapsed(t0)}`,
    `Fast screen: ${((t2-t1)/1000).toFixed(1)}s`,
    `Qualification: ${((t3-t2)/1000).toFixed(1)}s`,
    `Deep scan: ${((t4-t3)/1000).toFixed(1)}s`,
    `Final ranking: ${((t5-t4)/1000).toFixed(1)}s`,
    `TOTAL: ${((t5-t0)/1000).toFixed(1)}s`,
    '',
    '🧱 TOP SCREEN BLOCKS',
    Object.entries(safetyBlocks).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([k,v])=>`${k}:${v}`).join(' | ')||'none',
    '📌 QUALIFICATION RULES',
    `Trades≥${MIN_TRADES} | WR≥${MIN_WR}% | PnL≥${MIN_PNL} | PF≥${MIN_PF} | ActiveDays≥${MIN_ACTIVE_DAYS} | LosingStreak≤${MAX_LOSING_STREAK} | Liq≤${MAX_LIQ}`,
    '',
    '🏆 FINALISTS'
  ];

  if(!finalists.length)lines.push('No finalist reached the deep-scan stage.');
  else finalists.forEach((x,i)=>{
    const m=x.metrics,p=x.plan;
    lines.push(
      '',
      `#${i+1} ${short(x.address)}`,
      `${icon(x.enrichmentStatus)} ${x.enrichmentStatus} | Quality=${x.qualityScore}/100 | Copyability=${x.copyabilityScore}/100`,
      `📈 7D: trades=${m.closedTrades} | WR=${pct(m.winRate)} | PnL=${fmt(m.pnl)} | PF=${fmt(m.profitFactor)} | lifecycleErr=${m.invalidLifecycle}`,
      `⏱ Hold: median=${fmt(m.medianHoldHours)}h | avg=${fmt(m.avgHoldHours)}h | activeDays=${m.activeDays}`,
      `🧯 Streak=${m.maxLosingStreak} | liq=${m.liquidations} | fills=${m.fills}`,
      p?`📌 ${p.side} ${p.coin} | source=${fmt(p.sourceEntry)} | now=${fmt(p.entry)} | dist=${pct(p.distancePct,2)} | SL=${fmt(p.sl)} | TP=${fmt(p.tp)} | RR=${fmt(p.rr)} | age=${fmt(p.positionAgeHours)}h`
       :'📌 Position: NONE | Copy now: NO | Watchlist: YES',
      x.softFlags.length?`ℹ️ Soft: ${x.softFlags.slice(0,4).join(', ')}`:'',
      x.enrichmentError?`⚠️ Enrichment: ${x.enrichmentError.slice(0,180)}`:''
    );
  });

  lines.push(
    '',
    '🚀 AUTO SELECTED',
    selected.length
      ? `${short(selected[0].address)} | ${selected[0].plan.side} ${selected[0].plan.coin} | Quality=${selected[0].qualityScore}/100 | Copyability=${selected[0].copyabilityScore}/100`
      : 'None — no current position passed copyability checks.',
    '',
    'ℹ️ V5.15 pipeline: Leaderboard → fast screen → 100 qualified → deep scan → 5 finalists → 1 auto-selected.',
    'ℹ️ Qualification gates are hard gates; soft flags are diagnostic only.',
    'ℹ️ Deep enrichment is NEVER executed for unqualified traders.',
    'ℹ️ Entry/SL/TP are READ-ONLY diagnostics. Source TP/SL is not copied.',
    'ℹ️ No orders are created by this worker.',
    `🕐 ${new Date().toISOString()}`
  );

  console.log(`[HUNTER V5.15][DONE] leaderboard=${d.discovered} prefilter=${d.candidates.length} scanned=${scanned.length} qualified=${qualified.length} deep=${deepPool.length} finalists=${finalists.length} selected=${selected.length} total=${((t5-t0)/1000).toFixed(1)}s`);
  await telegram(lines.join('\n'));
}
main().catch(async e=>{console.error(`[HUNTER V5.15][FATAL] ${e.stack||e}`);await telegram(`🟣 HYPERLIQUID TRADER HUNTER V5.15\n📡 READ-ONLY | NO ORDERS\n━━━━━━━━━━━━━━━━━━\n💥 FATAL ERROR\n${String(e.message||e).slice(0,1000)}`);process.exitCode=1});
