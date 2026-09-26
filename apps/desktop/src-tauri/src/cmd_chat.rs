//! Private conversations.
//!
//! The pieces already existed: `messaging.rs` runs MLS groups and hands
//! ciphertext to store nodes that hold it for a fortnight when the other
//! device is offline. What was missing was somewhere to keep the
//! conversation between runs, and a screen. Both are here.
//!
//! History lives in the sealed SQLite cache (`db.rs`), never in the clear,
//! and never in the SDK's own store — the SDK deliberately keeps MLS state
//! and no transcript. Nothing in this module returns key material: a view
//! carries an address, a time and the text the user typed.
//!
//! Who may start a conversation is enforced **here, on the receiving
//! side**, in `accept_incoming`. A sender's client can be told anything; a
//! recipient's client decides what it keeps.

use std::sync::Arc;

use hashgram_sdk::messaging::Received;
use serde::Serialize;
use tauri::State;

use crate::db::{ChatRow, ChatSummaryRow};
use crate::error::{CmdResult, UiError};
use crate::state::AppState;

type S<'a> = State<'a, Arc<AppState>>;

/// Longest message the composer accepts.
const MAX_TEXT: usize = 16 * 1024;

/// People a group conversation may hold besides the creator.
///
/// Every member's every device joins the MLS group, so the real cost is
/// devices, not people. This is a deliberate ceiling on a one-to-many
/// chat; a community of hundreds belongs in a Space.
const MAX_GROUP_MEMBERS: usize = 64;

/// A conversation in the list.
#[derive(Debug, Clone, Serialize)]
pub struct ConversationView {
    /// MLS group id, hex.
    pub id: String,
    /// The other person, for a one-to-one conversation.
    pub peer: String,
    /// Everyone in the group, us included.
    pub members: Vec<String>,
    /// Group name; empty for a direct conversation.
    pub name: String,
    /// Whether this is a two-person conversation.
    pub direct: bool,
    /// Newest message time, ms; 0 when nothing has been said.
    pub last_at_ms: u64,
    /// Preview of the newest message.
    pub last_text: String,
    /// Incoming messages since it was last read.
    pub unread: u32,
}

/// Conversations, most recent first.
///
/// Only groups this account registered as chats. The messaging layer holds
/// a group for every private thing the account does — contact requests,
/// Circles, Spaces — and listing all of them filled Chats with rows for
/// people who never wrote and for groups that are not conversations.
#[tauri::command]
pub async fn chat_list(state: S<'_>) -> CmdResult<Vec<ConversationView>> {
    let key = state.db_key().await?;
    let index = state.db.chat_overview()?;
    let registered = state.db.chat_registered()?;
    let mut g = state.one.lock().await;
    let one = AppState::unlocked(&mut g)?;
    let me = one.address().to_owned();
    let groups = one.messaging.conversations();
    let mut out = Vec::new();
    for (id, kind, title) in registered {
        // A Space's conversation belongs to the Space, not to this list.
        if kind == "space" {
            continue;
        }
        // A group the messaging layer no longer has — left, or a vault
        // restored without it — is not listed. The row stays, so history
        // is still there if the group comes back.
        let Some((_, meta, members)) = groups.iter().find(|(gid, _, _)| *gid == id) else {
            continue;
        };
        let summary = index.iter().find(|s| s.group_id == id);
        let last = match summary {
            Some(_) => state.db.chat_page(&key, &id, 0, 1)?.pop(),
            None => None,
        };
        let direct = kind == "direct" && (meta.direct || members.len() <= 2);
        out.push(ConversationView {
            peer: if direct {
                members
                    .iter()
                    .find(|m| **m != me)
                    .cloned()
                    .unwrap_or_default()
            } else {
                String::new()
            },
            direct,
            name: if meta.name.is_empty() {
                title
            } else {
                meta.name.clone()
            },
            members: members.clone(),
            last_at_ms: summary.map(|s| s.last_at_ms).unwrap_or(0),
            last_text: last.map(|m| m.text).unwrap_or_default(),
            unread: summary.map(|s| s.unread).unwrap_or(0),
            id,
        });
    }
    out.sort_by_key(|c| std::cmp::Reverse(c.last_at_ms));
    Ok(out)
}

/// Opens the conversation with one address, creating it if there is none.
#[tauri::command]
pub async fn chat_open(state: S<'_>, address: String) -> CmdResult<String> {
    let address = address.trim().to_owned();
    if !address.starts_with("hash1") {
        return Err(UiError::invalid("address"));
    }
    let id = {
        let mut g = state.one.lock().await;
        let one = AppState::unlocked(&mut g)?;
        if address == one.address() {
            return Err(UiError::invalid("that is your own address"));
        }
        let existing = one
            .messaging
            .conversations()
            .into_iter()
            .find(|(_, meta, members)| {
                (meta.direct || members.len() <= 2) && members.contains(&address)
            })
            .map(|(id, _, _)| id);
        match existing {
            Some(id) => id,
            None => {
                let (link, chain, network) =
                    (one.link.clone(), one.chain.clone(), one.network.clone());
                let gid = one
                    .messaging
                    .create_conversation(&link, &chain, &network, "", &[address])
                    .await?;
                one.save()?;
                hex::encode(gid)
            }
        }
    };
    state.db.chat_register(&id, "direct", "")?;
    Ok(id)
}

/// Starts a group conversation.
///
/// Every active device of every member joins, which is what lets a group
/// be read on someone's phone as well as their PC. A group is an MLS group
/// like a one-to-one chat; the differences are a name and more people.
#[tauri::command]
pub async fn chat_create_group(
    state: S<'_>,
    name: String,
    members: Vec<String>,
) -> CmdResult<String> {
    let name = name.trim().to_owned();
    if name.chars().count() < 2 || name.chars().count() > 64 {
        return Err(UiError::invalid("a group name is 2 to 64 characters"));
    }
    let mut people: Vec<String> = Vec::new();
    for m in members {
        let m = m.trim().to_owned();
        if !m.starts_with("hash1") {
            return Err(UiError::invalid("every member needs a hash1 address"));
        }
        if !people.contains(&m) {
            people.push(m);
        }
    }
    if people.is_empty() {
        return Err(UiError::invalid("add at least one other person"));
    }
    if people.len() > MAX_GROUP_MEMBERS {
        return Err(UiError::invalid(format!(
            "a group holds up to {MAX_GROUP_MEMBERS} people"
        )));
    }
    let id = {
        let mut g = state.one.lock().await;
        let one = AppState::unlocked(&mut g)?;
        if people.iter().any(|p| p == one.address()) {
            return Err(UiError::invalid("you are already in your own group"));
        }
        let (link, chain, network) = (one.link.clone(), one.chain.clone(), one.network.clone());
        let gid = one
            .messaging
            .create_conversation(&link, &chain, &network, &name, &people)
            .await?;
        one.save()?;
        hex::encode(gid)
    };
    state.db.chat_register(&id, "group", &name)?;
    Ok(id)
}

/// Adds somebody to a group conversation.
#[tauri::command]
pub async fn chat_add_member(state: S<'_>, conversation: String, address: String) -> CmdResult<()> {
    let address = address.trim().to_owned();
    if !address.starts_with("hash1") {
        return Err(UiError::invalid("address"));
    }
    let gid = hex::decode(conversation.trim()).map_err(|_| UiError::invalid("conversation"))?;
    let mut g = state.one.lock().await;
    let one = AppState::unlocked(&mut g)?;
    let (link, chain, network) = (one.link.clone(), one.chain.clone(), one.network.clone());
    one.messaging
        .add_participant(&link, &chain, &network, &gid, &address)
        .await?;
    one.save()?;
    Ok(())
}

/// Leaves a conversation and stops listing it.
#[tauri::command]
pub async fn chat_leave(state: S<'_>, conversation: String) -> CmdResult<()> {
    let id = conversation.trim().to_ascii_lowercase();
    let gid = hex::decode(&id).map_err(|_| UiError::invalid("conversation"))?;
    {
        let mut g = state.one.lock().await;
        let one = AppState::unlocked(&mut g)?;
        let me = one.address().to_owned();
        let (link, network) = (one.link.clone(), one.network.clone());
        // Removing ourselves is how MLS says "I am gone": the others take
        // the commit and stop encrypting to this device.
        let _ = one
            .messaging
            .remove_participant(&link, &network, &gid, &me)
            .await;
        one.save()?;
    }
    state.db.chat_unregister(&id)?;
    Ok(())
}

/// One page of a conversation, oldest first.
#[tauri::command]
pub async fn chat_history(
    state: S<'_>,
    conversation: String,
    before_ms: Option<u64>,
    limit: Option<usize>,
) -> CmdResult<Vec<ChatRow>> {
    let key = state.db_key().await?;
    Ok(state.db.chat_page(
        &key,
        conversation.trim(),
        before_ms.unwrap_or(0),
        limit.unwrap_or(100).clamp(1, 500),
    )?)
}

/// Sends a message.
///
/// The message is written to the sealed history first, as `queued`, so it
/// appears at once and survives a crash; delivery then marks it `sent` or
/// leaves it queued for [`chat_flush`] to retry.
#[tauri::command]
pub async fn chat_send(state: S<'_>, conversation: String, text: String) -> CmdResult<ChatRow> {
    let text = text.trim().to_owned();
    if text.is_empty() {
        return Err(UiError::invalid("write something"));
    }
    if text.len() > MAX_TEXT {
        return Err(UiError::invalid("that message is too long"));
    }
    let gid_hex = conversation.trim().to_ascii_lowercase();
    let gid = hex::decode(&gid_hex).map_err(|_| UiError::invalid("conversation"))?;
    let key = state.db_key().await?;

    let mut g = state.one.lock().await;
    let one = AppState::unlocked(&mut g)?;
    let me = one.address().to_owned();
    let row = ChatRow {
        id: format!(
            "{}-{}",
            crate::util::now_ms(),
            &gid_hex[..8.min(gid_hex.len())]
        ),
        group_id: gid_hex.clone(),
        sender: me,
        at_ms: crate::util::now_ms(),
        outgoing: true,
        state: "queued".to_owned(),
        text: text.clone(),
    };
    state.db.chat_put(&key, &row)?;

    let (link, network) = (one.link.clone(), one.network.clone());
    match one.messaging.send_text(&link, &network, &gid, &text).await {
        Ok(_) => {
            one.save()?;
            state.db.chat_state(&row.id, "sent")?;
            Ok(ChatRow {
                state: "sent".to_owned(),
                ..row
            })
        }
        Err(e) => {
            // Offline is normal, not an error the user must act on: the
            // message stays queued and the next round tries again.
            tracing::debug!(error = %e, "chat message queued");
            Ok(row)
        }
    }
}

/// Retries everything still queued. Called after a sync round.
pub async fn flush_queue(state: &Arc<AppState>) -> usize {
    let Ok(key) = state.db_key().await else {
        return 0;
    };
    let Ok(queued) = state.db.chat_queued(&key) else {
        return 0;
    };
    if queued.is_empty() {
        return 0;
    }
    let mut g = state.one.lock().await;
    let Ok(one) = AppState::unlocked(&mut g) else {
        return 0;
    };
    let (link, network) = (one.link.clone(), one.network.clone());
    let mut sent = 0;
    for row in queued {
        let Ok(gid) = hex::decode(&row.group_id) else {
            let _ = state.db.chat_state(&row.id, "failed");
            continue;
        };
        if one
            .messaging
            .send_text(&link, &network, &gid, &row.text)
            .await
            .is_ok()
        {
            let _ = state.db.chat_state(&row.id, "sent");
            sent += 1;
        }
    }
    if sent > 0 {
        let _ = one.save();
    }
    sent
}

/// Retries the queue now (the Chats screen's "retry" button).
#[tauri::command]
pub async fn chat_flush(state: S<'_>) -> CmdResult<usize> {
    Ok(flush_queue(&state).await)
}

/// Marks a conversation read up to `at_ms`.
#[tauri::command]
pub async fn chat_mark_read(state: S<'_>, conversation: String, at_ms: u64) -> CmdResult<()> {
    state.db.chat_mark_read(conversation.trim(), at_ms)?;
    Ok(())
}

/// Searches this device's own chat history. The words never leave the PC:
/// the text is sealed on disk and decrypted here to match.
#[tauri::command]
pub async fn chat_search(
    state: S<'_>,
    query: String,
    limit: Option<usize>,
) -> CmdResult<Vec<ChatRow>> {
    let q = query.trim();
    if q.len() < 2 {
        return Ok(Vec::new());
    }
    let key = state.db_key().await?;
    Ok(state
        .db
        .chat_search(&key, q, limit.unwrap_or(50).clamp(1, 200))?)
}

/// Whether this account accepts conversations from `address`.
///
/// Phase one is `everyone` or `nobody`; the shape leaves room for
/// "people I follow" and "contacts" without changing any caller.
pub async fn may_chat_with(state: &Arc<AppState>, address: &str) -> bool {
    let policy = state.settings.read().await.social.who_can_chat.clone();
    match policy.as_str() {
        // Empty means the setting predates this build; that is "everyone",
        // not "refuse everything".
        "nobody" => false,
        _ => {
            // Blocking is separate from the policy and always wins.
            let mut g = state.one.lock().await;
            match AppState::unlocked(&mut g) {
                Ok(one) => !one.people().blocked().iter().any(|c| c.address == address),
                Err(_) => false,
            }
        }
    }
}

/// Stores an incoming chat line, or drops it.
///
/// This is where the privacy setting is enforced. A sender cannot talk
/// their way past it: their client is told nothing, the message is simply
/// not kept, and the sender's own screen will show it as delivered to a
/// mailbox that nobody read. The sender-side UI explains that plainly
/// rather than pretending the message arrived.
pub async fn accept_incoming(state: &Arc<AppState>, r: &Received) -> bool {
    if r.message.text.is_empty() {
        return false;
    }
    if !may_chat_with(state, &r.sender).await {
        tracing::debug!("incoming chat refused by this account's policy");
        return false;
    }
    let Ok(key) = state.db_key().await else {
        return false;
    };
    let row = ChatRow {
        id: if r.message.id.is_empty() {
            format!("{}-in", crate::util::now_ms())
        } else {
            r.message.id.clone()
        },
        group_id: r.group_id.clone(),
        sender: r.sender.clone(),
        at_ms: r.message.timestamp_ms,
        outgoing: false,
        state: "sent".to_owned(),
        text: r.message.text.clone(),
    };
    // Somebody writing to you is what makes a conversation exist, which is
    // why registration happens here and not when a group is created.
    let kind = conversation_kind(state, &r.group_id).await;
    let _ = state
        .db
        .chat_register(&r.group_id, kind, &r.message.group_name);
    state.db.chat_put(&key, &row).is_ok()
}

/// Whether a group is a one-to-one chat, a group chat or a Space's.
async fn conversation_kind(state: &Arc<AppState>, group_id: &str) -> &'static str {
    let mut g = state.one.lock().await;
    let Ok(one) = AppState::unlocked(&mut g) else {
        return "direct";
    };
    // A Space's group carries its posts and files as well as its chat; it
    // is the Space's, and must not turn up in Chats as a stray group.
    if one
        .spaces()
        .list()
        .map(|v| v.iter().any(|s| s.group_id == group_id))
        .unwrap_or(false)
    {
        return "space";
    }
    match one
        .messaging
        .conversations()
        .into_iter()
        .find(|(gid, _, _)| gid == group_id)
    {
        Some((_, meta, members)) if meta.direct || members.len() <= 2 => "direct",
        Some(_) => "group",
        None => "direct",
    }
}

/// How many conversations have unread messages (for the rail badge).
#[tauri::command]
pub async fn chat_unread(state: S<'_>) -> CmdResult<u32> {
    let rows: Vec<ChatSummaryRow> = state.db.chat_overview()?;
    Ok(rows.iter().filter(|r| r.unread > 0).count() as u32)
}
