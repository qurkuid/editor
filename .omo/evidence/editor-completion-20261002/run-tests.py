import concurrent.futures,json,re,subprocess,time
from pathlib import Path
b=Path('.omo/evidence/editor-completion-20261002');files=subprocess.check_output(['git','ls-files','--','apps/**/*.test.ts','apps/**/*.test.tsx','packages/**/*.test.ts','packages/**/*.test.tsx'],text=True).splitlines()
def check(p):
 t=time.monotonic()
 try:
  r=subprocess.run(['bun','test',p],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=120)
  s=r.stdout;out={'file':p,'exit':r.returncode,'pass':sum(map(int,re.findall(r'(?m)^\s*(\d+) pass\s*$',s))),'skip':sum(map(int,re.findall(r'(?m)^\s*(\d+) skip\s*$',s))),'seconds':round(time.monotonic()-t,2)}
  if r.returncode:out['output']=s
  return out
 except Exception as e:return {'file':p,'exit':-1,'output':str(e),'pass':0,'skip':0}
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
 results=[]
 for i,r in enumerate(pool.map(check,files)):
  results.append(r)
  if r['exit'] or i%50==0:print(i+1,len(files),r['file'],r['exit'],flush=True)
(b/'all-tests.json').write_text(json.dumps(results,ensure_ascii=False,indent=2));s={'files':len(results),'pass':sum(x['pass'] for x in results),'skip':sum(x['skip'] for x in results),'failedFiles':[x['file'] for x in results if x['exit']]};(b/'test-summary.json').write_text(json.dumps(s,indent=2));(b/'test-failures.log').write_text('\n\n'.join(x['file']+'\n'+x.get('output','') for x in results if x['exit']));print(s,flush=True)
raise SystemExit(bool(s['failedFiles']))
