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
#[tauri::command]
pub async fn chat_list(state: S<'_>) -> CmdResult<Vec<ConversationView>> {
    let key = state.db_key().await?;
    let index = state.db.chat_overview()?;
    let mut g = state.one.lock().await;
    let one = AppState::unlocked(&mut g)?;
    let me = one.address().to_owned();
    let mut out = Vec::new();
    for (id, meta, members) in one.messaging.conversations() {
        let summary = index.iter().find(|s| s.group_id == id);
        let last = match summary {
            Some(_) => state.db.chat_page(&key, &id, 0, 1)?.pop(),
            None => None,
        };
        out.push(ConversationView {
            peer: members
                .iter()
                .find(|m| **m != me)
                .cloned()
                .unwrap_or_default(),
            direct: meta.direct || members.len() <= 2,
            name: meta.name.clone(),
            members,
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
    let mut g = state.one.lock().await;
    let one = AppState::unlocked(&mut g)?;
    let me = one.address().to_owned();
    if address == me {
        return Err(UiError::invalid("that is your own address"));
    }
    if let Some((id, _, _)) =
        one.messaging
            .conversations()
            .into_iter()
            .find(|(_, meta, members)| {
                (meta.direct || members.len() <= 2) && members.contains(&address)
            })
    {
        return Ok(id);
    }
    let (link, chain, network) = (one.link.clone(), one.chain.clone(), one.network.clone());
    let gid = one
        .messaging
        .create_conversation(&link, &chain, &network, "", &[address])
        .await?;
    one.save()?;
    Ok(hex::encode(gid))
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
    state.db.chat_put(&key, &row).is_ok()
}

/// How many conversations have unread messages (for the rail badge).
#[tauri::command]
pub async fn chat_unread(state: S<'_>) -> CmdResult<u32> {
    let rows: Vec<ChatSummaryRow> = state.db.chat_overview()?;
    Ok(rows.iter().filter(|r| r.unread > 0).count() as u32)
}
