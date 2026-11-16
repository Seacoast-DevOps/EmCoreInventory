using System.Buffers.Binary;
using System.IO.Compression;
using System.Text;
using QRCoder;

namespace EmCoreInventory.Api.Inventory;

internal static class QrImages
{
    internal static byte[] Create(string value)
    {
        using var generator = new QRCodeGenerator();
        using var data = generator.CreateQrCode(value, QRCodeGenerator.ECCLevel.M);
        const int size = 512;
        var modules = data.ModuleMatrix.Count;
        using var output = new MemoryStream();
        output.Write(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 });
        var header = new byte[13];
        BinaryPrimitives.WriteInt32BigEndian(header, size);
        BinaryPrimitives.WriteInt32BigEndian(header.AsSpan(4), size);
        header[8] = 8;
        WriteChunk(output, "IHDR", header);
        using var pixels = new MemoryStream();
        using (var compressed = new ZLibStream(pixels, CompressionLevel.SmallestSize, true))
        {
            var row = new byte[size + 1];
            for (var y = 0; y < size; y++)
            {
                for (var x = 0; x < size; x++) row[x + 1] = data.ModuleMatrix[y * modules / size][x * modules / size] ? (byte)0 : (byte)255;
                compressed.Write(row);
            }
        }
        WriteChunk(output, "IDAT", pixels.ToArray());
        WriteChunk(output, "IEND", []);
        return output.ToArray();
    }
    private static void WriteChunk(Stream output, string type, byte[] data)
    {
        Span<byte> number = stackalloc byte[4];
        BinaryPrimitives.WriteInt32BigEndian(number, data.Length);
        output.Write(number);
        var name = Encoding.ASCII.GetBytes(type);
        output.Write(name); output.Write(data);
        uint crc = 0xffffffff;
        foreach (var value in name.Concat(data))
        {
            crc ^= value;
            for (var bit = 0; bit < 8; bit++) crc = (crc >> 1) ^ ((crc & 1) != 0 ? 0xedb88320u : 0);
        }
        BinaryPrimitives.WriteUInt32BigEndian(number, ~crc);
        output.Write(number);
    }
}
