import fs from 'node:fs/promises';
import path from 'node:path';

// GFTSH V2.1.2 — GLOBAL FUTURES ACTUAL-TRADE RECON / MULTI-SIGNAL
// READ ONLY. NO ORDERS. NO AUTO-COPY. FUTURES ONLY.
// Source authority: Hyperliquid public leaderboard + public user fills + clearinghouseState.
// Current position authority: clearinghouseState ONLY. Stale fills never become a live position.

const VERSION='GFTSH-V3.0-GLOBAL-REPEATABLE-BEHAVIOR-TRACKER';
const BUILD='V3.0-HISTORY-FIRST-30D-HUNTER-DISCOVERY-TOP10-PERSISTENT-LIVE-TRACKING';
const API=process.env.HYPERLIQUID_API_URL||'https://api.hyperliquid.xyz/info';
const LEADERBOARD=process.env.HL_LEADERBOARD_URL||process.env.HYPERLIQUID_HUNTER_DISCOVERY_URL||'https://stats-data.hyperliquid.xyz/Mainnet/leaderboard';
const TG_TOKEN=process.env.TELEGRAM_TOKEN||process.env.TELEGRAM_BOT_TOKEN||'';
const TG_CHAT=process.env.TELEGRAM_CHAT_ID||'';
const TIMEOUT=Number(process.env.GFTSH_REQUEST_TIMEOUT_MS||20000);
const DISCOVERY_LIMIT=Math.max(100,Number(process.env.GFTSH_DISCOVERY_LIMIT||100));
const AUDIT_LIMIT=Math.max(10,Number(process.env.GFTSH_AUDIT_LIMIT||60));
const ACTIVE_AUDIT_LIMIT=Math.max(10,Number(process.env.GFTSH_ACTIVE_AUDIT_LIMIT||40));
const MAX_CONCURRENCY=Math.max(1,Number(process.env.GFTSH_MAX_CONCURRENCY||2));
const MIN_REQUEST_GAP_MS=Math.max(50,Number(process.env.GFTSH_MIN_REQUEST_GAP_MS||350));
const GLOBAL_429_COOLDOWN_MS=Math.max(1000,Number(process.env.GFTSH_GLOBAL_429_COOLDOWN_MS||5000));
const LOOKBACK_HOURS=Math.max(24,Number(process.env.GFTSH_PERFORMANCE_LOOKBACK_HOURS||720));
const MAX_FILL_PAGES=Math.max(2,Number(process.env.GFTSH_MAX_FILL_PAGES||16));
const ENTRY_MAX=Number(process.env.GFTSH_ENTRY_DISTANCE_PCT||0.75);
const WATCH_MAX=Number(process.env.GFTSH_WATCH_DISTANCE_PCT||3);
const FRESH_MIN=Number(process.env.GFTSH_SIGNAL_FRESHNESS_MIN||15);
const MIN_RR=Number(process.env.GFTSH_MIN_RR||2);
const SL_PCT=Number(process.env.GFTSH_MODEL_SL_PCT||0.5);
const TP_R=Number(process.env.GFTSH_MODEL_TP_R||2);
const MIN_TRADES=Number(process.env.GFTSH_MIN_CLOSED_TRADES||8);
const MIN_WR=Number(process.env.GFTSH_MIN_WR||58);
const MIN_PF=Number(process.env.GFTSH_MIN_PF||1.8);
const MAX_DD=Number(process.env.GFTSH_MAX_DD_PCT||25);
const ASYM_MIN_TRADES=Number(process.env.GFTSH_ASYM_MIN_TRADES||20);
const ASYM_MIN_PF=Number(process.env.GFTSH_ASYM_MIN_PF||2.0);
const ASYM_MAX_DD=Number(process.env.GFTSH_ASYM_MAX_DD_PCT||20);
const ASYM_MIN_RECOVERY=Number(process.env.GFTSH_ASYM_MIN_RECOVERY||2);
const ASYM_MAX_TOP1_CONC=Number(process.env.GFTSH_ASYM_MAX_TOP1_CONC_PCT||40);
const ASYM_MAX_TOP3_CONC=Number(process.env.GFTSH_ASYM_MAX_TOP3_CONC_PCT||70);
const COPY_MAX_POSITION=Number(process.env.GFTSH_COPY_MAX_POSITION_PCT||20);
const COPY_MAX_COIN=Number(process.env.GFTSH_COPY_MAX_COIN_PCT||20);
const COPY_MAX_LEVERAGE=Number(process.env.GFTSH_COPY_MAX_LEVERAGE||40);
const ASYM_MIN_RECENT_PF=Number(process.env.GFTSH_ASYM_MIN_RECENT_PF||1.25);
const ASYM_MIN_RECENT_PNL=Number(process.env.GFTSH_ASYM_MIN_RECENT_PNL||0);
const ASYM_MAX_DRIFT_DD=Number(process.env.GFTSH_ASYM_MAX_DRIFT_DD_PCT||30);
const MIN_NOTIONAL=Number(process.env.GFTSH_MIN_SIGNAL_NOTIONAL_USD||100);
const MIN_24H_VOL=Number(process.env.GFTSH_MIN_24H_VOLUME_USD||1000000);
const TOP_WATCH=Math.max(5,Number(process.env.GFTSH_WATCHLIST_SIZE||10));
const MAX_SIGNALS=Math.max(2,Number(process.env.GFTSH_MAX_SIGNALS||5));
const BETWEEN_MS=Number(process.env.GFTSH_BETWEEN_TRADERS_MS||120);
const HL_RETRIES=Math.max(1,Number(process.env.GFTSH_HL_RETRIES||4));
const HL_RETRY_BASE_MS=Math.max(100,Number(process.env.GFTSH_HL_RETRY_BASE_MS||500));
const STATE_FILE=process.env.GFTSH_STATE_FILE||'state/gftsh_v2_2_state.json';
const TG_STATE=process.env.GFTSH_TELEGRAM_STATE_FILE||'state/gftsh_telegram_state.json';
const DIAG_WINDOW_MIN=Math.min(FRESH_MIN,15);
const GLOBAL_ENABLED=String(process.env.GFTSH_GLOBAL_HUNT_ENABLED||'true').toLowerCase()!=='false';
const GLOBAL_SOURCES=String(process.env.GFTSH_GLOBAL_SOURCES||'HYPERLIQUID,OKX,BINANCE,BYBIT').split(',').map(x=>x.trim().toUpperCase()).filter(Boolean);
const OKX_API=process.env.GFTSH_OKX_API_URL||'https://www.okx.com/api/v5';
const GLOBAL_EVENT_LOOKBACK_DAYS=Math.max(7,Number(process.env.GFTSH_GLOBAL_EVENT_LOOKBACK_DAYS||30));
const GLOBAL_EVENT_WINDOW_MIN=Math.max(5,Number(process.env.GFTSH_GLOBAL_EVENT_WINDOW_MIN||180));
const GLOBAL_PRE_EVENT_MIN=Math.max(1,Number(process.env.GFTSH_GLOBAL_PRE_EVENT_MIN||30));
const GLOBAL_PUMP_PCT=Number(process.env.GFTSH_GLOBAL_PUMP_PCT||5);
const GLOBAL_DUMP_PCT=Number(process.env.GFTSH_GLOBAL_DUMP_PCT||5);
const GLOBAL_EVENT_MIN_USD=Number(process.env.GFTSH_GLOBAL_EVENT_MIN_USD||1000000);
const GLOBAL_EVENT_MAX_HOURS=Math.max(1,Number(process.env.GFTSH_GLOBAL_EVENT_MAX_HOURS||12));
const GLOBAL_MIN_REPEAT_EVENTS=Math.max(2,Number(process.env.GFTSH_GLOBAL_MIN_REPEAT_EVENTS||3));
const GLOBAL_MIN_PREPUMP_LEAD_MIN=Math.max(1,Number(process.env.GFTSH_GLOBAL_MIN_PREPUMP_LEAD_MIN||10));
const GLOBAL_EXIT_CAPTURE_MIN=Number(process.env.GFTSH_GLOBAL_EXIT_CAPTURE_MIN||70);
const GLOBAL_EXIT_PEAK_TOLERANCE_MIN=Math.max(1,Number(process.env.GFTSH_GLOBAL_EXIT_PEAK_TOLERANCE_MIN||15));
const GLOBAL_HUNTER_SCORE_MIN=Number(process.env.GFTSH_GLOBAL_HUNTER_SCORE_MIN||70);
const GLOBAL_MIN_DISTINCT_COINS=Math.max(2,Number(process.env.GFTSH_GLOBAL_MIN_DISTINCT_COINS||2));
const GLOBAL_TRACKED_HUNTERS=Math.max(1,Number(process.env.GFTSH_GLOBAL_TRACKED_HUNTERS||10));
const GLOBAL_DISCOVERY_AUDIT_CHUNK=Math.max(10,Number(process.env.GFTSH_GLOBAL_DISCOVERY_AUDIT_CHUNK||40));
const GLOBAL_DISCOVERY_LIMIT=Math.max(20,Number(process.env.GFTSH_GLOBAL_DISCOVERY_LIMIT||100));
const GLOBAL_EVENT_CANDIDATES=Math.max(20,Number(process.env.GFTSH_GLOBAL_EVENT_CANDIDATES||80));
const GLOBAL_EVENT_TRIGGER_PCT=Number(process.env.GFTSH_GLOBAL_EVENT_TRIGGER_PCT||1.5);
const GLOBAL_EVENT_TRIGGER_MINUTES=Math.max(5,Number(process.env.GFTSH_GLOBAL_EVENT_TRIGGER_MINUTES||15));
const GLOBAL_TELEGRAM_MAX_SIGNALS=Math.max(1,Number(process.env.GFTSH_GLOBAL_TELEGRAM_MAX_SIGNALS||5));
const GLOBAL_API_GAP_MS=Math.max(300,Number(process.env.GFTSH_GLOBAL_API_GAP_MS||500));
const GLOBAL_BEHAVIOR_WINDOW='30D';
const GLOBAL_ROTATION_POOL=Math.max(0,Number(process.env.GFTSH_GLOBAL_ROTATION_POOL||0));
const GLOBAL_AUDIT_CHUNK=Math.max(10,Number(process.env.GFTSH_GLOBAL_AUDIT_CHUNK||40));
const GLOBAL_DB_MAX_EVENTS=Math.max(100,Number(process.env.GFTSH_GLOBAL_DB_MAX_EVENTS||2000));
const GLOBAL_DB_MAX_HUNTERS=Math.max(20,Number(process.env.GFTSH_GLOBAL_DB_MAX_HUNTERS||200));
const GLOBAL_EVENT_DEDUP_MINUTES=Math.max(5,Number(process.env.GFTSH_GLOBAL_EVENT_DEDUP_MINUTES||5));
const GLOBAL_STRONG_CAPTURE_MIN=Number(process.env.GFTSH_GLOBAL_STRONG_CAPTURE_MIN||70);
const GLOBAL_BEHAVIOR_STATE_FILE=process.env.GFTSH_BEHAVIOR_STATE_FILE||'state/gftsh_global_behavior_v23.json';

let requestGate=Promise.resolve();
let nextRequestAt=0;
let global429Until=0;

function normalizeBehaviorEvent(e){
 if(!e||typeof e!=='object')return null;
 const closeTime=Number(e.closeTime||0);
 let openTime=Number(e.openTime||0);
 // Hyperliquid closed lifecycle rows historically carried closeTime + holdHours,
 // but not openTime. Reconstruct the lifecycle start so 30D persistence/pruning
 // and event deduplication have a real timestamp.
 if(!(openTime>0) && closeTime>0 && Number(e.holdHours)>0)openTime=closeTime-Number(e.holdHours)*3600000;
 if(!(openTime>0) && Number(e.eventStart)>0 && Number(e.preLeadMin)>0)openTime=Number(e.eventStart)-Number(e.preLeadMin)*60000;
 if(!(openTime>0) && closeTime>0)openTime=closeTime;
 return {...e,openTime:Number(openTime),closeTime:Number(closeTime||e.closeTime||0),eventTimestamp:Number(e.eventStart||openTime||closeTime||0)};
}
async function loadBehaviorState(){
 try{
  const raw=await fs.readFile(GLOBAL_BEHAVIOR_STATE_FILE,'utf8');
  const x=JSON.parse(raw);
  return {
   version:String(x?.version||''),
   cursor:Math.max(0,Number(x?.cursor||0)),
   events:(Array.isArray(x?.events)?x.events:[]).map(normalizeBehaviorEvent).filter(Boolean),
   updatedAt:Number(x?.updatedAt||0)
  };
 }catch(e){return {version:'',cursor:0,events:[],updatedAt:0};}
}
function eventKey(e){
 const n=normalizeBehaviorEvent(e)||{};
 const t=Math.floor(Number(n.eventTimestamp||n.openTime||n.closeTime||0)/(GLOBAL_EVENT_DEDUP_MINUTES*60000));
 return `${n.source||'HYPERLIQUID'}:${n.traderId||''}:${n.coin||''}:${n.side||''}:${t}`;
}
function pruneBehaviorEvents(events,now=Date.now()){
 const cutoff=now-GLOBAL_EVENT_LOOKBACK_DAYS*86400000;
 const map=new Map();
 for(const raw of (Array.isArray(events)?events:[])){
  const e=normalizeBehaviorEvent(raw); if(!e)continue;
  const ts=Number(e?.eventTimestamp||e?.openTime||e?.closeTime||0);
  if(ts<cutoff)continue;
  const k=eventKey(e);
  const old=map.get(k);
  if(!old||Number(e?.verifiedAt||0)>Number(old?.verifiedAt||0))map.set(k,e);
 }
 return [...map.values()].sort((a,b)=>Number(b?.eventTimestamp||b?.openTime||0)-Number(a?.eventTimestamp||a?.openTime||0)).slice(0,GLOBAL_DB_MAX_EVENTS);
}
function behaviorHunterScore(ev){
 const strong=ev.filter(e=>Number(e?.preLeadMin)>=GLOBAL_MIN_PREPUMP_LEAD_MIN&&Number(e?.exitCapturePct)>=GLOBAL_EXIT_CAPTURE_MIN);
 const avgLead=ev.reduce((a,e)=>a+Number(e?.preLeadMin||0),0)/Math.max(1,ev.length);
 const avgCapture=ev.reduce((a,e)=>a+Number(e?.exitCapturePct||0),0)/Math.max(1,ev.length);
 const coins=[...new Set(ev.map(e=>String(e?.coin||'')).filter(Boolean))];
 const strongRate=strong.length/Math.max(1,ev.length);
 const longLead=Math.min(20,avgLead/2);
 const capture=Math.min(25,avgCapture*0.25);
 const repeat=Math.min(30,ev.length*10);
 const diversity=Math.min(15,coins.length*5);
 const consistency=Math.min(10,strongRate*10);
 const score=Math.min(100,repeat+diversity+longLead+capture+consistency);
 const recent=ev.filter(e=>Number(e?.eventTimestamp||e?.openTime||0)>=Date.now()-7*86400000).length;
 return {strong,strongRate,avgLead,avgCapture,coins,score,recent};
}
function buildBehaviorHuntersFromDB(events,audited=[]){
 const grouped=new Map();
 for(const e of events){
  const k=String(e?.traderId||''); if(!k)continue;
  const g=grouped.get(k)||{source:e.source||'HYPERLIQUID',traderId:k,name:e.name||k,events:[],coins:new Set()};
  g.events.push(e);g.coins.add(e.coin);grouped.set(k,g);
 }
 const owners=new Map(audited.map(x=>[x.address,x]));
 const out=[];
 for(const g of grouped.values()){
  g.events.sort((a,b)=>Number(a.openTime)-Number(b.openTime));
  const m=behaviorHunterScore(g.events); const owner=owners.get(g.traderId);
  g.coins=m.coins;g.repeats=g.events.length;g.strongRepeats=m.strong.length;g.strongCapture=m.strongCapture;g.avgLeadMin=m.avgLead;g.avgExitCapturePct=m.avgCapture;g.score=m.score;
  g.repeatable=g.events.length>=GLOBAL_MIN_REPEAT_EVENTS&&m.strong.length>=GLOBAL_MIN_REPEAT_EVENTS&&m.coins.length>=GLOBAL_MIN_DISTINCT_COINS&&m.score>=GLOBAL_HUNTER_SCORE_MIN;
  g.quality=owner?.quality;g.performance=owner?.performance;g.currentSignal=owner?.currentSignal;g.currentlyAudited=Boolean(owner);
  out.push(g);
 }
 return out.sort((a,b)=>Number(b.repeatable)-Number(a.repeatable)||b.score-a.score||b.repeats-a.repeats).slice(0,GLOBAL_DB_MAX_HUNTERS);
}


async function paceRequest(){
  requestGate=requestGate.then(async()=>{
    const now=Date.now();
    const wait=Math.max(0,nextRequestAt-now,global429Until-now);
    if(wait>0)await sleep(wait);
    nextRequestAt=Date.now()+MIN_REQUEST_GAP_MS;
  });
  return requestGate;
}

async function json(url,opts={},label='http'){
  let lastErr=null;
  for(let attempt=1;attempt<=HL_RETRIES;attempt++){
    await paceRequest();
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),TIMEOUT);
    try{
      const res=await fetch(url,{...opts,signal:controller.signal});
      const body=await res.text();
      if(!res.ok){
        const e=new Error(`${label}:HTTP_${res.status}${body?` ${body.slice(0,180)}`:''}`);e.status=res.status;throw e;
      }
      try{return JSON.parse(body)}catch(e){throw new Error(`${label}:INVALID_JSON`)}
    }catch(e){
      lastErr=e;
      const m=String(e?.message||e);
      const retryable=e?.name==='AbortError'||/HTTP_(429|5\d\d)/.test(m);
      if(/HTTP_429/.test(m)){
        global429Until=Math.max(global429Until,Date.now()+GLOBAL_429_COOLDOWN_MS);
        console.log(`[HTTP][GLOBAL-429] ${label} cooldown=${GLOBAL_429_COOLDOWN_MS}ms`);
      }
      if(!retryable||attempt>=HL_RETRIES)break;
      const wait=HL_RETRY_BASE_MS*Math.pow(2,attempt-1)+(/HTTP_429/.test(m)?500:0);
      console.log(`[HTTP][RETRY] ${label} attempt=${attempt}/${HL_RETRIES} reason=${m.slice(0,120)} wait=${wait}ms`);
      await sleep(wait);
    }finally{clearTimeout(timer)}
  }
  throw lastErr||new Error(`${label}:REQUEST_FAILED`);
}
async function hl(body,label='hl'){
  return json(API,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)},label);
}

function leaderboardMetrics(r){
  const day=r?.day||r?.daily||r?.stats?.day||{};
  const week=r?.week||r?.weekly||r?.stats?.week||{};
  const pick=(obj,keys)=>{for(const k of keys){const v=Number(obj?.[k]);if(Number.isFinite(v))return v}return 0};
  return {
    day:{
      vlm:pick(day,['vlm','volume','volumeUsd','accountValue','totalVolume']),
      pnl:pick(day,['pnl','profit','pnlUsd','netPnl'])
    },
    week:{
      vlm:pick(week,['vlm','volume','volumeUsd','accountValue','totalVolume']),
      pnl:pick(week,['pnl','profit','pnlUsd','netPnl'])
    }
  };
}

async function fetchLeaderboard(){
  const raw=await json(LEADERBOARD,{},'leaderboard');
  const rows=Array.isArray(raw)?raw:
    Array.isArray(raw?.leaderboardRows)?raw.leaderboardRows:
    Array.isArray(raw?.rows)?raw.rows:
    Array.isArray(raw?.data)?raw.data:[];
  const traders=rows.map(r=>({
    address:String(r?.ethAddress||r?.address||r?.user||''),
    name:String(r?.displayName||r?.name||r?.username||'')
  })).filter(x=>/^0x[a-fA-F0-9]{40}$/.test(x.address));
  if(!traders.length)throw new Error('HL_LEADERBOARD_EMPTY_OR_INVALID');
  return {rows,traders};
}

function fillNotional(f){
  const sz=Math.abs(num(f?.sz));
  const pxv=Math.abs(num(f?.px));
  if(!(sz>0)||!(pxv>0))return 0;
  return sz*pxv;
}

function dedupeFills(all){
  const seen=new Set();
  return all.filter(f=>{
    const k=`${f?.coin}|${f?.time}|${f?.tid||f?.hash||f?.oid||''}|${f?.px}|${f?.sz}|${f?.dir}`;
    if(seen.has(k))return false;seen.add(k);return true;
  }).sort((a,b)=>num(a?.time)-num(b?.time));
}

async function recentFillsFor(address,start,end){
  const rows=await hl({type:'userFillsByTime',user:address,startTime:start,endTime:end,aggregateByTime:false},`recent:${short(address)}`);
  if(!Array.isArray(rows))throw new Error('RECENT_FILLS_NOT_ARRAY');
  return dedupeFills(rows);
}

async function fillsFor(address,start,end,seedRows=[]){
  let all=Array.isArray(seedRows)?seedRows.slice():[],cursor=end;
  for(let page=1;page<=MAX_FILL_PAGES;page++){
    const rows=await hl({type:'userFillsByTime',user:address,startTime:start,endTime:cursor,aggregateByTime:false},`fills:${short(address)}:${page}`);
    if(!Array.isArray(rows))throw new Error('FILLS_NOT_ARRAY');
    all.push(...rows);
    if(rows.length<2000)break;
    const times=rows.map(x=>num(x?.time)).filter(Boolean);
    const oldest=times.length?Math.min(...times):0;
    if(!oldest||oldest<=start)break;
    cursor=oldest-1;
  }
  return dedupeFills(all);
}

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const num=(x,d=0)=>{const n=Number(x);return Number.isFinite(n)?n:d};
const finite=x=>Number.isFinite(Number(x));
function pct(x,d=2){return finite(x)?`${num(x).toFixed(d)}%`:'—'}
function usd(x,d=0){return finite(x)?`$${num(x).toLocaleString('en-US',{maximumFractionDigits:d})}`:'—'}
function px(x){const n=num(x);if(!(n>0))return '—';if(n>=100)return n.toFixed(2);if(n>=1)return n.toFixed(4);if(n>=.01)return n.toFixed(6);if(n>=.0001)return n.toFixed(8);return n.toExponential(5)}
function short(a){const s=String(a||'');return s.length>14?`${s.slice(0,8)}…${s.slice(-6)}`:s||'—'}
function rr(sl,tp){const a=Math.abs(num(sl));return a>0?Math.abs(num(tp))/a:0}
function fillDirection(f){
 const d=String(f?.dir||'').toLowerCase().trim();
 if(d.includes('open long'))return {delta:1,kind:'OPEN_LONG'};
 if(d.includes('open short'))return {delta:-1,kind:'OPEN_SHORT'};
 if(d.includes('close long'))return {delta:-1,kind:'CLOSE_LONG'};
 if(d.includes('close short'))return {delta:1,kind:'CLOSE_SHORT'};
 if(d.includes('long > short'))return {delta:-1,kind:'LONG_TO_SHORT'};
 if(d.includes('short > long'))return {delta:1,kind:'SHORT_TO_LONG'};
 const start=num(f?.startPosition);
 if(d==='buy'||d==='buy long'||d==='long')return {delta:start<0?-1:1,kind:'INFERRED_BUY'};
 if(d==='sell'||d==='sell short'||d==='short')return {delta:start>0?-1:-1,kind:'INFERRED_SELL'};
 return {delta:0,kind:'UNKNOWN'};
}
function fillPositionDelta(f){
 const sz=Math.abs(num(f?.sz));if(!(sz>0))return 0;
 const d=fillDirection(f);if(!d.delta)return 0;
 if(d.kind==='LONG_TO_SHORT')return -sz;
 if(d.kind==='SHORT_TO_LONG')return sz;
 return d.delta*sz;
}
function fillPostPosition(f){return num(f?.startPosition)+fillPositionDelta(f)}
function isPositionIncreasing(f){
 const before=num(f?.startPosition),after=fillPostPosition(f);
 return Math.abs(after)>Math.abs(before)+1e-10;
}
function isFreshFill(f,now=Date.now()){const t=num(f?.time);return t>0&&Math.max(0,(now-t)/60000)<=DIAG_WINDOW_MIN}
function latestOpenAdds(fills){
 const out=[];
 for(const f of fills){
   const notional=fillNotional(f);if(notional<MIN_NOTIONAL)continue;
   const before=num(f?.startPosition),after=fillPostPosition(f);
   const increasing=Math.abs(after)>Math.abs(before)+1e-10;
   const directionFlip=before!==0&&after!==0&&Math.sign(before)!==Math.sign(after);
   if(!increasing&&!directionFlip)continue;
   out.push({...f,__positionDelta:fillPositionDelta(f),__positionBefore:before,__positionAfter:after,__isAdd:before!==0,__fresh:isFreshFill(f)});
 }
 return out.sort((a,b)=>num(b.time)-num(a.time));
}
function median(values){
 const a=values.filter(finite).map(Number).sort((x,y)=>x-y);
 if(!a.length)return null;
 return a.length%2?a[(a.length-1)/2]:(a[a.length/2-1]+a[a.length/2])/2;
}
function stdev(values){
 const a=values.filter(finite).map(Number);if(a.length<2)return 0;
 const m=a.reduce((x,y)=>x+y,0)/a.length;
 return Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/a.length);
}
function streaks(closed){
 let win=0,loss=0,maxWin=0,maxLoss=0;
 for(const t of closed){
   if(t.pnl>0){win++;loss=0;maxWin=Math.max(maxWin,win)}
   else if(t.pnl<0){loss++;win=0;maxLoss=Math.max(maxLoss,loss)}
 }
 return {maxWin,maxLoss};
}
function distribution(closed){
 const wins=closed.filter(x=>x.pnl>0).map(x=>x.pnl);
 const losses=closed.filter(x=>x.pnl<0).map(x=>Math.abs(x.pnl));
 const all=closed.map(x=>x.pnl);
 const topWin=wins.length?Math.max(...wins):0;
 const top3=wins.length?wins.slice().sort((a,b)=>b-a).slice(0,3).reduce((a,b)=>a+b,0):0;
 const grossWin=wins.reduce((a,b)=>a+b,0),grossLoss=losses.reduce((a,b)=>a+b,0);
 return {
   avgWin:wins.length?grossWin/wins.length:null,avgLoss:losses.length?grossLoss/losses.length:null,
   medianWin:median(wins),medianLoss:median(losses),largestWin:topWin,largestLoss:losses.length?Math.max(...losses):null,
   profitConcentrationPct:grossWin>0?topWin/grossWin*100:null,top3ProfitConcentrationPct:grossWin>0?top3/grossWin*100:null,
   avgTrade:all.length?all.reduce((a,b)=>a+b,0)/all.length:null,equityVolatility:stdev(all),
   winLossRatio:(wins.length&&losses.length)?wins.length/losses.length:null
 };
}
function windowStats(closed,ms){
 const cutoff=Date.now()-ms;const rows=closed.filter(x=>x.closeTime>=cutoff);
 const wins=rows.filter(x=>x.pnl>0).length,losses=rows.filter(x=>x.pnl<0).length;
 const gw=rows.filter(x=>x.pnl>0).reduce((a,x)=>a+x.pnl,0),gl=rows.filter(x=>x.pnl<0).reduce((a,x)=>a+Math.abs(x.pnl),0);
 return {trades:rows.length,wins,losses,wr:rows.length?wins/rows.length*100:null,pf:gl>0?gw/gl:null,pnl:rows.reduce((a,x)=>a+x.pnl,0)};
}
function reconstruct(fills){
 const books=new Map(),closed=[];let realized=0,grossWin=0,grossLoss=0,peak=0,maxDD=0;
 let recognized=0,unknown=0,reversals=0,invalid=0;
 for(const f of fills){
   const coin=String(f?.coin||'');const size=Math.abs(num(f?.sz));const price=num(f?.px);const fd=fillDirection(f);
   if(!coin||!(size>0)||!(price>0)){invalid++;continue}
   if(!fd.delta){unknown++;continue}
   const delta=fillPositionDelta(f);if(!delta){unknown++;continue}
   recognized++;if(fd.kind==='LONG_TO_SHORT'||fd.kind==='SHORT_TO_LONG')reversals++;
   let b=books.get(coin);if(!b)b={side:0,size:0,avg:0,startTime:0,notional:0};
   let remaining=Math.abs(delta);
   if(Math.sign(delta)===b.side||b.side===0){
     const old=b.size;b.avg=(old*b.avg+remaining*price)/(old+remaining);b.size=old+remaining;b.side=Math.sign(delta);b.startTime=b.startTime||num(f.time);b.notional+=remaining*price;
   }else{
     const closeSize=Math.min(remaining,b.size);let closePnl=num(f?.closedPnl,NaN);
     if(!finite(closePnl))closePnl=(price-b.avg)*closeSize*(b.side>0?1:-1);
     const lifecycleClose=closeSize>=b.size*0.999999;
     if(lifecycleClose){
       const holdH=Math.max(0,(num(f.time)-b.startTime)/3600000);
       closed.push({coin,side:b.side>0?'LONG':'SHORT',entry:b.avg,exit:price,size:closeSize,pnl:closePnl,holdHours:holdH,closeTime:num(f.time),notional:b.notional});
     }
     realized+=closePnl;if(closePnl>0)grossWin+=closePnl;else if(closePnl<0)grossLoss+=Math.abs(closePnl);
     b.size-=closeSize;remaining-=closeSize;
     if(b.size<=1e-12)b={side:0,size:0,avg:0,startTime:0,notional:0};
     if(remaining>1e-12){b.side=Math.sign(delta);b.size=remaining;b.avg=price;b.startTime=num(f.time);b.notional=remaining*price}
   }
   books.set(coin,b);peak=Math.max(peak,realized);maxDD=Math.max(maxDD,peak-realized);
 }
 const wins=closed.filter(x=>x.pnl>0).length,losses=closed.filter(x=>x.pnl<0).length;
 const pf=grossLoss>0?grossWin/grossLoss:null,wr=closed.length?wins/closed.length*100:null;
 const recent24=windowStats(closed,24*3600000),recent7=windowStats(closed,7*24*3600000);
 const activeDays=new Set(closed.map(x=>new Date(x.closeTime).toISOString().slice(0,10))).size;
 const holds=closed.map(x=>num(x.holdHours)).filter(x=>x>=0);
 const avgHoldHours=holds.length?holds.reduce((a,b)=>a+b,0)/holds.length:null,medianHoldHours=median(holds);
 const lookbackDays=Math.max(1,LOOKBACK_HOURS/24),tradesPerDay=closed.length/lookbackDays;
 const byCoin=new Map();for(const t of closed)byCoin.set(t.coin,(byCoin.get(t.coin)||0)+Math.abs(t.pnl));
 const pnlConcentration=closed.length?Math.max(0,...byCoin.values())/Math.max(1,Math.abs(realized)+grossLoss)*100:null;
 const dist=distribution(closed),sk=streaks(closed);
 const recoveryFactor=maxDD>0?realized/maxDD:null;
 const currentBooks=[...books].filter(([,b])=>b.size>0).map(([coin,b])=>({coin,...b}));
 return {closedTrades:closed.length,wins,losses,wr,pf,realizedPnl:realized,grossWin,grossLoss,maxDrawdown:maxDD,activeDays,recentClosed:recent24.trades,recent24,recent7,avgHoldHours,medianHoldHours,tradesPerDay,recognizedFills:recognized,unknownFills:unknown,reversalFills:reversals,invalidFills:invalid,distribution:dist,longestWinStreak:sk.maxWin,longestLossStreak:sk.maxLoss,recoveryFactor,pnlConcentrationPct:pnlConcentration,openBooks:currentBooks,closed};
}
function quality(perf,lb,cp=null){
 const classicReasons=[], asymReasons=[], copyReasons=[];
 const tradesFail=perf.closedTrades<MIN_TRADES;
 const wrFail=!(perf.wr>=MIN_WR);
 const pfUnavailable=perf.pf===null;
 const pfFail=!pfUnavailable&&perf.pf<MIN_PF;
 const pnlFail=perf.realizedPnl<=0;
 const ddBase=Math.max(1,Math.abs(perf.grossWin)+Math.abs(perf.grossLoss));
 const ddPct=perf.maxDrawdown/ddBase*100;
 const ddFail=ddPct>MAX_DD;
 const anomaly=(perf.pf!==null&&perf.pf>30)||(perf.wr!==null&&perf.wr>99.5&&perf.closedTrades<20);
 if(tradesFail)classicReasons.push(`TRADES<${MIN_TRADES}`);
 if(wrFail)classicReasons.push(`WR<${MIN_WR}%`);
 if(pfUnavailable)classicReasons.push('PF_UNAVAILABLE');else if(pfFail)classicReasons.push(`LOW_PF<${MIN_PF}`);
 if(pnlFail)classicReasons.push('NON_POSITIVE_REALIZED_PNL');
 if(ddFail)classicReasons.push(`DD>${MAX_DD}%`);
 if(anomaly)classicReasons.push('PF_WR_ANOMALY_REVIEW');
 const d=perf.distribution||{};
 const asymTradeFail=perf.closedTrades<ASYM_MIN_TRADES;
 const asymPfFail=pfUnavailable||!(perf.pf>=ASYM_MIN_PF);
 const asymDdFail=!(ddPct<=ASYM_MAX_DD);
 const asymRecoveryFail=!(finite(perf.recoveryFactor)&&perf.recoveryFactor>=ASYM_MIN_RECOVERY);
 const asymPnlFail=!(perf.realizedPnl>0);
 const asymTop1Fail=!(finite(d.profitConcentrationPct)&&d.profitConcentrationPct<=ASYM_MAX_TOP1_CONC);
 const asymTop3Fail=!(finite(d.top3ProfitConcentrationPct)&&d.top3ProfitConcentrationPct<=ASYM_MAX_TOP3_CONC);
 const recent=perf.recent24||{};
 const asymRecentPfFail=!(finite(recent.pf)&&recent.pf>=ASYM_MIN_RECENT_PF);
 const asymRecentPnlFail=!(finite(recent.pnl)&&recent.pnl>ASYM_MIN_RECENT_PNL);
 const asymDriftFail=finite(perf.recent7?.pf)&&finite(recent.pf)&&perf.recent7.pf>0&&recent.pf < perf.recent7.pf*0.35 && recent.trades>=5;
 if(asymTradeFail)asymReasons.push(`ASYM_TRADES<${ASYM_MIN_TRADES}`);
 if(asymPfFail)asymReasons.push(`ASYM_PF<${ASYM_MIN_PF}`);
 if(asymDdFail)asymReasons.push(`ASYM_DD>${ASYM_MAX_DD}%`);
 if(asymRecoveryFail)asymReasons.push(`RECOVERY<${ASYM_MIN_RECOVERY}`);
 if(asymPnlFail)asymReasons.push('ASYM_NON_POSITIVE_PNL');
 if(asymTop1Fail)asymReasons.push(`TOP1_CONC>${ASYM_MAX_TOP1_CONC}%`);
 if(asymTop3Fail)asymReasons.push(`TOP3_CONC>${ASYM_MAX_TOP3_CONC}%`);
 if(asymRecentPfFail)asymReasons.push(`RECENT24H_PF<${ASYM_MIN_RECENT_PF}`);
 if(asymRecentPnlFail)asymReasons.push('RECENT24H_NON_POSITIVE_PNL');
 if(asymDriftFail)asymReasons.push('RECENT_PF_DRIFT');
 if(cp){
   if(finite(cp.maxPositionSharePct)&&cp.maxPositionSharePct>COPY_MAX_POSITION)copyReasons.push(`MAX_POS>${COPY_MAX_POSITION}%`);
   if(finite(cp.maxCoinSharePct)&&cp.maxCoinSharePct>COPY_MAX_COIN)copyReasons.push(`MAX_COIN>${COPY_MAX_COIN}%`);
   if(finite(cp.maxLeverage)&&cp.maxLeverage>COPY_MAX_LEVERAGE)copyReasons.push(`MAX_LEV>${COPY_MAX_LEVERAGE}x`);
 }
 const classicPass=!tradesFail&&!wrFail&&!pfUnavailable&&!pfFail&&!pnlFail&&!ddFail&&!anomaly;
 const asymPass=!asymTradeFail&&!asymPfFail&&!asymDdFail&&!asymRecoveryFail&&!asymPnlFail&&!asymTop1Fail&&!asymTop3Fail&&!asymRecentPfFail&&!asymRecentPnlFail&&!asymDriftFail;
 const copyPass=copyReasons.length===0;
 const strategy=classicPass?'HIGH-WR':asymPass?'ASYMMETRIC':'NONE';
 const strategyPass=(classicPass||asymPass)&&copyPass;
 const hardFails=classicReasons.length;
 let score=100-hardFails*7;
 if(asymPass&&!classicPass)score=Math.max(score,84);
 if(!copyPass)score-=copyReasons.length*8;
 score=Math.max(0,Math.min(100,score+Math.min(8,perf.closedTrades/10)));
 let tier=score>=82?'S':score>=72?'A':score>=60?'B':'C';
 if(!strategyPass&&tier==='S')tier='A';
 const reasons=strategyPass?copyReasons.length?copyReasons:['QUALITY_PASS']:([...classicReasons,...asymReasons,...copyReasons]);
 return {score,tier,reasons,ddPct,anomaly,tradesFail,wrFail,pfUnavailable,pfFail,pnlFail,ddFail,hardFailCount:hardFails,
   classicPass,asymPass,copyPass,strategy,strategyPass,classicReasons,asymReasons,copyReasons,
   asymMetrics:{minTrades:ASYM_MIN_TRADES,minPf:ASYM_MIN_PF,maxDd:ASYM_MAX_DD,minRecovery:ASYM_MIN_RECOVERY,maxTop1:ASYM_MAX_TOP1_CONC,maxTop3:ASYM_MAX_TOP3_CONC,minRecentPf:ASYM_MIN_RECENT_PF},
   copyabilityGate:{maxPosition:COPY_MAX_POSITION,maxCoin:COPY_MAX_COIN,maxLeverage:COPY_MAX_LEVERAGE}};
}
async function stateFor(address){return hl({type:'clearinghouseState',user:address},`state:${short(address)}`)}
function positions(state){return (state?.assetPositions||[]).map(x=>x?.position||x).filter(p=>Math.abs(num(p?.szi))>0).map(p=>({coin:String(p.coin),side:num(p.szi)>0?'LONG':'SHORT',size:Math.abs(num(p.szi)),entry:num(p.entryPx),value:Math.abs(num(p.positionValue)),unrealized:num(p.unrealizedPnl),liq:num(p.liquidationPx),leverage:num(p.leverage?.value||p.leverage),margin:num(p.marginUsed)}));}
function copyability(ps,perf,adds){
 const liveValue=ps.reduce((a,p)=>a+Math.abs(num(p.value)),0);
 const maxLive=ps.reduce((a,p)=>Math.max(a,Math.abs(num(p.value))),0);
 const coinValue=new Map();for(const p of ps)coinValue.set(p.coin,(coinValue.get(p.coin)||0)+Math.abs(num(p.value)));
 const topCoin=coinValue.size?Math.max(...coinValue.values()):0;
 const lev=ps.map(p=>num(p.leverage)).filter(x=>x>0);
 const holds=perf.openBooks.map(b=>Math.max(0,(Date.now()-num(b.startTime))/3600000)).filter(finite);
 const freshByCoin=new Map();for(const f of adds)if(f.__fresh&&!freshByCoin.has(String(f.coin)))freshByCoin.set(String(f.coin),f);
 const positionDetails=ps.map(p=>{const b=perf.openBooks.find(x=>x.coin===p.coin);const f=freshByCoin.get(p.coin);return {coin:p.coin,side:p.side,value:p.value,leverage:p.leverage,unrealized:p.unrealized,entry:p.entry,positionAgeHours:b&&num(b.startTime)>0?Math.max(0,(Date.now()-num(b.startTime))/3600000):null,freshFillAgeMin:f?Math.max(0,(Date.now()-num(f.time))/60000):null};});
 return {livePositions:ps.length,liveNotional:liveValue,maxPositionSharePct:liveValue>0?maxLive/liveValue*100:null,maxCoinSharePct:liveValue>0?topCoin/liveValue*100:null,avgLeverage:lev.length?lev.reduce((a,b)=>a+b,0)/lev.length:null,maxLeverage:lev.length?Math.max(...lev):null,positionAgeHours:holds.length?Math.max(...holds):null,avgPositionAgeHours:holds.length?holds.reduce((a,b)=>a+b,0)/holds.length:null,positionDetails};
}
async function mids(){const x=await hl({type:'allMids'},'allMids');return x||{}}

function makeSignal(trader,perfQ,pos,fill,mid){
 const side=pos.side;const entry=num(pos.entry)||num(fill.px);if(!(entry>0)||!(mid>0))return null;
 const distance=side==='LONG'?(mid/entry-1)*100:(1-mid/entry)*100;
 const absDist=Math.abs(distance);const age=(Date.now()-num(fill.time))/60000;
 if(age>FRESH_MIN)return {blocked:'POSITION_NOT_FRESH',ageMin:age};
 if(absDist>WATCH_MAX)return {blocked:'ENTRY_DISTANCE_GT_WATCH_WINDOW',ageMin:age,distance};
 const sl=side==='LONG'?entry*(1-SL_PCT/100):entry*(1+SL_PCT/100);
 const risk=Math.abs(entry-sl);const tp=side==='LONG'?entry+risk*TP_R:entry-risk*TP_R;const R=rr(risk,Math.abs(tp-entry));
 const entryReady=absDist<=ENTRY_MAX&&R>=MIN_RR;
 const reasons=[];if(!entryReady){if(absDist>ENTRY_MAX)reasons.push(`ENTRY_DISTANCE>${ENTRY_MAX}%`);if(R<MIN_RR)reasons.push(`RR<${MIN_RR}`)}
 return {trader,side,coin:pos.coin,entry,mark:mid,distancePct:distance,absDistancePct:absDist,sl,tp,rr:R,ageMin:age,notional:pos.value||fillNotional(fill),entryReady,reason:reasons.join('|')||'VERIFIED_POSITION_WITHIN_ENTRY_WINDOW'};
}

function classifyError(e){
 const m=String(e?.message||e||'');
 if(/HTTP_429/.test(m))return 'HTTP_429_RATE_LIMIT';
 if(/HTTP_5\d\d/.test(m))return 'HTTP_5XX';
 if(/AbortError|timeout/i.test(m))return 'TIMEOUT';
 if(/FILLS_NOT_ARRAY/.test(m))return 'FILLS_SCHEMA';
 if(/state:.*HTTP_/.test(m))return 'STATE_API';
 if(/fills:.*HTTP_/.test(m))return 'FILLS_API';
 return 'OTHER';
}
async function auditTrader(c,start,end,midsMap){
  const diag={fills:0,fresh15:0,increasing:0,livePositions:0,matched:0,entryWindow:0,missingMid:0,invalidEntry:0,watchDistanceFail:0,entryDistanceFail:0,rrFail:0,qualityPass:false,signalPass:false,activityProbe:true,historyLoaded:false,stateChecked:false,behaviorEligible:false,quality:{tradesFail:false,wrFail:false,pfUnavailable:false,pfFail:false,pnlFail:false,ddFail:false,anomaly:false}};
  // IMPORTANT: discovery is historical-behavior-first. A trader does NOT need a fresh
  // position in the last 15 minutes to qualify as a hunter. The 15m probe is only for
  // live signal detection after the trader has been admitted to the watch system.
  // One source-of-truth fill walk: the newest page already contains the fresh
  // activity window, so a separate 15m request would only duplicate API load.
  const fills=await fillsFor(c.address,start,end,[]);diag.fills=fills.length;diag.historyLoaded=true;
  const perf=reconstruct(fills);
  let ps=[];
  // Detect fresh open/increase activity BEFORE deciding whether live state is needed.
  // This ordering is critical: the previous implementation checked diag.fresh15 before
  // populating it, so fresh traders never received a clearinghouseState lookup.
  const adds=latestOpenAdds(fills);
  diag.fresh15=adds.filter(x=>x.__fresh).length;
  diag.increasing=adds.filter(x=>x.__positionDelta!==0&&Math.abs(x.__positionAfter)>Math.abs(x.__positionBefore)+1e-10).length;
  // clearinghouseState is needed only for a trader with fresh activity or a persistent hunter.
  // Historical discovery must not spend one extra state request per inactive candidate.
  if(diag.fresh15>0||c.__trackedHunter){ const state=await stateFor(c.address);diag.stateChecked=true; ps=positions(state); }
  diag.livePositions=ps.length;const posByCoin=new Map(ps.map(p=>[p.coin,p]));

  // Current-position matching is diagnostic/live-signal logic, never the historical discovery gate.
  let candidate=null;let behaviorCandidate=null;let block=ps.length?'POSITION_EXISTS_BUT_NO_FRESH_OPEN_ADD':'NO_CURRENT_POSITION';
  for(const f of adds){
    if(!f.__fresh)continue;
    const p=posByCoin.get(String(f.coin));if(!p)continue;
    diag.matched++;
    const mid=num(midsMap[String(f.coin)]);
    if(!(mid>0)){diag.missingMid++;continue}
    const sig=makeSignal({...c,performance:perf},null,p,f,mid);
    if(!sig){diag.invalidEntry++;continue}
    if(sig.absDistancePct>WATCH_MAX)diag.watchDistanceFail++;
    if(sig.absDistancePct>ENTRY_MAX)diag.entryDistanceFail++;
    else if(sig.rr<MIN_RR)diag.rrFail++;
    else diag.entryWindow++;
    if(sig.entryReady&&!behaviorCandidate)behaviorCandidate=sig;
  }

  const cp=copyability(ps,perf,adds);
  const q=quality(perf,c.lb,cp);
  diag.quality={tradesFail:q.tradesFail,wrFail:q.wrFail,pfUnavailable:q.pfUnavailable,pfFail:q.pfFail,pnlFail:q.pnlFail,ddFail:q.ddFail,anomaly:Boolean(q.anomaly),asymPass:q.asymPass,copyPass:q.copyPass};
  diag.qualityPass=Boolean(q.strategyPass);
  for(const f of adds){
    if(!f.__fresh)continue;
    const p=posByCoin.get(String(f.coin));if(!p)continue;
    const mid=num(midsMap[String(f.coin)]);if(!(mid>0))continue;
    const sig=makeSignal({...c,quality:q,performance:perf},q,p,f,mid);
    if(sig?.entryReady&&diag.qualityPass){candidate=sig;break;}
  }
  if(candidate)block='QUALITY_PASS';
  else if(behaviorCandidate)block='BEHAVIOR_POSITION_READY';
  else if(ps.length===0)block='NO_CURRENT_POSITION';
  else if(!diag.qualityPass)block='TRADER_QUALITY_GATE_FAILED';
  else if(diag.entryWindow===0)block=`ENTRY_DISTANCE_GT_${ENTRY_MAX}%`;
  diag.signalPass=Boolean(candidate);
  return {...c,performance:perf,quality:q,positions:ps,copyability:cp,latestAdd:adds[0]||null,currentSignal:candidate,behaviorCurrentSignal:behaviorCandidate,blockReason:block,diagnostics:diag};
}
function sortCandidates(rows){return rows.slice().sort((a,b)=>{
 const as=a.currentSignal?1:0,bs=b.currentSignal?1:0;if(bs!==as)return bs-as;
 if(b.quality.score!==a.quality.score)return b.quality.score-a.quality.score;
 return num(b.performance.closedTrades)-num(a.performance.closedTrades);
})}
function fmtTrader(x){const p=x.performance,q=x.quality;return `${short(x.address)} | ${q.tier} ${safeFixed(q.score,1)} | Trades ${p.closedTrades} | WR ${finite(p.wr)?safeFixed(p.wr,1)+'%':'—'} | PF ${safePF(p.pf)} | DD ${pct(q.ddPct,1)} | PnL ${usd(p.realizedPnl)}`}
function signalLine(s,i){return [`${i}. ${s.trader.name||short(s.trader.address)} | ${short(s.trader.address)}`,`   ${s.side} ${s.coin} | Entry ${px(s.entry)} | Mark ${px(s.mark)} | Dist ${pct(s.distancePct,2)}`,`   SL ${px(s.sl)} | TP ${px(s.tp)} | RR ${s.rr.toFixed(2)} | Age ${s.ageMin.toFixed(1)}m | Notional ${usd(s.notional)}`,`   Trader ${s.trader.quality.tier}-TIER ${s.trader.quality.score.toFixed(1)} | WR ${finite(s.trader.performance.wr)?s.trader.performance.wr.toFixed(1)+'%':'—'} | PF ${s.trader.performance.pf===null?'—':s.trader.performance.pf.toFixed(2)} | Trades ${s.trader.performance.closedTrades}`,`   VALID: CURRENT_POSITION_VERIFIED + FRESH_OPEN_ADD + ENTRY_WINDOW + RR_GATE`];}

function anomalyReason(x){
 const p=x?.performance||{},d=p.distribution||{};const a=[];
 if(finite(p.pf)&&p.pf>30)a.push('PF>30');
 if(finite(p.wr)&&p.wr>99.5&&p.closedTrades<20)a.push('WR>99.5%_LOW_SAMPLE');
 if(finite(d.profitConcentrationPct)&&d.profitConcentrationPct>70)a.push('SINGLE_WIN_CONCENTRATION>70%');
 if(finite(d.top3ProfitConcentrationPct)&&d.top3ProfitConcentrationPct>90)a.push('TOP3_PROFIT_CONCENTRATION>90%');
 return a.join('+')||'REVIEW_REQUIRED';
}
function failureText(x){
 const q=x?.quality||{};
 const reasons=Array.isArray(q.reasons)?q.reasons:[];
 return reasons.length?reasons.join('+'):'QUALITY_PASS';
}
function safeFixed(v,d=2){return finite(v)?Number(v).toFixed(d):'—'}
function safePF(v){return v===Infinity?'∞':finite(v)?Number(v).toFixed(2):'—'}
function evidenceLine(x){
 const p=x.performance||{},q=x.quality||{},d=x.diagnostics||{},c=x.copyability||{};
 const live=(d.livePositions||0)>0?'LIVE':'NO-LIVE',pos=d.matched>0?'MATCH':'NO-MATCH',entry=d.entryWindow>0?'ENTRY':'NO-ENTRY';
 const recent=p.recent24||{};const dist=p.distribution||{};
 return `${short(x.address)} | ${q.tier} ${safeFixed(q.score,1)} | ${live}/${pos}/${entry} | ${p.closedTrades}T | WR ${finite(p.wr)?safeFixed(p.wr,1)+'%':'—'} | PF ${safePF(p.pf)} | DD ${pct(q.ddPct,1)} | 24H ${recent.trades}T/${finite(recent.wr)?safeFixed(recent.wr,0)+'%':'—'}/${safePF(recent.pf)} | AvgW/L ${usd(dist.avgWin,0)}/${usd(dist.avgLoss,0)} | Streak L${p.longestLossStreak||0} | Conc ${finite(dist.profitConcentrationPct)?safeFixed(dist.profitConcentrationPct,0)+'%':'—'} | PosConc ${finite(c.maxPositionSharePct)?safeFixed(c.maxPositionSharePct,0)+'%':'—'} | ${failureText(x)}`;
}
function evidenceRank(x){
 const d=x.diagnostics||{};
 const q=x.quality||{};
 const p=x.performance||{};
 return (d.entryWindow>0?100000000:0)+(d.matched>0?10000000:0)+(d.livePositions>0?1000000:0)+q.score*1000+Math.min(999,p.closedTrades)+(finite(p.wr)?p.wr:0);
}
async function telegram(text){if(!TG_TOKEN||!TG_CHAT){console.log('[TELEGRAM] credentials missing');return}try{const crypto=await import('node:crypto');const hash=crypto.createHash('sha256').update(text.replace(/^🕒.*$/m,'<TIME>')).digest('hex');let old={};try{old=JSON.parse(await fs.readFile(TG_STATE,'utf8'))}catch{}if(old.hash===hash&&Date.now()-num(old.sentAt)<10*60000)return;for(let i=0;i<text.length;i+=3800)await json(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:TG_CHAT,text:text.slice(i,i+3800),disable_web_page_preview:true})},'telegram');await fs.mkdir(path.dirname(TG_STATE),{recursive:true});await fs.writeFile(TG_STATE,JSON.stringify({hash,sentAt:Date.now()}))}catch(e){console.error('[TELEGRAM]',e.message)}}


async function globalGet(pathname,params={},label='global'){await sleep(GLOBAL_API_GAP_MS);const q=new URLSearchParams(params);return json(`${OKX_API}${pathname}?${q.toString()}`,{},label)}
function normalizeOkxLeadRows(raw){const rows=Array.isArray(raw?.data)?raw.data:Array.isArray(raw)?raw:[];return rows.map(r=>({source:'OKX',id:String(r?.uniqueCode||''),name:String(r?.nickName||r?.displayName||''),roi:num(r?.roi),pnl:num(r?.pnl),aum:num(r?.aum),mdd:num(r?.mdd),winRate:num(r?.winRate),raw:r})).filter(x=>x.id)}
async function fetchOKXLeaders(){console.log('[GLOBAL][OKX][LEADERS] SOURCE_UNAVAILABLE | current public OKX lead-trading REST adapter is not a valid signal-history source');return []}
async function fetchOKXPositions(uniqueCode){try{const raw=await globalGet('/copytrading/public-current-subpositions',{instType:'SWAP',uniqueCode,limit:'100'},`okx:pos:${uniqueCode}`);const rows=Array.isArray(raw?.data)?raw.data:[];return rows.map(r=>({source:'OKX',uniqueCode,coin:String(r?.instId||''),side:String(r?.posSide||'').toLowerCase()==='short'?'SHORT':'LONG',entry:num(r?.openAvgPx),mark:num(r?.markPx),size:Math.abs(num(r?.subPos)),value:Math.abs(num(r?.margin))*Math.max(1,num(r?.lever)),leverage:num(r?.lever),openTime:num(r?.openTime),delayed:true,raw:r})).filter(x=>x.coin&&x.entry>0)}catch(e){return []}}
async function fetchOKXHistory(uniqueCode){try{const raw=await globalGet('/copytrading/public-subpositions-history',{instType:'SWAP',uniqueCode,limit:'100'},`okx:hist:${uniqueCode}`);return Array.isArray(raw?.data)?raw.data:[]}catch(e){return []}}
async function fetchOKXCandles(instId,start,end){try{const raw=await globalGet('/market/candles',{instId,bar:'5m',after:String(end),before:String(start),limit:'100'},`okx:candle:${instId}`);const rows=Array.isArray(raw?.data)?raw.data:[];return rows.map(r=>({t:num(r?.[0]),o:num(r?.[1]),h:num(r?.[2]),l:num(r?.[3]),c:num(r?.[4]),v:num(r?.[5])})).filter(x=>x.t>0&&x.h>0&&x.l>0)}catch(e){return []}}
function okxClosedPerformance(rows){const closed=rows.map(r=>({coin:String(r?.instId||''),side:String(r?.posSide||'').toLowerCase()==='short'?'SHORT':'LONG',entry:num(r?.openAvgPx),exit:num(r?.closeAvgPx),openTime:num(r?.openTime),closeTime:num(r?.closeTime),pnl:num(r?.pnl),realizedPnl:num(r?.realizedPnl),leverage:num(r?.lever)})).filter(x=>x.entry>0&&x.exit>0&&x.openTime>0&&x.closeTime>=x.openTime&&x.closeTime>=Date.now()-GLOBAL_EVENT_LOOKBACK_DAYS*86400000);
 const wins=closed.filter(x=>x.pnl>0),losses=closed.filter(x=>x.pnl<0),gw=wins.reduce((a,x)=>a+x.pnl,0),gl=losses.reduce((a,x)=>a+Math.abs(x.pnl),0),pnl=closed.reduce((a,x)=>a+x.pnl,0);let equity=0,peak=0,maxDD=0;for(const t of [...closed].sort((a,b)=>a.closeTime-b.closeTime)){equity+=t.pnl;peak=Math.max(peak,equity);maxDD=Math.max(maxDD,peak-equity)}return {closed,closedTrades:closed.length,wr:closed.length?wins.length/closed.length*100:null,pf:gl>0?gw/gl:null,realizedPnl:pnl,grossWin:gw,grossLoss:gl,maxDrawdown:maxDD,recent24:windowStats(closed,24*3600000),recent7:windowStats(closed,7*86400000),distribution:distribution(closed),recoveryFactor:maxDD>0?pnl/maxDD:null};}
async function buildOKXEvent(h,trade){
 const move=trade.side==='LONG'?(trade.exit/trade.entry-1)*100:(1-trade.exit/trade.entry)*100;if(move<Math.max(GLOBAL_PUMP_PCT,GLOBAL_DUMP_PCT))return null;
 const candles=await fetchOKXCandles(trade.coin,trade.openTime,trade.closeTime);if(!candles.length)return null;let mfe=move;if(candles.length){if(trade.side==='LONG')mfe=Math.max(move,...candles.map(c=>(c.h/trade.entry-1)*100));else mfe=Math.max(move,...candles.map(c=>(1-c.l/trade.entry)*100));}
 const capture=mfe>0?Math.max(0,Math.min(100,move/mfe*100)):0;const lead=Math.max(0,(trade.closeTime-trade.openTime)/60000);return {source:'OKX',traderId:h.id,name:h.name,coin:trade.coin,side:trade.side,entry:trade.entry,exit:trade.exit,openTime:trade.openTime,closeTime:trade.closeTime,movePct:move,mfePct:mfe,exitCapturePct:capture,preLeadMin:lead,pnl:trade.pnl};
}
function globalQualityGate(perf,leader){
 const trades=perf.closedTrades||0,pf=perf.pf,wr=perf.wr,pnl=perf.realizedPnl||0,dd=num(leader?.mdd);
 const classic=trades>=MIN_TRADES&&finite(pf)&&pf>=MIN_PF&&pnl>0&&( !finite(dd)||dd<=MAX_DD );
 const d=perf.distribution||{};const asym=trades>=ASYM_MIN_TRADES&&finite(pf)&&pf>=ASYM_MIN_PF&&pnl>0&&finite(perf.recoveryFactor)&&perf.recoveryFactor>=ASYM_MIN_RECOVERY&&finite(d.profitConcentrationPct)&&d.profitConcentrationPct<=ASYM_MAX_TOP1_CONC&&finite(d.top3ProfitConcentrationPct)&&d.top3ProfitConcentrationPct<=ASYM_MAX_TOP3_CONC&&(!finite(dd)||dd<=ASYM_MAX_DD);
 return {pass:classic||asym,strategy:classic?'HIGH-WR':asym?'ASYMMETRIC':'NONE',trades,pf,wr,pnl,dd};
}
function okxCopyPass(positions){if(!positions.length)return false;const total=positions.reduce((a,p)=>a+Math.abs(num(p.value)),0);const maxPos=positions.reduce((a,p)=>Math.max(a,Math.abs(num(p.value))),0);const byCoin=new Map();for(const p of positions)byCoin.set(p.coin,(byCoin.get(p.coin)||0)+Math.abs(num(p.value)));const maxCoin=byCoin.size?Math.max(...byCoin.values()):0;const maxLev=positions.reduce((a,p)=>Math.max(a,num(p.leverage)),0);return total>0&&(maxPos/total*100)<=COPY_MAX_POSITION&&(maxCoin/total*100)<=COPY_MAX_COIN&&maxLev<=COPY_MAX_LEVERAGE;}
function hunterBehaviorFromEvents(events){const grouped=new Map();for(const e of events){const k=`${e.source}:${e.traderId}:${e.coin}`;const g=grouped.get(k)||{source:e.source,traderId:e.traderId,name:e.name||e.traderId,coin:e.coin,events:[]};g.events.push(e);grouped.set(k,g)}const out=[];for(const g of grouped.values()){const ev=g.events;const strong=ev.filter(e=>e.preLeadMin>=GLOBAL_MIN_PREPUMP_LEAD_MIN&&e.exitCapturePct>=GLOBAL_EXIT_CAPTURE_MIN);const avgLead=ev.reduce((a,e)=>a+e.preLeadMin,0)/Math.max(1,ev.length),avgCapture=ev.reduce((a,e)=>a+e.exitCapturePct,0)/Math.max(1,ev.length);const score=Math.min(100,ev.length*15+Math.min(35,avgLead/10)+Math.min(40,avgCapture/2));g.repeats=ev.length;g.strongRepeats=strong.length;g.avgLeadMin=avgLead;g.avgExitCapturePct=avgCapture;g.score=score;g.repeatable=ev.length>=GLOBAL_MIN_REPEAT_EVENTS&&strong.length>=GLOBAL_MIN_REPEAT_EVENTS&&score>=GLOBAL_HUNTER_SCORE_MIN;out.push(g)}return out.sort((a,b)=>b.score-a.score)}
async function globalBehaviorDiscovery(){if(!GLOBAL_ENABLED)return {events:[],hunters:[],signals:[],sources:[]};const events=[],sources=[];if(GLOBAL_SOURCES.includes('BINANCE'))sources.push('BINANCE discovery-only (public leaderboard/Smart Money; no raw public trader-history adapter)');if(GLOBAL_SOURCES.includes('BYBIT'))sources.push('BYBIT discovery-only (public leaderboard; no raw public trader-history adapter)');if(GLOBAL_SOURCES.includes('OKX')){const leaders=await fetchOKXLeaders();sources.push(`OKX leaders=${leaders.length}`);for(const h of leaders.slice(0,Math.min(GLOBAL_EVENT_CANDIDATES,20))){const hist=await fetchOKXHistory(h.id);const perf=okxClosedPerformance(hist);h.performance=perf;h.quality=globalQualityGate(perf,h);if(!h.quality.pass)continue;for(const trade of perf.closed.filter(t=>Math.abs((t.exit/t.entry-1)*100)>=Math.max(GLOBAL_PUMP_PCT,GLOBAL_DUMP_PCT)).slice(0,10)){const e=await buildOKXEvent(h,trade);if(e)events.push(e)}}}const hunters=hunterBehaviorFromEvents(events);const signals=[];for(const h of hunters.filter(x=>x.repeatable).slice(0,GLOBAL_EVENT_CANDIDATES)){const pos=await fetchOKXPositions(h.traderId);if(!okxCopyPass(pos))continue;for(const p of pos){const gs=globalSignalCandidate(h,p);if(gs){gs.performance=h.performance;gs.quality=h.quality;signals.push(gs)}}}return {events,hunters,signals,sources};}
function globalSignalCandidate(h,p){if(!h?.repeatable||!p?.entry)return null;const perf=h.performance||{};const side=p.side,entry=p.entry,mark=p.mark||entry;const distance=side==='LONG'?(mark/entry-1)*100:(1-mark/entry)*100;const rawAge=Math.max(0,(Date.now()-num(p.openTime))/60000);const sourceDelay=p.source==='OKX'?5:0;const age=rawAge+sourceDelay;if(age>FRESH_MIN||Math.abs(distance)>ENTRY_MAX)return null;const sl=side==='LONG'?entry*(1-SL_PCT/100):entry*(1+SL_PCT/100);const tp=side==='LONG'?entry+Math.abs(entry-sl)*TP_R:entry-Math.abs(entry-sl)*TP_R;return {source:p.source,traderId:h.traderId,name:h.name||h.traderId,coin:p.coin,side,entry,mark,distancePct:distance,sl,tp,rr:rr(Math.abs(entry-sl),Math.abs(tp-entry)),ageMin:age,behaviorScore:h.score,repeats:h.repeats,performance:perf,reason:`REPEATABLE_PRE_PUMP_DUMP_HUNTER | ${h.repeats} events | lead ${safeFixed(h.avgLeadMin,1)}m | exit capture ${safeFixed(h.avgExitCapturePct,0)}%`};}

async function mapLimit(items,limit,fn){
  const out=new Array(items.length);let cursor=0;
  async function worker(){while(true){const i=cursor++;if(i>=items.length)return;try{out[i]=await fn(items[i],i)}catch(e){out[i]={__error:e,__item:items[i]}}}}
  await Promise.all(Array.from({length:Math.min(limit,items.length)},()=>worker()));return out;
}

async function fetchHLCandles(coin,start,end,interval='5m'){
 try{
  const raw=await hl({type:'candleSnapshot',req:{coin,interval,startTime:start,endTime:end}},`candle:${coin}`);
  return Array.isArray(raw)?raw.map(c=>({t:num(c?.t),T:num(c?.T),o:num(c?.o),h:num(c?.h),l:num(c?.l),c:num(c?.c)})).filter(c=>c.t>0&&c.h>0&&c.l>0):[];
 }catch(e){return []}
}
async function enrichHLBehaviorEvents(events){
 const out=[];
 const stats={candidate:events.length,candleOk:0,triggerFound:0,leadPass:0,mfePass:0,capturePass:0};
 const unique=events.slice().sort((a,b)=>Math.abs(b.movePct)-Math.abs(a.movePct)).slice(0,Math.max(40,GLOBAL_EVENT_CANDIDATES*3));
 const cache=new Map();
 for(const e of unique){
  stats.candidate++;
  const pre=Math.max(30,GLOBAL_PRE_EVENT_MIN);
  const start=Math.max(0,num(e.openTime)-pre*60000);
  const end=Math.min(Date.now(),Math.max(num(e.closeTime)||Date.now(),num(e.openTime))+GLOBAL_EVENT_WINDOW_MIN*60000);
  const key=`${e.coin}:${Math.floor(start/900000)}:${Math.floor(end/900000)}`;
  let candles=cache.get(key);
  if(!candles){candles=await fetchHLCandles(e.coin,start,end,'5m');cache.set(key,candles)}
  if(!candles.length)continue;
  stats.candleOk++;
  candles=candles.slice().sort((a,b)=>a.t-b.t);
  const entryIdx=candles.reduce((best,c,i)=>Math.abs(c.t-e.openTime)<Math.abs(candles[best]?.t-e.openTime)?i:best,0);
  const entryC=candles[entryIdx];
  if(!entryC?.c)continue;

  // The event START is the first small directional expansion after entry
  // that subsequently grows into the major move. This avoids falsely treating
  // the first candle that is already +5%/+8% as the beginning of the event.
  let eventStart=null;
  const triggerBars=Math.max(1,Math.ceil(GLOBAL_EVENT_TRIGGER_MINUTES/5));
  for(let i=entryIdx+1;i<candles.length;i++){
   const c=candles[i];
   if(c.t<=e.openTime+GLOBAL_MIN_PREPUMP_LEAD_MIN*60000)continue;
   const fromEntry=e.side==='LONG'?(c.h/e.entry-1)*100:(1-c.l/e.entry)*100;
   if(fromEntry<GLOBAL_EVENT_TRIGGER_PCT)continue;
   const j=Math.min(candles.length-1,i+triggerBars);
   const future=candles[j];
   if(!future)continue;
   const futureMove=e.side==='LONG'?(future.h/e.entry-1)*100:(1-future.l/e.entry)*100;
   if(futureMove>=Math.max(GLOBAL_PUMP_PCT,GLOBAL_DUMP_PCT)){
    eventStart=c.t;stats.triggerFound++;break;
   }
  }
  if(!eventStart)continue;
  const lead=(eventStart-e.openTime)/60000;
  if(lead<GLOBAL_MIN_PREPUMP_LEAD_MIN)continue;
  stats.leadPass++;

  const eventEnd=Math.min(end,eventStart+GLOBAL_EVENT_WINDOW_MIN*60000);
  let eventPeak=null,eventPeakMove=0;
  for(const c of candles){
   if(c.t<eventStart||c.t>eventEnd)continue;
   const move=e.side==='LONG'?(c.h/e.entry-1)*100:(1-c.l/e.entry)*100;
   if(move>eventPeakMove){eventPeakMove=move;eventPeak=c.t}
  }
  if(eventPeakMove<Math.max(GLOBAL_PUMP_PCT,GLOBAL_DUMP_PCT)){continue}
  stats.mfePass++;
  const exitMove=e.side==='LONG'?(e.exit/e.entry-1)*100:(1-e.exit/e.entry)*100;
  const capture=eventPeakMove>0?Math.max(0,Math.min(100,exitMove/eventPeakMove*100)):0;
  if(capture<GLOBAL_EXIT_CAPTURE_MIN)continue;
  stats.capturePass++;
  const exitAfterEvent=Math.max(0,(num(e.closeTime)-eventStart)/60000);
  out.push({...e,mfePct:eventPeakMove,mfeTime:eventPeak,preLeadMin:lead,eventStart,eventEnd,exitAfterEventMin:exitAfterEvent,exitCapturePct:capture,exitFromPeakMin,marketEvent:true});
 }
 console.log(`[GLOBAL][HL EVENT RECON] candidates=${events.length} candleOK=${stats.candleOk} trigger=${stats.triggerFound} leadPass=${stats.leadPass} mfePass=${stats.mfePass} capturePass=${stats.capturePass} verified=${out.length}`);
 return out;
}
async function buildHLBehaviorHunters(audited){
 const candidateEvents=[];
 for(const x of audited){
  const rows=(x.performance?.closed||[]).filter(t=>t.closeTime>=Date.now()-GLOBAL_EVENT_LOOKBACK_DAYS*86400000);
  for(const t of rows){
   const move=t.side==='LONG'?(t.exit/t.entry-1)*100:(1-t.exit/t.entry)*100;
   if(move<GLOBAL_EVENT_TRIGGER_PCT||num(t.holdHours)<=0||num(t.holdHours)>GLOBAL_EVENT_MAX_HOURS)continue;
   const lifecycle=normalizeBehaviorEvent({...t});
   candidateEvents.push({...lifecycle,traderId:x.address,name:x.name||short(x.address),source:'HYPERLIQUID',movePct:move});
  }
 }
 candidateEvents.sort((a,b)=>b.movePct-a.movePct);
 const topN=Math.min(candidateEvents.length,Math.max(40,GLOBAL_EVENT_CANDIDATES*3));
 console.log(`[GLOBAL][HL EVENT CANDIDATES] closed=${candidateEvents.length} trigger>=${GLOBAL_EVENT_TRIGGER_PCT}% major>=${Math.max(GLOBAL_PUMP_PCT,GLOBAL_DUMP_PCT)}% top=${topN}`);
 const verified=await enrichHLBehaviorEvents(candidateEvents);
 return {candidateEvents,verified};
}

async function main(){
 const started=Date.now();const start=Date.now()-LOOKBACK_HOURS*3600000,end=Date.now();
 console.log(`${VERSION} | READ-ONLY | NO ORDERS`);
 const behaviorState=await loadBehaviorState();
 const lb=await fetchLeaderboard();
 // Global discovery ranks the full public universe, then rotates a bounded audit window.
 const allRanked=lb.rows.map(r=>{const a=String(r?.ethAddress||r?.address||r?.user||'');const m=leaderboardMetrics(r);return {...r,address:a,name:String(r?.displayName||r?.name||r?.username||''),lb:m}}).filter(r=>/^0x[a-fA-F0-9]{40}$/.test(r.address)).sort((a,b)=>(b.lb.day.vlm*0.000002+b.lb.week.vlm*0.0000005+Math.max(0,b.lb.day.pnl)*0.002)-(a.lb.day.vlm*0.000002+a.lb.week.vlm*0.0000005+Math.max(0,a.lb.day.pnl)*0.002));
 const discoveryPool=GLOBAL_ROTATION_POOL>0?allRanked.slice(0,Math.min(GLOBAL_ROTATION_POOL,allRanked.length)):allRanked;
 const cursorBase=behaviorState.cursor%Math.max(1,discoveryPool.length);
 const rotating=[];for(let i=0;i<Math.min(GLOBAL_AUDIT_CHUNK,discoveryPool.length);i++)rotating.push(discoveryPool[(cursorBase+i)%discoveryPool.length]);
 const byAddr=new Map(allRanked.map(x=>[x.address,x]));
 const persistedHunters=buildBehaviorHuntersFromDB(pruneBehaviorEvents(behaviorState.events),[]).filter(x=>x.repeatable).slice(0,GLOBAL_TRACKED_HUNTERS);
 // Persistent hunters always have priority. The rotating discovery pool continues
 // learning new hunters in parallel and is never allowed to evict tracked hunters.
 const priority=[];for(const h of persistedHunters){const c=byAddr.get(h.traderId)||{address:h.traderId,name:h.name||short(h.traderId),lb:{day:{vlm:0,pnl:0},week:{vlm:0,pnl:0}}};if(/^0x[a-fA-F0-9]{40}$/.test(c.address)&&!priority.some(x=>x.address===c.address))priority.push({...c,__trackedHunter:true});}
 for(const c of rotating){if(!priority.some(x=>x.address===c.address))priority.push(c);}
 const ranked=priority.slice(0,Math.max(GLOBAL_TRACKED_HUNTERS,Math.min(ACTIVE_AUDIT_LIMIT,priority.length)));
 console.log(`[DISCOVERY] leaderboardRows=${lb.rows.length} validTraderIds=${lb.traders.length} rotationPool=${discoveryPool.length} cursor=${cursorBase} persistedHunters=${persistedHunters.length} audit=${ranked.length}`);
 const midsMap=await mids();const audited=[];let errors=0;const errorBreakdown={};
 const activityPool=ranked;
 console.log(`[AUDIT] rotating activity candidates=${activityPool.length} concurrency=${MAX_CONCURRENCY} minGap=${MIN_REQUEST_GAP_MS}ms global429Cooldown=${GLOBAL_429_COOLDOWN_MS}ms`);
 const results=await mapLimit(activityPool,MAX_CONCURRENCY,(c)=>auditTrader(c,start,end,midsMap));
 for(const r of results){if(r?.__error){errors++;const k=classifyError(r.__error);errorBreakdown[k]=(errorBreakdown[k]||0)+1;console.log(`[AUDIT][ERROR] ${short(r.__item.address)} | ${k} | ${String(r.__error?.message||r.__error).slice(0,180)}`)}else if(r)audited.push(r)}
 const complete=audited.filter(x=>x.performance.closedTrades>0);
 const eligible=audited.filter(x=>x.diagnostics?.qualityPass);
 const liveMatched=audited.filter(x=>(x.diagnostics?.matched||0)>0);
 const entryCandidates=audited.filter(x=>(x.diagnostics?.entryWindow||0)>0);
 const nearMiss=sortCandidates(audited.filter(x=>(x.diagnostics?.entryWindow||0)>0&&!x.diagnostics?.qualityPass)).sort((a,b)=>evidenceRank(b)-evidenceRank(a));
 const evidenceTop=sortCandidates(audited.filter(x=>(x.diagnostics?.matched||0)>0)).sort((a,b)=>evidenceRank(b)-evidenceRank(a));

 const hlRecon=await buildHLBehaviorHunters(audited);
 const currentVerified=hlRecon.verified.map(e=>normalizeBehaviorEvent({...e,verifiedAt:Date.now()})).filter(e=>e&&Number(e.openTime)>0);
 const mergedEvents=pruneBehaviorEvents([...behaviorState.events,...currentVerified]);
 const behaviorHunters=buildBehaviorHuntersFromDB(mergedEvents,audited);
 const globalHunt=await globalBehaviorDiscovery();
 globalHunt.sources.unshift(`HYPERLIQUID behavior hunters=${behaviorHunters.filter(x=>x.repeatable).length}`);
 globalHunt.hunters=[...behaviorHunters,...globalHunt.hunters];
 globalHunt.events=[...currentVerified,...globalHunt.events];
 // Live tracking is behavior-gated, not historical-quality-gated. A repeatable
 // pre-pump/pre-dump hunter can generate a signal even when its generic WR/PF gate
 // would reject it; the behavior engine is the authority for this signal lane.
 const auditedByAddr=new Map(audited.map(x=>[x.address,x]));
 for(const h of behaviorHunters.filter(x=>x.repeatable).slice(0,GLOBAL_TRACKED_HUNTERS)){
  const owner=auditedByAddr.get(h.traderId); if(!owner)continue;
  const s0=owner.behaviorCurrentSignal; if(!s0?.entryReady)continue;
  const s={...s0,source:'HYPERLIQUID',traderId:h.traderId,name:h.name,behaviorScore:h.score,repeats:h.repeats,coins:h.coins,qualityTier:owner.quality?.tier,qualityScore:owner.quality?.score,reason:`REPEATABLE_PRE_PUMP_DUMP_HUNTER | ${h.repeats} verified events | ${h.coins.length} coins | lead ${safeFixed(h.avgLeadMin,1)}m | capture ${safeFixed(h.avgExitCapturePct,0)}%`};
  globalHunt.signals.push(s);
 }
 const strongNow=currentVerified.filter(e=>e.exitCapturePct>=GLOBAL_STRONG_CAPTURE_MIN).length;
 console.log(`[GLOBAL][BEHAVIOR DB] loaded=${behaviorState.events.length} currentVerified=${currentVerified.length} strongCapture>=${GLOBAL_STRONG_CAPTURE_MIN}%=${strongNow} retained30D=${mergedEvents.length} repeatable=${behaviorHunters.filter(x=>x.repeatable).length}`);
 console.log(`[GLOBAL HUNT] sources=${globalHunt.sources.join(' | ')||'none'} | currentEvents=${currentVerified.length} | retained30D=${mergedEvents.length} | repeatableHunters=${globalHunt.hunters.filter(x=>x.repeatable).length} | verifiedGlobalSignals=${globalHunt.signals.length}`);
 console.log(`[GLOBAL FUNNEL] behavior-events=${globalHunt.events.length} | repeatable=${globalHunt.hunters.filter(x=>x.repeatable).length} | behavior+live-position signals=${globalHunt.signals.length} | telegram-selected=${Math.min(GLOBAL_TELEGRAM_MAX_SIGNALS,globalHunt.signals.length)}`);
 const watch=sortCandidates(eligible).slice(0,TOP_WATCH);const localSignals=watch.map(x=>x.currentSignal).filter(Boolean).sort((a,b)=>b.trader.quality.score-a.trader.quality.score).slice(0,MAX_SIGNALS);
 const signals=localSignals.slice(0,MAX_SIGNALS);
 const used=new Set([...signals.map(s=>s?.trader?.address),...globalHunt.signals.map(s=>s?.traderId)].filter(Boolean));
 const report=[];
 report.push('🌐 GLOBAL FUTURES PRO HUNTER',`🧠 ${VERSION}`,`🔧 ${BUILD}`,'📡 READ-ONLY | NO ORDERS | NO AUTO-COPY | FUTURES ONLY','━━━━━━━━━━━━━━━━━━');
 const diagRows=audited.map(x=>x.diagnostics||{});const dsum=k=>diagRows.reduce((a,x)=>a+num(x[k]),0);const qsum=k=>diagRows.reduce((a,x)=>a+num(x.quality?.[k]?1:0),0);const errText=Object.entries(errorBreakdown).map(([k,v])=>`${k}=${v}`).join(' | ')||'none';
 report.push(`🔎 Leaderboard: ${lb.rows.length} | Valid trader IDs: ${lb.traders.length} | Rotation pool: ${discoveryPool.length} | Audit candidates: ${activityPool.length} | Audited: ${audited.length} | Complete: ${complete.length} | Errors: ${errors}`,
 `🧪 AUDIT PIPELINE: fresh≤${DIAG_WINDOW_MIN}m=${dsum('fresh15')} | history-fills=${dsum('fills')} | pos-increase=${dsum('increasing')} | live-match=${dsum('matched')} | entry-window=${dsum('entryWindow')} | quality-pass=${diagRows.filter(x=>x.qualityPass).length}`,
 `🔬 DECISION DIAG: missing-mid=${dsum('missingMid')} | invalid-entry=${dsum('invalidEntry')} | >watch=${dsum('watchDistanceFail')} | >entry=${dsum('entryDistanceFail')} | RR-fail=${dsum('rrFail')}`,
 `🧬 QUALITY DIAG: classic WR<${MIN_WR}%=${qsum('wrFail')} | PF<${MIN_PF}=${qsum('pfFail')} | DD>${MAX_DD}%=${qsum('ddFail')} | asym-pass=${qsum('asymPass')} | copy-pass=${qsum('copyPass')} | anomaly=${qsum('anomaly')}`,
 `🧠 STRATEGY GATE: HIGH-WR OR ASYMMETRIC | ASYM PF≥${ASYM_MIN_PF} | Recovery≥${ASYM_MIN_RECOVERY} | Top1≤${ASYM_MAX_TOP1_CONC}% | Top3≤${ASYM_MAX_TOP3_CONC}% | 24H PF≥${ASYM_MIN_RECENT_PF}`,
 `📦 COPY GATE: maxPos≤${COPY_MAX_POSITION}% | maxCoin≤${COPY_MAX_COIN}% | maxLev≤${COPY_MAX_LEVERAGE}x`, `🧪 FORENSICS: near-miss=${nearMiss.length} | anomalies=${audited.filter(x=>x.quality?.anomaly).length} | evidence-live=${evidenceTop.length}`,
 `📊 EVIDENCE DEPTH: live-position traders=${audited.filter(x=>(x.diagnostics?.livePositions||0)>0).length} | live-match traders=${liveMatched.length} | entry-ready traders=${entryCandidates.length} | quality-pass traders=${eligible.length}`,
 `🧯 ERROR BREAKDOWN: ${errText}`,`🎯 Quality eligible: ${eligible.length} | Watchlist: ${watch.length} | Actionable signals: ${signals.length}/${MAX_SIGNALS}`,`🧾 TRADE RECON: actual closed lifecycles | partial fills aggregated | PF/WR anomaly guard ON`,`🛡 CURRENT POSITION: source-native verified position only | stale fills/history cannot create a live position`,`⚡ SIGNAL: fresh open activity ≤${FRESH_MIN}m | entry distance ≤${ENTRY_MAX}% | SL ${SL_PCT}% | TP ${TP_R}R | RR ≥${MIN_RR}`,'');
 report.push('📡 SOURCE STATUS',`HYPERLIQUID: OK | BEHAVIOR+SIGNAL | discovered=${lb.traders.length} | audited=${audited.length}`,`OKX: ${globalHunt.sources.find(x=>x.startsWith('OKX'))||'NOT ENABLED'} | SIGNAL-UNAVAILABLE via current public REST lead-history adapter`,`BINANCE: ${GLOBAL_SOURCES.includes('BINANCE')?'DISCOVERY-ONLY':'DISABLED'} | public leaderboard/Smart Money exists, raw trader-history adapter not promoted to signal`, `BYBIT: ${GLOBAL_SOURCES.includes('BYBIT')?'DISCOVERY-ONLY':'DISABLED'} | public leaderboard exists, raw trader-history adapter not promoted to signal`,'');
 report.push('🔬 QUALITY EVIDENCE MATRIX');
 evidenceTop.slice(0,10).forEach((x,i)=>report.push(`${i+1}. ${evidenceLine(x)} | ${x.quality.strategy||'NONE'} | Copy ${x.quality.copyPass?'PASS':'FAIL'}`));
 if(!evidenceTop.length)report.push('No trader reached live-position matching for evidence ranking.');
 report.push('','🎯 NEAR-MISS — LIVE POSITION + ENTRY PASSED, QUALITY FAILED');
 nearMiss.slice(0,10).forEach((x,i)=>{const p=x.performance,q=x.quality,d=x.diagnostics;report.push(`${i+1}. ${short(x.address)} | Score ${safeFixed(q.score,1)} | Trades ${p.closedTrades} | WR ${finite(p.wr)?safeFixed(p.wr,1)+'%':'—'} | PF ${safePF(p.pf)} | DD ${pct(q.ddPct,1)} | FAIL ${failureText(x)} | live=${d.livePositions||0} match=${d.matched||0} entry=${d.entryWindow||0}`)});
 if(!nearMiss.length)report.push('No live-position + entry-window near-miss this cycle.');
 report.push('','🧬 PERFORMANCE FORENSICS — NEAR-MISS');
 nearMiss.slice(0,10).forEach((x,i)=>{const p=x.performance||{},d=p.distribution||{},r=p.recent24||{},r7=p.recent7||{},c=x.copyability||{};report.push(`${i+1}. ${short(x.address)} | ${x.quality.tier} ${safeFixed(x.quality?.score,1)} | ${failureText(x)}`,
 `   All ${p.closedTrades}T WR ${finite(p.wr)?safeFixed(p.wr,1)+'%':'—'} PF ${safePF(p.pf)} PnL ${usd(p.realizedPnl)} | 24H ${r.trades}T/${finite(r.wr)?safeFixed(r.wr,1)+'%':'—'}/${safePF(r.pf)} ${usd(r.pnl)} | 7D ${r7.trades}T/${finite(r7.wr)?safeFixed(r7.wr,1)+'%':'—'}/${safePF(r7.pf)}`,
 `   Avg W/L ${usd(d.avgWin,0)}/${usd(d.avgLoss,0)} | Med W/L ${usd(d.medianWin,0)}/${usd(d.medianLoss,0)} | Max W/L ${usd(d.largestWin,0)}/${usd(d.largestLoss,0)}`,
 `   Profit concentration top-win=${pct(d.profitConcentrationPct,1)} top3=${pct(d.top3ProfitConcentrationPct,1)} | Streak W/L ${p.longestWinStreak||0}/${p.longestLossStreak||0} | Recovery ${finite(p.recoveryFactor)?safeFixed(p.recoveryFactor,2):'—'}`,
 `   Copyability live=${c.livePositions||0} notional=${usd(c.liveNotional)} maxPos=${pct(c.maxPositionSharePct,1)} maxCoin=${pct(c.maxCoinSharePct,1)} lev=${finite(c.avgLeverage)?safeFixed(c.avgLeverage,1)+'x':'—'}/${finite(c.maxLeverage)?safeFixed(c.maxLeverage,1)+'x':'—'} age=${finite(c.avgPositionAgeHours)?safeFixed(c.avgPositionAgeHours,1)+'h':'—'}`);});
 if(!nearMiss.length)report.push('No near-miss performance forensic sample this cycle.');
 report.push('','🚨 ANOMALY FORENSICS');
 const anomalies=audited.filter(x=>x.quality?.anomaly);
 anomalies.slice(0,5).forEach((x,i)=>{const p=x.performance,d=p.distribution||{};report.push(`${i+1}. ${short(x.address)} | PF ${safePF(p.pf)} | WR ${finite(p.wr)?safeFixed(p.wr,1)+'%':'—'} | ${p.closedTrades}T | top-win concentration=${pct(d.profitConcentrationPct,1)} | top3=${pct(d.top3ProfitConcentrationPct,1)} | largestW/L=${usd(d.largestWin,0)}/${usd(d.largestLoss,0)} | reason=${anomalyReason(x)}`);});
 if(!anomalies.length)report.push('No statistical anomaly flagged this cycle.');
 report.push('','👑 TOP VERIFIED TRADERS');
 watch.slice(0,TOP_WATCH).forEach((x,i)=>report.push(`${i+1}. ${fmtTrader(x)} | ${x.currentSignal?'POSITION READY':'BLOCK '+x.blockReason}`));
 if(!watch.length)report.push('No trader passed the minimum evidence gate this cycle.');
 report.push('','🔥 ACTIONABLE NOW');
 if(signals.length){signals.forEach((s,i)=>report.push(...signalLine(s,i+1),'━━━━━━━━━━━━━━━━━━'))}else report.push('No verified trader has a fresh copyable-quality current position this cycle.');
 report.push('','🧱 TOP BLOCK REASONS');
 sortCandidates(audited.filter(x=>!used.has(x.address))).slice(0,10).forEach(x=>{const d=x.diagnostics||{};report.push(`${short(x.address)} | ${x.quality.tier} ${safeFixed(x.quality?.score,1)} | ${x.blockReason||x.quality.reasons.join(' | ')||'NOT_SIGNAL_READY'} | fresh=${d.fresh15||0} match=${d.matched||0}`)});
 report.push('','🌍 GLOBAL BEHAVIOR HUNT',`Sources: ${globalHunt.sources.join(' | ')||'none'}`,`Current event observations: ${currentVerified.length} | Retained 30D events: ${mergedEvents.length} | Repeatable hunters: ${behaviorHunters.filter(x=>x.repeatable).length} | Tracked TOP=${Math.min(GLOBAL_TRACKED_HUNTERS,behaviorHunters.filter(x=>x.repeatable).length)}`,
 `Behavior DB: full-universe rotation=${discoveryPool.length} | cursor=${cursorBase}→${(cursorBase+activityPool.length)%Math.max(1,discoveryPool.length)} | persisted hunters audited=${persistedHunters.length} | strong capture≥${GLOBAL_STRONG_CAPTURE_MIN}%=${strongNow}`, `Rule: discovery is independent of current activity; entry must precede the first directional trigger, market must reach the major-move threshold, and exit must capture ≥${GLOBAL_EXIT_CAPTURE_MIN}% of MFE and occur within ${GLOBAL_EXIT_PEAK_TOLERANCE_MIN}m before/after the event peak. Minimum repeats=${GLOBAL_MIN_REPEAT_EVENTS}, distinct coins=${GLOBAL_MIN_DISTINCT_COINS}.`,'');
 report.push('','🛡️ V2.2 CONTRACTS',`• Global discovery is multi-exchange; Hyperliquid is one source, not the whole hunter.`,`• Performance unit = actual closed lifecycle; no synthetic trades.`,`• PF unavailable is shown as — and never becomes LOW_PF.`,`• Exchange-specific current-position authority is source-native; no stale fill may become a live position.`,`• Signal requires fresh open activity + live position + entry distance + RR.`,`• Null metrics are rendered as — and never passed to toFixed().`,`• Multiple independent traders/signals may be emitted; MAX_SIGNALS=${MAX_SIGNALS}.`,`• Audit is history-first: full 30D fills are evaluated first; live state is fetched only after fresh activity is detected or for a tracked hunter.`,`• Decision diagnostics separate missing-mid, invalid-entry, watch/entry distance and RR failures; Entry validation uses the live position entry price with fill fallback.`,`• Quality diagnostics separate trade-count, WR, PF-unavailable, PF, PnL, DD and anomaly failures.`,`• Evidence matrix shows Trades/WR/PF/DD plus recent 24H performance, win/loss distribution, streaks and position concentration.`,
 `• Performance forensics compares the current audit window with 24H and 7D activity; no synthetic performance is created.`,
 `• Copyability forensics reports live notional, max position/coin concentration, leverage and reconstructed position age.`,
 `• Anomaly forensics explains PF/WR outliers and profit concentration instead of silently suppressing them.`,`• Near-miss analysis isolates traders that passed live-position + entry validation but failed historical quality.`,`• Live-position count, live-match count and entry-ready count are reported separately to expose pipeline attrition.`,`• Quality is strategy-aware: HIGH-WR classic path OR ASYMMETRIC profit-specialist path; no blind WR relaxation.`,`• ASYMMETRIC path requires trades, PF, DD, recovery, profit concentration and recent-performance gates.`,`• Copyability is an independent hard gate on live position/coin concentration and leverage.`,`• Recent-vs-historical drift can reject an otherwise profitable trader.` ,`• Global hunter promotes only repeatable pre-pump/pre-dump behavior observed across multiple events.`,`• V2.3.1 persists verified behavior events in a rolling 30D database; events are deduplicated by trader/coin/side/time.`,`• Leaderboard discovery rotates through a bounded top universe so behavior evidence is accumulated across cycles rather than rebuilt from only the same 40 traders.`,`• Persisted repeatable hunters are re-audited for current-position authority before any live signal is emitted.`,`• Strong capture≥${GLOBAL_STRONG_CAPTURE_MIN}% is tracked separately; no quality or behavior gate is relaxed to manufacture signals.`,`• Telegram contains selected signals only; diagnostics remain in GitHub Actions logs/state.`,`• No quality threshold is relaxed to manufacture actionable signals.`,
 `• Global 429 cooldown + bounded concurrency + minimum request gap protect the Hyperliquid API.`,`• HTTP 429/5xx/timeout requests use bounded exponential retry/backoff.`,`• Freshness is source timestamp based; delayed sources are labeled and never treated as real-time.`,`⏱ Runtime: ${((Date.now()-started)/1000).toFixed(1)}s`,
 `⚙️ Rate safety: candidates=${activityPool.length} | concurrency=${MAX_CONCURRENCY} | gap=${MIN_REQUEST_GAP_MS}ms | 429 cooldown=${GLOBAL_429_COOLDOWN_MS}ms`,`🕒 ${new Date().toISOString()}`);
 const telemetryText=report.join('\n');console.log(telemetryText);const tgLines=['🌐 GFTSH GLOBAL HUNTER V3.0 — BEHAVIOR TRACKER','━━━━━━━━━━━━━━━━━━'];const selectedSignals=globalHunt.signals.filter(s=>s?.ageMin<=FRESH_MIN).sort((a,b)=>(b.behaviorScore||0)-(a.behaviorScore||0)).slice(0,GLOBAL_TELEGRAM_MAX_SIGNALS);if(selectedSignals.length){selectedSignals.forEach((s,i)=>tgLines.push(`🟢 ${i+1} | ${s.name||s.trader?.name||short(s.traderId)} | ${s.source||s.selectedSource}`,`   ${s.side} ${s.coin} | Entry ${px(s.entry)} | Mark ${px(s.mark)} | Dist ${pct(s.distancePct,2)}`,`   SL ${px(s.sl)} | TP ${px(s.tp)} | RR ${safeFixed(s.rr,2)} | Age ${safeFixed(s.ageMin,1)}m`,`   BEHAVIOR ${s.behaviorScore!==undefined?safeFixed(s.behaviorScore,1):s.trader?.quality?.strategy||'SELECTED'} | Repeats ${s.repeats||'—'} | ${s.reason||'VERIFIED'}`,`   VERIFIED: CURRENT POSITION + FRESH ENTRY + REPEATABLE BEHAVIOR`,'━━━━━━━━━━━━━━━━━━'))}const text=selectedSignals.length?tgLines.join('\n'):'';await fs.mkdir(path.dirname(STATE_FILE),{recursive:true});await fs.mkdir(path.dirname(GLOBAL_BEHAVIOR_STATE_FILE),{recursive:true});
 const nextCursor=(cursorBase+Math.max(1,activityPool.length))%Math.max(1,discoveryPool.length);
 await fs.writeFile(GLOBAL_BEHAVIOR_STATE_FILE,JSON.stringify({version:VERSION,updatedAt:Date.now(),cursor:nextCursor,events:mergedEvents,hunters:behaviorHunters.slice(0,GLOBAL_DB_MAX_HUNTERS),trackedHunters:behaviorHunters.filter(x=>x.repeatable).slice(0,GLOBAL_TRACKED_HUNTERS).map(x=>({source:x.source,traderId:x.traderId,name:x.name,repeats:x.repeats,coins:x.coins,score:x.score,avgLeadMin:x.avgLeadMin,avgExitCapturePct:x.avgExitCapturePct}))},null,2));
 await fs.writeFile(STATE_FILE,JSON.stringify({version:VERSION,build:BUILD,generatedAt:Date.now(),discovered:lb.traders.length,behaviorDatabase:{file:GLOBAL_BEHAVIOR_STATE_FILE,loaded:behaviorState.events.length,currentVerified:currentVerified.length,retained30D:mergedEvents.length,repeatableHunters:behaviorHunters.filter(x=>x.repeatable).length,rotationPool:discoveryPool.length,cursor:nextCursor},globalHunt:{sources:globalHunt.sources,events:globalHunt.events,hunters:globalHunt.hunters.slice(0,50),signals:globalHunt.signals.slice(0,20)},audited:audited.length,eligible:eligible.length,signals:[...signals.map(s=>({source:'HYPERLIQUID',address:s.trader.address,coin:s.coin,side:s.side,entry:s.entry,mark:s.mark,sl:s.sl,tp:s.tp,rr:s.rr,ageMin:s.ageMin})),...globalHunt.signals.map(s=>({source:s.source,traderId:s.traderId,coin:s.coin,side:s.side,entry:s.entry,mark:s.mark,sl:s.sl,tp:s.tp,rr:s.rr,ageMin:s.ageMin,behaviorScore:s.behaviorScore,repeats:s.repeats}))],watch:watch.map(x=>({address:x.address,name:x.name,score:x.quality.score,tier:x.quality.tier,blockReason:x.blockReason,performance:x.performance,quality:x.quality,positions:x.positions,copyability:x.copyability,diagnostics:x.diagnostics})),evidenceTop:evidenceTop.slice(0,20).map(x=>({address:x.address,name:x.name,score:x.quality.score,tier:x.quality.tier,performance:x.performance,quality:x.quality,positions:x.positions,copyability:x.copyability,diagnostics:x.diagnostics,blockReason:x.blockReason})),nearMiss:nearMiss.slice(0,20).map(x=>({address:x.address,name:x.name,performance:x.performance,quality:x.quality,positions:x.positions,copyability:x.copyability,diagnostics:x.diagnostics,blockReason:x.blockReason})),errors,errorBreakdown,pipeline:{fills:dsum('fills'),fresh15:dsum('fresh15'),increasing:dsum('increasing'),livePositions:dsum('livePositions'),matched:dsum('matched'),entryWindow:dsum('entryWindow'),qualityPass:diagRows.filter(x=>x.qualityPass).length}},null,2));if(text)await telegram(text);
}
main().catch(async e=>{console.error(`[GFTSH][FATAL] ${e.stack||e}`);process.exitCode=1});
