import fs from "node:fs/promises";
const A=process.env.HYPERLIQUID_API_URL||"https://api.hyperliquid.xyz/info";
const days=+(process.env.HYPERLIQUID_HUNTER_LOOKBACK_DAYS||7), max=+(process.env.HYPERLIQUID_HUNTER_MAX_CANDIDATES||300);
const MIN=+(process.env.HYPERLIQUID_HUNTER_MIN_7D_TRADES||30), WR=+(process.env.HYPERLIQUID_HUNTER_MIN_7D_WIN_RATE||65);
const PNL=+(process.env.HYPERLIQUID_HUNTER_MIN_7D_PNL||0), PF=+(process.env.HYPERLIQUID_HUNTER_MIN_PROFIT_FACTOR||1.5);
const MED=+(process.env.HYPERLIQUID_HUNTER_MAX_MEDIAN_HOLD_HOURS||6), AVG=+(process.env.HYPERLIQUID_HUNTER_MAX_AVG_HOLD_HOURS||12);
const ACTIVE=+(process.env.HYPERLIQUID_HUNTER_MIN_ACTIVE_DAYS||4), STREAK=+(process.env.HYPERLIQUID_HUNTER_MAX_LOSING_STREAK||8), LIQ=+(process.env.HYPERLIQUID_HUNTER_MAX_LIQUIDATIONS||1);
const STATE=process.env.HYPERLIQUID_HUNTER_STATE_FILE||"state/hyperliquid_trader_hunter_v3.json";
const DISC=process.env.HYPERLIQUID_HUNTER_DISCOVERY_URL||"https://stats-data.hyperliquid.xyz/Mainnet/leaderboard";
const re=/^0x[a-f0-9]{40}$/i, uniq=a=>[...new Set(a)];
const addrs=s=>uniq(String(s||"").split(/[\s,;\n]+/).map(x=>x.toLowerCase()).filter(x=>re.test(x)));
async function post(body){let r=await fetch(A,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});if(!r.ok)throw Error("Info "+r.status);return r.json()}
function extract(v,o=[]){if(typeof v==="string"){if(re.test(v))o.push(v.toLowerCase());return o}if(Array.isArray(v)){v.forEach(x=>extract(x,o));return o}if(v&&typeof v==="object")Object.values(v).forEach(x=>extract(x,o));return o}
async function discover(){
 let out=[];try{let r=await fetch(DISC);if(!r.ok)throw Error("Discovery "+r.status);out=extract(await r.json());console.log("[DISCOVERY]",out.length)}catch(e){console.log("[DISCOVERY] unavailable:",e.message)}
 return uniq([...out,...addrs(process.env.HYPERLIQUID_HUNTER_CANDIDATES),...addrs(process.env.HYPERLIQUID_TRADERS)]).slice(0,max)
}
async function fills(user,start,end){
 let all=[], cursor=start;
 for(let i=0;i<10;i++){let r=await post({type:"userFillsByTime",user,startTime:cursor,endTime:end});if(!Array.isArray(r)||!r.length)break;all.push(...r);if(r.length<2000)break;let t=Math.max(...r.map(x=>+x.time||0));if(t<cursor)break;cursor=t+1}
 let s=new Set();return all.filter(x=>{let k=[x.tid,x.hash,x.time,x.oid,x.px,x.sz].join(":");if(s.has(k))return false;s.add(k);return true})
}
const side=d=>({Open:"O",Close:"C"}[String(d).split(" ")[0]]||null), dir=d=>String(d).endsWith("Long")?"L":"S";
function calc(fs){
 let b=new Map(),c=[],liq=0;
 for(let f of fs.sort((a,b)=>a.time-b.time)){if(/liquidat/i.test(f.dir))liq++;let t=side(f.dir);if(!t||!f.coin)continue;let k=f.coin,s=dir(f.dir);if(!b.has(k))b.set(k,{L:[],S:[]});let q=b.get(k)[s],n=Math.abs(+f.sz||0);
  if(t==="O")q.push({n,p:+f.px||0,t:+f.time});else{let rem=n;while(rem>1e-12&&q.length){let z=q[0],take=Math.min(rem,z.n);c.push({t:+f.time-z.t,p:+f.closedPnl||0});z.n-=take;rem-=take;if(z.n<=1e-12)q.shift()}}
 }
 let p=c.map(x=>x.p),w=p.filter(x=>x>0),l=p.filter(x=>x<0),h=c.map(x=>x.t/36e5).sort((a,b)=>a-b), med=h.length?(h.length%2?h[(h.length-1)/2]:(h[h.length/2-1]+h[h.length/2])/2):null;
 let pnl=p.reduce((a,b)=>a+b,0),gp=w.reduce((a,b)=>a+b,0),gl=Math.abs(l.reduce((a,b)=>a+b,0)), days=new Set(c.map(x=>new Date(x.t+Date.now()).toISOString().slice(0,10))).size;
 let streak=0,mx=0;for(let x of p){if(x<0){streak++;mx=Math.max(mx,streak)}else streak=0}
 return {trades:c.length,pnl,wr:c.length?w.length/c.length*100:null,pf:gl?gp/gl:(gp?Infinity:null),med,avg:h.length?h.reduce((a,b)=>a+b,0)/h.length:null,activeDays:days,streak,liq}
}
function pass(x){return x.trades>=MIN&&x.wr>=WR&&x.pnl>=PNL&&(x.pf===Infinity||x.pf>=PF)&&x.med!=null&&x.med<=MED&&x.avg!=null&&x.avg<=AVG&&x.activeDays>=ACTIVE&&x.streak<=STREAK&&x.liq<=LIQ}
const now=Date.now(),start=now-days*864e5, candidates=await discover(),res=[];
for(let i=0;i<candidates.length;i++){try{res.push({address:candidates[i],...calc(await fills(candidates[i],start,now))})}catch(e){res.push({address:candidates[i],error:e.message})}if((i+1)%25===0)console.log("[SCAN]",i+1,candidates.length)}
const ok=res.filter(pass).sort((a,b)=>(b.pnl-a.pnl)),top=res.filter(x=>x.trades!=null).sort((a,b)=>((b.wr||0)-(a.wr||0))).slice(0,10);
const money=x=>x==null?"N/A":(x>=0?"+":"-")+"$"+Math.abs(x).toLocaleString("en-US",{maximumFractionDigits:2});
let msg=["🟣 HYPERLIQUID TRADER HUNTER V3","📡 READ-ONLY | 7D FIFO CLOSED-TRADE SCAN",`👥 Candidates ${candidates.length} | PASS ${ok.length}`,"","🏆 TOP PASS"];
(ok.length?ok.slice(0,5):[{address:"NONE"}]).forEach((x,i)=>msg.push(`\n#${i+1} ${x.address.slice(0,6)}…${x.address.slice(-4)}\nTrades ${x.trades||0} | WR ${x.wr==null?"N/A":x.wr.toFixed(1)+"%"} | PnL ${money(x.pnl)}\nHold ${x.med==null?"N/A":x.med.toFixed(2)+"h"} median / ${x.avg==null?"N/A":x.avg.toFixed(2)+"h"} avg | Active ${x.activeDays||0}/7\nPF ${x.pf===Infinity?"∞":x.pf==null?"N/A":x.pf.toFixed(2)} | Lose ${x.streak||0} | Liq ${x.liq||0}`));
if(process.env.TELEGRAM_TOKEN&&process.env.TELEGRAM_CHAT_ID)await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({chat_id:process.env.TELEGRAM_CHAT_ID,text:msg.join("\n")})});
await fs.mkdir("state",{recursive:true});await fs.writeFile(STATE,JSON.stringify({version:"V3",generatedAt:new Date().toISOString(),candidates:candidates.length,pass:ok,top10:top,results:res},null,2));
console.log("[DONE]",{candidates:candidates.length,pass:ok.length});
