import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import HomeScreen from './src/screens/HomeScreen';
import { LocationPermissionGate } from './src/screens/LocationPermissionGate';

export default function App() {
  return (
    <SafeAreaProvider>
      <LocationPermissionGate>
        <HomeScreen />
      </LocationPermissionGate>
    </SafeAreaProvider>
  );
}
