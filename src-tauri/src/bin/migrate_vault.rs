//! 一次性迁移工具（用完即弃，与 crypto 模块同批删除，见 spec.md）。
//!
//! 输入旧加密 vault 路径 + 旧主密码（从标准输入读取一行），把全部记录按
//! 现有 schema 写成明文 JSON 到新路径。主密码错误或内容非法时报错退出，
//! 不写出任何文件；输出路径已存在时拒绝覆盖。

use std::io::Write;
use std::path::PathBuf;
use std::process::ExitCode;

use keyvault_lib::crypto::{self, CryptoError};
use keyvault_lib::vault::{atomic_write, Vault};

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 3 {
        eprintln!("用法: migrate_vault <旧加密vault路径> <输出明文JSON路径>");
        eprintln!("旧主密码将在提示后从标准输入读取一行。");
        return ExitCode::FAILURE;
    }
    let input = PathBuf::from(&args[1]);
    let output = PathBuf::from(&args[2]);

    let blob = match std::fs::read(&input) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("读取旧 vault 失败: {e}");
            return ExitCode::FAILURE;
        }
    };
    if output.exists() {
        eprintln!(
            "输出文件已存在，为避免覆盖请换一个路径: {}",
            output.display()
        );
        return ExitCode::FAILURE;
    }

    eprint!("请输入旧主密码: ");
    let _ = std::io::stderr().flush();
    let mut passphrase = String::new();
    if std::io::stdin().read_line(&mut passphrase).is_err() || passphrase.is_empty() {
        eprintln!("未读取到主密码");
        return ExitCode::FAILURE;
    }
    let passphrase = passphrase
        .trim_end_matches('\n')
        .trim_end_matches('\r')
        .as_bytes()
        .to_vec();

    let plaintext = match crypto::decrypt_vault(&blob, &passphrase) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("解密失败: {}", user_error(&e));
            return ExitCode::FAILURE;
        }
    };

    let v = match Vault::from_json(&plaintext) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("解密出的内容不是合法的 vault JSON: {e}");
            return ExitCode::FAILURE;
        }
    };

    if let Err(e) = atomic_write(&output, &plaintext) {
        eprintln!("写入输出文件失败: {e}");
        return ExitCode::FAILURE;
    }
    println!(
        "迁移完成: {} 条记录已导出到 {}",
        v.records.len(),
        output.display()
    );
    ExitCode::SUCCESS
}

/// 把解密错误翻译成用户可读的中文信息。
fn user_error(e: &CryptoError) -> String {
    match e {
        CryptoError::DecryptFailed => "主密码错误，或文件已损坏".to_string(),
        CryptoError::BadMagic => {
            "不是 KeyVault 加密文件（文件头不匹配），请确认是旧版加密 vault".to_string()
        }
        CryptoError::UnsupportedVersion(v) => format!("不支持的加密格式版本: {v}"),
        CryptoError::Truncated => "文件截断或损坏".to_string(),
        CryptoError::KdfFailed(msg) => format!("密钥派生失败: {msg}"),
    }
}
