export const metadata = {
  title: 'ScanGym GPS',
  description: 'Goal, Program, Schedule Methodology',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
