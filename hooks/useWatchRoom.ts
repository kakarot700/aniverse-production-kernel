'use client';

import type { RealtimeChannel } from '@supabase/supabase-js';
import { useEffect, useRef, useState } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/browser';
import { estimatePeerClockOffset, planPlaybackCorrection, predictPlayheadSeconds } from '@/lib/watch-sync';
import type { PlaybackSnapshot } from '@/types/media';

const ROOM_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEARTBEAT_MS = 4_000;
const MIN_PUBLISH_GAP_MS = 180;
const REMOTE_APPLY_WINDOW_MS = 120;

type ConnectionState = 'idle' | 'connecting' | 'connected' | 'unavailable' | 'error';
interface PeerClock { offsetMs: number; rttMs: number }
interface ClockPing { peerId: string; pingId: string; sentAt: number }
interface ClockPong { peerId: string; targetPeerId: string; pingId: string; peerReceivedAt: number; peerSentAt: number }
interface WatchRoomState { state: ConnectionState; error: string; driftMs: number | null; roundTripMs: number | null; peers: number }

function isPlaybackSnapshot(value: unknown): value is PlaybackSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Record<string, unknown>;
  return typeof snapshot.peerId === 'string'
    && typeof snapshot.sequence === 'number'
    && Number.isSafeInteger(snapshot.sequence)
    && typeof snapshot.positionMs === 'number'
    && Number.isFinite(snapshot.positionMs)
    && snapshot.positionMs >= 0
    && typeof snapshot.playing === 'boolean'
    && typeof snapshot.sentAt === 'number'
    && Number.isFinite(snapshot.sentAt);
}

function isClockPing(value: unknown): value is ClockPing {
  if (!value || typeof value !== 'object') return false;
  const ping = value as Partial<ClockPing>;
  return typeof ping.peerId === 'string' && typeof ping.pingId === 'string' && Number.isFinite(ping.sentAt);
}

function isClockPong(value: unknown): value is ClockPong {
  if (!value || typeof value !== 'object') return false;
  const pong = value as Partial<ClockPong>;
  return typeof pong.peerId === 'string' && typeof pong.targetPeerId === 'string'
    && typeof pong.pingId === 'string' && Number.isFinite(pong.peerReceivedAt)
    && Number.isFinite(pong.peerSentAt);
}

const IDLE_STATE: WatchRoomState = { state: 'idle', error: '', driftMs: null, roundTripMs: null, peers: 0 };

/**
 * Joins a private Supabase Broadcast room and keeps the supplied video element
 * aligned with its peers.
 *
 * Takes the resolved element rather than a ref so listeners re-bind when the
 * player swaps its `<video>`; a ref captured once goes stale and silently stops
 * publishing.
 */
export function useWatchRoom(video: HTMLVideoElement | null, roomId: string) {
  const [roomState, setRoomState] = useState<WatchRoomState>(IDLE_STATE);
  const peerIdRef = useRef('');
  const sequenceRef = useRef(0);
  const suppressUntilRef = useRef(0);

  useEffect(() => {
    if (!ROOM_ID_PATTERN.test(roomId)) {
      setRoomState(IDLE_STATE);
      return;
    }
    const supabase = createBrowserSupabaseClient();
    if (!supabase) {
      setRoomState({
        ...IDLE_STATE,
        state: 'unavailable',
        error: 'Add the Supabase URL and publishable key to connect watch rooms.',
      });
      return;
    }

    const peerId = peerIdRef.current || (peerIdRef.current = crypto.randomUUID());
    const clockByPeer = new Map<string, PeerClock>();
    const samplesByPeer = new Map<string, Array<{ offsetMs: number; rttMs: number }>>();
    const lastSequenceByPeer = new Map<string, number>();
    const lastSeenByPeer = new Map<string, number>();
    const pendingPings = new Map<string, number>();
    const pingTimeouts = new Set<number>();

    let subscribed = false;
    let lastSentAt = 0;
    let resetRateTimer: number | null = null;

    const channel: RealtimeChannel = supabase.channel(`aniverse:watch-room:${roomId}`, {
      config: { private: true, broadcast: { ack: false, self: false } },
    });

    const send = (event: string, payload: object) => {
      if (!subscribed) return;
      void channel.send({ type: 'broadcast', event, payload: payload as Record<string, unknown> }).catch(() => {
        setRoomState((current) => ({ ...current, error: 'A room update could not be delivered.' }));
      });
    };

    const notePeer = (remotePeerId: string) => {
      lastSeenByPeer.set(remotePeerId, Date.now());
      const active = [...lastSeenByPeer.values()].filter((seen) => Date.now() - seen < 20_000).length;
      setRoomState((current) => (current.peers === active ? current : { ...current, peers: active }));
    };

    const sendClockPing = () => {
      if (!subscribed) return;
      const sentAt = Date.now();
      const pingId = crypto.randomUUID();
      pendingPings.set(pingId, sentAt);
      send('clock-ping', { peerId, pingId, sentAt });
      const timeout = window.setTimeout(() => {
        pendingPings.delete(pingId);
        pingTimeouts.delete(timeout);
      }, 12_000);
      pingTimeouts.add(timeout);
    };

    const publishPlayback = (force = false) => {
      if (!video || !subscribed) return;
      const now = Date.now();
      if (now < suppressUntilRef.current) return;
      if (!force && now - lastSentAt < MIN_PUBLISH_GAP_MS) return;
      lastSentAt = now;
      sequenceRef.current += 1;
      const snapshot: PlaybackSnapshot = {
        peerId,
        sequence: sequenceRef.current,
        positionMs: Math.max(0, Math.round(video.currentTime * 1000)),
        playing: !video.paused && !video.ended,
        sentAt: now,
      };
      send('playback', snapshot);
    };

    const onPing = (payload: unknown) => {
      if (!isClockPing(payload) || payload.peerId === peerId) return;
      notePeer(payload.peerId);
      const at = Date.now();
      send('clock-pong', {
        peerId,
        targetPeerId: payload.peerId,
        pingId: payload.pingId,
        peerReceivedAt: at,
        peerSentAt: Date.now(),
      });
    };

    const onPong = (payload: unknown) => {
      if (!isClockPong(payload) || payload.targetPeerId !== peerId) return;
      notePeer(payload.peerId);
      const localSentAt = pendingPings.get(payload.pingId);
      if (localSentAt === undefined) return;
      pendingPings.delete(payload.pingId);

      const sample = estimatePeerClockOffset({
        localSentAt,
        peerReceivedAt: payload.peerReceivedAt,
        peerSentAt: payload.peerSentAt,
        localReceivedAt: Date.now(),
      });
      const samples = [...(samplesByPeer.get(payload.peerId) ?? []), sample].slice(-7);
      samplesByPeer.set(payload.peerId, samples);
      // Median offset of the three lowest-RTT samples resists jitter spikes.
      const bestSamples = [...samples]
        .sort((left, right) => left.rttMs - right.rttMs)
        .slice(0, 3)
        .sort((left, right) => left.offsetMs - right.offsetMs);
      const selected = bestSamples[Math.floor(bestSamples.length / 2)] ?? sample;
      clockByPeer.set(payload.peerId, selected);
      setRoomState((current) => ({ ...current, roundTripMs: Math.round(selected.rttMs) }));
    };

    const onPlayback = (payload: unknown) => {
      if (!isPlaybackSnapshot(payload) || payload.peerId === peerId) return;
      notePeer(payload.peerId);
      const lastSequence = lastSequenceByPeer.get(payload.peerId) ?? -1;
      if (payload.sequence <= lastSequence) return;
      lastSequenceByPeer.set(payload.peerId, payload.sequence);
      if (!video) return;

      const peerClock = clockByPeer.get(payload.peerId) ?? { offsetMs: 0, rttMs: 0 };
      const targetSeconds = predictPlayheadSeconds(payload, Date.now(), peerClock.offsetMs);
      const correction = planPlaybackCorrection(video.currentTime, targetSeconds, payload.playing, 10);
      setRoomState((current) => ({ ...current, driftMs: Math.round(correction.driftMs) }));

      // Suppress our own publisher while the remote state is being applied so
      // two clients cannot echo each other into a correction loop.
      suppressUntilRef.current = Date.now() + REMOTE_APPLY_WINDOW_MS;

      if (correction.kind === 'seek') {
        const ceiling = Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.03) : correction.targetSeconds;
        video.currentTime = Math.min(correction.targetSeconds, ceiling);
      } else if (correction.kind === 'rate' && payload.playing) {
        video.playbackRate = correction.playbackRate;
        if (resetRateTimer !== null) window.clearTimeout(resetRateTimer);
        resetRateTimer = window.setTimeout(() => {
          if (video) video.playbackRate = 1;
        }, 1500);
      } else if (correction.kind === 'none' && video.playbackRate !== 1) {
        video.playbackRate = 1;
      }

      if (payload.playing && video.paused) {
        void video.play().catch(() => {
          setRoomState((current) => ({
            ...current,
            error: 'Browser autoplay is blocked; press play once to follow the room.',
          }));
        });
      } else if (!payload.playing && !video.paused) {
        video.pause();
      }
    };

    channel
      .on('broadcast', { event: 'clock-ping' }, ({ payload }) => onPing(payload))
      .on('broadcast', { event: 'clock-pong' }, ({ payload }) => onPong(payload))
      .on('broadcast', { event: 'playback' }, ({ payload }) => onPlayback(payload))
      .subscribe((status, error) => {
        if (status === 'SUBSCRIBED') {
          subscribed = true;
          setRoomState({ state: 'connected', error: '', driftMs: null, roundTripMs: null, peers: 0 });
          sendClockPing();
          publishPlayback(true);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          subscribed = false;
          setRoomState((current) => ({
            ...current,
            state: 'error',
            error: error?.message || 'Realtime room connection failed.',
          }));
        } else if (status === 'CLOSED') {
          subscribed = false;
          setRoomState((current) => ({ ...current, state: 'idle' }));
        } else {
          setRoomState((current) => ({ ...current, state: 'connecting' }));
        }
      });

    const pingTimer = window.setInterval(sendClockPing, 2_500);
    // A slow heartbeat keeps late joiners aligned without flooding the channel
    // the way a per-`timeupdate` publish did.
    const heartbeatTimer = window.setInterval(() => {
      if (video && !video.paused) publishPlayback(true);
    }, HEARTBEAT_MS);

    const publishNow = () => publishPlayback(true);
    const publishThrottled = () => publishPlayback(false);
    video?.addEventListener('play', publishNow);
    video?.addEventListener('pause', publishNow);
    video?.addEventListener('seeked', publishNow);
    video?.addEventListener('ratechange', publishThrottled);

    return () => {
      window.clearInterval(pingTimer);
      window.clearInterval(heartbeatTimer);
      if (resetRateTimer !== null) window.clearTimeout(resetRateTimer);
      for (const timeout of pingTimeouts) window.clearTimeout(timeout);
      pingTimeouts.clear();
      video?.removeEventListener('play', publishNow);
      video?.removeEventListener('pause', publishNow);
      video?.removeEventListener('seeked', publishNow);
      video?.removeEventListener('ratechange', publishThrottled);
      subscribed = false;
      void supabase.removeChannel(channel);
    };
  }, [roomId, video]);

  return roomState;
}
