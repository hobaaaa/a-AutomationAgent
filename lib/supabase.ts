import "server-only";

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const SUPABASE_CONNECTIVITY_TIMEOUT_MS = 10_000;

export function assertSupabaseAdminEnv(): void {
  if (!supabaseUrl) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL environment variable.");
  }

  if (!supabaseServiceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY environment variable.");
  }
}

function getErrorCauseMessage(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "cause" in error &&
    error.cause instanceof Error
  ) {
    return error.cause.message;
  }

  return error instanceof Error ? error.message : String(error);
}

export function getSupabaseHost(): string {
  assertSupabaseAdminEnv();

  return new URL(supabaseUrl as string).host;
}

export async function assertSupabaseReachable(): Promise<void> {
  assertSupabaseAdminEnv();

  const restUrl = new URL("/rest/v1/", supabaseUrl as string);

  try {
    const response = await fetch(restUrl, {
      headers: {
        apikey: supabaseServiceRoleKey as string,
        Authorization: `Bearer ${supabaseServiceRoleKey}`,
      },
      signal: AbortSignal.timeout(SUPABASE_CONNECTIVITY_TIMEOUT_MS),
    });

    if (response.status >= 500) {
      throw new Error(`Supabase REST returned HTTP ${response.status}.`);
    }
  } catch (error) {
    throw new Error(
      `Supabase connectivity check failed for ${restUrl.host}: ${getErrorCauseMessage(
        error
      )}`
    );
  }
}

export const supabaseAdmin = createClient(
  supabaseUrl || "https://placeholder.supabase.co",
  supabaseServiceRoleKey || "placeholder-service-role-key",
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);
