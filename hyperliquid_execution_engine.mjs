// Hyperliquid Meme Hunter Execution Engine V6.1
// Consumes V6.1 READ-ONLY handoff. Default: DRY RUN / NO ORDERS.
// Live orders require BOTH EXECUTION_ENABLED=true and EXECUTION_DRY_RUN=false.

import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import * as hl from '@nktkas/hyperliquid';
import { privateKeyToAccount } from 'viem/accounts';

const INFO = process.env.HYPERLIQUID_API_URL || 'https://api.hyperliquid.xyz/info';
const HANDOFF_PATH = process.env.HYPERLIQUID_EXECUTION_HANDOFF_PATH || 'state/meme_execution_handoff.json';
const EXECUTION_ENABLED = String(process.env.EXECUTION_ENABLED ?? 'false').toLowerCase() === 'true';
const DRY_RUN = String(process.env.EXECUTION_DRY_RUN ?? 'true').toLowerCase() !== 'false';
const ACCOUNT = String(process.env.HYPERLIQUID_ACCOUNT_ADDRESS || '').trim().toLowerCase();
const AGENT_KEY = String(process.env.HYPERLIQUID_AGENT_PRIVATE_KEY || '').trim();
const MAX_HANDOFF_AGE_MS = Number(process.env.EXECUTION_HANDOFF_TTL_MS || 90000);
const MAX_SOURCE_ENTRY_DISTANCE_PCT = Number(process.env.EXECUTION_MAX_SOURCE_ENTRY_DISTANCE_PCT || 0.5);
const MAX_REVALIDATION_MOVE_PCT = Number(process.env.EXECUTION_MAX_REVALIDATION_MOVE_PCT || 0.35);
const SLIPPAGE_BPS = Number(process.env.EXECUTION_SLIPPAGE_BPS || 50);
const TARGET_NOTIONAL_USD = Number(process.env.EXECUTION_TARGET_NOTIONAL_USD || 10);
const MAX_NOTIONAL_USD = Number(process.env.EXECUTION_MAX_NOTIONAL_USD || 25);
const MAX_ACCOUNT_ALLOCATION_PCT = Number(process.env.EXECUTION_MAX_ACCOUNT_ALLOCATION_PCT || 1);
const MAX_LEVERAGE = Number(process.env.EXECUTION_MAX_LEVERAGE || 3);
const MIN_RR = Number(process.env.EXECUTION_MIN_RR || 1.5);
const SL_ATR = Number(process.env.EXECUTION_SL_ATR_MULT || 1.2);
const TP_ATR = Number(process.env.EXECUTION_TP_ATR_MULT || 2.0);
const MAX_SL_PCT = Number(process.env.EXECUTION_MAX_SL_PCT || 2.0);
const REQUIRE_MEME = String(process.env.EXECUTION_REQUIRE_MEME || 'true').toLowerCase() !== 'false';
const REQUIRE_HANDOFF_READY = String(process.env.EXECUTION_REQUIRE_HANDOFF_READY || 'true').toLowerCase() !== 'false';
const STATE_PATH = process.env.EXECUTION_STATE_PATH || 'state/execution_state.json';
const MAINNET = String(process.env.HYPERLIQUID_TESTNET || 'false').toLowerCase() !== 'true';
const API_URL = INFO.replace(/\/info\/?$/, '');

function log(x){ console.log(`[EXECUTION] ${x}`); }
function num(x){ const n=Number(x); return Number.isFinite(n)?n:NaN; }
function validAddr(x){ return /^0x[a-f0-9]{40}$/.test(String(x||'').toLowerCase()); }
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function clamp(x,a,b){ return Math.max(a,Math.min(b,x)); }
function sideFromSize(szi){ return Number(szi)>0?'LONG':'SHORT'; }
function fmt(x,d=4){ return Number.isFinite(Number(x))?Number(x).toFixed(d):'n/a'; }
function pct(x,d=2){ return Number.isFinite(Number(x))?`${Number(x).toFixed(d)}%`:'n/a'; }

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
  const maxDecimals=Math.max(6-szDecimals,0);
  const sig=Number(price.toPrecision(5));
  return sig.toFixed(Math.min(maxDecimals,Math.max(0,(String(sig).split('.')[1]||'').length))).replace(/\.?0+$/,'');
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
  const ownCoin=acct.positions.find(p=>String(p?.coin||'')===coin && Math.abs(num(p?.szi)||0)>0);
  if(ownCoin)throw new Error('OWN_POSITION_ALREADY_EXISTS');
  const orders=await openOrders();
  if((Array.isArray(orders)?orders:[]).some(o=>String(o?.coin||'')===coin))throw new Error('OWN_OPEN_ORDER_ALREADY_EXISTS');
  const cloid=deterministicCloid(trader,coin,sourceEntry);
  const history=await historicalOrders();
  if((Array.isArray(history)?history:[]).some(x=>String(x?.order?.cloid||'').toLowerCase()===cloid.toLowerCase()))throw new Error('DUPLICATE_CLOID_ALREADY_USED');
  const asset=await metaAsset(coin);
  const lev=num(pos?.leverage?.value||pos?.leverageValue||pos?.leverage||0);
  if(lev>MAX_LEVERAGE)throw new Error(`SOURCE_LEVERAGE>${MAX_LEVERAGE}x`);
  const notional=Math.min(TARGET_NOTIONAL_USD,MAX_NOTIONAL_USD,acct.accountValue*MAX_ACCOUNT_ALLOCATION_PCT/100);
  if(!(notional>0))throw new Error('NOTIONAL_ZERO');
  const entryPx=side==='LONG'?liveBook.ask:liveBook.bid;
  const size=notional/entryPx;
  const a=await atr(coin,Date.now());
  const pp=planPrices(side,entryPx,a);
  if(pp.rr<MIN_RR)throw new Error(`RR<${MIN_RR}`);
  if(side==='LONG' && !(pp.sl<entryPx&&pp.tp>entryPx))throw new Error('INVALID_LONG_PROTECTION');
  if(side==='SHORT' && !(pp.sl>entryPx&&pp.tp<entryPx))throw new Error('INVALID_SHORT_PROTECTION');
  return {trader,coin,side,sourceEntry,sourceDistance,liveEntry,market:liveBook,notional,size,asset,leverage:lev,atr:a,cloid,sl:pp.sl,tp:pp.tp,rr:pp.rr,accountValue:acct.accountValue};
}

async function run(){
  log(`start enabled=${EXECUTION_ENABLED} dryRun=${DRY_RUN} mainnet=${MAINNET}`);
  const handoff=await readJson(HANDOFF_PATH);
  const p=await buildCandidate(handoff);
  log(`PLAN ${p.coin} ${p.side} trader=${p.trader} entry=${fmt(p.market.mid)} notional=$${fmt(p.notional,2)} size=${fmt(p.size,8)} SL=${fmt(p.sl)} TP=${fmt(p.tp)} RR=${fmt(p.rr,2)} cloid=${p.cloid}`);
  if(!EXECUTION_ENABLED || DRY_RUN){
    log('FINAL EXECUTION: DRY-RUN | ORDER SENT: NO');
    await writeJson(STATE_PATH,{at:Date.now(),mode:'DRY_RUN',plan:p});
    return;
  }
  if(!AGENT_KEY)throw new Error('HYPERLIQUID_AGENT_PRIVATE_KEY_MISSING');
  const transport=new hl.HttpTransport({isTestnet:!MAINNET,timeout:30000});
  const wallet=privateKeyToAccount(AGENT_KEY);
  const exchange=new hl.ExchangeClient({wallet,transport,signatureChainId:()=> '0xa4b1'});
  const px=formatPrice(p.market.mid,p.asset.szDecimals);
  const size=formatSize(p.size,p.asset.szDecimals);
  const result=await exchange.order({orders:[{a:p.asset.assetIndex,b:p.side==='LONG',p:px,s:size,r:false,t:{limit:{tif:'Ioc'}},c:p.cloid}],grouping:'na',expiresAfter:Date.now()+30000});
  log(`ORDER RESPONSE ${JSON.stringify(result)}`);
  await writeJson(STATE_PATH,{at:Date.now(),mode:'LIVE',plan:p,result});
}

run().catch(async e=>{
  const reason=String(e.message||e);
  console.error(`[EXECUTION][BLOCK] ${e.stack||e}`);
  try{await writeJson(STATE_PATH,{at:Date.now(),mode:'BLOCKED',reason});}catch{}
  // A missing LiveReady candidate is an expected safety-gate outcome, not a workflow failure.
  // Keep real integration/API/code errors as non-zero exits.
  process.exitCode=(reason==='NO_LIVEREADY_CANDIDATE'||reason==='NO_EXECUTION_HANDOFF'||reason==='HANDOFF_EXPIRED')?0:1;
});
