# EV Range & Isochrone Planner — App Icon Pack

Design: dark navy background with a soft center glow, teal→sky gradient (`#2DD4BF` →
`#38BDF8`), a location pin with a lightning bolt cut clean through it at the centre — reads
as "find a charger near you" — wrapped in 3 concentric range/radius rings.

## Quick start (Expo — this is almost certainly what you want)

Copy the 7 files from `expo-assets/` into your project's `assets/` folder, then point
`app.json` (or `app.config.ts`) at them:

```jsonc
{
  "expo": {
    "icon": "./assets/icon.png",
    "ios": {
      "icon": {
        "light": "./assets/icon-light.png",
        "dark": "./assets/icon.png"
      }
    },
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/adaptive-icon.png",
        "backgroundImage": "./assets/adaptive-icon-background.png",
        "monochromeImage": "./assets/android-icon-monochrome.png"
      }
    },
    "web": {
      "favicon": "./assets/favicon.png"
    },
    "splash": {
      "image": "./assets/splash-icon.png",
      "backgroundColor": "#0B0F16",
      "resizeMode": "contain"
    }
  }
}
```

Then let EAS/Expo generate every native size for you:

```
npx expo prebuild --clean
```

or if you already build with EAS, it happens automatically on the next build.

## What's in this pack

```
expo-assets/     ← drop straight into assets/ (see above) — primary deliverable
ios/             ← full native AppIcon.appiconset + Contents.json, for bare workflow / Xcode
android/         ← full native mipmap-*/ (legacy + adaptive + monochrome), for bare workflow
web/             ← standalone favicons / touch icons if you ever ship a companion web app
source/          ← 1024×1024 masters (full icon, foreground-only, background-only,
                   monochrome-only) + the original SVG, in case you want to re-export
                   anything at a custom size later
```

### iOS (bare / ejected workflow)
Drag `ios/AppIcon.appiconset` into your Xcode project's `Images.xcassets`, replacing the
existing `AppIcon.appiconset` folder. Contents.json is already wired up for every required
iPhone/iPad/App Store size.

### Android (bare / ejected workflow)
Copy the `mipmap-*` folders in `android/` into `android/app/src/main/res/`, overwriting the
existing ones. This includes:
- `ic_launcher.png` / `ic_launcher_round.png` — legacy pre-Android-8 icons
- `ic_launcher_foreground.png` / `ic_launcher_background.png` — adaptive icon layers (Android 8+)
- `ic_launcher_monochrome.png` — themed icon layer (Android 13+)
- `mipmap-anydpi-v26/ic_launcher.xml` — wires the three layers together

`android/playstore-icon-512.png` is the 512×512 icon Google Play's listing page asks for.

## Notes on the design
- The **pin+bolt glyph** stays inside Android's adaptive-icon safe zone, so it survives
  every launcher mask shape (circle, squircle, rounded square, teardrop). The outer rings
  are decorative and may get cropped slightly on circular masks — that's expected and fine.
- `icon.png` / `source/icon-master-1024.png` is a full-bleed **opaque square** with no
  pre-rounded corners — iOS and Android apply their own corner masking, so never round the
  corners yourself before submitting.
- The bolt is a genuine cutout (a mask/hole), not a white shape drawn on top — on the
  transparent-background variants (`adaptive-icon.png`, `android-icon-monochrome.png`,
  `splash-icon.png`) it shows whatever sits behind the layer through the hole, matching the
  raster source in `source/icon-master.svg`.
