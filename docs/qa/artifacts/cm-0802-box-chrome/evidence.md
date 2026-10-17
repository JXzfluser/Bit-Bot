# CM-0802 host-integration evidence

| field | value |
|-------|-------|
| CM | CM-0802 |
| evidence_cmd | `bash /workspace/bitbot/scripts/host_h1_smoke.sh cm-0802` |
| artifact_dir | `/workspace/bitbot/docs/qa/artifacts/cm-0802-box-chrome` |
| env | box Host smoke; display=:99 (private Xvfb; isolated throwaway box-chrome, port 9333); USER_IANA=Asia/Shanghai; stamp_utc=20261017T062925Z |
| assert | isolated throwaway box-chrome: real numeric pid in /tmp/box-chrome.lock (running→stopped snapshots), --class=box-chrome + --sand-box-chrome-launcher lineage, own CDP port; Host guard refused 5/5 bare chrome launches with no process started (bare_refusal.txt); temp profile + pids cleaned (cleanup_proof.txt) |
| status | READY_FOR_I_REVIEW |
| note | Produced by scripts/host_h1_smoke.sh — **not** HostAbi::mock() / Placeholder PNG. Bit验证 decides I-PASS. |

