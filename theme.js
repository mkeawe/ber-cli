// ber-cli — the parts CSS cannot do:
//   pictures (covers, artist photos, Canvas video) redrawn as coloured characters,
//   every icon replaced by a word, colour washes and gradients flattened,
//   progress and volume drawn as text bars,
//   the search box turned into a shell prompt that knows where you are,
//   and all of it carried into the miniplayer window too.

(function ber() {
  if (!window.Spicetify?.Player || !Spicetify.Platform?.History || !document.body) {
    setTimeout(ber, 300);
    return;
  }

  const RAMP = " .:-=+*#%@";
  const FACE = '"ber", Menlo, monospace';
  const CELL = 7.2; // target cell width in px for drawn pictures

  // Width of one character as a fraction of the font size, measured once the face loads.
  let RATIO = 0.6;
  function measure() {
    const c = document.createElement("canvas").getContext("2d");
    c.font = `100px ${FACE}`;
    RATIO = c.measureText("M").width / 100 || 0.6;
  }

  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  // ============================================================ pictures as text

  const pixels = new Map(); // src -> Promise<HTMLImageElement | null>
  const arts = new Map(); // src|w|h -> Promise<dataURL | null>

  function load(src) {
    if (!pixels.has(src)) {
      pixels.set(src, new Promise((resolve) => {
        const im = new Image();
        im.crossOrigin = "anonymous";
        im.onload = () => resolve(im);
        im.onerror = () => resolve(null);
        im.src = src;
      }));
    }
    return pixels.get(src);
  }

  // Spotify's own image URIs, rewritten to the CDN addresses that allow reading pixels.
  function readable(src) {
    if (src.startsWith("spotify:image:")) return "https://i.scdn.co/image/" + src.split(":")[2];
    if (src.startsWith("spotify:mosaic:")) return "https://mosaic.scdn.co/300/" + src.split(":").slice(2).join("");
    return src;
  }

  // Draws any picture source (image or video frame) as characters into `out`.
  // With `cover`, the source is cropped to the box the way object-fit: cover does.
  // Returns the summed brightness, so a protected (blacked-out) video can be told apart.
  function paint(source, w, h, out, cover) {
    const cols = Math.max(6, Math.round(w / CELL));
    const size = w / cols / RATIO;
    const rows = Math.max(3, Math.round(h / (size * 1.2)));
    const lineH = h / rows;

    const sample = paint.sample || (paint.sample = document.createElement("canvas"));
    sample.width = cols;
    sample.height = rows;
    const sctx = sample.getContext("2d", { willReadFrequently: true });
    const sw = source.videoWidth || source.naturalWidth || source.width;
    const sh = source.videoHeight || source.naturalHeight || source.height;
    if (cover && sw && sh) {
      const scale = Math.max(w / sw, h / sh);
      const cw = w / scale, ch = h / scale;
      sctx.drawImage(source, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, cols, rows);
    } else {
      sctx.drawImage(source, 0, 0, cols, rows);
    }
    const data = sctx.getImageData(0, 0, cols, rows).data; // throws if the source is not readable
    let light = 0;

    const dpr = window.devicePixelRatio || 1;
    if (out.width !== Math.round(w * dpr)) out.width = Math.round(w * dpr);
    if (out.height !== Math.round(h * dpr)) out.height = Math.round(h * dpr);
    const ctx = out.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = css("--spice-main") || "#0a0a0a";
    ctx.fillRect(0, 0, w, h);
    ctx.font = `${size}px ${FACE}`;
    ctx.textBaseline = "middle";

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = (y * cols + x) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        light += lum;
        const ch = RAMP[Math.round(lum * (RAMP.length - 1))];
        if (ch === " ") continue;
        // The glyph carries the darkness; the colour is lifted so thin strokes still read.
        const k = Math.min(2.5, 255 / Math.max(1, r, g, b));
        ctx.fillStyle = `rgb(${r * k | 0},${g * k | 0},${b * k | 0})`;
        ctx.fillText(ch, x * (w / cols), y * lineH + lineH / 2);
      }
    }
    return light;
  }

  function art(src, w, h) {
    const key = `${src}|${w}x${h}`;
    if (!arts.has(key)) {
      arts.set(key, load(readable(src)).then((im) => {
        if (!im) return null;
        try {
          const out = document.createElement("canvas");
          paint(im, w, h, out);
          return out.toDataURL();
        } catch {
          return null;
        }
      }));
    }
    return arts.get(key);
  }

  const drawn = new WeakMap(); // element -> key it was drawn for

  async function imgArt(img) {
    const src = img.currentSrc || img.src;
    if (!src || src.startsWith("data:")) return;
    const w = Math.round(img.clientWidth);
    const h = Math.round(img.clientHeight);
    if (!w || !h) return;
    // Too small to draw in characters (menu and list icons): it goes.
    if (w < 20 || h < 20) { img.dataset.berHide = ""; return; }
    const key = `${src}|${w}x${h}`;
    if (drawn.get(img) === key) return;
    drawn.set(img, key);
    const url = await art(src, w, h);
    if ((img.currentSrc || img.src) !== src) return;
    if (!url) { img.classList.add("ber-unreadable"); return; }
    img.style.setProperty("content", `url(${url})`);
  }

  // Photographs set as backgrounds (artist headers, "About the artist").
  async function bgArt(el) {
    const m = (el.style.backgroundImage || "").match(/url\(["']?((?!data:)[^"')]+)["']?\)/);
    if (!m) return;
    const w = Math.round(el.clientWidth);
    const h = Math.round(el.clientHeight);
    if (w < 20 || h < 20) return;
    const key = `${m[1]}|${w}x${h}`;
    if (drawn.get(el) === key) return;
    drawn.set(el, key);
    const url = await art(m[1], w, h);
    if (!url) return;
    el.dataset.berArt = "";
    el.style.setProperty("background-image", `url(${url})`, "important");
    el.style.setProperty("background-size", "100% 100%", "important");
  }

  // Video (Canvas loops, music videos) drawn live as characters, ten frames a second.
  // If the frames cannot be read, the video goes and the still cover shows; if they read
  // as solid black (protected video), the original video is left to play as it is.
  const videos = new Set();
  function videoArt(v) {
    if (v.dataset.ber) return;
    v.dataset.ber = "1";
    const out = v.ownerDocument.createElement("canvas");
    out.className = "ber-video";
    v.after(out);
    videos.add({ v, out, dark: 0 });
  }
  setInterval(() => {
    for (const item of videos) {
      const { v, out } = item;
      if (!v.isConnected) { out.remove(); videos.delete(item); continue; }
      const w = Math.round(v.clientWidth), h = Math.round(v.clientHeight);
      if (w < 20 || h < 20 || v.readyState < 2) continue;
      out.style.cssText = `position:absolute;left:${v.offsetLeft}px;top:${v.offsetTop}px;width:${w}px;height:${h}px;pointer-events:none;`;
      try {
        const light = paint(v, w, h, out, getComputedStyle(v).objectFit === "cover");
        item.dark = light < 1 && !v.paused ? item.dark + 1 : 0;
        if (item.dark > 30) { delete v.dataset.berDrawn; out.remove(); videos.delete(item); continue; }
        v.dataset.berDrawn = "";
      } catch {
        v.dataset.berHide = "";
        v.ownerDocument.documentElement.dataset.berNoCanvas = "";
        out.remove();
        videos.delete(item);
      }
    }
  }, 100);

  // ============================================================ icons as words

  // [label pattern, word, on?] — the first match wins. "on" marks a switched-on state.
  const WORDS = [
    [/^Go back$/, "back"], [/^Go forward$/, "fwd"], [/^Home$/, "home"], [/^Browse$/, "browse"],
    [/^What's New$/, "news"], [/^Listening activity$/, "friends"], [/^Marketplace$/, "market"],
    [/^Clear search field$/, "clear"],
    [/^(Save|Add) .*to Your Library$/i, "save"], [/^Remove .*from Your Library$/i, "saved", true],
    [/^Expand Your Library/i, "expand"], [/Your Library$/, "lib"], [/^Create$/, "new"],
    [/^Previous$/, "prev"], [/^Next$/, "next"],
    [/^Enable smart shuffle/i, "shuffle: on", true], [/^Disable shuffle/i, "shuffle: smart", true],
    [/^Enable shuffle/i, "shuffle: off"], [/^Shuffle/i, "shuffle"],
    [/^Enable repeat one$/i, "repeat: all", true], [/^Disable repeat$/i, "repeat: one", true],
    [/^Enable repeat$/i, "repeat: off"],
    [/^Lyrics$/, "lyrics"], [/lyrics/i, "lyrics"], [/^Queue$/, "queue"], [/^Connect to a device$/, "devices"],
    [/^Mute$/, "vol"], [/^Unmute$/, "muted", true], [/Miniplayer$/i, "mini"],
    [/^Exit full screen/i, "exit"], [/Full screen$/i, "full"],
    [/^Add to playlist$/, "liked", true], [/^Remove from Liked/i, "liked", true], [/^Add to Liked/i, "like"],
    [/^More options/i, "..."], [/^More$/, "..."], [/^Download/i, "download"], [/^Remove download/i, "downloaded", true],
    [/^Unfollow|^Following/i, "following", true], [/^Follow/i, "follow"],
    [/^Copy link/i, "link"], [/^Search in/i, "find"], [/^Search$/, "find"],
    [/^Hide Now Playing view/i, "close"], [/^Show Now Playing view/i, "np"], [/^Now playing/i, "np"],
    [/^Expand Now Playing view/i, "expand"], [/^Minimi[sz]e/i, "minimize"], [/^Collapse/i, "collapse"], [/^Close/i, "close"],
    [/^Change visible columns/i, "cols"], [/settings$/i, "settings"], [/^Edit/i, "edit"], [/^Share/i, "share"],
    [/^Install$/, "install"], [/^Remove$/, "remove"],
    [/^Pause/i, "pause"], [/^Play/i, "play"],
  ];

  // Track rows have narrow slots, so they get one-character marks.
  const SHORT = { play: ">", pause: "=", liked: "*", like: "+", "...": "...", np: ">" };

  // The miniplayer is narrow, so its transport gets short marks.
  const MINI = {
    prev: "<<", next: ">>", play: ">", pause: "=", shuffle: "shf", "shuffle: off": "shf", "shuffle: on": "shf+",
    "shuffle: smart": "shf*", "repeat: off": "rpt", "repeat: all": "rpt+", "repeat: one": "rpt1",
  };

  const HOST = 'button, a, [role="button"], [role="tab"], [role="radio"], [role="link"], [role="menuitem"], ' +
    '[role="menuitemradio"], [role="menuitemcheckbox"], [role="checkbox"], [role="switch"], [role="option"], ' +
    '.spicetify-sc-chevronBtn, .search-searchCategory-carouselButton';

  // Text a person can actually see (screen-reader-only labels do not count).
  function shownText(el) {
    const walk = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (!n.textContent.trim() || n.parentElement.closest("[data-ber-hide]")) continue;
      const r = n.parentElement.getBoundingClientRect();
      if (r.width > 2 && r.height > 2) return true;
    }
    return false;
  }

  function labelOf(host, svg) {
    return host.getAttribute("aria-label") || host.getAttribute("title") ||
      svg?.getAttribute("aria-label") || svg?.querySelector("title")?.textContent || "";
  }

  function arrow(host) {
    const c = typeof host.className === "string" ? host.className : "";
    const t = host.dataset.testid || "";
    if (/chevronStart|--start|button-start|Left|prev/i.test(c + t)) return "<";
    if (/chevronEnd|--end|button-end|Right|next/i.test(c + t)) return ">";
    if (/carouselButton/.test(c)) {
      const p = host.parentElement.getBoundingClientRect(), r = host.getBoundingClientRect();
      return r.left + r.width / 2 < p.left + p.width / 2 ? "<" : ">";
    }
    if (/dj-button/.test(host.innerHTML)) return "dj";
    return "";
  }

  function word(host, svg) {
    // Only real controls get a word, never a region that happens to carry a label.
    if (host.dataset.testid === "cover-art-button" || !host.matches(HOST)) return;
    svg = svg || host.querySelector("svg");
    const label = labelOf(host, svg);
    const always = host.dataset.testid === "user-widget-link";
    if (!always && (!svg || shownText(host))) {
      if (host.dataset.berWord) { delete host.dataset.berWord; delete host.dataset.berOn; }
      return;
    }
    let w, on;
    if (host.dataset.testid === "user-widget-link") w = label.toLowerCase();
    else for (const [re, text, isOn] of WORDS) if (re.test(label)) { w = text; on = isOn; break; }
    if (!w) w = arrow(host);
    if (!w && label) {
      // Unlisted: the control's own label, shortened.
      w = label.toLowerCase().replace(/:.*$/, "").replace(/\s+(for|to|from|by|in|on|of|with)\s.*$/, "");
      if (w.length > 16) w = w.split(/\s+/).slice(0, 2).join(" ");
    }
    // The miniplayer's own close button, in its drag bar, has no label.
    if (!w && host.closest('[style*="mini-player-drag"]')) w = "close";
    // A filter chip that is only a cross clears the filter.
    if (!w && host.getAttribute("role") === "option") w = "x";
    if (!w) w = "?";
    const inRow = host.closest(".main-trackList-trackListRow");
    const inMini = host.ownerDocument !== document;
    const text = inRow && SHORT[w] ? SHORT[w] : `[${inMini && MINI[w] || w}]`;
    if (host.dataset.berWord !== text) host.dataset.berWord = text;
    const pressed = host.getAttribute("aria-pressed") === "true" || host.getAttribute("aria-checked") === "true" ||
      host.getAttribute("aria-selected") === "true";
    if (on || pressed) host.dataset.berOn = ""; else delete host.dataset.berOn;
  }

  function iconify(svg) {
    if (svg.closest("[data-ber-word], .ber-keep")) return;
    const host = svg.closest(HOST);
    // A link that shows a picture (a cover) keeps the picture; only the icon goes.
    if (host && !(host.tagName === "A" && host.querySelector("img")) && (!shownText(host) || host.dataset.testid === "user-widget-link")) word(host, svg);
    else svg.dataset.berHide = ""; // decorative, beside words that already say it
  }

  // Buttons Spotify shows only on hover fade an inner part; the word follows it.
  let syncing = false;
  function syncHover() {
    if (syncing) return;
    syncing = true;
    requestAnimationFrame(() => {
      syncing = false;
      for (const doc of docs) {
        doc.querySelectorAll(".main-playButton-PlayButton [data-ber-word]").forEach((b) => {
          const inner = b.firstElementChild;
          const shown = !inner || parseFloat(getComputedStyle(inner).opacity) > 0.5;
          if (shown) delete b.dataset.berAway; else b.dataset.berAway = "";
        });
      }
    });
  }

  // ============================================================ no washes

  let signal = "";
  function chromatic(c) {
    const m = c.match(/rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)/);
    if (!m) return false;
    const [r, g, b] = [+m[1], +m[2], +m[3]];
    const a = m[4] === undefined ? 1 : +m[4];
    if (a < 0.25) return false;
    if (c === signal) return false;
    return Math.max(r, g, b) - Math.min(r, g, b) > 40;
  }

  // Colour washes, tinted boxes and gradients Spotify paints from the artwork go flat.
  function flatten(el) {
    if (el.dataset.berArt !== undefined || /^(IMG|CANVAS|VIDEO|svg|path)$/i.test(el.tagName)) return;
    const cs = getComputedStyle(el);
    const bi = cs.backgroundImage;
    if (bi !== "none" && /gradient/.test(bi) && !/url\(/.test(bi)) el.dataset.berFlat = "";
    else if (chromatic(cs.backgroundColor)) el.dataset.berTint = "";
    for (const p of ["::before", "::after"]) {
      const ps = getComputedStyle(el, p);
      if (ps.content === "none") continue;
      if (/gradient/.test(ps.backgroundImage) || chromatic(ps.backgroundColor)) { el.dataset.berFlatPseudo = ""; break; }
    }
  }

  const pending = new Set();
  function reflatten(el) {
    if (!pending.size) requestAnimationFrame(() => {
      for (const root of pending) { flatten(root); root.querySelectorAll("*").forEach(flatten); }
      pending.clear();
    });
    pending.add(el);
  }

  // ============================================================ text bars

  function bar(container, fraction, head) {
    if (!container) return;
    let t = container.querySelector(":scope > .ber-bar");
    if (!t) {
      t = container.ownerDocument.createElement("span");
      t.className = "ber-bar";
      t.setAttribute("aria-hidden", "true");
      container.prepend(t);
    }
    const cell = parseFloat(getComputedStyle(t).fontSize) * RATIO;
    const n = Math.max(4, Math.floor(container.clientWidth / cell) - 2);
    const f = Math.max(0, Math.min(1, fraction || 0));
    const filled = Math.round(f * n);
    const text = head
      ? "[" + "=".repeat(Math.max(0, filled - 1)) + (filled ? ">" : "") + "-".repeat(n - filled) + "]"
      : "[" + "|".repeat(filled) + ".".repeat(n - filled) + "]";
    if (t.textContent !== text) t.textContent = text;
  }

  function bars() {
    for (const doc of docs) {
      doc.querySelectorAll('[data-testid="playback-progressbar"]').forEach((c) => bar(c, Spicetify.Player.getProgressPercent(), true));
      doc.querySelectorAll(".volume-bar__slider-container").forEach((c) => bar(c, Spicetify.Player.getVolume(), false));
    }
  }

  // ============================================================ prompt

  function where(pathname) {
    if (pathname.startsWith("/search")) pathname = "/search"; // the query is already in the box
    const parts = pathname.split("/").filter(Boolean).map((p) => (p.length > 16 ? p.slice(0, 8) : p));
    return parts.length ? "~/" + parts.join("/") : "~";
  }

  function prompt() {
    const wrap = document.querySelector(".main-globalNav-searchInputWrapper");
    if (!wrap) return;
    const user = document.querySelector('[data-testid="user-widget-link"]')?.getAttribute("aria-label") || "you";
    const path = Spicetify.Platform.History.location?.pathname || location.pathname;
    const text = `${user.toLowerCase()}@spotify:${where(path)}$`;
    if (wrap.dataset.berPrompt !== text) wrap.dataset.berPrompt = text;
  }

  // ============================================================ window buttons

  // macOS draws close / minimise / zoom in the top-left 78pt of the window, in screen
  // points; Spotify's page is zoomed, so convert and keep [back] to the right of them.
  function clearLights() {
    const back = document.querySelector('button[aria-label="Go back"]');
    if (!back) return;
    const root = document.documentElement;
    const current = parseFloat(root.style.getPropertyValue("--ber-lights-shift")) || 0;
    const zoom = window.outerWidth / window.innerWidth || 1;
    const lightsEnd = 84 / zoom;
    const natural = back.getBoundingClientRect().left - current;
    const shift = Math.max(0, Math.ceil(lightsEnd - natural));
    if (shift !== current) root.style.setProperty("--ber-lights-shift", shift + "px");
  }

  // ============================================================ wiring

  const docs = new Set();
  const seen = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) imgArt(e.target);
  }, { rootMargin: "300px" });
  const sized = new ResizeObserver((entries) => {
    for (const e of entries) if (e.target.isConnected) (e.target.tagName === "IMG" ? imgArt : bgArt)(e.target);
  });

  function watchImg(img, lazy) {
    if (img.dataset.ber) return;
    img.dataset.ber = "1";
    if (lazy) seen.observe(img); else imgArt(img);
    sized.observe(img);
    img.addEventListener("load", () => imgArt(img));
  }

  function sweep(root, lazy) {
    const all = root.querySelectorAll ? root.querySelectorAll("*") : [];
    const one = (el) => {
      switch (el.tagName) {
        case "IMG": watchImg(el, lazy); return;
        case "VIDEO": videoArt(el); return;
        case "svg": iconify(el); return;
      }
      if (el.dataset?.testid === "user-widget-link") word(el);
      if (el.style?.backgroundImage) { bgArt(el); sized.observe(el); }
      flatten(el);
    };
    if (root.nodeType === 1) one(root);
    all.forEach(one);
  }

  function attach(doc, lazy) {
    if (docs.has(doc)) return;
    docs.add(doc);
    new MutationObserver((records) => {
      for (const r of records) {
        const t = r.target;
        if (r.type === "attributes") {
          if (r.attributeName === "style") {
            if (t.tagName !== "IMG" && t.style.backgroundImage && !/url\(["']?data:/.test(t.style.backgroundImage)) {
              drawn.delete(t);
              bgArt(t);
            }
            if (t.style.backgroundColor || t.style.backgroundImage) flatten(t);
            // Colours handed down as variables (cinema mode, extracted entity colours) reach the children.
            if (/--[\w-]*(colou?r|bg)[\w-]*\s*:/i.test(t.getAttribute("style") || "")) reflatten(t);
            continue;
          }
          if (t.tagName === "IMG") {
            t.style.removeProperty("content");
            drawn.delete(t);
            imgArt(t);
            continue;
          }
          if (t.matches?.(HOST) && (t.dataset.berWord !== undefined || t.querySelector("svg"))) word(t);
          continue;
        }
        r.addedNodes.forEach((n) => n.nodeType === 1 && sweep(n, lazy));
      }
      if (doc === document) prompt();
    }).observe(doc.body, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: ["src", "srcset", "style", "aria-label", "aria-pressed", "aria-checked", "aria-selected"],
    });
    doc.addEventListener("pointerover", syncHover, true);
    doc.addEventListener("transitionend", syncHover, true);
    sweep(doc.body, lazy);
  }

  // ============================================================ miniplayer

  // The miniplayer is a separate window; it gets the same stylesheets and the same treatment.
  function adopt(win) {
    const doc = win.document;
    const add = () => {
      for (const link of document.querySelectorAll('link[rel="stylesheet"][href*="user.css"], link[rel="stylesheet"][href*="colors.css"]')) {
        if (doc.querySelector(`link[href="${link.href}"]`)) continue;
        const l = doc.createElement("link");
        l.rel = "stylesheet";
        l.href = link.href;
        doc.head.appendChild(l);
      }
      for (const s of document.querySelectorAll("style")) {
        if (!/--spice-|ber/.test(s.textContent)) continue;
        const c = doc.createElement("style");
        c.textContent = s.textContent;
        doc.head.appendChild(c);
      }
      if (faceData) doc.fonts.add(new win.FontFace("ber", faceData.slice(0), { weight: "100 1000" }));
      doc.documentElement.classList.add("ber-mini");
      attach(doc, false);
    };
    if (doc.body) add(); else win.addEventListener("load", add, { once: true });
  }
  window.documentPictureInPicture?.addEventListener("enter", (e) => adopt(e.window));
  if (window.documentPictureInPicture?.window) adopt(window.documentPictureInPicture.window);

  // ============================================================ start

  // The face ships in assets/fonts. A Marketplace install has no local assets folder,
  // so if the face did not load, it is fetched from the repo and added directly.
  const FONT_URL = "https://cdn.jsdelivr.net/gh/mkeawe/ber-cli@main/assets/fonts/DepartureMono-Regular.woff2";
  let faceData = null;
  async function face() {
    await document.fonts.load(`12px ${FACE}`).catch(() => {});
    if ([...document.fonts].some((f) => f.family.replace(/"/g, "") === "ber" && f.status === "loaded")) return;
    try {
      const data = await (await fetch(FONT_URL)).arrayBuffer();
      faceData = data;
      const f = new FontFace("ber", data, { weight: "100 1000" });
      await f.load();
      document.fonts.add(f);
    } catch {
      // No network: Menlo stands in.
    }
  }

  face().finally(() => {
    measure();
    signal = getComputedStyle(document.documentElement).getPropertyValue("--spice-button").trim();
    const probe = document.createElement("i");
    probe.style.backgroundColor = signal;
    document.body.appendChild(probe);
    signal = getComputedStyle(probe).backgroundColor;
    probe.remove();
    attach(document, true);
  });
  Spicetify.Platform.History.listen(() => { prompt(); setTimeout(() => reflatten(document.body), 1500); });
  window.addEventListener("resize", clearLights);
  setInterval(clearLights, 2000);
  setInterval(syncHover, 1000);
  clearLights();
  Spicetify.Player.addEventListener("onprogress", bars);
  setInterval(bars, 500);
  prompt();
  bars();
})();
