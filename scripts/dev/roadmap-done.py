#!/usr/bin/env python3
"""roadmap-done.py <item-id>: delete the item from ROADMAP.md and drop it from every needs list."""
import re,sys
item=sys.argv[1]
r=open('ROADMAP.md').read()
m=re.search(rf'^### {re.escape(item)} —.*?(?=^### |^## |\Z)',r,re.M|re.S)
assert m, item
r=r[:m.start()]+r[m.end():]
def fix(mm):
    needs=[n.strip() for n in mm.group(1).split(',') if n.strip() not in (item,'—')]
    return 'needs: '+(', '.join(needs) or '—')+mm.group(2)
r=re.sub(r'^needs: (.*?)(\s{2,}cost)',fix,r,flags=re.M)
open('ROADMAP.md','w').write(r)
