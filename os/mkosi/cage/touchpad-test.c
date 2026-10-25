/* SPDX-License-Identifier: MIT
 * Compile the exact compositor policy against the real libinput/wlroots headers,
 * with recording stand-ins for devices. These checks also run in release builds.
 */
#include "touchpad.h"
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>

static bool native;
static int fingers, dwt_available, tap_calls, dwt_calls, handle_calls;
static enum libinput_config_status tap_status, dwt_status;
static enum libinput_config_tap_state tap_value;
static enum libinput_config_dwt_state dwt_value;
/* libinput_device is opaque to its callers. The stand-in is never dereferenced. */
static max_align_t token;

bool
wlr_input_device_is_libinput(struct wlr_input_device *device)
{
	(void) device;
	return native;
}
struct libinput_device *
wlr_libinput_get_device_handle(struct wlr_input_device *device)
{
	(void) device;
	handle_calls++;
	return (struct libinput_device *) &token;
}
int
libinput_device_config_tap_get_finger_count(struct libinput_device *device)
{
	(void) device;
	return fingers;
}
enum libinput_config_status
libinput_device_config_tap_set_enabled(struct libinput_device *device, enum libinput_config_tap_state value)
{
	(void) device;
	tap_calls++;
	tap_value = value;
	return tap_status;
}
int
libinput_device_config_dwt_is_available(struct libinput_device *device)
{
	(void) device;
	return dwt_available;
}
enum libinput_config_status
libinput_device_config_dwt_set_enabled(struct libinput_device *device, enum libinput_config_dwt_state value)
{
	(void) device;
	dwt_calls++;
	dwt_value = value;
	return dwt_status;
}

#define CHECK(expr)                                                                                                    \
	do {                                                                                                           \
		if (!(expr)) {                                                                                         \
			fprintf(stderr, "touchpad policy: %s failed\n", #expr);                                        \
			exit(1);                                                                                       \
		}                                                                                                      \
	} while (0)
static void
reset(void)
{
	native = true;
	fingers = 2;
	dwt_available = 1;
	tap_calls = dwt_calls = handle_calls = 0;
	tap_status = dwt_status = LIBINPUT_CONFIG_STATUS_SUCCESS;
}
int
main(void)
{
	struct wlr_input_device device = {.type = WLR_INPUT_DEVICE_POINTER};
	reset();
	CHECK(cg_configure_touchpad(&device));
	CHECK(tap_calls == 1 && tap_value == LIBINPUT_CONFIG_TAP_ENABLED);
	CHECK(dwt_calls == 1 && dwt_value == LIBINPUT_CONFIG_DWT_ENABLED);
	reset();
	fingers = 0;
	CHECK(cg_configure_touchpad(&device));
	CHECK(tap_calls == 0 && dwt_calls == 0);
	reset();
	native = false;
	CHECK(cg_configure_touchpad(&device));
	CHECK(handle_calls == 0);
	reset();
	device.type = WLR_INPUT_DEVICE_KEYBOARD;
	CHECK(cg_configure_touchpad(&device));
	CHECK(handle_calls == 0);
	device.type = WLR_INPUT_DEVICE_POINTER;
	reset();
	dwt_available = 0;
	CHECK(cg_configure_touchpad(&device));
	CHECK(tap_calls == 1 && dwt_calls == 0);
	reset();
	tap_status = LIBINPUT_CONFIG_STATUS_UNSUPPORTED;
	CHECK(!cg_configure_touchpad(&device));
	CHECK(dwt_calls == 0);
	reset();
	dwt_status = LIBINPUT_CONFIG_STATUS_INVALID;
	CHECK(!cg_configure_touchpad(&device));
	puts("touchpad policy: tap enabled, typing guard enabled, unsupported devices untouched, failures reported");
	return 0;
}
