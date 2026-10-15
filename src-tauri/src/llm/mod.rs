//! Writing section queries from a description, with the user's own Anthropic
//! or OpenAI key.

mod anthropic;
mod keys;
mod openai;
mod prompt;

use crate::error::{AppError, Result};
use crate::types::GlobalFilter;
use serde::{Deserialize, Serialize};

pub use keys::{forget_key, has_key, store_key};
pub use prompt::Request;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Anthropic,
    Openai,
}

impl Provider {
    pub const ALL: [Provider; 2] = [Provider::Anthropic, Provider::Openai];

    pub fn name(self) -> &'static str {
        match self {
            Provider::Anthropic => "Anthropic",
            Provider::Openai => "OpenAI",
        }
    }
}

/// Whether a provider's API key is in the Keychain.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyState {
    pub provider: Provider,
    pub stored: bool,
}

/// A model a provider offers for writing queries.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Model {
    pub id: String,
    pub name: String,
    /// The model offered first when the user has not chosen one.
    pub recommended: bool,
}

/// What a section's query should be, as a model wrote it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryDraft {
    /// A short section title for the query.
    pub title: String,
    pub query: String,
    /// One sentence on what the query finds.
    pub summary: String,
}

/// One message of a conversation with a model.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Turn {
    pub from_model: bool,
    pub text: String,
}

/// The models `provider` offers for writing queries, the recommended one first.
pub async fn models(http: &reqwest::Client, provider: Provider) -> Result<Vec<Model>> {
    let key = keys::key(provider)?;
    match provider {
        Provider::Anthropic => anthropic::models(http, &key).await,
        Provider::Openai => openai::models(http, &key).await,
    }
}

/// Asks `model` for the query the conversation in `request` calls for, retrying with the compile
/// error while what it writes does not compile.
pub async fn write_query(
    http: &reqwest::Client,
    provider: Provider,
    model: &str,
    request: &prompt::Request,
    global_filters: &[GlobalFilter],
) -> Result<QueryDraft> {
    let key = keys::key(provider)?;
    let system = prompt::system();
    let mut turns = prompt::conversation(request)?;

    for _ in 0..prompt::ATTEMPTS {
        let draft = match provider {
            Provider::Anthropic => anthropic::draft(http, &key, model, &system, &turns).await?,
            Provider::Openai => openai::draft(http, &key, model, &system, &turns).await?,
        };
        match crate::query::plan(&draft.query, global_filters) {
            Ok(_) => return Ok(draft),
            Err(error) => {
                turns.push(Turn { from_model: true, text: serde_json::to_string(&draft).expect("draft serializes") });
                turns.push(Turn { from_model: false, text: prompt::retry(&error.to_string()) });
            }
        }
    }

    Err(AppError::new(format!(
        "{} could not write a query that compiles. Try describing it differently.",
        provider.name()
    )))
}

/// The error a provider's HTTP response carries, as a sentence for the user.
async fn refusal(provider: Provider, response: reqwest::Response) -> AppError {
    let status = response.status();
    let body: serde_json::Value = response.json().await.unwrap_or_default();
    let detail = body["error"]["message"].as_str().unwrap_or("no detail given").to_string();
    match status.as_u16() {
        401 | 403 => AppError::new(format!("{} refused the API key: {detail}", provider.name())),
        _ => AppError::new(format!("{} answered {status}: {detail}", provider.name())),
    }
}

fn unreachable(provider: Provider, error: reqwest::Error) -> AppError {
    AppError::new(format!("Could not reach {}: {error}", provider.name()))
}

/// The draft a model returned as JSON text or as tool input.
fn parse_draft(provider: Provider, value: &serde_json::Value) -> Result<QueryDraft> {
    let parsed = match value {
        serde_json::Value::String(text) => serde_json::from_str(text),
        other => serde_json::from_value(other.clone()),
    };
    parsed.map_err(|error| AppError::new(format!("{} answered in an unexpected shape: {error}", provider.name())))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn crows() -> QueryDraft {
        QueryDraft { title: "Mine".into(), query: "author:@me".into(), summary: "Yours.".into() }
    }

    #[test]
    fn a_draft_reads_from_tool_input() {
        let input = json!({ "title": "Mine", "query": "author:@me", "summary": "Yours." });
        assert_eq!(parse_draft(Provider::Anthropic, &input).unwrap(), crows());
    }

    #[test]
    fn a_draft_reads_from_json_text() {
        let text = json!(r#"{"title":"Mine","query":"author:@me","summary":"Yours."}"#);
        assert_eq!(parse_draft(Provider::Openai, &text).unwrap(), crows());
    }

    #[test]
    fn a_draft_missing_its_query_names_the_provider() {
        let error = parse_draft(Provider::Openai, &json!({ "title": "Mine" })).unwrap_err();
        assert!(error.to_string().starts_with("OpenAI answered in an unexpected shape"));
    }
}
