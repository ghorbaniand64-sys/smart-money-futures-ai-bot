import fs from 'node:fs/promises';
import path from 'node:path';

// GFTSH V2.1.2 — GLOBAL FUTURES ACTUAL-TRADE RECON / MULTI-SIGNAL
// READ ONLY. NO ORDERS. NO AUTO-COPY. FUTURES ONLY.
// Source authority: Hyperliquid public leaderboard + public user fills + clearinghouseState.
// Current position authority: clearinghouseState ONLY. Stale fills never become a live position.

const VERSION='GFTSH-V2.1.2-GLOBAL-FUTURES-ACTUAL-TRADE-RECON-MULTI-SIGNAL';
const BUILD='V2.1.2-DISCOVERY-RESTORE-CURRENT-POSITION-VERIFIED-MULTI-SIGNAL';
const API=process.env.HYPERLIQUID_API_URL||'https://api.hyperliquid.xyz/info';
const LEADERBOARD=process.env.HL_LEADERBOARD_URL||process.env.HYPERLIQUID_HUNTER_DISCOVERY_URL||'https://stats-data.hyperliquid.xyz/Mainnet/leaderboard';
const TG_TOKEN=process.env.TELEGRAM_TOKEN||process.env.TELEGRAM_BOT_TOKEN||'';
const TG_CHAT=process.env.TELEGRAM_CHAT_ID||'';
const TIMEOUT=Number(process.env.GFTSH_REQUEST_TIMEOUT_MS||20000);
const DISCOVERY_LIMIT=Math.max(100,Number(process.env.GFTSH_DISCOVERY_LIMIT||100));
const AUDIT_LIMIT=Math.max(DISCOVERY_LIMIT,Number(process.env.GFTSH_AUDIT_LIMIT||100));
const LOOKBACK_HOURS=Math.max(24,Number(process.env.GFTSH_PERFORMANCE_LOOKBACK_HOURS||168));
const MAX_FILL_PAGES=Math.max(2,Number(process.env.GFTSH_MAX_FILL_PAGES||8));
const ENTRY_MAX=Number(process.env.GFTSH_ENTRY_DISTANCE_PCT||0.75);
const WATCH_MAX=Number(process.env.GFTSH_WATCH_DISTANCE_PCT||3);
const FRESH_MIN=Number(process.env.GFTSH_SIGNAL_FRESHNESS_MIN||15);
const MIN_RR=Number(process.env.GFTSH_MIN_RR||2);
const SL_PCT=Number(process.env.GFTSH_MODEL_SL_PCT||0.5);
const TP_R=Number(process.env.GFTSH_MODEL_TP_R||2);
const MIN_TRADES=Number(process.env.GFTSH_MIN_CLOSED_TRADES||8);
const MIN_WR=Number(process.env.GFTSH_MIN_WR||60);
const MIN_PF=Number(process.env.GFTSH_MIN_PF||1.35);
const MAX_DD=Number(process.env.GFTSH_MAX_DD_PCT||25);
const MIN_NOTIONAL=Number(process.env.GFTSH_MIN_SIGNAL_NOTIONAL_USD||100);
const MIN_24H_VOL=Number(process.env.GFTSH_MIN_24H_VOLUME_USD||1000000);
const TOP_WATCH=Math.max(5,Number(process.env.GFTSH_WATCHLIST_SIZE||10));
const MAX_SIGNALS=Math.max(2,Number(process.env.GFTSH_MAX_SIGNALS||5));
const BETWEEN_MS=Number(process.env.GFTSH_BETWEEN_TRADERS_MS||120);
const STATE_FILE=process.env.GFTSH_STATE_FILE||'state/gftsh_v2_1_2_state.json';
const TG_STATE=process.env.GFTSH_TELEGRAM_STATE_FILE||'state/gftsh_telegram_state.json';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const num=(x,d=0)=>{const n=Number(x);return Number.isFinite(n)?n:d};
const finite=x=>Number.isFinite(Number(x));
function pct(x,d=2){return finite(x)?`${num(x).toFixed(d)}%`:'—'}
function usd(x,d=0){return finite(x)?`$${num(x).toLocaleString('en-US',{maximumFractionDigits:d})}`:'—'}
function px(x){const n=num(x);if(!(n>0))return '—';if(n>=100)return n.toFixed(2);if(n>=1)return n.toFixed(4);if(n>=.01)return n.toFixed(6);if(n>=.0001)return n.toFixed(8);return n.toExponential(5)}
function short(a){const s=String(a||'');return s.length>14?`${s.slice(0,8)}…${s.slice(-6)}`:s||'—'}
function rr(sl,tp){const a=Math.abs(num(sl));return a>0?Math.abs(num(tp))/a:0}
function signedDir(fill){const d=String(fill?.dir||'').toLowerCase();if(d.includes('open long'))return 1;if(d.includes('close long'))return -1;if(d.includes('open short'))return -1;if(d.includes('close short'))return 1;return 0}
function fillNotional(f){return Math.abs(num(f?.sz)*num(f?.px))}

async function json(url,opt={},label='http'){
 const c=new AbortController();const t=setTimeout(()=>c.abort(),TIMEOUT);
 try{const r=await fetch(url,{...opt,signal:c.signal,headers:{accept:'application/json',...(opt.headers||{})}});const body=await r.text();if(!r.ok)throw new Error(`${label}:HTTP_${r.status}`);return body?JSON.parse(body):null}
 finally{clearTimeout(t)}
}
async function hl(body,label='hl'){return json(API,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)},label)}

async function fetchLeaderboard(){
 const raw=await json(LEADERBOARD,{},'leaderboard');
 // The old regression returned the literal source name as "discovered". This parser
 // only accepts the real array and validates every address before it enters discovery.
 const rows=Array.isArray(raw)?raw:Array.isArray(raw?.leaderboardRows)?raw.leaderboardRows:Array.isArray(raw?.rows)?raw.rows:[];
 const traders=rows.map(r=>({
   address:String(r?.ethAddress||r?.address||r?.user||''),
   name:String(r?.displayName||r?.name||r?.username||'')
 })).filter(x=>/^0x[a-fA-F0-9]{40}$/.test(x.address));
 if(!traders.length)throw new Error('HL_LEADERBOARD_EMPTY_OR_INVALID');
 return {rows,traders};
}
function leaderboardMetrics(row){
 const wins=[];
 const arr=Array.isArray(row?.windowPerformances)?row.windowPerformances:[];
 for(const x of arr){if(!Array.isArray(x)||!x[1])continue;const k=String(x[0]);const v=x[1]||{};wins.push([k,v]);}
 const find=(key)=>{const v=wins.find(x=>x[0]===key)?.[1]||{};return {pnl:num(v?.pnl),vlm:num(v?.vlm),roi:num(v?.roi)}};
 const d=find('day'),w=find('week'),m=find('month');
 return {day:d,week:w,month:m,score:(w.vlm*0.000001)+(Math.max(0,w.pnl)*0.001)};
}

async function fillsFor(address,start,end){
 let all=[],cursor=end;
 for(let page=1;page<=MAX_FILL_PAGES;page++){
   let rows=await hl({type:'userFillsByTime',user:address,startTime:start,endTime:cursor,aggregateByTime:false},`fills:${short(address)}:${page}`);
   if(!Array.isArray(rows))throw new Error('FILLS_NOT_ARRAY');
   all.push(...rows);
   if(rows.length<2000)break;
   const oldest=Math.min(...rows.map(x=>num(x?.time)).filter(Boolean));
   if(!oldest||oldest<=start)break;
   cursor=oldest-1;await sleep(50);
 }
 const seen=new Set();
 return all.filter(f=>{const k=`${f?.hash}|${f?.time}|${f?.coin}|${f?.px}|${f?.sz}|${f?.dir}`;if(seen.has(k))return false;seen.add(k);return true}).sort((a,b)=>num(a.time)-num(b.time));
}

function reconstruct(fills){
 const books=new Map();const closed=[];let realized=0;let grossWin=0;let grossLoss=0;let equity=0;let peak=0;let maxDD=0;
 for(const f of fills){
   const coin=String(f?.coin||'');const delta=signedDir(f);const size=Math.abs(num(f?.sz));const price=num(f?.px);if(!coin||!(size>0)||!(price>0)||!delta)continue;
   let b=books.get(coin);if(!b)b={side:0,size:0,avg:0,startTime:0,notional:0};
   const same=b.side===0||b.side===Math.sign(delta);
   if(same){
     const old=b.size; b.avg=(old*b.avg+size*price)/(old+size);b.size=old+size;b.side=Math.sign(delta);b.startTime=b.startTime||num(f.time);b.notional+=size*price;
   }else{
     let remaining=size;let closePnl=num(f?.closedPnl,NaN);const before=b.size;
     if(!finite(closePnl))closePnl=(price-b.avg)*Math.min(size,b.size)*(b.side>0?1:-1);
     const portion=Math.min(size,b.size); const lifecycleClose=portion>=b.size*0.999999;
     if(lifecycleClose){
       const pnl=closePnl;const holdH=Math.max(0,(num(f.time)-b.startTime)/3600000);closed.push({coin,side:b.side>0?'LONG':'SHORT',entry:b.avg,exit:price,size:portion,pnl,holdHours:holdH,closeTime:num(f.time),notional:b.notional});
       realized+=pnl;if(pnl>0)grossWin+=pnl;else grossLoss+=Math.abs(pnl);
     }else{
       realized+=closePnl;if(closePnl>0)grossWin+=closePnl;else grossLoss+=Math.abs(closePnl);
     }
     b.size-=portion;remaining-=portion;
     if(b.size<=1e-12){b={side:0,size:0,avg:0,startTime:0,notional:0}}
     if(remaining>1e-12){b.side=Math.sign(delta);b.size=remaining;b.avg=price;b.startTime=num(f.time);b.notional=remaining*price}
   }
   books.set(coin,b);equity=realized;peak=Math.max(peak,equity);maxDD=Math.max(maxDD,peak-equity);
 }
 const wins=closed.filter(x=>x.pnl>0).length;const losses=closed.filter(x=>x.pnl<0).length;
 const pf=grossLoss>0?grossWin/grossLoss:null;const wr=closed.length?wins/closed.length*100:null;
 const recent=closed.filter(x=>x.closeTime>=Date.now()-24*3600000);
 const activeDays=new Set(closed.map(x=>new Date(x.closeTime).toISOString().slice(0,10))).size;
 return {closedTrades:closed.length,wins,losses,wr,pf,realizedPnl:realized,grossWin,grossLoss,maxDrawdown:maxDD,activeDays,recentClosed:recent.length,openBooks:[...books].filter(([,b])=>b.size>0).map(([coin,b])=>({coin,...b}))};
}

function quality(perf,lb){
 const reasons=[];
 if(perf.closedTrades<MIN_TRADES)reasons.push(`TRADES<${MIN_TRADES}`);
 if(!(perf.wr>=MIN_WR))reasons.push(`WR<${MIN_WR}%`);
 if(perf.pf===null)reasons.push('PF_UNAVAILABLE');else if(perf.pf<MIN_PF)reasons.push(`LOW_PF<${MIN_PF}`);
 if(perf.realizedPnl<=0)reasons.push('NON_POSITIVE_REALIZED_PNL');
 const ddBase=Math.max(1,Math.abs(perf.grossWin)+Math.abs(perf.grossLoss));const ddPct=perf.maxDrawdown/ddBase*100;
 if(ddPct>MAX_DD)reasons.push(`DD>${MAX_DD}%`);
 const anomaly=(perf.pf!==null&&perf.pf>30)||(perf.wr!==null&&perf.wr>99.5&&perf.closedTrades<20);
 if(anomaly)reasons.push('PF_WR_ANOMALY_REVIEW');
 const base=100-(reasons.length*8);
 const score=Math.max(0,Math.min(100,base+Math.min(10,perf.closedTrades/10)+Math.min(5,Math.max(0,perf.wr-60)/8)));
 let tier=score>=82?'S':score>=72?'A':score>=60?'B':'C';
 if(reasons.includes('PF_WR_ANOMALY_REVIEW'))tier=score>=72?'A':'B';
 return {score,tier,reasons,ddPct,anomaly};
}

async function stateFor(address){return hl({type:'clearinghouseState',user:address},`state:${short(address)}`)}
function positions(state){return (state?.assetPositions||[]).map(x=>x?.position||x).filter(p=>Math.abs(num(p?.szi))>0).map(p=>({coin:String(p.coin),side:num(p.szi)>0?'LONG':'SHORT',size:Math.abs(num(p.szi)),entry:num(p.entryPx),value:Math.abs(num(p.positionValue)),unrealized:num(p.unrealizedPnl),liq:num(p.liquidationPx),leverage:num(p.leverage?.value||p.leverage),margin:num(p.marginUsed)}));}
async function mids(){const x=await hl({type:'allMids'},'allMids');return x||{}}

function latestOpenAdds(fills){
 const out=[];for(const f of fills){const d=String(f?.dir||'').toLowerCase();if(!(d.includes('open long')||d.includes('open short')))continue;const notional=fillNotional(f);if(notional<MIN_NOTIONAL)continue;out.push(f)}return out.sort((a,b)=>num(b.time)-num(a.time));
}
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

async function auditTrader(c,start,end,midsMap){
 const fills=await fillsFor(c.address,start,end);const perf=reconstruct(fills);const q=quality(perf,c.lb);const state=await stateFor(c.address);const ps=positions(state);const posByCoin=new Map(ps.map(p=>[p.coin,p]));
 const adds=latestOpenAdds(fills);let candidate=null;let block='NO_CURRENT_POSITION';
 for(const f of adds){const p=posByCoin.get(String(f.coin));if(!p)continue;const mid=num(midsMap[String(f.coin)]);const sig=makeSignal({...c,quality:q,performance:perf},perf,q,p,f,mid);if(sig?.entryReady){candidate=sig;break}if(sig?.blocked&&block==='NO_CURRENT_POSITION')block=sig.blocked}
 if(!candidate&&ps.length===0)block='NO_CURRENT_POSITION';
 if(!candidate&&ps.length>0&&block==='NO_CURRENT_POSITION')block='POSITION_EXISTS_BUT_NO_FRESH_OPEN_ADD';
 return {...c,performance:perf,quality:q,positions:ps,latestAdd:adds[0]||null,currentSignal:candidate,blockReason:block};
}

function sortCandidates(rows){return rows.slice().sort((a,b)=>{
 const as=a.currentSignal?1:0,bs=b.currentSignal?1:0;if(bs!==as)return bs-as;
 if(b.quality.score!==a.quality.score)return b.quality.score-a.quality.score;
 return num(b.performance.closedTrades)-num(a.performance.closedTrades);
})}
function fmtTrader(x){const p=x.performance,q=x.quality;return `${short(x.address)} | ${q.tier} ${q.score.toFixed(1)} | ACT ${p.closedTrades} | WR ${finite(p.wr)?p.wr.toFixed(1)+'%':'—'} | PF ${p.pf===null?'—':p.pf.toFixed(2)} | PnL ${usd(p.realizedPnl)} | DD ${pct(q.ddPct,1)}`}
function signalLine(s,i){return [`${i}. ${s.trader.name||short(s.trader.address)} | ${short(s.trader.address)}`,`   ${s.side} ${s.coin} | Entry ${px(s.entry)} | Mark ${px(s.mark)} | Dist ${pct(s.distancePct,2)}`,`   SL ${px(s.sl)} | TP ${px(s.tp)} | RR ${s.rr.toFixed(2)} | Age ${s.ageMin.toFixed(1)}m | Notional ${usd(s.notional)}`,`   Trader ${s.trader.quality.tier}-TIER ${s.trader.quality.score.toFixed(1)} | WR ${s.trader.performance.wr.toFixed(1)}% | PF ${s.trader.performance.pf===null?'—':s.trader.performance.pf.toFixed(2)} | Trades ${s.trader.performance.closedTrades}`,`   VALID: CURRENT_POSITION_VERIFIED + FRESH_OPEN_ADD + ENTRY_WINDOW + RR_GATE`];}

async function telegram(text){if(!TG_TOKEN||!TG_CHAT){console.log('[TELEGRAM] credentials missing');return}try{const crypto=await import('node:crypto');const hash=crypto.createHash('sha256').update(text.replace(/^🕒.*$/m,'<TIME>')).digest('hex');let old={};try{old=JSON.parse(await fs.readFile(TG_STATE,'utf8'))}catch{}if(old.hash===hash&&Date.now()-num(old.sentAt)<10*60000)return;for(let i=0;i<text.length;i+=3800)await json(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:TG_CHAT,text:text.slice(i,i+3800),disable_web_page_preview:true})},'telegram');await fs.mkdir(path.dirname(TG_STATE),{recursive:true});await fs.writeFile(TG_STATE,JSON.stringify({hash,sentAt:Date.now()}))}catch(e){console.error('[TELEGRAM]',e.message)}}

async function main(){
 const started=Date.now();const start=Date.now()-LOOKBACK_HOURS*3600000,end=Date.now();
 console.log(`${VERSION} | READ-ONLY | NO ORDERS`);
 const lb=await fetchLeaderboard();
 // Preserve the working discovery contract: actual numeric trader IDs, not the source-name string.
 const ranked=lb.rows.map(r=>{const a=String(r?.ethAddress||r?.address||r?.user||'');const m=leaderboardMetrics(r);return {...r,address:a,name:String(r?.displayName||r?.name||r?.username||''),lb:m}}).filter(r=>/^0x[a-fA-F0-9]{40}$/.test(r.address)).sort((a,b)=>b.lb.score-a.lb.score).slice(0,AUDIT_LIMIT);
 console.log(`[DISCOVERY] leaderboardRows=${lb.rows.length} validTraderIds=${lb.traders.length} audit=${ranked.length}`);
 const midsMap=await mids();const audited=[];let errors=0;
 for(const c of ranked){try{audited.push(await auditTrader(c,start,end,midsMap))}catch(e){errors++;console.log(`[AUDIT][ERROR] ${short(c.address)} ${String(e?.message||e).slice(0,180)})`)}await sleep(BETWEEN_MS)}
 const complete=audited.filter(x=>x.performance.closedTrades>0);const eligible=complete.filter(x=>x.quality.tier!=='C'&&x.performance.closedTrades>=MIN_TRADES&&x.performance.wr>=MIN_WR&&(x.performance.pf===null||x.performance.pf>=MIN_PF)&&x.quality.ddPct<=MAX_DD&&!x.quality.anomaly);
 const watch=sortCandidates(eligible).slice(0,TOP_WATCH);const signals=watch.map(x=>x.currentSignal).filter(Boolean).sort((a,b)=>b.trader.quality.score-a.trader.quality.score).slice(0,MAX_SIGNALS);
 const used=new Set(signals.map(s=>s.trader.address));
 const report=[];
 report.push('🌐 GLOBAL FUTURES PRO HUNTER',`🧠 ${VERSION}`,`🔧 ${BUILD}`,'📡 READ-ONLY | NO ORDERS | NO AUTO-COPY | FUTURES ONLY','━━━━━━━━━━━━━━━━━━');
 report.push(`🔎 Leaderboard: ${lb.rows.length} | Valid trader IDs: ${lb.traders.length} | Audited: ${audited.length} | Complete: ${complete.length} | Errors: ${errors}`,`🎯 Quality eligible: ${eligible.length} | Watchlist: ${watch.length} | Actionable signals: ${signals.length}/${MAX_SIGNALS}`,`🧾 TRADE RECON: actual closed lifecycles | partial fills aggregated | PF/WR anomaly guard ON`,`🛡 CURRENT POSITION: Hyperliquid clearinghouseState ONLY | stale fills cannot create a position`,`⚡ SIGNAL: fresh open activity ≤${FRESH_MIN}m | entry distance ≤${ENTRY_MAX}% | SL ${SL_PCT}% | TP ${TP_R}R | RR ≥${MIN_RR}`,'');
 report.push('📡 SOURCE STATUS',`HYPERLIQUID: OK | FULL_SIGNAL | discovered=${lb.traders.length} | audited=${audited.length}`,'');
 report.push('👑 TOP VERIFIED TRADERS');
 watch.slice(0,TOP_WATCH).forEach((x,i)=>report.push(`${i+1}. ${fmtTrader(x)} | ${x.currentSignal?'POSITION READY':'BLOCK '+x.blockReason}`));
 if(!watch.length)report.push('No trader passed the minimum evidence gate this cycle.');
 report.push('','🔥 ACTIONABLE NOW');
 if(signals.length){signals.forEach((s,i)=>report.push(...signalLine(s,i+1),'━━━━━━━━━━━━━━━━━━'))}else report.push('No verified trader has a fresh copyable-quality current position this cycle.');
 report.push('','🧱 TOP BLOCK REASONS');
 sortCandidates(audited.filter(x=>!used.has(x.address))).slice(0,10).forEach(x=>report.push(`${short(x.address)} | ${x.quality.tier} ${x.quality.score.toFixed(1)} | ${x.blockReason||x.quality.reasons.join(' | ')||'NOT_SIGNAL_READY'}`));
 report.push('','🛡️ V2.1.2 CONTRACTS',`• Discovery returns real Hyperliquid trader IDs and reports numeric discovered count.`,`• Performance unit = actual closed lifecycle; no synthetic trades.`,`• PF unavailable is shown as — and never becomes LOW_PF.`,`• Current position = clearinghouseState; position side/entry must exist now.`,`• Signal requires fresh open activity + live position + entry distance + RR.`,`• Null metrics are rendered as — and never passed to toFixed().`,`• Multiple independent traders/signals may be emitted; MAX_SIGNALS=${MAX_SIGNALS}.`,`⏱ Runtime: ${((Date.now()-started)/1000).toFixed(1)}s`,`🕒 ${new Date().toISOString()}`);
 const text=report.join('\n');console.log(text);await fs.mkdir(path.dirname(STATE_FILE),{recursive:true});await fs.writeFile(STATE_FILE,JSON.stringify({version:VERSION,generatedAt:Date.now(),discovered:lb.traders.length,audited:audited.length,eligible:eligible.length,signals:signals.map(s=>({address:s.trader.address,coin:s.coin,side:s.side,entry:s.entry,mark:s.mark,sl:s.sl,tp:s.tp,rr:s.rr,ageMin:s.ageMin})),watch:watch.map(x=>({address:x.address,score:x.quality.score,tier:x.quality.tier})),errors},null,2));await telegram(text);
}
main().catch(async e=>{console.error(`[GFTSH][FATAL] ${e.stack||e}`);await telegram(`🌐 GLOBAL FUTURES PRO HUNTER\n🧠 ${VERSION}\n💥 FATAL: ${String(e?.message||e).slice(0,1000)}`);process.exitCode=1});
