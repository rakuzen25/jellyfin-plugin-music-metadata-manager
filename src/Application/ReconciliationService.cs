using System.Text.Json;

namespace MusicMetadataManager;
public sealed record PreparedCorrection(ManagedRecord Record, ManagedRecord? Prior, Dictionary<string, JsonElement> Changed);
/// <summary>Own the recoverable per-item transition; native entities stay at the host boundary.</summary>
public sealed class ReconciliationService(StateCoordinator state)
{
    public PreparedCorrection Prepare(View actual, View baseline, Plan plan, bool persist)
    {
        state.Journal.Records.TryGetValue(actual.Id, out var old);
        var record = old is null ? new ManagedRecord
        {
            Id = actual.Id
        }

        : Codec.Clone(old);
        record.Path = actual.Path;
        record.RuleIds = plan.RuleIds;
        record.Applied.Clear();
        var targets = new Dictionary<string, JsonElement>(plan.Values);
        if (persist && old is not null)
            foreach (var field in old.Applied.Keys.Except(plan.Values.Keys))
                targets[field] = FieldRestoration.Release(actual, old, field);
        foreach (var pair in plan.Values)
        {
            record.Original[pair.Key] = baseline.Values[pair.Key];
            record.Applied[pair.Key] = pair.Value;
        }

        if (!persist && old is not null)
            foreach (var pair in old.Applied)
                record.Applied.TryAdd(pair.Key, pair.Value);
        return new(record, old, targets.Where(x => !Engine.Equal(actual.Values[x.Key], x.Value)).ToDictionary());
    }

    public void Stage(PreparedCorrection correction)
    {
        var durable = Codec.Clone(correction.Record);
        if (correction.Prior is not null)
            foreach (var pair in correction.Prior.Applied)
                durable.Applied.TryAdd(pair.Key, pair.Value);
        state.Journal.Pending.TryAdd(durable.Id, false);
        if (durable.Applied.Count > 0)
            state.Journal.Records[durable.Id] = durable;
        state.Commit();
    }

    public void RecordSuccess(PreparedCorrection correction)
    {
        if (correction.Record.Applied.Count == 0 && correction.Prior is null)
            return;
        state.Journal.Records[correction.Record.Id] = correction.Record;
        state.Commit();
    }

    public void Acknowledge(Guid id)
    {
        if (state.Journal.Pending.Remove(id))
            state.Commit();
    }
}
