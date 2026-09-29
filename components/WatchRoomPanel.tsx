'use client';

import { useEffect, useState, type RefObject } from 'react';
import { useWatchRoom } from '@/hooks/useWatchRoom';
import { isSupabaseConfigured } from '@/lib/supabase/config';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getRoomFromUrl(): string {
  if (typeof window === 'undefined') return '';
  const value = new URL(window.location.href).searchParams.get('room') ?? '';
  return UUID_PATTERN.test(value) ? value : '';
}

function updateRoomUrl(roomId: string): void {
  const url = new URL(window.location.href);
  if (roomId) url.searchParams.set('room', roomId);
  else url.searchParams.delete('room');
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

interface WatchRoomPanelProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Changes whenever the `<video>` element mounts, so the hook can re-bind. */
  videoEpoch?: number;
  /** Set when sync cannot work, e.g. a cross-origin embedded player. */
  unavailableReason?: string;
}

export function WatchRoomPanel({ videoRef, videoEpoch = 0, unavailableReason = '' }: WatchRoomPanelProps) {
  const [roomId, setRoomId] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const connected = isSupabaseConfigured() && !unavailableReason;
  const room = useWatchRoom(videoRef, roomId, videoEpoch);

  useEffect(() => {
    const existingRoom = getRoomFromUrl();
    if (existingRoom) setRoomId(existingRoom);
  }, []);

  const createRoom = () => {
    const nextRoom = crypto.randomUUID();
    setRoomId(nextRoom);
    updateRoomUrl(nextRoom);
    setCopyStatus('New room created. Copy its link to invite someone.');
  };

  const joinRoom = () => {
    const candidate = joinCode.trim().match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0] ?? '';
    if (!UUID_PATTERN.test(candidate)) {
      setCopyStatus('Enter a complete room UUID or paste its invite link.');
      return;
    }
    setRoomId(candidate);
    updateRoomUrl(candidate);
    setCopyStatus('Joining room…');
  };

  const copyInvite = async () => {
    if (!roomId) return;
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopyStatus('Invite link copied. Anyone with this link can join.');
    } catch {
      setCopyStatus(`Copy the current address to invite someone: ${window.location.href}`);
    }
  };

  const leaveRoom = () => {
    setRoomId('');
    updateRoomUrl('');
    setCopyStatus('You left the room.');
  };

  const stateLabel = room.state === 'connected' ? 'Connected over Realtime'
    : room.state === 'connecting' ? 'Connecting to room…'
      : room.state === 'unavailable' ? 'Supabase not configured'
        : room.state === 'error' ? 'Room connection issue'
          : roomId ? 'Waiting to connect' : 'No room active';

  return (
    <aside className="room-panel" aria-labelledby="watch-room-title">
      <h3 id="watch-room-title">Watch together</h3>
      <p>Share a room to follow play, pause, and seek updates. Sync is best-effort over your network.</p>
      <div className="room-actions">
        {!roomId ? (
          <button className="button-primary" type="button" onClick={createRoom} disabled={!connected}>Create a room</button>
        ) : (
          <>
            <button className="button-primary" type="button" onClick={() => void copyInvite()}>Copy invite link</button>
            <button className="button-quiet" type="button" onClick={leaveRoom}>Leave room</button>
          </>
        )}
      </div>
      {!roomId ? (
        <form className="room-join" onSubmit={(event) => { event.preventDefault(); joinRoom(); }}>
          <label className="sr-only" htmlFor="room-code">Room UUID or invite link</label>
          <input id="room-code" value={joinCode} onChange={(event) => setJoinCode(event.target.value)} placeholder="Paste a room invite" maxLength={180} disabled={!connected} />
          <button type="submit" disabled={!connected}>Join</button>
        </form>
      ) : <p className="room-code" aria-label="Current room ID">{roomId}</p>}
      <p className="room-status" role="status" aria-live="polite">{room.error || copyStatus || stateLabel}</p>
      {roomId ? <div className="room-metrics"><span>{stateLabel}</span><span>{room.driftMs === null ? '—' : `Drift ${room.driftMs} ms`}</span><span>{room.roundTripMs === null ? '—' : `RTT ${room.roundTripMs} ms`}</span></div> : null}
      {unavailableReason ? (
        <p className="room-status">{unavailableReason}</p>
      ) : !connected ? (
        <p className="room-status">Configure the public Supabase URL and publishable key to enable room sync.</p>
      ) : null}
    </aside>
  );
}
