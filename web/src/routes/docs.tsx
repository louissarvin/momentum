import { createFileRoute } from '@tanstack/react-router'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ExternalLink, Printer } from 'lucide-react'
import { cnm } from '@/utils/style'
import HealthWidget from '@/components/HealthWidget'

export const Route = createFileRoute('/docs')({ component: DocsPage })

// Load all md files at build time
const mdModules = import.meta.glob('../content/docs/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
})

// Sort by filename prefix (01-, 02-, …) and extract title from first H1
function parseSections() {
  return Object.entries(mdModules)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, rawMod]) => {
      const raw = String(rawMod)
      const filename = path.split('/').at(-1) ?? path
      const match = raw.match(/^#\s+(.+)$/m)
      const title =
        match?.[1] ?? filename.replace(/^\d+-/, '').replace('.md', '')
      // slugify title for anchor
      const id = title
        .toLowerCase()
        .replace(/[^\w]+/g, '-')
        .replace(/^-|-$/g, '')
      return { id, title, raw, filename }
    })
}

const SECTIONS = parseSections()

// id to inject health widget after
const HEALTH_AFTER_ID = 'verifiable-transactions'

function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\w]+/g, '-')
    .replace(/^-|-$/g, '')
}

// Custom link renderer — external links get rel + target
function MdLink({
  href,
  children,
}: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  if (!href) return <>{children}</>
  const isExternal = href.startsWith('http') || href.startsWith('//')
  // Security: validate href scheme to block javascript: and data: URIs
  const safe = /^(https?:\/\/|\/|#)/.test(href)
  if (!safe) return <>{children}</>
  return (
    <a
      href={href}
      {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className="text-sui-500 hover:underline underline-offset-2 inline-flex items-center gap-1"
    >
      {children}
      {isExternal && (
        <ExternalLink
          size={11}
          strokeWidth={1.75}
          className="opacity-60 inline"
        />
      )}
    </a>
  )
}

// Custom heading renderers that add anchor IDs
function MdH1({ children }: React.HTMLAttributes<HTMLHeadingElement>) {
  const text = typeof children === 'string' ? children : ''
  const id = slugify(text)
  return (
    <h1
      id={id}
      className="text-3xl md:text-4xl font-bold text-cream-50 tracking-[-0.02em] mt-0 mb-4 scroll-mt-24"
    >
      {children}
    </h1>
  )
}

function MdH2({ children }: React.HTMLAttributes<HTMLHeadingElement>) {
  const text = typeof children === 'string' ? children : ''
  const id = slugify(text)
  return (
    <h2
      id={id}
      className="text-xl md:text-2xl font-semibold text-cream-50 tracking-[-0.01em] mt-10 mb-3 scroll-mt-24"
    >
      {children}
    </h2>
  )
}

function MdH3({ children }: React.HTMLAttributes<HTMLHeadingElement>) {
  const text = typeof children === 'string' ? children : ''
  const id = slugify(text)
  return (
    <h3
      id={id}
      className="text-base font-semibold text-cream-50 mt-8 mb-2 scroll-mt-24"
    >
      {children}
    </h3>
  )
}

function MdCode({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLElement>) {
  // Detect block code: either explicit language fence (```rust) OR content
  // that spans multiple lines (unlabeled fenced blocks like ```tree).
  const text =
    typeof children === 'string'
      ? children
      : Array.isArray(children)
        ? children.filter((c) => typeof c === 'string').join('')
        : ''
  const isBlock =
    Boolean(className && className.includes('language-')) || text.includes('\n')

  if (isBlock) {
    return (
      <pre className="not-prose bg-ink-900 border border-white/[0.08] rounded-2xl p-4 md:p-5 overflow-x-auto my-5">
        <code
          className="block text-[12.5px] font-mono text-slate-300 leading-[1.65] whitespace-pre"
          {...rest}
        >
          {children}
        </code>
      </pre>
    )
  }
  return (
    <code
      className="text-[13px] font-mono text-accent-500 bg-ink-800 rounded px-1.5 py-0.5"
      {...rest}
    >
      {children}
    </code>
  )
}

function MdTable({ children }: React.HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto my-6">
      <table className="w-full text-sm border-collapse">{children}</table>
    </div>
  )
}

function MdTh({ children }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th className="text-left text-[11px] font-mono uppercase tracking-[0.08em] text-slate-500 py-2 px-3 border-b border-white/[0.08]">
      {children}
    </th>
  )
}

function MdTd({ children }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className="py-2.5 px-3 text-sm text-slate-300 border-b border-white/[0.05] align-top font-mono">
      {children}
    </td>
  )
}

function MdBlockquote({
  children,
}: React.BlockquoteHTMLAttributes<HTMLQuoteElement>) {
  return (
    <blockquote className="my-4 pl-4 border-l-2 border-accent-500/50 text-slate-400 italic">
      {children}
    </blockquote>
  )
}

function MdParagraph({ children }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className="text-slate-300 leading-[1.65] mb-4">{children}</p>
}

function MdUl({ children }: React.HTMLAttributes<HTMLUListElement>) {
  return (
    <ul className="list-disc list-inside space-y-1.5 mb-4 text-slate-300">
      {children}
    </ul>
  )
}

function MdOl({ children }: React.OlHTMLAttributes<HTMLOListElement>) {
  return (
    <ol className="list-decimal list-inside space-y-1.5 mb-4 text-slate-300">
      {children}
    </ol>
  )
}

function MdLi({ children }: React.LiHTMLAttributes<HTMLLIElement>) {
  return <li className="text-sm leading-[1.6]">{children}</li>
}

const MD_COMPONENTS = {
  a: MdLink,
  h1: MdH1,
  h2: MdH2,
  h3: MdH3,
  code: MdCode,

  pre: ({ children }: any) => <>{children}</>,
  table: MdTable,
  th: MdTh,
  td: MdTd,
  blockquote: MdBlockquote,
  p: MdParagraph,
  ul: MdUl,
  ol: MdOl,
  li: MdLi,
}

function DocsPage() {
  const [activeId, setActiveId] = useState(SECTIONS[0]?.id ?? '')
  const [tocOpen, setTocOpen] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  // Intersection observer to track active section.
  // We track the visible portion of the viewport (top 30%) and pick the
  // section whose anchor is closest to the top of that band.
  useEffect(() => {
    // Collect the anchor targets — one per SECTION (div id="...").
    const anchors = SECTIONS.map(
      (s) => document.getElementById(s.id),
    ).filter((el): el is HTMLElement => el !== null)

    if (anchors.length === 0) return

    function onScroll() {
      // Active section = the last section whose anchor top is above the
      // 30% viewport line. This gives correct behavior when scrolling both
      // directions and matches the visual reading position.
      const line = window.innerHeight * 0.3
      let currentId = anchors[0].id
      for (const el of anchors) {
        const rect = el.getBoundingClientRect()
        if (rect.top - line <= 0) {
          currentId = el.id
        } else {
          break
        }
      }
      setActiveId((prev) => (prev === currentId ? prev : currentId))
    }

    onScroll() // initial position
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [])

  function scrollTo(id: string) {
    const el = document.getElementById(id)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setActiveId(id)
      setTocOpen(false)
    }
  }

  return (
    <div className="min-h-screen bg-ink-900">
      <div className="mx-auto w-full max-w-[1120px] px-4 md:px-6 py-20 md:py-24">
        {/* Print button — top of docs, hidden when printing */}
        <div className="flex justify-end mb-6 no-print">
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-ink-800 border border-white/[0.08] text-xs font-mono text-slate-400 hover:text-cream-50 hover:border-white/20 transition-colors focus-ring"
            aria-label="Print this page"
          >
            <Printer size={13} strokeWidth={1.75} />
            Print
          </button>
        </div>

        {/* Mobile TOC toggle */}
        <div className="lg:hidden mb-8 no-print">
          <button
            onClick={() => setTocOpen((v) => !v)}
            className="flex items-center justify-between w-full px-4 py-3 rounded-[var(--radius-lg)] bg-ink-800 border border-white/[0.08] text-sm text-slate-300 focus-ring"
            aria-expanded={tocOpen}
          >
            <span className="font-mono text-xs uppercase tracking-[0.08em] text-slate-500">
              Table of contents
            </span>
            <ChevronDown
              size={14}
              strokeWidth={1.75}
              className={cnm(
                'text-slate-500 transition-transform duration-200',
                tocOpen && 'rotate-180',
              )}
            />
          </button>
          {tocOpen && (
            <nav className="mt-2 px-2 py-2 rounded-[var(--radius-lg)] bg-ink-800 border border-white/[0.08]">
              {SECTIONS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => scrollTo(s.id)}
                  className={cnm(
                    'w-full text-left px-3 py-2 rounded-[var(--radius-md)] text-sm transition-colors duration-150',
                    activeId === s.id
                      ? 'text-cream-50 bg-white/[0.06]'
                      : 'text-slate-400 hover:text-cream-50 hover:bg-white/[0.04]',
                  )}
                >
                  {s.title}
                </button>
              ))}
            </nav>
          )}
        </div>

        <div className="flex gap-12 lg:gap-16 items-start">
          {/* Sticky desktop TOC */}
          <aside
            className="hidden lg:block w-56 shrink-0 sticky top-24 no-print"
            aria-label="Table of contents"
          >
            <p className="text-[11px] font-mono uppercase tracking-[0.12em] text-slate-500 mb-4">
              Contents
            </p>
            <nav className="flex flex-col gap-0.5">
              {SECTIONS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => scrollTo(s.id)}
                  className={cnm(
                    'w-full text-left px-3 py-1.5 rounded-[var(--radius-md)] text-sm transition-colors duration-150 focus-ring',
                    activeId === s.id
                      ? 'text-cream-50 bg-white/[0.06] font-medium'
                      : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.04]',
                  )}
                >
                  {s.title}
                </button>
              ))}
            </nav>

            {/* Health widget in sidebar */}
            <div className="mt-8" data-health-widget="">
              <HealthWidget />
            </div>
          </aside>

          {/* Main content */}
          <div ref={contentRef} className="flex-1 min-w-0 max-w-[68ch]">
            {SECTIONS.map((section, i) => (
              <div key={section.id}>
                {/* Section anchor target */}
                <div id={section.id} className="scroll-mt-24" />

                <article
                  className={cnm(
                    'pb-16',
                    i < SECTIONS.length - 1 &&
                      'border-b border-white/[0.06] mb-16',
                  )}
                >
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeRaw]}
                    components={MD_COMPONENTS as any}
                  >
                    {section.raw}
                  </ReactMarkdown>
                </article>

                {/* Health widget — mobile, after verifiable-transactions section */}
                {section.id === HEALTH_AFTER_ID && (
                  <div className="lg:hidden mb-12">
                    <HealthWidget />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
