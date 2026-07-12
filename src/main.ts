import {
	App,
	FileView,
	Menu,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	WorkspaceLeaf,
	debounce,
} from "obsidian";
import ePub, { Book, Rendition } from "epubjs";

const VIEW_TYPE_EPUB = "tome-epub-view";

type TomeTheme = "classic-light" | "classic-dark" | "gray-fog";

interface TomeSettings {
	theme: TomeTheme;
	fontSize: number;
	fontFamily: string;
	lineHeight: number;
	locations: Record<string, string>;
}

const DEFAULT_SETTINGS: TomeSettings = {
	theme: "classic-light",
	fontSize: 18,
	fontFamily: "",
	lineHeight: 1.6,
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
	"gray-fog": { background: "#14151a", color: "#b9bcc7", accent: "#c0392b" },
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
		const tocBtn = header.createEl("button", { cls: "tome-toc-btn", text: "☰" });
		tocBtn.setAttr("aria-label", "Оглавление");
		header.createDiv({ cls: "tome-title", text: file.basename });
		this.chapterEl = header.createDiv({ cls: "tome-chapter", text: "" });
		this.progressEl = header.createDiv({ cls: "tome-progress", text: "…" });

		// ── область чтения ──
		const readerWrap = container.createDiv({ cls: "tome-reader-wrap" });
		const readerEl = readerWrap.createDiv({ cls: "tome-reader" });
		const navPrev = readerWrap.createDiv({ cls: "tome-nav tome-nav-prev" });
		navPrev.createSpan({ text: "‹" });
		const navNext = readerWrap.createDiv({ cls: "tome-nav tome-nav-next" });
		navNext.createSpan({ text: "›" });

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
			// битая сохранённая позиция — открываем с начала
			await this.rendition.display();
		}

		// ── события ──
		this.rendition.on("relocated", (location: any) => {
			const cfi: string | undefined = location?.start?.cfi;
			if (cfi && this.file) this.plugin.saveLocation(this.file.path, cfi);
			this.updateProgress(location);
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

		// прогресс в процентах — когда посчитаются локации
		void this.book.ready
			.then(() => this.book!.locations.generate(1024))
			.then(() => {
				this.locationsReady = true;
				const loc = (this.rendition as any)?.currentLocation?.();
				if (loc) this.updateProgress(loc);
			})
			.catch(() => {});
	}

	updateProgress(location: any) {
		if (this.chapterEl) {
			const href: string | undefined = location?.start?.href;
			const tocItem = href && this.book ? this.book.navigation?.get(href) : null;
			this.chapterEl.setText(tocItem?.label?.trim() ?? "");
		}
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
						.setTitle(" ".repeat(depth * 3) + (item.label ?? "").trim())
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
		const body: Record<string, string> = {
			background: t.background,
			color: t.color,
			"line-height": String(s.lineHeight),
			"padding-left": "1em",
			"padding-right": "1em",
		};
		if (s.fontFamily.trim()) body["font-family"] = s.fontFamily.trim();
		this.rendition.themes.default({
			body,
			a: { color: t.accent },
			"a:visited": { color: t.accent },
			"::selection": { background: t.accent, color: t.background },
		});
		this.rendition.themes.fontSize(s.fontSize + "px");

		// хром самой панели — под тему
		this.contentEl.setAttr("data-tome-theme", s.theme);
		this.contentEl.style.setProperty("--tome-bg", t.background);
		this.contentEl.style.setProperty("--tome-fg", t.color);
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
			.setDesc("Оформление страницы книги")
			.addDropdown((dd) =>
				dd
					.addOption("classic-light", "Классика · светлая")
					.addOption("classic-dark", "Классика · тёмная")
					.addOption("gray-fog", "Серый Туман")
					.setValue(this.plugin.settings.theme)
					.onChange(async (v) => {
						this.plugin.settings.theme = v as TomeTheme;
						await this.plugin.saveSettings();
						this.plugin.applySettingsToOpenViews();
					})
			);

		new Setting(containerEl)
			.setName("Размер шрифта")
			.setDesc("В пикселях")
			.addSlider((sl) =>
				sl
					.setLimits(12, 32, 1)
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
					.setLimits(1.2, 2.2, 0.1)
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
	}
}
