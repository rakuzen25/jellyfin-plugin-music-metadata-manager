using System.Runtime.CompilerServices;
using System.Threading.Channels;

namespace MusicMetadataManager;
/// <summary>One reader owns admitted work; duplicate requests preserve the strongest refresh.</summary>
public sealed class RefreshQueue : IRefreshQueue
{
    private readonly Channel<Guid> queue = Channel.CreateUnbounded<Guid>(new() { SingleReader = true });
    private readonly Dictionary<Guid, bool> pending = [];
    private readonly object gate = new();
    private int inFlight;
    public void Enqueue(Guid id, bool refresh)
    {
        lock (gate)
        {
            if (pending.TryGetValue(id, out var prior))
                pending[id] = prior || refresh;
            else
            {
                pending[id] = refresh;
                queue.Writer.TryWrite(id);
            }
        }
    }

    public int Count()
    {
        lock (gate)
            return pending.Count + inFlight;
    }

    public async IAsyncEnumerable<RefreshWork> ReadAllAsync([EnumeratorCancellation] CancellationToken token)
    {
        await foreach (var id in queue.Reader.ReadAllAsync(token))
        {
            bool refresh;
            lock (gate)
            {
                if (!pending.Remove(id, out refresh))
                    continue;
                inFlight++;
            }

            yield return new(id, refresh);
        }
    }

    public void Complete()
    {
        lock (gate)
        {
            if (inFlight == 0)
                throw new InvalidOperationException("No refresh work is in flight.");
            inFlight--;
        }
    }
}
