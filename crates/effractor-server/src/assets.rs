use axum::extract::Path;
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use rust_embed::RustEmbed;

#[derive(RustEmbed)]
#[folder = "../../assets"]
pub(crate) struct Assets;

/// Release builds look the path up as a key among the embedded files, so a
/// `..` names nothing. Debug builds read from disk, where rust-embed refuses
/// anything that resolves outside the folder. Either way it is a 404, tested.
pub async fn asset(Path(path): Path<String>, request: HeaderMap) -> Response {
    let Some(file) = Assets::get(&path) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let etag = format!("\"{}\"", hex(&file.metadata.sha256_hash()));
    let unchanged = request
        .get(header::IF_NONE_MATCH)
        .and_then(|v| v.to_str().ok())
        == Some(etag.as_str());
    // Revalidate every time, cheaply: a new binary is a new app, and the hash
    // makes the unchanged case a 304 — which carries the same caching headers
    // as the 200 it stands in for (RFC 9110 §15.4.5).
    let caching = [
        (header::CACHE_CONTROL, "no-cache".to_owned()),
        (header::ETAG, etag),
    ];
    if unchanged {
        return (StatusCode::NOT_MODIFIED, caching).into_response();
    }
    let mime = mime_guess::from_path(&path).first_or_octet_stream();
    (
        [(header::CONTENT_TYPE, mime.as_ref().to_owned())],
        caching,
        file.data,
    )
        .into_response()
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
