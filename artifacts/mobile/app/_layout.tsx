import {
  Montserrat_300Light,
  Montserrat_400Regular,
  Montserrat_500Medium,
  Montserrat_600SemiBold,
  Montserrat_700Bold,
  useFonts,
} from "@expo-google-fonts/montserrat";
import { ClerkLoaded, ClerkProvider } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { Text, View } from "react-native";
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

initSentry();

SplashScreen.preventAutoHideAsync();

try {
  initializeRevenueCat();
} catch (err) {
  // Missing API keys are expected until the seed script has been run.
  console.warn("[SNAP Life] RevenueCat unavailable:", (err as Error)?.message);
}

const queryClient = new QueryClient();

const CLERK_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;

function RootLayoutNav() {
  const { user, isLoading, isOnboarded, isIdentityResolved } = useAuth();
  const segments = useSegments();
  const router = useRouter();

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

  useEffect(() => {
    if (isLoading) return;
    const inAuth = segments[0] === "auth";
    const inOnboarding = segments[0] === "onboarding";
    if (!user && !inAuth) {
      router.replace("/auth/login");
    } else if (user && !isOnboarded && !inOnboarding) {
      router.replace("/onboarding");
    } else if (user && isOnboarded && (inAuth || inOnboarding)) {
      router.replace("/(tabs)");
    }
  }, [user, isLoading, isOnboarded, segments]);

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

function RootLayoutInner() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_300Light: Montserrat_300Light,
    Inter_400Regular: Montserrat_400Regular,
    Inter_500Medium: Montserrat_500Medium,
    Inter_600SemiBold: Montserrat_600SemiBold,
    Inter_700Bold: Montserrat_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  if (!CLERK_PUBLISHABLE_KEY) {
    return (
      <SafeAreaProvider>
        <MissingClerkKey />
      </SafeAreaProvider>
    );
  }

  return (
    <ClerkProvider
      publishableKey={CLERK_PUBLISHABLE_KEY}
      tokenCache={tokenCache}
    >
      <ClerkLoaded>
        <SafeAreaProvider>
          <ErrorBoundary>
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
          </ErrorBoundary>
        </SafeAreaProvider>
      </ClerkLoaded>
    </ClerkProvider>
  );
}

export default Sentry.wrap(RootLayoutInner);
