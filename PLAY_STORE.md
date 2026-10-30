# Putting OpenRoad on Google Play

OpenRoad has two versions built from the same code:

| | GitHub version | Google Play version |
| --- | --- | --- |
| Where | This repository's Releases (APK) | Google Play (app bundle) |
| Updates | Installs its own updates | Updated by Google Play |
| Check-in and crash texts | Sent by the app | Opened in the messaging app, ready to send; the group is still told automatically |
| On-time check-in alarm | Always | Asks for "Alarms and reminders" (rings a little late without it) |
| Android version it targets | 14 | 16 (what Play requires) |

Play doesn't allow apps to install their own updates, send texts unless they're the phone's texting app, or use the alarm-clock-only exact alarm, so the Play version leaves those out (see `android/app/src/play/AndroidManifest.xml`).

## 0. Turn on the project's web pages (once)

The privacy policy (and the group ride join links) are web pages in the `docs` folder, served by GitHub Pages, which is currently off.

1. On GitHub, open the repository's **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**, branch **main**, folder **/docs**, and **Save**.
3. After a minute or two, `https://guestymark-spr.github.io/OpenRoad/privacy.html` opens.

## 1. Make a developer account (once)

1. Go to <https://play.google.com/console/signup> and sign in with the Google account you want to own the app.
2. Choose **Yourself** (a personal account).
3. Pay the one-off **US$25** fee, and verify your identity and contact details as asked. This can take a few days.

## 2. Build the app bundle

1. On GitHub, open **Actions → Build for Google Play → Run workflow → Run workflow**.
2. When it finishes (about 2 minutes), open the run and download **OpenRoad-play-1.0.N** under *Artifacts*. Unzip it: inside is `OpenRoad-play-1.0.N.aab`.

It is signed with your release key (the one in the `OPENROAD_SIGNING_…` secrets), which Play uses as the **upload key**.

## 3. Create the app in the Play Console

1. **Create app**: name *OpenRoad*, language English (UK), **App**, **Free**, and tick the declarations.
2. **App signing**: let Google create and keep the app signing key (the default). Your release key stays the upload key.
   - Phones with the GitHub version can't update straight to the Play version: riders switching need to uninstall first, and should export their routes and rides as GPX before they do.

## 4. Fill in the app's details ("Set up your app")

- **Privacy policy**: `https://guestymark-spr.github.io/OpenRoad/privacy.html`
- **App access**: all features are available without signing in.
- **Ads**: no ads.
- **Content rating**: fill in the questionnaire (a navigation app, no violence, no user-to-user content other than private group chat). Expect *PEGI 3 / Everyone*.
- **Target audience**: 18 and over.
- **Data safety** (answers that match the app):
  - Data collected by the developer: **none**. Data shared: approximate and precise **location** with map, routing and weather services (to provide the app's features), **not** for advertising.
  - Is data encrypted in transit? **Yes** (HTTPS, and group ride messages are end-to-end encrypted).
  - Can users ask for their data to be deleted? Data is only on the phone; uninstalling deletes it.
- **Government app / financial features / health**: no.
- **Category**: Maps & Navigation. Add a contact email.

## 5. Permission declarations

Play will ask about these:

- **Foreground service (location)**: "Turn-by-turn navigation and recording a ride while the screen is off; the rider starts it, and a notification shows while it runs." Play may ask for a short video: record the phone starting a ride and turning the screen off.
- **Full-screen notification**: "Safety check-in and crash alarms that must wake the rider, like an alarm clock."
- **Exact alarms**: OpenRoad uses `SCHEDULE_EXACT_ALARM`, which the rider grants, for check-in times. No form needed.

## 6. Store listing

- Short description (80 characters), for example: *Free motorbike sat-nav: twisty routes, offline maps, group rides, safety check-in.*
- Full description: adapt "What it does" from the README.
- App icon 512×512 (`web/icon-512.png`), feature graphic 1024×500, and at least 2 phone screenshots.

## 7. Closed test (required for new personal accounts)

New personal accounts must run a **closed test with at least 12 testers for 14 days in a row** before the app can go public.

1. **Testing → Closed testing → Create track**, upload the `.aab`, and add testers by email (your riding group works).
2. Send them the opt-in link; they install from Play.
3. After 14 days with 12 or more testers opted in, **apply for production access** and answer the questions about the test.

## 8. Go live

**Production → Create new release**, upload the `.aab` (run the workflow again for a fresh one), and send it for review. Reviews usually take a few days.

For each update afterwards: run **Build for Google Play** again and upload the new `.aab` as a new release. The GitHub version keeps updating itself as before.

## Android Auto

The car screen works in the Play version, but Play reviews Android Auto apps separately. Turn it on under **Release → Advanced settings → Form factors → Android Auto** and expect a stricter review for driving safety. You can leave it off at first and add it later.
