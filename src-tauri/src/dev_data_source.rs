use serde_json::Value;
use std::time::Duration;

// Backs the Tauri-only "read from the deployed web app instead of local D1" dev toggle (see
// src/api/dev-data-source.ts) - a plain cross-origin fetch() to this origin from the webview hits
// a CORS failure (worker/index.ts sets no Access-Control-Allow-Origin on any /api/* route), the
// same root cause board_assets.rs's fetch_spawn_points already works around by going through
// Rust/reqwest instead, which has no such restriction. These two commands are a deliberately dumb
// passthrough (no endpoint-specific logic) since every affected endpoint is a plain JSON GET/POST.
const WORKER_ORIGIN: &str = "https://tacops.cpunerd.workers.dev";

fn build_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))
}

#[tauri::command]
pub async fn proxy_worker_get(path: String) -> Result<Value, String> {
    let url = format!("{WORKER_ORIGIN}{path}");
    let client = build_client()?;
    let res = client.get(&url).send().await.map_err(|e| format!("request to {url} failed: {e}"))?;
    let status = res.status();
    if !status.is_success() {
        return Err(format!("{url} returned HTTP {status}"));
    }
    res.json::<Value>().await.map_err(|e| format!("failed to parse JSON response from {url}: {e}"))
}

#[tauri::command]
pub async fn proxy_worker_post(path: String, body: Value) -> Result<Value, String> {
    let url = format!("{WORKER_ORIGIN}{path}");
    let client = build_client()?;
    let res = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("request to {url} failed: {e}"))?;
    let status = res.status();
    if !status.is_success() {
        return Err(format!("{url} returned HTTP {status}"));
    }
    res.json::<Value>().await.map_err(|e| format!("failed to parse JSON response from {url}: {e}"))
}
