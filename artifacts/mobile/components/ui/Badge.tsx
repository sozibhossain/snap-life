import React from "react";
import { StyleSheet, Text, View, ViewStyle } from "react-native";
import { useColors } from "@/hooks/useColors";

interface BadgeProps {
  label: string;
  variant?: "default" | "success" | "warning" | "danger" | "accent";
  size?: "sm" | "md";
  style?: ViewStyle;
}

export function Badge({
  label,
  variant = "default",
  size = "md",
  style,
}: BadgeProps) {
  const colors = useColors();

  const variantColors: Record<string, { bg: string; text: string }> = {
    default: { bg: colors.secondary, text: colors.secondaryForeground },
    success: { bg: colors.success + "22", text: colors.success },
    warning: { bg: colors.warning + "22", text: colors.warning },
    danger: { bg: colors.destructive + "22", text: colors.destructive },
    accent: { bg: colors.accent + "22", text: colors.accent },
  };

  const vc = variantColors[variant];

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: vc.bg,
          paddingHorizontal: size === "sm" ? 8 : 10,
          paddingVertical: size === "sm" ? 2 : 4,
        },
        style,
      ]}
    >
      <Text
        style={[
          styles.label,
          {
            color: vc.text,
            fontSize: size === "sm" ? 10 : 12,
          },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: 20,
    alignSelf: "flex-start",
  },
  label: {
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
});
