import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'DevUps Growth OS',
  description: 'Outbound engine for DevUps nearshore staff augmentation',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
