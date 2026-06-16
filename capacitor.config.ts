/**
 * #149: Capacitor Configuration — PWA to Native App
 * Run: npx cap init scangym com.scangym.app --web-dir frontend/public
 * Then: npx cap add ios && npx cap add android
 */
import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.scangym.app',
  appName: 'ScanGym',
  webDir: 'frontend/public',
  server: {
    androidScheme: 'https',
    // For dev: url: 'http://localhost:3000'
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#0a0c14',
      androidSplashResourceName: 'splash',
      showSpinner: false,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0a0c14',
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    Haptics: {},
    Camera: {
      // For gym posts and reels
    },
    Geolocation: {
      // For nearby gym search
    },
  },
  ios: {
    contentInset: 'automatic',
    scheme: 'ScanGym',
  },
  android: {
    allowMixedContent: true,
    captureInput: true,
  },
};

export default config;
