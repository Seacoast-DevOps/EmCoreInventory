using System.Security.Cryptography;
using System.Text;
using EmCoreInventory.Api.Common;
using Org.BouncyCastle.Crypto.Generators;

namespace EmCoreInventory.Api.Auth;

internal static class PasswordHash
{
    private const int KeyLength = 64;
    // Each derivation allocates roughly 16 MiB. Reject excess work without queuing under a database lock.
    private static readonly SemaphoreSlim DerivationSlots = new(2, 2);
    private static readonly string DummySalt = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(16));

    internal static string Hash(string value) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));

    internal static string Create(string password)
    {
        var salt = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(16));
        var key = Derive(password, salt);
        try { return salt + ":" + Convert.ToHexStringLower(key); }
        finally { CryptographicOperations.ZeroMemory(key); }
    }

    private static byte[] Derive(string password, string salt)
    {
        if (!DerivationSlots.Wait(0))
            throw new ApiException(429, "Too many password requests. Try again shortly.");

        var bytes = Encoding.UTF8.GetBytes(password);
        try { return SCrypt.Generate(bytes, Encoding.UTF8.GetBytes(salt), 16384, 8, 1, KeyLength); }
        finally
        {
            CryptographicOperations.ZeroMemory(bytes);
            DerivationSlots.Release();
        }
    }

    internal static bool Matches(string? password, string? stored)
    {
        if (string.IsNullOrEmpty(password) || password.Length > 128) return false;
        Span<byte> expected = stackalloc byte[KeyLength];
        expected.Clear();
        var validFormat = stored is { Length: 161 } && stored[32] == ':' &&
            Convert.FromHexString(stored.AsSpan(33), expected, out _, out var bytesWritten) == System.Buffers.OperationStatus.Done
            && bytesWritten == KeyLength;
        var actual = Derive(password, validFormat ? stored![..32] : DummySalt);
        try { return CryptographicOperations.FixedTimeEquals(actual, expected) && validFormat; }
        finally
        {
            CryptographicOperations.ZeroMemory(actual);
            CryptographicOperations.ZeroMemory(expected);
        }
    }
}
