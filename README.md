# Where in the Brain?

A GeoGuessr-style quiz for mouse brain anatomy. You see a coronal slice and a region
name, click where you think it is, and score points by how close you were.

## Run it

You need **Node.js** (current LTS from https://nodejs.org) and **Python 3.12+**.

```bash
# 1. (Only if you want to rebuild the data; it is already in web/public/data/)
cd pipeline
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python build_atlas.py
pytest
cd ..

# 2. Run the game
cd web
npm install      # first time only
npm test         # unit tests for scoring and pixel → region lookup
npm run dev      # then open the printed URL, usually http://localhost:5173
```

## Data

Allen Mouse Brain Common Coordinate Framework v3 (CCFv3), © Allen Institute.
Wang Q. et al. (2020) *Cell* 181(4):936–953, doi:10.1016/j.cell.2020.04.007.
Used under the [Allen Institute Terms of Use](https://alleninstitute.org/terms-of-use/).
This project is not affiliated with or endorsed by the Allen Institute.

See `CLAUDE.md` for design decisions, data format and how the data is built.
