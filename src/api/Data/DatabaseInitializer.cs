using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using EmCoreInventory.Api.Authorization;
using EmCoreInventory.Api.Auth;
using Microsoft.EntityFrameworkCore;

namespace EmCoreInventory.Api.Data;

public static class DatabaseInitializer
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private const string SourceUrl = "https://www.maine.gov/ems/sites/maine.gov.ems/files/inline-files/2025-MEMS-Formulary-v4-Print-Version-20260311.pdf";
    private sealed record Medication(string Key, string Name, string Match, double Concentration, string Unit, string Basis, double Maximum, string Form, string OriginalPresentation, bool Narcotic = false);
    private sealed record Stock(Medication Medication, int Quantity);
    private sealed record Container(string Id, string Location, string Name, bool Sealed, bool Transparent, Stock[] Stock);
    private static readonly Medication[] Medications =
    [
        new("fentanyl", "Fentanyl", "", 50, "mcg", "mL", 100, "Vial", "Vial", true),
        new("midazolam", "Versed (midazolam)", "", 5, "mg", "mL", 5, "Vial", "Vial", true),
        new("ketamine", "Ketamine", "", 100, "mg", "mL", 500, "Vial", "Vial", true),
        new("naloxone", "Naloxone", "", 1, "mg", "mL", 2, "Prefilled syringe", "2 mg · Prefilled syringe"),
        new("epinephrine", "Epinephrine", "", 0.1, "mg", "mL", 1, "Prefilled syringe", "1:10,000 · Prefilled syringe"),
        new("metoprolol", "Metoprolol", "", 1, "mg", "mL", 5, "Vial", "5 mg · Vial"),
        new("norepinephrine", "Norepinephrine", "", 0.032, "mg", "mL", 8, "Premixed bag", "8 mg in 250 mL · Premixed bag"),
        new("aspirin", "Aspirin", "", 324, "mg", "pack", 324, "Pack", "324 mg · Pack"),
        new("ondansetron-iv", "Ondansetron (Zofran)", "IV", 2, "mg", "mL", 4, "Vial", "4 mg · IV vial"),
        new("ondansetron-odt", "Ondansetron (Zofran)", "ODT", 4, "mg", "tablet", 4, "ODT", "4 mg · ODT"),
        new("dexamethasone", "Dexamethasone", "", 10, "mg", "mL", 10, "Vial", "10 mg · Vial"),
        new("dextrose", "Dextrose 10%", "", 0.1, "g", "mL", 25, "Premixed bag", "250 mL · Premixed bag")
    ];

    public static void Initialize(InventoryDbContext db, bool identity, bool freshTenant)
    {
        if (!db.Database.EnsureCreated()) LegacySchemaUpgrade.Apply(db);
        using var transaction = db.Database.BeginTransaction();
        var seeds = db.InventorySeeds.Select(seed => seed.Version).ToHashSet();
        var now = DateTimeOffset.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
        if (!seeds.Contains(1))
        {
            SeedInventory(db, freshTenant, now);
            db.InventorySeeds.Add(new InventorySeed { Version = 1 });
            db.SaveChanges();
        }
        RegisterItems(db, now);
        if (!seeds.Contains(2))
        {
            if (!db.MedicationTags.Any(tag => tag.Id == "narcotic"))
                db.MedicationTags.Add(new MedicationTag { Id = "narcotic", Name = "Narcotic", Requirements = Serialize(new[] { "entire", "partial", "replacement", "resealed" }) });
            db.InventorySeeds.Add(new InventorySeed { Version = 2 });
            db.SaveChanges();
        }
        if (!seeds.Contains(3))
        {
            StandardizeInventory(db, freshTenant, now);
            db.InventorySeeds.Add(new InventorySeed { Version = 3 });
            db.SaveChanges();
        }
        MigrateAmountsAndIncidents(db);
        if (!seeds.Contains(4))
        {
            foreach (var item in db.InventoryItems.Where(item => item.Status == "opened")) item.WasOpened = 1;
            db.InventorySeeds.Add(new InventorySeed { Version = 4 });
        }
        if (!db.InventoryBoxes.Any(box => box.Id == "unassigned"))
            db.InventoryBoxes.Add(new InventoryBox { Id = "unassigned", Location = "Unassigned", Name = "Unassigned stock", CheckIntervalHours = 0 });
        AddPolicies(db);
        db.SaveChanges();
        if (!seeds.Contains(5))
        {
            UpgradeMatrix(db);
            db.InventorySeeds.Add(new InventorySeed { Version = 5 });
            db.SaveChanges();
        }
        if (identity) IdentityService.Initialize(db);
        transaction.Commit();
        db.ChangeTracker.Clear();
    }

    private static void SeedInventory(InventoryDbContext db, bool templatesOnly, string now)
    {
        var sequence = 0;
        var codes = db.TrackingCodes.Select(row => row.Code).ToHashSet();
        foreach (var container in Containers())
        {
            if (db.InventoryBoxes.Any(box => box.Id == container.Id)) continue;
            db.InventoryBoxes.Add(new InventoryBox
            {
                Id = container.Id, Location = container.Location, Name = container.Name,
                Sealed = !templatesOnly && container.Sealed ? 1 : 0, Seal = !templatesOnly && container.Sealed ? "12345678" : null,
                Transparent = container.Transparent ? 1 : 0
            });
            if (templatesOnly) continue;
            foreach (var stock in container.Stock)
                for (var number = 0; number < stock.Quantity; number++)
                {
                    string id;
                    do { id = "EM-" + (++sequence).ToString("D4", CultureInfo.InvariantCulture); }
                    while (db.InventoryItems.Any(item => item.Id == id));
                    var code = NewCode(codes);
                    db.InventoryItems.Add(new InventoryItem
                    {
                        Id = id, BoxId = container.Id, Medication = stock.Medication.Name,
                        Presentation = stock.Medication.OriginalPresentation, Code = code
                    });
                    db.InventoryEvents.Add(new InventoryEvent
                    {
                        ItemId = id, Action = "registered", ToBox = container.Id, CreatedAt = now,
                        Details = Serialize(new { code, legacyId = id, note = "Tracking code assigned to existing stock; original intake date unknown." })
                    });
                }
        }
    }

    private static void RegisterItems(InventoryDbContext db, string now)
    {
        var codes = db.TrackingCodes.Select(row => row.Code).ToHashSet();
        codes.UnionWith(db.InventoryItems.Where(item => item.Code != null).Select(item => item.Code!));
        foreach (var item in db.InventoryItems.AsNoTracking().Where(item => item.Code == null).ToList())
        {
            var code = NewCode(codes);
            db.InventoryItems.Where(row => row.Id == item.Id).ExecuteUpdate(setters => setters.SetProperty(row => row.Code, code));
            db.InventoryEvents.Add(new InventoryEvent
            {
                ItemId = item.Id, Action = "registered", ToBox = item.BoxId, CreatedAt = now,
                Details = Serialize(new { code, legacyId = item.Id, note = "Tracking code assigned to existing stock; original intake date unknown." })
            });
        }
        db.SaveChanges();
        var registered = db.TrackingCodes.Select(row => row.ItemId).ToHashSet();
        foreach (var item in db.InventoryItems.AsNoTracking())
            if (!registered.Contains(item.Id))
                db.TrackingCodes.Add(new TrackingCode { Code = item.Code!, ItemId = item.Id, IssuedAt = item.ReceivedAt ?? now });
        var legacyIds = db.InventoryEvents.Where(entry => entry.Action == "registered").Select(entry => entry.ItemId);
        db.InventoryItems.Where(item => legacyIds.Contains(item.Id)).ExecuteUpdate(setters => setters.SetProperty(item => item.ReceivedAt, (string?)null));
        db.SaveChanges();
    }

    private static void StandardizeInventory(InventoryDbContext db, bool templatesOnly, string now)
    {
        foreach (var medication in Medications)
        {
            var definition = db.DrugDefinitions.FirstOrDefault(drug => drug.Name == medication.Name
                && drug.ConcentrationValue == medication.Concentration && drug.AmountUnit == medication.Unit
                && drug.MaxAmount == medication.Maximum && drug.Form == medication.Form);
            var note = medication.Key == "midazolam"
                ? "Maine EMS formulary lists 5 mg/mL in 1 mL and 1 mg/mL in 5 mL. This profile uses the 5 mg/mL option; confirm the supplied label."
                : "Stock profile from the Maine EMS March 11, 2026 formulary and the requested container contents. Confirm the supplied label; this is not a patient dose limit.";
            if (definition is null)
            {
                definition = new DrugDefinition
                {
                    Id = Guid.NewGuid().ToString(), Name = medication.Name, ConcentrationValue = medication.Concentration,
                    AmountUnit = medication.Unit, ConcentrationBasis = medication.Basis, MaxAmount = medication.Maximum,
                    Form = medication.Form, SourceNote = note, SourceUrl = SourceUrl
                };
                db.DrugDefinitions.Add(definition);
                db.SaveChanges();
            }
            if (medication.Narcotic && !db.DefinitionTags.Any(link => link.DefinitionId == definition.Id && link.TagId == "narcotic"))
                db.DefinitionTags.Add(new DefinitionTag { DefinitionId = definition.Id, TagId = "narcotic" });
            var snapshot = new
            {
                definition.Id, definition.Name, definition.ConcentrationValue, definition.AmountUnit,
                definition.ConcentrationBasis, definition.MaxAmount, definition.Form
            };
            foreach (var item in db.InventoryItems.Where(item => item.DefinitionId == null && item.Medication == medication.Name).ToList()
                .Where(item => medication.Match.Length == 0 || item.Presentation.Contains(medication.Match, StringComparison.Ordinal)))
            {
                var previousPresentation = item.Presentation;
                item.DefinitionId = definition.Id;
                item.DefinitionSnapshot = Serialize(snapshot);
                item.Presentation = string.Create(CultureInfo.InvariantCulture, $"{definition.ConcentrationValue} {definition.AmountUnit}/{definition.ConcentrationBasis} · {definition.MaxAmount} {definition.AmountUnit} per {definition.Form.ToLowerInvariant()}");
                item.AmountTotal = definition.MaxAmount;
                item.RemainingAmount = item.Status is "available" or "opened" ? definition.MaxAmount : 0;
                db.InventoryEvents.Add(new InventoryEvent
                {
                    ItemId = item.Id, Action = "standardized", FromBox = item.BoxId, ToBox = item.BoxId,
                    CreatedAt = now, Details = Serialize(new { previousPresentation, definition = snapshot, sourceUrl = SourceUrl, note })
                });
            }
            db.SaveChanges();
            var targets = templatesOnly
                ? Containers().SelectMany(box => box.Stock.Where(stock => stock.Medication.Key == medication.Key)
                    .Select(stock => new { BoxId = box.Id, Target = stock.Quantity })).ToList()
                : db.InventoryItems.Where(item => item.DefinitionId == definition.Id && (item.Status == "available" || item.Status == "opened"))
                    .GroupBy(item => item.BoxId).Select(group => new { BoxId = group.Key, Target = group.Count() }).ToList();
            foreach (var target in targets)
                if (!db.ParLevels.Any(par => par.DefinitionId == definition.Id && par.BoxId == target.BoxId))
                    db.ParLevels.Add(new ParLevel { DefinitionId = definition.Id, BoxId = target.BoxId, Target = target.Target });
        }
        foreach (var box in db.InventoryBoxes)
        {
            box.Icon = box.Location.StartsWith("Unit ", StringComparison.OrdinalIgnoreCase) ? "truck"
                : box.Name.Contains("Narcotic", StringComparison.OrdinalIgnoreCase) ? "lock" : "cabinet";
            box.Kind = box.Name.Contains("Cabinet", StringComparison.OrdinalIgnoreCase) ? "Cabinet"
                : box.Name.Contains("narcotic", StringComparison.OrdinalIgnoreCase) ? "Narcotic box" : "Drug box";
        }
    }

    private static void MigrateAmountsAndIncidents(InventoryDbContext db)
    {
        var definitions = db.DrugDefinitions.ToDictionary(drug => drug.Id);
        foreach (var item in db.InventoryItems.Where(item => item.AmountTotal == null && item.DefinitionId != null))
            if (definitions.TryGetValue(item.DefinitionId!, out var definition))
            {
                item.AmountTotal = definition.MaxAmount;
                item.RemainingAmount = item.Status is "available" or "opened" ? definition.MaxAmount : 0;
            }
        db.SaveChanges();
        foreach (var incident in db.Incidents.Where(incident => incident.Payload == null).ToList())
        {
            var ids = db.IncidentItems.Where(link => link.IncidentId == incident.Id).Select(link => link.ItemId);
            var items = db.InventoryItems.Where(item => ids.Contains(item.Id)).ToList().Select(item => new
            {
                id = item.Id, boxId = item.BoxId,
                given = incident.Reason == "used" ? item.AmountTotal ?? 0 : 0,
                wasted = incident.Reason is "used" or "opened" ? 0 : item.AmountTotal ?? 0
            }).ToArray();
            incident.Payload = Serialize(new { incidentNumber = incident.IncidentNumber ?? "", reason = incident.Reason, notes = incident.Notes, witness = "", items });
            incident.UpdatedAt = incident.CreatedAt;
            foreach (var item in items)
                if (!db.IncidentAllocations.Any(allocation => allocation.IncidentId == incident.Id && allocation.ItemId == item.id))
                    db.IncidentAllocations.Add(new IncidentAllocation { IncidentId = incident.Id, ItemId = item.id, Given = item.given, Wasted = item.wasted });
            db.IncidentVersions.Add(new IncidentVersion
            {
                IncidentId = incident.Id, Revision = 1, Status = "completed", Payload = incident.Payload, CreatedAt = incident.CreatedAt
            });
        }
        db.SaveChanges();
    }

    private static void AddPolicies(InventoryDbContext db)
    {
        var profiles = db.AccessProfiles.Select(profile => profile.Id).ToHashSet();
        foreach (var profile in PolicyCatalog.Profiles)
            if (!profiles.Contains(profile.Id))
                db.AccessProfiles.Add(new AccessProfile { Id = profile.Id, Name = profile.Name, Tags = Serialize(profile.Tags) });
        var resources = db.AccessRules.Select(rule => rule.Resource).ToHashSet();
        foreach (var resource in PolicyCatalog.Resources)
            if (!resources.Contains(resource.Id))
                db.AccessRules.Add(new AccessRule { Resource = resource.Id, Rule = Serialize(resource.DefaultRule) });
    }

    private static void UpgradeMatrix(InventoryDbContext db)
    {
        var narcoticIds = db.DefinitionTags.Where(link => link.TagId == "narcotic").Select(link => link.DefinitionId);
        foreach (var definition in db.DrugDefinitions.Where(drug => narcoticIds.Contains(drug.Id))) definition.IsNarcotic = 1;
        foreach (var profile in db.AccessProfiles) profile.Tags = profile.Tags.Replace("\"Service Admin\"", "\"Company Admin\"", StringComparison.Ordinal);
        var customized = db.SettingsEvents.Where(entry => entry.Action == "access_rule_saved").Select(entry => entry.Details)
            .AsEnumerable().Select(details => JsonNode.Parse(details)?["resource"]?.GetValue<string>()).ToHashSet();
        var defaults = PolicyCatalog.Resources.ToDictionary(resource => resource.Id);
        foreach (var rule in db.AccessRules)
        {
            rule.Rule = rule.Rule.Replace("\"Service Admin\"", "\"Company Admin\"", StringComparison.Ordinal);
            if (!customized.Contains(rule.Resource) && defaults.TryGetValue(rule.Resource, out var resource)) rule.Rule = Serialize(resource.DefaultRule);
        }
    }

    private static IEnumerable<Container> Containers()
    {
        Stock[] StockFor(params (string Key, int Quantity)[] entries) => entries
            .Select(entry => new Stock(Medications.Single(medication => medication.Key == entry.Key), entry.Quantity)).ToArray();
        var narcotics = StockFor(("fentanyl", 5), ("midazolam", 5), ("ketamine", 1));
        var als = StockFor(("naloxone", 2), ("epinephrine", 8), ("metoprolol", 2), ("norepinephrine", 1));
        var outside = StockFor(("aspirin", 1), ("ondansetron-iv", 2), ("ondansetron-odt", 2), ("dexamethasone", 2));
        foreach (var unit in new[] { 42, 43, 44 })
        {
            yield return new Container($"unit-{unit}-narcotic", $"Unit {unit}", "Transparent narcotic box", true, true, narcotics);
            yield return new Container($"unit-{unit}-pelican", $"Unit {unit}", "Pelican box", false, false, als);
            yield return new Container($"unit-{unit}-out", $"Unit {unit}", "Out of Box drug box", false, false, outside);
        }
        yield return new Container("storage-bls", "Storage Room - BLS Cabinet", "BLS Cabinet", false, false, StockFor(("aspirin", 6), ("naloxone", 6)));
        yield return new Container("storage-narcotic", "Storage Room - Narcotic Cabinet", "Narcotic Cabinet", false, false, StockFor(("fentanyl", 10), ("midazolam", 10), ("ketamine", 4)));
        yield return new Container("storage-als", "Storage Room - ALS Cabinet", "ALS Cabinet", false, false, [.. als, .. outside.Skip(1)]);
    }

    private static string NewCode(HashSet<string> issued)
    {
        const string alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        string code;
        do { code = new string(Enumerable.Range(0, 8).Select(_ => alphabet[RandomNumberGenerator.GetInt32(alphabet.Length)]).ToArray()); }
        while (!issued.Add(code));
        return code;
    }

    private static string Serialize<T>(T value) => JsonSerializer.Serialize(value, JsonOptions);
}
