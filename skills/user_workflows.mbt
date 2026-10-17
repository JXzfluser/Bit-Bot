///|
/// CM-2118: user private workflows — visible at runtime, NOT must-deliver matrix contract.
/// See docs/non-goals.md NG-003.

///|
pub(all) struct UserPrivateWorkflow {
  name : String
  description : String
  skill_md : String
} derive(Eq, Debug)

///|
pub extend UserPrivateWorkflow with Eq::{equal, not_equal}

///|
pub extend UserPrivateWorkflow with Debug::{to_repr}

///|
/// Runtime catalog of user-private workflows (observable, loadable).
pub(all) struct UserWorkflowRuntime {
  workflows : Array[UserPrivateWorkflow]
}

///|
pub fn UserWorkflowRuntime::empty() -> UserWorkflowRuntime {
  { workflows: [], }
}

///|
/// Seed representative user-private workflows (from raw inventory; non-goals).
pub fn UserWorkflowRuntime::seed_private_examples() -> UserWorkflowRuntime {
  let rt = UserWorkflowRuntime::empty()
  rt.workflows.push({
    name: "aihot-scout",
    description: "User business scout pipeline (not Bit must-deliver).",
    skill_md: "# aihot-scout\n\nUser-private workflow.\n",
  })
  rt.workflows.push({
    name: "content-research-pipeline",
    description: "User content research pipeline (not Bit must-deliver).",
    skill_md: "# content-research-pipeline\n\nUser-private workflow.\n",
  })
  rt.workflows.push({
    name: "humanizer-zh",
    description: "User humanizer skill (not Bit must-deliver).",
    skill_md: "# humanizer-zh\n\nUser-private workflow.\n",
  })
  rt
}

///|
pub fn UserWorkflowRuntime::list_visible(
  self : UserWorkflowRuntime,
) -> Array[String] {
  let out : Array[String] = []
  for w in self.workflows {
    out.push(w.name)
  }
  out
}

///|
pub fn UserWorkflowRuntime::is_visible(
  self : UserWorkflowRuntime,
  name : String,
) -> Bool {
  for w in self.workflows {
    if w.name == name {
      return true
    }
  }
  false
}

///|
pub fn UserWorkflowRuntime::read_skill_md(
  self : UserWorkflowRuntime,
  name : String,
) -> Result[String, String] {
  for w in self.workflows {
    if w.name == name {
      return Ok(w.skill_md)
    }
  }
  Err("unknown user workflow: " + name)
}

///|
/// Product must-deliver matrix contract surface (CM ids + product skill names).
/// User private workflows must NEVER appear here.
pub(all) struct MatrixMustDeliverContract {
  cm_ids : Array[String]
  product_skill_names : Array[String]
}

///|
/// Seed a representative product must-deliver contract (managed skills only).
pub fn MatrixMustDeliverContract::product_seed() -> MatrixMustDeliverContract {
  {
    cm_ids: ["CM-0501", "CM-0502", "CM-0503", "CM-0504", "CM-2108", "CM-2111"],
    product_skill_names: [
      "agent-email", "routines", "source-control", "site-playbooks",
    ],
  }
}

///|
pub fn MatrixMustDeliverContract::includes_skill(
  self : MatrixMustDeliverContract,
  name : String,
) -> Bool {
  for n in self.product_skill_names {
    if n == name {
      return true
    }
  }
  false
}

///|
pub fn MatrixMustDeliverContract::includes_cm(
  self : MatrixMustDeliverContract,
  cm_id : String,
) -> Bool {
  for id in self.cm_ids {
    if id == cm_id {
      return true
    }
  }
  false
}

///|
/// CM-2118: user private workflow names must not be written into must-deliver contract.
pub fn MatrixMustDeliverContract::contains_any_user_workflow(
  self : MatrixMustDeliverContract,
  runtime : UserWorkflowRuntime,
) -> Bool {
  for w in runtime.workflows {
    if self.includes_skill(w.name) {
      return true
    }
  }
  false
}

///|
/// Non-goal marker: user private workflows are runtime-visible ≠ product contract.
pub fn user_workflows_are_non_goal_ng003() -> Bool {
  true
}

///|
/// CM-2135: WeChat / 公众号-style user private workflows — runtime visible, NOT P0 must-deliver.
pub fn UserWorkflowRuntime::seed_wechat_and_private() -> UserWorkflowRuntime {
  let rt = UserWorkflowRuntime::seed_private_examples()
  rt.workflows.push({
    name: "wechat-cover-infographic",
    description: "User WeChat cover workflow (not Bit must-deliver native).",
    skill_md: "# wechat-cover-infographic\n\nUser-private WeChat workflow.\n",
  })
  rt.workflows.push({
    name: "wechat-title-hook",
    description: "User WeChat title hook (not Bit must-deliver native).",
    skill_md: "# wechat-title-hook\n\nUser-private WeChat workflow.\n",
  })
  rt
}

///|
/// CM-2135: whether a skill name is a user-private workflow (WeChat etc.), not product native.
pub fn UserWorkflowRuntime::is_user_private(
  self : UserWorkflowRuntime,
  name : String,
) -> Bool {
  self.is_visible(name)
}

///|
/// Product P0 must-deliver native capability surface (distinct from MatrixMustDeliverContract seed).
/// User private workflows must NEVER be written here.
pub(all) struct NativeMustDeliverP0 {
  cm_ids : Array[String]
  native_capability_names : Array[String]
}

///|
pub fn NativeMustDeliverP0::product_seed() -> NativeMustDeliverP0 {
  {
    cm_ids: ["CM-0501", "CM-0502", "CM-2111", "CM-2135"],
    native_capability_names: [
      "agent-email", "routines", "source-control", "site-playbooks",
    ],
  }
}

///|
pub fn NativeMustDeliverP0::includes_native(
  self : NativeMustDeliverP0,
  name : String,
) -> Bool {
  for n in self.native_capability_names {
    if n == name {
      return true
    }
  }
  false
}

///|
/// CM-2135: user private workflows must not be written into Bit must-deliver native / P0 matrix.
pub fn NativeMustDeliverP0::contains_any_user_workflow(
  self : NativeMustDeliverP0,
  runtime : UserWorkflowRuntime,
) -> Bool {
  for w in runtime.workflows {
    if self.includes_native(w.name) {
      return true
    }
  }
  false
}

///|
/// Attempt to elevate a user private workflow into P0 must-deliver — always refused.
pub fn NativeMustDeliverP0::try_write_user_workflow_as_native(
  self : NativeMustDeliverP0,
  runtime : UserWorkflowRuntime,
  name : String,
) -> Result[Unit, String] {
  if runtime.is_user_private(name) {
    Err(
      "user private workflow must not enter Bit must-deliver native / P0 matrix: " +
      name,
    )
  } else if self.includes_native(name) {
    Ok(())
  } else {
    Err("unknown capability: " + name)
  }
}

///|
/// CM-2135 documents NG-003 boundary alongside CM-2118.
pub fn user_private_workflows_not_kernel_must_deliver() -> Bool {
  user_workflows_are_non_goal_ng003()
}
