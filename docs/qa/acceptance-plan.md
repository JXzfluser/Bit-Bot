# Bit Bot 验收计划（Acceptance Plan）

- **状态**: 基线草案（baseline）
- **仓库**: `/workspace/bitbot`
- **记录时间**: 2026-10-17 11:16 Asia/Shanghai (CST)
- **能力矩阵路径（约定）**: `/workspace/bitbot/docs/capability-matrix.md`
- **矩阵现状**: **ABSENT**（目录与文件均不存在；本计划含「未来矩阵行如何验收」的 stub 框架）
- **缺口登记（约定）**: `/workspace/bitbot/docs/qa/gaps.md` — **暂不创建**（见下方 Blocker）

---

## 1. 范围（Scope）

### In scope

| 项 | 说明 |
|----|------|
| 工具链可复现 | `moon` / `moonc` / `moonrun` 版本已知；`moon check` / `build` / `test` / `run` 可执行 |
| 包布局 | 根包 `bitbot/bitbot` + 可执行包 `cmd/main`（`moon.mod` / `moon.pkg`） |
| 冒烟验收 | 见 `docs/qa/smoke.md` |
| 未来能力矩阵行 | 每一行必须绑定至少一种可证伪检查（见 §3） |

### Out of scope（当前基线）

- 产品行为/业务能力验收（矩阵与实现均未到位）
- 与外部 Bot / 参考实现的 behavior compare（无对照物、无脚本）
- 覆盖率门槛（当前 0 条测试；`moon coverage analyze` 无数据可分析）
- 正式 CI 门禁（仅有 `.github/workflows/copilot-setup-steps.yml` 装工具链，无 test job）

### Blocker（为何不写 `gaps.md`）

`gaps.md` 需要 **矩阵声明 ∩ 实现证据** 的差分。当前：

1. `/workspace/bitbot/docs/capability-matrix.md` **不存在**
2. 库包 `bitbot.mbt` / `bitbot_test.mbt` / `bitbot_wbtest.mbt` 均为注释占位；`pkg.generated.mbti` 无任何公开 Values/Types
3. 唯一可运行行为：`moon run cmd/main` → 打印 `Hello`

因此 **无可比较的「声称能力 vs 证明」对**；写入 `gaps.md` 只会变成猜测清单。矩阵落地且至少有一行可映射到代码后，再生成 `docs/qa/gaps.md`。

---

## 2. 裁决词表（Verdict vocabulary）

| 裁决 | 含义 | 何时使用 |
|------|------|----------|
| **PASS** | 该项的可证伪检查全部执行且符合期望信号 | 有命令、有期望、有实际输出匹配 |
| **FAIL** | 检查已执行，结果与期望不符（编译失败、断言失败、行为不一致） | 有证据；记入 gaps 的「失败」类 |
| **BLOCKED** | 无法执行检查（工具链缺失、依赖未装、前置矩阵/环境未就绪） | 记录阻塞原因与解除条件 |
| **GAP** | 矩阵（或本计划 stub）要求有检查，但仓库中尚无对应模块/测试/脚本 | 记入 `docs/qa/gaps.md`；区分「缺实现」与「缺证明」 |

禁止使用「差不多 / 看起来行 / 应该能过」。无证据 → **BLOCKED** 或 **GAP**，不是 PASS。

---

## 3. 可证伪检查类型（每种 native 能力必须选 ≥1）

| 类型 ID | 名称 | 本仓库典型命令 / 形态 | 期望信号（示例） |
|---------|------|----------------------|------------------|
| **C** | compile | `moon check`；`moon build`；`moon build --target native\|js\|wasm` | exit 0；无 error 诊断 |
| **U** | unit test | `moon test`（黑盒 `*_test.mbt` / 白盒 `*_wbtest.mbt`） | `failed: 0`；且该项有 ≥1 条命名测试 |
| **I** | integration script | 仓库内脚本（如 `scripts/*.sh`）调用 `moon run` / 多包联调 | 脚本 exit 0 + 约定 stdout/文件产物 |
| **B** | behavior compare | 对照金样/参考实现的输出 diff（快照或 golden file） | diff 空；或 `moon test --update` 后已评审的快照一致 |

规则：

- 矩阵每一行必须标注 `checks: [C|U|I|B, ...]` 与 **证据路径**（测试文件、脚本、金样）。
- 仅有 `moon check` 通过 **不能** 把业务能力标 PASS；compile 只证明「能编过」，不证明行为。
- `Total tests: 0` 对任何声称行为的行 → 最多 **GAP**（缺 U），不能 PASS。

---

## 4. 证据要求（Evidence required）

每条验收记录至少包含：

1. **矩阵行 ID**（矩阵缺失时用本计划 stub ID，如 `STUB-TOOLCHAIN-01`）
2. **检查类型**（C/U/I/B）
3. **精确命令**（可复制；工作目录默认 `/workspace/bitbot`）
4. **exit code**
5. **关键 stdout/stderr 摘录**（或产物路径）
6. **裁决** + **时间**（Asia/Shanghai）
7. **责任**（见 §5）

冒烟命令与已验证信号：见同目录 `smoke.md`。

---

## 5. 责任（Fix vs Verify）

| 角色 | 职责 |
|------|------|
| **工程 / 实现（Fix owner）** | 补模块、改 API、写/修测试与集成脚本，直到检查可跑且期望明确 |
| **Bit验证 / QA（Verify owner）** | 按本计划执行检查、记录证据、出 PASS/FAIL/BLOCKED/GAP；**不**改产品代码（除非明示授权） |
| **能力对标** | 维护 `capability-matrix.md` 行与验收标准列 |
| **Bitbot 项目负责人** | 裁定范围变更；批准 gaps 关闭；收缺口排期 |

缺口关闭条件：对应矩阵行的全部约定检查为 PASS，且证据链完整；由 Verify owner 在 gaps 条目上标记关闭并引用命令记录。

---

## 6. 能力矩阵 Stub（矩阵文件缺失时的验收映射）

> 正式矩阵应落在 `/workspace/bitbot/docs/capability-matrix.md`。下列 stub 描述 **未来每一行如何被验证**，便于矩阵作者直接填行而不改变验收语义。

### 6.1 建议矩阵列

`id | capability | package/path | checks (C/U/I/B) | evidence | owner_fix | owner_verify | notes`

### 6.2 Stub 行（基线期）

| ID | 能力（未来矩阵行主题） | 验证方式 | 当前裁决（2026-10-17） |
|----|------------------------|----------|------------------------|
| STUB-TOOLCHAIN-01 | MoonBit 工具链可用 | C：`moon version` / `moon version --all` | **PASS**（见 smoke.md） |
| STUB-COMPILE-01 | 根包 + cmd/main 可 check/build | C：`moon check`；`moon build`；多 target | **PASS** |
| STUB-RUN-01 | 可执行入口可运行 | I/C：`moon run cmd/main` | **PASS**（输出 `Hello`；非产品能力） |
| STUB-UNIT-01 | 库包有可执行单元测试 | U：`moon test` 且 tests ≥ 1 | **GAP**（0 tests；stub 文件无 `test` 块） |
| STUB-API-01 | 库包公开 API 非空 | C+U：`moon info` 后 `.mbti` 含 Values/Types + 对应测试 | **GAP**（`pkg.generated.mbti` 空 API） |
| STUB-MATRIX-01 | 能力矩阵文档存在 | 文档存在性检查 | **GAP** / **BLOCKED**（文件缺失；阻塞 gaps.md） |
| STUB-ARCHDOC-01 | 架构/能力说明文档 | `docs/` 下架构文档存在且与矩阵交叉引用 | **GAP** |
| STUB-CI-01 | CI 执行 check+test | workflow 含 `moon check` && `moon test` | **GAP**（仅 Copilot setup） |
| STUB-COV-01 | 覆盖率可收集 | U：`moon test --enable-coverage` + `moon coverage analyze` | **BLOCKED**/失败信号（无 coverage 数据；因无测试） |
| STUB-BEHAVIOR-* | 各业务能力（聊天/工具/…） | 每行自带 U 和/或 I 和/或 B | **GAP**（无矩阵行、无实现） |

产品能力行（`STUB-BEHAVIOR-*`）在矩阵起草时必须拆成具体 ID；每一行禁止只依赖 C。

### 6.3 未来矩阵行 → 检查绑定模板

```text
### <MATRIX-ID>: <一句话能力>
- checks: [U, I]          # 至少一项；原生能力建议 U+I 或 U+B
- package: bitbot/bitbot/<path>
- unit: <file>_test.mbt::<test_name>
- integration: scripts/<name>.sh   # 若无则标 GAP
- behavior: testdata/<golden>      # 若声称对外行为则必填
- pass_when:
  - moon test <path> → failed: 0 且包含 <test_name>
  - scripts/<name>.sh → exit 0 且 stdout 匹配 <pattern>
```


---

## 6.4 与 CHARTER Runtime shape 的切片挂载

矩阵行落地后须挂到下列切片（细节与门禁见历史草稿对齐 CHARTER）：`Q-KERN` / `Q-DELIV` / `Q-PERS` / `Q-HOST` / `Q-CONN` / `Q-AGENT` / `Q-VERT` / `Q-SMOKE`。  
脚手架冒烟绿 **只** 覆盖 `Q-SMOKE`；其余在矩阵缺失期一律不得标业务 PASS。

---

## 7. 验收流程（每次发布 / PR）

1. 更新或核对 `docs/capability-matrix.md`
2. 跑 `docs/qa/smoke.md` 全套；任一项 FAIL → 不得标发布 PASS
3. 对矩阵每一行执行绑定检查；汇总裁决表
4. 将 FAIL/GAP/BLOCKED 写入 `docs/qa/gaps.md`（矩阵存在之后）
5. Fix owner 关闭缺口 → Verify owner 复跑 → 更新 gaps

---

## 8. 与当前树的对照事实（证据摘要）

| 路径 | 事实 |
|------|------|
| `docs/capability-matrix.md` | 不存在 |
| `docs/CHARTER.md` / `docs/ROADMAP.md` | 已存在（任务合同与里程碑） |
| `docs/architecture.md` | 不存在 |
| `docs/qa/` | `acceptance-plan.md` + `smoke.md`（本基线） |
| `moon.mod` | `name = "bitbot/bitbot"`, `version = "0.1.0"`, `preferred_target = "wasm"` |
| `moon.pkg` | 空文件 |
| `bitbot.mbt` 等 | 仅注释；无 API |
| `cmd/main/main.mbt` | `println("Hello")` |
| `*_test.mbt` / `*_wbtest.mbt` | 仅注释；**0** 条 `test` |
| Git | `master` 尚无 commit；内容均为未跟踪 |

详细命令与输出：`smoke.md`。
