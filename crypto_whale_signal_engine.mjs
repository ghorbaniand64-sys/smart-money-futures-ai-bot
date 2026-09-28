// CRYPTO SIGNAL ENGINE V1.0
// READ ONLY: NO ORDERS, NO PRIVATE KEYS, NO EXECUTION ENGINE.
// Exactly 10 fixed signal sources: 5 Spot + 5 Futures.
// Telegram report is emitted every workflow cycle (intended every 5 minutes).

const VERSION = 'V1.0-WHALE-SIGNAL-10';
const HL_INFO = process.env.HYPERLIQUID_API_URL || 'https://api.hyperliquid.xyz/info';
const SOL_RPC = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const GECKO = 'https://api.geckoterminal.com/api/v2';
const TG_TOKEN = process.env.TELEGRAM_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '';
const TG_CHAT = process.env.TELEGRAM_CHAT_ID || '';
const ENTRY_WINDOW_PCT = Number(process.env.SIGNAL_MAX_ENTRY_DISTANCE_PCT || 0.75);
const MIN_RR = Number(process.env.SIGNAL_MIN_RR || 1.5);
const SL_PCT = Number(process.env.SIGNAL_SPOT_SL_PCT || 2.0);
const TP_PCT = Number(process.env.SIGNAL_SPOT_TP_PCT || 4.0);
const HL_SL_PCT = Number(process.env.SIGNAL_FUTURES_SL_PCT || 1.5);
const HL_TP_PCT = Number(process.env.SIGNAL_FUTURES_TP_PCT || 3.0);
const FETCH_TIMEOUT = Number(process.env.SIGNAL_REQUEST_TIMEOUT_MS || 18000);
const RECENT_SIGS = Number(process.env.SIGNAL_SPOT_SIGNATURES || 30);
const MAX_SPOT_POSITIONS = Number(process.env.SIGNAL_MAX_SPOT_POSITIONS_PER_WALLET || 4);
const TG_LIMIT = 3800;

const SPOT_WALLETS = [
  {name:'DECU', address:'4vw54BmAogeRV3vPKWyFet5yf8DTLcREzdSzx4rw9Ud9'},
  {name:'TRUNOEST', address:'ardinRsN1mNYVeoJWTBsWeYeXvuR9UUDGMsCDKpb6AT'},
  {name:'CENTED', address:'CyaE1VxvBrahnPWkqm5VsdCvyS2QmNht2UFrKJHga54o'},
  {name:'MR_FROG', address:'4DdrfiDHpmx55i4SPssxVzS9ZaKLb8qr45NKY9Er9nNh'},
  {name:'JIJO', address:'4BdKaxN8G6ka4GYtQQWk4G4dZRUTX2vQH9GcXdBREFUk'}
];

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
    candidates.push({wallet:w,coin:info.symbol,mint:h.mint,side:'LONG',balance:h.amount,sourceEntry,current:px,distancePct:dist,sl,tp,rr:R,age:row.blockTime,liquidity:info.liquidity,volume24h:info.volume24h,tx:row.sig,eligible:dist<=ENTRY_WINDOW_PCT&&R>=MIN_RR});
    if(candidates.length>=MAX_SPOT_POSITIONS)break;
  }
  return {wallet:w,signals:candidates.filter(x=>x.eligible),positions:candidates,scanned:sigs.length,txs:txs.length,holdings:holdings.length};
}

function hlPositions(state){
  return (state?.assetPositions||[]).map(x=>x?.position||x).filter(p=>p&&Math.abs(n(p.szi))>0).map(p=>({coin:p.coin,side:n(p.szi)>0?'LONG':'SHORT',size:Math.abs(n(p.szi)),entry:n(p.entryPx),positionValue:Math.abs(n(p.positionValue)),unrealized:n(p.unrealizedPnl),leverage:n(p.leverage?.value||p.leverage),liq:n(p.liquidationPx),margin:n(p.marginUsed)}));
}
async function scanFutures(w){
  const state=await hl({type:'clearinghouseState',user:w.address},`state:${w.name}`); const ps=hlPositions(state);
  const mids=await hl({type:'allMids'},`mids:${w.name}`); const signals=[],positions=[];
  for(const p of ps){
    const mid=n(mids?.[p.coin]); if(!(mid>0)||!(p.entry>0))continue;
    const dist=(mid/p.entry-1)*100*(p.side==='LONG'?1:-1);
    const sl=p.side==='LONG'?p.entry*(1-HL_SL_PCT/100):p.entry*(1+HL_SL_PCT/100);
    const tp=p.side==='LONG'?p.entry*(1+HL_TP_PCT/100):p.entry*(1-HL_TP_PCT/100);
    const R=rr(Math.abs(p.entry-sl),Math.abs(tp-p.entry));
    const x={wallet:w,coin:p.coin,side:p.side,sourceEntry:p.entry,current:mid,distancePct:dist,sl,tp,rr:R,size:p.size,positionValue:p.positionValue,unrealized:p.unrealized,leverage:p.leverage,liq:p.liq,margin:p.margin,eligible:dist<=ENTRY_WINDOW_PCT&&R>=MIN_RR};
    positions.push(x);if(x.eligible)signals.push(x);
  }
  return {wallet:w,signals,positions,scanned:1};
}
function signalLine(x,i){
  return `${i}. ${x.wallet.name} | ${x.coin} | ${x.side}\n   Entry source ${fmt(x.sourceEntry)} | Now ${fmt(x.current)} | Dist ${pct(x.distancePct,2)}\n   SL ${fmt(x.sl)} | TP ${fmt(x.tp)} | RR ${fmt(x.rr,2)} | ${x.leverage?`Lev ${fmt(x.leverage,1)}x | `:''}${x.positionValue?`Pos ${money(x.positionValue)} | `:''}${x.liquidity?`Liq ${money(x.liquidity)}`:''}`;
}
function blockedLine(x){
  const why=[]; if(x.distancePct>ENTRY_WINDOW_PCT)why.push(`DIST>${ENTRY_WINDOW_PCT}%`); if(x.rr<MIN_RR)why.push(`RR<${MIN_RR}`); return `${x.wallet.name} ${x.coin} ${x.side} | now=${fmt(x.current)} | entry=${fmt(x.sourceEntry)} | dist=${pct(x.distancePct,2)} | BLOCK ${why.join(',')||'NO_VALID_SETUP'}`;
}

async function main(){
  const started=Date.now();
  console.log(`[SIGNAL-ENGINE ${VERSION}][START] spot=${SPOT_WALLETS.length} futures=${FUTURES_WALLETS.length}`);
  const spot=await Promise.all(SPOT_WALLETS.map(w=>scanSpot(w).catch(e=>({wallet:w,signals:[],positions:[],error:e.message,scanned:0,txs:0}))));
  const futures=await Promise.all(FUTURES_WALLETS.map(w=>scanFutures(w).catch(e=>({wallet:w,signals:[],positions:[],error:e.message,scanned:0}))));
  const allSignals=[...spot.flatMap(x=>x.signals),...futures.flatMap(x=>x.signals)].sort((a,b)=>b.rr-a.rr);
  const allPositions=[...spot.flatMap(x=>x.positions),...futures.flatMap(x=>x.positions)];
  const lines=[`🟣 CRYPTO WHALE SIGNAL ENGINE ${VERSION}`,'📡 READ-ONLY | NO ORDERS | NO EXECUTION','━━━━━━━━━━━━━━━━━━',`🕐 Cycle: ${new Date().toISOString()}`,`🎯 Sources: SPOT ${SPOT_WALLETS.length}/5 | FUTURES ${FUTURES_WALLETS.length}/5`,`🔎 Exact scans: ${spot.filter(x=>!x.error).length}/5 Spot | ${futures.filter(x=>!x.error).length}/5 Futures`,`🚨 ENTRY OPPORTUNITIES: ${allSignals.length}`,`📏 Entry window: ≤${ENTRY_WINDOW_PCT}% from source entry | Min RR ${MIN_RR}`,''];
  lines.push('🟢 SPOT SIGNALS');
  const ss=allSignals.filter(x=>SPOT_WALLETS.some(w=>w.address===x.wallet.address));
  if(ss.length)ss.forEach((x,i)=>lines.push(signalLine(x,i+1),'🔗 '+x.mint));else lines.push('No Spot position currently inside the entry window.');
  lines.push('','🔵 FUTURES SIGNALS');
  const fs=allSignals.filter(x=>FUTURES_WALLETS.some(w=>w.address===x.wallet.address));
  if(fs.length)fs.forEach((x,i)=>lines.push(signalLine(x,i+1)));else lines.push('No Futures position currently inside the entry window.');
  lines.push('','📋 ALL CURRENT POSITIONS / WHY NOT ENTRY');
  if(allPositions.length){for(const x of allPositions.slice(0,20))lines.push('• '+blockedLine(x));}else lines.push('No readable current positions detected.');
  const errs=[...spot.filter(x=>x.error).map(x=>`SPOT ${x.wallet.name}: ${x.error}`),...futures.filter(x=>x.error).map(x=>`FUTURES ${x.wallet.name}: ${x.error}`)];
  if(errs.length){lines.push('','⚠️ DATA ERRORS');errs.forEach(e=>lines.push(e));}
  lines.push('','📌 Signal logic: Spot requires a currently held SPL token plus a recent observed buy; source entry is reconstructed from on-chain SOL/token balance deltas and is diagnostic, not an exchange fill price. Futures uses the live Hyperliquid position entry and mid price.','📌 No private keys, order placement, leverage changes, SL/TP orders, or execution handoff exist in this engine.',`⏱ Runtime ${(Date.now()-started)/1000}s`);
  console.log(`[SIGNAL-ENGINE ${VERSION}][DONE] signals=${allSignals.length} positions=${allPositions.length} errors=${errs.length}`);
  await telegram(lines.join('\n'));
}
main().catch(async e=>{console.error(`[SIGNAL-ENGINE][FATAL] ${e.stack||e}`);await telegram(`🟣 CRYPTO WHALE SIGNAL ENGINE ${VERSION}\n📡 READ-ONLY | NO EXECUTION\n💥 FATAL\n${String(e.message||e).slice(0,1200)}`);process.exitCode=1});
