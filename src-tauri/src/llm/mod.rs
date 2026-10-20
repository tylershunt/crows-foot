//! Writing section queries from a conversation, through Corvic's hosted LLM
//! router with the user's Corvic API key.

mod keys;
mod prompt;
mod router;

use crate::error::{AppError, Result};
use crate::types::GlobalFilter;
use serde::{Deserialize, Serialize};

pub use keys::{forget_key, has_key, store_key};
pub use prompt::Request;

/// A model the router offers the room.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Model {
    pub id: String,
    /// Whether the room's own organization defined the model.
    pub organization: bool,
}

/// What a section's query should be, as a model wrote it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryDraft {
    /// A short section title for the query.
    pub title: String,
    pub query: String,
    /// The model's reply, on what the query finds or what changed.
    pub summary: String,
}

/// One message of a conversation with a model.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Turn {
    pub from_model: bool,
    pub text: String,
}

/// The models the router offers `room_id`.
pub async fn models(http: &reqwest::Client, room_id: &str) -> Result<Vec<Model>> {
    router::models(http, &keys::key()?, room_id).await
}

/// Asks the router for the query the conversation in `request` calls for,
/// retrying with the compile error while what the model writes does not
/// compile. `model` is the room's default when None.
pub async fn write_query(
    http: &reqwest::Client,
    room_id: &str,
    model: Option<&str>,
    request: &Request,
    global_filters: &[GlobalFilter],
) -> Result<QueryDraft> {
    let key = keys::key()?;
    let system = prompt::system();
    let mut turns = prompt::conversation(request)?;

    for _ in 0..prompt::ATTEMPTS {
        let draft = router::draft(http, &key, room_id, model, &system, &turns).await?;
        match crate::query::plan(&draft.query, global_filters) {
            Ok(_) => return Ok(draft),
            Err(error) => {
                turns.push(Turn { from_model: true, text: serde_json::to_string(&draft).expect("draft serializes") });
                turns.push(Turn { from_model: false, text: prompt::retry(&error.to_string()) });
            }
        }
    }

    Err(AppError::new("The model could not write a query that compiles. Try describing it differently."))
}
