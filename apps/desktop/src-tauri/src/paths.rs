//! Where the app keeps its files.
//!
//! Everything lives under `%LOCALAPPDATA%\Hashgram` — local, not roaming:
//! the vault and the database are bound to this machine (DPAPI, Windows
//! Hello), and roaming an encrypted vault between PCs is exactly what the
//! 24 words are for. `HASHGRAM_DESKTOP_HOME` overrides the root for tests
//! and portable use.

use std::path::PathBuf;

/// The data root.
#[must_use]
pub fn data_dir() -> PathBuf {
    if let Ok(p) = std::env::var("HASHGRAM_DESKTOP_HOME") {
        if !p.trim().is_empty() {
            return PathBuf::from(p);
        }
    }
    if let Ok(p) = std::env::var("LOCALAPPDATA") {
        if !p.trim().is_empty() {
            return PathBuf::from(p).join("Hashgram");
        }
    }
    std::env::temp_dir().join("Hashgram")
}

/// Ensures the data root exists.
pub fn ensure_dirs() -> std::io::Result<PathBuf> {
    let d = data_dir();
    std::fs::create_dir_all(&d)?;
    std::fs::create_dir_all(d.join("logs"))?;
    std::fs::create_dir_all(d.join("media-cache"))?;
    Ok(d)
}

/// The encrypted vault (keys). Never plaintext.
#[must_use]
pub fn vault_path() -> PathBuf {
    data_dir().join("vault.json")
}

/// Settings (no secrets).
#[must_use]
pub fn settings_path() -> PathBuf {
    data_dir().join("settings.json")
}

/// The SQLite database (sensitive columns encrypted with the vault key).
#[must_use]
pub fn db_path() -> PathBuf {
    data_dir().join("hashgram.db")
}

/// The persisted peerstore (peer ids and addresses only).
#[must_use]
pub fn peerstore_path() -> PathBuf {
    data_dir().join("peers.json")
}

/// DPAPI-wrapped passphrase blob for Windows Hello unlock.
#[must_use]
pub fn hello_blob_path() -> PathBuf {
    data_dir().join("hello.bin")
}

/// Log directory.
#[must_use]
pub fn logs_dir() -> PathBuf {
    data_dir().join("logs")
}
