"use strict";

/**
 * effect_gate —— 副作用串行化闸。
 *
 * ## 为什么需要它
 *
 * 编排引擎原来有两种跑法:
 *   · `bot_discretion` —— 所有成员**同时**各跑一轮(旧默认,用户看到的是
 *     「一堆活全部 bot 开始工作」);
 *   · `auto_route` —— 一次只跑一个,做完交给下一棒(现在的默认)。
 *
 * 切到串行的原因很可能是并行时出过事:两个成员**同时**对外发邮件、
 * 同时改同一个文件、同时装同一个插件 ⇒ 重复投递 / 写坏 / 竞态。
 * ⇒ 串行是**对的**,但代价是等待时间变成 N 倍。
 *
 * 这道闸就是那个"对的"部分:**推理与只读并发跑,写动作排队跑。**
 * 概念上和 Claude Code / Codex 的做法一样 —— 并行探索,串行编辑。
 *
 * ## 粒度:整批入闸
 *
 * 一个回合的 effect 列表在 `executeHostEffects` 里本来就是顺序执行的,
 * 所以闸按**整批**判定:
 *   · 这一批**全是只读** ⇒ 不入闸 ⇒ 可以和别的成员真并发;
 *   · 这一批**含 mutating** ⇒ 整批入闸 ⇒ 排队,不与别的成员的写操作并发。
 *
 * 为什么不逐个 effect 判:一批里常有「先读后写」(例如先查日程再发邮件),
 * 拆开排队会让读看到写之前的旧状态 —— 反而制造不一致。整批最简单也最安全。
 *
 * ## 不会堵死
 *
 * 审批是**出卡后回合继续**(`continue`),不是挂起等批 ⇒ 等审批不会占着闸。
 *
 * ## 失败不阻塞后续
 *
 * 队列尾巴永远 resolve ⇒ 一个失败的批次不会把后面的批次一起卡死。
 */

function createEffectGate(opts) {
  const o = opts || {};
  const label = String(o.label || "effect-gate");
  let tail = Promise.resolve();
  let queued = 0;
  let ran = 0;
  let failed = 0;

  /**
   * 把一段工作排队执行。
   * @param {() => Promise<any>} fn
   * @returns {Promise<any>}
   */
  function run(fn) {
    queued += 1;
    const started = tail.then(async () => {
      ran += 1;
      try {
        return await fn();
      } catch (e) {
        failed += 1;
        throw e;
      }
    });
    // 尾巴永远 resolve:这一批失败**不许**把后面的批次一起卡死。
    tail = started.then(
      () => undefined,
      () => undefined,
    );
    return started;
  }

  /**
   * 等到队列排空(测试与收尾用)。
   */
  async function drain() {
    await tail;
    return true;
  }

  function stats() {
    return { label, queued, ran, failed, pending: queued - ran };
  }

  return { run, drain, stats, label };
}

/**
 * 进程级单例。桌面主进程、CLI、移动端各是一个进程 ⇒ 各有一个闸。
 * **同一台机器上的两个进程之间不互斥** —— 跨进程互斥需要文件锁,
 * 那属于 per-Bot computer_use 锁那一层(见 host_ffi 的 computer_use 分支)。
 */
let singleton = null;
function getEffectGate() {
  if (!singleton) singleton = createEffectGate({ label: "host-effect-gate" });
  return singleton;
}

module.exports = { createEffectGate, getEffectGate };
