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
  /**
   * Page requests only.
   *
   * The previous matcher also covered `/api/*`, which meant every single HLS
   * segment fetched through `/api/proxy` triggered a Supabase session refresh
   * — an extra network round trip per segment, several per second during
   * playback. API routes that need a user build their own client instead.
   */
  matcher: [
    '/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|webm|ico|txt|xml)$).*)',
  ],
};
