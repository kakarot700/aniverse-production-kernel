'use client';

import type { Session, SupabaseClient, User } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import type { Database } from '@/lib/supabase/database.types';

export interface SupabaseUserState {
  client: SupabaseClient<Database> | null;
  user: User | null;
  /** `true` until the first `getUser()` round trip settles. */
  loading: boolean;
  /** `false` when no public Supabase config is present. */
  configured: boolean;
}

/**
 * Current Supabase user, kept in sync with `onAuthStateChange`.
 *
 * `@supabase/ssr` is imported dynamically rather than at module scope. It is
 * ~70 kB of client JavaScript that only matters once a project is configured,
 * and static-importing it here pulled the whole auth stack into the initial
 * bundle for every visitor, signed in or not.
 *
 * Uses `getUser()` for the initial read rather than `getSession()`: the
 * session cookie is client-readable and can be stale or forged, while
 * `getUser()` is validated against the auth server.
 */
export function useSupabaseUser(): SupabaseUserState {
  const configured = isSupabaseConfigured();
  const [client, setClient] = useState<SupabaseClient<Database> | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(configured);

  useEffect(() => {
    if (!configured) {
      setLoading(false);
      return;
    }

    let active = true;
    void import('@/lib/supabase/browser')
      .then(({ createBrowserSupabaseClient }) => {
        if (!active) return;
        setClient(createBrowserSupabaseClient());
      })
      .catch(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [configured]);

  useEffect(() => {
    if (!client) return;
    let active = true;

    void client.auth
      .getUser()
      .then(({ data }) => {
        if (active) setUser(data.user ?? null);
      })
      .catch(() => {
        if (active) setUser(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    const { data } = client.auth.onAuthStateChange((_event, session: Session | null) => {
      if (!active) return;
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [client]);

  return { client, user, loading, configured };
}
