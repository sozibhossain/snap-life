import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useRef, useState } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewToken,
} from "react-native";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { useGamification } from "@/context/GamificationContext";
import { logInteractionEvent } from "@/lib/events";

interface SnapShotItem {
  id: string;
  emoji: string;
  headline: string;
  body: string;
  tag: string;
  tagColor: string;
}

const SNAP_SHOTS: SnapShotItem[] = [
  {
    id: "ss1",
    emoji: "🥛",
    headline: "Calcium & Vitamin D: The Dynamic Duo",
    body: "Vitamin D helps your body absorb calcium. Without enough D, up to 60% of your calcium intake is wasted. Aim for 800–1000 IU daily.",
    tag: "Nutrition",
    tagColor: "#0ea5e9",
  },
  {
    id: "ss2",
    emoji: "🐟",
    headline: "Oily Fish: Nature's Bone Builder",
    body: "Salmon, sardines, and mackerel are rich in vitamin D and omega-3s, both of which are linked to higher bone density in older adults.",
    tag: "Fuel",
    tagColor: "#14b8a6",
  },
  {
    id: "ss3",
    emoji: "🧘",
    headline: "Stress Steals Your Bones",
    body: "Cortisol, your stress hormone, actively inhibits bone formation. Even 10 minutes of daily breathwork can significantly lower cortisol levels.",
    tag: "Calm",
    tagColor: "#8b5cf6",
  },
  {
    id: "ss4",
    emoji: "💪",
    headline: "Weight-Bearing Wins",
    body: "Walking, dancing, and strength training signal your body to build more bone. Just 30 minutes of weight-bearing activity, 5 days a week, can slow bone loss by 1–3% annually.",
    tag: "Activity",
    tagColor: "#f59e0b",
  },
  {
    id: "ss5",
    emoji: "🥦",
    headline: "Hidden Calcium Champions",
    body: "Kale, bok choy, and broccoli have calcium that's actually more absorbable than cow's milk — up to 61% bioavailability vs. 32% for dairy.",
    tag: "Nutrition",
    tagColor: "#22c55e",
  },
  {
    id: "ss6",
    emoji: "☀️",
    headline: "The Sunshine Vitamin",
    body: "Just 15–20 minutes of midday sun on arms and legs can produce 1,000–2,000 IU of vitamin D. In winter, supplementation is recommended for most people.",
    tag: "Vitamin D",
    tagColor: "#f59e0b",
  },
];

export function SnapShot() {
  const colors = useColors();
  const { user } = useAuth();
  const { refreshProgress } = useGamification();
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const viewedThisMount = useRef(new Set<string>());
  const recordTipRef = useRef<(id: string) => void>(() => {});

  recordTipRef.current = (id: string) => {
    if (viewedThisMount.current.has(id)) return;
    viewedThisMount.current.add(id);
    void (async () => {
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const key = `snap_tip_reads:${user?.id ?? "anon"}:${today}`;
      try {
        const raw = await AsyncStorage.getItem(key);
        const existing = raw ? JSON.parse(raw) as string[] : [];
        const next = [...new Set([...(Array.isArray(existing) ? existing : []), id])];
        await AsyncStorage.setItem(key, JSON.stringify(next));
        logInteractionEvent({
          appUserId: user?.id,
          kind: "snap_shot_read",
          payload: { tipId: id },
        });
        await refreshProgress();
      } catch {
        // Reading a tip must remain available even if local persistence fails.
      }
    })();
  };

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: Array<ViewToken<SnapShotItem>> }) => {
      for (const token of viewableItems) {
        if (token.isViewable && token.item?.id) recordTipRef.current(token.item.id);
      }
    },
  ).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60, minimumViewTime: 800 }).current;

  function toggleSave(id: string) {
    setSaved((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <View>
      <FlatList
        data={SNAP_SHOTS}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        keyExtractor={(item) => item.id}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        renderItem={({ item }) => (
          <View
            style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <View style={styles.topRow}>
              <View style={[styles.tagChip, { backgroundColor: item.tagColor + "18" }]}>
                <Text style={[styles.tagText, { color: item.tagColor }]}>{item.tag}</Text>
              </View>
              <Pressable onPress={() => toggleSave(item.id)}>
                <Feather
                  name="bookmark"
                  size={16}
                  color={saved.has(item.id) ? item.tagColor : colors.mutedForeground}
                />
              </Pressable>
            </View>
            <Text style={styles.emoji}>{item.emoji}</Text>
            <Text style={[styles.headline, { color: colors.foreground }]}>
              {item.headline}
            </Text>
            <Text style={[styles.body, { color: colors.mutedForeground }]}>
              {item.body}
            </Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 16, paddingBottom: 4, gap: 12 },
  card: {
    width: 240,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    gap: 8,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  tagChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
  },
  tagText: { fontSize: 10, fontFamily: "Inter_700Bold" },
  emoji: { fontSize: 28 },
  headline: { fontSize: 14, fontFamily: "Inter_700Bold", lineHeight: 19 },
  body: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
});
