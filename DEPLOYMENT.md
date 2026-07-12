# Fleebee Deployment

## Current Home Computer Target

As of `2026-07-05`, the current home-computer deployment target is:

- Hostname: `richard-Vostro-230`
- LAN user/host: `richard@192.168.1.50`
- Fleebee app URL on the local network: `http://192.168.1.50:4100`
- Local SSH command on the same network: `ssh richard@192.168.1.50`

## Current SSH Listener

The machine is currently listening for SSH on standard port `22`, not `2222`.

Confirmed listeners:

- `0.0.0.0:22`
- `[::]:22`

That means the local-network SSH command should be:

```bash
ssh richard@192.168.1.50
```

## Public Access Notes

### Current public IPv4 setup

The currently working public SSH path is:

- Public IPv4: `196.12.139.27`
- Public SSH command: `ssh -p 2222 richard@196.12.139.27`
- Router forward: `196.12.139.27:2222 -> 192.168.1.50:22 -> richard-Vostro-230`

### Current test result for active public IPv4 path

On `2026-07-05`, testing from the current machine succeeded and reached the home computer:

```text
remote-ok
host=richard-Vostro-230
ips=192.168.1.50 2c0f:fe30:4bf9:0:ac7e:56d5:34a1:f9b1 2c0f:fe30:4bf9:0:7eb7:5064:c0e4:c654
```

So the current public IPv4 SSH path is **confirmed working**.

### Older IPv4 setup

The old public IPv4 notes were:

- Public IPv4: `196.216.80.163`
- Public SSH command: `ssh -p 2222 richard@196.216.80.163`
- Expected router forward: `196.216.80.163:2222 -> 192.168.1.50:22`

### Current test result for old IPv4 path

On `2026-07-05`, testing from the current machine gave:

```text
ssh: connect to host 196.216.80.163 port 2222: Connection timed out
```

So the old public IPv4 SSH path is **not currently confirmed working**.

## IPv6 Notes

### Browser-reported public IPv6

The IPv6 reported in the browser was:

- `2c0f:fe30:4bf9:0:54ba:3d72:a0a1:90c0`

### Actual IPv6 addresses currently on the home computer

When checked directly on `richard-Vostro-230` on `2026-07-05`, the machine reported:

- `2c0f:fe30:4bf9:0:ac7e:56d5:34a1:f9b1` (temporary dynamic)
- `2c0f:fe30:4bf9:0:7eb7:5064:c0e4:c654` (global dynamic)

Important note:

- The browser-reported IPv6 `2c0f:fe30:4bf9:0:54ba:3d72:a0a1:90c0` did **not** match the actual IPv6 addresses currently assigned to the home computer when checked over SSH.

### Current test result for direct IPv6 SSH

Testing the machine's currently reported global IPv6 gave:

```text
ssh: connect to host 2c0f:fe30:4bf9:0:7eb7:5064:c0e4:c654 port 22: No route to host
```

So IPv6 SSH is also **not currently confirmed working** from this machine.

## What We Can Safely Use Right Now

For current Fleebee setup and deployment work, use:

- LAN SSH: `ssh richard@192.168.1.50`
- Public SSH: `ssh -p 2222 richard@196.12.139.27`
- LAN app URL: `http://192.168.1.50:4100`

These are the currently confirmed working connection details.

## Best Real External Test

To confirm access from outside the home network, the cleanest test is:

1. Turn off Wi-Fi on another device.
2. Use mobile data or another internet connection.
3. Try the public SSH path from that outside network.
4. If SSH works, then test the Fleebee app URL from the same outside network.

Suggested checks:

```bash
ssh -p 2222 richard@196.12.139.27
```

or, if IPv6 is intentionally opened and confirmed later:

```bash
ssh -6 -l richard 2c0f:fe30:4bf9:0:7eb7:5064:c0e4:c654
```

## Fleebee Runtime Values

For the current local deployment shape, the key values remain:

- `PORT=4100`
- `PUBLIC_APP_URL=http://192.168.1.50:4100`
- `DATABASE_URL=file:/home/richard/fleebee/shared/fleebee.db`
- `SMS_SEND_PASSWORD=1234`
- `SMS_GATEWAY_TARGET_NUMBER=0788690545`

Important note:

- Public SSH forwarding is confirmed.
- Public HTTP forwarding for Fleebee on port `4100` is **not** yet confirmed by this document.
