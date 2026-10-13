use crate::loki::{bootstrap_session, envelope, now_ms, post, INSTALL_ID};
use md5::{Digest, Md5};
use serde_json::{json, Value};
use uuid::Uuid;

// Reverse-engineered this session from 5 real captures (2 different gameEventTypes) - every
// sample matched exactly. Only these 5 fields feed the hash; createdOn, age,
// multiConfigVersion, installId, and sessionId do not, and can't explain a mismatch.
// eventData must be signed as the exact compact-JSON bytes actually sent - if it's ever mutated
// after being built, re-sign after the mutation, not before.
const GAME_EVENT_SALT: &str = "Sp#!";
const UNIVERSE_VERSION: &str = "universe_not_needed";

// Deliberately NOT loki::GAME_CONFIG_VERSION/MULTI_CONFIG_VERSION, and not
// config.built_in_multi_config_version either. These three travel together as one matched set
// representing the live client's *current* config generation - confirmed by a live capture of a
// totally unrelated playerEvent call (a fresh APP_START) showing the identical trio. loki.rs's
// constants are simply from an older generation that CONNECT/GET_PLAYER still tolerate, while
// GET_CRUSADE strictly validates against the current one (a first live GET_CRUSADE call using
// loki.rs's older MULTI_CONFIG_VERSION/built_in_multi_config_version here failed with
// "Could not find gameConfig ... in multiConfig=..."). If this trio ever goes stale again,
// recapture all three together from *any* current live call - they're not something unique to
// game-event calls, just the current generation, whatever call happens to be handy to capture.
const GAME_EVENT_GAME_CONFIG_VERSION: &str = "095fb039d4e0a0b1ff90b8104ca5e393";
const GAME_EVENT_MULTI_CONFIG_VERSION: &str = "abe12f6fd5361f20f5379ae62ecd5882";
// Only confirmed for prod, like EnvironmentConfig::game_event_base_url - unconfirmed for QA.
const GAME_EVENT_BUILT_IN_MULTI_CONFIG_VERSION: &str = "a26f2bc38d9f20a570ca53f608fcf462";

fn game_event_checksum(event_id: &str, game_event_type: &str, event_data: &Value) -> String {
    let event_data_str = serde_json::to_string(event_data).expect("Value serialization can't fail");
    let combined = format!(
        "{GAME_EVENT_SALT}{event_id}{game_event_type}{UNIVERSE_VERSION}{GAME_EVENT_GAME_CONFIG_VERSION}{event_data_str}"
    );
    let mut hasher = Md5::new();
    hasher.update(combined.as_bytes());
    hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02X}"))
        .collect()
}

// GET_CRUSADE and friends live under a different envelope family than GET_PLAYER/CONNECT - a
// "gameEvents" array (only ever one entry here) instead of a single "playerEvent", each entry
// individually signed with "d". The response mirrors that: "eventResults" (plural, array) instead
// of "eventResult".
fn game_event_envelope(game_event_type: &str, event_data: Value) -> Value {
    let event_id = Uuid::new_v4().to_string();
    let d = game_event_checksum(&event_id, game_event_type, &event_data);
    json!({
        "gameEvents": [{
            "metaData": { "rewards": [] },
            "gameEventType": game_event_type,
            "eventData": event_data,
            "eventId": event_id,
            // Not part of the "d" signature and not validated server-side as far as we've seen -
            // the real client's value here drifts (seemingly a client-local cache-freshness hint),
            // so a fixed placeholder is fine.
            "age": 0,
            "createdOn": now_ms(),
            "universeVersion": UNIVERSE_VERSION,
            "gameConfigVersion": GAME_EVENT_GAME_CONFIG_VERSION,
            "multiConfigVersion": GAME_EVENT_MULTI_CONFIG_VERSION,
            "d": d,
        }],
        "installId": INSTALL_ID,
        "builtInMultiConfigVersion": GAME_EVENT_BUILT_IN_MULTI_CONFIG_VERSION,
    })
}

async fn post_game_event(client: &reqwest::Client, url: &str, body: &Value) -> Result<Value, String> {
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

    let result_type = &parsed["eventResults"][0]["eventResultType"];
    if result_type != "SUCCESS" {
        return Err(format!("{url} returned an application error: {parsed}"));
    }
    Ok(parsed)
}

// GET_CRUSADE returns the current crusade season's phase schedule and per-planet
// faction ownership/points - not anything specific to a single planet.
#[tauri::command]
pub async fn fetch_crusade_data(
    environment: String,
    user_id: String,
    client_secret: String,
    snow_id: String,
) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))?;

    let (config, _base_url, session_id) =
        bootstrap_session(&client, &environment, &user_id, &client_secret, &snow_id).await?;

    let game_event_url = format!("{}/{user_id}/sessionId/{session_id}", config.game_event_base_url);
    let body = game_event_envelope("GET_CRUSADE", json!({}));
    post_game_event(&client, &game_event_url, &body).await
}

// GET_PVP_STATE returns the 3 opponents currently offered for the player's next Arena match -
// each with their fielded characters/Machine of War, equipment, and the board they'll fight on.
// force_opponent_refresh is hardcoded false, not a parameter - re-rolling the 3 offered opponents
// may be a resource-costing in-game action, so this must never be exposed as a way to force a
// reroll from TacOps. player_position comes from the ordinary GET_PLAYER call (resolved client-
// side from PlayerResources.pvpPosition before this command is invoked).
#[tauri::command]
pub async fn fetch_pvp_state(
    environment: String,
    user_id: String,
    client_secret: String,
    snow_id: String,
    player_position: i64,
) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))?;

    let (config, _base_url, session_id) =
        bootstrap_session(&client, &environment, &user_id, &client_secret, &snow_id).await?;

    let game_event_url = format!("{}/{user_id}/sessionId/{session_id}", config.game_event_base_url);
    let body = game_event_envelope(
        "GET_PVP_STATE",
        json!({
            "playerPosition": player_position,
            "leaguesVersion": null,
            "forceOpponentRefresh": false,
        }),
    );
    post_game_event(&client, &game_event_url, &body).await
}

// GET_LEADERBOARD_2 reuses the ordinary playerEvent envelope (no "d" signature needed - only
// game-event/game3 calls are signed) but needs the sessionId in the URL path, not just in the
// body, or the server rejects it with "requires secured communication". leaderboard_ids must
// already carry their type prefix (crusadePlayer:/crusadeFaction:/crusadeGuild:) - a
// missing/wrong prefix doesn't error, it silently echoes the id back with no entries.
#[tauri::command]
pub async fn fetch_leaderboard_data(
    environment: String,
    user_id: String,
    client_secret: String,
    snow_id: String,
    leaderboard_ids: Vec<String>,
) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))?;

    let (config, base_url, session_id) =
        bootstrap_session(&client, &environment, &user_id, &client_secret, &snow_id).await?;

    let session_url = format!("{base_url}/sessionId/{session_id}");
    let leaderboards: Vec<Value> = leaderboard_ids
        .into_iter()
        .map(|leaderboard_id| json!({ "leaderboardId": leaderboard_id, "participantId": user_id }))
        .collect();
    let body = envelope("GET_LEADERBOARD_2", json!({ "leaderboards": leaderboards }), config);
    post(&client, &session_url, &body).await
}

#[cfg(test)]
mod tests {
    use super::*;

    // Pinned against 5 real captures (2 different gameEventTypes) gathered this session - if
    // this ever fails, GAME_EVENT_GAME_CONFIG_VERSION has almost certainly rotated (the game
    // updated) and needs re-capturing, not a bug in this function.
    #[test]
    fn matches_captured_get_crusade_checksum() {
        let d = game_event_checksum(
            "35ba684f-adf6-4714-990e-46d24b1c9064",
            "GET_CRUSADE",
            &json!({}),
        );
        assert_eq!(d, "CAD7B986D4C0F4F2FB2A36B0B3C22652");
    }

    #[test]
    fn matches_captured_get_guild_war_status_checksum() {
        let d = game_event_checksum(
            "0204b5af-0e94-469c-a4e0-9f6ea5ebda66",
            "GET_GUILD_WAR_STATUS",
            &json!({ "guildWarId": "cc144330-7be6-4a47-8f67-087ce739c82b" }),
        );
        assert_eq!(d, "7E3E6C3B4E3095EF932200EFDA5961DA");
    }
}
