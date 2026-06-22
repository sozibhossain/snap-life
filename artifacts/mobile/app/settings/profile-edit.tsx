import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Card } from "@/components/ui/Card";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useAuth as useClerkAuth } from "@clerk/expo";
import { resolveApiBase } from "@/lib/serverIdentity";
import {
  ISO_COUNTRY_CODES,
  countryLabel as resolveCountryLabel,
  deviceTimezone,
  flagForCountry,
} from "@/lib/intl";

// ── Date-of-birth helpers ─────────────────────────────────────────────────

function formatDobInput(next: string): string {
  const digits = next.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function isoToDob(iso: string): string {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return "";
  return `${d}/${m}/${y}`;
}

function dobToIso(dob: string): string | undefined {
  const parts = dob.split("/");
  if (parts.length !== 3) return undefined;
  const [d, m, y] = parts;
  if (d.length !== 2 || m.length !== 2 || y.length !== 4) return undefined;
  const iso = `${y}-${m}-${d}`;
  if (isNaN(new Date(iso).getTime())) return undefined;
  return iso;
}

function ageFromDob(iso: string): number | undefined {
  const birth = new Date(iso);
  if (isNaN(birth.getTime())) return undefined;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age >= 0 && age < 130 ? age : undefined;
}

/**
 * /settings/profile-edit — lets the user replace their profile photo and
 * pick the country + timezone we use for localised date / unit display.
 *
 * Photo handling: when an API base URL is reachable we use the
 * presigned-URL flow (POST /api/storage/uploads/request-url → direct PUT
 * to GCS → POST /api/me/avatar) so large originals never travel through
 * /sync/profile. Web and offline mobile sessions fall back to a base64
 * data URI on `user.avatar` — same column, same client read path.
 *
 * Country: full ISO 3166-1 alpha-2 list with localised labels resolved
 * via Intl.DisplayNames. Free of `react-native-picker` deps to keep the
 * bundle lean.
 *
 * Timezone: defaulted from the device on first launch. The picker shows
 * `Intl.supportedValuesOf("timeZone")` when available and offers a
 * one-tap "Use device timezone" reset.
 */

interface CountryOption {
  code: string;
  label: string;
  flag: string;
}

const FALLBACK_TZ_LIST = [
  "UTC",
  "Europe/London",
  "Europe/Dublin",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Rome",
  "Europe/Amsterdam",
  "Europe/Stockholm",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Vancouver",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Pacific/Auckland",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Africa/Johannesburg",
];

const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const AVATAR_ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
]);

function listTimezones(): string[] {
  try {
    const fn = (
      Intl as unknown as { supportedValuesOf?: (k: string) => string[] }
    ).supportedValuesOf;
    if (typeof fn === "function") {
      const tzs = fn("timeZone");
      if (Array.isArray(tzs) && tzs.length > 0) return tzs;
    }
  } catch {
    // fall through
  }
  return FALLBACK_TZ_LIST;
}

function buildCountryOptions(): CountryOption[] {
  return ISO_COUNTRY_CODES.map((code) => ({
    code,
    label: resolveCountryLabel(code),
    flag: flagForCountry(code),
  })).sort((a, b) => a.label.localeCompare(b.label));
}

function describeCountry(code: string | undefined): string {
  if (!code) return "Not set";
  const label = resolveCountryLabel(code);
  const flag = flagForCountry(code);
  return flag ? `${flag}  ${label}` : label;
}

/**
 * Promote a freshly-picked image asset to the user's avatar:
 *  1. ask the API for a presigned upload URL
 *  2. PUT the bytes directly to GCS
 *  3. POST the returned objectPath to /api/me/avatar so the server
 *     validates content-type / size and persists the canonical path.
 *
 * Returns the canonical avatar URL on success, or `null` if any step
 * fails — callers fall back to the offline data-URI path.
 */
async function uploadAvatarViaPresignedUrl(args: {
  uri: string;
  mime: string;
  apiBase: string;
  authHeader: string | null;
}): Promise<string | null> {
  const { uri, mime, apiBase, authHeader } = args;
  if (!authHeader) return null;
  try {
    const resp = await fetch(uri);
    const blob = await resp.blob();
    if (blob.size <= 0 || blob.size > AVATAR_MAX_BYTES) return null;

    const reqRes = await fetch(`${apiBase}/api/storage/uploads/request-url`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({
        name: `avatar-${Date.now()}`,
        size: blob.size,
        contentType: mime,
      }),
    });
    if (!reqRes.ok) return null;
    const reqBody = (await reqRes.json()) as {
      uploadURL?: string;
      objectPath?: string;
    };
    if (!reqBody.uploadURL || !reqBody.objectPath) return null;

    const putRes = await fetch(reqBody.uploadURL, {
      method: "PUT",
      headers: { "Content-Type": mime },
      body: blob,
    });
    if (!putRes.ok) return null;

    const claimRes = await fetch(`${apiBase}/api/me/avatar`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({ objectPath: reqBody.objectPath }),
    });
    if (!claimRes.ok) return null;
    const claim = (await claimRes.json()) as { avatarUrl?: string };
    if (!claim.avatarUrl) return null;
    // Server returns a canonical `/api/storage/objects/...` path so
    // every surface (mobile, admin, API) renders the same URL.
    return claim.avatarUrl.startsWith("http")
      ? claim.avatarUrl
      : `${apiBase}${claim.avatarUrl}`;
  } catch (err) {
    console.warn("[profile-edit] presigned avatar upload failed", err);
    return null;
  }
}

export default function ProfileEditScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, updateUser } = useAuth();
  const { getToken } = useClerkAuth();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const [pickerOpen, setPickerOpen] = useState<null | "country" | "timezone">(
    null,
  );
  const [search, setSearch] = useState("");
  const [photoBusy, setPhotoBusy] = useState(false);

  // Personal detail fields — initialised from the stored user
  const [firstName, setFirstName] = useState(user?.firstName ?? "");
  const [lastName, setLastName] = useState(user?.lastName ?? "");
  const [dobText, setDobText] = useState(
    user?.dateOfBirth ? isoToDob(user.dateOfBirth) : "",
  );
  const [location, setLocation] = useState(user?.location ?? "");
  const [detailsSaved, setDetailsSaved] = useState(false);

  async function savePersonalDetails() {
    const isoDate = dobToIso(dobText.trim());
    const derivedAge = isoDate ? ageFromDob(isoDate) : undefined;
    await updateUser({
      firstName: firstName.trim() || undefined,
      lastName: lastName.trim() || undefined,
      name:
        [firstName.trim(), lastName.trim()].filter(Boolean).join(" ") ||
        user?.name ||
        undefined,
      dateOfBirth: isoDate,
      age: derivedAge,
      location: location.trim() || undefined,
    });
    setDetailsSaved(true);
    setTimeout(() => setDetailsSaved(false), 2000);
  }

  const allTimezones = useMemo(listTimezones, []);
  const countryOptions = useMemo(buildCountryOptions, []);

  if (!user) {
    return (
      <View
        style={[styles.container, { backgroundColor: colors.background }]}
      />
    );
  }

  async function handlePickedAsset(
    asset: ImagePicker.ImagePickerAsset,
  ): Promise<void> {
    const mime =
      typeof asset.mimeType === "string" &&
      AVATAR_ALLOWED_MIME.has(asset.mimeType)
        ? asset.mimeType
        : "image/jpeg";

    // First try the presigned-URL path so the bytes don't travel through
    // /sync/profile. We fall back to a data URI if the API isn't reachable
    // (offline / web preview / dev-without-tokens).
    const apiBase = resolveApiBase();
    let authHeader: string | null = null;
    try {
      const t = await getToken();
      authHeader = t ? `Bearer ${t}` : null;
    } catch {
      authHeader = null;
    }

    if (apiBase !== null && asset.uri) {
      const remote = await uploadAvatarViaPresignedUrl({
        uri: asset.uri,
        mime,
        apiBase,
        authHeader,
      });
      if (remote) {
        await updateUser({ avatar: remote });
        return;
      }
    }

    const dataUri =
      asset.base64 && asset.base64.length > 0
        ? `data:${mime};base64,${asset.base64}`
        : asset.uri;
    if (!dataUri) return;
    await updateUser({ avatar: dataUri });
  }

  async function pickPhotoFromLibrary() {
    setPhotoBusy(true);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted && Platform.OS !== "web") {
        Alert.alert(
          "Photo permission needed",
          "Allow SNAP Life to access your photos to set a profile picture.",
        );
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.5,
        base64: true,
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset) return;
      await handlePickedAsset(asset);
    } catch (err) {
      console.warn("[profile-edit] pickPhotoFromLibrary failed", err);
      if (Platform.OS !== "web") {
        Alert.alert("Couldn't update photo", "Please try again.");
      }
    } finally {
      setPhotoBusy(false);
    }
  }

  async function takePhotoWithCamera() {
    if (Platform.OS === "web") {
      // Most desktop browsers don't expose getUserMedia through the
      // picker shim. Fall through to the library picker instead.
      await pickPhotoFromLibrary();
      return;
    }
    setPhotoBusy(true);
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          "Camera permission needed",
          "Allow SNAP Life to use your camera to take a profile picture.",
        );
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.5,
        base64: true,
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset) return;
      await handlePickedAsset(asset);
    } catch (err) {
      console.warn("[profile-edit] takePhotoWithCamera failed", err);
      Alert.alert("Couldn't capture photo", "Please try again.");
    } finally {
      setPhotoBusy(false);
    }
  }

  async function removePhoto() {
    await updateUser({ avatar: undefined });
  }

  /**
   * Persist a country / timezone change through the strict
   * PATCH /api/me/profile contract (server validates ISO 3166 + IANA).
   * We also call updateUser so the local AuthContext + offline /sync
   * mirror stay in lock-step until the next snapshot fetch. Falls back
   * to updateUser-only when no auth token / API base is available
   * (offline or web preview without a signed-in Clerk session).
   */
  async function patchLocaleField(
    patch: { country?: string; timezone?: string },
  ): Promise<void> {
    await updateUser(patch);
    const apiBase = resolveApiBase();
    if (apiBase === null) return;
    let token: string | null = null;
    try {
      token = await getToken();
    } catch {
      token = null;
    }
    if (!token) return;
    try {
      await fetch(`${apiBase}/api/me/profile`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(patch),
      });
    } catch (err) {
      console.warn("[profile-edit] PATCH /me/profile failed", err);
    }
  }

  async function resetTimezoneToDevice() {
    await patchLocaleField({ timezone: deviceTimezone() });
  }

  const filteredOptions = useMemo(() => {
    if (pickerOpen === "country") {
      const q = search.trim().toLowerCase();
      return countryOptions
        .filter(
          (c) =>
            q === "" ||
            c.label.toLowerCase().includes(q) ||
            c.code.toLowerCase().includes(q),
        )
        .map((c) => ({
          value: c.code,
          label: c.flag ? `${c.flag}  ${c.label}` : c.label,
        }));
    }
    if (pickerOpen === "timezone") {
      const q = search.trim().toLowerCase();
      return allTimezones
        .filter((t) => q === "" || t.toLowerCase().includes(q))
        .slice(0, 200)
        .map((t) => ({ value: t, label: t.replace(/_/g, " ") }));
    }
    return [];
  }, [pickerOpen, search, allTimezones, countryOptions]);

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : Platform.OS === "android" ? "height" : undefined}
    >
      <View
        style={[
          styles.header,
          { paddingTop: topPad + 8, borderBottomColor: colors.border },
        ]}
      >
        <Pressable onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>
          Edit Profile
        </Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 24 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
          PROFILE PHOTO
        </Text>
        <Card variant="outlined" style={{ marginBottom: 24 }}>
          <View style={styles.photoRow}>
            <View
              style={[
                styles.avatarPreview,
                { backgroundColor: colors.muted, borderColor: colors.border },
              ]}
            >
              {user.avatar ? (
                <Image source={{ uri: user.avatar }} style={styles.avatarImg} />
              ) : (
                <Text style={[styles.avatarInitial, { color: colors.foreground }]}>
                  {user.name?.charAt(0)?.toUpperCase() || "S"}
                </Text>
              )}
            </View>
            <View style={{ flex: 1, gap: 8 }}>
              <Pressable
                style={[styles.btn, { backgroundColor: colors.primary }]}
                onPress={takePhotoWithCamera}
                disabled={photoBusy}
              >
                <Feather name="camera" size={14} color="#fff" />
                <Text style={styles.btnText}>
                  {photoBusy ? "Uploading…" : "Take photo"}
                </Text>
              </Pressable>
              <Pressable
                style={[styles.btnGhost, { borderColor: colors.border }]}
                onPress={pickPhotoFromLibrary}
                disabled={photoBusy}
              >
                <Feather name="image" size={14} color={colors.foreground} />
                <Text style={[styles.btnGhostText, { color: colors.foreground }]}>
                  {user.avatar ? "Choose from library" : "Choose from library"}
                </Text>
              </Pressable>
              {user.avatar && (
                <Pressable
                  style={[styles.btnGhost, { borderColor: colors.border }]}
                  onPress={removePhoto}
                  disabled={photoBusy}
                >
                  <Feather name="trash-2" size={14} color={colors.destructive} />
                  <Text
                    style={[styles.btnGhostText, { color: colors.destructive }]}
                  >
                    Remove
                  </Text>
                </Pressable>
              )}
            </View>
          </View>
        </Card>

        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
          ACCOUNT
        </Text>
        <Card variant="outlined" style={{ marginBottom: 8 }}>
          <View style={styles.detailsForm}>
            <View style={styles.detailsRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.detailFieldLabel, { color: colors.mutedForeground }]}>
                  EMAIL ADDRESS
                </Text>
                <View
                  style={[
                    styles.detailInput,
                    {
                      backgroundColor: colors.muted,
                      borderColor: colors.border,
                      justifyContent: "center",
                    },
                  ]}
                >
                  <Text style={[{ fontSize: 14, fontFamily: "Inter_400Regular", color: colors.foreground }]} numberOfLines={1}>
                    {user?.email || "—"}
                  </Text>
                </View>
                <Text style={[{ fontSize: 11, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginTop: 4 }]}>
                  Email is managed through your account login. Contact support to change it.
                </Text>
              </View>
            </View>
          </View>
        </Card>

        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
          PERSONAL DETAILS
        </Text>
        <Card variant="outlined" style={{ marginBottom: 8 }}>
          <View style={styles.detailsForm}>
            {/* Name row */}
            <View style={styles.detailsNameRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.detailFieldLabel, { color: colors.mutedForeground }]}>
                  FIRST NAME
                </Text>
                <TextInput
                  value={firstName}
                  onChangeText={setFirstName}
                  placeholder="First name"
                  placeholderTextColor={colors.mutedForeground + "70"}
                  style={[
                    styles.detailInput,
                    {
                      backgroundColor: colors.background,
                      borderColor: colors.border,
                      color: colors.foreground,
                    },
                  ]}
                  returnKeyType="next"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.detailFieldLabel, { color: colors.mutedForeground }]}>
                  LAST NAME
                </Text>
                <TextInput
                  value={lastName}
                  onChangeText={setLastName}
                  placeholder="Last name"
                  placeholderTextColor={colors.mutedForeground + "70"}
                  style={[
                    styles.detailInput,
                    {
                      backgroundColor: colors.background,
                      borderColor: colors.border,
                      color: colors.foreground,
                    },
                  ]}
                  returnKeyType="next"
                />
              </View>
            </View>

            <View style={[styles.detailsDivider, { backgroundColor: colors.border }]} />

            {/* Date of Birth */}
            <View style={styles.detailsRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.detailFieldLabel, { color: colors.mutedForeground }]}>
                  DATE OF BIRTH
                </Text>
                <TextInput
                  value={dobText}
                  onChangeText={(v) => setDobText(formatDobInput(v))}
                  placeholder="DD/MM/YYYY"
                  placeholderTextColor={colors.mutedForeground + "70"}
                  keyboardType="numeric"
                  maxLength={10}
                  style={[
                    styles.detailInput,
                    {
                      backgroundColor: colors.background,
                      borderColor: colors.border,
                      color: colors.foreground,
                    },
                  ]}
                  returnKeyType="next"
                />
              </View>
              <View style={{ flex: 2 }}>
                <Text style={[styles.detailFieldLabel, { color: colors.mutedForeground }]}>
                  TOWN / COUNTRY
                </Text>
                <TextInput
                  value={location}
                  onChangeText={setLocation}
                  placeholder="e.g. Lisbon, Portugal"
                  placeholderTextColor={colors.mutedForeground + "70"}
                  style={[
                    styles.detailInput,
                    {
                      backgroundColor: colors.background,
                      borderColor: colors.border,
                      color: colors.foreground,
                    },
                  ]}
                  returnKeyType="done"
                />
              </View>
            </View>
          </View>
        </Card>

        {/* Save button */}
        <Pressable
          style={[
            styles.saveDetailsBtn,
            {
              backgroundColor: detailsSaved ? colors.success : colors.primary,
            },
          ]}
          onPress={savePersonalDetails}
        >
          <Feather
            name={detailsSaved ? "check" : "save"}
            size={15}
            color="#fff"
          />
          <Text style={styles.saveDetailsBtnText}>
            {detailsSaved ? "Saved!" : "Save details"}
          </Text>
        </Pressable>

        <View style={{ height: 24 }} />

        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
          LOCATION & TIME
        </Text>
        <Card variant="outlined">
          <Pressable
            style={[
              styles.fieldRow,
              { borderBottomWidth: 1, borderBottomColor: colors.border },
            ]}
            onPress={() => {
              setSearch("");
              setPickerOpen("country");
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
                Country
              </Text>
              <Text style={[styles.fieldValue, { color: colors.foreground }]}>
                {describeCountry(user.country)}
              </Text>
            </View>
            <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
          </Pressable>
          <Pressable
            style={styles.fieldRow}
            onPress={() => {
              setSearch("");
              setPickerOpen("timezone");
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
                Timezone
              </Text>
              <Text style={[styles.fieldValue, { color: colors.foreground }]}>
                {user.timezone ?? "UTC"}
              </Text>
            </View>
            <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
          </Pressable>
        </Card>

        <Pressable
          onPress={resetTimezoneToDevice}
          style={[styles.resetTzBtn, { borderColor: colors.border }]}
        >
          <Feather name="refresh-cw" size={13} color={colors.primary} />
          <Text style={[styles.resetTzText, { color: colors.primary }]}>
            Use device timezone ({deviceTimezone()})
          </Text>
        </Pressable>

        <Text style={[styles.helpText, { color: colors.mutedForeground }]}>
          Your timezone is used for daily streaks, reminders, and date
          formatting. Your country helps us show units and resources that
          match where you live.
        </Text>
      </ScrollView>

      <Modal
        visible={pickerOpen !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setPickerOpen(null)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setPickerOpen(null)}
        >
          <Pressable
            style={[styles.modalSheet, { backgroundColor: colors.card }]}
            onPress={() => undefined}
          >
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.foreground }]}>
                {pickerOpen === "country" ? "Choose country" : "Choose timezone"}
              </Text>
              <Pressable onPress={() => setPickerOpen(null)}>
                <Feather name="x" size={20} color={colors.foreground} />
              </Pressable>
            </View>
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search…"
              placeholderTextColor={colors.mutedForeground}
              style={[
                styles.searchInput,
                {
                  backgroundColor: colors.muted,
                  color: colors.foreground,
                  borderColor: colors.border,
                },
              ]}
              autoCorrect={false}
              autoCapitalize="none"
            />
            <FlatList
              data={filteredOptions}
              keyExtractor={(item) => item.value}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const isCurrent =
                  (pickerOpen === "country" && user.country === item.value) ||
                  (pickerOpen === "timezone" && user.timezone === item.value);
                return (
                  <Pressable
                    style={[
                      styles.optionRow,
                      { borderBottomColor: colors.border },
                    ]}
                    onPress={async () => {
                      if (pickerOpen === "country") {
                        await patchLocaleField({ country: item.value });
                      } else if (pickerOpen === "timezone") {
                        await patchLocaleField({ timezone: item.value });
                      }
                      setPickerOpen(null);
                    }}
                  >
                    <Text
                      style={[
                        styles.optionLabel,
                        { color: colors.foreground },
                      ]}
                    >
                      {item.label}
                    </Text>
                    {isCurrent && (
                      <Feather name="check" size={18} color={colors.primary} />
                    )}
                  </Pressable>
                );
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
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
  content: { padding: 16 },
  sectionLabel: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.8,
    marginBottom: 8,
    marginLeft: 4,
  },
  photoRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    gap: 16,
  },
  avatarPreview: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    overflow: "hidden",
  },
  avatarImg: { width: 72, height: 72, borderRadius: 36 },
  avatarInitial: { fontSize: 28, fontFamily: "Inter_700Bold" },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
  },
  btnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  btnGhost: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  btnGhostText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  // Personal details section
  detailsForm: { padding: 16, gap: 0 },
  detailsNameRow: { flexDirection: "row", gap: 12, marginBottom: 12 },
  detailsRow: { flexDirection: "row", gap: 12 },
  detailsDivider: { height: 1, marginBottom: 12 },
  detailFieldLabel: {
    fontSize: 10,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  detailInput: {
    height: 42,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  saveDetailsBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    height: 44,
    borderRadius: 12,
    marginBottom: 4,
  },
  saveDetailsBtnText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },

  fieldRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  fieldLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  fieldValue: { fontSize: 15, fontFamily: "Inter_500Medium" },
  resetTzBtn: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    paddingVertical: 10,
    borderRadius: 10,
  },
  resetTzText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  helpText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 12,
    paddingHorizontal: 4,
    lineHeight: 18,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    height: "70%",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingTop: 12,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  modalTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  searchInput: {
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    fontSize: 14,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  optionLabel: { fontSize: 14, fontFamily: "Inter_500Medium", flex: 1 },
});
