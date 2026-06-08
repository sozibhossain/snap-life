import { useColorScheme } from "react-native";

import colors, { type Palette } from "@/constants/colors";

/**
 * Returns the design tokens for the current color scheme.
 *
 * The returned object contains every token in the active palette plus
 * the scheme-independent `radius` constant. Use this everywhere you'd
 * otherwise reach for a hardcoded hex code — it keeps the visual
 * system consistent and makes the dark mode flip free.
 *
 * Includes:
 *   • flat colour tokens (foreground, card, primary, …)
 *   • a `gradients` object with two-stop tuples for hero/CTA surfaces
 *   • a `shadows` object with sm / md / lg presets that already have
 *     the right opacity for the active scheme (dark mode shadows are
 *     darker but lower-opacity so they don't muddy the navy surface)
 */
export function useColors(): Palette & { radius: number } {
  const scheme = useColorScheme();
  const palette: Palette = scheme === "dark" ? colors.dark : colors.light;
  return { ...palette, radius: colors.radius };
}
