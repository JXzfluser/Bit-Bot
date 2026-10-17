///|
/// CM-2157 / FILE-04: Chart generation — structured chart output;
/// Given structured chart When acceptance Then file on disk and deliverable.
/// Kernel-contract only (Host renders real chart bytes).

///|
/// One numeric series for a structured chart.
pub(all) struct ChartSeries {
  label : String
  values : Array[Int]
} derive(Eq, Debug)

///|
pub extend ChartSeries with Eq::{equal, not_equal}

///|
pub extend ChartSeries with Debug::{to_repr}

///|
/// Structured chart spec (title + categories + series).
pub(all) struct StructuredChart {
  title : String
  /// Category / x-axis labels.
  categories : Array[String]
  series : Array[ChartSeries]
  /// Suggested output filename under /workspace/agent-tools/.
  filename : String
} derive(Eq, Debug)

///|
pub extend StructuredChart with Eq::{equal, not_equal}

///|
pub extend StructuredChart with Debug::{to_repr}

///|
pub fn StructuredChart::validate(self : StructuredChart) -> Result[Unit, String] {
  if self.title.length() == 0 {
    return Err("structured chart requires title")
  }
  if self.categories.length() == 0 {
    return Err("structured chart requires categories")
  }
  if self.series.length() == 0 {
    return Err("structured chart requires at least one series")
  }
  for s in self.series {
    if s.label.length() == 0 {
      return Err("chart series label required")
    }
    if s.values.length() != self.categories.length() {
      return Err("chart series length must match categories")
    }
  }
  Ok(())
}

///|
/// Result of chart generation: path on disk under /workspace.
pub(all) struct GeneratedChartArtifact {
  path : String
  title : String
  mime : String
  on_disk : Bool
  /// Structured payload echo for contract checks.
  structured_summary : String
} derive(Eq, Debug)

///|
pub extend GeneratedChartArtifact with Eq::{equal, not_equal}

///|
pub extend GeneratedChartArtifact with Debug::{to_repr}

///|
fn chart_svg_placeholder(title : String) -> String {
  let sb = StringBuilder()
  sb.write_string("<?xml version=\"1.0\"?><svg xmlns=\"http://www.w3.org/2000/svg\">")
  sb.write_string("BITBOT-GEN-CHART:")
  sb.write_string(title)
  sb.write_string("</svg>")
  sb.to_string()
}

///|
fn chart_summary(chart : StructuredChart) -> String {
  let sb = StringBuilder()
  sb.write_string("title=")
  sb.write_string(chart.title)
  sb.write_string(";categories=")
  sb.write_string(chart.categories.length().to_string())
  sb.write_string(";series=")
  sb.write_string(chart.series.length().to_string())
  sb.to_string()
}

///|
/// CM-2157: generate structured chart → artifact under /workspace/agent-tools/.
pub fn MediaHost::generate_chart(
  self : MediaHost,
  chart : StructuredChart,
) -> Result[GeneratedChartArtifact, String] {
  match chart.validate() {
    Err(e) => Err(e)
    Ok(_) => {
      let fname = if chart.filename.length() > 0 {
        if chart.filename.has_suffix(".svg") ||
          chart.filename.has_suffix(".png") {
          chart.filename
        } else {
          chart.filename + ".svg"
        }
      } else {
        "chart.svg"
      }
      let path = "/workspace/agent-tools/" + fname
      let bytes = chart_svg_placeholder(chart.title)
      self.files.set(path, bytes)
      self.artifacts.push(path)
      let mime = if fname.has_suffix(".png") {
        "image/png"
      } else {
        "image/svg+xml"
      }
      Ok({
        path,
        title: chart.title,
        mime,
        on_disk: true,
        structured_summary: chart_summary(chart),
      })
    }
  }
}

///|
/// CM-2157: turn on-disk chart artifact into a deliverable AttachmentRef.
pub fn deliver_generated_chart(
  host : MediaHost,
  artifact : GeneratedChartArtifact,
) -> Result[@ui_protocol.AttachmentRef, String] {
  if !artifact.on_disk || !host.exists(artifact.path) {
    return Err("GenerateChart artifact not on disk")
  }
  let fs = @ui_protocol.MockFS::new([artifact.path])
  @ui_protocol.deliverable_attachment(
    fs,
    "generated-chart.svg",
    artifact.mime,
    artifact.path,
  )
}
