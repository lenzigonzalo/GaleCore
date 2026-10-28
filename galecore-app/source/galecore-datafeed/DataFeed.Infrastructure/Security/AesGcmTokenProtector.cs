using System;
using System.Security.Cryptography;
using System.Text;
using DataFeed.Infrastructure.Providers.Tastytrade;
using Microsoft.Extensions.Configuration;

namespace DataFeed.Infrastructure.Security
{
    /// <summary>
    /// Cifra los refresh token con AES-256-GCM y una clave de configuración.
    ///
    /// Por qué GCM y no CBC: GCM es cifrado autenticado, así que además de ocultar el token detecta
    /// si alguien lo modificó en la base. Con CBC un token alterado se descifra en basura silenciosa.
    ///
    /// Por qué una clave de configuración y no IDataProtection de ASP.NET: el key ring de
    /// DataProtection es un archivo local que en Azure hay que persistir aparte, y si se pierde los
    /// tokens quedan ilegibles sin aviso. Una clave explícita en user-secrets (local) o Key Vault
    /// (Azure) es más predecible y se puede rotar a propósito.
    ///
    /// Formato guardado: base64( nonce(12) | tag(16) | ciphertext ). El nonce va por mensaje y es
    /// aleatorio: reutilizarlo con la misma clave rompe GCM por completo.
    ///
    /// Si la clave no está configurada, falla al USARSE y no al arrancar: la API tiene que poder
    /// levantar sin base y sin cuentas, igual que hoy.
    /// </summary>
    public class AesGcmTokenProtector : ITokenProtector
    {
        public const string KeyConfigPath = "Security:TokenProtectionKey";

        private const int NonceSize = 12;
        private const int TagSize = 16;

        private readonly IConfiguration _config;

        public AesGcmTokenProtector(IConfiguration config) => _config = config;

        private byte[] Key()
        {
            var raw = _config[KeyConfigPath];
            if (string.IsNullOrWhiteSpace(raw))
                throw new InvalidOperationException(
                    $"Falta {KeyConfigPath}. Es la clave con la que se cifran los refresh token de " +
                    "broker. Generar 32 bytes aleatorios en base64 y guardarla en user-secrets " +
                    "(local) o Key Vault (Azure). NUNCA en appsettings.");

            byte[] key;
            try { key = Convert.FromBase64String(raw); }
            catch (FormatException) { throw new InvalidOperationException($"{KeyConfigPath} no es base64 valido."); }

            if (key.Length != 32)
                throw new InvalidOperationException(
                    $"{KeyConfigPath} tiene {key.Length} bytes; AES-256 necesita exactamente 32.");

            return key;
        }

        public string Protect(string plaintext)
        {
            if (plaintext == null) throw new ArgumentNullException(nameof(plaintext));

            var key = Key();
            var nonce = RandomNumberGenerator.GetBytes(NonceSize);
            var plain = Encoding.UTF8.GetBytes(plaintext);
            var cipher = new byte[plain.Length];
            var tag = new byte[TagSize];

            using (var aes = new AesGcm(key, TagSize))
                aes.Encrypt(nonce, plain, cipher, tag);

            var packed = new byte[NonceSize + TagSize + cipher.Length];
            Buffer.BlockCopy(nonce, 0, packed, 0, NonceSize);
            Buffer.BlockCopy(tag, 0, packed, NonceSize, TagSize);
            Buffer.BlockCopy(cipher, 0, packed, NonceSize + TagSize, cipher.Length);

            return Convert.ToBase64String(packed);
        }

        public string Unprotect(string ciphertext)
        {
            if (string.IsNullOrWhiteSpace(ciphertext)) throw new ArgumentNullException(nameof(ciphertext));

            var key = Key();
            var packed = Convert.FromBase64String(ciphertext);
            if (packed.Length < NonceSize + TagSize)
                throw new CryptographicException("El valor cifrado esta truncado.");

            var nonce = new byte[NonceSize];
            var tag = new byte[TagSize];
            var cipher = new byte[packed.Length - NonceSize - TagSize];
            Buffer.BlockCopy(packed, 0, nonce, 0, NonceSize);
            Buffer.BlockCopy(packed, NonceSize, tag, 0, TagSize);
            Buffer.BlockCopy(packed, NonceSize + TagSize, cipher, 0, cipher.Length);

            var plain = new byte[cipher.Length];
            using (var aes = new AesGcm(key, TagSize))
                aes.Decrypt(nonce, cipher, tag, plain);   // lanza si el tag no valida

            return Encoding.UTF8.GetString(plain);
        }
    }
}
