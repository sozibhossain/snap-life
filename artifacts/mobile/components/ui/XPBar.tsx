import React from "react";
import { StyleSheet, Text, View, ViewStyle } from "react-native";
import { useColors } from "@/hooks/useColors";

interface XPBarProps {
  xp: number;
  xpToNext: number;
  level: number;
  style?: ViewStyle;
}

export function XPBar({ xp, xpToNext, level, style }: XPBarProps) {
  const colors = useColors();
  const progress = Math.min(xp / xpToNext, 1);

  return (
    <View style={[styles.container, style]}>
      <View style={styles.header}>
        <View style={[styles.levelBadge, { backgroundColor: colors.primary }]}>
          <Text style={[styles.levelText, { color: colors.primaryForeground }]}>
            Lv {level}
          </Text>
        </View>
        <Text style={[styles.xpText, { color: colors.mutedForeground }]}>
          {xp.toLocaleString()} / {xpToNext.toLocaleString()} XP
        </Text>
      </View>
      <View style={[styles.track, { backgroundColor: colors.muted }]}>
        <View
          style={[
            styles.fill,
            { width: `${progress * 100}%` as any, backgroundColor: colors.primary },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {},
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  levelBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 20,
  },
  levelText: {
    fontSize: 12,
    fontFamily: "Inter_700Bold",
  },
  xpText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  track: {
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: 3,
  },
});
