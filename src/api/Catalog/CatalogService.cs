using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using EmCoreInventory.Api.Authorization;
using EmCoreInventory.Api.Common;
using EmCoreInventory.Api.Data;

namespace EmCoreInventory.Api.Catalog;

public static class CatalogService
{
    private static readonly string[] Units = ["mcg", "mg", "g", "units", "mEq", "mmol"];
    private static readonly string[] Bases = ["mL", "vial", "ampule", "syringe", "bag", "tablet", "pack"];
    private static readonly string[] Forms = ["Vial", "Ampule", "Prefilled syringe", "Premixed bag", "Tablet", "ODT", "Pack"];
    private static readonly string[] WitnessOptions = ["entire", "partial", "replacement", "resealed", "disposal", "opening", "transfer", "seal_break"];

    public static JsonObject DefinitionSnapshot(DrugDefinition drug) => new()
    {
        ["id"] = drug.Id, ["name"] = drug.Name,
        ["minimumLicense"] = drug.MinimumLicense, ["isNarcotic"] = drug.IsNarcotic != 0,
        ["medicationClassId"] = drug.MedicationClassId,
        ["accessRules"] = JsonNode.Parse(drug.AccessRules),
        ["checkIntervalHours"] = drug.CheckIntervalHours,
        ["sourceNote"] = drug.SourceNote, ["sourceUrl"] = drug.SourceUrl,
        ["concentrationValue"] = drug.ConcentrationValue, ["amountUnit"] = drug.AmountUnit,
        ["concentrationBasis"] = drug.ConcentrationBasis, ["maxAmount"] = drug.MaxAmount,
        ["form"] = drug.Form
    };

    internal static JsonObject Snapshot(InventoryDbContext db, AccessContext context, IReadOnlySet<string> visibleParBoxIds)
    {
        var tags = db.MedicationTags.OrderBy(row => row.Name).AsNoTracking().ToList();
        var links = db.DefinitionTags.AsNoTracking().ToList();
        var stocked = db.InventoryItems.Select(row => row.DefinitionId).Distinct().ToHashSet();
        var definitions = db.DrugDefinitions.OrderBy(row => row.Name).ThenBy(row => row.ConcentrationValue).AsNoTracking().ToList();
        var visible = definitions.Where(drug => context.Permissions.GetValueOrDefault("definitions.view") || MedicationVisible(context, drug)).ToList();
        var visibleIds = visible.Select(row => row.Id).ToHashSet();
        return new JsonObject
        {
            ["tags"] = new JsonArray(tags.Select(tag => (JsonNode)new JsonObject { ["id"] = tag.Id, ["name"] = tag.Name, ["requirements"] = JsonNode.Parse(tag.Requirements) }).ToArray()),
            ["definitions"] = new JsonArray(visible.Select(drug =>
            {
                var value = DefinitionSnapshot(drug);
                value["hasStock"] = stocked.Contains(drug.Id);
                value["tagIds"] = JsonSerializer.SerializeToNode(links.Where(link => link.DefinitionId == drug.Id).Select(link => link.TagId));
                return (JsonNode)value;
            }).ToArray()),
            ["parLevels"] = JsonSerializer.SerializeToNode(db.ParLevels.AsNoTracking().ToList().Where(row => visibleIds.Contains(row.DefinitionId) && visibleParBoxIds.Contains(row.BoxId)).Select(row => new { definitionId = row.DefinitionId, boxId = row.BoxId, target = row.Target }))
        };
    }

    private static bool MedicationVisible(AccessContext context, DrugDefinition drug)
    {
        try { AccessService.AuthorizeMedication(context, drug, "view"); return true; }
        catch (ApiException error) when (error.Status == 403) { return false; }
    }

    public static string[] Requirements(InventoryDbContext db, string? definitionId)
    {
        if (string.IsNullOrEmpty(definitionId)) return [];
        var requirements = (from link in db.DefinitionTags join tag in db.MedicationTags on link.TagId equals tag.Id where link.DefinitionId == definitionId select tag.Requirements).ToList();
        return requirements.SelectMany(value => JsonSerializer.Deserialize<string[]>(value) ?? []).Distinct().ToArray();
    }

    public static string Label(DrugDefinition drug) => $"{drug.Name} — {drug.ConcentrationValue:G} {drug.AmountUnit}/{drug.ConcentrationBasis} · {drug.MaxAmount:G} {drug.AmountUnit} per {drug.Form.ToLowerInvariant()}";

    internal static void SaveTag(InventoryDbContext db, AccessContext context, JsonObject body, string now)
    {
        AccessService.Authorize(context, "tags.edit");
        var (id, name, existing) = SettingsIdentity(body);
        SaveTag(db, body, id, name, existing);
        AuditSetting(db, context, body, now, id, "tag_saved");
    }

    internal static void SaveDefinition(InventoryDbContext db, AccessContext context, JsonObject body, string now)
    {
        AccessService.Authorize(context, body.ContainsKey("id") ? "definitions.edit" : "definitions.create");
        var (id, name, existing) = SettingsIdentity(body);
        SaveDefinition(db, body, id, name, existing);
        AuditSetting(db, context, body, now, id, "definition_saved");
    }

    private static (string Id, string Name, bool Existing) SettingsIdentity(JsonObject body)
    {
        var suppliedId = String(body, "id");
        if (body.ContainsKey("id") && (suppliedId == null || suppliedId.Length > 80)) throw new ApiException(400, "Invalid settings ID");
        var name = String(body, "name")?.Trim();
        if (string.IsNullOrEmpty(name) || name.Length > 100) throw new ApiException(400, "Enter a name of 1 to 100 characters");
        return (suppliedId ?? Guid.NewGuid().ToString(), name, suppliedId != null);
    }

    private static void AuditSetting(InventoryDbContext db, AccessContext context, JsonObject body, string now, string id, string action)
    {
        db.SettingsEvents.Add(new SettingsEvent
        {
            EntityId = id, Action = action, Details = body.ToJsonString(),
            CreatedAt = now, ActorProfile = context.User.Actor, ActorUserId = context.User.Id
        });
    }

    private static void SaveTag(InventoryDbContext db, JsonObject body, string id, string name, bool existing)
    {
        var requirements = Strings(body, "requirements");
        if (requirements == null || requirements.Any(value => !WitnessOptions.Contains(value))) throw new ApiException(400, "Choose valid witness requirements");
        var tag = db.MedicationTags.Find(id);
        if (existing && tag == null) throw new ApiException(404, "Tag not found");
        if (db.MedicationTags.Any(row => row.Name == name && row.Id != id)) throw new ApiException(409, "A tag with that name already exists");
        if (tag == null) { tag = new MedicationTag { Id = id }; db.MedicationTags.Add(tag); }
        tag.Name = name;
        tag.Requirements = JsonSerializer.Serialize(requirements.Distinct());
    }

    private static void SaveDefinition(InventoryDbContext db, JsonObject body, string id, string name, bool existing)
    {
        var license = String(body, "minimumLicense");
        if (body.ContainsKey("minimumLicense") && !new[] { "EMT", "AEMT", "Paramedic" }.Contains(license)) throw new ApiException(400, "Choose a minimum medication license");
        bool? narcotic = null;
        if (body.ContainsKey("isNarcotic"))
        {
            if (body["isNarcotic"] is not JsonValue value || !value.TryGetValue<bool>(out var flag)) throw new ApiException(400, "Choose whether the medication is narcotic");
            narcotic = flag;
        }
        var classId = String(body, "medicationClassId");
        if (!string.IsNullOrEmpty(classId) && !db.MedicationClasses.Any(row => row.Id == classId)) throw new ApiException(400, "Choose a valid medication class");
        if (body.ContainsKey("accessRules") && !AccessService.ValidMedicationRules(body["accessRules"])) throw new ApiException(400, "Choose valid medication access rules");
        var interval = body["checkIntervalHours"] == null ? 24 : Number(body, "checkIntervalHours");
        if (!double.IsFinite(interval) || interval < 0 || interval > 8760) throw new ApiException(400, "Check interval must be between 0 and 8,760 hours");
        var concentration = Number(body, "concentrationValue");
        var maximum = Number(body, "maxAmount");
        if (!Positive(concentration) || !Positive(maximum)) throw new ApiException(400, "Concentration and maximum amount must be positive numbers");
        var unit = String(body, "amountUnit"); var basis = String(body, "concentrationBasis"); var form = String(body, "form");
        if (!Units.Contains(unit) || !Bases.Contains(basis) || !Forms.Contains(form)) throw new ApiException(400, "Choose valid units and presentation");
        var tags = Strings(body, "tagIds");
        if (tags == null || tags.Distinct().Count() != tags.Length || db.MedicationTags.Count(row => tags.Contains(row.Id)) != tags.Length) throw new ApiException(400, "Choose valid medication tags");
        if (body["parTargets"] is not JsonArray pars || pars.Count > 100) throw new ApiException(400, "Enter one par target per container");
        var targets = new Dictionary<string, int>();
        foreach (var node in pars)
        {
            var par = node as JsonObject; var boxId = par == null ? null : String(par, "boxId"); var target = par == null ? double.NaN : Number(par, "target");
            if (boxId == null || !db.InventoryBoxes.Any(row => row.Id == boxId) || !double.IsFinite(target) || target < 0 || target > 10000 || target != Math.Truncate(target) || !targets.TryAdd(boxId, (int)target))
                throw new ApiException(400, "Par quantities must be whole numbers from 0 to 10,000 in a valid container");
        }
        var drug = db.DrugDefinitions.Find(id);
        if (existing && drug == null) throw new ApiException(404, "Drug definition not found");
        if (drug != null && db.InventoryItems.Any(row => row.DefinitionId == id) && (drug.Name != name || drug.ConcentrationValue != concentration || drug.AmountUnit != unit || drug.ConcentrationBasis != basis || drug.MaxAmount != maximum || drug.Form != form))
            throw new ApiException(409, "This definition already has stock. Add a new definition for a different drug, concentration, amount, or presentation. Tags and par targets can still be edited.");
        if (db.DrugDefinitions.Any(row => row.Id != id && row.Name == name && row.ConcentrationValue == concentration && row.AmountUnit == unit && row.ConcentrationBasis == basis && row.MaxAmount == maximum && row.Form == form))
            throw new ApiException(409, "That drug and presentation already exist. Edit the existing definition.");
        if (drug == null) { drug = new DrugDefinition { Id = id }; db.DrugDefinitions.Add(drug); }
        drug.Name = name; drug.ConcentrationValue = concentration; drug.AmountUnit = unit!; drug.ConcentrationBasis = basis!; drug.MaxAmount = maximum; drug.Form = form!;
        drug.CheckIntervalHours = interval; drug.MedicationClassId = string.IsNullOrEmpty(classId) ? null : classId;
        drug.AccessRules = body["accessRules"]?.ToJsonString() ?? "{}";
        drug.MinimumLicense = license ?? drug.MinimumLicense;
        drug.IsNarcotic = (narcotic ?? drug.IsNarcotic != 0) || tags.Contains("narcotic") ? 1 : 0;
        var oldLinks = db.DefinitionTags.Where(row => row.DefinitionId == id).ToList();
        db.DefinitionTags.RemoveRange(oldLinks.Where(row => !tags.Contains(row.TagId)));
        db.DefinitionTags.AddRange(tags.Where(tag => oldLinks.All(row => row.TagId != tag)).Select(tag => new DefinitionTag { DefinitionId = id, TagId = tag }));
        var oldPars = db.ParLevels.Where(row => row.DefinitionId == id).ToList();
        db.ParLevels.RemoveRange(oldPars.Where(row => !targets.ContainsKey(row.BoxId)));
        foreach (var (boxId, target) in targets)
        {
            var par = oldPars.FirstOrDefault(row => row.BoxId == boxId);
            if (par == null) db.ParLevels.Add(new ParLevel { DefinitionId = id, BoxId = boxId, Target = target });
            else par.Target = target;
        }
    }

    private static bool Positive(double value) => double.IsFinite(value) && value > 0 && value <= 1e9;
    private static double Number(JsonObject body, string key) => body[key] is JsonValue value && value.TryGetValue<double>(out var result) ? result : double.NaN;
    private static string? String(JsonObject body, string key) => body[key] is JsonValue value && value.TryGetValue<string>(out var result) ? result : null;
    private static string[]? Strings(JsonObject body, string key) => body[key] is JsonArray array && array.All(node => node is JsonValue value && value.TryGetValue<string>(out _)) ? array.Select(node => node!.GetValue<string>()).ToArray() : null;
}
