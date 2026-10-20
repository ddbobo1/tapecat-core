import { EcosystemMarquee } from '@/components/ecosystem-marquee'
import { ArtPanel } from '@/components/pass-art'
import { PassCta } from '@/components/pass-cta'
import { SiteHeader } from '@/components/site-header'

export default function Page() {
  return (
    <main className="schematic-grid relative flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader />
      <div className="mx-auto flex w-full max-w-[1600px] flex-1 items-center px-6 pb-12 pt-24 md:px-10 md:pb-16 md:pt-28 lg:px-16">
        <div className="flex w-full flex-col gap-12 md:flex-row md:items-stretch md:gap-10 lg:gap-16">
          <div className="flex md:w-7/12">
            <ArtPanel />
          </div>
          <PassCta />
        </div>
      </div>
      <EcosystemMarquee />
    </main>
  )
}
