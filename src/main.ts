import {
	App,
	FileView,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	TFolder,
	WorkspaceLeaf,
	debounce,
	normalizePath,
	requestUrl,
} from "obsidian";
import ePub, { Book, EpubCFI, Rendition } from "epubjs";

const VIEW_TYPE_EPUB = "tome-epub-view";

type TomeTheme = "classic-light" | "classic-dark" | "parchment" | "gray-fog";

type Lang = "en" | "ru";

interface TocEntry {
	label: string;
	href: string;
	depth: number;
	cfi?: string; // построенные по заголовкам записи целятся точным CFI
	idx?: number; // индекс файла в спайне — для подсветки текущей главы
}

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
	genTocs: Record<string, TocEntry[]>; // кэш оглавлений, собранных по заголовкам
	aiPreset: string; // "" = выключен
	aiBaseUrl: string;
	aiModel: string;
	aiKey: string;
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
	genTocs: {},
	aiPreset: "",
	aiBaseUrl: "",
	aiModel: "",
	aiKey: "",
};

const AI_PRESETS: Record<string, { url: string; model: string }> = {
	groq: { url: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" },
	openai: { url: "https://api.openai.com/v1", model: "gpt-4o-mini" },
	openrouter: { url: "https://openrouter.ai/api/v1", model: "" },
	anthropic: { url: "https://api.anthropic.com", model: "claude-opus-4-8" },
	custom: { url: "", model: "" },
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
		tocFilter: "Filter chapters…",
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
		tocBuilt: (n: number) => `Tome: table of contents built from headings (${n} chapters)`,
		aiBtn: "✨ AI",
		aiTranslate: "🌐 Translate",
		aiExplain: "💡 Explain",
		aiRecap: "📍 What happened so far?",
		phAsk: "Or ask your own question · Enter",
		aiThinking: "Thinking…",
		aiReading: "Re-reading the book…",
		aiNoText: "Tome: could not collect the text before your position",
		aiNoKey: "Tome: AI is not set up — pick a provider and add an API key in Tome settings",
		aiRefusal: "the model declined to answer",
		aiEmpty: "empty response from the model",
		stAi: "AI assistant",
		stAiDesc:
			"Bring your own API key. Selected fragments (and, for book questions, text you've already read) are sent to the provider you choose",
		stAiOff: "Off",
		stAiCustom: "Custom (OpenAI-compatible)",
		stAiPreset: "Provider",
		stAiUrl: "Base URL",
		stAiModel: "Model",
		stAiModelDesc: "E.g. llama-3.3-70b-versatile · gpt-4o-mini · claude-opus-4-8 (claude-haiku-4-5 is the budget pick)",
		stAiKey: "API key",
		stAiKeyDesc: "Stored locally in the plugin data on this device",
	},
	ru: {
		themes: {
			"classic-light": "Светлая",
			"classic-dark": "Тёмная",
			parchment: "Пергамент",
			"gray-fog": "Серый Туман",
		},
		toc: "Оглавление",
		tocFilter: "Поиск по главам…",
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
		tocBuilt: (n: number) => `Tome: оглавление собрано по заголовкам (${n} глав)`,
		aiBtn: "✨ AI",
		aiTranslate: "🌐 Перевод",
		aiExplain: "💡 Пояснить",
		aiRecap: "📍 Что было раньше?",
		phAsk: "Или свой вопрос · Enter — спросить",
		aiThinking: "Думаю…",
		aiReading: "Перечитываю книгу…",
		aiNoText: "Tome: не удалось собрать текст до текущего места",
		aiNoKey: "Tome: AI не настроен — выбери провайдера и добавь API-ключ в настройках Tome",
		aiRefusal: "модель отказалась отвечать",
		aiEmpty: "пустой ответ модели",
		stAi: "AI-ассистент",
		stAiDesc:
			"Свой API-ключ. Выделенные фрагменты (а для вопросов по книге — уже прочитанный текст) отправляются выбранному провайдеру",
		stAiOff: "Выключен",
		stAiCustom: "Свой (OpenAI-совместимый)",
		stAiPreset: "Провайдер",
		stAiUrl: "Base URL",
		stAiModel: "Модель",
		stAiModelDesc: "Например: llama-3.3-70b-versatile · gpt-4o-mini · claude-opus-4-8 (эконом-вариант — claude-haiku-4-5)",
		stAiKey: "API-ключ",
		stAiKeyDesc: "Хранится локально в данных плагина на этом устройстве",
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
		if (!this.settings.genTocs) this.settings.genTocs = {};
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

	aiReady(): boolean {
		const s = this.settings;
		return Boolean(s.aiPreset && s.aiKey.trim() && s.aiModel.trim() && s.aiBaseUrl.trim());
	}

	// один вызов «system + user → текст ответа»; Anthropic говорит на своём
	// диалекте Messages API, остальные провайдеры — на OpenAI-совместимом
	async aiChat(system: string, user: string): Promise<string> {
		const s = this.settings;
		const L = this.t();
		if (!this.aiReady()) throw new Error(L.aiNoKey);
		const base = s.aiBaseUrl.trim().replace(/\/+$/, "");
		const isAnthropic = s.aiPreset === "anthropic";
		const url = isAnthropic ? base + "/v1/messages" : base + "/chat/completions";
		const headers: Record<string, string> = { "Content-Type": "application/json" };
		let body: any;
		if (isAnthropic) {
			headers["x-api-key"] = s.aiKey.trim();
			headers["anthropic-version"] = "2023-06-01";
			body = {
				model: s.aiModel.trim(),
				max_tokens: 1500,
				system,
				messages: [{ role: "user", content: user }],
			};
		} else {
			headers["Authorization"] = "Bearer " + s.aiKey.trim();
			body = {
				model: s.aiModel.trim(),
				max_tokens: 1500,
				temperature: 0.3,
				messages: [
					{ role: "system", content: system },
					{ role: "user", content: user },
				],
			};
		}
		const res = await requestUrl({
			url,
			method: "POST",
			headers,
			body: JSON.stringify(body),
			throw: false,
		});
		if (res.status < 200 || res.status >= 300) {
			let msg = "HTTP " + res.status;
			try {
				const j: any = res.json;
				const detail = j?.error?.message ?? j?.error ?? "";
				if (detail) msg += ": " + String(typeof detail === "string" ? detail : JSON.stringify(detail)).slice(0, 300);
			} catch (e) {
				if (res.text) msg += ": " + res.text.slice(0, 200);
			}
			throw new Error(msg);
		}
		let data: any;
		try {
			data = res.json;
		} catch (e) {
			throw new Error(L.aiEmpty);
		}
		let text = "";
		if (isAnthropic) {
			if (data?.stop_reason === "refusal") throw new Error(L.aiRefusal);
			const blocks: any[] = Array.isArray(data?.content) ? data.content : [];
			text = blocks
				.filter((b) => b?.type === "text")
				.map((b) => String(b.text ?? ""))
				.join("\n");
		} else {
			text = String(data?.choices?.[0]?.message?.content ?? "");
		}
		// рассуждающие модели заворачивают мысли в <think> (в т.ч. без закрытия)
		text = text.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/<think>[\s\S]*$/, "").trim();
		if (!text) throw new Error(L.aiEmpty);
		return text;
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
	pendingContext = "";
	pendingChapter = "";
	currentChapter = "";
	locationsReady = false;
	tocPanel: HTMLElement | null = null;
	tocListEl: HTMLElement | null = null;
	tocFilterEl: HTMLInputElement | null = null;
	flatToc: TocEntry[] = [];
	flatTocGenerated = false;
	selAiBtn: HTMLElement | null = null;
	selAiWrapEl: HTMLElement | null = null;
	selAiChipsEl: HTMLElement | null = null;
	selAiInputEl: HTMLTextAreaElement | null = null;
	selAiAnswerEl: HTMLElement | null = null;
	selAiActionsEl: HTMLElement | null = null;
	aiMode: "sel" | "book" = "sel";
	aiAnswer = "";
	aiBusy = false;

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
		const aiHeaderBtn = header.createEl("button", { cls: "tome-btn", text: "✨" });
		aiHeaderBtn.setAttr("aria-label", L.aiBtn);
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

		// ── панель оглавления (создаётся скрытой) ──
		this.buildTocPanel(readerWrap);

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
				let para = "";
				try {
					// абзац вокруг выделения — контекст для AI-перевода/пояснения
					const node: any = sel?.anchorNode;
					const el = node ? (node.nodeType === 3 ? node.parentElement : node) : null;
					para = String(el?.closest?.("p, li, blockquote, div")?.textContent ?? "")
						.replace(/\s+/g, " ")
						.trim()
						.slice(0, 600);
				} catch (e) {
					/* noop */
				}
				if (text) this.showSelection(text, para);
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
		tocBtn.onclick = () => this.toggleToc();
		aaBtn.onclick = () => this.toggleAaPanel();
		aiHeaderBtn.onclick = () => this.openBookAi();

		this.flatToc = [];
		this.flatTocGenerated = false;
		void this.book.loaded.navigation
			.then(async (nav: any) => {
				const walk = (items: any[], depth: number) => {
					for (const it of items ?? []) {
						this.flatToc.push({
							label: String(it?.label ?? "").trim(),
							href: String(it?.href ?? ""),
							depth,
						});
						if (it?.subitems?.length && depth < 2) walk(it.subitems, depth + 1);
					}
				};
				walk(nav?.toc ?? [], 0);
				// у конвертированных книг ncx часто пуст («Start») — собираем
				// оглавление по заголовкам внутри текста
				if (this.flatToc.length <= 2 && this.file) {
					const cached = this.plugin.settings.genTocs[this.file.path];
					if (cached?.length) {
						this.flatToc = cached.slice();
						this.flatTocGenerated = true;
						return;
					}
					const entries = await this.generateTocFromHeadings();
					if (entries.length > this.flatToc.length && this.file) {
						this.flatToc = entries;
						this.flatTocGenerated = true;
						this.plugin.settings.genTocs[this.file.path] = entries;
						await this.plugin.saveSettings();
						new Notice(this.plugin.t().tocBuilt(entries.length));
					}
				}
			})
			.catch(() => {});

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
			this.hideToc();
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
		const aiBtn = actions.createEl("button", { cls: "tome-btn", text: L.aiBtn });
		this.selAiBtn = aiBtn;
		const closeBtn = actions.createEl("button", { cls: "tome-btn", text: "✕" });
		noteBtn.onclick = () => this.openInputStage("note");
		dictBtn.onclick = () => this.openInputStage("dict");
		aiBtn.onclick = () => this.openAiStage("sel");
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

		// этап 3 — AI: быстрые действия, свой вопрос, ответ
		const aiWrap = bar.createDiv({ cls: "tome-selection-input" });
		aiWrap.hide();
		this.selAiWrapEl = aiWrap;
		this.selAiChipsEl = aiWrap.createDiv({ cls: "tome-dict-row" });
		const aiInput = aiWrap.createEl("textarea", { cls: "tome-input" });
		aiInput.rows = 1;
		aiInput.placeholder = L.phAsk;
		this.selAiInputEl = aiInput;
		aiInput.onkeydown = (e) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				if (this.aiMode === "book") void this.runBookAi("ask");
				else void this.runAi("ask");
			}
			if (e.key === "Escape") this.closeAiStage();
		};
		const answer = aiWrap.createDiv({ cls: "tome-ai-answer" });
		answer.hide();
		this.selAiAnswerEl = answer;
		const aiActions = aiWrap.createDiv({ cls: "tome-selection-actions" });
		this.selAiActionsEl = aiActions;
		const aiToDict = aiActions.createEl("button", { cls: "tome-btn tome-ai-todict", text: L.toDict });
		const aiToNote = aiActions.createEl("button", { cls: "tome-btn tome-ai-tonote", text: L.toNote });
		const aiBack = aiActions.createEl("button", { cls: "tome-btn", text: L.back });
		// ответ AI подставляется в обычный этап словаря/конспекта — там можно
		// поправить текст и выбрать словарь-цель
		aiToDict.onclick = () => {
			const ans = this.aiAnswer;
			this.openInputStage("dict");
			if (this.selInputEl) this.selInputEl.value = ans;
		};
		aiToNote.onclick = () => {
			const ans = this.aiAnswer;
			this.openInputStage("note");
			if (this.selInputEl) this.selInputEl.value = ans;
		};
		aiBack.onclick = () => this.closeAiStage();
	}

	// ─────────────────── AI-ассистент ───────────────────

	openAiStage(mode: "sel" | "book") {
		const L = this.plugin.t();
		if (!this.plugin.aiReady()) {
			new Notice(L.aiNoKey);
			return;
		}
		this.aiMode = mode;
		this.aiAnswer = "";
		this.setAiAnswer("");
		if (!this.selAiWrapEl || !this.selAiChipsEl || !this.selAiInputEl) return;
		this.selAiChipsEl.empty();
		if (mode === "sel") {
			const tr = this.selAiChipsEl.createEl("button", { cls: "tome-dict-chip", text: L.aiTranslate });
			tr.onclick = () => void this.runAi("translate");
			const ex = this.selAiChipsEl.createEl("button", { cls: "tome-dict-chip", text: L.aiExplain });
			ex.onclick = () => void this.runAi("explain");
		} else {
			const rc = this.selAiChipsEl.createEl("button", { cls: "tome-dict-chip", text: L.aiRecap });
			rc.onclick = () => void this.runBookAi("recap");
		}
		this.selAiInputEl.value = "";
		this.selMode = null;
		this.selActionsEl?.hide();
		this.selInputWrapEl?.hide();
		this.selAiWrapEl.show();
	}

	closeAiStage() {
		if (this.aiMode === "book") {
			this.hideSelection();
			return;
		}
		this.selAiWrapEl?.hide();
		this.selActionsEl?.show();
	}

	// вопросы по книге без выделения — из кнопки ✨ в шапке
	openBookAi() {
		const L = this.plugin.t();
		if (!this.plugin.aiReady()) {
			new Notice(L.aiNoKey);
			return;
		}
		this.pendingSelection = "";
		this.pendingContext = "";
		if (this.selectionTextEl) {
			const where = this.currentChapter ? " · " + this.currentChapter : "";
			this.selectionTextEl.setText("✨ " + (this.file?.basename ?? "") + where);
		}
		this.hideToc();
		this.aaPanel?.hide();
		this.openAiStage("book");
		this.selectionBar?.show();
	}

	setAiAnswer(text: string) {
		const el = this.selAiAnswerEl;
		if (!el) return;
		el.setText(text);
		el.toggle(Boolean(text));
		const hasAnswer = Boolean(this.aiAnswer);
		const canSave = hasAnswer && this.aiMode === "sel";
		this.selAiActionsEl?.querySelector(".tome-ai-todict")?.toggleClass("tome-hidden", !canSave);
		this.selAiActionsEl?.querySelector(".tome-ai-tonote")?.toggleClass("tome-hidden", !canSave);
	}

	async runAi(kind: "translate" | "explain" | "ask") {
		if (this.aiBusy) return;
		const L = this.plugin.t();
		const sel = this.pendingSelection;
		const para = this.pendingContext;
		const book = this.file?.basename ?? "";
		const lang = this.plugin.settings.language === "ru" ? "Russian" : "English";
		let userMsg = "";
		if (kind === "translate") {
			userMsg =
				`Translate into ${lang}: "${sel}"` +
				(para && para !== sel ? `\nSentence context: "${para}"` : "") +
				`\nReply with ONLY the translation; for a single word you may add the reading or a brief nuance in parentheses.`;
		} else if (kind === "explain") {
			userMsg =
				`Explain the meaning of this fragment in its context (terms, idioms, cultural references, allusions): "${sel}"` +
				(para && para !== sel ? `\nContext: "${para}"` : "") +
				`\nAnswer in 2–5 sentences.`;
		} else {
			const q = (this.selAiInputEl?.value ?? "").trim();
			if (!q) return;
			userMsg = q + `\n\nAbout this fragment from the book: "${sel}"` + (para && para !== sel ? `\nContext: "${para}"` : "");
		}
		const system = `You are a reading assistant inside an e-book reader. The reader is reading "${book}". Answer in ${lang}. Be concise and helpful. Do not reveal plot events beyond the provided text.`;
		await this.execAi(system, userMsg, L.aiThinking);
	}

	async runBookAi(kind: "recap" | "ask") {
		if (this.aiBusy) return;
		const L = this.plugin.t();
		const q = kind === "ask" ? (this.selAiInputEl?.value ?? "").trim() : "";
		if (kind === "ask" && !q) return;
		this.aiBusy = true;
		this.aiAnswer = "";
		this.setAiAnswer("⏳ " + L.aiReading);
		let excerpt = "";
		try {
			excerpt = await this.getTextBeforePosition(12000);
		} catch (e) {
			/* noop */
		}
		this.aiBusy = false;
		if (!excerpt) {
			this.setAiAnswer("");
			new Notice(L.aiNoText);
			return;
		}
		const book = this.file?.basename ?? "";
		const chapter = this.currentChapter;
		const lang = this.plugin.settings.language === "ru" ? "Russian" : "English";
		const system =
			`You are a reading assistant inside an e-book reader. The reader is reading "${book}"` +
			(chapter ? `, currently at "${chapter}"` : "") +
			`. Answer in ${lang}. Important: rely ONLY on the provided excerpt (text before the reader's current position); never reveal or guess anything beyond it.`;
		const user =
			kind === "recap"
				? `Excerpt (the tail of what has been read so far):\n"""${excerpt}"""\n\nBriefly remind me what has been happening: key events and characters, 3–6 bullet points.`
				: `Excerpt (the tail of what has been read so far):\n"""${excerpt}"""\n\nMy question: ${q}\nIf the excerpt is not enough to answer, say you can't tell yet without spoilers.`;
		await this.execAi(system, user, L.aiThinking);
	}

	async execAi(system: string, user: string, waitText: string) {
		if (this.aiBusy) return;
		this.aiBusy = true;
		this.aiAnswer = "";
		this.setAiAnswer("⏳ " + waitText);
		try {
			const res = await this.plugin.aiChat(system, user);
			this.aiAnswer = res;
			this.setAiAnswer(res);
		} catch (e) {
			this.setAiAnswer("");
			new Notice("Tome AI: " + String((e as Error)?.message ?? e));
		} finally {
			this.aiBusy = false;
		}
	}

	// текст до текущей позиции читателя (без спойлеров) — контекст для AI
	async getTextBeforePosition(maxChars: number): Promise<string> {
		const loc = (this.rendition as any)?.currentLocation?.();
		const startHref = String(loc?.start?.href ?? "");
		const cfi = String(loc?.start?.cfi ?? "");
		const spine: any = (this.book as any)?.spine;
		const items: any[] = spine?.spineItems ?? [];
		if (!items.length) return "";
		let curIdx = items.findIndex((it) => this.samePath(String(it?.href ?? ""), startHref));
		if (curIdx < 0) curIdx = 0;
		let text = "";
		// текущий файл — только до позиции чтения
		try {
			const contents: any[] = (this.rendition as any)?.getContents?.() ?? [];
			for (const c of contents) {
				const doc: Document | undefined = c?.document;
				if (!doc?.body) continue;
				let upTo = "";
				try {
					const range = c.range?.(cfi);
					if (range) {
						const r = doc.createRange();
						r.setStart(doc.body, 0);
						r.setEnd(range.startContainer, range.startOffset);
						upTo = r.toString();
					}
				} catch (e) {
					/* noop */
				}
				if (!upTo) upTo = String(doc.body.textContent ?? "");
				text = upTo;
				break;
			}
		} catch (e) {
			/* noop */
		}
		// предыдущие файлы, пока не наберём maxChars
		for (let i = curIdx - 1; i >= 0 && text.length < maxChars; i--) {
			const sec = items[i];
			try {
				await sec.load((this.book as any).load.bind(this.book));
				const t = String(sec.document?.body?.textContent ?? "");
				sec.unload?.();
				text = t + "\n" + text;
			} catch (e) {
				/* noop */
			}
		}
		return text.replace(/\s+/g, " ").trim().slice(-maxChars);
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
		this.selAiWrapEl?.hide();
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
		this.selAiWrapEl?.hide();
		this.selActionsEl?.show();
	}

	async saveFromInput() {
		const extra = (this.selInputEl?.value ?? "").trim();
		if (this.selMode === "note") await this.addSelectionToNote(extra);
		else if (this.selMode === "dict") await this.addSelectionToDict(extra);
	}

	showSelection(text: string, context = "") {
		this.pendingSelection = text;
		this.pendingContext = context;
		this.pendingChapter = this.currentChapter; // глава на момент выделения
		if (this.selectionTextEl) {
			const short = text.length > 120 ? text.slice(0, 120) + "…" : text;
			this.selectionTextEl.setText("«" + short + "»");
		}
		this.selAiBtn?.toggle(this.plugin.aiReady());
		this.showActionsStage();
		this.selectionBar?.show();
	}

	hideSelection() {
		this.pendingSelection = "";
		this.pendingContext = "";
		this.aiAnswer = "";
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
		let label = "";
		if (href && this.book) {
			try {
				label = this.book.navigation?.get(href)?.label?.trim() ?? "";
			} catch (e) {
				label = "";
			}
			if (!label && this.flatTocGenerated) {
				const gi = this.genTocCurrentIndex(href, String(location?.start?.cfi ?? ""));
				if (gi >= 0) label = this.flatToc[gi].label;
			}
			if (!label) {
				const hit = this.flatToc.find((en) => this.samePath(en.href.split("#")[0], href));
				if (hit) label = hit.label;
			}
		}
		// TOC не знает этот файл — оставляем последнюю известную главу
		if (label) this.currentChapter = label;
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

	// ── собственная панель оглавления: системное меню Obsidian на мобильном
	// с сотнями пунктов срабатывает не по тому пункту, поэтому список свой ──

	buildTocPanel(parent: HTMLElement) {
		const L = this.plugin.t();
		const panel = parent.createDiv({ cls: "tome-toc-panel" });
		panel.hide();
		this.tocPanel = panel;

		const head = panel.createDiv({ cls: "tome-toc-head" });
		head.createDiv({ cls: "tome-toc-head-title", text: L.toc });
		const closeBtn = head.createEl("button", { cls: "tome-btn", text: "✕" });
		closeBtn.onclick = () => this.hideToc();

		const filter = panel.createEl("input", { cls: "tome-input tome-toc-filter" });
		filter.type = "text";
		filter.placeholder = L.tocFilter;
		this.tocFilterEl = filter;
		filter.oninput = () => {
			const q = filter.value.trim().toLowerCase();
			this.tocListEl?.querySelectorAll<HTMLElement>(".tome-toc-item").forEach((el) => {
				el.toggle(!q || (el.textContent ?? "").toLowerCase().includes(q));
			});
		};

		this.tocListEl = panel.createDiv({ cls: "tome-toc-list" });
	}

	toggleToc() {
		if (!this.tocPanel) return;
		if (this.tocPanel.isShown()) {
			this.hideToc();
			return;
		}
		this.aaPanel?.hide();
		if (this.tocFilterEl) this.tocFilterEl.value = "";
		this.renderTocList();
		this.tocPanel.show();
		const cur = this.tocListEl?.querySelector(".is-current");
		if (cur) (cur as HTMLElement).scrollIntoView({ block: "center" });
	}

	hideToc() {
		this.tocPanel?.hide();
	}

	renderTocList() {
		const list = this.tocListEl;
		if (!list) return;
		list.empty();
		const loc = (this.rendition as any)?.currentLocation?.();
		const curHref = String(loc?.start?.href ?? "");
		const curCfi = String(loc?.start?.cfi ?? "");
		const genCurrent = this.flatTocGenerated ? this.genTocCurrentIndex(curHref, curCfi) : -1;
		let marked = false;
		this.flatToc.forEach((entry, i) => {
			const row = list.createDiv({ cls: "tome-toc-item", text: entry.label || "—" });
			row.setAttr("data-depth", String(entry.depth));
			const isCurrent = this.flatTocGenerated
				? i === genCurrent
				: !marked && Boolean(curHref) && this.samePath(entry.href.split("#")[0], curHref);
			if (isCurrent) {
				row.addClass("is-current");
				marked = true;
			}
			row.onclick = () => {
				this.hideToc();
				void this.displayEntry(entry);
			};
		});
	}

	// запись из собранного оглавления открываем по её CFI, обычную — по href
	async displayEntry(entry: TocEntry) {
		if (entry.cfi) {
			if (await this.tryDisplay(entry.cfi)) {
				this.currentChapter = entry.label;
				this.chapterEl?.setText(entry.label);
				return;
			}
		}
		await this.displayHref(entry.href, entry.label);
	}

	// сканируем файлы книги и строим оглавление по заголовкам:
	// h1–h4 + полностью жирные абзацы вида «Глава 228. Наниматель»
	async generateTocFromHeadings(): Promise<TocEntry[]> {
		if (!this.book) return [];
		const spine: any = (this.book as any).spine;
		const items: any[] = spine?.spineItems ?? [];
		const entries: TocEntry[] = [];
		const seen = new Set<string>();
		const chapterRe =
			/^(глава|часть|том|книга|пролог|эпилог|интерлюдия|послесловие|предисловие|chapter|part|book|volume|prologue|epilogue|interlude|act)\b/i;
		const numRe = /^\d{1,4}\s*[.):—-]/;
		for (const sec of items) {
			if (entries.length >= 2000) break;
			try {
				await sec.load((this.book as any).load.bind(this.book));
				const doc: Document | undefined = sec.document;
				if (!doc?.body) continue;
				const nodes = Array.from(doc.body.querySelectorAll("h1, h2, h3, h4, p"));
				let pendingNum: { el: Element; text: string } | null = null;
				for (const el of nodes) {
					const tag = el.tagName.toLowerCase();
					let text = String(el.textContent ?? "").replace(/\s+/g, " ").trim();
					if (!text || text.length > 120) {
						pendingNum = null;
						continue;
					}
					let isHeading = tag !== "p";
					if (!isHeading) {
						const b = el.querySelector("b, strong");
						const wholeBold =
							b && String(b.textContent ?? "").replace(/\s+/g, " ").trim() === text;
						isHeading = Boolean(wholeBold && (chapterRe.test(text) || numRe.test(text)));
					}
					if (!isHeading) {
						pendingNum = null;
						continue;
					}
					// пара «<h2>227.</h2> + <h3>Изобретатель</h3>» — одна глава
					if (tag !== "p" && /^\d{1,4}\s*[.)]?$/.test(text)) {
						pendingNum = { el, text: text.replace(/\s*[.)]\s*$/, "") };
						continue;
					}
					let anchorEl: Element = el;
					if (pendingNum) {
						text = pendingNum.text + ". " + text;
						anchorEl = pendingNum.el;
						pendingNum = null;
					}
					const key = String(sec.href ?? "") + "#" + text;
					if (seen.has(key)) continue;
					seen.add(key);
					let cfi = "";
					try {
						cfi = String(sec.cfiFromElement?.(anchorEl) ?? "");
					} catch (e) {
						/* noop */
					}
					entries.push({
						label: text,
						href: String(sec.href ?? ""),
						depth: 0,
						cfi: cfi || undefined,
						idx: typeof sec.index === "number" ? sec.index : undefined,
					});
				}
				sec.unload?.();
			} catch (e) {
				/* noop */
			}
		}
		return entries;
	}

	// последняя запись собранного оглавления, которая не позже текущей позиции
	genTocCurrentIndex(curHref: string, curCfi: string): number {
		const item = this.findSpineItem(curHref);
		const curIdx: number = typeof item?.index === "number" ? item.index : -1;
		if (curIdx < 0) return -1;
		let cmp: any = null;
		try {
			cmp = new EpubCFI();
		} catch (e) {
			/* noop */
		}
		let best = -1;
		for (let i = 0; i < this.flatToc.length; i++) {
			const en = this.flatToc[i];
			if (typeof en.idx !== "number") continue;
			if (en.idx < curIdx) {
				best = i;
				continue;
			}
			if (en.idx === curIdx) {
				if (!en.cfi || !curCfi || !cmp) {
					if (best < 0) best = i;
					continue;
				}
				try {
					if (cmp.compare(en.cfi, curCfi) <= 0) best = i;
				} catch (e) {
					/* noop */
				}
			}
		}
		return best;
	}

	// главы в EPUB бывают прописаны «кривыми» относительными путями или якорями —
	// цель разрешаем по спайну сами, ничего не угадывая
	async displayHref(href: string, label?: string) {
		if (!this.rendition || !this.book || !href) return;
		const hashAt = href.indexOf("#");
		const path = hashAt >= 0 ? href.slice(0, hashAt) : href;
		const frag = hashAt >= 0 ? href.slice(hashAt + 1) : "";
		const section = this.findSpineItem(path);

		const candidates: string[] = [];
		if (section?.href) {
			candidates.push(frag ? section.href + "#" + frag : section.href);
			if (frag) candidates.push(section.href);
		} else if (!/^\d+$/.test(href)) {
			// сырой href — последняя надежда; чисто числовую строку epub.js
			// трактует как индекс спайна, поэтому её не пропускаем
			candidates.push(href);
			if (path && path !== href) candidates.push(path);
		}

		for (const c of candidates) {
			if (await this.tryDisplay(c)) {
				if (label) {
					this.currentChapter = label;
					this.chapterEl?.setText(label);
				}
				// якорь внутри большого файла: уточняем позицию после раскладки
				if (frag && c.indexOf("#") >= 0) await this.settleAnchor(frag, c);
				return;
			}
		}
		new Notice(this.plugin.t().tocFail);
	}

	async tryDisplay(target: string): Promise<boolean> {
		try {
			await this.rendition!.display(target);
			return true;
		} catch (e) {
			return false;
		}
	}

	normPath(p: unknown): string {
		let s = String(p ?? "");
		try {
			s = decodeURIComponent(s);
		} catch (e) {
			/* оставляем как есть */
		}
		return s
			.replace(/\\/g, "/")
			.toLowerCase()
			.split("/")
			.filter((seg) => seg && seg !== "." && seg !== "..")
			.join("/");
	}

	samePath(a: string, b: string): boolean {
		const na = this.normPath(a);
		const nb = this.normPath(b);
		return Boolean(na) && Boolean(nb) && (na === nb || na.endsWith("/" + nb) || nb.endsWith("/" + na));
	}

	// строгий поиск файла спайна: точное совпадение → совпадение по границе
	// сегмента → равенство имени файла (никаких «похожих хвостов»)
	findSpineItem(path: string): any | null {
		const spine: any = (this.book as any)?.spine;
		const items: any[] = spine?.spineItems ?? spine?.items ?? [];
		const target = this.normPath(path);
		if (!target) return null;
		let match = items.find((it) => this.normPath(it?.href) === target);
		if (!match)
			match = items.find((it) => {
				const h = this.normPath(it?.href);
				return h.length > 0 && (h.endsWith("/" + target) || target.endsWith("/" + h));
			});
		if (!match) {
			const base = target.split("/").pop() ?? "";
			if (base) match = items.find((it) => this.normPath(it?.href).split("/").pop() === base);
		}
		return match ?? null;
	}

	// после перехода по якорю страница могла разложиться уже после расчёта
	// позиции (медленные устройства) — повторно наводимся на сам элемент главы
	async settleAnchor(frag: string, target: string) {
		await new Promise((r) => window.setTimeout(r, 180));
		try {
			const contents: any[] = (this.rendition as any)?.getContents?.() ?? [];
			for (const c of contents) {
				const doc: Document | undefined = c?.document;
				if (!doc) continue;
				const el =
					doc.getElementById(frag) ??
					doc.querySelector(`a[name="${frag.replace(/"/g, '\\"')}"]`);
				if (el && typeof c.cfiFromNode === "function") {
					const cfi = c.cfiFromNode(el);
					if (cfi && (await this.tryDisplay(String(cfi)))) return;
				}
			}
			await this.tryDisplay(target);
		} catch (e) {
			/* noop */
		}
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
		this.pendingContext = "";
		this.currentChapter = "";
		this.flatToc = [];
		this.flatTocGenerated = false;
		this.aiAnswer = "";
		this.aiBusy = false;
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

		new Setting(containerEl).setName(L.stAi).setDesc(L.stAiDesc).setHeading();

		new Setting(containerEl).setName(L.stAiPreset).addDropdown((dd) => {
			dd.addOption("", L.stAiOff)
				.addOption("groq", "Groq")
				.addOption("openai", "OpenAI")
				.addOption("openrouter", "OpenRouter")
				.addOption("anthropic", "Anthropic (Claude)")
				.addOption("custom", L.stAiCustom)
				.setValue(this.plugin.settings.aiPreset)
				.onChange(async (v) => {
					this.plugin.settings.aiPreset = v;
					const p = AI_PRESETS[v];
					if (p) {
						if (p.url) this.plugin.settings.aiBaseUrl = p.url;
						if (p.model) this.plugin.settings.aiModel = p.model;
					}
					await this.plugin.saveSettings();
					this.display();
				});
		});

		if (this.plugin.settings.aiPreset) {
			new Setting(containerEl).setName(L.stAiUrl).addText((tx) => {
				tx.inputEl.style.width = "100%";
				tx.setValue(this.plugin.settings.aiBaseUrl).onChange(async (v) => {
					this.plugin.settings.aiBaseUrl = v.trim();
					await this.plugin.saveSettings();
				});
			});

			new Setting(containerEl)
				.setName(L.stAiModel)
				.setDesc(L.stAiModelDesc)
				.addText((tx) =>
					tx.setValue(this.plugin.settings.aiModel).onChange(async (v) => {
						this.plugin.settings.aiModel = v.trim();
						await this.plugin.saveSettings();
					})
				);

			new Setting(containerEl)
				.setName(L.stAiKey)
				.setDesc(L.stAiKeyDesc)
				.addText((tx) => {
					tx.inputEl.type = "password";
					tx.inputEl.style.width = "100%";
					tx.setValue(this.plugin.settings.aiKey).onChange(async (v) => {
						this.plugin.settings.aiKey = v.trim();
						await this.plugin.saveSettings();
					});
				});
		}
	}
}
