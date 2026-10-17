# box_host — HostAbi (Mock | Live)

Kernel ↔ Host boundary (`docs/interfaces.md` §9, `docs/host-integration-interface-gaps.md` §1–2).

## Backends (G-ABI-1)

| Backend | Factory | Use |
|---------|---------|-----|
| **Mock** | `HostAbi::mock()` | **U / kernel-contract only** |
| **Live** | `HostAbi::live(cfg)` / `HostAbi::with_backend(Live(...))` | I skeleton — real FFI path |

- Live and Mock **coexist**.
- Live construction / failure **must not** silently fall back to Mock.
- Placeholder PNG / Mock screenshot **must not** be used to claim host-integration I-PASS.

`LiveHostConfig`: `display?` (e.g. `":1"`), `workspace_root`, `mcp_transport?` (stub), `ui_automation`.

## Screenshot evidence (CM-0605 / G-SCR)

| Path | `frame_origin` | `display_id` |
|------|----------------|--------------|
| Mock `screenshot()` | `Placeholder` | `None` |
| Live `screenshot_live()` success | `LiveDisplay` | e.g. `Some(":1")` |
| Live capture unavailable | **Err** (no Placeholder-as-Live) | — |

Optional Live fields: `bytes_sha256?`, `captured_at?`. U paths keep Placeholder / None.

## Audit spans (G-ABI-2)

Live side-effects append `AuditSpan` (`tool_name`, `duration_ms`, `artifact_path?`) via `record_audit` — queryable for Bit验证.

## H0 probes

- Kernel skeleton: `HostAbi::run_h0_probe` / `run_h0_wave` — **never** sets `i_claimed=true`.
- Host smoke (real OS): `bash /workspace/bitbot/scripts/host_h0_smoke.sh`
- Artifacts: `/workspace/bitbot/docs/qa/artifacts/`

**Status (2026-10-17 Asia/Shanghai):** Live skeleton landed; **I not claimed**.

## H1 probes (真屏 / Desktop `:1`)

- Kernel skeleton: `HostAbi::run_h1_probe` / `run_h1_wave` — **never** sets `i_claimed=true`.
- Host smoke (real OS): `bash /workspace/bitbot/scripts/host_h1_smoke.sh` (`cm-0605|cm-0802|cm-2160|cm-0806|all`)
- Artifacts:
  - `docs/qa/artifacts/cm-0605-screenshot/` — real `:1` x11grab PNG (`frame_origin=LiveDisplay`, read_only, clicked=false)
  - `docs/qa/artifacts/cm-0802-box-chrome/` — box-chrome process + `/tmp/box-chrome.lock` real pid
  - `docs/qa/artifacts/cm-2160-navigate/` — public URL navigate + post-navigate frame
  - `docs/qa/artifacts/cm-0806-session-jar/` — cookie jar before/after lifecycle probe

**Status (2026-10-17 Asia/Shanghai):** H1 smoke + Live probe skeleton landed; **I not claimed** (Bit验证 promotes, CM-0605 first).

### H1 security follow-up (2026-10-17 14:28 Asia/Shanghai)

- **Shared Chrome red line:** the smoke never drives, CDP-attaches, restarts, or kills the shared logged-in Chrome (`:1`, CDP 9223, `/home/box/chrome-profile`, `~/.config/google-chrome`).
- CM-0802 / CM-2160 use a throwaway browser: launched via `box-chrome` with `CHROME_USER_DATA_DIR=$(mktemp -d)`, its own CDP port (9333+), a private Xvfb display, and `SAND_COOKIE_SEED_PATH=/nonexistent` so the saved login cookie seed is not pushed in. Cleanup kills only pids whose argv contains that temp dir, then deletes the dir (`cleanup_proof.txt`).
- CM-2160 navigates with CDP `PUT /json/new?<url>` and falls back to `Page.navigate`. A URL-argv launch is used only as a last resort, is labelled as a fallback, and forces NEEDS_REVIEW.
- CM-0802 negative path: `h1_launch_guard` (script) / `box_chrome_launch_guard` + `HostAbi::guard_browser_launch` (MoonBit) refuse bare chrome, and the result goes to `bare_refusal.txt`.
- CM-0806 only hashes in place: sha256, byte size, and read-only row count. The Cookie DB is never copied. A profile-DB sweep runs after every smoke.


## H2 probes (Host UI · Bit Bot surface · C′)

- Kernel skeleton: `HostAbi::run_h2_probe` / `run_h2_wave` — **never** sets `i_claimed=true`.
- `HostUiEvent` + Live `HostUiShell` (G-UI-1): `SettingsOpened` / `SettingsAnchorVisible` / `DeleteAgentPhaseChanged` — payloads from `@ui_protocol`.
- Host UI surface: `scripts/host_ui_surface/` (Bit Bot own Settings/sidebar; **not** Grok client).
- Host smoke: `bash /workspace/bitbot/scripts/host_h2_smoke.sh` (`cm-1901|cm-1902|cm-1907|all`)
- Artifacts:
  - `docs/qa/artifacts/cm-1901-settings-entry/`
  - `docs/qa/artifacts/cm-1902-settings-anchor/`
  - `docs/qa/artifacts/cm-1907-delete-agent/`
- Isolation: throwaway box-chrome + private Xvfb + mktemp profile + CDP 9333+; **never** 9223 / `/home/box/chrome-profile`.
- CM-1907: Delete → **Cancel only** on throwaway agent.

**Status (2026-10-17 Asia/Shanghai):** H2 batch-1 infrastructure READY (C′); **I not claimed** (Bit验证 promotes).

### §3.0 C′ vs B 自检

| 维度 | C′ | 本实现 |
|------|----|--------|
| UI 驱动 | Live HostUiShell 方法 | `host_ui_shell_live.py` → `/api/host/*` |
| smoke 入口 | HostAbi / run_h2_probe | H2Intent 对齐；`host_h2_smoke.sh` |
| 审计 | audit span | `audit_spans.jsonl` + MoonBit `AuditSpan` |
| 事件回注 | HostUiEvent | `/api/host/events` + `HostAbi.ui_events` |
| 产物 | 正规目录 LiveDisplay | `cm-1901/1902/1907-*`（禁 fixture-only） |

B 拒：CDP page-JS 直调、fixture-only、仅内存事件、合成 PNG。

## H3 probes (Host FFI · Shell/FS/device/webhook)

- Kernel skeleton: `HostAbi::run_h3_probe` / `run_h3_wave` — **never** sets `i_claimed=true`.
- Types: `H3Intent` / `H3FfiEvidence` (`docs/host-integration-interface-gaps.md` §5).
- Host smoke: `bash /workspace/bitbot/scripts/host_h3_smoke.sh` (`cm-2158|cm-2174|cm-0705|cm-0411|all`)
- Artifacts:
  - `cm-2158-package-install/` — Live Shell npm sandbox + non-Shell refusal
  - `cm-2174-shared-box-fs/` — dual-session shared FS + distinct displays
  - `cm-0705-device-local-tools/` — `platform_subset.md` (`desktop_no_device_local_tools`)
  - `cm-0411-webhook-panel/` — Host panel copy + opaque key + wake

**Status (2026-10-17 Asia/Shanghai):** H3 smoke + Live probe skeleton landed; **I not claimed** (Bit验证 promotes). CM-0806 GAP untouched.
