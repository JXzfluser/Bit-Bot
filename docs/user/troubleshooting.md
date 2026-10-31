# Bit Bot 桌面版 · 故障排查

> 原则：先看**具体错误文本**，再动手。应用对缺 key、网络失败、审批拒绝都给的是具体原因，
> 不是笼统的「出错了」。不要把 `.env.local` 或 key 贴进 issue。

## 启动就失败

### `error: moon not found`

MoonBit 没装或不在 PATH：

```bash
export PATH="$HOME/.moon/bin:$PATH"
moon version --all
```

Windows 用官方安装器后同样确认 `moon` 在 PATH 里。

### `error: npm not found`

装 Node.js 22+（含 npm）后重开终端确认 `node -v` / `npm -v`。

### Electron 窗口不出现（Linux）

没有图形显示时，Electron 起不来。两条路：

```bash
# 有桌面：确认 DISPLAY 有值
echo $DISPLAY

# 无桌面（服务器 / CI）：套 xvfb
xvfb-run -a bash scripts/start-desktop.sh
```

如果提示 sandbox 相关错误，可临时加 `--no-sandbox`（仅本地调试，不要写进产品默认）。

### 第一次启动卡在 `npm install`

Electron 二进制下载慢或失败。重试即可；公司网络需要代理时先配置 npm 代理再启动。
检查 `hosts/desktop/node_modules/electron/dist/electron` 是否存在。

## 能开窗，但聊天不可用

### 提示「尚未配置大脑 key」/ 发送后立刻失败

设置 → 凭证里填 `BITBOT_LLM_API_KEY`，再点「试连大脑」。或启动前：

```bash
export BITBOT_LLM_API_KEY=sk-...
```

### 「试连大脑」失败

按错误分三种：

| 现象 | 常见原因 | 处理 |
|------|----------|------|
| 401 / invalid api key | key 错、过期、复制带了空格 | 重新粘贴，确认无空格/换行 |
| 404 / model not found | `BITBOT_LLM_MODEL` 与服务商不匹配 | 改回 `deepseek-chat` 或服务商文档里的模型名 |
| timeout / connect error | 网络或 `BITBOT_LLM_BASE_URL` 写错 | 确认能访问 base URL；国内网络确认代理 |

错误文本会显示在凭证页；以它为准，不要只看「失败」两个字。

### 回复到一半停住

流式（SSE）被网络中断时会保留已收到的部分。`BITBOT_LLM_STREAM=0` 可关闭流式，
改用整段返回后再渲染（排查网络问题时有用）。

## 窗口 / 布局

### 窗口拖到很窄后布局变了

产品最小宽度是 480px。≤900px 时布局切成单列，右侧面板（详情 / 预览）变成
覆盖抽屉，点抽屉里的「关闭」收起。这是设计行为，不是错位。

### 关窗后进程还在

默认隐藏到托盘。托盘菜单 → 退出。若托盘图标不可见，检查系统托盘区是否折叠。

### 想让多个实例同时跑

默认单实例：第二个实例会把已有窗口叫到前台然后退出。调试需要多开时，
用不同的 `--user-data-dir`（门禁脚本就是这么做的）。

## 数据相关

### `data/desktop/*.json` 报解析错误

先**整目录备份**，再检查哪个文件不是合法 JSON：

```bash
for f in data/desktop/*.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" || echo "BAD $f"; done
```

不要直接删文件来「恢复」——历史行是用户数据。可以把坏文件移出目录后启动
（应用会生成新文件），再把能救回的内容从备份里合进去。

### 想迁移到另一台机器

退出应用 → 复制整个 `data/desktop/` 到新机器同一路径 → 在新机器配置 `.env.local`。

## 语言 / 文案

界面默认跟随系统；中文系统显示简体。切换：设置 → 常规 → 语言。
如果某处出现未翻译英文，属于文案迁移残留，记录位置即可（门禁只允许白名单内的英文）。

## 开发者：门禁失败怎么复现

```bash
# 内核
export PATH="$HOME/.moon/bin:$PATH"
moon check && moon test --target native

# 布局渲染门（含窄视口 480/700/900）
xvfb-run -a node scripts/e2e_desktop_layout_target.mjs

# 全量桌面矩阵
xvfb-run -a bash scripts/smoke_grok_desktop_parity.sh
```

结果的 `PASS=/FAIL=/SKIP=` 以脚本最后一行输出为准。**SKIP 不是 PASS**：
没有 Electron / 没有 DISPLAY 时门禁会如实跳过并打印原因。
