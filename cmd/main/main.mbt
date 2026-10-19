///|
/// Entry point: print Bit Bot runtime boot, module list, and I inventory.
fn main {
  println(@bitbot.boot_banner())
  ignore(@bitbot.scaffold_ping())
}
