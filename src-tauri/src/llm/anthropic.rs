//! Anthropic's Messages and Models APIs.

use super::{parse_draft, refusal, unreachable, Model, Provider, QueryDraft, Turn};
use crate::error::{AppError, Result};
use serde_json::{json, Value};

const API: &str = "https://api.anthropic.com/v1";
const VERSION: &str = "2023-06-01";
/// Room for the thinking that models with thinking always on do before answering.
const MAX_TOKENS: u32 = 16_000;

pub async fn models(http: &reqwest::Client, key: &str) -> Result<Vec<Model>> {
    let response = http
        .get(format!("{API}/models?limit=100"))
        .header("x-api-key", key)
        .header("anthropic-version", VERSION)
        .send()
        .await
        .map_err(|error| unreachable(Provider::Anthropic, error))?;
    if !response.status().is_success() {
        return Err(refusal(Provider::Anthropic, response).await);
    }
    let body: Value = response.json().await.map_err(|error| unreachable(Provider::Anthropic, error))?;
    Ok(listed(&body))
}

/// The listed models, newest first as Anthropic lists them, with the newest
/// Sonnet recommended.
fn listed(body: &Value) -> Vec<Model> {
    let mut models: Vec<Model> = body["data"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|model| {
            let id = model["id"].as_str()?.to_string();
            let name = model["display_name"].as_str().unwrap_or(&id).to_string();
            Some(Model { id, name, recommended: false })
        })
        .collect();
    let pick = models.iter().position(|model| model.id.contains("sonnet")).or(if models.is_empty() {
        None
    } else {
        Some(0)
    });
    if let Some(index) = pick {
        let mut recommended = models.remove(index);
        recommended.recommended = true;
        models.insert(0, recommended);
    }
    models
}

pub async fn draft(http: &reqwest::Client, key: &str, model: &str, system: &str, turns: &[Turn]) -> Result<QueryDraft> {
    let messages: Vec<Value> = turns
        .iter()
        .map(|turn| json!({ "role": if turn.from_model { "assistant" } else { "user" }, "content": turn.text }))
        .collect();
    let mut request = json!({
        "model": model,
        "max_tokens": MAX_TOKENS,
        "system": system,
        "messages": messages,
        "output_config": { "format": { "type": "json_schema", "schema": super::prompt::draft_schema() } },
    });

    let mut response = send(http, key, &request).await?;
    if response.status() == reqwest::StatusCode::BAD_REQUEST {
        let refused = refusal(Provider::Anthropic, response).await;
        if !refused.to_string().contains("output_config") {
            return Err(refused);
        }
        // Models older than structured outputs answer in JSON from the prompt alone.
        request.as_object_mut().expect("request is an object").remove("output_config");
        request["system"] = json!(format!("{system}\n\nAnswer with only a JSON object holding `title`, `query`, and `summary`."));
        response = send(http, key, &request).await?;
    }
    if !response.status().is_success() {
        return Err(refusal(Provider::Anthropic, response).await);
    }
    let body: Value = response.json().await.map_err(|error| unreachable(Provider::Anthropic, error))?;
    let text: String = body["content"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|block| block["type"] == "text")
        .filter_map(|block| block["text"].as_str())
        .collect();
    let object = json_object(&text).ok_or_else(|| AppError::new("Anthropic answered without a query."))?;
    parse_draft(Provider::Anthropic, &Value::String(object.to_string()))
}

async fn send(http: &reqwest::Client, key: &str, request: &Value) -> Result<reqwest::Response> {
    http.post(format!("{API}/messages"))
        .header("x-api-key", key)
        .header("anthropic-version", VERSION)
        .json(request)
        .send()
        .await
        .map_err(|error| unreachable(Provider::Anthropic, error))
}

/// The outermost JSON object in `text`, which a model may fence or introduce.
fn json_object(text: &str) -> Option<&str> {
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    (start < end).then(|| &text[start..=end])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_newest_sonnet_is_recommended_and_listed_first() {
        let body = json!({ "data": [
            { "id": "claude-opus-9", "display_name": "Claude Opus 9" },
            { "id": "claude-sonnet-9", "display_name": "Claude Sonnet 9" },
            { "id": "claude-sonnet-8", "display_name": "Claude Sonnet 8" },
        ]});
        let ids: Vec<(String, bool)> = listed(&body).into_iter().map(|model| (model.id, model.recommended)).collect();
        assert_eq!(
            ids,
            [
                ("claude-sonnet-9".to_string(), true),
                ("claude-opus-9".to_string(), false),
                ("claude-sonnet-8".to_string(), false),
            ]
        );
    }

    #[test]
    fn a_fenced_answer_yields_its_object() {
        assert_eq!(json_object("```json\n{\"a\": {\"b\": 1}}\n```"), Some("{\"a\": {\"b\": 1}}"));
        assert_eq!(json_object("no object here"), None);
    }

    #[test]
    fn without_a_sonnet_the_newest_model_is_recommended() {
        let body = json!({ "data": [{ "id": "claude-opus-9" }, { "id": "claude-haiku-9" }] });
        let models = listed(&body);
        assert!(models[0].recommended && models[0].id == "claude-opus-9");
        assert_eq!(models[0].name, "claude-opus-9");
    }
}
