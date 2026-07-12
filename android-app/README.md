# Fleebee Management Android App

This Android project is the first MVP for the fleet SMS workflow.

## Current MVP
- Dashboard with summary cards
- Biker list with sample data
- Biker detail screen
- Compose and send SMS screen
- Test routing to `0788690545`

## Build
From this folder:

```bash
./gradlew -g /tmp/gradle-home assembleDebug
```

The generated debug APK will be under:

```text
app/build/outputs/apk/debug/app-debug.apk
```

## Notes
- The app currently uses sample biker data from `FleetRepository.kt`
- SMS sending is in test mode and routes through `0788690545`
- Add/edit biker forms and backend sync are the next phase
- Long-term, this app is expected to run as an always-on home phone gateway for remote web requests
- Normal home use should point the app directly at the home computer on the LAN, for example `http://192.168.1.50:4100`
- `adb reverse tcp:4100 tcp:4100` is only for temporary USB testing

## Gateway config

The Android gateway no longer hardcodes the backend URL in source. Build-time values now come from Gradle properties or environment variables.

Recommended values:

```text
gatewayBackendBaseUrl=http://192.168.1.50:4100
gatewayDeviceId=android-home-gateway
gatewayFixedLocation=Home gateway
gatewayNetworkLabel=Wi-Fi / mobile fallback
```

You can place those values in a local `gradle.properties` file based on `gradle.properties.example`, or export matching environment variables:

- `GATEWAY_BACKEND_BASE_URL`
- `GATEWAY_DEVICE_ID`
- `GATEWAY_FIXED_LOCATION`
- `GATEWAY_NETWORK_LABEL`

For production, set `gatewayBackendBaseUrl` or `GATEWAY_BACKEND_BASE_URL` to the real public Fleebee app URL, for example `https://app.example.com`.

## Stable Home Setup

For the normal always-on home deployment:

1. Keep the backend computer on a stable LAN IP such as `192.168.1.50`.
2. Put the Android phone on the same home Wi-Fi.
3. Set the Fleebee app to `Unrestricted` battery on the phone and keep it out of Samsung sleeping-app lists.
4. Build the app with `gatewayBackendBaseUrl=http://192.168.1.50:4100`.

On first launch, the app now also asks Android for battery-optimization exemption so the gateway can keep heartbeating while the screen is off.

The phone does not need a static IP for this architecture because it polls the backend. The backend computer is the machine that needs the stable address.
