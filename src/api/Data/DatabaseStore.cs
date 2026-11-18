using System.Data;
using EmCoreInventory.Api.Common;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace EmCoreInventory.Api.Data;

public enum CompanyLockMode { Read, Write }

public sealed class DatabaseStore
{
    private const string ConnectionStringName = "emcore";
    public const string PrimaryServiceId = "primary";
    public const string PrimarySchema = "emcore_primary";
    private const string CompanySchemaPrefix = "emcore_company_";

    private readonly string connectionString;
    private readonly object identityInitializationLock = new();
    private volatile bool identityInitialized;

    public DatabaseStore(IConfiguration configuration)
    {
        connectionString = configuration.GetConnectionString(ConnectionStringName)?.Trim() ?? "";
        if (connectionString.Length == 0)
            throw new InvalidOperationException($"Set ConnectionStrings:{ConnectionStringName} to the PostgreSQL database connection string.");
    }

    public static string SchemaFor(string serviceId)
    {
        if (serviceId == PrimaryServiceId) return PrimarySchema;
        if (!Guid.TryParseExact(serviceId, "D", out var id))
            throw new ApiException(400, "Invalid company identifier");
        return CompanySchemaPrefix + id.ToString("N");
    }

    public InventoryDbContext OpenIdentity()
    {
        var db = Open(PrimaryServiceId);
        try
        {
            if (!identityInitialized)
            {
                lock (identityInitializationLock)
                {
                    if (!identityInitialized)
                    {
                        using var transaction = db.Database.BeginTransaction();
                        if (PostgresSchema.Apply(db)) DatabaseInitializer.Seed(db);
                        else if (!db.Services.Any(service => service.Id == "platform" && service.Internal == 1))
                            throw new InvalidOperationException("The PostgreSQL identity schema is missing the platform service record.");
                        transaction.Commit();
                        identityInitialized = true;
                    }
                }
            }
            return db;
        }
        catch
        {
            db.Dispose();
            throw;
        }
    }

    public async Task<InventoryDbContext> OpenServiceAsync(string serviceId, CancellationToken cancellationToken)
    {
        using var identityDb = OpenIdentity();
        await using var transaction = await BeginCompanyTransactionAsync(identityDb, serviceId, cancellationToken);
        if (serviceId != PrimaryServiceId)
        {
            using var tenant = OpenEnlisted(serviceId, identityDb, transaction);
        }
        await transaction.CommitAsync(cancellationToken);
        return Open(serviceId);
    }

    // The caller saves both contexts and owns the transaction, connection, and their disposal order.
    public InventoryDbContext OpenService(string serviceId, InventoryDbContext identityDb)
    {
        _ = SchemaFor(serviceId);
        if (serviceId == PrimaryServiceId)
            throw new ArgumentException("Use the existing identity context for primary company operations.", nameof(serviceId));

        var transaction = RequireIdentityTransaction(identityDb);
        if (identityDb.ActiveCompanyLock != (transaction.TransactionId, serviceId))
            throw new InvalidOperationException("Begin an active company transaction before opening the tenant context.");
        return OpenEnlisted(serviceId, identityDb, transaction);
    }

    private static InventoryDbContext OpenEnlisted(string serviceId, InventoryDbContext identityDb, IDbContextTransaction transaction)
    {
        var db = new InventoryDbContext(new DbContextOptionsBuilder<InventoryDbContext>()
            .UseNpgsql(identityDb.Database.GetDbConnection(), contextOwnsConnection: false).Options, serviceId);
        try
        {
            db.Database.UseTransaction(transaction.GetDbTransaction());
            if (PostgresSchema.Apply(db)) DatabaseInitializer.Seed(db);
            return db;
        }
        catch
        {
            db.Dispose();
            throw;
        }
    }

    public async Task<IDbContextTransaction> BeginCompanyTransactionAsync(
        InventoryDbContext identityDb, string serviceId, CancellationToken cancellationToken, CompanyLockMode mode = CompanyLockMode.Write)
    {
        _ = SchemaFor(serviceId);
        if (!identityDb.IsIdentity)
            throw new ArgumentException("The transaction must start on the identity context.", nameof(identityDb));

        var transaction = await identityDb.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, cancellationToken);
        try
        {
            await LockCompanyAsync(identityDb, serviceId, mode, requireActive: true, cancellationToken);
            identityDb.ActiveCompanyLock = (transaction.TransactionId, serviceId);
            return transaction;
        }
        catch
        {
            await transaction.DisposeAsync();
            throw;
        }
    }

    public async Task PurgeCompanyAsync(string serviceId, InventoryDbContext identityDb, CancellationToken cancellationToken)
    {
        var schema = SchemaFor(serviceId);
        RequireIdentityTransaction(identityDb);
        await LockCompanyAsync(identityDb, serviceId, CompanyLockMode.Write, requireActive: false, cancellationToken);
        if (serviceId == PrimaryServiceId)
            PostgresSchema.PurgePrimaryInventory(identityDb);
        else
            PostgresSchema.DropCompany(identityDb, schema);
    }

    private InventoryDbContext Open(string serviceId) =>
        new(new DbContextOptionsBuilder<InventoryDbContext>().UseNpgsql(connectionString).Options, serviceId);

    private static IDbContextTransaction RequireIdentityTransaction(InventoryDbContext db) =>
        (db.IsIdentity ? db.Database.CurrentTransaction : null)
        ?? throw new InvalidOperationException("An active identity transaction is required.");

    private static async Task LockCompanyAsync(
        InventoryDbContext db, string id, CompanyLockMode mode, bool requireActive, CancellationToken cancellationToken)
    {
        var query = mode == CompanyLockMode.Read
            ? db.Services.FromSqlInterpolated($"""SELECT * FROM emcore_primary.services WHERE id = {id} AND "internal" = 0 FOR SHARE""")
            : db.Services.FromSqlInterpolated($"""SELECT * FROM emcore_primary.services WHERE id = {id} AND "internal" = 0 FOR UPDATE""");
        var rows = await query.AsNoTracking().ToListAsync(cancellationToken);
        var company = rows.SingleOrDefault() ?? throw new ApiException(404, "Company not found");

        if (requireActive && company.Active == 0)
            throw new ApiException(403, "Select an active company for inventory operations");
    }
}
