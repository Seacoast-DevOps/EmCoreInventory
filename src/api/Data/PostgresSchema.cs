using System.Data.Common;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Migrations.Operations;
using Microsoft.EntityFrameworkCore.Storage;

namespace EmCoreInventory.Api.Data;

public static class PostgresSchema
{
    public const int CurrentVersion = 1;
    private const string VersionsTable = "schema_versions";

    private static void LockBootstrap(InventoryDbContext db)
    {
        using var command = CreateCommand(db,
            "SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(@schema, 0))");
        AddParameter(command, "schema", db.Schema);
        command.ExecuteNonQuery();
    }

    private static IReadOnlyList<MigrationOperation> GetCreateOperations(InventoryDbContext db)
    {
        var model = db.GetService<IDesignTimeModel>().Model;
        return db.GetService<IMigrationsModelDiffer>().GetDifferences(null, model.GetRelationalModel());
    }

    // Concurrent first reads may share the company lock. Serialize initial DDL
    // and recheck the version after the first initializer commits its seeds.
    public static bool Apply(InventoryDbContext db)
    {
        var version = ReadVersion(db);
        if (version is null)
        {
            LockBootstrap(db);
            version = ReadVersion(db);
        }
        if (version == CurrentVersion) return false;
        if (version is not null)
            throw new InvalidOperationException($"Unsupported PostgreSQL schema version {version} in {db.Schema}.");

        CreateVersionOne(db);
        return true;
    }

    private static void CreateVersionOne(InventoryDbContext db)
    {
        var schema = Quote(db.Schema);
        var model = db.GetService<IDesignTimeModel>().Model;
        Execute(db, $"CREATE SCHEMA IF NOT EXISTS {schema}");
        var operations = GetCreateOperations(db).Where(operation => operation is not EnsureSchemaOperation).ToArray();
        foreach (var command in db.GetService<IMigrationsSqlGenerator>().Generate(operations, model))
            Execute(db, command.CommandText);

        // Expression indexes enforce case-insensitive uniqueness.
        Execute(db, $"CREATE UNIQUE INDEX ux_medication_tags_name_ci ON {schema}.medication_tags (lower(name))");
        Execute(db, $"CREATE UNIQUE INDEX ux_medication_classes_name_ci ON {schema}.medication_classes (lower(name))");
        Execute(db, $"""
            CREATE UNIQUE INDEX ux_drug_definitions_label_ci ON {schema}.drug_definitions
            (lower(name), concentration_value, amount_unit, concentration_basis, max_amount, form)
            """);
        if (db.IsIdentity)
            Execute(db, $"CREATE UNIQUE INDEX ux_users_username_ci ON {schema}.users (lower(username))");

        var versions = $"{schema}.{VersionsTable}";
        Execute(db, $"CREATE TABLE {versions} (version integer PRIMARY KEY)");
        Execute(db, $"INSERT INTO {versions} (version) VALUES (1)");
    }

    internal static void PurgePrimaryInventory(InventoryDbContext db)
    {
        var tables = db.Model.GetEntityTypes()
            .Where(entity => entity.ClrType != typeof(InventorySeed)
                && !InventoryDbContext.IdentityEntityTypes.Contains(entity.ClrType))
            .Select(entity => $"{Quote(db.Schema)}.{Quote(entity.GetTableName()!)}")
            .Distinct()
            .Order(StringComparer.Ordinal);
        Execute(db, $"TRUNCATE TABLE {string.Join(", ", tables)} RESTART IDENTITY");
    }

    internal static void DropCompany(InventoryDbContext db, string schema) =>
        Execute(db, $"DROP SCHEMA IF EXISTS {Quote(schema)} CASCADE");

    private static int? ReadVersion(InventoryDbContext db)
    {
        using var exists = CreateCommand(db, "SELECT pg_catalog.to_regclass(@table) IS NOT NULL");
        AddParameter(exists, "table", $"{Quote(db.Schema)}.{VersionsTable}");
        if (exists.ExecuteScalar() is false) return null;

        using var current = CreateCommand(db, $"SELECT max(version) FROM {Quote(db.Schema)}.{VersionsTable}");
        return current.ExecuteScalar() is int version
            ? version
            : throw new InvalidOperationException($"PostgreSQL schema {db.Schema} has an empty version table.");
    }

    private static void Execute(InventoryDbContext db, string sql)
    {
        using var command = CreateCommand(db, sql);
        command.ExecuteNonQuery();
    }

    private static DbCommand CreateCommand(InventoryDbContext db, string sql)
    {
        var transaction = db.Database.CurrentTransaction
            ?? throw new InvalidOperationException("Schema operations require a transaction.");
        var command = db.Database.GetDbConnection().CreateCommand();
        command.Transaction = transaction.GetDbTransaction();
        command.CommandText = sql;
        return command;
    }

    private static void AddParameter(DbCommand command, string name, string value)
    {
        var parameter = command.CreateParameter();
        parameter.ParameterName = name;
        parameter.Value = value;
        command.Parameters.Add(parameter);
    }

    private static string Quote(string identifier) => "\"" + identifier.Replace("\"", "\"\"") + "\"";
}
