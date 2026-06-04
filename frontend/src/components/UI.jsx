import React, { useState } from 'react'

// ── Icons ──────────────────────────────────────────────────────────────────────
export const Icon = {
  logo: (p) => (
    <svg viewBox="0 0 24 24" fill="none" {...p}>
      {/* Sprout icon — stem with two leaves */}
      <path d="M12 22V12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      <path d="M12 12C12 12 7 11 5 7C7 3 12 4 12 7" fill="currentColor" opacity="0.85"/>
      <path d="M12 12C12 12 17 10 19 6C17 2 12 3 12 6" fill="currentColor"/>
    </svg>
  ),
  arrow:  (p) => <svg viewBox="0 0 24 24" fill="none" {...p}><path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  plus:   (p) => <svg viewBox="0 0 24 24" fill="none" {...p}><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>,
  copy:   (p) => <svg viewBox="0 0 24 24" fill="none" {...p}><rect x="9" y="9" width="11" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.8"/><path d="M5 15V5a2 2 0 012-2h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>,
  check:  (p) => <svg viewBox="0 0 24 24" fill="none" {...p}><path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  clock:  (p) => <svg viewBox="0 0 24 24" fill="none" {...p}><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8"/><path d="M12 7v5l3.5 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>,
  users:  (p) => <svg viewBox="0 0 24 24" fill="none" {...p}><circle cx="9" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.8"/><path d="M3.5 19c.6-3.2 2.9-5 5.5-5s4.9 1.8 5.5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><path d="M16 5.2A3 3 0 0118 11M17.5 14c2 .6 3.5 2.4 4 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>,
  shield: (p) => <svg viewBox="0 0 24 24" fill="none" {...p}><path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6l7-3z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  bolt:   (p) => <svg viewBox="0 0 24 24" fill="none" {...p}><path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" fill="currentColor"/></svg>,
  refund: (p) => <svg viewBox="0 0 24 24" fill="none" {...p}><path d="M3 12a9 9 0 109-9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><path d="M3 4v4h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  globe:  (p) => <svg viewBox="0 0 24 24" fill="none" {...p}><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7"/><path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" stroke="currentColor" strokeWidth="1.7"/></svg>,
  spark:  (p) => <svg viewBox="0 0 24 24" fill="none" {...p}><path d="M12 3v6M12 15v6M3 12h6M15 12h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>,
  search: (p) => <svg viewBox="0 0 24 24" fill="none" {...p}><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8"/><path d="M20 20l-3-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>,
}

// ── Brand ──────────────────────────────────────────────────────────────────────
export function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark"><Icon.logo style={{ color: 'var(--accent)' }} /></span>
      Sprout
    </div>
  )
}

// ── Status badge ───────────────────────────────────────────────────────────────
const STATUS_MAP = {
  'needs-setup': { label: 'Needs setup',  cls: 'badge-warn'    },
  'active':      { label: 'Live',         cls: 'badge-accent'  },
  'funded':      { label: 'Funded',       cls: 'badge-success' },
  'distributed': { label: 'Distributed',  cls: 'badge-success' },
  'cancelled':   { label: 'Cancelled',    cls: 'badge-danger'  },
  'failed':      { label: 'Goal not met', cls: 'badge-danger'  },
}

export function StatusBadge({ status }) {
  const s = STATUS_MAP[status] || { label: status, cls: '' }
  return (
    <span className={`badge ${s.cls}`}>
      {status === 'active' && <span className="badge-dot" />}
      {s.label}
    </span>
  )
}

// ── Copyable ID tag ────────────────────────────────────────────────────────────
export function IdTag({ label, value }) {
  const [copied, setCopied] = useState(false)
  function copy(e) {
    e.stopPropagation()
    navigator.clipboard?.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }
  return (
    <span className="idtag" onClick={copy} title={`Copy: ${value}`}>
      {label && <span style={{ color: 'var(--text-faint)' }}>{label}</span>}
      <span>{value}</span>
      {copied
        ? <Icon.check style={{ color: 'var(--success)' }} />
        : <Icon.copy />
      }
    </span>
  )
}

// ── Progress bar ───────────────────────────────────────────────────────────────
export function Progress({ raised, goal, animated = true }) {
  const p = Math.min(100, Math.round((raised / goal) * 100)) || 0
  return (
    <div className={`progress${p >= 100 ? ' done' : ''}`}>
      <i style={{ width: animated ? `${p}%` : `${p}%` }} />
    </div>
  )
}

// ── Cover art (gradient identity per project) ──────────────────────────────────
export function Cover({ hue = 280, label, style, sym, imageUrl, className = '' }) {
  if (imageUrl) {
    return (
      <div className={`cover-ph ${className}`} style={{ backgroundImage: `url(${imageUrl})`, backgroundSize: 'cover', backgroundPosition: 'center', ...style }}>
        {sym && <span className="ph-sym">${sym}</span>}
        {label && <span className="ph-label">{label}</span>}
      </div>
    )
  }
  return (
    <div className={`cover-ph ${className}`} style={{
      background: `
        repeating-linear-gradient(135deg, oklch(1 0 0 / 0.035) 0 16px, transparent 16px 32px),
        radial-gradient(120% 120% at 15% 10%, oklch(0.5 0.16 ${hue} / 0.55), transparent 55%),
        linear-gradient(160deg, oklch(0.32 0.10 ${hue}), oklch(0.20 0.04 ${hue}))`,
      ...style,
    }}>
      {sym && <span className="ph-sym">${sym}</span>}
      {label && <span className="ph-label">{label}</span>}
    </div>
  )
}

// ── Stat block ─────────────────────────────────────────────────────────────────
export function Stat({ value, label, accent }) {
  return (
    <div className="stat">
      <div className="stat-val" style={accent ? { color: 'var(--accent)' } : undefined}>{value}</div>
      <div className="stat-lbl">{label}</div>
    </div>
  )
}

// ── Skeleton card ──────────────────────────────────────────────────────────────
export function SkeletonCard() {
  return (
    <div className="skeleton-card">
      <div className="sk-hero sk-pulse" />
      <div className="sk-body">
        <div className="sk-line sk-title sk-pulse" />
        <div className="sk-line sk-subtitle sk-pulse" />
        <div className="sk-bar sk-pulse" style={{ marginTop: 8 }} />
      </div>
    </div>
  )
}

// ── Data helpers ───────────────────────────────────────────────────────────────
export function fmtAlgo(n) {
  if (n >= 1000) return (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1) + 'k'
  if (n >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 0 })
  return n.toFixed(2)
}

export function pctNum(raised, goal) {
  return Math.min(100, Math.round((raised / goal) * 100)) || 0
}

export function shortAddr(a) {
  if (!a) return ''
  const s = String(a)
  if (s.length < 10) return s
  return s.slice(0, 6) + '…' + s.slice(-4)
}

const ROUND_SECS = 2.8
export function daysLeftLabel(deadlineRound, currentRound) {
  if (!deadlineRound || !currentRound) return { text: '—', urgent: false, ended: false }
  const roundsLeft = deadlineRound - currentRound
  if (roundsLeft <= 0) return { text: 'Ended', urgent: false, ended: true }
  const secsLeft = roundsLeft * ROUND_SECS
  const days = Math.floor(secsLeft / 86400)
  const hrs  = Math.floor((secsLeft % 86400) / 3600)
  if (days >= 1) return { text: `${days} day${days > 1 ? 's' : ''} left`, urgent: days <= 3, ended: false }
  return { text: `${hrs}h left`, urgent: true, ended: false }
}

export function deriveProjectStatus(p, currentRound = 0) {
  if (!p) return 'active'
  const m = p.meta || {}
  if (m.is_distributed || (p.deleted && !m.is_refunded && !m.is_cancelled)) return 'distributed'
  if (m.is_funded) return 'funded'
  if (m.is_cancelled || Number(p.gs?.cancelled ?? 0) === 1) return 'cancelled'
  if (m.is_refunded) return 'failed'
  if (!p.gs?.asa_id) return 'needs-setup'
  const raised      = Number(p.gs?.raised       ?? 0)
  const goal        = Number(p.gs?.goal         ?? 1)
  const fundedRound = Number(p.gs?.funded_round ?? 0)
  const deadline    = Number(p.gs?.deadline     ?? 0)
  // funded_round is set permanently when the goal is first reached
  if (fundedRound > 0 || raised >= goal) return 'funded'
  // Deadline passed without reaching goal — campaign failed
  if (deadline > 0 && currentRound > deadline) return 'failed'
  return 'active'
}

// Hue from category for cover art
const CATEGORY_HUE = {
  DeFi:           168,
  RWA:            45,
  AI:             220,
  NFT:            300,
  Gaming:         25,
  Infrastructure: 200,
  Social:         330,
  Other:          280,
}
export function categoryHue(category) {
  return CATEGORY_HUE[category] || 280
}
