// Hyperliquid Trader Hunter V5.15-COPY5-FIXED - READ ONLY
// Professional ranking: statistical quality + current-position copyability.
// NO ORDERS. NO PRIVATE KEYS.

const API_URL = process.env.HYPERLIQUID_API_URL || 'https://api.hyperliquid.xyz/info';
const DISCOVERY_URL = process.env.HYPERLIQUID_HUNTER_DISCOVERY_URL || 'https://stats-data.hyperliquid.xyz/Mainnet/leaderboard';
const DISCOVERY_ENABLED = String(process.env.HYPERLIQUID_HUNTER_DISCOVERY_ENABLED ?? 'true').toLowerCase() === 'true';

const LOOKBACK_DAYS = num('HYPERLIQUID_HUNTER_LOOKBACK_DAYS', 7);
const MAX_CANDIDATES = integer('HYPERLIQUID_HUNTER_MAX_CANDIDATES', 500);
const PREFILTER_SIZE = integer('HYPERLIQUID_HUNTER_PREFILTER_SIZE', 500);
const STAT_SCAN_TARGET = integer('HYPERLIQUID_HUNTER_STAT_SCAN_TARGET', 120);
const MIN_COPY5 = integer('HYPERLIQUID_HUNTER_MIN_COPY5', 5);
const ENRICH_POOL_SIZE = integer('HYPERLIQUID_HUNTER_ENRICH_POOL_SIZE', 40);
const STAT_CHUNK_SIZE = integer('HYPERLIQUID_HUNTER_STAT_CHUNK_SIZE', 80);
const POSITION_TARGET = integer('HYPERLIQUID_HUNTER_POSITION_TARGET', 5);
const POSITION_CONCURRENCY = integer('HYPERLIQUID_HUNTER_POSITION_CONCURRENCY', 3);
const STAT_POOL_SIZE = integer('HYPERLIQUID_HUNTER_STAT_POOL_SIZE', 20);
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
const BETWEEN = integer('HYPERLIQUID_HUNTER_BETWEEN_TRADERS_MS', 250);
const POSITION_BETWEEN = integer('HYPERLIQUID_HUNTER_POSITION_BETWEEN_MS', 180);
const MAX_PAGES = integer('HYPERLIQUID_HUNTER_MAX_FILL_PAGES', 8);
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
      const e=new Error(`${label}: HTTP ${r.status} ${body}`);e.status=r.status;
      const ra=Number(r.headers.get('retry-after')||0); if(ra>0)e.retryAfterMs=ra*1000;
      throw e;
    }catch(e){
      clearTimeout(t);last=e?.name==='AbortError'?new Error(`${label}: timeout`):e;
      const s=Number(last?.status||0);
      const retryable=s===429 || (s>=500&&s<=599) || s===0;
      if(!retryable||attempt>=RETRIES)break;
      const wait=Math.min(12000,Number(last?.retryAfterMs||0)||BASE_DELAY*Math.pow(2,attempt)+Math.floor(Math.random()*200));
      console.log(`[RETRY] ${label} ${attempt+1}/${RETRIES} wait=${wait}ms ${category(last)}`);await sleep(wait);
    }
  }
  throw last||new Error(`${label}: failed`)
}
async function info(payload,label=payload.type){return fetchJson(API_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)},label)}

function hunterPreScore(row){
  const wp=Array.isArray(row?.windowPerformances)?row.windowPerformances:[];
  const m=Object.fromEntries(wp.filter(Array.isArray).map(x=>[x[0],x[1]]));
  const w=m.week||m.day||{},p=Number(w.pnl||0),r=Number(w.roi||0),v=Number(w.vlm||0);
  return (v>0?1e9:0)+Math.max(0,p)*1e3+Math.max(0,r)*1e2+Math.log10(Math.max(1,v));
}
async function discover(){
  const map=new Map();
  for(const a of [...SEEDS,...MANUAL])if(addr(a))map.set(norm(a),{ethAddress:norm(a)});
  if(!DISCOVERY_ENABLED)return{discovered:map.size,candidates:[...map.keys()].slice(0,MAX_CANDIDATES),source:'manual_only'};
  const data=await fetchJson(DISCOVERY_URL,{},'leaderboard discovery');
  const rows=Array.isArray(data?.leaderboardRows)?data.leaderboardRows:[];
  const valid=[];
  for(const row of rows)if(addr(row?.ethAddress)){const a=norm(row.ethAddress);map.set(a,row);valid.push(a)}
  const candidates=[...map.values()].sort((a,b)=>hunterPreScore(b)-hunterPreScore(a)).map(r=>norm(r.ethAddress)).slice(0,Math.min(MAX_CANDIDATES,PREFILTER_SIZE));
  return{discovered:new Set(valid).size,candidates,source:'leaderboardRows.ethAddress:hunter_pre_rank'};
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

    // Hyperliquid startPosition is the position immediately before this fill.
    // Use it to determine whether the fill closes/reduces or opens/increases.
    const before=Math.abs(Number.isFinite(start)?start:0);
    const reducing=(before>0 && Math.sign(start)===Math.sign(d) ? false :
                    before>0 && ((start>0&&d<0)||(start<0&&d>0)));

    if(!reducing){
      lots.push({
        side:d>0?'long':'short',
        qty:Math.abs(d),
        px,
        time
      });
      continue;
    }

    let rem=Math.abs(d);
    const closingSide=start>0?'long':'short';

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
  return(Array.isArray(s?.assetPositions)?s.assetPositions:[])
    .map(x=>x?.position).filter(Boolean)
    .filter(p=>Math.abs(Number(p.szi||0))>0)
    .sort((a,b)=>Math.abs(Number(b.szi||0))-Math.abs(Number(a.szi||0)));
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
  if(!Number.isFinite(m.mid)||m.mid<=0)throw new Error('MARKET_PRICE_INVALID');

  const dist=Math.abs(m.mid-source)/source*100;
  const age=Number(pos?.timestamp||pos?.entryTimestamp||0);
  const ageH=age>0?Math.max(0,(now-age)/3600000):NaN;

  let sl=null,tp=null,rr=null,atrPct=null;
  const diagnostics=[];
  if(Number.isFinite(atrv)&&atrv>0){
    atrPct=m.mid>0?atrv/m.mid*100:NaN;
    if(Number.isFinite(atrPct)&&atrPct>0&&atrPct<=25){
      sl=side==='LONG'?m.mid-SL_ATR*atrv:m.mid+SL_ATR*atrv;
      tp=side==='LONG'?m.mid+TP_ATR*atrv:m.mid-TP_ATR*atrv;
      if(sl<=0||tp<=0){sl=null;tp=null;rr=null;diagnostics.push('SL_TP_NONPOSITIVE')}
      else{
        const risk=Math.abs(m.mid-sl),reward=Math.abs(tp-m.mid);
        rr=risk>0?reward/risk:null;
        if(Math.abs(sl-m.mid)<Math.max(atrv*0.05,m.mid*0.00005))diagnostics.push('SL_TOO_CLOSE');
        if(Math.abs(tp-m.mid)<Math.max(atrv*0.05,m.mid*0.00005))diagnostics.push('TP_TOO_CLOSE');
        if(Number.isFinite(rr)&&rr<MIN_RR)diagnostics.push(`RR<${MIN_RR}`);
      }
    }else diagnostics.push('ATR_SANITY_FAIL');
  }else diagnostics.push('ATR_UNAVAILABLE');

  // Entry distance and diagnostic RR are ranking inputs, NOT hard position-data failures.
  // A live position is copy-eligible when its direction, entry and current market price are valid.
  return{
    eligible:true,
    reason:dist>MAX_ENTRY_DIST?`ENTRY_DISTANCE>${MAX_ENTRY_DIST}%`:'READY',
    side,coin:String(pos?.coin||''),sourceEntry:source,entry:m.mid,distancePct:dist,
    sl,tp,rr,atr:Number.isFinite(atrv)?atrv:null,atrPct,
    maxHoldHours:MAX_HOLD,positionAgeHours:ageH,
    diagnostics
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

async function runLimited(items, worker, concurrency){
  const out=new Array(items.length), errors=[]; let next=0;
  async function runner(){
    while(true){const i=next++; if(i>=items.length)break; try{out[i]=await worker(items[i],i)}catch(e){errors.push({item:items[i],error:e})}}
  }
  await Promise.all(Array.from({length:Math.max(1,concurrency)},runner));
  return{out,errors};
}

function opportunityScore(x){
  const m=x.metrics||{},p=x.plan||{};
  let s=Number(x.qualityScore||0)*0.50;
  const trades=Number(m.closedTrades||0);
  s+=Math.min(12,Math.max(0,trades/40*12));
  if(p){
    const dist=Number(p.distancePct),age=Number(p.positionAgeHours);
    if(Number.isFinite(dist)){
      const dScore=dist<=MAX_ENTRY_DIST
        ?12*(1-dist/Math.max(MAX_ENTRY_DIST,.01))
        :Math.max(0,12-Math.min(12,(dist-MAX_ENTRY_DIST)/Math.max(MAX_ENTRY_DIST,.01)*6));
      s+=dScore;
    }
    if(Number.isFinite(age))s+=Math.max(0,10-Math.min(10,age/12*10));
    const lev=Number(x.position?.leverage?.value||x.position?.leverage||x.position?.leverageValue||0);
    if(lev>0)s+=Math.min(6,Math.log10(lev+1)*4);
    if(Number.isFinite(p.rr)&&p.rr>=MIN_RR)s+=8;
    if(Array.isArray(p.diagnostics)&&p.diagnostics.length)s-=Math.min(4,p.diagnostics.length*.75);
    if(p.marketSource==='POSITION_MARK_PX')s-=1;
  }
  if(m.maxLosingStreak>MAX_LOSING_STREAK)s-=8;
  if(m.invalidLifecycle>0)s-=Math.min(8,m.invalidLifecycle*2);
  return Math.max(0,Math.min(100,s));
}

async function enrichOne(x,now){
  try{
    const positions=await position(x.address);
    if(!positions.length){x.enrichmentStatus='NO_POSITION';x.position=null;x.copyabilityScore=0;return x}
    const opportunities=[];
    for(const p of positions){
      const coin=String(p.coin||''); if(!coin)continue;
      try{
        let marketPrice=Number(p?.markPx||p?.markPrice||0);
        let bookData=null;
        try{
          bookData=await book(coin);
          marketPrice=bookData.mid;
        }catch(e){
          if(!(marketPrice>0))throw e;
          console.log(`[POSITION][BOOK_FALLBACK] ${short(x.address)} ${coin} markPx=${marketPrice}`);
        }
        let atrv=null;
        try{atrv=await atr(coin,now)}catch(e){
          console.log(`[POSITION][ATR_DIAGNOSTIC] ${short(x.address)} ${coin} ${category(e)} :: ${e.message}`);
        }
        const q={...x,position:p};
        const pl=plan(p,{mid:marketPrice},atrv,now);
        pl.positionValueUsd=Math.abs(Number(p.szi||0))*marketPrice;
        pl.marketSource=bookData?'L2_BOOK':'POSITION_MARK_PX';
        q.plan=pl;
        q.positionAgeHours=pl.positionAgeHours;
        q.copyabilityScore=Math.round(opportunityScore(q));
        q.enrichmentStatus='COPY_READY';
        opportunities.push(q);
      }catch(e){
        console.log(`[POSITION][WARN] ${short(x.address)} ${coin} ${category(e)} :: ${e.message}`);
      }
    }
    if(!opportunities.length)throw new Error('ALL_OPEN_POSITIONS_UNREADABLE');
    opportunities.sort((a,b)=>opportunityScore(b)-opportunityScore(a));
    Object.assign(x,opportunities[0]);
    x.openPositionCount=positions.length;
    return x;
  }catch(e){
    x.plan=null;x.copyabilityScore=0;x.enrichmentStatus=`POSITION_DATA_INVALID:${category(e)}`;x.enrichmentError=String(e.message||e);return x;
  }
}

async function enrichBatch(pool,now){
  const out=[]; let idx=0;
  async function worker(){
    while(true){const i=idx++;if(i>=pool.length)break;const x=await enrichOne(pool[i],now);out.push(x);await sleep(POSITION_BETWEEN)}
  }
  await Promise.all(Array.from({length:Math.max(1,POSITION_CONCURRENCY)},worker));
  return out;
}

async function main(){
  const t0=Date.now();
  console.log(`[HUNTER V5.15-COPY5-FIXED][START] ${JSON.stringify({lookbackDays:LOOKBACK_DAYS,prefilter:PREFILTER_SIZE,statTarget:STAT_SCAN_TARGET,copyTarget:POSITION_TARGET})}`);
  let d;
  try{d=await discover()}catch(e){console.error(`[DISCOVERY][ERROR] ${e.message}`);await telegram(`🟣 HYPERLIQUID TRADER HUNTER V5.15-COPY5-FIXED\n📡 READ-ONLY | NO ORDERS\n━━━━━━━━━━━━━━━━━━\n❌ DISCOVERY ERROR\n${e.message}`);process.exitCode=1;return}

  const candidates=d.candidates.slice(0,PREFILTER_SIZE);
  const startTime=Date.now()-LOOKBACK_DAYS*86400000,now=Date.now();
  const scanned=[],errors=[],seen=new Set();
  let cursor=0;
  let ready=[];
  const safetyBlocks={},softBlocks={};

  async function scanChunk(chunk){
    for(const a of chunk){
      if(seen.has(a))continue;
      seen.add(a);
      try{
        const f=await getFills(a,startTime,now),r=reconstruct(f.fills),m=metrics(f.fills,r),sg=safetyGate(m,f.truncated);
        const x={address:a,metrics:m,safety:sg,truncated:f.truncated,qualityScore:Math.round(qualityScore(m)),softFlags:softFlags(m)};
        scanned.push(x);
        for(const z of sg.reasons)safetyBlocks[z]=(safetyBlocks[z]||0)+1;
        for(const z of x.softFlags)softBlocks[z]=(softBlocks[z]||0)+1;
      }catch(e){errors.push({address:a,cat:category(e),message:String(e.message||e)})}
      await sleep(BETWEEN);
    }
  }

  // Scan in bounded tranches. We only spend deep-position calls on statistically safe traders.
  while(cursor<candidates.length && ready.length<POSITION_TARGET){
    const chunk=candidates.slice(cursor,Math.min(candidates.length,cursor+Math.max(1,cursor===0?STAT_SCAN_TARGET:STAT_CHUNK_SIZE)));
    await scanChunk(chunk);
    cursor+=chunk.length;

    const safe=scanned.filter(x=>x.safety.ok).sort(rankStat);
    const alreadyEnriched=new Set(ready.map(x=>x.address));
    const pool=safe.filter(x=>!alreadyEnriched.has(x.address)).slice(0,Math.max(ENRICH_POOL_SIZE,POSITION_TARGET*6));
    if(pool.length){
      const enriched=await enrichBatch(pool,now);
      const newlyReady=enriched.filter(x=>x.enrichmentStatus==='COPY_READY');
      ready.push(...newlyReady);
      ready.sort((a,b)=>(opportunityScore(b)-opportunityScore(a))||rankStat(a,b));
      ready=ready.slice(0,POSITION_TARGET);
    }

    console.log(`[PIPELINE] scanned=${scanned.length} safe=${safe.length} deep=${Math.min(safe.length,Math.max(ENRICH_POOL_SIZE,POSITION_TARGET*6))} ready=${ready.length}/${POSITION_TARGET} cursor=${cursor}/${candidates.length}`);
  }

  const finalists=ready.sort((a,b)=>(opportunityScore(b)-opportunityScore(a))||rankStat(a,b)).slice(0,POSITION_TARGET);
  const selected=AUTO_SELECT&&finalists.length?finalists[0]:null;
  const topSafety=Object.entries(safetyBlocks).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([k,v])=>`${k}:${v}`).join(' | ')||'none';
  const topSoft=Object.entries(softBlocks).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([k,v])=>`${k}:${v}`).join(' | ')||'none';

  const lines=['🟣 HYPERLIQUID TRADER HUNTER V5.15-COPY5-FIXED','📡 READ-ONLY | NO ORDERS','━━━━━━━━━━━━━━━━━━',`🔎 Leaderboard: ${d.discovered}`,`⚡ Prefilter: ${candidates.length}`,`📊 Statistical scanned: ${scanned.length}/${cursor}`,`⚠️ Scan failures: ${errors.length}`,`🛡️ Safety-passed: ${scanned.filter(x=>x.safety.ok).length}`,`🧠 Position deep-scan: ${scanned.filter(x=>x.safety.ok).length}`,`🏆 Copy candidates: ${finalists.length}/${POSITION_TARGET}`,`🟢 Auto-selected: ${selected?'1':'0'}`,`⏱ Total: ${((Date.now()-t0)/1000).toFixed(1)}s`,'','🧱 TOP SAFETY BLOCKS',topSafety,'📌 SOFT DIAGNOSTICS',topSoft,'','🏆 TOP COPY-TRADE CANDIDATES'];

  if(!finalists.length)lines.push('No verified current open position was found among the scanned qualified traders.');
  finalists.forEach((x,i)=>{
    const p=x.plan,m=x.metrics,lev=Number(x.position?.leverage?.value||x.position?.leverage?.rawUsd||x.position?.leverage||x.position?.leverageValue||0);
    lines.push('',`#${i+1} ${x.address}`,`🟢 COPY READY | Opportunity=${Math.round(opportunityScore(x))}/100 | Quality=${x.qualityScore}/100`,`📌 ${p.coin} | ${p.side}`,`💵 Trader Entry=${fmt(p.sourceEntry)} | Current=${fmt(p.entry)} | Distance=${pct(p.distancePct,2)}`,`⚙️ Trader Leverage=${fmt(lev,2)}x | Size=${fmt(Math.abs(Number(x.position?.szi||0)),4)} | Age=${fmt(p.positionAgeHours)}h`,`🎯 Diagnostic SL=${fmt(p.sl)} | TP=${fmt(p.tp)} | RR=${fmt(p.rr)}`,`🧪 Market=${p.marketSource||'n/a'} | Diagnostics=${p.diagnostics?.length?p.diagnostics.join(','):'none'}`,`📈 7D trades=${m.closedTrades} | WR=${pct(m.winRate)} | PnL=${fmt(m.pnl)} | PF=${fmt(m.profitFactor)} | activeDays=${m.activeDays}`);
  });
  lines.push('','🚀 AUTO SELECTED COPY TRADE');
  if(selected){const p=selected.plan,lev=Number(selected.position?.leverage?.value||selected.position?.leverage?.rawUsd||selected.position?.leverage||selected.position?.leverageValue||0);lines.push(`1️⃣ ${selected.address}`,`📌 ${p.coin} | ${p.side}`,`💵 Entry=${fmt(p.sourceEntry)} | Current=${fmt(p.entry)}`,`⚙️ Trader leverage=${fmt(lev,2)}x`,`🏆 Opportunity=${Math.round(opportunityScore(selected))}/100 | Quality=${selected.qualityScore}/100`)}else lines.push('None — no verified current position found.');
  if(errors.length){lines.push('','🧪 SAMPLE SCAN ERRORS');errors.slice(0,8).forEach(e=>lines.push(`${short(e.address)} → ${e.cat} → ${e.message.slice(0,160)}`))}
  lines.push('','ℹ️ Up to five REAL current positions are selected; fewer means fewer were actually found.','ℹ️ Entry distance, RR, SL/TP proximity and ATR are ranking/diagnostic inputs, not position-data hard failures.','ℹ️ Source TP/SL is never copied.','ℹ️ NO ORDERS are created by this worker.',`🕐 ${new Date().toISOString()}`);
  console.log(`[HUNTER V5.15-COPY5-FIXED][DONE] candidates=${candidates.length} scanned=${scanned.length} errors=${errors.length} copy5=${finalists.length} selected=${selected?short(selected.address):'none'}`);
  await telegram(lines.join('\n'));
}

main().catch(async e=>{console.error(`[HUNTER V5.15-COPY5][FATAL] ${e.stack||e}`);await telegram(`🟣 HYPERLIQUID TRADER HUNTER V5.15-COPY5\n📡 READ-ONLY | NO ORDERS\n━━━━━━━━━━━━━━━━━━\n💥 FATAL ERROR\n${String(e.message||e).slice(0,1000)}`);process.exitCode=1});
