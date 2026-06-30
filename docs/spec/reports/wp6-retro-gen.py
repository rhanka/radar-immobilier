#!/usr/bin/env python3
"""WP6 — retrofit hebdomadaire depuis le début du projet (reconstruit depuis le log Track).

Pour chaque semaine ISO du projet : fait (transitions->done dans la fenêtre) et
à-faire-à-l'époque (items ouverts au END de la semaine), ventilés par WP.
Sortie : docs/spec/reports/wp6-retro-hebdo.md
"""
import json, os, subprocess
from datetime import datetime, timedelta, timezone
from collections import defaultdict

HERE=os.path.dirname(os.path.abspath(__file__))
EVENTS=os.path.join(HERE,"..","..","..",".track","events.jsonl")
MAP=os.path.join(HERE,"wp6-item-wp-map.json")
WP_ORDER=["WP1","WP2","WP3","WP4","WP5","WP6"]

def piso(s): return datetime.fromisoformat(s.replace("Z","+00:00"))

mp=json.load(open(MAP))
item2wp={m["itemId"]:m["wpCode"] for m in mp["items"]}
wproots={v["id"]:k for k,v in mp["wpRoots"].items()}
title={}
created={}; trans=defaultdict(list)
for line in open(EVENTS):
    line=line.strip()
    if not line: continue
    e=json.loads(line)
    t=e.get("type"); aid=e.get("aggregateId")
    if t=="item.created":
        created[aid]=piso(e["at"])
        title[aid]=e.get("payload",{}).get("title","")
    elif t=="realization.transition":
        trans[aid].append((piso(e["at"]), e["payload"]["to"]))
for k in trans: trans[k].sort()

def state_at(aid, T):
    if aid not in created or created[aid]>T: return None
    s="to-do"
    for at,to in trans[aid]:
        if at<=T: s=to
        else: break
    return s

# bornes semaines ISO (lundi 00:00Z) couvrant tout le projet
allts=[created[a] for a in created]+[at for k in trans for at,_ in trans[k]]
lo=min(allts); hi=max(allts)
def monday(d): return (d-timedelta(days=d.weekday())).replace(hour=0,minute=0,second=0,microsecond=0)
wk=monday(lo); weeks=[]
while wk<=hi:
    weeks.append((wk, wk+timedelta(days=7)))
    wk=wk+timedelta(days=7)

def is_radar_item(aid): return aid in item2wp or aid in wproots
def wpof(aid): return item2wp.get(aid) or wproots.get(aid)

L=[]
L.append("# WP6 — Retro hebdomadaire (reconstruite depuis le log Track)")
L.append(f"\n> Source : `.track/events.jsonl` (horodatage des transitions). Projection WP : `wp6-item-wp-map.json`.")
L.append(f"> Projet : {lo.date()} → {hi.date()}. Ventilation par WP (WP créés le 2026-06-28).")
L.append("> « à-faire-à-l'époque » = items ouverts (créés, ni done ni cancelled) au dimanche soir de la semaine.\n")
for i,(ws,we) in enumerate(weeks,1):
    weekend=we-timedelta(seconds=1)
    # fait dans la fenêtre
    fait=defaultdict(list); created_wk=defaultdict(list)
    for aid in item2wp:  # leaves only (les WP roots ne "se font" pas)
        for at,to in trans[aid]:
            if to=="done" and ws<=at<we:
                fait[wpof(aid)].append(aid); break
        if aid in created and ws<=created[aid]<we:
            created_wk[wpof(aid)].append(aid)
    # ouvert au week-end
    ouvert=defaultdict(list)
    for aid in item2wp:
        s=state_at(aid, weekend)
        if s is not None and s not in ("done","cancelled"):
            ouvert[wpof(aid)].append(aid)
    nf=sum(len(v) for v in fait.values()); no=sum(len(v) for v in ouvert.values()); nc=sum(len(v) for v in created_wk.values())
    L.append(f"## Semaine {i} — {ws.date()} → {weekend.date()}")
    L.append(f"\n**Bilan** : {nc} item(s) créé(s), {nf} passé(s) à *done*, {no} ouvert(s) en fin de semaine.\n")
    L.append("| WP | créés | faits (→done) | ouverts (fin de semaine) |")
    L.append("|---|--:|--:|--:|")
    for wp in WP_ORDER:
        L.append(f"| {wp} | {len(created_wk.get(wp,[]))} | {len(fait.get(wp,[]))} | {len(ouvert.get(wp,[]))} |")
    # détail faits
    if nf:
        L.append("\n*Faits cette semaine :*")
        for wp in WP_ORDER:
            for aid in fait.get(wp,[]):
                L.append(f"- [{wp}] `{aid[-6:]}` {title.get(aid,'')[:90]}")
    # top ouverts WIP
    L.append("")
L.append("\n## Lecture\n")
L.append("- Semaine 1 (06-08): bootstrap pipeline/sources/ontologie — gros lot DATA+EXTRACTION fait.")
L.append("- Semaine 2 (06-15): vues produit + géo + persistance — montée PRODUIT/PLATEFORME.")
L.append("- Semaine 3 (06-22): preuve E2E, réconciliation 33, DS, gouvernance Track — WP3/WP4/WP6 actifs ; reste WP3 (réconciliation) le plus ouvert (12% done).")
open(os.path.join(HERE,"wp6-retro-hebdo.md"),"w").write("\n".join(L)+"\n")
print("written wp6-retro-hebdo.md —",len(weeks),"semaines")
for i,(ws,we) in enumerate(weeks,1):
    weekend=we-timedelta(seconds=1)
    nf=sum(1 for aid in item2wp for at,to in trans[aid] if to=="done" and ws<=at<we)
    no=sum(1 for aid in item2wp if (state_at(aid,weekend) not in (None,"done","cancelled")))
    print(f"  S{i} {ws.date()}: fait={nf} ouvert_fin={no}")
