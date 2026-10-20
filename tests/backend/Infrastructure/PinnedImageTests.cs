using System.Security.Cryptography;
using MusicMetadataManager;
using Xunit;

namespace MusicMetadataManager.Tests;
public sealed class PinnedImageTests
{
    [Fact]
    public void HashMismatchCannotReplaceAnExistingPin()
    {
        var directory = Path.Combine(Path.GetTempPath(), "pin-test-" + Guid.NewGuid());
        try
        {
            var pins = new PinnedImages(new PluginStorage(directory));
            byte[] original = [1, 2, 3];
            var hash = Convert.ToHexString(SHA256.HashData(original));
            pins.Put(hash, original);
            Assert.Throws<ArgumentException>(() => pins.Put(hash, [4, 5, 6]));
            Assert.Equal(original, File.ReadAllBytes(pins.PathFor(hash)));
            Assert.Empty(Directory.GetFiles(Path.Combine(directory, "pins"), "*.tmp"));
        }
        finally
        {
            Directory.Delete(directory, true);
        }
    }

    [Fact]
    public void FailedPublicationKeepsThePreviousFilesystemEntryAndRemovesTemporaryBytes()
    {
        var directory = Path.Combine(Path.GetTempPath(), "pin-test-" + Guid.NewGuid());
        try
        {
            var pins = new PinnedImages(new PluginStorage(directory));
            byte[] bytes = [1, 2, 3];
            var hash = Convert.ToHexString(SHA256.HashData(bytes));
            Directory.CreateDirectory(pins.PathFor(hash));
            Assert.ThrowsAny<IOException>(() => pins.Put(hash, bytes));
            Assert.True(Directory.Exists(pins.PathFor(hash)));
            Assert.Empty(Directory.GetFiles(Path.Combine(directory, "pins"), "*.tmp"));
        }
        finally
        {
            Directory.Delete(directory, true);
        }
    }
}
