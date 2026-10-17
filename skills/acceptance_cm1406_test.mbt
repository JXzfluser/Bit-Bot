///|
/// CM-1406: export-bot-template — shareable bot template (not team copy);
/// export pack contains no secrets.
test "acceptance_CM-1406_export_bot_template_no_secrets" {
  assert_eq(@skills.export_bot_template_skill_name(), "export-bot-template")
  let source : @skills.BotExportSource = {
    bot_id: "bot-42",
    name: "Research Bot",
    title: "researcher",
    description: "Helps with literature review",
    skill_names: ["agent-email", "routines"],
    secrets: [
      "sk-live-SUPERSECRETTOKEN", "api_key=ABCDEF123456", "oauth_refresh_token_xyz",
    ],
  }
  match @skills.export_bot_template(source) {
    Ok(pack) => {
      assert_true(pack.is_shareable_not_team_copy())
      assert_eq(pack.kind, @skills.BotExportKind::ShareableTemplate)
      assert_eq(pack.bot_id, "bot-42")
      assert_eq(pack.name, "Research Bot")
      assert_eq(pack.skill_names.length(), 2)
      assert_true(pack.manifest.contains("shareable-template"))
      assert_false(pack.manifest.contains("sk-live-SUPERSECRETTOKEN"))
      assert_false(pack.manifest.contains("ABCDEF123456"))
      assert_false(pack.manifest.contains("oauth_refresh_token_xyz"))
      match @skills.assert_pack_has_no_secrets(pack, source.secrets) {
        Ok(_) => ()
        Err(e) => fail(e)
      }
    }
    Err(e) => fail(e)
  }
  // Not a team copy.
  match @skills.export_as_team_copy(source) {
    Err(m) =>
      assert_true(
        m.contains("shareable") ||
        m.contains("not team copy") ||
        m.contains("team copy"),
      )
    Ok(_) => fail("export-bot-template must not produce team copy")
  }
}
