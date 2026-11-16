using System.Text.Json.Serialization;

namespace EmCoreInventory.Api.Auth;

public sealed record UserContext
{
    public string Id { get; init; } = "";
    public string Username { get; init; } = "";
    public string Name { get; init; } = "";
    public string[] Tags { get; init; } = [];
    public string ServiceId { get; init; } = "";
    public string ServiceName { get; init; } = "";
    public string LicenseLevel { get; init; } = "Driver";
    public string PlatformRole { get; init; } = "";
    public bool PlatformOnly => ServiceId == "platform";
    public bool CompanyActive { get; init; } = true;
    [JsonIgnore] public string TokenHash { get; init; } = "";
    [JsonIgnore] public string Actor => Name + " (@" + Username + ")";
}
