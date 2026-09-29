import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { getPublicSupabaseConfig } from './lib/supabase/config';

export async function middleware(request: NextRequest) {
  const config = getPublicSupabaseConfig();
  if (!config) return NextResponse.next({ request });

  let response = NextResponse.next({ request });
  const supabase = createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        for (const [header, value] of Object.entries(headers ?? {})) response.headers.set(header, value);
      },
    },
  });

  await supabase.auth.getClaims();
  return response;
}

export const config = {
  // API routes are session-free, and `/api/proxy` serves every HLS segment —
  // running a Supabase token refresh on those requests added a network
  // round-trip to each segment fetch.
  matcher: [
    '/((?!api/|_next/static|_next/image|favicon.ico|posters/|previews/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|webm|ico)$).*)',
  ],
};
