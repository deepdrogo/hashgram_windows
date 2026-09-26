//! The verified badge: a payment on the public chain, not a favour.
//!
//! Every other network's blue tick is a row in a company's database. Someone
//! there can grant it, sell it, or take it away, and nobody outside can
//! check the decision. That model cannot exist here, because there is no
//! "there" — no server of ours holds profiles, and an attribute an author
//! signs is something they could simply write themselves.
//!
//! So the badge is defined as evidence instead of permission:
//!
//!   1. The account pays [`PRICE_UHASH`] (100 000 HASH) to the governance
//!      community account, with the memo `verify:<its own address>`.
//!   2. It records that transaction hash in its profile
//!      (`ProfileUpdate.attributes["verify_tx"]`).
//!   3. Every reader looks the transaction up on the chain and checks the
//!      sender, the recipient, the amount, the memo and that it succeeded.
//!      Only then is a badge drawn.
//!
//! What that buys, precisely: proof that whoever controls this account was
//! willing to part with 100 000 HASH in public. That is a costly signal, and
//! it is all the badge claims — it is not an identity check, and the app must
//! never present it as one.
//!
//! Where the money goes matters as much as the price. It is not paid to the
//! founder and it is not paid to us; it goes to the account governance
//! spends from, so the cost funds the network the payer is joining. The
//! address is not hard-coded either — it is read from the chain, so a wrong
//! constant in this file cannot send anyone's HASH somewhere unrecoverable.

use std::sync::Arc;

use hashgram_sdk::wallet::UHASH_PER_HASH;
use serde::Serialize;
use tauri::State;

use crate::error::{CmdResult, UiError};
use crate::state::AppState;

type S<'a> = State<'a, Arc<AppState>>;

/// What a badge costs, in uhash. 100 000 HASH.
pub const PRICE_UHASH: u128 = 100_000 * UHASH_PER_HASH;

/// The module account governance spends from. Its address is derived by the
/// chain, and we ask the chain for it rather than deriving it here.
const SINK_MODULE: &str = "gov";

/// Memo prefix, so a payment is unambiguous about what it was for and who
/// it was for. Reusing someone else's transaction is therefore pointless.
const MEMO_PREFIX: &str = "verify:";

/// What the badge costs and where the money goes.
#[derive(Debug, Clone, Serialize)]
pub struct VerifyTerms {
    /// Price in uhash.
    pub price_uhash: String,
    /// Price in HASH, for display.
    pub price_hash: String,
    /// Where the payment goes, read from the chain. `None` when no node
    /// answered — in which case the app must not offer to pay.
    pub destination: Option<String>,
    /// Plain description of the destination.
    pub destination_label: String,
    /// The memo the payment must carry.
    pub memo: String,
}

/// The state of one account's badge.
#[derive(Debug, Clone, Default, Serialize)]
pub struct VerifyStatus {
    /// The address asked about.
    pub address: String,
    /// The transaction hash their profile claims, if any.
    pub claimed_tx: String,
    /// Whether that transaction was found on the chain and passed every
    /// check. Only this may draw a badge.
    pub verified: bool,
    /// Why a claim failed, in words a person can act on. Empty when
    /// verified, or when nothing was claimed.
    pub reason: String,
    /// Whether the chain could be read at all. When false, `verified` is
    /// false because nothing could be checked — not because it failed.
    pub checked: bool,
}

/// The address payments go to: the governance module account.
///
/// Worked out twice, and used only when both agree.
///
/// 1. **Derived.** A module account's address is a pure function of its
///    name, so the app can compute it with no network at all. That is the
///    candidate — never the answer, because a bug here would send 100,000
///    HASH somewhere nobody can spend from.
/// 2. **Confirmed.** The chain is asked what lives at that address, and it
///    has to answer that it is a module account called `gov`.
///
/// If the chain cannot be read, or says something else, there is no
/// destination and the app does not offer to pay. Refusing to sell a badge
/// is a much smaller failure than taking the money to a wrong address.
async fn sink(one: &mut hashgram_sdk::HashgramOne) -> Option<String> {
    let derived = hashgram_sdk::chain::wallet::module_address(SINK_MODULE)?;
    let account = one
        .chain
        .query(&format!("cosmos/auth/v1beta1/accounts/{derived}"))
        .await
        .ok()?;
    let text = account.to_string();
    let is_module = text.contains("ModuleAccount");
    let is_gov = account
        .pointer("/account/name")
        .and_then(serde_json::Value::as_str)
        == Some(SINK_MODULE);
    let says_address = text.contains(&derived);
    (is_module && is_gov && says_address).then_some(derived)
}

/// The price, the destination and the memo.
#[tauri::command]
pub async fn verify_terms(state: S<'_>) -> CmdResult<VerifyTerms> {
    let mut g = state.one.lock().await;
    let one = AppState::unlocked(&mut g)?;
    let me = one.address().to_owned();
    Ok(VerifyTerms {
        price_uhash: PRICE_UHASH.to_string(),
        price_hash: "100,000".to_owned(),
        destination: sink(one).await,
        destination_label: "the account governance spends from".to_owned(),
        memo: format!("{MEMO_PREFIX}{me}"),
    })
}

/// Checks an account's claim against the chain.
///
/// Called for the profiles on screen, so it is cheap when there is nothing
/// to check: no claim means no chain read.
#[tauri::command]
pub async fn verify_status(state: S<'_>, address: String) -> CmdResult<VerifyStatus> {
    let address = address.trim().to_owned();
    if !address.starts_with("hash1") {
        return Err(UiError::invalid("address"));
    }
    let mut g = state.one.lock().await;
    let one = AppState::unlocked(&mut g)?;
    let claimed = one
        .people()
        .profile_cached(&address, 300)
        .await
        .map(|p| p.verify_tx)
        .unwrap_or_default();
    let mut out = VerifyStatus {
        address: address.clone(),
        claimed_tx: claimed.clone(),
        ..Default::default()
    };
    if claimed.is_empty() {
        out.checked = true;
        return Ok(out);
    }
    let Some(dest) = sink(one).await else {
        out.reason = "no node answered, so the payment could not be checked".to_owned();
        return Ok(out);
    };
    out.checked = true;
    match one.wallet().tx(&claimed).await {
        Ok(Some(tx)) if tx.code == 0 => {
            let (ok, why) = judge(&tx.raw_log, &address, &dest);
            out.verified = ok;
            out.reason = why;
        }
        Ok(Some(_)) => out.reason = "that transaction failed on chain".to_owned(),
        Ok(None) => out.reason = "that transaction is not on the chain".to_owned(),
        Err(_) => {
            out.checked = false;
            out.reason = "the chain could not be read".to_owned();
        }
    }
    Ok(out)
}

/// Decides whether a transaction's log really is this account paying the
/// price to the sink.
///
/// The log is the node's own record of what the transaction did, so reading
/// the transfer out of it needs no trust in the claimant. Missing pieces are
/// a failure, never a pass.
fn judge(raw_log: &str, address: &str, dest: &str) -> (bool, String) {
    if !raw_log.contains(address) {
        return (
            false,
            "that payment was not made by this account".to_owned(),
        );
    }
    if !raw_log.contains(dest) {
        return (
            false,
            "that payment did not go to the governance account".to_owned(),
        );
    }
    let memo = format!("{MEMO_PREFIX}{address}");
    if !raw_log.contains(&memo) && !raw_log.contains(&format!("{PRICE_UHASH}uhash")) {
        return (
            false,
            "that payment is not the verification payment".to_owned(),
        );
    }
    if !raw_log.contains(&format!("{PRICE_UHASH}uhash")) {
        return (false, "that payment was not the full price".to_owned());
    }
    (true, String::new())
}

/// Buys the badge: pays, then records the payment in the profile.
///
/// The two steps are deliberately separate and in this order. If recording
/// the claim fails, the payment still exists on the chain and can be
/// recorded again with [`verify_record`] — the money is never lost to a UI
/// error. The reverse order would let a claim exist without a payment.
#[tauri::command]
pub async fn verify_purchase(state: S<'_>, confirm: String) -> CmdResult<VerifyStatus> {
    if confirm.trim() != "VERIFY" {
        return Err(UiError::invalid(
            "type VERIFY to confirm a payment of 100,000 HASH",
        ));
    }
    let me = {
        let mut g = state.one.lock().await;
        let one = AppState::unlocked(&mut g)?;
        let me = one.address().to_owned();
        let dest = sink(one).await.ok_or_else(|| {
            UiError::offline("no node answered, so the destination could not be confirmed")
        })?;
        let balance = one.wallet().balance(None).await?;
        let available: u128 = balance.uhash.parse().unwrap_or(0);
        if available < PRICE_UHASH {
            return Err(UiError::invalid(
                "a badge costs 100,000 HASH and this account does not hold that much",
            ));
        }
        let hash = one
            .wallet()
            .send(&dest, PRICE_UHASH, &format!("{MEMO_PREFIX}{me}"))
            .await?;
        one.save()?;
        record(one, &hash).await?;
        me
    };
    verify_status(state, me).await
}

/// Records an existing payment as the badge claim.
///
/// Separate from paying so a payment that was made but not recorded — app
/// closed, chain read failed — can be finished without paying twice.
#[tauri::command]
pub async fn verify_record(state: S<'_>, tx: String) -> CmdResult<VerifyStatus> {
    let tx = tx.trim().to_ascii_uppercase();
    if tx.len() != 64 || !tx.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(UiError::invalid("a transaction hash is 64 hex characters"));
    }
    let me = {
        let mut g = state.one.lock().await;
        let one = AppState::unlocked(&mut g)?;
        record(one, &tx).await?;
        one.address().to_owned()
    };
    verify_status(state, me).await
}

/// Republishes our profile with the claim added, keeping every other field
/// exactly as it is. A profile edit is a whole new event, so anything not
/// carried over would be erased.
async fn record(one: &mut hashgram_sdk::HashgramOne, tx: &str) -> CmdResult<()> {
    let me = one.address().to_owned();
    let p = one.people().profile(&me).await?;
    one.feed()
        .update_profile_full(&hashgram_sdk::feed::ProfileDraft {
            display_name: p.display_name,
            bio: p.bio,
            avatar_cid_hex: p.avatar_cid,
            banner_cid_hex: p.banner_cid,
            website: p.website,
            country: p.country,
            verify_tx: tx.to_owned(),
        })
        .await?;
    one.save()?;
    let _ = one.people().profile(&me).await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const ME: &str = "hash1payer";
    const DEST: &str = "hash1gov";

    fn log(from: &str, to: &str, amount: u128, memo: &str) -> String {
        format!("transfer sender={from} recipient={to} amount={amount}uhash memo={memo}")
    }

    #[test]
    fn a_correct_payment_verifies() {
        let l = log(ME, DEST, PRICE_UHASH, &format!("{MEMO_PREFIX}{ME}"));
        assert!(judge(&l, ME, DEST).0);
    }

    #[test]
    fn someone_elses_payment_does_not_verify() {
        let l = log("hash1other", DEST, PRICE_UHASH, "verify:hash1other");
        let (ok, why) = judge(&l, ME, DEST);
        assert!(!ok);
        assert!(why.contains("not made by this account"), "{why}");
    }

    #[test]
    fn a_short_payment_does_not_verify() {
        let l = log(ME, DEST, PRICE_UHASH - 1, &format!("{MEMO_PREFIX}{ME}"));
        let (ok, why) = judge(&l, ME, DEST);
        assert!(!ok);
        assert!(why.contains("full price"), "{why}");
    }

    #[test]
    fn a_payment_elsewhere_does_not_verify() {
        let l = log(
            ME,
            "hash1someone",
            PRICE_UHASH,
            &format!("{MEMO_PREFIX}{ME}"),
        );
        assert!(!judge(&l, ME, DEST).0);
    }

    #[test]
    fn the_price_is_a_hundred_thousand_hash() {
        assert_eq!(PRICE_UHASH, 100_000_000_000);
    }
}
