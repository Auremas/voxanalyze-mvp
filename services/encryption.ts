/**
 * Field-level encryption service for sensitive data at rest
 * Uses Web Crypto API for client-side encryption
 */

const ENCRYPTION_ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;

/**
 * Derive encryption key from user session or generate a master key
 * In production, store this securely (e.g., in Supabase Vault or environment secrets)
 */
async function getEncryptionKey(): Promise<CryptoKey | null> {
  // Option 1: Use a master key from environment (for development/testing)
  // In production, use Supabase Vault or a dedicated key management service
  const masterKeyString = (import.meta as any).env?.VITE_ENCRYPTION_KEY || '';
  
  if (!masterKeyString) {
    // Return null if key is not set - encryption is optional
    return null;
  }

  // Convert hex string to ArrayBuffer
  const keyBuffer = Uint8Array.from(
    masterKeyString.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || []
  );

  // Import key for AES-GCM
  return await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: ENCRYPTION_ALGORITHM },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt sensitive data before storing in database
 */
export async function encryptData(plaintext: string): Promise<string> {
  try {
    const key = await getEncryptionKey();
    
    // If encryption key is not set, return plaintext (encryption is optional)
    if (!key) {
      console.warn('⚠️ Encryption key not set, storing unencrypted (set VITE_ENCRYPTION_KEY to enable encryption)');
      return plaintext;
    }
    
    const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV for AES-GCM
    const encoder = new TextEncoder();
    const data = encoder.encode(plaintext);

    const encrypted = await crypto.subtle.encrypt(
      {
        name: ENCRYPTION_ALGORITHM,
        iv: iv
      },
      key,
      data
    );

    // Combine IV and encrypted data, then encode as base64
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);

    return btoa(String.fromCharCode(...combined));
  } catch (error: any) {
    console.error('Encryption error:', error);
    throw new Error(`Failed to encrypt data: ${error.message}`);
  }
}

/**
 * Decrypt sensitive data after retrieving from database
 */
export async function decryptData(ciphertext: string): Promise<string> {
  try {
    const key = await getEncryptionKey();
    
    // If encryption key is not set, assume data is not encrypted (backward compatibility)
    if (!key) {
      return ciphertext;
    }
    
    // Check if data is actually encrypted (has base64 pattern with IV)
    // If decryption fails, assume it's plaintext (for backward compatibility)
    try {
      // Decode base64
      const combined = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));
    
    // Extract IV (first 12 bytes) and encrypted data
    const iv = combined.slice(0, 12);
    const encrypted = combined.slice(12);

    const decrypted = await crypto.subtle.decrypt(
      {
        name: ENCRYPTION_ALGORITHM,
        iv: iv
      },
      key,
      encrypted
    );

      const decoder = new TextDecoder();
      return decoder.decode(decrypted);
    } catch (decryptError: any) {
      // If decryption fails, might be plaintext (backward compatibility)
      console.warn('⚠️ Decryption failed, assuming plaintext:', decryptError.message);
      return ciphertext;
    }
  } catch (error: any) {
    console.error('Decryption error:', error);
    // Return plaintext if decryption fails (backward compatibility)
    return ciphertext;
  }
}

/**
 * Generate a secure random encryption key (for initial setup)
 * Save this to .env.local as VITE_ENCRYPTION_KEY
 * 
 * Usage:
 * const key = await generateEncryptionKey();
 * console.log('Your encryption key:', key);
 * // Copy this to .env.local as VITE_ENCRYPTION_KEY=...
 */
export async function generateEncryptionKey(): Promise<string> {
  const key = await crypto.subtle.generateKey(
    {
      name: ENCRYPTION_ALGORITHM,
      length: KEY_LENGTH
    },
    true,
    ['encrypt', 'decrypt']
  );

  const exported = await crypto.subtle.exportKey('raw', key);
  const keyArray = Array.from(new Uint8Array(exported));
  return keyArray.map(byte => byte.toString(16).padStart(2, '0')).join('');
}
