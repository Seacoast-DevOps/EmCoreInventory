namespace EmCoreInventory.Api.Authorization;

public sealed record PolicyRule(string[] AnyTags, string[] AllTags);
public sealed record PolicyResource(string Id, string Label, PolicyRule DefaultRule);
public sealed record AccessTag(string Id, string Label, string Kind);
public sealed record ProfileTemplate(string Id, string Name, string[] Tags);
public sealed record MatrixRule(string Id, string Label, string[] Roles);

public static class PolicyCatalog
{
    public static readonly string[] MatrixRoles = ["Driver","EMT","AEMT","Paramedic","Supervisor","Company Admin","Seacoast Admin"];
    public static readonly string[] LicenseLevels = ["Driver","EMT","AEMT","Paramedic"];
    public static readonly string[] ManagementRoles = ["Supervisor","Company Admin","Seacoast Admin"];
    public static readonly string[] MedicationActions = ["view","create","edit","administer","check","transfer","waste","witness"];
    public static readonly AccessTag[] Tags =
    [
        new("Driver", "Driver", "Clinician"),
        new("Supervisor", "Supervisor", "Role"),
        new("Company Admin", "Company Admin", "Role"),
        new("Seacoast Admin", "Seacoast Admin", "Platform"),
        new("EMT", "EMT", "Clinician"),
        new("AEMT", "AEMT", "Clinician"),
        new("Paramedic", "Paramedic", "Clinician"),
        new("User", "User", "Role"),
        new("Service Admin", "Service Admin", "Legacy"),
        new("Can Check", "Can Check", "Capability"),
        new("Can Transfer", "Can Transfer", "Capability"),
        new("Can Waste", "Can Waste", "Capability"),
        new("Can Witness", "Can Witness", "Capability"),
        new("Can Administer", "Can Administer", "Capability"),
        new("Can Create", "Can Create", "Capability"),
        new("Can Edit", "Can Edit", "Capability"),
        new("Read Only", "Read Only", "Role")
    ];
    public static readonly PolicyResource[] Resources =
    [
        new("home.view", "Home · View", new(["User","Company Admin","Seacoast Admin"], [])),
        new("inventory.view", "Inventory · View", new(["User","Company Admin","Seacoast Admin"], [])),
        new("stock.view", "Unassigned stock · View", new(["User","Company Admin","Seacoast Admin"], [])),
        new("stock.create", "Stock · Batch create", new(["Can Create","Company Admin","Seacoast Admin"], [])),
        new("inventory.transfer", "Stock · Transfer / assign", new(["Can Transfer","Company Admin","Seacoast Admin"], [])),
        new("records.view", "Vial records · View", new(["User","Company Admin","Seacoast Admin"], [])),
        new("checks.start", "Checks · Start", new(["Can Check","Company Admin","Seacoast Admin"], [])),
        new("checks.verify", "Checks · Verify items", new(["Can Check","Company Admin","Seacoast Admin"], [])),
        new("checks.save", "Checks · Save draft", new(["Can Check","Company Admin","Seacoast Admin"], [])),
        new("checks.complete", "Checks · Complete", new(["Can Check","Company Admin","Seacoast Admin"], [])),
        new("checks.reset", "Checks · Reset", new(["Can Check","Company Admin","Seacoast Admin"], [])),
        new("checks.adhoc", "Checks · Ad hoc", new(["Can Check","Company Admin","Seacoast Admin"], [])),
        new("incidents.view", "Incidents · View", new(["User","Company Admin","Seacoast Admin"], [])),
        new("incidents.create", "Incidents · Create / draft", new(["Can Create","Company Admin","Seacoast Admin"], [])),
        new("incidents.edit", "Incidents · Edit", new(["Can Edit","Company Admin","Seacoast Admin"], [])),
        new("incidents.reopen", "Incidents · Reopen", new(["Can Edit","Company Admin","Seacoast Admin"], [])),
        new("medications.administer", "Medication · Administer", new(["Can Administer","Company Admin","Seacoast Admin"], [])),
        new("medications.waste", "Medication · Waste", new(["Can Waste","Company Admin","Seacoast Admin"], [])),
        new("medications.witness", "Medication · Witness", new(["Can Witness","Company Admin","Seacoast Admin"], [])),
        new("definitions.view", "Drug definitions · View", new(["Company Admin","User","Company Admin","Seacoast Admin"], [])),
        new("definitions.create", "Drug definitions · Add", new(["Company Admin","Supervisor","Company Admin","Seacoast Admin"], [])),
        new("definitions.edit", "Drug definitions · Edit", new(["Company Admin","Supervisor","Company Admin","Seacoast Admin"], [])),
        new("tags.view", "Medication tags · View", new(["Company Admin","Supervisor","Company Admin","Seacoast Admin"], [])),
        new("tags.edit", "Medication tags · Add / edit", new(["Company Admin","Supervisor","Company Admin","Seacoast Admin"], [])),
        new("classes.view", "Medication classes · View", new(["Company Admin","User","Company Admin","Seacoast Admin"], [])),
        new("classes.edit", "Medication classes · Add / edit", new(["Company Admin","Supervisor","Company Admin","Seacoast Admin"], [])),
        new("containers.view", "Storage designer · View", new(["Company Admin","Supervisor","Company Admin","Seacoast Admin"], [])),
        new("containers.edit", "Storage designer · Add / edit", new(["Company Admin","Supervisor","Company Admin","Seacoast Admin"], [])),
        new("logs.view", "Logs · View", new(["Company Admin","Supervisor","Company Admin","Seacoast Admin"], [])),
        new("policies.view", "Policies · View", new(["Company Admin","Company Admin","Seacoast Admin"], [])),
        new("policies.edit", "Policies · Add / edit", new(["Company Admin","Company Admin","Seacoast Admin"], [])),
        new("companies.create", "Companies · Create", new(["Seacoast Admin","Company Admin","Seacoast Admin"], [])),
        new("companies.edit", "Company contacts · Edit", new(["Company Admin","Company Admin","Seacoast Admin"], [])),
        new("companies.contacts", "Company admin contacts · Manage", new(["Company Admin","Company Admin","Seacoast Admin"], [])),
        new("companies.activate", "Companies · Activate / deactivate", new(["Seacoast Admin","Company Admin","Seacoast Admin"], [])),
        new("companies.delete", "Companies · Hard delete", new(["Seacoast Admin","Company Admin","Seacoast Admin"], [])),
        new("discrepancies.view", "Discrepancies · View", new(["User","Company Admin","Seacoast Admin"], [])),
        new("discrepancies.report", "Discrepancies · Report", new(["User","Company Admin","Seacoast Admin"], [])),
        new("discrepancies.approve", "Discrepancies · Approve", new(["Supervisor","Company Admin","Seacoast Admin"], [])),
        new("seals.break", "Seals · Break", new(["User","Company Admin","Seacoast Admin"], [])),
        new("seals.reseal", "Seals · Reseal", new(["User","Company Admin","Seacoast Admin"], []))
    ];
    public static readonly ProfileTemplate[] Profiles =
    [
        new("driver", "Driver", ["Driver","User","Can Check","Can Witness"]),
        new("supervisor", "Supervisor — Paramedic", ["Paramedic","Supervisor","User","Can Check","Can Transfer","Can Waste","Can Witness","Can Administer","Can Create","Can Edit"]),
        new("service-admin", "Company Admin — Paramedic", ["Paramedic","User","Company Admin","Can Check","Can Transfer","Can Waste","Can Witness","Can Administer","Can Create","Can Edit"]),
        new("paramedic-user", "Paramedic — full clinical user", ["Paramedic","User","Can Check","Can Transfer","Can Waste","Can Witness","Can Administer","Can Create","Can Edit"]),
        new("aemt-user", "AEMT — clinical / transfer", ["AEMT","User","Can Check","Can Transfer","Can Waste","Can Witness","Can Administer","Can Create"]),
        new("emt-checker", "EMT — drug checks only", ["EMT","User","Can Check"]),
        new("emt-readonly", "EMT — read only", ["EMT","User","Read Only"]),
        new("paramedic-no-witness", "Paramedic — no witness capability", ["Paramedic","User","Can Create","Can Administer","Can Waste"])
    ];
    public static readonly MatrixRule[] Matrix =
    [
        new("companies.create", "Create a company", ["Seacoast Admin"]),
        new("policies.edit", "Edit company permissions", ["Seacoast Admin"]),
        new("companies.edit", "Edit company contact information", ["Company Admin","Seacoast Admin"]),
        new("companies.delete", "Hard delete a company", ["Seacoast Admin"]),
        new("companies.activate", "Deactivate / reactivate a company", ["Seacoast Admin"]),
        new("companies.contacts", "Manage company admin contacts", ["Company Admin","Seacoast Admin"]),
        new("containers.edit", "Manage company locations", ["Supervisor","Company Admin","Seacoast Admin"]),
        new("definitions.edit", "Manage medication formulary", ["Supervisor","Company Admin","Seacoast Admin"]),
        new("definitions.view", "View medication formulary", ["Driver","EMT","AEMT","Paramedic","Supervisor","Company Admin","Seacoast Admin"]),
        new("discrepancies.approve", "Approve discrepancies", ["Supervisor","Company Admin","Seacoast Admin"]),
        new("stock.create", "Add an individual medication item", ["Paramedic","Supervisor","Company Admin","Seacoast Admin"]),
        new("checks.verify", "Check / verify an individual item", ["Driver","EMT","AEMT","Paramedic","Supervisor","Company Admin","Seacoast Admin"]),
        new("medications.administer.nonNarcotic", "Administer non-narcotic medication", ["EMT","AEMT","Paramedic","Supervisor","Company Admin","Seacoast Admin"]),
        new("medications.administer.narcotic", "Administer narcotic medication", ["Paramedic","Supervisor","Company Admin","Seacoast Admin"]),
        new("medications.waste.nonNarcotic", "Waste partial non-narcotic medication", ["EMT","AEMT","Paramedic","Supervisor","Company Admin","Seacoast Admin"]),
        new("medications.waste.narcotic", "Waste partial narcotic medication", ["Paramedic","Supervisor","Company Admin","Seacoast Admin"]),
        new("medications.witness", "Witness partial medication use / waste", ["Driver","EMT","AEMT","Paramedic","Supervisor","Company Admin","Seacoast Admin"]),
        new("inventory.transfer", "Transfer between authorized storage locations", ["EMT","AEMT","Paramedic","Supervisor","Company Admin","Seacoast Admin"]),
        new("checks.start", "Routine / daily inventory", ["Driver","EMT","AEMT","Paramedic","Supervisor","Company Admin","Seacoast Admin"]),
        new("seals.break", "Break a seal", ["Driver","EMT","AEMT","Paramedic","Supervisor","Company Admin","Seacoast Admin"]),
        new("seals.reseal", "Reseal a container", ["Driver","EMT","AEMT","Paramedic","Supervisor","Company Admin","Seacoast Admin"])
    ];
}
