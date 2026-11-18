using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace EmCoreInventory.Api.Data;

[JsonConverter(typeof(StatusJsonConverter<InventoryItemStatus>))]
public enum InventoryItemStatus
{
    Available,
    Opened,
    Unassigned,
    Used,
    Disposed
}

[JsonConverter(typeof(StatusJsonConverter<IncidentStatus>))]
public enum IncidentStatus
{
    Completed,
    Draft,
    Reopened
}

[JsonConverter(typeof(StatusJsonConverter<DrugCheckStatus>))]
public enum DrugCheckStatus
{
    Draft,
    Complete,
    Superseded
}

[JsonConverter(typeof(StatusJsonConverter<DiscrepancyStatus>))]
public enum DiscrepancyStatus
{
    Open,
    Approved
}

internal sealed class StatusJsonConverter<TStatus> : JsonStringEnumConverter<TStatus> where TStatus : struct, Enum
{
    public StatusJsonConverter() : base(JsonNamingPolicy.CamelCase, allowIntegerValues: false) { }
}

internal sealed class StatusValueConverter<TStatus> : ValueConverter<TStatus, string> where TStatus : struct, Enum
{
    public StatusValueConverter() : base(
        status => StatusNames.Format(status),
        value => Enum.Parse<TStatus>(value, true)) { }
}

internal static class StatusNames
{
    internal static string Format<TStatus>(TStatus status) where TStatus : struct, Enum =>
        JsonNamingPolicy.CamelCase.ConvertName(status.ToString());
}
