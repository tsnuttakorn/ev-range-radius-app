# Changelog

All notable changes to the **ev-range-radius-app** will be documented in this file.

## [1.0.0] - 2026-08-13

### Changed
- **DC Charging Strictly Preferred Over AC**: The trip planner now treats DC as a hard preference at every hop — including for the backup/alternative route — instead of a soft scoring penalty. If any DC charger is reachable, AC options are dropped from consideration entirely; a farther DC charger always wins over a closer AC one. AC is only ever picked when no DC charger is reachable within safe range at all.

### Fixed
- **Directions Button Text Overflow on Backup Stop**: The "Directions from {suggested stop name}" button label could overflow/wrap awkwardly when the suggested stop's name was long. Shortened to a fixed "Directions from Suggested Stop" label, with `numberOfLines`/ellipsis as a safety net regardless of name length.
- **Backup Stop Directions Started From GPS Instead of the Suggested Stop**: The "Get Directions in Google Maps" button on a backup/alternative charging stop's detail card omitted an origin, so Google Maps defaulted to the device's current GPS location — not useful for comparing "how far is this backup stop from the stop I'm actually planning to use." It now detects when the card is showing a backup stop and sets the primary/suggested stop as the directions origin instead, with the button label changing to "Directions from {suggested stop name}" to make that explicit.

### Added
- **Compare Backup Charging Station on Map**: The backup/alternative route card in the trip itinerary now has a "View on map to compare" toggle. Tapping it pans the map to the backup station's location and opens its detail card, so it can be visually compared against the primary pick; tapping it again ("Back to trip") deselects it and pans back to the origin. The backup stop now also gets its own hollow "B" badge marker on the map (previously it blended in as a plain, unlabeled pin), and its route line switches from a muted dashed line to a solid brand-colored one while actively being compared, so both the suggested (primary) stop and the direction to the backup stop are clearly visible side by side.

### Changed
- **Unified In-Place Minimize Across All Layouts**: `RangeControlPanel`'s minimize/expand now behaves the same in the compact/vertical (mobile) layout as it already did in the wide/split layout — minimizing no longer slides the whole panel down; it just hides the sliders/climate-toggle block in place, leaving the car name + range summary always visible. Removed the now-unused swipe-to-minimize drag handle, `PanResponder`, and slide animation, since the panel itself never moves in either layout anymore.

### Fixed
- **Custom Start Point Reverted to GPS on Selection**: Picking a new "FROM" location in the trip planner called `mapRef.recenter()` to pan the map, but `recenter()` re-fetches the device's live GPS position and overwrites `userLocation` with it — silently snapping the just-picked custom start point back to the actual GPS location a moment later, so the trip was calculated from the old origin instead. Added a GPS-free `panTo(coords)` map method for this case; `recenter()` remains only for the explicit "Current Location" action.
- **Arrival Battery % Shown on Direct Routes**: `TripItinerary`'s "route safe, no charging needed" summary now shows the estimated arrival battery percentage (`plan.finalArrivalSoC`), matching the "Arrive with ~X% battery remaining" line already shown when charging stops are required. Previously this figure was computed by `TripPlannerService` but only surfaced in the UI when at least one charging stop was needed.

### Changed
- **In-Place Minimize for Wide/Split Layout**: `RangeControlPanel`'s minimize/expand toggle now behaves differently per layout. Compact (mobile) is unchanged — minimizing slides the whole panel down to peek from the bottom edge. In the wide/split layout, minimizing no longer shifts the panel's position at all; it just hides the sliders/climate-toggle block in place, leaving the car name and range summary (safe range, usable energy, max buffer, time budget) always visible in the right-hand column. The drag handle (a slide affordance) is hidden in wide mode since nothing slides there; tapping the summary card still toggles it.

### Fixed
- **Restored Live Location Search, Routing & Station Data**: Reverted the "100% offline" stubs added earlier today (`searchLocations`, `fetchRealRoute`, `fetchIsochronePolygon`, `getAllRealStations`) that unconditionally returned empty/null, which broke destination search (always "No matches found") and forced every trip route and range polygon onto the straight-line/simulated fallback instead of real road/OSM data. Real network calls (Nominatim, OSRM, OpenRouteService, OpenChargeMap/Overpass) are back, each still with its existing timeout + offline fallback if the request fails.

### Added
- **iOS Light/Dark App Icon**: Split the app icon into a light variant (`assets/icon-light.png`, generated by compositing the existing transparent glyph onto the app's light-theme background color) alongside the existing dark one (`assets/icon.png`), wired up via `ios.icon.light` / `ios.icon.dark` in `app.json`. On iOS 18+ (native build required — not visible in Expo Go), the Home Screen icon now switches automatically with the device's system Light/Dark Mode. Android has no equivalent OS-level icon-swap mechanism; it keeps its existing single adaptive icon with a monochrome layer for Android 13+ themed-icon tinting.
- **Dynamic System Theme Support**: The app now defaults to a `system` theme preference that follows the OS light/dark setting live (no restart needed), via a new `useResolvedThemeMode` hook subscribed to `useColorScheme`. The theme toggle button cycles system → light → dark → system, and `app.json`'s `userInterfaceStyle` was switched from a hardcoded `"dark"` to `"automatic"` so native chrome matches too.
- **Native Android Project & App Icon Asset Pack**: Added the native `android/` project scaffold (`expo prebuild`) and a generated brand icon set (`assets/icon.png`, adaptive-icon foreground/background, Android 13+ monochrome layer, splash, favicon, plus a reference `assets/app-icons/` export pack), wired up in `app.json`. Added `npm run android` / `npm run ios` scripts for native builds.
- **Dynamic Charging Speed Display**: Implemented active vehicle AC and DC peak charging limits inside the `RangeControlPanel` header.
- **Simulated Fallback Indicator**: Added a subtle, permanent `(Simulated)` badge next to the vehicle name pill and a footer note to notify users when range boundaries are rendered in offline simulation mode.
- **Scrollable Trip Itinerary**: Wrapped the timeline inside a `ScrollView` with a dynamic `maxHeight` restricted to 45% of the total screen height to prevent layout overflows.
- **Garage Preservation Policy**: Prevented default preset vehicle models (Tesla, BYD, NETA, MG, Hyundai) from being modified or deleted in the garage selector modal, securing system-default specifications.
- **Safety Fallback spec lookup**: Integrated a fallback mechanism that fetches vehicle specifications from presets if local persisted AsyncStorage profiles contain null or outdated values.

### Changed
- **Improved Fallback Polygon Formula**: Replaced the heavily distorted polygon formulas with a realistic road-network circuity (tortuosity) model scaling to 77%-87% of theoretical straight lines with organic variations.
- **Optimized Network Timeout Boundaries**: Wrapped all remote network fetches (OpenStreetMap Overpass, OpenChargeMap, OSRM routes, and OpenRouteService isochrones) with a hard 3-to-4-second timeout limit to guarantee instant offline fallback and prevent UI rendering hangs.
- **Cleaned Up Map Layout**: Removed the large floating warning overlay banners from the map layer for a cleaner, distraction-free user interface.
- **Responsive Split Layout for Wide Screens & Foldables**: `HomeScreen` now switches to a left/right split layout (search & trip card on the left, vehicle/range panel on the right) whenever the *shorter* screen dimension is at least 600dp, rather than requiring a landscape aspect ratio — this correctly triggers the split view on an unfolded Z Fold-style device (wide but still portrait-shaped), not just landscape tablets. `RangeControlPanel` gained an `isWide` prop so it renders fully expanded (no minimize handle) in that layout.
