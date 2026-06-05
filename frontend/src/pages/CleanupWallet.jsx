import React, { useEffect, useState, useCallback } from 'react'
import { useWallet } from '@txnlab/use-wallet-react'
import { algodClient, signAndSend, shortAddr as shortAddrAlgo } from '../utils/algorand'
import { fetchPublicProjects } from '../utils/api'
import { buildClearStateTxn, buildAsaCloseTxn } from '../utils/transactions'
import { useToast } from '../context/ToastContext'
import { Icon, IdTag, shortAddr } from '../components/UI'

export default function CleanupWallet() {
  const { activeAddress, signTransactions } = useWallet()
  const { addToast } = useToast()

  const [appEntries, setAppEntries]   = useState([])
  const [asaEntries, setAsaEntries]   = useState([])
  const [loading, setLoading]         = useState(false)
  const [actioningId, setActioningId] = useState(null)

  const loadEntries = useCallback(async () => {
    if (!activeAddress) return
    setLoading(true)
    try {
      const info = await algodClient.accountInformation(activeAddress).do()
      const rawApps   = info['apps-local-state'] ?? info.appsLocalState ?? []
      const rawAssets = info.assets ?? []

      // Fetch project metadata from backend for name lookup
      let metas = []
      try {
        const result = await fetchPublicProjects()
        metas = Array.isArray(result) ? result : (result.projects ?? [])
      } catch {}
      const metaMap = {}
      for (const m of metas) metaMap[String(m.app_id)] = m

      // App opt-ins — check on-chain existence to identify ghost apps
      const parsedApps = await Promise.all(rawApps.map(async entry => {
        const appId = Number(entry.id ?? entry['id'])
        const meta  = metaMap[String(appId)] || null
        const kvs   = entry['key-value'] ?? entry.keyValue ?? []
        let contrib = 0
        for (const kv of kvs) {
          let key = kv.key
          if (key instanceof Uint8Array) key = new TextDecoder().decode(key)
          else try { key = atob(key) } catch { continue }
          if (key === 'contrib') contrib = Number(kv.value?.uint ?? 0)
        }
        // Check if contract still exists on-chain
        let ghost = false
        try {
          await algodClient.getApplicationByID(appId).do()
        } catch {
          ghost = true  // 404 — contract deleted, safe to force clear
        }
        return { appId, meta, contrib, ghost }
      }))
      setAppEntries(parsedApps)

      // ASA holdings linked to platform projects
      if (rawAssets.length > 0) {
        const asaResults = []
        await Promise.all(
          metas.map(async (meta) => {
            const appId = Number(meta.app_id)
            try {
              const appInfo = await algodClient.getApplicationByID(appId).do()
              if (appInfo.deleted) return
              const gs = appInfo.params?.['global-state'] ?? appInfo.params?.globalState ?? []
              let asaId = 0, creator = ''
              for (const item of gs) {
                let key = item.key
                if (key instanceof Uint8Array) key = new TextDecoder().decode(key)
                else try { key = atob(key) } catch { continue }
                if (key === 'asa_id') asaId = Number(item.value?.uint ?? 0)
                if (key === 'creator') {
                  const raw = item.value?.bytes
                  if (raw instanceof Uint8Array && raw.length === 32) {
                    const algosdk = (await import('algosdk')).default
                    creator = algosdk.encodeAddress(raw)
                  } else if (typeof raw === 'string' && raw) {
                    try {
                      const bin = atob(raw)
                      const arr = new Uint8Array(bin.length)
                      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
                      const algosdk = (await import('algosdk')).default
                      creator = algosdk.encodeAddress(arr)
                    } catch {}
                  }
                }
              }
              if (!asaId) return
              const holding = rawAssets.find(a => Number(a['asset-id'] ?? a.assetId) === asaId)
              if (holding) asaResults.push({ asaId, appId, meta, balance: Number(holding.amount ?? 0), closeTo: creator })
            } catch {}
          })
        )
        // Deduplicate by ASA ID — multiple campaigns may use the same token
        const seen = new Set()
        const dedupedAsas = asaResults.filter(a => {
          if (seen.has(a.asaId)) return false
          seen.add(a.asaId)
          return true
        })
        setAsaEntries(dedupedAsas)
      } else {
        setAsaEntries([])
      }
    } catch (e) {
      console.error(e)
      addToast('Failed to load wallet state', 'error')
    } finally { setLoading(false) }
  }, [activeAddress])

  useEffect(() => { loadEntries() }, [loadEntries])

  async function handleClearApp(appId, contrib, force = false) {
    if (contrib > 0 && !force) {
      addToast('Use "Force clear" to opt out and forfeit your pending contribution.', 'error', 6000)
      return
    }
    if (contrib > 0 && force) {
      const confirmed = window.confirm(
        `⚠️ You have ${(contrib / 1_000_000).toFixed(6)} ALGO pending in app ${appId}.\n\nForce clearing will permanently forfeit this amount. It cannot be recovered.\n\nProceed?`
      )
      if (!confirmed) return
    }
    setActioningId(`app-${appId}`)
    try {
      await signAndSend(signTransactions, [(await buildClearStateTxn({ sender: activeAddress, appId })).toByte()])
      addToast(`App local state cleared. ~0.1 ALGO reclaimed.${contrib > 0 ? ` Note: ${(contrib / 1_000_000).toFixed(6)} ALGO contribution was forfeited.` : ''}`, contrib > 0 ? 'info' : 'success')
      setAppEntries(prev => prev.filter(e => e.appId !== appId))
    } catch (e) { addToast(e?.message || 'Clear state failed', 'error') }
    finally { setActioningId(null) }
  }

  async function handleCloseAsa(asaId, closeTo) {
    setActioningId(`asa-${asaId}`)
    try {
      const recipient = closeTo || activeAddress
      await signAndSend(signTransactions, [(await buildAsaCloseTxn({ sender: activeAddress, asaId, closeTo: recipient })).toByte()])
      addToast('Asset holding closed. ~0.1 ALGO reclaimed.', 'success')
      setAsaEntries(prev => prev.filter(e => e.asaId !== asaId))
    } catch (e) { addToast(e?.message || 'Asset close failed', 'error') }
    finally { setActioningId(null) }
  }

  const totalReclaimable = (appEntries.length + asaEntries.length) * 0.1

  if (!activeAddress) {
    return (
      <div className="wrap rise">
        <div className="empty-state" style={{ paddingTop: 100 }}>
          <Icon.spark style={{ width: 48, height: 48, color: 'var(--accent)' }} />
          <h3>Connect your wallet</h3>
          <p>Connect to see your reservations and reclaim minimum balance.</p>
        </div>
      </div>
    )
  }

  const allClear = !loading && appEntries.length === 0 && asaEntries.length === 0

  return (
    <div className="wrap rise">
      {/* Page head */}
      <div className="page-head" style={{ alignItems: 'flex-start' }}>
        <div>
          <span className="eyebrow">Maintenance</span>
          <h1 style={{ marginTop: 10 }}>Wallet Cleanup</h1>
          <p style={{ maxWidth: 540 }}>
            Each app opt-in and ASA holding locks 0.1 ALGO as a minimum-balance reservation.
            Release the ones you no longer need to reclaim that ALGO.
          </p>
        </div>
        <button className="btn btn-ghost" onClick={loadEntries} disabled={loading}>
          <Icon.refund style={{ width: 16, height: 16 }} /> Refresh
        </button>
      </div>

      {/* ClearState warning */}
      <div className="card" style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger)', borderRadius: 'var(--r-md)', padding: '14px 18px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <Icon.shield style={{ width: 18, height: 18, color: 'var(--danger)', flexShrink: 0, marginTop: 2 }} />
        <div style={{ fontSize: 13.5, lineHeight: 1.55 }}>
          <strong style={{ color: 'var(--danger)' }}>Important — do not use "Remove app" while you have a pending contribution.</strong>
          {' '}Algorand's ClearState operation bypasses the contract's approval program and always succeeds.
          If you clear an app opt-in while your contribution ({'>'}0) is still recorded, that ALGO is
          permanently forfeited — it cannot be refunded. Only clear an app after you have received
          your tokens or your refund has been processed. Apps with a pending contribution show a
          "Pending refund" badge and have the clear button disabled.
        </div>
      </div>

      {/* Summary bar */}
      <div className="card cleanup-summary">
        <div className="csum">
          <span className="csum-l">Wallet</span>
          <span className="csum-v mono" style={{ fontSize: 14 }}>{shortAddr(activeAddress)}</span>
        </div>
        <div className="csum">
          <span className="csum-l">App opt-ins</span>
          <span className="csum-v">{loading ? '…' : appEntries.length}</span>
        </div>
        <div className="csum">
          <span className="csum-l">Token holdings</span>
          <span className="csum-v">{loading ? '…' : asaEntries.length}</span>
        </div>
        <div className="csum">
          <span className="csum-l">Total reclaimable</span>
          <span className="csum-v" style={{ color: 'var(--accent)' }}>
            ~{loading ? '…' : totalReclaimable.toFixed(1)} ALGO
          </span>
        </div>
      </div>

      {loading ? (
        <div className="empty-state" style={{ paddingTop: 60 }}>
          <div className="sk-pulse" style={{ width: 48, height: 48, borderRadius: '50%' }} />
          <p>Scanning wallet…</p>
        </div>
      ) : allClear ? (
        <div className="empty-state" style={{ paddingTop: 60 }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--success-soft)', color: 'var(--success)', display: 'grid', placeItems: 'center' }}>
            <Icon.check style={{ width: 28, height: 28 }} />
          </div>
          <h3>All clear</h3>
          <p>No reservations found for Sprout projects. Your minimum balance is fully optimised.</p>
        </div>
      ) : (
        <>
          {/* App opt-ins */}
          {appEntries.length > 0 && (
            <div className="cleanup-section">
              <div className="cleanup-head">
                <h3>App opt-ins</h3>
                <span className="faint">0.1 ALGO each</span>
              </div>
              <div className="card">
                {appEntries.map(({ appId, meta, contrib, ghost }) => (
                  <div className="clean-row" key={`app-${appId}`}>
                    <div>
                      <div className="clean-name">{meta?.name || `App #${appId}`}</div>
                      <div className="mp-meta" style={{ marginTop: 6 }}>
                        <IdTag label="App" value={String(appId)} />
                        {ghost
                          ? <span className="badge" style={{ padding: '2px 9px', fontSize: 11, background: 'var(--surface-2)', color: 'var(--text-muted)' }}>Contract deleted — safe to clear</span>
                          : contrib > 0
                            ? <span className="badge badge-warn" style={{ padding: '2px 9px', fontSize: 11 }}>⚠ Pending refund — do not clear</span>
                            : <span className="badge" style={{ padding: '2px 9px', fontSize: 11 }}>Ready to clear</span>
                        }
                      </div>
                      {!ghost && contrib > 0 && (
                        <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 6 }}>
                          You have {(contrib / 1_000_000).toLocaleString(undefined, { minimumFractionDigits: 6 })} ALGO pending.
                          Clearing now would forfeit it permanently.
                        </div>
                      )}
                    </div>
                    <div className="clean-amt">
                      <span className="clean-amt-v">−0.1 ALGO</span>
                      <span className="faint" style={{ fontSize: 11 }}>reclaimable</span>
                    </div>
                    {ghost
                      ? (
                        <button
                          className="btn btn-soft btn-sm"
                          disabled={actioningId === `app-${appId}`}
                          onClick={() => handleClearApp(appId, 0)}
                        >
                          {actioningId === `app-${appId}` ? 'Clearing…' : 'Clear & reclaim'}
                        </button>
                      )
                      : contrib > 0
                        ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                            <button className="btn btn-ghost btn-sm" disabled>Pending refund</button>
                            <button
                              className="btn btn-sm"
                              style={{ background: 'var(--danger-soft)', color: 'var(--danger)', border: 'none', fontSize: 12 }}
                              disabled={actioningId === `app-${appId}`}
                              onClick={() => handleClearApp(appId, contrib, true)}
                            >
                              {actioningId === `app-${appId}` ? 'Clearing…' : 'Force clear (forfeit)'}
                            </button>
                          </div>
                        )
                        : (
                          <button
                            className="btn btn-soft btn-sm"
                            disabled={actioningId === `app-${appId}`}
                            onClick={() => handleClearApp(appId, contrib)}
                          >
                            {actioningId === `app-${appId}` ? 'Clearing…' : 'Clear & reclaim'}
                          </button>
                        )
                    }
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Token holdings */}
          {asaEntries.length > 0 && (
            <div className="cleanup-section">
              <div className="cleanup-head">
                <h3>Token holdings</h3>
                <span className="faint">closes the ASA and returns any balance to the creator</span>
              </div>
              <div className="card">
                {asaEntries.map(({ asaId, appId, meta, balance, closeTo }) => (
                  <div className="clean-row" key={`asa-${asaId}`}>
                    <div>
                      <div className="clean-name">{meta?.token_name || meta?.name || `Project #${appId}`}</div>
                      <div className="mp-meta" style={{ marginTop: 6 }}>
                        <IdTag label="ASA" value={String(asaId)} />
                        {balance > 0 && (
                          <span className="faint">Balance {balance.toLocaleString()} — returned to creator</span>
                        )}
                      </div>
                    </div>
                    <div className="clean-amt">
                      <span className="clean-amt-v">−0.1 ALGO</span>
                      <span className="faint" style={{ fontSize: 11 }}>reclaimable</span>
                    </div>
                    <button
                      className="btn btn-soft btn-sm"
                      disabled={actioningId === `asa-${asaId}`}
                      onClick={() => handleCloseAsa(asaId, closeTo)}
                    >
                      {actioningId === `asa-${asaId}` ? 'Closing…' : 'Close & reclaim'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <div className="sum-note" style={{ maxWidth: '100%', marginTop: 8 }}>
        App ClearState bypasses the approval program and always succeeds — never use it while you have a pending contribution or you will permanently forfeit that ALGO.
        Token close-outs send any remaining balance to the project creator and release the 0.1 ALGO reservation.
        Only Sprout project tokens are shown here.
      </div>
      <div style={{ height: 64 }} />
    </div>
  )
}
