import Link from 'next/link';
import { geistSans, geistMono } from './fonts';
import './globals.css';

export const metadata = { title: 'Quiet Type', description: 'fontalt-skills Next.js fixture' };

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <header>
          <Link className="brand" href="/">Quiet Type</Link>
          <nav>
            <Link href="/blog/">Blog</Link>
            <Link href="/notes/">Notes</Link>
          </nav>
        </header>
        <main>{children}</main>
        <footer>© 2026 Quiet Type · fixture for fontalt-skills (font: Geist, SIL OFL 1.1)</footer>
      </body>
    </html>
  );
}
