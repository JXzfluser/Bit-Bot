///|
/// CM-2153: Live meeting chat outbound exception — skill allow → non-draft-card.
test "acceptance_CM-2153_live_meeting_chat_send_exception" {
  assert_eq(@skills.meetings_skill_name(), "meetings")
  assert_true(@skills.meetings_skill_md().contains("live meeting") ||
    @skills.meetings_skill_md().contains("non-draft"))
  // Skill not loaded / not allowed → draft card.
  assert_false(
    @skills.meetings_skill_allows_live_chat_direct_send(
      skill_loaded=false,
      explicit_allow_direct=true,
    ),
  )
  assert_false(
    @skills.meetings_skill_allows_live_chat_direct_send(
      skill_loaded=true,
      explicit_allow_direct=false,
    ),
  )
  assert_true(
    @skills.meetings_skill_allows_live_chat_direct_send(
      skill_loaded=true,
      explicit_allow_direct=true,
    ),
  )
  // Live meeting + skill allows → DirectSend (non-draft-card).
  match
    @skills.plan_meetings_live_chat_outbound(
      skill_loaded=true,
      explicit_allow_direct=true,
      is_live_meeting_chat=true,
      body="Thanks everyone — next slide.",
    ) {
    Err(e) => fail(e)
    Ok(mode) => {
      assert_true(mode.is_direct())
      assert_false(mode.is_draft_card())
      assert_eq(mode, @channels.DirectSend)
    }
  }
  match
    @channels.execute_live_meeting_chat_outbound(
      {
        is_live_meeting_chat: true,
        skill_allows_direct_send: true,
        body: "Hello live room",
      },
    ) {
    Err(e) => fail(e)
    Ok(r) => {
      assert_false(r.used_draft_card())
      match r {
        @channels.SentDirect(body~) => assert_eq(body, "Hello live room")
        _ => fail("expected SentDirect")
      }
    }
  }
  // Live meeting but skill does NOT allow → still draft card.
  match
    @skills.plan_meetings_live_chat_outbound(
      skill_loaded=true,
      explicit_allow_direct=false,
      is_live_meeting_chat=true,
      body="hold for approval",
    ) {
    Err(e) => fail(e)
    Ok(mode) => {
      assert_true(mode.is_draft_card())
      assert_eq(mode, @channels.DraftCard)
    }
  }
  // Ordinary (non live-meeting) channel even with skill allow → draft card.
  match
    @channels.plan_live_meeting_chat_outbound(
      {
        is_live_meeting_chat: false,
        skill_allows_direct_send: true,
        body: "ordinary dm",
      },
    ) {
    Err(e) => fail(e)
    Ok(mode) => assert_true(mode.is_draft_card())
  }
  match
    @channels.execute_live_meeting_chat_outbound(
      {
        is_live_meeting_chat: false,
        skill_allows_direct_send: true,
        body: "ordinary dm",
      },
    ) {
    Err(e) => fail(e)
    Ok(r) => assert_true(r.used_draft_card())
  }
}
