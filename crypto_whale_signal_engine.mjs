// CRYPTO SIGNAL ENGINE V1.0
// READ ONLY: NO ORDERS, NO PRIVATE KEYS, NO EXECUTION ENGINE.
// Exactly 10 fixed signal sources: 5 Spot + 5 Futures.
// Telegram report is emitted every workflow cycle (intended every 5 minutes).

const VERSION = 'V1.7-WHALE-SIGNAL-COPY-ZONE-DATA-INTEGRITY';
const HL_INFO = process.env.HYPERLIQUID_API_URL || 'https://api.hyperliquid.xyz/info';
const SOL_RPC = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const GECKO = 'https://api.geckoterminal.com/api/v2';
const TG_TOKEN = process.env.TELEGRAM_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '';
const TG_CHAT = process.env.TELEGRAM_CHAT_ID || '';
const ENTRY_WINDOW_PCT = Number(process.env.SIGNAL_MAX_ENTRY_DISTANCE_PCT || 0.75);
const WATCH_WINDOW_PCT = Number(process.env.SIGNAL_WATCH_DISTANCE_PCT || 3.0);
const MIN_RR = Number(process.env.SIGNAL_MIN_RR || 2.0);
const SL_PCT = Number(process.env.SIGNAL_SPOT_SL_PCT || 2.0);
const TP_PCT = Number(process.env.SIGNAL_SPOT_TP_PCT || 4.0);
const HL_SL_PCT = Number(process.env.SIGNAL_FUTURES_SL_PCT || 1.5);
const HL_TP_PCT = Number(process.env.SIGNAL_FUTURES_TP_PCT || 3.0);
const FETCH_TIMEOUT = Number(process.env.SIGNAL_REQUEST_TIMEOUT_MS || 18000);
const RECENT_SIGS = Number(process.env.SIGNAL_SPOT_SIGNATURES || 30);
const MAX_SPOT_POSITIONS = Number(process.env.SIGNAL_MAX_SPOT_POSITIONS_PER_WALLET || 4);
const TG_LIMIT = 3800;
const HEALTH_LOOKBACK_DAYS = Number(process.env.SIGNAL_HEALTH_LOOKBACK_DAYS || 30);
const HEALTH_MIN_TRADES = Number(process.env.SIGNAL_HEALTH_MIN_TRADES || 20);
const FUTURES_FRESH_HOURS = Number(process.env.SIGNAL_FUTURES_FRESH_HOURS || 2);
const FUTURES_WATCH_HOURS = Number(process.env.SIGNAL_FUTURES_WATCH_HOURS || 6);
const FUTURES_COPY_MAX_SOURCE_DIST_PCT = Number(process.env.SIGNAL_FUTURES_COPY_MAX_SOURCE_DIST_PCT || 1.25);
const FUTURES_COPY_MAX_FAVORABLE_PCT = Number(process.env.SIGNAL_FUTURES_COPY_MAX_FAVORABLE_PCT || 1.50);
const FUTURES_COPY_MAX_ADVERSE_PCT = Number(process.env.SIGNAL_FUTURES_COPY_MAX_ADVERSE_PCT || 1.00);
const FUTURES_COPY_ZONE_ATR_MULT = Number(process.env.SIGNAL_FUTURES_COPY_ZONE_ATR_MULT || 0.75);
const FUTURES_MIN_LIQ_DIST_PCT = Number(process.env.SIGNAL_FUTURES_MIN_LIQ_DIST_PCT || 3);
const FUTURES_ATR_PERIOD = Number(process.env.SIGNAL_FUTURES_ATR_PERIOD || 14);
const FUTURES_CANDLE_INTERVAL = process.env.SIGNAL_FUTURES_CANDLE_INTERVAL || '15m';

const SPOT_WALLETS = [
  {name:'DECU', address:'4vw54BmAogeRV3vPKWyFet5yf8DTLcREzdSzx4rw9Ud9'},
  {name:'TRUNOEST', address:'ardinRsN1mNYVeoJWTBsWeYeXvuR9UUDGMsCDKpb6AT'},
  {name:'CENTED', address:'CyaE1VxvBrahnPWkqm5VsdCvyS2QmNht2UFrKJHga54o'},
  {name:'MR_FROG', address:'4DdrfiDHpmx55i4SPssxVzS9ZaKLb8qr45NKY9Er9nNh'},
  {name:'JIJO', address:'4BdKaxN8G6ka4GYtQQWk4G4dZRUTX2vQH9GcXdBREFUk'}
];

const SPOT_HEALTH_BASELINE = {
  DECU:{pnl30d:3924.7,wr30d:63,trades30d:3868},
  TRUNOEST:{pnl30d:3653.05,wr30d:57,trades30d:4299},
  CENTED:{pnl30d:3958.0,wr30d:51,trades30d:4824},
  MR_FROG:{pnl30d:2581.2,wr30d:92,trades30d:3417},
  JIJO:{pnl30d:null,wr30d:null,trades30d:null}
};

const FUTURES_WALLETS = [
  {name:'F29C', address:'0xf29c6bc1147a841519b382459a6d7a373c6b9971'},
  {name:'58F0', address:'0x58f0bf4307c61bc7a5fe11e24fe36e64300b0d20'},
  {name:'D21D', address:'0xd21d931890d27b6e7e2e668f27931e17698e90f1'},
  {name:'7E1A', address:'0x7e1ad5e2bbe30d6d202e7c41036ea0a07c560be9'},
  {name:'382B', address:'0x382bf59b250a3167a8b86862c2c56cd870353e39'}
];

function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
function short(a){return `${String(a).slice(0,6)}…${String(a).slice(-6)}`}
function n(v,d=0){if(v===null||v===undefined||v==='')return d;const x=Number(v);return Number.isFinite(x)?x:d}
function money(v){return Number.isFinite(Number(v))?`$${Number(v).toLocaleString('en-US',{maximumFractionDigits:2})}`:'N/A'}
function pct(v,d=2){return Number.isFinite(Number(v))?`${Number(v).toFixed(d)}%`:'N/A'}
function fmt(v,d=4){return Number.isFinite(Number(v))?Number(v).toFixed(d):'N/A'}
function rr(sl,tp){const a=Math.abs(Number(sl));return a>0?Math.abs(Number(tp))/a:0}
function age(ms){if(!ms)return 'N/A';const h=(Date.now()-ms)/3600000;return h<1?`${Math.max(1,Math.round(h*60))}m`:`${h.toFixed(1)}h`}

async function fetchJson(url, options={}, label='request'){
  const ctl=new AbortController(); const timer=setTimeout(()=>ctl.abort(),FETCH_TIMEOUT);
  try{
    const r=await fetch(url,{...options,signal:ctl.signal,headers:{'accept':'application/json',...(options.headers||{})}});
    const text=await r.text();
    if(!r.ok)throw new Error(`${label}:HTTP_${r.status}:${text.slice(0,180)}`);
    return text?JSON.parse(text):null;
  }finally{clearTimeout(timer)}
}
async function hl(body,label='hl'){
  return fetchJson(HL_INFO,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)},label);
}
async function sol(body,label='solana'){
  return fetchJson(SOL_RPC,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:Date.now(),...body})},label);
}
async function telegram(text){
  if(!TG_TOKEN||!TG_CHAT){console.log('[TELEGRAM] credentials missing');return}
  for(let i=0;i<text.length;i+=TG_LIMIT){
    try{await fetchJson(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:TG_CHAT,text:text.slice(i,i+TG_LIMIT),disable_web_page_preview:true})},'telegram')}catch(e){console.error('[TELEGRAM]',e.message)}
  }
}

async function solSignatures(address){
  const r=await sol({method:'getSignaturesForAddress',params:[address,{limit:RECENT_SIGS}]},'getSignaturesForAddress');
  return Array.isArray(r?.result)?r.result.filter(x=>!x.err):[];
}
async function solTx(sig){
  const r=await sol({method:'getTransaction',params:[sig,{encoding:'jsonParsed',maxSupportedTransactionVersion:0}]},'getTransaction');
  return r?.result||null;
}
function ownerTokenDeltas(tx,wallet){
  const pre=tx?.meta?.preTokenBalances||[], post=tx?.meta?.postTokenBalances||[];
  const map=new Map();
  for(const b of pre){if(String(b.owner||'').toLowerCase()!==wallet.toLowerCase())continue;const mint=b.mint;map.set(`${mint}|pre`,n(b.uiTokenAmount?.uiAmountString))}
  for(const b of post){if(String(b.owner||'').toLowerCase()!==wallet.toLowerCase())continue;const mint=b.mint;map.set(`${mint}|post`,n(b.uiTokenAmount?.uiAmountString))}
  const mints=new Set([...map.keys()].map(k=>k.split('|')[0]));
  const out=[];
  for(const mint of mints){const d=n(map.get(`${mint}|post`))-n(map.get(`${mint}|pre`));if(Math.abs(d)>0)out.push({mint,delta:d})}
  return out;
}
function solDelta(tx){
  const keys=tx?.transaction?.message?.accountKeys||[];
  const wallet=keys.find(k=>k?.signer);
  const idx=keys.findIndex(k=>k?.pubkey===wallet?.pubkey);
  if(idx<0)return 0;
  return (n(tx?.meta?.postBalances?.[idx])-n(tx?.meta?.preBalances?.[idx]))/1e9;
}
async function tokenPrice(mint){
  const r=await fetchJson(`${GECKO}/simple/networks/solana/token_price/${mint}`); 
  return n(r?.data?.attributes?.token_prices?.[mint]);
}
async function tokenInfo(mint){
  try{
    const r=await fetchJson(`${GECKO}/networks/solana/tokens/${mint}`);
    const a=r?.data?.attributes||{};return {symbol:a.symbol||mint.slice(0,6),name:a.name||'',price:n(a.price_usd),fdv:n(a.fdv_usd),volume24h:n(a.volume_usd?.h24),liquidity:n(a.total_reserve_in_usd)};
  }catch{return {symbol:mint.slice(0,6),name:'',price:0,fdv:0,volume24h:0,liquidity:0}}
}
async function solHoldings(address){
  const r=await sol({method:'getTokenAccountsByOwner',params:[address,{programId:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'},{encoding:'jsonParsed'}]},'getTokenAccountsByOwner');
  return (r?.result?.value||[]).map(x=>{const i=x?.account?.data?.parsed?.info||{};return {mint:i.mint,amount:n(i.tokenAmount?.uiAmount),decimals:n(i.tokenAmount?.decimals)}}).filter(x=>x.mint&&x.amount>0);
}
async function scanSpot(w){
  const solInfo=await tokenInfo('So11111111111111111111111111111111111111112');
  const solUsd=solInfo.price||await tokenPrice('So11111111111111111111111111111111111111112');
  const [sigs,holdings]=await Promise.all([solSignatures(w.address),solHoldings(w.address)]);
  const txs=[];
  for(const s of sigs.slice(0,Math.min(sigs.length,RECENT_SIGS))){try{const tx=await solTx(s.signature);if(tx)txs.push({sig:s.signature,tx,blockTime:n(tx.blockTime||s.blockTime)*1000})}catch(e){console.log(`[SPOT][TX] ${w.name} ${e.message}`)}}
  const candidates=[];
  for(const h of holdings.slice(0,20)){
    const row=txs.find(r=>ownerTokenDeltas(r.tx,w.address).some(d=>d.mint===h.mint&&d.delta>0));
    if(!row)continue;
    const d=ownerTokenDeltas(row.tx,w.address).find(x=>x.mint===h.mint&&x.delta>0);
    const sd=solDelta(row.tx);
    const info=await tokenInfo(h.mint); const px=info.price||await tokenPrice(h.mint); if(!(px>0)||!(d?.delta>0))continue;
    const sourceEntry=Math.abs(sd)*solUsd/d.delta; if(!(sourceEntry>0))continue;
    const dist=(px/sourceEntry-1)*100;
    const sl=sourceEntry*(1-SL_PCT/100),tp=sourceEntry*(1+TP_PCT/100),R=rr(sourceEntry-sl,tp-sourceEntry);
    candidates.push({wallet:w,coin:info.symbol,mint:h.mint,side:'LONG',balance:h.amount,sourceEntry,current:px,distancePct:dist,sl,tp,rr:R,age:row.blockTime,liquidity:info.liquidity,volume24h:info.volume24h,tx:row.sig,eligible:Math.abs(dist)<=ENTRY_WINDOW_PCT&&R>=MIN_RR});
    if(candidates.length>=MAX_SPOT_POSITIONS)break;
  }
  return {wallet:w,signals:candidates.filter(x=>x.eligible),positions:candidates,scanned:sigs.length,txs:txs.length,holdings:holdings.length,health:spotHealth(w)};
}

function hlPositions(state){
  return (state?.assetPositions||[]).map(x=>x?.position||x).filter(p=>p&&Math.abs(n(p.szi))>0).map(p=>({coin:p.coin,side:n(p.szi)>0?'LONG':'SHORT',size:Math.abs(n(p.szi)),entry:n(p.entryPx),positionValue:Math.abs(n(p.positionValue)),unrealized:n(p.unrealizedPnl),leverage:n(p.leverage?.value||p.leverage),liq:n(p.liquidationPx),margin:n(p.marginUsed)}));
}
async function futuresHealth(w){
  try{
    const startTime=Date.now()-HEALTH_LOOKBACK_DAYS*86400000;
    const fills=await hl({type:'userFillsByTime',user:w.address,startTime},`fills:${w.name}`);
    const rows=Array.isArray(fills)?fills:[];
    const pnlRows=rows.map(f=>n(f.closedPnl)).filter(Number.isFinite);
    const wins=pnlRows.filter(v=>v>0).length, losses=pnlRows.filter(v=>v<0).length;
    const realized=pnlRows.reduce((a,b)=>a+b,0);
    const count=pnlRows.length;
    const wr=count?wins/count*100:null;
    const grossWin=pnlRows.filter(v=>v>0).reduce((a,b)=>a+b,0);
    const grossLoss=Math.abs(pnlRows.filter(v=>v<0).reduce((a,b)=>a+b,0));
    const pf=grossLoss>0?grossWin/grossLoss:null;
    let health='WATCH', reason='INSUFFICIENT_RECENT_DATA';
    if(count>=HEALTH_MIN_TRADES){
      if(realized>0 && wr>=55 && (pf===null||pf>=1.5)) {health='HEALTHY';reason='POSITIVE_PNL+WIN_RATE+PROFIT_FACTOR';}
      else if(realized>0 && wr>=45 && (pf===null||pf>=1.0)) {health='WATCH';reason='POSITIVE_BUT_MIXED_RECENT_STATS';}
      else {health='RISKY';reason='WEAK_RECENT_STATS';}
    }
    return {health,reason,realized,count,wr,pf};
  }catch(e){return {health:'WATCH',reason:'HEALTH_DATA_ERROR',error:e.message,realized:null,count:0,wr:null,pf:null};}
}
function spotHealth(w){
  const b=SPOT_HEALTH_BASELINE[w.name]||{};
  if(!Number.isFinite(b.pnl30d)||!Number.isFinite(b.wr30d)||!Number.isFinite(b.trades30d)) return {health:'WATCH',reason:'SPOT_HISTORY_NOT_ENOUGH_FOR_DYNAMIC_HEALTH',...b};
  if(b.pnl30d>0 && b.wr30d>=55 && b.trades30d>=HEALTH_MIN_TRADES) return {health:'HEALTHY',reason:'AUDITED_30D_BASELINE',...b};
  if(b.pnl30d>0 && b.wr30d>=40) return {health:'WATCH',reason:'POSITIVE_BUT_MIXED_30D_BASELINE',...b};
  return {health:'RISKY',reason:'WEAK_30D_BASELINE',...b};
}
function healthLine(h,w){
  const icon=h.health==='HEALTHY'?'🟢':h.health==='WATCH'?'🟡':'🔴';
  const parts=[`${icon} ${w.name} — ${h.health}`];
  if(Number.isFinite(h.realized))parts.push(`30D realized ${money(h.realized)}`);
  else if(Number.isFinite(h.pnl30d))parts.push(`30D realized ${h.pnl30d.toFixed(1)} SOL`);
  if(Number.isFinite(h.wr))parts.push(`WR ${h.wr.toFixed(1)}%`);
  else if(Number.isFinite(h.wr30d))parts.push(`WR ${h.wr30d.toFixed(1)}%`);
  if(Number.isFinite(h.pf))parts.push(`PF ${h.pf.toFixed(2)}`);
  if(Number.isFinite(h.count))parts.push(`fills ${h.count}`);
  if(Number.isFinite(h.trades30d))parts.push(`trades ${h.trades30d}`);
  parts.push(`Reason: ${h.reason}`);
  return parts.join(' | ');
}


function safeNum(v){return v===null||v===undefined||v===''||!Number.isFinite(Number(v))?null:Number(v)}
function finiteOrNull(v){return Number.isFinite(Number(v))?Number(v):null}
function sideDistPct(mid,entry,side){
  if(!(mid>0&&entry>0))return null;
  return (mid/entry-1)*100*(side==='LONG'?1:-1);
}
function ageHours(ts){return Number.isFinite(Number(ts))?Math.max(0,(Date.now()-Number(ts))/3600000):null}
function validDistance(x){return Number.isFinite(Number(x?.current))&&Number.isFinite(Number(x?.sourceEntry))}
function liqDistancePct(x){
  if(!(x?.liq>0)||!(x?.current>0))return null;
  return Math.abs((x.current/x.liq-1)*100);
}
async function hlCandles(coin){
  const end=Date.now(), start=end-15*60*1000*(FUTURES_ATR_PERIOD+8);
  try{
    const r=await hl({type:'candleSnapshot',req:{coin,interval:FUTURES_CANDLE_INTERVAL,startTime:start,endTime:end}},`candles:${coin}`);
    return Array.isArray(r)?r:[];
  }catch{return []}
}
function atrFromCandles(candles){
  const rows=candles.map(c=>({
    h:Number(c.h),l:Number(c.l),c:Number(c.c)
  })).filter(x=>x.h>0&&x.l>0&&x.c>0);
  if(rows.length<3)return null;
  const trs=[];
  for(let i=1;i<rows.length;i++){
    const prev=rows[i-1].c;
    trs.push(Math.max(rows[i].h-rows[i].l,Math.abs(rows[i].h-prev),Math.abs(rows[i].l-prev)));
  }
  const tail=trs.slice(-FUTURES_ATR_PERIOD);
  return tail.length?tail.reduce((a,b)=>a+b,0)/tail.length:null;
}
function structureFromCandles(candles,side){
  const rows=candles.map(c=>({h:Number(c.h),l:Number(c.l),c:Number(c.c)}))
    .filter(x=>x.h>0&&x.l>0&&x.c>0).slice(-20);
  if(rows.length<5)return null;
  if(side==='LONG'){
    const low=Math.min(...rows.map(x=>x.l));
    return {swing:low};
  }
  const high=Math.max(...rows.map(x=>x.h));
  return {swing:high};
}
function copyZone(x){
  if(!Number.isFinite(x.current)||!Number.isFinite(x.atr)||x.atr<=0)return null;
  const pad=x.atr*FUTURES_COPY_ZONE_ATR_MULT;
  if(x.side==='LONG'){
    return {low:Math.max(0,x.current-pad),high:x.current+pad};
  }
  return {low:Math.max(0,x.current-pad),high:x.current+pad};
}
function futuresCopyClassification(x){
  const reasons=[];
  if(!validDistance(x)) reasons.push('NO_SOURCE_ENTRY');
  const ageH=x.addAgeHours;
  if(!Number.isFinite(ageH)) reasons.push('NO_RECENT_ADD_FILL');
  else if(ageH>FUTURES_WATCH_HOURS) reasons.push(`POSITION_TOO_OLD>${FUTURES_WATCH_HOURS}h`);
  const ad=Math.abs(Number(x.distancePct));
  if(!Number.isFinite(ad)) reasons.push('NO_SOURCE_DIST');
  else if(ad>FUTURES_COPY_MAX_SOURCE_DIST_PCT) reasons.push(`SOURCE_DIST>${FUTURES_COPY_MAX_SOURCE_DIST_PCT}%`);
  if(x.distancePct!==null){
    if(x.side==='LONG' && x.distancePct < -FUTURES_COPY_MAX_ADVERSE_PCT) reasons.push(`ADVERSE_MOVE>${FUTURES_COPY_MAX_ADVERSE_PCT}%`);
    if(x.side==='SHORT' && x.distancePct < -FUTURES_COPY_MAX_ADVERSE_PCT) reasons.push(`ADVERSE_MOVE>${FUTURES_COPY_MAX_ADVERSE_PCT}%`);
    if(x.distancePct>FUTURES_COPY_MAX_FAVORABLE_PCT) reasons.push(`FAVORABLE_MOVE>${FUTURES_COPY_MAX_FAVORABLE_PCT}%`);
  }
  if(!Number.isFinite(x.liqDistancePct)) reasons.push('LIQ_DISTANCE_UNKNOWN');
  else if(x.liqDistancePct<FUTURES_MIN_LIQ_DIST_PCT) reasons.push(`LIQ_DIST<${FUTURES_MIN_LIQ_DIST_PCT}%`);
  if(!Number.isFinite(x.rr)||x.rr<MIN_RR) reasons.push(`RR<${MIN_RR}`);
  if(!Number.isFinite(x.atrPct)) reasons.push('ATR_UNAVAILABLE');
  if(x.side==='LONG' && Number.isFinite(x.structureStop) && x.structureStop>=x.current) reasons.push('STRUCTURE_INVALID');
  if(x.side==='SHORT' && Number.isFinite(x.structureStop) && x.structureStop<=x.current) reasons.push('STRUCTURE_INVALID');

  if(!reasons.length && ageH<=FUTURES_FRESH_HOURS && ad<=FUTURES_COPY_MAX_SOURCE_DIST_PCT) return 'GREEN';
  if(reasons.length && Number.isFinite(ageH) && ageH<=FUTURES_WATCH_HOURS && ad<=WATCH_WINDOW_PCT) return 'YELLOW';
  return 'RED';
}
async function scanFutures(w){
  const health=await futuresHealth(w);
  const state=await hl({type:'clearinghouseState',user:w.address},`state:${w.name}`);
  const ps=hlPositions(state);
  const mids=await hl({type:'allMids'},`mids:${w.name}`);
  const fills=await hl({type:'userFillsByTime',user:w.address,startTime:Date.now()-24*3600000},`recent-fills:${w.name}`).catch(()=>[]);
  const recent=Array.isArray(fills)?fills:[];
  const signals=[],positions=[];
  for(const p of ps){
    const mid=safeNum(mids?.[p.coin]);
    if(!(mid>0))continue;
    const sourceEntry=safeNum(p.entry);
    const dist=validDistance({current:mid,sourceEntry})?sideDistPct(mid,sourceEntry,p.side):null;

    // Find the most recent fill in the same coin and side that increased exposure.
    const same=recent.filter(f=>String(f.coin||'')===String(p.coin));
    let addTs=null;
    for(const f of same){
      const sz=safeNum(f.sz);
      const dir=String(f.dir||'').toLowerCase();
      const fillSide=(dir.includes('buy')?'LONG':dir.includes('sell')?'SHORT':null);
      const isSame=fillSide===p.side;
      if(isSame && sz>0){
        const t=safeNum(f.time);
        if(Number.isFinite(t)) addTs=Math.max(addTs||0,t);
      }
    }
    const addAgeHours=ageHours(addTs);

    const candles=await hlCandles(p.coin);
    const atr=atrFromCandles(candles);
    const atrPct=atr&&mid?atr/mid*100:null;
    const structure=structureFromCandles(candles,p.side);
    let structureStop=null;
    if(structure){
      if(p.side==='LONG') structureStop=Math.min(structure.swing,mid-atr*(Number.isFinite(atr)?1.15:0));
      else structureStop=Math.max(structure.swing,mid+atr*(Number.isFinite(atr)?1.15:0));
    }
    // Conservative fallback if structure is unavailable: ATR-based stop.
    if(!Number.isFinite(structureStop) && Number.isFinite(atr)){
      structureStop=p.side==='LONG'?mid-atr*1.25:mid+atr*1.25;
    }
    if(!Number.isFinite(structureStop) || structureStop<=0){
      structureStop=null;
    }
    const risk=Number.isFinite(structureStop)?Math.abs(mid-structureStop):null;
    const tp=Number.isFinite(risk)?(p.side==='LONG'?mid+risk*MIN_RR:mid-risk*MIN_RR):null;
    const R=Number.isFinite(risk)&&risk>0&&Number.isFinite(tp)?Math.abs(tp-mid)/risk:null;
    const liq=safeNum(p.liq);
    const liqDist=liqDistancePct({current:mid,liq});
    const zone=copyZone({current:mid,atr:p.side?atr:null,side:p.side});

    const x={
      wallet:w,coin:p.coin,side:p.side,sourceEntry,current:mid,
      distancePct:dist,sl:structureStop,tp,rr:R,size:p.size,
      positionValue:p.positionValue,unrealized:p.unrealized,
      leverage:p.leverage,liq,margin:p.margin,
      addTs,addAgeHours,addAge:addTs?age(addTs):'N/A',
      atr,atrPct,structureStop,liqDistancePct:liqDist,copyZone:zone,
      eligible:false,status:'RED'
    };
    x._futuresReasons=[];
    const ageH=x.addAgeHours;
    if(!validDistance(x))x._futuresReasons.push('NO_SOURCE_ENTRY');
    if(!Number.isFinite(ageH))x._futuresReasons.push('NO_RECENT_ADD_FILL');
    else if(ageH>FUTURES_WATCH_HOURS)x._futuresReasons.push(`POSITION_TOO_OLD>${FUTURES_WATCH_HOURS}h`);
    if(!Number.isFinite(x.distancePct))x._futuresReasons.push('NO_SOURCE_DIST');
    else if(Math.abs(x.distancePct)>FUTURES_COPY_MAX_SOURCE_DIST_PCT)x._futuresReasons.push(`SOURCE_DIST>${FUTURES_COPY_MAX_SOURCE_DIST_PCT}%`);
    if(Number.isFinite(x.distancePct)){
      if(x.distancePct< -FUTURES_COPY_MAX_ADVERSE_PCT)x._futuresReasons.push(`ADVERSE_MOVE>${FUTURES_COPY_MAX_ADVERSE_PCT}%`);
      if(x.distancePct> FUTURES_COPY_MAX_FAVORABLE_PCT)x._futuresReasons.push(`FAVORABLE_MOVE>${FUTURES_COPY_MAX_FAVORABLE_PCT}%`);
    }
    if(!Number.isFinite(x.liqDistancePct))x._futuresReasons.push('LIQ_DISTANCE_UNKNOWN');
    else if(x.liqDistancePct<FUTURES_MIN_LIQ_DIST_PCT)x._futuresReasons.push(`LIQ_DIST<${FUTURES_MIN_LIQ_DIST_PCT}%`);
    if(!Number.isFinite(x.rr)||x.rr<MIN_RR)x._futuresReasons.push(`RR<${MIN_RR}`);
    if(!Number.isFinite(x.atrPct))x._futuresReasons.push('ATR_UNAVAILABLE');
    if(!Number.isFinite(x.structureStop))x._futuresReasons.push('STRUCTURE_STOP_UNAVAILABLE');
    x.status=futuresCopyClassification(x);
    x.eligible=x.status==='GREEN';
    if(x.eligible)signals.push(x);
    positions.push(x);
  }
  return {wallet:w,signals,positions,scanned:1,health};
}
function signalLine(x,i){
  return `${i}. ${x.wallet.name} | ${x.coin} | ${x.side}\n   Source Entry ${fmt(x.sourceEntry)} | Now ${fmt(x.current)} | Dist ${pct(x.distancePct,2)}\n   SL ${fmt(x.sl)} | TP ${fmt(x.tp)} | RR ${fmt(x.rr,2)} | ${x.leverage?`Lev ${fmt(x.leverage,1)}x | `:''}${x.positionValue?`Pos ${money(x.positionValue)} | `:''}${x.liquidity?`Liq ${money(x.liquidity)}`:''}`;
}
function distanceAbs(x){return Number.isFinite(Number(x?.distancePct))?Math.abs(Number(x.distancePct)):Infinity}
function setupReason(x){
  if(!validDistance(x))return ['NO_SOURCE_ENTRY'];
  const why=[];
  if(x.mint){
    if(distanceAbs(x)>ENTRY_WINDOW_PCT)why.push(`DIST>${ENTRY_WINDOW_PCT}%`);
    if(Number(x.rr)<MIN_RR)why.push(`RR<${MIN_RR}`);
  }else{
    if(Array.isArray(x._futuresReasons))why.push(...x._futuresReasons);
  }
  return why;
}
function classifyPosition(x){
  if(!x.mint && x.status)return x.status;
  const dist=distanceAbs(x);
  const why=setupReason(x);
  if(validDistance(x)&&dist<=ENTRY_WINDOW_PCT&&why.length===0)return 'GREEN';
  if(validDistance(x)&&dist<=WATCH_WINDOW_PCT)return 'YELLOW';
  return 'RED';
}
function blockedLine(x){
  const cls=classifyPosition(x);
  let why=setupReason(x);
  if(!x.mint && Array.isArray(x._futuresReasons))why=x._futuresReasons;
  const reason=why.length?why.join(','):'NO_VALID_SETUP';
  const icon=cls==='YELLOW'?'🟡':'🔴';
  const label=cls==='YELLOW'?'WATCH / BLOCKED':'TOO LATE / BLOCKED';
  const ageTxt=!x.mint?` | Add age ${x.addAge||'N/A'}`:'';
  return `${icon} ${x.wallet.name} ${x.coin} ${x.side} | now=${fmt(x.current)} | whale=${fmt(x.sourceEntry)} | dist=${pct(x.distancePct,2)}${ageTxt} | ${label} | BLOCK ${reason}`;
}

function healthIcon(h){return h?.health==='HEALTHY'?'🟢':h?.health==='WATCH'?'🟡':'🔴';}
function compactHealth(h){
  const p=[];
  if(Number.isFinite(h?.realized))p.push(`30D ${money(h.realized)}`);
  else if(Number.isFinite(h?.pnl30d))p.push(`30D ${h.pnl30d.toFixed(1)} SOL`);
  if(Number.isFinite(h?.wr))p.push(`WR ${h.wr.toFixed(1)}%`);
  else if(Number.isFinite(h?.wr30d))p.push(`WR ${h.wr30d.toFixed(1)}%`);
  if(Number.isFinite(h?.pf))p.push(`PF ${h.pf.toFixed(2)}`);
  if(Number.isFinite(h?.count))p.push(`fills ${h.count}`);
  else if(Number.isFinite(h?.trades30d))p.push(`trades ${h.trades30d}`);
  return p.join(' | ');
}
function positionDetailLine(x){
  const cls=classifyPosition(x);
  const icon=cls==='GREEN'?'🟢':cls==='YELLOW'?'🟡':'🔴';
  const label=cls==='GREEN'?'COPY ENTRY READY':cls==='YELLOW'?'WATCH / BLOCKED':'TOO LATE / BLOCKED';
  const why=setupReason(x);
  const block=cls==='GREEN'?'VALID':(why.length?why.join(','):'NO_VALID_SETUP');
  const lev=Number.isFinite(Number(x.leverage))?` | Lev ${fmt(x.leverage,1)}x`:'';
  const pos=Number.isFinite(Number(x.positionValue))?` | Pos ${money(x.positionValue)}`:'';
  const up=Number.isFinite(Number(x.unrealized))?` | uPnL ${money(x.unrealized)}`:'';
  const ageTxt=!x.mint?` | Add age ${x.addAge||'N/A'}`:'';
  const atrTxt=!x.mint&&Number.isFinite(x.atrPct)?` | ATR ${pct(x.atrPct,2)}`:'';
  const liqTxt=!x.mint&&Number.isFinite(x.liqDistancePct)?` | LiqDist ${pct(x.liqDistancePct,2)}`:'';
  const zone=!x.mint&&x.copyZone?` | Zone ${fmt(x.copyZone.low)}–${fmt(x.copyZone.high)}`:'';
  return `${icon} ${x.coin} ${x.side} | Now ${fmt(x.current)} | Entry ${fmt(x.sourceEntry)} | Dist ${pct(x.distancePct,2)}${ageTxt} | SL ${fmt(x.sl)} | TP ${fmt(x.tp)} | RR ${fmt(x.rr,2)}${atrTxt}${liqTxt}${zone}${lev}${pos}${up} | ${label}${cls==='GREEN'?'':' | '+block}`;
}
function traderBlock(result){
  const h=result.health||{health:'WATCH',reason:'NO_HEALTH_DATA'};
  const icon=healthIcon(h);
  const header=`${icon} ${result.wallet.name} — ${h.health}${compactHealth(h)?' | '+compactHealth(h):''}`;
  const ps=result.positions||[];
  if(!ps.length)return [header+' | Position: NONE'];
  return [header,...ps.map(x=>'   '+positionDetailLine(x))];
}
function marketSection(title,results){
  const rows=[];
  rows.push(title,'━━━━━━━━━━━━━━━━━━');
  results.forEach(r=>rows.push(...traderBlock(r)));
  return rows;
}
async function main(){
  const started=Date.now();
  console.log(`[SIGNAL-ENGINE ${VERSION}][START] spot=${SPOT_WALLETS.length} futures=${FUTURES_WALLETS.length}`);
  const spot=await Promise.all(SPOT_WALLETS.map(w=>scanSpot(w).catch(e=>({wallet:w,signals:[],positions:[],error:e.message,scanned:0,txs:0,health:spotHealth(w)}))));
  const futures=await Promise.all(FUTURES_WALLETS.map(w=>scanFutures(w).catch(e=>({wallet:w,signals:[],positions:[],error:e.message,scanned:0,health:{health:'WATCH',reason:'HEALTH_DATA_ERROR',error:e.message}}))));
  const allPositions=[...spot.flatMap(x=>x.positions),...futures.flatMap(x=>x.positions)];
  const classified=allPositions.map(x=>({...x,status:classifyPosition(x)}));
  const green=classified.filter(x=>x.status==='GREEN');
  const yellow=classified.filter(x=>x.status==='YELLOW');
  const red=classified.filter(x=>x.status==='RED');
  const spotGreen=green.filter(x=>x.mint);
  const futuresGreen=green.filter(x=>!x.mint);
  const lines=[
    `🟣 CRYPTO WHALE SIGNAL ENGINE ${VERSION}`,
    '📡 READ-ONLY | NO ORDERS | NO EXECUTION',
    '━━━━━━━━━━━━━━━━━━',
    `🕐 Cycle: ${new Date().toISOString()}`,
    `🎯 Sources: SPOT ${SPOT_WALLETS.length}/5 | FUTURES ${FUTURES_WALLETS.length}/5`,
    `🔎 Exact scans: ${spot.filter(x=>!x.error).length}/5 Spot | ${futures.filter(x=>!x.error).length}/5 Futures`,
    `🟢 ENTRY READY: ${green.length} | 🟡 NEAR: ${yellow.length} | 🔴 TOO LATE: ${red.length}`,
    `📏 Spot green ≤${ENTRY_WINDOW_PCT}% | Futures: fresh ≤${FUTURES_FRESH_HOURS}h + source zone ≤${FUTURES_COPY_MAX_SOURCE_DIST_PCT}% + RR≥${MIN_RR}`,
    '',
    '🟢 ENTRY READY — SPOT',
    '━━━━━━━━━━━━━━━━━━'
  ];
  if(spotGreen.length)spotGreen.forEach((x,i)=>{lines.push(signalLine(x,i+1));if(x.mint)lines.push(`🔗 ${x.mint}`);});
  else lines.push('No Spot entry opportunity right now.');

  lines.push('','🟢 ENTRY READY — FUTURES','━━━━━━━━━━━━━━━━━━');
  if(futuresGreen.length)futuresGreen.forEach((x,i)=>lines.push(signalLine(x,i+1)));
  else lines.push('No Futures entry opportunity right now.');

  lines.push('','🟡 NEAR ENTRY — SPOT');
  const spotYellow=yellow.filter(x=>x.mint);
  if(spotYellow.length)spotYellow.forEach(x=>lines.push('• '+blockedLine(x)));else lines.push('No Spot near-entry blocked positions.');

  lines.push('','🟡 NEAR ENTRY — FUTURES');
  const futuresYellow=yellow.filter(x=>!x.mint);
  if(futuresYellow.length)futuresYellow.forEach(x=>lines.push('• '+blockedLine(x)));else lines.push('No Futures near-entry blocked positions.');

  lines.push('','🔴 TOO LATE — SPOT');
  const spotRed=red.filter(x=>x.mint);
  if(spotRed.length)spotRed.forEach(x=>lines.push('• '+blockedLine(x)));else lines.push('No Spot positions are too far from source entry.');

  lines.push('','🔴 TOO LATE — FUTURES');
  const futuresRed=red.filter(x=>!x.mint);
  if(futuresRed.length)futuresRed.forEach(x=>lines.push('• '+blockedLine(x)));else lines.push('No Futures positions are too far from source entry.');

  // The key new section: each wallet is grouped under its own market and its
  // Health is printed immediately above its CURRENT positions. This prevents
  // a health status from becoming detached from the positions it describes.
  lines.push('',...marketSection('🏥 SPOT TRADER HEALTH + CURRENT POSITIONS',spot));
  lines.push('',...marketSection('🏥 FUTURES TRADER HEALTH + CURRENT POSITIONS',futures));

  const errs=[...spot.filter(x=>x.error).map(x=>`SPOT ${x.wallet.name}: ${x.error}`),...futures.filter(x=>x.error).map(x=>`FUTURES ${x.wallet.name}: ${x.error}`)];
  if(errs.length){lines.push('','⚠️ DATA ERRORS');errs.forEach(e=>lines.push(e));}
  lines.push('','📌 Signal logic: Green requires distance to source entry within the entry window plus valid RR/setup; yellow means near but blocked; red means too far and not worth entering.','📌 Health is the trader-level monitoring status; it is separate from the entry status of each current position. A HEALTHY trader can have a RED/TOO-LATE position, and a RISKY/WATCH trader can still have a technically near-entry position.','📌 Spot source entry is reconstructed from on-chain SOL/token balance deltas and is diagnostic, not an exchange fill price. Futures uses the live Hyperliquid position entry and mid price.','📌 No private keys, order placement, leverage changes, SL/TP orders, or execution handoff exist in this engine.',`⏱ Runtime ${((Date.now()-started)/1000).toFixed(1)}s`);
  console.log(`[SIGNAL-ENGINE ${VERSION}][DONE] signals=${green.length} positions=${allPositions.length} errors=${errs.length}`);
  await telegram(lines.join('\n'));
}

main().catch(async e=>{console.error(`[SIGNAL-ENGINE][FATAL] ${e.stack||e}`);await telegram(`🟣 CRYPTO WHALE SIGNAL ENGINE ${VERSION}\n📡 READ-ONLY | NO EXECUTION\n💥 FATAL\n${String(e.message||e).slice(0,1200)}`);process.exitCode=1});
