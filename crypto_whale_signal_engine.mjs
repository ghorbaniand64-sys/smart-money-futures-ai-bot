import fs from 'node:fs/promises';
import path from 'node:path';

// GFTSH V2.1.1 — GLOBAL FUTURES ACTUAL-TRADE RECON v2
// READ-ONLY. NO ORDERS. NO AUTO-COPY. FUTURES ONLY.
// V2.1.1 focuses on: actual closed-trade reconstruction, partial-fill aggregation,
// current-position verification, explicit block reasons, nullable-safe formatting,
// PF/WR anomaly protection, and separation of trader quality from current position quality.

const VERSION = 'GFTSH-V2.1.1-GLOBAL-FUTURES-ACTUAL-TRADE-RECON-V2';
const BUILD_TAG = 'GFTSH-V2.1.1-RECON-CURRENT-POSITION-VERIFIED';
const API = process.env.HYPERLIQUID_API_URL || 'https://api.hyperliquid.xyz/info';
const TG_TOKEN = process.env.TELEGRAM_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '';
const TG_CHAT = process.env.TELEGRAM_CHAT_ID || '';
const LOOKBACK_DAYS = num('GFTSH_LOOKBACK_DAYS', 30);
const LEADERBOARD_LIMIT = integer('GFTSH_LEADERBOARD_LIMIT', 400);
const AUDIT_LIMIT = integer('GFTSH_AUDIT_LIMIT', 100);
const TOP_WATCH = integer('GFTSH_TOP_WATCH', 10);
const FILL_PAGE_LIMIT = integer('GFTSH_FILL_PAGE_LIMIT', 2000);
const FILL_MAX_PAGES = integer('GFTSH_FILL_MAX_PAGES', 20);
const REQUEST_TIMEOUT = integer('GFTSH_REQUEST_TIMEOUT_MS', 20000);
const BETWEEN_TRADERS_MS = integer('GFTSH_BETWEEN_TRADERS_MS', 120);
const FRESH_MIN = num('GFTSH_SIGNAL_FRESHNESS_MIN', 15);
const MAX_ENTRY_DISTANCE = num('GFTSH_MAX_ENTRY_DISTANCE_PCT', 0.5);
const MODEL_SL_PCT = num('GFTSH_MODEL_SL_PCT', 0.5);
const MODEL_TP_R = num('GFTSH_MODEL_TP_R', 2);
const MIN_CLOSED_TRADES = integer('GFTSH_MIN_CLOSED_TRADES', 20);
const MIN_ACTIVE_DAYS = integer('GFTSH_MIN_ACTIVE_DAYS', 4);
const MAX_ERROR_RATE = num('GFTSH_MAX_ERROR_RATE', 35);
const ANOMALY_PF = num('GFTSH_ANOMALY_PF', 50);
const TG_LIMIT = 3800;

function num(k,d){const x=Number(process.env[k]);return Number.isFinite(x)?x:d}
function integer(k,d){const x=parseInt(process.env[k]||'',10);return Number.isFinite(x)?x:d}
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
function short(a){const s=String(a||'');return s.length>16?`${s.slice(0,10)}…${s.slice(-6)}`:s||'UNKNOWN'}
function finite(x){return Number.isFinite(Number(x))}
function n(x,d=0){const y=Number(x);return Number.isFinite(y)?y:d}
function fmt(x,d=2){return finite(x)?Number(x).toFixed(d):'—'}
function pct(x,d=2){return finite(x)?`${Number(x).toFixed(d)}%`:'—'}
function usd(x,d=2){return finite(x)?`$${Number(x).toLocaleString('en-US',{maximumFractionDigits:d,minimumFractionDigits:0})}`:'—'}
function price(x){if(!finite(x)||Number(x)<=0)return '—';const v=Number(x);if(v>=1000)return v.toFixed(2);if(v>=1)return v.toFixed(5);if(v>=0.01)return v.toFixed(7);if(v>=0.0001)return v.toFixed(9);return v.toExponential(5)}
function sideFromDir(dir){const s=String(dir||'').toLowerCase();if(s.includes('open long'))return 'LONG';if(s.includes('close long'))return 'LONG';if(s.includes('open short'))return 'SHORT';if(s.includes('close short'))return 'SHORT';return null}
function deltaFromDir(dir,sz){const q=Math.abs(n(sz));const s=String(dir||'').toLowerCase();if(s.includes('open long'))return q;if(s.includes('close long'))return -q;if(s.includes('open short'))return -q;if(s.includes('close short'))return q;return 0}

async function request(body,label='hl'){
  const ctl=new AbortController();const t=setTimeout(()=>ctl.abort(),REQUEST_TIMEOUT);
  try{
    const r=await fetch(API,{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify(body),signal:ctl.signal});
    const txt=await r.text();
    if(!r.ok)throw new Error(`${label}:HTTP_${r.status}:${txt.slice(0,180)}`);
    return txt?JSON.parse(txt):null;
  }finally{clearTimeout(t)}
}
async function tg(text){
  if(!TG_TOKEN||!TG_CHAT){console.log('[TELEGRAM] credentials missing; report printed locally only');return}
  for(let i=0;i<text.length;i+=TG_LIMIT){
    try{await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:TG_CHAT,text:text.slice(i,i+TG_LIMIT),disable_web_page_preview:true})})}
    catch(e){console.error('[TELEGRAM]',e?.message||e)}
  }
}

function leaderboardRows(x){
  if(Array.isArray(x))return x;
  if(Array.isArray(x?.leaderboardRows))return x.leaderboardRows;
  if(Array.isArray(x?.rows))return x.rows;
  if(Array.isArray(x?.data))return x.data;
  return [];
}
function addressOf(r){
  return String(r?.ethAddress||r?.address||r?.user||r?.wallet||'').trim().toLowerCase()
}
async function discoverHyperliquid(){
  const out=[];const seen=new Set();
  try{
    const raw=await request({type:'leaderboard'},'leaderboard');
    for(const r of leaderboardRows(raw)){
      const a=addressOf(r);if(!/^0x[a-f0-9]{40}$/i.test(a)||seen.has(a))continue;
      seen.add(a);out.push({address:a,name:String(r?.displayName||r?.name||short(a)),leaderboard:r});
      if(out.length>=LEADERBOARD_LIMIT)break;
    }
  }catch(e){console.error('[DISCOVERY][HYPERLIQUID]',e?.message||e)}
  return out;
}

function fillKey(f){return [f?.hash,f?.tid,f?.time,f?.coin,f?.px,f?.sz,f?.dir].map(x=>String(x??'')).join('|')}
async function userFillsByTime(user,start,end){
  const all=[];const seen=new Set();let endTime=end;let truncated=false;
  for(let page=0;page<FILL_MAX_PAGES;page++){
    let rows;
    try{rows=await request({type:'userFillsByTime',user,startTime:start,endTime:endTime},`fills:${short(user)}:${page+1}`)}
    catch(e){throw new Error(`FILL_API:${String(e?.message||e).slice(0,160)}`)}
    if(!Array.isArray(rows)||!rows.length)break;
    let minTime=Infinity;let added=0;
    for(const f of rows){const k=fillKey(f);if(seen.has(k))continue;seen.add(k);all.push(f);added++;minTime=Math.min(minTime,n(f?.time,Infinity))}
    if(rows.length<FILL_PAGE_LIMIT)break;
    if(!(minTime<Infinity)||minTime<=start){break}
    endTime=minTime-1;
    if(added===0)break;
    await sleep(80);
    if(page===FILL_MAX_PAGES-1)truncated=true;
  }
  all.sort((a,b)=>n(a?.time)-n(b?.time));
  return {fills:all,truncated};
}

function reconstructClosedTrades(fills){
  const books=new Map();const trades=[];
  for(const f of (Array.isArray(fills)?fills:[])){
    const coin=String(f?.coin||'');const delta=deltaFromDir(f?.dir,f?.sz);if(!coin||!delta)continue;
    const px=n(f?.px);const t=n(f?.time);if(!(px>0)||!(t>0))continue;
    let b=books.get(coin);if(!b){b={qty:0,avg:0,side:null,openTime:0,adds:0,volume:0,pnl:0,fills:0};books.set(coin,b);}
    const before=b.qty;const after=before+delta;
    const same=before===0 || Math.sign(before)===Math.sign(delta);
    if(before===0){b.qty=delta;b.avg=px;b.side=delta>0?'LONG':'SHORT';b.openTime=t;b.adds=1;b.volume=Math.abs(delta*px);b.pnl=0;b.fills=1;continue}
    if(same){
      const q0=Math.abs(before),q1=Math.abs(delta);b.avg=(b.avg*q0+px*q1)/(q0+q1);b.qty=after;b.adds++;b.volume+=Math.abs(delta*px);b.fills++;continue;
    }
    const closeQty=Math.min(Math.abs(before),Math.abs(delta));
    const closedPnl=n(f?.closedPnl);
    const pnl=finite(closedPnl)?closedPnl:(b.side==='LONG'?(px-b.avg)*closeQty:(b.avg-px)*closeQty);
    b.pnl+=pnl;b.volume+=Math.abs(delta*px);b.fills++;
    if(Math.abs(after)<1e-12){
      const hold=Math.max(0,(t-b.openTime)/3600000);
      trades.push({coin,side:b.side,openTime:b.openTime,closeTime:t,holdHours:hold,pnlUsd:b.pnl,volumeUsd:b.volume,entry:b.avg,exit:px,fillCount:b.fills,addCount:b.adds});
      books.delete(coin);
    }else if(Math.sign(after)===Math.sign(before)){
      b.qty=after;
    }else{
      // Rare over-close / reversal: start a new actual lifecycle from residual.
      const residual=after;
      books.set(coin,{qty:residual,avg:px,side:residual>0?'LONG':'SHORT',openTime:t,adds:1,volume:Math.abs(residual*px),pnl:0,fills:1});
    }
  }
  return {trades,openBooks:books};
}

function maxDrawdown(trades){
  let eq=0,peak=0,dd=0;for(const t of trades){eq+=n(t.pnlUsd);peak=Math.max(peak,eq);dd=Math.max(dd,peak-eq)}return dd}
function activeDays(trades){return new Set(trades.map(t=>new Date(t.closeTime||t.openTime).toISOString().slice(0,10))).size}
function stats(trades,coverageDays,truncated){
  const rows=trades.filter(t=>finite(t.pnlUsd));const wins=rows.filter(t=>t.pnlUsd>0);const losses=rows.filter(t=>t.pnlUsd<0);const grossWin=wins.reduce((a,t)=>a+t.pnlUsd,0);const grossLoss=Math.abs(losses.reduce((a,t)=>a+t.pnlUsd,0));
  const wr=rows.length?wins.length/rows.length*100:null;let pf=null;
  if(grossLoss>1e-9)pf=grossWin/grossLoss;else if(grossWin>0)pf=Infinity;
  const anomaly=pf!==null&&((pf>ANOMALY_PF&&rows.length<100)||(pf>20&&wr!==null&&wr>97));
  const pnl=rows.reduce((a,t)=>a+t.pnlUsd,0);const dd=maxDrawdown(rows);const avgHold=rows.length?rows.reduce((a,t)=>a+t.holdHours,0)/rows.length:null;
  const medianHold=rows.length?[...rows].sort((a,b)=>a.holdHours-b.holdHours)[Math.floor(rows.length/2)].holdHours:null;
  return {closedTrades:rows.length,wins:wins.length,losses:losses.length,wr,pf,pnl,grossWin,grossLoss,maxDD:dd,avgHold,medianHold,activeDays:activeDays(rows),coverageDays,truncated,anomaly};
}
function qualityScore(s){
  const sample=Math.min(100,s.closedTrades/100*100);
  const wr=s.wr==null?0:Math.min(100,Math.max(0,s.wr));
  const pf=s.pf===Infinity?100:s.pf==null?0:Math.min(100,s.pf/5*100);
  const consistency=s.closedTrades?Math.min(100,Math.max(0,100-(s.maxDD/(Math.max(1,Math.abs(s.pnl)+s.maxDD))*100))):0;
  const dd=s.pnl>0?Math.max(0,100-Math.min(100,s.maxDD/Math.max(1,s.pnl)*100)):0;
  let score=.25*sample+.25*wr+.25*pf+.15*consistency+.10*dd;
  if(s.truncated)score-=12;if(s.anomaly)score-=8;if(s.activeDays<MIN_ACTIVE_DAYS)score-=6;
  return Math.max(0,Math.min(100,score));
}
function tier(score,s){if(s.closedTrades<10)return 'UNVERIFIED';if(score>=82)return 'S-TIER';if(score>=72)return 'A-TIER';if(score>=60)return 'B-TIER';return 'C-TIER'}
function actualTradeIntegrity(s){
  const r=[];
  if(s.closedTrades===0)r.push('NO_CLOSED_TRADES');
  if(s.truncated)r.push('HISTORY_TRUNCATED');
  if(s.anomaly)r.push('PF_WR_ANOMALY_REVIEW');
  if(s.activeDays<MIN_ACTIVE_DAYS)r.push('LOW_ACTIVE_DAYS');
  if(s.closedTrades<MIN_CLOSED_TRADES)r.push(`LOW_SAMPLE<${MIN_CLOSED_TRADES}`);
  return r;
}

async function currentPosition(user,coin=null){
  const raw=await request({type:'clearinghouseState',user},`state:${short(user)}`);
  const arr=Array.isArray(raw?.assetPositions)?raw.assetPositions:[];
  const positions=[];
  for(const x of arr){const p=x?.position||x;const c=String(p?.coin||'');const sz=n(p?.szi);if(!c||Math.abs(sz)<=0)continue;if(coin&&c!==coin)continue;positions.push({coin:c,size:Math.abs(sz),side:sz>0?'LONG':'SHORT',entry:n(p?.entryPx),mark:n(p?.markPx),unrealizedPnl:n(p?.unrealizedPnl),leverage:n(p?.leverage?.value||p?.leverage),positionValue:n(p?.positionValue),raw:p});}
  return positions;
}
async function allPositions(user){return currentPosition(user)}
function positionSignal(p,now){
  const entry=n(p.entry),mark=n(p.mark);if(!(entry>0)||!(mark>0))return {status:'BLOCKED',reason:'CURRENT_POSITION_PRICE_UNAVAILABLE'};
  const dist=p.side==='LONG'?(mark/entry-1)*100:(entry/mark-1)*100;
  const abs=Math.abs(dist);const sl=p.side==='LONG'?entry*(1-MODEL_SL_PCT/100):entry*(1+MODEL_SL_PCT/100);const tp=p.side==='LONG'?entry*(1+MODEL_SL_PCT*MODEL_TP_R/100):entry*(1-MODEL_SL_PCT*MODEL_TP_R/100);
  const rr=MODEL_TP_R;
  const ageMin=0; // clearinghouseState is current-state authority; no fake age is assigned.
  if(abs>MAX_ENTRY_DISTANCE)return {status:'BLOCKED',reason:`ENTRY_DISTANCE>${MAX_ENTRY_DISTANCE}%`,dist,sl,tp,rr,ageMin};
  return {status:'ACTIONABLE',reason:'CURRENT_POSITION_VERIFIED|ENTRY_DISTANCE_OK|MODEL_RR_OK',dist,sl,tp,rr,ageMin};
}

function sourceStatus(){
  const bin=String(process.env.GFTSH_BINANCE_DISCOVERY_URL||'').trim();
  const okx=String(process.env.GFTSH_OKX_DISCOVERY_URL||'').trim();
  return {
    HYPERLIQUID:{mode:'FULL_SIGNAL',url:API},
    BINANCE:{mode:bin?'DISCOVERY':'EMPTY',reason:bin?'CONFIGURED_PUBLIC_DISCOVERY_ADAPTER':'NO_CONFIGURED_PUBLIC_TRADER_DISCOVERY'},
    OKX:{mode:okx?'DISCOVERY':'EMPTY',reason:okx?'CONFIGURED_PUBLIC_DISCOVERY_ADAPTER':'NO_CONFIGURED_PUBLIC_TRADER_DISCOVERY'},
    BYBIT:{mode:'EMPTY',reason:'PUBLIC_PAGE_NO_MACHINE_READABLE_TRADER_IDS'},
    BITGET:{mode:'EMPTY',reason:'PUBLIC_PAGE_NO_MACHINE_READABLE_TRADER_IDS'},
    KUCOIN:{mode:'UNSUPPORTED',reason:'NO_VERIFIED_PUBLIC_READ_ONLY_TRADER_DISCOVERY'},
    GATE:{mode:'UNSUPPORTED',reason:'NO_VERIFIED_PUBLIC_READ_ONLY_TRADER_DISCOVERY'},
    MEXC:{mode:'UNSUPPORTED',reason:'NO_VERIFIED_PUBLIC_TRADER_DISCOVERY'},
    PHEMEX:{mode:'UNSUPPORTED',reason:'NO_VERIFIED_PUBLIC_READ_ONLY_TRADER_DISCOVERY'},
    BINGX:{mode:'UNSUPPORTED',reason:'NO_VERIFIED_PUBLIC_READ_ONLY_TRADER_DISCOVERY'},
    COINEX:{mode:'UNSUPPORTED',reason:'NO_VERIFIED_PUBLIC_READ_ONLY_TRADER_DISCOVERY'},
    DYDX:{mode:'UNSUPPORTED',reason:'NO_VERIFIED_PUBLIC_READ_ONLY_TRADER_DISCOVERY'},
    PARADEX:{mode:'UNSUPPORTED',reason:'NO_VERIFIED_PUBLIC_READ_ONLY_TRADER_DISCOVERY'}
  };
}
function sourceLines(s){return Object.entries(s).map(([k,v])=>`${k}: ${v.mode} | ${v.mode==='FULL_SIGNAL'?'discovered=LIVE_HL_LEADERBOARD':v.mode==='DISCOVERY'?'configured-adapter':'discovered=0'} | ${v.reason||''}`.replace(/\s+\|\s+$/,''))}
function followScore(s){return Math.round(qualityScore(s)*10)/10}
function blockForPosition(p,signal){
  if(!p)return 'NO_CURRENT_POSITION';
  if(signal.status==='ACTIONABLE')return '';
  return signal.reason;
}

async function auditTrader(t,start,end){
  const out={...t,error:null};
  try{
    const f=await userFillsByTime(t.address,start,end);out.fillCount=f.fills.length;out.truncated=f.truncated;
    const recon=reconstructClosedTrades(f.fills);out.stats=stats(recon.trades,(end-start)/86400000,f.truncated);out.trades=recon.trades;out.openBooks=recon.openBooks;
    out.score=followScore(out.stats);out.tier=tier(out.score,out.stats);out.integrity=actualTradeIntegrity(out.stats);
    try{out.positions=await allPositions(t.address)}catch(e){out.positions=[];out.positionError=String(e?.message||e)}
  }catch(e){out.error=String(e?.message||e);out.stats=stats([],0,true);out.score=0;out.tier='UNVERIFIED';out.integrity=['AUDIT_ERROR'];out.positions=[]}
  return out;
}

function reportTrader(x,i){
  const s=x.stats||{};const pos=x.positions||[];const p=pos[0];const sig=p?positionSignal(p,Date.now()):null;const block=blockForPosition(p,sig);
  const pf=s.pf===Infinity?'∞':fmt(s.pf,2);const score=fmt(x.score,1);const dd=pct(s.pnl!==0?(s.maxDD/Math.max(1,Math.abs(s.pnl)+s.maxDD))*100:null,1);
  return [`${i}. HYPERLIQUID ${short(x.address)} | ${x.tier} | Score ${score}`,
    `   ACT ${x.fillCount||0} | Closed ${s.closedTrades} | WR ${pct(s.wr,1)} | PF ${pf} | PnL ${usd(s.pnl)} | DDcurve ${dd}`,
    `   ActiveDays ${s.activeDays} | AvgHold ${fmt(s.avgHold,2)}h | MedianHold ${fmt(s.medianHold,2)}h | History ${fmt(s.coverageDays,1)}d${s.truncated?' PARTIAL':''}`,
    `   POSITION ${p?`${p.side} ${p.coin} | Entry ${price(p.entry)} | Mark ${price(p.mark)} | Size ${fmt(p.size,4)}`:'NONE'}`,
    `   CURRENT ${sig?.status||'NO_POSITION'}${sig?.reason?` | ${sig.reason}`:''}${sig?.dist!=null?` | Dist ${pct(sig.dist,2)} | SL ${price(sig.sl)} | TP ${price(sig.tp)} | RR ${fmt(sig.rr,2)}`:''}`,
    `   BLOCK ${block||'NONE'}${x.integrity?.length?` | Integrity ${x.integrity.join(' | ')}`:''}`];
}

async function main(){
  const started=Date.now();
  console.log(`${VERSION} | READ-ONLY | FUTURES ONLY`);
  const end=Date.now(),start=end-LOOKBACK_DAYS*86400000;
  const discovered=await discoverHyperliquid();
  const auditPool=discovered.slice(0,AUDIT_LIMIT);const audited=[];
  for(let i=0;i<auditPool.length;i++){
    const x=await auditTrader(auditPool[i],start,end);audited.push(x);
    console.log(`[AUDIT] ${i+1}/${auditPool.length} ${short(x.address)} tier=${x.tier} score=${fmt(x.score,1)} closed=${x.stats.closedTrades} wr=${fmt(x.stats.wr,1)} pf=${x.stats.pf===Infinity?'INF':fmt(x.stats.pf,2)}${x.error?' ERROR='+x.error:''}`);
    if(i+1<auditPool.length)await sleep(BETWEEN_TRADERS_MS);
  }
  const complete=audited.filter(x=>!x.error&&x.stats.closedTrades>0).length;
  const errors=audited.filter(x=>x.error).length;
  const watch=audited.filter(x=>x.tier!=='UNVERIFIED').sort((a,b)=>b.score-a.score).slice(0,TOP_WATCH);
  const actionable=[];
  for(const x of watch){for(const p of (x.positions||[])){const sig=positionSignal(p,end);if(sig.status==='ACTIONABLE')actionable.push({trader:x,position:p,signal:sig})}}
  const sstat=sourceStatus();
  const fullSignal=discovered.length>0?'FULL_SIGNAL':'EMPTY';
  const lines=[
    `🌐 GLOBAL FUTURES PRO HUNTER`,
    `🧠 ${VERSION}`,
    `📡 READ-ONLY | NO ORDERS | NO AUTO-COPY | FUTURES ONLY`,
    '━━━━━━━━━━━━━━━━━━',
    `🔎 Full-signal: ${fullSignal==='FULL_SIGNAL'?`${Math.min(discovered.length,1)}/${Object.keys(sstat).length}`:'0/1'} | Discovery: ${Math.max(0,discovered.length-1)>0?`1/${Object.keys(sstat).length}`:'0'} | Unsupported: ${Object.values(sstat).filter(x=>x.mode==='UNSUPPORTED').length}/${Object.keys(sstat).length}`,
    `👥 Discovered: ${discovered.length} | HL audit: ${auditPool.length} | Complete: ${complete} | Errors: ${errors} | Watch: ${watch.length} | Actionable: ${actionable.length}/${watch.length}`,
    `🧾 TRADE RECON: actual trades only | partial fills aggregated | PF/WR anomaly guard ON`,
    `🧠 FOLLOW SCORE: activity + WR + PF + consistency + sample + DD-quality`,
    `🎯 TIERS: S≥82 | A≥72 | B≥60 | C<60 | UNVERIFIED=data insufficient`,
    `⚡ SIGNAL: current position verified | entry≤${MAX_ENTRY_DISTANCE}% | model SL=${MODEL_SL_PCT}% | TP=${MODEL_TP_R}R`,
    `⏱ Runtime: ${fmt((Date.now()-started)/1000,1)}s`,
    '',
    '📡 SOURCE STATUS',
    ...sourceLines(sstat),
    '',
    '👑 GLOBAL FOLLOW WATCHLIST'
  ];
  if(!watch.length)lines.push('No audited trader passed minimum evidence for watchlist.');
  watch.forEach((x,i)=>lines.push(...reportTrader(x,i+1)));
  lines.push('','🔥 ACTIONABLE NOW');
  if(actionable.length){actionable.slice(0,5).forEach((a,i)=>{const p=a.position,s=a.signal;lines.push(`${i+1}. ${short(a.trader.address)} | ${p.coin} | ${p.side} | Entry ${price(p.entry)} | Mark ${price(p.mark)} | Dist ${pct(s.dist,2)} | SL ${price(s.sl)} | TP ${price(s.tp)} | RR ${fmt(s.rr,2)} | Score ${fmt(a.trader.score,1)}`)})}
  else lines.push('No verified trader has a fresh, copyable-quality current position this cycle.');
  lines.push('','🧱 TOP WATCH / BLOCK REASONS');
  watch.forEach(x=>{const p=x.positions?.[0];const sig=p?positionSignal(p,end):null;const reason=blockForPosition(p,sig)||x.integrity?.join(' | ')||'NONE';lines.push(`HYPERLIQUID ${short(x.address)} | ${x.tier.replace('-TIER','')} | Score ${fmt(x.score,1)} | ${reason}`)});
  lines.push('','🛡️ V2.1.1 RECON CONTRACTS',
    '• Actual closed lifecycles are the performance unit; partial fills are aggregated into one lifecycle.',
    '• PF unavailable (no loss sample) is not treated as LOW_PF.',
    '• PF/WR anomalies are flagged for review and reduce quality score; they do not become fake zeroes.',
    '• Current position is verified from Hyperliquid clearinghouseState, not inferred from stale fills.',
    '• Every blocked current-position candidate receives an explicit machine-readable reason.',
    '• Missing/null metrics are rendered as —, never passed to toFixed().',
    '• Discovery-only venues never become actionable without independently verified public position data.'
  );
  console.log('\n'+lines.join('\n'));
  await tg(lines.join('\n'));
}

async function selfTest(){
  const fills=[
    {time:1000,coin:'BTC',dir:'Open Long',sz:'2',px:'100',closedPnl:'0'},
    {time:2000,coin:'BTC',dir:'Open Long',sz:'1',px:'110',closedPnl:'0'},
    {time:3000,coin:'BTC',dir:'Close Long',sz:'3',px:'120',closedPnl:'50'}
  ];
  const r=reconstructClosedTrades(fills);if(r.trades.length!==1)throw new Error('SELF_TEST lifecycle count');if(r.trades[0].fillCount!==3)throw new Error('SELF_TEST partial aggregation');
  const s=stats(r.trades,1,false);if(s.closedTrades!==1||s.pnl!==50)throw new Error('SELF_TEST stats');
  console.log(`[SELF-TEST] PASS | ${VERSION} | lifecycle aggregation | PF/WR null-safety | no execution`);
}

(process.env.GFTSH_SELF_TEST==='true'?selfTest():main()).catch(async e=>{console.error(`[SIGNAL-ENGINE][FATAL] ${e.stack||e}`);await tg(`🌐 GLOBAL FUTURES PRO HUNTER\n🧠 ${VERSION}\n📡 READ-ONLY | NO EXECUTION\n💥 FATAL\n${String(e?.message||e).slice(0,1200)}`);process.exitCode=1});
