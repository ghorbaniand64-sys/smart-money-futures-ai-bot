// Hyperliquid Meme Hunter Execution Engine V8.7.0-LIVE
// Consumes the V8.7.0-FINAL Hunter handoff.
// LIVE: 50% account margin per position, 10x isolated leverage, max 2 positions.
// Entry is followed by fill verification and real reduce-only SL/TP protection.
// Secrets MUST be supplied through the GitHub Actions environment; never hard-code them.

import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import * as hl from '@nktkas/hyperliquid';
import { privateKeyToAccount } from 'viem/accounts';

const INFO = process.env.HYPERLIQUID_API_URL || 'https://api.hyperliquid.xyz/info';
const HANDOFF_PATH = process.env.HYPERLIQUID_EXECUTION_HANDOFF_PATH || 'state/meme_execution_handoff.json';
const STATE_PATH = process.env.EXECUTION_STATE_PATH || 'state/execution_state.json';

const EXECUTION_ENABLED = String(process.env.EXECUTION_ENABLED ?? 'false').toLowerCase() === 'true';
const DRY_RUN = String(process.env.EXECUTION_DRY_RUN ?? 'true').toLowerCase() !== 'false';
const ACCOUNT = String(process.env.HYPERLIQUID_ACCOUNT_ADDRESS || '').trim().toLowerCase();
const AGENT_KEY = String(process.env.HYPERLIQUID_AGENT_PRIVATE_KEY || '').trim();

const MAX_HANDOFF_AGE_MS = Number(process.env.EXECUTION_HANDOFF_TTL_MS || 90000);
const MAX_SOURCE_ENTRY_DISTANCE_PCT = Number(process.env.EXECUTION_MAX_SOURCE_ENTRY_DISTANCE_PCT || 0.5);
const MAX_REVALIDATION_MOVE_PCT = Number(process.env.EXECUTION_MAX_REVALIDATION_MOVE_PCT || 0.35);
const SLIPPAGE_BPS = Number(process.env.EXECUTION_SLIPPAGE_BPS || 50);

const MARGIN_ALLOCATION_PCT = Number(process.env.EXECUTION_MARGIN_ALLOCATION_PCT || 50);
const LEVERAGE = Number(process.env.EXECUTION_LEVERAGE || 10);
const MAX_POSITIONS = Number(process.env.EXECUTION_MAX_POSITIONS || 2);
const REQUIRE_FULL_FILL = String(process.env.EXECUTION_REQUIRE_FULL_FILL ?? 'true').toLowerCase() !== 'false';

const MIN_RR = Number(process.env.EXECUTION_MIN_RR || 1.5);
const SL_ATR = Number(process.env.EXECUTION_SL_ATR_MULT || 1.2);
const TP_ATR = Number(process.env.EXECUTION_TP_ATR_MULT || 2.0);
const MAX_SL_PCT = Number(process.env.EXECUTION_MAX_SL_PCT || 2.0);

const REQUIRE_MEME = String(process.env.EXECUTION_REQUIRE_MEME || 'true').toLowerCase() !== 'false';
const REQUIRE_HANDOFF_READY = String(process.env.EXECUTION_REQUIRE_HANDOFF_READY || 'true').toLowerCase() !== 'false';
const FILL_WAIT_MS = Number(process.env.EXECUTION_FILL_WAIT_MS || 8000);
const FILL_POLL_MS = Number(process.env.EXECUTION_FILL_POLL_MS || 500);
const PROTECTION_VERIFY_MS = Number(process.env.EXECUTION_PROTECTION_VERIFY_MS || 4000);
const EMERGENCY_SLIPPAGE_BPS = Number(process.env.EXECUTION_EMERGENCY_SLIPPAGE_BPS || 100);

const MAINNET = String(process.env.HYPERLIQUID_TESTNET || 'false').toLowerCase() !== 'true';
const API_URL = INFO.replace(/\/info\/?$/, '');

function log(x){ console.log(`[EXECUTION] ${x}`); }
function num(x){ const n=Number(x); return Number.isFinite(n)?n:NaN; }
function validAddr(x){ return /^0x[a-f0-9]{40}$/.test(String(x||'').toLowerCase()); }
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
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

async function writeJson(path,obj){
  await fs.mkdir(new URL('.',`file://${process.cwd()}/${path}`).pathname,{recursive:true}).catch(()=>{});
  await fs.writeFile(path,JSON.stringify(obj,null,2)+'\n');
}

async function info(payload){
  const res=await fetch(`${API_URL}/info`,{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify(payload)
  });
  if(!res.ok)throw new Error(`INFO_HTTP_${res.status}`);
  return res.json();
}

async function currentPosition(user,coin){
  const s=await info({type:'clearinghouseState',user});
  const ps=(Array.isArray(s?.assetPositions)?s.assetPositions:[]).map(x=>x?.position).filter(Boolean);
  return ps.find(p=>String(p?.coin||'')===coin && Math.abs(num(p?.szi)||0)>0)||null;
}

async function allPositions(user){
  const s=await info({type:'clearinghouseState',user});
  return (Array.isArray(s?.assetPositions)?s.assetPositions:[])
    .map(x=>x?.position).filter(p=>p && Math.abs(num(p?.szi)||0)>0);
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
  return {
    assetIndex:i,
    szDecimals:Number(universe[i]?.szDecimals||0),
    maxLeverage:Number(universe[i]?.maxLeverage||0)
  };
}

async function accountState(){
  if(!validAddr(ACCOUNT))throw new Error('HYPERLIQUID_ACCOUNT_ADDRESS_INVALID_OR_MISSING');

  const s=await info({type:'clearinghouseState',user:ACCOUNT});
  let accountValue=num(s?.marginSummary?.accountValue);
  let withdrawable=num(s?.withdrawable);
  let totalMarginUsed=num(s?.marginSummary?.totalMarginUsed);
  const positions=(Array.isArray(s?.assetPositions)?s.assetPositions:[])
    .map(x=>x?.position).filter(Boolean)
    .filter(p=>Math.abs(num(p?.szi)||0)>0);

  // Hyperliquid Unified Account mode can keep the USDC collateral in the
  // Spot clearinghouse while the individual default-Dex clearinghouseState
  // reports accountValue=0. The web UI can therefore show "Avail. to Trade"
  // while this endpoint still returns a zero perp marginSummary.
  let collateralSource='PERP_CLEARINGHOUSE';
  if(!(accountValue>0)){
    const spot=await info({type:'spotClearinghouseState',user:ACCOUNT});
    const balances=Array.isArray(spot?.balances)?spot.balances:[];
    const usdc=balances.find(b=>String(b?.coin||'').toUpperCase()==='USDC');
    const total=num(usdc?.total);
    const hold=num(usdc?.hold);
    const available=Number.isFinite(total)&&Number.isFinite(hold) ? Math.max(0,total-hold) : NaN;

    if(total>0){
      accountValue=total;
      withdrawable=Number.isFinite(available)?available:total;
      totalMarginUsed=0;
      collateralSource='UNIFIED_SPOT_USDC';
      log(`ACCOUNT collateral=USDC ${fmt(accountValue,6)} available=${fmt(withdrawable,6)} source=${collateralSource}`);
    }
  }

  if(!(accountValue>0)){
    const ma=fmt(s?.marginSummary?.accountValue,6);
    const cma=fmt(s?.crossMarginSummary?.accountValue,6);
    const raw=fmt(s?.crossMarginSummary?.totalRawUsd,6);
    const wd=fmt(s?.withdrawable,6);
    throw new Error(`ACCOUNT_VALUE_ZERO_OR_UNAVAILABLE:account=${ACCOUNT}:marginAccountValue=${ma}:crossAccountValue=${cma}:totalRawUsd=${raw}:withdrawable=${wd}`);
  }

  return {raw:s,accountValue,withdrawable,totalMarginUsed,positions,collateralSource};
}

async function openOrders(){ return info({type:'openOrders',user:ACCOUNT}); }
async function historicalOrders(){ return info({type:'historicalOrders',user:ACCOUNT}); }

function deterministicCloid(...parts){
  const raw=`MEME-HUNTER-V87:${parts.join(':')}`;
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
  const n=Number(size.toFixed(szDecimals));
  if(!(n>0))throw new Error('SIZE_ROUNDS_TO_ZERO');
  return n.toFixed(szDecimals).replace(/\.?0+$/,'');
}

async function atr(coin,end){
  const c=await info({
    type:'candleSnapshot',
    req:{coin,interval:'1h',startTime:end-96*3600000,endTime:end}
  });
  const rows=(Array.isArray(c)?c:[])
    .map(x=>({h:num(x?.h),l:num(x?.l),c:num(x?.c)}))
    .filter(x=>x.h>x.l&&x.h>0&&x.l>0);
  if(rows.length<20)throw new Error(`ATR_INSUFFICIENT:${rows.length}`);
  let prev=NaN;
  const tr=[];
  for(const r of rows){
    tr.push(Number.isFinite(prev)
      ? Math.max(r.h-r.l,Math.abs(r.h-prev),Math.abs(r.l-prev))
      : r.h-r.l);
    prev=r.c;
  }
  const recent=tr.slice(-72);
  const value=recent.reduce((a,b)=>a+b,0)/recent.length;
  if(!(value>0)&&Number.isFinite(value))throw new Error('ATR_INVALID');
  return value;
}

function planPrices(side,entry,atrValue){
  if(!(entry>0&&atrValue>0))throw new Error('ATR_OR_ENTRY_INVALID');
  const risk=Math.min(SL_ATR*atrValue,entry*MAX_SL_PCT/100);
  const sl=side==='LONG'?entry-risk:entry+risk;
  const tp=side==='LONG'?entry+TP_ATR*atrValue:entry-TP_ATR*atrValue;
  const reward=Math.abs(tp-entry);
  const riskAbs=Math.abs(entry-sl);
  const rr=riskAbs>0?reward/riskAbs:0;
  return {sl,tp,rr,riskAbs};
}

async function buildCandidate(handoff){
  if(!handoff || !Array.isArray(handoff.candidates))throw new Error('HANDOFF_INVALID');
  const now=Date.now();
  const age=now-num(handoff.createdAt);
  if(!Number.isFinite(num(handoff.createdAt)) || age<0 || age>MAX_HANDOFF_AGE_MS)throw new Error('HANDOFF_EXPIRED');

  const ready=handoff.candidates.filter(x=>x?.executionReady === true && validAddr(x.address) && x?.position?.coin && ['LONG','SHORT'].includes(String(x?.position?.side||'').toUpperCase()));
  if(REQUIRE_HANDOFF_READY && !ready.length)throw new Error('NO_LIVEREADY_CANDIDATE');

  // Hunter V8.7.0 writes the selected best-entry first. Do not re-rank it here.
  const src=ready[0];
  if(!src.position?.coin || !src.position?.side)throw new Error('HANDOFF_POSITION_MISSING');

  const trader=src.address.toLowerCase();
  const coin=String(src.position.coin);
  const side=String(src.position.side).toUpperCase();

  if(!['LONG','SHORT'].includes(side))throw new Error('HANDOFF_SIDE_INVALID');
  if(REQUIRE_MEME && src.position.isMeme===false)throw new Error('POSITION_NOT_CONFIRMED_MEME');

  const sourceEntry=num(src.position.entry);
  if(!(sourceEntry>0))throw new Error('SOURCE_ENTRY_INVALID');

  const pos=await currentPosition(trader,coin);
  if(!pos)throw new Error('SOURCE_POSITION_CLOSED');

  const liveSide=sideFromSize(pos.szi);
  if(liveSide!==side)throw new Error(`SOURCE_DIRECTION_CHANGED:${side}->${liveSide}`);

  const liveBook=await book(coin);

  const sourceDistance=Math.abs(liveBook.mid-sourceEntry)/sourceEntry*100;
  if(sourceDistance>MAX_SOURCE_ENTRY_DISTANCE_PCT)
    throw new Error(`SOURCE_ENTRY_DISTANCE>${MAX_SOURCE_ENTRY_DISTANCE_PCT}%`);

  const sourceMid=num(src.position.mid);
  if(!(sourceMid>0))throw new Error('SOURCE_MID_INVALID');
  const entryMove=Math.abs(liveBook.mid-sourceMid)/sourceMid*100;
  if(entryMove>MAX_REVALIDATION_MOVE_PCT)
    throw new Error(`REVALIDATION_MOVE>${MAX_REVALIDATION_MOVE_PCT}%`);

  const acct=await accountState();

  if(acct.positions.length>=MAX_POSITIONS)
    throw new Error(`MAX_POSITIONS_REACHED:${acct.positions.length}/${MAX_POSITIONS}`);

  const ownCoin=acct.positions.find(p=>String(p?.coin||'')===coin);
  if(ownCoin)throw new Error('OWN_POSITION_ALREADY_EXISTS');

  const orders=await openOrders();
  if((Array.isArray(orders)?orders:[]).some(o=>String(o?.coin||'')===coin))
    throw new Error('OWN_OPEN_ORDER_ALREADY_EXISTS');

  const cloid=deterministicCloid(trader,coin,sourceEntry,'ENTRY');
  const history=await historicalOrders();
  if((Array.isArray(history)?history:[]).some(x=>
    String(x?.order?.cloid||'').toLowerCase()===cloid.toLowerCase()))
    throw new Error('DUPLICATE_CLOID_ALREADY_USED');

  const asset=await metaAsset(coin);
  if(!(asset.maxLeverage>=LEVERAGE))
    throw new Error(`ASSET_MAX_LEVERAGE<${LEVERAGE}x:${asset.maxLeverage}`);

  // 50% of account value is margin; 10x leverage turns that margin into 5x
  // account value of position notional. Hyperliquid uses isolated leverage here.
  const margin=Math.max(0,acct.accountValue*MARGIN_ALLOCATION_PCT/100);
  if(Number.isFinite(acct.withdrawable) && acct.withdrawable < margin)
    throw new Error(`INSUFFICIENT_WITHDRAWABLE_MARGIN:${fmt(acct.withdrawable,2)}<${fmt(margin,2)}`);
  const notional=margin*LEVERAGE;
  if(!(margin>0&&notional>0))throw new Error('NOTIONAL_ZERO');

  const entryPx=side==='LONG'?liveBook.ask:liveBook.bid;
  const size=notional/entryPx;
  const a=await atr(coin,Date.now());
  const pp=planPrices(side,entryPx,a);

  if(pp.rr<MIN_RR)throw new Error(`RR<${MIN_RR}`);
  if(side==='LONG' && !(pp.sl<entryPx&&pp.tp>entryPx))
    throw new Error('INVALID_LONG_PROTECTION');
  if(side==='SHORT' && !(pp.sl>entryPx&&pp.tp<entryPx))
    throw new Error('INVALID_SHORT_PROTECTION');

  return {
    trader,coin,side,sourceEntry,sourceDistance,
    liveEntry:num(pos.entryPx),market:liveBook,
    accountValue:acct.accountValue,margin,notional,size,
    asset,leverage:LEVERAGE,atr:a,cloid,
    sl:pp.sl,tp:pp.tp,rr:pp.rr
  };
}

function marketLimitPrice(side,book,bps=SLIPPAGE_BPS){
  const f=Number(bps)/10000;
  return side==='LONG' ? book.ask*(1+f) : book.bid*(1-f);
}

async function updateIsolatedLeverage(exchange,assetIndex){
  await exchange.updateLeverage({
    asset:assetIndex,
    isCross:false,
    leverage:LEVERAGE
  });
  log(`LEVERAGE: isolated ${LEVERAGE}x set asset=${assetIndex}`);
}

async function waitForOwnPosition(coin,expectedSide,timeout=FILL_WAIT_MS){
  const start=Date.now();
  while(Date.now()-start<=timeout){
    const p=await currentPosition(ACCOUNT,coin);
    if(p){
      const side=sideFromSize(p.szi);
      const size=Math.abs(num(p.szi)||0);
      if(side===expectedSide&&size>0)return p;
    }
    await sleep(FILL_POLL_MS);
  }
  return null;
}

function triggerOrder(assetIndex,side,price,size,szDecimals,tpsl,cloid){
  const closeSide=side!=='LONG';
  return {
    a:assetIndex,
    b:closeSide,
    p:formatPrice(price,szDecimals),
    s:formatSize(size,szDecimals),
    r:true,
    t:{trigger:{triggerPx:formatPrice(price,szDecimals),isMarket:true,tpsl}},
    c:cloid
  };
}

async function placeProtection(exchange,p){
  const actual=await currentPosition(ACCOUNT,p.coin);
  if(!actual)throw new Error('POSITION_NOT_FOUND_AFTER_ENTRY');

  const actualSize=Math.abs(num(actual.szi)||0);
  if(!(actualSize>0))throw new Error('FILLED_SIZE_ZERO');

  // Recalculate protection from the actual average entry so SL/TP follow the fill.
  const actualEntry=num(actual.entryPx);
  if(!(actualEntry>0))throw new Error('ACTUAL_ENTRY_INVALID');
  const pp=planPrices(p.side,actualEntry,p.atr);

  const slCloid=deterministicCloid(p.trader,p.coin,p.sourceEntry,'SL');
  const tpCloid=deterministicCloid(p.trader,p.coin,p.sourceEntry,'TP');

  const orders=[
    triggerOrder(p.asset.assetIndex,p.side,pp.sl,actualSize,p.asset.szDecimals,'sl',slCloid),
    triggerOrder(p.asset.assetIndex,p.side,pp.tp,actualSize,p.asset.szDecimals,'tp',tpCloid)
  ];

  log(`PROTECTION PLAN ${p.coin} ${p.side} actualEntry=${fmt(actualEntry)} size=${fmt(actualSize,8)} SL=${fmt(pp.sl)} TP=${fmt(pp.tp)} RR=${fmt(pp.rr,2)}`);

  const result=await exchange.order({
    orders,
    grouping:'normalTpsl'
  },{expiresAfter:Date.now()+30000});

  log(`PROTECTION RESPONSE ${JSON.stringify(result)}`);

  const ok=await verifyProtection(p.coin,slCloid,tpCloid,PROTECTION_VERIFY_MS);
  if(!ok)throw new Error('PROTECTION_NOT_CONFIRMED');

  return {
    result,
    actualEntry,
    actualSize,
    sl:pp.sl,
    tp:pp.tp,
    rr:pp.rr,
    slCloid,
    tpCloid
  };
}

async function verifyProtection(coin,slCloid,tpCloid,timeout){
  const start=Date.now();
  while(Date.now()-start<=timeout){
    const orders=await openOrders();
    const rows=Array.isArray(orders)?orders:[];
    const hasSl=rows.some(o=>String(o?.coin||'')===coin &&
      String(o?.cloid||'').toLowerCase()===slCloid.toLowerCase());
    const hasTp=rows.some(o=>String(o?.coin||'')===coin &&
      String(o?.cloid||'').toLowerCase()===tpCloid.toLowerCase());
    if(hasSl&&hasTp)return true;
    await sleep(FILL_POLL_MS);
  }
  return false;
}

async function emergencyClose(exchange,p){
  try{
    const pos=await currentPosition(ACCOUNT,p.coin);
    if(!pos)return {closed:true,reason:'NO_POSITION'};
    const size=Math.abs(num(pos.szi)||0);
    if(!(size>0))return {closed:true,reason:'ZERO_POSITION'};

    const side=sideFromSize(pos.szi);
    const bk=await book(p.coin);
    const px=marketLimitPrice(side==='LONG'?'SHORT':'LONG',bk,EMERGENCY_SLIPPAGE_BPS);
    const order={
      a:p.asset.assetIndex,
      b:side!=='LONG',
      p:formatPrice(px,p.asset.szDecimals),
      s:formatSize(size,p.asset.szDecimals),
      r:true,
      t:{limit:{tif:'Ioc'}},
      c:deterministicCloid(p.trader,p.coin,p.sourceEntry,'EMERGENCY')
    };

    log(`EMERGENCY CLOSE ${p.coin} ${side} size=${fmt(size,8)}`);
    const result=await exchange.order({
      orders:[order],
      grouping:'na'
    },{expiresAfter:Date.now()+30000});

    await sleep(500);
    const after=await currentPosition(ACCOUNT,p.coin);
    const closed=!after||Math.abs(num(after.szi)||0)===0;
    log(`EMERGENCY CLOSE RESULT closed=${closed} ${JSON.stringify(result)}`);
    return {closed,result};
  }catch(e){
    log(`EMERGENCY CLOSE FAILED ${e.message}`);
    return {closed:false,error:e.message};
  }
}

async function run(){
  log(`V8.7.0-LIVE start enabled=${EXECUTION_ENABLED} dryRun=${DRY_RUN} mainnet=${MAINNET} margin=${MARGIN_ALLOCATION_PCT}% leverage=${LEVERAGE}x maxPositions=${MAX_POSITIONS}`);
  if(!EXECUTION_ENABLED)throw new Error('EXECUTION_DISABLED');
  if(DRY_RUN)throw new Error('EXECUTION_DRY_RUN_ENABLED');
  if(!validAddr(ACCOUNT))throw new Error('HYPERLIQUID_ACCOUNT_ADDRESS_INVALID_OR_MISSING');
  if(!AGENT_KEY)throw new Error('HYPERLIQUID_AGENT_PRIVATE_KEY_MISSING');
  if(MARGIN_ALLOCATION_PCT<=0||MARGIN_ALLOCATION_PCT>50)throw new Error('INVALID_MARGIN_ALLOCATION_PCT');
  if(LEVERAGE<=0)throw new Error('INVALID_EXECUTION_LEVERAGE');

  const handoff=await readJson(HANDOFF_PATH);
  log(`HANDOFF version=${handoff?.version||'unknown'} mode=${handoff?.mode||'unknown'} candidates=${Array.isArray(handoff?.candidates)?handoff.candidates.length:0}`);
  const p=await buildCandidate(handoff);

  log(`PLAN ${p.coin} ${p.side} trader=${p.trader} market=${fmt(p.market.mid)} margin=$${fmt(p.margin,2)} notional=$${fmt(p.notional,2)} size=${fmt(p.size,8)} leverage=${p.leverage}x isolated SL=${fmt(p.sl)} TP=${fmt(p.tp)} RR=${fmt(p.rr,2)}`);

  const transport=new hl.HttpTransport({isTestnet:!MAINNET,timeout:30000});
  const wallet=privateKeyToAccount(AGENT_KEY);
  const exchange=new hl.ExchangeClient({
    wallet,
    transport,
    signatureChainId:()=> '0xa4b1'
  });

  await updateIsolatedLeverage(exchange,p.asset.assetIndex);

  // Re-read the book immediately before the real entry.
  const freshBook=await book(p.coin);
  const freshDistance=Math.abs(freshBook.mid-p.sourceEntry)/p.sourceEntry*100;
  if(freshDistance>MAX_SOURCE_ENTRY_DISTANCE_PCT)
    throw new Error(`SOURCE_ENTRY_DISTANCE_FINAL>${MAX_SOURCE_ENTRY_DISTANCE_PCT}%`);

  const entryPx=marketLimitPrice(p.side,freshBook,SLIPPAGE_BPS);
  const entryOrder={
    a:p.asset.assetIndex,
    b:p.side==='LONG',
    p:formatPrice(entryPx,p.asset.szDecimals),
    s:formatSize(p.size,p.asset.szDecimals),
    r:false,
    t:{limit:{tif:'Ioc'}},
    c:p.cloid
  };

  log(`ENTRY SEND ${p.coin} ${p.side} px=${entryOrder.p} size=${entryOrder.s} IOC slippage=${SLIPPAGE_BPS}bps`);
  const entryResult=await exchange.order({
    orders:[entryOrder],
    grouping:'na'
  },{expiresAfter:Date.now()+30000});

  log(`ENTRY RESPONSE ${JSON.stringify(entryResult)}`);

  const filled=await waitForOwnPosition(p.coin,p.side);
  if(!filled){
    await writeJson(STATE_PATH,{
      at:Date.now(),mode:'LIVE_NO_FILL',plan:p,entryResult,
      reason:'ENTRY_NOT_CONFIRMED'
    });
    throw new Error('ENTRY_NOT_CONFIRMED');
  }

  const filledSize=Math.abs(num(filled.szi)||0);
  const requestedSize=Math.abs(num(p.size)||0);
  if(REQUIRE_FULL_FILL && filledSize < requestedSize*0.999) {
    log(`PARTIAL FILL ${p.coin} requested=${fmt(requestedSize,8)} filled=${fmt(filledSize,8)} → emergency close`);
    const partialClose=await emergencyClose(exchange,p);
    await writeJson(STATE_PATH,{at:Date.now(),mode:partialClose.closed?'LIVE_PARTIAL_FILL_CLOSED':'LIVE_PARTIAL_FILL_FAILURE',plan:p,entryResult,filled:{entry:num(filled.entryPx),size:filledSize},partialClose});
    if(!partialClose.closed) throw new Error('PARTIAL_FILL_AND_EMERGENCY_CLOSE_FAILED');
    throw new Error('PARTIAL_FILL_EMERGENCY_CLOSED');
  }
  log(`FILL CONFIRMED ${p.coin} ${p.side} entry=${fmt(filled.entryPx)} size=${fmt(filledSize,8)}`);

  try{
    const protection=await placeProtection(exchange,p);
    await writeJson(STATE_PATH,{
      at:Date.now(),
      mode:'LIVE_PROTECTED',
      plan:p,
      fill:{
        side:sideFromSize(filled.szi),
        entry:num(filled.entryPx),
        size:filledSize
      },
      protection,
      entryResult
    });
    log(`FINAL EXECUTION: LIVE | FILLED | SL+TP CONFIRMED`);
  }catch(e){
    log(`PROTECTION FAILURE: ${e.message}`);
    const emergency=await emergencyClose(exchange,p);
    await writeJson(STATE_PATH,{
      at:Date.now(),
      mode:emergency.closed?'LIVE_ABORTED_CLOSED':'LIVE_PROTECTION_FAILURE',
      plan:p,
      fill:{
        side:sideFromSize(filled.szi),
        entry:num(filled.entryPx),
        size:filledSize
      },
      entryResult,
      protectionError:e.message,
      emergency
    });
    if(!emergency.closed)throw new Error(`PROTECTION_FAILED_AND_EMERGENCY_CLOSE_FAILED:${e.message}`);
    throw new Error(`PROTECTION_FAILED_EMERGENCY_CLOSED:${e.message}`);
  }
}

run().catch(async e=>{
  const reason=String(e.message||e);
  console.error(`[EXECUTION][BLOCK] ${e.stack||e}`);
  try{
    await writeJson(STATE_PATH,{at:Date.now(),mode:'BLOCKED',reason});
  }catch{}
  process.exitCode=(reason==='NO_LIVEREADY_CANDIDATE'||reason==='NO_EXECUTION_HANDOFF')?0:1;
});
