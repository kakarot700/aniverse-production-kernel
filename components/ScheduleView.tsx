'use client';

import { useEffect, useMemo, useState } from 'react';
import { TitleDialog } from '@/components/TitleDialog';
import { useNow } from '@/hooks/useNow';
import { useLibrary } from '@/hooks/useLibrary';
import {
  formatCountdown,
  formatLocalTime,
  groupByLocalDay,
  hasAired,
  type AiringEntry,
} from '@/lib/schedule';
import type { AnimeSummary } from '@/types/anime';

/**
 * The weekly airing schedule.
 *
 * The governing rule: `airingAt` is an absolute Unix timestamp, while
 * "Today", "Tuesday" and "in 4h 12m" are all *local* concepts. Every one of
 * those is therefore computed in the browser, after mount, from a clock the
 * server never sees. Rendering any of it on the server would bake the
 * server's timezone into the HTML and guarantee a hydration mismatch — which
 * is exactly the bug this shape avoids.
 */
export function ScheduleView() {
  const now = useNow(60_000);
  const library = useLibrary();
  const [entries, setEntries] = useState<AiringEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AnimeSummary | null>(null);
  const [activeDay, setActiveDay] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    fetch('/api/schedule', { signal: controller.signal, headers: { Accept: 'application/json' } })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('unavailable'))))
      .then((payload) => {
        if (controller.signal.aborted) return;
        setEntries(Array.isArray(payload?.entries) ? payload.entries : []);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('Could not load the schedule.');
      });

    return () => controller.abort();
  }, []);

  const days = useMemo(() => {
    if (!entries || now === 0) return [];
    return groupByLocalDay(entries, now, { days: 7 });
  }, [entries, now]);

  const current = days[activeDay] ?? null;

  // `now === 0` is the SSR/first-paint sentinel from useNow.
  if (now === 0 || (!entries && !error)) {
    return (
      <div className="page">
        <SchedulePageHead />
        <div className="schedule-skeleton" aria-hidden="true">
          {Array.from({ length: 6 }, (_, index) => <div className="card-skeleton" key={index} />)}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page">
        <SchedulePageHead />
        <p className="empty-state" role="status">{error}</p>
      </div>
    );
  }

  return (
    <div className="page">
      <SchedulePageHead />

      {/* Day selector. A horizontal scroller on phones so seven days fit
          without wrapping; the active day is carried by a filled pill, not
          by colour alone. */}
      <div className="day-strip" role="tablist" aria-label="Day">
        {days.map((day, index) => (
          <button
            key={day.isoDate}
            type="button"
            role="tab"
            id={`day-tab-${day.isoDate}`}
            aria-selected={index === activeDay}
            aria-controls={`day-panel-${day.isoDate}`}
            className={index === activeDay ? 'day-chip is-active' : 'day-chip'}
            onClick={() => setActiveDay(index)}
          >
            <span className="day-chip-label">{day.label}</span>
            <span className="day-chip-count">
              {day.entries.length === 0 ? '—' : day.entries.length}
            </span>
          </button>
        ))}
      </div>

      {current ? (
        <section
          className="schedule-day"
          role="tabpanel"
          id={`day-panel-${current.isoDate}`}
          aria-labelledby={`day-tab-${current.isoDate}`}
        >
          {current.entries.length === 0 ? (
            <p className="empty-state">Nothing airing on {current.label.toLowerCase()}.</p>
          ) : (
            <ul className="schedule-list">
              {current.entries.map((entry) => {
                const aired = hasAired(entry, now);
                const secondsUntil = entry.airingAt - Math.floor(now / 1000);
                const saved = library.isSaved(entry.media.id);

                return (
                  <li key={`${entry.media.id}-${entry.episode}`} className="schedule-row">
                    <span className="schedule-time" aria-hidden={!current.isToday}>
                      {formatLocalTime(entry.airingAt)}
                    </span>

                    <button
                      type="button"
                      className="schedule-card"
                      onClick={() => setSelected(entry.media)}
                    >
                      {entry.media.coverImage ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={entry.media.coverImage} alt="" loading="lazy" referrerPolicy="no-referrer" />
                      ) : (
                        <span className="schedule-cover-blank" aria-hidden="true" />
                      )}

                      <span className="schedule-copy">
                        <span className="schedule-title">{entry.media.title}</span>
                        <span className="schedule-meta">
                          Episode {entry.episode}
                          {entry.media.episodeCount ? ` of ${entry.media.episodeCount}` : ''}
                        </span>
                        <span className={aired ? 'schedule-status is-out' : 'schedule-status'}>
                          {aired ? 'Out now' : `in ${formatCountdown(secondsUntil)}`}
                        </span>
                      </span>

                      {saved ? <span className="schedule-flag" title="On your list">★</span> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}

      {selected ? (
        <TitleDialog key={selected.id} summary={selected} onClose={() => setSelected(null)} />
      ) : null}
    </div>
  );
}

function SchedulePageHead() {
  return (
    <header className="page-head">
      <p className="eyebrow">This week</p>
      <h2 className="page-title">Schedule</h2>
      <p className="page-lede">
        Airing times in your local timezone, counted down to the minute.
      </p>
    </header>
  );
}
