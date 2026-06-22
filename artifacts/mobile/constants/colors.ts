// SNAP Bone Health for Life — official brand palette
// Primary cyan: #3ABBD4 | Orange: #F47530 | Dark navy: #1C3A4A | Dark teal: #2B7499
//
// The palette below is the source of truth for *all* visual tokens in
// the mobile app — solid colours, gradients, and shadow presets. Adding
// a new visual primitive? Add it here, expose it through `useColors`,
// then use it from components. Don't hardcode hex codes in screens.

// Matches expo-linear-gradient's `colors` prop signature exactly so we
// can pass tokens without `as unknown as` casts. Two-stop minimum keeps
// the diagonal sweep readable.
export type GradientStops = readonly [string, string, ...string[]];

interface GradientTokens {
  /** Subtle screen-level wash used behind hero strips (light text not safe — keep dark text on top). */
  hero: GradientStops;
  /** Primary CTA / brand surface. Dark-end-leading so white text reads. */
  primary: GradientStops;
  /** Warm accent — used sparingly for energy / nutrition surfaces. */
  accent: GradientStops;
  /**
   * Calm — for breathing / meditation / SNAP Shot header. Dark-end
   * leading so white headline text passes 4.5:1 contrast at the top-left
   * (where the title sits in a diagonal sweep).
   */
  calm: GradientStops;
  /** Warmth — for food / nutrition / recipe surfaces. */
  warmth: GradientStops;
  /**
   * Insight / intelligence — used by Bone Buddy banner + chat header.
   * Dark-end leading so white text on the avatar/title region clears
   * WCAG AA against the navy start stop.
   */
  insight: GradientStops;
}

interface ShadowToken {
  shadowColor: string;
  shadowOffset: { width: number; height: number };
  shadowOpacity: number;
  shadowRadius: number;
  /** Android elevation. iOS uses the shadow* fields. */
  elevation: number;
}

interface ShadowTokens {
  /** Tight, just-off-the-page lift for inline pills / chips. */
  sm: ShadowToken;
  /** Default card lift — most elevated surfaces use this. */
  md: ShadowToken;
  /** Hero / modal lift — reserved for big focal cards. */
  lg: ShadowToken;
}

interface Palette {
  text: string;
  tint: string;

  background: string;
  foreground: string;

  card: string;
  cardForeground: string;

  primary: string;
  primaryForeground: string;

  secondary: string;
  secondaryForeground: string;

  muted: string;
  mutedForeground: string;

  accent: string;
  accentForeground: string;

  destructive: string;
  destructiveForeground: string;

  border: string;
  input: string;

  success: string;
  successForeground: string;
  warning: string;
  warningForeground: string;

  navy: string;
  navyMid: string;
  navyLight: string;

  xpGold: string;
  xpBronze: string;

  gradients: GradientTokens;
  shadows: ShadowTokens;
}

const lightShadows: ShadowTokens = {
  sm: {
    shadowColor: "#0D2530",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  md: {
    shadowColor: "#0D2530",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 4,
  },
  lg: {
    shadowColor: "#0D2530",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 24,
    elevation: 8,
  },
};

// In dark mode, shadows are mostly invisible against the navy
// background — we keep the elevation tokens for Android but lower the
// opacity / colour so the soft glow doesn't muddy the surface.
const darkShadows: ShadowTokens = {
  sm: {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.18,
    shadowRadius: 3,
    elevation: 1,
  },
  md: {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 12,
    elevation: 4,
  },
  lg: {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 24,
    elevation: 8,
  },
};

const light: Palette = {
  text: "#236184",
  tint: "#4fb3cd",

  background: "#F7FAFB",
  foreground: "#236184",

  card: "#FFFFFF",
  cardForeground: "#236184",

  primary: "#4fb3cd",
  primaryForeground: "#FFFFFF",

  secondary: "#E5F5F9",
  secondaryForeground: "#236184",

  muted: "#EEF4F6",
  mutedForeground: "#5C7E8C",

  accent: "#ff8736",
  accentForeground: "#FFFFFF",

  destructive: "#ef4444",
  destructiveForeground: "#ffffff",

  border: "#D5E8EE",
  input: "#D5E8EE",

  success: "#22c55e",
  successForeground: "#ffffff",
  warning: "#ff8736",
  warningForeground: "#ffffff",

  navy: "#236184",
  navyMid: "#2B7892",
  navyLight: "#4fb3cd",

  xpGold: "#ff8736",
  xpBronze: "#92400e",

  gradients: {
    hero: ["#F7FAFB", "#E5F5F9"],
    // Dark navy end leads so white-on-gradient text in the top-left
    // corner of a diagonal sweep clears WCAG AA contrast. The cyan
    // bottom-right still gives the surface its brand feel.
    primary: ["#236184", "#4fb3cd"],
    accent: ["#ff8736", "#FFB27D"],
    calm: ["#236184", "#4fb3cd"],
    warmth: ["#ff8736", "#FFB27D"],
    insight: ["#236184", "#4fb3cd"],
  },
  shadows: lightShadows,
};

const dark: Palette = {
  text: "#EEF6FA",
  tint: "#4fb3cd",

  background: "#0e2228",
  foreground: "#EEF6FA",

  card: "#152D3D",
  cardForeground: "#EEF6FA",

  primary: "#4fb3cd",
  primaryForeground: "#0e2228",

  secondary: "#1A3A4A",
  secondaryForeground: "#7AACC0",

  muted: "#1A3A4A",
  mutedForeground: "#7AACC0",

  accent: "#ff8736",
  accentForeground: "#ffffff",

  destructive: "#ef4444",
  destructiveForeground: "#ffffff",

  border: "#234759",
  input: "#234759",

  success: "#22c55e",
  successForeground: "#ffffff",
  warning: "#ff8736",
  warningForeground: "#ffffff",

  navy: "#0e2228",
  navyMid: "#152D3D",
  navyLight: "#236184",

  xpGold: "#ff8736",
  xpBronze: "#92400e",

  gradients: {
    hero: ["#0e2228", "#152D3D"],
    // Same dark-end-leading rule as light mode so white text on the
    // top-left of a diagonal sweep stays legible.
    primary: ["#0e2228", "#4fb3cd"],
    accent: ["#9C4A1F", "#ff8736"],
    calm: ["#0e2228", "#4fb3cd"],
    warmth: ["#9C4A1F", "#ff8736"],
    insight: ["#0e2228", "#4fb3cd"],
  },
  shadows: darkShadows,
};

const colors = {
  light,
  dark,
  radius: 12,
};

export type Scheme = "light" | "dark";
export type { Palette, ShadowToken };
export default colors;
