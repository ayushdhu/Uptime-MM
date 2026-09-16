# Uptime tablet app (Android)

React Native (bare, TypeScript) app for the technician walkthrough, targeting an
Android tablet with NFC. Offline first: every action writes to SQLite on the
device and a sync queue pushes to the Rails API when a connection is available.
See ADR-0009 for the move from iPad to Android.

## Hardware

- A 10 inch class Android tablet (Android 8.0 / API 26 or newer) **with an NFC
  reader**. Many tablets omit NFC; confirm it before buying.
- NFC tags: **NTAG213 / NTAG215 / NTAG216** (ISO 14443-A). Android reads these
  reliably; the wizard writes a small NDEF text record on them. Buy the same
  type again.

## Linux build setup

```sh
# JDK 17 (React Native's Gradle plugin requires 17)
sudo apt install openjdk-17-jdk
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64

# Android SDK command line tools -> https://developer.android.com/studio#command-line-tools-only
export ANDROID_HOME=$HOME/Android/Sdk
mkdir -p $ANDROID_HOME/cmdline-tools && unzip commandlinetools-linux-*.zip -d $ANDROID_HOME/cmdline-tools
mv $ANDROID_HOME/cmdline-tools/cmdline-tools $ANDROID_HOME/cmdline-tools/latest
export PATH=$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH
sdkmanager --licenses
sdkmanager "platform-tools" "platforms;android-37" "build-tools;37.0.0" "ndk;27.1.12297006" "cmake;3.22.1"
```

Put `ANDROID_HOME`, `JAVA_HOME` and the `PATH` lines in your shell profile.
The versions match `android/build.gradle` (`compileSdkVersion 37`,
`buildToolsVersion 37.0.0`, `ndkVersion 27.1.12297006`, `minSdkVersion 26`,
`targetSdkVersion 36`); do not upgrade React Native (0.87.1) as part of a
build fix.

## Run on the tablet

1. On the tablet: Settings → About → tap "Build number" seven times, then
   Settings → Developer options → enable **USB debugging**. Turn **NFC** on.
2. Connect over USB, accept the fingerprint prompt, and check `adb devices`
   lists it as `device`.
3. From `app/`:

```sh
npm install
npm test && npm run typecheck
npx react-native run-android        # debug build, installs and starts Metro
```

Or build the APK without Metro attached and install it by hand:

```sh
npm run android:apk                  # android/app/build/outputs/apk/debug/app-debug.apk
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

For a physical tablet talking to a laptop's Rails server on the same network,
set the server URL on the login screen to `http://<laptop-ip>:3000` and run
Rails with `bin/rails server -b 0.0.0.0`. On the Android emulator use
`http://10.0.2.2:3000` (the emulator's alias for the host machine; `localhost`
is the emulator itself). Dev-storage upload URLs are resolved against the
server URL you entered, so `API_BASE_URL` is not needed. Debug builds allow
cleartext HTTP; release builds do not.

Sync never fails silently: the status bar shows how many items are failing and
the latest reason, the Sync screen lists every queued row with its attempts,
last failure and a per-row retry, and failures retry automatically with
backoff. An inspection that is locked on the tablet but not yet accepted by
the server says so on the report, inspection and machine screens, with the
outstanding list.

On an emulator without NFC, debug builds show a "simulate tag" field on the
home screen that runs the same tag resolution path.

## Release signing

The release keystore lives **outside the repository** at
`~/.uptime/uptime-release.keystore` (alias `uptime`), with its password in
`~/.uptime/keystore-password.txt`. Never commit either. Gradle picks it up from
`~/.gradle/gradle.properties`:

```
UPTIME_RELEASE_STORE_FILE=/home/<you>/.uptime/uptime-release.keystore
UPTIME_RELEASE_STORE_PASSWORD=<password>
UPTIME_RELEASE_KEY_ALIAS=uptime
UPTIME_RELEASE_KEY_PASSWORD=<password>
```

or the same names as environment variables. `npm run android:release` then
produces a signed `app-release.apk`; without these properties it falls back to
the debug key (installable, not distributable). To create a fresh keystore:

```sh
keytool -genkeypair -v -keystore ~/.uptime/uptime-release.keystore -alias uptime \
  -keyalg RSA -keysize 2048 -validity 10000
```

## Permissions and NFC behaviour

- **Camera** is requested at runtime right before the first photo of a
  walkthrough. If refused, the walkthrough blocks with a message and an "Open
  app settings" button; the inspection stays in progress. It cannot continue
  without photos by design (spec 4.2).
- **NFC** needs no runtime prompt. The home screen listens for tags while it
  is focused (foreground dispatch) and releases the listener on blur. A tag
  scan with the app closed launches it and opens the machine. Repeated intents
  for one tap are debounced. If NFC is switched off, the screen says so and
  falls back to serial / customer search with a shortcut to settings.
- **Tag writing** (wizard step 9) needs the tag held flat against the back of
  the tablet until the write completes; the wizard shows a hold state with
  cancel, and retry / skip on failure.

## Layout

- `src/domain/` — types mirroring the server schema and the pure rules:
  conditional item filtering, template selection, the tire refill and battery
  auto-High rules, round up, completion and lock checks, carry-forward rechecks.
- `src/db/` — SQLite schema (mirrors the inspection chain plus `sync_queue`) and
  repositories. Locked inspections refuse writes at the repository level.
- `src/sync/` — queue ordering (parent before child) and the `SyncEngine`:
  pull reference data, then push inspections → items → photos (presign, PUT,
  confirm with SHA-256, only then delete the local file) → signatures →
  High severity events → lock → notes. Idempotent on `client_generated_id`.
  Local inspections purge 30 days after confirmed sync.
- `src/services/` — camera capture into app-private storage (`filesDir`) with
  SHA-256 at capture, runtime permissions, NFC foreground dispatch / launch
  intent / tag write, signature PNGs, storage guard (warn < 2 GB, block
  < 500 MB), the inspection workflow.
- `src/screens/` — login, home (NFC listener + search), unregistered tag,
  setup wizard, machine, walkthrough, High severity flow, checkout, report,
  inspection detail with append-only notes, photo browser, sync status.

## Tests

```sh
npm test            # jest: checklist rules, sync ordering, report, sync engine on in-memory SQLite,
                    #       NFC debounce / foreground lifecycle, camera-permission-denied path
npm run typecheck
npm run lint
```

## Native modules

`react-native-nfc-manager`, `react-native-image-picker` (camera, `saveToPhotos:
false`), `@op-engineering/op-sqlite`, `react-native-fs` (private storage,
`hash(path, 'sha256')`, `getFSInfo`), `react-native-signature-canvas` +
`react-native-webview`, `react-native-pdf` + `react-native-blob-util` (the
server PDF is fetched with the bearer token and rendered in-app; Android's
WebView cannot display PDFs), `@react-native-community/netinfo`,
`react-native-device-info`.
