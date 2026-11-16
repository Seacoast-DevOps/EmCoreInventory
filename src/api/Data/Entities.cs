using System.Text.Json.Serialization;

namespace EmCoreInventory.Api.Data;

public sealed class InventoryBox
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";
    [JsonPropertyName("location")]
    public string Location { get; set; } = "";
    [JsonPropertyName("name")]
    public string Name { get; set; } = "";
    [JsonPropertyName("sealed")]
    public int Sealed { get; set; } = 0;
    [JsonPropertyName("seal")]
    public string? Seal { get; set; }
    [JsonPropertyName("transparent")]
    public int Transparent { get; set; } = 0;
    [JsonPropertyName("check_interval_hours")]
    public double CheckIntervalHours { get; set; } = 24;
    [JsonPropertyName("icon")]
    public string Icon { get; set; } = "box";
    [JsonPropertyName("kind")]
    public string Kind { get; set; } = "Drug box";
    [JsonPropertyName("stock_revision")]
    public int StockRevision { get; set; } = 0;
    [JsonPropertyName("allowed_roles")]
    public string AllowedRoles { get; set; } = "[\"Driver\",\"EMT\",\"AEMT\",\"Paramedic\",\"Supervisor\",\"Company Admin\",\"Seacoast Admin\"]";
}

public sealed class InventoryItem
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";
    [JsonPropertyName("box_id")]
    public string BoxId { get; set; } = "";
    [JsonPropertyName("medication")]
    public string Medication { get; set; } = "";
    [JsonPropertyName("presentation")]
    public string Presentation { get; set; } = "";
    [JsonPropertyName("verified_at")]
    public string? VerifiedAt { get; set; }
    [JsonPropertyName("code")]
    public string? Code { get; set; }
    [JsonPropertyName("status")]
    public string Status { get; set; } = "available";
    [JsonPropertyName("received_at")]
    public string? ReceivedAt { get; set; }
    [JsonPropertyName("external_source")]
    public string? ExternalSource { get; set; }
    [JsonPropertyName("external_id")]
    public string? ExternalId { get; set; }
    [JsonPropertyName("definition_id")]
    public string? DefinitionId { get; set; }
    [JsonPropertyName("definition_snapshot")]
    public string? DefinitionSnapshot { get; set; }
    [JsonPropertyName("amount_total")]
    public double? AmountTotal { get; set; }
    [JsonPropertyName("remaining_amount")]
    public double? RemainingAmount { get; set; }
    [JsonPropertyName("batch_id")]
    public string? BatchId { get; set; }
    [JsonPropertyName("lot_number")]
    public string? LotNumber { get; set; }
    [JsonPropertyName("expires_on")]
    public string? ExpiresOn { get; set; }
    [JsonPropertyName("was_opened")]
    public int WasOpened { get; set; } = 0;
}

public sealed class InventoryEvent
{
    [JsonPropertyName("id")]
    public int Id { get; set; }
    [JsonPropertyName("item_id")]
    public string ItemId { get; set; } = "";
    [JsonPropertyName("action")]
    public string Action { get; set; } = "";
    [JsonPropertyName("from_box")]
    public string? FromBox { get; set; }
    [JsonPropertyName("to_box")]
    public string? ToBox { get; set; }
    [JsonPropertyName("details")]
    public string? Details { get; set; }
    [JsonPropertyName("created_at")]
    public string CreatedAt { get; set; } = "";
    [JsonPropertyName("actor_profile")]
    public string? ActorProfile { get; set; }
    [JsonPropertyName("actor_user_id")]
    public string? ActorUserId { get; set; }
}

public sealed class InventorySeed
{
    [JsonPropertyName("version")]
    public int Version { get; set; }
}

public sealed class Incident
{
    [JsonPropertyName("id")]
    public int Id { get; set; }
    [JsonPropertyName("incident_number")]
    public string? IncidentNumber { get; set; }
    [JsonPropertyName("reason")]
    public string Reason { get; set; } = "";
    [JsonPropertyName("notes")]
    public string Notes { get; set; } = "";
    [JsonPropertyName("created_at")]
    public string CreatedAt { get; set; } = "";
    [JsonPropertyName("status")]
    public string Status { get; set; } = "completed";
    [JsonPropertyName("revision")]
    public int Revision { get; set; } = 1;
    [JsonPropertyName("payload")]
    public string? Payload { get; set; }
    [JsonPropertyName("updated_at")]
    public string? UpdatedAt { get; set; }
    [JsonPropertyName("client_key")]
    public string? ClientKey { get; set; }
}

public sealed class IncidentItem
{
    [JsonPropertyName("incident_id")]
    public int IncidentId { get; set; }
    [JsonPropertyName("item_id")]
    public string ItemId { get; set; } = "";
}

public sealed class MedicationTag
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";
    [JsonPropertyName("name")]
    public string Name { get; set; } = "";
    [JsonPropertyName("requirements")]
    public string Requirements { get; set; } = "";
}

public sealed class DrugDefinition
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";
    [JsonPropertyName("name")]
    public string Name { get; set; } = "";
    [JsonPropertyName("concentration_value")]
    public double ConcentrationValue { get; set; }
    [JsonPropertyName("amount_unit")]
    public string AmountUnit { get; set; } = "";
    [JsonPropertyName("concentration_basis")]
    public string ConcentrationBasis { get; set; } = "";
    [JsonPropertyName("max_amount")]
    public double MaxAmount { get; set; }
    [JsonPropertyName("form")]
    public string Form { get; set; } = "";
    [JsonPropertyName("check_interval_hours")]
    public double CheckIntervalHours { get; set; } = 24;
    [JsonPropertyName("source_note")]
    public string? SourceNote { get; set; }
    [JsonPropertyName("source_url")]
    public string? SourceUrl { get; set; }
    [JsonPropertyName("medication_class_id")]
    public string? MedicationClassId { get; set; }
    [JsonPropertyName("access_rules")]
    public string AccessRules { get; set; } = "{}";
    [JsonPropertyName("minimum_license")]
    public string MinimumLicense { get; set; } = "Paramedic";
    [JsonPropertyName("is_narcotic")]
    public int IsNarcotic { get; set; } = 0;
}

public sealed class DefinitionTag
{
    [JsonPropertyName("definition_id")]
    public string DefinitionId { get; set; } = "";
    [JsonPropertyName("tag_id")]
    public string TagId { get; set; } = "";
}

public sealed class ParLevel
{
    [JsonPropertyName("definition_id")]
    public string DefinitionId { get; set; } = "";
    [JsonPropertyName("box_id")]
    public string BoxId { get; set; } = "";
    [JsonPropertyName("target")]
    public int Target { get; set; }
}

public sealed class SettingsEvent
{
    [JsonPropertyName("id")]
    public int Id { get; set; }
    [JsonPropertyName("entity_id")]
    public string EntityId { get; set; } = "";
    [JsonPropertyName("action")]
    public string Action { get; set; } = "";
    [JsonPropertyName("details")]
    public string Details { get; set; } = "";
    [JsonPropertyName("created_at")]
    public string CreatedAt { get; set; } = "";
    [JsonPropertyName("actor_profile")]
    public string? ActorProfile { get; set; }
    [JsonPropertyName("actor_user_id")]
    public string? ActorUserId { get; set; }
}

public sealed class TrackingCode
{
    [JsonPropertyName("code")]
    public string Code { get; set; } = "";
    [JsonPropertyName("item_id")]
    public string ItemId { get; set; } = "";
    [JsonPropertyName("issued_at")]
    public string IssuedAt { get; set; } = "";
}

public sealed class IncidentAllocation
{
    [JsonPropertyName("incident_id")]
    public int IncidentId { get; set; }
    [JsonPropertyName("item_id")]
    public string ItemId { get; set; } = "";
    [JsonPropertyName("given")]
    public double Given { get; set; }
    [JsonPropertyName("wasted")]
    public double Wasted { get; set; }
}

public sealed class IncidentVersion
{
    [JsonPropertyName("id")]
    public int Id { get; set; }
    [JsonPropertyName("incident_id")]
    public int IncidentId { get; set; }
    [JsonPropertyName("revision")]
    public int Revision { get; set; }
    [JsonPropertyName("status")]
    public string Status { get; set; } = "";
    [JsonPropertyName("payload")]
    public string Payload { get; set; } = "";
    [JsonPropertyName("created_at")]
    public string CreatedAt { get; set; } = "";
}

public sealed class DrugCheck
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";
    [JsonPropertyName("box_id")]
    public string BoxId { get; set; } = "";
    [JsonPropertyName("status")]
    public string Status { get; set; } = "";
    [JsonPropertyName("kind")]
    public string Kind { get; set; } = "";
    [JsonPropertyName("item_ids")]
    public string ItemIds { get; set; } = "";
    [JsonPropertyName("checked_ids")]
    public string CheckedIds { get; set; } = "";
    [JsonPropertyName("notes")]
    public string Notes { get; set; } = "";
    [JsonPropertyName("revision")]
    public int Revision { get; set; } = 1;
    [JsonPropertyName("created_at")]
    public string CreatedAt { get; set; } = "";
    [JsonPropertyName("updated_at")]
    public string UpdatedAt { get; set; } = "";
    [JsonPropertyName("completed_at")]
    public string? CompletedAt { get; set; }
    [JsonPropertyName("stock_revision")]
    public int StockRevision { get; set; } = 0;
}

public sealed class MedicationClass
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";
    [JsonPropertyName("name")]
    public string Name { get; set; } = "";
    [JsonPropertyName("description")]
    public string Description { get; set; } = "";
}

public sealed class AccessProfile
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";
    [JsonPropertyName("name")]
    public string Name { get; set; } = "";
    [JsonPropertyName("tags")]
    public string Tags { get; set; } = "";
}

public sealed class AccessRule
{
    [JsonPropertyName("resource")]
    public string Resource { get; set; } = "";
    [JsonPropertyName("rule")]
    public string Rule { get; set; } = "";
}

public sealed class AccessAudit
{
    [JsonPropertyName("id")]
    public int Id { get; set; }
    [JsonPropertyName("actor_profile")]
    public string ActorProfile { get; set; } = "";
    [JsonPropertyName("action")]
    public string Action { get; set; } = "";
    [JsonPropertyName("details")]
    public string Details { get; set; } = "";
    [JsonPropertyName("created_at")]
    public string CreatedAt { get; set; } = "";
}

public sealed class InventoryBatch
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";
    [JsonPropertyName("definition_id")]
    public string DefinitionId { get; set; } = "";
    [JsonPropertyName("lot_number")]
    public string LotNumber { get; set; } = "";
    [JsonPropertyName("expires_on")]
    public string ExpiresOn { get; set; } = "";
    [JsonPropertyName("quantity")]
    public int Quantity { get; set; }
    [JsonPropertyName("created_at")]
    public string CreatedAt { get; set; } = "";
}

public sealed class WitnessSignoff
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";
    [JsonPropertyName("actor_user_id")]
    public string ActorUserId { get; set; } = "";
    [JsonPropertyName("witness_user_id")]
    public string WitnessUserId { get; set; } = "";
    [JsonPropertyName("witness_username")]
    public string WitnessUsername { get; set; } = "";
    [JsonPropertyName("witness_name")]
    public string WitnessName { get; set; } = "";
    [JsonPropertyName("service_id")]
    public string ServiceId { get; set; } = "";
    [JsonPropertyName("action")]
    public string Action { get; set; } = "";
    [JsonPropertyName("request_hash")]
    public string RequestHash { get; set; } = "";
    [JsonPropertyName("created_at")]
    public string CreatedAt { get; set; } = "";
}

public sealed class Service
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";
    [JsonPropertyName("name")]
    public string Name { get; set; } = "";
    [JsonPropertyName("details")]
    public string Details { get; set; } = "{}";
    [JsonPropertyName("active")]
    public int Active { get; set; } = 1;
    [JsonPropertyName("internal")]
    public int Internal { get; set; } = 0;
}

public sealed class User
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";
    [JsonPropertyName("username")]
    public string Username { get; set; } = "";
    [JsonPropertyName("name")]
    public string Name { get; set; } = "";
    [JsonPropertyName("password_hash")]
    public string PasswordHash { get; set; } = "";
    [JsonPropertyName("created_at")]
    public string CreatedAt { get; set; } = "";
    [JsonPropertyName("platform_role")]
    public string PlatformRole { get; set; } = "";
    [JsonPropertyName("license_level")]
    public string LicenseLevel { get; set; } = "Driver";
}

public sealed class ServiceMembership
{
    [JsonPropertyName("user_id")]
    public string UserId { get; set; } = "";
    [JsonPropertyName("service_id")]
    public string ServiceId { get; set; } = "";
    [JsonPropertyName("tags")]
    public string Tags { get; set; } = "";
    [JsonPropertyName("active")]
    public int Active { get; set; } = 1;
}

public sealed class UserSession
{
    [JsonPropertyName("token_hash")]
    public string TokenHash { get; set; } = "";
    [JsonPropertyName("user_id")]
    public string UserId { get; set; } = "";
    [JsonPropertyName("service_id")]
    public string ServiceId { get; set; } = "";
    [JsonPropertyName("expires_at")]
    public long ExpiresAt { get; set; }
}

public sealed class IdentityAudit
{
    [JsonPropertyName("id")]
    public int Id { get; set; }
    [JsonPropertyName("service_id")]
    public string? ServiceId { get; set; }
    [JsonPropertyName("actor_id")]
    public string? ActorId { get; set; }
    [JsonPropertyName("actor")]
    public string Actor { get; set; } = "";
    [JsonPropertyName("action")]
    public string Action { get; set; } = "";
    [JsonPropertyName("details")]
    public string Details { get; set; } = "";
    [JsonPropertyName("created_at")]
    public string CreatedAt { get; set; } = "";
}

public sealed class LoginAttempt
{
    [JsonPropertyName("key")]
    public string Key { get; set; } = "";
    [JsonPropertyName("failures")]
    public int Failures { get; set; }
    [JsonPropertyName("until_ms")]
    public long UntilMs { get; set; }
}

public sealed class Discrepancy
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";
    [JsonPropertyName("box_id")]
    public string BoxId { get; set; } = "";
    [JsonPropertyName("item_id")]
    public string? ItemId { get; set; }
    [JsonPropertyName("notes")]
    public string Notes { get; set; } = "";
    [JsonPropertyName("status")]
    public string Status { get; set; } = "open";
    [JsonPropertyName("reported_by")]
    public string ReportedBy { get; set; } = "";
    [JsonPropertyName("reported_at")]
    public string ReportedAt { get; set; } = "";
    [JsonPropertyName("approved_by")]
    public string? ApprovedBy { get; set; }
    [JsonPropertyName("approved_at")]
    public string? ApprovedAt { get; set; }
    [JsonPropertyName("resolution")]
    public string Resolution { get; set; } = "";
    [JsonPropertyName("revision")]
    public int Revision { get; set; } = 1;
}

public sealed class CompanyMigration
{
    [JsonPropertyName("version")]
    public int Version { get; set; }
}

public sealed class CompanyTombstone
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";
    [JsonPropertyName("name")]
    public string Name { get; set; } = "";
    [JsonPropertyName("deleted_at")]
    public string DeletedAt { get; set; } = "";
    [JsonPropertyName("actor_id")]
    public string ActorId { get; set; } = "";
}
