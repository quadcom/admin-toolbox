// Puts the Admin Toolbox entry in the sidebar's fixed bottom group, directly
// above Settings, instead of leaving it at the end of the scrolling panel
// list. Loaded on every page by the integration, because the placement has to
// survive navigating anywhere in Home Assistant, not just dashboards.
//
// Home Assistant offers no setting for this and CSS cannot do it: the panel
// list is laid out by a block container inside a nested component that sizes
// itself to its contents, so there is no room for a rule to push an item into.
// Moving the element is the only thing that works.
//
// The option is read here rather than deciding whether to load this file,
// because a module added to the frontend cannot be removed again. Off means
// this does nothing at all.

const PANEL_URL_PATH = "admin-toolbox";
const OPTION = "pin_above_settings";

// Home Assistant's own members of the fixed group, which it marks with these
// classes. Anything else down there arrived by accident. The classes are used
// rather than the addresses because Notifications has no address at all, and
// neither does an entry whose shadow root has not rendered yet - so an address
// test strands exactly the items it is meant to protect.
const NATIVE_FIXED = ["configuration", "notifications", "user"];

function panel() {
  const ha = document.querySelector("home-assistant");
  const panels = ha && ha.hass ? ha.hass.panels : null;
  return panels ? panels[PANEL_URL_PATH] : null;
}

function wanted() {
  const p = panel();
  const options = p && p.config ? p.config.options : null;
  // Absent means an older config entry that predates the setting, and the
  // default for it is on.
  return !options || options[OPTION] !== false;
}

function sidebarShadow() {
  const ha = document.querySelector("home-assistant");
  const main = ha && ha.shadowRoot && ha.shadowRoot.querySelector("home-assistant-main");
  const bar = main && main.shadowRoot && main.shadowRoot.querySelector("ha-sidebar");
  return bar && bar.shadowRoot ? bar.shadowRoot : null;
}

// The entry carries no address of its own; each one lives on an anchor inside
// that entry's shadow root.
function entryHref(button) {
  const anchor = button.shadowRoot && button.shadowRoot.querySelector("a");
  return anchor ? anchor.getAttribute("href") || "" : "";
}

function isNative(button) {
  return NATIVE_FIXED.some((c) => button.classList.contains(c));
}

// The entry is matched on its address, falling back to the title Home
// Assistant shows for the panel - which the user can rename, so it is read
// from the panel list rather than hard-coded.
function isOurs(button, title) {
  if (entryHref(button) === "/" + PANEL_URL_PATH) return true;
  return !!title && (button.textContent || "").trim().startsWith(title);
}

function pin() {
  if (!wanted()) return true; // nothing to do, and nothing to retry
  const shadow = sidebarShadow();
  if (!shadow) return false;
  const p = panel();
  const title = p && p.title ? p.title : null;

  // Settings keeps a stable class, which is a better anchor than its label.
  const settings = shadow.querySelector("ha-list-item-button.configuration");
  if (!settings || !settings.parentNode) return false;

  const fixed = settings.parentNode;
  const buttons = Array.from(shadow.querySelectorAll("ha-list-item-button"));
  const list = buttons.map((b) => b.parentNode).find((c) => c && c !== fixed);
  if (!list) return false;

  // These nodes belong to Home Assistant, and it rebuilds the panel list every
  // time a panel registers - during a restart, many times over. It keeps no
  // record of one of its nodes having been moved down here, so it reuses that
  // node for whatever panel now holds the slot: this entry quietly becomes
  // some other dashboard, stranded at the bottom, while a fresh entry is built
  // for this one. Putting the strays back is what repairs that.
  Array.from(fixed.children).forEach((node) => {
    if (node.tagName !== "HA-LIST-ITEM-BUTTON") return;
    if (isNative(node) || isOurs(node, title)) return;
    list.appendChild(node);
  });

  // The same rebuild leaves copies of this entry behind. Keep the last, which
  // is the one Home Assistant built most recently and still owns.
  const found = buttons.filter((b) => isOurs(b, title));
  if (!found.length) return false;

  const entry = found[found.length - 1];
  found.slice(0, -1).forEach((stale) => stale.remove());

  if (entry.nextElementSibling === settings) return true; // already in place
  fixed.insertBefore(entry, settings);
  return true;
}

// The placement survives navigation and idle redraws, but not a panel being
// added or removed, so the observers put it back rather than leaving it
// adrift. They are also what clears the copies a restart leaves behind, since
// panels arrive one at a time and each arrival rebuilds the list.
//
// Two of them, because a MutationObserver does not cross a shadow boundary:
// one inside the sidebar for the list being rebuilt, and one on the element
// that owns the sidebar, so a sidebar thrown away and rebuilt while Home
// Assistant reconnects is noticed at all.
let sidebarObserver = null;
let observedShadow = null;
let mainObserver = null;
let busy = false;

function apply() {
  if (busy) return; // our own moves must not retrigger this
  busy = true;
  requestAnimationFrame(() => {
    watch();
    pin();
    busy = false;
  });
}

// Rebinds when the sidebar is not the one already being watched. Without this
// a page that lived through a restart holds an observer on a detached tree,
// which never fires again and never places anything.
function watch() {
  const shadow = sidebarShadow();
  if (!shadow || shadow === observedShadow) return;
  if (sidebarObserver) sidebarObserver.disconnect();
  sidebarObserver = new MutationObserver(apply);
  sidebarObserver.observe(shadow, { childList: true, subtree: true });
  observedShadow = shadow;
}

function watchMain() {
  if (mainObserver) return;
  const ha = document.querySelector("home-assistant");
  const main = ha && ha.shadowRoot && ha.shadowRoot.querySelector("home-assistant-main");
  if (!main || !main.shadowRoot) return;
  // Direct children only: the sidebar is one of them, and the panel content
  // beside it changes constantly on a normal dashboard.
  mainObserver = new MutationObserver(apply);
  mainObserver.observe(main.shadowRoot, { childList: true });
}

// The sidebar is not there on the first frame, and after a restart the panel
// can be minutes behind it. Watching starts the moment the sidebar exists,
// whether or not the entry has arrived yet - waiting for a successful
// placement before watching is what left restarts broken until a reload.
let attempts = 0;
const timer = setInterval(() => {
  attempts += 1;
  watchMain();
  watch();
  const placed = pin();
  if ((placed && observedShadow) || attempts > 40) {
    clearInterval(timer);
    if (!observedShadow) {
      // Refuse quietly in the sidebar, loudly in the log: a page with no
      // sidebar has nothing to place, but a page that should have one and
      // does not is a fault someone needs to see.
      console.error(
        "Admin Toolbox: no sidebar found after 20 seconds, so its entry has " +
          "been left where Home Assistant put it. Reload the page to try again."
      );
    }
  }
}, 500);
