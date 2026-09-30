import type { Metadata } from 'next';
import { ScheduleView } from '@/components/ScheduleView';

export const metadata: Metadata = {
  title: 'Schedule — Aniverse',
  description: 'What is airing this week, in your local time.',
};

export default function SchedulePage() {
  // Deliberately a client-rendered view. Day grouping and countdowns are
  // local-timezone concepts, and the server does not know the viewer's
  // timezone, so rendering them here would produce HTML that can never match
  // hydration. The route itself stays static; only the data is dynamic.
  return <ScheduleView />;
}
