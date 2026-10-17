///|
/// CM-2117: Product recommend line format — multi products one line each with link and price.
test "acceptance_CM-2117_product_recommend_line_format_with_link_price" {
  let items : Array[@ui_protocol.ProductRecommendItem] = [
    {
      name: "Wireless Mouse",
      link: "https://shop.example/mouse",
      price: "$29.99",
    },
    {
      name: "USB-C Hub",
      link: "https://shop.example/hub",
      price: "$49.00",
    },
    {
      name: "Desk Lamp",
      link: "https://shop.example/lamp",
      price: "¥199",
    },
  ]
  match @ui_protocol.format_product_recommend_list(items) {
    Err(e) => fail(e)
    Ok(rendered) => {
      assert_eq(@ui_protocol.product_recommend_line_count(rendered), 3)
      match @ui_protocol.assert_product_recommend_template(rendered) {
        Ok(_) => ()
        Err(e) => fail(e)
      }
      // Each product one line with link and price.
      assert_true(rendered.contains("[Wireless Mouse](https://shop.example/mouse)"))
      assert_true(rendered.contains("$29.99"))
      assert_true(rendered.contains("[USB-C Hub](https://shop.example/hub)"))
      assert_true(rendered.contains("$49.00"))
      assert_true(rendered.contains("[Desk Lamp](https://shop.example/lamp)"))
      assert_true(rendered.contains("¥199"))
      // Fixed template separators.
      assert_true(rendered.contains(") — "))
      assert_true(rendered.has_prefix("- ["))
      // Single item still uses template.
      let one = items[0].format_line()
      assert_eq(one, "- [Wireless Mouse](https://shop.example/mouse) — $29.99")
    }
  }
  match @ui_protocol.format_product_recommend_list([]) {
    Err(m) => assert_true(m.contains("at least one"))
    Ok(_) => fail("empty list must Err")
  }
  match
    @ui_protocol.format_product_recommend_list([
      { name: "x", link: "not-a-url", price: "$1", },
    ]) {
    Err(m) => assert_true(m.contains("link") || m.contains("http"))
    Ok(_) => fail("bad link must Err")
  }
}
