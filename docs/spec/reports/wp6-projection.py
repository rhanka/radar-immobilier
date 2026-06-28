#!/usr/bin/env python3
"""WP6 — projection multi-échelle / multi-temporelle du backlog Track.

Source de vérité = Track (.track/events.jsonl). Le rattachement WP est une
projection (wp6-item-wp-map.json) car le reparent physique cross-workspace est
bloqué par l'invariant de containment de Track 0.19.2 (voir wp6-socle-status.md).

Échelles (filtres, pas des WP) : now / week / month / project.
Statuts (vue client) : done / needs_review / in_progress / planned / blocked / dropped.
Règle d'honnêteté : AWAITED done non signé => needs_review (jamais "fait").

Usage :
  python3 wp6-projection.py [--now ISO8601] [--events PATH] [--map PATH] \
      [--out-json PATH] [--out-md PATH]
Sans --out-*, écrit wp6-rollup.json et wp6-rollup.md à côté du script.
"""
import json, sys, os, argparse, subprocess
from datetime import datetime, timedelta, timezone
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
WP_ORDER = ["WP1","WP2","WP3","WP4","WP5","WP6"]
WP_TITLE = {
 "WP1":"DATA — sources & substrat",
 "WP2":"EXTRACTION — signaux & ontologie",
 "WP3":"RÉCONCILIATION E2E & PREUVE",
 "WP4":"PRODUIT — app radar client",
 "WP5":"PLATEFORME & SCALE",
 "WP6":"GOUVERNANCE — pilotage Track",
}

def parse_iso(s):
    return datetime.fromisoformat(s.replace("Z","+00:00"))

def load_events(path):
    ev=[]
    with open(path) as f:
        for line in f:
            line=line.strip()
            if not line: continue
            ev.append(json.loads(line))
    return ev

def status_of(it):
    """Vue client (decision §3) à partir de bucket+realization Track."""
    b=it.get("bucket"); r=it.get("realization")
    if b=="DROPPED" or r=="cancelled": return "dropped"
    if b=="AWAITED": return "needs_review"        # done non signé
    if b=="DONE" or r=="done": return "done"
    if r=="in-progress": return "in_progress"
    return "planned"

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--now", default="2026-06-28T23:59:59Z")
    ap.add_argument("--events", default=os.path.join(HERE,"..","..","..",".track","events.jsonl"))
    ap.add_argument("--map", default=os.path.join(HERE,"wp6-item-wp-map.json"))
    ap.add_argument("--out-json", default=os.path.join(HERE,"wp6-rollup.json"))
    ap.add_argument("--out-md", default=os.path.join(HERE,"wp6-rollup.md"))
    a=ap.parse_args()
    now=parse_iso(a.now)
    windows={
      "now":   None,  # snapshot WIP (in_progress courant)
      "week":  now-timedelta(days=7),
      "month": now-timedelta(days=30),
      "project": None, # depuis le début
    }
    mp=json.load(open(a.map))
    item2wp={m["itemId"]:m["wpCode"] for m in mp["items"]}
    # état courant par item (autorité Track via CLI query)
    q=json.loads(subprocess.check_output(["track","query","--format","json"]))
    cur={i["id"]:i for i in q if i["id"] in item2wp}
    # transitions horodatées (dimension temps) depuis le log
    done_at=defaultdict(list); created_at={}
    for e in load_events(a.events):
        if e.get("type")=="item.created":
            created_at[e["aggregateId"]]=e["at"]
        elif e.get("type")=="realization.transition" and e.get("payload",{}).get("to")=="done":
            done_at[e["aggregateId"]].append(e["at"])

    # ---- rollup PROJECT (état complet par WP) ----
    project={}
    for wp in WP_ORDER:
        ids=[i for i,w in item2wp.items() if w==wp]
        st=defaultdict(int)
        for i in ids:
            st[status_of(cur[i])]+=1
        total=len(ids); dropped=st["dropped"]
        denom=total-dropped
        done=st["done"]
        pct=round(100*done/denom) if denom else None
        project[wp]={"total":total,**{k:st[k] for k in
            ["done","needs_review","in_progress","planned","blocked","dropped"]},
            "pct_done":pct}
    # ---- vues temporelles ----
    def fait_in(lo):
        """items dont une transition->done a `at`>=lo ET état courant done/needs_review."""
        res=defaultdict(list)
        for i,wp in item2wp.items():
            if status_of(cur[i]) not in ("done","needs_review"): continue
            ats=done_at.get(i,[])
            if lo is None or any(parse_iso(t)>=lo for t in ats):
                res[wp].append(i)
        return res
    def ouvert():
        res=defaultdict(list)
        for i,wp in item2wp.items():
            if status_of(cur[i]) in ("planned","in_progress"): res[wp].append(i)
        return res
    def wip():
        res=defaultdict(list)
        for i,wp in item2wp.items():
            if status_of(cur[i])=="in_progress": res[wp].append(i)
        return res

    views={}
    views["now"]={"desc":"WIP courant (in_progress)","by_wp":{wp:wip().get(wp,[]) for wp in WP_ORDER}}
    for name in ("week","month"):
        lo=windows[name]
        f=fait_in(lo); o=ouvert()
        views[name]={"desc":f"fait depuis {lo.date().isoformat()} + ouvert",
                     "since":lo.isoformat(),
                     "by_wp":{wp:{"fait":f.get(wp,[]),"ouvert":o.get(wp,[])} for wp in WP_ORDER}}
    f=fait_in(None); o=ouvert()
    views["project"]={"desc":"depuis le début","by_wp":{wp:{"fait":f.get(wp,[]),"ouvert":o.get(wp,[])} for wp in WP_ORDER}}

    out={"generatedAt":a.now,"source":"Track .track/events.jsonl (vérité) + wp6-item-wp-map.json (projection WP)",
         "totals":{"items":len(item2wp)},
         "project_rollup":project,"views":views,
         "titles":{i["id"]:cur[i["id"]]["title"] for i in q if i["id"] in cur}}
    json.dump(out,open(a.out_json,"w"),ensure_ascii=False,indent=2)

    # ---- markdown ----
    L=[]
    L.append("# WP6 — Rollups multi-échelle par WorkPackage")
    L.append(f"\n> Généré {a.now}. Source : Track (vérité) + projection WP (wp6-item-wp-map.json).")
    L.append("> Échelles = filtres temporels ; focus = tags ; AWAITED done = needs_review.\n")
    L.append("## Depuis le début (project) — état par WP\n")
    L.append("| WP | total | done | needs_review | in_progress | planned | dropped | %done |")
    L.append("|---|--:|--:|--:|--:|--:|--:|--:|")
    tot=defaultdict(int)
    for wp in WP_ORDER:
        p=project[wp]
        for k in ["total","done","needs_review","in_progress","planned","dropped"]: tot[k]+=p[k]
        L.append(f"| {wp} {WP_TITLE[wp]} | {p['total']} | {p['done']} | {p['needs_review']} | {p['in_progress']} | {p['planned']} | {p['dropped']} | {p['pct_done'] if p['pct_done'] is not None else 'n/a'}% |")
    denom=tot['total']-tot['dropped']
    L.append(f"| **TOTAL** | **{tot['total']}** | **{tot['done']}** | **{tot['needs_review']}** | **{tot['in_progress']}** | **{tot['planned']}** | **{tot['dropped']}** | **{round(100*tot['done']/denom)}%** |")
    titles=out["titles"]
    def fmt(ids,n=8):
        ids=ids[:n]
        return "<br>".join(f"`{i[-6:]}` {titles.get(i,'')[:70]}" for i in ids) or "—"
    # Maintenant
    L.append("\n## Maintenant (now) — WIP en cours par WP\n")
    for wp in WP_ORDER:
        ids=views["now"]["by_wp"][wp]
        if not ids: continue
        L.append(f"**{wp}** ({len(ids)} in_progress)<br>{fmt(ids)}\n")
    # Semaine / Mois
    for name in ("week","month"):
        v=views[name]
        L.append(f"\n## {'Semaine' if name=='week' else 'Mois'} ({name}) — fait depuis {v['since'][:10]} / ouvert\n")
        L.append("| WP | fait (fenêtre) | ouvert (restant) |")
        L.append("|---|--:|--:|")
        for wp in WP_ORDER:
            d=v["by_wp"][wp]
            L.append(f"| {wp} | {len(d['fait'])} | {len(d['ouvert'])} |")
    open(a.out_md,"w").write("\n".join(L)+"\n")
    print("written",a.out_json,"and",a.out_md)
    # echo compact
    print("\nproject rollup:")
    for wp in WP_ORDER:
        p=project[wp]; print(f"  {wp}: {p['done']}/{p['total']} done, {p['needs_review']} needs_review, {p['in_progress']} wip, {p['planned']} planned, {p['dropped']} dropped, {p['pct_done']}%")

if __name__=="__main__":
    main()
