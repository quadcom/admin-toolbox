"""The Admin Toolbox integration.

Owns a sidebar panel and its settings. Serves the panel's frontend module as
a static file, registers the panel itself, and exposes a WebSocket command
the panel's in-page link editor saves through. No entities, no devices.
"""

from __future__ import annotations

import logging
import os
from typing import Any

import voluptuous as vol
from homeassistant.components import frontend, websocket_api
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import ConfigEntryNotReady

from .const import (
    DEFAULT_OPTIONS,
    DOMAIN,
    JS_FILENAME,
    PANEL_COMPONENT_NAME,
    PANEL_CUSTOM_NAME,
    PANEL_MODULE_URL,
    PANEL_URL_PATH,
    STATIC_PATH_URL,
    WS_SAVE_OPTIONS,
)

_LOGGER = logging.getLogger(__name__)

# Key used in hass.data to note the static path has already been registered
# this run - re-registering the same path raises, and setup can run more
# than once (a reload) while HA itself has not restarted.
_DATA_STATIC_PATH_REGISTERED = "static_path_registered"


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Admin Toolbox from a config entry."""
    hass.data.setdefault(DOMAIN, {})

    if not hass.data[DOMAIN].get(_DATA_STATIC_PATH_REGISTERED):
        js_path = os.path.join(os.path.dirname(__file__), JS_FILENAME)

        def _js_exists() -> bool:
            return os.path.isfile(js_path)

        if not await hass.async_add_executor_job(_js_exists):
            _LOGGER.error("Admin Toolbox frontend file not found at %s", js_path)
            raise ConfigEntryNotReady(
                f"Admin Toolbox frontend file not found at {js_path}"
            )

        try:
            await hass.http.async_register_static_paths(
                [StaticPathConfig(STATIC_PATH_URL, js_path, False)]
            )
        except Exception as err:  # noqa: BLE001 - name the reason, never render nothing
            _LOGGER.error("Could not register Admin Toolbox static path: %s", err)
            raise ConfigEntryNotReady(
                f"Could not register Admin Toolbox static path: {err}"
            ) from err

        hass.data[DOMAIN][_DATA_STATIC_PATH_REGISTERED] = True

    _register_panel(hass, entry.options)

    if not hass.data[DOMAIN].get("ws_registered"):
        websocket_api.async_register_command(hass, websocket_save_options)
        hass.data[DOMAIN]["ws_registered"] = True

    entry.async_on_unload(entry.add_update_listener(_async_update_listener))

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry, removing the panel and leaving nothing behind."""
    frontend.async_remove_panel(hass, PANEL_URL_PATH)
    return True


async def _async_update_listener(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Re-register the panel so sidebar name, icon and admin-only stay live."""
    _register_panel(hass, entry.options)


@callback
def _register_panel(hass: HomeAssistant, options: dict[str, Any]) -> None:
    """Register (or re-register) the sidebar panel with the given options."""
    merged = {**DEFAULT_OPTIONS, **options}
    frontend.async_register_built_in_panel(
        hass,
        component_name=PANEL_COMPONENT_NAME,
        sidebar_title=merged["title"],
        sidebar_icon=merged["icon"],
        frontend_url_path=PANEL_URL_PATH,
        require_admin=merged["admin_only"],
        config={
            "_panel_custom": {
                "name": PANEL_CUSTOM_NAME,
                "module_url": PANEL_MODULE_URL,
                "embed_iframe": False,
            },
            "options": merged,
        },
        update=True,
    )


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): WS_SAVE_OPTIONS,
        vol.Required("options"): dict,
    }
)
@callback
def websocket_save_options(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Merge posted options into the config entry and save.

    The page sends only what it changed - in practice just the links list -
    so two things editing at once cannot clobber each other's fields.
    """
    entries = hass.config_entries.async_entries(DOMAIN)
    if not entries:
        connection.send_error(msg["id"], "not_found", "No Admin Toolbox entry")
        return

    entry = entries[0]
    merged = {**entry.options, **msg["options"]}
    hass.config_entries.async_update_entry(entry, options=merged)
    connection.send_result(msg["id"], merged)
