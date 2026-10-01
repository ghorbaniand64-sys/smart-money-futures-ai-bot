import fs from 'node:fs/promises';
import path from 'node:path';
// CRYPTO SIGNAL ENGINE V1.0
// READ ONLY: NO ORDERS, NO PRIVATE KEYS, NO EXECUTION ENGINE.
// Dynamic whale discovery: 5 Spot + 5 Futures. READ ONLY.
// Telegram report is emitted every workflow cycle (intended every 5 minutes).

const VERSION = 'V6.0';
// Runtime upgrade line: V6.1 Spot FIFO Performance + Futures Fill/Position Reconstruction.
// VERSION intentionally remains V6.0 for repository compatibility; internal schemas
// below identify the upgraded engine contracts without breaking the existing gate.
const HL_INFO = process.env.HYPERLIQUID_API_URL || 'https://api.hyperliquid.xyz/info';
const SOL_RPC = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const HELIUS_API_KEY = process.env.HELIUS_API_KEY || '';
const HELIUS_ENHANCED_ENABLED = String(process.env.WHALE_HELIUS_ENHANCED_ENABLED || 'true').toLowerCase() === 'true' && Boolean(HELIUS_API_KEY);
const HELIUS_ENHANCED_BASE = process.env.HELIUS_ENHANCED_BASE || 'https://api.helius.xyz/v0';
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
const FUTURES_MAX_ACTIVE_LIFECYCLE_AGE_HOURS = Number(process.env.SIGNAL_FUTURES_MAX_ACTIVE_LIFECYCLE_AGE_HOURS || 24);
const FUTURES_MIN_MEANINGFUL_ADD_NOTIONAL_USD = Number(process.env.SIGNAL_FUTURES_MIN_MEANINGFUL_ADD_NOTIONAL_USD || 100);
const FUTURES_MAX_ADVERSE_AVG_PCT = Number(process.env.SIGNAL_FUTURES_MAX_ADVERSE_AVG_PCT || 5);
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
const MAX_TELEGRAM_WHALE_BLOCKS = Number(process.env.SIGNAL_MAX_TELEGRAM_WHALE_BLOCKS || 10);
const PERFORMANCE_LOOKBACK_DAYS = Number(process.env.SIGNAL_PERFORMANCE_LOOKBACK_DAYS || 30);
const PERFORMANCE_CACHE_MIN = Number(process.env.SIGNAL_PERFORMANCE_CACHE_MIN || 15);
const PERFORMANCE_MAX_PAGES = Number(process.env.SIGNAL_PERFORMANCE_MAX_PAGES || 8);
const PERFORMANCE_PAGE_DELAY_MS = Number(process.env.SIGNAL_PERFORMANCE_PAGE_DELAY_MS || 250);
const PERFORMANCE_STATE_FILE = process.env.SIGNAL_PERFORMANCE_STATE_FILE || 'state/whale_performance_cache.json';
const PERFORMANCE_SCHEMA = 'V6.1-SPOT-FIFO-PERFORMANCE-V3';
const HEALTH_LOOKBACK_DAYS = Number(process.env.SIGNAL_HEALTH_LOOKBACK_DAYS || 30);
const HEALTH_MIN_TRADES = Number(process.env.SIGNAL_HEALTH_MIN_TRADES || 20);

const TARGET_SPOT_WALLETS = Number(process.env.WHALE_TARGET_SPOT_WALLETS || 5);
const TARGET_FUTURES_WALLETS = Number(process.env.WHALE_TARGET_FUTURES_WALLETS || 5);
const DISCOVERY_TTL_MIN = Number(process.env.WHALE_DISCOVERY_TTL_MIN || 10);
const DISCOVERY_FUTURES_ACTIVE_SELECTION = String(process.env.WHALE_DISCOVERY_FUTURES_ACTIVE_SELECTION || 'true').toLowerCase() !== 'false';
const FUTURES_MIN_ACTIVE_FILLS = Number(process.env.WHALE_DISCOVERY_FUTURES_MIN_ACTIVE_FILLS || 5);
const FUTURES_MIN_ACTIVE_VOLUME_USD = Number(process.env.WHALE_DISCOVERY_FUTURES_MIN_ACTIVE_VOLUME_USD || 25000);
const FUTURES_DISCOVERY_MIN_FRESH_ADD_USD = Number(process.env.WHALE_DISCOVERY_FUTURES_MIN_FRESH_ADD_USD || 100);
const FUTURES_MIN_SIGNAL_ADD_USD = Number(process.env.SIGNAL_FUTURES_MIN_SIGNAL_ADD_USD || FUTURES_MIN_MEANINGFUL_ADD_NOTIONAL_USD);
const FUTURES_MIN_SIGNAL_WINDOW_NOTIONAL_USD = Number(process.env.SIGNAL_FUTURES_MIN_SIGNAL_WINDOW_NOTIONAL_USD || 100);
const SPOT_MIN_SIGNAL_BUY_USD = Number(process.env.SIGNAL_SPOT_MIN_SIGNAL_BUY_USD || SPOT_MIN_BUY_USD);
const SPOT_MAX_SIGNAL_AGE_MIN = Number(process.env.SIGNAL_SPOT_MAX_SIGNAL_AGE_MIN || 5);
const FUTURES_MAX_SIGNALS_PER_WALLET = Number(process.env.SIGNAL_FUTURES_MAX_SIGNALS_PER_WALLET || 3);
const FUTURES_STATE_FALLBACK_FROM_FILLS = String(process.env.SIGNAL_FUTURES_STATE_FALLBACK_FROM_FILLS || 'true').toLowerCase() !== 'false';
const FUTURES_FILL_SOURCE_FALLBACK = String(process.env.SIGNAL_FUTURES_FILL_SOURCE_FALLBACK || 'true').toLowerCase() !== 'false';
const FUTURES_MIN_ADD_SIZE_USD = Number(process.env.SIGNAL_FUTURES_MIN_ADD_SIZE_USD || FUTURES_MIN_SIGNAL_ADD_USD);
const PERFORMANCE_MIN_CLOSED_TRADE_USD = Number(process.env.SIGNAL_PERFORMANCE_MIN_CLOSED_TRADE_USD || 0.10);
const DISCOVERY_LOOKBACK_HOURS = Number(process.env.WHALE_DISCOVERY_LOOKBACK_HOURS || 48);
const DISCOVERY_MIN_HOLD_HOURS = Number(process.env.WHALE_DISCOVERY_MIN_HOLD_HOURS || 1);
const DISCOVERY_MAX_HOLD_HOURS = Number(process.env.WHALE_DISCOVERY_MAX_HOLD_HOURS || 24);
const DISCOVERY_MIN_VOLUME_USD = Number(process.env.WHALE_DISCOVERY_MIN_VOLUME_USD || 250000);
const DISCOVERY_MIN_COMPLETED = Number(process.env.WHALE_DISCOVERY_MIN_COMPLETED || 3);
const DISCOVERY_MIN_IN_WINDOW = Number(process.env.WHALE_DISCOVERY_MIN_IN_WINDOW || 5);
const DISCOVERY_MIN_HOLD_RATIO = Number(process.env.WHALE_DISCOVERY_MIN_HOLD_RATIO || 0.5);
const DISCOVERY_MIN_RECENT_LIFECYCLES = Number(process.env.WHALE_DISCOVERY_MIN_RECENT_LIFECYCLES || 1);
const DISCOVERY_MAX_CANDIDATES = Number(process.env.WHALE_DISCOVERY_MAX_CANDIDATES || 30);
const DISCOVERY_FUTURES_QUICK_LOOKBACK_HOURS = Number(process.env.WHALE_DISCOVERY_FUTURES_QUICK_LOOKBACK_HOURS || 12);
const DISCOVERY_FUTURES_DEEP_CANDIDATES = Number(process.env.WHALE_DISCOVERY_FUTURES_DEEP_CANDIDATES || 30);
const DISCOVERY_FUTURES_QUICK_MAX_PAGES = Number(process.env.WHALE_DISCOVERY_FUTURES_QUICK_MAX_PAGES || 1);
const DISCOVERY_FUTURES_DEEP_MAX_PAGES = Number(process.env.WHALE_DISCOVERY_FUTURES_DEEP_MAX_PAGES || 8);
const DISCOVERY_FUTURES_DEEP_DELAY_MS = Number(process.env.WHALE_DISCOVERY_FUTURES_DEEP_DELAY_MS || 350);
const DISCOVERY_RPC_FAST_RETRIES = Number(process.env.WHALE_DISCOVERY_RPC_FAST_RETRIES || 2);
const DISCOVERY_RPC_FAST_DELAY_MS = Number(process.env.WHALE_DISCOVERY_RPC_FAST_DELAY_MS || 700);
const DISCOVERY_SPOT_PROGRAM_SIGS = Number(process.env.WHALE_DISCOVERY_SPOT_PROGRAM_SIGS || 8);
const DISCOVERY_SPOT_PROGRAM_TXS = Number(process.env.WHALE_DISCOVERY_SPOT_PROGRAM_TXS || 4);
const DISCOVERY_SPOT_TOP_TOKENS = Number(process.env.WHALE_DISCOVERY_SPOT_TOP_TOKENS || 20);
const DISCOVERY_SPOT_TOP_HOLDERS = Number(process.env.WHALE_DISCOVERY_SPOT_TOP_HOLDERS || 8);
const DISCOVERY_SPOT_MAX_CANDIDATES = Number(process.env.WHALE_DISCOVERY_SPOT_MAX_CANDIDATES || 8);
const DISCOVERY_STATE_FILE = process.env.WHALE_DISCOVERY_STATE_FILE || 'state/whale_watchlist.json';
const DISCOVERY_SCHEMA = 'V6.1-SPOT-PERFORMANCE-FUTURES-RECON-AUDITED';
const DISCOVERY_ALLOW_ACTIVE_FALLBACK = String(process.env.WHALE_DISCOVERY_ALLOW_ACTIVE_FALLBACK || 'true').toLowerCase() !== 'false';
const DISCOVERY_SIGNAL_READY_ONLY = String(process.env.WHALE_DISCOVERY_SIGNAL_READY_ONLY || 'false').toLowerCase() === 'true';
// Explicit quality-evidence aliases kept in the worker so the static audit and runtime use the same contract.
const DISCOVERY_SPOT_MIN_EVIDENCE_TRADES = Number(process.env.WHALE_DISCOVERY_SPOT_MIN_EVIDENCE_TRADES || 10);
const DISCOVERY_SPOT_MIN_RECENT_BUYS = Number(process.env.WHALE_DISCOVERY_SPOT_MIN_RECENT_BUYS || 2);
const DISCOVERY_SPOT_MIN_RECENT_BUY_USD = Number(process.env.WHALE_DISCOVERY_SPOT_MIN_RECENT_BUY_USD || 100);
const DISCOVERY_ACTIVE_MIN_RECENT_BUYS = Number(process.env.WHALE_DISCOVERY_ACTIVE_MIN_RECENT_BUYS || 2);
const DISCOVERY_ACTIVE_MIN_RECENT_BUY_USD = Number(process.env.WHALE_DISCOVERY_ACTIVE_MIN_RECENT_BUY_USD || 100);
const DISCOVERY_ACTIVE_MIN_TOTAL_TRADES = Number(process.env.WHALE_DISCOVERY_ACTIVE_MIN_TOTAL_TRADES || 10);
const SPOT_PERFORMANCE_MAX_PAGES = Number(process.env.SIGNAL_SPOT_PERFORMANCE_MAX_PAGES || 12);
const SPOT_PERFORMANCE_PAGE_DELAY_MS = Number(process.env.SIGNAL_SPOT_PERFORMANCE_PAGE_DELAY_MS || 250);
const DISCOVERY_FALLBACK_MIN_RECENT_ADDS = Number(process.env.WHALE_DISCOVERY_FALLBACK_MIN_RECENT_ADDS || 1);
const DISCOVERY_FALLBACK_MIN_RECENT_BUYS = Number(process.env.WHALE_DISCOVERY_FALLBACK_MIN_RECENT_BUYS || DISCOVERY_ACTIVE_MIN_RECENT_BUYS);
const DISCOVERY_FILL_PAGE_SIZE = Number(process.env.WHALE_DISCOVERY_FILL_PAGE_SIZE || 2000);
const DISCOVERY_FILL_MAX_PAGES = Number(process.env.WHALE_DISCOVERY_FILL_MAX_PAGES || 8);
const DISCOVERY_RPC_DELAY_MS = Number(process.env.WHALE_DISCOVERY_RPC_DELAY_MS || 1800);
const DISCOVERY_RPC_RETRIES = Number(process.env.WHALE_DISCOVERY_RPC_RETRIES || 5);
const DISCOVERY_SPOT_TOKEN_COUNT = Number(process.env.WHALE_DISCOVERY_SPOT_TOKEN_COUNT || 8);
const DISCOVERY_SPOT_HOLDER_COUNT = Number(process.env.WHALE_DISCOVERY_SPOT_HOLDER_COUNT || 5);
const DISCOVERY_SPOT_CANDIDATE_WALLETS = Number(process.env.WHALE_DISCOVERY_SPOT_CANDIDATE_WALLETS || 16);
const DISCOVERY_SPOT_TX_LIMIT = Number(process.env.WHALE_DISCOVERY_SPOT_TX_LIMIT || 30);
const DISCOVERY_SPOT_FINALISTS = Number(process.env.WHALE_DISCOVERY_SPOT_FINALISTS || 12);
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
    if(x?.schema===DISCOVERY_SCHEMA&&ageMin>=0&&ageMin<DISCOVERY_TTL_MIN&&Array.isArray(x?.spotWallets)&&Array.isArray(x?.futuresWallets)&&x.spotWallets.length>0&&x.futuresWallets.length>0){
      console.log(`[DISCOVERY][CACHE] age=${ageMin.toFixed(1)}m spot=${x.spotWallets.length} futures=${x.futuresWallets.length}`);
      return x;
    }
    console.log(`[DISCOVERY][CACHE] stale-schema-or-empty`);
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
async function solDiscovery(body,label='sol-discovery'){
  let lastErr=null;
  for(let attempt=1;attempt<=DISCOVERY_RPC_RETRIES;attempt++){
    try{return await sol(body,label+`:a${attempt}`)}catch(e){
      lastErr=e; const msg=String(e?.message||e); const is429=/429|rate.?limit|too many requests/i.test(msg);
      if(attempt>=DISCOVERY_RPC_RETRIES)break;
      const wait=DISCOVERY_RPC_DELAY_MS*Math.pow(2,attempt-1)+(is429?1000:0);
      console.log(`[DISCOVERY][RPC-RETRY] ${label} attempt=${attempt} reason=${msg.slice(0,100)} wait=${wait}ms`); await sleep(wait);
    }
  }
  throw lastErr||new Error(`${label}:FAILED`);
}
async function solDiscoveryFast(body,label='sol-fast'){
  let lastErr=null;
  for(let attempt=1;attempt<=DISCOVERY_RPC_FAST_RETRIES;attempt++){
    try{return await sol(body,label+`:a${attempt}`)}catch(e){
      lastErr=e; const msg=String(e?.message||e);
      if(attempt>=DISCOVERY_RPC_FAST_RETRIES)break;
      const wait=DISCOVERY_RPC_FAST_DELAY_MS*Math.pow(2,attempt-1)+(/429|rate.?limit|too many requests/i.test(msg)?300:0);
      await sleep(wait);
    }
  }
  throw lastErr||new Error(`${label}:FAILED`);
}
async function fetchFillsPaginated(w,startTime,endTime,label='discover',maxPages=DISCOVERY_FILL_MAX_PAGES,betweenMs=FUTURES_BETWEEN_WALLETS_MS){
  const all=[]; const seen=new Set(); let cursorEnd=endTime; let pages=0; let truncated=false;
  while(pages<maxPages){
    pages++;
    let rows=[]; let lastErr=null;
    for(let attempt=1;attempt<=FUTURES_FETCH_RETRY;attempt++){
      try{
        const r=await hl({type:'userFillsByTime',user:w.address,startTime,endTime:cursorEnd},`${label}:${w.name}:p${pages}:a${attempt}`);
        if(!Array.isArray(r))throw new Error('FILLS_RESPONSE_NOT_ARRAY');
        rows=r; break;
      }catch(e){
        lastErr=e; const msg=String(e?.message||e); const is429=/429|rate.?limit|too many requests/i.test(msg);
        if(attempt>=FUTURES_FETCH_RETRY)break;
        const wait=FUTURES_RETRY_BASE_MS*Math.pow(2,attempt-1)+(is429?700:0);
        console.log(`[DISCOVERY][FILL-RETRY] ${w.name} page=${pages} attempt=${attempt} wait=${wait}ms reason=${msg.slice(0,100)}`);
        await sleep(wait);
      }
    }
    if(!rows.length){ if(lastErr) throw lastErr; break; }
    for(const f of rows){
      const key=String(f?.hash||'')+'|'+n(f?.time)+'|'+String(f?.coin||'')+'|'+String(f?.px||'')+'|'+String(f?.sz||'')+'|'+String(f?.dir||'');
      if(!seen.has(key)){seen.add(key);all.push(f);}
    }
    const times=rows.map(x=>n(x?.time)).filter(Boolean);
    const oldest=times.length?Math.min(...times):0;
    console.log(`[DISCOVERY][PAGINATION] ${w.name} page=${pages} rows=${rows.length} oldest=${oldest?new Date(oldest).toISOString():'NONE'} total=${all.length}`);
    if(rows.length<DISCOVERY_FILL_PAGE_SIZE || !oldest || oldest<=startTime){break;}
    cursorEnd=oldest-1;
    await sleep(betweenMs);
  }
  if(pages>=maxPages && all.length>0)truncated=true;
  return {fills:all,pages,truncated};
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
function fillPostPosition(f){
  const start=Number(f?.startPosition), sz=Math.abs(n(f?.sz));
  if(!Number.isFinite(start)||!(sz>0))return null;
  const dir=String(f?.dir||'').toLowerCase();
  if(dir.includes('open long')||dir.includes('close short'))return start+sz;
  if(dir.includes('open short')||dir.includes('close long'))return start-sz;
  const side=String(f?.side||'').toUpperCase();
  if(side==='B')return start+sz;
  if(side==='A')return start-sz;
  return null;
}
function recentAddStatsFromFills(fills,now=Date.now(),lookbackMin=FUTURES_SIGNAL_FRESHNESS_MIN){
  const cutoff=now-lookbackMin*60000; let count=0,notional=0;
  for(const f of fills||[]){
    const t=n(f?.time),px=n(f?.px),sz=Math.abs(n(f?.sz)); if(!(t>=cutoff)||!(px>0)||!(sz>0))continue;
    const before=Math.abs(Number(f?.startPosition)); const afterPos=fillPostPosition(f);
    if(Number.isFinite(before)&&Number.isFinite(afterPos)&&Math.abs(afterPos)>before+1e-12){count++;notional+=(Math.abs(afterPos)-before)*px;}
  }
  return {count,notional};
}

function holdStatsFromFills(fills){
  const byCoin=new Map();
  for(const f of fills||[]) if(f?.coin){ if(!byCoin.has(f.coin))byCoin.set(f.coin,[]); byCoin.get(f.coin).push(f); }
  const lifecycles=[]; let totalVolume=0; let additions=0; let partialReductions=0;
  const now=Date.now(); const cutoff=now-DISCOVERY_LOOKBACK_HOURS*3600000;
  for(const [coin,list0] of byCoin){
    const list=list0.filter(f=>n(f.time)>=cutoff).sort((a,b)=>n(a.time)-n(b.time));
    let pos=0, lifecycle=null;
    for(const f of list){
      const px=n(f.px), sz=Math.abs(n(f.sz)), t=n(f.time);
      if(!(px>0)||!(sz>0)||!Number.isFinite(t))continue;
      totalVolume+=px*sz;
      const sp=n(f.startPosition);
      const dir=String(f.dir||'').toLowerCase();
      let post=positionPostFromFill(f);
      if(post===null){
        const d=dir.includes('open long')||dir.includes('close short')?sz:dir.includes('open short')||dir.includes('close long')?-sz:0;
        post=sp+d;
      }
      if(!Number.isFinite(post))continue;
      const before=pos;
      pos=post;
      const beforeAbs=Math.abs(before), afterAbs=Math.abs(post);
      if(afterAbs>beforeAbs+1e-12){
        additions++;
        if(!lifecycle || Math.sign(before)!==Math.sign(post)){
          if(lifecycle && beforeAbs>0 && Math.sign(before)!==Math.sign(post)){
            const h=(t-lifecycle.openTime)/3600000;
            if(h>=0)lifecycles.push({...lifecycle,coin,closeTime:t,holdHours:h,closedBy:'FLIP'});
          }
          lifecycle={openTime:t,side:post>0?'LONG':'SHORT',adds:1,maxSize:afterAbs,volume:px*sz};
        }else{
          lifecycle.adds++; lifecycle.maxSize=Math.max(lifecycle.maxSize,afterAbs); lifecycle.volume+=px*sz;
        }
      }else if(afterAbs<beforeAbs-1e-12){
        partialReductions++;
        if(afterAbs<=1e-12 && lifecycle){
          const h=(t-lifecycle.openTime)/3600000;
          if(h>=0)lifecycles.push({...lifecycle,coin,closeTime:t,holdHours:h,closedBy:'FLAT'});
          lifecycle=null;
        }
      }
    }
  }
  const completed=lifecycles.length;
  const inWindow=lifecycles.filter(h=>h.holdHours>=DISCOVERY_MIN_HOLD_HOURS&&h.holdHours<=DISCOVERY_MAX_HOLD_HOURS);
  const hs=inWindow.map(h=>h.holdHours).sort((a,b)=>a-b);
  const median=hs.length?hs[Math.floor(hs.length/2)]:0;
  const avg=hs.length?hs.reduce((a,b)=>a+b,0)/hs.length:0;
  const recentWindow=lifecycles.filter(h=>n(h.closeTime)>=now-24*3600000);
  return {lifecycles,completed,inWindow:inWindow.length,holdRatio:completed?inWindow.length/completed:0,medianHoldHours:median,avgHoldHours:avg,totalVolume,additions,partialReductions,recentLifecycles:recentWindow.length,recentActivity:recentWindow.length>0};
}

async function discoverFutures(){
  const rows=await fetchLeaderboard();
  const candidates=rows.filter(r=>/^0x[a-fA-F0-9]{40}$/.test(String(r?.ethAddress||'')))
    .map(r=>{const d=lbMetric(r,'pnl'),w=lbMetric(r,'vlm'); return {...r,pnl7:d.week,pnl30:d.month,volume7:w.week,volume1d:w.day};})
    .filter(r=>r.volume7>=Math.max(50000,DISCOVERY_MIN_VOLUME_USD/2))
    .sort((a,b)=>(b.volume1d-a.volume1d)+(b.pnl7-a.pnl7)*0.01)
    .slice(0,DISCOVERY_MAX_CANDIDATES);
  console.log(`[DISCOVERY][FUTURES] prefilter=${candidates.length} quick=${DISCOVERY_FUTURES_QUICK_LOOKBACK_HOURS}h deep=${DISCOVERY_FUTURES_DEEP_CANDIDATES}`);

  // Stage 1: cheap recent-activity screen. One page only; incomplete history is expected here.
  const quick=[];
  for(const r of candidates){
    const w={name:`HL_${String(r.ethAddress).slice(2,6).toUpperCase()}`,address:r.ethAddress};
    try{
      const end=Date.now(), start=end-DISCOVERY_FUTURES_QUICK_LOOKBACK_HOURS*3600000;
      const pg=await fetchFillsPaginated(w,start,end,'quick',DISCOVERY_FUTURES_QUICK_MAX_PAGES,0);
      const st=holdStatsFromFills(pg.fills);
      const recentVolume=st.totalVolume;
      const recentFills=pg.fills.length;
      const fresh=recentAddStatsFromFills(pg.fills,end,FUTURES_SIGNAL_FRESHNESS_MIN);
      const signalReady=fresh.count>0&&fresh.notional>=FUTURES_DISCOVERY_MIN_FRESH_ADD_USD;
      const activeQuality=recentFills>=FUTURES_MIN_ACTIVE_FILLS&&recentVolume>=FUTURES_MIN_ACTIVE_VOLUME_USD;
      // Discovery must not suppress active Futures traders merely because the
      // current 15m window has no ADD or the quick volume is below the quality
      // threshold. Those are signal/quality decisions for scanFutures(), not
      // discovery gates. Any real recent fill is enough to enter deep audit.
      if(recentFills<=0)continue;
      quick.push({...w,raw:r,quick:{recentFills,recentVolume,adds:st.additions,recentAdds:fresh.count,recentAddNotional:fresh.notional,signalReady,activeQuality}});
    }catch(e){console.log(`[DISCOVERY][FUTURES][QUICK] ${w.name} ERROR ${String(e?.message||e).slice(0,100)}`)}
  }
  console.log(`[DISCOVERY][FUTURES][QUICK] accepted=${quick.length} signalReady=${quick.filter(x=>x.quick.signalReady).length} activeQuality=${quick.filter(x=>x.quick.activeQuality).length} minFreshADD=$${FUTURES_DISCOVERY_MIN_FRESH_ADD_USD}`);
  quick.sort((a,b)=>(b.quick.recentAdds-a.quick.recentAdds)*100000000+(b.quick.recentAddNotional-a.quick.recentAddNotional)*10+(b.quick.recentVolume-a.quick.recentVolume));
  const deepPool=quick.slice(0,DISCOVERY_FUTURES_DEEP_CANDIDATES);
  console.log(`[DISCOVERY][FUTURES][DEEP-POOL] ${deepPool.length}/${candidates.length}`);

  const scored=[];
  for(const x of deepPool){
    const w=x, r=x.raw;
    try{
      const end=Date.now(), start=end-DISCOVERY_LOOKBACK_HOURS*3600000;
      const pg=await fetchFillsPaginated(w,start,end,'deep',DISCOVERY_FUTURES_DEEP_MAX_PAGES,DISCOVERY_FUTURES_DEEP_DELAY_MS);
      const st=holdStatsFromFills(pg.fills);
      const fresh=recentAddStatsFromFills(pg.fills,end,FUTURES_SIGNAL_FRESHNESS_MIN);
      // A deep audit is valid only when the pagination reached the requested window or
      // returned fewer than a full page. If the API still has a full page at the cap,
      // we mark it incomplete and do not rank it as fully verified.
      const complete=!pg.truncated;
      const qualificationReasons=[]; if(!complete)qualificationReasons.push('INCOMPLETE_HISTORY'); if(st.completed<DISCOVERY_MIN_COMPLETED)qualificationReasons.push(`ROUND_TRIPS<${DISCOVERY_MIN_COMPLETED}`); if(st.inWindow<DISCOVERY_MIN_IN_WINDOW)qualificationReasons.push(`HOLD_1_24H<${DISCOVERY_MIN_IN_WINDOW}`); if(st.holdRatio<DISCOVERY_MIN_HOLD_RATIO)qualificationReasons.push(`HOLD_RATIO<${Math.round(DISCOVERY_MIN_HOLD_RATIO*100)}%`); if(st.recentLifecycles<DISCOVERY_MIN_RECENT_LIFECYCLES)qualificationReasons.push(`RECENT_CLOSED_24H<${DISCOVERY_MIN_RECENT_LIFECYCLES}`); if(st.totalVolume<DISCOVERY_MIN_VOLUME_USD)qualificationReasons.push(`VOLUME<${DISCOVERY_MIN_VOLUME_USD}`); const qualifies=qualificationReasons.length===0;
      const activeFallback=DISCOVERY_ALLOW_ACTIVE_FALLBACK && st.additions>=FUTURES_MIN_ACTIVE_FILLS && st.totalVolume>=FUTURES_MIN_ACTIVE_VOLUME_USD;
      console.log(`[DISCOVERY][FUTURES][LIFECYCLE] ${w.name} fills=${pg.fills.length} pages=${pg.pages} complete=${complete} volume48h=${Math.round(st.totalVolume)} lifecycle=${st.completed} hold1-24=${st.inWindow} ratio=${(st.holdRatio*100).toFixed(0)}% median=${st.medianHoldHours.toFixed(2)}h recentClosed24h=${st.recentLifecycles} adds=${st.additions} partialReductions=${st.partialReductions} qualifies=${qualifies}${qualifies?'':' reason='+qualificationReasons.join(',')} fallback=${activeFallback}`);
      if(qualifies || activeFallback){
        const discovery={volume48h:st.totalVolume,completedLifecycles:st.completed,inWindow:st.inWindow,holdRatio:st.holdRatio,medianHoldHours:st.medianHoldHours,avgHoldHours:st.avgHoldHours,recentLifecycles:st.recentLifecycles,observedAdds:st.additions,pnl7:r.pnl7,pnl30:r.pnl30,leaderboardVolume7:r.volume7,accountValue:n(r.accountValue),recentAdds:fresh.count,recentAddNotional:fresh.notional,quality:qualifies?'QUALIFIED':'ACTIVE_FALLBACK',qualificationReasons};
        discovery.score=(qualifies?100000:0)+(st.inWindow*8)+(st.recentLifecycles*10)+(st.holdRatio*25)+Math.min(30,Math.log10(Math.max(1,st.totalVolume)))*3+Math.min(20,st.additions/20)+(fresh.count*100)+(Math.min(10,fresh.notional/1000))+(r.pnl7>0?10:0);
        scored.push({...w,discovery});
      }
    }catch(e){console.log(`[DISCOVERY][FUTURES][DEEP] ${w.name} ERROR ${String(e?.message||e).slice(0,120)}`)}
    await sleep(DISCOVERY_FUTURES_DEEP_DELAY_MS);
  }
  scored.sort((a,b)=>{
    const af=n(a.discovery.recentAdds), bf=n(b.discovery.recentAdds);
    const an=n(a.discovery.recentAddNotional), bn=n(b.discovery.recentAddNotional);
    return (bf-af)*1000000 + (bn-an)*10 + (n(b.discovery.score)-n(a.discovery.score));
  });
  // Deep qualification is a quality label, never the sole path into the
  // Futures watchlist. If deep history is incomplete or strict lifecycle
  // criteria reject a trader, retain the trader when the quick scan proved
  // there is real recent Hyperliquid activity. scanFutures() remains the hard
  // signal gate, so this cannot manufacture a signal.
  const scoredAddresses=new Set(scored.map(x=>String(x.address).toLowerCase()));
  const activeFallbackPool=quick.filter(x=>!scoredAddresses.has(String(x.address).toLowerCase())).map(x=>({
    ...x,
    discovery:{
      volume48h:n(x.quick?.recentVolume), completedLifecycles:0, inWindow:0, holdRatio:0,
      medianHoldHours:0, avgHoldHours:0, recentLifecycles:0, observedAdds:n(x.quick?.adds),
      pnl7:n(x.raw?.pnl7), pnl30:n(x.raw?.pnl30), leaderboardVolume7:n(x.raw?.volume7),
      accountValue:n(x.raw?.accountValue), recentAdds:n(x.quick?.recentAdds),
      recentAddNotional:n(x.quick?.recentAddNotional), quality:'ACTIVE_QUICK_FALLBACK',
      qualificationReasons:['DEEP_NOT_QUALIFIED_OR_INCOMPLETE'],
      score:50000+(n(x.quick?.recentAdds)*100)+(Math.min(20,n(x.quick?.recentAddNotional)/1000))+(Math.min(20,n(x.quick?.recentVolume)/100000))
    }
  }));
  const activePool=[...scored,...activeFallbackPool];
  activePool.sort((a,b)=>{
    const ar=n(a.discovery.recentAdds), br=n(b.discovery.recentAdds);
    const an=n(a.discovery.recentAddNotional), bn=n(b.discovery.recentAddNotional);
    return (br-ar)*1000000+(bn-an)*10+(n(b.discovery.score)-n(a.discovery.score));
  });
  const signalReadyPool=activePool.filter(x=>n(x.discovery.recentAdds)>0 && n(x.discovery.recentAddNotional)>=FUTURES_MIN_SIGNAL_WINDOW_NOTIONAL_USD);
  // Signal-ready candidates are always ranked first. Active-selection mode may fill remaining
  // watchlist slots with active traders, but those traders can NEVER bypass the fresh-add gate
  // inside scanFutures(). This keeps discovery useful without manufacturing stale signals.
  const freshPool=signalReadyPool;
  let selected;
  if(DISCOVERY_SIGNAL_READY_ONLY){
    selected=freshPool.slice(0,TARGET_FUTURES_WALLETS);
  }else if(DISCOVERY_FUTURES_ACTIVE_SELECTION){
    // Keep active traders in the watchlist even when this exact discovery moment
    // has no fresh ADD. The signal scanner re-checks fills every cycle and never
    // promotes a stale ADD into a signal.
    selected=[...freshPool,...activePool.filter(x=>!freshPool.some(y=>y.address===x.address))].slice(0,TARGET_FUTURES_WALLETS);
  }else{
    selected=freshPool.slice(0,TARGET_FUTURES_WALLETS);
  }
  console.log(`[DISCOVERY][FUTURES][SIGNAL-READY-POOL] ready=${signalReadyPool.length}/${TARGET_FUTURES_WALLETS} fresh=${freshPool.length} activePool=${activePool.length} quickFallback=${activeFallbackPool.length} signalReadyOnly=${DISCOVERY_SIGNAL_READY_ONLY} activeSelection=${DISCOVERY_FUTURES_ACTIVE_SELECTION}`);
  console.log(`[DISCOVERY][FUTURES][SELECTION] selected=${selected.length} freshReady=${selected.filter(x=>freshPool.some(y=>y.address===x.address)).length} qualified=${selected.filter(x=>x.discovery.quality==='QUALIFIED').length} fallback=${selected.filter(x=>String(x.discovery.quality||'').includes('FALLBACK')).length}`);
  console.log(`[DISCOVERY][FUTURES][WATCHLIST-AUDIT] scannedCandidates=${candidates.length} quickActivity=${quick.length} deepScored=${scored.length} activeFallback=${activeFallbackPool.length} selected=${selected.length}`);
  return selected;
}

async function fetchSpotDiscoveryTokens(){
  const out=new Map();
  const urls=['https://tokens.jup.ag/tokens?tags=verified','https://tokens.jup.ag/tokens_with_markets'];
  for(const u of urls){
    try{const rows=await fetchJson(u,{},'jupiter:tokens'); if(Array.isArray(rows)) for(const t of rows){ if(t?.address)out.set(t.address,t); } if(out.size)break;}
    catch(e){console.log(`[DISCOVERY][SPOT][TOKENS] Jupiter failed ${String(e?.message||e).slice(0,120)}`)}
  }
  if(out.size)return [...out.values()];
  const queries=['SOL','USDC','WIF','BONK','JUP','PYTH','RAY','JTO','POPCAT','MEW'];
  for(const q of queries){
    try{
      const r=await fetchJson(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`,{},`dex-search:${q}`);
      for(const p of (r?.pairs||[]).filter(x=>String(x?.chainId)==='solana')){
        for(const t of [p?.baseToken,p?.quoteToken]) if(t?.address) out.set(t.address,{address:t.address,symbol:t.symbol||t.address.slice(0,6),name:t.name||'',daily_volume:n(p?.volume?.h24),liquidity:{usd:n(p?.liquidity?.usd)}});
      }
    }catch(e){console.log(`[DISCOVERY][SPOT][TOKENS] DexScreener ${q} failed ${String(e?.message||e).slice(0,100)}`)}
  }
  return [...out.values()];
}

async function discoverSpotCandidates(){
  if(!HELIUS_ENHANCED_ENABLED){
    console.log('[DISCOVERY][SPOT][HELIUS] disabled: set production secret HELIUS_API_KEY; public-RPC program transaction fan-out is intentionally disabled');
    return [];
  }
  const programs=[
    ['JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4','JUPITER'],
    ['675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8','RAYDIUM'],
    ['6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P','PUMPFUN'],
    ['whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc','ORCA']
  ];
  const owners=await heliusProgramUniverse(programs);
  const pool=[...owners.entries()].sort((a,b)=>b[1]-a[1]).slice(0,DISCOVERY_SPOT_MAX_CANDIDATES);
  console.log(`[DISCOVERY][SPOT][HELIUS-UNIVERSE] wallets=${pool.length}`);
  const finals=[];
  const solUsd=(await tokenInfo(WSOL_MINT)).price||await tokenPrice(WSOL_MINT);
  for(const [address,programHits] of pool){
    try{
      const txs=await heliusEnhancedTransactions(address,100,'',`wallet:${address.slice(0,6)}`);
      const cutoff=Date.now()-DISCOVERY_LOOKBACK_HOURS*3600000;
      const lots=new Map(), lifecycles=[];
      let buys=0,sells=0,volumeUsd=0,lastTrade=0;
      for(const tx of txs){
        const bt=n(tx?.timestamp)*1000; if(!bt||bt<cutoff)continue;
        const sw=enhancedSwap(tx,address,solUsd); if(!sw)continue;
        lastTrade=Math.max(lastTrade,bt);
        if(sw.direction==='BUY'){
          buys++; volumeUsd+=sw.fundingUsd;
          if(!lots.has(sw.mint))lots.set(sw.mint,[]);
          lots.get(sw.mint).push({time:bt,qty:sw.tokenAmount});
        }else if(sw.direction==='SELL'){
          sells++; volumeUsd+=sw.fundingUsd;
          let remain=sw.tokenAmount, q=lots.get(sw.mint)||[];
          while(remain>0&&q.length){
            const lot=q[0],take=Math.min(remain,lot.qty),h=(bt-lot.time)/3600000;
            if(h>=0)lifecycles.push({mint:sw.mint,openTime:lot.time,closeTime:bt,holdHours:h});
            lot.qty-=take; remain-=take; if(lot.qty<=1e-12)q.shift();
          }
        }
      }
      const inWindow=lifecycles.filter(x=>x.holdHours>=DISCOVERY_MIN_HOLD_HOURS&&x.holdHours<=DISCOVERY_MAX_HOLD_HOURS);
      const hs=inWindow.map(x=>x.holdHours).sort((a,b)=>a-b);
      const medianHold=hs.length?hs[Math.floor(hs.length/2)]:0;
      const roundTrips=lifecycles.length, holdRatio=roundTrips?inWindow.length/roundTrips:0;
      const recentLifecycles=inWindow.filter(x=>Date.now()-x.closeTime<=24*3600000).length;
      const freshCutoff=Date.now()-SPOT_ACTIVITY_LOOKBACK_MIN*60000;
      let recentBuys=0,recentBuyVolume=0;
      for(const tx of txs){
        const bt=n(tx?.timestamp)*1000; if(!(bt>=freshCutoff))continue;
        const sw=enhancedSwap(tx,address,solUsd);
        if(sw?.direction==='BUY' && n(sw.fundingUsd)>=SPOT_MIN_BUY_USD){recentBuys++;recentBuyVolume+=n(sw.fundingUsd);}
      }
      const qualificationReasons=spotQualificationReasons({roundTrips,inWindow:inWindow.length,holdRatio,medianHold,volumeUsd,lastTrade}); const qualifies=qualificationReasons.length===0;
      const totalTradeEvidence=buys+sells;
      const spotQualityEvidence = totalTradeEvidence>=DISCOVERY_SPOT_MIN_EVIDENCE_TRADES &&
        recentBuys>=DISCOVERY_SPOT_MIN_RECENT_BUYS &&
        recentBuyVolume>=DISCOVERY_SPOT_MIN_RECENT_BUY_USD;
      const activeFallback=DISCOVERY_ALLOW_ACTIVE_FALLBACK && spotQualityEvidence &&
        recentBuys>=Math.max(DISCOVERY_FALLBACK_MIN_RECENT_BUYS,DISCOVERY_SPOT_MIN_RECENT_BUYS) &&
        recentBuyVolume>=Math.max(SPOT_MIN_BUY_USD,DISCOVERY_SPOT_MIN_RECENT_BUY_USD) &&
        totalTradeEvidence>=Math.max(DISCOVERY_ACTIVE_MIN_TOTAL_TRADES,DISCOVERY_SPOT_MIN_EVIDENCE_TRADES);
      console.log(`[DISCOVERY][SPOT][HELIUS-LIFECYCLE] SOL_${address.slice(0,4).toUpperCase()} tx=${txs.length} buys=${buys} sells=${sells} roundTrips=${roundTrips} hold1-24=${inWindow.length} ratio=${(holdRatio*100).toFixed(0)}% median=${medianHold.toFixed(2)}h volume24h=${Math.round(volumeUsd)} recent=${recentLifecycles} freshBuys=${recentBuys} freshBuyVol=${Math.round(recentBuyVolume)} programHits=${programHits} qualifies=${qualifies}${qualifies?'':' reason='+qualificationReasons.join(',')} fallback=${activeFallback}`);
      if(qualifies || activeFallback)finals.push({name:`SOL_${address.slice(0,4).toUpperCase()}`,address,discovery:{programHits,recentTxs24h:txs.filter(x=>n(x?.timestamp)*1000>=Date.now()-24*3600000).length,buys,sells,recentBuys,recentBuyVolume,roundTrips,inWindow:inWindow.length,holdRatio,medianHoldHours:medianHold,avgHoldHours:hs.length?hs.reduce((a,b)=>a+b,0)/hs.length:0,lastTrade,volumeUsd,recentLifecycles,quality:qualifies?'QUALIFIED':'ACTIVE_FALLBACK',qualificationReasons,score:(qualifies?100000:0)+(buys*8)+(recentLifecycles*12)+(holdRatio*25)+Math.min(25,Math.log10(Math.max(1,volumeUsd)))*2+programHits*4+(recentBuys*120)+(recentBuyVolume>=SPOT_MIN_BUY_USD?80:0)}});
    }catch(e){console.log(`[DISCOVERY][SPOT][HELIUS-FINAL] ${short(address)} ERROR ${String(e?.message||e).slice(0,120)}`)}
    await sleep(300);
    if(finals.length>=TARGET_SPOT_WALLETS)break;
  }
  finals.sort((a,b)=>b.discovery.score-a.discovery.score);
  const selected=finals.slice(0,TARGET_SPOT_WALLETS);
  console.log(`[DISCOVERY][SPOT][SELECTION] selected=${selected.length} qualified=${selected.filter(x=>x.discovery.quality==='QUALIFIED').length} fallback=${selected.filter(x=>x.discovery.quality==='ACTIVE_FALLBACK').length}`);
  return selected;
}

async function solSignaturesForDiscovery(address,limit=60){
  const r=await solDiscovery({method:'getSignaturesForAddress',params:[address,{limit}]},`discover:sigs:${String(address).slice(0,6)}`);
  return Array.isArray(r?.result)?r.result.filter(x=>!x.err):[];
}
async function solTxDiscovery(sig){
  return solDiscovery({method:'getTransaction',params:[sig,{encoding:'jsonParsed',maxSupportedTransactionVersion:0}]},`discover:tx:${String(sig).slice(0,8)}`);
}

async function discoverWatchlist(){
  const cached=await readDiscoveryCache();
  if(cached){SPOT_WALLETS=cached.spotWallets;FUTURES_WALLETS=cached.futuresWallets;return cached;}
  console.log(`[DISCOVERY][START] target spot=${TARGET_SPOT_WALLETS} futures=${TARGET_FUTURES_WALLETS} hold=${DISCOVERY_MIN_HOLD_HOURS}-${DISCOVERY_MAX_HOLD_HOURS}h`);
  const spotWallets=await discoverSpotCandidates();
  await sleep(1500);
  const futuresWallets=await discoverFutures();
  const data={schema:DISCOVERY_SCHEMA,generatedAt:Date.now(),criteria:{holdHours:[DISCOVERY_MIN_HOLD_HOURS,DISCOVERY_MAX_HOLD_HOURS],minVolumeUsd:DISCOVERY_MIN_VOLUME_USD,minInWindow:DISCOVERY_MIN_IN_WINDOW,minHoldRatio:DISCOVERY_MIN_HOLD_RATIO},spotWallets,futuresWallets};
  SPOT_WALLETS=spotWallets; FUTURES_WALLETS=futuresWallets;
  await writeDiscoveryCache(data);
  if(SPOT_WALLETS.length<TARGET_SPOT_WALLETS) console.log(`[DISCOVERY][WARN] Spot selected=${SPOT_WALLETS.length}/${TARGET_SPOT_WALLETS}; insufficient active candidates`);
  if(FUTURES_WALLETS.length<TARGET_FUTURES_WALLETS) console.log(`[DISCOVERY][WARN] Futures selected=${FUTURES_WALLETS.length}/${TARGET_FUTURES_WALLETS}; insufficient active candidates`);
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

async function heliusEnhancedTransactions(address,limit=100,before='',label='helius'){
  if(!HELIUS_ENHANCED_ENABLED) throw new Error('HELIUS_API_KEY_MISSING');
  const q=new URLSearchParams({
    'api-key':HELIUS_API_KEY,
    limit:String(Math.min(Math.max(1,limit),100))
  });
  if(before)q.set('before',before);
  let lastErr=null;
  for(let attempt=1;attempt<=3;attempt++){
    try{
      const rows=await fetchJson(`${HELIUS_ENHANCED_BASE}/addresses/${address}/transactions?${q.toString()}`,{},`${label}:a${attempt}`);
      if(!Array.isArray(rows)) throw new Error('HELIUS_RESPONSE_NOT_ARRAY');
      return rows;
    }catch(e){
      lastErr=e;
      const msg=String(e?.message||e);
      if(attempt>=3)break;
      const m=msg.match(/retry[-_ ]?after[=: ]+(\\d+)/i);
      const wait=m?Math.min(15000,Number(m[1])*1000):Math.min(8000,700*Math.pow(2,attempt-1));
      console.log(`[HELIUS][RETRY] ${label} attempt=${attempt} wait=${wait}ms reason=${msg.slice(0,120)}`);
      await sleep(wait);
    }
  }
  throw lastErr||new Error(`${label}:FAILED`);
}
function enhancedAmount(x){
  return Math.abs(n(x?.tokenAmount ?? x?.amount ?? x?.uiAmount ?? 0));
}
function enhancedMint(x){ return String(x?.mint||x?.tokenMint||''); }
function enhancedUser(x,side){ return String(x?.[side+'UserAccount']||''); }
function enhancedSwap(tx,wallet,solUsd,minFundingUsd=SPOT_MIN_BUY_USD){
  if(String(tx?.type||'').toUpperCase()!=='SWAP')return null;
  const walletLc=String(wallet||'').toLowerCase();
  const swap=tx?.events?.swap||{};
  const eventInputs=Array.isArray(swap.tokenInputs)?swap.tokenInputs:[];
  const eventOutputs=Array.isArray(swap.tokenOutputs)?swap.tokenOutputs:[];
  const tokenTransfers=Array.isArray(tx?.tokenTransfers)?tx.tokenTransfers:[];
  const nativeTransfers=Array.isArray(tx?.nativeTransfers)?tx.nativeTransfers:[];
  const norm=(x,fromKey,toKey)=>({mint:enhancedMint(x),amount:enhancedAmount(x),from:String(x?.[fromKey]||x?.fromUserAccount||'').toLowerCase(),to:String(x?.[toKey]||x?.toUserAccount||'').toLowerCase()});

  // Economic wallet flow is authoritative when transaction-level transfers exist:
  // outgoing funding + incoming token = BUY; outgoing token + incoming funding = SELL.
  let outgoing=tokenTransfers.filter(x=>String(x?.fromUserAccount||'').toLowerCase()===walletLc).map(x=>norm(x,'fromUserAccount','toUserAccount')).filter(x=>x.mint&&x.amount>0);
  let incoming=tokenTransfers.filter(x=>String(x?.toUserAccount||'').toLowerCase()===walletLc).map(x=>norm(x,'fromUserAccount','toUserAccount')).filter(x=>x.mint&&x.amount>0);
  if(!outgoing.length&&!incoming.length){
    outgoing=eventInputs.map(x=>norm(x,'fromUserAccount','toUserAccount')).filter(x=>x.mint&&x.amount>0);
    incoming=eventOutputs.map(x=>norm(x,'fromUserAccount','toUserAccount')).filter(x=>x.mint&&x.amount>0);
  }

  const nativeOut=nativeTransfers.filter(x=>String(x?.fromUserAccount||'').toLowerCase()===walletLc).reduce((a,x)=>a+Math.max(0,n(x?.amount)/1e9),0);
  const nativeIn=nativeTransfers.filter(x=>String(x?.toUserAccount||'').toLowerCase()===walletLc).reduce((a,x)=>a+Math.max(0,n(x?.amount)/1e9),0);
  const feeSol=txFeeSol(tx);
  const eventNativeIn=n(swap?.nativeInput?.amount)/1e9;
  const eventNativeOut=n(swap?.nativeOutput?.amount)/1e9;
  const buyNative=Math.max(0,nativeOut-feeSol,eventNativeIn);
  const sellNative=Math.max(0,nativeIn,eventNativeOut);

  const fundingOut=outgoing.filter(x=>FUNDING_MINTS.has(x.mint));
  const fundingIn=incoming.filter(x=>FUNDING_MINTS.has(x.mint));
  const assetsIn=incoming.filter(x=>!FUNDING_MINTS.has(x.mint));
  const assetsOut=outgoing.filter(x=>!FUNDING_MINTS.has(x.mint));
  const usdOut=Math.max(0,...fundingOut.map(x=>x.mint===USDC_MINT?x.amount:x.amount*solUsd),buyNative*solUsd);
  const usdIn=Math.max(0,...fundingIn.map(x=>x.mint===USDC_MINT?x.amount:x.amount*solUsd),sellNative*solUsd);

  if(assetsIn.length&&usdOut>=minFundingUsd){
    const t=assetsIn.sort((a,b)=>b.amount-a.amount)[0];
    const fa=fundingOut.find(x=>(x.mint===USDC_MINT?x.amount:x.amount*solUsd)===usdOut)?.mint||(buyNative*solUsd===usdOut?'SOL':null);
    return {direction:'BUY',mint:t.mint,tokenAmount:t.amount,fundingUsd:usdOut,fundingAsset:fa||'UNKNOWN'};
  }
  if(assetsOut.length&&usdIn>0){
    const t=assetsOut.sort((a,b)=>b.amount-a.amount)[0];
    const fa=fundingIn.find(x=>(x.mint===USDC_MINT?x.amount:x.amount*solUsd)===usdIn)?.mint||(sellNative*solUsd===usdIn?'SOL':null);
    return {direction:'SELL',mint:t.mint,tokenAmount:t.amount,fundingUsd:usdIn,fundingAsset:fa||'UNKNOWN'};
  }
  return null;
}
function spotQualificationReasons({roundTrips,inWindow,holdRatio,medianHold,volumeUsd,lastTrade,complete=true}){
  const reasons=[];
  if(!complete)reasons.push('INCOMPLETE_HISTORY');
  if(roundTrips<DISCOVERY_MIN_COMPLETED)reasons.push(`ROUND_TRIPS<${DISCOVERY_MIN_COMPLETED}`);
  if(inWindow<DISCOVERY_MIN_IN_WINDOW)reasons.push(`HOLD_1_24H<${DISCOVERY_MIN_IN_WINDOW}`);
  if(holdRatio<DISCOVERY_MIN_HOLD_RATIO)reasons.push(`HOLD_RATIO<${Math.round(DISCOVERY_MIN_HOLD_RATIO*100)}%`);
  if(!(medianHold>=DISCOVERY_MIN_HOLD_HOURS&&medianHold<=DISCOVERY_MAX_HOLD_HOURS))reasons.push('MEDIAN_HOLD_OUT_OF_RANGE');
  if(volumeUsd<DISCOVERY_MIN_VOLUME_USD)reasons.push(`VOLUME<${DISCOVERY_MIN_VOLUME_USD}`);
  if(!(lastTrade>=Date.now()-24*3600000))reasons.push('NO_RECENT_TRADE_24H');
  return reasons;
}

async function heliusProgramUniverse(programs){
  const owners=new Map();
  for(const [program,label] of programs){
    try{
      const rows=await heliusEnhancedTransactions(program,Math.max(20,DISCOVERY_SPOT_PROGRAM_SIGS*5),'',`program:${label}`);
      let hits=0;
      for(const tx of rows){
        if(String(tx?.type||'').toUpperCase()!=='SWAP')continue;
        const ts=n(tx?.timestamp)*1000; if(!ts || Date.now()-ts>48*3600000)continue;
        const payer=String(tx?.feePayer||''); if(!payer||payer==='11111111111111111111111111111111')continue;
        owners.set(payer,(owners.get(payer)||0)+1); hits++;
      }
      console.log(`[DISCOVERY][SPOT][HELIUS-PROGRAM] ${label} tx=${rows.length} swaps=${hits}`);
    }catch(e){console.log(`[DISCOVERY][SPOT][HELIUS-PROGRAM] ${label} ERROR ${String(e?.message||e).slice(0,140)}`)}
    await sleep(250);
  }
  return owners;
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

async function tokenPrice(mint){
  try{
    const r=await fetchJson(`https://api.dexscreener.com/latest/dex/tokens/${mint}`,{},'dex-price');
    const p=(r?.pairs||[]).filter(x=>x?.priceUsd).sort((a,b)=>n(b?.liquidity?.usd)-n(a?.liquidity?.usd))[0];
    if(p)return n(p.priceUsd);
  }catch{}
  try{
    const r=await fetchJson(`${GECKO}/networks/solana/tokens/${mint}`,{},'gecko-price');
    return n(r?.data?.attributes?.price_usd);
  }catch{return 0}
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
  const target=String(mint||'');
  try{
    const r=await fetchJson(`https://api.dexscreener.com/latest/dex/tokens/${target}`,{},'dexscreener');
    const pairs=(r?.pairs||[]).filter(p=>p?.priceUsd&&String(p?.chainId)==='solana');
    const valid=pairs.map(p=>{
      const base=String(p?.baseToken?.address||'');
      const quote=String(p?.quoteToken?.address||'');
      let price=0,symbol='';
      if(base===target){
        price=n(p?.priceUsd);
        symbol=p?.baseToken?.symbol||target.slice(0,6);
      }else if(quote===target){
        const native=n(p?.priceNative);
        const baseUsd=n(p?.priceUsd);
        if(native>0&&baseUsd>0)price=baseUsd/native;
        symbol=p?.quoteToken?.symbol||target.slice(0,6);
      }
      return {p,price,symbol};
    }).filter(x=>x.price>0);
    valid.sort((a,b)=>n(b.p?.liquidity?.usd)-n(a.p?.liquidity?.usd));
    const best=valid[0];
    if(best)return {price:best.price,symbol:best.symbol,liquidity:n(best.p?.liquidity?.usd),volume24h:n(best.p?.volume?.h24),source:'DEXSCREENER_VALIDATED_PAIR'};
  }catch{}
  try{
    const r=await fetchJson(`${GECKO}/networks/solana/tokens/${target}`,{},'gecko-token');
    const a=r?.data?.attributes||{};
    return {price:n(a.price_usd),symbol:a.symbol||target.slice(0,6),liquidity:n(a.total_reserve_in_usd),volume24h:n(a.volume_usd?.h24),source:'GECKO'};
  }catch{return {price:0,symbol:target.slice(0,6),liquidity:0,volume24h:0,source:'NONE'}}
}
async function scanSpot(w){
  const solInfo=await tokenInfo(WSOL_MINT);
  const solUsd=solInfo.price||await tokenPrice(WSOL_MINT);
  if(!(solUsd>0))throw new Error('SOL_PRICE_UNAVAILABLE');
  const cutoff=Date.now()-SPOT_MAX_ACTIVITY_AGE_MIN*60000;
  const candidates=[]; const diagnostics=[]; const seen=new Set();
  if(HELIUS_ENHANCED_ENABLED){
    const txs=await heliusEnhancedTransactions(w.address,100,'',`signal:${w.name}`);
    for(const tx of txs){
      const bt=n(tx?.timestamp)*1000; if(!bt||bt<cutoff)continue;
      const sw=enhancedSwap(tx,w.address,solUsd); if(!sw||sw.direction!=='BUY'||n(sw.fundingUsd)<SPOT_MIN_SIGNAL_BUY_USD||seen.has(sw.mint))continue;
      const info=await tokenMarketData(sw.mint); const px=n(info.price);
      if(!(px>0)){diagnostics.push({sig:tx.signature,reason:`PRICE_UNRESOLVED:${sw.mint.slice(0,8)}`});continue;}
      const sourceEntry=sw.fundingUsd/sw.tokenAmount; if(!(sourceEntry>0)){diagnostics.push({sig:tx.signature,reason:'ENTRY_RECONSTRUCTION_INVALID'});continue;}
      const dist=(px/sourceEntry-1)*100;
      const sl=sourceEntry*(1-SL_PCT/100),tp=sourceEntry*(1+TP_PCT/100),R=normalizedRR(sourceEntry-sl,tp-sourceEntry);
      const ageMin=Math.max(0,(Date.now()-bt)/60000);
      const x={wallet:w,coin:info.symbol||sw.mint.slice(0,6),mint:sw.mint,side:'LONG',sourceEntry, current:px,distancePct:dist,sl,tp,rr:R,age:bt,ageMin,liquidity:info.liquidity,volume24h:info.volume24h,tx:tx.signature,buyNotionalUsd:sw.fundingUsd,fundingAsset:sw.fundingAsset,activitySource:'HELIUS_ENHANCED_SWAP',priceSource:info.source,avgEntry:sourceEntry,eligible:Math.abs(dist)<=ENTRY_WINDOW_PCT&&R+1e-9>=MIN_RR&&n(sw.fundingUsd)>=SPOT_MIN_SIGNAL_BUY_USD&&ageMin<=SPOT_MAX_SIGNAL_AGE_MIN};
      candidates.push(x); seen.add(sw.mint);
      if(candidates.length>=MAX_SPOT_POSITIONS)break;
    }
    return {wallet:w,signals:candidates.filter(x=>x.eligible),positions:[],recentBuys:candidates,scanned:txs.length,txs:txs.filter(x=>n(x?.timestamp)*1000>=cutoff).length,health:spotHealth(w),activityLookbackMin:SPOT_MAX_ACTIVITY_AGE_MIN,diagnostics:diagnostics.slice(0,SPOT_DIAGNOSTIC_MAX),tokenAccounts:0};
  }
  throw new Error('HELIUS_API_KEY_MISSING_SPOT_SIGNAL_PATH_DISABLED');
}

function hlPositions(state){
  return (state?.assetPositions||[]).map(x=>x?.position||x).filter(p=>p&&Math.abs(n(p.szi))>0).map(p=>({coin:p.coin,side:n(p.szi)>0?'LONG':'SHORT',size:Math.abs(n(p.szi)),entry:n(p.entryPx),positionValue:Math.abs(n(p.positionValue)),unrealized:n(p.unrealizedPnl),leverage:n(p.leverage?.value||p.leverage),liq:n(p.liquidationPx),margin:n(p.marginUsed)}));
}
async function futuresHealth(w){
  // Health is intentionally NOT on the signal path. The Telegram engine is
  // activity-first and must not spend the rate-limit budget on historical stats.
  return {health:'SIGNAL_ONLY',reason:'HEALTH_NOT_QUERIED_IN_SIGNAL_CYCLE'};
}

function hasPositionTransition(rows){
  for(const f of rows||[]){
    const sp=Number(f?.startPosition),sz=Math.abs(n(f?.sz));
    if(!Number.isFinite(sp)||!(sz>0))continue;
    const post=fillPostPosition(f);
    if(Number.isFinite(post)&&Math.abs(post)>Math.abs(sp)+1e-12)return true;
    const dir=String(f?.dir||'').toLowerCase();
    if(dir.includes('open long')||dir.includes('open short'))return true;
  }
  return false;
}
async function fetchRecentFuturesFills(w,startTime,endTime){
  let lastErr=null;
  for(let attempt=1;attempt<=FUTURES_FETCH_RETRY;attempt++){
    try{
      const rows=await hl({type:'userFillsByTime',user:w.address,startTime,endTime,aggregateByTime:true},`recentFills:${w.name}:a${attempt}`);
      if(!Array.isArray(rows))throw new Error('FILLS_RESPONSE_NOT_ARRAY');
      const filtered=rows.filter(f=>n(f?.time)>=startTime&&n(f?.time)<=endTime);
      console.log(`[FUTURES][FILLS] ${w.name} recent=${filtered.length} raw=${rows.length} source=userFillsByTime transitions=${hasPositionTransition(filtered)}`);
      if(filtered.length && (hasPositionTransition(filtered)||!FUTURES_FILL_SOURCE_FALLBACK))return filtered;
      if(!FUTURES_FILL_SOURCE_FALLBACK)return filtered;
      break;
    }catch(e){
      lastErr=e; const msg=String(e?.message||e);
      const is429=/429|rate.?limit|too many requests/i.test(msg);
      if(attempt>=FUTURES_FETCH_RETRY)break;
      const wait=FUTURES_RETRY_BASE_MS*Math.pow(2,attempt-1)+(is429?700:0);
      console.log(`[FUTURES][RETRY] ${w.name} attempt=${attempt} reason=${msg.slice(0,120)} wait=${wait}ms`); await sleep(wait);
    }
  }
  if(FUTURES_FILL_SOURCE_FALLBACK){
    try{
      const rows=await hl({type:'userFills',user:w.address,aggregateByTime:true},`recentFillsFallback:${w.name}`);
      if(Array.isArray(rows)){
        const filtered=rows.filter(f=>n(f?.time)>=startTime&&n(f?.time)<=endTime);
        console.log(`[FUTURES][FILLS-FALLBACK] ${w.name} recent=${filtered.length} raw=${rows.length} source=userFills transitions=${hasPositionTransition(filtered)}`);
        return filtered;
      }
    }catch(e){console.log(`[FUTURES][FILLS-FALLBACK] ${w.name} ERROR ${String(e?.message||e).slice(0,140)}`)}
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

function reconstructedPositionMapFromFills(fills){
  const map=new Map();
  const byCoin=new Map();
  for(const f of fills||[]){const c=String(f?.coin||'');if(c){if(!byCoin.has(c))byCoin.set(c,[]);byCoin.get(c).push(f);}}
  for(const [coin,rows0] of byCoin){
    let pos=0,entry=0;
    const rows=rows0.slice().sort((a,b)=>n(a.time)-n(b.time));
    for(const f of rows){
      const start=Number(f?.startPosition),sz=Math.abs(n(f?.sz));
      if(!Number.isFinite(start)||!(sz>0))continue;
      const before=Number.isFinite(start)?start:pos;
      const post=fillPostPosition(f);
      if(!Number.isFinite(post))continue;
      if(Math.abs(post)>Math.abs(before)+1e-12){
        const oldAbs=Math.abs(before), add=Math.abs(post)-oldAbs;
        entry=oldAbs>0&&entry>0 ? ((entry*oldAbs)+(n(f.px)*add))/Math.abs(post) : n(f.px);
      }else if(Math.abs(post)<=1e-12){ entry=0; }
      else if(Math.sign(post)!==Math.sign(before)){ entry=n(f.px); }
      pos=post;
    }
    if(Math.abs(pos)>1e-12)map.set(coin,{coin,side:pos>0?'LONG':'SHORT',size:Math.abs(pos),entry,positionValue:Math.abs(pos)*entry,unrealized:null,leverage:null,liq:null,margin:null,source:'FILL_RECONSTRUCTION'});
  }
  return map;
}


async function readPerformanceCache(){
  try{return JSON.parse(await fs.readFile(PERFORMANCE_STATE_FILE,'utf8'));}catch{return {}}
}
async function writePerformanceCache(x){
  try{await fs.mkdir(path.dirname(PERFORMANCE_STATE_FILE),{recursive:true});await fs.writeFile(PERFORMANCE_STATE_FILE,JSON.stringify(x,null,2));}catch(e){console.log(`[PERF][CACHE] SAVE_ERROR ${String(e?.message||e).slice(0,120)}`)}
}
function performanceTradeBook(fills){
  const byCoin=new Map();
  for(const f of (fills||[])){if(f?.coin){if(!byCoin.has(f.coin))byCoin.set(f.coin,[]);byCoin.get(f.coin).push(f)}}
  const trades=[];
  for(const [coin,rows0] of byCoin){
    const rows=rows0.filter(f=>Number.isFinite(n(f?.time))).sort((a,b)=>n(a.time)-n(b.time));
    let lifecycle=null;
    let pos=0;
    for(const f of rows){
      const start=n(f.startPosition);
      const sz=Math.abs(n(f.sz));
      if(!(sz>0)||!Number.isFinite(start))continue;
      const dir=String(f.dir||'').toLowerCase();
      let after=positionPostFromFill(f);
      if(after===null){
        const d=dir.includes('open long')||dir.includes('close short')?sz:dir.includes('open short')||dir.includes('close long')?-sz:0;
        after=start+d;
      }
      if(!Number.isFinite(after))continue;
      const before=start;
      const beforeAbs=Math.abs(before), afterAbs=Math.abs(after);
      const closedPnl=n(f.closedPnl,0);
      const t=n(f.time);
      if(afterAbs>beforeAbs+1e-12){
        if(lifecycle && beforeAbs>0 && Math.sign(before)!==Math.sign(after)){
          trades.push({...lifecycle,coin,closeTime:t,pnl:lifecycle.pnl,closed:true});
          lifecycle=null;
        }
        if(!lifecycle)lifecycle={openTime:t,side:after>0?'LONG':'SHORT',pnl:0,adds:0};
        lifecycle.adds++;
      }else if(afterAbs<beforeAbs-1e-12){
        if(!lifecycle)lifecycle={openTime:t,side:before>0?'LONG':'SHORT',pnl:0,adds:0};
        lifecycle.pnl+=closedPnl;
        if(afterAbs<=1e-12){
          trades.push({...lifecycle,coin,closeTime:t,pnl:lifecycle.pnl,closed:true});
          lifecycle=null;
        }
      }
      pos=after;
    }
  }
  return trades;
}
function performanceWindow(fills,trades,start,end){
  const fs=(fills||[]).filter(f=>n(f?.time)>=start&&n(f?.time)<=end);
  const closed=trades.filter(t=>t.closed&&n(t.closeTime)>=start&&n(t.closeTime)<=end);
  const pnl=fs.reduce((a,f)=>a+n(f?.closedPnl),0);
  const wins=closed.filter(t=>n(t.pnl)>0).length;
  const losses=closed.filter(t=>n(t.pnl)<0).length;
  const grossProfit=closed.reduce((a,t)=>a+Math.max(0,n(t.pnl)),0);
  const grossLoss=closed.reduce((a,t)=>a+Math.max(0,-n(t.pnl)),0);
  const eq=[]; let run=0,peak=0,maxDd=0;
  for(const t of [...closed].sort((a,b)=>n(a.closeTime)-n(b.closeTime))){run+=n(t.pnl);peak=Math.max(peak,run);maxDd=Math.max(maxDd,peak-run);eq.push(run)}
  const byCoin={};
  for(const f of fs){const c=String(f?.coin||'');if(c)byCoin[c]=(byCoin[c]||0)+n(f?.closedPnl)}
  const topCoin=Object.entries(byCoin).sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]))[0]||null;
  return {pnl,closedTrades:closed.length,wins,losses,wr:closed.length?(wins/closed.length*100):null,pf:grossLoss>0?grossProfit/grossLoss:(grossProfit>0?Infinity:null),maxDrawdown:maxDd,grossProfit,grossLoss,coinPnl:byCoin,topCoin:topCoin?{coin:topCoin[0],pnl:topCoin[1]}:null,fillCount:fs.length};
}
async function fetchSpotPerformanceHistory(w,start,end){
  const all=[]; const seen=new Set(); let before=''; let pages=0; let truncated=false; let rateLimited=false;
  let oldestSeen=Infinity, newestSeen=0;
  while(pages<SPOT_PERFORMANCE_MAX_PAGES){
    pages++;
    try{
      const rows=await heliusEnhancedTransactions(w.address,100,before,`spot-performance:${w.name}:p${pages}`);
      if(!rows.length)break;
      for(const tx of rows){
        const sig=String(tx?.signature||''); const t=n(tx?.timestamp)*1000;
        if(t>0){oldestSeen=Math.min(oldestSeen,t);newestSeen=Math.max(newestSeen,t);}
        if(!sig||seen.has(sig))continue;
        seen.add(sig);
        if(t>=start&&t<=end)all.push(tx);
      }
      const last=rows[rows.length-1]; before=String(last?.signature||'');
      const oldest=n(last?.timestamp)*1000;
      if(!before||!oldest||oldest<=start||rows.length<100)break;
      await sleep(SPOT_PERFORMANCE_PAGE_DELAY_MS);
    }catch(e){
      const msg=String(e?.message||e);
      rateLimited=/429|rate.?limit|too many requests/i.test(msg);
      console.log(`[PERF][SPOT-HISTORY] ${w.name} page=${pages} ${rateLimited?'RATE_LIMITED':'ERROR'} ${msg.slice(0,140)}`);
      truncated=true; break;
    }
  }
  if(pages>=SPOT_PERFORMANCE_MAX_PAGES)truncated=true;
  const coverageStart=Number.isFinite(oldestSeen)?oldestSeen:0;
  return {txs:all,pages,truncated,rateLimited,coverageStart,coverageEnd:newestSeen};
}
function spotPerformanceTrades(txs,solUsd,walletAddress){
  const lots=new Map(), closed=[];
  const rows=(txs||[]).map(tx=>({tx,time:n(tx?.timestamp)*1000})).filter(x=>x.time>0).sort((a,b)=>a.time-b.time);
  for(const {tx,time} of rows){
    // Performance uses the economic swap decoder with NO signal-size floor.
    // Signal eligibility remains >= SPOT_MIN_BUY_USD, but historical PnL must
    // not discard small closes and thereby distort WR/PF/ROI.
    const sw=enhancedSwap(tx,walletAddress,solUsd,0);
    if(!sw||!sw.mint||!(sw.tokenAmount>0)||!(sw.fundingUsd>0))continue;
    const mint=sw.mint;
    if(sw.direction==='BUY'){
      if(!lots.has(mint))lots.set(mint,[]);
      lots.get(mint).push({time,qty:sw.tokenAmount,cost:sw.fundingUsd,asset:sw.fundingAsset||'UNKNOWN'});
      continue;
    }
    let remain=sw.tokenAmount; const q=lots.get(mint)||[];
    while(remain>1e-12&&q.length){
      const lot=q[0]; const take=Math.min(remain,lot.qty);
      const sellValue=sw.fundingUsd*(take/sw.tokenAmount);
      const buyValue=lot.cost*(take/lot.qty);
      if(buyValue>0&&sellValue>=0){
        const pnlUsd=sellValue-buyValue;
        if(Math.abs(pnlUsd)>=PERFORMANCE_MIN_CLOSED_TRADE_USD && Number.isFinite(pnlUsd)){
          closed.push({openTime:lot.time,closeTime:time,holdHours:Math.max(0,(time-lot.time)/3600000),pnlUsd,investedUsd:buyValue,pnlPct:(pnlUsd/buyValue)*100,mint});
        }
      }
      lot.qty-=take; lot.cost-=buyValue; remain-=take; if(lot.qty<=1e-12)q.shift();
    }
  }
  return closed;
}
function spotPerformanceWindow(trades,start,end){
  const closed=(trades||[]).filter(t=>t.closeTime>=start&&t.closeTime<=end&&Number.isFinite(t.pnlUsd)&&t.investedUsd>0);
  const wins=closed.filter(t=>t.pnlUsd>0).length;
  const losses=closed.filter(t=>t.pnlUsd<0).length;
  const invested=closed.reduce((a,t)=>a+t.investedUsd,0);
  const realized=closed.reduce((a,t)=>a+t.pnlUsd,0);
  const grossProfit=closed.reduce((a,t)=>a+Math.max(0,t.pnlUsd),0);
  const grossLoss=closed.reduce((a,t)=>a+Math.max(0,-t.pnlUsd),0);
  let eq=0,peak=0,maxDd=0;
  for(const t of [...closed].sort((a,b)=>a.closeTime-b.closeTime)){eq+=t.pnlUsd;peak=Math.max(peak,eq);maxDd=Math.max(maxDd,peak-eq);}
  const byCoin={}; for(const t of closed)byCoin[t.mint]=(byCoin[t.mint]||0)+t.pnlUsd;
  const topCoin=Object.entries(byCoin).sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]))[0]||null;
  const avgHold=closed.length?closed.reduce((a,t)=>a+t.holdHours,0)/closed.length:null;
  return {roi:invested>0?realized/invested*100:null,realizedPnl:realized,investedUsd:invested,closedTrades:closed.length,wins,losses,wr:closed.length?wins/closed.length*100:null,pf:grossLoss>0?grossProfit/grossLoss:(grossProfit>0?Infinity:null),maxDrawdown:invested>0?maxDd/invested*100:null,avgHoldHours:avgHold,coinPnl:byCoin,topCoin:topCoin?{coin:topCoin[0],pnl:topCoin[1]}:null};
}
function performanceCoverageLabel(p,start,end){
  const cov=n(p?.coverageStart); if(!(cov>0))return 'UNKNOWN';
  const days=Math.max(0,(end-cov)/86400000);
  if(days>=29.5)return 'COMPLETE';
  if(days>=6.5)return 'PARTIAL_7D_PLUS';
  return 'PARTIAL_SHORT';
}
async function auditSpotPerformance(w,now){
  const cached=await readPerformanceCache();
  const key=`${PERFORMANCE_SCHEMA}:SPOT:${String(w.address||'')}`; const c=cached[key];
  if(c&&n(c.updatedAt)>now-PERFORMANCE_CACHE_MIN*60000)return c.data;
  const end=now,start=end-PERFORMANCE_LOOKBACK_DAYS*86400000;
  try{
    const solInfo=await tokenInfo(WSOL_MINT); const solUsd=solInfo.price||await tokenPrice(WSOL_MINT);
    if(!(solUsd>0))throw new Error('SOL_PRICE_UNAVAILABLE_PERFORMANCE');
    const pg=await fetchSpotPerformanceHistory(w,start,end);
    const trades=spotPerformanceTrades(pg.txs,solUsd,w.address);
    const w7Start=end-7*86400000;
    const w7=spotPerformanceWindow(trades,w7Start,end);
    const w30=spotPerformanceWindow(trades,start,end);
    const coverageDays=pg.coverageStart>0?Math.max(0,(end-pg.coverageStart)/86400000):0;
    const d={schema:PERFORMANCE_SCHEMA,market:'SPOT',complete:coverageDays>=29.5&&!pg.truncated,pages:pg.pages,txCount:pg.txs.length,closedTrades:trades.length,coverageStart:pg.coverageStart,coverageDays,rateLimited:pg.rateLimited,coverage7d:coverageDays>=6.5,coverage30d:coverageDays>=29.5,w7,w30,updatedAt:now};
    if(!trades.length)d.noClosedTrades=true;
    cached[key]={updatedAt:now,data:d}; await writePerformanceCache(cached);
    console.log(`[PERF][SPOT-DONE] ${w.name} txs=${pg.txs.length} pages=${pg.pages} coverage=${coverageDays.toFixed(1)}d complete=${d.complete} 7dROI=${w7.roi==null?'NA':w7.roi.toFixed(2)} 30dROI=${w30.roi==null?'NA':w30.roi.toFixed(2)} 7dWR=${w7.wr==null?'NA':w7.wr.toFixed(1)} 30dWR=${w30.wr==null?'NA':w30.wr.toFixed(1)}`);
    return d;
  }catch(e){console.log(`[PERF][SPOT-ERROR] ${w.name} ${String(e?.message||e).slice(0,180)}`);return {error:String(e?.message||e),complete:false,market:'SPOT'}}
}
async function auditTraderPerformance(w,now){
  if(String(w?.name||'').startsWith('SOL_')) return auditSpotPerformance(w,now);
  const cached=await readPerformanceCache();
  const key=`FUTURES:${String(w.address||'')}`; const c=cached[key];
  if(c&&n(c.updatedAt)>now-PERFORMANCE_CACHE_MIN*60000)return c.data;
  const end=now,start=end-PERFORMANCE_LOOKBACK_DAYS*86400000;
  try{
    const pg=await fetchFillsPaginated(w,start,end,'performance',PERFORMANCE_MAX_PAGES,PERFORMANCE_PAGE_DELAY_MS);
    const fills=pg.fills||[]; const trades=performanceTradeBook(fills);
    const oldest=fills.length?Math.min(...fills.map(f=>n(f?.time)).filter(Boolean)):0;
    const coverageDays=oldest>0?Math.max(0,(end-oldest)/86400000):0;
    const w7=performanceWindow(fills,trades,end-7*86400000,end);
    const w30=performanceWindow(fills,trades,start,end);
    const d={market:'FUTURES',complete:coverageDays>=29.5&&!pg.truncated,pages:pg.pages,fillCount:fills.length,coverageStart:oldest,coverageDays,coverage7d:coverageDays>=6.5,coverage30d:coverageDays>=29.5,w7,w30,updatedAt:now};
    cached[key]={updatedAt:now,data:d}; await writePerformanceCache(cached);
    return d;
  }catch(e){console.log(`[PERF][FUTURES-ERROR] ${w.name} ${String(e?.message||e).slice(0,180)}`);return {error:String(e?.message||e),complete:false,market:'FUTURES'}}
}
function performanceBlock(p,coin){
  if(!p||p.error)return ['📊 PERFORMANCE','7D  — unavailable','30D — unavailable'];
  const fmtPct=x=>Number.isFinite(Number(x))?`${Number(x)>=0?'+':''}${Number(x).toFixed(2)}%`:'—';
  const fmtWR=x=>Number.isFinite(Number(x))?`${Number(x).toFixed(1)}%`:'—';
  const fmtPF=x=>x===Infinity?'∞':Number.isFinite(Number(x))?Number(x).toFixed(2):'—';
  const c7=p.w7||{},c30=p.w30||{};
  const rows=['📊 PERFORMANCE'];
  const cov7=p.coverage7d!==false && n(p.coverageDays)>=6.5;
  const cov30=p.coverage30d===true || n(p.coverageDays)>=29.5;
  rows.push(`${cov7?'7D  ':'7D*'} ROI ${fmtPct(c7.roi)} | WR ${fmtWR(c7.wr)} | PF ${fmtPF(c7.pf)} | Trades ${c7.closedTrades??'—'}`);
  rows.push(`${cov30?'30D ':'30D*'} ROI ${fmtPct(c30.roi)} | WR ${fmtWR(c30.wr)} | PF ${fmtPF(c30.pf)} | Trades ${c30.closedTrades??'—'}`);
  if(Number.isFinite(Number(c30.avgHoldHours)))rows.push(`30D  Avg Hold ${Number(c30.avgHoldHours).toFixed(2)}h`);
  if(Number.isFinite(Number(c30.maxDrawdown)))rows.push(`30D  Max DD ${fmtPct(-Math.abs(c30.maxDrawdown))}`);
  if(coin&&c30.coinPnl&&Object.prototype.hasOwnProperty.call(c30.coinPnl,coin))rows.push(`30D  ${coin} PnL ${money(c30.coinPnl[coin])}`);
  if(p.complete===false || p.rateLimited || !cov30)rows.push(`⚠️ ${p.rateLimited?'Rate-limited':'Partial'} history — available on-chain fills only`);
  return rows;
}
function whaleSignalBlock(w,signals,p,i){
  const rows=[
    `🐋 WHALE ${i} — ${w.name}`,
    '━━━━━━━━━━━━━━━━━━',
    ...performanceBlock(p,signals[0]?.mint||signals[0]?.coin),
    ''
  ];
  signals.forEach((x,j)=>{
    const ageMin=signalAgeMin(x);
    const avgTag=x.averaging?(Number.isFinite(ageMin)&&ageMin<=FUTURES_AVERAGING_GREEN_LATENCY_MIN?'FRESH AVERAGING':'AVERAGING'):'';
    rows.push(`🎯 ${x.displaySymbol||x.coin} ${x.side}`);
    rows.push(`ADD   ${priceFmt(x.sourceEntry)}   |   AVG ${priceFmt(x.avgEntry)}   |   NOW ${priceFmt(x.current)}`);
    rows.push(`SL    ${priceFmt(x.sl)}   |   TP ${priceFmt(x.tp)}   |   RR ${fmt(x.rr,2)}`);
    rows.push(`DIST  ${pct(x.distancePct,2)}   |   AGE ${ageMin<1?Math.max(1,Math.round(ageMin*60))+'s':ageMin.toFixed(1)+'m'}`);
    if(x.mint){ rows.push(`SIZE  ${money(x.buyNotionalUsd)}`); } else { rows.push(`POS   ${money(x.positionValue)}   |   LEV ${fmt(x.leverage,1)}x${avgTag?`   |   ${avgTag}`:''}`); }
    if(j<signals.length-1)rows.push('');
  });
  rows.push('━━━━━━━━━━━━━━━━━━');
  return rows;
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
  const reconstructedPositions=FUTURES_STATE_FALLBACK_FROM_FILLS?reconstructedPositionMapFromFills(fills):new Map();
  if(FUTURES_STATE_FALLBACK_FROM_FILLS){for(const [coin,p] of reconstructedPositions){if(!currentPositions.has(coin))currentPositions.set(coin,p);}}
  console.log(`[FUTURES][POSITION-AUDIT] ${w.name} statePositions=${statePositionMap(state).size} reconstructed=${reconstructedPositions.size} usable=${currentPositions.size}`);
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

    const after=fillPostPosition(f);
    let side=null,addedSize=0;
    if(Number.isFinite(after)&&Number.isFinite(sp)){
      const beforeAbs=Math.abs(sp),afterAbs=Math.abs(after);
      if(afterAbs>beforeAbs+1e-12){
        side=after>0?'LONG':'SHORT';
        addedSize=afterAbs-beforeAbs; derivedOpen++;
      }else if(sp*after<0){
        side=after>0?'LONG':'SHORT';
        addedSize=afterAbs; derivedOpen++;
      }else{rejectedClose++;continue;}
    }else{rejectedClose++;continue;}
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
    latestAdd._latestAddedSize=n(latestAdd._addedSize);
    const freshCutoff=now-FUTURES_SIGNAL_FRESHNESS_MIN*60000;
    const freshList=list.filter(f=>n(f.time)>=freshCutoff);
    let totalAdded=0, weighted=0;
    for(const f of freshList){
      const q=n(f._addedSize);
      totalAdded+=q;
      weighted+=q*n(f.px);
    }
    latestAdd._recentAddCount=freshList.length;
    latestAdd._recentAddedSize=totalAdded>0?totalAdded:n(latestAdd._addedSize);
    latestAdd._recentAvgPx=totalAdded>0?weighted/totalAdded:n(latestAdd.px);
    latestAdd._isAveraging=freshList.length>=2;
    latest.push(latestAdd);
  }

  console.log(`[FUTURES][OPEN-DETECT] ${w.name} fills=${fills.length} dirOpen=${dirOpen} derivedOpen=${derivedOpen} closes/reduces=${rejectedClose} invalid=${invalid} addEvents=${recentAdds} averagingSymbols=${averagingKeys}`);

  const signals=[];
  let dropNoPos=0,dropSide=0,dropPrice=0,dropSize=0,dropDistance=0,dropRR=0,dropStale=0;
  const sortedCandidates=latest.sort((a,b)=>n(b?.time)-n(a?.time));
  const freshCandidates=sortedCandidates.filter(f=>{
    const a=Math.max(0,(now-n(f.time))/60000);
    return a<=FUTURES_SIGNAL_FRESHNESS_MIN;
  });
  const staleCandidates=sortedCandidates.length-freshCandidates.length; dropStale=staleCandidates;
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
    if(!pos){
      dropNoPos++;
      console.log(`[FUTURES][DROP] ${w.name} | ${displaySymbol} | REASON=POSITION_NO_LONGER_OPEN`);
      continue;
    }
    const currentSide=pos.side;
    if(f._derivedSide!==currentSide){
      dropSide++;
      console.log(`[FUTURES][DROP] ${w.name} | ${displaySymbol} | REASON=SIDE_MISMATCH fill=${f._derivedSide} current=${currentSide}`);
      continue;
    }
    const avgEntry=Number.isFinite(Number(pos?.entry))&&Number(pos.entry)>0?Number(pos.entry):n(f._recentAvgPx,entry);
    const recentAvg=f._recentAvgPx;
    const addCount=n(f._recentAddCount,1);
    const recentAddedSize=n(f._recentAddedSize,n(f.sz));
    const latestAddedSize=n(f._latestAddedSize,n(f._addedSize,n(f.sz)));
    const averaging=f._isAveraging===true;
    const latestAddNotional=latestAddedSize*entry;
    const recentWindowNotional=recentAddedSize*entry;
    const addNotional=Math.max(latestAddNotional,recentWindowNotional);
    const lifecycleAgeHours=ageMin/60;

    if(!(entry>0)||!(mid>0)){
      dropPrice++;
      console.log(`[FUTURES][DROP] ${w.name} | ${displaySymbol} | ${side} | Add ${priceFmt(entry)} | Now ${priceFmt(mid)} | Age ${ageMin.toFixed(1)}m | REASON=PRICE_UNAVAILABLE`);
      continue;
    }

    // Signal distance is based on the latest actual add. The current AVG is
    // shown separately so a trader averaging down/up is visible to the user.
    const dist=(mid/entry-1)*100*(side==='LONG'?1:-1);
    const avgDist=(mid/avgEntry-1)*100*(currentSide==='LONG'?1:-1);
    const adverseAvg=avgDist<0;
    const sl=side==='LONG'?entry*(1-HL_SL_PCT/100):entry*(1+HL_SL_PCT/100);
    const tp=side==='LONG'?entry*(1+HL_TP_PCT/100):entry*(1-HL_TP_PCT/100);
    const R=normalizedRR(Math.abs(entry-sl),Math.abs(tp-entry));
    const x={wallet:w,coin,displaySymbol,side:currentSide,sourceEntry:entry,current:mid,distancePct:dist,sl,tp,rr:R,
      size:latestAddedSize,positionValue:pos?.positionValue??latestAddedSize*entry,unrealized:pos?.unrealized??null,
      leverage:pos?.leverage??null,liq:pos?.liq??null,margin:pos?.margin??null,
      openedAt:n(f.time),ageMin,openFillPx:entry,openFillSize:latestAddedSize,openFillHash:f.hash||null,
      activitySource:'RECENT_HYPERLIQUID_POSITION_ADD',fillDir:f.dir,
      avgEntry,avgDistancePct:avgDist,recentAvgPx:recentAvg,addCount,averaging,
      totalRecentAddedSize:recentAddedSize,currentPositionSize:pos?.size??null,addNotional,lifecycleAgeHours,adverseAvg,
      eligible:ageMin<=FUTURES_SIGNAL_FRESHNESS_MIN&&Math.abs(dist)<=ENTRY_WINDOW_PCT&&R+1e-9>=MIN_RR&&addNotional>=FUTURES_MIN_SIGNAL_ADD_USD&&(lifecycleAgeHours<=FUTURES_MAX_ACTIVE_LIFECYCLE_AGE_HOURS)&&(!adverseAvg||Math.abs(avgDist)<=FUTURES_MAX_ADVERSE_AVG_PCT)};
    const auditStatus=classifyPosition(x);
    const reasons=setupReason(x);
    const reason=auditStatus==='YELLOW'?yellowReason(x):(reasons.length?reasons.join(' + '):'READY');
    console.log(`[FUTURES][CANDIDATE] ${w.name} | ${displaySymbol} | ${currentSide} | ADD ${priceFmt(entry)} | AVG ${priceFmt(avgEntry)} | observedAdds=${addCount} | Now ${priceFmt(mid)} | Dist ${pct(dist,2)} | Age ${ageMin.toFixed(1)}m | RR ${fmt(R,3)} | STATUS=${auditStatus} | REASON=${reason}`);
    signals.push(x);
  }
  signals.sort((a,b)=>signalAgeMin(a)-signalAgeMin(b));
  const actionableSignals=signals.filter(x=>classifyPosition(x)!=='RED');
  const limitedSignals=actionableSignals.slice(0,FUTURES_MAX_SIGNALS_PER_WALLET);
  console.log(`[FUTURES][FINAL-AUDIT] ${w.name} fresh=${freshCandidates.length} signals=${signals.length} limited=${limitedSignals.length} drops={stale:${dropStale},noPos:${dropNoPos},side:${dropSide},price:${dropPrice},size:${dropSize}}`);
  return {wallet:w,signals:limitedSignals,positions:limitedSignals,scanned:fills.length,health:{health:'SIGNAL_ONLY',reason:'HEALTH_NOT_QUERIED_IN_SIGNAL_CYCLE'},activityLookbackMin:FUTURES_ACTIVITY_LOOKBACK_MIN,addEvents:recentAdds,averagingSymbols:averagingKeys,dataAudit:dataAudit?{status:dataAudit.status,audit24hCount:dataAudit.auditRows.length,detail:dataAudit.detail}:null};
}
function spotHealth(w){
  const b=w?.discovery||{};
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
  if(x?.mint && Number.isFinite(Number(x.buyNotionalUsd))&&Number(x.buyNotionalUsd)<SPOT_MIN_SIGNAL_BUY_USD)why.push(`BUY_NOTIONAL<$${SPOT_MIN_SIGNAL_BUY_USD}`);
  if(!x?.mint&&Number.isFinite(Number(x.addNotional))&&Number(x.addNotional)<FUTURES_MIN_SIGNAL_ADD_USD)why.push(`ADD_NOTIONAL<$${FUTURES_MIN_SIGNAL_ADD_USD}`);
  if(Number.isFinite(Number(x.lifecycleAgeHours))&&Number(x.lifecycleAgeHours)>FUTURES_MAX_ACTIVE_LIFECYCLE_AGE_HOURS)why.push(`LIFECYCLE_AGE>${FUTURES_MAX_ACTIVE_LIFECYCLE_AGE_HOURS}h`);
  if(x.adverseAvg&&Number.isFinite(Number(x.avgDistancePct))&&Math.abs(Number(x.avgDistancePct))>FUTURES_MAX_ADVERSE_AVG_PCT)why.push(`AVG_ADVERSE>${FUTURES_MAX_ADVERSE_AVG_PCT}%`);
  return why;
}
function classifyPosition(x){
  const dist=distanceAbs(x);
  const latency=signalAgeMin(x);
  const invalid=!Number.isFinite(Number(x.sourceEntry))||Number(x.sourceEntry)<=0||!Number.isFinite(Number(x.current))||Number(x.current)<=0;
  const rrOk=Number.isFinite(Number(x.rr))&&Number(x.rr)+1e-9>=MIN_RR;
  const meaningfulSize=x?.mint ? Number(x.buyNotionalUsd)>=SPOT_MIN_SIGNAL_BUY_USD : Number(x.addNotional)>=FUTURES_MIN_SIGNAL_ADD_USD;
  if(!meaningfulSize)return 'RED';
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
  const ageNow=signalAgeMin(x); const avgTag=x.averaging?` | ${Number.isFinite(ageNow)&&ageNow<=FUTURES_AVERAGING_GREEN_LATENCY_MIN?'FRESH AVERAGING':'AVERAGING'} | Recent ADDs ${x.addCount}`:'';
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
  console.log(`[FUTURES][WATCHLIST-AUDIT] wallets=${FUTURES_WALLETS.length}/${TARGET_FUTURES_WALLETS}`);
  for(const w of FUTURES_WALLETS){
    futures.push(await scanFutures(w,mids,Date.now(),symbolMap).catch(e=>({wallet:w,signals:[],positions:[],error:e.message,scanned:0,health:{health:'SIGNAL_ONLY',reason:'FUTURES_SCAN_ERROR',error:e.message}})));
    await sleep(FUTURES_BETWEEN_WALLETS_MS);
  }
  const futuresAuditSummary=futures.reduce((a,x)=>{a.wallets++;a.fills+=n(x.scanned);a.adds+=n(x.addEvents);a.signals+=(x.positions||[]).length;return a},{wallets:0,fills:0,adds:0,signals:0});
  console.log(`[FUTURES][FINAL-AUDIT] wallets=${futuresAuditSummary.wallets} fills=${futuresAuditSummary.fills} addEvents=${futuresAuditSummary.adds} signals=${futuresAuditSummary.signals}`);

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

  const green=[...spotGreen,...futuresGreen];
  const yellow=[...spotYellow,...futuresYellow];
  const reportCandidates=[...green,...yellow];
  const grouped=new Map();
  for(const x of reportCandidates){
    const key=String(x.wallet?.address||x.wallet?.name||'');
    if(!grouped.has(key))grouped.set(key,{wallet:x.wallet,signals:[]});
    grouped.get(key).signals.push(x);
  }
  const whaleGroups=[...grouped.values()].sort((a,b)=>{
    const aa=Math.min(...a.signals.map(signalAgeMin).filter(Number.isFinite));
    const bb=Math.min(...b.signals.map(signalAgeMin).filter(Number.isFinite));
    return aa-bb;
  });
  const performanceByWallet=new Map();
  for(let i=0;i<whaleGroups.length;i+=1){
    const batch=whaleGroups.slice(i,i+1);
    const rows=await Promise.all(batch.map(async g=>[g.wallet.name,await auditTraderPerformance(g.wallet,Date.now())]));
    for(const [name,p] of rows)performanceByWallet.set(name,p);
  }
  const lines=[
    `🐋 CRYPTO WHALE SIGNAL ENGINE ${VERSION}`,
    'READ-ONLY • SIGNALS ONLY • NO ORDERS',
    '━━━━━━━━━━━━━━━━━━',
    `🕒 ${new Date().toISOString()}`,
    `👥 Signal whales: ${whaleGroups.length} | Spot ${spotGreen.length} | Futures ${futuresGreen.length}`,
    ''
  ];
  if(!whaleGroups.length){
    lines.push('⚪ NO ACTIONABLE WHALE SIGNALS','No fresh signal met the entry rules.');
  }else{
    const selected=whaleGroups.slice(0,MAX_TELEGRAM_WHALE_BLOCKS);
    selected.forEach((g,i)=>lines.push(...whaleSignalBlock(g.wallet,g.signals,performanceByWallet.get(g.wallet.name),i+1),''));
    if(whaleGroups.length>selected.length)lines.push(`+${whaleGroups.length-selected.length} additional whales hidden`,'');
  }
  lines.push(`⏱ Cycle ${((Date.now()-started)/1000).toFixed(1)}s`);
  console.log(`[SIGNAL-ENGINE ${VERSION}][DONE] green=${spotGreen.length+futuresGreen.length} yellow=${spotYellow.length+futuresYellow.length} red-hidden=${classified.filter(x=>x.status==='RED').length}`);
  await telegram(lines.join('\n'));
}

async function runSelfTests(){
  const assert=(ok,msg)=>{if(!ok)throw new Error('SELF_TEST_FAIL: '+msg)};
  const mk=(time,coin,dir,start,sz,px,side)=>({time,coin,dir,startPosition:String(start),sz:String(sz),px:String(px),side});
  const f1=mk(1000,'BTC','Open Long',0,2,100,'B');
  const f2=mk(2000,'BTC','Open Long',2,1,101,'B');
  const f3=mk(3000,'BTC','Close Long',3,3,102,'A');
  assert(fillPostPosition(f1)===2,'open long position reconstruction');
  assert(fillPostPosition(f2)===3,'add position reconstruction');
  assert(fillPostPosition(f3)===0,'close long position reconstruction');
  const ra=recentAddStatsFromFills([f1,f2],3000.1,999999);
  assert(ra.count===2,'recent add count');
  assert(Math.abs(ra.notional-301)<1e-9,'recent add notional');
  const perf=spotPerformanceWindow([{openTime:1,closeTime:2,holdHours:1,pnlUsd:20,investedUsd:100,mint:'X'},{openTime:1,closeTime:3,holdHours:2,pnlUsd:-10,investedUsd:100,mint:'Y'}],0,10);
  assert(Math.abs(perf.roi-5)<1e-9,'weighted ROI');
  assert(Math.abs(perf.pf-2)<1e-9,'profit factor');
  const wallet='WALLET';
  const buyTx={type:'SWAP',tokenTransfers:[{fromUserAccount:wallet,toUserAccount:'DEX',mint:USDC_MINT,tokenAmount:'100'},{fromUserAccount:'DEX',toUserAccount:wallet,mint:'TOKENX',tokenAmount:'10'}],nativeTransfers:[]};
  const sellTx={type:'SWAP',tokenTransfers:[{fromUserAccount:wallet,toUserAccount:'DEX',mint:'TOKENX',tokenAmount:'10'},{fromUserAccount:'DEX',toUserAccount:wallet,mint:USDC_MINT,tokenAmount:'110'}],nativeTransfers:[]};
  const decBuy=enhancedSwap(buyTx,wallet,100); const decSell=enhancedSwap(sellTx,wallet,100);
  assert(decBuy?.direction==='BUY'&&decBuy?.mint==='TOKENX'&&Math.abs(decBuy.fundingUsd-100)<1e-9,'spot BUY economic flow');
  assert(decSell?.direction==='SELL'&&decSell?.mint==='TOKENX'&&Math.abs(decSell.fundingUsd-110)<1e-9,'spot SELL economic flow');
  console.log('[SELF-TEST] PASS | futures position/add detection | weighted spot ROI/PF | no execution');
}

(process.env.WHALE_SELF_TEST === 'true' ? runSelfTests() : main()).catch(async e=>{console.error(`[SIGNAL-ENGINE][FATAL] ${e.stack||e}`);await telegram(`🟣 CRYPTO WHALE SIGNAL ENGINE ${VERSION}\n📡 READ-ONLY | NO EXECUTION\n💥 FATAL\n${String(e.message||e).slice(0,1200)}`);process.exitCode=1});
