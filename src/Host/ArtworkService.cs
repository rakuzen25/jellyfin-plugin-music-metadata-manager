using System.Text.Json;
using System.Security.Cryptography;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Audio;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Providers;
using MediaBrowser.Model.Entities;
using MediaBrowser.Model.Providers;

namespace MusicMetadataManager;
public sealed class ArtworkService(IHttpClientFactory http, MediaBrowser.Controller.Drawing.IImageProcessor imageProcessor, PinnedImages pins)
{
    readonly SemaphoreSlim gate = new(1, 1);
    public string ImagePath(string hash) => pins.PathFor(hash);
    public bool HasImage(string hash)
    {
        var path = ImagePath(hash);
        if (!File.Exists(path) || Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path))) != hash.ToUpperInvariant())
            return false;
        try
        {
            ValidateImage(path);
            return true;
        }
        catch (ArgumentException)
        {
            return false;
        }
    }

    void ValidateImage(string path)
    {
        try
        {
            var size = imageProcessor.GetImageDimensions(path);
            if (size.Width <= 0 || size.Height <= 0)
                throw new ArgumentException("Invalid image dimensions");
        }
        catch (Exception e)
        {
            throw new ArgumentException("Artwork could not be decoded; select a valid JPEG, PNG or WebP image", e);
        }
    }

    public async Task<ImageDecision> Upload(Stream stream, CancellationToken token)
    {
        using var bytes = new MemoryStream();
        byte[] buffer = new byte[65536];
        int count;
        while ((count = await stream.ReadAsync(buffer, token)) > 0)
        {
            if (bytes.Length + count > 25 * 1024 * 1024)
                throw new ArgumentException("Artwork exceeds 25 MiB");
            bytes.Write(buffer, 0, count);
        }

        var data = bytes.ToArray();
        var mime = data.Length >= 8 && data[0] == 137 && data[1] == 80 && data[2] == 78 && data[3] == 71 ? "image/png" : data.Length >= 12 && System.Text.Encoding.ASCII.GetString(data, 0, 4) == "RIFF" && System.Text.Encoding.ASCII.GetString(data, 8, 4) == "WEBP" ? "image/webp" : data.Length >= 3 && data[0] == 255 && data[1] == 216 && data[2] == 255 ? "image/jpeg" : null;
        if (mime is null)
            throw new ArgumentException("Select a JPEG, PNG or WebP image");
        var hash = Convert.ToHexString(SHA256.HashData(data));
        Directory.CreateDirectory(Path.GetDirectoryName(ImagePath(hash))!);
        token.ThrowIfCancellationRequested();
        pins.Put(hash, data);
        ValidateImage(ImagePath(hash));
        return new()
        {
            Hash = hash,
            Mime = mime
        };
    }

    public ImageDecision CacheCurrent(BaseItem item, string type)
    {
        var images = item.GetImages(Enum.Parse<ImageType>(type)).ToArray();
        if (images.Length == 0)
            return new()
            {
                Mode = "empty"
            };
        var path = images[0].Path;
        if (!File.Exists(path))
            throw new ArgumentException("Current image is not cached locally; select and cache a provider image first");
        var bytes = File.ReadAllBytes(path);
        var hash = Convert.ToHexString(SHA256.HashData(bytes));
        Directory.CreateDirectory(Path.GetDirectoryName(ImagePath(hash))!);
        pins.Put(hash, bytes);
        ValidateImage(ImagePath(hash));
        var mime = bytes.Length >= 8 && bytes[0] == 137 && bytes[1] == 80 ? "image/png" : bytes.Length >= 12 && System.Text.Encoding.ASCII.GetString(bytes, 0, 4) == "RIFF" ? "image/webp" : "image/jpeg";
        return new()
        {
            Hash = hash,
            Mime = mime
        };
    }

    public async Task<ImageDecision> Cache(ImageCacheRequest request, Comparison c, CancellationToken token)
    {
        await gate.WaitAsync(token);
        try
        {
            var client = http.CreateClient();
            using var response = await client.GetAsync(request.Url, HttpCompletionOption.ResponseHeadersRead, token);
            response.EnsureSuccessStatusCode();
            var mime = response.Content.Headers.ContentType?.MediaType;
            if (mime is not ("image/jpeg" or "image/png" or "image/webp"))
                throw new ArgumentException("Unsupported artwork content type");
            if (response.Content.Headers.ContentLength > 25 * 1024 * 1024)
                throw new ArgumentException("Artwork exceeds 25 MiB");
            await using var stream = await response.Content.ReadAsStreamAsync(token);
            using var bytes = new MemoryStream();
            byte[] buffer = new byte[65536];
            int read;
            while ((read = await stream.ReadAsync(buffer, token)) > 0)
            {
                if (bytes.Length + read > 25 * 1024 * 1024)
                    throw new ArgumentException("Artwork exceeds 25 MiB");
                bytes.Write(buffer, 0, read);
            }

            var data = bytes.ToArray();
            var hash = Convert.ToHexString(SHA256.HashData(data));
            Directory.CreateDirectory(Path.GetDirectoryName(ImagePath(hash))!);
            token.ThrowIfCancellationRequested();
            pins.Put(hash, data);
            ValidateImage(ImagePath(hash));
            return new()
            {
                Hash = hash,
                Mime = mime,
                SnapshotId = c.Snapshot.Id,
                SourceUrl = request.Url
            };
        }
        finally
        {
            gate.Release();
        }
    }
}
