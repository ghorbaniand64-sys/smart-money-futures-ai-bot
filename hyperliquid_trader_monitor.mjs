import fs from 'node:fs/promises';

const CONFIG = Object.freeze({
  apiUrl: process.env.HYPERLIQUID_API_URL || 'https://api.hyperliquid.xyz/info',
  traders: (process.env.HYPERLIQUID_TRADERS || '').split(',').map(s => s.trim()).filter(Boolean),
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

function num(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d; }
function short(a) { return `${a.slice(0, 6)}…${a.slice(-4)}`; }
function money(v) { return `${v >= 0 ? '+' : ''}$${Math.abs(v).toFixed(2)}`; }
function pct(v) { return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

async function post(body) {
  const r = await fetch(CONFIG.apiUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Hyperliquid HTTP ${r.status}`);
  return r.json();
}

async function getState(user) {
  return post({ type: 'clearinghouseState', user });
}

async function getFills(user, startTime) {
  return post({ type: 'userFillsByTime', user, startTime, aggregateByTime: false });
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

function fillStats(fills) {
  let volume = 0, fees = 0, realized = 0, wins = 0, losses = 0, closed = 0;
  const byCoin = new Map();
  for (const f of fills) {
    const px = num(f.px), sz = num(f.sz), pnl = num(f.closedPnl);
    volume += Math.abs(px * sz);
    fees += num(f.fee);
    realized += pnl;
    if (Math.abs(pnl) > 0) { closed++; if (pnl > 0) wins++; else if (pnl < 0) losses++; }
    const coin = f.coin || 'UNKNOWN';
    const arr = byCoin.get(coin) || [];
    arr.push({ time: num(f.time), px, sz, dir: f.dir || '', closedPnl: pnl, startPosition: num(f.startPosition) });
    byCoin.set(coin, arr);
  }
  return { volume, fees, realized, closed, wins, losses, byCoin };
}

function estimateAvgHoldHours(fills) {
  // FIFO position reconstruction per coin. This is an estimate, intentionally conservative.
  const books = new Map();
  const holds = [];
  const sorted = [...fills].sort((a,b) => num(a.time) - num(b.time));
  for (const f of sorted) {
    const coin = f.coin || 'UNKNOWN';
    const side = /LONG/i.test(f.dir || '') || f.side === 'B' ? 1 : -1;
    const sz = Math.abs(num(f.sz));
    if (!sz) continue;
    const book = books.get(coin) || { long: [], short: [] };
    const closing = side < 0 ? book.long : book.short;
    const opening = side > 0 ? book.long : book.short;
    let remaining = sz;
    // Hyperliquid dir strings are richer than side; startPosition helps but this remains an estimate.
    if (/Close/i.test(f.dir || '')) {
      while (remaining > 0 && closing.length) {
        const lot = closing[0];
        const take = Math.min(remaining, lot.sz);
        holds.push((num(f.time) - lot.time) / 3600000);
        lot.sz -= take; remaining -= take;
        if (lot.sz <= 1e-12) closing.shift();
      }
    } else {
      opening.push({ time: num(f.time), sz: remaining });
    }
    books.set(coin, book);
  }
  if (!holds.length) return null;
  return holds.reduce((a,b)=>a+b,0) / holds.length;
}

function rankMetric(s) {
  const wr = s.closed ? s.wins / s.closed : 0;
  const activity = clamp(s.volume24h / 1_000_000, 0, 20) / 20;
  const trades = clamp(s.fills24h / 50, 0, 1);
  const hold = s.avgHoldHours == null ? 0.5 : 1 - clamp(s.avgHoldHours / Math.max(CONFIG.maxAvgHoldHours, 1), 0, 1);
  const pnl = Math.tanh(s.realized24h / 5000) * 0.5 + 0.5;
  return 100 * (0.30 * wr + 0.25 * activity + 0.20 * trades + 0.15 * hold + 0.10 * pnl);
}

async function telegram(text) {
  if (!CONFIG.telegramToken || !CONFIG.telegramChatId) return;
  const url = `https://api.telegram.org/bot${CONFIG.telegramToken}/sendMessage`;
  await fetch(url, { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ chat_id: CONFIG.telegramChatId, text }) });
}

async function main() {
  const now = Date.now();
  const start = now - CONFIG.lookbackHours * 3600000;
  const results = [];
  for (const user of TRADERS) {
    try {
      const [state, fills] = await Promise.all([getState(user), getFills(user, start)]);
      const ps = positions(state);
      const stats = fillStats(fills);
      const avgHoldHours = estimateAvgHoldHours(fills);
      const wins = stats.wins, closed = stats.closed;
      const wr = closed ? wins / closed * 100 : 0;
      const r = {
        address: user,
        short: short(user),
        accountValue: num(state?.marginSummary?.accountValue),
        withdrawable: num(state?.withdrawable),
        positions: ps,
        positionCount: ps.length,
        volume24h: stats.volume,
        fills24h: fills.length,
        closedTrades24h: closed,
        wins24h: wins,
        losses24h: stats.losses,
        winRate24h: wr,
        realized24h: stats.realized,
        fees24h: stats.fees,
        avgHoldHours,
      };
      r.score = rankMetric(r);
      r.dayTraderEligible = r.fills24h >= CONFIG.minTrades24h && r.closedTrades24h >= CONFIG.minClosedTrades && (r.avgHoldHours == null || r.avgHoldHours <= CONFIG.maxAvgHoldHours);
      results.push(r);
    } catch (e) {
      results.push({ address: user, short: short(user), error: e.message, score: 0, dayTraderEligible: false });
    }
  }
  results.sort((a,b) => b.score - a.score);
  await fs.mkdir(CONFIG.stateFile.split('/').slice(0,-1).join('/') || '.', { recursive: true });
  const payload = { generatedAt: new Date(now).toISOString(), config: { ...CONFIG, telegramToken: undefined }, traders: results };
  await fs.writeFile(CONFIG.stateFile, JSON.stringify(payload, null, 2));

  console.log('\n🟣 HYPERLIQUID DAY-TRADER MONITOR');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  for (const [i, r] of results.entries()) {
    console.log(`${i+1}. ${r.short} | score ${num(r.score).toFixed(1)} | 24h fills ${r.fills24h ?? 0} | volume $${num(r.volume24h).toLocaleString()} | WR ${num(r.winRate24h).toFixed(1)}% | PnL ${money(num(r.realized24h))} | avg hold ${r.avgHoldHours == null ? 'N/A' : r.avgHoldHours.toFixed(1)+'h'} | ${r.dayTraderEligible ? 'DAY-TRADER OK' : 'FILTERED'}`);
    if (r.positions) for (const p of r.positions) console.log(`   ${p.coin} ${p.side} | entry ${p.entry} | lev ${p.leverage}x | uPnL ${money(p.unrealizedPnl)}`);
    if (r.error) console.log(`   ERROR: ${r.error}`);
  }
  const eligible = results.filter(r => r.dayTraderEligible);
  const top = eligible.slice(0, 5);
  if (top.length) {
    const lines = ['🟣 HYPERLIQUID — DAY-TRADER WATCH', '━━━━━━━━━━━━━━━━━━'];
    for (const r of top) lines.push(`👤 ${r.short}\n📈 WR ${r.winRate24h.toFixed(1)}% | 24h trades ${r.fills24h} | Vol $${(r.volume24h/1e6).toFixed(2)}M\n💰 PnL ${money(r.realized24h)} | Hold ${r.avgHoldHours == null ? 'N/A' : r.avgHoldHours.toFixed(1)+'h'} | Score ${r.score.toFixed(1)}`);
    await telegram(lines.join('\n'));
  }
}

main().catch(e => { console.error(e); process.exitCode = 1; });
