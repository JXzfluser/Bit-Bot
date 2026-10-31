///|
/// CM-1804: flight/accommodation/rideshare vertical flows; SKILL triggers hit.
test "acceptance_CM-1804_flight_accommodation_rideshare_skill_hit" {
  assert_eq(@skills.Flight.skill_name(), "flight")
  assert_eq(@skills.Accommodation.skill_name(), "accommodation")
  assert_eq(@skills.Rideshare.skill_name(), "rideshare")
  // Flight trigger conditions hit.
  assert_true(
    @skills.travel_skill_trigger_hit(
      @skills.Flight,
      "https://www.google.com/flights?q=SFO",
    ),
  )
  assert_true(
    @skills.travel_skill_trigger_hit(
      @skills.Flight,
      "book a flight on southwest",
    ),
  )
  assert_true(
    @skills.travel_skill_trigger_hit(
      @skills.Flight,
      "https://www.united.com/en/us",
    ),
  )
  // Accommodation trigger conditions hit.
  assert_true(
    @skills.travel_skill_trigger_hit(
      @skills.Accommodation,
      "https://www.airbnb.com/rooms/1",
    ),
  )
  assert_true(
    @skills.travel_skill_trigger_hit(
      @skills.Accommodation,
      "find hotel accommodation downtown",
    ),
  )
  // Rideshare trigger conditions hit.
  assert_true(
    @skills.travel_skill_trigger_hit(
      @skills.Rideshare,
      "call an uber rideshare",
    ),
  )
  assert_true(
    @skills.travel_skill_trigger_hit(
      @skills.Rideshare,
      "need a lyft to the airport",
    ),
  )
  // Dispatch vertical playbooks.
  match @skills.dispatch_travel_playbook("https://www.google.com/flights") {
    Err(e) => fail(e)
    Ok((v, snip)) => {
      assert_eq(v, @skills.Flight)
      assert_true(snip.read_first)
      assert_true(
        snip.playbook_name.contains("google-flights") ||
        snip.playbook_name.contains("flights"),
      )
    }
  }
  match @skills.dispatch_travel_playbook("uber to SFO") {
    Err(e) => fail(e)
    Ok((v, snip)) => {
      assert_eq(v, @skills.Rideshare)
      assert_eq(snip.playbook_name, "rideshare")
    }
  }
  match @skills.match_travel_skill_trigger("unrelated cooking recipe") {
    None => ()
    Some(_) => fail("non-travel utterance must not hit")
  }
}
