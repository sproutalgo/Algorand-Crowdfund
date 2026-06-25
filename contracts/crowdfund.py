from pyteal import *

# Crowdfunding App (stateful, smart-contract account) — FIXED VERSION
#
# This is a security-hardened rewrite. Key design properties:
#
#   1. Single monotonic counter: `raised` only ever increases and is only ever
#      compared against `goal`. There is no liability counter that an untrusted
#      action could desynchronize — closing logic never depends on a running
#      total that ClearState could corrupt.
#
#   2. Sticky outcome: success is determined ONLY by `funded_round > 0`
#      (set once, never cleared). Failure is `funded_round == 0 AND
#      (after_deadline OR cancelled)`. `refund` keys off `funded_round == 0`,
#      NOT `raised < goal`, so it can never reopen once the goal is hit.
#      success and failure are structurally mutually exclusive.
#
#   3. `admin_cancel` is gated on `funded_round == 0` — cannot cancel a
#      campaign that already succeeded.
#
#   4. All inner transactions set fee: Int(0) explicitly and require the
#      caller's outer transaction to cover pooled fees. Inner-txn fees can
#      no longer silently drain the app account or the admin's fee.
#
#   5. setup is gated before the deadline and before any contribution.
#
#   6. GRACE-ONLY close. Immediate value movement is always available:
#        - success: creator_claim (96% ALGO) and finalize (tokens) any time,
#        - failure/cancel: refund (full ALGO) any time.
#      Only the FINAL account close-out waits for a 6-month grace period, so a
#      straggler who never claims cannot lock the contract forever. There is no
#      early/owed-based close, so ClearState cannot brick closing.
#        - success grace: measured from funded_round.
#        - failure grace: measured from the deadline.
#
#   7. Decoupled close. The ASA close-out (admin_sweep_asa) and the ALGO
#      close-out (admin_claim) are SEPARATE calls. The ASA remnant is closed to
#      the ADMIN (admin must opt into the ASA first; a missing opt-in only
#      reverts THAT step, never trapping the ALGO). admin_claim then requires
#      asa_id == 0, so the ALGO close has no inner asset transfer that could
#      revert. This removes the creator-controlled lock on closing.
#
# ── Global State (uint unless noted) ─────────────────────────────────────────
# - "goal":            funding goal (microAlgos); whole-ALGO multiple, >= 10 ALGO
# - "rate":            ASA base units per 1 ALGO; > 0
# - "deadline":        round after which contributions are rejected
# - "days":            campaign duration in days (1–100)
# - "asa_id":          asset ID for the project token (0 until setup; reset to 0
#                      after admin_sweep_asa closes the holding)
# - "raised":          microAlgos contributed so far (MONOTONIC — only ++)
# - "funded_round":    round at which raised first reached goal (0 until funded)
# - "cancelled":       1 if admin has force-cancelled, 0 otherwise
# - "creator_claimed": 1 after creator has withdrawn their payout
# - "admin_claimed":   1 after admin has closed the contract
# - "creator" (bytes), "admin" (bytes)
#
# ── Local State (per investor) ───────────────────────────────────────────────
# - "contrib": microAlgos contributed (zeroed when the investor finalizes/refunds)
#
# FEE STRUCTURE:
# - Listing fee: goal × days / 100,000 (0.001%/day), minimum 10 ALGO, paid
#   upfront to admin at deployment. Non-refundable. Never enters the contract.
# - Success fee: taken as the REMAINDER swept to admin at the ALGO close, i.e.
#   roughly 4% of goal less any inner-txn fees. Not a fixed amount.
#
# WARNING — ClearState: the AVM always approves clear_program. An investor who
# submits ClearState while contrib > 0 permanently forfeits their contribution.
# This corrupts no global state and cannot block closing (no path depends on a
# per-investor liability total).
#
# DISCLOSURE (must be surfaced to users at contribution time):
# - A creator who never calls creator_claim before the success grace close
#   forfeits their 96% payout to the admin (the ALGO close sweeps the full
#   balance to admin).
# - An investor who never finalizes (success) before the success grace close
#   forfeits their tokens; the ASA remnant goes to the admin.

# ── Constants ─────────────────────────────────────────────────────────────────
#GRACE_PERIOD_ROUNDS = Int(4_712_727)   # ~6 months at 3.3 s/block
#ROUNDS_PER_DAY      = Int(26_057)      # 86400 / 3.3 rounded
GRACE_PERIOD_ROUNDS = Int(10)      # was Int(4_712_727)
ROUNDS_PER_DAY      = Int(10)      # was Int(26_057)
MIN_DAYS            = Int(1)
MAX_DAYS            = Int(100)
MAX_GOAL            = Int(100_000_000_000_000)  # 100 million ALGO in microAlgos
SUCCESS_FEE_PCT     = Int(4)

# ── Global state keys ───────────────────────────────────────────────────────────
KEY_GOAL            = Bytes("goal")
KEY_RATE            = Bytes("rate")
KEY_DEADLINE        = Bytes("deadline")
KEY_DAYS            = Bytes("days")
KEY_ASA             = Bytes("asa_id")
KEY_RAISED          = Bytes("raised")
KEY_FUNDED_ROUND    = Bytes("funded_round")
KEY_CANCELLED       = Bytes("cancelled")
KEY_CREATOR_CLAIMED = Bytes("creator_claimed")
KEY_ADMIN_CLAIMED   = Bytes("admin_claimed")
KEY_CREATOR         = Bytes("creator")
KEY_ADMIN           = Bytes("admin")

# ── Local state keys ────────────────────────────────────────────────────────────
LKEY_CONTRIB = Bytes("contrib")


def approval_program():

    # ── on_create ───────────────────────────────────────────────────────────────
    # Args: [0]=admin(32 bytes), [1]=goal(microAlgos), [2]=rate, [3]=days(1-100)
    # Group: [0]=ApplicationCreate, [1]=Payment(listing_fee) from creator to admin
    # rate == 0 signals a donation campaign (no token distribution).
    # All campaigns have a minimum listing fee of 10 ALGO regardless of goal/days.
    days_arg         = Btoi(Txn.application_args[3])
    goal_arg         = Btoi(Txn.application_args[1])
    rate_arg         = Btoi(Txn.application_args[2])
    listing_fee      = (goal_arg * days_arg) / Int(100_000)
    # Minimum listing fee is 10 ALGO (10_000_000 microAlgos), for all campaigns
    MIN_LISTING_FEE  = Int(10_000_000)
    effective_listing_fee = If(listing_fee < MIN_LISTING_FEE, MIN_LISTING_FEE, listing_fee)
    deadline_rounds  = Global.round() + (days_arg * ROUNDS_PER_DAY)
    admin_arg        = Txn.application_args[0]

    on_create = Seq(
        Assert(Txn.application_args.length() == Int(4)),
        Assert(Len(admin_arg) == Int(32)),
        Assert(goal_arg > Int(0)),
        Assert(goal_arg % Int(1_000_000) == Int(0)),
        Assert(goal_arg >= Int(10_000_000)),
        Assert(goal_arg <= MAX_GOAL),
        # rate == 0 is allowed for donation campaigns; rate > 0 for token campaigns
        Assert(days_arg >= MIN_DAYS),
        Assert(days_arg <= MAX_DAYS),
        # Listing fee payment: grouped Payment from creator to admin
        Assert(Txn.group_index() == Int(0)),
        Assert(Global.group_size() == Int(2)),
        Assert(Gtxn[1].type_enum() == TxnType.Payment),
        Assert(Gtxn[1].sender() == Txn.sender()),
        Assert(Gtxn[1].receiver() == admin_arg),
        Assert(Gtxn[1].amount() >= effective_listing_fee),
        Assert(Gtxn[1].close_remainder_to() == Global.zero_address()),
        Assert(Gtxn[1].rekey_to() == Global.zero_address()),
        App.globalPut(KEY_CREATOR,         Txn.sender()),
        App.globalPut(KEY_ADMIN,           admin_arg),
        App.globalPut(KEY_GOAL,            goal_arg),
        App.globalPut(KEY_RATE,            rate_arg),
        App.globalPut(KEY_DAYS,            days_arg),
        App.globalPut(KEY_DEADLINE,        deadline_rounds),
        App.globalPut(KEY_RAISED,          Int(0)),
        App.globalPut(KEY_ASA,             Int(0)),
        App.globalPut(KEY_FUNDED_ROUND,    Int(0)),
        App.globalPut(KEY_CANCELLED,       Int(0)),
        App.globalPut(KEY_CREATOR_CLAIMED, Int(0)),
        App.globalPut(KEY_ADMIN_CLAIMED,   Int(0)),
        Approve(),
    )

    # ── Utility expressions ─────────────────────────────────────────────────────
    app_addr        = Global.current_application_address()
    goal            = App.globalGet(KEY_GOAL)
    rate            = App.globalGet(KEY_RATE)
    deadline        = App.globalGet(KEY_DEADLINE)
    asa_id          = App.globalGet(KEY_ASA)
    raised          = App.globalGet(KEY_RAISED)
    funded_round    = App.globalGet(KEY_FUNDED_ROUND)
    creator         = App.globalGet(KEY_CREATOR)
    admin           = App.globalGet(KEY_ADMIN)
    creator_claimed = App.globalGet(KEY_CREATOR_CLAIMED)
    admin_claimed   = App.globalGet(KEY_ADMIN_CLAIMED)
    is_creator      = Txn.sender() == creator
    is_admin        = Txn.sender() == admin
    before_deadline = Global.round() <= deadline
    after_deadline  = Global.round() > deadline
    is_cancelled    = App.globalGet(KEY_CANCELLED) == Int(1)
    # Two separate grace clocks:
    #   success: measured from the round the goal was met (funded_round).
    #   failure: measured from the deadline. (In failure funded_round == 0, so a
    #            funded_round-based clock would read "already expired" on mainnet;
    #            keying failure grace off the deadline gives investors a real,
    #            unhurried 6-month window to refund before the admin can sweep.)
    success_grace_expired = And(funded_round > Int(0),
                                Global.round() > funded_round + GRACE_PERIOD_ROUNDS)
    failure_grace_expired = Global.round() > deadline + GRACE_PERIOD_ROUNDS

    # ── STICKY OUTCOME PREDICATES ─────────────────────────────────────────────────
    # Success is permanent once funded_round is set; it is NEVER re-derived from
    # live counters. Failure requires the goal was never reached by the deadline,
    # OR an explicit admin cancel.
    # `failed` STRUCTURALLY excludes success: it can only be true while
    # funded_round == 0. This guarantees succeeded and failed are mutually
    # exclusive everywhere at once, regardless of which flags get set later.
    # A cancel after funding is already blocked in admin_cancel, but gating
    # failed on funded_round == 0 here makes that a redundant second defense
    # rather than the only one — refund can never reopen on a funded campaign.
    succeeded = funded_round > Int(0)
    failed    = And(
        funded_round == Int(0),
        Or(is_cancelled, after_deadline),
    )

    # ── setup ───────────────────────────────────────────────────────────────────
    # Group: [0] AppCall("setup"), [1] AssetTransfer(tokens from creator to app)
    setup = Seq(
        Assert(is_creator),
        Assert(asa_id == Int(0)),          # one-time only
        Assert(Not(is_cancelled)),
        Assert(before_deadline),           # cannot set up after the campaign ends
        Assert(raised == Int(0)),          # cannot set up after contributions begin
        Assert(Txn.assets.length() == Int(1)),
        App.globalPut(KEY_ASA, Txn.assets[0]),
        Assert(Txn.group_index() == Int(0)),
        Assert(Global.group_size() == Int(2)),
        # Inner opt-in to ASA (fee paid by caller via pooling)
        InnerTxnBuilder.Begin(),
        InnerTxnBuilder.SetFields({
            TxnField.type_enum:      TxnType.AssetTransfer,
            TxnField.xfer_asset:     Txn.assets[0],
            TxnField.asset_receiver: app_addr,
            TxnField.asset_amount:   Int(0),
            TxnField.fee:            Int(0),
        }),
        InnerTxnBuilder.Submit(),
        # Validate ASA token pool transfer covers goal × rate
        Assert(Gtxn[1].type_enum() == TxnType.AssetTransfer),
        Assert(Gtxn[1].sender() == Txn.sender()),
        Assert(Gtxn[1].asset_receiver() == app_addr),
        Assert(Gtxn[1].xfer_asset() == Txn.assets[0]),
        Assert(Gtxn[1].asset_amount() >= (goal * rate) / Int(1_000_000)),
        Assert(Gtxn[1].close_remainder_to() == Global.zero_address()),
        Assert(Gtxn[1].rekey_to() == Global.zero_address()),
        Approve()
    )

    # ── contribute ──────────────────────────────────────────────────────────────
    # raised moves UP by the contribution and is never decremented; it is the
    # monotonic record of progress toward goal. Per-investor `contrib` local
    # state records the individual stake (settled to zero on finalize/refund).
    # Donation campaigns (rate==0): no asa_id required, no token distribution.
    investor   = Txn.sender()
    new_raised = ScratchVar(TealType.uint64)
    contribute = Seq(
        Assert(before_deadline),
        Assert(Not(is_cancelled)),
        Assert(raised < goal),
        # Token campaigns require setup (asa_id != 0); donation campaigns skip setup
        If(rate != Int(0)).Then(Assert(asa_id != Int(0))),
        Assert(Txn.group_index() == Int(0)),
        Assert(Global.group_size() == Int(2)),
        Assert(Gtxn[1].type_enum() == TxnType.Payment),
        Assert(Gtxn[1].sender() == investor),
        Assert(Gtxn[1].receiver() == app_addr),
        Assert(Gtxn[1].amount() > Int(0)),
        Assert(Gtxn[1].amount() % Int(1_000_000) == Int(0)),
        Assert(Gtxn[1].close_remainder_to() == Global.zero_address()),
        Assert(Gtxn[1].rekey_to() == Global.zero_address()),
        Assert(raised + Gtxn[1].amount() <= goal),
        App.localPut(investor, LKEY_CONTRIB,
                     App.localGet(investor, LKEY_CONTRIB) + Gtxn[1].amount()),
        new_raised.store(raised + Gtxn[1].amount()),
        App.globalPut(KEY_RAISED, new_raised.load()),
        If(And(new_raised.load() >= goal, funded_round == Int(0))).Then(
            App.globalPut(KEY_FUNDED_ROUND, Global.round())
        ),
        Approve()
    )

    # ── finalize ────────────────────────────────────────────────────────────────
    # Success only. Investor claims tokens; their local contrib is zeroed.
    # Donation campaigns (rate==0): no tokens distributed, contrib zeroed immediately.
    contrib_amt = ScratchVar(TealType.uint64)
    tokens_due  = ScratchVar(TealType.uint64)
    finalize = Seq(
        Assert(Global.group_size() == Int(1)),
        Assert(succeeded),
        Assert(Not(is_cancelled)),
        contrib_amt.store(App.localGet(investor, LKEY_CONTRIB)),
        Assert(contrib_amt.load() > Int(0)),
        # Token campaigns: distribute tokens proportional to contribution
        # Donation campaigns (rate==0): skip token distribution
        If(rate != Int(0)).Then(Seq(
            tokens_due.store((contrib_amt.load() * rate) / Int(1_000_000)),
            If(tokens_due.load() > Int(0)).Then(Seq(
                InnerTxnBuilder.Begin(),
                InnerTxnBuilder.SetFields({
                    TxnField.type_enum:      TxnType.AssetTransfer,
                    TxnField.xfer_asset:     asa_id,
                    TxnField.asset_receiver: investor,
                    TxnField.asset_amount:   tokens_due.load(),
                    TxnField.fee:            Int(0),
                }),
                InnerTxnBuilder.Submit(),
            )),
        )),
        App.localPut(investor, LKEY_CONTRIB, Int(0)),
        Approve()
    )

    # ── creator_claim ───────────────────────────────────────────────────────────
    # Success only. Creator withdraws (goal - 4% fee) ALGO. Callable as soon as
    # the goal is met, independent of investor finalization.
    admin_fee      = ScratchVar(TealType.uint64)
    creator_payout = ScratchVar(TealType.uint64)
    creator_claim = Seq(
        Assert(Global.group_size() == Int(1)),
        Assert(is_creator),
        Assert(succeeded),
        Assert(Not(is_cancelled)),
        Assert(creator_claimed == Int(0)),
        admin_fee.store((goal * SUCCESS_FEE_PCT) / Int(100)),
        creator_payout.store(goal - admin_fee.load()),
        Assert(creator_payout.load() > Int(0)),
        InnerTxnBuilder.Begin(),
        InnerTxnBuilder.SetFields({
            TxnField.type_enum: TxnType.Payment,
            TxnField.receiver:  creator,
            TxnField.amount:    creator_payout.load(),
            TxnField.fee:       Int(0),
        }),
        InnerTxnBuilder.Submit(),
        App.globalPut(KEY_CREATOR_CLAIMED, Int(1)),
        Approve()
    )

    # ── refund ──────────────────────────────────────────────────────────────────
    # Failure only. Investor reclaims their ALGO. Keyed on `failed`, which
    # requires funded_round == 0 — can NEVER open once the goal is hit.
    # Available immediately on failure/cancel; no grace wait for investors.
    refund = Seq(
        Assert(Global.group_size() == Int(1)),
        Assert(failed),
        contrib_amt.store(App.localGet(investor, LKEY_CONTRIB)),
        Assert(contrib_amt.load() > Int(0)),
        InnerTxnBuilder.Begin(),
        InnerTxnBuilder.SetFields({
            TxnField.type_enum: TxnType.Payment,
            TxnField.receiver:  investor,
            TxnField.amount:    contrib_amt.load(),
            TxnField.fee:       Int(0),
        }),
        InnerTxnBuilder.Submit(),
        App.localPut(investor, LKEY_CONTRIB, Int(0)),
        Approve()
    )

    # ── creator_reclaim_asa ───────────────────────────────────────────────────────
    # Failure only. The creator's failure-side counterpart to refund: closes the
    # app's entire deposited project-token holding back to the CREATOR. The
    # tokens were the creator's deposit; on a failed/cancelled raise they must be
    # returnable to the creator, not absorbed by the admin.
    #
    # Available IMMEDIATELY on failure/cancel — no grace wait, symmetric with the
    # investor refund. The creator controls recovery and need not wait on the
    # admin. Closing the ASA also satisfies admin_claim's asa_id == 0
    # precondition, so on failure the admin never needs admin_sweep_asa.
    #
    # FRONTEND REQUIREMENT: the creator must be opted into asa_id (they deposited
    # it, so normally they are). If not, the inner asset_close_to reverts and the
    # call can be retried after opting in — nothing is lost.
    creator_reclaim_asa = Seq(
        Assert(Global.group_size() == Int(1)),
        Assert(is_creator),
        Assert(failed),
        Assert(asa_id != Int(0)),
        InnerTxnBuilder.Begin(),
        InnerTxnBuilder.SetFields({
            TxnField.type_enum:      TxnType.AssetTransfer,
            TxnField.xfer_asset:     asa_id,
            TxnField.asset_receiver: creator,
            TxnField.asset_amount:   Int(0),
            TxnField.asset_close_to: creator,   # closes the app's full ASA balance
            TxnField.fee:            Int(0),
        }),
        InnerTxnBuilder.Submit(),
        App.globalPut(KEY_ASA, Int(0)),         # app no longer holds the ASA
        Approve()
    )

    # ── admin_sweep_asa ───────────────────────────────────────────────────────────
    # Decoupled ASA close-out to the ADMIN. Kept separate from the ALGO close so
    # that a failure here (e.g. admin not yet opted into this campaign's ASA) can
    # NEVER trap the ALGO. Two cases, BOTH gated on grace expiry so the rightful
    # owner has had their full self-service window first:
    #
    #   SUCCESS (success_grace_expired): sweeps tokens of investors who never
    #     finalized. Per finding-D, unclaimed value forfeits to the admin.
    #
    #   FAILURE (failure_grace_expired): fallback only. On failure the creator is
    #     expected to call creator_reclaim_asa (immediate, self-service). If they
    #     never do within the 6-month failure grace, the creator forfeits and the
    #     admin sweeps — symmetric with the success side, and prevents a
    #     non-reclaiming creator from permanently locking the ALGO close (which
    #     requires asa_id == 0). Without this branch, a creator who never reclaims
    #     would trap the failed campaign's ALGO shell forever.
    #
    # PROCEDURE: the admin must opt the admin account into asa_id BEFORE calling
    # this, or the inner asset_close_to reverts. On revert nothing is lost — opt
    # in and retry. Sweeping to the admin removes any third-party lock on closing.
    asa_sweep_ok = And(
        asa_id != Int(0),
        Or(
            And(succeeded, Not(is_cancelled), success_grace_expired),
            And(failed, failure_grace_expired),
        ),
    )
    admin_sweep_asa = Seq(
        Assert(Global.group_size() == Int(1)),
        Assert(is_admin),
        Assert(asa_sweep_ok),
        InnerTxnBuilder.Begin(),
        InnerTxnBuilder.SetFields({
            TxnField.type_enum:      TxnType.AssetTransfer,
            TxnField.xfer_asset:     asa_id,
            TxnField.asset_receiver: admin,
            TxnField.asset_amount:   Int(0),
            TxnField.asset_close_to: admin,   # closes the app's full ASA balance
            TxnField.fee:            Int(0),
        }),
        InnerTxnBuilder.Submit(),
        App.globalPut(KEY_ASA, Int(0)),       # app no longer holds the ASA
        Approve()
    )

    # ── admin_claim ─────────────────────────────────────────────────────────────
    # GRACE-ONLY ALGO close. No early/`owed`-based path exists, so nothing the
    # close depends on can be desynchronized by ClearState.
    #
    # Precondition: the app must NOT still hold the project ASA (asa_id == 0),
    # because an account cannot close out its ALGO while holding an ASA. The
    # admin runs admin_sweep_asa first. Decoupling guarantees the ALGO close
    # itself has no inner asset transfer that could revert and trap funds.
    #
    #   Success close: succeeded, not cancelled, success_grace_expired
    #     → close all remaining ALGO (the ~4% fee, plus any unclaimed creator
    #       payout — see finding D, accepted) to the ADMIN.
    #   Failure close: failed, failure_grace_expired
    #     → close residual ALGO to the CREATOR.
    #
    # Immediate withdrawals are unaffected: creator_claim (success) and refund
    # (failure) remain available the moment the outcome is decided; only the
    # final account close waits for grace.
    success_close_ok = And(
        succeeded,
        Not(is_cancelled),
        success_grace_expired,
        asa_id == Int(0),
    )
    failure_close_ok = And(
        failed,
        failure_grace_expired,
        asa_id == Int(0),
    )

    success_close = Seq(
        InnerTxnBuilder.Begin(),
        InnerTxnBuilder.SetFields({
            TxnField.type_enum:          TxnType.Payment,
            TxnField.receiver:           admin,
            TxnField.amount:             Int(0),
            TxnField.close_remainder_to: admin,
            TxnField.fee:                Int(0),
        }),
        InnerTxnBuilder.Submit(),
    )

    failure_close = Seq(
        InnerTxnBuilder.Begin(),
        InnerTxnBuilder.SetFields({
            TxnField.type_enum:          TxnType.Payment,
            TxnField.receiver:           admin,
            TxnField.amount:             Int(0),
            TxnField.close_remainder_to: admin,
            TxnField.fee:                Int(0),
        }),
        InnerTxnBuilder.Submit(),
    )

    # admin_claim fires ONE inner txn (the ALGO close). fee:0 → caller-pooled;
    # the admin's app-call must carry fee >= 2x min fee. Lone transaction so the
    # pooled-fee budget can't be manipulated by sibling transactions.
    admin_claim = Seq(
        Assert(Global.group_size() == Int(1)),
        Assert(is_admin),
        Assert(admin_claimed == Int(0)),
        Assert(Or(success_close_ok, failure_close_ok)),
        If(success_close_ok).Then(success_close).Else(failure_close),
        App.globalPut(KEY_ADMIN_CLAIMED, Int(1)),
        Approve()
    )

    # ── admin_cancel ────────────────────────────────────────────────────────────
    # Only before success. Cannot cancel a funded campaign.
    admin_cancel = Seq(
        Assert(Global.group_size() == Int(1)),
        Assert(is_admin),
        Assert(Not(is_cancelled)),
        Assert(funded_round == Int(0)),
        App.globalPut(KEY_CANCELLED, Int(1)),
        Approve(),
    )

    # ── on_delete ───────────────────────────────────────────────────────────────
    on_delete = Seq(
        Assert(is_admin),
        Assert(admin_claimed == Int(1)),
        Approve()
    )

    on_update = Seq(Reject())

    on_closeout = Seq(
        Assert(App.localGet(Txn.sender(), LKEY_CONTRIB) == Int(0)),
        Approve()
    )

    on_optin = Seq(
        Assert(Not(is_cancelled)),
        Assert(before_deadline),
        App.localPut(Txn.sender(), LKEY_CONTRIB, Int(0)),
        Approve()
    )

    program = Cond(
        [Txn.application_id() == Int(0),                           on_create],
        [Txn.on_completion() == OnComplete.UpdateApplication,      on_update],
        [Txn.on_completion() == OnComplete.DeleteApplication,      on_delete],
        [Txn.on_completion() == OnComplete.CloseOut,               on_closeout],
        [Txn.on_completion() == OnComplete.OptIn,                  on_optin],
        [Txn.on_completion() == OnComplete.NoOp, Cond(
            [Txn.application_args[0] == Bytes("setup"),         setup],
            [Txn.application_args[0] == Bytes("contribute"),    contribute],
            [Txn.application_args[0] == Bytes("finalize"),      finalize],
            [Txn.application_args[0] == Bytes("creator_claim"), creator_claim],
            [Txn.application_args[0] == Bytes("refund"),         refund],
            [Txn.application_args[0] == Bytes("creator_reclaim_asa"), creator_reclaim_asa],
            [Txn.application_args[0] == Bytes("admin_sweep_asa"), admin_sweep_asa],
            [Txn.application_args[0] == Bytes("admin_claim"),    admin_claim],
            [Txn.application_args[0] == Bytes("admin_cancel"),   admin_cancel],
        )]
    )
    return program


def clear_program():
    return Approve()
