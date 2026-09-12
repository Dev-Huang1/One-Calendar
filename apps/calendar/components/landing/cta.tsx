'use client'

import { Button } from '@zntr/ui/button'
import { ArrowRightIcon } from 'lucide-react'
import { ZentraLogo } from '@/components/brand/zentra-logo'
import Link from 'next/link'

const stars = Array.from({ length: 165 }, (_, i) => ({
  id: i,
  top: `${Math.random() * 100}%`,
  left: `${Math.random() * 100}%`,
  opacity: 0.5 + Math.random() * 0.5,
  size: Math.random() > 0.95 ? 2.8 : 2,
}))

function StarLayer() {
  return (
    <div className="absolute inset-0 overflow-hidden mix-blend-difference pointer-events-none">
      {[0, 1].map((copy) => (
        <div
          key={copy}
          className="absolute top-0 h-full w-full animate-[starDrift_120s_linear_infinite]"
          style={{
            left: copy === 0 ? '0%' : '100%',
          }}
        >
          {stars.map((star) => (
            <span
              key={`${copy}-${star.id}`}
              className="absolute rounded-full bg-white"
              style={{
                top: star.top,
                left: star.left,
                opacity: star.opacity,
                width: star.size,
                height: star.size,
              }}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

export function CallToAction() {
  return (
    <section className="relative mx-auto w-full max-w-6xl overflow-hidden rounded-xl border border-neutral-800/50 shadow-xl shadow-neutral-900/20">
      <div
        className="absolute inset-0"
        style={{
          background: `
            linear-gradient(
              to bottom,
              #000000 0%,
              #1c1c1c 35%,
              #4d4d4d 70%,
              #7a7a7a 100%
            )
          `,
        }}
      />

      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(to bottom, rgba(255,255,255,0.05) 0%, rgba(0,0,0,0.4) 100%)',
        }}
      />

      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at center, rgba(255,255,255,0.08) 0%, transparent 60%)',
        }}
      />

      <div className="absolute inset-0">
        <StarLayer />
      </div>

      <div className="relative flex flex-col justify-center items-center h-full w-full px-6 py-20 md:py-28">
        <div className="mb-8 flex items-center justify-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-[2rem] bg-black/30 backdrop-blur-md ring-1 ring-white/20">
            <ZentraLogo className="h-10 w-10" />
          </div>
        </div>

        <div className="space-y-4 mb-2">
          <h2 className="text-center font-bold text-4xl tracking-tight leading-tight md:text-5xl text-white drop-shadow-md">
            Ready to take control of your time?
          </h2>
          <p className="text-balance text-center text-neutral-300/90 text-base md:text-lg max-w-lg mx-auto">
            Let your agent handle the scheduling. Zentra Calendar keeps every
            event, reminder, and RSVP in sync. Free forever.
          </p>
        </div>

        <div className="flex items-center justify-center gap-4 mt-8">
          <Link href="/sign-up">
            <Button className="rounded-full pl-4 pr-1 py-2.5 text-sm active:scale-[0.97] transition-transform duration-[160ms] ease-[var(--ease-out)] group bg-white text-black hover:bg-white/90 shadow-lg shadow-black/10">
              <span className="mr-3 font-medium">Get started</span>
              <div className="flex size-6 items-center justify-center rounded-full bg-black/10 transition-transform duration-300 group-hover:translate-x-1 group-hover:scale-105 text-black">
                <ArrowRightIcon data-icon="inline-end" />
              </div>
            </Button>
          </Link>
        </div>
      </div>
    </section>
  )
}
