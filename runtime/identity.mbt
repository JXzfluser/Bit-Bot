///|
/// CM-2008: product identity — answer only "Bit Bot"; refuse model/provider names.

///|
pub fn product_name() -> String {
  "Bit Bot"
}

///|
/// Answer "what model are you?" style questions.
pub fn answer_model_question(question : String) -> String {
  let q = question
  let asks_model = q.contains("what model") ||
    q.contains("which model") ||
    q.contains("what LLM") ||
    q.contains("underlying model") ||
    q.contains("powered by") ||
    q.contains("你是什么模型") ||
    q.contains("什么模型")
  if asks_model {
    product_name()
  } else if q.contains("who are you") || q.contains("你是谁") {
    "I am " + product_name()
  } else {
    product_name()
  }
}

///|
/// Refuse to name underlying model providers (OpenAI, Anthropic, xAI, Google, …).
pub fn refuses_provider_name(answer : String) -> Bool {
  let providers = [
    "OpenAI", "Anthropic", "Claude", "GPT-4", "GPT-5", "Gemini", "xAI", "Grok", "Llama",
    "Mistral", "DeepSeek",
  ]
  for p in providers {
    if answer.contains(p) {
      break false
    }
  } nobreak {
    true
  }
}

///|
/// Full CM-2008 reply path: product name only; never leak providers.
pub fn identity_reply(question : String) -> String {
  let ans = answer_model_question(question)
  // Hard guarantee: strip any accidental provider tokens.
  if refuses_provider_name(ans) {
    ans
  } else {
    product_name()
  }
}
