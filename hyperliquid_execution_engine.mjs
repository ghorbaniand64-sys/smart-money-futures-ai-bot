// Hyperliquid Meme Hunter Execution Engine V8.6.9 — FIXED-3 SAFE LIVE
// Consumes the Fixed-3 Best-Entry handoff. Live orders are explicit opt-in only.
// Safety limits: max 2 simultaneous positions, 50% account margin per position, isolated 10x leverage.

import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import * as hl from '@nktkas/hyperliquid';
import { privateKeyToAccount } from 'viem/accounts';

const INFO = process.env.HYPERLIQUID_API_URL || 'https://api.hyperliquid.xyz/info';
const HANDOFF_PATH = process.env.HYPERLIQUID_EXECUTION_HANDOFF_PATH || 'state/meme_execution_handoff.json';
const EXECUTION_ENABLED = String(process.env.EXECUTION_ENABLED ?? 'false').toLowerCase() === 'true';
const REQUESTED_DRY_RUN = String(process.env.EXECUTION_DRY_RUN ?? 'true').toLowerCase() !== 'false';
// Live execution is opt-in only. PAPER_EXECUTION_ONLY is an explicit emergency
// kill-switch; it must never be silently enabled by a missing environment variable.
const PAPER_EXECUTION_ONLY = String(process.env.PAPER_EXECUTION_ONLY ?? 'false').toLowerCase() === 'true';
const DRY_RUN = PAPER_EXECUTION_ONLY || REQUESTED_DRY_RUN;
const ACCOUNT = String(process.env.HYPERLIQUID_ACCOUNT_ADDRESS || '').trim().toLowerCase();
const AGENT_KEY = String(process.env.HYPERLIQUID_AGENT_PRIVATE_KEY || '').trim();
const MAX_HANDOFF_AGE_MS = Number(process.env.EXECUTION_HANDOFF_TTL_MS || 90000);
const MAX_SOURCE_ENTRY_DISTANCE_PCT = Number(process.env.EXECUTION_MAX_SOURCE_ENTRY_DISTANCE_PCT || 0.5);
const MAX_REVALIDATION_MOVE_PCT = Number(process.env.EXECUTION_MAX_REVALIDATION_MOVE_PCT || 0.35);
const SLIPPAGE_BPS = Number(process.env.EXECUTION_SLIPPAGE_BPS || 50);
const ACCOUNT_ALLOCATION_PCT = Number(process.env.EXECUTION_ACCOUNT_ALLOCATION_PCT || 50);
const MAX_ACCOUNT_ALLOCATION_PCT = Number(process.env.EXECUTION_MAX_ACCOUNT_ALLOCATION_PCT || 50);
const TARGET_LEVERAGE = Number(process.env.EXECUTION_LEVERAGE || 10);
const MAX_LEVERAGE = Number(process.env.EXECUTION_MAX_LEVERAGE || 10);
const MAX_SIMULTANEOUS_POSITIONS = Number(process.env.EXECUTION_MAX_SIMULTANEOUS_POSITIONS || 2);
const PAPER_LEVERAGE = Number(process.env.PAPER_LEVERAGE || 10);
const PAPER_ACCOUNT_ALLOCATION_PCT = Number(process.env.PAPER_ACCOUNT_ALLOCATION_PCT || 50);
const MIN_RR = Number(process.env.EXECUTION_MIN_RR || 1.5);
const SL_ATR = Number(process.env.EXECUTION_SL_ATR_MULT || 1.2);
const TP_ATR = Number(process.env.EXECUTION_TP_ATR_MULT || 2.0);
const MAX_SL_PCT = Number(process.env.EXECUTION_MAX_SL_PCT || 2.0);
const REQUIRE_MEME = String(process.env.EXECUTION_REQUIRE_MEME || 'true').toLowerCase() !== 'false';
const REQUIRE_HANDOFF_READY = String(process.env.EXECUTION_REQUIRE_HANDOFF_READY || 'true').toLowerCase() !== 'false';
const STATE_PATH = process.env.EXECUTION_STATE_PATH || 'state/execution_state.json';
const MAINNET = String(process.env.HYPERLIQUID_TESTNET || 'false').toLowerCase() !== 'true';
const API_URL = INFO.replace(/\/info\/?$/, '');
const TG_TOKEN = String(process.env.TELEGRAM_TOKEN || '').trim();
const TG_CHAT = String(process.env.TELEGRAM_CHAT_ID || '').trim();
const TELEGRAM_ENABLED = String(process.env.EXECUTION_TELEGRAM_ENABLED ?? 'true').toLowerCase() !== 'false';
const FILL_CONFIRM_TIMEOUT_MS = Number(process.env.EXECUTION_FILL_CONFIRM_TIMEOUT_MS || 12000);
const FILL_CONFIRM_POLL_MS = Number(process.env.EXECUTION_FILL_CONFIRM_POLL_MS || 1200);

function log(x){ console.log(`[EXECUTION] ${x}`); }
function num(x){ const n=Number(x); return Number.isFinite(n)?n:NaN; }
function validAddr(x){ return /^0x[a-f0-9]{40}$/.test(String(x||'').toLowerCase()); }
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function clamp(x,a,b){ return Math.max(a,Math.min(b,x)); }
function sideFromSize(szi){ return Number(szi)>0?'LONG':'SHORT'; }
function fmt(x,d=4){ return Number.isFinite(Number(x))?Number(x).toFixed(d):'n/a'; }
function pct(x,d=2){ return Number.isFinite(Number(x))?`${Number(x).toFixed(d)}%`:'n/a'; }

async function telegram(text){
  if(!TELEGRAM_ENABLED || !TG_TOKEN || !TG_CHAT){ log('[TELEGRAM] skipped: credentials disabled/missing'); return false; }
  try{
    const res=await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:TG_CHAT,text:String(text).slice(0,3900),disable_web_page_preview:true})});
    if(!res.ok) throw new Error(`TELEGRAM_HTTP_${res.status}`);
    const body=await res.json();
    if(body?.ok!==true) throw new Error('TELEGRAM_SEND_FAILED');
    return true;
  }catch(e){ log(`[TELEGRAM][ERROR] ${e.message||e}`); return false; }
}

async function loadStateSafe(){ try{return JSON.parse(await fs.readFile(STATE_PATH,'utf8'));}catch{return null;} }

async function confirmOwnPosition(coin,side){
  const started=Date.now();
  while(Date.now()-started<=FILL_CONFIRM_TIMEOUT_MS){
    const pos=await currentPosition(ACCOUNT,coin).catch(()=>null);
    if(pos && sideFromSize(pos.szi)===side && Math.abs(num(pos.szi)||0)>0 && num(pos.entryPx)>0) return pos;
    await sleep(FILL_CONFIRM_POLL_MS);
  }
  return null;
}

function protectionOids(protectionResult){
  const out=[];
  for(const st of statusList(protectionResult)){
    for(const key of ['resting','triggered']){
      const oid=st?.[key]?.oid;
      if(oid!=null) out.push(String(oid));
    }
  }
  return out;
}

async function closingFills(coin,sinceMs){
  try{
    const rows=await info({type:'userFillsByTime',user:ACCOUNT,startTime:Math.max(0,Number(sinceMs||0)-5000),endTime:Date.now(),aggregateByTime:false});
    return (Array.isArray(rows)?rows:[]).filter(f=>String(f?.coin||'')===coin && Number(f?.time||0)>=Number(sinceMs||0));
  }catch{return [];}
}

async function reconcileClosedPosition(previous){
  if(!previous?.activePosition?.coin)return;
  const p=previous.activePosition;
  const live=await currentPosition(ACCOUNT,p.coin).catch(()=>null);
  if(live && Math.abs(num(live.szi)||0)>0)return;
  const fills=await closingFills(p.coin,p.openedAt);
  const pnl=fills.reduce((a,f)=>a+(Number(f?.closedPnl)||0),0);
  const protectedOids=new Set((p.protectionOids||[]).map(String));
  const matched=fills.filter(f=>protectedOids.has(String(f?.oid)));
  const reason=matched.some(f=>String(f?.oid)===String(p.slOid))?'🛑 SL':matched.some(f=>String(f?.oid)===String(p.tpOid))?'🎯 TP':'🔴 CLOSED';
  const exitFill=fills.slice().sort((a,b)=>Number(b?.time||0)-Number(a?.time||0))[0];
  await telegram(`${reason} HYPERLIQUID TRADE CLOSED\n━━━━━━━━━━━━━━━━━━\n🪙 ${p.coin} | ${p.side}\n👤 Trader: ${p.trader||'n/a'}\n📥 Entry: ${fmt(p.entry)}\n📤 Exit: ${exitFill?.px?fmt(num(exitFill.px)):'n/a'}\n💰 Realized PnL: $${fmt(pnl,2)}\n📦 Closed fills: ${fills.length}\n⚡ Leverage: ${p.leverage||10}x\n🕐 ${new Date(p.openedAt).toISOString()}`);
}

async function readJson(path){
  try {
    return JSON.parse(await fs.readFile(path,'utf8'));
  } catch (e) {
    if (e?.code === 'ENOENT') throw new Error('NO_EXECUTION_HANDOFF');
    if (e instanceof SyntaxError) throw new Error('HANDOFF_INVALID_JSON');
    throw e;
  }
}
async function writeJson(path,obj){ await fs.mkdir(new URL('.',`file://${process.cwd()}/${path}`).pathname,{recursive:true}).catch(()=>{}); await fs.writeFile(path,JSON.stringify(obj,null,2)+'\n'); }

async function info(payload){
  const res=await fetch(`${API_URL}/info`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
  if(!res.ok)throw new Error(`INFO_HTTP_${res.status}`);
  return res.json();
}

async function currentPosition(user,coin){
  const s=await info({type:'clearinghouseState',user});
  const ps=(Array.isArray(s?.assetPositions)?s.assetPositions:[]).map(x=>x?.position).filter(Boolean);
  return ps.find(p=>String(p?.coin||'')===coin && Math.abs(num(p?.szi)||0)>0)||null;
}

async function allMids(){ return info({type:'allMids'}); }
async function book(coin){
  const b=await info({type:'l2Book',coin});
  const levels=Array.isArray(b?.levels)?b.levels:[];
  const bids=Array.isArray(levels[0])?levels[0]:[];
  const asks=Array.isArray(levels[1])?levels[1]:[];
  const bid=num(bids?.[0]?.px), ask=num(asks?.[0]?.px);
  if(!(bid>0&&ask>0))throw new Error(`BOOK_UNAVAILABLE:${coin}`);
  return {bid,ask,mid:(bid+ask)/2};
}

async function metaAsset(coin){
  const m=await info({type:'meta'});
  const universe=Array.isArray(m?.universe)?m.universe:[];
  const i=universe.findIndex(x=>String(x?.name||'')===coin);
  if(i<0)throw new Error(`UNKNOWN_ASSET:${coin}`);
  return {assetIndex:i,szDecimals:Number(universe[i]?.szDecimals||0),maxLeverage:Number(universe[i]?.maxLeverage||0)};
}

async function accountState(){
  if(!validAddr(ACCOUNT))throw new Error('HYPERLIQUID_ACCOUNT_ADDRESS_INVALID_OR_MISSING');
  const s=await info({type:'clearinghouseState',user:ACCOUNT});
  const accountValue=num(s?.marginSummary?.accountValue);
  if(!(accountValue>0))throw new Error('ACCOUNT_VALUE_UNAVAILABLE');
  const positions=(Array.isArray(s?.assetPositions)?s.assetPositions:[]).map(x=>x?.position).filter(Boolean);
  return {raw:s,accountValue,positions};
}

async function openOrders(){ return info({type:'openOrders',user:ACCOUNT}); }
async function historicalOrders(){ return info({type:'historicalOrders',user:ACCOUNT}); }

function deterministicCloid(address,coin,sourceEntry){
  const raw=`MEME-HUNTER:${address}:${coin}:${Number(sourceEntry).toFixed(8)}:${new Date().toISOString().slice(0,10)}`;
  return `0x${crypto.createHash('sha256').update(raw).digest('hex').slice(0,32)}`;
}

function formatPrice(price,szDecimals){
  if(!(price>0))throw new Error('INVALID_PRICE');
  const maxDecimals=Math.max(6-Number(szDecimals||0),0);
  const sig=Number(price.toPrecision(5));
  // Hyperliquid price rules use up to 5 significant figures AND a maximum
  // decimal count derived from szDecimals. Never allow a tiny price to round
  // silently to zero; fail closed if the market's precision cannot represent it.
  const fixed=Number(sig.toFixed(maxDecimals));
  if(!(fixed>0))throw new Error(`PRICE_PRECISION_UNREPRESENTABLE:${price}:szDecimals=${szDecimals}`);
  return fixed.toFixed(maxDecimals).replace(/\.?0+$/,'');
}
function formatSize(size,szDecimals){
  if(!(size>0))throw new Error('INVALID_SIZE');
  return Number(size).toFixed(szDecimals).replace(/\.?0+$/,'');
}

async function atr(coin,end){
  const c=await info({type:'candleSnapshot',req:{coin,interval:'1h',startTime:end-96*3600000,endTime:end}});
  const rows=(Array.isArray(c)?c:[]).map(x=>({h:num(x?.h),l:num(x?.l),c:num(x?.c)})).filter(x=>x.h>x.l&&x.h>0&&x.l>0);
  if(rows.length<20)throw new Error(`ATR_INSUFFICIENT:${rows.length}`);
  let prev=NaN; const tr=[];
  for(const r of rows){ tr.push(Number.isFinite(prev)?Math.max(r.h-r.l,Math.abs(r.h-prev),Math.abs(r.l-prev)):r.h-r.l); prev=r.c; }
  const recent=tr.slice(-72); return recent.reduce((a,b)=>a+b,0)/recent.length;
}

function planPrices(side,entry,atrValue){
  const risk=Math.min(SL_ATR*atrValue,entry*MAX_SL_PCT/100);
  const sl=side==='LONG'?entry-risk:entry+risk;
  const tp=side==='LONG'?entry+TP_ATR*atrValue:entry-TP_ATR*atrValue;
  const reward=Math.abs(tp-entry), riskAbs=Math.abs(entry-sl);
  const rr=riskAbs>0?reward/riskAbs:0;
  return {sl,tp,rr,riskAbs};
}

async function buildCandidate(handoff){
  if(!handoff || !Array.isArray(handoff.candidates))throw new Error('HANDOFF_INVALID');
  const now=Date.now();
  if(!Number.isFinite(num(handoff.createdAt)) || now-num(handoff.createdAt)>MAX_HANDOFF_AGE_MS)throw new Error('HANDOFF_EXPIRED');
  const ready=handoff.candidates.filter(x=>x?.executionReady && validAddr(x.address));
  if(REQUIRE_HANDOFF_READY && !ready.length)throw new Error('NO_LIVEREADY_CANDIDATE');
  const src=ready[0];
  if(!src.position?.coin || !src.position?.side)throw new Error('HANDOFF_POSITION_MISSING');
  const trader=src.address.toLowerCase();
  const coin=String(src.position.coin);
  const side=String(src.position.side).toUpperCase();
  if(REQUIRE_MEME && src.position.isMeme===false)throw new Error('POSITION_NOT_CONFIRMED_MEME');
  const sourceEntry=num(src.position.entry);
  if(!(sourceEntry>0))throw new Error('SOURCE_ENTRY_INVALID');
  const pos=await currentPosition(trader,coin);
  if(!pos)throw new Error('SOURCE_POSITION_CLOSED');
  const liveSide=sideFromSize(pos.szi);
  const liveEntry=num(pos.entryPx);
  if(liveSide!==side)throw new Error(`SOURCE_DIRECTION_CHANGED:${side}->${liveSide}`);
  const liveBook=await book(coin);
  const sourceDistance=Math.abs(liveBook.mid-sourceEntry)/sourceEntry*100;
  if(sourceDistance>MAX_SOURCE_ENTRY_DISTANCE_PCT)throw new Error(`SOURCE_ENTRY_DISTANCE>${MAX_SOURCE_ENTRY_DISTANCE_PCT}%`);
  const entryMove=Math.abs(liveBook.mid-num(src.position.mid||liveBook.mid))/num(src.position.mid||liveBook.mid)*100;
  if(entryMove>MAX_REVALIDATION_MOVE_PCT)throw new Error(`REVALIDATION_MOVE>${MAX_REVALIDATION_MOVE_PCT}%`);
  const acct=await accountState();
  const livePositions=acct.positions.filter(p=>Math.abs(num(p?.szi)||0)>0);
  if(livePositions.length>=MAX_SIMULTANEOUS_POSITIONS)throw new Error(`MAX_SIMULTANEOUS_POSITIONS:${MAX_SIMULTANEOUS_POSITIONS}`);
  const ownCoin=livePositions.find(p=>String(p?.coin||'')===coin);
  if(ownCoin)throw new Error('OWN_POSITION_ALREADY_EXISTS');
  const orders=await openOrders();
  if((Array.isArray(orders)?orders:[]).some(o=>String(o?.coin||'')===coin))throw new Error('OWN_OPEN_ORDER_ALREADY_EXISTS');
  const cloid=deterministicCloid(trader,coin,sourceEntry);
  const history=await historicalOrders();
  if((Array.isArray(history)?history:[]).some(x=>String(x?.order?.cloid||'').toLowerCase()===cloid.toLowerCase()))throw new Error('DUPLICATE_CLOID_ALREADY_USED');
  const asset=await metaAsset(coin);
  const lev=num(pos?.leverage?.value||pos?.leverageValue||pos?.leverage||0);
  if(TARGET_LEVERAGE>asset.maxLeverage)throw new Error(`TARGET_LEVERAGE>${asset.maxLeverage}x_FOR_${coin}`);
  if(TARGET_LEVERAGE>MAX_LEVERAGE)throw new Error(`TARGET_LEVERAGE>${MAX_LEVERAGE}x`);
  if(!(ACCOUNT_ALLOCATION_PCT>0 && ACCOUNT_ALLOCATION_PCT<=MAX_ACCOUNT_ALLOCATION_PCT))throw new Error(`ACCOUNT_ALLOCATION>${MAX_ACCOUNT_ALLOCATION_PCT}%`);
  const margin=acct.accountValue*(ACCOUNT_ALLOCATION_PCT/100);
  const notional=margin*TARGET_LEVERAGE;
  if(!(notional>0))throw new Error('NOTIONAL_ZERO');
  if(!(notional>0))throw new Error('NOTIONAL_ZERO');
  const entryPx=side==='LONG'?liveBook.ask:liveBook.bid;
  const size=notional/entryPx;
  const a=await atr(coin,Date.now());
  const pp=planPrices(side,entryPx,a);
  if(pp.rr<MIN_RR)throw new Error(`RR<${MIN_RR}`);
  if(side==='LONG' && !(pp.sl<entryPx&&pp.tp>entryPx))throw new Error('INVALID_LONG_PROTECTION');
  if(side==='SHORT' && !(pp.sl>entryPx&&pp.tp<entryPx))throw new Error('INVALID_SHORT_PROTECTION');
  return {trader,coin,side,sourceEntry,sourceDistance,liveEntry,market:liveBook,notional,size,asset,sourceLeverage:lev,targetLeverage:TARGET_LEVERAGE,margin,atr:a,cloid,sl:pp.sl,tp:pp.tp,rr:pp.rr,accountValue:acct.accountValue,openPositions:livePositions.length};
}


function statusList(result){
  return Array.isArray(result?.response?.data?.statuses) ? result.response.data.statuses : [];
}
function filledStatus(result){
  const s=statusList(result).find(x=>x && typeof x==='object' && x.filled);
  return s?.filled || null;
}
function orderError(result){
  const s=statusList(result).find(x=>typeof x==='object' && x.error);
  return s?.error || null;
}
function buildProtectionOrders(p,filledSize){
  const closeBuy=p.side==='SHORT';
  const size=formatSize(filledSize,p.asset.szDecimals);
  const slPx=formatPrice(p.sl,p.asset.szDecimals);
  const tpPx=formatPrice(p.tp,p.asset.szDecimals);
  return [
    {a:p.asset.assetIndex,b:closeBuy,p:slPx,s:size,r:true,t:{trigger:{isMarket:true,triggerPx:slPx,tpsl:'sl'}}},
    {a:p.asset.assetIndex,b:closeBuy,p:tpPx,s:size,r:true,t:{trigger:{isMarket:true,triggerPx:tpPx,tpsl:'tp'}}}
  ];
}

async function placeProtection(exchange,p,filledSize){
  const protection=await exchange.order({
    orders:buildProtectionOrders(p,filledSize),
    grouping:'normalTpsl',
    expiresAfter:Date.now()+30000
  });
  const statuses=statusList(protection);
  if(statuses.length<2)throw new Error('PROTECTION_RESPONSE_INCOMPLETE');
  const errors=statuses.filter(x=>typeof x==='object'&&x.error).map(x=>x.error);
  if(errors.length)throw new Error(`PROTECTION_ORDER_REJECTED:${errors.join('|')}`);
  return protection;
}
async function emergencyClose(exchange,p,filledSize){
  const closeBuy=p.side==='SHORT';
  const size=formatSize(filledSize,p.asset.szDecimals);
  const live=await book(p.coin).catch(()=>p.market);
  // Cross the spread in the direction needed to flatten immediately.
  const rawPx=closeBuy ? live.ask*(1+SLIPPAGE_BPS/10000) : live.bid*(1-SLIPPAGE_BPS/10000);
  return exchange.order({
    orders:[{a:p.asset.assetIndex,b:closeBuy,p:formatPrice(rawPx,p.asset.szDecimals),s:size,r:true,t:{limit:{tif:'Ioc'}}}],
    grouping:'na',expiresAfter:Date.now()+30000
  });
}

function assertTest(ok,msg){ if(!ok) throw new Error(`SELF_TEST_FAIL:${msg}`); }
function runSelfTest(){
  assertTest(formatPrice(12345.678,4)==='12346','price_precision');
  let precisionBlocked=false;
  try{ formatPrice(0.0044085,4); }catch(e){ precisionBlocked=String(e.message).startsWith('PRICE_PRECISION_UNREPRESENTABLE'); }
  assertTest(precisionBlocked,'tiny_price_precision_fail_closed');
  assertTest(formatSize(123.456789,3)==='123.457','size_rounding');
  const lp=planPrices('LONG',100,2);
  assertTest(lp.sl<100 && lp.tp>100 && lp.rr>=1.5,'long_protection_rr');
  const sp=planPrices('SHORT',100,2);
  assertTest(sp.sl>100 && sp.tp<100 && sp.rr>=1.5,'short_protection_rr');
  const fake={asset:{assetIndex:7,szDecimals:3},side:'LONG',sl:98,tp:104};
  const po=buildProtectionOrders(fake,1.25);
  assertTest(po.length===2,'protection_count');
  assertTest(po.every(x=>x.r===true),'protection_reduce_only');
  assertTest(po[0].t.trigger.tpsl==='sl' && po[1].t.trigger.tpsl==='tp','protection_types');
  assertTest(po.every(x=>x.b===false),'long_protection_side');
  const c1=deterministicCloid('0x0000000000000000000000000000000000000001','KPEPE',0.1234);
  const c2=deterministicCloid('0x0000000000000000000000000000000000000001','KPEPE',0.1234);
  assertTest(c1===c2 && /^0x[0-9a-f]{32}$/.test(c1),'cloid_determinism');
  assertTest(EXECUTION_ENABLED===false && DRY_RUN===true,'safe_defaults');
  console.log('[EXECUTION][SELF-TEST] PASS — no network order was submitted.');
}

async function run(){
  log(`start enabled=${EXECUTION_ENABLED} dryRun=${DRY_RUN} paperKill=${PAPER_EXECUTION_ONLY} mainnet=${MAINNET}`);
  if(EXECUTION_ENABLED && DRY_RUN===false && PAPER_EXECUTION_ONLY===false && !MAINNET) throw new Error('LIVE_TESTNET_BLOCKED_BY_CONFIGURATION');
  const previousState=await loadStateSafe();
  if(previousState?.mode==='LIVE' && previousState?.activePosition) await reconcileClosedPosition(previousState);
  const handoff=await readJson(HANDOFF_PATH);
  const p=await buildCandidate(handoff);
  if(PAPER_EXECUTION_ONLY){
    const paperNotional=p.accountValue*(ACCOUNT_ALLOCATION_PCT/100)*TARGET_LEVERAGE;
    p.paper={accountAllocationPct:ACCOUNT_ALLOCATION_PCT,leverage:TARGET_LEVERAGE,margin:p.accountValue*(ACCOUNT_ALLOCATION_PCT/100),notional:paperNotional,simulatedSize:paperNotional/p.market.mid};
  }
  log(`PLAN ${p.coin} ${p.side} trader=${p.trader} entry=${fmt(p.market.mid)} margin=$${fmt(p.margin,2)} notional=$${fmt(p.notional,2)} size=${fmt(p.size,8)} leverage=${p.targetLeverage}x SL=${fmt(p.sl)} TP=${fmt(p.tp)} RR=${fmt(p.rr,2)} cloid=${p.cloid}`);
  if(PAPER_EXECUTION_ONLY){
    log(`PAPER EXECUTION: allocation=${ACCOUNT_ALLOCATION_PCT}% | leverage=${TARGET_LEVERAGE}x | ORDER SENT: NO`);
    await writeJson(STATE_PATH,{at:Date.now(),mode:'PAPER',plan:p});
    return;
  }
  if(!EXECUTION_ENABLED || DRY_RUN){
    log('FINAL EXECUTION: DRY-RUN | ORDER SENT: NO');
    await writeJson(STATE_PATH,{at:Date.now(),mode:'DRY_RUN',plan:p});
    return;
  }
  if(!AGENT_KEY)throw new Error('HYPERLIQUID_AGENT_PRIVATE_KEY_MISSING');
  const transport=new hl.HttpTransport({isTestnet:!MAINNET,timeout:30000});
  const wallet=privateKeyToAccount(AGENT_KEY);
  const exchange=new hl.ExchangeClient({wallet,transport,signatureChainId:()=> '0xa4b1'});
  await exchange.updateLeverage({asset:p.asset.assetIndex,isCross:false,leverage:TARGET_LEVERAGE});
  log(`LEVERAGE SET ${p.coin} isolated=${TARGET_LEVERAGE}x`);
  const rawEntryPx=p.side==='LONG'?p.market.ask*(1+SLIPPAGE_BPS/10000):p.market.bid*(1-SLIPPAGE_BPS/10000);
  const px=formatPrice(rawEntryPx,p.asset.szDecimals);
  const size=formatSize(p.size,p.asset.szDecimals);
  const result=await exchange.order({orders:[{a:p.asset.assetIndex,b:p.side==='LONG',p:px,s:size,r:false,t:{limit:{tif:'Ioc'}},c:p.cloid}],grouping:'na',expiresAfter:Date.now()+30000});
  const filled=filledStatus(result);
  const err=orderError(result);
  if(err)throw new Error(`ENTRY_ORDER_REJECTED:${err}`);
  if(!filled)throw new Error('ENTRY_NOT_FILLED');
  const filledSize=num(filled.totalSz);
  if(!(filledSize>0))throw new Error('ENTRY_FILLED_SIZE_INVALID');
  const avgPx=num(filled.avgPx);
  if(avgPx>0)p.liveFillPrice=avgPx;
  p.filledSize=filledSize;
  log(`ENTRY FILLED ${p.coin} ${p.side} size=${fmt(filledSize,8)} avgPx=${fmt(avgPx)}`);
  try{
    const protection=await placeProtection(exchange,p,filledSize);
    const pOids=protectionOids(protection);
    const slOid=String(pOids[0]||'');
    const tpOid=String(pOids[1]||'');
    if(!slOid || !tpOid) throw new Error('PROTECTION_OIDS_MISSING');
    log(`PROTECTION LIVE ${p.coin} SL=${fmt(p.sl)} TP=${fmt(p.tp)} size=${fmt(filledSize,8)}`);
    const confirmedPos=await confirmOwnPosition(p.coin,p.side);
    if(!confirmedPos) throw new Error('FILLED_POSITION_CONFIRMATION_TIMEOUT');
    const actualEntry=num(confirmedPos.entryPx);
    if(!(actualEntry>0)) throw new Error('CONFIRMED_ENTRY_PRICE_INVALID');
    const activePosition={coin:p.coin,side:p.side,trader:p.trader,entry:actualEntry,size:filledSize,openedAt:Date.now(),leverage:TARGET_LEVERAGE,sl:p.sl,tp:p.tp,slOid,tpOid,protectionOids:pOids};
    await telegram(`🟢 HYPERLIQUID TRADE OPENED\n━━━━━━━━━━━━━━━━━━\n🪙 ${p.coin} | ${p.side}\n👤 Trader: ${p.trader}\n📥 Entry: ${fmt(actualEntry)}\n📦 Size: ${fmt(filledSize,8)}\n💵 Margin: $${fmt(p.margin,2)} (${ACCOUNT_ALLOCATION_PCT}% account)\n⚡ Leverage: ${TARGET_LEVERAGE}x ISOLATED\n🛡️ SL: ${fmt(p.sl)}\n🎯 TP: ${fmt(p.tp)}\n📊 RR: ${fmt(p.rr,2)}\n💳 Account: $${fmt(p.accountValue,2)}\n🕐 ${new Date().toISOString()}`);
    await writeJson(STATE_PATH,{at:Date.now(),mode:'LIVE',plan:p,entryResult:result,protectionResult:protection,activePosition});
  }catch(e){
    const protectionError=String(e.message||e);
    log(`PROTECTION FAILED ${protectionError} | EMERGENCY CLOSE START`);
    let closeResult=null;
    try{closeResult=await emergencyClose(exchange,p,filledSize);log(`EMERGENCY CLOSE RESPONSE ${JSON.stringify(closeResult)}`);}catch(closeErr){
      log(`EMERGENCY CLOSE FAILED ${String(closeErr.message||closeErr)}`);
    }
    await telegram(`🚨 HYPERLIQUID PROTECTION FAILURE\n━━━━━━━━━━━━━━━━━━\n🪙 ${p.coin} | ${p.side}\n📥 Entry: ${fmt(avgPx||p.liveFillPrice)}\n🛡️ SL/TP registration failed.\n🔴 Emergency close attempted.\n❗ ${protectionError}`);
    await writeJson(STATE_PATH,{at:Date.now(),mode:'LIVE_PROTECTION_FAILURE',plan:p,entryResult:result,protectionError,closeResult});
    throw new Error(`LIVE_PROTECTION_FAILURE:${protectionError}`);
  }
}

if(String(process.env.EXECUTION_SELF_TEST||'false').toLowerCase()==='true'){
  try{ runSelfTest(); process.exitCode=0; }catch(e){ console.error(`[EXECUTION][SELF-TEST] ${e.stack||e}`); process.exitCode=1; }
}else run().catch(async e=>{
  const reason=String(e.message||e);
  console.error(`[EXECUTION][BLOCK] ${e.stack||e}`);
  try{await writeJson(STATE_PATH,{at:Date.now(),mode:'BLOCKED',reason});}catch{}
  // A missing LiveReady candidate is an expected safety-gate outcome, not a workflow failure.
  // Keep real integration/API/code errors as non-zero exits.
  process.exitCode=(reason==='NO_LIVEREADY_CANDIDATE'||reason==='NO_EXECUTION_HANDOFF')?0:1;
});
