import React, { useEffect, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useWallet } from '@txnlab/use-wallet-react'
import algosdk from 'algosdk'
import {
  algodClient, fetchAppInfo, fetchLocalState,
  shortAddress, signAndSend, ADMIN_ADDRESS,
} from '../utils/algorand'
import { fetchProjectMeta, updateStatus, fetchSeries } from '../utils/api'
import {
  buildOptInTxn, buildAsaOptInTxn, buildContributeGroup,
  buildFinalizeTxn, buildCreatorClaimTxn, buildRefundTxn,
  buildDeleteAppTxn, buildClearStateTxn,
} from '../utils/transactions'
import { useToast } from '../context/ToastContext'
import {
  Cover, StatusBadge, Progress, IdTag, Icon,
  fmtAlgo, pctNum, daysLeftLabel, deriveProjectStatus, categoryHue, shortAddr,
} from '../components/UI'

function SeriesTimeline({ seriesId, currentAppId, meta }) {
  const [series, setSeries] = React.useState([])
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    if (!seriesId) return
    fetchSeries(seriesId)
      .then(data => setSeries(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [seriesId])

  // Include planned milestones from current meta
  const planned = meta.planned_milestones || []
  const nextNum = series.length + 1

  if (loading || (series.length === 0 && planned.length === 0)) return null

  return (
    <div className="detail-section" style={{ marginTop: 24 }}>
      <h3>Campaign series</h3>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.5 }}>
        This campaign is part of a multi-milestone series. Completed milestones are verified on-chain.
        <br />
        <em>Note: Milestones are creator commitments and are not enforced on-chain. Sprout does not verify milestone completion.</em>
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {series.map((m, i) => {
          const isCurrent  = Number(m.app_id) === Number(currentAppId)
          const isComplete = !!m.milestone_completed_at
          const isFunded   = m.is_funded || m.is_distributed || Number(m.on_chain_funded_round) > 0
          return (
            <div key={m.app_id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 28 }}>
                <div style={{
                  width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0,
                  background: isComplete ? 'var(--success)' : isCurrent ? 'var(--accent)' : 'var(--surface-2)',
                  color: isComplete || isCurrent ? 'white' : 'var(--text-muted)',
                  border: isCurrent ? '2px solid var(--accent)' : 'none',
                }}>
                  {isComplete ? '✓' : (m.milestone_number || i + 1)}
                </div>
                {i < series.length - 1 || planned.length > 0 ? (
                  <div style={{ width: 2, flex: 1, minHeight: 20, background: 'var(--border)', margin: '4px 0' }} />
                ) : null}
              </div>
              <div style={{ flex: 1, paddingBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>
                    {isCurrent ? (
                      <span style={{ color: 'var(--accent)' }}>{m.milestone_title || m.name} ← This campaign</span>
                    ) : (
                      <a href={`/project/${m.app_id}`} style={{ color: 'var(--text)', textDecoration: 'underline' }}>
                        {m.milestone_title || m.name}
                      </a>
                    )}
                  </span>
                  {isComplete && <span style={{ fontSize: 11, padding: '2px 7px', background: 'var(--success-soft)', color: 'var(--success)', borderRadius: 4 }}>Completed</span>}
                  {!isComplete && isFunded && <span style={{ fontSize: 11, padding: '2px 7px', background: 'var(--accent-soft)', color: 'var(--accent)', borderRadius: 4 }}>Funded</span>}
                  {!isComplete && !isFunded && !isCurrent && <span style={{ fontSize: 11, padding: '2px 7px', background: 'var(--surface-2)', color: 'var(--text-muted)', borderRadius: 4 }}>In progress</span>}
                </div>
                {m.milestone_description && (
                  <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>{m.milestone_description}</p>
                )}
                {m.goal_micro && (
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Goal: {(Number(m.goal_micro) / 1_000_000).toLocaleString()} ALGO
                    {Number(m.on_chain_raised) > 0 ? ` · Raised: ${(Number(m.on_chain_raised) / 1_000_000).toLocaleString()} ALGO` : ''}
                  </span>
                )}
              </div>
            </div>
          )
        })}
        {/* Planned future milestones */}
        {planned.map((m, i) => (
          <div key={`planned-${i}`} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', opacity: 0.5 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 28 }}>
              <div style={{
                width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0,
                background: 'var(--surface-2)', color: 'var(--text-muted)',
                border: '1.5px dashed var(--border)',
              }}>
                {nextNum + i}
              </div>
              {i < planned.length - 1 && (
                <div style={{ width: 2, flex: 1, minHeight: 20, background: 'var(--border)', margin: '4px 0', opacity: 0.4 }} />
              )}
            </div>
            <div style={{ flex: 1, paddingBottom: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-muted)' }}>
                {m.title} <span style={{ fontSize: 11, padding: '2px 7px', background: 'var(--surface-2)', color: 'var(--text-muted)', borderRadius: 4 }}>Upcoming</span>
              </div>
              {m.description && (
                <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>{m.description}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function ProjectDetail() {
  const { appId: appIdStr } = useParams()
  const appId = Number(appIdStr)
  const { activeAddress, signTransactions } = useWallet()
  const { addToast } = useToast()

  const [gs, setGs]                       = useState(null)
  const [appDeleted, setAppDeleted]       = useState(false)
  const [asaDecimals, setAsaDecimals]     = useState(0)
  const [asaUnitName, setAsaUnitName]     = useState('')
  const [meta, setMeta]                   = useState(null)
  const [localState, setLocalState]       = useState(undefined)
  const [loading, setLoading]             = useState(true)
  const [currentRound, setCurrentRound]   = useState(0)
  const [contributeAmt, setContributeAmt] = useState('')
  const [contributing, setContributing]   = useState(false)
  const [actioning, setActioning]         = useState(false)
  const [showContract, setShowContract]   = useState(false)

  const loadData = useCallback(async () => {
    try {
      try { const m = await fetchProjectMeta(appId); setMeta(m) } catch { setMeta(null) }
      try {
        const info = await fetchAppInfo(appId)
        if (info.deleted) {
          setAppDeleted(true); setGs({})
        } else {
          setAppDeleted(false); setGs(info.gs)
          const asaId = Number(info.gs?.asa_id ?? 0)
          if (asaId) {
            try {
              const ai = await algodClient.getAssetByID(asaId).do()
              const p = ai.params ?? ai
              setAsaDecimals(Number(p.decimals ?? 0))
              setAsaUnitName(p['unit-name'] ?? p.unitName ?? '')
            } catch { setAsaDecimals(0); setAsaUnitName('') }
          }
        }
      } catch { setAppDeleted(true); setGs({}) }

      const status = await algodClient.status().do()
      setCurrentRound(Number(status['last-round'] ?? status.lastRound ?? 0))
      if (activeAddress) {
        const ls = await fetchLocalState(appId, activeAddress)
        setLocalState(ls)
      } else { setLocalState(undefined) }
    } catch (e) {
      console.error(e)
      addToast('Failed to load project data', 'error')
    } finally { setLoading(false) }
  }, [appId, activeAddress])

  useEffect(() => { loadData() }, [loadData])

  async function signAndSendTxns(txns) {
    const arr = Array.isArray(txns) ? txns : [txns]
    return signAndSend(signTransactions, arr.map(t => t.toByte()))
  }

  async function handleOptIn() {
    if (!activeAddress) return addToast('Connect your wallet first', 'info')
    try {
      await signAndSendTxns(await buildOptInTxn({ sender: activeAddress, appId }))
      addToast('Opted in!', 'success'); loadData()
    } catch (e) { addToast(e?.message || 'Opt-in failed', 'error') }
  }

  async function handleContribute() {
    if (!activeAddress) return addToast('Connect your wallet first', 'info')
    const amt = parseFloat(contributeAmt)
    if (!amt || amt <= 0) return addToast('Enter a valid amount', 'error')
    if (!Number.isInteger(amt)) return addToast('Contributions must be a whole number of ALGO', 'error')
    const remainingAlgo = Math.floor((goal - raised) / 1_000_000)
    if (amt > remainingAlgo) return addToast(`Max contribution is ${remainingAlgo} ALGO`, 'error')
    const amountMicro = Math.floor(amt) * 1_000_000
    const appAddress  = algosdk.getApplicationAddress(appId)
    setContributing(true)
    try {
      const asaId = Number(gs.asa_id)
      if (asaId) {
        let hasAsset = false
        try { await algodClient.accountAssetInformation(activeAddress, asaId).do(); hasAsset = true } catch {}
        if (!hasAsset) {
          addToast(`Opting into token ASA ${asaId}…`, 'info', 4000)
          await signAndSendTxns(await buildAsaOptInTxn({ sender: activeAddress, asaId }))
          addToast('Token opt-in done. Sending contribution…', 'success', 3000)
        }
      }
      const txns = await buildContributeGroup({ sender: activeAddress, appId, appAddress, amountMicroAlgos: amountMicro })
      await signAndSendTxns(txns)
      addToast(`Contributed ${amt} ALGO!`, 'success')
      setContributeAmt('')
      loadData()
    } catch (e) {
      const msg = e?.message || ''
      if (msg.includes('overspend') || msg.includes('below min') || msg.includes('insufficient funds') || msg.includes('underflow')) {
        addToast('Insufficient funds. Remember to leave enough ALGO in your wallet to cover the contribution plus transaction fees and your wallet\'s minimum balance.', 'error', 8000)
      } else {
        addToast(msg || 'Contribution failed', 'error')
      }
    } finally { setContributing(false) }
  }

  async function handleFinalize() {
    if (!activeAddress) return addToast('Connect your wallet first', 'info')
    setActioning(true)
    try {
      await signAndSendTxns(await buildFinalizeTxn({ sender: activeAddress, appId, asaId: gs?.asa_id }))
      addToast('Tokens claimed!', 'success')
      loadData()
    } catch (e) { addToast(e?.message || 'Claim failed', 'error') }
    finally { setActioning(false) }
  }

  async function handleCreatorClaim() {
    if (!activeAddress) return addToast('Connect your wallet first', 'info')
    setActioning(true)
    try {
      await signAndSendTxns(await buildCreatorClaimTxn({ sender: activeAddress, appId }))
      addToast('ALGO claimed!', 'success')
      await updateStatus({ address: activeAddress, appId,  flags: { is_funded: true } })
      const refreshed = await fetchProjectMeta(appId); setMeta(refreshed)
      loadData()
    } catch (e) { addToast(e?.message || 'Creator claim failed', 'error') }
    finally { setActioning(false) }
  }

  async function handleRefund() {
    if (!activeAddress) return addToast('Connect your wallet first', 'info')
    setActioning(true)
    try {
      await signAndSendTxns(await buildRefundTxn({ sender: activeAddress, appId, asaId: gs?.asa_id }))
      addToast('Refund claimed!', 'success')
      loadData()
    } catch (e) { addToast(e?.message || 'Refund failed', 'error') }
    finally { setActioning(false) }
  }

  // ── Derived state ──────────────────────────────────────────────────────────
  const safeGs      = gs || {}
  const raised      = Number(safeGs.raised   ?? 0)
  const goal        = Number(safeGs.goal     ?? meta?.goal_micro ?? 1)
  const deadline    = Number(safeGs.deadline ?? 0)
  const rate        = Number(safeGs.rate     ?? 0)
  const fundedRound = Number(safeGs.funded_round ?? 0)
  const asaIdOnChain = Number(safeGs.asa_id ?? 0)
  const isRefunded     = !!meta?.is_refunded
  const isDistributed  = !!meta?.is_distributed || (appDeleted && !isRefunded)
  // succeeded = funded_round > 0 (sticky, never re-derived from raised)
  const succeeded      = fundedRound > 0
  const isSuccess      = succeeded || !!meta?.is_funded || isDistributed
  const isPastDeadline = deadline > 0 && currentRound > deadline
  const isCancelled    = !!meta?.is_cancelled || Number(safeGs.cancelled ?? 0) === 1
  // failed: funded_round == 0 AND (cancelled OR after_deadline) — structurally
  // excludes success so refund can never reopen on a funded campaign
  const failed = !succeeded && (isCancelled || isPastDeadline)
  // Lock display values at goal once funded
  const isFundedOrDistributed = succeeded || isDistributed || !!meta?.is_funded
  const displayRaised  = isFundedOrDistributed ? goal : raised
  const pct            = pctNum(displayRaised, goal)
  const status         = deriveProjectStatus({ gs: safeGs, meta, deleted: appDeleted })
  const days           = daysLeftLabel(deadline, currentRound)
  const myContrib      = localState ? Number(localState.contrib ?? 0) : 0
  const appAddress     = appId ? (() => { try { return algosdk.getApplicationAddress(appId) } catch { return '' } })() : ''
  const hue            = categoryHue(meta?.category)

  function baseUnitsToTokens(n) {
    if (asaDecimals === 0) return Math.floor(n)
    return n / Math.pow(10, asaDecimals)
  }
  function formatTokens(n) {
    const whole = baseUnitsToTokens(n)
    const name  = asaUnitName || meta?.token_name || 'tokens'
    return `${whole.toLocaleString(undefined, { maximumFractionDigits: asaDecimals })} ${name}`
  }
  const tokensPerAlgo = rate > 0 ? baseUnitsToTokens(rate) : 0
  const tokensYouGet  = contributeAmt && rate
    ? baseUnitsToTokens(Math.floor((Math.floor(parseFloat(contributeAmt) || 0) * 1_000_000 * rate) / 1_000_000))
    : 0

  const creatorClaimed = Number(safeGs.creator_claimed ?? 0) === 1
  const adminClaimed   = Number(safeGs.admin_claimed   ?? 0) === 1
  // Pull model actions — keyed on sticky predicates
  const canClaim         = !!activeAddress && myContrib > 0 && succeeded && !isCancelled
  const canRefund        = !!activeAddress && myContrib > 0 && failed
  const canCreatorClaim  = !!activeAddress && activeAddress === safeGs.creator && succeeded && !isCancelled && !creatorClaimed
  const canCreatorReclaimAsa = !!activeAddress && activeAddress === safeGs.creator && failed && asaIdOnChain > 0
  // Admin-only settlement panel — creator is excluded intentionally.
  // creator_claim and creator_reclaim_asa have their own dedicated buttons.
  const isSettler       = !!activeAddress && (activeAddress === safeGs.admin || activeAddress === ADMIN_ADDRESS)
  const canAdminClaim   = isSettler && !adminClaimed && asaIdOnChain === 0 && (succeeded || failed)
  const canAdminSweepAsa = isSettler && !adminClaimed && asaIdOnChain > 0 && (succeeded || failed)
  const funded = isSuccess || isDistributed

  // Admin settlement panel inline components
  function AdminSweepAsaButton({ appId, asaIdVal, actioning, setActioning, loadData, addToast, signAndSendTxns }) {
    return (
      <button
        className="btn btn-soft btn-sm"
        disabled={actioning}
        onClick={async () => {
          setActioning(true)
          try {
            const { buildAdminSweepAsaTxn } = await import('../utils/transactions')
            await signAndSendTxns(await buildAdminSweepAsaTxn({ sender: activeAddress, appId, asaId: asaIdVal }))
            addToast('ASA swept. Now run admin_claim to close ALGO.', 'success', 5000)
            loadData()
          } catch (e) { addToast(e?.message || 'ASA sweep failed', 'error') }
          finally { setActioning(false) }
        }}
      >
        {actioning ? 'Processing…' : 'Sweep ASA to admin'}
      </button>
    )
  }

  function AdminClaimButton({ appId, actioning, setActioning, loadData, setMeta, addToast, signAndSendTxns }) {
    return (
      <button
        className="btn btn-soft btn-sm"
        disabled={actioning}
        onClick={async () => {
          setActioning(true)
          try {
            const { buildAdminClaimTxn, buildDeleteAppTxn: delTxn } = await import('../utils/transactions')
            await signAndSendTxns(await buildAdminClaimTxn({ sender: activeAddress, appId, creatorAddress: safeGs.creator }))
            addToast('ALGO closed. Deleting contract…', 'info', 3000)
            await signAndSendTxns(await delTxn({ sender: activeAddress, appId }))
            await updateStatus({ address: activeAddress, appId,  flags: { is_distributed: true } })
            const refreshed = await fetchProjectMeta(appId); setMeta(refreshed)
            addToast('Contract closed.', 'success')
            loadData()
          } catch (e) {
            const msg = e?.message || ''
            if (msg.includes('pc=598') || msg.includes('||; &&')) {
              addToast('Grace period has not yet expired. The contract will allow closure once the grace period ends.', 'error', 8000)
            } else if (msg.includes('pc=451') || msg.includes('&&; ||')) {
              addToast('Contract cannot be closed yet. The grace period must expire after the campaign deadline before the admin can close a cancelled contract.', 'error', 8000)
            } else {
              addToast(msg || 'Admin claim failed', 'error')
            }
          } finally { setActioning(false) }
        }}
      >
        {actioning ? 'Processing…' : 'Close contract (ALGO)'}
      </button>
    )
  }

  if (loading) {
    return (
      <div className="wrap detail-top rise">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 60 }}>
          <div className="sk-pulse" style={{ height: 340, borderRadius: 'var(--r-xl)' }} />
          <div className="sk-line sk-pulse sk-title" style={{ height: 40, width: '60%' }} />
        </div>
      </div>
    )
  }

  if (!meta) {
    return (
      <div className="wrap detail-top">
        <Link to="/" className="back-link"><Icon.arrow /> Back to campaigns</Link>
        <div className="error-box">Project #{appId} not found in the registry.</div>
      </div>
    )
  }

  return (
    <div className="wrap detail-top rise">
      <Link to="/" className="back-link"><Icon.arrow /> Back to campaigns</Link>

      <div className="detail-grid">
        {/* ── Left — story ── */}
        <div>
          <Cover
            hue={hue}
            sym={asaUnitName || meta.token_name}
            imageUrl={meta.image_url}
            className="detail-cover"
            style={{ height: 340 }}
          />

          <div className="detail-head">
            <span className="badge badge-accent">{meta.category || 'Other'}</span>
            <StatusBadge status={status} />
          </div>

          <h1 className="detail-title">{meta.name}</h1>
          {meta.tagline && <p className="detail-tag">{meta.tagline}</p>}

          <div className="detail-creator">
            <div className="creator-av" />
            <div>
              <div style={{ fontWeight: 700, fontSize: 14.5 }}>{shortAddr(safeGs.creator)}</div>
              <div className="faint" style={{ fontSize: 13 }}>Verified creator</div>
            </div>
          </div>

          {meta.description && (
            <div className="detail-section">
              <h3>About this project</h3>
              <p className="detail-body">{meta.description}</p>
            </div>
          )}

          {/* Donation campaign badge */}
          {meta.is_donation && (
            <div style={{ marginTop: 16, padding: '10px 14px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 13, color: 'var(--text-muted)' }}>
              <strong style={{ color: 'var(--text)' }}>Donation campaign</strong> — Backers contribute ALGO to support this project. No tokens are distributed.
            </div>
          )}

          {/* Series / milestone timeline */}
          {(meta.series_id || meta.milestone_title) && (
            <SeriesTimeline seriesId={meta.series_id || String(appId)} currentAppId={appId} meta={meta} />
          )}

          {meta.website_url && (
            <div style={{ marginTop: 20 }}>
              <a href={meta.website_url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">
                <Icon.globe style={{ width: 15, height: 15 }} /> Visit website
              </a>
            </div>
          )}
        </div>

        {/* ── Right — funding panel ── */}
        <aside>
          <div className="card fund-panel">
            {/* Progress */}
            <div>
              <div className="fund-big">
                {pct}<span style={{ fontSize: 22, color: 'var(--text-muted)' }}>%</span>
                {' '}<span style={{ fontSize: 17, color: 'var(--text-muted)', fontWeight: 500 }}>funded</span>
              </div>
              <div style={{ margin: '16px 0 8px' }}>
                <Progress raised={raised} goal={goal} />
              </div>
              <div className="fund-of">{fmtAlgo(displayRaised / 1_000_000)} of {fmtAlgo(goal / 1_000_000)} ALGO pledged</div>
            </div>

            <div className="fund-meta">
              <div className="stat">
                <div className="stat-val" style={{ fontSize: 21 }}>{days.text}</div>
                <div className="stat-lbl">{days.ended ? 'campaign closed' : 'until deadline'}</div>
              </div>
              {myContrib > 0 && (
                <div className="stat">
                  <div className="stat-val" style={{ fontSize: 21, color: 'var(--success)' }}>{fmtAlgo(myContrib / 1_000_000)}</div>
                  <div className="stat-lbl">your contribution</div>
                </div>
              )}
            </div>

            {/* Funded/distributed success state */}
            {funded ? (
              <div className="contrib-box funded-state">
                <div className="ring"><Icon.check /></div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>
                  {isDistributed ? 'Tokens distributed' : 'Successfully funded'}
                </div>
                <p className="field-hint" style={{ marginTop: 7 }}>
                  {isDistributed
                    ? 'This campaign reached its goal. All parties have claimed their shares.'
                    : 'This campaign reached its goal.'}
                </p>

                {/* Creator claim */}
                {canCreatorClaim && (
                  <button
                    className="btn btn-primary btn-block"
                    style={{ marginTop: 12 }}
                    onClick={handleCreatorClaim}
                    disabled={actioning}
                  >
                    {actioning ? 'Processing…' : `Claim ${fmtAlgo((goal * 0.96) / 1_000_000)} ALGO`}
                  </button>
                )}
                {activeAddress === safeGs.creator && creatorClaimed && !adminClaimed && (
                  <p className="field-hint" style={{ marginTop: 8 }}>
                    Your ALGO has been claimed. The admin will close the contract after the grace period.
                  </p>
                )}
                {isSettler && creatorClaimed && !adminClaimed && (
                  <p className="field-hint" style={{ marginTop: 8 }}>
                    Creator has claimed. Close the contract below once investors have claimed their tokens.
                  </p>
                )}

                {/* Investor claim */}
                {canClaim && (
                  <button
                    className="btn btn-primary btn-block"
                    style={{ marginTop: 12 }}
                    onClick={handleFinalize}
                    disabled={actioning}
                  >
                    {actioning ? 'Processing…' : `Claim ${formatTokens(Math.floor((myContrib * rate) / 1_000_000))}`}
                  </button>
                )}

              </div>
            ) : isCancelled ? (
              <div className="contrib-box funded-state">
                <div className="ring" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}><Icon.shield /></div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>Campaign cancelled</div>
                <p className="field-hint" style={{ marginTop: 7 }}>
                  This campaign was cancelled by the admin.
                  {myContrib > 0 ? ' Claim your refund below.' : ' Contributors can claim their refunds.'}
                </p>
                {canRefund && (
                  <button
                    className="btn btn-danger btn-block"
                    style={{ marginTop: 12 }}
                    onClick={handleRefund}
                    disabled={actioning}
                  >
                    {actioning ? 'Processing…' : `Claim refund (${fmtAlgo(myContrib / 1_000_000)} ALGO)`}
                  </button>
                )}
                {canCreatorReclaimAsa && (
                  <button
                    className="btn btn-soft btn-block"
                    style={{ marginTop: 8 }}
                    disabled={actioning}
                    onClick={async () => {
                      setActioning(true)
                      try {
                        const { buildCreatorReclaimAsaTxn } = await import('../utils/transactions')
                        await signAndSendTxns(await buildCreatorReclaimAsaTxn({ sender: activeAddress, appId, asaId: asaIdOnChain }))
                        addToast('Tokens returned to your wallet.', 'success')
                        loadData()
                      } catch (e) { addToast(e?.message || 'Reclaim failed', 'error') }
                      finally { setActioning(false) }
                    }}
                  >
                    {actioning ? 'Processing…' : 'Reclaim project tokens'}
                  </button>
                )}
              </div>
            ) : days.ended ? (
              <div className="contrib-box funded-state">
                <div className="ring" style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}><Icon.clock /></div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>Campaign ended</div>
                <p className="field-hint" style={{ marginTop: 7 }}>
                  This campaign did not reach its goal.
                  {myContrib > 0 ? ' Claim your refund below.' : ' Contributors can claim their refunds.'}
                </p>
                {canRefund && (
                  <button
                    className="btn btn-danger btn-block"
                    style={{ marginTop: 12 }}
                    onClick={handleRefund}
                    disabled={actioning}
                  >
                    {actioning ? 'Processing…' : `Claim refund (${fmtAlgo(myContrib / 1_000_000)} ALGO)`}
                  </button>
                )}
                {canCreatorReclaimAsa && (
                  <button
                    className="btn btn-soft btn-block"
                    style={{ marginTop: 8 }}
                    disabled={actioning}
                    onClick={async () => {
                      setActioning(true)
                      try {
                        const { buildCreatorReclaimAsaTxn } = await import('../utils/transactions')
                        await signAndSendTxns(await buildCreatorReclaimAsaTxn({ sender: activeAddress, appId, asaId: asaIdOnChain }))
                        addToast('Tokens returned to your wallet.', 'success')
                        loadData()
                      } catch (e) { addToast(e?.message || 'Reclaim failed', 'error') }
                      finally { setActioning(false) }
                    }}
                  >
                    {actioning ? 'Processing…' : 'Reclaim project tokens'}
                  </button>
                )}
              </div>
            ) : localState === undefined ? (
              <button className="btn btn-primary btn-block btn-lg" onClick={() => {}}>
                Connect wallet to contribute
              </button>
            ) : localState === null ? (
              <button className="btn btn-primary btn-block btn-lg" onClick={handleOptIn}>
                Opt in to contribute
              </button>
            ) : (
              /* Contribution form */
              <div className="contrib-box">
                <div className="field-hint" style={{ marginBottom: 10, color: 'var(--text-muted)', fontWeight: 600 }}>
                  Contribute to this campaign
                </div>
                {tokensPerAlgo > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--accent-soft)', border: '1px solid var(--accent-line)', borderRadius: 'var(--r-sm)', marginBottom: 10 }}>
                    <span className="faint" style={{ fontSize: 13 }}>1 ALGO</span>
                    <span className="faint">→</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--accent)', fontWeight: 600 }}>{formatTokens(rate)}</span>
                  </div>
                )}
                <div className="amt-input">
                  <input
                    type="number"
                    placeholder="50"
                    value={contributeAmt}
                    onChange={e => setContributeAmt(String(Math.floor(Math.max(1, Number(e.target.value)))))}
                    min="1"
                    max={Math.floor((goal - raised) / 1_000_000)}
                    step="1"
                    className="no-spin"
                  />
                  <span className="unit">ALGO</span>
                </div>
                <div className="amt-quick">
                  {[10, 100, 1_000, 10_000].map(v => {
                    const remaining = Math.floor((goal - raised) / 1_000_000)
                    const disabled = v > remaining
                    return (
                      <button
                        key={v}
                        onClick={() => setContributeAmt(String(v))}
                        disabled={disabled}
                        style={disabled ? { opacity: 0.35, cursor: 'not-allowed' } : {}}
                      >
                        {v.toLocaleString()}
                      </button>
                    )
                  })}
                </div>
                {tokensYouGet > 0 && (
                  <div className="receive-row">
                    <span className="faint" style={{ fontSize: 13.5 }}>You'll receive</span>
                    <span className="r-val">{formatTokens(Math.floor((Math.floor(parseFloat(contributeAmt) || 0) * 1_000_000 * rate) / 1_000_000))}</span>
                  </div>
                )}
                <button
                  className="btn btn-primary btn-block btn-lg"
                  style={{ marginTop: 14 }}
                  onClick={handleContribute}
                  disabled={contributing}
                >
                  {contributing ? 'Processing…' : 'Back this project'}
                </button>
                <p className="field-hint" style={{ marginTop: 11, textAlign: 'center' }}>
                  Refunded in full if the goal isn't met by the deadline.
                </p>
              </div>
            )}

            {/* Admin settlement panel — grace-only, two-step */}
            {isSettler && !adminClaimed && (canAdminSweepAsa || canAdminClaim) && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Admin settlement</div>
                {canAdminSweepAsa && (
                  <>
                    <div className="field-hint" style={{ marginBottom: 10 }}>
                      Step 1: Close the ASA holding to admin. You must be opted into the project token first.
                    </div>
                    <AdminSweepAsaButton appId={appId} asaIdVal={asaIdOnChain} actioning={actioning} setActioning={setActioning} loadData={loadData} addToast={addToast} signAndSendTxns={signAndSendTxns} />
                  </>
                )}
                {canAdminClaim && (
                  <>
                    <div className="field-hint" style={{ marginBottom: 10, marginTop: canAdminSweepAsa ? 12 : 0 }}>
                      {asaIdOnChain === 0
                        ? 'Close remaining ALGO and delete the contract. The contract will reject this call if the grace period has not yet expired.'
                        : 'Run Step 1 first — admin_claim requires asa_id == 0.'
                      }
                    </div>
                    <AdminClaimButton appId={appId} actioning={actioning} setActioning={setActioning} loadData={loadData} setMeta={setMeta} addToast={addToast} signAndSendTxns={signAndSendTxns} />
                  </>
                )}
              </div>
            )}

            {/* Contract details — demoted */}
            <div>
              <button className="btn btn-ghost btn-sm btn-block" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowContract(s => !s) }}>
                {showContract ? 'Hide' : 'Show'} contract details
              </button>
              {showContract && (
                <div style={{ marginTop: 14 }}>
                  {[
                    { label: 'App ID',      val: String(appId),                          copy: String(appId) },
                    appAddress && { label: 'App Address', val: shortAddr(appAddress),    copy: appAddress },
                    safeGs.creator && { label: 'Creator', val: shortAddr(safeGs.creator), copy: safeGs.creator },
                    safeGs.asa_id && { label: 'ASA / Token', val: String(safeGs.asa_id), copy: String(safeGs.asa_id) },
                    rate && { label: 'Token rate', val: `${tokensPerAlgo > 0 ? formatTokens(rate) : rate} / ALGO`, copy: null },
                    deadline > 0 && { label: 'Deadline round', val: deadline.toLocaleString(), copy: null },
                    deadline > 0 && currentRound > 0 && { label: 'Rounds remaining', val: Math.max(0, deadline - currentRound).toLocaleString(), copy: null },
                    { label: 'Network', val: 'Algorand Testnet', copy: null },
                  ].filter(Boolean).map(({ label, val, copy }) => (
                    <div className="contract-row" key={label}>
                      <span>{label}</span>
                      {copy
                        ? <IdTag value={val} />
                        : <span className="mono" style={{ fontSize: 13, color: 'var(--accent)' }}>{val}</span>
                      }
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
