using System.Text.Json;
using System.Text.Json.Nodes;
using EmCoreInventory.Api.Auth;
using EmCoreInventory.Api.Common;
using EmCoreInventory.Api.Data;
using EmCoreInventory.Api.Inventory;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);
if (builder.Configuration["urls"] is null)
    builder.WebHost.UseUrls("http://127.0.0.1:" + (Environment.GetEnvironmentVariable("PORT") ?? "3001"));
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 65536);
builder.Services.AddSingleton<DatabaseStore>();
builder.Services.ConfigureHttpJsonOptions(options => options.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase);
var app = builder.Build();
using (var db = app.Services.GetRequiredService<DatabaseStore>().OpenIdentity()) { }

var requests = new SemaphoreSlim(1, 1);
app.Use(async (http, next) =>
{
    http.Response.Headers.CacheControl = "no-store";
    await requests.WaitAsync(http.RequestAborted);
    try
    {
        if (HttpMethods.IsPost(http.Request.Method))
        {
            var origin = http.Request.Headers.Origin.ToString();
            if (origin.Length > 0 && (!Uri.TryCreate(origin, UriKind.Absolute, out var uri) || !string.Equals(uri.Authority, http.Request.Host.Value, StringComparison.OrdinalIgnoreCase)))
                throw new ApiException(403, "Cross-origin requests are not allowed");
            if (!http.Request.HasJsonContentType()) throw new ApiException(415, "Use application/json");
        }
        await next(http);
    }
    catch (Exception error) when (!http.Response.HasStarted)
    {
        var status = error switch
        {
            ApiException api => api.Status,
            BadHttpRequestException bad => bad.StatusCode,
            JsonException => 400,
            DbUpdateConcurrencyException => 409,
            DbUpdateException update when update.InnerException is SqliteException { SqliteErrorCode: 19 } => 409,
            SqliteException { SqliteErrorCode: 5 or 6 } => 409,
            _ => 500
        };
        var message = error switch
        {
            ApiException api => api.Message,
            JsonException => "Invalid JSON request",
            BadHttpRequestException => status == 413 ? "Request too large" : "Invalid request",
            DbUpdateConcurrencyException => "This record changed. Refresh before saving.",
            _ when status == 409 => "This change conflicts with an existing record. Refresh before saving.",
            _ => "Unable to save changes. Please try again."
        };
        if (status == 500) app.Logger.LogError(error, "Request failed: {Method} {Path}", http.Request.Method, http.Request.Path);
        var response = new JsonObject { ["error"] = message };
        if (error is ApiException { Extra: not null } exception && JsonSerializer.SerializeToNode(exception.Extra) is JsonObject extra)
            foreach (var key in new[] { "sealedBoxes", "witnessRequired", "witnessSummary" })
                if (extra[key] is { } value) response[key] = value.DeepClone();
        http.Response.StatusCode = status;
        await http.Response.WriteAsJsonAsync(response);
    }
    finally { requests.Release(); }
});
app.MapIdentityEndpoints();
app.MapInventoryEndpoints();
app.MapFallback(() => Results.NotFound(new { error = "Not found" }));
app.Run();
