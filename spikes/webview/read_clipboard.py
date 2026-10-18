"""Print the X CLIPBOARD's UTF8_STRING contents as JSON (used by clipboard.ts)."""
import json
import sys, time
from Xlib import X, Xatom, display
d = display.Display(); w = d.screen().root.create_window(0, 0, 1, 1, 0, X.CopyFromParent)
clip, utf8, prop = d.intern_atom("CLIPBOARD"), d.intern_atom("UTF8_STRING"), d.intern_atom("BISMILLAH_CLIP")
w.convert_selection(clip, utf8, prop, X.CurrentTime); d.flush()
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
