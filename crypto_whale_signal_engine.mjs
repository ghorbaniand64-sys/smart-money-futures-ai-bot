import fs from 'node:fs/promises';
import path from 'node:path';

// GFTSH V2.1.2 — GLOBAL FUTURES ACTUAL-TRADE RECON / MULTI-SIGNAL
// READ ONLY. NO ORDERS. NO AUTO-COPY. FUTURES ONLY.
// Source authority: Hyperliquid public leaderboard + public user fills + clearinghouseState.
// Current position authority: clearinghouseState ONLY. Stale fills never become a live position.

const VERSION='GFTSH-V2.1.9-GLOBAL-FUTURES-ACTUAL-TRADE-RECON-COPYABILITY-PERFORMANCE-FORENSICS';
const BUILD='V2.1.9-COPYABILITY-PERFORMANCE-FORENSICS-RECENT-VS-HISTORICAL-POSITION-CONCENTRATION-ANOMALY-AUDIT';
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
const LOOKBACK_HOURS=Math.max(24,Number(process.env.GFTSH_PERFORMANCE_LOOKBACK_HOURS||168));
const MAX_FILL_PAGES=Math.max(2,Number(process.env.GFTSH_MAX_FILL_PAGES||8));
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
const MIN_NOTIONAL=Number(process.env.GFTSH_MIN_SIGNAL_NOTIONAL_USD||100);
const MIN_24H_VOL=Number(process.env.GFTSH_MIN_24H_VOLUME_USD||1000000);
const TOP_WATCH=Math.max(5,Number(process.env.GFTSH_WATCHLIST_SIZE||10));
const MAX_SIGNALS=Math.max(2,Number(process.env.GFTSH_MAX_SIGNALS||5));
const BETWEEN_MS=Number(process.env.GFTSH_BETWEEN_TRADERS_MS||120);
const HL_RETRIES=Math.max(1,Number(process.env.GFTSH_HL_RETRIES||4));
const HL_RETRY_BASE_MS=Math.max(100,Number(process.env.GFTSH_HL_RETRY_BASE_MS||500));
const STATE_FILE=process.env.GFTSH_STATE_FILE||'state/gftsh_v2_1_9_state.json';
const TG_STATE=process.env.GFTSH_TELEGRAM_STATE_FILE||'state/gftsh_telegram_state.json';
const DIAG_WINDOW_MIN=Math.min(FRESH_MIN,15);

let requestGate=Promise.resolve();
let nextRequestAt=0;
let global429Until=0;

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
function quality(perf,lb){
 const reasons=[];
 const tradesFail=perf.closedTrades<MIN_TRADES;
 const wrFail=!(perf.wr>=MIN_WR);
 const pfUnavailable=perf.pf===null;
 const pfFail=!pfUnavailable&&perf.pf<MIN_PF;
 const pnlFail=perf.realizedPnl<=0;
 const ddBase=Math.max(1,Math.abs(perf.grossWin)+Math.abs(perf.grossLoss));
 const ddPct=perf.maxDrawdown/ddBase*100;
 const ddFail=ddPct>MAX_DD;
 const anomaly=(perf.pf!==null&&perf.pf>30)||(perf.wr!==null&&perf.wr>99.5&&perf.closedTrades<20);
 if(tradesFail)reasons.push(`TRADES<${MIN_TRADES}`);
 if(wrFail)reasons.push(`WR<${MIN_WR}%`);
 if(pfUnavailable)reasons.push('PF_UNAVAILABLE');else if(pfFail)reasons.push(`LOW_PF<${MIN_PF}`);
 if(pnlFail)reasons.push('NON_POSITIVE_REALIZED_PNL');
 if(ddFail)reasons.push(`DD>${MAX_DD}%`);
 if(anomaly)reasons.push('PF_WR_ANOMALY_REVIEW');
 const hardFails=[tradesFail,wrFail,pfUnavailable,pfFail,ddFail,anomaly];
 const score=Math.max(0,Math.min(100,100-hardFails.filter(Boolean).length*8+Math.min(10,perf.closedTrades/10)+Math.min(5,Math.max(0,(perf.wr||0)-60)/8)));
 let tier=score>=82?'S':score>=72?'A':score>=60?'B':'C';
 if(anomaly)tier=score>=72?'A':'B';
 return {score,tier,reasons,ddPct,anomaly,tradesFail,wrFail,pfUnavailable,pfFail,pnlFail,ddFail,hardFailCount:hardFails.filter(Boolean).length};
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
  const diag={fills:0,fresh15:0,increasing:0,livePositions:0,matched:0,entryWindow:0,missingMid:0,invalidEntry:0,watchDistanceFail:0,entryDistanceFail:0,rrFail:0,qualityPass:false,signalPass:false,activityProbe:true,historyLoaded:false,stateChecked:false,quality:{tradesFail:false,wrFail:false,pfUnavailable:false,pfFail:false,pnlFail:false,ddFail:false,anomaly:false}};
  // Activity-first: query only the last freshness window before touching full history or state.
  const probeStart=Math.max(start,end-DIAG_WINDOW_MIN*60000);
  const probe=await recentFillsFor(c.address,probeStart,end);
  const probeAdds=latestOpenAdds(probe);
  diag.fresh15=probeAdds.filter(x=>x.__fresh).length;
  diag.increasing=probeAdds.filter(x=>x.__positionDelta!==0&&Math.abs(x.__positionAfter)>Math.abs(x.__positionBefore)+1e-10).length;
  if(!diag.fresh15){
    return {...c,performance:{closedTrades:0,wins:0,losses:0,wr:null,pf:null,realizedPnl:0,grossWin:0,grossLoss:0,maxDrawdown:0,activeDays:0,recentClosed:0,recent24:{trades:0,wins:0,losses:0,wr:null,pf:null,pnl:0},recent7:{trades:0,wins:0,losses:0,wr:null,pf:null,pnl:0},avgHoldHours:null,medianHoldHours:null,tradesPerDay:0,recognizedFills:0,unknownFills:0,reversalFills:0,invalidFills:0,distribution:{},longestWinStreak:0,longestLossStreak:0,recoveryFactor:null,pnlConcentrationPct:null,openBooks:[],closed:[]},quality:{score:0,tier:'C',reasons:['NO_FRESH_POSITION_INCREASE_15M'],ddPct:0,anomaly:false},positions:[],copyability:{livePositions:0,liveNotional:0,maxPositionSharePct:null,maxCoinSharePct:null,avgLeverage:null,maxLeverage:null,positionAgeHours:null,avgPositionAgeHours:null,positionDetails:[]},latestAdd:null,currentSignal:null,blockReason:'NO_FRESH_POSITION_INCREASE_15M',diagnostics:diag};
  }
  const fills=await fillsFor(c.address,start,probeStart-1,probe);diag.fills=fills.length;diag.historyLoaded=true;
  const perf=reconstruct(fills);const q=quality(perf,c.lb);
  diag.quality={
    tradesFail:perf.closedTrades<MIN_TRADES,
    wrFail:!(perf.wr>=MIN_WR),
    pfUnavailable:perf.pf===null,
    pfFail:perf.pf!==null&&perf.pf<MIN_PF,
    pnlFail:perf.realizedPnl<=0,
    ddFail:q.ddPct>MAX_DD,
    anomaly:Boolean(q.anomaly)
  };
  diag.qualityPass=!diag.quality.tradesFail&&!diag.quality.wrFail&&!diag.quality.pfUnavailable&&!diag.quality.pfFail&&!diag.quality.ddFail&&!diag.quality.anomaly&&q.tier!=='C';
  const state=await stateFor(c.address);diag.stateChecked=true;
  const ps=positions(state);diag.livePositions=ps.length;const posByCoin=new Map(ps.map(p=>[p.coin,p]));
  const adds=latestOpenAdds(fills);diag.fresh15=adds.filter(x=>x.__fresh).length;diag.increasing=adds.filter(x=>x.__positionDelta!==0&&Math.abs(x.__positionAfter)>Math.abs(x.__positionBefore)+1e-10).length;
  let candidate=null;let block=ps.length?'POSITION_EXISTS_BUT_NO_FRESH_OPEN_ADD':'NO_CURRENT_POSITION';
  for(const f of adds){
    if(!f.__fresh)continue;
    const p=posByCoin.get(String(f.coin));if(!p)continue;
    diag.matched++;
    const mid=num(midsMap[String(f.coin)]);
    if(!(mid>0)){diag.missingMid++;continue}
    const entry=num(p.entry)||num(f.px);
    if(!(entry>0)){diag.invalidEntry++;continue}
    const sig=makeSignal({...c,quality:q,performance:perf},q,p,f,mid);
    if(!sig) {diag.invalidEntry++;continue}
    if(sig.absDistancePct>WATCH_MAX)diag.watchDistanceFail++;
    if(sig.absDistancePct>ENTRY_MAX)diag.entryDistanceFail++;
    else if(sig.rr<MIN_RR)diag.rrFail++;
    else diag.entryWindow++;
    if(sig?.entryReady&&diag.qualityPass){candidate=sig;break}
    if(sig?.blocked)block=sig.blocked;else if(sig?.reason)block=sig.reason;
  }
  if(!candidate&&ps.length===0)block='NO_CURRENT_POSITION';
  else if(!candidate&&diag.matched===0)block='FRESH_INCREASE_NO_LIVE_POSITION_MATCH';
  else if(!candidate&&!diag.qualityPass)block='TRADER_QUALITY_GATE_FAILED';
  else if(!candidate&&diag.entryWindow===0)block=`ENTRY_DISTANCE_GT_${ENTRY_MAX}%`;
  diag.signalPass=Boolean(candidate);
  const cp=copyability(ps,perf,adds); return {...c,performance:perf,quality:q,positions:ps,copyability:cp,latestAdd:adds[0]||null,currentSignal:candidate,blockReason:block,diagnostics:diag};
}
function sortCandidates(rows){return rows.slice().sort((a,b)=>{
 const as=a.currentSignal?1:0,bs=b.currentSignal?1:0;if(bs!==as)return bs-as;
 if(b.quality.score!==a.quality.score)return b.quality.score-a.quality.score;
 return num(b.performance.closedTrades)-num(a.performance.closedTrades);
})}
function fmtTrader(x){const p=x.performance,q=x.quality;return `${short(x.address)} | ${q.tier} ${q.score.toFixed(1)} | Trades ${p.closedTrades} | WR ${finite(p.wr)?p.wr.toFixed(1)+'%':'—'} | PF ${p.pf===null?'—':p.pf.toFixed(2)} | DD ${pct(q.ddPct,1)} | PnL ${usd(p.realizedPnl)}`}
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
function evidenceLine(x){
 const p=x.performance||{},q=x.quality||{},d=x.diagnostics||{},c=x.copyability||{};
 const live=(d.livePositions||0)>0?'LIVE':'NO-LIVE',pos=d.matched>0?'MATCH':'NO-MATCH',entry=d.entryWindow>0?'ENTRY':'NO-ENTRY';
 const recent=p.recent24||{};const dist=p.distribution||{};
 return `${short(x.address)} | ${q.tier} ${q.score.toFixed(1)} | ${live}/${pos}/${entry} | ${p.closedTrades}T | WR ${finite(p.wr)?p.wr.toFixed(1)+'%':'—'} | PF ${p.pf===null?'—':p.pf.toFixed(2)} | DD ${pct(q.ddPct,1)} | 24H ${recent.trades}T/${finite(recent.wr)?recent.wr.toFixed(0)+'%':'—'}/${recent.pf===null?'—':finite(recent.pf)?recent.pf.toFixed(2):'—'} | AvgW/L ${usd(dist.avgWin,0)}/${usd(dist.avgLoss,0)} | Streak L${p.longestLossStreak||0} | Conc ${finite(dist.profitConcentrationPct)?dist.profitConcentrationPct.toFixed(0)+'%':'—'} | PosConc ${finite(c.maxPositionSharePct)?c.maxPositionSharePct.toFixed(0)+'%':'—'} | ${failureText(x)}`;
}
function evidenceRank(x){
 const d=x.diagnostics||{};
 const q=x.quality||{};
 const p=x.performance||{};
 return (d.entryWindow>0?100000000:0)+(d.matched>0?10000000:0)+(d.livePositions>0?1000000:0)+q.score*1000+Math.min(999,p.closedTrades)+(finite(p.wr)?p.wr:0);
}
async function telegram(text){if(!TG_TOKEN||!TG_CHAT){console.log('[TELEGRAM] credentials missing');return}try{const crypto=await import('node:crypto');const hash=crypto.createHash('sha256').update(text.replace(/^🕒.*$/m,'<TIME>')).digest('hex');let old={};try{old=JSON.parse(await fs.readFile(TG_STATE,'utf8'))}catch{}if(old.hash===hash&&Date.now()-num(old.sentAt)<10*60000)return;for(let i=0;i<text.length;i+=3800)await json(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:TG_CHAT,text:text.slice(i,i+3800),disable_web_page_preview:true})},'telegram');await fs.mkdir(path.dirname(TG_STATE),{recursive:true});await fs.writeFile(TG_STATE,JSON.stringify({hash,sentAt:Date.now()}))}catch(e){console.error('[TELEGRAM]',e.message)}}

async function mapLimit(items,limit,fn){
  const out=new Array(items.length);let cursor=0;
  async function worker(){
    while(true){const i=cursor++;if(i>=items.length)return;try{out[i]=await fn(items[i],i)}catch(e){out[i]={__error:e,__item:items[i]}}}
  }
  await Promise.all(Array.from({length:Math.min(limit,items.length)},()=>worker()));
  return out;
}

async function main(){
 const started=Date.now();const start=Date.now()-LOOKBACK_HOURS*3600000,end=Date.now();
 console.log(`${VERSION} | READ-ONLY | NO ORDERS`);
 const lb=await fetchLeaderboard();
 // Preserve the working discovery contract: actual numeric trader IDs, not the source-name string.
 const ranked=lb.rows.map(r=>{const a=String(r?.ethAddress||r?.address||r?.user||'');const m=leaderboardMetrics(r);return {...r,address:a,name:String(r?.displayName||r?.name||r?.username||''),lb:m}}).filter(r=>/^0x[a-fA-F0-9]{40}$/.test(r.address)).sort((a,b)=>(b.lb.day.vlm*0.000002+b.lb.week.vlm*0.0000005+Math.max(0,b.lb.day.pnl)*0.002)-(a.lb.day.vlm*0.000002+a.lb.week.vlm*0.0000005+Math.max(0,a.lb.day.pnl)*0.002)).slice(0,AUDIT_LIMIT);
 console.log(`[DISCOVERY] leaderboardRows=${lb.rows.length} validTraderIds=${lb.traders.length} audit=${ranked.length}`);
 const midsMap=await mids();const audited=[];let errors=0;const errorBreakdown={};
 const activityPool=ranked.slice(0,ACTIVE_AUDIT_LIMIT);
 console.log(`[AUDIT] activity-first candidates=${activityPool.length} concurrency=${MAX_CONCURRENCY} minGap=${MIN_REQUEST_GAP_MS}ms global429Cooldown=${GLOBAL_429_COOLDOWN_MS}ms`);
 const results=await mapLimit(activityPool,MAX_CONCURRENCY,(c)=>auditTrader(c,start,end,midsMap));
 for(const r of results){if(r?.__error){errors++;const k=classifyError(r.__error);errorBreakdown[k]=(errorBreakdown[k]||0)+1;console.log(`[AUDIT][ERROR] ${short(r.__item.address)} | ${k} | ${String(r.__error?.message||r.__error).slice(0,180)}`)}else if(r)audited.push(r)}
 const complete=audited.filter(x=>x.performance.closedTrades>0);
 const eligible=audited.filter(x=>x.diagnostics?.qualityPass);
 const liveMatched=audited.filter(x=>(x.diagnostics?.matched||0)>0);
 const entryCandidates=audited.filter(x=>(x.diagnostics?.entryWindow||0)>0);
 const nearMiss=sortCandidates(audited.filter(x=>(x.diagnostics?.entryWindow||0)>0&&!x.diagnostics?.qualityPass)).sort((a,b)=>evidenceRank(b)-evidenceRank(a));
 const evidenceTop=sortCandidates(audited.filter(x=>(x.diagnostics?.matched||0)>0)).sort((a,b)=>evidenceRank(b)-evidenceRank(a));

 const watch=sortCandidates(eligible).slice(0,TOP_WATCH);const signals=watch.map(x=>x.currentSignal).filter(Boolean).sort((a,b)=>b.trader.quality.score-a.trader.quality.score).slice(0,MAX_SIGNALS);
 const used=new Set(signals.map(s=>s.trader.address));
 const report=[];
 report.push('🌐 GLOBAL FUTURES PRO HUNTER',`🧠 ${VERSION}`,`🔧 ${BUILD}`,'📡 READ-ONLY | NO ORDERS | NO AUTO-COPY | FUTURES ONLY','━━━━━━━━━━━━━━━━━━');
 const diagRows=audited.map(x=>x.diagnostics||{});const dsum=k=>diagRows.reduce((a,x)=>a+num(x[k]),0);const qsum=k=>diagRows.reduce((a,x)=>a+num(x.quality?.[k]?1:0),0);const errText=Object.entries(errorBreakdown).map(([k,v])=>`${k}=${v}`).join(' | ')||'none';
 report.push(`🔎 Leaderboard: ${lb.rows.length} | Valid trader IDs: ${lb.traders.length} | Activity candidates: ${activityPool.length} | Audited: ${audited.length} | Complete: ${complete.length} | Errors: ${errors}`,
 `🧪 AUDIT PIPELINE: fresh≤${DIAG_WINDOW_MIN}m=${dsum('fresh15')} | history-fills=${dsum('fills')} | pos-increase=${dsum('increasing')} | live-match=${dsum('matched')} | entry-window=${dsum('entryWindow')} | quality-pass=${diagRows.filter(x=>x.qualityPass).length}`,
 `🔬 DECISION DIAG: missing-mid=${dsum('missingMid')} | invalid-entry=${dsum('invalidEntry')} | >watch=${dsum('watchDistanceFail')} | >entry=${dsum('entryDistanceFail')} | RR-fail=${dsum('rrFail')}`,
 `🧬 QUALITY DIAG: trades<${MIN_TRADES}=${qsum('tradesFail')} | WR<${MIN_WR}%=${qsum('wrFail')} | PF-unavailable=${qsum('pfUnavailable')} | PF<${MIN_PF}=${qsum('pfFail')} | DD>${MAX_DD}%=${qsum('ddFail')} | anomaly=${qsum('anomaly')}`, `🧪 FORENSICS: near-miss=${nearMiss.length} | anomalies=${audited.filter(x=>x.quality?.anomaly).length} | evidence-live=${evidenceTop.length}`,
 `📊 EVIDENCE DEPTH: live-position traders=${audited.filter(x=>(x.diagnostics?.livePositions||0)>0).length} | live-match traders=${liveMatched.length} | entry-ready traders=${entryCandidates.length} | quality-pass traders=${eligible.length}`,
 `🧯 ERROR BREAKDOWN: ${errText}`,`🎯 Quality eligible: ${eligible.length} | Watchlist: ${watch.length} | Actionable signals: ${signals.length}/${MAX_SIGNALS}`,`🧾 TRADE RECON: actual closed lifecycles | partial fills aggregated | PF/WR anomaly guard ON`,`🛡 CURRENT POSITION: Hyperliquid clearinghouseState ONLY | stale fills cannot create a position`,`⚡ SIGNAL: fresh open activity ≤${FRESH_MIN}m | entry distance ≤${ENTRY_MAX}% | SL ${SL_PCT}% | TP ${TP_R}R | RR ≥${MIN_RR}`,'');
 report.push('📡 SOURCE STATUS',`HYPERLIQUID: OK | FULL_SIGNAL | discovered=${lb.traders.length} | audited=${audited.length}`,'');
 report.push('🔬 QUALITY EVIDENCE MATRIX');
 evidenceTop.slice(0,10).forEach((x,i)=>report.push(`${i+1}. ${evidenceLine(x)}`));
 if(!evidenceTop.length)report.push('No trader reached live-position matching for evidence ranking.');
 report.push('','🎯 NEAR-MISS — LIVE POSITION + ENTRY PASSED, QUALITY FAILED');
 nearMiss.slice(0,10).forEach((x,i)=>{const p=x.performance,q=x.quality,d=x.diagnostics;report.push(`${i+1}. ${short(x.address)} | Score ${q.score.toFixed(1)} | Trades ${p.closedTrades} | WR ${finite(p.wr)?p.wr.toFixed(1)+'%':'—'} | PF ${p.pf===null?'—':p.pf.toFixed(2)} | DD ${pct(q.ddPct,1)} | FAIL ${failureText(x)} | live=${d.livePositions||0} match=${d.matched||0} entry=${d.entryWindow||0}`)});
 if(!nearMiss.length)report.push('No live-position + entry-window near-miss this cycle.');
 report.push('','🧬 PERFORMANCE FORENSICS — NEAR-MISS');
 nearMiss.slice(0,10).forEach((x,i)=>{const p=x.performance||{},d=p.distribution||{},r=p.recent24||{},r7=p.recent7||{},c=x.copyability||{};report.push(`${i+1}. ${short(x.address)} | ${x.quality.tier} ${x.quality.score.toFixed(1)} | ${failureText(x)}`,
 `   All ${p.closedTrades}T WR ${finite(p.wr)?p.wr.toFixed(1)+'%':'—'} PF ${p.pf===null?'—':p.pf.toFixed(2)} PnL ${usd(p.realizedPnl)} | 24H ${r.trades}T/${finite(r.wr)?r.wr.toFixed(1)+'%':'—'}/${r.pf===null?'—':finite(r.pf)?r.pf.toFixed(2):'—'} ${usd(r.pnl)} | 7D ${r7.trades}T/${finite(r7.wr)?r7.wr.toFixed(1)+'%':'—'}/${r7.pf===null?'—':finite(r7.pf)?r7.pf.toFixed(2):'—'}`,
 `   Avg W/L ${usd(d.avgWin,0)}/${usd(d.avgLoss,0)} | Med W/L ${usd(d.medianWin,0)}/${usd(d.medianLoss,0)} | Max W/L ${usd(d.largestWin,0)}/${usd(d.largestLoss,0)}`,
 `   Profit concentration top-win=${pct(d.profitConcentrationPct,1)} top3=${pct(d.top3ProfitConcentrationPct,1)} | Streak W/L ${p.longestWinStreak||0}/${p.longestLossStreak||0} | Recovery ${finite(p.recoveryFactor)?p.recoveryFactor.toFixed(2):'—'}`,
 `   Copyability live=${c.livePositions||0} notional=${usd(c.liveNotional)} maxPos=${pct(c.maxPositionSharePct,1)} maxCoin=${pct(c.maxCoinSharePct,1)} lev=${finite(c.avgLeverage)?c.avgLeverage.toFixed(1)+'x':'—'}/${finite(c.maxLeverage)?c.maxLeverage.toFixed(1)+'x':'—'} age=${finite(c.avgPositionAgeHours)?c.avgPositionAgeHours.toFixed(1)+'h':'—'}`);});
 if(!nearMiss.length)report.push('No near-miss performance forensic sample this cycle.');
 report.push('','🚨 ANOMALY FORENSICS');
 const anomalies=audited.filter(x=>x.quality?.anomaly);
 anomalies.slice(0,5).forEach((x,i)=>{const p=x.performance,d=p.distribution||{};report.push(`${i+1}. ${short(x.address)} | PF ${p.pf===null?'—':p.pf.toFixed(2)} | WR ${finite(p.wr)?p.wr.toFixed(1)+'%':'—'} | ${p.closedTrades}T | top-win concentration=${pct(d.profitConcentrationPct,1)} | top3=${pct(d.top3ProfitConcentrationPct,1)} | largestW/L=${usd(d.largestWin,0)}/${usd(d.largestLoss,0)} | reason=${anomalyReason(x)}`);});
 if(!anomalies.length)report.push('No statistical anomaly flagged this cycle.');
 report.push('','👑 TOP VERIFIED TRADERS');
 watch.slice(0,TOP_WATCH).forEach((x,i)=>report.push(`${i+1}. ${fmtTrader(x)} | ${x.currentSignal?'POSITION READY':'BLOCK '+x.blockReason}`));
 if(!watch.length)report.push('No trader passed the minimum evidence gate this cycle.');
 report.push('','🔥 ACTIONABLE NOW');
 if(signals.length){signals.forEach((s,i)=>report.push(...signalLine(s,i+1),'━━━━━━━━━━━━━━━━━━'))}else report.push('No verified trader has a fresh copyable-quality current position this cycle.');
 report.push('','🧱 TOP BLOCK REASONS');
 sortCandidates(audited.filter(x=>!used.has(x.address))).slice(0,10).forEach(x=>{const d=x.diagnostics||{};report.push(`${short(x.address)} | ${x.quality.tier} ${x.quality.score.toFixed(1)} | ${x.blockReason||x.quality.reasons.join(' | ')||'NOT_SIGNAL_READY'} | fresh=${d.fresh15||0} match=${d.matched||0}`)});
 report.push('','🛡️ V2.1.9 CONTRACTS',`• Discovery returns real Hyperliquid trader IDs and reports numeric discovered count.`,`• Performance unit = actual closed lifecycle; no synthetic trades.`,`• PF unavailable is shown as — and never becomes LOW_PF.`,`• Current position = clearinghouseState; position side/entry must exist now.`,`• Signal requires fresh open activity + live position + entry distance + RR.`,`• Null metrics are rendered as — and never passed to toFixed().`,`• Multiple independent traders/signals may be emitted; MAX_SIGNALS=${MAX_SIGNALS}.`,`• Audit is activity-first: fresh probe → history only for active traders → state only after fresh activity.`,`• Decision diagnostics separate missing-mid, invalid-entry, watch/entry distance and RR failures; Entry validation uses the live position entry price with fill fallback.`,`• Quality diagnostics separate trade-count, WR, PF-unavailable, PF, PnL, DD and anomaly failures.`,`• Evidence matrix shows Trades/WR/PF/DD plus recent 24H performance, win/loss distribution, streaks and position concentration.`,
 `• Performance forensics compares the current audit window with 24H and 7D activity; no synthetic performance is created.`,
 `• Copyability forensics reports live notional, max position/coin concentration, leverage and reconstructed position age.`,
 `• Anomaly forensics explains PF/WR outliers and profit concentration instead of silently suppressing them.`,`• Near-miss analysis isolates traders that passed live-position + entry validation but failed historical quality.`,`• Live-position count, live-match count and entry-ready count are reported separately to expose pipeline attrition.`,`• No quality threshold is relaxed to manufacture actionable signals.`,
 `• Global 429 cooldown + bounded concurrency + minimum request gap protect the Hyperliquid API.`,`• HTTP 429/5xx/timeout requests use bounded exponential retry/backoff.`,`• Freshness is real fill time ≤${DIAG_WINDOW_MIN}m; no synthetic freshness is created.`,`⏱ Runtime: ${((Date.now()-started)/1000).toFixed(1)}s`,
 `⚙️ Rate safety: candidates=${activityPool.length} | concurrency=${MAX_CONCURRENCY} | gap=${MIN_REQUEST_GAP_MS}ms | 429 cooldown=${GLOBAL_429_COOLDOWN_MS}ms`,`🕒 ${new Date().toISOString()}`);
 const text=report.join('\n');console.log(text);await fs.mkdir(path.dirname(STATE_FILE),{recursive:true});await fs.writeFile(STATE_FILE,JSON.stringify({version:VERSION,build:BUILD,generatedAt:Date.now(),discovered:lb.traders.length,audited:audited.length,eligible:eligible.length,signals:signals.map(s=>({address:s.trader.address,coin:s.coin,side:s.side,entry:s.entry,mark:s.mark,sl:s.sl,tp:s.tp,rr:s.rr,ageMin:s.ageMin})),watch:watch.map(x=>({address:x.address,name:x.name,score:x.quality.score,tier:x.quality.tier,blockReason:x.blockReason,performance:x.performance,quality:x.quality,positions:x.positions,copyability:x.copyability,diagnostics:x.diagnostics})),evidenceTop:evidenceTop.slice(0,20).map(x=>({address:x.address,name:x.name,score:x.quality.score,tier:x.quality.tier,performance:x.performance,quality:x.quality,positions:x.positions,copyability:x.copyability,diagnostics:x.diagnostics,blockReason:x.blockReason})),nearMiss:nearMiss.slice(0,20).map(x=>({address:x.address,name:x.name,performance:x.performance,quality:x.quality,positions:x.positions,copyability:x.copyability,diagnostics:x.diagnostics,blockReason:x.blockReason})),errors,errorBreakdown,pipeline:{fills:dsum('fills'),fresh15:dsum('fresh15'),increasing:dsum('increasing'),livePositions:dsum('livePositions'),matched:dsum('matched'),entryWindow:dsum('entryWindow'),qualityPass:diagRows.filter(x=>x.qualityPass).length}},null,2));await telegram(text);
}
main().catch(async e=>{console.error(`[GFTSH][FATAL] ${e.stack||e}`);await telegram(`🌐 GLOBAL FUTURES PRO HUNTER\n🧠 ${VERSION}\n💥 FATAL: ${String(e?.message||e).slice(0,1000)}`);process.exitCode=1});
