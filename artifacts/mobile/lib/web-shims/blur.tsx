/**
 * Native re-export of expo-blur's `BlurView`.
 *
 * Paired with `blur.web.tsx`, which renders a translucent `<View />` so the
 * tab bar still has a soft background even though backdrop-filter blur is
 * not universally supported across web browsers.
 */
export { BlurView } from "expo-blur";
