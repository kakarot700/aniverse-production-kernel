import type { Metadata } from 'next';
import { SettingsView } from '@/components/SettingsView';

export const metadata: Metadata = {
  title: 'Settings — Aniverse',
  description: 'Appearance, playback and data settings.',
};

export default function SettingsPage() {
  return <SettingsView />;
}
