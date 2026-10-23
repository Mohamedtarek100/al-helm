/**
 * Type environment for Supabase Edge Functions (Deno runtime).
 *
 * Edge functions import supabase-js from esm.sh, which the TypeScript CLI
 * cannot resolve. This declaration aliases the esm.sh specifier onto the
 * locally installed @supabase/supabase-js package types, giving the editor
 * and `tsc -p supabase/tsconfig.json` the same real types the Deno runtime
 * serves at deploy time. No runtime code depends on this file.
 */

declare module 'https://esm.sh/@supabase/supabase-js@2' {
  export * from '@supabase/supabase-js'
}
