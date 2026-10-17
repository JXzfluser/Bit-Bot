///|
/// CM-2103: Markdown math \( \)/$$ and mermaid fences — parse/validate structure.
test "acceptance_CM-2103_markdown_math_and_mermaid" {
  let sample = "Inline \\(E=mc^2\\) and display:\n\n$$\na^2+b^2=c^2\n$$\n\n```mermaid\ngraph TD\n  A-->B\n```\n"
  match @ui_protocol.parse_markdown_math_and_mermaid(sample) {
    Err(e) => fail(e)
    Ok(parsed) => {
      assert_true(parsed.has_inline_math())
      assert_true(parsed.has_display_math())
      assert_true(parsed.has_mermaid())
      assert_true(parsed.math_spans.length() >= 2)
      assert_eq(parsed.mermaid_fences.length(), 1)
      assert_true(
        parsed.mermaid_fences[0].body.contains("graph") ||
        parsed.mermaid_fences[0].body.contains("A-->B"),
      )
      let mut saw_inline = false
      let mut saw_display = false
      for s in parsed.math_spans {
        match s.kind {
          @ui_protocol.InlineParen => {
            saw_inline = true
            assert_true(s.body.contains("E=mc") || s.body.contains("mc"))
          }
          @ui_protocol.DisplayDollar => {
            saw_display = true
            assert_true(s.body.contains("a^2") || s.body.contains("c^2"))
          }
        }
      }
      assert_true(saw_inline)
      assert_true(saw_display)
    }
  }
  match @ui_protocol.parse_markdown_math_and_mermaid("bad \\(no close") {
    Err(m) => assert_true(m.contains("unclosed") || m.contains("math"))
    Ok(_) => fail("unclosed inline math must Err")
  }
}
