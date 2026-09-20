import fs from 'node:fs/promises';

const CONFIG = Object.freeze({
  apiUrl: process.env.HYPERLIQUID_API_URL || 'https://api.hyperliquid.xyz/info',
  traders: (process.env.HYPERLIQUID_TRADERS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
  lookbackHours: Number(process.env.HYPERLIQUID_LOOKBACK_HOURS || 24),
  tradeWindowDays: Number(process.env.HYPERLIQUID_TRADE_WINDOW_DAYS || 7),
  minTrades24h: Number(process.env.HYPERLIQUID_MIN_TRADES_24H || 5),
  maxAvgHoldHours: Number(process.env.HYPERLIQUID_MAX_AVG_HOLD_HOURS || 36),
  minClosedTrades: Number(process.env.HYPERLIQUID_MIN_CLOSED_TRADES || 10),
  stateFile: process.env.HYPERLIQUID_STATE_FILE || 'state/hyperliquid_trader_monitor.json',
  telegramToken: process.env.TELEGRAM_TOKEN || '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
});

const DEFAULT_TRADERS = [
  '0xf29c6bc1147a841519b382459a6d7a373c6b9971',
  '0x469e9a7f624b04c24f0e64edf8d8a277e6bf58a5',
  '0xbf732ea04197942783e34730ed6e0f6099575d58',
  '0xe867fbdad3291530e41530301ecb77693850c78e',
  '0xa9b95f2a2e7ef219021efc5c04c32761b8553bbd',
];
const TRADERS = CONFIG.traders.length ? CONFIG.traders : DEFAULT_TRADERS;

function num(v, d = 0) { const x = Number(v); return Number.isFinite(x) ? x : d; }
function short(a) { return `${a.slice(0, 6)}…${a.slice(-4)}`; }
function money(v) { return `${v >= 0 ? '+' : '-'}$${Math.abs(v).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}`; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

async function post(body) {
  const r = await fetch(CONFIG.apiUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) throw new Error(`Hyperliquid HTTP ${r.status}: ${text.slice(0,300)}`);
  return JSON.parse(text);
}

async function getState(user) { return post({ type: 'clearinghouseState', user }); }
async function getFills(user, startTime, endTime) {
  return post({ type: 'userFillsByTime', user, startTime, endTime, aggregateByTime: false });
}

function positions(state) {
  return (state?.assetPositions || []).map(x => {
    const p = x.position || x;
    const szi = num(p.szi);
    return {
      coin: p.coin,
      side: szi > 0 ? 'LONG' : szi < 0 ? 'SHORT' : 'FLAT',
      size: Math.abs(szi),
      entry: num(p.entryPx),
      positionValue: Math.abs(num(p.positionValue)),
      unrealizedPnl: num(p.unrealizedPnl),
      leverage: num(p.leverage?.value ?? p.leverage),
      liquidationPx: num(p.liquidationPx),
    };
  }).filter(p => p.side !== 'FLAT' && p.size > 0);
}

function dirClass(f) {
  const d = String(f?.dir || '').toLowerCase();
  if (d.includes('open long')) return 'LONG_OPEN';
  if (d.includes('close long')) return 'LONG_CLOSE';
  if (d.includes('open short')) return 'SHORT_OPEN';
  if (d.includes('close short')) return 'SHORT_CLOSE';
  return '';
}

// Fills are executions, not trades. Reconstruct closed trades from explicit
// Hyperliquid Open/Close direction labels. Hold time is FIFO-estimated and
// may be fragmented by partial fills/adds/reductions.
function reconstructClosedTrades(fills) {
  const rows = [...fills].filter(f => num(f.time) > 0).sort((a,b) => num(a.time)-num(b.time));
  const book = { LONG: [], SHORT: [] };
  const closed = [];

  for (const f of rows) {
    const cls = dirClass(f);
    const time = num(f.time);
    const size = Math.abs(num(f.sz));
    if (!cls || !time || !size) continue;
    const side = cls.startsWith('LONG') ? 'LONG' : 'SHORT';

    if (cls.endsWith('_OPEN')) {
      book[side].push({ time, size });
      continue;
    }

    let remaining = size;
    let matched = 0;
    let weightedHoldMs = 0;
    while (remaining > 1e-12 && book[side].length) {
      const lot = book[side][0];
      const take = Math.min(remaining, lot.size);
      weightedHoldMs += take * Math.max(0, time - lot.time);
      matched += take;
      lot.size -= take;
      remaining -= take;
      if (lot.size <= 1e-12) book[side].shift();
    }
    closed.push({
      coin: String(f.coin || 'UNKNOWN'),
      direction: side,
      time,
      px: num(f.px),
      size,
      closedPnl: num(f.closedPnl),
      holdMs: matched > 0 ? weightedHoldMs / matched : null,
    });
  }
  return closed;
}

function calculateStats(allFills, closed) {
  const cutoff24 = Date.now() - 24*3600000;
  const fills24 = allFills.filter(f => num(f.time) >= cutoff24);
  const volume24h = fills24.reduce((s,f) => s + Math.abs(num(f.px) * num(f.sz)), 0);
  const decided = closed.filter(t => t.closedPnl !== 0);
  const wins = decided.filter(t => t.closedPnl > 0).length;
  const losses = decided.filter(t => t.closedPnl < 0).length;
  const realized = closed.reduce((s,t) => s + t.closedPnl, 0);
  const holds = closed.filter(t => Number.isFinite(t.holdMs)).map(t => t.holdMs);
  const sorted = [...holds].sort((a,b)=>a-b);
  const avgHoldMs = holds.length ? holds.reduce((a,b)=>a+b,0)/holds.length : null;
  const medianHoldMs = sorted.length ? sorted[Math.floor(sorted.length/2)] : null;
  const activeDays = new Set(closed.map(t => new Date(t.time).toISOString().slice(0,10))).size;
  const profit = closed.filter(t=>t.closedPnl>0).reduce((s,t)=>s+t.closedPnl,0);
  const loss = Math.abs(closed.filter(t=>t.closedPnl<0).reduce((s,t)=>s+t.closedPnl,0));
  const profitFactor = loss > 0 ? profit/loss : (profit > 0 ? Infinity : null);
  const tradesPerDay = closed.length / Math.max(1, CONFIG.tradeWindowDays);

  const wr = decided.length ? wins/decided.length*100 : null;
  const holdHours = avgHoldMs == null ? null : avgHoldMs/3600000;
  const enoughClosed = closed.length >= CONFIG.minClosedTrades;
  const enoughRecent = fills24.length >= CONFIG.minTrades24h;
  const holdOk = holdHours == null ? false : holdHours <= CONFIG.maxAvgHoldHours;
  const eligible = enoughClosed && enoughRecent && holdOk && realized > 0;

  // Score is a screening metric, not a claim of future performance.
  const wrPart = wr == null ? 0 : clamp(wr/100,0,1)*30;
  const activityPart = clamp(fills24.length/Math.max(CONFIG.minTrades24h*4,1),0,1)*20;
  const pnlPart = realized > 0 ? 20 : 0;
  const holdPart = holdHours == null ? 0 : clamp(1 - holdHours/Math.max(CONFIG.maxAvgHoldHours,1),0,1)*20;
  const samplePart = clamp(closed.length/Math.max(CONFIG.minClosedTrades*4,1),0,1)*10;
  const score = wrPart + activityPart + pnlPart + holdPart + samplePart;

  return { fills24h:fills24.length, volume24h, closedTrades:closed.length, wins, losses,
    winRate:wr, realizedPnl:realized, avgHoldMs, medianHoldMs, tradesPerDay, activeDays,
    profitFactor, eligible, score };
}

function fmtHold(ms) {
  if (ms == null) return 'N/A';
  const h = ms/3600000;
  return h < 48 ? `${h.toFixed(1)}h` : `${(h/24).toFixed(1)}d`;
}

function status(r) {
  if (r.error) return '🔴 ERROR';
  if (r.stats.eligible) return '🟢 DAY-TRADER CANDIDATE';
  if (r.stats.closedTrades < CONFIG.minClosedTrades) return '⚪ INSUFFICIENT CLOSED-TRADE DATA';
  return '🟡 FILTERED';
}

function buildReport(results) {
  const lines = [
    '🟣 HYPERLIQUID DAY-TRADER MONITOR V2',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    `📡 READ-ONLY | Traders ${results.length}/${results.length}`,
    `🕐 ${new Date().toISOString()}`,
    ''
  ];
  results.forEach((r,i) => {
    if (r.error) {
      lines.push(`${i+1}. ${short(r.address)} | ${status(r)}`);
      lines.push(`❌ ${r.error}`);
      lines.push('');
      return;
    }
    const s = r.stats;
    lines.push(`${i+1}. ${short(r.address)} | Score ${s.score.toFixed(1)} | ${status(r)}`);
    lines.push(`📊 24h fills ${s.fills24h} | 24h volume $${s.volume24h.toLocaleString('en-US',{maximumFractionDigits:0})}`);
    lines.push(`📈 CLOSED ${s.closedTrades} | WR ${s.winRate == null ? 'N/A' : s.winRate.toFixed(1)+'%'} | Realized PnL ${s.closedTrades ? money(s.realizedPnl) : 'N/A'}`);
    lines.push(`⏱ Avg hold ${fmtHold(s.avgHoldMs)} | Median ${fmtHold(s.medianHoldMs)} | Trades/day ${s.tradesPerDay.toFixed(2)}`);
    lines.push(`📅 Active days ${s.activeDays}/${CONFIG.tradeWindowDays} | PF ${s.profitFactor == null ? 'N/A' : Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : '∞'}`);
    if (r.positions.length) {
      for (const p of r.positions.slice(0,5)) lines.push(`  • ${p.coin} ${p.side} | entry ${p.entry} | lev ${p.leverage}x | uPnL ${money(p.unrealizedPnl)}`);
      if (r.positions.length > 5) lines.push(`  • +${r.positions.length-5} more open positions`);
    } else lines.push('  • No open positions');
    lines.push('');
  });
  lines.push('ℹ️ WR/PnL use reconstructed CLOSED trades, not raw fills.');
  lines.push('ℹ️ Hold time is FIFO-estimated from Open/Close fills; partial fills can fragment trades.');
  return lines.join('\n');
}

async function telegram(text) {
  if (!CONFIG.telegramToken || !CONFIG.telegramChatId) {
    console.error('[TELEGRAM] CONFIG MISSING: TELEGRAM_TOKEN or TELEGRAM_CHAT_ID');
    return false;
  }
  const url = `https://api.telegram.org/bot${CONFIG.telegramToken}/sendMessage`;
  try {
    const r = await fetch(url, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({chat_id:CONFIG.telegramChatId,text,disable_web_page_preview:true}) });
    const body = await r.text();
    if (!r.ok) { console.error(`[TELEGRAM] HTTP ${r.status}: ${body}`); return false; }
    console.log('[TELEGRAM] SENT');
    return true;
  } catch (e) { console.error('[TELEGRAM] ERROR:', e?.message || e); return false; }
}

async function main() {
  const end = Date.now();
  // The 24h variable is for the activity metric. The historical trade window
  // must be used to reconstruct enough closed trades for WR/PnL/hold time.
  const start = end - CONFIG.tradeWindowDays*86400000;
  const results = [];
  for (const user of TRADERS) {
    try {
      const [state, fills] = await Promise.all([getState(user), getFills(user,start,end)]);
      const closed = reconstructClosedTrades(fills);
      const stats = calculateStats(fills,closed);
      results.push({address:user,positions:positions(state),stats});
    } catch (e) {
      results.push({address:user,positions:[],error:e?.message || String(e),stats:{score:0,closedTrades:0}});
    }
  }
  results.sort((a,b)=>num(b.stats.score)-num(a.stats.score));

  const report = buildReport(results);
  console.log('\n'+report+'\n');
  await fs.mkdir(CONFIG.stateFile.split('/').slice(0,-1).join('/') || '.', {recursive:true});
  await fs.writeFile(CONFIG.stateFile, JSON.stringify({generatedAt:new Date().toISOString(),traders:results},null,2));

  const sent = await telegram(report);
  if (!sent) process.exitCode = 2;
}

main().catch(async e => {
  console.error('[FATAL]',e?.stack||e);
  await telegram(`🔴 HYPERLIQUID MONITOR ERROR\n━━━━━━━━━━━━━━━━━━\n${e?.message||e}`);
  process.exitCode = 1;
});
