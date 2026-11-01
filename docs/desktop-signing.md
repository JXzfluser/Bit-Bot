# 桌面端 macOS 签名 / 公证（#69）

> 目标：让分发的 macOS 包过 Gatekeeper 并能用 `electron-updater` 自动安装——
> 这是 #70（GitHub Releases 作为 OTA feed）真正闭环的最后一公里。**未签名/未公证的
> 包：用户双击会被 Gatekeeper 拦；即便发出去，macOS 上 `electron-updater` 也会因
> delta 签名校验失败拒绝安装，OTA 等于没闭环。**

## 现状（代码已就位，只差凭据）

| 环节 | 实现 | 位置 |
|------|------|------|
| 代码签名 | electron-builder 经 `CSC_LINK`（base64 p12）+ `hardenedRuntime` + 指定 entitlements | `hosts/desktop/package.json` 的 `build.mac` |
| 公证 | `build/afterSign` → `build/notarize.js`，用 `@electron/notarize` 提交 Apple 公证（v2 会自动 stapler 钉章） | `hosts/desktop/build/notarize.js` |
| 诚实跳过 | 无 `APPLE_*` 时公证钩子跳过；`BITBOT_REQUIRE_NOTARIZE=1` 时才报错，不假装签过 | `notarize.js` |
| 凭据清单 | 本地签名样例 | `hosts/dist-signing/DESKTOP_SIGNING.env.example` |

`build.mac` 已配 `hardenedRuntime: true`、`gatekeeperAssess: false`、`entitlements`
（含 `allow-jit` / `disable-library-validation`，公证必需），无需再改。

## 需要的凭据（5 个 GitHub Secrets）

| Secret | 含义 | 来源 |
|--------|------|------|
| `MAC_CSC_LINK` | **Developer ID Application** 证书的 p12，base64 编码 | 从钥匙串导出 `.p12` 后 `base64 -i cert.p12` |
| `MAC_CSC_KEY_PASSWORD` | 上述 p12 的导出密码 | 你自己设的 |
| `APPLE_ID` | 苹果账号邮箱 | Apple ID |
| `APPLE_APP_SPECIFIC_PASSWORD` | 该账号的**专用密码**（不是登录密码） | appleid.apple.com → 安全 → 生成专用密码 |
| `APPLE_TEAM_ID` | 开发者团队 ID（10 位） | 开发者后台 |

> **证书类型务必是「Developer ID Application」**，不是开发证书、也不是 Mac App Store
> 分发证书——只有 Developer ID 签的包能被 Gatekeeper 在「非 App Store」路径放行，且能被
> `electron-updater` 校验。

## 本地签名 / 公证（一次性产出，不发 Releases）

```bash
# 1) 把凭据写进 hosts/dist-signing/DESKTOP_SIGNING.env（gitignore，绝不提交）
cat > hosts/dist-signing/DESKTOP_SIGNING.env <<'ENV'
CSC_LINK=<base64 p12>
CSC_KEY_PASSWORD=<p12 密码>
APPLE_ID=<邮箱>
APPLE_APP_SPECIFIC_PASSWORD=<专用密码>
APPLE_TEAM_ID=<团队 ID>
ENV

# 2) 本地打包（BITBOT_DESKTOP_SIGN=1 让 pack-desktop.sh 加载上述 env）
BITBOT_DESKTOP_SIGN=1 bash scripts/pack-desktop.sh
```

## CI 发布（签名 + 公证 + 发到 GitHub Releases）

> **现状（A0-1 修复后）**：发布链路已接——`hosts/desktop/package.json` 配了 github provider
> （owner `JXzfluser` / repo `Bit-Bot`），`desktop-macos.yml` 的 `package` job 有
> `contents: write` 权限，tag 门禁已修（同时接受 `v*` 与 `desktop-v*`）。但 **secrets 未配 ⇒
> dmg 不签名**，且**没有真跑过一次真实 Release**（未验证）。

1. 在仓库 **Settings → Secrets** 里配齐上面 5 个 secret。
2. 把 `hosts/desktop/package.json` 的 `version` 改成目标版本（如 `0.1.0`）。
3. 打 tag 并推送：**tag 名必须是 `v<version>` 或 `desktop-v<version>`**（如 `v0.1.0`
   或 `desktop-v0.1.0`）——electron-builder 的 github provider 据此建 Release，且
   `BITBOT_PUBLISH`、`BITBOT_REQUIRE_SIGN`、`BITBOT_REQUIRE_NOTARIZE` 在这两类 tag 上
   同时打开（A0-1 修复：门禁判定与触发前缀一致）。
   ```bash
   git tag v0.1.0 && git push origin v0.1.0
   # 或
   git tag desktop-v0.1.0 && git push origin desktop-v0.1.0
   ```
4. `desktop-macos.yml` 在 `v*` 或 `desktop-v*` tag 上：`package` job 用 `CSC_LINK` 签名 →
   `afterSign` 公证并钉章 → `electron-builder --publish always` 把 dmg/zip/`latest-mac.yml`
   推到 GitHub Releases（feed）。
5. 用户在已安装的 app 里触发「检查更新」（`bitbot:ota:check`），`electron-updater`
   从 GitHub Releases 拉 `latest-mac.yml` 与签名 delta，校验通过后安装。

## 诚实门禁（防静默发未签名包）

`scripts/pack-desktop.sh` 在内核编译**之前**检查：若 `BITBOT_REQUIRE_SIGN=1` 但
`CSC_LINK` 缺失，或 `BITBOT_REQUIRE_NOTARIZE=1` 但缺 `APPLE_*`，**直接 fail**，绝不
产出未签名/未公证包。CI 只在 `v*` 与 `desktop-v*` tag 上置这两个开关（A0-1 修复：门禁
判定与触发前缀一致）——所以正式发布缺凭据会当场红，而测试构建（`workflow_dispatch` /
非发布 tag）保持宽松（诚实跳过）。

## 范围外（本期不做）

- **Windows Authenticode**：`CSC_LINK_WIN` / `CSC_KEY_PASSWORD_WIN` 已预留，但 Windows
  签名流程未接入（#72 跨端定调时一并考虑）。
- **Linux**：AppImage/dir 默认不签名（Linux 无强制签名），`BITBOT_DESKTOP_SIGN=0`。
- **App Store 上架**：走 `hosts/ios` / Android 那套，不在桌面分发范围。
