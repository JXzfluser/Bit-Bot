///|
/// 不可逆授权线索词。记忆里出现这些词时，用户会以为"我授权过了"，
/// 所以拒绝理由要能说清是哪一类线索，而不是一个看不懂的失败。
fn irreversible_permission_cues() -> Array[String] {
  [
    "send", "purchase", "buy", "approve", "authorized", "permission granted", "may send",
    "can send", "allow send", "外部发送", "购买", "可发",
  ]
}

///|
/// CM-0306: 记忆内容永远不构成不可逆外发/购买的授权（硬规则）。
///
/// 这条判定是**安全策略**，不是存储层职责，所以判定放在 security：内核不应该为了
/// "问一句记忆能不能发" 而反向依赖 memory 存储包。放在 memory 里既让依赖方向
/// 倒置，也让策略看起来像是"记忆层的某种能力"，而不是一条安全不变量。
pub fn memory_cue_grants_send(_value : String) -> Bool {
  false
}

///|
/// 拒绝理由：区分"记忆里写了授权线索"和"记忆里没有授权线索"两种情况。
/// 两种情况都拒绝，区别只在于诊断信息——之前的实现把线索词算完就丢
/// （`let _ = value_has_irreversible_cue(...)`），等于白算。
pub fn memory_cue_refusal_reason(value : String) -> String {
  let lower = value.to_lower()
  for cue in irreversible_permission_cues() {
    if lower.contains(cue) || value.contains(cue) {
      let reason = "memory contains a send/purchase permission cue; memory never authorizes irreversible send"
      return reason
    }
  }
  "memory never authorizes irreversible send"
}
