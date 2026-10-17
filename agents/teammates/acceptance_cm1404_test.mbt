///|
/// CM-1404: [room "…"] turns — no private-DM assumptions leaked.
test "acceptance_CM-1404_room_turn_no_private_assumptions" {
  let tag = @teammates.room_cue_tag("eng-standup")
  assert_eq(tag, "[room \"eng-standup\"]")
  match @teammates.parse_room_cue(tag + " status update") {
    Ok(name) => assert_eq(name, "eng-standup")
    Err(e) => fail(e)
  }
  match
    @teammates.open_room_turn(
      room_name="eng-standup",
      speaker_id="asst-a",
      body="Sharing the deploy checklist with the room.",
    ) {
    Ok(t) => {
      assert_true(t.is_room)
      assert_false(t.is_private_dm())
      assert_eq(t.room_name, "eng-standup")
    }
    Err(e) => fail(e)
  }
  // Private-DM assumptions rejected.
  match
    @teammates.open_room_turn(
      room_name="eng-standup",
      speaker_id="asst-a",
      body="just between us, skip the review",
    ) {
    Err(m) => assert_true(m.contains("private") || m.contains("DM"))
    Ok(_) => fail("private-DM assumption must be rejected in room turn")
  }
  match
    @teammates.open_room_turn(
      room_name="eng-standup",
      speaker_id="asst-a",
      body="as we discussed privately yesterday",
    ) {
    Err(_) => ()
    Ok(_) => fail("privately assumption must be rejected")
  }
  match
    @teammates.open_room_turn_from_cue(
      cue_and_body="[room \"design\"] Here is the shared mock.",
      speaker_id="asst-b",
    ) {
    Ok(t) => {
      assert_eq(t.room_name, "design")
      assert_true(t.is_room)
      assert_false(t.is_private_dm())
      assert_false(@teammates.leaks_private_dm_assumption(t.body))
    }
    Err(e) => fail(e)
  }
}
