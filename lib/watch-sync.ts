import type { PlaybackSnapshot } from '@/types/media';

export interface ClockSample {
  localSentAt: number;
  peerReceivedAt: number;
  peerSentAt: number;
  localReceivedAt: number;
}

export type PlaybackCorrection =
  | { kind: 'none'; driftMs: number }
  | { kind: 'seek'; driftMs: number; targetSeconds: number }
  | { kind: 'rate'; driftMs: number; playbackRate: number };

export function estimatePeerClockOffset(sample: ClockSample): { offsetMs: number; rttMs: number } {
  const networkRoundTrip = Math.max(0, (sample.localReceivedAt - sample.localSentAt) - (sample.peerSentAt - sample.peerReceivedAt));
  const offsetMs = ((sample.peerReceivedAt - sample.localSentAt) + (sample.peerSentAt - sample.localReceivedAt)) / 2;
  return { offsetMs, rttMs: networkRoundTrip };
}

export function predictPlayheadSeconds(snapshot: PlaybackSnapshot, localNow: number, peerOffsetMs: number): number {
  const elapsedMs = snapshot.playing ? Math.max(0, localNow + peerOffsetMs - snapshot.sentAt) : 0;
  return Math.max(0, (snapshot.positionMs + elapsedMs) / 1000);
}

export function planPlaybackCorrection(
  currentSeconds: number,
  targetSeconds: number,
  playing: boolean,
  toleranceMs = 10,
): PlaybackCorrection {
  const driftMs = (targetSeconds - currentSeconds) * 1000;
  if (Math.abs(driftMs) <= toleranceMs) return { kind: 'none', driftMs };
  if (!playing || Math.abs(driftMs) >= 300) return { kind: 'seek', driftMs, targetSeconds };
  const playbackRate = Math.min(1.03, Math.max(0.97, 1 + driftMs / 5000));
  return { kind: 'rate', driftMs, playbackRate };
}
