# CM-0806 residual (H5) — NOT_READY / GAP kept open

| field | value |
|-------|-------|
| CM | CM-0806 |
| evidence_cmd | `bash /workspace/bitbot/scripts/host_h5_smoke.sh residual-0806` |
| status | NOT_READY |
| i_claimed | false |
| assert | Residual only. Shared-session rule forbids copying cookies from `/home/box/chrome-profile` and forbids CDP **9223**. No true Update Computer lifecycle exercised. GAP row **not deleted**. |

## Why NOT_READY

1. Shared box chrome-profile / CDP 9223 is a live operator session — Host smoke must not seed or copy its cookie jar.
2. Before/after jar hashes inside one running session do not prove Update Computer login persistence.
3. H5 advances media/UI CMs; 0806 stays an open GAP until a dedicated Update Computer Host path can be proven without touching the shared session.

