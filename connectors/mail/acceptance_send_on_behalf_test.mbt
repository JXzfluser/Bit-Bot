///|
/// CM-1006: multi-account must ask; report real from after send.
test "acceptance_CM-1006_send_on_behalf_pick_account" {
  let sob = @mail.SendOnBehalf::new([
    { id: "g1", address: "a@gmail.com", },
    { id: "g2", address: "b@gmail.com", },
  ])
  match sob.send(account_id=None, to_="x@y.com", subject="Hi", body="b") {
    Err(m) => assert_true(m.contains("multiple") || m.contains("which"))
    Ok(_) => fail("must ask which account")
  }
  match sob.send(account_id=Some("g2"), to_="x@y.com", subject="Hi", body="b") {
    Ok(r) => {
      assert_true(r.contains("from=b@gmail.com"))
      assert_true(r.contains("to=x@y.com"))
    }
    Err(e) => fail(e)
  }
}
