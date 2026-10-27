# aibetbuilder iOS + Android apps (Capacitor)

Preview only. The native apps wrap the same web build (`dist/`). There are no in-app purchases in v1: subscriptions stay on the web through Stripe, and the app doesn't link out to buy.

## What Kevin must provide (all under Kaygosports, LLC)
1. **Apple Developer Program** account for the LLC ($99/yr). This needs a D-U-N-S number for the LLC.
2. **Google Play Console** account for the LLC ($25 one-time). Organization accounts need a D-U-N-S number.
3. **Bundle / application ID**: default `io.aibetbuilder.app` (in `capacitor.config.json`). Confirm it or pick another before the first upload, because it can't change later.
4. **Firebase project** (free) with an iOS app and an Android app using that ID.
   - Download `google-services.json` into `android/app/` and `GoogleService-Info.plist` into `ios/App/App/`. Both are gitignored, so keep them local.
5. **APNs auth key (.p8)** from Apple Developer → Keys, uploaded in Firebase → Project settings → Cloud Messaging. Kevin uploads it; it is never stored in the repo.
6. **Server env on Vercel** (Kevin sets these; there are no values in code):
   - `PUSH_NOTIFICATIONS_ENABLED=1` turns sending on. It defaults to off.
   - `PUSH_NOTIFY_SECRET` is a random string shared with combo-worker.
   - `FCM_PROJECT_ID` and `FCM_SERVICE_ACCOUNT_JSON` come from a Firebase service account with the Cloud Messaging role.
7. A Mac with Xcode (iOS) and Android Studio (Android) to build, sign and upload.
8. **Store review items:** privacy policy URL (`/privacy`), support URL, 17+ / gambling age rating, screenshots, and the real-money gambling declarations. The app only shows tools and estimates and takes no bets. Apple may still want the LLC's info and may limit the app by region.

## One-time setup
```
npm install
npm run cap:assets      # icons + splash from resources/ (black/gold)
npm run cap:sync
npx cap open ios        # Xcode: Signing & Capabilities → add Push Notifications + Background Modes (Remote notifications)
npx cap open android
```

## Database
Run `supabase/migrations/20261027060000_push_tokens.sql` in the Supabase SQL editor. It creates `push_tokens` with row-level security so each user can only see and change their own tokens.

## Alerts (v1)
| kind | when | who sends it |
|---|---|---|
| `lock_filled` | a Combo Lock fills | combo-worker → `POST /api/push-notify` (follow-up PR in combo-worker) |
| `outbid` | the server auto check finds `auto_check_result = outbid` | combo-worker auto check (#294) → `/api/push-notify` |
| `ev_boost` | the EV parlay worker finds a new +EV boost pick | `worker/ev-parlay-alerts.js` → `/api/push-notify` (follow-up) |

`lib/push-alerts.js` has the message copy (American odds, no "guaranteed" or "risk-free" wording) and the FCM HTTP v1 sender. It does nothing unless the flag is on.

## Notes
- The app registers for push once a user signs in (`src/native/push.js`). On the web this does nothing.
- After the landing PR (#520) merges, the native build should open straight into `/app` rather than the marketing landing. That's a one-line check on `window.Capacitor` in `pickTopLevelPage`.
