"use strict";
/**
 * relay_config_watch.js — A3-11 中转配置热生效（部分关 R-A3-6h）
 *
 * 为什么需要它：A3-6 起，配对回执里的 relay 四栏是**每次兑换现读**的，
 * 改完 relay.json 立刻就能下发给手机；但「盒子登记」只在入站启动 / 切局域网开关时
 * 发生（`main.js` 的 `syncRelayBoxRegistration`）。于是运行中改配置会出现
 * 「有四栏却 NOBOX」—— 用户只能重启桌面 app。A3-10 的真机清单 §2.3 / §7 里
 * 甚至把「重启一次 app」写成了现场 workaround，这一刀就是把它删掉。
 *
 * 为什么是轮询而不是 fs.watch：
 *  1. 编辑器保存 JSON 普遍是「写临时文件 + rename」，只 watch 文件本身会在 rename 后丢监听；
 *  2. 打包后 `data/desktop/relay.json` 的路径与开发态不同，watch 目录要额外处理 asar；
 *  3. 2s 一次读一个几百字节的 JSON，成本可以忽略，却能同时覆盖「新建 / 删除 / 改坏」三种情况。
 *
 * 指纹刻意用**归一后的配置对象**而不是文件原文：往 JSON 里加空格/换行不该触发重新登记，
 * 但 host / port / boxId / 两把 token / endpoint / mode / localEndpoint 任一变化都必须触发。
 *
 * 这个模块不碰 socket、不碰 Electron，可被门禁直接 require 用真 relay 跑。
 */
const DEFAULT_INTERVAL_MS = 2000;

function fingerprintOf(cfg) {
  return cfg ? JSON.stringify(cfg) : "(none)";
}

function createRelayConfigWatch(opts) {
  const o = opts || {};
  const load = typeof o.load === "function" ? o.load : () => null;
  const onChange = typeof o.onChange === "function" ? o.onChange : () => {};
  const intervalMs = Number(o.intervalMs === undefined ? DEFAULT_INTERVAL_MS : o.intervalMs);

  const state = {
    running: false,
    checks: 0,
    changes: 0,
    fingerprint: null,
    lastChangeAt: 0,
    lastError: null,
    intervalMs,
  };
  let timer = null;

  function current() {
    try {
      return fingerprintOf(load());
    } catch (e) {
      // 配置读坏不该把桌面拖死：记下原因，保持上一次指纹，等下一轮再看。
      state.lastError = String((e && e.message) || e);
      return state.fingerprint;
    }
  }

  /** 显式跑一轮检查。门禁用它做确定性触发，不靠 sleep 猜状态。 */
  function check() {
    if (!state.running) return false;
    state.checks++;
    const fp = current();
    if (fp === state.fingerprint) return false;
    state.fingerprint = fp;
    state.changes++;
    state.lastChangeAt = Date.now();
    try {
      onChange(fp);
    } catch (e) {
      state.lastError = String((e && e.message) || e);
    }
    return true;
  }

  function start() {
    if (state.running) return getState();
    state.running = true;
    // 先记基线：启动这件事本身不算「配置变了」，不触发 onChange。
    state.fingerprint = current();
    if (intervalMs > 0) {
      timer = setInterval(check, intervalMs);
      if (timer.unref) timer.unref();
    }
    return getState();
  }

  function stop() {
    state.running = false;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    return getState();
  }

  function getState() {
    return Object.assign({}, state);
  }

  return { start, stop, check, getState };
}

module.exports = { createRelayConfigWatch, fingerprintOf, DEFAULT_INTERVAL_MS };
