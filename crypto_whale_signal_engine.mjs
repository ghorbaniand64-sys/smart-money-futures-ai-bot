import fs from 'node:fs/promises';
import path from 'node:path';

const VERSION='GFTSH-V1.6.0-GLOBAL-FUTURES-RATE-LIMIT-AUDIT';
const STATE_FILE=process.env.GLOBAL_STATE_FILE||'state/global_futures_hunter.json';
const CACHE_FILE=process.env.GLOBAL_CACHE_FILE||'state/global_futures_cache.json';
const TELEGRAM_TOKEN=process.env.TELEGRAM_TOKEN||'';
const TELEGRAM_CHAT_ID=process.env.TELEGRAM_CHAT_ID||'';
const LOOKBACK_MS=7*86400000;
const DISCOVERY_LIMIT=Number(process.env.GFTSH_DISCOVERY_LIMIT||400);
const VERIFY_LIMIT=Number(process.env.GFTSH_VERIFY_LIMIT||240);
const HL_VERIFY_LIMIT=Number(process.env.GFTSH_HL_VERIFY_LIMIT||120);
const OKX_VERIFY_LIMIT=Number(process.env.GFTSH_OKX_VERIFY_LIMIT||120);
const TOP_SIGNALS=Number(process.env.GFTSH_TOP_SIGNALS||10);
const FRESH_MIN=Number(process.env.GFTSH_FRESH_MIN||15);
const ENTRY_MAX=Number(process.env.GFTSH_ENTRY_MAX_PCT||0.5);
const MIN_RR=Number(process.env.GFTSH_MIN_RR||1.5);
const MODEL_SL_PCT=Number(process.env.GFTSH_MODEL_SL_PCT||0.5);
const MODEL_TP_R=Number(process.env.GFTSH_MODEL_TP_R||2);
const MIN_TRADES=Number(process.env.GFTSH_MIN_7D_TRADES||30);
const MIN_DAYS=Number(process.env.GFTSH_MIN_ACTIVE_DAYS||4);
const MIN_WR=Number(process.env.GFTSH_MIN_WR||55);
const MIN_PF=Number(process.env.GFTSH_MIN_PF||1.5);
const MAX_MEDIAN_H=Number(process.env.GFTSH_MAX_MEDIAN_HOURS||4);
const MAX_AVG_H=Number(process.env.GFTSH_MAX_AVG_HOURS||8);
const MAX_DD=Number(process.env.GFTSH_MAX_DD||40);
const HTTP_TIMEOUT=Number(process.env.GFTSH_HTTP_TIMEOUT_MS||15000);
const HL_REQ_GAP_MS=Number(process.env.GFTSH_HL_REQ_GAP_MS||120);
const OKX_REQ_GAP_MS=Number(process.env.GFTSH_OKX_REQ_GAP_MS||450);
const MAX_RETRIES=Number(process.env.GFTSH_MAX_RETRIES||3);
let HL_NEXT_REQ=0, OKX_NEXT_REQ=0;
async function rateGate(kind,gap){const now=Date.now();let next=kind==='HL'?HL_NEXT_REQ:OKX_NEXT_REQ;const wait=Math.max(0,next-now);if(wait>0)await sleep(wait);const stamp=Date.now()+gap;if(kind==='HL')HL_NEXT_REQ=stamp;else OKX_NEXT_REQ=stamp;}
async function fetchTextRetry(url,opts={},kind='GEN'){let last='';for(let i=0;i<=MAX_RETRIES;i++){try{if(kind==='HL')await rateGate('HL',HL_REQ_GAP_MS);else if(kind==='OKX')await rateGate('OKX',OKX_REQ_GAP_MS);const c=new AbortController(),t=setTimeout(()=>c.abort(),HTTP_TIMEOUT);try{const r=await fetch(url,{...opts,signal:c.signal,headers:{accept:'application/json,text/html,*/*','user-agent':UA,...(opts.headers||{})}});const text=await r.text();if(r.ok)return text;last=`HTTP_${r.status}:${text.slice(0,240)}`;const retryable=[408,425,429,500,502,503,504].includes(r.status);if(!retryable||i>=MAX_RETRIES)throw new Error(last);const ra=Number(r.headers.get('retry-after')||0);await sleep(Math.max(ra*1000,300*(i+1)));}finally{clearTimeout(t)}}catch(e){last=String(e.message||e);if(i>=MAX_RETRIES)throw new Error(last);await sleep(350*(i+1));}}throw new Error(last||'REQUEST_FAILED')}

const CACHE_TTL_H=Number(process.env.GFTSH_DISCOVERY_CACHE_HOURS||12);
const UA='Mozilla/5.0 (compatible; GFTSH/1.2; +https://github.com/)';

const VENUES={
 HYPERLIQUID:{label:'HYPERLIQUID',kind:'DEX',cap:'FULL_SIGNAL'},
 BINANCE:{label:'BINANCE',kind:'CEX',cap:'DISCOVERY'},
 OKX:{label:'OKX',kind:'CEX',cap:'FULL_SIGNAL'},
 BYBIT:{label:'BYBIT',kind:'CEX',cap:'DISCOVERY'},
 BITGET:{label:'BITGET',kind:'CEX',cap:'DISCOVERY'},
 KUCOIN:{label:'KUCOIN',kind:'CEX',cap:'UNSUPPORTED'},
 GATE:{label:'GATE',kind:'CEX',cap:'UNSUPPORTED'},
 MEXC:{label:'MEXC',kind:'CEX',cap:'UNSUPPORTED'},
 PHEMEX:{label:'PHEMEX',kind:'CEX',cap:'UNSUPPORTED'},
 BINGX:{label:'BINGX',kind:'CEX',cap:'UNSUPPORTED'},
 COINEX:{label:'COINEX',kind:'CEX',cap:'UNSUPPORTED'},
 DYDX:{label:'DYDX',kind:'DEX',cap:'UNSUPPORTED'},
 PARADEX:{label:'PARADEX',kind:'DEX',cap:'UNSUPPORTED'}
};
function n(v,d=NaN){const x=Number(v);return Number.isFinite(x)?x:d}
function ok(v){return Number.isFinite(n(v))}
function pct(v,d=2){return ok(v)?`${n(v).toFixed(d)}%`:'—'}
function trunc(s,nc=18){s=String(s??'');return s.length>nc?s.slice(0,Math.ceil(nc/2))+'…'+s.slice(-Math.floor(nc/2)):s}
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
async function ensure(){await fs.mkdir(path.dirname(STATE_FILE),{recursive:true});await fs.mkdir(path.dirname(CACHE_FILE),{recursive:true})}
async function readJson(f,d){try{return JSON.parse(await fs.readFile(f,'utf8'))}catch{return d}}
async function writeJson(f,x){await fs.writeFile(f,JSON.stringify(x,null,2))}
async function fetchText(url,opts={}){return fetchTextRetry(url,opts,'GEN')}
async function json(url,opts={}){const kind=url.includes('hyperliquid.xyz')?'HL':url.includes('okx.com/api/')?'OKX':'GEN';const t=await fetchTextRetry(url,opts,kind);try{const x=JSON.parse(t);if(x&&x.code&&String(x.code)!=='0')throw new Error(`API_${x.code}:${x.msg||'OKX_ERROR'}`);return x}catch(e){if(String(e.message||e).startsWith('API_'))throw e;throw new Error(`NON_JSON:${t.slice(0,180)}`)}}
async function postJson(url,body){const kind=url.includes('hyperliquid.xyz')?'HL':'GEN';const t=await fetchTextRetry(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)},kind);try{return JSON.parse(t)}catch{throw new Error(`NON_JSON:${t.slice(0,180)}`)}}
function arr(x){
  if(Array.isArray(x))return x;
  if(Array.isArray(x?.leaderboardRows))return x.leaderboardRows;
  if(Array.isArray(x?.data?.ranks))return x.data.ranks;
  if(Array.isArray(x?.data?.list))return x.data.list;
  if(Array.isArray(x?.data?.rows))return x.data.rows;
  if(Array.isArray(x?.data))return x.data.flatMap(v=>{
    if(Array.isArray(v?.ranks))return v.ranks;
    if(Array.isArray(v?.list))return v.list;
    if(Array.isArray(v?.rows))return v.rows;
    return (v&&typeof v==='object')?[v]:[];
  });
  if(Array.isArray(x?.result?.list))return x.result.list;
  if(Array.isArray(x?.list))return x.list;
  return [];
}
function first(o,ks){for(const k of ks){const v=n(o?.[k]);if(ok(v))return v}return NaN}
function normalized(source,id,name,stats={},position=null){return {source,venue:VENUES[source]?.label||source,traderId:String(id),name:name||String(id),stats:{trades7d:first(stats,['trades7d']),activeDays:first(stats,['activeDays']),wr:first(stats,['wr']),pf:first(stats,['pf']),pnl7d:first(stats,['pnl7d']),dd:first(stats,['dd']),avgHoldH:first(stats,['avgHoldH']),medianHoldH:first(stats,['medianHoldH']),roi7d:first(stats,['roi7d']),aum:first(stats,['aum']),daysTrading:first(stats,['daysTrading'])},coverage:stats.coverage||'UNKNOWN',position,discoveredAt:Date.now()}}
function gate(t){const s=t.stats,r=[];if(t.coverage==='PARTIAL')r.push('DATA_COVERAGE_PARTIAL');if(t.coverage==='UNKNOWN'&&t.source!=='HYPERLIQUID')r.push('DATA_COVERAGE_UNKNOWN');if(!ok(s.trades7d)||s.trades7d<MIN_TRADES)r.push(`TRADES_7D<${MIN_TRADES}`);if(!ok(s.activeDays)||s.activeDays<MIN_DAYS)r.push(`ACTIVE_DAYS<${MIN_DAYS}`);if(!ok(s.wr)||s.wr<MIN_WR)r.push(`WR<${MIN_WR}%`);if(!ok(s.pf)||s.pf<MIN_PF)r.push(`PF<${MIN_PF}`);if(ok(s.medianHoldH)&&s.medianHoldH>MAX_MEDIAN_H)r.push(`MEDIAN_HOLD>${MAX_MEDIAN_H}H`);if(ok(s.avgHoldH)&&s.avgHoldH>MAX_AVG_H)r.push(`AVG_HOLD>${MAX_AVG_H}H`);if(ok(s.dd)&&s.dd>MAX_DD)r.push(`DD>${MAX_DD}%`);return r}
function score(t){const s=t.stats;return (ok(s.pf)?Math.min(s.pf,8)*20:0)+(ok(s.wr)?Math.max(0,Math.min(45,s.wr-50)):0)+(ok(s.trades7d)?Math.min(s.trades7d,150)/5:0)+(ok(s.pnl7d)?Math.max(-20,Math.min(20,s.pnl7d/1000)):0)-(ok(s.dd)?Math.min(s.dd,40)*.5:20)-(ok(s.medianHoldH)?Math.min(s.medianHoldH,12):0)}
function positionGate(t){const p=t.position;if(!p)return ['NO_CURRENT_POSITION'];const r=[];const age=(Date.now()-n(p.openedAt))/60000;if(!ok(age)||age>FRESH_MIN)r.push(`STALE>${FRESH_MIN}M`);if(!ok(p.entry)||!ok(p.mark)||p.entry<=0)r.push('NO_ENTRY_MARK');else{p.distancePct=(p.mark-p.entry)/p.entry*100*(p.side==='SHORT'?-1:1);if(Math.abs(p.distancePct)>ENTRY_MAX)r.push(`ENTRY_DISTANCE>${ENTRY_MAX}%`)}if(!['LONG','SHORT'].includes(p.side))r.push('SIDE_UNKNOWN');const risk=p.entry*MODEL_SL_PCT/100;const reward=risk*MODEL_TP_R;p.sl=p.side==='LONG'?p.entry-risk:p.entry+risk;p.tp=p.side==='LONG'?p.entry+reward:p.entry-reward;p.rr=MODEL_TP_R;return r}

async function hyperliquid(){const status={source:'HYPERLIQUID',class:'FULL_SIGNAL',state:'UNAVAILABLE',discovered:0,error:null};const out=[];try{const lb=await json('https://stats-data.hyperliquid.xyz/Mainnet/leaderboard');const rows=arr(lb);for(const x of rows.slice(0,DISCOVERY_LIMIT)){const id=x?.ethAddress||x?.address;if(!id)continue;const perf=new Map((x?.windowPerformances||[]).map(v=>[v?.[0],v?.[1]]));const w=perf.get('week')||{};out.push(normalized('HYPERLIQUID',id,x?.displayName||id,{pnl7d:n(w.pnl),roi7d:n(w.roi)*100,aum:n(x?.accountValue)}))}status.state=out.length?'OK':'EMPTY';status.discovered=out.length}catch(e){status.error=String(e.message||e)}return {status,out}}
function hlStats(fills){const c=fills.filter(f=>ok(f.closedPnl)&&Math.abs(n(f.closedPnl))>0);const wins=c.filter(f=>n(f.closedPnl)>0),loss=c.filter(f=>n(f.closedPnl)<0);const gp=wins.reduce((a,f)=>a+n(f.closedPnl),0),gl=Math.abs(loss.reduce((a,f)=>a+n(f.closedPnl),0));const days=new Set(c.map(f=>new Date(f.time).toISOString().slice(0,10)));const holds=[];const q=new Map();for(const f of [...fills].sort((a,b)=>a.time-b.time)){const side=String(f.dir||'').toUpperCase().includes('SELL')?'SHORT':'LONG',key=f.coin+'|'+side;if(!q.has(key))q.set(key,[]);if(!ok(f.closedPnl)||Math.abs(n(f.closedPnl))<1e-12)q.get(key).push(f.time);else{const o=q.get(key).shift();if(ok(o))holds.push((f.time-o)/3600000)}}const sh=holds.sort((a,b)=>a-b);let eq=0,peak=0,dd=0;for(const f of c){eq+=n(f.closedPnl);peak=Math.max(peak,eq);if(peak>0)dd=Math.max(dd,(peak-eq)/peak*100)}return{trades7d:c.length,activeDays:days.size,wr:c.length?wins.length/c.length*100:NaN,pf:gl?gp/gl:(gp>0?Infinity:NaN),avgHoldH:holds.length?holds.reduce((a,b)=>a+b,0)/holds.length:NaN,medianHoldH:sh.length?sh[Math.floor(sh.length/2)]:NaN,dd}}
async function hlVerify(t){
  try{
    const end=Date.now(),start=end-LOOKBACK_MS;
    const fills=await postJson('https://api.hyperliquid.xyz/info',{type:'userFillsByTime',user:t.traderId,startTime:start,endTime:end});
    const fs=Array.isArray(fills)?fills:[];
    if(!fs.length){t.coverage='VERIFY_EMPTY';t.verifyError='HL_NO_FILLS_7D';t.stats={...t.stats,trades7d:0,activeDays:0};return t}
    t.stats={...t.stats,...hlStats(fs)};t.coverage='COMPLETE';t.audit={fills7d:fs.length,verifiedAt:Date.now()};
    const preGate=gate(t);
    if(preGate.length===0){
      const state=await postJson('https://api.hyperliquid.xyz/info',{type:'clearinghouseState',user:t.traderId});
      const positions=(state?.assetPositions||[]).map(x=>x?.position).filter(Boolean);
      let best=null;
      for(const p of positions){const sz=n(p?.szi);if(!sz)continue;const side=sz>0?'LONG':'SHORT',symbol=p?.coin||'',entry=n(p?.entryPx),mark=n(p?.markPx);if(!ok(entry)||!ok(mark)||!symbol)continue;const recent=fs.filter(f=>f?.coin===symbol).sort((a,b)=>n(b?.time)-n(a?.time));const last=recent[0];best={symbol,side,entry,mark,size:Math.abs(sz),openedAt:n(last?.time,n(p?.timestamp,Date.now())),lastActivityAt:n(last?.time,n(p?.timestamp,Date.now())),source:'HYPERLIQUID'};break}if(best)t.position=best;t.audit.currentPositions=positions.length;
    }
    return t;
  }catch(e){t.coverage='VERIFY_ERROR';t.verifyError='HL:'+String(e.message||e);return t}
}

async function binance(){const status={source:'BINANCE',class:'DISCOVERY',state:'UNAVAILABLE',discovered:0,error:null};const out=new Map();const url='https://www.binance.com/bapi/futures/v1/friendly/future/copy-trade/home-page/query-list';try{for(const dataType of ['ROI','PNL','MDD']){const x=await postJson(url,{pageNumber:1,pageSize:100,timeRange:'90D',dataType,favoriteOnly:false,hideFull:false,nickname:'',order:'DESC',apiKeyOnly:false});for(const r of arr(x)){const id=r?.leadPortfolioId||r?.portfolioId;if(!id)continue;out.set(String(id),normalized('BINANCE',id,r?.nickname||r?.nickName||id,{trades7d:first(r,['tradeCount7d','tradeCount7dTotal']),activeDays:first(r,['activeDays','daysTrading']),wr:first(r,['winRate']),pf:first(r,['profitFactor']),pnl7d:first(r,['pnl7d','pnl']),dd:first(r,['mdd','maxDrawdown','maxDrawdownRate']),roi7d:first(r,['roi7d','roi']),aum:first(r,['aum','totalAssets']),coverage:'PARTIAL'}))}if(out.size>=DISCOVERY_LIMIT)break}const list=[...out.values()].slice(0,DISCOVERY_LIMIT);status.discovered=list.length;status.state=list.length?'OK':'EMPTY';if(!list.length)status.error='BINANCE_NO_PUBLIC_PORTFOLIOS';return{status,out:list}}catch(e){status.error='BINANCE:'+String(e.message||e);return{status,out:[]}}}

function parseEmbedded(html,source){const found=new Map();const patterns=source==='BYBIT'?[/"(?:uid|userId|masterTraderId)"\s*:\s*"?([A-Za-z0-9_-]{5,})/g]:[/"(?:traderId|uid|userId|projectId)"\s*:\s*"?([A-Za-z0-9_-]{5,})/g];for(const re of patterns){let m;while((m=re.exec(html))){const id=m[1];const pos=m.index;const chunk=html.slice(Math.max(0,pos-1200),Math.min(html.length,pos+2500));const name=(chunk.match(/"(?:nickName|nickname|traderName|displayName)"\s*:\s*"([^"]+)/)||[])[1]||id;const roi=n((chunk.match(/"(?:roi|roi7d|returnRate)"\s*:\s*"?(-?\d+(?:\.\d+)?)/)||[])[1]);const pnl=n((chunk.match(/"(?:pnl|profit|totalProfit)"\s*:\s*"?(-?\d+(?:\.\d+)?)/)||[])[1]);const wr=n((chunk.match(/"(?:winRate|win_rate)"\s*:\s*"?(-?\d+(?:\.\d+)?)/)||[])[1]);found.set(id,normalized(source,id,name,{roi7d:roi,pnl7d:pnl,wr:wr}))}}return[...found.values()]}
async function webDiscovery(source,url){const status={source,class:'DISCOVERY',state:'UNAVAILABLE',discovered:0,error:null};try{const html=await fetchText(url);const out=parseEmbedded(html,source).slice(0,DISCOVERY_LIMIT);status.discovered=out.length;status.state=out.length?'OK':'EMPTY';if(!out.length)status.error='PUBLIC_PAGE_NO_MACHINE_READABLE_TRADER_IDS';return{status,out}}catch(e){status.error=String(e.message||e);return{status,out:[]}}}
async function bybit(){return webDiscovery('BYBIT','https://www.bybit.com/copyTrading/en/leader-board')}
async function bitget(){return webDiscovery('BITGET','https://www.bitget.com/copy-trading/futures')}

async function okx(){
  const status={source:'OKX',class:'FULL_SIGNAL',state:'UNAVAILABLE',discovered:0,error:null};
  const seen=new Map();
  const bases=['https://openapi.okx.com','https://eea.okx.com'];
  let lastErr='';
  try{
    for(const base of bases){
      try{
        for(const sortType of ['overview','pnl','aum','win_ratio','pnl_ratio','current_copy_trader_pnl']){
          for(const page of [1,2,3,4,5]){
            const u=`${base}/api/v5/copytrading/public-lead-traders?instType=SWAP&sortType=${sortType}&state=0&minLeadDays=1&page=${page}&limit=20`;
            const x=await json(u);
            const rows=arr(x);
            for(const r of rows){
              const id=r?.uniqueCode||r?.traderId||r?.uid;
              if(!id)continue;
              const wrRaw=first(r,['winRatio','winRate','winRatePct']);
              const wr=ok(wrRaw)?(wrRaw<=1?wrRaw*100:wrRaw):NaN;
              seen.set(String(id),normalized('OKX',id,r?.nickName||r?.nickNameEn||r?.displayName||id,{
                wr,pnl7d:first(r,['pnl','pnl7d','profit']),
                roi7d:first(r,['pnlRatio','roi','roi7d']),
                aum:first(r,['aum','aumValue']),
                daysTrading:first(r,['leadDays','daysTrading']),
                activeDays:first(r,['leadDays','daysTrading']),
                coverage:'DISCOVERY_ONLY'
              }));
            }
            if(seen.size>=DISCOVERY_LIMIT)break;
          }
          if(seen.size>=DISCOVERY_LIMIT)break;
        }
        if(seen.size)break;
      }catch(e){lastErr=String(e.message||e)}
    }
    const out=[...seen.values()].slice(0,DISCOVERY_LIMIT);
    status.discovered=out.length;
    status.state=out.length?'OK':'EMPTY';
    if(!out.length)status.error=lastErr?`OKX:${lastErr}`:'OKX_NO_PUBLIC_LEAD_TRADERS';
    return {status,out};
  }catch(e){status.error='OKX:'+String(e.message||e);return{status,out:[]}}
}
async function okxVerify(t){
  const bases=['https://eea.okx.com','https://openapi.okx.com'];let lastErr='';
  for(const base of bases){try{
    const b=`${base}/api/v5/copytrading`;
    const [st,hist]=await Promise.all([
      json(`${b}/public-stats?instType=SWAP&uniqueCode=${encodeURIComponent(t.traderId)}&lastDays=7`),
      json(`${b}/public-subpositions-history?instType=SWAP&uniqueCode=${encodeURIComponent(t.traderId)}&limit=100`)
    ]);
    const h=arr(hist).filter(x=>{const ct=n(x?.closeTime||x?.cTime||x?.uTime);return !ct||ct>=Date.now()-LOOKBACK_MS});
    const wins=h.filter(x=>n(x?.pnl||x?.closedPnl)>0),loss=h.filter(x=>n(x?.pnl||x?.closedPnl)<0);const gp=wins.reduce((a,x)=>a+n(x?.pnl??x?.closedPnl),0),gl=Math.abs(loss.reduce((a,x)=>a+n(x?.pnl??x?.closedPnl),0));
    const holds=h.map(x=>{const a=n(x?.openTime||x?.openTimeMs),b2=n(x?.closeTime||x?.closeTimeMs);return a&&b2>=a?(b2-a)/3600000:NaN}).filter(ok).sort((a,b)=>a-b);
    let e=0,peak=0,dd=0;for(const x of h){e+=n(x?.pnl??x?.closedPnl);peak=Math.max(peak,e);if(peak>0)dd=Math.max(dd,(peak-e)/peak*100)}
    const statWr=first(st,['winRatio','winRate']),statPnl=first(st,['pnl','totalPnl','profit']),statRoi=first(st,['pnlRatio','roi']),statPf=first(st,['profitLossRatio','profitLossRate']);
    t.coverage=h.length?'COMPLETE':'PARTIAL';t.stats={...t.stats,trades7d:h.length||t.stats.trades7d,activeDays:h.length?new Set(h.map(x=>{const ts=n(x?.closeTime||x?.cTime||x?.uTime);return ts?new Date(ts).toISOString().slice(0,10):'x'})).size:t.stats.activeDays,wr:h.length?wins.length/h.length*100:(ok(statWr)?(statWr<=1?statWr*100:statWr):t.stats.wr),pf:gl?gp/gl:(ok(statPf)?statPf:t.stats.pf),pnl7d:ok(statPnl)?statPnl:t.stats.pnl7d,roi7d:ok(statRoi)?(statRoi<=1?statRoi*100:statRoi):t.stats.roi7d,avgHoldH:holds.length?holds.reduce((a,b)=>a+b,0)/holds.length:t.stats.avgHoldH,medianHoldH:holds.length?holds[Math.floor(holds.length/2)]:t.stats.medianHoldH,dd:dd||t.stats.dd};
    t.audit={history7d:h.length,verifiedAt:Date.now(),region:base.includes('eea')?'EEA':'GLOBAL'};
    const preGate=gate(t);
    if(preGate.length===0){
      const pos=await json(`${b}/public-current-subpositions?instType=SWAP&uniqueCode=${encodeURIComponent(t.traderId)}`);const ps=arr(pos);let best=null;
      for(const x of ps){const entry=first(x,['openAvgPx','avgPx','openPx']),mark=first(x,['markPx','markPrice']),opened=first(x,['openTime','openTimeMs','cTime','uTime']);if(!ok(entry)||!ok(mark))continue;const side=String(x?.posSide||x?.side||'').toLowerCase().includes('short')?'SHORT':'LONG';const openedAt=ok(opened)?opened:Date.now();if(openedAt>Date.now())continue;const age=(Date.now()-openedAt)/60000;if(!best||age<(Date.now()-best.openedAt)/60000)best={symbol:x?.instId||x?.ccy||'',side,entry,mark,openedAt,size:Math.abs(n(x?.subPos||x?.pos||x?.sz)),source:'OKX'}}if(best)t.position=best;t.audit.currentPositions=ps.length;
    }
    return t;
  }catch(e){lastErr=String(e.message||e)}}
  t.coverage='VERIFY_ERROR';t.verifyError='OKX:'+lastErr;return t;
}

async function cacheLoad(){const c=await readJson(CACHE_FILE,{sources:{}});return c?.sources||{}}
async function cacheSave(sources){await writeJson(CACHE_FILE,{version:VERSION,generatedAt:Date.now(),sources})}
async function withCache(result,cache){const s=result.status;if(result.out.length){cache[s.source]={savedAt:Date.now(),items:result.out};return result}const old=cache[s.source];if(old?.items?.length&&(Date.now()-n(old.savedAt))/3600000<=CACHE_TTL_H){s.state='CACHE';s.error=(s.error?s.error+' | ':'')+'USING_LAST_GOOD_DISCOVERY';return{status:s,out:old.items.map(x=>({...x,fromCache:true}))}}return result}
async function unsupported(source){return{status:{source,class:'UNSUPPORTED',state:'UNSUPPORTED',discovered:0,error:'NO_VERIFIED_PUBLIC_READ_ONLY_TRADER_DISCOVERY'},out:[]}}
async function telegram(text){if(!TELEGRAM_TOKEN||!TELEGRAM_CHAT_ID){console.log('[TELEGRAM] skipped: missing TELEGRAM_TOKEN or TELEGRAM_CHAT_ID');return}try{const raw=await fetchText(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:TELEGRAM_CHAT_ID,text,disable_web_page_preview:true})});let x;try{x=JSON.parse(raw)}catch{}if(x&&!x.ok)throw new Error(`TELEGRAM_API:${x.error_code||''}:${x.description||'unknown'}`);console.log('[TELEGRAM] sent')}catch(e){console.log('[TELEGRAM]',e.message)}}
function report(statuses,all,verified,signals,blocked,runtime){const full=statuses.filter(s=>s.class==='FULL_SIGNAL'&&['OK','CACHE'].includes(s.state)).length,disc=statuses.filter(s=>s.class==='DISCOVERY'&&['OK','CACHE'].includes(s.state)).length,uns=statuses.filter(s=>s.state==='UNSUPPORTED').length;const L=[`🌐 GLOBAL FUTURES TOP-TRADER & SIGNAL HUNTER`,`🧠 ${VERSION}`,`📡 READ-ONLY | NO ORDERS | FUTURES ONLY`,`━━━━━━━━━━━━━━━━━━`,`🔎 Full-signal sources: ${full}/${statuses.length} | Discovery sources: ${disc}/${statuses.length} | Unsupported: ${uns}/${statuses.length}`,`👥 Traders discovered: ${all.length} | Full-signal audited: ${verified.length} | Actionable: ${signals.length}/${TOP_SIGNALS}`,`🎯 Quality: 7D trades≥${MIN_TRADES} | active days≥${MIN_DAYS} | WR≥${MIN_WR}% | PF≥${MIN_PF} | median hold≤${MAX_MEDIAN_H}h | avg hold≤${MAX_AVG_H}h | DD≤${MAX_DD}%`,`⚡ Signal: fresh≤${FRESH_MIN}m | entry≤${ENTRY_MAX}% | RR≥${MIN_RR} | TP/SL=model ${MODEL_TP_R}R/${MODEL_SL_PCT}%`,`⏱ Runtime: ${runtime.toFixed(1)}s`,'','📡 SOURCE STATUS'];for(const s of statuses)L.push(`${s.source}: ${s.state} | ${s.class} | discovered=${s.discovered}${s.error?' | '+s.error.slice(0,110):''}`);const cov={COMPLETE:verified.filter(t=>t.coverage==='COMPLETE').length,PARTIAL:verified.filter(t=>t.coverage==='PARTIAL').length,EMPTY:verified.filter(t=>t.coverage==='VERIFY_EMPTY').length,ERROR:verified.filter(t=>t.coverage==='VERIFY_ERROR').length,UNKNOWN:verified.filter(t=>!t.coverage||t.coverage==='UNKNOWN').length};const he=verified.filter(t=>t.coverage==='VERIFY_ERROR'&&t.source==='HYPERLIQUID').length,oe=verified.filter(t=>t.coverage==='VERIFY_ERROR'&&t.source==='OKX').length;L.push(`🧾 Audit coverage: complete=${cov.COMPLETE} | partial=${cov.PARTIAL} | empty=${cov.EMPTY} | verify-error=${cov.ERROR} | unknown=${cov.UNKNOWN}`,`   Verify errors: Hyperliquid=${he} | OKX=${oe}`,'','🏆 TOP ACTIONABLE FUTURES SIGNALS');if(!signals.length)L.push('No trader passed BOTH the statistical quality gate and current-position signal gate this cycle.');else signals.forEach((t,i)=>{const p=t.position;L.push(`${i+1}. ${t.venue} ${trunc(t.name)} | ${p.side} ${p.symbol} | Entry ${p.entry} | Now ${p.mark} | Dist ${pct(p.distancePct)} | RR ${p.rr.toFixed(2)} | Age ${((Date.now()-p.openedAt)/60000).toFixed(1)}m | WR ${pct(t.stats.wr,1)} | PF ${t.stats.pf.toFixed(2)} | Score ${score(t).toFixed(1)}`)});L.push('','🧱 TOP BLOCKED TRADERS');blocked.slice(0,10).forEach(t=>L.push(`${t.venue} ${trunc(t.name,22)}: ${t.reasons.join(' | ')}`));return L.join('\n')}

async function main(){const started=Date.now();await ensure();console.log(`GFTSH ${VERSION} | READ-ONLY | FUTURES ONLY`);const cache=await cacheLoad();const fns=[hyperliquid,binance,okx,bybit,bitget,()=>unsupported('KUCOIN'),()=>unsupported('GATE'),()=>unsupported('MEXC'),()=>unsupported('PHEMEX'),()=>unsupported('BINGX'),()=>unsupported('COINEX'),()=>unsupported('DYDX'),()=>unsupported('PARADEX')];const results=[];for(const fn of fns){let r;try{r=await fn()}catch(e){r={status:{source:'UNKNOWN',class:'DISCOVERY',state:'UNAVAILABLE',discovered:0,error:String(e.message||e)},out:[]}}results.push(await withCache(r,cache));await sleep(40)}await cacheSave(Object.fromEntries(results.map(r=>[r.status.source,{savedAt:Date.now(),items:r.out}])));const statuses=results.map(r=>r.status);const map=new Map();for(const r of results)for(const t of r.out){const k=`${t.source}:${t.traderId}`;if(!map.has(k))map.set(k,t)}const all=[...map.values()].sort((a,b)=>score(b)-score(a));const hlPool=all.filter(t=>t.source==='HYPERLIQUID').slice(0,HL_VERIFY_LIMIT);const okxPool=all.filter(t=>t.source==='OKX').slice(0,OKX_VERIFY_LIMIT);const verifyPool=[...hlPool,...okxPool];const verified=[];for(const t of verifyPool){const v=t.source==='HYPERLIQUID'?await hlVerify(t):await okxVerify(t);v.gate=gate(v);if(v.verifyError)v.gate.push(v.coverage==='VERIFY_EMPTY'?'VERIFY_EMPTY':`VERIFY_ERROR:${v.verifyError.slice(0,90)}`);verified.push(v)}const quality=verified.filter(t=>t.gate.length===0);const signals=[];for(const t of quality){const pg=positionGate(t);if(pg.length===0)signals.push(t)}signals.sort((a,b)=>score(b)-score(a));const blocked=verified.filter(t=>t.gate.length||positionGate(t).length).map(t=>({venue:t.venue,name:t.name,reasons:[...t.gate,...(t.gate.length?[]:positionGate(t))]}));const text=report(statuses,all,verified,signals.slice(0,TOP_SIGNALS),blocked,(Date.now()-started)/1000);console.log(text);await writeJson(STATE_FILE,{version:VERSION,updatedAt:Date.now(),statuses,discovered:all.length,verified:verified.length,signals:signals.length,top:signals.slice(0,TOP_SIGNALS)});await telegram(text)}
main().catch(e=>{console.error('[FATAL]',e);process.exitCode=1});
