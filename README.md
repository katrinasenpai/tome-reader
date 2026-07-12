# 📖 Tome

A beautiful e-book reader for [Obsidian](https://obsidian.md). Read your EPUB library right inside your vault — and turn reading into notes: capture quotes with your thoughts and grow a vocabulary with flashcard-ready entries. Works on desktop **and mobile**.

> Built by a humanities person who wanted her library to feel like a library.

## Features

### Reading
- 📚 **EPUB reading** in a native Obsidian tab — open any `.epub` from your vault
- 🎨 **Four themes:** Classic Light, Classic Dark, **Parchment** (aged paper with warm brown ink) and **Gray Fog** (dark academia with a crimson accent)
- 🔤 **Aa panel right in the reader:** switch theme, adjust font size, line spacing and even text color on the fly — without leaving the page
- ✍️ **Typography controls:** custom font family, size, spacing
- 📑 **Table of contents** menu, chapter name and progress % in the header
- 🔖 **Reading position** remembered per book
- 📱 **Mobile-friendly:** tap zones for page turns, tuned for tablets and phones

### Capture while you read
- 📝 **Selection → book note:** select a passage, add your own thought inline, and Tome saves the quote (with chapter reference) into a per-book note — created automatically
- 🈶 **Selection → dictionary:** select a word, type its translation right there, and it lands in your dictionary file as a spaced-repetition-ready line (`word:::translation`) — pairs perfectly with the [Spaced Repetition](https://github.com/st3v3nmw/obsidian-spaced-repetition) plugin
- ⌨️ Enter to save, Esc to go back — your reading flow stays unbroken

### Interface
- 🌐 **English and Russian** UI (English by default — switch in settings)

## Roadmap

- [ ] FB2 support
- [ ] Swipe page turns and page-flip animation
- [ ] Reading progress in note frontmatter (for Dataview book boards)
- [ ] Dictionary lookup for language learners
- [ ] Community plugin catalog submission

## Install

**Via [BRAT](https://github.com/TfTHacker/obsidian42-brat)** (recommended for now):
1. Install and enable the BRAT plugin
2. BRAT settings → *Add Beta Plugin* → `katrinasenpai/tome-reader`
3. Enable **Tome** in *Settings → Community plugins*

**From source:**

```bash
npm install
npm run build
```

Copy `manifest.json`, `main.js`, `styles.css` into `<vault>/.obsidian/plugins/tome-reader/` and enable **Tome**.

## Development

```bash
npm run dev            # watch mode
npm run install-vault  # build + copy into the vault set in install-vault.mjs
```

## License

MIT
