import localFont from 'next/font/local';

// Geist (SIL OFL 1.1, https://github.com/vercel/geist-font), copied unmodified from the `geist` npm package.
// next/font adds a metric-matched fallback face ("Geist Fallback") and hashes the file names.
export const geistSans = localFont({
  src: [
    { path: './fonts/Geist-Variable.woff2', style: 'normal' },
    { path: './fonts/Geist-Italic-Variable.woff2', style: 'italic' },
  ],
  weight: '100 900',
  variable: '--font-geist-sans',
  display: 'swap',
});

export const geistMono = localFont({
  src: './fonts/GeistMono-Variable.woff2',
  weight: '100 900',
  variable: '--font-geist-mono',
  display: 'swap',
});
