///|
test "markdown link discipline rejects bare urls" {
  assert_true(
    @runtime.assert_markdown_links("见 [文档](https://example.com/a)"),
  )
  assert_true(@runtime.has_bare_url("打开 https://example.com/a"))
  assert_false(@runtime.assert_markdown_links("打开 https://example.com/a"))
}
