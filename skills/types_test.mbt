///|
test "skill catalog register and find" {
  let cat = @skills.SkillCatalog::empty()
  let id = @skills.SkillId::{ ns: "ops", name: "deploy", }
  cat.register(@skills.SkillMeta::{
    id,
    description: "Deploy helpers",
    enabled: true,
  })
  assert_eq(cat.len(), 1)
  assert_eq(id.qualified(), "ops/deploy")
  assert_eq(cat.find(id) is Some(_), true)
}
