# 🚗 ev-range-radius-app

**ev-range-radius-app** is a smart, zero-anxiety EV trip planner and interactive range visualization app built with React Native and Expo. 

It is designed to give EV drivers absolute peace of mind by showing precisely how far they can travel on their current charge. By combining real-time battery calculations, vehicle charging profiles, and simulated road-network boundaries, the app makes road trips relaxed, predictable, and entirely worry-free.

---

## 🌟 Key Features

- **Visual Range Boundaries**: Displays interactive "Safe Range" (Teal) and "Max Range" (dashed Amber) boundaries using optimized offline simulated road network polygons (circuity factor-adjusted to 77%-87% of theoretical straight lines).
- **Subtle Fallback Indicators**: Unconditionally shows a neat `(Simulated)` indicator next to the vehicle name when operating in offline/simulated mode.
- **Dynamic Vehicle Info**: Shows AC and DC peak charging limits directly on the control panel, with a fallback safety lookup to default configuration specs.
- **Secure Garage Controls**: Restricts default preset models (Tesla, BYD, Neta, MG, Hyundai, etc.) from being edited or deleted, while allowing custom EV additions.
- **Responsive Trip Itinerary**: Renders a fully scrollable leg-by-leg timeline of charging stops and drive times, constrained dynamically to 45% of the screen height.
- **Fail-Fast Resiliency**: Network fetches for routes (OSRM), isochrones (ORS), and charging stations (Overpass/OCM) are bounded to a maximum of 3-4s timeout abort boundaries, preventing UI freezes and ensuring instant offline fallback rendering.

---

## 🛠️ Technology Stack

- **Framework**: React Native with Expo CLI
- **State Management**: Zustand (Persisted)
- **Mapping & GIS**: React Native Maps (`react-native-maps`)
- **Icons**: FontAwesome (`@expo/vector-icons`)
- **Languages**: TypeScript, JavaScript

---

## 🚀 Getting Started

### Prerequisites

Make sure you have Node.js and npm installed on your system.

### Installation

1. Clone this repository to your local machine.
2. Install the project dependencies:
   ```bash
   npm install
   ```

### Running the Application

Start the Expo development server:
```bash
npm start
```
You can run it on:
- **Android**: Press `a` (requires Android Emulator or physical device connected via USB/ADB).
- **iOS**: Press `i` (requires macOS and Xcode Simulator).
- **Expo Go App**: Scan the QR code displayed in the terminal using the Expo Go app on your phone.

To clear cache while starting (recommended when editing `.env` files):
```bash
npx expo start -c
```

---

## 🧪 Running Tests

This project uses Jest for unit testing. You can run all test suites using:
```bash
npm test
```
