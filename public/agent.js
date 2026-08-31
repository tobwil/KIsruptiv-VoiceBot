/**
 * Agent-Seite: läuft im Chromium des Recall-Bots und wird als Kamerabild
 * ins Meeting gestreamt. Der Bot speist das Meeting-Audio als "Mikrofon"
 * in diese Seite ein; alles, was die Seite abspielt, hören die Teilnehmer.
 *
 * Ablauf:
 *  1. Kurzlebigen OpenAI-Client-Secret vom eigenen Backend holen
 *  2. WebRTC-Verbindung zur OpenAI Realtime API aufbauen
 *  3. Meeting-Audio -> OpenAI, OpenAI-Audio -> Meeting
 *  4. Transkripte/Erkenntnisse ans Backend melden, Tool-Aufrufe ausführen
 */

const params = new URLSearchParams(location.search);
const SESSION_ID = params.get("session");
const AGENT_TOKEN = params.get("token");

// Sicherheitsnetz: Bot verlässt das Meeting spätestens nach 90 Minuten.
const MAX_MEETING_MS = 90 * 60 * 1000;
// Wenn nach dem Verbinden so lange niemand spricht, stellt sich der Bot selbst vor.
const GREETING_DELAY_MS = 6000;

const statusEl = document.getElementById("status");
const botNameEl = document.getElementById("botName");
const subtitleEl = document.getElementById("subtitle");
const audioEl = document.getElementById("botAudio");

const state = {
  transcript: [], // { role: "participant" | "bot", text, ts }
  insights: [], // { text, ts }
  assessment: null,
  dirty: false,
  leaving: false,
  botSpeaking: false,
  anyInteraction: false,
};

let dataChannel = null;
let peerConnection = null;

function setStatus(text) {
  statusEl.textContent = text;
}

function setMode(mode) {
  document.body.classList.toggle("speaking", mode === "speaking");
  document.body.classList.toggle("listening", mode === "listening");
}

async function api(action, body) {
  const res = await fetch(`/api/agent/${SESSION_ID}/${action}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-agent-token": AGENT_TOKEN,
    },
    body: JSON.stringify(body || {}),
  });
  if (!res.ok) throw new Error(`API ${action} fehlgeschlagen: ${res.status}`);
  return res.json();
}

async function main() {
  if (!SESSION_ID || !AGENT_TOKEN) {
    setStatus("Fehlende Session-Parameter.");
    return;
  }

  try {
    setStatus("Hole Zugangsdaten…");
    const { clientSecret, botName, principalName } = await api("token");
    botNameEl.textContent = botName;
    if (principalName) subtitleEl.textContent = `im Auftrag von ${principalName}`;

    setStatus("Verbinde mit Sprach-KI…");
    await connectRealtime(clientSecret);

    setMode("listening");
    setStatus("Ich höre zu");

    // Falls niemand das Wort ergreift: selbst vorstellen.
    setTimeout(() => {
      if (!state.anyInteraction && dataChannel && dataChannel.readyState === "open") {
        sendEvent({ type: "response.create" });
      }
    }, GREETING_DELAY_MS);

    setInterval(flushEvents, 5000);
    setTimeout(() => leaveMeeting("Zeitlimit erreicht"), MAX_MEETING_MS);
  } catch (err) {
    console.error(err);
    setStatus("Verbindung fehlgeschlagen: " + err.message);
  }
}

async function connectRealtime(clientSecret) {
  peerConnection = new RTCPeerConnection();

  // Audio von OpenAI abspielen -> der Bot streamt es ins Meeting.
  peerConnection.ontrack = (event) => {
    audioEl.srcObject = event.streams[0];
    audioEl.play().catch(() => {});
  };

  // Meeting-Audio (vom Bot als Mikrofon bereitgestellt) an OpenAI senden.
  const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  for (const track of micStream.getAudioTracks()) {
    peerConnection.addTrack(track, micStream);
  }

  dataChannel = peerConnection.createDataChannel("oai-events");
  dataChannel.onmessage = (e) => {
    try {
      handleRealtimeEvent(JSON.parse(e.data));
    } catch (err) {
      console.error("Eventfehler:", err);
    }
  };

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);

  const sdpResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
    method: "POST",
    body: offer.sdp,
    headers: {
      Authorization: `Bearer ${clientSecret}`,
      "Content-Type": "application/sdp",
    },
  });
  if (!sdpResponse.ok) {
    throw new Error(`OpenAI-SDP-Austausch fehlgeschlagen (${sdpResponse.status})`);
  }
  await peerConnection.setRemoteDescription({ type: "answer", sdp: await sdpResponse.text() });

  await new Promise((resolve, reject) => {
    if (dataChannel.readyState === "open") return resolve();
    dataChannel.onopen = resolve;
    dataChannel.onerror = reject;
    setTimeout(() => reject(new Error("Datenkanal-Timeout")), 15000);
  });
}

function sendEvent(event) {
  if (dataChannel && dataChannel.readyState === "open") {
    dataChannel.send(JSON.stringify(event));
  }
}

function handleRealtimeEvent(event) {
  switch (event.type) {
    // Teilnehmer spricht
    case "input_audio_buffer.speech_started":
      state.anyInteraction = true;
      if (!state.botSpeaking) {
        setMode("listening");
        setStatus("Ich höre zu");
      }
      break;

    // Transkript eines Teilnehmer-Beitrags
    case "conversation.item.input_audio_transcription.completed":
      if (event.transcript && event.transcript.trim()) {
        addTranscript("participant", event.transcript.trim());
      }
      break;

    // Transkript der Bot-Antwort
    case "response.output_audio_transcript.done":
      if (event.transcript && event.transcript.trim()) {
        addTranscript("bot", event.transcript.trim());
      }
      break;

    // Bot beginnt/endet zu sprechen (WebRTC-Audiopuffer)
    case "output_audio_buffer.started":
      state.anyInteraction = true;
      state.botSpeaking = true;
      setMode("speaking");
      setStatus("");
      break;
    case "output_audio_buffer.stopped":
    case "output_audio_buffer.cleared":
      state.botSpeaking = false;
      setMode("listening");
      setStatus("Ich höre zu");
      break;

    // Antwort abgeschlossen: enthaltene Tool-Aufrufe ausführen
    case "response.done": {
      const items = (event.response && event.response.output) || [];
      for (const item of items) {
        if (item.type === "function_call") {
          handleToolCall(item).catch((err) => console.error("Toolfehler:", err));
        }
      }
      break;
    }

    case "error":
      console.error("Realtime-Fehler:", event);
      break;
  }
}

function addTranscript(role, text) {
  state.anyInteraction = true;
  state.transcript.push({ role, text, ts: Date.now() });
  state.dirty = true;
}

async function handleToolCall(item) {
  let args = {};
  try {
    args = JSON.parse(item.arguments || "{}");
  } catch {}

  if (item.name === "log_insight") {
    if (args.text) {
      state.insights.push({ text: String(args.text), ts: Date.now() });
      state.dirty = true;
    }
    // Still bestätigen, ohne eine neue Antwort auszulösen.
    sendToolOutput(item.call_id, { ok: true });
    return;
  }

  if (item.name === "submit_assessment") {
    state.assessment = {
      score: Number(args.score) || 0,
      recommendation: args.recommendation || "unclear",
      reasoning: String(args.reasoning || ""),
      nextSteps: args.next_steps ? String(args.next_steps) : undefined,
    };
    state.dirty = true;
    await flushEvents();
    // Antwort auslösen, damit der Bot sich anschließend verabschiedet.
    sendToolOutput(item.call_id, { ok: true, hint: "Bewertung gespeichert. Verabschiede dich jetzt und rufe danach leave_meeting auf." });
    sendEvent({ type: "response.create" });
    return;
  }

  if (item.name === "leave_meeting") {
    sendToolOutput(item.call_id, { ok: true });
    await waitForSpeechEnd(8000);
    await leaveMeeting("Vom Agenten beendet");
    return;
  }
}

function sendToolOutput(callId, output) {
  sendEvent({
    type: "conversation.item.create",
    item: {
      type: "function_call_output",
      call_id: callId,
      output: JSON.stringify(output),
    },
  });
}

/** Wartet, bis der Bot fertig gesprochen hat (max. timeoutMs). */
function waitForSpeechEnd(timeoutMs) {
  return new Promise((resolve) => {
    if (!state.botSpeaking) {
      // Kurze Karenz: die Verabschiedung könnte gerade erst starten.
      setTimeout(() => {
        if (!state.botSpeaking) return resolve();
        waitLoop();
      }, 1500);
    } else {
      waitLoop();
    }
    function waitLoop() {
      const start = Date.now();
      const iv = setInterval(() => {
        if (!state.botSpeaking || Date.now() - start > timeoutMs) {
          clearInterval(iv);
          resolve();
        }
      }, 250);
    }
  });
}

async function flushEvents() {
  if (!state.dirty) return;
  state.dirty = false;
  try {
    await api("events", {
      transcript: state.transcript,
      insights: state.insights,
      assessment: state.assessment,
    });
  } catch (err) {
    state.dirty = true;
    console.error("Übertragung fehlgeschlagen:", err);
  }
}

async function leaveMeeting(reason) {
  if (state.leaving) return;
  state.leaving = true;
  console.log("Verlasse Meeting:", reason);
  setStatus("Verlasse das Meeting…");
  setMode("");
  try {
    await flushEvents();
  } catch {}
  try {
    await api("leave");
  } catch (err) {
    console.error("Leave fehlgeschlagen:", err);
  }
  try {
    if (peerConnection) peerConnection.close();
  } catch {}
}

main();
