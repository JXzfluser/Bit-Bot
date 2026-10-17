///|
/// CM-1008: +tag addresses — To/Cc show tag; routines match tag only.
test "acceptance_CM-1008_plus_tag_address_routine_filter" {
  match @mail.parse_plus_tag_address("alpha+invoices@bot.example") {
    Ok(addr) => {
      assert_eq(addr.local_part, "alpha")
      assert_eq(addr.tag, Some("invoices"))
      assert_eq(addr.domain, "bot.example")
      assert_true(addr.has_tag())
      assert_eq(addr.to_header(), "alpha+invoices@bot.example")
      assert_true(addr.to_header().contains("+invoices"))
    }
    Err(e) => fail(e)
  }
  match @mail.parse_plus_tag_address("bravo@bot.example") {
    Ok(addr) => {
      assert_eq(addr.tag, None)
      assert_eq(addr.to_header(), "bravo@bot.example")
      assert_false(addr.has_tag())
    }
    Err(e) => fail(e)
  }
  let to_addr = match
    @mail.parse_plus_tag_address("alpha+billing@bot.example") {
    Ok(a) => a
    Err(e) => fail(e)
  }
  let cc_addr = match @mail.parse_plus_tag_address("ops+alerts@bot.example") {
    Ok(a) => a
    Err(e) => fail(e)
  }
  let recips = @mail.MailRecipients::{ to_: [to_addr], cc: [cc_addr], }
  let to_h = recips.to_headers_show_tags()
  let cc_h = recips.cc_headers_show_tags()
  assert_eq(to_h.length(), 1)
  assert_true(to_h[0].contains("+billing"))
  assert_true(cc_h[0].contains("+alerts"))
  assert_true(
    @mail.routine_matches_plus_tag(filter_tag="billing", address=to_addr),
  )
  assert_true(
    @mail.routine_matches_plus_tag(filter_tag="+billing", address=to_addr),
  )
  assert_false(
    @mail.routine_matches_plus_tag(filter_tag="invoices", address=to_addr),
  )
  assert_false(
    @mail.routine_matches_plus_tag(filter_tag="alpha", address=to_addr),
  )
  let bare = match @mail.parse_plus_tag_address("alpha@bot.example") {
    Ok(a) => a
    Err(e) => fail(e)
  }
  assert_false(
    @mail.routine_matches_plus_tag(filter_tag="billing", address=bare),
  )
}
