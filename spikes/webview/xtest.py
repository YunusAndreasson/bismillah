"""Press raw keycodes through XTEST (no keysym or group translation).
Args: keycodes, or chords like 50+21 (hold 50, press 21)."""
import sys, time
from Xlib import X, display
from Xlib.ext import xtest
d = display.Display()
for arg in sys.argv[1:]:
    codes = [int(c) for c in arg.split("+")]
    for c in codes: xtest.fake_input(d, X.KeyPress, c); d.sync(); time.sleep(0.02)
    for c in reversed(codes): xtest.fake_input(d, X.KeyRelease, c); d.sync(); time.sleep(0.02)
    time.sleep(0.1)
