import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Cover, StatusBadge, Progress,
  fmtAlgo, pctNum, daysLeftLabel, deriveProjectStatus, categoryHue,
} from './UI'

export default function ProjectCard({ project, currentRound = 0 }) {
  const { id, gs = {}, meta = {}, deleted, isPlaceholder } = project
  const navigate = useNavigate()

  const raised      = Number(gs.raised      ?? 0)
  const goal        = Number(gs.goal        ?? meta.goal_micro ?? 1)
  const deadline    = Number(gs.deadline    ?? 0)
  const fundedRound = Number(gs.funded_round ?? 0)
  const status      = deriveProjectStatus(project, currentRound)
  const hue         = categoryHue(meta.category)
  const isFundedOrDistributed = fundedRound > 0 || !!meta.is_distributed || !!meta.is_funded
  const displayRaised = isFundedOrDistributed ? goal : raised
  const pct           = pctNum(displayRaised, goal)
  const days          = daysLeftLabel(deadline, 0)

  const [mounted, setMounted] = useState(false)
  useEffect(() => { const t = setTimeout(() => setMounted(true), 80); return () => clearTimeout(t) }, [])

  return (
    <article
      className="pcard"
      onClick={() => isPlaceholder ? navigate('/project/demo') : navigate(`/project/${id}`)}
      style={isPlaceholder ? { cursor: 'pointer' } : undefined}
    >
      {isPlaceholder && (
        <div style={{
          position: 'absolute', top: 10, right: 10, zIndex: 2,
          background: 'var(--surface-2)', border: '1px solid var(--border)',
          borderRadius: 'var(--r-sm)', padding: '2px 8px',
          fontSize: 11, fontWeight: 600, letterSpacing: '0.05em',
          color: 'var(--text-muted)', textTransform: 'uppercase',
        }}>
          View example
        </div>
      )}
      <Cover
        hue={hue}
        sym={meta.token_name}
        imageUrl={meta.image_url}
        style={{ height: 150 }}
        label={undefined}
      />
      <div className="pcard-body">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span className="badge">{meta.category || 'Other'}</span>
          {meta.is_donation && (
            <span className="badge" style={{ background: "var(--accent-soft)", color: "var(--accent)", border: "1px solid var(--accent-line)" }}>Donation</span>
          )}
          <StatusBadge status={status} />
        </div>
        <h3 className="pcard-title">{meta.name || `Project #${id}`}</h3>
        <p className="pcard-tag">{meta.tagline || 'A project on Algorand.'}</p>
        <Progress raised={displayRaised} goal={goal} />
        <div className="pcard-stats">
          <div>
            <b style={{ color: 'var(--accent)' }}>{pct}%</b>
            <span>funded</span>
          </div>
          <div>
            <b>{fmtAlgo(displayRaised / 1_000_000)}</b>
            <span>of {fmtAlgo(goal / 1_000_000)} ALGO</span>
          </div>
          <div style={{ textAlign: 'right' }}>
            <b style={{ color: days.urgent ? 'var(--warn)' : undefined }}>{days.text}</b>
            <span>until deadline</span>
          </div>
        </div>
      </div>
    </article>
  )
}
