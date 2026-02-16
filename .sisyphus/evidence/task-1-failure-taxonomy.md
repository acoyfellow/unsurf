# Task 1: Scout Failure Taxonomy

**Date**: 2026-02-16T22:00:24.208Z
**Target**: https://unsurf-api.coey.dev

## Summary

| Metric | Value |
|--------|-------|
| Total sites tested | 50 |
| Successes | 44 (88.0%) |
| Failures | 6 (12.0%) |
| Avg endpoints per success | 5.8 |
| Gallery cache hits | 20 |
| Avg duration | 8.7s |

## Success Rate by Site Category

| Category | Total | Success | Rate |
|----------|-------|---------|------|
| entertainment | 6 | 6 | 100% |
| developer | 6 | 5 | 83% |
| content_hard | 5 | 4 | 80% |
| fun | 4 | 4 | 100% |
| developer_hard | 4 | 4 | 100% |
| reference | 3 | 1 | 33% |
| food | 3 | 3 | 100% |
| saas_hard | 3 | 2 | 67% |
| ecommerce_hard | 3 | 3 | 100% |
| weather | 2 | 1 | 50% |
| finance | 2 | 2 | 100% |
| games | 2 | 2 | 100% |
| news | 2 | 2 | 100% |
| time | 2 | 2 | 100% |
| science | 1 | 1 | 100% |
| location | 1 | 1 | 100% |
| language | 1 | 1 | 100% |

## Failure Categories

### timeout (5)
- https://api.sunrise-sunset.org — `Navigate to https://api.sunrise-sunset.org failed: TimeoutError: Navigation timeout of 30000 ms exceeded`
- https://universities.hipolabs.com — `Navigate to https://universities.hipolabs.com failed: TimeoutError: Navigation timeout of 30000 ms exceeded`
- https://world.openfoodfacts.org — `Navigate to https://world.openfoodfacts.org failed: TimeoutError: Navigation timeout of 30000 ms exceeded`
- https://stripe.com/docs/api — `Navigate to https://stripe.com/docs/api failed: TimeoutError: Navigation timeout of 30000 ms exceeded`
- https://www.weather.com — `Navigate to https://www.weather.com failed: TimeoutError: Navigation timeout of 30000 ms exceeded`

### other (1)
- https://randomuser.me — `Navigate to https://randomuser.me failed: Error: Navigating frame was detached`

## Successful Sites (44)

- https://www.espn.com — 63 endpoints (33.6s)
- https://hub.docker.com — 29 endpoints (16.1s)
- https://www.etsy.com — 17 endpoints (11.7s)
- https://api.github.com — 12 endpoints (4.1s) [gallery]
- https://pokeapi.co — 10 endpoints (4.2s) [gallery]
- https://icanhazdadjoke.com — 10 endpoints (4.0s) [gallery]
- https://api.coingecko.com — 8 endpoints (4.0s) [gallery]
- https://dummyjson.com — 8 endpoints (6.9s)
- https://hacker-news.firebaseio.com — 8 endpoints (3.8s) [gallery]
- https://www.zillow.com — 8 endpoints (9.6s)
- https://rickandmortyapi.com — 6 endpoints (4.3s) [gallery]
- https://www.producthunt.com — 6 endpoints (8.9s)
- https://api.tvmaze.com — 5 endpoints (7.1s)
- https://dog.ceo — 5 endpoints (3.7s) [gallery]
- https://www.npmjs.com — 5 endpoints (9.0s)
- https://api.open-meteo.com — 4 endpoints (5.6s) [gallery]
- https://swapi.dev — 4 endpoints (3.7s) [gallery]
- https://nominatim.openstreetmap.org — 4 endpoints (5.6s)
- https://date.nager.at — 4 endpoints (4.5s)
- https://www.craigslist.org — 4 endpoints (7.6s)
- https://crates.io — 4 endpoints (6.7s)
- https://pypi.org — 4 endpoints (5.9s)
- https://openlibrary.org — 3 endpoints (9.2s)
- https://www.imdb.com — 3 endpoints (6.4s)
- https://api.npms.io — 2 endpoints (4.6s)
- https://httpbin.org — 2 endpoints (3.5s) [gallery]
- https://arxiv.org — 2 endpoints (4.7s)
- https://restcountries.com — 1 endpoints (4.2s) [gallery]
- https://api.frankfurter.app — 1 endpoints (3.3s) [gallery]
- https://collectionapi.metmuseum.org — 1 endpoints (4.8s)
- https://api.chess.com — 1 endpoints (4.3s)
- https://api.scryfall.com — 1 endpoints (4.4s)
- https://jsonplaceholder.typicode.com — 1 endpoints (2.6s) [gallery]
- https://catfact.ninja — 1 endpoints (2.6s) [gallery]
- https://api.chucknorris.io — 1 endpoints (3.4s) [gallery]
- https://www.themealdb.com — 1 endpoints (2.8s) [gallery]
- https://www.thecocktaildb.com — 1 endpoints (3.0s) [gallery]
- https://api.openbrewerydb.org — 1 endpoints (3.8s)
- https://api.nasa.gov — 1 endpoints (4.7s) [gallery]
- https://en.wikipedia.org/w/api.php — 1 endpoints (3.9s) [gallery]
- https://api.dictionaryapi.dev — 1 endpoints (3.1s) [gallery]
- https://worldtimeapi.org — 1 endpoints (8.9s)
- https://news.ycombinator.com — 1 endpoints (5.9s)
- https://www.goodreads.com — 1 endpoints (5.0s)

## Notes

- Timeout: 60s per scout
- Delay: 6s between requests
- Sites marked [gallery] were served from cache, not live-scouted
