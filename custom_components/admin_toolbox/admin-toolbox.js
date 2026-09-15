// Admin Toolbox - a sidebar panel, served by the admin_toolbox integration,
// that lists every sidebar panel the viewing user has hidden, plus
// configured external links and a strip of system readings. Vanilla JS, no
// build step, no framework.
console.info("%c ADMIN-TOOLBOX %c 1.0.0 ", "color: white; background: #03a9f4; font-weight: 700;", "color: #03a9f4; background: white; font-weight: 700;");

const VERSION_SUFFIX = "_version_latest";
const STATE_SUFFIX = "_state";
const DEFAULT_STATS = ["sensor.processor_use", "sensor.memory_use_percent", "sensor.disk_use_percent", "sensor.load_1m"];
const STAT_LABELS = {
  processor_use: "CPU",
  memory_use_percent: "Memory",
  disk_use_percent: "Disk",
  load_1m: "Load",
  memory_free: "Free mem",
  swap_use_percent: "Swap",
};

// Escapes text interpolated into HTML - config values and entity attributes
// come from the install and its owner, not from a trusted source.
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[ch]);
}

// The selfh.st icon library: a public app-logo index, fetched only while
// the link form is open and cached in memory (module scope, shared by every
// card instance) plus localStorage for a week, so opening the form again
// costs nothing.
const SELFHST_INDEX_URL = "https://cdn.jsdelivr.net/gh/selfhst/icons@main/index-consolidated.json";
const SELFHST_SVG_BASE = "https://cdn.jsdelivr.net/gh/selfhst/icons@main/svg/";
const SELFHST_CACHE_KEY = "admin-toolbox-selfhst-index";
const SELFHST_CACHE_MS = 7 * 24 * 3600e3;
let selfhstIndexMemory = null;
let selfhstIndexPromise = null;

function readSelfhstCache() {
  try {
    const raw = window.localStorage.getItem(SELFHST_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.rows) || typeof parsed.ts !== "number") return null;
    if (Date.now() - parsed.ts > SELFHST_CACHE_MS) return null;
    return parsed.rows;
  } catch (_) {
    return null;
  }
}

function writeSelfhstCache(rows) {
  try {
    window.localStorage.setItem(SELFHST_CACHE_KEY, JSON.stringify({ rows, ts: Date.now() }));
  } catch (_) {
    // A private window or a full quota loses the cache, not the feature -
    // the index is simply re-fetched next time.
  }
}

// Fetches the consolidated index once per session (or once per 7 days via
// localStorage) and trims each row to the four fields matching needs. Any
// failure - offline, a stricter content policy, a malformed response - is
// swallowed: auto-matching quietly does not happen and the form behaves as
// it does with no index at all.
function loadSelfhstIndex() {
  if (selfhstIndexMemory) return Promise.resolve(selfhstIndexMemory);
  if (selfhstIndexPromise) return selfhstIndexPromise;
  selfhstIndexPromise = (async () => {
    const cached = readSelfhstCache();
    if (cached) {
      selfhstIndexMemory = cached;
      return cached;
    }
    try {
      const res = await fetch(SELFHST_INDEX_URL);
      if (!res.ok) throw new Error(`selfhst index responded ${res.status}`);
      const raw = await res.json();
      const rows = Array.isArray(raw)
        ? raw.map((row) => ({ name: row[0], reference: row[1], light: row[5], dark: row[6] }))
        : [];
      selfhstIndexMemory = rows;
      writeSelfhstCache(rows);
      return rows;
    } catch (_) {
      selfhstIndexMemory = [];
      return [];
    }
  })();
  return selfhstIndexPromise;
}

// Normalises a name for comparison: lowercase, everything but letters and
// digits stripped. "Pi-hole", "pihole" and "Pi Hole" are the same name typed
// differently, not different applications.
function normaliseName(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// Confident match only - exact once punctuation and spacing are normalised
// away, on the app name or its slug. Still not a guess: same name, different
// spelling. Anything less certain is a fuzzy suggestion, never auto-filled.
function findSelfhstMatch(rows, text) {
  const needle = normaliseName(text);
  if (!needle) return null;
  for (const row of rows) {
    if (normaliseName(row.name) === needle || normaliseName(row.reference) === needle) return row;
  }
  return null;
}

// Every substring of length 3, padded with a leading/trailing space so short
// words still contribute edge trigrams.
function trigrams(s) {
  s = "  " + s + " ";
  const out = [];
  for (let i = 0; i < s.length - 2; i++) out.push(s.slice(i, i + 3));
  return out;
}

// Dice coefficient over letter triples: 2 * shared / (A.length + B.length).
// Shared trigrams are counted with multiplicity via a decrementing count map,
// so a repeated trigram cannot be matched twice.
function diceScore(a, b) {
  const aGrams = trigrams(a);
  const bGrams = trigrams(b);
  if (!aGrams.length && !bGrams.length) return 0;
  const counts = new Map();
  for (const g of bGrams) counts.set(g, (counts.get(g) || 0) + 1);
  let shared = 0;
  for (const g of aGrams) {
    const n = counts.get(g) || 0;
    if (n > 0) {
      shared++;
      counts.set(g, n - 1);
    }
  }
  return (2 * shared) / (aGrams.length + bGrams.length);
}

// Ranked guesses only, never auto-applied. Chosen by measurement against the
// real 2894-entry index (see PLAN_TLB_07a): letter-triple similarity beats
// edit distance, which ranks nonsense above the right answer for shortened
// names. Short queries inflate scores past real matches, so anything under 4
// normalised characters suggests nothing at all.
function fuzzySelfhstMatches(rows, text) {
  const q = normaliseName(text);
  if (q.length < 4) return [];
  const scored = [];
  for (const row of rows) {
    const score = Math.max(diceScore(q, normaliseName(row.name)), diceScore(q, normaliseName(row.reference)));
    if (score >= 0.5) scored.push({ row, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 4).map((entry) => entry.row);
}

// Loose substring search for the "Change" picker, capped at `limit` hits.
function searchSelfhst(rows, text, limit) {
  const needle = String(text || "").trim().toLowerCase();
  if (!needle) return [];
  const out = [];
  for (const row of rows) {
    if (String(row.name).toLowerCase().includes(needle) || String(row.reference).toLowerCase().includes(needle)) {
      out.push(row);
      if (out.length >= limit) break;
    }
  }
  return out;
}

function selfhstPlainUrl(reference) {
  return `${SELFHST_SVG_BASE}${reference}.svg`;
}

// True when hass reports its own dark-mode state; falls back to the OS/browser
// preference when hass has not loaded far enough to say.
function isDarkTheme(hass) {
  if (hass && hass.themes && typeof hass.themes.darkMode === "boolean") return hass.themes.darkMode;
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch (_) {
    return false;
  }
}

// Builds the initials for a lettered fallback square from a link's name.
// Splits on whitespace and punctuation so "Pi-hole" counts as two words.
// Two or more words use the first letter of the first two, both upper case;
// one word uses its own first two letters, first upper and second lower; a
// name with no letters or digits at all (punctuation only) has nothing to
// draw from and returns null.
function initialsFor(name) {
  const words = String(name || "").split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (!words.length) return null;
  if (words.length === 1) {
    const word = words[0];
    if (word.length === 1) return word.toUpperCase();
    return word.charAt(0).toUpperCase() + word.charAt(1).toLowerCase();
  }
  return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
}

// Hashes a name to a stable hue so the same name always gets the same
// colour, on any device, on every reload. Saturation and lightness are fixed
// per theme rather than derived from the hash - varying those by name is
// what produces unreadable pale squares.
function squareColours(name, isDark) {
  let hash = 0;
  const text = String(name || "");
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) % 360;
  }
  const hue = (hash + 360) % 360;
  return isDark
    ? { fill: `hsl(${hue}, 45%, 30%)`, text: `hsl(${hue}, 70%, 85%)` }
    : { fill: `hsl(${hue}, 55%, 85%)`, text: `hsl(${hue}, 65%, 28%)` };
}

// Rewrites a selfh.st CDN url to the theme-suited variant. Only a url that
// actually matches the CDN's shape is touched - a url a user typed by hand
// is used exactly as given, whatever it points to.
function themedSelfhstUrl(url, isDark) {
  if (!url || url.indexOf("/gh/selfhst/icons") === -1 || !url.endsWith(".svg")) return url;
  if (/-(light|dark)\.svg$/.test(url)) return url;
  const suffix = isDark ? "-light" : "-dark";
  return url.slice(0, -4) + suffix + ".svg";
}

// A hidden add-on's url_path is its slug, often prefixed with the 8-hex-char
// repository id (e.g. a0d7b954_vscode) - strip that before making a title.
function prettifyUrlPath(urlPath) {
  const withoutPrefix = urlPath.replace(/^[0-9a-f]{8}_/, "");
  return withoutPrefix
    .replace(/[_-]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ") || urlPath;
}

// Rounds a scale label to at most 2 significant decimals with no trailing
// zeros, so a fitted axis reads "4.2" or "18" rather than "4.199999998".
function formatScaleLabel(value) {
  const rounded = Math.round(value * 100) / 100;
  return String(rounded);
}

// Builds the labelled chart inside a reading tile from a series of numbers,
// oldest first. Fewer than two points is not a line, so it draws nothing and
// leaves the tile's trace slot empty but reserved. A percentage always scales
// against the honest 0-100 ceiling; anything else (load average, free memory)
// has no natural ceiling, so it fits to its own window and labels that
// window - an unlabelled fitted scale would look meaningful when it is not.
function buildSparkline(values, unit, hours) {
  const windowLabel = `${hours}h`;
  const timeAxis = `<div class="stat-time-axis"><span>${esc(windowLabel)}</span><span>now</span></div>`;
  if (!Array.isArray(values) || values.length < 2) {
    return `<div class="stat-chart-row"><div class="stat-trace"></div></div>${timeAxis}`;
  }
  const isPercent = unit === "%";
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  const min = isPercent ? 0 : dataMin;
  const max = isPercent ? 100 : dataMax;
  const span = max - min;
  const n = values.length;
  const points = values
    .map((v, i) => {
      const x = (i / (n - 1)) * 100;
      const y = span === 0 ? 22 : 44 - ((v - min) / span) * 44;
      return `${x},${y}`;
    })
    .join(" ");
  const topLabel = isPercent ? "100" : formatScaleLabel(max);
  const bottomLabel = isPercent ? "0" : formatScaleLabel(min);
  const scale = `<div class="stat-scale"><span>${esc(topLabel)}</span><span>${esc(bottomLabel)}</span></div>`;
  const svg = `<svg class="sparkline" viewBox="0 0 100 44" preserveAspectRatio="none" width="100%" height="44" aria-hidden="true">
    <line x1="0" y1="1" x2="100" y2="1" stroke="var(--divider-color, #e0e0e0)" stroke-width="1" vector-effect="non-scaling-stroke" opacity="0.6" />
    <line x1="0" y1="43" x2="100" y2="43" stroke="var(--divider-color, #e0e0e0)" stroke-width="1" vector-effect="non-scaling-stroke" opacity="0.6" />
    <polyline points="${points}" fill="none" stroke="var(--primary-color, #03a9f4)" stroke-width="1.5" vector-effect="non-scaling-stroke" stroke-linejoin="round" />
  </svg>`;
  return `<div class="stat-chart-row">${scale}<div class="stat-trace">${svg}</div></div>${timeAxis}`;
}

function shortStatLabel(entityId, friendlyName) {
  const objectId = entityId.split(".").slice(1).join(".");
  if (STAT_LABELS[objectId]) return STAT_LABELS[objectId];
  const name = String(friendlyName || objectId).replace(/^System Monitor\s*/i, "");
  const words = name.trim().split(/\s+/);
  return words.slice(0, 2).join(" ") || objectId;
}

// A built-in panel's `title` is a translation key, not a name - the sidebar
// runs it through the localiser, and printing it raw shows "energy" where it
// should say "Energy". A dashboard title is already a real name and falls
// through unchanged, since localize returns "" for a key it does not know.
function panelTitle(hass, panel, urlPath) {
  if (panel.title) {
    return hass.localize(`panel.${panel.title}`) || panel.title;
  }
  return prettifyUrlPath(urlPath);
}

function navigate(path) {
  history.pushState(null, "", path);
  window.dispatchEvent(new CustomEvent("location-changed", { bubbles: true, composed: true }));
}

class AdminToolboxPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = {};
    this._hass = null;
    this._dataFetched = false;
    this._fetching = false;
    this._hiddenPanelIds = [];
    this._sidebarError = null;
    this._updateMap = new Map();
    this._runningMap = new Map();
    this._menu = null;
    this._form = null;
    this._actionError = null;
    this._suppressClick = false;
    this._holdTimer = null;
    this._holdCard = null;
    this._holdStartX = 0;
    this._holdStartY = 0;
    this._sparklineData = new Map();
    this._statsTimer = null;
    this._matchDebounceTimer = null;
    this._searchDebounceTimer = null;

    this.shadowRoot.addEventListener("pointerdown", (e) => this._onPointerDown(e));
    this.shadowRoot.addEventListener("pointermove", (e) => this._onPointerMove(e));
    this.shadowRoot.addEventListener("pointerup", () => this._clearHold());
    this.shadowRoot.addEventListener("pointercancel", () => this._clearHold());
    this.shadowRoot.addEventListener("click", (e) => this._onClick(e));
  }

  // Settings arrive as `panel.config.options`, sent by the integration -
  // empty string and empty list mean "use the frontend default" rather than
  // the integration inventing wording of its own.
  set panel(panel) {
    const options = panel && panel.config && panel.config.options ? panel.config.options : {};
    this._config = options;
    if (this._dataFetched && !this._form) this._render();
  }

  set hass(hass) {
    const prev = this._hass;
    this._hass = hass;
    if (!hass) return;
    if (!this._dataFetched && !this._fetching) {
      this._fetchData();
      return;
    }
    // A form holds text the user is mid-typing, kept only in the DOM - a
    // re-render here would replace it with the form's last-saved state and
    // lose what was typed, so an open form defers the refresh.
    if (this._dataFetched && !this._form && this._shouldRerender(prev, hass)) {
      this._render();
    }
  }

  get hass() {
    return this._hass;
  }

  connectedCallback() {
    if (this._hass && !this._dataFetched && !this._fetching) {
      this._fetchData();
    } else if (this._dataFetched && !this._statsTimer) {
      this._startStatsTimer();
    }
  }

  // The panel element is torn down and rebuilt on every navigation away and
  // back - a timer left running per visit is a real leak, not a one-off.
  disconnectedCallback() {
    if (this._statsTimer) {
      clearInterval(this._statsTimer);
      this._statsTimer = null;
    }
  }

  _statsEntityIds() {
    const hass = this._hass;
    if (!hass) return [];
    const wanted = Array.isArray(this._config.stats) && this._config.stats.length ? this._config.stats : DEFAULT_STATS;
    return wanted.filter((id) => hass.states[id]);
  }

  _relevantEntityIds() {
    const ids = new Set(this._statsEntityIds());
    for (const id of this._updateMap.values()) ids.add(id);
    for (const id of this._runningMap.values()) ids.add(id);
    return ids;
  }

  // Re-render only when something the card actually shows has changed -
  // not on every hass write, which happens continuously.
  _shouldRerender(prev, next) {
    if (!prev) return true;
    if (prev.panels !== next.panels) return true;
    if (prev.services !== next.services) return true;
    for (const id of this._relevantEntityIds()) {
      if (prev.states[id] !== next.states[id]) return true;
    }
    return false;
  }

  async _fetchData() {
    if (this._fetching || this._dataFetched) return;
    this._fetching = true;
    await this._fetchSidebar();
    await this._fetchRegistry();
    this._fetching = false;
    this._dataFetched = true;
    this._render();
    // Statistics are fetched after the strip already has numbers, so the
    // first render never waits on them.
    this._fetchStats();
    this._startStatsTimer();
  }

  _chartHours() {
    const hours = Number(this._config.chart_hours);
    if (!Number.isFinite(hours)) return 6;
    return Math.min(168, Math.max(1, hours));
  }

  _startStatsTimer() {
    if (this._statsTimer) return;
    this._statsTimer = setInterval(() => this._fetchStats(), 5 * 60 * 1000);
  }

  // One call for every tile's trace, never one per tile. A statistic id
  // absent from the response, or with no state_class, simply gets no trace.
  async _fetchStats() {
    if (!this._hass) return;
    const ids = this._statsEntityIds();
    if (!ids.length) return;
    const hours = this._chartHours();
    try {
      const result = await this._hass.callWS({
        type: "recorder/statistics_during_period",
        start_time: new Date(Date.now() - hours * 3600e3).toISOString(),
        statistic_ids: ids,
        period: "5minute",
        types: ["mean"],
      });
      const sparklineData = new Map();
      for (const id of ids) {
        const rows = Array.isArray(result && result[id]) ? result[id] : [];
        const values = rows
          .map((row) => row.mean)
          .filter((mean) => typeof mean === "number" && Number.isFinite(mean));
        if (values.length) sparklineData.set(id, values);
      }
      this._sparklineData = sparklineData;
    } catch (err) {
      // The readings strip must never be the thing that breaks the page -
      // fall back to plain numbers on every tile.
      this._sparklineData = new Map();
    }
    // A refresh must not redraw over an open menu or form - it would dismiss
    // a half-answered "Stop ...?" or wipe out a half-typed link under the
    // user's finger. The traces are already stored and appear at the next
    // render.
    if (this._hass && !this._menu && !this._form) this._render();
  }

  async _fetchSidebar() {
    try {
      const result = await this._hass.callWS({ type: "frontend/get_user_data", key: "sidebar" });
      if (!result || typeof result !== "object" || !("value" in result)) {
        throw new Error("unrecognised response shape from frontend/get_user_data");
      }
      const value = result.value;
      // Absent for a user who has never edited their sidebar - reads as empty.
      this._hiddenPanelIds = value && Array.isArray(value.hiddenPanels) ? value.hiddenPanels : [];
      this._sidebarError = null;
    } catch (err) {
      this._hiddenPanelIds = [];
      this._sidebarError = (err && err.message) || String(err);
    }
  }

  async _fetchRegistry() {
    this._updateMap = new Map();
    this._runningMap = new Map();
    try {
      // Admin-only call - a non-admin user gets an error here and simply
      // loses the add-on features, not the whole card.
      const entries = await this._hass.callWS({ type: "config/entity_registry/list" });
      for (const entry of entries) {
        if (entry.platform !== "hassio" || !entry.unique_id) continue;
        if (entry.unique_id.endsWith(VERSION_SUFFIX) && entry.entity_id.startsWith("update.")) {
          const slug = entry.unique_id.slice(0, -VERSION_SUFFIX.length);
          this._updateMap.set(slug, entry.entity_id);
        } else if (entry.unique_id.endsWith(STATE_SUFFIX) && entry.entity_id.startsWith("binary_sensor.")) {
          // Running sensors are disabled by default everywhere - only use
          // one that has actually been enabled.
          if (entry.disabled_by) continue;
          const slug = entry.unique_id.slice(0, -STATE_SUFFIX.length);
          this._runningMap.set(slug, entry.entity_id);
        }
      }
    } catch (err) {
      // No add-on identification available to this user; carry on.
    }
  }

  _clearHold() {
    if (this._holdTimer) {
      clearTimeout(this._holdTimer);
      this._holdTimer = null;
    }
    this._holdCard = null;
  }

  _onPointerDown(e) {
    // Each fresh press starts unsuppressed. A hold that fires replaces the
    // DOM under the finger, so the click that would have consumed the
    // suppression flag never lands - left set, it would eat the next tap.
    this._suppressClick = false;
    const card = e.target.closest(".tool-card[data-slug], .tool-card[data-extra-index]");
    if (!card) return;
    this._holdStartX = e.clientX;
    this._holdStartY = e.clientY;
    this._holdCard = card;
    try {
      card.setPointerCapture(e.pointerId);
    } catch (_) {
      // Pointer capture is unavailable in some embedded webviews; the hold
      // still works, it just won't survive the pointer leaving the card.
    }
    this._holdTimer = setTimeout(() => {
      this._holdTimer = null;
      this._suppressClick = true;
      this._actionError = null;
      this._form = null;
      if (card.dataset.extraIndex !== undefined) {
        this._menu = { kind: "extra", index: Number(card.dataset.extraIndex), title: card.dataset.title, mode: "menu" };
      } else {
        this._menu = { kind: "addon", slug: card.dataset.slug, title: card.dataset.title, mode: "menu" };
      }
      this._render();
    }, 500);
  }

  _onPointerMove(e) {
    if (!this._holdTimer || !this._holdCard) return;
    const dx = e.clientX - this._holdStartX;
    const dy = e.clientY - this._holdStartY;
    if (Math.sqrt(dx * dx + dy * dy) > 8) {
      clearTimeout(this._holdTimer);
      this._holdTimer = null;
    }
  }

  _onClick(e) {
    if (this._suppressClick) {
      this._suppressClick = false;
      return;
    }
    // A click anywhere inside the open form is the form's own business -
    // typing, or Save/Cancel - never a card tap or navigation.
    const formEl = e.target.closest("[data-role='form']");
    if (formEl) {
      const logoResult = e.target.closest("[data-logo-reference]");
      if (logoResult) {
        this._setFormLogo(selfhstPlainUrl(logoResult.dataset.logoReference), logoResult.dataset.logoName);
        return;
      }
      const formBtn = e.target.closest("[data-form-action]");
      if (formBtn) this._onFormAction(formBtn);
      return;
    }
    const addLinkBtn = e.target.closest("[data-action='add-link']");
    if (addLinkBtn) {
      this._openAddForm();
      return;
    }
    const menuBtn = e.target.closest("[data-menu-action]");
    if (menuBtn) {
      this._onMenuAction(menuBtn);
      return;
    }
    // With a menu open, a tap anywhere else dismisses it rather than opening
    // whatever was tapped - the menu is modal in intent, not in markup.
    if (this._menu) {
      this._menu = null;
      this._render();
      return;
    }
    const panelCard = e.target.closest("[data-role='panel']");
    if (panelCard) {
      navigate("/" + panelCard.dataset.urlPath);
      return;
    }
    const extraCard = e.target.closest("[data-role='extra']");
    if (extraCard) {
      window.open(extraCard.dataset.url, "_blank", "noopener");
    }
  }

  _onMenuAction(btn) {
    const kind = btn.dataset.kind || "addon";
    const action = btn.dataset.menuAction;
    if (kind === "extra") {
      this._onExtraMenuAction(btn, action);
      return;
    }
    const slug = btn.dataset.slug;
    const title = btn.dataset.title;
    if (action === "cancel") {
      this._menu = null;
      this._render();
      return;
    }
    if (action === "logs") {
      this._menu = null;
      navigate(`/hassio/addon/${slug}/logs`);
      return;
    }
    if (action === "info") {
      this._menu = null;
      navigate(`/hassio/addon/${slug}/info`);
      return;
    }
    if (action === "restart" || action === "stop" || action === "start") {
      if (this._menu && this._menu.mode === "confirm" && this._menu.action === action) {
        this._runAddonAction(slug, action);
        return;
      }
      this._menu = { kind: "addon", slug, title, mode: "confirm", action };
      this._render();
    }
  }

  _onExtraMenuAction(btn, action) {
    const index = Number(btn.dataset.index);
    if (action === "cancel") {
      this._menu = null;
      this._render();
      return;
    }
    if (action === "edit") {
      this._menu = null;
      this._openEditForm(index);
      return;
    }
    if (action === "remove") {
      if (this._menu && this._menu.mode === "confirm") {
        this._removeExtra(index);
        return;
      }
      const extra = Array.isArray(this._config.extra) ? this._config.extra : [];
      const entry = extra[index];
      this._menu = { kind: "extra", index, title: entry && entry.name, mode: "confirm" };
      this._render();
    }
  }

  // Opens the add-link form. Cleared state, not a re-render of an existing
  // form - _render() attaches the icon-preview listener once the fresh DOM
  // exists.
  _openAddForm() {
    this._menu = null;
    this._actionError = null;
    this._form = { mode: "add", index: null, error: null, values: null, image: null, imageName: null };
    this._render();
  }

  _openEditForm(index) {
    this._menu = null;
    this._actionError = null;
    const extra = Array.isArray(this._config.extra) ? this._config.extra : [];
    const entry = extra[index];
    this._form = { mode: "edit", index, error: null, values: null, image: (entry && entry.image) || null, imageName: null };
    this._render();
  }

  // Wires the form's live-updating bits once, right after its DOM is
  // created. None of these may ever call _render() - that would replace the
  // input the user is typing into and drop focus and keystrokes.
  _attachFormListeners() {
    const root = this.shadowRoot.querySelector("[data-role='form']");
    if (!root) return;
    const iconInput = root.querySelector("[data-field='icon']");
    const preview = root.querySelector(".icon-preview");
    if (iconInput && preview) {
      iconInput.addEventListener("input", () => {
        preview.setAttribute("icon", iconInput.value.trim() || "mdi:open-in-new");
      });
    }
    const nameInput = root.querySelector("[data-field='name']");
    if (nameInput) {
      nameInput.addEventListener("input", () => {
        if (this._matchDebounceTimer) clearTimeout(this._matchDebounceTimer);
        this._matchDebounceTimer = setTimeout(() => this._tryAutoMatch(nameInput.value), 400);
      });
    }
    const searchInput = root.querySelector("[data-field='logo-search']");
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        if (this._searchDebounceTimer) clearTimeout(this._searchDebounceTimer);
        this._searchDebounceTimer = setTimeout(() => this._runLogoSearch(searchInput.value), 200);
      });
    }
    const logoImg = root.querySelector(".logo-match-img");
    if (logoImg) {
      logoImg.addEventListener("error", () => {
        const plain = logoImg.dataset.plainUrl;
        if (plain && logoImg.src !== plain) logoImg.src = plain;
      });
    }
  }

  // Looks the typed name up in the selfh.st index, debounced. Only fires
  // while the form is still open and still in plain-icon mode - a logo
  // already chosen (by hand, or from a previous match) is never silently
  // replaced by further typing.
  async _tryAutoMatch(text) {
    if (!this._form || this._form.image) return;
    const rows = await loadSelfhstIndex();
    if (!this._form || this._form.image) return;
    if (!rows.length) {
      this._updateSuggestions([]);
      return;
    }
    const match = findSelfhstMatch(rows, text);
    if (match) {
      this._setFormLogo(selfhstPlainUrl(match.reference), match.name);
      return;
    }
    this._updateSuggestions(fuzzySelfhstMatches(rows, text));
  }

  // Fills the "Did you mean?" region in place, exactly like the auto-match
  // region below it - never through _render(), which would replace the Name
  // input mid-keystroke. A suggestion reuses the same result markup and
  // data-logo-reference click path as the "Change" search, so tapping one
  // is handled by the existing form click handler.
  _updateSuggestions(rows) {
    const root = this.shadowRoot.querySelector("[data-role='form']");
    if (!root) return;
    const region = root.querySelector("[data-role='logo-suggestions']");
    const listEl = root.querySelector("[data-role='logo-suggestions-list']");
    if (!region || !listEl) return;
    if (!rows.length) {
      region.hidden = true;
      listEl.innerHTML = "";
      return;
    }
    listEl.innerHTML = rows
      .map((row) => `<button type="button" class="logo-result" data-logo-reference="${esc(row.reference)}" data-logo-name="${esc(row.name)}"><img class="logo-result-img" src="${esc(selfhstPlainUrl(row.reference))}" alt=""><span>${esc(row.name)}</span></button>`)
      .join("");
    region.hidden = false;
  }

  async _runLogoSearch(text) {
    const rows = await loadSelfhstIndex();
    const root = this.shadowRoot.querySelector("[data-role='form']");
    if (!root) return;
    const resultsEl = root.querySelector("[data-role='logo-search-results']");
    if (!resultsEl) return;
    const matches = searchSelfhst(rows, text, 12);
    resultsEl.innerHTML = matches
      .map((row) => `<button type="button" class="logo-result" data-logo-reference="${esc(row.reference)}" data-logo-name="${esc(row.name)}"><img class="logo-result-img" src="${esc(selfhstPlainUrl(row.reference))}" alt=""><span>${esc(row.name)}</span></button>`)
      .join("");
  }

  // Applies a chosen logo directly to the live DOM - never through _render(),
  // which would wipe out whatever the user is mid-typing elsewhere in the
  // form. Stores the plain reference url; the themed variant is only ever
  // computed for display.
  _setFormLogo(url, name) {
    if (!this._form) return;
    this._form.image = url;
    this._form.imageName = name || null;
    const root = this.shadowRoot.querySelector("[data-role='form']");
    if (!root) return;
    const logoRow = root.querySelector("[data-role='logo-match']");
    const iconRow = root.querySelector("[data-role='icon-row']");
    const searchRow = root.querySelector("[data-role='logo-search']");
    const suggestionsRow = root.querySelector("[data-role='logo-suggestions']");
    const img = root.querySelector(".logo-match-img");
    const nameEl = root.querySelector("[data-role='logo-match-name']");
    if (img) {
      img.dataset.plainUrl = url;
      img.src = themedSelfhstUrl(url, isDarkTheme(this._hass));
    }
    if (nameEl) nameEl.textContent = name || "Custom image";
    if (logoRow) logoRow.hidden = false;
    if (iconRow) iconRow.hidden = true;
    if (searchRow) searchRow.hidden = true;
    // A chosen logo, whichever way it was chosen, ends the guessing - a
    // suggestion never survives once the form has settled on an image.
    if (suggestionsRow) suggestionsRow.hidden = true;
  }

  _clearFormLogo() {
    if (!this._form) return;
    this._form.image = null;
    this._form.imageName = null;
    const root = this.shadowRoot.querySelector("[data-role='form']");
    if (!root) return;
    const logoRow = root.querySelector("[data-role='logo-match']");
    const iconRow = root.querySelector("[data-role='icon-row']");
    const searchRow = root.querySelector("[data-role='logo-search']");
    const suggestionsRow = root.querySelector("[data-role='logo-suggestions']");
    if (logoRow) logoRow.hidden = true;
    if (iconRow) iconRow.hidden = false;
    if (searchRow) searchRow.hidden = true;
    if (suggestionsRow) suggestionsRow.hidden = true;
  }

  _openLogoSearch() {
    const root = this.shadowRoot.querySelector("[data-role='form']");
    if (!root) return;
    const searchRow = root.querySelector("[data-role='logo-search']");
    if (searchRow) searchRow.hidden = false;
    const searchInput = root.querySelector("[data-field='logo-search']");
    const resultsEl = root.querySelector("[data-role='logo-search-results']");
    if (searchInput) {
      searchInput.value = "";
      searchInput.focus();
    }
    if (resultsEl) resultsEl.innerHTML = "";
  }

  _onFormAction(btn) {
    const action = btn.dataset.formAction;
    if (action === "cancel") {
      this._form = null;
      this._render();
      return;
    }
    if (action === "save") {
      this._saveForm();
      return;
    }
    if (action === "change-logo") {
      this._openLogoSearch();
      return;
    }
    if (action === "use-icon") {
      this._clearFormLogo();
    }
  }

  // Reads the fields straight out of the DOM rather than from state, since
  // state is never updated per keystroke (see _attachFormListeners).
  async _saveForm() {
    const form = this._form;
    const root = this.shadowRoot.querySelector("[data-role='form']");
    if (!root) return;
    const name = root.querySelector("[data-field='name']").value.trim();
    const rawUrl = root.querySelector("[data-field='url']").value.trim();
    const iconInput = root.querySelector("[data-field='icon']");
    const icon = iconInput ? iconInput.value.trim() : "";
    if (!name || !rawUrl) {
      this._form = { ...form, values: { name, url: rawUrl, icon }, error: "Name and Address are both required." };
      this._render();
      return;
    }
    const url = /:\/\//.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    const entry = { name, url };
    if (icon) entry.icon = icon;
    // The plain reference url only - the light/dark variant is picked per
    // viewer at render time, so freezing one into the config would be wrong
    // for whoever is not on that theme.
    if (form.image) entry.image = form.image;
    const currentExtra = Array.isArray(this._config.extra) ? this._config.extra : [];
    const nextExtra = currentExtra.slice();
    if (form.mode === "edit") {
      nextExtra[form.index] = entry;
    } else {
      nextExtra.push(entry);
    }
    try {
      // Only the changed field is sent - the integration merges it into the
      // stored options, so an options-flow edit happening at the same moment
      // is never clobbered.
      const result = await this._hass.callWS({ type: "admin_toolbox/save_options", options: { extra: nextExtra } });
      // The panel property is also updated by Home Assistant when the
      // integration re-registers, which this must tolerate without looping
      // or saving twice - applying the merged result here just makes the
      // page reflect the save immediately.
      if (result && typeof result === "object") this._config = result;
      this._form = null;
      this._render();
    } catch (err) {
      this._form = { ...form, values: { name, url: rawUrl, icon }, error: (err && err.message) || String(err) };
      this._render();
    }
  }

  async _removeExtra(index) {
    this._menu = null;
    this._render();
    const currentExtra = Array.isArray(this._config.extra) ? this._config.extra : [];
    const nextExtra = currentExtra.filter((_, i) => i !== index);
    try {
      const result = await this._hass.callWS({ type: "admin_toolbox/save_options", options: { extra: nextExtra } });
      if (result && typeof result === "object") this._config = result;
      this._render();
    } catch (err) {
      this._actionError = { extraIndex: index, message: (err && err.message) || String(err) };
      this._render();
    }
  }

  async _runAddonAction(slug, action) {
    const service = { restart: "addon_restart", stop: "addon_stop", start: "addon_start" }[action];
    this._menu = null;
    this._render();
    try {
      await this._hass.callService("hassio", service, { addon: slug });
    } catch (err) {
      this._actionError = { slug, message: (err && err.message) || String(err) };
      this._render();
    }
  }

  _render() {
    try {
      this.shadowRoot.innerHTML = this._html();
      // Reattaches the icon-preview listener to the fresh form DOM. Cheap
      // and idempotent - it only runs at all while a form is open.
      if (this._form) this._attachFormListeners();
      this._attachImageFallbacks();
    } catch (err) {
      this.shadowRoot.innerHTML = `<style>${this._styles()}</style><div class="error-block">Admin Toolbox failed to render: ${esc(err && err.message ? err.message : String(err))}</div>`;
    }
  }

  // Never an inline onerror attribute, since the content policy may block
  // inline handlers - each broken logo is walked to the next link in its
  // chain (themed url -> plain url -> icon -> mdi:open-in-new) from here.
  _attachImageFallbacks() {
    const imgs = this.shadowRoot.querySelectorAll("img.tool-img");
    imgs.forEach((img) => {
      img.addEventListener("error", () => this._onToolImageError(img));
    });
  }

  _onToolImageError(img) {
    const plainUrl = img.dataset.plainUrl || "";
    if (plainUrl && img.src !== plainUrl) {
      img.src = plainUrl;
      return;
    }
    // A picture that will not load degrades the same way an entry with no
    // picture renders: the user's own icon if there is one, otherwise the
    // lettered square. Dropping straight to a generic icon here would skip
    // the square for exactly the links it was built for.
    const fallbackIcon = img.dataset.fallbackIcon || "";
    if (!fallbackIcon && img.dataset.fallbackInitials) {
      const square = document.createElement("div");
      square.className = "tool-square";
      square.setAttribute("aria-hidden", "true");
      square.style.background = img.dataset.fallbackFill || "";
      square.style.color = img.dataset.fallbackText || "";
      square.textContent = img.dataset.fallbackInitials;
      img.replaceWith(square);
      return;
    }
    const iconEl = document.createElement("ha-icon");
    iconEl.setAttribute("icon", fallbackIcon || "mdi:open-in-new");
    img.replaceWith(iconEl);
  }

  _renderStatsStrip() {
    const hass = this._hass;
    const ids = this._statsEntityIds();
    if (!ids.length) return "";
    const items = ids
      .map((id) => {
        const state = hass.states[id];
        const unit = state.attributes.unit_of_measurement || "";
        const label = shortStatLabel(id, state.attributes.friendly_name);
        const chart = buildSparkline(this._sparklineData.get(id), unit, this._chartHours());
        return `<div class="stat"><div class="stat-row"><span class="stat-label">${esc(label)}</span><span class="stat-value">${esc(state.state)}${esc(unit)}</span></div>${chart}</div>`;
      })
      .join("");
    return `<div class="stats-strip">${items}</div>`;
  }

  _buildHiddenCards() {
    const hass = this._hass;
    const cards = [];
    for (const urlPath of this._hiddenPanelIds) {
      const panel = hass.panels[urlPath];
      if (!panel) continue; // hidden, then later removed - skip silently
      const isAddon = this._updateMap.has(urlPath);
      const title = panelTitle(hass, panel, urlPath);
      const icon = panel.icon || (isAddon ? "mdi:puzzle" : "mdi:view-dashboard");
      let version = null;
      let updateAvailable = false;
      if (isAddon) {
        const updateEntity = hass.states[this._updateMap.get(urlPath)];
        if (updateEntity) {
          version = updateEntity.attributes.installed_version || null;
          updateAvailable = updateEntity.state === "on";
        }
      }
      let running = null; // null = no dot at all
      if (isAddon && this._runningMap.has(urlPath)) {
        const runningEntity = hass.states[this._runningMap.get(urlPath)];
        if (runningEntity) running = runningEntity.state === "on";
      }
      cards.push({ urlPath, title, icon, isAddon, version, updateAvailable, running });
    }
    cards.sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
    return cards;
  }

  _renderToolCard(card) {
    const hasControls = !!(this._hass.services && this._hass.services.hassio && this._hass.services.hassio.addon_restart);
    const menuHere = this._menu && this._menu.slug === card.urlPath ? this._menu : null;
    const actionErrorHere = this._actionError && this._actionError.slug === card.urlPath ? this._actionError : null;
    const badges = [];
    if (card.updateAvailable) badges.push('<span class="badge update-badge" title="Update available"></span>');
    if (card.running !== null) badges.push(`<span class="badge running-dot ${card.running ? "running" : "stopped"}" title="${card.running ? "Running" : "Stopped"}"></span>`);

    let overlay = "";
    if (menuHere) {
      overlay = this._renderMenuOverlay(card, menuHere, hasControls);
    }

    return `
      <div class="tool-card" data-role="panel" data-url-path="${esc(card.urlPath)}" ${card.isAddon ? `data-slug="${esc(card.urlPath)}" data-title="${esc(card.title)}"` : ""}>
        <div class="tool-card-main">
          <ha-icon icon="${esc(card.icon)}"></ha-icon>
          <div class="tool-card-text">
            <div class="tool-card-title">${esc(card.title)}${badges.join("")}</div>
            ${card.version ? `<div class="tool-card-version">v${esc(card.version)}</div>` : ""}
          </div>
        </div>
        ${actionErrorHere ? `<div class="action-error">${esc(actionErrorHere.message)}</div>` : ""}
        ${overlay}
      </div>`;
  }

  _renderMenuOverlay(card, menu, hasControls) {
    const slug = esc(card.urlPath);
    const title = esc(card.title);
    if (menu.mode === "confirm") {
      const verb = { restart: "Restart", stop: "Stop", start: "Start" }[menu.action];
      return `
        <div class="menu-overlay" data-role="menu">
          <div class="menu-question">${verb} ${title}?</div>
          <div class="menu-row">
            <button data-menu-action="cancel" data-kind="addon" data-slug="${slug}">Cancel</button>
            <button data-menu-action="${esc(menu.action)}" data-kind="addon" data-slug="${slug}" class="confirm-btn">${verb}</button>
          </div>
        </div>`;
    }
    const buttons = [];
    if (hasControls) {
      buttons.push(`<button data-menu-action="restart" data-kind="addon" data-slug="${slug}" data-title="${title}">Restart</button>`);
      if (card.running === true) {
        buttons.push(`<button data-menu-action="stop" data-kind="addon" data-slug="${slug}" data-title="${title}">Stop</button>`);
      } else if (card.running === false) {
        buttons.push(`<button data-menu-action="start" data-kind="addon" data-slug="${slug}" data-title="${title}">Start</button>`);
      } else {
        buttons.push(`<button data-menu-action="stop" data-kind="addon" data-slug="${slug}" data-title="${title}">Stop</button>`);
        buttons.push(`<button data-menu-action="start" data-kind="addon" data-slug="${slug}" data-title="${title}">Start</button>`);
      }
    }
    buttons.push(`<button data-menu-action="logs" data-kind="addon" data-slug="${slug}">View logs</button>`);
    buttons.push(`<button data-menu-action="info" data-kind="addon" data-slug="${slug}">Add-on page</button>`);
    buttons.push(`<button data-menu-action="cancel" data-kind="addon" data-slug="${slug}">Cancel</button>`);
    return `<div class="menu-overlay" data-role="menu"><div class="menu-grid">${buttons.join("")}</div></div>`;
  }

  // Headings are the plugin speaking in its own voice on a page the user has
  // named, so they are theirs to change. Defaults are unchanged.
  _hiddenHeading() {
    return this._config.hidden_heading || "Hidden from sidebar";
  }

  _extraHeading() {
    return this._config.extra_heading || "Other tools";
  }

  _renderHiddenSection() {
    if (this._sidebarError) {
      return `
        <h2 class="section-heading">${esc(this._hiddenHeading())}</h2>
        <div class="error-block">
          Admin Toolbox could not read your sidebar settings. This usually
          means Home Assistant has changed how it stores them.
          <div class="error-detail">${esc(this._sidebarError)}</div>
        </div>`;
    }
    const cards = this._buildHiddenCards();
    const hasAddonCard = cards.some((c) => c.isAddon);
    const hint = hasAddonCard ? `<div class="hint">Press and hold a card for controls</div>` : "";
    if (!cards.length) {
      return `
        <h2 class="section-heading">${esc(this._hiddenHeading())}</h2>
        ${hint}
        <div class="empty-block">
          This page collects whatever panels you have hidden from your own
          sidebar. To hide one: press and hold the "Home Assistant" title at
          the top of the sidebar, then drag items into the hidden area.
        </div>`;
    }
    return `
      <h2 class="section-heading">${esc(this._hiddenHeading())}</h2>
      ${hint}
      <div class="card-grid">${cards.map((c) => this._renderToolCard(c)).join("")}</div>`;
  }

  // Always renders - unlike the hidden-panels section, an empty link list
  // still needs the heading row so the add control is reachable on a fresh
  // install.
  _renderExtraSection(precededByContent) {
    const isAdmin = !!(this._hass.user && this._hass.user.is_admin);
    const extra = Array.isArray(this._config.extra) ? this._config.extra : [];
    const cards = extra.map((entry, index) => this._renderExtraCard(entry, index, isAdmin)).join("");
    const addButton = isAdmin
      ? `<button class="add-link" data-action="add-link" title="Add a link"><ha-icon icon="mdi:plus"></ha-icon></button>`
      : "";
    const form = this._form ? this._renderForm() : "";
    const rule = precededByContent ? `<hr class="section-rule">` : "";
    return `
      ${rule}
      <div class="section-heading-row">
        <h2 class="section-heading">${esc(this._extraHeading())}</h2>
        ${addButton}
      </div>
      ${form}
      ${cards ? `<div class="card-grid">${cards}</div>` : ""}`;
  }

  _renderExtraCard(entry, index, isAdmin) {
    const menuHere = this._menu && this._menu.kind === "extra" && this._menu.index === index ? this._menu : null;
    const actionErrorHere = this._actionError && this._actionError.extraIndex === index ? this._actionError : null;
    if (!entry || !entry.name || !entry.url) {
      // Missing a name or an address, so there is no usable link to tap -
      // but it must still be holdable, or a mistyped entry traps the user
      // with no way to fix it from the page at all.
      const title = `Link ${index + 1}`;
      const holdAttrs = isAdmin ? `data-extra-index="${index}" data-title="${esc(title)}"` : "";
      const overlay = menuHere ? this._renderExtraMenuOverlay(title, index, menuHere) : "";
      return `
        <div class="tool-card malformed" ${holdAttrs}>
          <div class="tool-card-main">
            <ha-icon icon="mdi:alert"></ha-icon>
            <div class="tool-card-text"><div class="tool-card-title">extra[${index}] is missing name or url</div></div>
          </div>
          ${actionErrorHere ? `<div class="action-error">${esc(actionErrorHere.message)}</div>` : ""}
          ${overlay}
        </div>`;
    }
    // image (a logo or any picture) wins, then an icon the user typed by
    // hand, and only then the lettered square - nothing chosen deliberately
    // is ever overridden by it.
    const fallbackIcon = entry.icon || "mdi:open-in-new";
    let media;
    if (entry.image) {
      // The fallback chain (themed url -> plain url -> icon -> mdi:open-in-new)
      // is walked by _onToolImageError, attached after render, never an
      // inline handler.
      const squareFallback = initialsFor(entry.name);
      const squareColour = squareFallback ? squareColours(entry.name, isDarkTheme(this._hass)) : null;
      media = `<img class="tool-img" src="${esc(themedSelfhstUrl(entry.image, isDarkTheme(this._hass)))}" data-plain-url="${esc(entry.image)}" data-fallback-icon="${esc(entry.icon || "")}"${squareFallback ? ` data-fallback-initials="${esc(squareFallback)}" data-fallback-fill="${esc(squareColour.fill)}" data-fallback-text="${esc(squareColour.text)}"` : ""} alt="">`;
    } else if (entry.icon) {
      media = `<ha-icon icon="${esc(entry.icon)}"></ha-icon>`;
    } else {
      const initials = initialsFor(entry.name);
      if (initials) {
        const colours = squareColours(entry.name, isDarkTheme(this._hass));
        media = `<div class="tool-square" aria-hidden="true" style="background:${esc(colours.fill)};color:${esc(colours.text)}">${esc(initials)}</div>`;
      } else {
        media = `<ha-icon icon="mdi:open-in-new"></ha-icon>`;
      }
    }
    const overlay = menuHere ? this._renderExtraMenuOverlay(entry.name, index, menuHere) : "";
    // The hold gesture only leads anywhere for an administrator, so the
    // attribute that arms it is only present for one.
    const holdAttrs = isAdmin ? `data-extra-index="${index}" data-title="${esc(entry.name)}"` : "";
    return `
      <div class="tool-card" data-role="extra" data-url="${esc(entry.url)}" ${holdAttrs}>
        <div class="tool-card-main">
          ${media}
          <div class="tool-card-text"><div class="tool-card-title">${esc(entry.name)}</div></div>
        </div>
        ${actionErrorHere ? `<div class="action-error">${esc(actionErrorHere.message)}</div>` : ""}
        ${overlay}
      </div>`;
  }

  _renderExtraMenuOverlay(entryTitle, index, menu) {
    const title = esc(entryTitle);
    if (menu.mode === "confirm") {
      return `
        <div class="menu-overlay" data-role="menu">
          <div class="menu-question">Remove ${title}?</div>
          <div class="menu-row">
            <button data-menu-action="cancel" data-kind="extra" data-index="${index}">Cancel</button>
            <button data-menu-action="remove" data-kind="extra" data-index="${index}" class="confirm-btn">Remove</button>
          </div>
        </div>`;
    }
    return `
      <div class="menu-overlay" data-role="menu">
        <div class="menu-grid">
          <button data-menu-action="edit" data-kind="extra" data-index="${index}">Edit</button>
          <button data-menu-action="remove" data-kind="extra" data-index="${index}">Remove</button>
          <button data-menu-action="cancel" data-kind="extra" data-index="${index}">Cancel</button>
        </div>
      </div>`;
  }

  // Renders once when the form opens or fails validation - never on a
  // keystroke. _form.values holds what the user last typed, for the
  // re-render a failed save causes; without it, an edit falls back to the
  // stored entry and a fresh add falls back to blank fields.
  _renderForm() {
    const form = this._form;
    const extra = Array.isArray(this._config.extra) ? this._config.extra : [];
    const entry = form.mode === "edit" ? extra[form.index] : null;
    const values = form.values || {
      name: entry ? entry.name || "" : "",
      url: entry ? entry.url || "" : "",
      icon: entry ? entry.icon || "" : "",
    };
    const previewIcon = values.icon || "mdi:open-in-new";
    const hasImage = !!form.image;
    const themedImage = hasImage ? themedSelfhstUrl(form.image, isDarkTheme(this._hass)) : "";
    const logoLabel = form.imageName || (hasImage ? "Custom image" : "");
    return `
      <div class="link-form" data-role="form">
        ${form.error ? `<div class="form-error">${esc(form.error)}<div class="form-error-hint">Admin Toolbox could not save this change.</div></div>` : ""}
        <div class="form-row">
          <label class="form-label">Name</label>
          <input type="text" class="form-input" data-field="name" value="${esc(values.name)}">
        </div>
        <div class="form-row">
          <label class="form-label">Address</label>
          <input type="text" class="form-input" data-field="url" value="${esc(values.url)}">
        </div>
        <div class="form-row logo-row" data-role="logo-match"${hasImage ? "" : " hidden"}>
          <img class="logo-match-img"${themedImage ? ` src="${esc(themedImage)}"` : ""} data-plain-url="${esc(form.image || "")}" alt="">
          <span class="logo-match-name" data-role="logo-match-name">${esc(logoLabel)}</span>
          <button type="button" data-form-action="change-logo">Change</button>
          <button type="button" data-form-action="use-icon">Use an icon instead</button>
        </div>
        <div class="form-row icon-row" data-role="icon-row"${hasImage ? " hidden" : ""}>
          <label class="form-label">Icon</label>
          <input type="text" class="form-input" data-field="icon" value="${esc(values.icon)}">
          <ha-icon class="icon-preview" icon="${esc(previewIcon)}"></ha-icon>
        </div>
        <div class="logo-search" data-role="logo-search" hidden>
          <input type="text" class="form-input" data-field="logo-search" placeholder="Search app logos...">
          <div class="logo-search-results" data-role="logo-search-results"></div>
        </div>
        <div class="logo-suggestions" data-role="logo-suggestions" hidden>
          <div class="logo-suggestions-heading">Did you mean?</div>
          <div class="logo-search-results" data-role="logo-suggestions-list"></div>
        </div>
        <div class="form-buttons">
          <button data-form-action="cancel">Cancel</button>
          <button data-form-action="save" class="confirm-btn">Save</button>
        </div>
      </div>`;
  }

  _html() {
    const hass = this._hass;
    if (!hass) return `<style>${this._styles()}</style>`;
    if (!this._dataFetched) {
      return `<style>${this._styles()}</style><div class="loading">Loading admin toolbox...</div>`;
    }
    const stats = this._renderStatsStrip();
    const hidden = this._renderHiddenSection();
    const extra = this._renderExtraSection(!!hidden);
    return `<style>${this._styles()}</style><div class="root">${stats}${hidden}${extra}</div>`;
  }

  _styles() {
    return `
      :host {
        display: block;
        min-height: 100vh;
        box-sizing: border-box;
        background: var(--primary-background-color, #fafafa);
        color: var(--primary-text-color, #212121);
      }
      .root {
        padding: 16px;
      }
      .loading {
        padding: 16px;
        color: var(--secondary-text-color, #727272);
      }
      .stats-strip {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-bottom: 20px;
      }
      .stat {
        background: var(--card-background-color, #fff);
        border: 1px solid var(--divider-color, #e0e0e0);
        border-radius: var(--ha-card-border-radius, 8px);
        padding: 6px 12px;
        min-width: 150px;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .stat-row {
        display: flex;
        gap: 6px;
        align-items: baseline;
      }
      .stat-label {
        color: var(--secondary-text-color, #727272);
        font-size: 0.85em;
      }
      .stat-value {
        font-weight: 600;
      }
      .stat-chart-row {
        display: flex;
        align-items: stretch;
        gap: 4px;
        height: 44px;
      }
      .stat-scale {
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        color: var(--secondary-text-color, #727272);
        font-size: 0.7em;
        flex: 0 0 auto;
      }
      .stat-trace {
        flex: 1;
        min-width: 0;
        height: 44px;
      }
      .stat-time-axis {
        display: flex;
        justify-content: space-between;
        color: var(--secondary-text-color, #727272);
        font-size: 0.7em;
      }
      .sparkline {
        display: block;
        opacity: 0.55;
      }
      .section-heading {
        font-size: 1.1em;
        font-weight: 500;
        margin: 24px 0 4px 0;
      }
      .section-rule {
        border: none;
        border-top: 1px solid var(--divider-color, #e0e0e0);
        margin: 24px 0 0 0;
      }
      .section-heading-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .section-heading-row .section-heading {
        margin: 24px 0 4px 0;
      }
      .add-link {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        flex: 0 0 auto;
        padding: 0;
        border-radius: 50%;
        border: 1px solid var(--divider-color, #e0e0e0);
        background: var(--card-background-color, #fff);
        color: var(--primary-text-color, #212121);
        cursor: pointer;
      }
      .add-link ha-icon {
        --mdc-icon-size: 20px;
      }
      .link-form {
        background: var(--card-background-color, #fff);
        border: 1px solid var(--divider-color, #e0e0e0);
        border-radius: var(--ha-card-border-radius, 8px);
        padding: 12px;
        margin-bottom: 12px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      /* A class that sets display beats the browser's own rule for the
         hidden attribute, so hiding a row by attribute silently fails
         without this. It showed as an empty image in the link form. */
      [hidden] {
        display: none !important;
      }
      .form-row {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .form-label {
        flex: 0 0 70px;
        color: var(--secondary-text-color, #727272);
        font-size: 0.9em;
      }
      .form-input {
        flex: 1;
        min-width: 0;
        font: inherit;
        padding: 6px 8px;
        border-radius: 6px;
        border: 1px solid var(--divider-color, #e0e0e0);
        background: var(--card-background-color, #fff);
        color: var(--primary-text-color, #212121);
      }
      .icon-preview {
        flex: 0 0 auto;
        color: var(--secondary-text-color, #727272);
      }
      .logo-row {
        flex-wrap: wrap;
      }
      .logo-match-img {
        width: 24px;
        height: 24px;
        object-fit: contain;
        flex: 0 0 auto;
      }
      .logo-match-name {
        flex: 1;
        min-width: 0;
        overflow-wrap: anywhere;
      }
      .logo-row button {
        font: inherit;
        padding: 4px 10px;
        border-radius: 6px;
        border: 1px solid var(--divider-color, #e0e0e0);
        background: var(--card-background-color, #fff);
        color: var(--primary-text-color, #212121);
        cursor: pointer;
      }
      .logo-search {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .logo-search-results {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
        gap: 6px;
        max-height: 220px;
        overflow-y: auto;
      }
      .logo-result {
        display: flex;
        align-items: center;
        gap: 6px;
        font: inherit;
        padding: 6px 8px;
        border-radius: 6px;
        border: 1px solid var(--divider-color, #e0e0e0);
        background: var(--card-background-color, #fff);
        color: var(--primary-text-color, #212121);
        cursor: pointer;
        overflow: hidden;
        text-align: left;
      }
      .logo-result span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .logo-result-img {
        width: 20px;
        height: 20px;
        object-fit: contain;
        flex: 0 0 auto;
      }
      .logo-suggestions {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .logo-suggestions-heading {
        color: var(--secondary-text-color, #727272);
        font-size: 0.85em;
      }
      .form-buttons {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
      }
      .form-buttons button {
        font: inherit;
        padding: 6px 12px;
        border-radius: 6px;
        border: 1px solid var(--divider-color, #e0e0e0);
        background: var(--card-background-color, #fff);
        color: var(--primary-text-color, #212121);
        cursor: pointer;
      }
      .form-buttons button.confirm-btn {
        background: var(--primary-color, #03a9f4);
        color: #fff;
        border-color: var(--primary-color, #03a9f4);
      }
      .form-error {
        color: var(--error-color, #db4437);
        font-size: 0.85em;
      }
      .form-error-hint {
        color: var(--secondary-text-color, #727272);
        margin-top: 4px;
      }
      .hint {
        color: var(--secondary-text-color, #727272);
        font-size: 0.85em;
        margin-bottom: 8px;
      }
      .card-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
        gap: 12px;
      }
      .tool-card {
        position: relative;
        background: var(--card-background-color, #fff);
        border: 1px solid var(--divider-color, #e0e0e0);
        border-radius: var(--ha-card-border-radius, 8px);
        min-height: 72px;
        padding: 10px 12px;
        cursor: pointer;
        user-select: none;
        touch-action: pan-y;
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 6px;
      }
      .tool-card.malformed {
        border-color: var(--error-color, #db4437);
        cursor: default;
      }
      .tool-card-main {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .tool-img {
        width: 24px;
        height: 24px;
        object-fit: contain;
        flex: 0 0 auto;
      }
      .tool-square {
        width: 24px;
        height: 24px;
        flex: 0 0 auto;
        border-radius: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 600;
        font-size: 10px;
        line-height: 1;
      }
      .tool-card-text {
        min-width: 0;
      }
      .tool-card-title {
        font-weight: 500;
        display: flex;
        align-items: center;
        gap: 6px;
        overflow-wrap: anywhere;
      }
      .tool-card-version {
        color: var(--secondary-text-color, #727272);
        font-size: 0.8em;
      }
      .badge {
        display: inline-block;
        width: 8px;
        height: 8px;
        border-radius: 50%;
      }
      .update-badge {
        background: var(--primary-color, #03a9f4);
      }
      .running-dot.running {
        background: var(--success-color, #43a047);
      }
      .running-dot.stopped {
        background: var(--error-color, #db4437);
      }
      .action-error {
        color: var(--error-color, #db4437);
        font-size: 0.8em;
      }
      .menu-overlay {
        position: absolute;
        inset: 0;
        background: var(--card-background-color, #fff);
        border-radius: var(--ha-card-border-radius, 8px);
        border: 1px solid var(--primary-color, #03a9f4);
        padding: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .menu-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
        width: 100%;
      }
      .menu-row {
        display: flex;
        gap: 8px;
        justify-content: center;
        width: 100%;
      }
      .menu-question {
        font-weight: 500;
        text-align: center;
        margin-bottom: 8px;
      }
      .menu-overlay button {
        font: inherit;
        padding: 6px 8px;
        border-radius: 6px;
        border: 1px solid var(--divider-color, #e0e0e0);
        background: var(--card-background-color, #fff);
        color: var(--primary-text-color, #212121);
        cursor: pointer;
      }
      .menu-overlay button.confirm-btn {
        background: var(--error-color, #db4437);
        color: #fff;
        border-color: var(--error-color, #db4437);
      }
      .error-block {
        background: var(--card-background-color, #fff);
        border: 1px solid var(--error-color, #db4437);
        border-radius: var(--ha-card-border-radius, 8px);
        padding: 12px;
        color: var(--primary-text-color, #212121);
      }
      .error-detail {
        margin-top: 6px;
        color: var(--secondary-text-color, #727272);
        font-size: 0.85em;
      }
      .empty-block {
        background: var(--card-background-color, #fff);
        border: 1px solid var(--divider-color, #e0e0e0);
        border-radius: var(--ha-card-border-radius, 8px);
        padding: 16px;
        color: var(--secondary-text-color, #727272);
      }
      @media (max-width: 420px) {
        .card-grid {
          grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
        }
        .form-row {
          flex-direction: column;
          align-items: stretch;
        }
        .form-label {
          flex: none;
        }
      }
    `;
  }
}
customElements.define("admin-toolbox-panel", AdminToolboxPanel);
