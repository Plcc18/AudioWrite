import { createBrowserClient } from "@supabase/ssr";

// Importante: o acesso precisa ser estático (process.env.NEXT_PUBLIC_X), não
// dinâmico (process.env[nomeVariavel]) — o webpack do Next só consegue
// substituir NEXT_PUBLIC_* pelo valor real no bundle do navegador quando
// analisa a expressão de forma estática em tempo de build.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let browserClient: ReturnType<typeof createBrowserClient> | null = null;

/** Cliente Supabase para uso em componentes client-side ("use client"). */
export function getSupabaseBrowserClient() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY não configuradas. Veja .env.example."
    );
  }
  if (!browserClient) {
    browserClient = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return browserClient;
}
