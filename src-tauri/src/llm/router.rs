//! Corvic's hosted LLM router: OpenAI's Chat Completions and Models APIs,
//! billed to a room the key's organization owns.

use super::{Model, QueryDraft, Turn};
use crate::error::{AppError, Result};
use serde_json::{json, Value};

/// The production router. `CROWS_FOOT_LLM_ROUTER_URL` names another, such as a
/// development deployment's.
const PRODUCTION: &str = "https://api.corvic.ai/v1/llm";
const ROOM_HEADER: &str = "X-Corvic-Room-Id";
/// The most output the router allows a completion.
const MAX_TOKENS: u32 = 4096;

fn base() -> String {
    std::env::var("CROWS_FOOT_LLM_ROUTER_URL").unwrap_or_else(|_| PRODUCTION.to_string())
}

pub async fn models(http: &reqwest::Client, key: &str, room_id: &str) -> Result<Vec<Model>> {
    let response = http
        .get(format!("{}/models", base()))
        .bearer_auth(key)
        .header(ROOM_HEADER, room_id.trim())
        .send()
        .await
        .map_err(unreachable)?;
    if !response.status().is_success() {
        return Err(refusal(response).await);
    }
    let body: Value = response.json().await.map_err(unreachable)?;
    Ok(listed(&body))
}

fn listed(body: &Value) -> Vec<Model> {
    body["data"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|model| {
            Some(Model { id: model["id"].as_str()?.to_string(), organization: model["owned_by"] == "organization" })
        })
        .collect()
}

pub async fn draft(
    http: &reqwest::Client,
    key: &str,
    room_id: &str,
    model: Option<&str>,
    system: &str,
    turns: &[Turn],
) -> Result<QueryDraft> {
    let mut messages = vec![json!({ "role": "system", "content": system })];
    messages.extend(
        turns
            .iter()
            .map(|turn| json!({ "role": if turn.from_model { "assistant" } else { "user" }, "content": turn.text })),
    );
    let mut request = json!({
        "messages": messages,
        "max_tokens": MAX_TOKENS,
        "response_format": {
            "type": "json_schema",
            "json_schema": { "name": "query_draft", "strict": true, "schema": super::prompt::draft_schema() },
        },
    });
    if let Some(model) = model {
        request["model"] = json!(model);
    }

    let response = http
        .post(format!("{}/chat/completions", base()))
        .bearer_auth(key)
        .header(ROOM_HEADER, room_id.trim())
        .json(&request)
        .send()
        .await
        .map_err(unreachable)?;
    if !response.status().is_success() {
        return Err(refusal(response).await);
    }
    let body: Value = response.json().await.map_err(unreachable)?;
    let content = body["choices"][0]["message"]["content"].as_str().unwrap_or_default();
    parse_draft(content)
}

/// The draft in a model's answer, which it may fence or introduce.
fn parse_draft(content: &str) -> Result<QueryDraft> {
    let object = match (content.find('{'), content.rfind('}')) {
        (Some(start), Some(end)) if start < end => &content[start..=end],
        _ => return Err(AppError::new("The model answered without a query.")),
    };
    serde_json::from_str(object).map_err(|error| AppError::new(format!("The model answered in an unexpected shape: {error}")))
}

/// The router's refusal as a sentence for the user.
async fn refusal(response: reqwest::Response) -> AppError {
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    let detail = detail(&serde_json::from_str(&text).unwrap_or(Value::String(text)));
    match status.as_u16() {
        401 | 403 => AppError::new(format!("The Corvic LLM router refused the API key: {detail}")),
        404 => AppError::new(format!("The Corvic LLM router could not find the room: {detail}")),
        _ => AppError::new(format!("The Corvic LLM router answered {status}: {detail}")),
    }
}

/// FastAPI's `detail`, as a string or a `google.rpc.Status`, OpenAI's
/// `error.message`, or the gateway's plain text.
fn detail(body: &Value) -> String {
    [&body["detail"], &body["detail"]["message"], &body["error"]["message"], &body["message"], body]
        .into_iter()
        .find_map(Value::as_str)
        .filter(|detail| !detail.trim().is_empty())
        .unwrap_or("no detail given")
        .to_string()
}

fn unreachable(error: reqwest::Error) -> AppError {
    AppError::new(format!("Could not reach the Corvic LLM router: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn listed_models_keep_their_ids_and_mark_the_organizations_own() {
        let body = json!({ "object": "list", "data": [
            { "id": "claude-sonnet", "owned_by": "corvic" },
            { "id": "cm_123", "owned_by": "organization" },
        ]});
        assert_eq!(
            listed(&body),
            [
                Model { id: "claude-sonnet".into(), organization: false },
                Model { id: "cm_123".into(), organization: true },
            ]
        );
    }

    #[test]
    fn a_draft_reads_from_a_fenced_answer() {
        let draft = parse_draft("```json\n{\"title\":\"Mine\",\"query\":\"author:@me\",\"summary\":\"Yours.\"}\n```").unwrap();
        assert_eq!(draft.query, "author:@me");
    }

    #[test]
    fn an_answer_without_an_object_is_refused() {
        assert_eq!(parse_draft("no").unwrap_err().to_string(), "The model answered without a query.");
    }

    #[test]
    fn a_refusal_reads_its_detail_from_fastapi_openai_or_plain_text() {
        assert_eq!(detail(&json!({ "detail": "room not found" })), "room not found");
        assert_eq!(detail(&json!({ "detail": { "code": 7, "message": "denied" } })), "denied");
        assert_eq!(detail(&json!({ "error": { "message": "bad" } })), "bad");
        assert_eq!(detail(&json!("RBAC: access denied")), "RBAC: access denied");
        assert_eq!(detail(&json!("")), "no detail given");
    }
}
