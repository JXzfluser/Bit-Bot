///|
/// L-batch P0: CM-2002 language follow — Chinese ask → Chinese answer.

///|
test "acceptance_CM-2002_language_follow_zh_ask_zh_answer" {
  let ask = "请用中文解释一下什么是时区？"
  assert_eq(@runtime.detect_ask_language(ask), @runtime.Zh)
  let ans = @runtime.follow_language_answer(
    ask,
    zh_answer="时区是地球各地区约定的标准时间偏移，例如 Asia/Shanghai。",
    en_answer="A time zone is a regional standard offset such as Asia/Shanghai.",
  )
  assert_true(@runtime.language_follow_ok(ask, ans))
  assert_true(ans.contains("时区") || ans.contains("Asia/Shanghai"))
  assert_false(ans.has_prefix("A time zone"))
  // English ask → English answer.
  let ask_en = "What is a time zone?"
  assert_eq(@runtime.detect_ask_language(ask_en), @runtime.En)
  let ans_en = @runtime.follow_language_answer(
    ask_en,
    zh_answer="时区说明",
    en_answer="A time zone labels a regional UTC offset.",
  )
  assert_true(ans_en.contains("time zone") || ans_en.contains("UTC"))
  assert_false(ans_en.contains("时区说明"))
}
