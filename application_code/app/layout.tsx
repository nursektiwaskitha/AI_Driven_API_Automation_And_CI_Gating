import './globals.css'

export const metadata = {
  title: 'Payment Checkout App',
  description: 'SDET Test - Payment processing with soft-fail validation',
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
