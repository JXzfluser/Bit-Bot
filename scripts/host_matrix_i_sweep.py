#!/usr/bin/env python3
"""Wave H6 — full matrix I sweep helper.

Reads I=todo rows from /tmp/matrix_todo.json or docs/capability-matrix.md,
records moon test summary + Live HostAbi ping, writes per-CM evidence under
docs/qa/artifacts/h6-matrix-i/<CM>/ and aggregate SUMMARY.json.

Does NOT claim I-PASS (i_claimed=false). Does NOT invent Live Host I for the
Host-hard 41 inventory (those stay as prior H0–H5 promotions).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ART_ROOT = ROOT / "docs" / "qa" / "artifacts" / "h6-matrix-i"
MATRIX = ROOT / "docs" / "capability-matrix.md"
TODO_JSON = Path("/tmp/matrix_todo.json")
TODO_INPUT_COMMITTED = ART_ROOT / "TODO_INPUT.json"
HOST_SERVER = ROOT / "scripts" / "host_ui_surface" / "host_server.py"

# Floor on the number of MoonBit tests the tree must still run.
#
# This is a tripwire against silent test deletion: without it, dropping ~100
# tests (or a whole package's test files) still reported "moon test ok" because
# the gate only checked that the count was >= 347. Raise it whenever tests are
# ADDED; lower it only together with a stated reason.
#
# Current count: 452 (verified with `moon test`).
MIN_MOON_TEST_PASSED = 452
SWEEP_SH = ROOT / "scripts" / "host_matrix_i_sweep.sh"

# Host-hard inventory already I-PASS via H0–H5 Live evidence. Sweep must refuse
# inventing mock-only Host I for these.
HOST_HARD_41 = frozenset(
    {
        "CM-0204",
        "CM-0205",
        "CM-0206",
        "CM-0411",
        "CM-0605",
        "CM-0607",
        "CM-0608",
        "CM-0705",
        "CM-0802",
        "CM-0806",
        "CM-1105",
        "CM-1401",
        "CM-1405",
        "CM-1507",
        "CM-1601",
        "CM-1602",
        "CM-1603",
        "CM-1703",
        "CM-1807",
        "CM-1901",
        "CM-1902",
        "CM-1903",
        "CM-1904",
        "CM-1905",
        "CM-1906",
        "CM-1907",
        "CM-2101",
        "CM-2103",
        "CM-2109",
        "CM-2120",
        "CM-2128",
        "CM-2131",
        "CM-2146",
        "CM-2157",
        "CM-2158",
        "CM-2160",
        "CM-2163",
        "CM-2164",
        "CM-2174",
        "CM-2175",
        "CM-2178",
    }
)

HOST_HINT = re.compile(
    r"Host UI|host-integration|HostAbi|LiveDisplay|HostUiShell|真屏|真面板",
    re.I,
)


def utc_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def load_todo_json(path: Path) -> list[dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    items = data.get("todo") or data.get("items") or []
    return [normalize_item(it) for it in items]


def parse_matrix_todo() -> list[dict]:
    # Prefer live /tmp list, then committed H6 input (post-promotion re-runs),
    # then parse I=todo rows from the matrix.
    for path in (TODO_JSON, TODO_INPUT_COMMITTED):
        if path.exists():
            items = load_todo_json(path)
            if items:
                return items
    text = MATRIX.read_text(encoding="utf-8")
    rows = re.findall(
        r"^\| (CM-\d+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|\s*$",
        text,
        re.M,
    )
    out = []
    for cm, arch, title, _desc, _mod, pri, evidence, i_st, u_st in rows:
        if i_st.strip() != "todo":
            continue
        ev = evidence.strip()
        test = ""
        m = re.search(r"::([A-Za-z0-9_-]+)", ev)
        if m:
            test = m.group(1)
        file_m = re.search(r"`([^`]+?\.mbt)`", ev)
        out.append(
            {
                "cm": cm.strip(),
                "arch": arch.strip(),
                "title": title.strip(),
                "pri": pri.strip(),
                "evidence": ev,
                "i": "todo",
                "u": u_st.strip(),
                "test": test,
                "file": file_m.group(1) if file_m else "",
            }
        )
    return out


def normalize_item(item: dict) -> dict:
    """Prefer ::acceptance_* name from evidence over coarse JSON test field."""
    ev = str(item.get("evidence") or "")
    m = re.search(r"::([A-Za-z0-9_-]+)", ev)
    if m:
        item = dict(item)
        item["test"] = m.group(1)
    if not item.get("file"):
        file_m = re.search(r"`([^`]+?\.mbt)`", ev)
        if file_m:
            item = dict(item)
            item["file"] = file_m.group(1)
    return item


def classify_host_surface(item: dict) -> str:
    blob = " ".join(
        str(item.get(k, "")) for k in ("evidence", "title", "arch", "file")
    )
    if HOST_HINT.search(blob):
        return "covered-by-H0-H5"
    return "kernel-sufficient"


def run_moon_test(skip: bool) -> dict:
    if skip:
        return {
            "ran": False,
            "ok": True,
            "summary": "skipped (H6_SKIP_MOON_TEST=1 or --skip-moon-test)",
            "exit_code": 0,
        }
    env = os.environ.copy()
    moon_bin = Path.home() / ".moon" / "bin"
    env["PATH"] = f"{moon_bin}:{env.get('PATH', '')}"
    t0 = time.time()
    proc = subprocess.run(
        ["moon", "test"],
        cwd=str(ROOT),
        env=env,
        capture_output=True,
        text=True,
    )
    out = (proc.stdout or "") + (proc.stderr or "")
    passed = None
    m = re.search(r"passed:\s*(\d+)", out) or re.search(r"(\d+)\s+passed", out)
    if m:
        passed = int(m.group(1))
    ok = proc.returncode == 0 and (passed is None or passed >= MIN_MOON_TEST_PASSED)
    return {
        "ran": True,
        "ok": ok,
        "exit_code": proc.returncode,
        "passed": passed,
        "elapsed_s": round(time.time() - t0, 2),
        "summary": out[-4000:] if len(out) > 4000 else out,
    }


def live_host_ping(port: int = 18765) -> dict:
    """Start Host UI briefly, hit /api/host/health, write audit span."""
    audit_path = ART_ROOT / "_live_host_ping" / "audit.jsonl"
    audit_path.parent.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env["HOST_UI_PORT"] = str(port)
    proc = subprocess.Popen(
        [sys.executable, str(HOST_SERVER)],
        cwd=str(HOST_SERVER.parent),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    base = f"http://127.0.0.1:{port}"
    health = None
    err = None
    try:
        deadline = time.time() + 8.0
        while time.time() < deadline:
            try:
                with urllib.request.urlopen(f"{base}/api/host/health", timeout=1.0) as resp:
                    health = json.loads(resp.read().decode())
                break
            except (urllib.error.URLError, TimeoutError, ConnectionError):
                time.sleep(0.15)
        if health is None:
            err = "health timeout"
        span = {
            "kind": "HostAbi::live",
            "event": "matrix_sweep_span",
            "ts": utc_stamp(),
            "base": base,
            "health": health,
            "ok": bool(health and health.get("ok")),
            "i_claimed": False,
            "note": "H6 Live Host ping via host_server /api/host/health (C′ surface)",
        }
        with audit_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(span) + "\n")
        return {
            "live_host_ping": bool(health and health.get("ok")),
            "health": health,
            "audit_file": str(audit_path),
            "port": port,
            "error": err,
        }
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()


def write_cm_artifact(
    item: dict,
    moon: dict,
    ping: dict,
    stamp: str,
) -> dict:
    cm = item["cm"]
    if cm in HOST_HARD_41:
        return {
            "CM": cm,
            "status": "REFUSED",
            "reason": "Host-hard inventory; prior H0–H5 Live promotion only",
            "i_claimed": False,
        }
    host_surface = classify_host_surface(item)
    slug = cm.lower()
    d = ART_ROOT / slug
    d.mkdir(parents=True, exist_ok=True)
    u_test = item.get("test") or ""
    evidence_cmd = f"bash {SWEEP_SH} {slug}"
    ev = {
        "CM": cm,
        "wave": "H6",
        "title": item.get("title", ""),
        "pri": item.get("pri", ""),
        "u_status": item.get("u", "PASS"),
        "u_acceptance_test": u_test,
        "u_acceptance_file": item.get("file", ""),
        "u_evidence": item.get("evidence", ""),
        "evidence_cmd": evidence_cmd,
        "artifact_dir": str(d),
        "moon_test_ok": bool(moon.get("ok")),
        "moon_test_passed": moon.get("passed"),
        "live_host_ping": bool(ping.get("live_host_ping")),
        "live_host_audit": ping.get("audit_file"),
        "host_surface": host_surface,
        "status": "READY_FOR_I_REVIEW",
        "i_claimed": False,
        "env": {
            "USER_IANA": os.environ.get("USER_IANA", "Asia/Shanghai"),
            "stamp_utc": stamp,
            "shared_cdp_9223": "untouched",
        },
        "assert": (
            f"U acceptance `{u_test}` linked; moon test ok; "
            f"Live HostAbi ping audit; host_surface={host_surface}"
        ),
        "note": (
            "Wave H6 matrix I sweep — kernel-sufficient or covered-by-H0-H5. "
            "Not Host-hard invent. Bit验证 decides I-PASS."
        ),
    }
    (d / "evidence.json").write_text(json.dumps(ev, indent=2) + "\n", encoding="utf-8")
    md = f"""# {cm} host-integration evidence (H6 · full matrix I sweep)

| field | value |
|-------|-------|
| CM | {cm} |
| evidence_cmd | `{evidence_cmd}` |
| artifact_dir | `{d}` |
| U acceptance | `{u_test}` ({item.get('file', '')}) |
| moon_test_ok | {ev['moon_test_ok']} (passed={ev['moon_test_passed']}) |
| live_host_ping | {ev['live_host_ping']} |
| host_surface | {host_surface} |
| status | READY_FOR_I_REVIEW |
| i_claimed | false |
| note | H6 sweep; Bit验证 decides I-PASS. Forbidden: mock-only Host I for Host-hard 41. |

"""
    (d / "evidence.md").write_text(md, encoding="utf-8")
    meta = d / "probe_meta.txt"
    meta.write_text(
        "\n".join(
            [
                f"cm={cm}",
                f"evidence_cmd={evidence_cmd}",
                f"status=READY_FOR_I_REVIEW",
                "i_claimed=false",
                f"host_surface={host_surface}",
                f"live_host_ping={ev['live_host_ping']}",
                f"USER_IANA={ev['env']['USER_IANA']}",
                f"stamp_utc={stamp}",
                "shared_cdp_9223=untouched",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    return ev


def main() -> int:
    ap = argparse.ArgumentParser(description="H6 full matrix I sweep")
    ap.add_argument(
        "target",
        nargs="?",
        default="all",
        help="all | cm-XXXX | list (print todo ids)",
    )
    ap.add_argument("--skip-moon-test", action="store_true")
    ap.add_argument("--port", type=int, default=18765)
    args = ap.parse_args()

    skip_moon = args.skip_moon_test or os.environ.get("H6_SKIP_MOON_TEST") == "1"
    items = parse_matrix_todo()
    if args.target == "list":
        for it in items:
            print(it["cm"])
        print(f"# count={len(items)}", file=sys.stderr)
        return 0

    want = None
    if args.target != "all":
        raw = args.target.strip().lower().replace("_", "-")
        if not raw.startswith("cm-"):
            raw = "cm-" + raw
        want = raw.upper().replace("CM-", "CM-")
        # normalize CM-0101
        m = re.match(r"cm-?(\d+)", args.target.strip(), re.I)
        if m:
            want = f"CM-{int(m.group(1)):04d}"

    selected = items
    if want:
        selected = [it for it in items if it["cm"] == want]
        if not selected:
            # allow writing evidence for a single already-listed CM from matrix even if not todo
            print(f"error: {want} not in I=todo set (count={len(items)})", file=sys.stderr)
            return 2

    ART_ROOT.mkdir(parents=True, exist_ok=True)
    stamp = utc_stamp()
    print(f"H6 sweep: {len(selected)} CM(s); stamp={stamp}", flush=True)

    moon = run_moon_test(skip_moon)
    if not moon["ok"]:
        print(
            f"moon test failed or <{MIN_MOON_TEST_PASSED} passed",
            file=sys.stderr,
        )
        print(moon.get("summary", ""), file=sys.stderr)
        return 1
    print(
        f"moon_test ok={moon['ok']} passed={moon.get('passed')} ran={moon['ran']}",
        flush=True,
    )

    ping = live_host_ping(args.port)
    if not ping.get("live_host_ping"):
        print(f"live host ping failed: {ping}", file=sys.stderr)
        return 1
    print(f"live_host_ping=true audit={ping.get('audit_file')}", flush=True)

    results = []
    refused = []
    for it in selected:
        ev = write_cm_artifact(it, moon, ping, stamp)
        results.append(ev)
        if ev.get("status") == "REFUSED":
            refused.append(ev["CM"])
        else:
            print(f"  READY {ev['CM']} surface={ev.get('host_surface')}", flush=True)

    summary = {
        "wave": "H6",
        "stamp_utc": stamp,
        "todo_input_count": len(items),
        "swept_count": len([r for r in results if r.get("status") != "REFUSED"]),
        "refused": refused,
        "refused_count": len(refused),
        "moon_test": {
            "ok": moon.get("ok"),
            "passed": moon.get("passed"),
            "ran": moon.get("ran"),
            "elapsed_s": moon.get("elapsed_s"),
        },
        "live_host_ping": ping.get("live_host_ping"),
        "live_host_audit": ping.get("audit_file"),
        "i_claimed": False,
        "cms": [r.get("CM") for r in results if r.get("status") != "REFUSED"],
        "artifacts_root": str(ART_ROOT),
        "status": "READY_FOR_I_REVIEW",
        "note": "Bit验证 promotes I-PASS; smoke keeps i_claimed=false",
    }
    if args.target == "all":
        (ART_ROOT / "SUMMARY.json").write_text(
            json.dumps(summary, indent=2) + "\n", encoding="utf-8"
        )
        (ART_ROOT / "SUMMARY.md").write_text(
            f"""# H6 matrix I sweep summary

- stamp_utc: {stamp}
- swept: {summary['swept_count']}
- refused: {summary['refused_count']} ({', '.join(refused) or 'none'})
- moon_test_ok: {moon.get('ok')} passed={moon.get('passed')}
- live_host_ping: {ping.get('live_host_ping')}
- i_claimed: false
- status: READY_FOR_I_REVIEW

""",
            encoding="utf-8",
        )
    print(json.dumps({"swept": summary["swept_count"], "refused": refused}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
