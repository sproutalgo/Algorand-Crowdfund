import React, { useEffect, useState, useCallback } from 'react'
import { algodClient, fetchOnChainBatch, gsFromCache } from '../utils/algorand'
import { Link } from 'react-router-dom'
import { fetchPublicProjects } from '../utils/api'
import ProjectCard from '../components/ProjectCard'
import { SkeletonCard, Icon, Stat, Progress, fmtAlgo, pctNum, deriveProjectStatus, categoryHue } from '../components/UI'

const FILTERS   = ['All', 'DeFi', 'RWA', 'AI', 'NFT', 'Gaming', 'Infrastructure', 'Social', 'Other', 'Cancelled']
const PAGE_SIZE = 50

export default function Home() {
  const [projects, setProjects]     = useState([])
  const [loading, setLoading]       = useState(true)
  const [filter, setFilter]         = useState('All')
  const [search, setSearch]         = useState('')
  const [error, setError]           = useState(null)
  const [page, setPage]             = useState(1)
  const [total, setTotal]           = useState(0)
  const [allProjects, setAllProjects] = useState([])
  const [currentRound, setCurrentRound] = useState(0)

  // Fetch current round once on mount for accurate expiry display.
  // A single algod call rather than per-project — good tradeoff.
  useEffect(() => {
    algodClient.status().do()
      .then(s => setCurrentRound(Number(s['last-round'] ?? s.lastRound ?? 0)))
      .catch(() => {}) // non-critical — falls back to 0, sync job covers it
  }, [])  // all loaded so far for stats/hero

  const totalPages = Math.ceil(total / PAGE_SIZE)

  const loadPage = useCallback(async (pageNum, currentFilter, currentSearch) => {
    setLoading(true)
    setError(null)
    try {
      // Step 1: fetch page of metadata from Supabase (sorted newest-first, paginated)
      const result = await fetchPublicProjects({ page: pageNum, pageSize: PAGE_SIZE })
      const metaList = Array.isArray(result.projects) ? result.projects : (Array.isArray(result) ? result : [])
      setTotal(result.total ?? metaList.length)

      if (metaList.length === 0) {
        setProjects([])
        return
      }

      // Step 2: use cached on_chain_* columns from Supabase where available.
      // Fall back to direct algod calls for any records without a populated cache.
      // ROLLBACK: remove the cache block and restore fetchOnChainBatch for all IDs.
      const cachedMap = {}
      const uncachedIds = []

      for (const meta of metaList) {
        const id = Number(meta.app_id)
        if (meta.on_chain_deleted) {
          cachedMap[id] = { gs: {}, deleted: true }
          continue
        }
        const cached = gsFromCache(meta)
        if (cached) {
          cachedMap[id] = { gs: cached, deleted: false }
        } else {
          uncachedIds.push(id)
        }
      }

      // Fetch algod only for records with no cache yet
      const algodResults = uncachedIds.length > 0
        ? await fetchOnChainBatch(uncachedIds)
        : {}

      // Step 3: merge — prefer cache, fall back to algod
      const merged = metaList.map(meta => {
        const id = Number(meta.app_id)
        const { gs, deleted } = cachedMap[id] ?? algodResults[id] ?? { gs: {}, deleted: true }
        return { id, gs, meta, deleted }
      })

      setProjects(merged)
      // Accumulate all loaded projects for hero stats (first page is enough)
      if (pageNum === 1) setAllProjects(merged)
    } catch (e) {
      console.error(e)
      setError('Could not load projects. Check your connection.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadPage(page, filter, search)
  }, [page, loadPage])

  // Scroll to top on page navigation so new results start at the top
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [page])

  // Reset to page 1 when filter or search changes
  useEffect(() => {
    if (page !== 1) {
      setPage(1)
    } else {
      loadPage(1, filter, search)
    }
  }, [filter, search]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sprout placeholder card — always shown first as a formatting example
  const PLACEHOLDER = {
    id: 'demo',
    deleted: false,
    gs: {
      goal:         50_000_000_000,
      raised:       0,
      funded_round: 1,
      rate:         100,
      deadline:     0,
      asa_id:       1,
    },
    meta: {
      app_id:        'demo',
      name:          'Sprout',
      tagline:       'The grassroots Algorand crowdfunding platform.',
      description:   'Click to see a full example of what your campaign page will look like.',
      category:      'Infrastructure',
      token_name:    'SPRT',
      goal_micro:    50_000_000_000,
      is_funded:     true,
      is_distributed: false,
      is_refunded:   false,
      is_cancelled:  false,
      is_hidden:     false,
    },
    isPlaceholder: true,
  }

  const filtered = projects.filter(p => {
    const m = p.meta || {}
    const status = deriveProjectStatus(p, currentRound)
    const isCancelled = status === 'cancelled'
    if (m.is_hidden)   return false
    if (isCancelled && filter !== 'All' && filter !== 'Cancelled') return false
    if (!isCancelled && filter === 'Cancelled') return false
    if (!isCancelled && !p.gs?.asa_id && status !== 'distributed') return false
    const cat = m.category || 'Other'
    if (filter !== 'All' && filter !== 'Cancelled' && cat !== filter) return false
    if (search) {
      const q = search.toLowerCase()
      if (!m.name?.toLowerCase().includes(q) && !m.tagline?.toLowerCase().includes(q) && !String(p.id).includes(q)) return false
    }
    return true
  })

  const statsBase = allProjects.length > 0 ? allProjects : projects
  const fundedCount = statsBase.filter(p => {
    const s = deriveProjectStatus(p, currentRound)
    return s === 'funded' || s === 'distributed'
  }).length

  const featuredProjects = [...statsBase]
    .filter(p => p.meta?.is_featured)
    .sort((a, b) => (a.meta?.feature_order ?? 0) - (b.meta?.feature_order ?? 0))
    .slice(0, 3)

  const heroCards = featuredProjects.length > 0 ? featuredProjects : filtered.slice(0, 3)

  return (
    <div className="rise">
      {/* ── Hero ── */}
      <section className="hero wrap">
        <div className="hero-grid">
          <div>
            <span className="badge badge-success">
              <span className="badge-dot" style={{ animation: 'pulse-dot 2s infinite' }} />
              Live on Algorand Testnet
            </span>
            <h1 style={{ marginTop: 22 }}>
              The Algorand launchpad.<br />
              <span style={{ color: '#2FBE73' }}>Grassroots</span> funding. Real ownership.
            </h1>
            <p className="hero-sub">
              The transparent crowdfunding platform built for on-chain developers and the investors who back them.
            </p>
            <div className="hero-actions">
              <Link to="/create" className="btn btn-primary btn-lg">
                Launch a project <Icon.arrow style={{ width: 18, height: 18 }} />
              </Link>
              <Link to="/faq" className="btn btn-ghost btn-lg">
                How it works
              </Link>
            </div>
            <div className="hero-stats">
              <Stat value={(() => {
                const total = Math.round(statsBase.reduce((s, p) => s + Number(p.gs?.raised ?? 0), 0) / 1_000_000)
                return total >= 1000 ? `${(total / 1000).toFixed(1)}k` : String(total)
              })()} label="ALGO pledged" accent />
              <Stat value={statsBase.filter(p => deriveProjectStatus(p, currentRound) === 'active').length} label="Live campaigns" />
              <Stat value="100%" label="Refund guarantee" />
            </div>
          </div>

          {/* Floating preview cards */}
          <div className="hero-art">
            {heroCards.slice(0, 3).map((p, i) => {
              const raised = Number(p.gs?.raised ?? 0)
              const goal   = Number(p.gs?.goal   ?? 1)
              const pc     = pctNum(raised, goal)
              return (
                <div key={p.id} className={`float-card fc-${i + 1}`}>
                  <div className="fc-top" />
                  <div className="fc-row">
                    <div>
                      <div className="fc-name">{p.meta?.name || `Project #${p.id}`}</div>
                      <span className="badge">{p.meta?.category || 'Other'}</span>
                    </div>
                    <div className="fc-pct">{pc}%</div>
                  </div>
                  <div style={{ marginTop: 14 }}><Progress raised={raised} goal={goal} /></div>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* ── Explore grid ── */}
      <section className="section wrap" id="explore-grid">
        <div className="section-head">
          <div>
            <span className="eyebrow">Discover</span>
            <h2 className="section-title" style={{ marginTop: 10 }}>Explore campaigns</h2>
          </div>
          <div className="search">
            <Icon.search />
            <input
              placeholder="Search projects…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="filters" style={{ marginBottom: 16 }}>
          {FILTERS.map(f => (
            <button key={f} className={`chip${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>{f}</button>
          ))}
        </div>

        <div style={{
          fontSize: 12, color: 'var(--text-muted)', marginBottom: 20,
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <Icon.shield style={{ width: 12, height: 12, flexShrink: 0 }} />
          Campaign statuses refresh every 2 minutes. Click any campaign for real-time details.
        </div>

        {loading ? (
          <div className="grid-cards">
            {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : error ? (
          <div className="error-box">⚠ {error}</div>
        ) : filtered.length === 0 && (filter === 'Cancelled' || !!search) ? (
          <div className="empty-state">
            <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
              <circle cx="32" cy="32" r="31" stroke="var(--border-strong)" strokeWidth="1.5" strokeDasharray="4 4" />
              <circle cx="32" cy="32" r="18" stroke="var(--border-strong)" strokeWidth="1" />
              <path d="M24 32L32 24L40 32L32 40Z" stroke="var(--accent)" strokeWidth="1.5" fill="none" />
              <circle cx="32" cy="32" r="3" fill="var(--accent)" opacity="0.5" />
            </svg>
            <h3>{projects.length === 0 ? 'No campaigns yet' : 'Nothing matches'}</h3>
            <p>{projects.length === 0 ? 'Be the first to launch a crowdfunding campaign on Sprout.' : 'Try a different filter or clear your search.'}</p>
            {projects.length === 0 && <Link to="/create" className="btn btn-primary" style={{ marginTop: 8 }}>Launch a project</Link>}
          </div>
        ) : (
          <div className="grid-cards">
            {filter !== 'Cancelled' && !search && (
              <ProjectCard key="placeholder" project={PLACEHOLDER} currentRound={currentRound} />
            )}
            {filtered.map(p => <ProjectCard key={p.id} project={p} currentRound={currentRound} />)}
          </div>
        )}

        {/* Pagination controls */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 40 }}>
            <button
              className="btn btn-ghost btn-sm"
              disabled={page === 1 || loading}
              onClick={() => setPage(p => Math.max(1, p - 1))}
            >
              ← Previous
            </button>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Page {page} of {totalPages} · {total} campaigns
            </span>
            <button
              className="btn btn-ghost btn-sm"
              disabled={page === totalPages || loading}
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            >
              Next →
            </button>
          </div>
        )}
      </section>

      {/* ── How it works ── */}
      <section className="section wrap">
        <span className="eyebrow">How it works</span>
        <h2 className="section-title" style={{ marginTop: 10, marginBottom: 32 }}>Funded fairly, settled on-chain</h2>
        <div className="hiw">
          {[
            { ic: <Icon.spark />, n: '01', t: 'Launch your campaign', d: 'Set your funding goal, token rate, and deadline. Deploy a crowdfunding contract to Algorand in minutes.' },
            { ic: <Icon.users />, n: '02', t: 'Backers contribute', d: 'Anyone with an Algorand wallet opts in and invests before the deadline. Every contribution is held in a non-custodial smart contract.' },
            { ic: <Icon.bolt />, n: '03', t: 'Goal reached → tokens', d: 'Hit your funding goal and backers receive the agreed upon project token. You receive the raised ALGO, minus a 4% fee.' },
            { ic: <Icon.refund />, n: '04', t: 'Missed → full refund', d: "If the goal isn't met by the deadline, every backer is refunded in full. No funds are ever stranded." },
          ].map(s => (
            <div className="hiw-step" key={s.n}>
              <div className="hiw-ic">{s.ic}</div>
              <span className="hiw-num">{s.n}</span>
              <h4>{s.t}</h4>
              <p>{s.d}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
