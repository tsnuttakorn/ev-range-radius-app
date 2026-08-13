import { useColorScheme } from 'react-native';
import { useEVStore } from '../store/useEVStore';
import { ThemeMode } from './tokens';

/**
 * Resolves the user's theme preference ('system' | 'light' | 'dark') against the live OS
 * appearance setting. Subscribes to `useColorScheme`, so when the preference is 'system' the
 * app re-renders in real time as the device switches between light and dark (no restart
 * needed), matching how `userInterfaceStyle: "automatic"` behaves natively.
 */
export const useResolvedThemeMode = (): ThemeMode => {
  const themeMode = useEVStore((state) => state.themeMode);
  const deviceScheme = useColorScheme();
  if (themeMode === 'system') {
    return deviceScheme === 'light' ? 'light' : 'dark'; // default to dark if OS reports null/unknown
  }
  return themeMode;
};
