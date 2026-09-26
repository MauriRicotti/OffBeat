/* OffBeat — Etapa 3: biblioteca local (MediaStore) + reproductor */
(function () {
  "use strict";

  const isNative = typeof window.Capacitor !== "undefined";
  const MediaScanner = isNative
    ? window.Capacitor.Plugins.MediaScanner
    : undefined;

  const $ = (id) => document.getElementById(id);
  const views = {
    permission: $("view-permission"),
    loading: $("view-loading"),
    library: $("view-library"),
    player: $("view-player"),
    web: $("view-web"),
  };
  const audio = $("audio");

  const state = {
    tracks: [],
    filtered: [],
    permission: "unknown", // unknown | granted | denied
    artCache: new Map(), // albumId -> dataURL | null
    queue: [], // snapshot de la lista que se está reproduciendo
    index: -1, // posición actual en queue
    view: "permission",
  };

  function show(name) {
    state.view = name;
    for (const [key, el] of Object.entries(views)) el.hidden = key !== name;
    syncMini();
  }

  function syncMini() {
    const visible = state.index >= 0 && state.view === "library";
    $("mini-player").hidden = !visible;
    document.body.classList.toggle("has-mini", visible);
  }

  function fmtDuration(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    return fmtClock(total);
  }

  function fmtClock(sec) {
    const total = Math.max(0, Math.floor(sec || 0));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m + ":" + String(s).padStart(2, "0");
  }

  let toastTimer = null;
  function toast(msg) {
    const el = $("toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 1800);
  }

  // ---------- Permiso ----------
  async function ensurePermission() {
    if (state.permission === "granted") return true;
    try {
      const res = await MediaScanner.requestPermission();
      state.permission = res.granted ? "granted" : "denied";
      $("permission-denied").hidden = !!res.granted;
      $("btn-permission").textContent = res.granted
        ? "Escanear biblioteca"
        : "Reintentar";
      return !!res.granted;
    } catch (err) {
      console.error("Error al pedir el permiso:", err);
      toast("No se pudo pedir el permiso");
      return false;
    }
  }

  // ---------- Escaneo ----------
  async function scan() {
    show("loading");
    try {
      const res = await MediaScanner.scanLibrary();
      state.tracks = Array.isArray(res.tracks) ? res.tracks : [];
      $("search").value = "";
      state.filtered = state.tracks;
      show("library"); // mostrar antes de renderizar (para medir altura de fila)
      renderList();
    } catch (err) {
      console.error(err);
      toast("No se pudo leer la biblioteca");
      show("permission");
    }
  }

  // ---------- Render ----------
  function renderList() {
    const list = $("track-list");
    list.innerHTML = "";

    if (state.filtered.length === 0) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = "Sin resultados.";
      list.appendChild(li);
    }

    state.filtered.forEach((t, i) => {
      list.appendChild(buildRow(t, i));
    });

    const total = state.tracks.length;
    const shown = state.filtered.length;
    $("lib-footer").textContent =
      (shown === total
        ? total + " canciones"
        : shown + " de " + total + " canciones") + " · local, sin conexión";

    loadArtForVisibleRows();
    updatePlayingRow();
  }

  function buildRow(t, i) {
    const li = document.createElement("li");
    li.className = "track";
    li.dataset.trackId = String(t.id);

    const art = document.createElement("div");
    art.className = "track-art";
    art.dataset.albumId = t.albumId;
    art.dataset.loaded = "0";

    const info = document.createElement("div");
    info.className = "track-info";

    const title = document.createElement("div");
    title.className = "track-title";
    title.textContent = t.title;
    title.title = t.title;

    const meta = document.createElement("div");
    meta.className = "track-meta";
    meta.textContent = [t.artist, t.album].filter(Boolean).join(" · ");

    info.append(title, meta);

    const dur = document.createElement("div");
    dur.className = "track-duration";
    dur.textContent = fmtDuration(t.durationMs);

    li.append(art, info, dur);

    li.addEventListener("click", () => {
      const cur = current();
      // Si es la pista que ya está sonando: solo abrir el reproductor.
      if (cur && String(cur.id) === li.dataset.trackId && audio.src) {
        show("player");
        return;
      }
      playTrackList(state.filtered, i);
    });

    return li;
  }

  function updatePlayingRow() {
    const cur = current();
    document.querySelectorAll("#track-list .track").forEach((li) => {
      li.classList.toggle(
        "playing",
        !!cur && li.dataset.trackId === String(cur.id)
      );
    });
  }

  // ---------- Carátulas: lazy (solo lo visible) y cacheadas por álbum ----------
  function loadArtForVisibleRows() {
    const rows = document.querySelectorAll(".track-art[data-loaded='0']");
    const inFlight = new Set();
    const viewport = window.innerHeight * 1.5;

    rows.forEach((el) => {
      const top = el.getBoundingClientRect().top;
      if (top < 0 || top > viewport) return; // fuera de pantalla: después
      const albumId = el.dataset.albumId;
      if (inFlight.has(albumId)) return;
      inFlight.add(albumId);

      fetchArt(albumId).then((dataUrl) => {
        if (!dataUrl) return;
        document
          .querySelectorAll(
            ".track-art[data-loaded='0'][data-album-id='" + albumId + "']"
          )
          .forEach((target) => {
            target.style.backgroundImage = "url(" + dataUrl + ")";
            target.classList.add("has-art");
            target.dataset.loaded = "1";
          });
      });
    });
  }

  function fetchArt(albumId) {
    const key = String(albumId);
    if (state.artCache.has(key)) return Promise.resolve(state.artCache.get(key));
    return MediaScanner.getAlbumArt({ albumId: Number(albumId) })
      .then((res) => {
        // data URL completo: "data:" + mime + ";base64," + datos
        const dataUrl =
          res && res.hasArt && res.data
            ? "data:" + (res.mime || "image/jpeg") + ";base64," + res.data
            : null;
        state.artCache.set(key, dataUrl);
        return dataUrl;
      })
      .catch((e) => {
        console.warn("Sin carátula para el álbum " + albumId, e);
        state.artCache.set(key, null);
        return null;
      });
  }

  function setArt(el, albumId) {
    fetchArt(albumId).then((dataUrl) => {
      if (dataUrl) {
        el.style.backgroundImage = "url(" + dataUrl + ")";
        el.classList.add("has-art");
      } else {
        el.style.backgroundImage = "";
        el.classList.remove("has-art");
      }
    });
  }

  let scrollTicking = false;
  window.addEventListener(
    "scroll",
    () => {
      if (scrollTicking) return;
      scrollTicking = true;
      requestAnimationFrame(() => {
        loadArtForVisibleRows();
        scrollTicking = false;
      });
    },
    { passive: true }
  );

  // ---------- Búsqueda ----------
  $("search").addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    state.filtered = q
      ? state.tracks.filter((t) =>
          [t.title, t.artist, t.album].some(
            (v) => v && v.toLowerCase().includes(q)
          )
        )
      : state.tracks;
    renderList();
  });

  // ---------- Reproductor (Etapa 3) ----------
  function current() {
    return state.index >= 0 && state.index < state.queue.length
      ? state.queue[state.index]
      : null;
  }

  function playTrackList(list, i) {
    state.queue = list.slice();
    playIndex(i);
  }

  function playIndex(i) {
    if (i < 0 || i >= state.queue.length) return;
    const t = state.queue[i];
    if (!t || !t.path) {
      toast("Archivo no disponible");
      return;
    }
    state.index = i;
    // convertFileSrc sirve el archivo local vía el servidor interno de
    // Capacitor (/_capacitor_file_/...) para poder usarlo en <audio>.
    audio.src = window.Capacitor.convertFileSrc
      ? window.Capacitor.convertFileSrc(t.path)
      : t.path;
    audio.play().catch((err) => {
      console.error("No se pudo reproducir:", err);
      toast("No se pudo reproducir");
    });
    renderPlayer();
  }

  function renderPlayer() {
    const t = current();
    if (!t) return;

    $("player-title").textContent = t.title || "Sin título";
    $("player-artist").textContent = [t.artist, t.album]
      .filter(Boolean)
      .join(" · ");
    $("time-total").textContent = fmtClock((t.durationMs || 0) / 1000);
    $("time-current").textContent = "0:00";
    $("progress-fill").style.width = "0%";
    $("progress-thumb").style.left = "0%";

    $("mini-title").textContent = t.title || "Sin título";
    setArt($("player-art"), t.albumId);
    setArt($("mini-art"), t.albumId);

    syncPlayIcons();
    updatePlayingRow();
    syncMini();
  }

  function togglePlay() {
    if (!current()) return;
    if (audio.paused) {
      audio.play().catch((err) => {
        console.error(err);
        toast("No se pudo reproducir");
      });
    } else {
      audio.pause();
    }
  }

  function syncPlayIcons() {
    const playing = current() && !audio.paused;
    $("icon-play").hidden = !!playing;
    $("icon-pause").hidden = !playing;
    $("mini-icon-play").hidden = !!playing;
    $("mini-icon-pause").hidden = !playing;
  }

  audio.addEventListener("play", syncPlayIcons);
  audio.addEventListener("pause", syncPlayIcons);
  audio.addEventListener("timeupdate", () => {
    const fallback = current() ? (current().durationMs || 0) / 1000 : 0;
    const dur = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : fallback;
    const pct = dur ? Math.min(100, (audio.currentTime / dur) * 100) : 0;
    if (!scrubbing) {
      $("progress-fill").style.width = pct + "%";
      $("progress-thumb").style.left = pct + "%";
      $("time-current").textContent = fmtClock(audio.currentTime);
    }
    $("mini-fill").style.width = pct + "%";
  });
  audio.addEventListener("loadedmetadata", () => {
    if (isFinite(audio.duration) && audio.duration > 0) {
      $("time-total").textContent = fmtClock(audio.duration);
    }
  });
  audio.addEventListener("ended", () => {
    if (state.index + 1 < state.queue.length) {
      playIndex(state.index + 1);
    } else {
      syncPlayIcons();
      $("mini-fill").style.width = "0%";
    }
  });
  audio.addEventListener("error", () => {
    if (audio.src) toast("No se pudo reproducir este archivo");
    syncPlayIcons();
  });

  $("btn-play").addEventListener("click", togglePlay);
  $("mini-toggle").addEventListener("click", (e) => {
    e.stopPropagation();
    togglePlay();
  });
  $("btn-prev").addEventListener("click", () => {
    if (audio.currentTime > 3 || state.index <= 0) {
      audio.currentTime = 0;
    } else {
      playIndex(state.index - 1);
    }
  });
  $("btn-next").addEventListener("click", () => {
    if (state.index + 1 < state.queue.length) {
      playIndex(state.index + 1);
    } else {
      toast("No hay más canciones");
    }
  });

  $("btn-close-player").addEventListener("click", () => show("library"));
  $("mini-open").addEventListener("click", () => {
    if (current()) show("player");
  });

  // ---------- Barra de progreso (tap + arrastre) ----------
  let scrubbing = false;

  function seekPctFromEvent(e) {
    const track = $("progress").querySelector(".progress-track");
    const rect = track.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  }

  function paintProgress(pct) {
    $("progress-fill").style.width = pct * 100 + "%";
    $("progress-thumb").style.left = pct * 100 + "%";
    const dur = isFinite(audio.duration) ? audio.duration : 0;
    $("time-current").textContent = fmtClock(pct * (dur || 0));
  }

  $("progress").addEventListener("pointerdown", (e) => {
    if (!current()) return;
    scrubbing = true;
    $("progress").classList.add("scrubbing");
    $("progress").setPointerCapture(e.pointerId);
    paintProgress(seekPctFromEvent(e));
  });
  $("progress").addEventListener("pointermove", (e) => {
    if (scrubbing) paintProgress(seekPctFromEvent(e));
  });
  $("progress").addEventListener("pointerup", (e) => {
    if (!scrubbing) return;
    scrubbing = false;
    $("progress").classList.remove("scrubbing");
    const pct = seekPctFromEvent(e);
    if (isFinite(audio.duration) && audio.duration > 0) {
      audio.currentTime = pct * audio.duration;
    }
  });
  $("progress").addEventListener("pointercancel", () => {
    scrubbing = false;
    $("progress").classList.remove("scrubbing");
  });

  // ---------- Init ----------
  function init() {
    const badge = $("mode-badge");
    if (!isNative || !MediaScanner) {
      badge.textContent = "modo web";
      show("web");
      return;
    }
    badge.textContent = "app nativa";

    $("btn-permission").addEventListener("click", async () => {
      if (await ensurePermission()) scan();
    });
    $("btn-settings").addEventListener("click", () => {
      MediaScanner.openAppSettings().catch((e) => console.error(e));
    });

    show("permission");
  }

  init();
})();
