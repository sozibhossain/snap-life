import { useCallback } from "react";
import { useLocation } from "wouter";

/**
 * Returns a stable navigate callback that safely prepends the current pathname
 * before the query string.  This prevents filter/pagination updates from
 * accidentally redirecting to the wrong page (e.g. when the caller passes only
 * `"?foo=bar"` without a path prefix).
 *
 * Offset reset: whenever a non-offset parameter changes, the `offset` key is
 * automatically stripped from the outgoing URL — unless the caller explicitly
 * supplies a new, non-null `offset` value.  This prevents users from landing
 * mid-way through a result set after applying a new filter.
 *
 * Usage:
 *   const filterNavigate = useFilterNavigate();
 *   filterNavigate(nextSearchParams);          // URLSearchParams
 *   filterNavigate("foo=bar");                 // plain query string (no leading "?")
 *   filterNavigate(qs, { replace: false });    // push instead of replace
 */
export function useFilterNavigate() {
  const [pathname, navigate] = useLocation();

  return useCallback(
    (
      nextParams: URLSearchParams | string,
      options: { replace?: boolean } = { replace: true },
    ) => {
      const raw =
        typeof nextParams === "string" ? nextParams : nextParams.toString();
      const qs = raw.startsWith("?") ? raw.slice(1) : raw;

      const next = new URLSearchParams(qs);

      // Compare against current URL to decide whether to reset offset.
      const current = new URLSearchParams(
        typeof window !== "undefined" ? window.location.search : "",
      );

      const currentOffset = current.get("offset");
      const nextOffset = next.get("offset");

      // "Intentional" means the caller explicitly supplied a new offset value.
      const offsetChangedIntentionally =
        nextOffset !== null && nextOffset !== currentOffset;

      if (!offsetChangedIntentionally) {
        // Check whether any non-offset key differs between current and next.
        const currentWithoutOffset = new URLSearchParams(current);
        currentWithoutOffset.delete("offset");
        const nextWithoutOffset = new URLSearchParams(next);
        nextWithoutOffset.delete("offset");

        if (currentWithoutOffset.toString() !== nextWithoutOffset.toString()) {
          next.delete("offset");
        }
      }

      const finalQs = next.toString();
      navigate(finalQs ? `${pathname}?${finalQs}` : pathname, {
        replace: options.replace ?? true,
      });
    },
    [pathname, navigate],
  );
}
