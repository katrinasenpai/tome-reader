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

type Lang = "en" | "ru";

interface TomeSettings {
	language: Lang;
	theme: TomeTheme;
	fontSize: number;
	fontFamily: string;
	lineHeight: number;
	customTextColor: string; // "" = theme color
	noteFolder: string;
	dictFiles: string[];
	lastDict: string;
	locations: Record<string, string>;
}

const DEFAULT_SETTINGS: TomeSettings = {
	language: "en",
	theme: "classic-light",
	fontSize: 18,
	fontFamily: "",
	lineHeight: 1.6,
	customTextColor: "",
	noteFolder: "Books/Notes",
	dictFiles: [],
	lastDict: "",
	locations: {},
};

interface ThemeSpec {
	background: string;
	color: string;
	accent: string;
}

const THEMES: Record<TomeTheme, ThemeSpec> = {
	"classic-light": { background: "#faf6ee", color: "#2e2a24", accent: "#8a6d3b" },
	"classic-dark": { background: "#1e1f22", color: "#cfd2d6", accent: "#b08d57" },
	parchment: { background: "#f0e0bd", color: "#4a3423", accent: "#8b5a2b" },
	"gray-fog": { background: "#14151a", color: "#b9bcc7", accent: "#c0392b" },
};

const STRINGS: Record<Lang, any> = {
	en: {
		themes: {
			"classic-light": "Classic Light",
			"classic-dark": "Classic Dark",
			parchment: "Parchment",
			"gray-fog": "Gray Fog",
		},
		toc: "Table of contents",
		aaTitle: "Appearance",
		aaSize: "Size",
		aaSpacing: "Spacing",
		aaTextColor: "Text color",
		aaReset: "Reset",
		toNote: "📝 To book note",
		toDict: "🈶 To dictionary",
		save: "💾 Save",
		back: "↩ Back",
		phNote: "Your thought about this quote (optional) · Enter to save",
		phDict: "Translation or comment (empty = ❓) · Enter to save",
		extTaken: "Tome: the .epub extension is already handled by another plugin. Disable it and restart Obsidian.",
		readFail: "Failed to read the file: ",
		openFail: "Tome could not open this book: ",
		dictMissing: (p: string) => "Tome: dictionary file not found: " + p + " (set it in Tome settings)",
		nAddedNote: (b: string, c: boolean) => "📝 Added to book note" + (c ? " (with your thought)" : "") + ": " + b,
		nAddedDict: (w: string, tr: string) => "🈶 To dictionary: " + w + (tr ? " → " + tr : " — fill in the translation (❓) later"),
		noteIntro: (b: string) => `*Book note: ${b} (created by Tome).*`,
		noteHeading: "## 🔖 Highlights",
		stLanguage: "Language",
		stLanguageDesc: "Plugin interface language (reopen the book to apply)",
		stTheme: "Theme",
		stThemeDesc: "Book page appearance (also available in the Aa panel while reading)",
		stFontSize: "Font size",
		stLineHeight: "Line spacing",
		stFont: "Font",
		stFontDesc: "Font family (empty = book default). E.g.: Georgia, Noto Serif",
		stFontPh: "default",
		stNoteFolder: "Book notes folder",
		stNoteFolderDesc: "Where quote notes are created (selection → “To book note”)",
		stDicts: "Dictionaries",
		stDictsDesc: "Files where selected words are saved. Add several — you'll pick the target when saving",
		addDict: "+ Add dictionary",
		dictTo: "To:",
		dictNone: "Tome: no dictionaries configured — add one in Tome settings",
		tocFail: "Tome: could not open this chapter",
	},
	ru: {
		themes: {
			"classic-light": "Светлая",
			"classic-dark": "Тёмная",
			parchment: "Пергамент",
			"gray-fog": "Серый Туман",
		},
		toc: "Оглавление",
		aaTitle: "Оформление",
		aaSize: "Размер",
		aaSpacing: "Интервал",
		aaTextColor: "Цвет текста",
		aaReset: "Сброс",
		toNote: "📝 В конспект",
		toDict: "🈶 В словарь",
		save: "💾 Сохранить",
		back: "↩ Назад",
		phNote: "Твоя мысль к цитате (можно оставить пустым) · Enter — сохранить",
		phDict: "Перевод или комментарий (пусто = ❓) · Enter — сохранить",
		extTaken: "Tome: расширение .epub уже занято другим плагином. Отключи его и перезапусти Obsidian.",
		readFail: "Не удалось прочитать файл: ",
		openFail: "Tome не смог открыть эту книгу: ",
		dictMissing: (p: string) => "Tome: файл словаря не найден: " + p + " (укажи в настройках Tome)",
		nAddedNote: (b: string, c: boolean) => "📝 В конспект" + (c ? " (с мыслью)" : "") + ": " + b,
		nAddedDict: (w: string, tr: string) => "🈶 В словарь: " + w + (tr ? " → " + tr : " — впиши перевод вместо ❓ позже"),
		noteIntro: (b: string) => `*Конспект: ${b} (создан из Tome).*`,
		noteHeading: "## 🔖 Выделения",
		stLanguage: "Язык",
		stLanguageDesc: "Язык интерфейса плагина (переоткрой книгу, чтобы применить)",
		stTheme: "Тема",
		stThemeDesc: "Оформление страницы книги (доступно и в панели Aa при чтении)",
		stFontSize: "Размер шрифта",
		stLineHeight: "Межстрочный интервал",
		stFont: "Шрифт",
		stFontDesc: "Название шрифта (пусто = шрифт книги). Например: Georgia, Noto Serif",
		stFontPh: "по умолчанию",
		stNoteFolder: "Папка конспектов",
		stNoteFolderDesc: "Куда складывать заметки-конспекты (выделение → «В конспект»)",
		stDicts: "Словари",
		stDictsDesc: "Файлы, куда падают выделенные слова. Добавь несколько — при сохранении выберешь нужный",
		addDict: "+ Добавить словарь",
		dictTo: "Куда:",
		dictNone: "Tome: словари не настроены — добавь в настройках Tome",
		tocFail: "Tome: не удалось открыть главу",
	},
};

export default class TomePlugin extends Plugin {
	settings: TomeSettings = DEFAULT_SETTINGS;

	async onload() {
		await this.loadSettings();

		this.registerView(VIEW_TYPE_EPUB, (leaf) => new TomeView(leaf, this));

		try {
			this.registerExtensions(["epub"], VIEW_TYPE_EPUB);
		} catch (e) {
			new Notice(this.t().extTaken);
		}

		this.addSettingTab(new TomeSettingTab(this.app, this));
	}

	async loadSettings() {
		const data: any = (await this.loadData()) ?? {};
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
		if (!this.settings.locations) this.settings.locations = {};
		if (!Array.isArray(this.settings.dictFiles)) this.settings.dictFiles = [];
		// миграция со старого одиночного поля dictFile
		if (data.dictFile && this.settings.dictFiles.length === 0) {
			this.settings.dictFiles = [data.dictFile];
		}
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

	t(): any {
		return STRINGS[this.settings.language] ?? STRINGS.en;
	}

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
	selActionsEl: HTMLElement | null = null;
	selInputWrapEl: HTMLElement | null = null;
	selInputEl: HTMLTextAreaElement | null = null;
	selMode: "note" | "dict" | null = null;
	selDictRowEl: HTMLElement | null = null;
	selDictPath = "";
	pendingSelection = "";
	pendingChapter = "";
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
		const L = this.plugin.t();
		const header = container.createDiv({ cls: "tome-header" });
		const tocBtn = header.createEl("button", { cls: "tome-btn", text: "☰" });
		tocBtn.setAttr("aria-label", L.toc);
		header.createDiv({ cls: "tome-title", text: file.basename });
		this.chapterEl = header.createDiv({ cls: "tome-chapter", text: "" });
		this.progressEl = header.createDiv({ cls: "tome-progress", text: "…" });
		const aaBtn = header.createEl("button", { cls: "tome-btn tome-aa-btn", text: "Aa" });
		aaBtn.setAttr("aria-label", L.aaTitle);

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
			readerEl.setText(L.readFail + String(e));
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
			readerEl.setText(L.openFail + String(e));
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
			const target = e.target as HTMLElement | null;
			if (
				target &&
				(target.tagName === "TEXTAREA" ||
					target.tagName === "INPUT" ||
					target.isContentEditable)
			)
				return; // печатаем в поле — страницы не трогаем
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

		const L = this.plugin.t();

		// темы
		const themesRow = panel.createDiv({ cls: "tome-aa-row" });
		(Object.keys(THEMES) as TomeTheme[]).forEach((key) => {
			const spec = THEMES[key];
			const chip = themesRow.createEl("button", { cls: "tome-theme-chip", text: L.themes[key] });
			chip.style.setProperty("--chip-bg", spec.background);
			chip.style.setProperty("--chip-fg", spec.color);
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
		sizeRow.createSpan({ cls: "tome-aa-label", text: L.aaSize });
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
		lhRow.createSpan({ cls: "tome-aa-label", text: L.aaSpacing });
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
		colorRow.createSpan({ cls: "tome-aa-label", text: L.aaTextColor });
		const colorInput = colorRow.createEl("input", { cls: "tome-color-input" });
		colorInput.type = "color";
		colorInput.value = this.plugin.settings.customTextColor || THEMES[this.plugin.settings.theme].color;
		colorInput.oninput = async () => {
			this.plugin.settings.customTextColor = colorInput.value;
			await this.plugin.saveSettings();
			this.plugin.applySettingsToOpenViews();
		};
		const colorReset = colorRow.createEl("button", { cls: "tome-btn", text: L.aaReset });
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

		// этап 1 — выбор действия
		const L = this.plugin.t();
		const actions = bar.createDiv({ cls: "tome-selection-actions" });
		this.selActionsEl = actions;
		const noteBtn = actions.createEl("button", { cls: "tome-btn", text: L.toNote });
		const dictBtn = actions.createEl("button", { cls: "tome-btn", text: L.toDict });
		const closeBtn = actions.createEl("button", { cls: "tome-btn", text: "✕" });
		noteBtn.onclick = () => this.openInputStage("note");
		dictBtn.onclick = () => this.openInputStage("dict");
		closeBtn.onclick = () => this.hideSelection();

		// этап 2 — поле для мысли/перевода
		const inputWrap = bar.createDiv({ cls: "tome-selection-input" });
		inputWrap.hide();
		this.selInputWrapEl = inputWrap;
		this.selDictRowEl = inputWrap.createDiv({ cls: "tome-dict-row" });
		this.selDictRowEl.hide();
		const input = inputWrap.createEl("textarea", { cls: "tome-input" });
		input.rows = 2;
		this.selInputEl = input;
		const inputActions = inputWrap.createDiv({ cls: "tome-selection-actions" });
		const saveBtn = inputActions.createEl("button", { cls: "tome-btn tome-btn-accent", text: L.save });
		const backBtn = inputActions.createEl("button", { cls: "tome-btn", text: L.back });
		saveBtn.onclick = () => void this.saveFromInput();
		backBtn.onclick = () => this.showActionsStage();
		input.onkeydown = (e) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				void this.saveFromInput();
			}
			if (e.key === "Escape") this.showActionsStage();
		};
	}

	openInputStage(mode: "note" | "dict") {
		this.selMode = mode;
		if (!this.selInputEl || !this.selInputWrapEl || !this.selActionsEl) return;
		const L = this.plugin.t();
		this.selInputEl.value = "";
		this.selInputEl.placeholder = mode === "note" ? L.phNote : L.phDict;
		if (mode === "dict") this.renderDictChips();
		else this.selDictRowEl?.hide();
		this.selActionsEl.hide();
		this.selInputWrapEl.show();
		this.selInputEl.focus();
	}

	renderDictChips() {
		const row = this.selDictRowEl;
		if (!row) return;
		const s = this.plugin.settings;
		const L = this.plugin.t();
		row.empty();
		if (s.dictFiles.length <= 1) {
			this.selDictPath = s.dictFiles[0] ?? "";
			row.hide();
			return;
		}
		if (!s.dictFiles.includes(this.selDictPath)) {
			this.selDictPath =
				s.lastDict && s.dictFiles.includes(s.lastDict) ? s.lastDict : s.dictFiles[0];
		}
		row.createSpan({ cls: "tome-aa-label", text: L.dictTo });
		for (const p of s.dictFiles) {
			const name = p.split("/").pop()?.replace(/\.md$/, "") ?? p;
			const chip = row.createEl("button", {
				cls: "tome-dict-chip" + (p === this.selDictPath ? " is-active" : ""),
				text: name,
			});
			chip.onclick = () => {
				this.selDictPath = p;
				this.renderDictChips();
			};
		}
		row.show();
	}

	showActionsStage() {
		this.selMode = null;
		this.selInputWrapEl?.hide();
		this.selActionsEl?.show();
	}

	async saveFromInput() {
		const extra = (this.selInputEl?.value ?? "").trim();
		if (this.selMode === "note") await this.addSelectionToNote(extra);
		else if (this.selMode === "dict") await this.addSelectionToDict(extra);
	}

	showSelection(text: string) {
		this.pendingSelection = text;
		this.pendingChapter = this.currentChapter; // глава на момент выделения
		if (this.selectionTextEl) {
			const short = text.length > 120 ? text.slice(0, 120) + "…" : text;
			this.selectionTextEl.setText("«" + short + "»");
		}
		this.showActionsStage();
		this.selectionBar?.show();
	}

	hideSelection() {
		this.pendingSelection = "";
		this.selMode = null;
		this.selectionBar?.hide();
		// планшетное выделение может «увезти» колонку — возвращаем страницу на место
		void this.realignPage();
	}

	async realignPage() {
		const loc = (this.rendition as any)?.currentLocation?.();
		const cfi = loc?.start?.cfi;
		if (cfi) {
			try {
				await this.rendition?.display(cfi);
			} catch (e) {
				/* noop */
			}
		}
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

	async addSelectionToNote(comment: string) {
		if (!this.pendingSelection || !this.file) return;
		const s = this.plugin.settings;
		await this.ensureFolder(s.noteFolder);
		const notePath = normalizePath(`${s.noteFolder}/${this.file.basename}.md`);
		const L = this.plugin.t();
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
				L.noteIntro(this.file.basename),
				"",
				L.noteHeading,
				"",
			].join("\n");
			note = await this.app.vault.create(notePath, initial);
		}
		const src = this.pendingChapter || this.currentChapter || "—";
		const quote = this.pendingSelection
			.split("\n")
			.map((l) => "> " + l)
			.join("\n");
		let block = `${quote}\n> — *${src}*`;
		if (comment) block += `\n\n💭 *${comment}*`;
		await this.appendToFile(note, block, L.noteHeading);
		new Notice(L.nAddedNote(this.file.basename, Boolean(comment)));
		this.hideSelection();
	}

	async addSelectionToDict(translation: string) {
		if (!this.pendingSelection || !this.file) return;
		const s = this.plugin.settings;
		const L = this.plugin.t();
		if (s.dictFiles.length === 0) {
			new Notice(L.dictNone);
			return;
		}
		const path =
			this.selDictPath && s.dictFiles.includes(this.selDictPath)
				? this.selDictPath
				: s.dictFiles[0];
		const dict = this.app.vault.getAbstractFileByPath(normalizePath(path)) as TFile | null;
		if (!dict) {
			new Notice(L.dictMissing(path));
			return;
		}
		const word = this.pendingSelection.replace(/\s+/g, " ").trim();
		const line = `- **${word}**:::${translation || "❓"}`;
		await this.appendToFile(dict, line, "## 📥 Словарь");
		s.lastDict = path;
		await this.plugin.saveSettings();
		new Notice(L.nAddedDict(word.length > 30 ? word.slice(0, 30) + "…" : word, translation));
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
						.onClick(() => void this.displayHref(String(item.href ?? "")))
				);
				if (item.subitems?.length && depth < 2) addItems(item.subitems, depth + 1);
			}
		};
		void this.book.loaded.navigation.then((nav: any) => {
			addItems(nav.toc ?? [], 0);
			menu.showAtMouseEvent(ev);
		});
	}

	// у EPUB главы часто прописаны «кривыми» относительными путями — ищем каскадом
	async displayHref(href: string) {
		if (!this.rendition || !this.book || !href) return;
		const tryDisplay = async (h: string) => {
			try {
				await this.rendition!.display(h);
				return true;
			} catch (e) {
				return false;
			}
		};
		if (await tryDisplay(href)) return;
		const noFrag = href.split("#")[0];
		if (noFrag && noFrag !== href && (await tryDisplay(noFrag))) return;
		// поиск подходящего элемента спайна по хвосту пути
		const spine: any = (this.book as any).spine;
		const items: any[] = spine?.spineItems ?? spine?.items ?? [];
		const tail = noFrag.split("/").pop() ?? noFrag;
		const match = items.find(
			(it) =>
				it?.href === noFrag ||
				(typeof it?.href === "string" && (it.href.endsWith("/" + tail) || it.href.endsWith(tail)))
		);
		if (match?.href && (await tryDisplay(match.href))) return;
		new Notice(this.plugin.t().tocFail);
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
		const L = this.plugin.t();

		new Setting(containerEl)
			.setName(L.stLanguage)
			.setDesc(L.stLanguageDesc)
			.addDropdown((dd) =>
				dd
					.addOption("en", "English")
					.addOption("ru", "Русский")
					.setValue(this.plugin.settings.language)
					.onChange(async (v) => {
						this.plugin.settings.language = v as Lang;
						await this.plugin.saveSettings();
						this.display();
					})
			);

		new Setting(containerEl)
			.setName(L.stTheme)
			.setDesc(L.stThemeDesc)
			.addDropdown((dd) => {
				(Object.keys(THEMES) as TomeTheme[]).forEach((key) =>
					dd.addOption(key, L.themes[key])
				);
				dd.setValue(this.plugin.settings.theme).onChange(async (v) => {
					this.plugin.settings.theme = v as TomeTheme;
					await this.plugin.saveSettings();
					this.plugin.applySettingsToOpenViews();
				});
			});

		new Setting(containerEl)
			.setName(L.stFontSize)
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
			.setName(L.stLineHeight)
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
			.setName(L.stFont)
			.setDesc(L.stFontDesc)
			.addText((tx) =>
				tx
					.setPlaceholder(L.stFontPh)
					.setValue(this.plugin.settings.fontFamily)
					.onChange(async (v) => {
						this.plugin.settings.fontFamily = v;
						await this.plugin.saveSettings();
						this.plugin.applySettingsToOpenViews();
					})
			);

		new Setting(containerEl)
			.setName(L.stNoteFolder)
			.setDesc(L.stNoteFolderDesc)
			.addText((tx) =>
				tx
					.setValue(this.plugin.settings.noteFolder)
					.onChange(async (v) => {
						this.plugin.settings.noteFolder = v.trim() || DEFAULT_SETTINGS.noteFolder;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl).setName(L.stDicts).setDesc(L.stDictsDesc).setHeading();

		this.plugin.settings.dictFiles.forEach((path, idx) => {
			new Setting(containerEl).addText((tx) => {
				tx.inputEl.style.width = "100%";
				tx.setValue(path).onChange(async (v) => {
					this.plugin.settings.dictFiles[idx] = v.trim();
					await this.plugin.saveSettings();
				});
			}).addExtraButton((btn) =>
				btn
					.setIcon("x")
					.setTooltip("✕")
					.onClick(async () => {
						this.plugin.settings.dictFiles.splice(idx, 1);
						await this.plugin.saveSettings();
						this.display();
					})
			);
		});

		new Setting(containerEl).addButton((btn) =>
			btn.setButtonText(L.addDict).onClick(async () => {
				this.plugin.settings.dictFiles.push("");
				await this.plugin.saveSettings();
				this.display();
			})
		);
	}
}
