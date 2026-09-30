import type { Metadata } from 'next';
import { ProfileView } from '@/components/ProfileView';

export const metadata: Metadata = {
  title: 'My list — Aniverse',
  description: 'Everything you are watching, saved and finished.',
};

export default function ProfilePage() {
  return <ProfileView />;
}
