# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## 1.1.1 - 2026-09-21

### Fixed

- The Admin Toolbox entry now finds its way to the bottom of the sidebar after
  a Home Assistant restart. Before this it could be left up in the list until
  you reloaded the page.

## 1.1.0 - 2026-09-21

### Added

- Admin Toolbox now sits at the bottom of your sidebar, just above Settings,
  rather than at the end of the list. Turn it off in Configure if you would
  rather it stayed with the rest.

## 1.0.0 - 2026-09-14

First release.

### Added

- A sidebar page listing every panel you have hidden from your own sidebar,
  so a cluttered sidebar can be emptied into one place. Hiding is per person,
  so everyone sees their own.
- Add it once from Settings > Devices & services and the sidebar entry
  appears. No dashboard to create, nothing to paste, no configuration file.
- Your own links to things outside Home Assistant, added and edited on the
  page itself. Name one after the software it points at and its logo is
  filled in from the selfh.st icon library - "pihole" finds Pi-hole, and a
  near miss is offered as a suggestion rather than guessed at.
- A link with no logo gets a rounded square with the initials of its name,
  coloured from the name, instead of a generic icon.
- Add-on cards show the installed version, a marker when an update is
  waiting, and a dot showing whether the add-on is running.
- Press and hold an add-on card for Restart, Stop, View logs and Add-on page.
  Stopping and restarting ask first.
- A strip of system readings across the top, each with a trend line over the
  last six hours. Percentages are drawn against a true 0 to 100; anything
  else is fitted to its own range and labelled.
- Everything on the page can be renamed: the sidebar name and icon, both
  section headings, the readings shown and how far back they reach.
