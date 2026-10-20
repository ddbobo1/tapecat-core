import type { Metadata } from 'next'
import { PassArt } from '@/components/pass-art'
import { WaitlistSteps } from '@/components/waitlist-steps'

export const metadata: Metadata = {
  title: '生态候补 · TAPECAT',
  description: 'TAPECAT / TapeOut 生态候补。',
}

export default function WaitlistPage() {
  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground md:flex-row">
      <PassArt variant="waitlist" />
      <WaitlistSteps />
    </main>
  )
}
