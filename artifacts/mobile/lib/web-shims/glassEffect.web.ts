/**
 * Web shim for `expo-glass-effect`. Liquid glass is an iOS 26 API that the
 * package's web build does not implement, so we hard-code `false` and let
 * the caller fall back to the classic Tabs layout.
 */
export function isLiquidGlassAvailable(): boolean {
  return false;
}
