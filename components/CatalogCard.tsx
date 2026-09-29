'use client';

import { motion, useMotionValue, useReducedMotion, useSpring, type MotionStyle } from 'framer-motion';
import { useRef, useState, type PointerEvent } from 'react';
import { resolveLocalPreviewUrl } from '@/lib/preview-url';
import { formatLabel } from '@/lib/anime/text';
import type { AnimeSummary } from '@/types/anime';

interface CatalogCardProps {
  item: AnimeSummary;
  onSelect: (item: AnimeSummary) => void;
}

const FALLBACK_POSTER = '/posters/aurora.jpg';

export function CatalogCard({ item, onSelect }: CatalogCardProps) {
  const previewSource = resolveLocalPreviewUrl(item.previewUrl);
  const reduceMotion = useReducedMotion();
  const rotateX = useMotionValue(0);
  const rotateY = useMotionValue(0);
  const springRotateX = useSpring(rotateX, { stiffness: 175, damping: 22, mass: 0.48 });
  const springRotateY = useSpring(rotateY, { stiffness: 175, damping: 22, mass: 0.48 });
  const timerRef = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [previewArmed, setPreviewArmed] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const [posterSrc, setPosterSrc] = useState(item.coverImage || FALLBACK_POSTER);

  const cardStyle: MotionStyle = {
    rotateX: springRotateX,
    rotateY: springRotateY,
    transformStyle: 'preserve-3d',
  };

  const startPreview = () => {
    if (!previewSource) return;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setPreviewReady(false);
      setPreviewArmed(true);
    }, 300);
  };

  const stopPreview = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    setPreviewArmed(false);
    setPreviewReady(false);
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.currentTime = 0;
    }
  };

  const updateTilt = (event: PointerEvent<HTMLButtonElement>) => {
    if (reduceMotion || event.pointerType !== 'mouse') return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
    rotateX.set((0.5 - y) * 7);
    rotateY.set((x - 0.5) * 8);
    event.currentTarget.style.setProperty('--cursor-x', `${(x * 100).toFixed(1)}%`);
    event.currentTarget.style.setProperty('--cursor-y', `${(y * 100).toFixed(1)}%`);
  };

  const resetTilt = () => {
    rotateX.set(0);
    rotateY.set(0);
  };

  const score = item.averageScore != null ? Math.round(item.averageScore) / 10 : null;
  const episodeLabel = item.format === 'MOVIE'
    ? 'Movie'
    : item.episodeCount
      ? `${item.episodeCount} ep`
      : item.status === 'RELEASING'
        ? 'Airing'
        : formatLabel(item.format);

  return (
    <article className="media-card-wrap">
      <div className="media-card-scene">
        <motion.button
          type="button"
          className="media-card"
          style={cardStyle}
          aria-label={`Open ${item.title}${item.year ? `, ${item.year}` : ''}${item.genres[0] ? `, ${item.genres[0]}` : ''}`}
          onClick={() => onSelect(item)}
          onPointerEnter={(event) => { if (event.pointerType === 'mouse') startPreview(); }}
          onPointerMove={updateTilt}
          onPointerLeave={() => { stopPreview(); resetTilt(); }}
          onFocus={startPreview}
          onBlur={() => { stopPreview(); resetTilt(); }}
        >
          <div className="poster-frame">
            <img
              className="poster-image"
              src={posterSrc}
              alt=""
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              onError={() => setPosterSrc(FALLBACK_POSTER)}
            />
            {previewArmed && previewSource ? (
              <video
                ref={videoRef}
                className={`preview-video${previewReady ? ' is-ready' : ''}`}
                src={previewSource}
                muted
                loop
                playsInline
                preload="none"
                aria-hidden="true"
                onCanPlay={(event) => {
                  void event.currentTarget.play().then(() => setPreviewReady(true)).catch(() => setPreviewReady(false));
                }}
                onError={() => setPreviewReady(false)}
              />
            ) : null}
            <span className="poster-shade" aria-hidden="true" />
            {score !== null ? <span className="card-score" aria-hidden="true">★ {score.toFixed(1)}</span> : null}
            <span className="card-play-mark" aria-hidden="true">▶</span>
            <span className="card-corner" aria-hidden="true">{episodeLabel}</span>
          </div>
        </motion.button>
      </div>
      <div className="card-meta">
        <h3 title={item.title}>{item.title}</h3>
      </div>
      <p className="card-subline">
        <span>{item.year ?? 'TBA'}</span>
        <span>{formatLabel(item.format)}</span>
        {item.genres[0] ? <span>{item.genres[0]}</span> : null}
      </p>
    </article>
  );
}
