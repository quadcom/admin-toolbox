"""Config and options flow for Admin Toolbox.

Adding the integration takes no input - single_config_entry in the manifest
already refuses a second instance, so the flaw that prompted this rebuild
cannot come back. The options flow edits every setting except the links
(`extra`), which the panel's own in-page editor owns.
"""

from __future__ import annotations

from typing import Any

import voluptuous as vol
from homeassistant.config_entries import ConfigEntry, ConfigFlow, OptionsFlow
from homeassistant.core import callback
from homeassistant.helpers import selector

from .const import (
    CHART_HOURS_MAX,
    CHART_HOURS_MIN,
    CONF_ADMIN_ONLY,
    CONF_CHART_HOURS,
    CONF_EXTRA,
    CONF_EXTRA_HEADING,
    CONF_HIDDEN_HEADING,
    CONF_ICON,
    CONF_STATS,
    CONF_TITLE,
    DEFAULT_OPTIONS,
    DOMAIN,
)


class AdminToolboxConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle the single-step setup flow."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> Any:
        """Create the entry with the fixed defaults - no input needed."""
        return self.async_create_entry(title="Admin Toolbox", data={}, options=DEFAULT_OPTIONS)

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> AdminToolboxOptionsFlow:
        """Get the options flow for this handler."""
        return AdminToolboxOptionsFlow()


class AdminToolboxOptionsFlow(OptionsFlow):
    """Handle the options flow.

    Does not assign self.config_entry in __init__ - the base class provides
    it, following the current (non-deprecated) pattern.
    """

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> Any:
        """Show and save the settings form, preserving the links untouched."""
        current = {**DEFAULT_OPTIONS, **self.config_entry.options}

        if user_input is not None:
            merged = {**current, **user_input, CONF_EXTRA: current[CONF_EXTRA]}
            return self.async_create_entry(data=merged)

        schema = vol.Schema(
            {
                vol.Required(CONF_TITLE, default=current[CONF_TITLE]): selector.TextSelector(),
                vol.Required(CONF_ICON, default=current[CONF_ICON]): selector.IconSelector(),
                vol.Required(
                    CONF_ADMIN_ONLY, default=current[CONF_ADMIN_ONLY]
                ): selector.BooleanSelector(),
                vol.Optional(
                    CONF_HIDDEN_HEADING, default=current[CONF_HIDDEN_HEADING]
                ): selector.TextSelector(),
                vol.Optional(
                    CONF_EXTRA_HEADING, default=current[CONF_EXTRA_HEADING]
                ): selector.TextSelector(),
                vol.Required(
                    CONF_CHART_HOURS, default=current[CONF_CHART_HOURS]
                ): selector.NumberSelector(
                    selector.NumberSelectorConfig(
                        min=CHART_HOURS_MIN,
                        max=CHART_HOURS_MAX,
                        mode=selector.NumberSelectorMode.BOX,
                    )
                ),
                vol.Optional(
                    CONF_STATS, default=current[CONF_STATS]
                ): selector.EntitySelector(
                    selector.EntitySelectorConfig(domain="sensor", multiple=True)
                ),
            }
        )
        return self.async_show_form(step_id="init", data_schema=schema)
