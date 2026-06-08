/**
 * Web shim for `expo-blur`. We never call BlurView on web in the tabs
 * layout (the layout branches on `isIOS` first), but the import alone can
 * pull in native modules. This shim renders a translucent fallback so
 * any other caller still gets a sensible visual.
 */
import React from "react";
import { View, ViewStyle, StyleProp } from "react-native";

interface BlurViewProps {
  style?: StyleProp<ViewStyle>;
  tint?: "light" | "dark" | "default" | string;
  intensity?: number;
  children?: React.ReactNode;
}

export function BlurView({ style, tint, children }: BlurViewProps) {
  const fallback: ViewStyle = {
    backgroundColor:
      tint === "dark" ? "rgba(15, 23, 42, 0.72)" : "rgba(255, 255, 255, 0.72)",
  };
  return <View style={[fallback, style]}>{children}</View>;
}
