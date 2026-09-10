//! Process-wide state behind Tauri's managed state.

use std::sync::Arc;
use std::time::Instant;

use hashgram_sdk::account::Account;
use tokio::sync::{Mutex, RwLock};
use zeroize::Zeroizing;

use crate::chain_access::ChainAccess;
use crate::crypto::DbKey;
use crate::db::Db;
use crate::net::NetManager;
use crate::perf::PerfStore;
use crate::settings::Settings;

/// An unlocked vault.
pub struct Session {
    /// The account (wallet, root, device keys).
    pub account: Account,
    /// The database column key from the vault.
    pub db_key: DbKey,
    /// When it was unlocked.
    pub unlocked_at: Instant,
    /// Last user activity, for auto-lock.
    pub last_activity: Instant,
}

/// A mnemonic shown to the user during onboarding and not yet committed to
/// a vault. Zeroised on drop.
pub type PendingMnemonic = Zeroizing<String>;

/// Everything.
pub struct AppState {
    /// Settings.
    pub settings: RwLock<Settings>,
    /// Unlocked session, if any.
    pub session: RwLock<Option<Session>>,
    /// Mnemonic generated during onboarding, before the vault exists.
    pub pending_mnemonic: Mutex<Option<PendingMnemonic>>,
    /// The swarm.
    pub net: Arc<NetManager>,
    /// Chain source chooser.
    pub chain: Arc<ChainAccess>,
    /// Database.
    pub db: Arc<Db>,
    /// Performance store.
    pub perf: Arc<PerfStore>,
    /// Transactions still pending (hashes), watched by a background task.
    pub pending: Mutex<Vec<String>>,
}

impl AppState {
    /// Milliseconds since unlock, or `None` when locked.
    pub async fn unlocked_for_ms(&self) -> Option<u64> {
        self.session
            .read()
            .await
            .as_ref()
            .map(|s| s.unlocked_at.elapsed().as_millis() as u64)
    }

    /// Touches the activity timer.
    pub async fn touch(&self) {
        if let Some(s) = self.session.write().await.as_mut() {
            s.last_activity = Instant::now();
        }
    }

    /// Locks if the auto-lock timer elapsed. Returns `true` when it locked.
    pub async fn auto_lock_if_due(&self) -> bool {
        let minutes = self.settings.read().await.security.auto_lock_minutes;
        if minutes == 0 {
            return false;
        }
        let due = self
            .session
            .read()
            .await
            .as_ref()
            .map(|s| s.last_activity.elapsed().as_secs() >= u64::from(minutes) * 60)
            .unwrap_or(false);
        if due {
            self.lock().await;
        }
        due
    }

    /// Locks the vault: drops the account and the database key.
    pub async fn lock(&self) {
        *self.session.write().await = None;
        self.pending_mnemonic.lock().await.take();
    }
}
