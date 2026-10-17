///|
/// CM-0803: sign-in via secret/form; transcript must not keep plaintext password.
test "acceptance_CM-0803_signin_secret_no_plaintext" {
  let password = "s3cret-P@ssw0rd"
  let lines = ["user started sign-in", "typing password field"]
  match
    @computer_use.record_signin_attempt(
      @computer_use.SecretRequest,
      password,
      lines,
    ) {
    Ok(rec) => {
      assert_eq(rec.channel, @computer_use.SecretRequest)
      assert_false(
        @computer_use.transcript_contains_plaintext_password(
          rec.transcript_lines,
          password,
        ),
      )
      for line in rec.transcript_lines {
        assert_false(line.contains(password))
      }
    }
    Err(e) => fail(e)
  }
  match
    @computer_use.record_signin_attempt(@computer_use.UserForm, password, [
      "form submitted",
    ]) {
    Ok(rec) =>
      assert_false(
        @computer_use.transcript_contains_plaintext_password(
          rec.transcript_lines,
          password,
        ),
      )
    Err(e) => fail(e)
  }
  match
    @computer_use.record_signin_attempt(@computer_use.ChatPlain, password, [
      "here is my password: " + password,
    ]) {
    Err(m) =>
      assert_true(
        m.contains("plaintext") ||
        m.contains("SecretRequest") ||
        m.contains("UserForm"),
      )
    Ok(_) => fail("ChatPlain sign-in must reject")
  }
}
