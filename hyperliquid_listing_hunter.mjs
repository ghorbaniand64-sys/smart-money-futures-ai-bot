#!/usr/bin/env node
/**
 * HYPERLIQUID LISTING HUNTER V0.1
 * READ-ONLY | NO ORDERS
 * Detects newly observed native/HIP-3 perp and spot markets and, for perps,
 * attaches a real-time trades stream so the first observed trade can be timed.
 */

const REST = process.env.HYPERLIQUID_API_URL || 'https://api.hyperliquid.xyz/info';
const WS_URL = process.env.HYPERLIQUID_WS_URL || 'wss://api.hyperliquid.xyz/ws';
const POLL_MS = Math.max(5000, Number(process.env.HYPERLIQUID_LISTING_POLL_MS || 15000));
const STATE_FILE = process.env.HYPERLIQUID_LISTING_STATE || './state/hyperliquid_listing_state.json';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.HYPERLIQUID_TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || process.env.HYPERLIQUID_TELEGRAM_CHAT_ID || '';
const REPORT_EVERY_CYCLE = String(process.env.HYPERLIQUID_LISTING_REPORT_EVERY_CYCLE || 'false').toLowerCase() === 'true';

import fs from 'node:fs/promises';
import path from 'node:path';

const now = () => Date.now();
const iso = (t = now()) => new Date(t).toISOString();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const num = (v, d = null) => Number.isFinite(Number(v)) ? Number(v) : d;

async function loadState() {
  try { return JSON.parse(await fs.readFile(STATE_FILE, 'utf8')); }
  catch { return { version: 'V0.1', markets: {}, firstSeenAt: null, cycles: 0 }; }
}
async function saveState(state) {
  await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

async function info(body) {
  let last;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(REST, { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify(body) });
      if (res.status === 429 || res.status >= 500) {
        const wait = Math.min(10000, 800 * 2 ** (attempt - 1));
        await sleep(wait);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      return await res.json();
    } catch (e) { last = e; if (attempt < 4) await sleep(500 * attempt); }
  }
  throw last || new Error('INFO_REQUEST_FAILED');
}

function extractPerpMarkets(meta, dexName) {
  const out = new Map();
  for (const u of meta?.universe || []) {
    if (!u?.name) continue;
    const coin = dexName ? `${dexName}:${u.name}` : u.name;
    out.set(`PERP:${coin}`, {
      key:`PERP:${coin}`, type:'PERP', venue:dexName ? 'HIP-3' : 'NATIVE', dex:dexName || '', coin,
      name:u.name, szDecimals:u.szDecimals ?? null, maxLeverage:u.maxLeverage ?? null,
      isDelisted:Boolean(u.isDelisted), onlyIsolated:Boolean(u.onlyIsolated)
    });
  }
  return out;
}
function extractSpotMarkets(meta) {
  const out = new Map();
  for (const u of meta?.universe || []) {
    if (!u?.name) continue;
    out.set(`SPOT:${u.name}`, { key:`SPOT:${u.name}`, type:'SPOT', venue:'NATIVE_SPOT', dex:'', coin:u.name, name:u.name, tokens:u.tokens || [] });
  }
  return out;
}

async function discover() {
  const [native, spot, dexes] = await Promise.all([
    info({type:'meta'}), info({type:'spotMeta'}), info({type:'perpDexs'})
  ]);
  const markets = new Map([...extractPerpMarkets(native, ''), ...extractSpotMarkets(spot)]);
  const hip3 = [];
  for (let i = 1; i < (dexes || []).length; i++) {
    const d = dexes[i];
    if (!d?.name) continue;
    try {
      const m = await info({type:'meta', dex:d.name});
      for (const [k,v] of extractPerpMarkets(m, d.name)) markets.set(k,v);
      hip3.push({index:i, name:d.name, fullName:d.fullName || d.name, deployer:d.deployer || null});
    } catch (e) { hip3.push({index:i,name:d.name,error:String(e?.message || e)}); }
  }
  return { markets, hip3 };
}

class TradeWatcher {
  constructor() { this.ws = null; this.coins = new Set(); this.pending = new Set(); this.backoff = 1000; this.closed = false; }
  ensure() {
    if (this.closed || this.ws || !this.coins.size) return;
    try { this.ws = new WebSocket(WS_URL); }
    catch { this.ws = null; setTimeout(() => this.ensure(), this.backoff); return; }
    this.ws.onopen = () => { this.backoff = 1000; for (const coin of this.coins) this.subscribe(coin); };
    this.ws.onmessage = ev => this.onMessage(ev.data);
    this.ws.onerror = () => {};
    this.ws.onclose = () => { this.ws = null; if (!this.closed) { const w=this.backoff; this.backoff=Math.min(30000,this.backoff*2); setTimeout(()=>this.ensure(),w); } };
  }
  subscribe(coin) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({method:'subscribe',subscription:{type:'trades',coin}}));
  }
  add(coin) { if (!coin || this.coins.has(coin)) return; this.coins.add(coin); if (this.ws?.readyState===WebSocket.OPEN) this.subscribe(coin); else this.ensure(); }
  onMessage(raw) {
    try {
      const m=JSON.parse(raw); if (m.channel !== 'trades') return;
      const rows=Array.isArray(m.data)?m.data:[m.data];
      for (const t of rows) {
        const coin=t?.coin; if (!coin) continue;
        const ts=num(t.time, now());
        this.pending.add(JSON.stringify({coin, ts, px:t.px ?? null, sz:t.sz ?? null, side:t.side ?? null, hash:t.hash ?? null, tid:t.tid ?? null}));
      }
    } catch {}
  }
  drain() { const out=[]; for(const x of this.pending){out.push(JSON.parse(x));} this.pending.clear(); return out; }
  close(){this.closed=true; try{this.ws?.close();}catch{} }
}

async function telegram(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try { await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:TELEGRAM_CHAT_ID,text,disable_web_page_preview:true})}); } catch {}
}

function formatNew(rows) {
  if (!rows.length) return '';
  const lines=['🟣 HYPERLIQUID LISTING HUNTER V0.1','📡 READ-ONLY | NO ORDERS','━━━━━━━━━━━━━━━━━━','🚨 NEW MARKETS DETECTED'];
  for (const x of rows.slice(0,30)) {
    lines.push(`\n${x.type==='PERP'?'🔴':'🟢'} ${x.coin}`);
    lines.push(`Venue: ${x.venue}${x.dex?` (${x.dex})`:''}`);
    lines.push(`First seen: ${iso(x.firstSeenAt)}`);
    lines.push(`Status: ${x.type==='PERP'?'PERP MARKET DETECTED':'SPOT MARKET DETECTED'}`);
  }
  lines.push(`\n🕐 ${iso()}`);
  return lines.join('\n');
}
function formatTrades(rows) {
  if (!rows.length) return '';
  const lines=['⚡ FIRST-TRADE OBSERVATIONS'];
  for(const x of rows.slice(0,30)) lines.push(`${x.coin} | first observed trade ${iso(x.ts)} | px=${x.px ?? 'n/a'} | sz=${x.sz ?? 'n/a'} | side=${x.side ?? 'n/a'}`);
  return lines.join('\n');
}

async function main() {
  const state=await loadState();
  const watcher=new TradeWatcher();
  process.on('SIGINT',()=>watcher.close()); process.on('SIGTERM',()=>watcher.close());
  console.log(`🟣 HYPERLIQUID LISTING HUNTER V0.1 | READ-ONLY | poll=${POLL_MS}ms`);
  while(true) {
    const cycleAt=now();
    try {
      const {markets,hip3}=await discover();
      const newRows=[];
      for(const [key,m] of markets) {
        if(!state.markets[key]) {
          state.markets[key]={...m, firstSeenAt:cycleAt, firstTradeObservedAt:null, lastSeenAt:cycleAt, observations:1};
          newRows.push(state.markets[key]);
        } else {
          state.markets[key].lastSeenAt=cycleAt; state.markets[key].observations=(state.markets[key].observations||0)+1;
        }
        if(m.type==='PERP' && !m.isDelisted) watcher.add(m.coin);
      }
      const trades=watcher.drain();
      for(const t of trades) {
        const key=`PERP:${t.coin}`;
        if(state.markets[key] && !state.markets[key].firstTradeObservedAt) {
          state.markets[key].firstTradeObservedAt=t.ts;
          state.markets[key].firstTrade={ts:t.ts,px:t.px,sz:t.sz,side:t.side,hash:t.hash,tid:t.tid};
        }
      }
      state.cycles=(state.cycles||0)+1; state.lastCycleAt=cycleAt; state.hip3=hip3;
      await saveState(state);
      if(newRows.length) {
        console.log(formatNew(newRows)); await telegram(formatNew(newRows));
      } else if(REPORT_EVERY_CYCLE) {
        const msg=`🟣 LISTING HUNTER | cycle=${state.cycles}\nMarkets=${markets.size} | HIP-3=${hip3.length}\n🕐 ${iso()}`;
        console.log(msg); await telegram(msg);
      } else console.log(`cycle=${state.cycles} markets=${markets.size} hip3=${hip3.length} new=${newRows.length} firstTrades=${trades.length}`);
      if(trades.length) { const msg=formatTrades(trades); console.log(msg); if(newRows.length) await telegram(msg); }
    } catch(e) { console.error(`LISTING_HUNTER_ERROR ${e?.stack || e}`); }
    await sleep(POLL_MS);
  }
}
main().catch(e=>{console.error(e);process.exit(1)});
