using System.Text.Json;
using System.Text.Json.Serialization;
using EmCoreInventory.Api.Auth;
using EmCoreInventory.Api.Common;
using EmCoreInventory.Api.Data;
using EmCoreInventory.Api.Inventory;

var builder = WebApplication.CreateBuilder(args);
if (builder.Configuration["urls"] is null)
    builder.WebHost.UseUrls("http://127.0.0.1:" + (Environment.GetEnvironmentVariable("PORT") ?? "3001"));
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 65536);
builder.Services.AddSingleton<DatabaseStore>();
builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.RespectRequiredConstructorParameters = true;
    options.SerializerOptions.RespectNullableAnnotations = true;
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase, allowIntegerValues: false));
});
builder.Services.Configure<RouteHandlerOptions>(options => options.ThrowOnBadRequest = true);
var app = builder.Build();
using (var db = app.Services.GetRequiredService<DatabaseStore>().OpenIdentity()) { }

app.UseMiddleware<ApiRequestMiddleware>();
app.MapIdentityEndpoints();
app.MapInventoryEndpoints();
app.MapFallback(() => Results.NotFound(new { error = "Not found" }));
app.Run();
