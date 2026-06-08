/**
 * Native re-export of expo-glass-effect's `isLiquidGlassAvailable`.
 *
 * Paired with `glassEffect.web.ts`, which Metro picks for the web bundle so
 * that the iOS-26-only API never has to load on platforms that can't link it.
 */
export { isLiquidGlassAvailable } from "expo-glass-effect";
