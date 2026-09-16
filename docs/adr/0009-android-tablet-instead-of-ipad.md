# ADR-0009: Android tablet instead of iPad

Status: accepted. Date: 2026-09-16. Supersedes the "iPad first" platform
choice in spec section 2 for the pilot; the React Native stack is unchanged.

## Context

Spec section 2 names React Native "iPad first". The build machine is Linux:
there is no macOS toolchain, so the iOS project can never be compiled, signed
or installed from it. An Android tablet with NFC can be built for and
installed to from Linux over `adb`.

## Decision

Target an Android tablet. Delete the iOS project (`ios/`, Podfile, CocoaPods
Gemfile) and iOS scripts. The JavaScript layer, the data model, the checklist
seeds, the sync engine and all inspection logic are unchanged. What changed
natively:

- **Manifest**: `CAMERA`, `NFC`, `INTERNET` permissions; `android.hardware.nfc`
  and `android.hardware.camera` required features; `MainActivity` is
  `singleTask` so a tag intent while foregrounded reuses the activity; NFC
  intent filters (`NDEF_DISCOVERED` for `text/plain`, `TECH_DISCOVERED` with a
  tech list of Ndef / NfcA / MifareUltralight) so a tag scan can launch the
  app. No `WRITE_EXTERNAL_STORAGE`: photos stay in app-private storage.
- **Gradle**: `minSdkVersion` 26; `targetSdkVersion` stays at the React Native
  0.87 default (36). Release signing reads a keystore path and passwords from
  Gradle properties or environment variables; the keystore lives outside the
  repository and is never committed.
- **Runtime camera permission** (`src/services/permissions.ts`): requested
  lazily before the first photo of a walkthrough, never at launch. If refused,
  the walkthrough blocks with a clear message and the inspection stays
  `in_progress`; nothing is written. Spec 4.2's "photo on every item" is what
  makes blocking the only correct behaviour.
- **NFC lifecycle** (`src/services/nfc.ts`): iOS presented a scan sheet on
  demand; Android delivers tag intents to the foreground activity. The home
  screen now registers a tag listener on focus and releases it on blur, the
  launch intent is read on cold start and routed straight to the machine
  record, and repeated intents for one physical tap are debounced (same tag id
  within 2.5 s reports once). NFC switched off in system settings is detected
  and the screen falls back to serial search with a message and a shortcut to
  settings. Tag resolution is unchanged: the UID resolves to
  `machines.nfc_tag_id`, unknown tags offer "link by serial" or the wizard.
- **Tag writing** in wizard step 9: the tag must be in range at the moment of
  the write, so the wizard has a "hold the tag against the tablet" state with
  cancel, and a retry / skip prompt after the machine is created. The tag UID
  is read at step 9; the NDEF text record `uptime:<Unique Machine ID>` is
  written right after creation.
- **Storage**: one constant, `APP_PRIVATE_DIR`, derived from
  `RNFS.DocumentDirectoryPath`, which is `Context.getFilesDir()` on Android.
  The free-space guard reads `StatFs.getFreeBytes()` on the internal data
  partition (bytes), so the 2 GB / 500 MB thresholds apply unchanged; a
  non-numeric reading blocks rather than silently disabling the guard.
- **Signature capture**: `react-native-signature-canvas` 5.x supports Android
  (WebView based); no swap, no contract change (PNG, hashed and stored like a
  photo).
- **Touch targets**: tier and pass/fail controls are at least 96 dp tall for
  gloved use; HIGH stays the largest and loudest.

## What did not change

The Rails API, the schema, the checklist seeds, the sync order and the
delete-only-after-confirmed-hash rule, the report, and every rule in spec
sections 4 to 10. The definition of done (section 12) is unchanged, on an
Android tablet.

## Consequences

- The tablet must have an NFC reader; many Android tablets omit it. Hardware
  purchasing must check for NFC explicitly (see the root README).
- NFC tags in use are NTAG213/215/216 (ISO 14443-A, NfcA + Ndef), which Android
  reads reliably; buy the same type again.
- The Android SDK and a JDK 17 are needed on the build host. On the hosted
  build machine used for this migration, downloads from `dl.google.com` and
  the JDK provisioning service are blocked by the network policy, so the debug
  APK was not compiled there; see `app/README.md` for the setup on a machine
  with normal network access.
