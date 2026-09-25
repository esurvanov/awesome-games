#!/usr/bin/env python3
"""Measure a game screenshot with the SAME method used for targets.json.
Usage: python3 references/measure.py shot.png [category|night_master]
Prints the metrics next to the target medians. Requires Pillow only."""
import sys,json,os,statistics as st
from PIL import Image
HERE=os.path.dirname(os.path.abspath(__file__))
def lin(c): c/=255; return c/12.92 if c<=0.04045 else ((c+0.055)/1.055)**2.4
LUT=[lin(i) for i in range(256)]
def Y(p): return 0.2126*LUT[p[0]]+0.7152*LUT[p[1]]+0.0722*LUT[p[2]]
def sat(p): mx=max(p); return 0 if mx==0 else (mx-min(p))/mx
def pct(a,q): a=sorted(a); return a[min(len(a)-1,int(q*len(a)))]
def med(px): return [int(st.median([p[i] for p in px])) for i in range(3)] if len(px)>=30 else None
def measure(path):
    im=Image.open(path).convert('RGB'); im.thumbnail((400,400)); W,H=im.size
    px=list(im.getdata()); rows=[px[r*W:(r+1)*W] for r in range(H)]; ys=[Y(p) for p in px]
    isA=lambda p:p[1]>p[0]*1.3 and p[1]>p[2]*1.05 and p[1]>60
    snow=sorted([p for r in range(int(H*.4),H) for p in rows[r] if sat(p)<0.45 and p[2]>=p[0]-15 and max(p)>40],key=Y)
    lit=snow[int(len(snow)*.8):]; shd=snow[int(len(snow)*.1):int(len(snow)*.3)]
    sky=[p for r in range(int(H*.15)) for p in rows[r] if not isA(p)]
    band=[p for r in range(int(H*.35),int(H*.75)) for p in rows[r]]
    ly=st.median([Y(p) for p in lit]) if lit else None; sy=st.median([Y(p) for p in shd]) if shd else None
    return dict(Y_median=round(st.median(ys),4),Y_p05=round(pct(ys,.05),4),Y_p95=round(pct(ys,.95),4),
      snow_lit_rgb=med(lit),snow_shadow_rgb=med(shd),sky_rgb=med(sky),aurora_rgb=med([p for p in px if isA(p)]),
      warm_light_rgb=med([p for p in px if p[0]>170 and p[0]>p[2]*1.6 and p[1]>90]),
      lit_shadow_ratio=round((ly+.005)/(sy+.005),2) if ly is not None and sy is not None else None,
      snow_blue_over_red_lit=round(st.median([p[2]/max(1,p[0]) for p in lit]),3) if lit else None,
      snow_blue_over_red_shadow=round(st.median([p[2]/max(1,p[0]) for p in shd]),3) if shd else None,
      dark_frac_midband=round(sum(1 for p in band if Y(p)<0.02)/max(1,len(band)),3),
      michelson_p05_p95=round((pct(ys,.95)-pct(ys,.05))/(pct(ys,.95)+pct(ys,.05)+1e-6),3))
if __name__=='__main__':
    m=measure(sys.argv[1]); key=sys.argv[2] if len(sys.argv)>2 else 'night_master'
    T=json.load(open(os.path.join(HERE,'targets.json')))
    tgt=(T['categories'].get(key) or T.get(key) or {}).get('measured',{})
    for k,v in m.items():
        t=tgt.get(k,{}); print(f'{k:28s} shot={v!s:18s} target={t.get("median")!s:18s} range={[t.get("min"),t.get("max")] if "min" in t else ""}')
