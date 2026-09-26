//! Public social profiles: read anyone's, edit your own.
//!
//! A profile is a projection of signed events, not a record a server keeps.
//! Names, bios, avatars and covers come from the author's latest
//! `PROFILE_UPDATE`; timelines and counts come from their event chain.
//!
//! Follower counts are the one number an author's own chain cannot answer —
//! nothing they sign records who followed them — so `followers` is `None`
//! unless an indexer answered, and `source` says where every number came
//! from. Nothing here invents a figure to fill a gap in the layout.

use std::sync::Arc;

use hashgram_sdk::feed::{FeedItem, ProfileTab};
use tauri::State;

use crate::error::{CmdResult, UiError};
use crate::state::AppState;
use crate::views::{ProfileStatsView, ProfileView};

type S<'a> = State<'a, Arc<AppState>>;

/// Largest avatar or cover accepted, before upload.
const MAX_IMAGE_BYTES: u64 = 8 * 1024 * 1024;

fn valid_address(a: &str) -> bool {
    a.starts_with("hash1") && a.len() >= 20 && a.len() <= 128
}

async fn read_image(path: &str) -> CmdResult<(Vec<u8>, String)> {
    let p = std::path::PathBuf::from(path);
    let meta = tokio::fs::metadata(&p).await?;
    if meta.len() > MAX_IMAGE_BYTES {
        return Err(UiError::invalid("pick an image under 8 MiB"));
    }
    let mime = mime_guess::from_path(&p)
        .first_or_octet_stream()
        .to_string();
    if !mime.starts_with("image/") {
        return Err(UiError::invalid("that file is not an image"));
    }
    Ok((tokio::fs::read(&p).await?, mime))
}

/// Tries each configured indexer until one answers.
///
/// An indexer is a cache, not an authority, so a second one costs nothing
/// and means the first going away does not take discovery with it.
async fn ask_indexers(
    state: &S<'_>,
    one: &mut hashgram_sdk::HashgramOne,
    path: &str,
) -> Option<serde_json::Value> {
    let bases: Vec<String> = state
        .settings
        .read()
        .await
        .indexers()
        .into_iter()
        .map(str::to_owned)
        .collect();
    for base in bases {
        if let Ok(Some(v)) = one.network_api().indexer(Some(&base), path).await {
            return Some(v);
        }
    }
    None
}

/// Counts from the indexer when one is configured, otherwise from this
/// device's copy of the author's log.
async fn stats_of(
    state: &S<'_>,
    one: &mut hashgram_sdk::HashgramOne,
    address: &str,
) -> ProfileStatsView {
    let local = one.feed().author_stats(address).unwrap_or_default();
    let mut view = ProfileStatsView {
        posts: local.posts,
        replies: local.replies,
        media: local.media,
        likes: local.likes,
        following: local.following,
        followers: None,
        first_event: local.first_event,
        source: if local.complete { "device" } else { "partial" }.to_owned(),
    };
    let path = format!("/v1/profiles/{address}");
    let Some(v) = ask_indexers(state, one, &path).await else {
        return view;
    };
    let n = |k: &str| v.get(k).and_then(serde_json::Value::as_u64);
    if let Some(f) = n("followers") {
        view.followers = Some(f as u32);
    }
    if let Some(f) = n("following") {
        view.following = f as u32;
    }
    if let (Some(p), Some(r)) = (n("posts"), n("reels")) {
        view.posts = (p + r) as u32;
    }
    view.source = "indexer".to_owned();
    view
}

/// A public profile, ours or somebody else's.
#[tauri::command]
pub async fn profile_of(state: S<'_>, address: String) -> CmdResult<ProfileView> {
    let address = address.trim().to_owned();
    if !valid_address(&address) {
        return Err(UiError::invalid("address"));
    }
    let mut g = state.one.lock().await;
    let one = AppState::unlocked(&mut g)?;
    let me = one.address().to_owned();
    // Their newest events first, so the profile and its timeline agree.
    let _ = one.feed().refresh_author(&address, 200).await;
    // Our own profile is never served from the cache. Publishing a new
    // avatar and then reading a five-minute-old copy is how a changed
    // picture looked like it had not saved.
    let profile = if address == me {
        one.people().profile(&address).await?
    } else {
        one.people().profile_cached(&address, 300).await?
    };
    let following = one.feed().follows().contains(&address);
    let stats = stats_of(&state, one, &address).await;
    Ok(ProfileView::new(profile, me, following, stats))
}

/// Our own profile.
#[tauri::command]
pub async fn profile_mine(state: S<'_>) -> CmdResult<ProfileView> {
    let me = {
        let mut g = state.one.lock().await;
        AppState::unlocked(&mut g)?.address().to_owned()
    };
    profile_of(state, me).await
}

/// Publishes our profile. Empty `avatar_cid`/`banner_cid` clear the image;
/// pass the current one to keep it.
#[tauri::command]
pub async fn profile_save(
    state: S<'_>,
    display_name: String,
    bio: String,
    website: String,
    country: String,
    avatar_cid: String,
    banner_cid: String,
) -> CmdResult<String> {
    if display_name.chars().count() > 128 {
        return Err(UiError::invalid(
            "the display name is at most 128 characters",
        ));
    }
    if bio.chars().count() > 1000 {
        return Err(UiError::invalid("the bio is at most 1000 characters"));
    }
    let website = website.trim().to_owned();
    if !website.is_empty() {
        if website.len() > 256 {
            return Err(UiError::invalid("that website address is too long"));
        }
        if !website.starts_with("https://") && !website.starts_with("http://") {
            return Err(UiError::invalid("the website must start with https://"));
        }
    }
    let country = country.trim().to_uppercase();
    if !country.is_empty()
        && (country.len() != 2 || !country.chars().all(|c| c.is_ascii_alphabetic()))
    {
        return Err(UiError::invalid(
            "the country is a two-letter code, or empty",
        ));
    }
    let hex_or_empty = |s: &str, what: &str| -> CmdResult<String> {
        let s = s.trim().to_ascii_lowercase();
        if s.is_empty() {
            return Ok(s);
        }
        if s.len() != 64 || !s.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(UiError::invalid(what));
        }
        Ok(s)
    };
    let avatar = hex_or_empty(&avatar_cid, "avatar")?;
    let banner = hex_or_empty(&banner_cid, "cover image")?;
    let mut g = state.one.lock().await;
    let one = AppState::unlocked(&mut g)?;
    // A profile event replaces the whole profile, so an edit has to carry
    // the verification claim forward. Editing a bio must not cost a badge.
    let me_now = one.address().to_owned();
    let verify_tx = one
        .people()
        .profile(&me_now)
        .await
        .map(|p| p.verify_tx)
        .unwrap_or_default();
    let id = one
        .feed()
        .update_profile_full(&hashgram_sdk::feed::ProfileDraft {
            display_name: display_name.trim().to_owned(),
            bio: bio.trim().to_owned(),
            avatar_cid_hex: avatar,
            banner_cid_hex: banner,
            website,
            country,
            verify_tx,
        })
        .await?;
    one.save()?;
    // Read our own profile straight back from the log we just wrote, so
    // the cached copy other screens use is the new one rather than the
    // one from before the change.
    let me = one.address().to_owned();
    let _ = one.people().profile(&me).await;
    Ok(id)
}

/// Uploads an image as public media and returns its CID, so the editor can
/// preview it before the profile event is signed.
#[tauri::command]
pub async fn profile_upload_image(state: S<'_>, path: String) -> CmdResult<String> {
    let (bytes, mime) = read_image(path.trim()).await?;
    let mut g = state.one.lock().await;
    let one = AppState::unlocked(&mut g)?;
    let m = one.feed().upload_media(&bytes, &mime, "image").await?;
    Ok(hex::encode(&m.cid))
}

/// One page of a profile tab: `posts`, `replies`, `media` or `likes`.
#[tauri::command]
pub async fn profile_timeline(
    state: S<'_>,
    address: String,
    tab: String,
    before: Option<u64>,
    limit: Option<usize>,
) -> CmdResult<Vec<FeedItem>> {
    let address = address.trim().to_owned();
    if !valid_address(&address) {
        return Err(UiError::invalid("address"));
    }
    let tab = ProfileTab::parse(&tab).ok_or_else(|| UiError::invalid("tab"))?;
    let limit = limit.unwrap_or(30).clamp(1, 100);
    let mut g = state.one.lock().await;
    let one = AppState::unlocked(&mut g)?;
    Ok(one
        .feed()
        .author_tab(&address, tab, before.unwrap_or(0), limit)?)
}

/// Who follows this address, and who they follow.
///
/// Followers need an index over everybody's events; without an indexer the
/// list is empty and the UI says so rather than showing a wrong number.
#[tauri::command]
pub async fn profile_follow_list(
    state: S<'_>,
    address: String,
    which: String,
) -> CmdResult<Vec<String>> {
    let address = address.trim().to_owned();
    if !valid_address(&address) {
        return Err(UiError::invalid("address"));
    }
    let which = match which.as_str() {
        "followers" | "following" => which,
        _ => return Err(UiError::invalid("which")),
    };
    let mut g = state.one.lock().await;
    let one = AppState::unlocked(&mut g)?;
    if which == "following" {
        // Who somebody follows is written in their own chain, so this list
        // needs no index and is right even offline.
        return Ok(one.feed().following_of(&address)?.into_iter().collect());
    }
    let path = format!("/v1/profiles/{address}/followers?limit=200");
    Ok(ask_indexers(&state, one, &path)
        .await
        .map(address_list)
        .unwrap_or_default())
}

/// The indexer answers address lists either bare or under `addresses`.
fn address_list(v: serde_json::Value) -> Vec<String> {
    let arr = v
        .get("addresses")
        .and_then(serde_json::Value::as_array)
        .cloned()
        .or_else(|| v.as_array().cloned())
        .unwrap_or_default();
    arr.iter()
        .filter_map(|x| {
            x.as_str()
                .map(str::to_owned)
                .or_else(|| x.get("address")?.as_str().map(str::to_owned))
        })
        .collect()
}
