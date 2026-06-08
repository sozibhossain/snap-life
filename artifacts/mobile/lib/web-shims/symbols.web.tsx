/**
 * Web shim for `expo-symbols`. SF Symbols ship with iOS, so on web we
 * render nothing. Callers (tabs layout) already gate `SymbolView` behind
 * `Platform.OS === "ios"`, so this should never actually mount on web.
 */
import React from "react";

interface SymbolViewProps {
  name?: string;
  tintColor?: string;
  size?: number;
  // Allow extra props without forcing every caller to type-narrow.
  [key: string]: unknown;
}

export function SymbolView(_: SymbolViewProps): React.ReactElement | null {
  return null;
}
