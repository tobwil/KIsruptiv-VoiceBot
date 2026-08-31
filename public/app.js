/** Dashboard-Logik: Meetings anlegen, Status verfolgen, Berichte ansehen. */

const STATUS_LABELS = {
  created: "Erstellt",
  joining: "Wartet auf Einlass",
  in_call: "Im Meeting",
  ended: "Beendet – Bericht folgt",
  report_ready: "Bericht fertig",
  error: "Fehler",
};

const RECOMMENDATION_LABELS = {
  follow_up: "Persönlicher Kontakt lohnt sich",
  decline: "Nicht weiterverfolgen",
  unclear: "Nicht eindeutig bewertbar",
};

const ROLE_META = {
  representative: {
    label: "Stellvertreter & Filter",
    desc: "Nimmt statt dir teil, stellt deine Fragen und bewertet, ob sich ein Follow-up lohnt.",
    goalLabel: "Ziel des Meetings",
    questionsLabel: "Vordefinierte Fragen",
    criteriaLabel: "Wann ist das Thema „wertig“ genug für echten Kontakt?",
    criteriaPlaceholder: "z. B. Konkretes Produkt mit klarem Preis, Bezug zu unserem Geschäft, keine generische Kaltakquise.",
  },
  expert: {
    label: "Wissensmedium / Experte",
    desc: "Ist als Wissensquelle dabei und beantwortet Fragen aus Wissen und Dokumenten.",
    goalLabel: "Auftrag / Thema des Meetings",
    questionsLabel: "Punkte, die der Bot aktiv einbringen soll",
    criteriaLabel: "Worauf soll der Bot besonders achten?",
    criteriaPlaceholder: "z. B. Nur validierte Fakten aus den Dokumenten nennen; bei Preisfragen auf Tobias verweisen.",
  },
  moderator: {
    label: "Moderator",
    desc: "Führt durch die Agenda, achtet auf Zeit und Beteiligung, fasst Ergebnisse zusammen.",
    goalLabel: "Ziel des Meetings",
    questionsLabel: "Agenda-Punkte",
    criteriaLabel: "Worauf soll der Bot besonders achten?",
    criteriaPlaceholder: "z. B. Max. 10 Minuten pro Agenda-Punkt; am Ende müssen Verantwortlichkeiten stehen.",
  },
  mediator: {
    label: "Schlichter",
    desc: "Bleibt neutral, deeskaliert und arbeitet Gemeinsamkeiten heraus.",
    goalLabel: "Anlass / Konfliktthema",
    questionsLabel: "Punkte, die angesprochen werden sollen",
    criteriaLabel: "Worauf soll der Bot besonders achten?",
    criteriaPlaceholder: "z. B. Beide Seiten gleich viel Redezeit; Fokus auf Interessen statt Positionen.",
  },
  provocateur: {
    label: "Provokateur / Sparringspartner",
    desc: "Hinterfragt Annahmen pointiert, aber respektvoll – der Advocatus Diaboli.",
    goalLabel: "Thema / These, die geprüft werden soll",
    questionsLabel: "Einwände / Fragen, die der Bot platzieren soll",
    criteriaLabel: "Worauf soll der Bot besonders achten?",
    criteriaPlaceholder: "z. B. Business-Case und Annahmen zur Zahlungsbereitschaft hart prüfen; Ton bleibt kollegial.",
  },
  custom: {
    label: "Eigene Rolle",
    desc: "Definiere frei, wie sich der Bot verhalten soll (Rollenbeschreibung unten).",
    goalLabel: "Ziel / Auftrag des Meetings",
    questionsLabel: "Punkte/Fragen, die der Bot einbringen soll",
    criteriaLabel: "Worauf soll der Bot besonders achten?",
    criteriaPlaceholder: "z. B. Ergebnisse pro Tagesordnungspunkt festhalten.",
  },
};

const listEl = document.getElementById("sessionList");
const form = document.getElementById("createForm");
const formError = document.getElementById("formError");
const submitBtn = document.getElementById("submitBtn");

const openDetails = new Set();
let sessions = [];

/* ---------- Dev-Keys (Dev-Tab, localStorage) ---------- */

function getDevKeys() {
  try {
    return JSON.parse(localStorage.getItem("devKeys") || "{}");
  } catch {
    return {};
  }
}

function devKeyHeaders() {
  const keys = getDevKeys();
  const headers = {};
  if (keys.recallApiKey) headers["x-recall-key"] = keys.recallApiKey;
  if (keys.recallRegion) headers["x-recall-region"] = keys.recallRegion;
  if (keys.openaiApiKey) headers["x-openai-key"] = keys.openaiApiKey;
  return headers;
}

/* ---------- API mit optionalem Dashboard-Passwort ---------- */

function getKey() {
  return localStorage.getItem("dashboardKey") || "";
}

async function api(path, options = {}) {
  const doFetch = () =>
    fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(getKey() ? { "x-dashboard-key": getKey() } : {}),
        ...devKeyHeaders(),
        ...(options.headers || {}),
      },
    });

  let res = await doFetch();
  if (res.status === 401) {
    const pw = prompt("Dashboard-Passwort:");
    if (pw === null) throw new Error("Abgebrochen.");
    localStorage.setItem("dashboardKey", pw);
    res = await doFetch();
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
  return data;
}

/* ---------- Meetings-Liste ---------- */

async function loadSessions() {
  try {
    const data = await api("/api/sessions");
    sessions = data.sessions || [];
    renderList();
  } catch (err) {
    listEl.innerHTML = `<p class="error">Konnte Meetings nicht laden: ${escapeHtml(err.message)}</p>`;
  }
}

function renderList() {
  if (sessions.length === 0) {
    listEl.innerHTML = '<p class="empty">Noch keine Meetings.</p>';
    return;
  }
  listEl.innerHTML = "";
  for (const s of sessions) {
    listEl.appendChild(renderCard(s));
  }
}

function renderCard(s) {
  const tpl = document.getElementById("sessionCardTpl");
  const card = tpl.content.cloneNode(true).firstElementChild;
  card.dataset.id = s.id;

  card.querySelector(".s-botname").textContent = s.config.botName;
  const roleLabel = (ROLE_META[s.config.role] || ROLE_META.representative).label;
  card.querySelector(".s-meta").textContent =
    `${roleLabel} · ${formatDate(s.createdAt)} · ${s.config.meetingUrl}`;

  const badge = card.querySelector(".s-status");
  badge.textContent = STATUS_LABELS[s.status] || s.status;
  badge.classList.add(s.status);

  const leaveBtn = card.querySelector(".s-leave");
  if (s.status === "joining" || s.status === "in_call" || s.status === "created") {
    leaveBtn.classList.remove("hidden");
    leaveBtn.onclick = async () => {
      leaveBtn.disabled = true;
      try {
        await api(`/api/sessions/${s.id}/leave`, { method: "POST" });
        await refreshSession(s.id);
      } catch (err) {
        alert(err.message);
      } finally {
        leaveBtn.disabled = false;
      }
    };
  }

  const reportBtn = card.querySelector(".s-report");
  if ((s.status === "ended" || s.status === "error") && !s.hasReport) {
    reportBtn.classList.remove("hidden");
    reportBtn.onclick = async () => {
      reportBtn.disabled = true;
      reportBtn.textContent = "Erstelle Bericht…";
      try {
        await api(`/api/sessions/${s.id}/report`, { method: "POST" });
        await refreshSession(s.id);
      } catch (err) {
        alert(err.message);
        reportBtn.disabled = false;
        reportBtn.textContent = "Bericht erstellen";
      }
    };
  }

  const toggleBtn = card.querySelector(".s-toggle");
  const detailEl = card.querySelector(".session-detail");
  toggleBtn.onclick = async () => {
    if (openDetails.has(s.id)) {
      openDetails.delete(s.id);
      detailEl.classList.add("hidden");
      toggleBtn.textContent = "Details";
      return;
    }
    openDetails.add(s.id);
    toggleBtn.textContent = "Details ausblenden";
    detailEl.classList.remove("hidden");
    detailEl.innerHTML = '<p class="empty">Lade…</p>';
    await fillDetail(s.id, detailEl);
  };

  if (openDetails.has(s.id)) {
    toggleBtn.textContent = "Details ausblenden";
    detailEl.classList.remove("hidden");
    fillDetail(s.id, detailEl);
  }

  return card;
}

async function fillDetail(id, el) {
  try {
    const data = await api(`/api/sessions/${id}?refresh=1`);
    el.innerHTML = renderDetail(data);
  } catch (err) {
    el.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
  }
}

function renderDetail(data) {
  const { session, transcript, insights, report } = data;
  const roleMeta = ROLE_META[session.config.role] || ROLE_META.representative;
  let html = "";

  html += `<div class="detail-block"><h4>Rolle</h4><p>${escapeHtml(roleMeta.label)}</p></div>`;
  html += `<div class="detail-block"><h4>Ziel / Auftrag</h4><p>${escapeHtml(session.config.goal)}</p></div>`;

  if (report) {
    const hasScore = typeof report.score === "number";
    if (hasScore) {
      const cls = report.score >= 7 ? "good" : report.score >= 4 ? "mid" : "bad";
      html += `
        <div class="report-score">
          <div class="score-circle ${cls}">${escapeHtml(String(report.score))}</div>
          <div>
            <strong>${escapeHtml(RECOMMENDATION_LABELS[report.recommendation] || report.recommendation)}</strong>
            <p style="color: var(--md-on-surface-variant); font-size: 13px;">${escapeHtml(report.reasoning)}</p>
          </div>
        </div>`;
    } else if (report.reasoning) {
      html += `<div class="detail-block"><h4>Fazit</h4><p>${escapeHtml(report.reasoning)}</p></div>`;
    }
    html += `<div class="detail-block"><h4>Zusammenfassung</h4><p>${escapeHtml(report.summary)}</p></div>`;
    const keyPoints = report.keyPoints && report.keyPoints.length
      ? report.keyPoints
      : report.offerDescription
        ? [report.offerDescription]
        : [];
    if (keyPoints.length) {
      html += `<div class="detail-block"><h4>Kernpunkte</h4><ul>${keyPoints.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul></div>`;
    }
    if (report.nextSteps && report.nextSteps.length) {
      html += `<div class="detail-block"><h4>Nächste Schritte</h4><ul>${report.nextSteps.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul></div>`;
    }
    if (report.openQuestions && report.openQuestions.length) {
      html += `<div class="detail-block"><h4>Offene Fragen</h4><ul>${report.openQuestions.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul></div>`;
    }
  } else {
    html += `<div class="detail-block"><p class="empty">Noch kein Bericht vorhanden.</p></div>`;
  }

  if (insights && insights.length) {
    html += `<div class="detail-block"><h4>Erkenntnisse (live)</h4><ul>${insights.map((i) => `<li>${escapeHtml(i.text)}</li>`).join("")}</ul></div>`;
  }

  if (transcript && transcript.length) {
    html += `<div class="detail-block"><h4>Transkript</h4><div class="transcript">${transcript
      .map(
        (l) =>
          `<p><span class="who ${l.role}">${l.role === "bot" ? escapeHtml(session.config.botName) : "Teilnehmer"}:</span> ${escapeHtml(l.text)}</p>`,
      )
      .join("")}</div></div>`;
  }

  return html;
}

async function refreshSession(id) {
  try {
    const data = await api(`/api/sessions/${id}?refresh=1`);
    const idx = sessions.findIndex((s) => s.id === id);
    if (idx >= 0) sessions[idx] = data.session;
    renderList();
  } catch (err) {
    console.error(err);
  }
}

/* ---------- Kontext-Dokumente hochladen ---------- */

const MAX_DOCS = 5;
const docInput = document.getElementById("docInput");
const docUploadBtn = document.getElementById("docUploadBtn");
const docList = document.getElementById("docList");

let uploadedDocs = []; // { name, text, chars, truncated }

function renderDocList() {
  docList.innerHTML = "";
  for (let i = 0; i < uploadedDocs.length; i++) {
    const doc = uploadedDocs[i];
    const li = document.createElement("li");

    const icon = document.createElement("span");
    icon.className = "material-symbols-outlined";
    icon.textContent = "description";

    const name = document.createElement("span");
    name.className = "doc-name";
    name.textContent = doc.name;

    const size = document.createElement("span");
    size.className = "doc-size";
    size.textContent = `${doc.chars.toLocaleString("de-DE")} Zeichen${doc.truncated ? " (gekürzt)" : ""}`;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "doc-remove";
    remove.title = "Entfernen";
    remove.innerHTML = '<span class="material-symbols-outlined">close</span>';
    remove.addEventListener("click", () => {
      uploadedDocs.splice(i, 1);
      renderDocList();
    });

    li.append(icon, name, size, remove);
    docList.appendChild(li);
  }
  docUploadBtn.disabled = uploadedDocs.length >= MAX_DOCS;
}

async function extractDocument(file) {
  const doUpload = () => {
    const fd = new FormData();
    fd.append("file", file);
    // Kein Content-Type-Header: der Browser setzt die multipart-Boundary selbst.
    return fetch("/api/extract-text", {
      method: "POST",
      headers: {
        ...(getKey() ? { "x-dashboard-key": getKey() } : {}),
        ...devKeyHeaders(),
      },
      body: fd,
    });
  };

  let res = await doUpload();
  if (res.status === 401) {
    const pw = prompt("Dashboard-Passwort:");
    if (pw === null) throw new Error("Abgebrochen.");
    localStorage.setItem("dashboardKey", pw);
    res = await doUpload();
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
  return data;
}

docUploadBtn.addEventListener("click", () => docInput.click());

docInput.addEventListener("change", async () => {
  const files = Array.from(docInput.files || []);
  docInput.value = "";
  if (!files.length) return;
  formError.classList.add("hidden");

  for (const file of files) {
    if (uploadedDocs.length >= MAX_DOCS) {
      formError.textContent = `Maximal ${MAX_DOCS} Dokumente pro Meeting.`;
      formError.classList.remove("hidden");
      break;
    }
    const li = document.createElement("li");
    li.className = "uploading";
    li.innerHTML = `<span class="material-symbols-outlined">hourglass_top</span><span class="doc-name">${escapeHtml(file.name)}</span><span class="doc-size">wird verarbeitet…</span>`;
    docList.appendChild(li);

    try {
      const doc = await extractDocument(file);
      uploadedDocs.push(doc);
    } catch (err) {
      formError.textContent = err.message;
      formError.classList.remove("hidden");
    }
    renderDocList();
  }
});

/* ---------- Formular ---------- */

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  formError.classList.add("hidden");
  submitBtn.disabled = true;
  submitBtn.textContent = "Starte Bot…";

  const fd = new FormData(form);
  const payload = Object.fromEntries(fd.entries());
  payload.documents = uploadedDocs.map(({ name, text }) => ({ name, text }));

  try {
    await api("/api/sessions", { method: "POST", body: JSON.stringify(payload) });
    form.reset();
    uploadedDocs = [];
    renderDocList();
    updateVoiceDesc();
    applyRoleToForm();
    await loadSessions();
  } catch (err) {
    formError.textContent = err.message;
    formError.classList.remove("hidden");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Bot ins Meeting schicken";
  }
});

document.getElementById("refreshBtn").addEventListener("click", loadSessions);

/* ---------- Rollen-Auswahl: dynamische Formular-Texte ---------- */

const roleSelect = document.getElementById("roleSelect");
const roleDescEl = document.getElementById("roleDesc");
const roleDescriptionField = document.getElementById("roleDescriptionField");
const goalLabel = document.getElementById("goalLabel");
const questionsLabel = document.getElementById("questionsLabel");
const criteriaLabel = document.getElementById("criteriaLabel");
const criteriaInput = document.getElementById("criteriaInput");

function applyRoleToForm() {
  const meta = ROLE_META[roleSelect.value] || ROLE_META.representative;
  roleDescEl.textContent = meta.desc;
  goalLabel.textContent = meta.goalLabel;
  questionsLabel.textContent = meta.questionsLabel;
  criteriaLabel.textContent = meta.criteriaLabel;
  criteriaInput.placeholder = meta.criteriaPlaceholder;
  // Rollenbeschreibung: bei "Eigene Rolle" Pflicht-nah anzeigen, sonst als Option einblenden.
  roleDescriptionField.classList.toggle("hidden", roleSelect.value === "representative");
}

roleSelect.addEventListener("change", applyRoleToForm);
applyRoleToForm();

/* ---------- Stimmen-Hörbeispiel ---------- */

const VOICE_DESCRIPTIONS = {
  marin: "Natürlich und klar – von OpenAI empfohlen",
  cedar: "Warm und ruhig – von OpenAI empfohlen",
  alloy: "Neutral und ausgewogen",
  echo: "Klar und etwas tiefer",
  shimmer: "Heller, freundlicher Klang",
  verse: "Lebendig und ausdrucksstark",
};

const voiceSelect = document.getElementById("voiceSelect");
const voiceDesc = document.getElementById("voiceDesc");
const previewVoiceBtn = document.getElementById("previewVoiceBtn");
const previewVoiceIcon = document.getElementById("previewVoiceIcon");

let previewAudio = null;
let previewObjectUrl = null;

function updateVoiceDesc() {
  voiceDesc.textContent = VOICE_DESCRIPTIONS[voiceSelect.value] || "";
}

function resetPreviewButton() {
  previewVoiceBtn.classList.remove("playing");
  previewVoiceBtn.disabled = false;
  previewVoiceIcon.textContent = "play_arrow";
  previewVoiceBtn.title = "Hörbeispiel abspielen";
}

function stopPreview() {
  if (previewAudio) {
    previewAudio.pause();
    previewAudio.removeAttribute("src");
    previewAudio = null;
  }
  if (previewObjectUrl) {
    URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = null;
  }
  resetPreviewButton();
}

voiceSelect.addEventListener("change", () => {
  stopPreview();
  updateVoiceDesc();
});
updateVoiceDesc();

previewVoiceBtn.addEventListener("click", async () => {
  if (previewAudio && !previewAudio.paused) {
    stopPreview();
    return;
  }

  previewVoiceBtn.disabled = true;
  previewVoiceIcon.textContent = "hourglass_top";
  formError.classList.add("hidden");

  try {
    const language = form.elements.language.value;
    const headers = {
      "Content-Type": "application/json",
      ...(getKey() ? { "x-dashboard-key": getKey() } : {}),
      ...devKeyHeaders(),
    };
    const doFetch = () =>
      fetch("/api/voice-preview", {
        method: "POST",
        headers,
        body: JSON.stringify({ voice: voiceSelect.value, language }),
      });

    let res = await doFetch();
    if (res.status === 401) {
      const pw = prompt("Dashboard-Passwort:");
      if (pw === null) throw new Error("Abgebrochen.");
      localStorage.setItem("dashboardKey", pw);
      headers["x-dashboard-key"] = pw;
      res = await doFetch();
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Fehler ${res.status}`);
    }

    stopPreview();
    const blob = await res.blob();
    previewObjectUrl = URL.createObjectURL(blob);
    previewAudio = new Audio(previewObjectUrl);
    previewAudio.addEventListener("ended", resetPreviewButton);
    previewAudio.addEventListener("error", () => {
      stopPreview();
      formError.textContent = "Hörbeispiel konnte nicht abgespielt werden.";
      formError.classList.remove("hidden");
    });
    await previewAudio.play();
    previewVoiceBtn.disabled = false;
    previewVoiceBtn.classList.add("playing");
    previewVoiceIcon.textContent = "stop";
    previewVoiceBtn.title = "Wiedergabe stoppen";
  } catch (err) {
    stopPreview();
    formError.textContent = err.message;
    formError.classList.remove("hidden");
  }
});

/* ---------- Tabs ---------- */

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
    document.querySelectorAll(".tab-panel").forEach((panel) => {
      panel.classList.toggle("hidden", panel.id !== tab.dataset.panel);
    });
  });
});

/* ---------- Dev-Tab: Keys im localStorage verwalten ---------- */

const devForm = document.getElementById("devForm");
const devRecallKey = document.getElementById("devRecallKey");
const devRecallRegion = document.getElementById("devRecallRegion");
const devOpenaiKey = document.getElementById("devOpenaiKey");
const devStatus = document.getElementById("devStatus");

function maskKey(key) {
  if (!key) return "";
  return key.length > 8 ? `${key.slice(0, 4)}…${key.slice(-4)}` : "•••";
}

function renderDevStatus() {
  const keys = getDevKeys();
  const parts = [];
  if (keys.recallApiKey) parts.push(`Recall: ${maskKey(keys.recallApiKey)}`);
  if (keys.openaiApiKey) parts.push(`OpenAI: ${maskKey(keys.openaiApiKey)}`);
  if (keys.recallRegion) parts.push(`Region: ${keys.recallRegion}`);
  if (parts.length) {
    devStatus.classList.remove("warn");
    devStatus.textContent = `Gespeichert – ${parts.join(" · ")}`;
  } else {
    devStatus.classList.add("warn");
    devStatus.textContent = "Keine Keys im Browser gespeichert – es gelten die Server-Umgebungsvariablen.";
  }
}

function loadDevForm() {
  const keys = getDevKeys();
  devRecallKey.value = keys.recallApiKey || "";
  devRecallRegion.value = keys.recallRegion || "";
  devOpenaiKey.value = keys.openaiApiKey || "";
  renderDevStatus();
}

devForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const keys = {
    recallApiKey: devRecallKey.value.trim() || undefined,
    recallRegion: devRecallRegion.value || undefined,
    openaiApiKey: devOpenaiKey.value.trim() || undefined,
  };
  localStorage.setItem("devKeys", JSON.stringify(keys));
  renderDevStatus();
});

document.getElementById("devClearBtn").addEventListener("click", () => {
  localStorage.removeItem("devKeys");
  loadDevForm();
});

loadDevForm();

/* ---------- Auto-Polling für aktive Meetings ---------- */

setInterval(async () => {
  const active = sessions.filter((s) =>
    ["created", "joining", "in_call", "ended"].includes(s.status),
  );
  for (const s of active) {
    await refreshSession(s.id);
  }
}, 12000);

/* ---------- Hilfsfunktionen ---------- */

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

loadSessions();
