using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using EmCoreInventory.Api.Authorization;

namespace EmCoreInventory.Api.Inventory;

// The operation payload uses the browser's JSON field names and string values.
// The witness service strips credentials before it is saved or audited.
internal abstract record InventoryRequest
{
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase, allowIntegerValues: false) }
    };

    internal static JsonObject ToBody(InventoryRequest request) =>
        JsonSerializer.SerializeToNode(request, request.GetType(), Options)!.AsObject();
}

internal sealed record WitnessCredentialsRequest(string Username, string Password);
internal sealed record SealConfirmation(string Id, string? Seal);

internal abstract record WitnessedRequest : InventoryRequest
{
    public WitnessCredentialsRequest? WitnessCredentials { get; init; }
}

internal abstract record StockChangeRequest : WitnessedRequest
{
    public SealConfirmation[]? BrokenSeals { get; init; }
}

internal sealed record VerifyRequest(string ItemId, bool Verified) : InventoryRequest;
internal sealed record MoveRequest(string ItemId, string SourceId, string DestinationId) : StockChangeRequest;

internal sealed record ReceiveRequest(string DefinitionId, int Quantity) : StockChangeRequest
{
    public string? BoxId { get; init; }
    public bool? Replacement { get; init; }
    public bool? BatchCreate { get; init; }
    public string? LotNumber { get; init; }
    [JsonConverter(typeof(OptionalDateConverter))]
    public DateOnly? ExpirationDate { get; init; }
    public CodeMode? CodeMode { get; init; }
    public string[]? Codes { get; init; }
}

// Older non-batch clients send an empty date when none was recorded.
internal sealed class OptionalDateConverter : JsonConverter<DateOnly?>
{
    public override DateOnly? Read(ref Utf8JsonReader reader, Type type, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null) return null;
        if (reader.TokenType == JsonTokenType.String)
        {
            var text = reader.GetString();
            if (text == "") return null;
            if (DateOnly.TryParseExact(text, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date)) return date;
        }
        throw new JsonException("Use a calendar date in yyyy-MM-dd format.");
    }

    public override void Write(Utf8JsonWriter writer, DateOnly? value, JsonSerializerOptions options) =>
        writer.WriteStringValue(value?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
}

internal enum CodeMode { Auto, Manual }
internal enum CheckKind { Scheduled, Reset, Adhoc }
internal enum SealAction { Break, Reseal }
internal enum ContainerIcon { Box, Cabinet, Truck, Lock, Medical }
internal enum ContainerKind
{
    [JsonStringEnumMemberName("Drug box")] DrugBox,
    [JsonStringEnumMemberName("Cabinet")] Cabinet,
    [JsonStringEnumMemberName("Narcotic box")] NarcoticBox,
    [JsonStringEnumMemberName("Pelican box")] PelicanBox
}

internal sealed record StartCheckRequest(string BoxId, CheckKind Kind) : InventoryRequest;
internal sealed record VerifyCheckRequest(string BoxId, int Revision, string ItemId, bool Verified, string? Notes = null) : InventoryRequest;
internal sealed record SaveCheckRequest(string BoxId, int Revision, string? Notes = null) : InventoryRequest;
internal sealed record SealRequest(string BoxId, SealAction Action, string? Seal = null, string? IncidentNumber = null) : StockChangeRequest;
internal sealed record DiscrepancyRequest(string BoxId, string Notes, string? ItemCode = null) : InventoryRequest;
internal sealed record ApproveDiscrepancyRequest(string Id, int Revision, string Resolution) : InventoryRequest;

internal sealed record ContainerRequest(
    string Name, string Location, ContainerKind Kind, ContainerIcon Icon,
    bool Sealed, bool Transparent, double CheckIntervalHours,
    string? Id = null, string? Seal = null, string[]? AllowedRoles = null) : StockChangeRequest;

// Draft doses can contain unfinished input. The operation validates their
// quantities against the current vial balance when the incident is completed.
[JsonConverter(typeof(DraftDoseConverter))]
internal readonly record struct DraftDose(string? Input, double? Amount);

internal sealed class DraftDoseConverter : JsonConverter<DraftDose>
{
    public override DraftDose Read(ref Utf8JsonReader reader, Type type, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.String) return new(reader.GetString(), null);
        if (reader.TokenType == JsonTokenType.Number && reader.TryGetDouble(out var value) && double.IsFinite(value))
            return new(null, value);
        throw new JsonException("A dose must be a number or a draft input string.");
    }

    public override void Write(Utf8JsonWriter writer, DraftDose value, JsonSerializerOptions options)
    {
        if (value.Amount is double amount) writer.WriteNumberValue(amount);
        else writer.WriteStringValue(value.Input);
    }
}

internal sealed record IncidentItemRequest(string Id, string? BoxId = null, DraftDose? Given = null, DraftDose? Wasted = null);
internal sealed record IncidentRequest(IncidentItemRequest[] Items) : StockChangeRequest
{
    public int? Id { get; init; }
    public int? Revision { get; init; }
    public string? ClientKey { get; init; }
    public string? IncidentNumber { get; init; }
    public string? Reason { get; init; }
    public string? Notes { get; init; }
    public string? CorrectionNote { get; init; }
}
internal sealed record ReopenIncidentRequest(int Id, int Revision) : InventoryRequest;

internal enum WitnessRequirement
{
    Entire, Partial, Replacement, Resealed, Disposal, Opening, Transfer,
    [JsonStringEnumMemberName("seal_break")] SealBreak
}

internal sealed record TagRequest(string Name, WitnessRequirement[] Requirements, string? Id = null) : InventoryRequest;
internal sealed record ClassRequest(string Name, string? Id = null, string? Description = null) : InventoryRequest;
internal sealed record ProfileRequest(string Name, string[] Tags, string? Id = null) : InventoryRequest;
internal sealed record RuleRequest(string Resource, PolicyRule Rule) : InventoryRequest;
internal sealed record ParTarget(string BoxId, int Target);
internal enum MedicationUnit
{
    [JsonStringEnumMemberName("mcg")] Microgram,
    [JsonStringEnumMemberName("mg")] Milligram,
    [JsonStringEnumMemberName("g")] Gram,
    Units,
    [JsonStringEnumMemberName("mEq")] Milliequivalent,
    [JsonStringEnumMemberName("mmol")] Millimole
}

internal enum ConcentrationBasis
{
    [JsonStringEnumMemberName("mL")] Milliliter,
    Vial, Ampule, Syringe, Bag, Tablet, Pack
}

internal enum MedicationForm
{
    [JsonStringEnumMemberName("Vial")] Vial,
    [JsonStringEnumMemberName("Ampule")] Ampule,
    [JsonStringEnumMemberName("Prefilled syringe")] PrefilledSyringe,
    [JsonStringEnumMemberName("Premixed bag")] PremixedBag,
    [JsonStringEnumMemberName("Tablet")] Tablet,
    [JsonStringEnumMemberName("ODT")] OrallyDisintegratingTablet,
    [JsonStringEnumMemberName("Pack")] Pack
}

internal enum MinimumMedicationLicense
{
    [JsonStringEnumMemberName("EMT")] Emt,
    [JsonStringEnumMemberName("AEMT")] Aemt,
    [JsonStringEnumMemberName("Paramedic")] Paramedic
}

internal sealed record DefinitionRequest(
    string Name, double ConcentrationValue, MedicationUnit AmountUnit, ConcentrationBasis ConcentrationBasis,
    double MaxAmount, MedicationForm Form, string[] TagIds, ParTarget[] ParTargets) : InventoryRequest
{
    public string? Id { get; init; }
    public MinimumMedicationLicense? MinimumLicense { get; init; }
    public bool? IsNarcotic { get; init; }
    public double? CheckIntervalHours { get; init; }
    public string? MedicationClassId { get; init; }
    public Dictionary<string, PolicyRule>? AccessRules { get; init; }
}
