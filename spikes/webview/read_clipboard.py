"""Print the X CLIPBOARD's contents as JSON, as another app would receive them.
Args: the target to ask for (default UTF8_STRING; e.g. text/html). Used by clipboard.ts."""
import json
import sys, time
from Xlib import X, display
target = sys.argv[1] if len(sys.argv) > 1 else "UTF8_STRING"
d = display.Display(); w = d.screen().root.create_window(0, 0, 1, 1, 0, X.CopyFromParent)
clip, kind, prop = d.intern_atom("CLIPBOARD"), d.intern_atom(target), d.intern_atom("BISMILLAH_CLIP")
w.convert_selection(clip, kind, prop, X.CurrentTime); d.flush()
deadline = time.time() + 3
while time.time() < deadline:
    if d.pending_events():
        e = d.next_event()
        if e.type == X.SelectionNotify:
            data = w.get_full_property(prop, X.AnyPropertyType)
            text = data.value.decode("utf-8") if data else ""
            print(json.dumps(text))
            sys.exit(0)
    time.sleep(0.02)
print("no clipboard owner"); sys.exit(1)
