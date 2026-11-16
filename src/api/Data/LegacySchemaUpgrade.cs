using System.Data;
using System.Reflection;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Migrations.Operations;
using Microsoft.EntityFrameworkCore.Storage;

namespace EmCoreInventory.Api.Data;

internal static class LegacySchemaUpgrade
{
    private static readonly MethodInfo ProbeMethod = typeof(LegacySchemaUpgrade)
        .GetMethod(nameof(Probe), BindingFlags.NonPublic | BindingFlags.Static)!;

    public static void Apply(InventoryDbContext db)
    {
        Backup(db);
        var model = db.GetService<IDesignTimeModel>().Model;
        var operations = db.GetService<IMigrationsModelDiffer>()
            .GetDifferences(null, model.GetRelationalModel());
        var additions = new List<MigrationOperation>();
        var newTables = new HashSet<string>();
        var newColumns = new HashSet<(string Table, string Column)>();
        foreach (var table in operations.OfType<CreateTableOperation>())
        {
            var entity = model.GetEntityTypes().Single(type => type.GetTableName() == table.Name);
            var key = entity.FindPrimaryKey()!.Properties[0];
            if (Missing(db, entity.ClrType, key.Name, "no such table"))
            {
                newTables.Add(table.Name);
                additions.Add(table);
                continue;
            }
            var identifier = StoreObjectIdentifier.Table(table.Name, table.Schema);
            foreach (var property in entity.GetProperties())
                if (Missing(db, entity.ClrType, property.Name, "no such column"))
                {
                    var column = table.Columns.Single(column => column.Name == property.GetColumnName(identifier));
                    column.Table = table.Name;
                    column.Schema = table.Schema;
                    additions.Add(column);
                    newColumns.Add((table.Name, column.Name));
                }
        }
        additions.AddRange(operations.OfType<CreateIndexOperation>().Where(index =>
            newTables.Contains(index.Table) || index.Columns.Any(column => newColumns.Contains((index.Table, column)))));
        if (additions.Count == 0) return;
        var commands = db.GetService<IMigrationsSqlGenerator>().Generate(additions, model);
        db.GetService<IMigrationCommandExecutor>().ExecuteNonQuery(commands, db.GetService<IRelationalConnection>());
    }

    private static bool Missing(InventoryDbContext db, Type entity, string property, string error)
    {
        try
        {
            ProbeMethod.MakeGenericMethod(entity).Invoke(null, [db, property]);
            return false;
        }
        catch (TargetInvocationException exception) when (exception.InnerException is SqliteException sqlite
            && sqlite.SqliteErrorCode == 1 && sqlite.Message.Contains(error, StringComparison.Ordinal))
        {
            return true;
        }
    }

    private static void Probe<TEntity>(InventoryDbContext db, string property) where TEntity : class =>
        db.Set<TEntity>().AsNoTracking().Select(row => EF.Property<object>(row, property)).Take(1).ToList();

    private static void Backup(InventoryDbContext db)
    {
        var source = (SqliteConnection)db.Database.GetDbConnection();
        if (source.DataSource is "" or ":memory:" || !File.Exists(source.DataSource)) return;
        var path = source.DataSource + ".pre-ef.sqlite";
        if (File.Exists(path)) return;
        var opened = source.State != ConnectionState.Open;
        if (opened) source.Open();
        var temporary = path + "." + Guid.NewGuid().ToString("N") + ".sqlite";
        try
        {
            using (var target = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = temporary, Pooling = false }.ToString()))
            {
                target.Open();
                source.BackupDatabase(target);
            }
            File.Move(temporary, path);
        }
        finally
        {
            if (opened) source.Close();
            if (File.Exists(temporary)) File.Delete(temporary);
        }
    }
}
