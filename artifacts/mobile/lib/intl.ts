/**
 * Locale-aware formatting helpers. The whole app should funnel through
 * these so any user-visible date / time / number is rendered in the
 * user's chosen country + timezone (set on /settings/profile-edit and
 * persisted via PATCH /api/me/profile).
 *
 * Keep this file pure and free of React imports — the convenience hook
 * `useDateFormatters` lives next to the AuthContext.
 */

const FALLBACK_LOCALE = "en-GB";

/** Map an ISO 3166-1 alpha-2 country to a BCP-47 locale tag (best-effort). */
export function localeFromCountry(country: string | null | undefined): string {
  if (!country) return FALLBACK_LOCALE;
  // Most consumers want en-XX so the language stays English while the
  // calendar / number grouping conventions follow the user's region.
  return `en-${country.toUpperCase()}`;
}

/** Format a date in the user's preferred locale + timezone. */
export function formatDateInZone(
  d: Date | number | string,
  locale: string,
  timezone: string | null | undefined,
  opts: Intl.DateTimeFormatOptions,
): string {
  const date = d instanceof Date ? d : new Date(d);
  const finalOpts: Intl.DateTimeFormatOptions = timezone
    ? { ...opts, timeZone: timezone }
    : opts;
  try {
    return new Intl.DateTimeFormat(locale, finalOpts).format(date);
  } catch {
    return new Intl.DateTimeFormat(FALLBACK_LOCALE, opts).format(date);
  }
}

/** Format a number in the user's preferred locale (timezone-irrelevant). */
export function formatNumberInLocale(
  n: number,
  locale: string,
  opts?: Intl.NumberFormatOptions,
): string {
  try {
    return new Intl.NumberFormat(locale, opts).format(n);
  } catch {
    return new Intl.NumberFormat(FALLBACK_LOCALE, opts).format(n);
  }
}

/** Convert "GB" → "🇬🇧" via Unicode regional indicator codepoints. */
export function flagForCountry(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return "";
  return code
    .toUpperCase()
    .split("")
    .map((c) => String.fromCodePoint(0x1f1a5 + c.charCodeAt(0)))
    .join("");
}

/**
 * The full ISO 3166-1 alpha-2 country list. We resolve display labels at
 * runtime via `Intl.DisplayNames` when available so we don't have to
 * ship a localised name table.
 */
export const ISO_COUNTRY_CODES: readonly string[] = [
  "AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AQ", "AR",
  "AS", "AT", "AU", "AW", "AX", "AZ", "BA", "BB", "BD", "BE",
  "BF", "BG", "BH", "BI", "BJ", "BL", "BM", "BN", "BO", "BQ",
  "BR", "BS", "BT", "BV", "BW", "BY", "BZ", "CA", "CC", "CD",
  "CF", "CG", "CH", "CI", "CK", "CL", "CM", "CN", "CO", "CR",
  "CU", "CV", "CW", "CX", "CY", "CZ", "DE", "DJ", "DK", "DM",
  "DO", "DZ", "EC", "EE", "EG", "EH", "ER", "ES", "ET", "FI",
  "FJ", "FK", "FM", "FO", "FR", "GA", "GB", "GD", "GE", "GF",
  "GG", "GH", "GI", "GL", "GM", "GN", "GP", "GQ", "GR", "GS",
  "GT", "GU", "GW", "GY", "HK", "HM", "HN", "HR", "HT", "HU",
  "ID", "IE", "IL", "IM", "IN", "IO", "IQ", "IR", "IS", "IT",
  "JE", "JM", "JO", "JP", "KE", "KG", "KH", "KI", "KM", "KN",
  "KP", "KR", "KW", "KY", "KZ", "LA", "LB", "LC", "LI", "LK",
  "LR", "LS", "LT", "LU", "LV", "LY", "MA", "MC", "MD", "ME",
  "MF", "MG", "MH", "MK", "ML", "MM", "MN", "MO", "MP", "MQ",
  "MR", "MS", "MT", "MU", "MV", "MW", "MX", "MY", "MZ", "NA",
  "NC", "NE", "NF", "NG", "NI", "NL", "NO", "NP", "NR", "NU",
  "NZ", "OM", "PA", "PE", "PF", "PG", "PH", "PK", "PL", "PM",
  "PN", "PR", "PS", "PT", "PW", "PY", "QA", "RE", "RO", "RS",
  "RU", "RW", "SA", "SB", "SC", "SD", "SE", "SG", "SH", "SI",
  "SJ", "SK", "SL", "SM", "SN", "SO", "SR", "SS", "ST", "SV",
  "SX", "SY", "SZ", "TC", "TD", "TF", "TG", "TH", "TJ", "TK",
  "TL", "TM", "TN", "TO", "TR", "TT", "TV", "TW", "TZ", "UA",
  "UG", "UM", "US", "UY", "UZ", "VA", "VC", "VE", "VG", "VI",
  "VN", "VU", "WF", "WS", "YE", "YT", "ZA", "ZM", "ZW",
] as const;

/** Resolve a country code to a human-readable label in the given locale. */
export function countryLabel(code: string, locale = "en"): string {
  try {
    const dn = new (Intl as unknown as {
      DisplayNames: new (
        l: string | string[],
        o: { type: string },
      ) => { of(c: string): string | undefined };
    }).DisplayNames([locale], { type: "region" });
    return dn.of(code) ?? code;
  } catch {
    return code;
  }
}

/** Best-effort device IANA timezone (used to seed + reset). */
export function deviceTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (typeof tz === "string" && tz.length > 0) return tz;
  } catch {
    // ignore — fall through
  }
  return "UTC";
}
