'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react';
import { CatalogCard } from '@/components/CatalogCard';
import { MasterPlayer } from '@/components/MasterPlayer';
import { WatchRoomPanel } from '@/components/WatchRoomPanel';
import type { MediaCatalogRecord } from '@/types/media';

interface AniverseExperienceProps { items: MediaCatalogRecord[] }
const ROOM_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function AniverseExperience({ items }: AniverseExperienceProps) {
  const [query, setQuery] = useState('');
  const [activeGenre, setActiveGenre] = useState('All');
  const [selected, setSelected] = useState<MediaCatalogRecord | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const featured = items[0];
  const genres = useMemo(() => ['All', ...new Set(items.map((item) => item.genre))], [items]);
  const filteredItems = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return items.filter((item) => {
      const matchesGenre = activeGenre === 'All' || item.genre === activeGenre;
      const matchesSearch = !needle || `${item.title} ${item.synopsis} ${item.genre}`.toLocaleLowerCase().includes(needle);
      return matchesGenre && matchesSearch;
    });
  }, [activeGenre, items, query]);

  useEffect(() => {
    const roomId = new URL(window.location.href).searchParams.get('room') ?? '';
    if (ROOM_ID_PATTERN.test(roomId) && featured) {
      setSelected(featured);
    }
  }, [featured]);

  const openTitle = (item: MediaCatalogRecord) => {
    setSelected(item);
  };

  const openWatchRoom = () => {
    if (!featured) return;
    setSelected(featured);
  };

  return (
    <div className="site-shell">
      <div className="mesh-backdrop" aria-hidden="true" />
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Aniverse home"><span className="brand-mark" aria-hidden="true">a</span><span>ANIVERSE</span></a>
        <nav className="header-nav" aria-label="Main navigation">
          <a href="#collection">Discover</a>
          <a href="#about">About</a>
          <button type="button" onClick={openWatchRoom}>Watch together</button>
        </nav>
        <span className="header-note">A little room for wonder</span>
      </header>

      <main id="top">
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow">A softer kind of streaming</p>
            <h1 id="hero-title">Find your next little world.</h1>
            <p>Thoughtful animated stories, gathered in one calm place. Settle in, discover something new, and share the quiet moments.</p>
            <a className="button-primary" href="#collection">Explore the collection <span aria-hidden="true">↘</span></a>
          </div>
          {featured ? (
            <button className="hero-art" type="button" onClick={() => openTitle(featured)} aria-label={`Explore featured story ${featured.title}`}>
              <img src={featured.coverPoster} alt="" fetchPriority="high" />
              <span className="featured-seal">A small wonder</span>
              <span className="hero-art-copy"><span>Featured story · {featured.year}</span><strong>{featured.title}</strong><small>{featured.genre} · {featured.format}</small></span>
            </button>
          ) : null}
        </section>

        <section id="collection" className="collection" aria-labelledby="collection-title">
          <div className="collection-head">
            <div><p className="eyebrow">The collection</p><h2 id="collection-title">Made for unhurried evenings</h2><p className="collection-caption">Small beginnings, strange horizons, and stories that stay a little longer.</p></div>
            <label className="search-wrap"><span className="search-mark" aria-hidden="true" /><span className="sr-only">Search stories</span><input ref={searchRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a story" /></label>
          </div>
          <div className="genre-row" role="group" aria-label="Filter by genre">
            {genres.map((genre) => <button key={genre} type="button" className="genre-button" aria-pressed={activeGenre === genre} onClick={() => setActiveGenre(genre)}>{genre}</button>)}
          </div>
          {filteredItems.length ? (
            <div className="catalog-grid">{filteredItems.map((item) => <CatalogCard key={item.id} item={item} onSelect={openTitle} />)}</div>
          ) : (
            <p className="empty-state" role="status">No stories match that search. Try a different title or genre.</p>
          )}
        </section>

        <section id="about" className="collection" aria-labelledby="about-title">
          <p className="eyebrow">A note on this build</p><h2 id="about-title">A real interface, honest about its edges.</h2>
          <p className="collection-caption">Preview loops are local WebM assets. Playback and room sync become active when authorized media sources and Supabase settings are supplied.</p>
        </section>
      </main>

      <footer className="site-footer"><div className="site-footer-inner"><span>© Aniverse · Stories in motion</span><span>Made for the in-between moments.</span></div></footer>
      {selected ? <PlayerDialog item={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}

interface PlayerDialogProps { item: MediaCatalogRecord; onClose: () => void }

function formatPlaybackPosition(positionMs: number): string {
  const seconds = Math.floor(positionMs / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function PlayerDialog({ item, onClose }: PlayerDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const [positionMs, setPositionMs] = useState(0);
  const onProgress = useCallback((nextPositionMs: number) => setPositionMs(nextPositionMs), []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    closeButtonRef.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
      previousFocus?.focus();
    };
  }, []);

  const handleCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault();
    onClose();
  };

  return (
    <dialog ref={dialogRef} className="player-modal" aria-labelledby="player-title" onCancel={handleCancel}>
      <div className="modal-topline">
        <div className="modal-copy"><p className="eyebrow">{item.genre} · {item.year}</p><h2 id="player-title">{item.title}</h2><p>{item.synopsis}</p></div>
        <button ref={closeButtonRef} className="icon-button" type="button" aria-label="Close player" onClick={onClose}>×</button>
      </div>
      <div className="player-layout">
        <div className="player-column">
          <MasterPlayer episode={item.episodes[0]} poster={item.coverPoster} videoRef={videoRef} onProgress={onProgress} />
          <p className="player-position" aria-live="off">Playhead {formatPlaybackPosition(positionMs)}</p>
        </div>
        <WatchRoomPanel videoRef={videoRef} />
      </div>
    </dialog>
  );
}
