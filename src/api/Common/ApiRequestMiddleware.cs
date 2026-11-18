using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace EmCoreInventory.Api.Common;

internal sealed class ApiRequestMiddleware(RequestDelegate next, ILogger<ApiRequestMiddleware> logger)
{
    public async Task InvokeAsync(HttpContext http)
    {
        http.Response.Headers.CacheControl = "no-store";
        http.Response.Headers.XContentTypeOptions = "nosniff";
        try
        {
            if (HttpMethods.IsPost(http.Request.Method))
            {
                var origin = http.Request.Headers.Origin;
                // Compare the browser-facing scheme when TLS terminates at the configured HTTPS proxy.
                var scheme = Environment.GetEnvironmentVariable("EMCORE_SECURE_COOKIE") == "1" ? "https" : http.Request.Scheme;
                if (origin.Count > 0 && (origin.Count != 1 || !Uri.TryCreate(origin[0], UriKind.Absolute, out var uri)
                    || uri.UserInfo.Length != 0 || uri.PathAndQuery != "/" || uri.Fragment.Length != 0
                    || !string.Equals(uri.GetLeftPart(UriPartial.Authority), $"{scheme}://{http.Request.Host}", StringComparison.OrdinalIgnoreCase)))
                    throw new ApiException(403, "Cross-origin requests are not allowed");
                if (!http.Request.HasJsonContentType()) throw new ApiException(415, "Use application/json");
            }
            await next(http);
        }
        catch (Exception error) when (!http.Response.HasStarted && !http.RequestAborted.IsCancellationRequested)
        {
            var postgres = error.GetBaseException() as PostgresException;
            var (status, message) = error switch
            {
                ApiException api => (api.Status, api.Message),
                BadHttpRequestException bad => (bad.StatusCode, bad.StatusCode == 413 ? "Request too large" : "Invalid request"),
                JsonException => (400, "Invalid JSON request"),
                DbUpdateConcurrencyException => (409, "This record changed. Refresh before saving."),
                _ when postgres?.SqlState is PostgresErrorCodes.UniqueViolation or PostgresErrorCodes.ForeignKeyViolation
                    or PostgresErrorCodes.SerializationFailure or PostgresErrorCodes.DeadlockDetected
                    or PostgresErrorCodes.LockNotAvailable => (409, "This change conflicts with another operation. Refresh before saving."),
                _ when postgres?.SqlState is PostgresErrorCodes.CharacterNotInRepertoire => (400, "Request text contains an unsupported character."),
                _ when postgres?.SqlState is PostgresErrorCodes.CheckViolation => (400, "A value is outside the allowed range."),
                _ => (500, "Unable to process the request.")
            };
            if (status == 500) logger.LogError(error, "Request failed: {Method} {Path}", http.Request.Method, http.Request.Path);
            var response = new JsonObject { ["error"] = message };
            if (error is ApiException { Extra: not null } exception && JsonSerializer.SerializeToNode(exception.Extra) is JsonObject extra)
                foreach (var key in new[] { "sealedBoxes", "witnessRequired", "witnessSummary" })
                    if (extra[key] is { } value) response[key] = value.DeepClone();
            http.Response.StatusCode = status;
            await http.Response.WriteAsJsonAsync(response, http.RequestAborted);
        }
    }
}
