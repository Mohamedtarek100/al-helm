# Android builds and future releases
## Debug APK (local testing)

Prerequisites: JDK 17 or later (this project was built with JDK 23), Android SDK Platform 35, and Android build-tools 35. The Gradle wrapper pins Gradle 8.13.

From the project root:

```powershell
npm ci
npm run build
npx cap sync android
cd android
.\gradlew.bat assembleDebug
```

The debug APK is written to:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

Debug APKs are signed with Android's automatically generated debug key. They are for development/testing, not Play Store distribution or public updates.

## Release APK (future distribution)

1. Create and safeguard a release keystore outside the repository. Back it up securely. Losing the key prevents updates to apps signed with it. Never send the keystore or passwords to Git or a third party.
2. Increment `versionCode` and `versionName` in `android/app/build.gradle` for every release.
3. Configure signing via untracked local Gradle properties or environment variables. Do not hard-code passwords in `build.gradle`; do not commit `keystore.properties` or the keystore. The Android app `.gitignore` excludes common keystore and signing-property names.
4. From the project root, run the debug build steps above, then:

```powershell
cd android
.\gradlew.bat assembleRelease
```

The unsigned/signed output location depends on the signing configuration and should be checked before distribution (usually `android/app/build/outputs/apk/release/`). Verify the final APK with `apksigner verify --verbose <path>` before sharing it.

Keep the application ID `com.alhelm.studyplanner` and use the exact same release signing key for every update distributed through the same channel.

## Updating the app
- Web-only HTML/CSS/JavaScript changes: rebuild the web bundle, sync to Android, and make a new APK for distribution. The installed APK does not automatically receive a changed `dist/` bundle.
- Native Android/plugin/manifest changes: sync, rebuild the native APK, and distribute a new version.
- App-store or sideloaded updates require the same application ID and compatible signing identity, and a higher `versionCode`.
- Capacitor does not provide OTA JavaScript updates by itself. A separate OTA service would need a security and privacy review; none is configured here.

## Current state
The Phase 1 app was built as a debug APK and its package ID and signature were verified. There is no release keystore or release signing configuration in the repository. No public release hosting is configured.
