// ---------- Estado y utilidades ----------
let token = localStorage.getItem("homehub_token") || null;
let devicesCache = [];
let routinesCache = [];

async function api(path, options = {}) {
  const resp = await fetch("/api" + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (resp.status === 401) {
    logout();
    throw new Error("Sesión caducada");
  }
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || data.message || "Error de red");
  return data;
}

let esVoice = null;
if ("speechSynthesis" in window) {
  const pickVoice = () => {
    const voices = speechSynthesis.getVoices();
    esVoice = voices.find((v) => v.lang === "es-ES") || voices.find((v) => v.lang.startsWith("es")) || null;
  };
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}

function speakText(text) {
  if (!("speechSynthesis" in window) || !text) return;
  speechSynthesis.cancel(); // limpia la cola si se quedó atascada (bug conocido en Chrome/Android)
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "es-ES";
  if (esVoice) utter.voice = esVoice;
  speechSynthesis.speak(utter);
}

// ---------- Login ----------
const loginScreen = document.getElementById("login-screen");
const appScreen = document.getElementById("app-screen");

function showApp() {
  loginScreen.classList.add("hidden");
  appScreen.classList.remove("hidden");
  loadDevices();
  loadRoutines();
}

function showLogin() {
  appScreen.classList.add("hidden");
  loginScreen.classList.remove("hidden");
}

function logout() {
  token = null;
  localStorage.removeItem("homehub_token");
  showLogin();
}

document.getElementById("logout-btn").addEventListener("click", logout);

document.getElementById("login-btn").addEventListener("click", async () => {
  const username = document.getElementById("login-user").value.trim();
  const password = document.getElementById("login-pass").value;
  const errorEl = document.getElementById("login-error");
  errorEl.textContent = "";
  try {
    const data = await api("/auth/login", { method: "POST", body: { username, password } });
    token = data.token;
    localStorage.setItem("homehub_token", token);
    showApp();
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

if (token) showApp();

// ---------- Tabs ----------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
    btn.classList.add("active");
    document.getElementById("tab-" + btn.dataset.tab).classList.remove("hidden");
  });
});

// ---------- Voz ----------
const transcriptEl = document.getElementById("transcript");
const micBtn = document.getElementById("mic-btn");
const micStatus = document.getElementById("mic-status");

function addMessage(role, text) {
  const div = document.createElement("div");
  div.className = "msg " + role;
  div.textContent = text;
  transcriptEl.appendChild(div);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

async function sendCommand(text) {
  addMessage("user", text);
  try {
    const result = await api("/command", { method: "POST", body: { text } });
    addMessage("assistant", result.message);
    speakText(result.message);
  } catch (err) {
    addMessage("assistant", "Error: " + err.message);
  }
}

document.getElementById("text-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = document.getElementById("text-input");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  sendCommand(text);
});

const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognizer = null;
let listening = false;

if (SpeechRecognitionImpl) {
  recognizer = new SpeechRecognitionImpl();
  recognizer.lang = "es-ES";
  recognizer.continuous = false;
  recognizer.interimResults = false;

  recognizer.onresult = (event) => {
    const text = event.results[0][0].transcript;
    sendCommand(text);
  };
  recognizer.onerror = () => {
    micStatus.textContent = "No te he entendido, inténtalo de nuevo.";
  };
  recognizer.onend = () => {
    listening = false;
    micBtn.classList.remove("listening");
    micStatus.textContent = "Pulsa y habla, o escribe abajo";
  };

  micBtn.addEventListener("click", () => {
    if (listening) {
      recognizer.stop();
      return;
    }
    listening = true;
    micBtn.classList.add("listening");
    micStatus.textContent = "Escuchando…";
    recognizer.start();
  });
} else {
  micStatus.textContent = "Tu navegador no soporta reconocimiento de voz. Usa el campo de texto o prueba en Chrome/Android.";
  micBtn.disabled = true;
}

// ---------- Dispositivos ----------
const ACTIONS_BY_TYPE = {
  tv: [
    { action: "turn_on", label: "Encender" },
    { action: "turn_off", label: "Apagar" },
    { action: "volume_up", label: "Vol +" },
    { action: "volume_down", label: "Vol -" },
    { action: "mute", label: "Silenciar" },
  ],
  light: [
    { action: "turn_on", label: "Encender" },
    { action: "turn_off", label: "Apagar" },
    { action: "set_brightness", label: "50%", params: { level: 50 } },
    { action: "set_brightness", label: "100%", params: { level: 100 } },
  ],
  other: [
    { action: "turn_on", label: "Encender" },
    { action: "turn_off", label: "Apagar" },
  ],
};

async function loadDevices() {
  devicesCache = await api("/devices");
  renderDevices();
}

function renderDevices() {
  const list = document.getElementById("devices-list");
  list.innerHTML = "";
  if (devicesCache.length === 0) {
    list.innerHTML = '<p class="muted">Aún no hay dispositivos. Pulsa "Buscar dispositivos" para importarlos desde SmartThings/Tuya/Hue.</p>';
    return;
  }
  for (const d of devicesCache) {
    const card = document.createElement("div");
    card.className = "card";
    const actions = ACTIONS_BY_TYPE[d.type] || ACTIONS_BY_TYPE.other;
    card.innerHTML = `
      <div class="card-top">
        <div>
          <div class="card-title">${d.name}</div>
          <div class="card-sub">${d.room || "Sin habitación"} · ${d.provider}</div>
        </div>
        <button class="icon-btn" data-del="${d.id}">🗑️</button>
      </div>
      <div class="card-actions">
        ${actions.map((a, i) => `<button data-id="${d.id}" data-idx="${i}">${a.label}</button>`).join("")}
      </div>
    `;
    card.querySelectorAll("button[data-idx]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const a = actions[Number(btn.dataset.idx)];
        try {
          await api(`/devices/${btn.dataset.id}/action`, { method: "POST", body: { action: a.action, params: a.params } });
        } catch (err) {
          alert(err.message);
        }
      });
    });
    card.querySelector("[data-del]").addEventListener("click", async () => {
      if (!confirm(`¿Eliminar "${d.name}" de HomeHub?`)) return;
      await api(`/devices/${d.id}`, { method: "DELETE" });
      loadDevices();
    });
    list.appendChild(card);
  }
}

document.getElementById("sync-btn").addEventListener("click", async () => {
  const btn = document.getElementById("sync-btn");
  btn.disabled = true;
  btn.textContent = "Buscando…";
  try {
    const result = await api("/devices/sync", { method: "POST" });
    const summary = result.map((r) => `${r.provider}: ${r.error ? r.error : r.found + " encontrados"}`).join(" · ");
    alert(summary);
    await loadDevices();
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "🔄 Buscar dispositivos";
  }
});

// ---------- Rutinas ----------
async function loadRoutines() {
  routinesCache = await api("/routines");
  renderRoutines();
}

function renderRoutines() {
  const list = document.getElementById("routines-list");
  list.innerHTML = "";
  if (routinesCache.length === 0) {
    list.innerHTML = '<p class="muted">No tienes rutinas todavía. Crea una con "Nueva rutina".</p>';
    return;
  }
  for (const r of routinesCache) {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="card-top">
        <div>
          <div class="card-title">${r.name}</div>
          <div class="card-sub">${r.trigger_type === "cron" ? "⏰ " + r.trigger_value : "Manual"} · ${r.actions.length} acción(es)</div>
        </div>
        <button class="icon-btn" data-del="${r.id}">🗑️</button>
      </div>
      <div class="card-actions">
        <button data-run="${r.id}">▶️ Ejecutar</button>
        <button data-toggle="${r.id}" data-enabled="${r.enabled}">${r.enabled ? "⏸️ Desactivar" : "✅ Activar"}</button>
      </div>
    `;
    card.querySelector("[data-run]").addEventListener("click", async () => {
      const result = await api(`/routines/${r.id}/run`, { method: "POST" });
      if (!result.ok) alert("Algo falló al ejecutar la rutina");
    });
    card.querySelector("[data-toggle]").addEventListener("click", async () => {
      await api(`/routines/${r.id}/enabled`, { method: "PATCH", body: { enabled: !r.enabled } });
      loadRoutines();
    });
    card.querySelector("[data-del]").addEventListener("click", async () => {
      if (!confirm(`¿Eliminar la rutina "${r.name}"?`)) return;
      await api(`/routines/${r.id}`, { method: "DELETE" });
      loadRoutines();
    });
    list.appendChild(card);
  }
}

// ---------- Diálogo nueva rutina ----------
const dialog = document.getElementById("routine-dialog");
const actionsContainer = document.getElementById("routine-actions");
let actionRowCount = 0;

function addActionRow() {
  actionRowCount++;
  const row = document.createElement("div");
  row.className = "action-row";
  const deviceOptions = devicesCache.map((d) => `<option value="${d.id}">${d.name}</option>`).join("");
  row.innerHTML = `
    <select class="action-device">${deviceOptions}</select>
    <select class="action-type">
      <option value="turn_on">Encender</option>
      <option value="turn_off">Apagar</option>
      <option value="set_brightness">Brillo</option>
      <option value="volume_up">Vol +</option>
      <option value="volume_down">Vol -</option>
      <option value="mute">Silenciar</option>
    </select>
    <button type="button" class="icon-btn remove-action">✖️</button>
  `;
  row.querySelector(".remove-action").addEventListener("click", () => row.remove());
  actionsContainer.appendChild(row);
}

document.getElementById("new-routine-btn").addEventListener("click", () => {
  document.getElementById("routine-form").reset();
  actionsContainer.innerHTML = "";
  document.getElementById("cron-field").classList.add("hidden");
  addActionRow();
  dialog.showModal();
});

document.getElementById("cancel-routine-btn").addEventListener("click", () => dialog.close());
document.getElementById("add-action-btn").addEventListener("click", addActionRow);

document.getElementById("routine-trigger").addEventListener("change", (e) => {
  document.getElementById("cron-field").classList.toggle("hidden", e.target.value !== "cron");
});

document.getElementById("routine-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("routine-name").value.trim();
  const triggerType = document.getElementById("routine-trigger").value;
  const triggerValue = triggerType === "cron" ? document.getElementById("routine-cron").value.trim() : null;

  const actions = Array.from(actionsContainer.querySelectorAll(".action-row")).map((row) => ({
    deviceId: row.querySelector(".action-device").value,
    action: row.querySelector(".action-type").value,
  }));

  try {
    await api("/routines", { method: "POST", body: { name, triggerType, triggerValue, actions } });
    dialog.close();
    loadRoutines();
  } catch (err) {
    alert(err.message);
  }
});

// ---------- Service worker (PWA) ----------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
