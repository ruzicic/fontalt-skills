export default function Home() {
  return (
    <>
      <h1>Typography for the quiet reader</h1>
      <p className="meta">Published 1 November 2026 · 7 min read · Źródło: the editors of <em>Quiet Type</em></p>
      <h2>Measure and rhythm</h2>
      <p>Good body text is rarely noticed. Readers settle into a rhythm of about sixty-six characters per line, and the designer’s job is to keep that rhythm unbroken: generous leading, calm weights, and a scale that never shouts. Numbers matter too: 0123456789, 3.14159, 1,024 and 12:45 should all sit evenly.</p>
      <p>Accents matter, too. Café menus, Zürich street signs, the Polish city of Łódź, the Spanish piñata, a Danish smørrebrød, Straße in Hamburg, the French œuvre and naïve façade. Italic text should look right as well: <em>the quick brown fox jumps over the lazy dog, <strong>and the bold inside italics matters</strong>, as does Łukasz’s name in italic</em>.</p>
      <blockquote>“Typography is the craft of endowing human language with a durable visual form.” — Robert Bringhurst, <strong>paraphrased</strong></blockquote>
      <p className="thin">A thin-weight line to exercise the light end of the weight axis: sphinx of black quartz, judge my vow.</p>
      <h2>Code</h2>
      <pre><code>{`export function clamp(n, lo, hi) {\n  return Math.min(Math.max(n, lo), hi); // 0 <= lo <= hi\n}\n\nconsole.log(clamp(15, 0, 10)); // => 10`}</code></pre>
      <p>Inline code like <code>font-variation-settings: "wght" 450</code> sits in the running text.</p>
      <h2>Numbers in tables</h2>
      <table>
        <thead><tr><th>Face</th><th>Weight</th><th>Size (px)</th><th>Share</th></tr></thead>
        <tbody>
          <tr><td>Geist Sans</td><td>400</td><td>17</td><td>71.4 %</td></tr>
          <tr><td>Geist Sans Italic</td><td>400–800</td><td>17</td><td>8.9 %</td></tr>
          <tr><td>Geist Mono</td><td>400–500</td><td>14</td><td>19.7 %</td></tr>
        </tbody>
      </table>
      <p style={{ marginTop: '1.5rem' }}><span className="mono-label">Label in mono, uppercase</span></p>
    </>
  );
}
