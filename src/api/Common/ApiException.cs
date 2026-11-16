namespace EmCoreInventory.Api.Common;

public sealed class ApiException(int status, string message, object? extra = null) : Exception(message)
{
    public int Status { get; } = status;
    public object? Extra { get; } = extra;
}
