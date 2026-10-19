# Desktop release / 备案 / OTA（P4 · Desktop-first）

iOS/Android 本阶段暂缓（用户确认可先不考虑）。本文件只覆盖 Desktop（Windows + macOS Electron；Linux 作 CI 打包证明）。

## 本阶段验收（Desktop only）

| 项 | 判定 | 阻塞 |
|----|------|------|
| 真窗口 | Electron 可见窗 + Grok 式会话 UI | 无（Xvfb/本机可证） |
| 真模型 | `llm_chat` → DeepSeek；缺/错 key 诚实失败 | `BITBOT_LLM_API_KEY` |
| 真渠道 | 钉钉/飞书/企微 `BITBOT_*_POST=1` + 凭证 → live | 渠道 webhook/token |
| 签名/公证 | electron-builder + notarize.js | Apple / Win 证书 |
| 移动端 | **暂缓** | — |

## 签名与公证

| 平台 | 工具 | 环境变量 | 诚实失败 |
|------|------|----------|----------|
| macOS | electron-builder + `build/notarize.js` | `APPLE_ID` · `APPLE_APP_SPECIFIC_PASSWORD` · `APPLE_TEAM_ID` · `CSC_LINK` / `CSC_KEY_PASSWORD` | 缺凭证则跳过公证；`BITBOT_REQUIRE_NOTARIZE=1` 时硬失败 |
| Windows | electron-builder (nsis) | `CSC_LINK` / `CSC_KEY_PASSWORD`（或 Windows 证书） | 默认 `signAndEditExecutable` 可关；无证书不假装已签 |

```bash
cd hosts/desktop
npm run dist          # 按当前 OS 打安装包
# macOS 公证强制：
BITBOT_REQUIRE_NOTARIZE=1 APPLE_ID=… APPLE_APP_SPECIFIC_PASSWORD=… APPLE_TEAM_ID=… npm run dist
```

## 自动更新（OTA）

- Host `check_updates` 在设置 `BITBOT_UPDATE_FEED_URL`（目录下提供 `latest.yml`）时**真 HTTP 探测**
- 未配置 feed → 打开 Updates 面板，**不假装已有新版本**（`pretend_update_available=false`）
- Desktop 运行时也可通过 `check updates` 产品话术触发
- 通路证明：见 `scripts/dev_stubs/README.md`（本地 feed ≠ 已上架 OTA）

## AI 备案与内容审核

| 项 | 说明 |
|----|------|
| 备案号展示 | `BITBOT_ICP_FILING` / `BITBOT_ALGORITHM_FILING` 写入 Host 交付与 About |
| 内容审核 | `BITBOT_CONTENT_MODERATION=1` 时 Host `llm_chat` 对输出跑本地违禁词门；拒绝时 `ok=false`、不假装通过 |
| 不冒充 | 未配置审核/备案 env 时，状态里写明 residual，不伪造「已备案/已过审」 |

## 国内安卓渠道包（同仓 · 真机暂缓）

`hosts/android/BitBotHost/app/build.gradle.kts` productFlavors：`universal` / `huawei` / `xiaomi` / `honor` / `oppo` / `vivo`。  
签名：`BITBOT_ANDROID_STORE_*`；`bash scripts/pack-mobile.sh` 暂存 unsigned 树。

## 打包产物

- `hosts/desktop/dist/`（gitignore）
- mac：`dmg` + `zip`（公证后）
- win：`nsis`
- linux：`AppImage` / `dir`（本 CI 环境默认）

## 通路 stub vs 产品验收

本地 stub（`scripts/dev_stubs/`）可证明 Host 管道与 live 门控；**产品验收仍要**：

1. 真实 DeepSeek（或配置的国产）`BITBOT_LLM_API_KEY`
2. 真实钉钉/飞书/企微 webhook 或 token
3. Apple / Windows / 安卓签名证书
