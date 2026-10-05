import fs from 'node:fs/promises';
import path from 'node:path';

const VERSION='GFTSH-V2.0.0-GLOBAL-FUTURES-PRO-HUNTER';
const STATE_FILE=process.env.GLOBAL_STATE_FILE||'state/global_futures_hunter.json';
const CACHE_FILE=process.env.GLOBAL_CACHE_FILE||'state/global_futures_cache.json';
const TELEGRAM_TOKEN=process.env.TELEGRAM_TOKEN||'';
const TELEGRAM_CHAT_ID=process.env.TELEGRAM_CHAT_ID||'';

const LOOKBACK_MS=7*86400000;
const DISCOVERY_LIMIT=Number(process.env.GFTSH_DISCOVERY_LIMIT||400);
const HL_AUDIT_LIMIT=Number(process.env.GFTSH_HL_AUDIT_LIMIT||60);
const HL_POSITION_LIMIT=Number(process.env.GFTSH_HL_POSITION_LIMIT||14);
const VERIFY_CONCURRENCY=Number(process.env.GFTSH_VERIFY_CONCURRENCY||6);
const VERIFY_TIMEOUT_MS=Number(process.env.GFTSH_VERIFY_TIMEOUT_MS||10000);
const POSITION_TIMEOUT_MS=Number(process.env.GFTSH_POSITION_TIMEOUT_MS||7000);
const TOP_SIGNALS=Number(process.env.GFTSH_TOP_SIGNALS||10);
const TOP_WATCH=Number(process.env.GFTSH_TOP_WATCH||10);
const FRESH_MIN=Number(process.env.GFTSH_FRESH_MIN||15);
const ENTRY_MAX=Number(process.env.GFTSH_ENTRY_MAX_PCT||0.5);
const MODEL_SL_PCT=Number(process.env.GFTSH_MODEL_SL_PCT||0.5);
const MODEL_TP_R=Number(process.env.GFTSH_MODEL_TP_R||2);
const MAX_RETRIES=Number(process.env.GFTSH_MAX_RETRIES||1);
const CACHE_TTL_H=Number(process.env.GFTSH_DISCOVERY_CACHE_HOURS||12);
const VERIFIED_TTL_H=Number(process.env.GFTSH_VERIFIED_CACHE_HOURS||24);
const HL_REQ_GAP_MS=Number(process.env.GFTSH_HL_REQ_GAP_MS||90);
const HTTP_TIMEOUT=Number(process.env.GFTSH_HTTP_TIMEOUT_MS||10000);
const UA='Mozilla/5.0 (compatible; GFTSH/2.0; read-only)';
let HL_NEXT_REQ=0;

const VENUES={
 HYPERLIQUID:{label:'HYPERLIQUID',kind:'DEX',cap:'FULL_SIGNAL'},
 BINANCE:{label:'BINANCE',kind:'CEX',cap:'DISCOVERY'},
 OKX:{label:'OKX',kind:'CEX',cap:'DISCOVERY'},
 BYBIT:{label:'BYBIT',kind:'CEX',cap:'DISCOVERY'},
 BITGET:{label:'BITGET',kind:'CEX',cap:'DISCOVERY'},
 KUCOIN:{label:'KUCOIN',kind:'CEX',cap:'UNSUPPORTED'},GATE:{label:'GATE',kind:'CEX',cap:'UNSUPPORTED'},
 MEXC:{label:'MEXC',kind:'CEX',cap:'UNSUPPORTED'},PHEMEX:{label:'PHEMEX',kind:'CEX',cap:'UNSUPPORTED'},
 BINGX:{label:'BINGX',kind:'CEX',cap:'UNSUPPORTED'},COINEX:{label:'COINEX',kind:'CEX',cap:'UNSUPPORTED'},
 DYDX:{label:'DYDX',kind:'DEX',cap:'UNSUPPORTED'},PARADEX:{label:'PARADEX',kind:'DEX',cap:'UNSUPPORTED'}
};
function n(v,d=NaN){const x=Number(v);return Number.isFinite(x)?x:d}
function ok(v){return Number.isFinite(n(v))}
function pct(v,d=1){return ok(v)?`${n(v).toFixed(d)}%`:'—'}
function trunc(s,nc=18){s=String(s??'');return s.length>nc?s.slice(0,Math.ceil(nc/2))+'…'+s.slice(-Math.floor(nc/2)):s}
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
async function ensure(){await fs.mkdir(path.dirname(STATE_FILE),{recursive:true});await fs.mkdir(path.dirname(CACHE_FILE),{recursive:true})}
async function readJson(f,d){try{return JSON.parse(await fs.readFile(f,'utf8'))}catch{return d}}
async function writeJson(f,x){await fs.writeFile(f,JSON.stringify(x,null,2))}
async function rateGate(){const now=Date.now();const wait=Math.max(0,HL_NEXT_REQ-now);if(wait)await sleep(wait);HL_NEXT_REQ=Date.now()+HL_REQ_GAP_MS}
async function fetchText(url,opts={},timeout=HTTP_TIMEOUT){const c=new AbortController();const timer=setTimeout(()=>c.abort(),timeout);try{const r=await fetch(url,{...opts,signal:c.signal,headers:{accept:'application/json,text/html,*/*','user-agent':UA,...(opts.headers||{})}});const text=await r.text();if(!r.ok)throw new Error(`HTTP_${r.status}:${text.slice(0,180)}`);return text}finally{clearTimeout(timer)}}
async function fetchTextRetry(url,opts={},timeout=HTTP_TIMEOUT,kind='GEN'){let last='';for(let i=0;i<=MAX_RETRIES;i++){try{if(kind==='HL')await rateGate();return await fetchText(url,opts,timeout)}catch(e){last=String(e.message||e);if(i>=MAX_RETRIES)throw new Error(last);await sleep(300*(i+1))}}throw new Error(last||'REQUEST_FAILED')}
async function json(url,opts={}){const t=await fetchTextRetry(url,opts,HTTP_TIMEOUT,url.includes('hyperliquid.xyz')?'HL':'GEN');let x;try{x=JSON.parse(t)}catch{throw new Error(`NON_JSON:${t.slice(0,160)}`)}if(x&&x.code&&String(x.code)!=='0')throw new Error(`API_${x.code}:${x.msg||'API_ERROR'}`);return x}
async function postJson(url,body,timeout=HTTP_TIMEOUT){const t=await fetchTextRetry(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)},timeout,url.includes('hyperliquid.xyz')?'HL':'GEN');try{return JSON.parse(t)}catch{throw new Error(`NON_JSON:${t.slice(0,160)}`)}}
function arr(x){if(Array.isArray(x))return x;if(Array.isArray(x?.leaderboardRows))return x.leaderboardRows;if(Array.isArray(x?.data?.ranks))return x.data.ranks;if(Array.isArray(x?.data?.list))return x.data.list;if(Array.isArray(x?.data?.rows))return x.data.rows;if(Array.isArray(x?.data))return x.data.flatMap(v=>Array.isArray(v?.ranks)?v.ranks:Array.isArray(v?.list)?v.list:Array.isArray(v?.rows)?v.rows:(v&&typeof v==='object')?[v]:[]);if(Array.isArray(x?.result?.list))return x.result.list;if(Array.isArray(x?.list))return x.list;return []}
function first(o,ks){for(const k of ks){const v=n(o?.[k]);if(ok(v))return v}return NaN}
function normalized(source,id,name,stats={}){return{source,venue:VENUES[source]?.label||source,traderId:String(id),name:name||String(id),stats:{trades7d:first(stats,['trades7d']),activeDays:first(stats,['activeDays']),wr:first(stats,['wr']),pf:first(stats,['pf']),pnl7d:first(stats,['pnl7d']),dd:first(stats,['dd']),ddKnown:Boolean(stats.ddKnown),ddUsd:first(stats,['ddUsd']),avgHoldH:first(stats,['avgHoldH']),medianHoldH:first(stats,['medianHoldH']),roi7d:first(stats,['roi7d']),aum:first(stats,['aum']),dailyConsistency:first(stats,['dailyConsistency']),dailyLossRate:first(stats,['dailyLossRate'])},coverage:stats.coverage||'UNKNOWN',discoveredAt:Date.now()}}
function activityPerDay(t){const s=t.stats;return ok(s.trades7d)&&ok(s.activeDays)&&s.activeDays>0?s.trades7d/s.activeDays:NaN}
function dataCompleteness(t){const s=t.stats;const keys=['trades7d','activeDays','wr','pf','avgHoldH','medianHoldH'];return keys.filter(k=>ok(s[k])).length/keys.length}
function scoreRange(v,a,b){if(!ok(v))return 0;return Math.max(0,Math.min(1,(v-a)/(b-a)))}
function followScore(t){const s=t.stats,d=activityPerDay(t);let score=0;
 score+=25*scoreRange(s.wr,50,75);
 score+=22*scoreRange(s.pf,1,3.5);
 score+=18*scoreRange(d,2,25);
 score+=12*scoreRange(s.trades7d,30,200);
 score+=8*scoreRange(s.activeDays,3,7);
 score+=7*scoreRange(s.dailyConsistency,0.45,0.9);
 score+=5*(ok(s.ddKnown)?1-scoreRange(s.dd,15,40):0.5);
 score+=3*dataCompleteness(t);
 if(ok(s.medianHoldH))score+=Math.max(0,3-scoreRange(s.medianHoldH,4,24)*3);
 return Math.max(0,Math.min(100,score));}
function tier(t){const q=followScore(t),s=t.stats,d=activityPerDay(t);if(dataCompleteness(t)<0.65)return'UNVERIFIED';if(q>=82&&s.wr>=62&&s.pf>=2&&d>=6)return'S';if(q>=72&&s.wr>=57&&s.pf>=1.5&&d>=4)return'A';if(q>=60&&s.wr>=53&&s.pf>=1.2&&d>=2)return'B';return'C'}
function softReasons(t){const s=t.stats,d=activityPerDay(t),r=[];if(!ok(s.trades7d))r.push('NO_7D_TRADE_SAMPLE');else if(s.trades7d<25)r.push('LOW_7D_SAMPLE');if(!ok(s.activeDays)||s.activeDays<3)r.push('LOW_ACTIVE_DAYS');if(!ok(d)||d<2)r.push('LOW_DAILY_ACTIVITY');if(!ok(s.wr)||s.wr<53)r.push('HIGH_ERROR_RATE');if(!ok(s.pf)||s.pf<1.2)r.push('LOW_PF');if(ok(s.dd)&&s.dd>40)r.push('HIGH_DD');return r}
function positionGate(t){const p=t.position;if(!p)return['NO_CURRENT_POSITION'];const r=[];const activity=n(p.lastActivityAt,p.openedAt);const age=(Date.now()-activity)/60000;if(!ok(age)||age>FRESH_MIN)r.push(`STALE>${FRESH_MIN}M`);if(!ok(p.entry)||!ok(p.mark)||p.entry<=0)r.push('NO_ENTRY_MARK');else{p.distancePct=(p.mark-p.entry)/p.entry*100*(p.side==='SHORT'?-1:1);if(Math.abs(p.distancePct)>ENTRY_MAX)r.push(`ENTRY_DISTANCE>${ENTRY_MAX}%`)}if(!['LONG','SHORT'].includes(p.side))r.push('SIDE_UNKNOWN');const risk=p.entry*MODEL_SL_PCT/100;const reward=risk*MODEL_TP_R;p.sl=p.side==='LONG'?p.entry-risk:p.entry+risk;p.tp=p.side==='LONG'?p.entry+reward:p.entry-reward;p.rr=MODEL_TP_R;return r}
async function withTimeout(p,ms,label){let timer;try{return await Promise.race([p,new Promise((_,rej)=>timer=setTimeout(()=>rej(new Error(`TIMEOUT:${label}:${ms}ms`)),ms))])}finally{clearTimeout(timer)}}
async function mapBounded(items,limit,worker){const out=new Array(items.length);let cursor=0;const nw=Math.max(1,Math.min(limit,items.length));await Promise.all(Array.from({length:nw},async()=>{while(true){const i=cursor++;if(i>=items.length)break;try{out[i]=await worker(items[i],i)}catch(e){out[i]={...items[i],coverage:'VERIFY_ERROR',verifyError:String(e.message||e)}}}}));return out.filter(Boolean)}

async function hyperliquid(){const status={source:'HYPERLIQUID',class:'FULL_SIGNAL',state:'UNAVAILABLE',discovered:0,error:null};const out=[];try{const rows=arr(await json('https://stats-data.hyperliquid.xyz/Mainnet/leaderboard'));for(const x of rows.slice(0,DISCOVERY_LIMIT)){const id=x?.ethAddress||x?.address;if(!id)continue;const perf=new Map((x?.windowPerformances||[]).map(v=>[v?.[0],v?.[1]]));const w=perf.get('week')||{};out.push(normalized('HYPERLIQUID',id,x?.displayName||id,{pnl7d:n(w.pnl),roi7d:n(w.roi)*100,aum:n(x?.accountValue)}))}status.discovered=out.length;status.state=out.length?'OK':'EMPTY';return{status,out}}catch(e){status.error=String(e.message||e);return{status,out}}}

function hlStats(fills){
 const closes=fills.filter(f=>ok(f.closedPnl)&&Math.abs(n(f.closedPnl))>1e-12);
 const wins=closes.filter(f=>n(f.closedPnl)>0),loss=closes.filter(f=>n(f.closedPnl)<0);
 const gp=wins.reduce((a,f)=>a+n(f.closedPnl),0),gl=Math.abs(loss.reduce((a,f)=>a+n(f.closedPnl),0));
 const days=[...new Set(closes.map(f=>new Date(n(f.time)).toISOString().slice(0,10)))];
 const byDay=new Map();for(const f of closes){const d=new Date(n(f.time)).toISOString().slice(0,10);byDay.set(d,(byDay.get(d)||0)+n(f.closedPnl))}
 const dailyVals=[...byDay.values()];const dailyConsistency=dailyVals.length?dailyVals.filter(x=>x>0).length/dailyVals.length:NaN;const dailyLossRate=dailyVals.length?dailyVals.filter(x=>x<0).length/dailyVals.length:NaN;
 const holds=[];const queues=new Map();
 const sorted=[...fills].sort((a,b)=>n(a.time)-n(b.time));
 for(const f of sorted){const dir=String(f.dir||'').toLowerCase();const coin=f.coin;let side=dir.includes('long')?'LONG':dir.includes('short')?'SHORT':(dir.includes('sell')?'SHORT':'LONG');const isClose=dir.includes('close')||ok(f.closedPnl)&&Math.abs(n(f.closedPnl))>1e-12;const key=`${coin}|${side}`;if(!queues.has(key))queues.set(key,[]);if(isClose){const q=queues.get(key);const open=q.shift();if(ok(open))holds.push(Math.max(0,(n(f.time)-open)/3600000));}else queues.get(key).push(n(f.time))}
 const sh=holds.filter(ok).sort((a,b)=>a-b);const median=sh.length?sh[Math.floor((sh.length-1)/2)]:NaN;
 let eq=0,peak=0,maxDrop=0;for(const f of closes){eq+=n(f.closedPnl);peak=Math.max(peak,eq);maxDrop=Math.max(maxDrop,peak-eq)}
 // This is a PnL-curve drawdown in USD, not account-equity DD. Do not label it as true account DD.
 const ddPct=gp+gl>0?maxDrop/(gp+gl)*100:NaN;
 return{trades7d:closes.length,activeDays:days.length,wr:closes.length?wins.length/closes.length*100:NaN,pf:gl?gp/gl:(gp>0?Infinity:NaN),avgHoldH:sh.length?sh.reduce((a,b)=>a+b,0)/sh.length:NaN,medianHoldH:median,dd:ddPct,ddUsd:maxDrop,ddKnown:false,dailyConsistency,dailyLossRate};
}
async function hlVerifyInner(t){const end=Date.now(),start=end-LOOKBACK_MS;const fills=await postJson('https://api.hyperliquid.xyz/info',{type:'userFillsByTime',user:t.traderId,startTime:start,endTime:end},VERIFY_TIMEOUT_MS);const fs=Array.isArray(fills)?fills:[];if(!fs.length){t.coverage='VERIFY_EMPTY';t.verifyError='HL_NO_FILLS_7D';return t}t.stats={...t.stats,...hlStats(fs)};t.coverage='COMPLETE';t.audit={fills7d:fs.length,verifiedAt:Date.now()};t.tier=tier(t);t.followScore=followScore(t);t.audit.sampleQuality=dataCompleteness(t);return t}
async function hlVerify(t){try{return await withTimeout(hlVerifyInner(t),VERIFY_TIMEOUT_MS,'HL_STATS')}catch(e){t.coverage='VERIFY_ERROR';t.verifyError='HL:'+String(e.message||e);return t}}
async function hlPosition(t){try{const state=await withTimeout(postJson('https://api.hyperliquid.xyz/info',{type:'clearinghouseState',user:t.traderId},POSITION_TIMEOUT_MS),POSITION_TIMEOUT_MS,'HL_POS');const positions=(state?.assetPositions||[]).map(x=>x?.position).filter(Boolean);let best=null;for(const p of positions){const sz=n(p?.szi);if(!sz)continue;const side=sz>0?'LONG':'SHORT',symbol=p?.coin||'',entry=n(p?.entryPx),mark=n(p?.markPx);if(!ok(entry)||!ok(mark)||!symbol)continue;const fills=t._fills||[];const recent=fills.filter(f=>f?.coin===symbol).sort((a,b)=>n(b?.time)-n(a?.time));const last=recent[0];const candidate={symbol,side,entry,mark,size:Math.abs(sz),openedAt:n(p?.timestamp,Date.now()),lastActivityAt:n(last?.time,n(p?.timestamp,Date.now())),source:'HYPERLIQUID'};if(!best||candidate.lastActivityAt>best.lastActivityAt)best=candidate}t.position=best;t.audit={...(t.audit||{}),currentPositions:positions.length,positionCheckedAt:Date.now()};return t}catch(e){t.positionError='HL_POS:'+String(e.message||e);return t}}

async function binance(){const status={source:'BINANCE',class:'DISCOVERY',state:'UNAVAILABLE',discovered:0,error:null};const out=new Map();const url='https://www.binance.com/bapi/futures/v1/friendly/future/copy-trade/home-page/query-list';try{for(const dataType of ['ROI','PNL','MDD']){const x=await postJson(url,{pageNumber:1,pageSize:100,timeRange:'90D',dataType,favoriteOnly:false,hideFull:false,nickname:'',order:'DESC',apiKeyOnly:false});for(const r of arr(x)){const id=r?.leadPortfolioId||r?.portfolioId;if(!id)continue;out.set(String(id),normalized('BINANCE',id,r?.nickname||r?.nickName||id,{trades7d:first(r,['tradeCount7d','tradeCount7dTotal','totalPositions']),activeDays:first(r,['activeDays','daysTrading']),wr:first(r,['winRate']),pf:first(r,['profitFactor']),pnl7d:first(r,['pnl7d','pnl']),dd:first(r,['mdd','maxDrawdown','maxDrawdownRate']),roi7d:first(r,['roi7d','roi']),aum:first(r,['aum','totalAssets']),coverage:'PARTIAL'}))}if(out.size>=DISCOVERY_LIMIT)break}const list=[...out.values()].slice(0,DISCOVERY_LIMIT);status.discovered=list.length;status.state=list.length?'OK':'EMPTY';if(!list.length)status.error='BINANCE_NO_PUBLIC_PORTFOLIOS';return{status,out:list}}catch(e){status.error='BINANCE:'+String(e.message||e);return{status,out:[]}}}
function parseEmbedded(html,source){const found=new Map(),patterns=source==='BYBIT'?[/(?:uid|userId|masterTraderId)"?\s*:\s*"?([A-Za-z0-9_-]{5,})/g]:[/(?:traderId|uid|userId|projectId)"?\s*:\s*"?([A-Za-z0-9_-]{5,})/g];for(const re of patterns){let m;while((m=re.exec(html))){const id=m[1],chunk=html.slice(Math.max(0,m.index-1200),Math.min(html.length,m.index+2500));const name=(chunk.match(/"(?:nickName|nickname|traderName|displayName)"\s*:\s*"([^"]+)/)||[])[1]||id;found.set(id,normalized(source,id,name,{}))}}return[...found.values()]}
async function webDiscovery(source,url){const status={source,class:'DISCOVERY',state:'UNAVAILABLE',discovered:0,error:null};try{const html=await fetchTextRetry(url,{},HTTP_TIMEOUT);const out=parseEmbedded(html,source).slice(0,DISCOVERY_LIMIT);status.discovered=out.length;status.state=out.length?'OK':'EMPTY';if(!out.length)status.error='PUBLIC_PAGE_NO_MACHINE_READABLE_TRADER_IDS';return{status,out}}catch(e){status.error=String(e.message||e);return{status,out:[]}}}
async function bybit(){return webDiscovery('BYBIT','https://www.bybit.com/copyTrading/en/leader-board')}
async function bitget(){return webDiscovery('BITGET','https://www.bitget.com/copy-trading/futures')}
async function okx(){const status={source:'OKX',class:'DISCOVERY',state:'UNAVAILABLE',discovered:0,error:null},seen=new Map();const bases=['https://eea.okx.com','https://openapi.okx.com'];let lastErr='';try{for(const base of bases){try{for(const sortType of ['overview','pnl','aum','win_ratio']){for(let page=1;page<=4;page++){const u=`${base}/api/v5/copytrading/public-lead-traders?instType=SWAP&sortType=${sortType}&state=0&minLeadDays=1&page=${page}&limit=20`;const x=await json(u);for(const r of arr(x)){const id=r?.uniqueCode||r?.traderId||r?.uid;if(!id)continue;const wrRaw=first(r,['winRatio','winRate','winRatePct']);seen.set(String(id),normalized('OKX',id,r?.nickName||r?.nickNameEn||r?.displayName||id,{wr:ok(wrRaw)?(wrRaw<=1?wrRaw*100:wrRaw):NaN,pnl7d:first(r,['pnl','pnl7d','profit']),roi7d:first(r,['pnlRatio','roi','roi7d']),aum:first(r,['aum','aumValue']),daysTrading:first(r,['leadDays','daysTrading']),activeDays:first(r,['leadDays','daysTrading']),coverage:'DISCOVERY_ONLY'}))}if(seen.size>=DISCOVERY_LIMIT)break}if(seen.size>=DISCOVERY_LIMIT)break}if(seen.size)break}catch(e){lastErr=String(e.message||e)}}const out=[...seen.values()].slice(0,DISCOVERY_LIMIT);status.discovered=out.length;status.state=out.length?'OK':'EMPTY';if(!out.length)status.error=lastErr?`OKX:${lastErr}`:'OKX_NO_PUBLIC_LEAD_TRADERS';return{status,out}}catch(e){status.error='OKX:'+String(e.message||e);return{status,out:[]}}}

async function cacheLoad(){return await readJson(CACHE_FILE,{version:VERSION,sources:{},verified:{}})}
async function cacheSave(c){await writeJson(CACHE_FILE,c)}
function mergeCachedDiscovery(result,cache){const s=result.status;if(result.out.length){cache.sources[s.source]={savedAt:Date.now(),items:result.out};return result}const old=cache.sources?.[s.source];if(old?.items?.length&&(Date.now()-n(old.savedAt))/3600000<=CACHE_TTL_H){s.state='CACHE';s.error=(s.error?s.error+' | ':'')+'USING_LAST_GOOD_DISCOVERY';return{status:s,out:old.items.map(x=>({...x,fromCache:true}))}}return result}
async function unsupported(source){return{status:{source,class:'UNSUPPORTED',state:'UNSUPPORTED',discovered:0,error:'NO_VERIFIED_PUBLIC_READ_ONLY_TRADER_DISCOVERY'},out:[]}}
function candidatePool(all,cache){const hl=all.filter(t=>t.source==='HYPERLIQUID');const buckets=[];const pushTop=(arr,k)=>{for(const t of [...arr].sort((a,b)=>k(b)-k(a)).slice(0,25))if(!buckets.some(x=>x.traderId===t.traderId))buckets.push(t)};pushTop(hl,t=>n(t.stats.pnl7d,0));pushTop(hl,t=>n(t.stats.roi7d,0));pushTop(hl,t=>n(t.stats.aum,0));const cached=Object.values(cache.verified||{}).map(x=>x.item).filter(Boolean).filter(t=>t.source==='HYPERLIQUID');pushTop(cached,t=>n(t.followScore,0));pushTop(hl,t=>n(t.stats.trades7d,0));pushTop(hl,t=>n(t.stats.activeDays,0));const fresh=hl.filter(t=>!buckets.some(x=>x.traderId===t.traderId));for(const t of fresh.slice(0,HL_AUDIT_LIMIT*2))buckets.push(t);return buckets.slice(0,HL_AUDIT_LIMIT)}
function shouldRefreshVerified(v){return !v||!v.item||Date.now()-n(v.savedAt)>VERIFIED_TTL_H*3600000}
function watchCandidates(cache){return Object.values(cache.verified||{}).map(x=>x.item).filter(t=>t?.coverage==='COMPLETE').sort((a,b)=>followScore(b)-followScore(a)).slice(0,HL_POSITION_LIMIT)}
function cleanForCache(t){const x={...t};delete x._fills;delete x.position;return x}
async function telegram(text){if(!TELEGRAM_TOKEN||!TELEGRAM_CHAT_ID){console.log('[TELEGRAM] skipped: missing credentials');return}try{const raw=await fetchText(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:TELEGRAM_CHAT_ID,text,disable_web_page_preview:true})});const x=JSON.parse(raw);if(!x.ok)throw new Error(`TELEGRAM_API:${x.error_code||''}:${x.description||'unknown'}`);console.log('[TELEGRAM] sent')}catch(e){console.log('[TELEGRAM]',e.message)}}
function report(statuses,all,watch,signals,blocked,runtime,stats){
 const full=statuses.filter(s=>s.class==='FULL_SIGNAL'&&['OK','CACHE'].includes(s.state)).length;
 const disc=statuses.filter(s=>s.class==='DISCOVERY'&&['OK','CACHE'].includes(s.state)).length;
 const uns=statuses.filter(s=>s.state==='UNSUPPORTED').length;
 const L=[
  '🌐 GLOBAL FUTURES PRO HUNTER',
  `🧠 ${VERSION}`,
  '📡 READ-ONLY | NO ORDERS | NO AUTO-COPY | FUTURES ONLY',
  '━━━━━━━━━━━━━━━━━━',
  `🔎 Full-signal: ${full}/${statuses.length} | Discovery: ${disc}/${statuses.length} | Unsupported: ${uns}/${statuses.length}`,
  `👥 Discovered: ${all.length} | HL audit: ${stats.audit} | Complete: ${stats.complete} | Errors: ${stats.errors} | Watch: ${watch.length} | Actionable: ${signals.length}/${TOP_SIGNALS}`,
  '🧠 FOLLOW SCORE: activity + WR + PF + consistency + sample + DD-quality',
  '🎯 TIERS: S≥82 | A≥72 | B≥60 | C<60 | UNVERIFIED=data insufficient',
  `⚡ SIGNAL: last activity≤${FRESH_MIN}m | entry≤${ENTRY_MAX}% | model SL=${MODEL_SL_PCT}% | TP=${MODEL_TP_R}R`,
  `⏱ Runtime: ${runtime.toFixed(1)}s`, '', '📡 SOURCE STATUS'
 ];
 for(const s of statuses)L.push(`${s.source}: ${s.state} | ${s.class} | discovered=${s.discovered}${s.error?' | '+s.error.slice(0,110):''}`);
 L.push('', '👑 GLOBAL FOLLOW WATCHLIST');
 if(watch.length){
  watch.slice(0,TOP_WATCH).forEach((t,i)=>{
   const s=t.stats,d=activityPerDay(t);
   L.push(`${i+1}. ${t.venue} ${trunc(t.name,20)} | ${t.tier}-TIER | Score ${followScore(t).toFixed(1)} | 7D ${ok(s.trades7d)?s.trades7d:'—'} | ${ok(d)?d.toFixed(1):'—'}/day | WR ${pct(s.wr)} | PF ${ok(s.pf)?s.pf.toFixed(2):'—'} | DDcurve ${pct(s.dd)}`);
  });
 } else L.push('No verified follow candidates yet.');
 L.push('', '🔥 ACTIONABLE NOW');
 if(signals.length){
  signals.slice(0,TOP_SIGNALS).forEach((t,i)=>{
   const p=t.position,s=t.stats,d=activityPerDay(t);
   L.push(`${i+1}. ${t.venue} ${trunc(t.name)} | ${t.tier}-TIER ${t.followScore.toFixed(1)} | ${p.side} ${p.symbol} | Entry ${p.entry} | Now ${p.mark} | Dist ${pct(p.distancePct)} | Age ${((Date.now()-p.lastActivityAt)/60000).toFixed(1)}m | WR ${pct(s.wr)} | ${d.toFixed(1)}/day | PF ${s.pf.toFixed(2)} | SL ${p.sl.toFixed(6)} | TP ${p.tp.toFixed(6)} | RR ${p.rr.toFixed(2)}`);
  });
 } else L.push('No verified trader has a fresh, copyable-quality current position this cycle.');
 L.push('', '🧱 TOP WATCH / BLOCK REASONS');
 blocked.slice(0,10).forEach(t=>L.push(`${t.venue} ${trunc(t.name,20)} | ${t.tier||'—'} | Score ${ok(t.followScore)?t.followScore.toFixed(1):'—'} | ${t.reasons.join(' | ')}`));
 L.push('', 'ℹ️ Discovery-only venues remain monitored but never become actionable without independently verified public position data.');
 return L.join('\n');
}

async function main(){const started=Date.now();await ensure();console.log(`GFTSH ${VERSION} | READ-ONLY | FUTURES ONLY`);const cache=await cacheLoad();const fns=[hyperliquid,binance,okx,bybit,bitget,()=>unsupported('KUCOIN'),()=>unsupported('GATE'),()=>unsupported('MEXC'),()=>unsupported('PHEMEX'),()=>unsupported('BINGX'),()=>unsupported('COINEX'),()=>unsupported('DYDX'),()=>unsupported('PARADEX')];const results=[];for(const fn of fns){let r;try{r=await fn()}catch(e){r={status:{source:'UNKNOWN',class:'DISCOVERY',state:'UNAVAILABLE',discovered:0,error:String(e.message||e)},out:[]}}results.push(mergeCachedDiscovery(r,cache));await sleep(20)}const map=new Map();for(const r of results)for(const t of r.out){const k=`${t.source}:${t.traderId}`;if(!map.has(k))map.set(k,t)}const all=[...map.values()];const pool=candidatePool(all,cache);const audited=await mapBounded(pool,VERIFY_CONCURRENCY,hlVerify);const complete=audited.filter(t=>t.coverage==='COMPLETE');const errors=audited.filter(t=>t.coverage==='VERIFY_ERROR').length;
 // Persist verified stats first; this is the key to making 5-minute cycles cumulative rather than stateless.
 cache.verified=cache.verified||{};for(const t of complete){const c=cleanForCache(t);cache.verified[`HYPERLIQUID:${t.traderId}`]={savedAt:Date.now(),item:c}}
 // Merge fresh audit results with older verified candidates so the watchlist survives rotating audits.
 const verifiedItems=Object.values(cache.verified).map(x=>x.item).filter(t=>t?.coverage==='COMPLETE');
 verifiedItems.sort((a,b)=>followScore(b)-followScore(a));
 const watch=verifiedItems.slice(0,TOP_WATCH);
 const positionTargets=verifiedItems.slice(0,HL_POSITION_LIMIT);
 const positioned=await mapBounded(positionTargets,Math.max(1,Math.min(VERIFY_CONCURRENCY,4)),async t=>{const key=`HYPERLIQUID:${t.traderId}`;const fresh=cache.verified[key]?.item?{...cache.verified[key].item}:t;fresh._fills=undefined;const end=Date.now(),start=end-LOOKBACK_MS;try{const fills=await postJson('https://api.hyperliquid.xyz/info',{type:'userFillsByTime',user:fresh.traderId,startTime:start,endTime:end},VERIFY_TIMEOUT_MS);fresh._fills=Array.isArray(fills)?fills:[];}catch{}return hlPosition(fresh)});
 const signals=[];for(const t of positioned){t.gate=softReasons(t);t.positionGate=positionGate(t);if((t.tier==='S'||t.tier==='A')&&t.position&&t.positionGate.length===0)signals.push(t)}signals.sort((a,b)=>followScore(b)-followScore(a));
 const blocked=verifiedItems.map(t=>({venue:t.venue,name:t.name,tier:t.tier,followScore:followScore(t),reasons:[...softReasons(t),...(t.positionGate||[])]}));
 const statuses=results.map(r=>r.status);const text=report(statuses,all,watch,signals,blocked,(Date.now()-started)/1000,{audit:pool.length,complete:complete.length,errors});console.log(text);
 const sourceCache={};for(const r of results)sourceCache[r.status.source]={savedAt:Date.now(),items:r.out};cache.sources=sourceCache;cache.version=VERSION;cache.generatedAt=Date.now();await cacheSave(cache);
 await writeJson(STATE_FILE,{version:VERSION,updatedAt:Date.now(),statuses,discovered:all.length,auditCandidates:pool.length,audited:audited.length,complete:complete.length,errors,watchlist:watch.map(cleanForCache),actionable:signals.slice(0,TOP_SIGNALS).map(cleanForCache)});await telegram(text)}
main().catch(e=>{console.error('[FATAL]',e);process.exitCode=1});
