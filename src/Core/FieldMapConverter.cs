using System.Text.Json;
using System.Text.Json.Serialization;

namespace MusicMetadataManager;
public sealed class FieldMapConverter : JsonConverter<Fields>
{
    public override Fields Read(ref Utf8JsonReader reader, Type type, JsonSerializerOptions options)
    {
        using var document = JsonDocument.ParseValue(ref reader);
        if (document.RootElement.ValueKind != JsonValueKind.Object)
            throw new JsonException("Fields require a decision map.");
        var properties = document.RootElement.EnumerateObject().ToArray();
        if (properties.Length > 1 || properties.Any(x => x.Name != "decisions"))
            throw new JsonException("Fields use only the canonical decisions map.");
        return properties.Length == 0 ? new() : new()
        {
            Decisions = properties[0].Value.Deserialize<Dictionary<string, FieldDecision>>(options) ?? throw new JsonException("Field decisions must not be null.")
        };
    }

    public override void Write(Utf8JsonWriter writer, Fields fields, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        writer.WritePropertyName("decisions");
        JsonSerializer.Serialize(writer, fields.Decisions, options);
        writer.WriteEndObject();
    }
}
