'use client';

import { useState, type FormEvent } from 'react';
import type { SupabaseUserState } from '@/hooks/useSupabaseUser';

interface AccountPanelProps {
  account: SupabaseUserState;
  savedCount: number;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Email magic-link sign-in.
 *
 * Deliberately passwordless and provider-agnostic: it works against a stock
 * Supabase project with no OAuth application to register, and there is no
 * password for this app to handle or store.
 */
export function AccountPanel({ account, savedCount }: AccountPanelProps) {
  const { client, user, loading, configured } = account;
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  if (!configured) return null;

  const sendLink = async (event: FormEvent) => {
    event.preventDefault();
    if (!client) return;

    const candidate = email.trim();
    if (!EMAIL_PATTERN.test(candidate)) {
      setStatus('Enter a valid email address.');
      return;
    }

    setBusy(true);
    setStatus('');
    const { error } = await client.auth.signInWithOtp({
      email: candidate,
      options: { emailRedirectTo: window.location.origin },
    });
    setBusy(false);
    // Always report the same outcome, so this form cannot be used to probe
    // which addresses have accounts.
    setStatus(
      error
        ? 'Could not send the sign-in link. Check the Supabase email settings and try again.'
        : 'Check your inbox for a sign-in link.',
    );
  };

  const signOut = async () => {
    if (!client) return;
    setBusy(true);
    await client.auth.signOut();
    setBusy(false);
    setOpen(false);
    setStatus('');
  };

  if (loading) return <span className="account-chip account-chip-quiet">…</span>;

  if (user) {
    return (
      <div className="account-wrap">
        <button
          type="button"
          className="account-chip"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <span className="account-avatar" aria-hidden="true">
            {(user.email ?? '?').charAt(0).toUpperCase()}
          </span>
          <span className="account-label">{savedCount > 0 ? `${savedCount} saved` : 'Account'}</span>
        </button>
        {open ? (
          <div className="account-popover" role="dialog" aria-label="Account">
            <p className="account-email">{user.email}</p>
            <p className="account-hint">Your list and playback progress sync to this account.</p>
            <button className="button-quiet" type="button" onClick={() => void signOut()} disabled={busy}>
              Sign out
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="account-wrap">
      <button type="button" className="account-chip" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className="account-label">Sign in</span>
      </button>
      {open ? (
        <div className="account-popover" role="dialog" aria-label="Sign in">
          <p className="account-hint">Sign in to keep a watchlist and resume where you left off.</p>
          <form className="account-form" onSubmit={(event) => void sendLink(event)}>
            <label className="sr-only" htmlFor="account-email">
              Email address
            </label>
            <input
              id="account-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              maxLength={200}
              disabled={busy}
            />
            <button type="submit" disabled={busy}>
              {busy ? '…' : 'Send link'}
            </button>
          </form>
          {status ? (
            <p className="account-status" role="status">
              {status}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
