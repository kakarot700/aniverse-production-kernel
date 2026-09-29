'use client';

import { motion, useMotionValue, useReducedMotion, useSpring, type MotionStyle } from 'framer-motion';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { resolveLocalPreviewUrl } from '@/lib/preview-url';
import type { MediaCatalogRecord } from '@/types/media';

interface CatalogCardProps {
  item: MediaCatalogRecord;
  onSelect: (item: MediaCatalogRecord) => void;
}

const STATUS_LABEL: Record<NonNullable<MediaCatalogRecord['status']>, string> = {
  RELEASING: 'Airing',
  FINISHED: '',
  NOT_YET_RELEASED: 'Upcoming',
  CANCELLED: 'Cancelled',
  HIATUS: 'On hiatus',
};

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
  const [imageFailed, setImageFailed] = useState(false);

  // Previously the hover-debounce timer leaked when a card unmounted mid-hover
  // (which happens constantly while paging the grid).
  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    },
    [],
  );

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

  const statusLabel = item.status ? STATUS_LABEL[item.status] : '';
  const poster = imageFailed || !item.coverPoster
    ? `/api/poster?title=${encodeURIComponent(item.title)}&seed=${encodeURIComponent(item.id)}`
    : item.coverPoster;

  return (
    <article className="media-card-wrap">
      <div className="media-card-scene">
        <motion.button
          type="button"
          className="media-card"
          style={cardStyle}
          aria-label={`Open ${item.title}, ${item.genre}${item.year ? `, ${item.year}` : ''}`}
          onClick={() => onSelect(item)}
          onPointerEnter={(event) => {
            if (event.pointerType === 'mouse') startPreview();
          }}
          onPointerMove={updateTilt}
          onPointerLeave={() => {
            stopPreview();
            resetTilt();
          }}
          onFocus={startPreview}
          onBlur={() => {
            stopPreview();
            resetTilt();
          }}
        >
          <div className="poster-frame">
            <img
              className="poster-image"
              src={poster}
              alt=""
              loading="lazy"
              decoding="async"
              onError={() => setImageFailed(true)}
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
                  void event.currentTarget
                    .play()
                    .then(() => setPreviewReady(true))
                    .catch(() => setPreviewReady(false));
                }}
                onError={() => setPreviewReady(false)}
              />
            ) : null}
            <span className="poster-shade" aria-hidden="true" />
            {typeof item.score === 'number' && item.score > 0 ? (
              <span className="poster-score">{item.score}%</span>
            ) : null}
            {statusLabel ? <span className="poster-status">{statusLabel}</span> : null}
            <span className="card-play-mark" aria-hidden="true">
              ▶
            </span>
          </div>
        </motion.button>
      </div>
      <div className="card-meta">
        <h3 title={item.title}>{item.title}</h3>
        {item.year ? <span className="card-year">{item.year}</span> : null}
      </div>
      <p className="card-subline">
        <span>{item.genre}</span>
        <span>{item.format}</span>
      </p>
    </article>
  );
}
