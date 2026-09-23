// Hyperliquid Meme Specialist Scout V5.34 - READ ONLY
// Professional ranking: statistical quality + current-position copyability.
// NO ORDERS. NO PRIVATE KEYS.

const API_URL = process.env.HYPERLIQUID_API_URL || 'https://api.hyperliquid.xyz/info';
const DISCOVERY_URL = process.env.HYPERLIQUID_HUNTER_DISCOVERY_URL || 'https://stats-data.hyperliquid.xyz/Mainnet/leaderboard';
const DISCOVERY_ENABLED = String(process.env.HYPERLIQUID_HUNTER_DISCOVERY_ENABLED ?? 'true').toLowerCase() === 'true';

const LOOKBACK_DAYS = num('HYPERLIQUID_HUNTER_LOOKBACK_DAYS', 7);
const MAX_CANDIDATES = integer('HYPERLIQUID_HUNTER_MAX_CANDIDATES', 2000);
const POSITION_DISCOVERY_TARGET = integer('HYPERLIQUID_HUNTER_POSITION_DISCOVERY_TARGET', 1000);
const POSITION_PROBE_MAX = integer('HYPERLIQUID_HUNTER_POSITION_PROBE_MAX', 2000);
const POSITION_COHORT_SIZE = integer('HYPERLIQUID_HUNTER_POSITION_COHORT_SIZE', 250);
const POSITION_PROBE_CONCURRENCY = integer('HYPERLIQUID_HUNTER_POSITION_PROBE_CONCURRENCY', 8);
const POSITION_PROBE_BATCH = integer('HYPERLIQUID_HUNTER_POSITION_PROBE_BATCH', 250);
const POSITION_NEAR_TARGET = integer('HYPERLIQUID_HUNTER_POSITION_NEAR_TARGET', 10);
const HISTORY_VERIFY_TARGET = integer('HYPERLIQUID_HUNTER_HISTORY_VERIFY_TARGET', 60);
const HISTORY_VERIFY_EXPAND = integer('HYPERLIQUID_HUNTER_HISTORY_VERIFY_EXPAND', 30);
const PREFILTER_SIZE = integer('HYPERLIQUID_HUNTER_PREFILTER_SIZE', 500);
const STAT_SCAN_TARGET = integer('HYPERLIQUID_HUNTER_STAT_SCAN_TARGET', 120);
const MIN_COPY5 = integer('HYPERLIQUID_HUNTER_MIN_COPY5', 5);
const ENRICH_POOL_SIZE = integer('HYPERLIQUID_HUNTER_ENRICH_POOL_SIZE', 40);
const POSITION_CONCURRENCY = integer('HYPERLIQUID_HUNTER_POSITION_CONCURRENCY', 3);
const STAT_POOL_SIZE = integer('HYPERLIQUID_HUNTER_STAT_POOL_SIZE', 20);
const FINALISTS = integer('HYPERLIQUID_HUNTER_FINALISTS', 5);
const AUTO_SELECT = integer('HYPERLIQUID_HUNTER_AUTO_SELECT', 1);

// Legacy thresholds are SOFT signals in V5.13, not hard rejection gates.
const MIN_TRADES = integer('HYPERLIQUID_HUNTER_MIN_7D_TRADES', 30);
const MIN_WR = num('HYPERLIQUID_HUNTER_MIN_7D_WIN_RATE', 65);
const MIN_PNL = num('HYPERLIQUID_HUNTER_MIN_7D_PNL', 0);
const MIN_PF = num('HYPERLIQUID_HUNTER_MIN_PROFIT_FACTOR', 1.5);
const MAX_MEDIAN_HOLD = num('HYPERLIQUID_HUNTER_MAX_MEDIAN_HOLD_HOURS', 6);
const MAX_AVG_HOLD = num('HYPERLIQUID_HUNTER_MAX_AVG_HOLD_HOURS', 12);
const MIN_ACTIVE_DAYS = integer('HYPERLIQUID_HUNTER_MIN_ACTIVE_DAYS', 4);
const MAX_LOSING_STREAK = integer('HYPERLIQUID_HUNTER_MAX_LOSING_STREAK', 8);
const MAX_LIQ = integer('HYPERLIQUID_HUNTER_MAX_LIQUIDATIONS', 1);
const MAX_COPY_LIFECYCLE_ERRORS = integer('HYPERLIQUID_HUNTER_MAX_COPY_LIFECYCLE_ERRORS', 0);
const MIN_COPY_CLOSED_TRADES = integer('HYPERLIQUID_HUNTER_MIN_COPY_CLOSED_TRADES', 12);
const MIN_COPY_ACTIVE_DAYS = integer('HYPERLIQUID_HUNTER_MIN_COPY_ACTIVE_DAYS', 2);

const MIN_RR = num('HYPERLIQUID_HUNTER_MIN_SETUP_RR', 1.5);
const MAX_ENTRY_DIST = num('HYPERLIQUID_HUNTER_MAX_ENTRY_DISTANCE_PCT', 0.5);
const SL_ATR = num('HYPERLIQUID_HUNTER_SL_ATR_MULT', 1.2);
const TP_ATR = num('HYPERLIQUID_HUNTER_TP_ATR_MULT', 2.0);
const MAX_HOLD = num('HYPERLIQUID_HUNTER_MAX_PLANNED_HOLD_HOURS', 12);

const RETRIES = integer('HYPERLIQUID_HUNTER_API_RETRIES', 4);
const BASE_DELAY = integer('HYPERLIQUID_HUNTER_API_BASE_DELAY_MS', 700);
const BETWEEN = integer('HYPERLIQUID_HUNTER_BETWEEN_TRADERS_MS', 250);
const POSITION_BETWEEN = integer('HYPERLIQUID_HUNTER_POSITION_BETWEEN_MS', 180);
const MAX_PAGES = integer('HYPERLIQUID_HUNTER_MAX_FILL_PAGES', 8);
const TIMEOUT = integer('HYPERLIQUID_HUNTER_REQUEST_TIMEOUT_MS', 30000);

const TG_TOKEN = process.env.TELEGRAM_TOKEN || '';
const TG_CHAT = process.env.TELEGRAM_CHAT_ID || '';
const SEEDS = csv('HYPERLIQUID_TRADERS');
const MANUAL = csv('HYPERLIQUID_HUNTER_CANDIDATES');
const TG_LIMIT = 3800;

// V5.22.1 reliability: shared cooldown prevents a burst of 429s from
// immediately cascading across the remaining 500-wallet scout.
let RATE_LIMIT_COOLDOWN_UNTIL = 0;
const RATE_LIMIT_COOLDOWN_MS = integer('HYPERLIQUID_MEME_429_COOLDOWN_MS', 10000);
const API_MIN_INTERVAL_MS = integer('HYPERLIQUID_MEME_API_MIN_INTERVAL_MS', 950);
let API_NEXT_ALLOWED_AT = 0;

// V5.22 MEME SPECIALIST SCOUT
const MEME_MODE = String(process.env.HYPERLIQUID_MEME_MODE ?? 'scout').toLowerCase(); // scout | watch
const MEME_WATCHLIST = csv('HYPERLIQUID_MEME_WATCHLIST').filter(addr).map(norm);
const MEME_TOP_N = integer('HYPERLIQUID_MEME_TOP_N', 5);
const MEME_MIN_TRADES = integer('HYPERLIQUID_MEME_MIN_TRADES', 12);
const MEME_MIN_EXPOSURE = num('HYPERLIQUID_MEME_MIN_EXPOSURE_PCT', 65);
const MEME_MIN_UNIQUE = integer('HYPERLIQUID_MEME_MIN_UNIQUE_COINS', 3);
const MEME_HEAVY_MIN_EXPOSURE = num('HYPERLIQUID_MEME_HEAVY_MIN_EXPOSURE_PCT', 20);
const MEME_HEAVY_MIN_TRADES = integer('HYPERLIQUID_MEME_HEAVY_MIN_TRADES', MEME_MIN_TRADES);
const MEME_HEAVY_MIN_UNIQUE = integer('HYPERLIQUID_MEME_HEAVY_MIN_UNIQUE_COINS', MEME_MIN_UNIQUE);
const MEME_SINGLE_MIN_EXPOSURE = num('HYPERLIQUID_MEME_SINGLE_MIN_EXPOSURE_PCT', 20);
const MEME_SINGLE_MIN_TRADES = integer('HYPERLIQUID_MEME_SINGLE_MIN_TRADES', MEME_MIN_TRADES);

// V5.31: strict specialist eligibility is preserved. A separate Focus tier
// prevents an all-or-nothing 65%/3-coin gate from producing an empty research
// output when the market contains strong but narrower meme specialists.
const MEME_FOCUS_MIN_EXPOSURE = num('HYPERLIQUID_MEME_FOCUS_MIN_EXPOSURE_PCT', 10);
const MEME_FOCUS_MIN_TRADES = integer('HYPERLIQUID_MEME_FOCUS_MIN_TRADES', 100);
const MEME_FOCUS_MIN_UNIQUE = integer('HYPERLIQUID_MEME_FOCUS_MIN_UNIQUE_COINS', 3);
const MEME_FOCUS_MAX_DOMINANT = num('HYPERLIQUID_MEME_FOCUS_MAX_DOMINANT_PCT', 85);
const MEME_RESEARCH_MIN_EXPOSURE = num('HYPERLIQUID_MEME_RESEARCH_MIN_EXPOSURE_PCT', 15);
const MEME_RESEARCH_MIN_TRADES = integer('HYPERLIQUID_MEME_RESEARCH_MIN_TRADES', 100);
const MEME_RESEARCH_MIN_UNIQUE = integer('HYPERLIQUID_MEME_RESEARCH_MIN_UNIQUE_COINS', 3);
const MEME_RESEARCH_TOP_N = integer('HYPERLIQUID_MEME_RESEARCH_TOP_N', 5);
const MEME_FOCUS_TOP_N = integer('HYPERLIQUID_MEME_FOCUS_TOP_N', 5);
const MEME_TRADE_SAMPLE = integer('HYPERLIQUID_MEME_TRADE_SAMPLE', 12);
const MEME_COINS_PER_TRADER = integer('HYPERLIQUID_MEME_COINS_PER_TRADER', 6);
const MEME_CANDLE_INTERVAL = process.env.HYPERLIQUID_MEME_CANDLE_INTERVAL || '15m';
const MEME_FORWARD_MIN = integer('HYPERLIQUID_MEME_FORWARD_MINUTES', 60);
const MEME_EARLY_THRESHOLD_5 = num('HYPERLIQUID_MEME_EARLY_5_PCT', 5);
const MEME_EARLY_THRESHOLD_10 = num('HYPERLIQUID_MEME_EARLY_10_PCT', 10);
const MEME_EARLY_THRESHOLD_20 = num('HYPERLIQUID_MEME_EARLY_20_PCT', 20);
const MEME_SCOUT_CANDIDATES = integer('HYPERLIQUID_MEME_SCOUT_CANDIDATES', 500);
const MEME_PREFILTER_TARGET = integer('HYPERLIQUID_MEME_PREFILTER_TARGET', 30);
const MEME_PREFILTER_FILL_SAMPLE = integer('HYPERLIQUID_MEME_PREFILTER_FILL_SAMPLE', 250);
const MEME_PREFILTER_RETRIES = integer('HYPERLIQUID_MEME_PREFILTER_RETRIES', 1);
const MEME_PREFILTER_BETWEEN_MS = integer('HYPERLIQUID_MEME_PREFILTER_BETWEEN_MS', 950);
const MEME_PREFILTER_SCAN_PER_CYCLE = integer('HYPERLIQUID_MEME_PREFILTER_SCAN_PER_CYCLE', 180);
const MEME_COVERAGE_SLOTS = integer('HYPERLIQUID_MEME_COVERAGE_SLOTS', 3);
const MEME_FULL_RETRIES = integer('HYPERLIQUID_MEME_FULL_RETRIES', 3);
const MEME_REQUIRE_COMPLETE_HISTORY = String(process.env.HYPERLIQUID_MEME_REQUIRE_COMPLETE_HISTORY ?? 'true').toLowerCase() !== 'false';
const MEME_FULL_BETWEEN_MS = integer('HYPERLIQUID_MEME_FULL_BETWEEN_MS', 300);
const MEME_HISTORY_DAYS = integer('HYPERLIQUID_MEME_HISTORY_DAYS', 7);
const MEME_CANDLE_CACHE = new Map();

// Maintainable seed list. Users can extend it without changing code via
// HYPERLIQUID_MEME_SYMBOLS=ABC,DEF,... . This is a trading-asset classifier,
// not a claim that any trader has advance information.
const BUILTIN_MEME_SYMBOLS = new Set([
  'DOGE','SHIB','PEPE','BONK','WIF','FLOKI','BRETT','MOG','MEW','POPCAT','PNUT',
  'GOAT','MOODENG','SPX','TURBO','BOME','DEGEN','TOSHI','NEIRO','NEIROETH','MEME',
  'MYRO','SLERF','PONKE','MOTHER','MOG','FWOG','GIGA','MUMU','ACT','APU','BOB','ANDY',
  'PENGU','CHILLGUY','TRUMP','MELANIA','FARTCOIN','PURR','CAT','CATDOG','MICHI','MANEKI',
  'BRETT','LADYS','WOJAK','SAMO','BABYDOGE','BABYSHIB','KISHU','ELON','DEGEN','HIGHER',
  'PORK','SUNDOG','GOONC','WEN','TOSHI','HAMMY','LOCKIN','MOGGER',
  'KPEPE'
]);
const MEME_SYMBOLS = new Set([...BUILTIN_MEME_SYMBOLS,...csv('HYPERLIQUID_MEME_SYMBOLS').map(x=>x.toUpperCase())]);

// V5.28 classifier: canonicalize market wrappers before classification. This
// fixes cases such as PURR/USDC being treated as a different unknown asset.
function normalizeMemeSymbol(coin){
  let c=String(coin||'').trim().toUpperCase();
  if(!c)return '';
  c=c.replace(/\s+/g,'');
  // Spot/fill quote wrappers are safe to remove for common quote assets.
  c=c.replace(/(?:\/|-|:)USDC$/,'');
  c=c.replace(/(?:\/|-|:)USDT$/,'');
  // Some Hyperliquid market feeds use an XYZ:BASE namespace. Keep the namespace
  // for explicit non-meme HIP-3 classification, but normalize quote suffixes.
  if(c==='XYZ:PURR') c='PURR';
  if(c==='KPEPE')return 'KPEPE';
  return c;
}

// Explicit exclusions prevent common protocol/DeFi/equity assets from being
// promoted to meme status merely because their tickers look meme-like.
const NON_MEME_CLASSIFICATIONS = new Map([
  ['BTC','MAJOR_ASSET: Bitcoin'],
  ['ETH','MAJOR_ASSET: Ethereum'],
  ['SOL','MAJOR_ASSET: Solana'],
  ['XMR','MAJOR_ASSET: Monero'],
  ['ZEC','MAJOR_ASSET: Zcash'],
  ['HYPE','PROTOCOL_TOKEN: Hyperliquid native asset'],
  ['ETHFI','DEFI_TOKEN: Ether.fi governance token'],
  ['ZRO','PROTOCOL_TOKEN: LayerZero token'],
  ['MINA','L1_TOKEN: Mina Protocol native asset'],
  ['MON','L1_TOKEN: Monad native asset'],
  ['CHIP','RWA_TOKEN: USD.AI governance token'],
  ['LIT','PROTOCOL_TOKEN: Lighter ecosystem token'],
  ['VVV','AI_TOKEN: Venice AI token'],
  ['AERO','DEFI_TOKEN: Aerodrome governance token'],
  ['CL','COMMODITY: Crude oil HIP-3 market'],
  ['BRENTOIL','COMMODITY: Brent crude oil HIP-3 market'],
  ['GOLD','COMMODITY: Gold HIP-3 market'],
  ['SILVER','COMMODITY: Silver HIP-3 market'],
  ['XYZ:CL','COMMODITY: Crude oil HIP-3 market'],
  ['XYZ:BRENTOIL','COMMODITY: Brent crude oil HIP-3 market'],
  ['XYZ:GOLD','COMMODITY: Gold HIP-3 market'],
  ['XYZ:SILVER','COMMODITY: Silver HIP-3 market'],
  ['PURRDAT','EQUITY: Hyperliquid Strategies HIP-3 equity perpetual'],
  ['XYZ:PURRDAT','EQUITY: Hyperliquid Strategies HIP-3 equity perpetual'],
  // V5.34 classifier-coverage expansion: these high-volume symbols were
  // previously UNKNOWN, but their asset class is not meme. Keeping them
  // explicitly non-meme improves audit coverage without increasing meme exposure.
  ['FIL','L1_TOKEN: Filecoin'],
  ['NEAR','L1_TOKEN: NEAR Protocol'],
  ['XRP','MAJOR_ASSET: XRP Ledger asset'],
  ['UNI','DEFI_TOKEN: Uniswap governance token'],
  ['XYZ:ZHIPU','EQUITY: Zhipu AI HIP-3 market']
]);
const PROBABLE_MEME_SYMBOLS = new Set(csv('HYPERLIQUID_MEME_PROBABLE_SYMBOLS').map(normalizeMemeSymbol));

function memeClassification(coin){
  const c=normalizeMemeSymbol(coin);
  if(!c)return {class:'UNKNOWN',canonical:c,reason:'EMPTY_SYMBOL'};
  if(MEME_SYMBOLS.has(c))return {class:'CONFIRMED',canonical:c,reason:'CURATED_MEME_SET'};
  if(PROBABLE_MEME_SYMBOLS.has(c))return {class:'PROBABLE',canonical:c,reason:'MANUAL_PROBABLE_LIST'};
  if(NON_MEME_CLASSIFICATIONS.has(c))return {class:'NON_MEME',canonical:c,reason:NON_MEME_CLASSIFICATIONS.get(c)};
  if(String(process.env.HYPERLIQUID_MEME_HEURISTIC||'false').toLowerCase()==='true' && /DOGE|SHIB|PEPE|BONK|WIF|FLOKI|BRETT|MOG|POPCAT|PNUT|GOAT|TURBO|BOME|MEME|PONKE|SLERF|WOJAK|FART|CAT|INU|MOON/.test(c))return {class:'PROBABLE',canonical:c,reason:'HEURISTIC_MATCH'};
  return {class:'UNKNOWN',canonical:c,reason:'NO_VERIFIED_CLASSIFICATION'};
}
function isMemeCoin(coin){return memeClassification(coin).class==='CONFIRMED'}

// V5.28 classifier audit is canonical-symbol based and never loosens
// specialist eligibility. Probable/unknown assets remain non-meme for gates.
function memeClassifierAudit(trades){
  const observed=new Map();
  for(const t of (Array.isArray(trades)?trades:[])){
    const c=normalizeMemeSymbol(t?.coin);
    if(!c)continue;
    observed.set(c,(observed.get(c)||0)+1);
  }
  const observedSymbols=[...observed.keys()].sort();
  const classified=observedSymbols.filter(c=>memeClassification(c).class==='CONFIRMED');
  const probable=observedSymbols.filter(c=>memeClassification(c).class==='PROBABLE');
  const excluded=observedSymbols.filter(c=>memeClassification(c).class==='NON_MEME');
  const unclassified=observedSymbols.filter(c=>memeClassification(c).class==='UNKNOWN');
  const make=(arr)=>arr.map(c=>({coin:c,trades:observed.get(c)||0,class:memeClassification(c).class,reason:memeClassification(c).reason})).sort((a,b)=>b.trades-a.trades||a.coin.localeCompare(b.coin));
  return {
    knownMemeSymbols:MEME_SYMBOLS.size,
    observedSymbols:observedSymbols.length,
    classifiedSymbols:classified.length,
    probableSymbols:probable.length,
    nonMemeSymbols:excluded.length,
    unclassifiedSymbols:unclassified.length,
    classifiedTradeCount:classified.reduce((n,c)=>n+(observed.get(c)||0),0),
    probableTradeCount:probable.reduce((n,c)=>n+(observed.get(c)||0),0),
    nonMemeTradeCount:excluded.reduce((n,c)=>n+(observed.get(c)||0),0),
    unclassifiedTradeCount:unclassified.reduce((n,c)=>n+(observed.get(c)||0),0),
    topUnclassified:make(unclassified).slice(0,10),
    topProbable:make(probable).slice(0,10),
    topClassified:make(classified).slice(0,10),
    topNonMeme:make(excluded).slice(0,10)
  };
}


function num(k,d){const x=Number(process.env[k]);return Number.isFinite(x)?x:d}
function integer(k,d){const x=parseInt(process.env[k]||'',10);return Number.isFinite(x)?x:d}
function csv(k){return String(process.env[k]||'').split(',').map(x=>x.trim()).filter(Boolean)}
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
function addr(x){return /^0x[a-fA-F0-9]{40}$/.test(String(x||''))}
function norm(x){return String(x).toLowerCase()}
function short(x){const s=String(x||'');return s.length>14?`${s.slice(0,8)}…${s.slice(-6)}`:s}
function fmt(x,d=2){return Number.isFinite(Number(x))?Number(x).toFixed(d):'n/a'}
function pct(x,d=1){return Number.isFinite(Number(x))?`${Number(x).toFixed(d)}%`:'n/a'}
function median(a){if(!a.length)return NaN;const s=[...a].sort((a,b)=>a-b),m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2}
function quantile(a,q){if(!a.length)return NaN;const s=[...a].sort((a,b)=>a-b),p=(s.length-1)*q,l=Math.floor(p),h=Math.ceil(p);return l===h?s[l]:s[l]+(s[h]-s[l])*(p-l)}

function category(e){
  const s=String(e?.message||e||'');
  if(/HTTP 429/i.test(s))return'HTTP_429';
  if(/HTTP 5\d\d/i.test(s))return'HTTP_5XX';
  if(/timeout/i.test(s))return'TIMEOUT';
  if(/fetch|network|ECONN|socket|ENOTFOUND/i.test(s))return'NETWORK';
  if(/JSON/i.test(s))return'BAD_JSON';
  if(/fills/i.test(s))return'FILLS';
  return'OTHER'
}

async function fetchJson(url, options={}, label='request', maxRetries=RETRIES){
  let last;
  for(let attempt=0;attempt<=Math.max(0,maxRetries);attempt++){
    const gate=Math.max(API_NEXT_ALLOWED_AT,RATE_LIMIT_COOLDOWN_UNTIL);
    if(gate>Date.now()) await sleep(gate-Date.now());
    API_NEXT_ALLOWED_AT=Date.now()+API_MIN_INTERVAL_MS;
    const c=new AbortController(),t=setTimeout(()=>c.abort(),TIMEOUT);
    try{
      const r=await fetch(url,{...options,signal:c.signal});
      clearTimeout(t);
      if(r.ok){
        const text=await r.text();
        try{return JSON.parse(text)}catch{throw new Error(`${label}: invalid JSON`)}
      }
      const body=(await r.text()).slice(0,240);
      const e=new Error(`${label}: HTTP ${r.status} ${body}`);e.status=r.status;
      if(r.status===429) RATE_LIMIT_COOLDOWN_UNTIL=Math.max(RATE_LIMIT_COOLDOWN_UNTIL,Date.now()+RATE_LIMIT_COOLDOWN_MS);
      const ra=Number(r.headers.get('retry-after')||0); if(ra>0)e.retryAfterMs=ra*1000;
      throw e;
    }catch(e){
      clearTimeout(t);last=e?.name==='AbortError'?new Error(`${label}: timeout`):e;
      const s=Number(last?.status||0);
      const retryable=s===429 || (s>=500&&s<=599) || s===0;
      if(!retryable||attempt>=Math.max(0,maxRetries))break;
      const wait=Math.min(12000,Number(last?.retryAfterMs||0)||BASE_DELAY*Math.pow(2,attempt)+Math.floor(Math.random()*200));
      console.log(`[RETRY] ${label} ${attempt+1}/${Math.max(0,maxRetries)} wait=${wait}ms ${category(last)}`);await sleep(wait);
    }
  }
  throw last||new Error(`${label}: failed`)
}
async function info(payload,label=payload.type,maxRetries=RETRIES){return fetchJson(API_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)},label,maxRetries)}

function hunterPreScore(row){
  const wp=Array.isArray(row?.windowPerformances)?row.windowPerformances:[];
  const m=Object.fromEntries(wp.filter(Array.isArray).map(x=>[x[0],x[1]]));
  const w=m.week||m.day||{},p=Number(w.pnl||0),r=Number(w.roi||0),v=Number(w.vlm||0);
  return (v>0?1e9:0)+Math.max(0,p)*1e3+Math.max(0,r)*1e2+Math.log10(Math.max(1,v));
}
async function discover(){
  const map=new Map();
  for(const a of [...SEEDS,...MANUAL])if(addr(a))map.set(norm(a),{ethAddress:norm(a)});
  if(!DISCOVERY_ENABLED){
    const candidates=[...map.keys()].slice(0,Math.min(POSITION_PROBE_MAX,Math.max(POSITION_DISCOVERY_TARGET,1)));
    return{discovered:map.size,candidates,source:'manual_only'};
  }

  const data=await fetchJson(DISCOVERY_URL,{},'leaderboard discovery');
  const rows=Array.isArray(data?.leaderboardRows)?data.leaderboardRows:[];
  const valid=[];
  for(const row of rows){
    if(!addr(row?.ethAddress))continue;
    const a=norm(row.ethAddress);
    map.set(a,row);
    valid.push(a);
  }

  // IMPORTANT: current-position discovery is intentionally decoupled from
  // HYPERLIQUID_HUNTER_MAX_CANDIDATES / PREFILTER_SIZE. Those legacy limits
  // must never shrink the wallet pool used to find REAL open positions.
  const parsed=[...new Set(valid)].map(a=>map.get(a)).filter(Boolean);
  const metricValue=(row,window,field)=>{
    const wp=Array.isArray(row?.windowPerformances)?row.windowPerformances:[];
    const hit=wp.find(x=>Array.isArray(x)&&String(x[0]).toLowerCase()===window);
    const n=Number(hit?.[1]?.[field]);
    return Number.isFinite(n)?n:0;
  };
  const by=(fn)=>[...parsed].sort((a,b)=>{
    const d=fn(b)-fn(a);
    return d||hunterPreScore(b)-hunterPreScore(a);
  }).map(r=>norm(r.ethAddress));

  const byWeekPnl=by(r=>metricValue(r,'week','pnl'));
  const byDayPnl=by(r=>metricValue(r,'day','pnl'));
  const byWeekRoi=by(r=>metricValue(r,'week','roi'));
  const byDayRoi=by(r=>metricValue(r,'day','roi'));
  const byWeekVol=by(r=>metricValue(r,'week','vlm'));
  const byDayVol=by(r=>metricValue(r,'day','vlm'));
  const byBlended=[...parsed].sort((a,b)=>hunterPreScore(b)-hunterPreScore(a)).map(r=>norm(r.ethAddress));

  const target=Math.max(1,Math.min(POSITION_DISCOVERY_TARGET,POSITION_PROBE_MAX));
  const cap=Math.max(target,POSITION_PROBE_MAX);
  const out=new Set([...SEEDS,...MANUAL].filter(addr).map(norm));
  const add=(list,limit=POSITION_COHORT_SIZE)=>{
    let n=0;
    for(const a of list){
      if(out.size>=cap||n>=limit)break;
      if(!out.has(a)){out.add(a);n++;}
    }
  };

  // Stratified cohorts prevent one metric (for example volume) from crowding
  // out profitable/active traders in the current-position search.
  add(byWeekPnl);add(byDayPnl);add(byWeekRoi);add(byDayRoi);add(byWeekVol);add(byDayVol);
  add(byBlended,POSITION_COHORT_SIZE);

  // Fill to the actual probe target from the blended leaderboard, then allow
  // expansion up to POSITION_PROBE_MAX if the first 1000 do not yield enough
  // near-entry positions. This is the key V5.18 fix for the old 30-wallet cap.
  if(out.size<target)add(byBlended,Number.POSITIVE_INFINITY);
  if(out.size<target){
    for(const a of valid){
      if(out.size>=target)break;
      out.add(a);
    }
  }
  // Build an expansion pool up to POSITION_PROBE_MAX without ever consulting
  // MAX_CANDIDATES/PREFILTER_SIZE.
  if(out.size<cap){
    for(const a of byBlended){
      if(out.size>=cap)break;
      out.add(a);
    }
  }

  return{
    discovered:new Set(valid).size,
    candidates:[...out].slice(0,cap),
    source:'leaderboard:STRATIFIED_WEEK_PNL+DAY_PNL+WEEK_ROI+DAY_ROI+VOLUME+BLENDED'
  };
}
function fillKey(f){return [f?.tid??'',f?.hash??'',f?.time??'',f?.coin??'',f?.px??'',f?.sz??'',f?.side??''].join('|')}
function recentMemeProfile(fills){
  const rows=(Array.isArray(fills)?fills:[]).slice().sort((a,b)=>Number(b?.time||0)-Number(a?.time||0)).slice(0,MEME_PREFILTER_FILL_SAMPLE);
  const meme=rows.filter(f=>isMemeCoin(f?.coin));
  const unique=new Set(meme.map(f=>String(f?.coin||''))).size;
  const total=rows.length;
  const exposure=total?meme.length/total*100:0;
  const recency=meme.length?Math.max(0,100-Math.min(100,(Date.now()-Math.max(...meme.map(f=>Number(f?.time||0))))/86400000*25)):0;
  const countScore=Math.min(100,meme.length/Math.max(1,MEME_MIN_TRADES)*100);
  const breadth=Math.min(100,unique/Math.max(1,MEME_MIN_UNIQUE)*100);
  const score=Math.round(.50*exposure+.25*countScore+.15*breadth+.10*recency);
  return {memeTrades:meme.length,totalTrades:total,exposurePct:exposure,uniqueCoins:unique,score};
}
async function getRecentFills(user){
  const b=await info({type:'userFills',user,aggregateByTime:false},`recent fills ${short(user)}`,MEME_PREFILTER_RETRIES);
  if(!Array.isArray(b))throw new Error('recent fills: unexpected response');
  return b;
}
async function fastMemePrefilter(addresses){
  const rows=[]; let errors=0;
  for(let i=0;i<addresses.length;i++){
    const address=addresses[i];
    try{
      const fills=await getRecentFills(address);
      const p=recentMemeProfile(fills);
      rows.push({address,profile:p});
      if((i+1)%25===0||p.memeTrades>=MEME_MIN_TRADES){
        console.log(`[PREFILTER] ${i+1}/${addresses.length} ${short(address)} meme=${p.memeTrades}/${p.totalTrades} exposure=${fmt(p.exposurePct,1)} unique=${p.uniqueCoins} score=${p.score}`);
      }
    }catch(e){
      errors++;
      console.log(`[PREFILTER][SKIP] ${i+1}/${addresses.length} ${short(address)} ${category(e)}`);
    }
    if(i+1<addresses.length)await sleep(MEME_PREFILTER_BETWEEN_MS);
  }
  // Stratify selection so one noisy metric cannot monopolize the 30-wallet
  // full-history pool. A candidate can enter through recent meme exposure,
  // meme count, or meme breadth.
  const uniq=new Map(rows.map(x=>[x.address,x]));
  const sorted=[...uniq.values()];
  const byScore=[...sorted].sort((a,b)=>b.profile.score-a.profile.score);
  const byExposure=[...sorted].sort((a,b)=>b.profile.exposurePct-a.profile.exposurePct||b.profile.memeTrades-a.profile.memeTrades);
  const byCount=[...sorted].sort((a,b)=>b.profile.memeTrades-a.profile.memeTrades||b.profile.exposurePct-a.profile.exposurePct);
  const byBreadth=[...sorted].sort((a,b)=>b.profile.uniqueCoins-a.profile.uniqueCoins||b.profile.memeTrades-a.profile.memeTrades);
  const target=Math.max(5,Math.min(MEME_PREFILTER_TARGET,sorted.length));
  const out=[];
  const seen=new Set();
  const add=(list,n)=>{for(const x of list){if(out.length>=target)break;if(seen.has(x.address))continue;seen.add(x.address);out.push(x)}};
  add(byScore,Math.ceil(target*.50));
  add(byExposure,Math.ceil(target*.25));
  add(byCount,Math.ceil(target*.15));
  add(byBreadth,target);
  add(byScore,target);
  return {rows,selected:out.slice(0,target),errors};
}
async function getFills(user,start,end){
  let cursor=start,pages=0;const map=new Map();
  let incompleteReason=null,rateLimitAffected=false,networkAffected=false;
  while(pages<MAX_PAGES){
    pages++;
    try{
      const b=await info({type:'userFillsByTime',user,startTime:cursor,endTime:end,aggregateByTime:false},`fills ${short(user)} page=${pages}`,MEME_FULL_RETRIES);
      if(!Array.isArray(b))throw new Error('fills: unexpected response');
      for(const f of b){if(f?.time)map.set(fillKey(f),f)}
      if(b.length===0||b.length<2000)break;
      const max=Math.max(...b.map(f=>Number(f?.time||0)));
      if(!max||max>=end)break;
      const next=Math.max(cursor+1,max);if(next<=cursor)break;
      cursor=next;await sleep(150);
    }catch(e){
      const cat=category(e);
      if(cat==='HTTP_429'){rateLimitAffected=true;incompleteReason='HTTP_429';}
      else if(cat==='NETWORK'||cat==='TIMEOUT'||cat==='HTTP_5XX'){networkAffected=true;incompleteReason=cat;}
      else incompleteReason=cat;
      if(pages===1) throw e;
      console.log(`[HISTORY][PARTIAL] ${short(user)} page=${pages} ${incompleteReason}`);
      break;
    }
  }
  const fills=[...map.values()].sort((a,b)=>Number(a.time)-Number(b.time));
  const maxPageReached=pages>=MAX_PAGES;
  const truncated=maxPageReached||!!incompleteReason;
  return{fills,pages,truncated,incompleteReason,rateLimitAffected,networkAffected,complete:!truncated};
}

function delta(f){
  const sz=Math.abs(Number(f?.sz||0));
  if(!Number.isFinite(sz)||sz<=0)return 0;
  const side=String(f?.side||'').toUpperCase();
  return side==='B'?sz:side==='A'?-sz:0;
}

function reconstruct(fills){
  const books=new Map(),trades=[];
  let liquidations=0,invalidLifecycle=0;

  for(const f of fills){
    const coin=String(f?.coin||'');
    if(!coin)continue;

    const dir=String(f?.dir||'').toLowerCase();
    if(dir.includes('liquid'))liquidations++;

    const d=delta(f);
    if(!d)continue;

    const px=Number(f?.px),time=Number(f?.time),start=Number(f?.startPosition);
    if(!Number.isFinite(px)||!Number.isFinite(time))continue;

    const lots=books.get(coin)||[];
    books.set(coin,lots);

    // Hyperliquid startPosition is the position immediately before this fill.
    // Use it to determine whether the fill closes/reduces or opens/increases.
    const before=Math.abs(Number.isFinite(start)?start:0);
    const reducing=(before>0 && Math.sign(start)===Math.sign(d) ? false :
                    before>0 && ((start>0&&d<0)||(start<0&&d>0)));

    if(!reducing){
      lots.push({
        side:d>0?'long':'short',
        qty:Math.abs(d),
        px,
        time
      });
      continue;
    }

    let rem=Math.abs(d);
    const closingSide=start>0?'long':'short';

    while(rem>1e-12){
      // Drop incompatible stale lots rather than manufacturing a trade.
      while(lots.length && lots[0].side!==closingSide)lots.shift();
      if(!lots.length){
        invalidLifecycle++;
        break;
      }

      const lot=lots[0];
      const used=Math.min(rem,lot.qty);
      const fq=Math.abs(Number(f?.sz||0));
      const cp=Number(f?.closedPnl);

      let pnl;
      if(Number.isFinite(cp)&&fq>0){
        pnl=cp*(used/fq);
      }else{
        pnl=lot.side==='long'?(px-lot.px)*used:(lot.px-px)*used;
      }

      if(!Number.isFinite(pnl)){
        invalidLifecycle++;
        break;
      }

      trades.push({
        coin,
        side:lot.side,
        qty:used,
        entryPx:lot.px,
        exitPx:px,
        openTime:lot.time,
        closeTime:time,
        holdHours:Math.max(0,(time-lot.time)/3600000),
        pnl
      });

      lot.qty-=used;
      rem-=used;
      if(lot.qty<=1e-12)lots.shift();
    }

    // If the fill flips the position, the residual becomes a new lifecycle.
    if(rem>1e-12){
      lots.push({
        side:d>0?'long':'short',
        qty:rem,
        px,
        time
      });
    }
  }

  return{trades,liquidations,invalidLifecycle};
}


async function candles(coin,start,end){
  const key=`${coin}|${MEME_CANDLE_INTERVAL}|${start}|${end}`;
  if(MEME_CANDLE_CACHE.has(key))return MEME_CANDLE_CACHE.get(key);
  const data=await info({type:'candleSnapshot',req:{coin,interval:MEME_CANDLE_INTERVAL,startTime:start,endTime:end}},`candles ${coin} ${MEME_CANDLE_INTERVAL}`);
  const rows=(Array.isArray(data)?data:[]).map(x=>({
    t:Number(x?.t??x?.T??0),o:Number(x?.o),h:Number(x?.h),l:Number(x?.l),c:Number(x?.c)
  })).filter(x=>x.t>0&&[x.o,x.h,x.l,x.c].every(Number.isFinite)).sort((a,b)=>a.t-b.t);
  MEME_CANDLE_CACHE.set(key,rows);
  return rows;
}
function earlyMoveForTrade(t,rows){
  const entry=Number(t.entryPx); if(!Number.isFinite(entry)||entry<=0)return null;
  const end=t.openTime+MEME_FORWARD_MIN*60000;
  const future=rows.filter(c=>c.t>=t.openTime && c.t<=end);
  if(!future.length)return null;
  const long=t.side==='long';
  let mfe=-Infinity,mae=Infinity,first5=NaN,first10=NaN,first20=NaN;
  for(const c of future){
    const fav=(long?(c.h-entry)/entry*100:(entry-c.l)/entry*100);
    const adverse=(long?(c.l-entry)/entry*100:(entry-c.h)/entry*100);
    mfe=Math.max(mfe,fav); mae=Math.min(mae,adverse);
    const mins=Math.max(0,(c.t-t.openTime)/60000);
    if(!Number.isFinite(first5)&&fav>=MEME_EARLY_THRESHOLD_5)first5=mins;
    if(!Number.isFinite(first10)&&fav>=MEME_EARLY_THRESHOLD_10)first10=mins;
    if(!Number.isFinite(first20)&&fav>=MEME_EARLY_THRESHOLD_20)first20=mins;
  }
  return {mfe,mae,hit5:Number.isFinite(first5),hit10:Number.isFinite(first10),hit20:Number.isFinite(first20),lead5:first5,lead10:first10,lead20:first20};
}
function memeProfile(trades){
  const meme=trades.filter(t=>isMemeCoin(t.coin));
  const unique=new Set(meme.map(t=>normalizeMemeSymbol(t.coin))).size;
  const wins=meme.filter(t=>t.pnl>0).length;
  const losses=meme.filter(t=>t.pnl<0).length;
  const gw=meme.filter(t=>t.pnl>0).reduce((a,t)=>a+t.pnl,0);
  const gl=Math.abs(meme.filter(t=>t.pnl<0).reduce((a,t)=>a+t.pnl,0));
  const pnl=meme.reduce((a,t)=>a+t.pnl,0);
  const totalPnl=trades.reduce((a,t)=>a+t.pnl,0);
  const exposure=trades.length?meme.length/trades.length*100:0;
  const hold=meme.map(t=>t.holdHours).filter(Number.isFinite);
  const holdMed=median(hold);
  const wr=meme.length?wins/meme.length*100:0;
  const pf=gl>0?gw/gl:(gw>0?Infinity:0);
  // Specialization favors repeated meme participation, breadth, and positive
  // meme performance without making WR/PF a hard gate.
  const e=Math.min(100,exposure);
  const u=Math.min(100,unique/10*100);
  const p=pnl>0?Math.min(100,55+Math.log10(Math.max(1,pnl))*8):Math.max(0,45-Math.log10(Math.max(1,Math.abs(pnl)+1))*6);
  const breadth=Math.min(100,unique>=MEME_MIN_UNIQUE?100:unique/Math.max(1,MEME_MIN_UNIQUE)*100);
  const score=Math.round(Math.max(0,Math.min(100,.55*e+.20*u+.15*p+.10*breadth)));
  const coinCounts=new Map();
  for(const t of meme){const c=normalizeMemeSymbol(t.coin);if(c)coinCounts.set(c,(coinCounts.get(c)||0)+1)}
  const dominant=[...coinCounts.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0]||['n/a',0];
  return {memeTrades:meme.length,totalTrades:trades.length,exposurePct:exposure,uniqueCoins:unique,memeWinRate:wr,memeProfitFactor:pf,memePnl:pnl,totalPnl,medianHoldHours:holdMed,specializationScore:score,dominantMeme:dominant[0],dominantMemeTrades:dominant[1],memeTradesList:meme};
}
function earlyScore(stats){
  if(!stats.length)return {score:0,count:0,hit5:0,hit10:0,hit20:0,medianLead5:NaN,mfeMedian:NaN,pump:0,dump:0};
  const pct=k=>stats.filter(x=>x[k]).length/stats.length*100;
  const leads=stats.filter(x=>Number.isFinite(x.lead5)).map(x=>x.lead5);
  const mfe=stats.map(x=>x.mfe).filter(Number.isFinite);
  const hit5=pct('hit5'),hit10=pct('hit10'),hit20=pct('hit20');
  const leadScore=leads.length?Math.max(0,100-Math.min(100,median(leads)/60*100)):0;
  const mfeScore=Math.max(0,Math.min(100,(median(mfe)/Math.max(1,MEME_EARLY_THRESHOLD_10))*50));
  const score=Math.round(Math.max(0,Math.min(100,.30*hit5+.25*hit10+.15*hit20+.20*leadScore+.10*mfeScore)));
  const longs=stats.filter(x=>x.side==='long');
  const shorts=stats.filter(x=>x.side==='short');
  return {score,count:stats.length,hit5,hit10,hit20,medianLead5:median(leads),mfeMedian:median(mfe),pump:Math.round(longs.length?earlyScoreSimple(longs):0),dump:Math.round(shorts.length?earlyScoreSimple(shorts):0)};
}
function earlyScoreSimple(a){
  if(!a.length)return 0;
  const h5=a.filter(x=>x.hit5).length/a.length*100,h10=a.filter(x=>x.hit10).length/a.length*100;
  return Math.round(.55*h5+.45*h10);
}
async function analyzeMemeTrader(x,now){
  const p=memeProfile(x.historyFills?reconstruct(x.historyFills).trades:[]);
  const incomplete=Boolean(x.historyIncomplete||x.truncated);
  const zeroEarly={score:0,count:0,hit5:0,hit10:0,hit20:0,medianLead5:NaN,mfeMedian:NaN,pump:0,dump:0,repeatability:0};
  if(incomplete && MEME_REQUIRE_COMPLETE_HISTORY)return {...x,meme:p,early:zeroEarly,memeEligible:false,focusEligible:false,researchEligible:false,dataQualityGate:false};
  const dominantPct=p.memeTrades>0?(Number(p.dominantMemeTrades||0)/p.memeTrades*100):0;
  const strictEligible=p.memeTrades>=MEME_MIN_TRADES&&p.exposurePct>=MEME_MIN_EXPOSURE&&p.uniqueCoins>=MEME_MIN_UNIQUE;
  const focusEligible=p.memeTrades>=MEME_FOCUS_MIN_TRADES&&p.exposurePct>=MEME_FOCUS_MIN_EXPOSURE&&p.uniqueCoins>=MEME_FOCUS_MIN_UNIQUE&&p.specializationScore>=20&&dominantPct<=MEME_FOCUS_MAX_DOMINANT;
  const researchEligible=p.memeTrades>=MEME_RESEARCH_MIN_TRADES&&p.exposurePct>=MEME_RESEARCH_MIN_EXPOSURE&&p.uniqueCoins>=MEME_RESEARCH_MIN_UNIQUE;
  // V5.34: Focus/Research diagnostics are independent of the strict 65% specialist gate.
  if(!strictEligible && !focusEligible && !researchEligible)return {...x,meme:p,early:zeroEarly,memeEligible:false,focusEligible:false,researchEligible:false,dataQualityGate:!incomplete};
  const recent=[...p.memeTradesList].sort((a,b)=>b.openTime-a.openTime).slice(0,MEME_TRADE_SAMPLE);
  const byCoin=new Map();
  for(const t of recent){const a=byCoin.get(t.coin)||[];a.push(t);byCoin.set(t.coin,a)}
  const coins=[...byCoin.entries()].sort((a,b)=>b[1].length-a[1].length).slice(0,MEME_COINS_PER_TRADER);
  const results=[];
  for(const [coin,ts] of coins){
    try{
      const minT=Math.min(...ts.map(t=>t.openTime));
      const rows=await candles(coin,minT-15*60000,now);
      for(const t of ts){const z=earlyMoveForTrade(t,rows);if(z)results.push({...z,side:t.side,coin:t.coin,openTime:t.openTime})}
    }catch(e){console.log(`[MEME-CANDLE][WARN] ${short(x.address)} ${coin} ${category(e)} :: ${e.message}`)}
  }
  const early=earlyScore(results);
  const repeatability=Math.round(Math.min(100,results.length?Math.min(100,(new Set(results.map(x=>x.coin)).size/Math.max(1,p.uniqueCoins))*100):0));
  const edge=Math.round(.60*early.score+.20*repeatability+.20*p.specializationScore);
  const focusScore=Math.round(.50*p.specializationScore+.30*edge+.20*x.qualityScore);
  const researchScore=Math.round(.45*p.specializationScore+.35*edge+.20*x.qualityScore);
  return {...x,meme:p,early:{...early,repeatability,score:edge},memeEligible:strictEligible,focusEligible,researchEligible,memeFocusScore:focusEligible?Math.max(0,Math.min(100,focusScore)):0,researchScore:researchEligible?Math.max(0,Math.min(100,researchScore)):0,dominantPct};
}
function metrics(fills,r){
  const ts=r.trades,w=ts.filter(t=>t.pnl>0),l=ts.filter(t=>t.pnl<0),holds=ts.map(t=>t.holdHours).filter(Number.isFinite);
  const gw=w.reduce((s,t)=>s+t.pnl,0),gl=Math.abs(l.reduce((s,t)=>s+t.pnl,0)),pnl=ts.reduce((s,t)=>s+t.pnl,0);
  const days=new Set(ts.map(t=>new Date(t.closeTime).toISOString().slice(0,10)));
  let st=0,maxst=0;for(const t of [...ts].sort((a,b)=>a.closeTime-b.closeTime)){if(t.pnl<0){st++;maxst=Math.max(maxst,st)}else if(t.pnl>0)st=0}
  return{fills:fills.length,closedTrades:ts.length,invalidLifecycle:Number(r.invalidLifecycle||0),winRate:ts.length?w.length/ts.length*100:0,pnl,grossWin:gw,grossLossAbs:gl,profitFactor:gl>0?gw/gl:(gw>0?Infinity:0),medianHoldHours:median(holds),avgHoldHours:holds.length?holds.reduce((a,b)=>a+b,0)/holds.length:NaN,p25HoldHours:quantile(holds,.25),p75HoldHours:quantile(holds,.75),activeDays:days.size,maxLosingStreak:maxst,liquidations:r.liquidations}
}
function safetyGate(m,truncated){
  const reasons=[];
  if(truncated)reasons.push('HISTORY_TRUNCATED');
  if(m.closedTrades<=0)reasons.push('NO_CLOSED_TRADES');
  if(m.invalidLifecycle>Math.max(3,Math.ceil(m.fills*0.02)))reasons.push(`INVALID_LIFECYCLE>${Math.max(3,Math.ceil(m.fills*0.02))}`);
  if(!Number.isFinite(m.profitFactor)&&m.profitFactor!==Infinity)reasons.push('INVALID_PROFIT_FACTOR');
  if(m.liquidations>Math.max(MAX_LIQ,3))reasons.push(`LIQUIDATIONS>${Math.max(MAX_LIQ,3)}`);
  if(m.maxLosingStreak>Math.max(MAX_LOSING_STREAK,12))reasons.push(`EXTREME_LOSING_STREAK>${Math.max(MAX_LOSING_STREAK,12)}`);
  return{ok:!reasons.length,reasons}
}
function softFlags(m){
  const r=[];
  if(m.closedTrades<MIN_TRADES)r.push(`TRADES<${MIN_TRADES}`);
  if(m.winRate<MIN_WR)r.push(`WR<${MIN_WR}%`);
  if(m.pnl<MIN_PNL)r.push(`PNL<${MIN_PNL}`);
  if(!(m.profitFactor>=MIN_PF))r.push(`PF<${MIN_PF}`);
  if(!(m.medianHoldHours<=MAX_MEDIAN_HOLD))r.push(`MEDIAN_HOLD>${MAX_MEDIAN_HOLD}h`);
  if(!(m.avgHoldHours<=MAX_AVG_HOLD))r.push(`AVG_HOLD>${MAX_AVG_HOLD}h`);
  if(m.activeDays<MIN_ACTIVE_DAYS)r.push(`ACTIVE_DAYS<${MIN_ACTIVE_DAYS}`);
  if(m.maxLosingStreak>MAX_LOSING_STREAK)r.push(`LOSING_STREAK>${MAX_LOSING_STREAK}`);
  if(m.liquidations>MAX_LIQ)r.push(`LIQUIDATIONS>${MAX_LIQ}`);
  return r
}
function qualityScore(m){
  if(m.closedTrades<=0)return 0;
  const trade=Math.min(100,m.closedTrades/Math.max(30,MIN_TRADES)*100);
  const wr=Math.max(0,Math.min(100,m.winRate/80*100));
  const pf=Math.max(0,Math.min(100,Math.min(m.profitFactor,5)/3*100));
  const hold=Number.isFinite(m.avgHoldHours)?Math.max(0,Math.min(100,100-Math.max(0,m.avgHoldHours-2)/18*100)):40;
  const active=Math.max(0,Math.min(100,m.activeDays/7*100));
  const pnl=m.pnl>0?Math.min(100,60+Math.log10(Math.max(1,m.pnl))*8):Math.max(0,40-Math.log10(Math.max(1,Math.abs(m.pnl)+1))*8);
  return Math.max(0,Math.min(100,0.20*trade+0.22*wr+0.24*pf+0.12*hold+0.10*active+0.12*pnl-Math.min(35,m.maxLosingStreak*4)*.5-Math.min(35,m.liquidations*12)*.5))
}
function rankStat(a,b){return(b.qualityScore-a.qualityScore)||(b.metrics.profitFactor-a.metrics.profitFactor)||(b.metrics.winRate-a.metrics.winRate)||(b.metrics.closedTrades-a.metrics.closedTrades)}

async function position(user){
  const s=await info({type:'clearinghouseState',user},`position ${short(user)}`);
  return(Array.isArray(s?.assetPositions)?s.assetPositions:[])
    .map(x=>x?.position).filter(Boolean)
    .filter(p=>Math.abs(Number(p.szi||0))>0)
    .sort((a,b)=>Math.abs(Number(b.szi||0))-Math.abs(Number(a.szi||0)));
}
async function allMids(){
  const x=await info({type:'allMids'},'allMids');
  if(!x||typeof x!=='object')throw new Error('allMids: invalid response');
  return x;
}

async function probeCurrentPositions(addresses,mids){
  const out=[]; let idx=0;
  async function worker(){
    while(true){
      const i=idx++; if(i>=addresses.length)break;
      const address=addresses[i];
      try{
        const positions=await position(address);
        for(const p of positions){
          const coin=String(p?.coin||'');
          const entry=Number(p?.entryPx||0), mid=Number(mids?.[coin]);
          if(!coin||!Number.isFinite(entry)||entry<=0||!Number.isFinite(mid)||mid<=0)continue;
          const distancePct=Math.abs(mid-entry)/entry*100;
          out.push({address,position:p,coin,mid,distancePct});
        }
      }catch(e){
        console.log(`[POSITION-PROBE][WARN] ${short(address)} ${category(e)} :: ${e.message}`);
      }
    }
  }
  await Promise.all(Array.from({length:Math.max(1,POSITION_PROBE_CONCURRENCY)},worker));
  out.sort((a,b)=>a.distancePct-b.distancePct);
  return out;
}

function leverageValue(pos){
  const v=pos?.leverage;
  if(v&&typeof v==='object')return Number(v.value ?? v.rawUsd ?? v.leverage ?? 0);
  return Number(pos?.leverageValue ?? v ?? 0);
}

async function book(coin){
  const b=await info({type:'l2Book',coin},`book ${coin}`),lv=Array.isArray(b?.levels)?b.levels:[];
  const bid=Number(lv?.[0]?.[0]?.px),ask=Number(lv?.[1]?.[0]?.px);
  if(!Number.isFinite(bid)||!Number.isFinite(ask))throw new Error(`book ${coin}: no bid/ask`);
  return{bid,ask,mid:(bid+ask)/2}
}
async function atr(coin,end){
  const c=await info({
    type:'candleSnapshot',
    req:{coin,interval:'1h',startTime:end-96*3600000,endTime:end}
  },`candles ${coin}`);

  const rows=Array.isArray(c)?c:[];
  const parsed=rows.map(x=>({
    h:Number(x?.h),l:Number(x?.l),o:Number(x?.o),c:Number(x?.c)
  })).filter(x=>Number.isFinite(x.h)&&Number.isFinite(x.l)&&x.h>x.l);

  if(parsed.length<12)throw new Error(`candles ${coin}: insufficient 1h data (${parsed.length})`);

  let prevClose=NaN;
  const tr=[];
  for(const x of parsed){
    const range=x.h-x.l;
    const trueRange=Number.isFinite(prevClose)
      ? Math.max(range,Math.abs(x.h-prevClose),Math.abs(x.l-prevClose))
      : range;
    if(Number.isFinite(trueRange)&&trueRange>0)tr.push(trueRange);
    prevClose=Number.isFinite(x.c)?x.c:prevClose;
  }

  if(tr.length<12)throw new Error(`candles ${coin}: invalid 1h true-range data`);
  const recent=tr.slice(-72);
  const value=recent.reduce((a,b)=>a+b,0)/recent.length;

  if(!Number.isFinite(value)||value<=0)throw new Error(`candles ${coin}: ATR invalid ${value}`);
  return value;
}

function positionTimingFromFills(fills, coin, positionSide, currentSize){
  const rows=(Array.isArray(fills)?fills:[])
    .filter(f=>String(f?.coin||'')===String(coin||''))
    .map(f=>({
      time:Number(f?.time||0),
      delta:delta(f),
      px:Number(f?.px||0),
      dir:String(f?.dir||''),
      side:String(f?.side||'')
    }))
    .filter(x=>x.time>0&&Number.isFinite(x.delta)&&x.delta!==0)
    .sort((a,b)=>a.time-b.time);
  if(!rows.length)return {openTime:NaN,lastAddTime:NaN,observedFrom:NaN,source:'unavailable'};

  const want=String(positionSide||'').toUpperCase()==='LONG'?1:-1;
  let net=0, openTime=NaN, lastAddTime=NaN, observedFrom=rows[0].time;
  for(const f of rows){
    const before=net, after=net+f.delta;
    if(want>0){
      if(before<=0 && after>0)openTime=f.time;
      if(before>0 && f.delta>0)lastAddTime=f.time;
      if(after<=0 && before>0){openTime=NaN;lastAddTime=NaN}
    }else{
      if(before>=0 && after<0)openTime=f.time;
      if(before<0 && f.delta<0)lastAddTime=f.time;
      if(after>=0 && before<0){openTime=NaN;lastAddTime=NaN}
    }
    net=after;
  }
  // If the lookback begins while the position was already open, lifecycle reconstruction
  // cannot prove the original opening time. In that case expose the observed window start.
  if(!Number.isFinite(openTime)){
    openTime=observedFrom;
  }
  if(!Number.isFinite(lastAddTime))lastAddTime=openTime;
  return {openTime,lastAddTime,observedFrom,source:'userFills'};
}
function isoUtc(ms){return Number.isFinite(Number(ms))&&Number(ms)>0?new Date(Number(ms)).toISOString().replace('T',' ').replace('.000Z',' UTC'):'n/a'}
function ageHours(now,ms){return Number.isFinite(Number(ms))&&Number(ms)>0?Math.max(0,(now-Number(ms))/3600000):NaN}

function plan(pos,m,atrv,now){
  const s=Number(pos?.szi||0),source=Number(pos?.entryPx||0);
  if(!Number.isFinite(s)||s===0)throw new Error('position: invalid size');
  const side=s>0?'LONG':'SHORT';
  if(!Number.isFinite(source)||source<=0)throw new Error('position: invalid entryPx');
  if(!Number.isFinite(m.mid)||m.mid<=0)throw new Error('BOOK_MID_INVALID');
  const dist=Math.abs(m.mid-source)/source*100;
  let sl=NaN,tp=NaN,rr=NaN,atrPct=NaN;
  const diagnostics=[];
  if(Number.isFinite(atrv)&&atrv>0){
    atrPct=atrv/m.mid*100;
    if(Number.isFinite(atrPct)&&atrPct>0&&atrPct<=25){
      sl=side==='LONG'?m.mid-SL_ATR*atrv:m.mid+SL_ATR*atrv;
      tp=side==='LONG'?m.mid+TP_ATR*atrv:m.mid-TP_ATR*atrv;
      const risk=Math.abs(m.mid-sl),reward=Math.abs(tp-m.mid);
      rr=risk>0?reward/risk:NaN;
      if(sl<=0||tp<=0)diagnostics.push('SL_TP_NONPOSITIVE');
    }else diagnostics.push('ATR_SANITY_FAIL');
  }else diagnostics.push('ATR_UNAVAILABLE');
  if(dist>MAX_ENTRY_DIST)diagnostics.push(`ENTRY_DISTANCE>${MAX_ENTRY_DIST}%`);
  if(Number.isFinite(sl)&&Math.abs(sl-m.mid)<Math.max(atrv*0.05,m.mid*0.00005))diagnostics.push('SL_TOO_CLOSE');
  if(Number.isFinite(tp)&&Math.abs(tp-m.mid)<Math.max(atrv*0.05,m.mid*0.00005))diagnostics.push('TP_TOO_CLOSE');
  return{
    // REAL eligibility gate: current entry distance only. Diagnostic SL/TP/RR never blocks a real current position.
    eligible:dist<=MAX_ENTRY_DIST,
    reason:dist>MAX_ENTRY_DIST?`ENTRY_DISTANCE>${MAX_ENTRY_DIST}%`:'READY',
    side,coin:String(pos?.coin||''),sourceEntry:source,entry:m.mid,distancePct:dist,
    sl,tp,rr,atr:atrv,atrPct,maxHoldHours:MAX_HOLD,positionAgeHours:(Number(pos?.timestamp||pos?.entryTimestamp||0)>0?Math.max(0,(now-Number(pos?.timestamp||pos?.entryTimestamp||0))/3600000):NaN),
    diagnostics
  };
}

function copyability(x){
  let s=x.qualityScore*.35;
  if(x.position)s+=20;
  if(x.plan && x.plan.eligible!==undefined){
    s+=Math.max(0,15-Math.min(15,(x.plan.distancePct||99)/Math.max(MAX_ENTRY_DIST,.01)*15));
    s+=Math.max(0,10-Math.min(10,(x.positionAgeHours||0)/12*10));
    if(x.plan.rr>=MIN_RR)s+=10;
    s+=x.plan.atrPct<=3?10:Math.max(0,10-(x.plan.atrPct-3)*2);
  }
  return Math.max(0,Math.min(100,s))
}
async function enrich(x,now){
  try{
    const p=await position(x.address);
    if(!p){x.enrichmentStatus='WATCH_NO_POSITION';x.position=null;x.copyabilityScore=Math.round(x.qualityScore*.35);return x}
    x.position=p;
    const coin=String(p.coin||'');
    if(!coin)throw new Error('POSITION_COIN_MISSING');

    const bk=await book(coin);
    const av=await atr(coin,now);
    x.plan=plan(p,bk,av,now);
    x.positionAgeHours=x.plan.positionAgeHours;
    x.copyabilityScore=Math.round(copyability(x));
    x.enrichmentStatus=x.plan.eligible?'COPY_READY':'POSITION_BLOCKED';
    return x;
  }catch(e){
    x.plan=null;
    x.enrichmentStatus=`POSITION_DATA_INVALID:${category(e)}`;
    x.enrichmentError=e.message;
    x.copyabilityScore=0;
    return x
  }
}
async function telegram(text){
  if(!TG_TOKEN||!TG_CHAT){console.log('[TELEGRAM] missing credentials');return}
  for(let i=0;i<text.length;i+=TG_LIMIT){
    try{
      await fetchJson(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`,{
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({chat_id:TG_CHAT,text:text.slice(i,i+TG_LIMIT),disable_web_page_preview:true})
      },'telegram');
    }catch(e){
      console.error(`[TELEGRAM][ERROR] ${e.message}`)
    }
  }
}
function errSummary(es){const m={};for(const e of es)m[e.cat]=(m[e.cat]||0)+1;return Object.entries(m).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k}:${v}`).join(' | ')||'none'}
function icon(s){return s==='COPY_READY'?'🟢':s==='WATCH_NO_POSITION'?'🟡':s==='POSITION_BLOCKED'?'🟠':'🔴'}

async function runLimited(items, worker, concurrency){
  const out=new Array(items.length), errors=[]; let next=0;
  async function runner(){
    while(true){const i=next++; if(i>=items.length)break; try{out[i]=await worker(items[i],i)}catch(e){errors.push({item:items[i],error:e})}}
  }
  await Promise.all(Array.from({length:Math.max(1,concurrency)},runner));
  return{out,errors};
}

function copyIntegrity(x){
  const m=x?.metrics||{};
  const reasons=[];
  if(!Number.isFinite(Number(m.closedTrades)) || Number(m.closedTrades)<MIN_COPY_CLOSED_TRADES) reasons.push(`TRADES<${MIN_COPY_CLOSED_TRADES}`);
  if(!Number.isFinite(Number(m.activeDays)) || Number(m.activeDays)<MIN_COPY_ACTIVE_DAYS) reasons.push(`ACTIVE_DAYS<${MIN_COPY_ACTIVE_DAYS}`);
  if(Number(m.invalidLifecycle||0)>MAX_COPY_LIFECYCLE_ERRORS) reasons.push(`LIFECYCLE_ERR>${MAX_COPY_LIFECYCLE_ERRORS}`);
  if(x?.truncated) reasons.push('HISTORY_TRUNCATED');
  if(Number(m.liquidations||0)>Math.max(MAX_LIQ,1)) reasons.push(`LIQUIDATIONS>${Math.max(MAX_LIQ,1)}`);
  return {ok:reasons.length===0,reasons};
}

function opportunityScore(x){
  const m=x.metrics||{},p=x.plan||{};
  let s=Number(x.qualityScore||0)*0.42;
  s+=Math.min(20,Math.max(0,Number(x.metrics?.closedTrades||0)/40*20));
  if(p){
    const dist=Number(p.distancePct); const rr=Number(p.rr); const age=Number(p.positionAgeHours);
    if(Number.isFinite(dist))s+=Math.max(0,18-Math.min(18,dist/Math.max(MAX_ENTRY_DIST,.01)*18));
    if(Number.isFinite(rr))s+=Math.min(15,Math.max(0,rr/MIN_RR*15));
    if(Number.isFinite(age))s+=Math.max(0,10-Math.min(10,age/12*10));
    if(p.positionValueUsd>0)s+=Math.min(5,Math.log10(Math.max(1,p.positionValueUsd))*1.5);
  }
  if(m.maxLosingStreak>MAX_LOSING_STREAK)s-=10;
  if(m.invalidLifecycle>0)s-=Math.min(10,m.invalidLifecycle*2);
  return Math.max(0,Math.min(100,s));
}

async function enrichOne(x,now){
  try{
    const positions=await position(x.address);
    if(!positions.length){x.enrichmentStatus='NO_POSITION';x.position=null;x.copyabilityScore=0;return x}
    const opportunities=[];
    for(const p of positions){
      const coin=String(p.coin||''); if(!coin)continue;
      try{
        const [bk,av]=await Promise.all([book(coin),atr(coin,now)]);
        const q={...x,position:p};
        const pl=plan(p,bk,av,now);
        pl.positionValueUsd=Math.abs(Number(p.szi||0))*Number(bk.mid||0);
        q.plan=pl;q.copyabilityScore=Math.round(opportunityScore(q));
        q.enrichmentStatus=pl.eligible?'COPY_READY':'POSITION_BLOCKED';
        opportunities.push(q);
      }catch(e){
        console.log(`[POSITION][WARN] ${short(x.address)} ${coin} ${category(e)} :: ${e.message}`);
      }
    }
    if(!opportunities.length)throw new Error('ALL_OPEN_POSITIONS_UNREADABLE');
    opportunities.sort((a,b)=>opportunityScore(b)-opportunityScore(a));
    Object.assign(x,opportunities[0]);
    x.openPositionCount=positions.length;
    return x;
  }catch(e){
    x.plan=null;x.copyabilityScore=0;x.enrichmentStatus=`POSITION_DATA_INVALID:${category(e)}`;x.enrichmentError=String(e.message||e);return x;
  }
}

async function enrichBatch(pool,now){
  const out=[]; let idx=0;
  async function worker(){
    while(true){const i=idx++;if(i>=pool.length)break;const x=await enrichOne(pool[i],now);out.push(x);await sleep(POSITION_BETWEEN)}
  }
  await Promise.all(Array.from({length:Math.max(1,POSITION_CONCURRENCY)},worker));
  return out;
}

function selectRotatingMemeCohort(addresses){
  const all=[...new Set(addresses.filter(addr).map(norm))];
  const slots=Math.max(1,MEME_COVERAGE_SLOTS);
  const size=Math.min(all.length,Math.max(1,MEME_PREFILTER_SCAN_PER_CYCLE));
  if(all.length<=size)return {selected:all,slot:0,slots:1,coverage:all.length};
  const slot=Math.floor(Date.now()/300000)%slots;
  const buckets=Array.from({length:slots},()=>[]);
  // Round-robin assignment preserves leaderboard diversity in every cycle.
  all.forEach((a,i)=>buckets[i%slots].push(a));
  let selected=buckets[slot].slice(0,size);
  // If a custom size is smaller than the bucket, take evenly spaced entries.
  if(selected.length>size){
    const step=selected.length/size; const out=[];
    for(let i=0;i<size;i++)out.push(selected[Math.floor(i*step)]);
    selected=out;
  }
  return {selected,slot,slots,coverage:all.length};
}

async function main(){
  const t0=Date.now();
  const now=Date.now(), startTime=now-MEME_HISTORY_DAYS*86400000;
  const errors=[];
  console.log(`[MEME-SCOUT V5.31][START] mode=${MEME_MODE} watchlist=${MEME_WATCHLIST.length}`);
  let d;
  try{d=await discover()}catch(e){
    console.error(`[DISCOVERY][ERROR] ${e.message}`);
    await telegram(`🟣 HYPERLIQUID MEME SPECIALIST SCOUT V5.34\n📡 READ-ONLY | NO ORDERS\n━━━━━━━━━━━━━━━━━━\n❌ DISCOVERY ERROR\n${e.message}`);process.exitCode=1;return;
  }
  const universeAddresses=MEME_MODE==='watch'&&MEME_WATCHLIST.length?MEME_WATCHLIST:d.candidates.slice(0,MEME_SCOUT_CANDIDATES);
  const cohort=MEME_MODE==='watch'?{selected:universeAddresses,slot:0,slots:1,coverage:universeAddresses.length}:selectRotatingMemeCohort(universeAddresses);
  const sourceAddresses=cohort.selected;
  console.log(`[COHORT] cycle=${cohort.slot+1}/${cohort.slots} scanned=${sourceAddresses.length} coverage=${cohort.coverage}`);
  const scanned=[];
  const nearMisses=[];
  const memeHeavy=[];
  const singleMemeHeavy=[];
  const memeResearch=[];
  const memeFocus=[];
  const classifierObserved=new Map();
  const funnel={prefilterScanned:0,prefilterSelected:0,historyOK:0,historyTruncated:0,history429:0,historyOtherIncomplete:0,closedTradesEnough:0,closedTradesLow:0,memeTradesPass:0,memeTradesFail:0,exposurePass:0,exposureFail:0,uniquePass:0,uniqueFail:0,specialists:0};
  const pushNearMiss=(x)=>{
    const p=x.meme||{};
    const tradeDef=Math.max(0,MEME_MIN_TRADES-Number(p.memeTrades||0));
    const exposureDef=Math.max(0,MEME_MIN_EXPOSURE-Number(p.exposurePct||0));
    const uniqueDef=Math.max(0,MEME_MIN_UNIQUE-Number(p.uniqueCoins||0));
    const distance=tradeDef*3+exposureDef+uniqueDef*8;
    nearMisses.push({...x,nearMissDistance:distance});
    nearMisses.sort((a,b)=>a.nearMissDistance-b.nearMissDistance || (b.meme?.specializationScore||0)-(a.meme?.specializationScore||0));
    if(nearMisses.length>5)nearMisses.pop();
  };

  let fullHistoryAddresses=sourceAddresses;
  let prefilterErrors=0;
  if(MEME_MODE!=='watch' && sourceAddresses.length>MEME_PREFILTER_TARGET){
    const pf=await fastMemePrefilter(sourceAddresses);
    funnel.prefilterScanned=sourceAddresses.length;
    funnel.prefilterSelected=pf.selected.length;
    prefilterErrors=pf.errors;
    fullHistoryAddresses=pf.selected.map(x=>x.address);
    console.log(`[PREFILTER][DONE] ${sourceAddresses.length} -> ${fullHistoryAddresses.length} selected errors=${pf.errors}`);
  }else{
    funnel.prefilterScanned=sourceAddresses.length;
    funnel.prefilterSelected=sourceAddresses.length;
  }

  for(let i=0;i<fullHistoryAddresses.length;i++){
    const address=fullHistoryAddresses[i];
    try{
      const f=await getFills(address,startTime,now);
      const r=reconstruct(f.fills),m=metrics(f.fills,r),sg=safetyGate(m,f.truncated);
      if(f.truncated)funnel.historyTruncated++; else funnel.historyOK++;
      if(f.rateLimitAffected)funnel.history429++;
      else if(f.truncated)funnel.historyOtherIncomplete++;
      if(m.closedTrades>=Math.max(1,MEME_MIN_TRADES))funnel.closedTradesEnough++; else funnel.closedTradesLow++;
      if(m.closedTrades<Math.max(1,Math.min(MEME_MIN_TRADES,3))) continue;
      const x={address,metrics:m,safety:sg,truncated:f.truncated,historyIncomplete:f.truncated,historyIncompleteReason:f.incompleteReason||null,history429:f.rateLimitAffected,historyPages:f.pages,historyFills:f.fills,qualityScore:Math.round(qualityScore(m))};
      const y=await analyzeMemeTrader(x,now);
      const reconstructedTrades=reconstruct(f.fills).trades;
      for(const t of reconstructedTrades){
        const c=normalizeMemeSymbol(t?.coin);
        if(c)classifierObserved.set(c,(classifierObserved.get(c)||0)+1);
      }
      const p=y.meme||{};
      if(y.dataQualityGate!==false && Number(p.memeTrades||0)>=MEME_MIN_TRADES)funnel.memeTradesPass++; else funnel.memeTradesFail++;
      if(y.dataQualityGate!==false && Number(p.exposurePct||0)>=MEME_MIN_EXPOSURE)funnel.exposurePass++; else funnel.exposureFail++;
      if(y.dataQualityGate!==false && Number(p.uniqueCoins||0)>=MEME_MIN_UNIQUE)funnel.uniquePass++; else funnel.uniqueFail++;
      const heavyOk=y.dataQualityGate!==false && Number(p.memeTrades||0)>=MEME_HEAVY_MIN_TRADES && Number(p.exposurePct||0)>=MEME_HEAVY_MIN_EXPOSURE && Number(p.uniqueCoins||0)>=MEME_HEAVY_MIN_UNIQUE;
      const singleOk=y.dataQualityGate!==false && Number(p.memeTrades||0)>=MEME_SINGLE_MIN_TRADES && Number(p.exposurePct||0)>=MEME_SINGLE_MIN_EXPOSURE && Number(p.uniqueCoins||0)===1;
      if(heavyOk)memeHeavy.push(y);
      if(singleOk)singleMemeHeavy.push(y);

      if(y.focusEligible)memeFocus.push(y);
      if(y.researchEligible && !y.focusEligible && !y.memeEligible)memeResearch.push(y);
      if(y.memeEligible){scanned.push(y);funnel.specialists++;}else pushNearMiss(y);
      console.log(`[MEME] ${i+1}/${fullHistoryAddresses.length} ${short(address)} meme=${p.memeTrades||0}/${m.closedTrades} exposure=${fmt(p.exposurePct,1)} unique=${p.uniqueCoins||0} spec=${p.specializationScore||0} early=${y.early?.score||0}`);
    }catch(e){errors.push({address,cat:category(e),message:String(e.message||e)})}
    if(i+1<fullHistoryAddresses.length)await sleep(MEME_FULL_BETWEEN_MS);
  }
  scanned.sort((a,b)=>((b.early?.score||0)-(a.early?.score||0))||((b.meme?.specializationScore||0)-(a.meme?.specializationScore||0))||rankStat(a,b));
  const top=scanned.slice(0,MEME_TOP_N);
  const heavyTop=[...new Map(memeHeavy.map(x=>[x.address,x])).values()].sort((a,b)=>(b.meme?.exposurePct||0)-(a.meme?.exposurePct||0)||(b.meme?.memeTrades||0)-(a.meme?.memeTrades||0)||(b.meme?.uniqueCoins||0)-(a.meme?.uniqueCoins||0)).slice(0,MEME_TOP_N);
  const singleTop=[...new Map(singleMemeHeavy.map(x=>[x.address,x])).values()].sort((a,b)=>(b.meme?.exposurePct||0)-(a.meme?.exposurePct||0)||(b.meme?.memeTrades||0)-(a.meme?.memeTrades||0)).slice(0,MEME_TOP_N);
  const focusTop=[...new Map(memeFocus.map(x=>[x.address,x])).values()].sort((a,b)=>(b.memeFocusScore||0)-(a.memeFocusScore||0)||(b.meme?.exposurePct||0)-(a.meme?.exposurePct||0)||(b.meme?.memeTrades||0)-(a.meme?.memeTrades||0)).slice(0,MEME_FOCUS_TOP_N);
  const researchTop=[...new Map(memeResearch.map(x=>[x.address,x])).values()].sort((a,b)=>(b.researchScore||0)-(a.researchScore||0)||(b.meme?.exposurePct||0)-(a.meme?.exposurePct||0)||(b.meme?.memeTrades||0)-(a.meme?.memeTrades||0)).slice(0,MEME_RESEARCH_TOP_N);

  // In watch mode, enrich only the fixed five. In scout mode, current positions
  // are informational; the purpose of this run is to discover specialists, not copy.
  const watched=[];
  for(const x of top){
    try{
      const ps=await position(x.address);
      const memePositions=ps.filter(p=>isMemeCoin(p.coin));
      const pos=memePositions[0]||ps[0]||null;
      x.position=pos;
      if(pos){
        const coin=String(pos.coin||'');
        const mids=await allMids();
        const mid=Number(mids[coin]);
        x.current={coin,side:Number(pos.szi)>0?'LONG':'SHORT',entry:Number(pos.entryPx),mid,distancePct:(Number.isFinite(mid)&&Number(pos.entryPx)>0)?Math.abs(mid-Number(pos.entryPx))/Number(pos.entryPx)*100:NaN,isMeme:isMemeCoin(coin)};
      }else x.current=null;
      watched.push(x);
    }catch(e){errors.push({address:x.address,cat:category(e),message:String(e.message||e)})}
  }

  const classifierAudit=memeClassifierAudit([...classifierObserved.entries()].flatMap(([coin,trades])=>Array.from({length:trades},()=>({coin}))));
  const lines=['🟣 HYPERLIQUID MEME SPECIALIST SCOUT V5.34','📡 READ-ONLY | NO ORDERS','━━━━━━━━━━━━━━━━━━',`🔎 Leaderboard: ${d.discovered}`,`🎯 Mode: ${MEME_MODE==='watch'?'FIXED WATCHLIST':'SCOUT'}`,`🧪 Universe: ${universeAddresses.length} | This cycle: ${sourceAddresses.length}`,`⚡ Fast prefilter: ${funnel.prefilterScanned} → ${funnel.prefilterSelected} full-history | Coverage cycle ${cohort.slot+1}/${cohort.slots}`, `🧬 Strict meme specialists found: ${scanned.length}`,`🏆 Strict specialists: ${top.length}/${MEME_TOP_N}`,`🟠 Meme-focus candidates: ${focusTop.length}`,`🎯 Focus criteria: exposure>=${MEME_FOCUS_MIN_EXPOSURE}% | meme trades>=${MEME_FOCUS_MIN_TRADES} | unique memes>=${MEME_FOCUS_MIN_UNIQUE} | dominant<=${MEME_FOCUS_MAX_DOMINANT}%`,`⚡ History: ${MEME_HISTORY_DAYS}d | Early-move window: ${MEME_FORWARD_MIN}m | candle=${MEME_CANDLE_INTERVAL}`,`📌 Criteria: meme exposure>=${MEME_MIN_EXPOSURE}% | meme trades>=${MEME_MIN_TRADES} | unique memes>=${MEME_MIN_UNIQUE}`,'','🧪 MEME SPECIALIST FUNNEL',`Fast prefilter scanned: ${funnel.prefilterScanned}`,`Fast prefilter selected: ${funnel.prefilterSelected}`,`Prefilter errors/skips: ${prefilterErrors}`,`History usable: ${funnel.historyOK}`,`History truncated: ${funnel.historyTruncated}`,`History complete: ${funnel.historyOK} | completeness=${pct(funnel.historyOK/Math.max(1,funnel.historyOK+funnel.historyTruncated)*100,0)}`,`429-affected histories: ${funnel.history429}`,`Other incomplete histories: ${funnel.historyOtherIncomplete}`,`Closed trades >=${MEME_MIN_TRADES}: ${funnel.closedTradesEnough}`,`Meme trades >=${MEME_MIN_TRADES}: ${funnel.memeTradesPass}`,`Meme exposure >=${MEME_MIN_EXPOSURE}%: ${funnel.exposurePass}`,`Unique memes >=${MEME_MIN_UNIQUE}: ${funnel.uniquePass}`,`FINAL SPECIALISTS: ${funnel.specialists}`,'','🧬 MEME CLASSIFIER COVERAGE',`Known meme symbols: ${classifierAudit.knownMemeSymbols}`,`Observed symbols: ${classifierAudit.observedSymbols}`,`Confirmed meme symbols: ${classifierAudit.classifiedSymbols}`,`Probable meme symbols: ${classifierAudit.probableSymbols}`,`Explicit non-meme symbols: ${classifierAudit.nonMemeSymbols}`,`Unknown symbols: ${classifierAudit.unclassifiedSymbols}`,`Confirmed meme trades: ${classifierAudit.classifiedTradeCount}`,`Probable meme trades: ${classifierAudit.probableTradeCount}`,`Explicit non-meme trades: ${classifierAudit.nonMemeTradeCount}`,`Unknown trades: ${classifierAudit.unclassifiedTradeCount}`,`Classifier classified trade coverage: ${classifierAudit.classifiedTradeCount+classifierAudit.probableTradeCount+classifierAudit.nonMemeTradeCount}/${classifierAudit.classifiedTradeCount+classifierAudit.probableTradeCount+classifierAudit.nonMemeTradeCount+classifierAudit.unclassifiedTradeCount} (${pct((classifierAudit.classifiedTradeCount+classifierAudit.probableTradeCount+classifierAudit.nonMemeTradeCount)/Math.max(1,classifierAudit.classifiedTradeCount+classifierAudit.probableTradeCount+classifierAudit.nonMemeTradeCount+classifierAudit.unclassifiedTradeCount)*100,1)})`];
  if(classifierAudit.topClassified.length){lines.push('Confirmed:');classifierAudit.topClassified.slice(0,8).forEach((x,i)=>lines.push(`#${i+1} ${x.coin} — ${x.trades} trades`));}
  if(classifierAudit.topProbable.length){lines.push('Probable (diagnostic only):');classifierAudit.topProbable.slice(0,8).forEach((x,i)=>lines.push(`#${i+1} ${x.coin} — ${x.trades} trades | ${x.reason}`));}
  if(classifierAudit.topUnclassified.length){lines.push('Top unknown symbols:');classifierAudit.topUnclassified.slice(0,8).forEach((x,i)=>lines.push(`#${i+1} ${x.coin} — ${x.trades} trades`));}else lines.push('Top unknown symbols: none');
  if(classifierAudit.topNonMeme.length){lines.push('Explicit non-meme:');classifierAudit.topNonMeme.slice(0,6).forEach((x,i)=>lines.push(`#${i+1} ${x.coin} — ${x.trades} trades | ${x.reason}`));}
  lines.push('','🎯 SPECIALIST GATE',`Exposure >=${MEME_MIN_EXPOSURE}%: ${funnel.exposurePass}/${funnel.historyOK} pass`,`Meme trades >=${MEME_MIN_TRADES}: ${funnel.memeTradesPass}/${funnel.historyOK} pass`,`Unique memes >=${MEME_MIN_UNIQUE}: ${funnel.uniquePass}/${funnel.historyOK} pass`,`FINAL SPECIALISTS: ${funnel.specialists}`,'','🛡️ DATA QUALITY GATE',`Complete history required for specialist eligibility: ${MEME_REQUIRE_COMPLETE_HISTORY?'YES':'NO'}`,`Complete: ${funnel.historyOK} | Truncated: ${funnel.historyTruncated} | 429-affected: ${funnel.history429}`,'','🏆 TOP 5 MEME SPECIALISTS');
  if(!top.length){lines.push('No trader met all meme-specialist criteria in this scan.');}
  lines.push('',`🟠 MEME-FOCUS CANDIDATES (${focusTop.length})`,`Criteria: exposure>=${MEME_FOCUS_MIN_EXPOSURE}% | meme trades>=${MEME_FOCUS_MIN_TRADES} | unique memes>=${MEME_FOCUS_MIN_UNIQUE} | dominant<=${MEME_FOCUS_MAX_DOMINANT}% | spec>=20`);
  if(focusTop.length){focusTop.forEach((x,i)=>{const p=x.meme||{},e=x.early||{};lines.push(`#${i+1} ${x.address}`,`🧬 exposure=${pct(p.exposurePct,1)} | memeTrades=${p.memeTrades}/${p.totalTrades} | unique=${p.uniqueCoins}`,`🎯 dominant=${p.dominantMeme||'n/a'} (${p.dominantMemeTrades||0} trades) | focus=${x.memeFocusScore||0}/100`,`🚀 early=${e.score||0}/100 | hit +5=${pct(e.hit5,0)} | +10=${pct(e.hit10,0)} | +20=${pct(e.hit20,0)} | lead5=${fmt(e.medianLead5,1)}m`,`📊 quality=${x.qualityScore}/100`)});}else lines.push('None in this cycle.');
  lines.push('',`🟡 RESEARCH NEAR-MISSES (${researchTop.length})`,`Criteria: complete history | exposure>=${MEME_RESEARCH_MIN_EXPOSURE}% | meme trades>=${MEME_RESEARCH_MIN_TRADES} | unique memes>=${MEME_RESEARCH_MIN_UNIQUE}`);
  if(researchTop.length){researchTop.forEach((x,i)=>{const p=x.meme||{},e=x.early||{};lines.push(`#${i+1} ${x.address}`,`🧬 exposure=${pct(p.exposurePct,1)} | memeTrades=${p.memeTrades}/${p.totalTrades} | unique=${p.uniqueCoins}`,`🎯 dominant=${p.dominantMeme||'n/a'} (${p.dominantMemeTrades||0} trades, ${pct(x.dominantPct,1)}% of meme trades) | research=${x.researchScore||0}/100`,`🚀 early=${e.score||0}/100 | hit +5=${pct(e.hit5,0)} | +10=${pct(e.hit10,0)} | +20=${pct(e.hit20,0)} | lead5=${fmt(e.medianLead5,1)}m`,`📊 quality=${x.qualityScore}/100`)});}else lines.push('None in this cycle.');
  lines.push('',`🟠 MEME-HEAVY DISCOVERY (${heavyTop.length})`,`Criteria: exposure>=${MEME_HEAVY_MIN_EXPOSURE}% | meme trades>=${MEME_HEAVY_MIN_TRADES} | unique memes>=${MEME_HEAVY_MIN_UNIQUE}`);
  if(heavyTop.length){heavyTop.forEach((x,i)=>{const p=x.meme||{};lines.push(`#${i+1} ${x.address}`,`🧬 exposure=${pct(p.exposurePct,1)} | memeTrades=${p.memeTrades}/${p.totalTrades} | unique=${p.uniqueCoins}`,`🎯 dominant=${p.dominantMeme||'n/a'} (${p.dominantMemeTrades||0} trades) | spec=${p.specializationScore||0}/100`)});}else lines.push('None in this cycle.');
  lines.push('',`🔵 SINGLE-MEME HEAVY (${singleTop.length})`,`Criteria: exposure>=${MEME_SINGLE_MIN_EXPOSURE}% | meme trades>=${MEME_SINGLE_MIN_TRADES} | unique memes=1`);
  if(singleTop.length){singleTop.forEach((x,i)=>{const p=x.meme||{};lines.push(`#${i+1} ${x.address}`,`🧬 exposure=${pct(p.exposurePct,1)} | memeTrades=${p.memeTrades}/${p.totalTrades} | unique=${p.uniqueCoins}`,`🎯 dominant=${p.dominantMeme||'n/a'} (${p.dominantMemeTrades||0} trades)`)});}else lines.push('None in this cycle.');
  if(!top.length && nearMisses.length){lines.push('','🟡 TOP NEAR-MISSES');nearMisses.forEach((x,i)=>{const p=x.meme||{};lines.push(`#${i+1} ${x.address}`,`🧬 exposure=${pct(p.exposurePct,1)} | memeTrades=${p.memeTrades||0}/${MEME_MIN_TRADES} | unique=${p.uniqueCoins||0}/${MEME_MIN_UNIQUE}`,`🔎 audit: ${p.memeTrades||0} meme / ${p.totalTrades||0} total | non-meme=${Math.max(0,Number(p.totalTrades||0)-Number(p.memeTrades||0))} | dominant=${p.dominantMeme||'n/a'} (${p.dominantMemeTrades||0})`,`📌 missing: ${[Number(p.exposurePct||0)<MEME_MIN_EXPOSURE?'EXPOSURE':'',Number(p.memeTrades||0)<MEME_MIN_TRADES?'MEME_TRADES':'',Number(p.uniqueCoins||0)<MEME_MIN_UNIQUE?'UNIQUE_MEMES':''].filter(Boolean).join(', ')||'none'}`)});}
  top.forEach((x,i)=>{
    const m=x.metrics,mp=x.meme,e=x.early,c=x.current;
    lines.push('',`#${i+1} ${x.address}`,`🧬 Meme exposure=${pct(mp.exposurePct,1)} | memeTrades=${mp.memeTrades}/${mp.totalTrades} | unique=${mp.uniqueCoins}`,`🎯 Dominant meme=${mp.dominantMeme||'n/a'} (${mp.dominantMemeTrades||0} trades)`,`📈 Meme WR=${pct(mp.memeWinRate,1)} | PF=${mp.memeProfitFactor===Infinity?'∞':fmt(mp.memeProfitFactor,2)} | PnL=${fmt(mp.memePnl)}`,`🎯 Specialization=${mp.specializationScore}/100 | Early-move edge=${e.score}/100 | Repeatability=${e.repeatability}/100`,`🚀 Pump edge=${e.pump}/100 | Dump edge=${e.dump}/100 | hit +5%=${pct(e.hit5,0)} | +10%=${pct(e.hit10,0)} | +20%=${pct(e.hit20,0)}`,`🕐 Median lead to +5%=${fmt(e.medianLead5,1)}m | MFE median=${pct(e.mfeMedian,1)}`,`📊 Overall quality=${x.qualityScore}/100 | 7D trades=${m.closedTrades} | WR=${pct(m.winRate,1)}`);
    if(c)lines.push(`📍 Current: ${c.coin} | ${c.side} | meme=${c.isMeme?'YES':'NO'} | entry=${fmt(c.entry)} | now=${fmt(c.mid)} | dist=${pct(c.distancePct,2)}`);else lines.push('📍 Current position: NONE');
  });
  lines.push('','📌 WATCHLIST EXPORT');
  const exportRows=top.length?top:focusTop;
  if(exportRows.length)lines.push(`HYPERLIQUID_MEME_WATCHLIST=${exportRows.map(x=>x.address).join(',')}`);else lines.push('HYPERLIQUID_MEME_WATCHLIST=');
  lines.push('','ℹ️ This score detects repeated historical early-move behavior; it does NOT establish advance knowledge of pumps/dumps.','ℹ️ Next monitoring cycle can run with HYPERLIQUID_MEME_MODE=watch and the five addresses above.','ℹ️ V5.34 canonicalizes quote-wrapped symbols (e.g. PURR/USDC → PURR). Probable/unknown symbols never count toward specialist eligibility.','ℹ️ Strict specialist eligibility remains unchanged: confirmed meme symbols + exposure + trade count + unique-meme breadth.','ℹ️ Meme-focus candidates are a separate research tier; Research Near-Misses are broader diagnostics and do not redefine strict specialists.','ℹ️ No orders are created by this worker.',`🕐 ${new Date().toISOString()}`);
  if(errors.length){lines.push('','🧪 SAMPLE ERRORS');errors.slice(0,8).forEach(e=>lines.push(`${short(e.address)} → ${e.cat} → ${String(e.message||'').slice(0,180)}`))}
  console.log(`[MEME-SCOUT V5.34][DONE] discovered=${d.discovered} scanned=${sourceAddresses.length} specialists=${scanned.length} top=${top.length} errors=${errors.length} seconds=${((Date.now()-t0)/1000).toFixed(1)}`);
  await telegram(lines.join('\n'));
}

main().catch(async e=>{console.error(`[MEME SCOUT V5.31][FATAL] ${e.stack||e}`);await telegram(`🟣 HYPERLIQUID TRADER MEME SCOUT V5.31\n📡 READ-ONLY | NO ORDERS\n━━━━━━━━━━━━━━━━━━\n💥 FATAL ERROR\n${String(e.message||e).slice(0,1000)}`);process.exitCode=1});
