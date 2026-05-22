# Cosmo Kana Blaster

Cosmo Kana Blaster is a side-scrolling Japanese typing shooter.

The player ship stays on the left side of the screen, and UFO enemies approach from the right. Type the Japanese words shown under the enemies in romaji to fire and destroy them.

## Play

Open `index.html` in a browser.

If you publish this with GitHub Pages, Netlify, itch.io, or another static hosting service, upload the contents of the public folder.

## Controls

- `Space`: Start / Pause
- `Backspace`: Clear target
- `Esc`: Reset
- `Sound`: Toggle mute

## Features

- Japanese romaji typing
- Multiple romaji input styles
- Small-tsu input with doubled consonants, such as `mattya`
- Wave-based enemy progression
- Boss waves every 5 waves
- Boss phrases with furigana
- Score, combo, result screen, and local high score
- BGM and sound effects
- No server required

## Files

- `index.html`: Main page
- `style.css`: Layout and visual styles
- `game.js`: Game logic
- `config.js`: Balance settings
- `words.js`: Word and boss phrase lists
- `sound.js`: BGM and sound effects
- `assets/sprites/`: Player, enemy, and boss images
- `assets/music/`: BGM

## Editing Words

Most word changes can be made in `words.js`.

Normal enemy words use these ranks:

- `easy`
- `normal`
- `hard`
- `rare`

Boss phrases use:

- `boss`

The development folder also includes `scripts/validate-words.js` for checking the word list.

## Assets

Some images and BGM were generated or refined with AI tools and then adjusted for this game.

## Notes

High scores are saved in the player's browser using `localStorage`, so scores are stored per browser and are not shared online.
