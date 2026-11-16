using System.Security.Cryptography;
using System.Text;
using Org.BouncyCastle.Crypto.Generators;

namespace EmCoreInventory.Api.Auth;

internal static class PasswordHash
{
    private static readonly string Dummy = Create("invalid-password");
    internal static string Hash(string value) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    internal static string Create(string password)
    {
        var salt = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(16));
        return salt + ":" + Convert.ToHexStringLower(Derive(password, salt));
    }
    private static byte[] Derive(string password, string salt) => SCrypt.Generate(Encoding.UTF8.GetBytes(password), Encoding.UTF8.GetBytes(salt), 16384, 8, 1, 64);
    internal static bool Matches(string? password, string? stored)
    {
        if (password is null || password.Length > 128) return false;
        var parts = (stored ?? Dummy).Split(':');
        if (parts.Length != 2 || parts[0].Length != 32 || parts[1].Length != 128) return false;
        try { return CryptographicOperations.FixedTimeEquals(Derive(password, parts[0]), Convert.FromHexString(parts[1])); }
        catch (FormatException) { return false; }
    }
}
