/**
 * Thin client for the GDPR + tester self-serve endpoints
 * (`GET /api/me/export`, `DELETE /api/me`, `POST /api/me/reset`).
 *
 * Uses the same identity rules as the rest of the per-user API:
 *   - When a Clerk session token is supplied, send it as a Bearer.
 *   - Otherwise fall back to the cached legacy bearer token.
 *
 * Each helper returns a discriminated `{ ok, status, data?, error? }`
 * shape so screens can show a tailored error UI without re-parsing.
 */

import { Platform } from "react-native";
import { resolveApiBase } from "@/lib/serverIdentity";

export interface MeApiResult<T = unknown> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

function authHeaders(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchMyExport(
  token: string | null,
): Promise<MeApiResult<unknown>> {
  const base = resolveApiBase();
  if (base === null) return { ok: false, status: 0, error: "no_api_base_url" };
  try {
    const r = await fetch(`${base}/api/me/export`, {
      method: "GET",
      headers: { Accept: "application/json", ...authHeaders(token) },
    });
    if (!r.ok) {
      let err: string | undefined;
      try {
        const body = (await r.json()) as { error?: unknown };
        if (typeof body.error === "string") err = body.error;
      } catch {
        // ignore non-JSON body
      }
      return { ok: false, status: r.status, error: err };
    }
    const data = (await r.json()) as unknown;
    return { ok: true, status: r.status, data };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : "network_error",
    };
  }
}

export async function deleteMyAccount(
  token: string | null,
): Promise<MeApiResult<{ deletedAt: string; hardDeleteAfter: string }>> {
  const base = resolveApiBase();
  if (base === null) return { ok: false, status: 0, error: "no_api_base_url" };
  try {
    const r = await fetch(`${base}/api/me`, {
      method: "DELETE",
      headers: { Accept: "application/json", ...authHeaders(token) },
    });
    let body: { deletedAt?: unknown; hardDeleteAfter?: unknown; error?: unknown } = {};
    try {
      body = await r.json();
    } catch {
      // ignore non-JSON body
    }
    if (!r.ok) {
      return {
        ok: false,
        status: r.status,
        error: typeof body.error === "string" ? body.error : undefined,
      };
    }
    const deletedAt = typeof body.deletedAt === "string" ? body.deletedAt : "";
    const hardDeleteAfter =
      typeof body.hardDeleteAfter === "string" ? body.hardDeleteAfter : "";
    return {
      ok: true,
      status: r.status,
      data: { deletedAt, hardDeleteAfter },
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : "network_error",
    };
  }
}

export async function resetMyTesterData(
  token: string | null,
): Promise<MeApiResult<{ resetAt: string }>> {
  const base = resolveApiBase();
  if (base === null) return { ok: false, status: 0, error: "no_api_base_url" };
  try {
    const r = await fetch(`${base}/api/me/reset`, {
      method: "POST",
      headers: { Accept: "application/json", ...authHeaders(token) },
    });
    let body: { resetAt?: unknown; error?: unknown } = {};
    try {
      body = await r.json();
    } catch {
      // ignore non-JSON body
    }
    if (!r.ok) {
      return {
        ok: false,
        status: r.status,
        error: typeof body.error === "string" ? body.error : undefined,
      };
    }
    return {
      ok: true,
      status: r.status,
      data: { resetAt: typeof body.resetAt === "string" ? body.resetAt : "" },
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : "network_error",
    };
  }
}

/**
 * Save the export archive to the device. On web we trigger a Blob
 * download; on native we hand the JSON to the system share sheet
 * (the caller passes that via `onShareNative`) so the user can route
 * it to Files / iCloud / email.
 */
export async function downloadExportArchive(
  archive: unknown,
  filename: string,
  onShareNative?: (json: string) => Promise<void>,
): Promise<void> {
  const json = JSON.stringify(archive, null, 2);
  if (Platform.OS === "web") {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return;
  }
  if (onShareNative) {
    await onShareNative(json);
  }
}
