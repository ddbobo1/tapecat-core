import { AnimatedArt } from '@/components/animated-art'
import { TiltCard } from '@/components/tilt-card'

type PassArtProps = {
  variant?: 'genesis' | 'waitlist' | 'invite'
  inviteCode?: string
  claimed?: boolean
  fill?: boolean
}

const CORNERS = [
  'left-0 top-0 border-l-2 border-t-2',
  'right-0 top-0 border-r-2 border-t-2',
  'bottom-0 left-0 border-b-2 border-l-2',
  'bottom-0 right-0 border-b-2 border-r-2',
]

export function ArtPanel({ variant = 'genesis', claimed = false, fill = false }: PassArtProps) {
  const locked = variant === 'invite' && !claimed
  const figureRing = claimed
    ? 'ring-1 ring-accent/60 shadow-[0_0_140px_-10px_rgba(47,191,98,0.7)]'
    : 'ring-1 ring-border shadow-[0_0_120px_-20px_rgba(47,191,98,0.55)]'

  if (fill) {
    return (
      <div className="flex h-full w-full flex-col gap-3">
        <PanelHeader />
        <TiltCard fill>
          <div className="relative flex flex-1 flex-col p-2">
            {CORNERS.map((pos) => (
              <span key={pos} aria-hidden="true" className={`pointer-events-none absolute size-5 border-accent ${pos}`} />
            ))}
            <figure
              aria-label="TapeCat 插画：戴猫耳头套的角色正在制作发光芯片"
              className={`relative w-full flex-1 overflow-hidden rounded-xl transition-shadow duration-700 ${figureRing}`}
            >
              <div aria-hidden="true" className="aspect-[720/405] w-full" />
              <AnimatedArt intense={claimed} />
              <div aria-hidden="true" className="tc-scanlines pointer-events-none absolute inset-0" />
              <div aria-hidden="true" className="tc-scanbar pointer-events-none absolute inset-x-0 h-16" />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-xl shadow-[inset_0_0_40px_rgba(26,138,74,0.35)]"
              />
            </figure>
          </div>
        </TiltCard>
        <PanelFooter locked={locked} />
      </div>
    )
  }

  return (
    <div className="flex w-full flex-col justify-between gap-3">
      <div className="flex items-center justify-between font-mono text-xs uppercase leading-4 tracking-widest text-muted-foreground">
        <span>
          <span className="text-accent">{'FIG.01'}</span>
          {' / tapecat.schematic'}
        </span>
        <span className="hidden sm:inline">{'720 × 405 · rev.a1'}</span>
      </div>

      <TiltCard>
        <div className="relative p-2">
          {CORNERS.map((pos) => (
            <span key={pos} aria-hidden="true" className={`pointer-events-none absolute size-5 border-accent ${pos}`} />
          ))}
          <figure
            aria-label="TapeCat 插画：戴猫耳头套的角色正在制作发光芯片"
            className={
              claimed
                ? 'relative aspect-[720/405] w-full overflow-hidden rounded-xl ring-1 ring-accent/60 shadow-[0_0_140px_-10px_rgba(47,191,98,0.7)] transition-shadow duration-700'
                : 'relative aspect-[720/405] w-full overflow-hidden rounded-xl ring-1 ring-border shadow-[0_0_120px_-20px_rgba(47,191,98,0.55)] transition-shadow duration-700'
            }
          >
            <AnimatedArt intense={claimed} />
            <div aria-hidden="true" className="tc-scanlines pointer-events-none absolute inset-0" />
            <div aria-hidden="true" className="tc-scanbar pointer-events-none absolute inset-x-0 h-16" />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-xl shadow-[inset_0_0_40px_rgba(26,138,74,0.35)]"
            />
          </figure>
        </div>
      </TiltCard>

      <div className="flex items-center justify-between gap-4 font-mono text-xs uppercase leading-4 tracking-widest text-muted-foreground">
        <span className="flex items-center gap-2">
          <span className="size-1.5 animate-pulse rounded-full bg-accent" aria-hidden="true" />
          {locked ? 'status: locked' : 'status: fabricating'}
        </span>
        <span className="hidden h-px flex-1 bg-border sm:block" aria-hidden="true" />
        <span>
          {'nand.gate → '}
          <span className="text-accent">{'tape-out'}</span>
        </span>
      </div>
    </div>
  )
}

function PanelHeader() {
  return (
    <div className="flex items-center justify-between font-mono text-xs uppercase leading-4 tracking-widest text-muted-foreground">
      <span>
        <span className="text-accent">{'FIG.01'}</span>
        {' / tapecat.schematic'}
      </span>
      <span className="hidden lg:inline">{'720 × 405 · rev.a1'}</span>
    </div>
  )
}

function PanelFooter({ locked }: { locked: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 font-mono text-xs uppercase leading-4 tracking-widest text-muted-foreground">
      <span className="flex items-center gap-2">
        <span className="size-1.5 animate-pulse rounded-full bg-accent" aria-hidden="true" />
        {locked ? 'status: locked' : 'status: fabricating'}
      </span>
      <span className="hidden h-px flex-1 bg-border sm:block" aria-hidden="true" />
      <span>
        {'nand.gate → '}
        <span className="text-accent">{'tape-out'}</span>
      </span>
    </div>
  )
}

export function PassArt(props: PassArtProps) {
  return (
    <div className="flex w-full items-center justify-center px-6 py-12 md:min-h-screen md:w-7/12 md:py-24 md:pl-4 md:pr-10 lg:pr-16">
      <div className="flex w-full max-w-3xl">
        <ArtPanel {...props} />
      </div>
    </div>
  )
}
