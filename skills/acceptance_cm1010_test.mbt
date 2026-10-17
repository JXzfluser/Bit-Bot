///|
/// CM-1010: first proxy-write offers recent-message samples; draft matches register.
test "acceptance_CM-1010_send_on_behalf_tone_samples" {
  let session = @skills.SendOnBehalfToneSession::new([
    {
      id: "s1",
      preview: "Hey — can you send the deck when you get a sec?",
      register_: "informal",
    },
    {
      id: "s2",
      preview: "Dear colleagues, please find the attached report.",
      register_: "formal",
    },
  ])
  // Drafting before offering samples is refused.
  match session.draft_matching_register(body="Hey there") {
    Err(m) => assert_true(m.contains("samples") || m.contains("register"))
    Ok(_) => fail("must offer samples first")
  }
  match session.begin_first_proxy_write() {
    Ok(samples) => {
      assert_eq(samples.length(), 2)
      assert_true(session.offered_samples())
      assert_eq(samples[0].register_, "informal")
      assert_eq(samples[1].register_, "formal")
    }
    Err(e) => fail(e)
  }
  match session.pick_sample(sample_id="s2") {
    Ok(reg) => assert_eq(reg, "formal")
    Err(e) => fail(e)
  }
  assert_eq(session.matched_register(), Some("formal"))
  // Informal draft rejected when formal register locked.
  match session.draft_matching_register(body="Hey thanks!") {
    Err(m) => assert_true(m.contains("register") || m.contains("formal"))
    Ok(_) => fail("must match formal register")
  }
  match
    session.draft_matching_register(
      body="Dear colleagues, please review the update. Sincerely,",
    ) {
    Ok(body) => {
      assert_true(body.contains("Dear"))
      assert_eq(session.matched_register(), Some("formal"))
    }
    Err(e) => fail(e)
  }
}
