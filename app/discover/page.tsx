import type { Metadata } from 'next';
import { DiscoverView } from '@/components/DiscoverView';

export const metadata: Metadata = {
  title: 'Discover — Aniverse',
  description: 'Browse the complete anime catalog by genre, format, season and year.',
};

export default function DiscoverPage() {
  return <DiscoverView />;
}
