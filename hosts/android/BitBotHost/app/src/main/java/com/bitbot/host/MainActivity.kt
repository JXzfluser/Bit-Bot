package com.bitbot.host

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
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
 */
class MainActivity : ComponentActivity() {
  private val permissionLauncher =
    registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { /* Host only; no auto-ok */ }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setContent {
      MaterialTheme {
        var input by remember { mutableStateOf("ListMachines") }
        var transcript by remember {
          mutableStateOf("Bit Bot Android Host\nMachineKind=android\nMoonBit brain via TurnBridge.\n")
        }
        var busy by remember { mutableStateOf(false) }
        val scope = rememberCoroutineScope()
        Column(
          Modifier
            .fillMaxSize()
            .padding(16.dp)
            .verticalScroll(rememberScrollState()),
        ) {
          Text("Bit Bot", style = MaterialTheme.typography.headlineLarge)
          Text("Android Host · MoonBit turn v:1", style = MaterialTheme.typography.bodyMedium)
          Text(transcript, fontFamily = FontFamily.Monospace, modifier = Modifier.padding(vertical = 12.dp))
          OutlinedTextField(
            value = input,
            onValueChange = { input = it },
            label = { Text("Turn text") },
            modifier = Modifier.padding(bottom = 8.dp),
          )
          Button(
            enabled = !busy && input.isNotBlank(),
            onClick = {
              scope.launch {
                busy = true
                val text = input
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
                val cardNote = if (cards.isEmpty()) "" else
                  "\n[host permission cards pretend_granted=false] " +
                    cards.joinToString { "${it.tool}:${it.status}" }
                transcript += "\n> $text\n$body$cardNote\n"
                busy = false
              }
            },
          ) {
            Text(if (busy) "…" else "Send")
          }
        }
      }
    }
  }
}
