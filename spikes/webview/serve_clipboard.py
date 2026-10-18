"""Own the X CLIPBOARD and serve a text file's contents as UTF8_STRING, like another app
that copied it (used by clipboard.ts). Exits after serving one paste or a timeout.

    python serve_clipboard.py <file>
"""
import sys, time
from Xlib import X, Xatom, display
text = open(sys.argv[1], encoding="utf-8").read().encode("utf-8")
d = display.Display(); w = d.screen().root.create_window(0, 0, 1, 1, 0, X.CopyFromParent)
clip, utf8, targets = d.intern_atom("CLIPBOARD"), d.intern_atom("UTF8_STRING"), d.intern_atom("TARGETS")
plain = d.intern_atom("text/plain;charset=utf-8")
w.set_selection_owner(clip, X.CurrentTime); d.flush()
print("ready", flush=True)
deadline = time.time() + 10
served = False
while time.time() < deadline and not served:
    if not d.pending_events():
        time.sleep(0.01); continue
    e = d.next_event()
    if e.type != X.SelectionRequest:
        continue
    prop = e.property or e.target
    if e.target == targets:
        e.requestor.change_property(prop, Xatom.ATOM, 32, [targets, utf8, plain])
    elif e.target in (utf8, plain):
        e.requestor.change_property(prop, e.target, 8, text); served = True
    else:
        prop = X.NONE
    from Xlib.protocol import event as ev
    e.requestor.send_event(ev.SelectionNotify(time=e.time, requestor=e.requestor, selection=e.selection, target=e.target, property=prop))
    d.flush()
