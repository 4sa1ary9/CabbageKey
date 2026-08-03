//! 一次性迁移工具的自动化验证（CLI/文件边界接缝，见 spec.md「测试决策」）。
//!
//! 用当前加密代码造一份「已知主密码 + 已知记录」的加密样本，运行迁移工具，
//! 断言输出与已知明文 JSON 逐字节一致；并断言主密码错误时给出明确报错、
//! 不写出任何文件。本测试与迁移脚本一起用完即弃，不进 CI 遗产。

use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::atomic::{AtomicUsize, Ordering};

use keyvault_lib::crypto::{self, KdfParams};
use keyvault_lib::vault::{Record, Vault};

const PASSWORD: &str = "correct horse battery staple";

fn fast_params() -> KdfParams {
    KdfParams {
        m_cost: 256,
        t_cost: 1,
        p_cost: 1,
    }
}

/// 已知内容：两条记录（一条全字段、一条最小字段），时间戳固定。
fn known_vault() -> Vault {
    let mut endpoints = HashMap::new();
    endpoints.insert(
        "openai-chat".to_string(),
        "https://api.openai.com/v1/chat/completions".to_string(),
    );
    endpoints.insert(
        "openai-responses".to_string(),
        "https://api.openai.com/v1/responses".to_string(),
    );
    let full = Record {
        id: "9f6e1f2a-0000-4000-8000-000000000001".into(),
        name: "翻译用".into(),
        api_key: "sk-abcdef1234567890".into(),
        vendor: "OpenAI".into(),
        endpoints,
        website: "https://platform.openai.com".into(),
        note: "额度到 2026-12-31".into(),
        tags: vec!["翻译".into(), "项目A".into()],
        created_at: "2026-08-01T10:00:00Z".into(),
        updated_at: "2026-08-02T09:30:00Z".into(),
    };
    let minimal = Record {
        id: "9f6e1f2a-0000-4000-8000-000000000002".into(),
        name: "个人用".into(),
        api_key: "sk-zyxw".into(),
        vendor: String::new(),
        endpoints: HashMap::new(),
        website: String::new(),
        note: String::new(),
        tags: vec![],
        created_at: "2026-08-01T12:00:00Z".into(),
        updated_at: "2026-08-01T12:00:00Z".into(),
    };
    Vault {
        schema_version: 1,
        records: vec![full, minimal],
    }
}

fn temp_dir() -> PathBuf {
    static COUNTER: AtomicUsize = AtomicUsize::new(0);
    let mut d = std::env::temp_dir();
    d.push(format!(
        "keyvault-migrate-test-{}-{}",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::SeqCst)
    ));
    fs::create_dir_all(&d).unwrap();
    d
}

/// 造一份已知内容的加密样本，返回 (样本路径, 已知明文 JSON 字节)。
/// `params` 决定 KDF 成本：测试用快速参数，真实场景用应用默认参数。
fn write_fixture(dir: &Path, params: KdfParams) -> (PathBuf, Vec<u8>) {
    let vault = known_vault();
    let plaintext = vault.to_json();
    let blob = crypto::encrypt_vault(&plaintext, PASSWORD.as_bytes(), params).unwrap();
    let path = dir.join("old-vault.enc");
    fs::write(&path, blob).unwrap();
    (path, plaintext)
}

fn run_migrate(input: &Path, output: &Path, password: &str) -> Output {
    let mut child = Command::new(env!("CARGO_BIN_EXE_migrate_vault"))
        .arg(input)
        .arg(output)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(format!("{password}\n").as_bytes())
        .unwrap();
    child.wait_with_output().unwrap()
}

#[test]
fn migrates_known_fixture_byte_for_byte() {
    let dir = temp_dir();
    let (input, expected) = write_fixture(&dir, fast_params());
    let output = dir.join("plain-vault.json");

    let out = run_migrate(&input, &output, PASSWORD);
    assert!(
        out.status.success(),
        "迁移失败，stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert_eq!(
        fs::read(&output).unwrap(),
        expected,
        "迁移输出必须与已知明文 JSON 逐字节一致"
    );

    // 输出是合法的明文 vault：schema_version 1，记录含 endpoints 映射。
    let parsed = Vault::from_json(&fs::read(&output).unwrap()).unwrap();
    assert_eq!(parsed.schema_version, 1);
    assert_eq!(parsed.records, known_vault().records);
    assert_eq!(
        parsed.records[0].endpoints["openai-chat"],
        "https://api.openai.com/v1/chat/completions"
    );

    fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn wrong_password_fails_without_writing_output() {
    let dir = temp_dir();
    let (input, _) = write_fixture(&dir, fast_params());
    let output = dir.join("never-written.json");

    let out = run_migrate(&input, &output, "wrong-password");
    assert!(!out.status.success(), "主密码错误时必须失败");
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(stderr.contains("主密码错误"), "报错要明确，stderr: {stderr}");
    assert!(!output.exists(), "主密码错误时不得写出任何文件");

    fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn refuses_to_overwrite_existing_output() {
    let dir = temp_dir();
    let (input, _) = write_fixture(&dir, fast_params());
    let output = dir.join("already.json");
    fs::write(&output, b"existing").unwrap();

    let out = run_migrate(&input, &output, PASSWORD);
    assert!(!out.status.success(), "输出文件已存在时必须失败");
    assert_eq!(fs::read(&output).unwrap(), b"existing", "已有文件不得被覆盖");

    fs::remove_dir_all(&dir).unwrap();
}

/// 真实 vault 由应用以 KdfParams::default()（19 MiB）加密；KDF 参数写在文件头，
/// 解密时从头部读出，因此同一代码路径必须对真实参数生效。
#[test]
fn migrates_fixture_with_app_default_kdf_params() {
    let dir = temp_dir();
    let (input, expected) = write_fixture(&dir, KdfParams::default());
    let output = dir.join("plain-vault.json");

    let out = run_migrate(&input, &output, PASSWORD);
    assert!(
        out.status.success(),
        "迁移失败，stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert_eq!(fs::read(&output).unwrap(), expected);

    fs::remove_dir_all(&dir).unwrap();
}
