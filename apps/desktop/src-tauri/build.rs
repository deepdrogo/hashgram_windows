//! Tauri build script: embeds the config, icons and capabilities, and the
//! git commit this binary was built from (shown in About and Help).

fn main() {
    let commit = std::env::var("HASHGRAM_COMMIT")
        .ok()
        .filter(|c| !c.trim().is_empty())
        .or_else(|| {
            std::process::Command::new("git")
                .args(["rev-parse", "--short=12", "HEAD"])
                .output()
                .ok()
                .filter(|o| o.status.success())
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_owned())
        })
        .unwrap_or_else(|| "unknown".to_owned());
    println!("cargo:rustc-env=HASHGRAM_COMMIT={commit}");
    println!("cargo:rerun-if-env-changed=HASHGRAM_COMMIT");
    println!("cargo:rerun-if-changed=../../../.git/HEAD");
    tauri_build::build();
}
