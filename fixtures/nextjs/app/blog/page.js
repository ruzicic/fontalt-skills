export const metadata = { title: 'Blog · Quiet Type' };

export default function Blog() {
  return (
    <>
      <h1>Blog</h1>
      <p className="meta">Plain English, ASCII only: this page never needs the extended font file.</p>
      <h2>Why fonts weigh so much</h2>
      <p>A variable font carries every weight, every width and every script the designer drew, and most pages use a small slice of it. Cutting the file down to what the site really draws keeps the page looking identical and downloads far less. Quotes like "these" and dashes - like this one - are plain ASCII here.</p>
      <p><em>Italic text, <strong>bold inside italics</strong>, and back again.</em> The quick brown fox jumps over the lazy dog 0123456789.</p>
      <pre><code>{`$ python3 optimize_fonts.py --usage work/usage.json --out public/fonts`}</code></pre>
    </>
  );
}
