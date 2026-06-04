import React, { useEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { useWallet } from '@txnlab/use-wallet-react'
import algosdk from 'algosdk'
import {
  algodClient, fetchOnChainBatch, gsFromCache, fetchLocalState,
  algoToMicro, signAndSend,
} from '../utils/algorand'
import { fetchCreatorProjectsMeta } from '../utils/api'
import { buildSetupGroup, buildOptInTxn, encodeUnsignedTxns } from '../utils/transactions'
import { useToast } from '../context/ToastContext'
import {
  Cover, StatusBadge, Progress, IdTag, Icon, SkeletonCard,
  fmtAlgo, pctNum, daysLeftLabel, deriveProjectStatus, categoryHue, shortAddr,
} from '../components/UI'

export default function MyProjects() {
  const { activeAddress, signTransactions } = useWallet()
  const { addToast } = useToast()
  const [projects, setProjects]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [filter, setFilter]       = useState('All')
  const [setupModal, setSetupModal] = useState(null)
  const [setupForm, setSetupForm] = useState({ asaId: '', goalAlgo: '', ratePerAlgo: '' })
  const [settingUp, setSettingUp] = useState(false)
  const [asaInfo, setAsaInfo]     = useState(null)   // { symbol, name } fetched from algod
  const [asaFetching, setAsaFetching] = useState(false)
  const [asaError, setAsaError]   = useState(null)

  const loadProjects = useCallback(async () => {
    if (!activeAddress) { setLoading(false); return }
    setLoading(true)
    try {
      // Supabase-first: fetch metadata then use cached on_chain_* columns.
      // Falls back to direct algod calls for uncached records.
      // ROLLBACK: remove cache block and restore fetchOnChainBatch for all IDs.
      const metas = await fetchCreatorProjectsMeta(activeAddress)
      const metaList = Array.isArray(metas) ? metas : []

      const cachedMap = {}
      const uncachedIds = []
      for (const meta of metaList) {
        const id = Number(meta.app_id)
        const cached = gsFromCache(meta)
        if (cached) {
          cachedMap[id] = { gs: cached, deleted: !!meta.on_chain_deleted }
        } else {
          uncachedIds.push(id)
        }
      }
      const algodResults = uncachedIds.length > 0
        ? await fetchOnChainBatch(uncachedIds)
        : {}

      const merged = metaList.map(meta => {
        const id = Number(meta.app_id)
        const { gs, deleted } = cachedMap[id] ?? algodResults[id] ?? { gs: {}, deleted: true }
        return { id, gs, meta, deleted }
      })
      setProjects(merged)
    } catch (e) {
      console.error(e)
    } finally { setLoading(false) }
  }, [activeAddress])

  useEffect(() => {
    if (setupModal) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [setupModal])

  useEffect(() => { loadProjects() }, [loadProjects])

  function openSetup(p) {
    setSetupModal({ appId: p.id, gs: p.gs, meta: p.meta })
    setSetupForm({
      asaId: '',
      goalAlgo: p.meta?.goal_micro ? (Number(p.meta.goal_micro) / 1_000_000).toString() : ((Number(p.gs?.goal) || 0) / 1_000_000).toString(),
      ratePerAlgo: p.meta?.rate_per_algo ? String(p.meta.rate_per_algo) : (Number(p.gs?.rate) || '').toString(),
    })
    setAsaInfo(null)
    setAsaError(null)
  }

  async function fetchAsaInfo(rawId) {
    const id = parseInt(rawId)
    if (!id || id <= 0) { setAsaInfo(null); setAsaError(null); return }
    setAsaFetching(true)
    setAsaError(null)
    setAsaInfo(null)
    try {
      const asset = await algodClient.getAssetByID(id).do()
      const p = asset.asset?.params ?? asset.params ?? asset
      setAsaInfo({
        symbol: p['unit-name'] ?? p.unitName ?? '',
        name:   p.name ?? '',
      })
    } catch {
      setAsaError(`ASA ${id} not found on-chain`)
    } finally {
      setAsaFetching(false)
    }
  }

  async function handleSetup() {
    if (!activeAddress || !setupModal) return
    const { appId } = setupModal
    const asaId = parseInt(setupForm.asaId)
    const goalAlgo = parseFloat(setupForm.goalAlgo)
    const ratePerAlgo = parseInt(setupForm.ratePerAlgo)
    if (!goalAlgo || !ratePerAlgo) return addToast('Fill in all fields', 'error')
    if (!asaId || asaId <= 0) return addToast('Enter a valid ASA ID first', 'error')
    if (asaError) return addToast(asaError, 'error')
    if (!asaInfo) return addToast('Wait for ASA info to load, or re-enter the ASA ID', 'error')
    setSettingUp(true)
    try {
      const appAddress = algosdk.getApplicationAddress(appId)
      const goalMicroAlgos = algoToMicro(goalAlgo)
      addToast('Step 1/2: Funding app account for minimum balance…', 'info', 3000)
      const sp = await algodClient.getTransactionParams().do()
      const fundTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        sender: activeAddress, receiver: appAddress, amount: 400_000,
        suggestedParams: { ...sp, flatFee: true, fee: 1000 },
      })
      await signAndSend(signTransactions, [fundTxn.toByte()])
      const existingLocalState = await fetchLocalState(appId, activeAddress)
      if (existingLocalState === null) {
        addToast('Step 1/2: Opting creator into app…', 'info', 3000)
        const optInTxn = await buildOptInTxn({ sender: activeAddress, appId })
        await signAndSend(signTransactions, [optInTxn.toByte()])
      } else {
        addToast('Step 1/2: Already opted in — skipping…', 'info', 2000)
      }
      addToast('Step 2/2: Sending setup (ASA opt-in + token pool)…', 'info', 3000)
      const txns = await buildSetupGroup({ sender: activeAddress, appId, asaId, goalMicroAlgos, rateAsaPerAlgo: ratePerAlgo, appAddress })
      const encoded = encodeUnsignedTxns(txns)
      await signAndSend(signTransactions, encoded)
      // Update token_name in Supabase from on-chain ASA unit name (backend verifies against algod)
      if (asaInfo.symbol) {
        try {
          const { updateProjectMeta } = await import('../utils/api')
          await updateProjectMeta({ address: activeAddress, appId, meta: { tokenName: asaInfo.symbol, asaId } })
        } catch { /* non-critical — token symbol display only */ }
      }
      addToast('Contract set up! Refreshing…', 'success')
      setSetupModal(null)
      // Wait 2 seconds for the backend syncSingleProject to complete before
      // reloading — otherwise the cache still shows asa_id=0 (needs-setup)
      await new Promise(r => setTimeout(r, 2000))
      loadProjects()
    } catch (e) {
      console.error(e)
      addToast(e?.message || 'Setup failed', 'error')
    } finally { setSettingUp(false) }
  }

  const FILTERS = ['All', 'Needs setup', 'Live', 'Funded', 'Cancelled']
  const filterMap = { 'All': null, 'Needs setup': ['needs-setup'], 'Live': ['active'], 'Funded': ['funded', 'distributed'], 'Cancelled': ['cancelled'] }

  const list = projects.filter(p => {
    const f = filterMap[filter]
    if (!f) return true
    return f.includes(deriveProjectStatus(p))
  })

  const needsSetupCount = projects.filter(p => deriveProjectStatus(p) === 'needs-setup').length
  const cancelledCount  = projects.filter(p => deriveProjectStatus(p) === 'cancelled').length
  const totalRaised = projects.reduce((s, p) => s + Number(p.gs?.raised ?? 0), 0)

  if (!activeAddress) {
    return (
      <div className="wrap rise">
        <div className="empty-state" style={{ paddingTop: 100 }}>
          <div style={{ fontSize: 48, color: 'var(--accent)' }}>◈</div>
          <h3>Connect your wallet</h3>
          <p>Connect to see your deployed crowdfunding campaigns.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="wrap rise">
      <div className="page-head">
        <div>
          <span className="eyebrow">Dashboard</span>
          <h1 style={{ marginTop: 10 }}>My Projects</h1>
          <p>
            {projects.length} campaign{projects.length !== 1 ? 's' : ''} · {fmtAlgo(totalRaised / 1_000_000)} ALGO raised
            {needsSetupCount > 0 && ` · ${needsSetupCount} need${needsSetupCount > 1 ? '' : 's'} setup`}
            {cancelledCount > 0 && ` · ${cancelledCount} cancelled`}
          </p>
        </div>
        <Link to="/create" className="btn btn-primary btn-lg">
          <Icon.plus style={{ width: 17, height: 17 }} /> New project
        </Link>
      </div>

      <div className="mp-filters">
        {FILTERS.map(f => (
          <button key={f} className={`chip${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>{f}</button>
        ))}
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[1,2,3].map(i => <div key={i} className="sk-pulse" style={{ height: 88, borderRadius: 'var(--r-md)' }} />)}
        </div>
      ) : list.length === 0 ? (
        <div className="empty-state">
          <Icon.spark style={{ width: 48, height: 48, color: 'var(--accent)' }} />
          <h3>{projects.length === 0 ? 'No campaigns yet' : 'Nothing in this filter'}</h3>
          <p>{projects.length === 0 ? "Deploy your first campaign to get started." : "Try a different filter."}</p>
          {projects.length === 0 && <Link to="/create" className="btn btn-primary" style={{ marginTop: 8 }}>Launch a project</Link>}
        </div>
      ) : (
        <div className="mp-list">
          {list.map(p => {
            const status = deriveProjectStatus(p)
            const hue    = categoryHue(p.meta?.category)
            const raised = Number(p.gs?.raised ?? 0)
            const goal   = Number(p.gs?.goal   ?? p.meta?.goal_micro ?? 1)
            const pct    = pctNum(raised, goal)
            const days   = daysLeftLabel(Number(p.gs?.deadline ?? 0), 0)
            const needsSetup = status === 'needs-setup'
            const untitled   = !p.meta?.tagline

            return (
              <div className="mp-row" key={p.id}>
                <Cover hue={hue} sym={p.meta?.token_name} imageUrl={p.meta?.image_url} className="mp-thumb" label="" style={{ width: 52, height: 52 }} />

                <div className="mp-main">
                  <div className="mp-name-row">
                    <span className={`mp-name${untitled ? ' untitled' : ''}`}>{untitled ? 'Untitled campaign' : p.meta?.name}</span>
                    <StatusBadge status={status} />
                  </div>
                  {!untitled && <div className="mp-tag">{p.meta?.tagline}</div>}
                  <div className="mp-meta">
                    <span className="badge" style={{ padding: '2px 9px', fontSize: 11 }}>{p.meta?.category || 'Other'}</span>
                    <IdTag label="App" value={String(p.id)} />
                    {!days.ended && !needsSetup && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <Icon.clock style={{ width: 13, height: 13 }} /> {days.text}
                      </span>
                    )}
                  </div>
                </div>

                <div className="mp-fund">
                  {needsSetup ? (
                    <span className="faint" style={{ fontSize: 13 }}>Not set up</span>
                  ) : (
                    <>
                      <div className="mp-fund-top">
                        <b>{fmtAlgo(raised / 1_000_000)}</b>
                        <span className="faint">/ {fmtAlgo(goal / 1_000_000)} ALGO</span>
                        <span className="mono faint" style={{ fontSize: 12 }}>{pct}%</span>
                      </div>
                      <Progress raised={raised} goal={goal} />
                    </>
                  )}
                </div>

                <div className="mp-actions">
                  {needsSetup
                    ? <button className="btn btn-primary btn-sm" onClick={() => openSetup(p)}>Set up contract</button>
                    : <Link to={`/project/${p.id}`} className="btn btn-ghost btn-sm">View campaign</Link>
                  }
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Setup modal */}
      {setupModal && createPortal(
        <div className="setup-modal-overlay" onClick={e => { if (e.target === e.currentTarget) setSetupModal(null) }}>
          <div className="setup-modal rise">
            <h2>Set up contract</h2>
            <p className="faint" style={{ fontSize: 14, marginTop: 4 }}>App #{setupModal.appId}</p>

            <div className="setup-modal-fields">
              <div className="field">
                <label>ASA / Token ID *</label>
                <input
                  className="input"
                  type="text"
                  inputMode="numeric"
                  placeholder="e.g. 123456789"
                  value={setupForm.asaId}
                  onChange={e => {
                    const v = e.target.value.replace(/[^0-9]/g, '')
                    setSetupForm(f => ({ ...f, asaId: v }))
                    setAsaInfo(null)
                    setAsaError(null)
                  }}
                  onBlur={e => fetchAsaInfo(e.target.value)}
                />
                {asaFetching && (
                  <span className="field-hint">Looking up ASA…</span>
                )}
                {asaInfo && (
                  <span className="field-hint" style={{ color: 'var(--success)' }}>
                    ✓ {asaInfo.name}{asaInfo.symbol ? ` (${asaInfo.symbol})` : ''} found on-chain
                  </span>
                )}
                {asaError && (
                  <span className="field-hint" style={{ color: 'var(--danger)' }}>{asaError}</span>
                )}
                {!asaFetching && !asaInfo && !asaError && (
                  <span className="field-hint">The Algorand Standard Asset ID for your project token.</span>
                )}
              </div>

              <div className="field">
                <label>Funding Goal (ALGO)</label>
                <div className="readonly-field">{setupForm.goalAlgo || '—'} ALGO</div>
                <span className="field-hint">Set at project creation — cannot be changed.</span>
              </div>

              <div className="field">
                <label>Token Rate (base units per ALGO)</label>
                <div className="readonly-field">{setupForm.ratePerAlgo || '—'}</div>
                <span className="field-hint">Set at project creation — cannot be changed.</span>
              </div>

              {setupForm.goalAlgo && setupForm.ratePerAlgo && (
                <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: 14, fontSize: 13, color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Tokens to provide:</span>
                    <span className="mono" style={{ color: 'var(--text)' }}>{Math.floor((+setupForm.goalAlgo || 0) * (+setupForm.ratePerAlgo || 0)).toLocaleString()}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                    Success fee (4%) is deducted from your payout when you claim. Listing fee was paid at deployment.
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                    Note: 0.4 ALGO is sent to the contract account to cover Algorand minimum balance requirements. This is refunded to you when the contract is closed.
                  </div>
                </div>
              )}
            </div>

            <div className="setup-modal-actions">
              <button className="btn btn-ghost" onClick={() => setSetupModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSetup} disabled={settingUp}>
                {settingUp ? 'Processing…' : 'Set up contract'}
              </button>
            </div>
          </div>
        </div>
      , document.body)}
    </div>
  )
}
