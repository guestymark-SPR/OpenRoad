# Signing OpenRoad

`legacy-openroad-release.jks` is the key OpenRoad was first signed with. It and its password were published in this repository, so **anyone can sign with it**. It stays here only because the build needs it to vouch for the new key.

Releases are signed by the **Build OpenRoad APK** workflow with `apksigner`:

- the **new key** comes from two repository secrets, and never sits in the repo:
  - `OPENROAD_SIGNING_KEYSTORE_B64`: the PKCS#12 keystore, base64
  - `OPENROAD_SIGNING_PASSWORD`: its password (store and key)
- a **signing lineage** (old key → new key) is made on each build with `apksigner rotate`, and the APK is signed with `--lineage` and `--rotation-min-sdk-version 28`.

What that means for phones:

- **Android 9 and later**: once a phone installs a build signed this way, it trusts the new key. Updates signed with only the leaked key are refused.
- **Android 7 and 8**: these only check the old key's signature, so they stay exposed to anyone holding the leaked key. Only install OpenRoad from this repository's Releases.
- A phone that hasn't updated yet is still on the old key until it installs a new build.

If the secrets are missing, the workflow stops and publishes nothing. Keep a backup of the new keystore and password somewhere private: if they're lost, phones can't take updates without reinstalling.
