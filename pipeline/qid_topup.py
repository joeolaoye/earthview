"""Re-run title->qid resolution until (nearly) all harvest titles resolve."""
import json
from fetch_people_geo import title_to_qid

wiki = json.load(open('raw/people_wiki.json'))
titles = sorted({e['title'] for e in wiki if not e["title"].isdigit() and len(e["title"]) >= 2})
print(f"titles: {len(titles)}")
for i in range(4):
    ckpt = json.load(open('raw/qids_ckpt.json'))
    missing = [t for t in titles if t not in ckpt]
    print(f"pass {i+1}: {len(ckpt)} resolved, {len(missing)} missing", flush=True)
    if len(missing) < 1500:
        break
    title_to_qid(missing)
ckpt = json.load(open('raw/qids_ckpt.json'))
print(f"final: {len(ckpt)} resolved, {len([t for t in titles if t not in ckpt])} missing")
print("Leonardo:", ckpt.get("Leonardo da Vinci"))
