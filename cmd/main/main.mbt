///|
/// Entry point: print Bit Bot runtime boot and registered module count.
fn main {
  let n = @bitbot.module_count()
  println("Bit Bot runtime boot")
  println("registered modules: " + n.to_string())
  ignore(@bitbot.scaffold_ping())
}
