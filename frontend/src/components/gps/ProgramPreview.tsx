export default function ProgramPreview() {
  return (
    <div style={{ border: '1px solid #ccc', padding: '1rem', borderRadius: '8px' }}>
      <h2>Your Generated Program</h2>
      <p>Based on your goal, the AI has generated this structured program:</p>
      <ul>
        <li>Week 1: Fundamentals</li>
        <li>Week 2: Progression</li>
        <li>Week 3: Overload</li>
      </ul>
      <button>Accept Program</button>
    </div>
  );
}
