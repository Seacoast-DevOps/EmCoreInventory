using System.Collections.Concurrent;
using EmCoreInventory.Api.Auth;
using EmCoreInventory.Api.Common;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Migrations.Operations;
using Microsoft.EntityFrameworkCore.Storage;

namespace EmCoreInventory.Api.Data;

public sealed class DatabaseStore
{
    private readonly string identityPath;
    private readonly ConcurrentDictionary<string, bool> initialized = new();
    private readonly object initializationLock = new();

    public DatabaseStore(IConfiguration configuration, IWebHostEnvironment environment)
    {
        var configured = Environment.GetEnvironmentVariable("EMCORE_DB") ?? configuration["Database:Path"];
        identityPath = Path.GetFullPath(configured ?? Path.Combine(environment.ContentRootPath, "../../server/data/inventory.sqlite"));
        Directory.CreateDirectory(Path.GetDirectoryName(identityPath)!);
    }

    public InventoryDbContext OpenIdentity() => Open(identityPath, true);

    public InventoryDbContext OpenService(string serviceId)
    {
        if (serviceId == "primary") return OpenIdentity();
        if (!Guid.TryParseExact(serviceId, "D", out _)) throw new ApiException(400, "Invalid company identifier");
        return Open(ServicePath(serviceId), false);
    }

    private string ServicePath(string serviceId) => Path.Combine(Path.GetDirectoryName(identityPath)!, "service-" + serviceId + ".sqlite");

    private InventoryDbContext Open(string path, bool identity)
    {
        var connection = new SqliteConnectionStringBuilder { DataSource = path, ForeignKeys = true, DefaultTimeout = 5, Pooling = false };
        var db = new InventoryDbContext(new DbContextOptionsBuilder<InventoryDbContext>().UseSqlite(connection.ToString()).Options);
        try
        {
            lock (initializationLock)
            {
                if (!initialized.ContainsKey(path))
                {
                    DatabaseInitializer.Initialize(db, identity, !identity);
                    initialized[path] = true;
                }
            }
            return db;
        }
        catch { db.Dispose(); throw; }
    }

    public void PurgeCompany(string serviceId)
    {
        lock (initializationLock)
        {
            if (serviceId != "primary")
            {
                if (!Guid.TryParseExact(serviceId, "D", out _)) throw new ApiException(400, "Invalid company identifier");
                var path = ServicePath(serviceId);
                foreach (var suffix in new[] { "", "-wal", "-shm", "-journal", ".pre-ef.sqlite" })
                    if (File.Exists(path + suffix)) File.Delete(path + suffix);
                initialized.TryRemove(path, out _);
                return;
            }
            using var db = OpenIdentity();
            string[] operational = ["witness_signoffs", "discrepancies", "incident_allocations", "incident_versions", "incident_items", "drug_checks", "inventory_events", "tracking_codes", "inventory_items", "inventory_batches", "par_levels", "definition_tags", "drug_definitions", "medication_tags", "medication_classes", "inventory_boxes", "incidents", "settings_events", "access_audit", "access_rules", "access_profiles", "inventory_seeds"];
            var model = db.GetService<IDesignTimeModel>().Model;
            var creates = db.GetService<IMigrationsModelDiffer>().GetDifferences(null, model.GetRelationalModel());
            var operations = operational.Select(table => (MigrationOperation)new DropTableOperation { Name = table }).ToList();
            operations.AddRange(creates.Where(operation => operation switch
            {
                CreateTableOperation table => operational.Contains(table.Name),
                CreateIndexOperation index => operational.Contains(index.Table),
                _ => false
            }));
            using var transaction = db.Database.BeginTransaction();
            var commands = db.GetService<IMigrationsSqlGenerator>().Generate(operations, model);
            db.GetService<IMigrationCommandExecutor>().ExecuteNonQuery(commands, db.GetService<IRelationalConnection>());
            db.InventorySeeds.AddRange(Enumerable.Range(1, 5).Select(version => new InventorySeed { Version = version }));
            db.SaveChanges();
            transaction.Commit();
        }
    }
}
