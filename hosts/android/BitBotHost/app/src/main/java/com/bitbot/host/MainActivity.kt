package com.bitbot.host

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Android Host shell — MoonBit (`cmd/desktop_turn`) is the product brain.
 * This activity only bridges user text → Host FFI via [TurnBridge].
 * CM-0705: device_permission raises a real OS permission request (never pretend-granted).
 * CHARTER Delivery: [SendToUserSurface] chips mirror Desktop without inventing live posts.
 * Product quick actions mirror Desktop Plugins/Media/Voice/Box panels (multi-end HostAbi).
 */
class MainActivity : ComponentActivity() {
  private val permissionLauncher =
    registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { /* Host only; no auto-ok */ }

  /** label → MoonBit turn text (Host FFI only; no LocalBrain). */
  private val productActions =
    listOf(
      "ListMachines" to "ListMachines",
      "List plugins" to "list plugins",
      "Get plugin" to "get plugin plugin-slides",
      "Gen image" to "generate image android aurora",
      "Chart" to "structured chart {\"alpha\":3,\"beta\":5}",
      "Slides" to "make slides title=AndroidParity",
      "Markdown" to "render markdown Inline \\(E=mc^2\\) and $$a^2+b^2=c^2$$",
      "Voice start" to "voice start android-voice",
      "Draft mail" to "draft mail to=android@example.com subject=Ping body=Hello",
      "Schedule" to "schedule meeting title=AndroidSync at=2026-11-01T10:00:00Z",
      "Purchase" to "purchase item=AndroidWidget cents=299",
      "Slack draft" to "reply via slack:Candroid :: android draft",
      "Teams draft" to "reply via teams:Tandroid :: android teams draft",
      "Finance" to "finance get_balance",
      "Jobs" to "job search engineer",
      "X search" to "x search moonbit",
      "Workflows" to "list workflows",
      "Credentials" to "list credentials",
      "React" to "react message msg=msg-android emoji=👍",
      "Screenshot" to "screenshot agent=executor",
      "Check updates" to "check updates",
      "Cloud launch" to "launch cloud agent triage android",
      "Routines" to "list routines",
      "Tick routines" to "tick routines",
      "Shell" to "shell echo android-tools",
      "Listdir" to "listdir docs",
      "Read" to "read README.mbt.md",
      "WebFetch" to "webfetch https://example.com",
      "CU open" to "computer use open https://example.com",
      "Remember" to "remember android_panel=ready",
      "Cold mail" to "cold mail to=android@example.com subject=Hi body=Android cold unsubscribe=mailto:unsub@example.com",
      "On behalf" to "send on behalf to=boss@example.com subject=Update body=Android on-behalf",
      "Claim inbox" to "claim inbox alpha",
      "Author skill" to "author skill name=android-skill description=demo body=Do the thing.",
      "Export bot" to "export bot template id=bot-android name=AndroidBot",
      "Device tools" to "device tools",
      "Journal" to "journal query hello",
      "Copy to box" to "copy to box machine=phone-android src=README.mbt.md dest=/workspace/uploads/README.mbt.md",
      "MCP discover" to "mcp discover",
      "MCP call" to "mcp call user-Gmail.search_threads {}",
      "Subagent" to "spawn subagent summarize inbox",
      "Travel" to "travel expedia.com",
      "Order food" to "order food doordash.com",
      "Package install" to "package install cowsay",
      "List agents" to "list agents",
      "Hide agent" to "hide agent research",
      "Notify" to "notify settings assistant=asst-alpha",
      "Update computer" to "update computer",
      "Shared box" to "shared box fs",
      "Section post" to "section post group=g1 section=sec-a from=asst-1 body=hello",
      "Meeting chat" to "meeting chat body=stand-up update direct=1",
      "Learn demo" to "learn from demo title=Checkout steps=click:Cart|type:email",
      "Fill credential" to "fill credential domain=login.example.test",
      "Read mail" to "read mail t-invoice-1",
      "Pause routine" to "pause routine smoke-r",
      "Resume routine" to "resume routine smoke-r",
      "Add section" to "add section group=g1 id=sec-a title=alpha",
      "Connect finance" to "connect finance",
      "Book flight" to "book flight google.com/flights",
      "Journal append" to "journal date=2026-10-17 id=e1 body=hello journal",
      "Personal DM" to "personal slack dm owner=Uowner text=ping",
      "Channel plan" to "channel plan body=stay in chat only",
      "Bare chrome" to "launch bare chrome",
      "Install npm" to "install package npm left-pad@1.3.0",
      "Members group" to "open members group=group-1",
      "Journal range" to "query journal from=2026-10-01 to=2026-10-31",
      "Box doctor" to "box doctor",
      "Box env" to "box env",
      "Chrome probe" to "box chrome probe",
    )

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setContent {
      MaterialTheme {
        var input by remember { mutableStateOf("ListMachines") }
        var transcript by remember {
          mutableStateOf("Bit Bot Android Host\nMachineKind=android\nMoonBit brain via TurnBridge.\n")
        }
        var busy by remember { mutableStateOf(false) }
        var delivery by remember { mutableStateOf(SendToUserSurface.Summary()) }
        val scope = rememberCoroutineScope()

        fun runProductTurn(text: String) {
          scope.launch {
            busy = true
            input = text
            val result = withContext(Dispatchers.IO) {
              runCatching { TurnBridge.runTurn(text, machineKind = "android") }
            }
            val body = result.fold(
              onSuccess = { it },
              onFailure = { "! ${it.message}" },
            )
            // CM-0705: Host raises OS permission dialogs for device_permission cards.
            val cards = DevicePermissionHost.cardsFromTurnJson(this@MainActivity, body)
            val need = cards.mapNotNull { it.androidPermission }.distinct().toTypedArray()
            if (need.isNotEmpty()) {
              permissionLauncher.launch(need)
            }
            val summary = SendToUserSurface.extract(body)
            delivery = summary
            val strip = SendToUserSurface.formatStrip(summary)
            val cardNote = if (cards.isEmpty()) "" else
              "\n[host permission cards pretend_granted=false] " +
                cards.joinToString {
                  "${it.tool}:${it.status}" +
                    (it.cardPath?.let { p -> " card=$p" } ?: "")
                }
            transcript += "\n> $text\n$body$strip$cardNote\n"
            busy = false
          }
        }

        Column(
          Modifier
            .fillMaxSize()
            .padding(16.dp)
            .verticalScroll(rememberScrollState()),
        ) {
          Text("Bit Bot", style = MaterialTheme.typography.headlineLarge)
          Text("Android Host · MoonBit turn v:1", style = MaterialTheme.typography.bodyMedium)
          if (delivery.labels.isNotEmpty() || delivery.attachments.isNotEmpty()) {
            Column(Modifier = Modifier.padding(vertical = 6.dp)) {
              if (delivery.labels.isNotEmpty()) {
                Row(Modifier = Modifier.horizontalScroll(rememberScrollState())) {
                  delivery.labels.take(12).forEach { label ->
                    Surface(
                      tonalElevation = 2.dp,
                      shape = MaterialTheme.shapes.small,
                      modifier = Modifier.padding(end = 6.dp),
                    ) {
                      Text(
                        label,
                        style = MaterialTheme.typography.labelSmall,
                        fontFamily = FontFamily.Monospace,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                      )
                    }
                  }
                }
              }
              if (delivery.attachments.isNotEmpty()) {
                Row(
                  Modifier
                    .horizontalScroll(rememberScrollState())
                    .padding(top = 4.dp),
                ) {
                  delivery.attachments.take(8).forEach { att ->
                    val leaf = att.path.substringAfterLast('/')
                    Surface(
                      tonalElevation = 1.dp,
                      shape = MaterialTheme.shapes.small,
                      modifier = Modifier.padding(end = 6.dp),
                    ) {
                      Text(
                        "${att.role}:$leaf",
                        style = MaterialTheme.typography.labelSmall,
                        fontFamily = FontFamily.Monospace,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                      )
                    }
                  }
                }
              }
            }
          }
          Row(
            Modifier
              .horizontalScroll(rememberScrollState())
              .padding(vertical = 6.dp),
          ) {
            productActions.forEach { (label, turn) ->
              Button(
                enabled = !busy,
                onClick = { runProductTurn(turn) },
                modifier = Modifier.padding(end = 6.dp),
              ) {
                Text(label, style = MaterialTheme.typography.labelSmall)
              }
            }
          }
          Text(transcript, fontFamily = FontFamily.Monospace, modifier = Modifier.padding(vertical = 12.dp))
          OutlinedTextField(
            value = input,
            onValueChange = { input = it },
            label = { Text("Turn text") },
            modifier = Modifier.padding(bottom = 8.dp),
          )
          Button(
            enabled = !busy && input.isNotBlank(),
            onClick = { runProductTurn(input) },
          ) {
            Text(if (busy) "…" else "Send")
          }
        }
      }
    }
  }
}
