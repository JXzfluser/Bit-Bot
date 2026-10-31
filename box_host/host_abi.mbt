///|
/// Target surface for a shell effect (CM-0601).
pub(all) enum ShellTarget {
  Box
  UserMachine(machine_id~ : String)
} derive(Eq, Debug)

///|
pub extend ShellTarget with Eq::{equal, not_equal}

///|
pub extend ShellTarget with Debug::{to_repr}

///|
/// Recorded shell job (mock — no real OS).
pub(all) struct ShellJob {
  id : String
  command : String
  cwd : String
  target : ShellTarget
  stdout : String
  completed : Bool
  fire_and_forget : Bool
} derive(Eq, Debug)

///|
pub extend ShellJob with Eq::{equal, not_equal}

///|
pub extend ShellJob with Debug::{to_repr}

///|
pub(all) struct ShellResult {
  job_id : String
  stdout : String
  target : ShellTarget
  completed : Bool
  /// Effective working directory after resolving working_directory param (CM-2159).
  cwd : String
} derive(Eq, Debug)

///|
pub extend ShellResult with Eq::{equal, not_equal}

///|
pub extend ShellResult with Debug::{to_repr}

///|
pub(all) struct ReadResult {
  path : String
  text : String
  line_count : Int32
} derive(Eq, Debug)

///|
pub extend ReadResult with Eq::{equal, not_equal}

///|
pub extend ReadResult with Debug::{to_repr}

///|
pub(all) struct AwaitResult {
  job_id : String
  matched : Bool
  completed : Bool
  stdout : String
  killed : Bool
} derive(Eq, Debug)

///|
pub extend AwaitResult with Eq::{equal, not_equal}

///|
pub extend AwaitResult with Debug::{to_repr}

///|
pub(all) struct ScreenshotResult {
  agent_id : String
  path : String
  read_only : Bool
  clicked : Bool
  /// True when mock FS holds PNG magic frame bytes for this shot.
  has_frame : Bool
  frame_bytes_len : Int32
  /// Live-only evidence (G-SCR / CM-0605 I). U/Mock keeps None.
  display_id : String?
  /// Placeholder on Mock; LiveDisplay only on successful Live capture path.
  frame_origin : FrameOrigin
  /// I-required when LiveDisplay; None on Mock Placeholder.
  bytes_sha256 : String?
  /// RFC3339 capture time when Live; None on Mock.
  captured_at : String?
} derive(Eq, Debug)

///|
pub extend ScreenshotResult with Eq::{equal, not_equal}

///|
pub extend ScreenshotResult with Debug::{to_repr}

///|
/// Host ABI: in-memory FS + shell jobs + per-agent desktops.
/// Backend is Mock (U) or Live (I skeleton). Live failure must NOT fall back to Mock.
/// CM-0806: session_jar holds cookie/login evidence across Update Computer.
pub(all) struct HostAbi {
  fs : Map[String, String]
  jobs : Map[String, ShellJob]
  desktops : Map[String, DesktopSession]
  box_fs : BoxFs
  mut next_job : Int32
  effects : Array[String]
  /// Cookie / login jar (domain → opaque cookie token). Survives Update.
  session_jar : Map[String, String]
  /// Installed software flag — cleared on Update (may need reinstall).
  mut software_installed : Bool
  /// G-ABI-1: Mock | Live — set at construction; never silently rewritten.
  backend : HostBackend
  /// G-ABI-2: Live side-effect audit spans (queryable for Bit验证).
  audit_spans : Array[AuditSpan]
  /// Test inject: successful Live capture bytes (None → Live screenshot Err).
  mut live_frame_inject : String?
  /// Host→Kernel UI events (G-UI-1 / H2); filled by Live HostUiShell / run_h2_probe.
  ui_events : Array[HostUiEvent]
}

///|
pub fn HostAbi::mock() -> HostAbi {
  {
    fs: Map([]),
    jobs: Map([]),
    desktops: Map([]),
    box_fs: BoxFs::default(),
    next_job: 1,
    effects: [],
    session_jar: Map([]),
    software_installed: false,
    backend: Mock,
    audit_spans: [],
    live_frame_inject: None,
    ui_events: [],
  }
}

///|
/// G-ABI-1: construct Live backend. Never degrades to Mock on construction failure.
pub fn HostAbi::live(cfg : LiveHostConfig) -> HostAbi {
  {
    fs: Map([]),
    jobs: Map([]),
    desktops: Map([]),
    box_fs: { root: "/", workspace: cfg.workspace_root, },
    next_job: 1,
    effects: [],
    session_jar: Map([]),
    software_installed: false,
    backend: Live(cfg),
    audit_spans: [],
    live_frame_inject: None,
    ui_events: [],
  }
}

///|
/// G-ABI-1: explicit backend factory (Mock or Live). Live stays Live.
pub fn HostAbi::with_backend(backend : HostBackend) -> HostAbi {
  match backend {
    Mock => HostAbi::mock()
    Live(cfg) => HostAbi::live(cfg)
  }
}

///|
pub fn HostAbi::backend_kind(self : HostAbi) -> String {
  self.backend.label()
}

///|
pub fn HostAbi::is_live(self : HostAbi) -> Bool {
  self.backend.is_live()
}

///|
/// G-ABI-2: append audit span (Live side-effects). Mock may also record for debug.
pub fn HostAbi::record_audit(self : HostAbi, span : AuditSpan) -> Unit {
  self.audit_spans.push(span)
}

///|
pub fn HostAbi::audit_span_count(self : HostAbi) -> Int32 {
  self.audit_spans.length()
}

///|
/// Inject successful Live capture bytes for unit tests (does NOT claim I-PASS).
pub fn HostAbi::inject_live_frame(
  self : HostAbi,
  frame_bytes : String,
) -> Result[Unit, String] {
  match self.backend {
    Mock =>
      Err("inject_live_frame: backend is Mock; refuse (no silent Live on Mock)")
    Live(_) => {
      self.live_frame_inject = Some(frame_bytes)
      Ok(())
    }
  }
}

///|
/// Deterministic digest for evidence fields (skeleton; Host I uses real sha256sum).
fn frame_digest_hex(bytes : String) -> String {
  let mut acc = 0
  let n = bytes.length()
  let mut i = 0
  while i < n {
    acc = acc + bytes[i].to_int() * (i + 1)
    // Keep acc bounded for stable to_string.
    if acc > 1000000000 {
      acc = acc % 1000000000
    }
    i = i + 1
  }
  "skel:" + n.to_string() + ":" + acc.to_string()
}

///|
/// CM-0606: shared BoxFs for all agents on this host instance.
pub fn HostAbi::fs_shared(self : HostAbi) -> BoxFs {
  self.box_fs
}

///|
/// CM-0606: DesktopSession per agent_id (distinct display ids).
pub fn HostAbi::desktop_for(
  self : HostAbi,
  agent_id : String,
) -> DesktopSession {
  match self.desktops.get(agent_id) {
    Some(d) => d
    None => {
      let display = ":" + self.desktops.length().to_string()
      let d : DesktopSession = { agent_id, display, browser_attached: false, }
      self.desktops.set(agent_id, d)
      d
    }
  }
}

///|
/// CM-0601: machine_id=None → box; default cwd /workspace; stdout stub.
pub fn HostAbi::shell(self : HostAbi, req : ShellRequest) -> ShellResult {
  let cwd = match req.working_directory {
    Some(d) => d
    None => self.box_fs.workspace
  }
  let target = match req.machine_id {
    None => Box
    Some(mid) => UserMachine(machine_id=mid)
  }
  let tag = match target {
    Box => "box"
    UserMachine(_) => "user_machine"
  }
  let job_id = "job-" + self.next_job.to_string()
  self.next_job = self.next_job + 1
  let fire_and_forget = req.block_until_ms == 0
  let stdout = "[mock-shell:" + tag + " cwd=" + cwd + "] " + req.command
  let completed = !fire_and_forget
  let job : ShellJob = {
    id: job_id,
    command: req.command,
    cwd,
    target,
    stdout,
    completed,
    fire_and_forget,
  }
  self.jobs.set(job_id, job)
  self.effects.push("shell:" + job_id + ":" + tag)
  { job_id, stdout, target, completed, cwd, }
}

///|
/// CM-2159: resolve effective cwd from ShellRequest (param wins; else box workspace).
pub fn ShellRequest::effective_cwd(
  self : ShellRequest,
  box_workspace~ : String = "/workspace",
) -> String {
  match self.working_directory {
    Some(d) => d
    None => box_workspace
  }
}

///|
/// Look up recorded job cwd (CM-2159).
pub fn HostAbi::job_cwd(self : HostAbi, job_id : String) -> String? {
  match self.jobs.get(job_id) {
    Some(j) => Some(j.cwd)
    None => None
  }
}

///|
fn split_lines(content : String) -> Array[String] {
  // Preserve empty trailing semantics: "" → one empty line for numbering.
  if content.length() == 0 {
    return [""]
  }
  let views = content.split("\n").to_array()
  let out : Array[String] = []
  for v in views {
    out.push(v.to_owned())
  }
  out
}

///|
fn format_lined(
  lines : Array[String],
  start_idx : Int32,
  limit : Int32?,
) -> (String, Int32) {
  let sb = StringBuilder()
  let mut emitted = 0
  let mut i = start_idx
  while i < lines.length() {
    match limit {
      Some(max) => if emitted >= max { break }
      None => ()
    }
    if emitted > 0 {
      sb.write_char('\n')
    }
    let line_no = i + 1
    sb.write_string(line_no.to_string())
    sb.write_char('|')
    sb.write_string(lines[i])
    emitted = emitted + 1
    i = i + 1
  }
  (sb.to_string(), emitted)
}

///|
/// CM-0602: line-numbered text from in-memory fs; reject missing; offset/limit.
pub fn HostAbi::read(
  self : HostAbi,
  path : String,
  offset~ : Int32? = None,
  limit~ : Int32? = None,
) -> Result[ReadResult, String] {
  match self.fs.get(path) {
    None => Err("read: path not found: " + path)
    Some(content) => {
      let lines = split_lines(content)
      // Positive offset is 1-indexed; None → start at line 1.
      let start = match offset {
        None => 0
        Some(o) =>
          if o <= 0 {
            0
          } else if o > lines.length() {
            lines.length()
          } else {
            o - 1
          }
      }
      let (text, n) = format_lined(lines, start, limit)
      self.effects.push("read:" + path)
      Ok({ path, text, line_count: n, })
    }
  }
}

///|
/// CM-0603: persist content across turns (same HostAbi instance).
pub fn HostAbi::write(self : HostAbi, path : String, content : String) -> Unit {
  self.fs.set(path, content)
  self.effects.push("write:" + path)
}

///|
/// CM-0604: await shell job; fire-and-forget jobs are never killed.
pub fn HostAbi::await_shell(
  self : HostAbi,
  job_id : String,
  pattern~ : String? = None,
  block_until_ms~ : Int32 = 30000,
) -> Result[AwaitResult, String] {
  let _ = block_until_ms
  match self.jobs.get(job_id) {
    None => Err("await_shell: unknown job " + job_id)
    Some(job) => {
      // Mark background jobs completed when awaited (observable), never kill.
      let mut completed = job.completed
      if job.fire_and_forget && !completed {
        completed = true
        let updated : ShellJob = { ..job, completed: true, }
        self.jobs.set(job_id, updated)
      }
      let matched = match pattern {
        None => true
        Some(p) => job.stdout.contains(p)
      }
      self.effects.push("await:" + job_id)
      Ok({ job_id, matched, completed, stdout: job.stdout, killed: false, })
    }
  }
}

///|
/// PNG signature bytes \x89PNG\r\n\x1a\n plus filler — mock "真实画面" evidence.
/// Real :1 display capture is Host integration; kernel proves the contract.
fn png_magic_placeholder() -> String {
  let sb = StringBuilder()
  sb.write_char('\u{89}')
  sb.write_string("PNG")
  sb.write_char('\r')
  sb.write_char('\n')
  sb.write_char('\u{1a}')
  sb.write_char('\n')
  sb.write_string("BITBOT-MOCK-FRAME")
  sb.to_string()
}

///|
/// Guess image MIME from path extension (mock Host).
fn mime_for_path(path : String) -> String? {
  if path.has_suffix(".png") {
    Some("image/png")
  } else if path.has_suffix(".jpg") || path.has_suffix(".jpeg") {
    Some("image/jpeg")
  } else if path.has_suffix(".gif") {
    Some("image/gif")
  } else if path.has_suffix(".webp") {
    Some("image/webp")
  } else {
    None
  }
}

///|
/// CM-0602 / CM-1605: image read surface — visible + optional description.
pub(all) struct ImageContent {
  path : String
  mime : String
  visible : Bool
  byte_len : Int32
  /// Human-readable description so the assistant "sees" the image (CM-1605).
  description : String
} derive(Eq, Debug)

///|
pub extend ImageContent with Eq::{equal, not_equal}

///|
pub extend ImageContent with Debug::{to_repr}

///|
/// Mock caption from path / mime (Host would run real vision).
fn describe_image_mock(
  path : String,
  mime : String,
  byte_len : Int32,
) -> String {
  let kind = if path.contains("shot") || path.contains("screenshot") {
    "screenshot"
  } else if path.contains("user") {
    "user image"
  } else {
    "image"
  }
  kind +
  " at " +
  path +
  " (" +
  mime +
  ", " +
  byte_len.to_string() +
  " bytes); visible content describable"
}

///|
/// CM-0602: read_image → ImageContent; Err if missing or non-image path.
/// CM-1605: result is visible and carries a non-empty description.
pub fn HostAbi::read_image(
  self : HostAbi,
  path : String,
) -> Result[ImageContent, String] {
  match mime_for_path(path) {
    None => Err("read_image: not an image path: " + path)
    Some(mime) =>
      match self.fs.get(path) {
        None => Err("read_image: path not found: " + path)
        Some(content) => {
          let byte_len = content.length()
          self.effects.push("read_image:" + path)
          let description = describe_image_mock(path, mime, byte_len)
          Ok({ path, mime, visible: true, byte_len, description, })
        }
      }
  }
}

///|
/// CM-1605: describe an already-read ImageContent (idempotent caption).
pub fn ImageContent::is_describable(self : ImageContent) -> Bool {
  self.visible && self.description.length() > 0
}

///|
/// CM-0605 U: write placeholder PNG magic to /workspace/.bitbot/shots/<agent>.png.
/// ScreenshotResult: read_only=true, clicked=false, has_frame / frame_bytes_len>0.
/// frame_origin=Placeholder; display_id=None. Mock-only path — Live must use
/// `screenshot_live` (no silent Placeholder-as-Live).
pub fn HostAbi::screenshot(
  self : HostAbi,
  agent_id : String,
) -> ScreenshotResult {
  match self.backend {
    Live(_) =>
      abort(
        "HostAbi::screenshot is Mock/U-only; Live backend must use screenshot_live (refusing silent Placeholder fallback)",
      )
    Mock => {
      let _desk = self.desktop_for(agent_id)
      let path = "/workspace/.bitbot/shots/" + agent_id + ".png"
      let frame = png_magic_placeholder()
      self.fs.set(path, frame)
      let frame_bytes_len = frame.length()
      self.effects.push("screenshot:" + agent_id)
      {
        agent_id,
        path,
        read_only: true,
        clicked: false,
        has_frame: frame_bytes_len > 0,
        frame_bytes_len,
        display_id: None,
        frame_origin: Placeholder,
        bytes_sha256: None,
        captured_at: None,
      }
    }
  }
}

///|
/// CM-0605 / G-SCR Live path. Succeeds only with real/injected Live frame.
/// On failure returns Err — never writes Placeholder as LiveDisplay.
pub fn HostAbi::screenshot_live(
  self : HostAbi,
  agent_id : String,
) -> Result[ScreenshotResult, String] {
  match self.backend {
    Mock =>
      Err(
        "screenshot_live: backend is Mock; use screenshot() for U Placeholder (I not claimable via Mock)",
      )
    Live(cfg) => {
      let display = match cfg.display {
        Some(d) => d
        None => {
          self.record_audit(
            AuditSpan::make(
              "screenshot_live",
              ok=false,
              detail="display not configured",
            ),
          )
          return Err(
            "screenshot_live: LiveHostConfig.display unset; refusing Placeholder fallback",
          )
        }
      }
      match self.live_frame_inject {
        None => {
          self.record_audit(
            AuditSpan::make(
              "screenshot_live",
              duration_ms=0,
              ok=false,
              detail="capture unavailable on display " + display,
            ),
          )
          Err(
            "screenshot_live: Live capture unavailable for display " +
            display +
            "; refusing silent Placeholder fallback",
          )
        }
        Some(frame) => {
          let path = cfg.workspace_root +
            "/.bitbot/shots/" +
            agent_id +
            "-live.png"
          self.fs.set(path, frame)
          let frame_bytes_len = frame.length()
          let digest = frame_digest_hex(frame)
          let captured = "2026-10-17T06:00:00Z"
          self.effects.push("screenshot_live:" + agent_id + ":" + display)
          self.record_audit(
            AuditSpan::make(
              "screenshot_live",
              duration_ms=1,
              artifact_path=Some(path),
              ok=true,
              detail="frame_origin=LiveDisplay display=" + display,
            ),
          )
          // Consume inject so a second call without re-inject fails (no sticky fake I).
          self.live_frame_inject = None
          Ok({
            agent_id,
            path,
            read_only: true,
            clicked: false,
            has_frame: frame_bytes_len > 0,
            frame_bytes_len,
            display_id: Some(display),
            frame_origin: LiveDisplay,
            bytes_sha256: Some(digest),
            captured_at: Some(captured),
          })
        }
      }
    }
  }
}

///|
/// CM-0806 / CM-1903: evidence from Update Bot's Computer (kernel-contract mock).
pub(all) struct UpdateComputerResult {
  /// Cookie/login jar still present after Update.
  session_jar_intact : Bool
  /// Software may need reinstall after Update.
  software_needs_reinstall : Bool
  /// Two confirmation steps completed before Update ran.
  two_step_confirmed : Bool
  /// Guide/Update path preferred over Reset.
  guide_before_reset : Bool
  /// Workspace files retained across Update.
  files_preserved : Bool
} derive(Eq, Debug)

///|
pub extend UpdateComputerResult with Eq::{equal, not_equal}

///|
pub extend UpdateComputerResult with Debug::{to_repr}

///|
/// CM-1903: Host UI preference — Update guide vs Reset.
pub(all) enum ComputerLifecyclePrefer {
  GuideUpdate
  Reset
} derive(Eq, Debug)

///|
pub extend ComputerLifecyclePrefer with Eq::{equal, not_equal}

///|
pub extend ComputerLifecyclePrefer with Debug::{to_repr}

///|
/// CM-1903: two-step confirmation flow for Update Bot's Computer.
pub(all) struct UpdateComputerFlow {
  mut confirm_steps : Int32
  prefer : ComputerLifecyclePrefer
  mut completed : Bool
}

///|
pub fn UpdateComputerFlow::prefer_guide() -> UpdateComputerFlow {
  { confirm_steps: 0, prefer: GuideUpdate, completed: false, }
}

///|
pub fn UpdateComputerFlow::prefer_reset() -> UpdateComputerFlow {
  { confirm_steps: 0, prefer: Reset, completed: false, }
}

///|
/// Advance one confirmation step (needs exactly two before Update may run).
pub fn UpdateComputerFlow::confirm_step(self : UpdateComputerFlow) -> Int32 {
  if self.confirm_steps < 2 {
    self.confirm_steps = self.confirm_steps + 1
  }
  self.confirm_steps
}

///|
pub fn UpdateComputerFlow::two_step_ready(self : UpdateComputerFlow) -> Bool {
  self.confirm_steps >= 2
}

///|
pub fn UpdateComputerFlow::guide_before_reset(
  self : UpdateComputerFlow,
) -> Bool {
  match self.prefer {
    GuideUpdate => true
    Reset => false
  }
}

///|
/// CM-0806: seed a mock login/cookie into the Host session jar.
pub fn HostAbi::seed_session_login(
  self : HostAbi,
  domain~ : String,
  cookie~ : String,
) -> Unit {
  self.session_jar.set(domain, cookie)
  self.effects.push("session_jar:seed:" + domain)
}

///|
/// Mark software as installed (cleared by Update — may need reinstall).
pub fn HostAbi::mark_software_installed(self : HostAbi) -> Unit {
  self.software_installed = true
}

///|
pub fn HostAbi::has_session_login(self : HostAbi, domain~ : String) -> Bool {
  match self.session_jar.get(domain) {
    Some(c) => c.length() > 0
    None => false
  }
}

///|
pub fn HostAbi::session_jar_intact(
  self : HostAbi,
  domain~ : String,
  expected_cookie~ : String,
) -> Bool {
  match self.session_jar.get(domain) {
    Some(c) => c == expected_cookie
    None => false
  }
}

///|
/// CM-0806 + CM-1903: Update Bot's Computer — preserve jar/files; clear software;
/// requires two-step confirm when flow provided; guide preferred over Reset.
pub fn HostAbi::update_computer(
  self : HostAbi,
  flow~ : UpdateComputerFlow?,
) -> Result[UpdateComputerResult, String] {
  let (two_step_confirmed, guide_before_reset) = match flow {
    None => (true, true)
    Some(f) => {
      if !f.two_step_ready() {
        return Err("Update Computer requires two-step confirmation")
      }
      if !f.guide_before_reset() {
        return Err("guide Update preferred over Reset; refuse Reset-first path")
      }
      f.completed = true
      (true, true)
    }
  }
  // Snapshot jar size before Update — jar must not be cleared.
  let jar_before = self.session_jar.length()
  // Software may need reinstall; session jar and workspace files stay.
  self.software_installed = false
  self.effects.push("update_computer")
  let jar_after = self.session_jar.length()
  Ok({
    session_jar_intact: jar_after == jar_before,
    software_needs_reinstall: !self.software_installed,
    two_step_confirmed,
    guide_before_reset,
    files_preserved: true,
  })
}
