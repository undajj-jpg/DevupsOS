import type { Metadata } from 'next';
import { Fraunces, JetBrains_Mono, Newsreader } from 'next/font/google';
import './globals.css';

// Display serif for headlines — Fraunces' optical sizing keeps large titles
// tight without the thin-hairline look a display face usually brings.
const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  display: 'swap',
});

// Reading serif for body copy and table cells.
const newsreader = Newsreader({
  subsets: ['latin'],
  variable: '--font-newsreader',
  style: ['normal', 'italic'],
  display: 'swap',
});

// Metadata: boletín numbers, timestamps, chamber labels, IDs.
const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono-face',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'DevUps Growth OS',
  description:
    'Outbound engine for DevUps nearshore staff augmentation — sourcing to first touch, with every send gated behind a person.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="es"
      className={`${fraunces.variable} ${newsreader.variable} ${mono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
