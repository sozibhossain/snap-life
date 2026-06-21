import Constants from "expo-constants";
import { Platform } from "react-native";
import { authHeader } from "./userToken";
import { getApiBaseUrl } from "./serverIdentity";

export type FeedbackType = "general" | "testimonial" | "experience";

export const FEEDBACK_TAGS = [
  "Relaxing",
  "Easy to use",
  "Helpful",
  "Enjoyable",
  "Not working well",
] as const;

export type FeedbackTag = (typeof FEEDBACK_TAGS)[number];

export interface SubmitFeedbackInput {
  feedbackType: FeedbackType;
  message: string;
  tier: "free" | "trial" | "plus" | "premium";
  tags: FeedbackTag[];
  allowTestimonialUse: boolean;
  appUserId?: string | null;
}

export async function submitFeedback(input: SubmitFeedbackInput): Promise<{ ok: boolean; id?: number; error?: string }> {
  const url = `${getApiBaseUrl()}/api/feedback`;
  try {
    // Per-user endpoint: server requires the bearer token and ignores any
    // body `appUserId` claim. We still forward `appUserId` so the server's
    // `assertSelf` can sanity-check it matches the token user.
    const auth = await authHeader(input.appUserId);
    if (!auth.Authorization) {
      return { ok: false, error: "auth_unavailable" };
    }
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify({
        ...input,
        platform: Platform.OS,
        appVersion: (Constants.expoConfig as any)?.version ?? "dev",
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: json?.error ?? `HTTP ${res.status}` };
    }
    return { ok: true, id: json?.id };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
