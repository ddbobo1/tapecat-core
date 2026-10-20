import Link from 'next/link'
import { WalletButton } from '@/components/wallet-button'
import { InvitePopover } from '@/components/invite-popover'

function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}

function TelegramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M21.94 4.3 18.7 19.6c-.24 1.08-.88 1.35-1.79.84l-4.94-3.64-2.38 2.29c-.26.26-.49.49-1 .49l.36-5.03 9.16-8.28c.4-.36-.09-.55-.62-.2L6.17 13.2 1.29 11.67c-1.06-.33-1.08-1.06.22-1.57L20.6 2.74c.88-.33 1.66.2 1.34 1.56z" />
    </svg>
  )
}

const SOCIALS = [{ href: 'https://x.com/TapeCat_', label: 'X (Twitter)', Icon: XIcon }]

export function SiteHeader() {
  return (
    <header className="absolute inset-x-0 top-0 z-30 border-b border-border/60 bg-background/70 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between px-6 py-3 md:px-10 lg:px-16">
        <Link
          href="/"
          aria-label="TapeCat 首页"
          className="tc-wordmark text-2xl font-bold leading-none text-accent focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
        >
          tapecat
        </Link>

        <nav aria-label="社交与钱包" className="flex items-center gap-2">
          <InvitePopover />
          <button
            type="button"
            disabled
            aria-label="Telegram（频道地址待公布）"
            title="频道地址待公布"
            className="flex size-9 cursor-not-allowed items-center justify-center rounded-lg border border-dashed border-border bg-card/30 text-muted-foreground/50"
          >
            <TelegramIcon className="size-4" />
          </button>
          {SOCIALS.map(({ href, label, Icon }) => (
            <a
              key={label}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={label}
              className="flex size-9 items-center justify-center rounded-lg border border-border bg-card/60 text-muted-foreground transition-colors hover:border-accent/60 hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <Icon className="size-4" />
            </a>
          ))}
          <WalletButton />
        </nav>
      </div>
    </header>
  )
}
