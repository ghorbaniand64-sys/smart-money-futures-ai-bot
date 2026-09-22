// Hyperliquid Trader Hunter V5.20-CURRENT-POSITION-TIMING-RATE-LIMIT-SAFE - READ ONLY
// Professional ranking: statistical quality + current-position copyability.
// NO ORDERS. NO PRIVATE KEYS.

const API_URL = process.env.HYPERLIQUID_API_URL || 'https://api.hyperliquid.xyz/info';
const DISCOVERY_URL = process.env.HYPERLIQUID_HUNTER_DISCOVERY_URL || 'https://stats-data.hyperliquid.xyz/Mainnet/leaderboard';
const DISCOVERY_ENABLED = String(process.env.HYPERLIQUID_HUNTER_DISCOVERY_ENABLED ?? 'true').toLowerCase() === 'true';

const LOOKBACK_DAYS = num('HYPERLIQUID_HUNTER_LOOKBACK_DAYS', 7);
const MAX_CANDIDATES = integer('HYPERLIQUID_HUNTER_MAX_CANDIDATES', 2000);
const POSITION_DISCOVERY_TARGET = integer('HYPERLIQUID_HUNTER_POSITION_DISCOVERY_TARGET', 1000);
const POSITION_PROBE_MAX = integer('HYPERLIQUID_HUNTER_POSITION_PROBE_MAX', 2000);
const POSITION_COHORT_SIZE = integer('HYPERLIQUID_HUNTER_POSITION_COHORT_SIZE', 250);
const POSITION_PROBE_CONCURRENCY = integer('HYPERLIQUID_HUNTER_POSITION_PROBE_CONCURRENCY', 8);
const POSITION_PROBE_BATCH = integer('HYPERLIQUID_HUNTER_POSITION_PROBE_BATCH', 250);
const POSITION_NEAR_TARGET = integer('HYPERLIQUID_HUNTER_POSITION_NEAR_TARGET', 10);
const HISTORY_VERIFY_TARGET = integer('HYPERLIQUID_HUNTER_HISTORY_VERIFY_TARGET', 60);
const HISTORY_VERIFY_EXPAND = integer('HYPERLIQUID_HUNTER_HISTORY_VERIFY_EXPAND', 30);
const PREFILTER_SIZE = integer('HYPERLIQUID_HUNTER_PREFILTER_SIZE', 500);
const STAT_SCAN_TARGET = integer('HYPERLIQUID_HUNTER_STAT_SCAN_TARGET', 120);
const MIN_COPY5 = integer('HYPERLIQUID_HUNTER_MIN_COPY5', 5);
const ENRICH_POOL_SIZE = integer('HYPERLIQUID_HUNTER_ENRICH_POOL_SIZE', 40);
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
  if(!DISCOVERY_ENABLED){
    const candidates=[...map.keys()].slice(0,Math.min(POSITION_PROBE_MAX,Math.max(POSITION_DISCOVERY_TARGET,1)));
    return{discovered:map.size,candidates,source:'manual_only'};
  }

  const data=await fetchJson(DISCOVERY_URL,{},'leaderboard discovery');
  const rows=Array.isArray(data?.leaderboardRows)?data.leaderboardRows:[];
  const valid=[];
  for(const row of rows){
    if(!addr(row?.ethAddress))continue;
    const a=norm(row.ethAddress);
    map.set(a,row);
    valid.push(a);
  }

  // IMPORTANT: current-position discovery is intentionally decoupled from
  // HYPERLIQUID_HUNTER_MAX_CANDIDATES / PREFILTER_SIZE. Those legacy limits
  // must never shrink the wallet pool used to find REAL open positions.
  const parsed=[...new Set(valid)].map(a=>map.get(a)).filter(Boolean);
  const metricValue=(row,window,field)=>{
    const wp=Array.isArray(row?.windowPerformances)?row.windowPerformances:[];
    const hit=wp.find(x=>Array.isArray(x)&&String(x[0]).toLowerCase()===window);
    const n=Number(hit?.[1]?.[field]);
    return Number.isFinite(n)?n:0;
  };
  const by=(fn)=>[...parsed].sort((a,b)=>{
    const d=fn(b)-fn(a);
    return d||hunterPreScore(b)-hunterPreScore(a);
  }).map(r=>norm(r.ethAddress));

  const byWeekPnl=by(r=>metricValue(r,'week','pnl'));
  const byDayPnl=by(r=>metricValue(r,'day','pnl'));
  const byWeekRoi=by(r=>metricValue(r,'week','roi'));
  const byDayRoi=by(r=>metricValue(r,'day','roi'));
  const byWeekVol=by(r=>metricValue(r,'week','vlm'));
  const byDayVol=by(r=>metricValue(r,'day','vlm'));
  const byBlended=[...parsed].sort((a,b)=>hunterPreScore(b)-hunterPreScore(a)).map(r=>norm(r.ethAddress));

  const target=Math.max(1,Math.min(POSITION_DISCOVERY_TARGET,POSITION_PROBE_MAX));
  const cap=Math.max(target,POSITION_PROBE_MAX);
  const out=new Set([...SEEDS,...MANUAL].filter(addr).map(norm));
  const add=(list,limit=POSITION_COHORT_SIZE)=>{
    let n=0;
    for(const a of list){
      if(out.size>=cap||n>=limit)break;
      if(!out.has(a)){out.add(a);n++;}
    }
  };

  // Stratified cohorts prevent one metric (for example volume) from crowding
  // out profitable/active traders in the current-position search.
  add(byWeekPnl);add(byDayPnl);add(byWeekRoi);add(byDayRoi);add(byWeekVol);add(byDayVol);
  add(byBlended,POSITION_COHORT_SIZE);

  // Fill to the actual probe target from the blended leaderboard, then allow
  // expansion up to POSITION_PROBE_MAX if the first 1000 do not yield enough
  // near-entry positions. This is the key V5.18 fix for the old 30-wallet cap.
  if(out.size<target)add(byBlended,Number.POSITIVE_INFINITY);
  if(out.size<target){
    for(const a of valid){
      if(out.size>=target)break;
      out.add(a);
    }
  }
  // Build an expansion pool up to POSITION_PROBE_MAX without ever consulting
  // MAX_CANDIDATES/PREFILTER_SIZE.
  if(out.size<cap){
    for(const a of byBlended){
      if(out.size>=cap)break;
      out.add(a);
    }
  }

  return{
    discovered:new Set(valid).size,
    candidates:[...out].slice(0,cap),
    source:'leaderboard:STRATIFIED_WEEK_PNL+DAY_PNL+WEEK_ROI+DAY_ROI+VOLUME+BLENDED'
  };
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
async function allMids(){
  const x=await info({type:'allMids'},'allMids');
  if(!x||typeof x!=='object')throw new Error('allMids: invalid response');
  return x;
}

async function probeCurrentPositions(addresses,mids){
  const out=[]; let idx=0;
  async function worker(){
    while(true){
      const i=idx++; if(i>=addresses.length)break;
      const address=addresses[i];
      try{
        const positions=await position(address);
        for(const p of positions){
          const coin=String(p?.coin||'');
          const entry=Number(p?.entryPx||0), mid=Number(mids?.[coin]);
          if(!coin||!Number.isFinite(entry)||entry<=0||!Number.isFinite(mid)||mid<=0)continue;
          const distancePct=Math.abs(mid-entry)/entry*100;
          out.push({address,position:p,coin,mid,distancePct});
        }
      }catch(e){
        console.log(`[POSITION-PROBE][WARN] ${short(address)} ${category(e)} :: ${e.message}`);
      }
    }
  }
  await Promise.all(Array.from({length:Math.max(1,POSITION_PROBE_CONCURRENCY)},worker));
  out.sort((a,b)=>a.distancePct-b.distancePct);
  return out;
}

function leverageValue(pos){
  const v=pos?.leverage;
  if(v&&typeof v==='object')return Number(v.value ?? v.rawUsd ?? v.leverage ?? 0);
  return Number(pos?.leverageValue ?? v ?? 0);
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

function positionTimingFromFills(fills, coin, positionSide, currentSize){
  const rows=(Array.isArray(fills)?fills:[])
    .filter(f=>String(f?.coin||'')===String(coin||''))
    .map(f=>({
      time:Number(f?.time||0),
      delta:delta(f),
      px:Number(f?.px||0),
      dir:String(f?.dir||''),
      side:String(f?.side||'')
    }))
    .filter(x=>x.time>0&&Number.isFinite(x.delta)&&x.delta!==0)
    .sort((a,b)=>a.time-b.time);
  if(!rows.length)return {openTime:NaN,lastAddTime:NaN,observedFrom:NaN,source:'unavailable'};

  const want=String(positionSide||'').toUpperCase()==='LONG'?1:-1;
  let net=0, openTime=NaN, lastAddTime=NaN, observedFrom=rows[0].time;
  for(const f of rows){
    const before=net, after=net+f.delta;
    if(want>0){
      if(before<=0 && after>0)openTime=f.time;
      if(before>0 && f.delta>0)lastAddTime=f.time;
      if(after<=0 && before>0){openTime=NaN;lastAddTime=NaN}
    }else{
      if(before>=0 && after<0)openTime=f.time;
      if(before<0 && f.delta<0)lastAddTime=f.time;
      if(after>=0 && before<0){openTime=NaN;lastAddTime=NaN}
    }
    net=after;
  }
  // If the lookback begins while the position was already open, lifecycle reconstruction
  // cannot prove the original opening time. In that case expose the observed window start.
  if(!Number.isFinite(openTime)){
    openTime=observedFrom;
  }
  if(!Number.isFinite(lastAddTime))lastAddTime=openTime;
  return {openTime,lastAddTime,observedFrom,source:'userFills'};
}
function isoUtc(ms){return Number.isFinite(Number(ms))&&Number(ms)>0?new Date(Number(ms)).toISOString().replace('T',' ').replace('.000Z',' UTC'):'n/a'}
function ageHours(now,ms){return Number.isFinite(Number(ms))&&Number(ms)>0?Math.max(0,(now-Number(ms))/3600000):NaN}

function plan(pos,m,atrv,now){
  const s=Number(pos?.szi||0),source=Number(pos?.entryPx||0);
  if(!Number.isFinite(s)||s===0)throw new Error('position: invalid size');
  const side=s>0?'LONG':'SHORT';
  if(!Number.isFinite(source)||source<=0)throw new Error('position: invalid entryPx');
  if(!Number.isFinite(m.mid)||m.mid<=0)throw new Error('BOOK_MID_INVALID');
  const dist=Math.abs(m.mid-source)/source*100;
  let sl=NaN,tp=NaN,rr=NaN,atrPct=NaN;
  const diagnostics=[];
  if(Number.isFinite(atrv)&&atrv>0){
    atrPct=atrv/m.mid*100;
    if(Number.isFinite(atrPct)&&atrPct>0&&atrPct<=25){
      sl=side==='LONG'?m.mid-SL_ATR*atrv:m.mid+SL_ATR*atrv;
      tp=side==='LONG'?m.mid+TP_ATR*atrv:m.mid-TP_ATR*atrv;
      const risk=Math.abs(m.mid-sl),reward=Math.abs(tp-m.mid);
      rr=risk>0?reward/risk:NaN;
      if(sl<=0||tp<=0)diagnostics.push('SL_TP_NONPOSITIVE');
    }else diagnostics.push('ATR_SANITY_FAIL');
  }else diagnostics.push('ATR_UNAVAILABLE');
  if(dist>MAX_ENTRY_DIST)diagnostics.push(`ENTRY_DISTANCE>${MAX_ENTRY_DIST}%`);
  if(Number.isFinite(sl)&&Math.abs(sl-m.mid)<Math.max(atrv*0.05,m.mid*0.00005))diagnostics.push('SL_TOO_CLOSE');
  if(Number.isFinite(tp)&&Math.abs(tp-m.mid)<Math.max(atrv*0.05,m.mid*0.00005))diagnostics.push('TP_TOO_CLOSE');
  return{
    // REAL eligibility gate: current entry distance only. Diagnostic SL/TP/RR never blocks a real current position.
    eligible:dist<=MAX_ENTRY_DIST,
    reason:dist>MAX_ENTRY_DIST?`ENTRY_DISTANCE>${MAX_ENTRY_DIST}%`:'READY',
    side,coin:String(pos?.coin||''),sourceEntry:source,entry:m.mid,distancePct:dist,
    sl,tp,rr,atr:atrv,atrPct,maxHoldHours:MAX_HOLD,positionAgeHours:(Number(pos?.timestamp||pos?.entryTimestamp||0)>0?Math.max(0,(now-Number(pos?.timestamp||pos?.entryTimestamp||0))/3600000):NaN),
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
  let s=Number(x.qualityScore||0)*0.42;
  s+=Math.min(20,Math.max(0,Number(x.metrics?.closedTrades||0)/40*20));
  if(p){
    const dist=Number(p.distancePct); const rr=Number(p.rr); const age=Number(p.positionAgeHours);
    if(Number.isFinite(dist))s+=Math.max(0,18-Math.min(18,dist/Math.max(MAX_ENTRY_DIST,.01)*18));
    if(Number.isFinite(rr))s+=Math.min(15,Math.max(0,rr/MIN_RR*15));
    if(Number.isFinite(age))s+=Math.max(0,10-Math.min(10,age/12*10));
    if(p.positionValueUsd>0)s+=Math.min(5,Math.log10(Math.max(1,p.positionValueUsd))*1.5);
  }
  if(m.maxLosingStreak>MAX_LOSING_STREAK)s-=10;
  if(m.invalidLifecycle>0)s-=Math.min(10,m.invalidLifecycle*2);
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
        const [bk,av]=await Promise.all([book(coin),atr(coin,now)]);
        const q={...x,position:p};
        const pl=plan(p,bk,av,now);
        pl.positionValueUsd=Math.abs(Number(p.szi||0))*Number(bk.mid||0);
        q.plan=pl;q.copyabilityScore=Math.round(opportunityScore(q));
        q.enrichmentStatus=pl.eligible?'COPY_READY':'POSITION_BLOCKED';
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
  const target=Math.max(1,Math.min(POSITION_DISCOVERY_TARGET,POSITION_PROBE_MAX));
  const probeMax=Math.max(target,POSITION_PROBE_MAX);
  console.log(`[HUNTER V5.20-CURRENT-POSITION-TIMING-RATE-LIMIT-SAFE][START] ${JSON.stringify({legacyMaxCandidates:MAX_CANDIDATES,positionTarget:target,positionProbeMax:probeMax,cohortSize:POSITION_COHORT_SIZE,nearTarget:POSITION_NEAR_TARGET})}`);
  let d;
  try{d=await discover()}catch(e){
    console.error(`[DISCOVERY][ERROR] ${e.message}`);
    await telegram(`🟣 HYPERLIQUID TRADER HUNTER V5.20-CURRENT-POSITION-TIMING-RATE-LIMIT-SAFE\n📡 READ-ONLY | NO ORDERS\n━━━━━━━━━━━━━━━━━━\n❌ DISCOVERY ERROR\n${e.message}`);process.exitCode=1;return;
  }
  const addresses=d.candidates.slice(0,Math.min(target,d.candidates.length));
  const now=Date.now(),startTime=now-LOOKBACK_DAYS*86400000,errors=[];
  console.log(`[POSITION-POOL] target=${target} max=${probeMax} candidates=${d.candidates.length} legacyMaxCandidates=${MAX_CANDIDATES}`);
  let mids={};
  try{mids=await allMids()}catch(e){errors.push({cat:category(e),message:e.message});}
  let positionHits=[];
  if(Object.keys(mids).length){positionHits=await probeCurrentPositions(addresses,mids)}

  // Expand current-position discovery in tranches when the first tranche does not produce enough near-entry positions.
  let cursor=addresses.length;
  while(positionHits.filter(x=>x.distancePct<=MAX_ENTRY_DIST).length<POSITION_NEAR_TARGET && cursor<Math.min(d.candidates.length,probeMax)){
    const batch=d.candidates.slice(cursor,Math.min(cursor+POSITION_PROBE_BATCH,d.candidates.length));
    console.log(`[POSITION-PROBE] expanding ${cursor+1}-${cursor+batch.length}/${d.candidates.length}`);
    const more=await probeCurrentPositions(batch,mids);
    positionHits.push(...more);cursor+=batch.length;
  }
  positionHits.sort((a,b)=>a.distancePct-b.distancePct);
  const near=positionHits.filter(x=>x.distancePct<=MAX_ENTRY_DIST);
  const traderMap=new Map();
  for(const h of near){
    const prev=traderMap.get(h.address);if(!prev||h.distancePct<prev.distancePct)traderMap.set(h.address,h);
  }
  const currentTraders=[...traderMap.values()].sort((a,b)=>a.distancePct-b.distancePct);

  // Historical verification happens ONLY after a real current position has been found.
  // To avoid the 400+ second / HTTP-429 pattern, verify in bounded adaptive batches
  // and cache the fills so timing/deep-scan never fetches the same history twice.
  const scanned=[];
  const verifyLimit=Math.min(currentTraders.length,Math.max(1,HISTORY_VERIFY_TARGET));
  const verifyTrader=async(h,i)=>{
    try{
      const f=await getFills(h.address,startTime,now),r=reconstruct(f.fills),m=metrics(f.fills,r),sg=safetyGate(m,f.truncated);
      const x={address:h.address,metrics:m,safety:sg,truncated:f.truncated,qualityScore:Math.round(qualityScore(m)),softFlags:softFlags(m),probe:h,historyFills:f.fills};
      scanned.push(x);
      console.log(`[VERIFY] ${i+1}/${currentTraders.length} ${short(h.address)} ${h.coin} ${h.distancePct.toFixed(2)}% trades=${m.closedTrades} Q=${x.qualityScore} ${sg.ok?'PASS':'BLOCK '+sg.reasons.join(',')}`);
    }catch(e){errors.push({address:h.address,cat:category(e),message:String(e.message||e)});}
  };
  for(let i=0;i<verifyLimit;i++){
    await verifyTrader(currentTraders[i],i);
    if(i+1<verifyLimit)await sleep(BETWEEN);
  }
  // If the first batch does not produce five strong traders, expand only as needed.
  if(scanned.filter(x=>x.safety.ok && (x.metrics.closedTrades>=12 || x.metrics.activeDays>=2)).length<MIN_COPY5 && verifyLimit<currentTraders.length){
    const extraLimit=Math.min(currentTraders.length,verifyLimit+Math.max(1,HISTORY_VERIFY_EXPAND));
    for(let i=verifyLimit;i<extraLimit;i++){
      await verifyTrader(currentTraders[i],i);
      if(i+1<extraLimit)await sleep(BETWEEN);
    }
  }

  // Strong = safety clean + meaningful trading history. Low activity is not allowed to pass solely on one lucky day.
  const strong=scanned.filter(x=>x.safety.ok && (x.metrics.closedTrades>=12 || x.metrics.activeDays>=2));
  const enriched=[];
  for(const x of strong){
    const h=x.probe;
    try{
      const q={...x,position:h.position};
      const bk={mid:h.mid,bid:h.mid,ask:h.mid};
      let av=NaN;try{av=await atr(h.coin,now)}catch(e){console.log(`[ATR][WARN] ${short(x.address)} ${h.coin} ${category(e)} :: ${e.message}`)}
      q.plan=plan(h.position,bk,av,now);
      q.plan.positionValueUsd=Math.abs(Number(h.position?.szi||0))*h.mid;
      try{
        const timing=positionTimingFromFills(x.historyFills||[],h.coin,q.plan.side,Number(h.position?.szi||0));
        q.positionTiming=timing;
        q.plan.openTime=timing.openTime;
        q.plan.lastAddTime=timing.lastAddTime;
        q.plan.positionAgeHours=ageHours(now,timing.openTime);
        q.plan.openTimeLabel=isoUtc(timing.openTime);
        q.plan.lastAddTimeLabel=isoUtc(timing.lastAddTime);
        q.plan.ageLabel=Number.isFinite(q.plan.positionAgeHours)?`${q.plan.positionAgeHours.toFixed(1)}h`: 'n/a';
      }catch(e){
        q.positionTiming={openTime:NaN,lastAddTime:NaN,observedFrom:NaN,source:'fill_lookup_failed'};
        console.log(`[TIMING][WARN] ${short(x.address)} ${h.coin} ${category(e)} :: ${e.message}`);
      }
      q.copyabilityScore=Math.round(opportunityScore(q));
      q.enrichmentStatus='COPY_READY';
      enriched.push(q);
    }catch(e){errors.push({address:x.address,cat:category(e),message:String(e.message||e)});}
  }
  enriched.sort((a,b)=>(opportunityScore(b)-opportunityScore(a))||rankStat(a,b));
  const finalists=enriched.slice(0,MIN_COPY5),selected=AUTO_SELECT?finalists[0]:null;

  const safetyBlocks={},softBlocks={};
  for(const x of scanned){for(const r of x.safety.reasons)safetyBlocks[r]=(safetyBlocks[r]||0)+1;for(const r of x.softFlags)softBlocks[r]=(softBlocks[r]||0)+1}
  const topSafety=Object.entries(safetyBlocks).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([k,v])=>`${k}:${v}`).join(' | ')||'none';
  const topSoft=Object.entries(softBlocks).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([k,v])=>`${k}:${v}`).join(' | ')||'none';

  const lines=['🟣 HYPERLIQUID TRADER HUNTER V5.18-STRATIFIED-CURRENT-POSITION-FIRST','📡 READ-ONLY | NO ORDERS','━━━━━━━━━━━━━━━━━━',`🔎 Leaderboard: ${d.discovered}`,`⚡ Position discovery: ${Math.min(cursor,d.candidates.length)}/${d.candidates.length}`,`📌 Open positions found: ${positionHits.length}`,`🎯 Positions within ${MAX_ENTRY_DIST}%: ${near.length}`,`📊 Statistical verification: ${scanned.length}/${currentTraders.length}`,`🛡️ Strong traders: ${strong.length}`,`🧠 Current-position deep scan: ${enriched.length}`,`🏆 Copy candidates: ${finalists.length}/${MIN_COPY5}`,`🟢 Auto-selected: ${selected?'1':'0'}`,`⚠️ Errors: ${errors.length}`,`⏱ Total: ${((Date.now()-t0)/1000).toFixed(1)}s`,'','🧱 TOP SAFETY BLOCKS',topSafety,'📌 SOFT DIAGNOSTICS',topSoft,'','🏆 TOP COPY-TRADE CANDIDATES'];
  if(!finalists.length)lines.push(`No strong trader with a REAL current position inside the ${MAX_ENTRY_DIST}% entry-distance window was found in this scan.`);
  finalists.forEach((x,i)=>{
    const p=x.plan,m=x.metrics;
    lines.push('',`#${i+1} ${x.address}`,`🟢 COPY READY | Opportunity=${Math.round(opportunityScore(x))}/100 | Quality=${x.qualityScore}/100`,`📌 ${p.coin} | ${p.side}`,`💵 Trader Entry=${fmt(p.sourceEntry)} | Current=${fmt(p.entry)} | Distance=${pct(p.distancePct,2)}`,`⚙️ Trader Leverage=${fmt(leverageValue(x.position),2)}x | Size=${fmt(Math.abs(Number(x.position?.szi||0)),4)}`,`🕐 Opened=${p.openTimeLabel||isoUtc(p.openTime)} | Age=${fmt(p.positionAgeHours,1)}h`,`➕ Last Add=${p.lastAddTimeLabel||isoUtc(p.lastAddTime)}`,`🎯 Diagnostic SL=${fmt(p.sl)} | TP=${fmt(p.tp)} | RR=${fmt(p.rr)} | ${p.diagnostics.length?p.diagnostics.join(','):'none'}`,`📈 7D trades=${m.closedTrades} | WR=${pct(m.winRate)} | PnL=${fmt(m.pnl)} | PF=${fmt(m.profitFactor)} | activeDays=${m.activeDays}`,`🧯 Streak=${m.maxLosingStreak} | liq=${m.liquidations} | lifecycleErr=${m.invalidLifecycle}`);
  });
  lines.push('','🚀 AUTO SELECTED COPY TRADE');
  if(selected){const p=selected.plan;lines.push(`1️⃣ ${selected.address}`,`📌 ${p.coin} | ${p.side}`,`💵 Trader Entry=${fmt(p.sourceEntry)} | Current=${fmt(p.entry)} | Distance=${pct(p.distancePct,2)}`,`⚙️ Trader leverage=${fmt(leverageValue(selected.position),2)}x`,`🕐 Opened=${selected.plan.openTimeLabel||isoUtc(selected.plan.openTime)} | Age=${fmt(selected.plan.positionAgeHours,1)}h`,`➕ Last Add=${selected.plan.lastAddTimeLabel||isoUtc(selected.plan.lastAddTime)}`,`🏆 Opportunity=${Math.round(opportunityScore(selected))}/100 | Quality=${selected.qualityScore}/100`)}else lines.push('None — no strong current position was within the entry-distance window.');
  if(errors.length){lines.push('','🧪 SAMPLE ERRORS');errors.slice(0,10).forEach(e=>lines.push(`${e.address?short(e.address)+' → ':''}${e.cat} → ${String(e.message||'').slice(0,180)}`))}
  lines.push('','ℹ️ Architecture: stratified leaderboard discovery → broad current-position probe → real entry-distance filter → historical quality verification → position ranking → top five → one auto-selection.','ℹ️ The entry-distance rule is a REAL copy eligibility gate.','ℹ️ Diagnostic SL/TP/RR never blocks a real current position; source TP/SL is never copied.','ℹ️ History verification is adaptive and cached; the same trader history is never fetched twice in one cycle.','ℹ️ NO ORDERS are created by this worker.','ℹ️ Opened/Last Add are derived from Hyperliquid userFills; if the position predates the lookback, Opened is the oldest observed fill.',`🕐 ${new Date().toISOString()}`);
  console.log(`[HUNTER V5.20][DONE] leaderboard=${d.discovered} probed=${cursor} open=${positionHits.length} near=${near.length} verified=${scanned.length} strong=${strong.length} finalists=${finalists.length} selected=${selected?short(selected.address):'none'} errors=${errors.length}`);
  await telegram(lines.join('\n'));
}

main().catch(async e=>{console.error(`[HUNTER V5.19][FATAL] ${e.stack||e}`);await telegram(`🟣 HYPERLIQUID TRADER HUNTER V5.20-CURRENT-POSITION-TIMING-RATE-LIMIT-SAFE\n📡 READ-ONLY | NO ORDERS\n━━━━━━━━━━━━━━━━━━\n💥 FATAL ERROR\n${String(e.message||e).slice(0,1000)}`);process.exitCode=1});
