// CRYPTO WHALE SIGNAL ENGINE V1.6
// READ ONLY: NO ORDERS, NO PRIVATE KEYS, NO EXECUTION.
// Exactly 10 fixed signal sources: 5 Spot + 5 Futures.
// V1.6: stronger Spot BUY reconstruction + conservative Futures copy-entry engine.

const VERSION = 'V1.6-WHALE-SIGNAL-SPOT-REBUILT-FUTURES-QUALITY';
const HL_INFO = process.env.HYPERLIQUID_API_URL || 'https://api.hyperliquid.xyz/info';
const SOL_RPC = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const GECKO = 'https://api.geckoterminal.com/api/v2';
const TG_TOKEN = process.env.TELEGRAM_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '';
const TG_CHAT = process.env.TELEGRAM_CHAT_ID || '';

// Signal policy
const ENTRY_WINDOW_PCT = Number(process.env.SIGNAL_MAX_ENTRY_DISTANCE_PCT || 0.75);
const WATCH_WINDOW_PCT = Number(process.env.SIGNAL_WATCH_DISTANCE_PCT || 3.0);
const MIN_RR = Number(process.env.SIGNAL_MIN_RR || 2.0);
const SL_PCT = Number(process.env.SIGNAL_SPOT_SL_PCT || 2.0);
const TP_PCT = Number(process.env.SIGNAL_SPOT_TP_PCT || 4.0);
const FETCH_TIMEOUT = Number(process.env.SIGNAL_REQUEST_TIMEOUT_MS || 20000);
const RECENT_SIGS = Number(process.env.SIGNAL_SPOT_SIGNATURES || 40);
const MAX_SPOT_POSITIONS = Number(process.env.SIGNAL_MAX_SPOT_POSITIONS_PER_WALLET || 5);
const SPOT_MIN_BUY_USD = Number(process.env.SIGNAL_SPOT_MIN_BUY_USD || 1000);
const SPOT_MAX_BUYS_PER_WALLET = Number(process.env.SIGNAL_SPOT_MAX_BUYS_PER_WALLET || 8);
const SPOT_STALE_HOURS = Number(process.env.SIGNAL_SPOT_STALE_HOURS || 48);
const SPOT_TX_BATCH = Number(process.env.SIGNAL_SPOT_TX_BATCH || 3);
const SPOT_TX_DELAY_MS = Number(process.env.SIGNAL_SPOT_TX_DELAY_MS || 450);
const SPOT_TX_MAX_RETRIES = Number(process.env.SIGNAL_SPOT_TX_MAX_RETRIES || 3);

// Futures quality policy. These are deliberately conservative.
const FUTURES_FRESH_HOURS = Number(process.env.SIGNAL_FUTURES_FRESH_HOURS || 2);
const FUTURES_WATCH_HOURS = Number(process.env.SIGNAL_FUTURES_WATCH_HOURS || 6);
const FUTURES_ATR_INTERVAL = process.env.SIGNAL_FUTURES_ATR_INTERVAL || '15m';
const FUTURES_CANDLE_COUNT = Number(process.env.SIGNAL_FUTURES_CANDLE_COUNT || 96);
const FUTURES_ATR_PERIOD = Number(process.env.SIGNAL_FUTURES_ATR_PERIOD || 14);
const FUTURES_ATR_SL_MULT = Number(process.env.SIGNAL_FUTURES_ATR_SL_MULT || 1.25);
const FUTURES_SWING_LOOKBACK = Number(process.env.SIGNAL_FUTURES_SWING_LOOKBACK || 12);
const FUTURES_SWING_BUFFER_ATR = Number(process.env.SIGNAL_FUTURES_SWING_BUFFER_ATR || 0.25);
const FUTURES_MIN_STOP_PCT = Number(process.env.SIGNAL_FUTURES_MIN_STOP_PCT || 0.35);
const FUTURES_MAX_STOP_PCT = Number(process.env.SIGNAL_FUTURES_MAX_STOP_PCT || 2.5);
const FUTURES_MIN_LIQ_DISTANCE_PCT = Number(process.env.SIGNAL_FUTURES_MIN_LIQ_DISTANCE_PCT || 3.0);
const FUTURES_MIN_RR = Number(process.env.SIGNAL_FUTURES_MIN_RR || 2.0);
const FUTURES_MAX_ADVERSE_PCT = Number(process.env.SIGNAL_FUTURES_MAX_ADVERSE_PCT || 0.75);
const FUTURES_MAX_FAVORABLE_PCT = Number(process.env.SIGNAL_FUTURES_MAX_FAVORABLE_PCT || 1.0);
const FUTURES_FILLS_LOOKBACK_HOURS = Number(process.env.SIGNAL_FUTURES_FILLS_LOOKBACK_HOURS || 24);
const FUTURES_HEALTH_LOOKBACK_DAYS = Number(process.env.SIGNAL_HEALTH_LOOKBACK_DAYS || 30);
const HEALTH_MIN_TRADES = Number(process.env.SIGNAL_HEALTH_MIN_TRADES || 20);
const TG_LIMIT = 3800;

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

const QUOTE_MINTS = new Set([
  'So11111111111111111111111111111111111111112',
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'Es9vMFrzaCERmJfrF4H2FYD4G8xWm7hYq2m7Vx7s9m7'
]);

function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
function short(a){return `${String(a).slice(0,6)}…${String(a).slice(-6)}`}
function n(v,d=0){const x=Number(v);return Number.isFinite(x)?x:d}
function finite(v){if(v===null||v===undefined||v==='')return false;const x=Number(v);return Number.isFinite(x)}
function money(v){return finite(v)?`$${Number(v).toLocaleString('en-US',{maximumFractionDigits:2})}`:'N/A'}
function pct(v,d=2){return finite(v)?`${Number(v).toFixed(d)}%`:'N/A'}
function fmt(v,d=4){return finite(v)?Number(v).toFixed(d):'N/A'}
function rr(risk,reward){return Math.abs(Number(risk))>0?Math.abs(Number(reward))/Math.abs(Number(risk)):0}
function age(ms){if(!ms)return 'N/A';const h=(Date.now()-ms)/3600000;if(h<1)return `${Math.max(1,Math.round(h*60))}m`;return `${h.toFixed(1)}h`}
function clamp(x,a,b){return Math.max(a,Math.min(b,x))}
function sideSign(side){return side==='LONG'?1:-1}
function directionDistance(current,entry,side){return (current/entry-1)*100*sideSign(side)}

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
    try{await fetchJson(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:TG_CHAT,text:text.slice(i,i+TG_LIMIT),disable_web_page_preview:true})},'telegram')}
    catch(e){console.error('[TELEGRAM]',e.message)}
  }
}

// ---------------- SPOT ----------------
async function solSignatures(address){
  const r=await sol({method:'getSignaturesForAddress',params:[address,{limit:RECENT_SIGS}]},'getSignaturesForAddress');
  return Array.isArray(r?.result)?r.result.filter(x=>!x.err):[];
}
async function solTx(sig){
  let last;
  for(let attempt=0;attempt<=SPOT_TX_MAX_RETRIES;attempt++){
    try{
      const r=await sol({method:'getTransaction',params:[sig,{encoding:'jsonParsed',maxSupportedTransactionVersion:0}]},'getTransaction');
      return r?.result||null;
    }catch(e){
      last=e;
      const msg=String(e?.message||e);
      if(!/HTTP_429|Too many requests|429/i.test(msg)||attempt>=SPOT_TX_MAX_RETRIES)break;
      await sleep(Math.min(5000,SPOT_TX_DELAY_MS*Math.pow(2,attempt)));
    }
  }
  throw last||new Error('GET_TRANSACTION_FAILED');
}
function ownerTokenDeltas(tx,wallet){
  const pre=tx?.meta?.preTokenBalances||[], post=tx?.meta?.postTokenBalances||[];
  const map=new Map();
  for(const b of pre){if(String(b.owner||'').toLowerCase()!==wallet.toLowerCase())continue;const mint=b.mint;map.set(`${mint}|pre`,n(b.uiTokenAmount?.uiAmountString))}
  for(const b of post){if(String(b.owner||'').toLowerCase()!==wallet.toLowerCase())continue;const mint=b.mint;map.set(`${mint}|post`,n(b.uiTokenAmount?.uiAmountString))}
  const mints=new Set([...map.keys()].map(k=>k.split('|')[0]));
  return [...mints].map(mint=>({mint,delta:n(map.get(`${mint}|post`))-n(map.get(`${mint}|pre`))})).filter(x=>Math.abs(x.delta)>0);
}
function walletSolDelta(tx,wallet){
  const keys=tx?.transaction?.message?.accountKeys||[];
  const idx=keys.findIndex(k=>String(k?.pubkey||'').toLowerCase()===wallet.toLowerCase());
  if(idx<0)return 0;
  return (n(tx?.meta?.postBalances?.[idx])-n(tx?.meta?.preBalances?.[idx]))/1e9;
}
async function tokenPrice(mint){
  const r=await fetchJson(`${GECKO}/simple/networks/solana/token_price/${mint}`,'', 'tokenPrice');
  return n(r?.data?.attributes?.token_prices?.[mint]);
}
async function tokenInfo(mint){
  try{
    const r=await fetchJson(`${GECKO}/networks/solana/tokens/${mint}`,{},'tokenInfo');
    const a=r?.data?.attributes||{};
    return {symbol:a.symbol||mint.slice(0,6),name:a.name||'',price:n(a.price_usd),fdv:n(a.fdv_usd),volume24h:n(a.volume_usd?.h24),liquidity:n(a.total_reserve_in_usd)};
  }catch{return {symbol:mint.slice(0,6),name:'',price:0,fdv:0,volume24h:0,liquidity:0}}
}
async function solHoldings(address){
  const r=await sol({method:'getTokenAccountsByOwner',params:[address,{programId:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'},{encoding:'jsonParsed'}]},'getTokenAccountsByOwner');
  return (r?.result?.value||[]).map(x=>{const i=x?.account?.data?.parsed?.info||{};return {mint:i.mint,amount:n(i.tokenAmount?.uiAmount),decimals:n(i.tokenAmount?.decimals)}}).filter(x=>x.mint&&x.amount>0);
}

function quoteLegFromTx(tx,wallet,solUsd){
  const deltas=ownerTokenDeltas(tx,wallet);
  const stable=deltas.filter(x=>QUOTE_MINTS.has(x.mint)&&x.delta<0);
  const solDelta=walletSolDelta(tx,wallet);
  const solUsdSpent=solDelta<0?Math.abs(solDelta)*solUsd:0;
  const stableUsd=stable.reduce((a,x)=>a+Math.abs(x.delta)*(x.mint==='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'?1:1),0);
  // Use the largest plausible USD quote leg. Fees can make SOL slightly negative,
  // so SOL is ignored unless the spend is material versus the configured minimum.
  const candidates=[];
  if(solUsdSpent>=SPOT_MIN_BUY_USD*0.10)candidates.push({usd:solUsdSpent,kind:'SOL'});
  if(stableUsd>0)candidates.push({usd:stableUsd,kind:'STABLE'});
  candidates.sort((a,b)=>b.usd-a.usd);
  return candidates[0]||null;
}
async function scanSpot(w){
  const solInfo=await tokenInfo('So11111111111111111111111111111111111111112');
  const solUsd=solInfo.price||await tokenPrice('So11111111111111111111111111111111111111112');
  if(!(solUsd>0))throw new Error('SOL_USD_UNAVAILABLE');
  const [sigs,holdings]=await Promise.all([solSignatures(w.address),solHoldings(w.address)]);
  const txs=[];
  // Fetch in very small batches with retry/backoff. Public Solana RPCs commonly
  // return 429 under bursty getTransaction traffic; a partial scan is preferable
  // to turning the whole cycle into a fatal error.
  let consecutiveFailures=0;
  for(let i=0;i<sigs.length;i+=SPOT_TX_BATCH){
    const batch=sigs.slice(i,i+SPOT_TX_BATCH);
    const got=await Promise.all(batch.map(async s=>{
      try{
        const tx=await solTx(s.signature);
        if(tx){consecutiveFailures=0;return {sig:s.signature,tx,blockTime:n(tx.blockTime||s.blockTime)*1000};}
        consecutiveFailures++;
        return null;
      }catch(e){
        consecutiveFailures++;
        console.log(`[SPOT][TX] ${w.name} ${e.message}`);
        return null;
      }
    }));
    txs.push(...got.filter(Boolean));
    if(consecutiveFailures>=8){
      console.log(`[SPOT][TX] ${w.name} stopping partial history scan after ${consecutiveFailures} consecutive failures`);
      break;
    }
    if(i+SPOT_TX_BATCH<sigs.length)await sleep(SPOT_TX_DELAY_MS);
  }
  const buys=[];
  for(const row of txs){
    const deltas=ownerTokenDeltas(row.tx,w.address);
    const quote=quoteLegFromTx(row.tx,w.address,solUsd);
    if(!quote || quote.usd<SPOT_MIN_BUY_USD)continue;
    for(const d of deltas.filter(x=>x.delta>0&&!QUOTE_MINTS.has(x.mint))){
      const info=await tokenInfo(d.mint);
      const px=info.price||await tokenPrice(d.mint);
      if(!(px>0)||!(d.delta>0))continue;
      const sourceEntry=quote.usd/d.delta;
      if(!(sourceEntry>0))continue;
      const ageHours=(Date.now()-row.blockTime)/3600000;
      buys.push({wallet:w,coin:info.symbol,mint:d.mint,buyAmount:d.delta,quoteUsd:quote.usd,quoteKind:quote.kind,sourceEntry,current:px,distancePct:(px/sourceEntry-1)*100,age:row.blockTime,ageHours,liquidity:info.liquidity,volume24h:info.volume24h,tx:row.sig});
    }
  }
  // Freshest qualifying BUY per mint, then current holdings only.
  const held=new Map(holdings.map(h=>[h.mint,h]));
  const latest=new Map();
  for(const b of buys){if(!held.has(b.mint))continue;const old=latest.get(b.mint);if(!old||b.age>old.age)latest.set(b.mint,b)}
  const candidates=[...latest.values()].sort((a,b)=>a.age-b.age).slice(0,SPOT_MAX_BUYS_PER_WALLET);
  for(const x of candidates){
    x.balance=held.get(x.mint)?.amount||0;
    x.sl=x.sourceEntry*(1-SL_PCT/100); x.tp=x.sourceEntry*(1+TP_PCT/100); x.rr=rr(x.sourceEntry-x.sl,x.tp-x.sourceEntry);
    x.stale=x.ageHours>SPOT_STALE_HOURS;
    x.eligible=!x.stale&&Math.abs(x.distancePct)<=ENTRY_WINDOW_PCT&&x.rr>=MIN_RR;
  }
  const positions=candidates.slice(0,MAX_SPOT_POSITIONS);
  return {wallet:w,signals:positions.filter(x=>x.eligible),positions,scanned:sigs.length,txs:txs.length,holdings:holdings.length,reconstructedBuys:buys.length,partialHistory:txs.length<sigs.length,health:spotHealth(w)};
}

// ---------------- FUTURES ----------------
function hlPositions(state){
  return (state?.assetPositions||[]).map(x=>x?.position||x).filter(p=>p&&Math.abs(n(p.szi))>0).map(p=>({coin:p.coin,side:n(p.szi)>0?'LONG':'SHORT',size:Math.abs(n(p.szi)),entry:n(p.entryPx),positionValue:Math.abs(n(p.positionValue)),unrealized:n(p.unrealizedPnl),leverage:n(p.leverage?.value||p.leverage),liq:n(p.liquidationPx),margin:n(p.marginUsed)}));
}
async function futuresHealth(w){
  try{
    const startTime=Date.now()-FUTURES_HEALTH_LOOKBACK_DAYS*86400000;
    const fills=await hl({type:'userFillsByTime',user:w.address,startTime},`fills:${w.name}`);
    const rows=Array.isArray(fills)?fills:[];
    const pnlRows=rows.map(f=>n(f.closedPnl)).filter(Number.isFinite);
    const wins=pnlRows.filter(v=>v>0).length;
    const realized=pnlRows.reduce((a,b)=>a+b,0);
    const count=pnlRows.length;
    const wr=count?wins/count*100:null;
    const grossWin=pnlRows.filter(v=>v>0).reduce((a,b)=>a+b,0);
    const grossLoss=Math.abs(pnlRows.filter(v=>v<0).reduce((a,b)=>a+b,0));
    const pf=grossLoss>0?grossWin/grossLoss:null;
    const capped=rows.length>=2000;
    let health='WATCH',reason='INSUFFICIENT_OBSERVED_RECENT_DATA';
    if(count>=HEALTH_MIN_TRADES){
      if(realized>0&&wr>=55&&(pf===null||pf>=1.5)){health='HEALTHY';reason='POSITIVE_OBSERVED_PNL+WIN_RATE+PF'}
      else if(realized>0&&wr>=45&&(pf===null||pf>=1.0)){health='WATCH';reason='POSITIVE_BUT_MIXED_OBSERVED_STATS'}
      else{health='RISKY';reason='WEAK_OBSERVED_RECENT_STATS'}
    }
    return {health,reason,realized,count,wr,pf,capped,windowDays:FUTURES_HEALTH_LOOKBACK_DAYS};
  }catch(e){return {health:'WATCH',reason:'HEALTH_DATA_ERROR',error:e.message,realized:null,count:0,wr:null,pf:null,capped:false}}
}
async function futuresFills(w){
  const startTime=Date.now()-FUTURES_FILLS_LOOKBACK_HOURS*3600000;
  const rows=await hl({type:'userFillsByTime',user:w.address,startTime,aggregateByTime:true},`recent-fills:${w.name}`);
  return Array.isArray(rows)?rows:[];
}
function latestPositionAddFill(fills,p){
  const sideOpen=p.side==='LONG'?'Open Long':'Open Short';
  const sign=p.side==='LONG'?1:-1;
  const rows=fills.filter(f=>String(f.coin||'')===String(p.coin)&&n(f.sz)>0);
  const adds=rows.filter(f=>{
    const dir=String(f.dir||'');
    const start=n(f.startPosition);
    const fillSide=String(f.side||'');
    // Explicit Open Long/Open Short is strongest evidence. If dir is absent,
    // use the fill side plus starting position sign conservatively.
    if(dir===sideOpen)return true;
    if(dir.startsWith('Open '))return false;
    if(sign>0&&fillSide==='B'&&start>=0)return true;
    if(sign<0&&fillSide==='A'&&start<=0)return true;
    return false;
  }).sort((a,b)=>n(b.time)-n(a.time));
  return adds[0]||null;
}
function trueRange(c,prevClose){
  const h=n(c.h),l=n(c.l),pc=n(prevClose);
  return Math.max(h-l,Math.abs(h-pc),Math.abs(l-pc));
}
function atr(candles,period){
  if(candles.length<period+1)return 0;
  const trs=[];
  for(let i=1;i<candles.length;i++)trs.push(trueRange(candles[i],candles[i-1].c));
  const slice=trs.slice(-period);
  return slice.reduce((a,b)=>a+b,0)/slice.length;
}
function structureLevels(candles,side,lookback){
  const c=candles.slice(-Math.max(lookback,3));
  const lows=c.map(x=>n(x.l)).filter(v=>v>0);
  const highs=c.map(x=>n(x.h)).filter(v=>v>0);
  return {swingLow:Math.min(...lows),swingHigh:Math.max(...highs)};
}
async function futuresMarketData(coin){
  const end=Date.now();
  const intervalMs=15*60000;
  const start=end-Math.max(FUTURES_CANDLE_COUNT,30)*intervalMs;
  const candles=await hl({type:'candleSnapshot',req:{coin,interval:FUTURES_ATR_INTERVAL,startTime:start,endTime:end}},`candles:${coin}`);
  const rows=(Array.isArray(candles)?candles:[]).filter(c=>n(c.c)>0&&n(c.h)>0&&n(c.l)>0).sort((a,b)=>n(a.t)-n(b.t));
  return rows.slice(-FUTURES_CANDLE_COUNT);
}
function buildFuturesSetup(p,mid,candles,addFill){
  const a=atr(candles,FUTURES_ATR_PERIOD);
  const levels=structureLevels(candles,p.side,FUTURES_SWING_LOOKBACK);
  if(!(a>0))return {ok:false,reason:'ATR_DATA_UNAVAILABLE'};
  const s=sideSign(p.side);
  const rawStructureStop=p.side==='LONG'?levels.swingLow-a*FUTURES_SWING_BUFFER_ATR:levels.swingHigh+a*FUTURES_SWING_BUFFER_ATR;
  const atrStopDistance=a*FUTURES_ATR_SL_MULT;
  const atrStop=p.side==='LONG'?mid-atrStopDistance:mid+atrStopDistance;
  // Use the more protective of structure/ATR while keeping a sane distance.
  let sl=p.side==='LONG'?Math.min(rawStructureStop,atrStop):Math.max(rawStructureStop,atrStop);
  let stopPct=Math.abs((sl/mid-1)*100);
  if(stopPct<FUTURES_MIN_STOP_PCT){
    const d=mid*FUTURES_MIN_STOP_PCT/100; sl=mid-s*d; stopPct=FUTURES_MIN_STOP_PCT;
  }
  if(stopPct>FUTURES_MAX_STOP_PCT)return {ok:false,reason:`STOP_TOO_WIDE>${FUTURES_MAX_STOP_PCT}%`,atr:a,sl,stopPct,levels};
  const risk=Math.abs(mid-sl);
  const tp=mid+s*risk*MIN_RR;
  const R=rr(risk,Math.abs(tp-mid));
  const liqPct=p.liq>0?Math.abs((mid/p.liq-1)*100):null;
  const liqSafe=liqPct===null||liqPct>=FUTURES_MIN_LIQ_DISTANCE_PCT;
  const ageMs=addFill?.time?Date.now()-n(addFill.time):null;
  const ageHours=ageMs===null?null:ageMs/3600000;
  const sourceDist=directionDistance(mid,p.entry,p.side);
  const adverse=sourceDist<0?Math.abs(sourceDist):0;
  const favorable=sourceDist>0?sourceDist:0;
  const fresh=ageHours!==null&&ageHours<=FUTURES_FRESH_HOURS;
  const watchFresh=ageHours!==null&&ageHours<=FUTURES_WATCH_HOURS;
  const near= Math.abs(sourceDist)<=ENTRY_WINDOW_PCT;
  const copyQuality=near&&adverse<=FUTURES_MAX_ADVERSE_PCT&&favorable<=FUTURES_MAX_FAVORABLE_PCT;
  const reasons=[];
  if(ageHours===null)reasons.push('NO_RECENT_ADD_FILL');
  else if(ageHours>FUTURES_WATCH_HOURS)reasons.push(`POSITION_TOO_OLD>${FUTURES_WATCH_HOURS}h`);
  if(Math.abs(sourceDist)>ENTRY_WINDOW_PCT)reasons.push(`SOURCE_DIST>${ENTRY_WINDOW_PCT}%`);
  if(adverse>FUTURES_MAX_ADVERSE_PCT)reasons.push(`ADVERSE_MOVE>${FUTURES_MAX_ADVERSE_PCT}%`);
  if(favorable>FUTURES_MAX_FAVORABLE_PCT)reasons.push(`FAVORABLE_MOVE>${FUTURES_MAX_FAVORABLE_PCT}%`);
  if(!liqSafe)reasons.push(`LIQ_DIST<${FUTURES_MIN_LIQ_DISTANCE_PCT}%`);
  if(R<Math.max(MIN_RR,FUTURES_MIN_RR))reasons.push(`RR<${Math.max(MIN_RR,FUTURES_MIN_RR)}`);
  if(stopPct>FUTURES_MAX_STOP_PCT)reasons.push(`STOP>${FUTURES_MAX_STOP_PCT}%`);
  const eligible=fresh&&copyQuality&&liqSafe&&R>=Math.max(MIN_RR,FUTURES_MIN_RR)&&stopPct<=FUTURES_MAX_STOP_PCT;
  return {ok:true,atr:a,atrPct:a/mid*100,sl,tp,rr:R,stopPct,liqPct,sourceDist,ageHours,addFillTime:addFill?.time||null,addFillPx:n(addFill?.px),reasons,eligible,levels,copyQuality,fresh,watchFresh};
}
async function scanFutures(w){
  const [health,state,mids,recentFills]=await Promise.all([
    futuresHealth(w),
    hl({type:'clearinghouseState',user:w.address},`state:${w.name}`),
    hl({type:'allMids'},`mids:${w.name}`),
    futuresFills(w)
  ]);
  const ps=hlPositions(state); const signals=[],positions=[];
  for(const p of ps){
    const mid=n(mids?.[p.coin]); if(!(mid>0)||!(p.entry>0))continue;
    let candles=[];let marketError='';
    try{candles=await futuresMarketData(p.coin)}catch(e){marketError=e.message}
    const addFill=latestPositionAddFill(recentFills,p);
    const setup=buildFuturesSetup(p,mid,candles,addFill);
    if(!setup.ok){
      positions.push({...p,wallet:w,current:mid,distancePct:directionDistance(mid,p.entry,p.side),eligible:false,setupOk:false,blockReason:setup.reason,ageMs:addFill?.time||null});
      continue;
    }
    if(marketError)setup.reasons.push('CANDLE_FETCH_ERROR');
    const x={wallet:w,coin:p.coin,side:p.side,sourceEntry:p.entry,current:mid,distancePct:setup.sourceDist,sl:setup.sl,tp:setup.tp,rr:setup.rr,size:p.size,positionValue:p.positionValue,unrealized:p.unrealized,leverage:p.leverage,liq:p.liq,margin:p.margin,atr:setup.atr,atrPct:setup.atrPct,stopPct:setup.stopPct,liqDistancePct:setup.liqPct,positionAgeHours:setup.ageHours,positionAgeMs:setup.addFillTime,addFillPx:setup.addFillPx,setupReasons:setup.reasons,eligible:setup.eligible,setupOk:true,marketError,copyQuality:setup.copyQuality,fresh:setup.fresh,watchFresh:setup.watchFresh,swingLow:setup.levels.swingLow,swingHigh:setup.levels.swingHigh};
    positions.push(x);if(x.eligible)signals.push(x);
  }
  return {wallet:w,signals,positions,scanned:ps.length,health};
}

// ---------------- REPORTING ----------------
function spotHealth(w){
  const b=SPOT_HEALTH_BASELINE[w.name]||{};
  if(!finite(b.pnl30d)||!finite(b.wr30d)||!finite(b.trades30d))return {health:'WATCH',reason:'SPOT_HISTORY_NOT_ENOUGH_FOR_DYNAMIC_HEALTH',...b};
  if(b.pnl30d>0&&b.wr30d>=55&&b.trades30d>=HEALTH_MIN_TRADES)return {health:'HEALTHY',reason:'AUDITED_30D_BASELINE',...b};
  if(b.pnl30d>0&&b.wr30d>=40)return {health:'WATCH',reason:'POSITIVE_BUT_MIXED_30D_BASELINE',...b};
  return {health:'RISKY',reason:'WEAK_30D_BASELINE',...b};
}
function healthIcon(h){return h?.health==='HEALTHY'?'🟢':h?.health==='WATCH'?'🟡':'🔴'}
function compactHealth(h){
  const p=[];
  if(finite(h?.realized))p.push(`observed ${money(h.realized)}`); else if(finite(h?.pnl30d))p.push(`30D ${h.pnl30d.toFixed(1)} SOL`);
  if(finite(h?.wr))p.push(`WR ${h.wr.toFixed(1)}%`); else if(finite(h?.wr30d))p.push(`WR ${h.wr30d.toFixed(1)}%`);
  if(finite(h?.pf))p.push(`PF ${h.pf.toFixed(2)}`);
  if(finite(h?.count))p.push(`${h.capped?'observed fills':'fills'} ${h.count}`);
  else if(finite(h?.trades30d))p.push(`trades ${h.trades30d}`);
  return p.join(' | ');
}
function spotSetupReason(x){
  const why=[];
  if(x.stale)why.push(`BUY_AGE>${SPOT_STALE_HOURS}h`);
  if(Math.abs(x.distancePct)>ENTRY_WINDOW_PCT)why.push(`DIST>${ENTRY_WINDOW_PCT}%`);
  if(x.rr<MIN_RR)why.push(`RR<${MIN_RR}`);
  return why;
}
function futuresSetupReason(x){
  const why=[...(x.setupReasons||[])];
  if(x.marketError&&!why.includes('CANDLE_FETCH_ERROR'))why.push('CANDLE_FETCH_ERROR');
  return [...new Set(why)];
}
function distanceAbs(x){return Math.abs(Number(x.distancePct))}
function classifyPosition(x){
  const why=x.mint?spotSetupReason(x):futuresSetupReason(x);
  const dist=distanceAbs(x);
  if(x.mint){
    if(!why.length)return 'GREEN';
    if(dist<=WATCH_WINDOW_PCT)return 'YELLOW';
    return 'RED';
  }
  if(x.eligible&&!why.length)return 'GREEN';
  // Futures stay yellow while the position is recent enough to monitor.
  if(x.watchFresh||((x.positionAgeHours??Infinity)<=FUTURES_WATCH_HOURS&&dist<=WATCH_WINDOW_PCT))return 'YELLOW';
  return 'RED';
}
function signalLine(x,i){
  if(x.mint){
    return `${i}. ${x.wallet.name} | ${x.coin} | LONG\n   BUY ${fmt(x.sourceEntry)} | Now ${fmt(x.current)} | Dist ${pct(x.distancePct)}\n   SL ${fmt(x.sl)} | TP ${fmt(x.tp)} | RR ${fmt(x.rr,2)} | BUY age ${age(x.age)} | Quote ${money(x.quoteUsd)}`;
  }
  return `${i}. ${x.wallet.name} | ${x.coin} | ${x.side}\n   Whale Entry ${fmt(x.sourceEntry)} | Copy Now ${fmt(x.current)} | Dist ${pct(x.distancePct)}\n   SL ${fmt(x.sl)} | TP ${fmt(x.tp)} | RR ${fmt(x.rr,2)} | Add age ${age(x.positionAgeMs)} | ATR ${pct(x.atrPct)}\n   Liq ${fmt(x.liq)} | Liq Dist ${pct(x.liqDistancePct)} | Lev ${fmt(x.leverage,1)}x | Pos ${money(x.positionValue)}`;
}
function blockedLine(x){
  const why=x.mint?spotSetupReason(x):futuresSetupReason(x);
  const cls=classifyPosition(x); const icon=cls==='YELLOW'?'🟡':'🔴';
  const label=cls==='YELLOW'?'WATCH / BLOCKED':'TOO LATE / BLOCKED';
  const agePart=x.mint?`BUY age ${age(x.age)}`:`Add age ${age(x.positionAgeMs)}`;
  return `${icon} ${x.wallet.name} ${x.coin} ${x.side} | now=${fmt(x.current)} | whale=${fmt(x.sourceEntry)} | dist=${pct(x.distancePct)} | ${agePart} | ${label} | BLOCK ${why.length?why.join(','):'NO_VALID_SETUP'}`;
}
function positionDetailLine(x){
  const cls=classifyPosition(x); const icon=cls==='GREEN'?'🟢':cls==='YELLOW'?'🟡':'🔴';
  const label=cls==='GREEN'?'ENTRY READY':cls==='YELLOW'?'NEAR / BLOCKED':'TOO LATE';
  const why=x.mint?spotSetupReason(x):futuresSetupReason(x);
  const base=`${icon} ${x.coin} ${x.side} | Now ${fmt(x.current)} | Entry ${fmt(x.sourceEntry)} | Dist ${pct(x.distancePct)} | SL ${fmt(x.sl)} | TP ${fmt(x.tp)} | RR ${fmt(x.rr,2)}`;
  if(x.mint)return `${base} | BUY age ${age(x.age)} | ${label}${cls==='GREEN'?'':' | BLOCK '+(why.length?why.join(','):'NO_VALID_SETUP')}`;
  return `${base} | Add age ${age(x.positionAgeMs)} | ATR ${pct(x.atrPct)} | LiqDist ${pct(x.liqDistancePct)} | Lev ${fmt(x.leverage,1)}x | Pos ${money(x.positionValue)} | uPnL ${money(x.unrealized)} | ${label}${cls==='GREEN'?'':' | BLOCK '+(why.length?why.join(','):'NO_VALID_SETUP')}`;
}
function traderBlock(result){
  const h=result.health||{health:'WATCH',reason:'NO_HEALTH_DATA'};
  const header=`${healthIcon(h)} ${result.wallet.name} — ${h.health}${compactHealth(h)?' | '+compactHealth(h):''} | ${h.reason}`;
  const ps=result.positions||[];
  if(!ps.length)return [header+' | Position: NONE'];
  return [header,...ps.map(x=>'   '+positionDetailLine(x))];
}
function marketSection(title,results){
  const rows=[title,'━━━━━━━━━━━━━━━━━━'];
  results.forEach(r=>rows.push(...traderBlock(r)));
  return rows;
}

async function main(){
  const started=Date.now();
  console.log(`[SIGNAL-ENGINE ${VERSION}][START] spot=${SPOT_WALLETS.length} futures=${FUTURES_WALLETS.length}`);
  const spot=await Promise.all(SPOT_WALLETS.map(w=>scanSpot(w).catch(e=>({wallet:w,signals:[],positions:[],error:e.message,scanned:0,txs:0,reconstructedBuys:0,health:spotHealth(w)}))));
  const futures=await Promise.all(FUTURES_WALLETS.map(w=>scanFutures(w).catch(e=>({wallet:w,signals:[],positions:[],error:e.message,scanned:0,health:{health:'WATCH',reason:'HEALTH_DATA_ERROR',error:e.message}}))));
  const allPositions=[...spot.flatMap(x=>x.positions),...futures.flatMap(x=>x.positions)];
  const classified=allPositions.map(x=>({...x,status:classifyPosition(x)}));
  const green=classified.filter(x=>x.status==='GREEN'),yellow=classified.filter(x=>x.status==='YELLOW'),red=classified.filter(x=>x.status==='RED');
  const spotGreen=green.filter(x=>x.mint), futuresGreen=green.filter(x=>!x.mint);
  const spotYellow=yellow.filter(x=>x.mint), futuresYellow=yellow.filter(x=>!x.mint);
  const spotRed=red.filter(x=>x.mint), futuresRed=red.filter(x=>!x.mint);
  const lines=[
    `🟣 CRYPTO WHALE SIGNAL ENGINE ${VERSION}`,
    '📡 READ-ONLY | NO ORDERS | NO EXECUTION',
    '━━━━━━━━━━━━━━━━━━',
    `🕐 Cycle: ${new Date().toISOString()}`,
    `🎯 Sources: SPOT ${SPOT_WALLETS.length}/5 | FUTURES ${FUTURES_WALLETS.length}/5`,
    `🔎 Exact scans: ${spot.filter(x=>!x.error).length}/5 Spot | ${futures.filter(x=>!x.error).length}/5 Futures`,
    `🟢 ENTRY READY: ${green.length} | 🟡 WATCH/BLOCKED: ${yellow.length} | 🔴 TOO LATE: ${red.length}`,
    `📏 Spot green ≤${ENTRY_WINDOW_PCT}% | Futures green ≤${ENTRY_WINDOW_PCT}% + fresh ≤${FUTURES_FRESH_HOURS}h + RR≥${Math.max(MIN_RR,FUTURES_MIN_RR)}`,
    '',
    '🟢 COPY / ENTRY READY — SPOT','━━━━━━━━━━━━━━━━━━'
  ];
  if(spotGreen.length)spotGreen.forEach((x,i)=>lines.push(signalLine(x,i+1)));else lines.push('No Spot entry opportunity right now.');
  lines.push('','🟢 COPY ENTRY READY — FUTURES','━━━━━━━━━━━━━━━━━━');
  if(futuresGreen.length)futuresGreen.forEach((x,i)=>lines.push(signalLine(x,i+1)));else lines.push('No Futures copy-entry opportunity right now.');
  lines.push('','🟡 WATCH / BLOCKED — SPOT');
  if(spotYellow.length)spotYellow.forEach(x=>lines.push('• '+blockedLine(x)));else lines.push('No Spot near-entry blocked positions.');
  lines.push('','🟡 WATCH / BLOCKED — FUTURES');
  if(futuresYellow.length)futuresYellow.forEach(x=>lines.push('• '+blockedLine(x)));else lines.push('No Futures recent/watchable positions.');
  lines.push('','🔴 TOO LATE / BLOCKED — SPOT');
  if(spotRed.length)spotRed.forEach(x=>lines.push('• '+blockedLine(x)));else lines.push('No Spot positions are too far/stale.');
  lines.push('','🔴 TOO LATE / BLOCKED — FUTURES');
  if(futuresRed.length)futuresRed.forEach(x=>lines.push('• '+blockedLine(x)));else lines.push('No Futures positions are too old/unsafe.');
  lines.push('',...marketSection('🏥 SPOT TRADER HEALTH + CURRENT POSITIONS',spot));
  lines.push('',...marketSection('🏥 FUTURES TRADER HEALTH + CURRENT POSITIONS',futures));
  const spotRecon=spot.reduce((a,x)=>a+n(x.reconstructedBuys),0);
  lines.push('',`🧩 Spot BUY reconstruction: ${spotRecon} qualifying quote-backed BUY candidates observed this cycle.`);
  const errs=[...spot.filter(x=>x.error).map(x=>`SPOT ${x.wallet.name}: ${x.error}`),...futures.filter(x=>x.error).map(x=>`FUTURES ${x.wallet.name}: ${x.error}`)];
  if(errs.length){lines.push('','⚠️ DATA ERRORS');errs.forEach(e=>lines.push(e));}
  lines.push('',
    '📌 Futures V1.6: current position entry is NOT sufficient for a green signal. A green copy-entry needs a recent position-adding fill, small source-distance, volatility/structure-based SL, RR, and safe liquidation distance.',
    '📌 Position age is inferred from the latest observed position-adding fill; if no reliable recent add is found, the position cannot become GREEN.',
    '📌 Futures health is based on OBSERVED fills. Hyperliquid limits userFillsByTime responses, so a capped result is not presented as a complete 30D history.',
    '📌 Spot source entry is reconstructed only when a token BUY is paired with a material SOL/stablecoin quote spend in the same transaction and the token is still held.',
    '📌 No private keys, order placement, leverage changes, SL/TP orders, or execution handoff exist in this engine.',
    `⏱ Runtime ${((Date.now()-started)/1000).toFixed(1)}s`
  );
  console.log(`[SIGNAL-ENGINE ${VERSION}][DONE] signals=${green.length} positions=${allPositions.length} errors=${errs.length}`);
  await telegram(lines.join('\n'));
}

main().catch(async e=>{console.error(`[SIGNAL-ENGINE][FATAL] ${e.stack||e}`);await telegram(`🟣 CRYPTO WHALE SIGNAL ENGINE ${VERSION}\n📡 READ-ONLY | NO EXECUTION\n💥 FATAL\n${String(e.message||e).slice(0,1200)}`);process.exitCode=1});
