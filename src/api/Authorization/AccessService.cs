using System.Text.Json;
using System.Text.Json.Nodes;
using EmCoreInventory.Api.Auth;
using EmCoreInventory.Api.Common;
using EmCoreInventory.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace EmCoreInventory.Api.Authorization;

public sealed record AccessContext(UserContext User, Dictionary<string, PolicyRule> Rules, Dictionary<string, bool> Permissions)
{
    public UserContext Profile => User;
    public string Actor => User.Actor;
}

public static class AccessService
{
    public static bool IsSeacoast(UserContext profile) => profile.PlatformRole == "Seacoast Admin" || profile.Tags.Contains("Seacoast Admin");
    public static bool CompanyAdmin(UserContext profile) => !profile.Tags.Contains("Read Only") && (IsSeacoast(profile) || profile.Tags.Any(t => t is "Company Admin" or "Service Admin"));
    public static string MatrixRole(UserContext profile) => IsSeacoast(profile) ? "Seacoast Admin" : profile.Tags.Any(t => t is "Company Admin" or "Service Admin") ? "Company Admin" : profile.Tags.Contains("Supervisor") ? "Supervisor" : profile.LicenseLevel;
    public static bool NeedsPartner(UserContext profile) => profile.LicenseLevel == "Driver";
    public static string[] DefaultTags(string license = "Driver", string role = "User")
    {
        var tags = new List<string> { license, "User", "Can Check", "Can Witness" };
        if (license != "Driver" || role != "User") tags.AddRange(["Can Create", "Can Edit", "Can Administer", "Can Waste", "Can Transfer"]);
        if (role != "User") tags.Add(role);
        return tags.Distinct().ToArray();
    }
    public static bool MatrixAllowed(UserContext profile, string resource)
    {
        if (profile.Tags.Contains("Read Only") && !resource.EndsWith(".view")) return false;
        var key = resource switch
        {
            "medications.administer" or "medications.waste" => resource + ".nonNarcotic",
            "definitions.create" or "tags.edit" or "classes.edit" => "definitions.edit",
            "checks.save" or "checks.complete" or "checks.reset" or "checks.adhoc" => "checks.start",
            _ => resource
        };
        var role = MatrixRole(profile);
        if (resource is "policies.view" or "containers.view" or "tags.view" or "logs.view") return PolicyCatalog.ManagementRoles.Contains(role);
        if (resource.StartsWith("incidents.")) return resource.EndsWith(".view") || role != "Driver";
        var rule = PolicyCatalog.Matrix.FirstOrDefault(row => row.Id == key);
        return rule?.Roles.Contains(role) ?? new[] { "home.view", "inventory.view", "stock.view", "records.view", "classes.view", "discrepancies.view", "discrepancies.report", "users.view", "services.view", "account.view" }.Contains(resource);
    }
    public static bool MatchesRule(string[] tags, PolicyRule? rule)
    {
        static string Normalize(string tag) => tag == "Service Admin" ? "Company Admin" : tag;
        var normalized = tags.Select(Normalize).ToHashSet();
        return rule is null || ((rule.AnyTags.Length == 0 || rule.AnyTags.Any(tag => normalized.Contains(Normalize(tag)))) && rule.AllTags.All(tag => normalized.Contains(Normalize(tag))));
    }
    public static AccessContext Context(InventoryDbContext? db, UserContext user)
    {
        var rules = db?.AccessRules.AsNoTracking().AsEnumerable().ToDictionary(row => row.Resource, row => JsonSerializer.Deserialize<PolicyRule>(row.Rule, Body.Options) ?? new([], [])) ?? new Dictionary<string, PolicyRule>();
        var permissions = PolicyCatalog.Resources.ToDictionary(resource => resource.Id, resource =>
            ((!user.PlatformOnly && user.CompanyActive) || new[] { "home.view", "companies.create", "companies.edit", "companies.contacts", "companies.activate", "companies.delete" }.Contains(resource.Id)) &&
            MatrixAllowed(user, resource.Id) && MatchesRule(user.Tags, rules.GetValueOrDefault(resource.Id, resource.DefaultRule)));
        return new(user, rules, permissions);
    }
    public static object Snapshot(InventoryDbContext? db, AccessContext context) => new
    {
        user = new { context.User.Id, context.User.Username, context.User.Name, context.User.ServiceId, context.User.ServiceName, context.User.LicenseLevel, context.User.PlatformRole, context.User.PlatformOnly },
        profile = new { context.Profile.Id, context.Profile.Name, context.Profile.Tags, context.Profile.LicenseLevel, context.Profile.PlatformRole },
        context.Actor, context.Rules, context.Permissions,
        matrix = PolicyCatalog.Matrix, matrixRoles = PolicyCatalog.MatrixRoles,
        matrixRole = MatrixRole(context.Profile), licenseLevel = context.Profile.LicenseLevel,
        tags = PolicyCatalog.Tags, resources = PolicyCatalog.Resources, medicationActions = PolicyCatalog.MedicationActions,
        profiles = db?.AccessProfiles.AsNoTracking().OrderBy(p => p.Name).AsEnumerable().Select(p => new { p.Id, p.Name, tags = Body.ReadStrings(p.Tags) }).ToArray() ?? []
    };
    public static void Authorize(AccessContext context, string resource)
    {
        if (!context.Permissions.GetValueOrDefault(resource))
            throw new ApiException(403, "Your account cannot " + (PolicyCatalog.Resources.FirstOrDefault(r => r.Id == resource)?.Label.ToLowerInvariant() ?? resource));
    }
    public static bool MedicationPermitted(AccessContext context, DrugDefinition? drug, string action)
    {
        var profile = context.Profile;
        if (action is "administer" or "waste")
        {
            if (!MatrixAllowed(profile, "medications." + action)) return false;
            if (drug?.IsNarcotic != 0 && drug?.IsNarcotic is not null && profile.LicenseLevel != "Paramedic") return false;
            if (profile.LicenseLevel == "Driver" || Array.IndexOf(PolicyCatalog.LicenseLevels, profile.LicenseLevel) < Array.IndexOf(PolicyCatalog.LicenseLevels, drug?.MinimumLicense ?? "Paramedic")) return false;
        }
        var rules = Body.Object(drug?.AccessRules);
        return MatchesRule(profile.Tags, rules[action]?.Deserialize<PolicyRule>(Body.Options));
    }
    public static void AuthorizeMedication(AccessContext context, DrugDefinition? drug, string action)
    {
        if (!MedicationPermitted(context, drug, action)) throw new ApiException(403, "Medication policy does not allow " + action + " for " + (drug?.Name ?? "this drug"));
    }
    public static DrugDefinition? DrugForItem(InventoryDbContext db, InventoryItem item) => item.DefinitionId is null ? null : db.DrugDefinitions.Find(item.DefinitionId);
    public static bool StorageAllowed(AccessContext context, InventoryBox? box) => box is not null && Body.ReadStrings(box.AllowedRoles).Contains(MatrixRole(context.Profile));
    public static InventoryBox AuthorizeStorage(InventoryDbContext db, AccessContext context, string? id)
    {
        if (id is null) throw new ApiException(400, "Choose a storage container");
        var box = db.InventoryBoxes.Find(id) ?? throw new ApiException(404, "Storage container not found");
        if (!StorageAllowed(context, box)) throw new ApiException(403, "Your role cannot access " + box.Location + " — " + box.Name);
        return box;
    }
    public static bool TagsValid(JsonNode? value) => value is JsonArray tags && tags.All(t => t is JsonValue v && v.TryGetValue<string>(out var text) && PolicyCatalog.Tags.Any(option => option.Id == text)) && tags.Select(t => t!.GetValue<string>()).Distinct().Count() == tags.Count;
    public static bool ValidMedicationRules(JsonNode? rules) => rules is JsonObject obj && obj.All(pair => PolicyCatalog.MedicationActions.Contains(pair.Key) && pair.Value is JsonObject rule && TagsValid(rule["anyTags"]) && TagsValid(rule["allTags"]));
    internal static void SaveClass(InventoryDbContext db, AccessContext access, JsonObject body, string now)
    {
        Authorize(access, "classes.edit");
        Body.RequireString(body, "name", 100);
        if (body["description"] is not null) Body.RequireString(body, "description", 500, false);
        var id = body.Text("id", Guid.NewGuid().ToString());
        var row = db.MedicationClasses.Find(id);
        if (body.ContainsKey("id") && row is null) throw new ApiException(404, "Medication class not found");
        var name = body.Text("name").Trim();
        if (db.MedicationClasses.Any(c => c.Name.ToLower() == name.ToLower() && c.Id != id)) throw new ApiException(409, "That medication class already exists");
        if (row is null) { row = new MedicationClass { Id = id }; db.MedicationClasses.Add(row); }
        row.Name = name; row.Description = body.Text("description");
        RecordSetting(db, access, body, now, "class_saved");
    }

    internal static void SaveProfile(InventoryDbContext db, AccessContext access, JsonObject body, string now)
    {
        Authorize(access, "policies.edit");
        Body.RequireString(body, "name", 100);
        if (!TagsValid(body["tags"])) throw new ApiException(400, "Enter a profile name and valid access tags");
        var id = body.Text("id", Guid.NewGuid().ToString());
        var tags = body.Strings("tags");
        var row = db.AccessProfiles.Find(id);
        if (body.ContainsKey("id") && row is null) throw new ApiException(404, "Profile not found");
        if (id == "service-admin" && (!tags.Any(t => t is "Company Admin" or "Service Admin") || tags.Contains("Read Only"))) throw new ApiException(400, "Keep the built-in recovery profile as a Service Admin without Read Only");
        if (row is null) { row = new AccessProfile { Id = id }; db.AccessProfiles.Add(row); }
        row.Name = body.Text("name").Trim(); row.Tags = Body.Encode(tags);
        RecordSetting(db, access, body, now, "access_profile_saved");
    }

    internal static void SaveRule(InventoryDbContext db, AccessContext access, JsonObject body, string now)
    {
        Authorize(access, "policies.edit");
        var resource = body.Text("resource");
        if (!PolicyCatalog.Resources.Any(r => r.Id == resource) || body["rule"] is not JsonObject rule || !TagsValid(rule["anyTags"]) || !TagsValid(rule["allTags"])) throw new ApiException(400, "Choose a resource and valid policy tags");
        if (resource is "policies.edit" or "policies.view" && (!rule.Strings("anyTags").Contains("Seacoast Admin") || rule.Strings("allTags").Length != 0)) throw new ApiException(400, "Keep Seacoast Admin policy-management access");
        var row = db.AccessRules.Find(resource) ?? throw new ApiException(404, "Policy not found");
        row.Rule = rule.ToJsonString();
        RecordSetting(db, access, body, now, "access_rule_saved");
    }

    private static void RecordSetting(InventoryDbContext db, AccessContext access, JsonObject body, string now, string action)
        => db.SettingsEvents.Add(new SettingsEvent
        {
            EntityId = body.Text("id", body.Text("resource", body.Text("name"))),
            Action = action, Details = body.ToJsonString(), CreatedAt = now,
            ActorProfile = access.User.Actor, ActorUserId = access.User.Id
        });
}
