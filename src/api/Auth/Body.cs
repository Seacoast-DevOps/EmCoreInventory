using System.Text.Json;
using System.Text.Json.Nodes;
using EmCoreInventory.Api.Common;

namespace EmCoreInventory.Api.Auth;

internal static class Body
{
    internal static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);
    internal static string Text(this JsonObject body, string key, string fallback = "") => body[key] is JsonValue value && value.TryGetValue<string>(out var text) ? text : fallback;
    internal static bool Flag(this JsonObject body, string key, bool fallback = false) => body[key] is JsonValue value && value.TryGetValue<bool>(out var flag) ? flag : fallback;
    internal static string[] Strings(this JsonObject body, string key) => body[key] is JsonArray array ? array.Select(value => value is JsonValue scalar && scalar.TryGetValue<string>(out var text) ? text : "").ToArray() : [];
    internal static string[] ReadStrings(string? value) => string.IsNullOrEmpty(value) ? [] : JsonSerializer.Deserialize<string[]>(value) ?? [];
    internal static string Encode(object value) => JsonSerializer.Serialize(value, Options);
    internal static JsonObject Object(string? value) => string.IsNullOrEmpty(value) ? new() : JsonNode.Parse(value)?.AsObject() ?? new();
    internal static void RequireString(JsonObject body, string key, int max, bool required = true)
    {
        if (body[key] is not JsonValue value || !value.TryGetValue<string>(out var text) || text.Length > max || (required && string.IsNullOrWhiteSpace(text)))
            throw new ApiException(400, "Invalid " + key);
    }
    internal static string Now() => DateTimeOffset.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'");
}
