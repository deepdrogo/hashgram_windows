//! Preparing pictures and video for a public post.
//!
//! Two jobs, and both happen here rather than in the webview: learn what a
//! file actually is, and make something small that can be shown before the
//! full bytes arrive.
//!
//! Pictures are decoded with the `image` crate, so the width, height and
//! thumbnail come from the pixels rather than from a file name. Video is
//! not decoded: no transcoder ships with the app and none is required to
//! post. The webview, which already has a decoder in `<video>`, hands over
//! a poster frame and the duration it measured, and those travel as the
//! author's claim — exactly like the MIME type, which clients already
//! treat as a hint and verify for themselves.

use hashgram_sdk::feed::MediaMeta;

/// Longest edge of a generated thumbnail. Large enough for a feed card on
/// a high-DPI screen, small enough that a grid of them is cheap.
const THUMB_EDGE: u32 = 640;

/// A file the user picked, ready to upload.
pub struct Prepared {
    /// File bytes.
    pub bytes: Vec<u8>,
    /// MIME type from the extension.
    pub mime: String,
    /// `image`, `video`, `audio` or `file`.
    pub kind: String,
    /// Size, poster and duration.
    pub meta: MediaMeta,
}

/// What the webview measured for a video it could already decode.
#[derive(Debug, Clone, Default, serde::Deserialize)]
pub struct ClientMeta {
    /// Pixel width.
    #[serde(default)]
    pub width: u32,
    /// Pixel height.
    #[serde(default)]
    pub height: u32,
    /// Duration in milliseconds.
    #[serde(default)]
    pub duration_ms: u32,
    /// Poster frame as a base64 PNG or JPEG data payload (no data: prefix).
    #[serde(default)]
    pub poster_base64: String,
}

/// The broad kind a MIME type belongs to.
#[must_use]
pub fn kind_of(mime: &str) -> &'static str {
    if mime.starts_with("image/") {
        "image"
    } else if mime.starts_with("video/") {
        "video"
    } else if mime.starts_with("audio/") {
        "audio"
    } else {
        "file"
    }
}

/// Reads a picked file and works out everything a post needs to know.
pub fn prepare(bytes: Vec<u8>, mime: String, client: &ClientMeta) -> Prepared {
    let kind = kind_of(&mime).to_owned();
    let meta = match kind.as_str() {
        "image" => image_meta(&bytes).unwrap_or_default(),
        "video" => MediaMeta {
            width: client.width,
            height: client.height,
            duration_ms: client.duration_ms,
            thumbnail: poster(client),
        },
        _ => MediaMeta::default(),
    };
    Prepared {
        bytes,
        mime,
        kind,
        meta,
    }
}

/// Decodes a picture for its real size and a downscaled JPEG still.
fn image_meta(bytes: &[u8]) -> Option<MediaMeta> {
    let img = image::load_from_memory(bytes).ok()?;
    let (w, h) = (img.width(), img.height());
    let thumbnail = if w.max(h) > THUMB_EDGE {
        let small = img.thumbnail(THUMB_EDGE, THUMB_EDGE);
        let mut out = std::io::Cursor::new(Vec::new());
        small
            .to_rgb8()
            .write_to(&mut out, image::ImageFormat::Jpeg)
            .ok()
            .map(|()| (out.into_inner(), "image/jpeg".to_owned()))
    } else {
        // Already small: the picture is its own thumbnail.
        None
    };
    Some(MediaMeta {
        width: w,
        height: h,
        duration_ms: 0,
        thumbnail,
    })
}

fn poster(client: &ClientMeta) -> Option<(Vec<u8>, String)> {
    let b64 = client.poster_base64.trim();
    if b64.is_empty() {
        return None;
    }
    let bytes = crate::util::base64_decode(b64)?;
    if bytes.is_empty() || bytes.len() > 2 * 1024 * 1024 {
        return None;
    }
    // Only what a browser canvas produces, and only if it decodes here too.
    let img = image::load_from_memory(&bytes).ok()?;
    let mut out = std::io::Cursor::new(Vec::new());
    img.thumbnail(THUMB_EDGE, THUMB_EDGE)
        .to_rgb8()
        .write_to(&mut out, image::ImageFormat::Jpeg)
        .ok()?;
    Some((out.into_inner(), "image/jpeg".to_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png(w: u32, h: u32) -> Vec<u8> {
        let img = image::RgbImage::from_fn(w, h, |x, y| image::Rgb([(x % 255) as u8, (y % 255) as u8, 128]));
        let mut out = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgb8(img)
            .write_to(&mut out, image::ImageFormat::Png)
            .unwrap();
        out.into_inner()
    }

    #[test]
    fn a_picture_reports_its_real_size() {
        let p = prepare(png(800, 450), "image/png".into(), &ClientMeta::default());
        assert_eq!(p.kind, "image");
        assert_eq!((p.meta.width, p.meta.height), (800, 450));
        assert!(p.meta.thumbnail.is_some(), "a wide picture gets a thumbnail");
    }

    #[test]
    fn a_small_picture_is_its_own_thumbnail() {
        let p = prepare(png(120, 90), "image/png".into(), &ClientMeta::default());
        assert_eq!((p.meta.width, p.meta.height), (120, 90));
        assert!(p.meta.thumbnail.is_none());
    }

    #[test]
    fn a_video_keeps_what_the_webview_measured_and_reencodes_the_poster() {
        let client = ClientMeta {
            width: 1920,
            height: 1080,
            duration_ms: 12_500,
            poster_base64: crate::util::base64_encode(&png(1920, 1080)),
        };
        let p = prepare(vec![0u8; 16], "video/mp4".into(), &client);
        assert_eq!(p.kind, "video");
        assert_eq!(p.meta.duration_ms, 12_500);
        let (thumb, mime) = p.meta.thumbnail.expect("poster");
        assert_eq!(mime, "image/jpeg");
        assert!(!thumb.is_empty());
    }

    #[test]
    fn a_poster_that_is_not_an_image_is_dropped() {
        let client = ClientMeta {
            poster_base64: crate::util::base64_encode(b"not a picture"),
            ..Default::default()
        };
        assert!(prepare(vec![0u8; 8], "video/mp4".into(), &client).meta.thumbnail.is_none());
    }
}
