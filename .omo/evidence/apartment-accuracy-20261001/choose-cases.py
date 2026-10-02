import json
from pathlib import Path
b=Path(__file__).parent
old=json.loads(Path('.omo/evidence/apartment-completeness-20261001/cases.json').read_text())
new=[('daeyeon','대연힐스테이트푸르지오','154B㎡','3FO4KH0OJL5I','3FO3YBRFCS62'),('centum','더샵센텀파크1차','197㎡','3FO4KH3VQOJ0','3FO3Y8IOXTF4'),('forest','래미안포레스티지','101D㎡','3FO4KHMSJD8B','3FO40NYO9IFT'),('sajik','사직롯데캐슬더클래식','148A㎡','3FO4KHMS29P7','3FO40NS9PWUJ'),('beonyeong','번영로센텀파크에일린의뜰','81㎡','3FO4K9H8O3IR','3FO3SY16C3LW')]
cases=[dict(**c,cohort='regression') for c in old]+[dict(key=k,name=n,type=t,apartmentId=a,planId=p,cohort='new') for k,n,t,a,p in new]
(b/'cases.json').write_text(json.dumps(cases,ensure_ascii=False,indent=2))
for c in cases:(b/c['key']).mkdir(exist_ok=True)
