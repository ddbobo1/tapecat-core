import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { Space_Grotesk, Noto_Sans_SC, Dancing_Script } from 'next/font/google'
import { SiteProvider } from '@/components/site-provider'
import './globals.css'

const _spaceGrotesk = Space_Grotesk({ subsets: ['latin'] })
const _notoSansSC = Noto_Sans_SC({ subsets: ['latin'], weight: ['400', '500', '700'] })
const wordmarkFont = Dancing_Script({ subsets: ['latin'], weight: ['700'], variable: '--font-wordmark' })

export const metadata: Metadata = {
  title: 'TAPECAT · TapeOut Genesis',
  description: 'TAPECAT 是 TapeOut 生态的早期席位层。窗口内用 $BEM 锁定份额。',
  generator: 'v0.app',
  icons: {
    icon: '/images/tapecat-logo.png',
    apple: '/images/tapecat-logo.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#1b1e21',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="zh-CN" className={`${wordmarkFont.variable} bg-background`}>
      <body className="font-sans antialiased">
        <SiteProvider>
          {children}
          {process.env.NODE_ENV === 'production' && <Analytics />}
        </SiteProvider>
      </body>
    </html>
  )
}
