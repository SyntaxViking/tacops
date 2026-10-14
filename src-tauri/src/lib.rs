mod board_assets;
mod credentials;
mod crusades;
mod dev_data_source;
mod export;
mod guild_chat;
mod loki;

use board_assets::{fetch_spawn_points, read_local_board_image};
use credentials::find_credentials;
use crusades::{fetch_crusade_data, fetch_leaderboard_data, fetch_pvp_state};
use dev_data_source::{proxy_worker_get, proxy_worker_post};
use export::write_text_file;
use guild_chat::{guild_feed_init, read_channel_window, upload_replay, SessionStore};
use loki::fetch_player_data;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Load src-tauri/.env (e.g. TACTICUS_GAME_EVENT_SALT) into the process environment. Absent in a
    // packaged build, where the variable is expected to come from the real environment instead.
    dotenvy::dotenv().ok();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(SessionStore::default())
        .invoke_handler(tauri::generate_handler![
            find_credentials,
            fetch_player_data,
            write_text_file,
            fetch_crusade_data,
            fetch_leaderboard_data,
            fetch_pvp_state,
            fetch_spawn_points,
            read_local_board_image,
            proxy_worker_get,
            proxy_worker_post,
            guild_feed_init,
            read_channel_window,
            upload_replay
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
