/* channel_bind.js — 渠道「扫码关联」的一次性绑定码。
 *
 * 为什么需要它
 * ------------
 * 钉钉 / 飞书 / 企微 的机器人凭据（webhook、tenant token、agentid…）本来只能
 * 在桌面的「连接应用」里一栏一栏粘。扫码的目标**不是**去厂商那边授权 ——
 * 那几家都没有「扫个码就把机器人给我」的公开能力（个人微信更没有机器人接口）。
 * 能真正做到的是把**输入搬到手机上**：桌面只出码和状态，键盘在手机上，
 * 提交完桌面自动变「已关联」。这样桌面上一个输入框都不用有。
 *
 * 三条不变量（门会逐条钉）
 * ------------------------
 *  1. 一个 token 只服务一个渠道、只在 TTL 内、只能用一次。重放 / 串渠道一律拒。
 *  2. 白名单在这里定死：手机页只能写这几个 env 键，绝不接受任意键 ——
 *     否则这张公网可达的页面就成了「往 .env.local 写任意内容」的远程写入口。
 *  3. token 与提交的凭据都不进日志、不回显。本模块只吐「存了哪几个键」。
 *
 * 这个文件不碰磁盘、不发网络，纯状态机 + 校验，便于单独跑门。
 */
"use strict";

const crypto = require("crypto");

/* 渠道字段表：手机页按这张表出表单，claim 按这张表校验。
 * check 只做「像不像」的判断，不去断言厂商格式细节（各家会变）。 */
const CHANNELS = {
  dingtalk: {
    name: "钉钉",
    /* 渠道名是可见文案，必须走词条（Copy contract v1 §1）：
     * 硬编码中文在 en / zh-TW 下不会跟着切。 */
    name_i18n: "bmChDingtalk",
    short: "钉",
    short_i18n: "bmShortDingtalk",
    note: "在钉钉群里加一个自定义机器人，把它的 Webhook 粘过来。",
    fields: [
      {
        env: "BITBOT_DINGTALK_WEBHOOK",
        label: "Webhook 地址",
        hint: "机器人设置里整段复制，形如 https://oapi.dingtalk.com/robot/send?access_token=…",
        type: "text",
        required: true,
        check(v) {
          if (!/^https?:\/\//i.test(v)) return "要以 http:// 或 https:// 开头";
          if (!/access_token=/.test(v)) return "这段地址里没有 access_token，粘的可能是机器人主页而不是 Webhook";
          return "";
        },
      },
      {
        env: "BITBOT_DINGTALK_APP_SECRET",
        label: "加签密钥",
        hint: "机器人安全设置里 SEC 开头那串；用关键词或 IP 白名单的可以留空。",
        type: "password",
        required: false,
      },
    ],
  },
  feishu: {
    name: "飞书",
    name_i18n: "bmChFeishu",
    short: "飞",
    short_i18n: "bmShortFeishu",
    note: "飞书群机器人或自建应用的 tenant token，连同要发到哪个会话。",
    fields: [
      {
        env: "BITBOT_FEISHU_TOKEN",
        label: "tenant token",
        hint: "开放平台「凭证与基础信息」里的 tenant_access_token",
        type: "password",
        required: true,
        check(v) {
          return /\s/.test(v) ? "中间不能有空格或换行，整段是一个 token" : "";
        },
      },
      {
        env: "BITBOT_FEISHU_CHAT_ID",
        label: "chat_id",
        hint: "oc_ 开头；群设置 → 会话 ID",
        type: "text",
        required: true,
        check(v) {
          return /^oc_/i.test(v) ? "" : "chat_id 通常以 oc_ 开头，确认没粘错";
        },
      },
      {
        env: "BITBOT_FEISHU_ENCRYPT_KEY",
        label: "Encrypt Key",
        hint: "事件订阅开启「加密」时才需要，可留空。",
        type: "password",
        required: false,
      },
      {
        env: "BITBOT_FEISHU_VERIFICATION_TOKEN",
        label: "Verification Token",
        hint: "事件订阅验签用，可留空。",
        type: "password",
        required: false,
      },
    ],
  },
  wecom: {
    name: "企业微信",
    name_i18n: "bmChWecom",
    short: "企",
    short_i18n: "bmShortWecom",
    note: "自建应用的 access_token + agentid + touser；群机器人只有 Webhook 的走钉钉式配法不适用这里。",
    fields: [
      {
        env: "BITBOT_WECOM_TOKEN",
        label: "access_token",
        hint: "应用管理 → 自建应用 →  Secret 换来的 access_token",
        type: "password",
        required: true,
      },
      {
        env: "BITBOT_WECOM_AGENT_ID",
        label: "agentid",
        hint: "自建应用的 AgentId（纯数字）",
        type: "text",
        required: true,
        check(v) {
          return /^\d+$/.test(v) ? "" : "agentid 是纯数字，别把应用名粘进来";
        },
      },
      {
        env: "BITBOT_WECOM_TOUSER",
        label: "touser",
        hint: "@all 或具体成员账号，多个用 | 分隔",
        type: "text",
        required: true,
        check(v) {
          return v === "@all" || /^[^\s]+$/.test(v) ? "" : "touser 里不能有空格";
        },
      },
      {
        env: "BITBOT_WECOM_CALLBACK_TOKEN",
        label: "回调 Token",
        hint: "要收消息才填，只发消息可留空。",
        type: "password",
        required: false,
      },
    ],
  },
  /* 微信单列一门，但**不给绑定表单**：个人微信没有官方机器人接口，
   * 造一个扫了没用的码比不给更糟。详情页如实写清走哪条路。
   * bindable=false 的渠道 begin() 直接拒绝，页面显示原因。 */
  wechat: {
    name: "微信",
    short: "微",
    bindable: false,
    name_i18n: "bmChWechat",
    short_i18n: "bmShortWechat",
    reason_i18n: "bmWechatReason",
    reason:
      "个人微信没有官方机器人接口，扫码关联在微信这一侧做不到。" +
      "要用微信当入口，只能通过企业微信的自建应用接进来（企微可以对话微信用户）。",
    path: "wecom",
    note: "个人微信没有开放机器人接口；要走微信，得先用企业微信把微信用户接进来。",
    fields: [],
  },
};

function channelsForUi() {
  return Object.keys(CHANNELS).map((id) => {
    const c = CHANNELS[id];
    return {
      id,
      name: c.name,
      name_i18n: c.name_i18n || "",
      short: c.short || "",
      short_i18n: c.short_i18n || "",
      bindable: c.bindable !== false,
      note: c.note || "",
      reason: c.reason || "",
      reason_i18n: c.reason_i18n || "",
      path: c.path || "",
      field_count: (c.fields || []).length,
    };
  });
}

function createChannelBindManager(opts) {
  const o = opts || {};
  const ttlMs = Number(o.ttlMs) > 0 ? Number(o.ttlMs) : 5 * 60 * 1000;
  const now = typeof o.now === "function" ? o.now : () => Date.now();
  const newToken =
    typeof o.newToken === "function"
      ? o.newToken
      : () => crypto.randomBytes(16).toString("hex");
  /* claim 成功后的落盘交回宿主（main.js），本模块不直接写文件。 */
  const onBound = typeof o.onBound === "function" ? o.onBound : null;

  /** token -> { channel, issued_at, expires_at, used_at } */
  const pending = new Map();

  function sweep() {
    const t = now();
    for (const [tok, rec] of pending) {
      if (rec.used_at || rec.expires_at <= t) pending.delete(tok);
    }
  }

  /**
   * 签发一个绑定码。只给可绑定的渠道发。
   * @returns {{ok:true, token, channel, expires_at, ttl_ms, fields}|{ok:false, error, reason?}}
   */
  function begin(channelId) {
    const id = String(channelId || "").trim();
    const ch = CHANNELS[id];
    if (!ch) return { ok: false, error: "channel_unknown" };
    if (ch.bindable === false) {
      return { ok: false, error: "channel_not_bindable", reason: ch.reason || "" };
    }
    sweep();
    /* 同一渠道同时只留一个有效码：用户连点两次不该产生两把能用的钥匙。 */
    for (const [tok, rec] of pending) {
      if (rec.channel === id && !rec.used_at) pending.delete(tok);
    }
    const token = newToken();
    const issued = now();
    const rec = {
      channel: id,
      issued_at: issued,
      expires_at: issued + ttlMs,
      used_at: 0,
    };
    pending.set(token, rec);
    return {
      ok: true,
      token,
      channel: id,
      expires_at: rec.expires_at,
      ttl_ms: ttlMs,
      fields: ch.fields,
      name: ch.name,
    };
  }

  /** 只读：手机页渲染前用它确认 token 还有效，不做消费。 */
  function peek(token, channelId) {
    sweep();
    const rec = pending.get(String(token || ""));
    if (!rec) return { ok: false, error: "bind_token_unknown" };
    if (channelId && rec.channel !== String(channelId)) {
      return { ok: false, error: "bind_channel_mismatch" };
    }
    return {
      ok: true,
      channel: rec.channel,
      expires_at: rec.expires_at,
      ttl_left_ms: Math.max(0, rec.expires_at - now()),
      name: CHANNELS[rec.channel].name,
      fields: CHANNELS[rec.channel].fields,
    };
  }

  /**
   * 消费 token 并校验字段。成功时 token 立即作废（重放必拒）。
   * @param {string} token
   * @param {{channel?:string, values?:object}} input
   */
  async function claim(token, input) {
    sweep();
    const tok = String(token || "");
    const rec = pending.get(tok);
    if (!rec) return { ok: false, error: "bind_token_unknown" };
    if (rec.used_at) return { ok: false, error: "bind_token_used" };
    if (rec.expires_at <= now()) return { ok: false, error: "bind_token_expired" };

    const channelId = String((input && input.channel) || rec.channel);
    if (channelId !== rec.channel) return { ok: false, error: "bind_channel_mismatch" };

    const ch = CHANNELS[channelId];
    const values = (input && input.values) || {};
    const patch = {};
    const problems = [];

    for (const f of ch.fields || []) {
      const raw = values[f.env] != null ? values[f.env] : values[f.label];
      const v = String(raw == null ? "" : raw).trim();
      if (!v) {
        if (f.required) problems.push({ field: f.label, message: "这一栏是必填的" });
        continue;
      }
      if (typeof f.check === "function") {
        const m = f.check(v);
        if (m) {
          problems.push({ field: f.label, message: m });
          continue;
        }
      }
      patch[f.env] = v;
    }

    if (problems.length) {
      /* 校验失败**不消费** token：手机上改一栏再提交不该被判过期。 */
      return { ok: false, error: "bind_field_invalid", problems };
    }

    rec.used_at = now();
    pending.delete(tok);

    let applied = null;
    if (onBound) {
      try {
        applied = await onBound({ channel: channelId, patch });
      } catch (err) {
        applied = { ok: false, error: String((err && err.message) || err) };
      }
    }
    return {
      ok: true,
      channel: channelId,
      name: ch.name,
      saved_keys: Object.keys(patch),
      applied,
    };
  }

  /** 诊断用：不含 token 本体、不含任何凭据值。 */
  function stats() {
    sweep();
    return {
      pending: pending.size,
      ttl_ms: ttlMs,
      channels: Object.keys(CHANNELS),
      bindable: Object.keys(CHANNELS).filter((k) => CHANNELS[k].bindable !== false),
    };
  }

  return { begin, peek, claim, stats, sweep, channels: CHANNELS, channelsForUi };
}

module.exports = { createChannelBindManager, CHANNELS, channelsForUi };
