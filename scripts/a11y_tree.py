#!/usr/bin/env python3
"""Prints bismillah's accessibility tree, as a screen reader reads it, as JSON.

Run by scripts/a11y.ts with the system Python (it needs the AT-SPI bindings of
python-gobject), inside scripts/headless.sh with a private accessibility bus
(AT_SPI_BUS_ADDRESS). Each node: role, name, description, states, a few attributes,
children. The text inside the writing surface is left out: it is the document, not
the interface.

    /usr/bin/python3 -I scripts/a11y_tree.py
"""

from __future__ import annotations

import json
import sys

import gi

gi.require_version("Atspi", "2.0")
from gi.repository import Atspi  # noqa: E402

STATES = {
    "focusable": Atspi.StateType.FOCUSABLE,
    "focused": Atspi.StateType.FOCUSED,
    "selected": Atspi.StateType.SELECTED,
    "expanded": Atspi.StateType.EXPANDED,
    "expandable": Atspi.StateType.EXPANDABLE,
    "checked": Atspi.StateType.CHECKED,
    "pressed": Atspi.StateType.PRESSED,
    "editable": Atspi.StateType.EDITABLE,
    "showing": Atspi.StateType.SHOWING,
    "modal": Atspi.StateType.MODAL,
    "invalid": Atspi.StateType.INVALID_ENTRY,
}
ATTRIBUTES = ("level", "tag", "xml-roles", "live", "container-live", "id", "placeholder-text")
LIMIT = 6000


def node(accessible, count: list[int], depth: int = 0) -> dict | None:
    if accessible is None or count[0] > LIMIT:
        return None
    count[0] += 1
    try:
        states = accessible.get_state_set()
        attributes = accessible.get_attributes() or {}
        out = {
            "role": accessible.get_role_name(),
            "name": accessible.get_name() or "",
            "description": accessible.get_description() or "",
            "states": [s for s, t in STATES.items() if states.contains(t)],
            "attributes": {k: v for k, v in attributes.items() if k in ATTRIBUTES},
            "children": [],
        }
    except Exception as error:  # a node that went away while being read
        return {"role": "gone", "name": str(error), "children": []}
    # The writing surface's lines are the document; its own node is what matters.
    if out["role"] == "entry" and "editable" in out["states"] and depth > 3:
        return out
    for i in range(accessible.get_child_count()):
        child = node(accessible.get_child_at_index(i), count, depth + 1)
        if child is not None:
            out["children"].append(child)
    return out


def main() -> None:
    desktop = Atspi.get_desktop(0)
    count = [0]
    for i in range(desktop.get_child_count()):
        app = desktop.get_child_at_index(i)
        if app is not None and app.get_name() == "bismillah":
            json.dump(node(app, count), sys.stdout, ensure_ascii=False)
            return
    json.dump(None, sys.stdout)


if __name__ == "__main__":
    main()
