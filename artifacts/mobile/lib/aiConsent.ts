/**
 * One-time, per-user consent gate for sharing data with Bone Buddy's
 * third-party AI provider (OpenAI). Required before any chat message,
 * kickoff greeting, or daily/weekly check-in leaves the device — App
 * Store guidelines 5.1.1(i)/5.1.2(i) require the user's permission
 * before personal data is shared with a named third party, not just a
 * privacy-policy mention.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const CONSENT_KEY_PREFIX = "@snaplife/ai-consent/v1:";
/** Bump this if the disclosure text changes materially, to re-prompt. */
const CONSENT_VALUE = "openai-v1";

function keyFor(appUserId: string | null | undefined): string {
  return `${CONSENT_KEY_PREFIX}${appUserId ?? "anon"}`;
}

export async function hasBoneBuddyAiConsent(
  appUserId: string | null | undefined,
): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(appUserId));
    return raw === CONSENT_VALUE;
  } catch {
    return false;
  }
}

export async function recordBoneBuddyAiConsent(
  appUserId: string | null | undefined,
): Promise<void> {
  try {
    await AsyncStorage.setItem(keyFor(appUserId), CONSENT_VALUE);
  } catch {
    // Soft-fail — worst case the user is asked again next session.
  }
}
