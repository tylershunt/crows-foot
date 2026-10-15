//! OpenAI's Chat Completions and Models APIs.

use super::{parse_draft, refusal, unreachable, Model, Provider, QueryDraft, Turn};
use crate::error::{AppError, Result};
use serde_json::{json, Value};

const API: &str = "https://api.openai.com/v1";

/// Words in the ids of models that do not answer a chat in text.
const NOT_FOR_CHAT: &[&str] = &[
    "audio", "realtime", "tts", "transcribe", "image", "search", "embedding", "instruct", "moderation", "dall-e",
    "whisper", "codex", "computer-use", "deep-research",
];

pub async fn models(http: &reqwest::Client, key: &str) -> Result<Vec<Model>> {
    let response = http
        .get(format!("{API}/models"))
        .bearer_auth(key)
        .send()
        .await
        .map_err(|error| unreachable(Provider::Openai, error))?;
    if !response.status().is_success() {
        return Err(refusal(Provider::Openai, response).await);
    }
    let body: Value = response.json().await.map_err(|error| unreachable(Provider::Openai, error))?;
    Ok(listed(&body))
}

/// The chat models listed, newest first, with the newest undated flagship GPT
/// recommended.
fn listed(body: &Value) -> Vec<Model> {
    let mut models: Vec<(i64, Model)> = body["data"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|model| {
            let id = model["id"].as_str()?;
            if !for_chat(id) {
                return None;
            }
            let created = model["created"].as_i64().unwrap_or(0);
            Some((created, Model { id: id.to_string(), name: id.to_string(), recommended: false }))
        })
        .collect();
    models.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.id.cmp(&b.1.id)));
    let mut models: Vec<Model> = models.into_iter().map(|(_, model)| model).collect();

    let pick = models.iter().position(|model| flagship(&model.id)).or(if models.is_empty() { None } else { Some(0) });
    if let Some(index) = pick {
        let mut recommended = models.remove(index);
        recommended.recommended = true;
        models.insert(0, recommended);
    }
    models
}

fn for_chat(id: &str) -> bool {
    let family = id.starts_with("gpt-")
        || id.starts_with("chatgpt-")
        || (id.starts_with('o') && id[1..].starts_with(|character: char| character.is_ascii_digit()));
    family && !NOT_FOR_CHAT.iter().any(|word| id.contains(word))
}

/// `gpt-` and a version alone, such as `gpt-5` or `gpt-4.1`: no size, date, or variant.
fn flagship(id: &str) -> bool {
    id.strip_prefix("gpt-").is_some_and(|version| {
        let version = version.strip_suffix('o').unwrap_or(version);
        !version.is_empty() && version.chars().all(|character| character.is_ascii_digit() || character == '.')
    })
}

pub async fn draft(http: &reqwest::Client, key: &str, model: &str, system: &str, turns: &[Turn]) -> Result<QueryDraft> {
    let mut messages = vec![json!({ "role": "system", "content": system })];
    messages.extend(
        turns
            .iter()
            .map(|turn| json!({ "role": if turn.from_model { "assistant" } else { "user" }, "content": turn.text })),
    );
    let request = json!({
        "model": model,
        "messages": messages,
        "response_format": {
            "type": "json_schema",
            "json_schema": { "name": "query_draft", "strict": true, "schema": super::prompt::draft_schema() },
        },
    });

    let response = http
        .post(format!("{API}/chat/completions"))
        .bearer_auth(key)
        .json(&request)
        .send()
        .await
        .map_err(|error| unreachable(Provider::Openai, error))?;
    if !response.status().is_success() {
        return Err(refusal(Provider::Openai, response).await);
    }
    let body: Value = response.json().await.map_err(|error| unreachable(Provider::Openai, error))?;
    let message = &body["choices"][0]["message"];
    if let Some(refused) = message["refusal"].as_str() {
        return Err(AppError::new(format!("OpenAI declined: {refused}")));
    }
    let content = message.get("content").filter(|content| content.is_string());
    parse_draft(Provider::Openai, content.ok_or_else(|| AppError::new("OpenAI answered without a query."))?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_chat_models_are_listed_newest_first_with_the_flagship_recommended() {
        let body = json!({ "data": [
            { "id": "gpt-9-mini", "created": 30 },
            { "id": "gpt-9", "created": 20 },
            { "id": "gpt-9-realtime", "created": 40 },
            { "id": "text-embedding-3-large", "created": 50 },
            { "id": "o7", "created": 10 },
            { "id": "omni-moderation-latest", "created": 60 },
        ]});
        let ids: Vec<(String, bool)> = listed(&body).into_iter().map(|model| (model.id, model.recommended)).collect();
        assert_eq!(
            ids,
            [("gpt-9".to_string(), true), ("gpt-9-mini".to_string(), false), ("o7".to_string(), false)]
        );
    }

    #[test]
    fn a_flagship_is_gpt_and_a_version_alone() {
        assert!(flagship("gpt-5") && flagship("gpt-4.1") && flagship("gpt-4o"));
        assert!(!flagship("gpt-5-mini") && !flagship("gpt-4o-2024-08-06") && !flagship("gpt-"));
    }
}
