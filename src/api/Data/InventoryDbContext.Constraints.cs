using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using EmCoreInventory.Api.Common;

namespace EmCoreInventory.Api.Data;

public sealed partial class InventoryDbContext
{
    private static void ConfigureConstraints(ModelBuilder model, bool identity)
    {
        model.Entity<InventoryItem>().ToTable("inventory_items", table =>
        {
            table.HasCheckConstraint("ck_inventory_items_tracking_code", "code IS NULL OR code ~ '^[A-Z0-9]{8}$'");
            table.HasCheckConstraint("ck_inventory_items_status", "status IN ('available', 'opened', 'unassigned', 'used', 'disposed')");
        });
        model.Entity<Incident>().ToTable("incidents", table =>
            table.HasCheckConstraint("ck_incidents_status", "status IN ('completed', 'draft', 'reopened')"));
        model.Entity<DrugCheck>().ToTable("drug_checks", table =>
            table.HasCheckConstraint("ck_drug_checks_status", "status IN ('draft', 'complete', 'superseded')"));
        model.Entity<Discrepancy>().ToTable("discrepancies", table =>
            table.HasCheckConstraint("ck_discrepancies_status", "status IN ('open', 'approved')"));
        model.Entity<TrackingCode>().ToTable("tracking_codes", table =>
            table.HasCheckConstraint("ck_tracking_codes_code", "code ~ '^[A-Z0-9]{8}$'"));
        model.Entity<InventoryItem>().HasIndex(row => row.Code).IsUnique();
        model.Entity<InventoryItem>().HasIndex(row => new { row.ExternalSource, row.ExternalId }).IsUnique();
        model.Entity<TrackingCode>().HasIndex(row => row.ItemId).IsUnique();
        model.Entity<Incident>().HasIndex(row => row.ClientKey).IsUnique();
        model.Entity<DrugCheck>().HasIndex(row => row.BoxId).IsUnique().HasFilter("status = 'draft'");
        model.Entity<Incident>().Property(row => row.Revision).IsConcurrencyToken();
        model.Entity<DrugCheck>().Property(row => row.Revision).IsConcurrencyToken();
        model.Entity<Discrepancy>().Property(row => row.Revision).IsConcurrencyToken();
        model.Entity<InventoryBox>().Property(row => row.StockRevision).IsConcurrencyToken();
        model.Entity<InventoryItem>().HasOne<InventoryBox>().WithMany().HasForeignKey(row => row.BoxId).OnDelete(DeleteBehavior.Restrict);
        model.Entity<InventoryItem>().HasOne<DrugDefinition>().WithMany().HasForeignKey(row => row.DefinitionId).OnDelete(DeleteBehavior.Restrict);
        model.Entity<InventoryItem>().HasOne<InventoryBatch>().WithMany().HasForeignKey(row => row.BatchId).OnDelete(DeleteBehavior.Restrict);
        model.Entity<InventoryEvent>().HasOne<InventoryItem>().WithMany().HasForeignKey(row => row.ItemId).OnDelete(DeleteBehavior.Restrict);
        model.Entity<DrugDefinition>().HasOne<MedicationClass>().WithMany().HasForeignKey(row => row.MedicationClassId).OnDelete(DeleteBehavior.Restrict);
        model.Entity<DefinitionTag>().HasOne<DrugDefinition>().WithMany().HasForeignKey(row => row.DefinitionId).OnDelete(DeleteBehavior.Restrict);
        model.Entity<DefinitionTag>().HasOne<MedicationTag>().WithMany().HasForeignKey(row => row.TagId).OnDelete(DeleteBehavior.Restrict);
        model.Entity<ParLevel>().HasOne<DrugDefinition>().WithMany().HasForeignKey(row => row.DefinitionId).OnDelete(DeleteBehavior.Restrict);
        model.Entity<ParLevel>().HasOne<InventoryBox>().WithMany().HasForeignKey(row => row.BoxId).OnDelete(DeleteBehavior.Restrict);
        model.Entity<InventoryBatch>().HasOne<DrugDefinition>().WithMany().HasForeignKey(row => row.DefinitionId).OnDelete(DeleteBehavior.Restrict);
        model.Entity<IncidentItem>().HasOne<Incident>().WithMany().HasForeignKey(row => row.IncidentId).OnDelete(DeleteBehavior.Restrict);
        model.Entity<IncidentItem>().HasOne<InventoryItem>().WithMany().HasForeignKey(row => row.ItemId).OnDelete(DeleteBehavior.Restrict);
        model.Entity<IncidentAllocation>().HasOne<Incident>().WithMany().HasForeignKey(row => row.IncidentId).OnDelete(DeleteBehavior.Restrict);
        model.Entity<IncidentAllocation>().HasOne<InventoryItem>().WithMany().HasForeignKey(row => row.ItemId).OnDelete(DeleteBehavior.Restrict);
        model.Entity<IncidentVersion>().HasOne<Incident>().WithMany().HasForeignKey(row => row.IncidentId).OnDelete(DeleteBehavior.Restrict);
        model.Entity<DrugCheck>().HasOne<InventoryBox>().WithMany().HasForeignKey(row => row.BoxId).OnDelete(DeleteBehavior.Restrict);
        model.Entity<Discrepancy>().HasOne<InventoryBox>().WithMany().HasForeignKey(row => row.BoxId).OnDelete(DeleteBehavior.Restrict);
        model.Entity<Discrepancy>().HasOne<InventoryItem>().WithMany().HasForeignKey(row => row.ItemId).OnDelete(DeleteBehavior.Restrict);
        if (identity)
        {
            // A single canonical service ID must own each UUID-derived PostgreSQL schema.
            model.Entity<Service>().ToTable("services", table =>
                table.HasCheckConstraint("ck_services_canonical_id",
                    "id IN ('primary', 'platform') OR id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'"));
            model.Entity<UserSession>().HasIndex(row => row.ExpiresAt);
            model.Entity<IdentityAudit>().HasIndex(row => new { row.ServiceId, row.Id });
            model.Entity<ServiceMembership>().HasOne<User>().WithMany().HasForeignKey(row => row.UserId).OnDelete(DeleteBehavior.Restrict);
            model.Entity<ServiceMembership>().HasOne<Service>().WithMany().HasForeignKey(row => row.ServiceId).OnDelete(DeleteBehavior.Restrict);
            model.Entity<UserSession>().HasOne<User>().WithMany().HasForeignKey(row => row.UserId).OnDelete(DeleteBehavior.Restrict);
            model.Entity<UserSession>().HasOne<Service>().WithMany().HasForeignKey(row => row.ServiceId).OnDelete(DeleteBehavior.Restrict);
        }
    }

    private void ValidateChanges()
    {
        foreach (var entry in ChangeTracker.Entries<WitnessSignoff>())
            if (entry.State is EntityState.Modified or EntityState.Deleted)
                throw new ApiException(409, "Witness sign-offs are permanent and immutable");
        foreach (var entry in ChangeTracker.Entries<TrackingCode>())
            if (entry.State is EntityState.Modified or EntityState.Deleted)
                throw new ApiException(409, "Tracking code history is permanent and immutable");
        foreach (var entry in ChangeTracker.Entries<InventoryItem>())
        {
            if (entry.State == EntityState.Added && !Regex.IsMatch(entry.Entity.Code ?? "", "^[A-Z0-9]{8}$"))
                throw new ApiException(400, "An eight-character uppercase alphanumeric code is required");
            if (entry.State == EntityState.Modified && entry.Property(row => row.Code).IsModified)
                throw new ApiException(409, "Tracking codes cannot change");
        }
    }

    public override int SaveChanges(bool acceptAllChangesOnSuccess)
    {
        ValidateChanges();
        return base.SaveChanges(acceptAllChangesOnSuccess);
    }

    public override Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default)
    {
        ValidateChanges();
        return base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
    }
}
