/* OffBeat — Etapa 2: biblioteca local (MediaStore) sin reproducción */
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
    web: $("view-web"),
  };

  const state = {
    tracks: [],
    filtered: [],
    permission: "unknown", // unknown | granted | denied
    artCache: new Map(), // albumId -> dataURL
  };

  function show(name) {
    for (const [key, el] of Object.entries(views)) el.hidden = key !== name;
  }

  function fmtDuration(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
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

    for (const t of state.filtered) {
      list.appendChild(buildRow(t));
    }

    const total = state.tracks.length;
    const shown = state.filtered.length;
    $("lib-footer").textContent =
      (shown === total
        ? total + " canciones"
        : shown + " de " + total + " canciones") + " · local, sin conexión";

    loadArtForVisibleRows();
  }

  function buildRow(t) {
    const li = document.createElement("li");
    li.className = "track";

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
      // Etapa 3: reproducción.
      toast("Reproducción llega en la Etapa 3 🎧");
    });

    return li;
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
        state.artCache.set(albumId, dataUrl);
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
    const cached = state.artCache.get(albumId);
    if (cached) return Promise.resolve(cached);
    return MediaScanner.getAlbumArt({ albumId: Number(albumId) })
      .then((res) => {
        if (res && res.hasArt && res.data) return res.mime + ";base64," + res.data;
        return null;
      })
      .catch((e) => {
        console.warn("Sin carátula para el álbum " + albumId, e);
        return null;
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
