use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde_json::Value;
use std::path::PathBuf;

// board-assets/ (PVP map backgrounds + this spawn-point manifest) is deliberately served from the
// live Worker rather than bundled into the installer (see the implementation plan - it'd balloon
// the installer size). The board images themselves are plain <img src> tags, which load
// cross-origin fine with no restriction - but this JSON manifest is read via a JS fetch(), and
// unlike every other network call in this app, that's the one place the frontend's own fetch()
// runs inside the webview directly instead of going through a Rust command - and that hits a
// cross-origin failure here Cloudflare's static asset server can't be made to satisfy (its OPTIONS
// preflight response is an unconditional 405, regardless of CORS headers or Worker routing).
// Routed through reqwest instead, exactly like every other network call in this app already is -
// no CORS/webview sandboxing concerns from Rust's own HTTP client.
const SPAWN_POINTS_URL: &str = "https://tacops.cpunerd.workers.dev/spawn-points.json";

#[tauri::command]
pub async fn fetch_spawn_points() -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))?;

    let res = client
        .get(SPAWN_POINTS_URL)
        .send()
        .await
        .map_err(|e| format!("request to {SPAWN_POINTS_URL} failed: {e}"))?;

    let status = res.status();
    if !status.is_success() {
        return Err(format!("{SPAWN_POINTS_URL} returned HTTP {status}"));
    }

    res.json::<Value>()
        .await
        .map_err(|e| format!("failed to parse JSON response from {SPAWN_POINTS_URL}: {e}"))
}

// Dev-only fallback so newly-extracted Arena/Onslaught board art can be checked in the Tauri app
// before it's been deployed to the live Worker (see board-image.ts's localBoardImageDataUrl) -
// reads straight from this repo's own board-assets/boards/ folder on disk, located relative to
// this crate's own manifest directory (a compile-time constant) so it works regardless of the
// process's cwd. Returns Ok(None) rather than an error when the file isn't there yet, since "not
// extracted locally yet" is the expected common case, not a failure - the frontend treats that the
// same as any other failed board-image load.
#[tauri::command]
pub fn read_local_board_image(board_id: String) -> Result<Option<String>, String> {
    let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    path.push("..");
    path.push("board-assets");
    path.push("boards");
    path.push(format!("{board_id}_Visual.png"));

    if !path.exists() {
        return Ok(None);
    }

    let bytes = std::fs::read(&path).map_err(|e| format!("failed to read {}: {e}", path.display()))?;
    Ok(Some(format!("data:image/png;base64,{}", BASE64.encode(bytes))))
}
