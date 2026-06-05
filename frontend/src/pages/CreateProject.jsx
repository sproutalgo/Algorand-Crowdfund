import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWallet } from '@txnlab/use-wallet-react'
import { algodClient, algoToMicro, ADMIN_ADDRESS, signAndSend } from '../utils/algorand'
import { buildCreateAppTxnGroup, compileTeal } from '../utils/transactions'
import { registerProject } from '../utils/api'
import { useToast } from '../context/ToastContext'
import { Icon } from '../components/UI'

import APPROVAL_TEAL from '../../../contracts/approval.teal?raw'
import CLEAR_TEAL    from '../../../contracts/clear.teal?raw'

const ALLOWED_WEBSITE_DOMAINS = ['x.com', 'twitter.com', 'github.com', 'linkedin.com']

function validateWebsiteUrl(url) {
  if (!url) return null  // optional field
  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return 'URL must start with https://'
    }
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
    if (!ALLOWED_WEBSITE_DOMAINS.includes(host)) {
      return `Only links from ${ALLOWED_WEBSITE_DOMAINS.join(', ')} are accepted`
    }
    return null
  } catch {
    return 'Please enter a valid URL (e.g. https://x.com/yourproject)'
  }
}

const CATEGORIES = ['DeFi', 'RWA', 'AI', 'NFT', 'Gaming', 'Infrastructure', 'Social', 'Other']

const MIN_GOAL_ALGO = 10        // contract enforces >= 10_000_000 microAlgos
const MAX_GOAL_ALGO  = 100_000_000
const ROUNDS_PER_DAY  = 86400 / 3.3  // ~26057 rounds per day (mainnet)  // contract enforces <= 100_000_000_000_000 microAlgos
const MIN_DAYS        = 1
const MAX_DAYS        = 100
const SUCCESS_FEE_PCT = 4             // 4% success fee

export default function CreateProject() {
  const navigate    = useNavigate()
  const { activeAddress, signTransactions } = useWallet()
  const { addToast } = useToast()
  const [step, setStep]             = useState(1)
  const [submitting, setSubmitting] = useState(false)

  const [form, setForm] = useState({
    name: '', tagline: '', description: '', category: 'DeFi',
    highlights: ['', '', ''], websiteUrl: '',
    goalAlgo: '', ratePerAlgo: '', durationDays: '',
  })

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target ? e.target.value : e }))
  const setHi = (i) => (e) => { const h = [...form.highlights]; h[i] = e.target.value; setForm(f => ({ ...f, highlights: h })) }
  const onlyInt = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value.replace(/[^0-9]/g, '') }))

  const goal        = Number(form.goalAlgo)    || 0
  const rate        = Number(form.ratePerAlgo) || 0
  const durDays     = Number(form.durationDays) || 0
  const durRounds   = Math.round(durDays * ROUNDS_PER_DAY)
  // Listing fee: 0.01% of goal per day
  const listingFeeAlgo  = goal && durDays ? ((goal * durDays) / 10_000).toFixed(3) : null
  const successFeeAlgo  = goal ? (goal * SUCCESS_FEE_PCT / 100).toFixed(2) : null
  const tokensNeeded    = goal && rate ? (goal * rate).toLocaleString() : null

  const durError = durDays > 0 && (durDays < MIN_DAYS || durDays > MAX_DAYS)
    ? `Duration must be between ${MIN_DAYS} and ${MAX_DAYS} days`
    : null

  const websiteError = validateWebsiteUrl(form.websiteUrl)

  const checklist = [
    { ok: !!activeAddress,                          label: 'Wallet connected'  },
    { ok: !!form.name.trim(),                       label: 'Project name'      },
    { ok: !!form.tagline.trim(),                    label: 'Tagline'           },
    { ok: goal >= MIN_GOAL_ALGO && goal <= MAX_GOAL_ALGO, label: `Funding goal (${MIN_GOAL_ALGO}–${MAX_GOAL_ALGO.toLocaleString()} ALGO)` },
    { ok: rate > 0,                                 label: 'Token rate set'    },
    { ok: durDays >= MIN_DAYS && durDays <= MAX_DAYS, label: `Duration (${MIN_DAYS}–${MAX_DAYS} days)` },
    { ok: !websiteError,                            label: 'Website URL valid (or blank)' },
  ]
  const allOk = checklist.every(c => c.ok)

  async function handleDeploy() {
    if (!activeAddress) return addToast('Connect your wallet first', 'info')
    if (!allOk) return addToast('Complete all required fields first', 'error')
    if (durError) return addToast(durError, 'error')
    if (!ADMIN_ADDRESS) return addToast('Set VITE_ADMIN_ADDRESS in your .env', 'error')
    setSubmitting(true)
    addToast('Compiling and deploying contract…', 'info', 0)
    try {
      const approvalProgram = await compileTeal(APPROVAL_TEAL)
      const clearProgram    = await compileTeal(CLEAR_TEAL)
      const goalMicro       = algoToMicro(goal)

      const { txns, listingFee } = await buildCreateAppTxnGroup({
        sender: activeAddress, approvalProgram, clearProgram,
        adminAddress: ADMIN_ADDRESS, goalMicroAlgos: goalMicro,
        rateAsaPerAlgo: rate, durationDays: durDays,
      })

      addToast(`Listing fee: ${(listingFee / 1_000_000).toFixed(3)} ALGO — approve both transactions.`, 'info', 6000)
      const confirmation = await signAndSend(signTransactions, txns.map(t => t.toByte()))
      const newAppId = Number(confirmation['application-index'] ?? confirmation.applicationIndex ?? 0)

      await registerProject({
        address: activeAddress, appId: newAppId,
        meta: {
          name: form.name, tagline: form.tagline, description: form.description,
          category: form.category, websiteUrl: form.websiteUrl,
          tokenName: '', goalMicro, ratePerAlgo: rate,
        },
      })
      addToast(`Deployed! App ID: ${newAppId}`, 'success')
      addToast('Go to My Projects → Set up contract to fund the token pool.', 'info', 8000)
      navigate('/my-projects')
    } catch (e) {
      console.error(e)
      const msg = e?.message || ''
      if (msg.includes('overspend') || msg.includes('below min') || msg.includes('underflow')) {
        addToast('Insufficient funds to cover the listing fee. Make sure your wallet has enough ALGO to pay the listing fee plus transaction fees and minimum balance requirements.', 'error', 8000)
      } else {
        addToast(msg || 'Deployment failed', 'error')
      }
    } finally { setSubmitting(false) }
  }

  const steps = [
    { n: 1, label: 'Project info' },
    { n: 2, label: 'Contract terms' },
    { n: 3, label: 'Review & deploy' },
  ]

  return (
    <div className="wrap rise">
      {/* Head */}
      <div className="launch-head">
        <span className="eyebrow">Create</span>
        <h1 style={{ marginTop: 12 }}>Launch your project</h1>
        <p>Deploy a permissionless crowdfunding contract to Algorand Testnet. Takes about two minutes.</p>
      </div>

      {/* Stepper */}
      <div className="stepper">
        {steps.map((s, i) => (
          <React.Fragment key={s.n}>
            <div className={`step${step === s.n ? ' active' : ''}${step > s.n ? ' done' : ''}`}>
              <span className="step-dot">
                {step > s.n ? <Icon.check style={{ width: 15, height: 15 }} /> : s.n}
              </span>
              <span className="step-label">{s.label}</span>
            </div>
            {i < steps.length - 1 && <span className={`step-line${step > s.n ? ' done' : ''}`} />}
          </React.Fragment>
        ))}
      </div>

      <div className="launch-grid">
        {/* Form */}
        <div>
          {step === 1 && (
            <div className="card form-card rise">
              <div className="form-card-head">
                <span className="num">01</span>
                <div>
                  <h3>Project info</h3>
                  <p>This is what backers see on your campaign page.</p>
                </div>
              </div>
              <div className="form-stack">
                <div className="form-grid">
                  <div className="field span-2">
                    <label>Project name *</label>
                    <input className="input" placeholder="e.g. AlgoSwap Protocol" value={form.name} onChange={set('name')} />
                  </div>
                  <div className="field span-2">
                    <label>Tagline *</label>
                    <input className="input" placeholder="One sentence that captures your project" value={form.tagline} onChange={set('tagline')} />
                  </div>
                  <div className="field">
                    <label>Category</label>
                    <select className="input" value={form.category} onChange={set('category')}>
                      {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="field span-2">
                    <label>Full description</label>
                    <textarea className="textarea" placeholder="Describe your project, goals, use of funds, and team background…" value={form.description} onChange={set('description')} />
                  </div>
                  <div className="field span-2">
                    <label>Why back it · highlights</label>
                    <div className="hi-list">
                      {form.highlights.map((h, i) => (
                        <div className="hi-row" key={i}>
                          <span className="hi-bullet"><Icon.check /></span>
                          <input className="input" placeholder={['e.g. Audited by two independent firms', 'e.g. Live on testnet with 1,400+ wallets', 'e.g. Backed by the Algorand Foundation'][i]} value={h} onChange={setHi(i)} />
                        </div>
                      ))}
                    </div>
                    <span className="field-hint">Three scannable reasons shown to backers. Keep each short.</span>
                  </div>
                  <div className="field span-2">
                    <label>Website (optional)</label>
                    <input
                      className={`input${websiteError && form.websiteUrl ? ' input-error' : ''}`}
                      placeholder="https://x.com/yourproject"
                      value={form.websiteUrl}
                      onChange={set('websiteUrl')}
                    />
                    {websiteError && form.websiteUrl
                      ? <span className="field-hint" style={{ color: 'var(--danger)' }}>{websiteError}</span>
                      : <span className="field-hint">Accepted: x.com, twitter.com, github.com, linkedin.com</span>
                    }
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="card form-card rise">
              <div className="form-card-head">
                <span className="num">02</span>
                <div>
                  <h3>Contract terms</h3>
                  <p>Stored immutably on-chain at deployment.</p>
                </div>
              </div>
              <div className="form-grid">
                <div className="field">
                  <label>Funding goal (ALGO) *</label>
                  <input className="input no-spin" type="text" inputMode="numeric" placeholder="10000" value={form.goalAlgo} onChange={onlyInt('goalAlgo')} />
                  {goal > 0 && goal < MIN_GOAL_ALGO && (
                    <span className="field-hint" style={{ color: 'var(--danger)' }}>Minimum goal is {MIN_GOAL_ALGO} ALGO.</span>
                  )}
                  {goal > MAX_GOAL_ALGO && (
                    <span className="field-hint" style={{ color: 'var(--danger)' }}>Maximum goal is {MAX_GOAL_ALGO.toLocaleString()} ALGO.</span>
                  )}
                  {(!goal || (goal >= MIN_GOAL_ALGO && goal <= MAX_GOAL_ALGO)) && (
                    <span className="field-hint">Must be a whole number of ALGO, {MIN_GOAL_ALGO}–{MAX_GOAL_ALGO.toLocaleString()} ALGO.</span>
                  )}
                  <span className="field-hint">Whole ALGO only. The amount you need to raise to succeed.</span>
                </div>
                <div className="field">
                  <label>Token rate (per ALGO) *</label>
                  <input className="input no-spin" type="text" inputMode="numeric" placeholder="1000" value={form.ratePerAlgo} onChange={onlyInt('ratePerAlgo')} />
                  <span className="field-hint">Whole tokens only. How many tokens each ALGO contribution buys.</span>
                </div>
                <div className="field span-2">
                  <label>Campaign duration (days) *</label>
                  <input
                    className={`input no-spin${durError ? ' input-error' : ''}`}
                    type="text"
                    inputMode="numeric"
                    placeholder={`e.g. 30`}
                    value={form.durationDays}
                    onChange={onlyInt('durationDays')}
                  />
                  {durError
                    ? <span className="field-hint" style={{ color: 'var(--danger)' }}>{durError}</span>
                    : <span className="field-hint">
                        Minimum {MIN_DAYS} day, maximum {MAX_DAYS} days.
                        {durDays >= MIN_DAYS && durDays <= MAX_DAYS
                          ? ` Listing fee: ${listingFeeAlgo} ALGO (0.01% × ${durDays} days).`
                          : ''}
                      </span>
                  }
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="card form-card rise">
              {!allOk ? (
                <>
                  <div className="form-card-head">
                    <span className="num">03</span>
                    <div><h3>Almost ready</h3><p>Complete the required fields before deploying.</p></div>
                  </div>
                  <div className="checklist">
                    {checklist.map((c, i) => (
                      <div className={`check-item${c.ok ? ' ok' : ''}`} key={i}>
                        <span className="check-box">{c.ok && <Icon.check />}</span>
                        {c.label}
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="deploy-done">
                  <div className="ring"><Icon.bolt /></div>
                  <h3 style={{ fontSize: 26 }}>Ready to deploy</h3>
                  <p className="muted" style={{ marginTop: 12, maxWidth: 420, marginInline: 'auto', lineHeight: 1.6 }}>
                    <b style={{ color: 'var(--text)' }}>{form.name}</b> will raise {goal.toLocaleString()} ALGO over {durDays} days at {rate} tokens per ALGO. Listing fee: {listingFeeAlgo} ALGO paid at deploy. Success fee: {successFeeAlgo} ALGO (4%) if funded.
                  </p>
                  <button
                    className="btn btn-primary btn-lg"
                    style={{ marginTop: 24 }}
                    onClick={handleDeploy}
                    disabled={submitting}
                  >
                    <Icon.bolt style={{ width: 18, height: 18 }} />
                    {submitting ? 'Deploying…' : 'Deploy crowdfund contract'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Nav buttons */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20 }}>
            <button className="btn btn-ghost" disabled={step === 1} style={{ opacity: step === 1 ? 0.4 : 1 }} onClick={() => setStep(s => Math.max(1, s - 1))}>
              Back
            </button>
            {step < 3 && (
              <button className="btn btn-primary" onClick={() => setStep(s => Math.min(3, s + 1))}>
                Continue <Icon.arrow style={{ width: 17, height: 17 }} />
              </button>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <aside>
          <div className="card summary-card">
            <h4>Deployment summary</h4>
            {[
              { l: 'Funding goal',      v: goal ? `${goal.toLocaleString()} ALGO` : '—' },
              { l: 'Token rate',        v: rate ? `${rate} tokens / ALGO` : '—' },
              { l: 'Duration',          v: durDays >= MIN_DAYS && durDays <= MAX_DAYS ? `${durDays} days` : '—' },
              { l: 'Listing fee',       v: listingFeeAlgo ? `${listingFeeAlgo} ALGO` : '—' },
              { l: 'Success fee (4%)',  v: successFeeAlgo ? `${successFeeAlgo} ALGO` : '—' },
              { l: 'Tokens to provide', v: tokensNeeded || '—' },
            ].map(({ l, v }) => (
              <div className="sum-row" key={l}>
                <span className="s-lbl">{l}</span>
                <span className="s-val">{v}</span>
              </div>
            ))}
            <div className="sum-note">
              Listing fee is paid upfront and non-refundable. A 4% success fee is deducted from your payout if the campaign is funded. Contract terms are stored immutably on-chain.
            </div>
          </div>

          <div className="card summary-card" style={{ position: 'static', marginTop: 20 }}>
            <h4>Pre-flight checklist</h4>
            <div className="checklist">
              {checklist.map((c, i) => (
                <div className={`check-item${c.ok ? ' ok' : ''}`} key={i}>
                  <span className="check-box">{c.ok && <Icon.check />}</span>
                  {c.label}
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
