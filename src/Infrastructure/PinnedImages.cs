using System.Security.Cryptography;

namespace MusicMetadataManager;
/// <summary>Immutable, content-addressed artwork. Partial writes are never published.</summary>
public sealed class PinnedImages(IPluginStorage storage)
{
    public string PathFor(string hash)
    {
        if (hash.Length != 64 || !hash.All(Uri.IsHexDigit))
            throw new ArgumentException("Artwork requires a SHA256 hash.");
        return Path.Combine(storage.DirectoryPath, "pins", hash.ToUpperInvariant());
    }

    public void Put(string hash, byte[] bytes)
    {
        var path = PathFor(hash);
        if (Convert.ToHexString(SHA256.HashData(bytes)) != hash.ToUpperInvariant())
            throw new ArgumentException("Artwork hash mismatch.");
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                stream.Write(bytes);
                stream.Flush(true);
            }

            File.Move(temporary, path, true);
        }
        finally
        {
            if (File.Exists(temporary))
                File.Delete(temporary);
        }
    }
}
