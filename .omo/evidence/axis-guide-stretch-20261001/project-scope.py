import subprocess,sys,shutil
from pathlib import Path
root=Path('/Users/changseok/editor'); release=Path('/private/tmp/pascal-axis-stretch-release')
baseline=root/'.omo/evidence/axis-guide-stretch-20261001/baseline'
files=[line.strip() for line in Path(sys.argv[1]).read_text().splitlines() if line.strip()]
for relative in files:
 source=root/relative;target=release/relative;original=baseline/relative
 target.parent.mkdir(parents=True,exist_ok=True)
 if original.exists():
  clean=subprocess.run(['git','show','HEAD:'+relative],cwd=release,capture_output=True,check=True).stdout
  cleanfile=root/'.omo/evidence/axis-guide-stretch-20261001/clean-base.tmp';cleanfile.write_bytes(clean)
  result=subprocess.run(['git','merge-file','-p',str(cleanfile),str(original),str(source)],capture_output=True)
  if result.returncode: raise RuntimeError('Scoped three-way conflict: '+relative+'\n'+result.stdout.decode())
  target.write_bytes(result.stdout)
 else: shutil.copyfile(source,target)
 print(relative)
