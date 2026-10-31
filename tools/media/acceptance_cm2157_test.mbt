///|
/// CM-2157: Chart generation — structured chart → file on disk and deliverable.
test "acceptance_CM-2157_structured_chart_file_deliverable" {
  let host = @media.MediaHost::mock()
  let chart = @media.StructuredChart::{
    title: "Weekly Active Users",
    categories: ["Mon", "Tue", "Wed"],
    series: [{ label: "WAU", values: [10, 13, 11], }],
    filename: "wau-chart.svg",
  }
  match chart.validate() {
    Ok(_) => ()
    Err(e) => fail(e)
  }
  match host.generate_chart(chart) {
    Err(e) => fail(e)
    Ok(art) => {
      assert_true(art.on_disk)
      assert_true(art.path.has_prefix("/workspace/"))
      assert_true(art.path.has_suffix(".svg"))
      assert_eq(art.title, "Weekly Active Users")
      assert_eq(art.mime, "image/svg+xml")
      assert_true(host.exists(art.path))
      assert_true(art.structured_summary.contains("title=Weekly Active Users"))
      assert_true(art.structured_summary.contains("categories=3"))
      assert_true(art.structured_summary.contains("series=1"))
      match @media.deliver_generated_chart(host, art) {
        Err(e) => fail(e)
        Ok(att) => {
          assert_eq(att.path, art.path)
          assert_eq(att.mime, art.mime)
          match att.validate() {
            Ok(_) => ()
            Err(e) => fail(e)
          }
        }
      }
    }
  }
  match
    host.generate_chart({
      title: "",
      categories: ["a"],
      series: [{ label: "s", values: [1], }],
      filename: "x.svg",
    }) {
    Err(m) => assert_true(m.contains("title"))
    Ok(_) => fail("empty title must Err")
  }
  match
    host.generate_chart({
      title: "bad",
      categories: ["a", "b"],
      series: [{ label: "s", values: [1], }],
      filename: "bad.svg",
    }) {
    Err(m) => assert_true(m.contains("length") || m.contains("categories"))
    Ok(_) => fail("mismatched series length must Err")
  }
}
