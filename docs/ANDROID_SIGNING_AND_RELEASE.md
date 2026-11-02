# Android signing & release procedure — 4uLife

> Read `PROJECT_MASTER_CONTEXT.md` first. This document is the operational
> authority for **signing** and **releasing**. Do not deviate; do not invent a
> new identity.

---

## 1. Permanent signing identity (verified)

| Item | Verified value |
|---|---|
| Application ID | `com.alhelm.studyplanner` |
| Keystore path | `C:/Users/user/.al-helm-keystore/alhelm-release.jks` (outside the repo) |
| Properties file | `C:/Users/user/.al-helm-keystore/keystore.properties` → copied/read by `android/app/build.gradle` |
| Alias | as configured in `keystore.properties` (do not publish) |
| Certificate SHA-256 | `C1:3F:BB:C8:…:40:44` — **identical for 1.5.7, 1.5.8 and 1.5.9** |
| Verified against | the published `v1.5.7` APK (`keytool -printcert -jarfile`) |

Verify at any time:

```powershell
& "C:\Program Files\Java\jdk-23\bin\keytool.exe" -printcert -jarfile android\app\build\outputs\apk\release\app-release.apk
```

The SHA-256 **must** equal the fingerprint of the previously published APK. If it
does not, **stop** — the build is not an upgrade, it is a new identity.

### Owner obligations

1. Keep `alhelm-release.jks` and `keystore.properties` in two secure, offline
   locations (password manager + encrypted backup).
2. **Verify the backup** by restoring it somewhere else and running
   `keytool -list -v -keystore <backup> -alias <alias>`.
3. Losing this key permanently breaks upgrades for every installed customer.
   No replacement is possible.

**Never commit** the keystore, `keystore.properties`, passwords, or any
`google-services.json`. All are covered by `.gitignore`.

## 2. Local configuration templates

```powershell
Copy-Item android\keystore.properties.example android\keystore.properties   # then fill in
# Firebase (owner must obtain it from the Firebase console):
#   android/app/google-services.json   (project ulife-e4b04, package com.alhelm.studyplanner)
```

A **missing** `keystore.properties` makes an unsigned release build fail loudly.
It never silently falls back to the debug key — if you see a debug-signed release
APK, stop and fix the configuration.

CI (GitHub Secrets, names only — values never in the repo):

| Secret | Purpose |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | base64 of `alhelm-release.jks` |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password |
| `ANDROID_KEY_ALIAS` | key alias |
| `ANDROID_KEY_PASSWORD` | key password |

## 3. Release procedure (every release)

1. Read `PROJECT_MASTER_CONTEXT.md`.
2. Check the latest published release: `gh release list --repo Mohamedtarek100/al-helm-app`.
3. `git status --short` and `git branch --show-current` — clean tree, feature branch.
4. Choose the bump: patch for fixes, minor for features, major for breaking change.
5. Bump `versionCode` (+1) and `versionName` in `android/app/build.gradle`; update
   `package.json` `version`.
6. Run every gate in `AGENTS.md` §3.
7. `npm run build` then `npx cap sync android`.
8. `cd android; ./gradlew assembleRelease --console=plain`.
9. Verify identity:
   ```powershell
   keytool -printcert -jarfile android\app\build\outputs\apk\release\app-release.apk
   Select-String android\app\build\intermediates\merged_manifests\release\AndroidManifest.xml -Pattern 'versionCode|versionName|package='
   ```
10. Compare the certificate to the previous release's APK (download it, `printcert`).
    Different fingerprint ⇒ different app. Stop.
11. `Get-FileHash <apk> -Algorithm SHA256`.
12. Publish artifacts to `Mohamedtarek100/al-helm-app` (`main`): `assets/` web
    bundle, `downloads/4ulife-<ver>-release.apk` + `.sha256`,
    `ota/<ver>/bundle.zip` + `.sha256`, and both `ota/*.json` manifests.
13. `gh release create v<ver> --repo Mohamedtarek100/al-helm-app --target main --notes-file <notes>`,
    then `gh release upload` the APK.
14. **Re-download** the published APK and confirm the SHA-256 matches (§4).
15. Open the live site and confirm 0 console errors / 0 failed requests.
16. Append the release to `PROJECT_MASTER_CONTEXT.md` §7 and to `CHANGELOG.md`.

### Never

- Overwrite or delete a previous release's assets.
- Publish a debug APK.
- Publish with a different certificate.
- Publish when a security or data-integrity gate is unresolved.

## 4. Post-publication verification

```powershell
$h = (Get-FileHash downloads\4ulife-<ver>-release.apk -Algorithm SHA256).Hash.ToLower()
# must equal the sha256 in ota/apk-manifest.json
```

Also confirm the live `ota/apk-manifest.json` reports the new `version` and
`versionCode`, and that older release assets still exist.

## 5. Upgrade compatibility

An upgrade requires: same `applicationId`, same signing certificate, and a
**higher** `versionCode`. All three are checked above. Do not publish if any is
false — existing customers would have to uninstall, losing local data.