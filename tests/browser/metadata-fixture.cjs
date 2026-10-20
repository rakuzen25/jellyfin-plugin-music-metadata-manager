const itemId = "11111111111111111111111111111111";
function metadataFixture() {
    const policy = {
        id: "22222222222222222222222222222222",
        label: "Fixture album",
        itemId,
        identityId: null,
        libraries: ["fixture-library"],
        fields: {},
        images: {},
        bindings: [],
        snapshots: [],
    };
    const stored = {
        title: "Fixture album",
        artists: ["Artist"],
        albumArtists: ["Album artist"],
        overview: "Original overview",
        genres: ["Music"],
        productionYear: 2024,
        sortName: null,
        tags: [],
        country: [],
        providerIds: { MusicBrainzAlbum: "33333333-3333-3333-3333-333333333333" },
        lockedFields: [],
        isLocked: false,
        premiereDate: null,
        endDate: null,
    };
    const dependencies = {
        id: itemId,
        name: "Fixture album",
        path: "/fixture-media/album",
        kind: "album",
        music: [{ id: itemId, name: "Fixture album", path: "/fixture-media/album", library: "fixture-library", roles: [] }],
        nonMusic: [],
        descendants: 0,
        linkedReferences: 0,
        userData: 0,
        bindings: [],
        policies: [],
        missingScope: [],
        classification: "referenced",
        canEdit: true,
        canDelete: false,
        metadataPaths: [],
    };
    const details = {
        id: itemId,
        name: "Fixture album",
        kind: "MusicAlbum",
        path: "/fixture-media/album",
        stored,
        effective: stored,
        policy,
        policies: [],
        drafts: [],
        dependencies,
        providerCandidates: [{ key: "MusicBrainzAlbum", recordId: "33333333-3333-3333-3333-333333333333", confirmed: false }],
        providers: [{ name: "Fixture provider", key: "MusicBrainzAlbum" }],
        locks: [],
        isLocked: false,
        original: null,
        correctionOriginal: null,
        images: [],
        history: [],
        refreshBehavior: "Only approved fields are reasserted.",
    };
    const inventory = {
        total: 1,
        start: 0,
        limit: 12,
        view: "grouped",
        items: [
            {
                id: itemId,
                name: details.name,
                kind: "album",
                path: details.path,
                library: "fixture-library",
                managed: false,
                identityId: null,
                aliases: [],
                records: [],
                missingBinding: false,
            },
        ],
    };
    const binding = {
        provider: "Fixture provider",
        key: "MusicBrainzAlbum",
        recordId: "33333333-3333-3333-3333-333333333333",
        confirmedAt: "2026-01-01T00:00:00Z",
    };
    const comparison = {
        itemId,
        snapshot: {
            id: "snapshot",
            binding,
            retrievedAt: "2026-01-01T00:00:00Z",
            configured: { overview: "Configured overview" },
            offered: { overview: "Offered overview", premiereDate: "2024", productionYear: 2024 },
            provenance: "known",
        },
        images: [],
        notes: ["Detached comparison; native metadata is unchanged."],
    };
    const overrides = {
        "manager/inventory": inventory,
        ["manager/items/" + itemId]: details,
        ["manager/items/" + itemId + "/tracks"]: {
            albumId: itemId,
            total: 1,
            items: [
                {
                    id: "44444444444444444444444444444444",
                    name: "Child track",
                    discNumber: 2,
                    trackNumber: 3,
                    artists: ["Artist"],
                    path: "/fixture-media/album/track.flac",
                    managed: false,
                },
            ],
        },
        "manager/compare": comparison,
    };
    return { itemId, policy, details, comparison, overrides };
}
module.exports = { metadataFixture };
