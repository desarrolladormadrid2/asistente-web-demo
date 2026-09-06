(function () {
  "use strict";

  var STORE_KEY = "web-assistant-v1";
  var AGENT = "web-assistant";
  var USERNAME = "opencode";
  var POLL_MS = 1500;
  var DEFAULT_SERVER = "http://127.0.0.1:4500";
  var PROCESS_GUIDE =
    "[INSTRUCCION DE PROCESO: vela porque se cumpla siempre] Trabaja paso a paso y NARRA cada fase.\n" +
    "1) Antes de cada fase escribe 1 linea corta de texto: \"Editando...\", \"Subiendo a GitHub...\", \"Build en curso...\", \"Verificando despliegue...\".\n" +
    "2) Cuando despliegues, actualiza en index.html el marcador <!-- deploy:XXXX --> del <head> con el sha corto de tu commit.\n" +
    "3) JAMAS digas \"Listo\", \"Hecho\" ni \"ya esta\" hasta comprobar que la URL publica https://desarrolladormadrid2.github.io/asistente-web-demo/ devuelve 200 Y contiene el marcador nuevo (usa Invoke-WebRequest; reintenta cada 10-15 s hasta 5 min).\n" +
    "4) Verifica el contenido visible nuevo (titulo/seccion) en esa URL publica antes de confirmar nada.\n";
  var TOOL_LABELS = {
    read: "leyendo archivos",
    edit: "editando la web",
    write: "editando la web",
    bash: "ejecutando comandos",
    task: "trabajando en tareas",
    websearch: "buscando en internet",
    webfetch: "leyendo páginas web",
    github_create_or_update_file: "subiendo archivos a GitHub",
    github_push_files: "publicando en GitHub",
    github_get_file_contents: "consultando GitHub",
    github_create_repository: "creando repositorio",
    github_list_commits: "consultando git",
    git: "subiendo a GitHub",
    playwright_browser_navigate: "abriendo navegador"
  };

  function markerFrom(html) {
    var m = /<!--\s*deploy:([a-zA-Z0-9]+)\s*-->/.exec(html || "");
    return m ? m[1] : "";
  }

  var root = document.getElementById("chat-widget");
  if (!root) return;

  var state = {
    config: { server: "", directory: "" },
    serverUrl: DEFAULT_SERVER,
    password: "",
    sessionID: null,
    lastAssistId: null,
    busy: false,
    timer: null,
    deployBase: null,
    msgs: []
  };

  var els = {};

  function saveStore() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        server: state.serverUrl !== state.config.server ? state.serverUrl : "",
        password: state.password,
        sessionID: state.sessionID,
        messages: (state.msgs || []).slice(-200)
      }));
    } catch (e) {}
  }

  function loadStore() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      var s = JSON.parse(raw);
      if (s.server) state.serverUrl = s.server;
      if (s.password) state.password = s.password;
      if (s.sessionID) state.sessionID = s.sessionID;
      if (Array.isArray(s.messages)) state.msgs = s.messages;
    } catch (e) {}
  }

  function effectiveServer() {
    var q = new URLSearchParams(location.search).get("server");
    if (q) return q;
    if (state.serverUrl && state.serverUrl !== DEFAULT_SERVER) return state.serverUrl;
    if (state.config.server) return state.config.server;
    return DEFAULT_SERVER;
  }

  function authHeader() {
    return "Basic " + btoa(USERNAME + ":" + state.password);
  }

  function api(path, opts) {
    opts = opts || {};
    var url = effectiveServer() + path;
    var headers = Object.assign({}, opts.headers || {});
    if (state.password) headers["Authorization"] = authHeader();
    if (state.config.directory) headers["x-opencode-directory"] = state.config.directory;
    if (opts.body) headers["Content-Type"] = "application/json";
    return fetch(url, {
      method: opts.method || "GET",
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
  }

  function setStatus(text) {
    if (els.statusText) els.statusText.textContent = text || "";
    setDot(false);
  }
  function setDot(on) {
    if (els.dot) els.dot.classList.toggle("on", !!on);
  }

  function addMsg(kind, text) {
    var d = document.createElement("div");
    d.className = "cw-msg " + kind;
    d.textContent = text;
    els.msgs.appendChild(d);
    scrollDown();
    return d;
  }

  function renderHistory() {
    var hist = state.msgs || [];
    els.msgs.innerHTML = "";
    for (var i = 0; i < hist.length; i++) {
      var kind = hist[i] && hist[i].kind === "user" ? "user" : "bot";
      addMsg(kind, (hist[i] && hist[i].text) || "");
    }
  }

  function scrollDown() {
    els.msgs.scrollTop = els.msgs.scrollHeight;
  }

  function toast(text) {
    els.toast.textContent = text;
    els.toast.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { els.toast.classList.remove("show"); }, 2600);
  }

  function setBusy(b) {
    state.busy = b;
    els.send.disabled = b;
    els.input.disabled = b;
    if (b) {
      els.typing = document.createElement("div");
      els.typing.className = "cw-typing";
      els.typing.textContent = "El asistente está trabajando…";
      els.msgs.appendChild(els.typing);
    } else if (els.typing) {
      els.typing.remove();
      els.typing = null;
    }
    scrollDown();
  }

  function checkHealth() {
    setDot(false);
    return api("/global/health")
      .then(function (r) {
        if (r.status === 200) {
          setDot(true);
          els.statusText.textContent = "Asistente conectado";
          return true;
        }
        if (r.status === 401) els.statusText.textContent = "Revisa la contraseña en Ajustes";
        else els.statusText.textContent = "Servidor sin conexión (" + r.status + ")";
        return false;
      })
      .catch(function () {
        els.statusText.textContent = "Servidor sin conexión";
        return false;
      });
  }

  function ensureSession() {
    if (state.sessionID) {
      return api("/session/" + encodeURIComponent(state.sessionID))
        .then(function (r) { return r.status === 200; })
        .catch(function () { return false; });
    }
    return Promise.resolve(false);
  }

  function createSession() {
    return api("/session", { method: "POST", body: { title: "Web Assistant" } })
      .then(function (r) {
        if (r.status !== 200) throw new Error("create session " + r.status);
        return r.json();
      })
      .then(function (s) { state.sessionID = s.id; saveStore(); });
  }

  function lastAssistantMessages() {
    return api("/session/" + encodeURIComponent(state.sessionID) + "/message?limit=50")
      .then(function (r) {
        if (r.status !== 200) throw new Error("messages " + r.status);
        return r.json();
      })
      .then(function (list) {
        var out = [];
        for (var i = 0; i < list.length; i++) {
          var item = list[i];
          if (item.info && item.info.role === "assistant" && item.info.id !== state.lastAssistId) {
            out.push(item);
          }
        }
        out.sort(function (a, b) {
          var ta = a.info.time && a.info.time.created;
          var tb = b.info.time && b.info.time.created;
          return (ta || 0) - (tb || 0);
        });
        return out;
      });
  }

  function renderAssistant(item) {
    var text = "";
    var parts = item.parts || [];
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].type === "text" && typeof parts[i].text === "string") {
        text += parts[i].text;
      }
    }
    return text.trim();
  }

  function isComplete(item) {
    return !!(item.info && item.info.time && item.info.time.completed);
  }

  function latestToolLabel(list) {
    for (var i = list.length - 1; i >= 0; i--) {
      var item = list[i];
      var parts = item && item.parts;
      if (!parts) continue;
      for (var j = parts.length - 1; j >= 0; j--) {
        var p = parts[j];
        if (p && p.type === "tool" && p.tool) {
          var lbl = TOOL_LABELS[p.tool];
          if (lbl) return lbl;
          return p.tool.replace(/_/g, " ");
        }
      }
    }
    return "resolviendo";
  }

  function pollOnce() {
    return lastAssistantMessages().then(function (list) {
      var best = null;
      for (var i = 0; i < list.length; i++) {
        var item = list[i];
        var text = renderAssistant(item);
        if (!text) continue;
        var ts = (item.info && item.info.time) ? (item.info.time.completed || item.info.time.created || 0) : 0;
        if (!best || ts > best.ts) {
          best = {
            item: item,
            text: text,
            ts: ts,
            complete: !!(item.info && item.info.time && item.info.time.completed)
          };
        }
      }
      if (els.typing) {
        els.typing.textContent = "El asistente está trabajando… (" + latestToolLabel(list) + ")";
      }
      if (best) {
        if (els.streamingBubble) {
          els.streamingBubble.textContent = best.text;
        } else {
          els.streamingBubble = addMsg("bot", best.text);
          els.streamingBubble.classList.add("streaming");
        }
        if (best.complete) {
          els.streamingBubble.classList.remove("streaming");
          state.lastAssistId = best.item.info.id;
          state.msgs.push({ kind: "bot", text: best.text });
          saveStore();
          setBusy(false);
          els.streamingBubble = null;
          return true;
        }
      }
      return false;
    });
  }

  function waitForAnswer() {
    els.streamingBubble = null;
    var attempts = 0;
    function tick() {
      attempts++;
      pollOnce().then(function (done) {
        if (done) return;
        if (attempts > 800) { setBusy(false); addMsg("sys", "El asistente tardó demasiado. Inténtalo de nuevo."); return; }
        state.timer = setTimeout(tick, POLL_MS);
      }).catch(function (err) {
        setBusy(false);
        if (els.streamingBubble) { els.streamingBubble.remove(); els.streamingBubble = null; }
        addMsg("sys", "Error al recibir la respuesta del asistente: " + err.message);
      });
    }
    tick();
  }

  function send() {
    if (state.busy) return;
    var text = els.input.value.trim();
    if (!text) return;
    els.input.value = "";
    els.input.style.height = "auto";
    addMsg("user", text);
    state.msgs.push({ kind: "user", text: text });
    saveStore();

    setBusy(true);
    if (!state.password) {
      setBusy(false);
      toast("Añade la contraseña en Ajustes antes de escribir");
      return;
    }

    Promise.resolve()
      .then(ensureSession)
      .then(function (ok) {
        if (!ok) return createSession();
        return Promise.resolve();
      })
      .then(function () {
        return api("/session/" + encodeURIComponent(state.sessionID) + "/prompt_async", {
          method: "POST",
          body: { parts: [{ type: "text", text: PROCESS_GUIDE + "\n\n" + text }], agent: AGENT }
        });
      })
      .then(function (r) {
        if (r.status !== 204 && r.status !== 200) throw new Error("prompt " + r.status);
        return waitForAnswer();
      })
      .catch(function (err) {
        setBusy(false);
        addMsg("sys", "No se pudo enviar el mensaje (" + err.message + "). ¿Está el servidor en línea?");
      });
  }

  function openSettings() {
    els.srv.value = effectiveServer();
    els.pwd.value = state.password;
    root.classList.add("show-settings");
    els.statusText.textContent = "";
  }

  function closeSettings() {
    root.classList.remove("show-settings");
    checkHealth();
  }

  function saveSettings() {
    var srv = els.srv.value.trim();
    var pwd = els.pwd.value;
    if (srv && !/^https?:\/\//.test(srv)) srv = "http://" + srv;
    state.serverUrl = srv || DEFAULT_SERVER;
    state.password = pwd;
    saveStore();
    els.transportStatus.textContent = "Guardado";
    els.transportStatus.className = "cw-status ok";
    checkHealth();
  }

  function resetSettings() {
    state.serverUrl = DEFAULT_SERVER;
    state.password = "";
    state.sessionID = null;
    saveStore();
    els.srv.value = state.config.server || "";
    els.pwd.value = "";
    els.transportStatus.textContent = "Usará la configuración del sitio";
    els.transportStatus.className = "cw-status ok";
  }

  function newConversation() {
    state.sessionID = null;
    state.lastAssistId = null;
    saveStore();
    els.msgs.innerHTML = "";
    addMsg("sys", "Nueva conversación iniciada.");
  }

  function clearChat() {
    if (state.busy) return;
    clearTimeout(state.timer);
    state.msgs = [];
    state.sessionID = null;
    state.lastAssistId = null;
    if (els.streamingBubble) { els.streamingBubble.remove(); els.streamingBubble = null; }
    saveStore();
    els.msgs.innerHTML = "";
    els.input.value = "";
    addMsg("sys", "Chat limpiado. Empieza de nuevo cuando quieras.");
  }

  function buildDOM() {
    var fab = document.createElement("button");
    fab.className = "cw-fab";
    fab.setAttribute("aria-label", "Chat");
    fab.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3C6.5 3 2 6.9 2 11.7c0 2.7 1.4 5.1 3.6 6.7-.2 1.2-.8 2.4-1.8 3.4l-.6.6h1.4c1.7 0 3.1-.6 4.2-1.3 1 .2 2 .3 3 .3 5.5 0 10-3.9 10-8.7S17.5 3 12 3zm-4 10a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4zm4 0a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4zm4 0a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4z"/></svg>';

    var panel = document.createElement("div");
    panel.className = "cw-panel";
    panel.innerHTML =
      '<div class="cw-head">' +
        '<span class="cw-dot" id="cw-dot"></span>' +
        '<div class="cw-t">Asistente <span class="cw-sub" id="cw-substatus"></span></div>' +
        '<button class="cw-gear" id="cw-clear" title="Limpiar chat">' +
          '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M6 7h12l-.8 12.2A2 2 0 0 1 15.2 21H8.8a2 2 0 0 1-2-1.8L6 7zm3-4h6l1 2h4v2H4V5h4l1-2zM9 9h1.2l.5 9H9l-.5-9zm4.8 0H15l-.5 9h-1.7l.5-9z"/></svg>' +
        '</button>' +
        '<button class="cw-gear" id="cw-gear" title="Ajustes">⚙</button>' +
      '</div>' +
      '<div class="cw-msgs" id="cw-msgs"></div>' +
      '<div class="cw-input">' +
        '<textarea id="cw-in" rows="1" placeholder="Pide un rediseño, una pregunta, un despliegue…"></textarea>' +
        '<button id="cw-send" title="Enviar">➤</button>' +
      '</div>' +
      '<div class="cw-settings">' +
        '<div class="cw-head"><button class="cw-gear" id="cw-back" title="Volver">←</button><div class="cw-t">Ajustes</div></div>' +
        '<label for="cw-srv">Servidor del asistente (URL del túnel)</label>' +
        '<input id="cw-srv" placeholder="https://xxxx.trycloudflare.com">' +
        '<label for="cw-pwd">Contraseña del asistente</label>' +
        '<input id="cw-pwd" type="password" placeholder="••••••••">' +
        '<div class="cw-status" id="cw-tstatus"></div>' +
        '<div class="row">' +
          '<button class="btn primary" data-act="save">Guardar</button>' +
          '<button class="btn ghost" data-act="reset">Usar config del sitio</button>' +
        '</div>' +
        '<div class="row">' +
          '<button class="btn ghost" data-act="new">Nueva conversación</button>' +
          '<button class="btn ghost" data-act="test">Probar conexión</button>' +
        '</div>' +
      '</div>' +
      '<div class="cw-toast" id="cw-toast"></div>';

    root.appendChild(fab);
    root.appendChild(panel);

    els.fab = fab;
    els.panel = panel;
    els.dot = panel.querySelector("#cw-dot");
    els.substatus = panel.querySelector("#cw-substatus");
    els.statusText = panel.querySelector("#cw-substatus");
    els.msgs = panel.querySelector("#cw-msgs");
    els.input = panel.querySelector("#cw-in");
    els.send = panel.querySelector("#cw-send");
    els.clear = panel.querySelector("#cw-clear");
    els.srv = panel.querySelector("#cw-srv");
    els.pwd = panel.querySelector("#cw-pwd");
    els.transportStatus = panel.querySelector("#cw-tstatus");
    els.toast = panel.querySelector("#cw-toast");

    fab.addEventListener("click", function () {
      root.classList.toggle("open");
      if (root.classList.contains("open")) {
        root.classList.remove("show-settings");
        checkHealth();
        els.input.focus();
      }
    });

    els.send.addEventListener("click", send);
    els.clear.addEventListener("click", clearChat);
    els.input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
    });
    els.input.addEventListener("input", function () {
      els.input.style.height = "auto";
      els.input.style.height = Math.min(els.input.scrollHeight, 120) + "px";
    });

    panel.querySelector("#cw-gear").addEventListener("click", openSettings);
    panel.querySelector("#cw-back").addEventListener("click", closeSettings);

    panel.querySelectorAll(".cw-settings .btn").forEach(function (b) {
      b.addEventListener("click", function () {
        var act = b.getAttribute("data-act");
        if (act === "save") saveSettings();
        else if (act === "reset") resetSettings();
        else if (act === "new") newConversation();
        else if (act === "test") {
          els.transportStatus.textContent = "Comprobando…";
          els.transportStatus.className = "cw-status";
          checkHealth().then(function (ok) {
            els.transportStatus.textContent = ok ? "Conexión correcta" : "Sin conexión";
            els.transportStatus.className = "cw-status " + (ok ? "ok" : "err");
          });
        }
      });
    });

    document.querySelectorAll("[data-open-chat]").forEach(function (b) {
      b.addEventListener("click", function () {
        root.classList.add("open");
        checkHealth();
      });
    });
  }

  function startReloadWatch() {
    if (!/^https?:$/.test(location.protocol)) return;
    state.deployBase = markerFrom(document.documentElement.outerHTML);
    setInterval(function () {
      fetch(location.pathname + "?mt=" + Date.now(), { cache: "no-store" })
        .then(function (r) { return r.text(); })
        .then(function (txt) {
          var mk = markerFrom(txt);
          if (!state.deployBase || !mk || mk === state.deployBase) return;
          state.deployBase = mk;
          toast("Cambios publicados. Recargando la página…");
          var t = function () {
            if (state.busy) { setTimeout(t, 2000); return; }
            location.reload();
          };
          setTimeout(t, 600);
        })
        .catch(function () {});
    }, 8000);
  }

  function init() {
    buildDOM();
    loadStore();
    renderHistory();
    startReloadWatch();
    var cfgFile = root.getAttribute("data-config") || "chat-config.json";
    fetch(cfgFile, { cache: "no-store" })
      .then(function (r) { return r.status === 200 ? r.json() : {}; })
      .catch(function () { return {}; })
      .then(function (cfg) {
        state.config = cfg || {};
        if (state.config.server && !state.serverUrl) state.serverUrl = state.config.server;
        addMsg("sys", "Asistente listo. Escribe cualquier petición y le paso la orden al agente.");
        setStatus(state.config.server && !state.password ? "Configura la contraseña en Ajustes" : "Asistente…");
        setTimeout(checkHealth, 600);
      });
  }

  init();
})();