from pathlib import Path

exec(Path('.omo/evidence/apartment-accuracy-20261001/inspect-pipeline.py').read_text().split('for c in json.loads')[0])
for key in sys.argv[1:]:
 a=pickle.load(open(b/key/'analysis.pickle','rb'));m=a['masks'];print(key)
 for o in a['openings']:
  d=(o.b-o.a)/np.linalg.norm(o.b-o.a); L=np.linalg.norm(o.b-o.a); contrasts=[];peaks=[]
  for t in np.arange(0,L-6*v.UP,6*v.UP):
   p=v.gap_cross_profile(m['v'],o.a+d*t,o.a+d*min(t+6*v.UP,L),o.width); contrasts.append(round(max(p)-min(p),1));peaks.append(round(max(p),1))
  print(o.kind,(o.a/2).round(1),(o.b/2).round(1),'cov',np.mean(np.array(contrasts)>=25),'low',sum(c<15 for c in contrasts), 'range',contrasts)
