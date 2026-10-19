# Dev stubs（通路证明，不是产品验收）

本目录用于在无 DeepSeek / 钉钉云凭证时，证明 Host 真 HTTP 通路。

| Stub | 证明什么 | **不**证明什么 |
|------|----------|----------------|
| `openai_compat_stub.js` | MoonBit → Host `llm_chat` 能完成一轮回复；内容审核门可拦截 | 国产 DeepSeek 真模型 |
| `cn_webhook_stub.js` | `BITBOT_DINGTALK_POST=1` + webhook → `live_dingtalk` | 钉钉/飞书/企微云端真渠道 |
| 本地 `BITBOT_UPDATE_FEED_URL` | `check_updates` 真探测 `latest.yml` | 已上架 OTA / 已公证安装包 |

```bash
# LLM pipe
node scripts/dev_stubs/openai_compat_stub.js &
BITBOT_LLM_API_KEY=stub BITBOT_LLM_BASE_URL=http://127.0.0.1:8787/v1 \
  BITBOT_DESKTOP_SMOKE_TURN='你好' npm --prefix hosts/desktop start

# 钉钉 live 门控
node scripts/dev_stubs/cn_webhook_stub.js &
BITBOT_DINGTALK_POST=1 \
BITBOT_DINGTALK_WEBHOOK='http://127.0.0.1:8788/robot/send?access_token=x' …

# OTA
python3 -m http.server 8790 --directory /path/to/feed
BITBOT_UPDATE_FEED_URL=http://127.0.0.1:8790 …
```

产品验收仍要求：真实 `BITBOT_LLM_API_KEY`（DeepSeek）、真实渠道凭证、签名/公证证书。
