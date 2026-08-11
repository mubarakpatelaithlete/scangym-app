import Link from 'next/link';

export default function Home() {
  return (
    <main style={{ padding: '2rem' }}>
      <h1>ScanGym Dashboard</h1>
      <Link href="/onboarding/gps/goal">
        Start GPS Onboarding
      </Link>
    </main>
  );
}
