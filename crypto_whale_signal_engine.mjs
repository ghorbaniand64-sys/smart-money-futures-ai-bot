// CRYPTO SIGNAL ENGINE V1.0
// READ ONLY: NO ORDERS, NO PRIVATE KEYS, NO EXECUTION ENGINE.
// Exactly 10 fixed signal sources: 5 Spot + 5 Futures.
// Telegram report is emitted every workflow cycle (intended every 5 minutes).

const VERSION = 'V2.0-WHALE-SIGNAL-SPOT-RECENT-BUY';
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
const MAX_SPOT_POSITIONS = Number(process.env.SIGNAL_MAX_SPOT_POSITIONS_PER_WALLET || 4);
const SPOT_ACTIVITY_LOOKBACK_MIN = Number(process.env.SIGNAL_SPOT_ACTIVITY_LOOKBACK_MIN || 15);
const SPOT_ULTRA_SHORT_ENABLED = String(process.env.SIGNAL_SPOT_ULTRA_SHORT_ENABLED || 'true').toLowerCase() !== 'false';
const SPOT_MIN_BUY_USD = Number(process.env.SIGNAL_SPOT_MIN_BUY_USD || 25);
const SPOT_MAX_ACTIVITY_AGE_MIN = Number(process.env.SIGNAL_SPOT_MAX_ACTIVITY_AGE_MIN || SPOT_ACTIVITY_LOOKBACK_MIN);
const SPOT_ACTIVITY_WATCH_PCT = Number(process.env.SIGNAL_SPOT_ACTIVITY_WATCH_PCT || 3.0);
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
function walletNativeDelta(tx,wallet){
  const keys=tx?.transaction?.message?.accountKeys||[];
  const idx=keys.findIndex(k=>String(k?.pubkey||'').toLowerCase()===String(wallet||'').toLowerCase());
  if(idx<0)return 0;
  return (n(tx?.meta?.postBalances?.[idx])-n(tx?.meta?.preBalances?.[idx]))/1e9;
}
function walletWsolDelta(tx,wallet){
  const WSOL='So11111111111111111111111111111111111111112';
  const ds=ownerTokenDeltas(tx,wallet);
  return n(ds.find(x=>x.mint===WSOL)?.delta);
}
function solDelta(tx){
  const keys=tx?.transaction?.message?.accountKeys||[];
  const wallet=keys.find(k=>k?.signer);
  return walletNativeDelta(tx,wallet?.pubkey);
}
function swapFunding(tx,wallet){
  const native=walletNativeDelta(tx,wallet);
  const wsol=walletWsolDelta(tx,wallet);
  // For a SOL/USDC/etc spot buy, either native SOL or wrapped SOL can be the
  // funding leg. Prefer the larger negative funding leg and ignore tiny fees.
  const candidates=[native<0?Math.abs(native):0,wsol<0?Math.abs(wsol):0];
  const fundedSol=Math.max(...candidates,0);
  return {nativeDelta:native,wsolDelta:wsol,fundedSol,isBuy:fundedSol>0};
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
  const now=Date.now(), maxAgeMs=SPOT_MAX_ACTIVITY_AGE_MIN*60000;

  // Recent signatures are fetched newest-first. Stop parsing once the remaining
  // signatures are older than the ultra-short activity window.
  for(const s of sigs.slice(0,RECENT_SIGS)){
    const bt=n(s.blockTime)*1000;
    if(bt>0 && now-bt>maxAgeMs && txs.length>0) break;
    try{
      const tx=await solTx(s.signature);
      if(tx){
        const blockTime=n(tx.blockTime||s.blockTime)*1000;
        if(!blockTime || now-blockTime<=maxAgeMs)txs.push({sig:s.signature,tx,blockTime});
      }
    }catch(e){console.log(`[SPOT][TX] ${w.name} ${e.message}`)}
  }

  const candidates=[];
  const seen=new Set();

  // V2.0: Spot signal authority is RECENT BUY ACTIVITY, not current holdings.
  // This is essential for ultra-short wallets that buy and close before the
  // next 5-minute cycle. Funding may be native SOL or wrapped SOL (WSOL).
  if(SPOT_ULTRA_SHORT_ENABLED){
    for(const row of txs){
      if(!(row.blockTime>0) || now-row.blockTime>maxAgeMs)continue;
      const funding=swapFunding(row.tx,w.address);
      if(!funding.isBuy)continue;

      const received=ownerTokenDeltas(row.tx,w.address).filter(d=>d.delta>0 && d.mint!=='So11111111111111111111111111111111111111112');
      if(!received.length)continue;

      for(const d of received){
        if(seen.has(d.mint))continue;
        const info=await tokenInfo(d.mint);
        const px=info.price||await tokenPrice(d.mint);
        if(!(px>0)||!(d.delta>0)||!(solUsd>0))continue;

        const sourceEntry=(funding.fundedSol*solUsd)/d.delta;
        if(!(sourceEntry>0))continue;
        const notional=sourceEntry*d.delta;
        if(notional<SPOT_MIN_BUY_USD)continue;

        const dist=(px/sourceEntry-1)*100;
        const sl=sourceEntry*(1-SL_PCT/100);
        const tp=sourceEntry*(1+TP_PCT/100);
        const R=rr(sourceEntry-sl,tp-sourceEntry);
        const ageMin=Math.max(0,(now-row.blockTime)/60000);
        const x={
          wallet:w,coin:info.symbol,mint:d.mint,side:'LONG',
          balance:holdings.find(h=>h.mint===d.mint)?.amount||0,
          sourceEntry,current:px,distancePct:dist,sl,tp,rr:R,
          age:row.blockTime,ageMin,liquidity:info.liquidity,volume24h:info.volume24h,
          tx:row.sig,buyNotionalUsd:notional,activitySource:'RECENT_BUY',
          fundingSol:funding.fundedSol,nativeSolDelta:funding.nativeDelta,wsolDelta:funding.wsolDelta,
          eligible:Math.abs(dist)<=ENTRY_WINDOW_PCT&&R>=MIN_RR
        };
        candidates.push(x); seen.add(d.mint);
        if(candidates.length>=MAX_SPOT_POSITIONS)break;
      }
      if(candidates.length>=MAX_SPOT_POSITIONS)break;
    }
  }

  // Fallback: if no recent BUY was decoded, inspect current holdings so the
  // engine still has a diagnostic signal for slower spot traders.
  if(!candidates.length){
    for(const h of holdings.slice(0,20)){
      const row=txs.find(r=>ownerTokenDeltas(r.tx,w.address).some(d=>d.mint===h.mint&&d.delta>0));
      if(!row)continue;
      const d=ownerTokenDeltas(row.tx,w.address).find(x=>x.mint===h.mint&&x.delta>0);
      const funding=swapFunding(row.tx,w.address);
      if(!funding.isBuy || !(d?.delta>0))continue;
      const info=await tokenInfo(h.mint); const px=info.price||await tokenPrice(h.mint); if(!(px>0))continue;
      const sourceEntry=(funding.fundedSol*solUsd)/d.delta; if(!(sourceEntry>0))continue;
      const dist=(px/sourceEntry-1)*100;
      const sl=sourceEntry*(1-SL_PCT/100),tp=sourceEntry*(1+TP_PCT/100),R=rr(sourceEntry-sl,tp-sourceEntry);
      candidates.push({wallet:w,coin:info.symbol,mint:h.mint,side:'LONG',balance:h.amount,sourceEntry,current:px,distancePct:dist,sl,tp,rr:R,age:row.blockTime,ageMin:(now-row.blockTime)/60000,liquidity:info.liquidity,volume24h:info.volume24h,tx:row.sig,activitySource:'CURRENT_HOLDING',eligible:Math.abs(dist)<=ENTRY_WINDOW_PCT&&R>=MIN_RR});
      if(candidates.length>=MAX_SPOT_POSITIONS)break;
    }
  }

  const fresh=candidates.filter(x=>x.ageMin<=SPOT_MAX_ACTIVITY_AGE_MIN);
  return {wallet:w,signals:fresh.filter(x=>x.eligible),positions:fresh,scanned:sigs.length,txs:txs.length,holdings:holdings.length,health:spotHealth(w),ultraShort:SPOT_ULTRA_SHORT_ENABLED,recentBuys:fresh.filter(x=>x.activitySource==='RECENT_BUY').length};
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

async function scanFutures(w){
  const health=await futuresHealth(w);
  const state=await hl({type:'clearinghouseState',user:w.address},`state:${w.name}`); const ps=hlPositions(state);
  const mids=await hl({type:'allMids'},`mids:${w.name}`); const signals=[],positions=[];
  for(const p of ps){
    const mid=n(mids?.[p.coin]); if(!(mid>0)||!(p.entry>0))continue;
    const dist=(mid/p.entry-1)*100*(p.side==='LONG'?1:-1);
    const sl=p.side==='LONG'?p.entry*(1-HL_SL_PCT/100):p.entry*(1+HL_SL_PCT/100);
    const tp=p.side==='LONG'?p.entry*(1+HL_TP_PCT/100):p.entry*(1-HL_TP_PCT/100);
    const R=rr(Math.abs(p.entry-sl),Math.abs(tp-p.entry));
    const x={wallet:w,coin:p.coin,side:p.side,sourceEntry:p.entry,current:mid,distancePct:dist,sl,tp,rr:R,size:p.size,positionValue:p.positionValue,unrealized:p.unrealized,leverage:p.leverage,liq:p.liq,margin:p.margin,eligible:Math.abs(dist)<=ENTRY_WINDOW_PCT&&R>=MIN_RR};
    positions.push(x);if(x.eligible)signals.push(x);
  }
  return {wallet:w,signals,positions,scanned:1,health};
}
function signalLine(x,i){
  return `${i}. ${x.wallet.name} | ${x.coin} | ${x.side}\n   Source Entry ${fmt(x.sourceEntry)} | Now ${fmt(x.current)} | Dist ${pct(x.distancePct,2)}${x.ultraShort?` | Age ${x.ageMin<1?'<1m':x.ageMin.toFixed(1)+'m'}`:''}\n   SL ${fmt(x.sl)} | TP ${fmt(x.tp)} | RR ${fmt(x.rr,3)} | ${x.leverage?`Lev ${fmt(x.leverage,1)}x | `:''}${x.positionValue?`Pos ${money(x.positionValue)} | `:''}${x.liquidity?`Liq ${money(x.liquidity)}`:''}`;
}
function distanceAbs(x){return Math.abs(Number(x.distancePct));}
function setupReason(x){
  const why=[];
  if(distanceAbs(x)>ENTRY_WINDOW_PCT)why.push(`DIST>${ENTRY_WINDOW_PCT}%`);
  if(Number(x.rr)+1e-9<MIN_RR)why.push(`RR<${MIN_RR}`);
  return why;
}
function classifyPosition(x){
  const dist=distanceAbs(x);
  const why=setupReason(x);
  if(dist<=ENTRY_WINDOW_PCT && why.length===0)return 'GREEN';
  if(dist<=WATCH_WINDOW_PCT)return 'YELLOW';
  return 'RED';
}
function blockedLine(x){
  const cls=classifyPosition(x);
  const why=setupReason(x);
  const reason=why.length?why.join(','):'NO_VALID_SETUP';
  const icon=cls==='YELLOW'?'🟡':'🔴';
  const label=cls==='YELLOW'?'NEAR ENTRY':'TOO LATE';
  return `${icon} ${x.wallet.name} ${x.coin} ${x.side} | now=${fmt(x.current)} | entry=${fmt(x.sourceEntry)} | dist=${pct(x.distancePct,2)} | ${label} | BLOCK ${reason}`;
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
  const label=cls==='GREEN'?'ENTRY READY':cls==='YELLOW'?'NEAR / BLOCKED':'TOO LATE';
  const why=setupReason(x);
  const block=cls==='GREEN'?'VALID':(why.length?why.join(','):'NO_VALID_SETUP');
  const lev=Number.isFinite(Number(x.leverage))?` | Lev ${fmt(x.leverage,1)}x`:'';
  const pos=Number.isFinite(Number(x.positionValue))?` | Pos ${money(x.positionValue)}`:'';
  const up=Number.isFinite(Number(x.unrealized))?` | uPnL ${money(x.unrealized)}`:'';
  return `${icon} ${x.coin} ${x.side} | Now ${fmt(x.current)} | Entry ${fmt(x.sourceEntry)} | Dist ${pct(x.distancePct,2)} | SL ${fmt(x.sl)} | TP ${fmt(x.tp)} | RR ${fmt(x.rr,3)}${lev}${pos}${up} | ${label}${cls==='GREEN'?'':' | '+block}`;
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
    `📏 Green ≤${ENTRY_WINDOW_PCT}% | Yellow ≤${WATCH_WINDOW_PCT}% | Min RR ${MIN_RR}`,
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
  const spotActivity=spot.flatMap(r=>(r.positions||[]).filter(x=>x.activitySource==='RECENT_BUY').map(x=>({x,name:r.wallet.name})));
  lines.push('','⚡ SPOT RECENT BUY ACTIVITY');
  if(spotActivity.length){
    spotActivity.forEach(({x,name})=>{
      const cls=classifyPosition(x), icon=cls==='GREEN'?'🟢':cls==='YELLOW'?'🟡':'🔴';
      lines.push(`${icon} ${name} | ${x.coin} | BUY ${x.ageMin<1?'<1m':x.ageMin.toFixed(1)+'m'} ago | Entry ${fmt(x.sourceEntry)} | Now ${fmt(x.current)} | Dist ${pct(x.distancePct,2)} | RR ${fmt(x.rr,3)} | ${cls}${cls==='GREEN'?'':' | '+setupReason(x).join(',')}`);
    });
  }else lines.push(`No valid recent BUY decoded in the last ${SPOT_MAX_ACTIVITY_AGE_MIN}m.`);
  lines.push('',`📌 Spot authority: recent BUY activity | Lookback ${SPOT_MAX_ACTIVITY_AGE_MIN}m | Funding: SOL/WSOL`,`📌 Futures authority unchanged: live Hyperliquid position entry + mid price`,`⏱ Runtime ${((Date.now()-started)/1000).toFixed(1)}s`);
  console.log(`[SIGNAL-ENGINE ${VERSION}][DONE] signals=${green.length} positions=${allPositions.length} errors=${errs.length}`);
  await telegram(lines.join('\n'));
}

main().catch(async e=>{console.error(`[SIGNAL-ENGINE][FATAL] ${e.stack||e}`);await telegram(`🟣 CRYPTO WHALE SIGNAL ENGINE ${VERSION}\n📡 READ-ONLY | NO EXECUTION\n💥 FATAL\n${String(e.message||e).slice(0,1200)}`);process.exitCode=1});
