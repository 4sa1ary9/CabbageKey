//! Crypto core (D2): Argon2id KDF + AES-256-GCM. Never hand-rolled algorithms.
//!
//! Vault file layout on disk (all little pieces live in ONE self-contained blob
//! so cloud sync copies a single file — see design D3):
//!
//! ```text
//! ┌──────────────────────────────────────────────────────────┐
//! │ magic:   "KVLT" (4 bytes)                                  │
//! │ format:  u8 version (currently 1)                          │
//! │ kdf params: m_cost u32, t_cost u32, p_cost u32 (LE)        │
//! │ salt:    16 bytes (Argon2id salt)                          │
//! │ nonce:   12 bytes (AES-GCM nonce, unique per encrypt)      │
//! │ ciphertext + GCM tag: rest of file                         │
//! └──────────────────────────────────────────────────────────┘
//! ```
//!
//! The KDF params travel WITH the file, so a vault encrypted today still
//! decrypts after we tune cost factors later — and the KAT test (crypto
//! tests) pins a known passphrase+salt+params -> key so an accidental
//! param/encoding change turns the test RED instead of silently bricking
//! every existing vault.

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use argon2::{Algorithm, Argon2, Params, Version};
use rand::RngCore;
use zeroize::Zeroize;

const MAGIC: &[u8; 4] = b"KVLT";
const FORMAT_VERSION: u8 = 1;
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;
const KEY_LEN: usize = 32;

// Argon2id defaults. OWASP 2026 recommendation tier. Tunable; whatever is
// used to encrypt is written into the header and read back on decrypt.
pub const DEFAULT_M_COST: u32 = 19_456; // 19 MiB
pub const DEFAULT_T_COST: u32 = 2;
pub const DEFAULT_P_COST: u32 = 1;

#[derive(Debug, thiserror::Error)]
pub enum CryptoError {
    #[error("vault file is not a KeyVault file (bad magic)")]
    BadMagic,
    #[error("unsupported vault format version: {0}")]
    UnsupportedVersion(u8),
    #[error("vault file is truncated or corrupt")]
    Truncated,
    #[error("wrong master password or the file was tampered with")]
    DecryptFailed,
    #[error("key derivation failed: {0}")]
    KdfFailed(String),
}

/// KDF cost parameters, stored in the vault header so old vaults stay readable.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct KdfParams {
    pub m_cost: u32,
    pub t_cost: u32,
    pub p_cost: u32,
}

impl Default for KdfParams {
    fn default() -> Self {
        KdfParams {
            m_cost: DEFAULT_M_COST,
            t_cost: DEFAULT_T_COST,
            p_cost: DEFAULT_P_COST,
        }
    }
}

/// Derive a 32-byte key from passphrase + salt + params using Argon2id.
/// Deterministic: same inputs always produce the same key (the property the
/// KAT test pins).
pub fn derive_key(
    passphrase: &[u8],
    salt: &[u8],
    params: KdfParams,
) -> Result<[u8; KEY_LEN], CryptoError> {
    let argon = Argon2::new(
        Algorithm::Argon2id,
        Version::V0x13,
        Params::new(params.m_cost, params.t_cost, params.p_cost, Some(KEY_LEN))
            .map_err(|e| CryptoError::KdfFailed(e.to_string()))?,
    );
    let mut key = [0u8; KEY_LEN];
    argon
        .hash_password_into(passphrase, salt, &mut key)
        .map_err(|e| CryptoError::KdfFailed(e.to_string()))?;
    Ok(key)
}

/// Encrypt plaintext into a self-contained vault blob. Generates a fresh
/// random salt and nonce every call (nonce-reuse would be catastrophic for
/// GCM, so it is never reused across encrypts).
pub fn encrypt_vault(
    plaintext: &[u8],
    passphrase: &[u8],
    params: KdfParams,
) -> Result<Vec<u8>, CryptoError> {
    let mut salt = [0u8; SALT_LEN];
    let mut nonce_bytes = [0u8; NONCE_LEN];
    let mut rng = rand::thread_rng();
    rng.fill_bytes(&mut salt);
    rng.fill_bytes(&mut nonce_bytes);

    let mut key = derive_key(passphrase, &salt, params)?;
    let header = build_header(params, &salt, &nonce_bytes);

    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
    let nonce = Nonce::from_slice(&nonce_bytes);
    // Bind the header as additional authenticated data so a tampered header
    // (e.g. swapped KDF params) also fails authentication.
    let ciphertext = cipher
        .encrypt(
            nonce,
            Payload {
                msg: plaintext,
                aad: &header,
            },
        )
        .map_err(|_| CryptoError::DecryptFailed)?;
    key.zeroize();

    let mut out = header;
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

/// Decrypt a vault blob. Returns DecryptFailed (not a panic, not partial
/// output) on wrong password OR tampered ciphertext — the GCM auth tag
/// catches both.
pub fn decrypt_vault(blob: &[u8], passphrase: &[u8]) -> Result<Vec<u8>, CryptoError> {
    let (params, salt, nonce_bytes, header_len) = parse_header(blob)?;
    let header = &blob[..header_len];
    let ciphertext = &blob[header_len..];

    let mut key = derive_key(passphrase, &salt, params)?;
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
    let nonce = Nonce::from_slice(&nonce_bytes);
    let plaintext = cipher
        .decrypt(
            nonce,
            Payload {
                msg: ciphertext,
                aad: header,
            },
        )
        .map_err(|_| CryptoError::DecryptFailed);
    key.zeroize();
    plaintext
}

fn build_header(params: KdfParams, salt: &[u8], nonce: &[u8]) -> Vec<u8> {
    let mut h = Vec::with_capacity(4 + 1 + 12 + SALT_LEN + NONCE_LEN);
    h.extend_from_slice(MAGIC);
    h.push(FORMAT_VERSION);
    h.extend_from_slice(&params.m_cost.to_le_bytes());
    h.extend_from_slice(&params.t_cost.to_le_bytes());
    h.extend_from_slice(&params.p_cost.to_le_bytes());
    h.extend_from_slice(salt);
    h.extend_from_slice(nonce);
    h
}

type ParsedHeader = (KdfParams, [u8; SALT_LEN], [u8; NONCE_LEN], usize);

fn parse_header(blob: &[u8]) -> Result<ParsedHeader, CryptoError> {
    let header_len = 4 + 1 + 12 + SALT_LEN + NONCE_LEN;
    if blob.len() < header_len {
        return Err(CryptoError::Truncated);
    }
    if &blob[0..4] != MAGIC {
        return Err(CryptoError::BadMagic);
    }
    let version = blob[4];
    if version != FORMAT_VERSION {
        return Err(CryptoError::UnsupportedVersion(version));
    }
    let m_cost = u32::from_le_bytes(blob[5..9].try_into().unwrap());
    let t_cost = u32::from_le_bytes(blob[9..13].try_into().unwrap());
    let p_cost = u32::from_le_bytes(blob[13..17].try_into().unwrap());
    let mut salt = [0u8; SALT_LEN];
    salt.copy_from_slice(&blob[17..17 + SALT_LEN]);
    let mut nonce = [0u8; NONCE_LEN];
    nonce.copy_from_slice(&blob[17 + SALT_LEN..17 + SALT_LEN + NONCE_LEN]);
    Ok((
        KdfParams {
            m_cost,
            t_cost,
            p_cost,
        },
        salt,
        nonce,
        header_len,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Fast params for tests only — real app uses DEFAULT_*.
    fn test_params() -> KdfParams {
        KdfParams {
            m_cost: 256,
            t_cost: 1,
            p_cost: 1,
        }
    }

    // D5 / T3: Known-Answer Test. Pins passphrase + salt + params -> key.
    // If a future change alters the KDF wiring (param order, version, output
    // length, encoding), this test fails RED instead of silently making every
    // existing vault undecryptable.
    //
    // The pinned vector below is a PLACEHOLDER. On the first `cargo test` run,
    // this test prints the real derived key; copy the printed hex into
    // KAT_EXPECTED and flip KAT_PINNED to true. After that the value is frozen
    // and must never change without a FORMAT_VERSION bump + migration.
    const KAT_PINNED: bool = false;
    const KAT_EXPECTED: &str = "PASTE_REAL_HEX_HERE";

    #[test]
    fn kat_derive_key_is_stable() {
        let salt = [0x42u8; SALT_LEN];
        let key = derive_key(b"correct horse battery staple", &salt, test_params()).unwrap();
        let got = hex::encode(key); // full 32-byte key, hex
        if !KAT_PINNED {
            // First run: surface the value so it can be pinned. Fails on
            // purpose until the developer freezes the vector.
            panic!(
                "KAT not yet pinned. Set KAT_PINNED=true and KAT_EXPECTED=\"{got}\""
            );
        }
        assert_eq!(
            got, KAT_EXPECTED,
            "KDF output changed! If intentional, bump FORMAT_VERSION and add migration."
        );
    }

    #[test]
    fn roundtrip_returns_original() {
        let plain = b"{\"records\":[]}";
        let blob = encrypt_vault(plain, b"hunter2", test_params()).unwrap();
        let out = decrypt_vault(&blob, b"hunter2").unwrap();
        assert_eq!(out, plain);
    }

    #[test]
    fn empty_vault_roundtrips() {
        let blob = encrypt_vault(b"", b"pw", test_params()).unwrap();
        assert_eq!(decrypt_vault(&blob, b"pw").unwrap(), b"");
    }

    #[test]
    fn wrong_password_fails_cleanly() {
        let blob = encrypt_vault(b"secret", b"right", test_params()).unwrap();
        let err = decrypt_vault(&blob, b"wrong").unwrap_err();
        assert!(matches!(err, CryptoError::DecryptFailed));
    }

    #[test]
    fn tampered_ciphertext_is_rejected() {
        let mut blob = encrypt_vault(b"secret", b"pw", test_params()).unwrap();
        let last = blob.len() - 1;
        blob[last] ^= 0xff; // flip a bit in the tag/ciphertext
        assert!(matches!(
            decrypt_vault(&blob, b"pw").unwrap_err(),
            CryptoError::DecryptFailed
        ));
    }

    #[test]
    fn tampered_header_is_rejected() {
        let mut blob = encrypt_vault(b"secret", b"pw", test_params()).unwrap();
        blob[5] ^= 0x01; // flip an m_cost bit; header is AAD so auth fails
        assert!(decrypt_vault(&blob, b"pw").is_err());
    }

    #[test]
    fn bad_magic_detected() {
        let mut blob = encrypt_vault(b"x", b"pw", test_params()).unwrap();
        blob[0] = b'X';
        assert!(matches!(
            decrypt_vault(&blob, b"pw").unwrap_err(),
            CryptoError::BadMagic
        ));
    }

    #[test]
    fn truncated_blob_detected() {
        let blob = encrypt_vault(b"x", b"pw", test_params()).unwrap();
        assert!(matches!(
            decrypt_vault(&blob[..10], b"pw").unwrap_err(),
            CryptoError::Truncated
        ));
    }

    #[test]
    fn nonce_is_unique_per_encrypt() {
        let a = encrypt_vault(b"same", b"pw", test_params()).unwrap();
        let b = encrypt_vault(b"same", b"pw", test_params()).unwrap();
        // nonce lives at bytes [17+SALT_LEN .. +NONCE_LEN]; whole blob must differ
        assert_ne!(a, b, "two encrypts of same plaintext must differ (random nonce/salt)");
    }
}
