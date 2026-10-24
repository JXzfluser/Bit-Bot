# Bit Bot Non-goals（明确不做 / 暂不做 / 策略边界）

> 最后更新：2026-10-17 11:21 Asia/Shanghai  
> 与 `capability-matrix.md`、`capability-inventory-raw.md`、`capability-id-crosswalk.md` 交叉引用。  
> **实现侧跟 `CM-*`，不以废弃的 `CAP-001` 为准。**（2026-10-17 11:24 Asia/Shanghai）  
> **本文件不是简化许可**：矩阵 P0/P1 不得以「Demo 够了」砍掉；若要从合同移除，必须先在此立项并经 Bitbot 记录。

---

## 1. 禁止用「简易 Demo」砍掉的能力（非目标的反面）

下列任一项被 stub 冒充「完成」= 缺陷（对照矩阵 CM / 历史 CAP）：

1. 完整投递面：text / widget（含高级选项）/ attachment / voice_memo / reaction / thread / end_turn  
2. Untrusted fence + Auto-review + smart_mode + 不可逆闸门  
3. Memory 四类型 + Recall/Update（含冲突优先级）  
4. Routines：cron/@hourly + flexible 窗口 + 多事件 trigger + lifecycle + 静默规则  
5. Skills：managed / user / plugin 目录与「先 Read 再执行」门控  
6. Box Host ABI：Shell / Read / Screenshot / AwaitShell；禁 Shell 驱动 GUI  
7. computerUse 单实例、1280×800、登录/2FA 停报  
8. MCP：GetDynamicTools / CallDynamicTool / 鉴权 needsAuth|needsGrant / Install|Uninstall Plugin  
9. 邮件：用户连接器 + Bot inbox（List/Check/Claim/Search/Read）+ DraftExternalMessage 默认  
10. 渠道 inbound/outbound；`[inbound]` 不自动回第三人  
11. 子代理 Task 全家桶 + Check/Message/Stop + TodoWrite + 完成后唤醒（禁空转轮询）  
12. CloudAgent / artifacts / Origin / GitHub 面  
13. 队友 CreateAgent / SendToAgent priority  
14. 凭证与 secret-request（密钥永不进模型上下文）  
15. 垂直 skills 一等门控（至少注册与「用前必读」，不假装不存在）  
16. 策略引擎红线对等行为（见 §3）

---

## 2. 明确非目标（真的不做）

| ID | 非目标 | 理由 | 矩阵交叉 |
|----|--------|------|----------|
| `NG-001` | **已撤销（2026-10-24）**：原"复刻 Grok Bot 闭源宿主 UI 像素级皮肤 = 非目标"已撤销。现产品方向为 **UI 皮肤对标 Grok Bot 应用**（布局密度 / 配色 / 圆角 / 组件形态向 Grok 官方规格对齐，含主聊天界面与所有面板），转为**明确要做**。视觉真源见 `grok-desktop-parity/README.md` G-28 与 `design/desktop-target/ui-unified-spec.md`。深链与引导语义对等仍保留。 | — | — |
| `NG-002` | 在 WASM/MoonBit 内核内直接做真实 OS/网络/GUI | 必须经 Host ABI | `CM-0601` 等；见 architecture Host 边界 |
| `NG-003` | 把用户私有业务流水线（如某公众号团队 workflows）做成 Bit 产品必交能力 | 用户技能运行时可用 ≠ 产品合同 | `CM-2118`；raw 用户 workflows 列表 |
| `NG-004` | 对标 pstack 等第三方插件技能全家桶为「原生必交」 | 插件生态可安装，非 Grok 原生内核 | raw 待证实/非目标；矩阵不强制 CM 行 |
| `NG-005` | 绕过安全红线「为了对等而实现攻击能力」 | 对等的是**拒绝与闸门行为**，不是攻击本身 | `CM-2112`…`2116` / `CM-15xx` |
| `NG-006` | 把第三方站点账号破解、验证码农场、凭据盗取当能力 | 违法且违反 sign-in/credential 规范 | 无矩阵行；请求→策略拒 |
| `NG-007` | 擅自改用户本机 git checkout（无 skill/用户明示例外） | 源码纪律 | `CM` code-changes / source-control；`CAP-P-005` 历史 |
| `NG-008` | 发明 app-ui 不存在的菜单/齿轮路径 | 误导用户 | `CM-1901`；仅 `app-ui.md` |
| `NG-009` | 用 GenerateImage 伪造真人/冒充未请求的「真实照片」 | 媒体与信任策略 | `CM-16xx` |
| `NG-010` | inbound / 例程默认自动给站外第三人发私信 | 外发须草稿或显式授权 | `CM-11xx` / 外发策略 |

---

## 3. 策略边界（对等实现「拒绝」，不对等实现「危害」）

Bit 须实现与 Grok 同级的**产品策略引擎行为**：

| 边界 | Bit 应对等的行为 | 非目标 |
|------|------------------|--------|
| offensive_cyber | 短拒；无 exploit/PoC/步骤 | 不提供「教学用」攻击细节绕过 |
| child_sex / CSAM | 立即拒并停止 | 不提供任何资源 |
| chem/nuclear/dual_use_bio | 拒武器化与增强滥用 | 不提供可操作合成路线 |
| 犯罪协助（含角色扮演包装） | 短拒 | 不因「小说」绕过 |
| copyright 大段 verbatim | 摘要替代 | 不整章复制 |
| 未授权访问 / 凭证窃取 | 拒 | 不读 token 文件自造登录 |

---

## 4. 宿主依赖 / 延后（标「宿主依赖」而非假装 MoonBit 已实现）

| 项 | 说明 | 矩阵 |
|----|------|------|
| Settings 像素与原生控件 | 深链与文案指引在协议层；控件在 Host | `CM-19xx` |
| 本机/手机 OS 权限弹窗 | deviceLocalTools 权限态由 Host 呈现 | `CM-07xx` / deviceLocalTools |
| TTS/STT 编解码 | voice 行为门控在 skill；编解码在 Host | `CM-20xx` voice |
| Update/Reset Bot's Computer | 助手只引导；执行在 Host | `CM-1903/1904` |
| 应用自动更新通道 | 异于 box Update | `CM-1906` |
| 部分 MCP 商业连接器（Finance 等） | 鉴权协议要对等；具体 API 面随连接器演进 | `CM-2109` 待证实 |

**规则**：宿主依赖项在矩阵备注写「宿主依赖」；验收测协议/引导/状态机，不测像素截图一致。

---

## 5. 允许分阶段（仍须留矩阵行）

| 项 | 可后填部分 | 不可缺的前期 |
|----|------------|--------------|
| 单个 site-playbook 深脚本 | 单站逐步补 | 框架 + 目录加载器 + 清单（`CM-2111`） |
| GenerateVideo | 实现可 P2 | 类型/工具名预留 |
| Teams/Linear/Sentry/PD 等 trigger | 可按连接器到位启用 | 类型枚举与路由框架 |
| slides-executor | P2 | 与 slides 分工在目录可见 |

---

## 6. 与矩阵 / raw 的维护约定

1. 发现「看起来该砍」→ 先开本文件 NG 行 → Bitbot 记录 → 再改矩阵状态/备注「非目标」。  
2. raw 中的用户私有 workflows、pstack 技能保留为「观察项」，不升格必交。  
3. 禁止静默删除矩阵行；合并 ID 须在 raw「疑似重复」说明。

---

## 7. 架构师待拍板（最多 5，转入 interfaces/ADR）

1. 深链 scheme：兼容 `grokbot://` 还是 `bitbot://`？  
2. `meetings` 是否独立 skill，或并入 `scheduling`？  
3. 策略引擎：硬编码规则表 vs 可配置 policy pack？  
4. Bot inbox 域名与 Claim 是否产品自有（对标 mail.grokbot.com）？  
5. widget 高级选项与 Host 卡片协议字段稳定性？
