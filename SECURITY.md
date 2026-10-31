# Security Policy

## 支持范围

当前只有 `desktop-v0.1.0` 及 `cursor/next-target-v1` 分支在维护。
旧分支、未合并的实验改动不承诺安全修复。

## 报告漏洞

**不要**在公开 issue 里贴 API Key、`.env.local` 内容、聊天记录或用户数据。

优先使用 GitHub 的私密渠道：仓库 **Security → Report a vulnerability**
（Security Advisories）。如果该入口不可用，可以开一个不含敏感细节的 issue，
说明「需要私密渠道」，维护者会跟进。

请尽量提供：

- 受影响的提交 / 标签
- 复现步骤与预期 / 实际行为
- 是否涉及密钥泄漏、越权执行、审批绕过、跨端注入
- 你已做的脱敏处理

## 设计上的安全边界

- **凭证不落库**：模型与渠道 key 只放本机 `hosts/desktop/.env.local`（已 gitignore）
  或环境变量；仓库与安装包不含真实密钥。UI 不回显明文 key。
- **出站受审批**：shell / 渠道投递等有副作用的动作走审批卡（allow once /
  always allow / deny）；`deny` 会留回执。把某类操作设为 always allow 等于
  长期放行该类动作，请谨慎。
- **入站有鉴权**：`POST /v1/turn` 需要 `Authorization: Bearer $BITBOT_TURN_TOKEN`；
  钉钉 / 飞书 / 企微回调在未配置签名密钥时直接 401。默认只监听 `127.0.0.1`。
- **群聊隔离**：审批请求与密钥不会进入群 transcript（dm-only）。
- **本地优先**：产品数据在 `data/desktop/`；只有你配置的模型/渠道请求会出网。

## 不在承诺内

- 本仓库不提供托管服务的安全 SLA。
- 不承诺对恶意本机用户隔离：Electron 进程以你的用户权限运行，能读你的用户目录。
- 第三方模型服务与渠道（DeepSeek / 钉钉 / 飞书 / 企微等）的合规与数据处理
  由对应服务商负责。
