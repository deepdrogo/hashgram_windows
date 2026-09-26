//! Media: upload to store nodes, download from providers, verify by hash,
//! and encrypt private files before they leave the device.
//!
//! Private files use XChaCha20-Poly1305 with a random key and nonce. The
//! key travels inside the E2EE message that references the blob; the store
//! node holds ciphertext under a CID that names the ciphertext. Public files
//! are uploaded as they are and referenced by CID from social events.

use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use hashgram_net::NetworkIdentity;
use hashgram_p2p::PeerId;
use hashgram_proto::blob::{chunk_matches, cid, manifest_for};
use hashgram_proto::keys::blake3_hash;
use hashgram_proto::limits::CHUNK_SIZE;
use hashgram_proto::pb;
use hashgram_proto::{dht, signing, Ed25519Signer};
use tracing::debug;

use crate::link::Link;
use crate::SdkError;

/// A private-file key: 32-byte key and 24-byte nonce.
#[derive(Debug, Clone)]
pub struct FileKey {
    /// Key.
    pub key: [u8; 32],
    /// Nonce.
    pub nonce: [u8; 24],
}

/// Encrypts a file for private upload. Returns ciphertext and the key.
pub fn encrypt_private(plaintext: &[u8]) -> Result<(Vec<u8>, FileKey), SdkError> {
    let mut key = [0u8; 32];
    let mut nonce = [0u8; 24];
    getrandom::fill(&mut key).map_err(|_| SdkError::Invalid("no randomness".into()))?;
    getrandom::fill(&mut nonce).map_err(|_| SdkError::Invalid("no randomness".into()))?;
    let cipher = XChaCha20Poly1305::new((&key).into());
    let ct = cipher
        .encrypt(XNonce::from_slice(&nonce), plaintext)
        .map_err(|_| SdkError::Invalid("encryption failed".into()))?;
    Ok((ct, FileKey { key, nonce }))
}

/// Decrypts a private file.
pub fn decrypt_private(ciphertext: &[u8], key: &FileKey) -> Result<Vec<u8>, SdkError> {
    let cipher = XChaCha20Poly1305::new((&key.key).into());
    cipher
        .decrypt(XNonce::from_slice(&key.nonce), ciphertext)
        .map_err(|_| SdkError::Invalid("decryption failed: wrong key or altered file".into()))
}

/// The result of an upload.
#[derive(Debug, Clone, serde::Serialize)]
pub struct Uploaded {
    /// CID, hex.
    pub cid: String,
    /// Bytes stored (ciphertext size for private).
    pub size: u64,
    /// Chunks.
    pub chunks: usize,
    /// Store peers that accepted the whole blob.
    pub providers: Vec<String>,
    /// For private uploads: hex key and nonce to put in the message.
    pub key: Option<String>,
    /// Nonce, hex.
    pub nonce: Option<String>,
    /// BLAKE3 of the plaintext, hex.
    pub plaintext_hash: String,
}

/// How many providers public media is pushed to.
///
/// Matches the network's own `TARGET_REPLICAS`, so a node's repair pass
/// treats a fresh avatar or post image as complete rather than as
/// under-replicated and in need of copying. Uploading to fewer than the
/// target is how media quietly ends up with one copy.
pub const PUBLIC_REPLICAS: usize = 3;

/// Uploads `data` to up to `replicas` store peers. Every chunk is pushed
/// only where the manifest was accepted.
pub async fn upload(
    link: &Link,
    network: &NetworkIdentity,
    device: &Ed25519Signer,
    data: &[u8],
    mime: &str,
    private: bool,
    replicas: usize,
) -> Result<Uploaded, SdkError> {
    let plaintext_hash = hex::encode(blake3_hash(data));
    let (bytes, key) = if private {
        let (ct, k) = encrypt_private(data)?;
        (ct, Some(k))
    } else {
        (data.to_vec(), None)
    };
    let mime = if private {
        "application/octet-stream"
    } else {
        mime
    };
    let manifest =
        manifest_for(&bytes, mime, private).map_err(|e| SdkError::Invalid(e.to_string()))?;
    let c = cid(&manifest).to_vec();

    let stores = link.peers_with_role("store").await;
    let media = link.peers_with_role("media").await;
    let mut targets: Vec<PeerId> = media;
    for s in stores {
        if !targets.contains(&s) {
            targets.push(s);
        }
    }
    if targets.is_empty() {
        return Err(SdkError::Link(crate::link::LinkError::NoPeer("store")));
    }
    let mut providers = Vec::new();
    for p in targets.into_iter().take(replicas.max(1)) {
        let mut put = pb::BlobPutManifest {
            cid: c.clone(),
            manifest: Some(manifest.clone()),
            timestamp: now(),
            ..Default::default()
        };
        signing::sign_blob_upload(network, device, &mut put)?;
        let missing = match link
            .request(p, pb::request::Body::BlobPutManifest(put))
            .await
        {
            Ok(pb::response::Body::BlobPutManifest(r)) if r.accepted => r.missing_chunks,
            Ok(pb::response::Body::BlobPutManifest(r)) => {
                debug!(%p, reason = r.reason, "manifest refused");
                continue;
            }
            Ok(_) => continue,
            Err(e) => {
                debug!(%p, error = %e, "manifest upload failed");
                continue;
            }
        };
        let mut ok = true;
        for index in missing {
            let start = index as usize * CHUNK_SIZE;
            let end = (start + CHUNK_SIZE).min(bytes.len());
            let chunk = bytes.get(start..end).unwrap_or(&[]).to_vec();
            match link
                .request(
                    p,
                    pb::request::Body::BlobPutChunk(pb::BlobPutChunk {
                        cid: c.clone(),
                        index,
                        data: chunk,
                    }),
                )
                .await
            {
                Ok(pb::response::Body::BlobPutChunk(r)) if r.accepted => {}
                other => {
                    debug!(%p, ?other, "chunk refused");
                    ok = false;
                    break;
                }
            }
        }
        if ok {
            providers.push(p.to_string());
        }
    }
    if providers.is_empty() {
        return Err(SdkError::Delivery("no store node accepted the blob".into()));
    }
    Ok(Uploaded {
        cid: hex::encode(&c),
        size: manifest.size,
        chunks: manifest.chunks.len(),
        providers,
        key: key.as_ref().map(|k| hex::encode(k.key)),
        nonce: key.as_ref().map(|k| hex::encode(k.nonce)),
        plaintext_hash,
    })
}

/// Uploads bytes that the caller has already encrypted (a HashDrive object
/// or sealed manifest, see `hashgram_app::drive`). The manifest is marked
/// `encrypted = true` and the MIME is the ciphertext container, so the CID
/// matches `hashgram_app::drive::object_ref`.
pub async fn upload_sealed(
    link: &Link,
    network: &NetworkIdentity,
    device: &Ed25519Signer,
    ciphertext: &[u8],
    replicas: usize,
) -> Result<Uploaded, SdkError> {
    let manifest = manifest_for(ciphertext, "application/octet-stream", true)
        .map_err(|e| SdkError::Invalid(e.to_string()))?;
    let c = cid(&manifest).to_vec();
    let providers =
        push_manifest_and_chunks(link, network, device, &manifest, &c, ciphertext, replicas)
            .await?;
    Ok(Uploaded {
        cid: hex::encode(&c),
        size: manifest.size,
        chunks: manifest.chunks.len(),
        providers,
        key: None,
        nonce: None,
        plaintext_hash: String::new(),
    })
}

/// Pushes a manifest and its chunks to up to `replicas` store/media peers,
/// resuming from each peer's `missing_chunks`. Returns the peers that hold
/// the whole blob.
async fn push_manifest_and_chunks(
    link: &Link,
    network: &NetworkIdentity,
    device: &Ed25519Signer,
    manifest: &pb::BlobManifest,
    c: &[u8],
    bytes: &[u8],
    replicas: usize,
) -> Result<Vec<String>, SdkError> {
    let stores = link.peers_with_role("store").await;
    let media = link.peers_with_role("media").await;
    let mut targets: Vec<PeerId> = media;
    for s in stores {
        if !targets.contains(&s) {
            targets.push(s);
        }
    }
    if targets.is_empty() {
        return Err(SdkError::Link(crate::link::LinkError::NoPeer("store")));
    }
    let mut providers = Vec::new();
    for p in targets.into_iter().take(replicas.max(1)) {
        let mut put = pb::BlobPutManifest {
            cid: c.to_vec(),
            manifest: Some(manifest.clone()),
            timestamp: now(),
            ..Default::default()
        };
        signing::sign_blob_upload(network, device, &mut put)?;
        let missing = match link
            .request(p, pb::request::Body::BlobPutManifest(put))
            .await
        {
            Ok(pb::response::Body::BlobPutManifest(r)) if r.accepted => r.missing_chunks,
            Ok(pb::response::Body::BlobPutManifest(r)) => {
                debug!(%p, reason = r.reason, "manifest refused");
                continue;
            }
            Ok(_) => continue,
            Err(e) => {
                debug!(%p, error = %e, "manifest upload failed");
                continue;
            }
        };
        let mut ok = true;
        for index in missing {
            let start = index as usize * CHUNK_SIZE;
            let end = (start + CHUNK_SIZE).min(bytes.len());
            let chunk = bytes.get(start..end).unwrap_or(&[]).to_vec();
            match link
                .request(
                    p,
                    pb::request::Body::BlobPutChunk(pb::BlobPutChunk {
                        cid: c.to_vec(),
                        index,
                        data: chunk,
                    }),
                )
                .await
            {
                Ok(pb::response::Body::BlobPutChunk(r)) if r.accepted => {}
                other => {
                    debug!(%p, ?other, "chunk refused");
                    ok = false;
                    break;
                }
            }
        }
        if ok {
            providers.push(p.to_string());
        }
    }
    if providers.is_empty() {
        return Err(SdkError::Delivery("no store node accepted the blob".into()));
    }
    Ok(providers)
}

/// Finds providers of a CID: DHT first, then connected store/media peers.
pub async fn providers(link: &Link, c: &[u8]) -> Vec<PeerId> {
    let mut out = link.providers(dht::blob(c)).await;
    for p in link.peers_with_role("store").await {
        if !out.contains(&p) {
            out.push(p);
        }
    }
    for p in link.peers_with_role("media").await {
        if !out.contains(&p) {
            out.push(p);
        }
    }
    out
}

/// What this client could find out about where a blob actually is.
///
/// These are answers from nodes that were reachable at the time, not a
/// guarantee: a provider that is offline may still hold a complete copy,
/// and one that answers may lose it tomorrow. `asked` is there so the UI
/// can say "2 of the 3 nodes we could reach" instead of implying it
/// surveyed the network.
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct Availability {
    /// Providers that answered with a complete copy.
    pub complete: u32,
    /// Providers that answered with some chunks but not all.
    pub partial: u32,
    /// Providers asked, including ones that did not answer.
    pub asked: u32,
    /// Providers that answered at all.
    pub answered: u32,
    /// What the network aims for ([`PUBLIC_REPLICAS`]).
    pub target: u32,
}

/// Asks the providers this client can reach whether they hold `cid`.
///
/// One round of `BlobHas`, bounded, so a Drive listing can show real
/// numbers without turning into a crawl.
pub async fn availability(link: &Link, c: &[u8]) -> Availability {
    const MAX_ASKED: usize = 8;
    let peers = providers(link, c).await;
    let mut out = Availability {
        target: PUBLIC_REPLICAS as u32,
        ..Default::default()
    };
    for peer in peers.into_iter().take(MAX_ASKED) {
        out.asked += 1;
        let body = pb::request::Body::BlobHas(pb::BlobHas { cid: c.to_vec() });
        match link.request(peer, body).await {
            Ok(pb::response::Body::BlobHas(r)) => {
                out.answered += 1;
                if r.has_manifest && r.chunks_total > 0 && r.chunks_present >= r.chunks_total {
                    out.complete += 1;
                } else if r.chunks_present > 0 || r.has_manifest {
                    out.partial += 1;
                }
            }
            _ => continue,
        }
    }
    out
}

/// Downloads and verifies a blob from any provider. Returns the bytes and
/// the manifest.
pub async fn download(
    link: &Link,
    c: &[u8],
    receipt: Option<(&hashgram_chain::Client, &NetworkIdentity, &Ed25519Signer)>,
) -> Result<(Vec<u8>, pb::BlobManifest, PeerId), SdkError> {
    let peers = providers(link, c).await;
    let mut last = SdkError::NotFound(hex::encode(c));
    for p in peers {
        match download_from(link, p, c).await {
            Ok((bytes, m)) => {
                // A signed retrieval receipt for the bytes served is how a
                // media node earns; the client is never blocked by it.
                if let Some((chain, network, device)) = receipt {
                    link.deliver_receipt(
                        chain,
                        network,
                        device,
                        p,
                        signing::ROLE_MEDIA,
                        bytes.len() as u64,
                    )
                    .await;
                }
                return Ok((bytes, m, p));
            }
            Err(e) => last = e,
        }
    }
    Err(last)
}

async fn download_from(
    link: &Link,
    p: PeerId,
    c: &[u8],
) -> Result<(Vec<u8>, pb::BlobManifest), SdkError> {
    let m = match link
        .request(
            p,
            pb::request::Body::BlobGetManifest(pb::BlobGetManifest { cid: c.to_vec() }),
        )
        .await?
    {
        pb::response::Body::BlobGetManifest(r) if r.found => r
            .manifest
            .ok_or_else(|| SdkError::NotFound(hex::encode(c)))?,
        _ => return Err(SdkError::NotFound(hex::encode(c))),
    };
    if cid(&m).as_slice() != c {
        link.handle()
            .score(p, hashgram_p2p::ScoreEvent::ServedCorruptData)
            .await;
        return Err(SdkError::Corrupt(format!(
            "{p} served a manifest that does not hash to the cid"
        )));
    }
    let mut out = Vec::with_capacity(m.size as usize);
    for index in 0..m.chunks.len() as u32 {
        let data = match link
            .request(
                p,
                pb::request::Body::BlobGetChunk(pb::BlobGetChunk {
                    cid: c.to_vec(),
                    index,
                }),
            )
            .await?
        {
            pb::response::Body::BlobGetChunk(r) if r.found => r.data,
            _ => {
                return Err(SdkError::NotFound(format!(
                    "chunk {index} of {}",
                    hex::encode(c)
                )))
            }
        };
        if !chunk_matches(&m, index, &data) {
            link.handle()
                .score(p, hashgram_p2p::ScoreEvent::ServedCorruptData)
                .await;
            return Err(SdkError::Corrupt(format!(
                "{p} served chunk {index} that does not match its hash"
            )));
        }
        out.extend_from_slice(&data);
    }
    Ok((out, m))
}

/// Verifies that `data` is the content of `cid_hex`: recomputes the
/// manifest and compares.
#[must_use]
pub fn verify(data: &[u8], mime: &str, encrypted: bool, cid_hex: &str) -> bool {
    manifest_for(data, mime, encrypted)
        .map(|m| hex::encode(cid(&m)) == cid_hex)
        .unwrap_or(false)
}

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn private_round_trip_and_tamper_detection() {
        let (ct, key) = encrypt_private(b"secret photo").unwrap();
        assert_eq!(decrypt_private(&ct, &key).unwrap(), b"secret photo");
        let mut bad = ct.clone();
        bad[0] ^= 1;
        assert!(decrypt_private(&bad, &key).is_err());
        let wrong = FileKey {
            key: [0; 32],
            nonce: key.nonce,
        };
        assert!(decrypt_private(&ct, &wrong).is_err());
    }

    #[test]
    fn verify_matches_cid() {
        let m = manifest_for(b"abc", "text/plain", false).unwrap();
        let c = hex::encode(cid(&m));
        assert!(verify(b"abc", "text/plain", false, &c));
        assert!(!verify(b"abd", "text/plain", false, &c));
        assert!(!verify(b"abc", "text/html", false, &c));
    }
}
