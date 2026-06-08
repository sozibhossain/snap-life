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
  text: "#1C3A4A",
  tint: "#3ABBD4",

  background: "#F7FAFB",
  foreground: "#1C3A4A",

  card: "#FFFFFF",
  cardForeground: "#1C3A4A",

  primary: "#3ABBD4",
  primaryForeground: "#FFFFFF",

  secondary: "#E5F5F9",
  secondaryForeground: "#1C3A4A",

  muted: "#EEF4F6",
  mutedForeground: "#5C7E8C",

  accent: "#F47530",
  accentForeground: "#FFFFFF",

  destructive: "#ef4444",
  destructiveForeground: "#ffffff",

  border: "#D5E8EE",
  input: "#D5E8EE",

  success: "#22c55e",
  successForeground: "#ffffff",
  warning: "#F47530",
  warningForeground: "#ffffff",

  navy: "#1C3A4A",
  navyMid: "#24576F",
  navyLight: "#2B7499",

  xpGold: "#F47530",
  xpBronze: "#92400e",

  gradients: {
    hero: ["#F7FAFB", "#E5F5F9"],
    // Dark navy end leads so white-on-gradient text in the top-left
    // corner of a diagonal sweep clears WCAG AA contrast. The cyan
    // bottom-right still gives the surface its brand feel.
    primary: ["#1C3A4A", "#3ABBD4"],
    accent: ["#F47530", "#FFB07A"],
    calm: ["#1C7B8C", "#3ABBD4"],
    warmth: ["#F47530", "#FFB07A"],
    insight: ["#1C3A4A", "#3ABBD4"],
  },
  shadows: lightShadows,
};

const dark: Palette = {
  text: "#EEF6FA",
  tint: "#4ECFE0",

  background: "#0D2530",
  foreground: "#EEF6FA",

  card: "#152D3D",
  cardForeground: "#EEF6FA",

  primary: "#4ECFE0",
  primaryForeground: "#0D2530",

  secondary: "#1A3A4A",
  secondaryForeground: "#7AACC0",

  muted: "#1A3A4A",
  mutedForeground: "#7AACC0",

  accent: "#F68C50",
  accentForeground: "#ffffff",

  destructive: "#ef4444",
  destructiveForeground: "#ffffff",

  border: "#234759",
  input: "#234759",

  success: "#22c55e",
  successForeground: "#ffffff",
  warning: "#F68C50",
  warningForeground: "#ffffff",

  navy: "#0D2530",
  navyMid: "#152D3D",
  navyLight: "#1C3A4A",

  xpGold: "#F68C50",
  xpBronze: "#92400e",

  gradients: {
    hero: ["#0D2530", "#152D3D"],
    // Same dark-end-leading rule as light mode so white text on the
    // top-left of a diagonal sweep stays legible.
    primary: ["#0D2530", "#4ECFE0"],
    accent: ["#9C4A1F", "#F68C50"],
    calm: ["#0F4856", "#4ECFE0"],
    warmth: ["#9C4A1F", "#F68C50"],
    insight: ["#0D2530", "#4ECFE0"],
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
