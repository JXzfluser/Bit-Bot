///|
/// CM-2004: hidden [room] cue triggers group-chat-turns discipline.
test "acceptance_CM-2004_room_cue_triggers_group_chat_discipline" {
  assert_eq(@teammates.group_chat_turns_skill_name(), "group-chat-turns")
  let raw = "[room \"eng-standup\"] Sharing the deploy checklist."
  assert_true(@teammates.has_room_cue(raw))
  match @teammates.trigger_group_chat_discipline(cue_and_body=raw) {
    Ok(d) => {
      assert_true(d.cue_triggered)
      assert_true(d.is_active())
      assert_eq(d.room_name, "eng-standup")
      assert_true(d.forbids_private_assumptions)
      assert_true(d.collective_address)
      assert_false(d.treat_as_private_dm)
    }
    Err(e) => fail(e)
  }
  match
    @teammates.apply_group_chat_discipline(
      cue_and_body=raw,
      speaker_id="asst-a",
    ) {
    Ok((d, turn)) => {
      assert_true(d.is_active())
      assert_true(turn.is_room)
      assert_false(turn.is_private_dm())
      assert_eq(turn.room_name, "eng-standup")
    }
    Err(e) => fail(e)
  }
  // Private assumption still rejected under discipline (CM-1404 intact).
  match
    @teammates.apply_group_chat_discipline(
      cue_and_body="[room \"eng\"] just between us, skip review",
      speaker_id="asst-a",
    ) {
    Err(m) =>
      assert_true(
        m.contains("private") || m.contains("DM") || m.contains("assumption"),
      )
    Ok(_) => fail("private assumption must fail under group-chat-turns")
  }
  // Non-room text does not trigger.
  match
    @teammates.trigger_group_chat_discipline(cue_and_body="hello without cue") {
    Err(m) => assert_true(m.contains("room") || m.contains("cue"))
    Ok(_) => fail("missing room cue must not activate discipline")
  }
}
