# ViaLive Broadcaster (Android)

React Native / Expo app that bridges Android screen sharing to a Live Pulse session via WHIP/WebRTC.

## What it does

Since Android browsers cannot use `getDisplayMedia`, this companion app captures screen+audio and streams it to the MediaMTX WHIP endpoint. The web session then receives the stream via the Stream Bridge.

## Deep linking

The app registers the `vialive://broadcast` URL scheme. Opening a link like:

```
vialive://broadcast?server=https%3A%2F%2Fvialive.example.com%3A8889&code=ABCD
```

…pre-fills the server URL and session code so the teacher just taps **Start Broadcast**.

The web app Android modal generates this link automatically — no manual copying needed.

## Build the APK

### Prerequisites
- Node 18+ and npm
- Expo CLI: `npm install -g eas-cli`
- EAS account: `eas login`

### Quick build (cloud, produces APK directly)

```bash
cd mobile
npm install
eas build --platform android --profile apk
```

When done, download the `.apk` from the EAS dashboard and place it at:

```
frontend/downloads/vialive-broadcaster.apk
```

Then rebuild the frontend Docker image — it will be served at `/vialive-broadcaster.apk`.

### Local build (requires Android SDK)

```bash
cd mobile
npm install
npx expo run:android --variant release
```

The APK will be at `android/app/build/outputs/apk/release/app-release.apk`.

## Development

```bash
cd mobile
npm install
npm run android   # requires connected Android device or emulator
```
