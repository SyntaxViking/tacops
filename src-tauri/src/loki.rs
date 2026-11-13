use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::time::{SystemTime, UNIX_EPOCH};

// Confirmed via real Proxyman captures: the actual game client reuses this exact trio unchanged
// across APP_START, CONNECT, and GET_PLAYER in the same session - not re-derived per call. Same
// values on both prod and QA. Refreshed 2026-09-18 from a fresh prod capture (only prod - QA's
// value is assumed unchanged, not independently reconfirmed this time).
pub(crate) const GAME_CONFIG_VERSION: &str = "39544f90b23c604016f7549b4561719a";
pub(crate) const MULTI_CONFIG_VERSION: &str = "baa3abeef58d35f24dfb0ee70b15f130";
pub(crate) const INSTALL_ID: &str = "scraper-installid";

// The fields below this line come straight from a real captured QA CONNECT request and differ
// from prod. Device/hardware fingerprint fields (os, model, screen size, graphics, ram, ...)
// are deliberately left as generic scraper values on both environments instead of mirrored from
// that capture - prod already works fine with fully fake device data, so there's no evidence the
// backend validates them.
pub(crate) struct EnvironmentConfig {
    base_url: &'static str,
    // Same host/session as base_url's player/player2 tree, but game-event calls (GET_CRUSADE,
    // GET_GUILD_STATE and friends) live under a different path and carry an anti-tamper MD5
    // digest in their own signed envelope - see crusades.rs.
    pub(crate) game_event_base_url: &'static str,
    // The realtime channel push service (guild chat / guild events) — the bare host (wss on 443).
    // Auth is userId + sessionId sent as websocket handshake HEADERS, not in the URL path. The
    // handshake is done by hand (see guild_chat.rs) so the header names keep their exact camelCase,
    // which is why this is a host rather than a full URL.
    pub(crate) websocket_host: &'static str,
    environment_id: &'static str,
    bundle_id: &'static str,
    jenkins_build_branch_info: &'static str,
    pub(crate) built_in_multi_config_version: &'static str,
}

const PROD_CONFIG: EnvironmentConfig = EnvironmentConfig {
    base_url: "https://api-live.loki.snowprintstudios.com/player/player2/userId",
    game_event_base_url: "https://api-live.loki.snowprintstudios.com/game-event/game3/userId",
    websocket_host: "websocket-live.loki.snowprintstudios.com",
    environment_id: "live-loki",
    bundle_id: "com.snowprintstudios.tacticus",
    jenkins_build_branch_info: "release",
    // Refreshed 2026-09-18 from a fresh prod capture.
    built_in_multi_config_version: "70bbe6c887f27cd4143ced37954a1fad",
};

// game_event_base_url here is derived by analogy with prod (same api-staging host, same
// player/player2 -> game-event/game3 swap) - unconfirmed by a real QA capture, unlike everything
// else in this file.
const QA_CONFIG: EnvironmentConfig = EnvironmentConfig {
    base_url: "https://api-staging.loki.snowprintstudios.com/player/player2/userId",
    game_event_base_url: "https://api-staging.loki.snowprintstudios.com/game-event/game3/userId",
    websocket_host: "websocket-staging.loki.snowprintstudios.com",
    environment_id: "staging-loki",
    bundle_id: "com.snowprintstudios.loki.qa",
    jenkins_build_branch_info: "staging",
    built_in_multi_config_version: "34c80d71f65bd74deb6ba74f01d1c725",
};

pub(crate) fn environment_config(environment: &str) -> Result<&'static EnvironmentConfig, String> {
    match environment {
        "prod" => Ok(&PROD_CONFIG),
        "qa" => Ok(&QA_CONFIG),
        other => Err(format!("Unknown environment: {other}")),
    }
}

pub(crate) fn now_ms() -> String {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis().to_string()
}

// Privacy-preserving usage tracking: only a SHA-256 hash of userId ever leaves this machine for
// this, never the raw id. Fire-and-forget on a detached task so a slow/failed tracking call can
// never delay or fail the actual player-data fetch the user is waiting on.
fn track_usage(user_id: &str) {
    let mut hasher = Sha256::new();
    hasher.update(user_id.as_bytes());
    let user_hash = format!("{:x}", hasher.finalize());
    tauri::async_runtime::spawn(async move {
        let client = reqwest::Client::new();
        let _ = client
            .post("https://tacops.cpunerd.workers.dev/api/track")
            .header("Content-Type", "application/json")
            .json(&json!({ "userHash": user_hash }))
            .send()
            .await;
    });
}

pub(crate) fn envelope(player_event_type: &str, player_event_data: Value, config: &EnvironmentConfig) -> Value {
    json!({
        "playerEvent": {
            "playerEventType": player_event_type,
            "playerEventData": player_event_data,
            "universeVersion": "universe_not_needed",
            "gameConfigVersion": GAME_CONFIG_VERSION,
            "createdOn": now_ms(),
            "multiConfigVersion": MULTI_CONFIG_VERSION,
        },
        "builtInMultiConfigVersion": config.built_in_multi_config_version,
        "installId": INSTALL_ID,
    })
}

pub(crate) async fn post(client: &reqwest::Client, url: &str, body: &Value) -> Result<Value, String> {
    let res = client
        .post(url)
        .header("Content-Type", "application/json")
        .json(body)
        .send()
        .await
        .map_err(|e| format!("request to {url} failed: {e}"))?;

    let status = res.status();
    let text = res.text().await.map_err(|e| format!("failed reading response body from {url}: {e}"))?;
    if !status.is_success() {
        let snippet = &text[..text.len().min(300)];
        return Err(format!("{url} returned HTTP {status}: {snippet}"));
    }
    let parsed: Value =
        serde_json::from_str(&text).map_err(|e| format!("failed to parse JSON response from {url}: {e}"))?;

    // HTTP 200 doesn't guarantee app-level success - surface eventResult failures explicitly
    // rather than letting a downstream call fail confusingly on missing data.
    if parsed["eventResult"]["eventResultType"] != "SUCCESS" {
        return Err(format!("{url} returned an application error: {parsed}"));
    }
    Ok(parsed)
}

// Without an explicit timeout, reqwest waits forever on a stalled connection - a real request
// that just hung was reported to hang the whole app, since nothing here ever gave up.
pub(crate) fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))
}

// APP_START -> CONNECT, matching the real client's boot sequence (confirmed via Proxyman
// capture). CONNECT exchanges the account's clientSecret/snowId for a sessionId; every call
// after that uses the sessionId-suffixed URL. Shared by every command that needs a session
// (GET_PLAYER, GET_CRUSADE, GET_LEADERBOARD_2, guild chat, ...) since the sessionId is valid
// across both the player/player2 and game-event/game3 URL trees, not just the one it was minted
// under.
pub(crate) async fn connect(
    client: &reqwest::Client,
    config: &EnvironmentConfig,
    user_id: &str,
    client_secret: &str,
    snow_id: &str,
) -> Result<String, String> {
    let base_url = format!("{}/{user_id}", config.base_url);

    let app_start_body = envelope(
        "APP_START",
        json!({
            "appId": "loki",
            "apiVersion": "0.1",
            "os": "Linux",
            "deviceType": "server",
            "deviceName": "scraper",
            "deviceId": "scraper",
            "locale": "en_US",
            "userId": user_id,
            "appVersion": "1.43.157.2989",
            "universeVersion": "universe_not_needed",
            "installId": INSTALL_ID,
            "platform": "Linux",
            "store": "Server",
            "countryCode": "US",
        }),
        config,
    );
    post(client, &base_url, &app_start_body).await?;

    let mut connect_data = json!({
        "userId": user_id,
        "clientSecret": client_secret,
        "deviceData": {
            "installId": INSTALL_ID,
            "deviceId": "scraper",
            "countryCode": "US",
            "locale": "en_US",
            "manufacturer": "scraper",
            "model": "scraper",
            "os": "Linux",
            "buildString": "1.43.157.2989",
            "screenWidth": 1920,
            "screenHeight": 1080,
            "platform": "Linux",
            "store": "Server",
            "distribution": "Desktop",
            "ram": 8192,
            "environmentId": config.environment_id,
            "jenkinsBuildBranchInfo": config.jenkins_build_branch_info,
            "bundleId": config.bundle_id,
            "graphicsDeviceName": "None",
            "graphicsShaderLevel": 0,
            "graphicsMemorySize": 0,
            "processorType": "scraper",
            "supportedTextureFormats": "None",
        }
    });
    // QA's credentials file has no snowId at all, and a real captured QA CONNECT request omits
    // the field entirely rather than sending it empty - match that instead of sending "".
    if !snow_id.is_empty() {
        connect_data["snowId"] = json!(snow_id);
    }
    let connect_body = envelope("CONNECT", connect_data, config);
    let connect_response = post(client, &base_url, &connect_body).await?;
    connect_response["eventResult"]["eventResponseData"]["userData"]["sessionId"]
        .as_str()
        .ok_or_else(|| "CONNECT response didn't contain a sessionId - is clientSecret/snowId correct?".to_string())
        .map(|s| s.to_string())
}

// Convenience over connect() for commands that only need a session: resolves the environment,
// and hands back the config plus the userId-suffixed base URL alongside the sessionId.
pub(crate) async fn bootstrap_session(
    client: &reqwest::Client,
    environment: &str,
    user_id: &str,
    client_secret: &str,
    snow_id: &str,
) -> Result<(&'static EnvironmentConfig, String, String), String> {
    let config = environment_config(environment)?;
    let base_url = format!("{}/{user_id}", config.base_url);
    let session_id = connect(client, config, user_id, client_secret, snow_id).await?;
    Ok((config, base_url, session_id))
}

// A single authenticated player event on an already-established session.
pub(crate) async fn player_event(
    client: &reqwest::Client,
    config: &EnvironmentConfig,
    user_id: &str,
    session_id: &str,
    player_event_type: &str,
    player_event_data: Value,
) -> Result<Value, String> {
    let session_url = format!("{}/{user_id}/sessionId/{session_id}", config.base_url);
    let body = envelope(player_event_type, player_event_data, config);
    post(client, &session_url, &body).await
}

// GET_PLAYER needs no dynamic parameters at all and returns the player's full state (roster,
// resources, progress - including the expeditions board), not anything specific to a particular
// live event.
#[tauri::command]
pub async fn fetch_player_data(
    environment: String,
    user_id: String,
    client_secret: String,
    snow_id: String,
) -> Result<Value, String> {
    let config = environment_config(&environment)?;
    let client = http_client()?;
    let session_id = connect(&client, config, &user_id, &client_secret, &snow_id).await?;
    let result = player_event(
        &client,
        config,
        &user_id,
        &session_id,
        "GET_PLAYER",
        json!({ "storefrontCountryCode": "NotAvailable" }),
    )
    .await;
    // Only track real prod usage - QA/dev testing shouldn't pollute real usage numbers.
    if result.is_ok() && environment == "prod" {
        track_usage(&user_id);
    }
    result
}
