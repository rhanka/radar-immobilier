import json,re,sys,pathlib,unicodedata,subprocess,os
W=pathlib.Path(sys.argv[1]); city=sys.argv[2]; timeout=int(sys.argv[3]) if len(sys.argv)>3 else 600
by=json.load(open(W/'nodes-by-sha.json'))
def ref_from(n):
    s=n.get('label','')+' '+(n.get('properties') or {}).get('description','')
    m=re.search(r'\b(DM\s*\d{4}[-–]\s*0*\d{1,4})\b',s,re.I)
    return m.group(1) if m else None
def norm(s): return re.sub(r'\s+',' ',unicodedata.normalize('NFKC',s).replace('\xa0',' ')).strip().lower()
def find_windows(txt, ref):
    pats=[]
    m=re.search(r'DM\s*(\d{4})[-–]\s*0*(\d+)',ref,re.I)
    if m:
        y,num=m.groups(); pats=[rf'DM\s*{y}\s*[-–]\s*0*{int(num)}\b']
    else: pats=[re.escape(ref)]
    wins=[]
    for pat in pats:
        for mm in re.finditer(pat, txt, re.I):
            a=max(0,mm.start()-700); b=min(len(txt),mm.end()+1600)
            chunk=txt[a:b]
            # page marker before
            pm=list(re.finditer(r'===== PAGE (\d+) =====', txt[:mm.start()]))
            page=int(pm[-1].group(1)) if pm else 0
            wins.append({'page':page,'text':chunk})
    # unique first 4
    out=[]; seen=set()
    for w in wins:
        k=norm(w['text'][:200])
        if k not in seen: out.append(w); seen.add(k)
        if len(out)>=4: break
    return out
for e in by:
    sha=e['docSha']; txtp=W/'txts'/f'{sha}.txt'; txt=txtp.read_text(errors='replace')
    existing=[]; p=W/'cites'/f'{sha}.json'
    if p.exists():
        try:
            obj=json.load(open(p)); existing=[r for r in obj.get('results',[]) if r.get('found') and r.get('excerpt') and r.get('page') and norm(r.get('excerpt','')) in norm(txt)]
        except Exception: pass
    done={r['id'] for r in existing}
    todo=[]
    for n in e['nodes']:
        if n['id'] in done: continue
        ref=ref_from(n); wins=find_windows(txt, ref) if ref else []
        todo.append({'id':n['id'],'label':n.get('label'), 'reference': ref, 'snippets': wins})
    if not todo:
        continue
    prompt=W/'cites'/f'{sha}.snippets.prompt.txt'; raw=W/'cites'/f'{sha}.snippets.raw.txt'; err=W/'cites'/f'{sha}.snippets.err.txt'; out=W/'cites'/f'{sha}.snippets.json'
    prompt.write_text("\n".join([
        f"Tu es un extracteur de citations pour un procès-verbal municipal ({city}, Québec).",
        "On te donne, pour chaque nœud, des EXTRAITS VERBATIM du PV autour de sa référence, avec page.",
        "Pour CHAQUE nœud, choisis dans ces extraits le passage EXACT qui justifie le nœud.",
        "RÈGLES STRICTES: excerpt doit être copié VERBATIM depuis un snippet fourni (30 à 400 caractères); page = page du snippet où commence le passage; aucune reformulation; si aucun snippet ne justifie, found=false. JSON uniquement.",
        '{"results":[{"id":"<id>","found":true,"page":<int>,"excerpt":"<verbatim>"}]}',
        "NŒUDS ET SNIPPETS:", json.dumps(todo,ensure_ascii=False)
    ]),encoding='utf-8')
    print('run',sha,'todo',len(todo),'prompt',prompt.stat().st_size, flush=True)
    ok=False
    for a in range(2):
        with open(prompt,'rb') as stdin, open(raw,'wb') as stdout, open(err,'wb') as stderr:
            rc=subprocess.run(['timeout',str(timeout),'claude','-p','--model',os.environ.get('CLAUDE_MODEL','claude-sonnet-4-6')],stdin=stdin,stdout=stdout,stderr=stderr).returncode
        if rc==0 and b'{' in raw.read_bytes(): ok=True; break
        print(' fail',a+1,'rc',rc,err.read_text(errors='replace')[-200:], flush=True)
    results=[]
    if ok:
        m=re.search(r'\{.*\}', raw.read_text(errors='replace'), re.S)
        if m:
            try: results=json.loads(m.group(0)).get('results',[])
            except Exception as ex: print('parse',ex)
    valid=[]
    nt=norm(txt)
    for r in results:
        ex=(r.get('excerpt') or '').strip(); pg=r.get('page') or 0
        if r.get('found') and ex and pg and norm(ex) in nt:
            valid.append({'id':r.get('id'),'found':True,'page':int(pg),'excerpt':ex})
    allres=existing+valid
    seen={r['id'] for r in allres}
    ids={n['id'] for n in e['nodes']}
    for i in ids-seen: allres.append({'id':i,'found':False,'page':0,'excerpt':''})
    (W/'cites'/f'{sha}.json').write_text(json.dumps({'results':allres},ensure_ascii=False,indent=2),encoding='utf-8')
    print('wrote',sha,sum(1 for r in allres if r.get('found')),'/',len(ids), flush=True)
