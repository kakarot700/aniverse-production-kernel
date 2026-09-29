import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

type UserClient = SupabaseClient<Database>;

async function requireUserId(client: UserClient): Promise<string> {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error('An authenticated Supabase user is required.');
  return data.user.id;
}

export async function getOwnProfile(client: UserClient) {
  const userId = await requireUserId(client);
  const { data, error } = await client.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw new Error(`Could not load profile: ${error.message}`);
  return data;
}

export async function updateOwnProfile(
  client: UserClient,
  changes: Pick<Database['public']['Tables']['profiles']['Update'], 'display_name' | 'avatar_url'>,
) {
  const userId = await requireUserId(client);
  const { data, error } = await client.from('profiles').update(changes).eq('id', userId).select('*').single();
  if (error) throw new Error(`Could not update profile: ${error.message}`);
  return data;
}

export async function listOwnWatchlist(client: UserClient) {
  const userId = await requireUserId(client);
  const { data, error } = await client.from('watchlists').select('*').eq('user_id', userId).order('created_at', { ascending: false });
  if (error) throw new Error(`Could not load watchlist: ${error.message}`);
  return data;
}

export async function addToOwnWatchlist(client: UserClient, mediaId: string) {
  const userId = await requireUserId(client);
  const normalizedId = mediaId.trim();
  if (!normalizedId || normalizedId.length > 160) throw new Error('A valid media ID is required.');
  const { data, error } = await client.from('watchlists')
    .upsert({ user_id: userId, media_id: normalizedId }, { onConflict: 'user_id,media_id' })
    .select('*').single();
  if (error) throw new Error(`Could not save watchlist item: ${error.message}`);
  return data;
}

export async function removeFromOwnWatchlist(client: UserClient, mediaId: string): Promise<void> {
  const userId = await requireUserId(client);
  const { error } = await client.from('watchlists').delete().eq('user_id', userId).eq('media_id', mediaId);
  if (error) throw new Error(`Could not remove watchlist item: ${error.message}`);
}

export async function recordOwnPlayback(
  client: UserClient,
  entry: { mediaId: string; episodeNumber: number; positionMs: number },
) {
  const userId = await requireUserId(client);
  const mediaId = entry.mediaId.trim();
  if (!mediaId || mediaId.length > 160) throw new Error('A valid media ID is required.');
  if (!Number.isSafeInteger(entry.episodeNumber) || entry.episodeNumber < 1) throw new Error('Episode number must be a positive integer.');
  if (!Number.isSafeInteger(entry.positionMs) || entry.positionMs < 0) throw new Error('Playback position must be a non-negative integer.');

  const { data, error } = await client.from('playback_history').upsert({
    user_id: userId,
    media_id: mediaId,
    episode_number: entry.episodeNumber,
    position_ms: entry.positionMs,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,media_id,episode_number' }).select('*').single();
  if (error) throw new Error(`Could not record playback: ${error.message}`);
  return data;
}

export async function listOwnPlaybackHistory(client: UserClient) {
  const userId = await requireUserId(client);
  const { data, error } = await client.from('playback_history').select('*').eq('user_id', userId).order('updated_at', { ascending: false });
  if (error) throw new Error(`Could not load playback history: ${error.message}`);
  return data;
}
