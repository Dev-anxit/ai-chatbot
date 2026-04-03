import './globals.css'

export const metadata = {
  title: 'Ehan AI | Node Nexus',
  description: 'AI-powered chat with real-time knowledge retrieval',
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
