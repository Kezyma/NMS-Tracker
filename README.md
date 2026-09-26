# NMS Tracker

The best discoveries in No Man's Sky, and where to find them. Starships, freighters and
multi-tools found with their four supercharged slots in a 2×2 square, and companions with an
S-class rating in all three traits - ranked by the sum of their stats, with the portal address
that leads to each.

## Adding an entry

Add an object to the list in the right file under `data/`. Every field is shown and searchable;
these ones have a job:

| Field | |
|---|---|
| the stats | Numbers. Summed into the total, which is the ranking. |
| `Galaxy` | The galaxy's number, 1 for Euclid. The name comes from `data/galaxies.json`. |
| `Address` | The 12-digit portal address in hex. Drawn as glyphs, with the hex beneath. |
| `ImageUrl` | A file name in `img/`. Case matters on the live site. |
| `Source` | A link to where it was posted. |
| `Discoverer` | Who found it. |

`data/ranges.json` holds what the stats can be, per board. Its names must match the fields in the
data exactly - `Scan`, not `Scanning`.

- The board's own figures are the most each stat can be across every type. `Total` is the most
  the sum can be - set on its own because it is not the sum of the stat maximums. Each bar on a
  card runs from 0 to its stat's figure, so bars compare across types.
- `Types` gives each type's S-class `[floor, limit]` per stat, keyed by the `Type` field. With it:
  - The overall score runs from the lowest total any type can roll (0%) to `Total` (100%).
    Without types it runs from 0.
  - An entry is also ranked among its own type and given a type score, which runs from the worst
    S-class roll of that type (0%) to a perfect one (100%).
  - Each bar carries two ticks marking the floor and the limit of the entry's type.

The starship ranges come from the game's own `METADATA/REALITY/TABLES/INVENTORYTABLE.MBIN`
(`ShipBaseStatsData`, class S), where Exotic is `Royal`, Explorer `Scientific`, Hauler `Dropship`,
Living Ship `Alien`, Solar `Sail` and Sentinel `Robot`. They agree with the
[wiki](https://nomanssky.miraheze.org/wiki/Starship).

Which fields are stats, which get a pick-list, and which are seeds is set in each page's own
config, at the bottom of its HTML file. Any field not named there still appears, as a column in
the list and a tag on the card.

## Running it locally

```bash
python -m http.server
```

Then open http://localhost:8000. Opening the files directly will not work: browsers do not let a
page read files off the disk.

## Deploying

Pushing to `main` deploys through GitHub Actions, once the repository's Settings → Pages →
Source is set to **GitHub Actions**. The deploy stops if a data file does not parse, if an image
named in the data is not in `img/`, or if any path starts with `/` - which works locally and
breaks under `/NMS-Tracker/`.


