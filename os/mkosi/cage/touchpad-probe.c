/* SPDX-License-Identifier: MIT
 * Debug-only end-to-end test: real uinput -> libinput -> Cage -> Wayland buttons.
 * No access to a physical input device or to the writer's documents.
 */
#define _GNU_SOURCE
#include "xdg-shell-client.h"
#include <errno.h>
#include <fcntl.h>
#include <linux/input.h>
#include <linux/uinput.h>
#include <poll.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/mman.h>
#include <time.h>
#include <unistd.h>
#include <wayland-client.h>

#define CHECK(x)                                                                                                       \
	do {                                                                                                           \
		if (!(x)) {                                                                                            \
			fprintf(stderr, "touchpad probe: %s failed at line %d\n", #x, __LINE__);                       \
			exit(1);                                                                                       \
		}                                                                                                      \
	} while (0)
static struct wl_display *display;
static struct wl_compositor *compositor;
static struct wl_shm *shm;
static struct xdg_wm_base *wm;
static struct wl_surface *surface;
static struct wl_buffer *buffer;
static bool configured, typed;
static int width = 1280, height = 800;
static unsigned presses, releases, axes;
static double scroll;

static int64_t
now_ms(void)
{
	struct timespec t;
	CHECK(clock_gettime(CLOCK_MONOTONIC, &t) == 0);
	return (int64_t) t.tv_sec * 1000 + t.tv_nsec / 1000000;
}
static void
pump(int ms)
{
	int64_t end = now_ms() + ms;
	do {
		CHECK(wl_display_dispatch_pending(display) >= 0);
		CHECK(wl_display_flush(display) >= 0 || errno == EAGAIN);
		struct pollfd p = {.fd = wl_display_get_fd(display), .events = POLLIN};
		int remaining = (int) (end - now_ms());
		if (remaining <= 0)
			break;
		int r = poll(&p, 1, remaining > 20 ? 20 : remaining);
		CHECK(r >= 0 || errno == EINTR);
		if (r > 0)
			CHECK(wl_display_dispatch(display) >= 0);
	} while (now_ms() < end);
}
static void
enter(void *d, struct wl_pointer *p, uint32_t s, struct wl_surface *w, wl_fixed_t x, wl_fixed_t y)
{
	(void) d;
	(void) p;
	(void) s;
	(void) w;
	(void) x;
	(void) y;
}
static void
leave(void *d, struct wl_pointer *p, uint32_t s, struct wl_surface *w)
{
	(void) d;
	(void) p;
	(void) s;
	(void) w;
}
static void
motion(void *d, struct wl_pointer *p, uint32_t t, wl_fixed_t x, wl_fixed_t y)
{
	(void) d;
	(void) p;
	(void) t;
	(void) x;
	(void) y;
}
static void
button(void *d, struct wl_pointer *p, uint32_t s, uint32_t t, uint32_t b, uint32_t state)
{
	(void) d;
	(void) p;
	(void) s;
	(void) t;
	if (b == BTN_LEFT) {
		if (state == WL_POINTER_BUTTON_STATE_PRESSED)
			presses++;
		else
			releases++;
	}
}
static void
axis(void *d, struct wl_pointer *p, uint32_t t, uint32_t a, wl_fixed_t v)
{
	(void) d;
	(void) p;
	(void) t;
	if (a == WL_POINTER_AXIS_VERTICAL_SCROLL) {
		axes++;
		scroll += wl_fixed_to_double(v);
	}
}
static void
frame(void *d, struct wl_pointer *p)
{
	(void) d;
	(void) p;
}
static void
axis_source(void *d, struct wl_pointer *p, uint32_t s)
{
	(void) d;
	(void) p;
	(void) s;
}
static void
axis_stop(void *d, struct wl_pointer *p, uint32_t t, uint32_t a)
{
	(void) d;
	(void) p;
	(void) t;
	(void) a;
}
static void
axis_discrete(void *d, struct wl_pointer *p, uint32_t a, int32_t v)
{
	(void) d;
	(void) p;
	(void) a;
	(void) v;
}
static const struct wl_pointer_listener pointer_listener = {
	.enter = enter,
	.leave = leave,
	.motion = motion,
	.button = button,
	.axis = axis,
	.frame = frame,
	.axis_source = axis_source,
	.axis_stop = axis_stop,
	.axis_discrete = axis_discrete,
};
static void
keymap(void *d, struct wl_keyboard *k, uint32_t format, int fd, uint32_t size)
{
	(void) d;
	(void) k;
	(void) format;
	(void) size;
	close(fd);
}
static void
keyboard_enter(void *d, struct wl_keyboard *k, uint32_t serial, struct wl_surface *w, struct wl_array *keys)
{
	(void) d;
	(void) k;
	(void) serial;
	(void) w;
	(void) keys;
}
static void
keyboard_leave(void *d, struct wl_keyboard *k, uint32_t serial, struct wl_surface *w)
{
	(void) d;
	(void) k;
	(void) serial;
	(void) w;
}
static void
key(void *d, struct wl_keyboard *k, uint32_t serial, uint32_t time, uint32_t code, uint32_t state)
{
	(void) d;
	(void) k;
	(void) serial;
	(void) time;
	if (code == KEY_A && state == WL_KEYBOARD_KEY_STATE_RELEASED)
		typed = true;
}
static void
modifiers(void *d, struct wl_keyboard *k, uint32_t s, uint32_t a, uint32_t b, uint32_t c, uint32_t g)
{
	(void) d;
	(void) k;
	(void) s;
	(void) a;
	(void) b;
	(void) c;
	(void) g;
}
static void
repeat(void *d, struct wl_keyboard *k, int32_t rate, int32_t delay)
{
	(void) d;
	(void) k;
	(void) rate;
	(void) delay;
}
static const struct wl_keyboard_listener keyboard_listener = {
	.keymap = keymap,
	.enter = keyboard_enter,
	.leave = keyboard_leave,
	.key = key,
	.modifiers = modifiers,
	.repeat_info = repeat,
};
static void
capabilities(void *d, struct wl_seat *seat, uint32_t caps)
{
	(void) d;
	static bool bound, keyboard_bound;
	if (!bound && (caps & WL_SEAT_CAPABILITY_POINTER)) {
		wl_pointer_add_listener(wl_seat_get_pointer(seat), &pointer_listener, NULL);
		bound = true;
	}
	if (!keyboard_bound && (caps & WL_SEAT_CAPABILITY_KEYBOARD)) {
		wl_keyboard_add_listener(wl_seat_get_keyboard(seat), &keyboard_listener, NULL);
		keyboard_bound = true;
	}
}
static void
seat_name(void *d, struct wl_seat *s, const char *n)
{
	(void) d;
	(void) s;
	(void) n;
}
static const struct wl_seat_listener seat_listener = {.capabilities = capabilities, .name = seat_name};
static void
ping(void *d, struct xdg_wm_base *base, uint32_t serial)
{
	(void) d;
	xdg_wm_base_pong(base, serial);
}
static const struct xdg_wm_base_listener wm_listener = {.ping = ping};
static void
global(void *d, struct wl_registry *r, uint32_t name, const char *interface, uint32_t version)
{
	(void) d;
	if (!strcmp(interface, "wl_compositor"))
		compositor = wl_registry_bind(r, name, &wl_compositor_interface, 4);
	else if (!strcmp(interface, "wl_shm"))
		shm = wl_registry_bind(r, name, &wl_shm_interface, 1);
	else if (!strcmp(interface, "xdg_wm_base")) {
		wm = wl_registry_bind(r, name, &xdg_wm_base_interface, 1);
		xdg_wm_base_add_listener(wm, &wm_listener, NULL);
	} else if (!strcmp(interface, "wl_seat") && version >= 5) {
		struct wl_seat *seat = wl_registry_bind(r, name, &wl_seat_interface, 5);
		wl_seat_add_listener(seat, &seat_listener, NULL);
	}
}
static void
removed(void *d, struct wl_registry *r, uint32_t n)
{
	(void) d;
	(void) r;
	(void) n;
}
static const struct wl_registry_listener registry_listener = {.global = global, .global_remove = removed};
static void
configure(void *d, struct xdg_surface *xdg, uint32_t serial)
{
	(void) d;
	xdg_surface_ack_configure(xdg, serial);
	if (!buffer) {
		int size = width * height * 4;
		int fd = memfd_create("bismillah-touchpad-probe", MFD_CLOEXEC);
		CHECK(fd >= 0);
		CHECK(ftruncate(fd, size) == 0);
		uint32_t *pixels = mmap(NULL, size, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
		CHECK(pixels != MAP_FAILED);
		for (int i = 0; i < size / 4; i++)
			pixels[i] = 0x00305040;
		struct wl_shm_pool *pool = wl_shm_create_pool(shm, fd, size);
		buffer = wl_shm_pool_create_buffer(pool, 0, width, height, width * 4, WL_SHM_FORMAT_XRGB8888);
		wl_shm_pool_destroy(pool);
		close(fd);
		CHECK(munmap(pixels, size) == 0);
	}
	wl_surface_attach(surface, buffer, 0, 0);
	wl_surface_damage(surface, 0, 0, width, height);
	wl_surface_commit(surface);
	configured = true;
}
static const struct xdg_surface_listener surface_listener = {.configure = configure};
static void
top_configure(void *d, struct xdg_toplevel *top, int32_t w, int32_t h, struct wl_array *states)
{
	(void) d;
	(void) top;
	(void) states;
	if (w > 0)
		width = w;
	if (h > 0)
		height = h;
}
static void
top_close(void *d, struct xdg_toplevel *top)
{
	(void) d;
	(void) top;
	exit(1);
}
static const struct xdg_toplevel_listener top_listener = {.configure = top_configure, .close = top_close};

static void
emit(int fd, unsigned short type, unsigned short code, int value)
{
	struct input_event ev = {.type = type, .code = code, .value = value};
	CHECK(write(fd, &ev, sizeof(ev)) == (ssize_t) sizeof(ev));
}
static void
sync_input(int fd)
{
	emit(fd, EV_SYN, SYN_REPORT, 0);
}
static void
abs_axis(int fd, int code, int max, int resolution)
{
	CHECK(ioctl(fd, UI_SET_ABSBIT, code) == 0);
	struct uinput_abs_setup a = {.code = (unsigned short) code,
				     .absinfo = {.minimum = 0, .maximum = max, .resolution = resolution}};
	CHECK(ioctl(fd, UI_ABS_SETUP, &a) == 0);
}
static int
touchpad(void)
{
	int fd = open("/dev/uinput", O_WRONLY | O_NONBLOCK);
	CHECK(fd >= 0);
	CHECK(ioctl(fd, UI_SET_EVBIT, EV_KEY) == 0);
	CHECK(ioctl(fd, UI_SET_EVBIT, EV_ABS) == 0);
	const int keys[] = {BTN_LEFT, BTN_TOUCH, BTN_TOOL_FINGER, BTN_TOOL_DOUBLETAP};
	for (unsigned i = 0; i < sizeof(keys) / sizeof(keys[0]); i++)
		CHECK(ioctl(fd, UI_SET_KEYBIT, keys[i]) == 0);
	CHECK(ioctl(fd, UI_SET_PROPBIT, INPUT_PROP_POINTER) == 0);
	CHECK(ioctl(fd, UI_SET_PROPBIT, INPUT_PROP_BUTTONPAD) == 0);
	abs_axis(fd, ABS_X, 2000, 20);
	abs_axis(fd, ABS_Y, 1400, 20);
	abs_axis(fd, ABS_PRESSURE, 255, 0);
	abs_axis(fd, ABS_MT_SLOT, 1, 0);
	abs_axis(fd, ABS_MT_TRACKING_ID, 65535, 0);
	abs_axis(fd, ABS_MT_POSITION_X, 2000, 20);
	abs_axis(fd, ABS_MT_POSITION_Y, 1400, 20);
	struct uinput_setup u = {.id = {.bustype = BUS_I2C, .vendor = 0x06cb, .product = 0x1234, .version = 1}};
	strcpy(u.name, "bismillah test touchpad");
	CHECK(ioctl(fd, UI_SET_PHYS, "i2c/bismillah-touchpad") == 0);
	CHECK(ioctl(fd, UI_DEV_SETUP, &u) == 0);
	CHECK(ioctl(fd, UI_DEV_CREATE) == 0);
	return fd;
}
static void
finger(int fd, int slot, int id, int x, int y)
{
	emit(fd, EV_ABS, ABS_MT_SLOT, slot);
	emit(fd, EV_ABS, ABS_MT_TRACKING_ID, id);
	if (id >= 0) {
		emit(fd, EV_ABS, ABS_MT_POSITION_X, x);
		emit(fd, EV_ABS, ABS_MT_POSITION_Y, y);
	}
}
static void
tap(int fd)
{
	finger(fd, 0, 1, 1000, 700);
	emit(fd, EV_ABS, ABS_X, 1000);
	emit(fd, EV_ABS, ABS_Y, 700);
	emit(fd, EV_ABS, ABS_PRESSURE, 40);
	emit(fd, EV_KEY, BTN_TOUCH, 1);
	emit(fd, EV_KEY, BTN_TOOL_FINGER, 1);
	sync_input(fd);
	pump(80);
	finger(fd, 0, -1, 0, 0);
	emit(fd, EV_ABS, ABS_PRESSURE, 0);
	emit(fd, EV_KEY, BTN_TOUCH, 0);
	emit(fd, EV_KEY, BTN_TOOL_FINGER, 0);
	sync_input(fd);
	pump(500);
}
int
main(void)
{
	display = wl_display_connect(NULL);
	CHECK(display);
	wl_registry_add_listener(wl_display_get_registry(display), &registry_listener, NULL);
	CHECK(wl_display_roundtrip(display) >= 0);
	CHECK(compositor && shm && wm);
	surface = wl_compositor_create_surface(compositor);
	struct xdg_surface *xdg = xdg_wm_base_get_xdg_surface(wm, surface);
	xdg_surface_add_listener(xdg, &surface_listener, NULL);
	struct xdg_toplevel *top = xdg_surface_get_toplevel(xdg);
	xdg_toplevel_add_listener(top, &top_listener, NULL);
	xdg_toplevel_set_title(top, "Touchpad regression probe");
	wl_surface_commit(surface);
	for (int n = 0; n < 100 && !configured; n++)
		pump(100);
	CHECK(configured);
	pump(500);
	int fd = touchpad();
	pump(2500); // real udev discovery and Cage hotplug policy
	// Give the new window pointer focus with a small move, then tap without BTN_LEFT.
	finger(fd, 0, 10, 990, 700);
	emit(fd, EV_KEY, BTN_TOOL_FINGER, 1);
	emit(fd, EV_KEY, BTN_TOUCH, 1);
	emit(fd, EV_ABS, ABS_X, 990);
	emit(fd, EV_ABS, ABS_Y, 700);
	emit(fd, EV_ABS, ABS_PRESSURE, 40);
	sync_input(fd);
	pump(100);
	for (int x = 1000; x <= 1200; x += 20) {
		emit(fd, EV_ABS, ABS_MT_POSITION_X, x);
		emit(fd, EV_ABS, ABS_X, x);
		sync_input(fd);
		pump(30);
	}
	finger(fd, 0, -1, 0, 0);
	emit(fd, EV_KEY, BTN_TOUCH, 0);
	emit(fd, EV_KEY, BTN_TOOL_FINGER, 0);
	emit(fd, EV_ABS, ABS_PRESSURE, 0);
	sync_input(fd);
	pump(500);
	presses = releases = 0;
	tap(fd);
	CHECK(presses == 1 && releases == 1);
	puts("TOUCHPAD_PROBE tap-to-click passed");
	fflush(stdout);
	/* A real clickpad press always has a finger in contact. With button areas,
	 * libinput deliberately ignores a bare switch event without a finger. */
	finger(fd, 0, 2, 1000, 700);
	emit(fd, EV_ABS, ABS_X, 1000);
	emit(fd, EV_ABS, ABS_Y, 700);
	emit(fd, EV_ABS, ABS_PRESSURE, 40);
	emit(fd, EV_KEY, BTN_TOUCH, 1);
	emit(fd, EV_KEY, BTN_TOOL_FINGER, 1);
	sync_input(fd);
	pump(100);
	emit(fd, EV_KEY, BTN_LEFT, 1);
	sync_input(fd);
	pump(80);
	emit(fd, EV_KEY, BTN_LEFT, 0);
	sync_input(fd);
	pump(100);
	finger(fd, 0, -1, 0, 0);
	emit(fd, EV_KEY, BTN_TOUCH, 0);
	emit(fd, EV_KEY, BTN_TOOL_FINGER, 0);
	emit(fd, EV_ABS, ABS_PRESSURE, 0);
	sync_input(fd);
	pump(500);
	fprintf(stderr, "physical click counts: %u presses, %u releases\n", presses, releases);
	CHECK(presses == 2 && releases == 2);
	puts("TOUCHPAD_PROBE physical-click passed");
	fflush(stdout);
	finger(fd, 0, 20, 900, 600);
	finger(fd, 1, 21, 1100, 600);
	emit(fd, EV_ABS, ABS_X, 900);
	emit(fd, EV_ABS, ABS_Y, 600);
	emit(fd, EV_ABS, ABS_PRESSURE, 40);
	emit(fd, EV_KEY, BTN_TOOL_DOUBLETAP, 1);
	emit(fd, EV_KEY, BTN_TOUCH, 1);
	sync_input(fd);
	pump(100);
	for (int y = 640; y <= 1000; y += 40) {
		emit(fd, EV_ABS, ABS_MT_SLOT, 0);
		emit(fd, EV_ABS, ABS_MT_POSITION_Y, y);
		emit(fd, EV_ABS, ABS_MT_SLOT, 1);
		emit(fd, EV_ABS, ABS_MT_POSITION_Y, y);
		emit(fd, EV_ABS, ABS_Y, y);
		sync_input(fd);
		pump(50);
	}
	finger(fd, 0, -1, 0, 0);
	finger(fd, 1, -1, 0, 0);
	emit(fd, EV_KEY, BTN_TOOL_DOUBLETAP, 0);
	emit(fd, EV_KEY, BTN_TOUCH, 0);
	emit(fd, EV_ABS, ABS_PRESSURE, 0);
	sync_input(fd);
	pump(500);
	CHECK(axes > 0 && (scroll > 0.1 || scroll < -0.1));
	CHECK(presses == 2 && releases == 2);
	puts("TOUCHPAD_PROBE two-finger-scroll passed");
	puts("TOUCHPAD_PROBE typing-ready");
	fflush(stdout);
	for (int n = 0; n < 200 && !typed; n++)
		pump(100);
	CHECK(typed);
	tap(fd);
	CHECK(presses == 2 && releases == 2);
	puts("TOUCHPAD_PROBE disable-while-typing passed");
	pump(1000);
	tap(fd);
	CHECK(presses == 3 && releases == 3);
	puts("TOUCHPAD_PROBE tap-after-typing passed");
	CHECK(ioctl(fd, UI_DEV_DESTROY) == 0);
	close(fd);
	wl_display_disconnect(display);
	return 0;
}
