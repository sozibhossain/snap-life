import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import React from "react";
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useGamification } from "@/context/GamificationContext";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { useColors } from "@/hooks/useColors";

const CATEGORY_ICONS = {
  discount: "tag" as const,
  digital: "download" as const,
  physical: "package" as const,
  consultation: "user" as const,
};

const CATEGORY_COLORS = (colors: any) => ({
  discount: colors.primary,
  digital: colors.accent,
  physical: colors.xpGold,
  consultation: colors.success,
});

export default function RewardsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { rewards, redeemReward } = useGamification();
  const { user } = useAuth();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;
  const catColors = CATEGORY_COLORS(colors);

  async function handleRedeem(id: string, cost: number, title: string) {
    Alert.alert(
      "Coming Soon",
      "Reward redemption will be available in a future update. Keep earning XP — your balance will carry over.",
    );
    return;
    // Disabled until rewards launch:
    if ((user?.totalPoints ?? 0) < cost) {
      Alert.alert("Insufficient Points", `You need ${cost} XP to redeem this reward. You have ${user?.totalPoints ?? 0} XP.`);
      return;
    }
    if (Platform.OS !== "web") {
      Alert.alert("Redeem Reward", `Redeem "${title}" for ${cost} XP?`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Redeem",
          onPress: async () => {
            const success = await redeemReward(id, cost);
            if (success) {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            }
          },
        },
      ]);
    } else {
      const success = await redeemReward(id, cost);
      if (success) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 8, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Rewards Shop</Text>
        <View style={[styles.xpChip, { backgroundColor: colors.xpGold + "22" }]}>
          <Feather name="star" size={12} color={colors.xpGold} />
          <Text style={[styles.xpText, { color: colors.xpGold }]}>
            {user?.totalPoints.toLocaleString()}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 20 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.pointsCard, { backgroundColor: colors.primary }]}>
          <View>
            <Text style={styles.pointsLabel}>Your XP Balance</Text>
            <Text style={styles.pointsValue}>{user?.totalPoints.toLocaleString()} XP</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={styles.pointsLabel}>Level {user?.level}</Text>
            <Text style={styles.pointsSub}>Keep earning!</Text>
          </View>
        </View>

        <View
          style={[
            styles.comingSoonBanner,
            { backgroundColor: colors.accent + "12", borderColor: colors.accent + "40" },
          ]}
        >
          <View style={[styles.comingSoonIconWrap, { backgroundColor: colors.accent + "22" }]}>
            <Feather name="clock" size={18} color={colors.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.comingSoonTitle, { color: colors.foreground }]}>
              Rewards — Coming Soon
            </Text>
            <Text style={[styles.comingSoonSub, { color: colors.mutedForeground }]}>
              Keep earning XP. Redeemable rewards launch in a future update.
            </Text>
          </View>
        </View>

        <Text style={[styles.sectionLabel, { color: colors.foreground }]}>
          Available Rewards (Preview)
        </Text>

        {rewards.map((reward) => {
          const iconColor = catColors[reward.category];
          return (
            <Card key={reward.id} style={styles.rewardCard} variant="outlined">
              <View style={styles.rewardRow}>
                <View style={[styles.rewardIcon, { backgroundColor: iconColor + "18" }]}>
                  <Feather name={CATEGORY_ICONS[reward.category]} size={22} color={iconColor} />
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <View style={styles.rewardHeader}>
                    <Text style={[styles.rewardTitle, { color: colors.foreground }]}>
                      {reward.title}
                    </Text>
                    {reward.redeemed && (
                      <Badge label="Redeemed" variant="success" size="sm" />
                    )}
                  </View>
                  <Text style={[styles.rewardDesc, { color: colors.mutedForeground }]}>
                    {reward.description}
                  </Text>
                  <View style={styles.rewardMeta}>
                    <View style={[styles.costChip, { backgroundColor: colors.xpGold + "18" }]}>
                      <Feather name="star" size={10} color={colors.xpGold} />
                      <Text style={[styles.costText, { color: colors.xpGold }]}>
                        {reward.cost} XP
                      </Text>
                    </View>
                    <Text style={[styles.catLabel, { color: iconColor }]}>
                      {reward.category.charAt(0).toUpperCase() + reward.category.slice(1)}
                    </Text>
                  </View>
                </View>
              </View>
              {!reward.redeemed && reward.available && (
                <Pressable
                  style={[
                    styles.redeemBtn,
                    {
                      backgroundColor:
                        (user?.totalPoints ?? 0) >= reward.cost
                          ? colors.primary
                          : colors.muted,
                    },
                  ]}
                  onPress={() => handleRedeem(reward.id, reward.cost, reward.title)}
                >
                  <Text
                    style={[
                      styles.redeemBtnText,
                      {
                        color:
                          (user?.totalPoints ?? 0) >= reward.cost
                            ? "#fff"
                            : colors.mutedForeground,
                      },
                    ]}
                  >
                    {(user?.totalPoints ?? 0) >= reward.cost ? "Redeem" : "Not enough XP"}
                  </Text>
                </Pressable>
              )}
            </Card>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  xpChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  xpText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  content: { padding: 16, gap: 12 },
  pointsCard: {
    borderRadius: 16,
    padding: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  pointsLabel: { color: "rgba(255,255,255,0.75)", fontSize: 12, fontFamily: "Inter_400Regular" },
  pointsValue: { color: "#fff", fontSize: 28, fontFamily: "Inter_700Bold" },
  pointsSub: { color: "rgba(255,255,255,0.75)", fontSize: 12, fontFamily: "Inter_400Regular" },
  sectionLabel: { fontSize: 17, fontFamily: "Inter_700Bold" },
  rewardCard: { gap: 12 },
  comingSoonBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 4,
  },
  comingSoonIconWrap: {
    width: 38, height: 38, borderRadius: 12,
    alignItems: "center", justifyContent: "center",
  },
  comingSoonTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  comingSoonSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  rewardRow: { flexDirection: "row", alignItems: "flex-start" },
  rewardIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  rewardHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 },
  rewardTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", flex: 1 },
  rewardDesc: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18, marginBottom: 8 },
  rewardMeta: { flexDirection: "row", alignItems: "center", gap: 8 },
  costChip: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  costText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  catLabel: { fontSize: 11, fontFamily: "Inter_500Medium" },
  redeemBtn: { borderRadius: 10, padding: 12, alignItems: "center" },
  redeemBtnText: { fontSize: 14, fontFamily: "Inter_700Bold" },
});
