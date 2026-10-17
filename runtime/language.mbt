///|
/// CM-2002: language follow — reply in the user's ask language (Settings language anchor).

///|
pub(all) enum AskLanguage {
  Zh
  En
  Other
} derive(Eq, Debug)

///|
pub extend AskLanguage with Eq::{equal, not_equal}

///|
pub extend AskLanguage with Debug::{to_repr}

///|
pub fn AskLanguage::name(self : AskLanguage) -> String {
  match self {
    Zh => "zh"
    En => "en"
    Other => "other"
  }
}

///|
fn has_cjk(text : String) -> Bool {
  // Heuristic: common Chinese punctuation / characters as code units via contains.
  let markers = [
    "你", "我", "是", "什么", "吗", "呢", "请", "帮", "中", "文", "的",
    "了", "在", "和", "？", "。", "，",
  ]
  for m in markers {
    if text.contains(m) {
      return true
    }
  }
  false
}

///|
/// Detect ask language from user message text.
pub fn detect_ask_language(ask : String) -> AskLanguage {
  if has_cjk(ask) {
    Zh
  } else if ask.length() == 0 {
    Other
  } else {
    En
  }
}

///|
/// CM-2002: produce an answer that follows the ask language.
/// zh_answer / en_answer are prepared content; pick by detection.
pub fn follow_language_answer(
  ask : String,
  zh_answer~ : String,
  en_answer~ : String,
) -> String {
  match detect_ask_language(ask) {
    Zh => zh_answer
    En => en_answer
    Other => en_answer
  }
}

///|
/// True when a Chinese ask received a Chinese (CJK-bearing) answer.
pub fn language_follow_ok(ask : String, answer : String) -> Bool {
  match detect_ask_language(ask) {
    Zh => has_cjk(answer)
    En => !has_cjk(answer) || answer.length() > 0
    Other => answer.length() > 0
  }
}
