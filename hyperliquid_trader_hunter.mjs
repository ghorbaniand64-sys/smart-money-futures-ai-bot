import fs from 'node:fs/promises';

const CFG = Object.freeze({
  apiUrl: process.env.HYPERLIQUID_API_URL || 'https://api.hyperliquid.xyz/info',
  sourceUrl: process.env.HYPERLIQUID_HUNTER_SOURCE_URL || 'https://hyperstats.org/traders',
  pages: Math.max(1, Math.min(10, Number(process.env.HYPERLIQUID_HUNTER_PAGES || 6))),
  pageSize: 50,
  lookbackDays: Math.max(7, Number(process.env.HYPERLIQUID_HUNTER_LOOKBACK_DAYS || 7)),
  minClosed: Math.max(30, Number(process.env.HYPERLIQUID_HUNTER_MIN_CLOSED_TRADES || 30)),
  maxClosed: Math.max(40, Number(process.env.HYPERLIQUID_HUNTER_MAX_CLOSED_TRADES || 50000)),
  minWinRate: Number(process.env.HYPERLIQUID_HUNTER_MIN_WR || 65),
  maxMedianHoldHours: Number(process.env.HYPERLIQUID_HUNTER_MAX_MEDIAN_HOLD_HOURS || 6),
  maxAvgHoldHours: Number(process.env.HYPERLIQUID_HUNTER_MAX_AVG_HOLD_HOURS || 12),
  minActiveDays: Number(process.env.HYPERLIQUID_HUNTER_MIN_ACTIVE_DAYS || 4),
  minProfitFactor: Number(process.env.HYPERLIQUID_HUNTER_MIN_PF || 1.5),
  maxLosingStreak: Number(process.env.HYPERLIQUID_HUNTER_MAX_LOSING_STREAK || 8),
  maxLiquidations: Number(process.env.HYPERLIQUID_HUNTER_MAX_LIQUIDATIONS || 1),
  minRealizedPnl: Number(process.env.HYPERLIQUID_HUNTER_MIN_PNL || 0),
  concurrency: Math.max(1, Math.min(8, Number(process.env.HYPERLIQUID_HUNTER_CONCURRENCY || 4))),
  stateFile: process.env.HYPERLIQUID_HUNTER_STATE_FILE || 'state/hyperliquid_trader_hunter.json',
  telegramToken: process.env.TELEGRAM_TOKEN || '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
});

const SEEDS = [
  '0x7e1ad5e2bbe30d6d202e7c41036ea0a07c560be9',
  '0xe31501c472d557bfa145ce105d325fb2dd4cb867',
  '0xa32533a01bfca623badfaba89fa28c079b8671f7',
  '0xdb42ab87ac1f9f0d6d83dd82ff49137ab70f631d',
  '0xe86351e0f69bd808def36e7bb2f9107443838bb8',
  '0x350e33a777d510616fbdb483d1de3b50d1edfcfb',
  '0xbf732ea04197942783e34730ed6e0f6099575d58',
  '0xf29c6bc1147a841519b382459a6d7a373c6b9971',
  '0xe867fbdad3291530e41530301ecb77693850c78e',
  '0x469e9a7f624b04c24f0e64edf8d8a277e6bf58a5',
  '0xa9b95f2a2e7ef219021efc5c04c32761b8553bbd',
  '0x69443708e5135532d435b7d1a3b7e6bdc481a800',
  '0xcd87ea212314217b6aa64fdffb9954330db5de4f',
  '0xcfeefe744f867f45f3a324a73cadbda1fa309f91',
  '0x1081e214bd6f0137234b92432d9b6033b88965b7',
  '0x15afd3d10cb7544c76e53c4098295cf4268edbf8',
  '0x6807f127eaf85e3d0b9dbc7971bbed2afd041f8d',
  '0x984d622f98e0d423eed96a873b1c545eb934f1a1',
];

function n(v, d=0){ const x=Number(v); return Number.isFinite(x)?x:d; }
function short(a){ return `${a.slice(0,6)}…${a.slice(-4)}`; }
function money(v){ return `${v>=0?'+':'-'}$${Math.abs(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`; }
function fmtHours(h){ if(h==null||!Number.isFinite(h)) return 'N/A'; return h<48?`${h.toFixed(1)}h`:`${(h/24).toFixed(1)}d`; }
function median(a){ if(!a.length) return null; const x=[...a].sort((a,b)=>a-b); const m=Math.floor(x.length/2); return x.length%2?x[m]:(x[m-1]+x[m])/2; }
function percentile(a,p){ if(!a.length) return null; const x=[...a].sort((a,b)=>a-b); const i=(x.length-1)*p; const lo=Math.floor(i), hi=Math.ceil(i); return lo===hi?x[lo]:x[lo]+(x[hi]-x[lo])*(i-lo); }
function validAddress(a){ return /^0x[a-f0-9]{40}$/i.test(a); }

async function post(body){
  const r=await fetch(CFG.apiUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const t=await r.text();
  if(!r.ok) throw new Error(`Hyperliquid HTTP ${r.status}: ${t.slice(0,250)}`);
  return JSON.parse(t);
}

async function getState(user){ return post({type:'clearinghouseState',user}); }

async function getFillsPaginated(user,start,end){
  const out=[]; let cursor=start; let pages=0;
  while(cursor<=end && pages<20){
    const rows=await post({type:'userFillsByTime',user,startTime:cursor,endTime:end,aggregateByTime:false});
    pages++;
    if(!Array.isArray(rows)||!rows.length) break;
    out.push(...rows);
    const last=Math.max(...rows.map(x=>n(x.time)));
    if(!last || last<cursor) break;
    if(last>=end || rows.length<2000) break;
    cursor=last+1;
  }
  const seen=new Set();
  return out.filter(f=>{
    const key=`${f.tid??''}|${f.hash??''}|${f.time??''}|${f.coin??''}|${f.sz??''}|${f.px??''}`;
    if(seen.has(key)) return false; seen.add(key); return true;
  }).sort((a,b)=>n(a.time)-n(b.time));
}

function discoverAddresses(html){
  const out=[]; const seen=new Set();
  const re=/\/wallet\/(0x[a-fA-F0-9]{40})/g;
  let m;
  while((m=re.exec(html))){ const a=m[1].toLowerCase(); if(!seen.has(a)){seen.add(a);out.push(a);} }
  // Some pages render the address without the /wallet/ path.
  const re2=/\b(0x[a-fA-F0-9]{40})\b/g;
  while((m=re2.exec(html))){ const a=m[1].toLowerCase(); if(!seen.has(a)){seen.add(a);out.push(a);} }
  return out;
}

async function discover(){
  const found=[]; const seen=new Set();
  const add=a=>{a=String(a||'').trim().toLowerCase(); if(validAddress(a)&&!seen.has(a)){seen.add(a);found.push(a);}};
  for(const a of SEEDS) add(a);
  const envSeeds=(process.env.HYPERLIQUID_HUNTER_ADDRESSES||'').split(',').map(x=>x.trim()).filter(Boolean);
  envSeeds.forEach(add);
  let sourceOk=0;
  for(let page=1; page<=CFG.pages; page++){
    const urls=[`${CFG.sourceUrl}?page=${page}`, page===1?CFG.sourceUrl:null].filter(Boolean);
    let html='';
    for(const u of urls){
      try{ const r=await fetch(u,{headers:{'user-agent':'Mozilla/5.0 HyperliquidTraderHunter/1.0'}}); if(r.ok){html=await r.text();break;} }catch(_e){}
    }
    if(!html) continue;
    sourceOk++;
    for(const a of discoverAddresses(html)) add(a);
  }
  return {addresses:found,sourceOk};
}

function signedDelta(f){
  const side=String(f.side||'').toUpperCase();
  const sz=Math.abs(n(f.sz));
  return side==='B'?sz:side==='A'?-sz:0;
}

// Position-level reconstruction. Hyperliquid's startPosition + side are used
// instead of relying on dir text. A logical trade is counted only when the
// coin returns to flat; partial closes stay inside the same round-trip.
function reconstructTrades(fills){
  const byCoin=new Map();
  const trades=[];
  for(const f of [...fills].sort((a,b)=>n(a.time)-n(b.time))){
    const coin=String(f.coin||'UNKNOWN');
    const time=n(f.time); if(!time) continue;
    const delta=signedDelta(f); if(!delta) continue;
    const start=n(f.startPosition);
    let p=byCoin.get(coin);
    if(!p){ p={side:delta>0?'LONG':'SHORT',size:0,openTime:time,openedNotional:0,closePnl:0,closeFees:0,adds:0,closes:0}; }

    // If API says the prior position was flat, this starts a new logical trade.
    if(Math.abs(start)<1e-12 || p.size<=1e-12){
      p={side:delta>0?'LONG':'SHORT',size:0,openTime:time,openedNotional:0,closePnl:0,closeFees:0,adds:0,closes:0};
    }

    const prevSize=Math.abs(start);
    const prevSign=Math.sign(start);
    const newSigned=start+delta;
    const newSign=Math.sign(newSigned);
    const increasing = prevSign===0 || Math.sign(delta)===prevSign;

    if(increasing){
      p.size=Math.abs(newSigned);
      p.openedNotional += Math.abs(delta*n(f.px));
      p.adds += prevSign===0?0:1;
    }else{
      p.closePnl += n(f.closedPnl);
      p.closeFees += Math.abs(n(f.fee));
      p.closes++;
      p.size=Math.abs(newSigned);
    }

    if(Math.abs(newSigned)<1e-12){
      trades.push({
        coin,direction:p.side,openTime:p.openTime,closeTime:time,
        holdMs:Math.max(0,time-p.openTime),
        realizedPnl:p.closePnl,
        fees:p.closeFees,
        openedNotional:p.openedNotional,
        closes:p.closes, adds:p.adds
      });
      byCoin.delete(coin);
    }else if(prevSign!==0 && newSign!==prevSign){
      // Flip: close the old side and immediately start the new side. Hyperliquid
      // can encode a flip as one fill whose end position has the opposite sign.
      trades.push({
        coin,direction:p.side,openTime:p.openTime,closeTime:time,
        holdMs:Math.max(0,time-p.openTime),realizedPnl:p.closePnl,fees:p.closeFees,
        openedNotional:p.openedNotional,closes:p.closes,adds:p.adds
      });
      byCoin.set(coin,{side:newSigned>0?'LONG':'SHORT',size:Math.abs(newSigned),openTime:time,
        openedNotional:Math.abs(newSigned*n(f.px)),closePnl:0,closeFees:0,adds:0,closes:0});
    }else{
      byCoin.set(coin,p);
    }
  }
  return trades;
}

function maxLosingStreak(trades){
  let cur=0,max=0; for(const t of trades){ if(t.realizedPnl<0){cur++;max=Math.max(max,cur);} else if(t.realizedPnl>0) cur=0; } return max;
}

function stats(fills,trades){
  const cutoff=Date.now()-CFG.lookbackDays*86400000;
  const liquidations=fills.filter(f=>n(f.time)>=cutoff && /liquidat/i.test(String(f.dir||''))).length;
  const recent=trades.filter(t=>t.closeTime>=cutoff);
  const decided=recent.filter(t=>t.realizedPnl!==0);
  const wins=decided.filter(t=>t.realizedPnl>0).length;
  const losses=decided.filter(t=>t.realizedPnl<0).length;
  const pnl=recent.reduce((s,t)=>s+t.realizedPnl,0);
  const grossWin=recent.filter(t=>t.realizedPnl>0).reduce((s,t)=>s+t.realizedPnl,0);
  const grossLoss=Math.abs(recent.filter(t=>t.realizedPnl<0).reduce((s,t)=>s+t.realizedPnl,0));
  const pf=grossLoss>0?grossWin/grossLoss:(grossWin>0?Infinity:null);
  const holds=recent.map(t=>t.holdMs/3600000).filter(Number.isFinite);
  const activeDays=new Set(recent.map(t=>new Date(t.closeTime).toISOString().slice(0,10))).size;
  const winsOnly=recent.filter(t=>t.realizedPnl>0).map(t=>t.realizedPnl);
  const lossesOnly=recent.filter(t=>t.realizedPnl<0).map(t=>Math.abs(t.realizedPnl));
  const avgWin=winsOnly.length?winsOnly.reduce((a,b)=>a+b,0)/winsOnly.length:null;
  const avgLoss=lossesOnly.length?lossesOnly.reduce((a,b)=>a+b,0)/lossesOnly.length:null;
  const fillVolume=fills.reduce((s,f)=>s+Math.abs(n(f.px)*n(f.sz)),0);
  const long=recent.filter(t=>t.direction==='LONG');
  const short=recent.filter(t=>t.direction==='SHORT');
  const sideWr=arr=>{const d=arr.filter(t=>t.realizedPnl!==0);return d.length?d.filter(t=>t.realizedPnl>0).length/d.length*100:null;};
  const wr=decided.length?wins/decided.length*100:null;
  const medianHold=median(holds), avgHold=holds.length?holds.reduce((a,b)=>a+b,0)/holds.length:null;
  const p90Hold=percentile(holds,.9);
  const tradesPerDay=recent.length/CFG.lookbackDays;
  const targetRate=Math.min(1,recent.length/40);
  const score =
    (wr==null?0:Math.max(0,Math.min(100,(wr-50)/50))*35) +
    Math.max(0,Math.min(1,(CFG.maxMedianHoldHours/(medianHold||999))))*20 +
    Math.max(0,Math.min(1,pf==null?0:(pf-1)/4))*15 +
    Math.max(0,Math.min(1,targetRate))*10 +
    Math.max(0,Math.min(1,activeDays/7))*10 +
    (maxLosingStreak(recent)<=CFG.maxLosingStreak?5:0) +
    (liquidations<=CFG.maxLiquidations?5:0);

  const hardPass = recent.length>=CFG.minClosed && wr!=null && wr>=CFG.minWinRate && pnl>CFG.minRealizedPnl &&
    pf!=null && pf>=CFG.minProfitFactor && medianHold!=null && medianHold<=CFG.maxMedianHoldHours &&
    avgHold!=null && avgHold<=CFG.maxAvgHoldHours && activeDays>=CFG.minActiveDays && maxLosingStreak(recent)<=CFG.maxLosingStreak && liquidations<=CFG.maxLiquidations;

  return {closed7d:recent.length,decided,wins,losses,winRate:wr,realizedPnl:pnl,profitFactor:pf,
    avgHoldHours:avgHold,medianHoldHours:medianHold,p90HoldHours:p90Hold,activeDays,tradesPerDay,
    maxLosingStreak:maxLosingStreak(recent),liquidations,avgWin,avgLoss,longWinRate:sideWr(long),shortWinRate:sideWr(short),
    longTrades:long.length,shortTrades:short.length,fillVolume,score,hardPass};
}

function status(r){ if(r.error) return '🔴 ERROR'; if(r.stats.hardPass) return '🟢 PASS'; if(r.stats.closed7d<CFG.minClosed) return '⚪ SAMPLE<30'; return '🟡 FILTERED'; }
function buildReport(results,meta){
  const pass=results.filter(r=>!r.error&&r.stats.hardPass).slice(0,5);
  const lines=['🔎 HYPERLIQUID TRADER HUNTER V1','━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',`📡 READ-ONLY | Discovery candidates ${meta.discovered}`,
    `🧪 Exact ${CFG.lookbackDays}D closed-trade analysis | Hard filters active`,
    `🎯 Target: ≥${CFG.minClosed} closed | WR ≥${CFG.minWinRate}% | Median ≤${CFG.maxMedianHoldHours}h | Avg ≤${CFG.maxAvgHoldHours}h | PF ≥${CFG.minProfitFactor} | Active ≥${CFG.minActiveDays}/7 | Liq ≤${CFG.maxLiquidations}`,
    ''];
  if(pass.length){ lines.push(`🏆 ${pass.length} QUALIFIED CANDIDATE(S)`); pass.forEach((r,i)=>{
    const s=r.stats; lines.push(`${i+1}. ${r.address} | Score ${s.score.toFixed(1)} | PASS`);
    lines.push(`   7D closed ${s.closed7d} | WR ${s.winRate.toFixed(1)}% | PnL ${money(s.realizedPnl)} | PF ${Number.isFinite(s.profitFactor)?s.profitFactor.toFixed(2):'∞'}`);
    lines.push(`   Hold median ${fmtHours(s.medianHoldHours)} | avg ${fmtHours(s.avgHoldHours)} | p90 ${fmtHours(s.p90HoldHours)} | ${s.tradesPerDay.toFixed(1)}/day`);
    lines.push(`   Active ${s.activeDays}/7 | Max losing streak ${s.maxLosingStreak} | Liq ${s.liquidations} | L ${s.longWinRate==null?'N/A':s.longWinRate.toFixed(1)+'%'} (${s.longTrades}) | S ${s.shortWinRate==null?'N/A':s.shortWinRate.toFixed(1)+'%'} (${s.shortTrades})`);
  }); lines.push(''); }
  else lines.push('⚠️ No wallet passed all hard filters in this scan.');
  lines.push('');
  lines.push('📋 TOP 10 AFTER EXACT 7D SCREEN');
  results.filter(r=>!r.error).slice(0,10).forEach((r,i)=>{const s=r.stats;lines.push(`${i+1}. ${short(r.address)} | ${status(r)} | ${s.closed7d} trades | WR ${s.winRate==null?'N/A':s.winRate.toFixed(1)+'%'} | PnL ${money(s.realizedPnl)} | med ${fmtHours(s.medianHoldHours)} | PF ${s.profitFactor==null?'N/A':Number.isFinite(s.profitFactor)?s.profitFactor.toFixed(2):'∞'} | Liq ${s.liquidations}`);});
  lines.push('');
  lines.push('ℹ️ Closed trade = coin position returned to flat; partial closes are aggregated into one round-trip.');
  lines.push('ℹ️ Discovery is read-only. No orders, keys, or execution calls are used.');
  if(meta.sourceOk===0) lines.push('⚠️ HyperStats discovery page was not reachable; seed addresses were still scanned.');
  return lines.join('\n');
}

async function telegram(text){
  if(!CFG.telegramToken||!CFG.telegramChatId){console.error('[TELEGRAM] CONFIG MISSING');return false;}
  const url=`https://api.telegram.org/bot${CFG.telegramToken}/sendMessage`;
  const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:CFG.telegramChatId,text,disable_web_page_preview:true})});
  const body=await r.text(); if(!r.ok){console.error('[TELEGRAM] HTTP',r.status,body);return false;} console.log('[TELEGRAM] SENT');return true;
}

async function mapLimit(items,limit,fn){
  const out=new Array(items.length); let next=0;
  async function worker(){ while(true){ const i=next++; if(i>=items.length) return; try{out[i]=await fn(items[i],i);}catch(e){out[i]={address:items[i],error:e?.message||String(e),stats:{score:0,closed7d:0}};} } }
  await Promise.all(Array.from({length:Math.min(limit,items.length)},worker)); return out;
}

async function main(){
  const {addresses,sourceOk}=await discover();
  const end=Date.now(), start=end-CFG.lookbackDays*86400000;
  console.log(`[HUNTER] candidates=${addresses.length} pages=${CFG.pages} sourceOk=${sourceOk}`);
  const results=await mapLimit(addresses,CFG.concurrency,async address=>{
    const [fills,state]=await Promise.all([getFillsPaginated(address,start,end),getState(address)]);
    const trades=reconstructTrades(fills);
    const st=stats(fills,trades);
    return {address,stats:st,positions:(state?.assetPositions||[]).filter(x=>Math.abs(n(x?.position?.szi??x?.szi))>0).length};
  });
  results.sort((a,b)=>n(b.stats.score)-n(a.stats.score));
  const report=buildReport(results,{discovered:addresses.length,sourceOk});
  console.log('\n'+report+'\n');
  await fs.mkdir(CFG.stateFile.split('/').slice(0,-1).join('/')||'.',{recursive:true});
  await fs.writeFile(CFG.stateFile,JSON.stringify({generatedAt:new Date().toISOString(),config:{...CFG,telegramToken:undefined,telegramChatId:undefined},discovery:{count:addresses.length,sourceOk},results},null,2));
  const sent=await telegram(report); if(!sent) process.exitCode=2;
}

main().catch(async e=>{console.error('[FATAL]',e?.stack||e);await telegram(`🔴 HYPERLIQUID TRADER HUNTER ERROR\n━━━━━━━━━━━━━━━━━━\n${e?.message||e}`);process.exitCode=1;});
