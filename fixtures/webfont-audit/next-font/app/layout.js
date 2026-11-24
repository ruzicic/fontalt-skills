import { Inter, Roboto_Mono, Playfair_Display } from "next/font/google";
import localFont from "next/font/local";

// Default display (swap), subsets set: no finding
const inter = Inter({ subsets: ["latin", "latin-ext"], variable: "--font-inter" });

// display "block" on a text font: font-display-block; preloads fewer subsets than Inter: nextfont-subset-mismatch
const robotoMono = Roboto_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "block",
});

// No subsets while preload is on: nextfont-subset-mismatch; weight 800 is never used: unused-face-weight
const playfair = Playfair_Display({ weight: "800", style: ["italic"] });

const geist = localFont({
  src: [{ path: "./fonts/Geist-Variable.woff2", weight: "100 900", style: "normal" }],
  variable: "--font-geist",
});

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${inter.variable} ${geist.variable}`}>
      <body>
        <h1 className={playfair.className}>Title</h1>
        <pre className={robotoMono.className}>{children}</pre>
      </body>
    </html>
  );
}
