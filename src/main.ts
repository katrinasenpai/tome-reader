import {
	App,
	FileView,
	Menu,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	TFolder,
	WorkspaceLeaf,
	debounce,
	normalizePath,
} from "obsidian";
import ePub, { Book, Rendition } from "epubjs";

const VIEW_TYPE_EPUB = "tome-epub-view";

type TomeTheme = "classic-light" | "classic-dark" | "parchment" | "gray-fog";

interface TomeSettings {
	theme: TomeTheme;
	fontSize: number;
	fontFamily: string;
	lineHeight: number;
	customTextColor: string; // "" = цвет темы
	noteFolder: string;
	dictFile: string;
	locations: Record<string, string>;
}

const DEFAULT_SETTINGS: TomeSettings = {
	theme: "classic-light",
	fontSize: 18,
	fontFamily: "",
	lineHeight: 1.6,
	customTextColor: "",
	noteFolder: "📚 Книги/📓 Конспекты",
	dictFile: "🈶 Лингва/🇬🇧 Английский.md",
	locations: {},
};

interface ThemeSpec {
	label: string;
	background: string;
	color: string;
	accent: string;
}

const THEMES: Record<TomeTheme, ThemeSpec> = {
	"classic-light": { label: "Светлая", background: "#faf6ee", color: "#2e2a24", accent: "#8a6d3b" },
	"classic-dark": { label: "Тёмная", background: "#1e1f22", color: "#cfd2d6", accent: "#b08d57" },
	parchment: { label: "Пергамент", background: "#f0e0bd", color: "#4a3423", accent: "#8b5a2b" },
	"gray-fog": { label: "Серый Туман", background: "#14151a", color: "#b9bcc7", accent: "#c0392b" },
};

export default class TomePlugin extends Plugin {
	settings: TomeSettings = DEFAULT_SETTINGS;

	async onload() {
		await this.loadSettings();

		this.registerView(VIEW_TYPE_EPUB, (leaf) => new TomeView(leaf, this));

		try {
			this.registerExtensions(["epub"], VIEW_TYPE_EPUB);
		} catch (e) {
			new Notice(
				"Tome: расширение .epub уже занято другим плагином. Отключи другой EPUB-плагин и перезапусти Obsidian."
			);
		}

		this.addSettingTab(new TomeSettingTab(this.app, this));
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		if (!this.settings.locations) this.settings.locations = {};
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	saveLocation = debounce(
		(path: string, cfi: string) => {
			this.settings.locations[path] = cfi;
			void this.saveSettings();
		},
		1000,
		true
	);

	applySettingsToOpenViews() {
		this.app.workspace.getLeavesOfType(VIEW_TYPE_EPUB).forEach((leaf) => {
			const view = leaf.view;
			if (view instanceof TomeView) void view.applyAppearance(true);
		});
	}
}

class TomeView extends FileView {
	plugin: TomePlugin;
	book: Book | null = null;
	rendition: Rendition | null = null;
	progressEl: HTMLElement | null = null;
	chapterEl: HTMLElement | null = null;
	aaPanel: HTMLElement | null = null;
	selectionBar: HTMLElement | null = null;
	selectionTextEl: HTMLElement | null = null;
	pendingSelection = "";
	currentChapter = "";
	locationsReady = false;

	constructor(leaf: WorkspaceLeaf, plugin: TomePlugin) {
		super(leaf);
		this.plugin = plugin;
		this.allowNoFile = false;
		this.navigation = true;
	}

	getViewType(): string {
		return VIEW_TYPE_EPUB;
	}

	getIcon(): string {
		return "book-open";
	}

	getDisplayText(): string {
		return this.file ? this.file.basename : "Tome";
	}

	async onLoadFile(file: TFile): Promise<void> {
		await this.closeBook();
		const container = this.contentEl;
		container.empty();
		container.addClass("tome-view");

		// ── шапка ──
		const header = container.createDiv({ cls: "tome-header" });
		const tocBtn = header.createEl("button", { cls: "tome-btn", text: "☰" });
		tocBtn.setAttr("aria-label", "Оглавление");
		header.createDiv({ cls: "tome-title", text: file.basename });
		this.chapterEl = header.createDiv({ cls: "tome-chapter", text: "" });
		this.progressEl = header.createDiv({ cls: "tome-progress", text: "…" });
		const aaBtn = header.createEl("button", { cls: "tome-btn tome-aa-btn", text: "Aa" });
		aaBtn.setAttr("aria-label", "Оформление");

		// ── область чтения ──
		const readerWrap = container.createDiv({ cls: "tome-reader-wrap" });
		const readerEl = readerWrap.createDiv({ cls: "tome-reader" });
		const navPrev = readerWrap.createDiv({ cls: "tome-nav tome-nav-prev" });
		navPrev.createSpan({ text: "‹" });
		const navNext = readerWrap.createDiv({ cls: "tome-nav tome-nav-next" });
		navNext.createSpan({ text: "›" });

		// ── панель Aa (создаётся скрытой) ──
		this.buildAaPanel(readerWrap);

		// ── панель выделения (создаётся скрытой) ──
		this.buildSelectionBar(readerWrap);

		// ── книга ──
		let data: ArrayBuffer;
		try {
			data = await this.app.vault.readBinary(file);
		} catch (e) {
			readerEl.setText("Не удалось прочитать файл: " + String(e));
			return;
		}

		try {
			this.book = ePub(data);
			this.rendition = this.book.renderTo(readerEl, {
				width: "100%",
				height: "100%",
				flow: "paginated",
				spread: "none",
				allowScriptedContent: false,
			});
		} catch (e) {
			readerEl.setText("Tome не смог открыть эту книгу: " + String(e));
			return;
		}

		await this.applyAppearance(false);

		const savedCfi = this.plugin.settings.locations[file.path];
		try {
			await this.rendition.display(savedCfi || undefined);
		} catch (e) {
			await this.rendition.display();
		}

		// ── события ──
		this.rendition.on("relocated", (location: any) => {
			const cfi: string | undefined = location?.start?.cfi;
			if (cfi && this.file) this.plugin.saveLocation(this.file.path, cfi);
			this.updateProgress(location);
		});

		this.rendition.on("selected", (_cfiRange: string, contents: any) => {
			try {
				const sel = contents?.window?.getSelection?.();
				const text = sel ? String(sel.toString()).trim() : "";
				if (text) this.showSelection(text);
			} catch (e) {
				/* noop */
			}
		});

		const keyHandler = (e: KeyboardEvent) => {
			if (e.key === "ArrowLeft") void this.rendition?.prev();
			if (e.key === "ArrowRight" || e.key === " ") void this.rendition?.next();
		};
		this.rendition.on("keydown", keyHandler);
		this.registerDomEvent(container, "keydown", keyHandler);

		navPrev.onclick = () => void this.rendition?.prev();
		navNext.onclick = () => void this.rendition?.next();
		tocBtn.onclick = (ev) => this.showToc(ev);
		aaBtn.onclick = () => this.toggleAaPanel();

		void this.book.ready
			.then(() => this.book!.locations.generate(1024))
			.then(() => {
				this.locationsReady = true;
				const loc = (this.rendition as any)?.currentLocation?.();
				if (loc) this.updateProgress(loc);
			})
			.catch(() => {});
	}

	// ─────────────────── панель Aa ───────────────────

	buildAaPanel(parent: HTMLElement) {
		const panel = parent.createDiv({ cls: "tome-aa-panel" });
		panel.hide();
		this.aaPanel = panel;

		// темы
		const themesRow = panel.createDiv({ cls: "tome-aa-row" });
		(Object.keys(THEMES) as TomeTheme[]).forEach((key) => {
			const t = THEMES[key];
			const chip = themesRow.createEl("button", { cls: "tome-theme-chip", text: t.label });
			chip.style.setProperty("--chip-bg", t.background);
			chip.style.setProperty("--chip-fg", t.color);
			chip.onclick = async () => {
				this.plugin.settings.theme = key;
				this.plugin.settings.customTextColor = "";
				await this.plugin.saveSettings();
				this.plugin.applySettingsToOpenViews();
				this.refreshAaPanel();
			};
		});

		// размер шрифта
		const sizeRow = panel.createDiv({ cls: "tome-aa-row" });
		sizeRow.createSpan({ cls: "tome-aa-label", text: "Размер" });
		const sizeMinus = sizeRow.createEl("button", { cls: "tome-btn", text: "−" });
		const sizeVal = sizeRow.createSpan({ cls: "tome-aa-value", text: String(this.plugin.settings.fontSize) });
		const sizePlus = sizeRow.createEl("button", { cls: "tome-btn", text: "+" });
		sizeMinus.onclick = async () => {
			this.plugin.settings.fontSize = Math.max(12, this.plugin.settings.fontSize - 1);
			sizeVal.setText(String(this.plugin.settings.fontSize));
			await this.plugin.saveSettings();
			this.plugin.applySettingsToOpenViews();
		};
		sizePlus.onclick = async () => {
			this.plugin.settings.fontSize = Math.min(36, this.plugin.settings.fontSize + 1);
			sizeVal.setText(String(this.plugin.settings.fontSize));
			await this.plugin.saveSettings();
			this.plugin.applySettingsToOpenViews();
		};

		// межстрочный интервал
		const lhRow = panel.createDiv({ cls: "tome-aa-row" });
		lhRow.createSpan({ cls: "tome-aa-label", text: "Интервал" });
		const lhMinus = lhRow.createEl("button", { cls: "tome-btn", text: "−" });
		const lhVal = lhRow.createSpan({ cls: "tome-aa-value", text: this.plugin.settings.lineHeight.toFixed(1) });
		const lhPlus = lhRow.createEl("button", { cls: "tome-btn", text: "+" });
		lhMinus.onclick = async () => {
			this.plugin.settings.lineHeight = Math.max(1.1, Math.round((this.plugin.settings.lineHeight - 0.1) * 10) / 10);
			lhVal.setText(this.plugin.settings.lineHeight.toFixed(1));
			await this.plugin.saveSettings();
			this.plugin.applySettingsToOpenViews();
		};
		lhPlus.onclick = async () => {
			this.plugin.settings.lineHeight = Math.min(2.4, Math.round((this.plugin.settings.lineHeight + 0.1) * 10) / 10);
			lhVal.setText(this.plugin.settings.lineHeight.toFixed(1));
			await this.plugin.saveSettings();
			this.plugin.applySettingsToOpenViews();
		};

		// цвет текста
		const colorRow = panel.createDiv({ cls: "tome-aa-row" });
		colorRow.createSpan({ cls: "tome-aa-label", text: "Цвет текста" });
		const colorInput = colorRow.createEl("input", { cls: "tome-color-input" });
		colorInput.type = "color";
		colorInput.value = this.plugin.settings.customTextColor || THEMES[this.plugin.settings.theme].color;
		colorInput.oninput = async () => {
			this.plugin.settings.customTextColor = colorInput.value;
			await this.plugin.saveSettings();
			this.plugin.applySettingsToOpenViews();
		};
		const colorReset = colorRow.createEl("button", { cls: "tome-btn", text: "Сброс" });
		colorReset.onclick = async () => {
			this.plugin.settings.customTextColor = "";
			colorInput.value = THEMES[this.plugin.settings.theme].color;
			await this.plugin.saveSettings();
			this.plugin.applySettingsToOpenViews();
		};
	}

	refreshAaPanel() {
		if (!this.aaPanel) return;
		const input = this.aaPanel.querySelector(".tome-color-input") as HTMLInputElement | null;
		if (input)
			input.value = this.plugin.settings.customTextColor || THEMES[this.plugin.settings.theme].color;
	}

	toggleAaPanel() {
		if (!this.aaPanel) return;
		if (this.aaPanel.isShown()) this.aaPanel.hide();
		else {
			this.refreshAaPanel();
			this.aaPanel.show();
		}
	}

	// ─────────────────── выделение → заметки/словарь ───────────────────

	buildSelectionBar(parent: HTMLElement) {
		const bar = parent.createDiv({ cls: "tome-selection-bar" });
		bar.hide();
		this.selectionBar = bar;
		this.selectionTextEl = bar.createDiv({ cls: "tome-selection-text" });
		const actions = bar.createDiv({ cls: "tome-selection-actions" });
		const noteBtn = actions.createEl("button", { cls: "tome-btn", text: "📝 В конспект" });
		const dictBtn = actions.createEl("button", { cls: "tome-btn", text: "🈶 В словарь" });
		const closeBtn = actions.createEl("button", { cls: "tome-btn", text: "✕" });
		noteBtn.onclick = () => void this.addSelectionToNote();
		dictBtn.onclick = () => void this.addSelectionToDict();
		closeBtn.onclick = () => this.hideSelection();
	}

	showSelection(text: string) {
		this.pendingSelection = text;
		if (this.selectionTextEl) {
			const short = text.length > 120 ? text.slice(0, 120) + "…" : text;
			this.selectionTextEl.setText("«" + short + "»");
		}
		this.selectionBar?.show();
	}

	hideSelection() {
		this.pendingSelection = "";
		this.selectionBar?.hide();
	}

	async ensureFolder(path: string) {
		const parts = normalizePath(path).split("/");
		let cur = "";
		for (const p of parts) {
			cur = cur ? cur + "/" + p : p;
			if (!this.app.vault.getAbstractFileByPath(cur)) {
				try {
					await this.app.vault.createFolder(cur);
				} catch (e) {
					/* уже есть */
				}
			}
		}
	}

	async appendToFile(file: TFile, block: string, marker?: string) {
		let content = await this.app.vault.read(file);
		if (marker && content.includes(marker)) {
			const at = content.indexOf(marker) + marker.length;
			content = content.slice(0, at) + "\n\n" + block + content.slice(at);
		} else {
			content = content.trimEnd() + "\n\n" + block + "\n";
		}
		await this.app.vault.modify(file, content);
	}

	async addSelectionToNote() {
		if (!this.pendingSelection || !this.file) return;
		const s = this.plugin.settings;
		await this.ensureFolder(s.noteFolder);
		const notePath = normalizePath(`${s.noteFolder}/${this.file.basename}.md`);
		let note = this.app.vault.getAbstractFileByPath(notePath) as TFile | null;
		if (!note) {
			const initial = [
				"---",
				`created: ${window.moment().format("YYYY-MM-DD")}`,
				"type: book",
				"tags:",
				"  - book",
				"---",
				"",
				`*Конспект: ${this.file.basename} (создан из Tome).*`,
				"",
				"## 🔖 Выделения",
				"",
			].join("\n");
			note = await this.app.vault.create(notePath, initial);
		}
		const src = this.currentChapter ? `${this.currentChapter}` : "—";
		const quote = this.pendingSelection
			.split("\n")
			.map((l) => "> " + l)
			.join("\n");
		const block = `${quote}\n> — *${src}*`;
		await this.appendToFile(note, block, "## 🔖 Выделения");
		new Notice("📝 Добавлено в конспект: " + this.file.basename);
		this.hideSelection();
	}

	async addSelectionToDict() {
		if (!this.pendingSelection || !this.file) return;
		const s = this.plugin.settings;
		const dict = this.app.vault.getAbstractFileByPath(normalizePath(s.dictFile)) as TFile | null;
		if (!dict) {
			new Notice("Tome: файл словаря не найден: " + s.dictFile + " (настройки Tome)");
			return;
		}
		const word = this.pendingSelection.replace(/\s+/g, " ").trim();
		const line = `- **${word}**:::❓ _(из: ${this.file.basename})_`;
		await this.appendToFile(dict, line, "## 📥 Словарь");
		new Notice("🈶 В словарь: " + (word.length > 30 ? word.slice(0, 30) + "…" : word) + " — впиши перевод вместо ❓");
		this.hideSelection();
	}

	// ─────────────────── прогресс / TOC / оформление ───────────────────

	updateProgress(location: any) {
		const href: string | undefined = location?.start?.href;
		const tocItem = href && this.book ? this.book.navigation?.get(href) : null;
		this.currentChapter = tocItem?.label?.trim() ?? "";
		if (this.chapterEl) this.chapterEl.setText(this.currentChapter);

		if (!this.progressEl) return;
		if (this.locationsReady && this.book) {
			const cfi = location?.start?.cfi;
			if (cfi) {
				const pct = this.book.locations.percentageFromCfi(cfi);
				if (typeof pct === "number" && !isNaN(pct)) {
					this.progressEl.setText(Math.round(pct * 100) + "%");
					return;
				}
			}
		}
		this.progressEl.setText("");
	}

	showToc(ev: MouseEvent) {
		if (!this.book) return;
		const menu = new Menu();
		const addItems = (items: any[], depth: number) => {
			for (const item of items) {
				menu.addItem((mi) =>
					mi
						.setTitle(" ".repeat(depth * 3) + (item.label ?? "").trim())
						.onClick(() => void this.rendition?.display(item.href))
				);
				if (item.subitems?.length && depth < 2) addItems(item.subitems, depth + 1);
			}
		};
		void this.book.loaded.navigation.then((nav: any) => {
			addItems(nav.toc ?? [], 0);
			menu.showAtMouseEvent(ev);
		});
	}

	async applyAppearance(redisplay: boolean) {
		if (!this.rendition) return;
		const s = this.plugin.settings;
		const t = THEMES[s.theme];
		const textColor = s.customTextColor || t.color;
		const body: Record<string, string> = {
			background: t.background,
			color: textColor,
			"line-height": String(s.lineHeight),
			"padding-left": "1em",
			"padding-right": "1em",
		};
		if (s.fontFamily.trim()) body["font-family"] = s.fontFamily.trim();
		this.rendition.themes.default({
			body,
			"p, div, span, li": { color: textColor, "line-height": String(s.lineHeight) },
			a: { color: t.accent },
			"a:visited": { color: t.accent },
			"::selection": { background: t.accent, color: t.background },
		});
		this.rendition.themes.fontSize(s.fontSize + "px");

		this.contentEl.setAttr("data-tome-theme", s.theme);
		this.contentEl.style.setProperty("--tome-bg", t.background);
		this.contentEl.style.setProperty("--tome-fg", textColor);
		this.contentEl.style.setProperty("--tome-accent", t.accent);

		if (redisplay) {
			const loc = (this.rendition as any)?.currentLocation?.();
			const cfi = loc?.start?.cfi;
			if (cfi) await this.rendition.display(cfi);
		}
	}

	async closeBook() {
		try {
			this.rendition?.destroy();
		} catch (e) {
			/* noop */
		}
		try {
			this.book?.destroy();
		} catch (e) {
			/* noop */
		}
		this.rendition = null;
		this.book = null;
		this.locationsReady = false;
		this.pendingSelection = "";
		this.currentChapter = "";
	}

	async onUnloadFile(file: TFile): Promise<void> {
		await this.closeBook();
		this.contentEl.empty();
	}

	async onClose(): Promise<void> {
		await this.closeBook();
	}
}

class TomeSettingTab extends PluginSettingTab {
	plugin: TomePlugin;

	constructor(app: App, plugin: TomePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Тема")
			.setDesc("Оформление страницы книги (доступно и в панели Aa при чтении)")
			.addDropdown((dd) => {
				(Object.keys(THEMES) as TomeTheme[]).forEach((key) =>
					dd.addOption(key, THEMES[key].label)
				);
				dd.setValue(this.plugin.settings.theme).onChange(async (v) => {
					this.plugin.settings.theme = v as TomeTheme;
					await this.plugin.saveSettings();
					this.plugin.applySettingsToOpenViews();
				});
			});

		new Setting(containerEl)
			.setName("Размер шрифта")
			.addSlider((sl) =>
				sl
					.setLimits(12, 36, 1)
					.setValue(this.plugin.settings.fontSize)
					.setDynamicTooltip()
					.onChange(async (v) => {
						this.plugin.settings.fontSize = v;
						await this.plugin.saveSettings();
						this.plugin.applySettingsToOpenViews();
					})
			);

		new Setting(containerEl)
			.setName("Межстрочный интервал")
			.addSlider((sl) =>
				sl
					.setLimits(1.1, 2.4, 0.1)
					.setValue(this.plugin.settings.lineHeight)
					.setDynamicTooltip()
					.onChange(async (v) => {
						this.plugin.settings.lineHeight = v;
						await this.plugin.saveSettings();
						this.plugin.applySettingsToOpenViews();
					})
			);

		new Setting(containerEl)
			.setName("Шрифт")
			.setDesc("Название шрифта (пусто = шрифт книги). Например: Georgia, Noto Serif")
			.addText((tx) =>
				tx
					.setPlaceholder("по умолчанию")
					.setValue(this.plugin.settings.fontFamily)
					.onChange(async (v) => {
						this.plugin.settings.fontFamily = v;
						await this.plugin.saveSettings();
						this.plugin.applySettingsToOpenViews();
					})
			);

		new Setting(containerEl)
			.setName("Папка конспектов")
			.setDesc("Куда складывать заметки-конспекты книг (выделение → «В конспект»)")
			.addText((tx) =>
				tx
					.setValue(this.plugin.settings.noteFolder)
					.onChange(async (v) => {
						this.plugin.settings.noteFolder = v.trim() || DEFAULT_SETTINGS.noteFolder;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Файл словаря")
			.setDesc("Куда добавлять слова (выделение → «В словарь»). Строка попадает под заголовок «## 📥 Словарь»")
			.addText((tx) =>
				tx
					.setValue(this.plugin.settings.dictFile)
					.onChange(async (v) => {
						this.plugin.settings.dictFile = v.trim() || DEFAULT_SETTINGS.dictFile;
						await this.plugin.saveSettings();
					})
			);
	}
}
