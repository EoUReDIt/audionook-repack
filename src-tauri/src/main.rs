// Hide the extra console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::time::Duration;

/// Largest page "From a URL…" will read. Articles are far smaller; the cap
/// stops a mistyped link to a huge download from filling memory.
const MAX_PAGE_BYTES: usize = 12 * 1024 * 1024;

/// Fetch a web page's text for the Create screen's "From a URL…" button.
///
/// The web view can't read arbitrary sites (cross-origin rules), so the request
/// is made here instead. Only http and https addresses are accepted.
#[tauri::command]
async fn fetch_text(url: String) -> Result<String, String> {
    let parsed = reqwest::Url::parse(url.trim()).map_err(|_| "That doesn't look like a web address".to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("Only http and https addresses can be opened".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Audionook")
        .build()
        .map_err(|e| format!("Couldn't start the request: {e}"))?;

    let mut response = client
        .get(parsed)
        .header("accept", "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5")
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                "The site took too long to answer".to_string()
            } else {
                "Couldn't reach that site".to_string()
            }
        })?;

    if !response.status().is_success() {
        return Err(format!("The site answered with an error ({})", response.status().as_u16()));
    }
    if response.content_length().is_some_and(|n| n as usize > MAX_PAGE_BYTES) {
        return Err("That page is too large to read".to_string());
    }

    let mut body: Vec<u8> = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "The download was interrupted".to_string())? {
        if body.len() + chunk.len() > MAX_PAGE_BYTES {
            return Err("That page is too large to read".to_string());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(String::from_utf8_lossy(&body).into_owned())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![fetch_text])
        .run(tauri::generate_context!())
        .expect("error while running Audionook");
}
