import fs from 'node:fs/promises';
import path from 'node:path';

const VERSION='GFTSH-V1.1.0-GLOBAL-FUTURES-MULTI-VENUE';
const STATE_FILE=process.env.GLOBAL_STATE_FILE||'state/global_futures_hunter.json';
const CACHE_FILE=process.env.GLOBAL_CACHE_FILE||'state/global_futures_cache.json';
const TELEGRAM_TOKEN=process.env.TELEGRAM_TOKEN||'';
const TELEGRAM_CHAT_ID=process.env.TELEGRAM_CHAT_ID||'';
const LOOKBACK_DAYS=7;
const DISCOVERY_LIMIT=Number(process.env.GFTSH_DISCOVERY_LIMIT||250);
const VERIFY_LIMIT=Number(process.env.GFTSH_VERIFY_LIMIT||150);
const TOP_SIGNALS=Number(process.env.GFTSH_TOP_SIGNALS||10);
const FRESH_MIN=Number(process.env.GFTSH_FRESH_MIN||15);
const ENTRY_MAX=Number(process.env.GFTSH_ENTRY_MAX_PCT||0.5);
const MIN_RR=Number(process.env.GFTSH_MIN_RR||1.5);
const MODEL_SL_PCT=Number(process.env.GFTSH_MODEL_SL_PCT||0.5);
const MODEL_TP_R=Number(process.env.GFTSH_MODEL_TP_R||2);
const HL_VERIFY_CONCURRENCY=Number(process.env.GFTSH_HL_VERIFY_CONCURRENCY||8);
const MIN_TRADES=Number(process.env.GFTSH_MIN_7D_TRADES||30);
const MIN_DAYS=Number(process.env.GFTSH_MIN_ACTIVE_DAYS||4);
const MIN_WR=Number(process.env.GFTSH_MIN_WR||55);
const MIN_PF=Number(process.env.GFTSH_MIN_PF||1.5);
const MAX_MEDIAN_H=Number(process.env.GFTSH_MAX_MEDIAN_HOURS||4);
const MAX_AVG_H=Number(process.env.GFTSH_MAX_AVG_HOURS||8);
const MAX_DD=Number(process.env.GFTSH_MAX_DD||40);
const TIMEOUT_MS=Number(process.env.GFTSH_HTTP_TIMEOUT_MS||12000);
const USER_AGENT='GFTSH/1.1 read-only futures trader research';

const SOURCES={
 HYPERLIQUID:{label:'HYPERLIQUID',kind:'DEX',base:'https://api.hyperliquid.xyz/info'},
 BINANCE:{label:'BINANCE',kind:'CEX',base:'https://www.binance.com'},
 OKX:{label:'OKX',kind:'CEX',base:'https://www.okx.com'},
 BYBIT:{label:'BYBIT',kind:'CEX',base:'https://www.bybit.com'},
 BITGET:{label:'BITGET',kind:'CEX',base:'https://api.bitget.com'},
 KUCOIN:{label:'KUCOIN',kind:'CEX',base:'https://www.kucoin.com'},
 GATE:{label:'GATE',kind:'CEX',base:'https://www.gate.com'},
 MEXC:{label:'MEXC',kind:'CEX',base:'https://www.mexc.com'},
 PHEMEX:{label:'PHEMEX',kind:'CEX',base:'https://phemex.com'},
 BINGX:{label:'BINGX',kind:'CEX',base:'https://bingx.com'},
 COINEX:{label:'COINEX',kind:'CEX',base:'https://www.coinex.com'},
 DYDX:{label:'DYDX',kind:'DEX',base:'https://indexer.dydx.trade'},
 PARADEX:{label:'PARADEX',kind:'DEX',base:'https://api.prod.paradex.trade'}
};

function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function num(v,d=NaN){const x=Number(v);return Number.isFinite(x)?x:d;}
function finite(v){return Number.isFinite(num(v));}
function pct(v,d=2){return finite(v)?`${num(v).toFixed(d)}%`:'—';}
function usd(v){return finite(v)?`$${num(v).toLocaleString('en-US',{maximumFractionDigits:0})}`:'—';}
function trunc(s,n=12){s=String(s??'');return s.length>n?`${s.slice(0,n/2)}…${s.slice(-n/2)}`:s;}
function sleepJitter(){return sleep(50+Math.floor(Math.random()*80));}

async function ensureState(){await fs.mkdir(path.dirname(STATE_FILE),{recursive:true});await fs.mkdir(path.dirname(CACHE_FILE),{recursive:true});}
async function readJson(file,fallback){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch{return fallback;}}
async function writeJson(file,obj){await fs.writeFile(file,JSON.stringify(obj,null,2));}

async function requestJson(url,opts={}){
 const ctl=new AbortController();const t=setTimeout(()=>ctl.abort(),TIMEOUT_MS);
 try{
  const headers={'accept':'application/json,text/plain,*/*','user-agent':USER_AGENT,...(opts.headers||{})};
  const r=await fetch(url,{...opts,headers,signal:ctl.signal});
  const text=await r.text();
  let data;try{data=JSON.parse(text);}catch{data=text.slice(0,500);}
  if(!r.ok)throw new Error(`HTTP_${r.status}:${JSON.stringify(data).slice(0,280)}`);
  return data;
 }finally{clearTimeout(t);}
}
async function postJson(url,body){return requestJson(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});}

function normalized({source,id,name,stats={},position=null}){
 return {source,venue:SOURCES[source]?.label||source,traderId:String(id),name:name||String(id),accountType:stats.accountType||'FUTURES_LEAD',
  stats:{trades7d:num(stats.trades7d),activeDays:num(stats.activeDays),wr:num(stats.wr),pf:num(stats.pf),pnl7d:num(stats.pnl7d),dd:num(stats.dd),avgHoldH:num(stats.avgHoldH),medianHoldH:num(stats.medianHoldH),roi7d:num(stats.roi7d),aum:num(stats.aum),daysTrading:num(stats.daysTrading)},
  position:position?{symbol:position.symbol||position.instId||'',side:String(position.side||'').toUpperCase(),entry:num(position.entry),mark:num(position.mark),openedAt:num(position.openedAt),size:num(position.size),tp:num(position.tp),sl:num(position.sl),source:position.source||source}:null,
  discoveredAt:Date.now()};
}

function gate(t){const s=t.stats,r=[];
 if(!finite(s.trades7d)||s.trades7d<MIN_TRADES)r.push('TRADES_7D<30');
 if(!finite(s.activeDays)||s.activeDays<MIN_DAYS)r.push('ACTIVE_DAYS<4');
 if(!finite(s.wr)||s.wr<MIN_WR)r.push('WR<55%');
 if(!finite(s.pf)||s.pf<MIN_PF)r.push('PF<1.5');
 if(finite(s.medianHoldH)&&s.medianHoldH>MAX_MEDIAN_H)r.push('MEDIAN_HOLD>4H');
 if(finite(s.avgHoldH)&&s.avgHoldH>MAX_AVG_H)r.push('AVG_HOLD>8H');
 if(finite(s.dd)&&s.dd>MAX_DD)r.push('DD>40%');
 return r;
}
function positionGate(t){const p=t.position;if(!p)return ['NO_CURRENT_POSITION'];const r=[];
 const age=finite(p.openedAt)?(Date.now()-p.openedAt)/60000:NaN;
 if(!finite(age)||age>FRESH_MIN)r.push('STALE>15M');
 if(!finite(p.entry)||!finite(p.mark)||p.entry<=0)r.push('NO_ENTRY_MARK');
 else {const d=(p.mark-p.entry)/p.entry*100*(p.side==='SHORT'?-1:1);p.distancePct=d;if(Math.abs(d)>ENTRY_MAX)r.push('ENTRY_DISTANCE>0.5%');}
 if(!['LONG','SHORT'].includes(p.side))r.push('SIDE_UNKNOWN');
 const risk=finite(p.sl)?Math.abs(p.entry-p.sl):NaN, reward=finite(p.tp)?Math.abs(p.tp-p.entry):NaN;
 if(finite(risk)&&risk>0&&finite(reward))p.rr=reward/risk;
 if(!finite(p.rr)||p.rr<MIN_RR)r.push('RR<1.5');
 return r;
}
function score(t){const s=t.stats;return (finite(s.pf)?Math.min(s.pf,8)*20:0)+(finite(s.wr)?Math.min(Math.max(s.wr-50,0),45):0)+(finite(s.trades7d)?Math.min(s.trades7d,150)/5:0)+(finite(s.pnl7d)?Math.max(Math.min(s.pnl7d/1000,20),-20):0)-(finite(s.dd)?Math.min(s.dd,40)*.5:20)-(finite(s.medianHoldH)?Math.min(s.medianHoldH,12):0);}

async function hyperliquid(){
 const status={source:'HYPERLIQUID',healthy:false,discovered:0,error:null};let out=[];
 try{
  const lb=await requestJson('https://stats-data.hyperliquid.xyz/Mainnet/leaderboard');
  const rows=Array.isArray(lb)?lb:(lb?.leaderboardRows||lb?.leaderboard||lb?.data||[]);
  for(const x of rows.slice(0,DISCOVERY_LIMIT)){
   const a=x?.ethAddress||x?.address;if(!a)continue;
   const perf=new Map((x?.windowPerformances||[]).map(v=>[v?.[0],v?.[1]]));
   const w=perf.get('week')||{};
   out.push(normalized({source:'HYPERLIQUID',id:a,name:x?.displayName||a,stats:{pnl7d:num(w.pnl),roi7d:num(w.roi)*100,aum:num(x?.accountValue),accountType:'DEX_PERP'}}));
  }
  status.healthy=true;status.discovered=out.length;
 }catch(e){status.error=String(e.message||e);}
 return {status,out};
}

function deriveHyperliquidStats(fills){
 const closed=fills.filter(f=>finite(f.closedPnl)&&Math.abs(f.closedPnl)>0);
 const wins=closed.filter(f=>f.closedPnl>0).length;
 const gp=closed.filter(f=>f.closedPnl>0).reduce((a,f)=>a+f.closedPnl,0);
 const gl=Math.abs(closed.filter(f=>f.closedPnl<0).reduce((a,f)=>a+f.closedPnl,0));
 const days=new Set(closed.map(f=>new Date(f.time).toISOString().slice(0,10)));
 const trades=closed.length;
 const wr=trades?wins/trades*100:NaN;
 const pf=gl>0?gp/gl:(gp>0?Infinity:NaN);
 const queues=new Map(), holds=[];
 for(const f of fills.sort((a,b)=>a.time-b.time)){
  const side=String(f.dir||'').toUpperCase().includes('SELL')?'SHORT':'LONG';
  const key=`${f.coin}|${side}`;
  const isClose=finite(f.closedPnl)&&Math.abs(f.closedPnl)>0;
  if(!queues.has(key))queues.set(key,[]);
  if(!isClose)queues.get(key).push(f.time);
  else {const q=queues.get(key);const open=q.shift();if(finite(open))holds.push((f.time-open)/3600000);}
 }
 const avgHoldH=holds.length?holds.reduce((a,b)=>a+b,0)/holds.length:NaN;
 const sorted=holds.slice().sort((a,b)=>a-b);const medianHoldH=sorted.length?sorted[Math.floor(sorted.length/2)]:NaN;
 // Intraperiod drawdown from cumulative closed PnL.
 let eq=0,peak=0,maxDD=0;for(const f of closed){eq+=f.closedPnl;peak=Math.max(peak,eq);if(peak>0)maxDD=Math.max(maxDD,(peak-eq)/peak*100);}
 return {trades7d:trades,activeDays:days.size,wr,pf,avgHoldH,medianHoldH,dd:maxDD};
}

async function hlVerify(t){try{
 const end=Date.now(),start=end-7*86400000;
 const [state,fills]=await Promise.all([
  postJson(SOURCES.HYPERLIQUID.base,{type:'clearinghouseState',user:t.traderId}),
  postJson(SOURCES.HYPERLIQUID.base,{type:'userFillsByTime',user:t.traderId,startTime:start,endTime:end})
 ]);
 const fs=Array.isArray(fills)?fills:[];const ds=deriveHyperliquidStats(fs);t.stats={...t.stats,...ds};
 const positions=(state?.assetPositions||[]).map(x=>x?.position).filter(Boolean);
 let best=null;
 for(const p of positions){const size=num(p?.szi);if(!size)continue;const symbol=p?.coin||'';const side=size>0?'LONG':'SHORT';const entry=num(p?.entryPx);const mark=num(p?.markPx);const liq=num(p?.liquidationPx);const symFills=fs.filter(f=>f?.coin===symbol).sort((a,b)=>a.time-b.time);
   const currentDir=side==='LONG'?'BUY':'SELL';
   let lastAdd=null;
   for(const f of symFills){const dir=String(f?.dir||'').toUpperCase();if(dir===currentDir||dir.includes(currentDir))lastAdd=f;}
   best={symbol,side,entry,mark,size:Math.abs(size),openedAt:num(lastAdd?.time,Date.now()),tp:NaN,sl:liq,source:'HYPERLIQUID',leverage:num(p?.leverage?.value)};break;}
 if(best){
   const risk=best.entry*MODEL_SL_PCT/100;
   best.sl=best.side==='LONG'?best.entry-risk:best.entry+risk;
   best.tp=best.side==='LONG'?best.entry+risk*MODEL_TP_R:best.entry-risk*MODEL_TP_R;
   best.tpSlModel=true;
   t.position=best;
  }
  t.meta={openFills:fs.length};return t;
 }catch(e){t.verifyError=String(e.message||e);return t;}}

function extractArray(x){if(Array.isArray(x))return x;for(const k of ['data','result','rows','list','items','leaderboard','dataList','leaderList'])if(Array.isArray(x?.[k]))return x[k];return [];}
function firstNumber(o,keys){for(const k of keys){const v=num(o?.[k]);if(finite(v))return v;}return NaN;}

async function binance(){
 const status={source:'BINANCE',healthy:false,discovered:0,error:null};
 const out=[];
 try{
  const u='https://www.binance.com/bapi/futures/v1/friendly/future/copy-trade/home-page/query-list';
  const x=await postJson(u,{pageNumber:1,pageSize:21,timeRange:'90D',dataType:'ROI',favoriteOnly:false,hideFull:false,nickname:'',order:'DESC',apiKeyOnly:false});
  const rows=extractArray(x);
  for(const r of rows.slice(0,DISCOVERY_LIMIT)){
   const id=r?.leadPortfolioId||r?.portfolioId;if(!id)continue;
   out.push(normalized({source:'BINANCE',id,name:r?.nickname||r?.nickName||id,stats:{
    trades7d:firstNumber(r,['tradeCount7d','tradeCount']),
    activeDays:firstNumber(r,['activeDays','daysTrading']),
    wr:firstNumber(r,['winRate']),
    pf:firstNumber(r,['profitFactor']),
    pnl7d:firstNumber(r,['pnl7d','pnl']),
    dd:firstNumber(r,['mdd','maxDrawdown','maxDrawdownRate']),
    roi7d:firstNumber(r,['roi7d','roi']),
    aum:firstNumber(r,['aum','totalAssets'])
   }}));
  }
  if(out.length){status.healthy=true;status.discovered=out.length;}
  else status.error='BINANCE_NO_PUBLIC_PORTFOLIOS';
 }catch(e){status.error=`binance:home-page/query-list:${e.message}`;}
 return {status,out};
}

async function genericCex(name,urls,parser){const status={source:name,healthy:false,discovered:0,error:null};let data=[];
 for(const u of urls){try{const x=await requestJson(u);data=extractArray(x);if(data.length){status.healthy=true;break;}}catch(e){status.error=`${name}:${e.message}`;}}
 const out=parser(data);status.discovered=out.length;return {status,out};}

async function okx(){
 const status={source:'OKX',healthy:false,discovered:0,error:null};
 const base='https://www.okx.com/api/v5/copytrading';
 const sorts=['overview','pnl','pnl_ratio','win_ratio','aum'];
 const seen=new Map();
 try{
  for(const sortType of sorts){
   const u=`${base}/public-lead-traders?instType=SWAP&sortType=${encodeURIComponent(sortType)}&state=0&minLeadDays=1`;
   const x=await requestJson(u);
   const rows=extractArray(x);
   for(const r of rows){
    const id=r?.uniqueCode;if(!id)continue;
    const t=normalized({source:'OKX',id,name:r?.nickName||id,stats:{
      wr:firstNumber(r,['winRatio']) * (firstNumber(r,['winRatio'])<=1?100:1),
      pnl7d:firstNumber(r,['pnl7d','pnl']),
      roi7d:firstNumber(r,['pnlRatio','roi7d','roi']) * (firstNumber(r,['pnlRatio','roi7d','roi'])<=1?100:1),
      aum:firstNumber(r,['aum']),
      daysTrading:firstNumber(r,['leadDays']),
      activeDays:firstNumber(r,['leadDays'])
    }});
    seen.set(id,t);
   }
   if(seen.size>=DISCOVERY_LIMIT)break;
  }
  const out=[...seen.values()].slice(0,DISCOVERY_LIMIT);
  if(out.length){status.healthy=true;status.discovered=out.length;return {status,out};}
  status.error='OKX_NO_PUBLIC_LEAD_TRADERS';
 }catch(e){status.error=`OKX:${e.message}`;}
 return {status,out:[]};
}

async function okxVerify(t){
 try{
  const base='https://www.okx.com/api/v5/copytrading';
  const [stats,weekly,positions,history]=await Promise.all([
   requestJson(`${base}/public-stats?instType=SWAP&uniqueCode=${encodeURIComponent(t.traderId)}&lastDays=1`),
   requestJson(`${base}/public-weekly-pnl?instType=SWAP&uniqueCode=${encodeURIComponent(t.traderId)}`),
   requestJson(`${base}/public-current-subpositions?instType=SWAP&uniqueCode=${encodeURIComponent(t.traderId)}`),
   requestJson(`${base}/public-subpositions-history?instType=SWAP&uniqueCode=${encodeURIComponent(t.traderId)}&limit=100`)
  ]);
  const st=extractArray(stats)[0]||{};
  const wp=extractArray(weekly);
  const hist=extractArray(history);
  const recentWeek=wp.slice(0,1)[0]||{};
  const trades7d=hist.filter(x=>num(x?.closeTime)>=Date.now()-7*86400000).length;
  const activeDays=new Set(hist.filter(x=>num(x?.closeTime)>=Date.now()-7*86400000).map(x=>new Date(num(x.closeTime)).toISOString().slice(0,10))).size;
  const wins=hist.filter(x=>num(x?.closeTime)>=Date.now()-7*86400000 && num(x?.pnl)>0).length;
  const closed7=hist.filter(x=>num(x?.closeTime)>=Date.now()-7*86400000 && finite(x?.pnl));
  const grossWin=closed7.filter(x=>num(x.pnl)>0).reduce((a,x)=>a+num(x.pnl),0);
  const grossLoss=Math.abs(closed7.filter(x=>num(x.pnl)<0).reduce((a,x)=>a+num(x.pnl),0));
  const pf=grossLoss>0?grossWin/grossLoss:(grossWin>0?Infinity:NaN);
  const holds=closed7.map(x=>{const a=num(x.openTime),b=num(x.closeTime);return a>0&&b>=a?(b-a)/3600000:NaN}).filter(finite).sort((a,b)=>a-b);
  const avgHoldH=holds.length?holds.reduce((a,b)=>a+b,0)/holds.length:NaN;
  const medianHoldH=holds.length?holds[Math.floor(holds.length/2)]:NaN;
  let eq=0,peak=0,maxDD=0;for(const x of closed7){eq+=num(x.pnl);peak=Math.max(peak,eq);if(peak>0)maxDD=Math.max(maxDD,(peak-eq)/peak*100);}
  const wr=finite(st.winRatio)?num(st.winRatio)*100:(closed7.length?wins/closed7.length*100:NaN);
  const pnl7d=closed7.reduce((a,x)=>a+num(x.pnl),0);
  t.stats={...t.stats,trades7d,activeDays,wr,pf,avgHoldH,medianHoldH,dd:maxDD,pnl7d:finite(pnl7d)?pnl7d:firstNumber(recentWeek,['pnl'])};
  const ps=extractArray(positions);
  let best=null;
  for(const x of ps){
    const side=String(x?.posSide||'').toLowerCase()==='short'?'SHORT':(String(x?.posSide||'').toLowerCase()==='long'?'LONG':(num(x?.subPos)<0?'SHORT':'LONG'));
    const entry=firstNumber(x,['openAvgPx']);const mark=firstNumber(x,['markPx']);const openedAt=firstNumber(x,['openTime']);
    if(!finite(entry)||!finite(mark)||!finite(openedAt))continue;
    const age=(Date.now()-openedAt)/60000;if(age<0)continue;
    if(!best||age<(Date.now()-best.openedAt)/60000)best={symbol:x?.instId||x?.ccy||'',side,entry,mark,openedAt,size:Math.abs(num(x?.subPos)),tp:NaN,sl:NaN,source:'OKX'};
  }
  if(best){const risk=best.entry*MODEL_SL_PCT/100;best.sl=best.side==='LONG'?best.entry-risk:best.entry+risk;best.tp=best.side==='LONG'?best.entry+risk*MODEL_TP_R:best.entry-risk*MODEL_TP_R;best.tpSlModel=true;t.position=best;}
  t.meta={okxPublicStats:st,weeklyRows:wp.length,historyRows:hist.length};
  return t;
 }catch(e){t.verifyError=`OKX:${e.message}`;return t;}
}

async function bybit(){return genericCex('BYBIT',[
 'https://www.bybit.com/x-api/fapi/public/v1/copy-trade/leader-board?limit=100',
 'https://api2.bybit.com/fapi/contract/v5/copytrade/public/v1/leader-board?limit=100'
 ],rows=>rows.slice(0,DISCOVERY_LIMIT).map(x=>normalized({source:'BYBIT',id:x?.uid||x?.userId||x?.leaderId||x?.masterTraderId,name:x?.nickName||x?.nickname||x?.uid,stats:{wr:firstNumber(x,['winRate','winRate7D']),pnl7d:firstNumber(x,['pnl','pnl7D']),roi7d:firstNumber(x,['roi','roi7D']),dd:firstNumber(x,['mdd','maxDrawdown']),daysTrading:firstNumber(x,['daysTrading','activeDays'])}})).filter(x=>x.traderId));}

async function bitget(){return genericCex('BITGET',[
 'https://api.bitget.com/api/v2/copy/mix-trader/config-query?productType=USDT-FUTURES',
 'https://api.bitget.com/api/v2/copy/mix-trader/trader-list?productType=USDT-FUTURES&pageNo=1&pageSize=100'
 ],rows=>rows.slice(0,DISCOVERY_LIMIT).map(x=>normalized({source:'BITGET',id:x?.traderId||x?.uid||x?.id,name:x?.nickName||x?.traderName||x?.traderId,stats:{wr:firstNumber(x,['winRate']),pnl7d:firstNumber(x,['profit','pnl','profit7d']),roi7d:firstNumber(x,['roi','roi7d']),aum:firstNumber(x,['aum','totalAssets']),daysTrading:firstNumber(x,['daysTrading'])}})).filter(x=>x.traderId));}

async function unsupported(name){return {status:{source:name,healthy:false,discovered:0,error:'NO_VERIFIED_PUBLIC_READ-ONLY_LEADERBOARD_ADAPTER'},out:[]};}

async function verifyCex(t){
 if(t.source==='OKX')return okxVerify(t);
 // Binance/Bybit/Bitget public leaderboard snapshots do not guarantee a
 // current lead position in the same public contract. Never fabricate one.
 return t;
}

async function telegram(text){if(!TELEGRAM_TOKEN||!TELEGRAM_CHAT_ID)return false;try{await requestJson(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:TELEGRAM_CHAT_ID,text,disable_web_page_preview:true})});return true;}catch(e){console.log('[TELEGRAM] ERROR',e.message);return false;}}

function report(statuses,all,verified,signals,blocked,runtime){
 const healthy=statuses.filter(s=>s.healthy).length;
 const lines=[`🌐 GLOBAL FUTURES TOP-TRADER & SIGNAL HUNTER`,`🧠 ${VERSION}`,`📡 READ-ONLY | NO ORDERS | FUTURES ONLY`,`━━━━━━━━━━━━━━━━━━`,`🔎 Sources: ${healthy}/${statuses.length} healthy | Traders discovered: ${all.length}`,`🛡️ Verified: ${verified.length} | Actionable signals: ${signals.length}/${TOP_SIGNALS}`,`🎯 Gate: 7D trades≥${MIN_TRADES} | active days≥${MIN_DAYS} | WR≥${MIN_WR}% | PF≥${MIN_PF} | median hold≤${MAX_MEDIAN_H}h | avg hold≤${MAX_AVG_H}h | DD≤${MAX_DD}%`,`⚡ Signal gate: fresh≤${FRESH_MIN}m | entry distance≤${ENTRY_MAX}% | RR≥${MIN_RR} | TP/SL=model ${MODEL_TP_R}R/${MODEL_SL_PCT}%`,`⏱ Runtime: ${runtime.toFixed(1)}s`,``,`📡 SOURCE STATUS`];
 for(const s of statuses)lines.push(`${s.source}: ${s.healthy?'OK':'ERROR'} | discovered=${s.discovered}${s.error?` | ${s.error.slice(0,150)}`:''}`);
 lines.push('','🏆 TOP ACTIONABLE FUTURES SIGNALS');
 if(!signals.length)lines.push('No trader passed BOTH the statistical quality gate and current-position signal gate this cycle.');
 else signals.forEach((t,i)=>{const p=t.position;lines.push(`${i+1}. ${t.venue} ${trunc(t.name,20)} | ${p.side} ${p.symbol} | Entry ${p.entry.toFixed(6)} | Now ${p.mark.toFixed(6)} | Dist ${pct(p.distancePct)} | RR ${p.rr.toFixed(2)} | Age ${((Date.now()-p.openedAt)/60000).toFixed(1)}m | WR ${pct(t.stats.wr,1)} | PF ${t.stats.pf.toFixed(2)} | Score ${score(t).toFixed(1)}`);});
 lines.push('','🧱 TOP BLOCKED TRADERS');
 blocked.slice(0,10).forEach(t=>lines.push(`${t.venue} ${trunc(t.name,22)}: ${t.reasons.join(' | ')}`));
 return lines.join('\n');
}

async function main(){const start=Date.now();await ensureState();console.log('========================================');console.log('GLOBAL FUTURES TOP-TRADER & SIGNAL HUNTER');console.log(`Version: ${VERSION}`);console.log('Mode: READ-ONLY / NO ORDERS / FUTURES ONLY');console.log('========================================');
 const adapters=[hyperliquid,binance,okx,bybit,bitget,()=>unsupported('KUCOIN'),()=>unsupported('GATE'),()=>unsupported('MEXC'),()=>unsupported('PHEMEX'),()=>unsupported('BINGX'),()=>unsupported('COINEX'),()=>unsupported('DYDX'),()=>unsupported('PARADEX')];
 const results=[];for(const fn of adapters){try{results.push(await fn());}catch(e){results.push({status:{source:'UNKNOWN',healthy:false,discovered:0,error:String(e.message||e)},out:[]});}}
 const statuses=results.map(x=>x.status);let all=results.flatMap(x=>x.out);
 const dedup=new Map();for(const t of all){const k=`${t.source}:${t.traderId}`;if(!dedup.has(k))dedup.set(k,t);}all=[...dedup.values()];
 all.sort((a,b)=>score(b)-score(a));const verifyPool=all.slice(0,VERIFY_LIMIT);const verified=[];
 const queue=verifyPool.slice();
 async function worker(){while(queue.length){const t=queue.shift();const v=t.source==='HYPERLIQUID'?await hlVerify(t):await verifyCex(t);v.gate=gate(v);verified.push(v);}}
 await Promise.all(Array.from({length:Math.min(HL_VERIFY_CONCURRENCY,verifyPool.length||1)},worker));
 const quality=verified.filter(t=>t.gate.length===0);for(const t of quality)positionGate(t);
 const signals=quality.filter(t=>positionGate(t).length===0).sort((a,b)=>score(b)-score(a)).slice(0,TOP_SIGNALS);
 const blocked=verified.filter(t=>t.gate.length||positionGate(t).length).map(t=>({venue:t.venue,name:t.name,reasons:[...t.gate,...(t.gate.length?[]:positionGate(t))]}));
 const state={version:VERSION,updatedAt:Date.now(),sources:statuses,discovered:all.length,verified:verified.length,signals:signals.length,signalsSnapshot:signals.map(x=>({source:x.source,traderId:x.traderId,name:x.name,position:x.position,stats:x.stats,score:score(x)}))};await writeJson(STATE_FILE,state);await writeJson(CACHE_FILE,{generatedAt:Date.now(),candidates:all.slice(0,DISCOVERY_LIMIT),version:VERSION});
 const text=report(statuses,all,verified,signals,blocked,(Date.now()-start)/1000);console.log(text);await telegram(text);
}
main().catch(e=>{console.error('[FATAL]',e);process.exitCode=1;});
