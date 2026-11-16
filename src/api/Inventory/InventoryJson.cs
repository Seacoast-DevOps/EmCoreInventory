using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using EmCoreInventory.Api.Common;

namespace EmCoreInventory.Api.Inventory;

internal static class InventoryJson
{
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);
    private static readonly JsonSerializerOptions Rows = new() { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower };
    internal static JsonObject Row(object value) => JsonSerializer.SerializeToNode(value, Rows)!.AsObject();
    internal static JsonNode? Node(object? value) => JsonSerializer.SerializeToNode(value, Web);
    internal static JsonArray Array<T>(IEnumerable<T> values) => new(values.Select(x => Node(x)).ToArray());
    internal static JsonArray RowArray<T>(IEnumerable<T> values) => new(values.Select(x => (JsonNode?)Row(x!)).ToArray());
    internal static JsonObject Object(string? value) => JsonNode.Parse(value ?? "{}") as JsonObject ?? new();
    internal static string[] Strings(string? value) => JsonSerializer.Deserialize<string[]>(value ?? "[]") ?? [];
    internal static string Text(this JsonObject body, string key, string fallback = "") => body[key] is JsonValue v && v.TryGetValue<string>(out var s) ? s : fallback;
    internal static string? OptionalText(this JsonObject body, string key) => body[key] is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;
    internal static double Number(this JsonObject body, string key, double fallback = double.NaN) => Number(body[key], fallback);
    internal static double Number(JsonNode? node, double fallback = double.NaN)
    {
        if (node is JsonValue v && v.TryGetValue<double>(out var n)) return n;
        return node is JsonValue s && s.TryGetValue<string>(out var text) && double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out n) ? n : fallback;
    }
    internal static int Integer(this JsonObject body, string key, int fallback = 0) => body[key] is JsonValue v && v.TryGetValue<int>(out var n) ? n : fallback;
    internal static bool IsNumber(this JsonObject body, string key) => body[key] is JsonValue v && v.TryGetValue<double>(out _);
    internal static bool IsBoolean(this JsonObject body, string key) => body[key] is JsonValue v && v.TryGetValue<bool>(out _);
    internal static bool Boolean(this JsonObject body, string key) => body[key] is JsonValue v && v.TryGetValue<bool>(out var b) && b;
    internal static IEnumerable<JsonObject> Entries(this JsonObject body, string key) => body[key] is JsonArray a ? a.OfType<JsonObject>() : [];
    internal static void Require(bool valid, string message, int status = 400) { if (!valid) throw new ApiException(status, message); }
    internal static string Serialize(object value) => JsonSerializer.Serialize(value, Web);
}
