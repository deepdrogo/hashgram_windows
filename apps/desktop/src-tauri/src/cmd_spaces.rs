//! Spaces commands over `one.spaces()`.
//!
//! Rule violations come back from the SDK as `SdkError::Invalid("space
//! rule: …")` → `UiError{code: "invalid"}`; the UI disables controls from
//! `my_role` first and shows these as toasts only when the state raced.

use std::sync::Arc;

use hashgram_sdk::protocol::pb as app;
use hashgram_sdk::protocol::space::Member;
use hashgram_sdk::spaces::SpaceSummary;
use tauri::State;

use crate::error::{CmdResult, UiError};
use crate::state::AppState;
use crate::views::{SpaceContentView, SpaceSharedEntryView, SpaceStateView};

type S<'a> = State<'a, Arc<AppState>>;

fn role_of(s: &str) -> CmdResult<app::SpaceRole> {
    Ok(match s.to_ascii_lowercase().as_str() {
        "guest" => app::SpaceRole::Guest,
        "member" => app::SpaceRole::Member,
        "admin" => app::SpaceRole::Admin,
        "owner" => app::SpaceRole::Owner,
        other => return Err(UiError::invalid(format!("unknown role {other}"))),
    })
}

/// Our spaces.
#[tauri::command]
pub async fn spaces_list(state: S<'_>) -> CmdResult<Vec<SpaceSummary>> {
    let mut g = state.one.lock().await;
    let one = AppState::unlocked(&mut g)?;
    Ok(one.spaces().list()?)
}

/// Creates a Space (we become Owner).
#[tauri::command]
pub async fn spaces_create(state: S<'_>, name: String, description: String) -> CmdResult<String> {
    if name.trim().is_empty() || name.len() > 128 {
        return Err(UiError::invalid("a name is 1–128 characters"));
    }
    let mut g = state.one.lock().await;
    let one = AppState::unlocked(&mut g)?;
    let id = one.spaces().create(name.trim(), description.trim()).await?;
    one.save()?;
    Ok(id)
}

// ---------------------------------------------------------------------------
// The public directory
// ---------------------------------------------------------------------------
//
// A Space itself is private: an MLS group whose messages nobody outside can
// read. Making one "public" therefore cannot mean opening the group — it
// means publishing a *listing* so people can find it and ask to be let in.
//
// The listing is an ordinary public channel event (`CHANNEL_CREATE`), which
// already gossips network-wide and which every node already counts. So the
// directory needs no new protocol, no server, and no permission from us: any
// client reading the same events builds the same directory. The listing's
// first lines are a plain, readable convention, documented in docs/SPACES.md:
//
//     Hashgram Space
//     Category: Technology
//     Space: <32 hex>
//
//     <free description>
//
// Nothing is hidden in there — a reader of the raw event sees exactly what
// the app shows. Popularity is the public activity on the listing, counted
// by the node that answered, and labelled that way.

/// Categories a listing may declare. A fixed list, so the directory can be
/// browsed; free-text categories would just be hashtags with extra steps.
pub const SPACE_CATEGORIES: [&str; 10] = [
    "Technology",
    "Business",
    "Education",
    "Science",
    "Art & Design",
    "Gaming",
    "Music",
    "Sport",
    "Local",
    "Other",
];

const LISTING_MARKER: &str = "Hashgram Space";

/// A listing as shown in the directory.
#[derive(Debug, Clone, serde::Serialize)]
pub struct SpaceListing {
    /// Hex id of the channel event that is the listing.
    pub listing: String,
    /// Hex id of the Space it points at, when it declares one.
    pub space: String,
    /// Space name.
    pub name: String,
    /// Declared category.
    pub category: String,
    /// Free description, marker lines removed.
    pub description: String,
    /// Who published it — the owner to ask for an invitation.
    pub owner: String,
    /// Public posts on the listing, as counted by the node that answered.
    pub posts: u32,
    /// Distinct posters, same caveat.
    pub authors: u32,
    /// Newest public post (s), same caveat.
    pub last_post: u64,
    /// When the listing was published (s).
    pub created_at: u64,
}

/// Parses a listing out of a channel description. `None` when the channel is
/// an ordinary Topic rather than a Space listing.
fn parse_listing(w: &hashgram_sdk::feed::WallInfo) -> Option<SpaceListing> {
    let mut lines = w.description.lines();
    if lines.next()?.trim() != LISTING_MARKER {
        return None;
    }
    let mut category = String::new();
    let mut space = String::new();
    let mut rest: Vec<&str> = Vec::new();
    for line in lines {
        let t = line.trim();
        if let Some(v) = t.strip_prefix("Category:") {
            category = v.trim().to_owned();
        } else if let Some(v) = t.strip_prefix("Space:") {
            space = v.trim().to_owned();
        } else {
            rest.push(line);
        }
    }
    if !SPACE_CATEGORIES.contains(&category.as_str()) {
        category = "Other".to_owned();
    }
    Some(SpaceListing {
        listing: w.id.clone(),
        space: space.chars().filter(char::is_ascii_hexdigit).collect(),
        name: w.name.clone(),
        category,
        description: rest.join("\n").trim().to_owned(),
        owner: w.creator.clone(),
        posts: w.posts,
        authors: w.authors,
        last_post: w.last_post,
        created_at: w.created_at,
    })
}

/// Publishes a Space in the public directory.
///
/// Only its owner should call this, and only the owner's listing is worth
/// anything: the address that signed the channel event is the address people
/// will message for an invitation.
#[tauri::command]
pub async fn spaces_publish(
    state: S<'_>,
    space: String,
    category: String,
    description: String,
) -> CmdResult<SpaceListing> {
    let space = check_space_id(&space)?;
    let category = category.trim().to_owned();
    if !SPACE_CATEGORIES.contains(&category.as_str()) {
        return Err(UiError::invalid("pick one of the listed categories"));
    }
    if description.len() > 1_500 {
        return Err(UiError::invalid("a description is at most 1500 characters"));
    }
    let mut g = state.one.lock().await;
    let one = AppState::unlocked(&mut g)?;
    let me = one.account.address().to_owned();
    let summary = one
        .spaces()
        .list()?
        .into_iter()
        .find(|s| s.id == space)
        .ok_or_else(|| UiError::invalid("that Space is not on this device"))?;
    let body = format!(
        "{LISTING_MARKER}\nCategory: {category}\nSpace: {space}\n\n{}",
        if description.trim().is_empty() {
            summary.description.trim()
        } else {
            description.trim()
        }
    );
    // Closed posting: the listing is the owner's notice board, not a wall
    // anyone can write on. People who want in send a message.
    let wall = one.feed().create_wall(&summary.name, &body, false).await?;
    one.save()?;
    Ok(parse_listing(&wall).unwrap_or(SpaceListing {
        listing: wall.id,
        space,
        name: summary.name,
        category,
        description,
        owner: me,
        posts: 0,
        authors: 0,
        last_post: 0,
        created_at: wall.created_at,
    }))
}

/// A space id is hex; the app never guesses at one, so a light check is
/// enough to keep a typo out of a signed event.
fn check_space_id(s: &str) -> CmdResult<String> {
    let t = s.trim().to_ascii_lowercase();
    if (16..=64).contains(&t.len()) && t.chars().all(|c| c.is_ascii_hexdigit()) {
        Ok(t)
    } else {
        Err(UiError::invalid("space"))
    }
}

/// The public directory, by category and popularity.
///
/// `sort` is `popular` (public posts, then posters) or `new`. Popularity here
/// is a count from one node, not a global truth, and the UI says so.
#[tauri::command]
pub async fn spaces_directory(
    state: S<'_>,
    category: Option<String>,
    sort: Option<String>,
) -> CmdResult<Vec<SpaceListing>> {
    let mut g = state.one.lock().await;
    let one = AppState::unlocked(&mut g)?;
    // A wide window: a listing is published once and then just sits there,
    // so a day-long window would show almost nothing.
    let digest = one.feed().digest(90 * 24 * 3_600, 200).await?;
    let mut out: Vec<SpaceListing> = digest.walls.iter().filter_map(parse_listing).collect();
    if let Some(c) = category.as_deref().map(str::trim).filter(|c| !c.is_empty()) {
        out.retain(|l| l.category.eq_ignore_ascii_case(c));
    }
    match sort.as_deref().unwrap_or("popular") {
        "new" => out.sort_by_key(|l| std::cmp::Reverse(l.created_at)),
        _ => out.sort_by_key(|l| std::cmp::Reverse((l.posts, l.authors, l.last_post))),
    }
    Ok(out)
}

/// The category list, so the UI and the parser cannot drift apart.
#[tauri::command]
pub fn spaces_categories() -> Vec<String> {
    SPACE_CATEGORIES.iter().map(|s| (*s).to_owned()).collect()
}

/// Replayed state.
#[tauri::command]
pub async fn spaces_state(state: S<'_>, space: String) -> CmdResult<SpaceStateView> {
    let mut g = state.one.lock().await;
    let one = AppState::unlocked(&mut g)?;
    let me = one.address().to_owned();
    let st = one.spaces().state(&space)?;
    Ok(SpaceStateView::of(&st, &me))
}

/// Members by rank.
#[tauri::command]
pub async fn spaces_members(state: S<'_>, space: String) -> CmdResult<Vec<Member>> {
    let mut g = state.one.lock().await;
    let one = AppState::unlocked(&mut g)?;
    Ok(one.spaces().members(&space)?)
}

/// Content page (posts, comments, announcements), newest first.
#[tauri::command]
pub async fn spaces_content(
    state: S<'_>,
    space: String,
    before_ms: Option<u64>,
    limit: Option<usize>,
) -> CmdResult<Vec<SpaceContentView>> {
    let mut g = state.one.lock().await;
    let one = AppState::unlocked(&mut g)?;
    Ok(one
        .spaces()
        .content(
            &space,
            before_ms.unwrap_or(0),
            limit.unwrap_or(100).clamp(1, 500),
        )?
        .iter()
        .map(SpaceContentView::from)
        .collect())
}

/// Space drive listing.
#[tauri::command]
pub async fn spaces_drive(state: S<'_>, space: String) -> CmdResult<Vec<SpaceSharedEntryView>> {
    let mut g = state.one.lock().await;
    let one = AppState::unlocked(&mut g)?;
    Ok(one
        .spaces()
        .drive_entries(&space)?
        .iter()
        .map(SpaceSharedEntryView::from)
        .collect())
}

/// Invites (address or name resolved here) with a role.
#[tauri::command]
pub async fn spaces_invite(
    state: S<'_>,
    space: String,
    member: String,
    role: String,
) -> CmdResult<()> {
    let role = role_of(&role)?;
    if role == app::SpaceRole::Owner {
        return Err(UiError::invalid(
            "ownership is transferred with a role change, not an invite",
        ));
    }
    let mut g = state.one.lock().await;
    let one = AppState::unlocked(&mut g)?;
    let a = one.people().resolve(member.trim()).await?.address;
    one.spaces().invite(&space, &a, role).await?;
    one.save()?;
    Ok(())
}

/// Removes a member (or leaves when it is us).
#[tauri::command]
pub async fn spaces_remove(
    state: S<'_>,
    space: String,
    address: String,
    reason: String,
) -> CmdResult<()> {
    let mut g = state.one.lock().await;
    let one = AppState::unlocked(&mut g)?;
    one.spaces()
        .remove(&space, address.trim(), reason.trim())
        .await?;
    one.save()?;
    Ok(())
}

/// Changes a role (`owner` transfers ownership).
#[tauri::command]
pub async fn spaces_set_role(
    state: S<'_>,
    space: String,
    address: String,
    role: String,
) -> CmdResult<String> {
    let role = role_of(&role)?;
    let mut g = state.one.lock().await;
    let one = AppState::unlocked(&mut g)?;
    let id = one.spaces().set_role(&space, address.trim(), role).await?;
    one.save()?;
    Ok(id)
}

/// Updates name / description.
#[tauri::command]
pub async fn spaces_set_info(
    state: S<'_>,
    space: String,
    name: String,
    description: String,
) -> CmdResult<String> {
    let mut g = state.one.lock().await;
    let one = AppState::unlocked(&mut g)?;
    let id = one
        .spaces()
        .set_info(&space, name.trim(), description.trim())
        .await?;
    one.save()?;
    Ok(id)
}

/// Announcement (Admin+).
#[tauri::command]
pub async fn spaces_announce(
    state: S<'_>,
    space: String,
    title: String,
    text: String,
) -> CmdResult<String> {
    if title.trim().is_empty() && text.trim().is_empty() {
        return Err(UiError::invalid("write a title or a text"));
    }
    let mut g = state.one.lock().await;
    let one = AppState::unlocked(&mut g)?;
    let id = one
        .spaces()
        .announce(&space, title.trim(), text.trim(), Vec::new())
        .await?;
    one.save()?;
    Ok(id)
}

/// Post (Member+).
#[tauri::command]
pub async fn spaces_post(state: S<'_>, space: String, text: String) -> CmdResult<String> {
    if text.trim().is_empty() {
        return Err(UiError::invalid("write something"));
    }
    let mut g = state.one.lock().await;
    let one = AppState::unlocked(&mut g)?;
    let id = one
        .spaces()
        .post(&space, text.trim(), Vec::new(), Vec::new())
        .await?;
    one.save()?;
    Ok(id)
}

/// Comment (Member+).
#[tauri::command]
pub async fn spaces_comment(
    state: S<'_>,
    space: String,
    post: String,
    text: String,
) -> CmdResult<String> {
    if text.trim().is_empty() {
        return Err(UiError::invalid("write something"));
    }
    let mut g = state.one.lock().await;
    let one = AppState::unlocked(&mut g)?;
    let id = one.spaces().comment(&space, &post, text.trim()).await?;
    one.save()?;
    Ok(id)
}

/// Shares one of our Drive entries into the Space drive.
#[tauri::command]
pub async fn spaces_share_drive(
    state: S<'_>,
    space: String,
    entry: String,
    path: String,
    live: bool,
) -> CmdResult<String> {
    let mut g = state.one.lock().await;
    let one = AppState::unlocked(&mut g)?;
    let id = one
        .spaces()
        .share_drive(&space, &entry, path.trim().trim_matches('/'), live)
        .await?;
    one.save()?;
    Ok(id)
}

/// Unshares.
#[tauri::command]
pub async fn spaces_unshare_drive(state: S<'_>, space: String, share: String) -> CmdResult<String> {
    let mut g = state.one.lock().await;
    let one = AppState::unlocked(&mut g)?;
    let id = one.spaces().unshare_drive(&space, &share).await?;
    one.save()?;
    Ok(id)
}

/// The Space's group conversation.
///
/// A Space already is an MLS group — the one its posts and shared files
/// travel in — so its chat is that group, read and written with the same
/// commands as any other conversation. Nothing new is created and nobody
/// is invited twice: being in the Space *is* being in the chat.
#[tauri::command]
pub async fn spaces_chat_open(state: S<'_>, space: String) -> CmdResult<String> {
    let group_id = {
        let mut g = state.one.lock().await;
        let one = AppState::unlocked(&mut g)?;
        let summary = one
            .spaces()
            .list()?
            .into_iter()
            .find(|s| s.id == space.trim())
            .ok_or_else(|| UiError::not_found("space"))?;
        summary.group_id
    };
    // Registered as `space` so it is reachable as a conversation without
    // appearing in Chats, where it would be a second, confusing copy of
    // something the Space already shows.
    state.db.chat_register(&group_id, "space", "")?;
    Ok(group_id)
}

/// Mail to every member.
#[tauri::command]
pub async fn spaces_mail(
    state: S<'_>,
    space: String,
    subject: String,
    body: String,
) -> CmdResult<String> {
    if subject.trim().is_empty() && body.trim().is_empty() {
        return Err(UiError::invalid("write a subject or a body"));
    }
    let mut g = state.one.lock().await;
    let one = AppState::unlocked(&mut g)?;
    let id = one
        .spaces()
        .mail(&space, subject.trim(), body.trim())
        .await?;
    one.save()?;
    Ok(id)
}

fn space_cap(
    one: &mut hashgram_sdk::HashgramOne,
    space: &str,
    share: &str,
) -> CmdResult<app::DriveCapability> {
    let st = one.spaces().state(space)?;
    if let Some(e) = st.drive.get(share) {
        return Ok(e.capability.clone());
    }
    // Announcement / post attachments.
    for c in &st.content {
        for cap in &c.drive_refs {
            if hex::encode(&cap.share_id) == share {
                return Ok(cap.clone());
            }
        }
    }
    Err(UiError::not_found("shared entry"))
}

/// Downloads a Space drive file (by share id) to `out_path`.
#[tauri::command]
pub async fn spaces_drive_download(
    state: S<'_>,
    space: String,
    share: String,
    out_path: String,
) -> CmdResult<u64> {
    let mut g = state.one.lock().await;
    let one = AppState::unlocked(&mut g)?;
    let cap = space_cap(one, &space, &share)?;
    if cap.folder {
        return Err(UiError::invalid("open the folder and download its files"));
    }
    crate::cmd_drive::download_cap_to(one, &cap, &out_path).await
}

/// Opens a Space drive file with the default application.
#[tauri::command]
pub async fn spaces_drive_open(
    state: S<'_>,
    app: tauri::AppHandle,
    space: String,
    share: String,
) -> CmdResult<String> {
    let (name, bytes) = {
        let mut g = state.one.lock().await;
        let one = AppState::unlocked(&mut g)?;
        let cap = space_cap(one, &space, &share)?;
        if cap.folder {
            return Err(UiError::invalid("open the folder and open its files"));
        }
        (
            cap.name.clone(),
            one.drive().download_capability(&cap).await?,
        )
    };
    let dir = crate::paths::tmp_dir().join("space");
    std::fs::create_dir_all(&dir)?;
    let safe: String = name
        .chars()
        .map(|c| {
            if c.is_control() || "\\/:*?\"<>|".contains(c) {
                '_'
            } else {
                c
            }
        })
        .collect();
    let p = dir.join(format!(
        "{}-{}",
        &share[..share.len().min(8)],
        if safe.trim().is_empty() {
            "file".to_owned()
        } else {
            safe
        }
    ));
    tokio::fs::write(&p, &bytes).await?;
    crate::util::open_path(&app, &p)?;
    Ok(p.display().to_string())
}

/// Saves a Space drive file into our own Drive.
#[tauri::command]
pub async fn spaces_drive_save(
    state: S<'_>,
    space: String,
    share: String,
    parent: String,
) -> CmdResult<String> {
    let mut g = state.one.lock().await;
    let one = AppState::unlocked(&mut g)?;
    let cap = space_cap(one, &space, &share)?;
    Ok(one.drive().save_capability(&cap, &parent)?)
}

/// Lists the entries of a Space folder share.
#[tauri::command]
pub async fn spaces_drive_folder_list(
    state: S<'_>,
    space: String,
    share: String,
) -> CmdResult<Vec<crate::views::FolderEntryView>> {
    let mut g = state.one.lock().await;
    let one = AppState::unlocked(&mut g)?;
    let cap = space_cap(one, &space, &share)?;
    let fm = one.drive().shared_folder_entries(&cap).await?;
    Ok(fm
        .entries
        .iter()
        .map(crate::views::FolderEntryView::from)
        .collect())
}
