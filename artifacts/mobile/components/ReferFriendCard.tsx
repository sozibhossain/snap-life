/**
 * ReferFriendCard
 *
 * Displays a "Refer a Friend" card on the Profile screen. On first render
 * it fetches (or lazy-creates) the user's referral code from GET /api/referral,
 * then lets them share it via the native Share sheet.
 *
 * When a referred friend signs up and uses the code, the referrer earns 250 XP
 * (processed server-side). The card shows the code and a share button.
 */

import { Feather } from "@expo/vector-icons";
import { useClerk } from "@clerk/expo";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Card } from "@/components/ui/Card";
import { useColors } from "@/hooks/useColors";
import { resolveApiBase } from "@/lib/serverIdentity";

const REFERRAL_XP = 250;

export function ReferFriendCard() {
  const colors = useColors();
  const { session } = useClerk();
  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState(false);

  const fetchCode = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const token = await session?.getToken();
      const base = resolveApiBase() ?? "";
      const res = await fetch(`${base}/api/referral`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { code: string };
      setCode(data.code);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    void fetchCode();
  }, [fetchCode]);

  async function handleShare() {
    if (!code || sharing) return;
    setSharing(true);
    try {
      const link = `https://snaplife.co.uk/join?ref=${code}`;
      const message =
        `I've been using SNAP Life to track and improve my bone health — it's brilliant! ` +
        `Join me with my referral code ${code} and we both benefit. ` +
        `Download the app here: ${link}`;
      if (Platform.OS === "web") {
        if (navigator.clipboard) {
          await navigator.clipboard.writeText(link);
          Alert.alert("Copied!", "Your referral link has been copied to the clipboard.");
        }
      } else {
        await Share.share({ message, url: link, title: "Join me on SNAP Life" });
      }
    } catch {
      // User dismissed — no-op
    } finally {
      setSharing(false);
    }
  }

  return (
    <Card style={{ ...styles.card, borderColor: colors.primary + "30" }} variant="outlined">
      {/* Header */}
      <View style={styles.header}>
        <View style={[styles.iconWrap, { backgroundColor: colors.primary + "15" }]}>
          <Feather name="gift" size={18} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.foreground }]}>
            Refer a Friend
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Earn {REFERRAL_XP} XP for every friend who joins
          </Text>
        </View>
      </View>

      {/* Code display */}
      {loading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>
            Generating your code…
          </Text>
        </View>
      ) : error ? (
        <Pressable onPress={fetchCode} style={styles.errorRow}>
          <Feather name="refresh-cw" size={14} color={colors.destructive} />
          <Text style={[styles.errorText, { color: colors.destructive }]}>
            Couldn't load your code — tap to retry
          </Text>
        </Pressable>
      ) : (
        <View style={[styles.codeBox, { backgroundColor: colors.primary + "08", borderColor: colors.primary + "25" }]}>
          <Text style={[styles.codeLabel, { color: colors.primary }]}>Your referral code</Text>
          <Text style={[styles.code, { color: colors.foreground }]}>{code}</Text>
          <Text style={[styles.codeHint, { color: colors.mutedForeground }]}>
            Share this code or your personal link — your friend uses it when they sign up
          </Text>
        </View>
      )}

      {/* Share button */}
      <Pressable
        style={[
          styles.shareBtn,
          {
            backgroundColor: loading || error ? colors.muted : colors.primary,
            opacity: loading || error ? 0.5 : 1,
          },
        ]}
        onPress={handleShare}
        disabled={loading || error || sharing}
        accessibilityRole="button"
        accessibilityLabel="Share your referral link"
      >
        {sharing ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Feather name="share-2" size={15} color="#fff" />
        )}
        <Text style={styles.shareBtnText}>
          {sharing ? "Sharing…" : Platform.OS === "web" ? "Copy referral link" : "Share my referral link"}
        </Text>
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
    marginBottom: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 14,
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 15,
    fontWeight: "700",
  },
  subtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 14,
    paddingHorizontal: 4,
  },
  loadingText: {
    fontSize: 13,
  },
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 14,
    paddingHorizontal: 4,
  },
  errorText: {
    fontSize: 13,
  },
  codeBox: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    marginBottom: 14,
    alignItems: "center",
  },
  codeLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  code: {
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: 3,
    marginBottom: 8,
  },
  codeHint: {
    fontSize: 12,
    textAlign: "center",
    lineHeight: 17,
  },
  shareBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 10,
    paddingVertical: 13,
    paddingHorizontal: 20,
  },
  shareBtnText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
});
