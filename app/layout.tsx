import type { Metadata, Viewport } from 'next';
import './globals.css';
import './a11y.css';

export const metadata: Metadata = {
  title: 'Aniverse — stories in motion',
  description: 'A thoughtful home for animated worlds and the people who watch together.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#f8fafc',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
