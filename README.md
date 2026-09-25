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

`data/maximums.json` holds the most each stat can be, per board, and the meters on the cards are
drawn against it. Its names must match the fields in the data exactly - `Scan`, not `Scanning`.
`Total` is the most the sum can be, and the total is shown as a percentage of it. It is set on its
own because it is not the sum of the stat maximums.

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


