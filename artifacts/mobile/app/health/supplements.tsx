import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import React, { useState } from "react";
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
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { useHealth, type Supplement } from "@/context/HealthContext";
import { useColors } from "@/hooks/useColors";

// ─── Helpers ───────────────────────────────────────────────────────────────

function consistencyLabel(pct: number): string {
  if (pct >= 90) return "Excellent";
  if (pct >= 70) return "Good";
  if (pct >= 50) return "Building";
  return "Getting started";
}

// ─── Single intake row ─────────────────────────────────────────────────────

function IntakeRow({
  item,
  onMark,
  onRemove,
  onMissed,
}: {
  item: Supplement;
  onMark: () => void;
  onRemove: () => void;
  onMissed: () => void;
}) {
  const colors = useColors();
  const isMed = item.category === "medication";
  const accentColor = isMed ? colors.accent : colors.primary;

  return (
    <Card variant="outlined" style={styles.rowCard}>
      <View style={styles.rowMain}>
        {/* Check button */}
        <Pressable
          onPress={() => !item.taken && onMark()}
          hitSlop={4}
          style={[
            styles.checkCircle,
            {
              backgroundColor: item.taken ? accentColor : "transparent",
              borderColor: item.taken ? accentColor : colors.border,
            },
          ]}
        >
          {item.taken && <Feather name="check" size={15} color="#fff" />}
        </Pressable>

        {/* Info */}
        <View style={{ flex: 1, marginLeft: 12 }}>
          <View style={styles.nameRow}>
            <Text
              style={[
                styles.itemName,
                {
                  color: item.taken ? colors.mutedForeground : colors.foreground,
                  textDecorationLine: item.taken ? "line-through" : "none",
                },
              ]}
              numberOfLines={1}
            >
              {item.name}
            </Text>
            {isMed && (
              <View
                style={[
                  styles.medPill,
                  { backgroundColor: colors.accent + "18", borderColor: colors.accent + "40" },
                ]}
              >
                <Text style={[styles.medPillText, { color: colors.accent }]}>Rx</Text>
              </View>
            )}
          </View>
          <Text style={[styles.itemMeta, { color: colors.mutedForeground }]}>
            {item.dose}
            {item.frequency ? ` · ${item.frequency}` : ""}
            {item.timing ? ` · ${item.timing}` : ""}
          </Text>
        </View>

        {/* Status / action */}
        <View style={styles.rowRight}>
          {item.taken ? (
            <Badge label={`${item.takenAt ?? "Taken"}`} variant="success" size="sm" />
          ) : (
            <View style={{ gap: 5 }}>
              <Pressable
                style={[styles.markBtn, { backgroundColor: accentColor }]}
                onPress={onMark}
              >
                <Text style={styles.markBtnText}>Mark taken</Text>
              </Pressable>
              {isMed && (
                <Pressable onPress={onMissed}>
                  <Text style={[styles.missedText, { color: colors.destructive }]}>Mark missed</Text>
                </Pressable>
              )}
            </View>
          )}
          <Pressable
            onPress={onRemove}
            hitSlop={8}
            style={styles.removeBtn}
          >
            <Feather name="trash-2" size={14} color={colors.destructive + "80"} />
          </Pressable>
        </View>
      </View>
    </Card>
  );
}

// ─── Screen ────────────────────────────────────────────────────────────────

export default function SupplementsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { supplements, markSupplementTaken, markMedicationMissed, removeSupplement } = useHealth();

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const [filter, setFilter] = useState<"all" | "supplement" | "medication">("all");

  const suppList = supplements.filter((s) => s.category === "supplement");
  const medList = supplements.filter((s) => s.category === "medication");
  const total = supplements.length;
  const taken = supplements.filter((s) => s.taken).length;
  const suppTaken = suppList.filter((s) => s.taken).length;
  const medTaken = medList.filter((s) => s.taken).length;

  const consistencyPct = total > 0 ? Math.round((taken / total) * 100) : 0;

  const visibleSupp = filter === "medication" ? [] : suppList;
  const visibleMed = filter === "supplement" ? [] : medList;

  async function handleMark(id: string) {
    await markSupplementTaken(id);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  function handleRemove(item: Supplement) {
    Alert.alert(
      "Remove from intake",
      `Remove "${item.name}" from your daily intake list?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => removeSupplement(item.id),
        },
      ]
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View
        style={[
          styles.header,
          {
            paddingTop: topPad + 8,
            borderBottomColor: colors.border,
            backgroundColor: colors.card,
          },
        ]}
      >
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>
          Today's Intake
        </Text>
        <Pressable
          style={[styles.addBtnHeader, { backgroundColor: colors.primary }]}
          onPress={() => router.push("/health/add-supplement" as never)}
        >
          <Feather name="plus" size={16} color="#fff" />
          <Text style={styles.addBtnHeaderText}>Add</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ─── Progress summary ─── */}
        <View
          style={[
            styles.summaryCard,
            {
              backgroundColor: colors.success + "10",
              borderColor: colors.success + "28",
            },
          ]}
        >
          <View style={styles.summaryTop}>
            <View>
              <Text style={[styles.summaryCount, { color: colors.foreground }]}>
                {taken} / {total}
              </Text>
              <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>
                taken today
              </Text>
            </View>
            <View style={styles.summaryRight}>
              <Text style={[styles.consistencyPct, { color: colors.success }]}>
                {consistencyPct}%
              </Text>
              <Text style={[styles.consistencyLabel, { color: colors.mutedForeground }]}>
                {consistencyLabel(consistencyPct)}
              </Text>
            </View>
          </View>
          <View style={[styles.progressTrack, { backgroundColor: colors.muted }]}>
            <View
              style={[
                styles.progressFill,
                {
                  width: `${total > 0 ? (taken / total) * 100 : 0}%` as any,
                  backgroundColor: colors.success,
                },
              ]}
            />
          </View>
          {suppList.length > 0 && medList.length > 0 && (
            <View style={styles.splitRow}>
              <Text style={[styles.splitLabel, { color: colors.mutedForeground }]}>
                <Text style={{ color: colors.primary }}>●</Text>
                {" "}Supplements {suppTaken}/{suppList.length}
              </Text>
              <Text style={[styles.splitLabel, { color: colors.mutedForeground }]}>
                <Text style={{ color: colors.accent }}>●</Text>
                {" "}Medications {medTaken}/{medList.length}
              </Text>
            </View>
          )}
        </View>

        {/* ─── Filter pills ─── */}
        {suppList.length > 0 && medList.length > 0 && (
          <View style={styles.filterRow}>
            {(["all", "supplement", "medication"] as const).map((f) => (
              <Pressable
                key={f}
                style={[
                  styles.filterPill,
                  {
                    backgroundColor:
                      filter === f
                        ? (f === "medication" ? colors.accent : colors.primary) + "18"
                        : colors.muted,
                    borderColor:
                      filter === f
                        ? (f === "medication" ? colors.accent : colors.primary)
                        : "transparent",
                    borderWidth: 1.5,
                  },
                ]}
                onPress={() => setFilter(f)}
              >
                <Text
                  style={[
                    styles.filterPillText,
                    {
                      color:
                        filter === f
                          ? f === "medication"
                            ? colors.accent
                            : colors.primary
                          : colors.mutedForeground,
                    },
                  ]}
                >
                  {f === "all" ? "All" : f === "supplement" ? "Supplements" : "Medications"}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        {/* ─── Supplements group ─── */}
        {visibleSupp.length > 0 && (
          <>
            <View style={styles.groupHeader}>
              <View
                style={[
                  styles.groupIconBadge,
                  { backgroundColor: colors.primary + "18" },
                ]}
              >
                <Feather name="sun" size={13} color={colors.primary} />
              </View>
              <Text style={[styles.groupTitle, { color: colors.foreground }]}>
                Supplements
              </Text>
              <Text style={[styles.groupCount, { color: colors.mutedForeground }]}>
                {suppTaken}/{suppList.length}
              </Text>
            </View>
            {visibleSupp.map((s) => (
              <IntakeRow
                key={s.id}
                item={s}
                onMark={() => handleMark(s.id)}
                onMissed={() => undefined}
                onRemove={() => handleRemove(s)}
              />
            ))}
          </>
        )}

        {/* ─── Medications group ─── */}
        {visibleMed.length > 0 && (
          <>
            <View style={[styles.groupHeader, { marginTop: visibleSupp.length > 0 ? 8 : 0 }]}>
              <View
                style={[
                  styles.groupIconBadge,
                  { backgroundColor: colors.accent + "18" },
                ]}
              >
                <Feather name="activity" size={13} color={colors.accent} />
              </View>
              <Text style={[styles.groupTitle, { color: colors.foreground }]}>
                Medications
              </Text>
              <Text style={[styles.groupCount, { color: colors.mutedForeground }]}>
                {medTaken}/{medList.length}
              </Text>
            </View>
            {visibleMed.map((m) => (
              <IntakeRow
                key={m.id}
                item={m}
                onMark={() => handleMark(m.id)}
                onMissed={() => markMedicationMissed(m.id)}
                onRemove={() => handleRemove(m)}
              />
            ))}
          </>
        )}

        {/* Empty state */}
        {total === 0 && (
          <View style={styles.emptyState}>
            <Feather name="plus-circle" size={44} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
              Nothing added yet
            </Text>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              Tap "Add" to build your daily supplement and medication checklist.
            </Text>
            <Pressable
              style={[styles.emptyBtn, { backgroundColor: colors.primary }]}
              onPress={() => router.push("/health/add-supplement" as never)}
            >
              <Feather name="plus" size={16} color="#fff" />
              <Text style={styles.emptyBtnText}>Add your first item</Text>
            </Pressable>
          </View>
        )}

        {/* ─── Bone health tip ─── */}
        {total > 0 && (
          <View
            style={[
              styles.infoCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Feather name="info" size={15} color={colors.primary} />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={[styles.infoTitle, { color: colors.foreground }]}>
                Bone Health Tip
              </Text>
              <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
                Take calcium with meals for better absorption. Vitamin D3 helps your
                body use calcium effectively. Space calcium doses 2–3 hours apart if
                taking more than 500 mg per day. Always follow your healthcare
                provider's instructions for any prescribed medications.
              </Text>
            </View>
          </View>
        )}

        {/* ─── Add CTA (if items exist) ─── */}
        {total > 0 && (
          <Pressable
            style={[
              styles.addCta,
              { borderColor: colors.primary + "50", backgroundColor: colors.primary + "08" },
            ]}
            onPress={() => router.push("/health/add-supplement" as never)}
          >
            <Feather name="plus-circle" size={16} color={colors.primary} />
            <Text style={[styles.addCtaText, { color: colors.primary }]}>
              Add supplement or medication
            </Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 18, fontFamily: "Inter_700Bold", flex: 1, marginLeft: 12 },
  addBtnHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
  },
  addBtnHeaderText: { color: "#fff", fontSize: 13, fontFamily: "Inter_700Bold" },
  content: { padding: 16, gap: 10 },
  summaryCard: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    gap: 10,
  },
  summaryTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  summaryCount: { fontSize: 26, fontFamily: "Inter_700Bold" },
  summaryLabel: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  summaryRight: { alignItems: "flex-end" },
  consistencyPct: { fontSize: 20, fontFamily: "Inter_700Bold" },
  consistencyLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  progressTrack: { height: 5, borderRadius: 3, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 3 },
  splitRow: { flexDirection: "row", justifyContent: "space-between" },
  splitLabel: { fontSize: 12, fontFamily: "Inter_400Regular" },
  filterRow: { flexDirection: "row", gap: 8 },
  filterPill: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20 },
  filterPillText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  groupHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 2,
    marginTop: 4,
  },
  groupIconBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  groupTitle: { fontSize: 14, fontFamily: "Inter_700Bold", flex: 1 },
  groupCount: { fontSize: 12, fontFamily: "Inter_400Regular" },
  rowCard: { marginBottom: 0 },
  rowMain: { flexDirection: "row", alignItems: "center" },
  checkCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  itemName: { fontSize: 14, fontFamily: "Inter_600SemiBold", flex: 1 },
  medPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    borderWidth: 1,
  },
  medPillText: { fontSize: 9, fontFamily: "Inter_700Bold", letterSpacing: 0.4 },
  itemMeta: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  rowRight: { alignItems: "flex-end", gap: 6 },
  markBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  markBtnText: { color: "#fff", fontSize: 11, fontFamily: "Inter_700Bold" },
  missedText: { fontSize: 10, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  removeBtn: { padding: 2 },
  emptyState: { alignItems: "center", paddingVertical: 48, gap: 12 },
  emptyTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  emptyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 4,
  },
  emptyBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_700Bold" },
  infoCard: {
    flexDirection: "row",
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 4,
  },
  infoTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginBottom: 4 },
  infoText: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
  addCta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: 1.5,
    marginTop: 4,
  },
  addCtaText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
