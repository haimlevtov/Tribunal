/**
 * Turns an internal failure into a message that names the setup step that is
 * missing, without leaking connection strings, keys, or stack traces.
 *
 * The generic "something went wrong" is correct for a public app but useless
 * when standing in front of a class wondering which of three setup steps was
 * skipped. These messages describe *configuration state*, which is not secret —
 * an attacker learns nothing from "the schema has not been created".
 */
export function describeSetupError(raw: string): string {
  const m = raw.toLowerCase();

  if (m.includes("supabase_url") || m.includes("supabase_service_role_key")) {
    return "Server not configured: the Supabase environment variables are missing. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, then redeploy.";
  }

  // PostgREST: 42P01 undefined_table, PGRST205 missing from schema cache.
  if (
    m.includes("42p01") ||
    m.includes("pgrst205") ||
    m.includes("does not exist") ||
    m.includes("schema cache")
  ) {
    return "Database schema not found. Run supabase/migrations/0001_init.sql in the Supabase SQL editor.";
  }

  if (
    m.includes("invalid api key") ||
    m.includes("invalid jwt") ||
    m.includes("jwt expired") ||
    m.includes("401")
  ) {
    return "Supabase rejected the key. Check SUPABASE_SERVICE_ROLE_KEY is the service_role key (not anon), then redeploy.";
  }

  if (m.includes("openrouter_api_key")) {
    return "Server not configured: OPENROUTER_API_KEY is missing. Set it, then redeploy.";
  }

  if (m.includes("fetch failed") || m.includes("enotfound") || m.includes("econnrefused")) {
    return "Could not reach Supabase. Check SUPABASE_URL is correct and the project is not paused.";
  }

  return "Could not start the tribunal.";
}
