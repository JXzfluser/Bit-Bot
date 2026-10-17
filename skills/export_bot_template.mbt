///|
/// CM-1406: export-bot-template — shareable bot template (not team copy);
/// export pack contains no secrets.

///|
pub fn export_bot_template_skill_name() -> String {
  "export-bot-template"
}

///|
/// Source bot profile/config used to build an export pack.
pub(all) struct BotExportSource {
  bot_id : String
  name : String
  title : String
  description : String
  /// Skills / prompts included in the shareable template.
  skill_names : Array[String]
  /// Must NEVER appear in the export pack.
  secrets : Array[String]
} derive(Eq, Debug)

///|
pub extend BotExportSource with Eq::{equal, not_equal}

///|
pub extend BotExportSource with Debug::{to_repr}

///|
/// Kind of export: shareable template ≠ team copy.
pub(all) enum BotExportKind {
  ShareableTemplate
  TeamCopy
} derive(Eq, Debug)

///|
pub extend BotExportKind with Eq::{equal, not_equal}

///|
pub extend BotExportKind with Debug::{to_repr}

///|
pub fn BotExportKind::label(self : BotExportKind) -> String {
  match self {
    ShareableTemplate => "shareable-template"
    TeamCopy => "team-copy"
  }
}

///|
/// Exported pack contents (kernel-contract).
pub(all) struct BotTemplatePack {
  kind : BotExportKind
  bot_id : String
  name : String
  title : String
  description : String
  skill_names : Array[String]
  /// Serialized manifest body (must be secret-free).
  manifest : String
} derive(Eq, Debug)

///|
pub extend BotTemplatePack with Eq::{equal, not_equal}

///|
pub extend BotTemplatePack with Debug::{to_repr}

///|
fn looks_like_secret_key(s : String) -> Bool {
  let lower = s.to_lower()
  lower.contains("api_key") ||
  lower.contains("apikey") ||
  lower.contains("secret") ||
  lower.contains("token") ||
  lower.contains("password") ||
  lower.contains("private_key") ||
  lower.contains("credential")
}

///|
/// CM-1406: export shareable bot template; refuse team-copy path for this skill.
pub fn export_bot_template(
  source : BotExportSource,
) -> Result[BotTemplatePack, String] {
  if source.bot_id.length() == 0 || source.name.length() == 0 {
    return Err("export-bot-template requires bot_id and name")
  }
  let mut manifest = "kind: shareable-template\n" +
    "bot_id: " +
    source.bot_id +
    "\n" +
    "name: " +
    source.name +
    "\n" +
    "title: " +
    source.title +
    "\n" +
    "description: " +
    source.description +
    "\n" +
    "skills:\n"
  for sk in source.skill_names {
    manifest = manifest + "  - " + sk + "\n"
  }
  // Never copy secrets into the pack.
  for sec in source.secrets {
    if looks_like_secret_key(sec) || sec.length() > 0 {
      // Presence of secrets on source is fine; they must be stripped.
      ()
    }
  }
  let pack = {
    kind: ShareableTemplate,
    bot_id: source.bot_id,
    name: source.name,
    title: source.title,
    description: source.description,
    skill_names: source.skill_names,
    manifest,
  }
  match assert_pack_has_no_secrets(pack, source.secrets) {
    Err(e) => Err(e)
    Ok(_) => Ok(pack)
  }
}

///|
/// Explicitly refuse exporting as a team copy via this skill.
pub fn export_as_team_copy(
  _source : BotExportSource,
) -> Result[BotTemplatePack, String] {
  Err("export-bot-template exports shareable template, not team copy")
}

///|
/// CM-1406: pack must not contain any secret values from the source.
pub fn assert_pack_has_no_secrets(
  pack : BotTemplatePack,
  secrets : Array[String],
) -> Result[Unit, String] {
  if pack.kind != ShareableTemplate {
    return Err("pack must be shareable-template, not team-copy")
  }
  for sec in secrets {
    if sec.length() == 0 {
      continue
    }
    if pack.manifest.contains(sec) {
      return Err("export pack contains secret material")
    }
    if pack.name.contains(sec) ||
      pack.title.contains(sec) ||
      pack.description.contains(sec) {
      return Err("export pack fields contain secret material")
    }
    for sk in pack.skill_names {
      if sk.contains(sec) {
        return Err("export pack skill list contains secret material")
      }
    }
  }
  // Also reject secret-like keys in manifest.
  if looks_like_secret_key(pack.manifest) &&
    (
      pack.manifest.contains("api_key") ||
      pack.manifest.contains("token=") ||
      pack.manifest.contains("secret:")
    ) {
    return Err("export pack manifest looks secret-bearing")
  }
  Ok(())
}

///|
pub fn BotTemplatePack::is_shareable_not_team_copy(
  self : BotTemplatePack,
) -> Bool {
  self.kind == ShareableTemplate
}
