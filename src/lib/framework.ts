import type { SupabaseClient } from "@supabase/supabase-js";
import type { FrameworkDefinition } from "@/lib/scoring";

export type FrameworkVersion = {
  version: number;
  definition: FrameworkDefinition;
};

/** Fetches the latest published framework version (RLS: authenticated select where published = true). */
export async function getPublishedFramework(
  supabase: SupabaseClient
): Promise<FrameworkVersion | null> {
  const { data } = await supabase
    .from("framework_versions")
    .select("version, definition")
    .eq("published", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  return { version: data.version, definition: data.definition as FrameworkDefinition };
}
