using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;

namespace EmCoreInventory.Api.Data;

public sealed partial class InventoryDbContext(
    DbContextOptions<InventoryDbContext> options, string serviceId = DatabaseStore.PrimaryServiceId) : DbContext(options)
{
    public string Schema { get; } = DatabaseStore.SchemaFor(serviceId);
    internal (Guid TransactionId, string ServiceId)? ActiveCompanyLock { get; set; }
    internal bool IsIdentity => Schema == DatabaseStore.PrimarySchema;

    internal sealed class SchemaModelCacheKeyFactory : IModelCacheKeyFactory
    {
        public object Create(DbContext context, bool designTime) =>
            context is InventoryDbContext inventory
                ? (context.GetType(), inventory.Schema, designTime)
                : (context.GetType(), designTime);
    }

    protected override void OnConfiguring(DbContextOptionsBuilder optionsBuilder) =>
        optionsBuilder.ReplaceService<IModelCacheKeyFactory, SchemaModelCacheKeyFactory>();

    public DbSet<InventoryBox> InventoryBoxes => Set<InventoryBox>();
    public DbSet<InventoryItem> InventoryItems => Set<InventoryItem>();
    public DbSet<InventoryEvent> InventoryEvents => Set<InventoryEvent>();
    public DbSet<InventorySeed> InventorySeeds => Set<InventorySeed>();
    public DbSet<Incident> Incidents => Set<Incident>();
    public DbSet<IncidentItem> IncidentItems => Set<IncidentItem>();
    public DbSet<MedicationTag> MedicationTags => Set<MedicationTag>();
    public DbSet<DrugDefinition> DrugDefinitions => Set<DrugDefinition>();
    public DbSet<DefinitionTag> DefinitionTags => Set<DefinitionTag>();
    public DbSet<ParLevel> ParLevels => Set<ParLevel>();
    public DbSet<SettingsEvent> SettingsEvents => Set<SettingsEvent>();
    public DbSet<TrackingCode> TrackingCodes => Set<TrackingCode>();
    public DbSet<IncidentAllocation> IncidentAllocations => Set<IncidentAllocation>();
    public DbSet<IncidentVersion> IncidentVersions => Set<IncidentVersion>();
    public DbSet<DrugCheck> DrugChecks => Set<DrugCheck>();
    public DbSet<MedicationClass> MedicationClasses => Set<MedicationClass>();
    public DbSet<AccessProfile> AccessProfiles => Set<AccessProfile>();
    public DbSet<AccessRule> AccessRules => Set<AccessRule>();
    public DbSet<AccessAudit> AccessAudits => Set<AccessAudit>();
    public DbSet<InventoryBatch> InventoryBatches => Set<InventoryBatch>();
    public DbSet<WitnessSignoff> WitnessSignoffs => Set<WitnessSignoff>();
    public DbSet<Service> Services => Set<Service>();
    public DbSet<User> Users => Set<User>();
    public DbSet<ServiceMembership> ServiceMemberships => Set<ServiceMembership>();
    public DbSet<UserSession> UserSessions => Set<UserSession>();
    public DbSet<IdentityAudit> IdentityAudits => Set<IdentityAudit>();
    public DbSet<LoginAttempt> LoginAttempts => Set<LoginAttempt>();
    public DbSet<Discrepancy> Discrepancies => Set<Discrepancy>();
    public DbSet<CompanyMigration> CompanyMigrations => Set<CompanyMigration>();
    public DbSet<CompanyTombstone> CompanyTombstones => Set<CompanyTombstone>();

    internal static readonly Type[] IdentityEntityTypes =
    [
        typeof(Service), typeof(User), typeof(ServiceMembership), typeof(UserSession),
        typeof(IdentityAudit), typeof(LoginAttempt), typeof(CompanyMigration), typeof(CompanyTombstone)
    ];

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.HasDefaultSchema(Schema);
        modelBuilder.Entity<InventoryBox>(entity =>
        {
            entity.ToTable("inventory_boxes");
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id");
            entity.Property(row => row.Location).HasColumnName("location").IsRequired();
            entity.Property(row => row.Name).HasColumnName("name").IsRequired();
            entity.Property(row => row.Sealed).HasColumnName("sealed").IsRequired().HasDefaultValue(0).ValueGeneratedNever();
            entity.Property(row => row.Seal).HasColumnName("seal");
            entity.Property(row => row.Transparent).HasColumnName("transparent").IsRequired().HasDefaultValue(0).ValueGeneratedNever();
            entity.Property(row => row.CheckIntervalHours).HasColumnName("check_interval_hours").IsRequired().HasDefaultValue(24.0).ValueGeneratedNever();
            entity.Property(row => row.Icon).HasColumnName("icon").IsRequired().HasDefaultValue("box").ValueGeneratedNever();
            entity.Property(row => row.Kind).HasColumnName("kind").IsRequired().HasDefaultValue("Drug box").ValueGeneratedNever();
            entity.Property(row => row.StockRevision).HasColumnName("stock_revision").IsRequired().HasDefaultValue(0).ValueGeneratedNever();
            entity.Property(row => row.AllowedRoles).HasColumnName("allowed_roles").IsRequired().HasDefaultValue("[\"Driver\",\"EMT\",\"AEMT\",\"Paramedic\",\"Supervisor\",\"Company Admin\",\"Seacoast Admin\"]").ValueGeneratedNever();
        });
        modelBuilder.Entity<InventoryItem>(entity =>
        {
            entity.ToTable("inventory_items");
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id");
            entity.Property(row => row.BoxId).HasColumnName("box_id").IsRequired();
            entity.Property(row => row.Medication).HasColumnName("medication").IsRequired();
            entity.Property(row => row.Presentation).HasColumnName("presentation").IsRequired();
            entity.Property(row => row.VerifiedAt).HasColumnName("verified_at");
            entity.Property(row => row.Code).HasColumnName("code");
            entity.Property(row => row.Status).HasColumnName("status").IsRequired()
                .HasConversion<StatusValueConverter<InventoryItemStatus>>().HasDefaultValue(InventoryItemStatus.Available).ValueGeneratedNever();
            entity.Property(row => row.ReceivedAt).HasColumnName("received_at");
            entity.Property(row => row.ExternalSource).HasColumnName("external_source");
            entity.Property(row => row.ExternalId).HasColumnName("external_id");
            entity.Property(row => row.DefinitionId).HasColumnName("definition_id");
            entity.Property(row => row.DefinitionSnapshot).HasColumnName("definition_snapshot");
            entity.Property(row => row.AmountTotal).HasColumnName("amount_total");
            entity.Property(row => row.RemainingAmount).HasColumnName("remaining_amount");
            entity.Property(row => row.BatchId).HasColumnName("batch_id");
            entity.Property(row => row.LotNumber).HasColumnName("lot_number");
            entity.Property(row => row.ExpiresOn).HasColumnName("expires_on");
            entity.Property(row => row.WasOpened).HasColumnName("was_opened").IsRequired().HasDefaultValue(0).ValueGeneratedNever();
        });
        modelBuilder.Entity<InventoryEvent>(entity =>
        {
            entity.ToTable("inventory_events");
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id").UseIdentityByDefaultColumn();
            entity.Property(row => row.ItemId).HasColumnName("item_id").IsRequired();
            entity.Property(row => row.Action).HasColumnName("action").IsRequired();
            entity.Property(row => row.FromBox).HasColumnName("from_box");
            entity.Property(row => row.ToBox).HasColumnName("to_box");
            entity.Property(row => row.Details).HasColumnName("details");
            entity.Property(row => row.CreatedAt).HasColumnName("created_at").IsRequired();
            entity.Property(row => row.ActorProfile).HasColumnName("actor_profile");
            entity.Property(row => row.ActorUserId).HasColumnName("actor_user_id");
        });
        modelBuilder.Entity<InventorySeed>(entity =>
        {
            entity.ToTable("inventory_seeds");
            entity.HasKey(row => row.Version);
            entity.Property(row => row.Version).HasColumnName("version").ValueGeneratedNever();
        });
        modelBuilder.Entity<Incident>(entity =>
        {
            entity.ToTable("incidents");
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id").UseIdentityByDefaultColumn();
            entity.Property(row => row.IncidentNumber).HasColumnName("incident_number");
            entity.Property(row => row.Reason).HasColumnName("reason").IsRequired();
            entity.Property(row => row.Notes).HasColumnName("notes").IsRequired().HasDefaultValue("").ValueGeneratedNever();
            entity.Property(row => row.CreatedAt).HasColumnName("created_at").IsRequired();
            entity.Property(row => row.Status).HasColumnName("status").IsRequired()
                .HasConversion<StatusValueConverter<IncidentStatus>>().HasDefaultValue(IncidentStatus.Completed).ValueGeneratedNever();
            entity.Property(row => row.Revision).HasColumnName("revision").IsRequired().HasDefaultValue(1).ValueGeneratedNever();
            entity.Property(row => row.Payload).HasColumnName("payload");
            entity.Property(row => row.UpdatedAt).HasColumnName("updated_at");
            entity.Property(row => row.ClientKey).HasColumnName("client_key");
        });
        modelBuilder.Entity<IncidentItem>(entity =>
        {
            entity.ToTable("incident_items");
            entity.HasKey(row => new { row.IncidentId, row.ItemId });
            entity.Property(row => row.IncidentId).HasColumnName("incident_id").IsRequired();
            entity.Property(row => row.ItemId).HasColumnName("item_id").IsRequired();
        });
        modelBuilder.Entity<MedicationTag>(entity =>
        {
            entity.ToTable("medication_tags");
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id");
            entity.Property(row => row.Name).HasColumnName("name").IsRequired();
            entity.Property(row => row.Requirements).HasColumnName("requirements").IsRequired();
        });
        modelBuilder.Entity<DrugDefinition>(entity =>
        {
            entity.ToTable("drug_definitions");
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id");
            entity.Property(row => row.Name).HasColumnName("name").IsRequired();
            entity.Property(row => row.ConcentrationValue).HasColumnName("concentration_value").IsRequired();
            entity.Property(row => row.AmountUnit).HasColumnName("amount_unit").IsRequired();
            entity.Property(row => row.ConcentrationBasis).HasColumnName("concentration_basis").IsRequired();
            entity.Property(row => row.MaxAmount).HasColumnName("max_amount").IsRequired();
            entity.Property(row => row.Form).HasColumnName("form").IsRequired();
            entity.Property(row => row.CheckIntervalHours).HasColumnName("check_interval_hours").IsRequired().HasDefaultValue(24.0).ValueGeneratedNever();
            entity.Property(row => row.SourceNote).HasColumnName("source_note");
            entity.Property(row => row.SourceUrl).HasColumnName("source_url");
            entity.Property(row => row.MedicationClassId).HasColumnName("medication_class_id");
            entity.Property(row => row.AccessRules).HasColumnName("access_rules").IsRequired().HasDefaultValue("{}").ValueGeneratedNever();
            entity.Property(row => row.MinimumLicense).HasColumnName("minimum_license").IsRequired().HasDefaultValue("Paramedic").ValueGeneratedNever();
            entity.Property(row => row.IsNarcotic).HasColumnName("is_narcotic").IsRequired().HasDefaultValue(0).ValueGeneratedNever();
        });
        modelBuilder.Entity<DefinitionTag>(entity =>
        {
            entity.ToTable("definition_tags");
            entity.HasKey(row => new { row.DefinitionId, row.TagId });
            entity.Property(row => row.DefinitionId).HasColumnName("definition_id").IsRequired();
            entity.Property(row => row.TagId).HasColumnName("tag_id").IsRequired();
        });
        modelBuilder.Entity<ParLevel>(entity =>
        {
            entity.ToTable("par_levels");
            entity.HasKey(row => new { row.DefinitionId, row.BoxId });
            entity.Property(row => row.DefinitionId).HasColumnName("definition_id").IsRequired();
            entity.Property(row => row.BoxId).HasColumnName("box_id").IsRequired();
            entity.Property(row => row.Target).HasColumnName("target").IsRequired();
        });
        modelBuilder.Entity<SettingsEvent>(entity =>
        {
            entity.ToTable("settings_events");
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id").UseIdentityByDefaultColumn();
            entity.Property(row => row.EntityId).HasColumnName("entity_id").IsRequired();
            entity.Property(row => row.Action).HasColumnName("action").IsRequired();
            entity.Property(row => row.Details).HasColumnName("details").IsRequired();
            entity.Property(row => row.CreatedAt).HasColumnName("created_at").IsRequired();
            entity.Property(row => row.ActorProfile).HasColumnName("actor_profile");
            entity.Property(row => row.ActorUserId).HasColumnName("actor_user_id");
        });
        modelBuilder.Entity<TrackingCode>(entity =>
        {
            entity.ToTable("tracking_codes");
            entity.HasKey(row => row.Code);
            entity.Property(row => row.Code).HasColumnName("code");
            entity.Property(row => row.ItemId).HasColumnName("item_id").IsRequired();
            entity.Property(row => row.IssuedAt).HasColumnName("issued_at").IsRequired();
        });
        modelBuilder.Entity<IncidentAllocation>(entity =>
        {
            entity.ToTable("incident_allocations");
            entity.HasKey(row => new { row.IncidentId, row.ItemId });
            entity.Property(row => row.IncidentId).HasColumnName("incident_id").IsRequired();
            entity.Property(row => row.ItemId).HasColumnName("item_id").IsRequired();
            entity.Property(row => row.Given).HasColumnName("given").IsRequired();
            entity.Property(row => row.Wasted).HasColumnName("wasted").IsRequired();
        });
        modelBuilder.Entity<IncidentVersion>(entity =>
        {
            entity.ToTable("incident_versions");
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id").UseIdentityByDefaultColumn();
            entity.Property(row => row.IncidentId).HasColumnName("incident_id").IsRequired();
            entity.Property(row => row.Revision).HasColumnName("revision").IsRequired();
            entity.Property(row => row.Status).HasColumnName("status").IsRequired();
            entity.Property(row => row.Payload).HasColumnName("payload").IsRequired();
            entity.Property(row => row.CreatedAt).HasColumnName("created_at").IsRequired();
        });
        modelBuilder.Entity<DrugCheck>(entity =>
        {
            entity.ToTable("drug_checks");
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id");
            entity.Property(row => row.BoxId).HasColumnName("box_id").IsRequired();
            entity.Property(row => row.Status).HasColumnName("status").IsRequired().HasConversion<StatusValueConverter<DrugCheckStatus>>();
            entity.Property(row => row.Kind).HasColumnName("kind").IsRequired();
            entity.Property(row => row.ItemIds).HasColumnName("item_ids").IsRequired();
            entity.Property(row => row.CheckedIds).HasColumnName("checked_ids").IsRequired();
            entity.Property(row => row.Notes).HasColumnName("notes").IsRequired().HasDefaultValue("").ValueGeneratedNever();
            entity.Property(row => row.Revision).HasColumnName("revision").IsRequired().HasDefaultValue(1).ValueGeneratedNever();
            entity.Property(row => row.CreatedAt).HasColumnName("created_at").IsRequired();
            entity.Property(row => row.UpdatedAt).HasColumnName("updated_at").IsRequired();
            entity.Property(row => row.CompletedAt).HasColumnName("completed_at");
            entity.Property(row => row.StockRevision).HasColumnName("stock_revision").IsRequired().HasDefaultValue(0).ValueGeneratedNever();
        });
        modelBuilder.Entity<MedicationClass>(entity =>
        {
            entity.ToTable("medication_classes");
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id");
            entity.Property(row => row.Name).HasColumnName("name").IsRequired();
            entity.Property(row => row.Description).HasColumnName("description").IsRequired().HasDefaultValue("").ValueGeneratedNever();
        });
        modelBuilder.Entity<AccessProfile>(entity =>
        {
            entity.ToTable("access_profiles");
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id");
            entity.Property(row => row.Name).HasColumnName("name").IsRequired();
            entity.Property(row => row.Tags).HasColumnName("tags").IsRequired();
        });
        modelBuilder.Entity<AccessRule>(entity =>
        {
            entity.ToTable("access_rules");
            entity.HasKey(row => row.Resource);
            entity.Property(row => row.Resource).HasColumnName("resource");
            entity.Property(row => row.Rule).HasColumnName("rule").IsRequired();
        });
        modelBuilder.Entity<AccessAudit>(entity =>
        {
            entity.ToTable("access_audit");
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id").UseIdentityByDefaultColumn();
            entity.Property(row => row.ActorProfile).HasColumnName("actor_profile").IsRequired();
            entity.Property(row => row.Action).HasColumnName("action").IsRequired();
            entity.Property(row => row.Details).HasColumnName("details").IsRequired();
            entity.Property(row => row.CreatedAt).HasColumnName("created_at").IsRequired();
        });
        modelBuilder.Entity<InventoryBatch>(entity =>
        {
            entity.ToTable("inventory_batches");
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id");
            entity.Property(row => row.DefinitionId).HasColumnName("definition_id").IsRequired();
            entity.Property(row => row.LotNumber).HasColumnName("lot_number").IsRequired();
            entity.Property(row => row.ExpiresOn).HasColumnName("expires_on").IsRequired();
            entity.Property(row => row.Quantity).HasColumnName("quantity").IsRequired();
            entity.Property(row => row.CreatedAt).HasColumnName("created_at").IsRequired();
        });
        modelBuilder.Entity<WitnessSignoff>(entity =>
        {
            entity.ToTable("witness_signoffs");
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id");
            entity.Property(row => row.ActorUserId).HasColumnName("actor_user_id").IsRequired();
            entity.Property(row => row.WitnessUserId).HasColumnName("witness_user_id").IsRequired();
            entity.Property(row => row.WitnessUsername).HasColumnName("witness_username").IsRequired();
            entity.Property(row => row.WitnessName).HasColumnName("witness_name").IsRequired();
            entity.Property(row => row.ServiceId).HasColumnName("service_id").IsRequired();
            entity.Property(row => row.Action).HasColumnName("action").IsRequired();
            entity.Property(row => row.RequestHash).HasColumnName("request_hash").IsRequired();
            entity.Property(row => row.CreatedAt).HasColumnName("created_at").IsRequired();
        });
        modelBuilder.Entity<Service>(entity =>
        {
            entity.ToTable("services");
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id");
            entity.Property(row => row.Name).HasColumnName("name").IsRequired();
            entity.Property(row => row.Details).HasColumnName("details").IsRequired().HasDefaultValue("{}").ValueGeneratedNever();
            entity.Property(row => row.Active).HasColumnName("active").IsRequired().HasDefaultValue(1).ValueGeneratedNever();
            entity.Property(row => row.Internal).HasColumnName("internal").IsRequired().HasDefaultValue(0).ValueGeneratedNever();
        });
        modelBuilder.Entity<User>(entity =>
        {
            entity.ToTable("users");
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id");
            entity.Property(row => row.Username).HasColumnName("username").IsRequired();
            entity.Property(row => row.Name).HasColumnName("name").IsRequired();
            entity.Property(row => row.PasswordHash).HasColumnName("password_hash").IsRequired();
            entity.Property(row => row.CreatedAt).HasColumnName("created_at").IsRequired();
            entity.Property(row => row.PlatformRole).HasColumnName("platform_role").IsRequired().HasDefaultValue("").ValueGeneratedNever();
            entity.Property(row => row.LicenseLevel).HasColumnName("license_level").IsRequired().HasDefaultValue("Driver").ValueGeneratedNever();
        });
        modelBuilder.Entity<ServiceMembership>(entity =>
        {
            entity.ToTable("service_memberships");
            entity.HasKey(row => new { row.UserId, row.ServiceId });
            entity.Property(row => row.UserId).HasColumnName("user_id").IsRequired();
            entity.Property(row => row.ServiceId).HasColumnName("service_id").IsRequired();
            entity.Property(row => row.Tags).HasColumnName("tags").IsRequired();
            entity.Property(row => row.Active).HasColumnName("active").IsRequired().HasDefaultValue(1).ValueGeneratedNever();
        });
        modelBuilder.Entity<UserSession>(entity =>
        {
            entity.ToTable("user_sessions");
            entity.HasKey(row => row.TokenHash);
            entity.Property(row => row.TokenHash).HasColumnName("token_hash");
            entity.Property(row => row.UserId).HasColumnName("user_id").IsRequired();
            entity.Property(row => row.ServiceId).HasColumnName("service_id").IsRequired();
            entity.Property(row => row.ExpiresAt).HasColumnName("expires_at").IsRequired();
        });
        modelBuilder.Entity<IdentityAudit>(entity =>
        {
            entity.ToTable("identity_audit");
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id").UseIdentityByDefaultColumn();
            entity.Property(row => row.ServiceId).HasColumnName("service_id");
            entity.Property(row => row.ActorId).HasColumnName("actor_id");
            entity.Property(row => row.Actor).HasColumnName("actor").IsRequired();
            entity.Property(row => row.Action).HasColumnName("action").IsRequired();
            entity.Property(row => row.Details).HasColumnName("details").IsRequired();
            entity.Property(row => row.CreatedAt).HasColumnName("created_at").IsRequired();
        });
        modelBuilder.Entity<LoginAttempt>(entity =>
        {
            entity.ToTable("login_attempts");
            entity.HasKey(row => row.Key);
            entity.Property(row => row.Key).HasColumnName("key");
            entity.Property(row => row.Failures).HasColumnName("failures").IsRequired();
            entity.Property(row => row.UntilMs).HasColumnName("until_ms").IsRequired();
        });
        modelBuilder.Entity<Discrepancy>(entity =>
        {
            entity.ToTable("discrepancies");
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id");
            entity.Property(row => row.BoxId).HasColumnName("box_id").IsRequired();
            entity.Property(row => row.ItemId).HasColumnName("item_id");
            entity.Property(row => row.Notes).HasColumnName("notes").IsRequired();
            entity.Property(row => row.Status).HasColumnName("status").IsRequired()
                .HasConversion<StatusValueConverter<DiscrepancyStatus>>().HasDefaultValue(DiscrepancyStatus.Open).ValueGeneratedNever();
            entity.Property(row => row.ReportedBy).HasColumnName("reported_by").IsRequired();
            entity.Property(row => row.ReportedAt).HasColumnName("reported_at").IsRequired();
            entity.Property(row => row.ApprovedBy).HasColumnName("approved_by");
            entity.Property(row => row.ApprovedAt).HasColumnName("approved_at");
            entity.Property(row => row.Resolution).HasColumnName("resolution").IsRequired().HasDefaultValue("").ValueGeneratedNever();
            entity.Property(row => row.Revision).HasColumnName("revision").IsRequired().HasDefaultValue(1).ValueGeneratedNever();
        });
        modelBuilder.Entity<CompanyMigration>(entity =>
        {
            entity.ToTable("company_migrations");
            entity.HasKey(row => row.Version);
            entity.Property(row => row.Version).HasColumnName("version").ValueGeneratedNever();
        });
        modelBuilder.Entity<CompanyTombstone>(entity =>
        {
            entity.ToTable("company_tombstones");
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Id).HasColumnName("id");
            entity.Property(row => row.Name).HasColumnName("name").IsRequired();
            entity.Property(row => row.DeletedAt).HasColumnName("deleted_at").IsRequired();
            entity.Property(row => row.ActorId).HasColumnName("actor_id").IsRequired();
        });
        ConfigureConstraints(modelBuilder, IsIdentity);
        if (!IsIdentity)
        {
            foreach (var entityType in IdentityEntityTypes)
                modelBuilder.Ignore(entityType);
        }
    }
}
