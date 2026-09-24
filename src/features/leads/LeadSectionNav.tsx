import { useEffect, useState } from 'react'

export interface LeadSection {
  id: string
  label: string
}

export default function LeadSectionNav({ sections }: { sections: readonly LeadSection[] }) {
  const [active, setActive] = useState(() => window.location.hash.slice(1) || sections[0]?.id || '')

  useEffect(() => {
    if (sections.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        const first = visible[0]
        if (first) setActive(first.target.id)
      },
      { rootMargin: '-20% 0px -68% 0px', threshold: [0, 0.01, 0.25] },
    )

    for (const section of sections) {
      const node = document.getElementById(section.id)
      if (node) observer.observe(node)
    }

    const hash = window.location.hash.slice(1)
    if (hash && sections.some((section) => section.id === hash)) {
      window.setTimeout(() => {
        document.getElementById(hash)?.scrollIntoView({ behavior: 'auto', block: 'start' })
      }, 0)
    }

    return () => observer.disconnect()
  }, [sections])

  const go = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}#${id}`)
    setActive(id)
  }

  return (
    <div className="sticky top-14 z-10 -mx-4 mb-3 border-b border-white/8 bg-brand-950/95 px-4 py-2 backdrop-blur">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {sections.map((section) => (
          <button
            key={section.id}
            type="button"
            onClick={() => go(section.id)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider transition-colors ${
              active === section.id
                ? 'bg-gold-500 text-brand-950'
                : 'bg-white/7 text-white/45 ring-1 ring-white/8'
            }`}
          >
            {section.label}
          </button>
        ))}
      </div>
    </div>
  )
}
