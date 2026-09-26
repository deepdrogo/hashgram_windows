//! User settings. No secrets live here; the file is plain JSON.
//!
//! Anything that touches the network profile (devnet genesis, bootstrap
//! override, REST gateway) is for development only; on Mainnet the app
//! uses the SDK's compiled-in bootstrap list and reads the chain through
//! the P2P relay (`chain_api = None`).

use std::path::Path;

use serde::{Deserialize, Serialize};

/// Which network the app is pinned to.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NetworkKind {
    /// Hashgram Mainnet: genesis hash compiled in.
    Mainnet,
    /// A developer network. Visually unmistakable (persistent banner).
    Devnet,
}

/// Network profile.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NetworkSettings {
    /// Mainnet or devnet.
    pub kind: NetworkKind,
    /// Devnet genesis hash (ignored on mainnet, which is compiled in).
    #[serde(default)]
    pub devnet_genesis_hash: String,
    /// Bootstrap multiaddrs. Empty on Mainnet means the compiled-in list.
    #[serde(default)]
    pub bootstrap: Vec<String>,
    /// REST gateway URL; empty means chain reads go through the P2P relay.
    /// Devnet convenience only.
    #[serde(default)]
    pub chain_api: String,
    /// Public indexer base URL (leaderboards, discovery). Empty = none.
    ///
    /// Kept as the first entry of [`Self::indexer_urls`]; a settings file
    /// written by an older build still has only this one.
    #[serde(default)]
    pub indexer_url: String,
    /// Further indexers to fall back to when the first does not answer.
    ///
    /// An indexer is a cache, never an authority, so having several is
    /// cheap and losing one should not take discovery with it. One
    /// operator's indexer going away was a single point of failure in
    /// everything but name.
    #[serde(default)]
    pub indexer_urls: Vec<String>,
    /// The mail gateway's identity (`@name` or `hash1…`) for external
    /// e-mail (`ext-to:`). Empty = external sending disabled.
    #[serde(default)]
    pub gateway_address: String,
}

/// Security settings.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SecuritySettings {
    /// Minutes of inactivity before the vault locks (0 = never).
    #[serde(default = "default_auto_lock")]
    pub auto_lock_minutes: u32,
    /// Whether Windows Hello unlock is enrolled.
    #[serde(default)]
    pub hello_enabled: bool,
    /// Seconds before a sensitive clipboard copy is cleared.
    #[serde(default = "default_clipboard_clear")]
    pub clipboard_clear_secs: u32,
}

fn default_auto_lock() -> u32 {
    15
}
fn default_clipboard_clear() -> u32 {
    30
}

/// Appearance.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AppearanceSettings {
    /// `dark` | `light` | `system`.
    #[serde(default = "default_theme")]
    pub theme: String,
    /// Reduce motion regardless of the OS setting.
    #[serde(default)]
    pub reduced_motion: bool,
    /// `comfortable` | `compact`.
    #[serde(default = "default_density")]
    pub density: String,
    /// UI language. `en` is the only complete one, so it is the only one
    /// accepted; see `src/lib/i18n.ts` for why a partial table is worse
    /// than none.
    #[serde(default = "default_language")]
    pub language: String,
}

fn default_theme() -> String {
    "dark".to_owned()
}
fn default_density() -> String {
    "comfortable".to_owned()
}
fn default_language() -> String {
    "en".to_owned()
}

impl Default for AppearanceSettings {
    fn default() -> Self {
        Self {
            theme: default_theme(),
            reduced_motion: false,
            density: default_density(),
            language: default_language(),
        }
    }
}

/// Social preferences.
///
/// `local_country` is what Pulse's Local tab filters on. It is a choice the
/// user makes, never a guess from an address, a connection or a clock: the
/// app has no geolocation of any kind.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SocialSettings {
    /// Two-letter country code, or empty for no Local tab.
    #[serde(default)]
    pub local_country: String,
    /// Who may start a Chat: `everyone` | `nobody`.
    #[serde(default = "default_who_can_chat")]
    pub who_can_chat: String,
    /// Hex ids of the Spaces this device has published a public listing
    /// for, so a Space can be shown as listed without asking the network
    /// and cannot be listed twice by mistake.
    ///
    /// Only listed Spaces appear here, and a listing is public already, so
    /// this file learns nothing that is not.
    #[serde(default)]
    pub listed_spaces: Vec<String>,
}

fn default_who_can_chat() -> String {
    "everyone".to_owned()
}

// Written by hand rather than derived. A settings file from a build before
// this section existed has no `social` object at all, and `#[serde(default)]`
// on the *field* fills it with `SocialSettings::default()` — the derived
// version of which would leave `who_can_chat` empty, which `validate`
// refuses. Every save then failed with "who may chat must be everyone or
// nobody", including the one the theme switch makes.
impl Default for SocialSettings {
    fn default() -> Self {
        Self {
            local_country: String::new(),
            who_can_chat: default_who_can_chat(),
            listed_spaces: Vec::new(),
        }
    }
}

/// Notifications. Nothing leaves the device: these are OS toasts driven
/// by sync events.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NotificationSettings {
    /// New mail in the Inbox.
    #[serde(default = "default_true")]
    pub mail: bool,
    /// New requests (Requests folder, contact requests).
    #[serde(default = "default_true")]
    pub requests: bool,
    /// Space activity.
    #[serde(default = "default_true")]
    pub spaces: bool,
    /// Circle activity.
    #[serde(default = "default_true")]
    pub circles: bool,
}

fn default_true() -> bool {
    true
}

impl Default for NotificationSettings {
    fn default() -> Self {
        Self {
            mail: true,
            requests: true,
            spaces: true,
            circles: true,
        }
    }
}

/// Mail preferences kept by the app (the SDK's own `MailSettings` hold the
/// receipt/retention rules; these are presentation).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MailPrefs {
    /// Show conversations grouped by thread.
    #[serde(default = "default_true")]
    pub threaded: bool,
    /// Mark a message read when it has been open this many seconds
    /// (0 = immediately).
    #[serde(default)]
    pub mark_read_after_secs: u32,
}

impl Default for MailPrefs {
    fn default() -> Self {
        Self {
            threaded: true,
            mark_read_after_secs: 0,
        }
    }
}

/// Updates.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UpdateSettings {
    /// Check on start (only outbound HTTPS besides user endpoints).
    #[serde(default = "default_true")]
    pub auto_check: bool,
    /// Channel name.
    #[serde(default = "default_channel")]
    pub channel: String,
}

fn default_channel() -> String {
    "stable".to_owned()
}

/// Advanced.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AdvancedSettings {
    /// tracing filter.
    #[serde(default = "default_log_level")]
    pub log_level: String,
}

fn default_log_level() -> String {
    "info".to_owned()
}

/// All settings.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Settings {
    /// Network.
    pub network: NetworkSettings,
    /// Security.
    pub security: SecuritySettings,
    /// Appearance.
    #[serde(default)]
    pub appearance: AppearanceSettings,
    /// Notifications.
    #[serde(default)]
    pub notifications: NotificationSettings,
    /// Social.
    #[serde(default)]
    pub social: SocialSettings,
    /// Mail presentation.
    #[serde(default)]
    pub mail: MailPrefs,
    /// Updates.
    pub updates: UpdateSettings,
    /// Advanced.
    pub advanced: AdvancedSettings,
    /// Start with Windows.
    #[serde(default)]
    pub start_with_windows: bool,
    /// Onboarding completed (a vault exists and was confirmed).
    #[serde(default)]
    pub onboarding_done: bool,
    /// Label this PC registered its device key under.
    #[serde(default)]
    pub device_label: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            network: NetworkSettings {
                kind: NetworkKind::Mainnet,
                devnet_genesis_hash: String::new(),
                bootstrap: Vec::new(),
                chain_api: String::new(),
                indexer_url: String::new(),
                indexer_urls: Vec::new(),
                gateway_address: String::new(),
            },
            security: SecuritySettings {
                auto_lock_minutes: default_auto_lock(),
                hello_enabled: false,
                clipboard_clear_secs: default_clipboard_clear(),
            },
            appearance: AppearanceSettings::default(),
            notifications: NotificationSettings::default(),
            social: SocialSettings::default(),
            mail: MailPrefs::default(),
            updates: UpdateSettings {
                auto_check: true,
                channel: default_channel(),
            },
            advanced: AdvancedSettings {
                log_level: default_log_level(),
            },
            start_with_windows: false,
            onboarding_done: false,
            device_label: String::new(),
        }
    }
}

impl Settings {
    /// Loads settings, falling back to defaults when the file is absent or
    /// unreadable (a corrupt settings file must never lock a user out).
    /// A 0.1.x file is read too: unknown sections are ignored and new ones
    /// take their defaults.
    pub fn load(path: &Path) -> Self {
        let mut s: Self = match std::fs::read(path) {
            Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_else(|e| {
                tracing::warn!(error = %e, "settings unreadable; using defaults");
                Self::default()
            }),
            Err(_) => Self::default(),
        };
        // A value this build no longer offers is corrected on the way in,
        // not rejected. A stored choice that fails validation turns the next
        // unrelated save — a theme toggle, say — into an error the user
        // cannot explain or fix.
        if s.appearance.language != "en" {
            s.appearance.language = default_language();
        }
        s
    }

    /// Writes settings atomically.
    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let tmp = path.with_extension("json.tmp");
        let bytes = serde_json::to_vec_pretty(self).map_err(std::io::Error::other)?;
        std::fs::write(&tmp, bytes)?;
        std::fs::rename(&tmp, path)
    }

    /// The first configured indexer, if one looks like a URL.
    #[must_use]
    pub fn indexer(&self) -> Option<&str> {
        self.indexers().into_iter().next()
    }

    /// Every configured indexer, in the order to try them.
    #[must_use]
    pub fn indexers(&self) -> Vec<&str> {
        let looks_like_url = |u: &&str| u.starts_with("https://") || u.starts_with("http://");
        std::iter::once(self.network.indexer_url.trim())
            .chain(self.network.indexer_urls.iter().map(|u| u.trim()))
            .filter(looks_like_url)
            .fold(Vec::new(), |mut acc, u| {
                if !acc.contains(&u) {
                    acc.push(u);
                }
                acc
            })
    }

    /// Validates the parts a user can mistype.
    pub fn validate(&self) -> Result<(), String> {
        for u in std::iter::once(&self.network.indexer_url).chain(&self.network.indexer_urls) {
            let u = u.trim();
            if !u.is_empty()
                && !(u.starts_with("https://")
                    || u.starts_with("http://127.0.0.1")
                    || u.starts_with("http://localhost"))
            {
                return Err("indexer URL must be https:// (plain http only on this PC)".into());
            }
        }
        let c = self.network.chain_api.trim();
        if !c.is_empty()
            && !(c.starts_with("https://")
                || c.starts_with("http://127.0.0.1")
                || c.starts_with("http://localhost"))
        {
            return Err("chain API must be https:// (plain http only on this PC)".into());
        }
        if self.network.kind == NetworkKind::Devnet {
            let g = self.network.devnet_genesis_hash.trim();
            if g.len() != 64 || !g.chars().all(|c| c.is_ascii_hexdigit()) {
                return Err("a devnet needs its 64-hex genesis hash".into());
            }
        }
        if !["dark", "light", "system"].contains(&self.appearance.theme.as_str()) {
            return Err("theme must be dark, light or system".into());
        }
        if !self.appearance.language.is_empty() && self.appearance.language != "en" {
            return Err("English is the only complete translation".into());
        }
        let country = self.social.local_country.trim();
        if !country.is_empty()
            && (country.len() != 2 || !country.chars().all(|c| c.is_ascii_alphabetic()))
        {
            return Err("the local country is a two-letter code, or empty".into());
        }
        // Empty is "not set", which reads as the default rather than as an
        // error: a stricter check here only ever punished a user upgrading
        // from a build that had no such setting.
        if !["", "everyone", "nobody"].contains(&self.social.who_can_chat.as_str()) {
            return Err("who may chat must be everyone or nobody".into());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_settings_file_from_before_the_social_section_still_saves() {
        // The theme switch saves the whole settings object. A file written
        // by an older build has no `social` key, and if the default for it
        // were the derived one this would fail validation with "who may
        // chat must be everyone or nobody" — which is exactly what it did.
        let old = r#"{
            "network": {"kind":"mainnet","devnet_genesis_hash":"","bootstrap":[],"chain_api":"","indexer_url":"","gateway_address":""},
            "security": {"auto_lock_minutes":15,"hello_enabled":false,"clipboard_clear_secs":30},
            "appearance": {"theme":"dark","reduced_motion":false,"density":"comfortable","language":"en"},
            "updates": {"auto_check":true,"channel":"stable"},
            "advanced": {"log_level":"info"}
        }"#;
        let mut s: Settings = serde_json::from_str(old).unwrap();
        assert_eq!(s.social.who_can_chat, "everyone");
        assert!(s.validate().is_ok(), "{:?}", s.validate());

        // And switching the theme on it still validates.
        s.appearance.theme = "light".into();
        assert!(s.validate().is_ok());
    }

    /// A language this build dropped must not poison the file: the next
    /// save of anything at all would fail validation otherwise.
    #[test]
    fn a_retired_language_is_corrected_on_load_not_rejected() {
        let d = std::env::temp_dir().join(format!("hg-lang-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&d);
        let p = d.join("settings.json");
        let mut s = Settings::default();
        s.appearance.language = "ka".into();
        s.save(&p).unwrap();
        let back = Settings::load(&p);
        assert_eq!(back.appearance.language, "en");
        assert!(back.validate().is_ok());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn defaults_are_mainnet_with_no_endpoints() {
        let s = Settings::default();
        assert_eq!(s.network.kind, NetworkKind::Mainnet);
        assert!(s.network.bootstrap.is_empty());
        assert!(s.network.chain_api.is_empty());
        assert!(s.indexer().is_none());
        assert!(!s.onboarding_done);
        assert!(s.validate().is_ok());
    }

    #[test]
    fn round_trips_and_tolerates_garbage_and_old_files() {
        let d = std::env::temp_dir().join(format!("hg-settings-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&d);
        let p = d.join("settings.json");
        let mut s = Settings::default();
        s.network.indexer_url = "https://indexer.example.org".into();
        s.save(&p).unwrap();
        assert_eq!(Settings::load(&p), s);
        std::fs::write(&p, b"{not json").unwrap();
        assert_eq!(Settings::load(&p), Settings::default());
        // A 0.1.x file: sections we no longer have are ignored.
        std::fs::write(
            &p,
            br#"{"network":{"kind":"mainnet","https_endpoints":[],"local_node_api":"http://127.0.0.1:1317"},
                "security":{"auto_lock_minutes":5,"hello_enabled":false,"clipboard_clear_secs":30},
                "notifications":{"messages":true,"calls":true},
                "media":{"autoplay":true,"cache_mb":2048},
                "updates":{"auto_check":true,"channel":"stable"},
                "advanced":{"log_level":"info"},"onboarding_done":true,"device_label":"Home"}"#,
        )
        .unwrap();
        let old = Settings::load(&p);
        assert!(old.onboarding_done);
        assert_eq!(old.security.auto_lock_minutes, 5);
        assert_eq!(old.device_label, "Home");
    }

    #[test]
    fn validation_catches_plain_http_and_bad_genesis() {
        let mut s = Settings::default();
        s.network.indexer_url = "http://indexer.example.org".into();
        assert!(s.validate().is_err());
        s.network.indexer_url = "http://127.0.0.1:8080".into();
        assert!(s.validate().is_ok());
        s.network.kind = NetworkKind::Devnet;
        assert!(s.validate().is_err());
        s.network.devnet_genesis_hash = "ab".repeat(32);
        assert!(s.validate().is_ok());
    }
}
