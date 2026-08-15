import React, { useRef, useState, useEffect, useMemo } from 'react';
import { View, PanResponder, StyleSheet, GestureResponderEvent, PanResponderGestureState, Animated } from 'react-native';

export interface ICustomSliderProps {
  minimumValue: number;
  maximumValue: number;
  step?: number;
  value: number;
  onValueChange: (value: number) => void;
  onSlidingComplete?: (value: number) => void;
  minimumTrackTintColor?: string;
  maximumTrackTintColor?: string;
  thumbTintColor?: string;
  style?: any;
}

/** Clamp a channel to the valid 0-255 byte range after shading. */
const clampByte = (n: number) => Math.max(0, Math.min(255, n));

/** Parses `#rrggbb` into its byte channels, or null if `color` isn't hex (e.g. already rgba()). */
const parseHex = (color: string): [number, number, number] | null => {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(color);
  if (!match) return null;
  return [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)];
};

/** Reduces a `#rrggbb` (or passthrough rgba string) to an `rgba(...)` at the given alpha. */
const withAlpha = (color: string, alpha: number): string => {
  const rgb = parseHex(color);
  if (!rgb) return color;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
};

/** True if `color` reads as visually light — used to pick tick-mark ink that stays legible on it. */
const isLightColor = (color: string): boolean => {
  const rgb = parseHex(color);
  if (!rgb) return false;
  const [r, g, b] = rgb;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6;
};

const TICK_POSITIONS = [0, 0.25, 0.5, 0.75, 1];

const CustomSliderImpl: React.FC<ICustomSliderProps> = ({
  minimumValue,
  maximumValue,
  step = 1,
  value,
  onValueChange,
  onSlidingComplete,
  minimumTrackTintColor = '#2dd4bf',
  maximumTrackTintColor = 'rgba(148, 163, 184, 0.15)',
  thumbTintColor = '#2dd4bf',
  style,
}) => {
  const [localValue, setLocalValue] = useState(value);

  // Animated values driving the press state: thumb scale + halo intensity.
  const thumbScale = useRef(new Animated.Value(1)).current;
  const pressAnim = useRef(new Animated.Value(0)).current;

  // Sync with prop value when it changes from outside
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const valueRef = useRef(value);
  valueRef.current = localValue;

  const getPercent = () => {
    const range = maximumValue - minimumValue;
    if (range === 0) return 0;
    return (localValue - minimumValue) / range;
  };

  const startVal = useRef(value);

  // Track width via a ref, not state: the PanResponder below is built once inside a `useRef`
  // initializer, so its callbacks close over whatever `width` was on that first render (0,
  // before onLayout ever fires). A ref is always read fresh, even from that stale closure.
  const widthRef = useRef(0);

  const animatePress = (isPressed: boolean) => {
    Animated.spring(thumbScale, {
      toValue: isPressed ? 1.15 : 1,
      useNativeDriver: true,
      friction: 7,
      tension: 140,
    }).start();
    Animated.timing(pressAnim, {
      toValue: isPressed ? 1 : 0,
      duration: isPressed ? 120 : 220,
      useNativeDriver: true,
    }).start();
  };

  // Params that change on every step of a drag (minimumValue/maximumValue/step/onValueChange are
  // effectively static per slider instance, but keep them fresh via refs rather than as
  // PanResponder dependencies) — read through refs so the responder object itself never needs
  // rebuilding mid-gesture.
  const paramsRef = useRef({ minimumValue, maximumValue, step, onValueChange, onSlidingComplete });
  paramsRef.current = { minimumValue, maximumValue, step, onValueChange, onSlidingComplete };

  // Built exactly once via useState's lazy initializer (unlike `useRef(PanResponder.create(...))`,
  // whose argument is still evaluated — and its result thrown away — on every render). Reading
  // live values through the refs above means this never needs to be recreated, so a drag in
  // progress is never handed off to a new gesture responder mid-motion.
  const [panResponder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt: GestureResponderEvent) => {
        animatePress(true);
        startVal.current = valueRef.current;
        const width = widthRef.current;
        if (width > 0) {
          const { minimumValue: min, maximumValue: max, step: s, onValueChange: notify } = paramsRef.current;
          const touchX = evt.nativeEvent.locationX;
          const percentage = Math.max(0, Math.min(1, touchX / width));
          const rawValue = min + percentage * (max - min);
          const steppedValue = Math.round(rawValue / s) * s;
          const clampedValue = Math.max(min, Math.min(max, steppedValue));
          setLocalValue(clampedValue);
          notify(clampedValue);
          startVal.current = clampedValue;
        }
      },
      onPanResponderMove: (evt: GestureResponderEvent, gestureState: PanResponderGestureState) => {
        const width = widthRef.current;
        if (width === 0) return;
        const { minimumValue: min, maximumValue: max, step: s, onValueChange: notify } = paramsRef.current;
        const deltaVal = (gestureState.dx / width) * (max - min);
        const rawValue = startVal.current + deltaVal;
        const steppedValue = Math.round(rawValue / s) * s;
        const clampedValue = Math.max(min, Math.min(max, steppedValue));

        if (clampedValue !== valueRef.current) {
          setLocalValue(clampedValue);
          notify(clampedValue);
        }
      },
      onPanResponderRelease: () => {
        animatePress(false);
        const { onSlidingComplete: complete } = paramsRef.current;
        if (complete) {
          complete(valueRef.current);
        }
      },
      onPanResponderTerminate: () => {
        animatePress(false);
        const { onSlidingComplete: complete } = paramsRef.current;
        if (complete) {
          complete(valueRef.current);
        }
      },
    })
  );

  const percent = getPercent();
  const leftOffset = `${percent * 100}%` as `${number}%`;

  // Hairline track + a two-layer alpha "halo" instead of gradients — reads as an instrument-panel
  // glow rather than a glossy/plastic bar, and (unlike shadowColor) renders correctly on Android.
  // Memoized on the tint colors alone (not `percent`/`localValue`) so a drag in progress — which
  // re-renders this component on every step — doesn't re-parse the same hex strings every frame.
  const { trackFaint, haloOuter, haloInner, tickInk } = useMemo(
    () => ({
      trackFaint: withAlpha(maximumTrackTintColor, 0.4),
      haloOuter: withAlpha(minimumTrackTintColor, 0.16),
      haloInner: withAlpha(minimumTrackTintColor, 0.32),
      tickInk: isLightColor(maximumTrackTintColor) ? 'rgba(15, 23, 42, 0.18)' : 'rgba(255, 255, 255, 0.22)',
    }),
    [minimumTrackTintColor, maximumTrackTintColor]
  );

  const thumbHaloOpacity = pressAnim.interpolate({ inputRange: [0, 1], outputRange: [0.22, 0.5] });

  return (
    <View
      style={[styles.container, style]}
      onLayout={(e) => { widthRef.current = e.nativeEvent.layout.width; }}
      {...panResponder.panHandlers}
    >
      {/* Base hairline — thin, quiet, out of the way until it's filled. */}
      <View style={[styles.trackLine, { backgroundColor: trackFaint }]} />

      {/* Precision tick marks — a measured-instrument cue, not a scale label. */}
      {TICK_POSITIONS.map((p) => (
        <View
          key={p}
          pointerEvents="none"
          style={[styles.tick, { left: `${p * 100}%` as `${number}%`, backgroundColor: tickInk }]}
        />
      ))}

      {/* Filled hairline with a soft two-layer glow — the "techy" accent. */}
      <View style={[styles.fillClip, { width: leftOffset }]} pointerEvents="none">
        <View style={[styles.haloOuter, { backgroundColor: haloOuter }]} />
        <View style={[styles.haloInner, { backgroundColor: haloInner }]} />
        <View style={[styles.fillCore, { backgroundColor: minimumTrackTintColor }]} />
      </View>

      {/* Thumb — a miniature battery gauge whose own fill tracks the value live, with a
          press-reactive halo. Fitting for an EV app: the handle you drag doubles as the read-out.
          `pointerEvents="none"` is deliberate: the PanResponder lives on the outer container, and
          `locationX` in its touch events is measured relative to whatever sub-view the finger
          actually lands on — not the responder. Without this, tapping the thumb icon itself made
          `locationX` relative to that ~19px icon instead of the full track, computing near-0% and
          snapping the value back to 0. Making the thumb visual click-through keeps every touch
          landing on the container, so position math is always relative to the true track width. */}
      <View style={[styles.thumbAnchor, { left: leftOffset }]} pointerEvents="none">
        <Animated.View
          style={[styles.thumbHalo, { backgroundColor: thumbTintColor, opacity: thumbHaloOpacity }]}
        />
        <Animated.View style={[styles.thumbGroup, { transform: [{ scale: thumbScale }] }]}>
          <View style={[styles.batteryBody, { borderColor: thumbTintColor }]}>
            <View
              style={[
                styles.batteryFill,
                { width: `${percent * 100}%` as `${number}%`, backgroundColor: thumbTintColor },
              ]}
            />
          </View>
          <View style={[styles.batteryNub, { backgroundColor: thumbTintColor }]} />
        </Animated.View>
      </View>
    </View>
  );
};

// Memoized so, e.g., dragging the Battery SoC slider — which only changes *its own* value prop —
// doesn't also re-render the Reserve Buffer and Charge Limit sliders sitting next to it; their
// props (value, tint colors, the stable store-action callback, the shared `styles.slider` object)
// are all unchanged, so the shallow prop comparison bails out before any of their render work runs.
export const CustomSlider = React.memo(CustomSliderImpl);

const styles = StyleSheet.create({
  container: {
    height: 36, // Generous touch target area
    justifyContent: 'center',
    width: '100%',
    position: 'relative',
  },
  trackLine: {
    height: 2,
    borderRadius: 1,
    width: '100%',
  },
  tick: {
    position: 'absolute',
    width: 1.5,
    height: 6,
    marginLeft: -0.75,
    borderRadius: 1,
    alignSelf: 'center',
  },
  fillClip: {
    position: 'absolute',
    left: 0,
    height: '100%',
    justifyContent: 'center',
  },
  haloOuter: {
    position: 'absolute',
    left: 0,
    right: -1,
    height: 12,
    borderRadius: 6,
    alignSelf: 'center',
  },
  haloInner: {
    position: 'absolute',
    left: 0,
    right: -1,
    height: 6,
    borderRadius: 3,
    alignSelf: 'center',
  },
  fillCore: {
    height: 2,
    borderRadius: 1,
    width: '100%',
  },
  thumbAnchor: {
    position: 'absolute',
    width: 0,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbHalo: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderRadius: 15,
  },
  thumbGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  batteryBody: {
    width: 19,
    height: 12,
    borderRadius: 2.5,
    borderWidth: 1.5,
    backgroundColor: 'rgba(255, 255, 255, 0.97)',
    padding: 1.5,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  batteryFill: {
    height: '100%',
    borderRadius: 1,
  },
  batteryNub: {
    width: 2.5,
    height: 5,
    borderRadius: 1,
    marginLeft: 1.5,
  },
});
