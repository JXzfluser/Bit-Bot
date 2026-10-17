///|
test "ensure_markdown_links rejects bare urls" {
  assert_true(
    @ui_protocol.ensure_markdown_links("see https://example.com/docs") is Err(_),
  )
  assert_true(
    @ui_protocol.ensure_markdown_links("see http://example.com") is Err(_),
  )
  assert_true(
    @ui_protocol.ensure_markdown_links(
      "read [docs](https://example.com/docs) please",
    )
    is Ok(_),
  )
  assert_true(
    @ui_protocol.validate_outbound_links(
      "a [one](https://a.test) and [two](http://b.test)",
    )
    is Ok(_),
  )
  assert_true(
    @ui_protocol.ensure_markdown_links(
      "linked [ok](https://ok.test) but also https://bare.test",
    )
    is Err(_),
  )
  assert_true(@ui_protocol.ensure_markdown_links("no links here") is Ok(_))
}
