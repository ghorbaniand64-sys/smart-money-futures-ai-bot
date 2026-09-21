// Hyperliquid Trader Hunter V5.5 - READ ONLY
// Pipeline: full leaderboard discovery -> qualification by deep history -> top 100 -> deep enrichment -> top 5 -> top 1
// NO ORDERS. NO PRIVATE KEYS.

const API_URL = process.env.HYPERLIQUID_API_URL || 'https://api.hyperliquid.xyz/info';
const DISCOVERY_URL = process.env.HYPERLIQUID_HUNTER_DISCOVERY_URL || 'https://stats-data.hyperliquid.xyz/Mainnet/leaderboard';
const DISCOVERY_ENABLED = String(process.env.HYPERLIQUID_HUNTER_DISCOVERY_ENABLED ?? 'true').toLowerCase() === 'true';

const LOOKBACK_DAYS = num('HYPERLIQUID_HUNTER_LOOKBACK_DAYS', 7);
const QUALIFIED_TARGET = integer('HYPERLIQUID_HUNTER_QUALIFIED_TARGET', 100);
const DISCOVERY_PREFILTER = integer('HYPERLIQUID_HUNTER_DISCOVERY_PREFILTER', 2500);
const FINALISTS = integer('HYPERLIQUID_HUNTER_FINALISTS', 5);
const AUTO_SELECT = integer('HYPERLIQUID_HUNTER_AUTO_SELECT', 1);
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
const MAX_POSITION_AGE = num('HYPERLIQUID_HUNTER_MAX_POSITION_AGE_HOURS', 12);
const MAX_POSITIONS = integer('HYPERLIQUID_HUNTER_MAX_OPEN_POSITIONS', 8);
const MAX_CONCENTRATION = num('HYPERLIQUID_HUNTER_MAX_LARGEST_POSITION_PCT', 90);
const RETRIES = integer('HYPERLIQUID_HUNTER_API_RETRIES', 4);
const BASE_DELAY = integer('HYPERLIQUID_HUNTER_API_BASE_DELAY_MS', 700);
const BETWEEN = integer('HYPERLIQUID_HUNTER_BETWEEN_TRADERS_MS', 250);
const MAX_PAGES = integer('HYPERLIQUID_HUNTER_MAX_FILL_PAGES', 12);
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
function category(e){const s=String(e?.message||e||'');if(/HTTP 429/i.test(s))return'HTTP_429';if(/HTTP 5\d\d/i.test(s))return'HTTP_5XX';if(/timeout/i.test(s))return'TIMEOUT';if(/fetch|network|ECONN|socket|ENOTFOUND/i.test(s))return'NETWORK';if(/JSON/i.test(s))return'BAD_JSON';if(/fills/i.test(s))return'FILLS';return'OTHER'}

async function fetchJson(url,options={},label='request'){
  let last;
  for(let attempt=0;attempt<=RETRIES;attempt++){
    const c=new AbortController(),t=setTimeout(()=>c.abort(),TIMEOUT);
    try{
      const r=await fetch(url,{...options,signal:c.signal});
      clearTimeout(t);
      if(r.ok){const text=await r.text();try{return JSON.parse(text)}catch{throw new Error(`${label}: invalid JSON`)}}
      const body=(await r.text()).slice(0,240);const e=new Error(`${label}: HTTP ${r.status} ${body}`);e.status=r.status;throw e;
    }catch(e){
      clearTimeout(t);last=e?.name==='AbortError'?new Error(`${label}: timeout`):e;
      const s=Number(last?.status||0);
      if(!([429,...Array.from({length:100},(_,i)=>500+i)].includes(s)||!s)||attempt>=RETRIES)break;
      const wait=BASE_DELAY*(2**attempt)+Math.floor(Math.random()*250);console.log(`[RETRY] ${label} ${attempt+1}/${RETRIES} wait=${wait}ms ${category(last)}`);await sleep(wait);
    }
  }
  throw last||new Error(`${label}: failed`)
}
async function info(payload,label=payload.type){return fetchJson(API_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)},label)}

function weekStats(row){
  const wp=Array.isArray(row?.windowPerformances)?row.windowPerformances:[];
  const m=Object.fromEntries(wp.filter(Array.isArray).map(x=>[String(x[0]).toLowerCase(),x[1]||{}]));
  return m.week||m['7d']||m.day||{};
}
function discoveryScore(row){
  const w=weekStats(row),p=Number(w.pnl),r=Number(w.roi),v=Number(w.vlm);
  // Leaderboard data is only a cheap pre-rank. It is never used as the final qualification gate.
  return (Number.isFinite(p)?Math.max(0,p):0)*1000+(Number.isFinite(r)?Math.max(0,r):0)*100+(Number.isFinite(v)&&v>0?Math.log10(v):0);
}
function leaderboardHints(row){
  const w=weekStats(row);return{pnl:Number(w.pnl),roi:Number(w.roi),volume:Number(w.vlm)};
}

async function discover(){
  const map=new Map();
  for(const a of [...SEEDS,...MANUAL])if(addr(a))map.set(norm(a),{ethAddress:norm(a),source:'manual'});
  if(!DISCOVERY_ENABLED)return{discovered:map.size,rows:[...map.values()],source:'manual_only'};
  const data=await fetchJson(DISCOVERY_URL,{},'leaderboard discovery');
  const rows=Array.isArray(data?.leaderboardRows)?data.leaderboardRows:[];
  let valid=0;
  for(const row of rows){if(!addr(row?.ethAddress))continue;valid++;const a=norm(row.ethAddress);map.set(a,{...row,ethAddress:a,source:'leaderboard'})}
  const all=[...map.values()];
  // Keep the entire leaderboard in memory. Only the inexpensive pre-rank is limited before expensive fills calls.
  const prefiltered=all.sort((a,b)=>discoveryScore(b)-discoveryScore(a)).slice(0,Math.max(QUALIFIED_TARGET,DISCOVERY_PREFILTER));
  return{discovered:new Set(rows.filter(r=>addr(r?.ethAddress)).map(r=>norm(r.ethAddress))).size,candidates:prefiltered,allCount:all.length,source:'leaderboardRows.ethAddress:pre_rank'};
}

function fillKey(f){return [f?.tid??'',f?.hash??'',f?.time??'',f?.coin??'',f?.px??'',f?.sz??'',f?.side??'',f?.dir??''].join('|')}
async function getFills(user,start,end){
  let cursor=start,pages=0;const map=new Map();let truncated=false;
  while(pages<MAX_PAGES){
    pages++;
    const b=await info({type:'userFillsByTime',user,startTime:cursor,endTime:end,aggregateByTime:false},`fills ${short(user)} page=${pages}`);
    if(!Array.isArray(b))throw new Error('fills: unexpected response');
    for(const f of b){if(f?.time)map.set(fillKey(f),f)}
    if(b.length===0||b.length<2000)break;
    const max=Math.max(...b.map(f=>Number(f?.time||0)));
    if(!max||max>=end)break;
    const next=max+1;
    if(next<=cursor)break;
    cursor=next;await sleep(80);
  }
  if(pages>=MAX_PAGES)truncated=true;
  const fills=[...map.values()].sort((a,b)=>Number(a.time)-Number(b.time));
  return{fills,pages,truncated,newest:fills.length?Number(fills[fills.length-1].time):0};
}

function classifyFill(f){
  const dir=String(f?.dir||'').toLowerCase().replace(/_/g,' ');
  if(dir.includes('liquid'))return'LIQUIDATION';
  if(dir.includes('close long'))return'CLOSE_LONG';
  if(dir.includes('close short'))return'CLOSE_SHORT';
  if(dir.includes('open long'))return'OPEN_LONG';
  if(dir.includes('open short'))return'OPEN_SHORT';
  const side=String(f?.side||'').toUpperCase();
  return side==='B'?'BUY':side==='A'?'SELL':'UNKNOWN';
}
function reconstruct(fills){
  const books=new Map(),trades=[];let liquidations=0,invalidLifecycle=0;
  for(const f of fills){
    const coin=String(f?.coin||'');if(!coin)continue;
    const px=Number(f?.px),time=Number(f?.time),sz=Math.abs(Number(f?.sz||0));if(!Number.isFinite(px)||!Number.isFinite(time)||!Number.isFinite(sz)||sz<=0)continue;
    const type=classifyFill(f);if(type==='LIQUIDATION'){liquidations++;continue}
    let side=null,action=null;
    if(type==='OPEN_LONG'||type==='CLOSE_LONG')side='long';
    if(type==='OPEN_SHORT'||type==='CLOSE_SHORT')side='short';
    if(!side){const d=String(f?.dir||'').toLowerCase();if(/long/.test(d))side='long';else if(/short/.test(d))side='short'}
    const lots=books.get(coin)||[];books.set(coin,lots);
    if(type.startsWith('OPEN_'))action='open';else if(type.startsWith('CLOSE_'))action='close';
    else{
      const start=Number(f?.startPosition);
      const delta=String(f?.side||'').toUpperCase()==='B'?sz:String(f?.side||'').toUpperCase()==='A'?-sz:0;
      if(Number.isFinite(start)&&delta){
        if(start===0)action='open';else if((start>0&&delta<0)||(start<0&&delta>0))action='close';else action='open';
        side=start>0?'long':'short';
      }else{action='unknown'}
    }
    if(action==='open'){
      lots.push({side:side||'long',qty:sz,px,time});
      continue;
    }
    if(action!=='close')continue;
    let rem=sz,closingSide=side;
    while(rem>1e-12){
      let idx=lots.findIndex(l=>l.side===closingSide);
      if(idx<0){invalidLifecycle++;break}
      const lot=lots[idx],used=Math.min(rem,lot.qty),fq=sz,cp=Number(f?.closedPnl);
      const pnl=Number.isFinite(cp)?cp*(used/fq):(lot.side==='long'?(px-lot.px)*used:(lot.px-px)*used);
      if(!Number.isFinite(pnl)){invalidLifecycle++;break}
      trades.push({coin,side:lot.side,qty:used,entryPx:lot.px,exitPx:px,openTime:lot.time,closeTime:time,holdHours:Math.max(0,(time-lot.time)/3600000),pnl});
      lot.qty-=used;rem-=used;if(lot.qty<=1e-12)lots.splice(idx,1);
    }
  }
  return{trades,liquidations,invalidLifecycle,openLots:[...books.values()].flat().filter(x=>x.qty>1e-12)};
}
function metrics(fills,r){
  const ts=r.trades,w=ts.filter(t=>t.pnl>0),l=ts.filter(t=>t.pnl<0),holds=ts.map(t=>t.holdHours).filter(Number.isFinite);
  const gw=w.reduce((s,t)=>s+t.pnl,0),gl=Math.abs(l.reduce((s,t)=>s+t.pnl,0)),pnl=ts.reduce((s,t)=>s+t.pnl,0);
  const days=new Set(ts.map(t=>new Date(t.closeTime).toISOString().slice(0,10)));
  let st=0,maxst=0;for(const t of [...ts].sort((a,b)=>a.closeTime-b.closeTime)){if(t.pnl<0){st++;maxst=Math.max(maxst,st)}else if(t.pnl>0)st=0}
  return{fills:fills.length,closedTrades:ts.length,invalidLifecycle:Number(r.invalidLifecycle||0),winRate:ts.length?w.length/ts.length*100:0,pnl,grossWin:gw,grossLossAbs:gl,profitFactor:gl>0?gw/gl:(gw>0?Infinity:0),medianHoldHours:median(holds),avgHoldHours:holds.length?holds.reduce((a,b)=>a+b,0)/holds.length:NaN,p25HoldHours:quantile(holds,.25),p75HoldHours:quantile(holds,.75),activeDays:days.size,maxLosingStreak:maxst,liquidations:r.liquidations,openLots:r.openLots.length};
}
function hardQualification(m,truncated){
  const reasons=[];
  if(truncated)reasons.push('HISTORY_TRUNCATED');
  if(m.closedTrades<MIN_TRADES)reasons.push(`TRADES<${MIN_TRADES}`);
  if(m.winRate<MIN_WR)reasons.push(`WR<${MIN_WR}%`);
  if(!(m.pnl>MIN_PNL))reasons.push(`PNL<=${MIN_PNL}`);
  if(!(m.profitFactor>=MIN_PF))reasons.push(`PF<${MIN_PF}`);
  if(!(m.activeDays>=MIN_ACTIVE_DAYS))reasons.push(`ACTIVE_DAYS<${MIN_ACTIVE_DAYS}`);
  if(m.maxLosingStreak>MAX_LOSING_STREAK)reasons.push(`LOSING_STREAK>${MAX_LOSING_STREAK}`);
  if(m.liquidations>MAX_LIQ)reasons.push(`LIQUIDATIONS>${MAX_LIQ}`);
  if(m.invalidLifecycle>Math.max(3,Math.ceil(m.fills*0.02)))reasons.push(`INVALID_LIFECYCLE>${Math.max(3,Math.ceil(m.fills*0.02))}`);
  return{ok:reasons.length===0,reasons};
}
function softFlags(m){const r=[];if(m.medianHoldHours>MAX_MEDIAN_HOLD)r.push(`MEDIAN_HOLD>${MAX_MEDIAN_HOLD}h`);if(m.avgHoldHours>MAX_AVG_HOLD)r.push(`AVG_HOLD>${MAX_AVG_HOLD}h`);return r}
function qualityScore(m){
  if(m.closedTrades<=0)return 0;
  const trade=Math.min(100,m.closedTrades/Math.max(30,MIN_TRADES)*100);
  const wr=Math.max(0,Math.min(100,m.winRate/80*100));
  const pf=Math.max(0,Math.min(100,Math.min(m.profitFactor,5)/3*100));
  const hold=Number.isFinite(m.avgHoldHours)?Math.max(0,Math.min(100,100-Math.max(0,m.avgHoldHours-2)/18*100)):40;
  const active=Math.max(0,Math.min(100,m.activeDays/7*100));
  const pnl=m.pnl>0?Math.min(100,60+Math.log10(Math.max(1,m.pnl))*8):Math.max(0,40-Math.log10(Math.max(1,Math.abs(m.pnl)+1))*8);
  return Math.round(Math.max(0,Math.min(100,0.18*trade+0.22*wr+0.24*pf+0.14*hold+0.10*active+0.12*pnl-Math.min(35,m.maxLosingStreak*4)*.5-Math.min(35,m.liquidations*12)*.5)));
}
function rankStat(a,b){return(b.qualityScore-a.qualityScore)||(b.metrics.profitFactor-a.metrics.profitFactor)||(b.metrics.winRate-a.metrics.winRate)||(b.metrics.closedTrades-a.metrics.closedTrades)||(b.metrics.activeDays-a.metrics.activeDays)}

async function positions(user){
  const s=await info({type:'clearinghouseState',user},`position ${short(user)}`);
  return(Array.isArray(s?.assetPositions)?s.assetPositions:[]).map(x=>x?.position).filter(Boolean).filter(p=>Math.abs(Number(p.szi||0))>0);
}
async function book(coin){
  const b=await info({type:'l2Book',coin},`book ${coin}`),lv=Array.isArray(b?.levels)?b.levels:[];
  // Hyperliquid returns levels as [bids, asks].
  const bid=Number(lv?.[0]?.[0]?.px),ask=Number(lv?.[1]?.[0]?.px);if(!Number.isFinite(bid)||!Number.isFinite(ask))throw new Error(`book ${coin}: no bid/ask`);return{bid,ask,mid:(bid+ask)/2};
}
async function atr(coin,end){
  const c=await info({type:'candleSnapshot',req:{coin,interval:'1h',startTime:end-120*3600000,endTime:end}},`candles ${coin}`);
  const rows=Array.isArray(c)?c:[],parsed=rows.map(x=>({h:Number(x?.h),l:Number(x?.l),c:Number(x?.c)})).filter(x=>Number.isFinite(x.h)&&Number.isFinite(x.l)&&Number.isFinite(x.c)&&x.h>x.l);
  if(parsed.length<20)throw new Error(`candles ${coin}: insufficient 1h data (${parsed.length})`);
  const tr=[];let prev=NaN;for(const x of parsed){const v=Number.isFinite(prev)?Math.max(x.h-x.l,Math.abs(x.h-prev),Math.abs(x.l-prev)):x.h-x.l;if(v>0)tr.push(v);prev=x.c}
  if(tr.length<20)throw new Error(`candles ${coin}: invalid 1h true-range data`);
  // Wilder-style ATR over the latest 14 true ranges.
  const n=14;let value=tr.slice(0,n).reduce((a,b)=>a+b,0)/n;for(let i=n;i<tr.length;i++)value=((value*(n-1))+tr[i])/n;
  if(!Number.isFinite(value)||value<=0)throw new Error(`candles ${coin}: ATR invalid ${value}`);return value;
}
function positionEntry(p){for(const k of ['entryPx','entryPrice','avgEntryPx']){const v=Number(p?.[k]);if(Number.isFinite(v)&&v>0)return v}return NaN}
function positionAge(p,now){for(const k of ['timestamp','entryTimestamp','openTime']){const v=Number(p?.[k]);if(Number.isFinite(v)&&v>0)return Math.max(0,(now-v)/3600000)}return NaN}
function plan(pos,bookData,atrv,now){
  const s=Number(pos?.szi||0),source=positionEntry(pos);if(!Number.isFinite(s)||s===0)throw new Error('POSITION_SIZE_INVALID');if(!Number.isFinite(source))throw new Error('POSITION_ENTRY_INVALID');
  const side=s>0?'LONG':'SHORT',dist=Math.abs(bookData.mid-source)/source*100,atrPct=atrv/bookData.mid*100;if(!Number.isFinite(atrv)||atrv<=0)throw new Error('ATR_INVALID');if(!Number.isFinite(bookData.mid)||bookData.mid<=0)throw new Error('BOOK_MID_INVALID');if(!Number.isFinite(atrPct)||atrPct<=0||atrPct>25)throw new Error(`ATR_SANITY_FAIL:${fmt(atrPct,2)}%`);
  const sl=side==='LONG'?bookData.mid-SL_ATR*atrv:bookData.mid+SL_ATR*atrv,tp=side==='LONG'?bookData.mid+TP_ATR*atrv:bookData.mid-TP_ATR*atrv,risk=Math.abs(bookData.mid-sl),reward=Math.abs(tp-bookData.mid),rr=risk>0?reward/risk:0,age=positionAge(pos,now);
  if(!Number.isFinite(sl)||!Number.isFinite(tp)||sl<=0||tp<=0)throw new Error('SL_TP_INVALID');if(!Number.isFinite(rr)||rr<=0)throw new Error('RR_INVALID');if(Math.abs(sl-bookData.mid)<Math.max(atrv*.05,bookData.mid*.00005))throw new Error('SL_TOO_CLOSE');if(Math.abs(tp-bookData.mid)<Math.max(atrv*.05,bookData.mid*.00005))throw new Error('TP_TOO_CLOSE');
  const reasons=[];if(dist>MAX_ENTRY_DIST)reasons.push(`ENTRY_DISTANCE>${MAX_ENTRY_DIST}%`);if(rr<MIN_RR)reasons.push(`RR<${MIN_RR}`);if(Number.isFinite(age)&&age>MAX_POSITION_AGE)reasons.push(`POSITION_AGE>${MAX_POSITION_AGE}h`);
  return{eligible:reasons.length===0,reason:reasons.join('|')||'READY',side,coin:String(pos?.coin||''),sourceEntry:source,entry:bookData.mid,distancePct:dist,sl,tp,rr,atr:atrv,atrPct,positionAgeHours:age};
}
function copyability(x){
  let s=x.qualityScore*.40;if(!x.positions?.length)return Math.round(s);
  const p=x.plans.find(z=>z.eligible)||x.plans[0];if(!p)return Math.round(s);
  if(p.eligible)s+=25;else s-=20;
  s+=Math.max(0,15-Math.min(15,(p.distancePct||99)/Math.max(MAX_ENTRY_DIST,.01)*15));
  if(Number.isFinite(p.positionAgeHours))s+=Math.max(0,10-Math.min(10,p.positionAgeHours/Math.max(MAX_POSITION_AGE,1)*10));
  if(p.rr>=MIN_RR)s+=10;
  s+=p.atrPct<=3?10:Math.max(0,10-(p.atrPct-3)*2);
  const count=x.positions.length;s+=count<=MAX_POSITIONS?5:-5;
  return Math.round(Math.max(0,Math.min(100,s)));
}
async function enrich(x,now){
  try{
    const ps=await positions(x.address);x.positions=ps;x.position=null;x.plans=[];
    if(!ps.length){x.enrichmentStatus='WATCH_NO_POSITION';x.copyabilityScore=Math.round(x.qualityScore*.40);return x}
    if(ps.length>MAX_POSITIONS)x.positionRiskFlags=[`OPEN_POSITIONS>${MAX_POSITIONS}`];
    let totalAbs=0;for(const p of ps)totalAbs+=Math.abs(Number(p.szi||0))*Math.max(positionEntry(p)||0,0);
    for(const p of ps){const coin=String(p.coin||'');if(!coin)continue;const bk=await book(coin),av=await atr(coin,now),pl=plan(p,bk,av,now);pl.notional=Math.abs(Number(p.szi||0))*bk.mid;pl.concentrationPct=totalAbs>0?pl.notional/totalAbs*100:0;x.plans.push(pl)}
    if(!x.plans.length)throw new Error('NO_VALID_POSITION_PLANS');
    x.position=x.plans.find(p=>p.eligible)||x.plans[0];
    const concentrated=x.plans.some(p=>p.concentrationPct>MAX_CONCENTRATION);if(concentrated)x.positionRiskFlags=[...(x.positionRiskFlags||[]),`CONCENTRATION>${MAX_CONCENTRATION}%`];
    x.copyabilityScore=copyability(x);x.enrichmentStatus=(x.position.eligible&&!concentrated)?'COPY_READY':'POSITION_BLOCKED';return x;
  }catch(e){x.plans=[];x.enrichmentStatus=`POSITION_DATA_INVALID:${category(e)}`;x.enrichmentError=e.message;x.copyabilityScore=0;return x}
}
async function telegram(text){
  if(!TG_TOKEN||!TG_CHAT){console.log('[TELEGRAM] missing credentials');return}
  for(let i=0;i<text.length;i+=TG_LIMIT){try{await fetchJson(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:TG_CHAT,text:text.slice(i,i+TG_LIMIT),disable_web_page_preview:true})},'telegram')}catch(e){console.error(`[TELEGRAM][ERROR] ${e.message}`)}}
}
function errSummary(es){const m={};for(const e of es)m[e.cat]=(m[e.cat]||0)+1;return Object.entries(m).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k}:${v}`).join(' | ')||'none'}
function icon(s){return s==='COPY_READY'?'🟢':s==='WATCH_NO_POSITION'?'🟡':s==='POSITION_BLOCKED'?'🟠':'🔴'}

async function main(){
  console.log(`[HUNTER V5.5][START] ${JSON.stringify({lookbackDays:LOOKBACK_DAYS,qualifiedTarget:QUALIFIED_TARGET,discoveryPrefilter:DISCOVERY_PREFILTER,finalists:FINALISTS})}`);
  let d;try{d=await discover()}catch(e){console.error(`[DISCOVERY][ERROR] ${e.message}`);await telegram(`🟣 HYPERLIQUID TRADER HUNTER V5.5\n📡 READ-ONLY | NO ORDERS\n━━━━━━━━━━━━━━━━━━\n❌ DISCOVERY ERROR\n${e.message}`);process.exitCode=1;return}
  console.log(`[DISCOVERY] leaderboard=${d.discovered} totalKnown=${d.allCount||d.discovered} prefilter=${d.candidates.length}`);
  const start=Date.now()-LOOKBACK_DAYS*86400000,now=Date.now(),qualified=[],scanned=[],errors=[],rejectCounts={};
  for(let i=0;i<d.candidates.length&&qualified.length<QUALIFIED_TARGET;i++){
    const candidate=d.candidates[i],a=norm(candidate.ethAddress);
    try{
      const f=await getFills(a,start,now),r=reconstruct(f.fills),m=metrics(f.fills,r),q=hardQualification(m,f.truncated);
      const x={address:a,hints:leaderboardHints(candidate),metrics:m,qualification:q,truncated:f.truncated,qualityScore:qualityScore(m),softFlags:softFlags(m)};scanned.push(x);
      if(q.ok){qualified.push(x);console.log(`[QUALIFY] ${qualified.length}/${QUALIFIED_TARGET} source=${i+1}/${d.candidates.length} ${short(a)} trades=${m.closedTrades} WR=${fmt(m.winRate,1)} PF=${fmt(m.profitFactor)} Q=${x.qualityScore}`)}
      else{for(const z of q.reasons)rejectCounts[z]=(rejectCounts[z]||0)+1}
    }catch(e){const cat=category(e);errors.push({address:a,cat,message:String(e.message||e)});console.error(`[SCREEN][ERROR] ${i+1}/${d.candidates.length} ${short(a)} ${cat} :: ${e.message}`)}
    if(i+1<d.candidates.length&&qualified.length<QUALIFIED_TARGET)await sleep(BETWEEN);
  }
  // If more than 100 qualified somehow exist in the scan, rank them by quality and keep exactly the requested pool.
  qualified.sort(rankStat);const deepPool=qualified.slice(0,QUALIFIED_TARGET);
  for(const x of deepPool)await enrich(x,now);
  const finalists=[...deepPool].sort((a,b)=>(b.copyabilityScore-a.copyabilityScore)||rankStat(a,b)).slice(0,Math.max(1,FINALISTS));
  const selected=AUTO_SELECT?finalists.filter(x=>x.enrichmentStatus==='COPY_READY').slice(0,1):[];
  const rejectionText=Object.entries(rejectCounts).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([k,v])=>`${k}:${v}`).join(' | ')||'none';
  const enrichCounts={};for(const x of deepPool){enrichCounts[x.enrichmentStatus]=(enrichCounts[x.enrichmentStatus]||0)+1}
  const lines=['🟣 HYPERLIQUID TRADER HUNTER V5.5','📡 READ-ONLY | NO ORDERS','━━━━━━━━━━━━━━━━━━',`🔎 Leaderboard: ${d.discovered}`,`🧪 Screening pool: ${d.candidates.length}`,`📊 Deep-screened: ${scanned.length}`,`✅ Qualified: ${qualified.length}/${QUALIFIED_TARGET}`,`🧠 Deep pool: ${deepPool.length}/${QUALIFIED_TARGET}`,`🏆 Finalists: ${finalists.length}/${Math.min(FINALISTS,deepPool.length)}`,`🟢 Copy eligible: ${selected.length}`,`⚡ Auto selected: ${selected.length}`,`⚠️ Scan errors: ${errors.length}`,`📚 Lookback: ${LOOKBACK_DAYS}d | Hard qualification + copyability`,
    `⚙️ Pipeline: ALL→SCREEN→${QUALIFIED_TARGET} QUALIFIED→DEEP→${FINALISTS} FINALISTS→1 SELECT`,'','🧱 TOP SCREEN REJECTIONS',rejectionText,'','🧩 ENRICHMENT',Object.entries(enrichCounts).map(([k,v])=>`${k}:${v}`).join(' | ')||'none','', '🏆 FINALISTS'];
  if(!finalists.length)lines.push('No qualified trader reached finalist stage.');
  else finalists.forEach((x,i)=>{const m=x.metrics,p=x.position;lines.push('',`#${i+1} ${short(x.address)}`,`${icon(x.enrichmentStatus)} ${x.enrichmentStatus} | Quality=${x.qualityScore}/100 | Copyability=${x.copyabilityScore}/100`,`📈 7D: trades=${m.closedTrades} | WR=${pct(m.winRate)} | PnL=${fmt(m.pnl)} | PF=${fmt(m.profitFactor)} | lifecycleErr=${m.invalidLifecycle}`,`⏱ Hold: median=${fmt(m.medianHoldHours)}h | avg=${fmt(m.avgHoldHours)}h | activeDays=${m.activeDays}`,`🧯 Streak=${m.maxLosingStreak} | liq=${m.liquidations} | fills=${m.fills} | openLots=${m.openLots}`,p?`📌 ${p.side} ${p.coin} | source=${fmt(p.sourceEntry)} | now=${fmt(p.entry)} | dist=${pct(p.distancePct,2)} | SL=${fmt(p.sl)} | TP=${fmt(p.tp)} | RR=${fmt(p.rr)} | age=${fmt(p.positionAgeHours)}h | concentration=${pct(p.concentrationPct,1)}`:`📌 Position: NONE | Copy now: NO | Watchlist: YES`,x.softFlags.length?`ℹ️ Soft: ${x.softFlags.join(', ')}`:'',x.positionRiskFlags?.length?`⚠️ Risk: ${x.positionRiskFlags.join(', ')}`:'');if(x.enrichmentError)lines.push(`⚠️ Enrichment: ${x.enrichmentError.slice(0,180)})`)});
  lines.push('','🚀 AUTO SELECTED',selected.length?`${short(selected[0].address)} | ${selected[0].position.side} ${selected[0].position.coin} | Quality=${selected[0].qualityScore}/100 | Copyability=${selected[0].copyabilityScore}/100 | Entry=${fmt(selected[0].position.entry)} | SL=${fmt(selected[0].position.sl)} | TP=${fmt(selected[0].position.tp)} | RR=${fmt(selected[0].position.rr)}`:'None — no current position passed copyability checks.','',`ℹ️ Qualification is hard-gated: trades≥${MIN_TRADES}, WR≥${MIN_WR}%, PnL>${MIN_PNL}, PF≥${MIN_PF}, activeDays≥${MIN_ACTIVE_DAYS}, losingStreak≤${MAX_LOSING_STREAK}, liquidations≤${MAX_LIQ}.`,'ℹ️ Leaderboard PnL/ROI/volume are pre-ranking hints only; final qualification comes from reconstructed fills.','ℹ️ All current positions are inspected during enrichment; no source TP/SL is copied.','ℹ️ Entry/SL/TP are READ-ONLY diagnostics.','ℹ️ No orders are created by this worker.',`🕐 ${new Date().toISOString()}`);
  console.log(`[HUNTER V5.5][DONE] leaderboard=${d.discovered} screened=${scanned.length} qualified=${qualified.length} deep=${deepPool.length} finalists=${finalists.length} selected=${selected.length}`);await telegram(lines.join('\n'));
}
main().catch(async e=>{console.error(`[HUNTER V5.5][FATAL] ${e.stack||e}`);await telegram(`🟣 HYPERLIQUID TRADER HUNTER V5.5\n📡 READ-ONLY | NO ORDERS\n━━━━━━━━━━━━━━━━━━\n💥 FATAL ERROR\n${String(e.message||e).slice(0,1000)}`);process.exitCode=1});
