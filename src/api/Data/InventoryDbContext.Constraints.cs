using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using EmCoreInventory.Api.Common;

namespace EmCoreInventory.Api.Data;

public sealed partial class InventoryDbContext
{
    private static void ConfigureConstraints(ModelBuilder model)
    {
        model.Entity<InventoryItem>().ToTable("inventory_items", table => table.UseSqlReturningClause(false));
        model.Entity<InventoryItem>().HasIndex(row => row.Code).IsUnique();
        model.Entity<InventoryItem>().HasIndex(row => new { row.ExternalSource, row.ExternalId }).IsUnique();
        model.Entity<TrackingCode>().HasIndex(row => row.ItemId).IsUnique();
        model.Entity<User>().HasIndex(row => row.Username).IsUnique();
        model.Entity<MedicationTag>().HasIndex(row => row.Name).IsUnique();
        model.Entity<MedicationClass>().HasIndex(row => row.Name).IsUnique();
        model.Entity<DrugDefinition>().HasIndex(row => new { row.Name, row.ConcentrationValue, row.AmountUnit, row.ConcentrationBasis, row.MaxAmount, row.Form }).IsUnique();
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
        model.Entity<ServiceMembership>().HasOne<User>().WithMany().HasForeignKey(row => row.UserId).OnDelete(DeleteBehavior.Restrict);
        model.Entity<ServiceMembership>().HasOne<Service>().WithMany().HasForeignKey(row => row.ServiceId).OnDelete(DeleteBehavior.Restrict);
        model.Entity<UserSession>().HasOne<User>().WithMany().HasForeignKey(row => row.UserId).OnDelete(DeleteBehavior.Restrict);
        model.Entity<UserSession>().HasOne<Service>().WithMany().HasForeignKey(row => row.ServiceId).OnDelete(DeleteBehavior.Restrict);
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
