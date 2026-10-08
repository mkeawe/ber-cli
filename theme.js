// ber-cli — the parts CSS cannot do:
//   pictures (covers, artist photos, Canvas video, Spotify's own animations) redrawn as
//   coloured characters, every icon replaced by a word, colour washes and gradients
//   flattened, progress and volume drawn as text bars, the search box turned into a shell
//   prompt that knows where you are, and all of it carried into the miniplayer window too.

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

  // A Map that forgets its oldest entries, so a long session never piles up decoded images.
  function bounded(limit) {
    const m = new Map();
    const set = m.set.bind(m);
    m.set = (k, v) => { set(k, v); if (m.size > limit) m.delete(m.keys().next().value); return m; };
    return m;
  }
  const pixels = bounded(48); // src -> Promise<HTMLImageElement | null>
  const arts = bounded(400); // src|w|h -> Promise<dataURL | null>

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

  const sampleCanvas = document.createElement("canvas");

  // Draws any picture source (image or video frame) as characters into `out`.
  // With `cover`, the source is cropped to the box the way object-fit: cover does.
  // Returns the summed brightness, so a protected (blacked-out) video can be told apart.
  function paint(source, w, h, out, cover) {
    const cols = Math.max(6, Math.round(w / CELL));
    const size = w / cols / RATIO;
    const rows = Math.max(3, Math.round(h / (size * 1.2)));
    const lineH = h / rows;

    const sample = sampleCanvas;
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
    // Clear, not filled: the screen shows through between characters, so drawings
    // stay right when the scheme changes.
    ctx.clearRect(0, 0, w, h);
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

  // Drawing waits for an idle moment, so it never competes with typing or scrolling.
  const idle = (v) => new Promise((res) => window.requestIdleCallback
    ? requestIdleCallback(() => res(v), { timeout: 800 })
    : setTimeout(() => res(v), 0));

  function art(src, w, h) {
    const key = `${src}|${w}x${h}`;
    if (!arts.has(key)) {
      arts.set(key, load(readable(src)).then(idle).then((im) => {
        if (!im) return null;
        try {
          const out = document.createElement("canvas");
          paint(im, w, h, out);
          // Encoded off the main thread, so drawing many covers never stalls typing. A data
          // URL, not a blob URL: nothing to revoke, and it lives only as long as its element.
          return new Promise((res) => out.toBlob((b) => {
            if (!b) return res(null);
            const r = new FileReader();
            r.onload = () => res(r.result);
            r.onerror = () => res(null);
            r.readAsDataURL(b);
          }));
        } catch {
          return null;
        }
      }));
    }
    return arts.get(key);
  }

  // A picture Spotify won't let the theme read (the DJ's artwork) is drawn from scratch:
  // a ring in the signal colour, rendered in characters like every other cover.
  const rings = new Map();
  function ring(w, h) {
    const key = `${w}x${h}`;
    if (!rings.has(key)) {
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const x = c.getContext("2d");
      x.fillStyle = "#000"; x.fillRect(0, 0, w, h);
      x.strokeStyle = css("--spice-button") || "#5fd75f";
      x.lineWidth = Math.max(4, Math.min(w, h) * 0.22);
      x.beginPath();
      x.arc(w / 2, h / 2, Math.min(w, h) * 0.28, 0, Math.PI * 2);
      x.stroke();
      const out = document.createElement("canvas");
      paint(c, w, h, out);
      rings.set(key, out.toDataURL());
    }
    return rings.get(key);
  }

  const drawn = new WeakMap(); // element -> key it was drawn for

  // Sizes come from the observers when they have them, so no image is measured twice.
  async function imgArt(img, sw, sh) {
    // Marketplace previews are screenshots of themes and extensions: left as they are.
    if (img.closest('[class*="marketplace-card"]')) return;
    const src = img.currentSrc || img.src;
    if (!src || src.startsWith("data:")) return;
    const w = Math.round(sw ?? img.clientWidth);
    const h = Math.round(sh ?? img.clientHeight);
    if (!w || !h) return;
    // Too small to draw in characters (menu and list icons): it goes.
    if (w < 20 || h < 20) { img.dataset.berHide = ""; return; }
    const key = `${src}|${w}x${h}`;
    if (drawn.get(img) === key) return;
    drawn.set(img, key);
    let url = await art(src, w, h);
    if (url) delete img.dataset.berRing; else { url = ring(w, h); img.dataset.berRing = ""; }
    if ((img.currentSrc || img.src) !== src) return;
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

  // Moving pictures drawn live as characters, ten frames a second: video (Canvas loops,
  // music videos) and Spotify's own animations on <canvas> (the DJ's ring).
  // A video that can't be read is hidden and the cover shows; one that reads as solid black
  // (protected video) is left to play as it is. An animation that can't be read gets the ring.
  const movers = new Set();
  function moverArt(v) {
    if (v.dataset.berMover || v.classList.contains("ber-video")) return;
    v.dataset.berMover = "1";
    const out = v.ownerDocument.createElement("canvas");
    out.className = "ber-video";
    v.after(out);
    const video = v.tagName === "VIDEO";
    movers.add({ v, out, dark: 0, video, cover: video && getComputedStyle(v).objectFit === "cover" });
  }
  setInterval(() => {
    for (const item of movers) {
      const { v, out } = item;
      if (!v.isConnected) { out.remove(); movers.delete(item); continue; }
      const w = Math.round(v.clientWidth), h = Math.round(v.clientHeight);
      if (w < 40 || h < 40 || (item.video && v.readyState < 2)) continue;
      out.style.cssText = `position:absolute;left:${v.offsetLeft}px;top:${v.offsetTop}px;width:${w}px;height:${h}px;pointer-events:none;`;
      if (item.still) continue;
      try {
        const light = paint(v, w, h, out, item.cover);
        item.dark = light < 1 && !(item.video && v.paused) ? item.dark + 1 : 0;
        if (item.dark > 30) {
          if (item.video) { delete v.dataset.berDrawn; out.remove(); movers.delete(item); continue; }
          still(item, w, h);
          continue;
        }
        v.dataset.berDrawn = "";
      } catch {
        if (item.video) {
          v.dataset.berHide = "";
          v.ownerDocument.documentElement.dataset.berNoCanvas = "";
          out.remove();
          movers.delete(item);
        } else {
          still(item, w, h);
        }
      }
    }
  }, 100);

  function still(item, w, h) {
    item.still = true;
    item.v.dataset.berDrawn = "";
    const im = new Image();
    im.onload = () => {
      const dpr = window.devicePixelRatio || 1;
      item.out.width = Math.round(w * dpr); item.out.height = Math.round(h * dpr);
      item.out.getContext("2d").drawImage(im, 0, 0, item.out.width, item.out.height);
    };
    im.src = ring(w, h);
  }

  // ============================================================ icons as words

  // [label pattern, word, on?] — the first match wins. "on" marks a switched-on state.
  const WORDS = [
    [/^Go back$/, "back"], [/^Go forward$/, "fwd"], [/^Home$/, "home"], [/^Browse$/, "browse"],
    [/^What's New$/, "news"], [/^Listening activity$/, "friends"], [/^Marketplace$/, "market"],
    [/^Clear search field$/, "clear"],
    [/^(Save|Add) .*to Your Library$/i, "save"], [/^Remove .*from Your Library$/i, "saved", true],
    [/^Expand Your Library/i, "expand"], [/^(Open|Collapse) Your Library$/i, "lib"], [/^Create$/, "new"],
    [/^Previous$/, "prev"], [/^Next$/, "next"],
    [/^Enable smart shuffle/i, "shuffle: on", true], [/^Disable shuffle/i, "shuffle: smart", true],
    [/^Enable shuffle/i, "shuffle: off"], [/^Shuffle/i, "shuffle"],
    [/^Enable repeat one$/i, "repeat: all", true], [/^Disable repeat$/i, "repeat: one", true],
    [/^Enable repeat$/i, "repeat: off"],
    [/lyrics/i, "lyrics"], [/^Queue$/, "queue"], [/^Connect to a device$/, "devices"],
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
  const SHORT = { play: ">", pause: "=", liked: "*", like: "+", np: ">" };

  // The miniplayer is narrow, so its transport gets short marks.
  const MINI = {
    prev: "<<", next: ">>", play: ">", pause: "=", shuffle: "shf", "shuffle: off": "shf", "shuffle: on": "shf+",
    "shuffle: smart": "shf*", "repeat: off": "rpt", "repeat: all": "rpt+", "repeat: one": "rpt1",
  };

  const HOST = 'button, a, [role="button"], [role="tab"], [role="radio"], [role="link"], [role="menuitem"], ' +
    '[role="menuitemradio"], [role="menuitemcheckbox"], [role="checkbox"], [role="switch"], [role="option"], ' +
    '.spicetify-sc-chevronBtn, .search-searchCategory-carouselButton';

  // Text a person can actually see (screen-reader-only labels do not count).
  // Decided from the markup alone, so it never forces a layout.
  const UNSEEN = '[data-ber-hide], .hidden-visually, [class*="visually-hidden"], [class*="sr-only"]';
  function shownText(el) {
    const walk = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (n.textContent.trim() && !n.parentElement.closest(UNSEEN)) return true;
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

  function setWord(host, text) {
    if (host.dataset.berWord !== text) host.dataset.berWord = text;
  }

  function word(host, svg) {
    // Only real controls get a word, never a region that happens to carry a label.
    if (host.dataset.testid === "cover-art-button" || !host.matches(HOST)) return;
    svg = svg || host.querySelector("svg");
    const label = labelOf(host, svg);
    // Controls that show their own text but get a key anyway: the account name, and the
    // library title, which reads [lib] in both its collapsed and expanded states.
    const always = host.dataset.testid === "user-widget-link" || /^(Open|Collapse) Your Library$/.test(label);
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
    // A search suggestion's magnifier: the line reads like a command to run.
    if (!w && (host.getAttribute("href") || "").startsWith("/search/")) { setWord(host, ">"); return; }
    // Anything else unlabelled is decoration: the icon goes and nothing replaces it.
    if (!w) {
      if (host.dataset.berWord) delete host.dataset.berWord;
      if (svg) svg.dataset.berHide = "";
      return;
    }
    const inRow = host.closest(".main-trackList-trackListRow");
    const inMini = host.ownerDocument !== document;
    const text = inRow && SHORT[w] ? SHORT[w] : `[${inMini && MINI[w] || w}]`;
    setWord(host, text);
    const pressed = host.getAttribute("aria-pressed") === "true" || host.getAttribute("aria-checked") === "true" ||
      host.getAttribute("aria-selected") === "true";
    if (on || pressed) host.dataset.berOn = ""; else delete host.dataset.berOn;
  }

  // An icon standing in for a missing cover (Local Files, a playlist with no picture) is
  // drawn in characters, in the signal colour, filling the cover's square like any cover.
  // Where a cover lives: card and header image boxes, and the picture slot of a library row.
  const COVER_BOX = '[class*="imageContainer"], [class*="imageWrapper"], [class*="coverArt"], [class*="entityImage"], [class*="list-row__header-side"]';
  function stand(svg) {
    const box = svg.parentElement;
    if (!box || box.dataset.berArt !== undefined || !box.closest(COVER_BOX) || box.querySelector("img")) return false;
    const b = box.getBoundingClientRect(), i = svg.getBoundingClientRect();
    if (b.width < 40 || b.height < 40 || Math.abs(b.width - b.height) > 4 || i.width >= b.width * 0.9) return false;
    const w = Math.round(b.width), h = Math.round(b.height);
    const copy = svg.cloneNode(true);
    copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    copy.setAttribute("width", 100); copy.setAttribute("height", 100);
    copy.setAttribute("fill", css("--spice-button") || "#5fd75f");
    copy.removeAttribute("class"); copy.removeAttribute("style");
    const im = new Image();
    im.onload = () => {
      const src = document.createElement("canvas");
      src.width = w; src.height = h;
      const x = src.getContext("2d");
      x.fillStyle = "#000"; x.fillRect(0, 0, w, h);
      const s = Math.min(w, h) * 0.8;
      x.drawImage(im, (w - s) / 2, (h - s) / 2, s, s);
      const out = document.createElement("canvas");
      try { paint(src, w, h, out); } catch { return; }
      box.dataset.berArt = "";
      box.dataset.berStand = "";
      // The placeholder squares around it (same size) lose their grey fill and edge.
      for (let a = box.parentElement; a; a = a.parentElement) {
        const r = a.getBoundingClientRect();
        if (Math.abs(r.width - w) > 2 || Math.abs(r.height - h) > 2) break;
        a.dataset.berFrame = "";
      }
      box.style.setProperty("background", `url(${out.toDataURL()}) center / 100% 100% no-repeat`, "important");
    };
    im.src = "data:image/svg+xml," + encodeURIComponent(new XMLSerializer().serializeToString(copy));
    svg.dataset.berHide = "";
    return true;
  }

  function iconify(svg) {
    if (svg.closest("[data-ber-word], .ber-keep")) return;
    if (stand(svg)) return;
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

  // The scheme's own colours, as "r,g,b": never mistaken for a wash, however colourful.
  const own = new Set();
  const OWN_KEYS = ["main", "main-elevated", "highlight", "highlight-elevated", "sidebar", "player", "card",
    "misc", "text", "subtext", "button", "button-active", "tab-active", "notification", "notification-error"];
  let ownKey = "";
  const ownNow = () => OWN_KEYS.map((k) => css(`--spice-rgb-${k}`).replace(/\s/g, "")).filter(Boolean);
  function readOwn() {
    const vals = ownNow();
    own.clear();
    vals.forEach((v) => own.add(v));
    ownKey = vals.join("|");
  }

  // The scheme can be changed live (the Marketplace dropdown). When it is, everything judged
  // against the old colours is judged again, and the signal-colour drawings are redrawn.
  function schemeWatch() {
    const key = ownNow().join("|");
    if (!key || key === ownKey) return;
    readOwn();
    rings.clear();
    for (const doc of docs) {
      doc.querySelectorAll("[data-ber-tint], [data-ber-flat], [data-ber-flat-pseudo], [data-ber-grey]").forEach((el) => {
        delete el.dataset.berTint; delete el.dataset.berFlat; delete el.dataset.berFlatPseudo; delete el.dataset.berGrey;
      });
      doc.querySelectorAll("[data-ber-placeholder]").forEach((el) => { el.style.removeProperty("background-image"); delete el.dataset.berPlaceholder; });
      doc.querySelectorAll("img[data-ber-ring]").forEach((img) => { drawn.delete(img); imgArt(img); });
      doc.querySelectorAll("[data-ber-stand]").forEach((box) => {
        delete box.dataset.berStand; delete box.dataset.berArt; box.style.removeProperty("background");
        const svg = box.querySelector("svg"); if (svg) { delete svg.dataset.berHide; stand(svg); }
      });
      reflatten(doc.body);
    }
  }
  function chromatic(c) {
    const m = c.match(/rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)/);
    if (!m) return false;
    const [r, g, b] = [+m[1], +m[2], +m[3]];
    const a = m[4] === undefined ? 1 : +m[4];
    if (a < 0.25) return false;
    if (own.has(`${r},${g},${b}`)) return false;
    return Math.max(r, g, b) - Math.min(r, g, b) > 40;
  }

  // Spotify's hard-coded greys (loading bars, placeholders) take the scheme's row colour.
  function stray(c) {
    const m = c.match(/rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)/);
    if (!m) return false;
    const [r, g, b] = [+m[1], +m[2], +m[3]];
    const a = m[4] === undefined ? 1 : +m[4];
    if (own.has(`${r},${g},${b}`) || Math.max(r, g, b) - Math.min(r, g, b) > 8) return false;
    // Solid dark greys, and the see-through black or white Spotify lays over its own
    // background for loading bars (only an even grey over a black screen).
    return (a >= 0.5 && r > 12 && r < 90) || (a >= 0.05 && a < 0.95 && (r <= 12 || r >= 240));
  }

  // Colour washes, tinted boxes and gradients Spotify paints from the artwork go flat.
  // Only boxes can paint a wash; text and inline elements are skipped.
  const BOXES = /^(DIV|SECTION|ASIDE|HEADER|FOOTER|MAIN|NAV|LI|UL|BUTTON|A|SPAN|P|LABEL)$/;

  // Reads only: returns the attribute to set, so a batch can read everything first and
  // write after, instead of making the browser redo its layout between every element.
  function washOf(el) {
    if (!BOXES.test(el.tagName) || el.dataset.berArt !== undefined) return null;
    const cs = getComputedStyle(el);
    const bi = cs.backgroundImage;
    if (/placeholder\.(webp|png|svg)/.test(bi)) return "berPlaceholder";
    if (bi !== "none" && /gradient/.test(bi) && !/url\(/.test(bi)) return "berFlat";
    if (chromatic(cs.backgroundColor)) return "berTint";
    // Small boxes only: a full-screen dimming layer behind a dialog stays as it is.
    if (stray(cs.backgroundColor) && el.offsetWidth < 600 && el.offsetHeight < 400) return "berGrey";
    if (el.tagName !== "DIV") return null;
    for (const p of ["::before", "::after"]) {
      const ps = getComputedStyle(el, p);
      if (ps.content === "none") continue;
      if (/gradient/.test(ps.backgroundImage) || chromatic(ps.backgroundColor)) return "berFlatPseudo";
    }
    return null;
  }

  // Reads every element first, then writes, so the browser lays the page out once.
  function flattenAll(els) {
    const washes = [];
    for (const el of els) {
      const k = washOf(el);
      if (k) washes.push([el, k]);
    }
    for (const [el, k] of washes) {
      el.dataset[k] = "";
      if (k === "berPlaceholder") placeholder(el);
    }
  }

  // Spotify tiles a picture of rounded grey rows while a list loads. It is redrawn as the
  // same rows, square, in the scheme's row colour.
  function placeholder(el) {
    const size = getComputedStyle(el).backgroundSize;
    const [w, h] = /px/.test(size) ? size.split(" ").map(parseFloat) : [0, 0];
    if (!w || !h) { el.style.setProperty("background-image", "none", "important"); return; }
    const c = css("--spice-highlight") || "#171717";
    const art = Math.min(h - 16, 48);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
      `<rect x="8" y="${(h - art) / 2}" width="${art}" height="${art}" fill="${c}"/>` +
      `<rect x="${art + 20}" y="${h / 2 - 12}" width="${Math.round((w - art - 28) * 0.8)}" height="9" fill="${c}"/>` +
      `<rect x="${art + 20}" y="${h / 2 + 4}" width="${Math.round((w - art - 28) * 0.5)}" height="9" fill="${c}"/></svg>`;
    el.style.setProperty("background-image", `url("data:image/svg+xml,${encodeURIComponent(svg)}")`, "important");
  }

  // Elements (and, for roots, their subtrees) to judge again at the next frame.
  const pending = new Set();
  const pendingRoots = new Set();
  function schedule() {
    if (pending.size || pendingRoots.size) return;
    requestAnimationFrame(() => {
      const els = [...pending];
      for (const root of pendingRoots) { els.push(root); for (const el of root.querySelectorAll("*")) els.push(el); }
      pending.clear(); pendingRoots.clear();
      flattenAll(els);
    });
  }
  function reflatten(root) { schedule(); pendingRoots.add(root); }
  function recheck(el) { schedule(); pending.add(el); }

  // ============================================================ text bars

  const widths = new WeakMap();
  let cellPx = 0;
  function bar(container, fraction, head) {
    if (!container) return;
    let t = container.querySelector(":scope > .ber-bar");
    if (!t) {
      t = container.ownerDocument.createElement("span");
      t.className = "ber-bar";
      t.setAttribute("aria-hidden", "true");
      container.prepend(t);
    }
    // Width is measured when the slot changes size, not on every update.
    if (!widths.has(container)) {
      widths.set(container, container.clientWidth);
      new ResizeObserver(([e]) => widths.set(container, e.contentRect.width)).observe(container);
    }
    if (!cellPx) cellPx = parseFloat(getComputedStyle(t).fontSize) * RATIO;
    // Characters that fit, less the two brackets, with a pixel of slack for rounding.
    const n = Math.max(1, Math.floor((widths.get(container) - 1) / cellPx) - 2);
    const f = Math.max(0, Math.min(1, fraction || 0));
    const filled = Math.round(f * n);
    const text = head
      ? "[" + "=".repeat(Math.max(0, filled - 1)) + (filled ? ">" : "") + "-".repeat(n - filled) + "]"
      : "[" + "|".repeat(filled) + ".".repeat(n - filled) + "]";
    if (t.textContent !== text) t.textContent = text;
  }

  // Spicetify's player calls throw until a track has loaded after launch.
  function safe(f, fallback) {
    try { const v = f(); return Number.isFinite(v) ? v : fallback; } catch { return fallback; }
  }

  function bars() {
    for (const doc of docs) {
      doc.querySelectorAll('[data-testid="playback-progressbar"]').forEach((c) => bar(c, safe(() => Spicetify.Player.getProgressPercent(), 0), true));
      doc.querySelectorAll(".volume-bar__slider-container").forEach((c) => bar(c, safe(() => Spicetify.Player.getVolume(), 0), false));
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
  // points; with a 6pt gap that is 84pt. Spotify's page is zoomed, so convert and keep
  // [back] to the right of them.
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
    for (const e of entries) if (e.isIntersecting) imgArt(e.target, e.boundingClientRect.width, e.boundingClientRect.height);
  }, { rootMargin: "300px" });
  const sized = new ResizeObserver((entries) => {
    for (const e of entries) {
      if (!e.target.isConnected) continue;
      if (e.target.tagName === "IMG") imgArt(e.target, e.borderBoxSize?.[0]?.inlineSize ?? e.contentRect.width, e.borderBoxSize?.[0]?.blockSize ?? e.contentRect.height);
      else bgArt(e.target);
    }
  });

  function watchImg(img, lazy) {
    if (img.dataset.ber) return;
    img.dataset.ber = "1";
    if (lazy) seen.observe(img); else imgArt(img);
    sized.observe(img);
    img.addEventListener("load", () => imgArt(img));
  }

  function sweep(roots, lazy) {
    const els = [];
    for (const root of roots) {
      if (!root.isConnected) continue;
      if (root.nodeType === 1) els.push(root);
      for (const el of root.querySelectorAll("*")) els.push(el);
    }
    flattenAll(els);
    for (const el of els) {
      switch (el.tagName) {
        case "svg": iconify(el); continue;
        case "VIDEO": case "CANVAS": moverArt(el); continue;
      }
      if (el.dataset?.separator !== undefined && el.textContent.trim() === "•") el.dataset.berDot = "";
      if (el.dataset?.testid === "user-widget-link" || /^(Open|Collapse) Your Library$/.test(el.getAttribute?.("aria-label") || "")) word(el);
    }
    // Pictures last: they measure sizes, once, after the writes.
    for (const el of els) {
      if (el.tagName === "IMG") watchImg(el, lazy);
      else if (el.style?.backgroundImage) { bgArt(el); sized.observe(el); }
    }
  }

  function attach(doc, lazy) {
    if (docs.has(doc)) return;
    docs.add(doc);
    const added = new Set();
    let queued = false;
    new MutationObserver((records) => {
      for (const r of records) {
        const t = r.target;
        if (r.type === "attributes") {
          if (r.attributeName === "style") {
            if (t.tagName !== "IMG" && t.style.backgroundImage && !/url\(["']?data:/.test(t.style.backgroundImage)) {
              drawn.delete(t);
              bgArt(t);
            }
            if (t.style.backgroundColor || t.style.backgroundImage) recheck(t);
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
        r.addedNodes.forEach((n) => n.nodeType === 1 && added.add(n));
      }
      if (added.size && !queued) {
        queued = true;
        requestAnimationFrame(() => {
          queued = false;
          const roots = [...added].filter((n) => ![...added].some((m) => m !== n && m.contains(n)));
          added.clear();
          sweep(roots, lazy);
          syncHover();
          // The search box is rebuilt on some navigations; its prompt is written back.
          if (doc === document) prompt();
        });
      }
    }).observe(doc.body, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: ["src", "srcset", "style", "aria-label", "aria-pressed", "aria-checked", "aria-selected"],
    });
    doc.addEventListener("pointerover", syncHover, true);
    doc.addEventListener("transitionend", syncHover, true);
    sweep([doc.body], lazy);
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
        if (!/--spice-|--ber-|ber-cli/.test(s.textContent)) continue;
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
  // Pinned to main on purpose: the font file never changes between releases.
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
    readOwn();
    // A scheme switch rewrites a style tag in the page head; check only then.
    let pend = 0;
    new MutationObserver(() => { clearTimeout(pend); pend = setTimeout(schemeWatch, 300); })
      .observe(document.head, { childList: true, subtree: true, characterData: true });
    attach(document, true);
  });
  // After a page change, the main view is checked again for colours handed down from artwork
  // (cinema mode, headers). Search results are new nodes the observer already handles.
  let navT = 0;
  Spicetify.Platform.History.listen((loc) => {
    prompt();
    clearTimeout(navT);
    if ((loc?.pathname || "").startsWith("/search")) return;
    navT = setTimeout(() => { const m = document.querySelector(".Root__main-view"); if (m) reflatten(m); }, 1500);
  });
  window.addEventListener("resize", clearLights);
  setInterval(clearLights, 2000);
  clearLights();
  Spicetify.Player.addEventListener("onprogress", bars);
  setInterval(bars, 500);
  prompt();
  bars();
})();
