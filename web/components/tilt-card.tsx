'use client'

import { useRef, type PointerEvent, type ReactNode } from 'react'

const MAX_TILT = 7

export function TiltCard({ children, fill = false }: { children: ReactNode; fill?: boolean }) {
  const cardRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<number | null>(null)

  function setTilt(rx: number, ry: number, gx: number, gy: number, glare: number) {
    const el = cardRef.current
    if (!el) return
    el.style.setProperty('--rx', `${rx}deg`)
    el.style.setProperty('--ry', `${ry}deg`)
    el.style.setProperty('--gx', `${gx}%`)
    el.style.setProperty('--gy', `${gy}%`)
    el.style.setProperty('--glare', `${glare}`)
  }

  function handleMove(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerType === 'touch') return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const el = cardRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const px = (e.clientX - rect.left) / rect.width
    const py = (e.clientY - rect.top) / rect.height
    if (frameRef.current) cancelAnimationFrame(frameRef.current)
    frameRef.current = requestAnimationFrame(() => {
      el.dataset.active = 'true'
      setTilt((0.5 - py) * MAX_TILT * 2, (px - 0.5) * MAX_TILT * 2, px * 100, py * 100, 1)
    })
  }

  function handleLeave() {
    if (frameRef.current) cancelAnimationFrame(frameRef.current)
    const el = cardRef.current
    if (el) delete el.dataset.active
    setTilt(0, 0, 50, 50, 0)
  }

  return (
    <div
      className={`w-full max-w-3xl [perspective:1400px] ${fill ? 'flex flex-1 flex-col' : ''}`}
      onPointerMove={handleMove}
      onPointerLeave={handleLeave}
    >
      <div
        ref={cardRef}
        className="group relative flex flex-1 flex-col [transform-style:preserve-3d] [transform:rotateX(var(--rx,0deg))_rotateY(var(--ry,0deg))_scale(var(--s,1))] transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] will-change-transform data-[active=true]:duration-150 data-[active=true]:[--s:1.03]"
      >
        {children}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-20 rounded-md mix-blend-overlay transition-opacity duration-500"
          style={{
            opacity: 'var(--glare, 0)',
            background:
              'radial-gradient(circle at var(--gx, 50%) var(--gy, 50%), rgba(255,255,255,0.55), rgba(255,255,255,0) 55%)',
          }}
        />
      </div>
    </div>
  )
}
