# 📖 Tome

A beautiful e-book reader for [Obsidian](https://obsidian.md). Read your EPUB library right inside your vault — with themes, custom typography and remembered reading positions. Works on desktop **and mobile**.

> Built by a humanities person who wanted her library to feel like a library.

## Features

- 📚 **EPUB reading** in a native Obsidian tab — open any `.epub` from your vault
- 🎨 **Themes:** Classic Light, Classic Dark, and **Gray Fog** (dark academia vibes with a crimson accent)
- ✍️ **Typography controls:** font family, size, line height
- 📑 **Table of contents** menu
- 🔖 **Reading position** is remembered per book
- 📱 **Mobile-friendly:** tap zones for page turns, tuned for tablets and phones
- 🧭 Chapter name + progress % in the header

## Roadmap

- [ ] FB2 support
- [ ] Highlights → auto-generated book note (Markdown, ready for Dataview)
- [ ] Flashcards from selections (Spaced Repetition format)
- [ ] Dictionary lookup for language learners
- [ ] Reading stats in frontmatter (progress on your book kanban)

## Install

**From source (for now):**

```bash
npm install
npm run build
```

Copy `manifest.json`, `main.js`, `styles.css` into `<vault>/.obsidian/plugins/tome-reader/` and enable **Tome** in *Settings → Community plugins*.

*(Community plugin catalog submission — coming after 0.2.)*

## Development

```bash
npm run dev            # watch mode
npm run install-vault  # build + copy into the vault set in install-vault.mjs
```

## License

MIT

---

### 🇷🇺 Коротко по-русски

Tome — красивая читалка EPUB для Obsidian: темы (включая «Серый Туман»), настройка шрифта и интервала, оглавление, запоминание позиции, удобные зоны перелистывания на планшете и телефоне. В планах: FB2, выделения → конспект, карточки для интервальных повторений и словарь для изучающих языки.
