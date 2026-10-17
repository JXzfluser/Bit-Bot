///|
/// CM-2168: Channel identity — speak as user; Given speak as user When acceptance Then not third-person about the user.
test "acceptance_CM-2168_channel_speak_as_user_not_third_person" {
  let identity = @channels.ChannelSpeakAsUser::new(
    "jx_zfl",
    display_name=Some("Jenna"),
  )
  // First-person / as-user speech is Ok.
  match
    @channels.plan_channel_speak_as_user(
      identity,
      body="I'll send the report by Friday. Thanks!",
    ) {
    @channels.SpeakAsUser(body~) => {
      assert_true(body.contains("I'll"))
      assert_true(
        @channels.ChannelIdentitySpeech::SpeakAsUser(body~).is_speak_as_user(),
      )
    }
    @channels.RejectThirdPerson(reason~) => fail(reason)
  }
  match
    @channels.assert_not_third_person_about_user(
      identity, "Looking forward to the sync tomorrow.",
    ) {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  // Third-person about the user must be rejected.
  let bad = [
    "The user wants you to review this PR.", "User said please schedule the meeting.",
    "On behalf of the user I need a refund.", "jx_zfl wants the invoice resent.",
    "Jenna asked for a status update.",
  ]
  for b in bad {
    assert_true(@channels.is_third_person_about_user(b, identity))
    match @channels.plan_channel_speak_as_user(identity, body=b) {
      @channels.RejectThirdPerson(reason~) =>
        assert_true(
          reason.contains("third-person") || reason.contains("speak as user"),
        )
      @channels.SpeakAsUser(_) => fail("must reject third-person: " + b)
    }
  }
}
