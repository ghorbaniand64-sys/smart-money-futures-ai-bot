from PIL import Image, ImageDraw, ImageFont, ImageFilter
import json, sys, os, math
D=json.load(sys.stdin)
out=sys.argv[1]
W=1200; H=1200
is_tp=D.get('status')=='TP'; is_sl=D.get('status')=='SL'; long=str(D.get('side','LONG')).upper()=='LONG'
accent=(0,255,151) if is_tp else (255,35,66) if is_sl else (255,174,55)
# premium black background with directional neon streaks
im=Image.new('RGB',(W,H),(3,6,10)); pix=im.load()
for y in range(H):
  for x in range(W):
    glow=max(0,1-math.sqrt(((x-1040)/650)**2+((y-330)/700)**2))
    pix[x,y]=(int(3+glow*accent[0]*.12),int(6+glow*accent[1]*.10),int(10+glow*accent[2]*.10))
d=ImageDraw.Draw(im,'RGBA')
# diagonal neon streaks on right
for i in range(14):
  x0=870+i*27
  d.line((x0,0,x0-360,520+i*8),fill=(*accent, max(10,65-i*3)),width=2+(i%3))
# fonts
fontdir='/usr/share/fonts/truetype/dejavu'
def font(name,size):
  p=os.path.join(fontdir,name)
  if not os.path.exists(p): p='/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf'
  return ImageFont.truetype(p,size)
reg='DejaVuSans.ttf'; bold='DejaVuSans-Bold.ttf'
def txt(x,y,s,size,fill=(240,245,250),f=reg): d.text((x,y),str(s),font=font(f,size),fill=fill)
def right(x,y,s,size,fill=(240,245,250),f=reg):
  ff=font(f,size); d.text((x-d.textbbox((0,0),str(s),font=ff)[2],y),str(s),font=ff,fill=fill)
# top identity
txt(72,52,'N /',54,accent,bold); txt(155,61,'NOVARA AI',42,(245,248,252),bold)
txt(75,122,'HYPERLIQUID MARKET DATA   •   SIMULATED TRADE',18,(150,165,185),reg)
d.line((72,165,1128,165),fill=(*accent,170),width=2)
coin=str(D.get('coin','BTC')).upper(); side='LONG' if long else 'SHORT'; lev=f"{D.get('leverage',1)}X"
txt(75,195,f'{coin} / USDT',48,(248,250,255),bold); txt(530,204,'|',44,accent,reg); txt(575,207,side,36,accent,bold); txt(760,210,lev,30,(245,248,252),reg)
# outcome hero
move=float(D.get('movePct',0)); pnl=float(D.get('pnl',0)); pnlpct=float(D.get('pnlPct',0))
txt(70,280,'+' if pnl>=0 else '−',76,accent,bold)
txt(125,270,f'{abs(pnlpct):.2f}%',100,accent,bold)
status='TAKE PROFIT HIT' if is_tp else 'STOP LOSS HIT' if is_sl else 'OUTCOME REVIEW'
d.rounded_rectangle((750,290,1120,395),radius=25,outline=(*accent,255),width=4,fill=(0,0,0,100))
txt(785,320,'✓' if is_tp else '×' if is_sl else '!',44,accent,bold); txt(850,329,status,23,accent,bold)
d.line((72,405,1128,405),fill=(*accent,160),width=2)
# left detail panel
rows=[('MARGIN',f"${float(D.get('margin',1000)):,.2f}"),('LEVERAGE',lev),('NOTIONAL',f"${float(D.get('notional',1000)):,.0f}"),('ENTRY',D.get('entryText','—')),('TAKE PROFIT',D.get('tpText','—')),('STOP LOSS',D.get('slText','—')),('EXIT / REF.',D.get('exitText','—')),('DURATION',D.get('duration','—'))]
y=438
for label,val in rows:
  d.ellipse((78,y+7,94,y+23),outline=(*accent,255),width=2)
  txt(115,y,label,19,(145,164,188),reg); right(585,y-2,val,22,(245,248,252),bold)
  d.line((78,y+42,605,y+42),fill=(70,82,98,155),width=1)
  y+=65
# right visual: stylized rising/falling chart and car-like silhouette-ish dynamic bars
# chart frame
d.rounded_rectangle((660,440,1120,850),radius=24,outline=(70,85,100,150),width=2,fill=(0,0,0,65))
txt(695,465,'PRICE ACTION',18,(150,165,185),bold)
# grid
for gy in range(520,810,55): d.line((690,gy,1090,gy),fill=(60,75,90,70),width=1)
points=[]
for i in range(9):
  x=700+i*46
  base=755-i*17 if (is_tp == long) else 535+i*20
  yy=base + [0,25,-15,18,-28,12,-24,10,-5][i]
  points.append((x,yy))
d.line(points,fill=(*accent,255),width=5,joint='curve')
for x,y0 in points: d.ellipse((x-5,y0-5,x+5,y0+5),fill=(*accent,255))
txt(700,805,'PAPER TRACKING',16,(140,155,175),reg)
# pnl capsule
d.rounded_rectangle((72,930,1128,1025),radius=28,outline=(*accent,255),width=3,fill=(0,0,0,130))
txt(105,955,'SIMULATED P&L',21,accent,bold)
right(1085,946,f"{'+' if pnl>=0 else '−'}${abs(pnl):,.2f}   ({pnlpct:+.2f}%)",35,accent,bold)
# footer
txt(75,1065,f"Strategy: {str(D.get('strategy','NOVARA AI')).replace('NOVARA-SMART-MONEY-AI-','')[:48]}",17,(145,160,180),reg)
txt(75,1100,f"Setup: {str(D.get('pattern','')).replace('_',' ')}    •    Market: {coin} PERP",17,(145,160,180),reg)
txt(75,1140,'PAPER TRADING  •  NO REAL ORDERS EXECUTED',17,(165,178,194),bold)
im.save(out,'PNG',optimize=True)
