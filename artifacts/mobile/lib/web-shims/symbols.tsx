/**
 * Native re-export of expo-symbols' `SymbolView`.
 *
 * Paired with `symbols.web.tsx`, which renders a transparent placeholder
 * because SF Symbols are iOS-only. The tabs layout already chooses
 * `<Feather />` over `<SymbolView />` on non-iOS platforms, so the web shim
 * is purely defensive against the import itself failing.
 */
export { SymbolView } from "expo-symbols";
