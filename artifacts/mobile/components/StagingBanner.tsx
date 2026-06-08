import { Feather } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_STAGING = process.env.EXPO_PUBLIC_SNAP_ENV === "staging";

export function StagingBanner() {
  const insets = useSafeAreaInsets();
  if (!IS_STAGING) return null;

  return (
    <View
      style={[
        styles.banner,
        { paddingTop: insets.top + 4, top: 0 },
      ]}
      pointerEvents="none"
    >
      <Feather name="alert-triangle" size={11} color="#fff" />
      <Text style={styles.text} numberOfLines={1}>
        TESTING ENVIRONMENT — not the live app
      </Text>
      <Feather name="alert-triangle" size={11} color="#fff" />
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 9999,
    backgroundColor: "#D97706",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingBottom: 6,
    paddingHorizontal: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 8,
  },
  text: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    color: "#fff",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
});
