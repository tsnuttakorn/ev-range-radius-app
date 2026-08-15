# Range Calculation Formula

Documents the math behind every range/energy figure the app shows (SAFE RANGE, Max Buffer Range,
Usable Energy, efficiency, and the drive/charge time budget). All of it lives in
[`src/utils/RangeCalculator.ts`](../src/utils/RangeCalculator.ts) — this doc explains the *why*
behind each constant; the code is the source of truth for the exact numbers.

## Overview

```
officialRangeKm
  × ratingStandardFactor   (NEDC / WLTP / EPA / CUSTOM)
  × customEfficiencyFactor (per-vehicle user adjustment, default 1.0)
  × airConPenalty          (0.95 if AC on, else 1.0)
  × drivingModeFactor      (CITY / MIXED / HIGHWAY)
  = totalRealWorldRangeKm  (flat-to-empty range at 100% SoC)
```

`totalRealWorldRangeKm` is the single number everything else derives from. It's computed by
[`getEffectiveRangeKm()`](../src/utils/RangeCalculator.ts) and is deliberately SoC-independent —
trip planning uses the same function to convert a leg's distance into %SoC consumed, without
depending on the driver's current battery level.

## Formula table

Every formula in one place — see the sections below for the reasoning behind each constant.

| # | Output | Formula |
|---|---|---|
| 1 | Total Real-World Range (km) | `officialRangeKm × ratingStandardFactor × customEfficiencyFactor × airConPenalty × drivingModeFactor` |
| 2 | Net Usable SoC (%) | `max(0, currentSoC − targetReserveSoC)` |
| 3 | **Safe Range** (km) | `totalRealWorldRangeKm × netUsableSoC / 100` |
| 4 | **Max Range** (km) | `totalRealWorldRangeKm × max(0, currentSoC) / 100` |
| 5 | **Max Buffer Range** (km) | `totalRealWorldRangeKm × max(0, 100 − targetReserveSoC) / 100` |
| 6 | **Usable Energy** (kWh) | `netUsableSoC / 100 × batteryCapacityKWh` |
| 7 | **Estimated Efficiency** (kWh/km) | `batteryCapacityKWh / totalRealWorldRangeKm` |
| 8 | Estimated Drive Time (min) | `safeRangeKm / getAvgSpeedKmH(drivingMode) × 60` |
| 9 | Estimated Charge Time (min) | `TripPlannerService.estimateChargeTimeMinutes(batteryCapacityKWh, maxDcChargeKW, 'DC', targetReserveSoC, preferredMaxChargeSoC, maxDcChargeKW)` |
| 10 | Estimated Total Travel Time (min) | `estimatedDriveTimeMinutes + estimatedChargeTimeMinutes` |

Rows 1–7 are computed by `RangeCalculator.calculate()`; rows 8–10 are computed by
`useEVStore.getCalculationResult()`, which calls into `calculate()` for rows 1–7 first. If
`totalRealWorldRangeKm ≤ 0` or `batteryCapacityKWh ≤ 0`, rows 3–7 all short-circuit to `0`.

## 1. Rating standard factor

How much of the official lab-tested range survives in real-world driving, before any of the
driver-controllable adjustments below are applied.

| Standard | Factor | Why |
|---|---|---|
| NEDC | **0.90** | The most optimistic of the three test cycles — low, steady speeds, minimal acceleration. Real-world range typically lands well below the rated figure even under favorable conditions. |
| WLTP | **1.00** | Already calibrated much closer to real-world driving. Treated as the vehicle's achievable ceiling rather than discounted further by default. |
| EPA | **1.00** | Same reasoning as WLTP — the most realistic/conservative of the three by design, so no further blanket discount. |
| CUSTOM | *(n/a)* | Skips the standard factor entirely — `customEfficiencyFactor` alone determines the multiplier, for a vehicle profile with no official rating to anchor to. |

> **Calibration status:** these are general-purpose defaults, not fitted to a specific vehicle's
> logged real-world numbers. NEDC in particular has been nudged upward twice this session (0.72 →
> 0.75 → 0.8 → 0.85 → **0.9**) in response to "real range is higher than the app predicts," each
> time without a concrete before/after figure to calibrate against. If it's still off, the fix is
> to compare a specific vehicle's official rating against its actual observed range and fit the
> factor to that — not another blind nudge. WLTP/EPA are already at their 1.0 ceiling, so they have
> no more room to move upward under this model.

## 2. Custom efficiency factor

`vehicle.customEfficiencyFactor` — a user-adjustable multiplier (default `1.0`) representing
driving style or vehicle-specific deviation from the standard (e.g. `0.9` for consistently sportier
driving/faster drain). Applies multiplicatively regardless of rating standard.

## 3. Air conditioning penalty

`AIR_CON_PENALTY = 0.95` — a flat 5% range reduction whenever climate control is active. Applies
uniformly regardless of rating standard or driving mode; a real implementation would vary this by
ambient temperature and compressor load, but this app treats it as a simple on/off toggle.

## 4. Driving mode factor

Introduced to let the driver tell the app *how* they're actually driving, separate from *how the
range was tested* (the rating standard above). See [`DrivingMode`](../src/types/ev.ts).

| Mode | Range factor | Reference speed (time estimates only) | Why |
|---|---|---|---|
| City / Urban | **1.10** | 40 km/h | Regenerative braking recovers energy at low speeds/frequent stops that the official rating doesn't fully credit — real-world range tends to *beat* the rating. |
| Mixed Commuting | **1.00** | 90 km/h | The neutral baseline — this is what the rating standards above already approximate. |
| Highway / Motorway | **0.80** | 110 km/h | Aerodynamic drag scales with the square of speed; sustained high-speed driving costs more energy per km than the rating assumes, with no stop-and-go to offset it. |

### Combined factor: rating standard × driving mode

`ratingStandardFactor × drivingModeFactor`, as a % of the official rated range — before the AC
penalty and `customEfficiencyFactor` (both apply uniformly on top, regardless of standard/mode).

**AC off** (`airConPenalty = 1.00`):

| Standard | City (×1.10) | Mixed (×1.00) | Highway (×0.80) |
|---|---|---|---|
| NEDC (×0.90) | 0.99 → **99%** | 0.90 → **90%** | 0.72 → **72%** |
| WLTP (×1.00) | 1.10 → **110%** | 1.00 → **100%** | 0.80 → **80%** |
| EPA (×1.00) | 1.10 → **110%** | 1.00 → **100%** | 0.80 → **80%** |

**AC on** (`airConPenalty = 0.95`, i.e. every AC-off cell above × 0.95):

| Standard | City (×1.10) | Mixed (×1.00) | Highway (×0.80) |
|---|---|---|---|
| NEDC (×0.90) | 0.9405 → **94.1%** | 0.855 → **85.5%** | 0.684 → **68.4%** |
| WLTP (×1.00) | 1.045 → **104.5%** | 0.95 → **95%** | 0.76 → **76%** |
| EPA (×1.00) | 1.045 → **104.5%** | 0.95 → **95%** | 0.76 → **76%** |

The reference speed is used **only** for the drive-time estimate
(`estimatedDriveTimeMinutes = safeRangeKm / avgSpeedKmH × 60`) — it never feeds into the range
math itself. A slower city speed doesn't imply a shorter city range; it just means covering that
(longer) range takes more time. See `getAvgSpeedKmH()`.

Selected via the Driving Mode control in `RangeControlPanel`, persisted in `useEVStore`, default
`MIXED`.

> **Not yet wired into trip planning:** `TripPlannerService` calls `getEffectiveRangeKm()` without
> a driving mode, which defaults to `MIXED` — so a planned trip's per-leg range math doesn't yet
> reflect the driver's selected mode. Extending that is a separate piece of work (threading
> `drivingMode` through `PlanSmartTripInput` and every leg's reachability check).

## 5. Downstream figures

Once `totalRealWorldRangeKm` is known, `calculate()` derives everything else:

| Figure | Formula | Meaning |
|---|---|---|
| **Safe Range** | `totalRealWorldRangeKm × (currentSoC − targetReserveSoC) / 100` | Km remaining right now before the reserve buffer is hit. Clamped to 0 if `currentSoC < targetReserveSoC`. |
| **Max Range** | `totalRealWorldRangeKm × currentSoC / 100` | Theoretical max at the *current* SoC, driving straight past the reserve buffer to 0%. Deliberately ignores the reserve — it's the map's outer boundary polygon, not a "safe" figure. |
| **Max Buffer Range** | `totalRealWorldRangeKm × (100 − targetReserveSoC) / 100` | Best-case range at a *full* charge while still respecting the reserve buffer. Independent of current SoC (unlike Safe Range) — "the most I could plan a trip for," not "what's reachable right now." |
| **Usable Energy (kWh)** | `vehicle.batteryCapacityKWh × (currentSoC − targetReserveSoC) / 100` | Energy available above the reserve buffer, at current SoC. |
| **Estimated Efficiency (kWh/km)** | `vehicle.batteryCapacityKWh / totalRealWorldRangeKm` | Derived, not measured — a consequence of the range figure above, not an independent input. |

All results are rounded to 1 decimal place (3 for efficiency) before being returned.

## 6. Time budget (`RangeCalculationResultWithTime`, via `useEVStore.getCalculationResult()`)

A rough estimate shown alongside the range figures, independent of any actual planned
trip/destination:

- **Drive time** = `safeRangeKm / getAvgSpeedKmH(drivingMode) × 60` minutes.
- **Charge time** = `TripPlannerService.estimateChargeTimeMinutes(...)`, assuming a representative
  DC fast charger running at the vehicle's own max DC charge speed (best case — no real charger
  has been chosen yet), recharging from the reserve level up to the driver's preferred charge
  limit.
- **Total** = drive + charge time, combined.

## Worked example

Tesla Model Y RWD — WLTP 455 km rated, 60 kWh battery, 80% → 10% reserve, Mixed driving, AC off:

```
totalRealWorldRangeKm = 455 × 1.0 (WLTP) × 1.0 (custom) × 1.0 (AC off) × 1.0 (Mixed) = 455 km
safeRangeKm            = 455 × (80 − 10) / 100                                      = 318.5 km
maxRangeKm              = 455 × 80 / 100                                            = 364 km
maxBufferRangeKm        = 455 × (100 − 10) / 100                                    = 409.5 km
usableBatteryKWh        = 60 × (80 − 10) / 100                                      = 42 kWh
estimatedEfficiencyKWhPerKm = 60 / 455                                              = 0.132 kWh/km
```

Same vehicle in Highway mode instead: `totalRealWorldRangeKm = 455 × 0.8 = 364 km`, so
`safeRangeKm = 364 × 0.7 = 254.8 km` — noticeably less than the Mixed figure above, for the same
SoC and reserve.

## Tests

[`src/utils/__tests__/RangeCalculator.test.ts`](../src/utils/__tests__/RangeCalculator.test.ts)
covers each factor individually (rating standard, AC penalty, custom efficiency, driving mode) and
the derived figures (safe/max/max-buffer range, usable energy, efficiency), plus edge cases
(SoC below reserve, zero SoC, zero range/battery).
