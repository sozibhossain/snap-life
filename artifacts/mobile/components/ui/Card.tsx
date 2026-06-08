import React from "react";
import { View, ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

import { useColors } from "@/hooks/useColors";
import type { GradientStops } from "@/constants/colors";

type CardVariant = "default" | "elevated" | "outlined" | "gradient";

interface CardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  variant?: CardVariant;
  /**
   * Required when `variant === "gradient"`. Pass a tuple from
   * `useColors().gradients`, e.g. `gradients.calm`. The card will
   * draw the gradient from the top-left corner to the bottom-right
   * corner so the colour rotation reads as a soft diagonal sweep.
   */
  gradient?: GradientStops;
  /**
   * Override for the diagonal direction of the gradient. Defaults to
   * a top-left → bottom-right sweep that suits hero cards. Only used
   * when `variant === "gradient"`.
   */
  gradientStart?: { x: number; y: number };
  gradientEnd?: { x: number; y: number };
}

export function Card({
  children,
  style,
  variant = "default",
  gradient,
  gradientStart = { x: 0, y: 0 },
  gradientEnd = { x: 1, y: 1 },
}: CardProps) {
  const colors = useColors();

  const baseStyles: ViewStyle = {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 16,
    overflow: "hidden",
  };

  if (variant === "elevated") {
    return (
      <View style={[baseStyles, colors.shadows.md, style]}>{children}</View>
    );
  }

  if (variant === "outlined") {
    return (
      <View
        style={[
          baseStyles,
          { borderWidth: 1, borderColor: colors.border },
          style,
        ]}
      >
        {children}
      </View>
    );
  }

  if (variant === "gradient") {
    // Gradient cards always carry the medium shadow so they feel
    // intentional (these are reserved for hero / focal surfaces).
    const stops: GradientStops = gradient ?? colors.gradients.hero;
    return (
      <View style={[colors.shadows.md, { borderRadius: 16 }, style]}>
        <LinearGradient
          colors={stops}
          start={gradientStart}
          end={gradientEnd}
          style={[
            baseStyles,
            // background is provided by the gradient itself
            { backgroundColor: "transparent" },
          ]}
        >
          {children}
        </LinearGradient>
      </View>
    );
  }

  return <View style={[baseStyles, style]}>{children}</View>;
}
