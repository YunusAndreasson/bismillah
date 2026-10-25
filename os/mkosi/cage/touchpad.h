/* SPDX-License-Identifier: MIT
 * Cage's appliance input policy. Called for initial devices and hotplug alike.
 */
#ifndef BISMILLAH_TOUCHPAD_H
#define BISMILLAH_TOUCHPAD_H
#include <libinput.h>
#include <stdbool.h>
#include <wlr/backend/libinput.h>
#include <wlr/types/wlr_input_device.h>

static inline bool
cg_configure_touchpad(struct wlr_input_device *device)
{
	if (device->type != WLR_INPUT_DEVICE_POINTER || !wlr_input_device_is_libinput(device)) {
		return true;
	}
	struct libinput_device *input = wlr_libinput_get_device_handle(device);
	if (libinput_device_config_tap_get_finger_count(input) == 0) {
		return true;
	}
	if (libinput_device_config_tap_set_enabled(input, LIBINPUT_CONFIG_TAP_ENABLED) !=
	    LIBINPUT_CONFIG_STATUS_SUCCESS) {
		return false;
	}
	/* A writing appliance must suppress accidental touchpad input while typing.
	 * Keep the normal physical-button, click-method and scroll settings intact.
	 */
	return !libinput_device_config_dwt_is_available(input) ||
	       libinput_device_config_dwt_set_enabled(input, LIBINPUT_CONFIG_DWT_ENABLED) ==
		       LIBINPUT_CONFIG_STATUS_SUCCESS;
}
#endif
