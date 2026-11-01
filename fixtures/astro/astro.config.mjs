// @ts-check
// Fixture: the official Astro "blog" starter, with its font swapped for OFL-licensed Atkinson Hyperlegible
// (Google Fonts build via @fontsource, latin + latin-ext subsets) declared the way Google Fonts / fontsource ship it.
// `<Font cssVariable="--font-atkinson" preload />` in BaseHead.astro preloads every variant file (the "before" state).
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { defineConfig, fontProviders } from 'astro/config';

const LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const LATIN_EXT = 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';
const face = (subset, weight, style, range) => ({
	src: [`./src/assets/fonts/atkinson-hyperlegible-${subset}-${weight}-${style}.woff2`],
	weight,
	style,
	display: 'swap',
	unicodeRange: [range],
});

// https://astro.build/config
export default defineConfig({
	site: 'https://example.com',
	integrations: [mdx(), sitemap()],
	fonts: [
		{
			provider: fontProviders.local(),
			name: 'Atkinson Hyperlegible',
			cssVariable: '--font-atkinson',
			fallbacks: ['sans-serif'],
			options: {
				variants: [
					face('latin-ext', 400, 'normal', LATIN_EXT),
					face('latin', 400, 'normal', LATIN),
					face('latin-ext', 700, 'normal', LATIN_EXT),
					face('latin', 700, 'normal', LATIN),
					face('latin-ext', 400, 'italic', LATIN_EXT),
					face('latin', 400, 'italic', LATIN),
					face('latin-ext', 700, 'italic', LATIN_EXT),
					face('latin', 700, 'italic', LATIN),
				],
			},
		},
	],
});
