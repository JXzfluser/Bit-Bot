# 07 — 仓库目录与命名约定

> Reference。对齐根目录 `AGENTS.md`。

## MoonBit 包

- 每目录一个包，含 `moon.pkg`（依赖列表）。  
- 模块元数据：根 `moon.mod`（`name = "bitbot/bitbot"`）。  
- 源文件：`*.mbt`；逻辑块用 `///|` 分隔。  
- 弃用代码：各包 `deprecated.mbt`。  
- 接口快照：`moon info` 生成/更新 `.mbti`（或 `pkg.generated.mbti`）。

## 测试后缀

| 后缀 | 含义 |
|------|------|
| `*_test.mbt` | 黑盒测试 |
| `*_wbtest.mbt` | 白盒测试 |
| 快照 | `moon test --update` 更新；稳定值优先 `assert_eq` |

## 文档编号

| 模式 | 用途 |
|------|------|
| `NN-name.md` | 架构系列 00–07 |
| `architecture.md` / `modules.md` / `interfaces.md` | 团队入口（与编号双轨） |
| `CHARTER.md` / `ROADMAP.md` | 负责人合同 |
| `capability-matrix.md` | 能力对标 |
| `adr/NNNN-title.md` | 架构决策，四位编号 |
| `qa/` | Bit验证专用；架构角色不写入结论 |

## 包路径命名

- 目录名：`snake` 小写；MoonBit 包名随目录。  
- 定稿：根级扁平包（见 `modules.md`）。禁止平行 `packages/` 树与顶层空 `cloud/`。  
- Host 适配：MoonBit 侧用顶层 `box_host`；若日后有非 MoonBit Host 代码可另树，**不要**塞进 `core`。

## 工具命令（落地时）

```bash
moon fmt
moon info
moon check
moon test
moon run cmd/main
```

变更公开 API 后检查 `.mbti` diff。

## 文件所有权

| 路径 | 所有者角色 |
|------|------------|
| `docs/0*.md`, `docs/architecture.md`, `modules.md`, `interfaces.md`, `adr/` | Bit架构 |
| `docs/capability-matrix.md` | 能力对标 |
| `docs/qa/` | Bit验证 |
| `docs/CHARTER.md`, `ROADMAP.md` | Bitbot 负责人 |
| 根级各能力包 `**/*.mbt` | MoonBit核 |
