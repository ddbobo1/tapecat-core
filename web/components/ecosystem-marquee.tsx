import Image from 'next/image'

type Project = { name: string; handle: string; tag: string; logo: string }

const projects: Project[] = [
  { name: 'TapeOut', handle: 'TapeOutWorld', tag: 'PROTOCOL', logo: '/logos/tapeoutworld.jpg' },
  { name: 'TapeOut Foundation', handle: 'TapeOutCF', tag: 'COMMUNITY', logo: '/logos/tapeoutcf.jpg' },
  { name: 'TAPELIQUID', handle: 'TAPELIQUID', tag: 'DEX', logo: '/logos/tapeliquid.jpg' },
  { name: 'TapeOut.Market', handle: 'TapeOutMarket_x', tag: 'MARKET', logo: '/logos/tapeoutmarket_x.jpg' },
  { name: 'ToshX', handle: 'ToshProtocol', tag: 'LAUNCHPAD', logo: '/logos/toshprotocol.jpg' },
  { name: 'Firsto.ai', handle: 'FirstoAI', tag: 'TERMINAL', logo: '/logos/firstoai.jpg' },
  { name: 'NANDPU', handle: 'nandpu_ai', tag: 'ONCHAIN.AI', logo: '/logos/nandpu_ai.jpg' },
  { name: 'X Layer', handle: 'XLayerOfficial', tag: 'PARTNER', logo: '/logos/xlayerofficial.jpg' },
  { name: 'Prom', handle: 'prom_io', tag: 'PARTNER', logo: '/logos/prom_io.jpg' },
  { name: 'MOVA', handle: 'MovaChain', tag: 'SETTLEMENT', logo: '/logos/movachain.jpg' },
  { name: 'WLFI', handle: 'worldlibertyfi', tag: 'PARTNER', logo: '/logos/worldlibertyfi.jpg' },
]

function Row({ hidden = false }: { hidden?: boolean }) {
  return (
    <ul className="tc-marquee-track flex shrink-0 items-center gap-4 pr-4" aria-hidden={hidden || undefined}>
      {projects.map(({ name, handle, tag, logo }) => (
        <li key={handle} className="shrink-0">
          <a
            href={`https://x.com/${handle}`}
            target="_blank"
            rel="noopener noreferrer"
            tabIndex={hidden ? -1 : undefined}
            className="flex items-center gap-3 rounded-lg border border-border bg-card/60 py-2 pl-2 pr-4 transition-colors hover:border-accent/50"
          >
            <Image
              src={logo || '/placeholder.svg'}
              alt={hidden ? '' : `${name} logo`}
              width={36}
              height={36}
              loading="eager"
              className="size-9 rounded-full border border-border object-cover"
            />
            <span className="flex flex-col leading-tight">
              <span className="whitespace-nowrap text-sm font-medium text-foreground">{name}</span>
              <span className="whitespace-nowrap font-mono text-[10px] tracking-[0.15em] text-muted-foreground">
                @{handle} · <span className="text-accent">{tag}</span>
              </span>
            </span>
          </a>
        </li>
      ))}
    </ul>
  )
}

export function EcosystemMarquee({ compact = false }: { compact?: boolean }) {
  return (
    <section
      aria-labelledby="ecosystem-title"
      className={`relative shrink-0 border-t border-border ${compact ? 'py-3' : 'py-8'}`}
    >
      <div className={`mx-auto flex ${compact ? 'mb-2.5' : 'mb-5'} w-full max-w-[1600px] items-center gap-4 px-6 md:px-10 lg:px-16`}>
        <span className="size-1.5 rounded-full bg-accent" aria-hidden="true" />
        <h2 id="ecosystem-title" className="font-mono text-xs tracking-[0.25em] text-accent">
          TAPEOUT.ECOSYSTEM
        </h2>
        <span className="h-px flex-1 bg-border" aria-hidden="true" />
        <a
          href="https://x.com/TapeOutWorld"
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-xs tracking-[0.2em] text-muted-foreground transition-colors hover:text-accent"
        >
          @TAPEOUTWORLD
        </a>
      </div>
      <div className="tc-marquee group flex overflow-hidden">
        <Row />
        <Row hidden />
      </div>
    </section>
  )
}
