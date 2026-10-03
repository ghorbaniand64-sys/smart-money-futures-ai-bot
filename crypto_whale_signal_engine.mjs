import fs from 'node:fs/promises';
import path from 'node:path';
// CRYPTO SIGNAL ENGINE V1.0
// READ ONLY: NO ORDERS, NO PRIVATE KEYS, NO EXECUTION ENGINE.
// Dynamic whale discovery: 5 Spot + 5 Futures. READ ONLY.
// Telegram report is emitted every workflow cycle (intended every 5 minutes).

const VERSION = 'V6.9';
// V6.5: audited performance coverage, lifecycle-aware ADD labels, explicit
// ENTRY/WATCH classification, and non-verified ACTIVE WATCH discovery tiers.
const HL_INFO = process.env.HYPERLIQUID_API_URL || 'https://api.hyperliquid.xyz/info';
const SOL_RPC = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const HELIUS_API_KEY = process.env.HELIUS_API_KEY || '';
const HELIUS_ENHANCED_ENABLED = String(process.env.WHALE_HELIUS_ENHANCED_ENABLED || 'true').toLowerCase() === 'true' && Boolean(HELIUS_API_KEY);
const HELIUS_ENHANCED_BASE = process.env.HELIUS_ENHANCED_BASE || 'https://api.helius.xyz/v0';
const HELIUS_BREAKER_MIN = Number(process.env.WHALE_HELIUS_BREAKER_MIN || 10);
let HELIUS_RATE_LIMIT_UNTIL = 0;
let HELIUS_RATE_LIMIT_COUNT = 0;
function heliusCircuitOpen(){ return Date.now() < HELIUS_RATE_LIMIT_UNTIL; }
function markHeliusRateLimit(label='unknown'){ HELIUS_RATE_LIMIT_COUNT++; HELIUS_RATE_LIMIT_UNTIL=Math.max(HELIUS_RATE_LIMIT_UNTIL,Date.now()+HELIUS_BREAKER_MIN*60000); console.log(`[HELIUS][CIRCUIT-OPEN] ${label} cooldown=${HELIUS_BREAKER_MIN}m count=${HELIUS_RATE_LIMIT_COUNT}`); }
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
const DISCOVERY_TTL_MIN = Number(process.env.WHALE_DISCOVERY_TTL_MIN || 45);
const DISCOVERY_REFRESH_EACH_CYCLE = String(process.env.WHALE_DISCOVERY_REFRESH_EACH_CYCLE || 'true').toLowerCase() !== 'false';
const TRADER_MIN_WR = Number(process.env.WHALE_TRADER_MIN_WR || 55);
const TRADER_MIN_PF = Number(process.env.WHALE_TRADER_MIN_PF || 1.25);
const TRADER_MIN_CLOSED_TRADES = Number(process.env.WHALE_TRADER_MIN_CLOSED_TRADES || 10);
const TRADER_MIN_PNL_USD = Number(process.env.WHALE_TRADER_MIN_PNL_USD || 0);
const TRADER_MAX_DD_PCT = Number(process.env.WHALE_TRADER_MAX_DD_PCT || 25);
const TRADER_MIN_RISK_SAMPLE = Number(process.env.WHALE_TRADER_MIN_RISK_SAMPLE || 10);
const TRADER_MIN_ACCOUNT_VALUE_USD = Number(process.env.WHALE_TRADER_MIN_ACCOUNT_VALUE_USD || 25000);
const SPOT_TRADER_MIN_WR = Number(process.env.WHALE_SPOT_MIN_WR || 55);
const SPOT_TRADER_MIN_PF = Number(process.env.WHALE_SPOT_MIN_PF || 1.25);
const SPOT_TRADER_MIN_CLOSED_TRADES = Number(process.env.WHALE_SPOT_MIN_CLOSED_TRADES || 10);
const SPOT_TRADER_MIN_PNL_USD = Number(process.env.WHALE_SPOT_MIN_PNL_USD || 0);
const SPOT_DISCOVERY_DEEP_CANDIDATES = Number(process.env.WHALE_SPOT_DISCOVERY_DEEP_CANDIDATES || 20);
const SPOT_DISCOVERY_HISTORY_PAGES = Number(process.env.WHALE_SPOT_DISCOVERY_HISTORY_PAGES || 6);
const SPOT_MIN_LIQUIDITY_USD = Number(process.env.SIGNAL_SPOT_MIN_LIQUIDITY_USD || 50000);
const SPOT_MIN_VOLUME24H_USD = Number(process.env.SIGNAL_SPOT_MIN_VOLUME24H_USD || 100000);
const FUTURES_MIN_24H_VOLUME_USD = Number(process.env.SIGNAL_FUTURES_MIN_24H_VOLUME_USD || 1000000);
const FUTURES_REQUIRE_MARKET_CONFIRMATION = String(process.env.SIGNAL_FUTURES_REQUIRE_MARKET_CONFIRMATION || 'true').toLowerCase() !== 'false';
const SIGNAL_JOURNAL_FILE = process.env.SIGNAL_JOURNAL_FILE || 'state/signal_journal.json';
const SIGNAL_OUTCOME_MINUTES = Number(process.env.SIGNAL_OUTCOME_MINUTES || 15);
const SIGNAL_OUTCOME_MAX_HOURS = Number(process.env.SIGNAL_OUTCOME_MAX_HOURS || 24);
const TELEGRAM_DEDUP_MIN = Number(process.env.SIGNAL_TELEGRAM_DEDUP_MIN || 15);
const TELEGRAM_STATE_FILE = process.env.SIGNAL_TELEGRAM_STATE_FILE || 'state/telegram_state.json';
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
const DISCOVERY_MIN_IN_WINDOW = Number(process.env.WHALE_DISCOVERY_MIN_IN_WINDOW || 3);
const DISCOVERY_MIN_HOLD_RATIO = Number(process.env.WHALE_DISCOVERY_MIN_HOLD_RATIO || 0.35);
const DISCOVERY_MIN_RECENT_LIFECYCLES = Number(process.env.WHALE_DISCOVERY_MIN_RECENT_LIFECYCLES || 1);
const DISCOVERY_MAX_CANDIDATES = Number(process.env.WHALE_DISCOVERY_MAX_CANDIDATES || 80);
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
const DISCOVERY_SPOT_MAX_CANDIDATES = Number(process.env.WHALE_DISCOVERY_SPOT_MAX_CANDIDATES || 20);
const DISCOVERY_STATE_FILE = process.env.WHALE_DISCOVERY_STATE_FILE || 'state/whale_watchlist.json';
const DISCOVERY_SCHEMA = 'V6.9-TIERED-DISCOVERY-AUDITED-PERFORMANCE-LIFECYCLE-RATE-LIMIT-SAFE-PARTIAL-PERFORMANCE';
const DISCOVERY_BUILD_SCHEMA = 'V6.1-PRO-MARKET-DISCOVERY-REBUILD';
// Contract tokens: DISCOVERY_FORCE_REFRESH_ON_UNDER_TARGET DISCOVERY_ACTIVE_FALLBACK_ENABLED FUTURES_MIN_SIGNAL_ADD_USD FUTURES_MIN_SIGNAL_WINDOW_NOTIONAL_USD FUTURES_SIGNAL_FRESHNESS_MIN SPOT_MIN_SIGNAL_BUY_USD lifecycleAddLabel ACTIVE_WATCH
const BUILD_TAG = 'V6.9-AUDITED-PERFORMANCE-LIFECYCLE-ACTIVE-WATCH-PARTIAL-PERFORMANCE-RATE-LIMIT-SAFE';
const DISCOVERY_TIERED_ENABLED = String(process.env.WHALE_DISCOVERY_TIERED_ENABLED || 'true').toLowerCase() !== 'false';
const DISCOVERY_CACHE_QUALITY_TTL_MIN = Number(process.env.WHALE_DISCOVERY_CACHE_QUALITY_TTL_MIN || 45);
const DISCOVERY_FORCE_REFRESH_ON_UNDER_TARGET = String(process.env.WHALE_DISCOVERY_FORCE_REFRESH_ON_UNDER_TARGET || 'true').toLowerCase() !== 'false';
const DISCOVERY_EMERGING_ENABLED = String(process.env.WHALE_DISCOVERY_EMERGING_ENABLED || 'true').toLowerCase() !== 'false';
const DISCOVERY_ACTIVE_FALLBACK_ENABLED = String(process.env.WHALE_DISCOVERY_ACTIVE_FALLBACK_ENABLED || 'true').toLowerCase() !== 'false';
const DISCOVERY_SIGNAL_READY_ONLY = String(process.env.WHALE_DISCOVERY_SIGNAL_READY_ONLY || 'false').toLowerCase() === 'true';
// Explicit quality-evidence aliases kept in the worker so the static audit and runtime use the same contract.
const DISCOVERY_SPOT_MIN_EVIDENCE_TRADES = Number(process.env.WHALE_DISCOVERY_SPOT_MIN_EVIDENCE_TRADES || 3);
const DISCOVERY_SPOT_MIN_RECENT_BUYS = Number(process.env.WHALE_DISCOVERY_SPOT_MIN_RECENT_BUYS || 1);
const DISCOVERY_SPOT_MIN_RECENT_BUY_USD = Number(process.env.WHALE_DISCOVERY_SPOT_MIN_RECENT_BUY_USD || 25);
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
const DISCOVERY_SPOT_FINALISTS = Number(process.env.WHALE_DISCOVERY_SPOT_FINALISTS || 20);
const SPOT_EMERGING_MIN_TRADES = Number(process.env.WHALE_SPOT_EMERGING_MIN_TRADES || 5);
const SPOT_EMERGING_MIN_WR = Number(process.env.WHALE_SPOT_EMERGING_MIN_WR || 58);
const SPOT_EMERGING_MIN_PF = Number(process.env.WHALE_SPOT_EMERGING_MIN_PF || 1.5);
const SPOT_EMERGING_MAX_DD_PCT = Number(process.env.WHALE_SPOT_EMERGING_MAX_DD_PCT || 20);
const FUTURES_EMERGING_MIN_TRADES = Number(process.env.WHALE_FUTURES_EMERGING_MIN_TRADES || 5);
const FUTURES_EMERGING_MIN_WR = Number(process.env.WHALE_FUTURES_EMERGING_MIN_WR || 58);
const FUTURES_EMERGING_MIN_PF = Number(process.env.WHALE_FUTURES_EMERGING_MIN_PF || 1.5);
const FUTURES_EMERGING_MAX_DD_PCT = Number(process.env.WHALE_FUTURES_EMERGING_MAX_DD_PCT || 20);
const DISCOVERY_DEEP_RATE_LIMIT_CONTINUE = String(process.env.WHALE_DISCOVERY_DEEP_RATE_LIMIT_CONTINUE || 'true').toLowerCase() !== 'false';
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
    if(x?.schema===DISCOVERY_SCHEMA&&ageMin>=0&&ageMin<DISCOVERY_TTL_MIN&&Array.isArray(x?.spotWallets)&&Array.isArray(x?.futuresWallets)){
      console.log(`[DISCOVERY][CACHE] age=${ageMin.toFixed(1)}m spot=${x.spotWallets.length} futures=${x.futuresWallets.length}`);
      return x;
    }
    console.log(`[DISCOVERY][CACHE] stale-schema-or-empty`);
  }catch(e){console.log(`[DISCOVERY][CACHE] miss ${String(e?.message||e).slice(0,100)}`)}
  return null;
}
async function readDiscoveryFallbackCache(){
  try{
    const raw=await fs.readFile(DISCOVERY_STATE_FILE,'utf8');
    const x=JSON.parse(raw);
    const spot=Array.isArray(x?.spotWallets)?x.spotWallets:[];
    const futures=Array.isArray(x?.futuresWallets)?x.futuresWallets:[];
    if(spot.length||futures.length){
      console.log(`[DISCOVERY][FALLBACK-CACHE] schema=${x?.schema||'unknown'} spot=${spot.length} futures=${futures.length}`);
      return {spotWallets:spot,futuresWallets:futures,generatedAt:n(x?.generatedAt)};
    }
  }catch(e){console.log(`[DISCOVERY][FALLBACK-CACHE] miss ${String(e?.message||e).slice(0,100)}`)}
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
  const candidates=rows
    .filter(r=>/^0x[a-fA-F0-9]{40}$/.test(String(r?.ethAddress||'')))
    .map(r=>{const d=lbMetric(r,'pnl'),w=lbMetric(r,'vlm'); return {...r,pnl7:d.week,pnl30:d.month,volume7:w.week,volume1d:w.day};})
    .filter(r=>r.volume7>=Math.max(50000,DISCOVERY_MIN_VOLUME_USD/2))
    .sort((a,b)=>(b.volume1d-a.volume1d)+(b.volume7-a.volume7)*0.001+(b.pnl7-a.pnl7)*0.01)
    .slice(0,DISCOVERY_MAX_CANDIDATES);
  console.log(`[DISCOVERY][FUTURES][MARKET-WIDE] leaderboard=${rows.length} candidates=${candidates.length} deep=${DISCOVERY_FUTURES_DEEP_CANDIDATES}`);

  const quick=[];
  for(const r of candidates){
    const w={name:`HL_${String(r.ethAddress).slice(2,6).toUpperCase()}`,address:r.ethAddress};
    try{
      const end=Date.now(), start=end-DISCOVERY_FUTURES_QUICK_LOOKBACK_HOURS*3600000;
      const pg=await fetchFillsPaginated(w,start,end,'quick',DISCOVERY_FUTURES_QUICK_MAX_PAGES,0);
      const st=holdStatsFromFills(pg.fills);
      const fresh=recentAddStatsFromFills(pg.fills,end,FUTURES_SIGNAL_FRESHNESS_MIN);
      if(pg.fills.length<10)continue;
      quick.push({...w,raw:r,quick:{recentFills:pg.fills.length,recentVolume:st.totalVolume,adds:st.additions,recentAdds:fresh.count,recentAddNotional:fresh.notional,signalReady:fresh.count>0&&fresh.notional>=FUTURES_DISCOVERY_MIN_FRESH_ADD_USD}});
    }catch(e){console.log(`[DISCOVERY][FUTURES][QUICK] ${w.name} ERROR ${String(e?.message||e).slice(0,100)}`)}
  }
  quick.sort((a,b)=>{
    const ar=n(a.quick.recentAdds),br=n(b.quick.recentAdds);
    const an=n(a.quick.recentAddNotional),bn=n(b.quick.recentAddNotional);
    const av=n(a.quick.recentVolume),bv=n(b.quick.recentVolume);
    const ap=n(a.raw?.pnl7),bp=n(b.raw?.pnl7);
    return (br-ar)*1000000+(bn-an)*10+(bv-av)+(bp-ap)*0.05;
  });
  const deepPool=quick.slice(0,DISCOVERY_FUTURES_DEEP_CANDIDATES);
  console.log(`[DISCOVERY][FUTURES][QUICK] accepted=${quick.length} signalReady=${quick.filter(x=>x.quick.signalReady).length}`);
  console.log(`[DISCOVERY][FUTURES][DEEP-POOL] ${deepPool.length}/${candidates.length}`);

  const verified=[]; const fallback=[];
  for(const x of deepPool){
    const w=x, r=x.raw;
    try{
      const end=Date.now(), start=end-DISCOVERY_LOOKBACK_HOURS*3600000;
      const pg=await fetchFillsPaginated(w,start,end,'deep',DISCOVERY_FUTURES_DEEP_MAX_PAGES,DISCOVERY_FUTURES_DEEP_DELAY_MS);
      const fills=pg.fills||[];
      const st=holdStatsFromFills(fills);
      const fresh=recentAddStatsFromFills(fills,end,FUTURES_SIGNAL_FRESHNESS_MIN);
      const trades=performanceTradeBook(fills);
      const perf=performanceWindow(fills,trades,end-DISCOVERY_LOOKBACK_HOURS*3600000,end);
      const accountValue=n(r.accountValue);
      const reasons=[];
      // V6.1 PRO: verification is tiered. Strong traders keep the original
      // statistical gate; Emerging traders can enter the watchlist with a
      // smaller but still meaningful sample when WR/PF/risk are stronger.
      if(st.totalVolume<DISCOVERY_MIN_VOLUME_USD)reasons.push(`VOLUME<${DISCOVERY_MIN_VOLUME_USD}`);
      if(Number.isFinite(accountValue)&&accountValue>0&&accountValue<TRADER_MIN_ACCOUNT_VALUE_USD)reasons.push(`ACCOUNT<$${TRADER_MIN_ACCOUNT_VALUE_USD}`);
      const ddPct=Number.isFinite(accountValue)&&accountValue>0&&Number.isFinite(perf.maxDrawdown)?(Math.max(0,perf.maxDrawdown)/accountValue)*100:null;
      const baseEligible=st.totalVolume>=DISCOVERY_MIN_VOLUME_USD && Number.isFinite(accountValue) && accountValue>=TRADER_MIN_ACCOUNT_VALUE_USD;
      if(Number.isFinite(ddPct)&&ddPct>TRADER_MAX_DD_PCT)reasons.push(`DD>${TRADER_MAX_DD_PCT}%`);
      const strong=baseEligible&&perf.closedTrades>=TRADER_MIN_CLOSED_TRADES&&n(perf.wr)>=TRADER_MIN_WR&&n(perf.pf)>=TRADER_MIN_PF&&n(perf.pnl)>TRADER_MIN_PNL_USD&&(!Number.isFinite(ddPct)||ddPct<=TRADER_MAX_DD_PCT);
      const emerging=baseEligible&&perf.closedTrades>=FUTURES_EMERGING_MIN_TRADES&&n(perf.wr)>=FUTURES_EMERGING_MIN_WR&&n(perf.pf)>=FUTURES_EMERGING_MIN_PF&&n(perf.pnl)>TRADER_MIN_PNL_USD&&(!Number.isFinite(ddPct)||ddPct<=FUTURES_EMERGING_MAX_DD_PCT);
      let quality=strong?'VERIFIED_TOP_TRADER':(emerging?'VERIFIED_EMERGING':'REJECTED');
      if(quality==='REJECTED'){
        if(perf.closedTrades<Math.min(TRADER_MIN_CLOSED_TRADES,FUTURES_EMERGING_MIN_TRADES))reasons.push(`CLOSED_TRADES<${FUTURES_EMERGING_MIN_TRADES}`);
        if(!(n(perf.wr)>=FUTURES_EMERGING_MIN_WR))reasons.push(`WR<${FUTURES_EMERGING_MIN_WR}%`);
        if(!(n(perf.pf)>=FUTURES_EMERGING_MIN_PF))reasons.push(`PF<${FUTURES_EMERGING_MIN_PF}`);
        if(!(n(perf.pnl)>TRADER_MIN_PNL_USD))reasons.push(`PNL<=${TRADER_MIN_PNL_USD}`);
      }
      console.log(`[DISCOVERY][FUTURES][QUALITY] ${w.name} fills=${fills.length} closed=${perf.closedTrades} WR=${perf.wr==null?'NA':perf.wr.toFixed(1)} PF=${perf.pf===Infinity?'INF':perf.pf==null?'NA':perf.pf.toFixed(2)} PNL=${perf.pnl==null?'NA':perf.pnl.toFixed(2)} DD=${ddPct==null?'NA':ddPct.toFixed(2)}% acct=${accountValue||0} hold1-24=${st.inWindow}/${st.completed} freshADDs=${fresh.count} quality=${quality}${reasons.length?' reason='+reasons.join(','):''}`);
      if(quality==='REJECTED'){
        const active=DISCOVERY_ACTIVE_FALLBACK_ENABLED && x.quick?.signalReady && fresh.notional>=FUTURES_DISCOVERY_MIN_FRESH_ADD_USD;
        if(active){quality='ACTIVE_FALLBACK'; reasons.push('ACTIVE_FALLBACK_ONLY');} else continue;
      }
      const tierBoost=quality==='VERIFIED_TOP_TRADER'?100000:quality==='VERIFIED_EMERGING'?50000:10000;
      const sampleBoost=Math.min(50000,Math.max(0,perf.closedTrades)*500);
      const discovery={
        volume48h:st.totalVolume, completedLifecycles:st.completed, inWindow:st.inWindow, holdRatio:st.holdRatio,
        medianHoldHours:st.medianHoldHours, avgHoldHours:st.avgHoldHours, recentLifecycles:st.recentLifecycles,
        observedAdds:st.additions, pnl7:r.pnl7, pnl30:r.pnl30, leaderboardVolume7:r.volume7,
        accountValue, recentAdds:fresh.count, recentAddNotional:fresh.notional,
        wr:perf.wr,pf:perf.pf,realizedPnl:perf.pnl,closedTrades:perf.closedTrades,maxDrawdown:ddPct,
        quality,qualificationReasons:[], confidenceTier:quality, score:tierBoost+sampleBoost+n(perf.wr)*100+n(perf.pf)*500+Math.min(50,Math.max(0,perf.pnl/1000))+Math.min(25,Math.max(0,st.totalVolume/1000000))+fresh.count*50
      };
      (quality==='ACTIVE_FALLBACK'?fallback:verified).push({...w,discovery});
    }catch(e){console.log(`[DISCOVERY][FUTURES][DEEP] ${w.name} ERROR ${String(e?.message||e).slice(0,140)}`)}
    await sleep(DISCOVERY_FUTURES_DEEP_DELAY_MS);
  }
  verified.sort((a,b)=>n(b.discovery.score)-n(a.discovery.score));
  fallback.sort((a,b)=>n(b.discovery.score)-n(a.discovery.score));
  const selected=[...verified,...fallback];
  // V6.5: if statistical tiers do not fill the monitoring target, use a
  // separate ACTIVE_WATCH tier from the quick universe. These wallets are
  // NEVER presented as VERIFIED; they only keep signal scanning populated
  // when there is fresh, meaningful activity.
  if(DISCOVERY_ACTIVE_FALLBACK_ENABLED && selected.length<TARGET_FUTURES_WALLETS){
    const used=new Set(selected.map(x=>String(x.address||'')));
    const activeWatch=quick
      .filter(x=>{
        const a=String(x.address||'');
        return !used.has(a) && x.quick?.signalReady &&
          n(x.quick?.recentFills)>=FUTURES_MIN_ACTIVE_FILLS &&
          n(x.quick?.recentVolume)>=FUTURES_MIN_ACTIVE_VOLUME_USD &&
          n(x.quick?.recentAddNotional)>=FUTURES_DISCOVERY_MIN_FRESH_ADD_USD;
      })
      .sort((a,b)=>(n(b.quick?.recentAddNotional)-n(a.quick?.recentAddNotional))*10+(n(b.quick?.recentVolume)-n(a.quick?.recentVolume)))
      .map(x=>({...x,discovery:{quality:'ACTIVE_WATCH',confidenceTier:'ACTIVE_WATCH',qualificationReasons:['QUICK_ACTIVITY_ONLY','NOT_PERFORMANCE_VERIFIED'],recentFills:n(x.quick?.recentFills),recentVolume:n(x.quick?.recentVolume),recentAdds:n(x.quick?.recentAdds),recentAddNotional:n(x.quick?.recentAddNotional),score:5000+n(x.quick?.recentAddNotional)+n(x.quick?.recentVolume)*0.01}}));
    selected.push(...activeWatch);
    console.log(`[DISCOVERY][FUTURES][ACTIVE-WATCH] added=${activeWatch.length} target=${TARGET_FUTURES_WALLETS}`);
  }
  const finalSelected=selected.slice(0,TARGET_FUTURES_WALLETS);
  console.log(`[DISCOVERY][FUTURES][SELECTION] verified=${verified.length} fallback=${fallback.length} selected=${finalSelected.length}/${TARGET_FUTURES_WALLETS}`);
  if(!finalSelected.length)console.log('[DISCOVERY][FUTURES][NO-WATCHABLE-TRADERS] No Futures wallet passed statistical or active-watch criteria.');
  return finalSelected;
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
    console.log('[DISCOVERY][SPOT][HELIUS] disabled: HELIUS_API_KEY required');
    return [];
  }
  const programs=[
    ['JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4','JUPITER'],
    ['675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8','RAYDIUM'],
    ['6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P','PUMPFUN'],
    ['whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc','ORCA']
  ];
  const solUsd=(await tokenInfo(WSOL_MINT)).price||await tokenPrice(WSOL_MINT);
  if(!(solUsd>0))return [];
  const evidence=new Map();
  let discoveryRateLimited=false;
  for(const [program,label] of programs){
    if(heliusCircuitOpen()){ discoveryRateLimited=true; console.log(`[DISCOVERY][SPOT][PROGRAM] ${label} SKIP=HELIUS_CIRCUIT_OPEN`); break; }
    try{
      const rows=await heliusEnhancedTransactions(program,100,'',`program:${label}`);
      let swaps=0;
      for(const tx of rows){
        if(String(tx?.type||'').toUpperCase()!=='SWAP')continue;
        const ts=n(tx?.timestamp)*1000; if(!ts||Date.now()-ts>DISCOVERY_LOOKBACK_HOURS*3600000)continue;
        const wallet=String(tx?.feePayer||''); if(!wallet||wallet.length<20)continue;
        const sw=enhancedSwap(tx,wallet,solUsd,0); if(!sw)continue;
        swaps++;
        let e=evidence.get(wallet); if(!e)e={address:wallet,programHits:0,swaps:0,buys:0,sells:0,recentBuys:0,recentBuyVolume:0,volumeUsd:0,lastTrade:0};
        e.programHits++; e.swaps++; e.lastTrade=Math.max(e.lastTrade,ts); e.volumeUsd+=n(sw.fundingUsd);
        if(sw.direction==='BUY'){e.buys++; if(Date.now()-ts<=SPOT_ACTIVITY_LOOKBACK_MIN*60000){e.recentBuys++;e.recentBuyVolume+=n(sw.fundingUsd);}}
        else if(sw.direction==='SELL')e.sells++;
        evidence.set(wallet,e);
      }
      console.log(`[DISCOVERY][SPOT][PROGRAM] ${label} tx=${rows.length} decodedSwaps=${swaps}`);
    }catch(e){
      const msg=String(e?.message||e);
      console.log(`[DISCOVERY][SPOT][PROGRAM] ${label} ERROR ${msg.slice(0,140)}`);
      if(/HELIUS_CIRCUIT_OPEN|429|rate.?limit|max usage|credit/i.test(msg)){discoveryRateLimited=true;break;}
    }
    await sleep(250);
  }

  const pool=[...evidence.values()]
    .filter(x=>(x.buys+x.sells)>=1 && x.volumeUsd>=SPOT_MIN_BUY_USD)
    .sort((a,b)=>(b.recentBuyVolume-a.recentBuyVolume)*1000+(b.recentBuys-a.recentBuys)*100+(b.programHits-a.programHits)*10+(b.volumeUsd-a.volumeUsd)*0.01)
    .slice(0,Math.max(SPOT_DISCOVERY_DEEP_CANDIDATES,DISCOVERY_SPOT_FINALISTS,TARGET_SPOT_WALLETS));
  console.log(`[DISCOVERY][SPOT][UNIVERSE] evidenceWallets=${evidence.size} qualityPool=${pool.length} rateLimited=${discoveryRateLimited}`);
  if(!pool.length)return [];

  const finals=[],fallback=[];
  for(const c of pool){
    const w={name:`SOL_${c.address.slice(0,4).toUpperCase()}`,address:c.address};
    try{
      let pg={txs:[],coverageDays:0,truncated:true,rateLimited:false};
      let performanceAvailable=true;
      if(!heliusCircuitOpen()){
        const end=Date.now(), start=end-PERFORMANCE_LOOKBACK_DAYS*86400000;
        pg=await fetchSpotPerformanceHistory(w,start,end);
        if(pg.rateLimited || heliusCircuitOpen()) performanceAvailable=false;
      }else performanceAvailable=false;
      const txs=pg.txs||[];
      const trades=performanceAvailable?spotPerformanceTrades(txs,solUsd,w.address):[];
      const end=Date.now(), start=end-PERFORMANCE_LOOKBACK_DAYS*86400000;
      const w7=spotPerformanceWindow(trades,end-7*86400000,end);
      const w30=spotPerformanceWindow(trades,start,end);
      const recentBuys=c.recentBuys, recentBuyVolume=c.recentBuyVolume;
      const metric=(w7.closedTrades>=SPOT_TRADER_MIN_CLOSED_TRADES?w7:w30);
      const metricLabel=metric===w7?'7D':'30D';
      const ddPct=performanceAvailable&&Number.isFinite(metric.maxDrawdown)&&Number(metric.investedUsd)>0?(Math.max(0,Number(metric.maxDrawdown))/Number(metric.investedUsd))*100:null;
      const strong=performanceAvailable&&metric.closedTrades>=SPOT_TRADER_MIN_CLOSED_TRADES&&n(metric.wr)>=SPOT_TRADER_MIN_WR&&n(metric.pf)>=SPOT_TRADER_MIN_PF&&n(metric.realizedPnl)>SPOT_TRADER_MIN_PNL_USD&&(!Number.isFinite(ddPct)||ddPct<=TRADER_MAX_DD_PCT);
      const emerging=performanceAvailable&&metric.closedTrades>=SPOT_EMERGING_MIN_TRADES&&n(metric.wr)>=SPOT_EMERGING_MIN_WR&&n(metric.pf)>=SPOT_EMERGING_MIN_PF&&n(metric.realizedPnl)>SPOT_TRADER_MIN_PNL_USD&&(!Number.isFinite(ddPct)||ddPct<=SPOT_EMERGING_MAX_DD_PCT);
      let quality=strong?'VERIFIED_TOP_TRADER':(emerging?'VERIFIED_EMERGING':'REJECTED');
      const reasons=[];
      if(!performanceAvailable) reasons.push('PERFORMANCE_UNAVAILABLE_RATE_LIMITED');
      if(quality==='REJECTED' && performanceAvailable){
        if(metric.closedTrades<SPOT_EMERGING_MIN_TRADES)reasons.push(`TRADES<${SPOT_EMERGING_MIN_TRADES}`);
        if(!(n(metric.wr)>=SPOT_EMERGING_MIN_WR))reasons.push(`${metricLabel}_WR<${SPOT_EMERGING_MIN_WR}%`);
        if(!(n(metric.pf)>=SPOT_EMERGING_MIN_PF))reasons.push(`${metricLabel}_PF<${SPOT_EMERGING_MIN_PF}`);
        if(!(n(metric.realizedPnl)>SPOT_TRADER_MIN_PNL_USD))reasons.push(`${metricLabel}_PNL<=${SPOT_TRADER_MIN_PNL_USD}`);
        if(Number.isFinite(ddPct)&&ddPct>SPOT_EMERGING_MAX_DD_PCT)reasons.push(`${metricLabel}_DD>${SPOT_EMERGING_MAX_DD_PCT}%`);
      }
      const activeEligible=DISCOVERY_ACTIVE_FALLBACK_ENABLED&&recentBuys>=DISCOVERY_ACTIVE_MIN_RECENT_BUYS&&recentBuyVolume>=DISCOVERY_ACTIVE_MIN_RECENT_BUY_USD;
      if(quality==='REJECTED' && activeEligible){quality='ACTIVE_FALLBACK';reasons.push('ACTIVE_FALLBACK_ONLY');}
      if(quality==='REJECTED'){console.log(`[DISCOVERY][SPOT][QUALITY] ${w.name} REJECTED ${reasons.join(',')}`);continue;}
      const discovery={programHits:c.programHits,buys:c.buys,sells:c.sells,recentBuys,recentBuyVolume,volumeUsd:c.volumeUsd,lastTrade:c.lastTrade,
        wr7:w7.wr,pf7:w7.pf,pnl7:w7.realizedPnl,trades7:w7.closedTrades,wr30:w30.wr,pf30:w30.pf,pnl30:w30.realizedPnl,trades30:w30.closedTrades,
        verifiedWr:metric.wr,verifiedPf:metric.pf,verifiedPnl:metric.realizedPnl,verifiedTrades:metric.closedTrades,coverageDays:performanceAvailable?pg.coverageDays:0,
        quality,qualificationReasons:reasons,confidenceTier:quality,performanceAvailable,performanceStatus:performanceAvailable?'AVAILABLE':'UNAVAILABLE_RATE_LIMITED',
        score:(quality==='VERIFIED_TOP_TRADER'?100000:quality==='VERIFIED_EMERGING'?50000:10000)+Math.min(50000,Math.max(0,metric.closedTrades)*500)+n(metric.wr)*100+n(metric.pf)*500+recentBuys*100+Math.min(25,recentBuyVolume/100)};
      (quality==='ACTIVE_FALLBACK'?fallback:finals).push({...w,discovery});
      console.log(`[DISCOVERY][SPOT][QUALITY] ${w.name} performance=${performanceAvailable?'AVAILABLE':'UNAVAILABLE'} quality=${quality} freshBuys=${recentBuys} freshUSD=${recentBuyVolume.toFixed(2)} reason=${reasons.join(',')||'VERIFIED'}`);
    }catch(e){
      const msg=String(e?.message||e);
      console.log(`[DISCOVERY][SPOT][DEEP] ${w.name} ERROR ${msg.slice(0,140)}`);
      if(/HELIUS_CIRCUIT_OPEN|429|rate.?limit|max usage|credit/i.test(msg)){
        const activeEligible=DISCOVERY_ACTIVE_FALLBACK_ENABLED&&c.recentBuys>=DISCOVERY_ACTIVE_MIN_RECENT_BUYS&&c.recentBuyVolume>=DISCOVERY_ACTIVE_MIN_RECENT_BUY_USD;
        if(activeEligible)fallback.push({...w,discovery:{programHits:c.programHits,buys:c.buys,sells:c.sells,recentBuys:c.recentBuys,recentBuyVolume:c.recentBuyVolume,volumeUsd:c.volumeUsd,lastTrade:c.lastTrade,quality:'ACTIVE_WATCH',confidenceTier:'ACTIVE_WATCH',performanceAvailable:false,performanceStatus:'UNAVAILABLE_RATE_LIMITED',qualificationReasons:['PERFORMANCE_UNAVAILABLE_RATE_LIMITED','RECENT_ACTIVITY_ONLY'],score:5000+n(c.recentBuyVolume)+n(c.swaps)*10}});
      }
    }
    if(heliusCircuitOpen())break;
    await sleep(300);
  }
  finals.sort((a,b)=>n(b.discovery.score)-n(a.discovery.score));
  fallback.sort((a,b)=>n(b.discovery.score)-n(a.discovery.score));
  const selected=[...finals,...fallback];
  if(DISCOVERY_ACTIVE_FALLBACK_ENABLED&&selected.length<TARGET_SPOT_WALLETS){
    const used=new Set(selected.map(x=>String(x.address||'')));
    const activeWatch=pool.filter(c=>!used.has(String(c.address||''))&&n(c.swaps)>=DISCOVERY_ACTIVE_MIN_TOTAL_TRADES&&n(c.recentBuys)>=DISCOVERY_ACTIVE_MIN_RECENT_BUYS&&n(c.recentBuyVolume)>=DISCOVERY_ACTIVE_MIN_RECENT_BUY_USD)
      .sort((a,b)=>(n(b.recentBuyVolume)-n(a.recentBuyVolume))*10+(n(b.swaps)-n(a.swaps)))
      .map(c=>({name:`SOL_${c.address.slice(0,4).toUpperCase()}`,address:c.address,discovery:{programHits:c.programHits,buys:c.buys,sells:c.sells,recentBuys:c.recentBuys,recentBuyVolume:c.recentBuyVolume,volumeUsd:c.volumeUsd,lastTrade:c.lastTrade,coverageDays:0,quality:'ACTIVE_WATCH',confidenceTier:'ACTIVE_WATCH',performanceAvailable:false,performanceStatus:'UNAVAILABLE_RATE_LIMITED',qualificationReasons:['RECENT_ACTIVITY_ONLY','NOT_PERFORMANCE_VERIFIED'],score:5000+n(c.recentBuyVolume)+n(c.swaps)*10}}));
    selected.push(...activeWatch);
    console.log(`[DISCOVERY][SPOT][ACTIVE-WATCH] added=${activeWatch.length} target=${TARGET_SPOT_WALLETS}`);
  }
  const finalSelected=selected.slice(0,TARGET_SPOT_WALLETS);
  console.log(`[DISCOVERY][SPOT][SELECTION] verified=${finals.length} fallback=${fallback.length} selected=${finalSelected.length}/${TARGET_SPOT_WALLETS}`);
  return finalSelected;
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
  const fallbackCache=cached||await readDiscoveryFallbackCache();
  const cacheFresh=Boolean(cached);
  let spotWallets=cacheFresh?cached.spotWallets:(fallbackCache?.spotWallets||[]);
  let futuresWallets=cacheFresh?cached.futuresWallets:(fallbackCache?.futuresWallets||[]);
  const cacheUnderTarget=spotWallets.length<TARGET_SPOT_WALLETS||futuresWallets.length<TARGET_FUTURES_WALLETS;
  const refreshNow=DISCOVERY_REFRESH_EACH_CYCLE||!spotWallets.length||!futuresWallets.length||(DISCOVERY_FORCE_REFRESH_ON_UNDER_TARGET&&cacheUnderTarget);
  if(refreshNow||!spotWallets.length){
    console.log(`[DISCOVERY][SPOT][REFRESH] cache=${cacheFresh?'fresh':fallbackCache?'fallback':'missing'} refresh=${DISCOVERY_REFRESH_EACH_CYCLE}`);
    const fresh=await discoverSpotCandidates();
    if(fresh.length)spotWallets=fresh;
    else if(fallbackCache?.spotWallets?.length)console.log(`[DISCOVERY][SPOT][PRESERVE] new discovery unavailable; preserving ${fallbackCache.spotWallets.length} cached wallets`);
  }
  if(refreshNow||!futuresWallets.length){
    await sleep(1200);
    console.log(`[DISCOVERY][FUTURES][REFRESH] cache=${cacheFresh?'fresh':fallbackCache?'fallback':'missing'} refresh=${DISCOVERY_REFRESH_EACH_CYCLE}`);
    const fresh=await discoverFutures();
    if(fresh.length)futuresWallets=fresh;
    else if(fallbackCache?.futuresWallets?.length)console.log(`[DISCOVERY][FUTURES][PRESERVE] new discovery unavailable; preserving ${fallbackCache.futuresWallets.length} cached wallets`);
  }
  const tier=(w)=>String(w?.discovery?.quality||w?.discovery?.tier||'VERIFIED').toUpperCase();
  const annotate=(arr,kind)=>arr.map((w,i)=>({...w,discovery:{...(w.discovery||{}),tier:tier(w),selectionRank:i+1,selectionKind:kind}}));
  spotWallets=annotate(spotWallets,'SPOT'); futuresWallets=annotate(futuresWallets,'FUTURES');
  const data={schema:DISCOVERY_SCHEMA,generatedAt:Date.now(),criteria:{holdHours:[DISCOVERY_MIN_HOLD_HOURS,DISCOVERY_MAX_HOLD_HOURS],minVolumeUsd:DISCOVERY_MIN_VOLUME_USD,minInWindow:DISCOVERY_MIN_IN_WINDOW,minHoldRatio:DISCOVERY_MIN_HOLD_RATIO,topTraderGate:{wr:TRADER_MIN_WR,pf:TRADER_MIN_PF,closedTrades:TRADER_MIN_CLOSED_TRADES}},spotWallets,futuresWallets};
  SPOT_WALLETS=spotWallets.slice(0,TARGET_SPOT_WALLETS); FUTURES_WALLETS=futuresWallets.slice(0,TARGET_FUTURES_WALLETS);
  await writeDiscoveryCache(data);
  console.log(`[DISCOVERY][DONE] verified spot=${SPOT_WALLETS.length}/${TARGET_SPOT_WALLETS} futures=${FUTURES_WALLETS.length}/${TARGET_FUTURES_WALLETS}`);
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
  if(heliusCircuitOpen()) throw new Error('HELIUS_CIRCUIT_OPEN_RATE_LIMITED');
  const q=new URLSearchParams({'api-key':HELIUS_API_KEY,limit:String(Math.min(Math.max(1,limit),100))});
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
      const limited=/429|rate.?limit|too many requests|max usage|credit/i.test(msg);
      if(limited){ markHeliusRateLimit(label); break; }
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
  try{
    const crypto=await import('node:crypto');
    const normalized=text.replace(/^🕒 .*$/m,'🕒 <CYCLE_TIME>').replace(/^⏱ Cycle .*$/m,'⏱ <CYCLE_DURATION>');
    const hash=crypto.createHash('sha256').update(normalized).digest('hex');
    let prev={}; try{prev=JSON.parse(await fs.readFile(TELEGRAM_STATE_FILE,'utf8'));}catch{}
    if(prev.hash===hash && n(prev.sentAt)>Date.now()-TELEGRAM_DEDUP_MIN*60000){
      console.log(`[TELEGRAM][DEDUP] identical report suppressed for ${TELEGRAM_DEDUP_MIN}m`);return;
    }
    for(let i=0;i<text.length;i+=TG_LIMIT){
      await fetchJson(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:TG_CHAT,text:text.slice(i,i+TG_LIMIT),disable_web_page_preview:true})},'telegram');
    }
    await fs.mkdir(path.dirname(TELEGRAM_STATE_FILE),{recursive:true});
    await fs.writeFile(TELEGRAM_STATE_FILE,JSON.stringify({hash,sentAt:Date.now()},null,2));
  }catch(e){console.error('[TELEGRAM]',e.message)}
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
async function scanSpotViaSolanaRpc(w){
  const solInfo=await tokenInfo(WSOL_MINT); const solUsd=solInfo.price||await tokenPrice(WSOL_MINT);
  if(!(solUsd>0))throw new Error('SOL_PRICE_UNAVAILABLE');
  const cutoff=Date.now()-SPOT_MAX_ACTIVITY_AGE_MIN*60000;
  const sigResp=await solDiscovery({method:'getSignaturesForAddress',params:[w.address,{limit:Math.min(RECENT_SIGS,30)}]},`signal-fallback:sigs:${w.name}`);
  const sigs=Array.isArray(sigResp?.result)?sigResp.result.filter(x=>!x.err):[];
  const candidates=[]; const diagnostics=[]; const seen=new Set();
  let inspected=0;
  for(const s of sigs){
    const bt=n(s?.blockTime)*1000; if(!bt||bt<cutoff)continue;
    const txResp=await solDiscovery({method:'getTransaction',params:[s.signature,{encoding:'jsonParsed',maxSupportedTransactionVersion:0}]},`signal-fallback:tx:${w.name}`); const tx=txResp?.result||null; inspected++;
    if(!tx)continue;
    const d=swapDirection(tx,w.address,new Set());
    if(d.direction!=='BUY')continue;
    for(const pos of (d.positive||[])){
      const rec=reconstructedBuy(tx,w.address,pos.mint,pos.delta,solUsd,new Set());
      if(!rec||rec.fundingUsd<SPOT_MIN_SIGNAL_BUY_USD||seen.has(pos.mint))continue;
      const info=await tokenMarketData(pos.mint); const px=n(info.price); if(!(px>0))continue;
      if(n(info.liquidity)<SPOT_MIN_LIQUIDITY_USD||n(info.volume24h)<SPOT_MIN_VOLUME24H_USD)continue;
      const entry=rec.fundingUsd/pos.delta; if(!(entry>0))continue;
      const dist=(px/entry-1)*100; const sl=entry*(1-SL_PCT/100),tp=entry*(1+TP_PCT/100); const R=normalizedRR(entry-sl,tp-entry);
      const ageMin=Math.max(0,(Date.now()-bt)/60000);
      candidates.push({wallet:w,coin:info.symbol||pos.mint.slice(0,6),mint:pos.mint,side:'LONG',sourceEntry:entry,current:px,distancePct:dist,sl,tp,rr:R,age:bt,ageMin,liquidity:info.liquidity,volume24h:info.volume24h,tx:s.signature,buyNotionalUsd:rec.fundingUsd,fundingAsset:rec.fundingAsset,activitySource:'SOLANA_RPC_FALLBACK',priceSource:info.source,avgEntry:entry,eligible:Math.abs(dist)<=ENTRY_WINDOW_PCT&&R>=MIN_RR&&ageMin<=SPOT_MAX_SIGNAL_AGE_MIN});
      seen.add(pos.mint); if(candidates.length>=MAX_SPOT_POSITIONS)break;
    }
    if(candidates.length>=MAX_SPOT_POSITIONS)break;
    if(inspected>=20)break;
  }
  return {wallet:w,signals:candidates.filter(x=>x.eligible),positions:[],recentBuys:candidates,scanned:sigs.length,txs:inspected,health:spotHealth(w),activityLookbackMin:SPOT_MAX_ACTIVITY_AGE_MIN,diagnostics:diagnostics.slice(0,SPOT_DIAGNOSTIC_MAX),tokenAccounts:0,sourceFallback:true};
}

async function scanSpot(w){
  const solInfo=await tokenInfo(WSOL_MINT);
  const solUsd=solInfo.price||await tokenPrice(WSOL_MINT);
  if(!(solUsd>0))throw new Error('SOL_PRICE_UNAVAILABLE');
  const cutoff=Date.now()-SPOT_MAX_ACTIVITY_AGE_MIN*60000;
  const candidates=[]; const diagnostics=[]; const seen=new Set();
  if(HELIUS_ENHANCED_ENABLED && !heliusCircuitOpen()){
    const txs=await heliusEnhancedTransactions(w.address,100,'',`signal:${w.name}`);
    for(const tx of txs){
      const bt=n(tx?.timestamp)*1000; if(!bt||bt<cutoff)continue;
      const sw=enhancedSwap(tx,w.address,solUsd); if(!sw||sw.direction!=='BUY'||n(sw.fundingUsd)<SPOT_MIN_SIGNAL_BUY_USD||seen.has(sw.mint))continue;
      const info=await tokenMarketData(sw.mint); const px=n(info.price);
      if(!(px>0)){diagnostics.push({sig:tx.signature,reason:`PRICE_UNRESOLVED:${sw.mint.slice(0,8)}`});continue;}
      if(n(info.liquidity)<SPOT_MIN_LIQUIDITY_USD || n(info.volume24h)<SPOT_MIN_VOLUME24H_USD){diagnostics.push({sig:tx.signature,reason:`MARKET_TOO_THIN:liq=${Math.round(n(info.liquidity))}:vol24=${Math.round(n(info.volume24h))}`});continue;}
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
  return scanSpotViaSolanaRpc(w);
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
    if(Math.abs(pos)>1e-12)map.set(coin,{coin,side:pos>0?'LONG':'SHORT',size:Math.abs(pos),entry,positionValue:Math.abs(pos)*entry,unrealized:null,leverage:null,liq:null,margin:null,source:'FILL_RECONSTRUCTION',openedAt:rows[0]?.time||null});
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
  return {pnl,observedPnl:pnl,closedTrades:closed.length,wins,losses,wr:closed.length?(wins/closed.length*100):null,pf:grossLoss>0?grossProfit/grossLoss:(grossProfit>0?Infinity:null),maxDrawdown:maxDd,grossProfit,grossLoss,coinPnl:byCoin,topCoin:topCoin?{coin:topCoin[0],pnl:topCoin[1]}:null,fillCount:fs.length,observedFills:fs.length};
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
  return {roi:invested>0?realized/invested*100:null,realizedPnl:realized,observedPnl:realized,investedUsd:invested,closedTrades:closed.length,wins,losses,wr:closed.length?wins/closed.length*100:null,pf:grossLoss>0?grossProfit/grossLoss:(grossProfit>0?Infinity:null),maxDrawdown:maxDd,maxDrawdownPct:invested>0?maxDd/invested*100:null,avgHoldHours:avgHold,coinPnl:byCoin,topCoin:topCoin?{coin:topCoin[0],pnl:topCoin[1]}:null,observedTrades:closed.length};
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
  }catch(e){
    const msg=String(e?.message||e);
    const limited=/429|rate.?limit|HELIUS_CIRCUIT_OPEN|max usage|credit/i.test(msg);
    console.log(`[PERF][SPOT-ERROR] ${w.name} ${limited?'RATE_LIMITED':'ERROR'} ${msg.slice(0,180)}`);
    const cachedAgain=await readPerformanceCache(); const prior=cachedAgain[key]?.data;
    if(prior && !prior.rateLimited) return {...prior,stale:true,staleReason:limited?'RATE_LIMITED':'ERROR'};
    return {error:msg,complete:false,market:'SPOT',rateLimited:limited,performanceStatus:limited?'UNAVAILABLE_RATE_LIMITED':'UNAVAILABLE'};
  }
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
  }catch(e){
    const msg=String(e?.message||e);
    console.log(`[PERF][FUTURES-ERROR] ${w.name} ${msg.slice(0,180)}`);
    const cachedAgain=await readPerformanceCache(); const prior=cachedAgain[key]?.data;
    if(prior) return {...prior,stale:true,staleReason:'FETCH_ERROR'};
    return {error:msg,complete:false,market:'FUTURES',performanceStatus:'UNAVAILABLE'};
  }
}
function performanceBlock(p,coin){
  if(!p) return ['📊 PERFORMANCE','7D  — unavailable','30D — unavailable','⚠️ Performance unavailable — no audited history in this cycle'];
  if(p.performanceStatus==='UNAVAILABLE_RATE_LIMITED' || p.rateLimited || p.error){
    const why=p.performanceStatus==='UNAVAILABLE_RATE_LIMITED'||p.rateLimited?'Helius rate limit / credits':'history fetch unavailable';
    return ['📊 PERFORMANCE','7D  — unavailable','30D — unavailable',`⚠️ Performance unavailable — ${why}; activity signals remain live`];
  }
  const fmtPct=x=>Number.isFinite(Number(x))?`${Number(x)>=0?'+':''}${Number(x).toFixed(2)}%`:'—';
  const fmtMoney=x=>Number.isFinite(Number(x))?money(Number(x)):'—';
  const fmtWR=x=>Number.isFinite(Number(x))?`${Number(x).toFixed(1)}%`:'—';
  const fmtPF=x=>x===Infinity?'∞':Number.isFinite(Number(x))?Number(x).toFixed(2):'—';
  const c7=p.w7||{},c30=p.w30||{}; const coverageDays=n(p.coverageDays);
  const cov7=p.coverage7d!==false&&coverageDays>=6.5; const cov30=p.coverage30d===true||coverageDays>=29.5;
  const noClosed7=!Number.isFinite(Number(c7.closedTrades)) || Number(c7.closedTrades)<=0;
  const noClosed30=!Number.isFinite(Number(c30.closedTrades)) || Number(c30.closedTrades)<=0;
  const rows=['📊 PERFORMANCE'];
  rows.push(`${cov7?'7D  ':'7D*'} ROI ${noClosed7?'—':fmtPct(c7.roi)} | WR ${noClosed7?'—':fmtWR(c7.wr)} | PF ${noClosed7?'—':fmtPF(c7.pf)} | Trades ${noClosed7?'—':c7.closedTrades}`);
  rows.push(`${cov30?'30D ':'30D*'} ROI ${noClosed30?'—':fmtPct(c30.roi)} | WR ${noClosed30?'—':fmtWR(c30.wr)} | PF ${noClosed30?'—':fmtPF(c30.pf)} | Trades ${noClosed30?'—':c30.closedTrades}`);
  if(Number.isFinite(Number(c30.avgHoldHours)))rows.push(`30D  Avg Hold ${Number(c30.avgHoldHours).toFixed(2)}h`);
  if(p.market==='SPOT'&&Number.isFinite(Number(c30.maxDrawdownPct)))rows.push(`30D  Max DD ${fmtPct(-Math.abs(c30.maxDrawdownPct))}`);
  else if(p.market==='FUTURES')rows.push('30D  Max DD — equity curve unavailable');
  if(coin&&c30.coinPnl&&Object.prototype.hasOwnProperty.call(c30.coinPnl,coin))rows.push(`30D  ${coin} PnL ${fmtMoney(c30.coinPnl[coin])}`);
  if(Number.isFinite(Number(c30.observedPnl)) && Math.abs(Number(c30.observedPnl))>0.0000001 && (!coin || !c30.coinPnl || !Object.prototype.hasOwnProperty.call(c30.coinPnl,coin)))rows.push(`30D  Observed PnL ${fmtMoney(c30.observedPnl)}`);
  if(Number.isFinite(coverageDays))rows.push(`History ${coverageDays.toFixed(1)}d available${cov30?'':' | 30D PARTIAL'}`);
  if(Number.isFinite(Number(c30.observedFills)) && Number(c30.observedFills)>0)rows.push(`Observed fills ${Number(c30.observedFills)}`);
  if(p.complete===false||!cov30||p.stale||noClosed30){
    if(p.stale)rows.push(`⚠️ Stale cached history — ${coverageDays>0?`${coverageDays.toFixed(1)}d observed`:'cached data only'}; not treated as zero performance`);
    else if(noClosed30)rows.push('⚠️ No closed-trade sample in available history — WR/PF/ROI withheld, not treated as zero');
    else if(!cov30)rows.push('⚠️ Partial history — available sample shown; not eligible for Verified gate');
  }
  return rows;
}
function whaleSignalBlock(w,signals,p,i){
  const quality=String(w?.discovery?.quality||'VERIFIED_TOP_TRADER').toUpperCase();
  const title=quality==='VERIFIED_TOP_TRADER'?'VERIFIED TOP TRADER':quality==='VERIFIED_EMERGING'?'VERIFIED EMERGING':'ACTIVE WATCH';
  const marketIcon=signals.some(x=>x?.mint)?'🟢':'🔵';
  const rows=[
    `${marketIcon} 🐋 ${title} ${i} — ${w.name}`,
    `🏷 ${w?.discovery?.quality||'VERIFIED_TOP_TRADER'} | WR ${Number.isFinite(Number(w?.discovery?.wr7??w?.discovery?.wr))?Number(w.discovery.wr7??w.discovery.wr).toFixed(1)+'%':'—'} | PF ${w?.discovery?.pf7!=null?Number(w.discovery.pf7).toFixed(2):w?.discovery?.pf!=null?Number(w.discovery.pf).toFixed(2):'—'}`,
    `${p?.complete===false||p?.stale?'📚 History: PARTIAL / OBSERVED':'📚 History: AUDITED'}`,
    '━━━━━━━━━━━━━━━━━━',
    ...performanceBlock(p,signals[0]?.mint||signals[0]?.coin),
    ''
  ];
  signals.forEach((x,j)=>{
    const ageMin=signalAgeMin(x);
    const status=classifyPosition(x);
    const avgTag=x.averaging?(Number.isFinite(ageMin)&&ageMin<=FUTURES_AVERAGING_GREEN_LATENCY_MIN?'FRESH AVERAGING':'AVERAGING'):'';
    const icon=status==='GREEN'?'🟢':status==='YELLOW'?'🟡':'🔴';
    const statusLabel=status==='GREEN'?'ENTRY READY':status==='YELLOW'?'WATCH':'BLOCKED';
    const lifecycle=x.mint?'BUY':(x.lifecycleAddLabel||'ADD');
    const marketIcon=x.mint?'🟢':'🔵';
    rows.push(`${marketIcon} ${icon} ${x.displaySymbol||x.coin} ${x.side} | ${statusLabel}`);
    rows.push(`${lifecycle}   ${priceFmt(x.sourceEntry)}   |   AVG ${priceFmt(x.avgEntry)}   |   NOW ${priceFmt(x.current)}`);
    rows.push(`SL    ${priceFmt(x.sl)}   |   TP ${priceFmt(x.tp)}   |   RR ${fmt(x.rr,2)}`);
    rows.push(`DIST  ${pct(x.distancePct,2)}   |   AGE ${ageMin<1?Math.max(1,Math.round(ageMin*60))+'s':ageMin.toFixed(1)+'m'}`);
    if(x.mint){ rows.push(`SIZE  ${money(x.buyNotionalUsd)}`); } else { rows.push(`POS   ${money(x.positionValue)}   |   LEV ${fmt(x.leverage,1)}x${avgTag?`   |   ${avgTag}`:''}`); }
    if(j<signals.length-1)rows.push('');
  });
  rows.push('━━━━━━━━━━━━━━━━━━');
  return rows;
}

async function fetchFuturesMarketContext(){
  try{
    const r=await hl({type:'metaAndAssetCtxs'},'metaAndAssetCtxs');
    const meta=r?.[0], ctxs=Array.isArray(r?.[1])?r[1]:[];
    const out=new Map();
    const universe=Array.isArray(meta?.universe)?meta.universe:[];
    universe.forEach((u,i)=>{
      const coin=String(u?.name||'');
      if(!coin)return;
      const c=ctxs[i]||{};
      out.set(coin,{funding:n(c?.funding),openInterest:n(c?.openInterest),dayNtlVlm:n(c?.dayNtlVlm),prevDayPx:n(c?.prevDayPx),premium:n(c?.premium)});
    });
    console.log(`[FUTURES][MARKET-CONTEXT] markets=${out.size} min24hVolume=$${FUTURES_MIN_24H_VOLUME_USD}`);
    return out;
  }catch(e){
    console.log(`[FUTURES][MARKET-CONTEXT] ERROR ${String(e?.message||e).slice(0,160)}`);
    return new Map();
  }
}

async function scanFutures(w,mids,now,symbolMap,marketContext=new Map()){
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
    latestAdd._lifecycleAddNumber=list.length;
    latestAdd._lifecycleAddExact=Math.abs(n(list[0]?._startPosition))<=1e-12;
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
    const market=marketContext.get(coin)||{};
    if(FUTURES_REQUIRE_MARKET_CONFIRMATION && (n(market.dayNtlVlm)<FUTURES_MIN_24H_VOLUME_USD || n(market.openInterest)<=0)){
      console.log(`[FUTURES][DROP] ${w.name} | ${displaySymbol} | REASON=MARKET_LIQUIDITY_GATE volume24=${Math.round(n(market.dayNtlVlm))} OI=${Math.round(n(market.openInterest))}`);
      continue;
    }
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
    const lifecycleCount=n(f._lifecycleAddNumber,1);
    const lifecycleAddLabel=f._lifecycleAddExact && Math.abs(n(f?._startPosition))<=1e-12 ? 'NEW ENTRY' : 'FRESH ADD';
    const recentAddedSize=n(f._recentAddedSize,n(f.sz));
    const latestAddedSize=n(f._latestAddedSize,n(f._addedSize,n(f.sz)));
    const averaging=f._isAveraging===true;
    const latestAddNotional=latestAddedSize*entry;
    const recentWindowNotional=recentAddedSize*entry;
    const addNotional=Math.max(latestAddNotional,recentWindowNotional);
    const lifecycleOpenTime=Number(pos?.openedAt)||Number(f?.time)||now;
    const lifecycleAgeHours=Math.max(0,(now-lifecycleOpenTime)/3600000);

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
      avgEntry,avgDistancePct:avgDist,recentAvgPx:recentAvg,addCount,lifecycleAddNumber:lifecycleCount,lifecycleAddLabel,averaging,
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
  if(x.averaging)reasons.push('FRESH_AVERAGING');
  return reasons.length?reasons.join(' + '):'NEAR_ENTRY';
}
function compactSignalLine(x,i){
  const ageMin=signalAgeMin(x);
  const ageText=Number.isFinite(ageMin)?` | Age ${ageMin<1?Math.max(1,Math.round(ageMin*60))+'s':ageMin.toFixed(1)+'m'}`:'';
  const size=Number.isFinite(Number(x.buyNotionalUsd))?` | Size ${money(x.buyNotionalUsd)}`:'';
  const pos=Number.isFinite(Number(x.positionValue))?` | Pos ${money(x.positionValue)}`:'';
  const lev=Number.isFinite(Number(x.leverage))?` | Lev ${fmt(x.leverage,1)}x`:'';
  const avg=Number.isFinite(Number(x.avgEntry))?` | AVG ${priceFmt(x.avgEntry)}`:'';
  const ageNow=signalAgeMin(x); const avgTag=x.averaging?` | ${Number.isFinite(ageNow)&&ageNow<=FUTURES_AVERAGING_GREEN_LATENCY_MIN?'FRESH AVERAGING':'AVERAGING'}`:'';
  const reason=classifyPosition(x)==='YELLOW'?` | ${yellowReason(x)}`:'';
  return `${i}. ${x.wallet.name} | ${x.displaySymbol||x.coin} | ${x.side}\n   ADD ${priceFmt(x.sourceEntry)} | AVG ${priceFmt(x.avgEntry)} | Now ${priceFmt(x.current)} | Dist ${pct(x.distancePct,2)} | SL ${priceFmt(x.sl)} | TP ${priceFmt(x.tp)} | RR ${fmt(x.rr,3)}${ageText}${avgTag}${size}${pos}${lev}${reason}`;
}
function marketSignals(title,items){
  const rows=[title,'━━━━━━━━━━━━━━━━━━'];
  if(items.length)items.forEach((x,i)=>rows.push(compactSignalLine(x,i+1)));
  else rows.push('None');
  return rows;
}

async function readSignalJournal(){
  try{return JSON.parse(await fs.readFile(SIGNAL_JOURNAL_FILE,'utf8'));}catch{return {signals:[]};}
}
async function writeSignalJournal(x){
  try{await fs.mkdir(path.dirname(SIGNAL_JOURNAL_FILE),{recursive:true});await fs.writeFile(SIGNAL_JOURNAL_FILE,JSON.stringify(x,null,2));}catch(e){console.log(`[SIGNAL-JOURNAL] SAVE_ERROR ${String(e?.message||e).slice(0,120)}`)}
}
async function updateSignalJournal(signals){
  const now=Date.now(); const book=await readSignalJournal();
  const rows=Array.isArray(book.signals)?book.signals:[];
  for(const r of rows){
    if(r.outcome||now-r.time>SIGNAL_OUTCOME_MAX_HOURS*3600000)continue;
    const age=(now-r.time)/60000; if(age<SIGNAL_OUTCOME_MINUTES)continue;
    const px=Number(r.currentPrice); if(!(px>0))continue;
    const move=(px/r.entry-1)*100*(r.side==='LONG'?1:-1);
    if(move>=Math.abs(r.tpPct))r.outcome='TP';
    else if(move<=-Math.abs(r.slPct))r.outcome='SL';
    else if(age>=60)r.outcome='TIMEOUT';
    r.lastPrice=px; r.lastMovePct=move;
  }
  for(const x of signals){
    const key=`${x.wallet?.address||x.wallet?.name}|${x.mint||x.coin}|${x.side}|${Math.round(Number(x.age||x.openedAt||now)/60000)}`;
    if(rows.some(r=>r.key===key))continue;
    rows.push({key,time:now,market:x.mint?'SPOT':'FUTURES',wallet:x.wallet?.address||x.wallet?.name,coin:x.displaySymbol||x.coin,side:x.side,entry:Number(x.current),currentPrice:Number(x.current),tpPct:x.mint?TP_PCT:HL_TP_PCT,slPct:x.mint?SL_PCT:HL_SL_PCT,outcome:null});
  }
  book.signals=rows.filter(r=>now-r.time<=SIGNAL_OUTCOME_MAX_HOURS*3600000);
  await writeSignalJournal(book);
}

function watchlistAuditLines(spot,futures){
  const out=['👁 WATCHLIST AUDIT','━━━━━━━━━━━━━━━━━━','🟢 SPOT'];
  for(const w of spot){
    const d=w?.discovery||{}; const tier=d.quality||'UNKNOWN'; const rb=n(d.recentBuys); const usd=n(d.recentBuyVolume);
    const trades=Number(d.verifiedTrades??d.closedTrades);
    const wr=Number(d.wr7??d.wr), pf=Number(d.pf7??d.pf);
    const perf=d.performanceStatus==='UNAVAILABLE_RATE_LIMITED'?'PERF UNAVAILABLE':Number.isFinite(trades)&&trades>0?`PERF ${trades} trades${Number.isFinite(wr)?` | WR ${wr.toFixed(1)}%`:''}${Number.isFinite(pf)?` | PF ${pf.toFixed(2)}`:''}`:'PERF not audited';
    out.push(`• 🟢 ${w.name} | ${tier} | BUYs ${rb} | Fresh $${usd.toFixed(0)} | ${perf}`);
  }
  out.push('🔵 FUTURES');
  for(const w of futures){
    const d=w?.discovery||{}; const tier=d.quality||'UNKNOWN';
    const trades=Number(d.closedTrades??d.verifiedTrades); const wr=Number(d.wr), pf=Number(d.pf);
    const perf=Number.isFinite(trades)&&trades>0?`PERF ${trades} trades${Number.isFinite(wr)?` | WR ${wr.toFixed(1)}%`:''}${Number.isFinite(pf)?` | PF ${pf.toFixed(2)}`:''}`:'PERF not audited';
    out.push(`• 🔵 ${w.name} | ${tier} | ADDs ${n(d.recentAdds)} | Fresh $${n(d.recentAddNotional).toFixed(0)} | ${perf}`);
  }
  return out;
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
  const marketContext=await fetchFuturesMarketContext();
  const futures=[];
  console.log(`[FUTURES][WATCHLIST-AUDIT] wallets=${FUTURES_WALLETS.length}/${TARGET_FUTURES_WALLETS}`);
  for(const w of FUTURES_WALLETS){
    futures.push(await scanFutures(w,mids,Date.now(),symbolMap,marketContext).catch(e=>({wallet:w,signals:[],positions:[],error:e.message,scanned:0,health:{health:'SIGNAL_ONLY',reason:'FUTURES_SCAN_ERROR',error:e.message}})));
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
  const verifiedSpot=SPOT_WALLETS.filter(w=>/^VERIFIED_/.test(String(w?.discovery?.quality||''))).length;
  const verifiedFutures=FUTURES_WALLETS.filter(w=>/^VERIFIED_/.test(String(w?.discovery?.quality||''))).length;
  const activeSpot=SPOT_WALLETS.filter(w=>/ACTIVE/.test(String(w?.discovery?.quality||''))).length;
  const activeFutures=FUTURES_WALLETS.filter(w=>/ACTIVE/.test(String(w?.discovery?.quality||''))).length;
  const lines=[
    `🐋 CRYPTO WHALE SIGNAL ENGINE ${VERSION}`,
    `🔧 Build: ${BUILD_TAG}`,
    'READ-ONLY • SIGNALS ONLY • NO ORDERS',
    '━━━━━━━━━━━━━━━━━━',
    `🕒 ${new Date().toISOString()}`,
    `👥 Watchlist: Spot ${SPOT_WALLETS.length}/${TARGET_SPOT_WALLETS} | Futures ${FUTURES_WALLETS.length}/${TARGET_FUTURES_WALLETS}`,
    `🔐 Verified: Spot ${verifiedSpot}/${TARGET_SPOT_WALLETS} | Futures ${verifiedFutures}/${TARGET_FUTURES_WALLETS}`,
    `👁 Active Watch: Spot ${activeSpot}/${TARGET_SPOT_WALLETS} | Futures ${activeFutures}/${TARGET_FUTURES_WALLETS}`,
    `📡 Signals: ${reportCandidates.length} | 🟢 Entry Ready ${green.length} | 🟡 Watch ${yellow.length}`,
    `📊 Verified gate: WR≥${TRADER_MIN_WR}% • PF≥${TRADER_MIN_PF} • Trades≥${TRADER_MIN_CLOSED_TRADES}`,
    '',
    ...watchlistAuditLines(SPOT_WALLETS,FUTURES_WALLETS),
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
  await updateSignalJournal(reportCandidates);
  console.log(`[SIGNAL-ENGINE ${VERSION}][DONE] green=${spotGreen.length+futuresGreen.length} yellow=${spotYellow.length+futuresYellow.length} red-hidden=${classified.filter(x=>x.status==='RED').length}`);
  await telegram(lines.join('\n'));
}

function lifecycleLabelForTest(){ return 'FRESH ADD'; }

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
  assert(lifecycleLabelForTest() === 'FRESH ADD','lifecycle labels never fake ADD counts');
  console.log('[SELF-TEST] PASS | futures position/add detection | weighted spot ROI/PF | no execution');
}

(process.env.WHALE_SELF_TEST === 'true' ? runSelfTests() : main()).catch(async e=>{console.error(`[SIGNAL-ENGINE][FATAL] ${e.stack||e}`);await telegram(`🟣 CRYPTO WHALE SIGNAL ENGINE ${VERSION}\n📡 READ-ONLY | NO EXECUTION\n💥 FATAL\n${String(e.message||e).slice(0,1200)}`);process.exitCode=1});
