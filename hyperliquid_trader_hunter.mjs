// Hyperliquid Trader Hunter V5.12 - READ ONLY
const API_URL = process.env.HYPERLIQUID_API_URL || 'https://api.hyperliquid.xyz/info';
const DISCOVERY_URL = process.env.HYPERLIQUID_HUNTER_DISCOVERY_URL || 'https://stats-data.hyperliquid.xyz/Mainnet/leaderboard';
const DISCOVERY_ENABLED = String(process.env.HYPERLIQUID_HUNTER_DISCOVERY_ENABLED ?? 'true').toLowerCase() === 'true';
const RAW_LOOKBACK_DAYS = num('HYPERLIQUID_HUNTER_LOOKBACK_DAYS', 7);
const LOOKBACK_DAYS = RAW_LOOKBACK_DAYS > 0 ? RAW_LOOKBACK_DAYS : 7;
const MAX_CANDIDATES = 100;
const FINALISTS = Math.min(5, Math.max(1, integer('HYPERLIQUID_HUNTER_FINALISTS', 5)));
const AUTO_SELECT = Math.min(1, Math.max(1, integer('HYPERLIQUID_HUNTER_AUTO_SELECT', 1)));
const MIN_TRADES = Math.max(30, integer('HYPERLIQUID_HUNTER_MIN_7D_TRADES', 30));
const MIN_WR = (() => { const x=Number(process.env.HYPERLIQUID_HUNTER_MIN_7D_WIN_RATE); return Number.isFinite(x) ? Math.max(65, Math.min(100,x)) : 65; })();
const MIN_PNL = num('HYPERLIQUID_HUNTER_MIN_7D_PNL', 0);
const MIN_PF = (() => { const x=Number(process.env.HYPERLIQUID_HUNTER_MIN_PROFIT_FACTOR); return Number.isFinite(x) ? Math.max(1.5, x) : 1.5; })();
const MAX_MEDIAN_HOLD = (() => { const x=Number(process.env.HYPERLIQUID_HUNTER_MAX_MEDIAN_HOLD_HOURS); return Number.isFinite(x) && x > 0 ? Math.min(6,x) : 6; })();
const MAX_AVG_HOLD = (() => { const x=Number(process.env.HYPERLIQUID_HUNTER_MAX_AVG_HOLD_HOURS); return Number.isFinite(x) && x > 0 ? Math.min(12,x) : 12; })();
const MIN_ACTIVE_DAYS = (() => { const x=Number(process.env.HYPERLIQUID_HUNTER_MIN_ACTIVE_DAYS); return Number.isFinite(x) && x > 0 ? Math.min(3, Math.floor(x)) : 3; })();
const MAX_LOSING_STREAK = integer('HYPERLIQUID_HUNTER_MAX_LOSING_STREAK', 8);
const MAX_LIQ = integer('HYPERLIQUID_HUNTER_MAX_LIQUIDATIONS', 1);
const MIN_RR = num('HYPERLIQUID_HUNTER_MIN_SETUP_RR', 1.5);
const MAX_ENTRY_DIST = (() => { const x = Number(process.env.HYPERLIQUID_HUNTER_MAX_ENTRY_DISTANCE_PCT); return Number.isFinite(x) && x > 0 ? Math.min(0.5, x) : 0.5; })();
const SL_ATR = num('HYPERLIQUID_HUNTER_SL_ATR_MULT', 1.2);
const TP_ATR = num('HYPERLIQUID_HUNTER_TP_ATR_MULT', 2.0);
const MAX_HOLD = num('HYPERLIQUID_HUNTER_MAX_PLANNED_HOLD_HOURS', 12);
const RETRIES = integer('HYPERLIQUID_HUNTER_API_RETRIES', 4);
const BASE_DELAY = integer('HYPERLIQUID_HUNTER_API_BASE_DELAY_MS', 700);
const BETWEEN = Math.max(1000, integer('HYPERLIQUID_HUNTER_BETWEEN_TRADERS_MS', 1000));
const BETWEEN_PAGES = Math.max(500, integer('HYPERLIQUID_HUNTER_BETWEEN_PAGES_MS', 500));
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
function short(x){return `${x.slice(0,8)}…${x.slice(-6)}`}
function fmt(x,d=2){return Number.isFinite(Number(x))?Number(x).toFixed(d):'n/a'}
function pct(x,d=1){return Number.isFinite(Number(x))?`${Number(x).toFixed(d)}%`:'n/a'}
function median(a){if(!a.length)return NaN;const s=[...a].sort((a,b)=>a-b),m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2}
function quantile(a,q){if(!a.length)return NaN;const s=[...a].sort((a,b)=>a-b),p=(s.length-1)*q,l=Math.floor(p),h=Math.ceil(p);return l===h?s[l]:s[l]+(s[h]-s[l])*(p-l)}
function category(e){const s=String(e?.message||e||'');if(/HTTP 429/i.test(s))return'HTTP_429';if(/HTTP 5\d\d/i.test(s))return'HTTP_5XX';if(/timeout/i.test(s))return'TIMEOUT';if(/fetch|network|ECONN|socket|ENOTFOUND/i.test(s))return'NETWORK';if(/JSON/i.test(s))return'BAD_JSON';if(/fills/i.test(s))return'FILLS';return'OTHER'}

let GLOBAL_COOLDOWN_UNTIL=0;
async function fetchJson(url, options={}, label='request'){
  let last;
  if(Date.now()<GLOBAL_COOLDOWN_UNTIL) await sleep(GLOBAL_COOLDOWN_UNTIL-Date.now());
  for(let attempt=0;attempt<=RETRIES;attempt++){
    const c=new AbortController(), t=setTimeout(()=>c.abort(),TIMEOUT);
    try{
      const r=await fetch(url,{...options,signal:c.signal});
      clearTimeout(t);
      if(r.ok){const text=await r.text();try{return JSON.parse(text)}catch{throw new Error(`${label}: invalid JSON`)}}
      const body=(await r.text()).slice(0,240); const e=new Error(`${label}: HTTP ${r.status} ${body}`);e.status=r.status;e.retryAfterMs=Number(r.headers.get('retry-after')||0)*1000;throw e;
    }catch(e){clearTimeout(t);last=e?.name==='AbortError'?new Error(`${label}: timeout`):e;const s=Number(last?.status||0);if(!([429,...Array.from({length:100},(_,i)=>500+i)].includes(s)||!s)||attempt>=RETRIES)break;const retryAfter=Number(last?.retryAfterMs||0);const backoff=BASE_DELAY*(2**attempt)+Math.floor(Math.random()*250);const wait=Math.max(backoff,retryAfter,1500);if(s===429)GLOBAL_COOLDOWN_UNTIL=Math.max(GLOBAL_COOLDOWN_UNTIL,Date.now()+wait);console.log(`[RETRY] ${label} ${attempt+1}/${RETRIES} wait=${wait}ms ${category(last)}${retryAfter>0?' retry-after='+retryAfter+'ms':''}`);await sleep(wait)}
  }
  throw last||new Error(`${label}: failed`)
}
async function info(payload,label=payload.type){return fetchJson(API_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)},label)}

function leaderboardMetrics(row){
  const wp=Array.isArray(row?.windowPerformances)?row.windowPerformances:[];
  const m=Object.fromEntries(wp.filter(Array.isArray).map(x=>[x[0],x[1]]));
  const d=m.day||{},w=m.week||{};
  return {
    pnl:Number(w.pnl??d.pnl??0),
    vol:Number(w.vlm??d.vlm??0),
    roi:Number(w.roi??d.roi??0),
    dayPnl:Number(d.pnl??0),
    dayVol:Number(d.vlm??0),
    dayRoi:Number(d.roi??0)
  };
}
function hunterDiscoveryScore(row){
  const m=leaderboardMetrics(row);
  const roi=Math.max(-100,Math.min(100,Number(m.roi)||0));
  const pnl=Math.max(-1e12,Math.min(1e12,Number(m.pnl)||0));
  const vol=Math.max(0,Number(m.vol)||0);
  const dayRoi=Math.max(-100,Math.min(100,Number(m.dayRoi)||0));
  const dayPnl=Number(m.dayPnl)||0;
  const dayVol=Math.max(0,Number(m.dayVol)||0);
  const consistency=(roi>0?1:0)+(dayRoi>0?1:0)+(pnl>0?1:0)+(dayPnl>0?1:0);
  return {
    roi,pnl,vol,dayRoi,dayPnl,dayVol,consistency,
    raw:Math.max(0,roi)*5 + Math.max(0,dayRoi)*2 + Math.log1p(Math.max(0,pnl))*1.5 + Math.log1p(Math.max(0,dayPnl))*0.75 + Math.log1p(vol)*0.5 + consistency*2
  };
}
function discoveryRank(rows){
  const items=rows.map(row=>({row,score:hunterDiscoveryScore(row)}));
  const rank=(key,desc=true)=>{
    const sorted=[...items].sort((a,b)=>desc?b.score[key]-a.score[key]:a.score[key]-b.score[key]);
    const out=new Map();sorted.forEach((x,i)=>out.set(x.row,sorted.length-i));return out;
  };
  const ranks={roi:rank('roi'),pnl:rank('pnl'),vol:rank('vol'),dayRoi:rank('dayRoi'),dayPnl:rank('dayPnl'),consistency:rank('consistency')};
  for(const x of items){
    const n=items.length||1;
    x.rankScore=(ranks.roi.get(x.row)/n)*35+(ranks.pnl.get(x.row)/n)*20+(ranks.vol.get(x.row)/n)*10+(ranks.dayRoi.get(x.row)/n)*15+(ranks.dayPnl.get(x.row)/n)*5+(ranks.consistency.get(x.row)/n)*15;
  }
  return items.sort((a,b)=>b.rankScore-a.rankScore).map(x=>x.row);
}
async function discover(){
  const map=new Map();for(const a of [...SEEDS,...MANUAL])if(addr(a))map.set(norm(a),{ethAddress:norm(a)});
  if(!DISCOVERY_ENABLED)return{discovered:map.size,candidates:[...map.keys()].slice(0,MAX_CANDIDATES),source:'manual_only'};
  const data=await fetchJson(DISCOVERY_URL,{},'leaderboard discovery');
  const rows=Array.isArray(data?.leaderboardRows)?data.leaderboardRows:[];
  const valid=[];for(const row of rows){if(addr(row?.ethAddress)){const a=norm(row.ethAddress);map.set(a,row);valid.push(a)}}
  const ranked=discoveryRank([...map.values()].filter(r=>leaderboardMetrics(r).vol>0));
  const candidates=ranked.map(r=>norm(r.ethAddress)).slice(0,MAX_CANDIDATES);
  const fallback=discoveryRank([...map.values()]).map(r=>norm(r.ethAddress)).slice(0,MAX_CANDIDATES);
  const finalCandidates=candidates.length>=MAX_CANDIDATES?candidates:[...new Set([...candidates,...fallback])].slice(0,MAX_CANDIDATES);
  return{discovered:new Set(valid).size,candidates:finalCandidates,source:'leaderboardRows.ethAddress:hunter_ranked'};
}
function fillKey(f){return [f?.tid??'',f?.hash??'',f?.time??'',f?.coin??'',f?.px??'',f?.sz??'',f?.side??''].join('|')}
async function getFills(user,start,end){
  let cursor=start,pages=0;const map=new Map();let newest=0;
  while(pages<MAX_PAGES){pages++;const b=await info({type:'userFillsByTime',user,startTime:cursor,endTime:end,aggregateByTime:false},`fills ${short(user)} page=${pages}`);if(!Array.isArray(b))throw new Error('fills: unexpected response');for(const f of b){if(f?.time)map.set(fillKey(f),f);newest=Math.max(newest,Number(f?.time||0))}if(b.length===0||b.length<2000)break;const max=Math.max(...b.map(f=>Number(f?.time||0)));if(!max||max>=end)break;const next=Math.max(cursor+1,max);if(next<=cursor)break;cursor=next;await sleep(BETWEEN_PAGES)}
  const fills=[...map.values()].sort((a,b)=>Number(a.time)-Number(b.time));return{fills,pages,truncated:pages>=MAX_PAGES||fills.length>=10000,newest};
}
function delta(f){const sz=Math.abs(Number(f?.sz||0));return String(f?.side||'').toUpperCase()==='B'?sz:-sz}
function reconstruct(fills){
  const states=new Map(),trades=[];let liquidations=0;
  const closePnl=(f,used)=>{const cp=Number(f.closedPnl),fq=Math.abs(Number(f.sz||0));return Number.isFinite(cp)&&fq>0?cp*(used/fq):NaN};
  const emit=(st,f,qty,px,pnl)=>{const closeTime=Number(f.time),holdHours=Math.max(0,(closeTime-st.openTime)/3600000);trades.push({coin:st.coin,side:st.side,qty,entryPx:st.avgEntry,exitPx:px,openTime:st.openTime,closeTime,holdHours,pnl:Number.isFinite(pnl)?pnl:0})};
  for(const f of fills){
    const coin=String(f.coin||'');if(!coin)continue;
    const dir=String(f.dir||'').toLowerCase();if(dir.includes('liquid'))liquidations++;
    const d=delta(f);if(!d)continue;
    const px=Number(f.px),time=Number(f.time),start=Number(f.startPosition||0),end=start+d;
    let st=states.get(coin)||null;
    if(!st && Math.abs(start)>1e-12){ st={coin,side:start>0?'long':'short',qty:Math.abs(start),avgEntry:px,openTime:time,realizedPnl:0};states.set(coin,st); }
    if(!st){
      st={coin,side:d>0?'long':'short',qty:Math.abs(d),avgEntry:px,openTime:time,realizedPnl:0};states.set(coin,st);
      continue;
    }
    const sameDir=(st.side==='long'&&d>0)||(st.side==='short'&&d<0);
    if(sameDir){
      const add=Math.abs(d),oldQty=st.qty;st.avgEntry=((st.avgEntry*oldQty)+(px*add))/(oldQty+add);st.qty+=add;continue;
    }
    const closeQty=Math.min(st.qty,Math.abs(d));
    const cp=closePnl(f,closeQty);
    const pnl=Number.isFinite(cp)?cp:(st.side==='long'?(px-st.avgEntry)*closeQty:(st.avgEntry-px)*closeQty);
    st.realizedPnl+=pnl;st.qty-=closeQty;
    const remaining=Math.abs(d)-closeQty;
    if(st.qty<=1e-12){
      if(remaining<=1e-12) emit(st,f,closeQty,px,st.realizedPnl);
      states.delete(coin);
      if(remaining>1e-12){states.set(coin,{coin,side:d>0?'long':'short',qty:remaining,avgEntry:px,openTime:time,realizedPnl:0});}
    }
  }
  return{trades,liquidations};
}
function metrics(fills,r){const ts=r.trades,w=ts.filter(t=>t.pnl>0),l=ts.filter(t=>t.pnl<0),holds=ts.map(t=>t.holdHours).filter(Number.isFinite),gw=w.reduce((s,t)=>s+t.pnl,0),gl=Math.abs(l.reduce((s,t)=>s+t.pnl,0)),pnl=ts.reduce((s,t)=>s+t.pnl,0),days=new Set(ts.map(t=>new Date(t.closeTime).toISOString().slice(0,10)));let st=0,maxst=0;for(const t of [...ts].sort((a,b)=>a.closeTime-b.closeTime)){if(t.pnl<0){st++;maxst=Math.max(maxst,st)}else if(t.pnl>0)st=0}return{fills:fills.length,closedTrades:ts.length,winRate:ts.length?w.length/ts.length*100:0,pnl,grossWin:gw,grossLossAbs:gl,profitFactor:gl>0?gw/gl:(gw>0?Infinity:0),medianHoldHours:median(holds),avgHoldHours:holds.length?holds.reduce((a,b)=>a+b,0)/holds.length:NaN,p25HoldHours:quantile(holds,.25),p75HoldHours:quantile(holds,.75),activeDays:days.size,maxLosingStreak:maxst,liquidations:r.liquidations}}
function gates(m,meta={}){const a=[];if(m.closedTrades<MIN_TRADES)a.push(`TRADES<${MIN_TRADES}`);if(m.winRate<MIN_WR)a.push(`WR<${MIN_WR}%`);if(m.closedTrades>0&&!(m.profitFactor>=MIN_PF))a.push(`PF<${MIN_PF}`);if(m.closedTrades>=MIN_TRADES&&Number.isFinite(m.medianHoldHours)&&m.medianHoldHours>MAX_MEDIAN_HOLD)a.push(`MEDIAN_HOLD>${MAX_MEDIAN_HOLD}h`);if(m.closedTrades>=MIN_TRADES&&Number.isFinite(m.avgHoldHours)&&m.avgHoldHours>MAX_AVG_HOLD)a.push(`AVG_HOLD>${MAX_AVG_HOLD}h`);if(m.activeDays<MIN_ACTIVE_DAYS)a.push(`ACTIVE_DAYS<${MIN_ACTIVE_DAYS}`);if(m.maxLosingStreak>MAX_LOSING_STREAK)a.push(`LOSING_STREAK>${MAX_LOSING_STREAK}`);if(m.liquidations>MAX_LIQ)a.push(`LIQUIDATIONS>${MAX_LIQ}`);if(meta.truncated)a.push('HISTORY_TRUNCATED');return{ok:!a.length,reasons:a}}
async function position(user){const s=await info({type:'clearinghouseState',user},`position ${short(user)}`);return(Array.isArray(s?.assetPositions)?s.assetPositions:[]).map(x=>x?.position).filter(Boolean).filter(p=>Math.abs(Number(p.szi||0))>0).sort((a,b)=>Math.abs(Number(b.szi||0))-Math.abs(Number(a.szi||0)))[0]||null}
async function book(coin){const b=await info({type:'l2Book',coin},`book ${coin}`),lv=Array.isArray(b?.levels)?b.levels:[],bid=Number(lv?.[0]?.[0]?.px),ask=Number(lv?.[1]?.[0]?.px);if(!Number.isFinite(bid)||!Number.isFinite(ask))throw new Error(`book ${coin}: no bid/ask`);return{bid,ask,mid:(bid+ask)/2}}
async function atr(coin,end){const c=await info({type:'candleSnapshot',req:{coin,interval:'1h',startTime:end-72*3600000,endTime:end}},`candles ${coin}`);const r=(Array.isArray(c)?c:[]).map(x=>Number(x.h)-Number(x.l)).filter(x=>x>0&&Number.isFinite(x));if(r.length<5)throw new Error(`candles ${coin}: insufficient 1h data`);return r.reduce((a,b)=>a+b,0)/r.length}
function plan(pos,m,atrv){const s=Number(pos?.szi||0),source=Number(pos?.entryPx||0),side=s>0?'LONG':'SHORT',dist=source>0?Math.abs(m.mid-source)/source*100:Infinity;if(dist>MAX_ENTRY_DIST)return{eligible:false,reason:`ENTRY_DISTANCE>${MAX_ENTRY_DIST}%`,side,sourceEntry:source,entry:m.mid,distancePct:dist};const sl=side==='LONG'?m.mid-SL_ATR*atrv:m.mid+SL_ATR*atrv,tp=side==='LONG'?m.mid+TP_ATR*atrv:m.mid-TP_ATR*atrv,risk=Math.abs(m.mid-sl),reward=Math.abs(tp-m.mid),rr=risk?reward/risk:0;if(rr<MIN_RR)return{eligible:false,reason:`RR<${MIN_RR}`,side,sourceEntry:source,entry:m.mid,distancePct:dist,sl,tp,rr};return{eligible:true,side,sourceEntry:source,entry:m.mid,distancePct:dist,sl,tp,rr,atr:atrv,maxHoldHours:MAX_HOLD}}
async function telegram(text){if(!TG_TOKEN||!TG_CHAT){console.log('[TELEGRAM] missing credentials');return}for(let i=0;i<text.length;i+=TG_LIMIT){try{await fetchJson(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:TG_CHAT,text:text.slice(i,i+TG_LIMIT),disable_web_page_preview:true})},'telegram')}catch(e){console.error(`[TELEGRAM][ERROR] ${e.message}`)}}}
function errSummary(es){const m={};for(const e of es)m[e.cat]=(m[e.cat]||0)+1;return Object.entries(m).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k}:${v}`).join(' | ')||'none'}

function statisticalScore(m){
  const wr=Math.max(0,Math.min(100,Number(m.winRate)||0));
  const pf=Math.max(0,Math.min(4,Number(m.profitFactor)||0))/4*100;
  const hold=Number(m.medianHoldHours);
  const holdScore=Number.isFinite(hold)?Math.max(0,100-Math.min(hold,12)/12*100):0;
  const active=Math.max(0,Math.min(7,Number(m.activeDays)||0))/7*100;
  const pnl=Math.max(0,Math.min(2,Math.log10(1+Math.max(0,Number(m.pnl)||0))))/2*100;
  const streak=Math.max(0,100-(Math.max(0,Number(m.maxLosingStreak)||0)/Math.max(1,MAX_LOSING_STREAK))*100);
  return wr*0.30+pf*0.25+holdScore*0.15+active*0.10+pnl*0.10+streak*0.10;
}
function finalScore(x){
  const m=x.metrics,p=x.plan;
  const strength=Math.max(0,Math.min(100,statisticalScore(m)));
  const dist=Number(p?.distancePct);
  const distanceScore=Number.isFinite(dist)?Math.max(0,100-(dist/Math.max(MAX_ENTRY_DIST,0.0001))*100):0;
  const rrScore=Number.isFinite(Number(p?.rr))?Math.max(0,Math.min(100,(Number(p.rr)/Math.max(MIN_RR,0.01))*100)):0;
  const hold=Number(m.medianHoldHours);
  const holdScore=Number.isFinite(hold)?Math.max(0,100-(hold/Math.max(MAX_MEDIAN_HOLD,0.01))*100):0;
  return strength*0.50+distanceScore*0.30+rrScore*0.10+holdScore*0.10;
}

async function main(){
 console.log(`[HUNTER V5.12][START] ${JSON.stringify({rawLookbackDays:RAW_LOOKBACK_DAYS,lookbackDays:LOOKBACK_DAYS,maxCandidates:MAX_CANDIDATES,finalists:FINALISTS,autoSelect:AUTO_SELECT,minTrades:MIN_TRADES,minWinRate:MIN_WR,minProfitFactor:MIN_PF,maxEntryDistancePct:MAX_ENTRY_DIST,maxMedianHoldHours:MAX_MEDIAN_HOLD,maxAvgHoldHours:MAX_AVG_HOLD,minActiveDays:MIN_ACTIVE_DAYS,maxLosingStreak:MAX_LOSING_STREAK,maxLiquidations:MAX_LIQ,betweenTradersMs:BETWEEN,betweenPagesMs:BETWEEN_PAGES,discoveryRanking:'hunter_ranked_v1',tradeModel:'position_lifecycle_v2',losingStreak:'closed_position_lifecycle',gateModel:'single_gate_plus_invariants',global429Cooldown:true,upgrade:'v5.11_plus_copy_plan_display'})}`);
 if(RAW_LOOKBACK_DAYS<=0)console.warn('[CONFIG][WARN] HYPERLIQUID_HUNTER_LOOKBACK_DAYS<=0; using safe default 7d');
 let d;try{d=await discover()}catch(e){console.error(`[DISCOVERY][ERROR] ${e.message}`);await telegram(`🟣 HYPERLIQUID TRADER HUNTER V5.12\n📡 READ-ONLY | NO ORDERS\n━━━━━━━━━━━━━━━━━━\n❌ DISCOVERY ERROR\n${e.message}`);process.exitCode=1;return}
 console.log(`[DISCOVERY] validLeaderboardAddresses=${d.discovered} prefilteredCandidates=${d.candidates.length} cap=${MAX_CANDIDATES} source=${d.source}`);
 const start=Date.now()-LOOKBACK_DAYS*86400000,now=Date.now(),scanned=[],errors=[],passed=[];
 for(let i=0;i<d.candidates.length;i++){
  const a=d.candidates[i];try{const f=await getFills(a,start,now),r=reconstruct(f.fills),m=metrics(f.fills,r),g=gates(m,f);const item={address:a,metrics:m,gate:g,truncated:f.truncated};scanned.push(item);let gateOk=g.ok;if(gateOk && !(m.closedTrades>=MIN_TRADES && m.winRate>=MIN_WR && m.profitFactor>=MIN_PF && m.activeDays>=MIN_ACTIVE_DAYS && m.maxLosingStreak<=MAX_LOSING_STREAK && m.liquidations<=MAX_LIQ && (!f.truncated) && (!Number.isFinite(m.medianHoldHours)||m.medianHoldHours<=MAX_MEDIAN_HOLD) && (!Number.isFinite(m.avgHoldHours)||m.avgHoldHours<=MAX_AVG_HOLD))){gateOk=false;g.reasons=[...g.reasons,'INTERNAL_GATE_INCONSISTENCY'];console.error(`[GATE][INVARIANT] ${short(a)} gate.ok=true but raw metrics violate hard gate: trades=${m.closedTrades} WR=${m.winRate} PF=${m.profitFactor} activeDays=${m.activeDays} streak=${m.maxLosingStreak} liq=${m.liquidations} truncated=${f.truncated}`)}if(gateOk){item.statScore=statisticalScore(m);passed.push(item)}console.log(`[SCAN] ${i+1}/${d.candidates.length} ${short(a)} fills=${m.fills} trades=${m.closedTrades} WR=${fmt(m.winRate,1)} PF=${fmt(m.profitFactor)} hold=${fmt(m.medianHoldHours,1)}h/${fmt(m.avgHoldHours,1)}h PASS=${gateOk?'YES':'NO'}${gateOk?'':' block='+g.reasons.slice(0,3).join(',')}${f.truncated?' HISTORY_TRUNCATED':''}`)}catch(e){const cat=category(e);errors.push({address:a,cat,message:String(e.message||e)});console.error(`[SCAN][ERROR] ${i+1}/${d.candidates.length} ${short(a)} ${cat} :: ${e.message}`)}if(i+1<d.candidates.length)await sleep(BETWEEN)}
 passed.sort((a,b)=>(b.statScore-a.statScore)||(b.metrics.profitFactor-a.metrics.profitFactor)||(b.metrics.winRate-a.metrics.winRate));
 const finalists=passed.slice(0,FINALISTS);const enriched=[];const enrichmentBlocks=[];
 for(const x of finalists){try{const p=await position(x.address);if(!p){x.enrichmentBlock='NO_OPEN_POSITION';enrichmentBlocks.push(x.enrichmentBlock);console.log(`[ENRICH] ${short(x.address)} NO_OPEN_POSITION`);continue}const coin=String(p.coin||'');console.log(`[ENRICH] ${short(x.address)} position side=${Number(p.szi||0)>0?'LONG':'SHORT'} coin=${coin} sourceEntry=${fmt(Number(p.entryPx||0),6)}`);const bk=await book(coin),av=await atr(coin,now),pl=plan(p,bk,av);x.plan=pl;pl.coin=coin;pl.bid=bk.bid;pl.ask=bk.ask;pl.mid=bk.mid;pl.traderAddress=x.address;x.finalScore=pl.eligible?finalScore(x):0;enriched.push(x);if(!pl.eligible)enrichmentBlocks.push(pl.reason);console.log(`[ENRICH] ${short(x.address)} dist=${fmt(pl.distancePct,3)}% rr=${fmt(pl.rr)} eligible=${pl.eligible?'YES':'NO'} score=${fmt(x.finalScore,1)}${pl.reason?' block='+pl.reason:''} atr=${fmt(pl.atr,6)} bid=${fmt(bk.bid,6)} ask=${fmt(bk.ask,6)} mid=${fmt(bk.mid,6)}`)}catch(e){x.enrichmentBlock=`${category(e)}:${e.message}`;enrichmentBlocks.push(x.enrichmentBlock);console.error(`[ENRICH][ERROR] ${short(x.address)} ${x.enrichmentBlock}`)}}
 if(selected[0]){const x=selected[0],p=x.plan,m=x.metrics;const autoLines=['','🤖 AUTO-COPY SELECTION','━━━━━━━━━━━━━━━━━━',`👤 Trader: ${x.address}`,`🔎 Tracker: https://app.hyperliquid.xyz/explorer/address/${x.address}`,`🪙 Symbol: ${p.coin}`,`📈 Direction: ${p.side}`,`🎯 Source entry: ${fmt(p.sourceEntry,6)}`,`💠 Diagnostic entry: ${fmt(p.entry,6)}`,`🛑 Diagnostic SL: ${fmt(p.sl,6)}`,`🎯 Diagnostic TP: ${fmt(p.tp,6)}`,`📐 RR: ${fmt(p.rr,2)} >= ${MIN_RR}`,`📍 Entry distance: ${pct(p.distancePct,2)} <= ${MAX_ENTRY_DIST}%`,`📊 WR=${pct(m.winRate)} | PF=${fmt(m.profitFactor)} | Trades=${m.closedTrades}`,`⏱ Median hold=${fmt(m.medianHoldHours,1)}h | Avg hold=${fmt(m.avgHoldHours,1)}h`,`💪 Strength score: ${fmt(x.statScore,1)}`,'🟢 Status: SELECTED FOR COPY PLAN','ℹ️ Diagnostic TP/SL only | Source TP/SL not copied'];lines.push(...autoLines);}else lines.push('','🤖 AUTO-COPY SELECTION','No eligible trader among the top finalists.');
 const blocks={};for(const x of scanned)for(const r of x.gate.reasons)blocks[r]=(blocks[r]||0)+1;const top=Object.entries(blocks).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([k,v])=>`${k}:${v}`).join(' | ')||'none';
 const has=(x,r)=>x.gate.reasons.includes(r);const funnel={scanned:scanned.length,trades:scanned.filter(x=>!has(x,`TRADES<${MIN_TRADES}`)).length,wr:scanned.filter(x=>!has(x,`TRADES<${MIN_TRADES}`)&&!has(x,`WR<${MIN_WR}%`)).length,pf:scanned.filter(x=>!has(x,`TRADES<${MIN_TRADES}`)&&!has(x,`WR<${MIN_WR}%`)&&!has(x,`PF<${MIN_PF}`)).length,fullPass:passed.length,finalists:finalists.length,copyEligible:eligible.length,autoSelected:selected.length};
 const noRecentFills=scanned.filter(x=>x.metrics.fills===0).length;const withFills=scanned.filter(x=>x.metrics.fills>0).length;
 const lines=['🟣 HYPERLIQUID TRADER HUNTER V5.12','📡 READ-ONLY | NO ORDERS','━━━━━━━━━━━━━━━━━━',`🔎 Discovery: ${d.discovered}`,`🎯 Pre-filtered: ${d.candidates.length}/${MAX_CANDIDATES}`,`📊 Full scanned: ${scanned.length}/${d.candidates.length}`,`⚠️ Scan failures: ${errors.length}`,`📦 Fills returned: ${withFills}/${scanned.length}`,`📭 No recent fills: ${noRecentFills}`,`❌ Error types: ${errSummary(errors)}`,`🎯 Statistical PASS: ${passed.length}`,`🏆 Finalists: ${finalists.length}/${FINALISTS}`,`🟢 Copy eligible: ${eligible.length}`,`🤖 Auto selected: ${selected.length}`,`🧪 Funnel: TRADES ${funnel.trades} → WR ${funnel.wr} → PF ${funnel.pf} → PASS ${funnel.fullPass}`,`🧱 Top filter blocks: ${top}`,`📚 Lookback: ${LOOKBACK_DAYS}d | Entry distance cap: ${MAX_ENTRY_DIST}%`,'','🏆 TOP 5 FINALISTS'];
 if(!finalists.length)lines.push('No trader passed the statistical filters.');else finalists.forEach((x,i)=>{const m=x.metrics,p=x.plan;lines.push('',`#${i+1} ${short(x.address)}${x.autoSelected?' 🤖 AUTO COPY':''}`,`👤 Trader: ${x.address}`,`🔎 Tracker: https://app.hyperliquid.xyz/explorer/address/${x.address}`,p?`🪙 Symbol: ${p.coin||'n/a'}`:'🪙 Symbol: n/a',`📈 7D: trades=${m.closedTrades} | WR=${pct(m.winRate)} | PnL=${fmt(m.pnl)} | PF=${fmt(m.profitFactor)}`,`⏱ Hold: median=${fmt(m.medianHoldHours)}h | avg=${fmt(m.avgHoldHours)}h | activeDays=${m.activeDays}`,`🧯 Streak=${m.maxLosingStreak} | liq=${m.liquidations} | fills=${m.fills}`,p?`📌 Plan: ${p.side}`:'📌 Plan: not enriched',p?`🎯 Source entry: ${fmt(p.sourceEntry,6)}`:'',p?`💠 Diagnostic entry: ${fmt(p.entry,6)} | bid=${fmt(p.bid,6)} | ask=${fmt(p.ask,6)}`:'',p?`📍 Entry distance: ${pct(p.distancePct,2)} <= ${MAX_ENTRY_DIST}%`:'',p?.sl!=null?`🛑 Diagnostic SL: ${fmt(p.sl,6)}`:'🛑 Diagnostic SL: n/a',p?.tp!=null?`🎯 Diagnostic TP: ${fmt(p.tp,6)}`:'🎯 Diagnostic TP: n/a',p?.rr!=null?`📐 RR: ${fmt(p.rr,2)} ${p.eligible?'≥':'<'} ${MIN_RR}`:'📐 RR: N/A (not enriched)',p?.maxHoldHours!=null?`⏱ Planned max hold: ${fmt(p.maxHoldHours,1)}h`:'',p?`🟢 Status: ${p.eligible?'ELIGIBLE':'BLOCKED — '+p.reason}`:`🟡 Status: ${x.enrichmentBlock||'NOT ENRICHED'}`,'ℹ️ Diagnostic TP/SL only | Source TP/SL not copied')});
 if(finalists.length && !eligible.length){lines.push('','🧪 ENRICHMENT DIAGNOSTICS');finalists.forEach(x=>lines.push(`${short(x.address)} → ${x.enrichmentBlock||x.plan?.reason||'ENRICHED_NO_ELIGIBILITY_BLOCK'}`));}
 if(errors.length){lines.push('','🧪 FIRST SCAN ERRORS');errors.slice(0,10).forEach(e=>lines.push(`${short(e.address)} → ${e.cat} → ${e.message.slice(0,180)}`))}
 lines.push('','ℹ️ Entry/SL/TP are READ-ONLY copy-plan diagnostics.','ℹ️ Source TP/SL is not copied.','ℹ️ No orders are created by this worker.',`🕐 ${new Date().toISOString()}`);console.log(`[HUNTER V5.12][DONE] discovered=${d.discovered} candidates=${d.candidates.length} scanned=${scanned.length} failed=${errors.length} pass=${passed.length} finalists=${finalists.length} eligible=${eligible.length} selected=${selected.length}`);await telegram(lines.join('\n'));
}

main().catch(async e=>{console.error(`[HUNTER V5.12][FATAL] ${e.stack||e}`);await telegram(`🟣 HYPERLIQUID TRADER HUNTER V5\n📡 READ-ONLY | NO ORDERS\n━━━━━━━━━━━━━━━━━━\n💥 FATAL ERROR\n${String(e.message||e).slice(0,1000)}`);process.exitCode=1});
