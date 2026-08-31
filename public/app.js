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
  card.querySelector(".s-meta").textContent =
    `${formatDate(s.createdAt)} · ${s.config.meetingUrl}`;

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
  let html = "";

  html += `<div class="detail-block"><h4>Ziel</h4><p>${escapeHtml(session.config.goal)}</p></div>`;

  if (report) {
    const cls = report.score >= 7 ? "good" : report.score >= 4 ? "mid" : "bad";
    html += `
      <div class="report-score">
        <div class="score-circle ${cls}">${escapeHtml(String(report.score))}</div>
        <div>
          <strong>${escapeHtml(RECOMMENDATION_LABELS[report.recommendation] || report.recommendation)}</strong>
          <p style="color: var(--muted); font-size: 13px;">${escapeHtml(report.reasoning)}</p>
        </div>
      </div>
      <div class="detail-block"><h4>Zusammenfassung</h4><p>${escapeHtml(report.summary)}</p></div>
      <div class="detail-block"><h4>Das Angebot</h4><p>${escapeHtml(report.offerDescription)}</p></div>`;
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

/* ---------- Formular ---------- */

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  formError.classList.add("hidden");
  submitBtn.disabled = true;
  submitBtn.textContent = "Starte Bot…";

  const fd = new FormData(form);
  const payload = Object.fromEntries(fd.entries());

  try {
    await api("/api/sessions", { method: "POST", body: JSON.stringify(payload) });
    form.reset();
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
