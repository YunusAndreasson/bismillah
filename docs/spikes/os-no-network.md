# OS-0 spike: no network

**Question** (os/PLAN.md, OS-0):
- With virtio-net attached, does the image show only `lo`?
- Does the release image send zero packets on any NIC, including PCI and USB NICs hot-plugged while it runs, captured outside the guest?
- Are the image's module and firmware lists free of network, Wi-Fi, Bluetooth, NFC, CAN and USB-net entries?
- Does the shipped kernel's config build in (`=y`) any network-device driver?

**Verdict: go.** All four hold in the VM (Secure Boot on, 2026-10-21):
- The stripped image shows only `lo`, with a virtio NIC at boot and a PCIe NIC and a USB NIC hot-plugged later. All three stay without a driver.
- QEMU recorded zero frames on all three NICs.
- No network module is left except `rfkill`, and there is no firmware at all.
- Debian's 6.12 kernel builds no physical network driver in.

Leaving modules out is enough on the signed Debian kernel. Under Secure Boot the kernel is locked down, so it loads only Debian-signed modules, and only from the verity root.

## Setup

- **`nonet` image profile** (`os/spikes/boot/mkosi.profiles/nonet/`): mkosi's `KernelModules=` keeps every module directory except `net/`, then drops the network driver trees: `drivers/net`, `bluetooth`, `nfc`, `infiniband`, `isdn`, `atm`, `staging`, `vhost`, `firewire/net`, `usb/gadget`, `ssb`, `bcma` and `hv`.
- **The first build leaked.** mkosi also installs the dependencies of kept modules, and that brought back five real Ethernet drivers: Chelsio `cxgb3`/`cxgb4`, QLogic `qed` and Broadcom `cnic`. They came in through iSCSI/FCoE offload, Chelsio crypto and the iSCSI target. It also brought back PPP for a 3G PC Card (`ipwireless`), the ATM stack for USB ADSL modems, and the network filesystems (NFS, SMB, AFS, Ceph, 9p) with sunrpc, rxrpc and TLS. The profile now excludes those users too. The rebuilt image keeps 3085 of 4230 modules (62 MB).
- **`netcheck` profile:** a report on the serial console every 3 s for 3 minutes. It lists the interfaces, the PCI, USB and virtio devices without a driver, and the loaded network modules.
- **Run:** `os/spikes/boot/nonet-test.sh <vars> <out> <image>`.
  - The VM has a virtio NIC from boot. The test hot-plugs an `e1000e` on a PCIe root port, then a `usb-net`.
  - Each NIC is QEMU user-mode with `restrict=on`, so nothing could reach the host's network.
  - QEMU's `filter-dump` writes every frame each NIC sends to a pcap file, outside the guest.
- **Capture check:** `nonet-test.sh --pxe` boots the firmware alone with a NIC. Its network boot's DHCP shows up in the capture as 11 frames.
- **Control:** the same test on the image with Debian's stock modules.

Evidence: `os/spikes/boot/results/no-network.txt`.

## Results

| Check | Stock modules (control) | `nonet` |
|---|---|---|
| Interfaces at boot (virtio NIC attached) | `enp0s4 lo` | `lo`; virtio device 1 (net) has no driver |
| After hot-plugging `e1000e` (PCIe) | `enp1s0` added | `lo`; `8086:10d3` has no driver |
| After hot-plugging `usb-net` | `enp0s1u2i1` added (`cdc_subset`) | `lo`; both USB interfaces (classes 02, 0a) have no driver |
| Frames sent (virtio / e1000e / usb-net) | 0 / 0 / 0 | 0 / 0 / 0 |
| Network modules loaded | `cfg80211 rfkill virtio_net net_failover nfnetlink` | `rfkill` |
| Network modules in the image | all of Debian's | `net/rfkill` only |
| Firmware files | 0 | 0 |

The control also sends nothing, because nothing in the image brings a link up. So zero frames isn't the guarantee. The guarantee is that no NIC gets a driver, so there is no interface to send from. The capture would have caught a leak if one existed.

**Kernel config** (`config-6.12.113+deb13-amd64` from the package mkosi installed): `modules.builtin` lists 191 built-in modules. Only four are network-adjacent:
- `drivers/net/netkit`: a virtual device that only root can create, and only with BPF programs attached. It has no hardware.
- `drivers/ptp/ptp`: the precision clock framework. It drives no NIC.
- `drivers/xen/xenbus` and `xenbus_probe_frontend`: the Xen bus. The Xen NIC (`xen-netfront`) is a module and is excluded.

The `=y` network options are protocol stacks and menu switches, such as `CONFIG_INET`, `CONFIG_IPV6`, `CONFIG_PACKET`, `CONFIG_NET_VENDOR_*` and `CONFIG_WLAN_VENDOR_*`. None of them drive hardware. The stack stays, and without a device it has nothing to send through.

## Findings for OS-1

1. **Exclude network modules, then check the result.** mkosi's dependency resolution quietly brings excluded drivers back. OS-1's build should fail if any module under `kernel/net/` (except `rfkill`) or `kernel/drivers/net/` is in the image. That check is a few lines in `os:build`.
2. **Also exclude** `drivers/usb/serial/option` and `drivers/usb/class/cdc-wdm`, the serial and management ports of USB 3G/4G modems. They can't carry IP without PPP or a modem network driver, both of which are gone, but they have no use here.
3. **`rfkill` stays.** Laptop platform drivers (Dell, ThinkPad, ASUS, HP and others) depend on it for hotkeys and kill switches. It's a switch, not a network device.
4. **systemd-networkd ships inside Debian 13's `systemd` package** and is enabled in the image: `networkd.service`, its socket, `wait-online` and `persistent-storage`, which fails on the read-only root. With no interfaces it does nothing. OS-1 masks it as planned, and OS-4's allowlist drops its files.
5. **mkosi rebuilds the module index before it removes modules.** `modules.dep` still lists 4230 modules for 3085 files, including Bluetooth and NFC. That's harmless, because a missing file can't load. OS-1 should run `depmod` after stripping, so `modprobe` has no dead entries.

## Not covered here

- Real Wi-Fi and Bluetooth hardware: QEMU can't emulate either. Their drivers and firmware aren't in the image, and the kernel builds none in, so the Dell's Wi-Fi card should stay driverless. Check it in OS-1 on the Dell with `ls /sys/class/net`, and look for its PCI device without a driver.
- The firmware's own network stack before boot (PXE, HTTP boot). That's a firmware setting outside the stick.
