# Brain Darts

A neuroanatomy game for mouse and human brain slices. We name a brain region, you
throw the dart (click where you think it is), and you score points by how close you land.
Three difficulty levels from major divisions down to small nuclei, a review mode
that brings back the regions you miss (spaced repetition), and a study mode to
browse every slice and look up any region.

## Run it

You need **Node.js** (current LTS from https://nodejs.org) and **Python 3.12+**.

```bash
# 1. (Only if you want to rebuild the data; it is already in web/public/data/)
cd pipeline
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python build_atlas.py     # mouse: first run downloads ~410 MB of Allen data
python build_human.py     # human: first run downloads ~104 MB of Allen data
pytest
cd ..

# 2. Run the game
cd web
npm install      # first time only
npm test         # unit tests for scoring and pixel → region lookup
npm run dev      # then open the printed URL, usually http://localhost:5173
```

## Data

Mouse: Allen Mouse Brain Common Coordinate Framework v3 (CCFv3), © Allen Institute.
Wang Q. et al. (2020) *Cell* 181(4):936–953, doi:10.1016/j.cell.2020.04.007.

Human: Allen Human Reference Atlas, © Allen Institute. Ding S.-L. et al. (2016)
*J. Comp. Neurol.* 524(16):3127–3481, doi:10.1002/cne.24080.

Used under the [Allen Institute Terms of Use](https://alleninstitute.org/terms-of-use/).
This project is not affiliated with or endorsed by the Allen Institute.

See `CLAUDE.md` for design decisions, data format and how the data is built.
