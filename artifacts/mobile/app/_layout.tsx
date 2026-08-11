import {
  Montserrat_300Light,
  Montserrat_400Regular,
  Montserrat_500Medium,
  Montserrat_600SemiBold,
  Montserrat_700Bold,
  useFonts,
} from "@expo-google-fonts/montserrat";
import { ClerkProvider } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setAudioModeAsync } from "expo-audio";
import * as Notifications from "expo-notifications";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useState } from "react";
import { Platform, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { CookieNotice } from "@/components/CookieNotice";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { StagingBanner } from "@/components/StagingBanner";
import { AdminReviewPanel } from "@/components/AdminReviewPanel";
import { bootstrapUserToken } from "@/lib/userToken";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { HealthProvider } from "@/context/HealthContext";
import { NutritionProvider } from "@/context/NutritionContext";
import { GamificationProvider } from "@/context/GamificationContext";
import { WellbeingProvider } from "@/context/WellbeingContext";
import {
  SubscriptionProvider,
  identifyRevenueCatUser,
  initializeRevenueCat,
} from "@/lib/revenuecat";
import { initSentry, Sentry } from "@/lib/sentry";
import { logInteractionEvent } from "@/lib/events";

initSentry();

SplashScreen.preventAutoHideAsync();

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

if (Platform.OS !== "web") {
  try {
    initializeRevenueCat();
  } catch (err) {
    // Missing API keys are expected until the seed script has been run.
    console.warn("[SNAP Life] RevenueCat unavailable:", (err as Error)?.message);
  }
}

const queryClient = new QueryClient();

const CLERK_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
const AUTH_LOADING_REDIRECT_TIMEOUT_MS = 1500;

function RootLayoutNav() {
  const { user, isLoading, isOnboarded, isIdentityResolved } = useAuth();
  const router = useRouter();
  const segments = useSegments();
  const [authLoadTimedOut, setAuthLoadTimedOut] = useState(false);

  useEffect(() => {
    const openResponse = (response: Notifications.NotificationResponse) => {
      const data = response.notification.request.content.data;
      const route = typeof data?.route === "string" ? data.route : "/(tabs)/coach";
      if (route.startsWith("/")) router.push(route as never);
      logInteractionEvent({
        appUserId: user?.id,
        kind: "push_opened",
        payload: {
          route,
          copyId: typeof data?.copyId === "string" ? data.copyId : undefined,
          notificationKind: typeof data?.kind === "string" ? data.kind : undefined,
        },
      });
    };

    if (Platform.OS === "web") return;

    const subscription = Notifications.addNotificationResponseReceivedListener(openResponse);
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      openResponse(response);
      void Notifications.clearLastNotificationResponseAsync();
    });
    return () => subscription.remove();
  }, [router, user?.id]);

  // Tie RevenueCat purchases to the signed-in user so subscriptions follow
  // them across devices and reinstalls. Only fire once we've resolved the
  // canonical appUserId so we don't mis-attribute purchases to a transient
  // fallback id.
  useEffect(() => {
    if (!isIdentityResolved) return;
    identifyRevenueCatUser(user?.id ?? null);
  }, [user?.id, isIdentityResolved]);

  // Trust-on-first-use: claim a per-user bearer token the first time this
  // device sees a signed-in user. Best-effort and idempotent — subsequent
  // calls return the cached token without a network round-trip. Gated on
  // `isIdentityResolved` so we never bootstrap a token under an unconfirmed
  // appUserId (which would orphan per-user data on a different id once
  // `/auth/me` recovers).
  useEffect(() => {
    if (!isIdentityResolved) return;
    if (user?.id) {
      void bootstrapUserToken(user.id);
    }
  }, [user?.id, isIdentityResolved]);

  const inAuth = segments[0] === "auth";
  const inOnboarding = segments[0] === "onboarding";

  useEffect(() => {
    if (!isLoading || inAuth) {
      setAuthLoadTimedOut(false);
      return;
    }
    const timeout = setTimeout(
      () => setAuthLoadTimedOut(true),
      AUTH_LOADING_REDIRECT_TIMEOUT_MS,
    );
    return () => clearTimeout(timeout);
  }, [inAuth, isLoading]);

  useEffect(() => {
    if (isLoading && !authLoadTimedOut) return;
    if (!user && !inAuth) {
      router.replace("/auth/login");
      return;
    }
    if (user && !isOnboarded && !inOnboarding) {
      router.replace("/onboarding");
      return;
    }
    if (user && isOnboarded && (inAuth || inOnboarding)) {
      router.replace("/(tabs)");
    }
  }, [authLoadTimedOut, inAuth, inOnboarding, isLoading, isOnboarded, router, user]);

  if (isLoading && !inAuth && !authLoadTimedOut) {
    return <StartupFallback message="Loading your SNAPLife profile..." />;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="auth/login" options={{ headerShown: false }} />
      <Stack.Screen name="auth/register" options={{ headerShown: false }} />
      <Stack.Screen name="auth/forgot-password" options={{ headerShown: false }} />
      <Stack.Screen name="onboarding" options={{ headerShown: false }} />
      <Stack.Screen name="health/log-dexa" options={{ headerShown: false }} />
      <Stack.Screen name="health/activity" options={{ headerShown: false }} />
      <Stack.Screen name="health/nutrition" options={{ headerShown: false }} />
      <Stack.Screen name="health/supplements" options={{ headerShown: false }} />
      <Stack.Screen name="health/add-supplement" options={{ headerShown: false }} />
      <Stack.Screen name="health/meal-plan" options={{ headerShown: false }} />
      <Stack.Screen name="health/outcomes" options={{ headerShown: false }} />
      <Stack.Screen name="health/profile-details" options={{ headerShown: false }} />
      <Stack.Screen name="recipe/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="nutrition-guide/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="meditation" options={{ headerShown: false }} />
      <Stack.Screen name="breathing-studio" options={{ headerShown: false }} />
      <Stack.Screen name="rewards" options={{ headerShown: false }} />
      <Stack.Screen name="feedback" options={{ headerShown: false }} />
      <Stack.Screen name="subscription" options={{ headerShown: false }} />
      <Stack.Screen name="settings/notifications" options={{ headerShown: false }} />
      <Stack.Screen name="settings/privacy" options={{ headerShown: false }} />
      <Stack.Screen name="settings/privacy-policy" options={{ headerShown: false }} />
      <Stack.Screen name="settings/terms" options={{ headerShown: false }} />
      <Stack.Screen name="settings/wearable" options={{ headerShown: false }} />
      <Stack.Screen name="settings/help" options={{ headerShown: false }} />
      <Stack.Screen name="snap-shot" options={{ headerShown: false }} />
      <Stack.Screen name="insights" options={{ headerShown: false }} />
      <Stack.Screen name="movement/index" options={{ headerShown: false }} />
      <Stack.Screen name="movement/[id]" options={{ headerShown: false }} />
    </Stack>
  );
}

function MissingClerkKey() {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: "#0b0d12",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <Text style={{ color: "#fff", fontSize: 18, fontWeight: "700", marginBottom: 8 }}>
        Configuration error
      </Text>
      <Text style={{ color: "#aaa", textAlign: "center", lineHeight: 20 }}>
        EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY is not set. The app cannot initialize
        authentication. Restart the workflow after adding the secret.
      </Text>
    </View>
  );
}

function StartupFallback({ message }: { message: string }) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: "#0D2530",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <Text style={{ color: "#ffffff", fontSize: 28, fontWeight: "800", marginBottom: 10 }}>
        SNAPLife
      </Text>
      <Text style={{ color: "#A9DDEA", textAlign: "center", lineHeight: 20 }}>
        {message}
      </Text>
    </View>
  );
}

function RootLayoutInner() {
  const [fontLoadTimedOut, setFontLoadTimedOut] = useState(false);
  const [fontsLoaded, fontError] = useFonts({
    Inter_300Light: Montserrat_300Light,
    Inter_400Regular: Montserrat_400Regular,
    Inter_500Medium: Montserrat_500Medium,
    Inter_600SemiBold: Montserrat_600SemiBold,
    Inter_700Bold: Montserrat_700Bold,
  });

  useEffect(() => {
    const timeout = setTimeout(() => setFontLoadTimedOut(true), 5000);
    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    // Keep wellness audio audible when an iPhone's hardware silent switch is
    // enabled. Breathing Studio and Meditation share this audio session.
    void setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: false,
    }).catch((err) => {
      console.warn("[SNAP Life] Unable to configure the audio session", err);
    });
  }, []);

  const fontsReady = fontsLoaded || Boolean(fontError) || fontLoadTimedOut;

  useEffect(() => {
    if (fontsReady) {
      SplashScreen.hideAsync();
    }
  }, [fontsReady]);

  if (!fontsReady) {
    return <StartupFallback message="Loading your bone health companion..." />;
  }

  if (!CLERK_PUBLISHABLE_KEY) {
    return (
      <SafeAreaProvider>
        <MissingClerkKey />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <StatusBar style="light" backgroundColor="#0D2530" />
        <ClerkProvider
          publishableKey={CLERK_PUBLISHABLE_KEY}
          tokenCache={tokenCache}
        >
          <QueryClientProvider client={queryClient}>
            <GestureHandlerRootView style={{ flex: 1 }}>
              <KeyboardProvider>
                <AuthProvider>
                  <SubscriptionProvider>
                    <HealthProvider>
                      <NutritionProvider>
                        <GamificationProvider>
                          <WellbeingProvider>
                            <RootLayoutNav />
                            <CookieNotice />
                            <StagingBanner />
                            <AdminReviewPanel />
                          </WellbeingProvider>
                        </GamificationProvider>
                      </NutritionProvider>
                    </HealthProvider>
                  </SubscriptionProvider>
                </AuthProvider>
              </KeyboardProvider>
            </GestureHandlerRootView>
          </QueryClientProvider>
        </ClerkProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

export default Sentry.wrap(RootLayoutInner);
