#!/bin/bash
# End-to-end finisher for the people layer. Writes logs/finish_summary.txt.
cd "$(dirname "$0")"
SUMMARY=logs/finish_summary.txt
echo "=== people-layer finisher $(date) ===" > $SUMMARY

echo "--- 1. qid top-up ---" >> $SUMMARY
python3 -u qid_topup.py >> $SUMMARY 2>&1
QID_TOTAL=$(python3 -c "import json;print(len(json.load(open('raw/qids_ckpt.json'))))")
echo "qids resolved: $QID_TOTAL" >> $SUMMARY

echo "--- 2. entities + places + merge ---" >> $SUMMARY
python3 -u fetch_people_geo2.py >> $SUMMARY 2>&1
python3 - <<PY >> $SUMMARY 2>&1
import json
d = json.load(open('raw/people.json'))
withc = sum(1 for p in d if p.get('blat') is not None)
print(f"people.json: {len(d)} people, {withc} with birth coords")
for probe in ('Albert Einstein', 'Leonardo da Vinci'):
    m = [p for p in d if p['name'] == probe]
    print(f"  {probe}: {'OK by=' + str(m[0]['by']) if m else 'MISSING'}")
PY

echo "--- 3. build events ---" >> $SUMMARY
python3 build_events.py >> $SUMMARY 2>&1 || echo "BUILD_EVENTS FAILED" >> $SUMMARY

echo "--- 4. rebuild deploy ---" >> $SUMMARY
cd ../web
npx vite build --outDir ../earthview-deploy --emptyOutDir >> $SUMMARY 2>&1 || echo "VITE BUILD FAILED" >> $SUMMARY

echo "--- 5. deploy server ---" >> $SUMMARY
if ! curl -s -o /dev/null http://localhost:4180/ ; then
  (cd ../earthview-deploy && nohup python3 -m http.server 4180 > /tmp/earthview_server.log 2>&1 &)
  sleep 2
fi
curl -s -o /dev/null -w "server: %{http_code}\n" http://localhost:4180/ >> $SUMMARY

echo "--- 6. verification harness ---" >> $SUMMARY
node verify/verify.mjs http://localhost:4180/ >> $SUMMARY 2>&1
RC=$?
echo "HARNESS_EXIT_CODE=$RC" >> $SUMMARY
if [ $RC -eq 0 ]; then echo "RESULT=GREEN" >> $SUMMARY; else echo "RESULT=FAILED" >> $SUMMARY; fi
echo "=== done $(date) ===" >> $SUMMARY
