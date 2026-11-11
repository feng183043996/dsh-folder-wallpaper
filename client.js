/**
 * Client half of the wallpaper slideshow bundle.
 *
 * Paints a fixed photo layer behind the whole interface, fades between the
 * chosen images, and turns the host's opaque panels translucent so the photo
 * shows through. It mounts no React tree and no slot: the wallpaper belongs
 * *behind* every seat, so it is a decorative layer attached to `document.body`
 * rather than an overlay above the columns.
 *
 * A small floating panel (bottom-left) lets the user pick photos and tune the
 * translucency live; `POST /dsh-wallpaper/settings` persists the choices.
 */
window.__ModuleLoader__.load({
  id: "dsh-folder-wallpaper",
  factory(require) {
    const React = require("react");
    const h = React.createElement;
    const MANIFEST_URL = "/dsh-wallpaper/manifest";
    const SETTINGS_URL = "/dsh-wallpaper/settings";
    const PHOTO_CLASS = "wp-photo";
    const VISIBLE_CLASS = "is-current";

    const clamp = (value, min, max, fallback) => {
      const parsed = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(parsed)) return fallback;
      return Math.min(max, Math.max(min, parsed));
    };

    /* Diagnostics are off unless the page opts in with
       `localStorage.setItem("dsh-wallpaper-debug", "1")`; they never leave the
       browser, so the bundle has no logging endpoint to call. */
    const DEBUG = (() => {
      try {
        return window.localStorage.getItem("dsh-wallpaper-debug") === "1";
      } catch {
        return false;
      }
    })();

    function report(payload) {
      if (!DEBUG) return;
      try {
        console.debug("[dsh-folder-wallpaper]", payload);
      } catch {
        /* diagnostics only */
      }
    }

    function styleSheet(state) {
      const alpha = Math.round(state.surfaceAlpha * 100);
      const sidebarAlpha = Math.round(state.surfaceAlpha * 100 * 0.94);
      const photoFilter = state.blurPx > 0 ? `blur(${state.blurPx}px)` : "none";
      const photoTransform = state.blurPx > 0 ? "scale(1.04)" : "none";
      return `
html, body { background-color: transparent !important; background-image: none !important; }
body {
  --dsw-alias-bg-base: color-mix(in srgb, var(--dsw-static-neutral-bluish-00) ${alpha}%, transparent) !important;
  --dsw-specific-sidebar-fill: color-mix(in srgb, var(--dsw-static-neutral-bluish-00) ${sidebarAlpha}%, transparent) !important;
}
body[data-ds-dark-theme] {
  --dsw-alias-bg-base: color-mix(in srgb, var(--dsw-static-neutral-bluish-950) ${alpha}%, transparent) !important;
  --dsw-specific-sidebar-fill: color-mix(in srgb, var(--dsw-static-neutral-bluish-950) ${sidebarAlpha}%, transparent) !important;
}
#root { background: transparent !important; }
.wp-glass {
  -webkit-backdrop-filter: blur(${state.panelBlur}px) saturate(105%);
  backdrop-filter: blur(${state.panelBlur}px) saturate(105%);
}
[class*="_composerSeat"] {
  background-image: linear-gradient(to top, var(--dsw-alias-bg-base), transparent) !important;
}
#dsh-wallpaper {
  position: fixed; inset: 0; z-index: -1; overflow: hidden;
  pointer-events: none; background: transparent;
}
#dsh-wallpaper .${PHOTO_CLASS} {
  position: absolute; inset: 0; z-index: 1;
  background-repeat: no-repeat; background-position: center center;
  background-size: ${state.fit === "contain" ? "contain" : "cover"};
  filter: ${photoFilter}; transform: ${photoTransform};
  opacity: 0; transition: opacity ${state.transitionMs}ms cubic-bezier(0.4, 0, 0.2, 1);
  will-change: opacity;
}
#dsh-wallpaper .${PHOTO_CLASS}.${VISIBLE_CLASS} { opacity: 1; }
#dsh-wallpaper .wp-scrim {
  position: absolute; inset: 0; z-index: 3; pointer-events: none;
  background: rgba(0, 0, 0, ${state.dim});
}
@media (prefers-reduced-motion: reduce) {
  #dsh-wallpaper .${PHOTO_CLASS} { transition: none; }
}
`;
    }

    const PANEL_CSS = `
#dsh-wallpaper-launcher {
  position: fixed; left: 14px; bottom: 14px; z-index: 900;
  width: 34px; height: 34px; border-radius: 50%; border: 1px solid rgba(127,127,127,0.35);
  background: rgba(127,127,127,0.18); color: inherit; font-size: 16px; line-height: 1;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
  opacity: 0.55; transition: opacity 140ms ease; backdrop-filter: blur(6px);
}
#dsh-wallpaper-launcher:hover { opacity: 1; }
#dsh-wallpaper-panel {
  position: fixed; left: 14px; bottom: 56px; z-index: 901;
  width: 316px; max-height: 74vh; overflow: auto; box-sizing: border-box;
  padding: 10px 12px 12px; border-radius: 12px; font-size: 12px; line-height: 1.4;
  color: #1a1a1a; background: rgba(252,252,252,0.97);
  border: 1px solid rgba(0,0,0,0.12); box-shadow: 0 12px 32px rgba(0,0,0,0.22);
  backdrop-filter: blur(18px);
}
#dsh-wallpaper-panel[data-dark="1"] {
  color: #eee; background: rgba(30,30,32,0.97); border-color: rgba(255,255,255,0.14);
}
#dsh-wallpaper-panel[hidden] { display: none; }
#dsh-wallpaper-panel .wp-hd { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; font-weight: 600; }
#dsh-wallpaper-panel .wp-x { border: 0; background: transparent; color: inherit; font-size: 16px; cursor: pointer; opacity: 0.6; }
#dsh-wallpaper-panel .wp-x:hover { opacity: 1; }
#dsh-wallpaper-panel .wp-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 4px; margin-bottom: 8px; }
#dsh-wallpaper-panel .wp-thumb { padding: 0; border: 2px solid transparent; border-radius: 5px; overflow: hidden; cursor: pointer; background: rgba(127,127,127,0.15); aspect-ratio: 3 / 2; }
#dsh-wallpaper-panel .wp-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; opacity: 0.45; }
#dsh-wallpaper-panel .wp-thumb.on { border-color: #3b82f6; }
#dsh-wallpaper-panel .wp-thumb.on img { opacity: 1; }
#dsh-wallpaper-panel .wp-row { display: grid; grid-template-columns: 68px 1fr 46px; align-items: center; gap: 6px; margin: 5px 0; }
#dsh-wallpaper-panel .wp-row input[type=range] { width: 100%; accent-color: #3b82f6; }
#dsh-wallpaper-panel .wp-val { text-align: right; font-variant-numeric: tabular-nums; opacity: 0.75; }
#dsh-wallpaper-panel .wp-fit { display: flex; align-items: center; gap: 6px; margin: 8px 0 4px; }
#dsh-wallpaper-panel select { font-size: 12px; padding: 2px 4px; border-radius: 5px; }
#dsh-wallpaper-panel .wp-ft { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
#dsh-wallpaper-panel .wp-btn { font-size: 12px; padding: 4px 10px; border-radius: 6px; cursor: pointer; border: 1px solid rgba(127,127,127,0.4); background: rgba(127,127,127,0.12); color: inherit; }
#dsh-wallpaper-panel .wp-btn.primary { background: #3b82f6; border-color: #3b82f6; color: #fff; }
#dsh-wallpaper-panel .wp-msg { opacity: 0.7; margin-left: auto; }
#dsh-wallpaper-panel .wp-note { opacity: 0.55; margin-top: 6px; font-size: 11px; }
`;

    const SLIDERS = [
      { key: "surfaceAlpha", label: "面板白度", min: 0, max: 1, step: 0.01, text: (v) => Math.round(v * 100) + "%" },
      { key: "panelBlur", label: "面板模糊", min: 0, max: 40, step: 1, text: (v) => v + "px" },
      { key: "dim", label: "压暗遮罩", min: 0, max: 0.8, step: 0.01, text: (v) => Math.round(v * 100) + "%" },
      { key: "blurPx", label: "照片模糊", min: 0, max: 20, step: 1, text: (v) => v + "px" },
      { key: "intervalMs", label: "轮播间隔", min: 3000, max: 180000, step: 1000, text: (v) => Math.round(v / 1000) + "s" },
      { key: "transitionMs", label: "淡入时长", min: 0, max: 5000, step: 100, text: (v) => (v / 1000).toFixed(1) + "s" },
    ];

    function start(manifest) {
      const state = {
        surfaceAlpha: clamp(manifest.surfaceAlpha, 0, 1, 0.28),
        panelBlur: clamp(manifest.panelBlur, 0, 40, 4),
        dim: clamp(manifest.dim, 0, 0.8, 0.1),
        blurPx: clamp(manifest.blurPx, 0, 40, 0),
        intervalMs: clamp(manifest.intervalMs, 1000, 3600000, 20000),
        transitionMs: clamp(manifest.transitionMs, 0, 10000, 1600),
        fit: manifest.fit === "contain" ? "contain" : "cover",
        enabled: Array.isArray(manifest.enabled) ? manifest.enabled.slice() : null,
      };
      const imageCount = Array.isArray(manifest.images) ? manifest.images.length : 0;
      const allImages = Array.isArray(manifest.images) ? manifest.images.slice() : [];
      const timers = new Set();
      const punched = [];
      const glassed = [];
      const photos = [];
      const blobs = new Map();
      const notify = [];
      let tickTimer = null;
      let current = -1;
      let cursor = 0;
      let busy = false;
      let stopped = false;
      let panelRoot = null;

      const style = document.createElement("style");
      style.setAttribute("data-dsh-wallpaper-style", "");
      style.setAttribute("data-plugin", "dsh-folder-wallpaper");
      style.textContent = styleSheet(state);

      const layer = document.createElement("div");
      layer.id = "dsh-wallpaper";
      layer.setAttribute("aria-hidden", "true");
      for (let index = 0; index < 2; index += 1) {
        const photo = document.createElement("div");
        photo.className = PHOTO_CLASS;
        photos.push(photo);
        layer.appendChild(photo);
      }
      const scrim = document.createElement("div");
      scrim.className = "wp-scrim";
      layer.appendChild(scrim);

      document.head.appendChild(style);
      document.body.appendChild(layer);

      const activeImages = () => {
        if (!Array.isArray(state.enabled)) return allImages;
        const picked = new Set(state.enabled);
        const subset = allImages.filter((image) => picked.has(image.file));
        return subset.length > 0 ? subset : allImages;
      };

      const later = (callback, delay) => {
        const timer = window.setTimeout(() => {
          timers.delete(timer);
          if (!stopped) callback();
        }, delay);
        timers.add(timer);
        return timer;
      };

      const alphaOf = (color) => {
        const slash = color.match(/\/\s*([\d.]+)\s*\)/);
        if (slash !== null) return Number(slash[1]);
        const rgba = color.match(/^rgba?\(([^)]+)\)$/);
        if (rgba !== null) {
          const parts = rgba[1].split(",");
          return parts.length === 4 ? Number(parts[3]) : 1;
        }
        return 1;
      };
      const rgbOf = (color) => {
        const srgb = color.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
        if (srgb !== null) {
          return srgb.slice(1, 4).map((part) => Math.round(Number(part) * 255));
        }
        const rgb = color.match(/^rgba?\(([^)]+)\)$/);
        if (rgb !== null) {
          const parts = rgb[1].split(/[,\s/]+/).filter((part) => part.length > 0);
          if (parts.length >= 3) return parts.slice(0, 3).map((part) => Math.round(Number(part)));
        }
        return null;
      };
      const withAlpha = (color, value) => {
        const rgb = rgbOf(color);
        if (rgb === null) {
          return `color-mix(in srgb, ${color} ${Math.round(value * 100)}%, transparent)`;
        }
        return `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]} / ${value})`;
      };

      const punchBackdrop = () => {
        const width = window.innerWidth;
        const height = window.innerHeight;
        const hit = document.elementsFromPoint(Math.round(width / 2), Math.round(height / 2));
        const chain = [];
        for (let el = hit.length > 0 ? hit[0] : null; el != null; el = el.parentElement) {
          chain.push(el);
        }
        chain.reverse();
        for (const el of chain) {
          if (el === document.body || el === document.documentElement) continue;
          const box = el.getBoundingClientRect();
          if (box.width < width * 0.98 || box.height < height * 0.98) continue;
          const computed = window.getComputedStyle(el);
          if (computed.backgroundColor.endsWith(", 0)")) continue;
          punched.push({ el, bg: computed.backgroundColor, im: computed.backgroundImage });
          el.style.setProperty("background-color", "transparent", "important");
          if (computed.backgroundImage !== "none") {
            el.style.setProperty("background-image", "none", "important");
          }
        }
      };

      const SKIP_TAGS = ["IMG", "VIDEO", "CANVAS", "SVG", "PRE", "CODE", "INPUT", "TEXTAREA", "SELECT"];
      const alphaFor = (item) => (item.card ? Math.max(state.surfaceAlpha, 0.55) : state.surfaceAlpha);

      const glassSurface = (el) => {
        if (el === layer || layer.contains(el)) return null;
        if (panelRoot !== null && (el === panelRoot || panelRoot.contains(el))) return null;
        if (el === document.body || el === document.documentElement) return null;
        if (SKIP_TAGS.includes(el.tagName)) return null;
        const box = el.getBoundingClientRect();
        if (box.width * box.height < window.innerWidth * window.innerHeight * 0.06) return null;
        const computed = window.getComputedStyle(el);
        const before = computed.backgroundColor;
        if (alphaOf(before) <= 0.2) return null;
        const item = { el, bg: before, card: String(el.className).includes("_card") };
        glassed.push(item);
        el.style.setProperty("background-color", withAlpha(before, alphaFor(item)), "important");
        el.classList.add("wp-glass");
        return String(el.className).slice(0, 60) || el.tagName;
      };

      const glassify = () => {
        const added = [];
        for (const el of Array.from(document.querySelectorAll("body *"))) {
          const name = glassSurface(el);
          if (name !== null) added.push(name);
        }
        if (added.length > 0) {
          report({ stage: "glass", count: added.length, classes: added.slice(0, 12) });
        }
      };

      const repaintGlass = () => {
        for (const item of glassed) {
          item.el.style.setProperty("background-color", withAlpha(item.bg, alphaFor(item)), "important");
        }
      };

      const refreshStyle = () => {
        style.textContent = styleSheet(state);
      };

      const loadPhoto = async (url) => {
        if (blobs.has(url)) return blobs.get(url);
        const response = await fetch(url, { credentials: "same-origin", cache: "force-cache" });
        if (!response.ok) throw new Error("image " + response.status);
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        blobs.set(url, objectUrl);
        while (blobs.size > 4) {
          const oldest = blobs.keys().next().value;
          URL.revokeObjectURL(blobs.get(oldest));
          blobs.delete(oldest);
        }
        return objectUrl;
      };

      const show = async () => {
        if (busy || stopped) return;
        const images = activeImages();
        if (images.length === 0) return;
        busy = true;
        try {
          const image = images[cursor % images.length];
          let source;
          try {
            source = await loadPhoto(image.url);
          } catch (error) {
            report({ stage: "image-failed", url: image.url, message: String(error).slice(0, 120) });
            return;
          }
          if (stopped) return;
          const incoming = photos[current === 0 ? 1 : 0];
          const outgoing = current === -1 ? null : photos[current];
          incoming.style.backgroundImage = `url("${source}")`;
          incoming.style.zIndex = "2";
          incoming.classList.add(VISIBLE_CLASS);
          if (outgoing !== null) {
            outgoing.style.zIndex = "1";
            later(() => {
              if (outgoing !== photos[current]) outgoing.classList.remove(VISIBLE_CLASS);
            }, state.transitionMs + 120);
          }
          current = current === 0 ? 1 : 0;
          cursor += 1;
        } finally {
          busy = false;
        }
      };

      const restartInterval = () => {
        if (tickTimer !== null) {
          window.clearTimeout(tickTimer);
          timers.delete(tickTimer);
          tickTimer = null;
        }
        if (stopped || activeImages().length < 2) return;
        const tick = () => {
          tickTimer = null;
          void show();
          if (!stopped) tickTimer = later(tick, state.intervalMs);
        };
        tickTimer = later(tick, state.intervalMs);
      };

      const applyPatch = (patch) => {
        const beforeInterval = state.intervalMs;
        const beforeEnabled = state.enabled;
        for (const [key, value] of Object.entries(patch)) {
          if (key === "surfaceAlpha") state.surfaceAlpha = clamp(value, 0, 1, state.surfaceAlpha);
          else if (key === "panelBlur") state.panelBlur = clamp(value, 0, 40, state.panelBlur);
          else if (key === "dim") state.dim = clamp(value, 0, 0.8, state.dim);
          else if (key === "blurPx") state.blurPx = clamp(value, 0, 40, state.blurPx);
          else if (key === "intervalMs") state.intervalMs = clamp(value, 1000, 3600000, state.intervalMs);
          else if (key === "transitionMs") state.transitionMs = clamp(value, 0, 10000, state.transitionMs);
          else if (key === "fit") state.fit = value === "contain" ? "contain" : "cover";
          else if (key === "enabled") state.enabled = Array.isArray(value) ? value.slice() : null;
        }
        refreshStyle();
        repaintGlass();
        if (beforeInterval !== state.intervalMs) restartInterval();
        if (beforeEnabled !== state.enabled) {
          cursor = 0;
          restartInterval();
          void show();
        }
        for (const listener of notify) listener(state);
      };

      const save = async () => {
        const response = await fetch(SETTINGS_URL, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            surfaceAlpha: state.surfaceAlpha,
            panelBlur: state.panelBlur,
            dim: state.dim,
            blurPx: state.blurPx,
            intervalMs: state.intervalMs,
            transitionMs: state.transitionMs,
            fit: state.fit,
            enabled: state.enabled === null ? [] : state.enabled,
          }),
        });
        if (!response.ok) throw new Error("save " + response.status);
        return response.json();
      };

      /* ---------- floating control panel ---------- */
      const uiStyle = document.createElement("style");
      uiStyle.setAttribute("data-plugin", "dsh-folder-wallpaper");
      uiStyle.textContent = PANEL_CSS;
      document.head.appendChild(uiStyle);

      const panel = document.createElement("div");
      panel.id = "dsh-wallpaper-panel";
      panel.hidden = true;

      const launcher = document.createElement("button");
      launcher.id = "dsh-wallpaper-launcher";
      launcher.type = "button";
      launcher.title = "壁纸设置";
      launcher.textContent = "🖼";

      const header = document.createElement("div");
      header.className = "wp-hd";
      header.textContent = "照片壁纸";
      const close = document.createElement("button");
      close.className = "wp-x";
      close.type = "button";
      close.textContent = "×";
      header.appendChild(close);

      const grid = document.createElement("div");
      grid.className = "wp-grid";

      const selectedSet = () => {
        if (!Array.isArray(state.enabled)) return new Set(allImages.map((image) => image.file));
        return new Set(state.enabled);
      };

      const renderGrid = () => {
        const chosen = selectedSet();
        grid.textContent = "";
        for (const image of allImages) {
          const thumb = document.createElement("button");
          thumb.type = "button";
          thumb.className = "wp-thumb" + (chosen.has(image.file) ? " on" : "");
          thumb.title = image.file;
          const img = document.createElement("img");
          img.loading = "lazy";
          img.src = image.url;
          img.alt = image.file;
          thumb.appendChild(img);
          thumb.addEventListener("click", () => {
            const next = selectedSet();
            if (next.has(image.file)) next.delete(image.file);
            else next.add(image.file);
            const list = allImages.filter((entry) => next.has(entry.file)).map((entry) => entry.file);
            applyPatch({ enabled: list.length === allImages.length ? null : list });
            renderGrid();
          });
          grid.appendChild(thumb);
        }
      };

      const rows = document.createElement("div");
      const controls = new Map();
      for (const spec of SLIDERS) {
        const row = document.createElement("div");
        row.className = "wp-row";
        const label = document.createElement("span");
        label.textContent = spec.label;
        const input = document.createElement("input");
        input.type = "range";
        input.min = String(spec.min);
        input.max = String(spec.max);
        input.step = String(spec.step);
        input.value = String(state[spec.key]);
        const value = document.createElement("span");
        value.className = "wp-val";
        value.textContent = spec.text(state[spec.key]);
        input.addEventListener("input", () => {
          const next = Number(input.value);
          value.textContent = spec.text(next);
          applyPatch({ [spec.key]: next });
        });
        row.append(label, input, value);
        rows.appendChild(row);
        controls.set(spec.key, { input, value, spec });
      }

      const fitRow = document.createElement("div");
      fitRow.className = "wp-fit";
      const fitLabel = document.createElement("span");
      fitLabel.textContent = "填充方式";
      const fitSelect = document.createElement("select");
      for (const option of ["cover", "contain"]) {
        const node = document.createElement("option");
        node.value = option;
        node.textContent = option === "cover" ? "铺满裁切" : "完整显示";
        fitSelect.appendChild(node);
      }
      fitSelect.value = state.fit;
      fitSelect.addEventListener("change", () => applyPatch({ fit: fitSelect.value }));
      fitRow.append(fitLabel, fitSelect);

      const footer = document.createElement("div");
      footer.className = "wp-ft";
      const saveButton = document.createElement("button");
      saveButton.type = "button";
      saveButton.className = "wp-btn primary";
      saveButton.textContent = "保存";
      const resetButton = document.createElement("button");
      resetButton.type = "button";
      resetButton.className = "wp-btn";
      resetButton.textContent = "恢复默认";
      const message = document.createElement("span");
      message.className = "wp-msg";
      footer.append(saveButton, resetButton, message);

      const note = document.createElement("div");
      note.className = "wp-note";
      note.textContent =
        "这里只做即时预览；点「保存」会把当前参数写回插件配置（设置 → 插件 → 照片壁纸轮播），文件夹路径也在那里改。";

      panel.append(header, grid, rows, fitRow, footer, note);

      const sync = () => {
        for (const [key, control] of controls) {
          control.input.value = String(state[key]);
          control.value.textContent = control.spec.text(state[key]);
        }
        fitSelect.value = state.fit;
        const dark =
          document.documentElement.dataset.dsDarkTheme !== undefined ||
          document.body.hasAttribute("data-ds-dark-theme");
        panel.dataset.dark = dark ? "1" : "0";
      };
      notify.push(sync);

      saveButton.addEventListener("click", () => {
        message.textContent = "保存中…";
        void save()
          .then(() => {
            message.textContent = "已写入插件配置";
          })
          .catch((error) => {
            message.textContent = "保存失败";
            report({ stage: "save-failed", message: String(error).slice(0, 120) });
          });
      });
      resetButton.addEventListener("click", () => {
        applyPatch({
          surfaceAlpha: 0.28,
          panelBlur: 4,
          dim: 0.1,
          blurPx: 0,
          intervalMs: 20000,
          transitionMs: 1600,
          fit: "cover",
          enabled: null,
        });
        renderGrid();
        message.textContent = "已恢复默认";
      });
      close.addEventListener("click", () => {
        panel.hidden = true;
      });
      launcher.addEventListener("click", () => {
        panel.hidden = !panel.hidden;
        sync();
      });

      document.body.append(panel, launcher);
      panelRoot = panel;
      renderGrid();
      sync();

      punchBackdrop();
      glassify();
      for (const delay of [400, 1600, 4000]) {
        const timer = window.setTimeout(() => {
          timers.delete(timer);
          if (!stopped) glassify();
        }, delay);
        timers.add(timer);
      }

      void show();
      restartInterval();

      report({
        stage: "mounted3",
        vw: window.innerWidth,
        vh: window.innerHeight,
        images: imageCount,
        enabled: Array.isArray(state.enabled) ? state.enabled.length : "all",
        surfaceAlpha: state.surfaceAlpha,
        panelBlur: state.panelBlur,
      });

      return {
        dispose() {
          stopped = true;
          for (const timer of timers) window.clearTimeout(timer);
          timers.clear();
          for (const item of punched) {
            item.el.style.removeProperty("background-color");
            if (item.im !== "none") item.el.style.removeProperty("background-image");
          }
          for (const item of glassed) {
            item.el.style.removeProperty("background-color");
            item.el.classList.remove("wp-glass");
          }
          for (const objectUrl of blobs.values()) URL.revokeObjectURL(objectUrl);
          blobs.clear();
          panel.remove();
          launcher.remove();
          uiStyle.remove();
          layer.remove();
          style.remove();
        },
        patch: applyPatch,
        state,
      };
    }

    /* ---- plugin configuration page ---------------------------------------
       The Plugins page renders a row's form only when something registers
       into `plugins.row.config` under `<package>#<row id>`; a Host-side
       Config schema alone produces no UI. */

    const CONFIG_NS = "dshWallpaperConfig";

    const CONFIG_ZH = {
      summary: "照片壁纸轮播：在此调整文件夹、轮播节奏与显示效果。",
      directory: "照片文件夹",
      directoryHint: "绝对路径；读取该目录下的 jpg / png / webp / avif / gif。",
      interval: "轮播间隔（毫秒）",
      transition: "淡入淡出（毫秒）",
      surfaceAlpha: "面板不透明度（0–1，越小照片越明显）",
      panelBlur: "面板模糊（px）",
      dim: "压暗遮罩（0–0.8）",
      blurPx: "照片模糊（px）",
      fit: "填充方式",
      shuffle: "每次加载随机顺序",
      photos: "参与轮播的照片",
      save: "保存",
      saving: "保存中…",
      saved: "已写入插件配置，插件正在重启并应用…",
      saveFailed: "保存失败：",
      loadFailed: "读取配置失败：",
      loading: "读取配置…",
      toggleAll: "全选 / 清空",
      reload: "重新读取",
      note: "保存会重启本插件以应用新配置；左下角 🖼 浮动面板可用于即时预览，不落盘。",
    };

    const CONFIG_EN = {
      summary: "Photo wallpaper slideshow: folder, cadence and look.",
      directory: "Photo folder",
      directoryHint: "Absolute path; reads jpg / png / webp / avif / gif from it.",
      interval: "Slide interval (ms)",
      transition: "Cross-fade (ms)",
      surfaceAlpha: "Panel opacity (0–1)",
      panelBlur: "Panel blur (px)",
      dim: "Dim scrim (0–0.8)",
      blurPx: "Photo blur (px)",
      fit: "Fit",
      shuffle: "Randomize order on load",
      photos: "Photos in the rotation",
      save: "Save",
      saving: "Saving…",
      saved: "Written to the plugin config; the plugin is restarting…",
      saveFailed: "Save failed: ",
      loadFailed: "Could not read the config: ",
      loading: "Loading…",
      toggleAll: "Select all / none",
      reload: "Reload",
      note: "Saving restarts this plugin. The 🖼 panel in the corner previews changes without writing them.",
    };

    const CONFIG_NUMBERS = [
      ["intervalMs", "interval", 1000, 3600000, 1000],
      ["transitionMs", "transition", 0, 10000, 100],
      ["surfaceAlpha", "surfaceAlpha", 0, 1, 0.01],
      ["panelBlur", "panelBlur", 0, 40, 1],
      ["dim", "dim", 0, 0.8, 0.01],
      ["blurPx", "blurPx", 0, 40, 1],
    ];

    const BORDER = "0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.4))";

    const CFG = {
      wrap: { display: "flex", flexDirection: "column", gap: "14px", maxWidth: "620px", fontSize: "13px", lineHeight: 1.5 },
      grid: { display: "grid", gridTemplateColumns: "minmax(0,1fr) 140px", gap: "8px 14px", alignItems: "center" },
      label: { color: "var(--dsw-alias-label-secondary, inherit)" },
      input: {
        width: "100%",
        boxSizing: "border-box",
        padding: "5px 8px",
        borderRadius: "6px",
        border: BORDER,
        background: "transparent",
        color: "inherit",
        font: "inherit",
      },
      hint: { gridColumn: "1 / -1", margin: "-4px 0 2px", fontSize: "12px", opacity: 0.75 },
      photos: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(148px, 1fr))",
        gap: "4px 10px",
        maxHeight: "260px",
        overflow: "auto",
        padding: "8px",
        border: BORDER,
        borderRadius: "8px",
      },
      item: { display: "flex", gap: "6px", alignItems: "center", minWidth: 0, fontSize: "12px" },
      name: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
      actions: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" },
      button: {
        padding: "5px 12px",
        borderRadius: "6px",
        border: BORDER,
        background: "transparent",
        color: "inherit",
        font: "inherit",
        cursor: "pointer",
      },
      primary: {
        padding: "5px 16px",
        borderRadius: "6px",
        border: "0.5px solid transparent",
        background: "var(--dsw-alias-state-business-primary, #4d6bfe)",
        color: "#fff",
        font: "inherit",
        cursor: "pointer",
      },
      status: { margin: 0, fontSize: "12px", minHeight: "16px", opacity: 0.85 },
      note: { margin: 0, fontSize: "12px", opacity: 0.7 },
    };

    function ConfigPage(props) {
      const t = typeof props.t === "function" ? props.t : (key) => key;
      const [files, setFiles] = React.useState([]);
      const [draft, setDraft] = React.useState(null);
      const [status, setStatus] = React.useState("");
      const [busy, setBusy] = React.useState(false);

      const load = React.useCallback(async () => {
        setStatus(t("loading"));
        try {
          const response = await fetch(MANIFEST_URL, {
            credentials: "same-origin",
            cache: "no-store",
            headers: { accept: "application/json" },
          });
          if (!response.ok) throw new Error("HTTP " + response.status);
          const manifest = await response.json();
          const names = (Array.isArray(manifest.images) ? manifest.images : []).map((image) => image.file);
          const enabled = Array.isArray(manifest.enabled)
            ? manifest.enabled.filter((name) => names.includes(name))
            : [];
          setFiles(names);
          setDraft({
            directory: typeof manifest.directory === "string" ? manifest.directory : "",
            intervalMs: manifest.intervalMs,
            transitionMs: manifest.transitionMs,
            surfaceAlpha: manifest.surfaceAlpha,
            panelBlur: manifest.panelBlur,
            dim: manifest.dim,
            blurPx: manifest.blurPx,
            fit: manifest.fit === "contain" ? "contain" : "cover",
            shuffle: manifest.shuffle === true,
            selected: enabled.length > 0 ? enabled : names.slice(),
          });
          setStatus("");
        } catch (error) {
          setStatus(t("loadFailed") + String((error && error.message) || error));
        }
      }, [t]);

      React.useEffect(() => {
        if (props.view === "page") void load();
      }, [props.view, load]);

      if (props.view === "summary") return h("span", null, t("summary"));
      if (draft === null) return h("p", { style: CFG.status }, status);

      const set = (key, value) => setDraft((previous) => ({ ...previous, [key]: value }));

      const save = async () => {
        setBusy(true);
        setStatus(t("saving"));
        try {
          const patch = {
            directory: String(draft.directory || "").trim(),
            fit: draft.fit,
            shuffle: draft.shuffle === true,
            enabled: draft.selected,
          };
          for (const [key] of CONFIG_NUMBERS) {
            const value = Number(draft[key]);
            if (Number.isFinite(value)) patch[key] = value;
          }
          const response = await fetch(SETTINGS_URL, {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(patch),
          });
          if (!response.ok) throw new Error("HTTP " + response.status);
          setStatus(t("saved"));
        } catch (error) {
          setStatus(t("saveFailed") + String((error && error.message) || error));
        } finally {
          setBusy(false);
        }
      };

      const rows = [
        h("label", { key: "directory-label", style: CFG.label }, t("directory")),
        h("input", {
          key: "directory-input",
          style: CFG.input,
          type: "text",
          spellCheck: false,
          value: draft.directory,
          onChange: (event) => set("directory", event.currentTarget.value),
        }),
        h("p", { key: "directory-hint", style: CFG.hint }, t("directoryHint")),
      ];

      for (const [key, labelKey, min, max, step] of CONFIG_NUMBERS) {
        rows.push(h("label", { key: key + "-label", style: CFG.label }, t(labelKey)));
        rows.push(
          h("input", {
            key: key + "-input",
            style: CFG.input,
            type: "number",
            value: draft[key],
            min,
            max,
            step,
            onChange: (event) => set(key, event.currentTarget.value),
          }),
        );
      }

      rows.push(h("label", { key: "fit-label", style: CFG.label }, t("fit")));
      rows.push(
        h(
          "select",
          {
            key: "fit-input",
            style: CFG.input,
            value: draft.fit,
            onChange: (event) => set("fit", event.currentTarget.value),
          },
          h("option", { value: "cover" }, "cover"),
          h("option", { value: "contain" }, "contain"),
        ),
      );

      rows.push(h("label", { key: "shuffle-label", style: CFG.label }, t("shuffle")));
      rows.push(
        h("input", {
          key: "shuffle-input",
          type: "checkbox",
          checked: draft.shuffle,
          onChange: (event) => set("shuffle", event.currentTarget.checked),
        }),
      );

      return h(
        "div",
        { style: CFG.wrap },
        h("div", { style: CFG.grid }, rows),
        h(
          "div",
          null,
          h(
            "p",
            { style: CFG.label },
            t("photos") + "  " + draft.selected.length + " / " + files.length,
          ),
          h(
            "div",
            { style: CFG.photos },
            files.map((name) =>
              h(
                "label",
                { key: name, style: CFG.item },
                h("input", {
                  type: "checkbox",
                  checked: draft.selected.includes(name),
                  onChange: (event) => {
                    const checked = event.currentTarget.checked;
                    setDraft((previous) => {
                      const next = previous.selected.filter((item) => item !== name);
                      if (checked) next.push(name);
                      next.sort();
                      return { ...previous, selected: next };
                    });
                  },
                }),
                h("span", { style: CFG.name, title: name }, name),
              ),
            ),
          ),
        ),
        h(
          "div",
          { style: CFG.actions },
          h(
            "button",
            { type: "button", style: CFG.primary, disabled: busy, onClick: save },
            busy ? t("saving") : t("save"),
          ),
          h(
            "button",
            {
              type: "button",
              style: CFG.button,
              disabled: busy,
              onClick: () =>
                setDraft((previous) => ({
                  ...previous,
                  selected:
                    previous.selected.length === files.length ? [] : files.slice(),
                })),
            },
            t("toggleAll"),
          ),
          h(
            "button",
            { type: "button", style: CFG.button, disabled: busy, onClick: () => void load() },
            t("reload"),
          ),
        ),
        h("p", { style: CFG.status }, status),
        h("p", { style: CFG.note }, t("note")),
      );
    }

    return {
      inject: ["slots", "locale"],
      apply(ctx) {
        ctx.effect(
          () => ctx.locale.register(CONFIG_NS, { zh: CONFIG_ZH, en: CONFIG_EN }),
          "dsh-wallpaper: config dictionaries",
        );
        ctx.effect(
          () =>
            ctx.slots.inject("plugins.row.config", () =>
              ctx.slots.register(
                {
                  name: "plugins.row.config",
                  key: "dsh-folder-wallpaper#wallpaper",
                  locale: CONFIG_NS,
                },
                ConfigPage,
              ),
            ),
          "dsh-wallpaper: plugin config page",
        );

        ctx.effect(() => {
          const controller = new AbortController();
          const sleeps = new Set();
          let runtime = null;

          const sleep = (ms) =>
            new Promise((resolve) => {
              const timer = window.setTimeout(() => {
                sleeps.delete(timer);
                resolve();
              }, ms);
              sleeps.add(timer);
              controller.signal.addEventListener(
                "abort",
                () => {
                  window.clearTimeout(timer);
                  sleeps.delete(timer);
                  resolve();
                },
                { once: true },
              );
            });

          void (async () => {
            /* The module can run before the launch-token exchange has set the
               session cookie, so a first 401 is expected on a cold start. */
            const delays = [0, 500, 1000, 2000, 3000, 5000, 8000];
            for (let attempt = 0; attempt < delays.length; attempt += 1) {
              if (controller.signal.aborted) return;
              if (delays[attempt] > 0) {
                await sleep(delays[attempt]);
                if (controller.signal.aborted) return;
              }
              let response;
              try {
                response = await fetch(MANIFEST_URL, {
                  credentials: "same-origin",
                  signal: controller.signal,
                  headers: { accept: "application/json" },
                  cache: "no-store",
                });
              } catch (error) {
                report({ stage: "manifest-error", attempt, message: String(error).slice(0, 100) });
                continue;
              }
              if (!response.ok) {
                report({ stage: "manifest-retry", attempt, status: response.status });
                continue;
              }
              let manifest;
              try {
                manifest = await response.json();
              } catch (error) {
                report({ stage: "manifest-parse", attempt, message: String(error).slice(0, 100) });
                continue;
              }
              if (controller.signal.aborted) return;
              if (!manifest || !Array.isArray(manifest.images) || manifest.images.length === 0) {
                report({ stage: "manifest-empty" });
                return;
              }
              if (document.body === null) {
                await new Promise((resolve) => {
                  document.addEventListener("DOMContentLoaded", resolve, { once: true });
                  controller.signal.addEventListener("abort", resolve, { once: true });
                });
              }
              if (controller.signal.aborted || document.body === null) return;
              runtime = start(manifest);
              return;
            }
            report({ stage: "manifest-exhausted" });
          })();

          return () => {
            controller.abort();
            for (const timer of sleeps) window.clearTimeout(timer);
            sleeps.clear();
            if (runtime !== null) runtime.dispose();
          };
        }, "dsh-wallpaper: wallpaper layer");
      },
    };
  },
});
