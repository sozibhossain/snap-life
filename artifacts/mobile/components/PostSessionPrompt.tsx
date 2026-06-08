import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "@snaplife/postSessionPromptCount/v1";
// Show the prompt every Nth session so it stays light-touch and non-intrusive.
const SHOW_EVERY_N = 3;

interface Props {
  /** Called when user picks Yes. Should typically navigate to feedback?type=testimonial */
  onYes: () => void;
  /** Called when user picks Not really. Should typically navigate to feedback?type=general */
  onNo: () => void;
  /** Called when user dismisses or after a Yes/No tap completes. */
  onDismiss?: () => void;
  /** Visual accent (defaults to neutral on dark backgrounds). */
  accent?: string;
}

/**
 * Light-touch sentiment prompt rendered on completion screens. Shown only
 * every Nth completed session — never blocks the main flow, and the count is
 * persisted across sessions so the rhythm survives restarts.
 *
 * Returns null if it's not the right session number, so callers can mount it
 * unconditionally without measuring layout.
 */
export function PostSessionPrompt({ onYes, onNo, onDismiss, accent = "#3ABBD4" }: Props) {
  const [shouldShow, setShouldShow] = useState<boolean | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = (await AsyncStorage.getItem(STORAGE_KEY)) ?? "0";
        const next = parseInt(raw, 10) + 1;
        await AsyncStorage.setItem(STORAGE_KEY, String(next));
        if (!cancelled) setShouldShow(next % SHOW_EVERY_N === 0);
      } catch {
        if (!cancelled) setShouldShow(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!shouldShow || dismissed) return null;

  function handle(action: () => void) {
    setDismissed(true);
    action();
    onDismiss?.();
  }

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={() => {
          setDismissed(true);
          onDismiss?.();
        }}
        hitSlop={8}
        style={styles.dismissBtn}
      >
        <Feather name="x" size={14} color="rgba(255,255,255,0.6)" />
      </Pressable>
      <Text style={styles.title}>Enjoying this experience?</Text>
      <View style={styles.row}>
        <Pressable
          style={[styles.btn, { backgroundColor: accent }]}
          onPress={() => handle(onYes)}
        >
          <Feather name="thumbs-up" size={13} color="#0f172a" />
          <Text style={[styles.btnText, { color: "#0f172a" }]}>Yes</Text>
        </Pressable>
        <Pressable
          style={[styles.btn, { backgroundColor: "rgba(255,255,255,0.12)" }]}
          onPress={() => handle(onNo)}
        >
          <Feather name="message-square" size={13} color="#fff" />
          <Text style={[styles.btnText, { color: "#fff" }]}>Not really</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Useful wrapper that wires the Yes/No buttons to the feedback screen with the
 * right `type=` query param. Use inside reflection screens on dark backgrounds.
 */
export function PostSessionPromptCard({ accent }: { accent?: string }) {
  const router = useRouter();
  return (
    <PostSessionPrompt
      accent={accent}
      onYes={() => router.push({ pathname: "/feedback", params: { type: "testimonial" } } as any)}
      onNo={() => router.push({ pathname: "/feedback", params: { type: "general" } } as any)}
    />
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: "100%",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 14,
    padding: 14,
    paddingTop: 12,
    gap: 10,
    alignItems: "center",
    position: "relative",
  },
  dismissBtn: {
    position: "absolute",
    top: 6,
    right: 6,
    padding: 6,
  },
  title: {
    color: "#fff",
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
  },
  row: { flexDirection: "row", gap: 8, alignSelf: "stretch" },
  btn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
  },
  btnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
