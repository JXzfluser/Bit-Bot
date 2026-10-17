///|
/// K-batch P0: CM-2152 first-turn with description; CM-2154 agent inbound divert.

///|
test "acceptance_CM-2152_first_turn_with_description_start" {
  let plan = @runtime.plan_first_turn(
    description="Triage inbox and draft replies for the ops channel",
  )
  assert_true(plan.skips_getting_started())
  match plan {
    @runtime.StartWork(announce~) => {
      assert_true(announce.length() > 0)
      assert_true(
        announce.contains("Starting work") || announce.contains("Ready"),
      )
      assert_false(announce.contains("getting-started"))
      assert_false(announce.contains("Getting Started"))
    }
    @runtime.ShowGettingStarted => fail("non-empty description must start work")
  }
  assert_true(
    @runtime.should_start_work_immediately(
      description="Ship weekly status notes",
    ),
  )
  // Empty → getting-started.
  let empty = @runtime.plan_first_turn(description="   ")
  assert_false(empty.skips_getting_started())
  assert_true(empty is @runtime.ShowGettingStarted)
}

///|
test "acceptance_CM-2154_inbound_agent_not_user_question" {
  assert_true(@runtime.has_agent_cue("[agent] peer status ping"))
  assert_eq(
    @runtime.strip_agent_cue("[agent] peer status ping"),
    "peer status ping",
  )
  // Explicit Agent kind → divert, not user Q.
  let h1 = @runtime.handle_inbound(
    kind=@runtime.Agent,
    text="please summarize yesterday",
  )
  assert_false(h1.is_user_question())
  assert_false(h1.answered_as_user())
  match h1 {
    @runtime.DivertAgent(payload~) =>
      assert_eq(payload, "please summarize yesterday")
    _ => fail("Agent kind must DivertAgent")
  }
  // [agent] cue on User kind → still divert.
  let h2 = @runtime.handle_inbound(
    kind=@runtime.User,
    text="[agent] teammate wake: sync calendar",
  )
  assert_false(h2.answered_as_user())
  match h2 {
    @runtime.DivertAgent(payload~) =>
      assert_eq(payload, "teammate wake: sync calendar")
    _ => fail("[agent] cue must DivertAgent")
  }
  // Real user question still answers as user.
  let h3 = @runtime.handle_inbound(kind=@runtime.User, text="what is the plan?")
  assert_true(h3.answered_as_user())
  // open_turn_from_inbound resolves kind to Agent; no user ack.
  let (ctx, handled) = @runtime.open_turn_from_inbound(
    turn_id="k-2154",
    text="[agent] handoff note",
  )
  assert_eq(ctx.inbound_kind, @runtime.Agent)
  assert_false(ctx.should_ack_user())
  assert_false(handled.answered_as_user())
  let after = ctx.acknowledge(body="should not speak as user Q")
  assert_eq(after.outbound.length(), 0)
}
