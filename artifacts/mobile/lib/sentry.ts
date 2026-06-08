import * as Sentry from "@sentry/react-native";
import Constants from "expo-constants";

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

/**
 * Initialise Sentry. Silently skipped if EXPO_PUBLIC_SENTRY_DSN is not set
 * (development, CI). Call once at app startup before any other providers.
 */
export function initSentry() {
  if (!DSN) return;

  Sentry.init({
    dsn: DSN,
    environment: __DEV__ ? "development" : "production",
    release: Constants.expoConfig?.version ?? "unknown",
    tracesSampleRate: __DEV__ ? 0 : 0.1,
    enableNativeNagger: false,
    debug: false,
    beforeSend(event) {
      if (__DEV__) return null;
      return event;
    },
  });
}

export { Sentry };
