// CRYPTO SIGNAL ENGINE V1.0
// READ ONLY: NO ORDERS, NO PRIVATE KEYS, NO EXECUTION ENGINE.
// Exactly 10 fixed signal sources: 5 Spot + 5 Futures.
// Telegram report is emitted every workflow cycle (intended every 5 minutes).

const VERSION = 'V1.8.1-WHALE-SIGNAL-RPC-RESILIENCE-DATA-INTEGRITY';
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
const RECENT_SIGS = Number(process.env.SIGNAL_SPOT_SIGNATURES || 60);
const SPOT_MIN_BUY_USD = Number(process.env.SIGNAL_SPOT_MIN_BUY_USD || 1000);
const SPOT_STALE_HOURS = Number(process.env.SIGNAL_SPOT_STALE_HOURS || 48);
const SPOT_BATCH_SIZE = Number(process.env.SIGNAL_SPOT_TX_BATCH || 1);
const SPOT_BATCH_DELAY_MS = Number(process.env.SIGNAL_SPOT_BATCH_DELAY_MS || 650);
const SPOT_RPC_RETRIES = Number(process.env.SIGNAL_SPOT_RPC_RETRIES || 2);
const SPOT_429_COOLDOWN_MS = Number(process.env.SIGNAL_SPOT_429_COOLDOWN_MS || 5000);
const SPOT_MAX_TX_REQUESTS = Number(process.env.SIGNAL_SPOT_MAX_TX_REQUESTS || 36);
const FUTURES_FRESH_HOURS = Number(process.env.SIGNAL_FUTURES_FRESH_HOURS || 2);
const FUTURES_WATCH_HOURS = Number(process.env.SIGNAL_FUTURES_WATCH_HOURS || 6);
const FUTURES_MAX_SOURCE_DIST = Number(process.env.SIGNAL_FUTURES_COPY_MAX_SOURCE_DIST_PCT || 1.25);
const FUTURES_MAX_FAVORABLE = Number(process.env.SIGNAL_FUTURES_COPY_MAX_FAVORABLE_PCT || 1.5);
const FUTURES_MAX_ADVERSE = Number(process.env.SIGNAL_FUTURES_COPY_MAX_ADVERSE_PCT || 1);
const FUTURES_MIN_LIQ_DIST = Number(process.env.SIGNAL_FUTURES_MIN_LIQ_DIST_PCT || 3);
const FUTURES_FILL_LOOKBACK_HOURS = Number(process.env.SIGNAL_FUTURES_FILL_LOOKBACK_HOURS || 168);
const MAX_SPOT_POSITIONS = Number(process.env.SIGNAL_MAX_SPOT_POSITIONS_PER_WALLET || 4);
const TG_LIMIT = 3800;
const HEALTH_LOOKBACK_DAYS = Number(process.env.SIGNAL_HEALTH_LOOKBACK_DAYS || 30);
const HEALTH_MIN_TRADES = Number(process.env.SIGNAL_HEALTH_MIN_TRADES || 20);

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
function n(v,d=0){const x=Number(v);return Number.isFinite(x)?x:d}
function money(v){return Number.isFinite(Number(v))?`$${Number(v).toLocaleString('en-US',{maximumFractionDigits:2})}`:'N/A'}
function pct(v,d=2){return Number.isFinite(Number(v))?`${Number(v).toFixed(d)}%`:'N/A'}
function fmt(v,d=4){return Number.isFinite(Number(v))?Number(v).toFixed(d):'N/A'}
function rr(sl,tp){const a=Math.abs(Number(sl));return a>0?Math.abs(Number(tp))/a:0}
function age(ms){if(!ms)return 'N/A';const h=(Date.now()-ms)/3600000;return h<1?`${Math.max(1,Math.round(h*60))}m`:`${h.toFixed(1)}h`}

let solCooldownUntil = 0;
async function fetchJson(url, options={}, label='request', retries=0){
  let last;
  for(let attempt=0;attempt<=retries;attempt++){
    const ctl=new AbortController(); const timer=setTimeout(()=>ctl.abort(),FETCH_TIMEOUT);
    try{
      const r=await fetch(url,{...options,signal:ctl.signal,headers:{'accept':'application/json',...(options.headers||{})}});
      const text=await r.text();
      if(!r.ok){
        const err=new Error(`${label}:HTTP_${r.status}:${text.slice(0,180)}`); err.status=r.status;
        const retryAfter=Number(r.headers.get('retry-after'));
        if(r.status===429 && retryAfter>0) err.retryAfterMs=Math.min(15000,retryAfter*1000);
        throw err;
      }
      return text?JSON.parse(text):null;
    }catch(e){
      last=e;
      if(attempt<retries){
        const base=e.status===429 ? (e.retryAfterMs||SPOT_429_COOLDOWN_MS) : 500*Math.pow(2,attempt);
        await sleep(Math.min(15000,base));
      }
    }finally{clearTimeout(timer)}
  }
  throw last;
}
async function hl(body,label='hl'){return fetchJson(HL_INFO,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)},label,2)}
async function sol(body,label='solana'){
  if(Date.now()<solCooldownUntil) await sleep(solCooldownUntil-Date.now());
  try{
    return await fetchJson(SOL_RPC,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:Date.now(),...body})},label,SPOT_RPC_RETRIES);
  }catch(e){
    if(e?.status===429) solCooldownUntil=Date.now()+SPOT_429_COOLDOWN_MS;
    throw e;
  }
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
function quoteSpentFromTx(tx,wallet,solUsd){
  const tokenD=ownerTokenDeltas(tx,wallet);
  const keys=tx?.transaction?.message?.accountKeys||[];
  const idx=keys.findIndex(k=>String(k?.pubkey||'').toLowerCase()===wallet.toLowerCase()&&k?.signer);
  let best=0,quote='';
  if(idx>=0){
    const sd=(n(tx?.meta?.postBalances?.[idx])-n(tx?.meta?.preBalances?.[idx]))/1e9;
    if(sd<0){best=Math.abs(sd)*solUsd;quote='SOL'}
  }
  for(const d of tokenD){
    if(d.delta>=0)continue;
    if(d.mint==='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' ||
       d.mint==='Es9vMFrzaCERmJfrF4H2FYD4G8xWm7hYq2m7Vx7s9m7'){
      const usd=Math.abs(d.delta);
      if(usd>best){best=usd;quote=d.mint}
    }
  }
  return {usd:best,quote};
}
async function scanSpot(w){
  const SOL='So11111111111111111111111111111111111111112';
  const solInfo=await tokenInfo(SOL);
  const solUsd=solInfo.price||await tokenPrice(SOL);
  const [sigs,holdings]=await Promise.all([solSignatures(w.address),solHoldings(w.address)]);
  const held=new Set(holdings.filter(x=>x.amount>0&&x.mint!==SOL).map(x=>x.mint));
  const latestBuys=new Map();
  const infoCache=new Map();
  let txs=0, requests=0, partial=false, dataError=null;
  for(let i=0;i<sigs.length && requests<Math.min(RECENT_SIGS,SPOT_MAX_TX_REQUESTS);i+=SPOT_BATCH_SIZE){
    const batch=sigs.slice(i,i+SPOT_BATCH_SIZE);
    for(const sig of batch){
      if(requests>=SPOT_MAX_TX_REQUESTS)break;
      requests++;
      try{
        const tx=await solTx(sig.signature);
        if(!tx)continue;
        txs++;
        const blockTime=n(tx.blockTime||sig.blockTime)*1000;
        if(blockTime && Date.now()-blockTime>SPOT_STALE_HOURS*3600000){ i=sigs.length; break; }
        const deltas=ownerTokenDeltas(tx,w.address);
        for(const d of deltas){
          if(!held.has(d.mint)||d.delta<=0)continue;
          const q=quoteSpentFromTx(tx,w.address,solUsd);
          if(q.usd<SPOT_MIN_BUY_USD)continue;
          const entry=q.usd/d.delta;
          const prev=latestBuys.get(d.mint);
          if(!prev || blockTime>prev.blockTime) latestBuys.set(d.mint,{sig:sig.signature,tx,blockTime,delta:d.delta,q,entry});
        }
        if(latestBuys.size>=held.size) break;
      }catch(e){
        console.log(`[SPOT][TX] ${w.name} ${e.message}`);
        if(e?.status===429){partial=true;dataError='SOLANA_RPC_429';break;}
      }
    }
    if(partial || latestBuys.size>=held.size)break;
    await sleep(SPOT_BATCH_DELAY_MS);
  }
  if(requests>=SPOT_MAX_TX_REQUESTS && latestBuys.size<held.size) partial=true;
  const getInfo=async mint=>{if(!infoCache.has(mint))infoCache.set(mint,tokenInfo(mint));return infoCache.get(mint)};
  const positions=[];
  for(const h of holdings.filter(x=>x.amount>0).slice(0,40)){
    if(h.mint===SOL)continue;
    const buy=latestBuys.get(h.mint); if(!buy)continue;
    const buyAge=(Date.now()-buy.blockTime)/3600000;
    if(buyAge<0||buyAge>SPOT_STALE_HOURS)continue;
    const info=await getInfo(h.mint), px=info.price||await tokenPrice(h.mint); if(!(px>0))continue;
    const dist=(px/buy.entry-1)*100;
    const sl=buy.entry*(1-SL_PCT/100),tp=buy.entry*(1+TP_PCT/100),R=rr(buy.entry-sl,tp-buy.entry);
    positions.push({wallet:w,market:'SPOT',coin:info.symbol,mint:h.mint,side:'LONG',sourceEntry:buy.entry,current:px,distancePct:dist,sl,tp,rr:R,buyTime:buy.blockTime,buyAgeHours:buyAge,quoteUsd:buy.q.usd,quote:buy.q.quote,tx:buy.sig,eligible:Math.abs(dist)<=ENTRY_WINDOW_PCT&&R>=MIN_RR});
    if(positions.length>=MAX_SPOT_POSITIONS)break;
  }
  return {wallet:w,signals:positions.filter(x=>x.eligible),positions,scanned:sigs.length,txs,holdings:holdings.length,health:spotHealth(w),partial,dataError,requests};
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

async function openingTimes(w, positions){
  const out=new Map();
  try{
    const startTime=Date.now()-FUTURES_FILL_LOOKBACK_HOURS*3600000;
    const fills=await hl({type:'userFillsByTime',user:w.address,startTime},`fills:${w.name}`);
    const rows=Array.isArray(fills)?fills:[];
    for(const p of positions){
      const want=p.side==='LONG'?'open long':'open short';
      const ts=rows.filter(f=>String(f.coin||'').toUpperCase()===String(p.coin).toUpperCase() && String(f.dir||'').toLowerCase().includes(want)).map(f=>n(f.time)).filter(x=>x>0);
      out.set(p.coin,ts.length?Math.max(...ts):null);
    }
    return {times:out,rows:rows.length,error:null};
  }catch(e){
    for(const p of positions) out.set(p.coin,null);
    return {times:out,rows:0,error:e.message};
  }
}
async function scanFutures(w){
  let health={health:'WATCH',reason:'UNAVAILABLE'};
  try{health=await futuresHealth(w);}catch(e){health={health:'WATCH',reason:'HEALTH_DATA_ERROR',error:e.message};}
  let state,mids;
  try{state=await hl({type:'clearinghouseState',user:w.address},`state:${w.name}`);}catch(e){return {wallet:w,signals:[],positions:[],scanned:0,health,error:`STATE_DATA_ERROR:${e.message}`,dataError:'HYPERLIQUID_STATE'};}
  try{mids=await hl({type:'allMids'},`mids:${w.name}`);}catch(e){return {wallet:w,signals:[],positions:[],scanned:0,health,error:`MIDS_DATA_ERROR:${e.message}`,dataError:'HYPERLIQUID_MIDS'};}
  const ps=hlPositions(state), positions=[], signals=[];
  const ot=await openingTimes(w,ps);
  for(const p of ps){
    const mid=n(mids?.[p.coin]);if(!(mid>0)||!(p.entry>0))continue;
    const dist=(mid/p.entry-1)*100*(p.side==='LONG'?1:-1);
    const addTime=ot.times.get(p.coin)||null, addAgeHours=addTime?(Date.now()-addTime)/3600000:null;
    const sl=p.side==='LONG'?p.entry*(1-HL_SL_PCT/100):p.entry*(1+HL_SL_PCT/100),tp=p.side==='LONG'?p.entry*(1+HL_TP_PCT/100):p.entry*(1-HL_TP_PCT/100);
    const R=rr(Math.abs(p.entry-sl),Math.abs(tp-p.entry)),liqDist=finite(p.liq)?Math.abs(mid-p.liq)/mid*100:null,reasons=[];
    if(addAgeHours===null)reasons.push(ot.error?'OPEN_TIME_DATA_ERROR':'OPEN_TIME_UNKNOWN');
    else if(addAgeHours>FUTURES_WATCH_HOURS)reasons.push(`POSITION_OLD>${FUTURES_WATCH_HOURS}h`);
    if(Math.abs(dist)>FUTURES_MAX_SOURCE_DIST)reasons.push(`SOURCE_DIST>${FUTURES_MAX_SOURCE_DIST}%`);
    if(dist>FUTURES_MAX_FAVORABLE)reasons.push(`FAVORABLE_MOVE>${FUTURES_MAX_FAVORABLE}%`);
    if(dist<-FUTURES_MAX_ADVERSE)reasons.push(`ADVERSE_MOVE>${FUTURES_MAX_ADVERSE}%`);
    if(liqDist!==null&&liqDist<FUTURES_MIN_LIQ_DIST)reasons.push(`LIQ_DIST<${FUTURES_MIN_LIQ_DIST}%`);
    if(R<MIN_RR)reasons.push(`RR<${MIN_RR}`);
    const eligible=addAgeHours!==null&&addAgeHours<=FUTURES_FRESH_HOURS&&reasons.length===0;
    const x={wallet:w,market:'FUTURES',coin:p.coin,side:p.side,sourceEntry:p.entry,current:mid,distancePct:dist,sl,tp,rr:R,liq:p.liq,liqDist,leverage:p.leverage,positionValue:p.positionValue,unrealized:p.unrealized,addTime,addAgeHours,reasons,eligible};
    positions.push(x);if(eligible)signals.push(x);
  }
  return {wallet:w,signals,positions,scanned:1,health,dataError:ot.error?'HYPERLIQUID_FILL_DATA':null,openingRows:ot.rows};
}

function compactSignal(x){
  const age=x.market==='SPOT'?ageText(x.buyTime):ageText(x.addTime);
  return [
    `${x.wallet.name} — ${x.coin} ${x.side}`,
    `Entry ${fmt(x.sourceEntry)} | Now ${fmt(x.current)} | Dist ${pct(x.distancePct)}`,
    `SL ${fmt(x.sl)} | TP ${fmt(x.tp)} | RR ${fmt(x.rr,2)} | Age ${age}`,
    x.market==='SPOT'?`BUY ${money(x.quoteUsd)}`:''
  ].filter(Boolean);
}
function watchLine(x){
  const why=x.reasons?.length?x.reasons.join(','):'WAIT_FOR_VALID_FRESH_ENTRY';
  return `${x.wallet.name} ${x.coin} ${x.side} | Dist ${pct(x.distancePct)} | ${why}`;
}
function traderHealthShort(r){
  const h=r.health||{},icon=h.health==='HEALTHY'?'🟢':h.health==='WATCH'?'🟡':'🔴';
  return `${icon}${r.wallet.name}`;
}
async function main(){
  const started=Date.now();
  const spot=await Promise.all(SPOT_WALLETS.map(w=>scanSpot(w).catch(e=>({wallet:w,signals:[],positions:[],error:e.message,scanned:0,health:spotHealth(w)}))));
  const futures=await Promise.all(FUTURES_WALLETS.map(w=>scanFutures(w).catch(e=>({wallet:w,signals:[],positions:[],error:e.message,scanned:0,health:{health:'WATCH'}}))));
  const all=[...spot.flatMap(x=>x.positions),...futures.flatMap(x=>x.positions)];
  const green=all.filter(x=>x.eligible);
  const yellow=all.filter(x=>!x.eligible&&Math.abs(Number(x.distancePct))<=WATCH_WINDOW_PCT);
  const red=all.filter(x=>!x.eligible&&Math.abs(Number(x.distancePct))>WATCH_WINDOW_PCT);
  const sg=green.filter(x=>x.market==='SPOT'),fg=green.filter(x=>x.market==='FUTURES');
  const sy=yellow.filter(x=>x.market==='SPOT').slice(0,3),fy=yellow.filter(x=>x.market==='FUTURES').slice(0,3);
  const lines=[
    `🟣 CRYPTO WHALE SIGNAL ENGINE ${VERSION}`,
    '📡 READ-ONLY | 5 SPOT + 5 FUTURES',
    '━━━━━━━━━━━━━━━━━━',
    `🕐 ${new Date().toISOString()}`,
    `🟢 COPY NOW: ${green.length} | 🟡 WATCH: ${yellow.length} | 🔴 NO ENTRY: ${red.length}`,
    '',
    '🟢 COPY NOW','━━━━━━━━━━━━━━━━━━'
  ];
  if(green.length){
    if(sg.length){lines.push('SPOT');sg.slice(0,5).forEach(x=>{lines.push(...compactSignal(x),'')})}
    if(fg.length){lines.push('FUTURES');fg.slice(0,5).forEach(x=>{lines.push(...compactSignal(x),'')})}
  }else lines.push('No valid fresh copy opportunity.');
  lines.push('🟡 WATCH','━━━━━━━━━━━━━━━━━━');
  if(sy.length){lines.push('SPOT');sy.forEach(x=>lines.push(watchLine(x)))}
  if(fy.length){lines.push('FUTURES');fy.forEach(x=>lines.push(watchLine(x)))}
  if(!sy.length&&!fy.length)lines.push('No near-entry setups.');
  lines.push('','🏥 TRADERS','━━━━━━━━━━━━━━━━━━',
    'SPOT  '+spot.map(traderHealthShort).join('  '),
    'FUT    '+futures.map(traderHealthShort).join('  '));
  const errs=[...spot.filter(x=>x.error||x.partial||x.dataError).map(x=>`SPOT ${x.wallet.name}${x.dataError?` (${x.dataError})`:''}`),...futures.filter(x=>x.error||x.dataError).map(x=>`FUTURES ${x.wallet.name}${x.dataError?` (${x.dataError})`:''}`)];
  if(errs.length)lines.push('',`⚠️ DATA INCOMPLETE: ${errs.join(', ')}`);
  const spotOk=spot.filter(x=>!x.error&&!x.partial).length, futOk=futures.filter(x=>!x.error&&!x.dataError).length;
  lines.splice(4,0,`📊 DATA: Spot ${spotOk}/5 complete | Futures ${futOk}/5 complete`);
  lines.push('',`⏱ Runtime ${((Date.now()-started)/1000).toFixed(1)}s`);
  console.log(`[SIGNAL-ENGINE ${VERSION}][DONE] green=${green.length} watch=${yellow.length} red=${red.length}`);
  await telegram(lines.join('\\n'));
}
main().catch(async e=>{
  console.error(`[SIGNAL-ENGINE][FATAL] ${e.stack||e}`);
  await telegram(`🟣 CRYPTO WHALE SIGNAL ENGINE ${VERSION}\\n💥 FATAL\\n${String(e.message||e).slice(0,1000)}`);
  process.exitCode=1;
});
