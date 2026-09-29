'use client';

import type { RealtimeChannel } from '@supabase/supabase-js';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/browser';
import { estimatePeerClockOffset, planPlaybackCorrection, predictPlayheadSeconds } from '@/lib/watch-sync';
import type { PlaybackSnapshot } from '@/types/media';

const ROOM_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ConnectionState = 'idle' | 'connecting' | 'connected' | 'unavailable' | 'error';
interface PeerClock { offsetMs: number; rttMs: number }
interface ClockPing { peerId: string; pingId: string; sentAt: number }
interface ClockPong { peerId: string; targetPeerId: string; pingId: string; peerReceivedAt: number; peerSentAt: number }
interface WatchRoomState { state: ConnectionState; error: string; driftMs: number | null; roundTripMs: number | null }

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

export function useWatchRoom(videoRef: RefObject<HTMLVideoElement | null>, roomId: string) {
  const [roomState, setRoomState] = useState<WatchRoomState>({ state: 'idle', error: '', driftMs: null, roundTripMs: null });
  const peerIdRef = useRef('');
  const sequenceRef = useRef(0);
  const applyingRemoteRef = useRef(false);

  useEffect(() => {
    if (!ROOM_ID_PATTERN.test(roomId)) {
      setRoomState({ state: 'idle', error: '', driftMs: null, roundTripMs: null });
      return;
    }
    const supabase = createBrowserSupabaseClient();
    if (!supabase) {
      setRoomState({ state: 'unavailable', error: 'Add Supabase URL and publishable key to connect watch rooms.', driftMs: null, roundTripMs: null });
      return;
    }

    const peerId = peerIdRef.current || (peerIdRef.current = crypto.randomUUID());
    const clockByPeer = new Map<string, PeerClock>();
    const samplesByPeer = new Map<string, Array<{ offsetMs: number; rttMs: number }>>();
    const lastSequenceByPeer = new Map<string, number>();
    const pendingPings = new Map<string, number>();
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

    const sendClockPing = () => {
      const sentAt = Date.now();
      const pingId = crypto.randomUUID();
      pendingPings.set(pingId, sentAt);
      send('clock-ping', { peerId, pingId, sentAt });
      window.setTimeout(() => pendingPings.delete(pingId), 12_000);
    };

    const publishPlayback = (video: HTMLVideoElement) => {
      const now = Date.now();
      if (!subscribed || applyingRemoteRef.current || now - lastSentAt < 180) return;
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
      const peerReceivedAt = Date.now();
      const peerSentAt = Date.now();
      send('clock-pong', { peerId, targetPeerId: payload.peerId, pingId: payload.pingId, peerReceivedAt, peerSentAt });
    };

    const onPong = (payload: unknown) => {
      if (!isClockPong(payload) || payload.targetPeerId !== peerId) return;
      const localSentAt = pendingPings.get(payload.pingId);
      if (localSentAt === undefined) return;
      pendingPings.delete(payload.pingId);
      const sample = estimatePeerClockOffset({ localSentAt, peerReceivedAt: payload.peerReceivedAt, peerSentAt: payload.peerSentAt, localReceivedAt: Date.now() });
      const samples = samplesByPeer.get(payload.peerId) ?? [];
      samples.push(sample);
      samplesByPeer.set(payload.peerId, samples.slice(-7));
      const bestSamples = [...samples].sort((left, right) => left.rttMs - right.rttMs).slice(0, 3).sort((left, right) => left.offsetMs - right.offsetMs);
      const selected = bestSamples[Math.floor(bestSamples.length / 2)] ?? sample;
      clockByPeer.set(payload.peerId, selected);
      setRoomState((current) => ({ ...current, roundTripMs: Math.round(selected.rttMs) }));
    };

    const onPlayback = (payload: unknown) => {
      if (!isPlaybackSnapshot(payload) || payload.peerId === peerId) return;
      const lastSequence = lastSequenceByPeer.get(payload.peerId) ?? -1;
      if (payload.sequence <= lastSequence) return;
      lastSequenceByPeer.set(payload.peerId, payload.sequence);

      const video = videoRef.current;
      if (!video) return;
      const peerClock = clockByPeer.get(payload.peerId) ?? { offsetMs: 0, rttMs: 0 };
      const targetSeconds = predictPlayheadSeconds(payload, Date.now(), peerClock.offsetMs);
      const correction = planPlaybackCorrection(video.currentTime, targetSeconds, payload.playing, 10);
      setRoomState((current) => ({ ...current, driftMs: Math.round(correction.driftMs) }));
      applyingRemoteRef.current = true;

      if (correction.kind === 'seek') {
        const ceiling = Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.03) : correction.targetSeconds;
        video.currentTime = Math.min(correction.targetSeconds, ceiling);
      } else if (correction.kind === 'rate' && payload.playing) {
        video.playbackRate = correction.playbackRate;
        if (resetRateTimer !== null) window.clearTimeout(resetRateTimer);
        resetRateTimer = window.setTimeout(() => {
          if (videoRef.current) videoRef.current.playbackRate = 1;
        }, 1500);
      } else if (correction.kind === 'none') {
        video.playbackRate = 1;
      }

      if (payload.playing && video.paused) {
        void video.play().catch(() => {
          setRoomState((current) => ({ ...current, error: 'Browser autoplay is blocked; press play to follow the room.' }));
        });
      } else if (!payload.playing && !video.paused) {
        video.pause();
      }
      window.setTimeout(() => { applyingRemoteRef.current = false; }, 90);
    };

    channel
      .on('broadcast', { event: 'clock-ping' }, ({ payload }) => onPing(payload))
      .on('broadcast', { event: 'clock-pong' }, ({ payload }) => onPong(payload))
      .on('broadcast', { event: 'playback' }, ({ payload }) => onPlayback(payload))
      .subscribe((status, error) => {
        if (status === 'SUBSCRIBED') {
          subscribed = true;
          setRoomState({ state: 'connected', error: '', driftMs: null, roundTripMs: null });
          sendClockPing();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          subscribed = false;
          setRoomState((current) => ({ ...current, state: 'error', error: error?.message || 'Realtime room connection failed.' }));
        } else if (status === 'CLOSED') {
          subscribed = false;
          setRoomState((current) => ({ ...current, state: 'idle' }));
        } else {
          setRoomState((current) => ({ ...current, state: 'connecting' }));
        }
      });

    const pingTimer = window.setInterval(sendClockPing, 2500);
    const video = videoRef.current;
    const publishOnPlaybackEvent = () => {
      if (video) publishPlayback(video);
    };
    const publishOnTimeUpdate = () => {
      if (video) publishPlayback(video);
    };
    video?.addEventListener('play', publishOnPlaybackEvent);
    video?.addEventListener('pause', publishOnPlaybackEvent);
    video?.addEventListener('seeked', publishOnPlaybackEvent);
    video?.addEventListener('timeupdate', publishOnTimeUpdate);

    return () => {
      window.clearInterval(pingTimer);
      if (resetRateTimer !== null) window.clearTimeout(resetRateTimer);
      video?.removeEventListener('play', publishOnPlaybackEvent);
      video?.removeEventListener('pause', publishOnPlaybackEvent);
      video?.removeEventListener('seeked', publishOnPlaybackEvent);
      video?.removeEventListener('timeupdate', publishOnTimeUpdate);
      subscribed = false;
      void supabase.removeChannel(channel);
    };
  }, [roomId, videoRef]);

  return roomState;
}
