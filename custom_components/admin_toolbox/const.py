"""Constants for the Admin Toolbox integration."""

from __future__ import annotations

DOMAIN = "admin_toolbox"

# Panel identity.
PANEL_COMPONENT_NAME = "custom"
PANEL_CUSTOM_NAME = "admin-toolbox-panel"
PANEL_URL_PATH = "admin-toolbox"
PANEL_MODULE_URL = "/admin_toolbox/admin-toolbox.js"
STATIC_PATH_URL = "/admin_toolbox/admin-toolbox.js"
JS_FILENAME = "admin-toolbox.js"

# The sidebar placement module. Loaded on every page rather than only on the
# panel, because the placement has to survive navigating anywhere.
PIN_JS_FILENAME = "pin-sidebar.js"
PIN_STATIC_PATH_URL = "/admin_toolbox/pin-sidebar.js"

# WebSocket command the in-page link editor saves through.
WS_SAVE_OPTIONS = f"{DOMAIN}/save_options"

# Option keys.
CONF_TITLE = "title"
CONF_ICON = "icon"
CONF_ADMIN_ONLY = "admin_only"
CONF_HIDDEN_HEADING = "hidden_heading"
CONF_EXTRA_HEADING = "extra_heading"
CONF_CHART_HOURS = "chart_hours"
CONF_PIN_ABOVE_SETTINGS = "pin_above_settings"
CONF_STATS = "stats"
CONF_EXTRA = "extra"

# Defaults. Empty string/list means "use the frontend's own default" - this
# integration does not invent wording the panel already owns.
DEFAULT_OPTIONS: dict[str, object] = {
    CONF_TITLE: "Admin",
    CONF_ICON: "mdi:toolbox",
    CONF_ADMIN_ONLY: True,
    CONF_HIDDEN_HEADING: "",
    CONF_EXTRA_HEADING: "",
    CONF_CHART_HOURS: 6,
    CONF_PIN_ABOVE_SETTINGS: True,
    CONF_STATS: [],
    CONF_EXTRA: [],
}

CHART_HOURS_MIN = 1
CHART_HOURS_MAX = 168
