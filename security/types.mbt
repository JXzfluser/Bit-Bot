///|
/// Marks untrusted external content so the runtime never treats it as instruction.
/// Fence parsing lives in parse.mbt; this file only holds the shared type (CAP-072).
pub(all) struct UntrustedFence {
  source : String
  body : String
  marker_id : String
} derive(Eq, Debug)

///|
pub extend UntrustedFence with Eq::{equal, not_equal}

///|
pub extend UntrustedFence with Debug::{to_repr}

///|
pub fn UntrustedFence::wrap(source : String, body : String) -> UntrustedFence {
  { source, body, marker_id: "cursor_untrusted_data", }
}

///|
/// 判断被围栏包裹的不可信内容是否在"试图给代理下指令"。
///
/// 这**不是**安全闸——围栏内容永远不可执行，闸是 `ContentSlice::must_not_execute`。
/// 这里给上层一个"这段外部内容疑似提示注入"的信号，用于提示与审计。
///
/// 上一版这里硬编码 `false`，等于这个信号永远不触发：函数名承诺了一件事，实现
/// 却恒定地否认它。现在按常见提示注入句式做真实判定。
pub fn UntrustedFence::is_instructional(self : UntrustedFence) -> Bool {
  let lower = self.body.to_lower()
  let markers = [
    "ignore previous", "ignore prior", "ignore all previous", "ignore the above",
    "disregard", "you must", "you should now", "system:", "assistant:", "do not tell the user",
    "don't tell the user", "new instructions", "execute the following", "run the following command",
    "<|im_start|>", "please send", "send an email to", "请发送", "忽略之前",
    "忽略以上", "忽略上面的", "系统提示",
  ]
  for m in markers {
    if lower.contains(m) {
      return true
    }
  }
  false
}
