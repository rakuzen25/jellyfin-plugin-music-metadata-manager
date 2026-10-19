namespace MusicMetadataManager;
public static class CleanupFiles
{
    public static string[] Enumerate(string root)
    {
        var files = new List<string>();
        void Visit(string path)
        {
            var attributes = File.GetAttributes(path);
            if ((attributes & FileAttributes.ReparsePoint) != 0)
                throw new InvalidOperationException("Internal metadata contains a symbolic link; cleanup is blocked.");
            if ((attributes & FileAttributes.Directory) != 0)
                foreach (var child in Directory.EnumerateFileSystemEntries(path))
                    Visit(child);
            else
                files.Add(path);
        }

        Visit(root);
        return files.ToArray();
    }
}
