export const metadata = { title: 'Late content · Quiet Type' };

export default function Notes() {
  return (
    <>
      <h1>Late content</h1>
      <p className="meta">Not part of the usage scan: it stands for content written after the script was run.</p>
      <p>Each character below sits in its own box, so it is the only thing drawn from the extended file in that text run:</p>
      <p className="boxes">
        {['½', '¼', '¾', '×', '÷', '±'].map((c) => <span className="box" key={c}>{c}</span>)}
      </p>
      <p><em className="box">ª</em> <em className="box">º</em></p>
    </>
  );
}
