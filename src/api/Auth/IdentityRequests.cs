namespace EmCoreInventory.Api.Auth;

internal sealed class SetupRequest
{
    public required string Username { get; init; }
    public required string Name { get; init; }
    public required string Password { get; init; }
    public required string ServiceName { get; init; }
    public string LicenseLevel { get; init; } = "Driver";
}

internal sealed class LoginRequest
{
    public required string Username { get; init; }
    public required string Password { get; init; }
}

internal sealed class PasswordChangeRequest
{
    public required string CurrentPassword { get; init; }
    public required string Password { get; init; }
}

internal sealed record ServiceSelectionRequest(string ServiceId);
internal sealed record CompanyStatusRequest(string Id, bool Active);

internal sealed class CompanyDeleteRequest
{
    public required string Id { get; init; }
    public required string CurrentPassword { get; init; }
    public required string ConfirmCompanyName { get; init; }
    public required bool AcknowledgePermanentDeletion { get; init; }
}

internal sealed class UserSaveRequest
{
    public string? Id { get; init; }
    public required string Username { get; init; }
    public required string Name { get; init; }
    public required string[] Tags { get; init; }
    public string? LicenseLevel { get; init; }
    public string? Password { get; init; }
    public bool? PlatformAdmin { get; init; }
    public bool Active { get; init; } = true;
}

internal sealed class CompanySaveRequest
{
    public string? Id { get; init; }
    public required string Name { get; init; }
    public string? DeaRegistrant { get; init; }
    public string? DeaNumber { get; init; }
    public string? DeaExpiresOn { get; init; }
    public string? DeaSchedules { get; init; }
    public string? Address { get; init; }
    public string? ContactName { get; init; }
    public string? ContactEmail { get; init; }
    public string? ContactPhone { get; init; }
    public string? Notes { get; init; }
    public string? ServiceChief { get; init; }
    public string? DeaContact { get; init; }
    public string? BackupDeaContact { get; init; }
    public string? MedicalDirector { get; init; }
    public string? AssistantMedicalDirector { get; init; }
}
