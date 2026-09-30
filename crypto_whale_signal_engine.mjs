import fs from 'node:fs/promises';
import path from 'node:path';
// CRYPTO SIGNAL ENGINE V1.0
// READ ONLY: NO ORDERS, NO PRIVATE KEYS, NO EXECUTION ENGINE.
// Dynamic whale discovery: 5 Spot + 5 Futures. READ ONLY.
// Telegram report is emitted every workflow cycle (intended every 5 minutes).

const VERSION = 'V4.0-WHALE-UNIVERSE-DYNAMIC-HOLD-1H-24H';
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
const RECENT_SIGS = Number(process.env.SIGNAL_SPOT_SIGNATURES || 80);
const SPOT_ACTIVITY_LOOKBACK_MIN = Number(process.env.SIGNAL_SPOT_ACTIVITY_LOOKBACK_MIN || 15);
const SPOT_MIN_BUY_USD = Number(process.env.SIGNAL_SPOT_MIN_BUY_USD || 25);
const MAX_SIGNAL_LATENCY_MIN = Number(process.env.SIGNAL_MAX_LATENCY_MIN || 5);
const FUTURES_ACTIVITY_LOOKBACK_MIN = Number(process.env.SIGNAL_FUTURES_ACTIVITY_LOOKBACK_MIN || 120);
const FUTURES_SIGNAL_FRESHNESS_MIN = Number(process.env.SIGNAL_FUTURES_SIGNAL_FRESHNESS_MIN || 15);
const FUTURES_AUDIT_LOOKBACK_MIN = Number(process.env.SIGNAL_FUTURES_AUDIT_LOOKBACK_MIN || 1440);
const FUTURES_GREEN_LATENCY_MIN = Number(process.env.SIGNAL_FUTURES_GREEN_LATENCY_MIN || MAX_SIGNAL_LATENCY_MIN);
const FUTURES_AVERAGING_GREEN_LATENCY_MIN = Number(process.env.SIGNAL_FUTURES_AVERAGING_GREEN_LATENCY_MIN || 10);
const FUTURES_BETWEEN_WALLETS_MS = Number(process.env.SIGNAL_FUTURES_BETWEEN_WALLETS_MS || 1200);
const FUTURES_RETRY_BASE_MS = Number(process.env.SIGNAL_FUTURES_RETRY_BASE_MS || 1500);
const FUTURES_FETCH_RETRY = Number(process.env.SIGNAL_FUTURES_FETCH_RETRY || 5);
const SPOT_MAX_ACTIVITY_AGE_MIN = Number(process.env.SIGNAL_SPOT_MAX_ACTIVITY_AGE_MIN || SPOT_ACTIVITY_LOOKBACK_MIN);
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const FUNDING_MINTS = new Set([WSOL_MINT,USDC_MINT]);
const KNOWN_NON_TRADE_MINTS = new Set([WSOL_MINT,USDC_MINT]);
const SPOT_DIAGNOSTIC_MAX = Number(process.env.SIGNAL_SPOT_DIAGNOSTIC_MAX || 5);
const MAX_SPOT_POSITIONS = Number(process.env.SIGNAL_MAX_SPOT_POSITIONS_PER_WALLET || 4);
const TG_LIMIT = 3800;
const HEALTH_LOOKBACK_DAYS = Number(process.env.SIGNAL_HEALTH_LOOKBACK_DAYS || 30);
const HEALTH_MIN_TRADES = Number(process.env.SIGNAL_HEALTH_MIN_TRADES || 20);

const TARGET_SPOT_WALLETS = Number(process.env.WHALE_TARGET_SPOT_WALLETS || 5);
const TARGET_FUTURES_WALLETS = Number(process.env.WHALE_TARGET_FUTURES_WALLETS || 5);
const DISCOVERY_TTL_MIN = Number(process.env.WHALE_DISCOVERY_TTL_MIN || 360);
const DISCOVERY_LOOKBACK_HOURS = Number(process.env.WHALE_DISCOVERY_LOOKBACK_HOURS || 48);
const DISCOVERY_MIN_HOLD_HOURS = Number(process.env.WHALE_DISCOVERY_MIN_HOLD_HOURS || 1);
const DISCOVERY_MAX_HOLD_HOURS = Number(process.env.WHALE_DISCOVERY_MAX_HOLD_HOURS || 24);
const DISCOVERY_MIN_VOLUME_USD = Number(process.env.WHALE_DISCOVERY_MIN_VOLUME_USD || 250000);
const DISCOVERY_MIN_COMPLETED = Number(process.env.WHALE_DISCOVERY_MIN_COMPLETED || 3);
const DISCOVERY_MIN_IN_WINDOW = Number(process.env.WHALE_DISCOVERY_MIN_IN_WINDOW || 2);
const DISCOVERY_MAX_CANDIDATES = Number(process.env.WHALE_DISCOVERY_MAX_CANDIDATES || 60);
const DISCOVERY_SPOT_TOP_TOKENS = Number(process.env.WHALE_DISCOVERY_SPOT_TOP_TOKENS || 12);
const DISCOVERY_SPOT_TOP_HOLDERS = Number(process.env.WHALE_DISCOVERY_SPOT_TOP_HOLDERS || 8);
const DISCOVERY_SPOT_MAX_CANDIDATES = Number(process.env.WHALE_DISCOVERY_SPOT_MAX_CANDIDATES || 40);
const DISCOVERY_STATE_FILE = process.env.WHALE_DISCOVERY_STATE_FILE || 'state/whale_watchlist.json';
const HL_LEADERBOARD_URL = process.env.HL_LEADERBOARD_URL || 'https://stats-data.hyperliquid.xyz/Mainnet/leaderboard';

// V4 deliberately does not carry the old hard-coded wallet list forward.
// Discovery produces a fresh 5+5 watchlist and caches it for the configured TTL.
let SPOT_WALLETS = [];
let FUTURES_WALLETS = [];

function sleep(ms){return new Promise(r=>setTimeout(r,ms))}

async function readDiscoveryCache(){
  try{
    const raw=await fs.readFile(DISCOVERY_STATE_FILE,'utf8');
    const x=JSON.parse(raw);
    const ageMin=(Date.now()-n(x?.generatedAt))/60000;
    if(ageMin>=0&&ageMin<DISCOVERY_TTL_MIN&&Array.isArray(x?.spotWallets)&&Array.isArray(x?.futuresWallets)){
      console.log(`[DISCOVERY][CACHE] age=${ageMin.toFixed(1)}m spot=${x.spotWallets.length} futures=${x.futuresWallets.length}`);
      return x;
    }
    console.log(`[DISCOVERY][CACHE] stale-or-empty`);
  }catch(e){console.log(`[DISCOVERY][CACHE] miss ${String(e?.message||e).slice(0,100)}`)}
  return null;
}
async function writeDiscoveryCache(data){
  try{
    await fs.mkdir(path.dirname(DISCOVERY_STATE_FILE),{recursive:true});
    await fs.writeFile(DISCOVERY_STATE_FILE,JSON.stringify(data,null,2));
    console.log(`[DISCOVERY][CACHE] saved ${DISCOVERY_STATE_FILE}`);
  }catch(e){console.log(`[DISCOVERY][CACHE] SAVE_ERROR ${String(e?.message||e).slice(0,160)}`)}
}
async function fetchLeaderboard(){
  const rows=await fetchJson(HL_LEADERBOARD_URL,{},'hl:leaderboard');
  const list=Array.isArray(rows?.leaderboardRows)?rows.leaderboardRows:[];
  console.log(`[DISCOVERY][FUTURES][LEADERBOARD] rows=${list.length}`);
  return list;
}
function lbMetric(row,key){
  const arr=Array.isArray(row?.windowPerformances)?row.windowPerformances:[];
  const find=(name)=>arr.find(x=>Array.isArray(x)&&x[0]===name)?.[1]||{};
  return {day:n(find('day')?.[key]),week:n(find('week')?.[key]),month:n(find('month')?.[key]),allTime:n(find('allTime')?.[key])};
}
function positionPostFromFill(f){
  const start=n(f?.startPosition);
  const sz=Math.abs(n(f?.sz));
  const dir=String(f?.dir||'').toLowerCase();
  if(!Number.isFinite(start)||!Number.isFinite(sz)||sz<=0)return null;
  if(dir.includes('open long'))return start+sz;
  if(dir.includes('close long'))return start-sz;
  if(dir.includes('open short'))return start-sz;
  if(dir.includes('close short'))return start+sz;
  return null;
}
function holdStatsFromFills(fills){
  const byCoin=new Map();
  for(const f of fills||[]){if(f?.coin)byCoin.has(f.coin)?byCoin.get(f.coin).push(f):byCoin.set(f.coin,[f]);}
  const holds=[]; let totalVolume=0; let additions=0; let freshAdds=0;
  const now=Date.now(); const cutoff=now-DISCOVERY_LOOKBACK_HOURS*3600000;
  for(const [coin,list0] of byCoin){
    const list=list0.filter(f=>n(f.time)>=cutoff).sort((a,b)=>n(a.time)-n(b.time));
    let open=null, prev=0;
    for(const f of list){
      const px=n(f.px), sz=Math.abs(n(f.sz)); totalVolume+=px*sz;
      const post=positionPostFromFill(f); if(post===null)continue;
      const start=n(f.startPosition); const absStart=Math.abs(start), absPost=Math.abs(post);
      if(absPost>absStart+1e-12){
        additions++;
        if(absStart>0)freshAdds++;
        if(open===null)open={time:n(f.time),side:post>0?'LONG':'SHORT'};
        if(prev!==0&&Math.sign(prev)!==Math.sign(post)){
          if(open){holds.push({coin,side:open.side,openTime:open.time,closeTime:n(f.time),hours:(n(f.time)-open.time)/3600000});}
          open={time:n(f.time),side:post>0?'LONG':'SHORT'};
        }
      }else if(absPost<absStart-1e-12){
        if(open){
          const h=(n(f.time)-open.time)/3600000;
          if(h>=0)holds.push({coin,side:open.side,openTime:open.time,closeTime:n(f.time),hours:h});
          open=null;
        }
      }
      prev=post;
    }
  }
  const completed=holds.length;
  const inWindow=holds.filter(h=>h.hours>=DISCOVERY_MIN_HOLD_HOURS&&h.hours<=DISCOVERY_MAX_HOLD_HOURS);
  const hs=holds.map(h=>h.hours).sort((a,b)=>a-b);
  const median=hs.length?hs[Math.floor(hs.length/2)]:0;
  const avg=hs.length?hs.reduce((a,b)=>a+b,0)/hs.length:0;
  const recentActivity=holds.some(h=>n(h.closeTime)>=now-24*3600000) || additions>0;
  return {holds,completed,inWindow:inWindow.length,medianHoldHours:median,avgHoldHours:avg,totalVolume,additions,freshAdds,recentActivity};
}
async function discoverFutures(){
  const rows=await fetchLeaderboard();
  const candidates=rows.filter(r=>/^0x[a-fA-F0-9]{40}$/.test(String(r?.ethAddress||'')))
    .map(r=>{const d=lbMetric(r,'pnl'),w=lbMetric(r,'vlm'); return {...r,pnl7:d.week,pnl30:d.month,volume7:w.week,volume1d:w.day};})
    .filter(r=>r.volume7>=DISCOVERY_MIN_VOLUME_USD && r.pnl7>0 && r.pnl30>0 && n(r.accountValue)>=50000)
    .sort((a,b)=>(b.volume1d-a.volume1d)+(b.pnl7-a.pnl7)*0.01)
    .slice(0,DISCOVERY_MAX_CANDIDATES);
  console.log(`[DISCOVERY][FUTURES] prefilter=${candidates.length}`);
  const scored=[];
  for(const r of candidates){
    const w={name:`HL_${String(r.ethAddress).slice(2,6).toUpperCase()}`,address:r.ethAddress};
    try{
      const fills=await hl({type:'userFillsByTime',user:w.address,startTime:Date.now()-DISCOVERY_LOOKBACK_HOURS*3600000,endTime:Date.now()},`discover:${w.name}`);
      const st=holdStatsFromFills(Array.isArray(fills)?fills:[]);
      const ratio=st.completed?st.inWindow/st.completed:0;
      const qualifies=st.inWindow>=DISCOVERY_MIN_IN_WINDOW && st.totalVolume>=DISCOVERY_MIN_VOLUME_USD && st.medianHoldHours>=DISCOVERY_MIN_HOLD_HOURS && st.medianHoldHours<=DISCOVERY_MAX_HOLD_HOURS && st.recentActivity;
      console.log(`[DISCOVERY][FUTURES][AUDIT] ${w.name} fills=${Array.isArray(fills)?fills.length:0} volume48h=${Math.round(st.totalVolume)} completed=${st.completed} in1-24h=${st.inWindow} median=${st.medianHoldHours.toFixed(2)}h adds=${st.additions} qualifies=${qualifies}`);
      if(qualifies)scored.push({...w,discovery:{volume48h:st.totalVolume,completed:st.completed,inWindow:st.inWindow,holdRatio:ratio,medianHoldHours:st.medianHoldHours,avgHoldHours:st.avgHoldHours,observedAdds:st.additions,pnl7:r.pnl7,pnl30:r.pnl30,leaderboardVolume7:r.volume7,accountValue:n(r.accountValue)}});
    }catch(e){console.log(`[DISCOVERY][FUTURES][AUDIT] ${w.name} ERROR ${String(e?.message||e).slice(0,120)}`)}
    await sleep(FUTURES_BETWEEN_WALLETS_MS);
    if(scored.length>=TARGET_FUTURES_WALLETS)break;
  }
  scored.sort((a,b)=>b.discovery.holdRatio-a.discovery.holdRatio || b.discovery.volume48h-a.discovery.volume48h);
  return scored.slice(0,TARGET_FUTURES_WALLETS);
}
async function fetchJupiterVerifiedTokens(){
  const urls=['https://tokens.jup.ag/tokens?tags=verified','https://tokens.jup.ag/tokens_with_markets'];
  for(const u of urls){try{const rows=await fetchJson(u,{},'jupiter:tokens');if(Array.isArray(rows)&&rows.length)return rows;}catch(e){console.log(`[DISCOVERY][SPOT][TOKENS] ${String(e?.message||e).slice(0,120)}`)}}
  return [];
}
async function discoverSpotCandidates(){
  const rows=await fetchJupiterVerifiedTokens();
  const stable=new Set([USDC_MINT,'So11111111111111111111111111111111111111112']);
  const tokens=rows.filter(t=>t?.address&&!stable.has(t.address)&&n(t.daily_volume)>=DISCOVERY_MIN_VOLUME_USD)
    .sort((a,b)=>n(b.daily_volume)-n(a.daily_volume)).slice(0,DISCOVERY_SPOT_TOP_TOKENS);
  console.log(`[DISCOVERY][SPOT] liquidTokens=${tokens.length}`);
  const owners=new Map();
  for(const t of tokens){
    try{
      const r=await sol({method:'getTokenLargestAccounts',params:[t.address]},`largest:${t.symbol||t.address.slice(0,6)}`);
      const accounts=(r?.result?.value||[]).slice(0,DISCOVERY_SPOT_TOP_HOLDERS).map(x=>x.address).filter(Boolean);
      if(!accounts.length)continue;
      const rr=await sol({method:'getMultipleAccounts',params:[accounts,{encoding:'jsonParsed'}]},`owners:${t.symbol||t.address.slice(0,6)}`);
      for(const a of (rr?.result?.value||[])){
        const owner=a?.data?.parsed?.info?.owner;
        if(owner)owners.set(owner,(owners.get(owner)||0)+1);
      }
    }catch(e){console.log(`[DISCOVERY][SPOT][TOKEN] ${t.symbol||t.address.slice(0,6)} ERROR ${String(e?.message||e).slice(0,100)}`)}
  }
  const pool=[...owners.entries()].sort((a,b)=>b[1]-a[1]).slice(0,DISCOVERY_SPOT_MAX_CANDIDATES);
  const scored=[];
  for(const [address,holderHits] of pool){
    try{
      const sigs=await solSignaturesForDiscovery(address);
      const times=sigs.map(s=>n(s.blockTime)*1000).filter(Boolean).sort((a,b)=>a-b);
      const recent=times.filter(t=>t>=Date.now()-24*3600000);
      const span=recent.length>=2?(recent[recent.length-1]-recent[0])/3600000:0;
      const activity=recent.length;
      // Candidate gate: enough recent transactions to plausibly represent an active trader.
      // Full 1-24h hold reconstruction is done only for the finalists to protect RPC limits.
      if(activity<DISCOVERY_MIN_COMPLETED)continue;
      scored.push({name:`SOL_${address.slice(0,4).toUpperCase()}`,address,discovery:{holderHits,recentTxs24h:activity,activitySpanHours:span}});
      if(scored.length>=TARGET_SPOT_WALLETS*3)break;
    }catch(e){console.log(`[DISCOVERY][SPOT][WALLET] ${short(address)} ERROR ${String(e?.message||e).slice(0,100)}`)}
    await sleep(180);
  }
  // Final spot quality gate: reuse the engine's activity parser on the finalists.
  const finals=[];
  for(const w of scored){
    try{
      const tokenAccounts=await walletTokenAccounts(w.address);
      const sigs=await solSignaturesForDiscovery(w.address,40);
      const cutoff=Date.now()-DISCOVERY_LOOKBACK_HOURS*3600000;
      let buys=0, sells=0, lastTrade=0, volumeUsd=0;
      const openLots=new Map(), holds=[];
      for(const s of sigs){
        const bt=n(s.blockTime)*1000;if(bt&&bt<cutoff)break;
        try{
          const tx=await solTx(s.signature);if(!tx)continue;
          const d=swapDirection(tx,w.address,tokenAccounts);
          if(d.direction!=='BUY'&&d.direction!=='SELL')continue;
          lastTrade=Math.max(lastTrade,bt);
          if(d.direction==='BUY'){
            buys++;
            for(const p of d.positive){
              const q=Math.abs(n(p.delta));if(q<=0)continue;
              if(!openLots.has(p.mint))openLots.set(p.mint,[]);
              openLots.get(p.mint).push({time:bt,qty:q});
            }
            const f=d.fundingToken?.mint===USDC_MINT?Math.abs(n(d.fundingToken.delta)):(Math.abs(n(d.nativeSpent))+Math.abs(n(d.fundingToken?.delta||0)))*0;
            volumeUsd+=Math.max(0,Number(f));
          }else{
            sells++;
            const ds=tokenDeltaMap(tx,w.address,tokenAccounts).filter(x=>x.delta<0&&!FUNDING_MINTS.has(x.mint));
            for(const qd of ds){
              let remain=Math.abs(n(qd.delta)); const q=openLots.get(qd.mint)||[];
              while(remain>0&&q.length){
                const lot=q[0],take=Math.min(remain,lot.qty); const h=(bt-lot.time)/3600000;
                if(h>=0)holds.push({mint:qd.mint,hours:h});
                lot.qty-=take;remain-=take;if(lot.qty<=1e-12)q.shift();
              }
            }
          }
        }catch{}
      }
      const inWindow=holds.filter(h=>h.hours>=DISCOVERY_MIN_HOLD_HOURS&&h.hours<=DISCOVERY_MAX_HOLD_HOURS);
      const hs=holds.map(h=>h.hours).sort((a,b)=>a-b);
      const medianHold=hs.length?hs[Math.floor(hs.length/2)]:0;
      const roundTrips=holds.length;
      const qualifies=roundTrips>=DISCOVERY_MIN_COMPLETED && inWindow.length>=DISCOVERY_MIN_IN_WINDOW && medianHold>=DISCOVERY_MIN_HOLD_HOURS && medianHold<=DISCOVERY_MAX_HOLD_HOURS && lastTrade>=Date.now()-24*3600000;
      if(qualifies)finals.push({...w,discovery:{...w.discovery,buys,sells,roundTrips,inWindow:inWindow.length,medianHoldHours:medianHold,avgHoldHours:hs.length?hs.reduce((a,b)=>a+b,0)/hs.length:0,lastTrade,volumeUsd}});
    }catch(e){console.log(`[DISCOVERY][SPOT][FINAL] ${w.name} ERROR ${String(e?.message||e).slice(0,120)}`)}
    await sleep(250);
    if(finals.length>=TARGET_SPOT_WALLETS)break;
  }
  return finals.slice(0,TARGET_SPOT_WALLETS);
}
async function solSignaturesForDiscovery(address,limit=60){
  const r=await sol({method:'getSignaturesForAddress',params:[address,{limit}]},`discover:sigs:${String(address).slice(0,6)}`);
  return Array.isArray(r?.result)?r.result.filter(x=>!x.err):[];
}
async function discoverWatchlist(){
  const cached=await readDiscoveryCache();
  if(cached){SPOT_WALLETS=cached.spotWallets;FUTURES_WALLETS=cached.futuresWallets;return cached;}
  console.log(`[DISCOVERY][START] target spot=${TARGET_SPOT_WALLETS} futures=${TARGET_FUTURES_WALLETS} hold=${DISCOVERY_MIN_HOLD_HOURS}-${DISCOVERY_MAX_HOLD_HOURS}h`);
  const [spotWallets,futuresWallets]=await Promise.all([discoverSpotCandidates(),discoverFutures()]);
  const data={generatedAt:Date.now(),criteria:{holdHours:[DISCOVERY_MIN_HOLD_HOURS,DISCOVERY_MAX_HOLD_HOURS],minVolumeUsd:DISCOVERY_MIN_VOLUME_USD},spotWallets,futuresWallets};
  SPOT_WALLETS=spotWallets; FUTURES_WALLETS=futuresWallets;
  await writeDiscoveryCache(data);
  console.log(`[DISCOVERY][DONE] selected spot=${SPOT_WALLETS.length} futures=${FUTURES_WALLETS.length}`);
  return data;
}

function short(a){return `${String(a).slice(0,6)}…${String(a).slice(-6)}`}
function n(v,d=0){const x=Number(v);return Number.isFinite(x)?x:d}
function money(v){return Number.isFinite(Number(v))?`$${Number(v).toLocaleString('en-US',{maximumFractionDigits:2})}`:'N/A'}
function pct(v,d=2){return Number.isFinite(Number(v))?`${Number(v).toFixed(d)}%`:'N/A'}
function fmt(v,d=4){return Number.isFinite(Number(v))?Number(v).toFixed(d):'N/A'}
function priceFmt(v){
  const x=Number(v);
  if(!Number.isFinite(x)||x<=0)return 'N/A';
  if(x>=10000)return x.toFixed(2);
  if(x>=1000)return x.toFixed(3);
  if(x>=100)return x.toFixed(4);
  if(x>=1)return x.toFixed(5);
  if(x>=0.1)return x.toFixed(6);
  if(x>=0.01)return x.toFixed(7);
  if(x>=0.001)return x.toFixed(8);
  if(x>=0.0001)return x.toFixed(9);
  if(x>=0.000001)return x.toFixed(10);
  if(x>=0.000000001)return x.toFixed(12);
  return x.toExponential(6);
}
function rr(sl,tp){const a=Math.abs(Number(sl));return a>0?Math.abs(Number(tp))/a:0}
function normalizedRR(sl,tp){const r=rr(sl,tp);return Number.isFinite(r)?Math.round(r*1000)/1000:0}
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

async function fetchSpotSymbolMap(){
  const map=new Map();
  try{
    const meta=await hl({type:'spotMeta'},'spotMeta:symbolMap');
    const tokens=new Map((Array.isArray(meta?.tokens)?meta.tokens:[]).map(t=>[Number(t?.index),String(t?.name||'').trim()]));
    for(const u of (Array.isArray(meta?.universe)?meta.universe:[])){
      const idx=Number(u?.index);
      const wire=String(u?.name||'').trim();
      let display=wire;
      if(Array.isArray(u?.tokens)&&u.tokens.length>=2){
        const base=tokens.get(Number(u.tokens[0]))||'';
        const quote=tokens.get(Number(u.tokens[1]))||'';
        if(base&&quote) display=`${base}/${quote}`;
      }
      if(Number.isFinite(idx)) map.set(`@${idx}`,display);
      if(wire) map.set(wire,display);
    }
    console.log(`[FUTURES][SYMBOL-MAP] loaded=${map.size} spotPairs=${Array.isArray(meta?.universe)?meta.universe.length:0}`);
  }catch(e){
    console.log(`[FUTURES][SYMBOL-MAP] ERROR ${String(e?.message||e).slice(0,180)}`);
  }
  return map;
}
function displayCoin(coin,symbolMap){
  const raw=String(coin||'').trim();
  return symbolMap?.get(raw)||raw;
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
function accountKeyPubkey(k){return typeof k==='string'?k:(k?.pubkey||'');}
function tokenUiAmount(balance){
  const a=balance?.uiTokenAmount||{};
  const ui=Number(a.uiAmountString);
  if(Number.isFinite(ui))return ui;
  const raw=Number(a.amount), dec=Number(a.decimals);
  if(Number.isFinite(raw)&&Number.isFinite(dec))return raw/10**dec;
  return 0;
}
function tokenDeltaMap(tx,wallet,knownTokenAccounts=new Set()){
  const pre=tx?.meta?.preTokenBalances||[], post=tx?.meta?.postTokenBalances||[];
  const keys=tx?.transaction?.message?.accountKeys||[];
  const walletLc=wallet.toLowerCase();
  const owns=(b)=>{
    if(String(b?.owner||'').toLowerCase()===walletLc)return true;
    const idx=n(b?.accountIndex,-1); const p=idx>=0?accountKeyPubkey(keys[idx]):'';
    return !!p && knownTokenAccounts.has(p);
  };
  const map=new Map();
  for(const b of pre){if(!owns(b))continue;const k=b.mint;map.set(k,(map.get(k)||0)-tokenUiAmount(b));}
  for(const b of post){if(!owns(b))continue;const k=b.mint;map.set(k,(map.get(k)||0)+tokenUiAmount(b));}
  return [...map.entries()].filter(([,d])=>Math.abs(d)>0).map(([mint,delta])=>({mint,delta}));
}
function walletAccountIndex(tx,wallet){
  const keys=tx?.transaction?.message?.accountKeys||[];
  return keys.findIndex(k=>accountKeyPubkey(k).toLowerCase()===wallet.toLowerCase());
}
function solDelta(tx,wallet){
  const idx=walletAccountIndex(tx,wallet);
  if(idx<0)return 0;
  return (n(tx?.meta?.postBalances?.[idx])-n(tx?.meta?.preBalances?.[idx]))/1e9;
}
function txFeeSol(tx){return n(tx?.meta?.fee)/1e9;}
function transactionProgramHints(tx){
  const text=[...(tx?.meta?.logMessages||[]),...((tx?.transaction?.message?.instructions||[]).map(i=>JSON.stringify(i)))].join(' ').toLowerCase();
  return ['jupiter','raydium','orca','meteora','phoenix','lifinity','pump','pumpswap','whirlpool'].filter(x=>text.includes(x));
}
function swapDirection(tx,wallet,knownTokenAccounts=new Set()){
  const ds=tokenDeltaMap(tx,wallet,knownTokenAccounts);
  const positive=ds.filter(d=>d.delta>0 && !KNOWN_NON_TRADE_MINTS.has(d.mint));
  const negative=ds.filter(d=>d.delta<0);
  const fundingToken=negative.find(d=>FUNDING_MINTS.has(d.mint));
  const nativeDelta=solDelta(tx,wallet);
  const fee=txFeeSol(tx);
  const nativeSpent=Math.max(0,-nativeDelta-fee);
  const hints=transactionProgramHints(tx);
  const hasTradeAsset=positive.length>0;
  const hasFunding=fundingToken||nativeSpent>0;
  if(hasTradeAsset&&hasFunding)return {direction:'BUY',positive,negative,fundingToken,nativeSpent,hints};
  const sold=negative.filter(d=>!FUNDING_MINTS.has(d.mint));
  const receivedFunding=ds.find(d=>d.delta>0&&FUNDING_MINTS.has(d.mint));
  if(sold.length&&(receivedFunding||nativeDelta>0))return {direction:'SELL',positive,negative,fundingToken:null,nativeSpent:0,hints};
  return {direction:'UNKNOWN',positive,negative,fundingToken,nativeSpent,hints};
}
function reconstructedBuy(tx,wallet,mint,delta,solUsd,knownTokenAccounts=new Set()){
  const ds=tokenDeltaMap(tx,wallet,knownTokenAccounts);
  const nativeDelta=solDelta(tx,wallet);
  const fee=txFeeSol(tx);
  const nativeSpent=Math.max(0,-nativeDelta-fee);
  const wsolSpent=Math.max(0,-(ds.find(d=>d.mint===WSOL_MINT)?.delta||0));
  const usdcSpent=Math.max(0,-(ds.find(d=>d.mint===USDC_MINT)?.delta||0));
  let fundingUsd=0, fundingAsset='UNKNOWN';
  if(usdcSpent>0){fundingUsd=usdcSpent;fundingAsset='USDC';}
  else if(wsolSpent>0){fundingUsd=wsolSpent*solUsd;fundingAsset='WSOL';}
  else if(nativeSpent>0){fundingUsd=nativeSpent*solUsd;fundingAsset='SOL';}
  if(!(fundingUsd>=SPOT_MIN_BUY_USD)||!(delta>0))return null;
  return {fundingUsd,fundingAsset,nativeSpent,wsolSpent,usdcSpent,feeSol:fee};
}

async function tokenInfo(mint){
  try{
    const r=await fetchJson(`${GECKO}/networks/solana/tokens/${mint}`);
    const a=r?.data?.attributes||{};return {symbol:a.symbol||mint.slice(0,6),name:a.name||'',price:n(a.price_usd),fdv:n(a.fdv_usd),volume24h:n(a.volume_usd?.h24),liquidity:n(a.total_reserve_in_usd)};
  }catch{return {symbol:mint.slice(0,6),name:'',price:0,fdv:0,volume24h:0,liquidity:0}}
}
async function walletTokenAccounts(address){
  const r=await sol({method:'getTokenAccountsByOwner',params:[address,{programId:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'},{encoding:'jsonParsed'}]},'getTokenAccountsByOwner');
  const set=new Set();
  for(const x of (r?.result?.value||[])){if(x?.pubkey)set.add(x.pubkey);}
  return set;
}
async function tokenMarketData(mint){
  try{
    const r=await fetchJson(`https://api.dexscreener.com/latest/dex/tokens/${mint}`,{},'dexscreener');
    const p=(r?.pairs||[]).filter(x=>x?.priceUsd).sort((a,b)=>n(b?.liquidity?.usd)-n(a?.liquidity?.usd))[0];
    if(p)return {price:n(p.priceUsd),symbol:p?.baseToken?.symbol||mint.slice(0,6),liquidity:n(p?.liquidity?.usd),volume24h:n(p?.volume?.h24),source:'DEXSCREENER'};
  }catch{}
  try{
    const r=await fetchJson(`${GECKO}/networks/solana/tokens/${mint}`,{},'gecko-token');
    const a=r?.data?.attributes||{};
    return {price:n(a.price_usd),symbol:a.symbol||mint.slice(0,6),liquidity:n(a.total_reserve_in_usd),volume24h:n(a.volume_usd?.h24),source:'GECKO'};
  }catch{return {price:0,symbol:mint.slice(0,6),liquidity:0,volume24h:0,source:'NONE'}}
}
async function scanSpot(w){
  const solInfo=await tokenInfo(WSOL_MINT);
  const solUsd=solInfo.price||await tokenPrice(WSOL_MINT);
  if(!(solUsd>0))throw new Error('SOL_PRICE_UNAVAILABLE');
  const tokenAccounts=await walletTokenAccounts(w.address);
  const sigs=await solSignatures(w.address);
  const cutoff=Date.now()-SPOT_MAX_ACTIVITY_AGE_MIN*60000;
  const txs=[];
  const diagnostics=[];
  for(const s of sigs.slice(0,RECENT_SIGS)){
    const bt=n(s.blockTime)*1000;
    if(bt && bt<cutoff)break;
    try{
      const tx=await solTx(s.signature);
      if(tx)txs.push({sig:s.signature,tx,blockTime:bt||Date.now()});
    }catch(e){diagnostics.push({sig:s.signature,reason:`TX_FETCH:${e.message}`});}
  }
  const candidates=[]; const seen=new Set();
  for(const row of txs){
    if(row.blockTime<cutoff)continue;
    const ds=tokenDeltaMap(row.tx,w.address,tokenAccounts);
    const direction=swapDirection(row.tx,w.address,tokenAccounts);
    if(direction.direction!=='BUY'){
      if(direction.positive.length||direction.negative.length)diagnostics.push({sig:row.sig,reason:`NOT_BUY:${direction.direction}`,deltas:ds.slice(0,8)});
      continue;
    }
    const positives=direction.positive.filter(d=>!seen.has(d.mint));
    if(!positives.length)continue;
    for(const d of positives){
      const funding=reconstructedBuy(row.tx,w.address,d.mint,d.delta,solUsd,tokenAccounts);
      if(!funding){diagnostics.push({sig:row.sig,reason:`FUNDING_UNRESOLVED:${d.mint.slice(0,8)}`,delta:d.delta});continue;}
      const info=await tokenMarketData(d.mint);
      const px=n(info.price);
      if(!(px>0)){diagnostics.push({sig:row.sig,reason:`PRICE_UNRESOLVED:${d.mint.slice(0,8)}`});continue;}
      const sourceEntry=funding.fundingUsd/d.delta;
      if(!(sourceEntry>0)){diagnostics.push({sig:row.sig,reason:'ENTRY_RECONSTRUCTION_INVALID'});continue;}
      const dist=(px/sourceEntry-1)*100;
      const sl=sourceEntry*(1-SL_PCT/100),tp=sourceEntry*(1+TP_PCT/100),R=normalizedRR(sourceEntry-sl,tp-sourceEntry);
      const ageMin=Math.max(0,(Date.now()-row.blockTime)/60000);
      const x={wallet:w,coin:info.symbol||d.mint.slice(0,6),mint:d.mint,side:'LONG',sourceEntry,current:px,distancePct:dist,sl,tp,rr:R,age:row.blockTime,ageMin,liquidity:info.liquidity,volume24h:info.volume24h,tx:row.sig,buyNotionalUsd:funding.fundingUsd,fundingAsset:funding.fundingAsset,activitySource:'RECENT_BUY',priceSource:info.source,eligible:Math.abs(dist)<=ENTRY_WINDOW_PCT&&R+1e-9>=MIN_RR};
      candidates.push(x);seen.add(d.mint);
      if(candidates.length>=MAX_SPOT_POSITIONS)break;
    }
    if(candidates.length>=MAX_SPOT_POSITIONS)break;
  }
  return {wallet:w,signals:candidates.filter(x=>x.eligible),positions:[],recentBuys:candidates,scanned:sigs.length,txs:txs.length,health:spotHealth(w),activityLookbackMin:SPOT_MAX_ACTIVITY_AGE_MIN,diagnostics:diagnostics.slice(0,SPOT_DIAGNOSTIC_MAX),tokenAccounts:tokenAccounts.size};
}

function hlPositions(state){
  return (state?.assetPositions||[]).map(x=>x?.position||x).filter(p=>p&&Math.abs(n(p.szi))>0).map(p=>({coin:p.coin,side:n(p.szi)>0?'LONG':'SHORT',size:Math.abs(n(p.szi)),entry:n(p.entryPx),positionValue:Math.abs(n(p.positionValue)),unrealized:n(p.unrealizedPnl),leverage:n(p.leverage?.value||p.leverage),liq:n(p.liquidationPx),margin:n(p.marginUsed)}));
}
async function futuresHealth(w){
  // Health is intentionally NOT on the signal path. The Telegram engine is
  // activity-first and must not spend the rate-limit budget on historical stats.
  return {health:'SIGNAL_ONLY',reason:'HEALTH_NOT_QUERIED_IN_SIGNAL_CYCLE'};
}

async function fetchRecentFuturesFills(w,startTime,endTime){
  let lastErr=null;
  for(let attempt=1;attempt<=FUTURES_FETCH_RETRY;attempt++){
    try{
      const rows=await hl({type:'userFillsByTime',user:w.address,startTime,endTime},`recentFills:${w.name}:a${attempt}`);
      if(!Array.isArray(rows)) throw new Error('FILLS_RESPONSE_NOT_ARRAY');
      console.log(`[FUTURES][FILLS] ${w.name} recent=${rows.length} attempt=${attempt}`);
      return rows;
    }catch(e){
      lastErr=e;
      const msg=String(e?.message||e);
      const is429=/429|rate.?limit|too many requests/i.test(msg);
      if(attempt>=FUTURES_FETCH_RETRY)break;
      const wait=FUTURES_RETRY_BASE_MS*Math.pow(2,attempt-1)+(is429?500:0);
      console.log(`[FUTURES][RETRY] ${w.name} attempt=${attempt} reason=${msg.slice(0,120)} wait=${wait}ms`);
      await sleep(wait);
    }
  }
  console.log(`[FUTURES][FILLS] ${w.name} ERROR ${String(lastErr?.message||lastErr||'UNKNOWN').slice(0,180)}`);
  return [];
}

async function auditFuturesHistory(w,now,recentRows){
  const auditCutoff=now-FUTURES_AUDIT_LOOKBACK_MIN*60000;
  let auditRows=null;
  let status='UNKNOWN';
  let detail='';
  try{
    auditRows=await hl({type:'userFillsByTime',user:w.address,startTime:auditCutoff,endTime:now},`audit24h:${w.name}`);
    if(!Array.isArray(auditRows))throw new Error('FILLS_RESPONSE_NOT_ARRAY');
    status=auditRows.length>0?'OK_WITH_HISTORY':'EMPTY_VALID';
    const times=auditRows.map(x=>n(x?.time)).filter(Boolean).sort((a,b)=>a-b);
    const oldest=times.length?new Date(times[0]).toISOString():'NONE';
    const newest=times.length?new Date(times[times.length-1]).toISOString():'NONE';
    detail=`count=${auditRows.length} oldest=${oldest} newest=${newest}`;
  }catch(e){
    const msg=String(e?.message||e);
    status=/429|rate.?limit|too many requests/i.test(msg)?'RATE_LIMITED':'ERROR';
    detail=msg.slice(0,180);
  }
  const recentStatus=recentRows.length?'RECENT_DATA_PRESENT':'RECENT_WINDOW_EMPTY';
  console.log(`[FUTURES][DATA-AUDIT] ${w.name} | recent120=${recentRows.length} | audit24h=${auditRows?auditRows.length:'ERR'} | status=${status} | ${recentStatus} | ${detail}`);
  return {status,auditRows:auditRows||[],detail};
}

async function fetchFuturesState(w){
  let lastErr=null;
  for(let attempt=1;attempt<=3;attempt++){
    try{
      const state=await hl({type:'clearinghouseState',user:w.address},`state:${w.name}:a${attempt}`);
      return state||null;
    }catch(e){
      lastErr=e;
      const msg=String(e?.message||e);
      const is429=/429|rate.?limit|too many requests/i.test(msg);
      if(attempt>=3)break;
      const wait=1200*Math.pow(2,attempt-1)+(is429?500:0);
      console.log(`[FUTURES][STATE-RETRY] ${w.name} attempt=${attempt} reason=${msg.slice(0,100)} wait=${wait}ms`);
      await sleep(wait);
    }
  }
  console.log(`[FUTURES][STATE] ${w.name} ERROR ${String(lastErr?.message||lastErr||'UNKNOWN').slice(0,160)}`);
  return null;
}

function statePositionMap(state){
  const map=new Map();
  for(const p of hlPositions(state)){
    if(p?.coin)map.set(String(p.coin),p);
  }
  return map;
}

async function scanFutures(w,mids,now,symbolMap){
  // IMPORTANT: current positions are never converted into entry signals.
  // A signal must originate from a recent Hyperliquid position increase.
  // Every same-side increase is an add/re-entry; this catches averaging-in,
  // instead of treating only the first position-opening fill as an entry.
  const cutoff=now-FUTURES_ACTIVITY_LOOKBACK_MIN*60000;
  const fills=await fetchRecentFuturesFills(w,cutoff,now);
  // A zero-fill 120m response is not treated as proof of inactivity.
  // Run a wider 24h audit only in that case, and NEVER use the 24h rows as
  // signal candidates. This distinguishes valid inactivity from retrieval gaps.
  const dataAudit=fills.length===0?await auditFuturesHistory(w,now,fills):null;
  const state=await fetchFuturesState(w);
  const currentPositions=statePositionMap(state);
  const additionsByKey=new Map();
  let dirOpen=0, derivedOpen=0, rejectedClose=0, invalid=0;

  for(const f of fills){
    const coin=String(f?.coin||'').trim();
    const dir=String(f?.dir||'');
    const aggressor=String(f?.side||'').toUpperCase();
    const t=n(f?.time);
    const px=n(f?.px);
    const sz=n(f?.sz);
    const sp=Number(f?.startPosition);
    if(!coin||t<cutoff||!(px>0)||!(sz>0)||!Number.isFinite(sp)){invalid++;continue;}

    const delta = aggressor==='B' ? sz : aggressor==='A' ? -sz : 0;
    const after = sp + delta;
    let side=null;
    let addedSize=0;

    // Primary detection: the fill increases absolute position.
    // For a flip, only the residual on the new side is an opening amount.
    if(delta!==0 && Math.abs(after)>Math.abs(sp) && Math.abs(after)>0){
      side=after>0?'LONG':'SHORT';
      addedSize=Math.abs(after)-Math.abs(sp);
      derivedOpen++;
    }else if(delta!==0 && sp*after<0){
      // Defensive flip handling: a single fill crossed through zero.
      side=after>0?'LONG':'SHORT';
      addedSize=Math.abs(after);
      if(addedSize>0)derivedOpen++;
    }else if(dir==='Open Long'||dir==='Open Short'){
      side=dir==='Open Long'?'LONG':'SHORT';
      addedSize=sz;
      derivedOpen++;
    }else{
      rejectedClose++;
      continue;
    }
    if(dir==='Open Long'||dir==='Open Short')dirOpen++;
    if(!(addedSize>0))continue;

    const key=`${coin}|${side}`;
    const list=additionsByKey.get(key)||[];
    list.push({...f,_derivedSide:side,_startPosition:sp,_postPosition:after,_addedSize:addedSize});
    additionsByKey.set(key,list);
  }

  let recentAdds=0;
  let averagingKeys=0;
  const latest=[];
  for(const [key,list0] of additionsByKey.entries()){
    const list=list0.sort((a,b)=>n(a.time)-n(b.time));
    recentAdds+=list.length;
    const averaging=list.length>=2;
    if(averaging)averagingKeys++;
    const latestAdd=list[list.length-1];
    let totalAdded=0, weighted=0;
    for(const f of list){
      const q=n(f._addedSize);
      totalAdded+=q;
      weighted+=q*n(f.px);
    }
    latestAdd._recentAddCount=list.length;
    latestAdd._recentAddedSize=totalAdded;
    latestAdd._recentAvgPx=totalAdded>0?weighted/totalAdded:n(latestAdd.px);
    latestAdd._isAveraging=averaging;
    latest.push(latestAdd);
  }

  console.log(`[FUTURES][OPEN-DETECT] ${w.name} fills=${fills.length} dirOpen=${dirOpen} derivedOpen=${derivedOpen} closes/reduces=${rejectedClose} invalid=${invalid} addEvents=${recentAdds} averagingSymbols=${averagingKeys}`);

  const signals=[];
  const sortedCandidates=latest.sort((a,b)=>n(b?.time)-n(a?.time));
  const freshCandidates=sortedCandidates.filter(f=>{
    const a=Math.max(0,(now-n(f.time))/60000);
    return a<=FUTURES_SIGNAL_FRESHNESS_MIN;
  });
  const staleCandidates=sortedCandidates.length-freshCandidates.length;
  console.log(`[FUTURES][CANDIDATE-AUDIT] ${w.name} addEvents=${sortedCandidates.length} fresh<=${FUTURES_SIGNAL_FRESHNESS_MIN}m=${freshCandidates.length} staleIgnored=${staleCandidates}`);
  if(!freshCandidates.length && sortedCandidates.length){
    const latestStale=sortedCandidates[0];
    const staleAge=Math.max(0,(now-n(latestStale.time))/60000);
    console.log(`[FUTURES][FRESHNESS-DROP] ${w.name} | ${displayCoin(latestStale.coin,symbolMap)} | latest ADD age=${staleAge.toFixed(1)}m > ${FUTURES_SIGNAL_FRESHNESS_MIN}m | hidden=STALE`);
  }
  for(const f of freshCandidates){
    const coin=String(f.coin);
    const displaySymbol=displayCoin(coin,symbolMap);
    const side=f._derivedSide || (f.dir==='Open Long'?'LONG':'SHORT');
    const entry=n(f.px);
    const mid=n(mids?.[coin]);
    const ageMin=Math.max(0,(now-n(f.time))/60000);
    const pos=currentPositions.get(coin);
    const currentSide=pos?.side||side;
    const avgEntry=Number.isFinite(Number(pos?.entry))&&Number(pos.entry)>0?Number(pos.entry):n(f._recentAvgPx,entry);
    const recentAvg=f._recentAvgPx;
    const addCount=n(f._recentAddCount,1);
    const addedSize=n(f._recentAddedSize,n(f.sz));
    const averaging=f._isAveraging===true;

    if(!(entry>0)||!(mid>0)){
      console.log(`[FUTURES][DROP] ${w.name} | ${displaySymbol} | ${side} | Add ${priceFmt(entry)} | Now ${priceFmt(mid)} | Age ${ageMin.toFixed(1)}m | REASON=PRICE_UNAVAILABLE`);
      continue;
    }

    // Signal distance is based on the latest actual add. The current AVG is
    // shown separately so a trader averaging down/up is visible to the user.
    const dist=(mid/entry-1)*100*(side==='LONG'?1:-1);
    const avgDist=(mid/avgEntry-1)*100*(currentSide==='LONG'?1:-1);
    const sl=side==='LONG'?entry*(1-HL_SL_PCT/100):entry*(1+HL_SL_PCT/100);
    const tp=side==='LONG'?entry*(1+HL_TP_PCT/100):entry*(1-HL_TP_PCT/100);
    const R=normalizedRR(Math.abs(entry-sl),Math.abs(tp-entry));
    const x={wallet:w,coin,displaySymbol,side:currentSide,sourceEntry:entry,current:mid,distancePct:dist,sl,tp,rr:R,
      size:addedSize,positionValue:pos?.positionValue??addedSize*entry,unrealized:pos?.unrealized??null,
      leverage:pos?.leverage??null,liq:pos?.liq??null,margin:pos?.margin??null,
      openedAt:n(f.time),ageMin,openFillPx:entry,openFillSize:addedSize,openFillHash:f.hash||null,
      activitySource:'RECENT_HYPERLIQUID_POSITION_ADD',fillDir:f.dir,
      avgEntry,avgDistancePct:avgDist,recentAvgPx:recentAvg,addCount,averaging,
      totalRecentAddedSize:addedSize,currentPositionSize:pos?.size??null,
      eligible:ageMin<=FUTURES_SIGNAL_FRESHNESS_MIN&&Math.abs(dist)<=ENTRY_WINDOW_PCT&&R+1e-9>=MIN_RR};
    const auditStatus=classifyPosition(x);
    const reasons=setupReason(x);
    const reason=auditStatus==='YELLOW'?yellowReason(x):(reasons.length?reasons.join(' + '):'READY');
    console.log(`[FUTURES][CANDIDATE] ${w.name} | ${displaySymbol} | ${currentSide} | ADD ${priceFmt(entry)} | AVG ${priceFmt(avgEntry)} | observedAdds=${addCount} | Now ${priceFmt(mid)} | Dist ${pct(dist,2)} | Age ${ageMin.toFixed(1)}m | RR ${fmt(R,3)} | STATUS=${auditStatus} | REASON=${reason}`);
    signals.push(x);
  }
  return {wallet:w,signals,positions:signals,scanned:fills.length,health:{health:'SIGNAL_ONLY',reason:'HEALTH_NOT_QUERIED_IN_SIGNAL_CYCLE'},activityLookbackMin:FUTURES_ACTIVITY_LOOKBACK_MIN,addEvents:recentAdds,averagingSymbols:averagingKeys,dataAudit:dataAudit?{status:dataAudit.status,audit24hCount:dataAudit.auditRows.length,detail:dataAudit.detail}:null};
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

function signalLine(x,i){
  return `${i}. ${x.wallet.name} | ${x.displaySymbol||x.coin} | ${x.side}\n   Source Entry ${priceFmt(x.sourceEntry)} | Now ${priceFmt(x.current)} | Dist ${pct(x.distancePct,2)}\n   SL ${priceFmt(x.sl)} | TP ${priceFmt(x.tp)} | RR ${fmt(x.rr,3)} | ${x.leverage?`Lev ${fmt(x.leverage,1)}x | `:''}${x.positionValue?`Pos ${money(x.positionValue)} | `:''}${x.ageMin!=null?`Age ${x.ageMin<1?Math.max(1,Math.round(x.ageMin*60))+'s':x.ageMin.toFixed(1)+'m'} | `:''}${x.liquidity?`Liq ${money(x.liquidity)}`:''}`;
}
function distanceAbs(x){return Math.abs(Number(x.distancePct));}
function signalAgeMin(x){
  if(Number.isFinite(Number(x.ageMin)))return Number(x.ageMin);
  if(Number.isFinite(Number(x.age))){
    const t=Number(x.age);
    const ms=t>1e12?t*1:t*1000;
    return Math.max(0,(Date.now()-ms)/60000);
  }
  if(Number.isFinite(Number(x.openedAt)))return Math.max(0,(Date.now()-Number(x.openedAt))/60000);
  return null;
}
function setupReason(x){
  const why=[];
  const dist=distanceAbs(x);
  const latency=signalAgeMin(x);
  if(!Number.isFinite(Number(x.sourceEntry))||Number(x.sourceEntry)<=0)why.push('ENTRY_INVALID');
  if(!Number.isFinite(Number(x.current))||Number(x.current)<=0)why.push('NOW_PRICE_INVALID');
  if(!Number.isFinite(Number(x.rr))||Number(x.rr)+1e-9<MIN_RR)why.push(`RR<${MIN_RR}`);
  if(Number.isFinite(dist)&&dist>ENTRY_WINDOW_PCT)why.push(`DIST>${ENTRY_WINDOW_PCT}%`);
  if(Number.isFinite(latency)&&latency>MAX_SIGNAL_LATENCY_MIN)why.push(`LATENCY>${MAX_SIGNAL_LATENCY_MIN}m`);
  return why;
}
function classifyPosition(x){
  const dist=distanceAbs(x);
  const latency=signalAgeMin(x);
  const invalid=!Number.isFinite(Number(x.sourceEntry))||Number(x.sourceEntry)<=0||!Number.isFinite(Number(x.current))||Number(x.current)<=0;
  const rrOk=Number.isFinite(Number(x.rr))&&Number(x.rr)+1e-9>=MIN_RR;
  const distGreen=Number.isFinite(dist)&&dist<=ENTRY_WINDOW_PCT;
  const distYellow=Number.isFinite(dist)&&dist<=WATCH_WINDOW_PCT;
  const latencyGreen=!Number.isFinite(latency)||latency<=FUTURES_GREEN_LATENCY_MIN;
  const freshnessOk=!Number.isFinite(latency)||latency<=FUTURES_SIGNAL_FRESHNESS_MIN;
  const averagingGreen=Boolean(x.averaging)&&Number.isFinite(latency)&&latency<=FUTURES_AVERAGING_GREEN_LATENCY_MIN;
  if(!invalid&&freshnessOk&&distGreen&&rrOk&&(latencyGreen||averagingGreen))return 'GREEN';
  if(!invalid&&freshnessOk&&distYellow&&rrOk)return 'YELLOW';
  if(!invalid&&distGreen&&rrOk&&Number.isFinite(latency)&&latency>MAX_SIGNAL_LATENCY_MIN)return 'YELLOW';
  return 'RED';
}
function yellowReason(x){
  const reasons=[];
  const dist=distanceAbs(x);
  const latency=signalAgeMin(x);
  if(Number.isFinite(dist)&&dist>ENTRY_WINDOW_PCT)reasons.push(`DIST>${ENTRY_WINDOW_PCT}%`);
  const averagingGreen=Boolean(x.averaging)&&Number.isFinite(latency)&&latency<=FUTURES_AVERAGING_GREEN_LATENCY_MIN;
  if(Number.isFinite(latency)&&latency>FUTURES_GREEN_LATENCY_MIN&&!averagingGreen)reasons.push(`LATENCY>${FUTURES_GREEN_LATENCY_MIN}m`);
  if(Number.isFinite(latency)&&latency>FUTURES_SIGNAL_FRESHNESS_MIN)reasons.push(`STALE>${FUTURES_SIGNAL_FRESHNESS_MIN}m`);
  if(x.averaging)reasons.push(`FRESH_AVERAGING | OBSERVED_ADDs=${x.addCount}`);
  return reasons.length?reasons.join(' + '):'NEAR_ENTRY';
}
function compactSignalLine(x,i){
  const ageMin=signalAgeMin(x);
  const ageText=Number.isFinite(ageMin)?` | Age ${ageMin<1?Math.max(1,Math.round(ageMin*60))+'s':ageMin.toFixed(1)+'m'}`:'';
  const size=Number.isFinite(Number(x.buyNotionalUsd))?` | Size ${money(x.buyNotionalUsd)}`:'';
  const pos=Number.isFinite(Number(x.positionValue))?` | Pos ${money(x.positionValue)}`:'';
  const lev=Number.isFinite(Number(x.leverage))?` | Lev ${fmt(x.leverage,1)}x`:'';
  const avg=Number.isFinite(Number(x.avgEntry))?` | AVG ${priceFmt(x.avgEntry)}`:'';
  const avgTag=x.averaging?` | FRESH AVERAGING | Observed ADDs ${x.addCount}`:'';
  const reason=classifyPosition(x)==='YELLOW'?` | ${yellowReason(x)}`:'';
  return `${i}. ${x.wallet.name} | ${x.displaySymbol||x.coin} | ${x.side}\n   ADD ${priceFmt(x.sourceEntry)} | AVG ${priceFmt(x.avgEntry)} | Now ${priceFmt(x.current)} | Dist ${pct(x.distancePct,2)} | SL ${priceFmt(x.sl)} | TP ${priceFmt(x.tp)} | RR ${fmt(x.rr,3)}${ageText}${avgTag}${size}${pos}${lev}${reason}`;
}
function marketSignals(title,items){
  const rows=[title,'━━━━━━━━━━━━━━━━━━'];
  if(items.length)items.forEach((x,i)=>rows.push(compactSignalLine(x,i+1)));
  else rows.push('None');
  return rows;
}

async function main(){
  const started=Date.now();
  await discoverWatchlist();
  console.log(`[SIGNAL-ENGINE ${VERSION}][START] spot=${SPOT_WALLETS.length} futures=${FUTURES_WALLETS.length}`);
  const spot=await Promise.all(SPOT_WALLETS.map(w=>scanSpot(w).catch(e=>({wallet:w,signals:[],positions:[],recentBuys:[],error:e.message,scanned:0,txs:0,health:spotHealth(w)}))));
  const symbolMap=await fetchSpotSymbolMap();
  let mids={};
  try{
    mids=await hl({type:'allMids'},'mids:cycle');
  }catch(e){
    console.log(`[FUTURES][MIDS] ERROR ${String(e?.message||e).slice(0,180)}`);
  }
  const futures=[];
  for(const w of FUTURES_WALLETS){
    futures.push(await scanFutures(w,mids,Date.now(),symbolMap).catch(e=>({wallet:w,signals:[],positions:[],error:e.message,scanned:0,health:{health:'SIGNAL_ONLY',reason:'FUTURES_SCAN_ERROR',error:e.message}})));
    await sleep(FUTURES_BETWEEN_WALLETS_MS);
  }

  // Telegram is intentionally signal-only. Health, current holdings, diagnostics,
  // red/too-late candidates and decoder internals stay out of the user message.
  const spotCandidates=spot.flatMap(x=>x.recentBuys||[]);
  for(const x of spotCandidates){
    const st=classifyPosition(x);
    const reasons=setupReason(x);
    console.log(`[SPOT][CANDIDATE] ${x.wallet?.name||'?'} | ${x.coin||'?'} | ${x.side||'LONG'} | Entry ${priceFmt(x.sourceEntry)} | Now ${priceFmt(x.current)} | Dist ${pct(x.distancePct,2)} | Age ${Number(x.ageMin||0).toFixed(1)}m | RR ${fmt(x.rr,3)} | STATUS=${st} | REASON=${st==='YELLOW'?yellowReason(x):(reasons.length?reasons.join(' + '):'READY')}`);
  }
  const futuresCandidates=futures.flatMap(x=>x.positions||[]);
  const classified=[...spotCandidates,...futuresCandidates].map(x=>({...x,status:classifyPosition(x)}));
  const spotGreen=classified.filter(x=>x.mint&&x.status==='GREEN');
  const spotYellow=classified.filter(x=>x.mint&&x.status==='YELLOW');
  const futuresGreen=classified.filter(x=>!x.mint&&x.status==='GREEN');
  const futuresYellow=classified.filter(x=>!x.mint&&x.status==='YELLOW');

  const lines=[
    `🟣 CRYPTO WHALE SIGNAL ENGINE ${VERSION}`,
    '📡 READ-ONLY | SIGNAL-ONLY | NO ORDERS',
    '━━━━━━━━━━━━━━━━━━',
    `🕐 ${new Date().toISOString()}`,
    `🎯 WATCHLIST: ${SPOT_WALLETS.length} Spot + ${FUTURES_WALLETS.length} Futures | Hold target ${DISCOVERY_MIN_HOLD_HOURS}-${DISCOVERY_MAX_HOLD_HOURS}h`,
    `📏 Initial GREEN ≤${ENTRY_WINDOW_PCT}% + RR≥${MIN_RR} + Age≤${FUTURES_GREEN_LATENCY_MIN}m | Averaging GREEN ≤${FUTURES_AVERAGING_GREEN_LATENCY_MIN}m | Fresh signal≤${FUTURES_SIGNAL_FRESHNESS_MIN}m | ADD=latest increase, AVG=current position average`,
    '',
    ...marketSignals('🟢 SPOT — ENTRY READY',spotGreen),
    '',
    ...marketSignals('🟡 SPOT — NEAR / LATENCY',spotYellow),
    '',
    ...marketSignals('🟢 FUTURES — ENTRY READY',futuresGreen),
    '',
    ...marketSignals('🟡 FUTURES — NEAR / LATENCY',futuresYellow),
    '',
    `⏱ ${((Date.now()-started)/1000).toFixed(1)}s | Red/too-late signals hidden`
  ];
  console.log(`[SIGNAL-ENGINE ${VERSION}][DONE] green=${spotGreen.length+futuresGreen.length} yellow=${spotYellow.length+futuresYellow.length} red-hidden=${classified.filter(x=>x.status==='RED').length}`);
  await telegram(lines.join('\n'));
}

main().catch(async e=>{console.error(`[SIGNAL-ENGINE][FATAL] ${e.stack||e}`);await telegram(`🟣 CRYPTO WHALE SIGNAL ENGINE ${VERSION}\n📡 READ-ONLY | NO EXECUTION\n💥 FATAL\n${String(e.message||e).slice(0,1200)}`);process.exitCode=1});
