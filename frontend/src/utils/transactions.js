import algosdk from 'algosdk'
import { algodClient } from './algorand'

/** Suggested params with flat fee */
async function getSp(fee = 1000) {
  const sp = await algodClient.getTransactionParams().do()
  return { ...sp, flatFee: true, fee }
}

/**
 * Deploy a new crowdfunding application as a grouped transaction pair:
 * [0] ApplicationCreate
 * [1] Payment of listing fee from creator to admin (goal × days / 10,000)
 *
 * numGlobalInts = 10:
 *   goal, rate, deadline, days, asa_id, raised,
 *   funded_round, cancelled, creator_claimed, admin_claimed
 * numGlobalByteSlices = 2: creator, admin
 *
 * The contract computes deadline internally from days × ROUNDS_PER_DAY.
 * Minimum goal: 10 ALGO (10_000_000 microAlgos) — enforced in the contract.
 * Success fee is taken as the remainder swept to admin at grace close.
 */
export async function buildCreateAppTxnGroup({
  sender,
  approvalProgram,
  clearProgram,
  adminAddress,
  goalMicroAlgos,
  rateAsaPerAlgo,
  durationDays,
}) {
  const sp         = await getSp()
  const adminBytes = algosdk.decodeAddress(adminAddress).publicKey
  const days       = Number(durationDays)

  // Listing fee: 0.01% of goal per day = goal × days / 10,000
  const rawListingFee = Math.floor((goalMicroAlgos * days) / 10_000)
  // Donation campaigns (rate == 0) have a minimum listing fee of 10 ALGO
  const MIN_DONATION_FEE = 10_000_000
  const listingFee = rateAsaPerAlgo === 0
    ? Math.max(rawListingFee, MIN_DONATION_FEE)
    : rawListingFee

  const appCreateTxn = algosdk.makeApplicationCreateTxnFromObject({
    sender,
    suggestedParams: sp,
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    approvalProgram,
    clearProgram,
    numLocalInts: 1,
    numLocalByteSlices: 0,
    numGlobalInts: 10,
    numGlobalByteSlices: 2,
    appArgs: [
      adminBytes,
      algosdk.encodeUint64(BigInt(goalMicroAlgos)),
      algosdk.encodeUint64(BigInt(rateAsaPerAlgo)),
      algosdk.encodeUint64(BigInt(days)),
    ],
  })

  const listingFeeTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender,
    receiver: adminAddress,
    amount:   listingFee,
    suggestedParams: sp,
  })

  algosdk.assignGroupID([appCreateTxn, listingFeeTxn])
  return { txns: [appCreateTxn, listingFeeTxn], listingFee }
}

/**
 * Setup group (2 txns):
 * [0] AppCall "setup" + foreignAssets
 * [1] AssetTransfer (token pool from creator to app)
 *
 * setup is gated: before deadline AND before any contribution (raised == 0).
 * Before calling setup the creator must fund the app account with enough
 * ALGO for minimum balance (a separate payment transaction).
 * Fee: 2000 covers the inner ASA opt-in (fee:0 → caller-pooled).
 */
export async function buildSetupGroup({ sender, appId, asaId, goalMicroAlgos, rateAsaPerAlgo, appAddress }) {
  const sp      = await getSp()
  const spInner = { ...sp, fee: 2000 }  // covers inner ASA opt-in

  const tokensRequired = Math.floor((goalMicroAlgos * rateAsaPerAlgo) / 1_000_000)

  const appCallTxn = algosdk.makeApplicationNoOpTxnFromObject({
    sender,
    suggestedParams: spInner,
    appIndex: Number(appId),
    appArgs: [new TextEncoder().encode('setup')],
    foreignAssets: [Number(asaId)],
    accounts: [sender],
  })

  const asaTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender,
    receiver: appAddress,
    assetIndex: Number(asaId),
    amount: tokensRequired,
    suggestedParams: sp,
  })

  algosdk.assignGroupID([appCallTxn, asaTxn])
  return [appCallTxn, asaTxn]
}

/** Opt-in transaction (investor opts into the app) */
export async function buildOptInTxn({ sender, appId }) {
  const sp = await getSp()
  return algosdk.makeApplicationOptInTxnFromObject({
    sender,
    suggestedParams: sp,
    appIndex: Number(appId),
  })
}

/**
 * Contribute group (2 txns):
 * [0] AppCall "contribute"
 * [1] Payment (whole-ALGO amount)
 */
export async function buildContributeGroup({ sender, appId, appAddress, amountMicroAlgos }) {
  const sp = await getSp()

  const appCallTxn = algosdk.makeApplicationNoOpTxnFromObject({
    sender,
    suggestedParams: sp,
    appIndex: Number(appId),
    appArgs: [new TextEncoder().encode('contribute')],
  })

  const payTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender,
    receiver: appAddress,
    amount: amountMicroAlgos,
    suggestedParams: sp,
  })

  algosdk.assignGroupID([appCallTxn, payTxn])
  return [appCallTxn, payTxn]
}

/**
 * Finalize (pull model): the calling investor claims their own tokens.
 * LONE TRANSACTION — group_size == 1 enforced by the contract.
 * Fee: 2000 covers 1 inner ASA transfer (fee:0 → caller-pooled).
 * REQUIREMENT: investor must be opted into asa_id before calling.
 */
export async function buildFinalizeTxn({ sender, appId, asaId }) {
  const sp = await getSp(2000)
  return algosdk.makeApplicationNoOpTxnFromObject({
    sender,
    suggestedParams: sp,
    appIndex: Number(appId),
    appArgs: [new TextEncoder().encode('finalize')],
    foreignAssets: [Number(asaId)],
  })
}

/**
 * Creator claim: creator withdraws (goal - 4%) ALGO.
 * LONE TRANSACTION — group_size == 1 enforced by the contract.
 * Callable immediately once funded_round > 0.
 * Fee: 2000 covers 1 inner Payment (fee:0 → caller-pooled).
 */
export async function buildCreatorClaimTxn({ sender, appId }) {
  const sp = await getSp(2000)
  return algosdk.makeApplicationNoOpTxnFromObject({
    sender,
    suggestedParams: sp,
    appIndex: Number(appId),
    appArgs: [new TextEncoder().encode('creator_claim')],
    accounts: [sender],
  })
}

/**
 * Refund (pull model): investor reclaims their own ALGO on failure/cancel.
 * LONE TRANSACTION — group_size == 1 enforced by the contract.
 * Keyed on failed predicate (funded_round == 0 AND (cancelled OR after_deadline)).
 * Fee: 2000 covers 1 inner Payment (fee:0 → caller-pooled).
 */
export async function buildRefundTxn({ sender, appId }) {
  const sp = await getSp(2000)
  return algosdk.makeApplicationNoOpTxnFromObject({
    sender,
    suggestedParams: sp,
    appIndex: Number(appId),
    appArgs: [new TextEncoder().encode('refund')],
    accounts: [sender],
  })
}

/**
 * Creator reclaim ASA: creator closes the entire project-token holding back
 * to themselves on failure/cancel. Immediate — no grace wait.
 * LONE TRANSACTION — group_size == 1 enforced by the contract.
 * Fee: 2000 covers 1 inner ASA close (fee:0 → caller-pooled).
 * REQUIREMENT: creator must be opted into asa_id.
 * After this call asa_id == 0, satisfying admin_claim's precondition.
 */
export async function buildCreatorReclaimAsaTxn({ sender, appId, asaId }) {
  const sp = await getSp(2000)
  return algosdk.makeApplicationNoOpTxnFromObject({
    sender,
    suggestedParams: sp,
    appIndex: Number(appId),
    appArgs: [new TextEncoder().encode('creator_reclaim_asa')],
    foreignAssets: [Number(asaId)],
  })
}

/**
 * Admin sweep ASA: closes the app's entire ASA holding to the admin after
 * grace period expiry. Decoupled from the ALGO close so a missing opt-in
 * cannot trap the ALGO. LONE TRANSACTION.
 *
 * Success case: sweeps tokens of investors who never finalized.
 * Failure case: fallback if creator never called creator_reclaim_asa.
 *
 * REQUIREMENT: admin must be opted into asa_id before calling.
 * Fee: 2000 covers 1 inner ASA close (fee:0 → caller-pooled).
 * After this call asa_id == 0, satisfying admin_claim's precondition.
 */
export async function buildAdminSweepAsaTxn({ sender, appId, asaId }) {
  const sp = await getSp(2000)
  return algosdk.makeApplicationNoOpTxnFromObject({
    sender,
    suggestedParams: sp,
    appIndex: Number(appId),
    appArgs: [new TextEncoder().encode('admin_sweep_asa')],
    foreignAssets: [Number(asaId)],
  })
}

/**
 * Admin claim: GRACE-ONLY ALGO close. Requires asa_id == 0 (run
 * admin_sweep_asa or creator_reclaim_asa first). LONE TRANSACTION.
 *
 * Success path: closes all remaining ALGO (4% fee + any unclaimed creator
 *   payout) to the admin. Fires after success_grace_expired.
 * Failure path: closes residual ALGO to the creator. Fires after
 *   failure_grace_expired (measured from deadline, not funded_round).
 *
 * Fee: 2000 covers 1 inner Payment (fee:0 → caller-pooled).
 */
export async function buildAdminClaimTxn({ sender, appId, creatorAddress }) {
  const sp = await getSp(2000)
  return algosdk.makeApplicationNoOpTxnFromObject({
    sender,
    suggestedParams: sp,
    appIndex: Number(appId),
    appArgs: [new TextEncoder().encode('admin_claim')],
    accounts: creatorAddress ? [creatorAddress] : undefined,
  })
}

/**
 * Admin cancel: sets cancelled=1, unlocking the refund path.
 * LONE TRANSACTION. Gated on funded_round == 0 — cannot cancel a
 * campaign that already succeeded.
 */
export async function buildAdminCancelTxn({ sender, appId }) {
  const sp = await getSp()
  return algosdk.makeApplicationNoOpTxnFromObject({
    sender,
    suggestedParams: sp,
    appIndex: Number(appId),
    appArgs: [new TextEncoder().encode('admin_cancel')],
  })
}

/**
 * Compile TEAL source string via algod REST endpoint.
 * Returns compiled bytes as Uint8Array.
 */
export async function compileTeal(source) {
  const compiled = await algodClient.compile(new TextEncoder().encode(source)).do()
  const b64 = compiled.result ?? compiled.bytes
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0))
}

/**
 * Close out an ASA holding entirely, sending the full balance to closeTo.
 */
export async function buildAsaCloseTxn({ sender, asaId, closeTo }) {
  const sp = await getSp()
  return algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender,
    receiver: closeTo,
    assetIndex: Number(asaId),
    amount: 0,
    closeRemainderTo: closeTo,
    suggestedParams: sp,
  })
}

/**
 * Opt into an ASA (required before an account can receive a given token).
 */
export async function buildAsaOptInTxn({ sender, asaId }) {
  const sp = await getSp()
  return algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender,
    receiver: sender,
    assetIndex: Number(asaId),
    amount: 0,
    suggestedParams: sp,
  })
}

/**
 * ClearState: opts the sender out unconditionally.
 * WARNING: if contrib > 0, using this permanently forfeits the contribution.
 */
export async function buildClearStateTxn({ sender, appId }) {
  const sp = await getSp()
  return algosdk.makeApplicationClearStateTxnFromObject({
    sender,
    suggestedParams: sp,
    appIndex: Number(appId),
  })
}

/**
 * Create a new Algorand Standard Asset (ASA).
 * Used by the "Create token" tab in the setup modal.
 */
export async function buildAsaCreateTxn({
  sender, assetName, unitName, total, decimals,
}) {
  const sp = await getSp()
  return algosdk.makeAssetCreateTxnWithSuggestedParamsFromObject({
    sender,
    suggestedParams: { ...sp, flatFee: true, fee: 1000 },
    defaultFrozen: false,
    unitName:      String(unitName).slice(0, 8).toUpperCase(),
    assetName:     String(assetName).slice(0, 32),
    total:         BigInt(total),
    decimals:      Number(decimals),
    assetURL:      '',
    manager:       sender,
    reserve:       sender,
    freeze:        undefined,
    clawback:      undefined,
  })
}

/**
 * Delete the application (admin only, when admin_claimed == 1).
 */
export async function buildDeleteAppTxn({ sender, appId }) {
  const sp = await getSp()
  return algosdk.makeApplicationDeleteTxnFromObject({
    sender,
    suggestedParams: sp,
    appIndex: Number(appId),
  })
}

/**
 * Encode an array of unsigned Transaction objects into the
 * Uint8Array[] format expected by use-wallet's signTransactions().
 */
export function encodeUnsignedTxns(txns) {
  return txns.map(t => t.toByte())
}
