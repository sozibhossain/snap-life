import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React, { useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { SectionHeader } from "@/components/SectionHeader";
import { SystemicCoachingTab } from "@/components/community/SystemicCoachingTab";
import { ExpertSupportTab } from "@/components/community/ExpertSupportTab";
import { ReferFriendCard } from "@/components/ReferFriendCard";
import { useGamification } from "@/context/GamificationContext";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";

const TABS = ["Leaderboard", "Progress", "Coaching", "Experts"];

export default function CommunityScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { leaderboard, achievements, challenges, completChallenge } =
    useGamification();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState(0);
  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const weeklyC = challenges.filter((c) => c.type === "weekly");
  const dailyC = challenges.filter((c) => c.type === "daily");
  const earned = achievements.filter((a) => a.earned);
  const upcoming = achievements.filter((a) => !a.earned);

  const otherUsers = leaderboard.filter((e) => !e.isCurrentUser);
  const myEntry = leaderboard.find((e) => e.isCurrentUser);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <LinearGradient
        colors={colors.gradients.warmth}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.topBar, { paddingTop: topPadding + 10 }, colors.shadows.sm]}
      >
        <Text style={styles.screenTitle}>Community</Text>
        <View style={styles.pointsChip}>
          <Feather name="star" size={12} color="#fff" />
          <Text style={styles.pointsText}>
            {user?.totalPoints.toLocaleString()} pts
          </Text>
        </View>
      </LinearGradient>

      {/* Fixed tab row — all 4 tabs always visible, no horizontal scroll needed */}
      <View style={[styles.tabRow, { borderBottomColor: colors.border }]}>
        {TABS.map((tab, i) => (
          <Pressable
            key={tab}
            onPress={() => setActiveTab(i)}
            style={[styles.tabItem, activeTab === i && styles.tabItemActive]}
          >
            <Text
              style={[
                styles.tabText,
                {
                  color: activeTab === i ? colors.primary : colors.mutedForeground,
                  fontFamily: activeTab === i ? "Inter_600SemiBold" : "Inter_400Regular",
                },
              ]}
            >
              {tab}
            </Text>
            {activeTab === i && (
              <View style={[styles.tabIndicator, { backgroundColor: colors.primary }]} />
            )}
          </Pressable>
        ))}
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: bottomPad + 84 },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── LEADERBOARD ─────────────────────────────────────────────────── */}
        {activeTab === 0 && (
          <View>
            {/* Current user's rank card — always shown */}
            <Card style={styles.myRankCard} variant="elevated">
              <View style={styles.myRankRow}>
                <View style={[styles.rankBadge, { backgroundColor: colors.primary }]}>
                  <Text style={styles.rankNumber}>
                    {myEntry?.rank ?? 1}
                  </Text>
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={[styles.myRankTitle, { color: colors.foreground }]}>
                    Your Rank
                  </Text>
                  <Text style={[styles.myRankSub, { color: colors.mutedForeground }]}>
                    {otherUsers.length === 0
                      ? "You're leading the way!"
                      : `Top ${Math.round(((myEntry?.rank ?? 1) / leaderboard.length) * 100)}% this month`}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={[styles.myXP, { color: colors.primary }]}>
                    {(user?.totalPoints ?? 0).toLocaleString()}
                  </Text>
                  <Text style={[styles.myXPLabel, { color: colors.mutedForeground }]}>
                    total XP
                  </Text>
                </View>
              </View>
            </Card>

            {otherUsers.length === 0 ? (
              /* Empty state — launch-ready, no fake users */
              <Card variant="outlined" style={styles.emptyCard}>
                <View style={[styles.emptyIconWrap, { backgroundColor: colors.primary + "15" }]}>
                  <Feather name="users" size={28} color={colors.primary} />
                </View>
                <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                  Be first on the board
                </Text>
                <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
                  The leaderboard fills up as more members join and earn XP. Invite
                  friends to get the community going!
                </Text>
              </Card>
            ) : (
              otherUsers.map((entry) => {
                const medal =
                  entry.rank === 1
                    ? colors.xpGold
                    : entry.rank === 2
                    ? "#94a3b8"
                    : entry.rank === 3
                    ? "#cd7c40"
                    : null;
                return (
                  <View
                    key={entry.userId}
                    style={[
                      styles.leaderRow,
                      {
                        backgroundColor: entry.isCurrentUser
                          ? colors.primary + "10"
                          : colors.card,
                        borderColor: entry.isCurrentUser
                          ? colors.primary + "30"
                          : colors.border,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.rankCircle,
                        { backgroundColor: medal ? medal + "22" : colors.muted },
                      ]}
                    >
                      <Text style={[styles.rankNum, { color: medal ?? colors.mutedForeground }]}>
                        {entry.rank}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.leaderAvatar,
                        { backgroundColor: entry.isCurrentUser ? colors.primary : colors.accent },
                      ]}
                    >
                      <Text style={styles.leaderAvatarText}>
                        {entry.name.charAt(0)}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.leaderName, { color: colors.foreground }]}>
                        {entry.name}{entry.isCurrentUser ? " (You)" : ""}
                      </Text>
                      <Text style={[styles.leaderLevel, { color: colors.mutedForeground }]}>
                        Level {entry.level}
                      </Text>
                    </View>
                    <Text style={[styles.leaderXP, { color: colors.primary }]}>
                      {entry.xp.toLocaleString()} XP
                    </Text>
                  </View>
                );
              })
            )}

            <View style={styles.spacing} />
            <SectionHeader title="Grow our Community" />
            <ReferFriendCard />
          </View>
        )}

        {/* ── PROGRESS (Challenges + Achievements combined) ────────────── */}
        {activeTab === 1 && (
          <View>
            <SectionHeader title="Daily Challenges" />
            {dailyC.map((c) => (
              <Card key={c.id} style={styles.challengeCard} variant="outlined">
                <View style={styles.challengeHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.challengeTitle, { color: colors.foreground }]}>
                      {c.title}
                    </Text>
                    <Text style={[styles.challengeDesc, { color: colors.mutedForeground }]}>
                      {c.description}
                    </Text>
                  </View>
                  <Badge
                    label={c.completed ? "Done" : `+${c.xpReward} XP`}
                    variant={c.completed ? "success" : "accent"}
                    size="sm"
                  />
                </View>
                <View style={[styles.progressTrack, { backgroundColor: colors.muted }]}>
                  <View
                    style={[
                      styles.progressFill,
                      {
                        width: `${Math.min((c.progress / c.target) * 100, 100)}%` as any,
                        backgroundColor: c.completed ? colors.success : colors.primary,
                      },
                    ]}
                  />
                </View>
                <View style={styles.progressLabelRow}>
                  <Text style={[styles.progressLabel, { color: colors.mutedForeground }]}>
                    {c.progress.toLocaleString()} / {c.target.toLocaleString()}
                  </Text>
                  {!c.completed && (
                    <Pressable
                      onPress={() => completChallenge(c.id)}
                      style={[styles.markDoneBtn, { backgroundColor: colors.primary + "18" }]}
                    >
                      <Text style={[styles.markDoneText, { color: colors.primary }]}>
                        Mark done
                      </Text>
                    </Pressable>
                  )}
                </View>
              </Card>
            ))}

            <View style={styles.spacing} />
            <SectionHeader title="Weekly Challenges" />
            {weeklyC.map((c) => (
              <Card key={c.id} style={styles.challengeCard} variant="outlined">
                <View style={styles.challengeHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.challengeTitle, { color: colors.foreground }]}>
                      {c.title}
                    </Text>
                    <Text style={[styles.challengeDesc, { color: colors.mutedForeground }]}>
                      {c.description}
                    </Text>
                  </View>
                  <Badge
                    label={c.completed ? "Done" : `+${c.xpReward} XP`}
                    variant={c.completed ? "success" : "accent"}
                    size="sm"
                  />
                </View>
                <View style={[styles.progressTrack, { backgroundColor: colors.muted }]}>
                  <View
                    style={[
                      styles.progressFill,
                      {
                        width: `${Math.min((c.progress / c.target) * 100, 100)}%` as any,
                        backgroundColor: c.completed ? colors.success : colors.accent,
                      },
                    ]}
                  />
                </View>
                <View style={styles.progressLabelRow}>
                  <Text style={[styles.progressLabel, { color: colors.mutedForeground }]}>
                    {c.progress.toLocaleString()} / {c.target.toLocaleString()}
                  </Text>
                  <Text style={[styles.progressLabel, { color: colors.mutedForeground }]}>
                    Expires{" "}
                    {new Date(c.expiresAt).toLocaleDateString("en-GB", {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                      ...(user?.timezone ? { timeZone: user.timezone } : {}),
                    })}
                  </Text>
                </View>
              </Card>
            ))}

            <View style={styles.divider} />

            <SectionHeader title={`Achievements — Earned (${earned.length})`} />
            {earned.length === 0 && (
              <Text style={[styles.emptyHint, { color: colors.mutedForeground }]}>
                Complete challenges to earn your first achievement.
              </Text>
            )}
            {earned.map((a) => (
              <Card key={a.id} style={styles.achievementCard} variant="outlined">
                <View style={[styles.achievementIconWrap, { backgroundColor: colors.success + "18" }]}>
                  <Feather name={a.icon as any} size={20} color={colors.success} />
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={[styles.achievementTitle, { color: colors.foreground }]}>
                    {a.title}
                  </Text>
                  <Text style={[styles.achievementDesc, { color: colors.mutedForeground }]}>
                    {a.description}
                  </Text>
                  {a.earnedAt && (
                    <Text style={[styles.earnedAt, { color: colors.success }]}>
                      Earned{" "}
                      {new Date(a.earnedAt).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                        ...(user?.timezone ? { timeZone: user.timezone } : {}),
                      })}
                    </Text>
                  )}
                </View>
                <Badge label={`+${a.xpReward}`} variant="success" size="sm" />
              </Card>
            ))}

            <View style={styles.spacing} />
            <SectionHeader title={`In Progress (${upcoming.length})`} />
            {upcoming.map((a) => (
              <Card key={a.id} style={styles.achievementCard} variant="outlined">
                <View style={[styles.achievementIconWrap, { backgroundColor: colors.muted }]}>
                  <Feather name={a.icon as any} size={20} color={colors.mutedForeground} />
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={[styles.achievementTitle, { color: colors.foreground }]}>
                    {a.title}
                  </Text>
                  <Text style={[styles.achievementDesc, { color: colors.mutedForeground }]}>
                    {a.description}
                  </Text>
                  {a.progress !== undefined && a.target && (
                    <View>
                      <View style={[styles.progressTrack, { backgroundColor: colors.muted, marginTop: 8 }]}>
                        <View
                          style={[
                            styles.progressFill,
                            {
                              width: `${Math.min((a.progress / a.target) * 100, 100)}%` as any,
                              backgroundColor: colors.primary,
                            },
                          ]}
                        />
                      </View>
                      <Text style={[styles.progressLabel, { color: colors.mutedForeground, marginTop: 2 }]}>
                        {a.progress.toLocaleString()} / {a.target.toLocaleString()}
                      </Text>
                    </View>
                  )}
                </View>
                <Badge label={`+${a.xpReward} XP`} variant="default" size="sm" />
              </Card>
            ))}
          </View>
        )}

        {/* ── COACHING ────────────────────────────────────────────────────── */}
        {activeTab === 2 && <SystemicCoachingTab />}

        {/* ── EXPERTS ─────────────────────────────────────────────────────── */}
        {activeTab === 3 && <ExpertSupportTab />}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  screenTitle: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    color: "#fff",
    letterSpacing: -0.2,
    flex: 1,
  },
  pointsChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.18)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
  },
  pointsText: { fontSize: 13, fontFamily: "Inter_700Bold", color: "#fff" },

  /* Tab bar — fixed row, all tabs always visible */
  tabRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    paddingHorizontal: 4,
  },
  tabItem: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 2,
  },
  tabItemActive: {},
  tabText: { fontSize: 13, textAlign: "center" },
  tabIndicator: { height: 2, borderRadius: 1, marginTop: 4, width: "60%" },

  scrollContent: { paddingHorizontal: 16, paddingTop: 12 },

  /* Leaderboard */
  myRankCard: { marginBottom: 12 },
  myRankRow: { flexDirection: "row", alignItems: "center" },
  rankBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  rankNumber: { color: "#fff", fontSize: 18, fontFamily: "Inter_700Bold" },
  myRankTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  myRankSub: { fontSize: 12, fontFamily: "Inter_400Regular" },
  myXP: { fontSize: 18, fontFamily: "Inter_700Bold" },
  myXPLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },

  /* Empty leaderboard state */
  emptyCard: {
    alignItems: "center",
    paddingVertical: 32,
    paddingHorizontal: 24,
    marginBottom: 16,
  },
  emptyIconWrap: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  emptyTitle: { fontSize: 17, fontFamily: "Inter_700Bold", marginBottom: 8, textAlign: "center" },
  emptyBody: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 19 },

  leaderRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
    gap: 10,
  },
  rankCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  rankNum: { fontSize: 13, fontFamily: "Inter_700Bold" },
  leaderAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  leaderAvatarText: { color: "#fff", fontSize: 15, fontFamily: "Inter_700Bold" },
  leaderName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  leaderLevel: { fontSize: 12, fontFamily: "Inter_400Regular" },
  leaderXP: { fontSize: 14, fontFamily: "Inter_700Bold" },

  /* Challenges */
  challengeCard: { marginBottom: 10 },
  challengeHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginBottom: 10,
  },
  challengeTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  challengeDesc: { fontSize: 12, fontFamily: "Inter_400Regular" },
  progressTrack: { height: 4, borderRadius: 2, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 2 },
  progressLabelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 4,
  },
  progressLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  markDoneBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  markDoneText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },

  /* Achievements */
  divider: { height: 1, marginVertical: 20 },
  emptyHint: { fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 12, textAlign: "center" },
  achievementCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 10,
    padding: 14,
  },
  achievementIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  achievementTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  achievementDesc: { fontSize: 12, fontFamily: "Inter_400Regular" },
  earnedAt: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 4 },

  spacing: { height: 12 },
});
