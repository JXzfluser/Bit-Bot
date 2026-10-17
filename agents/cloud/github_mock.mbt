///|
/// Mock PR comment stored by the GitHub mock (CM-1304).
pub(all) struct MockPrComment {
  pr : String
  body : String
} derive(Eq, Debug)

///|
pub extend MockPrComment with Eq::{equal, not_equal}

///|
pub extend MockPrComment with Debug::{to_repr}

///|
pub(all) struct MockPrDiff {
  pr : String
  diff : String
} derive(Eq, Debug)

///|
pub extend MockPrDiff with Eq::{equal, not_equal}

///|
pub extend MockPrDiff with Debug::{to_repr}

///|
/// In-memory GitHub mock: create_comment + read_diff.
pub(all) struct MockGithub {
  comments : Array[MockPrComment]
  diffs : Array[MockPrDiff]
}

///|
pub fn MockGithub::new() -> MockGithub {
  { comments: [], diffs: [], }
}

///|
pub fn MockGithub::seed_diff(
  self : MockGithub,
  pr : String,
  diff : String,
) -> Unit {
  self.diffs.push({ pr, diff, })
}

///|
/// CM-1304: mock create_pr_comment.
pub fn MockGithub::create_pr_comment(
  self : MockGithub,
  pr : String,
  body : String,
) -> Result[MockPrComment, String] {
  if pr.length() == 0 {
    return Err("pr required")
  }
  if body.length() == 0 {
    return Err("body required")
  }
  let c = { pr, body, }
  self.comments.push(c)
  Ok(c)
}

///|
/// CM-1304: mock read_pr_diff.
pub fn MockGithub::read_pr_diff(
  self : MockGithub,
  pr : String,
) -> Result[String, String] {
  for d in self.diffs {
    if d.pr == pr {
      break Ok(d.diff)
    }
  } nobreak {
    Err("no diff for pr=" + pr)
  }
}

///|
pub fn MockGithub::comment_count(self : MockGithub) -> Int32 {
  self.comments.length()
}

///|
/// CM-1304 alias: create_comment → create_pr_comment.
pub fn MockGithub::create_comment(
  self : MockGithub,
  pr_number~ : Int32,
  body~ : String,
) -> Result[MockPrComment, String] {
  self.create_pr_comment(pr_number.to_string(), body)
}

///|
/// CM-1304 alias: read_diff → read_pr_diff.
pub fn MockGithub::read_diff(
  self : MockGithub,
  pr_number~ : Int32,
) -> Result[String, String] {
  self.read_pr_diff(pr_number.to_string())
}
